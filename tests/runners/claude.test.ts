import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { HarnessState } from '../../src/types.js';
import type { ModelPreset } from '../../src/config.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../src/tmux.js', () => ({
  sendKeysToPane: vi.fn(),
  pollForPidFile: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/process.js', () => ({
  isPidAlive: vi.fn().mockReturnValue(false),
  getProcessStartTime: vi.fn().mockReturnValue(null),
  killProcessGroup: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/lock.js', () => ({
  updateLockChild: vi.fn(),
  clearLockChild: vi.fn(),
}));

vi.mock('../../src/state.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/state.js')>();
  return { ...actual, writeState: vi.fn() };
});

vi.mock('../../src/phases/verdict.js', () => ({
  buildGateResult: vi.fn(),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { sendKeysToPane } from '../../src/tmux.js';
import { createInitialState } from '../../src/state.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PRESET: ModelPreset = {
  id: 'sonnet-1m-high',
  label: 'Claude Sonnet 4.6 1M / high',
  runner: 'claude',
  model: 'claude-sonnet-4-6[1m]',
  effort: 'high',
};

function makeState(phase: 1 | 3 | 5, attemptId: string): HarnessState {
  const state = createInitialState('test-run', '/tasks/test.md', 'base-sha', false);
  state.phaseAttemptId[String(phase)] = attemptId;
  state.tmuxSession = 'test-session';
  state.tmuxWorkspacePane = 'test-pane';
  return state;
}

function getCmdArg(calls: ReturnType<typeof vi.fn>['mock']['calls']): string {
  const call = calls.find((c) => c[2] !== 'C-c');
  if (!call) throw new Error('no non-Ctrl-C sendKeysToPane call found');
  return call[2] as string;
}

// ─── Tests: module exports ────────────────────────────────────────────────────

describe('Claude Runner', () => {
  it('module exports runClaudeInteractive and runClaudeGate', async () => {
    const mod = await import('../../src/runners/claude.js');
    expect(typeof mod.runClaudeInteractive).toBe('function');
    expect(typeof mod.runClaudeGate).toBe('function');
  });
});

// ─── Tests: argv contract (R8 / ADR-9) ───────────────────────────────────────

describe('runClaudeInteractive — argv contract (R8)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('sends --resume <attemptId> and omits --session-id when resume=true', async () => {
    const { runClaudeInteractive } = await import('../../src/runners/claude.js');
    const ATTEMPT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const state = makeState(5, ATTEMPT_ID);

    const promise = runClaudeInteractive(5, state, PRESET, '/harness', '/rundir', '/prompt.md', true);
    vi.runAllTimers();
    await promise;

    const cmd = getCmdArg(vi.mocked(sendKeysToPane).mock.calls);
    expect(cmd).toContain(`--resume ${ATTEMPT_ID}`);
    expect(cmd).not.toContain('--session-id');
    expect(cmd).toContain('--dangerously-skip-permissions');
    expect(cmd).toContain(`--model ${PRESET.model}`);
    expect(cmd).toContain(`--effort ${PRESET.effort}`);
    expect(cmd).toMatch(/@.*prompt\.md/);
  });

  it('sends --session-id <attemptId> and omits --resume when resume=false', async () => {
    const { runClaudeInteractive } = await import('../../src/runners/claude.js');
    const ATTEMPT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const state = makeState(5, ATTEMPT_ID);

    const promise = runClaudeInteractive(5, state, PRESET, '/harness', '/rundir', '/prompt.md', false);
    vi.runAllTimers();
    await promise;

    const cmd = getCmdArg(vi.mocked(sendKeysToPane).mock.calls);
    expect(cmd).toContain(`--session-id ${ATTEMPT_ID}`);
    expect(cmd).not.toContain('--resume');
    expect(cmd).toContain('--dangerously-skip-permissions');
    expect(cmd).toContain(`--model ${PRESET.model}`);
    expect(cmd).toContain(`--effort ${PRESET.effort}`);
    expect(cmd).toMatch(/@.*prompt\.md/);
  });
});
