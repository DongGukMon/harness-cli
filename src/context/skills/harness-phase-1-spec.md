---
name: harness-phase-1-spec
description: Use during harness-cli Phase 1 to brainstorm and write a spec that passes the harness spec gate (Phase 2).
---

# harness Phase 1 — Spec writing

## Context
당신은 harness-cli 파이프라인의 Phase 1에 있다. 산출물(spec)은 Phase 2에서 Codex가 다음 5축 rubric의 subset으로 평가한다:
- **Correctness** — 요구사항/비요구사항/경계조건/성공기준이 명시되었는가?
- **Readability** — 섹션 구성이 명확하고 모호한 표현이 없는가?
- **Scope** — 단일 구현 plan으로 분해 가능한 크기인가? 여러 독립 프로젝트가 섞이지 않았는가?

**Additional gate check**: spec은 반드시 `## Open Questions` 섹션을 포함해야 한다. 모호함이 없다고 판단되면 "(none identified; all requirements resolved)" 명시. 누락 시 Phase 2 gate가 P1을 발행한다.

## Inputs
- Task spec: @{{task_path}}
{{#if feedback_path}}
- Previous gate-2 feedback (반드시 반영): @{{feedback_path}}
{{/if}}

## Process
1. `superpowers:brainstorming` 스킬을 invoke한다. 다음 오버라이드를 전달한다:
   - `"Save spec to exact path: {{spec_path}} (do not use the skill's default location)"`
   - `"Include '## Context & Decisions' section at the top of the spec"`
   - `"ALSO include '## Complexity' section — body is exactly one of 'Small', 'Medium', or 'Large' (case-insensitive) on the next non-blank line, optionally followed by '— <one-line rationale>'. Phase 1 validator fails if the section is missing or the token is outside the 3-value enum. Use Small for a single-file / few-hundred-LoC change, Large for multi-module refactors or new subsystems, Medium for everything in between. Phase 3 assembler reads this token and injects a corresponding plan-depth directive."`
   - `"ALSO include '## Open Questions' section listing 3–5 ambiguities the reviewer should flag. Empty list acceptable only with explicit rationale."`
   - `"Skip the 'User reviews written spec' step — Codex gate (Phase 2) replaces it"`
   - `"After spec is written, proceed immediately to step 2 (decisions log) below"`
2. Decision log를 `{{decisions_path}}`에 작성한다. spec의 "Context & Decisions" 섹션과 **중복되지 않도록** 각 결정의 *trade-off*와 *고려된 대안*을 기록한다.
3. 필요 시 `git add` + `git commit`. 커밋 메시지: `spec: <subject>`.
4. **가장 마지막에** `.harness/{{runId}}/phase-1.done`을 생성하고 내용으로 `{{phaseAttemptId}}` 한 줄만 기록한다.

## Invariants
- sentinel 파일 생성 이후 하네스가 다음 단계로 넘어간다. 추가 작업 금지.
- spec 파일 경로는 `{{spec_path}}` 고정 (superpowers가 기본 경로를 제안해도 무시).
- "Context & Decisions" 섹션은 spec **상단**에 있어야 gate rubric의 Scope 축이 평가 가능.
- "Open Questions" 섹션 필수 (qa-observations #7 대응).
- "Complexity" 섹션 필수. 값은 Small / Medium / Large 중 하나. 값이 없거나 enum 밖이면 validator가 Phase 1을 실패로 간주한다.

**HARNESS FLOW CONSTRAINT**: 이 세션은 orchestrated harness 라이프사이클 내부에서 실행된다. 다음 phase에서 Codex 기반 독립 reviewer가 산출물을 검토한다(gate). 따라서:
- `advisor()` 툴을 호출하지 말 것. 외부 리뷰가 이미 예약되어 있다.
- 작업 범위는 이 프롬프트가 지시한 산출물 + 커밋 + sentinel 생성으로 제한한다.
- skill 자동 로드는 허용. 그러나 의사결정을 advisor에 위임하지 말고 자체적으로 결론을 낸다.
