import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { writeState, readState, createInitialState, migrateState } from '../src/state.js';
import type { HarnessState } from '../src/types.js';
import { PHASE_DEFAULTS, getPhaseArtifactFiles, getReopenTarget, getRequiredPhaseKeys } from '../src/config.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'state-test-'));
}

function makeState(): HarnessState {
  return createInitialState('run-abc', 'test task', 'deadbeef', false);
}

describe('phaseCodexSessions (spec §4.1 / §5)', () => {
  it('createInitialState defaults all gate phases to null (in-flight crash invariant)', () => {
    const state = makeState();
    expect(state.phaseCodexSessions).toEqual({ '2': null, '4': null, '7': null });
  });

  it('survives writeState → readState round-trip', () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);
    const state = makeState();
    state.phaseCodexSessions['2'] = {
      sessionId: 'sess-gate2', runner: 'codex', model: 'gpt-5.4', effort: 'high', lastOutcome: 'reject',
    };
    state.phaseCodexSessions['7'] = {
      sessionId: 'sess-gate7', runner: 'codex', model: 'gpt-5.4', effort: 'high', lastOutcome: 'approve',
    };
    writeState(dir, state);
    const restored = readState(dir);
    expect(restored?.phaseCodexSessions['2']).toEqual(state.phaseCodexSessions['2']);
    expect(restored?.phaseCodexSessions['4']).toBeNull();
    expect(restored?.phaseCodexSessions['7']).toEqual(state.phaseCodexSessions['7']);
  });

  it('migrateState adds default phaseCodexSessions when missing', () => {
    const legacy = JSON.parse(JSON.stringify(makeState()));
    delete legacy.phaseCodexSessions;
    const migrated = migrateState(legacy);
    expect(migrated.phaseCodexSessions).toEqual({ '2': null, '4': null, '7': null });
  });

  it('migrateState discards malformed GateSessionInfo entries', () => {
    const base = makeState();
    (base as any).phaseCodexSessions = {
      '2': { sessionId: '', runner: 'codex', model: 'x', effort: 'high', lastOutcome: 'reject' },
      '4': null,
      '7': { sessionId: 'abc', runner: 'codex', model: 'x', effort: 'high', lastOutcome: 'invalid' },
    };
    const migrated = migrateState(base as any);
    expect(migrated.phaseCodexSessions['2']).toBeNull();
    expect(migrated.phaseCodexSessions['7']).toBeNull();
  });
});

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
});

describe('writeState', () => {
  it('creates state.json atomically and does not leave .tmp behind', () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);

    const state = makeState();
    writeState(dir, state);

    const statePath = path.join(dir, 'state.json');
    const tmpPath = path.join(dir, 'state.json.tmp');

    expect(fs.existsSync(statePath)).toBe(true);
    expect(fs.existsSync(tmpPath)).toBe(false);
  });
});

describe('readState', () => {
  it('returns parsed HarnessState from existing state.json', () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);

    const state = makeState();
    writeState(dir, state);

    const result = readState(dir);
    expect(result).not.toBeNull();
    expect(result?.runId).toBe('run-abc');
    expect(result?.task).toBe('test task');
    expect(result?.baseCommit).toBe('deadbeef');
    expect(result?.status).toBe('in_progress');
  });

  it('returns null when state.json is missing', () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);

    const result = readState(dir);
    expect(result).toBeNull();
  });

  it('throws for corrupted JSON in state.json', () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);

    const statePath = path.join(dir, 'state.json');
    fs.writeFileSync(statePath, '{ not valid json :::');

    expect(() => readState(dir)).toThrow('state.json is corrupted. Manual recovery required.');
  });

  it('restores from .tmp when state.json is absent but .tmp exists', () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);

    const state = makeState();
    const tmpPath = path.join(dir, 'state.json.tmp');
    const statePath = path.join(dir, 'state.json');

    // Write .tmp manually (simulating a crash after write but before rename)
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));

    expect(fs.existsSync(statePath)).toBe(false);
    expect(fs.existsSync(tmpPath)).toBe(true);

    const result = readState(dir);
    expect(result).not.toBeNull();
    expect(result?.runId).toBe('run-abc');

    // After recovery, state.json should exist, .tmp should be gone
    expect(fs.existsSync(statePath)).toBe(true);
    expect(fs.existsSync(tmpPath)).toBe(false);
  });
});

