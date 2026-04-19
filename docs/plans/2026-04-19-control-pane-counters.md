# Control-pane running elapsed / token counters Implementation Plan

> **For implementers:** keep `docs/specs/2026-04-19-control-pane-counters-design.md` open while executing this plan. Stay inside the approved scope: footer aggregation/rendering/ticker wiring plus the explicit `FOLLOWUPS.md` carry-forward in Task 6. Each code task writes a failing test first, proves the failure, implements the spec section named in the task, runs the scoped suite to green, and ends with a conventional commit.

**Spec:** `docs/specs/2026-04-19-control-pane-counters-design.md`

**Goal:** add a live control-pane footer that shows phase attempt, running elapsed time, session elapsed time, and cumulative token usage by tailing `events.jsonl` and `state.json` without changing the logging schema.

**Architecture:** a pure aggregator module (`src/metrics/footer-aggregator.ts`) reads `events.jsonl` + a narrow `FooterStateSlice` from `state.json`; `src/ui.ts` formats and writes the footer to the bottom stderr row; `src/commands/footer-ticker.ts` polls once per second and owns abnormal-exit cleanup; `src/commands/inner.ts` wires the ticker around `runPhaseLoop`. The logger change is intentionally limited to exposing `events.jsonl` via `SessionLogger.getEventsPath()`; `finalizeSummary` stays unchanged in this PR per spec §3.6.1 and §8 TODO-G2-P1.

**Tech Stack:** TypeScript (strict), vitest, pnpm, existing session logger/events schema in `src/types.ts` + `src/logger.ts`, state persistence in `src/state.ts`, control-pane rendering in `src/ui.ts`, and phase-loop lifecycle in `src/phases/runner.ts`.

**Scope note:** this plan follows the structure of `docs/plans/2026-04-18-gate-prompt-hardening.md`: header, file map, Task 0 baseline, one task per file-group, commit cadence per task, and a final full-suite/manual verification task. It also carries forward every deferred §8 TODO as an explicit task/step with the decision direction already approved in the spec.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/types.ts` | Modify | Extend `SessionLogger` at `src/types.ts:261-269` with `getEventsPath(): string \| null` per spec §3.4 / §4.3. The footer work reuses the existing `PhaseStatus` definition at `src/types.ts:4` as-is; only `getEventsPath` is added here. |
| `src/logger.ts` | Modify | Implement `getEventsPath()` on `NoopLogger` (`src/logger.ts:11-20`) and `FileSessionLogger` (`src/logger.ts:31-76`) without changing `finalizeSummary` token behavior at `src/logger.ts:156-220`. |
| `tests/logger.test.ts` | Modify | Add unit assertions next to `NoopLogger` tests (`tests/logger.test.ts:31-53`) and `FileSessionLogger` constructor/meta tests (`tests/logger.test.ts:55-138`) for the new getter described in spec §4.5(4). |
| `src/metrics/footer-aggregator.ts` | New | Implement `FooterStateSlice`, `FooterSummary`, `readEventsJsonl`, `readStateSlice`, and `aggregateFooter(events, stateSlice, now)` exactly as specified in spec §4.1, §3.3, §3.6, §3.6.1, §3.7, §3.9, and §8 TODO-G2-P2a/P2b, reusing `PhaseStatus` from `src/types.ts:4` instead of redefining the union locally. |
| `tests/metrics/footer-aggregator.test.ts` | New | Cover the pure aggregator matrix from spec §4.5(1)-(2): gate-live, interactive-live, interactive-idle, phase-6 pairing, resume semantics, sidecar dedup, token-skip cases, empty/no-session-open, valid/missing/malformed/race state reads, `phaseStatus`, and `currentPhase === 8`. |
| `src/ui.ts` | Modify | Add `formatFooter`, `writeFooterToPane`, and `clearFooterRow` beside the existing control-pane/prompt helpers at `src/ui.ts:33-76` and `src/ui.ts:101-123`, following the stderr-only bottom-row render contract in spec §3.1 / §3.2 / §4.2. |
| `tests/ui-footer.test.ts` | New | Cover spec §4.5(3): wide footer, compact footer, phase-6 variant, unknown-columns empty string, and exact stderr ANSI sequences for write/clear helpers. |
| `src/commands/footer-ticker.ts` | New | Implement `startFooterTicker({ logger, stateJsonPath, intervalMs })`, inert logger-off mode, 1 Hz polling, `forceTick`, idempotent `stop()`, and `process.on('exit')` cleanup per spec §3.11, §3.12, §3.14, and §4.4. |
| `tests/commands/footer-ticker.test.ts` | New | Cover spec §4.5(5)-(6): active ticker writes exact bytes, re-reads `state.json`, handles atomic rename updates, `stop()` clears the footer and removes the exit listener, and the `NoopLogger` path is fully inert. |
| `src/commands/inner.ts` | Modify | Wire the ticker around `inputManager.enterPhaseLoop()` and `runPhaseLoop` at `src/commands/inner.ts:141-149` and `src/commands/inner.ts:193-208`, add `SIGWINCH` repaint handling, and keep cleanup in the `finally` path per spec §4.4 / §3.11 / §3.14. |
| `tests/commands/inner-footer.test.ts` | New | Add a targeted integration/wiring regression around `innerCommand` using the same mocking style already present in `tests/commands/inner.test.ts:9-38` and `tests/commands/inner.test.ts:235-296`. |
| `FOLLOWUPS.md` | Modify in Task 6 only | Append the deferred reconciliation issue for `gate_error.tokensTotal` divergence, anchored to `FOLLOWUPS.md:96-104`, `src/logger.ts:218-220`, and spec §3.6.1 / §8 TODO-G2-P1. No `logger.ts` code change belongs to this PR. |
| `src/state.ts` | Reference only | `writeState` uses atomic temp-write + `renameSync` at `src/state.ts:14-27`; `readStateSlice` tests must simulate this race contract rather than inventing a different write path. |
| `src/phases/runner.ts` | Reference only | Gate phases emit no `phase_start` and re-enter retry from `pending` at `src/phases/runner.ts:382-489` and `src/phases/runner.ts:706-739`; phase 6 pairing depends on `phase_start`/`phase_end` behavior at `src/phases/runner.ts:760-845`. |
| `src/config.ts` | Reference only | `TERMINAL_PHASE = 8` lives at `src/config.ts:55`; `readStateSlice` must treat `currentPhase === 8` as “no footer” per §8 TODO-G2-P2b. |

---

## Dependencies

- Task 2 depends on Task 1 for sequencing clarity: the aggregator is pure, but the overall footer pipeline consumes the logger’s `getEventsPath()` getter introduced in Task 1.
- Task 5 depends on Tasks 1–4 because `inner.ts` only consumes the logger getter, the UI helpers, and the ticker after those contracts are green.
- Task 6 is independent and can land any time before the final verification task.
- Task 4 must be green before Task 5 is touched. `inner.ts` should only consume a tested ticker contract, not a half-finished polling implementation.

---

## Plan-Time Clarification Needed

- **Task 6 issue number reservation:** the repo’s currently referenced open-issue numbers in `CLAUDE.md:90-99` top out at `#13`. This plan therefore assumes Task 6 will use the next free issue number at implementation time for the `gate_error.tokensTotal` reconciliation follow-up. Resolve that number by running `gh issue list --state open`, then back-fill the concrete number into both `FOLLOWUPS.md` and the PR body.

