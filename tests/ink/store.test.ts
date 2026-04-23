import { describe, it, expect, vi, beforeEach } from 'vitest';

// Store is a singleton — reset between tests via re-import or by testing state flow
describe('store', () => {
  it('dispatch notifies subscriber with state snapshot', async () => {
    const { dispatch, subscribe } = await import('../../src/ink/store.js');
    const { createInitialState } = await import('../../src/state.js');
    const state = createInitialState('run-1', 'task', 'base', false);
    const listener = vi.fn();
    const unsub = subscribe(listener);
    dispatch({ state, callsite: 'loop-top' });
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].state).toBe(state);
    expect(listener.mock.calls[0][0].callsite).toBe('loop-top');
    unsub();
  });

  it('dispatchFooter updates footerSummary without replacing state', async () => {
    const { dispatch, dispatchFooter, subscribe } = await import('../../src/ink/store.js');
    const { createInitialState } = await import('../../src/state.js');
    const state = createInitialState('run-2', 'task', 'base', false);
    dispatch({ state, callsite: 'loop-top' });
    const summary = { currentPhase: 1, attempt: 1, phaseRunningElapsedMs: 1000, sessionElapsedMs: 2000, claudeTokens: 500000, gateTokens: 200000, totalTokens: 700000 };
    const listener = vi.fn();
    const unsub = subscribe(listener);
    dispatchFooter(summary);
    expect(listener.mock.calls[0][0].footerSummary).toEqual(summary);
    expect(listener.mock.calls[0][0].state).toBe(state);
    unsub();
  });

  it('unsubscribe stops future notifications', async () => {
    const { dispatch, subscribe } = await import('../../src/ink/store.js');
    const { createInitialState } = await import('../../src/state.js');
    const state = createInitialState('run-3', 'task', 'base', false);
    const listener = vi.fn();
    const unsub = subscribe(listener);
    unsub();
    dispatch({ state, callsite: 'loop-top' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('getSnapshot returns the last dispatched state', async () => {
    const { dispatch, getSnapshot } = await import('../../src/ink/store.js');
    const { createInitialState } = await import('../../src/state.js');
    const state = createInitialState('run-4', 'task', 'base', false);
    dispatch({ state, callsite: 'loop-top' });
    expect(getSnapshot()?.state).toBe(state);
  });
});
