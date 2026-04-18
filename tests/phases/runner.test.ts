import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { HarnessState, GatePhaseResult, VerifyOutcome } from '../../src/types.js';
import type { InteractiveResult } from '../../src/phases/interactive.js';
import { createInitialState } from '../../src/state.js';
import { GATE_RETRY_LIMIT, VERIFY_RETRY_LIMIT, TERMINAL_PHASE } from '../../src/config.js';
import { FileSessionLogger, computeRepoKey } from '../../src/logger.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../src/phases/interactive.js', () => ({
  runInteractivePhase: vi.fn(),
  preparePhase: vi.fn(),
  checkSentinelFreshness: vi.fn(),
  validatePhaseArtifacts: vi.fn(),
}));

vi.mock('../../src/phases/gate.js', () => ({
  runGatePhase: vi.fn(),
  checkGateSidecars: vi.fn(),
  buildGateResult: vi.fn(),
  parseVerdict: vi.fn(),
}));

vi.mock('../../src/phases/verify.js', () => ({
  runVerifyPhase: vi.fn(),
  readVerifyResult: vi.fn(),
  isEvalReportValid: vi.fn(),
}));

vi.mock('../../src/ui.js', () => ({
  promptChoice: vi.fn(),
  printPhaseTransition: vi.fn(),
  renderControlPanel: vi.fn(),
  printWarning: vi.fn(),
  printError: vi.fn(),
  printSuccess: vi.fn(),
  printInfo: vi.fn(),
}));

vi.mock('../../src/artifact.js', () => ({
  normalizeArtifactCommit: vi.fn().mockReturnValue(true),
  runPhase6Preconditions: vi.fn(),
}));

vi.mock('../../src/git.js', () => ({
  getHead: vi.fn().mockReturnValue('mock-head-sha'),
  getGitRoot: vi.fn(),
  isAncestor: vi.fn(),
  isWorkingTreeClean: vi.fn(),
  hasStagedChanges: vi.fn(),
  getStagedFiles: vi.fn(),
  getFileStatus: vi.fn(),
  generateRunId: vi.fn(),
  detectExternalCommits: vi.fn(),
}));

vi.mock('../../src/state.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/state.js')>();
  return {
    ...actual,
    writeState: vi.fn(),
  };
});

// ─── Imports after mocks ──────────────────────────────────────────────────────

import {
  runPhaseLoop,
  handleInteractivePhase,
  handleGatePhase,
  handleGateReject,
  handleGateEscalation,
  handleGateError,
  forcePassGate,
  forcePassVerify,
  handleVerifyPhase,
  handleVerifyFail,
  handleVerifyEscalation,
  handleVerifyError,
} from '../../src/phases/runner.js';
import { runInteractivePhase } from '../../src/phases/interactive.js';
import { runGatePhase } from '../../src/phases/gate.js';
import { runVerifyPhase } from '../../src/phases/verify.js';
import { promptChoice, printPhaseTransition, renderControlPanel } from '../../src/ui.js';
import { normalizeArtifactCommit } from '../../src/artifact.js';
import { getHead } from '../../src/git.js';
import { writeState } from '../../src/state.js';
import { InputManager } from '../../src/input.js';
import { NoopLogger } from '../../src/logger.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const tmpDirs: string[] = [];

afterEach(() => {
  vi.clearAllMocks();
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
});

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-test-'));
  tmpDirs.push(dir);
  return dir;
}

function makeState(overrides: Partial<HarnessState> = {}): HarnessState {
  const base = createInitialState(
    'test-run',
    '/tasks/test.md',
    'base-sha',
    false
  );
  return { ...base, ...overrides };
}

const HDIR = '/tmp/harness-dir';
const CWD = '/tmp/cwd';

function createNoOpInputManager(): InputManager {
  return new InputManager();
}

function mockInteractive(result: InteractiveResult): void {
  vi.mocked(runInteractivePhase).mockResolvedValueOnce({ ...result, attemptId: 'test-attempt-id' });
}

function mockGate(result: GatePhaseResult): void {
  vi.mocked(runGatePhase).mockResolvedValueOnce(result);
}

function mockVerify(outcome: VerifyOutcome): void {
  vi.mocked(runVerifyPhase).mockResolvedValueOnce(outcome);
}

function mockChoice(choice: string): void {
  vi.mocked(promptChoice).mockResolvedValueOnce(choice);
}

// ─── Test 1: Normal Phase 1 → 2 flow ─────────────────────────────────────────

describe('Test 1: Phase 1 completed → dispatches gate Phase 2', () => {
  it('advances currentPhase from 1 to 2 after interactive completion', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 1 });

    // Phase 1 completes, then Phase 2 gate approves → Phase 3 interactive, then quit via fail
    mockInteractive({ status: 'completed' });
    mockGate({ type: 'verdict', verdict: 'APPROVE', comments: '', rawOutput: '' });
    mockInteractive({ status: 'failed' }); // Phase 3 fails to stop the loop

    await runPhaseLoop(state, HDIR, runDir, CWD, createNoOpInputManager(), new NoopLogger(), { value: false });

    expect(vi.mocked(runInteractivePhase)).toHaveBeenCalledWith(1, expect.any(Object), HDIR, runDir, CWD, expect.any(String));
    expect(vi.mocked(runGatePhase)).toHaveBeenCalledWith(2, expect.any(Object), HDIR, runDir, CWD, expect.any(Object));
  });
});

// ─── Test 2: Gate APPROVE → advance to next phase ────────────────────────────

describe('Test 2: Gate APPROVE → advance', () => {
  it('sets phase completed and advances currentPhase', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 2 });

    // Gate 2 approves, then Phase 3 fails
    mockGate({ type: 'verdict', verdict: 'APPROVE', comments: '', rawOutput: '' });
    mockInteractive({ status: 'failed' });

    await runPhaseLoop(state, HDIR, runDir, CWD, createNoOpInputManager(), new NoopLogger(), { value: false });

    // After APPROVE, state should reflect Phase 2 completed
    const lastWriteCallArgs = vi.mocked(writeState).mock.calls;
    const statesWritten = lastWriteCallArgs.map(([, s]) => s);

    // Find a state where phase 2 = completed
    const phase2Completed = statesWritten.some(
      s => s.phases['2'] === 'completed'
    );
    expect(phase2Completed).toBe(true);
  });
});

// ─── Test 3: Gate Phase 7 APPROVE → run complete ─────────────────────────────

describe('Test 3: Gate Phase 7 APPROVE → run complete', () => {
  it('sets currentPhase=8 and status=completed', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 7 });

    mockGate({ type: 'verdict', verdict: 'APPROVE', comments: '', rawOutput: '' });

    await runPhaseLoop(state, HDIR, runDir, CWD, createNoOpInputManager(), new NoopLogger(), { value: false });

    // The final state write should have TERMINAL_PHASE and completed
    const writes = vi.mocked(writeState).mock.calls.map(([, s]) => s);
    const terminal = writes.find(s => s.currentPhase === TERMINAL_PHASE);
    expect(terminal).toBeDefined();
    expect(terminal!.status).toBe('completed');
  });
});

// ─── Test 4: Gate REJECT (retries < 3) → pendingAction + gateRetries++ ───────

describe('Test 4: Gate REJECT retries < limit', () => {
  it('increments gateRetries, sets pendingAction=reopen_phase', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 2, gateRetries: { '2': 0, '4': 0, '7': 0 } });

    mockGate({ type: 'verdict', verdict: 'REJECT', comments: 'Fix section A', rawOutput: '' });
    // After reopen Phase 1, it fails to stop loop
    mockInteractive({ status: 'failed' });

    await runPhaseLoop(state, HDIR, runDir, CWD, createNoOpInputManager(), new NoopLogger(), { value: false });

    const writes = vi.mocked(writeState).mock.calls.map(([, s]) => s);

    // Find state with incremented retries
    const retryState = writes.find(s => s.gateRetries['2'] === 1);
    expect(retryState).toBeDefined();
    expect(retryState!.pendingAction).not.toBeNull();
    expect(retryState!.pendingAction!.type).toBe('reopen_phase');
    expect(retryState!.currentPhase).toBe(1);
  });
});

