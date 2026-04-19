import { writeFileSync } from 'fs';
import { join } from 'path';
import { getGitRoot } from '../git.js';
import { readLock } from '../lock.js';
import { isPidAlive } from '../process.js';
import { findHarnessRoot, getCurrentRun } from '../root.js';
import { readState } from '../state.js';

export interface SkipOptions {
  root?: string;
}

export async function skipCommand(options: SkipOptions = {}): Promise<void> {
  // 1. Resolve harnessDir + runId
  const harnessDir = findHarnessRoot(options.root);
  const runId = getCurrentRun(harnessDir);
  if (runId === null) {
    process.stderr.write("No active run. Use 'phase-harness list' to see all runs.\n");
    process.exit(1);
  }

  const runDir = join(harnessDir, runId);
  const state = readState(runDir);
  if (state === null) {
    process.stderr.write(`Run '${runId}' has no state. Manual recovery required.\n`);
    process.exit(1);
  }

  // 2. Validate run.status
  if (state.status === 'paused') {
    process.stderr.write(`Cannot skip: run is paused. Use 'phase-harness resume' first.\n`);
    process.exit(1);
  }
  if (state.status === 'completed') {
    process.stderr.write(`Cannot skip: run is completed. Use 'harness jump N' to re-run a phase.\n`);
    process.exit(1);
  }

  const cwd = options.root ?? getGitRoot();

  // Check if inner process is running (tmux architecture)
  const lock = readLock(harnessDir);
  const innerAlive = lock !== null && lock.handoff === false && isPidAlive(lock.cliPid);

  if (innerAlive) {
    // Active inner — write pending-action + send SIGUSR1
    const pendingPath = join(runDir, 'pending-action.json');
    writeFileSync(pendingPath, JSON.stringify({ action: 'skip' }));
    process.kill(lock!.cliPid, 'SIGUSR1');
    process.stderr.write(`Skip signal sent to active harness session.\n`);
    return;
  }

  // No active inner — write pending-action only (ADR-9: no lock acquire)
  const pendingPath = join(runDir, 'pending-action.json');
  writeFileSync(pendingPath, JSON.stringify({ action: 'skip' }));
  process.stderr.write(`Skip action saved. Will apply on next 'phase-harness resume'.\n`);
}
