import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { createTestRepo } from './helpers/test-repo.js';
import { normalizeArtifactCommit, runPhase6Preconditions, commitEvalReport, captureDirtyBaseline } from '../src/artifact.js';
import { createInitialState } from '../src/state.js';

// Helper: count commits reachable from HEAD
function commitCount(cwd: string): number {
  return Number(execSync('git rev-list --count HEAD', { cwd, encoding: 'utf-8' }).trim());
}

// Helper: get current HEAD SHA
function getHead(cwd: string): string {
  return execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8' }).trim();
}

// Helper: write a file and ensure parent dirs exist
function writeRepoFile(repoPath: string, relPath: string, content: string): void {
  const fullPath = join(repoPath, relPath);
  const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, content);
}

describe('normalizeArtifactCommit', () => {
  let repo: { path: string; cleanup: () => void };

  beforeEach(() => {
    repo = createTestRepo();
  });

  afterEach(() => {
    repo.cleanup();
  });

  it('creates commit for new untracked file', () => {
    const filePath = 'artifact.md';
    writeFileSync(join(repo.path, filePath), '# Artifact');
    const headBefore = getHead(repo.path);

    const result = normalizeArtifactCommit(filePath, 'harness: add artifact', repo.path);

    expect(result).toBe(true);
    const headAfter = getHead(repo.path);
    expect(headAfter).not.toBe(headBefore);
    // File should now be committed (clean)
    const status = execSync(`git status --porcelain -- ${filePath}`, {
      cwd: repo.path,
      encoding: 'utf-8',
    }).trim();
    expect(status).toBe('');
  });

  it('is no-op for already-committed file', () => {
    const filePath = 'artifact.md';
    writeFileSync(join(repo.path, filePath), '# Artifact');
    execSync(`git add ${filePath} && git commit -m "add artifact"`, { cwd: repo.path });
    const headBefore = getHead(repo.path);

    const result = normalizeArtifactCommit(filePath, 'harness: add artifact', repo.path);

    expect(result).toBe(false);
    expect(getHead(repo.path)).toBe(headBefore);
  });

  it('fails when non-target files are staged', () => {
    const filePath = 'artifact.md';
    const otherFile = 'other.txt';
    writeFileSync(join(repo.path, filePath), '# Artifact');
    writeFileSync(join(repo.path, otherFile), 'other content');
    // Stage the other file (not the artifact)
    execSync(`git add ${otherFile}`, { cwd: repo.path });

    expect(() =>
      normalizeArtifactCommit(filePath, 'harness: add artifact', repo.path)
    ).toThrow('Cannot auto-commit artifact: other staged changes exist.');
  });

  it('returns false without throwing when file is staged-for-deletion and absent on disk', () => {
    const filePath = 'artifact.md';
    writeFileSync(join(repo.path, filePath), '# Artifact');
    execSync(`git add "${filePath}" && git commit -m "add artifact"`, { cwd: repo.path });
    // git rm stages deletion and removes file from disk
    execSync(`git rm "${filePath}"`, { cwd: repo.path });

    const headBefore = getHead(repo.path);

    let result: boolean | undefined;
    expect(() => {
      result = normalizeArtifactCommit(filePath, 'harness: update artifact', repo.path);
    }).not.toThrow();
    expect(result).toBe(false);
    expect(getHead(repo.path)).toBe(headBefore);
  });

  it('recovers from interrupted git add (target-only staged)', () => {
    const filePath = 'artifact.md';
    writeFileSync(join(repo.path, filePath), '# Artifact');
    // Simulate interrupted normalize: only the target file is staged
    execSync(`git add ${filePath}`, { cwd: repo.path });
    const headBefore = getHead(repo.path);

    const result = normalizeArtifactCommit(filePath, 'harness: add artifact', repo.path);

    expect(result).toBe(true);
    const headAfter = getHead(repo.path);
    expect(headAfter).not.toBe(headBefore);
    // File should be committed (clean)
    const status = execSync(`git status --porcelain -- ${filePath}`, {
      cwd: repo.path,
      encoding: 'utf-8',
    }).trim();
    expect(status).toBe('');
  });

  // SC1: byte-identical regenerate after P7-reject → P5-reopen cycle must not
  // throw and must not produce a new commit.
  it('returns false (no throw) when staged content matches HEAD byte-for-byte', () => {
    const filePath = 'docs/eval-reports/run-x.md';
    writeRepoFile(repo.path, filePath, '# Eval\n\n## Summary\nx\n');
    execSync(`git add "${filePath}" && git commit -m "seed"`, { cwd: repo.path });
    const commitsBefore = commitCount(repo.path);
    // Write same bytes again → staged delta will be empty after git add
    writeRepoFile(repo.path, filePath, '# Eval\n\n## Summary\nx\n');
    const result = normalizeArtifactCommit(filePath, 'harness: rev 2', repo.path);
    expect(result).toBe(false);
    expect(commitCount(repo.path)).toBe(commitsBefore);
  });

  // Gate-4 P1.1 regression: R1.b precedence — guard fires even when eval-report
  // fileStatus is empty.
  it('throws "other staged changes exist" even when the target file is clean/committed and an unrelated file is staged', () => {
    const filePath = 'artifact.md';
    const otherFile = 'other.txt';
    // Commit the artifact so its fileStatus is '' (clean)
    writeRepoFile(repo.path, filePath, '# Artifact\n');
    execSync(`git add "${filePath}" && git commit -m "seed artifact"`, { cwd: repo.path });
    // Stage a different file
    writeRepoFile(repo.path, otherFile, 'other');
    execSync(`git add "${otherFile}"`, { cwd: repo.path });
    expect(() =>
      normalizeArtifactCommit(filePath, 'harness: noop', repo.path)
    ).toThrow('Cannot auto-commit artifact: other staged changes exist.');
  });
});

