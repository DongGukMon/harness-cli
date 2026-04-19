# Gate Retry Policy Implementation Plan

> **For implementers:** `superpowers:writing-plans` is not available in this session, so this file is written manually but follows the same execution contract: vertical slices, explicit acceptance criteria, and concrete verification commands.

**Spec:** `docs/specs/2026-04-19-group-f-gate-retry-design.md`

**Decision log:** `.harness/2026-04-19-group-f-gate-retry/decisions.md`

**Goal:** Add a scope-aware fast-path for light-flow Gate 7 REJECTs, raise the light-flow retry budget to 5 while keeping full-flow at 3, and preserve existing behavior for every other gate/flow combination.

**Architecture:** Keep the change in the existing gate pipeline layers only. Reviewer contract lives in `src/context/assembler.ts`, scope extraction in `src/phases/verdict.ts`, flow-aware retry policy in `src/config.ts`, and reopen dispatch in `src/phases/runner.ts`. Do not touch runner backends under `src/runners/*`.

**Open question disposition for this plan:**
- `Q1` / `Q4` resolved: keep `scope` runtime-only and do **not** extend `events.jsonl` in this slice. Post-ship measurement will use persisted `gate-7-raw.txt` verdict artifacts, which keeps this PR schema-neutral and aligned with spec R5.
- `Q2` resolved: implement `GATE_RETRY_LIMIT_LIGHT = 5` and `GATE_RETRY_LIMIT_FULL = 3` exactly as specified.
- `Q3` explicitly deferred: no hard rollback threshold is added in this PR. Follow-up dogfooding should inspect Gate 7 raw verdicts for false fast-paths before any policy rollback.
- `Q5` resolved: remove the old `GATE_RETRY_LIMIT` export rather than keeping a deprecated alias.

**Execution note:** No UI or visual asset changes are in scope, so no screenshot/visual verification task is required.

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/context/assembler.ts` | Modify | Add the REJECT-only scope-tagging contract to `REVIEWER_CONTRACT_BASE`. |
| `src/types.ts` | Modify | Introduce `Scope` type and add optional `scope` to `GateOutcome`. |
| `src/phases/verdict.ts` | Modify | Parse `Scope:` from the `## Verdict`-to-EOF scan window and thread it through `buildGateResult`. |
| `src/config.ts` | Modify | Replace the single retry constant with full/light constants plus `getGateRetryLimit(flow)`. |
| `src/phases/runner.ts` | Modify | Use flow-aware retry limits and add the light+gate7+`scope=impl` reopen override. |
| `tests/context/reviewer-contract.test.ts` | Modify | Assert the shared contract includes the new scope-tagging stanza. |
| `tests/phases/gate.test.ts` | Modify | Add parser coverage for the scope extraction contract and fallbacks. |
| `tests/config.test.ts` | Add | Cover `getGateRetryLimit('full'|'light')`. |
| `tests/phases/runner.test.ts` | Modify | Cover fast-path reopen behavior, fallback behavior, and `gate_retry.retryLimit` emission. |
| `CLAUDE.md` | Modify | Update the open-issues note for retry-storm status after this policy lands. |
| `docs/HOW-IT-WORKS.md` | Modify | Document light-flow Gate 7 scope-aware reopen behavior and retry-limit split. |

## Task 1: Add Scope Tagging Contract And Verdict Parsing

**Files:**
- `src/context/assembler.ts`
- `src/types.ts`
- `src/phases/verdict.ts`
- `tests/context/reviewer-contract.test.ts`
- `tests/phases/gate.test.ts`

- [ ] Add `export type Scope = 'design' | 'impl' | 'mixed'` in `src/types.ts` and extend `GateOutcome` with `scope?: Scope`.
- [ ] Extend `REVIEWER_CONTRACT_BASE` with the exact REJECT-only scope-tagging stanza from spec R1, including the note that only Phase 7 dispatch is affected.
- [ ] Update `parseVerdict` so it still finds the verdict token exactly as today, but now also scans from the line after `## Verdict` through EOF for the first case-insensitive `Scope: design|impl|mixed` match. Ignore scope on APPROVE and leave it `undefined` on missing/invalid tokens.
- [ ] Update `buildGateResult` to return the parsed `scope` on verdict results so runner logic can consume it without reparsing raw output.
- [ ] Add parser tests for:
  - REJECT + `Scope: impl|design|mixed`
  - lowercase `scope: impl`
  - missing `Scope:`
  - invalid `Scope: bogus`
  - APPROVE + `Scope: impl` ignored
  - `Scope:` inside `## Comments` after `## Verdict`
  - `Scope:` before `## Verdict` only
- [ ] Add a reviewer-contract assertion that the shared prompt preamble contains the scope-tagging rules.

**Acceptance criteria:**
- Every gate prompt includes the scope-tagging rule once via `REVIEWER_CONTRACT_BASE`.
- `parseVerdict()` returns `scope` only for REJECT verdicts with a valid token in the allowed scan window.
- Missing or malformed scope tokens remain backward-compatible (`scope === undefined`).

**Verification:**

```bash
node_modules/.bin/vitest run tests/context/reviewer-contract.test.ts tests/phases/gate.test.ts
```

## Task 2: Make Retry Limits Flow-Aware

**Files:**
- `src/config.ts`
- `src/phases/runner.ts`
- `tests/config.test.ts`
- `tests/phases/runner.test.ts`

