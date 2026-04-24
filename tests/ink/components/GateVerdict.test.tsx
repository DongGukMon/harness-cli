import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { GateVerdict } from '../../../src/ink/components/GateVerdict.js';
import { createInitialState } from '../../../src/state.js';
import type { HarnessState } from '../../../src/types.js';

function makeState(overrides: Partial<HarnessState> = {}): HarnessState {
  return { ...createInitialState('run', 'task', 'base', false), ...overrides };
}

describe('GateVerdict', () => {
  it('renders nothing when no gate phase has run', () => {
    const { lastFrame } = render(<GateVerdict state={makeState()} />);
    expect(lastFrame()).toBe('');
  });

  it('shows APPROVED for completed gate phase 2', () => {
    const state = makeState();
    state.phases['2'] = 'completed';
    const { lastFrame } = render(<GateVerdict state={state} />);
    expect(lastFrame()).toContain('APPROVED');
    expect(lastFrame()).toContain('P2');
  });

  it('shows REJECTED for failed gate phase 4', () => {
    const state = makeState();
    state.phases['4'] = 'failed';
    const { lastFrame } = render(<GateVerdict state={state} />);
    expect(lastFrame()).toContain('REJECTED');
    expect(lastFrame()).toContain('P4');
  });

  it('shows retry count when gateRetries > 0', () => {
    const state = makeState();
    state.phases['7'] = 'failed';
    state.gateRetries['7'] = 2;
    const { lastFrame } = render(<GateVerdict state={state} />);
    expect(lastFrame()).toContain('retry 2');
  });

  it('shows runner info when phaseCodexSessions has runner', () => {
    const state = makeState();
    state.phases['4'] = 'failed';
    state.phaseCodexSessions['4'] = { sessionId: 'sess-1', runner: 'codex', model: 'gpt-5.5', effort: 'high', lastOutcome: 'reject' };
    const { lastFrame } = render(<GateVerdict state={state} />);
    expect(lastFrame()).toContain('codex');
  });

  it('shows runner info for approved gate', () => {
    const state = makeState();
    state.phases['2'] = 'completed';
    state.phaseCodexSessions['2'] = { sessionId: 'sess-2', runner: 'codex', model: 'gpt-5.5', effort: 'high', lastOutcome: 'approve' };
    const { lastFrame } = render(<GateVerdict state={state} />);
    expect(lastFrame()).toContain('codex');
    expect(lastFrame()).toContain('APPROVED');
  });

  it('renders without crashing when no runner info available', () => {
    const state = makeState();
    state.phases['7'] = 'completed';
    state.phaseCodexSessions['7'] = null;
    expect(() => render(<GateVerdict state={state} />)).not.toThrow();
  });
});
