# P2 Spec Gate — Quantitative Ambiguity Score

Related artifacts:
- Task: `.harness/2026-05-06-p2-spec-gate-ambiguity-9fa2/task.md`
- Decisions log: `.harness/2026-05-06-p2-spec-gate-ambiguity-9fa2/decisions.md`
- Reference (referenced in task): Q00/ouroboros — Ambiguity score gate (Goal/Constraint/Success/Context weights, threshold ≤0.2)

## Context & Decisions

**Problem**. P2 spec gate today is purely qualitative: Codex emits APPROVE/REJECT under the FIVE_AXIS_SPEC_GATE rubric (Correctness / Readability / Scope), and the harness honors that verdict directly. The first dogfood run on this very task showed the failure mode: identical spec, R1 → REJECT, R2 → APPROVE. Nothing changed in the spec between rounds; verdict drift came from reviewer "condition" alone. The qualitative-only contract has no deterministic floor against this kind of noise.

**Goal**. Add a *quantitative* clarity score emitted by Codex alongside the qualitative verdict, compute a weighted ambiguity, and use it as a deterministic veto floor on top of the existing verdict. When ambiguity exceeds a threshold, harness rewrites APPROVE → REJECT with synthetic feedback that points at the lowest-scoring axes; when it doesn't, the existing qualitative verdict stands. The score is also attached to `gate_verdict` events for post-hoc analysis regardless of whether it triggered a veto. Scope is **P2 only**; P4 and P7 are unchanged in this iteration.

**Decisions made during brainstorming** (each resolved live with the developer; no deferred questions):

1. **Threshold breach semantics — Veto.** When `verdict=APPROVE` and `ambiguity > threshold`, harness rewrites verdict to REJECT with synthetic P1 feedback. The alternatives — observational-only logging, or soft alerts — would not address the noise problem the task identifies, since they don't change behavior on identical specs.

2. **Axis set — 4 axes (Goal / Constraint / Success / Context).** Matches the ouroboros reference. Distinct from FIVE_AXIS_SPEC_GATE's verdict axes (Correctness / Readability / Scope), which remain unchanged. Verdict axes answer "is this acceptable?"; clarity axes answer "is this ambiguous?". Weights baked into the harness, not env-tunable: `goal=0.35, constraint=0.25, success=0.30, context=0.10` (sum 1.0). Goal+Success carry the most weight because that is where ambiguity historically breaks implementation. Context is loosest because partial context is legitimately common in early specs.

3. **Codex output format — line-based markdown.** New `## Clarity Scores` section appended after `## Summary`, one bullet per axis: `- goal: 0.85`. No JSON, no fenced block — keeps token cost negligible (~30 tokens output, ~80 tokens added prompt) and avoids JSON-adherence failure modes. No new dependency.

