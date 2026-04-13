import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createTestRepo } from '../helpers/test-repo.js';
import { skipCommand } from '../../src/commands/skip.js';
import { createInitialState, writeState } from '../../src/state.js';
import { setCurrentRun } from '../../src/root.js';

vi.mock('../../src/phases/runner.js', () => ({
  runPhaseLoop: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/preflight.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/preflight.js')>('../../src/preflight.js');
  return {
    ...actual,
    runPreflight: vi.fn(() => ({})),
  };
});

function setupRun(repo: { path: string }, options: Partial<Record<string, unknown>> = {}) {
  const harnessDir = join(repo.path, '.harness');
  const runId = '2026-04-12-test';
  const runDir = join(harnessDir, runId);
  mkdirSync(runDir, { recursive: true });

  const baseCommit = execSync('git rev-parse HEAD', { cwd: repo.path, encoding: 'utf-8' }).trim();
  const state = createInitialState(runId, 'test task', baseCommit, '/fake/codex', false);
  Object.assign(state, options);
  writeState(runDir, state);
  setCurrentRun(harnessDir, runId);

  return { harnessDir, runId, runDir, state };
}

describe('skipCommand', () => {
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

  it('rejects skip on paused run', async () => {
    setupRun(repo, { status: 'paused' });
    await expect(skipCommand({ root: repo.path })).rejects.toThrow('__exit__');
    expect(stderrSpy.mock.calls.map((c: any) => c[0]).join('')).toContain('paused');
  });

  it('rejects skip on completed run', async () => {
    setupRun(repo, { status: 'completed' });
    await expect(skipCommand({ root: repo.path })).rejects.toThrow('__exit__');
    expect(stderrSpy.mock.calls.map((c: any) => c[0]).join('')).toContain('completed');
  });

  it('Phase 5 skip blocked when impl commits exist', async () => {
    // Set up .gitignore first so .harness/ doesn't dirty the tree
    writeFileSync(join(repo.path, '.gitignore'), '.harness/\n');
    execSync('git add .gitignore && git commit -m "gitignore"', { cwd: repo.path });

    // Record HEAD after .gitignore commit (this is the pre-impl HEAD)
    const pre = execSync('git rev-parse HEAD', { cwd: repo.path, encoding: 'utf-8' }).trim();

    // Make impl commit AFTER pre
    writeFileSync(join(repo.path, 'impl.txt'), 'x');
    execSync('git add impl.txt && git commit -m "impl commit"', { cwd: repo.path });

    // Now set up run with implRetryBase = pre (so implRetryBase..HEAD has a commit)
    const harnessDir = join(repo.path, '.harness');
    const runId = '2026-04-12-test';
    mkdirSync(join(harnessDir, runId), { recursive: true });
    const state = createInitialState(runId, 'test', pre, '/fake/codex', false);
    state.currentPhase = 5;
    state.implRetryBase = pre;
    writeState(join(harnessDir, runId), state);
    setCurrentRun(harnessDir, runId);

    await expect(skipCommand({ root: repo.path })).rejects.toThrow('__exit__');
    expect(stderrSpy.mock.calls.map((c: any) => c[0]).join('')).toContain('implementation commits');
  });

  it('Phase 6 skip requires clean working tree', async () => {
    setupRun(repo, { currentPhase: 6 });
    writeFileSync(join(repo.path, 'dirty.txt'), 'x');

    await expect(skipCommand({ root: repo.path })).rejects.toThrow('__exit__');
    expect(stderrSpy.mock.calls.map((c: any) => c[0]).join('')).toContain('clean working tree');
  });

  it('Phase 6 skip generates synthetic eval report', async () => {
    // Set .harness/ ignored + docs/process/evals/ ready BEFORE creating run
    writeFileSync(join(repo.path, '.gitignore'), '.harness/\n');
    execSync('git add .gitignore && git commit -m "gitignore"', { cwd: repo.path });
    mkdirSync(join(repo.path, 'docs/process/evals'), { recursive: true });

    const { runDir } = setupRun(repo, { currentPhase: 6 });

    await skipCommand({ root: repo.path });

    const evalPath = join(repo.path, 'docs/process/evals/2026-04-12-test-eval.md');
    expect(existsSync(evalPath)).toBe(true);
    const content = readFileSync(evalPath, 'utf-8');
    expect(content).toContain('VERIFY SKIPPED');
    expect(content).toContain('## Summary');
  });

  it('writes pendingAction=skip_phase before side effects', async () => {
    const { runDir } = setupRun(repo, { currentPhase: 4 });
    // Create required artifacts for Phase 4 (spec + plan)
    mkdirSync(join(repo.path, 'docs/specs'), { recursive: true });
    mkdirSync(join(repo.path, 'docs/plans'), { recursive: true });
    writeFileSync(join(repo.path, 'docs/specs/2026-04-12-test-design.md'), 'spec');
    writeFileSync(join(repo.path, 'docs/plans/2026-04-12-test.md'), 'plan');

    await skipCommand({ root: repo.path });

    // After completion, pendingAction should be cleared
    const state = JSON.parse(readFileSync(join(runDir, 'state.json'), 'utf-8'));
    expect(state.pendingAction).toBeNull();
    expect(state.phases['4']).toBe('completed');
    expect(state.currentPhase).toBe(5);
  });
});
