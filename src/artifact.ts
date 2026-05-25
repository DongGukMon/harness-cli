import { execSync, execFileSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { join, isAbsolute } from 'path';
import { getStagedFiles, getFileStatus, isStagedDeletion, isPathGitignored } from './git.js';
import type { HarnessState } from './types.js';

/**
 * Parse NUL-delimited `git status --porcelain -z` output into `"XY path"` strings.
 *
 * Using -z prevents git from C-quoting paths that contain spaces or special
 * characters; entries are NUL-terminated rather than newline-terminated, and
 * paths are emitted verbatim. For rename/copy entries (R/C status) the second
 * NUL-delimited token is the old (origin) path and is skipped — only the new
 * working-tree path matters for fingerprinting.
 */
function parsePorcelainZ(raw: string): string[] {
  const tokens = raw.split('\0');
  const lines: string[] = [];
  let skipNext = false;
  for (const token of tokens) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    // Status entries: at least 4 chars, position 2 is the space between XY and path.
    if (token.length >= 4 && token[2] === ' ') {
      lines.push(token);
      // Rename/copy entries have a second NUL-delimited old-path token — skip it.
      if (token[0] === 'R' || token[0] === 'C') {
        skipNext = true;
      }
    }
  }
  return lines;
}

/**
 * Compute a content-hashed fingerprint for every dirty path reported by
 * `git status --porcelain -z --untracked-files=all` in the given directory.
 *
 * Each fingerprint is the string `"<XY>\0<path>\0<hash>"` where:
 * - XY  : the 2-char porcelain status code (e.g. " M", "??", "A ")
 * - path: the file path from column 4 of the porcelain line
 * - hash: `git hash-object -- <path>` of the working-tree file, or "" when
 *         the file is absent (deletion status) or hash-object fails
 *
 * Using `-z` prevents git from C-quoting paths that contain spaces or special
 * characters — entries are NUL-terminated and paths are emitted verbatim.
 * Using `--untracked-files=all` ensures that every untracked file is listed
 * individually instead of collapsed into a parent `?? dir/` entry, so each
 * fingerprint binds to exactly one hashable file path.
 *
 * Returns [] when cwd is not a git repo or the tree is clean.
 */
