import fs from 'fs';
import path from 'path';
import type { HarnessState, PhaseStatus } from './types.js';
import {
  PHASE_DEFAULTS,
  REQUIRED_PHASE_KEYS,
  MODEL_PRESETS,
  getLegacyPhaseDefaults,
  getPresetById,
} from './config.js';

const STATE_FILE = 'state.json';
const STATE_TMP_FILE = 'state.json.tmp';

const GATE_PHASES = ['2', '4', '7'] as const;

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
  if (raw.flow !== 'full' && raw.flow !== 'light') {
    raw.flow = 'full';
  }

  if (!raw.phasePresets || typeof raw.phasePresets !== 'object') {
    raw.phasePresets = {};
  }
  const legacyDefaults = getLegacyPhaseDefaults(raw.flow);
  // Note: the legacy `opus-max` → `opus-xhigh` migration (PR #22) was dropped
  // when the catalog re-introduced a real `opus-max` preset pinned to Opus 4.7
  // effort=`max`. Any state.json from before PR #22 that stored `opus-max`
  // now resolves to that real max-effort preset (i.e. resume cost may increase
  // vs. the PR #22 intent of xHigh). Users who want the old xHigh behavior on
  // resume must explicitly re-select `opus-xhigh` via `promptModelConfig`.
  for (const phase of REQUIRED_PHASE_KEYS) {
    const presetId = raw.phasePresets[phase];
    if (!presetId || !MODEL_PRESETS.find(p => p.id === presetId)) {
      raw.phasePresets[phase] = legacyDefaults[Number(phase)] ?? 'sonnet-high';
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
  if (raw.loggingEnabled === undefined) raw.loggingEnabled = false;
  if (raw.codexNoIsolate === undefined) raw.codexNoIsolate = false;
  if (!raw.phaseReopenSource || typeof raw.phaseReopenSource !== 'object') {
    raw.phaseReopenSource = { '1': null, '3': null, '5': null };
  }
  for (const key of ['1', '3', '5']) {
    if (raw.phaseReopenSource[key] === undefined) raw.phaseReopenSource[key] = null;
  }
  if (!raw.phaseCodexSessions || typeof raw.phaseCodexSessions !== 'object') {
    raw.phaseCodexSessions = { '2': null, '4': null, '7': null };
  }
  for (const key of GATE_PHASES) {
    const v = raw.phaseCodexSessions[key];
    if (v === undefined || v === null) {
      raw.phaseCodexSessions[key] = null;
      continue;
    }
    if (
      typeof v !== 'object' ||
      typeof v.sessionId !== 'string' ||
      v.sessionId.trim().length === 0 ||
      (v.runner !== 'claude' && v.runner !== 'codex') ||
      typeof v.model !== 'string' ||
      typeof v.effort !== 'string' ||
      (v.lastOutcome !== 'approve' && v.lastOutcome !== 'reject' && v.lastOutcome !== 'error')
    ) {
      raw.phaseCodexSessions[key] = null;
    }
  }
  const INTERACTIVE_PHASES = ['1', '3', '5'] as const;
  if (!raw.phaseClaudeSessions || typeof raw.phaseClaudeSessions !== 'object') {
    raw.phaseClaudeSessions = { '1': null, '3': null, '5': null };
  }
  for (const key of INTERACTIVE_PHASES) {
    const v = raw.phaseClaudeSessions[key];
    if (v === undefined || v === null) {
      raw.phaseClaudeSessions[key] = null;
      continue;
    }
    if (
      typeof v !== 'object' ||
      v.runner !== 'claude' ||
      typeof v.model !== 'string' ||
      typeof v.effort !== 'string'
    ) {
      raw.phaseClaudeSessions[key] = null;
    }
  }
  if (!('carryoverFeedback' in raw) || raw.carryoverFeedback === undefined) {
    raw.carryoverFeedback = null;
  }
  return raw as HarnessState;
}

/**
 * Invalidate Codex sessions for phases whose preset **lineage** (runner/model/
 * effort) changed. Spec §4.8 rule:
 *   - runner changed (codex ↔ claude or mismatch) → invalidate
 *   - same runner=codex but different model/effort → invalidate
 *   - identical lineage (even if preset ID alias shifted) → no-op
 * Deletes replay sidecars on invalidation; preserves feedback files (reopen
 * flow still reads them).
 */
export function invalidatePhaseSessionsOnPresetChange(
  state: HarnessState,
  prevPresets: Record<string, string>,
  runDir: string,
): void {
  for (const phase of GATE_PHASES) {
    const prevId = prevPresets[phase];
    const currId = state.phasePresets[phase];
    if (prevId === undefined || currId === undefined) continue;

    const prev = getPresetById(prevId);
    const curr = getPresetById(currId);
    // If either preset id is unknown (migration artifact), fall back to ID
    // comparison — safer to invalidate than to carry a stale session.
    const lineageChanged = (prev === undefined || curr === undefined)
      ? prevId !== currId
      : (prev.runner !== curr.runner ||
         (curr.runner === 'codex' && (prev.model !== curr.model || prev.effort !== curr.effort)));

    if (lineageChanged) {
      state.phaseCodexSessions[phase] = null;
      for (const suffix of ['raw.txt', 'result.json', 'error.md']) {
        const filename = `gate-${phase}-${suffix}`;
        try { fs.unlinkSync(path.join(runDir, filename)); } catch { /* ignore missing */ }
      }
    }
  }
}

/**
 * Invalidate Codex sessions for all gate phases at or after targetPhase (backward jump).
 * Deletes replay sidecars; preserves feedback files.
 */
export function invalidatePhaseSessionsOnJump(
  state: HarnessState,
  targetPhase: number,
  runDir: string,
): void {
  for (const phase of GATE_PHASES) {
    if (Number(phase) >= targetPhase) {
      state.phaseCodexSessions[phase] = null;
      for (const suffix of ['raw.txt', 'result.json', 'error.md']) {
        const filename = `gate-${phase}-${suffix}`;
        try { fs.unlinkSync(path.join(runDir, filename)); } catch { /* ignore missing */ }
      }
    }
  }
}

/**
 * Create a fresh initial state for a new run.
 */
export function createInitialState(
  runId: string,
  task: string,
  baseCommit: string,
  autoMode: boolean,
  loggingEnabled: boolean = false,
  flow: 'full' | 'light' = 'full',
  codexNoIsolate: boolean = false,
): HarnessState {
  const phasePresets: Record<string, string> = {};
  for (const phase of REQUIRED_PHASE_KEYS) {
    phasePresets[phase] = PHASE_DEFAULTS[Number(phase)] ?? 'sonnet-high';
  }

  const phases: Record<string, PhaseStatus> =
    flow === 'light'
      ? { '1': 'pending', '2': 'pending', '3': 'skipped', '4': 'skipped',
          '5': 'pending', '6': 'pending', '7': 'pending' }
      : { '1': 'pending', '2': 'pending', '3': 'pending', '4': 'pending',
          '5': 'pending', '6': 'pending', '7': 'pending' };

  const artifacts = flow === 'light'
    ? {
        spec: `docs/specs/${runId}-design.md`,
        plan: '',
        decisionLog: `.harness/${runId}/decisions.md`,
        checklist: `.harness/${runId}/checklist.json`,
        evalReport: `docs/process/evals/${runId}-eval.md`,
      }
    : {
        spec: `docs/specs/${runId}-design.md`,
        plan: `docs/plans/${runId}.md`,
        decisionLog: `.harness/${runId}/decisions.md`,
        checklist: `.harness/${runId}/checklist.json`,
        evalReport: `docs/process/evals/${runId}-eval.md`,
      };

  return {
    runId,
    flow,
    carryoverFeedback: null,
    currentPhase: 1,
    status: 'in_progress',
    autoMode,
    task,
    baseCommit,
    implRetryBase: baseCommit,
    codexPath: null,
    externalCommitsDetected: false,
    artifacts,
    phases,
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
    phaseCodexSessions: { '2': null, '4': null, '7': null },
    phaseClaudeSessions: { '1': null, '3': null, '5': null },
    lastWorkspacePid: null,
    lastWorkspacePidStartTime: null,
    tmuxSession: '',
    tmuxMode: 'dedicated',
    tmuxWindows: [],
    tmuxControlWindow: '',
    tmuxWorkspacePane: '',
    tmuxControlPane: '',
    loggingEnabled,
    phaseReopenSource: { '1': null, '3': null, '5': null },
    codexNoIsolate,
  };
}
