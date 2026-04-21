# Cross-Repo Phase-1/6 Regressions on 0.3.0 — Design Spec (Light)

> Cross-references
> - Task brief: `.harness/2026-04-21-untitled-662d/task.md`
> - Decision log (alternatives & trade-offs): `.harness/2026-04-21-untitled-662d/decisions.md`
> - Eval checklist: `.harness/2026-04-21-untitled-662d/checklist.json`
> - Prior related design: `docs/specs/2026-04-20-task-outer-cwd-n-sub-a808-design.md` (multi-worktree ADR set)

## Complexity

Small — three surgical fixes + focused tests, no schema migration, no prompt-template restructuring.

## Context & Decisions

### Observed failure (runId `2026-04-21-untitled-e777`, harness 0.3.0)

- Outer cwd = `/Users/daniel/.grove/missions/72e829dd/` (not a git repo). Two tracked sibling repos: `identity-gateway-backend`, `identity-gateway-dashboard`.
- `state.json` shows `trackedRepos[]` correctly populated (auto-detect + per-repo `baseCommit`). Mirror invariants intact.
- Phase 1 sentinel `phase-1.done` was written by Claude, **but** `phases["1"] = "failed"`.
- Spec file was placed at `<outer>/docs/specs/<runId>-design.md` — i.e. cwd-relative — instead of `<trackedRepos[0]>/docs/specs/...`.
- User-visible error: "not a git repository" — surfaced by Claude's own `git add docs/…` call in the outer (non-git) cwd per the Phase-1 wrapper-skill step 3.

### Root causes (two independent bugs; one caused the Phase-1 failure, one latent)