4. **Env var — `HARNESS_GATE_AMBIGUITY_THRESHOLD`.** Default `0.2`. Direction: `ambiguity > threshold` triggers veto (boundary inclusive on the pass side, matching ouroboros's "≤0.2"). Special value `off` (case-insensitive) disables the veto while still parsing and logging scores. Invalid values (non-numeric, out of `[0, 1]`) emit one stderr warning and disable the veto for the run (fail-open).

5. **Autonomous mode — no flow change.** A veto-rewritten REJECT enters the existing `handleGateReject` path: `gateRetries` increments, retry-limit handling is unchanged, the existing PR #96 retry-oscillation detector still applies, autonomous-mode force-pass at attempt 4 still applies. There is no new force-pass mechanism specific to ambiguity. A veto can be force-passed at attempt 4 in autonomous mode just like any other REJECT — the score remains in events.jsonl for post-hoc accountability.

6. **Veto-rewrite location — `src/phases/gate.ts`, after verdict construction, before sidecar persistence.** Keeps `runner.ts`'s control flow clean (single REJECT branch), and makes the rewritten verdict the canonical persisted result (sidecar replay sees the rewritten verdict, not the pre-rewrite APPROVE).

7. **Sidecar replay — no re-application.** When a sidecar (`gate-2-result.json`) is replayed, the rewritten verdict is read back as-is. `applyAmbiguityGate` is **not** invoked on the replay branch. This is correct because (a) the decision is already baked in at write time, and (b) legacy sidecars predating this feature have no scores and should not be re-evaluated against the new threshold. Live runs after this change persist the post-rewrite result + scores.

8. **Temperature override — deferred.** The ouroboros reference uses temperature 0.1 for reproducibility. Our `runners/codex.ts` does not currently expose a temperature flag, and adding `-c temperature=0.1` would either require per-phase plumbing or change behavior across all phases. High `model_reasoning_effort` already constrains variance; if dogfood data shows score instability, follow up in a separate change.

9. **Scope tag rewrite — `Scope: design`.** When a veto rewrite happens, the synthetic comment block is followed by `Scope: design` so `getGateRejectReopenTarget` routes the retry to P1 (where the spec lives). This matches the existing reject-routing convention.

## Complexity

Medium — new module (`ambiguity.ts`) + parser additions in `verdict.ts` + multi-layer call sites (`assembler.ts`, `gate.ts`, `runner.ts`, `types.ts`). Not a single-file change (rules out Small) and not a subsystem refactor (rules out Large).

## Goals

- G1. P2 spec gate emits a quantitative `## Clarity Scores` block with 4 axes (goal, constraint, success, context), each in `[0.0, 1.0]`.
- G2. Harness computes weighted ambiguity = `1 − Σ(score_axis × weight_axis)` and attaches it to the in-memory `GatePhaseResult` and to the `gate_verdict` event in `events.jsonl`.
- G3. When `ambiguity > HARNESS_GATE_AMBIGUITY_THRESHOLD` (default 0.2) and the qualitative verdict was APPROVE, harness rewrites the verdict to REJECT with synthetic P1 feedback that names the lowest-scoring axes. The synthetic feedback flows through the existing `gate-2-feedback.md` → P1 reopen pathway unchanged.
- G4. Threshold is configurable via env var; setting `HARNESS_GATE_AMBIGUITY_THRESHOLD=off` disables the veto while still parsing and logging scores.
- G5. Score parse failure (missing section, missing axis, out-of-range axis, malformed line) is fail-open: qualitative verdict stands, `clarityParseError: true` is attached to the event, and exactly one stderr warning is emitted per process (warned-once pattern).
- G6. Existing `events.jsonl` consumers, sidecar replay paths, and gate flow at P4/P7 are untouched. Legacy sidecars and legacy events.jsonl entries (no score fields) replay correctly.
- G7. Autonomous mode behavior is unchanged: veto-rewritten REJECT goes through the same retry / stagnation / force-pass machinery as any other REJECT.

## Non-Goals

- NG1. No score emission, parsing, or veto for **P4 (plan gate)** or **P7 (eval gate)**. The Codex contract for those gates is untouched. Their `gate_verdict` events do not gain the new fields.
- NG2. No introduction of additional axes, weights, or rubrics for the existing verdict axes (Correctness / Readability / Scope). Those remain qualitative.
- NG3. No temperature override on Codex. Reproducibility is delegated to `model_reasoning_effort=high`.
- NG4. No new CLI flag. The threshold is env-only.
- NG5. No persistent state in `state.json`. Score parsing and veto are stateless per gate attempt.
- NG6. No automatic re-prompting / second Codex pass. The existing retry path (which re-prompts P1, then re-runs gate) is the only retry mechanism.
- NG7. No change to the verdict file path, sentinel protocol, or pane-injection wiring.
- NG8. Per-axis env-tunable weights. Weights are constants this iteration; if dogfood data warrants, a follow-up may expose them.

## Architecture

Five touch points, in execution order:

1. **`src/context/assembler.ts`** — append a `CLARITY_SCORES_PROTOCOL` block to `FIVE_AXIS_SPEC_GATE` only. `REVIEWER_CONTRACT_BASE` and the per-gate constants for 4/7 are unchanged. The resume-prompt's `structuredOutputReminder` in `assembleGateResumePrompt` becomes phase-aware and adds a fourth bullet for phase 2.

2. **`src/phases/verdict.ts`** — add `parseClarityScores`, `computeWeightedAmbiguity`, and the constants `AMBIGUITY_AXES` / `CLARITY_WEIGHTS`. Both functions are pure (no I/O, no exceptions). The existing `parseVerdict`, `buildGateResult`, `buildGateResultFromFile` are unchanged in signature and behavior.

3. **`src/phases/ambiguity.ts`** (new file) — exports `loadAmbiguityThreshold(): number | null` and `applyAmbiguityGate(result, rawOutput, threshold): GatePhaseResult`. Mirrors the structure of `src/phases/stagnation.ts` (env loader + pure decision function + warned-once Set).

4. **`src/types.ts`** — extend `GateOutcome`, `GateError`, and the `gate_verdict` variant of `LogEvent` with five optional fields. No `LogEvent.v` bump (additive optional fields, established pattern).

5. **`src/phases/gate.ts`** — call `applyAmbiguityGate` once for `phase === 2`, immediately after the verdict is built (Claude path: after `runClaudeGate`; Codex path: after `buildGateResultFromFile`), and before `_persistSidecars`. The replay branch in `checkGateSidecars` is **not** modified.

6. **`src/phases/runner.ts`** — at the two `gate_verdict` event emission sites (APPROVE branch and REJECT branch), pass through the new optional fields when present. Phase-2-only guard prevents fields from leaking into P4/P7 events.

## Codex Contract

Block to append at the END of `FIVE_AXIS_SPEC_GATE`:

```
## Clarity Scores (REQUIRED — Phase 2 only)
After `## Summary`, append a section titled exactly `## Clarity Scores`
with one line per axis, in this exact order:

  - goal: <0.0–1.0>
  - constraint: <0.0–1.0>
  - success: <0.0–1.0>
  - context: <0.0–1.0>

Each score is your assessment of how clear/unambiguous that aspect of the
spec is — independent of whether you ultimately APPROVE or REJECT:
  - goal       — Is the desired outcome stated unambiguously?
  - constraint — Are non-requirements / forbidden behaviors / boundary conditions explicit?
  - success    — Are success criteria measurable and concrete?
  - context    — Are assumptions, inputs, and prior decisions captured?

Use 1.0 for "fully clear, no reviewer-to-reviewer drift expected" and 0.0 for
"so vague that two reviewers would reasonably reach different conclusions".
Emit numbers, not adjectives. Do not omit axes.
```

Resume-prompt update: `structuredOutputReminder` in `assembleGateResumePrompt` gains a phase-2 conditional. The reminder for phase 2 includes a fourth bullet: ``- `## Clarity Scores` (4 lines: goal/constraint/success/context, each 0.0–1.0)``. Phases 4/7 receive the existing 3-bullet reminder unchanged.

Token-cost analysis: prompt addition ≈ 80 tokens (one-time per gate run); response addition ≈ 30 tokens (4 short bullet lines). This satisfies the constraint "Codex 토큰 비용 의미 있게 증가시키지 않을 것".

## Parser & Types

### `src/phases/verdict.ts` additions

```ts
export const AMBIGUITY_AXES = ['goal', 'constraint', 'success', 'context'] as const;
export type AmbiguityAxis = typeof AMBIGUITY_AXES[number];

export const CLARITY_WEIGHTS: Readonly<Record<AmbiguityAxis, number>> = Object.freeze({
  goal: 0.35,
  constraint: 0.25,
  success: 0.30,
  context: 0.10,
});

export type ClarityScores = Record<AmbiguityAxis, number>;

export function parseClarityScores(rawOutput: string): ClarityScores | null;
export function computeWeightedAmbiguity(scores: ClarityScores): number;
```

`parseClarityScores` semantics (binding):
- Locate the first `## Clarity Scores` header (case-insensitive match on the trimmed line, mirroring the `## Verdict` parser).
- Return `null` if the header is absent.
- Scan lines after the header until the next `## ` header or EOF.
- For each axis, accept the first line matching `/^\s*-\s*(goal|constraint|success|context)\s*:\s*(\d+(?:\.\d+)?)\s*$/i`. Subsequent duplicates are ignored.
- Return `null` if any axis is missing OR any value is outside `[0.0, 1.0]`.
- No exceptions thrown. Pure function. No file I/O.
- Integer values (e.g. `goal: 1`) are accepted and treated as `1.0`.

`computeWeightedAmbiguity` semantics (binding):
- Returns `1 − Σ(scores[axis] × CLARITY_WEIGHTS[axis])` for `axis ∈ AMBIGUITY_AXES`.
- Result is clamped to `[0, 1]` to absorb floating-point drift; with valid inputs the math itself cannot leave that range.
- Pure function. No exceptions.

### `src/types.ts` additions

```ts
// `ClarityScores` is imported into types.ts via type-only import from
// ../phases/verdict.js. (Type-only avoids the runtime cycle that would arise
// from a value import; verdict.js is allowed to depend on types.ts but not
// the reverse for runtime values.)
clarityScores?: ClarityScores;
ambiguity?: number;
ambiguityThreshold?: number;
ambiguityVetoed?: boolean;
clarityParseError?: boolean;
```

Added to:
- `GateOutcome` (verdict result)
- `GateError` (error result; only `clarityParseError` and `ambiguityThreshold` are meaningful here, but keeping the union flat avoids a type fork)
- `gate_verdict` variant of `LogEvent`

All five fields are optional. Existing readers (typed sums, log-analysis scripts) are unaffected.

## Gate Decision Flow

### `src/phases/ambiguity.ts` (new module)

```ts
export function loadAmbiguityThreshold(): number | null;
export function applyAmbiguityGate(
  result: GatePhaseResult,
  rawOutput: string,
  threshold: number | null,
): GatePhaseResult;
```

`loadAmbiguityThreshold` (binding):
- Reads `process.env['HARNESS_GATE_AMBIGUITY_THRESHOLD']`.
- Unset / empty string → return `0.2`.
- Value `off` (case-insensitive, after trim) → return `null`. Veto disabled.
- Numeric value parseable by `Number()` and finite and in `[0.0, 1.0]` → return that value.
- Anything else → emit one stderr warning (warned-once Set keyed by env-var name), return `null`. Veto disabled, scores still parsed.
- The warned-once Set is module-scoped, mirroring `stagnation.ts`. Test helper `__resetAmbiguityWarning()` exported for unit tests.

`applyAmbiguityGate` (binding):
- If `result.type === 'error'`: return `result` unchanged. (Errors don't carry `rawOutput` reliably and have no verdict to rewrite.)
- Run `parseClarityScores(rawOutput)`.
- If `null` (no scores): set `clarityParseError: true`; if `threshold !== null` set `ambiguityThreshold: threshold`; emit one stderr warning (warned-once); return result. Verdict untouched.
- If parsed: compute `ambiguity = computeWeightedAmbiguity(scores)`. Attach `clarityScores`, `ambiguity`. If `threshold !== null` attach `ambiguityThreshold: threshold`.
- If `threshold !== null` AND `result.verdict === 'APPROVE'` AND `ambiguity > threshold`:
  - Set `result.verdict = 'REJECT'`.
  - Set `ambiguityVetoed = true`.
  - Prepend a synthetic comment block to `result.comments` of the form:
    ```
    - **[P1]** — Location: spec (overall)
      Issue: Spec ambiguity {ambiguity.toFixed(2)} exceeds threshold {threshold.toFixed(2)} (weighted across goal/constraint/success/context).
      Suggestion: Tighten the lowest-scoring axes — {top-2 lowest axes with values}. Restate goals as measurable outcomes and enumerate forbidden behaviors / boundary conditions.
      Evidence: clarityScores = { goal: G, constraint: C, success: S, context: X } → weighted ambiguity {ambiguity.toFixed(2)} > {threshold.toFixed(2)}.
    ```
    The comment uses the standard `[P0|P1|P2|P3]` format so it flows through `gate-2-feedback.md` and the P1 retry prompt unchanged.
  - Append `\nScope: design` to `result.comments` (after stripping any existing `Scope:` line — APPROVE verdicts shouldn't have one, but be defensive). This routes the retry to P1 via `getGateRejectReopenTarget`.
- Return the (possibly mutated) result.

### Wiring in `src/phases/gate.ts`

Single guarded call site, in `runGatePhaseInteractive`, immediately after the verdict is built and before `_persistSidecars`. Both the Claude path (Step 7, after `runClaudeGate`) and the Codex path (Step 10, after `buildGateResultFromFile`) get the same call:

```ts
if (phase === 2) {
  const threshold = loadAmbiguityThreshold();
  gateResult = applyAmbiguityGate(gateResult, rawOutput, threshold);
}
```

`rawOutput` is the verdict text already in scope (`result.rawOutput` from the file read or from the Claude runner). The mutation flows naturally into `_persistSidecars`, which writes the post-rewrite verdict to `gate-2-result.json`.

The sidecar-replay branch in `checkGateSidecars` (Step 1) is **not** modified. Replay returns whatever was persisted — for new runs that's already the post-rewrite verdict; for legacy sidecars it's the pre-feature qualitative verdict, which is correct by construction.

### Wiring in `src/phases/runner.ts`

At the two `gate_verdict` emission sites (APPROVE branch, line ~611; REJECT branch, line ~664), include the new optional fields:

```ts
...(phase === 2 && result.clarityScores !== undefined ? { clarityScores: result.clarityScores } : {}),
...(phase === 2 && result.ambiguity !== undefined ? { ambiguity: result.ambiguity } : {}),
...(phase === 2 && result.ambiguityThreshold !== undefined ? { ambiguityThreshold: result.ambiguityThreshold } : {}),
...(phase === 2 && result.ambiguityVetoed !== undefined ? { ambiguityVetoed: result.ambiguityVetoed } : {}),
...(phase === 2 && result.clarityParseError !== undefined ? { clarityParseError: result.clarityParseError } : {}),
```

The `phase === 2` guard ensures fields never leak into P4/P7 events. No new dispatch branches; the rewritten verdict naturally takes the existing REJECT branch.

## Event Schema

`gate_verdict` event variant (additive optional fields, no `LogEvent.v` bump):

```ts
| (LogEventBase & {
    event: 'gate_verdict';
    phase: number;
    retryIndex: number;
    runner: 'claude' | 'codex';
    verdict: GateVerdict;
    durationMs?: number;
    tokensTotal?: number;
    promptBytes?: number;
    codexSessionId?: string;
    recoveredFromSidecar?: boolean;
    resumedFrom?: string | null;
    resumeFallback?: boolean;
    preset?: { id: string; runner: 'claude' | 'codex'; model: string; effort: string };
    // New (Phase 2 only):
    clarityScores?: ClarityScores;
    ambiguity?: number;
    ambiguityThreshold?: number;
    ambiguityVetoed?: boolean;
    clarityParseError?: boolean;
  })
```

Sample emission — vetoed APPROVE on phase 2:
```json
{
  "event": "gate_verdict", "phase": 2, "retryIndex": 0,
  "runner": "codex", "verdict": "REJECT",
  "ambiguity": 0.34, "ambiguityThreshold": 0.2, "ambiguityVetoed": true,
  "clarityScores": { "goal": 0.45, "constraint": 0.60, "success": 0.85, "context": 0.90 },
  "promptBytes": 12345, "durationMs": 18234, "tokensTotal": 4500
}
```

Sample emission — phase 2 parse failure:
```json
{
  "event": "gate_verdict", "phase": 2, "retryIndex": 0,
  "runner": "codex", "verdict": "APPROVE",
  "ambiguityThreshold": 0.2, "clarityParseError": true,
  "promptBytes": 12345, "durationMs": 18234, "tokensTotal": 4500
}
```

Sample emission — phase 4 (unchanged):
```json
{
  "event": "gate_verdict", "phase": 4, "retryIndex": 0,
  "runner": "codex", "verdict": "APPROVE",
  "promptBytes": 12345, "durationMs": 18234, "tokensTotal": 4500
}
```

## Configuration

| Env var | Default | Type | Effect |
|---|---|---|---|
| `HARNESS_GATE_AMBIGUITY_THRESHOLD` | `0.2` | number ∈ `[0.0, 1.0]` or `off` | Veto threshold. `ambiguity > threshold` rewrites APPROVE→REJECT for P2. `off` disables veto; scores are still parsed and logged. Invalid value → veto disabled + one stderr warning. |

No CLI flag, no `state.json` field, no per-run override. Threshold is process-wide; if needed in tests, mutate `process.env` and call `__resetAmbiguityWarning()`.

## Testing

### `tests/phases/verdict.test.ts` additions

- `parseClarityScores`: happy path; missing section → `null`; missing axis → `null`; out-of-range axis (negative, >1) → `null`; duplicate axis (first wins); case-insensitive header (`## clarity scores`); case-insensitive axis names (`Goal: 0.5`); extra whitespace tolerance; integer values (`- goal: 1`) accepted as 1.0; trailing text after section ignored.
- `computeWeightedAmbiguity`: known-vector check (e.g. all-1.0 → 0.0; all-0.0 → 1.0; ouroboros example with mixed scores → expected weighted result); clamp absorbs floating-point drift; weights-sum-to-1.0 invariant test.

### `tests/phases/ambiguity.test.ts` (new)

- APPROVE + ambiguity > threshold → REJECT; `ambiguityVetoed: true`; synthetic P1 comment present; `Scope: design` appended; `clarityScores` and `ambiguity` attached.
- APPROVE + ambiguity = threshold → unchanged (boundary inclusive on pass side).
- APPROVE + ambiguity < threshold → unchanged; scores attached, `ambiguityVetoed` absent.
- REJECT + any ambiguity → unchanged verdict; scores still attached.
- Parse failure → unchanged verdict; `clarityParseError: true`; `ambiguityThreshold` attached; no `clarityScores`/`ambiguity`/`ambiguityVetoed`.
- `threshold === null` (off) → no veto even at ambiguity=1.0; scores still attached; `ambiguityThreshold` omitted.
- `loadAmbiguityThreshold`: unset → 0.2; `off` (case-insensitive) → null; `0.0` → 0.0; `1.0` → 1.0; `1.5` → null + warning; `-0.1` → null + warning; `abc` → null + warning; warned-once across multiple invalid loads (same key); `__resetAmbiguityWarning` clears the set.
- **Regression**: legacy verdict-only output (no `## Clarity Scores`) → fail-open; verdict unchanged; existing assertions in `verdict.test.ts` continue to pass with the new code path active.

### `tests/phases/gate.test.ts` (existing) — additions

- One integration test: phase-2 fixture verdict file with low scores → `runGatePhaseInteractive` returns a result with `ambiguityVetoed: true` and rewritten verdict. Phase-4 fixture confirms no fields added.

### `tests/context/assembler.test.ts` (existing) — additions

- Phase-2 prompt contains `## Clarity Scores`. Phase-4 and phase-7 prompts do not. Phase-2 resume-prompt structured-output reminder contains the 4-bullet form. Phase-4/7 resume-prompts contain the 3-bullet form.

### Verification commands

```bash
pnpm tsc --noEmit
pnpm vitest run
pnpm build
```

(Per CLAUDE.md, `pnpm lint` is an alias of `tsc --noEmit` — only one of the two appears in the verification list.)

## Documentation Impact

Per CLAUDE.md "문서 동기화 의무":

- `docs/HOW-IT-WORKS.md` + `docs/HOW-IT-WORKS.ko.md` — paragraph in the Phase 2 spec gate section explaining clarity scores, the env var, fail-open semantics, and that the feature is P2-only. New row in the events.jsonl table for `gate_verdict` documenting the five new optional fields.
- `README.md` + `README.ko.md` — brief mention in the env-var section and a one-line note in the spec gate description.

No CLI `--help` change (env-only knob).

## Success Criteria

- SC1. Phase 2 prompt (fresh and resume) contains the `## Clarity Scores` instruction. Phase 4/7 prompts do not. Verified by snapshot/string assertions in `tests/context/assembler.test.ts`.
- SC2. `parseClarityScores` parses a well-formed Codex output with 4 axes, returns `null` for missing/malformed cases. Verified by `tests/phases/verdict.test.ts`.
- SC3. `computeWeightedAmbiguity` matches `1 − Σ(score × weight)` for canonical vectors and clamps to `[0, 1]`. Verified by `tests/phases/verdict.test.ts`.
- SC4. With `HARNESS_GATE_AMBIGUITY_THRESHOLD=0.2` and a Codex APPROVE with weighted ambiguity 0.34, the resulting `GatePhaseResult` has `verdict: 'REJECT'`, `ambiguityVetoed: true`, a P1 synthetic comment, and `Scope: design`. Verified by `tests/phases/ambiguity.test.ts`.
- SC5. With `HARNESS_GATE_AMBIGUITY_THRESHOLD=off`, no veto occurs even at ambiguity=1.0; scores are still attached. Verified by `tests/phases/ambiguity.test.ts`.
- SC6. With a phase-2 verdict file containing a `## Verdict` section but no `## Clarity Scores` section, `applyAmbiguityGate` returns the verdict unchanged with `clarityParseError: true` set; no warning is emitted on subsequent invalid invocations within the same process. Verified by `tests/phases/ambiguity.test.ts`.
- SC7. Phase-4 and phase-7 `gate_verdict` events contain none of the five new fields. Phase-2 `gate_verdict` events contain `ambiguityThreshold` whenever the threshold is not `off`. Verified by `tests/phases/gate.test.ts` and a runner-level emission test.
- SC8. Sidecar replay of a pre-feature `gate-2-result.json` (no scores) produces a `GatePhaseResult` identical to the persisted one — no re-evaluation, no warning. Verified by an explicit test in `tests/phases/gate.test.ts`.
- SC9. `pnpm tsc --noEmit` passes. `pnpm vitest run` passes. `pnpm build` succeeds.
- SC10. Documentation changes land in the same PR as the implementation per CLAUDE.md.

## Invariants

- I1. `REVIEWER_CONTRACT_BASE`, `FIVE_AXIS_PLAN_GATE`, `FIVE_AXIS_EVAL_GATE_FULL`, `FIVE_AXIS_EVAL_GATE_LIGHT`, `FIVE_AXIS_DESIGN_GATE_LIGHT` are unchanged.
- I2. The `## Clarity Scores` instruction appears **only** in the phase-2 prompt and the phase-2 resume reminder. A `grep "Clarity Scores" src/context/assembler.ts` should match exactly the constants for phase 2 and the resume-reminder branch.
- I3. The five new fields (`clarityScores`, `ambiguity`, `ambiguityThreshold`, `ambiguityVetoed`, `clarityParseError`) are emitted in `gate_verdict` events **only** when `phase === 2`.
- I4. `applyAmbiguityGate` is called from exactly one site in `gate.ts`, guarded by `phase === 2`. It is never called from the sidecar replay path.
- I5. Score parse failure does not throw, does not change the verdict, and does not block the run. It emits exactly one stderr warning per process (warned-once Set in `ambiguity.ts`).
- I6. Threshold env-var parse failure is also fail-open (warned-once, veto disabled). The run never aborts due to a malformed env var.
- I7. Weights `CLARITY_WEIGHTS` are frozen (`Object.freeze`) and sum to 1.0 (asserted in tests).
- I8. `LogEvent.v` is not bumped. Existing log readers continue to work without code changes.
- I9. `state.json` schema is unchanged. No migration required.
- I10. Autonomous mode flow is unchanged. A vetoed REJECT goes through `handleGateReject` exactly like any other REJECT, including PR #96 retry-oscillation detection and 4th-attempt force-pass.

## Backward Compatibility / Migration

- B1. **Existing events.jsonl files** remain readable. New optional fields are emitted only on phase-2 events from new runs.
- B2. **Existing sidecars** (`gate-2-result.json` written by pre-feature runs) replay verbatim. The replay path does not invoke `applyAmbiguityGate`, so legacy sidecars are not retroactively vetoed.
- B3. **Existing state.json** schema is unchanged. No migrationVersion bump.
- B4. **Existing CLAUDE / Codex runner code paths** for P4 and P7 are byte-identical (no diff in the prompts those gates receive, no diff in the verdicts they emit).
- B5. **Verify script** (`scripts/harness-verify.sh`) is untouched.
- B6. **Light flow**: phase 2 in light flow uses `FIVE_AXIS_DESIGN_GATE_LIGHT`, not `FIVE_AXIS_SPEC_GATE`. The Clarity Scores protocol is **not** added to the light variant in this iteration; light flow's phase-2 ambiguity is handled in a follow-up if needed. The decision rationale: light flow's phase-2 reviews a *combined* design+plan artifact, so the ambiguity model would need re-tuning. Out of scope here.
