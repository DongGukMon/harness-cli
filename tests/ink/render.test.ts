import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HarnessState, SessionLogger, RenderCallsite } from '../../src/types.js';
import { createInitialState } from '../../src/state.js';

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
