# runId Uniqueness + Orphan tmux Cleanup — Design Spec (Light)

Related:
- Task: `.harness/2026-04-20-untitled/task.md`
- Decisions: `.harness/2026-04-20-untitled/decisions.md`
- Checklist: `.harness/2026-04-20-untitled/checklist.json`

## Complexity
Small — Two narrow, orthogonal concerns touching a single generator + one new command + an opportunistic sweep call-site.

## Context & Decisions

The user nearly always starts sessions with no task argument (`phase-harness start`) and types the prompt in the control panel. With an empty task, `generateRunId` (`src/git.ts:107`) falls back to `YYYY-MM-DD-untitled`, deduping via `-2`, `-3`… Over days this produces confusing ladders (`untitled-7`, `untitled-8`) and — because `generateRunId` only checks directory existence, not concurrent-process reservation — is race-prone on rapid successive starts.

Separately, when a harness session exits abnormally (window closed, kill -9, SIGHUP on terminal close), the `harness-<runId>` tmux session is left running in the background because cleanup runs inside the inner process's normal shutdown path. These orphans pile up and waste resources; `tmux ls` shows them but the user has no first-class way to correlate/reap them.

Key decisions:

- **D1 — Uniform random suffix.** Every runId gets a 4-hex token: `YYYY-MM-DD-<slug>-<rrrr>`. Applies uniformly (not only to `untitled`) to eliminate the dedup ladder and narrow race windows. 4 hex ≈ 65k values; at realistic daily session volumes (<100) the birthday collision rate is ~7.5% for 100 draws, so collision **is possible but rare** — the code handles it via redraw + counter fallback (see Design §runId generator). The 4-hex width is deliberately chosen over larger entropy to keep runIds short and human-readable; the fallback path is the correctness guarantee, not the entropy alone. Tests therefore verify the fallback behavior deterministically (mocked `crypto.randomBytes`), **not** by asserting distinctness across many real draws.
- **D2 — `cleanup` command + opportunistic sweep on `start`.** A new `phase-harness cleanup` command enumerates `harness-*` tmux sessions and, scoped to the current `harnessDir`, classifies each as `active` / `orphan` / `unknown` based on local `.harness/<runId>/` metadata. `start` calls the same function with `{ quiet: true, yes: true }` before creating a new session. Scoping to the current harnessDir prevents cross-repo false positives.
- **D3 — Orphan detection rule (deterministic, local-metadata-proven).** A `harness-<runId>` tmux session is classified strictly by whether local metadata in the **current** `harnessDir` proves ownership:
  - **`unknown` (always skipped — never killed).** `.harness/<runId>/` does not exist under the current `harnessDir`. The session may belong to another repo/worktree; we cannot prove it is ours, so we report and leave it alone. This is the single source of the `unknown` classification — the earlier wording that also listed "run dir missing" under `orphan` is removed.
  - **`active` (never killed).** `.harness/<runId>/` exists AND `.harness/<runId>/run.lock` exists AND `checkLockStatus(harnessDir)` returns `active` AND `lock.runId === runId`.
  - **`orphan` (killed).** `.harness/<runId>/` exists AND **one of**:
    - (i) `run.lock` is missing, OR
    - (ii) `repo.lock` is missing, OR
    - (iii) `repo.lock` liveness is `stale` (regardless of which runId it stores), OR
    - (iv) `repo.lock` liveness is `active` but `lock.runId !== runId` — this tmux session is a leftover from a prior run in the same harnessDir; the currently-active run is a different one, so the session is provably abandoned.
  This closes the previously-undefined case where `run.lock` exists locally but `repo.lock` is absent or points to a different runId.
