import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  loadDriftThreshold,
  parseDriftScores,
  computeWeightedDrift,
  buildDriftPrompt,
  resolveDriftAction,
  writeDriftFeedback,
  scoreP5Drift,
  __resetDriftWarning,
  DRIFT_WEIGHTS,
  type DriftOutcome,
} from '../../src/phases/drift.js';
import { createInitialState } from '../../src/state.js';

beforeEach(() => {
  __resetDriftWarning();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('loadDriftThreshold', () => {
  it('unset + autoMode=true → 0.3', () => {
    expect(loadDriftThreshold(true)).toBe(0.3);
  });

  it('unset + autoMode=false → null', () => {
    expect(loadDriftThreshold(false)).toBe(null);
  });

  it('"" + autoMode=true → 0.3', () => {
    vi.stubEnv('HARNESS_PHASE_DRIFT_THRESHOLD', '');
    expect(loadDriftThreshold(true)).toBe(0.3);
  });

  it('"0.5" → 0.5 regardless of autoMode', () => {
    vi.stubEnv('HARNESS_PHASE_DRIFT_THRESHOLD', '0.5');
    expect(loadDriftThreshold(true)).toBe(0.5);
    expect(loadDriftThreshold(false)).toBe(0.5);
  });

  it('"0" → 0', () => {
    vi.stubEnv('HARNESS_PHASE_DRIFT_THRESHOLD', '0');
    expect(loadDriftThreshold(true)).toBe(0);
  });

  it('"1" → 1', () => {
    vi.stubEnv('HARNESS_PHASE_DRIFT_THRESHOLD', '1');
    expect(loadDriftThreshold(false)).toBe(1);
  });

  it('"off" → null (case-insensitive)', () => {
    vi.stubEnv('HARNESS_PHASE_DRIFT_THRESHOLD', 'off');
    expect(loadDriftThreshold(true)).toBe(null);
    vi.stubEnv('HARNESS_PHASE_DRIFT_THRESHOLD', 'OFF');
    expect(loadDriftThreshold(true)).toBe(null);
  });

  it('"1.5" (out of range) → null + warn once', () => {
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.stubEnv('HARNESS_PHASE_DRIFT_THRESHOLD', '1.5');
    expect(loadDriftThreshold(true)).toBe(null);
    expect(loadDriftThreshold(true)).toBe(null);
    const warnCalls = errSpy.mock.calls.filter((c) => String(c[0]).includes('[drift] invalid'));
    expect(warnCalls.length).toBe(1);
    errSpy.mockRestore();
  });

  it('"abc" (non-numeric) → null + warn once', () => {
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.stubEnv('HARNESS_PHASE_DRIFT_THRESHOLD', 'abc');
    expect(loadDriftThreshold(true)).toBe(null);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('noDrift=true, autoMode=true → null (short-circuits before env)', () => {
    expect(loadDriftThreshold(true, true)).toBe(null);
  });

  it('noDrift=true, autoMode=false → null', () => {
    expect(loadDriftThreshold(false, true)).toBe(null);
  });

  it('noDrift=true, env="0.3" → null (CLI > env)', () => {
    vi.stubEnv('HARNESS_PHASE_DRIFT_THRESHOLD', '0.3');
    expect(loadDriftThreshold(true, true)).toBe(null);
  });

  it('noDrift=true, env="0.5", autoMode=false → null', () => {
    vi.stubEnv('HARNESS_PHASE_DRIFT_THRESHOLD', '0.5');
    expect(loadDriftThreshold(false, true)).toBe(null);
  });

  it('noDrift=true, env="invalid" → null and warnOnce NOT called', () => {
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.stubEnv('HARNESS_PHASE_DRIFT_THRESHOLD', 'invalid');
    expect(loadDriftThreshold(true, true)).toBe(null);
    const warnCalls = errSpy.mock.calls.filter((c) => String(c[0]).includes('[drift] invalid'));
    expect(warnCalls.length).toBe(0);
    errSpy.mockRestore();
  });

  it('noDrift=false (default) preserves existing env behaviour', () => {
    vi.stubEnv('HARNESS_PHASE_DRIFT_THRESHOLD', '0.5');
    expect(loadDriftThreshold(true, false)).toBe(0.5);
  });
});

describe('parseDriftScores', () => {
  it('parses well-formed Codex output', () => {
    const raw = [
      '## Drift Scores',
      '```json',
      '{ "goal": 0.12, "constraint": 0.05, "ontology": 0.20, "rationale": "Looks fine" }',
      '```',
      '',
      '## End',
    ].join('\n');
    const r = parseDriftScores(raw);
    expect(r).not.toBeNull();
    expect(r!.goal).toBe(0.12);
    expect(r!.constraint).toBe(0.05);
    expect(r!.ontology).toBe(0.20);
    expect(r!.rationale).toBe('Looks fine');
  });

  it('clamps rationale to ≤ 200 chars + single line', () => {
    const longText = 'A'.repeat(500);
    const raw = [
      '## Drift Scores',
      '```json',
      `{"goal":0,"constraint":0,"ontology":0,"rationale":"${longText}"}`,
      '```',
    ].join('\n');
    const r = parseDriftScores(raw);
    expect(r!.rationale!.length).toBeLessThanOrEqual(200);
  });

  it('returns null when ## Drift Scores header missing', () => {
    expect(parseDriftScores('No drift section here')).toBeNull();
  });

  it('returns null on out-of-range axis', () => {
    const raw = [
      '## Drift Scores',
      '```json',
      '{ "goal": 1.5, "constraint": 0, "ontology": 0 }',
      '```',
    ].join('\n');
    expect(parseDriftScores(raw)).toBeNull();
  });

  it('returns null on missing axis', () => {
    const raw = [
      '## Drift Scores',
      '```json',
      '{ "goal": 0.1, "constraint": 0.1 }',
      '```',
    ].join('\n');
    expect(parseDriftScores(raw)).toBeNull();
  });

  it('returns null on non-JSON fence body', () => {
    const raw = [
      '## Drift Scores',
      '```json',
      'this is not json',
      '```',
    ].join('\n');
    expect(parseDriftScores(raw)).toBeNull();
  });

  it('returns null on empty input', () => {
    expect(parseDriftScores('')).toBeNull();
  });
});

describe('computeWeightedDrift', () => {
  it('reference vectors per spec weights', () => {
    expect(computeWeightedDrift({ goal: 1, constraint: 0, ontology: 0 })).toBeCloseTo(0.5, 5);
    expect(computeWeightedDrift({ goal: 0, constraint: 1, ontology: 0 })).toBeCloseTo(0.3, 5);
    expect(computeWeightedDrift({ goal: 0, constraint: 0, ontology: 1 })).toBeCloseTo(0.2, 5);
    expect(computeWeightedDrift({ goal: 1, constraint: 1, ontology: 1 })).toBeCloseTo(1, 5);
    expect(computeWeightedDrift({ goal: 0, constraint: 0, ontology: 0 })).toBe(0);
  });

  it('weights sum to 1', () => {
    const sum = DRIFT_WEIGHTS.goal + DRIFT_WEIGHTS.constraint + DRIFT_WEIGHTS.ontology;
    expect(sum).toBeCloseTo(1, 10);
  });

  it('clamps NaN / out-of-bounds (defensive)', () => {
    expect(computeWeightedDrift({ goal: NaN, constraint: 0, ontology: 0 })).toBe(0);
  });
});

describe('buildDriftPrompt', () => {
  it('returns a prompt under cap when inputs are small', () => {
    const r = buildDriftPrompt('spec body', 'plan body', 'diff body', 0.3);
    expect('oversized' in r).toBe(false);
    if ('oversized' in r) return;
    expect(r.truncated).toBe(false);
    expect(r.prompt).toContain('## Spec');
    expect(r.prompt).toContain('## Plan');
    expect(r.prompt).toContain('## Diff (planCommit..implCommit)');
    expect(r.prompt).toContain('## Drift Scores');
  });

  it('truncates the diff tail when assembled prompt > cap', () => {
    const bigDiff = 'X'.repeat(40_000);
    const r = buildDriftPrompt('spec', 'plan', bigDiff, 0.3);
    expect('oversized' in r).toBe(false);
    if ('oversized' in r) return;
    expect(r.truncated).toBe(true);
    expect(r.prompt).toContain('[... diff truncated ...]');
    expect(r.prompt.length).toBeLessThanOrEqual(30_000 + 200); // some slack for marker text
  });

  it('returns oversized when spec+plan alone exceed cap', () => {
    const bigSpec = 'S'.repeat(20_000);
    const bigPlan = 'P'.repeat(20_000);
    const r = buildDriftPrompt(bigSpec, bigPlan, '', 0.3);
    expect('oversized' in r && (r as { oversized: true }).oversized).toBe(true);
  });
});

describe('resolveDriftAction', () => {
  function outcome(score: number | null, source: 'codex-only' | 'codex-truncated' | 'error', threshold = 0.3): DriftOutcome {
    return {
      activated: true,
      threshold,
      score,
      axes: score === null ? null : { goal: 0, constraint: 0, ontology: 0 },
      driftSource: source,
      durationMs: 1,
    };
  }

  it('error → error', () => {
    expect(resolveDriftAction(outcome(null, 'error'))).toBe('error');
  });

  it('score ≤ threshold → pass', () => {
    expect(resolveDriftAction(outcome(0.3, 'codex-only'))).toBe('pass');
    expect(resolveDriftAction(outcome(0.0, 'codex-only'))).toBe('pass');
  });

  it('score > threshold → reopen', () => {
    expect(resolveDriftAction(outcome(0.31, 'codex-only'))).toBe('reopen');
    expect(resolveDriftAction(outcome(0.99, 'codex-truncated'))).toBe('reopen');
  });
});

describe('writeDriftFeedback', () => {
  it('writes a markdown report with score + axes when present', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-test-'));
    const o: DriftOutcome = {
      activated: true,
      threshold: 0.3,
      score: 0.55,
      axes: { goal: 0.7, constraint: 0.3, ontology: 0.2 },
      driftSource: 'codex-only',
      durationMs: 1234,
      codexTokensTotal: 4567,
      rationale: 'goal axis diverged: spec said X, code does Y',
    };
    const fp = writeDriftFeedback(tmp, o);
    const body = fs.readFileSync(fp, 'utf-8');
    expect(body).toContain('Weighted drift score: 0.55');
    expect(body).toContain('| goal | 0.70');
    expect(body).toContain('codex-only');
    expect(body).toContain('Codex tokens (drift call): 4567');
    expect(body).toContain('goal axis diverged');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('writes a degraded report when score=null', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-test-'));
    const o: DriftOutcome = {
      activated: true,
      threshold: 0.3,
      score: null,
      axes: null,
      driftSource: 'error',
      durationMs: 0,
      error: 'parse failure',
    };
    const fp = writeDriftFeedback(tmp, o);
    const body = fs.readFileSync(fp, 'utf-8');
    expect(body).toContain('unavailable');
    expect(body).toContain('error');
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('scoreP5Drift — noDrift flag', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('noDrift=true → activated:false even when HARNESS_PHASE_DRIFT_THRESHOLD=0.3', async () => {
    vi.stubEnv('HARNESS_PHASE_DRIFT_THRESHOLD', '0.3');
    const state = createInitialState('run-nd', 'task', 'abc', true, false, 'full', false, true);
    const result = await scoreP5Drift({ state, runDir: '/tmp', cwd: '/tmp' });
    expect(result.activated).toBe(false);
  });

  it('noDrift=false + env=off → activated:false (existing env-off behaviour unchanged)', async () => {
    vi.stubEnv('HARNESS_PHASE_DRIFT_THRESHOLD', 'off');
    const state = createInitialState('run-nd', 'task', 'abc', true);
    const result = await scoreP5Drift({ state, runDir: '/tmp', cwd: '/tmp' });
    expect(result.activated).toBe(false);
  });
});
