import fs from 'fs';
import path from 'path';
import type { HarnessState } from './types.js';
import { killProcessGroup } from './process.js';
import { sendKeysToPane } from './tmux.js';
import { getHead } from './git.js';
import { writeState } from './state.js';
import { SIGTERM_WAIT_MS, GATE_PHASES } from './config.js';

export interface SignalContext {
  harnessDir: string;
  runId: string;
  getState: () => HarnessState;
  setState: (state: HarnessState) => void;
  getChildPid: () => number | null;
  getCurrentPhaseType: () => 'interactive' | 'automated';
  cwd: string;
}

/**
 * Execute the full shutdown sequence. Exported for testability.
 */
export async function handleShutdown(ctx: SignalContext): Promise<void> {
  const { harnessDir, runId, getState, setState, getChildPid, getCurrentPhaseType, cwd } = ctx;

  // Step 1-2: Kill child process group if running
  const childPid = getChildPid();
  if (childPid !== null) {
    await killProcessGroup(childPid, SIGTERM_WAIT_MS);
  }

  // Step 3: Save pausedAtHead
  const state = getState();
  let pausedAtHead: string | null = null;
  try {
    pausedAtHead = getHead(cwd);
  } catch {
    // If we can't get HEAD, leave it null
  }
  state.pausedAtHead = pausedAtHead;

  // Step 4: Set phase status based on type
  const phaseType = getCurrentPhaseType();
  const currentPhase = state.currentPhase as 1 | 2 | 3 | 4 | 5 | 6 | 7;

  if (phaseType === 'interactive') {
    // Phases 1, 3, 5
    state.phases[String(currentPhase)] = 'failed';
    state.status = 'in_progress';
  } else {
    // Automated phases: 2, 4, 6, 7
    state.phases[String(currentPhase)] = 'error';

    // Determine pendingAction type: gate phases → rerun_gate, verify (6) → rerun_verify
    const gatePhaseNumbers: readonly number[] = GATE_PHASES;
    const pendingActionType = gatePhaseNumbers.includes(currentPhase) ? 'rerun_gate' : 'rerun_verify';

    state.pendingAction = {
      type: pendingActionType,
      targetPhase: currentPhase,
      sourcePhase: null,
      feedbackPaths: [],
    };
  }

  setState(state);

  // Step 5: Write state.json atomically
  const runDir = path.join(harnessDir, runId);
  writeState(runDir, state);

  // Step 6: Release locks (repo.lock + run.lock)
  const repoLockPath = path.join(harnessDir, 'repo.lock');
  const runLockPath = path.join(harnessDir, runId, 'run.lock');

  try {
    fs.unlinkSync(repoLockPath);
  } catch {
    // Lock may not exist; ignore
  }

  try {
    fs.unlinkSync(runLockPath);
  } catch {
    // Lock may not exist; ignore
  }
}

/**
 * Register SIGINT + SIGTERM handlers. Call once at CLI startup.
 */
export function registerSignalHandlers(ctx: SignalContext): void {
  let shuttingDown = false;

  const handler = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;

    void handleShutdown(ctx).then(() => {
      // Step 7: Exit with code 130 (SIGINT convention)
      process.exit(130);
    });
  };

  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);

  // SIGUSR1: control-plane signal for skip/jump
  const { harnessDir, runId, getState, setState, getCurrentPhaseType, getChildPid } = ctx;
  process.on('SIGUSR1', () => {
    process.stderr.write('ℹ Received control signal (SIGUSR1). Applying pending action...\n');

    const runDir = path.join(harnessDir, runId);
    const pendingPath = path.join(runDir, 'pending-action.json');
    if (!fs.existsSync(pendingPath)) return;

    try {
      const raw = fs.readFileSync(pendingPath, 'utf-8');
      const action = JSON.parse(raw) as { action: string; phase?: number };
      const state = getState();

      if (action.action === 'skip') {
        state.phases[String(state.currentPhase)] = 'completed';
        state.currentPhase = state.currentPhase + 1;
        state.pendingAction = null;
      } else if (action.action === 'jump' && typeof action.phase === 'number') {
        for (let m = action.phase; m <= 7; m++) {
          state.phases[String(m)] = 'pending';
        }
        state.currentPhase = action.phase;
        state.pendingAction = null;
        state.pauseReason = null;
      }

      setState(state);
      writeState(runDir, state);
      fs.unlinkSync(pendingPath);

      // Write phase-scoped interrupt flag (immediate settle for PID-null case)
      const currentState = getState();
      const interruptFlagPath = path.join(runDir, `interrupted-${currentState.currentPhase}.flag`);
      fs.writeFileSync(interruptFlagPath, '1');

      // Phase-type-aware interruption
      const phaseType = getCurrentPhaseType();
      if (phaseType === 'interactive' && currentState.tmuxWorkspacePane) {
        sendKeysToPane(currentState.tmuxSession, currentState.tmuxWorkspacePane, 'C-c');
      } else {
        const childPid = getChildPid();
        if (childPid) {
          try { process.kill(childPid, 'SIGTERM'); } catch { /* ignore */ }
        }
      }
      process.stderr.write(`✓ Applied: ${action.action}${action.phase ? ` → phase ${action.phase}` : ''}. Phase loop re-entering.\n`);
    } catch {
      process.stderr.write('⚠️  Failed to apply pending action.\n');
    }
  });
}
