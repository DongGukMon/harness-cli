import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { migrateState, createInitialState, syncLegacyMirror } from '../src/state.js';
import { detectTrackedRepos } from '../src/commands/start.js';
import { validatePhaseArtifacts } from '../src/phases/interactive.js';
import { resolveArtifact } from '../src/artifact.js';
import type { HarnessState } from '../src/types.js';

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs.length = 0;
});

function makeTmp(prefix = 'mwt-'): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

function initRepo(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "t@t.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "T"', { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, 'init.txt'), 'x');
  execSync('git add .', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe' });
  return execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf-8' }).trim();
}

// (a) depth=1 scan: cwd not a git repo, depth=1 has 2 git repos
describe('(a) depth=1 auto-detect — non-git outer cwd', () => {
  it('detects exactly depth=1 git repos, skips non-git dirs', () => {
    const outer = makeTmp();
    const repoA = path.join(outer, 'repo-a');
    const repoB = path.join(outer, 'repo-b');
    const notGit = path.join(outer, 'not-git');
    fs.mkdirSync(notGit);
    initRepo(repoA);
    initRepo(repoB);
    const repos = detectTrackedRepos(outer);
    const paths = repos.map(r => r.path).sort();
    expect(paths).toEqual([repoA, repoB].sort());
  });
});

// (b) --track / --exclude
describe('(b) --track / --exclude flag combinations', () => {
  it('--track replaces auto-detect', () => {
    const outer = makeTmp();
    const repoA = path.join(outer, 'a');
    const repoB = path.join(outer, 'b');
    initRepo(repoA); initRepo(repoB);
    const result = detectTrackedRepos(outer, [repoA]);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe(repoA);
  });

  it('--exclude removes from auto-detect', () => {
    const outer = makeTmp();
    const repoA = path.join(outer, 'a');
    const repoB = path.join(outer, 'b');
    initRepo(repoA); initRepo(repoB);
    const result = detectTrackedRepos(outer, undefined, [repoB]);
    expect(result.map(r => r.path)).not.toContain(repoB);
    expect(result.map(r => r.path)).toContain(repoA);
  });
});

// (c) N=2 tracked repos assembler diff concat
describe('(c) assembler diff concat for N=2 repos', () => {
  it('includes ### repo: label for each repo in N=2 case', async () => {
    const { assembleGatePrompt } = await import('../src/context/assembler.js');
    const outer = makeTmp();
    const repoA = path.join(outer, 'repo-a');
    const repoB = path.join(outer, 'repo-b');
    const baseA = initRepo(repoA);
    const baseB = initRepo(repoB);

    // Create docs in repoA (trackedRepos[0])
    fs.mkdirSync(path.join(repoA, 'docs/specs'), { recursive: true });
    fs.mkdirSync(path.join(repoA, 'docs/plans'), { recursive: true });
    fs.mkdirSync(path.join(repoA, 'docs/process/evals'), { recursive: true });
    fs.writeFileSync(path.join(repoA, 'docs/specs/run-design.md'), '# spec\n## Complexity\nMedium');
    fs.writeFileSync(path.join(repoA, 'docs/plans/run.md'), '# plan');
    fs.writeFileSync(path.join(repoA, 'docs/process/evals/run-eval.md'), '# eval');

    const state = createInitialState('run', 'task', baseA, false);
    state.trackedRepos = [
      { path: repoA, baseCommit: baseA, implRetryBase: baseA, implHead: null },
      { path: repoB, baseCommit: baseB, implRetryBase: baseB, implHead: null },
    ];
    state.artifacts = {
      spec: 'docs/specs/run-design.md',
      plan: 'docs/plans/run.md',
      decisionLog: '.harness/run/decisions.md',
      checklist: '.harness/run/checklist.json',
      evalReport: 'docs/process/evals/run-eval.md',
    };
    state.phases['5'] = 'completed';
    state.phases['6'] = 'completed';
    state.implCommit = baseA;
    state.evalCommit = baseA;

    const prompt = assembleGatePrompt(7, state, '', outer);
    expect(typeof prompt).toBe('string');
    if (typeof prompt === 'string') {
      expect(prompt).toContain('### repo: repo-a');
      expect(prompt).toContain('### repo: repo-b');
    }
  });

  it('N=1 trackedRepos[0].path===cwd → no ### repo: label (backward compat)', async () => {
    const { assembleGatePrompt } = await import('../src/context/assembler.js');
    const cwd = makeTmp();
    const base = initRepo(cwd);
    fs.mkdirSync(path.join(cwd, 'docs/specs'), { recursive: true });
    fs.mkdirSync(path.join(cwd, 'docs/plans'), { recursive: true });
    fs.mkdirSync(path.join(cwd, 'docs/process/evals'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'docs/specs/run-design.md'), '# spec\n## Complexity\nMedium');
    fs.writeFileSync(path.join(cwd, 'docs/plans/run.md'), '# plan');
    fs.writeFileSync(path.join(cwd, 'docs/process/evals/run-eval.md'), '# eval');

    const state = createInitialState('run', 'task', base, false);
    state.trackedRepos = [{ path: cwd, baseCommit: base, implRetryBase: base, implHead: null }];
    state.phases['5'] = 'completed';
    state.phases['6'] = 'completed';
    state.implCommit = base;
    state.evalCommit = base;

    const prompt = assembleGatePrompt(7, state, '', cwd);
    if (typeof prompt === 'string') {
      expect(prompt).not.toContain('### repo:');
    }
  });
});

// (d) Phase 5 judgment: "any repo advanced" = success
describe('(d) Phase 5 success: one-of-N advanced', () => {
  it('returns true when only repo-a advanced in a 2-repo setup', () => {
    const outer = makeTmp();
    const repoA = path.join(outer, 'a');
    const repoB = path.join(outer, 'b');
    const headA = initRepo(repoA);
    const headB = initRepo(repoB);

    // Advance repoA
    fs.writeFileSync(path.join(repoA, 'new.txt'), 'impl');
    execSync('git add .', { cwd: repoA, stdio: 'pipe' });
    execSync('git commit -m "impl"', { cwd: repoA, stdio: 'pipe' });
    const newHeadA = execSync('git rev-parse HEAD', { cwd: repoA, encoding: 'utf-8' }).trim();

    const state = createInitialState('r', 't', headA, false);
    state.trackedRepos = [
      { path: repoA, baseCommit: headA, implRetryBase: headA, implHead: null },
      { path: repoB, baseCommit: headB, implRetryBase: headB, implHead: null },
    ];
    const runDir = makeTmp('rundir-');
    const result = validatePhaseArtifacts(5, state, outer, runDir);

    expect(result).toBe(true);
    expect(state.trackedRepos[0].implHead).toBe(newHeadA);
    expect(state.trackedRepos[1].implHead).toBeNull();
    expect(state.implCommit).toBe(newHeadA);
  });
});

// (e) state migration: legacy state.json → trackedRepos synthesis
describe('(e) state migration: legacy → trackedRepos', () => {
  it('synthesizes trackedRepos[0] from top-level fields with provided cwd', () => {
    const legacy = {
      runId: 'run-1',
      baseCommit: 'deadbeef',
      implRetryBase: 'deadbeef',
      implCommit: null,
      flow: 'full',
    };
    const migrated = migrateState(legacy, '/outer/my-repo');
    expect(migrated.trackedRepos).toHaveLength(1);
    expect(migrated.trackedRepos[0].path).toBe('/outer/my-repo');
    expect(migrated.trackedRepos[0].baseCommit).toBe('deadbeef');
    expect(migrated.trackedRepos[0].implHead).toBeNull();
  });

  it('syncLegacyMirror keeps top-level fields in sync with trackedRepos[0]', () => {
    const state = createInitialState('r', 't', 'old', false);
    state.trackedRepos = [
      { path: '/repo', baseCommit: 'new', implRetryBase: 'new', implHead: 'impl' },
    ];
    syncLegacyMirror(state);
    expect(state.baseCommit).toBe('new');
    expect(state.implRetryBase).toBe('new');
    expect(state.implCommit).toBe('impl');
  });
});

// resolveArtifact: uses trackedRepos[0].path
describe('resolveArtifact (FR-7)', () => {
  it('resolves relative path against trackedRepos[0].path', () => {
    const state = createInitialState('r', 't', 'abc', false);
    state.trackedRepos = [{ path: '/repo-a', baseCommit: 'abc', implRetryBase: 'abc', implHead: null }];
    const result = resolveArtifact(state, 'docs/specs/foo.md', '/outer');
    expect(result).toBe('/repo-a/docs/specs/foo.md');
  });

  it('falls back to outerCwd when trackedRepos[0].path is empty string (legacy)', () => {
    const state = createInitialState('r', 't', 'abc', false);
    state.trackedRepos = [{ path: '', baseCommit: 'abc', implRetryBase: 'abc', implHead: null }];
    const result = resolveArtifact(state, 'docs/specs/foo.md', '/outer');
    expect(result).toBe('/outer/docs/specs/foo.md');
  });

  it('.harness/... paths are always anchored to outerCwd, not trackedRepos[0]', () => {
    const state = createInitialState('r', 't', 'abc', false);
    state.trackedRepos = [{ path: '/repo-a', baseCommit: 'abc', implRetryBase: 'abc', implHead: null }];
    const result = resolveArtifact(state, '.harness/run-1/checklist.json', '/outer');
    expect(result).toBe('/outer/.harness/run-1/checklist.json');
  });
});
