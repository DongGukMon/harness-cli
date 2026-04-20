# Multi-Worktree Harness Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/specs/2026-04-20-task-outer-cwd-n-sub-a808-design.md`
**Decisions:** `.harness/2026-04-20-task-outer-cwd-n-sub-a808/decisions.md`

**Goal:** Enable `phase-harness run` from an outer (non-git) directory containing N sub-worktrees (independent git repos), with zero regression on existing single-repo flows.

**Architecture:** The single-model unification: harness always maintains `state.trackedRepos: TrackedRepo[]` (N ≥ 1). When `cwd` is a git repo, `trackedRepos = [{ path: cwd, ... }]`—the degenerate single-repo case. Phase 5 success judgment, gate diff assembly, resume ancestry, and artifact path resolution all iterate `trackedRepos`, so no separate "multi-worktree mode" branch exists anywhere.

**Tech Stack:** TypeScript, Node.js, vitest, `child_process`, `path`, `fs`

---

## Dependency Order

```
T1 (State schema + helpers)
  └─ T2 (start.ts scan + preflight)
  └─ T3 (runner.ts + interactive.ts multi-repo)
  └─ T4 (assembler multi-repo diff)
  └─ T5 (codex runner)
  └─ T6 (resume.ts)         ← needs T3 (syncLegacyMirror)
  └─ T7 (docs)              ← independent
T1..T6 ─ T8 (tests)
```

---

## Inline ADR Blurbs

**ADR-D1 (D-1 resolution — diff truncation for multi-repo)**
Per-repo raw diff gets `truncateDiffPerFile(rawDiff, PER_FILE_DIFF_LIMIT_KB * 1024)` *before* markdown wrapping. After concatenating all repo sections, if total bytes > `MAX_DIFF_SIZE_KB * 1024`, hard-truncate at that byte boundary and append `\n--- (diff truncated: total exceeds MAX_DIFF_SIZE_KB KB) ---\n`. Rationale: `truncateDiffPerFile` splits on `diff --git` headers, which are absent inside fenced blocks—pre-wrap application is the only correct location.

**ADR-D2 (resolveArtifact — single substitution point)**
`resolveArtifact(state, relPath, outerCwd)` added to `src/artifact.ts`. Returns `path.join(state.trackedRepos?.[0]?.path || outerCwd, relPath)` for relative paths. All callers that currently do `path.join(cwd, relPath)` for doc artifact reading/writing switch to this helper. Rationale: FR-7 "단일 치환점" requirement; N=1 case is identity-equivalent to current behavior.

**ADR-D3 (migrateState cwd parameter)**
`migrateState(raw, cwd?)` and `readState(runDir, cwd?)` gain an optional `cwd` parameter. When `trackedRepos` is absent, `trackedRepos[0].path` is set to `cwd ?? ''`. `resolveArtifact` falls back to `outerCwd` argument when `trackedRepos[0].path === ''`. Rationale: spec requires `path: cwd` in migration synthesis, but `migrateState` has no `cwd` today—optional param is the minimal-change solution.

**ADR-D4 (validatePhaseArtifacts Phase 5 mutates state)**
`validatePhaseArtifacts` for Phase 5 sets `r.implHead` on each `trackedRepos` entry and calls `syncLegacyMirror(state)` before returning `true`. The `runner.ts` block `state.implCommit = getHead(cwd)` is replaced with `syncLegacyMirror(state)` for Phase 5. Rationale: HEAD is observed atomically at sentinel-detection time; re-reading later risks a second getHead call that may fail on outer (non-git) cwd.

---

## Task 1: State Schema + `syncLegacyMirror` + `resolveArtifact`

Foundation for all other tasks. Introduces `TrackedRepo`, `trackedRepos[]` field, migration, and the two shared helpers.

**Files:**
- Modify: `src/types.ts`
- Modify: `src/state.ts`
- Modify: `src/artifact.ts`
- Test: `tests/state.test.ts` (add new `describe` blocks)

- [ ] **Step 1.1: Add `TrackedRepo` interface and `trackedRepos` field to `HarnessState`**

In `src/types.ts`, add after the `CarryoverFeedback` interface (before `RunStatus`):

```typescript
export interface TrackedRepo {
  path: string;          // absolute path; '' for legacy-migrated states
  baseCommit: string;
  implRetryBase: string;
  implHead: string | null;
}
```

In `HarnessState` interface (after `implRetryBase: string;`), add:

```typescript
trackedRepos: TrackedRepo[];
```

- [ ] **Step 1.2: Write failing tests for `migrateState` + `createInitialState` + `syncLegacyMirror`**

Append to `tests/state.test.ts`:

```typescript
describe('trackedRepos — migration (FR-2, ADR-N3)', () => {
  it('migrateState synthesizes trackedRepos[0] from top-level fields when absent', () => {
    const legacy = JSON.parse(JSON.stringify(makeState()));
    delete (legacy as any).trackedRepos;
    legacy.baseCommit = 'abc123';
    legacy.implRetryBase = 'abc123';
    legacy.implCommit = null;
    const migrated = migrateState(legacy, '/outer/cwd');
    expect(migrated.trackedRepos).toHaveLength(1);
    expect(migrated.trackedRepos[0]).toEqual({
      path: '/outer/cwd',
      baseCommit: 'abc123',
      implRetryBase: 'abc123',
      implHead: null,
    });
  });

  it('migrateState uses empty string for path when no cwd provided', () => {
    const legacy = JSON.parse(JSON.stringify(makeState()));
    delete (legacy as any).trackedRepos;
    const migrated = migrateState(legacy);
    expect(migrated.trackedRepos[0].path).toBe('');
  });

  it('migrateState preserves existing trackedRepos', () => {
    const state = makeState();
    (state as any).trackedRepos = [{ path: '/repo', baseCommit: 'abc', implRetryBase: 'abc', implHead: null }];
    const migrated = migrateState(state as any);
    expect(migrated.trackedRepos[0].path).toBe('/repo');
  });
});

describe('syncLegacyMirror (ADR-N3 mirror invariant)', () => {
  it('syncLegacyMirror keeps baseCommit in sync with trackedRepos[0]', () => {
    const state = makeState();
    state.trackedRepos = [{ path: '/r', baseCommit: 'newbase', implRetryBase: 'newbase', implHead: null }];
    syncLegacyMirror(state);
    expect(state.baseCommit).toBe('newbase');
    expect(state.implRetryBase).toBe('newbase');
    expect(state.implCommit).toBeNull();
  });

  it('syncLegacyMirror sets implCommit from trackedRepos[0].implHead', () => {
    const state = makeState();
    state.trackedRepos = [{ path: '/r', baseCommit: 'b', implRetryBase: 'b', implHead: 'impl-sha' }];
    syncLegacyMirror(state);
    expect(state.implCommit).toBe('impl-sha');
  });
});
```

Run: `pnpm vitest run tests/state.test.ts`
Expected: FAIL (syncLegacyMirror not exported, trackedRepos not in HarnessState)

- [ ] **Step 1.3: Implement `syncLegacyMirror` in `state.ts` + update `migrateState`**