- **D4 — Random token encoding.** 4 hex chars from `crypto.randomBytes(2).toString('hex')`. Kept hex (not base36) to preserve the slug character class `[a-z0-9-]` already assumed throughout the codebase (e.g. tmux session names, path joins). No userland-visible change in character set.
- **D5 — Backward compatibility.** Existing runs under `.harness/` keep their current runIds (no migration needed — runIds are opaque strings downstream). `generateRunId` signature unchanged. `list` / `resume` / `status` continue to read any runId format. Only the generator shape changes; tests are updated accordingly.

## Requirements / Scope

In scope:
1. `generateRunId` always appends a 4-hex random token. Existing dedup loop preserved as fallback only.
2. New module `src/orphan-cleanup.ts` (or a function inside `src/tmux.ts`) exposing: `listHarnessSessions()`, `classifyOrphans(harnessDir, sessions)`, `cleanupOrphans(harnessDir, { dryRun?, yes?, quiet? })`. The same function serves both the explicit `cleanup` command and the start-time sweep — no separate helper. Scoping is implicit and fixed at current-`harnessDir`-only (see D3).
3. New CLI: `phase-harness cleanup [--dry-run] [--yes]` that prints a classification table and kills confirmed orphans (interactive by default; `--yes` skips prompt).
4. `startCommand` invokes the cleanup logic in quiet/auto mode before creating a new tmux session, scoped to current `harnessDir`.
5. Unit tests: updated `generateRunId` tests (accept random suffix), new tests for orphan classification (mock `tmux ls` + filesystem state).
6. Docs sync: `README.md`, `README.ko.md`, `docs/HOW-IT-WORKS.md`, `docs/HOW-IT-WORKS.ko.md` — mention new runId shape + `cleanup` command.

Out of scope:
- Cross-repo orphan detection (deliberately excluded — too error-prone without a global session registry).
- Migrating old `.harness/<old-runId>/` directories (opaque strings, no need).
- Changes to tmux session naming scheme beyond what suffix implies.
- Reaping inner-process PIDs: we only kill tmux sessions. If a detached runner process somehow outlives its tmux session, it stays alive — acceptable per "best-effort cleanup" policy.

## Design

### runId generator change (`src/git.ts`)

`generateRunId(task, harnessDir)` builds the existing `base = YYYY-MM-DD-<slug>` then appends `-<rrrr>` where `rrrr` is `crypto.randomBytes(2).toString('hex')`. If that exact path already exists (vanishingly rare), re-draw up to 5 times, then fall back to the legacy `-N` counter against the randomized base to guarantee termination.

### Orphan cleanup

- `listHarnessSessions()`: runs `tmux ls -F '#{session_name}'`, filters by `^harness-.+$`, returns the trailing runId for each.
- `classifyOrphans(harnessDir, sessions)`: for each runId, probes `.harness/<runId>/` (existence), `.harness/<runId>/run.lock` (existence), and `checkLockStatus(harnessDir)` (liveness + stored runId). Returns `{ runId, sessionName, status: 'active' | 'orphan' | 'unknown', reason }` per the deterministic rule in D3. **Single source of `unknown`**: run dir missing under current `harnessDir`. **`orphan` sub-reasons** (for the printed table): `no-run-lock`, `no-repo-lock`, `repo-lock-stale`, `repo-lock-different-run`.
- `cleanupOrphans(harnessDir, opts)` — one function used by both the `cleanup` command and the start-time sweep. Options:
  - `dryRun?: boolean` — classify + print, no kills.
  - `yes?: boolean` — skip the interactive `[y/N]` prompt.
  - `quiet?: boolean` — suppress the classification table and "nothing to clean" messages; errors still go to stderr. Used by the start-time sweep.
  Behavior:
  - Builds the classification table. Unless `quiet`, prints it (sessionName / runId / status / reason).
  - In interactive mode (no `yes`, no `dryRun`), prompts `[y/N]` for the orphan set.
  - For each `orphan`, calls `killSession(sessionName)` (from `src/tmux.ts`). Silently continues on per-session errors.
  - Does **not** touch `unknown` — no flag in this iteration. Even aggressive cleanup would require cross-repo registry data not yet modeled.