---

## Task 0: Verify clean tree + baseline tests green

**Implements:** template baseline from `docs/plans/2026-04-18-gate-prompt-hardening.md`, plus the repo-wide verification commands from `CLAUDE.md:43-49`.

**Files:** none (pre-flight only).

- [ ] **Step 1: Confirm the worktree is clean before any code edits.**

Run:

```bash
git status --short --branch
```

Expected:
- output starts with `## feat/control-pane-counters`
- no modified or untracked files before Task 1 begins

- [ ] **Step 2: Record the approved-spec anchor before implementation starts.**

Open `docs/specs/2026-04-19-control-pane-counters-design.md` and verify the working copy matches the approved design, especially:
- §4.1 (`FooterStateSlice`, `aggregateFooter(events, stateSlice, now)`)
- §4.4 (`startFooterTicker({ logger, stateJsonPath, intervalMs })`)
- §4.5 (full test matrix)
- §4.6 (files touched)
- §5 (eval checklist)
- §8 (TODO-G2-P1 / TODO-G2-P2a / TODO-G2-P2b)

- [ ] **Step 3: Run the baseline typecheck exactly as the repo checklist requires.**

Run:

```bash
pnpm tsc --noEmit
```

Expected: pass on the untouched branch.

- [ ] **Step 4: Run the baseline test suite exactly as the repo checklist requires.**

Run:

```bash
pnpm vitest run
```

Expected: pass on the untouched branch. Record any pre-existing failure before proceeding; the plan assumes a green baseline.

---

## Task 1: Add `getEventsPath` to `SessionLogger`

**Implements:** spec §3.4, §4.3, §4.5(4), and §4.6 rows for `src/types.ts`, `src/logger.ts`, and `tests/logger.test.ts`.

**Files:**
- Modify: `src/types.ts` (`src/types.ts:261-269`)
- Modify: `src/logger.ts` (`src/logger.ts:11-20`, `src/logger.ts:31-76`)
- Modify: `tests/logger.test.ts` (`tests/logger.test.ts:31-53`, `tests/logger.test.ts:55-138`)

- [ ] **Step 1: Write the failing logger tests first.**

Add to `tests/logger.test.ts`:
- one `NoopLogger` assertion next to `getStartedAt` proving `getEventsPath()` returns `null`
- one `FileSessionLogger` assertion proving `getEventsPath()` returns the concrete `events.jsonl` path under `sessionsRoot/repoKey/runId`
- one factory-level assertion that `createSessionLogger(..., false)` still exposes `null` via the `NoopLogger` contract

These tests should cite the exact behavior in spec §3.4:
- `FileSessionLogger` returns `this.eventsPath`
- `NoopLogger` returns `null`

