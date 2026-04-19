다음 파일에서 태스크 설명을 읽고 요구사항을 분석한 뒤 **설계 + 구현 태스크 분해 + 체크리스트**를 하나의 결합 문서에 작성하라:
- Task: {{task_path}}
{{#if feedback_path}}
- 이전 리뷰 피드백 (반드시 반영 — 결합 문서의 관련 섹션을 diff-aware하게 수정하라): {{feedback_path}}
{{/if}}

결합 문서는 "{{spec_path}}" 경로에 작성한다. 아래 섹션을 **순서 그대로** 포함하라:

```
# <title> — Design Spec (Light)
## Complexity                   (필수 헤더, 정확히 이 텍스트 — 본문 첫 줄: Small / Medium / Large 중 하나, case-insensitive, 선택적 `— <한 줄 근거>`)
## Context & Decisions
## Requirements / Scope
## Design
## Implementation Plan       (필수 헤더, 정확히 이 텍스트)
  - Task 1: ...
  - Task 2: ...
## Eval Checklist Summary    (checklist.json 요약; 실제 검증 JSON은 별도 파일)
```

`## Complexity` 섹션은 정확히 `Small`, `Medium`, `Large` 중 하나를 첫 non-blank 라인에 기록하라 (case-insensitive, 선택적 `— <한 줄 근거>` 허용). 섹션이 누락되거나 값이 enum을 벗어나면 harness는 Phase 1을 실패로 간주한다. Small이면 Implementation Plan은 최대 3 tasks + per-function 의사코드 금지로 자기 제약하라.

**Ambiguity policy**: 설계 중 모호함·결정 공백이 발견되면 산출물에 남기거나 다음 phase로 미루지 말고 **이 세션에서 사용자에게 직접 질문해 해소**하라. 별도 "Open Questions" 섹션은 만들지 않는다 — 모든 질문은 대답을 받아 Design / Decisions 섹션에 반영한 뒤 문서를 닫는다.

`## Implementation Plan` 섹션은 구현 태스크를 각각 1개 이상 체크리스트 아이템(또는 번호 목록)으로 분해하라. 본 섹션이 누락되면 harness는 Phase 1을 실패로 간주한다.

Decision Log는 "{{decisions_path}}" 경로에 별도 파일로 작성하라.

Eval Checklist는 "{{checklist_path}}" 경로에 아래 JSON 스키마로 저장하라:
```json
{
  "checks": [
    { "name": "<검증 항목 이름>", "command": "<실행 커맨드>" }
  ]
}
```
`checks` 배열은 비어있지 않아야 하며 각 항목에 `name`(string)과 `command`(string)이 필수다.

각 check command는 격리된 셸 환경에서 실행된다. venv/node_modules 등 의존성을 요구하는 검증은 절대경로 바이너리(`.venv/bin/python -m pytest`, `./node_modules/.bin/eslint`)나 env-aware 래퍼(`make test`, `pnpm test`)를 사용하라.

작업을 모두 마친 뒤 `.harness/{{runId}}/phase-1.done` 파일을 생성하되 내용으로 '{{phaseAttemptId}}' 한 줄만 기록하라.

**CRITICAL: sentinel 파일(phase-1.done)은 모든 작업(파일 작성, git commit 포함)이 완료된 후 가장 마지막에 생성하라. sentinel 생성 이후 하네스는 다음 단계(impl)로 넘어가므로 추가 작업을 하지 말 것.**

**HARNESS FLOW CONSTRAINT**: 이 세션은 orchestrated harness 라이프사이클(light flow) 내부에서 실행된다. spec-gate와 plan-gate는 이 플로우에서 skip 된다. 다음 phase(구현)은 이 결합 문서를 읽고 바로 코드를 작성하므로:
- `advisor()` 툴을 호출하지 말 것. 외부 리뷰가 Gate 7에서 예약되어 있다.
- 작업 범위는 이 프롬프트가 지시한 산출물(결합 문서 + decisions.md + checklist.json) + 커밋 + sentinel 생성으로 제한한다.
- skill 자동 로드는 허용. 그러나 의사결정을 advisor에 위임하지 말고 자체적으로 결론을 낸다.