export function captureDirtyBaseline(cwd: string): string[] {
  let rawOutput: string;
  try {
    rawOutput = execSync('git status --porcelain -z --untracked-files=all', {
      cwd,
      encoding: 'utf-8',
    });
  } catch {
    return [];
  }
  const lines = parsePorcelainZ(rawOutput);
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
 * - Other files staged → throw error (R1.b)
 * - Staged delta empty after add (byte-identical to HEAD) → return false (R1.a)
 */
export function normalizeArtifactCommit(filePath: string, message: string, cwd?: string): boolean {
  // Not in a git repo → skip auto-commit entirely
  try {
    exec('git rev-parse --show-toplevel', cwd);
  } catch {
    return false;
  }

  // R1.b precedence (gate-4 P1.1): unrelated staged files MUST throw before any
  // early return. This runs before the fileStatus === '' check so that a clean
  // target file paired with an unrelated staged file still throws.
  const stagedFiles = getStagedFiles(cwd);
  const otherStaged = stagedFiles.filter((f) => f !== filePath);
  if (otherStaged.length > 0) {
    throw new Error('Cannot auto-commit artifact: other staged changes exist.');
  }

  // File clean/missing → no-op
  const fileStatus = getFileStatus(filePath, cwd);
  if (fileStatus === '') return false;

  const cwdAbs = cwd ?? process.cwd();
  if (!existsSync(join(cwdAbs, filePath))) return false;

  exec(`git add "${filePath}"`, cwd);
  // R1.a: empty staged delta vs HEAD → skip commit, return false.
  // `git diff --cached --quiet HEAD -- <path>` exits 0 when no delta, 1 otherwise.
  let hasDelta = true;
  try {
    execSync(`git diff --cached --quiet HEAD -- "${filePath}"`, { cwd, stdio: 'ignore' });
    hasDelta = false;
  } catch {
    hasDelta = true;
  }
  if (!hasDelta) return false;
  exec(`git commit -m "${message}"`, cwd);
  return true;
}

/**
 * Read `git status --porcelain -z --untracked-files=all` and return parsed
 * `"XY path"` strings. Using -z ensures paths with spaces are never C-quoted.
 *
 * Errors from git (e.g. not in a git repo) propagate to the caller.
 */
function readPorcelainLines(cwd?: string): string[] {
  const raw = execSync('git status --porcelain -z --untracked-files=all', {
    cwd,
    encoding: 'utf-8',
  });
  return parsePorcelainZ(raw);
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
): { extendedBaseline: string[] } {
  const resolvedCwd = cwd ?? process.cwd();
  const baselineSet = new Set(dirtyBaseline);
  // R2.a: locally accumulated extension; never mutates the input array (I3).
  const extendedBaseline: string[] = [];

  // Step 1: Staged guard — if any file OTHER than eval report is staged → throw
  const stagedFiles = getStagedFiles(cwd);
  const nonEvalStaged = stagedFiles.filter((f) => f !== evalReportPath);
  if (nonEvalStaged.length > 0) {
    throw new Error(
      `Working tree must be clean before verification: staged files outside eval report: ${nonEvalStaged.join(', ')}`
    );
  }

  // Step 2: Unstaged/untracked guard with R2.b ??-only tolerance.
  // Modified-tracked statuses (` M`, `M `, `MM`, `A `, ` D`, `D `, etc.) still
  // count as dirty per R2.d. Only XY === '??' (new untracked) outside baseline
  // is auto-accepted and accumulated into extendedBaseline.
  const porcelainLines = readPorcelainLines(cwd);
  if (porcelainLines.length > 0) {
    const dirtyLines: string[] = [];
    for (const line of porcelainLines) {
      const xy = line.slice(0, 2);
      const linePath = line.slice(3);
      // Filter out the eval report (exact match or parent-dir collapse)
      if (linePath === evalReportPath || evalReportPath.startsWith(linePath)) continue;
      const fp = computeFingerprint(line, resolvedCwd);
      if (baselineSet.has(fp)) continue;
      if (xy === '??') {
        extendedBaseline.push(fp);
        continue;
      }
      dirtyLines.push(line);
    }

    if (dirtyLines.length > 0) {
      throw new Error(
        `Working tree must be clean before verification: dirty paths: ${dirtyLines.slice(0, 10).join(', ')}`
      );
    }
  }

  // Step 3: Eval report cleanup (byte-identical to previous implementation)
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

  // Step 4: Final clean check with R2.c (??-only tolerance applied again, using
  // baseline ∪ extendedBaseline). Baseline entries may still appear (they were
  // not cleaned up); new ??-status files appearing after cleanup are also
  // accepted into extendedBaseline.
  const finalPorcelainLines = readPorcelainLines(cwd);
  if (finalPorcelainLines.length > 0) {
    const evalReportDeleted = isStagedDeletion(evalReportPath, cwd);
    const dirtyLines: string[] = [];
    for (const line of finalPorcelainLines) {
      const xy = line.slice(0, 2);
      const linePath = line.slice(3);
      // Filter parent-dir collapse entries for eval report (matches current semantics)
      if (linePath !== evalReportPath && evalReportPath.startsWith(linePath)) continue;
      // Eval report itself: keep as dirty only if cleanup did NOT succeed
      if (linePath === evalReportPath) {
        if (!evalReportDeleted) dirtyLines.push(line);
        continue;
      }
      const fp = computeFingerprint(line, resolvedCwd);
      if (baselineSet.has(fp) || extendedBaseline.includes(fp)) continue;
      if (xy === '??') {
        extendedBaseline.push(fp);
        continue;
      }
      dirtyLines.push(line);
    }

    if (dirtyLines.length > 0) {
      throw new Error(
        `Working tree is not clean after eval report cleanup: dirty paths: ${dirtyLines.slice(0, 10).join(', ')}`
      );
    }
  }

  void runId;
  return { extendedBaseline };
}

export function commitEvalReport(
  state: HarnessState,
  cwd: string,
): 'committed' | 'unchanged' | 'gitignored' {
  const filePath = state.artifacts.evalReport;
  if (isPathGitignored(filePath, cwd)) {
    process.stderr.write(
      `⚠️  eval report path '${filePath}' is gitignored — skipping commit (evalCommit will remain null).\n`
    );
    // R1.c: 'gitignored' is reserved EXCLUSIVELY for the isPathGitignored branch.
    return 'gitignored';
  }
  const k = state.verifyRetries + 1;
  const message = `harness[${state.runId}]: Phase 6 — rev ${k} eval report`;
  const committed = normalizeArtifactCommit(filePath, message, cwd);
  if (committed) return 'committed';

  // R1.c + I1: 'unchanged' iff (a) HEAD contains the report path AND
  // (b) the file still exists on disk. Either-or-both missing → throw.
  // Per gate-4 P1.2: any failure throws, never silently falls back to 'gitignored'.
  // Per gate-4 (round 2) P1: the disk-existence check is mandatory — without it,
  // a deleted-working-tree-but-still-in-HEAD scenario would silently report
  // 'unchanged' and mis-anchor evalCommit to a stale HEAD that lacks the report
  // on disk.
  let headTreePaths: string;
  try {
    headTreePaths = execSync('git ls-tree -r --name-only HEAD', { cwd, encoding: 'utf-8' });
  } catch (err) {
    throw new Error(
      `commitEvalReport: cannot verify HEAD tree for '${filePath}' (no commit was created): ${(err as Error).message}`
    );
  }
  const headHasReport = headTreePaths.split('\n').some((p) => p.trim() === filePath);
  if (!headHasReport) {
    throw new Error(
      `commitEvalReport: '${filePath}' not committed and not present in HEAD — refusing to report 'unchanged' (I1).`
    );
  }
  if (!existsSync(join(cwd, filePath))) {
    throw new Error(
      `commitEvalReport: '${filePath}' is in HEAD but missing from the working tree — refusing to report 'unchanged' (I1).`
    );
  }
  return 'unchanged';
}
