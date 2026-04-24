import { describe, it, expect } from 'vitest';
import { assembleGateResumePrompt } from '../../src/context/assembler.js';
import type { HarnessState } from '../../src/types.js';

function makeState(overrides: Partial<HarnessState> = {}): HarnessState {
  // Note: cwd in tests = 'tests/context/fixtures'; artifact paths must be bare filenames
  // so `path.join(cwd, filePath)` resolves into the fixtures directory.
  return {
    runId: 'r1',
    flow: 'full',
    carryoverFeedback: null,
    currentPhase: 2,
    status: 'in_progress',
    autoMode: false,
    task: 't',
    baseCommit: 'abc',
    implRetryBase: 'abc',
    codexPath: null,
    externalCommitsDetected: false,
    artifacts: {
      spec: 'spec.md',
      plan: 'plan.md',
      evalReport: 'eval.md',
      decisionLog: '.harness/r1/decisions.md',
      checklist: '.harness/r1/checklist.json',
    },
    phases: { '1': 'pending', '2': 'pending', '3': 'pending', '4': 'pending', '5': 'pending', '6': 'pending', '7': 'pending' },
    gateRetries: { '2': 0, '4': 0, '7': 0 },
    verifyRetries: 0,
    pauseReason: null,
    specCommit: null,
    planCommit: null,
    implCommit: null,
    evalCommit: null,
    verifiedAtHead: null,
    pausedAtHead: null,
    pendingAction: null,
    phaseOpenedAt: { '1': null, '3': null, '5': null },
    phaseAttemptId: { '1': null, '3': null, '5': null, '2': 'test-attempt-2', '4': 'test-attempt-4', '7': 'test-attempt-7' },
    phasePresets: { '1': 'opus-xhigh', '2': 'codex-high', '3': 'sonnet-high', '4': 'codex-high', '5': 'sonnet-high', '7': 'codex-high' },
    phaseReopenFlags: { '1': false, '3': false, '5': false },
    phaseCodexSessions: { '2': null, '4': null, '7': null },
    lastWorkspacePid: null,
    lastWorkspacePidStartTime: null,
    tmuxSession: '',
    tmuxMode: 'dedicated',
    tmuxWindows: [],
    tmuxControlWindow: '',
    tmuxWorkspacePane: '',
    tmuxControlPane: '',
    loggingEnabled: false,
    phaseReopenSource: { '1': null, '3': null, '5': null },
    ...overrides,
  } as HarnessState;
}