**RC-1 (Phase 1 failure).** `src/context/assembler.ts:assembleInteractivePrompt` injects prompt variables `{{spec_path}} {{plan_path}} {{checklist_path}} {{decisions_path}}` as the **relative** strings stored in `state.artifacts.*` (e.g. `docs/specs/<runId>-design.md`). Claude's tmux process is pinned to outer cwd (`src/runners/claude.ts:75`). When `outer !== trackedRepos[0].path`, Claude resolves the relative path against its own cwd and writes the file at the **wrong root**. `validatePhaseArtifacts` (interactive.ts:157) then looks at `resolveArtifact(...) = <trackedRepos[0]>/docs/specs/...`, the file is absent, and Phase 1 is marked failed. The visible "not a git repository" message comes from Claude's `git add` attempt in the non-git outer, per the wrapper-skill "필요 시 `git add` + `git commit`" instruction. The prior multi-worktree PR (#59) wired `resolveArtifact` into every **harness-side** consumer, but missed the prompt-variable injection site — the only place where the path is handed to the external agent.

**RC-2 (latent Phase 6 / resume crash).** `src/phases/verify.ts:97` calls `runPhase6Preconditions(evalReportPath, runId, cwd)` with the **outer** cwd. `runPhase6Preconditions` runs `git status --porcelain` at that cwd; in non-git outer this throws "not a git repository" before verification starts. Symmetric bug in `src/resume.ts`: line 191 (`join(cwd, state.artifacts.evalReport)`), 194 (`commitEvalReport(state, cwd)`), 196 (`getHead(cwd)`), 238, 244 — all use outer cwd instead of `docsRoot = state.trackedRepos[0].path`. Single-repo users haven't hit these because outer ≡ `trackedRepos[0]`.

### Decisions (rationale & alternatives in `decisions.md`)

- **D1.** Fix RC-1 by **resolving the four docs-anchored prompt variables to absolute paths** inside `assembleInteractivePrompt`. Rejected: (a) launching Claude with cwd = `trackedRepos[0]` (would break `.harness/<runId>/` anchoring and codex gate cwd assumption); (b) teaching Claude via prompt to prefix a docsRoot (brittle and already-fragile across skills).
- **D2.** Fix RC-2 by passing `docsRoot = state.trackedRepos?.[0]?.path || cwd` to `runPhase6Preconditions` and every cwd-stamped call in `resume.ts`'s Phase 6 recovery path. Rejected: making `runPhase6Preconditions` iterate all tracked repos — ADR-N8 explicitly scopes eval-report commit to `trackedRepos[0]`, and per-repo worktree cleanliness is checklist-author responsibility.
- **D3.** Drop the "필요 시 `git add` + `git commit`" line from the Phase-1/3/5 wrapper skills. `normalizeInteractiveArtifacts` (runner.ts:170) already auto-commits post-phase with the correct `docsRoot`. Removing the Claude-side step eliminates the noise error, is idempotent, and ADR-compliant.
- **D4.** Scope out `harness-verify.sh` multi-repo changes — ADR-N8 explicitly assigns per-repo command targeting to plan/checklist authors. The fix bundle does not touch `scripts/harness-verify.sh`.

## Requirements / Scope

### Functional

- **FR-1** After fix, `assembleInteractivePrompt` emits absolute paths for `{{spec_path}}`, `{{plan_path}}`, `{{checklist_path}}`, `{{decisions_path}}`. The absolute path is computed via `resolveArtifact(state, state.artifacts.*, cwd)` (which already anchors `docs/…` to `trackedRepos[0].path` and `.harness/…` to outer cwd).
- **FR-2** In single-repo (`trackedRepos.length === 1 && trackedRepos[0].path === cwd`), the emitted string may be absolute but must be byte-comparable to `path.join(cwd, relPath)`. No new template changes.
- **FR-3** `runPhase6Preconditions` is invoked with `docsRoot`, not outer cwd. `src/resume.ts` Phase-6 recovery uses `docsRoot` for `commitEvalReport`, `getHead`, and eval-report path joins.
- **FR-4** Phase-1/3/5 wrapper skills (`src/context/skills/harness-phase-{1,3,5}-*.md`) no longer instruct Claude to run `git add` / `git commit`. The final sentinel-write step is unchanged.
- **FR-5** Integration-style unit test: multi-repo fixture (`cwd` dir not git, two sub-repos as `trackedRepos`) asserts that the rendered Phase-1 prompt contains the **absolute path** of `docs/specs/<runId>-design.md` under `trackedRepos[0].path` and that `validatePhaseArtifacts` finds the spec when written at that absolute path.
- **FR-6** Unit test: `runPhase6Preconditions` called from `runVerifyPhase` receives a non-git outer cwd; test asserts it runs against `trackedRepos[0].path` instead (no "not a git repository" throw, precondition passes on clean docsRoot).

### Non-functional

- Regression gate: full `pnpm vitest run` green. Existing single-repo fixtures unchanged.
- Golden prompt fixture (N=1 single-repo): **byte-identical** after substitution — tests must explicitly verify this to avoid accidental wrapper drift.

### Out of scope

- `harness-verify.sh` multi-repo awareness (ADR-N8 stands).
- Any state-schema migration (trackedRepos schema is unchanged).
- Documentation rewrite — only sync HOW-IT-WORKS if user-observable behavior changes (it doesn't for single-repo; one-liner added for multi-repo path resolution).

## Design

### Change 1 — `src/context/assembler.ts` (RC-1)

Inside `assembleInteractivePrompt`, before the `vars` object is built, compute:

```
const absSpec      = resolveArtifact(state, state.artifacts.spec,        cwd);
const absPlan      = resolveArtifact(state, state.artifacts.plan,        cwd);
const absChecklist = resolveArtifact(state, state.artifacts.checklist,   cwd);
const absDecisions = resolveArtifact(state, state.artifacts.decisionLog, cwd);
```

Populate `vars` with those four absolute strings in place of the current relative reads. The signature of `assembleInteractivePrompt` already has `cwd` available via the `harnessDir` parameter path: since `harnessDir = <outer>/.harness`, `cwd` can be derived as `path.join(harnessDir, '..')` (same expression already used at line 580). Add `cwd` as an explicit parameter to keep intent clear and drop the repeated `path.join(harnessDir, '..')` derivations.

`task_path` stays as-is (`.harness/<runId>/task.md`) — it's already outer-anchored and Claude resolves it against cwd correctly.

### Change 2 — `src/phases/verify.ts:97` + `src/resume.ts` (RC-2)

`verify.ts:97` becomes:

```
const docsRoot = state.trackedRepos?.[0]?.path || cwd;
runPhase6Preconditions(state.artifacts.evalReport, state.runId, docsRoot);
```

Step 5 (the verify-script spawn) keeps `cwd: cwd` — the script intentionally runs at the outer anchor so plan-written `cd <repo>` prefixes work per ADR-N8.

`resume.ts` — replace the five cwd usages in the Phase-6 recovery/apply paths with `docsRoot`:

- L191: `join(docsRoot, state.artifacts.evalReport)`
- L194: `commitEvalReport(state, docsRoot)`
- L196: `getHead(docsRoot)`
- L238, L244 in `applyStoredVerifyResult`: same substitution.

Add `const docsRoot = state.trackedRepos?.[0]?.path || cwd;` at the top of each function that needs it (rather than a helper — only two call sites).

### Change 3 — Wrapper skills (D3)

Strip the "필요 시 `git add` + `git commit`" line (step 3 in phase 1, and the analogous steps in phase-3 and phase-5 wrappers). Renumber the remaining steps. No other wrapper edits. The light flow prompts (`src/context/prompts/phase-{1,5}-light.md`) already do not instruct Claude to run git — no change there.

### Control flow diagram (multi-repo, fixed)

```
outer cwd (non-git)
 └── .harness/<runId>/          ← sentinels, state, prompts
 └── docs/                      ← may exist but NOT used by harness
 └── trackedRepos[0]/ (git)
      └── docs/specs/…-design.md    ← spec lands here (absolute path in prompt)
      └── docs/plans/…
      └── docs/process/evals/…
 └── trackedRepos[1]/ (git)

prompt assembly: vars[spec_path] = trackedRepos[0]/docs/specs/…  (absolute)
Claude writes → correct file
validator reads via resolveArtifact → same absolute path → passes
```

## Implementation Plan

- **Task 1 — Prompt absolutization (RC-1, FR-1/2/5).** Add explicit `cwd` parameter to `assembleInteractivePrompt`; compute `absSpec/absPlan/absChecklist/absDecisions` via `resolveArtifact`; swap into `vars`. Update all call sites (`phases/interactive.ts`, any passing through `runInteractivePhase → assembleInteractivePrompt`) to forward `cwd`. Add a vitest fixture with non-git outer + two sub-repos that asserts (a) the rendered Phase-1 prompt contains the absolute docsRoot path, (b) single-repo fixture still renders with the same absolute (= `join(cwd, relPath)`) value.
- **Task 2 — Phase 6 docsRoot (RC-2, FR-3/6).** Change `verify.ts:97` to pass `docsRoot`. Replace the five `cwd` usages in `resume.ts` Phase-6 recovery with `docsRoot`. Add a vitest that drives `runVerifyPhase` with a non-git outer + single-repo docsRoot and asserts precondition succeeds (previously threw). Existing resume tests updated to cover the docsRoot branch (at least one new case where outer ≠ docsRoot).
- **Task 3 — Drop Claude-side git step + full-suite regression (D3, FR-4).** Strip the `git add`/`git commit` step from `src/context/skills/harness-phase-{1,3,5}-*.md`. Run `pnpm tsc --noEmit`, `pnpm vitest run`, `pnpm build` and confirm green. If a snapshot/golden fixture captures the wrapper-skill body, regenerate it and verify byte-delta matches only the removed step + renumber.

## Eval Checklist Summary

Three automated checks committed to `.harness/2026-04-21-untitled-662d/checklist.json`:

1. `lint` — `pnpm tsc --noEmit` (catches the assembler signature / param-forwarding change).
2. `test` — `pnpm vitest run` (covers the two new multi-repo tests + full regression).
3. `build` — `pnpm build` (ensures asset copy still produces the expected dist/ layout).

No Phase-6 checklist uses `cd <repo>` because this fix is being validated inside harness-cli itself (single-repo, cwd = worktree = git).
