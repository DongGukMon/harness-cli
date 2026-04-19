# Complexity Signal → Phase 3 Plan Size Directive — Design Spec

- Date: 2026-04-19
- Status: Draft (Phase 1 output, awaiting Gate 2)
- Scope: Phase 1 spec gets a one-line `## Complexity` signal. Phase 3 assembler parses it and injects a plan-depth directive to the Phase 3 prompt. Both full and light flows.
- Related:
  - Original follow-up: [../../../gate-convergence/FOLLOWUPS.md](../../../gate-convergence/FOLLOWUPS.md) §P1.4 (L80–L94)
  - Group C brief: this PR's handoff prompt
  - Sibling PRs (same worktree family, different groups — they do **not** conflict with this PR's injection point or validator):
    - Group B (retry-feedback stanza) — `src/context/assembler.ts` (different injection site, different function)
    - Group A (phase-5 wrapper skill `.gitignore` Process step) — `src/context/skills/harness-phase-5-implement.md` only (this PR touches phases 1 + 3)

## Complexity

`Medium` — Touches 8–10 files (types, config, assembler, 2 validators, 3 prompt templates, 2 wrapper skills) with deterministic parse + string-inject logic. ~200–400 LoC delta including tests. Worth 4–5 vertical slices with checklist + snapshot coverage.

## Context & Decisions

### Why this work

`gate-convergence/FOLLOWUPS.md` §P1.4 recorded a dogfooding finding: a ~500 LOC todo CLI task produced a **1584-line** Phase 3 plan. The implementer (`sonnet-high` + `superpowers:writing-plans`) applies the same plan depth regardless of task complexity — per-task pseudocode, micro slices, lengthy eval checklists — because nothing in the prompt tells it the task is small.

Observed costs:

- Phase 4 gate (plan review) has more surface to critique → more reject rounds.
- Phase 5 implementer over-decomposes trivial changes.
- Gate 7 diff review balloons because tests mirror plan granularity.

Instead of heuristically estimating task size (line counts, file counts, keyword scans — all brittle), **Phase 1 explicitly commits to a coarse complexity bucket**, and the assembler deterministically translates that bucket into a Phase 3 directive.

### Decisions (inline; Decision Log lives in `.harness/<runId>/decisions.md`)

**ADR-1 — Explicit one-liner over heuristic estimation.** The spec author (brainstormer) emits `## Complexity: Small|Medium|Large`. The assembler does not *infer* complexity from spec length, task count, or keywords.
- Why: heuristics drift silently across tasks and break under adversarial content (long preamble ≠ large task). Author intent is a first-class signal; the gate reviewer can challenge a mis-classification.
- Alternatives rejected: (a) LOC estimate from task description — prone to false positives on docs-heavy tasks. (b) task-count heuristic post-plan — too late, cart before horse. (c) LLM self-classification inside assembler — non-deterministic, defeats the purpose of a text pipeline.

**ADR-2 — 3-value enum vs continuous scale.** Values are exactly `Small`, `Medium`, `Large` (case-insensitive). No `XS/XL`, no 1–5 score.
- Why: three buckets give three distinct directives. More granularity would multiply directive strings without proportional behavioral change. Binary (small/large) would collapse the common "standard depth" middle case where no directive change is wanted.
- Why case-insensitive: authors naturally write "small" / "Small" / "SMALL"; rejecting capitalization noise is user-hostile.

**ADR-3 — Missing/invalid Complexity behavior.** Parser returns `medium` as fallback and emits a **single** `stderr.write` warning (`⚠️  Complexity signal missing or invalid in spec …; defaulting to Medium.`). Run is not failed. Validator (Phase 1 artifact check) treats the *absence* of the section as P1-worthy — it reports failure, blocking sentinel. But *parse ambiguity* inside the assembler (e.g., weird formatting making parser fall through) must not abort a run because the spec already passed Gate 2.
- Why: three-state soft-fail matches the `claudeTokens` contract from PR #16 — present / null+warn / absent. Assembler is a downstream consumer; upstream (validator, Gate 2 reviewer) is where enforcement happens.
- Why Medium fallback: it preserves today's Phase 3 behavior exactly (empty directive). No Small/Large directive can leak accidentally.

**ADR-4 — Light flow parity.** Light flow's combined doc (`phase-1-light.md`) also requires `## Complexity`. Phase 3 directive only applies to full flow (light has no Phase 3), but light's *Implementation Plan* section inside the combined doc benefits from the same self-restraint — we surface the directive there via wrapper skill language instead of assembler injection (light Phase 1 is self-contained, no wrapper skill).
- Why: consistency + same validator path — both flows use `validatePhaseArtifacts` Phase 1 branch (interactive.ts) and `completeInteractivePhaseFromFreshSentinel` (resume.ts). Adding a validator to full but not light would be confusing.
- Scope clarification: for light, the validator requires the section and value. Light's self-contained template text (phase-1-light.md) carries a short "Small → plan ≤ 3 tasks" instruction inline.

**ADR-5 — Injection site: Phase 3 thin template `{{complexity_directive}}` placeholder.** `phase-3.md` (thin binding) gets a new placeholder resolved by the assembler. Wrapper skill `harness-phase-3-plan.md` references it in a new Process step.
- Why: matches the existing two-pass render — wrapper body vars resolve first, outer template resolves `{{wrapper_skill}}` and `{{complexity_directive}}`. Keeping it at the thin-template level means the wrapper skill text stays static; only the outer injection changes per-task.
- Alternatives rejected: (a) assembler prepends a raw string before the wrapper body — breaks wrapper invariants expectations. (b) directive included in wrapper skill with branching — wrapper skill becomes a template itself, duplicating render logic.

**ADR-6 — Group B / Group A coexistence.** Group B also edits `src/context/assembler.ts` (retry-feedback stanza, different function) and `src/context/skills/harness-phase-{1,3}-*.md` (different Process section). This PR's changes are scoped to:
- `assembler.ts`: new `parseComplexity()` helper + `buildComplexityDirective()` + wiring into `assembleInteractivePrompt` Phase 3 path.
- Skills: new Process step referencing the complexity signal. Separate heading, won't collide with Group B's retry-feedback step or Group A's phase-5 .gitignore step.
- Why: merge-order-independent. Either PR can land first.

### Why not also auto-tune Phase 5?

Out of scope for this PR. Phase 5 (implementation) reads the plan directly; if the plan is concise, Phase 5 naturally implements less. A future follow-up could pass the same directive to Phase 5 for belt-and-suspenders, but that's not needed to exercise P1.4's benefit.

## Goals

1. Phase 1 spec (both full + light) **must** contain exactly one `## Complexity` section. Validator enforces presence + value-in-set. Missing/invalid → phase fails before sentinel acceptance.
2. Phase 3 assembler parses `## Complexity` from the spec file and injects a corresponding directive into the Phase 3 prompt.
3. Three directive variants:
   - **Small** → up to 3 tasks, no per-function pseudocode, task-bundling encouraged, eval checklist ≤ 4 commands.
   - **Medium** → no directive (empty stanza) — preserves today's behavior.
   - **Large** → reinforce slice discipline + ADR-style decision capture. No explicit task-count ceiling.
4. Wrapper skill `harness-phase-3-plan.md` gets a new Process step requiring "read the complexity signal first" so the implementer does not override the assembler directive.
5. Wrapper skill `harness-phase-1-spec.md` + `phase-1-light.md` require authors to include `## Complexity: <bucket>` with a ≤ 1-line rationale.

## Non-Goals

- Auto-inferring complexity from task text.
- Four or more buckets.
- Phase 5 directive injection.
- Gate 2/4/7 reviewer-side heuristics (the reviewer already sees the spec; no new rubric).
- Retrofitting existing spec docs (none in `docs/specs/` get mutated).

## Requirements

### R1 — Spec contract

Phase 1 spec MUST contain this literal header:

```
## Complexity
```

…followed by exactly one of `Small`, `Medium`, `Large` (case-insensitive) as the first non-blank token on a following line. Optional em-dash rationale on the same line is permitted:

```
## Complexity

Medium — touches 8 files, ~300 LoC
```

### R2 — Parser

`parseComplexitySignal(specText: string): 'small' | 'medium' | 'large' | null`.

- Locates `^##\s+Complexity\s*$` on a line boundary (multiline).
- Reads the next non-blank line.
- Matches case-insensitively against `^(small|medium|large)\b`.
- Returns normalized lowercase value, or `null` on any failure (missing section, unknown token, empty body).

### R3 — Directive builder

`buildComplexityDirective(level: 'small' | 'medium' | 'large' | null): string`.

Mapping (exact directive text is part of this spec; tests snapshot these strings — see `tests/context/assembler.test.ts > complexity signal — directive builder > exact-snapshot`):

- `small` → a 4–6 line stanza:
  ```
  <complexity_directive>
  This task is classified **Small**. Keep the plan to **at most 3 tasks**. Do not emit per-function pseudocode or ASCII diagrams. Prefer bundling related edits in one task over splitting them. Keep `checklist.json` to at most 4 `checks` entries — typecheck + test + build is usually enough.
  </complexity_directive>
  ```
- `medium` → empty string (today's behavior).
- `large` → a 3–4 line stanza:
  ```
  <complexity_directive>
  This task is classified **Large**. Decompose into clear vertical slices with explicit dependency order. Capture architecturally-relevant decisions as short ADR blurbs inline in the plan. Standard depth otherwise.
  </complexity_directive>
  ```
- `null` (fallback from parse failure) → empty string + single `stderr.write` warning the first time per run; do NOT repeat the warning on subsequent Phase 3 reopens within the same process.

> **Post-hoc spec correction (applied 2026-04-19):** earlier drafts of R3
> phrased the Small stanza's final sentence as *"Keep the eval checklist to
> 3–4 commands at the command level (typecheck + test + build is usually
> enough)."* That wording did not match the harness contract — the verifier
> consumes `checklist.json` with `{checks: [{name, command}]}` entries, not
> free-form "commands." The spec has been updated to the implementation's
> actual wording so the spec, the snapshot test, and the runtime directive
> are aligned. See Plan §Deviations #3 and the `exact-snapshot` test above
> for the enforcement mechanism against future drift.

### R4 — Assembler wiring

`assembleInteractivePrompt(3, state, harnessDir)`:

1. Resolve spec path from `state.artifacts.spec`.
2. `fs.readFileSync(specPath, 'utf-8')` (swallow ENOENT → treat as null parse).
3. `parseComplexitySignal` → `buildComplexityDirective`.
4. Add `complexity_directive` to the `vars` dict passed to `renderTemplate`.
5. `phase-3.md` template now has `{{complexity_directive}}` placeholder (directly under `{{wrapper_skill}}` or as a dedicated section header — see §Design).

### R5 — Validator (Phase 1 artifact check)

`validatePhaseArtifacts(1, state, cwd)` in both `src/phases/interactive.ts` and the symmetric resume path in `src/resume.ts::completeInteractivePhaseFromFreshSentinel`:

- Reads spec file contents (it's already on disk for Phase 1 completion checks).
- Runs the same `^##\s+Complexity\s*$` regex **and** validates the following line's token against the 3-value enum.
- If section missing OR token invalid → return `false`. Phase 1 completion fails → harness rejects sentinel → user sees the wrapper skill's error trail.
- Applies to both `full` and `light` flows.

### R6 — Wrapper skill + template updates

- `harness-phase-1-spec.md`: new Process step "Include `## Complexity: <Small|Medium|Large>` section (with ≤ 1-line rationale). Missing → Phase 1 validator fails."
- `phase-1-light.md` (self-contained template): add `## Complexity` to the required section list + inline 1-line instruction.
- `harness-phase-3-plan.md`: new Process step before the `superpowers:writing-plans` invocation: "Read the `## Complexity` directive injected at the top of this prompt; obey the task-count ceiling and pseudocode rule for Small. For Large, capture ADR blurbs inline."
- `phase-3.md` (thin template): add `{{complexity_directive}}` placeholder near the top.

### R7 — Tests

- Unit (assembler): parser accepts all 6 case variants (Small/small/SMALL × with/without rationale); rejects unknown tokens, missing section, empty body.
- Unit (assembler): directive builder snapshots for 3 buckets + null.
- Unit (assembler): `assembleInteractivePrompt(3, ...)` — fixture spec with each bucket → resulting prompt contains (or doesn't contain) the expected directive stanza.
- Unit (assembler): parse-failure path emits exactly one `stderr.write` per process (re-entrant Phase 3 second call during same process is silent).
- Validator (phase 1): spec without `## Complexity` → `validatePhaseArtifacts(1)` returns false.
- Validator (phase 1): spec with `## Complexity` / `medium` → returns true. Spec with `## Complexity` / `extra-large` → returns false.
- Validator (phase 1, resume path): same cases, via `completeInteractivePhaseFromFreshSentinel`.
- E2E-lite: dummy spec with each bucket runs through `assembleInteractivePrompt(3, ...)` and the assembled prompt line count differs as expected (Small < Medium < Large + directive — a loose regression check).

## Design

### Data model

No change to `state.json` or `types.ts`. Complexity lives *in the spec text*, not as structured state. This is load-bearing — it keeps the signal auditable by humans reading the spec.

### Parser contract

```ts
export function parseComplexitySignal(specText: string): 'small' | 'medium' | 'large' | null {
  const headerMatch = specText.match(/^##\s+Complexity\s*$/m);
  if (!headerMatch) return null;
  const offset = headerMatch.index! + headerMatch[0].length;
  const remainder = specText.slice(offset);
  const lines = remainder.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '') continue;
    const tokenMatch = line.match(/^(small|medium|large)\b/i);
    return tokenMatch ? (tokenMatch[1].toLowerCase() as 'small' | 'medium' | 'large') : null;
  }
  return null;
}
```

### Directive builder

`buildComplexityDirective` returns a string (possibly empty). Placed in a new function block near the top of `assembler.ts`, close to `REVIEWER_CONTRACT_BASE`.

### Warning de-duplication

Module-level `let complexityWarningEmitted = false;` — reset is not required because Node process = one harness run. (If assembler is unit-tested across multiple fixtures, tests pass a `{ resetWarning: true }` helper via exported `__resetComplexityWarning()` — test-only.)

### Prompt placement

`phase-3.md` before-change:

```
{{wrapper_skill}}

---

## Harness Runtime Context (reference)
...
```

After:

```
{{complexity_directive}}{{wrapper_skill}}

---

## Harness Runtime Context (reference)
...
```

For Medium this yields no extra whitespace (directive string is empty). For Small/Large the directive appears **before** the wrapper skill so the implementer reads the constraint first.

### Validator integration

Both `validatePhaseArtifacts` (interactive.ts) and the resume mirror already read spec content for light flow's `## Open Questions` regex. Reuse that read — add `## Complexity` regex + value check inside the same `try/catch` block. Applies to both full and light.

## Open Questions

1. **Should Medium emit a "standard depth" stanza even when empty?** Decision: no — empty directive preserves today's cost profile exactly. Adding explicit "standard depth" text would pay token cost for no behavioral gain. If empirical data later shows Medium tasks also over-plan, we revisit.
2. **Should the spec reviewer (Gate 2) get a rubric bullet "verify Complexity matches task scope"?** Decision: no in this PR. The reviewer already reads Scope (axis 3); adding a dedicated complexity rubric risks over-specifying gate behavior. If authors self-misclassify persistently, revisit with telemetry.
3. **Light flow: should the combined doc's Implementation Plan section also respect Small?** Decision: yes — the wrapper instruction in `phase-1-light.md` will call this out. But the light flow has no separate Phase 3 and no wrapper skill to inject into, so enforcement is soft (author discipline + Gate 7 reviewer's holistic read).
4. **Do we need a CLI flag like `--complexity small`?** Decision: out of scope. Phase 1 author writes it in the spec; CLI flag would duplicate the source of truth.

## Success Criteria

1. `pnpm tsc --noEmit` clean.
2. `pnpm vitest run` green; baseline 617 passed grows by ≥ 10 new tests covering parser/directive/validator/assembler paths.
3. `pnpm build` succeeds (template + skill assets copy intact).
4. With a Small-tagged dummy spec, `assembleInteractivePrompt(3)` output contains `"at most 3 tasks"`; with Medium, it does not.
5. Wrapper skills for Phase 1 (full + light variants) instruct the author to include `## Complexity`.
6. Wrapper skill for Phase 3 instructs the implementer to respect the directive.
7. Re-run `pnpm vitest run tests/context/assembler.test.ts` → all existing tests still green (no regression).

## File-level Change List

| Path | Action |
|---|---|
| `src/context/assembler.ts` | Add `parseComplexitySignal`, `buildComplexityDirective`, `__resetComplexityWarning` (test hook), wire into `assembleInteractivePrompt` Phase 3 path. |
| `src/context/prompts/phase-3.md` | Add `{{complexity_directive}}` placeholder before `{{wrapper_skill}}`. |
| `src/context/prompts/phase-1.md` | Add required `## Complexity` note in Process instructions. |
| `src/context/prompts/phase-1-light.md` | Add `## Complexity` to required section list + 1-line instruction. |
| `src/context/skills/harness-phase-1-spec.md` | Process: new step "emit `## Complexity: <bucket>`". |
| `src/context/skills/harness-phase-3-plan.md` | Process: new step "read the complexity directive; obey Small's 3-task ceiling". |
| `src/phases/interactive.ts` | `validatePhaseArtifacts(1)` — add `## Complexity` + enum regex check (applies to both full + light flows). |
| `src/resume.ts` | `completeInteractivePhaseFromFreshSentinel` Phase 1 branch — mirror validator. |
| `tests/context/assembler.test.ts` | Add parser, directive, injection tests. |
| `tests/phases/interactive.test.ts` | Add Complexity validator cases. |
| `tests/resume.test.ts` | Add Complexity validator mirror cases. |
| `tests/context/skills-rendering.test.ts` | (if the existing file tests skill text invariants) add Complexity-related checks. |

Exactly one new test file may be introduced if existing files get over-crowded; otherwise reuse above.

## Out of Scope

- Auto-inferring or re-classifying complexity anywhere.
- Phase 5 directive injection.
- Gate rubric changes.
- CLI flags.
- Retroactive updates to existing spec docs in `docs/specs/`.
