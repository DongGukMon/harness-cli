# Gate Retry Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/specs/2026-05-15-gate-retry-convergence-design.md`

**Goal:** Add per-requirement-ID retry budget and trajectory-aware reopen so the planner stops "whack-a-mole" looping on the same spec area (e.g. R1.b broken 4 different ways across 12 cycles in run `2026-05-14-untitled-396c`). Stuck requirements get auto-deferred to a follow-up artifact instead of looping or blocking on C/S/Q.

**Architecture:** New parser extracts `R\d+(\.\w+)?` IDs from Codex reject feedback. History is persisted in `state.json`. A pure detector flags IDs at threshold ≥4. On fire, an orchestrator filters those items out of the next reopen feedback and writes a deferred-stub artifact; in `--auto` it never prompts, in manual mode it shows a new `D/R/Q` prompt. The assembler renders prior reject trajectory into the existing `{{feedback_paths}}` placeholder — no wrapper-skill or template changes.

**Tech Stack:** TypeScript, vitest, Node 22.x, existing harness state/event/Ink infrastructure.

**Sequential execution:** All tasks run serially (per repo convention — subagent implementers do not run in parallel even when file-independent).

---

## File map

**Create:**
- `src/phases/gate/parseRejectFeedback.ts` — pure parser
- `src/phases/gate/parseRejectFeedback.test.ts`
- `src/phases/stubbornIds.ts` — detector (pure) + env loader
- `src/phases/stubbornIds.test.ts`
- `src/phases/gate/deferredStub.ts` — markdown stub writer (filesystem)
- `src/phases/gate/deferredStub.test.ts`
- `src/phases/gate/stubbornEscalation.ts` — orchestrator (feedback filter, auto/manual branch, gh-issue option)
- `src/phases/gate/stubbornEscalation.test.ts`
- `src/context/assembler.trajectory.test.ts` — co-located unit tests for `renderRejectTrajectory`

**Modify:**
- `src/types.ts` — new state fields, new event variant, enum extensions
- `src/state.ts` — defaults for new state fields on read path
- `src/phases/runner.ts` — `handleGateReject` hook + `forcePassGate` signature
- `src/context/assembler.ts` — replace `feedbackPathsList` with `renderRejectTrajectory(...)`
- `src/commands/start.ts` — `--auto-defer-issues` flag wiring
- `src/commands/resume.ts` — guard (`--auto-defer-issues` is start-only, like `--no-drift`)
- `src/phases/retrospective.ts` — `Deferred Stubborn Requirements` section
- `src/ink/components/CurrentPhase.tsx` — one-line "Deferred: R1.b, R8" banner
- `README.md`, `README.ko.md`, `docs/HOW-IT-WORKS.md`, `docs/HOW-IT-WORKS.ko.md` — doc sync per CLAUDE.md
- `package.json` (only if a build script reference changes — likely none)

---

## Task 1: Extend types (schema, events, enums)

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Read current HarnessState + LogEvent shape**

Run: `grep -n "interface HarnessState\|event: 'force_pass'\|event: 'escalation'\|event: 'gate_retry'" src/types.ts`

- [ ] **Step 2: Add new HarnessState fields**

In `src/types.ts`, inside `interface HarnessState` (next to `gateEscalationCycles`):

```ts
  // Per-phase reject history with parsed requirement IDs (gate-retry-convergence spec).
  // Persisted so resume restores detector state. Empty/missing = feature inert.
  gateRejectHistory?: Partial<Record<'2' | '4' | '7', GateRejectEntry[]>>;
  // Requirements that crossed the stubborn-ID threshold and were deferred.
  deferredRequirements?: Partial<Record<'2' | '4' | '7', DeferredRequirement[]>>;
  // Opt-in: shell out to `gh issue create` when a requirement is deferred.
  // File stub is written regardless. Persisted at start; resume honors it.
  autoDeferIssues?: boolean;
```

And below `LockData` (or near `GateResult`), add the supporting types:

```ts
export interface GateRejectEntry {
  cycle: number;
  retry: number;
  feedbackPath: string;
  requirementIds: string[];
  ts: number;
}

export interface DeferredRequirement {
  requirementId: string;
  phase: 2 | 4 | 7;
  rejectCount: number;
  feedbackPaths: string[];
  stubPath: string;
  deferredAt: number;
  ghIssueUrl?: string;
}
```

- [ ] **Step 3: Extend force_pass and escalation event types**

Find the lines:

```ts
| (LogEventBase & { event: 'force_pass'; phase: number; by: 'auto' | 'user' })
```

Replace with:

```ts
| (LogEventBase & { event: 'force_pass'; phase: number; by: 'auto' | 'user' | 'auto-stubborn' })
```

Find:

```ts
| (LogEventBase & { event: 'escalation'; phase: number; reason: 'gate-retry-limit' | 'gate-error' | 'verify-limit' | 'verify-error' | 'gate-stagnation'; userChoice?: 'C' | 'S' | 'Q' | 'R' })
```

Replace with:

```ts
| (LogEventBase & {
    event: 'escalation';
    phase: number;
    reason: 'gate-retry-limit' | 'gate-error' | 'verify-limit' | 'verify-error' | 'gate-stagnation' | 'gate-stubborn-id';
    userChoice?: 'C' | 'S' | 'Q' | 'R' | 'D';
    requirementIds?: string[];
  })
```

- [ ] **Step 4: Add the new gate_stubborn_id event variant**

In the same `LogEvent` union, append a new variant after the `escalation` line:

```ts
| (LogEventBase & {
    event: 'gate_stubborn_id';
    phase: number;
    retryIndex: number;
    requirementIds: string[];
    threshold: number;
    action: 'defer-and-continue' | 'defer-and-force-pass' | 'already-deferred';
  })
```

- [ ] **Step 5: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: passes. Any error means an enum consumer needs updating — fix at the call site, do not narrow the enum.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add gateRejectHistory/deferredRequirements + stubborn-id event variants"
```

---

## Task 2: State defaults on read path

**Files:**
- Modify: `src/state.ts`

- [ ] **Step 1: Read current default-init logic**

Run: `grep -n "raw\.\|gateEscalationCycles\|noDrift" src/state.ts | head -30`

The pattern: `if (raw.X === undefined) raw.X = <default>;` for additive optional fields.

- [ ] **Step 2: Add the same pattern for new fields**

Find the line `if (raw.noDrift === undefined) raw.noDrift = false;` and add immediately after:

```ts
  if (raw.autoDeferIssues === undefined) raw.autoDeferIssues = false;
```

Locate the equivalent block for `gateEscalationCycles` (likely `if (raw.gateEscalationCycles === undefined) raw.gateEscalationCycles = {};` or similar). Add adjacent:

```ts
  if (raw.gateRejectHistory === undefined) raw.gateRejectHistory = {};
  if (raw.deferredRequirements === undefined) raw.deferredRequirements = {};
```

If `gateEscalationCycles` is left as `Partial<...>` without an initializer in this file, do the same for the two new fields (i.e., `?? {}` at every read site only) — but add the defensive `?? {}` here when the file's pattern is initializer-based.

- [ ] **Step 3: Update initializeState (run-creation) signature**

Find `export function initializeState(... noDrift: boolean = false, ...)` or similar. Add a sibling parameter `autoDeferIssues: boolean = false` at the *end* of the parameter list (preserves call-site ordering).

In the returned state object, add `autoDeferIssues,` next to `noDrift,`. Also add `gateRejectHistory: {},` and `deferredRequirements: {},`.

- [ ] **Step 4: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: passes. Any failure is a forgotten callsite — pass `false` explicitly to keep callers green.

- [ ] **Step 5: Commit**

```bash
git add src/state.ts
git commit -m "feat(state): initialize gateRejectHistory/deferredRequirements/autoDeferIssues"
```

---

## Task 3: Requirement-ID parser (TDD)

**Files:**
- Create: `src/phases/gate/parseRejectFeedback.ts`
- Create: `src/phases/gate/parseRejectFeedback.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/phases/gate/parseRejectFeedback.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractRequirementIds } from './parseRejectFeedback.js';

