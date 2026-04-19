import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  enterFailedTerminalState,
  enterCompleteTerminalState,
  performResume,
  performJump,
  anyPhaseFailed,
} from '../../src/phases/terminal-ui.js';
import { InputManager } from '../../src/input.js';
import type { HarnessState, SessionLogger } from '../../src/types.js';

vi.mock('../../src/phases/runner.js', () => ({
  runPhaseLoop: vi.fn(async () => { /* no-op default */ }),
}));

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-ui-'));
}

function makeState(overrides: Partial<HarnessState> = {}): HarnessState {
  return {
    runId: 'r1',
    flow: 'full',
    carryoverFeedback: null,
    currentPhase: 5,
    status: 'in_progress',
    autoMode: false,
    task: 't',
    baseCommit: 'base',
    implRetryBase: 'base',
    codexPath: null,
    externalCommitsDetected: false,
    artifacts: {
      spec: 'docs/specs/r1-design.md',
      plan: 'docs/plans/r1.md',
      decisionLog: '.harness/r1/decisions.md',
      checklist: '.harness/r1/checklist.json',
      evalReport: 'docs/process/evals/r1-eval.md',
    },
    phases: { '1': 'completed', '2': 'completed', '3': 'completed', '4': 'completed', '5': 'failed', '6': 'pending', '7': 'pending' },
    gateRetries: { '2': 0, '4': 0, '7': 0 },
    verifyRetries: 0,
    pauseReason: null,
    specCommit: null, planCommit: null, implCommit: null, evalCommit: null,
    verifiedAtHead: null, pausedAtHead: null, pendingAction: null,
    phaseOpenedAt: { '1': null, '3': null, '5': null },
    phaseAttemptId: { '1': null, '3': null, '5': null },
    phasePresets: { '1': 'opus-high', '2': 'codex-high', '3': 'sonnet-high', '4': 'codex-high', '5': 'sonnet-high', '7': 'codex-high' },
    phaseReopenFlags: { '1': false, '3': false, '5': false },
    phaseCodexSessions: { '2': null, '4': null, '7': null },
    lastWorkspacePid: null, lastWorkspacePidStartTime: null,
    tmuxSession: '', tmuxMode: 'dedicated', tmuxWindows: [],
    tmuxControlWindow: '', tmuxWorkspacePane: '', tmuxControlPane: '',
    loggingEnabled: false,
    phaseReopenSource: { '1': null, '3': null, '5': null },
    codexNoIsolate: false,
    ...overrides,
  };
}

function makeLogger(): SessionLogger {
  return {
    logEvent: vi.fn(),
    writeMeta: vi.fn(),
    updateMeta: vi.fn(),
    finalizeSummary: vi.fn(),
    close: vi.fn(),
    hasBootstrapped: () => false,
    hasEmittedSessionOpen: () => true,
    getStartedAt: () => Date.now(),
    getEventsPath: () => null,
  };
}

class MockInput {
  private queue: string[] = [];
  enqueue(...keys: string[]): void { this.queue.push(...keys); }
  async waitForKey(valid: Set<string>): Promise<string> {
    const k = this.queue.shift();
    if (k === undefined) throw new Error('test: no key queued');
    if (!valid.has(k.toLowerCase())) throw new Error(`test: key ${k} not in valid set`);
    return k.toUpperCase();
  }
}

describe('anyPhaseFailed', () => {
  it('true when at least one phase status is "failed"', () => {
    expect(anyPhaseFailed(makeState({ phases: { ...makeState().phases, '5': 'failed' } as any }))).toBe(true);
  });
  it('true when at least one phase status is "error"', () => {
    expect(anyPhaseFailed(makeState({ phases: { ...makeState().phases, '6': 'error' } as any }))).toBe(true);
  });
  it('false when all phases are pending/completed/skipped/in_progress', () => {
    expect(anyPhaseFailed(makeState({ phases: { '1': 'completed', '2': 'completed', '3': 'pending', '4': 'pending', '5': 'pending', '6': 'pending', '7': 'pending' } }))).toBe(false);
  });
});

