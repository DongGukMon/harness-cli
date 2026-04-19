import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { SessionLogger, LogEvent, SessionMeta, HarnessState, DistributiveOmit } from './types.js';

export function computeRepoKey(harnessDir: string): string {
  return createHash('sha1').update(harnessDir).digest('hex').slice(0, 12);
}

export class NoopLogger implements SessionLogger {
  logEvent(_event: DistributiveOmit<LogEvent, 'v' | 'ts' | 'runId'>): void { /* no-op */ }
  writeMeta(_partial: Partial<SessionMeta> & { task: string }): void { /* no-op */ }
  updateMeta(_update: { pushResumedAt?: number; task?: string; codexHome?: string }): void { /* no-op */ }
  finalizeSummary(_state: HarnessState): void { /* no-op */ }
  close(): void { /* no-op */ }
  hasBootstrapped(): boolean { return true; }
  hasEmittedSessionOpen(): boolean { return true; }
  getStartedAt(): number { return Date.now(); }
  getEventsPath(): string | null { return null; }
}

export interface FileSessionLoggerOptions {
  sessionsRoot?: string;   // default: ~/.harness/sessions
  harnessVersion?: string;
  cwd?: string;
  autoMode?: boolean;
  gitBranch?: string;
  baseCommit?: string;
}

export class FileSessionLogger implements SessionLogger {
  private runId: string;
  private harnessDir: string;
  private sessionDir: string;
  private metaPath: string;
  private eventsPath: string;
  private summaryPath: string;
  private options: FileSessionLoggerOptions;
  private bootstrapped = false;
  private sessionOpenEmitted = false;
  private warned = false;
  private disabled = false;
  private cachedStartedAt: number | null = null;

  constructor(runId: string, harnessDir: string, options: FileSessionLoggerOptions = {}) {
    this.runId = runId;
    this.harnessDir = harnessDir;
    this.options = options;
    const sessionsRoot = options.sessionsRoot ?? path.join(os.homedir(), '.harness', 'sessions');
    const repoKey = computeRepoKey(harnessDir);
    this.sessionDir = path.join(sessionsRoot, repoKey, runId);
    this.metaPath = path.join(this.sessionDir, 'meta.json');
    this.eventsPath = path.join(this.sessionDir, 'events.jsonl');
    this.summaryPath = path.join(this.sessionDir, 'summary.json');

    try {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    } catch (err) {
      this.warnOnce(`session logger: mkdir failed — ${(err as Error).message}`);
      this.disabled = true;
      return;
    }

    if (fs.existsSync(this.metaPath)) {
      this.bootstrapped = true;
      try {
        const m = JSON.parse(fs.readFileSync(this.metaPath, 'utf-8')) as SessionMeta;
        this.cachedStartedAt = m.startedAt ?? null;
      } catch { /* ignore malformed meta */ }
    }
  }

  hasBootstrapped(): boolean { return this.bootstrapped; }
  hasEmittedSessionOpen(): boolean { return this.sessionOpenEmitted; }
  getStartedAt(): number { return this.cachedStartedAt ?? Date.now(); }
  getEventsPath(): string | null { return this.eventsPath; }

  writeMeta(partial: Partial<SessionMeta> & { task: string }): void {
    if (this.disabled) return;
    try {
      const now = Date.now();
      const meta: SessionMeta = {
        v: 1,
        runId: this.runId,
        repoKey: computeRepoKey(this.harnessDir),
        harnessDir: this.harnessDir,
        cwd: this.options.cwd ?? process.cwd(),
        gitBranch: this.options.gitBranch,
        task: partial.task,
        startedAt: partial.startedAt ?? now,
        autoMode: partial.autoMode ?? this.options.autoMode ?? false,
        harnessVersion: partial.harnessVersion ?? this.options.harnessVersion ?? '0.1.0',
        resumedAt: partial.resumedAt ?? [],
        ...(partial.bootstrapOnResume ? { bootstrapOnResume: true } : {}),
        ...(partial.codexHome !== undefined ? { codexHome: partial.codexHome } : {}),
      };
      fs.writeFileSync(this.metaPath, JSON.stringify(meta, null, 2));
      this.bootstrapped = true;
      this.cachedStartedAt = meta.startedAt;
    } catch (err) {
      this.warnOnce(`session logger: writeMeta failed — ${(err as Error).message}`);
      this.disabled = true;
    }
  }