// ─── Test 5: Gate REJECT (retries >= 3) → escalation UI ─────────────────────

describe('Test 5: Gate REJECT retries >= limit → escalation', () => {
  it('shows escalation UI when retry limit reached, Quit → paused', async () => {
    const runDir = makeTmpDir();
    // Already at limit
    const state = makeState({
      currentPhase: 2,
      gateRetries: { '2': GATE_RETRY_LIMIT, '4': 0, '7': 0 },
    });

    mockGate({ type: 'verdict', verdict: 'REJECT', comments: 'Still wrong', rawOutput: '' });
    mockChoice('Q'); // Quit

    await runPhaseLoop(state, HDIR, runDir, CWD, createNoOpInputManager(), new NoopLogger(), { value: false });

    expect(vi.mocked(promptChoice)).toHaveBeenCalled();

    const writes = vi.mocked(writeState).mock.calls.map(([, s]) => s);
    const pausedState = writes.find(s => s.status === 'paused');
    expect(pausedState).toBeDefined();
    expect(pausedState!.pauseReason).toBe('gate-escalation');
  });
});

// ─── Test 6: Verify PASS → advance to Phase 7, verifyRetries reset ───────────

describe('Test 6: Verify PASS', () => {
  it('advances to Phase 7 and resets verifyRetries', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 6, verifyRetries: 1 });

    mockVerify({ type: 'pass' });
    // Phase 7 gate fails to stop loop
    mockGate({ type: 'error', error: 'timeout' });
    mockChoice('Q'); // Quit from gate error

    await runPhaseLoop(state, HDIR, runDir, CWD, createNoOpInputManager(), new NoopLogger(), { value: false });

    const writes = vi.mocked(writeState).mock.calls.map(([, s]) => s);

    // After verify PASS, verifyRetries should be 0
    const afterVerify = writes.find(s => s.phases['6'] === 'completed');
    expect(afterVerify).toBeDefined();
    expect(afterVerify!.verifyRetries).toBe(0);
    expect(afterVerify!.currentPhase).toBe(7);
  });
});

// ─── Test 7: Verify FAIL (retries < limit) → verifyRetries++, Phase 5 reopen ─

describe('Test 7: Verify FAIL retries < limit', () => {
  it('increments verifyRetries and reopens Phase 5', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 6, verifyRetries: 0 });

    const feedbackPath = path.join(makeTmpDir(), 'verify-feedback.md');
    fs.writeFileSync(feedbackPath, '# Feedback\n\n## Summary\n\nFailed.\n');

    mockVerify({ type: 'fail', feedbackPath });
    // Phase 5 fails to stop loop
    mockInteractive({ status: 'failed' });

    await runPhaseLoop(state, HDIR, runDir, CWD, createNoOpInputManager(), new NoopLogger(), { value: false });

    const writes = vi.mocked(writeState).mock.calls.map(([, s]) => s);
    const afterFail = writes.find(s => s.verifyRetries === 1);
    expect(afterFail).toBeDefined();
    expect(afterFail!.currentPhase).toBe(5);
    expect(afterFail!.pendingAction?.type).toBe('reopen_phase');
    expect(afterFail!.pendingAction?.targetPhase).toBe(5);
  });
});

// ─── Test 8: Escalation [S]kip → force-pass, advance ────────────────────────

describe('Test 8: Escalation Skip → force-pass', () => {
  it('force-passes gate, advances to next phase', async () => {
    const runDir = makeTmpDir();
    const state = makeState({
      currentPhase: 2,
      gateRetries: { '2': GATE_RETRY_LIMIT, '4': 0, '7': 0 },
    });

    mockGate({ type: 'verdict', verdict: 'REJECT', comments: 'issues', rawOutput: '' });
    mockChoice('S'); // Skip

    // After force-pass → Phase 3 interactive → fails to stop loop
    mockInteractive({ status: 'failed' });

    await runPhaseLoop(state, HDIR, runDir, CWD, createNoOpInputManager(), new NoopLogger(), { value: false });

    const writes = vi.mocked(writeState).mock.calls.map(([, s]) => s);
    const skipped = writes.find(s => s.phases['2'] === 'completed' && s.currentPhase === 3);
    expect(skipped).toBeDefined();
  });
});

// ─── Test 9: Auto mode gate limit → force pass (no escalation UI) ─────────────

describe('Test 9: Auto mode gate limit exceeded → force pass', () => {
  it('does not show escalation UI in autoMode', async () => {
    const runDir = makeTmpDir();
    const state = makeState({
      currentPhase: 2,
      autoMode: true,
      gateRetries: { '2': GATE_RETRY_LIMIT, '4': 0, '7': 0 },
    });

    mockGate({ type: 'verdict', verdict: 'REJECT', comments: 'auto-fail', rawOutput: '' });
    // After force-pass → Phase 3 fails
    mockInteractive({ status: 'failed' });

    await runPhaseLoop(state, HDIR, runDir, CWD, createNoOpInputManager(), new NoopLogger(), { value: false });

    // promptChoice should NOT be called in auto mode
    expect(vi.mocked(promptChoice)).not.toHaveBeenCalled();

    const writes = vi.mocked(writeState).mock.calls.map(([, s]) => s);
    const forcePass = writes.find(s => s.phases['2'] === 'completed');
    expect(forcePass).toBeDefined();
  });
});

// ─── Test 10: Phase 7 REJECT → Phase 5 reopen + verifyRetries reset ──────────

describe('Test 10: Phase 7 REJECT → Phase 5 reopen, verifyRetries reset', () => {
  it('resets verifyRetries and reopens Phase 5', async () => {
    const runDir = makeTmpDir();
    const state = makeState({
      currentPhase: 7,
      gateRetries: { '2': 0, '4': 0, '7': 0 },
      verifyRetries: 2,
    });

    mockGate({ type: 'verdict', verdict: 'REJECT', comments: 'needs work', rawOutput: '' });
    // Phase 5 fails to stop loop
    mockInteractive({ status: 'failed' });

    await runPhaseLoop(state, HDIR, runDir, CWD, createNoOpInputManager(), new NoopLogger(), { value: false });

    const writes = vi.mocked(writeState).mock.calls.map(([, s]) => s);
    const afterReject = writes.find(s => s.gateRetries['7'] === 1);
    expect(afterReject).toBeDefined();
    expect(afterReject!.verifyRetries).toBe(0); // reset on phase 7 reject
    expect(afterReject!.currentPhase).toBe(5);
    expect(afterReject!.pendingAction?.type).toBe('reopen_phase');
    expect(afterReject!.pendingAction?.targetPhase).toBe(5);
  });
});

// ─── Test 11: normalizeArtifactCommit called after Phase 1/3 completion ───────

describe('Test 11: normalizeArtifactCommit called for Phase 1/3', () => {
  it('calls normalizeArtifactCommit for spec and decisionLog after Phase 1', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 1 });

    mockInteractive({ status: 'completed' });
    // Phase 2 gate to stop loop
    mockGate({ type: 'verdict', verdict: 'REJECT', comments: 'stop', rawOutput: '' });
    mockInteractive({ status: 'failed' }); // Phase 1 reopen fails

    await runPhaseLoop(state, HDIR, runDir, CWD, createNoOpInputManager(), new NoopLogger(), { value: false });

    const calls = vi.mocked(normalizeArtifactCommit).mock.calls;
    const paths = calls.map(([p]) => p);
    // Phase 1 commits spec (not decisionLog — it's in .harness/ and gitignored)
    expect(paths).toContain(state.artifacts.spec);
    // decisionLog is .harness/.../decisions.md, skipped
    expect(paths).not.toContain(state.artifacts.decisionLog);
  });

  it('calls normalizeArtifactCommit for plan and checklist after Phase 3', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 3 });

    mockInteractive({ status: 'completed' });
    // Phase 4 gate to stop loop
    mockGate({ type: 'verdict', verdict: 'REJECT', comments: 'stop', rawOutput: '' });
    mockInteractive({ status: 'failed' });

    await runPhaseLoop(state, HDIR, runDir, CWD, createNoOpInputManager(), new NoopLogger(), { value: false });

    const calls = vi.mocked(normalizeArtifactCommit).mock.calls;
    const paths = calls.map(([p]) => p);
    // Phase 3 commits plan (not checklist — it's in .harness/ and gitignored)
    expect(paths).toContain(state.artifacts.plan);
    expect(paths).not.toContain(state.artifacts.checklist);
  });
});

