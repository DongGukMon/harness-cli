# Control-pane running elapsed / token counter — Design (P2.1)

**Date:** 2026-04-19
**Branch:** `feat/control-pane-counters`
**Status:** Draft → Spec Gate
**Related:**
- `../plans/2026-04-19-control-pane-counters.md` (plan, upcoming)
- `../../FOLLOWUPS.md` L96–103 (P2.1 origin)
- `../specs/2026-04-18-claude-token-capture-design.md` (phase_end.claudeTokens producer)
- `../specs/2026-04-18-gate-prompt-hardening-design.md` (phase_start.preset logging)

## 1. Problem

Harness runs show only phase ticks in the control pane. On the 2026-04-18 dogfood-full run the user spent 60 min / 9M tokens before noticing drift. FOLLOWUPS.md L100–103 prescribes a footer line tailing `events.jsonl`:

```
P5 attempt 1 · 23m elapsed · 9.1M tokens so far
```

Goal: surface live phase-elapsed, session-elapsed, and cumulative token usage in the control pane without mutating the logging schema.

## 2. Scope

### In scope
- Read-only consumer of `~/.harness/sessions/<repoKey>/<runId>/events.jsonl`.
- Aggregation of `phase_end.claudeTokens.total` (interactive 1/3/5) + `gate_verdict.tokensTotal` + `gate_error.tokensTotal` (gate 2/4/7).
- Footer render on every 1 s tick while `runPhaseLoop` is executing.
- Wide/compact format depending on terminal width.
- Fallback: `--enable-logging` off → no footer (silent).

### Out of scope
- New events / fields in `events.jsonl` (schema frozen).
- Phase 1/3/5 wrapper skill edits, runner edits, playbook edits.
- Historical run visualization (separate follow-up).
- Gate retry ceiling (Group F).
- Scroll-region (DECSTBM) UI refactor.

## 3. Context & Decisions

### 3.1 Rendering strategy — bottom-row absolute cursor positioning
**Decision:** every tick, use `\x1b[s` (save cursor) → `\x1b[${rows};1H` (move to last visible row) → `\x1b[2K` (clear line) → write footer → `\x1b[u` (restore cursor).

**Why:** a full `\x1b[2J\x1b[H` re-render at 1 Hz would (a) clobber `promptChoice` escalation UI (from `ui.ts::promptChoice`, used on gate retry limit) because that prompt flows below the panel, and (b) destroy `printInfo`/`printWarning`/`printSuccess` output emitted during phase transitions and signal redirects (runner.ts L261, L396 etc.). Absolute bottom-row update keeps the scrolling region untouched.

**Tradeoff accepted:** if the terminal scrolls past the bottom row (e.g. very long `printInfo` burst), the footer's row may receive scrolled content before the next tick overwrites it. Acceptable — next tick repaints within 1 s.

### 3.2 Stream choice — stderr (match existing UI convention)
All visible UI in `ui.ts` (separator, control panel body, `printInfo`/`printWarning`/`printSuccess`/`printError`, prompts) writes to **stderr** via `console.error` / `process.stderr.write`. Only the screen-clear sequence `\x1b[2J\x1b[H` in `renderControlPanel` / `renderWelcome` uses `process.stdout.write` — a pre-existing anomaly preserved here for backward compatibility with captured test output.

The footer therefore writes the full ANSI sequence (save / move / clear / render / restore) to **`process.stderr`**. In the tmux pane stderr + stdout are interleaved at the TTY level, but choosing stderr means the footer and the nearby `printInfo`/`printWarning` calls emitted during phase transitions share a buffer and cannot reorder across buffers. This matches gate-0 advisor feedback.

`InputManager.waitForKey` reads raw stdin; stderr writes do not contend. `promptChoice` / `promptModelConfig` flow at cursor position (above the absolute footer row); save/restore keeps the user-facing cursor intact.

### 3.3 Session elapsed semantics — latest session open
`events.jsonl` can contain multiple `session_start` + `session_resumed` entries after a `harness resume`. "Session elapsed" is measured from the **latest** open-event (`session_start` or `session_resumed`, whichever is more recent in the file). Users care about the currently-visible session, not lifetime wall-clock.

