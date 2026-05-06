# Auto-mode Gate Retry Stagnation Detection — Design

- runId: `2026-05-06-phase-harness-gate-retry-8ea9`
- task spec: `.harness/2026-05-06-phase-harness-gate-retry-8ea9/task.md`
- decisions log: `.harness/2026-05-06-phase-harness-gate-retry-8ea9/decisions.md`
- impl plan: written by Phase 3 (`docs/plans/2026-05-06-phase-harness-gate-retry-8ea9.md`)
- eval report: written by Phase 6 (`docs/eval-reports/2026-05-06-phase-harness-gate-retry-8ea9.md`)

## Context & Decisions

### Failure mode being fixed
`phase-harness` autonomous mode (`state.autoMode === true`) currently force-passes any gate that has been rejected `retryLimit` times in a row, regardless of *why* it keeps being rejected. The retry counter (`state.gateRetries[phase]`) is the only signal feeding the decision in `src/phases/runner.ts:726–731`. As a result the runtime cannot distinguish two qualitatively different failure traces:

1. **Converging retries** — each retry's reviewer feedback is materially different from the previous one; the implementer is moving toward approval but ran out of attempts. Force-pass is acceptable: the next phase is likely close to working state.
2. **Stagnant retries** — each retry's reviewer feedback is essentially the same text as the previous one; the implementer is unable to address the root cause (often because the reviewer's request is outside the implementer's reach, or because of a misread spec). Force-pass is *harmful*: the next phase inherits an unaddressed defect and explodes downstream.

Today's auto-mode treats (1) and (2) identically. The user observed downstream blow-ups concentrated on case (2).

### Reference signal
Q00/ouroboros's stagnation detection literature describes four canonical patterns (spinning, oscillation, no-drift, diminishing returns) with a repetitive-feedback threshold around 70% similarity. We adopt the *single most informative* signal — adjacent-retry feedback overlap — as v1; the remaining patterns can be layered on the same event surface in a later iteration without schema breakage.

### Decision summary (rationale captured in `decisions.md`)
1. **Detection scope:** single signal — adjacent-retry token-Jaccard ≥ threshold for `RUN` consecutive pairs. (Alternatives weighed: 2-signal hybrid, full 4-pattern. Rejected for surface-area + tuning cost.)
2. **Default activation:** `on` in auto-mode, `off` in manual mode. Env-overridable. Manual mode already escalates at retry limit, so the new code path only changes auto-mode semantics.
3. **Detected action:** call existing `handleGateEscalation(...)` (the C/S/Q prompt) instead of `forcePassGate(...)`. Reuses existing UX, ev­ents, and metrics aggregator. New `escalation.reason` enum value `'gate-stagnation'` distinguishes the path in logs.
4. **Window:** `WINDOW=2`, `RUN=2` (two adjacent stagnant pairs required). With `retryLimit=3`, the check fires exactly at the moment the runner would otherwise force-pass; this is a 1:1 replacement of the failure-prone branch.
5. **Algorithm:** token-set Jaccard. Tokenization: `NFKC + toLowerCase + /[\p{L}\p{N}_]+/gu`. Deterministic, language-neutral, no dependencies, O(n) per gate.
6. **Configuration surface:** four env vars (`HARNESS_GATE_STAGNATION{,_THRESHOLD,_RUN,_WINDOW}`) — no CLI flags. Invalid values → fall back to defaults + single stderr warn.
7. **State persistence:** detector ring buffer is **in-memory only** — not serialised to `state.json`. Resume after crash starts the buffer empty; this is a deliberate, fail-open behaviour (a resumed run must accumulate ≥`RUN + (WINDOW − 1)` rejects again before stagnation can fire — by default 3).
8. **Backward compatibility:** new `gate_stagnation` event is an additional optional `LogEvent` variant; new `escalation.reason` value is an enum extension. No existing event signature changes. `force_pass.by` stays `'auto' | 'user'` — when stagnation routes to escalation, force-pass either does not happen or happens with `by: 'user'` from the user choosing 'S'.

