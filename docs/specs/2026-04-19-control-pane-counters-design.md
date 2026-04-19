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
| `gate_verdict.tokensTotal` (2/4/7) | Added to `gateTokens`. Skip if undefined. |
| `gate_error.tokensTotal` (2/4/7) | Added to `gateTokens`. Skip if undefined. |
| Phase 6 | No token contribution (script phase). |

`total = claudeTokens + gateTokens`.

### 3.7 Current phase + attempt
- `currentPhase` = the `phase` field of the **last** `phase_start` event in the file.
- `phaseRunningElapsedMs` = `now − phase_start.ts` of that event, *unless* a matching `phase_end` (same `phase` + `attemptId`) appeared afterward — in which case phase is idle and we return `null` (no "phase elapsed" segment).
- `attempt` = number of `phase_start` events with `phase == currentPhase` *since the latest session-open*. 1-indexed.

This handles interactive re-entries (reopen from later gate rejects) and gate retries equally.

### 3.8 Scrollback cost
1 Hz bottom-row writes append a ~80-byte line per second. Over 1 h that is ~290 KB / ~3 600 lines in the tmux scrollback — bounded by tmux's default 2 000-line history (older lines evict naturally). Full re-renders would have been 36 000 lines/h; bottom-row updates are 10× better. Still non-zero; flagged for awareness.

### 3.9 Phase 6 variant
Phase 6 runs `harness-verify.sh` and produces no `claudeTokens`. Footer shows `P6 · Xm Ys phase · Zm Ws session` (no token segment).

### 3.10 Wide / compact threshold
- `columns >= 80` → wide: `P5 attempt 1 · 1m 23s phase · 12m 04s session · 9.1M tok (8.7M Claude + 0.4M gate)`
- `columns <  80` → compact: `P5 a1 · 1m23s / 12m04s · 9.1M tok`
- `columns` unknown → skip footer render (non-TTY or size not reported).

Width check uses `process.stdout.columns` and `process.stdout.rows`; both must be positive numbers. The existing `separator()` helper already has the same guard.

### 3.11 SIGWINCH
Register a `process.on('SIGWINCH', ...)` handler inside `inner.ts` (while the tick is active) that triggers one immediate footer re-render. Terminal size changes are applied within 1 tick anyway; SIGWINCH only saves up to 1 s.

### 3.12 Error handling
- `events.jsonl` missing → skip footer (logging off or not yet bootstrapped).
- Single malformed JSON line → silently skip that line (same pattern as `FileSessionLogger.readEvents`).
- `fs.readFileSync` throws → skip tick (next tick retries).
- Terminal lacks `rows`/`columns` → skip render.

No fatal paths — footer failure never crashes the run.

### 3.13 State derivation vs events authority
We intentionally derive `currentPhase` from the events file, not from `state.currentPhase`, so that the footer reflects what the logger has actually recorded (avoids the narrow race where `state.currentPhase` advances just before the next `phase_start` is flushed).

### 3.14 Ticker cleanup on abnormal exit (SIGINT / SIGTERM / crash)
`signal.ts::registerSignalHandlers` calls `handleShutdown(...)` then `process.exit(130)` — `process.exit` terminates without running `finally` blocks, so the `inner.ts` try/finally that stops the ticker is **not** sufficient on its own. The footer row would otherwise remain as a stale bottom line until terminal scroll clears it.

**Decision:** `startFooterTicker` registers a `process.on('exit', ...)` listener that (a) clears `setInterval` and (b) synchronously writes the "clear footer row" ANSI sequence (`\x1b[s\x1b[${rows};1H\x1b[2K\x1b[u`) to stderr. `process.on('exit')` runs on all exits (normal return, `process.exit`, uncaught exception after Node bubbles up) but **not** on `SIGKILL` — SIGKILL already leaves terminals in unpredictable state, out of scope.

Implementation notes:
- The `exit` listener must be **idempotent** (the normal `finally` path calls `stop()` first, which is already no-op-safe if called twice).
- The `stop()` method deregisters its own `exit` listener to avoid leaks across multiple ticker lifecycles in a single process (matters for tests that spin many tickers).

## 4. Design

### 4.1 New module: `src/metrics/footer-aggregator.ts`

Pure functions, no I/O besides reading the path. Trivially unit-testable.

