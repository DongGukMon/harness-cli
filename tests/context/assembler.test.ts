import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { assembleInteractivePrompt, assembleGatePrompt } from '../../src/context/assembler.js';
import { createInitialState } from '../../src/state.js';
import type { HarnessState } from '../../src/types.js';

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
});

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assembler-test-'));
  tmpDirs.push(dir);
  return dir;
}

function makeState(overrides: Partial<HarnessState> = {}): HarnessState {
  const base = createInitialState(
    'my-run',
    '/tasks/my-task.md',
    'deadbeef',
    false
  );
  return { ...base, ...overrides };
}

function writeEvalFixtures(dir: string): void {
  fs.mkdirSync(path.join(dir, 'docs/specs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs/plans'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs/process/evals'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/specs/my-run-design.md'), '# spec');
  fs.writeFileSync(path.join(dir, 'docs/plans/my-run.md'), '# plan');
  fs.writeFileSync(path.join(dir, 'docs/process/evals/my-run-eval.md'), '# eval');
}

function makeLightEvalState(overrides: Partial<HarnessState> = {}): HarnessState {
  const base = createInitialState('my-run', '/tasks/my-task.md', 'base-sha', false, false, 'light');
  return {
    ...base,
    currentPhase: 7,
    phases: { '1': 'completed', '2': 'skipped', '3': 'skipped', '4': 'skipped',
              '5': 'completed', '6': 'completed', '7': 'pending' },
    implCommit: 'impl-sha',
    evalCommit: 'eval-sha',
    ...overrides,
  };
}

function makeFullEvalState(overrides: Partial<HarnessState> = {}): HarnessState {
  const base = createInitialState('my-run', '/tasks/my-task.md', 'base-sha', false);
  return {
    ...base,
    currentPhase: 7,
    phases: { '1': 'completed', '2': 'completed', '3': 'completed', '4': 'completed',
              '5': 'completed', '6': 'completed', '7': 'pending' },
    implCommit: 'impl-sha',
    evalCommit: 'eval-sha',
    ...overrides,
  };
}

// ─── Interactive Phase Tests ───────────────────────────────────────────────

describe('Phase 1 interactive prompt', () => {
  it('includes task.md path from runId dir and phaseAttemptId sentinel instruction', () => {
    const state = makeState({
      phaseAttemptId: { '1': 'uuid-phase-1-attempt', '3': null, '5': null },
    });
    const prompt = assembleInteractivePrompt(1, state, '/tmp/harness');

    // Phase 1 injects .harness/<runId>/task.md, not the raw task string
    expect(prompt).toContain('.harness/my-run/task.md');
    expect(prompt).toContain('uuid-phase-1-attempt');
    expect(prompt).toContain('phase-1.done');
  });

  it('includes feedback path when pendingAction has feedbackPaths', () => {
    const state = makeState({
      pendingAction: {
        type: 'reopen_phase',
        targetPhase: 1,
        sourcePhase: 2,
        feedbackPaths: ['/tmp/feedback-gate2.md'],
      },
      phaseAttemptId: { '1': 'attempt-abc', '3': null, '5': null },
    });
    const prompt = assembleInteractivePrompt(1, state, '/tmp/harness');

    expect(prompt).toContain('/tmp/feedback-gate2.md');
  });

  it('does not include feedback block when pendingAction is null', () => {
    const state = makeState({
      pendingAction: null,
      phaseAttemptId: { '1': 'attempt-xyz', '3': null, '5': null },
    });
    const prompt = assembleInteractivePrompt(1, state, '/tmp/harness');

    // feedback_path block should be stripped out
    expect(prompt).not.toContain('이전 리뷰 피드백');
  });

  it('instructs writing "## Context & Decisions" section', () => {
    const state = makeState({
      phaseAttemptId: { '1': 'attempt-001', '3': null, '5': null },
    });
    const prompt = assembleInteractivePrompt(1, state, '/tmp/harness');

    expect(prompt).toContain('## Context & Decisions');
  });
});

