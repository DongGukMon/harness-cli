# Complexity Signal — Implementation Plan

- Date: 2026-04-19
- Spec: [`docs/specs/2026-04-19-complexity-signal-design.md`](../specs/2026-04-19-complexity-signal-design.md)
- Base commit: `2bc9ada` (branch `feat/complexity-signal` off `main`)
- Follow-up source: [`../../../gate-convergence/FOLLOWUPS.md`](../../../gate-convergence/FOLLOWUPS.md) §P1.4

## Deviations from the spec's File-level Change List

After re-reading both the spec and the current code, two spec items need calibration:

1. **Validator scope (spec R5).** Spec says "applies to both `full` and `light` flows" but the current `validatePhaseArtifacts(phase, ...)` only performs content-based spec checks under `state.flow === 'light' && phase === 1`. Full-flow Phase 1 has no content check today. **Fix:** lift the `## Complexity` check out of the light guard so it runs for any Phase 1 regardless of flow. Mirror the lift in `resume.ts`. (The light-specific checks — `Open Questions` and `Implementation Plan` — stay under the light guard.)
2. **`src/context/prompts/phase-1.md` is a thin 16-line binding**; it has no "Process" section to amend. All authoring guidance for Phase 1 lives in the wrapper skill `harness-phase-1-spec.md`. **Skip** editing `phase-1.md`.
3. **Small directive wording.** Spec R3 Small reads "eval checklist to 3–4 commands at the command level" but the harness enforces `checklist.json` with `checks: [{name, command}]`. Rephrase directive text to "Keep `checklist.json` to ≤ 4 `checks` entries, one per command category (typecheck, test, build)" so the implementer is not misled. Snapshot test captures the final wording.
4. **Workflow.** Task brief suggested `harness start --light` but the spec was already authored manually off-flow and committed. Continuing with `harness start --light` now would duplicate or clobber the spec and would validate the pre-change code (no Complexity feature yet), not the new code. Proceed manually; PR body discloses this.

Everything else in the spec's file-level list stands.

## Slices

### Slice 1 — Parser + directive builder + unit tests (TDD)

**Files**
- `src/context/assembler.ts` — add `parseComplexitySignal`, `buildComplexityDirective`, `__resetComplexityWarning`.
- `tests/context/assembler.test.ts` — new `describe('complexity signal — parser')` and `describe('complexity signal — directive builder')` blocks.

**Steps**
1. Write failing tests for parser: 6 happy cases (`Small` / `small` / `SMALL` × with and without `—` rationale), plus null cases (missing section, empty body, unknown token, trailing whitespace).
2. Write failing tests for `buildComplexityDirective`: snapshot 3 non-empty outcomes (`small`, `large`) and empty outcomes (`medium`, `null`). Null path also fires one `stderr.write` per process; reset via `__resetComplexityWarning` between tests.
3. Implement parser per spec R2. Keep regex `/^##\s+Complexity\s*$/m` + next-non-blank-line token scan.
4. Implement directive builder per spec R3 with the corrected Small wording noted above.
5. Export `__resetComplexityWarning` (test-only hook) next to the module-level `complexityWarningEmitted` flag.

**Acceptance**
- `pnpm vitest run tests/context/assembler.test.ts` green.
- `pnpm tsc --noEmit` clean.

**Commit**: `feat(complexity): parse spec signal + directive builder`

### Slice 2 — Phase 3 assembler wiring + template placeholder

**Files**
- `src/context/prompts/phase-3.md` — add `{{complexity_directive}}` before `{{wrapper_skill}}`.
- `src/context/assembler.ts` — wire `complexity_directive` into `vars` in `assembleInteractivePrompt` (Phase 3 branch only). Read spec from `state.artifacts.spec`, swallow ENOENT → treat as null parse.
- `tests/context/assembler.test.ts` — extend Phase 3 interactive-prompt tests: spec with `## Complexity\nSmall` yields prompt containing "classified **Small**"; without the section yields no directive stanza.