- [ ] **Step 2: Prove the new tests fail before implementation.**

Run:

```bash
pnpm vitest run tests/logger.test.ts -t getEventsPath
```

Expected: fail because `SessionLogger` and both implementations do not expose the getter yet.

- [ ] **Step 3: Extend the `SessionLogger` interface.**

In `src/types.ts`, add:

```ts
getEventsPath(): string | null;
```

Place it alongside the existing lifecycle helpers at `src/types.ts:261-269` so the command layer and ticker can use the logger contract without downcasting.

- [ ] **Step 4: Implement the getter on both logger classes.**

In `src/logger.ts`:
- add `getEventsPath(): string | null { return null; }` to `NoopLogger`
- add `getEventsPath(): string | null { return this.eventsPath; }` to `FileSessionLogger`

Do not modify:
- path construction in `FileSessionLogger` (`src/logger.ts:49-54`)
- `finalizeSummary` token math (`src/logger.ts:156-220`)

- [ ] **Step 5: Run the scoped logger suite to green.**

Run:

```bash
pnpm vitest run tests/logger.test.ts
```

Expected: the new getter assertions pass and the existing summary/dedup tests remain green.

- [ ] **Step 6: Commit.**

Commit with:

```text
feat(footer): expose events path on session logger
```

The commit body should mention spec §3.4 / §4.3 and should not add `Co-authored-by` trailers.

---

## Task 2: Implement `src/metrics/footer-aggregator.ts` pure functions, `phaseStatus`, and terminal-phase handling

**Implements:** spec §4.1, §3.3, §3.6, §3.6.1, §3.7, §3.9, §4.5(1)-(2), §4.6 row `src/metrics/footer-aggregator.ts`, and §8 TODO-G2-P2a / TODO-G2-P2b.

**Files:**
- New: `src/metrics/footer-aggregator.ts`
- New: `tests/metrics/footer-aggregator.test.ts`
- Reference: `src/types.ts:39-53`, `src/types.ts:261-269`
- Reference: `src/state.ts:14-27`
- Reference: `src/phases/runner.ts:179-217`, `src/phases/runner.ts:382-489`, `src/phases/runner.ts:706-739`, `src/phases/runner.ts:760-845`
- Reference: `src/config.ts:55`

§3.12 ownership note for Task 2:
- `readEventsJsonl` owns the malformed-JSON-line silent-skip branch.
- missing `events.jsonl` on disk is a caller-skip path owned by the ticker in Task 4.
- `fs.readFileSync(events.jsonl)` throwing is also a caller tick-skip path owned and tested in Task 4 because the aggregator intentionally propagates read failures upward.

- [ ] **Step 1: Write failing pure-aggregator fixtures for gate-live and TODO-G2-P2a.**

Add tests in `tests/metrics/footer-aggregator.test.ts` for:
- gate live (`currentPhase: 2`, `gateRetries['2'] = 1`, events ending with `phase_end(phase=1)`) -> `attempt === 2`, `phaseRunningElapsedMs` computed from the prior event per spec §3.7

Use `stateSlice` fixtures rather than touching disk:

```ts
{ currentPhase: 2, gateRetries: { '2': 1 }, phaseStatus: 'in_progress' }
```

- [ ] **Step 1a: Write a failing test for `phaseStatus === 'error'` and `phaseStatus === 'skipped'`.**

Add an explicit aggregator test covering both persisted status values from `src/types.ts:4`:
- `phaseStatus: 'error'` -> `phaseRunningElapsedMs === null`
- `phaseStatus: 'skipped'` -> `phaseRunningElapsedMs === null`

This test should prove the gate-elapsed rule is keyed strictly on `phaseStatus === 'in_progress'`, not on a smaller hard-coded subset of statuses.

- [ ] **Step 2: Write failing pure-aggregator fixtures for interactive live and interactive idle.**

Add tests for:
- interactive live on phase 5 with the latest `phase_start` but no matching `phase_end`
- interactive idle on phase 5 where the latest `phase_end` matches the latest `phase_start.attemptId`

These tests should assert:
- `attempt` counts `phase_start` since the latest session-open event
- `phaseRunningElapsedMs` is either `now - ts` or `null`

- [ ] **Step 3: Write the failing phase-6 pairing fixture.**

Add a dedicated test for spec §3.9 / §4.5(1) “Phase 6 pairing”:
- two `phase_start(phase=6)` events
- two interleaved `phase_end(phase=6)` events with no `attemptId`/`retryIndex`

Assert positional pairing rather than ID matching decides whether phase 6 is still running.

- [ ] **Step 4: Write the failing session-resume fixture.**

Add a test where the event list contains:
- an initial `session_start`
- a later `session_resumed`
- activity after the resume

Assert `sessionElapsedMs` measures from the latest session-open event per spec §3.3, not from the first historical session start.

- [ ] **Step 5: Write the failing sidecar-dedup and token-skip fixtures.**

Add tests for:
- authoritative `gate_verdict` + replayed `gate_verdict` with the same `(phase, retryIndex)` -> count once
- authoritative `gate_error` + replayed `gate_error` for the same phase -> count once
- `phase_end.claudeTokens === null`
- `phase_end.claudeTokens` absent
- `gate_verdict.tokensTotal` undefined