  updateMeta(update: { pushResumedAt?: number; task?: string; codexHome?: string }): void {
    if (this.disabled) return;
    try {
      let meta: SessionMeta;
      if (fs.existsSync(this.metaPath)) {
        meta = JSON.parse(fs.readFileSync(this.metaPath, 'utf-8')) as SessionMeta;
      } else {
        // §5.1 bootstrap rule: resume without meta.json → create with bootstrapOnResume marker
        const now = Date.now();
        meta = {
          v: 1,
          runId: this.runId,
          repoKey: computeRepoKey(this.harnessDir),
          harnessDir: this.harnessDir,
          cwd: this.options.cwd ?? process.cwd(),
          gitBranch: this.options.gitBranch,
          task: update.task ?? '',
          startedAt: now,
          autoMode: this.options.autoMode ?? false,
          harnessVersion: this.options.harnessVersion ?? '0.1.0',
          resumedAt: [],
          bootstrapOnResume: true,
          ...(update.codexHome !== undefined ? { codexHome: update.codexHome } : {}),
        };
      }
      if (update.pushResumedAt !== undefined) meta.resumedAt = [...(meta.resumedAt ?? []), update.pushResumedAt];
      if (update.task !== undefined && !meta.task) meta.task = update.task;
      if (update.codexHome !== undefined) meta.codexHome = update.codexHome;
      fs.writeFileSync(this.metaPath, JSON.stringify(meta, null, 2));
      this.bootstrapped = true;
      this.cachedStartedAt = meta.startedAt;
    } catch (err) {
      this.warnOnce(`session logger: updateMeta failed — ${(err as Error).message}`);
      this.disabled = true;
    }
  }

  logEvent(event: DistributiveOmit<LogEvent, 'v' | 'ts' | 'runId'>): void {
    if (this.disabled) return;
    try {
      const fullEvent = { v: 1, ts: Date.now(), runId: this.runId, ...event };
      fs.appendFileSync(this.eventsPath, JSON.stringify(fullEvent) + '\n');
      if ((event as any).event === 'session_start' || (event as any).event === 'session_resumed') {
        this.sessionOpenEmitted = true;
      }
    } catch (err) {
      this.warnOnce(`session logger: appendFileSync failed — ${(err as Error).message}`);
      this.disabled = true;
    }
  }