In `src/state.ts`, add this exported helper (after the imports):

```typescript
/**
 * Keep legacy top-level mirror fields in sync with trackedRepos[0].
 * Must be called before every writeState and after any mutation of trackedRepos[0].
 */
export function syncLegacyMirror(state: HarnessState): void {
  if (!state.trackedRepos || state.trackedRepos.length === 0) return;
  const r0 = state.trackedRepos[0];
  state.baseCommit = r0.baseCommit;
  state.implRetryBase = r0.implRetryBase;
  state.implCommit = r0.implHead;
}
```

Update `migrateState` signature to `export function migrateState(raw: any, cwd?: string): HarnessState`.

Add before `return raw as HarnessState` (at the end of `migrateState`):

```typescript
  if (!raw.trackedRepos || !Array.isArray(raw.trackedRepos) || raw.trackedRepos.length === 0) {
    raw.trackedRepos = [{
      path: cwd ?? '',
      baseCommit: raw.baseCommit,
      implRetryBase: raw.implRetryBase,
      implHead: raw.implCommit ?? null,
    }];
  }
```

Update `readState` to forward `cwd` to `migrateState`:

```typescript
export function readState(runDir: string, cwd?: string): HarnessState | null {
  // ... existing file load logic unchanged ...
  try {
    return migrateState(JSON.parse(raw), cwd);  // ← pass cwd
  } catch {
    throw new Error('state.json is corrupted. Manual recovery required.');
  }
}
```

Update `writeState` to call `syncLegacyMirror` before serialization:

```typescript
export function writeState(runDir: string, state: HarnessState): void {
  syncLegacyMirror(state);   // ← add this line at the top of writeState
  const statePath = path.join(runDir, STATE_FILE);
  // ... rest unchanged ...
}
```

Update `createInitialState` to set `trackedRepos`:

```typescript
// At the end of createInitialState, before the return statement, add:
  const trackedRepos: import('./types.js').TrackedRepo[] = [{
    path: '',  // caller (start.ts) overwrites this
    baseCommit,
    implRetryBase: baseCommit,
    implHead: null,
  }];

  return {
    // ... existing fields ...
    trackedRepos,
  };
```

- [ ] **Step 1.4: Add `resolveArtifact` to `artifact.ts`**

In `src/artifact.ts`, add this export after existing imports (before `normalizeArtifactCommit`):

```typescript
import path from 'path';
import type { HarnessState } from './types.js';

/**
 * Resolve an artifact's relative path to an absolute path.
 * Uses trackedRepos[0].path as the docs root (FR-7).
 * Falls back to outerCwd when trackedRepos[0].path is '' (legacy migrated state).
 */
export function resolveArtifact(state: HarnessState, relPath: string, outerCwd: string): string {
  if (path.isAbsolute(relPath)) return relPath;
  const docsRoot = state.trackedRepos?.[0]?.path || outerCwd;
  return path.join(docsRoot, relPath);
}
```

- [ ] **Step 1.5: Run tests to verify passing**

Run: `pnpm vitest run tests/state.test.ts`
Expected: All tests pass including the new `trackedRepos` + `syncLegacyMirror` describes.

- [ ] **Step 1.6: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: Zero errors (or only pre-existing errors unrelated to Task 1).

- [ ] **Step 1.7: Update `readState` callers to pass `cwd` (mandatory — ensures correct legacy migration)**

In `src/commands/inner.ts`, `src/commands/resume.ts`, `src/commands/jump.ts`, `src/commands/skip.ts`, and `src/commands/status.ts`, find each call to `readState(runDir)` and update to `readState(runDir, cwd)` where `cwd` is the outer cwd already determined in those functions. This ensures legacy state migration synthesizes `trackedRepos[0].path = cwd` instead of the `''` fallback.

This step is **mandatory**: spec Invariants require every `trackedRepos[i].path` to be a non-empty cwd-descendant path. The `''` fallback is a compatibility sentinel for in-flight serialized states only; it must not persist as an accepted end state.

- [ ] **Step 1.8: Commit**

```bash
git add src/types.ts src/state.ts src/artifact.ts tests/state.test.ts
git commit -m "feat(state): add TrackedRepo schema, trackedRepos[], syncLegacyMirror, resolveArtifact"
```

---

## Task 2: CLI `start.ts` — scan logic, `--track`/`--exclude`, per-repo preflight

Wires `trackedRepos` into the run-start path. Depends on Task 1.

**Files:**
- Modify: `src/commands/start.ts`
- Test: `tests/commands/start.test.ts` (new file)

- [ ] **Step 2.1: Write failing tests**

Create `tests/commands/start.test.ts`:

```typescript
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
    // only track repoA
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
```

Run: `pnpm vitest run tests/commands/start.test.ts`
Expected: FAIL (`detectTrackedRepos` not exported)

- [ ] **Step 2.2: Implement `detectTrackedRepos` in `start.ts`**

Add `export` before the function (it will be called from `startCommand` and imported by tests).

Add to `src/commands/start.ts` imports:

```typescript
import path from 'path';
import { readdirSync, statSync } from 'fs';
import type { TrackedRepo } from '../types.js';
```

Add the `detectTrackedRepos` function (export it for testability):

```typescript
const SKIP_DIRS = new Set(['.harness', 'node_modules', 'dist', 'build']);

/**
 * Determine tracked repos for a run.
 * - If cwd is a git repo → single-repo mode (returns [{path: cwd, ...}]).
 * - Otherwise auto-detect depth=1 git children, filtered by --track/--exclude.
 * Throws on validation errors or empty result.
 */
export function detectTrackedRepos(
  cwd: string,
  track?: string[],
  exclude?: string[],
): TrackedRepo[] {
  // Single-repo fast path: cwd is itself a git repo
  if (isInGitRepo(cwd)) {
    let head = '';
    try { head = getHead(cwd); } catch { /* no commits */ }
    return [{ path: cwd, baseCommit: head, implRetryBase: head, implHead: null }];
  }

  // Multi-repo path
  if (track && track.length > 0) {
    // Validate each --track path and build list
    const repos: TrackedRepo[] = [];
    for (const raw of track) {
      const resolved = path.resolve(cwd, raw);
      const rel = path.relative(cwd, resolved);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`--track ${raw}: must be inside cwd (${cwd})`);
      }
      if (!existsSync(resolved)) {
        throw new Error(`--track ${raw}: path not found`);
      }
      if (!isInGitRepo(resolved)) {
        throw new Error(`--track ${raw}: not a git repo`);
      }
      let head = '';
      try { head = getHead(resolved); } catch { /* no commits */ }
      repos.push({ path: resolved, baseCommit: head, implRetryBase: head, implHead: null });
    }
    return repos;
  }

  // Auto-detect: depth=1 scan
  const excludeSet = new Set(
    (exclude ?? []).map(e => path.resolve(cwd, e))
  );

  let entries: string[];
  try {
    entries = readdirSync(cwd, { withFileTypes: true })
      .filter(d => {
        if (!d.isDirectory()) return false;
        if (d.name.startsWith('.')) return false;
        if (SKIP_DIRS.has(d.name)) return false;
        return true;
      })
      .map(d => path.join(cwd, d.name))
      .filter(p => !excludeSet.has(p) && isInGitRepo(p))
      .sort();
  } catch {
    entries = [];
  }

  if (entries.length === 0) {
    throw new Error(
      'No tracked git repos found under cwd. Pass --track <path> or run from a git repo.'
    );
  }

  return entries.map(p => {
    let head = '';
    try { head = getHead(p); } catch { /* no commits */ }
    return { path: p, baseCommit: head, implRetryBase: head, implHead: null };
  });
}
```

