import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { writeState, readState, createInitialState } from '../src/state.js';
import type { HarnessState } from '../src/types.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'state-test-'));
}

function makeState(): HarnessState {
  return createInitialState('run-abc', 'test task', 'deadbeef', '/usr/local/bin/codex', false);
}

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
    const state = createInitialState('my-run', 'do the thing', 'abc123', '/bin/codex', true);

    expect(state.runId).toBe('my-run');
    expect(state.task).toBe('do the thing');
    expect(state.baseCommit).toBe('abc123');
    expect(state.implRetryBase).toBe('abc123');
    expect(state.codexPath).toBe('/bin/codex');
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