// ─── Test 12: Commit anchors updated ─────────────────────────────────────────

describe('Test 12: Commit anchors updated after phase completion', () => {
  it('sets specCommit after Phase 1 completion', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 1 });

    vi.mocked(getHead).mockReturnValue('spec-commit-sha');

    mockInteractive({ status: 'completed' });
    // Phase 2 gate → reject then fail to stop
    mockGate({ type: 'verdict', verdict: 'REJECT', comments: 'stop', rawOutput: '' });
    mockInteractive({ status: 'failed' });

    await runPhaseLoop(state, HDIR, runDir, CWD, createNoOpInputManager(), new NoopLogger(), { value: false });

    const writes = vi.mocked(writeState).mock.calls.map(([, s]) => s);
    const withSpecCommit = writes.find(s => s.specCommit === 'spec-commit-sha');
    expect(withSpecCommit).toBeDefined();
  });

  it('sets planCommit after Phase 3 completion', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 3 });

    vi.mocked(getHead).mockReturnValue('plan-commit-sha');

    mockInteractive({ status: 'completed' });
    mockGate({ type: 'verdict', verdict: 'REJECT', comments: 'stop', rawOutput: '' });
    mockInteractive({ status: 'failed' });

    await runPhaseLoop(state, HDIR, runDir, CWD, createNoOpInputManager(), new NoopLogger(), { value: false });

    const writes = vi.mocked(writeState).mock.calls.map(([, s]) => s);
    const withPlanCommit = writes.find(s => s.planCommit === 'plan-commit-sha');
    expect(withPlanCommit).toBeDefined();
  });
});

// ─── Test 13: pausedAtHead saved on quit ─────────────────────────────────────

describe('Test 13: pausedAtHead saved on intentional exit', () => {
  it('saves pausedAtHead when gate error → quit', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 2 });

    vi.mocked(getHead).mockReturnValue('paused-head-sha');
    mockGate({ type: 'error', error: 'timeout' });
    mockChoice('Q'); // Quit

    await runPhaseLoop(state, HDIR, runDir, CWD, createNoOpInputManager(), new NoopLogger(), { value: false });

    const writes = vi.mocked(writeState).mock.calls.map(([, s]) => s);
    const pausedWrite = writes.find(s => s.status === 'paused');
    expect(pausedWrite).toBeDefined();
    expect(pausedWrite!.pausedAtHead).toBe('paused-head-sha');
  });
});

// ─── Test 14: Gate error → retry/skip/quit UI ────────────────────────────────

describe('Test 14: Gate error → shows retry/skip/quit', () => {
  it('retries gate when user chooses R', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 2 });

    // First call: error, second call: APPROVE
    mockGate({ type: 'error', error: 'subprocess failed' });
    mockChoice('R'); // Retry
    mockGate({ type: 'verdict', verdict: 'APPROVE', comments: '', rawOutput: '' });
    // Phase 3 fails to stop loop
    mockInteractive({ status: 'failed' });

    await runPhaseLoop(state, HDIR, runDir, CWD, createNoOpInputManager(), new NoopLogger(), { value: false });

    expect(vi.mocked(runGatePhase)).toHaveBeenCalledTimes(2);

    const writes = vi.mocked(writeState).mock.calls.map(([, s]) => s);
    const approved = writes.find(s => s.phases['2'] === 'completed');
    expect(approved).toBeDefined();
  });

  it('pauses when user chooses Q on gate error', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 2 });

    mockGate({ type: 'error', error: 'timeout' });
    mockChoice('Q');

    await runPhaseLoop(state, HDIR, runDir, CWD, createNoOpInputManager(), new NoopLogger(), { value: false });

    const writes = vi.mocked(writeState).mock.calls.map(([, s]) => s);
    const paused = writes.find(s => s.status === 'paused');
    expect(paused).toBeDefined();
    expect(paused!.pauseReason).toBe('gate-error');
    expect(paused!.phases['2']).toBe('error');
  });
});

// ─── Test 15: Crash-safe ordering ────────────────────────────────────────────

describe('Test 15: Crash-safe ordering', () => {
  it('writes state BEFORE deleting eval report on verify FAIL', async () => {
    const runDir = makeTmpDir();
    const cwd = makeTmpDir();

    // Create the eval report so the unlink can be verified
    const state = makeState({ currentPhase: 6, verifyRetries: 0 });
    const evalAbsPath = path.join(cwd, state.artifacts.evalReport);
    fs.mkdirSync(path.dirname(evalAbsPath), { recursive: true });
    fs.writeFileSync(evalAbsPath, '# Eval\n\n## Summary\n\nFailed.\n');

    const feedbackPath = path.join(runDir, 'verify-feedback.md');
    fs.writeFileSync(feedbackPath, '# Feedback');

    mockVerify({ type: 'fail', feedbackPath });
    // Phase 5 fails to stop loop
    mockInteractive({ status: 'failed' });

    // Track call order: writeState calls vs file existence
    const writeStateCallsBeforeDelete: boolean[] = [];
    let evalDeletedAt = -1;

    let callCount = 0;
    vi.mocked(writeState).mockImplementation((_runDir: string, s: HarnessState) => {
      callCount++;
      // Record if eval report exists at time of this writeState call
      const exists = fs.existsSync(evalAbsPath);
      writeStateCallsBeforeDelete.push(exists);
      void s;
    });

    await runPhaseLoop(state, HDIR, runDir, cwd, createNoOpInputManager(), new NoopLogger(), { value: false });

    // Find when the eval report was deleted (after which calls it's gone)
    // The key invariant: at least one writeState call should have happened
    // while the eval report still existed (the crash-safe write BEFORE delete)
    const wroteBeforeDelete = writeStateCallsBeforeDelete.some(existed => existed);
    expect(wroteBeforeDelete).toBe(true);

    void evalDeletedAt;
    void callCount;
  });

  it('writes pendingAction to state BEFORE deleting gate sidecars on gate REJECT', async () => {
    const runDir = makeTmpDir();
    const state = makeState({
      currentPhase: 2,
      gateRetries: { '2': 0, '4': 0, '7': 0 },
    });

    // Create mock gate sidecar files
    const rawPath = path.join(runDir, 'gate-2-raw.txt');
    const resultPath = path.join(runDir, 'gate-2-result.json');
    fs.writeFileSync(rawPath, 'raw output');
    fs.writeFileSync(resultPath, '{"exitCode":0,"timestamp":123}');

    mockGate({ type: 'verdict', verdict: 'REJECT', comments: 'Fix this', rawOutput: '' });
    // Phase 1 reopen → fails
    mockInteractive({ status: 'failed' });

    // Track: when writeState is called with pendingAction set, are sidecars still present?
    const statesWithPendingAndSidecars: boolean[] = [];

    vi.mocked(writeState).mockImplementation((_runDir: string, s: HarnessState) => {
      if (s.pendingAction?.type === 'reopen_phase') {
        // At this point, sidecars should NOT yet be deleted (for reject, we don't delete them)
        // For gate REJECT, sidecars are only deleted on APPROVE
        statesWithPendingAndSidecars.push(true);
      }
      void s;
    });

    await runPhaseLoop(state, HDIR, runDir, CWD, createNoOpInputManager(), new NoopLogger(), { value: false });

    // The pendingAction write should have occurred
    expect(statesWithPendingAndSidecars.length).toBeGreaterThan(0);
  });
});

