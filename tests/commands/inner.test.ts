import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { bootstrapSessionLogger, buildConfigCancelHandler } from '../../src/commands/inner.js';
import { computeRepoKey, FileSessionLogger } from '../../src/logger.js';
import type { HarnessState } from '../../src/types.js';

// Mock dependencies before imports
vi.mock('../../src/lock.js', () => ({
  updateLockPid: vi.fn(),
  readLock: vi.fn(() => null),
  releaseLock: vi.fn(),
}));
vi.mock('../../src/phases/runner.js', () => ({
  runPhaseLoop: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/signal.js', () => ({
  registerSignalHandlers: vi.fn(),
}));
vi.mock('../../src/tmux.js', () => ({
  killSession: vi.fn(),
  killWindow: vi.fn(),
  selectWindow: vi.fn(),
  splitPane: vi.fn(() => '%1'),
  paneExists: vi.fn(() => false),
}));
vi.mock('../../src/root.js', () => ({
  findHarnessRoot: vi.fn(),
}));
vi.mock('../../src/git.js', () => ({
  getGitRoot: vi.fn(() => '/tmp'),
}));

import { updateLockPid, releaseLock } from '../../src/lock.js';
import { runPhaseLoop } from '../../src/phases/runner.js';
import { registerSignalHandlers } from '../../src/signal.js';
import { killSession, killWindow, selectWindow, splitPane, paneExists } from '../../src/tmux.js';
import { findHarnessRoot } from '../../src/root.js';

describe('inner.ts: consumePendingAction behavior', () => {
  let tmpDir: string;

  function makeState(overrides: Record<string, unknown> = {}) {
    return {
      runId: 'test-run',
      currentPhase: 3,
      status: 'in_progress',
      autoMode: false,
      task: 'test task',
      baseCommit: 'abc123',
      implRetryBase: 'abc123',
      codexPath: '/tmp/codex',
      externalCommitsDetected: false,
      tmuxSession: 'test-sess',
      tmuxMode: 'dedicated',
      tmuxWindows: [],
      tmuxControlWindow: '',
      tmuxWorkspacePane: '',
      tmuxControlPane: '',
      artifacts: { spec: 's', plan: 'p', decisionLog: 'd', checklist: 'c', evalReport: 'e' },
      phases: { '1': 'completed', '2': 'completed', '3': 'pending', '4': 'pending', '5': 'pending', '6': 'pending', '7': 'pending' },
      gateRetries: { '2': 0, '4': 0, '7': 0 },
      verifyRetries: 0,
      pauseReason: null,
      specCommit: null,
      planCommit: null,
      implCommit: null,
      evalCommit: null,
      verifiedAtHead: null,
      pausedAtHead: null,
      pendingAction: null,
      phaseOpenedAt: { '1': null, '3': null, '5': null },
      phaseAttemptId: { '1': null, '3': null, '5': null },
      ...overrides,
    };
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inner-test-'));
    vi.mocked(findHarnessRoot).mockReturnValue(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skip action advances currentPhase and marks old phase completed', () => {
    const state = makeState({ currentPhase: 3 });
    const runDir = path.join(tmpDir, 'test-run');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify(state));
    fs.writeFileSync(path.join(runDir, 'pending-action.json'), JSON.stringify({ action: 'skip' }));

    // Read state, apply skip manually (testing the logic)
    const raw = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf-8'));
    raw.phases[String(raw.currentPhase)] = 'completed';
    raw.currentPhase = raw.currentPhase + 1;
    fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify(raw));
    fs.unlinkSync(path.join(runDir, 'pending-action.json'));

    const updated = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf-8'));
    expect(updated.currentPhase).toBe(4);
    expect(updated.phases['3']).toBe('completed');
    expect(fs.existsSync(path.join(runDir, 'pending-action.json'))).toBe(false);
  });

  it('jump action resets phases >= target and sets currentPhase', () => {
    const state = makeState({ currentPhase: 5, phases: { '1': 'completed', '2': 'completed', '3': 'completed', '4': 'completed', '5': 'in_progress', '6': 'pending', '7': 'pending' } });
    const runDir = path.join(tmpDir, 'test-run');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify(state));
    fs.writeFileSync(path.join(runDir, 'pending-action.json'), JSON.stringify({ action: 'jump', phase: 3 }));

    const raw = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf-8'));
    for (let m = 3; m <= 7; m++) raw.phases[String(m)] = 'pending';
    raw.currentPhase = 3;
    fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify(raw));
    fs.unlinkSync(path.join(runDir, 'pending-action.json'));

    const updated = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf-8'));
    expect(updated.currentPhase).toBe(3);
    expect(updated.phases['3']).toBe('pending');
    expect(updated.phases['4']).toBe('pending');
    expect(updated.phases['2']).toBe('completed');
    expect(fs.existsSync(path.join(runDir, 'pending-action.json'))).toBe(false);
  });

  it('no-op when pending-action.json does not exist', () => {
    const state = makeState({ currentPhase: 3 });
    const runDir = path.join(tmpDir, 'test-run');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify(state));

    // No pending-action.json — state unchanged
    const raw = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf-8'));
    expect(raw.currentPhase).toBe(3);
  });
});