describe('Phase 3 interactive prompt', () => {
  it('includes spec, decisions, and checklist schema', () => {
    const state = makeState({
      phaseAttemptId: { '1': null, '3': 'attempt-phase3', '5': null },
    });
    const prompt = assembleInteractivePrompt(3, state, '/tmp/harness');

    expect(prompt).toContain(state.artifacts.spec);
    expect(prompt).toContain(state.artifacts.decisionLog);
    expect(prompt).toContain(state.artifacts.checklist);
    // checklist schema reference (per spec: "checks" array with name/command)
    expect(prompt).toContain('checks');
    expect(prompt).toContain('name');
    expect(prompt).toContain('command');
    expect(prompt).toContain('phase-3.done');
    expect(prompt).toContain('attempt-phase3');
  });
});

describe('Phase 5 interactive prompt', () => {
  it('includes commit instruction', () => {
    const state = makeState({
      phaseAttemptId: { '1': null, '3': null, '5': 'attempt-phase5' },
    });
    const prompt = assembleInteractivePrompt(5, state, '/tmp/harness');

    expect(prompt).toContain('git commit');
    expect(prompt).toContain('phase-5.done');
    expect(prompt).toContain('attempt-phase5');
  });
});

describe('Phase 1/3/5 HARNESS FLOW CONSTRAINT stanza', () => {
  it.each([1, 3, 5] as const)('Phase %i prompt forbids advisor() and explains the gate reviewer', (phase) => {
    const state = makeState({
      phaseAttemptId: { '1': 'aid', '3': 'aid', '5': 'aid' },
    });
    const prompt = assembleInteractivePrompt(phase, state, '/tmp/harness');
    expect(prompt).toContain('HARNESS FLOW CONSTRAINT');
    expect(prompt).toContain('advisor()');
    expect(prompt).toContain('독립 reviewer');
  });
});

// ─── Gate Prompt Tests ────────────────────────────────────────────────────

describe('Gate 2 prompt', () => {
  it('includes spec content and reviewer contract', () => {
    const cwd = makeTmpDir();
    const state = makeState();

    // Write a dummy spec file
    const specAbsPath = path.join(cwd, state.artifacts.spec);
    fs.mkdirSync(path.dirname(specAbsPath), { recursive: true });
    fs.writeFileSync(specAbsPath, '# My Spec\n\nSome spec content here.');

    const result = assembleGatePrompt(2, state, '/tmp/harness', cwd);

    expect(typeof result).toBe('string');
    const prompt = result as string;
    expect(prompt).toContain('My Spec');
    expect(prompt).toContain('Some spec content here.');
    expect(prompt).toContain('APPROVE');
    expect(prompt).toContain('REJECT');
  });

  it('includes full reviewer contract with location-citation rule', () => {
    const cwd = makeTmpDir();
    const state = makeState();

    const specAbsPath = path.join(cwd, state.artifacts.spec);
    fs.mkdirSync(path.dirname(specAbsPath), { recursive: true });
    fs.writeFileSync(specAbsPath, '# Spec');

    const result = assembleGatePrompt(2, state, '/tmp/harness', cwd);

    expect(typeof result).toBe('string');
    const prompt = result as string;
    expect(prompt).toContain('Every comment must cite a specific location');
    expect(prompt).toContain('Scope tagging (REJECT only)');
    expect(prompt).toContain('Scope: design | impl | mixed');
  });

  it('includes scope rules that forbid external conventions and not-yet-produced artifacts', () => {
    const cwd = makeTmpDir();
    const state = makeState();

    const specAbsPath = path.join(cwd, state.artifacts.spec);
    fs.mkdirSync(path.dirname(specAbsPath), { recursive: true });
    fs.writeFileSync(specAbsPath, '# Spec');

    const result = assembleGatePrompt(2, state, '/tmp/harness', cwd);
    expect(typeof result).toBe('string');
    const prompt = result as string;
    expect(prompt).toContain('Scope rules:');
    expect(prompt).toContain('personal or workspace-level conventions');
    expect(prompt).toContain('later harness phases produce plan/impl/eval artifacts');
  });
});

