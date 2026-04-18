import { describe, it, expect } from 'vitest';
import { computeRepoKey, NoopLogger, FileSessionLogger, createSessionLogger } from '../src/logger.js';
import type { HarnessState } from '../src/types.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

function makeTempHarnessDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'logger-test-'));
}

describe('computeRepoKey', () => {
  it('returns 12-char hex for given input', () => {
    const key = computeRepoKey('/path/to/repo/.harness');
    expect(key).toMatch(/^[0-9a-f]{12}$/);
  });

  it('returns same output for same input', () => {
    const a = computeRepoKey('/some/path');
    const b = computeRepoKey('/some/path');
    expect(a).toBe(b);
  });

  it('returns different output for different input', () => {
    const a = computeRepoKey('/path/a');
    const b = computeRepoKey('/path/b');
    expect(a).not.toBe(b);
  });
});

describe('NoopLogger', () => {
  it('all methods are no-op and do not throw', () => {
    const logger = new NoopLogger();
    expect(() => logger.logEvent({ event: 'session_start', task: 't', autoMode: false, baseCommit: '', harnessVersion: '', phase: 1 })).not.toThrow();
    expect(() => logger.writeMeta({ task: 't' })).not.toThrow();
    expect(() => logger.updateMeta({ pushResumedAt: 1 })).not.toThrow();
    expect(() => logger.finalizeSummary({} as HarnessState)).not.toThrow();
    expect(() => logger.close()).not.toThrow();
  });

  it('hasBootstrapped and hasEmittedSessionOpen always return true', () => {
    const logger = new NoopLogger();
    expect(logger.hasBootstrapped()).toBe(true);
    expect(logger.hasEmittedSessionOpen()).toBe(true);
  });

  it('getStartedAt returns a current-ish timestamp', () => {
    const logger = new NoopLogger();
    const ts = logger.getStartedAt();
    expect(ts).toBeGreaterThan(Date.now() - 1000);
    expect(ts).toBeLessThanOrEqual(Date.now());
  });
});

describe('FileSessionLogger — constructor + meta.json + bootstrap flags', () => {
  it('hasBootstrapped=false initially; true after writeMeta', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('run1', harnessDir, { sessionsRoot });
    expect(logger.hasBootstrapped()).toBe(false);
    expect(logger.hasEmittedSessionOpen()).toBe(false);
    logger.writeMeta({ task: 'test task' });
    expect(logger.hasBootstrapped()).toBe(true);
  });

  it('hasBootstrapped=true immediately if meta.json exists on disk', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger1 = new FileSessionLogger('run2', harnessDir, { sessionsRoot });
    logger1.writeMeta({ task: 'first' });

    const logger2 = new FileSessionLogger('run2', harnessDir, { sessionsRoot });
    expect(logger2.hasBootstrapped()).toBe(true);
    expect(logger2.hasEmittedSessionOpen()).toBe(false);  // still false in new process
  });

  it('getStartedAt returns meta.startedAt after writeMeta', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('run4', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    const ts = logger.getStartedAt();
    expect(ts).toBeGreaterThan(Date.now() - 1000);
    expect(ts).toBeLessThanOrEqual(Date.now());
  });

  it('mkdirSync failure in constructor: logger becomes disabled (no-op all methods)', () => {
    const origMkdir = fs.mkdirSync;
    (fs as any).mkdirSync = () => { throw new Error('EACCES'); };
    const stderrCalls: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as any).write = (s: string) => { stderrCalls.push(s); return true; };
    try {
      const logger = new FileSessionLogger('runM', '/fake', { sessionsRoot: '/nope' });
      expect(logger.hasBootstrapped()).toBe(false);
      const warnsAfterConstructor = stderrCalls.length;
      logger.writeMeta({ task: 't' });
      logger.logEvent({ event: 'phase_start', phase: 1 });
      logger.finalizeSummary({ status: 'completed', autoMode: false } as any);
      // disabled swallows silently — no further warnings
      expect(stderrCalls.length).toBe(warnsAfterConstructor);
    } finally {
      (fs as any).mkdirSync = origMkdir;
      (process.stderr as any).write = origWrite;
    }
  });

  it('updateMeta is idempotent: multiple pushResumedAt preserve prior entries and startedAt', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('runWM', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 'initial' });
    const repoKey = computeRepoKey(harnessDir);
    const metaPath = path.join(sessionsRoot, repoKey, 'runWM', 'meta.json');
    const initialStartedAt = JSON.parse(fs.readFileSync(metaPath, 'utf-8')).startedAt;

    logger.updateMeta({ pushResumedAt: 1000 });
    logger.updateMeta({ pushResumedAt: 2000 });
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    expect(meta.task).toBe('initial');
    expect(meta.startedAt).toBe(initialStartedAt);
    expect(meta.resumedAt).toEqual([1000, 2000]);
  });

  it('updateMeta on missing meta.json: bootstrap with bootstrapOnResume=true + resumedAt push', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('runBoot', harnessDir, { sessionsRoot });
    expect(logger.hasBootstrapped()).toBe(false);
    logger.updateMeta({ pushResumedAt: Date.now(), task: 'resumed-task' });
    const repoKey = computeRepoKey(harnessDir);
    const meta = JSON.parse(fs.readFileSync(path.join(sessionsRoot, repoKey, 'runBoot', 'meta.json'), 'utf-8'));
    expect(meta.bootstrapOnResume).toBe(true);
    expect(meta.resumedAt.length).toBe(1);
    expect(meta.task).toBe('resumed-task');
    expect(typeof meta.startedAt).toBe('number');
  });
});

