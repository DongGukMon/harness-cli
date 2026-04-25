import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { HarnessState, GatePhaseResult } from '../types.js';
import type { ModelPreset } from '../config.js';
import { GATE_TIMEOUT_MS, SIGTERM_WAIT_MS } from '../config.js';
import { sendKeysToPane, pollForPidFile, respawnPane } from '../tmux.js';
import { getProcessStartTime, killProcessGroup } from '../process.js';
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
  cwd: string,
  resume: boolean = false,
): Promise<ClaudeInteractiveResult> {
  const sessionName = state.tmuxSession;
  const workspacePane = state.tmuxWorkspacePane;

  // Atomically reset the workspace pane before spawning the new runner.
  // Claude Code does not exit after writing the sentinel — it stays idle
  // awaiting input. send-keys to such a pane lands inside Claude's input
  // box (not a shell prompt), the PID file never appears, and phase reopen
  // fails. respawn-pane -k kills whatever is running and starts a fresh
  // shell with clean TTY state, eliminating the race window. The 300 ms
  // delay lets the new shell finish initialising before sendKeysToPane.
  respawnPane(sessionName, workspacePane, cwd);
  await new Promise<void>((r) => setTimeout(r, 300));
  state.lastWorkspacePid = null;
  state.lastWorkspacePidStartTime = null;
  writeState(runDir, state);

  // PID file (phase/attempt scoped)
  const attemptId = state.phaseAttemptId[String(phase)] ?? '';
  const pidFile = path.join(runDir, `claude-${phase}-${attemptId}.pid`);
  if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);

  // Launch Claude via exec wrapper.
  // For fresh launches, pin Claude's session UUID via --session-id so the JSONL lands at
  // ~/.claude/projects/<encodedCwd>/<attemptId>.jsonl (§D5 of the token-capture design).
  // For reopen launches, use --resume to continue the same Claude session.
  // Guard against empty attemptId (shouldn't happen given upstream contract) by
  // omitting the flag rather than passing an invalid argument.
  const sessionFlag = resume
    ? (attemptId ? `--resume ${attemptId} ` : '')
    : (attemptId ? `--session-id ${attemptId} ` : '');
  const claudeArgs = `--dangerously-skip-permissions ${sessionFlag}--model ${preset.model} --effort ${preset.effort} @${path.resolve(promptFile)}`;
  // `cd "<cwd>" &&` pins Claude's process cwd to the harness anchor; without it Claude
  // inherits the tmux pane's shell cwd (wrong in reused-tmux mode) and relative artifact
  // paths land outside the tree that `validatePhaseArtifacts` scans. `&&` chaining makes
  // a failed cd abort instead of silently exec'ing claude in the wrong directory.
  const wrappedCmd = `sh -c 'cd "${cwd}" && echo $$ > ${pidFile} && exec claude ${claudeArgs}'`;
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
