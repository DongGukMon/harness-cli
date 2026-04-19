import fs from 'fs';
import path from 'path';
import os from 'os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  encodeProjectDir,
  readClaudeSessionUsage,
} from '../../src/runners/claude-usage.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface AssistantTurnInput {
  tsMs: number;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheCreate?: number;
}

function assistantLine(t: AssistantTurnInput): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: new Date(t.tsMs).toISOString(),
    sessionId: 'fake',
    message: {
      usage: {
        input_tokens: t.input ?? 0,
        output_tokens: t.output ?? 0,
        cache_read_input_tokens: t.cacheRead ?? 0,
        cache_creation_input_tokens: t.cacheCreate ?? 0,
      },
    },
  });
}

function nonAssistantLine(type: string, tsMs: number): string {
  return JSON.stringify({ type, timestamp: new Date(tsMs).toISOString() });
}

function writeSession(absPath: string, lines: string[]): void {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, lines.join('\n') + '\n');
}

function projectDirFor(tmpHome: string, cwd: string): string {
  return path.join(tmpHome, '.claude', 'projects', encodeProjectDir(cwd));
}

// ─────────────────────────────────────────────────────────────────────────────

describe('encodeProjectDir', () => {
  it('encodes slashes and dots as hyphens', () => {
    expect(
      encodeProjectDir('/Users/daniel/.grove/github.com/DongGukMon/harness-cli')
    ).toBe('-Users-daniel--grove-github-com-DongGukMon-harness-cli');
  });

  it('replaces all non-alphanumeric characters with hyphen', () => {
    expect(encodeProjectDir('/a/b c/d_e')).toBe('-a-b-c-d-e');
  });
});

