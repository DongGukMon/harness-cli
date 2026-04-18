import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, realpathSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { createTestRepo } from './helpers/test-repo.js';
import {
  getGitRoot,
  getHead,
  isAncestor,
  isWorkingTreeClean,
  hasStagedChanges,
  getStagedFiles,
  generateRunId,
} from '../src/git.js';

describe('getGitRoot', () => {
  let repo: { path: string; cleanup: () => void };

  beforeEach(() => {
    repo = createTestRepo();
  });

  afterEach(() => {
    repo.cleanup();
  });

  it('returns repo root path', () => {
    const root = getGitRoot(repo.path);
    // Use realpathSync to normalize symlinks (e.g. /var → /private/var on macOS)
    expect(root).toBe(realpathSync(repo.path));
  });

  it('throws in non-git directory', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'no-git-'));
    try {
      expect(() => getGitRoot(tmpDir)).toThrow();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('getHead', () => {
  let repo: { path: string; cleanup: () => void };

  beforeEach(() => {
    repo = createTestRepo();
  });

  afterEach(() => {
    repo.cleanup();
  });

  it('returns a SHA string', () => {
    const sha = getHead(repo.path);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('isAncestor', () => {
  let repo: { path: string; cleanup: () => void };

  beforeEach(() => {
    repo = createTestRepo();
  });

  afterEach(() => {
    repo.cleanup();
  });

  it('returns true when ancestor is an ancestor of descendant', () => {
    const first = getHead(repo.path);
    execSync('git commit --allow-empty -m "second"', { cwd: repo.path });
    const second = getHead(repo.path);
    expect(isAncestor(first, second, repo.path)).toBe(true);
  });

  it('returns false when not an ancestor', () => {
    const first = getHead(repo.path);
    execSync('git commit --allow-empty -m "second"', { cwd: repo.path });
    const second = getHead(repo.path);
    // second is not an ancestor of first
    expect(isAncestor(second, first, repo.path)).toBe(false);
  });
});

describe('isWorkingTreeClean', () => {
  let repo: { path: string; cleanup: () => void };

  beforeEach(() => {
    repo = createTestRepo();
  });

  afterEach(() => {
    repo.cleanup();
  });

  it('returns true for clean tree', () => {
    expect(isWorkingTreeClean(repo.path)).toBe(true);
  });

  it('returns false when there are untracked or modified files', () => {
    writeFileSync(join(repo.path, 'dirty.txt'), 'dirty');
    expect(isWorkingTreeClean(repo.path)).toBe(false);
  });
});

describe('hasStagedChanges', () => {
  let repo: { path: string; cleanup: () => void };

  beforeEach(() => {
    repo = createTestRepo();
  });

  afterEach(() => {
    repo.cleanup();
  });

  it('returns false when nothing is staged', () => {
    expect(hasStagedChanges(repo.path)).toBe(false);
  });

  it('returns true when files are staged', () => {
    writeFileSync(join(repo.path, 'staged.txt'), 'content');
    execSync('git add staged.txt', { cwd: repo.path });
    expect(hasStagedChanges(repo.path)).toBe(true);
  });
});

describe('getStagedFiles', () => {
  let repo: { path: string; cleanup: () => void };

  beforeEach(() => {
    repo = createTestRepo();
  });

  afterEach(() => {
    repo.cleanup();
  });

  it('returns empty array when nothing is staged', () => {
    expect(getStagedFiles(repo.path)).toEqual([]);
  });

  it('returns list of staged file paths', () => {
    writeFileSync(join(repo.path, 'alpha.txt'), 'a');
    writeFileSync(join(repo.path, 'beta.txt'), 'b');
    execSync('git add alpha.txt beta.txt', { cwd: repo.path });
    const staged = getStagedFiles(repo.path);
    expect(staged).toContain('alpha.txt');
    expect(staged).toContain('beta.txt');
    expect(staged).toHaveLength(2);
  });
});

describe('generateRunId', () => {
  let harnessDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    harnessDir = mkdtempSync(join(tmpdir(), 'harness-runs-'));
    cleanup = () => rmSync(harnessDir, { recursive: true, force: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('produces a basic slug', () => {
    const id = generateRunId('Hello World Task', harnessDir);
    // Should start with date and contain slug
    expect(id).toMatch(/^\d{4}-\d{2}-\d{2}-hello-world-task$/);
  });

  it('handles Unicode by removing non-ASCII after NFD normalize', () => {
    // "café" NFD-normalizes so the accent becomes a combining char that gets stripped
    const id = generateRunId('café au lait', harnessDir);
    expect(id).toMatch(/^\d{4}-\d{2}-\d{2}-cafe-au-lait$/);
  });

  it('truncates slug to 25 chars at word boundary', () => {
    // Create a task that produces a slug longer than 25 chars
    const task = 'implement the full authentication and authorization system for users';
    const id = generateRunId(task, harnessDir);
    const slug = id.slice('YYYY-MM-DD-'.length);
    expect(slug.length).toBeLessThanOrEqual(25);
    // Should not end with a partial word (no trailing -)
    expect(slug).not.toMatch(/-$/);
  });

  it('returns "untitled" for empty/non-ASCII-only input', () => {
    const id = generateRunId('', harnessDir);
    expect(id).toMatch(/^\d{4}-\d{2}-\d{2}-untitled$/);
  });

  it('appends dedup suffix when directory already exists', () => {
    const first = generateRunId('my task', harnessDir);
    // Simulate the directory being created
    mkdirSync(join(harnessDir, first));
    const second = generateRunId('my task', harnessDir);
    expect(second).toBe(`${first}-2`);
  });
});
