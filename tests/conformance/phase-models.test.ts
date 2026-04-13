import { describe, it, expect } from 'vitest';
import { PHASE_MODELS, PHASE_EFFORTS } from '../../src/config.js';

describe('PHASE_MODELS conformance', () => {
  it('Phase 1 uses claude-opus-4-6', () => {
    expect(PHASE_MODELS[1]).toBe('claude-opus-4-6');
  });

  it('Phase 3 uses claude-sonnet-4-6', () => {
    expect(PHASE_MODELS[3]).toBe('claude-sonnet-4-6');
  });

  it('Phase 5 uses claude-sonnet-4-6', () => {
    expect(PHASE_MODELS[5]).toBe('claude-sonnet-4-6');
  });

  it('does not define models for non-interactive phases', () => {
    expect(PHASE_MODELS[2]).toBeUndefined();
    expect(PHASE_MODELS[4]).toBeUndefined();
    expect(PHASE_MODELS[6]).toBeUndefined();
    expect(PHASE_MODELS[7]).toBeUndefined();
  });

  it('defines exactly three entries (for phases 1, 3, 5)', () => {
    expect(Object.keys(PHASE_MODELS).sort()).toEqual(['1', '3', '5']);
  });
});

describe('PHASE_EFFORTS conformance', () => {
  it('Phase 1 uses max effort', () => {
    expect(PHASE_EFFORTS[1]).toBe('max');
  });

  it('Phase 3 uses high effort', () => {
    expect(PHASE_EFFORTS[3]).toBe('high');
  });

  it('Phase 5 uses high effort', () => {
    expect(PHASE_EFFORTS[5]).toBe('high');
  });

  it('defines exactly three entries (for phases 1, 3, 5)', () => {
    expect(Object.keys(PHASE_EFFORTS).sort()).toEqual(['1', '3', '5']);
  });
});
