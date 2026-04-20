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

- **D1 — Uniform random suffix.** Every runId gets a 4-hex token: `YYYY-MM-DD-<slug>-<rrrr>`. Applies uniformly (not only to `untitled`) to eliminate the dedup ladder and narrow race windows. 4 hex ≈ 65k — essentially zero daily-collision probability. Numeric `-N` dedup loop is kept only as an extra belt-and-suspenders fallback if filesystem shows the exact random-suffixed path already exists.
- **D2 — `cleanup` command + opportunistic sweep on `start`.** A new `phase-harness cleanup` command enumerates `harness-*` tmux sessions and, scoped to the current `harnessDir`, classifies each as orphan vs active based on whether a matching run directory + active lock exists. `start` calls the same logic before creating a new session (quiet-mode, kill-only). Scoping to current harnessDir prevents cross-repo false positives.
- **D3 — Orphan detection heuristic.** A `harness-<runId>` tmux session is classified as orphan when **either** (a) `.harness/<runId>/` does not exist in the current harnessDir, **or** (b) `.harness/<runId>/run.lock` is absent, **or** (c) `repo.lock` liveness is `stale` (reuses existing `assessLiveness` / `checkLockStatus`) AND the stored `lock.runId` matches that session. Sessions unrelated to the current harnessDir (their runId dir lives elsewhere) are reported as "unknown — skipped" rather than killed.
- **D4 — Random token encoding.** 4 hex chars from `crypto.randomBytes(2).toString('hex')`. Kept hex (not base36) to preserve the slug character class `[a-z0-9-]` already assumed throughout the codebase (e.g. tmux session names, path joins). No userland-visible change in character set.
- **D5 — Backward compatibility.** Existing runs under `.harness/` keep their current runIds (no migration needed — runIds are opaque strings downstream). `generateRunId` signature unchanged. `list` / `resume` / `status` continue to read any runId format. Only the generator shape changes; tests are updated accordingly.

## Requirements / Scope

In scope:
1. `generateRunId` always appends a 4-hex random token. Existing dedup loop preserved as fallback only.
2. New module `src/orphan-cleanup.ts` (or a function inside `src/tmux.ts`) exposing: `listHarnessSessions()`, `classifyOrphans(harnessDir, sessions)`, `cleanupOrphans(harnessDir, { dryRun?, yes? })`.
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
- `classifyOrphans(harnessDir, sessions)`: for each runId, attempts to read `.harness/<runId>/run.lock` and `.harness/repo.lock`. Returns `{ runId, sessionName, status: 'active' | 'orphan' | 'unknown', reason }`.
  - `active`: run.lock present AND repo.lock liveness === 'active' AND `lock.runId === runId`.
  - `orphan`: run dir missing, run.lock missing, or liveness === 'stale'.
  - `unknown`: run dir missing entirely (could be another repo's session) — reported but **not** killed by default.
- `cleanupOrphans(harnessDir, opts)`:
  - Prints a formatted table (sessionName / runId / status / reason).
  - In interactive mode, prompts `[y/N]` for the orphan set. `--yes` bypasses.
  - For each `orphan`, calls `killSession(sessionName)` (already exists in `src/tmux.ts`). Silently continues on errors.
  - Does **not** touch `unknown` unless a future flag (e.g. `--aggressive`) is added — deliberately omitted for this iteration.
- Opportunistic sweep in `startCommand`: calls `cleanupOrphans(harnessDir, { quiet: true, yes: true, scope: 'current-dir-only' })` after `runPreflight` and before `generateRunId`. Failure here is logged as a warning but never aborts `start`.

### CLI wiring (`bin/harness.ts`)

New subcommand:
```
phase-harness cleanup [--dry-run] [--yes]
```
- `--dry-run`: classify and print, no kills.
- `--yes`: skip confirmation.

### Tests

- `tests/git.test.ts`: update existing `generateRunId` expectations to match `^YYYY-MM-DD-<slug>-[0-9a-f]{4}$`. Assert distinctness across ~100 consecutive calls with the same input.
- `tests/orphan-cleanup.test.ts` (new): mock `execSync` for `tmux ls`, build fixture `.harness/` dirs, assert classification and `killSession` side effects. Use fake tmux output + real temp harnessDir.
- No integration-level changes required (lifecycle/light-flow tests operate on supplied runIds).

### Docs

- `README.md` / `README.ko.md`: add `cleanup` to commands table; note new runId shape in a one-line remark.
- `docs/HOW-IT-WORKS.md` / `.ko.md`: update the "session lifecycle" section with (a) runId shape `YYYY-MM-DD-<slug>-<rand4>`, (b) orphan-session handling + `cleanup` command, (c) note the start-time opportunistic sweep.

## Implementation Plan

1. **Task 1 — Randomized runId.** Update `generateRunId` in `src/git.ts` to append a 4-hex random token; keep dedup-counter fallback. Update `tests/git.test.ts` regex expectations and add a distinctness test. Verify `pnpm tsc --noEmit` and `pnpm vitest run`.

2. **Task 2 — Orphan cleanup module + CLI command.** Add `src/orphan-cleanup.ts` with `listHarnessSessions`, `classifyOrphans`, `cleanupOrphans`. Register `phase-harness cleanup [--dry-run] [--yes]` in `bin/harness.ts` → `src/commands/cleanup.ts`. Add `tests/orphan-cleanup.test.ts` covering active / orphan / unknown classification and `--dry-run` no-op.

3. **Task 3 — Opportunistic sweep in `start` + docs sync.** Call `cleanupOrphans` (quiet + yes) from `startCommand` before `generateRunId`. Update `README.md`, `README.ko.md`, `docs/HOW-IT-WORKS.md`, `docs/HOW-IT-WORKS.ko.md` to mention the new runId shape and `cleanup` command. Re-run `pnpm tsc --noEmit`, `pnpm vitest run`, `pnpm build`.

## Eval Checklist Summary

- `pnpm tsc --noEmit` — typecheck clean
- `pnpm vitest run` — full test suite green (including new runId + orphan-cleanup tests)
- `pnpm build` — dist rebuild succeeds (so the new `cleanup` subcommand ships in published bundle)

See `.harness/2026-04-20-untitled/checklist.json` for the executable form.