## Complexity

Medium — single new module (`src/phases/stagnation.ts`, ~150 LoC) plus one branch interception in `src/phases/runner.ts`, plus three test groups, plus README/HOW-IT-WORKS sync. Not a single-file change, not a new subsystem.

## Goals

1. In auto-mode, replace the *unconditional* "rejected `retryLimit` times → force-pass" rule with: *"rejected `retryLimit` times AND the last two reject pairs were stagnant → escalate to user; else force-pass as before"*.
2. The escalation surface is the existing `handleGateEscalation` prompt (C / S / Q) — no new UI, no new sentinel/reopen logic.
3. Stagnation detection is deterministic, dependency-free, O(text length) per gate retry, and never blocks a converging gate from reaching force-pass.
4. The user can disable detection or tune its **threshold and run** via environment variables without rebuilding. The pair-size parameter (`window`) is *not* user-tunable in v1 — it is fixed at `2` (adjacent-pair comparison). The env var `HARNESS_GATE_STAGNATION_WINDOW` is accepted but treated as a no-op for forward-compatibility (see Configuration loader).
5. The events.jsonl schema gains exactly one new optional event variant and one enum addition; no existing event field is renamed, removed, or retyped.
6. On any internal failure (token parse error, ring buffer corruption, malformed env), behaviour falls back to the existing 3-strike force-pass with at most one stderr warn per key — *never* harder than today. Specifically: malformed env values force `cfg.enabled = false` for the entire process (unified rule — see Configuration loader and I-3); detector exceptions are caught and routed to force-pass at the call site.

## Non-goals

- No detection of the other three ouroboros patterns (spinning, no-drift, diminishing returns) in this iteration.
- No CLI flag (`--stagnation-*`). Configuration is env-only.
- No persistence of detector state across `phase-harness resume`. (Resume = empty buffer = fail-open; intentional.)
- No change to manual-mode behaviour. Manual mode already prompts at retry limit; adding a stagnation hint there is out of scope.
- No change to verify-loop retry semantics (Phase 6 `state.verifyRetries`). Only the gate retry branch in `handleGateReject` is touched.
- No change to `force_pass.by` enum or to existing `escalation.reason` semantics for the four pre-existing values.
- No telemetry beyond the new `gate_stagnation` event and `summary.json` counter.

## Architecture

### Module map (changes)

| File | Type of change | Purpose |
|---|---|---|
| `src/phases/stagnation.ts` | **new** | `tokenJaccard`, `StagnationDetector`, `loadStagnationConfig` |
| `src/phases/stagnation.test.ts` | **new** | Unit tests for the new module |
| `src/phases/runner.ts` | edit | Lazy-init detectors per phase; intercept the auto-mode force-pass branch in `handleGateReject` |
| `src/phases/runner.test.ts` | edit (add cases) | Auto-mode stagnation, manual-mode no-op, env-off no-op, fail-open |
| `src/types.ts` | edit | Add `gate_stagnation` LogEvent variant; extend `escalation.reason` enum with `'gate-stagnation'` |
| `src/logger.ts` | edit | Add optional `stagnationEscalations` counter to summary aggregation |
| `tests/integration/gate-stagnation.test.ts` | **new** | End-to-end: simulate 3 stagnant rejects in auto-mode, verify event ordering + reason |
| `README.md`, `README.ko.md` | edit | Document the four env vars + the new auto-mode behaviour (one paragraph each) |
| `docs/HOW-IT-WORKS.md`, `docs/HOW-IT-WORKS.ko.md` | edit | Add stagnation sub-section under gate retry; update events.jsonl schema table |

### Detection algorithm (deterministic spec)

