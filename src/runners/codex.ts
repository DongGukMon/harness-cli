import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { HarnessState, GatePhaseResult } from '../types.js';
import type { ModelPreset } from '../config.js';
import { GATE_TIMEOUT_MS, SIGTERM_WAIT_MS } from '../config.js';
import { updateLockChild, clearLockChild } from '../lock.js';
import { getProcessStartTime, killProcessGroup } from '../process.js';
import { sendKeysToPane, pollForPidFile, respawnPane } from '../tmux.js';
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

export interface SpawnCodexInPaneInput {
  phase: number;
  state: HarnessState;
  preset: ModelPreset;
  harnessDir: string;
  runDir: string;
  promptFile: string;
  cwd: string;
  codexHome: string | null;
  mode: 'fresh' | 'resume';
  sessionId?: string;
}

export interface CodexSpawnResult {
  pid: number | null;
}

/**
 * Inject a Codex TUI command into the tmux workspace pane.
 * Used for gate phases (2/4/7). Mirrors runClaudeInteractive: sends the
 * command via sendKeysToPane, polls for a PID file, updates state.lastWorkspacePid.
 */
export async function spawnCodexInPane(input: SpawnCodexInPaneInput): Promise<CodexSpawnResult> {
  const { phase, state, preset, harnessDir, runDir, promptFile, cwd, codexHome, mode, sessionId } = input;

  const sessionName = state.tmuxSession;
  const workspacePane = state.tmuxWorkspacePane;

  // Atomically reset the workspace pane before spawning the new runner.
  // Codex CLI TUI / Claude TUI do not exit after writing the sentinel — they
  // stay in REPL mode holding the pane. send-keys to such a pane lands in the
  // REPL's input field, not a shell prompt (issue #90). respawn-pane -k
  // kills whatever is running and starts a fresh shell with clean TTY state
  // (issue #88). The 300 ms delay lets the new shell finish initialising
  // before sendKeysToPane below.
  respawnPane(sessionName, workspacePane, cwd);
  await new Promise<void>((r) => setTimeout(r, 300));
  state.lastWorkspacePid = null;
  state.lastWorkspacePidStartTime = null;
  writeState(runDir, state);

  const pidFile = path.join(runDir, `codex-gate-${phase}.pid`);
  if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);

  const codexBin = resolveCodexBin();
  const codexHomeEnv = codexHome ? `CODEX_HOME="${codexHome}" ` : '';

  // Spawn the top-level `codex` TUI (not `codex exec`) so the workspace pane
  // shows the live reasoning + input line — restoring PR #74's intent.
  //
  // codex-cli 0.124.0 made stdin redirect impossible with TUI ("stdin is not a
  // terminal"), so the prompt is injected via shell command-substitution as a
  // positional CLI argument instead. tmux send-keys carries only the short
  // wrapper; `cat` runs at execution time on the pane shell.
  //
  // `--skip-git-repo-check` was removed from top-level codex in 0.124.0; we
  // pre-trust the cwd via codex config (ensureCodexIsolation writes
  // `[projects."<realpath cwd>"] trust_level = "trusted"` into the isolated
  // CODEX_HOME), which bypasses both the trust prompt and the git-repo check.
  //
  // `--dangerously-bypass-approvals-and-sandbox` (yolo) disables both the
  // sandbox and approval prompts, matching harness's autonomous-mode intent —
  // gates often need to write artifacts (verdict, sentinel, plan files) into
  // paths whose git metadata sits outside the sandbox writable roots (e.g.
  // sibling worktrees), and any approval prompt blocks the codex TUI inside
  // the workspace pane until the human responds. The harness wrapper trusts
  // the caller's cwd; security boundary is the harness invocation, not codex.
  let codexCmd: string;
  if (mode === 'resume' && sessionId) {
    codexCmd =
      `${codexBin} resume ${sessionId} ` +
      `--model ${preset.model} ` +
      `-c model_reasoning_effort="${preset.effort}" ` +
      `--dangerously-bypass-approvals-and-sandbox ` +
      `"$(cat "${promptFile}")"`;
  } else {
    codexCmd =
      `${codexBin} ` +
      `--model ${preset.model} ` +
      `-c model_reasoning_effort="${preset.effort}" ` +
      `--dangerously-bypass-approvals-and-sandbox ` +
      `"$(cat "${promptFile}")"`;
  }

  const wrappedCmd = `sh -c 'cd "${cwd}" && echo $$ > ${pidFile} && ${codexHomeEnv}exec ${codexCmd}'`;
  sendKeysToPane(sessionName, workspacePane, wrappedCmd);

  const codexPid = await pollForPidFile(pidFile, 5000);

  if (codexPid !== null) {
    const startTime = getProcessStartTime(codexPid);
    updateLockChild(harnessDir, codexPid, phase, startTime);
    state.lastWorkspacePid = codexPid;
    state.lastWorkspacePidStartTime = startTime;
    writeState(runDir, state);
  }

  return { pid: codexPid };
}

