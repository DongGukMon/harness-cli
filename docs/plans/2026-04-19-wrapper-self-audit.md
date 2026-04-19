# Wrapper Self-Audit + P1-Only Triage Implementation Plan

## Header
**Spec:** `docs/specs/2026-04-19-wrapper-self-audit-and-p1-only-design.md` (requirements `R1-R6`, `R3a`, `R4a`, `R5a` at lines 114-129; success criteria `SC1-SC21` at lines 304-325; deferred split at lines 334-347).

**Goal:** Add pre-sentinel self-audit and P1-only retry triage to the Phase 1/3/5 wrapper skills, then lock the behavior with rendering-focused regression tests.

**Architecture:** Skill-text only, no runtime changes; all implementation work stays in wrapper markdown plus rendering tests, matching the spec non-goals at lines 104-108.

**Tech Stack:** TypeScript, pnpm, vitest, wrapper markdown assets under `src/context/skills/`, rendering coverage in `tests/context/skills-rendering.test.ts`.

**Scope note:** This plan covers only `src/context/skills/harness-phase-{1,3,5}-*.md`, `tests/context/skills-rendering.test.ts`, and conditional `dist/` rebuild output copied from those skills; it does not touch `src/context/assembler.ts` or any runtime code.

## File Map
| File | Action | Responsibility |
| --- | --- | --- |
| `src/context/skills/harness-phase-1-spec.md` | Modify | Add the Phase 1 pre-sentinel self-audit step plus single-feedback P1-only triage wording for `R1`, `R4`, `R4a`, `R6`, and absorbed Deferred `§9`/`§11`. |
| `src/context/skills/harness-phase-3-plan.md` | Modify | Add the Phase 3 pre-sentinel self-audit step plus single-feedback P1-only triage wording for `R2`, `R4`, `R4a`, `R6`, and absorbed Deferred `§8`/`§9`/`§11`. |
| `src/context/skills/harness-phase-5-implement.md` | Modify | Add the Phase 5 pre-sentinel self-audit step plus multi-feedback P1-only triage wording for `R3`, `R3a`, `R5`, `R5a`, `R6`, and absorbed Deferred `§9`/`§11`/`§12`. |
| `tests/context/skills-rendering.test.ts` | Modify | Add TDD-first rendering tests for `SC4-SC21`, the carryover-feedback edge case, the Phase 1/3 single-feedback invariant, and the existing invariants `INV1-INV5`. |
| `dist/context/skills/harness-phase-1-spec.md` | Regenerate if changed | Copy-on-build output from the Phase 1 skill asset during Task 5. |
| `dist/context/skills/harness-phase-3-plan.md` | Regenerate if changed | Copy-on-build output from the Phase 3 skill asset during Task 5. |
| `dist/context/skills/harness-phase-5-implement.md` | Regenerate if changed | Copy-on-build output from the Phase 5 skill asset during Task 5. |

No file creation or deletion is expected beyond this plan document itself.

## Deferred Pickup
The spec explicitly asks the plan phase to absorb Deferred `§6`, `§7`, `§8`, `§9`, `§11`, and `§12` rather than defer them again (`docs/specs/2026-04-19-wrapper-self-audit-and-p1-only-design.md:339-346`).

- `§6 (Goal #4 wording unify)` is absorbed in Task 4 and the Test Design section by using one phrase consistently: `regex-based rendering/grep tests`, not `snapshot/grep`.
- `§7 (carryoverFeedback test case)` is absorbed in Task 4 by adding a rendered Phase 5 test that merges `pendingAction.feedbackPaths` with `carryoverFeedback.paths` and drops missing carryover files.
- `§8 (Phase 1/3 single feedback invariant)` is absorbed in Task 4 by adding a rendering test that proves Phase 1 and Phase 3 expose only one retry feedback file even if multiple source paths exist.
- `§9 (unlabeled + structural)` is absorbed in Tasks 1-3 by refining triage text so unlabeled comments that would require structural rework go to the same deferred/escalation path instead of triggering restructuring in-place.
- `§11 (self-audit iterate-until-clean)` is absorbed in Tasks 1-3 by adding one explicit sentence to each self-audit block: rerun the same verification once after a fix, and do not create the sentinel until the rerun is clean.
- `§12 (R5a 동일 쟁점 정의)` is absorbed in Task 3 by refining the Phase 5 duplicate-issue rule to define sameness as `동일 파일/영역 + 동일 요구 변경(문구 차이 무관)`, then locked in Task 4 with a rendering test.

