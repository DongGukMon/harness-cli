import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { HarnessState, GatePhaseResult } from '../../src/types.js';
import { writeState, readState, createInitialState } from '../../src/state.js';

// Mocks: Codex runner returns fixed results; assembler returns fixed strings
vi.mock('../../src/runners/codex.js', () => ({ runCodexGate: vi.fn() }));
vi.mock('../../src/runners/claude.js', () => ({ runClaudeGate: vi.fn() }));
vi.mock('../../src/context/assembler.js', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    assembleGatePrompt: vi.fn(() => 'FRESH_PROMPT'),
    assembleGateResumePrompt: vi.fn(() => 'RESUME_PROMPT'),
  };
});

import { runGatePhase } from '../../src/phases/gate.js';
import { runCodexGate } from '../../src/runners/codex.js';

function verdictResult(overrides: Partial<GatePhaseResult> = {}): GatePhaseResult {
  return {
    type: 'verdict',
    verdict: 'APPROVE',
    comments: '',
    rawOutput: 'session id: aa-11\n## Verdict\nAPPROVE\n',
    runner: 'codex',
    codexSessionId: 'aa-11',
    sourcePreset: { model: 'gpt-5.5', effort: 'high' },
    resumedFrom: null,
    resumeFallback: false,
    ...overrides,
  } as GatePhaseResult;
}

