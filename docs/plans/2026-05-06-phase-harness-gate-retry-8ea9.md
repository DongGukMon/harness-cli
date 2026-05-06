# Gate-Retry Stagnation Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unconditional auto-mode force-pass rule with a stagnation check: if the last two adjacent gate-reject feedbacks are ≥70% token-Jaccard similar (two consecutive stagnant pairs), escalate to user instead of silently force-passing.

**Architecture:** A new pure module `src/phases/stagnation.ts` provides `tokenJaccard`, `StagnationDetector`, and `loadStagnationConfig`. `runner.ts` maintains a module-scope `Map<phase, StagnationDetector>` and intercepts the auto-mode force-pass branch in `handleGateReject`. The escalation reuses the existing `handleGateEscalation` prompt; a new optional `reason: 'gate-stagnation'` is passed via opts to distinguish the log event.

**Tech Stack:** TypeScript, Vitest, Node.js process.env

---

## File Map

| File | Change |
|---|---|
| `src/phases/stagnation.ts` | **new** — `tokenJaccard`, `StagnationDetector`, `loadStagnationConfig`, `__resetWarnCache` |
| `tests/phases/stagnation.test.ts` | **new** — unit tests for all stagnation module exports |
| `src/types.ts` | **edit** — add `gate_stagnation` LogEvent variant; extend `escalation.reason` enum |
| `src/logger.ts` | **edit** — add `stagnationEscalations` counter in `finalizeSummary` |
| `src/phases/runner.ts` | **edit** — detector map, `handleGateEscalation` opts, `handleGateReject` interception, detector drops on APPROVE/forcePass/escalation-C |
| `tests/phases/runner.test.ts` | **edit** — add 7 new test cases (stagnation happy path, regression guards) |
| `tests/integration/gate-stagnation.test.ts` | **new** — event-ordering integration test |
| `README.md`, `README.ko.md` | **edit** — document 4 env vars (one paragraph each) |
| `docs/HOW-IT-WORKS.md`, `docs/HOW-IT-WORKS.ko.md` | **edit** — add stagnation sub-section under gate retry; update events schema table |

---

## Task 1: src/phases/stagnation.ts — core detection module

**Files:**
- Create: `src/phases/stagnation.ts`

- [ ] **Step 1: Write the module**

```typescript
// src/phases/stagnation.ts

function tokenize(text: string): string[] {
  return Array.from(
    text.normalize('NFKC').toLowerCase().matchAll(/[\p{L}\p{N}_]+/gu),
    m => m[0],
  );
}

export function tokenJaccard(a: string, b: string): number | null {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (A.size === 0 || B.size === 0) return null;
  let inter = 0;
  for (const x of A) { if (B.has(x)) inter++; }
  const union = A.size + B.size - inter;
  if (union === 0) return null;
  return inter / union;
}

export class StagnationDetector {
  private buf: string[] = [];
  private readonly capacity: number;

  constructor(private readonly cfg: { threshold: number; run: number; window: number }) {
    this.capacity = cfg.run + (cfg.window - 1);
  }

  record(comments: string): void {
    this.buf.push(comments);
    if (this.buf.length > this.capacity) this.buf.shift();
  }

  shouldEscalate(): { triggered: boolean; similarities: number[] } {
    const { run, threshold } = this.cfg;
    if (this.buf.length < run + 1) return { triggered: false, similarities: [] };
    const similarities: number[] = [];
    for (let i = this.buf.length - run - 1; i < this.buf.length - 1; i++) {
      const sim = tokenJaccard(this.buf[i], this.buf[i + 1]);
      if (sim === null || sim < threshold) return { triggered: false, similarities: [] };
      similarities.push(sim);
    }
    return { triggered: true, similarities };
  }
}

const warnedKeys = new Set<string>();

export function loadStagnationConfig(autoMode: boolean): {
  enabled: boolean; threshold: number; run: number; window: number;
} {
  const base = { threshold: 0.70, run: 2, window: 2 };

  const envMain      = process.env['HARNESS_GATE_STAGNATION'];
  const envThreshold = process.env['HARNESS_GATE_STAGNATION_THRESHOLD'];
  const envRun       = process.env['HARNESS_GATE_STAGNATION_RUN'];
  // HARNESS_GATE_STAGNATION_WINDOW is reserved/no-op in v1 — intentionally not read

  let enabled   = autoMode;   // default: on in auto, off in manual
  let threshold = base.threshold;
  let run       = base.run;

  if (envMain !== undefined) {
    const lower = envMain.toLowerCase();
    if (lower === 'on') {
      enabled = true;
    } else if (lower === 'off') {
      enabled = false;
    } else {
      if (!warnedKeys.has('HARNESS_GATE_STAGNATION')) {
        console.warn(`[stagnation] invalid HARNESS_GATE_STAGNATION="${envMain}" — feature disabled`);
        warnedKeys.add('HARNESS_GATE_STAGNATION');
      }
      return { enabled: false, ...base };
    }
  }

  if (envThreshold !== undefined) {
    const parsed = parseFloat(envThreshold);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 1) {
      if (!warnedKeys.has('HARNESS_GATE_STAGNATION_THRESHOLD')) {
        console.warn(`[stagnation] invalid HARNESS_GATE_STAGNATION_THRESHOLD="${envThreshold}" — feature disabled`);
        warnedKeys.add('HARNESS_GATE_STAGNATION_THRESHOLD');
      }
      return { enabled: false, ...base };
    }
    threshold = parsed;
  }

  if (envRun !== undefined) {
    const parsed = parseInt(envRun, 10);
    if (Number.isNaN(parsed) || parsed < 2) {
      if (!warnedKeys.has('HARNESS_GATE_STAGNATION_RUN')) {
        console.warn(`[stagnation] invalid HARNESS_GATE_STAGNATION_RUN="${envRun}" — feature disabled`);
        warnedKeys.add('HARNESS_GATE_STAGNATION_RUN');
      }
      return { enabled: false, ...base };
    }
    run = parsed;
  }

  return { enabled, threshold, run, window: 2 };
}

// Test hook — resets the per-process warn dedup set.
export function __resetWarnCache(): void {
  warnedKeys.clear();
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/improve-cycle
pnpm tsc --noEmit
```

Expected: exits 0, no errors about the new file.

- [ ] **Step 3: Commit**

```bash
git add src/phases/stagnation.ts
git commit -m "feat(stagnation): add tokenJaccard, StagnationDetector, loadStagnationConfig"
```

---

## Task 2: tests/phases/stagnation.test.ts — unit tests

