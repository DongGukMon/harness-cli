import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('child_process', async (importActual) => {
  const actual = await importActual<typeof import('child_process')>();
  return { ...actual, execSync: vi.fn() };
});

vi.mock('../src/tmux.js', () => ({
  killSession: vi.fn(),
  killSessionOrThrow: vi.fn(),
}));

vi.mock('../src/lock.js', () => ({
  checkLockStatus: vi.fn(),
}));

import { execSync } from 'child_process';
import { killSessionOrThrow } from '../src/tmux.js';
import { checkLockStatus } from '../src/lock.js';
import { listHarnessSessions, classifyOrphans, cleanupOrphans } from '../src/orphan-cleanup.js';

describe('listHarnessSessions', () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReset();
  });

  it('returns harness-* session names only', () => {
    vi.mocked(execSync).mockReturnValue('harness-foo\nsome-other\nharness-bar\n' as any);
    const sessions = listHarnessSessions();
    expect(sessions).toEqual(['harness-foo', 'harness-bar']);
  });

  it('returns empty array when tmux server is not running', () => {
    const err = Object.assign(new Error('no server running'), { stderr: 'no server running on /tmp/tmux-1000/default' });
    vi.mocked(execSync).mockImplementation(() => { throw err; });
    const sessions = listHarnessSessions();
    expect(sessions).toEqual([]);
  });

  it('returns empty array when tmux has no sessions', () => {
    const err = Object.assign(new Error('no sessions'), { stderr: 'no sessions' });
    vi.mocked(execSync).mockImplementation(() => { throw err; });
    const sessions = listHarnessSessions();
    expect(sessions).toEqual([]);
  });

  it('propagates unexpected tmux errors', () => {
    const err = Object.assign(new Error('permission denied'), { stderr: 'permission denied: /tmp/tmux-socket' });
    vi.mocked(execSync).mockImplementation(() => { throw err; });
    expect(() => listHarnessSessions()).toThrow('permission denied');
  });

  it('returns empty array when no harness sessions exist in output', () => {
    vi.mocked(execSync).mockReturnValue('other-session\nanother-one\n' as any);
    const sessions = listHarnessSessions();
    expect(sessions).toEqual([]);
  });
});

describe('classifyOrphans', () => {
  let harnessDir: string;

  beforeEach(() => {
    harnessDir = mkdtempSync(join(tmpdir(), 'harness-classify-'));
    vi.mocked(checkLockStatus).mockReset();
  });

  afterEach(() => {
    rmSync(harnessDir, { recursive: true, force: true });
  });

  it('classifies session as unknown when run dir is missing', () => {
    const result = classifyOrphans(harnessDir, ['harness-2024-01-01-foo-abcd']);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('unknown');
    expect(result[0].reason).toBe('run-dir-missing');
  });

  it('classifies session as orphan with no-run-lock when run.lock is missing', () => {
    const runId = '2024-01-01-foo-abcd';
    mkdirSync(join(harnessDir, runId));
    // no run.lock created

    const result = classifyOrphans(harnessDir, [`harness-${runId}`]);
    expect(result[0].status).toBe('orphan');
    expect(result[0].reason).toBe('no-run-lock');
  });

  it('classifies session as orphan with no-repo-lock when repo.lock is missing', () => {
    const runId = '2024-01-01-foo-abcd';
    mkdirSync(join(harnessDir, runId));
    writeFileSync(join(harnessDir, runId, 'run.lock'), '');
    vi.mocked(checkLockStatus).mockReturnValue({ status: 'none' });

    const result = classifyOrphans(harnessDir, [`harness-${runId}`]);
    expect(result[0].status).toBe('orphan');
    expect(result[0].reason).toBe('no-repo-lock');
  });

  it('classifies session as orphan with repo-lock-stale when repo.lock is stale', () => {
    const runId = '2024-01-01-foo-abcd';
    mkdirSync(join(harnessDir, runId));
    writeFileSync(join(harnessDir, runId, 'run.lock'), '');
    vi.mocked(checkLockStatus).mockReturnValue({ status: 'stale' });

    const result = classifyOrphans(harnessDir, [`harness-${runId}`]);
    expect(result[0].status).toBe('orphan');
    expect(result[0].reason).toBe('repo-lock-stale');
  });

  it('classifies session as orphan with repo-lock-different-run when lock belongs to different run', () => {
    const runId = '2024-01-01-foo-abcd';
    mkdirSync(join(harnessDir, runId));
    writeFileSync(join(harnessDir, runId, 'run.lock'), '');
    vi.mocked(checkLockStatus).mockReturnValue({
      status: 'active',
      lock: { runId: '2024-01-01-other-1111', cliPid: 999, childPid: null, childPhase: null, startedAt: null, childStartedAt: null },
    });

    const result = classifyOrphans(harnessDir, [`harness-${runId}`]);
    expect(result[0].status).toBe('orphan');
    expect(result[0].reason).toBe('repo-lock-different-run');
  });

  it('classifies session as active when all locks check out', () => {
    const runId = '2024-01-01-foo-abcd';
    mkdirSync(join(harnessDir, runId));
    writeFileSync(join(harnessDir, runId, 'run.lock'), '');
    vi.mocked(checkLockStatus).mockReturnValue({
      status: 'active',
      lock: { runId, cliPid: 999, childPid: null, childPhase: null, startedAt: null, childStartedAt: null },
    });

    const result = classifyOrphans(harnessDir, [`harness-${runId}`]);
    expect(result[0].status).toBe('active');
    expect(result[0].reason).toBe('lock-active');
  });

  it('handles multiple sessions with mixed classifications', () => {
    const orphanId = '2024-01-01-orphan-1111';
    const unknownId = '2024-01-01-unknown-2222';

    mkdirSync(join(harnessDir, orphanId));
    // no run.lock for orphan

    vi.mocked(checkLockStatus).mockReturnValue({ status: 'none' });

    const result = classifyOrphans(harnessDir, [
      `harness-${orphanId}`,
      `harness-${unknownId}`,
    ]);

    const orphan = result.find((r) => r.runId === orphanId);
    const unknown = result.find((r) => r.runId === unknownId);
    expect(orphan?.status).toBe('orphan');
    expect(unknown?.status).toBe('unknown');
  });
});

