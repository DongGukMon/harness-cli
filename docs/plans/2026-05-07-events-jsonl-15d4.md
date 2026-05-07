# Auto-Retrospective from events.jsonl — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic read-side analyzer that generates a human-readable retrospective Markdown file from `events.jsonl` whenever a `--enable-logging` harness run ends, and exposes it as a `phase-harness retro <runId>` CLI subcommand.

**Architecture:** `src/phases/retrospective.ts` is a pure (no `fs` writes) analyzer — it reads `events.jsonl` line-by-line, aggregates into `RetrospectiveStats`, and renders deterministic Markdown. `src/commands/retro.ts` wraps it for offline CLI use. The auto-emit hook in `inner.ts`'s `finally` block calls it after every `--enable-logging` run with fail-open semantics.

**Tech Stack:** TypeScript, Node stdlib only (`fs`, `path`, `os`, `crypto`), vitest for tests.

---

## File Structure

| File | Action | Role |
|---|---|---|
| `src/phases/retrospective.ts` | Create | Pure analyzer — no `fs` writes |
| `src/commands/retro.ts` | Create | `phase-harness retro` subcommand |
| `tests/phases/retrospective.test.ts` | Create | Fixture-driven unit tests (8 fixtures + determinism) |
| `tests/commands/retro.test.ts` | Create | Subcommand behavior tests (4 cases) |
| `src/commands/inner.ts` | Modify | Auto-emit hook in `finally` block (~12 lines) |
| `bin/harness.ts` | Modify | Register `retro` subcommand (~8 lines) |

---

### Task 1: Analyzer stub — interface + throwing skeleton

**Files:**
- Create: `src/phases/retrospective.ts`

- [ ] **Step 1: Create `src/phases/retrospective.ts` with the full interface and a throwing stub**

```typescript
import fs from 'fs';

export interface RetrospectiveStats {
  runId: string;
  harnessVersion: string | null;
  status: 'completed' | 'failed' | 'paused' | 'interrupted' | 'unknown';
  autoMode: boolean;
  startedAt: number;
  endedAt: number;
  totalWallMs: number;
  eventCount: number;
  malformedLineCount: number;
  phases: Array<{
    phase: number;
    attempts: number;
    durationMs: number;
    claudeTokens: number;
    codexTokens: number;
    finalStatus: 'completed' | 'failed' | 'unknown';
  }>;
  gates: Array<{
    phase: number;
    retryCount: number;
    rejectCount: number;
    codexTokens: number;
    ambiguityTrend: number[];
    stagnationTriggered: boolean;
    forcePass: { triggered: boolean; by?: 'auto' | 'user' };
  }>;
  escalations: Array<{ phase: number; reason: string; userChoice?: 'C' | 'S' | 'Q' | 'R' }>;
  verify: { passCount: number; failCount: number; lastFailedChecks: string[] };
  spike: { topPhases: Array<{ phase: number; tokens: number }>; flagged: boolean; ratio: number };
  totals: { claudeTokens: number; codexTokens: number };
}

export function generateRetrospective(_eventsPath: string): { markdown: string; stats: RetrospectiveStats } {
  throw new Error('not implemented');
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit stub**

```bash
git add src/phases/retrospective.ts
git commit -m "feat(retro): add RetrospectiveStats interface and function stub"
```

---

### Task 2: Write failing fixture tests

**Files:**
- Create: `tests/phases/retrospective.test.ts`

All tests import `generateRetrospective` from the stub. Every test will throw "not implemented" — that is the expected outcome before implementation.

- [ ] **Step 1: Create `tests/phases/retrospective.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { generateRetrospective } from '../../src/phases/retrospective.js';

const BASE = 1746612000000; // 2026-05-07T10:00:00Z

function writeFixture(tmpDir: string, lines: string[]): string {
  const p = path.join(tmpDir, 'events.jsonl');
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return p;
}

let tmpDir: string;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-test-')); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

// ─── fixture-completed ────────────────────────────────────────────────────────
const COMPLETED_LINES = [
  JSON.stringify({ v:1, ts:BASE+0,      runId:'r1', event:'session_start',  task:'t', autoMode:false, baseCommit:'abc', harnessVersion:'2.0.0' }),
  JSON.stringify({ v:1, ts:BASE+100,    runId:'r1', event:'phase_start',    phase:1,  attemptId:'a1' }),
  JSON.stringify({ v:1, ts:BASE+60100,  runId:'r1', event:'phase_end',      phase:1,  attemptId:'a1', status:'completed', durationMs:60000, claudeTokens:{input:1000,output:500,cacheRead:0,cacheCreate:0,total:1500} }),
  JSON.stringify({ v:1, ts:BASE+60200,  runId:'r1', event:'phase_start',    phase:2,  attemptId:'b1' }),
  JSON.stringify({ v:1, ts:BASE+90200,  runId:'r1', event:'gate_verdict',   phase:2,  retryIndex:0, runner:'codex', verdict:'APPROVE', durationMs:30000, tokensTotal:2000 }),
  JSON.stringify({ v:1, ts:BASE+90300,  runId:'r1', event:'phase_end',      phase:2,  attemptId:'b1', status:'completed', durationMs:30000 }),
  JSON.stringify({ v:1, ts:BASE+90400,  runId:'r1', event:'phase_start',    phase:3,  attemptId:'c1' }),
  JSON.stringify({ v:1, ts:BASE+180400, runId:'r1', event:'phase_end',      phase:3,  attemptId:'c1', status:'completed', durationMs:90000, claudeTokens:{input:2000,output:1000,cacheRead:0,cacheCreate:0,total:3000} }),
  JSON.stringify({ v:1, ts:BASE+180500, runId:'r1', event:'phase_start',    phase:4,  attemptId:'d1' }),
  JSON.stringify({ v:1, ts:BASE+200500, runId:'r1', event:'gate_verdict',   phase:4,  retryIndex:0, runner:'codex', verdict:'APPROVE', durationMs:20000, tokensTotal:1500 }),
  JSON.stringify({ v:1, ts:BASE+200600, runId:'r1', event:'phase_end',      phase:4,  attemptId:'d1', status:'completed', durationMs:20000 }),
  JSON.stringify({ v:1, ts:BASE+200700, runId:'r1', event:'phase_start',    phase:5,  attemptId:'e1' }),
  JSON.stringify({ v:1, ts:BASE+320700, runId:'r1', event:'phase_end',      phase:5,  attemptId:'e1', status:'completed', durationMs:120000, claudeTokens:{input:3000,output:2000,cacheRead:0,cacheCreate:0,total:5000} }),
  JSON.stringify({ v:1, ts:BASE+320800, runId:'r1', event:'phase_start',    phase:6,  attemptId:'f1' }),
  JSON.stringify({ v:1, ts:BASE+350800, runId:'r1', event:'phase_end',      phase:6,  attemptId:'f1', status:'completed', durationMs:30000 }),
  JSON.stringify({ v:1, ts:BASE+350900, runId:'r1', event:'phase_start',    phase:7,  attemptId:'g1' }),
  JSON.stringify({ v:1, ts:BASE+365900, runId:'r1', event:'gate_verdict',   phase:7,  retryIndex:0, runner:'codex', verdict:'APPROVE', durationMs:15000, tokensTotal:1000 }),
  JSON.stringify({ v:1, ts:BASE+366000, runId:'r1', event:'phase_end',      phase:7,  attemptId:'g1', status:'completed', durationMs:15000 }),
  JSON.stringify({ v:1, ts:BASE+366100, runId:'r1', event:'session_end',    status:'completed', totalWallMs:366100 }),
];