- [ ] Replace `GATE_RETRY_LIMIT` with `GATE_RETRY_LIMIT_FULL = 3`, `GATE_RETRY_LIMIT_LIGHT = 5`, and `getGateRetryLimit(flow)`.
- [ ] Update every runtime use in `src/phases/runner.ts` to call `getGateRetryLimit(state.flow)` for warning text, retry gating, force-pass threshold, escalation text, and `gate_retry.retryLimit`.
- [ ] Remove imports/usages of the legacy constant from tests and replace them with the new helper or explicit full/light expectations.
- [ ] Add `tests/config.test.ts` with the two canonical assertions: full returns 3, light returns 5.
- [ ] Extend runner/event tests so `gate_retry.retryLimit` is asserted as `5` for light flow and `3` for full flow.

**Acceptance criteria:**
- No production code path uses the removed `GATE_RETRY_LIMIT` symbol.
- Light flow gets a 5-attempt budget; full flow remains at 3.
- `gate_retry` events emit the effective flow-specific limit without schema changes.

**Verification:**

```bash
node_modules/.bin/vitest run tests/config.test.ts tests/phases/runner.test.ts
```

## Task 3: Route Light Gate 7 `scope=impl` Rejects Back To Phase 5

**Files:**
- `src/phases/runner.ts`
- `tests/phases/runner.test.ts`

- [ ] Thread `result.scope` from `handleGatePhase` into `handleGateReject`, extending the runner-side function signature once instead of reparsing `rawOutput` in dispatch code.
- [ ] In `handleGateReject`, compute the default reopen target via `getReopenTarget(state.flow, phase)` and then override it only when `state.flow === 'light' && phase === 7 && scope === 'impl'`.
- [ ] Preserve the existing light-flow Gate 7 reset behavior in both light Gate 7 reopen cases: reset phases 5 and 6 to pending, invalidate `phaseCodexSessions['7']`, delete Gate 7 sidecars, and create `carryoverFeedback` for Phase 5 delivery.
- [ ] Ensure the fast-path does **not** touch `state.phases['1']`; that is the behavioral change under test.
- [ ] Keep all other combinations on the legacy route:
  - light + gate 7 + `scope=design`
  - light + gate 7 + `scope=mixed`
  - light + gate 7 + `scope=undefined`
  - full + gate 7 + any scope
  - gate 2 / gate 4 regardless of scope
- [ ] Add runner integration tests for the five spec-mandated cases plus one `gate_retry` emission assertion for a light-flow reject.

**Acceptance criteria:**
- Only light-flow Gate 7 REJECTs with `scope === 'impl'` reopen Phase 5 directly.
- All fallback paths remain behaviorally identical to pre-change routing.
- Carryover feedback and gate-session invalidation still happen on light Gate 7 REJECTs.

**Verification:**

```bash
node_modules/.bin/vitest run tests/phases/runner.test.ts -t "handleGateReject|gate_retry"
```

## Task 4: Update Operator Docs And Record The Measurement Strategy

**Files:**
- `CLAUDE.md`
- `docs/HOW-IT-WORKS.md`

- [ ] Update `CLAUDE.md` issue tracking so the retry-storm item reflects the new shipped mitigation: scope-aware light Gate 7 reopen plus a larger light retry budget.
- [ ] Update the Light Flow documentation in `docs/HOW-IT-WORKS.md` so it explicitly states:
  - Gate 7 REJECT with `Scope: impl` reopens Phase 5
  - Gate 7 REJECT with `Scope: design|mixed|missing` still reopens Phase 1
  - light flow uses a retry limit of 5 while full flow stays at 3
- [ ] Add one short note in docs that rollout analysis for scope quality uses persisted Gate 7 raw verdict artifacts, not `events.jsonl`, so the runtime/event schema remains unchanged in this slice.

**Acceptance criteria:**
- Operator-facing docs describe the new routing rule without implying any `events.jsonl` schema change.
- The plan’s Q1/Q4 decision is reflected in repo documentation instead of being left implicit.

**Verification:**

```bash
rg -n "Scope: impl|retry limit of 5|Gate 7 REJECT|raw verdict" CLAUDE.md docs/HOW-IT-WORKS.md
```

## Task 5: Run Final Regression Pass And Ship

**Files:** none beyond outputs generated by the build.

- [ ] Run the focused regression suites for parser, config, contract, and runner behavior.
- [ ] Run the full test suite.
- [ ] Run `tsc --noEmit`.
- [ ] Run the production build so `dist/` stays current for harness consumers.
- [ ] Review `git diff --stat` to confirm the change stays inside the file map above.
- [ ] Commit with a `plan:` subject only if Phase 3 output needs to be snapshotted before handoff.

**Acceptance criteria:**
- Focused tests, full tests, typecheck, and build all pass.
- No live harness smoke run is required for this slice; integration coverage is sufficient for dispatch correctness.
- Any post-merge rollout monitoring uses Gate 7 raw verdict artifacts and is explicitly outside this implementation PR.

**Verification:**

```bash
node_modules/.bin/vitest run
node_modules/.bin/tsc --noEmit
node_modules/.bin/tsc && node scripts/copy-assets.mjs
git diff --stat
```

## Dependency Order

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 5

Task 1 must land before Task 3 because runner dispatch consumes parsed `scope`. Task 2 is independent of Task 1 in code shape, but keep it before Task 3 so the runner edits happen once. Task 4 can be prepared in parallel but should merge after behavior is final. Task 5 is final only.

## Out Of Scope / Explicit Defers

- Do not add `scope` to `gate_verdict` or any other event in this slice.
- Do not alter full-flow reopen policy beyond replacing the retry-limit lookup.
- Do not change `src/runners/*`, `src/context/playbooks/*`, or introduce CLI flags/env overrides for retry limits.
- Do not codify a rollback threshold in code or docs yet; revisit after dogfood data exists.