describe('performResume (inner-side)', () => {
  it('resets the failed phase to pending and re-enters runPhaseLoop', async () => {
    const { runPhaseLoop } = await import('../../src/phases/runner.js');
    const state = makeState();
    const runDir = makeTmpDir();
    const input = new MockInput() as unknown as InputManager;
    const logger = makeLogger();

    await performResume(state, '/harness', runDir, '/cwd', input, logger, { value: false });

    expect(state.phases['5']).toBe('pending');
    expect(runPhaseLoop).toHaveBeenCalledOnce();
  });
});

describe('performJump (inner-side)', () => {
  it('resets phases >= target to pending, sets currentPhase, invalidates gate sessions, re-enters loop', async () => {
    const { runPhaseLoop } = await import('../../src/phases/runner.js');
    vi.mocked(runPhaseLoop).mockClear();
    const state = makeState({ currentPhase: 5, phases: { '1': 'completed', '2': 'completed', '3': 'completed', '4': 'completed', '5': 'failed', '6': 'pending', '7': 'pending' } });
    state.phaseCodexSessions['7'] = { sessionId: 's7', runner: 'codex', model: 'gpt-5.4', effort: 'high', lastOutcome: 'reject' };
    const runDir = makeTmpDir();
    const input = new MockInput() as unknown as InputManager;
    const logger = makeLogger();

    await performJump(3, state, '/harness', runDir, '/cwd', input, logger);

    expect(state.currentPhase).toBe(3);
    expect(state.phases['3']).toBe('pending');
    expect(state.phases['4']).toBe('pending');
    expect(state.phases['5']).toBe('pending');
    expect(state.phaseCodexSessions['7']).toBeNull();
    expect(runPhaseLoop).toHaveBeenCalledOnce();
  });

  it('rejects jump to a skipped phase (light flow guard)', async () => {
    const state = makeState({ flow: 'light', phases: { '1': 'completed', '2': 'skipped', '3': 'skipped', '4': 'skipped', '5': 'failed', '6': 'pending', '7': 'pending' } });
    await expect(
      performJump(3, state, '/harness', makeTmpDir(), '/cwd', new MockInput() as unknown as InputManager, makeLogger())
    ).rejects.toThrow(/skipped/);
  });
});

describe('enterFailedTerminalState', () => {
  it("R triggers performResume and re-enters runPhaseLoop", async () => {
    const { runPhaseLoop } = await import('../../src/phases/runner.js');
    vi.mocked(runPhaseLoop).mockClear();
    const state = makeState();
    // After R returns, the loop tops back; then Q exits. Mock runPhaseLoop to
    // mark all phases completed so the outer terminal loop returns instead of
    // re-prompting forever.
    vi.mocked(runPhaseLoop).mockImplementationOnce(async (s: any) => {
      s.status = 'completed';
    });
    const input = new MockInput();
    input.enqueue('r');
    await enterFailedTerminalState(state, '/harness', makeTmpDir(), '/cwd', input as unknown as InputManager, makeLogger());
    expect(runPhaseLoop).toHaveBeenCalledOnce();
  });

  it('Q exits cleanly without re-entering the loop', async () => {
    const { runPhaseLoop } = await import('../../src/phases/runner.js');
    vi.mocked(runPhaseLoop).mockClear();
    const state = makeState();
    const input = new MockInput();
    input.enqueue('q');
    await enterFailedTerminalState(state, '/harness', makeTmpDir(), '/cwd', input as unknown as InputManager, makeLogger());
    expect(runPhaseLoop).not.toHaveBeenCalled();
  });

  it('J prompts for phase number, then dispatches performJump', async () => {
    const { runPhaseLoop } = await import('../../src/phases/runner.js');
    vi.mocked(runPhaseLoop).mockClear();
    vi.mocked(runPhaseLoop).mockImplementationOnce(async (s: any) => {
      s.status = 'completed';
    });
    const state = makeState();
    const input = new MockInput();
    input.enqueue('j', '3');
    await enterFailedTerminalState(state, '/harness', makeTmpDir(), '/cwd', input as unknown as InputManager, makeLogger());
    expect(state.currentPhase).toBe(3);
    expect(runPhaseLoop).toHaveBeenCalledOnce();
  });
});

describe('enterCompleteTerminalState', () => {
  it('renders the panel and returns when the abort signal fires', async () => {
    const state = makeState({ status: 'completed' });
    const ac = new AbortController();
    const p = enterCompleteTerminalState(state, makeTmpDir(), '/cwd', makeLogger(), ac.signal);
    setTimeout(() => ac.abort(), 10);
    await p;
  });
});
