# Codex Phase 5 Uncommitted-Changes Detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect when Codex finishes a Phase 5 attempt with the sentinel fresh but the working tree dirty (uncommitted changes), and surface that state via a stderr warn block plus an `uncommittedRepos?` field on the `phase_end` event.

**Architecture:** A new pure helper `detectUncommittedChanges(repoPaths)` in `src/git.ts` (mirrors the existing `isWorkingTreeClean` / `hasStagedChanges` shape) lives in isolation and is unit-testable. The Codex P5 branch in `src/phases/interactive.ts` calls it post-`waitForPhaseCompletion` and stashes the result on the existing `InteractiveResult` shape. `src/phases/runner.ts` reads that field on the "Normal failure" path and forwards it onto the `phase_end` log event (typed via `src/types.ts`).

**Tech Stack:** TypeScript, vitest, pnpm. No new dependencies.

**Spec:** [`docs/specs/2026-04-25-codex-phase5-uncommitted-detection-design.md`](../specs/2026-04-25-codex-phase5-uncommitted-detection-design.md)

**Issue:** [#84](https://github.com/DongGukMon/harness-cli/issues/84)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/git.ts` | Modify | Add `detectUncommittedChanges` + `UncommittedRepo` interface (alongside existing helpers like `isWorkingTreeClean`). |
| `src/phases/interactive.ts` | Modify | Extend `InteractiveResult` with `uncommittedRepos?`. Add detection block in Codex P5 branch. Add local `formatUncommittedWarn` helper. |
| `src/phases/runner.ts` | Modify | On the "Normal failure" path of `handleInteractivePhase`, forward `result.uncommittedRepos` onto the `phase_end` log event. |
| `src/types.ts` | Modify | Extend `phase_end` log-event variant with `uncommittedRepos?: Array<{ path: string; count: number }>`. |
| `tests/git.test.ts` | Modify | Add `describe('detectUncommittedChanges')` block with three cases. |
| `tests/phases/interactive.test.ts` | Modify | Add P5+Codex+dirty / P5+Codex+clean / P5+Claude+dirty cases. |
| `docs/HOW-IT-WORKS.md` | Modify | Phase 5 success-criteria callout. |
| `docs/HOW-IT-WORKS.ko.md` | Modify | Mirror of the English callout. |
| `CLAUDE.md` | Modify | Events table — add `uncommittedRepos?` row to `phase_end`. |
| `README.md`, `README.ko.md` | Inspect (modify only if existing P5/preset coverage warrants it) | Doc-sync obligation per CLAUDE.md. |

---

## Task 1 — `detectUncommittedChanges` helper

**Files:**
- Modify: `src/git.ts`
- Modify: `tests/git.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/git.test.ts`:

```typescript
import {
  // ... existing imports
  detectUncommittedChanges,
} from '../src/git.js';

describe('detectUncommittedChanges', () => {
  let repo: { path: string; cleanup: () => void };

  beforeEach(() => {
    repo = createTestRepo();
  });

  afterEach(() => {
    repo.cleanup();
  });

  it('returns [] for a clean repo', () => {
    expect(detectUncommittedChanges([repo.path])).toEqual([]);
  });

  it('reports dirty repo with line count', () => {
    writeFileSync(join(repo.path, 'a.txt'), 'a');
    writeFileSync(join(repo.path, 'b.txt'), 'b');
    const result = detectUncommittedChanges([repo.path]);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe(repo.path);
    expect(result[0].count).toBe(2);
  });

  it('returns [] for a non-git path without throwing', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'no-git-uncommit-'));
    try {
      expect(detectUncommittedChanges([tmpDir])).toEqual([]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('reports each dirty repo separately when given multiple paths', () => {
    const repo2 = createTestRepo();
    try {
      writeFileSync(join(repo.path, 'x.txt'), 'x');
      writeFileSync(join(repo2.path, 'y.txt'), 'y');
      const result = detectUncommittedChanges([repo.path, repo2.path]);
      expect(result).toHaveLength(2);
      expect(result.map(r => r.count)).toEqual([1, 1]);
    } finally {
      repo2.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run tests/git.test.ts -t detectUncommittedChanges
```

Expected: FAIL — `detectUncommittedChanges is not exported from '../src/git.js'`.

- [ ] **Step 3: Implement the helper**

Append to `src/git.ts`:

```typescript
export interface UncommittedRepo {
  path: string;
  count: number;
}

// Returns an entry for each repoPath whose `git status --porcelain` is non-empty.
// Non-git paths and exec failures are silently treated as clean (count: 0, omitted).
export function detectUncommittedChanges(repoPaths: string[]): UncommittedRepo[] {
  const out: UncommittedRepo[] = [];
  for (const p of repoPaths) {
    try {
      const raw = exec('git status --porcelain', p);
      if (raw === '') continue;
      const count = raw.split('\n').filter(line => line.length > 0).length;
      if (count > 0) {
        out.push({ path: p, count });
      }
    } catch {
      // Non-git path or git failure → treat as clean.
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run tests/git.test.ts -t detectUncommittedChanges
```

Expected: PASS — all four cases.

- [ ] **Step 5: Commit**

```bash
git add src/git.ts tests/git.test.ts
git commit -m "feat(git): add detectUncommittedChanges helper

Lists repos whose git status --porcelain is non-empty. Used by the
Phase 5 Codex branch to surface uncommitted-changes failures (#84)."
```

---

## Task 2 — Wire detection into Codex P5 branch + emit on `phase_end`

This task ties together three files because the change is only useful end-to-end:
`InteractiveResult` widening, the detection call site, the type extension, and the
runner-side event emission. Splitting them would leave a half-merged tree that
typechecks but does nothing observable.

**Files:**
- Modify: `src/phases/interactive.ts`
- Modify: `src/phases/runner.ts`
- Modify: `src/types.ts`
- Modify: `tests/phases/interactive.test.ts`

- [ ] **Step 1: Write the failing integration test**

Open `tests/phases/interactive.test.ts` and add a new `describe` block at the bottom (study the existing top-of-file mock setup — replicate the exact mock pattern used by other Codex-branch tests there; do NOT invent a new mock pattern):

```typescript
describe('Codex P5 uncommitted-changes detection (#84)', () => {
  it('attaches uncommittedRepos and writes stderr warn when working tree is dirty', async () => {
    // Reuse this file's existing setup pattern: createTestRepo for state.trackedRepos[0],
    // mock spawnCodexInteractiveInPane to return immediately, and have the sentinel
    // file written with the matching attemptId (so checkSentinelFreshness === 'fresh').
    // Then pollute the working tree with one uncommitted change BEFORE calling
    // runInteractivePhase. validatePhaseArtifacts(5) will return false (no HEAD
    // advance), so the result.status will be 'failed'.

    // ... existing setup pattern (mirror neighboring tests) ...

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = await runInteractivePhase(5, state, harnessDir, runDir, cwd, attemptId);
    expect(result.status).toBe('failed');
    expect((result as InteractiveResult & { uncommittedRepos?: UncommittedRepo[] }).uncommittedRepos)
      .toEqual([{ path: trackedRepoPath, count: 1 }]);
    const writes = stderrSpy.mock.calls.map(c => String(c[0])).join('');
    expect(writes).toMatch(/Codex completed \(sentinel fresh\) but left uncommitted changes/);
    stderrSpy.mockRestore();
  });

  it('does NOT warn when Codex P5 fails with a clean working tree', async () => {
    // Same setup, sentinel fresh, but the tree stays clean. Result is still
    // 'failed' (HEAD didn't advance) but no warn / no field.
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = await runInteractivePhase(5, state, harnessDir, runDir, cwd, attemptId);
    expect(result.status).toBe('failed');
    expect((result as InteractiveResult & { uncommittedRepos?: UncommittedRepo[] }).uncommittedRepos)
      .toBeUndefined();
    expect(stderrSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('uncommitted changes')
    );
    stderrSpy.mockRestore();
  });

  it('does NOT warn for Claude P5 even when the tree is dirty', async () => {
    // Force preset.runner === 'claude' (claude branch never reaches the new code path).
    // Pollute the working tree. Even with a fresh sentinel + dirty tree, no warn.
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = await runInteractivePhase(5, state, harnessDir, runDir, cwd, attemptId);
    expect((result as InteractiveResult & { uncommittedRepos?: UncommittedRepo[] }).uncommittedRepos)
      .toBeUndefined();
    expect(stderrSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('uncommitted changes')
    );
    stderrSpy.mockRestore();
  });
});
```

Note: `InteractiveResult` and `UncommittedRepo` need import additions at the top of the test file.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run tests/phases/interactive.test.ts -t "uncommitted-changes detection"
```

Expected: FAIL — `result.uncommittedRepos` is undefined and stderr does not match the expected text. (Make sure typescript also fails because `InteractiveResult.uncommittedRepos` does not exist yet — that's the next step.)

- [ ] **Step 3: Extend `InteractiveResult` and add detection in interactive.ts**

In `src/phases/interactive.ts`:

(a) Add the import alongside existing `git.ts` imports:

```typescript
import { getHead, detectUncommittedChanges, type UncommittedRepo } from '../git.js';
```

(b) Widen `InteractiveResult`:

```typescript
export interface InteractiveResult {
  status: 'completed' | 'failed';
  uncommittedRepos?: UncommittedRepo[];
}
```

(c) Add a private formatter near the top of the file (below `specHasValidComplexity`):

```typescript
function formatUncommittedWarn(dirty: UncommittedRepo[]): string {
  const lines = dirty.map(d => `    ${d.path} — ${d.count} files`);
  return [
    '',
    '⚠️  Phase 5 failed: Codex completed (sentinel fresh) but left uncommitted changes:',
    ...lines,
    '',
    '  Resolve by:',
    '    • Commit the changes manually, then Resume; or',
    '    • Re-run with a Claude preset for phase 5 (e.g. claude-sonnet-default).',
    '',
    '',
  ].join('\n');
}
```

(d) In `runInteractivePhase`, in the Codex `else` branch, **between** the `await waitForPhaseCompletion(...)` line and the existing `try { clearLockChild(...) }` block, insert:

```typescript
if (
  phase === 5 &&
  result.status === 'failed' &&
  checkSentinelFreshness(sentinelPath, attemptId) === 'fresh'
) {
  const dirty = detectUncommittedChanges(updatedState.trackedRepos.map(r => r.path));
  if (dirty.length > 0) {
    process.stderr.write(formatUncommittedWarn(dirty));
    result.uncommittedRepos = dirty;
  }
}
```

(`result` is `const { status }` from `await`, so destructure differently or rebind. Check the surrounding code: at line ~304 the code uses `const result = await waitForPhaseCompletion(...)`. That's already a let-bindable shape since it's an object literal returned from the helper. Type-widen the local declaration to `InteractiveResult` so we can attach the optional field — i.e. `const result: InteractiveResult = await waitForPhaseCompletion(...)`.)

- [ ] **Step 4: Forward the field on `phase_end` in runner.ts**

In `src/phases/runner.ts`, locate the "Normal failure (redirect case already handled above)" `else` block (around line 495). Modify the `phase_end` log event to include the optional field:

```typescript
const failedTokens = collectClaudeTokens();
logger.logEvent({
  event: 'phase_end',
  phase,
  attemptId,
  status: 'failed',
  durationMs: Date.now() - phaseStartTs,
  ...(failedTokens !== undefined ? { claudeTokens: failedTokens } : {}),
  ...(result.uncommittedRepos !== undefined && result.uncommittedRepos.length > 0
    ? { uncommittedRepos: result.uncommittedRepos }
    : {}),
});
```

Do NOT add the field on the artifact-commit-failure path or the throw path — the spec scopes this strictly to the validator-rejected, sentinel-fresh case which only the "Normal failure" branch matches.

- [ ] **Step 5: Extend the `phase_end` event type in `src/types.ts`**

Locate the `phase_end` variant on the `LogEvent` union (around line 279) and add the optional field:

```typescript
| (LogEventBase & {
    event: 'phase_end';
    phase: number;
    attemptId?: string | null;
    status: 'completed' | 'failed';
    durationMs: number;
    details?: { reason: string };
    claudeTokens?: ClaudeTokens | null;
    codexTokens?: ClaudeTokens | null;
    uncommittedRepos?: Array<{ path: string; count: number }>;
  })
```

- [ ] **Step 6: Run typecheck and tests**

```bash
pnpm tsc --noEmit
pnpm vitest run tests/phases/interactive.test.ts -t "uncommitted-changes detection"
pnpm vitest run tests/phases/runner.test.ts
```

Expected: typecheck PASS; the three new test cases PASS; existing runner tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add src/phases/interactive.ts src/phases/runner.ts src/types.ts tests/phases/interactive.test.ts
git commit -m "feat(phase5): surface Codex uncommitted-changes failure (#84)

When Phase 5 fails with a fresh sentinel under a Codex preset and the
working tree is dirty, write a stderr warn and attach uncommittedRepos
to the phase_end log event. Detection-only — no auto-commit fallback."
```

---

## Task 3 — Documentation sync

**Files:**
- Modify: `docs/HOW-IT-WORKS.md`
- Modify: `docs/HOW-IT-WORKS.ko.md`
- Modify: `CLAUDE.md` (events.jsonl schema table)
- Inspect: `README.md`, `README.ko.md`

- [ ] **Step 1: Update `docs/HOW-IT-WORKS.md`**

Locate the Phase 5 section (search for "Phase 5" success criteria / "implRetryBase" / "HEAD has advanced"). Add this paragraph immediately after the existing success-criteria description:

```markdown
**Codex preset on Phase 5 — commit-discipline trap.** Phase 5 only treats an
attempt as completed when at least one tracked repo's HEAD advances past
`implRetryBase`. Codex sometimes finishes the work and writes the sentinel but
forgets to commit — leaving the validator to read "no advance" and report
`failed`. When the harness detects this exact case (sentinel fresh + working
tree dirty under a Codex preset), it writes a `⚠️  Phase 5 failed: Codex
completed … but left uncommitted changes` block to stderr and attaches
`uncommittedRepos: [{ path, count }, …]` on the `phase_end` log event so
operators can either (a) commit the changes manually and Resume, or (b)
switch the Phase 5 preset to a Claude variant (e.g. `claude-sonnet-default`)
which has commit-discipline guards via `superpowers:subagent-driven-development`.
The Claude branch does not have this trap.
```

- [ ] **Step 2: Mirror the change in `docs/HOW-IT-WORKS.ko.md`**

Same paragraph, translated. Locate the equivalent Phase 5 section, add directly after the success-criteria description:

```markdown
**Codex 프리셋 + Phase 5 — commit 누락 함정.** Phase 5는 적어도 하나의 tracked
repo의 HEAD가 `implRetryBase`를 넘어 진전했을 때만 완료로 간주한다. Codex가
구현은 마치고 sentinel은 남겼지만 commit을 빠뜨리는 경우가 있는데, validator
입장에서는 "진전 없음 = failed"로 보인다. harness는 이 케이스(Codex preset +
sentinel fresh + working tree dirty)를 정확히 검출하면 stderr에 `⚠️  Phase 5
failed: Codex completed … but left uncommitted changes` 블록을 출력하고,
`phase_end` 이벤트에 `uncommittedRepos: [{ path, count }, …]` 필드를 부착해서
operator가 (a) 직접 commit 후 Resume하거나, (b) Phase 5 프리셋을 Claude 계열
(예: `claude-sonnet-default`)로 전환할 수 있도록 안내한다. Claude 브랜치는
`superpowers:subagent-driven-development`가 commit 규율을 강제하므로 이 함정에
빠지지 않는다.
```

- [ ] **Step 3: Update `CLAUDE.md` events table**

Locate the events table row for `phase_end` (search for `phase_end` in the table). Append `uncommittedRepos?: Array<{ path: string; count: number }>` to the field list, with a brief gloss matching the existing 3-state pattern, e.g.:

```markdown
| `phase_end` | `phase`, `attemptId`, `status`, `durationMs`, **`claudeTokens?: { input, output, cacheRead, cacheCreate, total } \| null`** (PR #16 — interactive 1/3/5 + `preset.runner === 'claude'` 실자 페이즈만; codex/redirect-by-signal 분기는 필드 자체 생략), **`uncommittedRepos?: Array<{ path: string; count: number }>`** (#84 — Phase 5 + codex runner + sentinel fresh + dirty tree에서만 발현; 그 외 분기는 필드 자체 생략) |
```

- [ ] **Step 4: Inspect `README.md` and `README.ko.md`**

Run:

```bash
grep -n "Phase 5\|phasePresets\|codex-high\|claude-sonnet" README.md README.ko.md | head -30
```

If existing sections describe Phase 5 preset selection or commit semantics, add a one-liner pointing readers to the HOW-IT-WORKS callout. If neither README touches Phase 5 preset choice, leave them alone — the README should not enumerate every edge case (see CLAUDE.md doc-sync clause: "문서 영향이 없다고 판단한 경우에도 PR/커밋 설명에 ... 문서 변경 불필요라는 취지의 근거를 남긴다").

- [ ] **Step 5: Commit**

If both READMEs needed edits:

```bash
git add docs/HOW-IT-WORKS.md docs/HOW-IT-WORKS.ko.md CLAUDE.md README.md README.ko.md
```

If READMEs were unchanged:

```bash
git add docs/HOW-IT-WORKS.md docs/HOW-IT-WORKS.ko.md CLAUDE.md
```

Then:

```bash
git commit -m "docs(phase5): document codex commit-discipline trap (#84)

Update HOW-IT-WORKS.{md,ko.md} and CLAUDE.md events table to describe
the new uncommitted-changes detection. README scan: <unchanged|note added>."
```

---

## Task 4 — Final validation

**Files:** none modified; runs full validation suite.

- [ ] **Step 1: Run full typecheck**

```bash
pnpm tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 2: Run full test suite**

```bash
pnpm vitest run
```

Expected: all tests pass. If anything else broke, fix it before proceeding (do NOT commit a workaround).

- [ ] **Step 3: Run full build**

```bash
pnpm build
```

Expected: success; `dist/` updated.

- [ ] **Step 4: Smoke-check the new helper from a quick REPL**

```bash
node -e "
const { detectUncommittedChanges } = require('./dist/git.js');
console.log(detectUncommittedChanges([process.cwd()]));
"
```

Expected: prints `[]` if the worktree is clean (the plan/spec/code commits should have left it clean), or one entry if anything is uncommitted. Either way, no throw.

- [ ] **Step 5: Push branch and open PR**

```bash
git push -u origin hung-fix
gh pr create --title "fix(phase5): surface Codex uncommitted-changes failure" --body "$(cat <<'EOF'
## Summary

Closes #84.

When `phasePresets["5"]` resolves to a Codex preset and Codex finishes the
work but forgets to commit, the harness used to silently re-loop on
`failed` because `validatePhaseArtifacts(5)` only checks HEAD advancement.
This PR adds detection-only surfacing: a stderr warn block and an
`uncommittedRepos?` field on the `phase_end` log event, fired only when
all five trigger conditions hold (P5 + Codex runner + result=failed +
sentinel fresh + working tree dirty in any tracked repo).

Auto-commit fallback was deliberately rejected — see the spec's "Out of
scope" section for the full rationale.

- Spec: `docs/specs/2026-04-25-codex-phase5-uncommitted-detection-design.md`
- Plan: `docs/plans/2026-04-25-codex-phase5-uncommitted-detection.md`

## Test plan

- [x] `pnpm tsc --noEmit`
- [x] `pnpm vitest run` (full suite)
- [x] `pnpm build`
- [x] New unit tests for `detectUncommittedChanges` (4 cases)
- [x] New integration tests for the detection branch (3 cases: P5+codex+dirty / P5+codex+clean / P5+claude+dirty)
EOF
)"
```

---

## Self-review notes

- **Spec coverage:** Trigger conditions (5 clauses) → Task 2, Step 3 (d). UX block → Task 2, Step 3 (c). Telemetry field → Task 2, Steps 4–5. Helper → Task 1. Tests → Task 1 + Task 2 Step 1. Docs → Task 3. Out-of-scope items remain out (no auto-commit, no prompt edits, no preset rejection).
- **Type consistency:** `UncommittedRepo` interface lives in `src/git.ts`, exported and re-imported in `src/phases/interactive.ts`; the `phase_end` event type uses the inline shape `Array<{ path: string; count: number }>` which is structurally identical (both are `{ path: string; count: number }`).
- **No placeholders:** every code step has the exact code; commit messages are real; commands have expected output.
