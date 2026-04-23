import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { ActionMenu } from '../../../src/ink/components/ActionMenu.js';
import { createInitialState } from '../../../src/state.js';
import type { HarnessState } from '../../../src/types.js';

function makeState(overrides: Partial<HarnessState> = {}): HarnessState {
  return { ...createInitialState('run', 'task', 'base', false), ...overrides };
}

describe('ActionMenu', () => {
  it('shows hint form at non-terminal callsite', () => {
    const { lastFrame } = render(<ActionMenu state={makeState()} callsite="loop-top" />);
    expect(lastFrame()).toContain('[R]');
    expect(lastFrame()).toContain('[J]');
    expect(lastFrame()).toContain('[Q]');
  });

  it('shows prominent form at terminal-failed callsite', () => {
    const { lastFrame } = render(<ActionMenu state={makeState()} callsite="terminal-failed" />);
    expect(lastFrame()).toContain('[R]');
    expect(lastFrame()).toContain('[J]');
    expect(lastFrame()).toContain('[Q]');
  });

  it('shows hint form (not prominent) at terminal-complete callsite', () => {
    const { lastFrame } = render(<ActionMenu state={makeState()} callsite="terminal-complete" />);
    expect(lastFrame()).toContain('[R]');
  });

  it('shows hint form when a phase has failed but callsite is not terminal-failed', () => {
    const state = makeState();
    state.phases['3'] = 'failed';
    const { lastFrame } = render(<ActionMenu state={state} callsite="gate-approve" />);
    expect(lastFrame()).toContain('[R]');
  });

  it('renders without crashing at narrow width', () => {
    expect(() => render(<ActionMenu state={makeState()} callsite="loop-top" />)).not.toThrow();
  });
});