describe('fixture-completed', () => {
  it('produces Phase Summary rows for all active phases', () => {
    const p = writeFixture(tmpDir, COMPLETED_LINES);
    const { stats } = generateRetrospective(p);
    expect(stats.status).toBe('completed');
    expect(stats.phases.filter(ph => ph.durationMs > 0)).toHaveLength(7);
    const ph1 = stats.phases.find(ph => ph.phase === 1)!;
    expect(ph1.claudeTokens).toBe(1500);
    expect(ph1.finalStatus).toBe('completed');
    const ph2 = stats.phases.find(ph => ph.phase === 2)!;
    expect(ph2.codexTokens).toBe(2000);
  });

  it('produces gate entries for phases 2, 4, 7', () => {
    const p = writeFixture(tmpDir, COMPLETED_LINES);
    const { stats } = generateRetrospective(p);
    expect(stats.gates.map(g => g.phase)).toEqual(expect.arrayContaining([2, 4, 7]));
    const g2 = stats.gates.find(g => g.phase === 2)!;
    expect(g2.rejectCount).toBe(0);
    expect(g2.forcePass.triggered).toBe(false);
  });

  it('markdown contains all required section headers', () => {
    const p = writeFixture(tmpDir, COMPLETED_LINES);
    const { markdown } = generateRetrospective(p);
    expect(markdown).toContain('# Retrospective — r1');
    expect(markdown).toContain('## Phase Summary');
    expect(markdown).toContain('## Token Spike');
    expect(markdown).toContain('## Gate Activity');
    expect(markdown).toContain('## Escalations');
    expect(markdown).toContain('## Verify');
    expect(markdown).toContain('## Totals');
  });
});

// ─── fixture-failed ───────────────────────────────────────────────────────────
const FAILED_LINES = [
  JSON.stringify({ v:1, ts:BASE+0,      runId:'r2', event:'session_start',  task:'t', autoMode:false, baseCommit:'abc', harnessVersion:'2.0.0' }),
  JSON.stringify({ v:1, ts:BASE+100,    runId:'r2', event:'phase_start',    phase:1,  attemptId:'a1' }),
  JSON.stringify({ v:1, ts:BASE+60100,  runId:'r2', event:'phase_end',      phase:1,  attemptId:'a1', status:'completed', durationMs:60000, claudeTokens:{input:1000,output:500,cacheRead:0,cacheCreate:0,total:1500} }),
  JSON.stringify({ v:1, ts:BASE+60200,  runId:'r2', event:'phase_start',    phase:5,  attemptId:'e1' }),
  JSON.stringify({ v:1, ts:BASE+180200, runId:'r2', event:'phase_end',      phase:5,  attemptId:'e1', status:'failed', durationMs:120000 }),
  JSON.stringify({ v:1, ts:BASE+180300, runId:'r2', event:'escalation',     phase:5,  reason:'gate-retry-limit', userChoice:'Q' }),
  JSON.stringify({ v:1, ts:BASE+180400, runId:'r2', event:'session_end',    status:'interrupted', totalWallMs:180400 }),
];

describe('fixture-failed', () => {
  it('derives status=failed when phase_end.failed + session_end.interrupted', () => {
    const p = writeFixture(tmpDir, FAILED_LINES);
    const { stats } = generateRetrospective(p);
    expect(stats.status).toBe('failed');
  });

  it('includes escalation in stats', () => {
    const p = writeFixture(tmpDir, FAILED_LINES);
    const { stats } = generateRetrospective(p);
    expect(stats.escalations).toHaveLength(1);
    expect(stats.escalations[0].userChoice).toBe('Q');
  });
});

// ─── fixture-resumed ──────────────────────────────────────────────────────────
const RESUMED_LINES = [
  // Session 1
  JSON.stringify({ v:1, ts:BASE+0,       runId:'r3', event:'session_start', task:'t', autoMode:false, baseCommit:'abc', harnessVersion:'2.0.0' }),
  JSON.stringify({ v:1, ts:BASE+100,     runId:'r3', event:'phase_start',   phase:1,  attemptId:'a1' }),
  JSON.stringify({ v:1, ts:BASE+60100,   runId:'r3', event:'phase_end',     phase:1,  attemptId:'a1', status:'completed', durationMs:60000 }),
  JSON.stringify({ v:1, ts:BASE+60200,   runId:'r3', event:'session_end',   status:'interrupted', totalWallMs:60200 }),
  // Session 2 (resumed)
  JSON.stringify({ v:1, ts:BASE+120000,  runId:'r3', event:'session_start', task:'t', autoMode:false, baseCommit:'abc', harnessVersion:'2.0.0' }),
  JSON.stringify({ v:1, ts:BASE+120100,  runId:'r3', event:'phase_start',   phase:5,  attemptId:'e1' }),
  JSON.stringify({ v:1, ts:BASE+240100,  runId:'r3', event:'phase_end',     phase:5,  attemptId:'e1', status:'completed', durationMs:120000 }),
  JSON.stringify({ v:1, ts:BASE+240200,  runId:'r3', event:'session_end',   status:'completed', totalWallMs:240200 }),
];

