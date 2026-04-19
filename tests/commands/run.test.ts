import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createTestRepo } from '../helpers/test-repo.js';
import { startCommand } from '../../src/commands/start.js';

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

describe('startCommand', () => {
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

  it('accepts empty task as untitled', async () => {
    await startCommand('', { root: repo.path });
    const harnessDir = join(repo.path, '.harness');
    const currentRun = readFileSync(join(harnessDir, 'current-run'), 'utf-8').trim();
    expect(currentRun).toMatch(/^\d{4}-\d{2}-\d{2}-untitled$/);
  });

  it('accepts whitespace-only task as untitled', async () => {
    await startCommand('   ', { root: repo.path });
    const harnessDir = join(repo.path, '.harness');
    const currentRun = readFileSync(join(harnessDir, 'current-run'), 'utf-8').trim();
    expect(currentRun).toMatch(/^\d{4}-\d{2}-\d{2}-untitled$/);
  });

  it('creates run directory with state.json + task.md', async () => {
    await startCommand('test task', { root: repo.path });

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
    await startCommand('test', { root: repo.path });

    expect(existsSync(join(repo.path, 'docs/specs'))).toBe(true);
    expect(existsSync(join(repo.path, 'docs/plans'))).toBe(true);
    expect(existsSync(join(repo.path, 'docs/process/evals'))).toBe(true);
  });

  it('adds .harness/ to .gitignore', async () => {
    await startCommand('test', { root: repo.path });
    const gitignore = readFileSync(join(repo.path, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('.harness/');
  });

  it('is no-op when .gitignore already has .harness/', async () => {
    writeFileSync(join(repo.path, '.gitignore'), '.harness/\n');
    execSync('git add .gitignore && git commit -m "add gitignore"', { cwd: repo.path });

    const headBefore = execSync('git rev-parse HEAD', { cwd: repo.path, encoding: 'utf-8' }).trim();
    await startCommand('test', { root: repo.path });
    const headAfter = execSync('git rev-parse HEAD', { cwd: repo.path, encoding: 'utf-8' }).trim();

    expect(headAfter).toBe(headBefore);
  });

  it('warns on staged changes by default (no block)', async () => {
    writeFileSync(join(repo.path, 'staged.txt'), 'x');
    execSync('git add staged.txt', { cwd: repo.path });

    await startCommand('test', { root: repo.path });
    expect(stderrSpy.mock.calls.map((c: any) => c[0]).join('')).toContain('staged changes');
  });

  it('rejects staged changes with --require-clean', async () => {
    writeFileSync(join(repo.path, 'staged.txt'), 'x');
    execSync('git add staged.txt', { cwd: repo.path });

    await expect(startCommand('test', { root: repo.path, requireClean: true })).rejects.toThrow('__exit__');
    expect(stderrSpy.mock.calls.map((c: any) => c[0]).join('')).toContain('staged changes');
  });

  it('allows unstaged changes by default', async () => {
    writeFileSync(join(repo.path, 'untracked.txt'), 'x');

    await startCommand('test', { root: repo.path });
    // No error — dirty working tree is allowed by default
  });

  it('rejects unstaged changes with --require-clean', async () => {
    writeFileSync(join(repo.path, 'untracked.txt'), 'x');

    await expect(startCommand('test', { root: repo.path, requireClean: true })).rejects.toThrow('__exit__');
    expect(stderrSpy.mock.calls.map((c: any) => c[0]).join('')).toContain('uncommitted');
  });

  it('sets baseCommit to HEAD after .gitignore commit', async () => {
    await startCommand('test', { root: repo.path });
    const harnessDir = join(repo.path, '.harness');
    const runId = readFileSync(join(harnessDir, 'current-run'), 'utf-8').trim();
    const state = JSON.parse(readFileSync(join(harnessDir, runId, 'state.json'), 'utf-8'));
    const head = execSync('git rev-parse HEAD', { cwd: repo.path, encoding: 'utf-8' }).trim();
    expect(state.baseCommit).toBe(head);
  });

  it('state.loggingEnabled=true when enableLogging option passed', async () => {
    await startCommand('test task', { root: repo.path, enableLogging: true });
    const harnessDir = join(repo.path, '.harness');
    const runId = readFileSync(join(harnessDir, 'current-run'), 'utf-8').trim();
    const state = JSON.parse(readFileSync(join(harnessDir, runId, 'state.json'), 'utf-8'));
    expect(state.loggingEnabled).toBe(true);
  });

  it('state.loggingEnabled=false (default) when enableLogging not passed', async () => {
    await startCommand('test task', { root: repo.path });
    const harnessDir = join(repo.path, '.harness');
    const runId = readFileSync(join(harnessDir, 'current-run'), 'utf-8').trim();
    const state = JSON.parse(readFileSync(join(harnessDir, runId, 'state.json'), 'utf-8'));
    expect(state.loggingEnabled).toBe(false);
  });

  it('--light writes state.json with flow="light" and phases 2/3/4 skipped', async () => {
    await startCommand('dummy task', { light: true, root: repo.path });
    const harnessDir = join(repo.path, '.harness');
    const runId = readFileSync(join(harnessDir, 'current-run'), 'utf-8').trim();
    const state = JSON.parse(readFileSync(join(harnessDir, runId, 'state.json'), 'utf-8'));
    expect(state.flow).toBe('light');
    expect(state.phases['2']).toBe('skipped');
    expect(state.phases['3']).toBe('skipped');
    expect(state.phases['4']).toBe('skipped');
    expect(state.artifacts.plan).toBe('');
  });

  it('--light composes with --auto (ADR-8 orthogonality)', async () => {
    await startCommand('dummy task', { light: true, auto: true, root: repo.path });
    const harnessDir = join(repo.path, '.harness');
    const runId = readFileSync(join(harnessDir, 'current-run'), 'utf-8').trim();
    const state = JSON.parse(readFileSync(join(harnessDir, runId, 'state.json'), 'utf-8'));
    expect(state.flow).toBe('light');
    expect(state.autoMode).toBe(true);
  });

  it('state.codexNoIsolate=true AND stderr warning when --codex-no-isolate passed', async () => {
    await startCommand('test task', { root: repo.path, codexNoIsolate: true });
    const harnessDir = join(repo.path, '.harness');
    const runId = readFileSync(join(harnessDir, 'current-run'), 'utf-8').trim();
    const state = JSON.parse(readFileSync(join(harnessDir, runId, 'state.json'), 'utf-8'));
    expect(state.codexNoIsolate).toBe(true);
    const stderr = stderrSpy.mock.calls.map((c: any) => c[0]).join('');
    expect(stderr).toMatch(/CODEX_HOME isolation disabled/i);
    expect(stderr).toMatch(/BUG-C risk/);
  });

  it('state.codexNoIsolate=false (default) and no warning when flag omitted', async () => {
    await startCommand('test task', { root: repo.path });
    const harnessDir = join(repo.path, '.harness');
    const runId = readFileSync(join(harnessDir, 'current-run'), 'utf-8').trim();
    const state = JSON.parse(readFileSync(join(harnessDir, runId, 'state.json'), 'utf-8'));
    expect(state.codexNoIsolate).toBe(false);
    const stderr = stderrSpy.mock.calls.map((c: any) => c[0]).join('');
    expect(stderr).not.toMatch(/CODEX_HOME isolation disabled/i);
  });

  it('state.strictTree=true when --strict-tree passed', async () => {
    await startCommand('test task', { root: repo.path, strictTree: true });
    const harnessDir = join(repo.path, '.harness');
    const runId = readFileSync(join(harnessDir, 'current-run'), 'utf-8').trim();
    const state = JSON.parse(readFileSync(join(harnessDir, runId, 'state.json'), 'utf-8'));
    expect(state.strictTree).toBe(true);
  });

  it('state.strictTree=false (default) when --strict-tree omitted', async () => {
    await startCommand('test task', { root: repo.path });
    const harnessDir = join(repo.path, '.harness');
    const runId = readFileSync(join(harnessDir, 'current-run'), 'utf-8').trim();
    const state = JSON.parse(readFileSync(join(harnessDir, runId, 'state.json'), 'utf-8'));
    expect(state.strictTree).toBe(false);
  });
});
