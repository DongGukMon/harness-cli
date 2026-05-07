# P2 Spec Gate Quantitative Ambiguity Score Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a quantitative ambiguity score to the P2 spec gate — Codex emits a `## Clarity Scores` block with 4 axes, harness computes weighted ambiguity, and vetoes APPROVE→REJECT when `ambiguity > HARNESS_GATE_AMBIGUITY_THRESHOLD` (default 0.2).

**Architecture:** Five touch-points in dependency order: (1) pure parser/types in `verdict.ts`, (2) new `ambiguity.ts` module mirroring `stagnation.ts`, (3) `assembler.ts` Codex contract injection, (4) `types.ts` schema extension, (5) `gate.ts` + `runner.ts` wiring. All logic is stateless per gate attempt; `state.json`, P4/P7 gate paths, light-flow phase 2, and the sidecar-replay branch are unchanged.

**Tech Stack:** TypeScript 5, Vitest, Node.js ESM. No new dependencies.

Related artifacts:
- Spec: `docs/specs/2026-05-06-p2-spec-gate-ambiguity-9fa2-design.md`
- Decisions log: `.harness/2026-05-06-p2-spec-gate-ambiguity-9fa2/decisions.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/phases/ambiguity.ts` | `loadAmbiguityThreshold`, `applyAmbiguityGate`, `__resetAmbiguityWarning` |
| Create | `tests/phases/ambiguity.test.ts` | Unit tests for ambiguity module |
| Modify | `src/phases/verdict.ts` | Add `AMBIGUITY_AXES`, `CLARITY_WEIGHTS`, `ClarityScores`, `parseClarityScores`, `computeWeightedAmbiguity` |
| Modify | `src/types.ts` | Add 5 optional fields to `GateOutcome`, `GateError`, `gate_verdict` LogEvent; type-only import of `ClarityScores` |
| Modify | `src/context/assembler.ts` | Append `CLARITY_SCORES_PROTOCOL` to `FIVE_AXIS_SPEC_GATE`; phase-aware `structuredOutputReminder` |
| Modify | `src/phases/gate.ts` | Call `applyAmbiguityGate` for `phase === 2`, both Claude and Codex paths, before `_persistSidecars` |
| Modify | `src/phases/runner.ts` | Pass 5 new optional fields through both `gate_verdict` emission sites, guarded by `phase === 2` |
| Modify | `tests/phases/verdict.test.ts` | Tests for `parseClarityScores` and `computeWeightedAmbiguity` |
| Modify | `tests/context/assembler.test.ts` | Assert `## Clarity Scores` in P2 prompt; absent in P4/P7; 4-bullet resume reminder in P2 |
| Modify | `tests/phases/gate.test.ts` | Integration tests: P2 veto fires; P4 clean |
| Modify | `docs/HOW-IT-WORKS.md` | Phase 2 gate section + `gate_verdict` event table |
| Modify | `docs/HOW-IT-WORKS.ko.md` | Same, Korean |
| Modify | `README.md` | Env var row + one-line spec gate note |
| Modify | `README.ko.md` | Same, Korean |

---

## Task 1: `verdict.ts` — pure types and functions + `types.ts` extensions

**Files:**
- Modify: `src/phases/verdict.ts`
- Modify: `src/types.ts`
- Modify: `tests/phases/verdict.test.ts`

- [ ] **Step 1.1: Write failing tests for `parseClarityScores`**

Add to `tests/phases/verdict.test.ts`:

```typescript
import {
  parseClarityScores,
  computeWeightedAmbiguity,
  AMBIGUITY_AXES,
  CLARITY_WEIGHTS,
} from '../../src/phases/verdict.js';

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
```

- [ ] **Step 1.2: Run tests to verify they fail**

```bash
cd /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/ambiguity-gate
pnpm vitest run tests/phases/verdict.test.ts
```

Expected: FAIL — `parseClarityScores`, `computeWeightedAmbiguity`, `AMBIGUITY_AXES`, `CLARITY_WEIGHTS` are not exported.

- [ ] **Step 1.3: Add types and functions to `src/phases/verdict.ts`**

Add the following at the end of `src/phases/verdict.ts` (before the final `}`):

```typescript
// ─── Ambiguity scoring ────────────────────────────────────────────────────────

export const AMBIGUITY_AXES = ['goal', 'constraint', 'success', 'context'] as const;
export type AmbiguityAxis = typeof AMBIGUITY_AXES[number];

export const CLARITY_WEIGHTS: Readonly<Record<AmbiguityAxis, number>> = Object.freeze({
  goal: 0.35,
  constraint: 0.25,
  success: 0.30,
  context: 0.10,
});

export type ClarityScores = Record<AmbiguityAxis, number>;

/**
 * Parse the `## Clarity Scores` block from a Codex gate output.
 * Returns null on missing header, missing axis, or out-of-range value.
 * Pure function — no I/O, no exceptions.
 */