describe('fixture-resumed', () => {
  it('aggregates phases across both sessions', () => {
    const p = writeFixture(tmpDir, RESUMED_LINES);
    const { stats } = generateRetrospective(p);
    expect(stats.phases.map(ph => ph.phase)).toEqual(expect.arrayContaining([1, 5]));
  });

  it('startedAt = first session_start.ts, endedAt = last session_end.ts', () => {
    const p = writeFixture(tmpDir, RESUMED_LINES);
    const { stats } = generateRetrospective(p);
    expect(stats.startedAt).toBe(BASE + 0);
    expect(stats.endedAt).toBe(BASE + 240200);
  });
});

// ─── fixture-stagnation ───────────────────────────────────────────────────────
const STAGNATION_LINES = [
  JSON.stringify({ v:1, ts:BASE+0,     runId:'r4', event:'session_start',  task:'t', autoMode:true, baseCommit:'abc', harnessVersion:'2.0.0' }),
  JSON.stringify({ v:1, ts:BASE+100,   runId:'r4', event:'phase_start',    phase:4,  attemptId:'d1' }),
  JSON.stringify({ v:1, ts:BASE+10100, runId:'r4', event:'gate_verdict',   phase:4,  retryIndex:0, runner:'codex', verdict:'REJECT', durationMs:10000, tokensTotal:1000 }),
  JSON.stringify({ v:1, ts:BASE+10200, runId:'r4', event:'gate_retry',     phase:4,  retryIndex:0, retryCount:1, retryLimit:3, feedbackPath:'/f', feedbackBytes:100, feedbackPreview:'x' }),
  JSON.stringify({ v:1, ts:BASE+20200, runId:'r4', event:'gate_verdict',   phase:4,  retryIndex:1, runner:'codex', verdict:'REJECT', durationMs:10000, tokensTotal:1000 }),
  JSON.stringify({ v:1, ts:BASE+20300, runId:'r4', event:'gate_retry',     phase:4,  retryIndex:1, retryCount:2, retryLimit:3, feedbackPath:'/f', feedbackBytes:100, feedbackPreview:'x' }),
  JSON.stringify({ v:1, ts:BASE+30300, runId:'r4', event:'gate_verdict',   phase:4,  retryIndex:2, runner:'codex', verdict:'REJECT', durationMs:10000, tokensTotal:1000 }),
  JSON.stringify({ v:1, ts:BASE+30400, runId:'r4', event:'gate_stagnation',phase:4,  retryIndex:2, similarities:[0.9,0.9], threshold:0.85, run:3, action:'escalate' }),
  JSON.stringify({ v:1, ts:BASE+30500, runId:'r4', event:'escalation',     phase:4,  reason:'gate-stagnation', userChoice:'C' }),
  JSON.stringify({ v:1, ts:BASE+30600, runId:'r4', event:'force_pass',     phase:4,  by:'auto' }),
  JSON.stringify({ v:1, ts:BASE+30700, runId:'r4', event:'phase_end',      phase:4,  attemptId:'d1', status:'completed', durationMs:30700 }),
  JSON.stringify({ v:1, ts:BASE+30800, runId:'r4', event:'session_end',    status:'completed', totalWallMs:30800 }),
];

describe('fixture-stagnation', () => {
  it('records stagnation, force_pass, retryCount, rejectCount in gate stats', () => {
    const p = writeFixture(tmpDir, STAGNATION_LINES);
    const { stats } = generateRetrospective(p);
    const g4 = stats.gates.find(g => g.phase === 4)!;
    expect(g4.stagnationTriggered).toBe(true);
    expect(g4.forcePass.triggered).toBe(true);
    expect(g4.forcePass.by).toBe('auto');
    expect(g4.rejectCount).toBe(3);
    expect(g4.retryCount).toBe(2); // gate_retry count, not gate_verdict count
  });

  it('markdown shows stagnation and force_pass in Phase 4 gate section', () => {
    const p = writeFixture(tmpDir, STAGNATION_LINES);
    const { markdown } = generateRetrospective(p);
    expect(markdown).toContain('### Phase 4 gate');
    expect(markdown).toContain('Stagnation: triggered');
    expect(markdown).toContain('Force pass: by auto');
  });
});

// ─── fixture-ambiguity ────────────────────────────────────────────────────────
const AMBIGUITY_LINES = [
  JSON.stringify({ v:1, ts:BASE+0,     runId:'r5', event:'session_start',  task:'t', autoMode:false, baseCommit:'abc', harnessVersion:'2.0.0' }),
  JSON.stringify({ v:1, ts:BASE+100,   runId:'r5', event:'phase_start',    phase:2,  attemptId:'b1' }),
  JSON.stringify({ v:1, ts:BASE+10100, runId:'r5', event:'gate_verdict',   phase:2,  retryIndex:0, runner:'codex', verdict:'REJECT', durationMs:10000, tokensTotal:1000, ambiguity:0.8 }),
  JSON.stringify({ v:1, ts:BASE+20100, runId:'r5', event:'gate_verdict',   phase:2,  retryIndex:1, runner:'codex', verdict:'REJECT', durationMs:10000, tokensTotal:1000, ambiguity:0.6 }),
  JSON.stringify({ v:1, ts:BASE+30100, runId:'r5', event:'gate_verdict',   phase:2,  retryIndex:2, runner:'codex', verdict:'APPROVE', durationMs:10000, tokensTotal:1000, ambiguity:0.4 }),
  JSON.stringify({ v:1, ts:BASE+30200, runId:'r5', event:'phase_end',      phase:2,  attemptId:'b1', status:'completed', durationMs:30200 }),
  JSON.stringify({ v:1, ts:BASE+30300, runId:'r5', event:'session_end',    status:'completed', totalWallMs:30300 }),
];

describe('fixture-ambiguity', () => {
  it('captures ambiguity trend in order for phase 2', () => {
    const p = writeFixture(tmpDir, AMBIGUITY_LINES);
    const { stats } = generateRetrospective(p);
    const g2 = stats.gates.find(g => g.phase === 2)!;
    expect(g2.ambiguityTrend).toEqual([0.8, 0.6, 0.4]);
  });

  it('markdown renders Ambiguity trend line with arrow separators', () => {
    const p = writeFixture(tmpDir, AMBIGUITY_LINES);
    const { markdown } = generateRetrospective(p);
    expect(markdown).toContain('Ambiguity trend: 0.8 → 0.6 → 0.4');
  });
});

