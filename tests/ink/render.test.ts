import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import type { HarnessState, SessionLogger, RenderCallsite } from '../../src/types.js';
import { createInitialState } from '../../src/state.js';
import { App } from '../../src/ink/App.js';
import { dispatch, dispatchFooter } from '../../src/ink/store.js';

function makeState(): HarnessState {
  return createInitialState('run', 'task', 'base', false);
}

function makeLogger(): SessionLogger {
  return {
    logEvent: vi.fn(),
    writeMeta: vi.fn(),
    updateMeta: vi.fn(),
    finalizeSummary: vi.fn(),
    close: vi.fn(),
    hasBootstrapped: () => false,
    hasEmittedSessionOpen: () => true,
    getStartedAt: () => 0,
    getEventsPath: () => null,
  };
}

const ALL_CALLSITES: RenderCallsite[] = [
  'loop-top',
  'interactive-redirect',
  'interactive-complete',
  'gate-redirect',
  'gate-approve',
  'verify-complete',
  'verify-redirect',
  'terminal-failed',
  'terminal-complete',
];

describe('render facade — ui_render emission', () => {
  it.each(ALL_CALLSITES)('emits ui_render for callsite: %s', async (callsite) => {
    const { renderInkControlPanel } = await import('../../src/ink/render.js');
    const state = makeState();
    state.phases['1'] = 'in_progress';
    const logger = makeLogger();
    renderInkControlPanel(state, logger, callsite);
    expect(logger.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'ui_render', callsite }),
    );
  });

  it('does not emit when callsite is omitted', async () => {
    const { renderInkControlPanel } = await import('../../src/ink/render.js');
    const logger = makeLogger();
    renderInkControlPanel(makeState(), logger);
    expect(logger.logEvent).not.toHaveBeenCalled();
  });
});

describe('App layout', () => {
  it('renders header, progress, current phase, outcome, action row, and footer in order', () => {
    const state = makeState();
    state.currentPhase = 5;
    state.phases['2'] = 'completed';
    state.phases['5'] = 'in_progress';

    dispatch({ state, callsite: 'loop-top' });
    dispatchFooter({
      currentPhase: 5,
      attempt: 1,
      phaseRunningElapsedMs: 12_000,
      sessionElapsedMs: 60_000,
      claudeTokens: 100,
      gateTokens: 25,
      totalTokens: 125,
      tmuxSession: 'harness-run',
    });

    const { lastFrame } = render(React.createElement(App));
    const frame = lastFrame() ?? '';
    const header = frame.indexOf('Harness Control Panel');
    const progress = frame.indexOf('Progress');
    const current = frame.indexOf('Current');
    const outcome = frame.indexOf('Outcome');
    const status = frame.indexOf('Status');
    const footer = frame.indexOf('attach: tmux attach -t harness-run');

    expect(header).toBeGreaterThanOrEqual(0);
    expect(progress).toBeGreaterThan(header);
    expect(current).toBeGreaterThan(progress);
    expect(outcome).toBeGreaterThan(current);
    expect(status).toBeGreaterThan(outcome);
    expect(footer).toBeGreaterThan(status);
    expect(frame).not.toMatch(/····/);
  });
});