Also assert `totalTokens = claudeTokens + gateTokens` and never becomes `NaN`.

- [ ] **Step 6: Write the failing empty/no-session-open fixture.**

Add a test that passes:
- `[]`
- or events with no `session_start` / `session_resumed`

Assert `aggregateFooter(...) === null` per spec §4.1 and §4.5(1).

- [ ] **Step 7: Write the failing `readStateSlice` filesystem tests, including TODO-G2-P2b.**

Add tests for:
- valid `state.json` -> returns `FooterStateSlice` with `currentPhase`, `gateRetries`, and `phaseStatus`
- missing file -> `null`
- malformed JSON -> `null`
- partial file / atomic-rename race -> `null`
- `currentPhase === 8` (`TERMINAL_PHASE`, `src/config.ts:55`) -> `null` per §8 TODO-G2-P2b

The race case should mimic `writeState`’s temp-write + rename contract from `src/state.ts:14-27`, not a different write mechanism.

- [ ] **Step 7a: Write a failing test for malformed `events.jsonl` line skip with valid neighbors.**

Add a `readEventsJsonl` test where the fixture contains:
- one valid line
- one malformed JSON line
- one following valid line

Assert the malformed line is silently skipped while the surrounding valid events are parsed unchanged. Run:

```bash
pnpm vitest run tests/metrics/footer-aggregator.test.ts
```

Expected: red until `readEventsJsonl` implements the malformed-line skip branch from spec §3.12.

- [ ] **Step 8: Prove the new aggregator suite fails before implementation.**

Run:

```bash
pnpm vitest run tests/metrics/footer-aggregator.test.ts
```

Expected: fail because neither the module nor the new functions exist yet.

- [ ] **Step 9: Implement `readEventsJsonl(path)` and the malformed-line skip behavior from Step 7a.**

Create `src/metrics/footer-aggregator.ts` and implement:
- tolerant `events.jsonl` parsing
- malformed-line skip behavior matching `FileSessionLogger.readEvents()` (`src/logger.ts:253-258`)
- a `LogEvent[]` return type

Keep it pure and synchronous per spec §4.1 / §3.12. Preserve the branch ownership above:
- malformed line -> skip in `readEventsJsonl`
- missing file / `fs.readFileSync` throw -> propagate so the Task 4 ticker caller can skip that tick silently

- [ ] **Step 10: Implement `readStateSlice(stateJsonPath)` with the approved narrow shape and `PhaseStatus` reuse.**

`FooterStateSlice` must include:

```ts
currentPhase: number;
gateRetries: Record<string, number>;
phaseStatus: PhaseStatus;
```

Implementation requirements:
- import `PhaseStatus` from `../types` in `src/metrics/footer-aggregator.ts`; do not redefine or narrow the union locally
- derive `phaseStatus` from `state.phases[String(currentPhase)]`
- return `null` on missing, malformed, or partial JSON
- return `null` when `currentPhase` is outside `1..7`, including terminal `8`
- never throw to callers

- [ ] **Step 11: Implement `aggregateFooter(events, stateSlice, now)`.**

The implementation must match the spec terminology exactly:
- latest session-open event decides session elapsed
- interactive attempts count `phase_start` events since that session-open
- gate attempts use `gateRetries[currentPhase] + 1`
- gate elapsed starts from the immediately preceding event when the gate is live
- gate elapsed returns `null` when the gate is no longer `in_progress` (TODO-G2-P2a)
- phase 6 closed/running uses positional `phase_start`/`phase_end` pairing
- token totals follow spec §3.6 and §3.6.1, including sidecar dedup and the intentional `gate_error.tokensTotal` divergence from `summary.json`

Keep the §3.6.1 wording visible in a short comment near the gate-error token handling:
- `"Intentional divergence from summary.json.totals.gateTokens — NOT a consistency guarantee."`

- [ ] **Step 12: Run the scoped aggregator suite to green.**

Run:

```bash
pnpm vitest run tests/metrics/footer-aggregator.test.ts
```

Expected: all fixtures pass, including:
- gate-live
- interactive-live
- interactive-idle
- phase-6 pairing
- session resume
- sidecar dedup
- malformed-line skip with valid neighbors
- token skips
- empty/no session-open
- valid/missing/malformed/race state reads
- TODO-G2-P2a `phaseStatus`, including explicit `error` / `skipped`
- TODO-G2-P2b `currentPhase === 8`

- [ ] **Step 13: Commit.**

Commit with:

```text
feat(footer): add pure footer aggregation and state-slice readers
```

The commit body should reference spec §4.1 and explicitly mention TODO-G2-P2a / TODO-G2-P2b.

---

## Task 3: Implement footer formatting and bottom-row write helpers in `src/ui.ts`

**Implements:** spec §3.1, §3.2, §3.10, §4.2, §4.5(3), and §4.6 row `src/ui.ts`.

