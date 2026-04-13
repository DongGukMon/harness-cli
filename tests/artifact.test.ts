import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { createTestRepo } from './helpers/test-repo.js';
import { normalizeArtifactCommit, runPhase6Preconditions } from '../src/artifact.js';

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

  it('git rm + commit for tracked eval report', () => {
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
    // A new commit should have been created
    const headAfter = getHead(repo.path);
    expect(headAfter).not.toBe(headBefore);
    // Tree should be clean
    const status = execSync('git status --porcelain', { cwd: repo.path, encoding: 'utf-8' }).trim();
    expect(status).toBe('');
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
});
