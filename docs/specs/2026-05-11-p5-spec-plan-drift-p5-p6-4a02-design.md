# P5 → P6 Drift Detection — Design Spec

- Run ID: `2026-05-11-p5-spec-plan-drift-p5-p6-4a02`
- Task brief: `.harness/2026-05-11-p5-spec-plan-drift-p5-p6-4a02/task.md`
- Decisions log: `.harness/2026-05-11-p5-spec-plan-drift-p5-p6-4a02/decisions.md`
- Reference: ouroboros/Q00 — `Drift = Goal(50%) + Constraint(30%) + Ontology(20%)`, threshold ≤ 0.3
- Related precedent: `docs/specs/2026-05-06-p2-spec-gate-ambiguity-9fa2-design.md` (env / parse / fail-open patterns)

## Context & Decisions

### Problem
P5 implementations regularly satisfy interactive completion criteria yet violate the spec/plan in ways that only surface at the P7 eval gate. The two most recent dogfood runs (#1, #4) both burned a P7 R1 REJECT → P5 R2 cycle for the same root cause: drift was caught too late. We need a quantitative drift signal at P5 phase\_end that can short-circuit the P6 entry when implementation has measurably diverged from the approved spec/plan.

### Decisions made up-front (rationale moved to decisions.md)
- **D1. Codex 1-call scorer (v1)**: a single Codex non-interactive call returns the three axis scores directly. The deterministic floor (grep-rule extraction + per-axis floor mapping) was reviewed and accepted at design time but is **deferred to a follow-up PR** (see `## Deferred`) to keep this iteration shippable; without the floor, score = Codex axes directly. D6 (strict fail-open on Codex failure) already specifies that the floor never gates without Codex, so removing it preserves the P5 success-path semantics.
- **D2. Mode-driven branch on threshold-exceeded**: `autoMode=true` → hard reopen P5; `autoMode=false` → user prompt (C/S/Q).
- **D3. Mode-driven activation default via single env**: `HARNESS_PHASE_DRIFT_THRESHOLD`. unset+autoMode → 0.3, unset+manual → disabled, numeric → enabled at that value, `off` → disabled, invalid → disabled + one stderr warn.
- **D4. New `phase_drift` event**, not a `phase_end` extension. Keeps reader/aggregator changes additive.
- **D5. Codex inputs**: spec full text + plan full text + `git diff planCommit..implCommit`, with a 30 000-char prompt cap; on cap hit, the diff tail is truncated and `driftSource: 'codex-truncated'` is set.
- **D6. Strict fail-open on Codex failure**: scorer error / Codex hang / parse error / network failure must NOT flip a successful P5. Any Codex failure (regardless of deterministic-floor findings) emits `phase_drift.action='error'` with `score=null`, `axes=null`, `driftSource='error'` and lets P6 proceed. The deterministic floor never gates by itself — it only contributes to the score when Codex also produced a parsable response. This keeps drift detection a single integrated signal: either both halves agree on a number, or the run is treated as unmeasured.
- **D7. No new dependencies**. Reuses `runners/codex.ts` invocation primitives. No npm package added.
- **D8. Backward compatibility**: drift event is purely additive; absence of the event must not change any existing reader / footer / retrospective behaviour. State schema unchanged.
- **D9. Scope = both flows (full + light)**. P5 → P6 transition exists in both flow modes; drift detection runs in both.
- **D10. Codex call budget**: ≤ 1 call per P5 phase\_end attempt. Reopened P5s re-trigger drift detection on the next phase\_end (i.e. up to 1 call per P5 attempt, never more than 1 per attempt).

## Complexity

Medium — single new module (`src/phases/drift.ts`) plus targeted edits in `runner.ts` / `types.ts` / `metrics/footer-aggregator.ts` / `phases/retrospective.ts` and 4-file doc sync; estimated 600–900 LoC including tests.

## Goals

- **G1.** At successful P5 phase\_end, compute a drift score in `[0, 1]` from `Goal(50%) + Constraint(30%) + Ontology(20%)`.
- **G2.** Emit a single `phase_drift` event in `events.jsonl` (when drift detection is active) with the score, axes, threshold, action, and source.
- **G3.** When `score > threshold`:
  - Autonomous mode → reopen P5 with synthetic drift feedback (`drift-feedback.md`), suppress P6 advance.
  - Manual mode → prompt the user with C/S/Q; route accordingly.
- **G4.** When drift detection is disabled (env=off, manual default, or env invalid), behaviour is byte-identical to today's P5 success path (no `phase_drift` event, no extra Codex call, no `phase_end.details` change).
- **G5.** Make threshold and activation user-tunable through a single env var; document defaults / disable / fail-open semantics in README + HOW-IT-WORKS (en + ko).
- **G6.** Drift detection re-runs cleanly on resume — when a crashed P5 is resumed, the next `phase_end` re-triggers `scoreP5Drift` from scratch (at most one Codex call per fresh P5 attempt). Byte-precision idempotency of crash mid-`phase_drift`-flush is explicitly out of scope and tracked in `## Deferred`.

## Non-Goals

- **NG1.** No drift detection on phases other than 5 in this iteration.
- **NG2.** No automatic re-prompting of Codex within a single P5 attempt — exactly one Codex call, regardless of outcome.
- **NG3.** No tunable per-axis weights; the 50/30/20 split is baked in.
- **NG4.** No drift gate in the gate (P2/P4/P7) pipeline — those have their own ambiguity / verdict mechanics.
- **NG5.** No replacement of the P7 eval gate. Drift detection is an early-warning, not a substitute.
- **NG6.** No persistent drift history in `state.json` — all evidence lives in `events.jsonl`.

## Architecture

### Module layout
- **`src/phases/drift.ts`** (new). Exports:
  - `loadDriftThreshold(autoMode: boolean): number | null`
  - `parseDriftScores(rawOutput: string): { goal: number; constraint: number; ontology: number; rationale?: string } | null`
  - `computeWeightedDrift(axes: { goal: number; constraint: number; ontology: number }): number`
  - `scoreP5Drift(state, runDir, cwd, logger): Promise<DriftOutcome>` — orchestrator
  - `handleDriftEscalation(state, runDir, cwd, inputManager, logger, outcome): Promise<DriftAction>` — manual-mode prompt
  - `__resetDriftWarning()` — test hook (mirrors `__resetAmbiguityWarning`).
- **`src/runners/codex.ts`** edits: add `runCodexDriftScorer({ specText, planText, diffText, runDir })` re-using the existing non-interactive Codex pipe (sandbox=read-only). One Codex call, structured stdout. No reuse of gate session — drift scorer uses a fresh ephemeral session.
- **`src/phases/runner.ts`** edits: insert exactly one call to `scoreP5Drift` inside `handleInteractivePhase` for `phase === 5` and `result.status === 'completed'`, between artifact normalisation (line ≈ 470) and the existing `state.phases['5'] = 'completed'` mutation (line ≈ 487). The drift outcome dispatches into one of: success-path-continue / reopen / escalation / fail-open.
- **`src/types.ts`** edits:
  - Add the `phase_drift` discriminated-union variant to `LogEvent` (§ Event schema).
  - Add `'drift-escalation'` to `PauseReason`.
  - Add `'show_drift_escalation'` to `PendingActionType`.
  - No change to `HarnessState` shape.
- **`src/metrics/footer-aggregator.ts`** edits: ignore `phase_drift` for existing aggregations; optionally surface a one-line `drift: <score>/<threshold> [<source>]` in the P5 footer row when an event is present (additive — absence preserves today's footer byte-for-byte).
- **`src/phases/retrospective.ts`** edits: aggregate phase\_drift events into a new "Drift detection" section; absent events → section is omitted.
- **Docs**: README.md, README.ko.md, docs/HOW-IT-WORKS.md, docs/HOW-IT-WORKS.ko.md (env table + events.jsonl table + new "Drift detection (P5→P6)" subsection).

### Insertion-point sequence inside `handleInteractivePhase` for P5

The drift code resolves the **final** `action` value before any `phase_drift` event is emitted, so the emitted event always carries one of the final-state values from the action union (no provisional / intermediate `'escalate'` value ever reaches events.jsonl).

```
runInteractivePhase → 'completed'
  ├─ normalizeInteractiveArtifacts(5)        // existing
  ├─ commit-anchor update (state.implCommit) // existing
  ├─ NEW: outcome ← scoreP5Drift(state, runDir, cwd, logger)
  │        // returns { activated, score, axes, threshold, driftSource,
  │        //          codexTokensTotal, rationale, floorRules, error }
  ├─ NEW: action ← resolveDriftAction(outcome, state.autoMode):
  │        not activated (env null)               → no event will be emitted
  │        outcome.error / driftSource='error'    → 'error'
  │        score ≤ threshold                      → 'pass'
  │        score > threshold ∧ autoMode=true      → 'reopen'
  │        score > threshold ∧ autoMode=false     → handleDriftEscalation prompts C/S/Q →
  │                                                  'C' → 'escalate-continue'
  │                                                  'S' → 'escalate-skip'
  │                                                  'Q' → 'escalate-quit'
  ├─ NEW: if activated, emit single 'phase_drift' event (action is FINAL)
  └─ apply branch on action:
       'pass'                                  → existing success path (phase_end completed, currentPhase=6)
       'error'                                 → existing success path (fail-open)
       'reopen'                                → reopen branch (state mutate, phase_end failed reason='drift-reopen')
       'escalate-continue'                     → reopen branch (same as 'reopen')
       'escalate-skip'                         → existing success path
       'escalate-quit'                         → pause branch (state mutate, phase_end failed reason='drift-pause',
                                                                pauseReason='drift-escalation')
```

The reopen branch performs:
```
state.phases['5']            = 'pending'
state.phaseReopenFlags['5']  = true
state.phaseReopenSource['5'] = 5      // self-reopen marker (drift-driven)
state.pendingAction          = { type: 'reopen_phase', targetPhase: 5, sourcePhase: 5,
                                 feedbackPaths: [<runDir>/drift-feedback.md] }
state.currentPhase           = 5      // suppress P6 advance
phase_end emitted with status='failed', details={ reason: 'drift-reopen' }
```

The pause branch performs:
```
state.status                 = 'paused'
state.pauseReason            = 'drift-escalation'
state.pendingAction          = { type: 'show_drift_escalation', targetPhase: 5, sourcePhase: 5,
                                 feedbackPaths: [<runDir>/drift-feedback.md] }
phase_end emitted with status='failed', details={ reason: 'drift-pause' }
```

Carry-over via `state.carryoverFeedback` is **not** used — drift reopen routes from P5 back to P5 directly, so `pendingAction.feedbackPaths` is sufficient and the existing `CarryoverFeedback.sourceGate: 7` literal type stays untouched.

## Scorer algorithm

### Inputs
- `specText`: read from `state.artifacts.spec` (full file).
- `planText`: read from `state.artifacts.plan` (full file).
- `diffText`: `git diff <state.planCommit>..<state.implCommit> --` executed in `state.trackedRepos[0].path` (fallback to `cwd` if `trackedRepos` is empty).
- **Truncation cap**: assemble the prompt; if `len(spec)+len(plan)+len(diff) > 30 000` chars, truncate the diff tail (preserving header + first ≈ 20 000 chars of diff). On cap hit, set `driftSource: 'codex-truncated'`. Spec / plan are never truncated.
- **Oversized spec/plan boundary**: if `len(spec)+len(plan) > 30 000` alone (i.e. the cap cannot be satisfied even with `diff = ""`), `scoreP5Drift` does NOT call Codex; it short-circuits to `action='error'`, `driftSource='error'`, `score=null`, `axes=null`, fail-open. This keeps the cap a hard contract instead of an undefined-behavior region. Single stderr warn line: `[drift] spec+plan exceeds 30 000-char cap (...) — drift detection skipped for this attempt`.

### Codex 1-call
- Function: `runCodexDriftScorer(...)` — one shot, non-interactive Codex CLI invocation, sandbox=read-only.
- System prompt fixes the rubric (Goal/Constraint/Ontology defined explicitly) and the output contract.
- Output contract — Codex must emit, in order:
  ```
  ## Drift Scores
  ```json
  { "goal": <0..1>, "constraint": <0..1>, "ontology": <0..1>, "rationale": "<≤200 chars>" }
  ```
  ```
- Invariants:
  - `goal`, `constraint`, `ontology` ∈ `[0, 1]`. Out-of-range → parse failure.
  - `rationale` is a single-line string (newlines stripped, length-clamped to 200 chars at scorer side).
  - Token budget recorded as `codexTokensTotal` on the event when reported by the runner.

### Weighted score
```
axes        = { goal: codex.goal, constraint: codex.constraint, ontology: codex.ontology }
score       = clamp01(0.5*axes.goal + 0.3*axes.constraint + 0.2*axes.ontology)
```

### `driftSource` taxonomy
- `'codex-only'` — Codex parsed within budget (no truncation, no error). The default success label.
- `'codex-truncated'` — prompt cap hit (D5 truncation rule applied); Codex output still parsed.
- `'error'` — Codex did not produce a parsable response (throw / non-zero exit / timeout / parse failure / out-of-range axes / spec+plan over cap per D5 oversized-boundary). Emit `phase_drift` with `score=null`, `axes=null`, `action='error'`, fail-open.

## Threshold & action

### Activation env
`HARNESS_PHASE_DRIFT_THRESHOLD`:
- unset + `state.autoMode === true` → `0.3`
- unset + `state.autoMode === false` → `null` (drift detection disabled, no event emitted, no Codex call made)
- numeric in `[0, 1]` → that value (autoMode irrelevant)
- `off` (case-insensitive, trimmed) → `null`
- invalid (numeric out of range, or non-numeric non-`off`) → `null` + one stderr warn line per process: `[drift] invalid HARNESS_PHASE_DRIFT_THRESHOLD="…" — drift detection disabled for this run`

When the loader returns `null`, `scoreP5Drift` short-circuits before reading any artifact and before calling Codex.

### Decision table
| `state.autoMode` | `score` vs `threshold` | `action` field | Phase 5 next state |
|---|---|---|---|
| any | `score ≤ threshold` | `'pass'` | success path (advance to 6) |
| `true` | `score > threshold` | `'reopen'` | reopen P5 (state mutate, phase\_end failed, reason='drift-reopen') |
| `false` | `score > threshold`, user picks `C` | `'escalate-continue'` | reopen P5 |
| `false` | `score > threshold`, user picks `S` | `'escalate-skip'` | success path |
| `false` | `score > threshold`, user picks `Q` | `'escalate-quit'` | pause (`pauseReason='drift-escalation'`) |
| any | scorer error | `'error'` | success path (fail-open) |
| any | disabled (env null) | _no event emitted_ | success path |

### `drift-feedback.md` content (used for reopen branches)
Contains: drift score, threshold, axes table, source, Codex rationale (escaped), deterministic floor rule hits (which rules fired and against which file paths). Plain markdown. Path: `<runDir>/drift-feedback.md`. Overwritten on each new drift run (idempotent under resume).

## Event schema

### New `phase_drift` discriminated union variant in `LogEvent`
```ts
{
  event: 'phase_drift';
  phase: 5;
  attemptId: string;
  durationMs: number;
  threshold: number;          // resolved threshold actually applied (never null when emitted)
  score: number | null;
  axes: { goal: number; constraint: number; ontology: number } | null;
  action: 'pass' | 'reopen'
        | 'escalate-continue' | 'escalate-skip' | 'escalate-quit'
        | 'error';
  driftSource: 'codex-only' | 'codex-truncated' | 'error';
  codexTokensTotal?: number;  // only when Codex produced a response (success or parse-fail)
  rationale?: string;         // ≤ 200 chars, single line
  error?: string;             // only when action='error'; one-line cause
}
```
Optional fields are dropped when not applicable (precedent: `phase_end.claudeTokens`).

### Extension to `phase_end.details.reason`
Existing values: `'redirected'`. Add: `'drift-reopen'`, `'drift-pause'`. Both apply only on phase-5 phase\_end with `status='failed'`. Manual escalation 'C' uses `'drift-reopen'` (auto/manual disambiguated by `phase_drift.action`).

### Emission ordering (per single P5 attempt)
```
phase_start(5) … (P5 work) … artifact-normalize …
  → scoreP5Drift (Codex 1-call + deterministic floor)
  → if score > threshold ∧ state.autoMode=false:
        handleDriftEscalation prompts user (C/S/Q)
        ↓ produces final action ∈ {escalate-continue, escalate-skip, escalate-quit}
  → phase_drift          (only when threshold non-null; action is FINAL)
  → phase_end(5, …)
```
`phase_drift` always precedes its paired `phase_end`, never replaces or duplicates it, and is emitted **after** any C/S/Q user input has been collected so the `action` field is one of the final-state values from the action union — there is no provisional / intermediate `'escalate'` value in events.jsonl. When drift is disabled, `phase_drift` is absent and `phase_end` is byte-compatible with today's emission.

## Backward compatibility

- `state.json` schema unchanged. No migration. Existing resumes load without diff.
- `events.jsonl` reader: a missing `phase_drift` is the disabled / pre-feature path. `footer-aggregator` and `retrospective` MUST treat absence as the no-op default and emit identical output to current behaviour.
- New `PauseReason='drift-escalation'` and `PendingActionType='show_drift_escalation'` are additive union values; resume code paths must not assume the prior closed unions. Old persisted states never carry these values.
- No CLI flag added; activation is env-only.
- No new npm dependency — `package.json` and `pnpm-lock.yaml` only churn if any (which they should not).

## Documentation sync (mandatory under repo CLAUDE.md doc rule)

Each of `README.md`, `README.ko.md`, `docs/HOW-IT-WORKS.md`, `docs/HOW-IT-WORKS.ko.md` must, in the same change, gain:
- A row for `HARNESS_PHASE_DRIFT_THRESHOLD` in the env-vars table including default semantics, `off`, fail-open, mode-driven default.
- A row for `phase_drift` in the events.jsonl schema table (or its language equivalent).
- A new "Drift detection (P5→P6)" subsection (≤ 200 lines) covering: when it runs, what it scores, hybrid algorithm summary, mode-driven branch, fail-open contract.

## Testing strategy

### Unit tests — `tests/phases/drift.test.ts` (new)
- `loadDriftThreshold` env matrix (8 cases: unset+auto, unset+manual, "0.5", "0", "1.0", "off", "1.5", "abc"); each invalid path emits exactly one stderr warn (use `__resetDriftWarning` between cases).
- `parseDriftScores` cases: well-formed JSON; out-of-range `goal`; missing axis; non-JSON; missing `## Drift Scores` heading.
- `computeWeightedDrift` reference vectors: `{1,0,0}=0.5`, `{0,1,0}=0.3`, `{0,0,1}=0.2`, `{1,1,1}=1.0`, `{0,0,0}=0.0`; clamp absorbs floating-point drift.
- `extractDeterministicFloor`: 0 rules → no-op; 1 "must contain" miss → goal=0.5; 2+ misses → goal=1.0; forbidden hit → constraint=0.7; mixed.
- `mergeAxes`: codex=null + floor>0 → floor; codex>floor → codex; floor>codex → floor; both 0 → 0.

### Integration tests — `tests/phases/runner-drift.test.ts` (new)
End-to-end through `handleInteractivePhase(phase=5, status=completed)` with `runCodexDriftScorer` mocked:
- pass + active (autoMode, score 0.10) → phase\_drift action=pass + phase\_end completed + currentPhase=6.
- reopen + auto (autoMode, score 0.55) → phase\_drift action=reopen + drift-feedback.md exists + state.phaseReopenFlags['5']=true + phaseReopenSource['5']=5 + pendingAction.feedbackPaths includes drift-feedback.md + phase\_end failed reason='drift-reopen' + currentPhase=5.
- escalate-continue (manual, mocked stdin 'C') → identical state mutation as reopen, action='escalate-continue'.
- escalate-skip (manual, 'S') → success path, action='escalate-skip'.
- escalate-quit (manual, 'Q') → state.status='paused', pauseReason='drift-escalation', action='escalate-quit'.
- disabled-manual-default (autoMode=false, env unset) → no phase\_drift event emitted, phase\_end byte-compatible with current path.
- disabled-env-off (env=off) → identical to disabled-manual-default.
- fail-open Codex throws → phase\_drift action='error', driftSource='error', score=null, axes=null, phase\_end completed, currentPhase=6, exactly one stderr warn line.
- fail-open Codex parse error → identical outcome to "Codex throws" regardless of deterministic-floor `ruleCount` (i.e. action='error', driftSource='error', score=null, axes=null, success path). Test asserts that even when the floor would have matched a "must contain X" rule, P6 still advances. (Per D6 strict fail-open: floor never gates without Codex.)
- truncation cap hit → driftSource='codex-truncated'.

### Backward-compat regression
- Existing `tests/phases/runner.test.ts` P5 success-path cases run unchanged with env unset + autoMode=false (drift detection inactive); `phase_end` payload byte-compatible with today's snapshot.
- Existing `events.jsonl` fixtures (without `phase_drift`) feed `footer-aggregator` and `retrospective` and snapshot output is unchanged.

### Verification commands (eval checklist baseline)
```bash
pnpm tsc --noEmit                     # typecheck (= pnpm lint alias — do NOT also list lint)
pnpm vitest run                       # full suite incl. drift unit + integration
pnpm build                            # tsc + scripts/copy-assets.mjs
```

### Doc-sync verification (deterministic floor self-check)
After implementation, the four doc files MUST each contain:
- regex `HARNESS_PHASE_DRIFT_THRESHOLD` (env var name)
- regex `phase_drift` (event name)
- substring `Drift detection` (subsection title; Korean files may use `드리프트 검출`)
A `grep -l` chain over those four files is part of the eval checklist; absence in any one fails the eval.

## Success Criteria

- **S1.** When `HARNESS_PHASE_DRIFT_THRESHOLD` is unset and `state.autoMode === true`, a P5 success run with mocked drift score `> 0.3` results in: exactly one `phase_drift` event with `action='reopen'`; `state.phaseReopenFlags['5'] === true`; `state.phaseReopenSource['5'] === 5`; `state.pendingAction.feedbackPaths` includes `<runDir>/drift-feedback.md`; `state.currentPhase === 5`; the matching `phase_end` has `status='failed'` and `details.reason === 'drift-reopen'`.
- **S2.** When `state.autoMode === false` and env unset, a P5 success run never emits `phase_drift` and never invokes Codex; `phase_end` payload matches today's snapshot byte-for-byte (regression fixture).
- **S3.** With env=`off`, behaviour matches S2.
- **S4.** With env=`abc` (invalid), behaviour matches S2 plus exactly one stderr line containing the literal `[drift] invalid HARNESS_PHASE_DRIFT_THRESHOLD`.
- **S5.** Codex failure (mock throws / non-zero exit / non-JSON / out-of-range axes / spec+plan over cap) produces `phase_drift` with `action='error'`, `score=null`, `axes=null`, `driftSource='error'`; `phase_end` is `completed`; `currentPhase` advances to 6; exactly one stderr warn line is emitted (per D6 strict fail-open).
- **S6.** With `state.autoMode === false` and threshold-exceeded, the C/S/Q prompt routes to: 'C' = reopen branch identical to S1 except `action='escalate-continue'`; 'S' = success path with `action='escalate-skip'`; 'Q' = paused state with `pauseReason='drift-escalation'`.
- **S7.** Codex is invoked at most once per P5 attempt (verified by mock call-count assertion in integration tests).
- **S8.** No new npm dependency: `git diff` on `package.json` and `pnpm-lock.yaml` from baseline shows no added entries (only churn allowed is version bump if scope demands).
- **S9.** `pnpm tsc --noEmit`, `pnpm vitest run`, `pnpm build` all pass.
- **S10.** README.md, README.ko.md, docs/HOW-IT-WORKS.md, docs/HOW-IT-WORKS.ko.md each match all three doc-sync regexes (`HARNESS_PHASE_DRIFT_THRESHOLD`, `phase_drift`, `Drift detection` or `드리프트 검출`).

## Invariants

- **I1.** `phase_drift` is emitted ⇔ `loadDriftThreshold(state.autoMode)` returned a non-null number for the current run.
- **I2.** `phase_drift` always precedes the paired `phase_end` in `events.jsonl`; both share the same `attemptId`.
- **I3.** Per single P5 attempt (one phase\_start → one phase\_end), at most one `phase_drift` event is emitted and at most one Codex drift call is made.
- **I4.** Drift detection never converts a `result.status === 'failed'` P5 into `completed`, and never converts a `result.status === 'completed'` P5 into `completed` _and_ advances `currentPhase` past 5 when `action ∈ {'reopen','escalate-continue','escalate-quit'}`.
- **I5.** A scorer/Codex failure (any throw, any timeout, any parse error, any out-of-range axis) MUST NOT raise out of `scoreP5Drift`; it returns `action='error'` with `score=null`, `axes=null`, `driftSource='error'`, and the P5 success path proceeds (per D6).
- **I6.** No write to `state.json` from inside `scoreP5Drift` other than the existing reopen-branch state mutation already performed in the runner; the scorer itself is read-only against state.
- **I7.** `state.json` schema is unchanged. No new top-level field. The new `PauseReason='drift-escalation'` / `PendingActionType='show_drift_escalation'` are union-additive and never written by code paths outside drift escalation.
- **I8.** `phase_drift.threshold` always equals the number returned by `loadDriftThreshold` for that run; `phase_drift.score`, when non-null, is in `[0, 1]`; each axis, when non-null, is in `[0, 1]`.
- **I9.** Drift detection runs in both `flow='full'` and `flow='light'` runs; behaviour is identical in both.
- **I10.** Mandatory doc sync: every doc file listed in S10 contains all three doc-sync regexes; this is grep-verified by Phase 6 eval.

## Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Codex 1-call returns hallucinated high drift on a correct impl | medium | Hybrid (`max` with floor), low default threshold (0.3), C/S/Q escape hatch in manual mode, autoMode reopen capped by existing P5 retry loop. Telemetry retains rationale for post-hoc audit. |
| Codex parse drift if Codex CLI changes output schema | low | Single regex parser (`## Drift Scores` → fenced JSON); parse failure is fail-open (no run-blocking); per-version Codex change requires updating the parser only. |
| Token cost overrun | low | 30 000-char prompt cap (≈ 8K tokens); ≤ 1 call per attempt; budget documented in spec & README. |
| Reopen loop (drift score never falls below threshold) | medium | Existing P5 stagnation handling and overall harness pause/exit semantics already cover infinite reopen patterns; no new reopen budget added in this iteration (to be revisited in a follow-up if dogfood shows the symptom). |
| Resume mid-drift (process killed between Codex call and event flush) | low | Drift detection is idempotent: on resume, `runInteractivePhase` will re-run P5 → re-trigger drift on the next phase\_end. Worst case is a duplicate Codex call across two attempts, never within one. |

## Out of scope (this iteration)

- Per-axis weight tuning via env.
- Drift detection on phases 1, 3, 6, 7.
- Persisting drift history in `state.json` for cross-attempt trend analysis.
- A second Codex pass / disagreement reconciliation.
- Replacement of P7 eval gate.
- A new CLI flag for drift detection (env-only is the contract).

## Deferred

- **P2 (gate-2 R1) — crash-window resume contract.** Crash between `phase_drift` flush and the paired `phase_end`/state mutation is not specified at byte-precision in this iteration. Planned semantics: at-least-once telemetry with reader-side dedupe by `(attemptId, event='phase_drift')`; no Codex re-call on resume of the same attempt (P5 will re-run as a new attempt, drift will rescore once for that new attempt). Properly specifying and testing the resume code path requires touching `state.ts` resume helpers and is deferred to a follow-up to keep this spec scoped to a single implementation plan.
- **Deterministic floor (advisor-trimmed).** The original D1 hybrid scorer added a `## Success Criteria` / `## Invariants` grep-rule extraction layer that floors per-axis scores when machine-checkable patterns are violated. v1 ships Codex-only because D6 already specifies the floor never gates without Codex (so removing it preserves P5 success-path semantics). The floor remains valuable as a noise-resistant guardrail when Codex underestimates drift; it lands as a follow-up PR. v1's `driftSource` taxonomy has space for the future `'codex+floor'` value without an enum-breaking change.