**Files:**
- Create: `tests/phases/stagnation.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/phases/stagnation.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tokenJaccard, StagnationDetector, loadStagnationConfig, __resetWarnCache } from '../../src/phases/stagnation.js';

beforeEach(() => {
  __resetWarnCache();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetWarnCache();
});

// ─── tokenJaccard ────────────────────────────────────────────────────────────

describe('tokenJaccard', () => {
  it('identical strings return 1', () => {
    expect(tokenJaccard('the quick brown fox', 'the quick brown fox')).toBe(1);
  });

  it('disjoint strings return 0', () => {
    expect(tokenJaccard('alpha beta', 'gamma delta')).toBe(0);
  });

  it('one-side empty returns null', () => {
    expect(tokenJaccard('', 'hello world')).toBeNull();
    expect(tokenJaccard('hello world', '')).toBeNull();
  });

  it('both empty returns null', () => {
    expect(tokenJaccard('', '')).toBeNull();
  });

  it('NFKC normalisation: ½ tokenises the same as 1 2', () => {
    // '½' normalises to '1/2' under NFKC → tokens ['1', '2']
    const sim = tokenJaccard('½ cup', '1 2 cup');
    expect(sim).not.toBeNull();
    expect(sim!).toBeGreaterThan(0.5);
  });

  it('case insensitive', () => {
    expect(tokenJaccard('Hello World', 'hello world')).toBe(1);
  });

  it('mixed Korean and English', () => {
    const sim = tokenJaccard('플랜이 누락됨 plan missing', '플랜이 누락됨 plan missing');
    expect(sim).toBe(1);
  });

  it('partial overlap returns value in (0, 1)', () => {
    const sim = tokenJaccard('plan is missing tests', 'plan needs tests and docs');
    expect(sim).not.toBeNull();
    expect(sim!).toBeGreaterThan(0);
    expect(sim!).toBeLessThan(1);
  });

  it('very long strings produce a finite result (length-stable)', () => {
    const long = 'word '.repeat(10_000).trim();
    const sim = tokenJaccard(long, long);
    expect(sim).toBe(1);
  });
});

// ─── StagnationDetector.record ────────────────────────────────────────────────

describe('StagnationDetector.record — FIFO buffer', () => {
  it('drops oldest entry when buffer exceeds RUN + WINDOW - 1 = 3', () => {
    const d = new StagnationDetector({ threshold: 0.70, run: 2, window: 2 });
    // push 4 items — capacity is 3
    d.record('a');
    d.record('b');
    d.record('c');
    d.record('d'); // 'a' should be evicted

    // Only last 3 entries matter; verify by checking shouldEscalate doesn't see 'a'
    // (if 'a' were still in buffer, we'd have 4 entries, but capacity is 3)
    // We check indirectly: 'a','b','c' → diverse; 'b','c','d' → b/c differ from d
    const { triggered } = d.shouldEscalate();
    // 'b' vs 'c' and 'c' vs 'd' — all distinct — should not trigger
    expect(triggered).toBe(false);
  });

  it('accepts RUN=3 and capacity is RUN + WINDOW - 1 = 4', () => {
    const d = new StagnationDetector({ threshold: 0.70, run: 3, window: 2 });
    const same = 'plan is missing tests and docs and coverage';
    d.record(same);
    d.record(same);
    d.record(same);
    d.record(same); // 4 entries, 3 adjacent pairs all sim=1.0
    const { triggered, similarities } = d.shouldEscalate();
    expect(triggered).toBe(true);
    expect(similarities).toHaveLength(3);
  });
});

// ─── StagnationDetector.shouldEscalate ────────────────────────────────────────

describe('StagnationDetector.shouldEscalate', () => {
  const SAME = 'plan does not cover spec requirements; tests are missing; docs incomplete';
  const DIFF = 'implementation looks correct but formatting needs work';

  it('buffer < RUN+1 entries → triggered false', () => {
    const d = new StagnationDetector({ threshold: 0.70, run: 2, window: 2 });
    d.record(SAME); // 1 entry, need ≥3
    d.record(SAME); // 2 entries, need ≥3
    expect(d.shouldEscalate().triggered).toBe(false);
  });

  it('last RUN pairs all ≥ threshold → triggered true', () => {
    const d = new StagnationDetector({ threshold: 0.70, run: 2, window: 2 });
    d.record(SAME);
    d.record(SAME);
    d.record(SAME);
    const { triggered, similarities } = d.shouldEscalate();
    expect(triggered).toBe(true);
    expect(similarities).toHaveLength(2);
    similarities.forEach(s => expect(s).toBeGreaterThanOrEqual(0.70));
  });

  it('one pair below threshold → triggered false', () => {
    const d = new StagnationDetector({ threshold: 0.70, run: 2, window: 2 });
    d.record(SAME);
    d.record(DIFF); // this pair will be < threshold
    d.record(SAME);
    expect(d.shouldEscalate().triggered).toBe(false);
  });

  it('pair where one side tokenizes to empty → triggered false (null similarity)', () => {
    const d = new StagnationDetector({ threshold: 0.70, run: 2, window: 2 });
    d.record(SAME);
    d.record(''); // empty → null similarity
    d.record(SAME);
    expect(d.shouldEscalate().triggered).toBe(false);
  });

  it('threshold 0 → always triggers when buffer is full', () => {
    const d = new StagnationDetector({ threshold: 0, run: 2, window: 2 });
    d.record('alpha');
    d.record('beta');
    d.record('gamma'); // all disjoint but sim ≥ 0
    const { triggered } = d.shouldEscalate();
    expect(triggered).toBe(true);
  });
});

// ─── loadStagnationConfig ─────────────────────────────────────────────────────

describe('loadStagnationConfig', () => {
  it('manual mode default: enabled=false', () => {
    const cfg = loadStagnationConfig(false);
    expect(cfg.enabled).toBe(false);
    expect(cfg.threshold).toBe(0.70);
    expect(cfg.run).toBe(2);
    expect(cfg.window).toBe(2);
  });

  it('auto mode default: enabled=true', () => {
    const cfg = loadStagnationConfig(true);
    expect(cfg.enabled).toBe(true);
    expect(cfg.threshold).toBe(0.70);
    expect(cfg.run).toBe(2);
    expect(cfg.window).toBe(2);
  });

  it('HARNESS_GATE_STAGNATION=off overrides auto-mode default', () => {
    vi.stubEnv('HARNESS_GATE_STAGNATION', 'off');
    expect(loadStagnationConfig(true).enabled).toBe(false);
  });

  it('HARNESS_GATE_STAGNATION=on overrides manual-mode default', () => {
    vi.stubEnv('HARNESS_GATE_STAGNATION', 'on');
    expect(loadStagnationConfig(false).enabled).toBe(true);
  });

  it('HARNESS_GATE_STAGNATION=ON (uppercase) is accepted', () => {
    vi.stubEnv('HARNESS_GATE_STAGNATION', 'ON');
    expect(loadStagnationConfig(true).enabled).toBe(true);
  });

  it('invalid HARNESS_GATE_STAGNATION → enabled=false + exactly one warn', () => {
    vi.stubEnv('HARNESS_GATE_STAGNATION', 'maybe');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    loadStagnationConfig(true);
    loadStagnationConfig(true); // second call — warn must NOT fire again
    const stagnationWarns = warnSpy.mock.calls.filter(args => String(args[0]).includes('HARNESS_GATE_STAGNATION'));
    expect(stagnationWarns).toHaveLength(1);
    expect(loadStagnationConfig(true).enabled).toBe(false);
  });

  it('valid HARNESS_GATE_STAGNATION_THRESHOLD is parsed', () => {
    vi.stubEnv('HARNESS_GATE_STAGNATION_THRESHOLD', '0.85');
    const cfg = loadStagnationConfig(true);
    expect(cfg.threshold).toBe(0.85);
    expect(cfg.enabled).toBe(true);
  });

  it('invalid HARNESS_GATE_STAGNATION_THRESHOLD → enabled=false + one warn for that key', () => {
    vi.stubEnv('HARNESS_GATE_STAGNATION_THRESHOLD', 'not-a-number');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    loadStagnationConfig(true);
    loadStagnationConfig(true);
    const warns = warnSpy.mock.calls.filter(args => String(args[0]).includes('HARNESS_GATE_STAGNATION_THRESHOLD'));
    expect(warns).toHaveLength(1);
  });

  it('HARNESS_GATE_STAGNATION_THRESHOLD out of [0,1] range → enabled=false', () => {
    vi.stubEnv('HARNESS_GATE_STAGNATION_THRESHOLD', '1.5');
    expect(loadStagnationConfig(true).enabled).toBe(false);
    __resetWarnCache();
    vi.stubEnv('HARNESS_GATE_STAGNATION_THRESHOLD', '-0.1');
    expect(loadStagnationConfig(true).enabled).toBe(false);
  });

  it('valid HARNESS_GATE_STAGNATION_RUN is parsed', () => {
    vi.stubEnv('HARNESS_GATE_STAGNATION_RUN', '3');
    const cfg = loadStagnationConfig(true);
    expect(cfg.run).toBe(3);
    expect(cfg.enabled).toBe(true);
  });

  it('invalid HARNESS_GATE_STAGNATION_RUN → enabled=false + one warn', () => {
    vi.stubEnv('HARNESS_GATE_STAGNATION_RUN', 'bad');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    loadStagnationConfig(true);
    loadStagnationConfig(true);
    const warns = warnSpy.mock.calls.filter(args => String(args[0]).includes('HARNESS_GATE_STAGNATION_RUN'));
    expect(warns).toHaveLength(1);
  });

  it('HARNESS_GATE_STAGNATION_RUN < 2 → enabled=false', () => {
    vi.stubEnv('HARNESS_GATE_STAGNATION_RUN', '1');
    expect(loadStagnationConfig(true).enabled).toBe(false);
  });

  it('HARNESS_GATE_STAGNATION_WINDOW set to any value → window=2, no warn, enabled unaffected', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const val of ['5', '-1', 'not-a-number', '']) {
      __resetWarnCache();
      vi.stubEnv('HARNESS_GATE_STAGNATION_WINDOW', val);
      const cfg = loadStagnationConfig(true);
      expect(cfg.window).toBe(2);
      expect(cfg.enabled).toBe(true);
      const windowWarns = warnSpy.mock.calls.filter(args => String(args[0]).includes('HARNESS_GATE_STAGNATION_WINDOW'));
      expect(windowWarns).toHaveLength(0);
      vi.unstubAllEnvs();
    }
  });

  it('all-valid envs return parsed values with enabled=true in auto-mode', () => {
    vi.stubEnv('HARNESS_GATE_STAGNATION', 'on');
    vi.stubEnv('HARNESS_GATE_STAGNATION_THRESHOLD', '0.80');
    vi.stubEnv('HARNESS_GATE_STAGNATION_RUN', '3');
    vi.stubEnv('HARNESS_GATE_STAGNATION_WINDOW', '5'); // no-op
    const cfg = loadStagnationConfig(true);
    expect(cfg.enabled).toBe(true);
    expect(cfg.threshold).toBe(0.80);
    expect(cfg.run).toBe(3);
    expect(cfg.window).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests — expect pass (or verify failures only from missing imports)**

```bash
pnpm vitest run tests/phases/stagnation.test.ts
```

Expected: all tests in this file pass.

- [ ] **Step 3: Run full typecheck**

```bash
pnpm tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add tests/phases/stagnation.test.ts
git commit -m "test(stagnation): add unit tests for tokenJaccard, StagnationDetector, loadStagnationConfig"
```

---

## Task 3: src/types.ts — type extensions

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add gate_stagnation event variant to LogEvent union**

In `src/types.ts`, find the `LogEvent` union type (around line 233). Add the new variant after the `gate_retry` entry (around line 275):

Old line 275:
```typescript
  | (LogEventBase & { event: 'gate_retry'; phase: number; retryIndex: number; retryCount: number; retryLimit: number; feedbackPath: string; feedbackBytes: number; feedbackPreview: string })
  | (LogEventBase & { event: 'escalation'; phase: number; reason: 'gate-retry-limit' | 'gate-error' | 'verify-limit' | 'verify-error'; userChoice?: 'C' | 'S' | 'Q' | 'R' })
