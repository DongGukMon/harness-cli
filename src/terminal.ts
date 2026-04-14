import { execSync } from 'child_process';
import { isInsideTmux } from './tmux.js';

/**
 * Open a new terminal window that attaches to the given tmux session.
 * Priority: iTerm2 → Terminal.app → manual fallback.
 *
 * If already inside tmux, does nothing (the user is already in the tmux server).
 *
 * Returns true if a window was opened, false if the user must manually attach.
 */
export function openTerminalWindow(tmuxSessionName: string): boolean {
  if (isInsideTmux()) {
    return true; // Already inside tmux — windows are visible
  }

  // Try iTerm2
  if (tryITerm2(tmuxSessionName)) {
    return true;
  }

  // Try Terminal.app
  if (tryTerminalApp(tmuxSessionName)) {
    return true;
  }

  // Manual fallback
  process.stderr.write(`\nCould not open a terminal window automatically.\n`);
  process.stderr.write(`Attach manually with:\n`);
  process.stderr.write(`  tmux attach -t ${tmuxSessionName}\n\n`);
  return false;
}

function tryITerm2(sessionName: string): boolean {
  try {
    execSync('osascript -e \'tell application "System Events" to get name of application processes\' 2>/dev/null | grep -q iTerm', {
      stdio: 'pipe',
    });
  } catch {
    // iTerm2 not running or not installed
    return false;
  }

  try {
    const script = `
tell application "iTerm2"
  create window with default profile
  tell current session of current window
    write text "tmux attach -t ${sessionName}"
  end tell
end tell`;
    execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function tryTerminalApp(sessionName: string): boolean {
  try {
    const script = `
tell application "Terminal"
  activate
  do script "tmux attach -t ${sessionName}"
end tell`;
    execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
