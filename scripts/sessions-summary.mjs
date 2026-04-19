#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import os from 'os';

const SESSIONS_ROOT = process.env.HARNESS_SESSIONS_ROOT
  ?? path.join(os.homedir(), '.harness', 'sessions');

const args = process.argv.slice(2);
const sinceDaysIdx = args.indexOf('--since-days');
const sinceDays = sinceDaysIdx >= 0 ? Number(args[sinceDaysIdx + 1]) : 14;
const sinceMs = Date.now() - sinceDays * 24 * 60 * 60 * 1000;

if (!fs.existsSync(SESSIONS_ROOT)) {
  console.error(`No sessions root at ${SESSIONS_ROOT}`);
  process.exit(0);
}

const stats = {
  totalSessions: 0,
  sessionsWithEvents: 0,
  endStatuses: { completed: 0, paused: 0, interrupted: 0 },
  phaseFailures: 0,
  terminalActions: { resume: 0, jump: 0, quit: 0 },
  uiRenderTotal: 0,
};

function scanSession(jsonlPath, mtimeMs) {
  if (mtimeMs < sinceMs) return;
  stats.totalSessions += 1;
  const raw = fs.readFileSync(jsonlPath, 'utf-8');
  const lines = raw.split('\n').filter(Boolean);
  if (lines.length === 0) return;
  stats.sessionsWithEvents += 1;
  for (const line of lines) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.event === 'session_end' && stats.endStatuses[ev.status] !== undefined) {
      stats.endStatuses[ev.status] += 1;
    }
    if (ev.event === 'phase_end' && ev.status === 'failed') stats.phaseFailures += 1;
    if (ev.event === 'terminal_action' && stats.terminalActions[ev.action] !== undefined) {
      stats.terminalActions[ev.action] += 1;
    }
    if (ev.event === 'ui_render') stats.uiRenderTotal += 1;
  }
}

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = fs.statSync(abs);
    if (st.isDirectory()) walk(abs);
    else if (name === 'events.jsonl') scanSession(abs, st.mtimeMs);
  }
}

walk(SESSIONS_ROOT);

console.log(`Sessions in last ${sinceDays} days: ${stats.totalSessions} total, ${stats.sessionsWithEvents} with events`);
console.log(`session_end statuses:`);
for (const [k, v] of Object.entries(stats.endStatuses)) console.log(`  ${k}: ${v}`);
console.log(`phase_end status=failed: ${stats.phaseFailures}`);
console.log(`terminal_action counts: resume=${stats.terminalActions.resume}, jump=${stats.terminalActions.jump}, quit=${stats.terminalActions.quit}`);
console.log(`ui_render events: ${stats.uiRenderTotal}`);
