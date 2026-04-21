import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { createTestRepo } from './helpers/test-repo.js';
import { normalizeArtifactCommit, runPhase6Preconditions, commitEvalReport } from '../src/artifact.js';
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