**Steps**
1. Write failing test: fixture spec file on disk (tmp dir), state with `artifacts.spec` pointing at it, assemble Phase 3 prompt, assert directive appears for Small, absent for Medium, long form for Large.
2. Extend parser call site in `assembleInteractivePrompt`: gated on `phase === 3`, read spec content from resolved path (honoring cwd via harnessDir's parent like existing code does).
3. Update `phase-3.md` template to include `{{complexity_directive}}{{wrapper_skill}}` — directive first so the implementer reads the constraint first.
4. Run existing snapshot test (if any) for Phase 3; it must still pass for Medium (empty directive → no drift).

**Acceptance**
- New Phase 3 cases green; no regression in existing Phase 3 tests.
- Prompt size assertions (existing) still pass.

**Commit**: `feat(assembler): inject Phase 3 complexity directive`

### Slice 3 — Validator mirrored (interactive + resume), both flows

**Files**
- `src/phases/interactive.ts` — extract a small helper `specHasValidComplexity(specPath): boolean`; invoke inside `validatePhaseArtifacts` for `phase === 1` **regardless of flow**.
- `src/resume.ts` — mirror the call in `completeInteractivePhaseFromFreshSentinel`.
- `tests/phases/interactive.test.ts` — cover: (a) full-flow Phase 1 spec missing Complexity → `false`; (b) full-flow with `Medium` → `true`; (c) light-flow inherits all existing + new check.
- `tests/resume-light.test.ts` and/or `tests/resume.test.ts` — mirror cases for resume.

**Steps**
1. Write failing tests — one per flow (full, light) × two outcomes (missing/invalid, present/valid).
2. Implement the helper with regex `/^##\s+Complexity\s*$/m` + case-insensitive enum match on the next non-blank line. Reuse `parseComplexitySignal` if easy; if import coupling is messy, inline the ~6 lines of logic to keep validator self-contained.
3. Lift the call *outside* the `flow === 'light'` guard. Leave existing light-only checks (`Open Questions`, `Implementation Plan`) where they are.
4. Mirror in `resume.ts`. Keep the regex identical (or import the shared helper from `interactive.ts`).

**Acceptance**
- Full + light validator tests pass.
- No regression in prior 617 tests.

**Commit**: `feat(phases): validate Complexity section in Phase 1 artifact check`

### Slice 4 — Wrapper skill + light template updates

**Files**
- `src/context/skills/harness-phase-1-spec.md` — add a new `## Process` step just before the Decision Log step: emit `## Complexity: <Small|Medium|Large>` with ≤ 1-line rationale; note that Gate 2 + validator both flag missing.
- `src/context/skills/harness-phase-3-plan.md` — add a new `## Process` step at step 0 (before `superpowers:writing-plans` invocation): read the `<complexity_directive>` stanza at the top of the prompt; for Small, cap at 3 tasks and skip per-function pseudocode.
- `src/context/prompts/phase-1-light.md` — add `## Complexity` to the required-sections block (already enumerates `Open Questions`, `Implementation Plan`); add a 1-line instruction underneath.
- `tests/context/skills-rendering.test.ts` (if it asserts text invariants) — extend to check new sections are present.

**Steps**
1. Update both skills. Keep them in a separate Process heading so Group B's retry-feedback edits and Group A's phase-5 edits don't collide.
2. Update light template required-sections list. Add a pointer sentence "one of `Small`, `Medium`, `Large`, case-insensitive; see wrapper conventions".
3. Adjust any assembler test that snapshots full rendered Phase 1/3 prompts (if they hardcode a line count).

**Acceptance**
- Rendering tests reflect the new sections.
- Manual `grep -n '## Complexity'` in skills confirms presence.

**Commit**: `feat(skills): require Complexity section in Phase 1 + consume it in Phase 3`

### Slice 5 — E2E-lite: three-bucket snapshot across the assembler

**Files**
- `tests/context/assembler.test.ts` — new `describe('complexity signal — E2E')` block with a single fixture spec per bucket and a loose line-count regression assertion (Small < Medium + directive; Large > Medium + directive).

**Steps**
1. Build three on-disk fixture specs (Small/Medium/Large) and run `assembleInteractivePrompt(3, state, harnessDir)` for each.
2. Assert Small contains "classified **Small**" and "at most 3 tasks"; Medium contains none of those markers; Large contains "classified **Large**".
3. Keep fixtures inline to avoid file sprawl.

**Acceptance**
- `pnpm vitest run` green.
- Total test count ≥ 627 (baseline 617 + ~10 new).

**Commit**: `test(complexity): E2E rendering across Small/Medium/Large buckets`

## Eval Checklist (commands executed in isolated shells)

| name | command |
|---|---|
| typecheck | `pnpm tsc --noEmit` |
| test | `pnpm vitest run` |
| build | `pnpm build` |

## Open Questions (from spec, answered or deferred)

- All four open questions in the spec were resolved during brainstorming. This plan inherits those decisions.
- One *implementation* open question: should `parseComplexitySignal` and the validator share a single helper in `src/context/complexity.ts`? **Decision: inline for now.** Two call sites, ~6 lines each, and separating would force an extra module import into a previously-import-light file. Revisit if a third consumer appears.

## Out of Scope (from spec, restated)

- Phase 5 directive injection.
- Gate rubric changes (Gate 2/4/7 reviewers get no new rubric).
- CLI flag `--complexity`.
- Retroactive mutation of existing specs in `docs/specs/`.
