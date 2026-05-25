# Phase 6 stability — eval-commit empty-diff & mid-session dirty file tolerance

Related docs (created in this run):
- Plan: `docs/plans/2026-05-25-untitled-f041.md` (to be authored in Phase 3)
- Decisions log: `.harness/2026-05-25-untitled-f041/decisions.md`

Linked GitHub issues:
- Closes #112 — Phase 6 `verify_throw` on files created mid-session
- Closes #113 — Phase 6 `eval_commit_failed` when reopen cycle produces a byte-identical eval report
- Out of scope (separate runs): #110, #114, #116, #117
- Already resolved by PR #118, eligible for issue-close housekeeping outside this run: #111

## Context & Decisions

### Why this scope

The user asked us to triage the GitHub issue tracker and ship the harness-cli improvements that the tracker says are needed. The tracker has 7 open issues and 14 closed. Triage:

| Issue | Disposition |
|---|---|
| #111 | **Already resolved** by merged PR #118 (per-requirement-ID retry budget, merged 2026-05-25). Tracker entry can be closed administratively — no code change in this run. |
| #110, #114, #116, #117 | **Real open work**, each requires a separate spec/plan. Out of scope here. |
| #112, #113 | **Bundled into this spec.** Both are Phase 6 (`verify` + `commitEvalReport`) reliability bugs: small, mechanical fixes, same code area (`src/artifact.ts`), high impact on the operator's ability to recover after a P7-reject → P5-reopen cycle. |

Bundling #112 + #113 keeps the spec scope to one tightly-related area (Phase 6 precondition + eval-report commit), avoiding the "multiple independent subsystems" scope problem flagged by the brainstorming skill. The other open issues are each substantial enough to warrant their own run.

### Key decisions (rationale + alternatives are in `decisions.md`)

- **D1**: `runPhase6Preconditions` auto-extends `state.dirtyBaseline` with **new untracked entries only** (XY `??`). Modified-tracked files still throw, so a P5 implementation slip is never silently swallowed.
- **D2**: `normalizeArtifactCommit` skips the `git commit` (returns `false`) when `git add` produces zero staged delta. No `--allow-empty` fallback.
- **D3**: `commitEvalReport` return type widens from `'committed' | 'skipped'` to `'committed' | 'unchanged' | 'gitignored'`. Both `'committed'` and `'unchanged'` set `state.evalCommit` and `state.verifiedAtHead` to `getHead(docsRoot)`. Only `'gitignored'` clears them to `null`.
- **D4**: New event `dirty_baseline_extended { phase: 6, addedPaths: string[], totalCount: number }` is emitted whenever D1 fires. Persisted via `state.dirtyBaseline` so subsequent retries see the same baseline.
- **D5**: Throw messages in `runPhase6Preconditions` include the offending porcelain lines, and `phase_end.details.offendingPaths` is added when the function throws so operators see the cause without reading source.

## Complexity

Small — touches one logical area (Phase 6 verify / artifact commit). LoC count under ~300 including tests. Spreads across `src/artifact.ts`, `src/phases/verify.ts`, `src/phases/runner.ts`, `src/resume.ts`, `src/types.ts`, plus tests. No new modules, no schema migration, no structural refactor.

## Goals

- **G1**: `phase-harness` survives a P7-reject → P5-reopen → P6-rerun cycle when the eval report regenerates byte-identically to HEAD, instead of crashing with `eval_commit_failed`.
- **G2**: `phase-harness` survives mid-session untracked-file noise (e.g. `.claude/scheduled_tasks.lock`) in the tracked repo's working tree, instead of looping on `verify_throw`.
- **G3**: When Phase 6 precondition *does* throw legitimately (modified tracked file), the operator sees the offending paths in both the stderr message and the `phase_end.details` payload.

## Non-goals

