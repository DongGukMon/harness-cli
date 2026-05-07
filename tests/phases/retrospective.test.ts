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
  JSON.stringify({ v:1, ts:BASE+240200,  runId:'r3', event:'session_end',   status:'completed', totalWallMs:999999 }),
];

describe('fixture-resumed', () => {
  it('aggregates phases across both sessions', () => {
    const p = writeFixture(tmpDir, RESUMED_LINES);
    const { stats } = generateRetrospective(p);
    expect(stats.phases.map(ph => ph.phase)).toEqual(expect.arrayContaining([1, 5]));
  });

  it('startedAt = first session_start.ts, endedAt = last session_end.ts, totalWallMs = endedAt − startedAt', () => {
    const p = writeFixture(tmpDir, RESUMED_LINES);
    const { stats } = generateRetrospective(p);
    expect(stats.startedAt).toBe(BASE + 0);
    expect(stats.endedAt).toBe(BASE + 240200);
    // totalWallMs = endedAt - startedAt (NOT session_end.totalWallMs which is 999999)
    expect(stats.totalWallMs).toBe(240200);
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