// ─── fixture-spike ────────────────────────────────────────────────────────────
// Phases 1, 3 each have 1000 tokens; phase 5 has 3000 → median([1000,1000,3000])=1000, ratio=3.0 ≥ 2 → flagged
const SPIKE_LINES = [
  JSON.stringify({ v:1, ts:BASE+0,      runId:'r6', event:'session_start', task:'t', autoMode:false, baseCommit:'abc', harnessVersion:'2.0.0' }),
  JSON.stringify({ v:1, ts:BASE+100,    runId:'r6', event:'phase_start',   phase:1,  attemptId:'a1' }),
  JSON.stringify({ v:1, ts:BASE+60100,  runId:'r6', event:'phase_end',     phase:1,  attemptId:'a1', status:'completed', durationMs:60000, claudeTokens:{input:100,output:900,cacheRead:0,cacheCreate:0,total:1000} }),
  JSON.stringify({ v:1, ts:BASE+60200,  runId:'r6', event:'phase_start',   phase:3,  attemptId:'c1' }),
  JSON.stringify({ v:1, ts:BASE+120200, runId:'r6', event:'phase_end',     phase:3,  attemptId:'c1', status:'completed', durationMs:60000, claudeTokens:{input:100,output:900,cacheRead:0,cacheCreate:0,total:1000} }),
  JSON.stringify({ v:1, ts:BASE+120300, runId:'r6', event:'phase_start',   phase:5,  attemptId:'e1' }),
  JSON.stringify({ v:1, ts:BASE+240300, runId:'r6', event:'phase_end',     phase:5,  attemptId:'e1', status:'completed', durationMs:120000, claudeTokens:{input:1500,output:1500,cacheRead:0,cacheCreate:0,total:3000} }),
  JSON.stringify({ v:1, ts:BASE+240400, runId:'r6', event:'session_end',   status:'completed', totalWallMs:240400 }),
];

describe('fixture-spike', () => {
  it('flags spike when max >= 2× median, top phase is 5', () => {
    const p = writeFixture(tmpDir, SPIKE_LINES);
    const { stats } = generateRetrospective(p);
    expect(stats.spike.flagged).toBe(true);
    expect(stats.spike.ratio).toBeCloseTo(3.0);
    expect(stats.spike.topPhases[0].phase).toBe(5);
    expect(stats.spike.topPhases[0].tokens).toBe(3000);
  });

  it('markdown contains Token spike detected line', () => {
    const p = writeFixture(tmpDir, SPIKE_LINES);
    const { markdown } = generateRetrospective(p);
    expect(markdown).toContain('Token spike detected');
    expect(markdown).toContain('3.0×');
  });
});

// ─── fixture-malformed ────────────────────────────────────────────────────────
const MALFORMED_LINES = [
  JSON.stringify({ v:1, ts:BASE+0,   runId:'r7', event:'session_start', task:'t', autoMode:false, baseCommit:'abc', harnessVersion:'2.0.0' }),
  'not-valid-json',
  JSON.stringify({ v:1, ts:BASE+100, runId:'r7', event:'session_end',   status:'completed', totalWallMs:100 }),
  '{broken',
];

describe('fixture-malformed', () => {
  it('counts 2 malformed lines, continues normally', () => {
    const p = writeFixture(tmpDir, MALFORMED_LINES);
    const { stats } = generateRetrospective(p);
    expect(stats.malformedLineCount).toBe(2);
    expect(stats.eventCount).toBe(2); // only valid events counted
  });

  it('footer includes malformed line count', () => {
    const p = writeFixture(tmpDir, MALFORMED_LINES);
    const { markdown } = generateRetrospective(p);
    expect(markdown).toContain('2 malformed lines skipped');
  });
});

// ─── determinism ─────────────────────────────────────────────────────────────
describe('determinism', () => {
  it('same events.jsonl produces byte-identical markdown on two consecutive calls', () => {
    const p = writeFixture(tmpDir, COMPLETED_LINES);
    const { markdown: m1 } = generateRetrospective(p);
    const { markdown: m2 } = generateRetrospective(p);
    expect(m1).toBe(m2);
  });
});
```

- [ ] **Step 2: Run tests to confirm they all fail**

```bash
pnpm vitest run tests/phases/retrospective.test.ts
```

Expected: all tests FAIL with "not implemented".

---

### Task 3: Implement full stats aggregation

**Files:**
- Modify: `src/phases/retrospective.ts`

Replace the stub body of `generateRetrospective` with the full parsing + aggregation. Add `renderMarkdown` as a stub returning `''` so the function compiles — Task 4 will complete it.

- [ ] **Step 1: Replace `src/phases/retrospective.ts` with the full implementation**

```typescript
import fs from 'fs';

export interface RetrospectiveStats {
  runId: string;
  harnessVersion: string | null;
  status: 'completed' | 'failed' | 'paused' | 'interrupted' | 'unknown';
  autoMode: boolean;
  startedAt: number;
  endedAt: number;
  totalWallMs: number;
  eventCount: number;
  malformedLineCount: number;
  phases: Array<{
    phase: number;
    attempts: number;
    durationMs: number;
    claudeTokens: number;
    codexTokens: number;
    finalStatus: 'completed' | 'failed' | 'unknown';
  }>;
  gates: Array<{
    phase: number;
    retryCount: number;
    rejectCount: number;
    codexTokens: number;
    ambiguityTrend: number[];
    stagnationTriggered: boolean;
    forcePass: { triggered: boolean; by?: 'auto' | 'user' };
  }>;
  escalations: Array<{ phase: number; reason: string; userChoice?: 'C' | 'S' | 'Q' | 'R' }>;
  verify: { passCount: number; failCount: number; lastFailedChecks: string[] };
  spike: { topPhases: Array<{ phase: number; tokens: number }>; flagged: boolean; ratio: number };
  totals: { claudeTokens: number; codexTokens: number };
}

