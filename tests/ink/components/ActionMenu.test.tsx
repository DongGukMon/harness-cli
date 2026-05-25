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
  it('does not advertise R/J/Q while the phase loop is running', () => {
    const state = makeState({ currentPhase: 1 });
    state.phases['1'] = 'in_progress';

    const { lastFrame } = render(<ActionMenu state={state} callsite="loop-top" />);

    expect(lastFrame()).toContain('Waiting for phase completion.');
    expect(lastFrame()).not.toContain('[R]');
    expect(lastFrame()).not.toContain('[J]');
    expect(lastFrame()).not.toContain('[Q]');
  });

  it('shows prominent form at terminal-failed callsite', () => {
    const { lastFrame } = render(<ActionMenu state={makeState()} callsite="terminal-failed" />);
    expect(lastFrame()).toContain('[R]');
    expect(lastFrame()).toContain('[J]');
    expect(lastFrame()).toContain('[Q]');
  });

  it('shows Ctrl+C guidance at terminal-complete callsite', () => {
    const { lastFrame } = render(<ActionMenu state={makeState()} callsite="terminal-complete" />);
    expect(lastFrame()).toContain('Ctrl+C');
    expect(lastFrame()).not.toContain('[R]');
  });

  it('does not show R/J/Q when a phase has failed but the terminal key handler is not active yet', () => {
    const state = makeState({ currentPhase: 3 });
    state.phases['3'] = 'failed';
    const { lastFrame } = render(<ActionMenu state={state} callsite="gate-approve" />);
    expect(lastFrame()).toContain('Phase stopped.');
    expect(lastFrame()).not.toContain('[R]');
  });

  it('renders without crashing at narrow width', () => {
    expect(() => render(<ActionMenu state={makeState()} callsite="loop-top" />)).not.toThrow();
  });

  // #116 B3: R-confirm-kill prompt — shown when [R] pressed and worker is alive,
  // so the operator can't silently kill an in-progress workspace worker.
  describe('#116 B3 — terminal-failed-confirm-kill callsite', () => {
    it('renders a Y/N confirmation prompt with the workspace PID', () => {
      const state = makeState({ currentPhase: 5, lastWorkspacePid: 12345 });
      state.phases['5'] = 'failed';
      const { lastFrame } = render(<ActionMenu state={state} callsite="terminal-failed-confirm-kill" />);
      const frame = lastFrame() ?? '';
      // PID surfaced so the operator sees exactly which worker is at risk.
      expect(frame).toContain('12345');
      // Y/N keys advertised — no other action keys visible.
      expect(frame).toContain('[Y]');
      expect(frame).toContain('[N]');
      // R/J should NOT be visible here — the prompt replaces the action menu.
      expect(frame).not.toContain('[R]');
      expect(frame).not.toContain('[J]');
    });

    it('shows messaging that signals "this will kill the worker"', () => {
      const state = makeState({ currentPhase: 5, lastWorkspacePid: 99 });
      state.phases['5'] = 'failed';
      const { lastFrame } = render(<ActionMenu state={state} callsite="terminal-failed-confirm-kill" />);
      const frame = (lastFrame() ?? '').toLowerCase();
      // Some verb conveying "kill / terminate" must be present so the operator
      // is not surprised by what Y does.
      expect(frame).toMatch(/kill|terminat/);
    });
  });
});