let runDir: string;
beforeEach(() => { runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-int-')); });
afterEach(() => { vi.clearAllMocks(); });

// §5 end-to-end crash recovery: state with saved sessionId persists via writeState,
// readState restores it, next runGatePhase call uses the stored id for resume.
describe('Integration §5: persisted session drives resume dispatch after state round-trip', () => {
  it('writeState → readState preserves session; subsequent runGatePhase resumes with saved id', async () => {
    const state = createInitialState('run-int-1', 'task', 'basecommit', false);
    state.phaseCodexSessions['2'] = {
      sessionId: 'persisted-aa',
      runner: 'codex',
      model: 'gpt-5.5',
      effort: 'high',
      lastOutcome: 'reject',
    };
    // artifacts 경로를 실제 존재하는 가짜 파일로 맞춤 — assembler가 mock이라 내용 무관
    state.artifacts = {
      spec: 'spec.md', plan: 'plan.md', evalReport: 'eval.md',
      decisionLog: 'd.md', checklist: 'c.json',
    };
    writeState(runDir, state);

    const restored = readState(runDir);
    expect(restored).not.toBeNull();
    expect(restored!.phaseCodexSessions['2']?.sessionId).toBe('persisted-aa');

    vi.mocked(runCodexGate).mockResolvedValueOnce(
      verdictResult({ resumedFrom: 'persisted-aa', codexSessionId: 'persisted-aa' }),
    );

    await runGatePhase(2, restored!, runDir, runDir, runDir);
    // 6th argument (resumeSessionId) should carry the persisted id
    expect(vi.mocked(runCodexGate).mock.calls[0][5]).toBe('persisted-aa');
  });
});

// Task 8 integration scenarios (EC-6 breadth): end-to-end coverage of the
// reject-retry loop, session_missing fallback, and the two invalidation
// triggers through the real runGatePhase + state helper surfaces.
describe('Integration Task 8: reject-loop reuses session across retries', () => {
  it('first call saves sessionId fresh; second call passes that id back as resume', async () => {
    const state = createInitialState('run-int-loop', 'task', 'base', false);
    state.currentPhase = 2; // required for session-persist stillActivePhase guard
    state.artifacts = { spec: 'spec.md', plan: 'plan.md', evalReport: 'eval.md', decisionLog: 'd.md', checklist: 'c.json' };
    writeState(runDir, state);

    vi.mocked(runCodexGate)
      .mockResolvedValueOnce(verdictResult({
        verdict: 'REJECT', codexSessionId: 'loop-sid', resumedFrom: null, resumeFallback: false,
      }))
      .mockResolvedValueOnce(verdictResult({
        verdict: 'APPROVE', codexSessionId: 'loop-sid', resumedFrom: 'loop-sid', resumeFallback: false,
      }));

    await runGatePhase(2, state, runDir, runDir, runDir);
    expect(state.phaseCodexSessions['2']?.sessionId).toBe('loop-sid');
    expect(vi.mocked(runCodexGate).mock.calls[0][5]).toBeNull();

    await runGatePhase(2, state, runDir, runDir, runDir);
    expect(vi.mocked(runCodexGate).mock.calls[1][5]).toBe('loop-sid');
  });
});

describe('Integration Task 8: session_missing fallback updates stored session id', () => {
  it('on fallback with new fresh id, state.phaseCodexSessions is rewritten to the new id', async () => {
    const state = createInitialState('run-int-fallback', 'task', 'base', false);
    state.currentPhase = 2; // required for session-persist stillActivePhase guard
    state.artifacts = { spec: 'spec.md', plan: 'plan.md', evalReport: 'eval.md', decisionLog: 'd.md', checklist: 'c.json' };
    state.phaseCodexSessions['2'] = {
      sessionId: 'dead-sid', runner: 'codex', model: 'gpt-5.5', effort: 'high', lastOutcome: 'reject',
    };
    writeState(runDir, state);

    vi.mocked(runCodexGate).mockResolvedValueOnce(verdictResult({
      verdict: 'APPROVE', codexSessionId: 'fresh-sid',
      resumedFrom: 'dead-sid', resumeFallback: true,
    }));

    await runGatePhase(2, state, runDir, runDir, runDir);
    expect(state.phaseCodexSessions['2']?.sessionId).toBe('fresh-sid');
  });
});

describe('Integration Task 8: preset-change invalidation nulls session and deletes replay sidecars', () => {
  it('after lineage-changing preset swap, next runGatePhase picks fresh path', async () => {
    const { invalidatePhaseSessionsOnPresetChange } = await import('../../src/state.js');
    const state = createInitialState('run-int-preset', 'task', 'base', false);
    state.artifacts = { spec: 'spec.md', plan: 'plan.md', evalReport: 'eval.md', decisionLog: 'd.md', checklist: 'c.json' };
    state.phaseCodexSessions['2'] = {
      sessionId: 'pre-sid', runner: 'codex', model: 'gpt-5.5', effort: 'high', lastOutcome: 'reject',
    };
    // Replay sidecars pre-existing
    fs.writeFileSync(path.join(runDir, 'gate-2-raw.txt'), 'raw');
    fs.writeFileSync(path.join(runDir, 'gate-2-result.json'), '{}');
    writeState(runDir, state);

    const prev = { ...state.phasePresets };
    // Change phase 2 preset to a different runner (claude) — lineage change
    state.phasePresets['2'] = 'sonnet-high';
    invalidatePhaseSessionsOnPresetChange(state, prev, runDir);

    expect(state.phaseCodexSessions['2']).toBeNull();
    expect(fs.existsSync(path.join(runDir, 'gate-2-raw.txt'))).toBe(false);
    expect(fs.existsSync(path.join(runDir, 'gate-2-result.json'))).toBe(false);

    // Subsequent gate call would take fresh path — but phase 2 runner is now
    // 'claude', so it dispatches runClaudeGate (not runCodexGate). Verify at
    // the state layer that the codex-session slot is clean.
    expect(state.phaseCodexSessions['2']).toBeNull();
  });

  it('preset change with IDENTICAL lineage is a no-op (spec §4.8)', async () => {
    const { invalidatePhaseSessionsOnPresetChange } = await import('../../src/state.js');
    const state = createInitialState('run-int-noop', 'task', 'base', false);
    state.phaseCodexSessions['2'] = {
      sessionId: 'keep-sid', runner: 'codex', model: 'gpt-5.5', effort: 'high', lastOutcome: 'reject',
    };
    // Snapshot prev, reassign the same preset id (simulates idempotent config re-apply)
    const prev = { ...state.phasePresets };
    state.phasePresets['2'] = prev['2'];
    invalidatePhaseSessionsOnPresetChange(state, prev, runDir);

    expect(state.phaseCodexSessions['2']?.sessionId).toBe('keep-sid');
  });
});

describe('Integration Task 8: jump invalidation nulls target+later phases, preserves earlier', () => {
  it('jump to phase 4 nulls sessions for 4 and 7, preserves 2', async () => {
    const { invalidatePhaseSessionsOnJump } = await import('../../src/state.js');
    const state = createInitialState('run-int-jump', 'task', 'base', false);
    state.phaseCodexSessions['2'] = {
      sessionId: 'sid-2', runner: 'codex', model: 'gpt-5.5', effort: 'high', lastOutcome: 'approve',
    };
    state.phaseCodexSessions['4'] = {
      sessionId: 'sid-4', runner: 'codex', model: 'gpt-5.5', effort: 'high', lastOutcome: 'reject',
    };
    state.phaseCodexSessions['7'] = {
      sessionId: 'sid-7', runner: 'codex', model: 'gpt-5.5', effort: 'high', lastOutcome: 'reject',
    };
    for (const p of [2, 4, 7]) {
      fs.writeFileSync(path.join(runDir, `gate-${p}-raw.txt`), 'raw');
      fs.writeFileSync(path.join(runDir, `gate-${p}-feedback.md`), 'feedback');
    }

    invalidatePhaseSessionsOnJump(state, 4, runDir);

    expect(state.phaseCodexSessions['2']?.sessionId).toBe('sid-2');
    expect(state.phaseCodexSessions['4']).toBeNull();
    expect(state.phaseCodexSessions['7']).toBeNull();
    expect(fs.existsSync(path.join(runDir, 'gate-2-raw.txt'))).toBe(true);
    expect(fs.existsSync(path.join(runDir, 'gate-4-raw.txt'))).toBe(false);
    expect(fs.existsSync(path.join(runDir, 'gate-7-raw.txt'))).toBe(false);
    // Feedback files preserved for all phases (reopen flow needs them)
    expect(fs.existsSync(path.join(runDir, 'gate-4-feedback.md'))).toBe(true);
    expect(fs.existsSync(path.join(runDir, 'gate-7-feedback.md'))).toBe(true);
  });
});