### 3.4 Events path exposure — SessionLogger getter
Add `getEventsPath(): string | null` to the `SessionLogger` interface:
- `FileSessionLogger` returns `this.eventsPath` (constant, always safe to read even before the file exists).
- `NoopLogger` returns `null` → footer disabled (logging off).

Cleaner than duplicating `sha1(harnessDir).slice(0,12)` at the call site.

### 3.5 Polling (not chokidar)
Task prescribes polling; polling at 1 Hz is sufficient and simpler. `fs.readFileSync` on events.jsonl is cheap (tens of KB) and the control pane is not latency-sensitive.

### 3.6 Aggregation rules (from task brief)

| Event | Token contribution |
|---|---|
| `phase_end.claudeTokens.total` (interactive 1/3/5) | Added to `claudeTokens`. Skip if `null` or field absent. |
| `gate_verdict.tokensTotal` (2/4/7) | Added to `gateTokens`. Skip if undefined **or if this verdict is a sidecar replay superseded by an authoritative verdict** (§3.6.1). |
| `gate_error.tokensTotal` (2/4/7) | Added to `gateTokens`. Skip if undefined **or if this error is a sidecar replay superseded by an authoritative error** (§3.6.1). |
| Phase 6 | No token contribution (script phase). |

`total = claudeTokens + gateTokens`.

#### 3.6.1 Sidecar replay deduplication
`FileSessionLogger.finalizeSummary` already dedupes sidecar-replayed gate events to avoid double-counting on resumed runs (`src/logger.ts:182–220`, asserted in `tests/logger.test.ts:278–305`). The footer aggregator mirrors the same dedup rule:

1. First pass: collect "authoritative" keys from events where `recoveredFromSidecar !== true`.
   - `authoritativeVerdicts`: `Set<"${phase}:${retryIndex}">` for `gate_verdict`.
   - `authoritativeErrors`: `Set<phase>` for `gate_error`.
2. Second pass (token accumulation): for a `gate_verdict` with `recoveredFromSidecar === true`, skip if the key is already in `authoritativeVerdicts`. For `gate_error` with `recoveredFromSidecar === true`, skip if `phase` is in `authoritativeErrors`.

**Converges with `summary.json.totals.gateTokens` (as of P3.1 follow-up).** `src/logger.ts` now accumulates `gate_error.tokensTotal` into `summary.json.totals.gateTokens` using the same `authoritativeErrors` sidecar dedup as the footer. The two totals are therefore symmetric on both healthy and error-containing runs.

### 3.7 Current phase + attempt (hybrid — state.json + events)

**Reality check:** gate phases 2/4/7 do **not** emit `phase_start` (`src/phases/runner.ts:handleGatePhase` only emits `gate_verdict` / `gate_error`). Only phases 1/3/5/6 emit `phase_start`. Using "last `phase_start`" alone would leave the footer stuck on the previous interactive phase during multi-minute gate runs. We therefore read `state.json.currentPhase` each tick as the authoritative live-phase signal and fall back to events for elapsed timing.

Inputs:
- `state.currentPhase` (1..7): read from `<runDir>/state.json` at tick time — passed in via a `stateJsonPath` argument to the aggregator.
- `state.gateRetries[phase]`: read from the same state.json.
- events from `events.jsonl`.

Computation:
- **`currentPhase`** = `state.currentPhase` (always). If state.json is unreadable this tick → aggregator returns `null` (skip render).
- **`attempt`**:
  - For interactive phases 1/3/5 and verify phase 6: count `phase_start` events in the file where `phase === currentPhase` since the latest session-open event, 1-indexed.
  - For gate phases 2/4/7: `state.gateRetries[String(currentPhase)] + 1` (gateRetries is zero-indexed, the current live attempt is the next retry).