```ts
export interface FooterSummary {
  currentPhase: number | null;       // 1..7
  attempt: number | null;            // 1-indexed; null if currentPhase null
  phaseRunningElapsedMs: number | null; // null if phase ended
  sessionElapsedMs: number;          // from latest session-open
  claudeTokens: number;
  gateTokens: number;
  totalTokens: number;               // claude + gate
}

export function readEventsJsonl(path: string): LogEvent[];
export function aggregateFooter(events: LogEvent[], now: number): FooterSummary | null;
```

`aggregateFooter` returns `null` when no `session_start` / `session_resumed` is present (logging bootstrapped but no events yet).

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

After `inputManager.enterPhaseLoop()` (line 194) and before `runPhaseLoop`:

```ts
const footerTimer = startFooterTicker({ logger, intervalMs: 1000 });
process.on('SIGWINCH', footerTimer.forceTick);
try {
  await runPhaseLoop(...);
} finally {
  footerTimer.stop();  // idempotent — §3.14
  process.removeListener('SIGWINCH', footerTimer.forceTick);
  // existing cleanup (logger.logEvent session_end, etc.)
}
```

`startFooterTicker` lives in a new helper `src/commands/footer-ticker.ts`. On construction it:
- Reads `logger.getEventsPath()` once. If `null` → returns an inert object (all methods no-op) so the happy-path wiring doesn't need a branch.
- Starts `setInterval(..., intervalMs)`.
- Registers a `process.on('exit', onProcessExit)` listener (§3.14) that synchronously clears the footer row.

On each tick (non-inert):
1. `readEventsJsonl(path)` (skip if file missing).
2. `aggregateFooter(events, Date.now())` → `FooterSummary | null`.
3. If summary present and stderr is TTY with known `rows` + `columns`, call `writeFooterToPane(formatFooter(summary, cols), rows, cols)`.

Stop policy (`stop()`):
1. `clearInterval`.
2. Call `clearFooterRow(rows)` once (guard: stderr TTY, rows known).
3. `process.removeListener('exit', onProcessExit)` so re-running `startFooterTicker` in tests does not accumulate listeners.
4. Mark stopped-flag so subsequent `stop()` calls are no-ops.

### 4.5 Testing

1. **Unit (aggregator):** fixture events.jsonl (multiple phase_starts, resumed session, phase_ends with and without claudeTokens, gate_verdicts, gate_errors) → assert FooterSummary fields including currentPhase / attempt / phaseRunningElapsedMs semantics.
2. **Unit (formatter):** FooterSummary → assert wide / compact / phase-6 variants, unknown-columns → empty string.
3. **Unit (logger):** `FileSessionLogger.getEventsPath()` returns the expected path; `NoopLogger.getEventsPath()` returns `null`.
4. **Integration (ticker):** stub stderr.write; write a synthetic events.jsonl; run ticker for N ticks with fake timers; assert exact ANSI save/move/clear/restore bytes + correct summary text; assert `stop()` emits `clearFooterRow`; assert `process.on('exit')` listener is registered once and removed on stop.
5. **Integration (logging off):** NoopLogger path — ticker is inert, no stderr writes, no exit listener registered.
6. **Manual smoke:** run `harness run --enable-logging "demo"` in a real tmux session, observe footer updating live; send SIGINT and confirm footer row is cleared before process exits.

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
- [ ] Unit tests cover: aggregator rules (3.6), current-phase (3.7), resume semantics (3.3), empty-events, missing file, malformed lines
- [ ] Formatter tests cover: wide, compact, phase-6 variant, unknown-columns
- [ ] Logger test asserts `getEventsPath` for both implementations
- [ ] Manual smoke documented in PR body: screenshot or ASCII capture of footer updating

## 6. Open questions

None. All ambiguity resolved in §3.

## 7. Risks

1. **Scrolling content may overwrite the footer row briefly** (1 s worst case). Mitigation: accepted per §3.1.
2. **SIGWINCH firing during tick** could race. Mitigation: ticker is single-callback; SIGWINCH just schedules a no-op extra tick.
3. **Resume semantics may surprise users** expecting "since first session_start". Mitigation: document in PR body + footer naming (`session`) matches "this session", not "lifetime".
4. **Footer persists on abnormal exit** (SIGINT/SIGTERM/uncaught). Mitigation: `process.on('exit')` listener in §3.14. SIGKILL out of scope.
5. **Multiple exit listeners across test lifecycles.** Mitigation: `stop()` deregisters its own listener (§3.14).
