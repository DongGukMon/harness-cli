import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { detectTrackedRepos } from '../../src/commands/start.js';

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs.length = 0;
});

function makeTmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'start-test-'));
  tmpDirs.push(d);
  return d;
}

function initGitRepo(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "t@t.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "T"', { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, 'init.txt'), 'x');
  execSync('git add .', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe' });
  return execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf-8' }).trim();
}

describe('detectTrackedRepos — auto-detect depth=1 (ADR-N2)', () => {
  it('returns [cwd] single-entry when cwd is a git repo', () => {
    const outer = makeTmp();
    initGitRepo(outer);
    const result = detectTrackedRepos(outer);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe(outer);
  });

  it('auto-detects depth=1 git repos when cwd is not a git repo', () => {
    const outer = makeTmp();
    const repoA = path.join(outer, 'repo-a');
    const repoB = path.join(outer, 'repo-b');
    initGitRepo(repoA);
    initGitRepo(repoB);
    const result = detectTrackedRepos(outer);
    expect(result).toHaveLength(2);
    const paths = result.map(r => r.path).sort();
    expect(paths).toEqual([repoA, repoB].sort());
  });

  it('skips hidden dirs, node_modules, dist, build, .harness in auto-detect', () => {
    const outer = makeTmp();
    for (const skip of ['.hidden', 'node_modules', 'dist', 'build', '.harness']) {
      initGitRepo(path.join(outer, skip));
    }
    initGitRepo(path.join(outer, 'real-repo'));
    const result = detectTrackedRepos(outer);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe(path.join(outer, 'real-repo'));
  });

  it('throws when no repos found and no --track', () => {
    const outer = makeTmp();
    expect(() => detectTrackedRepos(outer)).toThrow(
      'No tracked git repos found under cwd.'
    );
  });
});

describe('detectTrackedRepos — --track / --exclude (FR-10)', () => {
  it('--track overrides auto-detect entirely', () => {
    const outer = makeTmp();
    const repoA = path.join(outer, 'repo-a');
    const repoB = path.join(outer, 'repo-b');
    initGitRepo(repoA);
    initGitRepo(repoB);
    const result = detectTrackedRepos(outer, [repoA]);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe(repoA);
  });

  it('--exclude removes from auto-detect result', () => {
    const outer = makeTmp();
    const repoA = path.join(outer, 'repo-a');
    const repoB = path.join(outer, 'repo-b');
    initGitRepo(repoA);
    initGitRepo(repoB);
    const result = detectTrackedRepos(outer, undefined, [repoB]);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe(repoA);
  });

  it('--track with out-of-tree path throws (cwd-descendant rule)', () => {
    const outer = makeTmp();
    const outside = makeTmp();
    initGitRepo(outside);
    expect(() => detectTrackedRepos(outer, [outside])).toThrow(
      'must be inside cwd'
    );
  });

  it('--track with non-existent path throws', () => {
    const outer = makeTmp();
    expect(() => detectTrackedRepos(outer, [path.join(outer, 'nonexistent')])).toThrow(
      'path not found'
    );
  });

  it('--track with non-git path throws', () => {
    const outer = makeTmp();
    const notGit = path.join(outer, 'notgit');
    fs.mkdirSync(notGit);
    expect(() => detectTrackedRepos(outer, [notGit])).toThrow(
      'not a git repo'
    );
  });

  it('result is alphabetically sorted (deterministic)', () => {
    const outer = makeTmp();
    for (const name of ['z-repo', 'a-repo', 'm-repo']) {
      initGitRepo(path.join(outer, name));
    }
    const result = detectTrackedRepos(outer);
    const names = result.map(r => path.basename(r.path));
    expect(names).toEqual(['a-repo', 'm-repo', 'z-repo']);
  });
});