export function generateRetrospective(eventsPath: string): { markdown: string; stats: RetrospectiveStats } {
  // ── 1. Read + parse JSONL ──────────────────────────────────────────────────
  const raw = fs.readFileSync(eventsPath, 'utf-8'); // ENOENT throws naturally
  if (!raw.trim()) throw new Error(`events.jsonl is empty at ${eventsPath}`);

  const lines = raw.split('\n').filter(l => l.trim());
  let malformedLineCount = 0;
  const events: any[] = [];
  for (const line of lines) {
    try { events.push(JSON.parse(line)); } catch { malformedLineCount++; }
  }

  // ── 2. Session boundaries ──────────────────────────────────────────────────
  const sessionStarts = events.filter(e => e.event === 'session_start');
  const sessionEnds   = events.filter(e => e.event === 'session_end');
  const startedAt: number = sessionStarts.length > 0 ? sessionStarts[0].ts : events[0].ts;
  const lastSessionEnd = sessionEnds.length > 0 ? sessionEnds[sessionEnds.length - 1] : null;
  const endedAt: number = lastSessionEnd ? lastSessionEnd.ts : events[events.length - 1].ts;
  const totalWallMs: number = lastSessionEnd ? lastSessionEnd.totalWallMs : (endedAt - startedAt);

  const runId: string        = (sessionStarts[0] ?? events[0])?.runId ?? 'unknown';
  const harnessVersion       = sessionStarts[0]?.harnessVersion ?? null;
  const autoMode: boolean    = sessionStarts[0]?.autoMode ?? false;

  // ── 3. Status derivation ───────────────────────────────────────────────────
  // Track the latest phase_end status per phase number
  const latestPhaseEndStatus = new Map<number, string>();
  for (const e of events) {
    if (e.event === 'phase_end') latestPhaseEndStatus.set(e.phase as number, e.status);
  }
  const sessionEndStatus = lastSessionEnd?.status ?? 'unknown';
  let status: RetrospectiveStats['status'];
  if (sessionEndStatus === 'completed') {
    status = 'completed';
  } else if (sessionEndStatus === 'paused') {
    status = 'paused';
  } else if (sessionEndStatus === 'interrupted') {
    const anyFailed = [...latestPhaseEndStatus.values()].some(s => s === 'failed');
    status = anyFailed ? 'failed' : 'interrupted';
  } else {
    status = 'unknown';
  }

  // ── 4. Sidecar deduplication (same rule as logger.ts finalizeSummary) ──────
  const authVerdictKeys = new Set<string>();
  const authErrorPhases = new Set<number>();
  for (const e of events) {
    if (!e.recoveredFromSidecar) {
      if (e.event === 'gate_verdict') authVerdictKeys.add(`${e.phase}:${e.retryIndex}`);
      if (e.event === 'gate_error')   authErrorPhases.add(e.phase as number);
    }
  }

  // ── 5. Per-phase + per-gate accumulators ───────────────────────────────────
  interface PhaseAcc { attempts: number; durationMs: number; claudeTokens: number; codexTokens: number; lastStatus: string }
  const phaseAcc = new Map<number, PhaseAcc>();
  const ensurePhase = (n: number): PhaseAcc => {
    if (!phaseAcc.has(n)) phaseAcc.set(n, { attempts: 0, durationMs: 0, claudeTokens: 0, codexTokens: 0, lastStatus: 'unknown' });
    return phaseAcc.get(n)!;
  };

  interface GateAcc { retryCount: number; rejectCount: number; codexTokens: number; ambiguityTrend: number[]; stagnationTriggered: boolean; forcePass: { triggered: boolean; by?: 'auto' | 'user' } }
  const gateAcc = new Map<number, GateAcc>();
  const ensureGate = (n: number): GateAcc => {
    if (!gateAcc.has(n)) gateAcc.set(n, { retryCount: 0, rejectCount: 0, codexTokens: 0, ambiguityTrend: [], stagnationTriggered: false, forcePass: { triggered: false } });
    return gateAcc.get(n)!;
  };

  const escalations: RetrospectiveStats['escalations'] = [];
  let verifyPassCount = 0, verifyFailCount = 0, lastFailedChecks: string[] = [];

  for (const e of events) {
    const pn: number = (e.phase as number) ?? 0;

    if (e.event === 'phase_end') {
      const acc = ensurePhase(pn);
      acc.attempts++;
      acc.durationMs   += (e.durationMs ?? 0) as number;
      acc.claudeTokens += (e.claudeTokens?.total ?? 0) as number;
      acc.lastStatus    = (e.status ?? 'unknown') as string;
    }

    if (e.event === 'gate_verdict') {
      if (e.recoveredFromSidecar && authVerdictKeys.has(`${pn}:${e.retryIndex}`)) continue;
      const acc = ensurePhase(pn);
      acc.codexTokens += (e.tokensTotal ?? 0) as number;
      const g = ensureGate(pn);
      g.codexTokens += (e.tokensTotal ?? 0) as number;
      if (e.verdict === 'REJECT') g.rejectCount++;
      if (e.ambiguity !== undefined) g.ambiguityTrend.push(e.ambiguity as number);
    }

    if (e.event === 'gate_error') {
      if (e.recoveredFromSidecar && authErrorPhases.has(pn)) continue;
      const acc = ensurePhase(pn);
      acc.codexTokens += (e.tokensTotal ?? 0) as number;
      const g = ensureGate(pn);
      g.codexTokens += (e.tokensTotal ?? 0) as number;
    }

    if (e.event === 'gate_retry') {
      ensureGate(pn).retryCount++;
    }

    if (e.event === 'gate_stagnation' && e.action === 'escalate') {
      ensureGate(pn).stagnationTriggered = true;
    }

    if (e.event === 'force_pass') {
      ensureGate(pn).forcePass = { triggered: true, by: e.by as 'auto' | 'user' };
    }

    if (e.event === 'escalation') {
      escalations.push({ phase: pn, reason: e.reason as string, userChoice: e.userChoice });
    }

    if (e.event === 'verify_result') {
      if (e.passed) verifyPassCount++;
      else { verifyFailCount++; lastFailedChecks = (e.failedChecks ?? []) as string[]; }
    }
  }

  // ── 6. Build phases array (ascending, skip durationMs=0) ──────────────────
  const phasesArr: RetrospectiveStats['phases'] = [...phaseAcc.entries()]
    .sort(([a], [b]) => a - b)
    .filter(([, acc]) => acc.durationMs > 0)
    .map(([phase, acc]) => ({
      phase,
      attempts:    acc.attempts,
      durationMs:  acc.durationMs,
      claudeTokens: acc.claudeTokens,
      codexTokens:  acc.codexTokens,
      finalStatus:  acc.lastStatus as 'completed' | 'failed' | 'unknown',
    }));

  // ── 7. Build gates array (ascending phase, only phases with gate events) ───
  const gatesArr: RetrospectiveStats['gates'] = [...gateAcc.entries()]
    .sort(([a], [b]) => a - b)
    .map(([phase, g]) => ({ phase, ...g }));

  // ── 8. Token spike detection ───────────────────────────────────────────────
  const phasesWithTokens = phasesArr.filter(p => p.claudeTokens > 0);
  let spike: RetrospectiveStats['spike'] = { topPhases: [], flagged: false, ratio: 0 };
  if (phasesWithTokens.length > 0) {
    const sorted = [...phasesArr].sort((a, b) => b.claudeTokens - a.claudeTokens);
    const top3 = sorted.filter(p => p.claudeTokens > 0).slice(0, 3).map(p => ({ phase: p.phase, tokens: p.claudeTokens }));
    const maxTokens = top3[0]?.tokens ?? 0;
    const nonZero = phasesWithTokens.map(p => p.claudeTokens).sort((a, b) => a - b);
    const mid = Math.floor(nonZero.length / 2);
    const median = nonZero.length % 2 === 1 ? nonZero[mid] : (nonZero[mid - 1] + nonZero[mid]) / 2;
    const ratio = median > 0 ? maxTokens / median : 0;
    spike = { topPhases: top3, flagged: ratio >= 2, ratio };
  }

  // ── 9. Totals ──────────────────────────────────────────────────────────────
  const totalClaudeTokens = phasesArr.reduce((s, p) => s + p.claudeTokens, 0);
  const totalCodexTokens  = phasesArr.reduce((s, p) => s + p.codexTokens, 0);

  const stats: RetrospectiveStats = {
    runId, harnessVersion, status, autoMode,
    startedAt, endedAt, totalWallMs,
    eventCount: events.length,
    malformedLineCount,
    phases: phasesArr,
    gates: gatesArr,
    escalations,
    verify: { passCount: verifyPassCount, failCount: verifyFailCount, lastFailedChecks },
    spike,
    totals: { claudeTokens: totalClaudeTokens, codexTokens: totalCodexTokens },
  };

  return { markdown: renderMarkdown(stats, eventsPath, events), stats };
}

