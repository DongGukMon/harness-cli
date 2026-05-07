import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadAmbiguityThreshold, applyAmbiguityGate, __resetAmbiguityWarning } from '../../src/phases/ambiguity.js';
import { parseVerdict } from '../../src/phases/verdict.js';
import type { GatePhaseResult } from '../../src/types.js';

function makeApprove(rawOutput: string): GatePhaseResult {
  return {
    type: 'verdict',
    verdict: 'APPROVE',
    comments: '',
    rawOutput,
    runner: 'codex',
  };
}

function makeReject(rawOutput: string): GatePhaseResult {
  return {
    type: 'verdict',
    verdict: 'REJECT',
    comments: 'some finding',
    rawOutput,
    runner: 'codex',
  };
}

function makeError(): GatePhaseResult {
  return { type: 'error', error: 'subprocess failed', rawOutput: '' };
}

const highAmbiguityOutput = [
  '## Verdict', 'APPROVE',
  '## Summary', 'Spec looks decent.',
  '## Clarity Scores',
  '- goal: 0.45',
  '- constraint: 0.60',
  '- success: 0.85',
  '- context: 0.90',
].join('\n');
// ambiguity = 1 - (0.45*0.35 + 0.60*0.25 + 0.85*0.30 + 0.90*0.10)
//           = 1 - (0.1575 + 0.15 + 0.255 + 0.09) = 1 - 0.6525 = 0.3475 > 0.2

const lowAmbiguityOutput = [
  '## Clarity Scores',
  '- goal: 0.90',
  '- constraint: 0.85',
  '- success: 0.95',
  '- context: 0.80',
].join('\n');
// ambiguity = 1 - (0.90*0.35 + 0.85*0.25 + 0.95*0.30 + 0.80*0.10)
//           = 1 - (0.315 + 0.2125 + 0.285 + 0.08) = 1 - 0.8925 = 0.1075 < 0.2

const exactThresholdOutput = [
  '## Clarity Scores',
  '- goal: 0.8',
  '- constraint: 0.8',
  '- success: 0.8',
  '- context: 0.8',
].join('\n');
// ambiguity = 1 - 0.8 = 0.2 (exactly at threshold, should NOT veto)

beforeEach(() => {
  __resetAmbiguityWarning();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetAmbiguityWarning();
});

// ─── loadAmbiguityThreshold ──────────────────────────────────────────────────

