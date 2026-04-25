import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { CurrentPhase } from '../../../src/ink/components/CurrentPhase.js';
import { createInitialState } from '../../../src/state.js';
import type { HarnessState } from '../../../src/types.js';

function makeState(overrides: Partial<HarnessState> = {}): HarnessState {
  const base = createInitialState('run', 'task', 'base', false);
  return { ...base, ...overrides };
}

function expectLinesWithin(frame: string | undefined, columns: number): void {
  for (const line of (frame ?? '').split('\n')) {
    expect(line.length).toBeLessThanOrEqual(columns);
  }
}

describe('CurrentPhase', () => {
  it('shows phase number and label (full flow)', () => {
    const state = makeState({ currentPhase: 3, flow: 'full' });
    state.phases['3'] = 'in_progress';
    const { lastFrame } = render(<CurrentPhase state={state} />);
    expect(lastFrame()).toContain('3');
    expect(lastFrame()).toContain('Plan 작성');
  });

  it('shows "설계+플랜" for phase 1 in light flow', () => {
    const state = makeState({ currentPhase: 1, flow: 'light' });
    const { lastFrame } = render(<CurrentPhase state={state} />);
    expect(lastFrame()).toContain('설계+플랜');
    expect(lastFrame()).not.toContain('Spec 작성');
  });

  it('shows in_progress status', () => {
    const state = makeState({ currentPhase: 5 });
    state.phases['5'] = 'in_progress';
    const { lastFrame } = render(<CurrentPhase state={state} />);
    expect(lastFrame()).toContain('in_progress');
    expect(lastFrame()).toContain('Waiting for phase completion.');
  });

  it('shows completed status', () => {
    const state = makeState({ currentPhase: 1 });
    state.phases['1'] = 'completed';
    const { lastFrame } = render(<CurrentPhase state={state} />);
    expect(lastFrame()).toContain('completed');
  });

  it('shows failed status', () => {
    const state = makeState({ currentPhase: 3 });
    state.phases['3'] = 'failed';
    const { lastFrame } = render(<CurrentPhase state={state} />);
    expect(lastFrame()).toContain('failed');
  });

  it('shows error status', () => {
    const state = makeState({ currentPhase: 5 });
    state.phases['5'] = 'error';
    const { lastFrame } = render(<CurrentPhase state={state} />);
    expect(lastFrame()).toContain('error');
  });

  it('shows gate retry index when gateRetries > 0', () => {
    const state = makeState({ currentPhase: 2 });
    state.phases['2'] = 'in_progress';
    state.gateRetries['2'] = 1;
    const { lastFrame } = render(<CurrentPhase state={state} />);
    expect(lastFrame()).toContain('retry 1');
  });

  it('shows preset model/runner/effort when phasePresets is set', () => {
    const state = makeState({ currentPhase: 3, phasePresets: { '3': 'sonnet-high' } });
    state.phases['3'] = 'in_progress';
    const { lastFrame } = render(<CurrentPhase state={state} />);
    const frame = lastFrame();
    // sonnet-high preset: model=claude-sonnet-4-6, runner=claude, effort=high
    expect(frame).toContain('claude-sonnet-4-6');
    expect(frame).toContain('claude');
    expect(frame).toContain('high');
  });

  it('truncates long preset details at narrow width', () => {
    const state = makeState({ currentPhase: 3, phasePresets: { '3': 'sonnet-high' } });
    const { lastFrame } = render(<CurrentPhase state={state} columns={30} />);
    const frame = lastFrame();
    expect(frame).toContain('claude-sonnet-4-6');
    expect(frame).toContain('…');
    expectLinesWithin(frame, 30);
  });

  it('compacts the current phase summary at narrow width', () => {
    const state = makeState({ currentPhase: 5 });
    state.phases['5'] = 'in_progress';
    const { lastFrame } = render(<CurrentPhase state={state} columns={30} />);
    const frame = lastFrame();
    expect(frame).toContain('Current P5');
    expect(frame).not.toContain('Current Phase');
    expectLinesWithin(frame, 30);
  });
});
