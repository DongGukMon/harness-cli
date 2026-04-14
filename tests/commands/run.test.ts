import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createTestRepo } from '../helpers/test-repo.js';
import { runCommand } from '../../src/commands/run.js';

vi.mock('../../src/preflight.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/preflight.js')>('../../src/preflight.js');
  return {
    ...actual,
    runPreflight: vi.fn((items: string[]) => {
      if (items.includes('codexPath')) return { codexPath: '/fake/codex-companion.mjs' };
      return {};
    }),
  };
});

vi.mock('../../src/tmux.js', () => ({
  isInsideTmux: vi.fn(() => false),
  getCurrentSessionName: vi.fn(() => null),
  getActiveWindowId: vi.fn(() => null),
  createSession: vi.fn(),
  createWindow: vi.fn(() => '@0'),
  sendKeys: vi.fn(),
  killSession: vi.fn(),
  selectWindow: vi.fn(),
  getDefaultPaneId: vi.fn(() => '%0'),
}));

vi.mock('../../src/terminal.js', () => ({
  openTerminalWindow: vi.fn(() => true),
}));

vi.mock('../../src/lock.js', () => ({
  acquireLock: vi.fn(() => ({})),
  releaseLock: vi.fn(),
  setLockHandoff: vi.fn(),
  pollForHandoffComplete: vi.fn(() => true),
}));

vi.mock('../../src/ui.js', () => ({
  printSuccess: vi.fn(),
  printError: vi.fn(),
}));

describe('runCommand', () => {
  let repo: { path: string; cleanup: () => void };
  let origCwd: string;
  let exitSpy: any;
  let stderrSpy: any;

  beforeEach(() => {
    repo = createTestRepo();
    origCwd = process.cwd();
    process.chdir(repo.path);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code}`);
    }) as never);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    process.chdir(origCwd);
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
    repo.cleanup();
  });

  it('rejects empty task', async () => {
    await expect(runCommand('', { root: repo.path })).rejects.toThrow('__exit__');
  });

  it('rejects whitespace-only task', async () => {
    await expect(runCommand('   ', { root: repo.path })).rejects.toThrow('__exit__');
  });

  it('creates run directory with state.json + task.md', async () => {
    await runCommand('test task', { root: repo.path });

    const harnessDir = join(repo.path, '.harness');
    expect(existsSync(harnessDir)).toBe(true);

    const currentRun = readFileSync(join(harnessDir, 'current-run'), 'utf-8').trim();
    expect(currentRun).toMatch(/^\d{4}-\d{2}-\d{2}-test-task$/);

    const runDir = join(harnessDir, currentRun);
    expect(existsSync(join(runDir, 'state.json'))).toBe(true);
    expect(existsSync(join(runDir, 'task.md'))).toBe(true);
    expect(readFileSync(join(runDir, 'task.md'), 'utf-8')).toBe('test task');
  });

  it('creates required directories', async () => {
    await runCommand('test', { root: repo.path });

    expect(existsSync(join(repo.path, 'docs/specs'))).toBe(true);
    expect(existsSync(join(repo.path, 'docs/plans'))).toBe(true);
    expect(existsSync(join(repo.path, 'docs/process/evals'))).toBe(true);
  });

  it('adds .harness/ to .gitignore', async () => {
    await runCommand('test', { root: repo.path });
    const gitignore = readFileSync(join(repo.path, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('.harness/');
  });

  it('is no-op when .gitignore already has .harness/', async () => {
    writeFileSync(join(repo.path, '.gitignore'), '.harness/\n');
    execSync('git add .gitignore && git commit -m "add gitignore"', { cwd: repo.path });

    const headBefore = execSync('git rev-parse HEAD', { cwd: repo.path, encoding: 'utf-8' }).trim();
    await runCommand('test', { root: repo.path });
    const headAfter = execSync('git rev-parse HEAD', { cwd: repo.path, encoding: 'utf-8' }).trim();

    expect(headAfter).toBe(headBefore);
  });

  it('rejects staged changes (even with --allow-dirty)', async () => {
    writeFileSync(join(repo.path, 'staged.txt'), 'x');
    execSync('git add staged.txt', { cwd: repo.path });

    await expect(runCommand('test', { root: repo.path, allowDirty: true })).rejects.toThrow('__exit__');
    expect(stderrSpy.mock.calls.map((c: any) => c[0]).join('')).toContain('staged changes');
  });

  it('rejects unstaged changes without --allow-dirty', async () => {
    writeFileSync(join(repo.path, 'untracked.txt'), 'x');

    await expect(runCommand('test', { root: repo.path })).rejects.toThrow('__exit__');
    expect(stderrSpy.mock.calls.map((c: any) => c[0]).join('')).toContain('uncommitted');
  });

  it('allows unstaged changes with --allow-dirty (warning)', async () => {
    writeFileSync(join(repo.path, 'untracked.txt'), 'x');

    await runCommand('test', { root: repo.path, allowDirty: true });
    expect(stderrSpy.mock.calls.map((c: any) => c[0]).join('')).toContain('--allow-dirty');
  });

  it('sets baseCommit to HEAD after .gitignore commit', async () => {
    await runCommand('test', { root: repo.path });
    const harnessDir = join(repo.path, '.harness');
    const runId = readFileSync(join(harnessDir, 'current-run'), 'utf-8').trim();
    const state = JSON.parse(readFileSync(join(harnessDir, runId, 'state.json'), 'utf-8'));
    const head = execSync('git rev-parse HEAD', { cwd: repo.path, encoding: 'utf-8' }).trim();
    expect(state.baseCommit).toBe(head);
  });
});
