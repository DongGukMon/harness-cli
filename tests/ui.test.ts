import { describe, it, expect, vi } from 'vitest';
import { renderControlPanel, renderModelSelection } from '../src/ui.js';
import { createInitialState } from '../src/state.js';
import type { HarnessState, SessionLogger } from '../src/types.js';

function makeState(overrides: Partial<HarnessState> = {}): HarnessState {
  const base = createInitialState('run', 't', 'base', false);
  return { ...base, ...overrides };
}

describe('renderControlPanel — skipped phases', () => {
  it('renders "skipped" as "(skipped)" without success/error glyphs', () => {
    const state = makeState({ flow: 'light' });
    state.phases['2'] = 'skipped';
    state.phases['3'] = 'skipped';
    state.phases['4'] = 'skipped';
    const captured: string[] = [];
    const origErr = console.error;
    console.error = (...args: any[]) => { captured.push(args.join(' ')); };
    try {
      renderControlPanel(state);
    } finally {
      console.error = origErr;
    }
    const transcript = captured.join('\n');
    expect(transcript).toMatch(/Phase 2: .* \(skipped\)/);
    expect(transcript).toMatch(/Phase 3: .* \(skipped\)/);
    expect(transcript).toMatch(/Phase 4: .* \(skipped\)/);
    expect(transcript).not.toMatch(/✗.*Phase [234]/);
  });
});

describe('renderControlPanel — flow-aware Phase 1 label', () => {
  it('shows "설계+플랜" for Phase 1 in light flow', () => {
    const state = makeState({ flow: 'light', currentPhase: 1 });
    const captured: string[] = [];
    const origErr = console.error;
    console.error = (...args: any[]) => { captured.push(args.join(' ')); };
    try {
      renderControlPanel(state);
    } finally {
      console.error = origErr;
    }
    const transcript = captured.join('\n');
    expect(transcript).toMatch(/Phase 1.*설계\+플랜/);
    expect(transcript).not.toMatch(/Phase 1.*Spec 작성/);
  });

  it('shows "Spec 작성" for Phase 1 in full flow', () => {
    const state = makeState({ flow: 'full', currentPhase: 1 });
    const captured: string[] = [];
    const origErr = console.error;
    console.error = (...args: any[]) => { captured.push(args.join(' ')); };
    try {
      renderControlPanel(state);
    } finally {
      console.error = origErr;
    }
    const transcript = captured.join('\n');
    expect(transcript).toMatch(/Phase 1.*Spec 작성/);
    expect(transcript).not.toMatch(/Phase 1.*설계\+플랜/);
  });
});

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
    const captured: string[] = [];
    const origErr = console.error;
    console.error = (...args: any[]) => { captured.push(args.join(' ')); };
    try {
      renderControlPanel(state, logger, 'unit-test');
    } finally {
      console.error = origErr;
    }
    expect(logger.logEvent).toHaveBeenCalledWith({
      event: 'ui_render',
      phase: 5,
      phaseStatus: 'in_progress',
      callsite: 'unit-test',
    });
  });

  it('does not emit when logger is omitted', () => {
    const state = makeState();
    const captured: string[] = [];
    const origErr = console.error;
    console.error = (...args: any[]) => { captured.push(args.join(' ')); };
    try {
      renderControlPanel(state); // legacy single-arg call
    } finally {
      console.error = origErr;
    }
    // No assertion on logger; the test passes as long as no throw and no logger call.
  });

  it('does not emit when callsite is omitted', () => {
    const state = makeState();
    const logger = makeLogger();
    const captured: string[] = [];
    const origErr = console.error;
    console.error = (...args: any[]) => { captured.push(args.join(' ')); };
    try {
      renderControlPanel(state, logger);
    } finally {
      console.error = origErr;
    }
    expect(logger.logEvent).not.toHaveBeenCalled();
  });
});
