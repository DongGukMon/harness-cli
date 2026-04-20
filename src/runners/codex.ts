import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { HarnessState, GatePhaseResult } from '../types.js';
import type { ModelPreset } from '../config.js';
import { INTERACTIVE_TIMEOUT_MS, GATE_TIMEOUT_MS, SIGTERM_WAIT_MS, MAX_PROMPT_SIZE_KB } from '../config.js';
import { updateLockChild, clearLockChild } from '../lock.js';
import { getProcessStartTime, killProcessGroup } from '../process.js';
import { writeState } from '../state.js';
import { buildGateResult, extractCodexMetadata } from '../phases/verdict.js';
import { isInGitRepo } from '../git.js';

function resolveCodexBin(): string {
  try {
    return execSync('which codex', { encoding: 'utf-8' }).trim();
  } catch {
    throw new Error('Codex CLI not found in PATH.');
  }
}

export interface CodexInteractiveResult {
  status: 'completed' | 'failed';
  exitCode: number;
}

export async function runCodexInteractive(
  phase: 1 | 3 | 5,
  state: HarnessState,
  preset: ModelPreset,
  harnessDir: string,
  runDir: string,
  promptFile: string,
  cwd: string,
  codexHome: string | null = null,
): Promise<CodexInteractiveResult> {
  // Prompt size check
  let promptSize: number;
  try {
    promptSize = fs.statSync(promptFile).size;
  } catch {
    return { status: 'failed', exitCode: -4 };
  }
  if (promptSize > MAX_PROMPT_SIZE_KB * 1024) {
    const errorPath = path.join(runDir, `codex-${phase}-error.md`);
    try {
      fs.writeFileSync(
        errorPath,
        `# Codex Phase ${phase} Error\n\nPrompt exceeds ${MAX_PROMPT_SIZE_KB}KB limit (${Math.round(promptSize / 1024)}KB).\n`,
      );
    } catch { /* best-effort */ }
    return { status: 'failed', exitCode: -1 };
  }

  const codexBin = resolveCodexBin();
  const sandbox = phase === 5 ? 'danger-full-access' : 'workspace-write';

  const child = spawn(codexBin, [
    'exec',
    '--model', preset.model,
    '-c', `model_reasoning_effort="${preset.effort}"`,
    '--sandbox', sandbox,
    '--full-auto',
    '-',
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
    cwd,
    env: codexHome === null
      ? process.env
      : { ...process.env, CODEX_HOME: codexHome },
  });

  const childPid = child.pid!;
  const startTime = getProcessStartTime(childPid);
  updateLockChild(harnessDir, childPid, phase, startTime);

  // Pipe prompt content to stdin
  const promptContent = fs.readFileSync(promptFile, 'utf-8');
  child.stdin.write(promptContent);
  child.stdin.end();

  // Stream stderr/stdout [codex] progress lines to control panel
  const stderrChunks: Buffer[] = [];
  child.stderr.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk);
    const text = chunk.toString();
    for (const line of text.split('\n')) {
      if (line.trim()) process.stderr.write(`  [codex] ${line}\n`);
    }
  });
  child.stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    for (const line of text.split('\n')) {
      if (line.includes('[codex]')) process.stderr.write(`  ${line}\n`);
    }
  });

  const result = await new Promise<CodexInteractiveResult>((resolve) => {
    let settled = false;
    const timeout = setTimeout(async () => {
      if (settled) return;
      settled = true;
      await killProcessGroup(childPid, SIGTERM_WAIT_MS);
      resolve({ status: 'failed', exitCode: -2 });
    }, INTERACTIVE_TIMEOUT_MS);

    child.on('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        status: (code ?? 1) === 0 ? 'completed' : 'failed',
        exitCode: code ?? 1,
      });
    });

    child.on('error', (_err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ status: 'failed', exitCode: -3 });
    });
  });

  // Cleanup
  await killProcessGroup(childPid, SIGTERM_WAIT_MS);
  try { clearLockChild(harnessDir); } catch { /* best-effort */ }

  // Clear workspace PID (Codex subprocess confirmed dead)
  state.lastWorkspacePid = null;
  state.lastWorkspacePidStartTime = null;
  writeState(runDir, state);

  // Error sidecar for non-zero positive exit codes
  if (result.status === 'failed' && result.exitCode > 0) {
    const errorPath = path.join(runDir, `codex-${phase}-error.md`);
    const stderr = Buffer.concat(stderrChunks).toString('utf-8');
    try {
      fs.writeFileSync(
        errorPath,
        `# Codex Phase ${phase} Error\n\nExit code: ${result.exitCode}\n\n## stderr\n\n\`\`\`\n${stderr}\n\`\`\`\n`,
      );
    } catch { /* best-effort */ }
  }

  return result;
}

