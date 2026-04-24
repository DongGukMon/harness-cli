import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { HarnessState, GatePhaseResult } from '../../src/types.js';
import { runGatePhase } from '../../src/phases/gate.js';

vi.mock('../../src/runners/codex.js', () => ({
  runCodexGate: vi.fn(),
  spawnCodexInPane: vi.fn().mockResolvedValue({ pid: null }),
}));
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
vi.mock('../../src/runners/codex-usage.js', () => ({
  readCodexSessionUsage: vi.fn(),
}));
vi.mock('../../src/phases/interactive.js', () => ({
  waitForPhaseCompletion: vi.fn(),
}));

import { spawnCodexInPane } from '../../src/runners/codex.js';
import { runClaudeGate } from '../../src/runners/claude.js';
import { readCodexSessionUsage } from '../../src/runners/codex-usage.js';
import { waitForPhaseCompletion } from '../../src/phases/interactive.js';

function makeState(): HarnessState {
  return {
    runId: 'r1', flow: 'full', carryoverFeedback: null,
    currentPhase: 2, status: 'in_progress', autoMode: false,
    task: 't', baseCommit: '', implRetryBase: '',
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
    phasePresets: { '1': 'opus-xhigh', '2': 'codex-high', '3': 'sonnet-high', '4': 'codex-high', '5': 'sonnet-high', '7': 'codex-high' },
    phaseReopenFlags: { '1': false, '3': false, '5': false },
    phaseCodexSessions: { '2': null, '4': null, '7': null },
    phaseClaudeSessions: { '1': null, '3': null, '5': null },
    lastWorkspacePid: null, lastWorkspacePidStartTime: null,
    tmuxSession: '', tmuxMode: 'dedicated', tmuxWindows: [],
    tmuxControlWindow: '', tmuxWorkspacePane: '', tmuxControlPane: '',
    loggingEnabled: false,
    phaseReopenSource: { '1': null, '3': null, '5': null },
    codexNoIsolate: false,
    dirtyBaseline: [],
  };
}

function writeVerdictFile(dir: string, phase: number, verdict: 'APPROVE' | 'REJECT', comments = ''): void {
  fs.writeFileSync(
    path.join(dir, `gate-${phase}-verdict.md`),
    `## Verdict\n${verdict}\n\n## Comments\n${comments}\n\n## Summary\nOk.\n`,
  );
}

import { assembleGatePrompt, assembleGateResumePrompt } from '../../src/context/assembler.js';

let runDir: string;
beforeEach(async () => {
  runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-resume-'));
  vi.resetAllMocks();
  // Restore assembler mocks after reset
  vi.mocked(assembleGatePrompt).mockReturnValue('FRESH_PROMPT');
  vi.mocked(assembleGateResumePrompt).mockReturnValue('RESUME_PROMPT');
  vi.mocked(waitForPhaseCompletion).mockResolvedValue({ status: 'completed' });
  vi.mocked(readCodexSessionUsage).mockResolvedValue(null);
  vi.mocked(spawnCodexInPane).mockResolvedValue({ pid: null });
});
afterEach(() => { vi.clearAllMocks(); });

// ─── Basic path dispatch ─────────────────────────────────────────────────────

describe('runGatePhase — first call (fresh)', () => {
  it('calls spawnCodexInPane with mode:fresh and saves session from JSONL', async () => {
    const state = makeState();
    state.phaseAttemptId['2'] = 'attempt-fresh-1';
    vi.mocked(spawnCodexInPane).mockImplementationOnce(async () => {
      writeVerdictFile(runDir, 2, 'REJECT', 'P1 issue');
      return { pid: null };
    });
    vi.mocked(readCodexSessionUsage).mockResolvedValueOnce({
      sessionId: 'aa-11',
      tokens: { input: 10, output: 5, cacheRead: 0, cacheCreate: 0, total: 15 },
    });
    const res = await runGatePhase(2, state, runDir, runDir, runDir);
    expect(res.type).toBe('verdict');
    const spawnCall = vi.mocked(spawnCodexInPane).mock.calls[0][0];
    expect(spawnCall.mode).toBe('fresh');
    expect(spawnCall.sessionId).toBeUndefined();
    expect(state.phaseCodexSessions['2']).toEqual({
      sessionId: 'aa-11', runner: 'codex', model: 'gpt-5.5', effort: 'high', lastOutcome: 'reject',
    });
  });
});

describe('runGatePhase — second call (resume)', () => {
  it('calls spawnCodexInPane with mode:resume and stored sessionId', async () => {
    const state = makeState();
    state.phaseAttemptId['2'] = 'attempt-resume-1';
    state.phaseCodexSessions['2'] = {
      sessionId: 'aa-11', runner: 'codex', model: 'gpt-5.5', effort: 'high', lastOutcome: 'reject',
    };
    vi.mocked(spawnCodexInPane).mockImplementationOnce(async () => {
      writeVerdictFile(runDir, 2, 'APPROVE', '');
      return { pid: null };
    });
    vi.mocked(readCodexSessionUsage).mockResolvedValueOnce({
      sessionId: 'aa-11',
      tokens: { input: 10, output: 5, cacheRead: 0, cacheCreate: 0, total: 15 },
    });
    await runGatePhase(2, state, runDir, runDir, runDir);
    const spawnCall = vi.mocked(spawnCodexInPane).mock.calls[0][0];
    expect(spawnCall.mode).toBe('resume');
    expect(spawnCall.sessionId).toBe('aa-11');
  });
});

