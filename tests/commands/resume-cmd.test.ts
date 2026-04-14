import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createTestRepo } from '../helpers/test-repo.js';
import { resumeCommand } from '../../src/commands/resume.js';
import { createInitialState, writeState } from '../../src/state.js';
import { setCurrentRun } from '../../src/root.js';

vi.mock('../../src/preflight.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/preflight.js')>('../../src/preflight.js');
  return {
    ...actual,
    runPreflight: vi.fn(() => ({})),
    resolveCodexPath: vi.fn(() => '/fake/codex'),
  };
});

vi.mock('../../src/tmux.js', () => ({
  sessionExists: vi.fn(() => false),
  isInsideTmux: vi.fn(() => false),
  getCurrentSessionName: vi.fn(() => null),
  getActiveWindowId: vi.fn(() => null),
  createSession: vi.fn(),
  createWindow: vi.fn(() => '@0'),
  sendKeys: vi.fn(),
  killSession: vi.fn(),
  selectWindow: vi.fn(),
}));

vi.mock('../../src/terminal.js', () => ({
  openTerminalWindow: vi.fn(() => true),
}));

vi.mock('../../src/lock.js', () => ({
  acquireLock: vi.fn(() => ({})),
  readLock: vi.fn(() => null),
  releaseLock: vi.fn(),
  setLockHandoff: vi.fn(),
  pollForHandoffComplete: vi.fn(() => true),
}));

vi.mock('../../src/process.js', () => ({
  isPidAlive: vi.fn(() => false),
}));

vi.mock('../../src/ui.js', () => ({
  printError: vi.fn(),
}));

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

  it('resumes with explicit runId (Case 3: no session)', async () => {
    setupRun(repo);
    const { sessionExists } = await import('../../src/tmux.js');
    const { createSession, sendKeys } = await import('../../src/tmux.js');
    vi.mocked(sessionExists).mockReturnValue(false);

    await resumeCommand('2026-04-12-test', { root: repo.path });

    expect(vi.mocked(createSession)).toHaveBeenCalled();
    expect(vi.mocked(sendKeys)).toHaveBeenCalledWith(
      expect.any(String), '0', expect.stringContaining('__inner')
    );
  });

  it('resumes with implicit current-run (Case 3: no session)', async () => {
    const { harnessDir, runId } = setupRun(repo);
    setCurrentRun(harnessDir, runId);

    await resumeCommand(undefined, { root: repo.path });
  });

  it('Case 1: session + inner alive → re-attach only', async () => {
    const { harnessDir, runId } = setupRun(repo, { tmuxSession: 'harness-test' });
    setCurrentRun(harnessDir, runId);

    const tmux = await import('../../src/tmux.js');
    const terminal = await import('../../src/terminal.js');
    const lock = await import('../../src/lock.js');
    const proc = await import('../../src/process.js');

    // Clear all mocks from previous tests
    vi.mocked(tmux.createSession).mockClear();
    vi.mocked(tmux.sendKeys).mockClear();
    vi.mocked(terminal.openTerminalWindow).mockClear();

    vi.mocked(tmux.sessionExists).mockReturnValue(true);
    vi.mocked(lock.readLock).mockReturnValue({ cliPid: 999, handoff: false, childPid: null, childPhase: null, runId, startedAt: null, childStartedAt: null });
    vi.mocked(proc.isPidAlive).mockReturnValue(true);

    await resumeCommand(undefined, { root: repo.path });

    expect(vi.mocked(terminal.openTerminalWindow)).toHaveBeenCalledWith('harness-test');
    expect(vi.mocked(tmux.createSession)).not.toHaveBeenCalled();
    expect(vi.mocked(tmux.sendKeys)).not.toHaveBeenCalled();
  });

  it('Case 2: session alive + inner dead → restart inner', async () => {
    const { harnessDir, runId } = setupRun(repo, { tmuxSession: 'harness-test', tmuxControlWindow: '@0' });
    setCurrentRun(harnessDir, runId);

    const tmux = await import('../../src/tmux.js');
    const terminal = await import('../../src/terminal.js');
    const lock = await import('../../src/lock.js');
    const proc = await import('../../src/process.js');

    // Clear all mocks from previous tests
    vi.mocked(tmux.createSession).mockClear();
    vi.mocked(tmux.sendKeys).mockClear();
    vi.mocked(terminal.openTerminalWindow).mockClear();
    vi.mocked(lock.setLockHandoff).mockClear();
    vi.mocked(lock.pollForHandoffComplete).mockClear();

    vi.mocked(tmux.sessionExists).mockReturnValue(true);
    vi.mocked(lock.readLock).mockReturnValue({ cliPid: 999, handoff: false, childPid: null, childPhase: null, runId, startedAt: null, childStartedAt: null });
    vi.mocked(proc.isPidAlive).mockReturnValue(false);
    vi.mocked(lock.pollForHandoffComplete).mockReturnValue(true);

    await resumeCommand(undefined, { root: repo.path });

    expect(vi.mocked(lock.setLockHandoff)).toHaveBeenCalled();
    expect(vi.mocked(tmux.sendKeys)).toHaveBeenCalledWith('harness-test', '@0', expect.stringContaining('__inner'));
    expect(vi.mocked(lock.pollForHandoffComplete)).toHaveBeenCalled();
    expect(vi.mocked(terminal.openTerminalWindow)).toHaveBeenCalledWith('harness-test');
    expect(vi.mocked(tmux.createSession)).not.toHaveBeenCalled();
  });
});
