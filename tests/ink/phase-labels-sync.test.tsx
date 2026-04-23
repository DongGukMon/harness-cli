import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { PhaseTimeline } from '../../src/ink/components/PhaseTimeline.js';
import { CurrentPhase } from '../../src/ink/components/CurrentPhase.js';
import { phaseLabel } from '../../src/ink/phase-labels.js';
import { createInitialState } from '../../src/state.js';
import type { HarnessState } from '../../src/types.js';

function makeState(overrides: Partial<HarnessState> = {}): HarnessState {
  return { ...createInitialState('run', 'task', 'base', false), ...overrides };
}

describe('phase-labels sync', () => {
  it('PhaseTimeline full flow shows labels matching phaseLabel(key, full)', () => {
    const state = makeState({ flow: 'full', currentPhase: 1 });
    const { lastFrame } = render(<PhaseTimeline state={state} />);
    const frame = lastFrame();
    expect(frame).toContain(phaseLabel('1', 'full')); // 'Spec 작성'
    expect(frame).toContain(phaseLabel('3', 'full')); // 'Plan 작성'
    expect(frame).toContain(phaseLabel('7', 'full')); // 'Eval Gate'
  });

  it('CurrentPhase full flow shows label matching phaseLabel(key, full)', () => {
    const state = makeState({ flow: 'full', currentPhase: 3 });
    const { lastFrame } = render(<CurrentPhase state={state} />);
    expect(lastFrame()).toContain(phaseLabel('3', 'full')); // 'Plan 작성'
  });

  it('PhaseTimeline light flow shows labels matching phaseLabel(key, light)', () => {
    const state = makeState({ flow: 'light', currentPhase: 1 });
    state.phases['3'] = 'skipped';
    state.phases['4'] = 'skipped';
    const { lastFrame } = render(<PhaseTimeline state={state} />);
    const frame = lastFrame();
    expect(frame).toContain(phaseLabel('1', 'light')); // '설계+플랜'
    expect(frame).toContain(phaseLabel('5', 'light')); // '구현'
  });

  it('CurrentPhase light flow shows label matching phaseLabel(key, light)', () => {
    const state = makeState({ flow: 'light', currentPhase: 1 });
    const { lastFrame } = render(<CurrentPhase state={state} />);
    expect(lastFrame()).toContain(phaseLabel('1', 'light')); // '설계+플랜'
  });
});
