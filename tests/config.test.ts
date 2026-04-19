import { describe, expect, it } from 'vitest';
import {
  getGateRetryLimit,
  LIGHT_PHASE_DEFAULTS,
  LIGHT_REQUIRED_PHASE_KEYS,
  getPhaseDefaults,
} from '../src/config.js';

describe('getGateRetryLimit', () => {
  it('returns 3 for full flow, no gate', () => {
    expect(getGateRetryLimit('full')).toBe(3);
  });

  it('returns 3 for full flow, gate 2', () => {
    expect(getGateRetryLimit('full', 2)).toBe(3);
  });

  it('returns 3 for light flow, gate 2 (matches full-flow P2 budget)', () => {
    expect(getGateRetryLimit('light', 2)).toBe(3);
  });

  it('returns 5 for light flow, gate 7', () => {
    expect(getGateRetryLimit('light', 7)).toBe(5);
  });

  it('returns 5 for light flow, no gate argument', () => {
    expect(getGateRetryLimit('light')).toBe(5);
  });
});

describe('light flow phase config', () => {
  it('LIGHT_PHASE_DEFAULTS includes phase 2 as codex-high', () => {
    expect(LIGHT_PHASE_DEFAULTS[2]).toBe('codex-high');
  });

  it('LIGHT_REQUIRED_PHASE_KEYS includes "2"', () => {
    expect(Array.from(LIGHT_REQUIRED_PHASE_KEYS)).toContain('2');
  });

  it('getPhaseDefaults("light") includes phase 2 as codex-high', () => {
    expect(getPhaseDefaults('light')[2]).toBe('codex-high');
  });
});