describe('runPhase6Preconditions', () => {
  let repo: { path: string; cleanup: () => void };
  const evalReportPath = 'docs/reports/my-run-eval.md';

  beforeEach(() => {
    repo = createTestRepo();
  });

  afterEach(() => {
    repo.cleanup();
  });

  it('no eval report → no-op, passes', () => {
    // Clean repo with no eval report — should pass without throwing
    expect(() =>
      runPhase6Preconditions(evalReportPath, 'my-run', repo.path)
    ).not.toThrow();
  });

  it('deletes untracked eval report', () => {
    writeRepoFile(repo.path, evalReportPath, '# Eval Report');
    // File is untracked
    const fullPath = join(repo.path, evalReportPath);
    expect(existsSync(fullPath)).toBe(true);

    runPhase6Preconditions(evalReportPath, 'my-run', repo.path);

    expect(existsSync(fullPath)).toBe(false);
    // Tree should be clean after
    const status = execSync('git status --porcelain', { cwd: repo.path, encoding: 'utf-8' }).trim();
    expect(status).toBe('');
  });

  it('unstages + deletes staged-new eval report', () => {
    writeRepoFile(repo.path, evalReportPath, '# Eval Report');
    // Stage it (A  status — staged new)
    execSync(`git add "${evalReportPath}"`, { cwd: repo.path });
    const fullPath = join(repo.path, evalReportPath);
    expect(existsSync(fullPath)).toBe(true);

    runPhase6Preconditions(evalReportPath, 'my-run', repo.path);

    expect(existsSync(fullPath)).toBe(false);
    const status = execSync('git status --porcelain', { cwd: repo.path, encoding: 'utf-8' }).trim();
    expect(status).toBe('');
  });

  it('git rm stages tracked eval report deletion without creating a reset commit', () => {
    // Create, add and commit the eval report so it is tracked
    writeRepoFile(repo.path, evalReportPath, '# Eval Report');
    execSync(`git add "${evalReportPath}" && git commit -m "add eval report"`, {
      cwd: repo.path,
    });
    const headBefore = getHead(repo.path);
    const fullPath = join(repo.path, evalReportPath);
    expect(existsSync(fullPath)).toBe(true);

    runPhase6Preconditions(evalReportPath, 'my-run', repo.path);

    expect(existsSync(fullPath)).toBe(false);
    // Reset is staged only; the commit is deferred to the next eval report write.
    const headAfter = getHead(repo.path);
    expect(headAfter).toBe(headBefore);
    const stagedDeletion = execSync(`git diff --cached --name-status -- "${evalReportPath}"`, {
      cwd: repo.path,
      encoding: 'utf-8',
    }).trim();
    expect(stagedDeletion).toBe(`D\t${evalReportPath}`);
  });

  it('aborts when non-eval files are staged', () => {
    writeFileSync(join(repo.path, 'dirty.txt'), 'dirty');
    execSync('git add dirty.txt', { cwd: repo.path });

    expect(() =>
      runPhase6Preconditions(evalReportPath, 'my-run', repo.path)
    ).toThrow('Working tree must be clean before verification');
  });

  it('aborts when non-eval files are unstaged/dirty', () => {
    // Create a tracked file, then modify it without staging
    writeFileSync(join(repo.path, 'tracked.txt'), 'original');
    execSync('git add tracked.txt && git commit -m "add tracked"', { cwd: repo.path });
    writeFileSync(join(repo.path, 'tracked.txt'), 'modified');

    expect(() =>
      runPhase6Preconditions(evalReportPath, 'my-run', repo.path)
    ).toThrow('Working tree must be clean before verification');
  });

  // R2.b (new contract): a mid-session untracked file outside baseline is
  // auto-tolerated and accepted into extendedBaseline; it MUST NOT throw.
  it('accepts untracked file outside baseline into extendedBaseline (R2.b ??-only tolerance)', () => {
    writeFileSync(join(repo.path, 'untracked.txt'), 'noise');
    const result = runPhase6Preconditions(evalReportPath, 'my-run', repo.path);
    expect(result.extendedBaseline.length).toBe(1);
    expect(result.extendedBaseline[0]).toContain('untracked.txt');
  });

  it('final clean check passes after cleanup', () => {
    // Eval report is untracked — after cleanup tree must be clean
    writeRepoFile(repo.path, evalReportPath, '# Eval Report');

    // Should not throw (final check must pass)
    expect(() =>
      runPhase6Preconditions(evalReportPath, 'my-run', repo.path)
    ).not.toThrow();

    const status = execSync('git status --porcelain', { cwd: repo.path, encoding: 'utf-8' }).trim();
    expect(status).toBe('');
  });

  it('tolerates gitignored eval report: unlinks physical file without invoking git rm', () => {
    // Repro of the field bug: user's docsRoot has `docs` (or `docs/`) in .gitignore,
    // so the eval report at docs/process/evals/<id>-eval.md is ignored and never tracked.
    // Pre-fix: getFileStatus → '', existsSync → true → `git rm -f` fires → exit 128
    //   ("did not match any files") → runPhase6Preconditions throws on every resume.
    // Post-fix: isPathGitignored short-circuits to unlinkSync; no git rm attempted.
    const gitignoredEvalPath = 'docs/process/evals/ignored-run-eval.md';
    writeFileSync(join(repo.path, '.gitignore'), 'docs\n');
    execSync('git add .gitignore && git commit -m "ignore docs dir"', { cwd: repo.path });

    // Physically create the file under the gitignored path
    writeRepoFile(repo.path, gitignoredEvalPath, '# partial report\n');
    const fullPath = join(repo.path, gitignoredEvalPath);
    expect(existsSync(fullPath)).toBe(true);

    // Sanity: git treats the file as ignored (porcelain empty, check-ignore hits)
    const porcelain = execSync('git status --porcelain', {
      cwd: repo.path,
      encoding: 'utf-8',
    }).trim();
    expect(porcelain).toBe('');

    // Must not throw — this is the regression path
    expect(() =>
      runPhase6Preconditions(gitignoredEvalPath, 'ignored-run', repo.path)
    ).not.toThrow();

    // File gone, tree still clean
    expect(existsSync(fullPath)).toBe(false);
    const after = execSync('git status --porcelain', { cwd: repo.path, encoding: 'utf-8' }).trim();
    expect(after).toBe('');
  });

  it('FR-3/6: succeeds with git docsRoot even when outer cwd is a non-git directory', () => {
    // Simulates the multi-repo case: outer dir is not a git repo (e.g. a bare workspace root),
    // but docsRoot (trackedRepos[0].path) is a valid git repo.
    // Pre-fix: verify.ts passed outer cwd to runPhase6Preconditions → git status threw.
    // Post-fix: verify.ts derives docsRoot = trackedRepos[0].path and passes that.
    const outer = mkdtempSync(join(tmpdir(), 'nongit-outer-'));
    try {
      // outer is NOT a git repo — calling runPhase6Preconditions with it must throw
      expect(() =>
        runPhase6Preconditions(evalReportPath, 'my-run', outer)
      ).toThrow();

      // The fix: pass docsRoot (the real git repo) — must succeed
      expect(() =>
        runPhase6Preconditions(evalReportPath, 'my-run', repo.path)
      ).not.toThrow();
    } finally {
      rmSync(outer, { recursive: true, force: true });
    }
  });

  // SC3: a mid-session new untracked file outside baseline must be auto-accepted
  // and returned in extendedBaseline (??-only tolerance, R2.b).
  it('returns extendedBaseline populated when a new untracked file appears outside baseline', () => {
    // Seed baseline with one entry
    writeFileSync(join(repo.path, 'preexisting.lock'), 'x');
    const baseline = captureDirtyBaseline(repo.path);
    expect(baseline.length).toBe(1);
    // Drop a NEW untracked file that is NOT in baseline
    mkdirSync(join(repo.path, '.claude'), { recursive: true });
    writeFileSync(join(repo.path, '.claude/scheduled_tasks.lock'), 'y');
    const result = runPhase6Preconditions(evalReportPath, 'r', repo.path, baseline);
    expect(result.extendedBaseline.length).toBe(1);
    expect(result.extendedBaseline[0]).toContain('.claude/scheduled_tasks.lock');
  });

  // SC4: tracked-modified files outside baseline still throw (R2.d), and the
  // throw message contains the offending path (R3.b).
  it('throws with R3.b-shaped message listing offending path when a tracked file is modified outside baseline', () => {
    writeRepoFile(repo.path, 'src/foo.ts', 'original');
    execSync('git add . && git commit -m seed', { cwd: repo.path });
    writeRepoFile(repo.path, 'src/foo.ts', 'modified');
    expect(() => runPhase6Preconditions(evalReportPath, 'r', repo.path, []))
      .toThrow(/Working tree must be clean before verification: dirty paths:.*src\/foo\.ts/);
  });

  // R3.a regression: staged non-eval-report files outside baseline throw with
  // the staged-files prefix.
  it('throws with R3.a-shaped message when a non-eval-report file is staged outside baseline', () => {
    writeFileSync(join(repo.path, 'unrelated.txt'), 'noise');
    execSync('git add unrelated.txt', { cwd: repo.path });
    expect(() => runPhase6Preconditions(evalReportPath, 'r', repo.path, []))
      .toThrow(/Working tree must be clean before verification: staged files outside eval report: unrelated\.txt/);
  });

  // I3: the input dirtyBaseline array must never be mutated.
  it('does NOT mutate the input dirtyBaseline array (I3)', () => {
    mkdirSync(join(repo.path, '.claude'), { recursive: true });
    writeFileSync(join(repo.path, '.claude/scheduled_tasks.lock'), 'y');
    const baseline: string[] = []; // empty
    const before = baseline.slice();
    runPhase6Preconditions(evalReportPath, 'r', repo.path, baseline);
    expect(baseline).toEqual(before);
  });
});

