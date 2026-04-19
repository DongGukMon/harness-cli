import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { HarnessState, GatePhaseResult } from '../../src/types.js';
import { runGatePhase } from '../../src/phases/gate.js';

vi.mock('../../src/runners/codex.js', () => ({ runCodexGate: vi.fn() }));
vi.mock('../../src/runners/claude.js', () => ({ runClaudeGate: vi.fn() }));
vi.mock('../../src/context/assembler.js', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    // return non-empty strings so Buffer.byteLength + dispatch don't choke
    assembleGatePrompt: vi.fn(() => 'FRESH_PROMPT'),
    assembleGateResumePrompt: vi.fn(() => 'RESUME_PROMPT'),
  };
});

import { runCodexGate } from '../../src/runners/codex.js';
import { runClaudeGate } from '../../src/runners/claude.js';

function makeState(): HarnessState {
  return {
    runId: 'r1', flow: 'full', carryoverFeedback: null,
    currentPhase: 2, status: 'in_progress', autoMode: false,
    task: 't', baseCommit: '', implRetryBase: '', codexPath: null,
    externalCommitsDetected: false,
    artifacts: { spec: 's', plan: 'p', decisionLog: 'd', checklist: 'c', evalReport: 'e' },
    phases: { '1': 'pending', '2': 'pending', '3': 'pending', '4': 'pending', '5': 'pending', '6': 'pending', '7': 'pending' },
    gateRetries: { '2': 0, '4': 0, '7': 0 },
    verifyRetries: 0,
    pauseReason: null, specCommit: null, planCommit: null, implCommit: null,
    evalCommit: null, verifiedAtHead: null, pausedAtHead: null, pendingAction: null,
    phaseOpenedAt: { '1': null, '3': null, '5': null },
    phaseAttemptId: { '1': null, '3': null, '5': null },
    phasePresets: { '1': 'opus-xhigh', '2': 'codex-high', '3': 'sonnet-high', '4': 'codex-high', '5': 'sonnet-high', '7': 'codex-high' },
    phaseReopenFlags: { '1': false, '3': false, '5': false },
    phaseCodexSessions: { '2': null, '4': null, '7': null },
    lastWorkspacePid: null, lastWorkspacePidStartTime: null,
    tmuxSession: '', tmuxMode: 'dedicated', tmuxWindows: [],
    tmuxControlWindow: '', tmuxWorkspacePane: '', tmuxControlPane: '',
    loggingEnabled: false,
    phaseReopenSource: { '1': null, '3': null, '5': null },
    codexNoIsolate: false,
  };
}

function mockVerdict(overrides: Partial<GatePhaseResult> = {}): GatePhaseResult {
  return {
    type: 'verdict',
    verdict: 'REJECT',
    comments: 'P1',
    rawOutput: 'session id: aa-11\n## Verdict\nREJECT\n',
    runner: 'codex',
    codexSessionId: 'aa-11',
    sourcePreset: { model: 'gpt-5.4', effort: 'high' },
    resumedFrom: null,
    resumeFallback: false,
    ...overrides,
  } as GatePhaseResult;
}

let runDir: string;
beforeEach(() => {
  runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-resume-'));
});
afterEach(() => { vi.clearAllMocks(); });

// ─── Basic path dispatch ─────────────────────────────────────────────────────

describe('runGatePhase — first call (fresh)', () => {
  it('calls runCodexGate without resumeSessionId and saves new session', async () => {
    const state = makeState();
    vi.mocked(runCodexGate).mockResolvedValueOnce(mockVerdict());
    const res = await runGatePhase(2, state, runDir, runDir, runDir);
    expect(res.type).toBe('verdict');
    expect(vi.mocked(runCodexGate).mock.calls[0][5]).toBeNull();
    expect(state.phaseCodexSessions['2']).toEqual({
      sessionId: 'aa-11', runner: 'codex', model: 'gpt-5.4', effort: 'high', lastOutcome: 'reject',
    });
  });
});

describe('runGatePhase — second call (resume)', () => {
  it('passes stored sessionId on compatible preset', async () => {
    const state = makeState();
    state.phaseCodexSessions['2'] = {
      sessionId: 'aa-11', runner: 'codex', model: 'gpt-5.4', effort: 'high', lastOutcome: 'reject',
    };
    vi.mocked(runCodexGate).mockResolvedValueOnce(
      mockVerdict({ verdict: 'APPROVE', resumedFrom: 'aa-11', codexSessionId: 'aa-11' }),
    );
    await runGatePhase(2, state, runDir, runDir, runDir);
    expect(vi.mocked(runCodexGate).mock.calls[0][5]).toBe('aa-11');
  });
});

