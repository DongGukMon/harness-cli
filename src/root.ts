import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { getGitRoot } from './git.js';

// Find .harness/ root directory.
// Priority: 1) explicit --root flag, 2) git root, 3) upward scan for .harness/
export function findHarnessRoot(explicitRoot?: string, cwd?: string): string {
  // 1. Explicit root provided → use it (create if needed)
  if (explicitRoot !== undefined) {
    const harnessDir = join(explicitRoot, '.harness');
    mkdirSync(harnessDir, { recursive: true });
    return harnessDir;
  }

  // 2. Try git root
  try {
    const gitRoot = getGitRoot(cwd);
    return join(gitRoot, '.harness');
  } catch {
    // Not in a git repo — fall through to upward scan
  }

  // 3. Scan upward from cwd for .harness/ directory
  let dir = cwd ?? process.cwd();
  while (true) {
    const candidate = join(dir, '.harness');
    if (existsSync(candidate)) {
      try {
        if (statSync(candidate).isDirectory()) {
          return candidate;
        }
      } catch {
        // Not a directory, keep scanning
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      // Reached filesystem root
      break;
    }
    dir = parent;
  }

  throw new Error("No `.harness/` directory found. Run 'harness start' first.");
}

// Read current-run pointer. Returns runId string or null.
export function getCurrentRun(harnessDir: string): string | null {
  const filePath = join(harnessDir, 'current-run');
  try {
    return readFileSync(filePath, 'utf-8').trim();
  } catch {
    return null;
  }
}

// Write current-run pointer.
export function setCurrentRun(harnessDir: string, runId: string): void {
  mkdirSync(harnessDir, { recursive: true });
  writeFileSync(join(harnessDir, 'current-run'), runId, 'utf-8');
}

// Clear current-run pointer (e.g., on cancelled run).
export function clearCurrentRun(harnessDir: string): void {
  const p = join(harnessDir, 'current-run');
  try { unlinkSync(p); } catch { /* ignore if missing */ }
}

// Resolve runId from explicit arg or current-run pointer.
// Throws with guidance if neither available.
export function resolveRunId(harnessDir: string, explicitRunId?: string): string {
  // 1. Explicit arg → return it + update pointer
  if (explicitRunId !== undefined) {
    setCurrentRun(harnessDir, explicitRunId);
    return explicitRunId;
  }

  // 2. No arg → read current-run pointer
  const current = getCurrentRun(harnessDir);
  if (current === null) {
    throw new Error(
      "No active run. Use 'harness start' to start a new run or 'harness list' to see all runs."
    );
  }

  return current;
}
