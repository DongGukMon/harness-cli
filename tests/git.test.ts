import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, realpathSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import crypto from 'crypto';
import { createTestRepo } from './helpers/test-repo.js';
import {
  getGitRoot,
  getHead,
  isAncestor,
  isWorkingTreeClean,
  hasStagedChanges,
  getStagedFiles,
  generateRunId,
  isPathGitignored,
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
    vi.restoreAllMocks();
    cleanup();
  });

  it('format: produces a slug with 4-hex random suffix', () => {
    const id = generateRunId('Hello World Task', harnessDir);
    expect(id).toMatch(/^\d{4}-\d{2}-\d{2}-hello-world-task-[0-9a-f]{4}$/);
  });

  it('handles Unicode by removing non-ASCII after NFD normalize', () => {
    const id = generateRunId('café au lait', harnessDir);
    expect(id).toMatch(/^\d{4}-\d{2}-\d{2}-cafe-au-lait-[0-9a-f]{4}$/);
  });

  it('truncates slug to 25 chars at word boundary (suffix excluded from slug length)', () => {
    const task = 'implement the full authentication and authorization system for users';
    const id = generateRunId(task, harnessDir);
    // Strip date prefix and 4-hex suffix to isolate the slug
    const withoutDate = id.slice('YYYY-MM-DD-'.length);
    const slug = withoutDate.slice(0, withoutDate.lastIndexOf('-'));
    expect(slug.length).toBeLessThanOrEqual(25);
    expect(slug).not.toMatch(/-$/);
  });

  it('returns "untitled-<rand>" for empty/non-ASCII-only input', () => {
    const id = generateRunId('', harnessDir);
    expect(id).toMatch(/^\d{4}-\d{2}-\d{2}-untitled-[0-9a-f]{4}$/);
  });

  it('redraw on collision: redraws when first random suffix collides', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spy = vi.spyOn(crypto, 'randomBytes') as any;
    spy.mockReturnValueOnce(Buffer.from([0xaa, 0xaa]))
       .mockReturnValueOnce(Buffer.from([0xbb, 0xbb]));

    const datePrefix = new Date().toISOString().slice(0, 10);
    // Pre-create the first candidate directory to force a redraw
    mkdirSync(join(harnessDir, `${datePrefix}-my-task-aaaa`));

    const id = generateRunId('my task', harnessDir);
    expect(id).toMatch(/-bbbb$/);
    spy.mockRestore();
  });

  it('fallback counter: uses -N counter when random space is exhausted', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spy = vi.spyOn(crypto, 'randomBytes') as any;
    spy.mockReturnValue(Buffer.from([0xca, 0xfe]));

    const datePrefix = new Date().toISOString().slice(0, 10);
    // Pre-create the randomized candidate to exhaust all 6 draw attempts
    mkdirSync(join(harnessDir, `${datePrefix}-my-task-cafe`));

    const id = generateRunId('my task', harnessDir);
    expect(id).toBe(`${datePrefix}-my-task-cafe-2`);
    spy.mockRestore();
  });
});

describe('isPathGitignored', () => {
  let repo: { path: string; cleanup: () => void };

  beforeEach(() => {
    repo = createTestRepo();
  });

  afterEach(() => {
    repo.cleanup();
  });

  it('returns true for a path covered by .gitignore', () => {
    writeFileSync(join(repo.path, '.gitignore'), 'docs/\n');
    execSync('git add .gitignore && git commit -m "gitignore"', { cwd: repo.path });
    expect(isPathGitignored('docs/report.md', repo.path)).toBe(true);
  });

  it('returns false for a path not covered by .gitignore', () => {
    writeFileSync(join(repo.path, '.gitignore'), 'docs/\n');
    execSync('git add .gitignore && git commit -m "gitignore"', { cwd: repo.path });
    expect(isPathGitignored('src/index.ts', repo.path)).toBe(false);
  });

  it('returns false in a non-git directory', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'no-git-'));
    try {
      expect(isPathGitignored('anything.md', tmpDir)).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