// ─── Error taxonomy for gate runs (spec §4.5) ────────────────────────────────
// Kept internal: runCodexGate's external contract remains GatePhaseResult.
type RawCategory =
  | 'success_verdict'
  | 'success_no_verdict'
  | 'session_missing'
  | 'nonzero_exit_other'
  | 'timeout'
  | 'spawn_error';

interface RawExecResult {
  category: RawCategory;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  spawnError?: string;
  timedOut?: boolean;
}

interface RawExecInput {
  mode: 'fresh' | 'resume';
  sessionId?: string | null;
  prompt: string;
  preset: ModelPreset;
  harnessDir: string;
  cwd: string;
  phase: number;
  codexHome: string | null;
}

/**
 * Detect "session not found / missing / expired" stderr patterns.
 * Spec §9 Q#1: exact regex finalized from Task 0 pilot results (deferred —
 * using conservative pattern that matches Codex CLI conventions).
 */
function isResumeSessionMissingError(stderr: string): boolean {
  return /session\s+(not\s+found|missing|expired|does\s+not\s+exist)|no\s+such\s+session/i.test(stderr);
}

async function runCodexExecRaw(input: RawExecInput): Promise<RawExecResult> {
  const codexBin = resolveCodexBin();
  // `codex exec resume`의 CLI contract (spec §2): `[SESSION_ID] [PROMPT]`가 positional.
  // sessionId를 '--model' 같은 플래그 뒤에 두면 parser가 flag value로 오인할 위험이 있다.
  // 반드시 'resume' 직후 sessionId → 플래그들 → prompt placeholder(`-`) 순서.
  const skipGitFlag = !isInGitRepo(input.cwd) ? ['--skip-git-repo-check'] : [];

  const args = input.mode === 'resume'
    ? ['exec', 'resume', input.sessionId!,
       ...skipGitFlag,
       '--model', input.preset.model,
       '-c', `model_reasoning_effort="${input.preset.effort}"`,
       '-']
    : ['exec',
       ...skipGitFlag,
       '--model', input.preset.model,
       '-c', `model_reasoning_effort="${input.preset.effort}"`,
       '-'];

  const child = spawn(codexBin, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
    cwd: input.cwd,
    env: input.codexHome === null
      ? process.env
      : { ...process.env, CODEX_HOME: input.codexHome },
  });
  const childPid = child.pid!;
  const startTime = getProcessStartTime(childPid);
  updateLockChild(input.harnessDir, childPid, input.phase, startTime);

  child.stdin.write(input.prompt);
  child.stdin.end();

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on('data', (c: Buffer) => { stdoutChunks.push(c); });
  child.stderr.on('data', (c: Buffer) => {
    stderrChunks.push(c);
    const text = c.toString();
    for (const line of text.split('\n')) {
      if (line.includes('[codex]')) process.stderr.write(`  ${line}\n`);
    }
  });

  const finishResult = await new Promise<{
    exitCode: number | null;
    spawnError?: string;
    timedOut?: boolean;
  }>((resolve) => {
    let settled = false;
    const timeout = setTimeout(async () => {
      if (settled) return;
      settled = true;
      await killProcessGroup(childPid, SIGTERM_WAIT_MS);
      resolve({ exitCode: null, timedOut: true });
    }, GATE_TIMEOUT_MS);
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ exitCode: code ?? 1 });
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ exitCode: null, spawnError: err.message });
    });
  });

  await killProcessGroup(childPid, SIGTERM_WAIT_MS);
  try { clearLockChild(input.harnessDir); } catch { /* best-effort */ }

  const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
  const stderr = Buffer.concat(stderrChunks).toString('utf-8');

  let category: RawCategory;
  if (finishResult.spawnError !== undefined) category = 'spawn_error';
  else if (finishResult.timedOut) category = 'timeout';
  else if (finishResult.exitCode !== null && finishResult.exitCode !== 0) {
    category = isResumeSessionMissingError(stderr) ? 'session_missing' : 'nonzero_exit_other';
  } else {
    category = parseVerdictPresent(stdout) ? 'success_verdict' : 'success_no_verdict';
  }

  return {
    category,
    exitCode: finishResult.exitCode,
    stdout,
    stderr,
    spawnError: finishResult.spawnError,
    timedOut: finishResult.timedOut,
  };
}