- **`phaseRunningElapsedMs`**:
  - For interactive 1/3/5 and verify 6: `now − ts` of the last `phase_start` event matching `currentPhase`, *unless* a matching "phase closed" event appeared afterward — in which case return `null` (phase is idle, nothing yet started for the next attempt). "Matching closed" means:
    - Interactive: a `phase_end` with same `phase` + `attemptId`.
    - Phase 6: a `phase_end` with same `phase` whose `ts` is greater than the matching `phase_start.ts` (verify phase_end does not carry `attemptId`/`retryIndex`; §3.9 confirms). If multiple `phase_start(phase=6)` interleave with `phase_end(phase=6)`, pair them positionally.
  - For gate phases 2/4/7: compute elapsed from `max(ts_of_last_phase_end OR gate_verdict OR gate_error in the file before gate started)`. Practically: find the most recent event with `ts < now` whose effect is "gate has begun" — that is the event immediately preceding the gate's execution. If none (first phase of the run), fall back to the session-open event's `ts`. Return `null` if the last event in the file is already a `gate_verdict` / `gate_error` for `currentPhase` (gate just finished; the control pane is transitioning).

The gate-elapsed rule is approximate (no explicit `phase_start` for gates) but bounded: the gate begins within milliseconds of the triggering event's log write, so worst-case skew is ≪ 1 s.

### 3.8 Scrollback cost
1 Hz bottom-row writes append a ~80-byte line per second. Over 1 h that is ~290 KB / ~3 600 lines in the tmux scrollback — bounded by tmux's default 2 000-line history (older lines evict naturally). Full re-renders would have been 36 000 lines/h; bottom-row updates are 10× better. Still non-zero; flagged for awareness.