describe('Gate 2/4/7 lifecycle stanza', () => {
  function writeSpecPlanEval(cwd: string, state: HarnessState, { plan = false, evalReport = false } = {}): void {
    const specAbsPath = path.join(cwd, state.artifacts.spec);
    fs.mkdirSync(path.dirname(specAbsPath), { recursive: true });
    fs.writeFileSync(specAbsPath, '# Spec');
    if (plan) {
      const planAbsPath = path.join(cwd, state.artifacts.plan);
      fs.mkdirSync(path.dirname(planAbsPath), { recursive: true });
      fs.writeFileSync(planAbsPath, '# Plan');
    }
    if (evalReport) {
      const evalAbsPath = path.join(cwd, state.artifacts.evalReport);
      fs.mkdirSync(path.dirname(evalAbsPath), { recursive: true });
      fs.writeFileSync(evalAbsPath, '# Eval');
    }
  }

  it('Gate 2 prompt includes phase-2 lifecycle stanza (plan/impl/eval not yet produced)', () => {
    const cwd = makeTmpDir();
    const state = makeState();
    writeSpecPlanEval(cwd, state);
    const result = assembleGatePrompt(2, state, '/tmp/harness', cwd);
    if (typeof result !== 'string') throw new Error('expected string');
    expect(result).toContain('<harness_lifecycle>');
    expect(result).toContain('Gate 2');
    expect(result).toContain('have not yet been produced');
  });

  it('Gate 4 prompt includes phase-4 lifecycle stanza (impl not yet produced)', () => {
    const cwd = makeTmpDir();
    const state = makeState();
    writeSpecPlanEval(cwd, state, { plan: true });
    const result = assembleGatePrompt(4, state, '/tmp/harness', cwd);
    if (typeof result !== 'string') throw new Error('expected string');
    expect(result).toContain('<harness_lifecycle>');
    expect(result).toContain('Gate 4');
    expect(result).toContain('implementation (Phase 5) has not yet been produced');
  });

  it('Gate 7 prompt includes terminal lifecycle stanza without "not yet produced" wording', () => {
    const cwd = makeTmpDir();
    const state = makeState();
    writeSpecPlanEval(cwd, state, { plan: true, evalReport: true });
    const result = assembleGatePrompt(7, state, '/tmp/harness', cwd);
    if (typeof result !== 'string') throw new Error('expected string');
    expect(result).toContain('<harness_lifecycle>');
    expect(result).toContain('Gate 7');
    expect(result).toContain('terminal review');
    expect(result).not.toContain('has not yet been produced');
  });
});

describe('Gate size limits', () => {
  it('returns error object when file exceeds 200KB limit', () => {
    const cwd = makeTmpDir();
    const state = makeState();

    // Write a file larger than 200KB
    const specAbsPath = path.join(cwd, state.artifacts.spec);
    fs.mkdirSync(path.dirname(specAbsPath), { recursive: true });
    // 201 * 1024 = 205824 bytes > 200KB
    const bigContent = 'x'.repeat(201 * 1024);
    fs.writeFileSync(specAbsPath, bigContent);

    const result = assembleGatePrompt(2, state, '/tmp/harness', cwd);

    expect(typeof result).toBe('object');
    expect((result as { error: string }).error).toMatch(/Gate input too large/);
  });
});

