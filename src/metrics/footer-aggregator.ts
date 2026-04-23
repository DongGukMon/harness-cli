import fs from 'fs';
import { TERMINAL_PHASE } from '../config.js';
import type { LogEvent, PhaseStatus } from '../types.js';

const INTERACTIVE_PHASES = new Set([1, 3, 5]);
const GATE_PHASES = new Set([2, 4, 7]);

export interface FooterStateSlice {
  currentPhase: number;
  gateRetries: Record<string, number>;
  phaseStatus: PhaseStatus;
}

export interface FooterSummary {
  currentPhase: number;
  attempt: number;
  phaseRunningElapsedMs: number | null;
  sessionElapsedMs: number;
  claudeTokens: number;
  gateTokens: number;
  totalTokens: number;
}

export function readEventsJsonl(path: string): LogEvent[] {
  if (!fs.existsSync(path)) return [];

  const raw = fs.readFileSync(path, 'utf-8');
  if (raw.trim().length === 0) return [];

  return raw
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line) as LogEvent;
      } catch {
        return null;
      }
    })
    .filter((event): event is LogEvent => event !== null);
}

export function readStateSlice(stateJsonPath: string): FooterStateSlice | null {
  try {
    const raw = JSON.parse(fs.readFileSync(stateJsonPath, 'utf-8')) as {
      currentPhase?: unknown;
      gateRetries?: unknown;
      phases?: unknown;
    };

    if (!isLivePhase(raw.currentPhase)) return null;
    if (!isNumberRecord(raw.gateRetries)) return null;
    if (!isPhaseRecord(raw.phases)) return null;

    const phaseStatus = raw.phases[String(raw.currentPhase)];
    if (!isPhaseStatus(phaseStatus)) return null;

    return {
      currentPhase: raw.currentPhase,
      gateRetries: raw.gateRetries,
      phaseStatus,
    };
  } catch {
    return null;
  }
}

export function aggregateFooter(
  events: LogEvent[],
  stateSlice: FooterStateSlice,
  now: number,
): FooterSummary | null {
  const sessionOpenIndex = findLatestSessionOpenIndex(events);
  if (sessionOpenIndex === -1) return null;

  const sessionEvents = events.slice(sessionOpenIndex);
  const sessionOpen = sessionEvents[0];
  const currentPhase = stateSlice.currentPhase;
  const attempt = getAttempt(sessionEvents, stateSlice);
  const phaseRunningElapsedMs = getPhaseRunningElapsedMs(events, sessionEvents, stateSlice, now);
  const { claudeTokens, gateTokens } = getTokenTotals(events);

  return {
    currentPhase,
    attempt,
    phaseRunningElapsedMs,
    sessionElapsedMs: Math.max(now - sessionOpen.ts, 0),
    claudeTokens,
    gateTokens,
    totalTokens: claudeTokens + gateTokens,
  };
}

function findLatestSessionOpenIndex(events: LogEvent[]): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.event === 'session_start' || event.event === 'session_resumed') {
      return index;
    }
  }
  return -1;
}

function getAttempt(sessionEvents: LogEvent[], stateSlice: FooterStateSlice): number {
  const currentPhase = stateSlice.currentPhase;

  if (GATE_PHASES.has(currentPhase)) {
    return (stateSlice.gateRetries[String(currentPhase)] ?? 0) + 1;
  }

  const starts = sessionEvents.filter(
    (event): event is Extract<LogEvent, { event: 'phase_start' }> =>
      event.event === 'phase_start' && event.phase === currentPhase,
  );

  return Math.max(starts.length, 1);
}

function getPhaseRunningElapsedMs(
  allEvents: LogEvent[],
  sessionEvents: LogEvent[],
  stateSlice: FooterStateSlice,
  now: number,
): number | null {
  const currentPhase = stateSlice.currentPhase;

  if (GATE_PHASES.has(currentPhase)) {
    if (stateSlice.phaseStatus !== 'in_progress') {
      return null;
    }

    const lastEvent = sessionEvents[sessionEvents.length - 1];
    if (
      lastEvent &&
      (lastEvent.event === 'gate_verdict' || lastEvent.event === 'gate_error') &&
      lastEvent.phase === currentPhase
    ) {
      return null;
    }

    const startTs = lastEvent?.ts ?? sessionEvents[0].ts;
    return Math.max(now - startTs, 0);
  }

  if (currentPhase === 6) {
    return getPhase6Elapsed(sessionEvents, now);
  }

  if (INTERACTIVE_PHASES.has(currentPhase)) {
    return getInteractiveElapsed(allEvents, sessionEvents, currentPhase, now);
  }

  return null;
}

