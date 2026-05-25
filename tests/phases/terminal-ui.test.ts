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

// #116 B3: the R-confirm-kill prompt depends on `computeWorkerLiveness` reading
// real PID state from `src/process.js`. We mock those primitives so controller
// tests can drive the alive/dead branches without spawning real processes.
vi.mock('../../src/process.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/process.js')>();
  return {
    ...actual,
    isPidAlive: vi.fn(() => false),
    isSameProcessInstance: vi.fn(() => false),
  };
});

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
    trackedRepos: [{ path: '', baseCommit: 'base', implRetryBase: 'base', implHead: null }],
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
    phaseClaudeSessions: { '1': null, '3': null, '5': null },
    lastWorkspacePid: null, lastWorkspacePidStartTime: null,
    tmuxSession: '', tmuxMode: 'dedicated', tmuxWindows: [],
    tmuxControlWindow: '', tmuxWorkspacePane: '', tmuxControlPane: '',
    loggingEnabled: false,
    phaseReopenSource: { '1': null, '3': null, '5': null },
    codexNoIsolate: false,
    noDrift: false,
    dirtyBaseline: [],
    autoDeferIssues: false,
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

  it('rolls back phases[failed] to "failed" + logs resume_error when runPhaseLoop throws', async () => {
    // Repro of the 0.3.0 field bug: a long-running inner process loses its
    // installed modules, `await import('./runner.js')` throws "Cannot find module",
    // performResume's pre-throw write leaves phases[failed]='pending' on disk.
    // Before the fix, the NEXT R press calls findFailedPhase → null → throws
    // "performResume called with no failed phase" in an unrecoverable cycle.
    const { runPhaseLoop } = await import('../../src/phases/runner.js');
    (runPhaseLoop as any).mockRejectedValueOnce(new Error("Cannot find module './runner.js'"));

    const state = makeState({ phases: { '1': 'completed', '2': 'completed', '3': 'completed', '4': 'completed', '5': 'failed', '6': 'pending', '7': 'pending' } });
    const runDir = makeTmpDir();
    const input = new MockInput() as unknown as InputManager;
    const logger = makeLogger();

    await expect(
      performResume(state, '/h', runDir, '/cwd', input, logger, { value: false })
    ).rejects.toThrow(/Cannot find module/);

    // Post-throw: phase status must be restored so the next R press works.
    expect(state.phases['5']).toBe('failed');
    // state.json on disk also reflects the rollback (atomic write).
    const diskState = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf-8'));
    expect(diskState.phases['5']).toBe('failed');

    // resume_error event is recorded for observability.
    expect(logger.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'resume_error', phase: 5, message: expect.stringContaining('Cannot find module') }),
    );
  });
});

