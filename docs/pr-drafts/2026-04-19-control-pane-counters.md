# PR body draft — Control-pane running elapsed / token counters (P2.1)

**Branch:** `feat/control-pane-counters` → `main`
**Spec:** `docs/specs/2026-04-19-control-pane-counters-design.md` (spec-gate APPROVE round 3)
**Plan:** `docs/plans/2026-04-19-control-pane-counters.md` (plan-gate APPROVE round 3)
**FOLLOWUPS carry-forward:** `FOLLOWUPS.md` → new `P3.1` (gate_error.tokensTotal
reconciliation; issue TBD — open post-merge)

## Summary

Adds a live bottom-row footer to the control pane that surfaces the current
phase attempt, phase-running elapsed time, session elapsed time, and
cumulative token usage by tailing `events.jsonl` + `state.json` at 1 Hz. No
logging-schema changes. Logging-off users see nothing change (ticker is
inert when `logger.getEventsPath()` returns `null`). Runs an absolute
bottom-row ANSI update (`\x1b[s\x1b[rows;1H\x1b[2K...\x1b[u` to stderr) so
the overlay never clobbers `printInfo`/`printWarning`/gate prompts.

## Why

On the 2026-04-18 dogfood-full run a user spent 60 min / 9 M tokens before
noticing drift. Control pane showed only phase ticks. FOLLOWUPS L100–103
(P2.1) prescribed a footer of the form
`P5 attempt 1 · 23m elapsed · 9.1M tokens so far`.

## What changed — by Task

| Task | Commit | Summary |
|---|---|---|
| 1 | `0b266e4` | `SessionLogger.getEventsPath(): string \| null` added. `NoopLogger` → `null`; `FileSessionLogger` → cached `eventsPath`. 2 new tests. |
| 2 | `dc10aba` | `src/metrics/footer-aggregator.ts` — pure `readEventsJsonl` / `readStateSlice` / `aggregateFooter`. Full `PhaseStatus` union reused (TODO-G2-P2a). `currentPhase` outside `1..7` → `null` (TERMINAL_PHASE=8 guard, TODO-G2-P2b). Sidecar replay dedup mirrors `finalizeSummary`. 11 new tests. |
| 3 | `393cd7a` | `src/ui.ts` — `formatFooter` (wide/compact/phase-6), `writeFooterToPane`, `clearFooterRow`, all stderr. Phase-6 variant proven by exact string match with `totalTokens > 0` (no token segment by phase rule, not by zero). 9 new tests. |
| 4 | `192c18c` | `src/commands/footer-ticker.ts` — 1 Hz polling, inert `NoopLogger` path (no interval, no `exit` listener), 4× §3.12 silent-skip branches, idempotent `stop()`, `process.on('exit')` cleanup, synchronous `forceTick()`. 10 new tests. |
| 5 | `6026d5b` | `src/commands/inner.ts` — ticker started after `enterPhaseLoop()`, SIGWINCH wired to `forceTick`, try/finally teardown (stop → SIGWINCH remove → existing logger shutdown). 2 new integration tests (mocked ticker + `runPhaseLoop`). |
| 6 | `f99fb59` | `FOLLOWUPS.md` — new `P3.1` entry: `summary.json.totals.gateTokens` does not include `gate_error.tokensTotal`; reconciling `finalizeSummary` needs its own PR. No `logger.ts` change in this PR. |
| Final | _this commit_ | Full-suite verification + this PR-body draft. |

## Verification

```text
pnpm tsc --noEmit          # exit 0
pnpm vitest run            # 652 passed | 1 skipped (48 test files)
pnpm build                 # tsc + copy-assets OK; dist regenerated
```

Baseline (before Task 1): `618 passed / 1 skipped`. Delta: **+34 tests**
(2 + 11 + 9 + 10 + 2, matching the per-Task counts above).

## Simplifications

- `SessionLogger.getEventsPath()` getter instead of recomputing
  `~/.harness/sessions/<repoKey>/<runId>/events.jsonl` in the ticker.
- Aggregator is pure — I/O boundaries live in `readEventsJsonl` /
  `readStateSlice` so unit tests pass fixtures directly.
- Ticker is inert (no timer, no listener) when logging is off — keeps
  hot-path zero-cost on non-logged runs.

## Remaining risks (from spec, still applicable)

1. **Scrollback overwrite window** (§3.1) — if a `printInfo` burst scrolls
   past the footer row it may briefly be overwritten until the next tick
   (< 1 s).
2. **SIGKILL out of scope** (§3.14) — `process.on('exit')` handles
   SIGINT/SIGTERM/uncaught paths but not SIGKILL; terminal may be left
   with a stale footer row on hard-kill.
3. **Intentional divergence** from `summary.json.totals.gateTokens` on
   `gate_error.tokensTotal` (§3.6.1); tracked via FOLLOWUPS P3.1.

## Manual smoke — pending human execution

Spec §4.5 case 7 requires a real tmux session, which cannot be driven
from the harness sandbox. Before merging, please run:

```bash
harness run --enable-logging "demo"
```

and verify:

- Footer updates every ~1 s during an interactive phase.
- Footer stays on the live gate phase during phase 2/4/7 (does not freeze
  on the last interactive `phase_start`).
- Terminal resize triggers immediate repaint (< 1 s) via SIGWINCH.
- `SIGINT` (Ctrl-C) clears the footer row before the process exits.

## Follow-up tracking

- `FOLLOWUPS.md` P3.1 was created with `issue number TBD`. Once this PR
  merges, please open a GitHub issue for the
  `finalizeSummary.gate_error.tokensTotal` reconciliation and back-fill
  the concrete number in both FOLLOWUPS.md and, if helpful, a
  cross-reference comment on this PR.

## Gate history

- Spec-gate: round 1 REJECT (1 P0 + 1 P1 + 2 P2) → round 2 REJECT (1 P1
  + 2 P2) → round 3 **APPROVE** (1 P2 + 1 P3, both recorded as §8
  deferred TODOs and folded into the plan).
- Plan-gate: round 1 REJECT (3 P1 + 1 P2; 1 of the 3 P1s — "AGENTS.md
  Lore protocol" — was invalid, no such file exists, rebutted and
  accepted) → round 2 REJECT (1 P1 + 1 P2, both closed in-plan) →
  round 3 **APPROVE** (2 P2 + 1 P3, all applied as plan polish before
  implementation kickoff).
- Implementation: executed Task 1–6 + Final. Tasks 1–5 implemented by
  codex gpt-5.4 high (`--effort high --write`) per user directive; Task
  6 (docs-only) and the Final Task written inline by the orchestrator.
