import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  assembleInteractivePrompt,
  assembleGatePrompt,
  parseComplexitySignal,
  buildComplexityDirective,
  __resetComplexityWarning,
} from '../../src/context/assembler.js';
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

  it('mandates standard gitignore scaffolding (Slice 3 step 0)', () => {
    const state = makeState({
      phaseAttemptId: { '1': null, '3': null, '5': 'aid' },
    });
    const prompt = assembleInteractivePrompt(5, state, '/tmp/harness');
    // Step 0 language + the canonical commit name used in the dogfood contract
    expect(prompt).toContain('chore: add standard gitignore entries');
    expect(prompt).toContain('git status --porcelain');
    expect(prompt).toMatch(/__pycache__\//);
  });

  it('generalizes the reopen invariant (rev-invariant artifacts OK)', () => {
    const state = makeState({
      phaseAttemptId: { '1': null, '3': null, '5': 'aid' },
    });
    const prompt = assembleInteractivePrompt(5, state, '/tmp/harness');
    expect(prompt).toMatch(/Reopen 시 artifact를 변경하지 않아도/);
    expect(prompt).toMatch(/sentinel attemptId/);
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

// ─── Complexity signal: Phase 3 assembler wiring ─────────────────────────────

describe('complexity signal — Phase 3 prompt injection', () => {
  afterEach(() => {
    __resetComplexityWarning();
  });

  function writeSpec(repoRoot: string, body: string): string {
    const relPath = 'docs/specs/fixture-complexity.md';
    const abs = path.join(repoRoot, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
    return relPath;
  }

  function makePhase3State(repoRoot: string, specBody: string): { state: HarnessState; harnessDir: string } {
    const specRel = writeSpec(repoRoot, specBody);
    const state = makeState({
      phaseAttemptId: { '1': null, '3': 'attempt-phase3-complex', '5': null },
      artifacts: {
        spec: specRel,
        decisionLog: '.harness/my-run/decisions.md',
        plan: 'docs/plans/fixture.md',
        checklist: '.harness/my-run/checklist.json',
        evalReport: 'docs/process/evals/fixture-eval.md',
      },
    });
    // harnessDir resolves spec via join(harnessDir, '..', relPath) → repoRoot
    const harnessDir = path.join(repoRoot, '.harness');
    return { state, harnessDir };
  }

  it('Small spec → Phase 3 prompt contains Small directive stanza', () => {
    const tmp = makeTmpDir();
    const { state, harnessDir } = makePhase3State(
      tmp,
      '# Fixture\n\n## Complexity\n\nSmall — ~100 LoC CLI\n\n## Rest\n',
    );
    const prompt = assembleInteractivePrompt(3, state, harnessDir);
    expect(prompt).toContain('<complexity_directive>');
    expect(prompt).toContain('classified **Small**');
    expect(prompt).toContain('at most 3 tasks');
  });

  it('Medium spec → Phase 3 prompt has NO directive stanza', () => {
    const tmp = makeTmpDir();
    const { state, harnessDir } = makePhase3State(
      tmp,
      '# Fixture\n\n## Complexity\n\nMedium\n',
    );
    const prompt = assembleInteractivePrompt(3, state, harnessDir);
    expect(prompt).not.toContain('<complexity_directive>');
    expect(prompt).not.toContain('classified **Small**');
    expect(prompt).not.toContain('classified **Large**');
  });

  it('Large spec → Phase 3 prompt contains Large directive stanza', () => {
    const tmp = makeTmpDir();
    const { state, harnessDir } = makePhase3State(
      tmp,
      '# Fixture\n\n## Complexity\n\nLarge — multi-file refactor\n',
    );
    const prompt = assembleInteractivePrompt(3, state, harnessDir);
    expect(prompt).toContain('<complexity_directive>');
    expect(prompt).toContain('classified **Large**');
    expect(prompt).toContain('vertical slices');
  });

  it('missing spec file → no directive stanza + single stderr warn', () => {
    const tmp = makeTmpDir();
    const state = makeState({
      phaseAttemptId: { '1': null, '3': 'attempt-phase3-complex', '5': null },
      artifacts: {
        spec: 'docs/specs/does-not-exist.md',
        decisionLog: '.harness/my-run/decisions.md',
        plan: 'docs/plans/fixture.md',
        checklist: '.harness/my-run/checklist.json',
        evalReport: 'docs/process/evals/fixture-eval.md',
      },
    });
    const harnessDir = path.join(tmp, '.harness');
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const prompt = assembleInteractivePrompt(3, state, harnessDir);
      expect(prompt).not.toContain('<complexity_directive>');
      const warnCalls = stderrSpy.mock.calls.filter(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('Complexity signal'),
      );
      expect(warnCalls.length).toBe(1);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('spec missing the Complexity section → directive empty + warn', () => {
    const tmp = makeTmpDir();
    const { state, harnessDir } = makePhase3State(
      tmp,
      '# Fixture\n\nNo complexity header anywhere.\n',
    );
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const prompt = assembleInteractivePrompt(3, state, harnessDir);
      expect(prompt).not.toContain('<complexity_directive>');
      const warnCalls = stderrSpy.mock.calls.filter(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('Complexity signal'),
      );
      expect(warnCalls.length).toBe(1);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('non-ENOENT I/O error from readFileSync propagates (spec R4: only swallow ENOENT)', () => {
    // Spec R4: "fs.readFileSync(specPath, 'utf-8') (swallow ENOENT → treat as
    // null parse)." Unexpected read errors (EACCES, EIO, …) must NOT silently
    // downgrade to Medium — they indicate real infrastructure failure.
    const tmp = makeTmpDir();
    const { state, harnessDir } = makePhase3State(
      tmp,
      '# Fixture\n\n## Complexity\n\nSmall\n',
    );
    const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation(((
      ...args: unknown[]
    ) => {
      const p = args[0];
      if (typeof p === 'string' && p.endsWith('fixture-complexity.md')) {
        const err = new Error('permission denied') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      }
      // Fall through to the real implementation for template + skill reads.
      return (fs.readFileSync as unknown as (...a: unknown[]) => unknown).call(
        fs,
        ...args,
      ) as string;
    }) as typeof fs.readFileSync);
    try {
      expect(() => assembleInteractivePrompt(3, state, harnessDir)).toThrow(
        /permission denied|EACCES/,
      );
    } finally {
      readSpy.mockRestore();
    }
  });

  it('Phase 1 prompt is NOT affected (directive only injects at Phase 3)', () => {
    const tmp = makeTmpDir();
    const { state, harnessDir } = makePhase3State(
      tmp,
      '# Fixture\n\n## Complexity\n\nSmall\n',
    );
    // Switch attemptId so Phase 1 is callable
    const phase1State: HarnessState = {
      ...state,
      phaseAttemptId: { '1': 'attempt-phase1', '3': null, '5': null },
    };
    const prompt = assembleInteractivePrompt(1, phase1State, harnessDir);
    expect(prompt).not.toContain('<complexity_directive>');
  });
});

// ─── Complexity signal: parser ───────────────────────────────────────────────

describe('complexity signal — parser', () => {
  it.each([
    ['Small', 'small'],
    ['small', 'small'],
    ['SMALL', 'small'],
    ['Medium', 'medium'],
    ['medium', 'medium'],
    ['MEDIUM', 'medium'],
    ['Large', 'large'],
    ['large', 'large'],
    ['LARGE', 'large'],
  ])('case-insensitive token %s → %s', (token, expected) => {
    const spec = `# Title\n\n## Complexity\n\n${token}\n\n## Next\n`;
    expect(parseComplexitySignal(spec)).toBe(expected);
  });

  it.each([
    ['Small — ~300 LoC single-file CLI', 'small'],
    ['Medium — touches 8 files', 'medium'],
    ['Large - major refactor', 'large'],
  ])('accepts inline rationale after token (%s)', (line, expected) => {
    const spec = `## Complexity\n\n${line}\n`;
    expect(parseComplexitySignal(spec)).toBe(expected);
  });

  it('returns null when section missing', () => {
    expect(parseComplexitySignal('# Title\n\nJust prose, no Complexity header.\n')).toBeNull();
  });

  it('returns null when section present but body is empty', () => {
    expect(parseComplexitySignal('## Complexity\n\n\n## Next\n')).toBeNull();
  });

  it('returns null for unknown tokens', () => {
    expect(parseComplexitySignal('## Complexity\n\nExtraLarge\n')).toBeNull();
    expect(parseComplexitySignal('## Complexity\n\n3\n')).toBeNull();
  });

  it('skips leading blank lines before the token', () => {
    expect(parseComplexitySignal('## Complexity\n\n\n\n  \n\nMedium\n')).toBe('medium');
  });

  it('does not match "## Complexity:" (header must stand alone)', () => {
    // R2 is strict: `^##\s+Complexity\s*$`. Trailing colon or rationale on the
    // header line itself is rejected; authors put rationale on the next line.
    // Neither of these has a bare "## Complexity" header, so both return null.
    expect(parseComplexitySignal('## Complexity: Small\n\nSmall\n')).toBeNull();
    expect(parseComplexitySignal('## Complexity: Small\n\n')).toBeNull();
  });

  it('returns null when the spec contains two `## Complexity` sections (spec Goal 1: "exactly one")', () => {
    // Spec Goals item 1: "Phase 1 spec must contain exactly one ## Complexity
    // section." Duplicate headers — even with identical bodies — are an author
    // error and must not silently pass.
    const twoHeaders =
      '# Title\n\n## Complexity\n\nSmall\n\n## Other\n\n## Complexity\n\nLarge\n';
    expect(parseComplexitySignal(twoHeaders)).toBeNull();

    const twoHeadersSameBody =
      '## Complexity\n\nSmall\n\n## Complexity\n\nSmall\n';
    expect(parseComplexitySignal(twoHeadersSameBody)).toBeNull();
  });
});

// ─── Complexity signal: directive builder ─────────────────────────────────────

describe('complexity signal — directive builder', () => {
  afterEach(() => {
    __resetComplexityWarning();
  });

  it('Small emits a non-empty stanza instructing task-count ceiling + no pseudocode', () => {
    const out = buildComplexityDirective('small');
    expect(out).toContain('<complexity_directive>');
    expect(out).toContain('</complexity_directive>');
    expect(out).toMatch(/classified \*\*Small\*\*/);
    expect(out).toMatch(/at most 3 tasks/i);
    expect(out).toMatch(/per-function pseudocode/i);
    expect(out.endsWith('\n')).toBe(true);
  });

  it('Large emits a non-empty stanza instructing slice discipline + ADR capture', () => {
    const out = buildComplexityDirective('large');
    expect(out).toContain('<complexity_directive>');
    expect(out).toMatch(/classified \*\*Large\*\*/);
    expect(out).toMatch(/vertical slices/i);
    expect(out).toMatch(/ADR/);
  });

  it('Medium returns empty string (no behavioral drift)', () => {
    expect(buildComplexityDirective('medium')).toBe('');
  });

  it('null returns empty string and emits a single stderr warning per process', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(buildComplexityDirective(null)).toBe('');
      expect(buildComplexityDirective(null)).toBe('');
      expect(buildComplexityDirective(null)).toBe('');
      // Only one warn despite 3 calls
      const warnCalls = stderrSpy.mock.calls.filter(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('Complexity signal'),
      );
      expect(warnCalls.length).toBe(1);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('exact-snapshot — Small directive matches spec R3 byte-for-byte (drift guard)', () => {
    // Spec R3 declares the directive text is normative ("exact directive text
    // is part of this spec; tests snapshot these strings"). Freeze it.
    expect(buildComplexityDirective('small')).toBe(
      '<complexity_directive>\n' +
        'This task is classified **Small**. Keep the plan to **at most 3 tasks**. ' +
        'Do not emit per-function pseudocode or ASCII diagrams. Prefer bundling related edits in one task over splitting them. ' +
        'Keep `checklist.json` to at most 4 `checks` entries — typecheck + test + build is usually enough.\n' +
        '</complexity_directive>\n',
    );
  });

  it('exact-snapshot — Large directive matches spec R3 byte-for-byte (drift guard)', () => {
    expect(buildComplexityDirective('large')).toBe(
      '<complexity_directive>\n' +
        'This task is classified **Large**. Decompose into clear vertical slices with explicit dependency order. ' +
        'Capture architecturally-relevant decisions as short ADR blurbs inline in the plan. Standard depth otherwise.\n' +
        '</complexity_directive>\n',
    );
  });

  it('__resetComplexityWarning re-arms the warning', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      buildComplexityDirective(null);
      __resetComplexityWarning();
      buildComplexityDirective(null);
      const warnCalls = stderrSpy.mock.calls.filter(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('Complexity signal'),
      );
      expect(warnCalls.length).toBe(2);
    } finally {
      stderrSpy.mockRestore();
    }
  });
});

// ─── Complexity signal: E2E across the three buckets ─────────────────────────

describe('complexity signal — E2E', () => {
  afterEach(() => {
    __resetComplexityWarning();
  });

  function assemblePhase3WithBucket(body: string): string {
    const tmp = makeTmpDir();
    const relPath = 'docs/specs/fixture-e2e.md';
    const abs = path.join(tmp, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
    const state = makeState({
      phaseAttemptId: { '1': null, '3': 'attempt-e2e', '5': null },
      artifacts: {
        spec: relPath,
        decisionLog: '.harness/my-run/decisions.md',
        plan: 'docs/plans/fixture.md',
        checklist: '.harness/my-run/checklist.json',
        evalReport: 'docs/process/evals/fixture-eval.md',
      },
    });
    const harnessDir = path.join(tmp, '.harness');
    return assembleInteractivePrompt(3, state, harnessDir);
  }

  it('renders all three buckets with the expected stanza presence + ordering', () => {
    const small = assemblePhase3WithBucket('# Fixture\n\n## Complexity\n\nSmall\n');
    __resetComplexityWarning();
    const medium = assemblePhase3WithBucket('# Fixture\n\n## Complexity\n\nMedium\n');
    __resetComplexityWarning();
    const large = assemblePhase3WithBucket('# Fixture\n\n## Complexity\n\nLarge\n');

    // Bucket-specific markers present/absent.
    expect(small).toContain('classified **Small**');
    expect(small).toContain('at most 3 tasks');
    expect(medium).not.toContain('<complexity_directive>');
    expect(medium).not.toContain('classified **Small**');
    expect(medium).not.toContain('classified **Large**');
    expect(large).toContain('classified **Large**');
    expect(large).toContain('vertical slices');

    // Cross-bucket length regression: Medium (empty directive) is strictly
    // shorter than both Small and Large (non-empty directives), and the two
    // non-empty directives are similarly sized.
    expect(medium.length).toBeLessThan(small.length);
    expect(medium.length).toBeLessThan(large.length);
    expect(Math.abs(small.length - large.length)).toBeLessThan(500);
  });

  it('unknown complexity token falls back to Medium rendering (empty directive + single warn)', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const out = assemblePhase3WithBucket('# Fixture\n\n## Complexity\n\nExtraLarge\n');
      expect(out).not.toContain('<complexity_directive>');
      expect(out).not.toContain('classified **Small**');
      expect(out).not.toContain('classified **Large**');
      const warnCalls = stderrSpy.mock.calls.filter(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('Complexity signal'),
      );
      expect(warnCalls.length).toBe(1);
    } finally {
      stderrSpy.mockRestore();
    }
  });
});

describe('assembleGatePrompt(2) — light flow + full-flow regression (SC#3 / Inv #7-9)', () => {
  function writeLightSpec(cwd: string, state: HarnessState, content = '# combined spec\nspec content'): void {
    const specAbsPath = path.join(cwd, state.artifacts.spec);
    fs.mkdirSync(path.dirname(specAbsPath), { recursive: true });
    fs.writeFileSync(specAbsPath, content);
  }

  it('full-flow Gate 2 output is byte-identical after change (Inv #9 — exact snapshot)', () => {
    const cwd = makeTmpDir();
    const state = makeState();  // flow defaults to 'full'
    const specAbsPath = path.join(cwd, state.artifacts.spec);
    fs.mkdirSync(path.dirname(specAbsPath), { recursive: true });
    fs.writeFileSync(specAbsPath, '# Full Spec\nfull flow content');
    const result = assembleGatePrompt(2, state, '/tmp/harness', cwd);
    expect(typeof result).toBe('string');
    // toMatchSnapshot captures the exact bytes on first run and enforces them on future runs
    expect(result as string).toMatchSnapshot();
  });

  it('light Gate 2 contains FIVE_AXIS_DESIGN_GATE_LIGHT rubric marker (Inv #7)', () => {
    const cwd = makeTmpDir();
    const state = makeState({
      flow: 'light',
      artifacts: {
        spec: 'docs/specs/my-run-design.md',
        plan: '',
        decisionLog: '.harness/my-run/decisions.md',
        checklist: '.harness/my-run/checklist.json',
        evalReport: 'docs/process/evals/my-run-eval.md',
      },
    });
    writeLightSpec(cwd, state);
    const result = assembleGatePrompt(2, state, '/tmp/harness', cwd);
    expect(typeof result).toBe('string');
    const prompt = result as string;
    expect(prompt).toContain('Phase 2 — design gate, light flow');
    expect(prompt).toContain('5-phase light harness lifecycle');
    expect(prompt).toContain('combined design spec');
    // No plan artifact section injected (REVIEWER_CONTRACT_BASE mentions <plan> in examples, so check for the tag+newline pattern)
    expect(prompt).not.toContain('<plan>\n');
    // Snapshot — locks the exact light P2 prompt bytes for regression detection
    expect(prompt).toMatchSnapshot();
  });

  it('full-flow Gate 2 does NOT contain light stanza (no regression to full path)', () => {
    const cwd = makeTmpDir();
    const state = makeState();  // flow='full' by default
    const specAbsPath = path.join(cwd, state.artifacts.spec);
    fs.mkdirSync(path.dirname(specAbsPath), { recursive: true });
    fs.writeFileSync(specAbsPath, '# spec');
    const result = assembleGatePrompt(2, state, '/tmp/harness', cwd);
    expect(typeof result).toBe('string');
    const prompt = result as string;
    expect(prompt).toContain('Phase 2 — spec gate');
    expect(prompt).not.toContain('5-phase light harness lifecycle');
    expect(prompt).not.toContain('Phase 2 — design gate, light flow');
  });
});