function parseVerdictPresent(stdout: string): boolean {
  // Lightweight presence check — full parse happens in buildGateResult.
  return /^##\s+verdict\s*$/im.test(stdout);
}

export function stderrTail(stderr: string, maxLines = 20): string {
  // Strip ANSI escape sequences
  const clean = stderr.replace(/\x1B\[[0-9;]*m/g, '');
  const lines = clean.split('\n').filter(l => l.trim().length > 0);
  return lines.slice(-maxLines).join('\n');
}

function rawToResult(
  raw: RawExecResult,
  preset: ModelPreset,
  resumedFrom: string | null,
  resumeFallback: boolean,
): GatePhaseResult {
  // Codex metadata (session id + tokens used) lands on STDERR, so pass both streams.
  const metadata = extractCodexMetadata(raw.stdout, raw.stderr);
  const sourcePreset = { model: preset.model, effort: preset.effort };

  if (raw.category === 'success_verdict') {
    const built = buildGateResult(0, raw.stdout, raw.stderr);
    return { ...built, ...metadata, runner: 'codex', sourcePreset, resumedFrom, resumeFallback };
  }

  // All error categories project through a single error branch; messages distinct per category.
  const errorMessage =
    raw.category === 'timeout' ? `Codex gate timed out after ${GATE_TIMEOUT_MS}ms` :
    raw.category === 'spawn_error' ? `Codex gate error: ${raw.spawnError ?? 'unknown spawn failure'}` :
    raw.category === 'success_no_verdict' ? 'Gate output missing ## Verdict header' :
    raw.category === 'session_missing' ? `Codex resume failed: session not found (stderr: ${raw.stderr.trim().slice(0, 200)})` :
    (() => {
      const tail = stderrTail(raw.stderr);
      return tail.length > 0
        ? `Gate subprocess exited with code ${raw.exitCode ?? 'null'}\n--- stderr (tail) ---\n${tail}\n---`
        : `Gate subprocess exited with code ${raw.exitCode ?? 'null'}`;
    })();

  return {
    type: 'error',
    error: errorMessage,
    rawOutput: raw.stdout,
    runner: 'codex',
    exitCode: raw.exitCode ?? undefined,
    sourcePreset,
    resumedFrom,
    resumeFallback,
    ...metadata,
  };
}

export async function runCodexGate(
  phase: number,
  preset: ModelPreset,
  prompt: string,
  harnessDir: string,
  cwd: string,
  resumeSessionId?: string | null,
  buildFreshPromptOnFallback?: () => string | { error: string },
  codexHome: string | null = null,
): Promise<GatePhaseResult> {
  const mode: 'fresh' | 'resume' = resumeSessionId ? 'resume' : 'fresh';
  const first = await runCodexExecRaw({
    mode,
    sessionId: resumeSessionId ?? null,
    prompt,
    preset,
    harnessDir,
    cwd,
    phase,
    codexHome,
  });

  // §4.5 fallback: only for session_missing, and only when we were actually resuming.
  if (mode === 'resume' && first.category === 'session_missing' && buildFreshPromptOnFallback) {
    const freshPrompt = buildFreshPromptOnFallback();
    if (typeof freshPrompt !== 'string') {
      // §4.4: when resumeFallback=true, the stale (failed-resume) session id
      // must NOT be carried forward — otherwise the caller's save branch can
      // mistake it for a new fresh id and re-persist the dead lineage. We
      // preserve tokensTotal (useful for accounting) but drop codexSessionId
      // explicitly. resumedFrom still records the stale id for audit/logging.
      const firstMeta = extractCodexMetadata(first.stdout, first.stderr);
      return {
        type: 'error',
        error: `Resume fallback failed: ${freshPrompt.error}`,
        rawOutput: first.stdout,
        runner: 'codex',
        exitCode: first.exitCode ?? undefined,
        sourcePreset: { model: preset.model, effort: preset.effort },
        resumedFrom: resumeSessionId ?? null,
        resumeFallback: true,
        // Only carry forward non-session metadata:
        ...(firstMeta.tokensTotal !== undefined ? { tokensTotal: firstMeta.tokensTotal } : {}),
        // codexSessionId intentionally omitted — the resume attempt's id is stale.
      };
    }
    const fresh = await runCodexExecRaw({
      mode: 'fresh',
      sessionId: null,
      prompt: freshPrompt,
      preset,
      harnessDir,
      cwd,
      phase,
      codexHome,
    });
    return rawToResult(fresh, preset, resumeSessionId ?? null, /* resumeFallback */ true);
  }

  return rawToResult(first, preset, resumeSessionId ?? null, /* resumeFallback */ false);
}
