# Spec — Phase-Harness Wall-Clock Timeout Removal

Status: Draft
Date: 2026-05-26
Branch: `timeout-removal`
Supersedes (partial): `docs/specs/2026-05-25-runner-observability-design.md` (the heartbeat/stall/warning portion)

Related plan: `docs/plans/2026-05-26-timeout-removal.md` (forthcoming)

## 1. Motivation

The harness currently kills phases that exceed a fixed wall-clock budget:

- **Gate phases (P2/P4/P7)** — `GATE_TIMEOUT_MS` = 6 min
- **Verify phase (P6)** — `VERIFY_TIMEOUT_MS` = 5 min
- **Interactive phases (P1/P3/P5)** — `INTERACTIVE_TIMEOUT_MS` = 30 min (override-able via `phase.<N>.timeoutMs`)

In practice, real implementation work (P5 in particular) regularly takes more than 30 min, and the cap turns legitimate long-running runs into **false failures**. That, in turn, jams the lifecycle: the harness flips to `failed`, the operator has to resume or jump, and the partial implementation in the pane is at best preserved by the sentinel race and at worst lost.

The operator already sees the live runner inside the tmux pane and can intervene manually (kill, switch model, write the sentinel by hand). The wall-clock kill no longer pays for the loss in flow correctness.

## 2. Goal

Remove every wall-clock timeout that can fail a phase. Use only **two** termination signals:

1. **PID death** — runner crashed or exited.
2. **Sentinel file** (`phase-<N>.done`) — runner declared completion via tool use.

Plus the existing **interrupt flag** (SIGUSR1 → skip/jump) which is operator-driven, not time-driven.

Anything that observes elapsed time and either fails the phase or kills the process group is in scope for removal.

## 3. Non-goals

