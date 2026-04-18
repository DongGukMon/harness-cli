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
  updateMeta(_update: { pushResumedAt?: number; task?: string }): void { /* no-op */ }
  finalizeSummary(_state: HarnessState): void { /* no-op */ }
  close(): void { /* no-op */ }
  hasBootstrapped(): boolean { return true; }
  hasEmittedSessionOpen(): boolean { return true; }
  getStartedAt(): number { return Date.now(); }
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
      };
      fs.writeFileSync(this.metaPath, JSON.stringify(meta, null, 2));
      this.bootstrapped = true;
      this.cachedStartedAt = meta.startedAt;
    } catch (err) {
      this.warnOnce(`session logger: writeMeta failed — ${(err as Error).message}`);
      this.disabled = true;
    }
  }

  updateMeta(update: { pushResumedAt?: number; task?: string }): void {
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
        };
      }
      if (update.pushResumedAt !== undefined) meta.resumedAt = [...(meta.resumedAt ?? []), update.pushResumedAt];
      if (update.task !== undefined && !meta.task) meta.task = update.task;
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

  finalizeSummary(_state: HarnessState): void {
    // Implemented in Task 8
  }

  close(): void { /* currently no-op */ }

  private warnOnce(msg: string): void {
    if (!this.warned) {
      process.stderr.write(`${msg}\n`);
      this.warned = true;
    }
  }
}