describe('extractRequirementIds', () => {
  it('returns empty array for empty input', () => {
    expect(extractRequirementIds('')).toEqual([]);
  });

  it('extracts requirement IDs from real Codex reject feedback', () => {
    const sample = `
- **[P1]** — Location: \`<spec>\` R1.b "Deprecated-key denylist"; \`<plan>\` Task 2 Step 3
  Issue: The plan does not preserve the specified validation error contract.
  Evidence: Spec R1.b states the error is \`invalidUserData(...)\`.
- **[P2]** — Location: \`<spec>\` R8 "Negative tests for the L3 deprecated denylist"
  Issue: Only id-nik-match coverage.
- **[P2]** — Location: \`<spec>\` R9; \`<plan>\` Task 9 Step 3
`;
    expect(extractRequirementIds(sample)).toEqual(['R1.b', 'R8', 'R9']);
  });

  it('dedupes repeated IDs preserving first-occurrence order', () => {
    const sample = 'R8 mentioned, then R1.b, then R8 again, then R1.b again, then R9';
    expect(extractRequirementIds(sample)).toEqual(['R8', 'R1.b', 'R9']);
  });

  it('returns empty for foreign convention REQ-1.2', () => {
    expect(extractRequirementIds('See REQ-1.2 and req-3')).toEqual([]);
  });

  it('caps scan at 64 KB without throwing', () => {
    const huge = 'x'.repeat(64 * 1024) + ' R99 should be ignored after cap';
    const t0 = Date.now();
    const result = extractRequirementIds(huge);
    const dt = Date.now() - t0;
    expect(result).toEqual([]);
    expect(dt).toBeLessThan(100); // perf guard
  });

  it('handles ID at very start of input', () => {
    expect(extractRequirementIds('R1 starts here')).toEqual(['R1']);
  });

  it('does not match Rxx in word-internal positions like FOOR1.b', () => {
    expect(extractRequirementIds('FOOR1.b and BAR8')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm vitest run src/phases/gate/parseRejectFeedback.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

Create `src/phases/gate/parseRejectFeedback.ts`:

```ts
const SCAN_CAP_BYTES = 64 * 1024;
const ID_RE = /\bR\d+(?:\.[A-Za-z0-9]+)?\b/g;

export function extractRequirementIds(feedback: string): string[] {
  if (!feedback) return [];
  const scanned = feedback.length > SCAN_CAP_BYTES ? feedback.slice(0, SCAN_CAP_BYTES) : feedback;
  try {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of scanned.matchAll(ID_RE)) {
      const id = m[0];
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    return out;
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm vitest run src/phases/gate/parseRejectFeedback.test.ts`
Expected: 7 pass.

- [ ] **Step 5: Commit**

```bash
git add src/phases/gate/parseRejectFeedback.ts src/phases/gate/parseRejectFeedback.test.ts
git commit -m "feat(gate): add extractRequirementIds parser for stubborn-ID detection"
```

---

## Task 4: Stubborn-ID detector + env loader (TDD)

**Files:**
- Create: `src/phases/stubbornIds.ts`
- Create: `src/phases/stubbornIds.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/phases/stubbornIds.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { findStubbornIds, loadStubbornIdThreshold, __resetThresholdWarn } from './stubbornIds.js';
import type { GateRejectEntry } from '../types.js';

const entry = (
  ids: string[],
  cycle = 0,
  retry = 0,
): GateRejectEntry => ({
  cycle, retry,
  feedbackPath: `gate-4-cycle-${cycle}-retry-${retry}-feedback.md`,
  requirementIds: ids,
  ts: 0,
});

describe('findStubbornIds', () => {
  it('empty history → []', () => {
    expect(findStubbornIds([])).toEqual([]);
  });

  it('3 entries of R1.b below threshold 4 → []', () => {
    const hist = [entry(['R1.b']), entry(['R1.b'], 0, 1), entry(['R1.b'], 0, 2)];
    expect(findStubbornIds(hist)).toEqual([]);
  });

  it('4 entries of R1.b → ["R1.b"]', () => {
    const hist = [
      entry(['R1.b']), entry(['R1.b'], 0, 1),
      entry(['R1.b'], 1, 0), entry(['R1.b'], 1, 1),
    ];
    expect(findStubbornIds(hist)).toEqual(['R1.b']);
  });

  it('R1.b and R8 both at 4 → ordered by first occurrence', () => {
    const hist = [
      entry(['R1.b', 'R8']),
      entry(['R1.b', 'R8'], 0, 1),
      entry(['R1.b', 'R8'], 1, 0),
      entry(['R1.b', 'R8'], 1, 1),
    ];
    expect(findStubbornIds(hist)).toEqual(['R1.b', 'R8']);
  });

  it('duplicate R1.b inside one entry counts as one strike', () => {
    const dup = entry(['R1.b', 'R1.b'], 0, 0);
    expect(findStubbornIds([dup, dup, dup, dup])).toEqual(['R1.b']);
    // exactly 4 entries — survives, dedup within entry is honored
  });

  it('respects custom threshold via 2nd arg', () => {
    const hist = [entry(['R1.b']), entry(['R1.b'], 0, 1)];
    expect(findStubbornIds(hist, 2)).toEqual(['R1.b']);
  });

  it('clamps threshold < 2 to 2 (no throw)', () => {
    const hist = [entry(['R1.b']), entry(['R1.b'], 0, 1)];
    expect(findStubbornIds(hist, 0)).toEqual(['R1.b']);
    expect(findStubbornIds(hist, -5)).toEqual(['R1.b']);
  });

  it('entries with no IDs do not contribute', () => {
    const hist = [entry([]), entry([]), entry([]), entry([])];
    expect(findStubbornIds(hist)).toEqual([]);
  });
});

describe('loadStubbornIdThreshold', () => {
  afterEach(() => {
    delete process.env['HARNESS_STUBBORN_ID_THRESHOLD'];
    __resetThresholdWarn();
  });

  it('returns 4 when env unset', () => {
    expect(loadStubbornIdThreshold()).toBe(4);
  });

  it('parses valid env integer', () => {
    process.env['HARNESS_STUBBORN_ID_THRESHOLD'] = '6';
    expect(loadStubbornIdThreshold()).toBe(6);
  });

  it('falls back to 4 on invalid (non-int)', () => {
    process.env['HARNESS_STUBBORN_ID_THRESHOLD'] = 'abc';
    expect(loadStubbornIdThreshold()).toBe(4);
  });

  it('falls back to 4 on too-small (< 2)', () => {
    process.env['HARNESS_STUBBORN_ID_THRESHOLD'] = '1';
    expect(loadStubbornIdThreshold()).toBe(4);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm vitest run src/phases/stubbornIds.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the detector + loader**

Create `src/phases/stubbornIds.ts`:

```ts
import type { GateRejectEntry } from '../types.js';

const DEFAULT_THRESHOLD = 4;
const MIN_THRESHOLD = 2;

let warnedOnce = false;

export function findStubbornIds(
  history: GateRejectEntry[],
  threshold: number = DEFAULT_THRESHOLD,
): string[] {
  const t = Math.max(MIN_THRESHOLD, Math.floor(threshold));
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  let order = 0;
  for (const entry of history) {
    const unique = new Set(entry.requirementIds);
    for (const id of unique) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
      if (!firstSeen.has(id)) firstSeen.set(id, order++);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= t)
    .sort(([a], [b]) => (firstSeen.get(a)! - firstSeen.get(b)!))
    .map(([id]) => id);
}

export function loadStubbornIdThreshold(): number {
  const raw = process.env['HARNESS_STUBBORN_ID_THRESHOLD'];
  if (raw === undefined) return DEFAULT_THRESHOLD;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < MIN_THRESHOLD) {
    if (!warnedOnce) {
      console.warn(
        `[stubborn-id] invalid HARNESS_STUBBORN_ID_THRESHOLD="${raw}" — using default ${DEFAULT_THRESHOLD}`,
      );
      warnedOnce = true;
    }
    return DEFAULT_THRESHOLD;
  }
  return n;
}

// Test hook
export function __resetThresholdWarn(): void {
  warnedOnce = false;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm vitest run src/phases/stubbornIds.test.ts`
Expected: 12 pass.

- [ ] **Step 5: Commit**

```bash
git add src/phases/stubbornIds.ts src/phases/stubbornIds.test.ts
git commit -m "feat(gate): add findStubbornIds detector + env-tunable threshold"
```

---

## Task 5: Deferred stub writer (TDD)

**Files:**
- Create: `src/phases/gate/deferredStub.ts`
- Create: `src/phases/gate/deferredStub.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/phases/gate/deferredStub.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { writeDeferredStub } from './deferredStub.js';
import type { GateRejectEntry } from '../../types.js';

const entry = (ids: string[], cycle: number, retry: number, feedbackPath: string): GateRejectEntry => ({
  cycle, retry, feedbackPath, requirementIds: ids, ts: 1700000000000,
});

describe('writeDeferredStub', () => {
  let runDir: string;
  beforeEach(() => {
    runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stub-'));
  });
  afterEach(() => {
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('writes stub at <runDir>/deferred/phase-{N}-{id}.md', () => {
    const history: GateRejectEntry[] = [
      entry(['R1.b', 'R8'], 0, 0, 'gate-4-cycle-0-retry-0-feedback.md'),
      entry(['R1.b'],       0, 1, 'gate-4-cycle-0-retry-1-feedback.md'),
    ];
    const stubPath = writeDeferredStub(runDir, 4, 'R1.b', history, 4);
    expect(stubPath).toBe(path.join(runDir, 'deferred', 'phase-4-R1.b.md'));
    expect(fs.existsSync(stubPath)).toBe(true);
    const body = fs.readFileSync(stubPath, 'utf-8');
    expect(body).toContain('R1.b');
    expect(body).toContain('Phase 4');
    expect(body).toContain('Auto-deferred after threshold 4');
    expect(body).toContain('gate-4-cycle-0-retry-0-feedback.md');
    expect(body).toContain('gate-4-cycle-0-retry-1-feedback.md');
  });

  it('is idempotent — re-writing overwrites with current snapshot', () => {
    const h1 = [entry(['R1.b'], 0, 0, 'a.md')];
    const h2 = [entry(['R1.b'], 0, 0, 'a.md'), entry(['R1.b'], 0, 1, 'b.md')];
    const p1 = writeDeferredStub(runDir, 4, 'R1.b', h1, 4);
    const body1 = fs.readFileSync(p1, 'utf-8');
    expect(body1).not.toContain('b.md');

    const p2 = writeDeferredStub(runDir, 4, 'R1.b', h2, 4);
    expect(p2).toBe(p1);
    const body2 = fs.readFileSync(p2, 'utf-8');
    expect(body2).toContain('a.md');
    expect(body2).toContain('b.md');
  });

  it('creates deferred/ directory if missing', () => {
    expect(fs.existsSync(path.join(runDir, 'deferred'))).toBe(false);
    writeDeferredStub(runDir, 7, 'R3', [entry(['R3'], 0, 0, 'x.md')], 4);
    expect(fs.statSync(path.join(runDir, 'deferred')).isDirectory()).toBe(true);
  });

  it('only lists feedbackPaths whose entry actually mentioned the ID', () => {
    const mixed: GateRejectEntry[] = [
      entry(['R1.b', 'R8'], 0, 0, 'both.md'),
      entry(['R8'],         0, 1, 'r8-only.md'),
      entry(['R1.b'],       0, 2, 'r1b-only.md'),
    ];
    const stub = writeDeferredStub(runDir, 4, 'R1.b', mixed, 4);
    const body = fs.readFileSync(stub, 'utf-8');
    expect(body).toContain('both.md');
    expect(body).toContain('r1b-only.md');
    expect(body).not.toContain('r8-only.md');
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm vitest run src/phases/gate/deferredStub.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the writer**

Create `src/phases/gate/deferredStub.ts`:

```ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GateRejectEntry } from '../../types.js';

export function writeDeferredStub(
  runDir: string,
  phase: 2 | 4 | 7,
  requirementId: string,
  history: GateRejectEntry[],
  threshold: number,
): string {
  const dir = path.join(runDir, 'deferred');
  fs.mkdirSync(dir, { recursive: true });
  const stubPath = path.join(dir, `phase-${phase}-${requirementId}.md`);

  const matching = history.filter(e => e.requirementIds.includes(requirementId));
  const rejectCount = matching.length;

  const lines: string[] = [];
  lines.push(`# Deferred stubborn requirement: ${requirementId}`);
  lines.push('');
  lines.push(`- Phase: ${phase}`);
  lines.push(`- Requirement ID: ${requirementId}`);
  lines.push(`- Reject count: ${rejectCount}`);
  lines.push(`- Auto-deferred after threshold ${threshold}`);
  lines.push('');
  lines.push('## Reject feedback files');
  lines.push('');
  for (const e of matching) {
    lines.push(`- cycle ${e.cycle} retry ${e.retry} — ${e.feedbackPath}`);
  }
  lines.push('');
  lines.push('## Action required');
  lines.push('');
  lines.push('Manual review needed before merge. This requirement could not be satisfied automatically; address in a follow-up commit/PR.');

  fs.writeFileSync(stubPath, lines.join('\n') + '\n', 'utf-8');
  return stubPath;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm vitest run src/phases/gate/deferredStub.test.ts`
Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add src/phases/gate/deferredStub.ts src/phases/gate/deferredStub.test.ts
git commit -m "feat(gate): add deferred-stubborn-requirement markdown stub writer"
```

---

## Task 6: Feedback transform (split + filter)

**Files:**
- Modify: `src/phases/gate/parseRejectFeedback.ts` — add `filterFeedbackByIds`
- Modify: `src/phases/gate/parseRejectFeedback.test.ts` — add filter tests

- [ ] **Step 1: Add failing tests for the filter**

Append to `src/phases/gate/parseRejectFeedback.test.ts`:

```ts
import { filterFeedbackByIds } from './parseRejectFeedback.js';

describe('filterFeedbackByIds', () => {
  const sample = `
- **[P1]** — Location: \`<spec>\` R1.b
  Issue: stuck-only item.
  Evidence: R1.b stuff.
- **[P1]** — Location: \`<spec>\` R8
  Issue: fresh item.
- **[P2]** — Location: \`<spec>\` R9
  Issue: another fresh item.
`;

  it('drops items whose IDs are all in the stuck set', () => {
    const { filtered, dropped } = filterFeedbackByIds(sample, ['R1.b']);
    expect(filtered).not.toContain('R1.b');
    expect(filtered).toContain('R8');
    expect(filtered).toContain('R9');
    expect(dropped).toBe(1);
  });

  it('keeps items mentioning a stuck ID alongside a fresh ID', () => {
    const mixed = `
- **[P1]** — Location: R1.b and also R8 are both mentioned.
  Issue: mixed.
- **[P1]** — Location: R1.b only.
  Issue: stuck-only.
`;
    const { filtered, dropped } = filterFeedbackByIds(mixed, ['R1.b']);
    expect(filtered).toContain('mixed');
    expect(filtered).not.toContain('stuck-only');
    expect(dropped).toBe(1);
  });

  it('returns empty filtered when every item is stuck-only', () => {
    const allStuck = `
- **[P1]** — Location: R1.b
  Issue: a.
- **[P1]** — Location: R1.b
  Issue: b.
`;
    const { filtered, dropped } = filterFeedbackByIds(allStuck, ['R1.b']);
    expect(filtered.trim()).toBe('');
    expect(dropped).toBe(2);
  });

  it('returns input unchanged when stuck set is empty', () => {
    const { filtered, dropped } = filterFeedbackByIds(sample, []);
    expect(filtered).toBe(sample);
    expect(dropped).toBe(0);
  });

  it('marks parse failure when input has no item markers', () => {
    const garbled = 'just some text with R1.b in it but no list items';
    const { filtered, dropped, parsedOk } = filterFeedbackByIds(garbled, ['R1.b']);
    expect(parsedOk).toBe(false);
    expect(filtered).toBe(garbled);
    expect(dropped).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm vitest run src/phases/gate/parseRejectFeedback.test.ts`
Expected: previous 7 still pass; new 5 fail with "filterFeedbackByIds is not a function".

- [ ] **Step 3: Implement filterFeedbackByIds**

Append to `src/phases/gate/parseRejectFeedback.ts`:

```ts
const ITEM_HEADER_RE = /^- \*\*\[P[0-2]\]\*\* /m;

export interface FilterResult {
  filtered: string;
  dropped: number;
  parsedOk: boolean;
}

export function filterFeedbackByIds(feedback: string, stuckIds: string[]): FilterResult {
  if (stuckIds.length === 0) {
    return { filtered: feedback, dropped: 0, parsedOk: true };
  }
  if (!ITEM_HEADER_RE.test(feedback)) {
    return { filtered: feedback, dropped: 0, parsedOk: false };
  }

  // Split on item-header lines. Keep the preamble (text before first item) intact.
  const splitRe = /(^- \*\*\[P[0-2]\]\*\* )/m;
  const parts: string[] = [];
  let remaining = feedback;
  let firstHeaderIdx = remaining.search(splitRe);
  const preamble = firstHeaderIdx > 0 ? remaining.slice(0, firstHeaderIdx) : '';
  remaining = remaining.slice(firstHeaderIdx);

  // Walk header positions and slice items.
  const headerPositions: number[] = [];
  const globalSplit = /^- \*\*\[P[0-2]\]\*\* /gm;
  let m: RegExpExecArray | null;
  while ((m = globalSplit.exec(remaining)) !== null) {
    headerPositions.push(m.index);
  }
  for (let i = 0; i < headerPositions.length; i++) {
    const start = headerPositions[i];
    const end = i + 1 < headerPositions.length ? headerPositions[i + 1] : remaining.length;
    parts.push(remaining.slice(start, end));
  }

  const stuckSet = new Set(stuckIds);
  let dropped = 0;
  const kept: string[] = [];
  for (const item of parts) {
    const ids = extractRequirementIds(item);
    if (ids.length === 0) {
      kept.push(item);
      continue;
    }
    const allStuck = ids.every(id => stuckSet.has(id));
    if (allStuck) {
      dropped++;
    } else {
      kept.push(item);
    }
  }

  return { filtered: preamble + kept.join(''), dropped, parsedOk: true };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm vitest run src/phases/gate/parseRejectFeedback.test.ts`
Expected: 12 pass total (7 prior + 5 new).

- [ ] **Step 5: Commit**

```bash
git add src/phases/gate/parseRejectFeedback.ts src/phases/gate/parseRejectFeedback.test.ts
git commit -m "feat(gate): add filterFeedbackByIds to drop stuck-only reviewer items"
```

---

## Task 7: Stubborn-escalation orchestrator (TDD)

**Files:**
- Create: `src/phases/gate/stubbornEscalation.ts`
- Create: `src/phases/gate/stubbornEscalation.test.ts`

This is the main behavior unit. It runs after `findStubbornIds` returns non-empty.

- [ ] **Step 1: Read forcePassGate + handleGateReject for required side-effects**

Run: `sed -n '750,830p' src/phases/runner.ts` and `sed -n '1041,1075p' src/phases/runner.ts`.

Note what `forcePassGate` writes: `pendingAction → skip_phase`, emits `force_pass`, drops detector, deletes sidecars, sets `phases[N]=completed`, advances `currentPhase`, writes state.

- [ ] **Step 2: Write failing tests**

Create `src/phases/gate/stubbornEscalation.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { handleStubbornEscalationAuto } from './stubbornEscalation.js';
import type { HarnessState, GateRejectEntry } from '../../types.js';

const e = (ids: string[], c: number, r: number, fp: string): GateRejectEntry => ({
  cycle: c, retry: r, feedbackPath: fp, requirementIds: ids, ts: 1,
});

function mkState(): HarnessState {
  return {
    runId: 'test-run',
    autoMode: true,
    autoDeferIssues: false,
    phases: { '1':'completed','2':'completed','3':'completed','4':'pending','5':'pending','6':'pending','7':'pending' },
    gateRetries: { '2':0, '4':3, '7':0 },
    gateEscalationCycles: { '4': 0 },
    gateRejectHistory: { '4': [] },
    deferredRequirements: {},
    pendingAction: null,
    pauseReason: null,
    currentPhase: 4,
    // ... rest filled with safe defaults
  } as unknown as HarnessState;
}

describe('handleStubbornEscalationAuto', () => {
  let runDir: string;
  const logger = { logEvent: vi.fn() };

  beforeEach(() => {
    runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esc-'));
    logger.logEvent.mockReset();
  });
  afterEach(() => {
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('writes deferred stub for every stuck ID', () => {
    const state = mkState();
    state.gateRejectHistory!['4'] = [
      e(['R1.b'], 0, 0, 'a.md'), e(['R1.b'], 0, 1, 'b.md'),
      e(['R1.b'], 1, 0, 'c.md'), e(['R1.b'], 1, 1, 'd.md'),
    ];
    const comments = `- **[P1]** — Location: R1.b\n  Issue: stuck-only.`;
    const result = handleStubbornEscalationAuto({
      phase: 4, retryIndex: 1, stubbornIds: ['R1.b'], comments,
      state, runDir, threshold: 4, logger: logger as any,
    });
    expect(result.action).toBe('defer-and-force-pass');
    const stubPath = path.join(runDir, 'deferred', 'phase-4-R1.b.md');
    expect(fs.existsSync(stubPath)).toBe(true);
    expect(state.deferredRequirements!['4']?.[0].requirementId).toBe('R1.b');
    expect(state.deferredRequirements!['4']?.[0].rejectCount).toBe(4);
  });

  it('emits gate_stubborn_id event with action=defer-and-force-pass when filter empties feedback', () => {
    const state = mkState();
    state.gateRejectHistory!['4'] = [
      e(['R1.b'], 0, 0, 'a.md'), e(['R1.b'], 0, 1, 'b.md'),
      e(['R1.b'], 1, 0, 'c.md'), e(['R1.b'], 1, 1, 'd.md'),
    ];
    const comments = `- **[P1]** — Location: R1.b\n  Issue: stuck-only.`;
    handleStubbornEscalationAuto({
      phase: 4, retryIndex: 1, stubbornIds: ['R1.b'], comments,
      state, runDir, threshold: 4, logger: logger as any,
    });
    expect(logger.logEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'gate_stubborn_id',
      phase: 4,
      requirementIds: ['R1.b'],
      threshold: 4,
      action: 'defer-and-force-pass',
    }));
  });

  it('returns defer-and-continue + filtered feedback path when some items survive', () => {
    const state = mkState();
    state.gateRejectHistory!['4'] = [
      e(['R1.b'], 0, 0, 'a.md'), e(['R1.b'], 0, 1, 'b.md'),
      e(['R1.b'], 1, 0, 'c.md'), e(['R1.b'], 1, 1, 'd.md'),
    ];
    const comments = `- **[P1]** — Location: R1.b\n  Issue: stuck.\n- **[P1]** — Location: R8\n  Issue: fresh.`;
    const result = handleStubbornEscalationAuto({
      phase: 4, retryIndex: 1, stubbornIds: ['R1.b'], comments,
      state, runDir, threshold: 4, logger: logger as any,
    });
    expect(result.action).toBe('defer-and-continue');
    expect(result.filteredFeedbackPath).toBeDefined();
    const body = fs.readFileSync(result.filteredFeedbackPath!, 'utf-8');
    expect(body).not.toContain('R1.b');
    expect(body).toContain('R8');
  });

  it('emits action=already-deferred when ID is in state.deferredRequirements', () => {
    const state = mkState();
    state.deferredRequirements!['4'] = [{
      requirementId: 'R1.b', phase: 4, rejectCount: 4,
      feedbackPaths: [], stubPath: '/tmp/x', deferredAt: 0,
    }];
    state.gateRejectHistory!['4'] = [
      e(['R1.b'], 0, 0, 'a.md'), e(['R1.b'], 0, 1, 'b.md'),
      e(['R1.b'], 1, 0, 'c.md'), e(['R1.b'], 1, 1, 'd.md'),
      e(['R1.b'], 2, 0, 'e.md'),
    ];
    const comments = `- **[P1]** — R1.b\n  again.`;
    const result = handleStubbornEscalationAuto({
      phase: 4, retryIndex: 0, stubbornIds: ['R1.b'], comments,
      state, runDir, threshold: 4, logger: logger as any,
    });
    expect(result.action).toBe('already-deferred');
    expect(logger.logEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'gate_stubborn_id', action: 'already-deferred',
    }));
  });

  it('falls back to full feedback when filter parse fails', () => {
    const state = mkState();
    state.gateRejectHistory!['4'] = [
      e(['R1.b'], 0, 0, 'a.md'), e(['R1.b'], 0, 1, 'b.md'),
      e(['R1.b'], 1, 0, 'c.md'), e(['R1.b'], 1, 1, 'd.md'),
    ];
    const comments = 'garbled with R1.b but no item markers';
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = handleStubbornEscalationAuto({
      phase: 4, retryIndex: 1, stubbornIds: ['R1.b'], comments,
      state, runDir, threshold: 4, logger: logger as any,
    });
    expect(result.action).toBe('defer-and-continue');
    expect(result.filteredFeedbackPath).toBeUndefined(); // fell back, use original
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('feedback transform failed'));
    warnSpy.mockRestore();
  });
});
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `pnpm vitest run src/phases/gate/stubbornEscalation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the orchestrator**

Create `src/phases/gate/stubbornEscalation.ts`:

```ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { HarnessState, DeferredRequirement } from '../../types.js';
import { writeDeferredStub } from './deferredStub.js';
import { filterFeedbackByIds } from './parseRejectFeedback.js';

export interface StubbornEscalationInput {
  phase: 2 | 4 | 7;
  retryIndex: number;
  stubbornIds: string[];
  comments: string;
  state: HarnessState;
  runDir: string;
  threshold: number;
  logger: { logEvent: (e: any) => void };
}

export interface StubbornEscalationResult {
  action: 'defer-and-continue' | 'defer-and-force-pass' | 'already-deferred';
  filteredFeedbackPath?: string; // present when action='defer-and-continue' AND filter parsed
  stubPaths: string[];
}

export function handleStubbornEscalationAuto(
  input: StubbornEscalationInput,
): StubbornEscalationResult {
  const { phase, retryIndex, stubbornIds, comments, state, runDir, threshold, logger } = input;
  const histKey = String(phase) as '2' | '4' | '7';

  state.deferredRequirements = state.deferredRequirements ?? {};
  state.deferredRequirements[histKey] = state.deferredRequirements[histKey] ?? [];
  const alreadyDeferred = new Set(state.deferredRequirements[histKey]!.map(d => d.requirementId));

  // Detect "already deferred" — every stuck ID is already in state.
  const newStuck = stubbornIds.filter(id => !alreadyDeferred.has(id));
  const allAlreadyDeferred = newStuck.length === 0;

  const history = state.gateRejectHistory?.[histKey] ?? [];

  // Write stubs for the NEW stuck IDs only.
  const stubPaths: string[] = [];
  for (const id of newStuck) {
    const stubPath = writeDeferredStub(runDir, phase, id, history, threshold);
    stubPaths.push(stubPath);
    const feedbackPaths = history
      .filter(e => e.requirementIds.includes(id))
      .map(e => e.feedbackPath);
    const entry: DeferredRequirement = {
      requirementId: id, phase, rejectCount: feedbackPaths.length,
      feedbackPaths, stubPath, deferredAt: Date.now(),
    };
    state.deferredRequirements[histKey]!.push(entry);

    if (state.autoDeferIssues) {
      tryCreateGhIssue(entry, state.runId, runDir);
    }
  }

  // Filter the current reject feedback by ALL stuck IDs (deferred + new).
  const filterResult = filterFeedbackByIds(comments, stubbornIds);
  let action: StubbornEscalationResult['action'];
  let filteredFeedbackPath: string | undefined;

  if (allAlreadyDeferred) {
    action = 'already-deferred';
  } else if (filterResult.parsedOk && filterResult.filtered.trim() === '') {
    action = 'defer-and-force-pass';
  } else {
    action = 'defer-and-continue';
    if (filterResult.parsedOk) {
      const cycle = state.gateEscalationCycles?.[histKey] ?? 0;
      const fpath = path.join(runDir, `gate-${phase}-cycle-${cycle}-retry-${retryIndex}-filtered.md`);
      fs.writeFileSync(fpath, filterResult.filtered, 'utf-8');
      filteredFeedbackPath = fpath;
    } else {
      process.stderr.write(
        `[stubborn-id] feedback transform failed (no item markers); reopened with full feedback\n`,
      );
    }
  }

  logger.logEvent({
    event: 'gate_stubborn_id',
    phase, retryIndex,
    requirementIds: stubbornIds,
    threshold,
    action,
  });

  return { action, filteredFeedbackPath, stubPaths };
}

function tryCreateGhIssue(entry: DeferredRequirement, runId: string, runDir: string): void {
  try {
    const title = `[stubborn-requirement] Phase ${entry.phase} ${entry.requirementId} did not converge in run ${runId}`;
    const body = fs.readFileSync(entry.stubPath, 'utf-8');
    const out = spawnSync('gh', [
      'issue', 'create',
      '--title', title,
      '--body', body,
      '--label', 'harness/auto-deferred',
      '--label', `phase-${entry.phase}`,
    ], { cwd: runDir, encoding: 'utf-8' });
    if (out.status === 0 && out.stdout) {
      const url = out.stdout.trim().split('\n').pop();
      if (url && url.startsWith('http')) entry.ghIssueUrl = url;
    } else {
      process.stderr.write(
        `[stubborn-id] gh issue create failed (status=${out.status}); file stub retained at ${entry.stubPath}\n`,
      );
    }
  } catch (err) {
    process.stderr.write(
      `[stubborn-id] gh issue create threw (${(err as Error).message}); file stub retained at ${entry.stubPath}\n`,
    );
  }
}
```

- [ ] **Step 5: Run tests, verify pass**

Run: `pnpm vitest run src/phases/gate/stubbornEscalation.test.ts`
Expected: 5 pass.

- [ ] **Step 6: Commit**

```bash
git add src/phases/gate/stubbornEscalation.ts src/phases/gate/stubbornEscalation.test.ts
git commit -m "feat(gate): orchestrator for stubborn-id deferral (auto-mode path)"
```

---

## Task 8: Wire detector into handleGateReject

**Files:**
- Modify: `src/phases/runner.ts`

- [ ] **Step 1: Extend forcePassGate signature for 'auto-stubborn'**

Find:

```ts
export async function forcePassGate(
  phase: GatePhase,
  state: HarnessState,
  runDir: string,
  cwd: string,
  by: 'auto' | 'user',
  logger: SessionLogger,
): Promise<void> {
```

Replace `by: 'auto' | 'user'` with `by: 'auto' | 'user' | 'auto-stubborn'`.

Run: `pnpm tsc --noEmit` — verify no broken callsite.

- [ ] **Step 2: Add the hook in handleGateReject**

In `src/phases/runner.ts`, locate `handleGateReject`. Currently begins with stagnation setup, then `state.gateRetries[String(phase)] = retryIndex + 1;` near line 818.

Add imports at top of file:

```ts
import { extractRequirementIds } from './gate/parseRejectFeedback.js';
import { findStubbornIds, loadStubbornIdThreshold } from './stubbornIds.js';
import { handleStubbornEscalationAuto } from './gate/stubbornEscalation.js';
```

Insert this block **before** the line `state.gateRetries[String(phase)] = retryIndex + 1;` (i.e., between the stagnation setup and the retry-counter increment):

```ts
  // === Stubborn-ID detection (gate-retry-convergence spec) ===
  // Persist parsed IDs from this reject. Done BEFORE the retry counter so the
  // detector can fire without consuming a retry slot.
  {
    const histKey = String(phase) as '2' | '4' | '7';
    const cycleIdxNow = state.gateEscalationCycles?.[histKey] ?? 0;
    const feedbackPathNow = saveGateFeedback(runDir, phase, comments, retryIndex, cycleIdxNow);
    const ids = extractRequirementIds(comments);
    state.gateRejectHistory = state.gateRejectHistory ?? {};
    state.gateRejectHistory[histKey] = state.gateRejectHistory[histKey] ?? [];
    state.gateRejectHistory[histKey]!.push({
      cycle: cycleIdxNow, retry: retryIndex, feedbackPath: feedbackPathNow,
      requirementIds: ids, ts: Date.now(),
    });

    const threshold = loadStubbornIdThreshold();
    const stubborn = findStubbornIds(state.gateRejectHistory[histKey]!, threshold);
    if (stubborn.length > 0 && state.autoMode) {
      const result = handleStubbornEscalationAuto({
        phase, retryIndex, stubbornIds: stubborn, comments,
        state, runDir, threshold, logger,
      });
      if (result.action === 'defer-and-force-pass') {
        await forcePassGate(phase, state, runDir, cwd, 'auto-stubborn', logger);
        return;
      }
      if (result.action === 'defer-and-continue' || result.action === 'already-deferred') {
        // Reopen with filtered (or original) feedback; gateRetries NOT incremented.
        const targetInteractive = getGateRejectReopenTarget(state, phase, scope);
        const feedbackPaths = result.filteredFeedbackPath
          ? [result.filteredFeedbackPath]
          : [feedbackPathNow];
        state.pendingAction = {
          type: 'reopen_phase',
          targetPhase: targetInteractive,
          sourcePhase: phase as PhaseNumber,
          feedbackPaths,
        };
        state.phases[String(targetInteractive)] = 'pending';
        state.phaseReopenFlags[String(targetInteractive)] = true;
        state.phaseReopenSource[String(targetInteractive)] = phase;
        state.currentPhase = targetInteractive;
        writeState(runDir, state);
        return;
      }
    }
    // Non-auto or detector empty → fall through to existing retry path,
    // but DELETE the duplicate feedback we just wrote — the existing branch
    // calls saveGateFeedback again. Use the same path → idempotent overwrite
    // (saveGateFeedback already writes deterministic paths from retryIndex+cycle).
  }
  // === end stubborn-ID block ===
```

Note on the duplicate `saveGateFeedback`: the existing branch (`handleGateEscalation` and the reopen branch) also calls `saveGateFeedback` with the same arguments → idempotent path. No file-system race. The early `saveGateFeedback` call here exists so the detector has the path to record in history; the duplicate downstream call is a harmless re-write.

- [ ] **Step 3: Add a smoke unit test on the runner hook**

This test exercises only the path-construction + history accumulation, not the full handleGatePhase loop (which has tmux deps). Create or extend `src/phases/runner.stubborn-hook.test.ts` (new file):

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { handleGateReject } from './runner.js';
import type { HarnessState } from '../types.js';

vi.mock('../ui.js', () => ({
  renderControlPanel: vi.fn(),
  printInfo: vi.fn(), printWarning: vi.fn(), printError: vi.fn(), printSuccess: vi.fn(),
  separator: () => '----',
}));
vi.mock('./gate.js', () => ({ deleteGateSidecars: vi.fn() }));
vi.mock('../input.js', () => ({ promptChoice: vi.fn(() => Promise.resolve('C')) }));

const mkState = (autoMode: boolean): HarnessState => ({
  runId: 'test', autoMode, flow: 'full',
  phases: { '1':'completed','2':'completed','3':'completed','4':'pending','5':'pending','6':'pending','7':'pending' },
  gateRetries: { '2':0,'4':0,'7':0 }, gateEscalationCycles: { '4': 0 },
  gateRejectHistory: { '4': [] }, deferredRequirements: {},
  pendingAction: null, pauseReason: null, currentPhase: 4,
  phaseReopenFlags: {}, phaseReopenSource: {}, autoDeferIssues: false,
} as unknown as HarnessState);

describe('handleGateReject — stubborn-ID accumulator', () => {
  let runDir: string;
  beforeEach(() => { runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reject-')); });
  afterEach(() => { fs.rmSync(runDir, { recursive: true, force: true }); });

  it('persists requirementIds from feedback into gateRejectHistory', async () => {
    const state = mkState(true);
    const logger = { logEvent: vi.fn() } as any;
    const inputManager = {} as any;
    const comments = `- **[P1]** — R1.b\n  Issue: x.\n- **[P1]** — R8\n  Issue: y.`;
    // Stub writeState by setting runDir to a writeable temp; runner.writeState
    // is a free function that writes JSON to runDir.
    await handleGateReject(4 as any, comments, 'plan' as any, 0, state, runDir, runDir, process.cwd(), inputManager, logger);
    expect(state.gateRejectHistory!['4']).toBeDefined();
    expect(state.gateRejectHistory!['4']!.length).toBeGreaterThan(0);
    expect(state.gateRejectHistory!['4']![0].requirementIds).toEqual(['R1.b', 'R8']);
  });
});
```

- [ ] **Step 4: Run typecheck + tests**

Run: `pnpm tsc --noEmit && pnpm vitest run src/phases/runner.stubborn-hook.test.ts`
Expected: typecheck passes; test passes.

If mocking breaks (the runner imports more than mocked above), extend the `vi.mock(...)` calls — do not change the production code to ease testing.

- [ ] **Step 5: Full test suite**

Run: `pnpm vitest run`
Expected: all pre-existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/phases/runner.ts src/phases/runner.stubborn-hook.test.ts
git commit -m "feat(runner): hook stubborn-ID detector into handleGateReject (auto-mode)"
```

---

## Task 9: Manual-mode D/R/Q prompt

**Files:**
- Modify: `src/phases/runner.ts`
- Modify: `src/phases/gate/stubbornEscalation.ts` — add manual-mode helpers used by the runner
- Extend: `src/phases/gate/stubbornEscalation.test.ts`

- [ ] **Step 1: Add the manual helper to the orchestrator (tests first)**

Add tests to `src/phases/gate/stubbornEscalation.test.ts`:

```ts
import { resetOldestEntryFor } from './stubbornEscalation.js';

describe('resetOldestEntryFor (R key behaviour)', () => {
  const e = (ids: string[], c: number, r: number, fp: string) => ({
    cycle: c, retry: r, feedbackPath: fp, requirementIds: ids, ts: c * 10 + r,
  });

  it('drops the oldest entry containing the ID', () => {
    const hist = [
      e(['R1.b'], 0, 0, 'a.md'),
      e(['R1.b', 'R8'], 0, 1, 'b.md'),
      e(['R8'], 1, 0, 'c.md'),
      e(['R1.b'], 1, 1, 'd.md'),
    ];
    const out = resetOldestEntryFor(hist as any, ['R1.b']);
    // first entry (a.md) is the oldest containing R1.b → dropped
    expect(out.map(x => x.feedbackPath)).toEqual(['b.md', 'c.md', 'd.md']);
  });

  it('handles multiple stuck IDs by dropping oldest per ID', () => {
    const hist = [
      e(['R1.b'], 0, 0, 'a.md'),
      e(['R8'],   0, 1, 'b.md'),
      e(['R1.b'], 1, 0, 'c.md'),
      e(['R8'],   1, 1, 'd.md'),
    ];
    const out = resetOldestEntryFor(hist as any, ['R1.b', 'R8']);
    // a.md (oldest R1.b) and b.md (oldest R8) both dropped
    expect(out.map(x => x.feedbackPath)).toEqual(['c.md', 'd.md']);
  });
});
```

- [ ] **Step 2: Implement resetOldestEntryFor in stubbornEscalation.ts**

Append to `src/phases/gate/stubbornEscalation.ts`:

```ts
export function resetOldestEntryFor(
  history: import('../../types.js').GateRejectEntry[],
  stuckIds: string[],
): import('../../types.js').GateRejectEntry[] {
  const remaining = [...history];
  for (const id of stuckIds) {
    const idx = remaining.findIndex(e => e.requirementIds.includes(id));
    if (idx >= 0) remaining.splice(idx, 1);
  }
  return remaining;
}
```

Run: `pnpm vitest run src/phases/gate/stubbornEscalation.test.ts` → expect 7 pass.

- [ ] **Step 3: Wire manual-mode branch in handleGateReject**

In `src/phases/runner.ts`, inside the stubborn-id block added in Task 8, find the `if (stubborn.length > 0 && state.autoMode)` block. Add the manual-mode counterpart **after** it (so manual mode also gets handled):

```ts
    if (stubborn.length > 0 && !state.autoMode) {
      // Issue #98 pattern: render control panel before prompt
      renderControlPanel(state, logger, 'gate-stubborn-id-pending');
      const choice = await promptChoice(
        `Stubborn requirement(s) detected: ${stubborn.join(', ')} — rejected ≥${threshold} times each.`,
        [
          { key: 'D', label: 'Defer to follow-up and continue' },
          { key: 'R', label: 'Retry once more (drops oldest history entry)' },
          { key: 'Q', label: 'Quit (pause for manual fix)' },
        ],
        inputManager,
      );
      logger.logEvent({
        event: 'escalation',
        phase,
        reason: 'gate-stubborn-id',
        userChoice: choice as 'D' | 'R' | 'Q',
        requirementIds: stubborn,
      });

      if (choice === 'D') {
        const result = handleStubbornEscalationAuto({
          phase, retryIndex, stubbornIds: stubborn, comments,
          state, runDir, threshold, logger,
        });
        if (result.action === 'defer-and-force-pass') {
          await forcePassGate(phase, state, runDir, cwd, 'auto-stubborn', logger);
        } else {
          const targetInteractive = getGateRejectReopenTarget(state, phase, scope);
          const feedbackPaths = result.filteredFeedbackPath ? [result.filteredFeedbackPath] : [feedbackPathNow];
          state.pendingAction = {
            type: 'reopen_phase', targetPhase: targetInteractive,
            sourcePhase: phase as PhaseNumber, feedbackPaths,
          };
          state.phases[String(targetInteractive)] = 'pending';
          state.phaseReopenFlags[String(targetInteractive)] = true;
          state.phaseReopenSource[String(targetInteractive)] = phase;
          state.currentPhase = targetInteractive;
          writeState(runDir, state);
        }
        return;
      }
      if (choice === 'R') {
        state.gateRejectHistory[histKey] = resetOldestEntryFor(
          state.gateRejectHistory[histKey]!, stubborn,
        );
        writeState(runDir, state);
        // Fall through to existing retry path (do NOT return) so reopen happens.
      }
      if (choice === 'Q') {
        state.status = 'paused';
        state.pauseReason = 'gate-stubborn-id';
        writeState(runDir, state);
        return;
      }
    }
```

- [ ] **Step 4: Update PauseReason type (if it's an enum)**

Run: `grep -n "PauseReason" src/types.ts | head -5`. If `PauseReason` is a string-literal union, add `| 'gate-stubborn-id'`. Add `resetOldestEntryFor` to the runner's import list.

- [ ] **Step 5: Typecheck + suite**

Run: `pnpm tsc --noEmit && pnpm vitest run`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/phases/runner.ts src/phases/gate/stubbornEscalation.ts src/phases/gate/stubbornEscalation.test.ts src/types.ts
git commit -m "feat(gate): manual-mode D/R/Q prompt for stubborn-ID escalation"
```

---

## Task 10: Trajectory inject in assembler (TDD)

**Files:**
- Modify: `src/context/assembler.ts`
- Create: `src/context/assembler.trajectory.test.ts`

- [ ] **Step 1: Write failing tests for renderRejectTrajectory**

Create `src/context/assembler.trajectory.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderRejectTrajectory } from './assembler.js';
import type { GateRejectEntry } from '../types.js';

const e = (ids: string[], c: number, r: number, fp: string): GateRejectEntry => ({
  cycle: c, retry: r, feedbackPath: fp, requirementIds: ids, ts: 1,
});

describe('renderRejectTrajectory', () => {
  it('empty history → exact backward-compat one-liner per path', () => {
    const out = renderRejectTrajectory(['a.md', 'b.md'], []);
    expect(out).toBe('- 이전 피드백 (반드시 반영): a.md\n- 이전 피드백 (반드시 반영): b.md');
  });

  it('non-empty history → renders latest + accumulated list + counters', () => {
    const hist: GateRejectEntry[] = [
      e(['R1.b'], 0, 0, 'old1.md'),
      e(['R1.b', 'R8'], 0, 1, 'old2.md'),
      e(['R1.b'], 1, 0, 'latest.md'),
    ];
    const out = renderRejectTrajectory(['latest.md'], hist);
    expect(out).toContain('가장 최근');
    expect(out).toContain('latest.md');
    expect(out).toContain('누적 reject 이력');
    expect(out).toContain('cycle 0 retry 0');
    expect(out).toContain('R1.b: 3');
    expect(out).toContain('R8: 1');
  });

  it('emits ⚠ marker for IDs at or above threshold', () => {
    const hist: GateRejectEntry[] = Array.from({ length: 4 }, (_, i) =>
      e(['R1.b'], Math.floor(i / 2), i % 2, `f${i}.md`),
    );
    const out = renderRejectTrajectory(['f3.md'], hist, 4);
    expect(out).toContain('⚠');
    expect(out).toContain('R1.b');
  });

  it('truncates oldest entries when history is huge', () => {
    const hist = Array.from({ length: 200 }, (_, i) =>
      e(['R1.b'], 0, i, `f${i}.md`),
    );
    const out = renderRejectTrajectory(['f199.md'], hist, 4);
    expect(out.length).toBeLessThan(3500);
    expect(out).toContain('earlier rejects truncated');
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm vitest run src/context/assembler.trajectory.test.ts`
Expected: FAIL — `renderRejectTrajectory` not exported.

- [ ] **Step 3: Implement renderRejectTrajectory + replace existing list builder**

In `src/context/assembler.ts`, add the new export (near other helpers, top of file):

```ts
export function renderRejectTrajectory(
  latestPaths: string[],
  history: import('../types.js').GateRejectEntry[],
  threshold: number = 4,
): string {
  if (history.length === 0) {
    return latestPaths.map(p => `- 이전 피드백 (반드시 반영): ${p}`).join('\n');
  }

  const lines: string[] = ['이전 피드백 (반드시 반영):'];
  for (const p of latestPaths) {
    lines.push(`- 가장 최근 (this attempt's reject): ${p}`);
  }
  lines.push('');
  lines.push('이 phase 누적 reject 이력 (oldest → newest):');

  // Truncate from the front if history would push us over ~3KB.
  const SOFT_CAP_BYTES = 3000;
  const baseLen = lines.join('\n').length;
  let workingHistory = history;
  let truncated = 0;
  const estimate = (h: typeof history) =>
    h.reduce((s, e) => s + e.feedbackPath.length + e.requirementIds.join(', ').length + 40, baseLen);

  while (workingHistory.length > 1 && estimate(workingHistory) > SOFT_CAP_BYTES) {
    workingHistory = workingHistory.slice(1);
    truncated++;
  }
  if (truncated > 0) {
    lines.push(`(${truncated} earlier rejects truncated)`);
  }
  workingHistory.forEach((entry, i) => {
    const ids = entry.requirementIds.length > 0 ? entry.requirementIds.join(', ') : '(no IDs)';
    lines.push(`${i + 1}. cycle ${entry.cycle} retry ${entry.retry} — ${ids} — ${entry.feedbackPath}`);
  });
  lines.push('');

  // Per-ID counter
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const entry of history) {
    for (const id of new Set(entry.requirementIds)) {
      if (!counts.has(id)) order.push(id);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  if (order.length > 0) {
    lines.push('요건별 reject 횟수:');
    for (const id of order) {
      const n = counts.get(id)!;
      const marker = n >= threshold ? ` ← ${threshold}회 이상은 다음 cycle에서 자동 deferred 처리됨` : '';
      lines.push(`- ${id}: ${n}회${marker}`);
    }
    lines.push('');

    const overThresh = order.filter(id => (counts.get(id) ?? 0) >= threshold);
    if (overThresh.length > 0) {
      lines.push(`⚠ ${overThresh.join(', ')}는(은) 이미 ${threshold}회 이상 다른 형태로 깨졌다. spec의 literal shape를 그대로 보존하라.`);
    }
  }

  return lines.join('\n');
}
```

Then in `assembleInteractivePrompt`, find:

```ts
  const feedbackPathsList = feedbackPaths
    .map((p) => `- 이전 피드백 (반드시 반영): ${p}`)
    .join('\n');
```

Replace with:

```ts
  const sourcePhase =
    state.pendingAction?.sourcePhase ?? (state.phaseReopenSource[String(phase)] as number | null) ?? null;
  const histKey = sourcePhase != null && (sourcePhase === 2 || sourcePhase === 4 || sourcePhase === 7)
    ? (String(sourcePhase) as '2' | '4' | '7')
    : null;
  const trajectoryHistory = histKey ? (state.gateRejectHistory?.[histKey] ?? []) : [];
  const feedbackPathsList = renderRejectTrajectory(feedbackPaths, trajectoryHistory);
```

- [ ] **Step 4: Run trajectory tests, then full suite**

Run: `pnpm vitest run src/context/assembler.trajectory.test.ts`
Expected: 4 pass.

Run: `pnpm vitest run`
Expected: all green. If existing assembler tests assert the old simple list format byte-for-byte, those tests should pass when history is empty (`renderRejectTrajectory` returns the exact prior string in that case).

- [ ] **Step 5: Commit**

```bash
git add src/context/assembler.ts src/context/assembler.trajectory.test.ts
git commit -m "feat(assembler): trajectory-aware reopen feedback with per-ID counters"
```

---

## Task 11: --auto-defer-issues CLI flag

**Files:**
- Modify: `src/commands/start.ts`
- Modify: `src/commands/resume.ts`
- Modify: `src/state.ts` (already touched in Task 2; verify init wiring)

- [ ] **Step 1: Inspect existing --no-drift wiring as the pattern reference**

Run: `grep -n "noDrift\|no-drift" src/commands/start.ts src/commands/resume.ts`

- [ ] **Step 2: Add the flag to start.ts**

In `src/commands/start.ts`, find the `interface StartOptions` (or equivalent) — add:

```ts
  autoDeferIssues?: boolean;
```

Find the Commander/argv definition with `.option('--no-drift', ...)` and add a sibling:

```ts
  .option('--auto-defer-issues', 'Auto-create GitHub issue when a requirement is auto-deferred (file stub always written)')
```

Find the `initializeState(...)` call (passing `options.noDrift ?? false`) and add `options.autoDeferIssues ?? false` at the end (matches the new parameter from Task 2).

- [ ] **Step 3: Guard --auto-defer-issues against use on resume**

In `src/commands/resume.ts`, find the existing `if (options.noDrift)` guard. Add immediately after:

```ts
  if (options.autoDeferIssues) {
    process.stderr.write(
      "Error: --auto-defer-issues is only valid on 'phase-harness start' / 'phase-harness run'. " +
      "Setting is frozen at run creation; start a new run with --auto-defer-issues if you want it.\n",
    );
    process.exit(1);
  }
```

Also add `autoDeferIssues?: boolean;` to its options interface so Commander parses the flag (just to reject it).

- [ ] **Step 4: Typecheck + smoke test**

Run: `pnpm tsc --noEmit`
Expected: passes.

Run: `pnpm build && node ./dist/src/cli.js start --help | grep auto-defer-issues`
Expected: flag appears in help output.

- [ ] **Step 5: Commit**

```bash
git add src/commands/start.ts src/commands/resume.ts
git commit -m "feat(cli): add --auto-defer-issues flag (start-only, persisted)"
```

---

## Task 12: Retrospective Deferred Stubborn Requirements section

**Files:**
- Modify: `src/phases/retrospective.ts`

- [ ] **Step 1: Read the current section-builder area**

Run: `sed -n '276,310p' src/phases/retrospective.ts`. We add a new section after "Gate Activity" (which ends around line 295) and before "Escalations".

- [ ] **Step 2: Add aggregator + section render**

The retrospective.ts builds `stats` from events. We can sidestep the event aggregator and read directly from `state.deferredRequirements` because retrospective is rendered at session-end with the final state in scope.

Find the function that builds the markdown (the one with the `## Gate Activity` block). Locate its `state` parameter (likely `state: HarnessState`). Add this section between Gate Activity and Escalations:

```ts
  // === Deferred Stubborn Requirements (gate-retry-convergence spec) ===
  const allDeferred = Object.values(state.deferredRequirements ?? {}).flat().filter(Boolean) as DeferredRequirement[];
  if (allDeferred.length > 0) {
    lines.push('## Deferred Stubborn Requirements');
    lines.push('');
    for (const d of allDeferred) {
      lines.push(`- **${d.requirementId}** (Phase ${d.phase}) — rejected ${d.rejectCount} times`);
      lines.push(`  - Stub: ${d.stubPath}`);
      if (d.feedbackPaths.length > 0) {
        lines.push(`  - Reject feedback files: ${d.feedbackPaths.join(', ')}`);
      }
      if (d.ghIssueUrl) {
        lines.push(`  - GH issue: ${d.ghIssueUrl}`);
      }
    }
    lines.push('');
  }
```

Add `import type { DeferredRequirement } from '../types.js';` to the file's imports if missing.

- [ ] **Step 3: Extend Gate Activity counter line with Deferred IDs count**

In the loop that renders each gate phase (around `lines.push(\`Retries: ${g.retryCount}...\`)`), append `| Deferred IDs: ${deferredCount}` when `deferredCount > 0`:

```ts
    const deferredCount = state.deferredRequirements?.[String(gp) as '2'|'4'|'7']?.length ?? 0;
    const deferredSeg = deferredCount > 0 ? ` | Deferred IDs: ${deferredCount}` : '';
    lines.push(`Retries: ${g.retryCount} | REJECTs: ${g.rejectCount} | Codex tokens: ${g.codexTokens}${deferredSeg}`);
```

(replace the existing `lines.push(\`Retries: ...\`)` line at retrospective.ts:285).

- [ ] **Step 4: Test the new section render**

If `retrospective.ts` has unit tests, add a case there. Otherwise, write a minimal smoke test `src/phases/retrospective.deferred.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildRetrospective /* or whatever the export is */ } from './retrospective.js';
import type { HarnessState } from '../types.js';

describe('retrospective Deferred section', () => {
  it('omits section when no deferred requirements', () => {
    const out = buildRetrospective({ deferredRequirements: {} } as HarnessState, /* events */ [] as any);
    expect(out).not.toContain('## Deferred Stubborn Requirements');
  });

  it('lists deferred requirements when present', () => {
    const state: any = {
      deferredRequirements: {
        '4': [{
          requirementId: 'R1.b', phase: 4, rejectCount: 4,
          feedbackPaths: ['a.md','b.md'], stubPath: '/x.md', deferredAt: 0,
        }],
      },
    };
    const out = buildRetrospective(state as HarnessState, [] as any);
    expect(out).toContain('## Deferred Stubborn Requirements');
    expect(out).toContain('R1.b');
    expect(out).toContain('Phase 4');
    expect(out).toContain('/x.md');
  });
});
```

(Adapt the import name to the actual exported function in `retrospective.ts`.)

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run src/phases/retrospective.deferred.test.ts`
Expected: 2 pass.

- [ ] **Step 6: Commit**

```bash
git add src/phases/retrospective.ts src/phases/retrospective.deferred.test.ts
git commit -m "feat(retrospective): add Deferred Stubborn Requirements section"
```

---

## Task 13: Ink banner for deferred requirements

**Files:**
- Modify: `src/ink/components/CurrentPhase.tsx`

- [ ] **Step 1: Read current CurrentPhase rendering for gate phases**

Run: `grep -n "Phase\|gate\|deferredRequirements" src/ink/components/CurrentPhase.tsx | head`

- [ ] **Step 2: Add a one-line banner near gate-status display**

In `CurrentPhase.tsx`, where gate status is rendered (likely inside a `<Box>` for the current phase summary), add:

```tsx
{(() => {
  const deferred = Object.values(state.deferredRequirements ?? {})
    .flat()
    .filter(Boolean) as Array<{ requirementId: string }>;
  if (deferred.length === 0) return null;
  const ids = deferred.map(d => d.requirementId).join(', ');
  return (
    <Text color="yellow">
      ✦ Deferred: {ids}
    </Text>
  );
})()}
```

(Adapt JSX/imports to match the file's existing patterns. `state` should already be a prop of this component — confirm via the file.)

- [ ] **Step 3: Manual smoke test**

Run: `pnpm build`
Run a short manual harness (or rely on existing snapshot tests if any). For TDD coverage, if the component has snapshot tests, regenerate them.

If no test exists, skip the test step — this is purely visual and changing it cannot regress existing functionality (banner is null when `deferredRequirements` is empty).

- [ ] **Step 4: Commit**

```bash
git add src/ink/components/CurrentPhase.tsx
git commit -m "feat(ui): one-line deferred-requirements banner in CurrentPhase"
```

---

## Task 14: Docs sync (README + HOW-IT-WORKS, both languages)

**Files:**
- Modify: `README.md`
- Modify: `README.ko.md`
- Modify: `docs/HOW-IT-WORKS.md`
- Modify: `docs/HOW-IT-WORKS.ko.md`

Per CLAUDE.md: user-visible changes require updating both English and Korean copies in the same PR.

- [ ] **Step 1: Locate existing gate-retry / escalation sections**

Run: `grep -ln "retry-limit\|gate retry\|stagnation\|escalation" README.md README.ko.md docs/HOW-IT-WORKS*.md`

- [ ] **Step 2: README.md — add Stubborn-ID detector mention**

Near the gate-retry/escalation section, add:

```md
**Stubborn-requirement detection (new):** when the same spec requirement (e.g. `R1.b`) is rejected ≥4 times across distinct retries — even with different reviewer wording — the harness defers that requirement to a follow-up artifact at `.harness/<run>/deferred/phase-<N>-<id>.md` and continues with the remaining concerns. In `--auto`, this is automatic; in manual mode, a `[D/R/Q]` prompt asks whether to defer, retry once more, or pause.

Env: `HARNESS_STUBBORN_ID_THRESHOLD` (integer ≥2, default 4).
Flag: `--auto-defer-issues` (start-only) → also files a GitHub issue via `gh issue create` when deferring; file stub is always written.
```

- [ ] **Step 3: README.ko.md — same content, Korean**

Mirror Step 2 in Korean prose. Match the existing tone of `README.ko.md`.

- [ ] **Step 4: docs/HOW-IT-WORKS.md — full mechanism**

Near the gate-loop section, add:

```md
### Stubborn requirement detection (per-ID retry budget)

In addition to count-based `gateRetries[phase]` and the Jaccard adjacent-pair stagnation detector, every reject also has its **requirement IDs** (e.g. `R1.b`, `R8`) parsed from the reviewer's `Location: ... R<id>` evidence pointers and persisted to `state.gateRejectHistory[phase]`. The pure detector `findStubbornIds(history, threshold)` flags any ID that crosses the threshold across **distinct retries** (one strike per retry, dedup within retry).

When fired:
- **auto mode**: the reviewer feedback is split by `- **[P0|P1|P2]**` item headers; items whose IDs are all stuck are dropped from the next reopen. If nothing survives, the gate is force-passed (`force_pass.by = 'auto-stubborn'`). A markdown stub at `<runDir>/deferred/phase-<N>-<id>.md` records the deferral. Optional `--auto-defer-issues` also creates a GitHub issue.
- **manual mode**: a single-key `[D]efer / [R]etry-once / [Q]uit` prompt is rendered via Ink (distinct from the existing `[C]/[S]/[Q]` retry-limit prompt). `R` drops the oldest history entry for each stuck ID — one-shot reset, re-fires on next reject.

State persistence:
- `gateRejectHistory: Record<'2'|'4'|'7', GateRejectEntry[]>` — survives `phase-harness resume`.
- `deferredRequirements: Record<'2'|'4'|'7', DeferredRequirement[]>` — surfaced in the retrospective and as an Ink banner.

Events: `gate_stubborn_id` (auto branch) and extended `escalation { reason: 'gate-stubborn-id', userChoice: 'D'|'R'|'Q' }` (manual branch). Exactly one of the two per fire.

Trajectory in reopen prompts: every Phase 1/3/5 reopen now sees the *full* per-phase reject trajectory in the `{{feedback_paths}}` block — prior cycle reject paths, per-ID counters, and a `⚠` marker for IDs at or above threshold. This is independent of whether the detector fires.

Config:
- `HARNESS_STUBBORN_ID_THRESHOLD` (env, integer ≥2, default 4)
- `--auto-defer-issues` (CLI start flag, default off)
```

Also add to the events.jsonl schema reference: the new `gate_stubborn_id` variant and the `escalation` extensions.

- [ ] **Step 5: docs/HOW-IT-WORKS.ko.md — mirror in Korean**

Same content, Korean prose.

- [ ] **Step 6: Commit**

```bash
git add README.md README.ko.md docs/HOW-IT-WORKS.md docs/HOW-IT-WORKS.ko.md
git commit -m "docs: document stubborn-requirement detection (en+ko)"
```

---

## Task 15: Final verification

**Files:**
- (no edits; pure verification)

- [ ] **Step 1: Run full typecheck**

Run: `pnpm tsc --noEmit`
Expected: passes.

- [ ] **Step 2: Run full test suite**

Run: `pnpm vitest run`
Expected: every test green. Note added test counts:
- parseRejectFeedback: 12
- stubbornIds: 12
- deferredStub: 4
- stubbornEscalation: 7
- runner.stubborn-hook: 1
- assembler.trajectory: 4
- retrospective.deferred: 2

- [ ] **Step 3: Build artifact**

Run: `pnpm build`
Expected: `dist/` rebuilds without error. `copy-assets.mjs` does not need changes (no new `src/context/{prompts,skills,playbooks}` files).

- [ ] **Step 4: Smoke check the new CLI flag**

Run: `node ./dist/src/cli.js start --help | grep -E "auto-defer-issues|no-drift"`
Expected: both flags listed.

Run: `HARNESS_STUBBORN_ID_THRESHOLD=abc node -e "require('./dist/src/phases/stubbornIds.js').loadStubbornIdThreshold()" 2>&1 | grep stubborn`
Expected: warn message about invalid env, default returned.

- [ ] **Step 5: Confirm no scope creep in this branch**

Run: `git diff main --stat | head -30`
Expected: only the files listed in the "File map" section. If anything else shows up, revisit.

- [ ] **Step 6: Final commit (if any leftover) and ready for PR**

```bash
git status
# If clean: nothing to commit, plan is fully landed.
```

---

## Self-review checklist (after writing this plan)

Run mentally against the spec before handoff:

- [x] Spec §"Goals" 1–6 covered: 1 (Task 4 detector), 2 (Task 10 trajectory), 3 (Task 7 escalation), 4 (Task 1 state persistence), 5 (Tasks 7/9 auto vs manual), 6 (parser fail-open in Task 3 + filter parse-fail in Task 7)
- [x] Spec §"Data schema" — Task 1 + Task 2
- [x] Spec §"Parser contract" — Task 3 (includes 64KB cap)
- [x] Spec §"Detector" — Task 4 (clamps threshold, env loader)
- [x] Spec §"Hook position" — Task 8
- [x] Spec §"Escalation policy / auto" — Task 7
- [x] Spec §"Escalation policy / manual" — Task 9
- [x] Spec §"Edge cases" — already-deferred (Task 7), filter parse fail (Task 7), threshold mid-run (loader re-reads env)
- [x] Spec §"Trajectory inject (assembler)" — Task 10
- [x] Spec §"Error handling and fail-open" — Tasks 3/4/7 all return empty/null/warn rather than throw at the runner
- [x] Spec §"Observability — events" — Task 1 (types) + Tasks 7/9 (emitters)
- [x] Spec §"Observability — retrospective" — Task 12
- [x] Spec §"Observability — UI" — Task 13
- [x] Spec §"Configuration surface" — Task 4 (env) + Task 11 (flag)
- [x] Spec §"Testing strategy" — every listed case has a corresponding step
- [x] Spec §"Doc sync impact" — Task 14
- [x] No "TODO/TBD" placeholders in steps
- [x] Type/function names consistent: `extractRequirementIds`, `findStubbornIds`, `writeDeferredStub`, `handleStubbornEscalationAuto`, `resetOldestEntryFor`, `renderRejectTrajectory`, `filterFeedbackByIds`, `loadStubbornIdThreshold`
- [x] Out-of-scope items (#110 resume crash, gate-skip CLI, model swap, reviewer-prompt hardening, deferred-section budget, literal-shape directive) are NOT in any task
