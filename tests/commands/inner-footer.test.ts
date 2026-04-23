import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DistributiveOmit, HarnessState, LogEvent, SessionLogger, SessionMeta } from '../../src/types.js';

const shared = vi.hoisted(() => ({
  state: null as HarnessState | null,
  logger: null as SessionLogger | null,
  footerTimer: null as { stop: ReturnType<typeof vi.fn>; forceTick: ReturnType<typeof vi.fn> } | null,
  runPhaseLoopError: null as Error | null,
  callOrder: [] as string[],
  inputManagerInstance: null as {
    start: ReturnType<typeof vi.fn>;
    enterPhaseLoop: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    onConfigCancel?: () => void;
  } | null,
}));

vi.mock('../../src/logger.js', () => ({
  createSessionLogger: vi.fn(() => shared.logger),
}));

vi.mock('../../src/commands/footer-ticker.js', () => ({
  startFooterTicker: vi.fn(() => {
    shared.callOrder.push('startFooterTicker');
    return shared.footerTimer;
  }),
}));

vi.mock('../../src/phases/runner.js', () => ({
  runPhaseLoop: vi.fn(async () => {
    shared.callOrder.push('runPhaseLoop');
    if (shared.runPhaseLoopError) throw shared.runPhaseLoopError;
  }),
}));

vi.mock('../../src/input.js', () => ({
  InputManager: class MockInputManager {
    onConfigCancel?: () => void;
    start = vi.fn();
    enterPhaseLoop = vi.fn(() => {
      shared.callOrder.push('enterPhaseLoop');
    });
    stop = vi.fn();

    constructor() {
      shared.inputManagerInstance = this;
    }
  },
}));

vi.mock('../../src/lock.js', () => ({
  updateLockPid: vi.fn(),
  readLock: vi.fn(() => null),
  releaseLock: vi.fn(),
}));

vi.mock('../../src/root.js', () => ({
  findHarnessRoot: vi.fn(),
  clearCurrentRun: vi.fn(),
}));

vi.mock('../../src/git.js', () => ({
  getGitRoot: vi.fn(() => '/repo'),
}));

vi.mock('../../src/state.js', () => ({
  readState: vi.fn(() => shared.state),
  writeState: vi.fn(),
  invalidatePhaseSessionsOnPresetChange: vi.fn(),
  invalidatePhaseSessionsOnJump: vi.fn(),
}));

vi.mock('../../src/signal.js', () => ({
  registerSignalHandlers: vi.fn(),
}));

vi.mock('../../src/tmux.js', () => ({
  killSession: vi.fn(),
  killWindow: vi.fn(),
  selectWindow: vi.fn(),
  splitPane: vi.fn(() => '%3'),
  paneExists: vi.fn(() => true),
  selectPane: vi.fn(),
}));

vi.mock('../../src/ui.js', () => ({
  renderWelcome: vi.fn(),
  promptModelConfig: vi.fn(async (phasePresets: HarnessState['phasePresets']) => phasePresets),
}));

vi.mock('../../src/preflight.js', () => ({
  runRunnerAwarePreflight: vi.fn(),
}));

vi.mock('../../src/runners/codex-isolation.js', () => ({
  codexHomeFor: vi.fn(() => '/tmp/codex-home'),
}));

import { innerCommand } from '../../src/commands/inner.js';
import { startFooterTicker } from '../../src/commands/footer-ticker.js';
import { findHarnessRoot } from '../../src/root.js';

function makeHarnessState(runId: string): HarnessState {
  return {
    runId,
    flow: 'full',
    carryoverFeedback: null,
    currentPhase: 5,
    status: 'in_progress',
    autoMode: false,
    task: 'existing task',
    baseCommit: 'abc123',
    implRetryBase: 'abc123',
    trackedRepos: [{ path: '', baseCommit: 'abc123', implRetryBase: 'abc123', implHead: null }],
    codexPath: '/tmp/codex',
    externalCommitsDetected: false,
    artifacts: { spec: 'spec.md', plan: 'plan.md', decisionLog: 'decision-log.md', checklist: 'checklist.md', evalReport: 'eval-report.md' },
    phases: { '1': 'completed', '2': 'completed', '3': 'completed', '4': 'completed', '5': 'pending', '6': 'pending', '7': 'pending' },
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
    phasePresets: {},
    phaseReopenFlags: { '1': false, '3': false, '5': false },
    phaseReopenSource: { '1': null, '3': null, '5': null },
    phaseCodexSessions: { '2': null, '4': null, '7': null },
    phaseClaudeSessions: { '1': null, '3': null, '5': null },
    lastWorkspacePid: null,
    lastWorkspacePidStartTime: null,
    tmuxSession: 'harness-session',
    tmuxMode: 'dedicated',
    tmuxWindows: [],
    tmuxControlWindow: '@1',
    tmuxWorkspacePane: '%2',
    tmuxControlPane: '',
    loggingEnabled: true,
    codexNoIsolate: false,
    dirtyBaseline: [],
  };
}

