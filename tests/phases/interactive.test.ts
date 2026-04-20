import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import {
  preparePhase,
  checkSentinelFreshness,
  validatePhaseArtifacts,
} from '../../src/phases/interactive.js';
import { createInitialState, readState } from '../../src/state.js';
import type { HarnessState } from '../../src/types.js';

// ─── Module mocks for runInteractivePhase ordering test ─────────────────────

vi.mock('../../src/runners/codex.js', () => ({
  runCodexInteractive: vi.fn(async () => ({ status: 'completed', exitCode: 0 })),
}));
vi.mock('../../src/runners/codex-isolation.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/runners/codex-isolation.js')>(
    '../../src/runners/codex-isolation.js',
  );
  return {
    ...actual,
    ensureCodexIsolation: vi.fn((runDir: string) => `${runDir}/codex-home`),
  };
});

vi.mock('../../src/tmux.js', () => ({
  sendKeysToPane: vi.fn(),
  pollForPidFile: vi.fn().mockResolvedValue(12345),
}));

vi.mock('../../src/process.js', () => ({
  isPidAlive: vi.fn(() => false),
  getProcessStartTime: vi.fn(() => 1234567890),
  killProcessGroup: vi.fn(async () => {}),
}));

vi.mock('../../src/lock.js', () => ({
  updateLockChild: vi.fn(),
  clearLockChild: vi.fn(),
}));

vi.mock('../../src/context/assembler.js', () => ({
  assembleInteractivePrompt: vi.fn().mockReturnValue('mocked prompt content'),
}));

// ─── helpers ────────────────────────────────────────────────────────────────

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
});

function makeTmpDir(prefix = 'interactive-test-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function makeState(overrides: Partial<HarnessState> = {}): HarnessState {
  const base = createInitialState(
    'test-run',
    '/tasks/test-task.md',
    'deadbeef',
    false
  );
  const merged = {
    ...base,
    tmuxWorkspacePane: '%1',
    tmuxControlPane: '%0',
    ...overrides,
  };
  // Keep trackedRepos[0] in sync with top-level fields so syncLegacyMirror
  // (called by writeState) does not overwrite them back to base values.
  if (merged.trackedRepos?.[0]) {
    merged.trackedRepos = [{
      ...merged.trackedRepos[0],
      baseCommit: merged.baseCommit,
      implRetryBase: merged.implRetryBase,
      implHead: merged.implCommit,
    }];
  }
  return merged;
}

/** Create a minimal git repo and return its path (registered for cleanup). */
function createTestRepo(): string {
  const dir = makeTmpDir('interactive-repo-');
  execSync('git init && git commit --allow-empty -m "init"', { cwd: dir });
  return dir;
}

// ─── preparePhase: Pre-spawn cleanup ────────────────────────────────────────

describe('preparePhase — sentinel deletion', () => {
  it('deletes existing sentinel file for Phase 1 before spawn', () => {
    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();
    const cwd = makeTmpDir();

    const sentinelPath = path.join(runDir, 'phase-1.done');
    fs.writeFileSync(sentinelPath, 'old-attempt-id');
    expect(fs.existsSync(sentinelPath)).toBe(true);

    const state = makeState();
    preparePhase(1, state, harnessDir, runDir, cwd);

    expect(fs.existsSync(sentinelPath)).toBe(false);
  });

  it('deletes existing sentinel file for Phase 3 before spawn', () => {
    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();
    const cwd = makeTmpDir();

    const sentinelPath = path.join(runDir, 'phase-3.done');
    fs.writeFileSync(sentinelPath, 'stale-id');

    const state = makeState();
    preparePhase(3, state, harnessDir, runDir, cwd);

    expect(fs.existsSync(sentinelPath)).toBe(false);
  });

  it('is idempotent when sentinel does not exist', () => {
    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();
    const cwd = makeTmpDir();

    const sentinelPath = path.join(runDir, 'phase-1.done');
    expect(fs.existsSync(sentinelPath)).toBe(false);

    const state = makeState();
    // Should not throw
    expect(() => preparePhase(1, state, harnessDir, runDir, cwd)).not.toThrow();
    expect(fs.existsSync(sentinelPath)).toBe(false);
  });
});

