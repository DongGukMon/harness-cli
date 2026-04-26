# Phase 6 eval-report path & commit hardening — Design Spec (Light)

## Complexity
Small — single root cause (path resolution) + 2 narrow defensive fixes; ≤3 tasks.

## Context & Decisions

Three open issues (#91, #93, #94) describe Phase 6 / Phase 7 failure modes from recent multi-repo dogfood runs. Branch name `fix-phase6` scopes this work to **Phase 6** specifically.

**Issue triage:**

| Issue | Bug | In scope? |
|---|---|---|
| #91 | P6 → P7 eval-report path resolved against different bases (`cwd` vs `docsRoot`) | ✅ — primary fix |
| #93 RC-1 | `commitEvalReport` returns `'committed'` even when no commit was made | ✅ — defensive |
| #93 RC-2 | `normalizeArtifactCommit` calls `git add` on staged-deletion → fatal | ✅ — defensive |
| #93 RC-3 | Same path mismatch as #91 | ✅ — covered by #91 fix |
| #94 Bug 2 | `state.evalCommit` never advances when `eval_commit_failed`; details opaque | ✅ — partial: surface underlying error in event details (the failure mode itself is largely eliminated by #91 fix) |
| #94 Bug 1 | Sidecar replay miscounts as next `retryIndex` (P7 retry counter) | ❌ — P7/runtime, separate fix |
| #94 Bug 3 | Post-cap dispatch hang (no escalation, main loop frozen) | ❌ — main-loop watchdog, separate fix |

**Why this scope:** #91 is the load-bearing root cause. #93 is a cascaded failure mode of #91 (manual workaround triggers a second bug); fixing #91 eliminates the trigger but the silent-lie + git-add-on-deletion behaviors are worth defensive-hardening. #94 Bug 2 is partly a downstream symptom — once `commitEvalReport` no longer fails spuriously, evalCommit drift disappears, but surfacing the underlying error in `phase_end.details` still helps diagnostics. #94 Bug 1 (P7 retry counter) and Bug 3 (dispatch hang) live in different layers and warrant their own focused fixes — out of scope here.

**Root cause of #91/#93 (single point of confusion):**

`state.artifacts.evalReport` is stored as a **relative path** with no canonical base. Three consumers resolve it against three different bases:

- **Producer** (`runVerifyPhase` in `src/phases/verify.ts:113-117`): spawns `harness-verify.sh` with `cwd: outerCwd` → script resolves `OUTPUT_FILE` relative to `outerCwd` → file written at `<outerCwd>/<relPath>`.
- **Eval-cleanup precondition** (`runPhase6Preconditions` called from `verify.ts:97-98`): receives `docsRoot = trackedRepos[0].path` → operates at `<docsRoot>/<relPath>`.
- **Commit step** (`commitEvalReport` called from `runner.ts:1023-1028`): receives `docsRoot` → commits at `<docsRoot>/<relPath>`.
- **Consumer / gate-7 prompt** (`buildGatePromptPhase7` in `assembler.ts:512-518`): uses `docsRoot` → reads from `<docsRoot>/<relPath>`.

In **single-repo runs** `outerCwd === docsRoot` and the bug is invisible — every non-test-bench run on this repo is single-repo. In **multi-repo runs where `outerCwd` is the parent of `trackedRepos[0]`** (e.g. mission directory containing N tracked package repos), the producer writes to the wrong place, so:

- Cleanup precondition does no-op (file absent at docsRoot)
- harness-verify.sh writes report at outerCwd (correctly, all checks pass)
- Commit step sees no file at docsRoot → silently returns `'committed'` while making no commit (RC-1)
- Gate-7 reads from docsRoot → emits `(file not found: …)` literal → Codex P1-rejects on missing eval artifact
- P5 reopen → agent commits eval report manually at docsRoot → second P6 cycle: precondition deletes (`git rm -f`), verify writes new copy at outerCwd, commit step sees staged deletion → falls through to `git add` on missing file → fatal (RC-2)

**Decision: pick `docsRoot` as the canonical base** for the eval report and align the producer to write there. Rationale:
1. The eval report is a documentation artifact that lives in the tracked repo's docs tree (single tracked repo, or the first one for multi-repo).
2. Two of three consumers (cleanup, commit) and the gate-7 prompt assembler already use `docsRoot`. Changing them to `outerCwd` would break the documented `docs/process/evals/<runId>-eval.md` location for any user with `cwd === docsRoot` (the common case).
3. The verify subprocess only **writes** to `OUTPUT_FILE` and the path is passed as an argv. The script doesn't care where the file is, only the `cwd` of the subprocess matters for **check execution** (e.g. `pnpm test`). We can pass an **absolute** output path while keeping the spawn cwd at `outerCwd`. Minimal change.

**Alternative considered:** Store an absolute resolved path in `state.artifacts.evalReport` after the first write. Rejected — invasive (touches state schema, migration, every reader, gitignored-vs-tracked path-key checks). The "pass abs path to verify script" approach is one-line equivalent without state-schema impact.

## Requirements / Scope

**Functional:**
1. After `runVerifyPhase` runs, the eval report file exists at `<docsRoot>/<state.artifacts.evalReport>` (where `docsRoot = state.trackedRepos[0]?.path ?? outerCwd`), regardless of whether `outerCwd === docsRoot`.
2. `commitEvalReport` returns `'skipped'` (not `'committed'`) when no actual commit was created (file absent / no-op).
3. `normalizeArtifactCommit` does not throw when its target file is staged-for-deletion but absent on disk; it returns `false` (no-op) instead.
4. When `commitEvalReport` throws (the truly-broken case), the resulting `phase_end` event's `details.error` field carries the underlying error message so log-only diagnostics can identify the cause without re-reading stderr.
5. Subprocess execution semantics for harness-verify.sh remain unchanged — checks still execute relative to `outerCwd` (the canonical task root); `pnpm test` etc. behave as before.

**Non-functional:**
- Backward compatibility: existing single-repo runs (cwd === docsRoot) must produce identical artifacts at identical paths.
- No state-schema migration. `state.artifacts.evalReport` remains a relative path string.
- No new dependencies.

**Out of scope:**
- #94 Bug 1 (sidecar replay retry counting) — separate fix
- #94 Bug 3 (dispatch hang / main-loop watchdog) — separate fix
- Restructuring `state.artifacts.*` to absolute or schema-versioned paths
- Renaming or relocating the eval report under any other directory convention

## Design

**Affected files (precise):**

| File | Change |
|---|---|
| `src/phases/verify.ts` | Compute `evalAbsPath = resolveArtifact(state, state.artifacts.evalReport, cwd)` (uses docsRoot). Pass `evalAbsPath` to harness-verify.sh as `OUTPUT_FILE` arg instead of the relative path. Use the same absolute path for the post-exit `hasSummary`/`isEvalReportValid` checks. (The relative `state.artifacts.evalReport` is still used as the canonical state field; resolution to absolute happens at consumption.) |
| `src/artifact.ts` — `commitEvalReport` | When `normalizeArtifactCommit` returns `false`, return `'skipped'` instead of `'committed'`. Keeps existing `isPathGitignored` early-return. |
| `src/artifact.ts` — `normalizeArtifactCommit` | After `getStagedFiles` matches the single-or-zero-staged branch, guard `git add` with `existsSync(join(cwdAbs, filePath))`. If file does not exist on disk, return `false` (no-op) instead of throwing — covers the staged-deletion case where `git add` would fail with `fatal: pathspec did not match any files`. The "other staged files" throw branch is unchanged. |
| `src/types.ts` | Extend `phase_end.details` to permit an optional `error?: string` field alongside the existing `reason: string`. |
| `src/phases/runner.ts` (line 1036–1043) | When `commitEvalReport` throws, include the caught error message in `phase_end.details.error`. |
| `tests/artifact.test.ts` | Add: (a) `commitEvalReport` returns `'skipped'` when target absent; (b) `normalizeArtifactCommit` returns `false` (no throw) when file is staged-for-deletion + absent on disk. |
| `tests/phases/verify.test.ts` | Add: in a multi-dir layout where `cwd ≠ docsRoot`, `runVerifyPhase` writes the eval report at `<docsRoot>/<rel>` (not `<cwd>/<rel>`). |

**Behavior table (after fix):**

| Scenario | Producer write path | Cleanup operates on | Commit operates on | Consumer reads from | Result |
|---|---|---|---|---|---|
| Single-repo (cwd === docsRoot) | `<cwd>/<rel>` | `<cwd>/<rel>` | `<cwd>/<rel>` | `<cwd>/<rel>` | unchanged from today |
| Multi-repo (cwd !== docsRoot) | `<docsRoot>/<rel>` *(fixed)* | `<docsRoot>/<rel>` | `<docsRoot>/<rel>` | `<docsRoot>/<rel>` | path-aligned end-to-end |
| Eval already committed → P5 reopen → P6 retry | precondition `git rm` deletes; producer writes new copy at `<docsRoot>/<rel>`; commit replaces | normalizeArtifactCommit sees staged deletion + new working-copy file → existing branch handles it (existsSync true → git add succeeds) | commit advances state.evalCommit | gate-7 reads new content | succeeds (was: RC-2 throw) |
| Eval-commit truly fails (e.g. real git error) | producer writes correctly | precondition succeeds | normalizeArtifactCommit / git error → throw | runner catches → phase_end emitted with `details.reason='eval_commit_failed'` AND `details.error='<git stderr>'` *(new)* | diagnosable from events.jsonl alone |
| Eval-commit no-op (file already absent and no staged change) | producer didn't run / nothing to commit | – | normalizeArtifactCommit → false; commitEvalReport → `'skipped'` *(was: `'committed'`)* | runner clears `evalCommit/verifiedAtHead` per `'skipped'` branch | state truthful — no stale anchor (was: RC-1 silent lie) |

**`resolveArtifact` reuse:** `src/artifact.ts:91-99` already exports the canonical resolver. We do **not** introduce a parallel resolver in `verify.ts`; we reuse `resolveArtifact(state, relPath, outerCwd)` to keep "pick docsRoot, fall back to outerCwd" in one place. The `.harness/...` system-file branch in `resolveArtifact` does not apply here — the eval report relative path starts with `docs/...`.

**Logging contract addendum:** `phase_end.details` is currently typed `{ reason: string }` and emitted at four sites in runner.ts. Extending it to `{ reason: string; error?: string }` is additive — existing emit sites (`verify_throw`, `redirected`, `eval_commit_failed`) continue to compile; only the `eval_commit_failed` emit site is updated to populate `error`.

## Implementation Plan

- **Task 1 — Path-resolution alignment.** In `src/phases/verify.ts:97-117`, replace the spawn argv path for `OUTPUT_FILE` with `resolveArtifact(state, state.artifacts.evalReport, cwd)`. Use the same absolute path for the in-process `hasSummary` / `isEvalReportValid` calls (delete the local `evalReportAbsPath` derivation). Keep the spawn `cwd` at `cwd` (outerCwd) so checks execute from the canonical task root.

- **Task 2 — Commit-step hardening (RC-1 + RC-2 + diagnostic).** In `src/artifact.ts`: (a) `commitEvalReport` returns `'skipped'` when `normalizeArtifactCommit` returns `false`; (b) `normalizeArtifactCommit`, in the "single-or-zero staged file" branch, guards `git add` with `existsSync(join(cwdAbs, filePath))` and returns `false` if the working-tree file is absent (the staged-deletion case). In `src/types.ts`, extend `phase_end.details` to `{ reason: string; error?: string }`. In `src/phases/runner.ts:1036-1043`, when `commitEvalReport` throws, include `error: (err as Error).message` in `details`.

- **Task 3 — Tests + run pnpm verification.** Add 3 regression tests: (a) `commitEvalReport` returns `'skipped'` when no commit was made; (b) `normalizeArtifactCommit` returns `false` (does not throw) on staged-deletion + missing-on-disk; (c) `runVerifyPhase` writes the eval report under `docsRoot` when `cwd !== docsRoot`. Run `pnpm tsc --noEmit`, `pnpm vitest run`, and `pnpm build` to confirm green.

## Eval Checklist Summary

Verification gates (full JSON in `.harness/2026-04-26-untitled-51cb/checklist.json`):

1. **Type check** — `pnpm tsc --noEmit` (catches type drift from extending `phase_end.details`)
2. **Test suite** — `pnpm vitest run` (regression tests + existing artifact/verify suites must remain green)
3. **Build** — `pnpm build` (`dist/` must compile cleanly + `scripts/copy-assets.mjs` runs)
4. **Path-fix grep** — `grep -nE "resolveArtifact\(state, state\.artifacts\.evalReport, cwd\)" src/phases/verify.ts` returns ≥1 match (confirms the path-resolution change landed where designed)
5. **Skipped-return grep** — `grep -nE "return 'skipped'" src/artifact.ts` returns ≥2 matches (gitignored branch + new no-commit branch)