export interface SpawnCodexInteractiveInPaneInput {
  phase: 1 | 3 | 5;
  state: HarnessState;
  preset: ModelPreset;
  harnessDir: string;
  runDir: string;
  promptFile: string;
  cwd: string;
  codexHome: string | null;
  /** @deprecated Vestigial since the TUI switch — codex now writes the sentinel via tool use per the phase prompt. Kept for caller compatibility; safe to remove once `interactive.ts` stops passing it. */
  attemptId: string;
  /** @deprecated See `attemptId`. */
  sentinelPath: string;
}

/**
 * Inject a top-level `codex` (TUI) command into the tmux workspace pane for
 * interactive phases (1/3/5). Runs with
 * `--dangerously-bypass-approvals-and-sandbox` so cross-worktree writes and
 * git operations don't trip the sandbox or pop approval prompts. Unlike
 * spawnCodexInPane (gates), the shell wrapper does NOT use `exec`, so sh
 * survives codex exit and can write the sentinel. Sentinel content =
 * attemptId, enabling checkSentinelFreshness to verify it.
 */
export async function spawnCodexInteractiveInPane(
  input: SpawnCodexInteractiveInPaneInput,
): Promise<CodexSpawnResult> {
  const { phase, state, preset, harnessDir, runDir, promptFile, cwd, codexHome } = input;
  // attemptId / sentinelPath used to drive a shell-level sentinel write when
  // the runner was `codex exec` (auto-exits). With TUI mode, codex itself
  // writes the sentinel via tool use per the phase-N prompt — same as Claude
  // TUI. Kept in the input type for caller compatibility.
  void input.attemptId; void input.sentinelPath;

  const sessionName = state.tmuxSession;
  const workspacePane = state.tmuxWorkspacePane;

  // See spawnCodexInPane above — same rationale (issues #88, #90).
  respawnPane(sessionName, workspacePane, cwd);
  await new Promise<void>((r) => setTimeout(r, 300));
  state.lastWorkspacePid = null;
  state.lastWorkspacePidStartTime = null;
  writeState(runDir, state);

  const pidFile = path.join(runDir, `codex-interactive-${phase}.pid`);
  if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);

  const codexBin = resolveCodexBin();
  const codexHomeEnv = codexHome ? `CODEX_HOME="${codexHome}" ` : '';

  // Top-level `codex` TUI (matches gate pane spawn pattern). Trust entry in
  // the isolated CODEX_HOME (ensureCodexIsolation) bypasses git-repo check.
  // Prompt injected as positional arg via `cat` substitution at exec time.
  // `--dangerously-bypass-approvals-and-sandbox` disables sandbox + all
  // approval prompts so the autonomous loop never blocks on a yes/no inside
  // the workspace pane (interactive phases routinely write across worktrees,
  // run git, etc., which hits sandbox or approval gates otherwise).
  const wrappedCmd =
    `sh -c 'cd "${cwd}" && echo $$ > "${pidFile}" && ` +
    `${codexHomeEnv}exec ${codexBin} ` +
    `--model ${preset.model} ` +
    `-c model_reasoning_effort="${preset.effort}" ` +
    `--dangerously-bypass-approvals-and-sandbox ` +
    `"$(cat "${promptFile}")"'`;

  sendKeysToPane(sessionName, workspacePane, wrappedCmd);

  const codexPid = await pollForPidFile(pidFile, 5000);

  if (codexPid !== null) {
    const startTime = getProcessStartTime(codexPid);
    updateLockChild(harnessDir, codexPid, phase, startTime);
    state.lastWorkspacePid = codexPid;
    state.lastWorkspacePidStartTime = startTime;
    writeState(runDir, state);
  }

  return { pid: codexPid };
}