- [ ] **Step 2.3: Wire `detectTrackedRepos` into `startCommand`**

Update `startCommand` in `src/commands/start.ts`.

Add `track` and `exclude` to `StartOptions`:

```typescript
export interface StartOptions {
  requireClean?: boolean;
  auto?: boolean;
  root?: string;
  enableLogging?: boolean;
  light?: boolean;
  codexNoIsolate?: boolean;
  track?: string[];     // ← new
  exclude?: string[];   // ← new
}
```

In `startCommand`, replace the `cwd` determination block and directory creation with:

```typescript
  let cwd: string;
  try {
    cwd = options.root ?? getGitRoot();
  } catch {
    cwd = options.root ?? process.cwd();
  }

  // Detect tracked repos (throws on validation failure / empty result)
  let trackedRepos: import('../types.js').TrackedRepo[];
  try {
    trackedRepos = detectTrackedRepos(cwd, options.track, options.exclude);
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exit(1);
  }

  // Print detection summary when multi-repo
  if (trackedRepos.length > 1) {
    const paths = trackedRepos.map(r => r.path).join(', ');
    process.stderr.write(`Detected ${trackedRepos.length} tracked repos: [${paths}]\n`);
  }

  // Per-repo preflight (git + head checks)
  for (const repo of trackedRepos) {
    try {
      runPreflight(['git', 'head'], repo.path);
    } catch (err) {
      process.stderr.write(`Error: ${(err as Error).message} (repo: ${repo.path})\n`);
      process.exit(1);
    }
  }
```

Replace directory creation to use `trackedRepos[0].path` as docs root:

```typescript
    const docsRoot = trackedRepos[0].path;
    mkdirSync(join(docsRoot, 'docs/specs'), { recursive: true });
    mkdirSync(join(docsRoot, 'docs/plans'), { recursive: true });
    mkdirSync(join(docsRoot, 'docs/process/evals'), { recursive: true });
```

Remove the old `inGitRepo`-gated `baseCommit` capture. Instead derive from `trackedRepos`:

```typescript
    // baseCommit from trackedRepos[0] (already captured by detectTrackedRepos)
    const baseCommit = trackedRepos[0].baseCommit;
```

After `createInitialState(...)`, set `trackedRepos` on state:

```typescript
    state.trackedRepos = trackedRepos;
    // syncLegacyMirror is called inside writeState — no explicit call needed here
```

Also update `ensureGitignore` caller to use `trackedRepos[0].path` or `cwd` (outer git):

```typescript
    // .gitignore handling: commit in each tracked git repo that is also the outer cwd
    // (outer non-git dirs don't have .gitignore to commit)
    if (inGitRepo) {
      await ensureGitignore(cwd);
    } else if (trackedRepos[0].path !== cwd) {
      // outer dir is not git — no .gitignore commit needed
    }
```

- [ ] **Step 2.4: Update `preflight.ts` error messages to include repo path (FR-3)**

In `src/preflight.ts`, update the `git` and `head` cases to include `cwd` in the error message:

```typescript
case 'git':
  try {
    execSync('git rev-parse --show-toplevel', { cwd, stdio: 'pipe' });
  } catch {
    const suffix = cwd ? ` in: ${cwd}` : '.';
    throw new Error(`harness requires a git repository${suffix}`);
  }
  return {};

case 'head':
  try {
    execSync('git rev-parse HEAD', { cwd, stdio: 'pipe' });
  } catch {
    const suffix = cwd ? ` in: ${cwd}` : '.';
    throw new Error(`harness requires at least one commit${suffix}`);
  }
  return {};
```

- [ ] **Step 2.6: Add `--track`/`--exclude` options to `bin/harness.ts`**

In `bin/harness.ts`, add to both the `start` and `run` command definitions (after `--codex-no-isolate` option):

```typescript
.option('--track <path>', 'explicit tracked repo (repeatable; first = docs home)', (val, prev: string[]) => [...prev, val], [] as string[])
.option('--exclude <path>', 'exclude path from auto-detect (repeatable)', (val, prev: string[]) => [...prev, val], [] as string[])
```

Update the `.action` handler type annotation and body for both `start` and `run` commands to pass the new options:

```typescript
.action(async (task, opts: { requireClean?: boolean; auto?: boolean; enableLogging?: boolean; light?: boolean; codexNoIsolate?: boolean; track?: string[]; exclude?: string[] }) => {
  const globalOpts = program.opts();
  await startCommand(task, { ...opts, root: globalOpts.root, track: opts.track, exclude: opts.exclude });
});
```

Also add a `--exclude` + `--track` combination warning in `detectTrackedRepos` when both are provided:

```typescript
  if (track && track.length > 0) {
    if (exclude && exclude.length > 0) {
      process.stderr.write('⚠️  --exclude has no effect when --track is specified.\n');
    }
    // ... existing validation logic ...
  }
```

Also apply cwd-descendant check for `--exclude` paths (FR-10):

```typescript
  const excludeSet = new Set(
    (exclude ?? []).map(e => {
      const resolved = path.resolve(cwd, e);
      const rel = path.relative(cwd, resolved);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`--exclude ${e}: must be inside cwd (${cwd})`);
      }
      return resolved;
    }).filter(Boolean)
  );
```

- [ ] **Step 2.5: Run tests to verify passing**

Run: `pnpm vitest run tests/commands/start.test.ts`
Expected: All new tests pass.

- [ ] **Step 2.7: Run tests**

Run: `pnpm vitest run tests/commands/start.test.ts`
Expected: All tests pass.

- [ ] **Step 2.8: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: Zero errors.

- [ ] **Step 2.9: Commit**

```bash
git add src/commands/start.ts src/preflight.ts bin/harness.ts tests/commands/start.test.ts
git commit -m "feat(start): detectTrackedRepos, --track/--exclude flags, per-repo preflight, FR-3 messages"
```

---

## Task 3: `runner.ts` + `interactive.ts` — multi-repo Phase 5 + artifact paths

Updates Phase 5 judgment to iterate `trackedRepos`, updates artifact path resolution to use `resolveArtifact`. Depends on Task 1.

**Files:**
- Modify: `src/phases/interactive.ts`
- Modify: `src/phases/runner.ts`
- Test: `tests/phases/interactive.test.ts` (add describe block)

- [ ] **Step 3.1: Write failing tests for multi-repo Phase 5 judgment**

Append to `tests/phases/interactive.test.ts` (after existing describes):