- Opportunistic sweep in `startCommand`: calls `cleanupOrphans(harnessDir, { quiet: true, yes: true })` after `runPreflight` and before `generateRunId`. No `scope` parameter exists; scoping is built into `classifyOrphans`. Failure here is logged as a warning but never aborts `start`.

### CLI wiring (`bin/harness.ts`)

New subcommand:
```
phase-harness cleanup [--dry-run] [--yes]
```
- `--dry-run`: classify and print, no kills.
- `--yes`: skip confirmation.

### Tests

- `tests/git.test.ts`: update existing `generateRunId` expectations to match `^YYYY-MM-DD-<slug>-[0-9a-f]{4}$`. **Deterministic** suffix tests (no probabilistic distinctness assertion):
  - **Format test** — call `generateRunId` once with a real `crypto.randomBytes` and assert the regex.
  - **Redraw-on-collision test** — use `vi.spyOn(crypto, 'randomBytes')` to return `0xAAAA` on the first call and `0xBBBB` on the second; pre-create `.harness/<date>-<slug>-aaaa/`; assert the returned runId ends with `-bbbb`.
  - **Fallback counter test** — make the spy return the same value (e.g. `0xCAFE`) on every call; pre-create `.harness/<date>-<slug>-cafe/`; assert the returned runId is `<date>-<slug>-cafe-2` (legacy `-N` fallback), proving termination even when random space is exhausted.
- `tests/orphan-cleanup.test.ts` (new): mock `execSync` for `tmux ls`, build fixture `.harness/` dirs, assert classification and `killSession` side effects. Use fake tmux output + real temp harnessDir.
- No integration-level changes required (lifecycle/light-flow tests operate on supplied runIds).

### Docs

- `README.md` / `README.ko.md`: add `cleanup` to commands table; note new runId shape in a one-line remark.
- `docs/HOW-IT-WORKS.md` / `.ko.md`: update the "session lifecycle" section with (a) runId shape `YYYY-MM-DD-<slug>-<rand4>`, (b) orphan-session handling + `cleanup` command, (c) note the start-time opportunistic sweep.

## Implementation Plan

1. **Task 1 — Randomized runId.** Update `generateRunId` in `src/git.ts` to append a 4-hex random token from `crypto.randomBytes(2)`; retain the legacy `-N` counter as the terminating fallback. Update `tests/git.test.ts` regex expectations and add the three **deterministic** tests (format / redraw-on-collision / fallback counter) described in Design §Tests — no probabilistic distinctness assertion. Verify `pnpm tsc --noEmit` and `pnpm vitest run`.

2. **Task 2 — Orphan cleanup module + CLI command.** Add `src/orphan-cleanup.ts` with `listHarnessSessions`, `classifyOrphans`, `cleanupOrphans`. Register `phase-harness cleanup [--dry-run] [--yes]` in `bin/harness.ts` → `src/commands/cleanup.ts`. Add `tests/orphan-cleanup.test.ts` covering active / orphan / unknown classification and `--dry-run` no-op.

3. **Task 3 — Opportunistic sweep in `start` + docs sync.** Call `cleanupOrphans` (quiet + yes) from `startCommand` before `generateRunId`. Update `README.md`, `README.ko.md`, `docs/HOW-IT-WORKS.md`, `docs/HOW-IT-WORKS.ko.md` to mention the new runId shape and `cleanup` command. Re-run `pnpm tsc --noEmit`, `pnpm vitest run`, `pnpm build`.

## Eval Checklist Summary

- `pnpm tsc --noEmit` — typecheck clean
- `pnpm vitest run` — full test suite green (including new runId + orphan-cleanup tests)
- `pnpm build` — dist rebuild succeeds (so the new `cleanup` subcommand ships in published bundle)

See `.harness/2026-04-20-untitled/checklist.json` for the executable form.
