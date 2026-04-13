import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { createTestRepo } from './helpers/test-repo.js';
import { resumeRun } from '../src/resume.js';
import { createInitialState, writeState } from '../src/state.js';

vi.mock('../src/phases/runner.js', () => ({
  runPhaseLoop: vi.fn().mockResolvedValue(undefined),
}));

function setupRun(repo: { path: string }, options: Partial<Record<string, unknown>> = {}) {
  writeFileSync(join(repo.path, '.gitignore'), '.harness/\n');
  execSync('git add .gitignore && git commit -m "gitignore"', { cwd: repo.path });

  const harnessDir = join(repo.path, '.harness');
  const runId = '2026-04-12-test';
  const runDir = join(harnessDir, runId);
  mkdirSync(runDir, { recursive: true });

  const baseCommit = execSync('git rev-parse HEAD', { cwd: repo.path, encoding: 'utf-8' }).trim();
  const state = createInitialState(runId, 'test task', baseCommit, '/fake/codex', false);
  Object.assign(state, options);
  writeState(runDir, state);

  return { harnessDir, runId, runDir, state };
}

/** Create valid artifacts for phases marked completed so validation passes. */
function createArtifactsFor(repo: { path: string }, phases: Record<string, string>): void {
  const runId = '2026-04-12-test';
  if (phases['1'] === 'completed') {
    mkdirSync(join(repo.path, 'docs/specs'), { recursive: true });
    writeFileSync(join(repo.path, `docs/specs/${runId}-design.md`), '# spec\n## Context & Decisions\n');
    mkdirSync(join(repo.path, `.harness/${runId}`), { recursive: true });
    writeFileSync(join(repo.path, `.harness/${runId}/decisions.md`), '# decisions\n');
  }
  if (phases['3'] === 'completed') {
    mkdirSync(join(repo.path, 'docs/plans'), { recursive: true });
    writeFileSync(join(repo.path, `docs/plans/${runId}.md`), '# plan\n');
    mkdirSync(join(repo.path, `.harness/${runId}`), { recursive: true });
    writeFileSync(
      join(repo.path, `.harness/${runId}/checklist.json`),
      '{"checks":[{"name":"t","command":"echo x"}]}'
    );
  }
  if (phases['6'] === 'completed') {
    mkdirSync(join(repo.path, 'docs/process/evals'), { recursive: true });
    writeFileSync(
      join(repo.path, `docs/process/evals/${runId}-eval.md`),
      '# eval report\n\n## Summary\n\nAll checks passed.\n'
    );
  }
}

describe('resumeRun', () => {
  let repo: { path: string; cleanup: () => void };
  let exitSpy: any;
  let stderrSpy: any;

  beforeEach(() => {
    repo = createTestRepo();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code}`);
    }) as never);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
    repo.cleanup();
  });

  it('errors on paused run with null pendingAction', async () => {
    const { state, harnessDir, runDir } = setupRun(repo, {
      status: 'paused',
      pendingAction: null,
    });

    await expect(resumeRun(state, harnessDir, runDir, repo.path)).rejects.toThrow('__exit__');
    expect(stderrSpy.mock.calls.map((c: any) => c[0]).join('')).toContain('inconsistent');
  });

  it('clears pendingAction when rerun_gate target already completed', async () => {
    const phases = {
      '1': 'completed',
      '2': 'completed',
      '3': 'in_progress',
      '4': 'pending',
      '5': 'pending',
      '6': 'pending',
      '7': 'pending',
    };
    createArtifactsFor(repo, phases);
    const { state, harnessDir, runDir } = setupRun(repo, {
      currentPhase: 3,
      pendingAction: {
        type: 'rerun_gate',
        targetPhase: 2,
        sourcePhase: null,
        feedbackPaths: [],
      },
      phases,
    });

    await resumeRun(state, harnessDir, runDir, repo.path);
    const updated = JSON.parse(readFileSync(join(runDir, 'state.json'), 'utf-8'));
    expect(updated.pendingAction).toBeNull();
  });

  it('clears pendingAction when rerun_verify and phase 6 completed', async () => {
    const phases = {
      '1': 'completed',
      '2': 'completed',
      '3': 'completed',
      '4': 'completed',
      '5': 'completed',
      '6': 'completed',
      '7': 'pending',
    };
    createArtifactsFor(repo, phases);
    const { state, harnessDir, runDir } = setupRun(repo, {
      currentPhase: 7,
      pendingAction: {
        type: 'rerun_verify',
        targetPhase: 6,
        sourcePhase: null,
        feedbackPaths: [],
      },
      phases,
    });

    await resumeRun(state, harnessDir, runDir, repo.path);
    const updated = JSON.parse(readFileSync(join(runDir, 'state.json'), 'utf-8'));
    expect(updated.pendingAction).toBeNull();
  });

  it('clears skip_phase pendingAction when target completed', async () => {
    const phases = {
      '1': 'completed',
      '2': 'completed',
      '3': 'in_progress',
      '4': 'pending',
      '5': 'pending',
      '6': 'pending',
      '7': 'pending',
    };
    createArtifactsFor(repo, phases);
    const { state, harnessDir, runDir } = setupRun(repo, {
      currentPhase: 3,
      pendingAction: {
        type: 'skip_phase',
        targetPhase: 2,
        sourcePhase: null,
        feedbackPaths: [],
      },
      phases,
    });

    await resumeRun(state, harnessDir, runDir, repo.path);
    const updated = JSON.parse(readFileSync(join(runDir, 'state.json'), 'utf-8'));
    expect(updated.pendingAction).toBeNull();
  });

  it('errors when completed phase artifact is missing', async () => {
    const { state, harnessDir, runDir } = setupRun(repo, {
      currentPhase: 3,
      phases: {
        '1': 'completed',
        '2': 'pending',
        '3': 'pending',
        '4': 'pending',
        '5': 'pending',
        '6': 'pending',
        '7': 'pending',
      },
      // Phase 1 completed but spec file never created
    });

    await expect(resumeRun(state, harnessDir, runDir, repo.path)).rejects.toThrow('__exit__');
    expect(stderrSpy.mock.calls.map((c: any) => c[0]).join('')).toContain('Artifact');
  });

  it('errors when specCommit is not in git history', async () => {
    const badSha = '0000000000000000000000000000000000000000';
    // Set up valid artifacts first
    mkdirSync(join(repo.path, 'docs/specs'), { recursive: true });
    writeFileSync(
      join(repo.path, 'docs/specs/2026-04-12-test-design.md'),
      '# spec'
    );
    mkdirSync(join(repo.path, '.harness/2026-04-12-test'), { recursive: true });
    writeFileSync(
      join(repo.path, '.harness/2026-04-12-test/decisions.md'),
      '# decisions'
    );

    const { state, harnessDir, runDir } = setupRun(repo, {
      currentPhase: 3,
      specCommit: badSha,
      phases: {
        '1': 'completed',
        '2': 'pending',
        '3': 'pending',
        '4': 'pending',
        '5': 'pending',
        '6': 'pending',
        '7': 'pending',
      },
    });

    await expect(resumeRun(state, harnessDir, runDir, repo.path)).rejects.toThrow('__exit__');
    expect(stderrSpy.mock.calls.map((c: any) => c[0]).join('')).toContain('Spec commit');
  });
});