## Tasks
### Task 0: Preflight
- [ ] Confirm the worktree is clean, the baseline toolchain is green, and `dist/` starts fresh before any edits.
  Files touched: none.
  Steps:
  1. Run `git status --short` and require an empty result before editing.
  2. Run `pnpm tsc --noEmit` and `pnpm vitest run` to establish the branch-local green baseline for `SC1` and `SC2`. Record the current passed-test count as an **informational human note only** (not part of harness-verify); this plan's SC2 check is exit-code 0, and the human note ensures Task 5 only adds new tests without regressing existing ones.
  3. Run `pnpm build`; immediately rerun `git status --short` and require no `dist/` drift before source edits.
  Expected verification output: clean worktree before and after preflight build; no pre-existing typecheck, test, or build failures.
  Commit message: none.

### Task 1: Phase 1 wrapper skill — self-audit + P1-only triage
- [ ] Add Phase 1 self-audit and single-feedback P1-only triage via TDD, then commit the slice.
  Files touched: `src/context/skills/harness-phase-1-spec.md`, `tests/context/skills-rendering.test.ts`.
  Steps:
  1. Add failing tests first in `tests/context/skills-rendering.test.ts`:
     `it('phase 1 — self-audit step present in Process', ...)`
     `it('phase 1 — self-audit references spec success criteria, regex scan, and rerun-until-clean before sentinel', ...)`
     `it('phase 1 — triage block is absent without feedback_path', ...)`
     `it('phase 1 — triage block renders P1-only policy, Deferred fallback, and unlabeled-structural defer path when feedback_path is set', ...)`
  2. Run `pnpm vitest run tests/context/skills-rendering.test.ts -t "phase 1"` and confirm the new assertions fail first.
  3. Edit `src/context/skills/harness-phase-1-spec.md` to add the self-audit step required by `R1` and `R6` (`spec` lines 114 and 122), including the absorbed Deferred `§11` rerun sentence.
  4. In the same skill, expand the `{{#if feedback_path}}` block for `R4` and `R4a` (`spec` lines 118-119) and absorb Deferred `§9` by stating that unlabeled feedback needing structural change goes to `## Deferred` instead of inline restructuring.
  5. Re-run the same targeted Vitest command until green, then run the full `tests/context/skills-rendering.test.ts` file once to prove no unrelated rendering regressions.
  Expected verification output: 4 new Phase 1 rendering tests pass; existing wrapper invariant tests remain green.
  Commit message: `feat(skills): Phase 1 pre-sentinel self-audit + P1-only triage`

### Task 2: Phase 3 wrapper skill — same pattern
- [ ] Add Phase 3 self-audit and single-feedback P1-only triage via TDD, then commit the slice.
  Files touched: `src/context/skills/harness-phase-3-plan.md`, `tests/context/skills-rendering.test.ts`.
  Steps:
  1. Add failing tests first in `tests/context/skills-rendering.test.ts`:
     `it('phase 3 — self-audit step present in Process', ...)`
     `it('phase 3 — self-audit compares the plan and checklist against spec rules, then reruns until clean before sentinel', ...)`
     `it('phase 3 — triage block is absent without feedback_path', ...)`
     `it('phase 3 — triage block renders P1-only policy, Deferred fallback, and unlabeled-structural defer path when feedback_path is set', ...)`
  2. Run `pnpm vitest run tests/context/skills-rendering.test.ts -t "phase 3"` and confirm the new assertions fail first.
  3. Edit `src/context/skills/harness-phase-3-plan.md` to add the self-audit step required by `R2` and `R6` (`spec` lines 115 and 122), including explicit checklist-versus-spec coverage review and the absorbed Deferred `§11` rerun sentence.
  4. Expand the `{{#if feedback_path}}` block for `R4` and `R4a` (`spec` lines 118-119), keep the single-feedback shape, and absorb Deferred `§8`/`§9` by documenting that Phase 3 accepts one rendered feedback file and sends structural unlabeled items to `## Deferred`.
  5. Re-run the targeted filter until green, then rerun the full rendering test file.
  Expected verification output: 4 new Phase 3 rendering tests pass; no regressions in existing prompt-size, Open Questions, or BUG-B guards.
  Commit message: `feat(skills): Phase 3 pre-sentinel self-audit + P1-only triage`

