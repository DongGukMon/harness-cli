import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { PhaseTimeline } from '../../../src/ink/components/PhaseTimeline.js';
import { createInitialState } from '../../../src/state.js';
import type { HarnessState } from '../../../src/types.js';

function makeState(overrides: Partial<HarnessState> = {}): HarnessState {
  return { ...createInitialState('run', 'task', 'base', false), ...overrides };
}

describe('PhaseTimeline — full flow', () => {
  it('shows all 7 phase labels', () => {
    const state = makeState({ flow: 'full', currentPhase: 1 });
    const { lastFrame } = render(<PhaseTimeline state={state} />);
    const frame = lastFrame();
    expect(frame).toContain('Spec 작성');
    expect(frame).toContain('Spec Gate');
    expect(frame).toContain('Plan 작성');
    expect(frame).toContain('Plan Gate');
    expect(frame).toContain('구현');
    expect(frame).toContain('검증');
    expect(frame).toContain('Eval Gate');
  });

  it('shows ✓ for completed phases', () => {
    const state = makeState({ flow: 'full', currentPhase: 3 });
    state.phases['1'] = 'completed';
    state.phases['2'] = 'completed';
    const { lastFrame } = render(<PhaseTimeline state={state} />);
    expect(lastFrame()).toContain('✓');
  });

  it('shows ✗ for failed phases', () => {
    const state = makeState({ flow: 'full', currentPhase: 5 });
    state.phases['5'] = 'failed';
    const { lastFrame } = render(<PhaseTimeline state={state} />);
    expect(lastFrame()).toContain('✗');
  });
});

describe('PhaseTimeline — light flow', () => {
  it('shows exactly phases 1, 2, 5, 6, 7 (no 3 or 4)', () => {
    const state = makeState({ flow: 'light', currentPhase: 1 });
    state.phases['3'] = 'skipped';
    state.phases['4'] = 'skipped';
    const { lastFrame } = render(<PhaseTimeline state={state} />);
    const frame = lastFrame();
    expect(frame).toContain('설계+플랜');
    expect(frame).toContain('Spec Gate');
    expect(frame).toContain('구현');
    expect(frame).toContain('검증');
    expect(frame).toContain('Eval Gate');
    expect(frame).not.toContain('Plan 작성');
    expect(frame).not.toContain('Plan Gate');
  });

  it('light flow has 5 slots (5 opening brackets)', () => {
    const state = makeState({ flow: 'light', currentPhase: 1 });
    state.phases['3'] = 'skipped';
    state.phases['4'] = 'skipped';
    const { lastFrame } = render(<PhaseTimeline state={state} />);
    const frame = lastFrame() ?? '';
    const slots = (frame.match(/\[/g) ?? []).length;
    expect(slots).toBe(5);
  });
});

describe('PhaseTimeline — narrow width', () => {
  it('renders without crashing at columns=40', () => {
    const state = makeState({ flow: 'full', currentPhase: 1 });
    expect(() => render(<PhaseTimeline state={state} columns={40} />)).not.toThrow();
  });
});
