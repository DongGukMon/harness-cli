import { execSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { getStagedFiles, getFileStatus } from './git.js';

function exec(cmd: string, cwd?: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8' }).trim();
}

/**
 * Auto-commit a harness artifact file.
 * Returns true if a new commit was created, false if no-op.
 *
 * Checks staged changes before committing:
 * - No staged files → git add + commit
 * - Only target file staged → commit directly (interrupted normalize recovery)
 * - Other files staged → throw error
 */
export function normalizeArtifactCommit(filePath: string, message: string, cwd?: string): boolean {
  // Step 1: Check if file is already clean/committed
  const fileStatus = getFileStatus(filePath, cwd);
  if (fileStatus === '') {
    // File is either committed and clean, or doesn't exist — no-op
    return false;
  }

  // Step 2: Check staged files
  const stagedFiles = getStagedFiles(cwd);

  if (stagedFiles.length === 0) {
    // No staged files → git add + commit
    exec(`git add "${filePath}"`, cwd);
    exec(`git commit -m "${message}"`, cwd);
    return true;
  }

  // Check if only the target file is staged
  if (stagedFiles.length === 1 && stagedFiles[0] === filePath) {
    // Only target file staged → skip git add, just commit (recovery from interrupted normalize)
    exec(`git commit -m "${message}"`, cwd);
    return true;
  }

  // Other files staged → throw
  throw new Error('Cannot auto-commit artifact: other staged changes exist.');
}

/**
 * Run Phase 6 preconditions in order:
 * 1. Check tree clean (excluding eval report) — abort if other files dirty
 * 2. Clean up eval report (untracked→rm, staged-new→restore+rm, tracked→git rm+commit)
 * 3. Final clean-tree verification
 */
export function runPhase6Preconditions(evalReportPath: string, runId: string, cwd?: string): void {
  const resolvedCwd = cwd ?? process.cwd();

  // Step 1: Staged guard — if any file OTHER than eval report is staged → throw
  const stagedFiles = getStagedFiles(cwd);
  const nonEvalStaged = stagedFiles.filter((f) => f !== evalReportPath);
  if (nonEvalStaged.length > 0) {
    throw new Error('Working tree must be clean before verification');
  }

  // Step 2: Unstaged/untracked guard — filter out eval report path, check others
  const porcelainOutput = exec('git status --porcelain', cwd);
  if (porcelainOutput !== '') {
    const dirtyLines = porcelainOutput
      .split('\n')
      .filter(Boolean)
      .filter((line) => {
        // Path starts at index 3 in porcelain format (XY followed by space)
        const linePath = line.slice(3);
        // A line represents the eval report if it exactly matches the eval report path,
        // or if it is a parent directory of the eval report (e.g. "?? docs/" covers
        // "docs/reports/my-run-eval.md" when the dir is untracked).
        return (
          linePath !== evalReportPath &&
          !evalReportPath.startsWith(linePath)
        );
      });

    if (dirtyLines.length > 0) {
      throw new Error('Working tree must be clean before verification');
    }
  }

  // Step 3: Eval report cleanup
  const fileStatus = getFileStatus(evalReportPath, cwd);

  if (fileStatus === '') {
    // Either not present or tracked and clean — check physical existence
    if (!existsSync(join(resolvedCwd, evalReportPath))) {
      // Not present → no-op
    } else {
      // Tracked and clean → git rm + commit
      exec(`git rm -f "${evalReportPath}"`, cwd);
      exec(
        `git commit -m "harness[${runId}]: Phase 6 — reset eval report for re-verification"`,
        cwd
      );
    }
  } else if (fileStatus.startsWith('??')) {
    // Untracked → rm
    unlinkSync(join(resolvedCwd, evalReportPath));
  } else if (fileStatus.startsWith('A ')) {
    // Staged new → git restore --staged + rm
    exec(`git restore --staged "${evalReportPath}"`, cwd);
    unlinkSync(join(resolvedCwd, evalReportPath));
  } else {
    // Any other non-empty status → treat as tracked → git rm + commit
    exec(`git rm -f "${evalReportPath}"`, cwd);
    exec(
      `git commit -m "harness[${runId}]: Phase 6 — reset eval report for re-verification"`,
      cwd
    );
  }

  // Step 4: Final clean check
  const finalStatus = exec('git status --porcelain', cwd);
  if (finalStatus !== '') {
    throw new Error('Working tree is not clean after eval report cleanup');
  }
}