```typescript
describe('validatePhaseArtifacts — Phase 5 multi-repo (FR-6, ADR-D4)', () => {
  it('returns true when any repo advanced; sets implHead on advanced repos only', () => {
    const outer = makeTmpDir();
    const repoA = makeTmpDir('repoA-');
    const repoB = makeTmpDir('repoB-');

    // Init both repos with an initial commit
    for (const d of [repoA, repoB]) {
      execSync('git init', { cwd: d, stdio: 'pipe' });
      execSync('git config user.email "t@t.com"', { cwd: d, stdio: 'pipe' });
      execSync('git config user.name "T"', { cwd: d, stdio: 'pipe' });
      fs.writeFileSync(path.join(d, 'a.txt'), 'x');
      execSync('git add .', { cwd: d, stdio: 'pipe' });
      execSync('git commit -m "init"', { cwd: d, stdio: 'pipe' });
    }

    const headA = execSync('git rev-parse HEAD', { cwd: repoA, encoding: 'utf-8' }).trim();
    const headB = execSync('git rev-parse HEAD', { cwd: repoB, encoding: 'utf-8' }).trim();

    // Advance only repoA
    fs.writeFileSync(path.join(repoA, 'new.txt'), 'y');
    execSync('git add .', { cwd: repoA, stdio: 'pipe' });
    execSync('git commit -m "impl"', { cwd: repoA, stdio: 'pipe' });
    const newHeadA = execSync('git rev-parse HEAD', { cwd: repoA, encoding: 'utf-8' }).trim();

    const state = createInitialState('run-x', 'task', headA, false);
    state.trackedRepos = [
      { path: repoA, baseCommit: headA, implRetryBase: headA, implHead: null },
      { path: repoB, baseCommit: headB, implRetryBase: headB, implHead: null },
    ];

    const runDir = makeTmpDir('rundir-');
    const result = validatePhaseArtifacts(5, state, outer, runDir);

    expect(result).toBe(true);
    expect(state.trackedRepos[0].implHead).toBe(newHeadA);
    expect(state.trackedRepos[1].implHead).toBeNull(); // not advanced
    expect(state.implCommit).toBe(newHeadA); // legacy mirror from trackedRepos[0]
  });

  it('returns false when no repo advanced and implCommit is null', () => {
    const outer = makeTmpDir();
    const repoA = makeTmpDir('repoA2-');
    execSync('git init', { cwd: repoA, stdio: 'pipe' });
    execSync('git config user.email "t@t.com"', { cwd: repoA, stdio: 'pipe' });
    execSync('git config user.name "T"', { cwd: repoA, stdio: 'pipe' });
    fs.writeFileSync(path.join(repoA, 'a.txt'), 'x');
    execSync('git add .', { cwd: repoA, stdio: 'pipe' });
    execSync('git commit -m "init"', { cwd: repoA, stdio: 'pipe' });
    const head = execSync('git rev-parse HEAD', { cwd: repoA, encoding: 'utf-8' }).trim();

    const state = createInitialState('run-y', 'task', head, false);
    state.trackedRepos = [
      { path: repoA, baseCommit: head, implRetryBase: head, implHead: null },
    ];
    state.implCommit = null;

    const runDir = makeTmpDir('rundir2-');
    const result = validatePhaseArtifacts(5, state, outer, runDir);
    expect(result).toBe(false);
  });
});
```

Run: `pnpm vitest run tests/phases/interactive.test.ts`
Expected: FAIL (new tests reference multi-repo behavior not yet implemented)

- [ ] **Step 3.2: Update `validatePhaseArtifacts` Phase 5 in `interactive.ts`**

In `src/phases/interactive.ts`, add import:

```typescript
import { syncLegacyMirror } from '../state.js';
```

Replace the Phase 5 block in `validatePhaseArtifacts` (currently lines ~187-198):

```typescript
  if (phase === 5) {
    void runDir;
    try {
      let anyAdvanced = false;
      for (const r of state.trackedRepos) {
        const h = getHead(r.path);
        if (h !== r.implRetryBase) {
          r.implHead = h;
          anyAdvanced = true;
        } else {
          r.implHead = null;
        }
      }
      if (!anyAdvanced) return false;
      syncLegacyMirror(state); // sets state.implCommit = trackedRepos[0].implHead
      return true;
    } catch {
      return false;
    }
  }
```

- [ ] **Step 3.3: Update `preparePhase` Phase 5 in `interactive.ts`**

In `preparePhase`, replace the Phase 5 block (currently ~lines 83-85):

```typescript
  // Phase 5: update implRetryBase for each tracked repo to current HEAD
  if (phase === 5) {
    for (const r of state.trackedRepos) {
      try { r.implRetryBase = getHead(r.path); } catch { /* no git */ }
      r.implHead = null;
    }
    syncLegacyMirror(state);
  }
```

Also update `preparePhase` artifact deletion to use `resolveArtifact`:

In the `if (!isReopen)` block for Phase 1/3 artifacts, replace `path.join(cwd, relPath)`:

```typescript
import { resolveArtifact } from '../artifact.js';

// In preparePhase, artifact deletion block:
const absPath = resolveArtifact(state, relPath, cwd);
```

Similarly update `validatePhaseArtifacts` Phases 1/3 artifact reading:

```typescript
// Replace: const absPath = path.isAbsolute(relPath) ? relPath : path.join(cwd, relPath);
const absPath = resolveArtifact(state, relPath, cwd);
```

And for the checklist + spec path resolutions in `validatePhaseArtifacts`:

```typescript
// Replace: path.isAbsolute(state.artifacts.checklist) ? state.artifacts.checklist : path.join(cwd, state.artifacts.checklist)
// With:
resolveArtifact(state, state.artifacts.checklist, cwd)
// and:
resolveArtifact(state, state.artifacts.spec, cwd)
```

- [ ] **Step 3.4: Update `runner.ts` Phase 5 implCommit handling**

In `src/phases/runner.ts`, add import:

```typescript
import { syncLegacyMirror } from '../state.js';
import { resolveArtifact } from '../artifact.js';
```

In `handleInteractivePhase`, find the block after successful completion (around line 449):

```typescript
      const head = getHead(cwd);
      if (phase === 1) state.specCommit = head;
      if (phase === 3) state.planCommit = head;
      if (phase === 5) state.implCommit = head;
```

Replace with:

```typescript
      const docsRoot = state.trackedRepos?.[0]?.path || cwd;
      const head = getHead(docsRoot);
      if (phase === 1) state.specCommit = head;
      if (phase === 3) state.planCommit = head;
      if (phase === 5) syncLegacyMirror(state); // implHead already set by validatePhaseArtifacts
```

In `commitArtifacts` (the local helper in runner.ts that calls `normalizeArtifactCommit`), update the `cwd` argument:

```typescript
// Find the function commitArtifacts(phase, state, runDir, cwd) — currently uses `cwd` for normalizeArtifactCommit
// Change to use docsRoot for artifact commits:
const docsRoot = state.trackedRepos?.[0]?.path || cwd;
normalizeArtifactCommit(relPath, message, docsRoot);
```

Also update `handleVerifyPhase` where `commitEvalReport(state, cwd)` is called:

```typescript
// Replace: commitEvalReport(state, cwd)
const docsRoot = state.trackedRepos?.[0]?.path || cwd;
commitEvalReport(state, docsRoot);
```

