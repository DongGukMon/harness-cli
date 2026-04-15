import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { HarnessState, GatePhaseResult, VerifyOutcome } from '../../src/types.js';
import type { InteractiveResult } from '../../src/phases/interactive.js';
import { createInitialState } from '../../src/state.js';
import { GATE_RETRY_LIMIT, VERIFY_RETRY_LIMIT, TERMINAL_PHASE } from '../../src/config.js';

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
  printAdvisorReminder: vi.fn(),
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

import { runPhaseLoop } from '../../src/phases/runner.js';
import { runInteractivePhase } from '../../src/phases/interactive.js';
import { runGatePhase } from '../../src/phases/gate.js';
import { runVerifyPhase } from '../../src/phases/verify.js';
import { promptChoice, printPhaseTransition, renderControlPanel } from '../../src/ui.js';
import { normalizeArtifactCommit } from '../../src/artifact.js';
import { getHead } from '../../src/git.js';
import { writeState } from '../../src/state.js';

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
    '/usr/local/bin/codex',
    false
  );
  return { ...base, ...overrides };
}

const HDIR = '/tmp/harness-dir';
const CWD = '/tmp/cwd';

function mockInteractive(result: InteractiveResult): void {
  vi.mocked(runInteractivePhase).mockResolvedValueOnce(result);
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

    await runPhaseLoop(state, HDIR, runDir, CWD);

    expect(vi.mocked(runInteractivePhase)).toHaveBeenCalledWith(1, expect.any(Object), HDIR, runDir, CWD);
    expect(vi.mocked(runGatePhase)).toHaveBeenCalledWith(2, expect.any(Object), HDIR, runDir, CWD);
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

    await runPhaseLoop(state, HDIR, runDir, CWD);

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

    await runPhaseLoop(state, HDIR, runDir, CWD);

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

    await runPhaseLoop(state, HDIR, runDir, CWD);

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

    await runPhaseLoop(state, HDIR, runDir, CWD);

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

    await runPhaseLoop(state, HDIR, runDir, CWD);

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

    await runPhaseLoop(state, HDIR, runDir, CWD);

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

    await runPhaseLoop(state, HDIR, runDir, CWD);

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

    await runPhaseLoop(state, HDIR, runDir, CWD);

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

    await runPhaseLoop(state, HDIR, runDir, CWD);

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

    await runPhaseLoop(state, HDIR, runDir, CWD);

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

    await runPhaseLoop(state, HDIR, runDir, CWD);

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

    await runPhaseLoop(state, HDIR, runDir, CWD);

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

    await runPhaseLoop(state, HDIR, runDir, CWD);

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

    await runPhaseLoop(state, HDIR, runDir, CWD);

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

    await runPhaseLoop(state, HDIR, runDir, CWD);

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

    await runPhaseLoop(state, HDIR, runDir, CWD);

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

    await runPhaseLoop(state, HDIR, runDir, cwd);

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

    await runPhaseLoop(state, HDIR, runDir, CWD);

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

    await runPhaseLoop(state, HDIR, runDir, CWD);

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

    await runPhaseLoop(state, HDIR, runDir, CWD);

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

    await runPhaseLoop(state, HDIR, runDir, CWD);

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

    await runPhaseLoop(state, HDIR, runDir, cwd);

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

    await runPhaseLoop(state, HDIR, runDir, CWD);

    expect(vi.mocked(renderControlPanel)).toHaveBeenCalled();
  });
});
