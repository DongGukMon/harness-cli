import fs from 'fs';
import path from 'path';
import type { HarnessState } from './types.js';
import { PHASE_DEFAULTS, REQUIRED_PHASE_KEYS, MODEL_PRESETS } from './config.js';

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
    return migrateState(JSON.parse(raw));
  } catch {
    throw new Error('state.json is corrupted. Manual recovery required.');
  }
}

/**
 * Migrate a raw state object (potentially from an older version) to the current HarnessState shape.
 */
export function migrateState(raw: any): HarnessState {
  if (!raw.phasePresets || typeof raw.phasePresets !== 'object') {
    raw.phasePresets = {};
  }
  for (const phase of REQUIRED_PHASE_KEYS) {
    const presetId = raw.phasePresets[phase];
    if (!presetId || !MODEL_PRESETS.find(p => p.id === presetId)) {
      raw.phasePresets[phase] = PHASE_DEFAULTS[Number(phase)] ?? 'sonnet-high';
    }
  }
  if (raw.lastWorkspacePid === undefined) raw.lastWorkspacePid = null;
  if (raw.lastWorkspacePidStartTime === undefined) raw.lastWorkspacePidStartTime = null;
  if (raw.codexPath === undefined) raw.codexPath = null;
  if (!raw.phaseReopenFlags || typeof raw.phaseReopenFlags !== 'object') {
    raw.phaseReopenFlags = { '1': false, '3': false, '5': false };
  }
  for (const key of ['1', '3', '5']) {
    if (raw.phaseReopenFlags[key] === undefined) raw.phaseReopenFlags[key] = false;
  }
  return raw as HarnessState;
}

/**
 * Create a fresh initial state for a new run.
 */
export function createInitialState(
  runId: string,
  task: string,
  baseCommit: string,
  autoMode: boolean
): HarnessState {
  const phasePresets: Record<string, string> = {};
  for (const phase of REQUIRED_PHASE_KEYS) {
    phasePresets[phase] = PHASE_DEFAULTS[Number(phase)] ?? 'sonnet-high';
  }

  return {
    runId,
    currentPhase: 1,
    status: 'in_progress',
    autoMode,
    task,
    baseCommit,
    implRetryBase: baseCommit,
    codexPath: null,
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
    phasePresets,
    phaseReopenFlags: { '1': false, '3': false, '5': false },
    lastWorkspacePid: null,
    lastWorkspacePidStartTime: null,
    tmuxSession: '',
    tmuxMode: 'dedicated',
    tmuxWindows: [],
    tmuxControlWindow: '',
    tmuxWorkspacePane: '',
    tmuxControlPane: '',
  };
}
