import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { statusCommand } from '../../src/commands/status.js';
import { listCommand } from '../../src/commands/list.js';
import { createTestRepo } from '../helpers/test-repo.js';
import { createInitialState, writeState } from '../../src/state.js';
import { setCurrentRun } from '../../src/root.js';

function makeRunState(harnessDir: string, runId: string, overrides: Partial<Record<string, unknown>> = {}) {
  const runDir = join(harnessDir, runId);
  mkdirSync(runDir, { recursive: true });
  const state = createInitialState(runId, 'test task', 'abc123', '/fake/codex', false);
  Object.assign(state, overrides);
  writeState(runDir, state);
  return state;
}

describe('statusCommand', () => {
  let repo: { path: string; cleanup: () => void };
  let exitSpy: any;
  let stdoutSpy: any;
  let stderrSpy: any;
  let exitCode: number | undefined;

  beforeEach(() => {
    repo = createTestRepo();
    exitCode = undefined;
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCode = code;
      throw new Error(`__exit__:${code}`);
    }) as never);
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    repo.cleanup();
  });

  it('prints status for current run', async () => {
    const harnessDir = join(repo.path, '.harness');
    mkdirSync(harnessDir, { recursive: true });
    makeRunState(harnessDir, '2026-04-12-test');
    setCurrentRun(harnessDir, '2026-04-12-test');

    await statusCommand({ root: repo.path });

    const output = stdoutSpy.mock.calls.map((c: any) => c[0]).join('');
    expect(output).toContain('2026-04-12-test');
    expect(output).toContain('Phase 1: pending');
  });

  it('errors when no current-run pointer', async () => {
    const harnessDir = join(repo.path, '.harness');
    mkdirSync(harnessDir, { recursive: true });

    await expect(statusCommand({ root: repo.path })).rejects.toThrow('__exit__');
    expect(exitCode).toBe(1);
    const err = stderrSpy.mock.calls.map((c: any) => c[0]).join('');
    expect(err).toContain('No active run');
  });

  it('errors when state.json missing', async () => {
    const harnessDir = join(repo.path, '.harness');
    mkdirSync(join(harnessDir, '2026-04-12-missing'), { recursive: true });
    setCurrentRun(harnessDir, '2026-04-12-missing');

    await expect(statusCommand({ root: repo.path })).rejects.toThrow('__exit__');
    expect(exitCode).toBe(1);
    const err = stderrSpy.mock.calls.map((c: any) => c[0]).join('');
    expect(err).toContain('Manual recovery');
  });
});

describe('listCommand', () => {
  let repo: { path: string; cleanup: () => void };
  let stdoutSpy: any;

  beforeEach(() => {
    repo = createTestRepo();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    repo.cleanup();
  });

  it('shows all runs', async () => {
    const harnessDir = join(repo.path, '.harness');
    mkdirSync(harnessDir, { recursive: true });
    makeRunState(harnessDir, '2026-04-12-alpha');
    makeRunState(harnessDir, '2026-04-11-beta');

    await listCommand({ root: repo.path });

    const output = stdoutSpy.mock.calls.map((c: any) => c[0]).join('');
    expect(output).toContain('2026-04-12-alpha');
    expect(output).toContain('2026-04-11-beta');
  });

  it('prints empty message when no runs', async () => {
    const harnessDir = join(repo.path, '.harness');
    mkdirSync(harnessDir, { recursive: true });

    await listCommand({ root: repo.path });

    const output = stdoutSpy.mock.calls.map((c: any) => c[0]).join('');
    expect(output).toContain('No runs found');
  });

  it('handles missing .harness/ gracefully', async () => {
    await listCommand({ root: repo.path });

    const output = stdoutSpy.mock.calls.map((c: any) => c[0]).join('');
    expect(output).toContain('No runs found');
  });

  it('sorts runs by runId descending', async () => {
    const harnessDir = join(repo.path, '.harness');
    mkdirSync(harnessDir, { recursive: true });
    makeRunState(harnessDir, '2026-04-01-old');
    makeRunState(harnessDir, '2026-04-12-new');

    await listCommand({ root: repo.path });

    const output = stdoutSpy.mock.calls.map((c: any) => c[0]).join('');
    const newIdx = output.indexOf('2026-04-12-new');
    const oldIdx = output.indexOf('2026-04-01-old');
    expect(newIdx).toBeLessThan(oldIdx);
    expect(newIdx).toBeGreaterThan(-1);
  });
});
