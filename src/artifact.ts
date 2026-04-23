import { execSync, execFileSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { join, isAbsolute } from 'path';
import { getStagedFiles, getFileStatus, isStagedDeletion, isPathGitignored } from './git.js';
import type { HarnessState } from './types.js';

/**
 * Compute a content-hashed fingerprint for every dirty path reported by
 * `git status --porcelain --untracked-files=all` in the given directory.
 *
 * Each fingerprint is the string `"<XY>\0<path>\0<hash>"` where:
 * - XY  : the 2-char porcelain status code (e.g. " M", "??", "A ")
 * - path: the file path from column 4 of the porcelain line
 * - hash: `git hash-object -- <path>` of the working-tree file, or "" when
 *         the file is absent (deletion status) or hash-object fails
 *
 * Using `--untracked-files=all` ensures that every untracked file is listed
 * individually instead of collapsed into a parent `?? dir/` entry, so each
 * fingerprint binds to exactly one hashable file path.
 *
 * Returns [] when cwd is not a git repo or the tree is clean.
 */
export function captureDirtyBaseline(cwd: string): string[] {
  let rawOutput: string;
  try {
    rawOutput = execSync('git status --porcelain --untracked-files=all', {
      cwd,
      encoding: 'utf-8',
    });
  } catch {
    return [];
  }
  // Split by newline and filter empty lines — do NOT .trim() the full output,
  // as that would strip the leading space from ' M' lines and corrupt XY parsing.
  const lines = rawOutput.split('\n').filter(Boolean);
  if (lines.length === 0) return [];

  return lines.map((line) => {
    const xy = line.slice(0, 2);
    const filePath = line.slice(3);
    let hash = '';
    const absPath = join(cwd, filePath);
    if (existsSync(absPath)) {
      try {
        hash = execFileSync('git', ['hash-object', '--', filePath], {
          cwd,
          encoding: 'utf-8',
        }).trim();
      } catch {
        hash = '';
      }
    }
    return `${xy}\0${filePath}\0${hash}`;
  });
}

/**
 * Resolve a (potentially relative) artifact path to an absolute path.
 * Uses trackedRepos[0].path as the doc root (falling back to outerCwd).
 */
export function resolveArtifact(state: HarnessState, relPath: string, outerCwd: string): string {
  if (isAbsolute(relPath)) return relPath;
  // .harness/... artifacts are system files anchored to the outer cwd, not the docs-home repo
  if (relPath.startsWith('.harness/') || relPath.startsWith('.harness\\')) {
    return join(outerCwd, relPath);
  }
  const docsRoot = state.trackedRepos?.[0]?.path || outerCwd;
  return join(docsRoot, relPath);
}

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
 * Read `git status --porcelain --untracked-files=all` and return individual
 * lines without trimming the full output (which would strip the leading space
 * from ' M' lines and corrupt XY parsing).
 *
 * Errors from git (e.g. not in a git repo) propagate to the caller.
 */
function readPorcelainLines(cwd?: string): string[] {
  const raw = execSync('git status --porcelain --untracked-files=all', {
    cwd,
    encoding: 'utf-8',
  });
  return raw.split('\n').filter(Boolean);
}

/**
 * Compute a live fingerprint for a single porcelain line using the same format
 * as captureDirtyBaseline: `"<XY>\0<path>\0<hash>"`.
 */
function computeFingerprint(line: string, cwd: string): string {
  const xy = line.slice(0, 2);
  const filePath = line.slice(3);
  let hash = '';
  const resolvedPath = join(cwd, filePath);
  if (existsSync(resolvedPath)) {
    try {
      hash = execFileSync('git', ['hash-object', '--', filePath], {
        cwd,
        encoding: 'utf-8',
      }).trim();
    } catch {
      hash = '';
    }
  }
  return `${xy}\0${filePath}\0${hash}`;
}

/**
 * Run Phase 6 preconditions in order:
 * 1. Check tree clean (excluding eval report) — abort if other files dirty
 * 2. Clean up eval report (untracked→rm, staged-new→restore+rm, tracked→git rm)
 * 3. Final clean-tree verification
 *
 * Pre-existing dirty files captured in dirtyBaseline (at session init) are
 * filtered out by fingerprint before the cleanliness check — this allows runs
 * on mission branches with uncommitted content (issues #67, #68).
 */
export function runPhase6Preconditions(
  evalReportPath: string,
  runId: string,
  cwd?: string,
  dirtyBaseline: string[] = [],
): void {
  const resolvedCwd = cwd ?? process.cwd();
  const baselineSet = new Set(dirtyBaseline);

  // Step 1: Staged guard — if any file OTHER than eval report is staged → throw
  const stagedFiles = getStagedFiles(cwd);
  const nonEvalStaged = stagedFiles.filter((f) => f !== evalReportPath);
  if (nonEvalStaged.length > 0) {
    throw new Error('Working tree must be clean before verification');
  }

  // Step 2: Unstaged/untracked guard — filter out eval report and baseline entries
  const porcelainLines = readPorcelainLines(cwd);
  if (porcelainLines.length > 0) {
    const dirtyLines = porcelainLines.filter((line) => {
      // Path starts at index 3 in porcelain format (XY followed by space)
      const linePath = line.slice(3);
      // Filter out the eval report (exact match or parent-dir collapse)
      if (linePath === evalReportPath || evalReportPath.startsWith(linePath)) {
        return false;
      }
      // Filter out pre-existing baseline entries by fingerprint
      if (baselineSet.size > 0) {
        const fp = computeFingerprint(line, resolvedCwd);
        if (baselineSet.has(fp)) return false;
      }
      return true;
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
    // Either not present, tracked and clean, or gitignored — check physical existence
    if (!existsSync(join(resolvedCwd, evalReportPath))) {
      // Not present → no-op
    } else if (isPathGitignored(evalReportPath, cwd)) {
      // Gitignored file that exists physically: git never tracked it so
      // `git rm -f` would error ("did not match any files"). Just unlink.
      unlinkSync(join(resolvedCwd, evalReportPath));
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

  // Step 4: Final clean check — baseline entries may still appear (they were not cleaned up)
  const finalPorcelainLines = readPorcelainLines(cwd);
  if (finalPorcelainLines.length > 0) {
    const evalReportDeleted = isStagedDeletion(evalReportPath, cwd);
    const dirtyLines = finalPorcelainLines.filter((line) => {
      const linePath = line.slice(3);
      // Filter parent-dir collapse entries for eval report
      if (linePath !== evalReportPath && evalReportPath.startsWith(linePath)) return false;
      // Eval report itself: keep as dirty only if cleanup did NOT succeed
      if (linePath === evalReportPath) return !evalReportDeleted;
      // Filter pre-existing baseline entries by fingerprint
      if (baselineSet.size > 0) {
        const fp = computeFingerprint(line, resolvedCwd);
        if (baselineSet.has(fp)) return false;
      }
      return true;
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
