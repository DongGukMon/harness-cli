# Gate Review Prompt Templates

Reference file for constructing Codex gate review prompts. Each gate type has a specific prompt template. Use the `gpt-5-4-prompting` XML block conventions.

## Common Output Contract (all gates)

```xml
<structured_output_contract>
Return your review as structured text with these sections in order:

## Verdict
State exactly one of: `APPROVE` or `REJECT`

When the verdict is `REJECT` and the gate type is **eval**, the next non-empty line in the Verdict section MUST be exactly:
  Scope: design | impl | mixed
(choose one value: `design`, `impl`, or `mixed`). Omit the `Scope:` line for `APPROVE` and for non-eval gates (spec/plan review).
- `design`: spec or requirements gap → restart from Phase 1
- `impl`: spec is valid, implementation fails contract → retry Phase 5
- `mixed`: both design and implementation issues present

## Comments
For each finding, use this format:
- **[P0|P1|P2|P3]** — Location: [section/file reference]
  - Issue: [what is wrong]
  - Suggestion: [concrete fix recommendation]
  - Evidence: [quote or reference from the document supporting this finding]

Order comments by severity (P0 first).
P0: Critical blocker — must fix before proceeding
P1: Significant issue — should fix before proceeding
P2: Improvement — worth fixing if low effort
P3: Minor note — record only

## Summary
One to two sentences: overall assessment and primary reason for verdict.

Rules:
- APPROVE only if there are zero P0 and zero P1 findings
- REJECT if any P0 or P1 finding exists
- Every comment must cite a specific section, requirement, or code location from the provided documents
- Do not raise issues that are explicitly addressed in the Key Decisions section
</structured_output_contract>
```

## Common Grounding Rules (all gates)

```xml
<grounding_rules>
Ground every finding in the provided documents or observable project state.
Do not invent requirements, constraints, or failure scenarios not supported by the documents.
If a finding depends on an inference, state that explicitly.
Key Decisions in the spec represent deliberate, user-approved tradeoffs — do not re-litigate them unless you find concrete evidence they lead to a problem.
</grounding_rules>
```

---

## Gate: Spec Review

Use after Phase 1 (brainstorming → spec doc written).

```xml
<task>
You are reviewing a design specification document as an independent technical lead.
Your goal is to identify gaps, ambiguities, and feasibility concerns BEFORE implementation planning begins.

Key decisions made during brainstorming (do not re-litigate unless problematic):
[KEY_DECISIONS_SUMMARY]

<spec_document>
[SPEC_CONTENT]
</spec_document>

Review this spec for:
1. **Completeness**: Are all required behaviors specified? Are success/failure paths defined?
2. **Ambiguity**: Could any requirement be interpreted in multiple ways? Are boundary conditions clear?
3. **Feasibility**: Can this be implemented with the stated tech stack and constraints?
4. **Edge cases**: What scenarios are missing? What happens at boundaries, under failure, with empty/null inputs?
5. **Internal consistency**: Do different sections contradict each other?
</task>

<dig_deeper_nudge>
After finding the first issue, check for second-order problems: does fixing one gap reveal another?
Look for unstated assumptions about ordering, concurrency, data availability, and external dependencies.
</dig_deeper_nudge>
```

**Prompt assembly:** Concatenate: `<task>` + `<structured_output_contract>` + `<grounding_rules>` + `<dig_deeper_nudge>`

---

## Gate: Plan Review

Use after Phase 2 (writing-plans → impl plan + eval checklist written).

```xml
<task>
You are reviewing an implementation plan and its evaluation checklist as an independent technical lead.
Your goal is to verify the plan is complete, correctly decomposed, and will produce verifiable results.

Key decisions from spec (do not re-litigate unless problematic):
[KEY_DECISIONS_SUMMARY]

<spec_document>
[SPEC_CONTENT]
</spec_document>

<plan_document>
[PLAN_CONTENT]
</plan_document>

Review this plan for:
1. **Spec coverage**: Does every spec requirement map to at least one task? List any spec sections with no corresponding task.
2. **Task decomposition**: Are tasks appropriately sized? Are dependencies between tasks identified? Can tasks be worked independently?
3. **Eval checklist sufficiency**: Does the eval checklist cover all critical acceptance criteria from the spec? Are the pass/fail criteria objective and measurable?
4. **Risk identification**: Are risky areas called out? Are there tasks that could block the entire plan if they fail?
5. **Testability**: Can the implementation be verified incrementally, or only at the end?
</task>

<verification_loop>
Cross-check: for each section in the spec, confirm there is a plan task that addresses it.
For each eval checklist item, confirm it maps to a spec requirement.
Flag any spec requirement that has no eval coverage.
</verification_loop>
```

