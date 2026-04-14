import fs from 'fs';
import path from 'path';
import type { LockData } from './types.js';
import { getProcessStartTime, isPidAlive, isProcessGroupAlive } from './process.js';

const REPO_LOCK_FILE = 'repo.lock';
const REPO_LOCK_TMP_FILE = 'repo.lock.tmp';

function repoLockPath(harnessDir: string): string {
  return path.join(harnessDir, REPO_LOCK_FILE);
}

function repoLockTmpPath(harnessDir: string): string {
  return path.join(harnessDir, REPO_LOCK_TMP_FILE);
}

function runLockPath(harnessDir: string, runId: string): string {
  return path.join(harnessDir, runId, 'run.lock');
}

/**
 * Determine liveness of a lock: 'active' | 'stale'
 * Uses authoritative rules from spec:
 *  - cliPid alive + startedAt matches (±2s) → active
 *  - cliPid alive + startedAt mismatch     → PID reuse → stale
 *  - cliPid alive + startedAt null         → active (safe default)
 *  - cliPid dead + childPid null           → stale
 *  - cliPid dead + kill(-childPid, 0) ESRCH → stale
 *  - cliPid dead + kill(-childPid, 0) alive → active
 */
function assessLiveness(lock: LockData): 'active' | 'stale' {
  // Handoff check: if lock is in handoff state, check outerPid
  if (lock.handoff === true) {
    if (lock.outerPid !== undefined && isPidAlive(lock.outerPid)) {
      return 'active'; // Outer process is still alive, handoff in progress
    }
    // outerPid dead → abandoned handoff → stale
    return 'stale';
  }

  const cliAlive = isPidAlive(lock.cliPid);

  if (cliAlive) {
    if (lock.startedAt === null) {
      // Safe default: treat as active
      return 'active';
    }
    const actualStart = getProcessStartTime(lock.cliPid);
    if (actualStart !== null && Math.abs(lock.startedAt - actualStart) <= 2) {
      return 'active';
    }
    // Mismatch or can't read start time → PID reuse → stale
    return 'stale';
  }

  // cliPid dead → check childPid
  if (lock.childPid === null) {
    return 'stale';
  }

  if (isProcessGroupAlive(lock.childPid)) {
    return 'active';
  }

  return 'stale';
}

/**
 * Acquire repo.lock (O_EXCL) + run.lock.
 * Returns the LockData written.
 *
 * Pre-steps (before O_EXCL attempt):
 *   1. repo.lock.tmp recovery (if repo.lock absent + .tmp present)
 *   2. Orphaned run.lock cleanup (if repo.lock absent + run.lock for current runId present)
 *
 * On EEXIST:
 *   Read lock → assess liveness → stale: delete stored run.lock + repo.lock, retry once.
 *   Active → throw.
 */
export function acquireLock(harnessDir: string, runId: string): LockData {
  const lockPath = repoLockPath(harnessDir);
  const tmpPath = repoLockTmpPath(harnessDir);
  const myRunLockPath = runLockPath(harnessDir, runId);

  // Step 1: repo.lock.tmp recovery
  if (!fs.existsSync(lockPath) && fs.existsSync(tmpPath)) {
    let tmpLock: LockData;
    try {
      const raw = fs.readFileSync(tmpPath, 'utf-8');
      tmpLock = JSON.parse(raw) as LockData;
    } catch {
      throw new Error('repo.lock.tmp is unreadable.');
    }

    const liveness = assessLiveness(tmpLock);
    if (liveness === 'active') {
      throw new Error('harness is already running (recovered from repo.lock.tmp)');
    }

    // Stale: clean up .tmp and stored run.lock
    const storedRunLock = runLockPath(harnessDir, tmpLock.runId);
    try { fs.unlinkSync(storedRunLock); } catch { /* ignore */ }
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }

  // Step 2: Orphaned run.lock cleanup (if repo.lock absent)
  if (!fs.existsSync(lockPath) && fs.existsSync(myRunLockPath)) {
    try { fs.unlinkSync(myRunLockPath); } catch { /* ignore */ }
  }

  // Step 3: Try O_EXCL
  let fd: number;
  try {
    fd = fs.openSync(lockPath, 'wx');
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code !== 'EEXIST') throw err;

    // Step 4: Lock exists — read and assess
    let existingLock: LockData;
    try {
      const raw = fs.readFileSync(lockPath, 'utf-8');
      existingLock = JSON.parse(raw) as LockData;
    } catch {
      throw new Error('repo.lock is corrupted. Manual recovery required.');
    }

    const liveness = assessLiveness(existingLock);
    if (liveness === 'active') {
      if (!isPidAlive(existingLock.cliPid) && existingLock.childPid !== null) {
        throw new Error('이전 서브프로세스 그룹이 아직 실행 중');
      }
      throw new Error('harness is already running');
    }

    // Stale: delete stored run.lock + repo.lock, then retry once
    const storedRunLock = runLockPath(harnessDir, existingLock.runId);
    try { fs.unlinkSync(storedRunLock); } catch { /* ignore */ }
    try { fs.unlinkSync(lockPath); } catch { /* ignore */ }

    // Retry once
    try {
      fd = fs.openSync(lockPath, 'wx');
    } catch (retryErr: unknown) {
      throw retryErr;
    }
  }

  // Write LockData through the fd
  const lockData: LockData = {
    cliPid: process.pid,
    childPid: null,
    childPhase: null,
    runId,
    startedAt: getProcessStartTime(process.pid),
    childStartedAt: null,
  };

  const json = JSON.stringify(lockData, null, 2);
  fs.writeSync(fd, json);
  fs.fsyncSync(fd);
  fs.closeSync(fd);

  // Create run.lock (empty marker file)
  const runDir = path.join(harnessDir, runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(myRunLockPath, '');

  return lockData;
}