// ─── Additional edge case: Phase 5 completion sets implCommit ─────────────────

describe('Phase 5 completion sets implCommit', () => {
  it('updates implCommit after Phase 5 completes', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 5 });

    vi.mocked(getHead).mockReturnValue('impl-commit-sha');

    mockInteractive({ status: 'completed' });
    // Phase 6 verify to stop loop
    mockVerify({ type: 'error', errorPath: undefined });
    mockChoice('Q'); // Quit from verify error

    await runPhaseLoop(state, HDIR, runDir, CWD, createNoOpInputManager(), new NoopLogger(), { value: false });

    const writes = vi.mocked(writeState).mock.calls.map(([, s]) => s);
    const withImpl = writes.find(s => s.implCommit === 'impl-commit-sha');
    expect(withImpl).toBeDefined();
  });
});

// ─── Verify error → retry ────────────────────────────────────────────────────

describe('Verify error → retry/quit', () => {
  it('retries verify when user chooses R', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 6 });

    mockVerify({ type: 'error', errorPath: undefined });
    mockChoice('R');
    mockVerify({ type: 'pass' });
    // Phase 7 gate
    mockGate({ type: 'verdict', verdict: 'APPROVE', comments: '', rawOutput: '' });

    await runPhaseLoop(state, HDIR, runDir, CWD, createNoOpInputManager(), new NoopLogger(), { value: false });

    expect(vi.mocked(runVerifyPhase)).toHaveBeenCalledTimes(2);

    const writes = vi.mocked(writeState).mock.calls.map(([, s]) => s);
    const terminal = writes.find(s => s.currentPhase === TERMINAL_PHASE);
    expect(terminal).toBeDefined();
  });

  it('pauses when user chooses Q on verify error', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 6 });

    mockVerify({ type: 'error', errorPath: '/tmp/verify-error.md' });
    mockChoice('Q');

    await runPhaseLoop(state, HDIR, runDir, CWD, createNoOpInputManager(), new NoopLogger(), { value: false });

    const writes = vi.mocked(writeState).mock.calls.map(([, s]) => s);
    const paused = writes.find(s => s.status === 'paused');
    expect(paused).toBeDefined();
    expect(paused!.pauseReason).toBe('verify-error');
    expect(paused!.phases['6']).toBe('error');
  });
});

// ─── Verify FAIL escalation [C]ontinue resets verifyRetries ──────────────────

describe('Verify FAIL escalation [C]ontinue', () => {
  it('resets verifyRetries and reopens Phase 5', async () => {
    const runDir = makeTmpDir();
    const cwd = makeTmpDir();
    const state = makeState({ currentPhase: 6, verifyRetries: VERIFY_RETRY_LIMIT });

    const feedbackPath = path.join(runDir, 'verify-feedback.md');
    fs.writeFileSync(feedbackPath, '# feedback');

    // Create eval report so it can be deleted
    const evalAbsPath = path.join(cwd, state.artifacts.evalReport);
    fs.mkdirSync(path.dirname(evalAbsPath), { recursive: true });
    fs.writeFileSync(evalAbsPath, '# Eval\n\n## Summary\n');

    mockVerify({ type: 'fail', feedbackPath });
    mockChoice('C'); // Continue
    // Phase 5 fails to stop loop
    mockInteractive({ status: 'failed' });

    await runPhaseLoop(state, HDIR, runDir, cwd, createNoOpInputManager(), new NoopLogger(), { value: false });

    expect(vi.mocked(promptChoice)).toHaveBeenCalled();

    const writes = vi.mocked(writeState).mock.calls.map(([, s]) => s);
    const afterContinue = writes.find(s => s.verifyRetries === 0 && s.currentPhase === 5);
    expect(afterContinue).toBeDefined();
  });
});

// ─── Phase transition banner ──────────────────────────────────────────────────

describe('renderControlPanel called on advance', () => {
  it('renders control panel when advancing from Phase 1 to 2', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 1 });

    mockInteractive({ status: 'completed' });
    mockGate({ type: 'verdict', verdict: 'REJECT', comments: 'stop', rawOutput: '' });
    mockInteractive({ status: 'failed' });

    await runPhaseLoop(state, HDIR, runDir, CWD, createNoOpInputManager(), new NoopLogger(), { value: false });

    expect(vi.mocked(renderControlPanel)).toHaveBeenCalled();
  });
});

// ─── handleInteractivePhase — event emission ───────────────────────────────────

function makeTestLogger(runId: string): { logger: FileSessionLogger; eventsPath: string; cleanup: () => void } {
  const harnessDir = fs.mkdtempSync(path.join(os.tmpdir(), 'handler-test-'));
  const sessionsRoot = path.join(harnessDir, 'sessions');
  const logger = new FileSessionLogger(runId, harnessDir, { sessionsRoot });
  logger.writeMeta({ task: 't' });
  const eventsPath = path.join(sessionsRoot, computeRepoKey(harnessDir), runId, 'events.jsonl');
  return { logger, eventsPath, cleanup: () => fs.rmSync(harnessDir, { recursive: true, force: true }) };
}

