import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GatePhaseResult, HarnessState } from '../../src/types.js';
import { createInitialState } from '../../src/state.js';
import { NoopLogger } from '../../src/logger.js';
import { InputManager } from '../../src/input.js';
import { GATE_RETRY_LIMIT_FULL as GATE_RETRY_LIMIT } from '../../src/config.js';

vi.mock('../../src/phases/gate.js', () => ({
  runGatePhase: vi.fn(),
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

vi.mock('../../src/git.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/git.js')>();
  return {
    ...actual,
    getHead: vi.fn().mockReturnValue('mock-head-sha'),
  };
});

import { runGatePhase } from '../../src/phases/gate.js';
import { promptChoice } from '../../src/ui.js';
import {
  handleGateEscalation,
  handleGatePhase,
  handleGateReject,
} from '../../src/phases/runner.js';

const tmpDirs: string[] = [];

afterEach(() => {
  vi.clearAllMocks();
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
});

function makeTmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function makeState(overrides: Partial<HarnessState> = {}): HarnessState {
  return {
    ...createInitialState('gate-archive-run', 'task', 'base-sha', false),
    ...overrides,
  };
}

function createNoOpInputManager(): InputManager {
  return new InputManager();
}

describe('gate feedback archival', () => {
  it('archives reject feedback by retry index, preserves the legacy pointer, and writes approve verdict metadata', async () => {
    const runDir = makeTmpDir('gate-archive-');
    const state = makeState({ currentPhase: 2 });

    await handleGateReject(
      2,
      'first reject',
      undefined,
      0,
      state,
      runDir,
      runDir,
      runDir,
      createNoOpInputManager(),
      new NoopLogger(),
    );

    state.currentPhase = 2;
    state.pendingAction = null;

    await handleGateReject(
      2,
      'second reject',
      undefined,
      1,
      state,
      runDir,
      runDir,
      runDir,
      createNoOpInputManager(),
      new NoopLogger(),
    );

    state.currentPhase = 2;
    state.pendingAction = null;
    vi.mocked(promptChoice).mockResolvedValueOnce('Q');

    await handleGateReject(
      2,
      'third reject',
      undefined,
      2,
      state,
      runDir,
      runDir,
      runDir,
      createNoOpInputManager(),
      new NoopLogger(),
    );

    expect(fs.existsSync(path.join(runDir, 'gate-2-cycle-0-retry-0-feedback.md'))).toBe(true);
    expect(fs.existsSync(path.join(runDir, 'gate-2-cycle-0-retry-1-feedback.md'))).toBe(true);
    expect(fs.existsSync(path.join(runDir, 'gate-2-cycle-0-retry-2-feedback.md'))).toBe(true);

    const legacyFeedback = path.join(runDir, 'gate-2-feedback.md');
    expect(state.pendingAction).not.toBeNull();
    expect(state.pendingAction!.feedbackPaths[0]).toBe(legacyFeedback);
    expect(fs.readFileSync(legacyFeedback, 'utf-8')).toContain('third reject');

    state.currentPhase = 2;
    state.status = 'in_progress';
    state.pendingAction = null;
    state.pauseReason = null;
    state.gateRetries['2'] = 2;
    state.gateEscalationCycles = { '2': 1 };

    vi.mocked(runGatePhase).mockResolvedValueOnce({
      type: 'verdict',
      verdict: 'APPROVE',
      comments: '',
      rawOutput: '## Verdict\nAPPROVE\n',
      runner: 'codex',
      codexSessionId: 'codex-session-1',
      tokensTotal: 321,
      durationMs: 456,
      promptBytes: 789,
    } satisfies GatePhaseResult);

    await handleGatePhase(
      2,
      state,
      runDir,
      runDir,
      runDir,
      createNoOpInputManager(),
      new NoopLogger(),
      { value: false },
    );

    const verdictPath = path.join(runDir, 'gate-2-cycle-1-verdict.json');
    expect(fs.existsSync(verdictPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(verdictPath, 'utf-8'))).toMatchObject({
      verdict: 'APPROVE',
      retryIndex: 2,
      cycleIndex: 1,
      codexSessionId: 'codex-session-1',
      tokensTotal: 321,
      durationMs: 456,
    });
  });

  it('increments the escalation cycle after continue and carries verify feedback on phase 7', async () => {
    const runDir = makeTmpDir('gate-cycle-');
    const state = makeState({
      currentPhase: 7,
      gateRetries: { '2': 0, '4': 0, '7': GATE_RETRY_LIMIT },
      verifyRetries: 2,
    });

    const verifyFeedbackPath = path.join(runDir, 'verify-feedback.md');
    fs.writeFileSync(verifyFeedbackPath, '# verify feedback\n');

    vi.mocked(promptChoice).mockResolvedValueOnce('C');

    await handleGateEscalation(
      7,
      'phase 7 escalation',
      undefined,
      2,
      state,
      runDir,
      runDir,
      createNoOpInputManager(),
      new NoopLogger(),
    );

    expect(fs.existsSync(path.join(runDir, 'gate-7-cycle-0-retry-2-feedback.md'))).toBe(true);
    expect(state.gateEscalationCycles).toEqual({ '7': 1 });
    expect(state.gateRetries['7']).toBe(0);
    expect(state.verifyRetries).toBe(0);
    expect(state.pendingAction?.feedbackPaths).toEqual([
      path.join(runDir, 'gate-7-feedback.md'),
      verifyFeedbackPath,
    ]);

    state.currentPhase = 7;
    state.pendingAction = null;

    await handleGateReject(
      7,
      'phase 7 next cycle',
      undefined,
      0,
      state,
      runDir,
      runDir,
      runDir,
      createNoOpInputManager(),
      new NoopLogger(),
    );

    expect(fs.existsSync(path.join(runDir, 'gate-7-cycle-1-retry-0-feedback.md'))).toBe(true);
  });
});