### Task 3: Phase 5 wrapper skill — same pattern + plan-bug narrow fix + all Phase-5-only guards
- [ ] Add Phase 5 self-audit and multi-feedback P1-only triage via TDD, including the narrow `plan-bug` fix path and every Phase-5-only guard from the spec.
  Files touched: `src/context/skills/harness-phase-5-implement.md`, `tests/context/skills-rendering.test.ts`.
  Steps:
  1. Add failing tests first in `tests/context/skills-rendering.test.ts`:
     `it('phase 5 — self-audit step present in Process', ...)`
     `it('phase 5 — self-audit pins baseCommit...HEAD from state.json and treats checklist commands as inspect-only', ...)`
     `it('phase 5 — self-audit reruns until clean before sentinel and degrades with WARN when baseCommit is empty', ...)`
     `it('phase 5 — self-audit escalates 해결 불가 findings to spec-bug or plan-bug Deferred entries', ...)`
     `it('phase 5 — triage block is absent without feedback_paths', ...)`
     `it('phase 5 — triage block renders P1-only policy, P2 impl-only boundaries, and the spec/plan restructuring ban', ...)`
     `it('phase 5 — plan-bug handling is narrow and targeted rather than full plan restructuring', ...)`
     `it('phase 5 — duplicate issue identity is same file/area plus same requested change', ...)`
     `it('phase 5 — R5a severity resolution renders highest-wins with same-severity dedup', ...)`
     `it('phase 5 — spec-bug and plan-bug tags are informational signals only', ...)`
  2. Run `pnpm vitest run tests/context/skills-rendering.test.ts -t "phase 5"` and confirm the new assertions fail first.
  3. Edit `src/context/skills/harness-phase-5-implement.md` to satisfy `R3`, `R3a`, `R5`, `R5a`, and `R6` (`spec` lines 116-122), including the exact `baseCommit...HEAD` pin, the `state.json` lookup, the empty-`baseCommit` graceful-degrade path, the inspect-only checklist rule, the `spec-bug:`/`plan-bug:` escalation channel, and the absorbed Deferred `§11` rerun sentence.
  4. In the same skill, refine the `{{#if feedback_paths}}` block to satisfy `R5a` in full (both halves: (i) "same issue" identity = `동일 파일/영역 + 동일 요구 변경(문구 차이 무관)` per Deferred `§12`; (ii) resolution rule = **highest severity wins; same-severity duplicates collapse to single action**) and to absorb Deferred `§9` (unlabeled structural comments take the same deferred/escalation path).
  5. Re-run the targeted filter until green, then rerun the full rendering test file.
  Expected verification output: all listed Phase 5 rendering tests pass; `SC6`, `SC9`, `SC10`, and `SC13-SC21` plus `R5a` are all covered without breaking existing invariants.
  Commit message: `feat(skills): Phase 5 pre-sentinel self-audit + P1-only triage + plan-bug narrow fix`