- Changing PID-death or sentinel detection logic.
- Changing the `interrupt-<N>.flag` (SIGUSR1) plumbing.
- Changing `gate_verdict` / `gate_retry` / `gate_error` semantics aside from removing the `timedOut` category.
- Changing `phase_end` / `phase_start` payload shape (no removal of `claudeTokens`, `uncommittedRepos`, `preset`, etc.).
- Changing tmux pane capture or the `persistWorkspacePaneCapture` hook (#114 PR #3 stays).

## 4. What gets removed

### 4.1 Constants (`src/config.ts`)

Delete the following six exports plus their import sites:

| Symbol | Current value | Used by |
|---|---|---|
| `GATE_TIMEOUT_MS` | 360_000 | `runners/codex.ts`, `runners/claude.ts`, `phases/gate.ts`, `phases/runner.ts` |
| `VERIFY_TIMEOUT_MS` | 300_000 | `phases/verify.ts` |
| `INTERACTIVE_TIMEOUT_MS` | 1_800_000 | `userConfig.ts`, `commands/config.ts` |
| `HEARTBEAT_INTERVAL_MS` | 30_000 | `phases/interactive.ts` |
| `STALL_THRESHOLD_MS` | 300_000 | `phases/interactive.ts` |
| `TIMEOUT_WARNING_FRACTION` | 0.8 | `phases/interactive.ts` |

### 4.2 Runner-level timeouts

- `src/runners/codex.ts` — drop the `setTimeout` that kills the codex subprocess after `GATE_TIMEOUT_MS`, drop the `'timeout'` member of `RawCategory`, drop the `timedOut: true` resolve branch, drop the `Codex gate timed out after …ms` error message.
- `src/runners/claude.ts` — drop the equivalent `setTimeout` + `Claude gate timed out after …ms` error path in the Claude gate runner.

After this change, a gate runner ends in exactly one of: `success_verdict`, `success_no_verdict`, `spawn_error`, `nonzero_exit_other`, `session_missing`.

### 4.3 Verify timeout (`src/phases/verify.ts`)

Drop the `setTimeout` + `killProcessGroup` + `writeVerifyResult(runDir, 1, false)` branch that turns elapsed time into a synthetic exit. Verify ends only when the subprocess closes.

### 4.4 Interactive `waitForPhaseCompletion` (`src/phases/interactive.ts`)

Remove:

- The `timeoutMs?: number` parameter (and its forwarded callers in `runInteractivePhase`).
- The `absTimeout` block that emits `phase ${phase} timed out after …s waiting for sentinel` and `settle('failed')`.
- The `nullPidTimeout` block (10 min fallback when `claudePid === null`).
- The entire heartbeat loop: `HEARTBEAT_INTERVAL_MS` interval, `runner_heartbeat` emission, `STALL_THRESHOLD_MS` stall detection, `TIMEOUT_WARNING_FRACTION` warning emission.
- The `WaitForPhaseCompletionOptions.getOutputBytes` callback (only consumer was the heartbeat loop).
- The `phaseStartTs` / `lastOutputBytes` / `lastProgressTs` / `stallEmittedAt` / `warningEmitted` locals.

`WaitForPhaseCompletionOptions.logger` may stay as a typed slot if other consumers want it; the heartbeat loop was its only producer. If no other producer remains, remove the type alongside the parameter.

The resolver `getEffectiveInteractiveTimeoutMs` and the call site inside `runInteractivePhase` go away.

### 4.5 User config (`src/userConfig.ts` + `src/commands/config.ts`)

- Drop the `timeoutMs?: number` field from `PhaseUserConfig`.
- Drop `ConfigFieldName = 'preset' | 'timeoutMs'` → narrow to `'preset'`.
- Drop `TIMEOUT_CONFIGURABLE_PHASES`.
- Drop the `phase.<X>.timeoutMs` branch in the key parser.
- Drop `getEffectiveInteractiveTimeoutMs`.
- Update the "unknown config key" error string so it only lists `phase.<1|2|3|4|5|7>.preset`.
- In `commands/config.ts`, drop the `timeoutMs` branch in `config get`, `config set`, and `config list`; if a saved settings file still contains `timeoutMs`, the loader silently ignores it (no migration script).

### 4.6 LogEvent types (`src/types.ts`)

Delete the three variants added in PR #114 PR #1:

- `runner_heartbeat`
- `runner_stalled`
- `phase_timeout_warning`

These have no other producers after §4.4.

### 4.7 Retrospective (`src/phases/retrospective.ts`)

- Drop the `runnerAnomalies` field from `RetrospectiveStats`.
- Drop the per-event accumulators for `runner_stalled` / `phase_timeout_warning`.
- Drop the `## Runner Anomalies` markdown section. The "## Escalations" section continues to render unchanged.

### 4.8 Tests

Update or delete tests that reference removed symbols:

- `tests/phases/interactive.test.ts` — drop heartbeat / stall / warning / absolute-timeout cases, drop `runInteractivePhase — per-phase timeout override (#116 B4)` block.
- `tests/phases/retrospective.test.ts` — drop runner-anomalies markdown + stats assertions.
- `tests/runners/codex-resume.test.ts` — drop `timedOut` raw-category cases.
- `tests/logger.test.ts` — drop event-shape tests for the three removed variants.
- `tests/userConfig.test.ts` — drop `timeoutMs` parser / validator cases.
- `tests/commands/config.test.ts` — drop `timeoutMs` CLI cases.

All remaining tests must continue to pass.

### 4.9 Documentation

- `README.md` / `README.ko.md` — strip any mention of `phase.<N>.timeoutMs`, runner heartbeat / stall warnings, and the "phase will fail after N minutes" framing.
- `docs/HOW-IT-WORKS.md` / `docs/HOW-IT-WORKS.ko.md` — replace the timeout subsection with a short note that phases end on PID death or sentinel only.
- `docs/specs/2026-05-25-runner-observability-design.md` — add a top-of-file `Status: superseded by docs/specs/2026-05-26-timeout-removal-design.md` line. Do not edit the body.
- `CLAUDE.md` — confirm no stale timeout references remain in the "검증 커맨드" / "이벤트 로깅 스키마" section; if `runner_heartbeat` / `runner_stalled` / `phase_timeout_warning` are referenced, remove those rows.

## 5. What stays

Kept verbatim:

- `chokidar` sentinel watcher + 500 ms sentinel polling fallback.
- PID-death polling at 1 s, with one last `checkSentinelFreshness` check on death.
- Interrupt-flag polling at 500 ms, with the 3 s SIGUSR1 grace window.
- `SIGTERM_WAIT_MS` (used by process-group teardown when the harness itself shuts down) — that's exit cleanup, not a phase-failure timer.
- `GROUP_DRAIN_WAIT_MS`, `HANDOFF_TIMEOUT_MS`, the various `pollForXxx(timeoutMs)` helpers in `lock.ts` / `tmux.ts` / `process.ts` — these are bounded utility polls invoked explicitly by callers, not "kill the phase after N minutes" budgets.
- `persistWorkspacePaneCapture` (#114 PR #3).
- `phase_end.claudeTokens`, `phase_end.uncommittedRepos`, `gate_verdict.preset`, `terminal_action.source`, etc. — all unrelated to timeout.

## 6. Risk analysis (accepted)

1. **Hanging gate.** If Codex CLI or Claude TUI emits a verdict but stays in REPL mode and never writes the sentinel (the original symptom that drove issue #107), the harness will now wait forever. Mitigation: operator can `quit`, `skip`, or `jump` from the control panel; or write `phase-<N>.done` by hand inside the pane.
2. **Hanging verify.** The verify shell script (`scripts/harness-verify.sh`) doesn't normally hang, but if a checklist invokes a runaway build it will block until the operator kills it. Mitigation: same control-panel actions.
3. **No observability of "phase is taking abnormally long."** The supervisor skill (`phase-harness-supervisor`) loses its `runner_stalled` signal. Operators rely on the tmux pane and on `events.jsonl` cadence (other events keep flowing). The supervisor skill itself is unchanged by this spec — its detection becomes coarser, by design.
4. **#116 B4 reversal.** Users who set `phase.<N>.timeoutMs` will find the field rejected as an unknown config key after upgrade. We do not write a migration; the field simply becomes a no-op warning. This is acceptable because the feature is one PR old.

## 7. Architecture diagram (after)

```
runInteractivePhase
  ├─ spawn runner in tmux pane (claude | codex)
  ├─ waitForPhaseCompletion (no timeoutMs)
  │     ├─ chokidar watcher on phase-N.done   ─┐
  │     ├─ 500 ms sentinel poll               ─┤  fresh sentinel → validate artifacts → completed | failed
  │     ├─ 1 s PID-death poll                 ─┤  death → last sentinel check → completed | failed
  │     └─ 500 ms interrupt-flag poll         ─┘  SIGUSR1 → settle 'failed' after 3 s grace
  └─ persistWorkspacePaneCapture

runGatePhase (codex|claude runner)
  ├─ spawn runner
  ├─ wait for child.close (no timer)
  └─ classify (success_verdict | success_no_verdict | spawn_error | nonzero_exit_other | session_missing)

runVerifyPhase
  ├─ spawn scripts/harness-verify.sh
  └─ wait for child.close (no timer)
```

## 8. Validation

The implementation is verified by:

1. `pnpm tsc --noEmit` — clean.
2. `pnpm vitest run` — all tests pass after updates per §4.8.
3. `pnpm build` — clean, no broken imports.
4. Manual smoke (via dogfooded `phase-harness run --light` on a trivial task) — phases advance on sentinel, control-panel `quit` aborts cleanly.

## 9. Out-of-scope future work

- Re-introducing an opt-in "soft warn after N min" signal that does NOT kill the phase.
- A configurable "max session wall-clock" guard for entire runs (not per phase) if abuse / cost is a concern.

Neither is part of this change.