export function parseClarityScores(rawOutput: string): ClarityScores | null {
  const lines = rawOutput.split('\n');
  const headerIdx = lines.findIndex(
    (l) => l.trim().toLowerCase() === '## clarity scores',
  );
  if (headerIdx === -1) return null;

  const found: Partial<Record<AmbiguityAxis, number>> = {};
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*##\s/.test(line)) break;
    const m = line.match(/^\s*-\s*(goal|constraint|success|context)\s*:\s*(\d+(?:\.\d+)?)\s*$/i);
    if (!m) continue;
    const axis = m[1].toLowerCase() as AmbiguityAxis;
    if (axis in found) continue; // first wins
    const value = parseFloat(m[2]);
    if (value < 0 || value > 1) return null;
    found[axis] = value;
  }

  for (const axis of AMBIGUITY_AXES) {
    if (!(axis in found)) return null;
  }
  return found as ClarityScores;
}

/**
 * Compute weighted ambiguity score: 1 − Σ(score × weight).
 * Result clamped to [0, 1] to absorb floating-point drift.
 * Pure function — no I/O, no exceptions.
 */
export function computeWeightedAmbiguity(scores: ClarityScores): number {
  let clarity = 0;
  for (const axis of AMBIGUITY_AXES) {
    clarity += scores[axis] * CLARITY_WEIGHTS[axis];
  }
  const ambiguity = 1 - clarity;
  return Math.min(1, Math.max(0, ambiguity));
}
```

- [ ] **Step 1.4: Extend `src/types.ts` with 5 optional fields**

Add a type-only import at the top of `src/types.ts` (after the existing empty imports, before the first `export`):

```typescript
import type { ClarityScores } from './phases/verdict.js';
```

Then extend `GateOutcome` (add after the `resumeFallback?` line):

```typescript
  // Ambiguity gate fields (Phase 2 only)
  clarityScores?: ClarityScores;
  ambiguity?: number;
  ambiguityThreshold?: number;
  ambiguityVetoed?: boolean;
  clarityParseError?: boolean;
```

Extend `GateError` (add after the `resumeFallback?` line):

```typescript
  // Ambiguity gate fields (Phase 2 only)
  clarityScores?: ClarityScores;
  ambiguity?: number;
  ambiguityThreshold?: number;
  ambiguityVetoed?: boolean;
  clarityParseError?: boolean;
```

Extend the `gate_verdict` variant of `LogEvent` (add the 5 fields after the `preset?` line):

```typescript
      // New (Phase 2 only):
      clarityScores?: ClarityScores;
      ambiguity?: number;
      ambiguityThreshold?: number;
      ambiguityVetoed?: boolean;
      clarityParseError?: boolean;
```

- [ ] **Step 1.5: Run tests to verify they pass**

```bash
pnpm vitest run tests/phases/verdict.test.ts
```

Expected: PASS for all `parseClarityScores` and `computeWeightedAmbiguity` tests.

- [ ] **Step 1.6: Typecheck**

```bash
pnpm tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 1.7: Commit**

```bash
git add src/phases/verdict.ts src/types.ts tests/phases/verdict.test.ts
git commit -m "feat(ambiguity): add parseClarityScores, computeWeightedAmbiguity, and types"
```

---

## Task 2: `src/phases/ambiguity.ts` — new module + tests

**Files:**
- Create: `src/phases/ambiguity.ts`
- Create: `tests/phases/ambiguity.test.ts`

- [ ] **Step 2.1: Write failing tests**

Create `tests/phases/ambiguity.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadAmbiguityThreshold, applyAmbiguityGate, __resetAmbiguityWarning } from '../../src/phases/ambiguity.js';
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

  it('threshold null (off) → no veto even at ambiguity=1.0, scores still attached', () => {
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
```

- [ ] **Step 2.2: Run tests to verify they fail**

```bash
pnpm vitest run tests/phases/ambiguity.test.ts
```

Expected: FAIL — module `src/phases/ambiguity.ts` does not exist.

- [ ] **Step 2.3: Create `src/phases/ambiguity.ts`**