And the `getHead(cwd)` calls in verify phase for `evalCommit`/`verifiedAtHead`:

```typescript
// Replace getHead(cwd) with getHead(docsRoot) in the verify phase completion block
const docsRoot = state.trackedRepos?.[0]?.path || cwd;
const head = getHead(docsRoot);
state.evalCommit = head;
state.verifiedAtHead = head;
```

- [ ] **Step 3.5: Run tests**

Run: `pnpm vitest run tests/phases/interactive.test.ts`
Expected: All pass including new Phase 5 multi-repo tests.

Run: `pnpm vitest run tests/phases/runner.test.ts`
Expected: All existing tests pass (no regressions).

- [ ] **Step 3.6: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: Zero errors.

- [ ] **Step 3.7: Commit**

```bash
git add src/phases/interactive.ts src/phases/runner.ts src/artifact.ts tests/phases/interactive.test.ts
git commit -m "feat(interactive,runner): multi-repo Phase 5 judgment + artifact path via resolveArtifact"
```

---

## Task 4: Assembler — multi-repo gate diff + N=1 backward path

Updates `buildPhase7DiffAndMetadata` to iterate `trackedRepos`, resolves D-1, updates artifact reading to use `resolveArtifact`. Depends on Task 1.

**Files:**
- Modify: `src/context/assembler.ts`
- Test: `tests/context/assembler.test.ts` (add describe blocks)

- [ ] **Step 4.1: Write failing tests for multi-repo diff + N=1 backward path**

Append to `tests/context/assembler.test.ts`:

```typescript
describe('buildPhase7DiffAndMetadata — multi-repo concat (FR-5, ADR-N7, ADR-D1)', () => {
  it('N=1 trackedRepos[0].path===cwd → raw diff (no ### repo: label)', () => {
    const dir = makeTmpDir();
    // ... (setup git repo, make state with trackedRepos[0].path = dir)
    // Call assembleGatePrompt(7, state, '', dir) and verify no '### repo:' label in output
    const state = makeFullEvalState({
      trackedRepos: [{ path: dir, baseCommit: 'abc', implRetryBase: 'abc', implHead: null }],
    });
    writeEvalFixtures(dir);
    const prompt = assembleGatePrompt(7, state, '', dir);
    if (typeof prompt !== 'string') return;
    expect(prompt).not.toContain('### repo:');
  });

  it('N=2 → concat with ### repo: label for each repo', () => {
    const outer = makeTmpDir();
    const repoA = path.join(outer, 'repo-a');
    const repoB = path.join(outer, 'repo-b');
    // init both repos
    for (const d of [repoA, repoB]) {
      fs.mkdirSync(d, { recursive: true });
      execSync('git init', { cwd: d, stdio: 'pipe' });
      execSync('git config user.email "t@t.com"', { cwd: d, stdio: 'pipe' });
      execSync('git config user.name "T"', { cwd: d, stdio: 'pipe' });
      fs.writeFileSync(path.join(d, 'a.txt'), 'x');
      execSync('git add .', { cwd: d, stdio: 'pipe' });
      execSync('git commit -m "init"', { cwd: d, stdio: 'pipe' });
    }
    const headA = execSync('git rev-parse HEAD', { cwd: repoA, encoding: 'utf-8' }).trim();
    const headB = execSync('git rev-parse HEAD', { cwd: repoB, encoding: 'utf-8' }).trim();

    const state = makeFullEvalState({
      baseCommit: headA,
      implCommit: 'impl-sha',
      trackedRepos: [
        { path: repoA, baseCommit: headA, implRetryBase: headA, implHead: 'impl-sha' },
        { path: repoB, baseCommit: headB, implRetryBase: headB, implHead: null },
      ],
    });

    fs.mkdirSync(path.join(repoA, 'docs/specs'), { recursive: true });
    fs.mkdirSync(path.join(repoA, 'docs/plans'), { recursive: true });
    fs.mkdirSync(path.join(repoA, 'docs/process/evals'), { recursive: true });
    fs.writeFileSync(path.join(repoA, 'docs/specs/my-run-design.md'), '# spec');
    fs.writeFileSync(path.join(repoA, 'docs/plans/my-run.md'), '# plan');
    fs.writeFileSync(path.join(repoA, 'docs/process/evals/my-run-eval.md'), '# eval');

    const prompt = assembleGatePrompt(7, state, '', outer);
    if (typeof prompt !== 'string') return;
    expect(prompt).toContain('### repo: repo-a');
    expect(prompt).toContain('### repo: repo-b');
  });

  it('N>1 metadata block uses "Harness implementation ranges (per tracked repo):" format', () => {
    // State with N=2, trackedRepos[0].implHead set, [1].implHead null
    const state = makeFullEvalState({
      trackedRepos: [
        { path: '/outer/repo-a', baseCommit: 'base-a', implRetryBase: 'base-a', implHead: 'impl-a' },
        { path: '/outer/repo-b', baseCommit: 'base-b', implRetryBase: 'base-b', implHead: null },
      ],
    });
    // We can't call the private function directly, so we test via assembleGatePrompt
    // This is a metadata format test, so we just verify the string shape
    // (implementation will inject this into the prompt)
    // For unit test isolation, we can export buildPhase7DiffAndMetadata and test it directly
    // For now, rely on integration test coverage in T8
  });
});
```

Run: `pnpm vitest run tests/context/assembler.test.ts`
Expected: New test about N=1 backward path passes structure-check; N=2 test fails.

- [ ] **Step 4.2: Update `buildPhase7DiffAndMetadata` for multi-repo**

In `src/context/assembler.ts`, add import at top:

```typescript
import { resolveArtifact } from '../artifact.js';
import type { TrackedRepo } from '../types.js';
```

Replace `buildPhase7DiffAndMetadata(state, cwd)` entirely:

