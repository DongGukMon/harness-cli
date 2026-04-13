import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createTestRepo } from '../helpers/test-repo.js';
import { resumeCommand } from '../../src/commands/resume.js';
import { createInitialState, writeState } from '../../src/state.js';
import { setCurrentRun } from '../../src/root.js';

vi.mock('../../src/resume.js', () => ({
  resumeRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/signal.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/signal.js')>('../../src/signal.js');
  return { ...actual, registerSignalHandlers: vi.fn() };
});

vi.mock('../../src/preflight.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/preflight.js')>('../../src/preflight.js');
  return { ...actual, runPreflight: vi.fn(() => ({})), resolveCodexPath: vi.fn(() => '/fake/codex') };
});

function setupRun(repo: { path: string }, overrides: Partial<Record<string, unknown>> = {}) {
  writeFileSync(join(repo.path, '.gitignore'), '.harness/\n');
  execSync('git add .gitignore && git commit -m "gitignore"', { cwd: repo.path });

  const harnessDir = join(repo.path, '.harness');
  const runId = '2026-04-12-test';
  const runDir = join(harnessDir, runId);
  mkdirSync(runDir, { recursive: true });

  const baseCommit = execSync('git rev-parse HEAD', { cwd: repo.path, encoding: 'utf-8' }).trim();
  const state = createInitialState(runId, 'test task', baseCommit, '/fake/codex', false);
  Object.assign(state, overrides);
  writeState(runDir, state);

  return { harnessDir, runId, runDir };
}

describe('resumeCommand', () => {
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

  it('errors when no runId and no current-run', async () => {
    const harnessDir = join(repo.path, '.harness');
    mkdirSync(harnessDir, { recursive: true });

    await expect(resumeCommand(undefined, { root: repo.path })).rejects.toThrow('__exit__');
    expect(stderrSpy.mock.calls.map((c: any) => c[0]).join('')).toContain('No active run');
  });

  it('errors when run directory missing', async () => {
    await expect(resumeCommand('nonexistent', { root: repo.path })).rejects.toThrow('__exit__');
    expect(stderrSpy.mock.calls.map((c: any) => c[0]).join('')).toContain('not found');
  });

  it('errors when state.json missing', async () => {
    const harnessDir = join(repo.path, '.harness');
    mkdirSync(join(harnessDir, 'empty-run'), { recursive: true });

    await expect(resumeCommand('empty-run', { root: repo.path })).rejects.toThrow('__exit__');
    expect(stderrSpy.mock.calls.map((c: any) => c[0]).join('')).toContain('no state');
  });

  it('errors on completed run and updates current-run pointer', async () => {
    const { harnessDir, runId } = setupRun(repo, { status: 'completed' });

    await expect(resumeCommand(runId, { root: repo.path })).rejects.toThrow('__exit__');
    expect(stderrSpy.mock.calls.map((c: any) => c[0]).join('')).toContain('already completed');

    // current-run should be updated
    const current = execSync('cat .harness/current-run', {
      cwd: repo.path,
      encoding: 'utf-8',
    }).trim();
    expect(current).toBe(runId);
  });

  it('resumes with explicit runId', async () => {
    setupRun(repo);
    await resumeCommand('2026-04-12-test', { root: repo.path });
    // Resume ran successfully (mocked resumeRun resolved)
  });

  it('resumes with implicit current-run', async () => {
    const { harnessDir, runId } = setupRun(repo);
    setCurrentRun(harnessDir, runId);

    await resumeCommand(undefined, { root: repo.path });
  });
});
