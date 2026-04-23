import { describe, it, expect, vi } from 'vitest';
import { renderControlPanel, renderModelSelection } from '../src/ui.js';
import { createInitialState } from '../src/state.js';
import type { HarnessState, SessionLogger } from '../src/types.js';

function makeState(overrides: Partial<HarnessState> = {}): HarnessState {
  const base = createInitialState('run', 't', 'base', false);
  return { ...base, ...overrides };
}


describe('renderModelSelection — flow-aware row visibility', () => {
  it('hides spec-gate + plan-gate rows for light and shows "설계+플랜" label', () => {
    const captured: string[] = [];
    const origErr = console.error;
    console.error = (...args: any[]) => { captured.push(args.join(' ')); };
    try {
      renderModelSelection(
        { '1': 'opus-max', '5': 'sonnet-high', '7': 'codex-high' },
        new Set(['1', '5', '7']),
        'light',
      );
    } finally {
      console.error = origErr;
    }
    const transcript = captured.join('\n');
    expect(transcript).toMatch(/Phase 1 \(설계\+플랜\)/);
    expect(transcript).toMatch(/Phase 5 \(구현\)/);
    expect(transcript).toMatch(/Phase 7 \(Eval Gate\)/);
    expect(transcript).not.toMatch(/Phase 2 \(Spec Gate\)/);
    expect(transcript).not.toMatch(/Phase 3 \(Plan 작성\)/);
    expect(transcript).not.toMatch(/Phase 4 \(Plan Gate\)/);
  });

  it('shows "Spec 작성" for Phase 1 when flow is full (default)', () => {
    const captured: string[] = [];
    const origErr = console.error;
    console.error = (...args: any[]) => { captured.push(args.join(' ')); };
    try {
      renderModelSelection(
        { '1': 'opus-xhigh', '5': 'sonnet-high', '7': 'codex-high' },
        new Set(['1', '5', '7']),
      );
    } finally {
      console.error = origErr;
    }
    const transcript = captured.join('\n');
    expect(transcript).toMatch(/Phase 1 \(Spec 작성\)/);
  });
});

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

describe('renderControlPanel — ui_render emission', () => {
  it('emits ui_render when both logger and callsite are provided', () => {
    const state = makeState({ flow: 'full', currentPhase: 5 });
    state.phases['5'] = 'in_progress';
    const logger = makeLogger();
    renderControlPanel(state, logger, 'loop-top');
    expect(logger.logEvent).toHaveBeenCalledWith({
      event: 'ui_render',
      phase: 5,
      phaseStatus: 'in_progress',
      callsite: 'loop-top',
    });
  });

  it('does not emit when logger is omitted', () => {
    const state = makeState();
    renderControlPanel(state);
    // No assertion on logger — passes as long as no throw.
  });

  it('does not emit when callsite is omitted', () => {
    const state = makeState();
    const logger = makeLogger();
    renderControlPanel(state, logger);
    expect(logger.logEvent).not.toHaveBeenCalled();
  });
});

describe('helper mount-guard — mounted flag; promptChoice is NOT guarded', () => {
  it('mounted is false in non-TTY test environment (Ink never mounted)', async () => {
    const { mounted } = await import('../src/ink/render.js');
    // In test environment (no TTY), Ink is never mounted
    expect(mounted).toBe(false);
  });
});
