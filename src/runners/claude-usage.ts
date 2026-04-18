import fs from 'fs';
import path from 'path';
import os from 'os';
import type { ClaudeTokens } from '../types.js';

const NON_ALNUM_RE = /[^a-zA-Z0-9]/g;

export function encodeProjectDir(cwd: string): string {
  return cwd.replace(NON_ALNUM_RE, '-');
}

export interface ReadClaudeSessionUsageInput {
  sessionId: string;
  cwd: string;
  phaseStartTs: number;
  homeDir?: string;
}

interface ParseOutcome {
  tokens: ClaudeTokens;
  skippedLines: number;
}

function zeroTokens(): ClaudeTokens {
  return { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, total: 0 };
}

function toNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function parseSessionFile(absPath: string): ParseOutcome {
  const raw = fs.readFileSync(absPath, 'utf-8');
  const tokens = zeroTokens();
  let skipped = 0;
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }
    if (!entry || entry.type !== 'assistant') continue;
    const usage = entry?.message?.usage;
    if (!usage || typeof usage !== 'object') continue;
    tokens.input += toNumber(usage.input_tokens);
    tokens.output += toNumber(usage.output_tokens);
    tokens.cacheRead += toNumber(usage.cache_read_input_tokens);
    tokens.cacheCreate += toNumber(usage.cache_creation_input_tokens);
  }
  tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreate;
  return { tokens, skippedLines: skipped };
}

function firstAssistantTs(absPath: string): number | null {
  const raw = fs.readFileSync(absPath, 'utf-8');
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type !== 'assistant') continue;
    const ts = entry.timestamp;
    if (typeof ts !== 'string') continue;
    const ms = Date.parse(ts);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

function warn(msg: string): void {
  process.stderr.write(`[harness.claudeUsage] ${msg}\n`);
}

export function readClaudeSessionUsage(input: ReadClaudeSessionUsageInput): ClaudeTokens | null {
  const { sessionId, cwd, phaseStartTs } = input;
  const homeDir = input.homeDir ?? os.homedir();
  const projectDir = path.join(homeDir, '.claude', 'projects', encodeProjectDir(cwd));
  const pinnedPath = path.join(projectDir, `${sessionId}.jsonl`);

  if (fs.existsSync(pinnedPath)) {
    try {
      const { tokens, skippedLines } = parseSessionFile(pinnedPath);
      if (skippedLines > 0) warn(`skipped ${skippedLines} malformed line(s) in ${pinnedPath}`);
      return tokens;
    } catch (err) {
      warn(`failed to read pinned session ${pinnedPath}: ${(err as Error).message}`);
      return null;
    }
  }

  // Fallback: enumerate project dir, pick earliest-eligible (then lexical tiebreak)
  let entries: string[];
  try {
    entries = fs.readdirSync(projectDir);
  } catch (err) {
    warn(`project dir unreadable ${projectDir}: ${(err as Error).message}`);
    return null;
  }

  const candidates: Array<{ file: string; ts: number }> = [];
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue;
    const absPath = path.join(projectDir, name);
    let ts: number | null;
    try {
      ts = firstAssistantTs(absPath);
    } catch {
      // per-file hard read error inside scan: skip this file (best-effort)
      continue;
    }
    if (ts === null) continue;
    if (ts < phaseStartTs) continue;
    candidates.push({ file: name, ts });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    return a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
  });
  const winner = candidates[0];
  try {
    const { tokens, skippedLines } = parseSessionFile(path.join(projectDir, winner.file));
    if (skippedLines > 0) warn(`skipped ${skippedLines} malformed line(s) in ${winner.file}`);
    return tokens;
  } catch (err) {
    warn(`fallback read failed ${winner.file}: ${(err as Error).message}`);
    return null;
  }
}
