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
  const totalWallMs: number = endedAt - startedAt;

  const runId: string        = (sessionStarts[0] ?? events[0])?.runId ?? 'unknown';
  const harnessVersion       = sessionStarts[0]?.harnessVersion ?? null;
  const autoMode: boolean    = sessionStarts[0]?.autoMode ?? false;

  // ── 3. Status derivation ───────────────────────────────────────────────────
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

  // ── 4. Sidecar deduplication ──────────────────────────────────────────────
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