```

New lines (insert the `gate_stagnation` variant between `gate_retry` and `escalation`; also extend the `escalation.reason` enum):

```typescript
  | (LogEventBase & { event: 'gate_retry'; phase: number; retryIndex: number; retryCount: number; retryLimit: number; feedbackPath: string; feedbackBytes: number; feedbackPreview: string })
  | (LogEventBase & {
      event: 'gate_stagnation';
      phase: number;
      retryIndex: number;
      similarities: number[];
      threshold: number;
      run: number;
      action: 'escalate';
    })
  | (LogEventBase & { event: 'escalation'; phase: number; reason: 'gate-retry-limit' | 'gate-error' | 'verify-limit' | 'verify-error' | 'gate-stagnation'; userChoice?: 'C' | 'S' | 'Q' | 'R' })
```

- [ ] **Step 2: Run typecheck to confirm no breakage**

```bash
pnpm tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 3: Verify grep rules from Success Criterion #2**

```bash
grep -n "event: 'gate_stagnation'" src/types.ts
grep -n "'gate-stagnation'" src/types.ts
```

Expected: each returns ≥ 1 hit.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add gate_stagnation LogEvent variant and gate-stagnation escalation reason"
```

---

## Task 4: src/logger.ts — stagnationEscalations counter

**Files:**
- Modify: `src/logger.ts`

- [ ] **Step 1: Add stagnationEscalations to finalizeSummary**

In `src/logger.ts`, find `finalizeSummary` (line ~159). Find the `totals` variable declaration (around line 183):

```typescript
      let gateTokens = 0, gateRejects = 0, gateErrors = 0, escalations = 0, verifyFailures = 0, forcePasses = 0;
```

Change to:

```typescript
      let gateTokens = 0, gateRejects = 0, gateErrors = 0, escalations = 0, verifyFailures = 0, forcePasses = 0, stagnationEscalations = 0;