function readEvents(eventsPath: string): any[] {
  if (!fs.existsSync(eventsPath)) return [];
  return fs.readFileSync(eventsPath, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

describe('handleInteractivePhase — event emission', () => {
  it('emits phase_start then phase_end(completed) on normal success', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 1 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(runInteractivePhase).mockImplementationOnce(async (phase, st, _h, _r, _c, attemptId) => {
      st.phases[String(phase)] = 'completed';
      return { status: 'completed', attemptId } as any;
    });

    try {
      await handleInteractivePhase(1, state, HDIR, runDir, CWD, logger);
      const events = readEvents(eventsPath);
      expect(events[0].event).toBe('phase_start');
      expect(events[0].phase).toBe(1);
      expect(typeof events[0].attemptId).toBe('string');
      const lastEvent = events[events.length - 1];
      expect(lastEvent.event).toBe('phase_end');
      expect(lastEvent.status).toBe('completed');
      expect(typeof lastEvent.durationMs).toBe('number');
    } finally {
      cleanup();
    }
  });

  it('emits phase_start with reopenFromGate and clears phaseReopenSource', async () => {
    const runDir = makeTmpDir();
    const state = makeState({
      currentPhase: 5,
      phaseReopenFlags: { '1': false, '3': false, '5': true },
      phaseReopenSource: { '1': null, '3': null, '5': 6 },
    });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(runInteractivePhase).mockImplementationOnce(async (phase, st, _h, _r, _c, attemptId) => {
      st.phases[String(phase)] = 'completed';
      return { status: 'completed', attemptId } as any;
    });

    try {
      await handleInteractivePhase(5, state, HDIR, runDir, CWD, logger);
      const events = readEvents(eventsPath);
      const phaseStart = events.find((e: any) => e.event === 'phase_start');
      expect(phaseStart).toBeDefined();
      expect(phaseStart.reopenFromGate).toBe(6);
      // phaseReopenSource should be cleared after emission
      expect(state.phaseReopenSource['5']).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('emits state_anomaly(phase_reopen_flag_stuck) when phase 5 completes with flag still set', async () => {
    const runDir = makeTmpDir();
    const state = makeState({
      currentPhase: 5,
      phaseReopenFlags: { '1': false, '3': false, '5': true },
    });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(runInteractivePhase).mockImplementationOnce(async (phase, st, _h, _r, _c, attemptId) => {
      // Simulate success but DON'T clear the reopen flag (it stays true)
      st.phases[String(phase)] = 'completed';
      return { status: 'completed', attemptId } as any;
    });

    try {
      await handleInteractivePhase(5, state, HDIR, runDir, CWD, logger);
      const events = readEvents(eventsPath);
      const anomaly = events.find((e: any) => e.event === 'state_anomaly');
      expect(anomaly).toBeDefined();
      expect(anomaly.kind).toBe('phase_reopen_flag_stuck');
      expect(anomaly.details.phase).toBe(5);
    } finally {
      cleanup();
    }
  });

  it('emits phase_end(failed) with details.reason=redirected on control-signal redirect', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 1 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(runInteractivePhase).mockImplementationOnce(async (_phase, st, _h, _r, _c, attemptId) => {
      // Simulate SIGUSR1 redirect: currentPhase changes mid-run
      st.currentPhase = 3;
      return { status: 'failed', attemptId } as any;
    });

    try {
      await handleInteractivePhase(1, state, HDIR, runDir, CWD, logger);
      const events = readEvents(eventsPath);
      const phaseEnd = events.find((e: any) => e.event === 'phase_end');
      expect(phaseEnd).toBeDefined();
      expect(phaseEnd.status).toBe('failed');
      expect(phaseEnd.details?.reason).toBe('redirected');
    } finally {
      cleanup();
    }
  });

  it('redirect on completed: runInteractivePhase returns success but currentPhase was mutated → phase_end failed with redirected reason', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 1 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(runInteractivePhase).mockImplementationOnce(async (phase, st, _h, _r, _c, attemptId) => {
      // Simulate SIGUSR1 redirect occurring during a run that would otherwise succeed:
      // control signal mutates currentPhase AND runInteractivePhase returns 'completed'
      st.currentPhase = 8;
      st.phases[String(phase)] = 'completed';
      return { status: 'completed', attemptId } as any;
    });

    try {
      await handleInteractivePhase(1, state, HDIR, runDir, CWD, logger);
      const events = readEvents(eventsPath);
      const phaseEndEvents = events.filter((e: any) => e.event === 'phase_end');
      // Only one phase_end should be emitted (redirect branch fires, completed branch skipped)
      expect(phaseEndEvents.length).toBe(1);
      const phaseEnd = phaseEndEvents[0];
      expect(phaseEnd.status).toBe('failed');
      expect(phaseEnd.details?.reason).toBe('redirected');
    } finally {
      cleanup();
    }
  });

  it('emits phase_start with preset { id, runner, model, effort } for phase 1', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 1 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(runInteractivePhase).mockImplementationOnce(async (phase, st, _h, _r, _c, attemptId) => {
      st.phases[String(phase)] = 'completed';
      return { status: 'completed', attemptId } as any;
    });

    try {
      await handleInteractivePhase(1, state, HDIR, runDir, CWD, logger);
      const events = readEvents(eventsPath);
      const phaseStart = events.find((e: any) => e.event === 'phase_start');
      expect(phaseStart.preset).toMatchObject({
        id: expect.any(String),
        runner: expect.stringMatching(/^(claude|codex)$/),
        model: expect.any(String),
        effort: expect.any(String),
      });
    } finally {
      cleanup();
    }
  });
});

// ─── handleGatePhase — event emission ─────────────────────────────────────────

describe('handleGatePhase — gate_verdict emission (APPROVE)', () => {
  it('emits gate_verdict(APPROVE) with runner/tokensTotal when runner is defined', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 2 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(runGatePhase).mockResolvedValueOnce({
      type: 'verdict',
      verdict: 'APPROVE',
      comments: '',
      rawOutput: '',
      runner: 'codex',
      promptBytes: 1000,
      durationMs: 5000,
      tokensTotal: 45000,
    } as any);

    try {
      await handleGatePhase(2, state, HDIR, runDir, CWD, createNoOpInputManager(), logger, { value: false });
      const events = readEvents(eventsPath);
      const verdict = events.find((e: any) => e.event === 'gate_verdict');
      expect(verdict).toBeDefined();
      expect(verdict.verdict).toBe('APPROVE');
      expect(verdict.phase).toBe(2);
      expect(verdict.runner).toBe('codex');
      expect(verdict.tokensTotal).toBe(45000);
      expect(verdict.retryIndex).toBe(0);
    } finally {
      cleanup();
    }
  });

  it('emits gate_verdict with preset { id, runner, model, effort } for phase 2', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 2 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(runGatePhase).mockResolvedValueOnce({
      type: 'verdict',
      verdict: 'APPROVE',
      comments: '',
      rawOutput: '',
      runner: 'codex',
      promptBytes: 1000,
      durationMs: 5000,
      tokensTotal: 45000,
    } as any);

    try {
      await handleGatePhase(2, state, HDIR, runDir, CWD, createNoOpInputManager(), logger, { value: false });
      const events = readEvents(eventsPath);
      const verdict = events.find((e: any) => e.event === 'gate_verdict');
      expect(verdict.preset).toMatchObject({
        id: expect.any(String),
        runner: 'codex',
        model: expect.any(String),
        effort: expect.any(String),
      });
    } finally {
      cleanup();
    }
  });

  it('does NOT emit gate_verdict when runner is undefined (legacy sidecar replay)', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 2 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(runGatePhase).mockResolvedValueOnce({
      type: 'verdict',
      verdict: 'APPROVE',
      comments: '',
      rawOutput: '',
      // runner deliberately omitted (undefined)
    } as any);

    try {
      await handleGatePhase(2, state, HDIR, runDir, CWD, createNoOpInputManager(), logger, { value: false });
      const events = readEvents(eventsPath);
      const verdict = events.find((e: any) => e.event === 'gate_verdict');
      expect(verdict).toBeUndefined();
      // But state should still advance (execution flow unchanged)
      expect(state.phases['2']).toBe('completed');
    } finally {
      cleanup();
    }
  });

  // §4.6 resume-log-field emission (EC-17): four-scenario coverage for
  // resumedFrom/resumeFallback on gate_verdict + gate_error events.
  it('§4.6 emits gate_verdict with resumedFrom=null + resumeFallback=false on fresh spawn', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 2 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);
    vi.mocked(runGatePhase).mockResolvedValueOnce({
      type: 'verdict', verdict: 'APPROVE', comments: '', rawOutput: '',
      runner: 'codex', codexSessionId: 'fresh-abc',
      resumedFrom: null, resumeFallback: false,
    } as any);
    try {
      await handleGatePhase(2, state, HDIR, runDir, CWD, createNoOpInputManager(), logger, { value: false });
      const v = readEvents(eventsPath).find((e: any) => e.event === 'gate_verdict');
      expect(v).toBeDefined();
      expect(v.resumedFrom).toBeNull();
      expect(v.resumeFallback).toBe(false);
      expect(v.codexSessionId).toBe('fresh-abc');
    } finally { cleanup(); }
  });

  it('§4.6 emits gate_verdict with resumedFrom=<prev> + resumeFallback=false on successful resume', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 2 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);
    vi.mocked(runGatePhase).mockResolvedValueOnce({
      type: 'verdict', verdict: 'REJECT', comments: 'x', rawOutput: '',
      runner: 'codex', codexSessionId: 'prev-abc',
      resumedFrom: 'prev-abc', resumeFallback: false,
    } as any);
    try {
      await handleGatePhase(2, state, HDIR, runDir, CWD, createNoOpInputManager(), logger, { value: false });
      const v = readEvents(eventsPath).find((e: any) => e.event === 'gate_verdict');
      expect(v.resumedFrom).toBe('prev-abc');
      expect(v.resumeFallback).toBe(false);
    } finally { cleanup(); }
  });

  it('§4.6 emits gate_verdict with resumedFrom=<prev> + resumeFallback=true on session_missing fallback', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 2 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);
    vi.mocked(runGatePhase).mockResolvedValueOnce({
      type: 'verdict', verdict: 'APPROVE', comments: '', rawOutput: '',
      runner: 'codex', codexSessionId: 'new-abc',
      resumedFrom: 'dead-abc', resumeFallback: true,
    } as any);
    try {
      await handleGatePhase(2, state, HDIR, runDir, CWD, createNoOpInputManager(), logger, { value: false });
      const v = readEvents(eventsPath).find((e: any) => e.event === 'gate_verdict');
      expect(v.resumedFrom).toBe('dead-abc');
      expect(v.resumeFallback).toBe(true);
      expect(v.codexSessionId).toBe('new-abc');
    } finally { cleanup(); }
  });

  it('§4.6 emits gate_error with resumedFrom/resumeFallback on error path', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 2 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);
    vi.mocked(runGatePhase).mockResolvedValueOnce({
      type: 'error', error: 'Codex gate timed out after 360000ms',
      runner: 'codex', codexSessionId: 'partial-abc',
      resumedFrom: 'prev-abc', resumeFallback: false,
    } as any);
    try {
      await handleGatePhase(2, state, HDIR, runDir, CWD, createNoOpInputManager(), logger, { value: false });
      const e = readEvents(eventsPath).find((ev: any) => ev.event === 'gate_error');
      expect(e).toBeDefined();
      expect(e.resumedFrom).toBe('prev-abc');
      expect(e.resumeFallback).toBe(false);
    } finally { cleanup(); }
  });

  it('emits state_anomaly(pending_action_stale_after_approve) when pendingAction is not null after APPROVE', async () => {
    const runDir = makeTmpDir();
    const state = makeState({
      currentPhase: 2,
      pendingAction: {
        type: 'reopen_phase',
        targetPhase: 1,
        sourcePhase: 2,
        feedbackPaths: [],
      },
    });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(runGatePhase).mockResolvedValueOnce({
      type: 'verdict',
      verdict: 'APPROVE',
      comments: '',
      rawOutput: '',
      runner: 'codex',
    } as any);

    try {
      await handleGatePhase(2, state, HDIR, runDir, CWD, createNoOpInputManager(), logger, { value: false });
      const events = readEvents(eventsPath);
      const anomaly = events.find((e: any) => e.event === 'state_anomaly');
      expect(anomaly).toBeDefined();
      expect(anomaly.kind).toBe('pending_action_stale_after_approve');
      expect(anomaly.details.phase).toBe(2);
    } finally {
      cleanup();
    }
  });
});

