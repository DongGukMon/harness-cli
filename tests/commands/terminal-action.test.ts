import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'child_process';
import { mkdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createTestRepo } from '../helpers/test-repo.js';
import { terminalActionCommand } from '../../src/commands/terminal-action.js';
import { createInitialState, writeState } from '../../src/state.js';
import { setCurrentRun } from '../../src/root.js';

vi.mock('../../src/lock.js', () => ({
  readLock: vi.fn(() => null),
}));

vi.mock('../../src/process.js', () => ({
  isPidAlive: vi.fn(() => false),
}));

function setupRun(repo: { path: string }, options: Partial<Record<string, unknown>> = {}): {
  harnessDir: string;
  runId: string;
  runDir: string;
} {
  const harnessDir = join(repo.path, '.harness');
  const runId = '2026-04-12-test';
  const runDir = join(harnessDir, runId);
  mkdirSync(runDir, { recursive: true });

  const baseCommit = execSync('git rev-parse HEAD', { cwd: repo.path, encoding: 'utf-8' }).trim();
  const state = createInitialState(runId, 'test task', baseCommit, false);
  // Terminal-failed state: status = in_progress, at least one phase is 'failed'.
  state.status = 'in_progress';
  state.phases['5'] = 'failed';
  state.currentPhase = 5;
  Object.assign(state, options);
  writeState(runDir, state);
  setCurrentRun(harnessDir, runId);

  return { harnessDir, runId, runDir };
}

describe('terminalActionCommand', () => {
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

  describe('valid tokens write the action file', () => {
    it('R writes "R" to terminal-action.requested', async () => {
      const { runDir, runId } = setupRun(repo);
      await terminalActionCommand(runId, 'R', { root: repo.path });
      const p = join(runDir, 'terminal-action.requested');
      expect(existsSync(p)).toBe(true);
      expect(readFileSync(p, 'utf-8')).toBe('R');
    });

    it('Q writes "Q" to terminal-action.requested', async () => {
      const { runDir, runId } = setupRun(repo);
      await terminalActionCommand(runId, 'Q', { root: repo.path });
      const p = join(runDir, 'terminal-action.requested');
      expect(existsSync(p)).toBe(true);
      expect(readFileSync(p, 'utf-8')).toBe('Q');
    });

    it('J:3 writes "J:3" to terminal-action.requested', async () => {
      const { runDir, runId } = setupRun(repo);
      await terminalActionCommand(runId, 'J:3', { root: repo.path });
      const p = join(runDir, 'terminal-action.requested');
      expect(existsSync(p)).toBe(true);
      expect(readFileSync(p, 'utf-8')).toBe('J:3');
    });

    it('lowercase tokens are accepted and normalized to upper-case body', async () => {
      const { runDir, runId } = setupRun(repo);
      await terminalActionCommand(runId, 'r', { root: repo.path });
      expect(readFileSync(join(runDir, 'terminal-action.requested'), 'utf-8')).toBe('R');
    });
  });

  describe('invalid tokens are rejected', () => {
    it('unknown letter token X rejected', async () => {
      const { runId } = setupRun(repo);
      await expect(terminalActionCommand(runId, 'X', { root: repo.path })).rejects.toThrow('__exit__');
      const msgs = stderrSpy.mock.calls.map((c: any) => c[0]).join('');
      expect(msgs).toMatch(/invalid action/i);
    });

    it('J without phase number rejected', async () => {
      const { runId } = setupRun(repo);
      await expect(terminalActionCommand(runId, 'J', { root: repo.path })).rejects.toThrow('__exit__');
    });

    it('J:abc rejected (non-numeric phase)', async () => {
      const { runId } = setupRun(repo);
      await expect(terminalActionCommand(runId, 'J:abc', { root: repo.path })).rejects.toThrow('__exit__');
    });

    it('J:8 rejected (out of phase range 1-7)', async () => {
      const { runId } = setupRun(repo);
      await expect(terminalActionCommand(runId, 'J:8', { root: repo.path })).rejects.toThrow('__exit__');
    });

    it('J:0 rejected (out of phase range)', async () => {
      const { runId } = setupRun(repo);
      await expect(terminalActionCommand(runId, 'J:0', { root: repo.path })).rejects.toThrow('__exit__');
    });

    it('empty string rejected', async () => {
      const { runId } = setupRun(repo);
      await expect(terminalActionCommand(runId, '', { root: repo.path })).rejects.toThrow('__exit__');
    });
  });

  describe('runId resolution', () => {
    it('unknown runId rejected', async () => {
      setupRun(repo); // creates current-run pointer at the test runId
      await expect(
        terminalActionCommand('does-not-exist', 'R', { root: repo.path })
      ).rejects.toThrow('__exit__');
      const msgs = stderrSpy.mock.calls.map((c: any) => c[0]).join('');
      expect(msgs).toMatch(/does-not-exist|not found|no state/i);
    });

    it('runId may be omitted at the function level — falls back to current-run pointer', async () => {
      // The CLI wrapper requires runId, but the underlying function uses
      // `resolveRunId` so direct callers (and future flag changes) can fall
      // back to the current-run pointer.
      const { runDir } = setupRun(repo);
      await terminalActionCommand(undefined, 'R', { root: repo.path });
      expect(existsSync(join(runDir, 'terminal-action.requested'))).toBe(true);
    });
  });

  describe('run-state guard', () => {
    it('rejects when no phase is failed (not in terminal-failed)', async () => {
      // Override the default: setupRun sets phase 5 to 'failed'. Reset to pending.
      const { runDir, runId } = setupRun(repo);
      const baseCommit = execSync('git rev-parse HEAD', { cwd: repo.path, encoding: 'utf-8' }).trim();
      const state = createInitialState(runId, 'test task', baseCommit, false);
      state.status = 'in_progress';
      // No phase set to 'failed' — run is mid-execution, not paused at terminal-failed.
      writeState(runDir, state);

      await expect(
        terminalActionCommand(runId, 'R', { root: repo.path })
      ).rejects.toThrow('__exit__');
      const msgs = stderrSpy.mock.calls.map((c: any) => c[0]).join('');
      expect(msgs).toMatch(/terminal-failed|not.*ready|no failed phase|status/i);
    });

    it('rejects when run is completed', async () => {
      const { runId, runDir } = setupRun(repo);
      // Reset to a clean completed state — drop the synthetic failed phase
      // setupRun() injected so the only signal the guard reads is `status`.
      const baseCommit = execSync('git rev-parse HEAD', { cwd: repo.path, encoding: 'utf-8' }).trim();
      const state = createInitialState(runId, 'test task', baseCommit, false);
      state.status = 'completed';
      writeState(runDir, state);
      await expect(
        terminalActionCommand(runId, 'R', { root: repo.path })
      ).rejects.toThrow('__exit__');
    });
  });
});
