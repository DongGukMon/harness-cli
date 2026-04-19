import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoopLogger } from '../../src/logger.js';
import type { SessionLogger, SessionMeta, HarnessState, DistributiveOmit, LogEvent } from '../../src/types.js';
import { startFooterTicker } from '../../src/commands/footer-ticker.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'footer-ticker-test-'));
}

function makeLogger(eventsPath: string): SessionLogger {
  return {
    logEvent(_event: DistributiveOmit<LogEvent, 'v' | 'ts' | 'runId'>): void {},
    writeMeta(_partial: Partial<SessionMeta> & { task: string }): void {},
    updateMeta(_update: { pushResumedAt?: number; task?: string; codexHome?: string }): void {},
    finalizeSummary(_state: HarnessState): void {},
    close(): void {},
    hasBootstrapped(): boolean { return true; },
    hasEmittedSessionOpen(): boolean { return true; },
    getStartedAt(): number { return 0; },
    getEventsPath(): string | null { return eventsPath; },
  };
}

function sessionStart(ts: number): LogEvent {
  return {
    v: 1,
    ts,
    runId: 'run-1',
    event: 'session_start',
    task: 'demo',
    autoMode: false,
    baseCommit: 'abc123',
    harnessVersion: 'test',
  };
}

function phaseStart(ts: number, phase: number, attemptId?: string): LogEvent {
  return {
    v: 1,
    ts,
    runId: 'run-1',
    event: 'phase_start',
    phase,
    attemptId,
  };
}

function phaseEnd(
  ts: number,
  phase: number,
  status: 'completed' | 'failed',
  options: Partial<Extract<LogEvent, { event: 'phase_end' }>> = {},
): LogEvent {
  return {
    v: 1,
    ts,
    runId: 'run-1',
    event: 'phase_end',
    phase,
    status,
    durationMs: 100,
    ...options,
  };
}

function writeEvents(eventsPath: string, events: LogEvent[]): void {
  fs.writeFileSync(eventsPath, events.map(event => JSON.stringify(event)).join('\n') + '\n');
}

function writeStateAtomically(
  stateJsonPath: string,
  overrides: Partial<{
    currentPhase: number;
    gateRetries: Record<string, number>;
    phaseStatus: 'pending' | 'in_progress' | 'completed' | 'failed' | 'error' | 'skipped';
  }> = {},
): void {
  const tmpPath = `${stateJsonPath}.tmp`;
  const currentPhase = overrides.currentPhase ?? 5;
  const phaseStatus = overrides.phaseStatus ?? 'in_progress';
  const state = {
    currentPhase,
    gateRetries: overrides.gateRetries ?? { '2': 0, '4': 0, '7': 0 },
    phases: {
      '1': 'completed',
      '2': 'pending',
      '3': 'completed',
      '4': 'pending',
      '5': currentPhase === 5 ? phaseStatus : 'completed',
      '6': currentPhase === 6 ? phaseStatus : 'pending',
      '7': 'pending',
    },
  };

  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  fs.renameSync(tmpPath, stateJsonPath);
}

function setStderrTty(rows: number, columns: number, isTTY = true): void {
  Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: isTTY });
  Object.defineProperty(process.stderr, 'rows', { configurable: true, value: rows });
  Object.defineProperty(process.stderr, 'columns', { configurable: true, value: columns });
}

