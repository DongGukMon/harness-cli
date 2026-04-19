# Light Flow Pre-Impl Gate (Phase 2) — Design Spec

- Date: 2026-04-19
- Status: Phase 1 output (harness light flow, runId `2026-04-19-untitled-2`)
- Scope: `harness start --light` — activate Phase 2 Codex review slot *before* implementation
- Supersedes / amends: [docs/specs/2026-04-18-light-flow-design.md](2026-04-18-light-flow-design.md) (ADR-4 keeps the P1-reopen-on-gate7 rule; ADR-15 below adds a new pre-impl gate)
- Related decisions: `.harness/2026-04-19-untitled-2/decisions.md`
- Implementation: **design only in this Phase 1; implementation plan produced in Phase 3**

---

## Context & Decisions

### Why this work

Today's light flow is `P1 design → P5 impl → P6 verify → P7 eval-gate`. Codex independent review happens exactly once, at P7. Because P7 runs after implementation, a design-level reject there triggers a `P7 REJECT → P1 reopen → P5 re-execute` chain in which the entire implementation is discarded and redone. Dog-food runs have observed this chain repeatedly. The "one gate" philosophy of the light flow was chosen to minimize Codex calls, but it deliberately trades away the cheapest review — the one that runs *before* any impl time is spent.

**Solution:** activate the existing Phase 2 slot (currently `'skipped'` in light flow) so Codex reviews the combined design doc *before* Phase 5 runs. Full flow is not touched. The state schema already has `phases['2']`, `phaseCodexSessions['2']`, and `gateRetries['2']` reserved — light previously filled them with `'skipped'` / `null` / `0`. This spec flips that to active for newly-created light runs only.

### What changes in the flow

```
BEFORE (light, today):
  P1 design → [P2/P3/P4 skipped] → P5 impl → P6 verify → P7 eval-gate
                                                              │
                                         P7 REJECT → P1 reopen ┘
                                                     └→ P5 → P6 → P7

AFTER (light, this spec):
  P1 design → P2 pre-impl review → [P3/P4 skipped] → P5 impl → P6 verify → P7 eval-gate
                      │                                                         │
                      P2 REJECT → P1 reopen ┐           P7 REJECT → P1 reopen ──┤
                                            └→ P2 → P5 ...              (existing behavior retained)
```

- **Added**: single Codex gate at P2 reviewing the combined design doc (spec + Implementation Plan section).
- **Unchanged**: P1 output shape; P3/P4 remain `'skipped'`; P5/P6/P7 behavior; full-flow behavior.
- **Unchanged for existing runs**: runs created before this spec ships have `phases['2']='skipped'` persisted in `state.json`; forward migration does **not** flip that to `'pending'`, so resume behavior is identical.

### Key Decisions