### Task 4: Cross-phase rendering guards + carryoverFeedback test
- [ ] Lock the wrapper behavior at the assembled-prompt level, including the cross-phase retry-path edge cases that the spec moved into the plan phase.
  Files touched: `tests/context/skills-rendering.test.ts`.
  Steps:
  1. Add rendering tests that exercise the actual `assembleInteractivePrompt(...)` two-pass path rather than source-file string checks only.
  2. Add `it.each([1, 3, 5] as const)('phase %i — self-audit explains the 40× local grep rationale', ...)` and `it.each([1, 3, 5] as const)('phase %i — self-audit stays immediately before sentinel instructions', ...)` to lock `SC11` and `SC12`.
  3. Add `it.each([1, 3] as const)('phase %i — only one feedback file is rendered in single-feedback phases', ...)` to absorb Deferred `§8` without runtime changes.
  4. Add `it('phase 5 — carryoverFeedback missing files are dropped and valid feedback still renders triage', ...)` to absorb Deferred `§7` using `pendingAction.feedbackPaths` plus `carryoverFeedback.paths`.
  5. Keep the wording in new test names and comments aligned to Deferred `§6`: `regex-based rendering/grep tests`, not snapshot terminology.
  6. Re-run `pnpm vitest run tests/context/skills-rendering.test.ts` until green.
  Expected verification output: all listed cross-phase rendering test groups pass (phase-parametrized `it.each` plus standalone cases); `INV1-INV5` remain green and the wrapper text is proven at the assembled prompt layer.
  Commit message: `test(skills): cross-phase rendering + carryoverFeedback guards`

### Task 5: Final verify + build
- [ ] Run the full repo verification sequence, then rebuild `dist/` if the copied skill assets changed.
  Files touched: source skill files, `tests/context/skills-rendering.test.ts`, and conditional `dist/context/skills/harness-phase-{1,3,5}-*.md`.
  Steps:
  1. Run `pnpm tsc --noEmit`.
  2. Run `pnpm vitest run`.
  3. Run `pnpm build`.
  4. Inspect `git status --short`; if only the expected `dist/context/skills/` copies changed, commit them. If `dist/` is already clean, skip the build commit.
  Expected verification output: `SC1-SC3` green; full suite shows no regressions and only the planned new tests; build exits `0`.
  Commit message: `build: rebuild dist for skill updates` if `dist/` changed, otherwise none.

Coverage summary for self-check:
- Task 1 covers `R1`, `R4`, `R4a`, `R6`, Deferred `§9`, Deferred `§11`.
- Task 2 covers `R2`, `R4`, `R4a`, `R6`, Deferred `§8`, Deferred `§9`, Deferred `§11`.
- Task 3 covers `R3`, `R3a`, `R5`, `R5a`, `R6`, Deferred `§9`, Deferred `§11`, Deferred `§12`.
- Task 4 locks `INV1-INV5` plus Deferred `§6` and Deferred `§7`.
- Task 5 covers `SC1-SC3` and the optional `dist/` regeneration path.

## Test Design
The spec's test-design starter at lines 260-279 is expanded here into literal test names and regex assertions. `SC1-SC3` remain command-level checks by design; `SC4-SC21` map to rendering tests in `tests/context/skills-rendering.test.ts`.