describe('createInitialState', () => {
  it('returns correct defaults', () => {
    const state = createInitialState('my-run', 'do the thing', 'abc123', true);

    expect(state.runId).toBe('my-run');
    expect(state.task).toBe('do the thing');
    expect(state.baseCommit).toBe('abc123');
    expect(state.implRetryBase).toBe('abc123');
    expect(state.codexPath).toBeNull();
    expect(state.autoMode).toBe(true);
    expect(state.currentPhase).toBe(1);
    expect(state.status).toBe('in_progress');
    expect(state.externalCommitsDetected).toBe(false);

    // All phases pending
    for (const phase of ['1', '2', '3', '4', '5', '6', '7']) {
      expect(state.phases[phase]).toBe('pending');
    }

    // Gate retries at 0
    expect(state.gateRetries['2']).toBe(0);
    expect(state.gateRetries['4']).toBe(0);
    expect(state.gateRetries['7']).toBe(0);
    expect(state.verifyRetries).toBe(0);

    // All commit anchors null
    expect(state.specCommit).toBeNull();
    expect(state.planCommit).toBeNull();
    expect(state.implCommit).toBeNull();
    expect(state.evalCommit).toBeNull();
    expect(state.verifiedAtHead).toBeNull();
    expect(state.pausedAtHead).toBeNull();

    // Pause/pending
    expect(state.pauseReason).toBeNull();
    expect(state.pendingAction).toBeNull();

    // Phase metadata
    expect(state.phaseOpenedAt['1']).toBeNull();
    expect(state.phaseOpenedAt['3']).toBeNull();
    expect(state.phaseOpenedAt['5']).toBeNull();
    expect(state.phaseAttemptId['1']).toBeNull();
    expect(state.phaseAttemptId['3']).toBeNull();
    expect(state.phaseAttemptId['5']).toBeNull();

    // Artifact paths derived from runId
    expect(state.artifacts.spec).toBe('docs/specs/my-run-design.md');
    expect(state.artifacts.plan).toBe('docs/plans/my-run.md');
    expect(state.artifacts.decisionLog).toBe('.harness/my-run/decisions.md');
    expect(state.artifacts.checklist).toBe('.harness/my-run/checklist.json');
    expect(state.artifacts.evalReport).toBe('docs/process/evals/my-run-eval.md');
  });
});

describe('createInitialState (updated)', () => {
  it('sets codexPath to null', () => {
    const state = createInitialState('run-1', 'task', 'abc123', false);
    expect(state.codexPath).toBeNull();
  });

  it('initializes phasePresets from PHASE_DEFAULTS', () => {
    const state = createInitialState('run-1', 'task', 'abc123', false);
    expect(state.phasePresets['1']).toBe('opus-max');
    expect(state.phasePresets['5']).toBe('sonnet-high');
  });

  it('initializes phaseReopenFlags to false', () => {
    const state = createInitialState('run-1', 'task', 'abc123', false);
    expect(state.phaseReopenFlags).toEqual({ '1': false, '3': false, '5': false });
  });

  it('initializes lastWorkspacePid fields to null', () => {
    const state = createInitialState('run-1', 'task', 'abc123', false);
    expect(state.lastWorkspacePid).toBeNull();
    expect(state.lastWorkspacePidStartTime).toBeNull();
  });
});

describe('migrateState', () => {
  it('backfills missing phasePresets', () => {
    const raw = { runId: 'test' };
    const migrated = migrateState(raw);
    for (const key of ['1', '2', '3', '4', '5', '7']) {
      expect(migrated.phasePresets[key]).toBe(PHASE_DEFAULTS[Number(key)]);
    }
  });

  it('backfills individual missing phase keys', () => {
    const raw = { phasePresets: { '1': 'opus-max' } };
    const migrated = migrateState(raw);
    expect(migrated.phasePresets['3']).toBe('sonnet-high');
  });

  it('replaces invalid preset IDs with defaults', () => {
    const raw = { phasePresets: { '1': 'nonexistent', '2': 'codex-high' } };
    const migrated = migrateState(raw);
    expect(migrated.phasePresets['1']).toBe('opus-max');
    expect(migrated.phasePresets['2']).toBe('codex-high');
  });

  it('backfills lastWorkspacePid and phaseReopenFlags', () => {
    const migrated = migrateState({});
    expect(migrated.lastWorkspacePid).toBeNull();
    expect(migrated.lastWorkspacePidStartTime).toBeNull();
    expect(migrated.phaseReopenFlags).toEqual({ '1': false, '3': false, '5': false });
  });

  it('sets codexPath to null if missing', () => {
    const migrated = migrateState({});
    expect(migrated.codexPath).toBeNull();
  });

  it('preserves phaseReopenFlags values through write/read cycle', () => {
    const state = createInitialState('run-1', 'task', 'abc', false);
    state.phaseReopenFlags['1'] = true;
    // Simulate JSON round-trip
    const raw = JSON.parse(JSON.stringify(state));
    const migrated = migrateState(raw);
    expect(migrated.phaseReopenFlags['1']).toBe(true);
    expect(migrated.phaseReopenFlags['3']).toBe(false);
  });
});