```typescript
import type { GatePhaseResult } from '../types.js';
import { parseClarityScores, computeWeightedAmbiguity, AMBIGUITY_AXES } from './verdict.js';
import type { ClarityScores } from './verdict.js';

const warnedKeys = new Set<string>();

export function __resetAmbiguityWarning(): void {
  warnedKeys.clear();
}

/**
 * Load the ambiguity veto threshold from the environment.
 * - Unset / empty → 0.2 (default)
 * - "off" (case-insensitive, trimmed) → null (veto disabled, scores still parsed)
 * - Numeric in [0.0, 1.0] → that value
 * - Anything else → null + one stderr warning (warned-once)
 */
export function loadAmbiguityThreshold(): number | null {
  const raw = process.env['HARNESS_GATE_AMBIGUITY_THRESHOLD'];
  if (raw === undefined || raw === '') return 0.2;

  const trimmed = raw.trim();
  if (trimmed.toLowerCase() === 'off') return null;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    if (!warnedKeys.has('HARNESS_GATE_AMBIGUITY_THRESHOLD')) {
      process.stderr.write(
        `[ambiguity] invalid HARNESS_GATE_AMBIGUITY_THRESHOLD="${raw}" — veto disabled for this run\n`,
      );
      warnedKeys.add('HARNESS_GATE_AMBIGUITY_THRESHOLD');
    }
    return null;
  }
  return parsed;
}

/**
 * Apply the ambiguity veto gate to a GatePhaseResult.
 * - Errors pass through unchanged.
 * - Parse failure: sets clarityParseError, emits one warning, leaves verdict untouched.
 * - Scores parsed: attaches clarityScores and ambiguity.
 * - If threshold not null and APPROVE and ambiguity > threshold: rewrites to REJECT.
 */
export function applyAmbiguityGate(
  result: GatePhaseResult,
  rawOutput: string,
  threshold: number | null,
): GatePhaseResult {
  if (result.type === 'error') return result;

  const scores = parseClarityScores(rawOutput);

  if (scores === null) {
    if (!warnedKeys.has('clarity-parse')) {
      process.stderr.write(
        '[ambiguity] ## Clarity Scores section missing or malformed — fail-open, verdict unchanged\n',
      );
      warnedKeys.add('clarity-parse');
    }
    return {
      ...result,
      clarityParseError: true,
      ...(threshold !== null ? { ambiguityThreshold: threshold } : {}),
    };
  }

  const ambiguity = computeWeightedAmbiguity(scores);
  const withScores: GatePhaseResult = {
    ...result,
    clarityScores: scores,
    ambiguity,
    ...(threshold !== null ? { ambiguityThreshold: threshold } : {}),
  };

  if (threshold !== null && result.verdict === 'APPROVE' && ambiguity > threshold) {
    const sorted = ([...AMBIGUITY_AXES] as string[]).sort(
      (a, b) => (scores as ClarityScores)[a as keyof ClarityScores] - (scores as ClarityScores)[b as keyof ClarityScores],
    );
    const lowestTwo = sorted.slice(0, 2);
    const lowestDesc = lowestTwo
      .map((ax) => `${ax}=${(scores as ClarityScores)[ax as keyof ClarityScores].toFixed(2)}`)
      .join(', ');
    const scoresJson = Object.entries(scores)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');

    const syntheticComment =
      `- **[P1]** — Location: spec (overall)\n` +
      `  Issue: Spec ambiguity ${ambiguity.toFixed(2)} exceeds threshold ${threshold.toFixed(2)} (weighted across goal/constraint/success/context).\n` +
      `  Suggestion: Tighten the lowest-scoring axes — ${lowestDesc}. Restate goals as measurable outcomes and enumerate forbidden behaviors / boundary conditions.\n` +
      `  Evidence: clarityScores = { ${scoresJson} } → weighted ambiguity ${ambiguity.toFixed(2)} > ${threshold.toFixed(2)}.`;

    const existingComments = (result.comments ?? '').replace(/\n?Scope:\s*(design|impl|mixed)\b[^\n]*/i, '');
    const newComments = (existingComments.trim()
      ? syntheticComment + '\n' + existingComments.trim()
      : syntheticComment) + '\nScope: design';

    return {
      ...withScores,
      verdict: 'REJECT',
      comments: newComments,
      ambiguityVetoed: true,
      scope: 'design',
    };
  }

  return withScores;
}
```

- [ ] **Step 2.4: Run tests to verify they pass**

```bash
pnpm vitest run tests/phases/ambiguity.test.ts
```

Expected: PASS for all tests.

- [ ] **Step 2.5: Typecheck**