describe('runGatePhase — incompatible saved session', () => {
  it('nulls saved session and uses fresh mode when model differs', async () => {
    const state = makeState();
    state.phaseAttemptId['2'] = 'attempt-incompat-1';
    state.phaseCodexSessions['2'] = {
      sessionId: 'aa-11', runner: 'codex', model: 'old-model', effort: 'high', lastOutcome: 'reject',
    };
    vi.mocked(spawnCodexInPane).mockImplementationOnce(async () => {
      writeVerdictFile(runDir, 2, 'REJECT', '');
      return { pid: null };
    });
    vi.mocked(readCodexSessionUsage).mockResolvedValueOnce({
      sessionId: 'new-sid',
      tokens: { input: 1, output: 1, cacheRead: 0, cacheCreate: 0, total: 2 },
    });
    await runGatePhase(2, state, runDir, runDir, runDir);
    const spawnCall = vi.mocked(spawnCodexInPane).mock.calls[0][0];
    expect(spawnCall.mode).toBe('fresh');
    expect(spawnCall.sessionId).toBeUndefined();
    expect(state.phaseCodexSessions['2']?.sessionId).toBe('new-sid');
  });
});

// ─── JSONL session extraction ─────────────────────────────────────────────────

describe('runGatePhase — JSONL session extraction', () => {
  it('no session saved when readCodexSessionUsage returns null', async () => {
    const state = makeState();
    state.phaseAttemptId['2'] = 'attempt-no-session';
    vi.mocked(spawnCodexInPane).mockImplementationOnce(async () => {
      writeVerdictFile(runDir, 2, 'APPROVE', '');
      return { pid: null };
    });
    // default mock returns null (set in beforeEach)
    await runGatePhase(2, state, runDir, runDir, runDir);
    expect(state.phaseCodexSessions['2']).toBeNull();
  });

  it('JSONL session overrides undefined codexSessionId from verdict file', async () => {
    const state = makeState();
    state.phaseAttemptId['2'] = 'attempt-jsonl-override';
    vi.mocked(spawnCodexInPane).mockImplementationOnce(async () => {
      writeVerdictFile(runDir, 2, 'APPROVE', '');
      return { pid: null };
    });
    vi.mocked(readCodexSessionUsage).mockResolvedValueOnce({
      sessionId: 'jsonl-sid',
      tokens: { input: 5, output: 2, cacheRead: 0, cacheCreate: 0, total: 7 },
    });
    await runGatePhase(2, state, runDir, runDir, runDir);
    expect(state.phaseCodexSessions['2']?.sessionId).toBe('jsonl-sid');
    expect(state.phaseCodexSessions['2']?.lastOutcome).toBe('approve');
  });

  it('preserves existing sessionId when resumeSessionId matches JSONL result', async () => {
    const state = makeState();
    state.phaseAttemptId['2'] = 'attempt-resume-jsonl';
    state.phaseCodexSessions['2'] = {
      sessionId: 'kept-sid', runner: 'codex', model: 'gpt-5.5', effort: 'high', lastOutcome: 'reject',
    };
    vi.mocked(spawnCodexInPane).mockImplementationOnce(async () => {
      writeVerdictFile(runDir, 2, 'APPROVE', '');
      return { pid: null };
    });
    vi.mocked(readCodexSessionUsage).mockResolvedValueOnce({
      sessionId: 'kept-sid',
      tokens: { input: 5, output: 2, cacheRead: 0, cacheCreate: 0, total: 7 },
    });
    await runGatePhase(2, state, runDir, runDir, runDir);
    // On resume, discoveredSessionId stays undefined (JSONL id not re-applied for resume path),
    // so the session slot is not overwritten — sessionId is preserved, lastOutcome unchanged.
    expect(state.phaseCodexSessions['2']?.sessionId).toBe('kept-sid');
    expect(state.phaseCodexSessions['2']?.lastOutcome).toBe('reject');
  });
});

