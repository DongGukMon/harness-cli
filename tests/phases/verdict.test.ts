import { describe, it, expect } from 'vitest';
import {
  buildGateResult,
  extractCodexMetadata,
  parseVerdict,
  parseClarityScores,
  computeWeightedAmbiguity,
  AMBIGUITY_AXES,
  CLARITY_WEIGHTS,
} from '../../src/phases/verdict.js';

describe('parseVerdict', () => {
  it('parses REJECT with Scope: impl', () => {
    const result = parseVerdict('## Verdict\nREJECT\nScope: impl\n\n## Comments\n- x\n');
    expect(result).toMatchObject({ verdict: 'REJECT', scope: 'impl' });
  });

  it('parses REJECT with Scope: design and Scope: mixed', () => {
    expect(parseVerdict('## Verdict\nREJECT\nScope: design\n')?.scope).toBe('design');
    expect(parseVerdict('## Verdict\nREJECT\nScope: mixed\n')?.scope).toBe('mixed');
  });

  it('treats lowercase scope tag as valid', () => {
    const result = parseVerdict('## Verdict\nREJECT\nscope: impl\n');
    expect(result?.scope).toBe('impl');
  });

  it('omits scope when Scope line is missing or invalid', () => {
    expect(parseVerdict('## Verdict\nREJECT\n')?.scope).toBeUndefined();
    expect(parseVerdict('## Verdict\nREJECT\nScope: bogus\n')?.scope).toBeUndefined();
  });

  it('ignores scope lines on APPROVE', () => {
    const result = parseVerdict('## Verdict\nAPPROVE\nScope: impl\n');
    expect(result).toMatchObject({ verdict: 'APPROVE' });
    expect(result?.scope).toBeUndefined();
  });

  it('parses scope inside Comments after Verdict, even across later headings', () => {
    const result = parseVerdict([
      'Intro',
      '## Verdict',
      'REJECT',
      '## Comments',
      '- Issue',
      'Scope: impl',
      '## Summary',
      'Needs work',
    ].join('\n'));
    expect(result?.scope).toBe('impl');
  });

  it('does not parse scope lines that appear only before ## Verdict', () => {
    const result = parseVerdict([
      'Scope: impl',
      '## Comments',
      '- note',
      '## Verdict',
      'REJECT',
      '## Summary',
      'Needs work',
    ].join('\n'));
    expect(result?.scope).toBeUndefined();
  });

  it('returns null when ## Verdict is missing, even if Scope: impl is present', () => {
    const result = parseVerdict([
      '## Comments',
      '- malformed output',
      'Scope: impl',
      '## Summary',
      'Needs work',
    ].join('\n'));
    expect(result).toBeNull();
  });
});

describe('buildGateResult', () => {
  it('threads parsed scope through GateOutcome', () => {
    const result = buildGateResult(0, '## Verdict\nREJECT\nScope: impl\n', '');
    expect(result.type).toBe('verdict');
    if (result.type === 'verdict') {
      expect(result.scope).toBe('impl');
    }
  });
});

describe('extractCodexMetadata', () => {
  it('parses tokens used and session id', () => {
    const stdout = `blah blah
tokens used
19,123
session id: abc-def-123
more blah`;
    const result = extractCodexMetadata(stdout);
    expect(result.tokensTotal).toBe(19123);
    expect(result.codexSessionId).toBe('abc-def-123');
  });

  it('handles tokens without commas', () => {
    const stdout = `tokens used\n45000`;
    expect(extractCodexMetadata(stdout).tokensTotal).toBe(45000);
  });

  it('returns empty object when both absent', () => {
    expect(extractCodexMetadata('no metadata here')).toEqual({});
  });

  it('case-insensitive session id match', () => {
    const stdout = `Session ID: 0123-4567-89ab`;
    expect(extractCodexMetadata(stdout).codexSessionId).toBe('0123-4567-89ab');
  });

  // Real Codex `exec` wiring: the metadata lines (`session id:`, `tokens used`) land
  // on STDERR while stdout carries only the model's final answer. These regressions
  // cover the case the runner actually encounters.
  it('parses metadata when it lives on stderr (matches real codex exec wiring)', () => {
    const stdout = 'REJECT\n';
    const stderr = [
      'OpenAI Codex v0.121.0 (research preview)',
      '--------',
      'session id: 019d9f82-8d29-78d2-a06c-1225569879fe',
      '--------',
      'user',
      'some prompt',
      '',
      'hook: Stop Completed',
      'tokens used',
      '18,443',
    ].join('\n');
    const result = extractCodexMetadata(stdout, stderr);
    expect(result.tokensTotal).toBe(18443);
    expect(result.codexSessionId).toBe('019d9f82-8d29-78d2-a06c-1225569879fe');
  });

  it('prefers stdout matches over stderr when both present', () => {
    // Belt-and-suspenders: if a future Codex release moves metadata to stdout, do not
    // silently drop the newer signal. Current regex matches the first occurrence; stdout
    // comes first in the combined string so it wins.
    const stdout = 'session id: aaaa-bbbb-cccc\ntokens used\n100';
    const stderr = 'session id: zzzz-yyyy-xxxx\ntokens used\n999';
    const result = extractCodexMetadata(stdout, stderr);
    expect(result.codexSessionId).toBe('aaaa-bbbb-cccc');
    expect(result.tokensTotal).toBe(100);
  });

  it('backwards-compatible: stderr argument is optional', () => {
    // Existing callers (and the original single-arg signature) must keep working.
    expect(extractCodexMetadata('session id: 1234-5678').codexSessionId).toBe('1234-5678');
  });
});

