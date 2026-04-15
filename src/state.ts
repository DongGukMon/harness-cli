import fs from 'fs';
import path from 'path';
import type { HarnessState } from './types.js';

const STATE_FILE = 'state.json';
const STATE_TMP_FILE = 'state.json.tmp';

/**
 * Write state atomically: write to .tmp → fsync → rename
 */
export function writeState(runDir: string, state: HarnessState): void {
  const statePath = path.join(runDir, STATE_FILE);
  const tmpPath = path.join(runDir, STATE_TMP_FILE);

  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));

  const fd = fs.openSync(tmpPath, 'r+');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  fs.renameSync(tmpPath, statePath);
}

/**
 * Read state from runDir.
 * - Returns null if file missing.
 * - Throws on corrupt JSON.
 * - If state.json missing but state.json.tmp exists, restore from .tmp first.
 */
export function readState(runDir: string): HarnessState | null {
  const statePath = path.join(runDir, STATE_FILE);
  const tmpPath = path.join(runDir, STATE_TMP_FILE);

  const stateExists = fs.existsSync(statePath);
  const tmpExists = fs.existsSync(tmpPath);

  if (!stateExists && !tmpExists) {
    return null;
  }

  if (!stateExists && tmpExists) {
    fs.renameSync(tmpPath, statePath);
  }

  const raw = fs.readFileSync(statePath, 'utf-8');
  try {
    return JSON.parse(raw) as HarnessState;
  } catch {
    throw new Error('state.json is corrupted. Manual recovery required.');
  }
}

/**
 * Create a fresh initial state for a new run.
 */
export function createInitialState(
  runId: string,
  task: string,
  baseCommit: string,
  codexPath: string,
  autoMode: boolean
): HarnessState {
  return {
    runId,
    currentPhase: 1,
    status: 'in_progress',
    autoMode,
    task,
    baseCommit,
    implRetryBase: baseCommit,
    codexPath,
    externalCommitsDetected: false,
    artifacts: {
      spec: `docs/specs/${runId}-design.md`,
      plan: `docs/plans/${runId}.md`,
      decisionLog: `.harness/${runId}/decisions.md`,
      checklist: `.harness/${runId}/checklist.json`,
      evalReport: `docs/process/evals/${runId}-eval.md`,
    },
    phases: {
      '1': 'pending',
      '2': 'pending',
      '3': 'pending',
      '4': 'pending',
      '5': 'pending',
      '6': 'pending',
      '7': 'pending',
    },
    gateRetries: {
      '2': 0,
      '4': 0,
      '7': 0,
    },
    verifyRetries: 0,
    pauseReason: null,
    specCommit: null,
    planCommit: null,
    implCommit: null,
    evalCommit: null,
    verifiedAtHead: null,
    pausedAtHead: null,
    pendingAction: null,
    phaseOpenedAt: {
      '1': null,
      '3': null,
      '5': null,
    },
    phaseAttemptId: {
      '1': null,
      '3': null,
      '5': null,
    },
    tmuxSession: '',
    tmuxMode: 'dedicated',
    tmuxWindows: [],
    tmuxControlWindow: '',
    tmuxWorkspacePane: '',
    tmuxControlPane: '',
  };
}