| SC | Exact test name | File / render target | Regex or assertion |
| --- | --- | --- | --- |
| `SC1` | `N/A — command-only check in Task 0 and Task 5` | `pnpm tsc --noEmit` | Exit code `0` |
| `SC2` | `N/A — command-only check in Task 0 and Task 5` | `pnpm vitest run` | Exit code `0` (vitest fails non-zero on any test failure). Baseline comparison (new tests added but no regressions) is a Task 0 human note — not part of `harness-verify.sh`. |
| `SC3` | `N/A — command-only check in Task 0 and Task 5` | `pnpm build` | Exit code `0` |
| `SC4` | `it('phase 1 — self-audit step present in Process', ...)` | Assembled Phase 1 prompt | `/## Process[\\s\\S]*Pre-sentinel self-audit/` |
| `SC5` | `it('phase 3 — self-audit step present in Process', ...)` | Assembled Phase 3 prompt | `/## Process[\\s\\S]*Pre-sentinel self-audit/` |
| `SC6` | `it('phase 5 — self-audit step present in Process', ...)` | Assembled Phase 5 prompt | `/## Process[\\s\\S]*Pre-sentinel self-audit/` |
| `SC7` | `it('phase 1 — triage block renders P1-only policy, Deferred fallback, and unlabeled-structural defer path when feedback_path is set', ...)` | Assembled Phase 1 prompt with feedback | `/P1-only 정책/` |
| `SC8` | `it('phase 3 — triage block renders P1-only policy, Deferred fallback, and unlabeled-structural defer path when feedback_path is set', ...)` | Assembled Phase 3 prompt with feedback | `/P1-only 정책/` |
| `SC9` | `it('phase 5 — triage block renders P1-only policy, P2 impl-only boundaries, and the spec/plan restructuring ban', ...)` | Assembled Phase 5 prompt with feedback | `/P1-only 정책[\\s\\S]*Phase 5 전용/` |
| `SC10` | `it('phase 5 — triage block renders P1-only policy, P2 impl-only boundaries, and the spec/plan restructuring ban', ...)` | Assembled Phase 5 prompt with feedback | `/spec\\/plan 재구조화/` |
| `SC11` | `it.each([1, 3, 5] as const)('phase %i — self-audit explains the 40× local grep rationale', ...)` | Assembled Phase 1/3/5 prompts | `/40× local grep/` |
| `SC12` | `it.each([1, 3, 5] as const)('phase %i — self-audit stays immediately before sentinel instructions', ...)` | Assembled Phase 1/3/5 prompts | `/Pre-sentinel self-audit[\\s\\S]{0,600}sentinel/` |
| `SC13` | `it('phase 5 — self-audit pins baseCommit...HEAD from state.json and treats checklist commands as inspect-only', ...)` | Assembled Phase 5 prompt | `/baseCommit\\.\\.\\.HEAD/` |
| `SC14` | `it('phase 5 — self-audit escalates 해결 불가 findings to spec-bug or plan-bug Deferred entries', ...)` | Assembled Phase 5 prompt | `/spec-bug:[\\s\\S]*## Deferred|## Deferred[\\s\\S]*spec-bug:/` |
| `SC15` | `it.each([1, 3, 5] as const)('phase %i — triage text includes the missing-Deferred fallback', ...)` | Assembled Phase 1/3/5 prompts with feedback enabled | `/없으면[\\s\\S]*파일 끝[\\s\\S]*## Deferred/` |
| `SC16` | `it('phase 5 — plan-bug handling is narrow and targeted rather than full plan restructuring', ...)` | Assembled Phase 5 prompt | `/plan-bug:/` |
| `SC17` | `it('phase 5 — self-audit pins baseCommit...HEAD from state.json and treats checklist commands as inspect-only', ...)` | Assembled Phase 5 prompt | `/state\\.json[\\s\\S]*baseCommit/` |
| `SC18` | `it('phase 5 — self-audit escalates 해결 불가 findings to spec-bug or plan-bug Deferred entries', ...)` | Assembled Phase 5 prompt | `/해결 불가[\\s\\S]*## Deferred/` |
| `SC19` | `it('phase 5 — spec-bug and plan-bug tags are informational signals only', ...)` | Assembled Phase 5 prompt | `/informational signal|자동 완화/` |
| `SC20` | `it('phase 5 — self-audit pins baseCommit...HEAD from state.json and treats checklist commands as inspect-only', ...)` | Assembled Phase 5 prompt | `/inspect-only|실행 금지|실행하지 않음/` |
| `SC21` | `it('phase 5 — self-audit reruns until clean before sentinel and degrades with WARN when baseCommit is empty', ...)` | Assembled Phase 5 prompt | `/empty baseCommit|빈 .*baseCommit|WARN: skip self-audit/` |

Invariant and deferred-pickup regression tests that are not 1:1 with `SC` rows. **Note on coverage**: `INV1-INV4` are preserved via retained existing coverage (the pre-existing rendering tests already guard those regex matches, and this PR does not remove any of them); `INV5` is the only invariant gaining newly authored coverage in this PR.