describe('assembleGateResumePrompt — Variant A (reject + feedback)', () => {
  it('includes updated artifacts, previous feedback, and actually loads fixture content', () => {
    const cwd = 'tests/context/fixtures';
    const state = makeState();
    const res = assembleGateResumePrompt(2, state, cwd, 'reject', 'P1: fix X\nP1: fix Y', '/tmp/harness/r1');
    expect(typeof res).toBe('string');
    if (typeof res === 'string') {
      expect(res).toMatch(/Updated Artifacts \(Re-Review Requested\)/);
      expect(res).toMatch(/Your Previous Feedback/);
      expect(res).toMatch(/P1: fix X/);
      // fixture 실제 로딩 확인 — "# Spec\ncontent" 가 프롬프트에 나타나야 함
      expect(res).toMatch(/# Spec[\s\S]*content/);
      expect(res).not.toMatch(/file not found/i);
      // REVIEWER_CONTRACT 전문 미포함 (이미 세션에 있음)
      expect(res).not.toMatch(/You are an independent technical reviewer/);
    }
  });
});

describe('assembleGateResumePrompt — Variant B (error/approve or empty feedback)', () => {
  it('omits previous feedback block for error outcome', () => {
    const cwd = 'tests/context/fixtures';
    const state = makeState();
    const res = assembleGateResumePrompt(2, state, cwd, 'error', '', '/tmp/harness/r1');
    expect(typeof res).toBe('string');
    if (typeof res === 'string') {
      expect(res).toMatch(/Continue Review/);
      expect(res).not.toMatch(/Your Previous Feedback/);
      expect(res).not.toMatch(/You are an independent technical reviewer/);
    }
  });

  it('treats approve as Variant B for safety', () => {
    const cwd = 'tests/context/fixtures';
    const state = makeState();
    const res = assembleGateResumePrompt(4, state, cwd, 'approve', '', '/tmp/harness/r1');
    expect(typeof res).toBe('string');
    if (typeof res === 'string') {
      expect(res).toMatch(/Continue Review/);
      expect(res).not.toMatch(/Your Previous Feedback/);
    }
  });

  it('Phase 4 resume includes spec + plan sections', () => {
    const cwd = 'tests/context/fixtures';
    const state = makeState();
    const res = assembleGateResumePrompt(4, state, cwd, 'reject', 'feedback', '/tmp/harness/r1');
    if (typeof res === 'string') {
      expect(res).toMatch(/<spec>/);
      expect(res).toMatch(/<plan>/);
      expect(res).not.toMatch(/<eval_report>/);
    }
  });

  it('Phase 2 resume only includes spec (no plan/eval)', () => {
    const cwd = 'tests/context/fixtures';
    const state = makeState();
    const res = assembleGateResumePrompt(2, state, cwd, 'reject', 'feedback', '/tmp/harness/r1');
    if (typeof res === 'string') {
      expect(res).toMatch(/<spec>/);
      expect(res).not.toMatch(/<plan>/);
      expect(res).not.toMatch(/<eval_report>/);
    }
  });

  it('§4.3 Phase 7 resume includes eval_report + <metadata> block', () => {
    const cwd = 'tests/context/fixtures';
    const state = makeState();
    const res = assembleGateResumePrompt(7, state, cwd, 'reject', 'feedback', '/tmp/harness/r1');
    if (typeof res === 'string') {
      expect(res).toMatch(/<spec>/);
      expect(res).toMatch(/<plan>/);
      expect(res).toMatch(/<eval_report>/);
      expect(res).toMatch(/<metadata>/);
      // metadata includes the "Verified at HEAD" breadcrumb from fresh Phase 7 parity
      expect(res).toMatch(/Verified at HEAD:/);
    }
  });
});

describe('assembleGateResumePrompt — §4.4 anomaly: reject + missing feedback', () => {
  it('selects Variant A even when previousFeedback is empty, with placeholder text', () => {
    const cwd = 'tests/context/fixtures';
    const state = makeState();
    // lastOutcome=reject but empty feedback — spec §4.4 requires Variant A, not Variant B
    const res = assembleGateResumePrompt(2, state, cwd, 'reject', '', '/tmp/harness/r1');
    if (typeof res === 'string') {
      expect(res).toMatch(/Updated Artifacts \(Re-Review Requested\)/);
      expect(res).not.toMatch(/Continue Review/);
      expect(res).toMatch(/feedback file missing despite lastOutcome=reject/);
    }
  });
});

describe('buildResumeSections — Phase 7 flow-aware (ADR-12)', () => {
  const cwd = 'tests/context/fixtures';

  it('light + phase 7 resume omits <plan> but keeps <eval_report> + diff + metadata', () => {
    const state = makeState({ flow: 'light', currentPhase: 7 });
    const prompt = assembleGateResumePrompt(7, state, cwd, 'reject', 'prior feedback', '/tmp/harness/r1');
    if (typeof prompt !== 'string') throw new Error('expected string');
    expect(prompt).toContain('<spec>\n');
    expect(prompt).toContain('<eval_report>\n');
    expect(prompt).toContain('<metadata>\n');
    expect(prompt).not.toContain('<plan>\n');
  });

  it('full + phase 7 resume still includes <plan>', () => {
    const state = makeState({ currentPhase: 7 });
    const prompt = assembleGateResumePrompt(7, state, cwd, 'reject', 'prior feedback', '/tmp/harness/r1');
    if (typeof prompt !== 'string') throw new Error('expected string');
    expect(prompt).toContain('<plan>\n');
  });
});


describe('assembleGateResumePrompt — escalation reset notice', () => {
  it('subordinates prior feedback after an escalation Continue cycle', () => {
    const cwd = 'tests/context/fixtures';
    const state = makeState({ gateEscalationCycles: { '4': 1 } });
    const res = assembleGateResumePrompt(4, state, cwd, 'reject', 'P1: old concern', '/tmp/harness/r1');

    expect(typeof res).toBe('string');
    if (typeof res === 'string') {
      expect(res).toContain('Escalation cycle 1');
      expect(res).toContain('reference only, not an anchor');
      expect(res).toContain('Re-read the current artifacts from scratch');
      expect(res).toContain('P1: old concern');
    }
  });
});
