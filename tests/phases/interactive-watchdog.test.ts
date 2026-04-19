import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HarnessState } from '../../src/types.js';
import { createInitialState } from '../../src/state.js';

vi.mock('../../src/phases/interactive.js', () => ({
  runInteractivePhase: vi.fn(),
  preparePhase: vi.fn(),
  checkSentinelFreshness: vi.fn(),
  validatePhaseArtifacts: vi.fn(),
}));

vi.mock('../../src/runners/claude-usage.js', () => ({
  readClaudeSessionUsage: vi.fn(),
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

vi.mock('../../src/git.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/git.js')>();
  return {
    ...actual,
    getHead: vi.fn().mockReturnValue('mock-head-sha'),
  };
});

vi.mock('../../src/state.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/state.js')>();
  return {
    ...actual,
    writeState: vi.fn(),
  };
});

import { runInteractivePhase } from '../../src/phases/interactive.js';
import { printWarning } from '../../src/ui.js';
import { NoopLogger } from '../../src/logger.js';
import { handleInteractivePhase, WATCHDOG_DELAY_MS } from '../../src/phases/runner.js';

function makeState(overrides: Partial<HarnessState> = {}): HarnessState {
  return {
    ...createInitialState('watchdog-run', 'task', 'base-sha', false),
    tmuxWorkspacePane: '%42',
    ...overrides,
  };
}

function deferredResult<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('interactive watchdog', () => {
  it('emits the folder-trust hint once after the watchdog delay for Claude interactive phases', async () => {
    const pending = deferredResult<{ status: 'completed'; attemptId: string }>();
    vi.mocked(runInteractivePhase).mockReturnValueOnce(pending.promise as any);

    const state = makeState({ currentPhase: 1 });
    const promise = handleInteractivePhase(1, state, '/tmp/harness', '/tmp/run', '/tmp/cwd', new NoopLogger());

    await vi.advanceTimersByTimeAsync(WATCHDOG_DELAY_MS);

    expect(vi.mocked(printWarning)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(printWarning)).toHaveBeenCalledWith(
      '⚠️  30s 동안 출력 없음 — Claude 작업 창에서 folder-trust 다이얼로그 대기 중일 수 있음 (tmux pane: %42).',
    );

    await vi.advanceTimersByTimeAsync(WATCHDOG_DELAY_MS);
    expect(vi.mocked(printWarning)).toHaveBeenCalledTimes(1);

    pending.resolve({ status: 'completed', attemptId: 'attempt-1' });
    await promise;
  });

  it('clears the watchdog before it can fire on a completed phase', async () => {
    const pending = deferredResult<{ status: 'completed'; attemptId: string }>();
    vi.mocked(runInteractivePhase).mockReturnValueOnce(pending.promise as any);

    const state = makeState({ currentPhase: 1 });
    const promise = handleInteractivePhase(1, state, '/tmp/harness', '/tmp/run', '/tmp/cwd', new NoopLogger());

    pending.resolve({ status: 'completed', attemptId: 'attempt-2' });
    await promise;
    await vi.advanceTimersByTimeAsync(WATCHDOG_DELAY_MS);

    expect(vi.mocked(printWarning)).not.toHaveBeenCalled();
  });

  it('clears the watchdog before it can fire on a failed phase', async () => {
    const pending = deferredResult<{ status: 'failed'; attemptId: string }>();
    vi.mocked(runInteractivePhase).mockReturnValueOnce(pending.promise as any);

    const state = makeState({ currentPhase: 1 });
    const promise = handleInteractivePhase(1, state, '/tmp/harness', '/tmp/run', '/tmp/cwd', new NoopLogger());

    pending.resolve({ status: 'failed', attemptId: 'attempt-3' });
    await promise;
    await vi.advanceTimersByTimeAsync(WATCHDOG_DELAY_MS);

    expect(vi.mocked(printWarning)).not.toHaveBeenCalled();
  });

  it('clears the watchdog before it can fire when the interactive phase throws', async () => {
    const pending = deferredResult<never>();
    vi.mocked(runInteractivePhase).mockReturnValueOnce(pending.promise as any);

    const state = makeState({ currentPhase: 1 });
    const promise = handleInteractivePhase(1, state, '/tmp/harness', '/tmp/run', '/tmp/cwd', new NoopLogger());

    pending.reject(new Error('boom'));
    await expect(promise).rejects.toThrow('boom');
    await vi.advanceTimersByTimeAsync(WATCHDOG_DELAY_MS);

    expect(vi.mocked(printWarning)).not.toHaveBeenCalled();
  });

  it('clears the watchdog before it can fire on redirected control-flow', async () => {
    vi.mocked(runInteractivePhase).mockImplementationOnce(async (_phase, state, _h, _r, _c, attemptId) => {
      state.currentPhase = 3;
      return { status: 'completed', attemptId };
    });

    const state = makeState({ currentPhase: 1 });
    await handleInteractivePhase(1, state, '/tmp/harness', '/tmp/run', '/tmp/cwd', new NoopLogger());
    await vi.advanceTimersByTimeAsync(WATCHDOG_DELAY_MS);

    expect(vi.mocked(printWarning)).not.toHaveBeenCalled();
  });

  it('does not arm the watchdog for codex interactive presets', async () => {
    vi.mocked(runInteractivePhase).mockResolvedValueOnce({ status: 'completed', attemptId: 'attempt-4' } as any);

    const state = makeState({ currentPhase: 1 });
    state.phasePresets['1'] = 'codex-high';

    await handleInteractivePhase(1, state, '/tmp/harness', '/tmp/run', '/tmp/cwd', new NoopLogger());
    await vi.advanceTimersByTimeAsync(WATCHDOG_DELAY_MS);

    expect(vi.mocked(printWarning)).not.toHaveBeenCalled();
  });
});