**Files:**
- Modify: `src/ui.ts` (`src/ui.ts:33-76`, `src/ui.ts:101-123`)
- New: `tests/ui-footer.test.ts`

- [ ] **Step 1: Write failing formatter tests for wide, compact, phase-6, and unknown-columns output.**

Add to `tests/ui-footer.test.ts`:
- wide format when `columns >= 80`
- compact format when `columns < 80`
- phase-6 variant with no Claude/gate segment in the rendered phase text, while preserving cumulative tokens so far
- unknown/invalid columns -> empty string

Use a pinned `FooterSummary` fixture that matches the spec examples in §3.10.

- [ ] **Step 2: Write failing stderr ANSI-sequence tests for `writeFooterToPane` and `clearFooterRow`.**

Stub `process.stderr.write` and assert exact bytes for:
- `writeFooterToPane(line, rows, columns)` -> `\x1b[s\x1b[${rows};1H\x1b[2K${line}\x1b[u`
- `clearFooterRow(rows)` -> `\x1b[s\x1b[${rows};1H\x1b[2K\x1b[u`

Also assert these helpers target `stderr`, not `stdout`, per spec §3.2.

- [ ] **Step 3: Prove the new UI footer tests fail before implementation.**

Run:

```bash
pnpm vitest run tests/ui-footer.test.ts
```

Expected: fail because the helpers do not exist yet.

- [ ] **Step 4: Implement `formatFooter`, `writeFooterToPane`, and `clearFooterRow`.**

In `src/ui.ts`:
- keep `renderControlPanel` unchanged per spec §4.2
- add a small duration formatter for `1m 23s` / `1m23s` output
- keep the footer on `stderr`
- keep column handling local to `formatFooter`

Do not convert existing `renderControlPanel` or `renderWelcome` clear-screen behavior; the footer is an overlay, not a full-screen rerender.

- [ ] **Step 5: Run the scoped UI footer suite to green.**

Run:

```bash
pnpm vitest run tests/ui-footer.test.ts
```

Expected: all new formatter and ANSI sequence assertions pass.

- [ ] **Step 6: Commit.**

Commit with:

```text
feat(footer): add control-pane footer formatting helpers
```

The commit body should reference spec §4.2 and the bottom-row stderr decision from §3.1 / §3.2.

---

## Task 4: Implement `src/commands/footer-ticker.ts`

**Implements:** spec §3.11, §3.12, §3.14, §4.4, §4.5(5)-(6), and §4.6 row `src/commands/footer-ticker.ts`.

**Files:**
- New: `src/commands/footer-ticker.ts`
- New: `tests/commands/footer-ticker.test.ts`
- Reference: `src/commands/inner.ts:193-208`

§3.12 ownership note for Task 4:
- missing `events.jsonl` on disk -> skip the tick silently
- `readStateSlice(stateJsonPath) === null` -> skip the tick silently
- `process.stderr` not being a usable TTY surface -> skip the tick silently
- `fs.readFileSync(events.jsonl)` throwing during a scheduled tick -> catch, skip that tick, and let the next tick proceed

- [ ] **Step 1: Write the failing happy-path ticker test with fake timers.**

Add a test that:
- creates a temp `events.jsonl`
- creates a temp `state.json`
- stubs `process.stderr.write`
- uses fake timers
- starts `startFooterTicker({ logger, stateJsonPath, intervalMs: 1000 })`

Assert:
- the ticker reads the logger’s `eventsPath`
- the rendered output contains the exact summary text from the fixture
- the bytes include save/move/clear/restore in the correct order

- [ ] **Step 2: Write the failing state-refresh test for atomic rename updates.**

Add a test that rewrites `state.json` mid-run using the same temp-file + rename pattern as `writeState` (`src/state.ts:14-27`) and proves the next tick picks up the new `currentPhase` / `phaseStatus` without crashing.

- [ ] **Step 3: Write the failing cleanup/idempotence tests.**

Add tests for:
- `stop()` clears the footer row once
- repeated `stop()` calls are no-ops
- one `process.on('exit', listener)` registration on start
- `process.removeListener('exit', listener)` on stop
- the exit path also clears the footer row synchronously

These tests implement spec §3.14’s idempotent abnormal-exit cleanup.

- [ ] **Step 4: Write the failing inert logger-off test.**

Add a `NoopLogger` path test asserting:
- no interval write activity
- no exit listener registration
- `forceTick()` and `stop()` are no-op safe

- [ ] **Step 5: Prove the new ticker suite fails before implementation.**

Run:

```bash
pnpm vitest run tests/commands/footer-ticker.test.ts
```

Expected: fail because the module does not exist yet.

- [ ] **Step 6: Implement `startFooterTicker(opts)`.**

Create `src/commands/footer-ticker.ts` with:
- `FooterTickerOptions`
- `FooterTicker`
- `startFooterTicker`
- a local `onTick`
- an inert branch when `logger.getEventsPath()` returns `null`
- `process.stderr.isTTY` / `rows` / `columns` guards
- `forceTick()` that calls `onTick()` synchronously
- `stop()` that clears the interval, clears the footer row, removes the exit listener, and becomes idempotent

