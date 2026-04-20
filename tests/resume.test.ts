import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createTestRepo } from './helpers/test-repo.js';
import { resumeRun, completeInteractivePhaseFromFreshSentinel } from '../src/resume.js';
import { createInitialState, writeState } from '../src/state.js';

vi.mock('../src/phases/runner.js', () => ({
  runPhaseLoop: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/phases/terminal-ui.js', () => ({
  enterFailedTerminalState: vi.fn().mockResolvedValue(undefined),
}));

function setupRun(repo: { path: string }, options: Partial<Record<string, unknown>> = {}) {
  writeFileSync(join(repo.path, '.gitignore'), '.harness/\n');
  execSync('git add .gitignore && git commit -m "gitignore"', { cwd: repo.path });

  const harnessDir = join(repo.path, '.harness');
  const runId = '2026-04-12-test';
  const runDir = join(harnessDir, runId);
  mkdirSync(runDir, { recursive: true });

  const baseCommit = execSync('git rev-parse HEAD', { cwd: repo.path, encoding: 'utf-8' }).trim();
  const state = createInitialState(runId, 'test task', baseCommit, false);
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

  it('exits with code 1 and non-interactive message on paused run with null pendingAction (D4b)', async () => {
    const { state, harnessDir, runDir } = setupRun(repo, {
      status: 'paused',
      pendingAction: null,
    });

    await expect(resumeRun(state, harnessDir, runDir, repo.path)).rejects.toThrow('__exit__:1');

    // Must include 'non-interactive resume path' so user knows to use 'phase-harness resume'
    const warnOutput = stderrSpy.mock.calls.map((c: any) => c[0]).join('');
    expect(warnOutput).toContain('non-interactive resume path');
    expect(warnOutput).toContain('inconsistent');
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

  it('errors when phase 5 completed but all trackedRepos implHead are null (state anomaly)', async () => {
    const phases = {
      '1': 'pending', '2': 'pending', '3': 'pending',
      '4': 'pending', '5': 'completed', '6': 'pending', '7': 'pending',
    };
    const baseCommit = execSync('git rev-parse HEAD', { cwd: repo.path, encoding: 'utf-8' }).trim();
    const { state, harnessDir, runDir } = setupRun(repo, {
      currentPhase: 6,
      phases,
      implCommit: baseCommit,
      trackedRepos: [
        { path: repo.path, baseCommit, implRetryBase: baseCommit, implHead: null },
      ],
    });

    await expect(resumeRun(state, harnessDir, runDir, repo.path)).rejects.toThrow('__exit__');
    const output = stderrSpy.mock.calls.map((c: any) => c[0]).join('');
    expect(output).toContain('state anomaly');
  });

  it('skip_phase Phase 6 with gitignored eval report: skips commit and leaves evalCommit null', async () => {
    // setupRun first (creates .harness/ gitignore and initial commits)
    const { state, harnessDir, runDir } = setupRun(repo, {
      currentPhase: 6,
      phases: {
        '1': 'pending', '2': 'pending', '3': 'pending',
        '4': 'pending', '5': 'pending', '6': 'in_progress', '7': 'pending',
      },
      pendingAction: {
        type: 'skip_phase',
        targetPhase: 6,
        sourcePhase: null,
        feedbackPaths: [],
      },
    });

    // Add docs/ to gitignore AFTER setupRun (so it is not overwritten)
    writeFileSync(join(repo.path, '.gitignore'), '.harness/\ndocs/\n');
    execSync('git add .gitignore && git commit -m "gitignore docs"', { cwd: repo.path });

    // Create the eval report file (gitignored — exists on disk but not tracked)
    mkdirSync(join(repo.path, 'docs/process/evals'), { recursive: true });
    writeFileSync(
      join(repo.path, state.artifacts.evalReport),
      '# Verification Report (SKIPPED)\n\n## Summary\n\nVERIFY SKIPPED\n'
    );

    await resumeRun(state, harnessDir, runDir, repo.path);

    const updated = JSON.parse(readFileSync(join(runDir, 'state.json'), 'utf-8'));
    // evalCommit and verifiedAtHead must remain null — commit was skipped due to gitignore
    expect(updated.evalCommit).toBeNull();
    expect(updated.verifiedAtHead).toBeNull();
    expect(updated.phases['6']).toBe('completed');
    // Warning must be emitted
    expect(stderrSpy.mock.calls.map((c: any) => c[0]).join('')).toContain('gitignored');
  });
});

// Standalone helpers for multi-repo tests (real git, no mocks needed)
const multiRepoTmpDirs: string[] = [];

function makeMultiTmpDir(prefix = 'harness-mr-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  multiRepoTmpDirs.push(dir);
  return dir;
}

function initRepo(repoPath: string, filename = 'init.txt'): string {
  mkdirSync(repoPath, { recursive: true });
  execSync('git init', { cwd: repoPath, stdio: 'pipe' });
  execSync('git config user.email "t@t.com"', { cwd: repoPath, stdio: 'pipe' });
  execSync('git config user.name "T"', { cwd: repoPath, stdio: 'pipe' });
  writeFileSync(join(repoPath, filename), 'x');
  execSync('git add .', { cwd: repoPath, stdio: 'pipe' });
  execSync('git commit -m "init"', { cwd: repoPath, stdio: 'pipe' });
  return execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim();
}

afterEach(() => {
  for (const dir of multiRepoTmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  multiRepoTmpDirs.length = 0;
});

describe('completeInteractivePhaseFromFreshSentinel — Phase 5 multi-repo (FR-8)', () => {
  it('returns true and sets implHead when any repo advanced', () => {
    const outer = makeMultiTmpDir();
    const repoA = join(outer, 'a');
    const base = initRepo(repoA);

    // Advance repoA
    writeFileSync(join(repoA, 'impl.txt'), 'y');
    execSync('git add .', { cwd: repoA, stdio: 'pipe' });
    execSync('git commit -m "impl"', { cwd: repoA, stdio: 'pipe' });
    const newHead = execSync('git rev-parse HEAD', { cwd: repoA, encoding: 'utf-8' }).trim();

    const state = createInitialState('test-run', 'task', base, false);
    state.trackedRepos = [
      { path: repoA, baseCommit: base, implRetryBase: base, implHead: null },
    ];
    state.implRetryBase = base;

    const runDir = makeMultiTmpDir('rundir-');
    const result = completeInteractivePhaseFromFreshSentinel(5, state, outer, runDir);

    expect(result).toBe(true);
    expect(state.trackedRepos[0].implHead).toBe(newHead);
    // syncLegacyMirror: state.implCommit mirrors trackedRepos[0].implHead
    expect(state.implCommit).toBe(newHead);
  });

  it('returns false when no repo advanced (HEAD === implRetryBase)', () => {
    const outer = makeMultiTmpDir();
    const repoA = join(outer, 'a');
    const head = initRepo(repoA);

    const state = createInitialState('test-run', 'task', head, false);
    state.trackedRepos = [
      { path: repoA, baseCommit: head, implRetryBase: head, implHead: null },
    ];
    state.implRetryBase = head;

    const runDir = makeMultiTmpDir('rundir-');
    const result = completeInteractivePhaseFromFreshSentinel(5, state, outer, runDir);

    expect(result).toBe(false);
  });

  it('skips ancestry check for repos with implHead=null (null-safe FR-8)', async () => {
    const outer = makeMultiTmpDir();
    const repoA = join(outer, 'a');
    const implSha = initRepo(repoA);

    // repoB doesn't need to be a real git repo — implHead=null means no ancestry check
    const repoB = join(outer, 'b');
    mkdirSync(repoB);

    const state = createInitialState('test-run', 'task', implSha, false);
    state.phases['5'] = 'completed';
    state.trackedRepos = [
      { path: repoA, baseCommit: implSha, implRetryBase: implSha, implHead: implSha },
      { path: repoB, baseCommit: 'dummy', implRetryBase: 'dummy', implHead: null },
    ];
    state.implCommit = implSha;

    // Set up a runDir with a fresh state.json so resumeRun can proceed
    const harnessDir = join(outer, '.harness');
    const runDir = join(harnessDir, 'test-run');
    mkdirSync(runDir, { recursive: true });
    writeState(runDir, state);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: any) => {
      throw new Error(`__exit__${_code}`);
    });
    const stderrSpy2 = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      // Calling resumeRun will exercise validateAncestry — the null-safe path
      // should NOT call isAncestor on repoB and should NOT exit
      // (only repoA with a real implHead is checked)
      // It will eventually reach runPhaseLoop which is already mocked
      await resumeRun(state, harnessDir, runDir, outer);
    } finally {
      exitSpy.mockRestore();
      stderrSpy2.mockRestore();
    }
    // No __exit__ thrown = test passes
  });
});