| Target | Exact test name | Why it exists |
| --- | --- | --- |
| `INV1` | existing `it('phase 1 — spec output artifact path + sentinel rule literal', ...)` plus the unchanged `sentinel.*추가 작업 금지` match | Preserves the original sentinel-no-more-work invariant. |
| `INV2` | existing `it('phase 5 prompt (largest) stays well under a generous ceiling', ...)` | Keeps the prompt under the 60 KB ceiling. |
| `INV3` | existing `it('phase 1 wrapper surfaces Open Questions requirement (qa #7)', ...)` | Preserves the Open Questions guard. |
| `INV4` | existing `it.each([1, 3, 5] as const)('phase %i — advisor() forbidden + reviewer explanation present', ...)` | Prevents BUG-B regression while wrapper text grows. |
| `INV5` | `it('phase 1 — triage block is absent without feedback_path', ...)`, `it('phase 3 — triage block is absent without feedback_path', ...)`, `it('phase 5 — triage block is absent without feedback_paths', ...)` | Proves the P1-only block is conditional and absent on first pass. |
| Deferred `§7` | `it('phase 5 — carryoverFeedback missing files are dropped and valid feedback still renders triage', ...)` | Covers the missing-file merge path in the real assembled prompt. |
| Deferred `§8` | `it.each([1, 3] as const)('phase %i — only one feedback file is rendered in single-feedback phases', ...)` | Locks the Phase 1/3 single-feedback invariant without runtime changes. |
| Deferred `§12` | `it('phase 5 — duplicate issue identity is same file/area plus same requested change', ...)` | Makes the `R5a` sameness rule explicit and testable. |
| `R5a` (severity resolution) | `it('phase 5 — R5a severity resolution renders highest-wins with same-severity dedup', ...)` | Locks the second half of `R5a`: conflicting-severity duplicates resolve to highest; same-severity duplicates collapse to single action. Regex: `/highest severity[\s\S]{0,80}(wins|선택)/` and `/한 번만 반영|collapse/`. |

## Eval Checklist
The Phase 6 `harness-verify.sh` checklist below mirrors `SC1-SC21` exactly. `SC4-SC21` use `rg`/`grep`-style checks against the wrapper skill files, per the spec at lines 304-325.