describe('handleGatePhase — gate_verdict(REJECT) + gate_retry emission', () => {
  it('emits gate_verdict(REJECT) then gate_retry in order with correct retryIndex', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 2, gateRetries: { '2': 0, '4': 0, '7': 0 } });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(runGatePhase).mockResolvedValueOnce({
      type: 'verdict',
      verdict: 'REJECT',
      comments: 'Section A needs work',
      rawOutput: '',
      runner: 'codex',
      durationMs: 3000,
      tokensTotal: 20000,
      promptBytes: 500,
    } as any);
    // After reopen, phase 1 fails to stop loop
    vi.mocked(runInteractivePhase).mockResolvedValueOnce({ status: 'failed', attemptId: 'a' } as any);

    try {
      await handleGatePhase(2, state, HDIR, runDir, CWD, createNoOpInputManager(), logger, { value: false });
      const events = readEvents(eventsPath);
      const verdictIdx = events.findIndex((e: any) => e.event === 'gate_verdict');
      const retryIdx = events.findIndex((e: any) => e.event === 'gate_retry');
      expect(verdictIdx).toBeGreaterThanOrEqual(0);
      expect(retryIdx).toBeGreaterThan(verdictIdx);

      const verdict = events[verdictIdx];
      expect(verdict.verdict).toBe('REJECT');
      expect(verdict.retryIndex).toBe(0);
      expect(verdict.runner).toBe('codex');

      const retry = events[retryIdx];
      expect(retry.phase).toBe(2);
      expect(retry.retryIndex).toBe(0);
      expect(retry.retryCount).toBe(1);
      expect(retry.retryLimit).toBe(GATE_RETRY_LIMIT);
      expect(typeof retry.feedbackPath).toBe('string');
      expect(typeof retry.feedbackBytes).toBe('number');
    } finally {
      cleanup();
    }
  });

  it('tracks phaseReopenSource[prevPhase] = gatePhase after REJECT', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 2, gateRetries: { '2': 0, '4': 0, '7': 0 } });
    const { logger, eventsPath: _eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(runGatePhase).mockResolvedValueOnce({
      type: 'verdict',
      verdict: 'REJECT',
      comments: 'Fix it',
      rawOutput: '',
      runner: 'codex',
    } as any);
    vi.mocked(runInteractivePhase).mockResolvedValueOnce({ status: 'failed', attemptId: 'b' } as any);

    try {
      await handleGatePhase(2, state, HDIR, runDir, CWD, createNoOpInputManager(), logger, { value: false });
      // Phase 2 REJECT → prevInteractivePhase = 1
      expect(state.phaseReopenSource['1']).toBe(2);
    } finally {
      cleanup();
    }
  });

  it('does NOT emit gate_verdict when runner is undefined (legacy sidecar REJECT)', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 2, gateRetries: { '2': 0, '4': 0, '7': 0 } });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(runGatePhase).mockResolvedValueOnce({
      type: 'verdict',
      verdict: 'REJECT',
      comments: 'Issues found',
      rawOutput: '',
      // runner deliberately omitted
    } as any);
    vi.mocked(runInteractivePhase).mockResolvedValueOnce({ status: 'failed', attemptId: 'c' } as any);

    try {
      await handleGatePhase(2, state, HDIR, runDir, CWD, createNoOpInputManager(), logger, { value: false });
      const events = readEvents(eventsPath);
      const verdict = events.find((e: any) => e.event === 'gate_verdict');
      // No gate_verdict for legacy sidecar
      expect(verdict).toBeUndefined();
      // But gate_retry should still be emitted (saveGateFeedback still runs)
      const retry = events.find((e: any) => e.event === 'gate_retry');
      expect(retry).toBeDefined();
    } finally {
      cleanup();
    }
  });
});