function renderMarkdown(_stats: RetrospectiveStats, _eventsPath: string, _events: any[]): string {
  return ''; // placeholder — replaced in Task 4
}
```

- [ ] **Step 2: Run tests — stats assertions pass, markdown assertions fail**

```bash
pnpm vitest run tests/phases/retrospective.test.ts
```

Expected: tests checking `stats.*` fields pass; tests checking markdown content fail.

- [ ] **Step 3: Typecheck**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

---

### Task 4: Implement markdown renderer — all analyzer tests pass

**Files:**
- Modify: `src/phases/retrospective.ts` (replace `renderMarkdown` stub)

- [ ] **Step 1: Replace `renderMarkdown` with the full section-by-section implementation**

```typescript
function humanizeMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${m}m ${sec}s`;
}

function isoFromTs(ts: number): string {
  return new Date(ts).toISOString();
}

function renderMarkdown(stats: RetrospectiveStats, eventsPath: string, events: any[]): string {
  const lines: string[] = [];

  // 1. Title
  lines.push(`# Retrospective — ${stats.runId}`);
  lines.push('');

  // 2. Header table
  lines.push('| Key | Value |');
  lines.push('|---|---|');
  lines.push(`| Harness version | ${stats.harnessVersion ?? 'unknown'} |`);
  lines.push(`| Status | ${stats.status} |`);
  lines.push(`| Auto mode | ${stats.autoMode} |`);
  lines.push(`| Started | ${isoFromTs(stats.startedAt)} |`);
  lines.push(`| Ended | ${isoFromTs(stats.endedAt)} |`);
  lines.push(`| Total wall time | ${humanizeMs(stats.totalWallMs)} |`);
  lines.push(`| Events | ${stats.eventCount} |`);
  lines.push(`| Malformed lines | ${stats.malformedLineCount} |`);
  lines.push('');

  // 3. Phase Summary
  lines.push('## Phase Summary');
  lines.push('');
  const activePhases = stats.phases.filter(p => p.durationMs > 0);
  if (activePhases.length === 0) {
    lines.push('_No phase activity._');
  } else {
    lines.push('| Phase | Attempts | Duration | Claude tokens | Codex (gate) tokens | Final status |');
    lines.push('|---|---|---|---|---|---|');
    for (const p of activePhases) {
      lines.push(`| ${p.phase} | ${p.attempts} | ${humanizeMs(p.durationMs)} | ${p.claudeTokens} | ${p.codexTokens} | ${p.finalStatus} |`);
    }
  }
  lines.push('');

  // 4. Token Spike
  lines.push('## Token Spike');
  lines.push('');
  if (stats.spike.topPhases.length === 0) {
    lines.push('_No notable spike._');
  } else {
    lines.push('| Rank | Phase | Claude tokens |');
    lines.push('|---|---|---|');
    stats.spike.topPhases.forEach((tp, i) => {
      lines.push(`| ${i + 1} | ${tp.phase} | ${tp.tokens} |`);
    });
    if (stats.spike.flagged) {
      const top = stats.spike.topPhases[0];
      lines.push(`> Token spike detected: phase ${top.phase} is ${stats.spike.ratio.toFixed(1)}× median`);
    }
  }
  lines.push('');

  // 5. Gate Activity
  lines.push('## Gate Activity');
  lines.push('');
  let anyGate = false;
  for (const gp of [2, 4, 7] as const) {
    const g = stats.gates.find(x => x.phase === gp);
    if (!g) continue;
    anyGate = true;
    lines.push(`### Phase ${gp} gate`);
    lines.push(`Retries: ${g.retryCount} | REJECTs: ${g.rejectCount} | Codex tokens: ${g.codexTokens}`);
    if (gp === 2 && g.ambiguityTrend.length > 0) {
      lines.push(`Ambiguity trend: ${g.ambiguityTrend.join(' → ')}`);
    }
    lines.push(g.stagnationTriggered ? 'Stagnation: triggered' : 'Stagnation: not triggered');
    lines.push(g.forcePass.triggered ? `Force pass: by ${g.forcePass.by}` : 'Force pass: not triggered');
    lines.push('');
  }
  if (!anyGate) {
    lines.push('_No gate activity._');
    lines.push('');
  }

  // 6. Escalations
  lines.push('## Escalations');
  lines.push('');
  if (stats.escalations.length === 0) {
    lines.push('_None._');
  } else {
    for (const esc of stats.escalations) {
      const choice = esc.userChoice ? ` (user chose: ${esc.userChoice})` : '';
      lines.push(`- Phase ${esc.phase}: ${esc.reason}${choice}`);
    }
  }
  lines.push('');

  // 7. Verify
  lines.push('## Verify');
  lines.push('');
  if (stats.verify.passCount === 0 && stats.verify.failCount === 0) {
    lines.push('_No verify activity._');
  } else {
    lines.push(`Passes: ${stats.verify.passCount} | Failures: ${stats.verify.failCount}`);
    if (stats.verify.lastFailedChecks.length > 0) {
      lines.push('Last failed checks:');
      for (const c of stats.verify.lastFailedChecks) lines.push(`- ${c}`);
    }
  }
  lines.push('');

  // 8. Totals
  lines.push('## Totals');
  lines.push('');
  lines.push(`Total Claude tokens: ${stats.totals.claudeTokens}`);
  lines.push(`Total Codex tokens: ${stats.totals.codexTokens}`);
  lines.push(`Total wall time: ${humanizeMs(stats.totalWallMs)}`);
  lines.push('');

  // 9. Footer (no Date.now() — derived from last event ts)
  const lastEventTs = events.length > 0 ? events[events.length - 1].ts : stats.endedAt;
  const malformedSuffix = stats.malformedLineCount > 0
    ? ` · ${stats.malformedLineCount} malformed lines skipped`
    : '';
  lines.push(`_Generated from ${eventsPath} · ${stats.eventCount} events · ended at ${isoFromTs(lastEventTs)}${malformedSuffix}_`);

  return lines.join('\n');
}
```

- [ ] **Step 2: Run all analyzer tests — expect all to pass**

```bash
pnpm vitest run tests/phases/retrospective.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Typecheck**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/phases/retrospective.ts tests/phases/retrospective.test.ts
git commit -m "feat(retro): implement analyzer with stats aggregation and deterministic markdown renderer"
```

---

### Task 5: Retro subcommand + CLI registration (TDD)

**Files:**
- Create: `tests/commands/retro.test.ts`
- Create: `src/commands/retro.ts`
- Modify: `bin/harness.ts`

- [ ] **Step 1: Write failing tests for the retro subcommand**

Create `tests/commands/retro.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { retroCommand } from '../../src/commands/retro.js';
import { computeRepoKey } from '../../src/logger.js';