describe('preparePhase — Phase 1/3 artifact deletion', () => {
  it('deletes Phase 1 artifacts (spec, decisionLog) before spawn', () => {
    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();
    const cwd = makeTmpDir();
    const state = makeState();

    // Create artifact files in cwd
    const specAbsPath = path.join(cwd, state.artifacts.spec);
    const decisionAbsPath = path.join(cwd, state.artifacts.decisionLog);
    fs.mkdirSync(path.dirname(specAbsPath), { recursive: true });
    fs.mkdirSync(path.dirname(decisionAbsPath), { recursive: true });
    fs.writeFileSync(specAbsPath, '# Old spec');
    fs.writeFileSync(decisionAbsPath, '# Old decisions');

    expect(fs.existsSync(specAbsPath)).toBe(true);
    expect(fs.existsSync(decisionAbsPath)).toBe(true);

    preparePhase(1, state, harnessDir, runDir, cwd);

    expect(fs.existsSync(specAbsPath)).toBe(false);
    expect(fs.existsSync(decisionAbsPath)).toBe(false);
  });

  it('deletes Phase 3 artifacts (plan, checklist) before spawn', () => {
    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();
    const cwd = makeTmpDir();
    const state = makeState();

    const planAbsPath = path.join(cwd, state.artifacts.plan);
    const checklistAbsPath = path.join(cwd, state.artifacts.checklist);
    fs.mkdirSync(path.dirname(planAbsPath), { recursive: true });
    fs.mkdirSync(path.dirname(checklistAbsPath), { recursive: true });
    fs.writeFileSync(planAbsPath, '# Old plan');
    fs.writeFileSync(checklistAbsPath, '# Old checklist');

    preparePhase(3, state, harnessDir, runDir, cwd);

    expect(fs.existsSync(planAbsPath)).toBe(false);
    expect(fs.existsSync(checklistAbsPath)).toBe(false);
  });

  it('does not delete artifacts for Phase 5', () => {
    const repoDir = createTestRepo();
    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();

    const state = makeState();
    // Set trackedRepos[0].path so getHead(r.path) works in Phase 5 preparePhase
    state.trackedRepos = [{ path: repoDir, baseCommit: state.baseCommit, implRetryBase: state.implRetryBase, implHead: null }];

    // Phase 5 should not attempt to delete spec/plan/etc.
    // Create a file that would be deleted if cleanup ran incorrectly
    const specAbsPath = path.join(repoDir, state.artifacts.spec);
    fs.mkdirSync(path.dirname(specAbsPath), { recursive: true });
    fs.writeFileSync(specAbsPath, '# Existing spec');

    preparePhase(5, state, harnessDir, runDir, repoDir);

    // spec should still exist because Phase 5 doesn't delete Phase 1 artifacts
    expect(fs.existsSync(specAbsPath)).toBe(true);
  });
});

// ─── preparePhase: phaseAttemptId ───────────────────────────────────────────