```bash
pnpm tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 2.6: Commit**

```bash
git add src/phases/ambiguity.ts tests/phases/ambiguity.test.ts
git commit -m "feat(ambiguity): add loadAmbiguityThreshold and applyAmbiguityGate module"
```

---

## Task 3: `assembler.ts` — Codex contract injection + phase-aware resume reminder

**Files:**
- Modify: `src/context/assembler.ts`
- Modify: `tests/context/assembler.test.ts`

- [ ] **Step 3.1: Write failing tests**

Add to `tests/context/assembler.test.ts` (after the existing `describe` blocks):

```typescript
describe('assembler — Clarity Scores protocol (Phase 2 only)', () => {
  it('phase-2 fresh prompt contains ## Clarity Scores instruction', () => {
    const dir = makeTmpDir();
    const state = makeState({ runId: 'test-run' });
    // Write spec fixture
    fs.mkdirSync(path.join(dir, 'docs/specs'), { recursive: true });
    const specPath = path.join(dir, 'docs/specs/test-run-design.md');
    fs.writeFileSync(specPath, '# spec\nsome spec content');
    state.artifacts.spec = specPath;

    const prompt = assembleGatePrompt(2, state, dir, dir);
    expect(typeof prompt).toBe('string');
    expect(prompt as string).toContain('## Clarity Scores');
  });

  it('phase-4 fresh prompt does NOT contain ## Clarity Scores instruction', () => {
    const dir = makeTmpDir();
    const state = makeState({ runId: 'test-run' });
    fs.mkdirSync(path.join(dir, 'docs/specs'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'docs/plans'), { recursive: true });
    const specPath = path.join(dir, 'docs/specs/test-run-design.md');
    const planPath = path.join(dir, 'docs/plans/test-run.md');
    fs.writeFileSync(specPath, '# spec');
    fs.writeFileSync(planPath, '# plan');
    state.artifacts.spec = specPath;
    state.artifacts.plan = planPath;

    const prompt = assembleGatePrompt(4, state, dir, dir);
    expect(typeof prompt).toBe('string');
    expect(prompt as string).not.toContain('## Clarity Scores');
  });

  it('phase-2 resume prompt structured-output reminder contains 4-bullet form', () => {
    const dir = makeTmpDir();
    const state = makeState({ runId: 'test-run' });
    fs.mkdirSync(path.join(dir, 'docs/specs'), { recursive: true });
    const specPath = path.join(dir, 'docs/specs/test-run-design.md');
    fs.writeFileSync(specPath, '# spec');
    state.artifacts.spec = specPath;

    const prompt = assembleGateResumePrompt(2, state, dir, 'approve', '', dir);
    expect(typeof prompt).toBe('string');
    expect(prompt as string).toContain('## Clarity Scores');
  });

  it('phase-4 resume prompt structured-output reminder contains only 3 bullets (no Clarity Scores)', () => {
    const dir = makeTmpDir();
    const state = makeState({ runId: 'test-run' });
    fs.mkdirSync(path.join(dir, 'docs/specs'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'docs/plans'), { recursive: true });
    const specPath = path.join(dir, 'docs/specs/test-run-design.md');
    const planPath = path.join(dir, 'docs/plans/test-run.md');
    fs.writeFileSync(specPath, '# spec');
    fs.writeFileSync(planPath, '# plan');
    state.artifacts.spec = specPath;
    state.artifacts.plan = planPath;

    const prompt = assembleGateResumePrompt(4, state, dir, 'approve', '', dir);
    expect(typeof prompt).toBe('string');
    expect(prompt as string).not.toContain('## Clarity Scores');
  });
});
```

- [ ] **Step 3.2: Run tests to verify they fail**

```bash
pnpm vitest run tests/context/assembler.test.ts
```

Expected: FAIL — `## Clarity Scores` is not in the P2 prompt yet.

- [ ] **Step 3.3: Update `src/context/assembler.ts`**

**3.3a — Append `CLARITY_SCORES_PROTOCOL` to `FIVE_AXIS_SPEC_GATE`.**

Locate the `FIVE_AXIS_SPEC_GATE` constant (around line 50). Replace it with:

```typescript
const CLARITY_SCORES_PROTOCOL = `
## Clarity Scores (REQUIRED — Phase 2 only)
After \`## Summary\`, append a section titled exactly \`## Clarity Scores\`
with one line per axis, in this exact order:

  - goal: <0.0–1.0>
  - constraint: <0.0–1.0>
  - success: <0.0–1.0>
  - context: <0.0–1.0>

Each score is your assessment of how clear/unambiguous that aspect of the
spec is — independent of whether you ultimately APPROVE or REJECT:
  - goal       — Is the desired outcome stated unambiguously?
  - constraint — Are non-requirements / forbidden behaviors / boundary conditions explicit?
  - success    — Are success criteria measurable and concrete?
  - context    — Are assumptions, inputs, and prior decisions captured?

Use 1.0 for "fully clear, no reviewer-to-reviewer drift expected" and 0.0 for
"so vague that two reviewers would reasonably reach different conclusions".
Emit numbers, not adjectives. Do not omit axes.
`;

