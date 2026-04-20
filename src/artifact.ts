import { execSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { getStagedFiles, getFileStatus, isStagedDeletion, isPathGitignored } from './git.js';
import type { HarnessState } from './types.js';

function exec(cmd: string, cwd?: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8' }).trim();
}

/**
 * Auto-commit a harness artifact file.
 * Returns true if a new commit was created, false if no-op.
 *
 * Checks staged changes before committing:
 * - Only target file staged → git add + commit current working-tree state
 * - Other files staged → throw error
 */
export function normalizeArtifactCommit(filePath: string, message: string, cwd?: string): boolean {
  // Not in a git repo → skip auto-commit entirely
  try {
    exec('git rev-parse --show-toplevel', cwd);
  } catch {
    return false;
  }

  // Step 1: Check if file is already clean/committed
  const fileStatus = getFileStatus(filePath, cwd);
  if (fileStatus === '') {
    // File is either committed and clean, or doesn't exist — no-op
    return false;
  }

  // Step 2: Check staged files
  const stagedFiles = getStagedFiles(cwd);

  if (stagedFiles.length === 0 || (stagedFiles.length === 1 && stagedFiles[0] === filePath)) {
    exec(`git add "${filePath}"`, cwd);
    exec(`git commit -m "${message}"`, cwd);
    return true;
  }

  // Other files staged → throw
  throw new Error('Cannot auto-commit artifact: other staged changes exist.');
}

/**
 * Run Phase 6 preconditions in order:
 * 1. Check tree clean (excluding eval report) — abort if other files dirty
 * 2. Clean up eval report (untracked→rm, staged-new→restore+rm, tracked→git rm)
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

  if (isStagedDeletion(evalReportPath, cwd)) {
    // Already reset — no-op
  } else if (fileStatus === '') {
    // Either not present or tracked and clean — check physical existence
    if (!existsSync(join(resolvedCwd, evalReportPath))) {
      // Not present → no-op
    } else {
      // Tracked and clean → git rm
      exec(`git rm -f "${evalReportPath}"`, cwd);
    }
  } else if (fileStatus.startsWith('??')) {
    // Untracked → rm
    unlinkSync(join(resolvedCwd, evalReportPath));
  } else if (fileStatus.startsWith('A ')) {
    // Staged new → git restore --staged + rm
    exec(`git restore --staged "${evalReportPath}"`, cwd);
    unlinkSync(join(resolvedCwd, evalReportPath));
  } else {
    // Any other non-empty status → treat as tracked → git rm
    exec(`git rm -f "${evalReportPath}"`, cwd);
  }

  // Step 4: Final clean check
  const finalStatus = exec('git status --porcelain', cwd);
  if (finalStatus !== '') {
    const evalReportDeleted = isStagedDeletion(evalReportPath, cwd);
    const dirtyLines = finalStatus
      .split('\n')
      .filter(Boolean)
      .filter((line) => {
        const linePath = line.slice(3);
        if (linePath !== evalReportPath && !evalReportPath.startsWith(linePath)) {
          return true;
        }
        return linePath === evalReportPath && !evalReportDeleted;
      });

    if (dirtyLines.length > 0) {
      throw new Error('Working tree is not clean after eval report cleanup');
    }
  }

  void runId;
}

export function commitEvalReport(state: HarnessState, cwd: string): 'committed' | 'skipped' {
  const filePath = state.artifacts.evalReport;
  if (isPathGitignored(filePath, cwd)) {
    process.stderr.write(
      `⚠️  eval report path '${filePath}' is gitignored — skipping commit (evalCommit will remain null).\n`
    );
    return 'skipped';
  }
  const k = state.verifyRetries + 1;
  const message = `harness[${state.runId}]: Phase 6 — rev ${k} eval report`;
  normalizeArtifactCommit(filePath, message, cwd);
  return 'committed';
}
