import fs from 'fs';
import path from 'path';
import os from 'os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  readCodexSessionUsage,
  codexSessionJsonlPath,
} from '../../src/runners/codex-usage.js';

function tokenCountLine(opts: {
  tsMs?: number;
  input: number;
  output: number;
  cacheRead?: number;
  reasoningOutput?: number;
}): string {
  const input = opts.input;
  const cacheRead = opts.cacheRead ?? 0;
  const output = opts.output;
  const reasoning = opts.reasoningOutput ?? 0;
  const total = input + output + reasoning;
  return JSON.stringify({
    type: 'event_msg',
    timestamp: new Date(opts.tsMs ?? Date.now()).toISOString(),
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: input,
          cached_input_tokens: cacheRead,
          output_tokens: output,
          reasoning_output_tokens: reasoning,
          total_tokens: total,
        },
      },
    },
  });
}

describe('codexSessionJsonlPath', () => {
  it('resolves to $codexHome/sessions/<sessionId>.jsonl', () => {
    expect(codexSessionJsonlPath('abc-123', '/tmp/codex-home'))
      .toBe('/tmp/codex-home/sessions/abc-123.jsonl');
  });
});

describe('readCodexSessionUsage — pinned sessionId', () => {
  const PHASE_START = 1_750_000_000_000;
  const SESSION_ID = 'aaaa-1111';
  let tmpHome: string;
  let stderrSpy: any;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-usage-test-'));
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns summed tokens from a pinned session file', async () => {
    const sessionDir = path.join(tmpHome, 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });
    // Two cumulative token_count entries; the last one is the session total
    const lines = [
      tokenCountLine({ tsMs: PHASE_START + 100, input: 10, output: 5, cacheRead: 2 }),
      // Second entry is cumulative: input=30, output=15, cacheRead=2, total=45
      tokenCountLine({ tsMs: PHASE_START + 200, input: 30, output: 15, cacheRead: 2 }),
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(sessionDir, `${SESSION_ID}.jsonl`), lines);

    const result = await readCodexSessionUsage({
      sessionId: SESSION_ID,
      codexHome: tmpHome,
      phaseStartTs: PHASE_START,
    });
    expect(result?.tokens).toEqual({ input: 30, output: 15, cacheRead: 2, cacheCreate: 0, total: 47 });
    expect(result?.sessionId).toBe(SESSION_ID);
  });

  it('returns null when file missing', async () => {
    const result = await readCodexSessionUsage({
      sessionId: 'nonexistent',
      codexHome: tmpHome,
      phaseStartTs: PHASE_START,
    });
    expect(result).toBeNull();
  });

  it('returns null when total tokens is zero (no token_count lines)', async () => {
    const sessionDir = path.join(tmpHome, 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, `${SESSION_ID}.jsonl`),
      JSON.stringify({ type: 'session_meta', sessionId: SESSION_ID }) + '\n');
    const result = await readCodexSessionUsage({
      sessionId: SESSION_ID,
      codexHome: tmpHome,
      phaseStartTs: PHASE_START,
    });
    expect(result).toBeNull();
  });
});

describe('readCodexSessionUsage — no sessionId (scan fallback)', () => {
  const PHASE_START = 1_750_000_000_000;
  let tmpHome: string;
  let stderrSpy: any;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-usage-test-'));
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('picks most-recently-written session after phaseStartTs', async () => {
    const sessionDir = path.join(tmpHome, 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });
    // Write two sessions; second is newer
    const old = path.join(sessionDir, 'aaaa-old.jsonl');
    const newer = path.join(sessionDir, 'bbbb-new.jsonl');
    fs.writeFileSync(old, tokenCountLine({ tsMs: PHASE_START + 10, input: 1, output: 1 }) + '\n');
    fs.writeFileSync(newer, tokenCountLine({ tsMs: PHASE_START + 200, input: 99, output: 1 }) + '\n');
    // Make newer actually newer by touching mtimes
    const oldMtime = new Date(PHASE_START - 100);
    const newMtime = new Date(PHASE_START + 300);
    fs.utimesSync(old, oldMtime, oldMtime);
    fs.utimesSync(newer, newMtime, newMtime);

    const result = await readCodexSessionUsage({
      sessionId: null,
      codexHome: tmpHome,
      phaseStartTs: PHASE_START,
    });
    expect(result?.sessionId).toBe('bbbb-new');
  });

  it('returns null when sessions dir missing', async () => {
    const result = await readCodexSessionUsage({
      sessionId: null,
      codexHome: tmpHome,
      phaseStartTs: PHASE_START,
    });
    expect(result).toBeNull();
  });
});