describe('preparePhase — phaseAttemptId generation', () => {
  it('generates a UUID v4 and saves it to state.phaseAttemptId for Phase 1', () => {
    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();
    const cwd = makeTmpDir();

    const state = makeState();
    const newState = preparePhase(1, state, harnessDir, runDir, cwd);

    const attemptId = newState.phaseAttemptId['1'];
    expect(typeof attemptId).toBe('string');
    // UUID v4 format
    expect(attemptId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it('preserves pre-set phaseAttemptId on subsequent calls (respects caller-assigned ID)', () => {
    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();
    const cwd = makeTmpDir();

    const state = makeState();
    preparePhase(1, state, harnessDir, runDir, cwd);
    const firstId = state.phaseAttemptId['1'];
    // Second call: phaseAttemptId already set, so preparePhase preserves it
    preparePhase(1, state, harnessDir, runDir, cwd);
    const secondId = state.phaseAttemptId['1'];

    expect(firstId).toBeDefined();
    expect(firstId).toBe(secondId); // preserved, not regenerated
  });

  it('preserves phaseAttemptId for other phases when setting Phase 3', () => {
    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();
    const cwd = makeTmpDir();

    const state = makeState({
      phaseAttemptId: { '1': 'existing-phase1-id', '3': null, '5': null },
    });
    const newState = preparePhase(3, state, harnessDir, runDir, cwd);

    // Phase 1 id should remain unchanged
    expect(newState.phaseAttemptId['1']).toBe('existing-phase1-id');
    // Phase 3 should have a new UUID
    expect(newState.phaseAttemptId['3']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it('persists phaseAttemptId to state.json in runDir', () => {
    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();
    const cwd = makeTmpDir();

    const state = makeState();
    const newState = preparePhase(1, state, harnessDir, runDir, cwd);

    const savedState = readState(runDir);
    expect(savedState).not.toBeNull();
    expect(savedState!.phaseAttemptId['1']).toBe(newState.phaseAttemptId['1']);
  });
});

// ─── preparePhase: phaseOpenedAt ────────────────────────────────────────────

describe('preparePhase — phaseOpenedAt timestamp', () => {
  it('sets phaseOpenedAt with 1-second truncation (ms-precision, second-aligned)', () => {
    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();
    const cwd = makeTmpDir();

    const beforeMs = Date.now();
    const state = makeState();
    const newState = preparePhase(1, state, harnessDir, runDir, cwd);
    const afterMs = Date.now();

    const openedAt = newState.phaseOpenedAt['1'];
    expect(openedAt).not.toBeNull();

    // Must be within the time window
    const truncatedBefore = Math.floor(beforeMs / 1000) * 1000;
    const truncatedAfter = Math.floor(afterMs / 1000) * 1000;
    expect(openedAt!).toBeGreaterThanOrEqual(truncatedBefore);
    expect(openedAt!).toBeLessThanOrEqual(truncatedAfter + 1000); // allow for clock advance

    // Must be second-aligned (no sub-second precision)
    expect(openedAt! % 1000).toBe(0);
  });

  it('persists phaseOpenedAt to state.json', () => {
    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();
    const cwd = makeTmpDir();

    const state = makeState();
    const newState = preparePhase(3, state, harnessDir, runDir, cwd);

    const savedState = readState(runDir);
    expect(savedState).not.toBeNull();
    expect(savedState!.phaseOpenedAt['3']).toBe(newState.phaseOpenedAt['3']);
  });
});

// ─── preparePhase: Phase 5 implRetryBase ────────────────────────────────────

describe('preparePhase — Phase 5 implRetryBase', () => {
  it('updates implRetryBase to HEAD for Phase 5', () => {
    const repoDir = createTestRepo();
    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();

    const head = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
    const state = makeState({ implRetryBase: 'old-base-sha' });
    // Set trackedRepos[0].path so getHead(r.path) works
    state.trackedRepos = [{ path: repoDir, baseCommit: 'old-base-sha', implRetryBase: 'old-base-sha', implHead: null }];

    const newState = preparePhase(5, state, harnessDir, runDir, repoDir);

    expect(newState.implRetryBase).toBe(head);
    expect(newState.implRetryBase).not.toBe('old-base-sha');
  });

  it('does not change implRetryBase for Phase 1', () => {
    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();
    const cwd = makeTmpDir();

    const state = makeState({ implRetryBase: 'original-base' });
    const newState = preparePhase(1, state, harnessDir, runDir, cwd);

    expect(newState.implRetryBase).toBe('original-base');
  });

  it('does not change implRetryBase for Phase 3', () => {
    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();
    const cwd = makeTmpDir();

    const state = makeState({ implRetryBase: 'base-from-start' });
    const newState = preparePhase(3, state, harnessDir, runDir, cwd);

    expect(newState.implRetryBase).toBe('base-from-start');
  });

  it('preserves trackedRepos[].implHead across phase 5 entries (symmetric reopen)', () => {
    // Prior Phase 5 succeeded and recorded implHead. Phase 6 then advanced HEAD.
    // On gate-7 REJECT reopen, preparePhase must NOT wipe implHead — otherwise
    // a rev-invariant reopen (zero new commits) can never validate, contradicting
    // the Phase 5 prompt invariant.
    const repoDir = createTestRepo();
    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();
    const headBeforeReopen = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();

    const state = makeState();
    state.trackedRepos = [{
      path: repoDir,
      baseCommit: headBeforeReopen,
      implRetryBase: 'old-base-before-verify',
      implHead: 'sha-from-prior-impl-phase',
    }];

    preparePhase(5, state, harnessDir, runDir, repoDir);

    // implRetryBase rebased to current HEAD (existing behavior) …
    expect(state.trackedRepos[0].implRetryBase).toBe(headBeforeReopen);
    // … but implHead must survive, so validatePhaseArtifacts' zero-commit
    // reopen branch can still accept a rev-invariant reopen.
    expect(state.trackedRepos[0].implHead).toBe('sha-from-prior-impl-phase');
  });
});

// ─── checkSentinelFreshness ──────────────────────────────────────────────────

describe('checkSentinelFreshness', () => {
  it('returns "fresh" when sentinel content matches expectedAttemptId', () => {
    const dir = makeTmpDir();
    const sentinelPath = path.join(dir, 'phase-1.done');
    const attemptId = 'abc-123-uuid';
    fs.writeFileSync(sentinelPath, attemptId);

    const result = checkSentinelFreshness(sentinelPath, attemptId);
    expect(result).toBe('fresh');
  });

  it('returns "fresh" when sentinel content matches with trailing newline', () => {
    const dir = makeTmpDir();
    const sentinelPath = path.join(dir, 'phase-1.done');
    const attemptId = 'abc-123-uuid';
    fs.writeFileSync(sentinelPath, attemptId + '\n');

    const result = checkSentinelFreshness(sentinelPath, attemptId);
    expect(result).toBe('fresh');
  });

  it('returns "stale" when sentinel content does not match expectedAttemptId', () => {
    const dir = makeTmpDir();
    const sentinelPath = path.join(dir, 'phase-1.done');
    fs.writeFileSync(sentinelPath, 'different-attempt-id');

    const result = checkSentinelFreshness(sentinelPath, 'expected-attempt-id');
    expect(result).toBe('stale');
  });

  it('returns "stale" when sentinel content is empty', () => {
    const dir = makeTmpDir();
    const sentinelPath = path.join(dir, 'phase-1.done');
    fs.writeFileSync(sentinelPath, '');

    const result = checkSentinelFreshness(sentinelPath, 'some-uuid');
    expect(result).toBe('stale');
  });

  it('returns "missing" when sentinel file does not exist', () => {
    const dir = makeTmpDir();
    const sentinelPath = path.join(dir, 'phase-1.done');

    const result = checkSentinelFreshness(sentinelPath, 'some-uuid');
    expect(result).toBe('missing');
  });

  it('returns "missing" for non-existent directory path', () => {
    const sentinelPath = '/tmp/nonexistent-harness-dir/phase-1.done';

    const result = checkSentinelFreshness(sentinelPath, 'any-id');
    expect(result).toBe('missing');
  });
});

// ─── validatePhaseArtifacts ──────────────────────────────────────────────────

describe('validatePhaseArtifacts — Phase 1', () => {
  it('returns true when both spec and decisionLog are non-empty and recent', () => {
    const cwd = makeTmpDir();
    const state = makeState({
      phaseOpenedAt: { '1': Math.floor(Date.now() / 1000) * 1000 - 5000, '3': null, '5': null },
    });

    const specPath = path.join(cwd, state.artifacts.spec);
    const decPath = path.join(cwd, state.artifacts.decisionLog);
    fs.mkdirSync(path.dirname(specPath), { recursive: true });
    fs.mkdirSync(path.dirname(decPath), { recursive: true });
    fs.writeFileSync(specPath, '# Spec content\n\n## Complexity\n\nMedium\n');
    fs.writeFileSync(decPath, '# Decisions');

    const result = validatePhaseArtifacts(1, state, cwd, cwd);
    expect(result).toBe(true);
  });

  it('returns false when spec file does not exist', () => {
    const cwd = makeTmpDir();
    const state = makeState({
      phaseOpenedAt: { '1': Date.now() - 10000, '3': null, '5': null },
    });

    // Only create decisionLog, not spec
    const decPath = path.join(cwd, state.artifacts.decisionLog);
    fs.mkdirSync(path.dirname(decPath), { recursive: true });
    fs.writeFileSync(decPath, '# Decisions');

    const result = validatePhaseArtifacts(1, state, cwd, cwd);
    expect(result).toBe(false);
  });

  it('returns false when spec file is empty', () => {
    const cwd = makeTmpDir();
    const state = makeState({
      phaseOpenedAt: { '1': Date.now() - 10000, '3': null, '5': null },
    });

    const specPath = path.join(cwd, state.artifacts.spec);
    const decPath = path.join(cwd, state.artifacts.decisionLog);
    fs.mkdirSync(path.dirname(specPath), { recursive: true });
    fs.mkdirSync(path.dirname(decPath), { recursive: true });
    fs.writeFileSync(specPath, ''); // empty!
    fs.writeFileSync(decPath, '# Decisions');

    const result = validatePhaseArtifacts(1, state, cwd, cwd);
    expect(result).toBe(false);
  });

  it('accepts rev-invariant artifacts when mtime < phaseOpenedAt (reopen semantic)', () => {
    // Reopen scenario: Claude decides the artifact is rev-invariant and does
    // not touch it. Sentinel freshness (attemptId match, checked elsewhere) is
    // the real safety gate. Validator must accept. Regression guard for the
    // P1-NEW mtime staleness bug observed in gate-convergence dogfood Round 2.
    const cwd = makeTmpDir();
    const futureOpenedAt = (Math.floor(Date.now() / 1000) + 3600) * 1000; // 1h from now
    const state = makeState({
      phaseOpenedAt: { '1': futureOpenedAt, '3': null, '5': null },
    });

    const specPath = path.join(cwd, state.artifacts.spec);
    const decPath = path.join(cwd, state.artifacts.decisionLog);
    fs.mkdirSync(path.dirname(specPath), { recursive: true });
    fs.mkdirSync(path.dirname(decPath), { recursive: true });
    fs.writeFileSync(specPath, '# Spec\n\n## Complexity\n\nMedium\n');
    fs.writeFileSync(decPath, '# Decisions');

    const result = validatePhaseArtifacts(1, state, cwd, cwd);
    expect(result).toBe(true);
  });

  // ── Complexity validator cases (spec R5: applies to full + light flows) ──

  it('rejects full-flow spec missing the "## Complexity" section', () => {
    const cwd = makeTmpDir();
    const state = makeState({
      phaseOpenedAt: { '1': Math.floor(Date.now() / 1000) * 1000 - 5000, '3': null, '5': null },
    });
    const specPath = path.join(cwd, state.artifacts.spec);
    const decPath = path.join(cwd, state.artifacts.decisionLog);
    fs.mkdirSync(path.dirname(specPath), { recursive: true });
    fs.mkdirSync(path.dirname(decPath), { recursive: true });
    fs.writeFileSync(specPath, '# Spec content\n\nno complexity header\n');
    fs.writeFileSync(decPath, '# Decisions');
    expect(validatePhaseArtifacts(1, state, cwd, cwd)).toBe(false);
  });

  it('rejects full-flow spec with invalid Complexity token (e.g. "ExtraLarge")', () => {
    const cwd = makeTmpDir();
    const state = makeState({
      phaseOpenedAt: { '1': Math.floor(Date.now() / 1000) * 1000 - 5000, '3': null, '5': null },
    });
    const specPath = path.join(cwd, state.artifacts.spec);
    const decPath = path.join(cwd, state.artifacts.decisionLog);
    fs.mkdirSync(path.dirname(specPath), { recursive: true });
    fs.mkdirSync(path.dirname(decPath), { recursive: true });
    fs.writeFileSync(specPath, '# Spec\n\n## Complexity\n\nExtraLarge\n');
    fs.writeFileSync(decPath, '# Decisions');
    expect(validatePhaseArtifacts(1, state, cwd, cwd)).toBe(false);
  });

  it('accepts full-flow spec with Large bucket + rationale', () => {
    const cwd = makeTmpDir();
    const state = makeState({
      phaseOpenedAt: { '1': Math.floor(Date.now() / 1000) * 1000 - 5000, '3': null, '5': null },
    });
    const specPath = path.join(cwd, state.artifacts.spec);
    const decPath = path.join(cwd, state.artifacts.decisionLog);
    fs.mkdirSync(path.dirname(specPath), { recursive: true });
    fs.mkdirSync(path.dirname(decPath), { recursive: true });
    fs.writeFileSync(specPath, '# Spec\n\n## Complexity\n\nLarge — multi-file refactor\n');
    fs.writeFileSync(decPath, '# Decisions');
    expect(validatePhaseArtifacts(1, state, cwd, cwd)).toBe(true);
  });
});

describe('validatePhaseArtifacts — Phase 3', () => {
  it('returns true when plan and checklist are non-empty, valid schema, and recent', () => {
    const cwd = makeTmpDir();
    const state = makeState({
      phaseOpenedAt: { '1': null, '3': Math.floor(Date.now() / 1000) * 1000 - 5000, '5': null },
    });

    const planPath = path.join(cwd, state.artifacts.plan);
    const checklistPath = path.join(cwd, state.artifacts.checklist);
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.mkdirSync(path.dirname(checklistPath), { recursive: true });
    fs.writeFileSync(planPath, '# Plan content');
    // Checklist must match spec schema: { checks: [{ name, command }] }
    fs.writeFileSync(
      checklistPath,
      JSON.stringify({ checks: [{ name: 'test', command: 'echo ok' }] })
    );

    const result = validatePhaseArtifacts(3, state, cwd, cwd);
    expect(result).toBe(true);
  });

  it('returns false when checklist schema is invalid', () => {
    const cwd = makeTmpDir();
    const state = makeState({
      phaseOpenedAt: { '1': null, '3': Math.floor(Date.now() / 1000) * 1000 - 5000, '5': null },
    });

    const planPath = path.join(cwd, state.artifacts.plan);
    const checklistPath = path.join(cwd, state.artifacts.checklist);
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.mkdirSync(path.dirname(checklistPath), { recursive: true });
    fs.writeFileSync(planPath, '# Plan content');
    fs.writeFileSync(checklistPath, '{ "not": "valid schema" }');

    const result = validatePhaseArtifacts(3, state, cwd, cwd);
    expect(result).toBe(false);
  });

  it('returns false when checklist is missing', () => {
    const cwd = makeTmpDir();
    const state = makeState({
      phaseOpenedAt: { '1': null, '3': Date.now() - 10000, '5': null },
    });

    const planPath = path.join(cwd, state.artifacts.plan);
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, '# Plan');
    // checklist not written

    const result = validatePhaseArtifacts(3, state, cwd, cwd);
    expect(result).toBe(false);
  });

  it('accepts rev-invariant artifacts when mtime < phaseOpenedAt (reopen semantic)', () => {
    // Phase 3 reopen analog of the Phase 1 reopen test. Claude may decide the
    // plan+checklist are rev-invariant under Gate 4 feedback and leave them.
    const cwd = makeTmpDir();
    const futureOpenedAt = (Math.floor(Date.now() / 1000) + 3600) * 1000;
    const state = makeState({
      phaseOpenedAt: { '1': null, '3': futureOpenedAt, '5': null },
    });

    const planPath = path.join(cwd, state.artifacts.plan);
    const checklistPath = path.join(cwd, state.artifacts.checklist);
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.mkdirSync(path.dirname(checklistPath), { recursive: true });
    fs.writeFileSync(planPath, '# Plan');
    fs.writeFileSync(
      checklistPath,
      JSON.stringify({ checks: [{ name: 'n', command: 'true' }] }),
    );

    const result = validatePhaseArtifacts(3, state, cwd, cwd);
    expect(result).toBe(true);
  });
});

describe('validatePhaseArtifacts — Phase 5', () => {
  it('returns true when HEAD has advanced', () => {
    const repoDir = createTestRepo();
    const head = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
    fs.writeFileSync(path.join(repoDir, 'impl.txt'), 'implementation');
    execSync('git add impl.txt && git commit -m "impl"', { cwd: repoDir });

    const state = makeState({ implRetryBase: head });
    state.trackedRepos = [{ path: repoDir, baseCommit: head, implRetryBase: head, implHead: null }];
    const result = validatePhaseArtifacts(5, state, repoDir, repoDir);
    expect(result).toBe(true);
  });

  it('returns false when HEAD has not advanced and implCommit is null', () => {
    const repoDir = createTestRepo();
    const head = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
    const state = makeState({ implRetryBase: head, implCommit: null });
    state.trackedRepos = [{ path: repoDir, baseCommit: head, implRetryBase: head, implHead: null }];
    const result = validatePhaseArtifacts(5, state, repoDir, repoDir);
    expect(result).toBe(false);
  });

  it('accepts zero-commit reopen when implHead is already set on trackedRepos[0]', () => {
    const repoDir = createTestRepo();
    const head = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
    const state = makeState({ implRetryBase: head, implCommit: null });
    // Simulate a prior attempt that set implHead
    state.trackedRepos = [{ path: repoDir, baseCommit: head, implRetryBase: head, implHead: 'prior-impl-sha' }];
    const result = validatePhaseArtifacts(5, state, repoDir, repoDir);
    expect(result).toBe(true);
  });

  it('returns true when HEAD advanced even if working tree is dirty (no dirty-tree gate)', () => {
    const repoDir = createTestRepo();
    const head = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
    fs.writeFileSync(path.join(repoDir, 'impl.txt'), 'implementation');
    execSync('git add impl.txt && git commit -m "impl"', { cwd: repoDir });
    fs.writeFileSync(path.join(repoDir, 'dirty.txt'), 'untracked scratch');

    const state = makeState({ implRetryBase: head });
    state.trackedRepos = [{ path: repoDir, baseCommit: head, implRetryBase: head, implHead: null }];
    const result = validatePhaseArtifacts(5, state, repoDir, repoDir);
    expect(result).toBe(true);
  });

  it('symmetric reopen: HEAD unchanged from implRetryBase, but prior implHead preserved → accept', () => {
    // This is the whole point of the fix: a gate-7 REJECT reopen in which Claude
    // judges the feedback rev-invariant and writes only the sentinel must validate.
    // preparePhase would have rebased implRetryBase to the current HEAD and
    // preserved implHead from the prior successful phase-5.
    const repoDir = createTestRepo();
    const head = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
    const state = makeState({ implRetryBase: head, implCommit: 'sha-from-prior-impl' });
    state.trackedRepos = [{
      path: repoDir,
      baseCommit: head,
      implRetryBase: head,          // rebased to current HEAD by preparePhase
      implHead: 'sha-from-prior-impl', // preserved by preparePhase
    }];
    const result = validatePhaseArtifacts(5, state, repoDir, repoDir);
    expect(result).toBe(true);
  });

  it('fresh phase 5 (implHead null) with zero commits still returns false', () => {
    // Guardrail check: first-ever Phase 5 must actually produce commits. The
    // symmetric-reopen escape hatch applies only when a prior attempt set implHead.
    const repoDir = createTestRepo();
    const head = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
    const state = makeState({ implRetryBase: head, implCommit: null });
    state.trackedRepos = [{ path: repoDir, baseCommit: head, implRetryBase: head, implHead: null }];
    const result = validatePhaseArtifacts(5, state, repoDir, repoDir);
    expect(result).toBe(false);
  });

  it('reopen with new commits refreshes implHead to current HEAD (no stale value)', () => {
    // Claude addressed feedback with new commits on reopen. implHead must now
    // reflect current HEAD, not the pre-reopen value.
    const repoDir = createTestRepo();
    const headBeforeReopen = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
    fs.writeFileSync(path.join(repoDir, 'fix.txt'), 'reopen fix');
    execSync('git add fix.txt && git commit -m "reopen fix"', { cwd: repoDir });
    const newHead = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();

    const state = makeState({ implRetryBase: headBeforeReopen, implCommit: 'sha-from-prior-impl' });
    state.trackedRepos = [{
      path: repoDir,
      baseCommit: headBeforeReopen,
      implRetryBase: headBeforeReopen,
      implHead: 'sha-from-prior-impl',
    }];

    const result = validatePhaseArtifacts(5, state, repoDir, repoDir);
    expect(result).toBe(true);
    expect(state.trackedRepos[0].implHead).toBe(newHead);
  });
});

// ─── runInteractivePhase: Claude dispatch command shape ──────────────────────

describe('runInteractivePhase — Claude dispatch command shape', () => {
  it('sendKeysToPane command includes --dangerously-skip-permissions and --effort', async () => {
    const { sendKeysToPane } = await import('../../src/tmux.js');
    const { runInteractivePhase } = await import('../../src/phases/interactive.js');

    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();
    const repoDir = createTestRepo();
    const state = makeState({ tmuxSession: 'test-session', tmuxWorkspacePane: '%1', tmuxControlPane: '%0' });

    vi.mocked(sendKeysToPane).mockClear();

    await runInteractivePhase(1, state, harnessDir, runDir, repoDir, 'test-attempt-id');

    // The second call is the actual Claude command (first call is C-c pre-clear)
    const calls = vi.mocked(sendKeysToPane).mock.calls;
    const claudeCallIdx = calls.findIndex((c) => c[2] !== 'C-c');
    expect(claudeCallIdx).toBeGreaterThanOrEqual(0);
    const command: string = calls[claudeCallIdx][2];

    expect(command).toContain('--dangerously-skip-permissions');
    expect(command).toContain('--effort');
    // Phase 1 default preset is opus-high (effort=high). Pin the exact effort
    // here so a future preset change trips this test on purpose.
    expect(command).toContain('--effort high');
  });
});

describe('validatePhaseArtifacts — light + phase 1 extras (ADR-13)', () => {
  it('accepts a combined doc with "## Implementation Plan" header + valid checklist (no OQ required)', () => {
    const tmp = makeTmpDir();
    const state = makeState({ flow: 'light', phaseOpenedAt: { '1': 0, '3': null, '5': null } });
    state.artifacts.spec = path.join(tmp, 'spec.md');
    state.artifacts.decisionLog = path.join(tmp, 'decisions.md');
    state.artifacts.checklist = path.join(tmp, 'checklist.json');
    fs.writeFileSync(state.artifacts.spec,
      '# T\n## Context & Decisions\n\n## Complexity\n\nSmall\n\n## Implementation Plan\n- t\n');
    fs.writeFileSync(state.artifacts.decisionLog, '# D\n');
    fs.writeFileSync(state.artifacts.checklist,
      JSON.stringify({ checks: [{ name: 'n', command: 'true' }] }));
    expect(validatePhaseArtifacts(1, state, tmp, tmp)).toBe(true);
  });

  it('accepts a combined doc even when no "## Open Questions" header is present (ambiguities resolved live)', () => {
    const tmp = makeTmpDir();
    const state = makeState({ flow: 'light', phaseOpenedAt: { '1': 0, '3': null, '5': null } });
    state.artifacts.spec = path.join(tmp, 'spec.md');
    state.artifacts.decisionLog = path.join(tmp, 'decisions.md');
    state.artifacts.checklist = path.join(tmp, 'checklist.json');
    fs.writeFileSync(state.artifacts.spec,
      '# T\n## Context & Decisions\n\n## Complexity\n\nSmall\n\n## Implementation Plan\n- t\n');
    fs.writeFileSync(state.artifacts.decisionLog, '# D\n');
    fs.writeFileSync(state.artifacts.checklist,
      JSON.stringify({ checks: [{ name: 'n', command: 'true' }] }));
    expect(validatePhaseArtifacts(1, state, tmp, tmp)).toBe(true);
  });

  it('rejects a combined doc that lacks the "## Implementation Plan" header', () => {
    const tmp = makeTmpDir();
    const state = makeState({ flow: 'light', phaseOpenedAt: { '1': 0, '3': null, '5': null } });
    state.artifacts.spec = path.join(tmp, 'spec.md');
    state.artifacts.decisionLog = path.join(tmp, 'decisions.md');
    state.artifacts.checklist = path.join(tmp, 'checklist.json');
    fs.writeFileSync(state.artifacts.spec,
      '# T\n## Context & Decisions\n\n## Complexity\n\nSmall\n');
    fs.writeFileSync(state.artifacts.decisionLog, '# D\n');
    fs.writeFileSync(state.artifacts.checklist,
      JSON.stringify({ checks: [{ name: 'n', command: 'true' }] }));
    expect(validatePhaseArtifacts(1, state, tmp, tmp)).toBe(false);
  });

  it('rejects when checklist.json schema is invalid', () => {
    const tmp = makeTmpDir();
    const state = makeState({ flow: 'light', phaseOpenedAt: { '1': 0, '3': null, '5': null } });
    state.artifacts.spec = path.join(tmp, 'spec.md');
    state.artifacts.decisionLog = path.join(tmp, 'decisions.md');
    state.artifacts.checklist = path.join(tmp, 'checklist.json');
    fs.writeFileSync(state.artifacts.spec,
      '# T\n## Context & Decisions\n\n## Complexity\n\nSmall\n\n## Implementation Plan\n- t\n');
    fs.writeFileSync(state.artifacts.decisionLog, '# D\n');
    fs.writeFileSync(state.artifacts.checklist, '{"checks":[]}');
    expect(validatePhaseArtifacts(1, state, tmp, tmp)).toBe(false);
  });

  it('rejects a light combined doc that lacks the "## Complexity" header', () => {
    const tmp = makeTmpDir();
    const state = makeState({ flow: 'light', phaseOpenedAt: { '1': 0, '3': null, '5': null } });
    state.artifacts.spec = path.join(tmp, 'spec.md');
    state.artifacts.decisionLog = path.join(tmp, 'decisions.md');
    state.artifacts.checklist = path.join(tmp, 'checklist.json');
    fs.writeFileSync(state.artifacts.spec,
      '# T\n## Context & Decisions\n\n## Implementation Plan\n- t\n');
    fs.writeFileSync(state.artifacts.decisionLog, '# D\n');
    fs.writeFileSync(state.artifacts.checklist,
      JSON.stringify({ checks: [{ name: 'n', command: 'true' }] }));
    expect(validatePhaseArtifacts(1, state, tmp, tmp)).toBe(false);
  });
});

// ─── runInteractivePhase — codex branch + CODEX_HOME isolation (Issue #13) ───

describe('runInteractivePhase — codex-interactive branch invokes codex isolation', () => {
  it('calls ensureCodexIsolation(runDir) and threads codexHomeFor(runDir) into runCodexInteractive (positive path)', async () => {
    const { runInteractivePhase } = await import('../../src/phases/interactive.js');
    const { runCodexInteractive } = await import('../../src/runners/codex.js');
    const { ensureCodexIsolation } = await import('../../src/runners/codex-isolation.js');

    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();
    const repoDir = createTestRepo();

    const state = makeState({
      tmuxSession: 'test-session',
      tmuxWorkspacePane: '%1',
      tmuxControlPane: '%0',
      phasePresets: { ...createInitialState('r', 't', 'b', false).phasePresets, '1': 'codex-high' },
      codexNoIsolate: false,
    });

    vi.mocked(ensureCodexIsolation).mockClear();
    vi.mocked(runCodexInteractive).mockClear();

    await runInteractivePhase(1, state, harnessDir, runDir, repoDir, 'attempt-1');

    expect(vi.mocked(ensureCodexIsolation)).toHaveBeenCalledWith(runDir);
    // runCodexInteractive signature: phase, state, preset, harnessDir, runDir, promptFile, cwd, codexHome
    const call = vi.mocked(runCodexInteractive).mock.calls[0];
    expect(call).toBeDefined();
    expect(call[7]).toBe(`${runDir}/codex-home`);
  });

  it('codexNoIsolate=true: ensureCodexIsolation NOT called; runCodexInteractive receives codexHome=null', async () => {
    const { runInteractivePhase } = await import('../../src/phases/interactive.js');
    const { runCodexInteractive } = await import('../../src/runners/codex.js');
    const { ensureCodexIsolation } = await import('../../src/runners/codex-isolation.js');

    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();
    const repoDir = createTestRepo();

    const state = makeState({
      tmuxSession: 'test-session',
      tmuxWorkspacePane: '%1',
      tmuxControlPane: '%0',
      phasePresets: { ...createInitialState('r', 't', 'b', false).phasePresets, '1': 'codex-high' },
      codexNoIsolate: true,
    });

    vi.mocked(ensureCodexIsolation).mockClear();
    vi.mocked(runCodexInteractive).mockClear();

    await runInteractivePhase(1, state, harnessDir, runDir, repoDir, 'attempt-2');

    expect(vi.mocked(ensureCodexIsolation)).not.toHaveBeenCalled();
    const call = vi.mocked(runCodexInteractive).mock.calls[0];
    expect(call[7]).toBeNull();
  });

  it('CodexIsolationError → phase fails with isolation error sidecar (no runner call)', async () => {
    const { runInteractivePhase } = await import('../../src/phases/interactive.js');
    const { runCodexInteractive } = await import('../../src/runners/codex.js');
    const isolationMod = await import('../../src/runners/codex-isolation.js');
    const { CodexIsolationError } = isolationMod;

    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();
    const repoDir = createTestRepo();

    const state = makeState({
      tmuxSession: 'test-session',
      tmuxWorkspacePane: '%1',
      tmuxControlPane: '%0',
      phasePresets: { ...createInitialState('r', 't', 'b', false).phasePresets, '1': 'codex-high' },
      codexNoIsolate: false,
    });

    vi.mocked(runCodexInteractive).mockClear();
    vi.mocked(isolationMod.ensureCodexIsolation).mockImplementationOnce(() => {
      throw new CodexIsolationError('fake: auth.json missing');
    });

    const result = await runInteractivePhase(1, state, harnessDir, runDir, repoDir, 'attempt-3');

    expect(result.status).toBe('failed');
    // Runner NEVER called once bootstrap fails.
    expect(vi.mocked(runCodexInteractive)).not.toHaveBeenCalled();
    // Isolation failure captured as a sidecar for post-mortem debugging.
    const errorSidecar = path.join(runDir, 'codex-1-error.md');
    expect(fs.existsSync(errorSidecar)).toBe(true);
    expect(fs.readFileSync(errorSidecar, 'utf-8')).toMatch(/fake.*auth\.json missing/);
  });
});

describe('validatePhaseArtifacts — Phase 5 multi-repo (FR-6, ADR-D4)', () => {
  it('returns true when any repo advanced; sets implHead on advanced repos only', () => {
    const outer = makeTmpDir();
    const repoA = makeTmpDir('repoA-');
    const repoB = makeTmpDir('repoB-');

    // Init both repos with an initial commit
    for (const d of [repoA, repoB]) {
      execSync('git init', { cwd: d, stdio: 'pipe' });
      execSync('git config user.email "t@t.com"', { cwd: d, stdio: 'pipe' });
      execSync('git config user.name "T"', { cwd: d, stdio: 'pipe' });
      fs.writeFileSync(path.join(d, 'a.txt'), 'x');
      execSync('git add .', { cwd: d, stdio: 'pipe' });
      execSync('git commit -m "init"', { cwd: d, stdio: 'pipe' });
    }

    const headA = execSync('git rev-parse HEAD', { cwd: repoA, encoding: 'utf-8' }).trim();
    const headB = execSync('git rev-parse HEAD', { cwd: repoB, encoding: 'utf-8' }).trim();

    // Advance only repoA
    fs.writeFileSync(path.join(repoA, 'new.txt'), 'y');
    execSync('git add .', { cwd: repoA, stdio: 'pipe' });
    execSync('git commit -m "impl"', { cwd: repoA, stdio: 'pipe' });
    const newHeadA = execSync('git rev-parse HEAD', { cwd: repoA, encoding: 'utf-8' }).trim();

    const state = makeState({ baseCommit: headA, implRetryBase: headA });
    state.trackedRepos = [
      { path: repoA, baseCommit: headA, implRetryBase: headA, implHead: null },
      { path: repoB, baseCommit: headB, implRetryBase: headB, implHead: null },
    ];

    const runDir = makeTmpDir('rundir-');
    const result = validatePhaseArtifacts(5, state, outer, runDir);

    expect(result).toBe(true);
    expect(state.trackedRepos[0].implHead).toBe(newHeadA);
    expect(state.trackedRepos[1].implHead).toBeNull(); // not advanced
    expect(state.implCommit).toBe(newHeadA); // legacy mirror from trackedRepos[0]
  });

  it('returns false when no repo advanced', () => {
    const outer = makeTmpDir();
    const repoA = makeTmpDir('repoA2-');
    execSync('git init', { cwd: repoA, stdio: 'pipe' });
    execSync('git config user.email "t@t.com"', { cwd: repoA, stdio: 'pipe' });
    execSync('git config user.name "T"', { cwd: repoA, stdio: 'pipe' });
    fs.writeFileSync(path.join(repoA, 'a.txt'), 'x');
    execSync('git add .', { cwd: repoA, stdio: 'pipe' });
    execSync('git commit -m "init"', { cwd: repoA, stdio: 'pipe' });
    const head = execSync('git rev-parse HEAD', { cwd: repoA, encoding: 'utf-8' }).trim();

    const state = makeState({ baseCommit: head, implRetryBase: head });
    state.trackedRepos = [
      { path: repoA, baseCommit: head, implRetryBase: head, implHead: null },
    ];
    state.implCommit = null;

    const runDir = makeTmpDir('rundir2-');
    const result = validatePhaseArtifacts(5, state, outer, runDir);
    expect(result).toBe(false);
  });
});