describe('readClaudeSessionUsage', () => {
  const PHASE_START = 1_750_000_000_000;
  const CWD = '/tmp/fake-cwd';
  const ATTEMPT_ID = '00000000-0000-4000-8000-000000000001';

  let tmpHome: string;
  let stderrSpy: any;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-usage-test-'));
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    stderrSpy.mockRestore();
  });

  // Case 1 — happy path (pinned)
  it('sums usage across assistant turns in the pinned session file', () => {
    const dir = projectDirFor(tmpHome, CWD);
    writeSession(path.join(dir, `${ATTEMPT_ID}.jsonl`), [
      nonAssistantLine('queue-operation', PHASE_START),
      assistantLine({ tsMs: PHASE_START + 1_000, input: 1, output: 10, cacheRead: 100, cacheCreate: 1_000 }),
      assistantLine({ tsMs: PHASE_START + 2_000, input: 2, output: 20, cacheRead: 200, cacheCreate: 2_000 }),
      assistantLine({ tsMs: PHASE_START + 3_000, input: 3, output: 30, cacheRead: 300, cacheCreate: 3_000 }),
    ]);
    const result = readClaudeSessionUsage({
      sessionId: ATTEMPT_ID,
      cwd: CWD,
      phaseStartTs: PHASE_START,
      homeDir: tmpHome,
    });
    expect(result).toEqual({
      input: 6,
      output: 60,
      cacheRead: 600,
      cacheCreate: 6_000,
      total: 6_666,
    });
  });

  // Case 2 — fallback scan picks earliest-eligible (distinct timestamps)
  it('falls back to scanning project dir when pinned file is missing and picks the smallest-eligible first-assistant timestamp', () => {
    const dir = projectDirFor(tmpHome, CWD);
    // fallback-before: first-assistant < phaseStartTs → must be excluded
    writeSession(path.join(dir, 'fallback-before.jsonl'), [
      assistantLine({ tsMs: PHASE_START - 5_000, input: 999, output: 999, cacheRead: 999, cacheCreate: 999 }),
    ]);
    // fallback-early: first-assistant == phaseStartTs + 1s → should be picked
    writeSession(path.join(dir, 'fallback-early.jsonl'), [
      assistantLine({ tsMs: PHASE_START + 1_000, input: 1, output: 2, cacheRead: 3, cacheCreate: 4 }),
      assistantLine({ tsMs: PHASE_START + 2_000, input: 10, output: 20, cacheRead: 30, cacheCreate: 40 }),
    ]);
    // fallback-late: first-assistant == phaseStartTs + 60s → should NOT be picked
    writeSession(path.join(dir, 'fallback-late.jsonl'), [
      assistantLine({ tsMs: PHASE_START + 60_000, input: 500, output: 500, cacheRead: 500, cacheCreate: 500 }),
    ]);

    const result = readClaudeSessionUsage({
      sessionId: ATTEMPT_ID,
      cwd: CWD,
      phaseStartTs: PHASE_START,
      homeDir: tmpHome,
    });
    // Expected: early's two turns summed (1+10, 2+20, 3+30, 4+40, total)
    expect(result).toEqual({
      input: 11,
      output: 22,
      cacheRead: 33,
      cacheCreate: 44,
      total: 110,
    });
  });

  // Case 3 — fallback has no eligible candidate
  it('returns null when pinned file is missing and no fallback candidate is in the window', () => {
    const dir = projectDirFor(tmpHome, CWD);
    writeSession(path.join(dir, 'fallback-before.jsonl'), [
      assistantLine({ tsMs: PHASE_START - 10_000, input: 1 }),
    ]);
    const result = readClaudeSessionUsage({
      sessionId: ATTEMPT_ID,
      cwd: CWD,
      phaseStartTs: PHASE_START,
      homeDir: tmpHome,
    });
    expect(result).toBeNull();
  });

  // Case 4 — malformed line skipped, stderr warn once
  it('skips malformed JSON lines and warns exactly once per read', () => {
    const dir = projectDirFor(tmpHome, CWD);
    const lines = [
      assistantLine({ tsMs: PHASE_START + 1, input: 1, output: 1, cacheRead: 1, cacheCreate: 1 }),
      '{ this is not valid json ::::',
      'also broken',
      assistantLine({ tsMs: PHASE_START + 2, input: 2, output: 2, cacheRead: 2, cacheCreate: 2 }),
    ];
    writeSession(path.join(dir, `${ATTEMPT_ID}.jsonl`), lines);
    const result = readClaudeSessionUsage({
      sessionId: ATTEMPT_ID,
      cwd: CWD,
      phaseStartTs: PHASE_START,
      homeDir: tmpHome,
    });
    expect(result).toEqual({ input: 3, output: 3, cacheRead: 3, cacheCreate: 3, total: 12 });

    // Exactly one stderr write for the skipped-lines summary.
    const writes = stderrSpy.mock.calls.map((c: any[]) => String(c[0]));
    const skippedWrites = writes.filter((w: string) => /skip|malformed|parse/i.test(w));
    expect(skippedWrites).toHaveLength(1);
  });

  // Case 5 — no assistant entries → null (3-state contract: object | null | absent)
  it('returns null when the pinned session has no assistant entries', () => {
    const dir = projectDirFor(tmpHome, CWD);
    writeSession(path.join(dir, `${ATTEMPT_ID}.jsonl`), [
      nonAssistantLine('queue-operation', PHASE_START),
      nonAssistantLine('user', PHASE_START + 1_000),
    ]);
    const result = readClaudeSessionUsage({
      sessionId: ATTEMPT_ID,
      cwd: CWD,
      phaseStartTs: PHASE_START,
      homeDir: tmpHome,
    });
    expect(result).toBeNull();
  });

  // Case 5b — pinned file is completely empty → null
  it('returns null when the pinned JSONL is completely empty', () => {
    const dir = projectDirFor(tmpHome, CWD);
    writeSession(path.join(dir, `${ATTEMPT_ID}.jsonl`), []);
    const result = readClaudeSessionUsage({
      sessionId: ATTEMPT_ID,
      cwd: CWD,
      phaseStartTs: PHASE_START,
      homeDir: tmpHome,
    });
    expect(result).toBeNull();
  });

  // Case 6 — cache-only entries sum correctly
  it('aggregates cache-only entries (missing input_tokens) correctly', () => {
    const dir = projectDirFor(tmpHome, CWD);
    writeSession(path.join(dir, `${ATTEMPT_ID}.jsonl`), [
      JSON.stringify({
        type: 'assistant',
        timestamp: new Date(PHASE_START + 100).toISOString(),
        message: { usage: { cache_creation_input_tokens: 5_000 } },
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: new Date(PHASE_START + 200).toISOString(),
        message: { usage: { cache_creation_input_tokens: 3_000, cache_read_input_tokens: 1_000 } },
      }),
    ]);
    const result = readClaudeSessionUsage({
      sessionId: ATTEMPT_ID,
      cwd: CWD,
      phaseStartTs: PHASE_START,
      homeDir: tmpHome,
    });
    expect(result).toEqual({
      input: 0,
      output: 0,
      cacheRead: 1_000,
      cacheCreate: 8_000,
      total: 9_000,
    });
  });

  // Case 7 — project dir missing entirely (ENOENT) → null, no warn
  it('returns null silently when the project dir does not exist (ENOENT)', () => {
    const result = readClaudeSessionUsage({
      sessionId: ATTEMPT_ID,
      cwd: CWD,
      phaseStartTs: PHASE_START,
      homeDir: tmpHome, // this HOME has no ~/.claude/projects tree
    });
    expect(result).toBeNull();
    const writes = stderrSpy.mock.calls.map((c: any[]) => String(c[0]));
    expect(writes.length).toBe(0);
  });

  // Case 10 — readdirSync throws non-ENOENT → null + single warn
  it('returns null with a single stderr warning when readdirSync throws a non-ENOENT error', () => {
    const orig = fs.readdirSync;
    const readdirSpy = vi.spyOn(fs, 'readdirSync').mockImplementation(((p: any, ...rest: any[]) => {
      if (typeof p === 'string' && p.includes('claude')) {
        const err: NodeJS.ErrnoException = new Error('Permission denied');
        err.code = 'EACCES';
        throw err;
      }
      return (orig as any)(p, ...rest);
    }) as any);

    try {
      const result = readClaudeSessionUsage({
        sessionId: ATTEMPT_ID,
        cwd: CWD,
        phaseStartTs: PHASE_START,
        homeDir: tmpHome,
      });
      expect(result).toBeNull();
      const writes = stderrSpy.mock.calls.map((c: any[]) => String(c[0]));
      const warnWrites = writes.filter((w: string) => w.includes('project dir unreadable'));
      expect(warnWrites).toHaveLength(1);
    } finally {
      readdirSpy.mockRestore();
    }
  });

  // Case 8 — tie-break by lexical filename when two candidates share a timestamp
  it('breaks ties by lexical filename order when two fallback candidates share a first-assistant timestamp', () => {
    const dir = projectDirFor(tmpHome, CWD);
    const tieTs = PHASE_START + 2_000;
    writeSession(path.join(dir, 'fallback-tie-a.jsonl'), [
      assistantLine({ tsMs: tieTs, input: 1, output: 1, cacheRead: 1, cacheCreate: 1 }),
    ]);
    writeSession(path.join(dir, 'fallback-tie-b.jsonl'), [
      assistantLine({ tsMs: tieTs, input: 9, output: 9, cacheRead: 9, cacheCreate: 9 }),
    ]);

    const result = readClaudeSessionUsage({
      sessionId: ATTEMPT_ID,
      cwd: CWD,
      phaseStartTs: PHASE_START,
      homeDir: tmpHome,
    });
    // tie-a wins lexically
    expect(result).toEqual({ input: 1, output: 1, cacheRead: 1, cacheCreate: 1, total: 4 });
  });

  // Case 9 — hard I/O on pinned file (non-ENOENT) → null + single stderr warn
  it('returns null with a single stderr warning when the pinned file exists but read fails hard (e.g. EACCES)', () => {
    const dir = projectDirFor(tmpHome, CWD);
    const pinnedPath = path.join(dir, `${ATTEMPT_ID}.jsonl`);
    writeSession(pinnedPath, [assistantLine({ tsMs: PHASE_START + 1, input: 1 })]);

    const orig = fs.readFileSync;
    const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation(((p: any, ...rest: any[]) => {
      if (typeof p === 'string' && p === pinnedPath) {
        const err: NodeJS.ErrnoException = new Error('EACCES simulated');
        err.code = 'EACCES';
        throw err;
      }
      return (orig as any)(p, ...rest);
    }) as any);

    try {
      const result = readClaudeSessionUsage({
        sessionId: ATTEMPT_ID,
        cwd: CWD,
        phaseStartTs: PHASE_START,
        homeDir: tmpHome,
      });
      expect(result).toBeNull();
      const writes = stderrSpy.mock.calls.map((c: any[]) => String(c[0]));
      expect(writes.length).toBe(1);
    } finally {
      readSpy.mockRestore();
    }
  });
});
