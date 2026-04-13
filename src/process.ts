import { execSync } from 'child_process';
import { readFileSync } from 'fs';

/**
 * Get process start time in epoch seconds.
 * Returns null if process doesn't exist or can't be read.
 * macOS: uses `ps -o lstart= -p <pid>`
 * Linux: reads /proc/<pid>/stat field 22 + /proc/stat btime
 */
export function getProcessStartTime(pid: number): number | null {
  try {
    if (process.platform === 'darwin') {
      const output = execSync(`ps -o lstart= -p ${pid}`, { encoding: 'utf8' });
      const trimmed = output.trim();
      if (!trimmed) return null;
      const date = new Date(trimmed);
      if (isNaN(date.getTime())) return null;
      return Math.floor(date.getTime() / 1000);
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

      const clockTicksPerSec = 100; // typically HZ=100 on Linux
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