describe('assembleInteractivePrompt — flow-aware Phase 1 (light)', () => {
  it('light + phase 1 renders phase-1-light.md with combined-doc wording', () => {
    const state = makeState({ flow: 'light', phaseAttemptId: { '1': 'aid-light', '3': null, '5': null } });
    const prompt = assembleInteractivePrompt(1, state, '/tmp/harness');
    expect(prompt).toContain('## Implementation Plan');
    expect(prompt).toContain('checklist.json');
    expect(prompt).toContain('결합');
    expect(prompt).toContain('aid-light');
  });

  it('full + phase 1 still renders the classic phase-1.md', () => {
    const state = makeState({ flow: 'full', phaseAttemptId: { '1': 'aid-full', '3': null, '5': null } });
    const prompt = assembleInteractivePrompt(1, state, '/tmp/harness');
    expect(prompt).not.toContain('## Implementation Plan');
    expect(prompt).toContain('## Context & Decisions');
  });

  it('light + phase 5 injects carryoverFeedback paths alongside pendingAction feedback', () => {
    const tmp = makeTmpDir();
    const pendingPath = path.join(tmp, 'verify-feedback.md');
    const carryoverPath = path.join(tmp, 'gate-7-feedback.md');
    fs.writeFileSync(pendingPath, 'verify feedback');
    fs.writeFileSync(carryoverPath, 'gate feedback');
    const state = makeState({
      flow: 'light',
      phaseAttemptId: { '1': null, '3': null, '5': 'aid-5' },
      pendingAction: {
        type: 'reopen_phase', targetPhase: 5, sourcePhase: 6,
        feedbackPaths: [pendingPath],
      },
      carryoverFeedback: {
        sourceGate: 7,
        paths: [carryoverPath],
        deliverToPhase: 5,
      },
    });
    const prompt = assembleInteractivePrompt(5, state, '/tmp/harness');
    expect(prompt).toContain('verify-feedback.md');
    expect(prompt).toContain('gate-7-feedback.md');
  });

  it('light + phase 5 uses phase-5-light.md (no separate plan artifact)', () => {
    const state = makeState({ flow: 'light', phaseAttemptId: { '1': null, '3': null, '5': 'aid-5' } });
    const prompt = assembleInteractivePrompt(5, state, '/tmp/harness');
    expect(prompt).toContain('Combined Design Spec (light)');
    expect(prompt).not.toContain('- Plan:');
  });

  it('light + phase 5 drops carryover paths that no longer exist on disk (R8)', () => {
    const tmp = makeTmpDir();
    const existing = path.join(tmp, 'exists.md');
    fs.writeFileSync(existing, 'x');
    const state = makeState({
      flow: 'light',
      phaseAttemptId: { '1': null, '3': null, '5': 'aid-5' },
      pendingAction: null,
      carryoverFeedback: {
        sourceGate: 7,
        paths: [existing, path.join(tmp, 'missing.md')],
        deliverToPhase: 5,
      },
    });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const prompt = assembleInteractivePrompt(5, state, tmp);
      expect(prompt).toContain('exists.md');
      expect(prompt).not.toContain('missing.md');
      const warnings = stderrSpy.mock.calls.map((c) => c[0]).join('');
      expect(warnings).toMatch(/carryover feedback path not found.*missing\.md/);
    } finally {
      stderrSpy.mockRestore();
    }
  });
});

describe('buildGatePromptPhase7 — flow-aware (ADR-12)', () => {
  it('light flow omits the <plan> slot entirely', () => {
    const tmp = makeTmpDir();
    writeEvalFixtures(tmp);
    const state = makeLightEvalState();
    const result = assembleGatePrompt(7, state, '/tmp/harness', tmp);
    if (typeof result !== 'string') throw new Error('expected string');
    expect(result).toContain('<spec>\n');
    expect(result).toContain('<eval_report>\n');
    expect(result).not.toContain('<plan>\n');
  });

  it('full flow still includes the <plan> slot', () => {
    const tmp = makeTmpDir();
    writeEvalFixtures(tmp);
    const state = makeFullEvalState();
    const result = assembleGatePrompt(7, state, '/tmp/harness', tmp);
    if (typeof result !== 'string') throw new Error('expected string');
    expect(result).toContain('<plan>\n');
  });

  it('light Gate 7 (fresh) contract text does not claim a separate plan artifact', () => {
    const tmp = makeTmpDir();
    writeEvalFixtures(tmp);
    const state = makeLightEvalState();
    const result = assembleGatePrompt(7, state, '/tmp/harness', tmp);
    if (typeof result !== 'string') throw new Error('expected string');
    expect(result).toContain('결합 design spec');
    expect(result).toContain('별도의 plan 아티팩트가 없다');
    expect(result).not.toContain('spec + plan + eval report + diff');
    expect(result).toContain('4-phase light harness lifecycle');
  });

  it('full Gate 7 (fresh) contract text is unchanged', () => {
    const tmp = makeTmpDir();
    writeEvalFixtures(tmp);
    const state = makeFullEvalState();
    const result = assembleGatePrompt(7, state, '/tmp/harness', tmp);
    if (typeof result !== 'string') throw new Error('expected string');
    expect(result).toContain('spec + plan + eval report + diff');
    expect(result).toContain('7-phase harness lifecycle');
  });
});