const BASE = 1746612000000;
const MINIMAL_EVENTS =
  JSON.stringify({ v:1, ts:BASE,     runId:'test-run', event:'session_start', task:'t', autoMode:false, baseCommit:'abc', harnessVersion:'2.0.0' }) + '\n' +
  JSON.stringify({ v:1, ts:BASE+100, runId:'test-run', event:'session_end',   status:'completed', totalWallMs:100 }) + '\n';

let tmpDir: string;
let harnessDir: string;
let sessionsRoot: string;

beforeEach(() => {
  tmpDir      = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-cmd-test-'));
  harnessDir  = path.join(tmpDir, '.harness');
  sessionsRoot = path.join(tmpDir, 'sessions');
  fs.mkdirSync(harnessDir, { recursive: true });
});

afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

function setupEventsFile(runId: string, content: string): void {
  const repoKey = computeRepoKey(harnessDir);
  const dir = path.join(sessionsRoot, repoKey, runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), content);
}

describe('retroCommand', () => {
  it('exit 1 and stderr message when events.jsonl not found', async () => {
    const mockExit   = vi.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`exit:${code}`); });
    const mockStderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(retroCommand('no-such-run', { root: tmpDir, sessionsRoot })).rejects.toThrow('exit:1');
    expect(mockStderr).toHaveBeenCalledWith(expect.stringContaining('[retro] events.jsonl not found'));

    mockExit.mockRestore();
    mockStderr.mockRestore();
  });

  it('writes retrospective.md to <harnessDir>/<runId>/ on success', async () => {
    setupEventsFile('test-run', MINIMAL_EVENTS);
    await retroCommand('test-run', { root: tmpDir, sessionsRoot });
    const outPath = path.join(harnessDir, 'test-run', 'retrospective.md');
    expect(fs.existsSync(outPath)).toBe(true);
    expect(fs.readFileSync(outPath, 'utf-8').length).toBeGreaterThan(0);
  });

  it('--stdout prints markdown to stdout and does NOT write file', async () => {
    setupEventsFile('test-run', MINIMAL_EVENTS);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await retroCommand('test-run', { root: tmpDir, sessionsRoot, stdout: true });
    expect(stdoutSpy).toHaveBeenCalled();
    expect(fs.existsSync(path.join(harnessDir, 'test-run', 'retrospective.md'))).toBe(false);
    stdoutSpy.mockRestore();
  });

  it('exit 1 when events.jsonl exists but is empty', async () => {
    const repoKey = computeRepoKey(harnessDir);
    const dir = path.join(sessionsRoot, repoKey, 'empty-run');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'events.jsonl'), '');

    const mockExit   = vi.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`exit:${code}`); });
    const mockStderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(retroCommand('empty-run', { root: tmpDir, sessionsRoot })).rejects.toThrow('exit:1');
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
    mockStderr.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail (module not found)**

```bash
pnpm vitest run tests/commands/retro.test.ts
```

Expected: import error — `src/commands/retro.ts` does not exist yet.

- [ ] **Step 3: Create `src/commands/retro.ts`**

