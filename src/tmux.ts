import { execSync } from 'child_process';

/**
 * Create a detached tmux session.
 * Throws if tmux is not available or session name already exists.
 */
export function createSession(name: string, cwd: string): void {
  execSync(`tmux new-session -d -s ${esc(name)} -c ${esc(cwd)}`, { stdio: 'pipe' });
  // Enable mouse support (scroll, click, resize)
  execSync(`tmux set-option -t ${esc(name)} mouse on`, { stdio: 'pipe' });
}

/**
 * Check if a tmux session exists.
 */
export function sessionExists(name: string): boolean {
  try {
    execSync(`tmux has-session -t ${esc(name)}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a new window in an existing session with a command.
 * Returns the tmux window ID (e.g., "@1").
 */
export function createWindow(session: string, windowName: string, command: string): string {
  const cmdPart = command ? ` ${esc(command)}` : '';
  const output = execSync(
    `tmux new-window -t ${esc(session)} -n ${esc(windowName)} -P -F '#{window_id}'${cmdPart}`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
  return output.trim();
}

/**
 * Select (focus) a window by name or ID.
 */
export function selectWindow(session: string, windowTarget: string): void {
  try {
    execSync(`tmux select-window -t ${escTarget(session, windowTarget)}`, { stdio: 'pipe' });
  } catch {
    // Window may already be gone — best-effort
  }
}

/**
 * Kill a window by name or ID.
 */
export function killWindow(session: string, windowTarget: string): void {
  try {
    execSync(`tmux kill-window -t ${escTarget(session, windowTarget)}`, { stdio: 'pipe' });
  } catch {
    // Window may already be gone — best-effort
  }
}

/**
 * Kill an entire tmux session.
 */
export function killSession(name: string): void {
  try {
    execSync(`tmux kill-session -t ${esc(name)}`, { stdio: 'pipe' });
  } catch {
    // Session may already be gone
  }
}

/**
 * Send keys to a window (types the text + presses Enter).
 */
export function sendKeys(session: string, windowTarget: string, keys: string): void {
  execSync(`tmux send-keys -t ${escTarget(session, windowTarget)} ${esc(keys)} Enter`, {
    stdio: 'pipe',
  });
}

/**
 * Split a pane horizontally or vertically. Returns the new pane ID (e.g., "%5").
 */
export function splitPane(
  _session: string,
  targetPane: string,
  direction: 'h' | 'v',
  percent: number
): string {
  // Pane IDs (%N) are globally unique in tmux — target directly, no session prefix needed
  const flag = direction === 'h' ? '-h' : '-v';
  const output = execSync(
    `tmux split-window -t ${escSmart(targetPane)} ${flag} -p ${percent} -P -F '#{pane_id}'`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
  return output.trim();
}

/**
 * Send keys to a specific pane.
 * Special: if keys is 'C-c', sends Ctrl-C without Enter.
 */
export function sendKeysToPane(_session: string, paneTarget: string, keys: string): void {
  // Pane IDs (%N) are globally unique — target directly
  if (keys === 'C-c') {
    execSync(`tmux send-keys -t ${escSmart(paneTarget)} C-c`, { stdio: 'pipe' });
  } else {
    execSync(`tmux send-keys -t ${escSmart(paneTarget)} ${esc(keys)} Enter`, {
      stdio: 'pipe',
    });
  }
}

/**
 * Focus a specific pane.
 */
export function selectPane(_session: string, paneTarget: string): void {
  try {
    // Pane IDs (%N) are globally unique — target directly
    execSync(`tmux select-pane -t ${escSmart(paneTarget)}`, { stdio: 'pipe' });
  } catch {
    // Pane may already be gone — best-effort
  }
}

/**
 * Check if a pane exists in a session (exact match, read-only).
 */
export function paneExists(session: string, paneTarget: string): boolean {
  try {
    const output = execSync(
      `tmux list-panes -t ${esc(session)} -F '#{pane_id}'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return output.split('\n').some((line) => line.trim() === paneTarget);
  } catch {
    return false;
  }
}

/**
 * Get the first pane ID of a window (or active window if windowTarget omitted).
 */
export function getDefaultPaneId(session: string, windowTarget?: string): string {
  // Window IDs (@N) and session names are globally unique in tmux
  const target = windowTarget ? escSmart(windowTarget) : esc(session);
  const output = execSync(
    `tmux list-panes -t ${target} -F '#{pane_id}'`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
  const firstLine = output.split('\n')[0]?.trim();
  if (!firstLine) {
    throw new Error(`No panes found in session ${session}`);
  }
  return firstLine;
}

/**
 * Poll for a PID file to appear and contain a valid PID.
 * The file is written by: sh -c 'echo $$ > <pidFile>; exec claude ...'
 * Returns the PID or null on timeout.
 */
export async function pollForPidFile(pidFilePath: string, timeoutMs: number): Promise<number | null> {
  const fs = await import('fs');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const content = fs.readFileSync(pidFilePath, 'utf-8').trim();
      const pid = parseInt(content, 10);
      if (!isNaN(pid) && pid > 0) return pid;
    } catch {
      // File doesn't exist yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}

/**
 * Check if we're running inside a tmux session.
 */
export function isInsideTmux(): boolean {
  return process.env.TMUX !== undefined && process.env.TMUX !== '';
}

/**
 * Get the current tmux session name (only valid when isInsideTmux() is true).
 */
export function getCurrentSessionName(): string | null {
  try {
    return execSync('tmux display-message -p "#{session_name}"', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Get the currently active window ID in a session.
 */
export function getActiveWindowId(session: string): string | null {
  try {
    return execSync(
      `tmux display-message -t ${esc(session)} -p '#{window_id}'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
  } catch {
    return null;
  }
}

/**
 * Check if a specific window exists in a session (read-only, no focus change).
 */
export function windowExists(session: string, windowTarget: string): boolean {
  try {
    const output = execSync(
      `tmux list-windows -t ${esc(session)} -F '#{window_id}'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return output.split('\n').some((line) => line.trim() === windowTarget);
  } catch {
    return false;
  }
}

/** Shell-escape a string for use in tmux commands. */
function esc(s: string): string {
  // Single-quote the string, escaping any internal single quotes
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * tmux IDs (@N for windows, %N for panes) must NOT be quoted.
 * Session names and user strings need quoting.
 */
function isTmuxId(s: string): boolean {
  return /^[@%]\d+$/.test(s);
}

/** Escape a value, but pass tmux IDs through unquoted. */
function escSmart(s: string): string {
  return isTmuxId(s) ? s : esc(s);
}

/** Build a tmux target like 'session:window' or session:@N */
function escTarget(session: string, sub: string): string {
  // If sub is a tmux ID, we can't quote the whole thing — tmux needs @N unquoted
  if (isTmuxId(sub)) {
    return `${esc(session)}:${sub}`;
  }
  return esc(`${session}:${sub}`);
}