**Prompt assembly:** Concatenate: `<task>` + `<structured_output_contract>` + `<grounding_rules>` + `<verification_loop>`

---

## Gate: Eval Review

Use after Phase 6 (auto-verification report generated) for the Gate 7 eval checkpoint.

```xml
<task>
You are performing the final evaluation review as an independent technical lead.
Your goal is to verify that the implementation meets the spec requirements and passes all defined quality criteria.

Inputs (one of two shapes):
- Full flow:  [SPEC_CONTENT] + [PLAN_CONTENT] are two distinct documents.
- Light flow: [SPEC_CONTENT] is a combined design spec that embeds the implementation plan
              in a `## Implementation Plan` section; [PLAN_CONTENT] is not provided separately.
The `<plan_document>` block is optional: in light flow, omit it or replace it with a
single-line note `(light flow — plan is in spec.Implementation Plan)`.
To detect light flow: check whether the spec document contains a `## Implementation Plan` section.

<spec_document>
[SPEC_CONTENT]
</spec_document>

<plan_document>
[PLAN_CONTENT]
</plan_document>

<eval_report>
[EVAL_REPORT_CONTENT]
</eval_report>

<code_diff>
[GIT_DIFF_CONTENT]
</code_diff>

Review steps:
1. **Verification report review**: Go through each check result in the auto-verification report. If a check failed, flag it as P0. (The auto-verification report is the sole source for checklist pass/fail — no separate checklist artifact is provided.)
2. **Spec compliance**: For each spec requirement, verify the implementation addresses it. Flag unimplemented requirements as P0.
3. **Code quality**: Review the code diff for:
   - Correctness: does the logic match the spec?
   - Error handling: are failure paths handled?
   - Security: any obvious vulnerabilities (injection, auth bypass, data exposure)?
   - Maintainability: is the code understandable and well-structured?
4. **Auto-verify cross-check**: Do the test results in the report actually cover the spec requirements, or do they test trivial cases while missing critical paths?
</task>

<verification_loop>
Before finalizing your verdict:
- Verify each checklist item against the auto-verification report results
- Verify each spec section against the code diff
- If a checklist item passes but the underlying test does not cover the spec requirement meaningfully, flag this as P1

If you decide REJECT, classify each P0/P1 finding as:
- design-level  (requires spec/requirements revision)
- impl-level    (requires code-only change, spec is valid)
Then emit exactly one of: `Scope: design`, `Scope: impl`, or `Scope: mixed` as the next non-empty line after `REJECT` in the Verdict section.
</verification_loop>

<dig_deeper_nudge>
After reviewing the happy path, check:
- What happens with empty/null inputs?
- What happens when external dependencies fail?
- Are there race conditions or ordering assumptions?
- Is error state properly cleaned up?
</dig_deeper_nudge>

<meta_improvement_check>
If you identify a structural pattern that could have been caught earlier:
- In the spec phase (missing requirement pattern)
- In the plan phase (insufficient eval criteria pattern)
- In the implementation phase (recurring code quality issue)

Add a section at the end of your review:

## Meta Improvement Suggestion
- Pattern: [what keeps recurring]
- Recommendation: [where to add a pre-check to catch this earlier]
- Target: [which document/checklist/rule to update]

Only include this section if the pattern is structural (would affect future tasks), not if it is a one-off mistake.
</meta_improvement_check>
```

**Prompt assembly:** Concatenate: `<task>` + `<structured_output_contract>` + `<grounding_rules>` + `<verification_loop>` + `<dig_deeper_nudge>` + `<meta_improvement_check>`

---

## Prompt Assembly Checklist

When constructing a gate review prompt:

1. Select the gate-type-specific `<task>` block above
2. **Claude Code가 직접 파일을 Read하여 모든 placeholder를 실제 내용으로 교체한다** (경로 문자열을 넘기지 않는다)
   - `[SPEC_CONTENT]`: spec doc 전문
   - `[PLAN_CONTENT]`: impl plan 전문 (full flow only; light flow에서는 이 치환을 skip하고 `<plan_document>` 블록을 생략하거나 `(light flow — plan is in spec.Implementation Plan)` 한 줄로 대체)
   - `[EVAL_REPORT_CONTENT]`: auto-verification report 전문
   - `[KEY_DECISIONS_SUMMARY]`: spec의 "Context & Decisions" 섹션
   - `[GIT_DIFF_CONTENT]`: `git diff` 전문 (파일이 많으면 `git diff --stat` + 핵심 변경 파일 전문)
3. Append the common `<structured_output_contract>` and `<grounding_rules>`
4. Append gate-specific additional blocks (`<dig_deeper_nudge>`, `<verification_loop>`, `<meta_improvement_check>`)
5. Pass the assembled prompt to: `node <codex-companion-path> task --effort high "<prompt>"`