```

Find the `gate_stagnation` event handling — add a counter increment in the event loop (around line 193, after `force_pass` handling):

```typescript
        } else if (e.event === 'force_pass') {
          forcePasses++;
        } else if (e.event === 'gate_stagnation' && (e as any).action === 'escalate') {
          stagnationEscalations++;
        } else if (e.event === 'verify_result' && !e.passed) {
```

Find the `summary.totals` object (around line 244):

```typescript
        totals: { gateTokens, gateRejects, gateErrors, escalations, verifyFailures, forcePasses },
```

Change to:

```typescript
        totals: { gateTokens, gateRejects, gateErrors, escalations, verifyFailures, forcePasses, stagnationEscalations },
```

- [ ] **Step 2: Typecheck**

```bash
pnpm tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/logger.ts
git commit -m "feat(logger): add stagnationEscalations counter to finalizeSummary"
```

---

## Task 5: src/phases/runner.ts — detection wiring

**Files:**
- Modify: `src/phases/runner.ts`

This task has multiple sub-changes. Apply them all, then typecheck and commit at the end.

- [ ] **Step 1: Add imports at the top of runner.ts**

Find the existing imports at the top of `src/phases/runner.ts`. Add:

```typescript
import { StagnationDetector, loadStagnationConfig } from './stagnation.js';
```

(Place it near other local-module imports, e.g., after the `import ... from './verdict.js'` line.)

- [ ] **Step 2: Add module-scope detector map + helpers after imports**

Find the first non-import line in `src/phases/runner.ts` (e.g. the first `const` or `function` declaration). Add the following block immediately before it:

```typescript
// ─── Stagnation detector map ──────────────────────────────────────────────────
// In-memory only; never serialised. Keyed by gate phase number.
const detectorMap = new Map<string, StagnationDetector>();

function getOrCreateDetector(phase: number, cfg: { threshold: number; run: number; window: number }): StagnationDetector {
  const key = String(phase);
  if (!detectorMap.has(key)) detectorMap.set(key, new StagnationDetector(cfg));
  return detectorMap.get(key)!;
}

function dropDetector(phase: number): void {
  detectorMap.delete(String(phase));
}

// Test hook — reset all detector state between test cases.
export function __resetDetectors(): void {
  detectorMap.clear();
}
```

- [ ] **Step 3: Extend handleGateEscalation signature with opts**

Find the `handleGateEscalation` function definition (around line 798). Change its signature from:

```typescript
export async function handleGateEscalation(
  phase: GatePhase,
  comments: string,
  scope: Scope | undefined,
  retryIndex: number,
  state: HarnessState,
  runDir: string,
  cwd: string,
  inputManager: InputManager,
  logger: SessionLogger,
): Promise<void> {
```

To:

```typescript
export async function handleGateEscalation(
  phase: GatePhase,
  comments: string,
  scope: Scope | undefined,
  retryIndex: number,
  state: HarnessState,
  runDir: string,
  cwd: string,
  inputManager: InputManager,
  logger: SessionLogger,
  opts?: { reason?: 'gate-retry-limit' | 'gate-stagnation' },
): Promise<void> {
```

Find the escalation event emission inside `handleGateEscalation` (around line 823):

```typescript
  logger.logEvent({
    event: 'escalation',
    phase,
    reason: 'gate-retry-limit',
    userChoice: choice as 'C' | 'S' | 'Q',
  });
```

Change to:

```typescript
  logger.logEvent({
    event: 'escalation',
    phase,
    reason: opts?.reason ?? 'gate-retry-limit',
    userChoice: choice as 'C' | 'S' | 'Q',
  });
```

- [ ] **Step 4: Drop detector in handleGateEscalation choice 'C'**

Inside `handleGateEscalation`, find the block that increments `gateEscalationCycles` (around line 848-849):

```typescript
    state.gateEscalationCycles = state.gateEscalationCycles ?? {};
    state.gateEscalationCycles[key] = (state.gateEscalationCycles[key] ?? 0) + 1;
```

Add `dropDetector(phase)` immediately after:

```typescript
    state.gateEscalationCycles = state.gateEscalationCycles ?? {};
    state.gateEscalationCycles[key] = (state.gateEscalationCycles[key] ?? 0) + 1;
    dropDetector(phase);
```

- [ ] **Step 5: Drop detector in forcePassGate**

Find `forcePassGate` (around line 899). After `logger.logEvent({ event: 'force_pass', phase, by })` (around line 911), add:

```typescript
  logger.logEvent({ event: 'force_pass', phase, by });
  dropDetector(phase);
```

- [ ] **Step 6: Drop detector on gate APPROVE in handleGatePhase**

Find the APPROVE branch in `handleGatePhase` (around line 614):

```typescript
      state.phases[String(phase)] = 'completed';

      // Post-success sidecar cleanup
      deleteGateSidecars(runDir, phase);
```

Add `dropDetector(phase)` after `state.phases` mutation:

```typescript
      state.phases[String(phase)] = 'completed';
      dropDetector(phase);

      // Post-success sidecar cleanup
      deleteGateSidecars(runDir, phase);
```

- [ ] **Step 7: Intercept the force-pass branch in handleGateReject**

Find `handleGateReject` (around line 695). After the first line `state.phases[String(phase)] = 'pending';`, insert the config load + record call:

```typescript
  state.phases[String(phase)] = 'pending';

  const cfg = loadStagnationConfig(state.autoMode);
  let detector: StagnationDetector | undefined;
  if (cfg.enabled) {
    detector = getOrCreateDetector(phase, cfg);
    detector.record(comments);
  }
```

Then find the existing auto-mode force-pass branch (around line 727):

```typescript
    if (retryCount >= retryLimit && state.autoMode) {
      // Auto-mode force pass (no gate_retry event — force_pass covers this path)
      await forcePassGate(phase, state, runDir, cwd, 'auto', logger);
      return;
    }
```

Replace with:

```typescript
    if (retryCount >= retryLimit && state.autoMode) {
      if (cfg.enabled && detector !== undefined) {
        let triggered = false;
        let similarities: number[] = [];
        try {
          const r = detector.shouldEscalate();
          triggered = r.triggered;
          similarities = r.similarities;
        } catch (err) {
          console.warn(`[stagnation] detector error: ${(err as Error).message} — falling back to force-pass`);
        }
        if (triggered) {
          logger.logEvent({
            event: 'gate_stagnation',
            phase, retryIndex,
            similarities,
            threshold: cfg.threshold,
            run: cfg.run,
            action: 'escalate',
          });
          await handleGateEscalation(
            phase, comments, scope, retryIndex,
            state, runDir, cwd, inputManager, logger,
            { reason: 'gate-stagnation' },
          );
          return;
        }
      }
      // Auto-mode force pass (no gate_retry event — force_pass covers this path)
      await forcePassGate(phase, state, runDir, cwd, 'auto', logger);
      return;
    }
```

- [ ] **Step 8: Typecheck the entire codebase**

```bash
pnpm tsc --noEmit
```

Expected: exits 0, no type errors.

- [ ] **Step 9: Verify grep rules from Success Criterion #3**

```bash
grep -n "loadStagnationConfig\|gate_stagnation" src/phases/runner.ts
```

Expected: ≥ 2 hits both inside the `handleGateReject` function body.

- [ ] **Step 10: Commit**

```bash
git add src/phases/runner.ts
git commit -m "feat(runner): intercept auto-mode force-pass with stagnation detection; add detector lifecycle management"
```

---

## Task 6: tests/phases/runner.test.ts — stagnation regression tests

**Files:**
- Modify: `tests/phases/runner.test.ts`

- [ ] **Step 1: Update the import from runner.ts to include new exports**

Find the existing `import { ... } from '../../src/phases/runner.js'` (around line 76). Add `__resetDetectors` to the import list:

```typescript
import {
  runPhaseLoop,
  handleInteractivePhase,
  handleGatePhase,
  handleGateReject,
  handleGateEscalation,
  handleGateError,
  forcePassGate,
  forcePassVerify,
  handleVerifyPhase,
  handleVerifyFail,
  handleVerifyEscalation,
  handleVerifyError,
  __resetDetectors,
} from '../../src/phases/runner.js';
```

Also add import of `__resetWarnCache` from stagnation:

```typescript
import { __resetWarnCache } from '../../src/phases/stagnation.js';
```

- [ ] **Step 2: Reset detector state in afterEach**

Find the existing `afterEach` block (around line 104):

```typescript
afterEach(() => {
  vi.clearAllMocks();
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
});
```

Change to:

```typescript
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  __resetDetectors();
  __resetWarnCache();
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
});
```

- [ ] **Step 3: Add stagnation test block at end of file**

Append the following describe block at the very end of `tests/phases/runner.test.ts`:

```typescript
// ─── Stagnation detection in handleGateReject ─────────────────────────────────

const STAGNANT = 'plan does not cover spec requirements; tests are missing; docs incomplete';
const DIVERSE_A = 'the implementation is mostly correct but tests need edge case coverage';
const DIVERSE_B = 'formatting issues found; please fix indentation and remove dead code';
const DIVERSE_C = 'critical bug in error handler path; stack overflow under high load';

describe('Stagnation — Test 5: auto-mode + 3 stagnant rejects → gate_stagnation + handleGateEscalation', () => {
  it('emits gate_stagnation and calls handleGateEscalation with reason gate-stagnation', async () => {
    __resetDetectors();
    const runDir = makeTmpDir();
    const state = makeState({ autoMode: true, currentPhase: 2 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(promptChoice).mockResolvedValueOnce('Q');

    try {
      // 3 rejects, same text — buffer fills with 3 identical entries
      await handleGateReject(2, STAGNANT, undefined, 0, state, HDIR, runDir, CWD, createNoOpInputManager(), logger);
      await handleGateReject(2, STAGNANT, undefined, 1, state, HDIR, runDir, CWD, createNoOpInputManager(), logger);
      // 3rd reject: retryCount = 3 = retryLimit → stagnation fires
      await handleGateReject(2, STAGNANT, undefined, 2, state, HDIR, runDir, CWD, createNoOpInputManager(), logger);

      const events = readEvents(eventsPath);
      const stagnation = events.find((e: any) => e.event === 'gate_stagnation');
      expect(stagnation).toBeDefined();
      expect(stagnation.phase).toBe(2);
      expect(stagnation.action).toBe('escalate');
      expect(Array.isArray(stagnation.similarities)).toBe(true);
      expect(stagnation.similarities.length).toBeGreaterThanOrEqual(1);

      const escalation = events.find((e: any) => e.event === 'escalation');
      expect(escalation).toBeDefined();
      expect(escalation.reason).toBe('gate-stagnation');

      const forcePassEvents = events.filter((e: any) => e.event === 'force_pass');
      expect(forcePassEvents).toHaveLength(0);

      // forcePassGate must NOT have been called
      expect(vi.mocked(promptChoice)).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });
});

describe('Stagnation — Test 6: auto-mode + 3 diverse rejects → forcePassGate, no gate_stagnation', () => {
  it('calls forcePassGate and does NOT emit gate_stagnation', async () => {
    __resetDetectors();
    const runDir = makeTmpDir();
    const state = makeState({ autoMode: true, currentPhase: 2 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    try {
      await handleGateReject(2, DIVERSE_A, undefined, 0, state, HDIR, runDir, CWD, createNoOpInputManager(), logger);
      await handleGateReject(2, DIVERSE_B, undefined, 1, state, HDIR, runDir, CWD, createNoOpInputManager(), logger);
      await handleGateReject(2, DIVERSE_C, undefined, 2, state, HDIR, runDir, CWD, createNoOpInputManager(), logger);

      const events = readEvents(eventsPath);
      expect(events.find((e: any) => e.event === 'gate_stagnation')).toBeUndefined();
      expect(events.find((e: any) => e.event === 'force_pass')).toBeDefined();

      const writes = vi.mocked(writeState).mock.calls.map(([, s]) => s);
      const forcePassState = writes.find(s => s.phases['2'] === 'completed');
      expect(forcePassState).toBeDefined();

      expect(vi.mocked(promptChoice)).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });
});

describe('Stagnation — Test 7: manual mode + 3 stagnant rejects → escalation reason=gate-retry-limit (no change)', () => {
  it('preserves existing manual-mode escalation path', async () => {
    __resetDetectors();
    const runDir = makeTmpDir();
    const state = makeState({ autoMode: false, currentPhase: 2,
      gateRetries: { '2': FULL_GATE_RETRY_LIMIT, '4': 0, '7': 0 } });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(promptChoice).mockResolvedValueOnce('Q');

    try {
      await handleGateReject(2, STAGNANT, undefined, FULL_GATE_RETRY_LIMIT, state, HDIR, runDir, CWD, createNoOpInputManager(), logger);

      const events = readEvents(eventsPath);
      const escalation = events.find((e: any) => e.event === 'escalation');
      expect(escalation).toBeDefined();
      expect(escalation.reason).toBe('gate-retry-limit');
      expect(events.find((e: any) => e.event === 'gate_stagnation')).toBeUndefined();
    } finally {
      cleanup();
    }
  });
});

describe('Stagnation — Test 8: HARNESS_GATE_STAGNATION=off in auto-mode → forcePassGate', () => {
  it('disables stagnation via env; falls back to force-pass', async () => {
    __resetDetectors();
    __resetWarnCache();
    vi.stubEnv('HARNESS_GATE_STAGNATION', 'off');

    const runDir = makeTmpDir();
    const state = makeState({ autoMode: true, currentPhase: 2 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    try {
      await handleGateReject(2, STAGNANT, undefined, 0, state, HDIR, runDir, CWD, createNoOpInputManager(), logger);
      await handleGateReject(2, STAGNANT, undefined, 1, state, HDIR, runDir, CWD, createNoOpInputManager(), logger);
      await handleGateReject(2, STAGNANT, undefined, 2, state, HDIR, runDir, CWD, createNoOpInputManager(), logger);

      const events = readEvents(eventsPath);
      expect(events.find((e: any) => e.event === 'gate_stagnation')).toBeUndefined();
      expect(events.find((e: any) => e.event === 'force_pass')).toBeDefined();
      expect(vi.mocked(promptChoice)).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });
});

describe('Stagnation — Test 9: detector throws → forcePassGate, single warn, no gate_stagnation', () => {
  it('catches detector exception and falls back to force-pass', async () => {
    __resetDetectors();
    const runDir = makeTmpDir();
    const state = makeState({ autoMode: true, currentPhase: 2 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    // Populate buffer so stagnation would normally trigger
    await handleGateReject(2, STAGNANT, undefined, 0, state, HDIR, runDir, CWD, createNoOpInputManager(), logger);
    await handleGateReject(2, STAGNANT, undefined, 1, state, HDIR, runDir, CWD, createNoOpInputManager(), logger);

    // Make shouldEscalate throw on the 3rd call
    const { StagnationDetector: SD } = await import('../../src/phases/stagnation.js');
    const origShouldEscalate = SD.prototype.shouldEscalate;
    SD.prototype.shouldEscalate = function() { throw new Error('detector exploded'); };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await handleGateReject(2, STAGNANT, undefined, 2, state, HDIR, runDir, CWD, createNoOpInputManager(), logger);

      const events = readEvents(eventsPath);
      expect(events.find((e: any) => e.event === 'gate_stagnation')).toBeUndefined();
      expect(events.find((e: any) => e.event === 'force_pass')).toBeDefined();

      const stagnationWarns = warnSpy.mock.calls.filter(args => String(args[0]).includes('detector error'));
      expect(stagnationWarns).toHaveLength(1);

      expect(vi.mocked(promptChoice)).not.toHaveBeenCalled();
    } finally {
      SD.prototype.shouldEscalate = origShouldEscalate;
      cleanup();
    }
  });
});

describe('Stagnation — Test 9a: invalid THRESHOLD env in auto-mode → forcePassGate, one warn', () => {
  it('unified fail-open: invalid validated env disables feature', async () => {
    __resetDetectors();
    __resetWarnCache();
    vi.stubEnv('HARNESS_GATE_STAGNATION_THRESHOLD', 'not-a-number');

    const runDir = makeTmpDir();
    const state = makeState({ autoMode: true, currentPhase: 2 });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await handleGateReject(2, STAGNANT, undefined, 0, state, HDIR, runDir, CWD, createNoOpInputManager(), new NoopLogger());
      await handleGateReject(2, STAGNANT, undefined, 1, state, HDIR, runDir, CWD, createNoOpInputManager(), new NoopLogger());
      await handleGateReject(2, STAGNANT, undefined, 2, state, HDIR, runDir, CWD, createNoOpInputManager(), new NoopLogger());

      expect(vi.mocked(promptChoice)).not.toHaveBeenCalled();

      const writes = vi.mocked(writeState).mock.calls.map(([, s]) => s);
      const forcePassState = writes.find(s => s.phases['2'] === 'completed');
      expect(forcePassState).toBeDefined();

      const warns = warnSpy.mock.calls.filter(args => String(args[0]).includes('HARNESS_GATE_STAGNATION_THRESHOLD'));
      expect(warns).toHaveLength(1);
    } finally {
      // no cleanup needed (NoopLogger)
    }
  });
});

describe('Stagnation — Test 9b: WINDOW env set to non-2 value → stagnation still fires, no warn', () => {
  it('WINDOW is a no-op; feature remains enabled when only WINDOW is set', async () => {
    __resetDetectors();
    __resetWarnCache();
    vi.stubEnv('HARNESS_GATE_STAGNATION_WINDOW', '5');

    const runDir = makeTmpDir();
    const state = makeState({ autoMode: true, currentPhase: 2 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    vi.mocked(promptChoice).mockResolvedValueOnce('Q');

    try {
      await handleGateReject(2, STAGNANT, undefined, 0, state, HDIR, runDir, CWD, createNoOpInputManager(), logger);
      await handleGateReject(2, STAGNANT, undefined, 1, state, HDIR, runDir, CWD, createNoOpInputManager(), logger);
      await handleGateReject(2, STAGNANT, undefined, 2, state, HDIR, runDir, CWD, createNoOpInputManager(), logger);

      const events = readEvents(eventsPath);
      const stagnation = events.find((e: any) => e.event === 'gate_stagnation');
      expect(stagnation).toBeDefined();

      const escalation = events.find((e: any) => e.event === 'escalation');
      expect(escalation?.reason).toBe('gate-stagnation');

      const windowWarns = warnSpy.mock.calls.filter(args => String(args[0]).includes('HARNESS_GATE_STAGNATION_WINDOW'));
      expect(windowWarns).toHaveLength(0);
    } finally {
      cleanup();
    }
  });
});
```

- [ ] **Step 4: Run the new tests**

```bash
pnpm vitest run tests/phases/runner.test.ts
```

Expected: all tests in the file pass, including the new 7 describe blocks above.

- [ ] **Step 5: Run full test suite**

```bash
pnpm vitest run
```

Expected: exits 0 with all tests passing.

- [ ] **Step 6: Typecheck**

```bash
pnpm tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add tests/phases/runner.test.ts
git commit -m "test(runner): add stagnation detection tests (Tests 5-9b)"
```

---

## Task 7: tests/integration/gate-stagnation.test.ts — event ordering integration test

**Files:**
- Create: `tests/integration/gate-stagnation.test.ts`

This test drives `handleGateReject` directly with a real `FileSessionLogger` to assert the exact event ordering in `events.jsonl`.

- [ ] **Step 1: Write the integration test**

```typescript
// tests/integration/gate-stagnation.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { HarnessState } from '../../src/types.js';
import { createInitialState } from '../../src/state.js';
import { getGateRetryLimit } from '../../src/config.js';
import { FileSessionLogger, computeRepoKey } from '../../src/logger.js';
import { __resetWarnCache } from '../../src/phases/stagnation.js';

vi.mock('../../src/phases/interactive.js', () => ({
  runInteractivePhase: vi.fn(),
  preparePhase: vi.fn(),
  checkSentinelFreshness: vi.fn(),
  validatePhaseArtifacts: vi.fn(),
}));

vi.mock('../../src/phases/gate.js', () => ({
  runGatePhase: vi.fn(),
  checkGateSidecars: vi.fn(),
  buildGateResult: vi.fn(),
  parseVerdict: vi.fn(),
}));

vi.mock('../../src/phases/verify.js', () => ({
  runVerifyPhase: vi.fn(),
  readVerifyResult: vi.fn(),
  isEvalReportValid: vi.fn(),
}));

vi.mock('../../src/ui.js', () => ({
  promptChoice: vi.fn(),
  printPhaseTransition: vi.fn(),
  renderControlPanel: vi.fn(),
  printWarning: vi.fn(),
  printError: vi.fn(),
  printSuccess: vi.fn(),
  printInfo: vi.fn(),
}));

vi.mock('../../src/artifact.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/artifact.js')>();
  return { ...actual, commitEvalReport: vi.fn().mockReturnValue('committed'), normalizeArtifactCommit: vi.fn().mockReturnValue(true), runPhase6Preconditions: vi.fn() };
});

vi.mock('../../src/git.js', () => ({
  getHead: vi.fn().mockReturnValue('mock-sha'),
  getGitRoot: vi.fn(),
  isAncestor: vi.fn(),
  isWorkingTreeClean: vi.fn(),
  hasStagedChanges: vi.fn(),
  getStagedFiles: vi.fn(),
  getFileStatus: vi.fn(),
  generateRunId: vi.fn(),
  detectExternalCommits: vi.fn(),
  isPathGitignored: vi.fn().mockReturnValue(false),
}));

vi.mock('../../src/state.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/state.js')>();
  return { ...actual, writeState: vi.fn() };
});

import { handleGateReject, __resetDetectors } from '../../src/phases/runner.js';
import { promptChoice } from '../../src/ui.js';
import { InputManager } from '../../src/input.js';

const tmpDirs: string[] = [];

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  __resetDetectors();
  __resetWarnCache();
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs.length = 0;
});

function makeTmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stagnation-int-'));
  tmpDirs.push(d);
  return d;
}

function makeTestLogger(runId: string): { logger: FileSessionLogger; eventsPath: string; cleanup: () => void } {
  const harnessDir = makeTmpDir();
  const sessionsRoot = path.join(harnessDir, 'sessions');
  const logger = new FileSessionLogger(runId, harnessDir, { sessionsRoot });
  logger.writeMeta({ task: 't' });
  const eventsPath = path.join(sessionsRoot, computeRepoKey(harnessDir), runId, 'events.jsonl');
  return { logger, eventsPath, cleanup: () => {} };
}

function readEvents(eventsPath: string): any[] {
  if (!fs.existsSync(eventsPath)) return [];
  return fs.readFileSync(eventsPath, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function makeState(overrides: Partial<HarnessState> = {}): HarnessState {
  return { ...createInitialState('int-run', '/task.md', 'sha', false), ...overrides };
}

const HDIR = '/tmp/harness-dir';
const CWD = '/tmp/cwd';
const FULL_LIMIT = getGateRetryLimit('full');
const STAGNANT = 'plan does not cover spec requirements; tests are missing; edge cases unhandled';

// ─── Test 10: Integration — 3 stagnant rejects → event ordering ──────────────

describe('Integration Test 10: 3 stagnant auto-mode rejects → gate_retry×2, gate_stagnation, escalation(gate-stagnation), no force_pass', () => {
  it('events appear in correct order with no force_pass', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ autoMode: true, currentPhase: 2 });
    const { logger, eventsPath } = makeTestLogger(state.runId);

    vi.mocked(promptChoice).mockResolvedValueOnce('Q');

    // 3 rejects with identical feedback
    await handleGateReject(2, STAGNANT, undefined, 0, state, HDIR, runDir, CWD, new InputManager(), logger);
    await handleGateReject(2, STAGNANT, undefined, 1, state, HDIR, runDir, CWD, new InputManager(), logger);
    await handleGateReject(2, STAGNANT, undefined, 2, state, HDIR, runDir, CWD, new InputManager(), logger);

    const events = readEvents(eventsPath);

    // gate_retry × 2 (retryIndex 0 and 1 only; retryIndex 2 goes to stagnation)
    const gateRetries = events.filter((e: any) => e.event === 'gate_retry');
    expect(gateRetries).toHaveLength(2);
    expect(gateRetries[0].retryIndex).toBe(0);
    expect(gateRetries[1].retryIndex).toBe(1);

    // gate_stagnation × 1
    const stagnations = events.filter((e: any) => e.event === 'gate_stagnation');
    expect(stagnations).toHaveLength(1);
    expect(stagnations[0].phase).toBe(2);
    expect(stagnations[0].action).toBe('escalate');
    expect(stagnations[0].threshold).toBe(0.70);

    // escalation × 1 with reason gate-stagnation
    const escalations = events.filter((e: any) => e.event === 'escalation');
    expect(escalations).toHaveLength(1);
    expect(escalations[0].reason).toBe('gate-stagnation');
    expect(escalations[0].phase).toBe(2);

    // NO force_pass
    expect(events.filter((e: any) => e.event === 'force_pass')).toHaveLength(0);

    // Order: last gate_retry < gate_stagnation < escalation
    const lastRetryIdx  = events.map((e: any, i: number) => e.event === 'gate_retry'      ? i : -1).filter(i => i >= 0).pop()!;
    const stagnationIdx = events.findIndex((e: any) => e.event === 'gate_stagnation');
    const escalationIdx = events.findIndex((e: any) => e.event === 'escalation');
    expect(lastRetryIdx).toBeLessThan(stagnationIdx);
    expect(stagnationIdx).toBeLessThan(escalationIdx);
  });
});

// ─── Test 11: Regression — pre-existing event shapes are unchanged ─────────────

describe('Integration Test 11: regression — force_pass and escalation event shapes unchanged for non-stagnant runs', () => {
  it('non-stagnant auto-mode run produces force_pass with by=auto, no gate_stagnation', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ autoMode: true, currentPhase: 2 });
    const { logger, eventsPath } = makeTestLogger(state.runId);

    const feedback = ['the type signatures are wrong', 'missing null check in handler', 'lint errors in new file'];
    for (let i = 0; i < FULL_LIMIT; i++) {
      await handleGateReject(2, feedback[i] ?? `distinct feedback ${i}`, undefined, i, state, HDIR, runDir, CWD, new InputManager(), logger);
    }

    const events = readEvents(eventsPath);
    const forcePass = events.find((e: any) => e.event === 'force_pass');
    expect(forcePass).toBeDefined();
    expect(forcePass.by).toBe('auto');
    expect(forcePass.phase).toBe(2);
    expect(events.find((e: any) => e.event === 'gate_stagnation')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run integration test**

```bash
pnpm vitest run tests/integration/gate-stagnation.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Run full test suite**

```bash
pnpm vitest run
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/gate-stagnation.test.ts
git commit -m "test(integration): add gate-stagnation event-ordering integration test (Test 10 + regression Test 11)"
```

---

## Task 8: Documentation — README and HOW-IT-WORKS

**Files:**
- Modify: `README.md`
- Modify: `README.ko.md`
- Modify: `docs/HOW-IT-WORKS.md`
- Modify: `docs/HOW-IT-WORKS.ko.md`

- [ ] **Step 1: README.md — add stagnation env vars paragraph**

Find the `--auto` flag description under `### phase-harness start` (around line 218):

```markdown
- `--auto` — autonomous mode for escalation handling
```

Add the following paragraph after the flags list (or at the end of the "Important behavior" block):

```markdown
**Auto-mode gate stagnation detection:**
When running with `--auto`, harness detects *stagnant* gate retry cycles — where each retry's reviewer feedback is essentially the same as the previous one — and escalates to the user (C/S/Q prompt) instead of silently force-passing. Stagnation is measured by token-set Jaccard similarity between adjacent reviewer feedback texts. Four environment variables control this behaviour:

| Variable | Default | Description |
|---|---|---|
| `HARNESS_GATE_STAGNATION` | `on` (auto-mode) | Set to `off` to restore pre-detection force-pass behaviour |
| `HARNESS_GATE_STAGNATION_THRESHOLD` | `0.70` | Jaccard similarity threshold [0, 1]; higher = stricter |
| `HARNESS_GATE_STAGNATION_RUN` | `2` | Consecutive stagnant pairs required before escalation (min 2) |
| `HARNESS_GATE_STAGNATION_WINDOW` | `2` | Reserved for future use; currently fixed at 2 (pair comparison) |

Any invalid value for the first three variables disables the feature for that process and emits one warning to stderr. The feature is always off in manual mode.
```

- [ ] **Step 2: README.ko.md — add Korean equivalent**

Find the equivalent `--auto` flag description in `README.ko.md`. Add the same paragraph translated to Korean:

```markdown
**자율 모드 게이트 스태그네이션 감지:**
`--auto`로 실행할 때, harness는 *정체된* 게이트 재시도 사이클을 감지합니다 — 각 재시도의 리뷰어 피드백이 이전과 본질적으로 동일한 경우 — 조용히 강제 통과하는 대신 사용자에게 에스컬레이션합니다 (C/S/Q 프롬프트). 정체는 인접한 리뷰어 피드백 텍스트 사이의 토큰 집합 Jaccard 유사도로 측정합니다. 네 가지 환경 변수로 이 동작을 제어합니다:

| 변수 | 기본값 | 설명 |
|---|---|---|
| `HARNESS_GATE_STAGNATION` | `on` (자율 모드) | `off`로 설정하면 감지 전 강제 통과 동작으로 복원 |
| `HARNESS_GATE_STAGNATION_THRESHOLD` | `0.70` | Jaccard 유사도 임계값 [0, 1]; 높을수록 엄격 |
| `HARNESS_GATE_STAGNATION_RUN` | `2` | 에스컬레이션 전 연속 정체 쌍 수 (최소 2) |
| `HARNESS_GATE_STAGNATION_WINDOW` | `2` | 향후 사용 예약; 현재 2로 고정 (쌍 비교) |

처음 세 변수에 잘못된 값이 있으면 해당 프로세스에서 기능이 비활성화되고 stderr에 경고 하나가 출력됩니다. 수동 모드에서는 항상 비활성화됩니다.
```

- [ ] **Step 3: docs/HOW-IT-WORKS.md — add stagnation sub-section**

Find the gate retry limit reference (around line 81):

```markdown
- gate retry limit: light P2 = 3, light P7 = 5, full flow = 3
```

Add the following subsection immediately after:

```markdown
### Gate stagnation detection (auto-mode)

In auto-mode, when a gate phase is rejected `retryLimit` times in a row, harness checks whether the rejections are *stagnant* before force-passing. Stagnation is defined as: the last two adjacent reviewer feedback texts are ≥70% token-Jaccard similar (token union/intersection after NFKC normalisation). If both conditions hold (auto-mode + stagnation detected), harness escalates to the C/S/Q prompt instead of force-passing. This prevents silently inheriting an unaddressed root cause across phases.

**Configuration:** four env vars control detection; see README for the full table. Key defaults:
- `HARNESS_GATE_STAGNATION=on` (auto-mode default; `=off` to restore old force-pass behaviour)
- `HARNESS_GATE_STAGNATION_THRESHOLD=0.70`
- `HARNESS_GATE_STAGNATION_RUN=2` (two consecutive stagnant pairs required)
- `HARNESS_GATE_STAGNATION_WINDOW=2` (reserved; no-op in v1)

Invalid values for the first three vars disable the feature fail-open (one stderr warn per key per process). The detector buffer is in-memory only; resuming a paused run starts empty.

**New `events.jsonl` event:** `gate_stagnation` is emitted once per triggered detection, immediately before the `escalation` event, with fields `phase`, `retryIndex`, `similarities[]`, `threshold`, `run`, `action: 'escalate'`.

**Extended schema:** `escalation.reason` now includes `'gate-stagnation'` in addition to the four pre-existing values.
```

Also update the events.jsonl schema table in `docs/HOW-IT-WORKS.md`. Find the events table (search for `gate_retry` in the table). Add a `gate_stagnation` row:

```markdown
| `gate_stagnation` | `phase`, `retryIndex`, `similarities` (number[]), `threshold`, `run`, `action: 'escalate'` |
```

- [ ] **Step 4: docs/HOW-IT-WORKS.ko.md — add Korean equivalent**

Add the same stagnation sub-section translated to Korean in `docs/HOW-IT-WORKS.ko.md`, in the equivalent location.

- [ ] **Step 5: Verify grep rules from Success Criterion #7**

```bash
grep -l "HARNESS_GATE_STAGNATION" README.md README.ko.md docs/HOW-IT-WORKS.md docs/HOW-IT-WORKS.ko.md
```

Expected: lists all four files.

- [ ] **Step 6: Run typecheck and full test suite**

```bash
pnpm tsc --noEmit && pnpm vitest run
```

Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add README.md README.ko.md docs/HOW-IT-WORKS.md docs/HOW-IT-WORKS.ko.md
git commit -m "docs: add gate stagnation detection documentation and env var reference"
```

---

## Self-Review: Spec Coverage Audit

| Spec requirement | Covered by task |
|---|---|
| SC #1: `stagnation.ts` exports `tokenJaccard`, `StagnationDetector`, `loadStagnationConfig` | T1 |
| SC #2: `types.ts` has `gate_stagnation` event + `gate-stagnation` reason | T3 |
| SC #3: `runner.ts` calls `loadStagnationConfig` + dispatches to `handleGateEscalation` when triggered | T5 |
| SC #4: `pnpm tsc --noEmit` exits 0; `pnpm vitest run` exits 0 with ≥11 new tests | T2+T6+T7 |
| SC #5: existing `force_pass`/`gate_retry`/`escalation` event shapes unchanged (regression test 11) | T7 |
| SC #6: `package.json` unchanged | No deps added in any task |
| SC #7: 4 docs contain `HARNESS_GATE_STAGNATION` | T8 |
| SC #8: invalid validated env → forcePassGate; WINDOW not validated (tests 9a, 9b) | T6 |
| I-1 (no-regress when disabled) | T6 test 6, 7, 8 |
| I-2 (auto-mode-only default) | T2 + T6 test 7 |
| I-3 (fail-open on exception) | T6 test 9 |
| I-4 (event additivity) | T3 (enum extension only) + T7 regression test 11 |
| I-5 (in-memory only, no state.json change) | T5 (no state.ts edits) |
| I-6 (no new dep) | No package.json changes |
| I-7 (no CLI surface) | No command-file changes |
| I-8 (one warn per misconfig) | T2 + T6 test 9a |
| I-9 (idempotent on resume) | In-memory buffer reset on module load (no serialization) |
| D13: unified fail-open on any validated-env misconfig | T2 + T6 test 9a |
| D14: WINDOW reserved no-op | T2 + T6 test 9b |

**No gaps found.** All spec requirements and invariants are covered.
