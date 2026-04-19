# Gate Retry Policy Implementation Plan

> `superpowers:writing-plans` is not available in this session, so this plan is written manually with the same contract: vertical slices, concrete acceptance criteria, and executable verification.

**Spec:** `docs/specs/2026-04-19-group-f-gate-retry-design.md`

**Decision log:** `.harness/2026-04-19-group-f-gate-retry/decisions.md`

**Previous gate feedback incorporated:** `.harness/2026-04-19-group-f-gate-retry/gate-4-feedback.md`

**Goal:** Add a scope-aware light-flow Gate 7 fast-path for `REJECT + Scope: impl`, split gate retry limits by flow (`full=3`, `light=5`), and keep every other gate/flow path behaviorally unchanged.

**Architecture guardrails:**
- Keep all logic inside the existing prompt/parser/runner/config layers: `src/context/assembler.ts`, `src/phases/verdict.ts`, `src/phases/runner.ts`, `src/config.ts`, `src/types.ts`.
- Do not change `src/runners/*` or `src/context/playbooks/*`.
- Treat this as a vertical slice: contract -> parser/types -> retry policy -> dispatch -> docs/regression.

**Open question disposition for this plan:**
- `Q1` / `Q4` resolved in this slice: keep `scope` runtime-only and do not change `events.jsonl`. Post-ship measurement will sample the persisted Gate 7 verdict-raw artifact (`.harness/<runId>/gate-7-raw.txt`) rather than adding `gate_verdict.scope`.
- `Q2` resolved exactly as specified: `GATE_RETRY_LIMIT_LIGHT = 5`, `GATE_RETRY_LIMIT_FULL = 3`.
- `Q3` explicitly deferred: no rollback threshold is encoded in code or docs here; follow-up dogfooding should inspect Gate 7 verdict-raw artifacts for false fast-paths.
- `Q5` resolved exactly as specified: remove `GATE_RETRY_LIMIT` rather than keeping a deprecated alias.

**Execution note:** There are no UI or visual changes in scope, so the checklist does not need a screenshot/manual-visual check.

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/context/assembler.ts` | Modify | Add the REJECT-only scope-tagging stanza to `REVIEWER_CONTRACT_BASE`. |
| `src/types.ts` | Modify | Add `Scope` and thread optional `scope` through `GateOutcome`. |
| `src/phases/verdict.ts` | Modify | Parse `Scope:` from the `## Verdict`-to-EOF scan window and return it only for REJECT verdicts. |
| `src/config.ts` | Modify | Replace the single retry constant with flow-aware constants plus `getGateRetryLimit(flow)`. |
| `src/phases/runner.ts` | Modify | Use flow-aware retry limits and add the light+gate7+`scope=impl` reopen override. |
| `tests/context/assembler.test.ts` | Modify | Assert the shared reviewer contract includes the new scope-tagging stanza. |
| `tests/phases/verdict.test.ts` | Modify | Add the spec-mandated `parseVerdict()` cases here so parser coverage lives in the canonical file named by the spec. |
| `tests/config.test.ts` | Add or modify | Cover `getGateRetryLimit('full') === 3` and `getGateRetryLimit('light') === 5`. |
| `tests/phases/runner.test.ts` | Modify | Cover fast-path routing, fallback routing, session/sidecar resets, and `gate_retry.retryLimit` emission. |
| `CLAUDE.md` | Modify | Update the retry-storm/open-issues note to reflect the shipped mitigation. |
| `docs/HOW-IT-WORKS.md` | Modify | Document the Gate 7 scope-aware reopen rule, retry-limit split, and raw-artifact measurement choice. |

## Task 1: Add The Scope Contract, Type, And Verdict Parser

**Files:**
- `src/context/assembler.ts`
- `src/types.ts`
- `src/phases/verdict.ts`
- `tests/context/assembler.test.ts`
- `tests/phases/verdict.test.ts`