```
function tokens(text: string): string[]
  return Array.from(text.normalize('NFKC').toLowerCase().matchAll(/[\p{L}\p{N}_]+/gu)).map(m => m[0])

function tokenJaccard(a: string, b: string): number | null
  let A = new Set(tokens(a))
  let B = new Set(tokens(b))
  if A.size === 0 || B.size === 0 then return null
  let inter = count of x in A where B.has(x)
  let union = A.size + B.size - inter
  if union === 0 then return null
  return inter / union
```

### Detector contract

```ts
class StagnationDetector {
  constructor(cfg: { threshold: number; run: number; window: number })
  // Push a fresh feedback comments string. Maintains an in-memory ring buffer of size `RUN + (WINDOW - 1)`.
  record(comments: string): void
  // True iff the last `run` adjacent-pair similarities in the buffer are all defined and >= threshold.
  // Also returns the underlying similarity numbers for telemetry.
  shouldEscalate(): { triggered: boolean; similarities: number[] }
}
```

The constructor accepts `window` for forward-compat parameterisation (and so unit tests can probe the buffer formula against multiple values), but in v1 `loadStagnationConfig` always passes `window: 2`. The buffer holds the last `RUN + (WINDOW − 1)` feedback strings — at the v1 fixed values `RUN=2, WINDOW=2` this is **3 strings** (s₀, s₁, s₂), enough to form the two adjacent pairs `(s₀,s₁)` and `(s₁,s₂)` required for trigger. Older entries roll off FIFO. `record` is total (no throws on empty/huge inputs); `shouldEscalate` is total (returns `{triggered: false, similarities: []}` when buffer too small).

### Configuration loader

```ts
function loadStagnationConfig(autoMode: boolean): {
  enabled: boolean; threshold: number; run: number; window: number
}
```

Reads `process.env`. Each env var is parsed once per phase loop iteration entry (cheap). **Any invalid value of a *validated* env (`HARNESS_GATE_STAGNATION`, `_THRESHOLD`, `_RUN`) forces `enabled = false` for the entire process** (i.e., the feature self-disables on misconfiguration), and emits *one* `console.warn` per misconfigured key per process (deduped via a module-private `Set`). This unified rule guarantees that the runtime path on misconfig is byte-identical to today's 3-strike force-pass behaviour (Goal #6). `HARNESS_GATE_STAGNATION_WINDOW` is **not** validated in v1 — it is a *reserved* env name accepted as a no-op and never participates in the misconfig disable rule.

| Env | Default | Parse rule | On invalid |
|---|---|---|---|
| `HARNESS_GATE_STAGNATION` | `'on'` if `autoMode` else `'off'` | `'on'`/`'off'` exact (case-insensitive) | warn + force `enabled = false` |
| `HARNESS_GATE_STAGNATION_THRESHOLD` | `0.70` | `parseFloat`, must be in `[0, 1]` | warn + force `enabled = false` |
| `HARNESS_GATE_STAGNATION_RUN` | `2` | `parseInt(base 10)`, must be `>= 2` | warn + force `enabled = false` |
| `HARNESS_GATE_STAGNATION_WINDOW` | `2` (fixed) | **no validation** — value is read but ignored; `window` returned by loader is always `2` in v1 | n/a (no value can be "invalid") |

When the three validated envs are valid, `loadStagnationConfig` returns parsed values for `threshold` and `run` and the constant `2` for `window`; when any validated env is invalid, the loader returns `{ enabled: false, threshold: 0.70, run: 2, window: 2 }` (the defaults are still populated as inert placeholders, but `enabled: false` short-circuits all downstream consumers — see Integration point below). Setting `HARNESS_GATE_STAGNATION_WINDOW` to any value (`2`, `5`, `not-a-number`, empty, etc.) does NOT change the returned config and does NOT emit a warn.

### Integration point in `runner.ts`

`handleGateReject` is currently the single producer of force-pass and escalation transitions for gate phases. The change is local to that function:

1. At the **top** of `handleGateReject` (after `state.phases[String(phase)] = 'pending'`, before any state mutation that depends on retryCount): call `cfg = loadStagnationConfig(state.autoMode)`. If `cfg.enabled === true`, then call `getOrCreateDetector(phase, cfg).record(comments)` — otherwise *skip both the detector construction and the record call entirely*. This way, when stagnation is disabled (manual mode, env-off, or env-misconfigured), `handleGateReject`'s control- and data-flow are byte-identical to today's code (the only delta is the `loadStagnationConfig` call itself, which is a pure read of `process.env` with no side effects beyond the deduped warn). The same `cfg` value is reused at the branch in step 2 — *do not call the loader twice in one invocation*.
2. **Replace** the existing branch:
   ```ts
   if (retryCount >= retryLimit && state.autoMode) {
     await forcePassGate(phase, state, runDir, cwd, 'auto', logger);
     return;
   }
   ```
   with (note: `cfg` is the same value already loaded in step 1; the detector here is the one that was constructed/recorded in step 1, or `undefined` if stagnation is disabled):
   ```ts
   if (retryCount >= retryLimit && state.autoMode) {
     if (cfg.enabled && detector !== undefined) {
       let triggered = false;
       let similarities: number[] = [];
       try {
         const r = detector.shouldEscalate();
         triggered = r.triggered;
         similarities = r.similarities;
       } catch (err) {
         console.warn(`[stagnation] detector error: ${(err as Error).message} — falling back to force-pass`);
       }
       if (triggered) {
         logger.logEvent({
           event: 'gate_stagnation',
           phase, retryIndex,
           similarities,
           threshold: cfg.threshold,
           run: cfg.run,
           action: 'escalate',
         });
         await handleGateEscalation(
           phase, comments, scope, retryIndex,
           state, runDir, cwd, inputManager, logger,
           { reason: 'gate-stagnation' },     // new optional override
         );
         return;
       }
     }
     await forcePassGate(phase, state, runDir, cwd, 'auto', logger);
     return;
   }
   ```