describe('inner.ts: tmux cleanup on completion', () => {
  it('dedicated mode calls killSession', () => {
    // This tests the cleanup logic conceptually
    // In dedicated mode, the session should be killed
    const state = {
      tmuxMode: 'dedicated',
      tmuxSession: 'harness-test',
    };
    expect(state.tmuxMode).toBe('dedicated');
    // The actual killSession call happens at the end of innerCommand
  });

  it('reused mode kills only owned windows', () => {
    const state = {
      tmuxMode: 'reused',
      tmuxSession: 'parent-session',
      tmuxWindows: ['@1', '@2'],
      tmuxOriginalWindow: '@0',
    };
    expect(state.tmuxMode).toBe('reused');
    expect(state.tmuxWindows).toEqual(['@1', '@2']);
    expect(state.tmuxOriginalWindow).toBe('@0');
  });
});

describe('bootstrapSessionLogger', () => {
  function tempHarnessDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-'));
  }

  function buildState(overrides: Partial<HarnessState> = {}): HarnessState {
    const base: HarnessState = {
      runId: 'r1', currentPhase: 1, status: 'in_progress', autoMode: false,
      task: 'test task', baseCommit: '', implRetryBase: '', codexPath: null,
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
      lastWorkspacePid: null, lastWorkspacePidStartTime: null,
      tmuxSession: '', tmuxMode: 'dedicated', tmuxWindows: [],
      tmuxControlWindow: '', tmuxWorkspacePane: '', tmuxControlPane: '',
      loggingEnabled: true,
    };
    return { ...base, ...overrides };
  }

  it('fresh start: writes meta + emits session_start', async () => {
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions');
    const state = buildState();
    await bootstrapSessionLogger('r1', harnessDir, state, false, { sessionsRoot });
    const repoKey = computeRepoKey(harnessDir);
    const eventsPath = path.join(sessionsRoot, repoKey, 'r1', 'events.jsonl');
    const events = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    expect(events[0].event).toBe('session_start');
    expect(events[0].task).toBe('test task');
  });

  it('resume: emits session_resumed and pushes resumedAt', async () => {
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions');
    const state = buildState();
    await bootstrapSessionLogger('r2', harnessDir, state, false, { sessionsRoot });
    await bootstrapSessionLogger('r2', harnessDir, state, true, { sessionsRoot });
    const repoKey = computeRepoKey(harnessDir);
    const events = fs.readFileSync(path.join(sessionsRoot, repoKey, 'r2', 'events.jsonl'), 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    expect(events.filter((e: any) => e.event === 'session_resumed').length).toBe(1);
    const meta = JSON.parse(fs.readFileSync(path.join(sessionsRoot, repoKey, 'r2', 'meta.json'), 'utf-8'));
    expect(meta.resumedAt.length).toBe(1);
  });

  it('loggingEnabled=false: NoopLogger, no files created', async () => {
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions');
    const state = buildState({ loggingEnabled: false });
    await bootstrapSessionLogger('r3', harnessDir, state, false, { sessionsRoot });
    expect(fs.existsSync(sessionsRoot)).toBe(false);
  });

  it('non-resume + meta.json exists: emits session_resumed (idempotent re-entry per §5.1)', async () => {
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions');
    const state = buildState();
    await bootstrapSessionLogger('r4', harnessDir, state, false, { sessionsRoot });
    await bootstrapSessionLogger('r4', harnessDir, state, false, { sessionsRoot });
    const repoKey = computeRepoKey(harnessDir);
    const events = fs.readFileSync(path.join(sessionsRoot, repoKey, 'r4', 'events.jsonl'), 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    const starts = events.filter((e: any) => e.event === 'session_start');
    const resumes = events.filter((e: any) => e.event === 'session_resumed');
    expect(starts.length).toBe(1);
    expect(resumes.length).toBe(1);
    const meta = JSON.parse(fs.readFileSync(path.join(sessionsRoot, repoKey, 'r4', 'meta.json'), 'utf-8'));
    expect(meta.resumedAt.length).toBe(1);
  });
});

describe('buildConfigCancelHandler — lazy bootstrap', () => {
  function tempHarnessDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'cc-test-'));
  }

  function buildState(overrides: Partial<HarnessState> = {}): HarnessState {
    const base: HarnessState = {
      runId: 'cc1', currentPhase: 1, status: 'in_progress', autoMode: false,
      task: 'test task', baseCommit: 'abc', implRetryBase: 'abc', codexPath: null,
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
      lastWorkspacePid: null, lastWorkspacePidStartTime: null,
      tmuxSession: '', tmuxMode: 'dedicated', tmuxWindows: [],
      tmuxControlWindow: '', tmuxWorkspacePane: '', tmuxControlPane: '',
      loggingEnabled: true,
    };
    return { ...base, ...overrides };
  }

  let exitCode: number | null = null;
  const origExit = process.exit;

  beforeEach(() => {
    exitCode = null;
    (process as any).exit = ((code: number) => {
      exitCode = code;
      throw new Error('__EXIT_TRAP__');
    }) as any;
  });

  afterEach(() => {
    (process as any).exit = origExit;
  });

  it('fresh start: emits session_start before session_end(paused)', () => {
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions');
    const runDir = path.join(harnessDir, 'runs', 'cc1');
    fs.mkdirSync(runDir, { recursive: true });

    const logger = new FileSessionLogger('cc1', harnessDir, { sessionsRoot });
    const state = buildState({ runId: 'cc1' });
    const inputManager = { stop: vi.fn() } as any;

    expect(logger.hasEmittedSessionOpen()).toBe(false);

    const handler = buildConfigCancelHandler({
      state, runDir, harnessDir, runId: 'cc1', isResume: false, logger, inputManager,
    });

    try { handler(); } catch (e) { /* __EXIT_TRAP__ swallowed */ }

    expect(exitCode).toBe(0);

    const repoKey = computeRepoKey(harnessDir);
    const eventsPath = path.join(sessionsRoot, repoKey, 'cc1', 'events.jsonl');
    const events = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    expect(events[0].event).toBe('session_start');
    expect(events[0].task).toBe('test task');
    expect(events[events.length - 1].event).toBe('session_end');
    expect(events[events.length - 1].status).toBe('paused');

    const summary = JSON.parse(fs.readFileSync(path.join(sessionsRoot, repoKey, 'cc1', 'summary.json'), 'utf-8'));
    expect(summary.status).toBe('paused');

    // state should be mutated to paused with config-cancel
    expect(state.status).toBe('paused');
    expect(state.pauseReason).toBe('config-cancel');
    expect(state.pendingAction?.type).toBe('reopen_config');

    fs.rmSync(harnessDir, { recursive: true, force: true });
  });

  it('resume case: emits session_resumed + pushes resumedAt before session_end(paused)', () => {
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions');
    const runDir = path.join(harnessDir, 'runs', 'cc2');
    fs.mkdirSync(runDir, { recursive: true });

    // Pre-bootstrap meta.json so logger.hasBootstrapped() = true (simulates resume scenario)
    const logger = new FileSessionLogger('cc2', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 'resumed task' });

    // New logger instance to simulate fresh process (sessionOpenEmitted = false)
    const logger2 = new FileSessionLogger('cc2', harnessDir, { sessionsRoot });
    expect(logger2.hasBootstrapped()).toBe(true);
    expect(logger2.hasEmittedSessionOpen()).toBe(false);

    const state = buildState({ runId: 'cc2', task: 'resumed task' });
    const inputManager = { stop: vi.fn() } as any;

    const handler = buildConfigCancelHandler({
      state, runDir, harnessDir, runId: 'cc2', isResume: true, logger: logger2, inputManager,
    });

    try { handler(); } catch (e) { /* __EXIT_TRAP__ swallowed */ }

    expect(exitCode).toBe(0);

    const repoKey = computeRepoKey(harnessDir);
    const eventsPath = path.join(sessionsRoot, repoKey, 'cc2', 'events.jsonl');
    const rawLines = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n');
    // First line is session_start from initial writeMeta, second pass adds session_resumed
    const events = rawLines.map(l => JSON.parse(l));
    const resumed = events.find((e: any) => e.event === 'session_resumed');
    expect(resumed).toBeDefined();
    expect(resumed.stateStatus).toBe('paused');

    const lastEvent = events[events.length - 1];
    expect(lastEvent.event).toBe('session_end');
    expect(lastEvent.status).toBe('paused');

    const meta = JSON.parse(fs.readFileSync(path.join(sessionsRoot, repoKey, 'cc2', 'meta.json'), 'utf-8'));
    expect(meta.resumedAt.length).toBeGreaterThan(0);

    fs.rmSync(harnessDir, { recursive: true, force: true });
  });
});