- [ ] **Step 6a: Write a failing test for missing `events.jsonl` on disk, then make the ticker skip silently.**

Add a ticker test where the logger returns an `events.jsonl` path that does not exist on disk. The scheduled tick must perform zero `stderr.write` calls.

Run:

```bash
pnpm vitest run tests/commands/footer-ticker.test.ts
```

Expected: red. Then implement the missing-file skip path in `startFooterTicker`, rerun the same vitest command, and see green.

- [ ] **Step 6b: Write a failing test for `readStateSlice(stateJsonPath) === null`, then make the ticker skip silently.**

Use a fixture where `state.json` is missing, malformed, or observed mid-rename so `readStateSlice(stateJsonPath)` returns `null`. Assert the tick performs zero `stderr.write` calls.

Run:

```bash
pnpm vitest run tests/commands/footer-ticker.test.ts
```

Expected: red. Then implement the null-state-slice skip path, rerun the same vitest command, and see green.

- [ ] **Step 6c: Write a failing test for non-TTY or unknown `stderr` dimensions, then make the ticker skip silently.**

Stub either:
- `process.stderr.isTTY === false`
- `process.stderr.columns` / `process.stderr.rows` as `undefined` or `0`

Even with valid events plus valid state, assert the tick performs zero `stderr.write` calls.

Run:

```bash
pnpm vitest run tests/commands/footer-ticker.test.ts
```

Expected: red. Then implement the non-TTY / unknown-dimensions skip path, rerun the same vitest command, and see green.

- [ ] **Step 6d: Write a failing test for `fs.readFileSync(events.jsonl)` throwing during a scheduled tick, then make the next tick recover.**

Stub the scheduled read so one tick throws from `fs.readFileSync(events.jsonl)`, then restore the file/read stub for the following tick. Assert:
- the throwing tick is caught
- there is no crash or unhandled rejection
- a later tick succeeds and writes the footer normally

Run:

```bash
pnpm vitest run tests/commands/footer-ticker.test.ts
```

Expected: red. Then implement catch-and-continue recovery around the scheduled read path, rerun the same vitest command, and see green.

- [ ] **Step 7: Run the scoped ticker suite to green.**

Run:

```bash
pnpm vitest run tests/commands/footer-ticker.test.ts
```

Expected: all active/inert/cleanup tests pass.

- [ ] **Step 8: Commit.**

Commit with:

```text
feat(footer): add footer ticker with exit cleanup
```

The commit body should explicitly mention spec §3.14 and the `NoopLogger` inert path from §4.4.

---

## Sequencing Note Before Task 5

Task 4 must be green before `src/commands/inner.ts` is touched. `inner.ts` is just the integration point; it should consume a stable `startFooterTicker({ logger, stateJsonPath, intervalMs })` contract rather than chasing failures across wiring and ticker internals at the same time.

---

## Task 5: Wire the ticker in `src/commands/inner.ts` and add the targeted inner-command regression test

**Implements:** spec §4.4, §3.11, §3.14, §4.5(7) integration coverage where feasible, and the `src/commands/inner.ts` file-touchpoint listed in the task brief.

**Files:**
- Modify: `src/commands/inner.ts` (`src/commands/inner.ts:141-149`, `src/commands/inner.ts:193-208`)
- New: `tests/commands/inner-footer.test.ts`
- Reference: `tests/commands/inner.test.ts:9-38`, `tests/commands/inner.test.ts:235-296`

- [ ] **Step 1: Write the failing `inner.ts` wiring regression test.**

Create `tests/commands/inner-footer.test.ts` using the same dependency-mocking style already used in `tests/commands/inner.test.ts`:
- mock `startFooterTicker`
- mock `runPhaseLoop`
- mock tmux/root/git/state helpers as needed
- drive `innerCommand(...)`

Assert:
- `stateJsonPath` is derived as `path.join(runDir, 'state.json')`
- `startFooterTicker` is called after `inputManager.enterPhaseLoop()`
- the options object passed to the ticker is `{ logger, stateJsonPath, intervalMs: 1000 }`

- [ ] **Step 2: Extend the failing test to cover `SIGWINCH` and `finally` cleanup.**

In the same test file, add assertions that:
- `process.on('SIGWINCH', footerTimer.forceTick)` is registered while the phase loop runs
- `footerTimer.stop()` is called in `finally`
- `process.removeListener('SIGWINCH', footerTimer.forceTick)` runs before logger shutdown completes

If mocking the full command lifecycle proves brittle, keep the test behavioral but narrow the assertions to the wiring contract; do not replace it with a mere source-string search because this task is intended to catch broken call-site integration.

- [ ] **Step 3: Prove the new inner-footer regression test fails before implementation.**

Run:

```bash
pnpm vitest run tests/commands/inner-footer.test.ts
```

Expected: fail because `inner.ts` does not import or call the ticker yet.

- [ ] **Step 4: Implement the `inner.ts` wiring.**

