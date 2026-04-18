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
    sourcePreset: { model: 'gpt-5.4', effort: 'high' },
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
      model: 'gpt-5.4',
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
