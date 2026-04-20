import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { FileSessionLogger, NoopLogger, computeRepoKey, createSessionLogger } from '../../src/logger.js';
import { bootstrapSessionLogger } from '../../src/commands/inner.js';
import type { HarnessState } from '../../src/types.js';

function tempHarnessDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'logging-int-'));
}

function buildState(overrides: Partial<HarnessState> = {}): HarnessState {
  const base: HarnessState = {
    runId: 'r', flow: 'full', carryoverFeedback: null,
    currentPhase: 1, status: 'in_progress', autoMode: false,
    task: 'test', baseCommit: '', implRetryBase: '',
    trackedRepos: [{ path: '', baseCommit: '', implRetryBase: '', implHead: null }],
    codexPath: null,
    externalCommitsDetected: false,
    artifacts: { spec: 's', plan: 'p', decisionLog: 'd', checklist: 'c', evalReport: 'e' },
    phases: { '1': 'pending', '2': 'pending', '3': 'pending', '4': 'pending', '5': 'pending', '6': 'pending', '7': 'pending' },
    gateRetries: { '2': 0, '4': 0, '7': 0 },
    verifyRetries: 0,
    pauseReason: null, specCommit: null, planCommit: null, implCommit: null,
    evalCommit: null, verifiedAtHead: null, pausedAtHead: null, pendingAction: null,
    phaseOpenedAt: { '1': null, '3': null, '5': null },
    phaseAttemptId: { '1': null, '3': null, '5': null },
    phasePresets: {}, phaseReopenFlags: { '1': false, '3': false, '5': false },
    phaseReopenSource: { '1': null, '3': null, '5': null },
    phaseCodexSessions: { '2': null, '4': null, '7': null },
    phaseClaudeSessions: { '1': null, '3': null, '5': null },
    lastWorkspacePid: null, lastWorkspacePidStartTime: null,
    tmuxSession: '', tmuxMode: 'dedicated', tmuxWindows: [],
    tmuxControlWindow: '', tmuxWorkspacePane: '', tmuxControlPane: '',
    loggingEnabled: true,
    codexNoIsolate: false,
  };
  return { ...base, ...overrides };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('Integration: FileSessionLogger events + files', () => {
  it('full flow with enable-logging creates session dir + summary', () => {
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('int1', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    logger.logEvent({ event: 'session_start', task: 't', autoMode: false, baseCommit: '', harnessVersion: 'v1' });
    logger.logEvent({ event: 'phase_start', phase: 1, attemptId: 'a1' });
    logger.logEvent({ event: 'phase_end', phase: 1, attemptId: 'a1', status: 'completed', durationMs: 100 });
    logger.logEvent({ event: 'session_end', status: 'completed', totalWallMs: 500 });
    logger.finalizeSummary(buildState({ status: 'completed' }));

    const repoKey = computeRepoKey(harnessDir);
    const sessionDir = path.join(sessionsRoot, repoKey, 'int1');
    expect(fs.existsSync(path.join(sessionDir, 'events.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(sessionDir, 'meta.json'))).toBe(true);
    expect(fs.existsSync(path.join(sessionDir, 'summary.json'))).toBe(true);
  });

  it('with loggingEnabled=false: NoopLogger, no files created', () => {
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = createSessionLogger('r', harnessDir, false, { sessionsRoot });
    expect(logger).toBeInstanceOf(NoopLogger);
    logger.writeMeta({ task: 't' });
    logger.logEvent({ event: 'session_start', task: 't', autoMode: false, baseCommit: '', harnessVersion: 'v1' });
    logger.logEvent({ event: 'phase_start', phase: 1 });
    logger.finalizeSummary(buildState({ status: 'completed' }));
    expect(fs.existsSync(sessionsRoot)).toBe(false);
  });

  it('Codex gate APPROVE → gate_verdict with runner=codex + tokensTotal', () => {
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('int3', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    logger.logEvent({
      event: 'gate_verdict', phase: 2, retryIndex: 0, runner: 'codex', verdict: 'APPROVE',
      durationMs: 30000, tokensTotal: 45000, promptBytes: 12345,
    });
    const repoKey = computeRepoKey(harnessDir);
    const eventsPath = path.join(sessionsRoot, repoKey, 'int3', 'events.jsonl');
    const verdict = JSON.parse(fs.readFileSync(eventsPath, 'utf-8').trim().split('\n')[0]);
    expect(verdict.runner).toBe('codex');
    expect(verdict.tokensTotal).toBe(45000);
  });

  it('Claude gate APPROVE → gate_verdict with runner=claude, no tokensTotal', () => {
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('int4', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    logger.logEvent({
      event: 'gate_verdict', phase: 2, retryIndex: 0, runner: 'claude', verdict: 'APPROVE',
      durationMs: 30000, promptBytes: 12345,
    });
    const repoKey = computeRepoKey(harnessDir);
    const verdict = JSON.parse(fs.readFileSync(path.join(sessionsRoot, repoKey, 'int4', 'events.jsonl'), 'utf-8').trim().split('\n')[0]);
    expect(verdict.runner).toBe('claude');
    expect(verdict.tokensTotal).toBeUndefined();
  });

  it('Gate REJECT: gate_verdict then gate_retry in order', () => {
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('int5', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    logger.logEvent({ event: 'gate_verdict', phase: 2, retryIndex: 0, runner: 'codex', verdict: 'REJECT', durationMs: 20000 });
    logger.logEvent({ event: 'gate_retry', phase: 2, retryIndex: 0, retryCount: 1, retryLimit: 3, feedbackPath: '/x', feedbackBytes: 100, feedbackPreview: 'foo' });
    const repoKey = computeRepoKey(harnessDir);
    const lines = fs.readFileSync(path.join(sessionsRoot, repoKey, 'int5', 'events.jsonl'), 'utf-8').trim().split('\n');
    expect(JSON.parse(lines[0]).event).toBe('gate_verdict');
    expect(JSON.parse(lines[1]).event).toBe('gate_retry');
  });

  it('state_anomaly events preserve payload', () => {
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('int6', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    logger.logEvent({ event: 'state_anomaly', kind: 'pending_action_stale_after_approve', details: { phase: 2 } });
    logger.logEvent({ event: 'state_anomaly', kind: 'phase_reopen_flag_stuck', details: { phase: 5 } });
    const repoKey = computeRepoKey(harnessDir);
    const lines = fs.readFileSync(path.join(sessionsRoot, repoKey, 'int6', 'events.jsonl'), 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).kind).toBe('pending_action_stale_after_approve');
    expect(JSON.parse(lines[1]).kind).toBe('phase_reopen_flag_stuck');
  });

  it('recoveredFromSidecar=true deduped against authoritative in summary', () => {
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('int7', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    logger.logEvent({ event: 'gate_verdict', phase: 2, retryIndex: 0, runner: 'codex', verdict: 'APPROVE', durationMs: 30000, recoveredFromSidecar: false });
    logger.logEvent({ event: 'gate_verdict', phase: 2, retryIndex: 0, runner: 'codex', verdict: 'APPROVE', durationMs: 30000, recoveredFromSidecar: true });
    logger.logEvent({ event: 'session_end', status: 'completed', totalWallMs: 100 });
    logger.finalizeSummary(buildState({ status: 'completed' }));
    const repoKey = computeRepoKey(harnessDir);
    const summary = JSON.parse(fs.readFileSync(path.join(sessionsRoot, repoKey, 'int7', 'summary.json'), 'utf-8'));
    expect(summary.phases['2'].attempts.length).toBe(1);
  });

  it('different harnessDir → different repoKey → separate session dirs', () => {
    const dirA = tempHarnessDir();
    const dirB = tempHarnessDir();
    const sessionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sessions-'));
    const loggerA = new FileSessionLogger('same-runid', dirA, { sessionsRoot });
    const loggerB = new FileSessionLogger('same-runid', dirB, { sessionsRoot });
    loggerA.writeMeta({ task: 'A' });
    loggerB.writeMeta({ task: 'B' });
    const keyA = computeRepoKey(dirA);
    const keyB = computeRepoKey(dirB);
    expect(keyA).not.toBe(keyB);
    expect(fs.existsSync(path.join(sessionsRoot, keyA, 'same-runid', 'meta.json'))).toBe(true);
    expect(fs.existsSync(path.join(sessionsRoot, keyB, 'same-runid', 'meta.json'))).toBe(true);
  });

  it('Resume appends session_resumed + pushes resumedAt without truncating events.jsonl', () => {
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger1 = new FileSessionLogger('int9', harnessDir, { sessionsRoot });
    logger1.writeMeta({ task: 't' });
    logger1.logEvent({ event: 'session_start', task: 't', autoMode: false, baseCommit: '', harnessVersion: 'v1' });
    logger1.logEvent({ event: 'phase_start', phase: 1 });

    const logger2 = new FileSessionLogger('int9', harnessDir, { sessionsRoot });
    logger2.updateMeta({ pushResumedAt: Date.now() });
    logger2.logEvent({ event: 'session_resumed', fromPhase: 1, stateStatus: 'in_progress' });

    const repoKey = computeRepoKey(harnessDir);
    const eventsPath = path.join(sessionsRoot, repoKey, 'int9', 'events.jsonl');
    const lines = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(3);
    expect(JSON.parse(lines[2]).event).toBe('session_resumed');
    const meta = JSON.parse(fs.readFileSync(path.join(sessionsRoot, repoKey, 'int9', 'meta.json'), 'utf-8'));
    expect(meta.resumedAt.length).toBe(1);
  });
});

describe('Integration: migrateState persistence', () => {
  it('legacy state without loggingEnabled defaults to false', async () => {
    const { migrateState } = await import('../../src/state.js');
    const legacy = { runId: 'r', currentPhase: 1, status: 'paused', phases: {}, gateRetries: {}, verifyRetries: 0 } as any;
    expect(migrateState(legacy).loggingEnabled).toBe(false);
  });

  it('state with loggingEnabled=true preserved across migrateState', async () => {
    const { migrateState } = await import('../../src/state.js');
    const state = { loggingEnabled: true, runId: 'r', currentPhase: 1, status: 'paused', phases: {}, gateRetries: {}, verifyRetries: 0 } as any;
    expect(migrateState(JSON.parse(JSON.stringify(state))).loggingEnabled).toBe(true);
  });
});

describe('Integration: edge cases', () => {
  it('reopenFromGate accuracy: phase 5 reopen from verify (6) vs gate (7)', () => {
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('edge1', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    logger.logEvent({ event: 'phase_start', phase: 5, attemptId: 'a1' });
    logger.logEvent({ event: 'phase_end', phase: 5, attemptId: 'a1', status: 'completed', durationMs: 100 });
    logger.logEvent({ event: 'phase_start', phase: 5, attemptId: 'a2', reopenFromGate: 6 });
    logger.logEvent({ event: 'phase_end', phase: 5, attemptId: 'a2', status: 'completed', durationMs: 200 });
    logger.logEvent({ event: 'phase_start', phase: 5, attemptId: 'a3', reopenFromGate: 7 });
    const repoKey = computeRepoKey(harnessDir);
    const events = fs.readFileSync(path.join(sessionsRoot, repoKey, 'edge1', 'events.jsonl'), 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    const starts = events.filter((e: any) => e.event === 'phase_start' && e.phase === 5);
    expect(starts[0].reopenFromGate).toBeUndefined();
    expect(starts[1].reopenFromGate).toBe(6);
    expect(starts[2].reopenFromGate).toBe(7);
  });

  it('force_pass exclusivity: only force_pass event for force-pass path', () => {
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('edge2', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    logger.logEvent({ event: 'force_pass', phase: 2, by: 'user' });
    logger.logEvent({ event: 'force_pass', phase: 6, by: 'auto' });
    const repoKey = computeRepoKey(harnessDir);
    const events = fs.readFileSync(path.join(sessionsRoot, repoKey, 'edge2', 'events.jsonl'), 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    const forcePasses = events.filter((e: any) => e.event === 'force_pass');
    expect(forcePasses.length).toBe(2);
    expect(events.some((e: any) => (e.event === 'phase_end' || e.event === 'gate_verdict' || e.event === 'verify_result') && (e.phase === 2 || e.phase === 6))).toBe(false);
  });

  it('escalation exclusivity: one per path with userChoice', () => {
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('edge3', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    logger.logEvent({ event: 'escalation', phase: 2, reason: 'gate-retry-limit', userChoice: 'C' });
    logger.logEvent({ event: 'escalation', phase: 6, reason: 'verify-error', userChoice: 'R' });
    const repoKey = computeRepoKey(harnessDir);
    const events = fs.readFileSync(path.join(sessionsRoot, repoKey, 'edge3', 'events.jsonl'), 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    expect(events.filter((e: any) => e.event === 'escalation' && e.phase === 2).length).toBe(1);
    expect(events.filter((e: any) => e.event === 'escalation' && e.phase === 6).length).toBe(1);
    expect(events[0].userChoice).toBe('C');
    expect(events[1].userChoice).toBe('R');
  });
});

describe('Integration: real-wiring runPhaseLoop with mocked runners', () => {
  it('bootstrap → phase loop with mocked runners → summary produced', async () => {
    const { runPhaseLoop } = await import('../../src/phases/runner.js');
    const interactive = await import('../../src/phases/interactive.js');
    const gate = await import('../../src/phases/gate.js');
    const verify = await import('../../src/phases/verify.js');
    const { writeState } = await import('../../src/state.js');

    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions');
    const runDir = path.join(harnessDir, 'runs', 'real1');
    fs.mkdirSync(runDir, { recursive: true });

    vi.spyOn(interactive, 'runInteractivePhase').mockImplementation(async (phase, state, _hd, _rd, _cwd, attemptId) => {
      return { status: 'completed', attemptId };
    });
    vi.spyOn(gate, 'runGatePhase').mockResolvedValue({
      type: 'verdict', verdict: 'APPROVE', comments: 'ok', rawOutput: 'APPROVE',
      runner: 'codex', promptBytes: 1000, durationMs: 5000, tokensTotal: 10000,
    } as any);
    vi.spyOn(verify, 'runVerifyPhase').mockResolvedValue({ type: 'pass' } as any);

    // Also mock git and ui so runner doesn't fail on git calls
    const git = await import('../../src/git.js');
    vi.spyOn(git, 'getHead').mockReturnValue('abc123');
    vi.spyOn(git, 'isWorkingTreeClean').mockReturnValue(true);

    const ui = await import('../../src/ui.js');
    vi.spyOn(ui, 'renderControlPanel').mockImplementation(() => {});
    vi.spyOn(ui, 'printPhaseTransition').mockImplementation(() => {});
    vi.spyOn(ui, 'promptChoice').mockResolvedValue('C');
    vi.spyOn(ui, 'printWarning').mockImplementation(() => {});
    vi.spyOn(ui, 'printError').mockImplementation(() => {});
    vi.spyOn(ui, 'printSuccess').mockImplementation(() => {});
    vi.spyOn(ui, 'printInfo').mockImplementation(() => {});

    // Mock artifact module to avoid file I/O
    const artifact = await import('../../src/artifact.js');
    vi.spyOn(artifact, 'normalizeArtifactCommit').mockReturnValue(true);

    const state = buildState({
      runId: 'real1', currentPhase: 1, loggingEnabled: true, task: 'real test',
      phasePresets: { '1': 'sonnet-high', '2': 'sonnet-high', '3': 'sonnet-high', '4': 'sonnet-high', '5': 'sonnet-high', '6': 'sonnet-high', '7': 'sonnet-high' },
    });
    writeState(runDir, state);

    const logger = await bootstrapSessionLogger('real1', harnessDir, state, false, { sessionsRoot, cwd: harnessDir });
    const inputManager = { start: () => {}, stop: () => {}, enterPhaseLoop: () => {}, onConfigCancel: undefined } as any;

    await runPhaseLoop(state, harnessDir, runDir, harnessDir, inputManager, logger, { value: false });
    logger.logEvent({ event: 'session_end', status: 'completed', totalWallMs: Date.now() - logger.getStartedAt() });
    logger.finalizeSummary(state);

    const repoKey = computeRepoKey(harnessDir);
    const sessionDir = path.join(sessionsRoot, repoKey, 'real1');
    expect(fs.existsSync(path.join(sessionDir, 'meta.json'))).toBe(true);
    expect(fs.existsSync(path.join(sessionDir, 'events.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(sessionDir, 'summary.json'))).toBe(true);

    const summary = JSON.parse(fs.readFileSync(path.join(sessionDir, 'summary.json'), 'utf-8'));
    expect(summary.status).toBe('completed');
    expect(summary.phases['2']?.attempts.some((a: any) => a.verdict === 'APPROVE')).toBe(true);
  });
});