describe('startFooterTicker', () => {
  let tempDir: string;
  let eventsPath: string;
  let stateJsonPath: string;
  let stderrWrite: any;
  let stderrDescriptors: {
    isTTY?: PropertyDescriptor;
    rows?: PropertyDescriptor;
    columns?: PropertyDescriptor;
  };

  beforeEach(() => {
    tempDir = makeTempDir();
    eventsPath = path.join(tempDir, 'events.jsonl');
    stateJsonPath = path.join(tempDir, 'state.json');
    stderrWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    stderrDescriptors = {
      isTTY: Object.getOwnPropertyDescriptor(process.stderr, 'isTTY'),
      rows: Object.getOwnPropertyDescriptor(process.stderr, 'rows'),
      columns: Object.getOwnPropertyDescriptor(process.stderr, 'columns'),
    };
    setStderrTty(24, 100, true);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();

    if (stderrDescriptors.isTTY) {
      Object.defineProperty(process.stderr, 'isTTY', stderrDescriptors.isTTY);
    }
    if (stderrDescriptors.rows) {
      Object.defineProperty(process.stderr, 'rows', stderrDescriptors.rows);
    }
    if (stderrDescriptors.columns) {
      Object.defineProperty(process.stderr, 'columns', stderrDescriptors.columns);
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('renders the exact footer bytes on scheduled ticks and re-reads state plus events each time', () => {
    writeEvents(eventsPath, [
      sessionStart(1_000),
      phaseStart(5_000, 5, 'p5-a1'),
    ]);
    writeStateAtomically(stateJsonPath, { currentPhase: 5, phaseStatus: 'in_progress' });

    const logger = makeLogger(eventsPath);
    const getEventsPath = vi.spyOn(logger, 'getEventsPath');
    const readSpy = vi.spyOn(fs, 'readFileSync');

    vi.setSystemTime(8_000);
    const ticker = startFooterTicker({
      logger,
      stateJsonPath,
      intervalMs: 1_000,
    });

    vi.advanceTimersByTime(2_000);

    expect(getEventsPath).toHaveBeenCalledTimes(1);
    expect(
      readSpy.mock.calls.filter(([target]) => target === eventsPath),
    ).toHaveLength(2);
    expect(
      readSpy.mock.calls.filter(([target]) => target === stateJsonPath),
    ).toHaveLength(2);
    expect(stderrWrite).toHaveBeenNthCalledWith(
      1,
      '\x1b[s\x1b[24;1H\x1b[2KP5 attempt 1 · 0m 04s phase · 0m 08s session · 0.0M tok (0.0M Claude + 0.0M gate)\x1b[u',
    );
    expect(stderrWrite).toHaveBeenNthCalledWith(
      2,
      '\x1b[s\x1b[24;1H\x1b[2KP5 attempt 1 · 0m 05s phase · 0m 09s session · 0.0M tok (0.0M Claude + 0.0M gate)\x1b[u',
    );

    ticker.stop();
  });

  it('picks up an atomically rewritten state.json on the next tick', () => {
    writeEvents(eventsPath, [
      sessionStart(1_000),
      phaseStart(5_000, 5, 'p5-a1'),
      phaseEnd(7_000, 5, 'completed', { attemptId: 'p5-a1' }),
      phaseStart(8_000, 6),
    ]);
    writeStateAtomically(stateJsonPath, { currentPhase: 5, phaseStatus: 'completed' });

    vi.setSystemTime(8_000);
    const ticker = startFooterTicker({
      logger: makeLogger(eventsPath),
      stateJsonPath,
      intervalMs: 1_000,
    });

    vi.advanceTimersByTime(1_000);
    expect(stderrWrite).toHaveBeenLastCalledWith(
      '\x1b[s\x1b[24;1H\x1b[2KP5 attempt 1 · 0m 00s phase · 0m 08s session · 0.0M tok (0.0M Claude + 0.0M gate)\x1b[u',
    );

    writeStateAtomically(stateJsonPath, { currentPhase: 6, phaseStatus: 'in_progress' });
    vi.advanceTimersByTime(1_000);

    expect(stderrWrite).toHaveBeenLastCalledWith(
      '\x1b[s\x1b[24;1H\x1b[2KP6 · 0m 02s phase · 0m 09s session\x1b[u',
    );

    ticker.stop();
  });

  it('stop clears the footer row once, removes the exit listener, and stays idempotent', () => {
    writeEvents(eventsPath, [
      sessionStart(1_000),
      phaseStart(5_000, 5, 'p5-a1'),
    ]);
    writeStateAtomically(stateJsonPath, { currentPhase: 5, phaseStatus: 'in_progress' });

    const exitCountBefore = process.listeners('exit').length;
    vi.setSystemTime(8_000);
    const ticker = startFooterTicker({
      logger: makeLogger(eventsPath),
      stateJsonPath,
      intervalMs: 1_000,
    });

    expect(process.listeners('exit')).toHaveLength(exitCountBefore + 1);

    vi.advanceTimersByTime(1_000);
    expect(stderrWrite).toHaveBeenCalledTimes(1);

    ticker.stop();
    expect(stderrWrite).toHaveBeenNthCalledWith(2, '\x1b[s\x1b[24;1H\x1b[2K\x1b[u');
    expect(process.listeners('exit')).toHaveLength(exitCountBefore);

    vi.advanceTimersByTime(3_000);
    ticker.stop();
    expect(stderrWrite).toHaveBeenCalledTimes(2);
  });

  it('registers one exit listener on start and clears the footer synchronously from that listener', () => {
    writeEvents(eventsPath, [
      sessionStart(1_000),
      phaseStart(5_000, 5, 'p5-a1'),
    ]);
    writeStateAtomically(stateJsonPath, { currentPhase: 5, phaseStatus: 'in_progress' });

    const exitCountBefore = process.listeners('exit').length;
    const ticker = startFooterTicker({
      logger: makeLogger(eventsPath),
      stateJsonPath,
      intervalMs: 1_000,
    });
    const exitListeners = process.listeners('exit');

    expect(exitListeners).toHaveLength(exitCountBefore + 1);

    const onProcessExit = exitListeners[exitListeners.length - 1] as (code?: number) => void;
    onProcessExit(130);
    expect(stderrWrite).toHaveBeenCalledWith('\x1b[s\x1b[24;1H\x1b[2K\x1b[u');

    ticker.stop();
  });

  it('returns an inert ticker for NoopLogger without interval, exit listener, or writes', () => {
    writeStateAtomically(stateJsonPath, { currentPhase: 5, phaseStatus: 'in_progress' });
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const exitCountBefore = process.listeners('exit').length;

    const ticker = startFooterTicker({
      logger: new NoopLogger(),
      stateJsonPath,
      intervalMs: 1_000,
    });

    ticker.forceTick();
    vi.advanceTimersByTime(2_000);
    ticker.stop();

    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(process.listeners('exit')).toHaveLength(exitCountBefore);
    expect(stderrWrite).not.toHaveBeenCalled();
  });

  it('skips the tick silently when events.jsonl does not exist', () => {
    writeStateAtomically(stateJsonPath, { currentPhase: 5, phaseStatus: 'in_progress' });

    const readSpy = vi.spyOn(fs, 'readFileSync');
    const ticker = startFooterTicker({
      logger: makeLogger(eventsPath),
      stateJsonPath,
      intervalMs: 1_000,
    });

    vi.advanceTimersByTime(1_000);

    expect(stderrWrite).not.toHaveBeenCalled();
    expect(
      readSpy.mock.calls.filter(([target]) => target === stateJsonPath),
    ).toHaveLength(0);

    ticker.stop();
  });

  it('skips the tick silently when readStateSlice returns null for malformed state.json', () => {
    writeEvents(eventsPath, [
      sessionStart(1_000),
      phaseStart(5_000, 5, 'p5-a1'),
    ]);
    fs.writeFileSync(stateJsonPath, '{"currentPhase":');

    const ticker = startFooterTicker({
      logger: makeLogger(eventsPath),
      stateJsonPath,
      intervalMs: 1_000,
    });

    vi.advanceTimersByTime(1_000);

    expect(stderrWrite).not.toHaveBeenCalled();

    ticker.stop();
  });

  it('skips rendering when stderr is not a usable tty surface', () => {
    writeEvents(eventsPath, [
      sessionStart(1_000),
      phaseStart(5_000, 5, 'p5-a1'),
    ]);
    writeStateAtomically(stateJsonPath, { currentPhase: 5, phaseStatus: 'in_progress' });
    setStderrTty(24, 100, false);

    const ticker = startFooterTicker({
      logger: makeLogger(eventsPath),
      stateJsonPath,
      intervalMs: 1_000,
    });

    vi.advanceTimersByTime(1_000);

    expect(stderrWrite).not.toHaveBeenCalled();

    ticker.stop();
  });

  it('catches an events read failure for one tick and succeeds on the next tick', () => {
    writeEvents(eventsPath, [
      sessionStart(1_000),
      phaseStart(5_000, 5, 'p5-a1'),
    ]);
    writeStateAtomically(stateJsonPath, { currentPhase: 5, phaseStatus: 'in_progress' });

    vi.setSystemTime(8_000);
    const originalReadFileSync = fs.readFileSync.bind(fs);
    let throwNextEventsRead = true;
    vi.spyOn(fs, 'readFileSync').mockImplementation(((target: fs.PathOrFileDescriptor, options?: unknown) => {
      if (target === eventsPath && throwNextEventsRead) {
        throwNextEventsRead = false;
        throw new Error('EACCES');
      }
      return originalReadFileSync(target, options as never);
    }) as typeof fs.readFileSync);

    const ticker = startFooterTicker({
      logger: makeLogger(eventsPath),
      stateJsonPath,
      intervalMs: 1_000,
    });

    expect(() => vi.advanceTimersByTime(1_000)).not.toThrow();
    expect(stderrWrite).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);

    expect(stderrWrite).toHaveBeenCalledWith(
      '\x1b[s\x1b[24;1H\x1b[2KP5 attempt 1 · 0m 05s phase · 0m 09s session · 0.0M tok (0.0M Claude + 0.0M gate)\x1b[u',
    );

    ticker.stop();
  });

  it('forceTick renders synchronously without waiting for the interval callback', () => {
    writeEvents(eventsPath, [
      sessionStart(1_000),
      phaseStart(5_000, 5, 'p5-a1'),
    ]);
    writeStateAtomically(stateJsonPath, { currentPhase: 5, phaseStatus: 'in_progress' });

    vi.setSystemTime(8_000);
    const ticker = startFooterTicker({
      logger: makeLogger(eventsPath),
      stateJsonPath,
      intervalMs: 1_000,
    });

    expect(stderrWrite).not.toHaveBeenCalled();

    ticker.forceTick();

    expect(stderrWrite).toHaveBeenCalledTimes(1);
    expect(stderrWrite).toHaveBeenCalledWith(
      '\x1b[s\x1b[24;1H\x1b[2KP5 attempt 1 · 0m 03s phase · 0m 07s session · 0.0M tok (0.0M Claude + 0.0M gate)\x1b[u',
    );

    ticker.stop();
  });
});