function makeLogger(): SessionLogger {
  return {
    logEvent: vi.fn((_event: DistributiveOmit<LogEvent, 'v' | 'ts' | 'runId'>) => {}),
    writeMeta: vi.fn((_partial: Partial<SessionMeta> & { task: string }) => {}),
    updateMeta: vi.fn((_update: { pushResumedAt?: number; task?: string; codexHome?: string }) => {}),
    finalizeSummary: vi.fn(),
    close: vi.fn(),
    hasBootstrapped: vi.fn(() => false),
    hasEmittedSessionOpen: vi.fn(() => true),
    getStartedAt: vi.fn(() => 1_000),
    getEventsPath: vi.fn(() => '/tmp/events.jsonl'),
  };
}

describe('innerCommand footer ticker wiring', () => {
  let harnessDir: string;
  let runDir: string;
  let processOnSpy: any;
  let processRemoveListenerSpy: any;

  beforeEach(() => {
    harnessDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inner-footer-test-'));
    runDir = path.join(harnessDir, 'run-1');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'task.md'), 'existing task');

    shared.state = makeHarnessState('run-1');
    shared.logger = makeLogger();
    shared.footerTimer = {
      stop: vi.fn(),
      forceTick: vi.fn(),
    };
    shared.runPhaseLoopError = null;
    shared.callOrder.length = 0;
    shared.inputManagerInstance = null;

    vi.mocked(findHarnessRoot).mockReturnValue(harnessDir);

    processOnSpy = vi.spyOn(process, 'on').mockImplementation((() => process) as typeof process.on);
    processRemoveListenerSpy = vi.spyOn(process, 'removeListener').mockImplementation((() => process) as typeof process.removeListener);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(harnessDir, { recursive: true, force: true });
  });

  it('starts the footer ticker after entering the phase loop and removes the same SIGWINCH listener on normal completion', async () => {
    const logger = shared.logger!;
    const footerTimer = shared.footerTimer!;
    const stateJsonPath = path.join(runDir, 'state.json');

    await innerCommand('run-1', { controlPane: '%1' });

    expect(shared.callOrder).toEqual([
      'enterPhaseLoop',
      'startFooterTicker',
      'runPhaseLoop',
    ]);
    expect(startFooterTicker).toHaveBeenCalledOnce();
    expect(startFooterTicker).toHaveBeenCalledWith({
      logger,
      stateJsonPath,
      intervalMs: 1000,
    });

    const registeredListener = processOnSpy.mock.calls.find(
      (call: [string | symbol, (...args: unknown[]) => void]) => call[0] === 'SIGWINCH',
    )?.[1];
    const removedListener = processRemoveListenerSpy.mock.calls.find(
      (call: [string | symbol, (...args: unknown[]) => void]) => call[0] === 'SIGWINCH',
    )?.[1];

    expect(processOnSpy).toHaveBeenCalledWith('SIGWINCH', footerTimer.forceTick);
    expect(processRemoveListenerSpy).toHaveBeenCalledWith('SIGWINCH', footerTimer.forceTick);
    expect(registeredListener).toBe(footerTimer.forceTick);
    expect(removedListener).toBe(registeredListener);
    expect(footerTimer.stop).toHaveBeenCalledTimes(1);
    expect(footerTimer.stop.mock.invocationCallOrder[0]).toBeLessThan(processRemoveListenerSpy.mock.invocationCallOrder[0]);
    expect(processRemoveListenerSpy.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(logger.close).mock.invocationCallOrder[0]);
  });

  it('runs the same footer cleanup in finally when runPhaseLoop throws', async () => {
    const footerTimer = shared.footerTimer!;
    shared.runPhaseLoopError = new Error('phase loop failed');

    await expect(innerCommand('run-1', { controlPane: '%1' })).rejects.toThrow('phase loop failed');

    const registeredListener = processOnSpy.mock.calls.find(
      (call: [string | symbol, (...args: unknown[]) => void]) => call[0] === 'SIGWINCH',
    )?.[1];
    const removedListener = processRemoveListenerSpy.mock.calls.find(
      (call: [string | symbol, (...args: unknown[]) => void]) => call[0] === 'SIGWINCH',
    )?.[1];

    expect(processOnSpy).toHaveBeenCalledWith('SIGWINCH', footerTimer.forceTick);
    expect(processRemoveListenerSpy).toHaveBeenCalledWith('SIGWINCH', footerTimer.forceTick);
    expect(registeredListener).toBe(footerTimer.forceTick);
    expect(removedListener).toBe(registeredListener);
    expect(footerTimer.stop).toHaveBeenCalledTimes(1);
  });
});