const FIVE_AXIS_SPEC_GATE = `
## Five-Axis Evaluation (Phase 2 — spec gate)
평가 대상은 spec 문서다. 다음 축만 적용:
1. Correctness — 요구사항/비요구사항/경계조건/성공기준이 명시되었는가?
2. Readability — 섹션 구성이 명확하고 모호 표현이 없는가?
3. Scope — 단일 구현 plan으로 분해 가능한 크기인가? 여러 독립 프로젝트 섞이지 않음?

Note: Phase 1 resolves design ambiguities live with the developer. Do not penalize for missing "Open Questions" / "TODO" / deferred-items sections — those are intentionally absent.
` + CLARITY_SCORES_PROTOCOL;
```

**3.3b — Make `structuredOutputReminder` phase-aware in `assembleGateResumePrompt`.**

Locate the `structuredOutputReminder` const (around line 767). Replace it with:

```typescript
  const clarityScoresBullet = phase === 2
    ? '- `## Clarity Scores` (4 lines: goal/constraint/success/context, each 0.0–1.0)\n'
    : '';
  const structuredOutputReminder =
    'Respond with the same structured sections as before:\n' +
    '- `## Verdict` (exactly `APPROVE` or `REJECT`)\n' +
    '- `## Comments` (each finding labeled `[P0|P1|P2|P3]`, with Location/Issue/Suggestion/Evidence)\n' +
    '- `## Summary` (1–2 sentences)\n' +
    clarityScoresBullet +
    'Approval rule: `APPROVE` only if there are zero P0 and zero P1 findings.\n';
```

- [ ] **Step 3.4: Run tests to verify they pass**

```bash
pnpm vitest run tests/context/assembler.test.ts
```

Expected: PASS for all tests including the new Clarity Scores assertions.

- [ ] **Step 3.5: Typecheck**

```bash
pnpm tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3.6: Commit**

```bash
git add src/context/assembler.ts tests/context/assembler.test.ts
git commit -m "feat(assembler): inject CLARITY_SCORES_PROTOCOL into P2 gate prompt and resume reminder"
```

---

## Task 4: `gate.ts` + `runner.ts` wiring + integration tests

**Files:**
- Modify: `src/phases/gate.ts`
- Modify: `src/phases/runner.ts`
- Modify: `tests/phases/gate.test.ts`

- [ ] **Step 4.1: Write failing integration tests**

Add to `tests/phases/gate.test.ts` (at the end of the file):

```typescript
import { loadAmbiguityThreshold } from '../../src/phases/ambiguity.js';

// ─── ambiguity gate integration ──────────────────────────────────────────────

describe('runGatePhaseInteractive — ambiguity gate (phase 2)', () => {
  it('phase-2 with low clarity scores → result has ambiguityVetoed and REJECT verdict', async () => {
    const dir = makeTmpDir();
    const runDir = dir;

    // Write verdict file with low goal/constraint scores (ambiguity > 0.2)
    const verdictContent = [
      '## Verdict', 'APPROVE',
      '## Comments', '- looks fine',
      '## Summary', 'OK.',
      '## Clarity Scores',
      '- goal: 0.45', '- constraint: 0.60', '- success: 0.85', '- context: 0.90',
    ].join('\n');
    fs.writeFileSync(path.join(runDir, 'gate-2-verdict.md'), verdictContent);

    const { assembleGatePrompt: asmMock } = await import('../../src/context/assembler.js');
    vi.mocked(asmMock).mockReturnValue('mocked prompt');

    const { waitForPhaseCompletion } = await import('../../src/phases/interactive.js');
    vi.mocked(waitForPhaseCompletion).mockResolvedValue({ status: 'completed' });

    const { createInitialState } = await import('../../src/state.js');
    const state = createInitialState('test-run', '/task.md', 'abc123', false);
    state.phasePresets['2'] = 'codex-high';
    state.tmuxSession = 'mock-session';
    state.tmuxWorkspacePane = 'mock-pane';

    const result = await runGatePhase(2, state, dir, runDir, dir);

    expect(result.type).toBe('verdict');
    if (result.type === 'verdict') {
      expect(result.verdict).toBe('REJECT');
      expect(result.ambiguityVetoed).toBe(true);
      expect(result.clarityScores).toBeDefined();
      expect(result.ambiguity).toBeGreaterThan(0.2);
    }
  });

  it('phase-4 result does NOT have clarityScores or ambiguity', async () => {
    const dir = makeTmpDir();

    const verdictContent = [
      '## Verdict', 'APPROVE',
      '## Summary', 'Plan is solid.',
      '## Clarity Scores',
      '- goal: 0.90', '- constraint: 0.85', '- success: 0.95', '- context: 0.80',
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'gate-4-verdict.md'), verdictContent);

    const { assembleGatePrompt: asmMock } = await import('../../src/context/assembler.js');
    vi.mocked(asmMock).mockReturnValue('mocked prompt');

    const { waitForPhaseCompletion } = await import('../../src/phases/interactive.js');
    vi.mocked(waitForPhaseCompletion).mockResolvedValue({ status: 'completed' });

    const { createInitialState } = await import('../../src/state.js');
    const state = createInitialState('test-run-4', '/task.md', 'abc123', false);
    state.phasePresets['4'] = 'codex-high';
    state.tmuxSession = 'mock-session';
    state.tmuxWorkspacePane = 'mock-pane';

    const result = await runGatePhase(4, state, dir, dir, dir);

    expect(result.type).toBe('verdict');
    expect(result.clarityScores).toBeUndefined();
    expect(result.ambiguity).toBeUndefined();
    expect(result.ambiguityVetoed).toBeUndefined();
  });

  it('sidecar replay of legacy gate-2-result.json (no scores) returns verdict unchanged, no warning', async () => {
    const dir = makeTmpDir();
    const legacyRaw = '## Verdict\nAPPROVE\n## Summary\nOK.';
    const legacyResult = { exitCode: 0, timestamp: Date.now(), runner: 'codex' };
    writeSidecars(dir, 2, legacyRaw, legacyResult as GateResult);

    const { createInitialState } = await import('../../src/state.js');
    const state = createInitialState('legacy-run', '/task.md', 'abc123', false);
    state.phasePresets['2'] = 'codex-high';

    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = await runGatePhase(2, state, dir, dir, dir, { value: true });
    warnSpy.mockRestore();

    expect(result.type).toBe('verdict');
    if (result.type === 'verdict') {
      expect(result.verdict).toBe('APPROVE');
    }
    expect(result.clarityScores).toBeUndefined();
    expect(result.ambiguityVetoed).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4.2: Run tests to verify they fail**

```bash
pnpm vitest run tests/phases/gate.test.ts
```

Expected: FAIL — `applyAmbiguityGate` not yet called from `gate.ts`.

- [ ] **Step 4.3: Wire `applyAmbiguityGate` into `src/phases/gate.ts`**

**4.3a — Add import** at the top of `src/phases/gate.ts`, after the existing `./verdict.js` import:

```typescript
import { loadAmbiguityThreshold, applyAmbiguityGate } from './ambiguity.js';
```

**4.3b — Claude path** (inside the `if (runner === 'claude')` block, around line 318). Change:

```typescript
    const result: GatePhaseResult = { ...rawResult, runner, promptBytes, durationMs };
    if (state.currentPhase !== phase) return result;
    await _persistSidecars(result, runDir, phase, runner, promptBytes, durationMs, preset);
    return result;