  finalizeSummary(state: HarnessState): void {
    if (this.disabled) return;
    try {
      const events = this.readEvents();
      if (events.length === 0) return;

      const startedAt = this.getStartedAt();
      // Find LAST session_end (resumed runs append multiple; latest is authoritative)
      const sessionEndEvent = [...events].reverse().find(e => e.event === 'session_end') as any;
      const status = sessionEndEvent ? sessionEndEvent.status : 'interrupted';
      const endedAt = sessionEndEvent ? sessionEndEvent.ts : events[events.length - 1].ts;
      const totalWallMs = sessionEndEvent ? sessionEndEvent.totalWallMs : (endedAt - startedAt);

      // Build phase_start map by (phase, attemptId) for phase_end pairing
      const phaseStartMap = new Map<string, any>();
      for (const e of events) {
        if (e.event === 'phase_start' && e.attemptId) {
          phaseStartMap.set(`${e.phase}:${e.attemptId}`, e);
        }
      }

      const phases: Record<string, any> = {};
      const seenVerdictKeys = new Set<string>();
      const seenErrorPhases = new Set<number>();
      let gateTokens = 0, gateRejects = 0, gateErrors = 0, escalations = 0, verifyFailures = 0, forcePasses = 0;

      // First pass: collect authoritative event keys
      for (const e of events) {
        if ((e.event === 'gate_verdict' || e.event === 'gate_error') && !e.recoveredFromSidecar) {
          if (e.event === 'gate_verdict') seenVerdictKeys.add(`${e.phase}:${e.retryIndex}`);
          if (e.event === 'gate_error') seenErrorPhases.add(e.phase);
        }
      }

      for (const e of events) {
        const pstr = String((e as any).phase ?? '');
        if (pstr && !phases[pstr]) phases[pstr] = { attempts: [], totalDurationMs: 0 };

        if (e.event === 'phase_end') {
          const startEvent = e.attemptId ? phaseStartMap.get(`${e.phase}:${e.attemptId}`) : null;
          phases[pstr].attempts.push({
            attemptId: e.attemptId ?? null,
            startedAt: startEvent ? startEvent.ts : (e.ts - (e.durationMs ?? 0)),
            durationMs: e.durationMs,
            status: e.status,
            reopenFromGate: startEvent?.reopenFromGate ?? null,
          });
          phases[pstr].totalDurationMs += (e.durationMs ?? 0);
        } else if (e.event === 'gate_verdict') {
          const key = `${e.phase}:${e.retryIndex}`;
          if (e.recoveredFromSidecar && seenVerdictKeys.has(key)) continue;
          phases[pstr].attempts.push({
            retryIndex: e.retryIndex,
            startedAt: e.ts - (e.durationMs ?? 0),
            durationMs: e.durationMs,
            runner: e.runner,
            verdict: e.verdict,
            tokensTotal: e.tokensTotal,
          });
          phases[pstr].totalDurationMs += (e.durationMs ?? 0);
          if (e.tokensTotal) gateTokens += e.tokensTotal;
          if (e.verdict === 'REJECT') gateRejects++;
        } else if (e.event === 'gate_error') {
          if (e.recoveredFromSidecar && seenErrorPhases.has(e.phase)) continue;
          gateErrors++;
          if (e.tokensTotal) gateTokens += e.tokensTotal;
        } else if (e.event === 'escalation') {
          escalations++;
        } else if (e.event === 'force_pass') {
          forcePasses++;
        } else if (e.event === 'verify_result' && !e.passed) {
          verifyFailures++;
        }
      }

      const summary = {
        v: 1,
        runId: this.runId,
        repoKey: computeRepoKey(this.harnessDir),
        startedAt,
        endedAt,
        totalWallMs,
        status,
        autoMode: state.autoMode,
        phases,
        totals: { gateTokens, gateRejects, gateErrors, escalations, verifyFailures, forcePasses },
      };

      const tmpPath = this.summaryPath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(summary, null, 2));
      fs.renameSync(tmpPath, this.summaryPath);
    } catch (err) {
      // Spec §6.1: summary.json write failure → warn and retry on next phase.
      // Do NOT set this.disabled = true; event logging should remain active.
      this.warnOnce(`session logger: finalizeSummary failed — ${(err as Error).message}`);
    }
  }

  private readEvents(): any[] {
    if (!fs.existsSync(this.eventsPath)) return [];
    const raw = fs.readFileSync(this.eventsPath, 'utf-8');
    return raw.trim().split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  }

  close(): void { /* currently no-op */ }

  private warnOnce(msg: string): void {
    if (!this.warned) {
      process.stderr.write(`${msg}\n`);
      this.warned = true;
    }
  }
}

export function createSessionLogger(
  runId: string,
  harnessDir: string,
  loggingEnabled: boolean,
  options: FileSessionLoggerOptions = {},
): SessionLogger {
  if (!loggingEnabled) return new NoopLogger();
  return new FileSessionLogger(runId, harnessDir, options);
}
