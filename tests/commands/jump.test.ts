import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createTestRepo } from '../helpers/test-repo.js';
import { jumpCommand } from '../../src/commands/jump.js';
import { createInitialState, writeState } from '../../src/state.js';
import { setCurrentRun } from '../../src/root.js';

vi.mock('../../src/lock.js', () => ({
  readLock: vi.fn(() => null),
}));

vi.mock('../../src/process.js', () => ({
  isPidAlive: vi.fn(() => false),
}));

function setupRun(repo: { path: string }, options: Partial<Record<string, unknown>> = {}) {
  const harnessDir = join(repo.path, '.harness');
  const runId = '2026-04-12-test';
  const runDir = join(harnessDir, runId);
  mkdirSync(runDir, { recursive: true });

  const baseCommit = execSync('git rev-parse HEAD', { cwd: repo.path, encoding: 'utf-8' }).trim();
  const state = createInitialState(runId, 'test task', baseCommit, false);
  Object.assign(state, options);
  writeState(runDir, state);
  setCurrentRun(harnessDir, runId);

  return { harnessDir, runId, runDir, state };
}

describe('jumpCommand', () => {
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

  it('rejects invalid phase number', async () => {
    setupRun(repo, { currentPhase: 5 });
    await expect(jumpCommand('abc', { root: repo.path })).rejects.toThrow('__exit__');
    await expect(jumpCommand('0', { root: repo.path })).rejects.toThrow('__exit__');
    await expect(jumpCommand('8', { root: repo.path })).rejects.toThrow('__exit__');
  });

  it('rejects forward jump', async () => {
    setupRun(repo, { currentPhase: 3 });
    await expect(jumpCommand('5', { root: repo.path })).rejects.toThrow('__exit__');
    expect(stderrSpy.mock.calls.map((c: any) => c[0]).join('')).toContain('forward');
  });

  it('writes pending-action.json with jump action when no inner process', async () => {
    const { runDir } = setupRun(repo, { currentPhase: 5 });

    await jumpCommand('3', { root: repo.path });

    const pendingPath = join(runDir, 'pending-action.json');
    expect(existsSync(pendingPath)).toBe(true);
    const content = JSON.parse(readFileSync(pendingPath, 'utf-8'));
    expect(content).toEqual({ action: 'jump', phase: 3 });
  });

  it('allows jump from completed run', async () => {
    const { runDir } = setupRun(repo, { currentPhase: 8, status: 'completed' });

    await jumpCommand('3', { root: repo.path });

    const pendingPath = join(runDir, 'pending-action.json');
    expect(existsSync(pendingPath)).toBe(true);
    const content = JSON.parse(readFileSync(pendingPath, 'utf-8'));
    expect(content).toEqual({ action: 'jump', phase: 3 });
  });

  it('prints message about applying on next resume', async () => {
    setupRun(repo, { currentPhase: 5 });

    await jumpCommand('3', { root: repo.path });

    expect(stderrSpy.mock.calls.map((c: any) => c[0]).join('')).toContain('phase 3');
  });
});