describe('cleanupOrphans', () => {
  let harnessDir: string;

  beforeEach(() => {
    harnessDir = mkdtempSync(join(tmpdir(), 'harness-cleanup-'));
    vi.mocked(execSync).mockReset();
    vi.mocked(killSessionOrThrow).mockReset();
    vi.mocked(checkLockStatus).mockReset();
  });

  afterEach(() => {
    rmSync(harnessDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('dry-run: does not kill any sessions', async () => {
    const runId = '2024-01-01-foo-abcd';
    mkdirSync(join(harnessDir, runId));
    // no run.lock → orphan
    vi.mocked(execSync).mockReturnValue(`harness-${runId}\n` as any);

    await cleanupOrphans(harnessDir, { dryRun: true, yes: true, quiet: true });

    expect(vi.mocked(killSessionOrThrow)).not.toHaveBeenCalled();
  });

  it('quiet+yes: kills orphans without prompting', async () => {
    const runId = '2024-01-01-foo-abcd';
    mkdirSync(join(harnessDir, runId));
    // no run.lock → orphan
    vi.mocked(execSync).mockReturnValue(`harness-${runId}\n` as any);

    await cleanupOrphans(harnessDir, { yes: true, quiet: true });

    expect(vi.mocked(killSessionOrThrow)).toHaveBeenCalledWith(`harness-${runId}`);
  });

  it('does nothing when tmux server is not running (no server error)', async () => {
    const err = Object.assign(new Error('no server running'), { stderr: 'no server running on /tmp/tmux-1000/default' });
    vi.mocked(execSync).mockImplementation(() => { throw err; });

    await cleanupOrphans(harnessDir, { yes: true, quiet: true });

    expect(vi.mocked(killSessionOrThrow)).not.toHaveBeenCalled();
  });

  it('propagates unexpected tmux errors from listHarnessSessions', async () => {
    const err = Object.assign(new Error('permission denied'), { stderr: 'permission denied: /tmp/tmux-socket' });
    vi.mocked(execSync).mockImplementation(() => { throw err; });

    await expect(cleanupOrphans(harnessDir, { yes: true, quiet: true }))
      .rejects.toThrow('permission denied');
  });

  it('does not kill unknown sessions', async () => {
    // unknown = run dir missing
    vi.mocked(execSync).mockReturnValue('harness-2024-01-01-ghost-ffff\n' as any);

    await cleanupOrphans(harnessDir, { yes: true, quiet: true });

    expect(vi.mocked(killSessionOrThrow)).not.toHaveBeenCalled();
  });

  it('does not kill active sessions', async () => {
    const runId = '2024-01-01-active-aaaa';
    mkdirSync(join(harnessDir, runId));
    writeFileSync(join(harnessDir, runId, 'run.lock'), '');
    vi.mocked(execSync).mockReturnValue(`harness-${runId}\n` as any);
    vi.mocked(checkLockStatus).mockReturnValue({
      status: 'active',
      lock: { runId, cliPid: 999, childPid: null, childPhase: null, startedAt: null, childStartedAt: null },
    });

    await cleanupOrphans(harnessDir, { yes: true, quiet: true });

    expect(vi.mocked(killSessionOrThrow)).not.toHaveBeenCalled();
  });

  it('prints Killed: only when killSessionOrThrow succeeds', async () => {
    const runId = '2024-01-01-foo-abcd';
    mkdirSync(join(harnessDir, runId));
    // no run.lock → orphan
    vi.mocked(execSync).mockReturnValue(`harness-${runId}\n` as any);
    vi.mocked(killSessionOrThrow).mockImplementation(() => { /* success */ });

    const stdoutLines: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      stdoutLines.push(String(s));
      return true;
    });

    await cleanupOrphans(harnessDir, { yes: true });

    writeSpy.mockRestore();
    expect(stdoutLines.some((l) => l.includes(`Killed: harness-${runId}`))).toBe(true);
  });

  it('does not print Killed: when killSessionOrThrow fails', async () => {
    const runId = '2024-01-01-foo-abcd';
    mkdirSync(join(harnessDir, runId));
    // no run.lock → orphan
    vi.mocked(execSync).mockReturnValue(`harness-${runId}\n` as any);
    vi.mocked(killSessionOrThrow).mockImplementation(() => { throw new Error('session not found'); });

    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      stdoutLines.push(String(s));
      return true;
    });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((s) => {
      stderrLines.push(String(s));
      return true;
    });

    await cleanupOrphans(harnessDir, { yes: true });

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    expect(stdoutLines.some((l) => l.includes('Killed:'))).toBe(false);
    expect(stderrLines.some((l) => l.includes('Failed to kill'))).toBe(true);
  });
});
