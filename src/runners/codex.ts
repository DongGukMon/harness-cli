import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { HarnessState, GatePhaseResult } from '../types.js';
import type { ModelPreset } from '../config.js';
import { INTERACTIVE_TIMEOUT_MS, GATE_TIMEOUT_MS, SIGTERM_WAIT_MS, MAX_PROMPT_SIZE_KB } from '../config.js';
import { updateLockChild, clearLockChild } from '../lock.js';
import { getProcessStartTime, killProcessGroup } from '../process.js';
import { writeState } from '../state.js';
import { buildGateResult } from '../phases/verdict.js';

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

export async function runCodexGate(
  phase: number,
  preset: ModelPreset,
  prompt: string,
  harnessDir: string,
  cwd: string,
): Promise<GatePhaseResult> {
  const codexBin = resolveCodexBin();

  const child = spawn(codexBin, [
    'exec',
    '--model', preset.model,
    '-c', `model_reasoning_effort="${preset.effort}"`,
    '-',
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
    cwd,
  });

  const childPid = child.pid!;
  const startTime = getProcessStartTime(childPid);
  updateLockChild(harnessDir, childPid, phase, startTime);

  child.stdin.write(prompt);
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

  const result = await new Promise<GatePhaseResult>((resolve) => {
    let settled = false;
    const timeout = setTimeout(async () => {
      if (settled) return;
      settled = true;
      await killProcessGroup(childPid, SIGTERM_WAIT_MS);
      resolve({ type: 'error', error: `Codex gate timed out after ${GATE_TIMEOUT_MS}ms` });
    }, GATE_TIMEOUT_MS);

    child.on('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');
      resolve(buildGateResult(code ?? 1, stdout, stderr));
    });

    child.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ type: 'error', error: `Codex gate error: ${err.message}` });
    });
  });

  await killProcessGroup(childPid, SIGTERM_WAIT_MS);
  try { clearLockChild(harnessDir); } catch { /* best-effort */ }

  return result;
}