- Not changing the P7-reject → P5-reopen orchestration. The fix is specifically about how P6 handles the resulting state.
- Not auto-recovering from modified-tracked-file dirtiness. Those still throw — by design.
- Not refactoring `commitEvalReport` callers into a shared helper. The branch-write pattern is repeated in 3 sites but each site has slightly different surrounding logic (runner-mainline vs resume-error-retry vs resume-stored-result). The redundancy is acceptable for ~10 LoC per site; a helper would be churn.
- Not addressing the other 4 open issues (#110, #114, #116, #117) — those are out of scope.
- Not closing #111 in this run. Issue-close is an administrative action; the code fix already shipped in PR #118. The operator can `gh issue close 111` directly.

## Requirements

### R1 — eval-commit empty-diff handling (issue #113)

- **R1.a**: `normalizeArtifactCommit(filePath, message, cwd?)` MUST NOT throw when `git add "${filePath}"` produces zero staged changes (i.e. the staged content matches HEAD byte-for-byte). It MUST return `false` in that case, leaving the working tree and index in their post-`git add` state.
- **R1.b**: `normalizeArtifactCommit` MUST continue to throw with the existing message `"Cannot auto-commit artifact: other staged changes exist."` when other files are staged. No behavior change in that branch.
- **R1.c**: `commitEvalReport(state, cwd)` return type MUST be `'committed' | 'unchanged' | 'gitignored'`:
  - `'committed'` — a new commit was created; HEAD advanced.
  - `'unchanged'` — no new commit was created because the working-tree eval report matches HEAD byte-for-byte AND the eval report path is present in HEAD's tree. The function MUST verify HEAD actually contains the eval report at the expected path (using `git ls-tree -r --name-only HEAD`) before returning `'unchanged'`.
  - `'gitignored'` — `isPathGitignored(filePath, cwd)` returned true; no commit attempt.
- **R1.d**: Both call sites in `src/resume.ts` (lines ~195 and ~246) and the one in `src/phases/runner.ts` (line ~1335) MUST treat `'committed'` and `'unchanged'` identically: `state.evalCommit = getHead(docsRoot); state.verifiedAtHead = getHead(docsRoot);`. The `'gitignored'` branch keeps the current null-clearing behavior.

### R2 — mid-session untracked file tolerance (issue #112)

- **R2.a**: `runPhase6Preconditions(evalReportPath, runId, cwd?, dirtyBaseline)` MUST return `{ extendedBaseline: string[] }` instead of `void`. The returned array is the list of fingerprints added to baseline during this call (empty array when nothing was extended).
- **R2.b**: In Step 2 (porcelain filter, pre-cleanup), any porcelain line whose XY status code is exactly `??` AND whose computed fingerprint is not in the input `baselineSet` AND whose path is not the eval report MUST be moved from the "dirty" classification into the "tolerated" classification: its fingerprint is appended to `extendedBaseline`, and it does NOT contribute to the throw decision.
- **R2.c**: Step 4 (post-cleanup final clean check) MUST also apply the R2.b tolerance, using the union of `baselineSet` and `extendedBaseline` accumulated in Step 2.
- **R2.d**: Modified-tracked statuses (e.g. ` M`, `M `, `MM`, `A `, ` D`, `D `) on non-baseline paths MUST continue to throw. Only the `??` status is tolerated.
- **R2.e**: `runVerifyPhase` MUST:
  1. Call `runPhase6Preconditions` and capture `extendedBaseline`.
  2. If `extendedBaseline.length > 0`, append those fingerprints to `state.dirtyBaseline`, persist via `writeState(runDir, state)`, and emit `logger.logEvent({ event: 'dirty_baseline_extended', phase: 6, addedPaths: <paths slice of fingerprints, NOT raw fingerprints>, totalCount: state.dirtyBaseline.length })`.

### R3 — diagnostic surfacing (issues #112 and #113 both ask for this)

- **R3.a**: When `runPhase6Preconditions` throws in Step 1 (staged guard), the error message MUST be `"Working tree must be clean before verification: staged files outside eval report: <comma-separated list>"`.
- **R3.b**: When `runPhase6Preconditions` throws in Step 2 (porcelain filter), the error message MUST be `"Working tree must be clean before verification: dirty paths: <comma-separated XY+path tokens, max 10>"`.
- **R3.c**: When `runPhase6Preconditions` throws in Step 4 (post-cleanup final check), the error message MUST be `"Working tree is not clean after eval report cleanup: dirty paths: <comma-separated XY+path tokens, max 10>"`.
- **R3.d**: In `src/phases/runner.ts`, the `try { commitEvalReport(...) } catch (err)` block that emits `phase_end status: 'failed'` with `details.reason: 'eval_commit_failed'` MUST also emit `details.offendingPaths` when the underlying throw came from `runPhase6Preconditions` (i.e. the error message starts with `"Working tree"`); the value is the substring after `"dirty paths: "` (or `"staged files outside eval report: "`), best-effort parsed back into a `string[]`. When the error came from another path, `offendingPaths` is omitted.
  - Note: the runner-side throw for preconditions happens earlier than the `commitEvalReport` try/catch — `runPhase6Preconditions` is called inside `runVerifyPhase`. So R3.d's `phase_end.details.offendingPaths` enrichment lives in the `verify_throw` event chain, not the `eval_commit_failed` chain. Implementation: when `runVerifyPhase` (or its catch in the runner) catches the precondition throw, add `details.offendingPaths` to the corresponding `phase_end` event.

### R4 — backward compatibility

- **R4.a**: Existing `state.json` files MUST still load. `state.dirtyBaseline` is already in the schema (`string[]`); R2 only mutates it (extends), no schema change.
- **R4.b**: `commitEvalReport` return-type widening from `'committed' | 'skipped'` to `'committed' | 'unchanged' | 'gitignored'` is a breaking change in the function signature. All in-repo callers and test mocks MUST be updated in the same PR. Search yields 3 production callers (`runner.ts` x1, `resume.ts` x2) and 7 test files that mock the function — all are in-repo, so the breaking change is contained.
- **R4.c**: The `dirty_baseline_extended` event is additive; consumers of `events.jsonl` that don't recognize it MUST continue to function (downstream readers like `retro.ts` already iterate-and-skip unknown event types — verify this assumption holds in the test plan).

## Success Criteria

- **SC1**: New test `tests/artifact.test.ts > normalizeArtifactCommit > byte-identical content returns false without throwing` creates a repo with a file at HEAD, calls `normalizeArtifactCommit` with that file's current content unchanged, asserts return `false`, asserts no new commit was created (`git rev-list HEAD --count` unchanged).
- **SC2**: New test `tests/artifact.test.ts > commitEvalReport > returns 'unchanged' when HEAD already contains the report byte-identically` simulates the P7-reject → P5-reopen → byte-identical regenerate flow, asserts return `'unchanged'`, asserts caller logic (via integration test) sets `state.evalCommit = HEAD`.
- **SC3**: New test `tests/artifact.test.ts > runPhase6Preconditions > new untracked file mid-session does not throw and is added to extendedBaseline` creates a repo with one baseline dirty entry, then creates a new untracked file outside baseline, calls the function, asserts no throw and `extendedBaseline.length === 1`.
- **SC4**: New test `tests/artifact.test.ts > runPhase6Preconditions > modified tracked file outside baseline still throws` creates a tracked file, modifies it, calls the function, asserts throw with R3.b error message containing the file path.
- **SC5**: New test `tests/integration/p6-mid-session-dirt.test.ts` (or extension of an existing P6 integration test) runs a synthetic Phase 6 with `dirty_baseline_extended` enabled, asserts the event lands in `events.jsonl` with the expected `addedPaths` value.
- **SC6**: `pnpm tsc --noEmit` passes (lint alias).
- **SC7**: `pnpm vitest run` passes (full suite). Existing tests that mock `commitEvalReport` are updated to use the new return-type union.
- **SC8**: `pnpm build` passes.

## Invariants

- **I1**: When `commitEvalReport` returns `'unchanged'`, the file at `state.artifacts.evalReport` (resolved to absolute path) MUST exist on disk AND be present in HEAD's tree at the expected path. If either is false, the function MUST return `'committed'` (after creating the commit) or throw (if the commit fails for an unrelated reason) — never silently report `'unchanged'` when HEAD doesn't actually contain the report.
- **I2**: `state.dirtyBaseline` MUST be a superset of itself across phases (monotone-growing within a single run). The R2 extension MUST only append, never replace.
- **I3**: `runPhase6Preconditions` MUST NOT mutate the input `dirtyBaseline` array (it receives the array by reference today). The extension is returned via `extendedBaseline`, and the caller is responsible for the state mutation. Tests should verify the input array is not mutated.
- **I4**: For every `commitEvalReport` call site in the codebase, the post-call state assignment for `state.evalCommit` MUST match this table: `'committed' | 'unchanged'` → `getHead(docsRoot)`; `'gitignored'` → `null`. The grep `rg -n 'commitEvalReport\(' -g '!tests/**' -g '!**/*.test.ts' --type ts | rg -v 'export function commitEvalReport'` MUST return exactly 3 call sites (currently `src/resume.ts:195`, `src/resume.ts:246`, `src/phases/runner.ts:1335`), and each one MUST have a matching `'unchanged'` branch in the surrounding `if`/`switch` block. Line numbers may shift after edits — the constraint is on the count and file paths, not the exact line numbers.
- **I5**: The throw messages in `runPhase6Preconditions` MUST include `"dirty paths:"` (Step 2 / Step 4) or `"staged files outside eval report:"` (Step 1), enabling R3.d's substring-based parsing in the runner-side `phase_end` enrichment. Tests MUST assert these literal substrings.

## Test Plan

### Unit tests (`tests/artifact.test.ts`)

1. `normalizeArtifactCommit > byte-identical to HEAD returns false without throw` (SC1).
2. `normalizeArtifactCommit > content differs from HEAD still commits` (regression — existing behavior).
3. `normalizeArtifactCommit > other staged file still throws with existing message` (regression).
4. `commitEvalReport > returns 'unchanged' when byte-identical AND HEAD has the report` (SC2 unit half).
5. `commitEvalReport > returns 'committed' when content differs from HEAD` (regression).
6. `commitEvalReport > returns 'gitignored' when path is in .gitignore` (regression).
7. `runPhase6Preconditions > new untracked outside baseline → extendedBaseline populated, no throw` (SC3).
8. `runPhase6Preconditions > new untracked matching eval-report path → handled by Step 3 cleanup, not extension` (edge case).
9. `runPhase6Preconditions > modified tracked file outside baseline → throws with R3.b message including path` (SC4).
10. `runPhase6Preconditions > staged file outside baseline AND outside eval report → throws with R3.a message` (regression + R3.a).
11. `runPhase6Preconditions > input dirtyBaseline array not mutated` (I3).

### Integration tests

12. `tests/integration/p6-mid-session-dirt.test.ts` — synthesize a P6 run, drop an untracked file before precondition, assert `dirty_baseline_extended` event with correct `addedPaths` lands in `events.jsonl` (SC5).
13. Update `tests/phases/eval-report-commit-squash.test.ts` to cover the byte-identical regenerate path (already exercises `commitEvalReport`).
14. Update all mock sites that return `commitEvalReport: vi.fn().mockReturnValue('committed')` to also exercise an `'unchanged'` return-value path in at least one test per file.

### Manual smoke

15. Build, install locally (without `pnpm link --global` per CLAUDE.md), run a synthetic full-flow against a small fixture repo where Phase 5 reopen produces an identical eval report → confirm Phase 6 completes instead of looping.
16. Drop `.claude/scheduled_tasks.lock` (or equivalent untracked file) into the tracked repo cwd between Phase 1 and Phase 6 → confirm Phase 6 precondition tolerates it and writes `dirty_baseline_extended` to `events.jsonl`.

### Documentation sync (per CLAUDE.md "문서 동기화 의무")

17. Verify whether the change affects user-visible behavior. The behavior delta is:
    - Phase 6 recoverable in two more cases (previously unrecoverable).
    - `events.jsonl` has one new event type.
    - Error messages contain offending paths (more verbose).

    These are operator-observable. Update `README.md`, `README.ko.md`, `docs/HOW-IT-WORKS.md`, `docs/HOW-IT-WORKS.ko.md` event-list / failure-handling sections accordingly. If review concludes no doc change is needed, note the rationale in the PR description per the repo rule.