```json
[
  {
    "id": "SC1",
    "description": "pnpm tsc --noEmit passes",
    "command": "pnpm tsc --noEmit",
    "expect": "exit code 0"
  },
  {
    "id": "SC2",
    "description": "pnpm vitest run passes (no failures)",
    "command": "pnpm vitest run",
    "expect": "exit code 0 (baseline comparison is a Task 0 human note, not part of the harness-verify check)"
  },
  {
    "id": "SC3",
    "description": "pnpm build passes",
    "command": "pnpm build",
    "expect": "exit code 0"
  },
  {
    "id": "SC4",
    "description": "Phase 1 skill contains the pre-sentinel self-audit step",
    "command": "rg -q \"Pre-sentinel self-audit\" src/context/skills/harness-phase-1-spec.md",
    "expect": "exit code 0"
  },
  {
    "id": "SC5",
    "description": "Phase 3 skill contains the pre-sentinel self-audit step",
    "command": "rg -q \"Pre-sentinel self-audit\" src/context/skills/harness-phase-3-plan.md",
    "expect": "exit code 0"
  },
  {
    "id": "SC6",
    "description": "Phase 5 skill contains the pre-sentinel self-audit step",
    "command": "rg -q \"Pre-sentinel self-audit\" src/context/skills/harness-phase-5-implement.md",
    "expect": "exit code 0"
  },
  {
    "id": "SC7",
    "description": "Phase 1 skill contains the P1-only triage block",
    "command": "rg -q \"P1-only 정책\" src/context/skills/harness-phase-1-spec.md",
    "expect": "exit code 0"
  },
  {
    "id": "SC8",
    "description": "Phase 3 skill contains the P1-only triage block",
    "command": "rg -q \"P1-only 정책\" src/context/skills/harness-phase-3-plan.md",
    "expect": "exit code 0"
  },
  {
    "id": "SC9",
    "description": "Phase 5 skill contains the Phase-5-only P1 triage wording",
    "command": "sh -c 'rg -q \"P1-only 정책\" src/context/skills/harness-phase-5-implement.md && rg -q \"Phase 5 전용\" src/context/skills/harness-phase-5-implement.md'",
    "expect": "exit code 0"
  },
  {
    "id": "SC10",
    "description": "Phase 5 skill explicitly bans spec/plan restructuring in retry",
    "command": "rg -q \"spec/plan 재구조화\" src/context/skills/harness-phase-5-implement.md",
    "expect": "exit code 0"
  },
  {
    "id": "SC11",
    "description": "All three wrapper skills explain the 40× local grep rationale",
    "command": "sh -c 'for f in src/context/skills/harness-phase-1-spec.md src/context/skills/harness-phase-3-plan.md src/context/skills/harness-phase-5-implement.md; do rg -q \"40× local grep\" \"$f\" || exit 1; done'",
    "expect": "exit code 0"
  },
  {
    "id": "SC12",
    "description": "All three wrapper skills keep self-audit immediately before sentinel instructions",
    "command": "sh -c 'for f in src/context/skills/harness-phase-1-spec.md src/context/skills/harness-phase-3-plan.md src/context/skills/harness-phase-5-implement.md; do rg -UPq \"(?s)Pre-sentinel self-audit.{0,600}sentinel\" \"$f\" || exit 1; done'",
    "expect": "exit code 0"
  },
  {
    "id": "SC13",
    "description": "Phase 5 skill pins the commit range to baseCommit...HEAD",
    "command": "rg -F -q \"baseCommit...HEAD\" src/context/skills/harness-phase-5-implement.md",
    "expect": "exit code 0"
  },
  {
    "id": "SC14",
    "description": "Phase 5 skill includes the spec-bug Deferred escalation channel",
    "command": "sh -c 'rg -q \"spec-bug:\" src/context/skills/harness-phase-5-implement.md && rg -q \"## Deferred\" src/context/skills/harness-phase-5-implement.md'",
    "expect": "exit code 0"
  },
  {
    "id": "SC15",
    "description": "All three wrapper skills include the missing-Deferred fallback instruction (order: 없으면 → 파일 끝 → ## Deferred). Window widened post-plan review to match the Test Design regex (`[\\s\\S]*`) since Phase 5 has larger inter-token distance than Phase 1/3.",
    "command": "sh -c 'for f in src/context/skills/harness-phase-1-spec.md src/context/skills/harness-phase-3-plan.md src/context/skills/harness-phase-5-implement.md; do perl -0777 -ne \"\\$f=1 if /없으면.*파일 끝.*## Deferred/s; END{exit(\\$f ? 0 : 1)}\" \"$f\" || exit 1; done'",
    "expect": "exit code 0"
  },
  {
    "id": "SC16",
    "description": "Phase 5 skill includes the plan-bug escalation category",
    "command": "rg -q \"plan-bug:\" src/context/skills/harness-phase-5-implement.md",
    "expect": "exit code 0"
  },
  {
    "id": "SC17",
    "description": "Phase 5 self-audit reads baseCommit from state.json",
    "command": "sh -c 'rg -q \"state.json\" src/context/skills/harness-phase-5-implement.md && rg -q \"baseCommit\" src/context/skills/harness-phase-5-implement.md'",
    "expect": "exit code 0"
  },
  {
    "id": "SC18",
    "description": "Phase 5 self-audit escalates implementation-unsuitable findings through Deferred",
    "command": "sh -c 'rg -q \"해결 불가\" src/context/skills/harness-phase-5-implement.md && rg -q \"## Deferred\" src/context/skills/harness-phase-5-implement.md'",
    "expect": "exit code 0"
  },
  {
    "id": "SC19",
    "description": "Phase 5 skill says spec-bug and plan-bug tags are informational only and do not auto-relax the gate",
    "command": "sh -c 'rg -q \"informational signal\" src/context/skills/harness-phase-5-implement.md || rg -q \"자동 완화\" src/context/skills/harness-phase-5-implement.md'",
    "expect": "exit code 0"
  },
  {
    "id": "SC20",
    "description": "Phase 5 self-audit treats checklist commands as inspect-only",
    "command": "sh -c 'rg -q \"inspect-only\" src/context/skills/harness-phase-5-implement.md || rg -q \"실행 금지\" src/context/skills/harness-phase-5-implement.md || rg -q \"실행하지 않음\" src/context/skills/harness-phase-5-implement.md'",
    "expect": "exit code 0"
  },
  {
    "id": "SC21",
    "description": "Phase 5 self-audit keeps the empty-baseCommit graceful-degrade path",
    "command": "sh -c 'rg -q \"empty baseCommit\" src/context/skills/harness-phase-5-implement.md || rg -q \"빈 .*baseCommit\" src/context/skills/harness-phase-5-implement.md || rg -q \"WARN: skip self-audit\" src/context/skills/harness-phase-5-implement.md'",
    "expect": "exit code 0"
  }
]
```

