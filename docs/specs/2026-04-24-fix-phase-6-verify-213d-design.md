# Fix Phase 6 verify precondition: ignore pre-existing dirty files — Design Spec (Light)

## Complexity

Small — scoped to one guard in `runPhase6Preconditions` plus a baseline snapshot captured once at session init. No new flow, no new phase, no multi-repo refactor.

## Context & Decisions

**Problem.** `src/artifact.ts::runPhase6Preconditions` enforces a blanket working‑tree‑clean invariant via `git status --porcelain`, filtering only the eval report path (Step 2 and Step 4). On mission branches with any pre-existing uncommitted content (issue #68) or after a P7→P5 reopen cycle that leaves unrelated dirty files behind (issue #67), this guard throws immediately — Phase 6 never reaches verification, `durationMs<60ms`.

**Intent of the original guard.** The check exists to protect Phase 6 from a Phase‑5 failure mode where the implementor leaves tracked work uncommitted (so the eval report reflects an unstable tree). The invariant we actually want is *"no Phase‑5-introduced changes are uncommitted"*, not *"the working tree is pristine relative to the empty set"*.

**Chosen baseline anchor.** The task prompt suggests `state.implRetryBase` "or equivalent". `implRetryBase` is a commit, which only captures tracked-file diffs — it cannot distinguish *pre-existing untracked files* (e.g. scratch notes) from *Phase‑5-introduced untracked files*. We therefore snapshot the `git status --porcelain` output of `trackedRepos[0].path` (docsRoot, the only repo the precondition inspects) **once at session init**, after `.gitignore` housekeeping, and persist it in `state.dirtyBaseline: string[]`. Phase 6 preconditions subtract this baseline from the live porcelain output before evaluating cleanliness.

**Why session-init rather than Phase‑5-open re-snapshot.** A baseline frozen at session init represents "state before the harness touched anything". Re-snapshotting at every Phase‑5 reopen would fold prior Phase‑5 leftovers into the baseline and mask real regressions. Session-init captures the user's genuine pre-existing dirt exactly once; everything introduced after that point is treated as Phase‑5 work and must be committed before Phase 6.

**Scope boundaries.**
- Only `state.trackedRepos[0]` (docsRoot) gets a baseline — this matches the current single-repo behavior of `runPhase6Preconditions`. Multi-repo baseline is out of scope.
- Legacy states without `dirtyBaseline` (loaded from existing runs) default to `[]` via the state migration — current behavior preserved for in-flight runs.
- The guard still fires for Phase‑5-introduced uncommitted changes: any porcelain line that is not in `dirtyBaseline` and not the eval report triggers the throw.
- No change to the eval-report cleanup steps (Step 3 of preconditions).

**Ambiguity resolution.** No open questions remained after reviewing the two issues, the precondition implementation, and the Phase‑5 reopen semantics (`src/phases/interactive.ts` Phase‑5 block). All decisions above are fixed — no developer Q&A needed for this session.

## Requirements / Scope

R1. `runPhase6Preconditions` MUST filter out porcelain lines that exactly match a line recorded in `dirtyBaseline`, in addition to filtering the eval report.
R2. The filter MUST apply to both the initial dirty check (Step 2) and the final clean check (Step 4).
R3. `state.dirtyBaseline: string[]` MUST be captured once at session init in `src/commands/start.ts`, after `.gitignore` commits and before `createInitialState` is persisted, from the porcelain output of `trackedRepos[0].path`.
R4. `state.dirtyBaseline` MUST default to `[]` when reading legacy state files (backward-compatible migration in `src/state.ts::loadState`).
R5. Existing tests (`tests/artifact.test.ts`, `tests/phases/verify.test.ts`) MUST keep passing — baseline defaults to `[]` when omitted, matching the current strict behavior.
R6. New tests MUST cover:
    - Pre-existing tracked-dirty file listed in baseline → no throw (issue #68 repro).
    - Pre-existing untracked file listed in baseline → no throw (issue #68 repro).
    - Pre-existing dirty file + a new Phase-5-introduced dirty file → still throws (regression guard).
    - Final clean check also respects baseline (baseline entries remain present after cleanup).
R7. No change to the error message (`'Working tree must be clean before verification'`) — keeps existing string assertions in tests and logs.

## Design

### State schema change

`src/types.ts`:

```ts
export interface HarnessState {
  // ... existing fields ...
  dirtyBaseline: string[]; // porcelain lines from trackedRepos[0] at session init
}
```

`src/state.ts::createInitialState` returns `dirtyBaseline: []`. Callers set it immediately after construction if the repo has pre-existing dirty content. `loadState` migration:

```ts
if (!Array.isArray(raw.dirtyBaseline)) raw.dirtyBaseline = [];
```

### Capture point in `src/commands/start.ts`

After step 11 (HEAD re-read post-`.gitignore` commit) and immediately after `state.trackedRepos = trackedRepos;` in step 12, compute:

```ts
let dirtyBaseline: string[] = [];
if (inGitRepo) {
  try {
    const out = execSync('git status --porcelain', {
      cwd: trackedRepos[0].path, encoding: 'utf-8',
    }).trim();
    dirtyBaseline = out === '' ? [] : out.split('\n').filter(Boolean);
  } catch { /* best-effort, leave empty */ }
}
state.dirtyBaseline = dirtyBaseline;
```

Captured only for `inGitRepo === true`; non-git roots retain `[]` (current behavior — no guard to narrow anyway).

### Precondition filter in `src/artifact.ts::runPhase6Preconditions`

Extend signature:

```ts
export function runPhase6Preconditions(
  evalReportPath: string,
  runId: string,
  cwd?: string,
  dirtyBaseline: string[] = [],
): void
```

Convert `dirtyBaseline` to a `Set<string>` once. In Step 2 (`porcelainOutput`) and Step 4 (`finalStatus`), **before** the existing eval-report filter, drop any line whose exact string is a member of the baseline set. Remaining logic unchanged.

Caller in `src/phases/verify.ts::runVerifyPhase` passes `state.dirtyBaseline ?? []`.

### Non-goals

- No per-repo baseline (trackedRepos[1+]).
- No re-snapshot on reopen.
- No change to `hasStagedChanges` / `isWorkingTreeClean` used in `start.ts` preflight.
- No change to the staged-file check in Step 1 of preconditions (still fires on any staged file other than the eval report — staged work is unambiguously Phase‑5 output the user forgot to commit, not "pre-existing dirt").

## Implementation Plan

- **Task 1 — State schema + migration.** Add `dirtyBaseline: string[]` to `HarnessState` in `src/types.ts`. Default it to `[]` in `createInitialState` (`src/state.ts`). Add the one-line migration in `loadState` (`src/state.ts`).
- **Task 2 — Capture baseline at session init.** In `src/commands/start.ts`, immediately after `state.trackedRepos = trackedRepos;` (step 12), compute porcelain snapshot from `trackedRepos[0].path` when `inGitRepo`, assign to `state.dirtyBaseline`. Keep `[]` in the non-git-repo branch.
- **Task 3 — Filter precondition + wire caller + tests.** Extend `runPhase6Preconditions` with a `dirtyBaseline: string[] = []` parameter, filter Steps 2 and 4. Update `src/phases/verify.ts` to pass `state.dirtyBaseline ?? []`. Add four `tests/artifact.test.ts` cases covering R6. Update `tests/phases/verify.test.ts` if its `runPhase6Preconditions` mock signature needs adjusting (optional 4th arg — mock should still match).

## Eval Checklist Summary

Verification JSON lives at `.harness/2026-04-24-fix-phase-6-verify-213d/checklist.json`. It runs:

1. `pnpm tsc --noEmit` — typecheck the state schema + new signature.
2. `pnpm vitest run tests/artifact.test.ts` — unit coverage for `runPhase6Preconditions` including new baseline cases.
3. `pnpm vitest run tests/phases/verify.test.ts` — ensure `runVerifyPhase` caller still integrates cleanly.
4. `pnpm vitest run` — full suite regression.
5. `pnpm build` — ensure dist compiles (integration tests reference dist).