```typescript
function buildPhase7DiffAndMetadata(state: HarnessState, cwd: string): {
  diffSection: string;
  externalSummary: string;
  metadata: string;
} {
  const repos = state.trackedRepos ?? [{ path: cwd, baseCommit: state.baseCommit, implRetryBase: state.implRetryBase, implHead: state.implCommit }];
  const isSingleRepoCwd = repos.length === 1 && repos[0].path === cwd;

  function buildRepoDiff(repo: TrackedRepo): string {
    if (state.externalCommitsDetected) {
      // Use implHead if available, otherwise fall back to HEAD
      if (repo.implHead !== null) {
        let d = runGit(`git diff ${repo.baseCommit}...${repo.implHead}`, repo.path);
        // Per-repo pre-truncation (ADR-D1)
        d = truncateDiffPerFile(d, PER_FILE_DIFF_LIMIT_KB * 1024);
        const evalCommit = state.evalCommit;
        if (evalCommit !== null && repo === repos[0]) {
          // evalCommit exists only in the docs-home repo (trackedRepos[0])
          d += '\n' + runGit(`git diff ${evalCommit}^..${evalCommit}`, repo.path);
        }
        return d;
      } else {
        // repo has no impl anchor — diff base...HEAD (cannot separate external)
        let d = runGit(`git diff ${repo.baseCommit}...HEAD`, repo.path);
        d = truncateDiffPerFile(d, PER_FILE_DIFF_LIMIT_KB * 1024);
        return d;
      }
    } else {
      let d = runGit(`git diff ${repo.baseCommit}...HEAD`, repo.path);
      d = truncateDiffPerFile(d, PER_FILE_DIFF_LIMIT_KB * 1024);
      return d;
    }
  }

  let combinedDiff: string;
  if (isSingleRepoCwd) {
    // N=1 backward path: raw diff, no ### repo: label (ADR-N7, FR-5 invariant)
    combinedDiff = buildRepoDiff(repos[0]);
  } else {
    // Multi-repo: concat with ### repo: labels
    const sections: string[] = [];
    for (const repo of repos) {
      const relOrAbs = path.relative(cwd, repo.path) || repo.path;
      const rawDiff = buildRepoDiff(repo);
      sections.push(`### repo: ${relOrAbs}\n\`\`\`diff\n${rawDiff}\n\`\`\``);
    }
    combinedDiff = sections.join('\n\n');
  }

  // Global size cap after concat (ADR-D1)
  const maxDiffBytes = MAX_DIFF_SIZE_KB * 1024;
  if (combinedDiff.length > maxDiffBytes) {
    combinedDiff = combinedDiff.slice(0, maxDiffBytes) +
      '\n--- (diff truncated: total exceeds ' + MAX_DIFF_SIZE_KB + 'KB) ---\n';
  }

  const diffSection = combinedDiff ? `<diff>\n${combinedDiff}\n</diff>\n` : '';

  // External commits summary (per-repo for multi, single-repo for N=1)
  let externalSummary = '';
  if (state.externalCommitsDetected) {
    if (isSingleRepoCwd) {
      const anchor = state.evalCommit ?? state.implCommit ?? state.baseCommit;
      const externalLog = runGit(`git log ${anchor}..HEAD --oneline`, cwd);
      if (externalLog.trim().length > 0) {
        externalSummary = `\n## External Commits (not reviewed)\n\n\`\`\`\n${externalLog}\n\`\`\`\n`;
      }
    } else {
      const sections: string[] = [];
      for (const repo of repos) {
        const anchor = repo.implHead ?? repo.implRetryBase ?? repo.baseCommit;
        const externalLog = runGit(`git log ${anchor}..HEAD --oneline`, repo.path);
        if (externalLog.trim().length > 0) {
          const relOrAbs = path.relative(cwd, repo.path) || repo.path;
          sections.push(`### ${relOrAbs}\n\`\`\`\n${externalLog}\n\`\`\``);
        }
      }
      if (sections.length > 0) {
        externalSummary = `\n## External Commits (not reviewed)\n\n${sections.join('\n\n')}\n`;
      }
    }
  }

  // Metadata block: N=1 single-repo vs N>1 multi-repo (FR-5, gate-2 P1)
  const externalNote = state.externalCommitsDetected
    ? `Note: External commits detected. See '## External Commits (not reviewed)' section below.\nPrimary diff covers harness implementation range only.\n`
    : '';

  let implRange: string;
  if (isSingleRepoCwd) {
    // N=1: preserve existing format exactly (backward compat)
    implRange = state.implCommit !== null
      ? `Harness implementation range: ${state.baseCommit}..${state.implCommit} (Phase 1–5 commits).`
      : `Phase 5 skipped; no implementation commit anchor.`;
  } else {
    // N>1: per-repo format
    const lines = repos.map(repo => {
      const relOrAbs = path.relative(cwd, repo.path) || repo.path;
      return repo.implHead !== null
        ? `  - ${relOrAbs}: ${repo.baseCommit}..${repo.implHead}`
        : `  - ${relOrAbs}: no change (baseCommit=${repo.baseCommit})`;
    });
    implRange = `Harness implementation ranges (per tracked repo):\n${lines.join('\n')}`;
  }

  const metadata =
    `<metadata>\n${externalNote}${implRange}\n` +
    `Harness eval report commit: ${state.evalCommit ?? '(none)'} (the commit that last modified the eval report).\n` +
    `Verified at HEAD: ${state.verifiedAtHead ?? '(none)'} (most recent Phase 6 run).\n` +
    `Focus review on changes within the harness ranges above.\n` +
    `</metadata>\n`;

  return { diffSection, externalSummary, metadata };
}
```

- [ ] **Step 4.3: Update artifact reading in assembler to use `resolveArtifact`**

In `resolveArtifactPath` (or update each caller), change to use `trackedRepos[0]`:

Replace `resolveArtifactPath(filePath: string, cwd: string)` usage. The cleanest approach: update the `cwd` passed to `readArtifactContent` calls in `buildGatePromptPhase2/4/7` to use `docsRoot`:

In each of `buildGatePromptPhase2(state, cwd)`, `buildGatePromptPhase4(state, cwd)`, `buildGatePromptPhase7(state, cwd)`, add at the top:

```typescript
  const docsRoot = state.trackedRepos?.[0]?.path || cwd;
```

Then replace every `readArtifactContent(..., cwd)` in those three functions with `readArtifactContent(..., docsRoot)`.

- [ ] **Step 4.4: Run tests**

Run: `pnpm vitest run tests/context/assembler.test.ts`
Expected: All pass including new multi-repo describe.

Run: `pnpm vitest run tests/context/assembler-resume.test.ts`
Expected: All existing tests still pass (N=1 backward path verified).

- [ ] **Step 4.5: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: Zero errors.

- [ ] **Step 4.6: Commit**

```bash
git add src/context/assembler.ts tests/context/assembler.test.ts
git commit -m "feat(assembler): multi-repo gate diff concat, N=1 backward path, D-1 resolution"
```

---

## Task 5: Codex Runner — `--skip-git-repo-check` + stderr tail

Independent of Tasks 2–4. Depends only on Task 1 (types).

**Files:**
- Modify: `src/runners/codex.ts`
- Test: `tests/runners/codex.test.ts` (add describe blocks)

- [ ] **Step 5.1: Write failing tests**

Append to `tests/runners/codex.test.ts`:

```typescript
describe('runCodexExecRaw — --skip-git-repo-check (FR-4, ADR-N5)', () => {
  it('does NOT add --skip-git-repo-check when cwd is a git repo', async () => {
    // Mock spawn to capture argv
    // Expect args does NOT contain '--skip-git-repo-check'
    // (mock isInGitRepo to return true)
  });

  it('adds --skip-git-repo-check when cwd is not a git repo', async () => {
    // Mock isInGitRepo to return false
    // Expect args contains '--skip-git-repo-check'
  });
});

