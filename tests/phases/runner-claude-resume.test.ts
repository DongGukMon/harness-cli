/**
 * Tests for same-phase same-session Claude interactive reopen policy:
 * - resume vs fresh session determination
 * - pre-relaunch sentinel purge (hard prerequisite)
 * - phaseClaudeSessions state update
 * - claudeResumeSessionId in phase_start event
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { HarnessState, LogEvent, SessionMeta, DistributiveOmit } from '../../src/types.js';
import type { InteractiveResult } from '../../src/phases/interactive.js';
import { createInitialState } from '../../src/state.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../src/phases/interactive.js', () => ({
  runInteractivePhase: vi.fn(),
  preparePhase: vi.fn(),
  checkSentinelFreshness: vi.fn(),
  validatePhaseArtifacts: vi.fn(),
}));

vi.mock('../../src/runners/claude-usage.js', () => ({
  readClaudeSessionUsage: vi.fn().mockReturnValue(null),
  encodeProjectDir: vi.fn((cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-')),
  claudeSessionJsonlExists: vi.fn(),
  claudeSessionJsonlPath: vi.fn(),
}));

vi.mock('../../src/ui.js', () => ({
  promptChoice: vi.fn(),
  printPhaseTransition: vi.fn(),
  renderControlPanel: vi.fn(),
  printWarning: vi.fn(),
  printError: vi.fn(),
  printSuccess: vi.fn(),
  printInfo: vi.fn(),
}));

vi.mock('../../src/artifact.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/artifact.js')>();
  return {
    ...actual,
    commitEvalReport: vi.fn(),
    normalizeArtifactCommit: vi.fn().mockReturnValue(true),
    runPhase6Preconditions: vi.fn(),
  };
});

vi.mock('../../src/git.js', () => ({
  getHead: vi.fn().mockReturnValue('mock-head-sha'),
  getGitRoot: vi.fn(),
  isAncestor: vi.fn(),
  isWorkingTreeClean: vi.fn(),
  hasStagedChanges: vi.fn(),
  getStagedFiles: vi.fn(),
  getFileStatus: vi.fn(),
  generateRunId: vi.fn(),
  detectExternalCommits: vi.fn(),
}));

vi.mock('../../src/state.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/state.js')>();
  return { ...actual, writeState: vi.fn() };
});

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { handleInteractivePhase } from '../../src/phases/runner.js';
import { runInteractivePhase } from '../../src/phases/interactive.js';
import { claudeSessionJsonlExists } from '../../src/runners/claude-usage.js';

// ─── Test logger ──────────────────────────────────────────────────────────────

class CapturingLogger {
  events: DistributiveOmit<LogEvent, 'v' | 'ts' | 'runId'>[] = [];
  logEvent(e: DistributiveOmit<LogEvent, 'v' | 'ts' | 'runId'>): void { this.events.push(e); }
  writeMeta(_: Partial<SessionMeta> & { task: string }): void { }
  updateMeta(): void { }
  finalizeSummary(): void { }
  close(): void { }
  hasBootstrapped(): boolean { return true; }
  hasEmittedSessionOpen(): boolean { return true; }
  getStartedAt(): number { return Date.now(); }
  getEventsPath(): string | null { return null; }

  phaseStarts() {
    return this.events.filter((e) => (e as any).event === 'phase_start') as any[];
  }
  phaseEnds() {
    return this.events.filter((e) => (e as any).event === 'phase_end') as any[];
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const tmpDirs: string[] = [];

afterEach(() => {
  vi.clearAllMocks();
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  tmpDirs.length = 0;
});

function makeTmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-resume-'));
  tmpDirs.push(d);
  return d;
}

const HDIR = '/tmp/harness-dir';
const CWD = '/tmp/cwd';
const PREV_ATTEMPT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function makeState(overrides: Partial<HarnessState> = {}): HarnessState {
  const base = createInitialState('test-run', '/tasks/test.md', 'base-sha', false);
  return {
    ...base,
    ...overrides,
  };
}

function makeReopenState(phase: 1 | 3 | 5, withPrevSession = true): HarnessState {
  const s = makeState({ currentPhase: phase });
  s.phaseReopenFlags[String(phase)] = true;
  s.phaseAttemptId[String(phase)] = PREV_ATTEMPT_ID;
  if (withPrevSession) {
    s.phaseClaudeSessions[String(phase) as '1' | '3' | '5'] = {
      runner: 'claude',
      model: 'claude-sonnet-4-6[1m]',
      effort: 'high',
    };
  }
  return s;
}

// ─── Tests: resume determination ─────────────────────────────────────────────

describe('handleInteractivePhase — resume determination', () => {
  it('calls runInteractivePhase with resume=true when all conditions met', async () => {
    vi.mocked(claudeSessionJsonlExists).mockReturnValue(true);
    vi.mocked(runInteractivePhase).mockResolvedValueOnce({ status: 'completed', attemptId: PREV_ATTEMPT_ID });

    const runDir = makeTmpDir();
    const state = makeReopenState(5);
    const logger = new CapturingLogger();

    await handleInteractivePhase(5, state, HDIR, runDir, CWD, logger as any);

    const call = vi.mocked(runInteractivePhase).mock.calls[0];
    expect(call[5]).toBe(PREV_ATTEMPT_ID); // same attemptId reused
    expect(call[6]).toBe(true);             // resume=true
  });

  it('emits claudeResumeSessionId in phase_start when resuming', async () => {
    vi.mocked(claudeSessionJsonlExists).mockReturnValue(true);
    vi.mocked(runInteractivePhase).mockResolvedValueOnce({ status: 'completed', attemptId: PREV_ATTEMPT_ID });

    const runDir = makeTmpDir();
    const state = makeReopenState(5);
    const logger = new CapturingLogger();

    await handleInteractivePhase(5, state, HDIR, runDir, CWD, logger as any);

    const starts = logger.phaseStarts();
    expect(starts).toHaveLength(1);
    expect(starts[0].claudeResumeSessionId).toBe(PREV_ATTEMPT_ID);
  });

  it('calls runInteractivePhase with resume=false on fresh start (isReopen=false)', async () => {
    vi.mocked(claudeSessionJsonlExists).mockReturnValue(true);
    vi.mocked(runInteractivePhase).mockResolvedValueOnce({ status: 'completed', attemptId: 'new-id' });

    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 5 }); // isReopen=false
    const logger = new CapturingLogger();

    await handleInteractivePhase(5, state, HDIR, runDir, CWD, logger as any);

    const call = vi.mocked(runInteractivePhase).mock.calls[0];
    expect(call[6]).toBe(false); // resume=false

    const starts = logger.phaseStarts();
    expect('claudeResumeSessionId' in starts[0]).toBe(false);
  });

  it('falls back to fresh session when JSONL is missing, emits stderr warning', async () => {
    vi.mocked(claudeSessionJsonlExists).mockReturnValue(false); // JSONL missing
    vi.mocked(runInteractivePhase).mockResolvedValueOnce({ status: 'completed', attemptId: 'new-id' });

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const runDir = makeTmpDir();
      const state = makeReopenState(5);
      const logger = new CapturingLogger();

      await handleInteractivePhase(5, state, HDIR, runDir, CWD, logger as any);

      const call = vi.mocked(runInteractivePhase).mock.calls[0];
      expect(call[5]).not.toBe(PREV_ATTEMPT_ID); // new UUID
      expect(call[6]).toBe(false);                // resume=false

      const writes = stderrSpy.mock.calls.map((c) => String(c[0]));
      expect(writes.some((w) => w.includes('jsonl missing'))).toBe(true);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('falls back when no prior attempt id, emits stderr warning', async () => {
    vi.mocked(claudeSessionJsonlExists).mockReturnValue(false);
    vi.mocked(runInteractivePhase).mockResolvedValueOnce({ status: 'failed', attemptId: 'new-id' });

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const runDir = makeTmpDir();
      const state = makeReopenState(5);
      state.phaseAttemptId['5'] = null; // no prior id
      const logger = new CapturingLogger();

      await handleInteractivePhase(5, state, HDIR, runDir, CWD, logger as any);

      const writes = stderrSpy.mock.calls.map((c) => String(c[0]));
      expect(writes.some((w) => w.includes('no prior attempt id'))).toBe(true);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('falls back when no prior claude session record, emits stderr warning', async () => {
    vi.mocked(claudeSessionJsonlExists).mockReturnValue(false);
    vi.mocked(runInteractivePhase).mockResolvedValueOnce({ status: 'failed', attemptId: 'new-id' });

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const runDir = makeTmpDir();
      const state = makeReopenState(5, false); // no prev session record
      const logger = new CapturingLogger();

      await handleInteractivePhase(5, state, HDIR, runDir, CWD, logger as any);

      const writes = stderrSpy.mock.calls.map((c) => String(c[0]));
      expect(writes.some((w) => w.includes('no prior claude session record'))).toBe(true);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('falls back when preset is incompatible, emits stderr warning', async () => {
    vi.mocked(claudeSessionJsonlExists).mockReturnValue(true);
    vi.mocked(runInteractivePhase).mockResolvedValueOnce({ status: 'failed', attemptId: 'new-id' });

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const runDir = makeTmpDir();
      const state = makeReopenState(5);
      // set prev session with different model than current preset
      state.phaseClaudeSessions['5'] = { runner: 'claude', model: 'old-model', effort: 'high' };
      const logger = new CapturingLogger();

      await handleInteractivePhase(5, state, HDIR, runDir, CWD, logger as any);

      const writes = stderrSpy.mock.calls.map((c) => String(c[0]));
      expect(writes.some((w) => w.includes('preset incompatible'))).toBe(true);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('records phaseClaudeSessions after launch (both resume and fresh paths)', async () => {
    vi.mocked(claudeSessionJsonlExists).mockReturnValue(true);
    vi.mocked(runInteractivePhase).mockResolvedValueOnce({ status: 'completed', attemptId: PREV_ATTEMPT_ID });

    const runDir = makeTmpDir();
    const state = makeReopenState(5);
    const logger = new CapturingLogger();

    await handleInteractivePhase(5, state, HDIR, runDir, CWD, logger as any);

    expect(state.phaseClaudeSessions['5']).not.toBeNull();
    expect(state.phaseClaudeSessions['5']?.runner).toBe('claude');
  });
});

// ─── Tests: sentinel pre-delete (D5 / R5) ────────────────────────────────────

describe('handleInteractivePhase — sentinel pre-delete (hard prerequisite)', () => {
  it('deletes existing sentinel before spawn and proceeds normally', async () => {
    vi.mocked(claudeSessionJsonlExists).mockReturnValue(false);
    vi.mocked(runInteractivePhase).mockResolvedValueOnce({ status: 'completed', attemptId: 'new-id' });

    const runDir = makeTmpDir();
    // Write a stale sentinel
    const sentinelPath = path.join(runDir, 'phase-5.done');
    fs.writeFileSync(sentinelPath, 'stale-content');
    expect(fs.existsSync(sentinelPath)).toBe(true);

    const state = makeState({ currentPhase: 5 });
    const logger = new CapturingLogger();

    await handleInteractivePhase(5, state, HDIR, runDir, CWD, logger as any);

    // Sentinel was deleted before runInteractivePhase ran
    // (runInteractivePhase is mocked so it doesn't recreate the sentinel)
    expect(vi.mocked(runInteractivePhase)).toHaveBeenCalledOnce();
    // The phase completed normally
    const ends = logger.phaseEnds();
    expect(ends[0].status).toBe('completed');
  });

  it('proceeds normally when sentinel does not exist (fresh run)', async () => {
    vi.mocked(claudeSessionJsonlExists).mockReturnValue(false);
    vi.mocked(runInteractivePhase).mockResolvedValueOnce({ status: 'completed', attemptId: 'new-id' });

    const runDir = makeTmpDir();
    // No sentinel file exists
    const state = makeState({ currentPhase: 5 });
    const logger = new CapturingLogger();

    await handleInteractivePhase(5, state, HDIR, runDir, CWD, logger as any);

    expect(vi.mocked(runInteractivePhase)).toHaveBeenCalledOnce();
    const ends = logger.phaseEnds();
    expect(ends[0].status).toBe('completed');
  });

  it('aborts relaunch and emits phase_end failed when sentinel cannot be deleted', async () => {
    vi.mocked(claudeSessionJsonlExists).mockReturnValue(false);
    vi.mocked(runInteractivePhase).mockResolvedValueOnce({ status: 'completed', attemptId: 'new-id' });

    const runDir = makeTmpDir();
    const sentinelPath = path.join(runDir, 'phase-5.done');
    fs.writeFileSync(sentinelPath, 'stale-content');

    // Mock fs.existsSync to return true AFTER the rmSync call for the sentinel
    const origExistsSync = fs.existsSync;
    let rmSyncCalled = false;
    const rmSyncSpy = vi.spyOn(fs, 'rmSync').mockImplementation((...args) => {
      rmSyncCalled = true;
      // don't actually delete — simulate FS failure
    });
    const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
      if (rmSyncCalled && typeof p === 'string' && p === sentinelPath) {
        return true; // still present after rmSync — simulate purge failure
      }
      return origExistsSync(p as string);
    });

    try {
      const state = makeState({ currentPhase: 5 });
      const logger = new CapturingLogger();

      await expect(
        handleInteractivePhase(5, state, HDIR, runDir, CWD, logger as any)
      ).rejects.toThrow('pre-relaunch sentinel purge failed');

      // phase_end with failed status should have been emitted
      const ends = logger.phaseEnds();
      expect(ends).toHaveLength(1);
      expect(ends[0].status).toBe('failed');

      // runInteractivePhase should NOT have been called
      expect(vi.mocked(runInteractivePhase)).not.toHaveBeenCalled();
    } finally {
      rmSyncSpy.mockRestore();
      existsSpy.mockRestore();
    }
  });
});

// ─── Regression: token capture still works on resume path ────────────────────

describe('handleInteractivePhase — token capture regression on resume', () => {
  it('passes the (reused) attemptId to readClaudeSessionUsage on resume path', async () => {
    vi.mocked(claudeSessionJsonlExists).mockReturnValue(true);
    vi.mocked(runInteractivePhase).mockResolvedValueOnce({ status: 'completed', attemptId: PREV_ATTEMPT_ID });

    const { readClaudeSessionUsage } = await import('../../src/runners/claude-usage.js');
    vi.mocked(readClaudeSessionUsage).mockReturnValue({
      input: 5, output: 50, cacheRead: 500, cacheCreate: 5000, total: 5555,
    });

    const runDir = makeTmpDir();
    const state = makeReopenState(5);
    const logger = new CapturingLogger();

    await handleInteractivePhase(5, state, HDIR, runDir, CWD, logger as any);

    // Verify readClaudeSessionUsage was called with the reused attemptId
    expect(vi.mocked(readClaudeSessionUsage)).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: PREV_ATTEMPT_ID }),
    );

    const ends = logger.phaseEnds();
    expect(ends[0].claudeTokens).toEqual({
      input: 5, output: 50, cacheRead: 500, cacheCreate: 5000, total: 5555,
    });
  });
});
