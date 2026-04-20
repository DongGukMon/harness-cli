import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { HarnessState, LogEvent, SessionMeta, ClaudeTokens, DistributiveOmit } from '../../src/types.js';
import type { InteractiveResult } from '../../src/phases/interactive.js';
import { createInitialState } from '../../src/state.js';

vi.mock('../../src/phases/interactive.js', () => ({
  runInteractivePhase: vi.fn(),
  preparePhase: vi.fn(),
  checkSentinelFreshness: vi.fn(),
  validatePhaseArtifacts: vi.fn(),
}));

vi.mock('../../src/runners/claude-usage.js', () => ({
  readClaudeSessionUsage: vi.fn(),
  encodeProjectDir: vi.fn((cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-')),
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
    commitEvalReport: vi.fn().mockReturnValue('committed'),
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

import { handleInteractivePhase } from '../../src/phases/runner.js';
import { runInteractivePhase } from '../../src/phases/interactive.js';
import { readClaudeSessionUsage } from '../../src/runners/claude-usage.js';
import { normalizeArtifactCommit } from '../../src/artifact.js';

// ─── Test-double logger ──────────────────────────────────────────────────────

class CapturingLogger {
  events: DistributiveOmit<LogEvent, 'v' | 'ts' | 'runId'>[] = [];
  logEvent(e: DistributiveOmit<LogEvent, 'v' | 'ts' | 'runId'>): void { this.events.push(e); }
  writeMeta(_: Partial<SessionMeta> & { task: string }): void { /* noop */ }
  updateMeta(): void { /* noop */ }
  finalizeSummary(): void { /* noop */ }
  close(): void { /* noop */ }
  hasBootstrapped(): boolean { return true; }
  hasEmittedSessionOpen(): boolean { return true; }
  getStartedAt(): number { return Date.now(); }

  phaseEnds() {
    return this.events.filter((e) => (e as any).event === 'phase_end') as any[];
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const tmpDirs: string[] = [];

afterEach(() => {
  vi.clearAllMocks();
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  tmpDirs.length = 0;
});

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-token-'));
  tmpDirs.push(dir);
  return dir;
}

function makeState(overrides: Partial<HarnessState> = {}): HarnessState {
  const base = createInitialState('test-run', '/tasks/test.md', 'base-sha', false);
  return { ...base, ...overrides };
}

const HDIR = '/tmp/harness-dir';
const CWD = '/tmp/cwd';

function setCodexPreset(state: HarnessState, phase: number): void {
  state.phasePresets[String(phase)] = 'codex-high';
}

const HAPPY_TOKENS: ClaudeTokens = {
  input: 10, output: 100, cacheRead: 1_000, cacheCreate: 10_000, total: 11_110,
};

// ─────────────────────────────────────────────────────────────────────────────

describe('handleInteractivePhase claudeTokens capture', () => {
  // Case 1 — Claude preset + completed path → claudeTokens present
  it('attaches claudeTokens to phase_end on completed path when preset.runner === claude', async () => {
    vi.mocked(runInteractivePhase).mockResolvedValueOnce({ status: 'completed', attemptId: 'a-1' });
    vi.mocked(readClaudeSessionUsage).mockReturnValue(HAPPY_TOKENS);

    const logger = new CapturingLogger();
    const state = makeState({ currentPhase: 1 });
    await handleInteractivePhase(1, state, HDIR, makeTmpDir(), CWD, logger as any);

    const ends = logger.phaseEnds();
    expect(ends).toHaveLength(1);
    expect(ends[0].status).toBe('completed');
    expect(ends[0].claudeTokens).toEqual(HAPPY_TOKENS);
  });

  // Case 2 — Claude preset + extraction fails → claudeTokens: null
  it('attaches claudeTokens=null when preset is Claude but extraction returns null', async () => {
    vi.mocked(runInteractivePhase).mockResolvedValueOnce({ status: 'failed', attemptId: 'a-2' });
    vi.mocked(readClaudeSessionUsage).mockReturnValue(null);

    const logger = new CapturingLogger();
    const state = makeState({ currentPhase: 1 });
    await handleInteractivePhase(1, state, HDIR, makeTmpDir(), CWD, logger as any);

    const ends = logger.phaseEnds();
    expect(ends).toHaveLength(1);
    expect(ends[0].status).toBe('failed');
    expect(ends[0].claudeTokens).toBeNull();
  });

  // Case 3 — Codex preset → field absent (undefined)
  it('omits claudeTokens entirely when preset.runner === codex', async () => {
    vi.mocked(runInteractivePhase).mockResolvedValueOnce({ status: 'completed', attemptId: 'a-3' });
    vi.mocked(readClaudeSessionUsage).mockReturnValue(HAPPY_TOKENS);

    const logger = new CapturingLogger();
    const state = makeState({ currentPhase: 1 });
    setCodexPreset(state, 1);
    await handleInteractivePhase(1, state, HDIR, makeTmpDir(), CWD, logger as any);

    const ends = logger.phaseEnds();
    expect(ends).toHaveLength(1);
    // Undefined — field absent from the event payload entirely.
    expect('claudeTokens' in ends[0]).toBe(false);
    // The reader must not have been called at all.
    expect(vi.mocked(readClaudeSessionUsage)).not.toHaveBeenCalled();
  });

  // Case 4 — Redirected-by-signal branch skips token attachment
  it('does NOT attach claudeTokens on the redirected-by-signal phase_end branch', async () => {
    vi.mocked(runInteractivePhase).mockImplementationOnce(async (phase: any, s: any, _h, _r, _c, attemptId) => {
      // Simulate SIGUSR1 redirect: mutate currentPhase while phase is running
      s.currentPhase = 3;
      return { status: 'completed', attemptId };
    });
    vi.mocked(readClaudeSessionUsage).mockReturnValue(HAPPY_TOKENS);

    const logger = new CapturingLogger();
    const state = makeState({ currentPhase: 1 });
    await handleInteractivePhase(1, state, HDIR, makeTmpDir(), CWD, logger as any);

    const ends = logger.phaseEnds();
    expect(ends).toHaveLength(1);
    expect(ends[0].details).toEqual({ reason: 'redirected' });
    expect('claudeTokens' in ends[0]).toBe(false);
  });

  // Case 5 — throw path: phase_end in catch block carries claudeTokens
  it('attaches claudeTokens on the catch-block phase_end when runInteractivePhase throws', async () => {
    vi.mocked(runInteractivePhase).mockRejectedValueOnce(new Error('boom'));
    vi.mocked(readClaudeSessionUsage).mockReturnValue(HAPPY_TOKENS);

    const logger = new CapturingLogger();
    const state = makeState({ currentPhase: 1 });
    await expect(
      handleInteractivePhase(1, state, HDIR, makeTmpDir(), CWD, logger as any)
    ).rejects.toThrow('boom');

    const ends = logger.phaseEnds();
    expect(ends).toHaveLength(1);
    expect(ends[0].status).toBe('failed');
    expect(ends[0].claudeTokens).toEqual(HAPPY_TOKENS);
  });

  // Case 6 — artifact-commit failure path carries claudeTokens
  it('attaches claudeTokens on the artifact-commit-failure phase_end', async () => {
    vi.mocked(runInteractivePhase).mockResolvedValueOnce({ status: 'completed', attemptId: 'a-6' });
    vi.mocked(readClaudeSessionUsage).mockReturnValue(HAPPY_TOKENS);
    vi.mocked(normalizeArtifactCommit).mockImplementationOnce(() => {
      throw new Error('git commit failed');
    });

    const logger = new CapturingLogger();
    const state = makeState({ currentPhase: 1 });
    await handleInteractivePhase(1, state, HDIR, makeTmpDir(), CWD, logger as any);

    const ends = logger.phaseEnds();
    expect(ends).toHaveLength(1);
    expect(ends[0].status).toBe('failed');
    expect(ends[0].claudeTokens).toEqual(HAPPY_TOKENS);
  });
});
