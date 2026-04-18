import { writeFileSync } from 'fs';
import { join } from 'path';
import { getGitRoot } from '../git.js';
import { readLock } from '../lock.js';
import { isPidAlive } from '../process.js';
import { findHarnessRoot, getCurrentRun } from '../root.js';
import { readState } from '../state.js';
import type { PhaseNumber } from '../types.js';

export interface JumpOptions {
  root?: string;
}

export async function jumpCommand(phaseArg: string, options: JumpOptions = {}): Promise<void> {
  // 1. Parse phase number
  const targetPhase = parseInt(phaseArg, 10);
  if (isNaN(targetPhase) || targetPhase < 1 || targetPhase > 7) {
    process.stderr.write(`Error: invalid phase '${phaseArg}'. Must be 1-7.\n`);
    process.exit(1);
  }
  const N = targetPhase as PhaseNumber;

  // 2. Resolve harnessDir + runId
  const harnessDir = findHarnessRoot(options.root);
  const runId = getCurrentRun(harnessDir);
  if (runId === null) {
    process.stderr.write("No active run. Use 'harness list' to see all runs.\n");
    process.exit(1);
  }

  const runDir = join(harnessDir, runId);
  const state = readState(runDir);
  if (state === null) {
    process.stderr.write(`Run '${runId}' has no state. Manual recovery required.\n`);
    process.exit(1);
  }

  // Reject jumping into a 'skipped' phase (light flow P2/P3/P4 are illegal targets).
  if (state.phases[String(N)] === 'skipped') {
    process.stderr.write(
      `Error: phase ${N} is 'skipped' in this run (flow=${state.flow}); cannot jump to a skipped phase.\n`,
    );
    process.exit(1);
  }

  // 3. Forward jump rejected (unless from completed)
  const isCompleted = state.status === 'completed' || state.currentPhase === 8;
  if (!isCompleted && N >= state.currentPhase) {
    process.stderr.write(
      `Error: forward jumps not allowed. Current phase: ${state.currentPhase}, target: ${N}.\n`
    );
    process.exit(1);
  }

  let cwd: string;
  try { cwd = options.root ?? getGitRoot(); } catch { cwd = options.root ?? process.cwd(); }

  // Check if inner process is running (tmux architecture)
  const lock = readLock(harnessDir);
  const innerAlive = lock !== null && lock.handoff === false && isPidAlive(lock.cliPid);

  if (innerAlive) {
    const pendingPath = join(runDir, 'pending-action.json');
    writeFileSync(pendingPath, JSON.stringify({ action: 'jump', phase: N }));
    process.kill(lock!.cliPid, 'SIGUSR1');
    process.stderr.write(`Jump to phase ${N} signal sent to active harness session.\n`);
    return;
  }

  // No active inner — write pending-action only (ADR-9)
  const pendingPath = join(runDir, 'pending-action.json');
  writeFileSync(pendingPath, JSON.stringify({ action: 'jump', phase: N }));
  process.stderr.write(`Jump to phase ${N} saved. Will apply on next 'harness resume'.\n`);
}
