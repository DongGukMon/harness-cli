import { describe, expect, it } from 'vitest';
import {
  getGateRetryLimit,
  LIGHT_PHASE_DEFAULTS,
  LIGHT_REQUIRED_PHASE_KEYS,
  MODEL_PRESETS,
  PHASE_DEFAULTS,
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
  it('defaults Phase 1 to Opus 4.7 xhigh for full and light flows', () => {
    expect(PHASE_DEFAULTS[1]).toBe('opus-1m-xhigh');
    expect(LIGHT_PHASE_DEFAULTS[1]).toBe('opus-1m-xhigh');
    expect(MODEL_PRESETS.find(p => p.id === 'opus-1m-xhigh')).toMatchObject({
      model: 'claude-opus-4-7[1m]',
      effort: 'xhigh',
    });
  });

  it('uses GPT-5.5 for Codex presets', () => {
    expect(MODEL_PRESETS.find(p => p.id === 'codex-high')).toMatchObject({
      model: 'gpt-5.5',
      effort: 'high',
    });
    expect(MODEL_PRESETS.find(p => p.id === 'codex-medium')).toMatchObject({
      model: 'gpt-5.5',
      effort: 'medium',
    });
  });

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
