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

describe('renderModelSelection — flow-aware row visibility', () => {
  it('hides spec-gate + plan-gate rows for light', () => {
    const captured: string[] = [];
    const origErr = console.error;
    console.error = (...args: any[]) => { captured.push(args.join(' ')); };
    try {
      renderModelSelection(
        { '1': 'opus-max', '5': 'sonnet-high', '7': 'codex-high' },
        new Set(['1', '5', '7']),
      );
    } finally {
      console.error = origErr;
    }
    const transcript = captured.join('\n');
    expect(transcript).toMatch(/Phase 1 \(Spec 작성\)/);
    expect(transcript).toMatch(/Phase 5 \(구현\)/);
    expect(transcript).toMatch(/Phase 7 \(Eval Gate\)/);
    expect(transcript).not.toMatch(/Phase 2 \(Spec Gate\)/);
    expect(transcript).not.toMatch(/Phase 3 \(Plan 작성\)/);
    expect(transcript).not.toMatch(/Phase 4 \(Plan Gate\)/);
  });
});
