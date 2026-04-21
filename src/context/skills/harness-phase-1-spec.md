---
name: harness-phase-1-spec
description: Use during phase-harness Phase 1 to brainstorm and write a spec that passes the harness spec gate (Phase 2).
---

# harness Phase 1 — Spec writing

## Context
당신은 phase-harness 파이프라인의 Phase 1에 있다. 산출물(spec)은 Phase 2에서 Codex가 다음 5축 rubric의 subset으로 평가한다:
- **Correctness** — 요구사항/비요구사항/경계조건/성공기준이 명시되었는가?
- **Readability** — 섹션 구성이 명확하고 모호한 표현이 없는가?
- **Scope** — 단일 구현 plan으로 분해 가능한 크기인가? 여러 독립 프로젝트가 섞이지 않았는가?

**Ambiguity policy (중요)**: Phase 1은 개발자와 직접 interaction하며 **지시의 의도와 설계 모호함을 해소하는 단계**다. 모호함·결정 필요·요구사항 공백이 발견되면 **산출물에 남기거나 다음 phase로 defer하지 말고, 이 세션에서 사용자에게 직접 질문해 해소**한다. gate는 해소되지 않은 질문을 처리하는 장치가 아니다.

## Inputs
- Task spec: @{{task_path}}
{{#if feedback_path}}
- Previous gate-2 feedback (반드시 반영): @{{feedback_path}}

  **Feedback triage (P1-only 정책)** — 각 comment에 대해:
  1. **P1 (blocker)**: 반드시 반영한다.
  2. **P2**: inline 반영이 ≤2 line edit이면 지금 수정한다. 그 외에는 spec 문서의 `## Deferred` 섹션에 1-2 line 항목으로 기록하고 진행한다.
  3. **severity 라벨 누락된 comment**: blocker 가정으로 처리한다. 단, 구조 변경이나 spec 재구성이 필요하다고 판단되면 이번 pass에서 inline 재구조화하지 말고 `## Deferred`로 보낸다.

  `## Deferred` 섹션이 spec에 없으면 파일 끝에 `## Deferred` 헤딩을 새로 만든 뒤 1-2 line 항목을 append한다. unlabeled comment라도 구조 변경이 필요하면 같은 경로로 defer한다.
{{/if}}

## Process
1. `superpowers:brainstorming` 스킬을 invoke한다. 다음 오버라이드를 전달한다:
   - `"Save spec to exact path: {{spec_path}} (do not use the skill's default location)"`
   - `"Include '## Context & Decisions' section at the top of the spec"`
   - `"ALSO include '## Complexity' section — body is exactly one of 'Small', 'Medium', or 'Large' (case-insensitive) on the next non-blank line, optionally followed by '— <one-line rationale>'. Phase 1 validator fails if the section is missing or the token is outside the 3-value enum. Use Small for a single-file / few-hundred-LoC change, Large for multi-module refactors or new subsystems, Medium for everything in between. Phase 3 assembler reads this token and injects a corresponding plan-depth directive."`
   - `"During brainstorming, resolve ambiguities by asking the developer directly in this session. Do NOT stash unresolved questions into the spec or defer them to later phases. If you would normally write an 'Open Questions' section, convert each item into a live question to the user and fold the answer into the spec before writing."`
   - `"Skip the 'User reviews written spec' step — Codex gate (Phase 2) replaces it"`
   - `"After spec is written, proceed immediately to step 2 (decisions log) below"`
2. Decision log를 `{{decisions_path}}`에 작성한다. spec의 "Context & Decisions" 섹션과 **중복되지 않도록** 각 결정의 *trade-off*와 *고려된 대안*을 기록한다.
3. **Pre-sentinel self-audit** — sentinel 쓰기 직전, 방금 작성한 spec을 다시 읽고 spec의 `## Success Criteria` / `## Invariants` 섹션과 대조한다. grep 또는 정규식 스캔 규칙이 적혀 있으면 모두 직접 확인하고, hit이 있으면 gate로 넘기지 말고 이번 pass에서 바로 수정한다. 각 gate round는 대략 40× local grep 비용이므로 여기서 먼저 정리한다. 수정이 있었다면 한 번 더 같은 검증을 반복(rerun)하고 clean 상태를 확인한 뒤에만 sentinel 단계로 이동한다.
4. **가장 마지막에** `.harness/{{runId}}/phase-1.done`을 생성하고 내용으로 `{{phaseAttemptId}}` 한 줄만 기록한다.

## Invariants
- sentinel 파일 생성 이후 하네스가 다음 단계로 넘어간다. 추가 작업 금지.
- spec 파일 경로는 `{{spec_path}}` 고정 (superpowers가 기본 경로를 제안해도 무시).
- "Context & Decisions" 섹션은 spec **상단**에 있어야 gate rubric의 Scope 축이 평가 가능.
- Ambiguity는 세션 내에서 개발자와 직접 해소한다. 미해소 질문을 spec/산출물에 남기거나 gate로 defer하지 않는다.
- "Complexity" 섹션 필수. 값은 Small / Medium / Large 중 하나. 값이 없거나 enum 밖이면 validator가 Phase 1을 실패로 간주한다.

**HARNESS FLOW CONSTRAINT**: 이 세션은 orchestrated harness 라이프사이클 내부에서 실행된다. 다음 phase에서 Codex 기반 독립 reviewer가 산출물을 검토한다(gate). 따라서:
- `advisor()` 툴을 호출하지 말 것. 외부 리뷰가 이미 예약되어 있다.
- 작업 범위는 이 프롬프트가 지시한 산출물 + 커밋 + sentinel 생성으로 제한한다.
- skill 자동 로드는 허용. 그러나 의사결정을 advisor에 위임하지 말고 자체적으로 결론을 낸다.
