import fs from 'fs';
import path from 'path';
import type { ClaudeTokens } from '../types.js';

export interface CodexSessionResult {
  tokens: ClaudeTokens;
  sessionId: string;
}

export interface ReadCodexSessionUsageInput {
  sessionId: string | null;
  codexHome: string;
  phaseStartTs: number;
}

export function codexSessionJsonlPath(sessionId: string, codexHome: string): string {
  return path.join(codexHome, 'sessions', `${sessionId}.jsonl`);
}

function warn(msg: string): void {
  process.stderr.write(`[harness.codexUsage] ${msg}\n`);
}

function zeroTokens(): ClaudeTokens {
  return { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, total: 0 };
}

function toNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function parseSessionFile(absPath: string): { tokens: ClaudeTokens; skippedLines: number } {
  const raw = fs.readFileSync(absPath, 'utf-8');
  let lastUsage: { input_tokens: number; cached_input_tokens: number; output_tokens: number; total_tokens: number } | null = null;
  let skipped = 0;
  // Codex CLI 0.124.0: token_count events carry cumulative totals for the session.
  // Taking the last entry gives the session total.
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let entry: any;
    try { entry = JSON.parse(line); } catch { skipped++; continue; }
    if (entry?.type !== 'event_msg') continue;
    const payload = entry?.payload;
    if (payload?.type !== 'token_count') continue;
    const info = payload?.info;
    if (!info?.total_token_usage) continue;
    lastUsage = info.total_token_usage;
  }
  if (!lastUsage) {
    return { tokens: zeroTokens(), skippedLines: skipped };
  }
  const tokens: ClaudeTokens = {
    input: toNumber(lastUsage.input_tokens),
    output: toNumber(lastUsage.output_tokens),
    cacheRead: toNumber(lastUsage.cached_input_tokens),
    cacheCreate: 0, // Codex 0.124.0 emits no cache-creation counter
    total: 0,
  };
  tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreate;
  return { tokens, skippedLines: skipped };
}

const BACKOFF_DELAYS = [100, 100, 100]; // ms × 3 retries (R-D3)

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function readWithBackoff(absPath: string): Promise<{ tokens: ClaudeTokens; skippedLines: number } | null> {
  for (let i = 0; i <= BACKOFF_DELAYS.length; i++) {
    if (fs.existsSync(absPath)) {
      try {
        return parseSessionFile(absPath);
      } catch (err) {
        warn(`failed to read ${absPath}: ${(err as Error).message}`);
        return null;
      }
    }
    if (i < BACKOFF_DELAYS.length) await sleep(BACKOFF_DELAYS[i]);
  }
  return null;
}

export async function readCodexSessionUsage(
  input: ReadCodexSessionUsageInput,
): Promise<CodexSessionResult | null> {
  const { sessionId, codexHome, phaseStartTs } = input;
  const sessionsDir = path.join(codexHome, 'sessions');

  if (sessionId !== null) {
    const absPath = codexSessionJsonlPath(sessionId, codexHome);
    const outcome = await readWithBackoff(absPath);
    if (!outcome) return null;
    if (outcome.skippedLines > 0) warn(`skipped ${outcome.skippedLines} malformed line(s) in ${absPath}`);
    if (outcome.tokens.total === 0) return null;
    return { tokens: outcome.tokens, sessionId };
  }

  // Scan fallback: pick the most-recently-modified .jsonl file whose mtime >= phaseStartTs
  let entries: string[];
  try {
    entries = fs.readdirSync(sessionsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      warn(`sessions dir unreadable ${sessionsDir}: ${(err as Error).message}`);
    }
    return null;
  }

  const candidates: Array<{ name: string; mtime: number }> = [];
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue;
    try {
      const stat = fs.statSync(path.join(sessionsDir, name));
      if (stat.mtimeMs >= phaseStartTs) candidates.push({ name, mtime: stat.mtimeMs });
    } catch { /* skip */ }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name));

  const winner = candidates[0];
  const absPath = path.join(sessionsDir, winner.name);
  const outcome = await readWithBackoff(absPath);
  if (!outcome) return null;
  if (outcome.skippedLines > 0) warn(`skipped ${outcome.skippedLines} malformed line(s) in ${winner.name}`);
  if (outcome.tokens.total === 0) return null;
  return {
    tokens: outcome.tokens,
    sessionId: winner.name.replace(/\.jsonl$/, ''),
  };
}