describe('runPhase6Preconditions — dirty baseline filtering (issues #67/#68)', () => {
  let repo: { path: string; cleanup: () => void };
  const evalReportPath = 'docs/reports/my-run-eval.md';

  beforeEach(() => {
    repo = createTestRepo();
  });

  afterEach(() => {
    repo.cleanup();
  });

  it('R6: pre-existing tracked-dirty file in baseline → no throw (issue #68 tracked variant)', () => {
    // Create and commit a tracked file, then modify it (tracked-dirty)
    writeFileSync(join(repo.path, 'tracked-dirty.txt'), 'original');
    execSync('git add tracked-dirty.txt && git commit -m "add file"', { cwd: repo.path });
    writeFileSync(join(repo.path, 'tracked-dirty.txt'), 'modified by user before harness');

    // Capture baseline — contains the " M tracked-dirty.txt" fingerprint
    const baseline = captureDirtyBaseline(repo.path);
    expect(baseline.length).toBeGreaterThan(0);

    // Must not throw — the dirty file is pre-existing (in baseline)
    expect(() =>
      runPhase6Preconditions(evalReportPath, 'my-run', repo.path, baseline)
    ).not.toThrow();
  });

  it('R6: pre-existing untracked file in baseline → no throw (issue #68 untracked variant)', () => {
    // An untracked file present before the harness session
    writeFileSync(join(repo.path, 'preexisting-untracked.txt'), 'noise');

    // Capture baseline
    const baseline = captureDirtyBaseline(repo.path);
    expect(baseline.length).toBeGreaterThan(0);

    // Must not throw — the untracked file is in the baseline
    expect(() =>
      runPhase6Preconditions(evalReportPath, 'my-run', repo.path, baseline)
    ).not.toThrow();
  });

  // R2.b/R2.d updated contract: a NEW untracked file from Phase 5 is now
  // auto-tolerated (added to extendedBaseline) and no longer throws — this
  // test was tightened in 2026-05-25-untitled-f041 (issue #112). The old
  // assertion has been retired; the new behavior is validated below.
  it('R2.b: pre-existing dirty file + Phase-5-introduced untracked file → does NOT throw, file added to extendedBaseline', () => {
    // Create a pre-existing untracked file
    writeFileSync(join(repo.path, 'preexisting.txt'), 'old content');

    // Capture baseline (only contains preexisting.txt)
    const baseline = captureDirtyBaseline(repo.path);
    expect(baseline.length).toBeGreaterThan(0);

    // Phase 5 introduces a NEW untracked file — not in baseline
    writeFileSync(join(repo.path, 'phase5-new.txt'), 'uncommitted phase-5 work');

    // R2.b: ??-only tolerance accepts this without throwing.
    const result = runPhase6Preconditions(evalReportPath, 'my-run', repo.path, baseline);
    expect(result.extendedBaseline.some((fp) => fp.includes('phase5-new.txt'))).toBe(true);
  });

  it('R6: pre-existing dirty file whose content changes after baseline → still throws', () => {
    // Create a tracked file and modify it (pre-existing dirt)
    writeFileSync(join(repo.path, 'shared.txt'), 'original');
    execSync('git add shared.txt && git commit -m "add file"', { cwd: repo.path });
    writeFileSync(join(repo.path, 'shared.txt'), 'pre-existing modification');

    // Capture baseline — baseline fingerprint has content hash of "pre-existing modification"
    const baseline = captureDirtyBaseline(repo.path);
    expect(baseline.length).toBeGreaterThan(0);

    // Phase 5 further modifies the same file — content hash changes
    writeFileSync(join(repo.path, 'shared.txt'), 'phase-5 further edit');

    // Must throw — the live fingerprint no longer matches baseline
    expect(() =>
      runPhase6Preconditions(evalReportPath, 'my-run', repo.path, baseline)
    ).toThrow('Working tree must be clean before verification');
  });

  // R2.b/R2.d updated contract: a NEW untracked file (in any directory) from
  // Phase 5 is auto-tolerated. The directory case formerly threw; it is now
  // accepted into extendedBaseline.
  it('R2.b: pre-existing untracked directory + Phase-5 adds new file inside → does NOT throw, new file added to extendedBaseline', () => {
    // Create an existing untracked file inside a directory
    mkdirSync(join(repo.path, 'pre-dir'), { recursive: true });
    writeFileSync(join(repo.path, 'pre-dir/existing.txt'), 'pre-existing file');

    // Capture baseline — with -uall, baseline has "pre-dir/existing.txt" fingerprint
    const baseline = captureDirtyBaseline(repo.path);
    expect(baseline.some((fp) => fp.includes('pre-dir/existing.txt'))).toBe(true);

    // Phase 5 adds a NEW file inside the same directory
    writeFileSync(join(repo.path, 'pre-dir/new-from-phase5.txt'), 'phase-5 addition');

    // R2.b: ??-only tolerance accepts the new file without throwing.
    const result = runPhase6Preconditions(evalReportPath, 'my-run', repo.path, baseline);
    expect(result.extendedBaseline.some((fp) => fp.includes('pre-dir/new-from-phase5.txt'))).toBe(true);
  });

  it('R7: filename with spaces is fingerprinted correctly (porcelain -z fix)', () => {
    // On porcelain v1 (without -z), filenames with spaces are C-quoted:
    // `?? "my file.txt"` — line.slice(3) yields `"my file.txt"` (with quotes), so
    // existsSync fails and the hash falls back to "", making the fingerprint wrong.
    // Fix: use --porcelain -z so paths are NUL-delimited and never C-quoted.
    writeFileSync(join(repo.path, 'my spaced file.txt'), 'content');

    const baseline = captureDirtyBaseline(repo.path);
    const fp = baseline.find((f) => f.includes('my spaced file.txt'));
    expect(fp).toBeDefined();
    // The hash must be non-empty — confirms existsSync succeeded on the real (unquoted) path
    expect(fp!.split('\0')[2]).not.toBe('');

    // File is in baseline → preconditions must not throw
    expect(() =>
      runPhase6Preconditions(evalReportPath, 'my-run', repo.path, baseline)
    ).not.toThrow();
  });

  it('R6: final clean check respects baseline (baseline entries remain after eval report cleanup)', () => {
    // Pre-existing untracked file
    writeFileSync(join(repo.path, 'preexisting.txt'), 'noise');

    // Capture baseline
    const baseline = captureDirtyBaseline(repo.path);

    // Also create an untracked eval report that will be cleaned up
    writeRepoFile(repo.path, evalReportPath, '# Eval Report');

    // Must not throw — eval report is cleaned, preexisting.txt is in baseline
    expect(() =>
      runPhase6Preconditions(evalReportPath, 'my-run', repo.path, baseline)
    ).not.toThrow();

    // preexisting.txt still exists (baseline filtering, not cleanup)
    expect(existsSync(join(repo.path, 'preexisting.txt'))).toBe(true);
  });
});