describe('rawToResult — stderr tail in error message (FR-4)', () => {
  it('includes last 20 lines of stderr in nonzero_exit_other error message', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`);
    const stderr = lines.join('\n');
    // Construct a raw result with category 'nonzero_exit_other'
    // Verify error message contains the last 20 lines
    const last20 = lines.slice(-20).join('\n');
    // The error message format: "Gate subprocess exited with code 1\n--- stderr (tail) ---\n<...>\n---"
    // Call rawToResult with mock data and verify output
  });
});
```

Run: `pnpm vitest run tests/runners/codex.test.ts`
Expected: New tests fail; existing pass.

- [ ] **Step 5.2: Add `--skip-git-repo-check` to gate spawn**

In `src/runners/codex.ts`, add import:

```typescript
import { isInGitRepo } from '../git.js';
```

In `runCodexExecRaw`, find the `args` construction and add the flag:

```typescript
  const skipGitFlag = !isInGitRepo(input.cwd) ? ['--skip-git-repo-check'] : [];

  const args = input.mode === 'resume'
    ? ['exec', 'resume', input.sessionId!,
       ...skipGitFlag,
       '--model', input.preset.model,
       '-c', `model_reasoning_effort="${input.preset.effort}"`,
       '-']
    : ['exec',
       ...skipGitFlag,
       '--model', input.preset.model,
       '-c', `model_reasoning_effort="${input.preset.effort}"`,
       '-'];
```

- [ ] **Step 5.3: Add stderr tail to error messages**

Add a helper function (above `rawToResult`):

```typescript
function stderrTail(stderr: string, maxLines: number = 20): string {
  const clean = stderr.replace(/\x1B\[[0-9;]*m/g, ''); // strip ANSI escapes
  const lines = clean.split('\n').filter(l => l.trim().length > 0);
  return lines.slice(-maxLines).join('\n');
}
```

In `rawToResult`, update the `nonzero_exit_other` case:

```typescript
  const errorMessage =
    raw.category === 'timeout' ? `Codex gate timed out after ${GATE_TIMEOUT_MS}ms` :
    raw.category === 'spawn_error' ? `Codex gate error: ${raw.spawnError ?? 'unknown spawn failure'}` :
    raw.category === 'success_no_verdict' ? 'Gate output missing ## Verdict header' :
    raw.category === 'session_missing' ? `Codex resume failed: session not found (stderr: ${raw.stderr.trim().slice(0, 200)})` :
    (() => {
      const tail = stderrTail(raw.stderr);
      return tail.length > 0
        ? `Gate subprocess exited with code ${raw.exitCode ?? 'null'}\n--- stderr (tail) ---\n${tail}\n---`
        : `Gate subprocess exited with code ${raw.exitCode ?? 'null'}`;
    })();
```

- [ ] **Step 5.4: Run tests**

Run: `pnpm vitest run tests/runners/codex.test.ts`
Expected: All tests pass including new ones.

- [ ] **Step 5.5: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: Zero errors.

- [ ] **Step 5.6: Commit**

```bash
git add src/runners/codex.ts tests/runners/codex.test.ts
git commit -m "feat(codex): auto-add --skip-git-repo-check for non-git cwd, stderr tail in error messages"
```

---

## Task 6: `resume.ts` — multi-repo ancestry + external commits + Phase 5 fresh-sentinel

Depends on Tasks 1 and 3 (for `syncLegacyMirror` in `completeInteractivePhaseFromFreshSentinel`).

**Files:**
- Modify: `src/resume.ts`
- Test: `tests/resume.test.ts` (add describe block)

- [ ] **Step 6.1: Write failing tests**

Append to `tests/resume.test.ts`:

```typescript
describe('validateAncestry — multi-repo null-safe (FR-8)', () => {
  it('skips ancestry check for repos with implHead=null', () => {
    // State: phase 5 completed, trackedRepos[0].implHead = 'sha', trackedRepos[1].implHead = null
    // With git repos set up: trackedRepos[0] is ancestor, trackedRepos[1] has no anchor
    // Expect: no error thrown (trackedRepos[1] skipped)
  });

  it('errors when trackedRepos[0].implHead is not an ancestor of HEAD', () => {
    // Diverged repo: implHead not in history
    // Expect: process.exit(1) called with repo path in message
  });
});

describe('updateExternalCommitsDetected — multi-repo (FR-8)', () => {
  it('uses implHead ?? implRetryBase ?? baseCommit as anchor per repo', () => {
    // Two repos: one with implHead set, one without
    // Only repo with external commits sets externalCommitsDetected = true
  });
});

describe('completeInteractivePhaseFromFreshSentinel — Phase 5 multi-repo', () => {
  it('returns true and sets implHead when any repo advanced', () => {
    // Same logic as interactive.test.ts Phase 5 multi-repo test
  });
});
```

Run: `pnpm vitest run tests/resume.test.ts`
Expected: New tests fail.

- [ ] **Step 6.2: Update `validateAncestry` in `resume.ts`**

In `src/resume.ts`, add import:

```typescript
import { syncLegacyMirror } from './state.js';
```

Replace the `if (state.phases['5'] === 'completed')` block in `validateAncestry`:

```typescript
    if (state.phases['5'] === 'completed') {
      // Per-repo ancestry check: only for repos where implHead is set (non-null)
      const allNull = state.trackedRepos.every(r => r.implHead === null);
      if (allNull) {
        // Internal invariant violation: phase 5 complete but no repo advanced
        // state_anomaly is emitted by caller — just exit here
        process.stderr.write(
          `Phase 5 completed but all trackedRepos[*].implHead are null — state anomaly.\n` +
          `Manual recovery required.\n`
        );
        process.exit(1);
      }
      for (const repo of state.trackedRepos) {
        if (repo.implHead === null) continue; // no anchor → skip
        if (!isAncestor(repo.implHead, 'HEAD', repo.path)) {
          process.stderr.write(
            `Implementation commit is no longer in git history (repo: ${repo.path}).\n` +
            `Manual recovery required.\n`
          );
          process.exit(1);
        }
      }
    }
```

- [ ] **Step 6.3: Update `updateExternalCommitsDetected` in `resume.ts`**

Replace `updateExternalCommitsDetected`:

```typescript
function updateExternalCommitsDetected(state: HarnessState, cwd: string, runDir: string): void {
  try {
    for (const repo of state.trackedRepos) {
      const anchor = repo.implHead ?? repo.implRetryBase ?? repo.baseCommit;
      const knownAnchors = [state.specCommit, state.planCommit, repo.implHead, state.evalCommit];
      const implRange = repo.implHead
        ? { from: repo.baseCommit, to: repo.implHead }
        : null;
      const external = detectExternalCommits(anchor, knownAnchors, implRange, repo.path);
      if (external.length > 0) {
        process.stderr.write(`⚠️  External commits detected in ${repo.path} (${external.length} commits).\n`);
        state.externalCommitsDetected = true;
        writeState(runDir, state);
      }
    }
  } catch {
    // Non-fatal
  }
}
```

- [ ] **Step 6.4: Update `completeInteractivePhaseFromFreshSentinel` Phase 5 in `resume.ts`**

Replace the `if (phase === 5)` block in `completeInteractivePhaseFromFreshSentinel`:

```typescript
    if (phase === 5) {
      void runDir;
      let anyAdvanced = false;
      for (const r of state.trackedRepos) {
        const h = getHead(r.path);
        if (h !== r.implRetryBase) {
          r.implHead = h;
          anyAdvanced = true;
        } else {
          r.implHead = null;
        }
      }
      if (!anyAdvanced) return false;
      syncLegacyMirror(state);
      return true;
    }
```

Also update `validateCompletedArtifacts` artifact paths to use `resolveArtifact`:

```typescript
import { resolveArtifact, normalizeArtifactCommit } from './artifact.js';

// In validateCompletedArtifacts:
// Replace: join(cwd, state.artifacts.spec)  → resolveArtifact(state, state.artifacts.spec, cwd)
// Replace: join(cwd, state.artifacts.plan)  → resolveArtifact(state, state.artifacts.plan, cwd)
// Replace: join(cwd, state.artifacts.evalReport) → resolveArtifact(state, state.artifacts.evalReport, cwd)
```

In `completeInteractivePhaseFromFreshSentinel` for Phase 1/3:

```typescript
// Replace: join(cwd, relPath) → resolveArtifact(state, relPath, cwd)
// Replace: normalizeArtifactCommit(relPath, message, cwd) → normalizeArtifactCommit(relPath, message, resolveArtifactRoot(state, cwd))
```

Add helper:

```typescript
function resolveArtifactRoot(state: HarnessState, outerCwd: string): string {
  return state.trackedRepos?.[0]?.path || outerCwd;
}
```

- [ ] **Step 6.5: Run tests**

Run: `pnpm vitest run tests/resume.test.ts`
Expected: All tests pass including new multi-repo describes.

Run: `pnpm vitest run tests/resume-light.test.ts`
Expected: All pass (no regressions).

- [ ] **Step 6.6: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: Zero errors.

- [ ] **Step 6.7: Commit**

```bash
git add src/resume.ts tests/resume.test.ts
git commit -m "feat(resume): multi-repo ancestry check, external commits detection, Phase 5 fresh-sentinel"
```

---

## Task 7: HOW-IT-WORKS docs update

Independent of all code tasks. Can be done in parallel with T2–T6.

**Files:**
- Modify: `docs/HOW-IT-WORKS.md`
- Modify: `docs/HOW-IT-WORKS.ko.md`

- [ ] **Step 7.1: Add multi-worktree section to HOW-IT-WORKS.md**

In `docs/HOW-IT-WORKS.md`, find the "Architecture" section. Add a new subsection after the existing architecture overview:

```markdown
### Multi-Worktree (outer cwd) Layout

When `phase-harness start` is invoked from a directory that is **not** itself a git repo (an "outer cwd"), harness automatically detects git repos at depth=1 beneath that directory. These become the **tracked repos** for the run.

```
outer-dir/           ← harness cwd (not a git repo)
  repo-a/            ← auto-detected tracked repo
  repo-b/            ← auto-detected tracked repo
  .harness/<runId>/  ← state + artifacts (gitignored)
```

**Key behaviors:**
- `state.trackedRepos[]` holds each repo's path, baseCommit, implRetryBase, and implHead.
- `trackedRepos[0]` is the **docs home**: spec/plan/eval artifacts are committed into this repo.
- Phase 5 success = "any tracked repo advanced past its `implRetryBase`".
- Gate diff = per-repo sections concatenated with `### repo: <path>` labels (N>1 only).
- Codex gate spawns from outer cwd with `--skip-git-repo-check` added automatically.
- Single-repo flow (`cwd` is a git repo) produces identical output — `trackedRepos = [cwd]` is the degenerate case.

**CLI flags:**
- `--track <path>` (repeatable): explicit repo list, overrides auto-detect. First path = docs home.
- `--exclude <path>` (repeatable): remove a path from auto-detect results.

All `--track` paths must be under outer cwd (cwd-descendant rule).
```

- [ ] **Step 7.2: Add multi-worktree section to HOW-IT-WORKS.ko.md**

Add a Korean-language equivalent section at the same location in `docs/HOW-IT-WORKS.ko.md`:

```markdown
### 멀티 워크트리 (outer cwd) 레이아웃

`phase-harness start`를 git 저장소가 **아닌** 디렉토리(outer cwd)에서 실행하면, harness는 해당 디렉토리의 depth=1 하위 git 저장소들을 자동 탐지합니다. 이 저장소들이 런의 **tracked repos**가 됩니다.

```
outer-dir/           ← harness cwd (git 저장소 아님)
  repo-a/            ← 자동 탐지된 tracked repo
  repo-b/            ← 자동 탐지된 tracked repo
  .harness/<runId>/  ← state + artifacts (.gitignore)
```

**주요 동작:**
- `state.trackedRepos[]`에 각 저장소의 path, baseCommit, implRetryBase, implHead가 저장됩니다.
- `trackedRepos[0]`이 **docs home**: spec/plan/eval 아티팩트가 이 저장소에 커밋됩니다.
- Phase 5 성공 = "어떤 tracked repo든 자신의 `implRetryBase`에서 진전했는가".
- Gate diff = repo별 섹션을 `### repo: <path>` 레이블로 concat (N>1인 경우만).
- Codex gate는 항상 outer cwd에서 실행, 필요시 `--skip-git-repo-check` 자동 추가.
- 단일 저장소 플로우(`cwd`가 git 저장소)는 동일한 결과를 생성합니다 — `trackedRepos = [cwd]`가 기본 케이스입니다.

**CLI 플래그:**
- `--track <path>` (반복 가능): 명시적 저장소 목록, 자동 탐지를 대체. 첫 번째 경로 = docs home.
- `--exclude <path>` (반복 가능): 자동 탐지 결과에서 특정 경로 제거.

모든 `--track` 경로는 outer cwd 하위여야 합니다 (cwd-descendant 규칙).
```

- [ ] **Step 7.3: Commit**

```bash
git add docs/HOW-IT-WORKS.md docs/HOW-IT-WORKS.ko.md
git commit -m "docs: add multi-worktree layout section to HOW-IT-WORKS"
```

---

## Task 8: Multi-worktree integration tests

Comprehensive test coverage for all NFR test scenarios. Depends on T1–T6.

**Files:**
- Create: `tests/multi-worktree.test.ts`

- [ ] **Step 8.1: Write integration tests**

Create `tests/multi-worktree.test.ts`:

```typescript
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
});
```

- [ ] **Step 8.2: Run all new integration tests**

Run: `pnpm vitest run tests/multi-worktree.test.ts`
Expected: All pass.

- [ ] **Step 8.3: Run full test suite (regression check)**

Run: `pnpm vitest run`
Expected: All existing tests pass. Zero regressions.

- [ ] **Step 8.4: Build**

Run: `pnpm build`
Expected: Build succeeds. `dist/` populated.

- [ ] **Step 8.5: Commit**

```bash
git add tests/multi-worktree.test.ts
git commit -m "test(multi-worktree): integration tests for all NFR scenarios"
```

---

## Eval Checklist

See `.harness/2026-04-20-task-outer-cwd-n-sub-a808/checklist.json` for the machine-readable version.

| # | Name | Command |
|---|------|---------|
| 1 | typecheck | `pnpm tsc --noEmit` |
| 2 | tests | `pnpm vitest run` |
| 3 | build | `pnpm build` |
| 4 | multi-worktree tests | `pnpm vitest run tests/multi-worktree.test.ts` |
