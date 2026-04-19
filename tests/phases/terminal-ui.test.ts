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
  findFailedPhase,
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

describe('findFailedPhase', () => {
  it('returns the lowest-numbered failed phase regardless of key insertion order', () => {
    // Build phases map in reverse insertion order to defeat any
    // implementation relying on insertion ordering.
    const phases: Record<string, any> = {};
    phases['7'] = 'failed';
    phases['5'] = 'failed';
    phases['3'] = 'pending';
    phases['1'] = 'completed';
    expect(findFailedPhase(makeState({ phases: phases as any }))).toBe(5);
  });

  it('returns null when no phase is failed/error', () => {
    expect(findFailedPhase(makeState({
      phases: { '1': 'completed', '2': 'completed', '3': 'completed', '4': 'completed', '5': 'completed', '6': 'completed', '7': 'pending' } as any,
    }))).toBeNull();
  });

  it('treats "error" status as failed', () => {
    expect(findFailedPhase(makeState({
      phases: { '1': 'completed', '2': 'completed', '3': 'completed', '4': 'completed', '5': 'error', '6': 'pending', '7': 'pending' } as any,
    }))).toBe(5);
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

  it('throws when called with no failed phase', async () => {
    const state = makeState({ phases: { '1': 'completed', '2': 'completed', '3': 'completed', '4': 'completed', '5': 'pending', '6': 'pending', '7': 'pending' } });
    await expect(
      performResume(state, '/h', makeTmpDir(), '/cwd', new MockInput() as unknown as InputManager, makeLogger(), { value: false })
    ).rejects.toThrow(/no failed phase/);
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
  it("R triggers performResume and emits terminal_action event", async () => {
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
    const logger = makeLogger();
    await enterFailedTerminalState(state, '/harness', makeTmpDir(), '/cwd', input as unknown as InputManager, logger);
    expect(runPhaseLoop).toHaveBeenCalledOnce();
    expect(logger.logEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'terminal_action',
      action: 'resume',
      fromPhase: 5,
    }));
  });

  it('R triggers performResume; if a fresh failure surfaces, loop continues until Q', async () => {
    const { runPhaseLoop } = await import('../../src/phases/runner.js');
    vi.mocked(runPhaseLoop).mockClear();
    // First R: runPhaseLoop runs, leaves state with phase 6 newly failed.
    vi.mocked(runPhaseLoop).mockImplementationOnce(async (s: any) => {
      s.phases['5'] = 'completed';
      s.phases['6'] = 'failed';
      // status stays 'in_progress' — loop should re-prompt
    });
    const state = makeState();
    const input = new MockInput();
    // R → loop returns with new failure → render again → Q to exit
    input.enqueue('r', 'q');
    await enterFailedTerminalState(state, '/harness', makeTmpDir(), '/cwd', input as unknown as InputManager, makeLogger());
    expect(runPhaseLoop).toHaveBeenCalledOnce();
    expect(state.phases['6']).toBe('failed');
  });

  it('Q exits cleanly without re-entering the loop and emits terminal_action quit', async () => {
    const { runPhaseLoop } = await import('../../src/phases/runner.js');
    vi.mocked(runPhaseLoop).mockClear();
    const state = makeState();
    const input = new MockInput();
    input.enqueue('q');
    const logger = makeLogger();
    await enterFailedTerminalState(state, '/harness', makeTmpDir(), '/cwd', input as unknown as InputManager, logger);
    expect(runPhaseLoop).not.toHaveBeenCalled();
    expect(logger.logEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'terminal_action',
      action: 'quit',
      fromPhase: 5,
    }));
  });

  it('J prompts for phase number, then dispatches performJump and emits terminal_action jump', async () => {
    const { runPhaseLoop } = await import('../../src/phases/runner.js');
    vi.mocked(runPhaseLoop).mockClear();
    vi.mocked(runPhaseLoop).mockImplementationOnce(async (s: any) => {
      s.status = 'completed';
    });
    const state = makeState();
    const input = new MockInput();
    input.enqueue('j', '3');
    const logger = makeLogger();
    await enterFailedTerminalState(state, '/harness', makeTmpDir(), '/cwd', input as unknown as InputManager, logger);
    expect(state.currentPhase).toBe(3);
    expect(runPhaseLoop).toHaveBeenCalledOnce();
    expect(logger.logEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'terminal_action',
      action: 'jump',
      fromPhase: 5,
      targetPhase: 3,
    }));
  });

  it('shows a fast-Claude-failure hint when the most recent phase_end matches', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const state = makeState();
    const runDir = makeTmpDir();
    fs.writeFileSync(path.join(runDir, 'events.jsonl'),
      JSON.stringify({ event: 'phase_end', phase: 5, status: 'failed', durationMs: 6800, claudeTokens: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, total: 0 } }) + '\n');
    const input = new MockInput();
    input.enqueue('q');
    await enterFailedTerminalState(state, '/harness', runDir, '/cwd', input as unknown as InputManager, makeLogger());
    const hintShown = stderrSpy.mock.calls.some(c => /Hint: Claude exited within/.test(String(c[0])));
    expect(hintShown).toBe(true);
    stderrSpy.mockRestore();
  });

  it('does not show the hint when duration is long', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const state = makeState();
    const runDir = makeTmpDir();
    fs.writeFileSync(path.join(runDir, 'events.jsonl'),
      JSON.stringify({ event: 'phase_end', phase: 5, status: 'failed', durationMs: 600_000, claudeTokens: null }) + '\n');
    const input = new MockInput();
    input.enqueue('q');
    await enterFailedTerminalState(state, '/harness', runDir, '/cwd', input as unknown as InputManager, makeLogger());
    const hintShown = stderrSpy.mock.calls.some(c => /Hint: Claude exited within/.test(String(c[0])));
    expect(hintShown).toBe(false);
    stderrSpy.mockRestore();
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
