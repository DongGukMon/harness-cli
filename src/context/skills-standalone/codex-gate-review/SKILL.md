---
name: phase-harness-codex-gate-review
description: "Use when a harness gate review is needed — after spec writing (gate spec), after plan writing (gate plan), or after implementation + auto-verification (gate eval). Orchestrates Codex as independent reviewer with structured verdict."
user-invocable: true
---

# Codex Gate Review

Run a structured Codex review at a harness gate checkpoint. Codex acts as an independent reviewer (Team Lead role) while Claude Code acts as the author (Engineer role).

## Gate Types

| Gate | When | Input | Review Focus |
|------|------|-------|-------------|
| `spec` | After brainstorming → spec doc written | spec doc | Completeness, ambiguity, feasibility, missing edge cases |
| `plan` | After writing-plans → impl plan written | plan + checklist + spec | Task decomposition, eval criteria sufficiency, risks |
| `eval` | After implementation + auto-verify | verification report + diff + spec [+ plan if full flow] | Spec compliance, verify-report pass/fail, code quality |

## Invocation

This skill is invoked as part of the harness lifecycle (see `harness-lifecycle` rules in global CLAUDE.md). It can also be invoked manually:

```
/phase-harness-codex-gate-review --gate spec
/phase-harness-codex-gate-review --gate plan
/phase-harness-codex-gate-review --gate eval
```

## Protocol

### Step 1: Assemble Review Package

**Claude Code가 직접 파일을 읽고 내용을 추출한다. 경로만 넘기지 않는다.**

**Gate spec:**
- spec doc 전문을 Read → `[SPEC_CONTENT]`에 삽입
- "Context & Decisions" 섹션 추출 → `[KEY_DECISIONS_SUMMARY]`에 삽입

**Gate plan:**
- spec doc 전문을 Read → `[SPEC_CONTENT]`에 삽입
- impl plan 전문을 Read → `[PLAN_CONTENT]`에 삽입
- "Context & Decisions" 섹션 추출 → `[KEY_DECISIONS_SUMMARY]`에 삽입

**Gate eval:**
- spec doc 전문을 Read → `[SPEC_CONTENT]`에 삽입
- impl plan 이 별도 파일로 존재하면(full flow) 전문을 Read → `[PLAN_CONTENT]`에 삽입
- impl plan 이 spec 의 `## Implementation Plan` 섹션으로 내장되어 있으면(light flow)
  `[PLAN_CONTENT]` 블록은 생략하거나 `(light flow — plan embedded in spec)` 주석으로 대체
  (감지 방법: spec doc 에 `## Implementation Plan` 섹션이 있으면 light flow)
- auto-verification report 전문을 Read → `[EVAL_REPORT_CONTENT]`에 삽입
- `git diff` 실행 → `[GIT_DIFF_CONTENT]`에 삽입 (파일이 많으면 `--stat` 요약 + 핵심 변경 파일 전문)

Note: `phase-harness` light flow uses a combined design spec; `--gate eval` detects this automatically via the `## Implementation Plan` section presence.

### Step 2: Construct Codex Prompt

Use the gate-specific prompt template from [gate-prompts.md](gate-prompts.md).

Key rules:
- 모든 `[PLACEHOLDER]`를 실제 파일 내용으로 교체한다 (경로 문자열 금지)
- Use XML block structure per `gpt-5-4-prompting` conventions
- Every prompt includes `<task>`, `<structured_output_contract>`, `<grounding_rules>`
- Gate eval additionally includes `<verification_loop>` for cross-checking auto-verify results

### Step 3: Execute Codex Task

**직접 실행한다. codex:codex-rescue 서브에이전트를 사용하지 않는다.** 서브에이전트는 권한 프롬프트를 처리할 수 없어서 reject될 수 있다.

Claude Code가 직접 Bash로 실행:

```bash
node ~/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs task --effort high "<assembled prompt>"
```

The Codex task runs in read-only sandbox. Do NOT use `--write`.

### Step 4: Parse Verdict and Route

The Codex response will follow the structured output contract. Parse the verdict:

**If `approve`:**
- Log the review summary
- Record any P2/P3 comments
- Handle P2/P3 per rules:
  - Claude Code agrees + low effort → apply improvement, re-run auto-verify, re-submit to gate
  - Claude Code agrees + high effort → record as deferred task, proceed
  - Claude Code disagrees → record as comment, proceed
- Proceed to next phase

**If `reject`:**
- Review each comment (P0/P1 issues)
- Claude Code assesses each issue:
  - **Agrees:** 사용자에게 묻지 않고 즉시 수정하고 재제출한다. "수정할까요?", "진행할까요?" 등의 질문을 하지 않는다.
  - **Disagrees:** Enter disagreement resolution (see below)

### Disagreement Resolution

Track disagreement count **per individual issue**, not per gate submission.

**Default mode:**
1. Claude Code presents counter-argument to the issue
2. Re-submit with explanation of why the approach is valid
3. If Codex rejects the same issue again (attempt 2), try once more with additional context
4. If still rejected (attempt 3+), escalate to user:
   > "Codex와 이 안건에 대해 합의하지 못했습니다. 논점: [issue summary]. 판단해주세요."

**Autonomous mode** (activated when user says "에스컬레이션 없이 진행"):
1-3. Same as default
4. On attempt 4 for the same issue: force-pass this specific issue, continue to next
   - Log: "자율 모드: [issue] 안건 강제 통과 (4회 거절)"

**User override** (any time):
- User says "내가 승인할게" → skip remaining gate review, approve
- User says "이건 별도 태스크로" → record issue as deferred, approve current gate

## Output

After gate completion, summarize:

```
## Gate [type] Result: [APPROVED/REJECTED]
- Verdict: approve/reject
- P0 issues: N
- P1 issues: N
- P2/P3 comments: N (M applied, K deferred)
- Disagreements resolved: N
- Escalations: N
```