describe('flow + carryoverFeedback (light-flow spec)', () => {
  it('createInitialState defaults flow to "full" and carryoverFeedback to null', () => {
    const state = createInitialState('r1', 't', 'base', false);
    expect(state.flow).toBe('full');
    expect(state.carryoverFeedback).toBeNull();
    expect(state.phases['2']).toBe('pending');
    expect(state.phases['3']).toBe('pending');
    expect(state.phases['4']).toBe('pending');
  });

  it('createInitialState with flow="light" marks phases 2/3/4 as "skipped"', () => {
    const state = createInitialState('r1', 't', 'base', false, false, 'light');
    expect(state.flow).toBe('light');
    expect(state.phases['1']).toBe('pending');
    expect(state.phases['2']).toBe('skipped');
    expect(state.phases['3']).toBe('skipped');
    expect(state.phases['4']).toBe('skipped');
    expect(state.phases['5']).toBe('pending');
    expect(state.phases['6']).toBe('pending');
    expect(state.phases['7']).toBe('pending');
    expect(state.artifacts.plan).toBe('');
  });

  it('migrateState backfills missing flow as "full" and carryoverFeedback as null', () => {
    const base = createInitialState('r1', 't', 'base', false);
    const raw: any = JSON.parse(JSON.stringify(base));
    delete raw.flow;
    delete raw.carryoverFeedback;
    const migrated = migrateState(raw);
    expect(migrated.flow).toBe('full');
    expect(migrated.carryoverFeedback).toBeNull();
  });

  it('migrateState preserves an existing light flow value', () => {
    const base = createInitialState('r1', 't', 'base', false, false, 'light');
    const raw = JSON.parse(JSON.stringify(base));
    const migrated = migrateState(raw);
    expect(migrated.flow).toBe('light');
    expect(migrated.carryoverFeedback).toBeNull();
  });

  it('carryoverFeedback survives writeState → readState round-trip', () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);
    const state = createInitialState('r1', 't', 'base', false, false, 'light');
    state.carryoverFeedback = {
      sourceGate: 7,
      paths: ['.harness/r1/gate-7-feedback.md'],
      deliverToPhase: 5,
    };
    writeState(dir, state);
    const restored = readState(dir);
    expect(restored?.carryoverFeedback).toEqual(state.carryoverFeedback);
  });
});

describe('getPhaseArtifactFiles (ADR-13)', () => {
  it('full + phase 1 → spec + decisionLog', () => {
    expect(getPhaseArtifactFiles('full', 1)).toEqual(['spec', 'decisionLog']);
  });
  it('full + phase 3 → plan + checklist', () => {
    expect(getPhaseArtifactFiles('full', 3)).toEqual(['plan', 'checklist']);
  });
  it('light + phase 1 → spec + decisionLog + checklist', () => {
    expect(getPhaseArtifactFiles('light', 1)).toEqual(['spec', 'decisionLog', 'checklist']);
  });
  it('light + phase 3 → empty (phase is skipped)', () => {
    expect(getPhaseArtifactFiles('light', 3)).toEqual([]);
  });
  it('any flow + phase 5 → empty (no on-disk artifact set)', () => {
    expect(getPhaseArtifactFiles('full', 5)).toEqual([]);
    expect(getPhaseArtifactFiles('light', 5)).toEqual([]);
  });
});

describe('getRequiredPhaseKeys (ADR-5 / inner.ts propagation)', () => {
  it('full flow returns 1/2/3/4/5/7', () => {
    expect([...getRequiredPhaseKeys('full')]).toEqual(['1', '2', '3', '4', '5', '7']);
  });
  it('light flow returns 1/5/7 only', () => {
    expect([...getRequiredPhaseKeys('light')]).toEqual(['1', '5', '7']);
  });
});

describe('getReopenTarget (ADR-4)', () => {
  it('full + gate 2 → phase 1', () => {
    expect(getReopenTarget('full', 2)).toBe(1);
  });
  it('full + gate 4 → phase 3', () => {
    expect(getReopenTarget('full', 4)).toBe(3);
  });
  it('full + gate 7 → phase 5 (unchanged from current behaviour)', () => {
    expect(getReopenTarget('full', 7)).toBe(5);
  });
  it('light + gate 7 → phase 1 (design combined doc is re-authored)', () => {
    expect(getReopenTarget('light', 7)).toBe(1);
  });
});