function getInteractiveElapsed(
  allEvents: LogEvent[],
  sessionEvents: LogEvent[],
  currentPhase: number,
  now: number,
): number | null {
  const starts = sessionEvents.filter(
    (event): event is Extract<LogEvent, { event: 'phase_start' }> =>
      event.event === 'phase_start' && event.phase === currentPhase,
  );
  const lastStart = starts[starts.length - 1];
  if (!lastStart) return null;

  let matchingEnd: Extract<LogEvent, { event: 'phase_end' }> | undefined;
  for (let index = allEvents.length - 1; index >= 0; index -= 1) {
    const event = allEvents[index];
    if (
      event.event === 'phase_end' &&
      event.phase === currentPhase &&
      event.attemptId === lastStart.attemptId &&
      event.ts > lastStart.ts
    ) {
      matchingEnd = event;
      break;
    }
  }

  return matchingEnd ? null : Math.max(now - lastStart.ts, 0);
}

function getPhase6Elapsed(sessionEvents: LogEvent[], now: number): number | null {
  const starts = sessionEvents.filter(
    (event): event is Extract<LogEvent, { event: 'phase_start' }> =>
      event.event === 'phase_start' && event.phase === 6,
  );
  const ends = sessionEvents.filter(
    (event): event is Extract<LogEvent, { event: 'phase_end' }> =>
      event.event === 'phase_end' && event.phase === 6,
  );

  if (starts.length === 0 || starts.length <= ends.length) {
    return null;
  }

  const unmatchedStart = starts[ends.length];
  return Math.max(now - unmatchedStart.ts, 0);
}

function getTokenTotals(events: LogEvent[]): { claudeTokens: number; gateTokens: number } {
  const authoritativeVerdicts = new Set<string>();
  const authoritativeErrors = new Set<number>();

  for (const event of events) {
    if (event.event === 'gate_verdict' && event.recoveredFromSidecar !== true) {
      authoritativeVerdicts.add(makeVerdictKey(event.phase, event.retryIndex));
    }
    if (event.event === 'gate_error' && event.recoveredFromSidecar !== true) {
      authoritativeErrors.add(event.phase);
    }
  }

  let claudeTokens = 0;
  let gateTokens = 0;

  for (const event of events) {
    if (event.event === 'phase_end') {
      const total = event.claudeTokens?.total;
      if (typeof total === 'number') {
        claudeTokens += total;
      }
      continue;
    }

    if (event.event === 'gate_verdict') {
      if (
        event.recoveredFromSidecar === true &&
        authoritativeVerdicts.has(makeVerdictKey(event.phase, event.retryIndex))
      ) {
        continue;
      }
      if (typeof event.tokensTotal === 'number') {
        gateTokens += event.tokensTotal;
      }
      continue;
    }

    if (event.event === 'gate_error') {
      if (event.recoveredFromSidecar === true && authoritativeErrors.has(event.phase)) {
        continue;
      }
      if (typeof event.tokensTotal === 'number') {
        gateTokens += event.tokensTotal;
      }
    }
  }

  return { claudeTokens, gateTokens };
}

function makeVerdictKey(phase: number, retryIndex: number): string {
  return `${phase}:${retryIndex}`;
}

function isLivePhase(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value < TERMINAL_PHASE;
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every(entry => typeof entry === 'number');
}

function isPhaseRecord(value: unknown): value is Record<string, PhaseStatus> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every(isPhaseStatus);
}

function isPhaseStatus(value: unknown): value is PhaseStatus {
  return value === 'pending'
    || value === 'in_progress'
    || value === 'completed'
    || value === 'failed'
    || value === 'error'
    || value === 'skipped';
}

// --- Footer formatting ---

export function formatFooter(summary: FooterSummary, columns: number): string {
  if (typeof columns !== 'number' || columns <= 0) return '';
  const phaseElapsed = formatPhaseDuration(summary.phaseRunningElapsedMs ?? 0, columns);
  const sessionElapsed = formatDuration(summary.sessionElapsedMs, columns >= 80);
  if (summary.currentPhase === 6) {
    return columns >= 80
      ? `P6 · ${phaseElapsed} phase · ${sessionElapsed} session`
      : `P6 · ${phaseElapsed} / ${sessionElapsed}`;
  }
  const totalTokens = formatTokenMillions(summary.totalTokens);
  if (columns >= 80) {
    const claudeTokens = formatTokenMillions(summary.claudeTokens);
    const gateTokens = formatTokenMillions(summary.gateTokens);
    return `P${summary.currentPhase} attempt ${summary.attempt} · ${phaseElapsed} phase · ${sessionElapsed} session · ${totalTokens} tok (${claudeTokens} Claude + ${gateTokens} gate)`;
  }
  return `P${summary.currentPhase} a${summary.attempt} · ${phaseElapsed} / ${sessionElapsed} · ${totalTokens} tok`;
}

function formatPhaseDuration(elapsedMs: number, columns: number): string {
  return formatDuration(elapsedMs, columns >= 80);
}

function formatDuration(elapsedMs: number, wide: boolean): string {
  const totalSeconds = Math.max(Math.floor(elapsedMs / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = String(seconds).padStart(2, '0');
  return wide ? `${minutes}m ${paddedSeconds}s` : `${minutes}m${paddedSeconds}s`;
}

function formatTokenMillions(tokens: number): string {
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}