| ID | Decision |
|----|----------|
| **ADR-15** | Light flow activates Phase 2 Codex review with combined-doc input (`<spec>` slot only; no `<plan>` slot — same precedent as light P7). |
| **ADR-16** | Light P2 REJECT always reopens Phase 1 (`getReopenTarget(light, 2) === 1`, already the default). Scope-aware routing is **not** introduced at P2 — combined doc can't cleanly split design vs impl scope. |
| **ADR-17** | Light P2 retry limit is **3** (same as full P2). Light P7 retry limit stays at **5** (status quo). Asymmetry preserved; `getGateRetryLimit` gains a `gate?: GatePhase` parameter so callers can resolve per-gate. (Open Question #2 flags whether P7 should also drop to 3.) |
| **ADR-18** | Phase 2 feedback uses `pendingAction.feedbackPaths` only. **No `carryoverFeedback`** — feedback only travels one step (P2 → P1-reopen → P2), and P2 re-reads the updated spec artifact directly on retry. |
| **ADR-19** | Forward-only state migration: existing light runs keep `phases['2']='skipped'`; only new light runs get `phases['2']='pending'`. Decision point is `createInitialState`, not `migrateState`. |
| **ADR-20** | New reviewer rubric `FIVE_AXIS_DESIGN_GATE_LIGHT` covers spec + plan axes in a single 4-axis block. Reuse the existing full-flow SPEC+PLAN rubrics by concatenation is tempting but creates an 8-axis overload; a purpose-built rubric is cleaner and matches the combined-doc artifact shape. |
| **ADR-21** | Slash-command integration is **out of scope** — the `/harness` skill was removed 2026-04-19 (CLAUDE.md). Only CLI + phase runner + assembler change here. |

---

## Complexity

Medium — single new gate activation touching `config.ts`, `state.ts`, `assembler.ts`, runner-level REJECT routing, plus doc updates; no new subsystem.

---

## Requirements

### R1 — CLI surface is unchanged

`harness start --light "…"` keeps the same flag set. No new flag is introduced. Users do not opt in to the pre-impl gate — it is the only light mode after this change ships.

### R2 — State initialization (new light runs)

`createInitialState(runId, task, base, auto, logging, flow='light', …)` initializes `phases` with `'2': 'pending'` (instead of `'skipped'`). All other light-mode phase statuses (`'3': 'skipped'`, `'4': 'skipped'`) are unchanged.

### R3 — State migration (existing runs)

`migrateState()` **must not** flip `phases['2']` from `'skipped'` to `'pending'`. Existing light runs resume with their persisted `'skipped'` and the loop walks over them as it does today. No state.json schema version bump. This is forward-only: only runs created by post-change `createInitialState` have P2 active.

### R4 — Phase defaults

`LIGHT_PHASE_DEFAULTS[2] = 'codex-high'` is added. `LIGHT_REQUIRED_PHASE_KEYS` gains `'2'`.  `getPhaseDefaults('light')` then returns `{1: 'opus-high', 2: 'codex-high', 5: 'sonnet-high', 7: 'codex-high'}`. `promptModelConfig` iteration set expands by one key; no other UI behavior change.

### R5 — Gate prompt assembly

`buildGatePromptPhase2(state, cwd)` gains a `state.flow === 'light'` branch:

```ts
if (state.flow === 'light') {
  return (
    REVIEWER_CONTRACT_BASE + FIVE_AXIS_DESIGN_GATE_LIGHT +
    buildLifecycleContext(2, 'light') +
    `<spec>\n${specResult.content}\n</spec>\n`
  );
}
// existing full-flow path
return (
  REVIEWER_CONTRACT_BY_GATE[2] +
  buildLifecycleContext(2) +
  `<spec>\n${specResult.content}\n</spec>\n`
);
```

`buildLifecycleContext(2, flow)` extends to accept the flow parameter (matching the existing Phase 7 signature) and returns a light-aware stanza explaining "This is Gate 2 of a 5-phase light harness lifecycle (P1 design → P2 pre-impl review → P5 impl → P6 verify → P7 eval). The combined design spec contains the Implementation Plan section; there is no separate plan artifact. Implementation has not yet been produced." The full-flow stanza is unchanged.

`buildResumeSections(phase, state, cwd)` for `phase === 2` is already correct for light: it emits only `<spec>`, no `<plan>`, no eval report — identical to full-flow P2 resume. No change needed.

### R6 — New rubric: `FIVE_AXIS_DESIGN_GATE_LIGHT`

Added to `src/context/assembler.ts`:

```
## Five-Axis Evaluation (Phase 2 — design gate, light flow)
평가 대상은 결합 design spec (spec + Implementation Plan 섹션이 한 문서에 있음). 4축 적용:
1. Correctness — 요구사항/비요구사항/경계조건/성공기준 명시; plan 섹션이 spec 요구사항을 커버?
2. Architecture — 태스크 분해가 수직 슬라이스이고 의존성 순서가 명확?
3. Readability — 섹션 구성이 명확하고 모호 표현이 없는가?
4. Scope — 단일 구현 세션으로 분해 가능한 크기? 여러 독립 프로젝트 섞이지 않음?

Additional required check: spec MUST contain an explicit '## Open Questions' section. Missing/empty-without-rationale → P1.
Note: light flow에는 별도 plan 아티팩트가 없다. plan 파일 부재를 finding으로 올리지 말 것. 구현(Phase 5) 아직 수행되지 않음 — 구현 관련 이슈는 Phase 7에서 다룬다.
```

Severity/Scope tagging and P0/P1 approval rules are inherited from `REVIEWER_CONTRACT_BASE`.

### R7 — REJECT routing

`getGateRejectReopenTarget(state, phase=2, scope)` reuses the existing helper. `getReopenTarget(flow='light', gate=2)` → `1` (already the code path). The light+P7+scope='impl' → P5 carve-out does **not** extend to P2. All P2 REJECT outcomes route to P1 reopen regardless of `Scope:` tag.

### R8 — Retry limit per gate

`getGateRetryLimit(flow: FlowMode, gate?: GatePhase): number` signature becomes gate-aware:

```ts
export function getGateRetryLimit(flow: FlowMode, gate?: GatePhase): number {
  if (flow === 'light' && gate === 2) return GATE_RETRY_LIMIT_FULL;   // 3
  return flow === 'light' ? GATE_RETRY_LIMIT_LIGHT : GATE_RETRY_LIMIT_FULL;
}
```

All existing call sites (`runner.ts::handleGateReject`, `runner.ts::handleGateEscalation`) pass the current `phase` as `gate`. Default behavior (no gate argument) is unchanged, so unrelated callers keep working.

### R9 — Phase loop is unchanged structurally

`runPhaseLoop` already dispatches on `isGatePhase(phase)` for `{2,4,7}` and walks past `'skipped'` phases. The only flow-level effect of R2 is that `phases['2']==='pending'` now falls through to `handleGatePhase(2, …)` for light runs. No new branch in the loop is required.

### R10 — Logging / events

Phase 2 emissions in light runs reuse the existing events with no schema extension:

- `phase_start` / `gate_verdict` / `gate_retry` / `gate_error` carry `phase: 2` exactly as full flow does.
- `preset.id === 'codex-high'` for new runs (R4 default).
- `state.flow` is not added to gate events (already available via `session_start`'s contextual inference if needed later — out of scope here).

### R11 — Artifact inputs visible to Phase 2

`state.artifacts.spec` → combined doc at `docs/specs/<runId>-design.md` (already the light artifact layout). `state.artifacts.plan` is `''` for light; the light branch in `buildGatePromptPhase2` must not read it. Asserted by R5's branching.

### R12 — Docs synchronized with behavior

Same-PR doc updates:

- `docs/specs/2026-04-18-light-flow-design.md`: add "See also: 2026-04-19-untitled-2-design.md — adds ADR-15/16/17 pre-impl gate" note; do **not** mutate ADR-4 (P1 reopen on P7 REJECT still holds).
- `docs/HOW-IT-WORKS.md` / `.ko.md`: light-flow section replaces the 4-phase diagram with the 5-slot diagram (P2 active).
- `CLAUDE.md`: project one-liner updates from "4-phase 경량 모드(P1 → P5 → P6 → P7)" to "5-slot 경량 모드(P1 → P2 → P5 → P6 → P7)".

---

## Non-Requirements (Out of Scope)

- **Full flow changes.** Full P1–P7 behavior, defaults, rubrics, and retry limits are untouched.
- **Plan gate (P3/P4) in light.** No separate plan artifact and no P4 review — light keeps its single-document design model.
- **Automatic complexity-based gate skip.** Whether a `Complexity: Small` spec should bypass P2 is a future question. This spec always runs P2 on new light runs.
- **State schema breaking change.** `PhaseStatus` union, `HarnessState` shape, `phaseCodexSessions['2']`, `gateRetries['2']` — all preserved.
- **Resume of pre-change runs.** Runs created before the change keep `phases['2']='skipped'` permanently. No retroactive migration.
- **Slash-command (`/harness`) updates.** The skill was removed 2026-04-19.
- **`carryoverFeedback` extension.** P2 feedback does not chain across more than one phase hop.
- **P7 retry-limit change.** Left at 5 (status quo). Flagged as Open Question #2.

---

## Invariants

Any reviewer or implementer can verify these by grep / local test without running the harness:

1. `getReopenTarget('light', 2) === 1` — grep `src/config.ts` for the `getReopenTarget` body.
2. `getGateRetryLimit('light', 2) === 3` and `getGateRetryLimit('light', 7) === 5`.
3. `LIGHT_REQUIRED_PHASE_KEYS` includes `'2'` — string match.
4. `LIGHT_PHASE_DEFAULTS[2] === 'codex-high'`.
5. `createInitialState(flow='light')` produces `phases['2'] === 'pending'` and `phases['3'] === phases['4'] === 'skipped'`.
6. `migrateState()` on a pre-change state.json with `phases['2']==='skipped'` returns a state object whose `phases['2']` is still `'skipped'`.
7. `buildGatePromptPhase2(state)` with `state.flow==='light'` returns a string that contains the substring `FIVE_AXIS_DESIGN_GATE_LIGHT` marker (e.g. `"Phase 2 — design gate, light flow"`) and does **not** read `state.artifacts.plan`.
8. `buildLifecycleContext(2, 'light')` mentions `"5-phase light harness lifecycle"` and `"combined design spec"`.
9. Existing full-flow gate2 output is byte-identical to pre-change (snapshot fixture).

---

## Success Criteria

1. **Unit:** A new test case `createInitialState('light')` asserts `phases['2']='pending'`. Companion test on `migrateState` with a seeded legacy state asserts `'skipped'` is preserved.
2. **Unit:** `getGateRetryLimit` test matrix for `(full, undefined)`, `(full, 2)`, `(light, 2)`, `(light, 7)`, `(light, undefined)`.
3. **Unit:** `assembleGatePrompt(2, state_light)` snapshot: contains the new rubric string; does not contain `<plan>`; contains light lifecycle stanza. The existing full-flow snapshot for `(2, state_full)` is unchanged.
4. **Integration (light path):** runner test stepping a seeded run through `phases: {1:done, 2:pending, 3:skipped, 4:skipped, 5:pending, 6:pending, 7:pending}` verifies that after a mocked `APPROVE` at P2 the loop advances directly to P5 (skipping 3 and 4).
5. **Integration (reject):** mocked `REJECT + Scope: design` at P2 → state transitions to `currentPhase=1`, `phases['1']='pending'`, `phaseReopenFlags['1']===true`, `pendingAction.feedbackPaths` non-empty.
6. **Regression:** `pnpm tsc --noEmit`, `pnpm vitest run`, `pnpm build` all pass. Full-flow tests are untouched.

---

## Risks

| ID | Risk | Mitigation |
|----|------|-----------|
| R-A | Light P2 adds a Codex call → per-run cost increases by one high-effort review | Expected & intended. The alternative (post-impl P7 REJECT → full re-impl chain) is strictly more expensive. Mitigated further by R8 retry limit 3. |
| R-B | New rubric drifts from full-flow SPEC/PLAN rubrics over time | Keep rubric text adjacent to the existing `FIVE_AXIS_SPEC_GATE` / `FIVE_AXIS_PLAN_GATE` constants so edits land together. |
| R-C | `getGateRetryLimit` signature change breaks an external caller | Default parameter keeps old behavior (no gate argument → flow-level fallback). Add a compile-time test that the old call style still type-checks. |
| R-D | Existing light run resumes and the user expects the new P2 to run | Documented: forward-only. Release note in the merge PR body must state this explicitly. |
| R-E | Reviewer at P2 over-reaches into impl territory (flags missing tests/code) | Mitigated by the rubric's note "구현(Phase 5) 아직 수행되지 않음 — 구현 관련 이슈는 Phase 7에서 다룬다" and by `buildLifecycleContext(2, 'light')`. |
| R-F | The combined-doc approach makes `Scope: design | impl | mixed` tagging noisy at P2 | ADR-16: ignore scope tag at P2. All REJECTs route to P1. Open Question #4 reconsiders. |
| R-G | `phaseCodexSessions['2']` now gets populated; resume-from-error path already handles this identically to full flow | No new logic. Covered by existing Phase 2 session-invalidate tests. |

---

## File-level Change List (preview for Phase 3)

The Phase 3 plan will break these into tasks; listed here for spec correctness only.

### Modify

| File | Change |
|---|---|
| `src/config.ts` | `LIGHT_PHASE_DEFAULTS[2] = 'codex-high'`; `LIGHT_REQUIRED_PHASE_KEYS = ['1','2','5','7']`; `getGateRetryLimit(flow, gate?)` per-gate signature |
| `src/state.ts` | `createInitialState`: light branch sets `phases['2']='pending'`. `migrateState`: no change (explicit comment: forward-only). |
| `src/context/assembler.ts` | new `FIVE_AXIS_DESIGN_GATE_LIGHT`; `buildLifecycleContext(phase, flow)` signature extended; `buildGatePromptPhase2` adds `state.flow === 'light'` branch |
| `src/phases/runner.ts` | `handleGateReject` + `handleGateEscalation` pass `phase` as second arg to `getGateRetryLimit` |
| `docs/specs/2026-04-18-light-flow-design.md` | cross-reference note (non-mutating) |
| `docs/HOW-IT-WORKS.md` + `.ko.md` | light-flow diagram: 4-phase → 5-slot |
| `CLAUDE.md` | project one-liner updates |

### Create

| File | Purpose |
|---|---|
| `docs/specs/2026-04-19-untitled-2-design.md` | This spec |
| `.harness/2026-04-19-untitled-2/decisions.md` | Decision log with trade-offs and alternatives |

### Delete

None.

---

## Open Questions

These are ambiguities the Gate 2 reviewer should flag or confirm:

1. **Rubric shape — 4 axes vs carry-over of both full rubrics.** This spec uses a new 4-axis `FIVE_AXIS_DESIGN_GATE_LIGHT` rubric (Correctness / Architecture / Readability / Scope). Alternative: concatenate the existing `FIVE_AXIS_SPEC_GATE` (3 axes) and `FIVE_AXIS_PLAN_GATE` (4 axes) producing a 7-axis block. The bespoke 4-axis choice is cleaner but deviates from the "five-axis" naming convention. Acceptable?
2. **Light P7 retry limit.** ADR-17 keeps it at 5; task intent text says "재검토". Recommendation: lower to 3 to match P2 now that design issues are caught earlier, but only after one dog-food cycle shows P7 REJECT frequency dropping. Defer or decide now?
3. **Scope-tag handling at P2 light.** ADR-16 ignores the `Scope:` tag and always routes REJECT to P1. If a reviewer ever tags `Scope: impl` at P2 (unexpected since impl doesn't exist yet), current spec still reopens P1. Should we warn/log this anomaly, or is silent P1-reopen acceptable?
4. **Combined-doc size at P2 vs size limits.** `MAX_PROMPT_SIZE_KB=500` / `MAX_FILE_SIZE_KB=200` bounds apply. Is an explicit size-specific pre-check at P2 needed, or does the existing `assembleGatePrompt` size guard suffice?
5. **Backward-compat release-note wording.** Existing light runs keep `phases['2']='skipped'` forever. Should the CLI emit a one-time info line at resume time when it detects this legacy shape, or is a changelog-only note enough?

---

## Acceptance (self-check for this Phase 1 output)

- [x] `## Context & Decisions` at top
- [x] `## Complexity` present with one of {Small, Medium, Large} — value: `Medium`
- [x] `## Open Questions` non-empty (5 items)
- [x] Scope and non-requirements explicitly separated
- [x] Full flow untouched (stated + verified via file-level change list)
- [x] Forward-only migration stated
- [x] Retry-limit decision explicit (ADR-17)
- [x] Rubric, lifecycle context, reopen target all pinned by invariants
