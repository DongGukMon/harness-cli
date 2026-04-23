# Fix Phase 6 verify precondition: ignore pre-existing dirty files — Design Spec (Light)

## Complexity

Small — scoped to one guard in `runPhase6Preconditions` plus a content-hashed baseline snapshot captured once at session init. No new flow, no new phase, no multi-repo refactor.

## Context & Decisions

**Problem.** `src/artifact.ts::runPhase6Preconditions` enforces a blanket working‑tree‑clean invariant via `git status --porcelain`, filtering only the eval report path (Step 2 and Step 4). On mission branches with any pre-existing uncommitted content (issue #68) or after a P7→P5 reopen cycle that leaves unrelated dirty files behind (issue #67), this guard throws immediately — Phase 6 never reaches verification, `durationMs<60ms`.

**Intent of the original guard.** The check exists to protect Phase 6 from a Phase‑5 failure mode where the implementor leaves tracked work uncommitted (so the eval report reflects an unstable tree). The invariant we actually want is *"no Phase‑5-introduced changes are uncommitted"*, not *"the working tree is pristine relative to the empty set"*.

**Chosen baseline anchor — content-hashed fingerprints (file-granular).** The task prompt suggests `state.implRetryBase` "or equivalent". `implRetryBase` is a commit, which only captures tracked-file diffs — it cannot distinguish *pre-existing untracked files* from *Phase‑5-introduced untracked files*. We therefore snapshot the dirty state of `trackedRepos[0].path` (docsRoot, the only repo the precondition inspects) **once at session init**, after `.gitignore` housekeeping, as a set of *fingerprints* — one per dirty path — and persist it in `state.dirtyBaseline: string[]`.

**Both the baseline capture and the live Phase‑6 check use `git status --porcelain --untracked-files=all`** (alias `-uall`). Without this flag, Git collapses an untracked directory to a single `?? dir/` entry — the path is not hashable as a file and any Phase‑5 addition *inside* that directory would produce the same `?? dir/` line, allowing new uncommitted content to be masked by a directory-level fingerprint. `--untracked-files=all` expands every untracked file individually, so each baseline entry binds to exactly one hashable path. This closes the P1 feedback gap from gate‑2 round 2.

Each fingerprint is the tuple `"<XY>\0<path>\0<hash>"`, where:
- `XY` is the 2-char porcelain status code (e.g. ` M`, `??`, `A `, ` D`).
- `path` is the path from porcelain column 4 onward (a file path, not a directory, thanks to `-uall`).
- `hash` is `git hash-object -- <path>` for files that exist on disk, or `""` for deletions / missing files.

Phase 6 preconditions recompute the fingerprint for every live porcelain line (also via `-uall`) and only filter entries whose fingerprint is present in the baseline set. Further Phase‑5 edits to a pre-existing dirty file change its content hash → live fingerprint no longer matches baseline → guard fires as intended. Phase‑5 additions inside a pre-existing untracked directory produce new `?? dir/newfile` entries whose fingerprints were never in the baseline → guard fires as intended.

**Why session-init rather than Phase‑5-open re-snapshot.** A baseline frozen at session init represents "state before the harness touched anything". Re-snapshotting at every Phase‑5 reopen would fold prior Phase‑5 leftovers into the baseline and mask real regressions. Session-init captures the user's genuine pre-existing dirt exactly once; everything introduced after that point is treated as Phase‑5 work and must be committed before Phase 6.

**Rollout scope — new sessions only (P2 feedback).** Legacy `state.json` files written before this change do not contain `dirtyBaseline`. The `loadState` migration defaults the field to `[]`, which preserves the *strict* pre-fix behavior for those in-flight runs. We explicitly decline to lazy-capture a baseline for legacy states on first load, because by the time a legacy run reaches this code path, Phase 5 may have already introduced uncommitted work that would be incorrectly baked into the baseline and masked. Users stuck on an in-flight run hit by #67/#68 are expected to start a new session (`harness run`) with the fixed build. This narrowing is intentional, documented, and matches the review suggestion.

**Scope boundaries.**
- Only `state.trackedRepos[0]` (docsRoot) gets a baseline — this matches the current single-repo behavior of `runPhase6Preconditions`. Multi-repo baseline is out of scope.
- No content-matching for renames (porcelain `R` status) — renames are extremely unlikely in pre-existing session-start state; treated as opaque line-string for baseline parsing. If encountered, the safer `hash = ""` falls through and the fingerprint still works.
- No change to the eval-report cleanup steps (Step 3 of preconditions).
- No change to the staged-file guard (Step 1 of preconditions — see D5).

**Ambiguity resolution.** No open questions remain after reviewing the two issues, the precondition implementation, the Phase‑5 reopen semantics (`src/phases/interactive.ts` Phase‑5 block), and the gate-2 review feedback. All decisions are fixed — no developer Q&A needed for this session.

## Requirements / Scope

R1. `runPhase6Preconditions` MUST filter out porcelain lines whose **fingerprint** (`<XY>\0<path>\0<hash>`) matches an entry in `dirtyBaseline`, in addition to filtering the eval report. Filtering is fingerprint-exact — a path whose content hash has changed since baseline capture MUST NOT match and MUST fire the guard. Both baseline capture and live Phase‑6 porcelain reads MUST use `git status --porcelain --untracked-files=all` so every untracked file has a file-granular fingerprint (no directory collapse).
R2. The fingerprint filter MUST apply to both the initial dirty check (Step 2) and the final clean check (Step 4).
R3. `state.dirtyBaseline: string[]` MUST be captured once at session init in `src/commands/start.ts`, after `.gitignore` commits and before `createInitialState` is persisted, from `git status --porcelain --untracked-files=all` run at `trackedRepos[0].path`. Each dirty path contributes one fingerprint string. Non-git roots and git roots with clean trees produce `[]`.
R4. `state.dirtyBaseline` MUST default to `[]` when reading legacy state files (backward-compatible migration in `src/state.ts::loadState`). Legacy in-flight runs retain strict pre-fix behavior by design (see Decision D4).
R5. Existing tests (`tests/artifact.test.ts`, `tests/phases/verify.test.ts`) MUST keep passing — baseline defaults to `[]` when omitted, matching the current strict behavior.
R6. New tests MUST cover:
    - Pre-existing tracked-dirty file whose fingerprint is in baseline → no throw (issue #68 repro, tracked variant).
    - Pre-existing untracked file whose fingerprint is in baseline → no throw (issue #68 repro, untracked variant).
    - Pre-existing dirty file + an additional **Phase-5-introduced** dirty file → still throws (regression guard).
    - **Pre-existing dirty file whose content is further modified after baseline capture** → still throws (fingerprint mismatch, closes P1 round‑1 feedback gap).
    - **Pre-existing untracked directory in baseline + Phase-5 adds a new file inside it** → still throws (file-granular baseline via `-uall`, closes P1 round‑2 feedback gap).
    - Final clean check also respects baseline (baseline entries remain present after cleanup).
R7. No change to the error message (`'Working tree must be clean before verification'`) — keeps existing string assertions in tests and logs.

## Design

### State schema change

`src/types.ts`:

```ts
export interface HarnessState {
  // ... existing fields ...
  dirtyBaseline: string[]; // fingerprint strings captured at session init
}
```

`src/state.ts::createInitialState` returns `dirtyBaseline: []`. `loadState` migration:

```ts
if (!Array.isArray(raw.dirtyBaseline)) raw.dirtyBaseline = [];
```

### Fingerprint helper

A small helper — new exported function `captureDirtyBaseline(cwd: string): string[]` — lives in `src/artifact.ts` (next to `runPhase6Preconditions`, which is the only consumer). It runs `git status --porcelain --untracked-files=all`, parses each line into `{ xy, path }`, computes `git hash-object -- <path>` when the path exists on disk as a file (safe-wrapped — missing file / `R` status fall through to `hash = ""`), and returns the fingerprint list `"<xy>\0<path>\0<hash>"`. Non-git cwd returns `[]`.

The `--untracked-files=all` flag guarantees that every untracked file is listed individually rather than collapsed into a parent `?? dir/` entry, so each baseline fingerprint binds to exactly one hashable file path. This is the single point where Phase‑5 additions inside a pre-existing untracked directory are distinguished from the baseline.

### Capture point in `src/commands/start.ts`

After step 11 (HEAD re-read post-`.gitignore` commit) and immediately after `state.trackedRepos = trackedRepos;` in step 12, call:

```ts
state.dirtyBaseline = inGitRepo ? captureDirtyBaseline(trackedRepos[0].path) : [];
```

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

Convert `dirtyBaseline` to a `Set<string>` once. Replace the two `git status --porcelain` calls in the function (Step 2 `porcelainOutput`, Step 4 `finalStatus`) with `git status --porcelain --untracked-files=all` so live fingerprints are computed on the same file-granular representation the baseline was captured with — without this flag the live output could collapse an untracked directory and no recomputed fingerprint would match a baseline file-level entry. Then, in both Steps 2 and 4, **before** the existing eval-report filter, recompute the fingerprint per live line (same parsing + `git hash-object`) and drop the line if its fingerprint is in the baseline set. Remaining logic unchanged.

Caller in `src/phases/verify.ts::runVerifyPhase` passes `state.dirtyBaseline ?? []`.

### Non-goals

- No per-repo baseline (trackedRepos[1+]).
- No re-snapshot on reopen.
- No lazy baseline capture for legacy in-flight runs (see D4).
- No change to `hasStagedChanges` / `isWorkingTreeClean` used in `start.ts` preflight.
- No change to the staged-file check in Step 1 of preconditions (still fires on any staged file other than the eval report — staged work is unambiguously Phase‑5 output the user forgot to commit, not "pre-existing dirt").

## Implementation Plan

- **Task 1 — State schema + migration.** Add `dirtyBaseline: string[]` to `HarnessState` in `src/types.ts`. Default it to `[]` in `createInitialState` (`src/state.ts`). Add the one-line migration in `loadState` (`src/state.ts`).
- **Task 2 — Fingerprint helper + session-init capture.** Add `captureDirtyBaseline(cwd)` in `src/artifact.ts`. In `src/commands/start.ts`, immediately after `state.trackedRepos = trackedRepos;` (step 12), assign `state.dirtyBaseline = inGitRepo ? captureDirtyBaseline(trackedRepos[0].path) : []`.
- **Task 3 — Filter precondition + wire caller + tests.** Extend `runPhase6Preconditions` with a `dirtyBaseline: string[] = []` parameter, switch its two `git status --porcelain` invocations to `--porcelain --untracked-files=all`, compute live fingerprints and filter Steps 2 and 4 before the eval-report filter. Update `src/phases/verify.ts` to pass `state.dirtyBaseline ?? []`. Add six `tests/artifact.test.ts` cases covering R6 (including the content-mismatch regression and the untracked-directory-expansion regression from P1 gate‑2 rounds 1 and 2). Update `tests/phases/verify.test.ts` only if its `runPhase6Preconditions` mock assertion needs adjusting for the optional 4th arg.

## Eval Checklist Summary

Verification JSON lives at `.harness/2026-04-24-fix-phase-6-verify-213d/checklist.json`. It runs:

1. `pnpm tsc --noEmit` — typecheck the state schema + new signature.
2. `pnpm vitest run tests/artifact.test.ts` — unit coverage for `runPhase6Preconditions` including new baseline + content-mismatch cases.
3. `pnpm vitest run tests/phases/verify.test.ts` — ensure `runVerifyPhase` caller still integrates cleanly.
4. `pnpm vitest run` — full suite regression.
5. `pnpm build` — ensure dist compiles (integration tests reference dist).