- [ ] Add `export type Scope = 'design' | 'impl' | 'mixed'` and extend `GateOutcome` with `scope?: Scope`.
- [ ] Extend `REVIEWER_CONTRACT_BASE` with the exact REJECT-only scope-tagging stanza from spec R1, including the note that only Phase 7 dispatch uses the signal.
- [ ] Update `parseVerdict()` to keep its existing verdict detection, then scan from the line after `## Verdict` through EOF for the first case-insensitive `Scope: design|impl|mixed` match.
- [ ] Ignore `Scope:` on APPROVE, and leave `scope` undefined for missing or invalid tokens so the fallback route stays backward-compatible.
- [ ] Thread the parsed `scope` through `buildGateResult()` so runner code can consume it without reparsing stdout.
- [ ] Add or migrate parser coverage into `tests/phases/verdict.test.ts` for:
  - REJECT + `Scope: impl`
  - REJECT + `Scope: design`
  - REJECT + `Scope: mixed`
  - REJECT + lowercase `scope: impl`
  - REJECT + missing `Scope:`
  - REJECT + invalid `Scope: bogus`
  - APPROVE + `Scope: impl` ignored
  - REJECT + `Scope:` inside `## Comments` after `## Verdict`
  - REJECT + `Scope:` only before `## Verdict`
- [ ] Add an assembler assertion that the shared reviewer prompt includes the new scope-tagging rules once via `REVIEWER_CONTRACT_BASE`.

**Acceptance criteria:**
- Every gate prompt includes the scope-tagging rule via the shared base contract.
- `parseVerdict()` returns `scope` only for REJECT verdicts with a valid token in the allowed scan window.
- Missing or malformed scope tokens still behave like the old implementation (`scope === undefined`).

**Verification:**

```bash
/Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/gate-retry-policy/node_modules/.bin/vitest run tests/context/assembler.test.ts tests/phases/verdict.test.ts
```

## Task 2: Make Gate Retry Limits Flow-Aware

**Files:**
- `src/config.ts`
- `src/phases/runner.ts`
- `tests/config.test.ts`
- `tests/phases/runner.test.ts`

- [ ] Replace `GATE_RETRY_LIMIT` with `GATE_RETRY_LIMIT_FULL = 3`, `GATE_RETRY_LIMIT_LIGHT = 5`, and `getGateRetryLimit(flow)`.
- [ ] Replace every `GATE_RETRY_LIMIT` read in `src/phases/runner.ts` with `getGateRetryLimit(state.flow)` so retry gating, warning text, escalation text, force-pass behavior, and `gate_retry.retryLimit` all use the effective limit.
- [ ] Remove legacy constant imports/usages from tests and switch them to the new helper or explicit full/light expectations.
- [ ] Add `tests/config.test.ts` coverage for the two canonical cases: full returns 3, light returns 5.
- [ ] Extend runner logging assertions so `gate_retry.retryLimit` is `5` for light flow and `3` for full flow.

**Acceptance criteria:**
- No production code path still depends on the removed `GATE_RETRY_LIMIT` symbol.
- Full flow remains at 3 retries; light flow uses 5 retries.
- `gate_retry` events emit the effective limit without any schema change.

**Verification:**

```bash
/Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/gate-retry-policy/node_modules/.bin/vitest run tests/config.test.ts tests/phases/runner.test.ts
```

## Task 3: Route Light Gate 7 `scope=impl` Rejects Back To Phase 5

**Files:**
- `src/phases/runner.ts`
- `tests/phases/runner.test.ts`

- [ ] Thread `result.scope` from the gate result into `handleGateReject()` instead of reparsing raw output in dispatch code.
- [ ] Compute the normal reopen target with `getReopenTarget(state.flow, phase)` and override it only when `state.flow === 'light' && phase === 7 && scope === 'impl'`.
- [ ] Preserve the existing light Gate 7 reset mechanics in both reopen routes: Phase 5 pending, Phase 6 pending, Gate 7 session cleared, Gate 7 sidecars deleted, and `carryoverFeedback.deliverToPhase === 5`.
- [ ] Ensure the fast-path does not modify `state.phases['1']`; that is the behavior change under test.
- [ ] Keep all other combinations on the old route:
  - light + gate 7 + `scope=design`
  - light + gate 7 + `scope=mixed`
  - light + gate 7 + `scope=undefined`
  - full + gate 7 + any scope
  - gate 2 or gate 4 regardless of scope