describe('runGatePhase — incompatible saved session', () => {
  it('nulls saved session and uses fresh path when model differs', async () => {
    const state = makeState();
    state.phaseCodexSessions['2'] = {
      sessionId: 'aa-11', runner: 'codex', model: 'old-model', effort: 'high', lastOutcome: 'reject',
    };
    vi.mocked(runCodexGate).mockResolvedValueOnce(mockVerdict());
    await runGatePhase(2, state, runDir, runDir, runDir);
    expect(vi.mocked(runCodexGate).mock.calls[0][5]).toBeNull();
  });
});

describe('runGatePhase — resumeFallback clears stale id when new id absent', () => {
  it('clears stale id when fallback fires with no new id', async () => {
    const state = makeState();
    state.phaseCodexSessions['2'] = {
      sessionId: 'stale-aa', runner: 'codex', model: 'gpt-5.4', effort: 'high', lastOutcome: 'reject',
    };
    vi.mocked(runCodexGate).mockResolvedValueOnce({
      type: 'error',
      error: 'fallback failed',
      runner: 'codex',
      resumedFrom: 'stale-aa',
      resumeFallback: true,
      codexSessionId: undefined,
    } as GatePhaseResult);
    await runGatePhase(2, state, runDir, runDir, runDir);
    expect(state.phaseCodexSessions['2']).toBeNull();
  });

  // §4.4 P1 regression (eval gate round-6): if a resumeFallback response
  // accidentally carries forward the stale sessionId, runGatePhase must NOT
  // re-persist that dead lineage. Clearing happens unconditionally on
  // resumeFallback=true, then save only a new non-empty id.
  it('§4.4 does not re-save stale sessionId on resumeFallback=true (order: clear → conditional save)', async () => {
    const state = makeState();
    state.phaseCodexSessions['2'] = {
      sessionId: 'dead-sid', runner: 'codex', model: 'gpt-5.4', effort: 'high', lastOutcome: 'reject',
    };
    // runCodexGate returns an error where resumeFallback=true but codexSessionId
    // is the DEAD id (worst-case metadata carry-forward).
    vi.mocked(runCodexGate).mockResolvedValueOnce({
      type: 'error',
      error: 'Resume fallback failed: fresh prompt too large',
      runner: 'codex',
      resumedFrom: 'dead-sid',
      resumeFallback: true,
      codexSessionId: 'dead-sid', // ← stale id leaked through
    } as GatePhaseResult);
    await runGatePhase(2, state, runDir, runDir, runDir);
    // Cleared — not re-saved with the stale id
    expect(state.phaseCodexSessions['2']).toBeNull();
  });

  it('§4.4 accepts a NEW non-empty id on resumeFallback=true, overwriting the dead lineage', async () => {
    const state = makeState();
    state.phaseCodexSessions['2'] = {
      sessionId: 'dead-sid', runner: 'codex', model: 'gpt-5.4', effort: 'high', lastOutcome: 'reject',
    };
    vi.mocked(runCodexGate).mockResolvedValueOnce({
      type: 'verdict', verdict: 'APPROVE', comments: '', rawOutput: '',
      runner: 'codex',
      resumedFrom: 'dead-sid',
      resumeFallback: true,
      codexSessionId: 'new-fresh-sid',
    } as GatePhaseResult);
    await runGatePhase(2, state, runDir, runDir, runDir);
    expect(state.phaseCodexSessions['2']?.sessionId).toBe('new-fresh-sid');
    expect(state.phaseCodexSessions['2']?.lastOutcome).toBe('approve');
  });

  // §4.1 trim-non-empty guard at persist site (P2 backported from round-3/5/6)
  it('§4.1 rejects whitespace-only codexSessionId at persist site', async () => {
    const state = makeState();
    vi.mocked(runCodexGate).mockResolvedValueOnce({
      type: 'verdict', verdict: 'APPROVE', comments: '', rawOutput: '',
      runner: 'codex',
      codexSessionId: '   ', // malformed
      resumedFrom: null,
      resumeFallback: false,
    } as GatePhaseResult);
    await runGatePhase(2, state, runDir, runDir, runDir);
    // Whitespace id must NOT be persisted
    expect(state.phaseCodexSessions['2']).toBeNull();
  });
});

describe('runGatePhase — stillActivePhase guard', () => {
  it('skips session persist if currentPhase changed during call', async () => {
    const state = makeState();
    vi.mocked(runCodexGate).mockImplementationOnce(async () => {
      state.currentPhase = 3; // simulate SIGUSR1 jump during call
      return mockVerdict({ codexSessionId: 'should-not-save' });
    });
    await runGatePhase(2, state, runDir, runDir, runDir);
    expect(state.phaseCodexSessions['2']).toBeNull();
  });

  // §4.4 step 6 / §4.10 (P0 fix): if currentPhase changed during gate,
  // runGatePhase must not write sidecar files either — otherwise the jump
  // invalidation's replay-sidecar deletion is re-armed by the stale gate.
  it('does not write gate-N-raw/result.json sidecars when currentPhase changed mid-gate', async () => {
    const state = makeState();
    vi.mocked(runCodexGate).mockImplementationOnce(async () => {
      state.currentPhase = 3; // simulate jump during gate run
      return mockVerdict({ codexSessionId: 'should-not-save' });
    });
    await runGatePhase(2, state, runDir, runDir, runDir);
    expect(fs.existsSync(path.join(runDir, 'gate-2-raw.txt'))).toBe(false);
    expect(fs.existsSync(path.join(runDir, 'gate-2-result.json'))).toBe(false);
  });
});