describe('FileSessionLogger.logEvent', () => {
  it('appends one line per event with v:1 and monotonic ts', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('runE', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });

    logger.logEvent({ event: 'phase_start', phase: 1, attemptId: 'a1' });
    logger.logEvent({ event: 'phase_end', phase: 1, attemptId: 'a1', status: 'completed', durationMs: 100 });

    const repoKey = computeRepoKey(harnessDir);
    const eventsPath = path.join(sessionsRoot, repoKey, 'runE', 'events.jsonl');
    const lines = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);
    const e1 = JSON.parse(lines[0]);
    const e2 = JSON.parse(lines[1]);
    expect(e1.v).toBe(1);
    expect(e1.runId).toBe('runE');
    expect(e1.event).toBe('phase_start');
    expect(e2.ts).toBeGreaterThanOrEqual(e1.ts);
  });

  it('swallows appendFileSync errors, warns once, then disables further I/O', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('runF', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });

    let appendCalls = 0;
    const origAppend = fs.appendFileSync;
    (fs as any).appendFileSync = () => { appendCalls++; throw new Error('boom'); };
    const stderrCalls: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as any).write = (s: string) => { stderrCalls.push(s); return true; };

    try {
      expect(() => logger.logEvent({ event: 'phase_start', phase: 1 })).not.toThrow();
      expect(() => logger.logEvent({ event: 'phase_end', phase: 1, status: 'completed', durationMs: 0 })).not.toThrow();
      expect(stderrCalls.length).toBe(1); // warn once
      expect(appendCalls).toBe(1); // disable prevents subsequent fs calls
    } finally {
      (fs as any).appendFileSync = origAppend;
      (process.stderr as any).write = origWrite;
    }
  });

  it('appending to existing events.jsonl preserves prior lines', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger1 = new FileSessionLogger('runG', harnessDir, { sessionsRoot });
    logger1.writeMeta({ task: 't' });
    logger1.logEvent({ event: 'phase_start', phase: 1 });

    const logger2 = new FileSessionLogger('runG', harnessDir, { sessionsRoot });
    logger2.logEvent({ event: 'phase_end', phase: 1, status: 'completed', durationMs: 50 });

    const repoKey = computeRepoKey(harnessDir);
    const eventsPath = path.join(sessionsRoot, repoKey, 'runG', 'events.jsonl');
    const lines = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);
  });
});