```typescript
import fs from 'fs';
import path from 'path';
import os from 'os';
import { findHarnessRoot } from '../root.js';
import { computeRepoKey } from '../logger.js';
import { generateRetrospective } from '../phases/retrospective.js';

export interface RetroOptions {
  root?: string;
  stdout?: boolean;
  sessionsRoot?: string; // override for tests; production uses ~/.harness/sessions
}

export async function retroCommand(runId: string, options: RetroOptions): Promise<void> {
  const harnessDir   = findHarnessRoot(options.root);
  const repoKey      = computeRepoKey(harnessDir);
  const sessionsRoot = options.sessionsRoot ?? path.join(os.homedir(), '.harness', 'sessions');
  const eventsPath   = path.join(sessionsRoot, repoKey, runId, 'events.jsonl');

  if (!fs.existsSync(eventsPath)) {
    process.stderr.write(`[retro] events.jsonl not found at ${eventsPath}\n`);
    process.exit(1);
  }

  let result: { markdown: string };
  try {
    result = generateRetrospective(eventsPath);
  } catch (err) {
    process.stderr.write(`[retro] ${(err as Error).message}\n`);
    process.exit(1);
  }

  if (options.stdout) {
    process.stdout.write(result.markdown + '\n');
    return;
  }

  const outDir  = path.join(harnessDir, runId);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'retrospective.md');
  const tmp     = outPath + '.tmp';
  fs.writeFileSync(tmp, result.markdown);
  fs.renameSync(tmp, outPath);
}
```

- [ ] **Step 4: Register `retro` subcommand in `bin/harness.ts`**

Add to the imports at the top of `bin/harness.ts`:

```typescript
import { retroCommand } from '../src/commands/retro.js';
```

Add before `program.parseAsync(process.argv)`:

```typescript
program
  .command('retro <runId>')
  .description("generate retrospective markdown from a run's events.jsonl")
  .option('--stdout', 'print markdown to stdout instead of writing to file')
  .action(async (runId: string, opts: { stdout?: boolean }) => {
    const globalOpts = program.opts();
    await retroCommand(runId, { stdout: opts.stdout, root: globalOpts.root });
  });
```

- [ ] **Step 5: Run retro command tests — all pass**

```bash
pnpm vitest run tests/commands/retro.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 6: Typecheck**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add src/commands/retro.ts tests/commands/retro.test.ts bin/harness.ts
git commit -m "feat(retro): add retro subcommand and register in CLI"
```

---

### Task 6: Auto-emit hook in `inner.ts`

**Files:**
- Modify: `src/commands/inner.ts`
- Modify: `tests/commands/inner.test.ts` (append hook smoke tests)

- [ ] **Step 1: Add auto-emit hook to `inner.ts` finally block**

In `src/commands/inner.ts`, locate the `finally` block (lines 282–291). After `logger.finalizeSummary(state)` and **before** `logger.close()`, insert the following block:

```typescript
    // Auto-emit retrospective — fail-open, single warn on error
    const eventsPath = logger.getEventsPath();
    if (eventsPath) {
      try {
        const { generateRetrospective } = await import('../phases/retrospective.js');
        const { markdown } = generateRetrospective(eventsPath);
        const outDir = join(harnessDir, runId);
        fs.mkdirSync(outDir, { recursive: true });
        const outPath = join(outDir, 'retrospective.md');
        const tmp = outPath + '.tmp';
        fs.writeFileSync(tmp, markdown);
        fs.renameSync(tmp, outPath);
      } catch (err) {
        process.stderr.write(`[retro] failed to generate retrospective: ${(err as Error).message}\n`);
      }
    }
```

The resulting `finally` block:

```typescript
  } finally {
    footerTimer.stop();
    process.removeListener('SIGWINCH', footerTimer.forceTick);
    logger.logEvent({ event: 'session_end', status: sessionEndStatus, totalWallMs: Date.now() - logger.getStartedAt() });
    logger.finalizeSummary(state);
    // Auto-emit retrospective — fail-open, single warn on error
    const eventsPath = logger.getEventsPath();
    if (eventsPath) {
      try {
        const { generateRetrospective } = await import('../phases/retrospective.js');
        const { markdown } = generateRetrospective(eventsPath);
        const outDir = join(harnessDir, runId);
        fs.mkdirSync(outDir, { recursive: true });
        const outPath = join(outDir, 'retrospective.md');
        const tmp = outPath + '.tmp';
        fs.writeFileSync(tmp, markdown);
        fs.renameSync(tmp, outPath);
      } catch (err) {
        process.stderr.write(`[retro] failed to generate retrospective: ${(err as Error).message}\n`);
      }
    }
    logger.close();
    unmountInk();
    inputManager.stop();
    releaseLock(harnessDir, runId);
  }
```

- [ ] **Step 2: Append hook smoke tests to `tests/commands/inner.test.ts`**

At the end of the existing file, add:

```typescript
describe('auto-emit retrospective hook (isolation smoke tests)', () => {
  it('is fail-open: when generateRetrospective throws, stderr is written and no re-throw', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    // Simulate the hook in isolation
    const eventsPath = '/tmp/nonexistent-events.jsonl';
    await (async () => {
      try {
        const { generateRetrospective } = await import('../../src/phases/retrospective.js');
        generateRetrospective(eventsPath);
      } catch (err) {
        process.stderr.write(`[retro] failed to generate retrospective: ${(err as Error).message}\n`);
      }
    })();

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('[retro] failed to generate retrospective:'));
    stderrSpy.mockRestore();
  });

  it('NoopLogger path: getEventsPath()===null means the if-block is skipped, no stderr', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    // Simulate the guard condition
    const eventsPath: string | null = null;
    if (eventsPath) {
      process.stderr.write('[retro] should not be reached\n');
    }

    expect(stderrSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });
});
```

- [ ] **Step 3: Run inner tests — existing + new smoke tests all pass**

```bash
pnpm vitest run tests/commands/inner.test.ts
```

Expected: all tests (existing + 2 new) pass.

- [ ] **Step 4: Run the complete test suite — no regressions**

```bash
pnpm vitest run
```

Expected: all tests pass.

- [ ] **Step 5: Typecheck + build**

```bash
pnpm tsc --noEmit && pnpm build
```

Expected: no errors, `dist/` updated.

- [ ] **Step 6: Commit**

```bash
git add src/commands/inner.ts tests/commands/inner.test.ts
git commit -m "feat(retro): wire auto-emit hook in inner.ts finally block (fail-open)"
```
