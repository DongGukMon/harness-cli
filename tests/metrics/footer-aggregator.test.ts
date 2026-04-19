import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { aggregateFooter, readEventsJsonl, readStateSlice } from '../../src/metrics/footer-aggregator.js';
import type { LogEvent } from '../../src/types.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'footer-aggregator-test-'));
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

function sessionResumed(ts: number): LogEvent {
  return {
    v: 1,
    ts,
    runId: 'run-1',
    event: 'session_resumed',
    fromPhase: 5,
    stateStatus: 'in_progress',
  };
}

function phaseStart(ts: number, phase: number, attemptId?: string, retryIndex?: number): LogEvent {
  return {
    v: 1,
    ts,
    runId: 'run-1',
    event: 'phase_start',
    phase,
    attemptId,
    retryIndex,
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

function gateVerdict(
  ts: number,
  phase: number,
  retryIndex: number,
  verdict: 'APPROVE' | 'REJECT',
  options: Partial<Extract<LogEvent, { event: 'gate_verdict' }>> = {},
): LogEvent {
  return {
    v: 1,
    ts,
    runId: 'run-1',
    event: 'gate_verdict',
    phase,
    retryIndex,
    runner: 'codex',
    verdict,
    ...options,
  };
}

function gateError(
  ts: number,
  phase: number,
  retryIndex: number,
  error: string,
  options: Partial<Extract<LogEvent, { event: 'gate_error' }>> = {},
): LogEvent {
  return {
    v: 1,
    ts,
    runId: 'run-1',
    event: 'gate_error',
    phase,
    retryIndex,
    error,
    ...options,
  };
}

describe('footer-aggregator', () => {
  it('computes gate-live attempt and elapsed from the preceding event', () => {
    const summary = aggregateFooter(
      [
        sessionStart(1_000),
        phaseEnd(4_000, 1, 'completed', { attemptId: 'p1-a1' }),
      ],
      { currentPhase: 2, gateRetries: { '2': 1 }, phaseStatus: 'in_progress' },
      7_000,
    );

    expect(summary).toEqual({
      currentPhase: 2,
      attempt: 2,
      phaseRunningElapsedMs: 3_000,
      sessionElapsedMs: 6_000,
      claudeTokens: 0,
      gateTokens: 0,
      totalTokens: 0,
    });
  });

  it('returns null gate elapsed when the persisted gate phaseStatus is error or skipped', () => {
    const events = [
      sessionStart(1_000),
      phaseEnd(4_000, 1, 'completed', { attemptId: 'p1-a1' }),
    ];

    expect(
      aggregateFooter(events, { currentPhase: 2, gateRetries: { '2': 0 }, phaseStatus: 'error' }, 7_000),
    ).toMatchObject({
      currentPhase: 2,
      attempt: 1,
      phaseRunningElapsedMs: null,
    });

    expect(
      aggregateFooter(events, { currentPhase: 2, gateRetries: { '2': 0 }, phaseStatus: 'skipped' }, 7_000),
    ).toMatchObject({
      currentPhase: 2,
      attempt: 1,
      phaseRunningElapsedMs: null,
    });
  });

  it('computes interactive live attempt count and running elapsed from the latest phase_start', () => {
    const summary = aggregateFooter(
      [
        sessionStart(1_000),
        phaseStart(5_000, 5, 'p5-a1'),
      ],
      { currentPhase: 5, gateRetries: {}, phaseStatus: 'in_progress' },
      9_000,
    );

    expect(summary).toEqual({
      currentPhase: 5,
      attempt: 1,
      phaseRunningElapsedMs: 4_000,
      sessionElapsedMs: 8_000,
      claudeTokens: 0,
      gateTokens: 0,
      totalTokens: 0,
    });
  });

  it('returns null elapsed when the latest interactive attempt already has a matching phase_end', () => {
    const summary = aggregateFooter(
      [
        sessionStart(1_000),
        phaseStart(5_000, 5, 'p5-a1'),
        phaseEnd(7_000, 5, 'completed', { attemptId: 'p5-a1' }),
      ],
      { currentPhase: 5, gateRetries: {}, phaseStatus: 'completed' },
      9_000,
    );

    expect(summary).toEqual({
      currentPhase: 5,
      attempt: 1,
      phaseRunningElapsedMs: null,
      sessionElapsedMs: 8_000,
      claudeTokens: 0,
      gateTokens: 0,
      totalTokens: 0,
    });
  });

  it('pairs phase 6 starts and ends positionally to decide whether verify is still running', () => {
    const running = aggregateFooter(
      [
        sessionStart(1_000),
        phaseStart(2_000, 6, undefined, 0),
        phaseEnd(3_000, 6, 'completed'),
        phaseStart(4_000, 6, undefined, 1),
      ],
      { currentPhase: 6, gateRetries: {}, phaseStatus: 'in_progress' },
      9_000,
    );

    expect(running).toEqual({
      currentPhase: 6,
      attempt: 2,
      phaseRunningElapsedMs: 5_000,
      sessionElapsedMs: 8_000,
      claudeTokens: 0,
      gateTokens: 0,
      totalTokens: 0,
    });

    const idle = aggregateFooter(
      [
        sessionStart(1_000),
        phaseStart(2_000, 6, undefined, 0),
        phaseEnd(3_000, 6, 'completed'),
        phaseStart(4_000, 6, undefined, 1),
        phaseEnd(8_000, 6, 'completed'),
      ],
      { currentPhase: 6, gateRetries: {}, phaseStatus: 'completed' },
      9_000,
    );

    expect(idle).toEqual({
      currentPhase: 6,
      attempt: 2,
      phaseRunningElapsedMs: null,
      sessionElapsedMs: 8_000,
      claudeTokens: 0,
      gateTokens: 0,
      totalTokens: 0,
    });
  });

  it('measures session elapsed from the latest session_start or session_resumed event', () => {
    const summary = aggregateFooter(
      [
        sessionStart(1_000),
        phaseStart(2_000, 5, 'old-attempt'),
        sessionResumed(5_000),
        phaseStart(6_000, 5, 'p5-a1'),
      ],
      { currentPhase: 5, gateRetries: {}, phaseStatus: 'in_progress' },
      8_000,
    );

    expect(summary).toEqual({
      currentPhase: 5,
      attempt: 1,
      phaseRunningElapsedMs: 2_000,
      sessionElapsedMs: 3_000,
      claudeTokens: 0,
      gateTokens: 0,
      totalTokens: 0,
    });
  });

  it('deduplicates sidecar-replayed gate_verdict and gate_error token events', () => {
    const summary = aggregateFooter(
      [
        sessionStart(1_000),
        gateVerdict(2_000, 2, 0, 'APPROVE', { tokensTotal: 1_000 }),
        gateVerdict(2_100, 2, 0, 'APPROVE', { tokensTotal: 1_000, recoveredFromSidecar: true }),
        gateError(3_000, 4, 0, 'boom', { tokensTotal: 400 }),
        gateError(3_100, 4, 1, 'boom replay', { tokensTotal: 400, recoveredFromSidecar: true }),
        phaseStart(4_000, 5, 'p5-a1'),
      ],
      { currentPhase: 5, gateRetries: {}, phaseStatus: 'in_progress' },
      7_000,
    );

    expect(summary).toEqual({
      currentPhase: 5,
      attempt: 1,
      phaseRunningElapsedMs: 3_000,
      sessionElapsedMs: 6_000,
      claudeTokens: 0,
      gateTokens: 1_400,
      totalTokens: 1_400,
    });
  });

  it('skips null or absent claude token payloads and undefined gate token totals', () => {
    const summary = aggregateFooter(
      [
        sessionStart(1_000),
        phaseEnd(2_000, 1, 'completed', {
          attemptId: 'p1-a1',
          claudeTokens: null,
        }),
        phaseEnd(3_000, 1, 'completed', {
          attemptId: 'p1-a2',
        }),
        gateVerdict(4_000, 2, 0, 'APPROVE'),
        phaseStart(5_000, 3, 'p3-a1'),
      ],
      { currentPhase: 3, gateRetries: {}, phaseStatus: 'in_progress' },
      9_000,
    );

    expect(summary).toEqual({
      currentPhase: 3,
      attempt: 1,
      phaseRunningElapsedMs: 4_000,
      sessionElapsedMs: 8_000,
      claudeTokens: 0,
      gateTokens: 0,
      totalTokens: 0,
    });
  });

  it('returns null when there are no events or no session-open event in the log', () => {
    expect(
      aggregateFooter([], { currentPhase: 1, gateRetries: {}, phaseStatus: 'pending' }, 9_000),
    ).toBeNull();

    expect(
      aggregateFooter(
        [phaseStart(5_000, 5, 'p5-a1')],
        { currentPhase: 5, gateRetries: {}, phaseStatus: 'in_progress' },
        9_000,
      ),
    ).toBeNull();
  });

  it('reads a valid state slice and returns null for missing, malformed, partial, race, or terminal state files', () => {
    const dir = makeTempDir();
    const validPath = path.join(dir, 'state-valid.json');
    fs.writeFileSync(validPath, JSON.stringify({
      currentPhase: 2,
      gateRetries: { '2': 1 },
      phases: {
        '1': 'completed',
        '2': 'in_progress',
        '3': 'pending',
        '4': 'pending',
        '5': 'pending',
        '6': 'pending',
        '7': 'pending',
      },
    }));

    expect(readStateSlice(validPath)).toEqual({
      currentPhase: 2,
      gateRetries: { '2': 1 },
      phaseStatus: 'in_progress',
    });

    const missingPath = path.join(dir, 'missing.json');
    expect(() => readStateSlice(missingPath)).not.toThrow();
    expect(readStateSlice(missingPath)).toBeNull();

    const malformedPath = path.join(dir, 'state-malformed.json');
    fs.writeFileSync(malformedPath, '{"currentPhase":');
    expect(() => readStateSlice(malformedPath)).not.toThrow();
    expect(readStateSlice(malformedPath)).toBeNull();

    const partialPath = path.join(dir, 'state-partial.json');
    fs.writeFileSync(partialPath, JSON.stringify({
      currentPhase: 2,
      gateRetries: { '2': 1 },
    }));
    expect(() => readStateSlice(partialPath)).not.toThrow();
    expect(readStateSlice(partialPath)).toBeNull();

    const racePath = path.join(dir, 'state-race.json');
    fs.writeFileSync(`${racePath}.tmp`, JSON.stringify({
      currentPhase: 2,
      gateRetries: { '2': 1 },
      phases: { '2': 'in_progress' },
    }));
    expect(() => readStateSlice(racePath)).not.toThrow();
    expect(readStateSlice(racePath)).toBeNull();

    const terminalPath = path.join(dir, 'state-terminal.json');
    fs.writeFileSync(terminalPath, JSON.stringify({
      currentPhase: 8,
      gateRetries: { '7': 0 },
      phases: {
        '1': 'completed',
        '2': 'completed',
        '3': 'completed',
        '4': 'completed',
        '5': 'completed',
        '6': 'completed',
        '7': 'completed',
      },
    }));
    expect(() => readStateSlice(terminalPath)).not.toThrow();
    expect(readStateSlice(terminalPath)).toBeNull();
  });

  it('silently skips malformed JSONL lines while preserving valid neighboring events', () => {
    const dir = makeTempDir();
    const eventsPath = path.join(dir, 'events.jsonl');
    const lines = [
      JSON.stringify(sessionStart(1_000)),
      '{"event":',
      JSON.stringify(phaseStart(2_000, 5, 'p5-a1')),
    ];
    fs.writeFileSync(eventsPath, `${lines.join('\n')}\n`);

    expect(readEventsJsonl(eventsPath)).toEqual([
      sessionStart(1_000),
      phaseStart(2_000, 5, 'p5-a1'),
    ]);
  });
});
