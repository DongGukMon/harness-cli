import fs from 'fs';
import { join } from 'path';
import { getGitRoot } from '../git.js';
import { updateLockPid, readLock, releaseLock } from '../lock.js';
import { findHarnessRoot } from '../root.js';
import { readState, writeState } from '../state.js';
import { runPhaseLoop } from '../phases/runner.js';
import { registerSignalHandlers } from '../signal.js';
import { killSession, killWindow, selectWindow } from '../tmux.js';
import type { HarnessState } from '../types.js';

export interface InnerOptions {
  root?: string;
}

export async function innerCommand(runId: string, options: InnerOptions = {}): Promise<void> {
  const harnessDir = findHarnessRoot(options.root);
  const cwd = options.root ?? getGitRoot();
  const runDir = join(harnessDir, runId);

  // 1. Load state
  const state = readState(runDir);
  if (state === null) {
    process.stderr.write(`Run '${runId}' has no state.\n`);
    process.exit(1);
  }

  // 2. Claim lock ownership (outer → inner handoff)
  updateLockPid(harnessDir, process.pid);

  // 3. Consume pending-action.json if present
  consumePendingAction(runDir, state);

  // 4. Register signal handlers
  registerSignalHandlers({
    harnessDir,
    runId,
    getState: () => state,
    setState: (s) => Object.assign(state, s),
    getChildPid: () => readLock(harnessDir)?.childPid ?? null,
    getCurrentPhaseType: () => {
      const phase = state.currentPhase;
      if (phase === 1 || phase === 3 || phase === 5) return 'interactive';
      return 'automated';
    },
    cwd,
  });

  // 5. Run phase loop
  try {
    await runPhaseLoop(state, harnessDir, runDir, cwd);
  } finally {
    releaseLock(harnessDir, runId);
  }

  // 6. Cleanup tmux on completion
  if (state.tmuxMode === 'dedicated') {
    killSession(state.tmuxSession);
  } else {
    // Reused mode: kill only harness-owned windows
    for (const windowId of state.tmuxWindows) {
      killWindow(state.tmuxSession, windowId);
    }
    if (state.tmuxOriginalWindow) {
      selectWindow(state.tmuxSession, state.tmuxOriginalWindow);
    }
  }
}

function consumePendingAction(runDir: string, state: HarnessState): void {
  const pendingPath = join(runDir, 'pending-action.json');
  if (!fs.existsSync(pendingPath)) return;

  try {
    const raw = fs.readFileSync(pendingPath, 'utf-8');
    const action = JSON.parse(raw) as { action: string; phase?: number };

    if (action.action === 'skip') {
      // Mark current phase as completed and advance
      state.phases[String(state.currentPhase)] = 'completed';
      state.currentPhase = state.currentPhase + 1;
    } else if (action.action === 'jump' && typeof action.phase === 'number') {
      // Reset phases >= target and set currentPhase
      for (let m = action.phase; m <= 7; m++) {
        state.phases[String(m)] = 'pending';
      }
      state.currentPhase = action.phase;
      state.pendingAction = null;
      state.pauseReason = null;
    }

    writeState(runDir, state);
    fs.unlinkSync(pendingPath);
  } catch {
    // Best-effort: corrupted pending action is skipped
    try { fs.unlinkSync(pendingPath); } catch { /* ignore */ }
  }
}
