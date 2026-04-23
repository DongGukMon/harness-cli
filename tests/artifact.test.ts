import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { createTestRepo } from './helpers/test-repo.js';
import { normalizeArtifactCommit, runPhase6Preconditions, commitEvalReport, captureDirtyBaseline } from '../src/artifact.js';
import { createInitialState } from '../src/state.js';

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

  it('aborts when non-eval untracked files exist', () => {
    // An untracked file that is not the eval report
    writeFileSync(join(repo.path, 'untracked.txt'), 'noise');

    expect(() =>
      runPhase6Preconditions(evalReportPath, 'my-run', repo.path)
    ).toThrow('Working tree must be clean before verification');
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

  it('R6: pre-existing dirty file + Phase-5-introduced dirty file → still throws', () => {
    // Create a pre-existing untracked file
    writeFileSync(join(repo.path, 'preexisting.txt'), 'old content');

    // Capture baseline (only contains preexisting.txt)
    const baseline = captureDirtyBaseline(repo.path);
    expect(baseline.length).toBeGreaterThan(0);

    // Phase 5 introduces a NEW untracked file — not in baseline
    writeFileSync(join(repo.path, 'phase5-new.txt'), 'uncommitted phase-5 work');

    // Must throw — phase5-new.txt is not in baseline
    expect(() =>
      runPhase6Preconditions(evalReportPath, 'my-run', repo.path, baseline)
    ).toThrow('Working tree must be clean before verification');
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

  it('R6: pre-existing untracked directory + Phase-5 adds new file inside → still throws', () => {
    // Create an existing untracked file inside a directory
    mkdirSync(join(repo.path, 'pre-dir'), { recursive: true });
    writeFileSync(join(repo.path, 'pre-dir/existing.txt'), 'pre-existing file');

    // Capture baseline — with -uall, baseline has "pre-dir/existing.txt" fingerprint
    const baseline = captureDirtyBaseline(repo.path);
    expect(baseline.some((fp) => fp.includes('pre-dir/existing.txt'))).toBe(true);

    // Phase 5 adds a NEW file inside the same directory
    writeFileSync(join(repo.path, 'pre-dir/new-from-phase5.txt'), 'phase-5 addition');

    // Must throw — pre-dir/new-from-phase5.txt is not in baseline
    expect(() =>
      runPhase6Preconditions(evalReportPath, 'my-run', repo.path, baseline)
    ).toThrow('Working tree must be clean before verification');
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

  it('skips commit and warns when eval report path is gitignored', () => {
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

    expect(result).toBe('skipped');
    // evalCommit not updated (still null), no new commit created
    expect(headAfter).toBe(headBefore);
    expect(state.evalCommit).toBeNull();
    const warnMessages = stderrSpy.mock.calls.map((c: any) => c[0]).join('');
    expect(warnMessages).toContain('gitignored');
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
});