describe('runGatePhase — stillActivePhase guard', () => {
  it('skips session persist if currentPhase changed during gate', async () => {
    const state = makeState();
    state.phaseAttemptId['2'] = 'attempt-redirect-1';
    vi.mocked(waitForPhaseCompletion).mockImplementationOnce(async () => {
      state.currentPhase = 3; // simulate SIGUSR1 jump during gate wait
      return { status: 'completed' };
    });
    vi.mocked(readCodexSessionUsage).mockResolvedValueOnce({
      sessionId: 'should-not-save',
      tokens: { input: 1, output: 1, cacheRead: 0, cacheCreate: 0, total: 2 },
    });
    vi.mocked(spawnCodexInPane).mockResolvedValueOnce({ pid: null });
    await runGatePhase(2, state, runDir, runDir, runDir);
    expect(state.phaseCodexSessions['2']).toBeNull();
  });

  // §4.4 step 6 / §4.10 (P0 fix): if currentPhase changed during gate,
  // runGatePhase must not write sidecar files either — otherwise the jump
  // invalidation's replay-sidecar deletion is re-armed by the stale gate.
  it('does not write gate-N-raw/result.json sidecars when currentPhase changed mid-gate', async () => {
    const state = makeState();
    state.phaseAttemptId['2'] = 'attempt-redirect-2';
    vi.mocked(waitForPhaseCompletion).mockImplementationOnce(async () => {
      state.currentPhase = 3;
      return { status: 'completed' };
    });
    vi.mocked(spawnCodexInPane).mockResolvedValueOnce({ pid: null });
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
      sourcePreset: { model: 'gpt-5.5', effort: 'high' },
    });
    const flag = { value: true };
    const res = await runGatePhase(2, state, runDir, runDir, runDir, flag);
    // spawnCodexInPane は呼ばれないはず (replay hit)
    expect(vi.mocked(spawnCodexInPane).mock.calls.length).toBe(0);
    expect(res.type).toBe('verdict');
    expect((res as any).recoveredFromSidecar).toBe(true);
    // Hydration 確認
    expect(state.phaseCodexSessions['2']).toEqual({
      sessionId: 'side-aa', runner: 'codex', model: 'gpt-5.5', effort: 'high', lastOutcome: 'reject',
    });
  });

  it('(2) mismatched sourcePreset: replay skipped, live path taken', async () => {
    const state = makeState();
    state.phaseAttemptId['2'] = 'attempt-mismatch-1';
    writeSidecar(2, {
      verdict: 'APPROVE',
      runner: 'codex',
      codexSessionId: 'mismatch-aa',
      sourcePreset: { model: 'some-other-model', effort: 'high' },
    });
    vi.mocked(spawnCodexInPane).mockImplementationOnce(async () => {
      writeVerdictFile(runDir, 2, 'REJECT', '');
      return { pid: null };
    });
    vi.mocked(readCodexSessionUsage).mockResolvedValueOnce({
      sessionId: 'live-aa',
      tokens: { input: 1, output: 1, cacheRead: 0, cacheCreate: 0, total: 2 },
    });
    const flag = { value: true };
    await runGatePhase(2, state, runDir, runDir, runDir, flag);
    // Live path taken
    expect(vi.mocked(spawnCodexInPane).mock.calls.length).toBe(1);
    expect(state.phaseCodexSessions['2']?.sessionId).toBe('live-aa');
  });

  it('(3) legacy sidecar (no runner/sourcePreset metadata): replay skipped', async () => {
    const state = makeState();
    state.phaseAttemptId['2'] = 'attempt-legacy-1';
    fs.writeFileSync(path.join(runDir, 'gate-2-raw.txt'), 'session id: legacy\n## Verdict\nAPPROVE\n');
    fs.writeFileSync(
      path.join(runDir, 'gate-2-result.json'),
      JSON.stringify({ exitCode: 0, timestamp: Date.now() }),
    );
    vi.mocked(spawnCodexInPane).mockImplementationOnce(async () => {
      writeVerdictFile(runDir, 2, 'REJECT', '');
      return { pid: null };
    });
    vi.mocked(readCodexSessionUsage).mockResolvedValueOnce({
      sessionId: 'live-aa',
      tokens: { input: 1, output: 1, cacheRead: 0, cacheCreate: 0, total: 2 },
    });
    const flag = { value: true };
    await runGatePhase(2, state, runDir, runDir, runDir, flag);
    // replay skip → live spawn
    expect(vi.mocked(spawnCodexInPane).mock.calls.length).toBe(1);
    expect(state.phaseCodexSessions['2']?.sessionId).toBe('live-aa');
  });

  it('(4) Claude sidecar with matching runner: replay accepted, no codex hydration', async () => {
    const state = makeState();
    // Claude runner
    state.phasePresets['2'] = 'sonnet-high';
    writeSidecar(2, { verdict: 'APPROVE', runner: 'claude' });
    const flag = { value: true };
    const res = await runGatePhase(2, state, runDir, runDir, runDir, flag);
    // Neither runner should be called (replay hit)
    expect(vi.mocked(spawnCodexInPane).mock.calls.length).toBe(0);
    expect(vi.mocked(runClaudeGate).mock.calls.length).toBe(0);
    expect(res.type).toBe('verdict');
    expect((res as any).recoveredFromSidecar).toBe(true);
    // Claude replay は phaseCodexSessions hydrate 対象外
    expect(state.phaseCodexSessions['2']).toBeNull();
  });
});