Update `src/commands/inner.ts` to:
- import `startFooterTicker`
- derive `const stateJsonPath = join(runDir, 'state.json')` immediately after `inputManager.enterPhaseLoop()` (`src/commands/inner.ts:194`)
- create the ticker before `runPhaseLoop(...)`
- register `SIGWINCH`
- stop the ticker and remove the listener in the existing `finally` block before `logger.close()`

Keep the rest of the cleanup ordering intact:
- `session_end`
- `finalizeSummary`
- `logger.close()`
- `inputManager.stop()`
- `releaseLock(...)`

- [ ] **Step 5: Run the scoped inner-footer regression test to green.**

Run:

```bash
pnpm vitest run tests/commands/inner-footer.test.ts
```

Expected: the wiring contract passes with the mocked lifecycle.

- [ ] **Step 6: Commit.**

Commit with:

```text
feat(footer): wire footer ticker into inner command
```

The commit body should reference spec §4.4 and mention that `SIGWINCH` + `finally` cleanup are covered by the new test file.

---

## Task 6: Record TODO-G2-P1 in `FOLLOWUPS.md` without changing `logger.ts`

**Implements:** spec §3.6.1, §8 TODO-G2-P1, and the task brief’s explicit “NO code change to logger.ts in this PR” constraint.

**Files:**
- Modify: `FOLLOWUPS.md`
- Reference only: `src/logger.ts:218-220`

- [ ] **Step 1: Lock the guardrail before editing anything.**

Before touching `FOLLOWUPS.md`, confirm this task is docs-only:
- `src/logger.ts` stays byte-for-byte unchanged
- `tests/logger.test.ts` stays unchanged for this task
- the actual reconciliation of `summary.json.totals.gateTokens` vs footer totals remains a separate issue/PR

- [ ] **Step 2: Append the follow-up entry with the next free issue number at implementation time and the approved wording direction.**

Run `gh issue list --state open`, determine the next free issue number at implementation time, and append a new entry to `FOLLOWUPS.md` under the appropriate priority section with wording aligned to spec §3.6.1:

Required content direction:
- filename: `FOLLOWUPS.md`
- issue number: the concrete next free issue number returned by the tracker at implementation time
- title direction: `summary.json gate token total does not include gate_error.tokensTotal`
- body direction: the footer intentionally counts `gate_error.tokensTotal`, `FileSessionLogger.finalizeSummary` does not, and reconciling `src/logger.ts:218-220` plus the related logger tests is out of scope for the footer PR
- explicit note that sidecar dedup semantics from spec §3.6.1 must remain intact when the follow-up lands

- [ ] **Step 3: Verify the docs-only scope after the edit.**

Run:

```bash
git diff -- FOLLOWUPS.md src/logger.ts tests/logger.test.ts
```

Expected:
- only `FOLLOWUPS.md` changes in this task
- no `logger.ts` change
- no logger-test change

No vitest run is required here because Task 6 is a documentation carry-forward, not executable code.

- [ ] **Step 4: Commit.**

Commit with:

```text
docs(footer): record gate error token reconciliation follow-up
```

The commit body should quote the spec phrase:
- `"Intentional divergence from summary.json.totals.gateTokens — NOT a consistency guarantee."`

---

## Final Task: Full-suite verification, manual smoke, and PR checklist

**Implements:** spec §5, the repo-wide command contract from `CLAUDE.md:43-49`, and spec §4.5(7) manual smoke.

**Files:** none (verification + PR prep only).

- [ ] **Step 1: Run the full typecheck.**

Run:

```bash
pnpm tsc --noEmit
```

Expected: pass.

- [ ] **Step 2: Run the full vitest suite.**

Run:

```bash
pnpm vitest run
```

Expected: pass, including the new footer suites and the existing logger/runner/integration suites.

- [ ] **Step 3: Run the production build.**

Run:

```bash
pnpm build
```

Expected: pass with fresh `dist/` output.

- [ ] **Step 4: Execute the manual smoke from spec §4.5 case 7.**

In a real tmux session, run:

```bash
harness run --enable-logging "demo"
```

Manual checks:
- observe the footer updating during an interactive phase
- let the run reach a gate phase and confirm the footer stays on the live gate phase instead of freezing on the last interactive `phase_start`
- resize the terminal once to exercise `SIGWINCH`
- send `SIGINT` and confirm the footer row is cleared before process exit

- [ ] **Step 5: Capture the PR checklist.**

Before opening the PR, include in the PR body:
- changed files grouped by Task 1–6
- simplifications made (`getEventsPath` getter instead of recomputing session paths; pure aggregator; inert ticker on logging-off)
- remaining risks from the spec that still apply (`scrollback overwrite window`, `SIGKILL out of scope`)
- manual smoke evidence from Step 4
- note that Task 6 recorded the concrete next-free issue number (resolved by `gh issue list --state open`) as the follow-up for `gate_error.tokensTotal` reconciliation

- [ ] **Step 6: Confirm completion criteria before handing off.**

Do not call the plan complete until all of the following are true:
- no pending task boxes remain
- the footer renders live in tmux
- `pnpm tsc --noEmit`, `pnpm vitest run`, and `pnpm build` all passed
- manual smoke covered the gate-live transition and SIGINT cleanup
- the PR body includes the checklist items above