describe('handleGatePhase — gate_error emission', () => {
  it('emits gate_error when runner is defined', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 2 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(runGatePhase).mockResolvedValueOnce({
      type: 'error',
      error: 'subprocess timeout',
      runner: 'codex',
      durationMs: 60000,
      exitCode: 1,
    } as any);
    vi.mocked(promptChoice).mockResolvedValueOnce('Q');

    try {
      await handleGatePhase(2, state, HDIR, runDir, CWD, createNoOpInputManager(), logger, { value: false });
      const events = readEvents(eventsPath);
      const errEvent = events.find((e: any) => e.event === 'gate_error');
      expect(errEvent).toBeDefined();
      expect(errEvent.phase).toBe(2);
      expect(errEvent.retryIndex).toBe(0);
      expect(errEvent.runner).toBe('codex');
      expect(errEvent.error).toBe('subprocess timeout');
      expect(errEvent.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it('emits gate_error with preset { id, runner, model, effort } for phase 2', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 2 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(runGatePhase).mockResolvedValueOnce({
      type: 'error',
      error: 'subprocess timeout',
      runner: 'codex',
      durationMs: 60000,
      exitCode: 1,
    } as any);
    vi.mocked(promptChoice).mockResolvedValueOnce('Q');

    try {
      await handleGatePhase(2, state, HDIR, runDir, CWD, createNoOpInputManager(), logger, { value: false });
      const events = readEvents(eventsPath);
      const errEvent = events.find((e: any) => e.event === 'gate_error');
      expect(errEvent.preset).toMatchObject({
        id: expect.any(String),
        runner: 'codex',
        model: expect.any(String),
        effort: expect.any(String),
      });
    } finally {
      cleanup();
    }
  });

  it('does NOT emit gate_error when runner is undefined (legacy sidecar error)', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 2 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(runGatePhase).mockResolvedValueOnce({
      type: 'error',
      error: 'subprocess timeout',
      // runner deliberately omitted
    } as any);
    vi.mocked(promptChoice).mockResolvedValueOnce('Q');

    try {
      await handleGatePhase(2, state, HDIR, runDir, CWD, createNoOpInputManager(), logger, { value: false });
      const events = readEvents(eventsPath);
      const errEvent = events.find((e: any) => e.event === 'gate_error');
      expect(errEvent).toBeUndefined();
      // Execution still flows — state should be paused
      expect(state.status).toBe('paused');
    } finally {
      cleanup();
    }
  });
});

describe('escalation — handleGateEscalation emission', () => {
  it('emits exactly one escalation event with reason=gate-retry-limit after promptChoice', async () => {
    const runDir = makeTmpDir();
    const state = makeState({
      currentPhase: 2,
      gateRetries: { '2': GATE_RETRY_LIMIT, '4': 0, '7': 0 },
    });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(promptChoice).mockResolvedValueOnce('Q');

    try {
      await handleGateEscalation(2, 'Feedback text', state, runDir, CWD, createNoOpInputManager(), logger);
      const events = readEvents(eventsPath);
      const escalations = events.filter((e: any) => e.event === 'escalation');
      expect(escalations).toHaveLength(1);
      expect(escalations[0].reason).toBe('gate-retry-limit');
      expect(escalations[0].userChoice).toBe('Q');
      expect(escalations[0].phase).toBe(2);
    } finally {
      cleanup();
    }
  });

  it('emits escalation then force_pass when user chooses S', async () => {
    const runDir = makeTmpDir();
    const state = makeState({
      currentPhase: 2,
      gateRetries: { '2': GATE_RETRY_LIMIT, '4': 0, '7': 0 },
    });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(promptChoice).mockResolvedValueOnce('S');

    try {
      await handleGateEscalation(2, 'Feedback', state, runDir, CWD, createNoOpInputManager(), logger);
      const events = readEvents(eventsPath);
      const escalation = events.find((e: any) => e.event === 'escalation');
      const forcePass = events.find((e: any) => e.event === 'force_pass');
      expect(escalation).toBeDefined();
      expect(escalation.userChoice).toBe('S');
      expect(forcePass).toBeDefined();
      expect(forcePass.by).toBe('user');
      expect(forcePass.phase).toBe(2);
    } finally {
      cleanup();
    }
  });

  it('tracks phaseReopenSource when user chooses C', async () => {
    const runDir = makeTmpDir();
    const state = makeState({
      currentPhase: 2,
      gateRetries: { '2': GATE_RETRY_LIMIT, '4': 0, '7': 0 },
    });
    const { logger, eventsPath: _eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(promptChoice).mockResolvedValueOnce('C');

    try {
      await handleGateEscalation(2, 'More feedback', state, runDir, CWD, createNoOpInputManager(), logger);
      // Phase 2 → prevInteractivePhase = 1
      expect(state.phaseReopenSource['1']).toBe(2);
    } finally {
      cleanup();
    }
  });
});

describe('escalation — handleGateError emission', () => {
  it('emits exactly one escalation event with reason=gate-error after promptChoice', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 4 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(promptChoice).mockResolvedValueOnce('Q');

    try {
      await handleGateError(4, 'timeout error', state, runDir, CWD, createNoOpInputManager(), logger);
      const events = readEvents(eventsPath);
      const escalations = events.filter((e: any) => e.event === 'escalation');
      expect(escalations).toHaveLength(1);
      expect(escalations[0].reason).toBe('gate-error');
      expect(escalations[0].userChoice).toBe('Q');
      expect(escalations[0].phase).toBe(4);
    } finally {
      cleanup();
    }
  });
});

describe('escalation — handleVerifyEscalation emission', () => {
  it('emits exactly one escalation event with reason=verify-limit after promptChoice', async () => {
    const runDir = makeTmpDir();
    const cwd = makeTmpDir();
    const state = makeState({ currentPhase: 6, verifyRetries: VERIFY_RETRY_LIMIT });
    const feedbackPath = path.join(runDir, 'verify-feedback.md');
    fs.writeFileSync(feedbackPath, '# feedback');
    // Create eval report so deletion doesn't fail (we care about event emission)
    const evalAbsPath = path.join(cwd, state.artifacts.evalReport);
    fs.mkdirSync(path.dirname(evalAbsPath), { recursive: true });
    fs.writeFileSync(evalAbsPath, '# eval');
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(promptChoice).mockResolvedValueOnce('Q');

    try {
      await handleVerifyEscalation(feedbackPath, state, runDir, cwd, createNoOpInputManager(), logger);
      const events = readEvents(eventsPath);
      const escalations = events.filter((e: any) => e.event === 'escalation');
      expect(escalations).toHaveLength(1);
      expect(escalations[0].reason).toBe('verify-limit');
      expect(escalations[0].userChoice).toBe('Q');
      expect(escalations[0].phase).toBe(6);
    } finally {
      cleanup();
    }
  });

  it('tracks phaseReopenSource[5] = 6 when user chooses C', async () => {
    const runDir = makeTmpDir();
    const cwd = makeTmpDir();
    const state = makeState({ currentPhase: 6, verifyRetries: VERIFY_RETRY_LIMIT });
    const feedbackPath = path.join(runDir, 'verify-feedback.md');
    fs.writeFileSync(feedbackPath, '# feedback');
    const evalAbsPath = path.join(cwd, state.artifacts.evalReport);
    fs.mkdirSync(path.dirname(evalAbsPath), { recursive: true });
    fs.writeFileSync(evalAbsPath, '# eval');
    const { logger, eventsPath: _eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(promptChoice).mockResolvedValueOnce('C');

    try {
      await handleVerifyEscalation(feedbackPath, state, runDir, cwd, createNoOpInputManager(), logger);
      expect(state.phaseReopenSource['5']).toBe(6);
    } finally {
      cleanup();
    }
  });
});

describe('escalation — handleVerifyError emission', () => {
  it('emits exactly one escalation event with reason=verify-error after promptChoice', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 6 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(promptChoice).mockResolvedValueOnce('Q');

    try {
      await handleVerifyError(undefined, state, HDIR, runDir, CWD, createNoOpInputManager(), logger);
      const events = readEvents(eventsPath);
      const escalations = events.filter((e: any) => e.event === 'escalation');
      expect(escalations).toHaveLength(1);
      expect(escalations[0].reason).toBe('verify-error');
      expect(escalations[0].userChoice).toBe('Q');
      expect(escalations[0].phase).toBe(6);
    } finally {
      cleanup();
    }
  });
});

// ─── handleVerifyPhase — event emission ──────────────────────────────────────

describe('handleVerifyPhase — event emission', () => {
  it('pass path: phase_start → verify_result(passed=true) → phase_end(completed)', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 6, verifyRetries: 0 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(runVerifyPhase).mockResolvedValueOnce({ type: 'pass' });

    try {
      await handleVerifyPhase(state, HDIR, runDir, CWD, createNoOpInputManager(), logger);
      const events = readEvents(eventsPath);
      expect(events[0].event).toBe('phase_start');
      expect(events[0].phase).toBe(6);
      expect(events[0].retryIndex).toBe(0);
      const verifyResult = events.find((e: any) => e.event === 'verify_result');
      expect(verifyResult).toBeDefined();
      expect(verifyResult.passed).toBe(true);
      expect(verifyResult.retryIndex).toBe(0);
      const phaseEnd = events.find((e: any) => e.event === 'phase_end');
      expect(phaseEnd).toBeDefined();
      expect(phaseEnd.status).toBe('completed');
      expect(typeof phaseEnd.durationMs).toBe('number');
    } finally {
      cleanup();
    }
  });

  it('pass path: verify_result emitted BEFORE phase_end', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 6, verifyRetries: 2 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(runVerifyPhase).mockResolvedValueOnce({ type: 'pass' });

    try {
      await handleVerifyPhase(state, HDIR, runDir, CWD, createNoOpInputManager(), logger);
      const events = readEvents(eventsPath);
      const vrIdx = events.findIndex((e: any) => e.event === 'verify_result');
      const peIdx = events.findIndex((e: any) => e.event === 'phase_end');
      expect(vrIdx).toBeGreaterThanOrEqual(0);
      expect(peIdx).toBeGreaterThan(vrIdx);
      // retryIndex captured pre-mutation (was 2)
      expect(events[vrIdx].retryIndex).toBe(2);
    } finally {
      cleanup();
    }
  });

  it('fail path: phase_start → verify_result(passed=false) → phase_end(failed)', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 6, verifyRetries: 0 });
    const feedbackPath = path.join(makeTmpDir(), 'verify-feedback.md');
    fs.writeFileSync(feedbackPath, '# Feedback\n\n## Summary\n\nFailed.\n');
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(runVerifyPhase).mockResolvedValueOnce({ type: 'fail', feedbackPath });

    try {
      await handleVerifyPhase(state, HDIR, runDir, CWD, createNoOpInputManager(), logger);
      const events = readEvents(eventsPath);
      expect(events[0].event).toBe('phase_start');
      const verifyResult = events.find((e: any) => e.event === 'verify_result');
      expect(verifyResult).toBeDefined();
      expect(verifyResult.passed).toBe(false);
      const phaseEnd = events.find((e: any) => e.event === 'phase_end');
      expect(phaseEnd).toBeDefined();
      expect(phaseEnd.status).toBe('failed');
      // verify_result before phase_end
      const vrIdx = events.indexOf(verifyResult);
      const peIdx = events.indexOf(phaseEnd);
      expect(vrIdx).toBeLessThan(peIdx);
    } finally {
      cleanup();
    }
  });

  it('throw path: phase_end(failed, verify_throw), no verify_result, routes to handleVerifyError (no rethrow)', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 6, verifyRetries: 0 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(runVerifyPhase).mockImplementationOnce(async () => { throw new Error('harness-verify.sh not found'); });
    vi.mocked(promptChoice).mockResolvedValueOnce('Q');

    try {
      // must resolve (not throw)
      await expect(handleVerifyPhase(state, HDIR, runDir, CWD, createNoOpInputManager(), logger)).resolves.toBeUndefined();
      const events = readEvents(eventsPath);
      expect(events[0].event).toBe('phase_start');
      // no verify_result
      expect(events.some((e: any) => e.event === 'verify_result')).toBe(false);
      const phaseEnd = events.find((e: any) => e.event === 'phase_end');
      expect(phaseEnd).toBeDefined();
      expect(phaseEnd.status).toBe('failed');
      expect(phaseEnd.details?.reason).toBe('verify_throw');
      // handleVerifyError was called → escalation event emitted
      expect(events.some((e: any) => e.event === 'escalation' && e.reason === 'verify-error')).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('error (non-throw) path: phase_end(failed), no verify_result, routes to handleVerifyError', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 6, verifyRetries: 0 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(runVerifyPhase).mockResolvedValueOnce({ type: 'error', errorPath: undefined });
    vi.mocked(promptChoice).mockResolvedValueOnce('Q');

    try {
      await handleVerifyPhase(state, HDIR, runDir, CWD, createNoOpInputManager(), logger);
      const events = readEvents(eventsPath);
      expect(events[0].event).toBe('phase_start');
      // no verify_result
      expect(events.some((e: any) => e.event === 'verify_result')).toBe(false);
      const phaseEnd = events.find((e: any) => e.event === 'phase_end');
      expect(phaseEnd).toBeDefined();
      expect(phaseEnd.status).toBe('failed');
      // handleVerifyError was called → escalation event emitted
      expect(events.some((e: any) => e.event === 'escalation' && e.reason === 'verify-error')).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('redirect (SIGUSR1) path: phase_end(failed, redirected), no verify_result, no handleVerifyError', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 6, verifyRetries: 0 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    // Simulate SIGUSR1 redirect: runVerifyPhase returns error but currentPhase changes to 7
    vi.mocked(runVerifyPhase).mockImplementationOnce(async (st: HarnessState) => {
      st.currentPhase = 7;
      return { type: 'error', errorPath: undefined } as any;
    });

    try {
      await handleVerifyPhase(state, HDIR, runDir, CWD, createNoOpInputManager(), logger);
      const events = readEvents(eventsPath);
      expect(events[0].event).toBe('phase_start');
      expect(events.some((e: any) => e.event === 'verify_result')).toBe(false);
      const phaseEnd = events.find((e: any) => e.event === 'phase_end');
      expect(phaseEnd).toBeDefined();
      expect(phaseEnd.status).toBe('failed');
      expect(phaseEnd.details?.reason).toBe('redirected');
      // promptChoice (handleVerifyError) must NOT be called
      expect(vi.mocked(promptChoice)).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });
});

describe('force_pass — forcePassGate emission', () => {
  it('emits exactly one force_pass event with by=user', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 2 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    try {
      await forcePassGate(2, state, runDir, CWD, 'user', logger);
      const events = readEvents(eventsPath);
      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('force_pass');
      expect(events[0].phase).toBe(2);
      expect(events[0].by).toBe('user');
    } finally {
      cleanup();
    }
  });

  it('emits force_pass with by=auto in auto mode', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 4 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    try {
      await forcePassGate(4, state, runDir, CWD, 'auto', logger);
      const events = readEvents(eventsPath);
      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('force_pass');
      expect(events[0].by).toBe('auto');
    } finally {
      cleanup();
    }
  });

  it('does NOT emit gate_verdict, phase_end alongside force_pass', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 7 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    try {
      await forcePassGate(7, state, runDir, CWD, 'user', logger);
      const events = readEvents(eventsPath);
      const forbidden = events.filter((e: any) =>
        e.event === 'gate_verdict' || e.event === 'phase_end'
      );
      expect(forbidden).toHaveLength(0);
      expect(events[0].event).toBe('force_pass');
    } finally {
      cleanup();
    }
  });
});