// ─── §4.7 sidecar replay compatibility gate (4 scenarios) ────────────────────

describe('runGatePhase — sidecar replay compatibility gate (§4.7)', () => {
  function writeSidecar(
    phase: 2 | 4 | 7,
    result: {
      verdict?: 'APPROVE' | 'REJECT';
      runner: 'claude' | 'codex';
      codexSessionId?: string;
      sourcePreset?: { model: string; effort: string };
    },
  ) {
    const raw = `session id: ${result.codexSessionId ?? 'aa-11'}\n## Verdict\n${result.verdict ?? 'APPROVE'}\n`;
    fs.writeFileSync(path.join(runDir, `gate-${phase}-raw.txt`), raw);
    fs.writeFileSync(
      path.join(runDir, `gate-${phase}-result.json`),
      JSON.stringify({
        exitCode: 0,
        timestamp: Date.now(),
        runner: result.runner,
        codexSessionId: result.codexSessionId,
        sourcePreset: result.sourcePreset,
      }),
    );
  }

  it('(1) compatible Codex sidecar: replay accepted, hydrates phaseCodexSessions', async () => {
    const state = makeState();
    writeSidecar(2, {
      verdict: 'REJECT',
      runner: 'codex',
      codexSessionId: 'side-aa',
      sourcePreset: { model: 'gpt-5.4', effort: 'high' },
    });
    const flag = { value: true };
    const res = await runGatePhase(2, state, runDir, runDir, runDir, flag);
    // runCodexGate는 호출되지 않아야 함 (replay hit)
    expect(vi.mocked(runCodexGate).mock.calls.length).toBe(0);
    expect(res.type).toBe('verdict');
    expect((res as any).recoveredFromSidecar).toBe(true);
    // Hydration 확인
    expect(state.phaseCodexSessions['2']).toEqual({
      sessionId: 'side-aa', runner: 'codex', model: 'gpt-5.4', effort: 'high', lastOutcome: 'reject',
    });
  });

  it('(2) mismatched sourcePreset: replay skipped, live path taken', async () => {
    const state = makeState();
    writeSidecar(2, {
      verdict: 'APPROVE',
      runner: 'codex',
      codexSessionId: 'mismatch-aa',
      sourcePreset: { model: 'some-other-model', effort: 'high' },
    });
    vi.mocked(runCodexGate).mockResolvedValueOnce(
      mockVerdict({ codexSessionId: 'live-aa' }),
    );
    const flag = { value: true };
    await runGatePhase(2, state, runDir, runDir, runDir, flag);
    // Live path 탔는지 확인
    expect(vi.mocked(runCodexGate).mock.calls.length).toBe(1);
    expect(state.phaseCodexSessions['2']?.sessionId).toBe('live-aa');
  });

  it('(3) legacy sidecar (no runner/sourcePreset metadata): replay skipped', async () => {
    const state = makeState();
    fs.writeFileSync(path.join(runDir, 'gate-2-raw.txt'), 'session id: legacy\n## Verdict\nAPPROVE\n');
    fs.writeFileSync(
      path.join(runDir, 'gate-2-result.json'),
      JSON.stringify({ exitCode: 0, timestamp: Date.now() }),
    );
    vi.mocked(runCodexGate).mockResolvedValueOnce(
      mockVerdict({ codexSessionId: 'live-aa' }),
    );
    const flag = { value: true };
    await runGatePhase(2, state, runDir, runDir, runDir, flag);
    // replay skip → live spawn
    expect(vi.mocked(runCodexGate).mock.calls.length).toBe(1);
    expect(state.phaseCodexSessions['2']?.sessionId).toBe('live-aa');
  });

  it('(4) Claude sidecar with matching runner: replay accepted, no codex hydration', async () => {
    const state = makeState();
    // Claude runner 로 교체
    state.phasePresets['2'] = 'sonnet-high';
    writeSidecar(2, { verdict: 'APPROVE', runner: 'claude' });
    const flag = { value: true };
    const res = await runGatePhase(2, state, runDir, runDir, runDir, flag);
    // Neither runner should be called (replay hit)
    expect(vi.mocked(runCodexGate).mock.calls.length).toBe(0);
    expect(vi.mocked(runClaudeGate).mock.calls.length).toBe(0);
    expect(res.type).toBe('verdict');
    expect((res as any).recoveredFromSidecar).toBe(true);
    // Claude replay는 phaseCodexSessions hydrate 대상 아님
    expect(state.phaseCodexSessions['2']).toBeNull();
  });
});
