import { describe, it, expect } from 'vitest';
import { renderControlPanel, renderModelSelection } from '../src/ui.js';
import { createInitialState } from '../src/state.js';
import type { HarnessState } from '../src/types.js';

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