```

to:

```typescript
    let result: GatePhaseResult = { ...rawResult, runner, promptBytes, durationMs };
    if (phase === 2) {
      const threshold = loadAmbiguityThreshold();
      result = applyAmbiguityGate(result, result.rawOutput ?? '', threshold);
    }
    if (state.currentPhase !== phase) return result;
    await _persistSidecars(result, runDir, phase, runner, promptBytes, durationMs, preset);
    return result;
```

**4.3c — Codex path** (after Step 10 in the Codex path, before Step 11 codexTokens block). Locate `// Step 11: Collect codexTokens` and insert before it:

```typescript
  // Apply ambiguity gate for phase 2 (after verdict is built, before sidecars)
  if (phase === 2) {
    const threshold = loadAmbiguityThreshold();
    gateResult = applyAmbiguityGate(gateResult, gateResult.rawOutput ?? '', threshold);
  }
```

- [ ] **Step 4.4: Wire new fields into `src/phases/runner.ts`**

Locate the APPROVE branch `gate_verdict` emission (around line 611) and the REJECT branch (around line 663). In **both** emission sites, add the 5 new optional fields after the existing `preset:` line:

```typescript
          ...(phase === 2 && result.clarityScores !== undefined ? { clarityScores: result.clarityScores } : {}),
          ...(phase === 2 && result.ambiguity !== undefined ? { ambiguity: result.ambiguity } : {}),
          ...(phase === 2 && result.ambiguityThreshold !== undefined ? { ambiguityThreshold: result.ambiguityThreshold } : {}),
          ...(phase === 2 && result.ambiguityVetoed !== undefined ? { ambiguityVetoed: result.ambiguityVetoed } : {}),
          ...(phase === 2 && result.clarityParseError !== undefined ? { clarityParseError: result.clarityParseError } : {}),
```

Also update the import at the top of `runner.ts` to include `ClarityScores` (for TypeScript to resolve the spread types — it does this automatically through `GatePhaseResult`, but if TypeScript needs an explicit import add `import type { ClarityScores } from '../types.js';`).

- [ ] **Step 4.5: Run the gate tests**

```bash
pnpm vitest run tests/phases/gate.test.ts
```

Expected: PASS.

- [ ] **Step 4.6: Run the full test suite**

```bash
pnpm vitest run
```

Expected: all tests pass.

- [ ] **Step 4.7: Typecheck**