describe('commitEvalReport', () => {
  let repo: { path: string; cleanup: () => void };
  let stderrSpy: any;

  beforeEach(() => {
    repo = createTestRepo();
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true as any);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    repo.cleanup();
  });

  it('returns gitignored and warns when eval report path is gitignored', () => {
    writeFileSync(join(repo.path, '.gitignore'), 'docs/\n');
    execSync('git add .gitignore && git commit -m "gitignore"', { cwd: repo.path });

    const baseCommit = getHead(repo.path);
    const runId = 'test-run';
    const state = createInitialState(runId, 'task', baseCommit, false);
    state.artifacts.evalReport = 'docs/process/evals/test-run-eval.md';

    mkdirSync(join(repo.path, 'docs/process/evals'), { recursive: true });
    writeFileSync(join(repo.path, state.artifacts.evalReport), '# Eval\n## Summary\nAll checks passed.\n');

    const headBefore = getHead(repo.path);
    const result = commitEvalReport(state, repo.path);
    const headAfter = getHead(repo.path);

    // R1.c: 'gitignored' is reserved for isPathGitignored === true.
    expect(result).toBe('gitignored');
    // evalCommit not updated (still null), no new commit created
    expect(headAfter).toBe(headBefore);
    expect(state.evalCommit).toBeNull();
    const warnMessages = stderrSpy.mock.calls.map((c: any) => c[0]).join('');
    expect(warnMessages).toContain('gitignored');
  });

  // I1: pre-fix this returned 'skipped' (now removed from the union); per spec
  // a missing file + HEAD-lacks-report MUST throw rather than silently downgrade.
  it('throws when eval report file is absent and HEAD does not contain it (I1)', () => {
    const baseCommit = getHead(repo.path);
    const state = createInitialState('absent-run', 'task', baseCommit, false);
    state.artifacts.evalReport = 'docs/process/evals/absent-run-eval.md';
    // File intentionally does not exist and HEAD does not contain it

    expect(() => commitEvalReport(state, repo.path)).toThrow(/not committed and not present in HEAD/);
  });

  it('commits normally when eval report path is not gitignored', () => {
    const baseCommit = getHead(repo.path);
    const runId = 'test-run';
    const state = createInitialState(runId, 'task', baseCommit, false);
    state.artifacts.evalReport = 'eval-report.md';

    writeFileSync(join(repo.path, state.artifacts.evalReport), '# Eval\n## Summary\nAll checks passed.\n');

    const headBefore = getHead(repo.path);
    const result = commitEvalReport(state, repo.path);
    const headAfter = getHead(repo.path);

    expect(result).toBe('committed');
    expect(headAfter).not.toBe(headBefore);
  });

  // SC2: byte-identical regenerate after P7-reject → P5-reopen cycle must return
  // 'unchanged' (not throw, not 'skipped'). Anchor still resolves to HEAD.
  it("returns 'unchanged' when HEAD already contains the report byte-identically", () => {
    const state = createInitialState('run-id', 'task', 'base-sha', false);
    const filePath = state.artifacts.evalReport;
    writeRepoFile(repo.path, filePath, '# Eval\n\n## Summary\nidentical\n');
    execSync(`git add "${filePath}" && git commit -m "seed"`, { cwd: repo.path });
    // Write identical content (simulates byte-identical regenerate)
    writeRepoFile(repo.path, filePath, '# Eval\n\n## Summary\nidentical\n');
    const result = commitEvalReport(state, repo.path);
    expect(result).toBe('unchanged');
  });

  // Regression: content actually differs → 'committed'.
  it("returns 'committed' when content differs from HEAD (regression)", () => {
    const state = createInitialState('run-id', 'task', 'base-sha', false);
    const filePath = state.artifacts.evalReport;
    writeRepoFile(repo.path, filePath, '# Eval\n\n## Summary\nfirst\n');
    execSync(`git add "${filePath}" && git commit -m "seed"`, { cwd: repo.path });
    const commitsBefore = commitCount(repo.path);
    // Write DIFFERENT content
    writeRepoFile(repo.path, filePath, '# Eval\n\n## Summary\nsecond different content\n');
    const result = commitEvalReport(state, repo.path);
    expect(result).toBe('committed');
    expect(commitCount(repo.path)).toBe(commitsBefore + 1);
  });

  // Regression: .gitignore branch returns 'gitignored' explicitly.
  it("returns 'gitignored' when path is in .gitignore (regression)", () => {
    writeFileSync(join(repo.path, '.gitignore'), 'reports/\n');
    execSync('git add .gitignore && git commit -m gi', { cwd: repo.path });
    const state = createInitialState('gi-run', 'task', 'base-sha', false);
    state.artifacts.evalReport = 'reports/eval.md';
    mkdirSync(join(repo.path, 'reports'), { recursive: true });
    writeFileSync(join(repo.path, 'reports/eval.md'), '# eval\n');
    const result = commitEvalReport(state, repo.path);
    expect(result).toBe('gitignored');
  });

  // Gate-4 P1.2 / I1 invariant: must throw, never silently misclassify as
  // 'gitignored' or 'unchanged'.
  it('throws when no commit was created and HEAD does not contain the report (I1)', () => {
    const state = createInitialState('run-id', 'task', 'base-sha', false);
    // Seed repo with an unrelated commit so HEAD exists, but eval report path
    // is NOT in HEAD's tree.
    writeRepoFile(repo.path, 'README.md', '# repo');
    execSync('git add README.md && git commit -m seed', { cwd: repo.path });
    // Eval report does NOT exist on disk and is NOT in HEAD's tree (so
    // fileStatus === '' → normalize returns false). commitEvalReport must
    // throw, NOT silently return 'gitignored' or 'unchanged'.
    expect(() => commitEvalReport(state, repo.path)).toThrow(/not committed and not present in HEAD/);
  });

  // Gate-4 round-2 P1 / I1: HEAD contains the report, but disk file deleted →
  // must throw, not 'unchanged'.
  it('throws when HEAD contains the report but the working-tree file has been deleted (I1)', () => {
    const state = createInitialState('run-id', 'task', 'base-sha', false);
    const filePath = state.artifacts.evalReport;
    // Seed: commit the report so HEAD has it.
    writeRepoFile(repo.path, filePath, '# Eval\n\n## Summary\nseeded\n');
    execSync(`git add "${filePath}" && git commit -m "seed report"`, { cwd: repo.path });
    // Delete the working-tree file (mid-session disappearance). Do NOT stage
    // the deletion so that fileStatus is ' D' (worktree-only delete).
    // normalizeArtifactCommit's staged guard passes; fileStatus !== '' → it
    // tries to `git add` the missing path which produces no staged content →
    // returns false. commitEvalReport must then THROW because the disk-
    // existence check fails, NOT return 'unchanged'.
    unlinkSync(join(repo.path, filePath));
    expect(() => commitEvalReport(state, repo.path))
      .toThrow(/in HEAD but missing from the working tree/);
  });
});