/**
 * Release both lock files. Tolerant of missing files.
 */
export function releaseLock(harnessDir: string, runId: string): void {
  const lockPath = repoLockPath(harnessDir);
  const rlPath = runLockPath(harnessDir, runId);

  try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
  try { fs.unlinkSync(rlPath); } catch { /* ignore */ }
}

/**
 * Update childPid/childPhase/childStartedAt in repo.lock via atomic rename.
 */
export function updateLockChild(
  harnessDir: string,
  childPid: number,
  childPhase: number,
  childStartedAt: number | null
): void {
  const lockPath = repoLockPath(harnessDir);
  const tmpPath = repoLockTmpPath(harnessDir);

  const raw = fs.readFileSync(lockPath, 'utf-8');
  const lock = JSON.parse(raw) as LockData;

  lock.childPid = childPid;
  lock.childPhase = childPhase;
  lock.childStartedAt = childStartedAt;

  fs.writeFileSync(tmpPath, JSON.stringify(lock, null, 2));

  const fd = fs.openSync(tmpPath, 'r+');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  fs.renameSync(tmpPath, lockPath);
}

/**
 * Clear child fields (set to null) via atomic rename.
 */
export function clearLockChild(harnessDir: string): void {
  const lockPath = repoLockPath(harnessDir);
  const tmpPath = repoLockTmpPath(harnessDir);

  const raw = fs.readFileSync(lockPath, 'utf-8');
  const lock = JSON.parse(raw) as LockData;

  lock.childPid = null;
  lock.childPhase = null;
  lock.childStartedAt = null;

  fs.writeFileSync(tmpPath, JSON.stringify(lock, null, 2));

  const fd = fs.openSync(tmpPath, 'r+');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  fs.renameSync(tmpPath, lockPath);
}

/**
 * Update cliPid and clear handoff flag. Used by __inner to claim lock ownership.
 */
export function updateLockPid(harnessDir: string, newPid: number): void {
  const lockPath = repoLockPath(harnessDir);
  const tmpPath = repoLockTmpPath(harnessDir);

  const raw = fs.readFileSync(lockPath, 'utf-8');
  const lock = JSON.parse(raw) as LockData;

  lock.cliPid = newPid;
  lock.startedAt = getProcessStartTime(newPid);
  lock.handoff = false;
  lock.outerPid = undefined;

  fs.writeFileSync(tmpPath, JSON.stringify(lock, null, 2));
  const fd = fs.openSync(tmpPath, 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmpPath, lockPath);
}

/**
 * Set handoff state in lock. Used by outer before spawning __inner.
 */
export function setLockHandoff(harnessDir: string, outerPid: number, tmuxSession: string): void {
  const lockPath = repoLockPath(harnessDir);
  const tmpPath = repoLockTmpPath(harnessDir);

  const raw = fs.readFileSync(lockPath, 'utf-8');
  const lock = JSON.parse(raw) as LockData;

  lock.handoff = true;
  lock.outerPid = outerPid;
  lock.tmuxSession = tmuxSession;

  fs.writeFileSync(tmpPath, JSON.stringify(lock, null, 2));
  const fd = fs.openSync(tmpPath, 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmpPath, lockPath);
}

/**
 * Poll until lock's handoff flag changes to false (handoff completed).
 * Returns true if handoff completed, false on timeout.
 */
export function pollForHandoffComplete(harnessDir: string, timeoutMs: number): boolean {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const lock = readLock(harnessDir);
    if (lock && lock.handoff === false) {
      return true;
    }
    // Busy-wait 200ms
    const waitUntil = Date.now() + 200;
    while (Date.now() < waitUntil) { /* spin */ }
  }
  return false;
}

/**
 * Read and parse repo.lock. Returns null if missing.
 */
export function readLock(harnessDir: string): LockData | null {
  const lockPath = repoLockPath(harnessDir);

  if (!fs.existsSync(lockPath)) {
    return null;
  }

  const raw = fs.readFileSync(lockPath, 'utf-8');
  return JSON.parse(raw) as LockData;
}

/**
 * Check lock status: 'none' | 'stale' | 'active'
 * Read-only — no side effects.
 */
export function checkLockStatus(
  harnessDir: string
): { status: 'none' | 'stale' | 'active'; lock?: LockData } {
  const lockPath = repoLockPath(harnessDir);

  if (!fs.existsSync(lockPath)) {
    return { status: 'none' };
  }

  let lock: LockData;
  try {
    const raw = fs.readFileSync(lockPath, 'utf-8');
    lock = JSON.parse(raw) as LockData;
  } catch {
    // Treat corrupted lock as stale for status checking
    return { status: 'stale' };
  }

  const liveness = assessLiveness(lock);
  return { status: liveness, lock };
}