- [ ] Add runner tests for the five spec-mandated routing cases plus the light/full `gate_retry.retryLimit` assertions.

**Acceptance criteria:**
- Only light-flow Gate 7 REJECTs with `scope === 'impl'` reopen Phase 5 directly.
- All fallback paths stay behaviorally identical to the pre-change routing.
- Carryover feedback, sidecar cleanup, and Gate 7 session invalidation still happen on light Gate 7 REJECTs.

**Verification:**

```bash
/Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/gate-retry-policy/node_modules/.bin/vitest run tests/phases/runner.test.ts -t "handleGateReject|gate_retry"
```

## Task 4: Update Operator Docs And Record The Measurement Choice

**Files:**
- `CLAUDE.md`
- `docs/HOW-IT-WORKS.md`

- [ ] Update `CLAUDE.md` so the retry-storm issue entry reflects the shipped mitigation: light Gate 7 scope-aware reopen plus a light-only retry budget of 5.
- [ ] Update `docs/HOW-IT-WORKS.md` so the light-flow section states:
  - Gate 7 REJECT with `Scope: impl` reopens Phase 5
  - Gate 7 REJECT with `Scope: design|mixed|missing` still reopens Phase 1
  - light flow uses retry limit 5 while full flow remains 3
- [ ] Document the chosen Q1/Q4 answer explicitly: rollout analysis samples the persisted Gate 7 verdict-raw artifact (`gate-7-raw.txt`) instead of extending `events.jsonl`.
- [ ] Keep Q3 called out as deferred so operators do not infer a codified rollback threshold that does not exist.

**Acceptance criteria:**
- Operator-facing docs describe the routing split without implying any `events.jsonl` schema change.
- The measurement source is named consistently with the spec and concretized with the run-dir artifact path.

**Verification:**

```bash
/usr/bin/grep -nE "Scope: impl|Phase 7 REJECT|retry limit (of )?5|verdict-raw|gate-7-raw\.txt" CLAUDE.md docs/HOW-IT-WORKS.md
```

## Task 5: Run Final Regression Pass And Prepare Handoff

**Files:** none beyond generated build output.

- [ ] Run the focused regression suites for contract, parser, config, and runner routing.
- [ ] Run the full Vitest suite.
- [ ] Run TypeScript no-emit validation.
- [ ] Run the real production build entrypoint with `pnpm build` so the plan verifies the exact spec acceptance criterion.
- [ ] Confirm the resulting diff stays inside the file map above.
- [ ] Commit with a `plan:` message only if a snapshot is needed for handoff; otherwise leave the worktree uncommitted.

**Acceptance criteria:**
- Focused tests, full tests, typecheck, and `pnpm build` all pass.
- No extra event schema work or live harness smoke run is required for this slice.
- Post-ship monitoring remains an operational follow-up based on Gate 7 verdict-raw artifacts.

**Verification:**

```bash
/Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/gate-retry-policy/node_modules/.bin/vitest run tests/context/assembler.test.ts tests/phases/verdict.test.ts tests/config.test.ts tests/phases/runner.test.ts
/Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/gate-retry-policy/node_modules/.bin/vitest run
/Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/gate-retry-policy/node_modules/.bin/tsc --noEmit
pnpm build
git diff --stat
```

## Dependency Order

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 5

Task 1 must land before Task 3 because runner dispatch consumes parsed `scope`. Task 2 should land before Task 3 so `src/phases/runner.ts` is edited once for both retry policy and routing. Task 4 can be prepared in parallel once the Task 1/3 behavior is stable. Task 5 is last.

## Out Of Scope / Explicit Defers

- Do not add `scope` to `gate_verdict` or any other event in this slice.
- Do not change full-flow reopen behavior beyond using `getGateRetryLimit(state.flow)`.
- Do not change `src/runners/*`, `src/context/playbooks/*`, or add CLI/env overrides for retry limits.
- Do not encode a rollback threshold in code or docs yet; revisit after dogfood data exists.
