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

vi.mock('../../src/ui.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/ui.js')>();
  return { ...actual, printAdvisorReminder: vi.fn() };
});

vi.mock('../../src/tmux.js', () => ({
  sendKeysToPane: vi.fn(),
  pollForPidFile: vi.fn().mockResolvedValue(12345),
}));

vi.mock('../../src/process.js', () => ({
  isPidAlive: vi.fn(() => false),
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
  return {
    ...base,
    tmuxWorkspacePane: '%1',
    tmuxControlPane: '%0',
    ...overrides,
  };
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

  it('generates a different attemptId on each call (no reuse)', () => {
    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();
    const cwd = makeTmpDir();

    const state = makeState();
    preparePhase(1, state, harnessDir, runDir, cwd);
    const firstId = state.phaseAttemptId['1'];
    preparePhase(1, state, harnessDir, runDir, cwd);
    const secondId = state.phaseAttemptId['1'];

    expect(firstId).not.toBe(secondId);
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
    fs.writeFileSync(specPath, '# Spec content');
    fs.writeFileSync(decPath, '# Decisions');

    const result = validatePhaseArtifacts(1, state, cwd);
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

    const result = validatePhaseArtifacts(1, state, cwd);
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

    const result = validatePhaseArtifacts(1, state, cwd);
    expect(result).toBe(false);
  });

  it('returns false when artifact mtime is before phaseOpenedAt (stale file)', () => {
    const cwd = makeTmpDir();
    // Set phaseOpenedAt to far in the future so existing files appear stale
    const futureOpenedAt = (Math.floor(Date.now() / 1000) + 3600) * 1000; // 1 hour from now
    const state = makeState({
      phaseOpenedAt: { '1': futureOpenedAt, '3': null, '5': null },
    });

    const specPath = path.join(cwd, state.artifacts.spec);
    const decPath = path.join(cwd, state.artifacts.decisionLog);
    fs.mkdirSync(path.dirname(specPath), { recursive: true });
    fs.mkdirSync(path.dirname(decPath), { recursive: true });
    fs.writeFileSync(specPath, '# Spec');
    fs.writeFileSync(decPath, '# Decisions');

    const result = validatePhaseArtifacts(1, state, cwd);
    expect(result).toBe(false);
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

    const result = validatePhaseArtifacts(3, state, cwd);
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

    const result = validatePhaseArtifacts(3, state, cwd);
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

    const result = validatePhaseArtifacts(3, state, cwd);
    expect(result).toBe(false);
  });
});

describe('validatePhaseArtifacts — Phase 5', () => {
  it('returns true when HEAD has advanced and working tree is clean', () => {
    const repoDir = createTestRepo();
    const head = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();

    // Create a new commit so HEAD advances
    fs.writeFileSync(path.join(repoDir, 'impl.txt'), 'implementation');
    execSync('git add impl.txt && git commit -m "impl"', { cwd: repoDir });
    const newHead = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
    expect(newHead).not.toBe(head);

    const state = makeState({ implRetryBase: head });
    const result = validatePhaseArtifacts(5, state, repoDir);
    expect(result).toBe(true);
  });

  it('returns false when HEAD has not advanced (no commits made)', () => {
    const repoDir = createTestRepo();
    const head = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();

    const state = makeState({ implRetryBase: head });
    const result = validatePhaseArtifacts(5, state, repoDir);
    expect(result).toBe(false);
  });

  it('returns false when working tree is dirty', () => {
    const repoDir = createTestRepo();
    const head = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();

    // Make a commit (HEAD advances)
    fs.writeFileSync(path.join(repoDir, 'impl.txt'), 'implementation');
    execSync('git add impl.txt && git commit -m "impl"', { cwd: repoDir });

    // Leave an untracked file (dirty)
    fs.writeFileSync(path.join(repoDir, 'dirty.txt'), 'dirty');

    const state = makeState({ implRetryBase: head });
    const result = validatePhaseArtifacts(5, state, repoDir);
    expect(result).toBe(false);
  });
});

// ─── runInteractivePhase: advisor reminder ordering ──────────────────────────

describe('runInteractivePhase — advisor reminder fires before sendKeysToPane', () => {
  it('printAdvisorReminder is called before sendKeysToPane', async () => {
    const { sendKeysToPane } = await import('../../src/tmux.js');
    const { printAdvisorReminder } = await import('../../src/ui.js');
    const { runInteractivePhase } = await import('../../src/phases/interactive.js');

    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();
    const repoDir = createTestRepo();

    const state = makeState({ tmuxSession: 'test-session', tmuxWorkspacePane: '%1', tmuxControlPane: '%0' });

    // Clear any previous call records from other tests
    vi.mocked(printAdvisorReminder).mockClear();
    vi.mocked(sendKeysToPane).mockClear();

    // Run; it will resolve as 'failed' (no sentinel, PID dies immediately) — that's fine
    await runInteractivePhase(1, state, harnessDir, runDir, repoDir);

    const reminderOrder = vi.mocked(printAdvisorReminder).mock.invocationCallOrder[0];
    // sendKeysToPane is called twice: C-c pre-clear, then the actual command
    const sendKeysToPaneOrder = vi.mocked(sendKeysToPane).mock.invocationCallOrder[0];

    expect(reminderOrder).toBeDefined();
    expect(sendKeysToPaneOrder).toBeDefined();
    expect(reminderOrder).toBeLessThan(sendKeysToPaneOrder);
    expect(vi.mocked(printAdvisorReminder)).toHaveBeenCalledWith(1);
  });

  it('sendKeysToPane command includes --dangerously-skip-permissions and --effort', async () => {
    const { sendKeysToPane } = await import('../../src/tmux.js');
    const { runInteractivePhase } = await import('../../src/phases/interactive.js');

    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();
    const repoDir = createTestRepo();
    const state = makeState({ tmuxSession: 'test-session', tmuxWorkspacePane: '%1', tmuxControlPane: '%0' });

    vi.mocked(sendKeysToPane).mockClear();

    await runInteractivePhase(1, state, harnessDir, runDir, repoDir);

    // The second call is the actual Claude command (first call is C-c pre-clear)
    const calls = vi.mocked(sendKeysToPane).mock.calls;
    const claudeCallIdx = calls.findIndex((c) => c[2] !== 'C-c');
    expect(claudeCallIdx).toBeGreaterThanOrEqual(0);
    const command: string = calls[claudeCallIdx][2];

    expect(command).toContain('--dangerously-skip-permissions');
    expect(command).toContain('--effort');
    expect(command).toContain('max');
  });
});