describe('FileSessionLogger.finalizeSummary', () => {
  it('writes summary.json atomically from events.jsonl', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('runH', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    logger.logEvent({ event: 'session_start', task: 't', autoMode: false, baseCommit: 'a', harnessVersion: 'v1' });
    logger.logEvent({ event: 'phase_start', phase: 1, attemptId: 'a1' });
    logger.logEvent({ event: 'phase_end', phase: 1, attemptId: 'a1', status: 'completed', durationMs: 300 });
    logger.logEvent({ event: 'session_end', status: 'completed', totalWallMs: 1000 });

    const state = { status: 'completed', autoMode: false } as HarnessState;
    logger.finalizeSummary(state);

    const repoKey = computeRepoKey(harnessDir);
    const summaryPath = path.join(sessionsRoot, repoKey, 'runH', 'summary.json');
    expect(fs.existsSync(summaryPath)).toBe(true);
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
    expect(summary.v).toBe(1);
    expect(summary.runId).toBe('runH');
    expect(summary.status).toBe('completed');
    expect(summary.totalWallMs).toBe(1000);
    expect(summary.phases['1'].attempts[0].durationMs).toBe(300);
  });

  it('pairs phase_start with phase_end to preserve reopenFromGate in summary attempts', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('run-pair', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    logger.logEvent({ event: 'phase_start', phase: 5, attemptId: 'a1' });
    logger.logEvent({ event: 'phase_end', phase: 5, attemptId: 'a1', status: 'completed', durationMs: 100 });
    logger.logEvent({ event: 'phase_start', phase: 5, attemptId: 'a2', reopenFromGate: 6 });
    logger.logEvent({ event: 'phase_end', phase: 5, attemptId: 'a2', status: 'completed', durationMs: 200 });
    logger.finalizeSummary({ status: 'completed', autoMode: false } as HarnessState);
    const repoKey = computeRepoKey(harnessDir);
    const summary = JSON.parse(fs.readFileSync(path.join(sessionsRoot, repoKey, 'run-pair', 'summary.json'), 'utf-8'));
    const attempts = summary.phases['5'].attempts;
    expect(attempts.length).toBe(2);
    expect(attempts[0].reopenFromGate).toBeNull();
    expect(attempts[1].reopenFromGate).toBe(6);
  });

  it('multiple session_end events: last one wins (paused→resumed→completed flow)', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('run-multi-end', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    logger.logEvent({ event: 'session_start', task: 't', autoMode: false, baseCommit: '', harnessVersion: 'v1' });
    logger.logEvent({ event: 'phase_start', phase: 1 });
    logger.logEvent({ event: 'session_end', status: 'paused', totalWallMs: 1000 });
    logger.logEvent({ event: 'session_resumed', fromPhase: 1, stateStatus: 'paused' });
    logger.logEvent({ event: 'phase_end', phase: 1, status: 'completed', durationMs: 500 });
    logger.logEvent({ event: 'session_end', status: 'completed', totalWallMs: 5000 });

    logger.finalizeSummary({ status: 'completed', autoMode: false } as HarnessState);
    const repoKey = computeRepoKey(harnessDir);
    const summary = JSON.parse(fs.readFileSync(path.join(sessionsRoot, repoKey, 'run-multi-end', 'summary.json'), 'utf-8'));
    expect(summary.status).toBe('completed');
    expect(summary.totalWallMs).toBe(5000);
  });

  it('status=interrupted if no session_end emitted', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('runI', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    logger.logEvent({ event: 'phase_start', phase: 1, attemptId: 'a1' });
    const state = { status: 'in_progress', autoMode: false } as HarnessState;
    logger.finalizeSummary(state);
    const repoKey = computeRepoKey(harnessDir);
    const summary = JSON.parse(fs.readFileSync(path.join(sessionsRoot, repoKey, 'runI', 'summary.json'), 'utf-8'));
    expect(summary.status).toBe('interrupted');
  });

  it('drops gate_verdict with recoveredFromSidecar=true when authoritative exists on same (phase, retryIndex)', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('runJ', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    logger.logEvent({ event: 'gate_verdict', phase: 2, retryIndex: 0, runner: 'codex', verdict: 'APPROVE', durationMs: 30000, tokensTotal: 45000, recoveredFromSidecar: false });
    logger.logEvent({ event: 'gate_verdict', phase: 2, retryIndex: 0, runner: 'codex', verdict: 'APPROVE', durationMs: 30000, tokensTotal: 45000, recoveredFromSidecar: true });
    const state = { status: 'completed', autoMode: false } as HarnessState;
    logger.finalizeSummary(state);
    const repoKey = computeRepoKey(harnessDir);
    const summary = JSON.parse(fs.readFileSync(path.join(sessionsRoot, repoKey, 'runJ', 'summary.json'), 'utf-8'));
    expect(summary.phases['2'].attempts.length).toBe(1);
  });

  it('drops gate_error with recoveredFromSidecar=true when authoritative error exists for same phase', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('runK', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    logger.logEvent({ event: 'gate_error', phase: 2, retryIndex: 0, runner: 'codex', error: 'boom', durationMs: 5000, recoveredFromSidecar: false });
    logger.logEvent({ event: 'gate_error', phase: 2, retryIndex: 0, runner: 'codex', error: 'boom', durationMs: 5000, recoveredFromSidecar: true });
    const state = { status: 'completed', autoMode: false } as HarnessState;
    logger.finalizeSummary(state);
    const repoKey = computeRepoKey(harnessDir);
    const summary = JSON.parse(fs.readFileSync(path.join(sessionsRoot, repoKey, 'runK', 'summary.json'), 'utf-8'));
    expect(summary.totals.gateErrors).toBe(1);
  });
});

describe('createSessionLogger factory', () => {
  it('returns NoopLogger when loggingEnabled=false', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = createSessionLogger('runX', harnessDir, false, { sessionsRoot });
    expect(logger.constructor.name).toBe('NoopLogger');
    logger.writeMeta({ task: 't' });
    const repoKey = computeRepoKey(harnessDir);
    expect(fs.existsSync(path.join(sessionsRoot, repoKey, 'runX', 'meta.json'))).toBe(false);
  });

  it('returns FileSessionLogger when loggingEnabled=true', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = createSessionLogger('runY', harnessDir, true, { sessionsRoot });
    expect(logger.constructor.name).toBe('FileSessionLogger');
  });
});