### 3.9 Phase 6 variant
Phase 6 runs `harness-verify.sh` and produces no `claudeTokens`. Footer shows `P6 · Xm Ys phase · Zm Ws session` (no token segment, token aggregates still include prior phases' totals).

Note: phase 6 emits `phase_start` with a `retryIndex` field (`src/phases/runner.ts:771`) but `phase_end` does **not** carry `attemptId` or `retryIndex`. The pairing rule for "has phase 6 ended?" therefore uses positional pairing of `phase_start(phase=6)` / `phase_end(phase=6)` events within the current session-open window (§3.7).

### 3.10 Wide / compact threshold
- `columns >= 80` → wide: `P5 attempt 1 · 1m 23s phase · 12m 04s session · 9.1M tok (8.7M Claude + 0.4M gate)`
- `columns <  80` → compact: `P5 a1 · 1m23s / 12m04s · 9.1M tok`
- `columns` unknown → skip footer render (non-TTY or size not reported).

Width check uses **`process.stderr.columns`** and **`process.stderr.rows`** (footer is a stderr render per §3.2); both must be positive numbers and `process.stderr.isTTY` must be true. This is consistent with the stream choice in §3.2 and §4.4.

### 3.11 SIGWINCH
Register a `process.on('SIGWINCH', ...)` handler inside `inner.ts` (while the tick is active) that triggers one immediate footer re-render. Terminal size changes are applied within 1 tick anyway; SIGWINCH only saves up to 1 s.

### 3.12 Error handling
- `events.jsonl` missing → skip footer (logging off or not yet bootstrapped).
- Single malformed JSON line → silently skip that line (same pattern as `FileSessionLogger.readEvents`).
- `fs.readFileSync` throws → skip tick (next tick retries).
- Terminal lacks `rows`/`columns` → skip render.

No fatal paths — footer failure never crashes the run.

### 3.13 State derivation vs events authority (revised)
**Previous draft** proposed deriving `currentPhase` solely from the events file. Codex spec-gate round 1 surfaced that gate phases 2/4/7 emit no `phase_start`, so pure event-derivation would freeze the footer on the previous interactive phase during long gate runs.

**Revised contract (§3.7):** hybrid — `state.json.currentPhase` is the authoritative live-phase signal, events supply timing and token aggregates. `state.json` is updated atomically by `writeState` at every phase transition (`src/state.ts`), and the aggregator reads it each tick.

Narrow-race tradeoff (previously cited): `state.currentPhase` may briefly show `N+1` before the `phase_start(N+1)` event is flushed. In practice, phase_start logging happens within the same synchronous block as `writeState` in `handleInteractivePhase` / `handleVerifyPhase`, so the race is ≪ 1 s and well under the 1 Hz tick interval. Acceptable.

### 3.14 Ticker cleanup on abnormal exit (SIGINT / SIGTERM / crash)
`signal.ts::registerSignalHandlers` calls `handleShutdown(...)` then `process.exit(130)` — `process.exit` terminates without running `finally` blocks, so the `inner.ts` try/finally that stops the ticker is **not** sufficient on its own. The footer row would otherwise remain as a stale bottom line until terminal scroll clears it.

**Decision:** `startFooterTicker` registers a `process.on('exit', ...)` listener that (a) clears `setInterval` and (b) synchronously writes the "clear footer row" ANSI sequence (`\x1b[s\x1b[${rows};1H\x1b[2K\x1b[u`) to stderr. `process.on('exit')` runs on all exits (normal return, `process.exit`, uncaught exception after Node bubbles up) but **not** on `SIGKILL` — SIGKILL already leaves terminals in unpredictable state, out of scope.

Implementation notes:
- The `exit` listener must be **idempotent** (the normal `finally` path calls `stop()` first, which is already no-op-safe if called twice).
- The `stop()` method deregisters its own `exit` listener to avoid leaks across multiple ticker lifecycles in a single process (matters for tests that spin many tickers).

## 4. Design

### 4.1 New module: `src/metrics/footer-aggregator.ts`

Pure functions, no I/O besides reading the events file + state.json. Trivially unit-testable.

```ts
export interface FooterStateSlice {
  currentPhase: number;          // 1..7, from state.json
  gateRetries: Record<string, number>; // from state.json
}

export interface FooterSummary {
  currentPhase: number;              // 1..7 (from state slice)
  attempt: number;                   // 1-indexed
  phaseRunningElapsedMs: number | null; // null when "phase closed" (see §3.7)
  sessionElapsedMs: number;          // from latest session-open
  claudeTokens: number;
  gateTokens: number;
  totalTokens: number;               // claude + gate
}

export function readEventsJsonl(path: string): LogEvent[];
export function readStateSlice(stateJsonPath: string): FooterStateSlice | null;
export function aggregateFooter(
  events: LogEvent[],
  stateSlice: FooterStateSlice,
  now: number,
): FooterSummary | null;
```

`aggregateFooter` returns `null` when no `session_start` / `session_resumed` is present (logging bootstrapped but no events yet). The ticker computes `stateSlice` by calling `readStateSlice` each tick; if that returns `null` (state.json missing or malformed), the tick is skipped.

### 4.2 UI helpers: `src/ui.ts`

```ts
export function formatFooter(summary: FooterSummary, columns: number): string;
export function writeFooterToPane(line: string, rows: number, columns: number): void;
export function clearFooterRow(rows: number): void;
```

- `formatFooter` is pure (takes summary + columns, returns rendered string or empty when columns unknown).
- `writeFooterToPane` issues the ANSI sequence `\x1b[s\x1b[${rows};1H\x1b[2K${line}\x1b[u` to **`process.stderr`** (§3.2).
- `clearFooterRow` writes `\x1b[s\x1b[${rows};1H\x1b[2K\x1b[u` to stderr — used on ticker stop and in the `exit` listener (§3.14).

`renderControlPanel` is **not** modified — footer is an independent, overlay-style render.

### 4.3 Logger interface addition

```ts
interface SessionLogger {
  // ... existing
  getEventsPath(): string | null;
}
```

- `FileSessionLogger.getEventsPath()` → returns `this.eventsPath`.
- `NoopLogger.getEventsPath()` → returns `null`.

### 4.4 Wiring: `src/commands/inner.ts`

After `inputManager.enterPhaseLoop()` (line 194) and before `runPhaseLoop`, derive `stateJsonPath` from the existing `runDir` and inject both `logger` and `stateJsonPath` into the ticker:

```ts
const stateJsonPath = path.join(runDir, 'state.json');
const footerTimer = startFooterTicker({
  logger,
  stateJsonPath,
  intervalMs: 1000,
});
process.on('SIGWINCH', footerTimer.forceTick);
try {
  await runPhaseLoop(...);
} finally {
  footerTimer.stop();  // idempotent — §3.14
  process.removeListener('SIGWINCH', footerTimer.forceTick);
  // existing cleanup (logger.logEvent session_end, etc.)
}
```

`stateJsonPath` is the same file that `src/state.ts::writeState` updates atomically at every phase transition; `runDir` is already in scope (e.g. `src/commands/inner.ts:L100–L190` runtime context). No new state plumbing is introduced — the ticker merely adds a read-only consumer of a file that already exists for the lifetime of the run.

`startFooterTicker` lives in a new helper `src/commands/footer-ticker.ts`. Signature:

```ts
export interface FooterTickerOptions {
  logger: SessionLogger;
  stateJsonPath: string;
  intervalMs: number;
}
export interface FooterTicker {
  stop(): void;
  forceTick(): void;
}
export function startFooterTicker(opts: FooterTickerOptions): FooterTicker;
```

On construction it:
- Reads `logger.getEventsPath()` once. If `null` → returns an inert object (all methods no-op) so the happy-path wiring doesn't need a branch.
- Captures `stateJsonPath` for use on every tick.
- Starts `setInterval(onTick, intervalMs)`.
- Registers a `process.on('exit', onProcessExit)` listener (§3.14) that synchronously clears the footer row.

On each tick (non-inert):
1. `readEventsJsonl(eventsPath)` — skip tick if file missing (per §3.12).
2. `readStateSlice(stateJsonPath)` — if it returns `null` (missing / malformed / atomic-rename race per `writeState`), **silent skip this tick** (no stderr warn, next tick retries; see §3.12 error handling contract). This matches FOLLOWUPS.md "footer failure never crashes the run".
3. `aggregateFooter(events, stateSlice, Date.now())` → `FooterSummary | null`. If `null` (no `session_start` / `session_resumed` yet), skip render.
4. If summary present and `process.stderr.isTTY` is true with `stderr.columns > 0` and `stderr.rows > 0`, call `writeFooterToPane(formatFooter(summary, cols), rows, cols)`. Otherwise skip render (per §3.10, §3.12).

`forceTick()` simply invokes `onTick` synchronously — used by the SIGWINCH handler in `inner.ts` (§3.11) so terminal resizes repaint within < 1 tick rather than waiting up to 1 s.

Stop policy (`stop()`):
1. If already stopped, return (idempotent guard).
2. `clearInterval(timerId)`.
3. Call `clearFooterRow(rows)` once (guard: `process.stderr.isTTY` && `rows > 0`).
4. `process.removeListener('exit', onProcessExit)` so re-running `startFooterTicker` in tests does not accumulate listeners.
5. Mark stopped-flag so subsequent `stop()` calls are no-ops (also protects against the `exit` listener racing with the `finally` block — §3.14 `onProcessExit` re-checks the flag before acting).

### 4.5 Testing

All aggregator tests use the three-input signature `aggregateFooter(events, stateSlice, now)` with explicit `FooterStateSlice` fixtures — no state.json disk I/O inside pure unit tests. `readStateSlice` is covered separately in a filesystem test (case 2) and ticker test (case 5) so the pure aggregator remains deterministic.

1. **Unit (aggregator) — pure (events, stateSlice, now) cases.** Fixture events.jsonl strings + `FooterStateSlice = { currentPhase, gateRetries }` literals + pinned `now`. Required cases:
   - **Gate live (phase 2/4/7)**: state `{ currentPhase: 2, gateRetries: { '2': 1 } }` + events ending with `phase_end(phase=1)` → `FooterSummary.currentPhase === 2`, `attempt === 2` (retries+1), `phaseRunningElapsedMs` computed from the `phase_end(phase=1)` ts (§3.7 gate-elapsed rule).
   - **Interactive live (phase 1/3/5)**: state `{ currentPhase: 5, gateRetries: {} }` + events with the most recent `phase_start(phase=5, attemptId='A5-1')` and no matching `phase_end` → `attempt` = count of `phase_start(phase=5)` since latest session-open = 1, `phaseRunningElapsedMs` = `now − ts_of_that_phase_start`.
   - **Interactive idle (phase closed)**: same state but last event is a `phase_end(phase=5, attemptId='A5-1')` matching the latest `phase_start` → `phaseRunningElapsedMs === null`.
   - **Phase 6 pairing**: state `{ currentPhase: 6, gateRetries: {} }` + two interleaved `phase_start(phase=6)` / `phase_end(phase=6)` sequences (neither `phase_end` carries `attemptId`/`retryIndex` per §3.9) → verify positional pairing decides running-vs-closed correctly.
   - **Session resume**: two `session_start` + one `session_resumed` in the file → `sessionElapsedMs` measured from the latest open-event's ts (§3.3).
   - **Sidecar dedup**: fixture contains both an authoritative `gate_verdict(phase=2, retryIndex=0, tokensTotal=1000)` (no `recoveredFromSidecar`) **and** a replayed `gate_verdict(phase=2, retryIndex=0, tokensTotal=1000, recoveredFromSidecar=true)` → `gateTokens` counts 1000 once (§3.6.1). Same for `gate_error`.
   - **Token skip cases**: `phase_end.claudeTokens === null`, `phase_end.claudeTokens` field absent, `gate_verdict.tokensTotal` undefined → summary does not NaN/double-count; `totalTokens = claudeTokens + gateTokens`.
   - **Empty events / no session-open**: `aggregateFooter` returns `null`.
2. **Unit (`readStateSlice`):** tmpfs `state.json` fixtures — valid JSON with required fields → `FooterStateSlice`; missing file → `null`; malformed JSON → `null`; partial file (atomic-rename race simulated by writing-then-reading at midstream) → `null`; in all failure cases no `throw` escapes.
3. **Unit (formatter):** FooterSummary → assert wide / compact / phase-6 variants, unknown-columns → empty string.
4. **Unit (logger):** `FileSessionLogger.getEventsPath()` returns the expected path; `NoopLogger.getEventsPath()` returns `null`.
5. **Integration (ticker):** stub `process.stderr.write`; write a synthetic `events.jsonl` + matching `state.json` in a tmp `runDir`; inject `stateJsonPath` via options; run ticker for N ticks with fake timers; assert exact ANSI save/move/clear/restore bytes + correct summary text reflecting the injected state slice; assert `stop()` emits `clearFooterRow`; assert `process.on('exit')` listener is registered once and removed on stop. Additional case: rewrite `state.json` mid-run (atomic temp+rename pattern that `writeState` uses) → next tick's summary reflects the new `currentPhase` without crashing.
6. **Integration (logging off):** `NoopLogger` path — ticker is inert, no stderr writes, no exit listener registered, even when `stateJsonPath` points to a valid file.
7. **Manual smoke:** run `harness run --enable-logging "demo"` in a real tmux session, observe footer updating live across a gate phase transition (must stay accurate during a 2/4/7 run, per §3.7 hybrid); send SIGINT and confirm footer row is cleared before process exits.

### 4.6 Files touched

| File | Change |
|---|---|
| `src/metrics/footer-aggregator.ts` | **new** — reader + aggregator |
| `src/commands/footer-ticker.ts` | **new** — 1 Hz interval controller |
| `src/ui.ts` | **edit** — add `formatFooter`, `writeFooterToPane` |
| `src/commands/inner.ts` | **edit** — wire ticker + SIGWINCH |
| `src/types.ts` | **edit** — add `getEventsPath` to `SessionLogger` |
| `src/logger.ts` | **edit** — implement `getEventsPath` on both loggers |
| `tests/metrics/footer-aggregator.test.ts` | **new** |
| `tests/ui-footer.test.ts` | **new** (formatter + write-sequence) |
| `tests/commands/footer-ticker.test.ts` | **new** |
| `tests/logger.test.ts` | **edit** — `getEventsPath` assertion |

## 5. Eval checklist (preview — finalized in plan)

- [ ] `pnpm tsc --noEmit` passes
- [ ] `pnpm vitest run` passes, baseline 617 → ≥ 617 + new tests
- [ ] `pnpm build` produces dist with no warnings
- [ ] Aggregator unit tests cover: §3.6 token rules, §3.6.1 sidecar dedup (verdict + error), §3.7 hybrid current-phase / attempt / phase-running-elapsed for gate-live + interactive-live + interactive-idle + phase-6-positional, §3.3 resume semantics, empty events, malformed line skip
- [ ] `readStateSlice` unit tests cover: valid / missing / malformed / atomic-rename mid-write race (all non-throwing; failures return `null`)
- [ ] Formatter tests cover: wide, compact, phase-6 variant, unknown-columns
- [ ] Logger test asserts `getEventsPath` for both implementations
- [ ] Ticker integration test asserts: exact ANSI sequence bytes on tick, state-slice-driven rendering, SIGWINCH forceTick, `stop()` clears footer + removes `exit` listener, inert NoopLogger path
- [ ] Manual smoke documented in PR body: screenshot or ASCII capture of footer updating across gate + interactive phases, and clean footer after SIGINT

## 6. Open questions

None. All ambiguity resolved in §3.

## 7. Risks

1. **Scrolling content may overwrite the footer row briefly** (1 s worst case). Mitigation: accepted per §3.1.
2. **SIGWINCH firing during tick** could race. Mitigation: ticker is single-callback; SIGWINCH just schedules a no-op extra tick.
3. **Resume semantics may surprise users** expecting "since first session_start". Mitigation: document in PR body + footer naming (`session`) matches "this session", not "lifetime".
4. **Footer persists on abnormal exit** (SIGINT/SIGTERM/uncaught). Mitigation: `process.on('exit')` listener in §3.14. SIGKILL out of scope.
5. **Multiple exit listeners across test lifecycles.** Mitigation: `stop()` deregisters its own listener (§3.14).

## 8. Deferred TODOs from gate reviews (carry into plan)

These items were raised during the codex spec-gate review rounds and explicitly deferred per the project rule "P1만 처리하고 P2는 plan 내 TODO로 기록 후 다음 phase 진입". The implementation plan MUST list each of them as an explicit TODO (with the noted resolution direction) before the plan gate.

- **[TODO-G2-P1 · round 2 P1 addressed in-spec]** `gate_error.tokensTotal` divergence between footer and `summary.json.totals.gateTokens`. In-scope: footer counts the value (per §3.6). Out-of-scope: reconciling `src/logger.ts:218–220` + `tests/logger.test.ts` so `summary.json.totals.gateTokens` also includes `gate_error.tokensTotal`. **Decision direction for plan:** record as a separate follow-up issue (FOLLOWUPS.md); do NOT include the `finalizeSummary` change in this PR. The spec §3.6.1 divergence note is the durable reference.
- **[TODO-G2-P2a]** `FooterStateSlice` may need `phaseStatus: 'pending' | 'in_progress' | 'completed' | 'failed'` (sourced from `state.phases[phase]`) so the gate-elapsed branch (§3.7) can return `null` during the "escalation logged + phase re-set to `pending`" window (`src/phases/runner.ts:727–739`). Until then the gate-elapsed counter may briefly show a bogus running timer after a gate error re-enters retry. **Decision direction for plan:** add `phaseStatus` to `FooterStateSlice`; §3.7 gate-elapsed rule returns `null` when `phaseStatus !== 'in_progress'`. Plan must add a corresponding aggregator test fixture.
- **[TODO-G2-P2b]** `currentPhase === 8` (TERMINAL_PHASE, `src/types.ts:43`) is written by phase-7 APPROVE/force-pass before `inner.ts` cleanup. `readStateSlice` / `aggregateFooter` currently assume `1..7`. **Decision direction for plan:** `readStateSlice` returns `null` when `currentPhase` is outside `1..7` (treats terminal state as "no footer"). Plan must add a dedicated test for this boundary.
