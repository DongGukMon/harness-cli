import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { HarnessState, GatePhaseResult } from '../types.js';
import type { ModelPreset } from '../config.js';
import { GATE_TIMEOUT_MS, SIGTERM_WAIT_MS } from '../config.js';
import { sendKeysToPane, pollForPidFile } from '../tmux.js';
import { isPidAlive, getProcessStartTime, killProcessGroup } from '../process.js';
import { updateLockChild, clearLockChild } from '../lock.js';
import { writeState } from '../state.js';
import { buildGateResult } from '../phases/verdict.js';

export interface ClaudeInteractiveResult {
  pid: number | null;
}

export async function runClaudeInteractive(
  phase: 1 | 3 | 5,
  state: HarnessState,
  preset: ModelPreset,
  harnessDir: string,
  runDir: string,
  promptFile: string,
): Promise<ClaudeInteractiveResult> {
  const sessionName = state.tmuxSession;
  const workspacePane = state.tmuxWorkspacePane;

  // Kill previous workspace process if alive (and matches saved start-time).
  // Claude Code does not exit after writing the sentinel — it stays idle awaiting input.
  // If we don't kill it, the next sendKeysToPane below types the wrapper command INTO
  // Claude's input box (not a shell prompt), the PID file never appears, and phase reopen fails.
  if (state.lastWorkspacePid !== null && isPidAlive(state.lastWorkspacePid)) {
    const savedStart = state.lastWorkspacePidStartTime;
    const actualStart = getProcessStartTime(state.lastWorkspacePid);
    if (savedStart !== null && actualStart !== null && Math.abs(actualStart - savedStart) <= 2) {
      sendKeysToPane(sessionName, workspacePane, 'C-c');
      const deadline = Date.now() + 5000;
      while (isPidAlive(state.lastWorkspacePid) && Date.now() < deadline) {
        await new Promise<void>((r) => setTimeout(r, 200));
      }
      if (isPidAlive(state.lastWorkspacePid)) {
        await killProcessGroup(state.lastWorkspacePid, SIGTERM_WAIT_MS);
      }
    }
    state.lastWorkspacePid = null;
    state.lastWorkspacePidStartTime = null;
    writeState(runDir, state);
  }

  // Safety: Ctrl+C + wait
  sendKeysToPane(sessionName, workspacePane, 'C-c');
  await new Promise<void>((r) => setTimeout(r, 500));

  // PID file (phase/attempt scoped)
  const attemptId = state.phaseAttemptId[String(phase)] ?? '';
  const pidFile = path.join(runDir, `claude-${phase}-${attemptId}.pid`);
  if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);

  // Launch Claude via exec wrapper
  const claudeArgs = `--dangerously-skip-permissions --model ${preset.model} --effort ${preset.effort} @${path.resolve(promptFile)}`;
  const wrappedCmd = `sh -c 'echo $$ > ${pidFile}; exec claude ${claudeArgs}'`;
  sendKeysToPane(sessionName, workspacePane, wrappedCmd);

  // Capture Claude PID
  const claudePid = await pollForPidFile(pidFile, 5000);

  // Register in repo.lock + update state
  if (claudePid !== null) {
    const startTime = getProcessStartTime(claudePid);
    updateLockChild(harnessDir, claudePid, phase, startTime);
    state.lastWorkspacePid = claudePid;
    state.lastWorkspacePidStartTime = startTime;
    writeState(runDir, state);
  }

  return { pid: claudePid };
}

export async function runClaudeGate(
  phase: number,
  preset: ModelPreset,
  prompt: string,
  harnessDir: string,
  cwd: string,
): Promise<GatePhaseResult> {
  const child = spawn('claude', [
    '--print',
    '--model', preset.model,
    '--effort', preset.effort,
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
    cwd,
  });

  const childPid = child.pid!;
  const startTime = getProcessStartTime(childPid);
  updateLockChild(harnessDir, childPid, phase, startTime);

  // Write prompt to stdin
  child.stdin.write(prompt);
  child.stdin.end();

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on('data', (c: Buffer) => { stdoutChunks.push(c); });
  child.stderr.on('data', (c: Buffer) => { stderrChunks.push(c); });

  const result = await new Promise<GatePhaseResult>((resolve) => {
    let settled = false;
    const timeout = setTimeout(async () => {
      if (settled) return;
      settled = true;
      await killProcessGroup(childPid, SIGTERM_WAIT_MS);
      resolve({ type: 'error', error: `Claude gate timed out after ${GATE_TIMEOUT_MS}ms` });
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
      resolve({ type: 'error', error: `Claude gate error: ${err.message}` });
    });
  });

  await killProcessGroup(childPid, SIGTERM_WAIT_MS);
  try { clearLockChild(harnessDir); } catch { /* best-effort */ }

  return result;
}
