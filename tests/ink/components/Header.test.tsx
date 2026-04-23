import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Header } from '../../../src/ink/components/Header.js';
import { createInitialState } from '../../../src/state.js';
import type { HarnessState } from '../../../src/types.js';

function makeState(overrides: Partial<HarnessState> = {}): HarnessState {
  return { ...createInitialState('run-2026-04-23-test', 'task', 'abc123', false), ...overrides };
}

describe('Header', () => {
  it('shows "Harness Control Panel" title', () => {
    const { lastFrame } = render(<Header state={makeState()} />);
    expect(lastFrame()).toContain('Harness Control Panel');
  });

  it('shows run ID', () => {
    const state = makeState({ runId: '2026-04-23-untitled-4a69' });
    const { lastFrame } = render(<Header state={state} />);
    expect(lastFrame()).toContain('2026-04-23-untitled-4a69');
  });

  it('shows [full] badge for full flow', () => {
    const { lastFrame } = render(<Header state={makeState({ flow: 'full' })} />);
    expect(lastFrame()).toContain('[full]');
  });

  it('shows [light] badge for light flow', () => {
    const { lastFrame } = render(<Header state={makeState({ flow: 'light' })} />);
    expect(lastFrame()).toContain('[light]');
  });

  it('shows elapsed time when elapsedMs is provided', () => {
    const { lastFrame } = render(<Header state={makeState()} elapsedMs={90_000} />);
    expect(lastFrame()).toContain('1m30s');
  });

  it('omits elapsed time when elapsedMs is null', () => {
    const { lastFrame } = render(<Header state={makeState()} elapsedMs={null} />);
    // Should not contain "m" as part of a time format
    expect(lastFrame()).not.toMatch(/\d+m\d+s/);
  });

  it('renders without crashing at narrow width', () => {
    expect(() => render(<Header state={makeState()} />)).not.toThrow();
  });
});
