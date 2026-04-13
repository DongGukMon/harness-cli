import { execSync } from 'child_process';
import { readFileSync } from 'fs';

/**
 * Parse `ps -o etime` output to seconds.
 * Format: [[dd-]hh:]mm:ss (e.g. "01:23", "12:34:56", "2-00:00:00")
 */
function parseEtime(s: string): number | null {
  // Match optional days, optional hours, mandatory mm:ss
  const match = s.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!match) return null;
  const days = match[1] ? parseInt(match[1], 10) : 0;
  const hours = match[2] ? parseInt(match[2], 10) : 0;
  const mins = parseInt(match[3], 10);
  const secs = parseInt(match[4], 10);
  if ([days, hours, mins, secs].some((v) => isNaN(v))) return null;
  return days * 86400 + hours * 3600 + mins * 60 + secs;
}

/** Cached CLK_TCK value from `getconf CLK_TCK`. Falls back to 100 if unavailable. */
let cachedClockTicksPerSec: number | null = null;
function getClockTicksPerSec(): number {
  if (cachedClockTicksPerSec !== null) return cachedClockTicksPerSec;
  try {
    const out = execSync('getconf CLK_TCK', { encoding: 'utf8' }).trim();
    const val = parseInt(out, 10);
    cachedClockTicksPerSec = isNaN(val) || val <= 0 ? 100 : val;
  } catch {
    cachedClockTicksPerSec = 100;
  }
  return cachedClockTicksPerSec;
}

/**
 * Get process start time in epoch seconds.
 * Returns null if process doesn't exist or can't be read.
 * macOS: uses `ps -o etimes= -p <pid>` (elapsed seconds, per spec)
 * Linux: reads /proc/<pid>/stat field 22 + /proc/stat btime + dynamic CLK_TCK
 */
export function getProcessStartTime(pid: number): number | null {
  try {
    if (process.platform === 'darwin') {
      // macOS: use `ps -o etime=` (elapsed time in [[dd-]hh:]mm:ss format — etimes unsupported)
      const output = execSync(`ps -o etime= -p ${pid}`, { encoding: 'utf8' });
      const trimmed = output.trim();
      if (!trimmed) return null;
      const elapsedSec = parseEtime(trimmed);
      if (elapsedSec === null) return null;
      const nowSec = Math.floor(Date.now() / 1000);
      return nowSec - elapsedSec;
    } else {
      // Linux: read /proc/<pid>/stat field 22 (starttime in clock ticks since boot)
      // and /proc/stat btime (boot time in epoch seconds)
      const statContent = readFileSync(`/proc/${pid}/stat`, 'utf8');
      // Field 22 is starttime; fields are space-separated but field 2 (comm) can contain spaces
      // comm is wrapped in parens, so we strip it first
      const commEnd = statContent.lastIndexOf(')');
      if (commEnd === -1) return null;
      const rest = statContent.slice(commEnd + 2); // skip ') '
      const fields = rest.split(' ');
      // Field 22 is index 19 in the remaining fields (after comm), 0-indexed from field 3
      const startTimeTicks = parseInt(fields[19], 10);
      if (isNaN(startTimeTicks)) return null;

      const procStat = readFileSync('/proc/stat', 'utf8');
      const btimeLine = procStat.split('\n').find(line => line.startsWith('btime '));
      if (!btimeLine) return null;
      const btime = parseInt(btimeLine.split(' ')[1], 10);
      if (isNaN(btime)) return null;

      const clockTicksPerSec = getClockTicksPerSec();
      return btime + Math.floor(startTimeTicks / clockTicksPerSec);
    }
  } catch {
    return null;
  }
}

/**
 * Check if a process group is alive. Uses kill(-pgid, 0).
 * Returns true if any process in the group is alive.
 */
export function isProcessGroupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a single PID is alive. Uses kill(pid, 0).
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill an entire process group: SIGTERM → wait → SIGKILL if still alive.
 * Returns when group is confirmed dead (ESRCH).
 */
export async function killProcessGroup(pgid: number, waitMs = 5000): Promise<void> {
  // Send SIGTERM; ignore errors if already dead
  try {
    process.kill(-pgid, 'SIGTERM');
  } catch {
    // Group may already be dead
  }

  // Wait up to waitMs for graceful exit
  const startTime = Date.now();
  while (isProcessGroupAlive(pgid)) {
    if (Date.now() - startTime >= waitMs) break;
    await new Promise<void>(resolve => setTimeout(resolve, 100));
  }

  // If still alive, send SIGKILL
  if (isProcessGroupAlive(pgid)) {
    try {
      process.kill(-pgid, 'SIGKILL');
    } catch {
      // Group may already be dead
    }

    // Wait for ESRCH confirmation
    while (isProcessGroupAlive(pgid)) {
      await new Promise<void>(resolve => setTimeout(resolve, 100));
    }
  }
}

/**
 * Wait for a process group to drain (all processes exit).
 * Returns true if drained within timeout, false if still alive.
 */
export async function waitForGroupDrain(pgid: number, timeoutMs: number): Promise<boolean> {
  const startTime = Date.now();
  while (isProcessGroupAlive(pgid)) {
    if (Date.now() - startTime >= timeoutMs) return false;
    await new Promise<void>(resolve => setTimeout(resolve, 100));
  }
  return true;
}