describe('parseClarityScores', () => {
  const good = [
    '## Verdict', 'APPROVE',
    '## Comments', '- looks good',
    '## Summary', 'All clear.',
    '## Clarity Scores',
    '- goal: 0.85',
    '- constraint: 0.70',
    '- success: 0.90',
    '- context: 0.60',
  ].join('\n');

  it('parses a well-formed block', () => {
    const scores = parseClarityScores(good);
    expect(scores).toEqual({ goal: 0.85, constraint: 0.70, success: 0.90, context: 0.60 });
  });

  it('returns null when ## Clarity Scores header is absent', () => {
    expect(parseClarityScores('## Verdict\nAPPROVE\n## Summary\nOK.')).toBeNull();
  });

  it('returns null when any axis is missing', () => {
    const partial = '## Clarity Scores\n- goal: 0.9\n- constraint: 0.8\n- success: 0.7\n';
    expect(parseClarityScores(partial)).toBeNull();
  });

  it('returns null when any value is outside [0, 1]', () => {
    const neg = '## Clarity Scores\n- goal: -0.1\n- constraint: 0.8\n- success: 0.7\n- context: 0.5\n';
    const big = '## Clarity Scores\n- goal: 1.1\n- constraint: 0.8\n- success: 0.7\n- context: 0.5\n';
    expect(parseClarityScores(neg)).toBeNull();
    expect(parseClarityScores(big)).toBeNull();
  });

  it('accepts integer values (goal: 1 treated as 1.0)', () => {
    const intVals = '## Clarity Scores\n- goal: 1\n- constraint: 0\n- success: 1\n- context: 0\n';
    const scores = parseClarityScores(intVals);
    expect(scores).toEqual({ goal: 1, constraint: 0, success: 1, context: 0 });
  });

  it('is case-insensitive on header and axis names', () => {
    const mixed = '## clarity scores\n- Goal: 0.9\n- CONSTRAINT: 0.8\n- Success: 0.7\n- Context: 0.6\n';
    expect(parseClarityScores(mixed)).toEqual({ goal: 0.9, constraint: 0.8, success: 0.7, context: 0.6 });
  });

  it('first duplicate axis wins, others ignored', () => {
    const dup = '## Clarity Scores\n- goal: 0.9\n- goal: 0.1\n- constraint: 0.8\n- success: 0.7\n- context: 0.6\n';
    const scores = parseClarityScores(dup);
    expect(scores?.goal).toBe(0.9);
  });

  it('stops scanning at next ## header', () => {
    const stop = '## Clarity Scores\n- goal: 0.9\n- constraint: 0.8\n## Other\n- success: 0.7\n- context: 0.6\n';
    expect(parseClarityScores(stop)).toBeNull(); // success and context after ##, so missing
  });

  it('tolerates extra whitespace around separator', () => {
    const spacy = '## Clarity Scores\n  -  goal :  0.85  \n- constraint: 0.70\n- success: 0.90\n- context: 0.60\n';
    expect(parseClarityScores(spacy)).toEqual({ goal: 0.85, constraint: 0.70, success: 0.90, context: 0.60 });
  });
});

describe('computeWeightedAmbiguity', () => {
  it('all 1.0 scores → ambiguity 0.0', () => {
    expect(computeWeightedAmbiguity({ goal: 1, constraint: 1, success: 1, context: 1 })).toBe(0);
  });

  it('all 0.0 scores → ambiguity 1.0', () => {
    expect(computeWeightedAmbiguity({ goal: 0, constraint: 0, success: 0, context: 0 })).toBe(1);
  });

  it('weights sum to 1.0 (invariant)', () => {
    const sum = Object.values(CLARITY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it('matches manual calculation', () => {
    // goal=0.45 *0.35 + constraint=0.60 *0.25 + success=0.85 *0.30 + context=0.90 *0.10
    // = 0.1575 + 0.15 + 0.255 + 0.09 = 0.6525 → ambiguity = 1 - 0.6525 = 0.3475
    const scores = { goal: 0.45, constraint: 0.60, success: 0.85, context: 0.90 };
    expect(computeWeightedAmbiguity(scores)).toBeCloseTo(0.3475, 6);
  });

  it('result is clamped to [0, 1]', () => {
    const result = computeWeightedAmbiguity({ goal: 1, constraint: 1, success: 1, context: 1 });
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });

  it('AMBIGUITY_AXES contains exactly goal, constraint, success, context', () => {
    expect([...AMBIGUITY_AXES].sort()).toEqual(['constraint', 'context', 'goal', 'success']);
  });
});