---

## Eval Checklist

Copied from spec §5, then extended with the carry-forward TODO checks required by this plan.

- [ ] `pnpm tsc --noEmit` passes
- [ ] `pnpm vitest run` passes, baseline 617 → ≥ 617 + new tests
- [ ] `pnpm build` produces dist with no warnings
- [ ] Aggregator unit tests cover: §3.6 token rules, §3.6.1 sidecar dedup (verdict + error), §3.7 hybrid current-phase / attempt / phase-running-elapsed for gate-live + interactive-live + interactive-idle + phase-6-positional, §3.3 resume semantics, empty events, malformed line skip
- [ ] Aggregator test proves malformed JSON line is silently skipped (Task 2)
- [ ] `readStateSlice` unit tests cover: valid / missing / malformed / atomic-rename mid-write race (all non-throwing; failures return `null`)
- [ ] Formatter tests cover: wide, compact, phase-6 variant, unknown-columns
- [ ] Logger test asserts `getEventsPath` for both implementations
- [ ] Ticker integration test asserts: exact ANSI sequence bytes on tick, state-slice-driven rendering, SIGWINCH forceTick, `stop()` clears footer + removes `exit` listener, inert NoopLogger path
- [ ] Ticker test proves skip on missing `events.jsonl` (Task 4)
- [ ] Ticker test proves skip on null state slice (Task 4)
- [ ] Ticker test proves skip on non-TTY / unknown stderr dims (Task 4)
- [ ] Ticker test proves read-throw recovery (next tick succeeds) (Task 4)
- [ ] Manual smoke documented in PR body: screenshot or ASCII capture of footer updating across gate + interactive phases, and clean footer after SIGINT
- [ ] TODO-G2-P2a phaseStatus aggregator test included
- [ ] Aggregator test covers `phaseStatus === 'error'` and `phaseStatus === 'skipped'` (both -> null running elapsed)
- [ ] TODO-G2-P2b currentPhase=8 test included
- [ ] TODO-G2-P1 recorded in `FOLLOWUPS.md` (no `logger.ts` change)

---

## Task-to-Spec Coverage Matrix

This section is only a planning aid; execute the tasks above, not this matrix.

| Spec item | Plan coverage |
|---|---|
| §3.4 / §4.3 logger getter | Task 1 |
| §4.1 pure aggregator API | Task 2 |
| §3.3 latest session-open semantics | Task 2, Steps 4 + 11 |
| §3.6 token accumulation rules | Task 2, Steps 5 + 11 |
| §3.6.1 sidecar dedup + intentional summary divergence | Task 2, Steps 5 + 11; Task 6 |
| §3.7 hybrid state/events phase derivation | Task 2, Steps 1-4 + 11; Task 5 |
| §3.9 phase-6 positional pairing | Task 2, Step 3 |
| §3.10 wide/compact formatting | Task 3, Step 1 |
| §3.11 SIGWINCH | Task 4, Step 1; Task 5, Steps 1-4; Final Task Step 4 |
| §3.12 silent error handling | Task 2, Steps 7a + 9; Task 4, Steps 6a-6d |
| §3.12 malformed line skip | Task 2, Steps 7a + 9 |
| §3.12 ticker skip paths (missing events / null slice / non-TTY / read-throw) | Task 4, Steps 6a-6d |
| §3.14 abnormal-exit cleanup | Task 4, Steps 3 + 6; Task 5, Step 4; Final Task Step 4 |
| §4.5(1) aggregator pure fixtures | Task 2, Steps 1-6 |
| §4.5(2) `readStateSlice` tests | Task 2, Step 7 |
| §4.5(3) formatter tests | Task 3, Steps 1-2 |
| §4.5(4) logger getter tests | Task 1, Step 1 |
| §4.5(5) ticker integration tests | Task 4, Steps 1-4 |
| §4.5(6) logging-off inert ticker | Task 4, Step 4 |
| §4.5(7) manual smoke | Final Task Step 4 |
| §4.6 files-touched table | File Map + Tasks 1-5 |
| §8 TODO-G2-P1 | Task 6 |
| §8 TODO-G2-P2a | Task 2, Steps 1 + 1a + 10 + 11 |
| §8 TODO-G2-P2a phaseStatus type reuse + error/skipped tests | Task 2, Steps 1a + 10 |
| §8 TODO-G2-P2b | Task 2, Step 7 + Step 10 |

---

## PR Exit Notes

- Keep the implementation split reviewable. The natural commit sequence is Task 1 -> Task 2 -> Task 3 -> Task 4 -> Task 5 -> Task 6, then the final verification pass.
- Do not fold Task 6 into the logger getter or aggregator commits. The spec explicitly wants the `gate_error.tokensTotal` reconciliation tracked separately from the footer implementation.
- If any task uncovers a contradiction with the approved spec, stop and add a short “Plan-time clarification needed” note to the PR body rather than silently expanding scope in code.
- The footer is intentionally read-only. Do not introduce schema changes, runner-side logging mutations, chokidar, or a scroll-region refactor in this branch.
