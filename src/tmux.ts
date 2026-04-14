import { execSync } from 'child_process';

/**
 * Create a detached tmux session.
 * Throws if tmux is not available or session name already exists.
 */
export function createSession(name: string, cwd: string): void {
  execSync(`tmux new-session -d -s ${esc(name)} -c ${esc(cwd)}`, { stdio: 'pipe' });
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
  const output = execSync(
    `tmux new-window -t ${esc(session)} -n ${esc(windowName)} -P -F '#{window_id}' ${esc(command)}`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
  return output.trim();
}

/**
 * Select (focus) a window by name or ID.
 */
export function selectWindow(session: string, windowTarget: string): void {
  try {
    execSync(`tmux select-window -t ${esc(session)}:${esc(windowTarget)}`, { stdio: 'pipe' });
  } catch {
    // Window may already be gone — best-effort
  }
}

/**
 * Kill a window by name or ID.
 */
export function killWindow(session: string, windowTarget: string): void {
  try {
    execSync(`tmux kill-window -t ${esc(session)}:${esc(windowTarget)}`, { stdio: 'pipe' });
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
  execSync(`tmux send-keys -t ${esc(session)}:${esc(windowTarget)} ${esc(keys)} Enter`, {
    stdio: 'pipe',
  });
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