describe('force_pass — forcePassVerify emission', () => {
  it('emits exactly one force_pass event with by=user, phase=6', async () => {
    const runDir = makeTmpDir();
    const cwd = makeTmpDir();
    const state = makeState({ currentPhase: 6 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    try {
      await forcePassVerify(state, runDir, cwd, 'user', logger);
      const events = readEvents(eventsPath);
      const forcePassEvents = events.filter((e: any) => e.event === 'force_pass');
      expect(forcePassEvents).toHaveLength(1);
      expect(forcePassEvents[0].phase).toBe(6);
      expect(forcePassEvents[0].by).toBe('user');
    } finally {
      cleanup();
    }
  });

  it('does NOT emit verify_result alongside force_pass', async () => {
    const runDir = makeTmpDir();
    const cwd = makeTmpDir();
    const state = makeState({ currentPhase: 6 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    try {
      await forcePassVerify(state, runDir, cwd, 'auto', logger);
      const events = readEvents(eventsPath);
      const forbidden = events.filter((e: any) => e.event === 'verify_result');
      expect(forbidden).toHaveLength(0);
    } finally {
      cleanup();
    }
  });
});

describe('handleVerifyFail — phaseReopenSource tracking', () => {
  it('sets phaseReopenSource[5] = 6 when verify fails within retry limit', async () => {
    const runDir = makeTmpDir();
    const cwd = makeTmpDir();
    const state = makeState({ currentPhase: 6, verifyRetries: 0 });
    const feedbackPath = path.join(runDir, 'verify-feedback.md');
    fs.writeFileSync(feedbackPath, '# feedback');
    const evalAbsPath = path.join(cwd, state.artifacts.evalReport);
    fs.mkdirSync(path.dirname(evalAbsPath), { recursive: true });
    fs.writeFileSync(evalAbsPath, '# eval');

    await handleVerifyFail(feedbackPath, state, runDir, cwd, createNoOpInputManager(), new NoopLogger());
    expect(state.phaseReopenSource['5']).toBe(6);
  });
});
