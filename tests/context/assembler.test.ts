import { describe, it, expect, afterEach } from 'vitest';
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
