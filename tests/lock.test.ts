import { describe, it, expect, afterEach, vi } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  acquireLock,
  releaseLock,
  updateLockChild,
  clearLockChild,
  readLock,
  checkLockStatus,
} from '../src/lock.js';
import type { LockData } from '../src/types.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lock-test-'));
}

const tmpDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
});

function makeHarnessDir(): string {
  const dir = makeTmpDir();
  tmpDirs.push(dir);
  return dir;
}

function repoLockPath(harnessDir: string): string {
  return path.join(harnessDir, 'repo.lock');
}

function runLockPath(harnessDir: string, runId: string): string {
  return path.join(harnessDir, runId, 'run.lock');
}

function writeLock(harnessDir: string, data: LockData): void {
  fs.writeFileSync(repoLockPath(harnessDir), JSON.stringify(data, null, 2));
}

/**
 * Get the current process's PGID (to use as a "live" childPid).
 */
function currentPgid(): number {
  const pgidStr = execSync(`ps -o pgid= -p ${process.pid}`, { encoding: 'utf8' }).trim();
  return parseInt(pgidStr, 10);
}

function canUsePs(): boolean {
  try {
    currentPgid();
    return true;
  } catch {
    return false;
  }
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('acquireLock', () => {
  // Test 1: Creates both lock files
  it('creates repo.lock + run.lock', () => {
    const harnessDir = makeHarnessDir();
    const runId = 'run-001';

    const data = acquireLock(harnessDir, runId);

    expect(fs.existsSync(repoLockPath(harnessDir))).toBe(true);
    expect(fs.existsSync(runLockPath(harnessDir, runId))).toBe(true);
    expect(data.cliPid).toBe(process.pid);
    expect(data.runId).toBe(runId);
    expect(data.childPid).toBeNull();
    expect(data.childPhase).toBeNull();
    expect(data.childStartedAt).toBeNull();
    // startedAt should be a reasonable epoch seconds (after 2000-01-01)
    expect(data.startedAt).not.toBeNull();
    expect(data.startedAt as number).toBeGreaterThan(946684800);
  });

  // Test 2: Fails with active lock (live process, matching startedAt)
  it('throws when lock is held by live process', () => {
    const harnessDir = makeHarnessDir();
    const runId = 'run-002';

    // Acquire once to get a real startedAt
    const first = acquireLock(harnessDir, runId);

    // Restore repo.lock with current PID (live) + matching startedAt
    writeLock(harnessDir, first);

    expect(() => acquireLock(harnessDir, 'run-002b')).toThrow('harness is already running');
  });

  // Test 3: Recovers stale lock (dead PID)
  it('recovers stale lock when cliPid is dead', () => {
    const harnessDir = makeHarnessDir();
    const deadRunId = 'run-dead';
    const newRunId = 'run-new';

    // Create the stored run.lock directory + file
    const deadRunDir = path.join(harnessDir, deadRunId);
    fs.mkdirSync(deadRunDir, { recursive: true });
    fs.writeFileSync(path.join(deadRunDir, 'run.lock'), '');

    // Write a stale lock with a dead PID
    const staleLock: LockData = {
      cliPid: 99999,
      childPid: null,
      childPhase: null,
      runId: deadRunId,
      startedAt: null,
      childStartedAt: null,
    };
    writeLock(harnessDir, staleLock);

    // Should recover stale lock and succeed
    const data = acquireLock(harnessDir, newRunId);
    expect(data.runId).toBe(newRunId);
    expect(data.cliPid).toBe(process.pid);

    // Old run.lock should have been deleted
    expect(fs.existsSync(path.join(deadRunDir, 'run.lock'))).toBe(false);
    // New run.lock should exist
    expect(fs.existsSync(runLockPath(harnessDir, newRunId))).toBe(true);
  });

  // Test 9: Stale cleanup targets correct run.lock from stored runId
  it('stale cleanup removes run.lock of stored runId, not new runId', () => {
    const harnessDir = makeHarnessDir();
    const staleRunId = 'run-stale';
    const newRunId = 'run-fresh';

    const staleRunDir = path.join(harnessDir, staleRunId);
    fs.mkdirSync(staleRunDir, { recursive: true });
    const staleRunLock = path.join(staleRunDir, 'run.lock');
    fs.writeFileSync(staleRunLock, '');

    const staleLock: LockData = {
      cliPid: 99999,
      childPid: null,
      childPhase: null,
      runId: staleRunId,
      startedAt: null,
      childStartedAt: null,
    };
    writeLock(harnessDir, staleLock);

    acquireLock(harnessDir, newRunId);

    // Stale runId's run.lock removed
    expect(fs.existsSync(staleRunLock)).toBe(false);
    // New runId's run.lock present
    expect(fs.existsSync(runLockPath(harnessDir, newRunId))).toBe(true);
  });

  // Test 11: cliPid alive + startedAt mismatch → stale (PID reuse)
  it('treats PID reuse (startedAt mismatch) as stale', () => {
    const harnessDir = makeHarnessDir();
    const staleRunId = 'run-pidreuse';
    const newRunId = 'run-after-reuse';

    const staleRunDir = path.join(harnessDir, staleRunId);
    fs.mkdirSync(staleRunDir, { recursive: true });
    fs.writeFileSync(path.join(staleRunDir, 'run.lock'), '');

    // Use current PID (alive) but with a clearly wrong startedAt (year 1970)
    const mismatchedLock: LockData = {
      cliPid: process.pid,
      childPid: null,
      childPhase: null,
      runId: staleRunId,
      startedAt: 1000, // epoch 1970 — wildly off from actual start
      childStartedAt: null,
    };
    writeLock(harnessDir, mismatchedLock);

    // Should treat as stale and recover
    const data = acquireLock(harnessDir, newRunId);
    expect(data.runId).toBe(newRunId);
  });

  // Test 12: cliPid alive + startedAt null → active
  it('treats cliPid alive + startedAt null as active', () => {
    const harnessDir = makeHarnessDir();

    const activeLock: LockData = {
      cliPid: process.pid,
      childPid: null,
      childPhase: null,
      runId: 'run-active',
      startedAt: null, // null → safe default → active
      childStartedAt: null,
    };
    writeLock(harnessDir, activeLock);

    expect(() => acquireLock(harnessDir, 'run-new')).toThrow('harness is already running');
  });

  // Test 13: childPid PGID alive → active (even if cliPid dead)
  (canUsePs() ? it : it.skip)('treats live childPid PGID as active even when cliPid is dead', () => {
    const harnessDir = makeHarnessDir();
    const pgid = currentPgid(); // alive PGID

    const lockWithDeadCli: LockData = {
      cliPid: 99999, // dead
      childPid: pgid, // alive PGID (current process group)
      childPhase: 3,
      runId: 'run-childlive',
      startedAt: null,
      childStartedAt: null,
    };
    writeLock(harnessDir, lockWithDeadCli);

    expect(() => acquireLock(harnessDir, 'run-new')).toThrow(
      '이전 서브프로세스 그룹이 아직 실행 중'
    );
  });

  // Test 10: Orphaned run.lock cleaned up (repo.lock absent)
  it('cleans up orphaned run.lock when repo.lock is absent', () => {
    const harnessDir = makeHarnessDir();
    const runId = 'run-orphan';

    // Create run.lock without repo.lock
    const runDir = path.join(harnessDir, runId);
    fs.mkdirSync(runDir, { recursive: true });
    const rlPath = path.join(runDir, 'run.lock');
    fs.writeFileSync(rlPath, '');

    // No repo.lock exists
    expect(fs.existsSync(repoLockPath(harnessDir))).toBe(false);
    expect(fs.existsSync(rlPath)).toBe(true);

    // acquireLock should clean orphan and succeed
    const data = acquireLock(harnessDir, runId);
    expect(data.runId).toBe(runId);
    // New run.lock should be created fresh
    expect(fs.existsSync(rlPath)).toBe(true);
  });

  // Test 8: repo.lock.tmp recovery (parse + liveness)
  it('recovers from repo.lock.tmp when repo.lock absent (dead PIDs)', () => {
    const harnessDir = makeHarnessDir();
    const tmpRunId = 'run-from-tmp';
    const newRunId = 'run-after-tmp';

    // Create the stored run.lock for the tmp run
    const tmpRunDir = path.join(harnessDir, tmpRunId);
    fs.mkdirSync(tmpRunDir, { recursive: true });
    fs.writeFileSync(path.join(tmpRunDir, 'run.lock'), '');

    // Write repo.lock.tmp with dead PIDs (no repo.lock)
    const tmpLock: LockData = {
      cliPid: 99999,
      childPid: null,
      childPhase: null,
      runId: tmpRunId,
      startedAt: null,
      childStartedAt: null,
    };
    const tmpPath = path.join(harnessDir, 'repo.lock.tmp');
    fs.writeFileSync(tmpPath, JSON.stringify(tmpLock, null, 2));

    // No repo.lock
    expect(fs.existsSync(repoLockPath(harnessDir))).toBe(false);

    const data = acquireLock(harnessDir, newRunId);
    expect(data.runId).toBe(newRunId);

    // .tmp cleaned up
    expect(fs.existsSync(tmpPath)).toBe(false);
    // Stored run.lock cleaned up
    expect(fs.existsSync(path.join(tmpRunDir, 'run.lock'))).toBe(false);
  });

  // Test 14: repo.lock.tmp unreadable → error
  it('throws when repo.lock.tmp is unreadable/corrupt', () => {
    const harnessDir = makeHarnessDir();
    const tmpPath = path.join(harnessDir, 'repo.lock.tmp');
    fs.writeFileSync(tmpPath, '{ not valid json :::');

    // No repo.lock
    expect(fs.existsSync(repoLockPath(harnessDir))).toBe(false);

    expect(() => acquireLock(harnessDir, 'run-new')).toThrow('repo.lock.tmp is unreadable.');
  });

  // Test 15: repo.lock parse failure → error
  it('throws when repo.lock is corrupt JSON', () => {
    const harnessDir = makeHarnessDir();
    fs.writeFileSync(repoLockPath(harnessDir), '{ bad json :::');

    expect(() => acquireLock(harnessDir, 'run-new')).toThrow(
      'repo.lock is corrupted. Manual recovery required.'
    );
  });
});

// Test 4: releaseLock
describe('releaseLock', () => {
  it('deletes both repo.lock and run.lock', () => {
    const harnessDir = makeHarnessDir();
    const runId = 'run-release';

    acquireLock(harnessDir, runId);
    expect(fs.existsSync(repoLockPath(harnessDir))).toBe(true);
    expect(fs.existsSync(runLockPath(harnessDir, runId))).toBe(true);

    releaseLock(harnessDir, runId);
    expect(fs.existsSync(repoLockPath(harnessDir))).toBe(false);
    expect(fs.existsSync(runLockPath(harnessDir, runId))).toBe(false);
  });

  it('is tolerant of missing files (no throw)', () => {
    const harnessDir = makeHarnessDir();
    // Neither file exists — should not throw
    expect(() => releaseLock(harnessDir, 'run-ghost')).not.toThrow();
  });
});

// Test 5: updateLockChild
describe('updateLockChild', () => {
  it('writes child fields via atomic rename', () => {
    const harnessDir = makeHarnessDir();
    const runId = 'run-update';

    acquireLock(harnessDir, runId);

    updateLockChild(harnessDir, 12345, 3, 1700000000);

    const lock = readLock(harnessDir);
    expect(lock).not.toBeNull();
    expect(lock!.childPid).toBe(12345);
    expect(lock!.childPhase).toBe(3);
    expect(lock!.childStartedAt).toBe(1700000000);

    // No .tmp left behind
    const tmpPath = path.join(harnessDir, 'repo.lock.tmp');
    expect(fs.existsSync(tmpPath)).toBe(false);
  });
});

// Test 6: clearLockChild
describe('clearLockChild', () => {
  it('nullifies child fields via atomic rename', () => {
    const harnessDir = makeHarnessDir();
    const runId = 'run-clear';

    acquireLock(harnessDir, runId);
    updateLockChild(harnessDir, 42, 5, 1700000001);

    clearLockChild(harnessDir);

    const lock = readLock(harnessDir);
    expect(lock).not.toBeNull();
    expect(lock!.childPid).toBeNull();
    expect(lock!.childPhase).toBeNull();
    expect(lock!.childStartedAt).toBeNull();

    // No .tmp left behind
    const tmpPath = path.join(harnessDir, 'repo.lock.tmp');
    expect(fs.existsSync(tmpPath)).toBe(false);
  });
});

// Test 7: readLock
describe('readLock', () => {
  it('parses repo.lock correctly', () => {
    const harnessDir = makeHarnessDir();
    const runId = 'run-read';

    acquireLock(harnessDir, runId);

    const lock = readLock(harnessDir);
    expect(lock).not.toBeNull();
    expect(lock!.runId).toBe(runId);
    expect(lock!.cliPid).toBe(process.pid);
    expect(lock!.childPid).toBeNull();
  });

  it('returns null when repo.lock is missing', () => {
    const harnessDir = makeHarnessDir();
    expect(readLock(harnessDir)).toBeNull();
  });
});

// checkLockStatus
describe('checkLockStatus', () => {
  it("returns 'none' when no repo.lock", () => {
    const harnessDir = makeHarnessDir();
    const result = checkLockStatus(harnessDir);
    expect(result.status).toBe('none');
    expect(result.lock).toBeUndefined();
  });

  it("returns 'active' for live lock", () => {
    const harnessDir = makeHarnessDir();
    const runId = 'run-status-active';

    acquireLock(harnessDir, runId);
    const result = checkLockStatus(harnessDir);
    expect(result.status).toBe('active');
    expect(result.lock).toBeDefined();
    expect(result.lock!.runId).toBe(runId);
  });

  it("returns 'stale' for dead-PID lock", () => {
    const harnessDir = makeHarnessDir();

    const staleLock: LockData = {
      cliPid: 99999,
      childPid: null,
      childPhase: null,
      runId: 'run-stale-status',
      startedAt: null,
      childStartedAt: null,
    };
    writeLock(harnessDir, staleLock);

    const result = checkLockStatus(harnessDir);
    expect(result.status).toBe('stale');
    expect(result.lock).toBeDefined();
  });
});