describe('loadAmbiguityThreshold', () => {
  it('returns 0.2 when env var is unset', () => {
    delete process.env['HARNESS_GATE_AMBIGUITY_THRESHOLD'];
    expect(loadAmbiguityThreshold()).toBe(0.2);
  });

  it('returns 0.2 when env var is empty string', () => {
    vi.stubEnv('HARNESS_GATE_AMBIGUITY_THRESHOLD', '');
    expect(loadAmbiguityThreshold()).toBe(0.2);
  });

  it('returns null for "off" (case-insensitive, trimmed)', () => {
    vi.stubEnv('HARNESS_GATE_AMBIGUITY_THRESHOLD', 'off');
    expect(loadAmbiguityThreshold()).toBeNull();
    __resetAmbiguityWarning();
    vi.stubEnv('HARNESS_GATE_AMBIGUITY_THRESHOLD', 'OFF');
    expect(loadAmbiguityThreshold()).toBeNull();
    __resetAmbiguityWarning();
    vi.stubEnv('HARNESS_GATE_AMBIGUITY_THRESHOLD', '  Off  ');
    expect(loadAmbiguityThreshold()).toBeNull();
  });

  it('returns 0.0 for "0.0"', () => {
    vi.stubEnv('HARNESS_GATE_AMBIGUITY_THRESHOLD', '0.0');
    expect(loadAmbiguityThreshold()).toBe(0.0);
  });

  it('returns 1.0 for "1.0"', () => {
    vi.stubEnv('HARNESS_GATE_AMBIGUITY_THRESHOLD', '1.0');
    expect(loadAmbiguityThreshold()).toBe(1.0);
  });

  it('returns null + warn for value > 1', () => {
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.stubEnv('HARNESS_GATE_AMBIGUITY_THRESHOLD', '1.5');
    expect(loadAmbiguityThreshold()).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('returns null + warn for value < 0', () => {
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.stubEnv('HARNESS_GATE_AMBIGUITY_THRESHOLD', '-0.1');
    expect(loadAmbiguityThreshold()).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('returns null + warn for non-numeric', () => {
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.stubEnv('HARNESS_GATE_AMBIGUITY_THRESHOLD', 'abc');
    expect(loadAmbiguityThreshold()).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('warned-once: second invalid load produces no extra warning', () => {
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.stubEnv('HARNESS_GATE_AMBIGUITY_THRESHOLD', 'bad');
    loadAmbiguityThreshold();
    loadAmbiguityThreshold();
    loadAmbiguityThreshold();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('__resetAmbiguityWarning clears the warned-once state', () => {
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.stubEnv('HARNESS_GATE_AMBIGUITY_THRESHOLD', 'bad');
    loadAmbiguityThreshold();
    __resetAmbiguityWarning();
    loadAmbiguityThreshold();
    expect(warnSpy).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });
});

// ─── applyAmbiguityGate ──────────────────────────────────────────────────────

describe('applyAmbiguityGate', () => {
  it('APPROVE + ambiguity > threshold → REJECT with ambiguityVetoed', () => {
    const result = applyAmbiguityGate(makeApprove(highAmbiguityOutput), highAmbiguityOutput, 0.2);
    expect(result.type).toBe('verdict');
    if (result.type === 'verdict') {
      expect(result.verdict).toBe('REJECT');
      expect(result.ambiguityVetoed).toBe(true);
      expect(result.ambiguity).toBeCloseTo(0.3475, 4);
      expect(result.ambiguityThreshold).toBe(0.2);
      expect(result.clarityScores).toEqual({ goal: 0.45, constraint: 0.60, success: 0.85, context: 0.90 });
      expect(result.comments).toMatch(/\[P1\]/);
      expect(result.comments).toMatch(/Scope: design/);
      // rawOutput must be rewritten so sidecar replay returns REJECT
      expect(result.rawOutput).toBeDefined();
      const parsed = parseVerdict(result.rawOutput!);
      expect(parsed).not.toBeNull();
      expect(parsed!.verdict).toBe('REJECT');
      expect(parsed!.scope).toBe('design');
    }
  });

  it('APPROVE + ambiguity = threshold → unchanged (boundary inclusive on pass side)', () => {
    const result = applyAmbiguityGate(makeApprove(exactThresholdOutput), exactThresholdOutput, 0.2);
    expect(result.type).toBe('verdict');
    if (result.type === 'verdict') {
      expect(result.verdict).toBe('APPROVE');
      expect(result.ambiguityVetoed).toBeUndefined();
    }
  });

  it('APPROVE + ambiguity < threshold → unchanged, scores attached', () => {
    const result = applyAmbiguityGate(makeApprove(lowAmbiguityOutput), lowAmbiguityOutput, 0.2);
    expect(result.type).toBe('verdict');
    if (result.type === 'verdict') {
      expect(result.verdict).toBe('APPROVE');
      expect(result.ambiguityVetoed).toBeUndefined();
      expect(result.clarityScores).toBeDefined();
      expect(result.ambiguity).toBeDefined();
    }
  });

  it('REJECT + any ambiguity → verdict stays REJECT, scores attached', () => {
    const result = applyAmbiguityGate(makeReject(highAmbiguityOutput), highAmbiguityOutput, 0.2);
    expect(result.type).toBe('verdict');
    if (result.type === 'verdict') {
      expect(result.verdict).toBe('REJECT');
      expect(result.ambiguityVetoed).toBeUndefined();
      expect(result.clarityScores).toBeDefined();
    }
  });

  it('threshold null (off) → no veto even at ambiguity=1.0, scores still attached, ambiguityThreshold omitted', () => {
    const allZero = [
      '## Clarity Scores',
      '- goal: 0.0', '- constraint: 0.0', '- success: 0.0', '- context: 0.0',
    ].join('\n');
    const result = applyAmbiguityGate(makeApprove(allZero), allZero, null);
    expect(result.type).toBe('verdict');
    if (result.type === 'verdict') {
      expect(result.verdict).toBe('APPROVE');
      expect(result.ambiguityVetoed).toBeUndefined();
      expect(result.ambiguityThreshold).toBeUndefined();
      expect(result.clarityScores).toBeDefined();
      expect(result.ambiguity).toBe(1.0);
    }
  });

  it('error result → returned unchanged', () => {
    const err = makeError();
    const result = applyAmbiguityGate(err, '', 0.2);
    expect(result).toBe(err);
  });

  it('parse failure → clarityParseError true, verdict unchanged, ambiguityThreshold attached', () => {
    const noScores = '## Verdict\nAPPROVE\n## Summary\nLooks fine.';
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = applyAmbiguityGate(makeApprove(noScores), noScores, 0.2);
    expect(result.clarityParseError).toBe(true);
    expect(result.ambiguityThreshold).toBe(0.2);
    if (result.type === 'verdict') {
      expect(result.verdict).toBe('APPROVE');
    }
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // Second call: warned-once → no extra warning
    applyAmbiguityGate(makeApprove(noScores), noScores, 0.2);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('synthetic P1 comment names the two lowest-scoring axes', () => {
    const result = applyAmbiguityGate(makeApprove(highAmbiguityOutput), highAmbiguityOutput, 0.2);
    if (result.type === 'verdict') {
      // goal=0.45 and constraint=0.60 are the two lowest
      expect(result.comments).toMatch(/goal/);
      expect(result.comments).toMatch(/constraint/);
    }
  });

  it('regression: legacy output without ## Clarity Scores → fail-open, verdict unchanged', () => {
    const legacy = '## Verdict\nAPPROVE\n## Comments\n- All good.\n## Summary\nSpec is clear.';
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = applyAmbiguityGate(makeApprove(legacy), legacy, 0.2);
    expect(result.type).toBe('verdict');
    if (result.type === 'verdict') {
      expect(result.verdict).toBe('APPROVE');
    }
    expect(result.clarityParseError).toBe(true);
    warnSpy.mockRestore();
  });
});