describe('performJump (inner-side)', () => {
  it('resets phases >= target to pending, sets currentPhase, invalidates gate sessions, re-enters loop', async () => {
    const { runPhaseLoop } = await import('../../src/phases/runner.js');
    vi.mocked(runPhaseLoop).mockClear();
    const state = makeState({ currentPhase: 5, phases: { '1': 'completed', '2': 'completed', '3': 'completed', '4': 'completed', '5': 'failed', '6': 'pending', '7': 'pending' } });
    state.phaseCodexSessions['7'] = { sessionId: 's7', runner: 'codex', model: 'gpt-5.5', effort: 'high', lastOutcome: 'reject' };
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

  it('accepts gate phase (4) as a jump target; invalidates ≥4 gate sessions', async () => {
    const { runPhaseLoop } = await import('../../src/phases/runner.js');
    vi.mocked(runPhaseLoop).mockClear();
    const state = makeState({
      currentPhase: 5,
      phases: { '1': 'completed', '2': 'completed', '3': 'completed', '4': 'completed', '5': 'failed', '6': 'pending', '7': 'pending' },
    });
    state.phaseCodexSessions['2'] = { sessionId: 's2', runner: 'codex', model: 'gpt-5.5', effort: 'high', lastOutcome: 'approve' };
    state.phaseCodexSessions['4'] = { sessionId: 's4', runner: 'codex', model: 'gpt-5.5', effort: 'high', lastOutcome: 'approve' };
    state.phaseCodexSessions['7'] = { sessionId: 's7', runner: 'codex', model: 'gpt-5.5', effort: 'high', lastOutcome: 'reject' };

    await performJump(4, state, '/harness', makeTmpDir(), '/cwd',
      new MockInput() as unknown as InputManager, makeLogger());

    expect(state.currentPhase).toBe(4);
    expect(state.phases['4']).toBe('pending');
    expect(state.phases['5']).toBe('pending');
    // §4.9: invalidate ≥target gate sessions only — phase 2 lineage survives.
    expect(state.phaseCodexSessions['2']).not.toBeNull();
    expect(state.phaseCodexSessions['4']).toBeNull();
    expect(state.phaseCodexSessions['7']).toBeNull();
    expect(runPhaseLoop).toHaveBeenCalledOnce();
  });

  it('accepts verify phase (6) as a jump target', async () => {
    const { runPhaseLoop } = await import('../../src/phases/runner.js');
    vi.mocked(runPhaseLoop).mockClear();
    const state = makeState({
      currentPhase: 7,
      phases: { '1': 'completed', '2': 'completed', '3': 'completed', '4': 'completed', '5': 'completed', '6': 'completed', '7': 'failed' },
    });
    state.phaseCodexSessions['7'] = { sessionId: 's7', runner: 'codex', model: 'gpt-5.5', effort: 'high', lastOutcome: 'reject' };

    await performJump(6, state, '/harness', makeTmpDir(), '/cwd',
      new MockInput() as unknown as InputManager, makeLogger());

    expect(state.currentPhase).toBe(6);
    expect(state.phases['6']).toBe('pending');
    expect(state.phases['7']).toBe('pending');
    expect(state.phaseCodexSessions['7']).toBeNull();
    expect(runPhaseLoop).toHaveBeenCalledOnce();
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

  it('J accepts a gate phase (4) as a target when ≤ failedPhase', async () => {
    const { runPhaseLoop } = await import('../../src/phases/runner.js');
    vi.mocked(runPhaseLoop).mockClear();
    vi.mocked(runPhaseLoop).mockImplementationOnce(async (s: any) => {
      s.status = 'completed';
    });
    const state = makeState({
      currentPhase: 5,
      phases: { '1': 'completed', '2': 'completed', '3': 'completed', '4': 'completed', '5': 'failed', '6': 'pending', '7': 'pending' },
    });
    const input = new MockInput();
    input.enqueue('j', '4');
    const logger = makeLogger();
    await enterFailedTerminalState(state, '/harness', makeTmpDir(), '/cwd', input as unknown as InputManager, logger);
    expect(state.currentPhase).toBe(4);
    expect(runPhaseLoop).toHaveBeenCalledOnce();
    expect(logger.logEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'terminal_action', action: 'jump', fromPhase: 5, targetPhase: 4,
    }));
  });

  it('J rejects forward jump (> failedPhase) — waitForKey throws on invalid key', async () => {
    // Forward jump (failed=5, attempt 6 or 7) must not be in the valid set.
    // The MockInput's waitForKey throws when the key is not in the valid set,
    // which simulates the user being unable to select it (real UI keeps prompting).
    const state = makeState({
      currentPhase: 5,
      phases: { '1': 'completed', '2': 'completed', '3': 'completed', '4': 'completed', '5': 'failed', '6': 'pending', '7': 'pending' },
    });
    const input = new MockInput();
    // J → 6 (forward, must NOT be in target set) → MockInput throws "key 6 not in valid set"
    input.enqueue('j', '6');
    await expect(
      enterFailedTerminalState(state, '/harness', makeTmpDir(), '/cwd', input as unknown as InputManager, makeLogger())
    ).rejects.toThrow(/key 6 not in valid set/);
    expect(state.currentPhase).toBe(5);
  });

  it('J skips light-flow skipped phases from target list', async () => {
    const state = makeState({
      flow: 'light',
      currentPhase: 5,
      phases: { '1': 'completed', '2': 'completed', '3': 'skipped', '4': 'skipped', '5': 'failed', '6': 'pending', '7': 'pending' },
    });
    const input = new MockInput();
    // J → 3 (skipped) must NOT be in target set → MockInput throws.
    input.enqueue('j', '3');
    await expect(
      enterFailedTerminalState(state, '/harness', makeTmpDir(), '/cwd', input as unknown as InputManager, makeLogger())
    ).rejects.toThrow(/key 3 not in valid set/);
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

  // #116 B3: confirm-kill prompt when [R] is pressed while a workspace worker
  // is alive. Existing R/J/Q tests above run with `lastWorkspacePid: null`, which
  // makes `computeWorkerLiveness` return `undefined` — they skip the prompt branch
  // entirely (zero behavior change for the dead/undefined R path).
  describe('#116 B3 — R confirm-kill prompt', () => {
    it('cancels resume on N: respawn NOT invoked, no terminal_action emitted, R/J/Q prompt re-shown', async () => {
      const { runPhaseLoop } = await import('../../src/phases/runner.js');
      vi.mocked(runPhaseLoop).mockClear();
      const { isPidAlive, isSameProcessInstance } = await import('../../src/process.js');
      vi.mocked(isPidAlive).mockReturnValue(true);
      vi.mocked(isSameProcessInstance).mockReturnValue(true);

      const state = makeState({
        lastWorkspacePid: 4242,
        lastWorkspacePidStartTime: 1_700_000_000,
      });
      const input = new MockInput();
      // R → N (cancel) → Q (exit without resume)
      input.enqueue('r', 'n', 'q');
      const logger = makeLogger();
      await enterFailedTerminalState(state, '/harness', makeTmpDir(), '/cwd', input as unknown as InputManager, logger);

      // respawn-path (runPhaseLoop) never called.
      expect(runPhaseLoop).not.toHaveBeenCalled();
      // No `terminal_action action=resume` event for the cancelled press; only the final quit.
      const events = (logger.logEvent as any).mock.calls.map((c: any[]) => c[0]);
      const resumeEvents = events.filter((e: any) => e.event === 'terminal_action' && e.action === 'resume');
      expect(resumeEvents).toHaveLength(0);
      const quitEvents = events.filter((e: any) => e.event === 'terminal_action' && e.action === 'quit');
      expect(quitEvents).toHaveLength(1);
    });

    it('proceeds on Y: respawn IS invoked, terminal_action emitted with confirmedKill=true', async () => {
      const { runPhaseLoop } = await import('../../src/phases/runner.js');
      vi.mocked(runPhaseLoop).mockClear();
      vi.mocked(runPhaseLoop).mockImplementationOnce(async (s: any) => {
        s.status = 'completed';
      });
      const { isPidAlive, isSameProcessInstance } = await import('../../src/process.js');
      vi.mocked(isPidAlive).mockReturnValue(true);
      vi.mocked(isSameProcessInstance).mockReturnValue(true);

      const state = makeState({
        lastWorkspacePid: 4242,
        lastWorkspacePidStartTime: 1_700_000_000,
      });
      const input = new MockInput();
      input.enqueue('r', 'y');
      const logger = makeLogger();
      await enterFailedTerminalState(state, '/harness', makeTmpDir(), '/cwd', input as unknown as InputManager, logger);

      expect(runPhaseLoop).toHaveBeenCalledOnce();
      expect(logger.logEvent).toHaveBeenCalledWith(expect.objectContaining({
        event: 'terminal_action',
        action: 'resume',
        fromPhase: 5,
        confirmedKill: true,
      }));
    });

    it('dead-worker path is unchanged: no prompt, single R → resume, no confirmedKill on event', async () => {
      const { runPhaseLoop } = await import('../../src/phases/runner.js');
      vi.mocked(runPhaseLoop).mockClear();
      vi.mocked(runPhaseLoop).mockImplementationOnce(async (s: any) => {
        s.status = 'completed';
      });
      const { isPidAlive } = await import('../../src/process.js');
      // PID present but DEAD — must skip the prompt entirely.
      vi.mocked(isPidAlive).mockReturnValue(false);

      const state = makeState({
        lastWorkspacePid: 4242,
        lastWorkspacePidStartTime: 1_700_000_000,
      });
      const input = new MockInput();
      // Single R — no confirmation key needed.
      input.enqueue('r');
      const logger = makeLogger();
      await enterFailedTerminalState(state, '/harness', makeTmpDir(), '/cwd', input as unknown as InputManager, logger);

      expect(runPhaseLoop).toHaveBeenCalledOnce();
      const resumeEvent = (logger.logEvent as any).mock.calls
        .map((c: any[]) => c[0])
        .find((e: any) => e.event === 'terminal_action' && e.action === 'resume');
      expect(resumeEvent).toBeDefined();
      // `confirmedKill` field must be ABSENT when no confirmation occurred
      // (additive field; absence preserves the legacy event shape).
      expect(resumeEvent).not.toHaveProperty('confirmedKill');
    });

    it('undefined-liveness path (no PID tracked) is unchanged: no prompt, no confirmedKill', async () => {
      const { runPhaseLoop } = await import('../../src/phases/runner.js');
      vi.mocked(runPhaseLoop).mockClear();
      vi.mocked(runPhaseLoop).mockImplementationOnce(async (s: any) => {
        s.status = 'completed';
      });

      // Default state has lastWorkspacePid: null → computeWorkerLiveness returns undefined.
      const state = makeState();
      const input = new MockInput();
      input.enqueue('r');
      const logger = makeLogger();
      await enterFailedTerminalState(state, '/harness', makeTmpDir(), '/cwd', input as unknown as InputManager, logger);

      expect(runPhaseLoop).toHaveBeenCalledOnce();
      const resumeEvent = (logger.logEvent as any).mock.calls
        .map((c: any[]) => c[0])
        .find((e: any) => e.event === 'terminal_action' && e.action === 'resume');
      expect(resumeEvent).toBeDefined();
      expect(resumeEvent).not.toHaveProperty('confirmedKill');
    });
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