```bash
pnpm tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4.8: Add runner-level gate_verdict emission tests** (SC7)

Add to `tests/phases/runner.test.ts` inside the existing `describe('handleGatePhase — gate_verdict emission (APPROVE)', ...)` block:

```typescript
  it('emits gate_verdict with clarityScores/ambiguity/ambiguityVetoed on phase-2 APPROVE (vetoed to REJECT)', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 2 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(runGatePhase).mockResolvedValueOnce({
      type: 'verdict',
      verdict: 'REJECT',
      comments: '- **[P1]** synthetic veto\nScope: design',
      rawOutput: '',
      runner: 'codex',
      promptBytes: 1000,
      durationMs: 5000,
      clarityScores: { goal: 0.45, constraint: 0.60, success: 0.85, context: 0.90 },
      ambiguity: 0.3475,
      ambiguityThreshold: 0.2,
      ambiguityVetoed: true,
    } as any);

    try {
      await handleGatePhase(2, state, HDIR, runDir, CWD, createNoOpInputManager(), logger, { value: false });
      const events = readEvents(eventsPath);
      const verdict = events.find((e: any) => e.event === 'gate_verdict');
      expect(verdict).toBeDefined();
      expect(verdict.phase).toBe(2);
      expect(verdict.clarityScores).toEqual({ goal: 0.45, constraint: 0.60, success: 0.85, context: 0.90 });
      expect(verdict.ambiguity).toBeCloseTo(0.3475, 4);
      expect(verdict.ambiguityThreshold).toBe(0.2);
      expect(verdict.ambiguityVetoed).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('does NOT emit clarityScores/ambiguity fields on phase-4 gate_verdict', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 4 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(runGatePhase).mockResolvedValueOnce({
      type: 'verdict',
      verdict: 'APPROVE',
      comments: '',
      rawOutput: '',
      runner: 'codex',
      promptBytes: 1000,
      durationMs: 5000,
      // No clarity fields — should NOT appear in event
    } as any);

    try {
      await handleGatePhase(4, state, HDIR, runDir, CWD, createNoOpInputManager(), logger, { value: false });
      const events = readEvents(eventsPath);
      const verdict = events.find((e: any) => e.event === 'gate_verdict');
      expect(verdict).toBeDefined();
      expect(verdict.phase).toBe(4);
      expect(verdict.clarityScores).toBeUndefined();
      expect(verdict.ambiguity).toBeUndefined();
      expect(verdict.ambiguityVetoed).toBeUndefined();
    } finally {
      cleanup();
    }
  });
```

- [ ] **Step 4.9: Run full test suite after runner tests**

```bash
pnpm vitest run tests/phases/runner.test.ts
```

Expected: PASS including the two new gate_verdict emission tests.

- [ ] **Step 4.10: Commit**

```bash
git add src/phases/gate.ts src/phases/runner.ts tests/phases/gate.test.ts tests/phases/runner.test.ts
git commit -m "feat(gate): wire applyAmbiguityGate at P2 and pass clarity fields through gate_verdict"
```

---

## Task 5: Documentation

**Files:**
- Modify: `docs/HOW-IT-WORKS.md`
- Modify: `docs/HOW-IT-WORKS.ko.md`
- Modify: `README.md`
- Modify: `README.ko.md`

- [ ] **Step 5.1: Update `docs/HOW-IT-WORKS.md`**

In the **Phase 2 spec gate** section (near line 156), add a paragraph after the existing P2 Spec Gate description:

```markdown
**Clarity Scores & Ambiguity Veto (P2 only).** When running the spec gate (full flow P2), Codex is instructed to emit a `## Clarity Scores` block with four axis scores (goal, constraint, success, context), each in [0.0, 1.0]. Harness computes `ambiguity = 1 − Σ(score × weight)` with weights `{goal: 0.35, constraint: 0.25, success: 0.30, context: 0.10}`. If `ambiguity > HARNESS_GATE_AMBIGUITY_THRESHOLD` (default `0.2`) and the qualitative verdict was APPROVE, harness rewrites it to REJECT with a synthetic P1 comment naming the lowest-scoring axes and appends `Scope: design` to route the retry back to Phase 1. Setting the env var to `off` disables the veto while still parsing and logging scores. Parse failure is fail-open — the qualitative verdict stands and `clarityParseError: true` is attached to the event. This feature applies to full-flow P2 only; light-flow P2 (`FIVE_AXIS_DESIGN_GATE_LIGHT`) is unchanged.
```

In the **events.jsonl** section's `gate_verdict` row description (near line 346), extend it to mention the new fields:

```markdown
The `gate_verdict` event for Phase 2 additionally carries five optional fields when the ambiguity gate ran: `clarityScores` (object with goal/constraint/success/context), `ambiguity` (weighted score), `ambiguityThreshold` (threshold in effect), `ambiguityVetoed` (true if APPROVE was rewritten), `clarityParseError` (true if score parsing failed). These fields are absent on P4/P7 events.
```

In the **env-var table** (near line 88 in HOW-IT-WORKS), add a new row:

```markdown
- `HARNESS_GATE_AMBIGUITY_THRESHOLD=0.2` — P2 spec gate ambiguity veto threshold [0, 1]. `=off` to disable veto (scores still logged). Invalid value → veto disabled + one stderr warning.
```

- [ ] **Step 5.2: Update `docs/HOW-IT-WORKS.ko.md`**

Apply the equivalent changes in Korean:

**Phase 2 spec gate 섹션** 추가 단락:

```markdown
**명확성 점수 & 모호성 거부권 (P2 전용).** 전체 플로우 P2 spec gate에서 Codex는 `## Clarity Scores` 블록(4개 축: goal, constraint, success, context, 각 [0.0, 1.0])을 출력하도록 지시받습니다. 하네스는 `ambiguity = 1 − Σ(score × weight)` (가중치: goal 0.35, constraint 0.25, success 0.30, context 0.10)를 계산합니다. `ambiguity > HARNESS_GATE_AMBIGUITY_THRESHOLD` (기본값 `0.2`)이고 정성 판단이 APPROVE였다면, 하네스는 REJECT로 재작성하며 점수가 가장 낮은 두 축을 명시하는 P1 합성 코멘트를 생성합니다. 환경 변수를 `off`로 설정하면 거부권이 비활성화되지만 점수는 여전히 파싱·로깅됩니다. 파싱 실패는 fail-open 처리됩니다. 이 기능은 full-flow P2 전용입니다; light-flow P2는 변경되지 않습니다.
```

**events.jsonl gate_verdict 이벤트** 설명 업데이트:

```markdown
Phase 2의 `gate_verdict` 이벤트에는 모호성 게이트 실행 시 다음 5개의 선택적 필드가 추가됩니다: `clarityScores`, `ambiguity`, `ambiguityThreshold`, `ambiguityVetoed`, `clarityParseError`. 이 필드들은 P4/P7 이벤트에는 포함되지 않습니다.
```

**env var 목록** 추가:

```markdown
- `HARNESS_GATE_AMBIGUITY_THRESHOLD=0.2` — P2 spec gate 모호성 거부권 임계값 [0, 1]. `=off`로 비활성화(점수는 여전히 로깅). 유효하지 않은 값 → 거부권 비활성화 + stderr 경고 1회.
```

- [ ] **Step 5.3: Update `README.md`**

In the **stagnation env-var table** section (around line 231), add a new row to the table:

```markdown
| `HARNESS_GATE_AMBIGUITY_THRESHOLD` | `0.2` | P2 spec gate ambiguity veto threshold [0, 1]. Set to `off` to disable veto (scores still logged). Invalid value → veto disabled + one stderr warning. |
```

In the description of the spec gate (wherever Phase 2 is described in the flow section), add a one-liner:

```markdown
Spec gate (P2) additionally computes a weighted ambiguity score from Codex's `## Clarity Scores` output and vetoes APPROVE→REJECT when `ambiguity > HARNESS_GATE_AMBIGUITY_THRESHOLD` (default 0.2).
```

- [ ] **Step 5.4: Update `README.ko.md`**

Same changes, Korean translation:

Table row:

```markdown
| `HARNESS_GATE_AMBIGUITY_THRESHOLD` | `0.2` | P2 spec gate 모호성 거부권 임계값 [0, 1]. `off`로 비활성화(점수는 여전히 로깅). 유효하지 않은 값 → 거부권 비활성화 + stderr 경고 1회. |
```

Spec gate note:

```markdown
Spec gate (P2)는 Codex의 `## Clarity Scores` 출력에서 가중 모호성 점수를 추가로 계산하며, `ambiguity > HARNESS_GATE_AMBIGUITY_THRESHOLD`(기본값 0.2)인 경우 APPROVE를 REJECT로 재작성합니다.
```

- [ ] **Step 5.5: Run the full test suite one final time**

```bash
pnpm vitest run
```

Expected: all tests pass.

- [ ] **Step 5.6: Typecheck and build**

```bash
pnpm tsc --noEmit && pnpm build
```

Expected: zero errors, build succeeds.

- [ ] **Step 5.7: Commit**

```bash
git add docs/HOW-IT-WORKS.md docs/HOW-IT-WORKS.ko.md README.md README.ko.md
git commit -m "docs: document P2 ambiguity gate, env var, and gate_verdict new fields"
```

---

## Eval Checklist

The machine-readable checklist is at `.harness/2026-05-06-p2-spec-gate-ambiguity-9fa2/checklist.json`.

Verification commands:
```bash
pnpm tsc --noEmit   # typecheck
pnpm vitest run     # full test suite
pnpm build          # tsc + copy-assets
```

## Deferred

(none — gate-7 P2 sidecar persistence and light-flow P2 resume gating
were addressed before merge as follow-up commits.)