**Note**: `R5a` (severity resolution: highest wins + same-severity dedup) is additionally guarded by the rendering test
`it('phase 5 — R5a severity resolution renders highest-wins with same-severity dedup', ...)` (listed in Test Design →
invariant table). `R5a` does not introduce a new `SC` entry; the skill-level guard is implicitly covered when SC9 + the
rendering test both pass. Implementation of Task 3 must include the explicit severity-resolution phrase so this test
is green.

## Deferred (still deferred after this PR)
These items remain out of scope exactly as written in the spec (`docs/specs/2026-04-19-wrapper-self-audit-and-p1-only-design.md:334-347`).

1. **assembler `<harness_feedback_policy>` stanza 주입** — skill-only 효과 측정 후 결정. trigger: 다음 dogfood-full에서 P1.3 증상 (P2-driven restructuring이 새 P1 유발) 재발 시.
Rationale: this PR stays skill-text only and must not modify `src/context/assembler.ts`.

2. **Light flow 템플릿(`phase-{1,5}-light.md`)에 동일 규칙** — full flow에서 효과 검증 후 이식.
Rationale: the approved scope is the full-flow wrapper skills only.

3. **`events.jsonl`에 `feedback_triage` 이벤트** — P1-only 정책 적용 빈도 관측 지표. prompt의 Out of scope에 명시됨.
Rationale: event logging is runtime work and explicitly outside this PR.

4. **Phase 5 self-audit "auto-fix" 허용 여부** — 현재 명시적 수정 + 커밋. 자동화 검토는 별도.
Rationale: this PR only changes wrapper instructions and tests, not automation behavior.

5. **Gate 7 prompt에 `git log baseCommit..HEAD --format` 섹션 추가** — 커밋 메시지를 reviewer에게 직접 전달해 P5 escalation을 plan doc 변경 없이 할 수 있게 함. 현재는 plan doc `## Deferred` append로 우회. trigger: plan doc touch-every-phase가 spec coherence에 해가 된다는 관측.
Rationale: Gate 7 prompt construction is runtime/assembler scope and is intentionally deferred.

10. **startCommand/preflight의 baseCommit 빈값 근본 fix** (Round 5 P1.1 반영) — `startCommand`가 `getHead()` 실패 시 `baseCommit = ''`을 저장하는 경로와 preflight가 `git`/`head`를 보장하지 않는 문제. 본 PR은 self-audit 쪽 graceful degrade만 제공. 근본 fix는 별도 PR로 preflight에 `git` + `HEAD 존재` 체크 추가 + startCommand 검증 강화.
Rationale: this PR only adds the documented graceful-degrade wording and the tests that guard it.

13. **Resume 경로에서 jq preflight 누락** (Round 6 P2) — `runRunnerAwarePreflight`는 `jq`를 보장하지 않음(`src/commands/inner.ts:184-188`). 본 PR은 fresh-start 전제이며, resume 경로 지원은 별도 PR (`preflight.ts`에 resume-time common preflight rerun 추가).
Rationale: resume-path preflight is a separate runtime concern and not part of the skill-only change set.

## Open Questions
None — spec is sufficient for implementation.
