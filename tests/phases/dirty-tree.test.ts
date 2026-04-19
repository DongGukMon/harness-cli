import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import {
  tryAutoRecoverDirtyTree,
  writeDirtyTreeDiagnostic,
} from '../../src/phases/dirty-tree.js';

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
});

function makeRepo(prefix = 'dirty-tree-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email "t@t" && git config user.name "t"', { cwd: dir });
  execSync('git commit --allow-empty -q -m "init"', { cwd: dir });
  return dir;
}

function touch(cwd: string, rel: string, body = ''): void {
  const abs = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

function porcelain(cwd: string): string {
  return execSync('git status --porcelain', { cwd, encoding: 'utf-8' }).trim();
}

describe('tryAutoRecoverDirtyTree', () => {
  it('returns clean when working tree is already empty', () => {
    const cwd = makeRepo();
    const result = tryAutoRecoverDirtyTree(cwd, 'run-1');
    expect(result.outcome).toBe('clean');
    expect(result.addedEntries).toEqual([]);
  });

  it('recovers python __pycache__ residuals under a tracked parent dir', () => {
    const cwd = makeRepo();
    // Parent dir must be tracked so porcelain surfaces __pycache__/ directly
    // rather than collapsing to "?? app/".
    touch(cwd, 'app/main.py', 'print("hi")');
    execSync('git add app/main.py && git commit -q -m "scaffold app"', { cwd });
    touch(cwd, 'app/__pycache__/foo.pyc', 'bytecode');

    const before = porcelain(cwd);
    expect(before).toContain('__pycache__');

    const result = tryAutoRecoverDirtyTree(cwd, 'run-py');
    expect(result.outcome).toBe('recovered');
    expect(result.addedEntries).toEqual(expect.arrayContaining(['__pycache__/']));
    expect(porcelain(cwd)).toBe('');
    expect(fs.readFileSync(path.join(cwd, '.gitignore'), 'utf-8')).toMatch(/__pycache__\//);
  });

  it('blocks when an entire new untracked dir contains residuals (safety)', () => {
    // Fresh "app/" directory containing __pycache__ is collapsed by git porcelain
    // to `?? app/`. Auto-recovery must refuse — the dir may hold real code.
    const cwd = makeRepo();
    touch(cwd, 'app/__pycache__/foo.pyc', 'bytecode');
    const result = tryAutoRecoverDirtyTree(cwd, 'run-fresh-dir');
    expect(result.outcome).toBe('blocked');
    expect(result.blockers.join('\n')).toMatch(/app\//);
  });

  it('recovers pytest cache residuals', () => {
    const cwd = makeRepo();
    touch(cwd, '.pytest_cache/v/cache/nodeids', '[]');
    const result = tryAutoRecoverDirtyTree(cwd, 'run-pt');
    expect(result.outcome).toBe('recovered');
    expect(result.addedEntries).toEqual(expect.arrayContaining(['.pytest_cache/']));
    expect(porcelain(cwd)).toBe('');
  });

  it('recovers node_modules residuals', () => {
    const cwd = makeRepo();
    touch(cwd, 'node_modules/foo/package.json', '{}');
    const result = tryAutoRecoverDirtyTree(cwd, 'run-nm');
    expect(result.outcome).toBe('recovered');
    expect(result.addedEntries).toEqual(expect.arrayContaining(['node_modules/']));
  });

  it('blocks on tracked-modified file', () => {
    const cwd = makeRepo();
    touch(cwd, 'README.md', 'v1');
    execSync('git add README.md && git commit -q -m "readme"', { cwd });
    fs.writeFileSync(path.join(cwd, 'README.md'), 'v2'); // tracked-modified
    const result = tryAutoRecoverDirtyTree(cwd, 'run-mod');
    expect(result.outcome).toBe('blocked');
    expect(result.blockers.join('\n')).toMatch(/README\.md/);
  });

  it('blocks on unknown untracked file', () => {
    const cwd = makeRepo();
    touch(cwd, 'docs/notes.txt', 'notes'); // not in allowlist
    // docs/ is a fresh untracked dir → porcelain collapses to "?? docs/".
    const result = tryAutoRecoverDirtyTree(cwd, 'run-unk');
    expect(result.outcome).toBe('blocked');
    expect(result.blockers.join('\n')).toMatch(/docs\//);
  });

  it('is a no-op when .gitignore already contains entry and residual is already ignored', () => {
    const cwd = makeRepo();
    fs.writeFileSync(path.join(cwd, '.gitignore'), '__pycache__/\n');
    execSync('git add .gitignore && git commit -q -m "ignore"', { cwd });
    touch(cwd, 'app/__pycache__/foo.pyc', 'bytecode');
    // Already-ignored untracked file → porcelain is empty
    expect(porcelain(cwd)).toBe('');
    const result = tryAutoRecoverDirtyTree(cwd, 'run-idem');
    expect(result.outcome).toBe('clean');
  });

  it('creates .gitignore when missing', () => {
    const cwd = makeRepo();
    expect(fs.existsSync(path.join(cwd, '.gitignore'))).toBe(false);
    // Tracked parent so __pycache__/ surfaces directly in porcelain.
    touch(cwd, 'app/main.py', 'print("hi")');
    execSync('git add app/main.py && git commit -q -m "scaffold"', { cwd });
    touch(cwd, 'app/__pycache__/foo.pyc', 'x');
    const result = tryAutoRecoverDirtyTree(cwd, 'run-create');
    expect(result.outcome).toBe('recovered');
    expect(fs.existsSync(path.join(cwd, '.gitignore'))).toBe(true);
  });

  it('commits with the expected chore message and includes runId', () => {
    const cwd = makeRepo();
    touch(cwd, 'app/main.py', 'print("hi")');
    execSync('git add app/main.py && git commit -q -m "scaffold"', { cwd });
    touch(cwd, 'app/__pycache__/foo.pyc', 'x');
    const result = tryAutoRecoverDirtyTree(cwd, 'abcd-1234');
    expect(result.outcome).toBe('recovered');
    const last = execSync('git log -1 --format=%s', { cwd, encoding: 'utf-8' }).trim();
    expect(last).toBe('chore(harness): auto-ignore residual artifacts [abcd-1234]');
  });
});

describe('writeDirtyTreeDiagnostic', () => {
  it('writes <runDir>/phase-5-dirty-tree.md with reason + porcelain body', () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-'));
    tmpDirs.push(runDir);
    writeDirtyTreeDiagnostic(runDir, 'blocked', '?? unknown.txt\nM README.md');
    const body = fs.readFileSync(path.join(runDir, 'phase-5-dirty-tree.md'), 'utf-8');
    expect(body).toMatch(/# Phase 5 — Dirty Tree/);
    expect(body).toMatch(/reason: blocked/);
    expect(body).toMatch(/unknown\.txt/);
    expect(body).toMatch(/harness resume/);
    expect(body).toMatch(/harness jump 5/);
  });

  it('distinguishes strict-tree from blocked header', () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diag2-'));
    tmpDirs.push(runDir);
    writeDirtyTreeDiagnostic(runDir, 'strict-tree', '?? foo.py');
    const body = fs.readFileSync(path.join(runDir, 'phase-5-dirty-tree.md'), 'utf-8');
    expect(body).toMatch(/strict-tree enabled/);
    expect(body).toMatch(/reason: strict-tree/);
  });
});
