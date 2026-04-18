---
name: harness-phase-3-plan
description: Use during harness-cli Phase 3 to write an implementation plan + eval checklist that passes the harness plan gate (Phase 4).
---

# harness Phase 3 — Planning

## Context
Phase 4에서 Codex가 다음 축으로 평가한다:
- **Correctness** — plan이 spec의 모든 요구사항을 커버하는가?
- **Architecture** — 태스크 분해가 수직 슬라이스인가? 의존성 순서가 명확한가?
- **Testability** — 각 태스크에 수용 기준과 검증 절차(테스트 or 수동 확인)가 명시되었는가?
- **Readability** — 맥락 없이 태스크 하나만 집어도 수행 가능한가?

## Inputs
- Spec: @{{spec_path}}
- Decision log: @{{decisions_path}}
- Previous gate-4 feedback (있다면 반영): {{feedback_path}}

## Process
1. `superpowers:writing-plans` 스킬을 invoke한다. 다음 오버라이드를 전달한다:
   - `"Save plan to exact path: {{plan_path}} (do not use the skill's default location)"`
   - `"After the plan is written, you MUST ALSO produce a machine-readable eval checklist at {{checklist_path}} (see step 2 below). This is non-negotiable — Phase 6 verify reads it."`
2. Eval checklist를 `{{checklist_path}}`에 **정확히 다음 JSON 스키마**로 저장한다:
   ```json
   {
     "checks": [
       { "name": "<검증 항목 이름>", "command": "<실행 커맨드>" }
     ]
   }
   ```
   - `checks` 배열은 비어있지 않아야 함.
   - 각 항목은 `name`(string), `command`(string) 필수. 다른 키 금지.
   - 각 `command`는 **격리된 셸 환경에서 실행**된다. 절대경로 바이너리(`.venv/bin/pytest`) 또는 env-aware 래퍼(`make test`)를 사용할 것. 글로벌 PATH에만 있는 도구는 피함 (qa-observations #4 대응).
   - UI/시각적 변경이 있는 태스크가 있다면 스크린샷/시각 검증 항목을 적어도 한 건 추가.
3. 필요 시 `git commit -m "plan: <subject>"`.
4. **가장 마지막에** `.harness/{{runId}}/phase-3.done`을 생성하고 `{{phaseAttemptId}}` 한 줄만 기록.

## Invariants
- sentinel 이후 추가 작업 금지.
- plan 파일 경로는 `{{plan_path}}` 고정.
- checklist JSON 스키마 위반 시 `scripts/harness-verify.sh`가 실패. 스키마 정확히 준수.
- Plan은 spec의 "Open Questions" 항목을 태스크 레벨에서 해소하거나 명시적으로 defer해야 함.
