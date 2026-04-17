import { describe, it, expect } from 'vitest';
import { MODEL_PRESETS, PHASE_DEFAULTS, REQUIRED_PHASE_KEYS, getPresetById, getEffectiveReopenTarget } from '../../src/config.js';
import type { PendingAction } from '../../src/types.js';

describe('MODEL_PRESETS conformance', () => {
  it('contains at least one claude and one codex preset', () => {
    expect(MODEL_PRESETS.some(p => p.runner === 'claude')).toBe(true);
    expect(MODEL_PRESETS.some(p => p.runner === 'codex')).toBe(true);
  });

  it('every preset has all required fields', () => {
    for (const p of MODEL_PRESETS) {
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(['claude', 'codex']).toContain(p.runner);
      expect(p.model).toBeTruthy();
      expect(p.effort).toBeTruthy();
    }
  });

  it('preset IDs are unique', () => {
    const ids = MODEL_PRESETS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('PHASE_DEFAULTS conformance', () => {
  it('defines defaults for all required phases', () => {
    for (const key of REQUIRED_PHASE_KEYS) {
      expect(PHASE_DEFAULTS[Number(key)]).toBeDefined();
    }
  });

  it('all default preset IDs are valid', () => {
    for (const presetId of Object.values(PHASE_DEFAULTS)) {
      expect(getPresetById(presetId)).toBeDefined();
    }
  });

  it('does not define Phase 6', () => {
    expect(PHASE_DEFAULTS[6]).toBeUndefined();
  });
});

describe('getEffectiveReopenTarget', () => {
  it('returns targetPhase for reopen_phase', () => {
    const pa: PendingAction = { type: 'reopen_phase', targetPhase: 1, sourcePhase: 2, feedbackPaths: [] };
    expect(getEffectiveReopenTarget(pa)).toBe(1);
  });

  it('returns sourcePhase for show_escalation', () => {
    const pa: PendingAction = { type: 'show_escalation', targetPhase: 2, sourcePhase: 1, feedbackPaths: [] };
    expect(getEffectiveReopenTarget(pa)).toBe(1);
  });

  it('returns null for reopen_config', () => {
    const pa: PendingAction = { type: 'reopen_config', targetPhase: 1, sourcePhase: null, feedbackPaths: [] };
    expect(getEffectiveReopenTarget(pa)).toBeNull();
  });
});