3. `handleGateEscalation` gains a single optional parameter `opts?: { reason?: 'gate-retry-limit' | 'gate-stagnation' }`. When omitted, current default `'gate-retry-limit'` stands.
4. The detector map (`Map<GatePhaseKey, StagnationDetector>`) lives at module scope in `runner.ts` and is reset whenever `state.gateEscalationCycles[phase]` increments (a fresh escalation cycle should not be polluted by the previous cycle's buffer).

### Detector lifetime

| Event | Action on detector |
|---|---|
| First reject of a phase in this cycle | Lazy-init detector |
| Subsequent reject (same cycle) | `record(comments)` only |
| `handleGateEscalation` outcome 'C' (continue, retries reset) | Drop detector (next reject re-inits) |
| `forcePassGate` invoked | Drop detector |
| Phase completed (gate APPROVE) | Drop detector |
| `phase-harness resume` (state loaded from disk) | Detector map starts empty (in-memory only) |
| Process exit / SIGTERM | N/A |

## Events / schema changes

### New event

```ts
| (LogEventBase & {
    event: 'gate_stagnation';
    phase: number;          // 2 | 4 | 7
    retryIndex: number;     // pre-mutation retryIndex of the just-failed retry
    similarities: number[]; // last RUN values, all >= threshold by construction
    threshold: number;      // active threshold at decision time
    run: number;            // active RUN at decision time
    action: 'escalate';     // future-extensible; v1 emits only on triggered=true
  })
```

Emitted exactly once per stagnation-triggered escalation, immediately before `handleGateEscalation` is called. Not emitted when `triggered === false`.

### Extended enum

```ts
event 'escalation' {
  reason: 'gate-retry-limit' | 'gate-error' | 'verify-limit' | 'verify-error' | 'gate-stagnation'
}
```

All existing readers that pattern-match the four prior values continue to work; readers that don't recognise `'gate-stagnation'` simply pass it through as an opaque string (TypeScript narrowing in our codebase already handles unknown via the union default).

### summary.json

`logger.ts`'s `finalizeSummary` aggregates a new optional counter `totals.stagnationEscalations` (number of `gate_stagnation` events with `action: 'escalate'`). Existing fields unchanged. Readers built before this change will see one additional field they don't read — backward compatible.

### Footer / metrics aggregator

`src/metrics/footer-aggregator.ts` is **not** changed in this iteration. The new event type is ignored by the aggregator (it only tracks the verdict-key set). Existing `escalations` counter already covers stagnation escalations because `handleGateEscalation` emits the `escalation` event regardless of `reason`.

## Behavioural matrix

Truth table for the new branch in `handleGateReject`:

| `retryCount >= retryLimit` | `state.autoMode` | any *validated* env invalid | `cfg.enabled` | Detector `triggered` | Result |
|---|---|---|---|---|---|
| no | * | * | * | * | (unchanged) save feedback, reopen interactive phase |
| yes | no | * | * | * | (unchanged) `handleGateEscalation` (reason: `'gate-retry-limit'`) |
| yes | yes | yes | no | n/a (detector not constructed) | (unchanged) `forcePassGate(by='auto')` |
| yes | yes | no | no | n/a (detector not constructed) | (unchanged) `forcePassGate(by='auto')` — covers `HARNESS_GATE_STAGNATION=off` |
| yes | yes | no | yes | no | (unchanged) `forcePassGate(by='auto')` |
| yes | yes | no | yes | yes | **new** `handleGateEscalation` (reason: `'gate-stagnation'`); `gate_stagnation` event emitted |

Detector exception in any cell: warn + force-pass (matches the row "triggered=no"). Notes: (1) column "any validated env invalid = yes" implies `cfg.enabled = false` by I-3, so it can never coexist with `triggered = yes`. (2) Setting `HARNESS_GATE_STAGNATION_WINDOW` to any value (including non-`2`) does **not** flip this column — `WINDOW` is not validated in v1 (see Configuration loader).

## Configuration surface (final)

```
HARNESS_GATE_STAGNATION             on (auto) | off (manual; or override) | invalid → warn + disable feature
HARNESS_GATE_STAGNATION_THRESHOLD   0.70  (validated range [0, 1]; invalid → warn + disable feature)
HARNESS_GATE_STAGNATION_RUN         2     (validated range [2, ∞); invalid → warn + disable feature)
HARNESS_GATE_STAGNATION_WINDOW      2     (RESERVED in v1 — not validated, accepted as no-op for forward-compat; v1 always uses pair size 2)
```

Only the first three envs are honoured for behaviour. `WINDOW` is exposed as a documented placeholder so that future versions can give it semantics without breaking operators who set it today.

## Test plan

### Unit — `src/phases/stagnation.test.ts`

1. `tokenJaccard` — identical strings (= 1), disjoint strings (= 0), one-side empty (= null), NFKC normalisation (`½` ↔ `1/2` chars), case insensitivity, mixed Korean/English, very long strings (length-stable).
2. `StagnationDetector.record` — buffer FIFO at capacity `RUN + (WINDOW − 1)` (= 3 by default).
3. `StagnationDetector.shouldEscalate`:
   - buffer < `RUN + 1`: `triggered = false`
   - last `RUN` pairs all ≥ threshold: `triggered = true`
   - last `RUN` pairs include one < threshold: `triggered = false`
   - any pair returns null similarity: `triggered = false`
4. `loadStagnationConfig` —
   - Defaults respect `autoMode` (manual → `enabled: false`, auto → `enabled: true` baseline).
   - Any invalid value of a validated key (`HARNESS_GATE_STAGNATION`, `_THRESHOLD`, `_RUN`) forces `enabled = false` and warns at most once per misconfigured key per process.
   - `HARNESS_GATE_STAGNATION_WINDOW` is treated as no-op: setting it to `'2'`, `'5'`, `'-1'`, `'not-a-number'`, or empty string MUST all return `window: 2` and MUST NOT cause `enabled` to become `false` and MUST NOT emit a warn.
   - All-valid input returns parsed `threshold`/`run` and the constant `window: 2`, with `enabled` driven by `HARNESS_GATE_STAGNATION` only.

### Unit — `src/phases/runner.test.ts` additions

5. Auto-mode + 3 rejects with stagnant comments → no `forcePassGate`, `handleGateEscalation` called with `reason: 'gate-stagnation'`, `gate_stagnation` event emitted.
6. Auto-mode + 3 rejects with diverse comments → `forcePassGate` called, `gate_stagnation` not emitted (regression guard).
7. Manual mode + 3 stagnant rejects → existing escalation path with reason `'gate-retry-limit'` (regression guard).
8. `HARNESS_GATE_STAGNATION=off` in auto-mode + 3 stagnant rejects → `forcePassGate` called (regression guard).
9. Detector throws inside `shouldEscalate` → fall back to `forcePassGate`, single warn, no `gate_stagnation` event.
9a. **Env misconfiguration of a *validated* key (any one of `HARNESS_GATE_STAGNATION` / `_THRESHOLD` / `_RUN` invalid, e.g., `HARNESS_GATE_STAGNATION_THRESHOLD=not-a-number`) in auto-mode + 3 stagnant rejects → `forcePassGate` called, `gate_stagnation` not emitted, exactly one warn for the offending key.** This pins the unified-fail-open rule.
9b. **`HARNESS_GATE_STAGNATION_WINDOW` set to a non-`2` value** (e.g., `5`, `not-a-number`, empty) in auto-mode + 3 stagnant rejects → `handleGateEscalation` called with `reason: 'gate-stagnation'` (i.e., feature stays enabled, WINDOW is ignored), `gate_stagnation` event emitted, NO warn for the WINDOW key. This pins the WINDOW-as-no-op semantics required by Goal #4.

### Integration — `tests/integration/gate-stagnation.test.ts`

10. Drive the runner with `--enable-logging` + simulated stagnant gate rejections (mock the gate phase result). Assert events.jsonl contains, in order:
    - `gate_retry × 2`
    - `gate_stagnation × 1`
    - `escalation × 1` with `reason: 'gate-stagnation'`
    - and *no* `force_pass` event in between.

### Regression — existing suite

11. The pre-existing `force_pass`, `gate_retry`, and `escalation` event-shape tests must pass unchanged. (Verifies backward-compat constraint #3.)

## Success Criteria

A change is *complete* when **all** of the following are true:

1. **Code presence:** `src/phases/stagnation.ts` exists in the worktree and exports the symbols `tokenJaccard`, `StagnationDetector`, and `loadStagnationConfig`. Verifiable by: `grep -n "export function tokenJaccard\|export class StagnationDetector\|export function loadStagnationConfig" src/phases/stagnation.ts` returns three matching lines.
2. **Type extension:** `src/types.ts` declares the `gate_stagnation` event variant and adds `'gate-stagnation'` to the `escalation.reason` enum. Verifiable by: `grep -n "event: 'gate_stagnation'" src/types.ts` returns ≥ 1 hit AND `grep -n "'gate-stagnation'" src/types.ts` returns ≥ 1 hit.
3. **Branch interception:** `src/phases/runner.ts` calls `loadStagnationConfig` and dispatches to `handleGateEscalation` (not `forcePassGate`) when the detector returns `triggered`. Verifiable by: `grep -n "loadStagnationConfig\|gate_stagnation" src/phases/runner.ts` returns ≥ 2 hits inside the `handleGateReject` function body.
4. **Tests pass:** `pnpm tsc --noEmit` exits 0; `pnpm vitest run` exits 0 with the new tests in the suite (≥ 11 new test names matching the plan above).
5. **Backward compat:** a freshly built `dist/` produces an `events.jsonl` whose `force_pass`, `gate_retry`, and `escalation` event shapes are byte-identical to a baseline captured before the change for non-stagnant runs. Verifiable by: integration test 11 listed above (existing suite passes unchanged).
6. **No new dependency:** `package.json` `dependencies` and `devDependencies` are unchanged. Verifiable by: `git diff main -- package.json` shows zero diff in these blocks.
7. **Documentation sync (CLAUDE.md mandate):** `README.md`, `README.ko.md`, `docs/HOW-IT-WORKS.md`, `docs/HOW-IT-WORKS.ko.md` each contain the string `HARNESS_GATE_STAGNATION` at least once. Verifiable by: `grep -l "HARNESS_GATE_STAGNATION" README.md README.ko.md docs/HOW-IT-WORKS.md docs/HOW-IT-WORKS.ko.md` lists all four files.
8. **Fail-open under env misconfiguration:** with any invalid value of a *validated* env (`HARNESS_GATE_STAGNATION`, `_THRESHOLD`, or `_RUN` — e.g., `HARNESS_GATE_STAGNATION_THRESHOLD=not-a-number`) and a 3-stagnant-reject auto-mode run, the result is `forcePassGate(by='auto')`, `gate_stagnation` is NOT emitted, and exactly one stderr `console.warn` is produced for the offending key. `HARNESS_GATE_STAGNATION_WINDOW` is *not* a validated env in v1: setting it to any value MUST NOT trigger this path (see test 9b). Verifiable by tests 9a and 9b in the test plan above.

## Invariants

The implementation MUST preserve the following at all times:

- **I-1 (no-regress):** When `cfg.enabled === false` (manual mode, env-off, or env-misconfigured) OR `triggered === false` from `shouldEscalate()`, the runtime path through `handleGateReject` is byte-identical to the pre-change path with respect to *persisted* state (`state.json`, sentinels, files), *emitted events*, and *file IO*. The only deltas vs main are: (a) the pure `process.env` read inside `loadStagnationConfig` (which has no side effects beyond an at-most-once-per-key deduped `console.warn`), and (b) when `cfg.enabled === true`, an in-memory ring-buffer push inside the detector — both confined to the running process and never serialised.
- **I-2 (auto-mode-only by default):** In manual mode (`state.autoMode === false`) and with no env override, `loadStagnationConfig(false).enabled === false`. **When `cfg.enabled === false`, the detector is neither constructed nor consulted** — `getOrCreateDetector` is not called and `record`/`shouldEscalate` are never invoked. The whole stagnation code path collapses to the single `loadStagnationConfig` call.
- **I-3 (fail-open):** Any thrown exception from `loadStagnationConfig`, `tokenJaccard`, `record`, or `shouldEscalate` is caught at the call site in `handleGateReject` and routed to the existing `forcePassGate` path with one `console.warn`. Additionally, *any* invalid env value forces `cfg.enabled = false` for the rest of the process (one warn per misconfigured key, see I-8). Stagnation MUST NOT introduce a new way to crash the harness, and it MUST NOT make stricter decisions (escalate where the old code force-passed) under malformed configuration.
- **I-4 (event additivity):** Existing `LogEvent` variant fields remain unchanged in name, type, and presence. The only schema deltas are: (a) a new top-level variant `gate_stagnation`; (b) an enum extension on `escalation.reason`. Verifiable by: `grep -nE "event: 'gate_retry'\|event: 'force_pass'\|event: 'escalation'" src/types.ts` shows the same line shapes (modulo the enum widening) as on `main`.
- **I-5 (in-memory only):** `state.json` and `meta.json` schemas gain no new fields. The detector buffer is never serialised. Verifiable by: `grep -n "stagnation\|Stagnation" src/state.ts src/types.ts` returns hits ONLY in the LogEvent area, NOT in `HarnessState` / `SessionMeta` interfaces.
- **I-6 (no new dependency):** `package.json` is unchanged in `dependencies` and `devDependencies`.
- **I-7 (no CLI surface):** `src/commands/{run,resume,start,jump,skip,inner}.ts` gain zero new flags. Verifiable by: `grep -n "stagnation" src/commands/*.ts` returns zero hits (no command-layer surface).
- **I-8 (one warn per misconfig):** Each invalid env var emits at most one `console.warn` per process, deduped by env-var name.
- **I-9 (idempotent on resume):** Resuming a paused run starts the detector buffer empty for every phase; this MUST NOT cause a previously-decided escalation to be undone or a previously-decided force-pass to be retroactively converted.

## Edge cases

- **Two consecutive identical feedback strings of zero tokens** (e.g., reviewer returned an empty `## Reviewer Comments` block): `tokenJaccard` returns `null` for both pairs → `triggered = false` → force-pass. Acceptable: this is a reviewer-side anomaly, not a stagnation signal.
- **Reviewer feedback uses code blocks with identical error stacks across retries:** these tokens contribute equally to both sides of the union → similarity rises, often well above 0.70. This is the *intended* signal for stagnation. No special handling.
- **Phase 7 (`handleGateReject(phase=7, ...)`) interaction with light-flow's `state.carryoverFeedback`:** stagnation check runs *before* the existing carryover-feedback branch. If `triggered`, escalation runs and the carryover branch never executes for this round. Acceptable: escalation supersedes auto-reopen; user choice ('C') will reset retries and the next reject can re-establish carryover.
- **`gateEscalationCycles[phase]` increment:** the detector is dropped at cycle boundary (see Detector lifetime). A user choosing 'C' resets retries to 0 and starts a fresh cycle; the new cycle must accumulate stagnant pairs from scratch.
- **Gate APPROVE after stagnant rejects:** the detector is dropped on success; subsequent re-runs of this phase (e.g., later in the same harness session via REopen) start fresh.

## Migration / rollout

- **Feature flag default:** `on` for auto-mode means the change is live the moment a build ships. We accept this because (a) the existing default is buggy by user observation, (b) the failure mode of the new code is fail-open to the existing default, and (c) `HARNESS_GATE_STAGNATION=off` is a one-line escape hatch for any operator who wants the old behaviour.
- **No state migration:** `state.json` schema is unchanged. Runs persisted before this change can be resumed without rewrites.
- **No prompt template changes:** assembler, wrappers, and reviewer contracts are untouched. Only the runtime decision code changes.

## Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| False positive: legitimate convergence flagged as stagnant because reviewer's prose is repetitive but the code is changing | Medium | Threshold `0.70` is conservative; `RUN=2` requires *two* consecutive stagnant pairs; user can override via env. The fallback action (escalation prompt) is non-destructive — user can choose 'S' to force-pass anyway. |
| False negative: real stagnation slips through because reviewer changes wording each time but criticises the same root cause | Medium | Acceptable for v1 — degrades gracefully to today's behaviour. Future patterns (no-drift, diminishing returns) can be layered later via the same event surface. |
| Performance regression from token Jaccard on large feedback (e.g., > 100 KB) | Low | Token set construction is O(n); two sets at most ~tens of thousands of unique tokens; intersection via Set ops is O(min). One call per gate retry. Negligible against gate runtime. |
| Test flakiness from in-memory detector state leaking between vitest cases | Low | Detector map is scoped to `runner.ts` module; tests reset via the existing module-mocking pattern. New tests reset the map explicitly via an exported `__resetDetectors` test hook (or vi.resetModules). |
| Documentation drift: env vars in code disagree with README | Medium | Success Criterion #7 makes the doc sync verifiable by grep — Phase 6 verify report fails if any of the four files lacks the env-var name. |

## Out-of-scope future work

- The other three ouroboros patterns (spinning, no-drift, diminishing returns).
- A `--stagnation-threshold` CLI flag, should env-only configuration prove ergonomically insufficient.
- Persisting the detector buffer in `state.json` to survive `phase-harness resume` mid-cycle.
- A retroactive replay tool that runs stagnation detection over historical `events.jsonl` archives.
- Per-phase threshold tuning (currently one threshold applies to phases 2 / 4 / 7).
