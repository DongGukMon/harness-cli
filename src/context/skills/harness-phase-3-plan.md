---
name: harness-phase-3-plan
description: Use during phase-harness Phase 3 to write an implementation plan + eval checklist that passes the harness plan gate (Phase 4).
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
{{#if feedback_path}}
- Previous gate-4 feedback (반드시 반영): @{{feedback_path}}

  **Feedback triage (P1-only 정책)** — 이 phase에서는 rendered feedback file 하나를 기준으로 각 comment를 처리한다:
  1. **P1 (blocker)**: 반드시 반영한다.
  2. **P2**: inline 반영이 ≤2 line edit이면 지금 수정한다. 그 외에는 plan 문서의 `## Deferred` 섹션에 1-2 line 항목으로 기록하고 진행한다.
  3. **severity 라벨 누락된 comment**: blocker 가정으로 처리한다. 단, 구조 변경이나 plan 재구성이 필요하다고 판단되면 이번 pass에서 inline 재구조화하지 말고 `## Deferred`로 보낸다.

  `## Deferred` 섹션이 plan에 없으면 파일 끝에 `## Deferred` 헤딩을 새로 만든 뒤 1-2 line 항목을 append한다. unlabeled comment라도 구조 변경이 필요하면 같은 경로로 defer한다.
{{/if}}

## Process
0. **Respect the Complexity Directive block.** 프롬프트 최상단에 harness assembler가 Complexity Directive 블록을 주입했을 수 있다 (Small/Large일 때만 비어있지 않은 블록이 나타나고, Medium이거나 signal이 누락/무효면 블록 자체가 없다). 블록이 존재하면 그 지시를 먼저 내재화한다:
   - **Small** → plan은 최대 3 tasks, per-function 의사코드·ASCII diagram 금지, `checklist.json`은 4개 이하 `checks`로 제한 (typecheck + test + build 조합이 통상 충분). 관련 edit은 한 task로 번들링.
   - **Large** → vertical slice 단위로 분해 + dependency 순서 명시 + architecturally-relevant 결정은 짧은 ADR blurb으로 plan 내 inline 기록. Depth는 표준과 동일.
   - **블록이 없음 (Medium 또는 fallback)** → 표준 depth. 추가 제약 없음.
   spec의 `## Complexity` 값이 assembler의 directive와 일치해야 한다. 불일치·누락 상황이면 Medium으로 fallback한 경고가 stderr에 찍혀있을 것 — `superpowers:writing-plans` 시작 전에 블록을 1회 명시적으로 읽고 반영 계획을 세운 뒤 다음 step으로 진행.
1. `superpowers:writing-plans` 스킬을 invoke한다. 다음 오버라이드를 전달한다:
   - `"Save plan to exact path: {{plan_path}} (do not use the skill's default location)"`
   - `"After the plan is written, you MUST ALSO produce a machine-readable eval checklist at {{checklist_path}} (see step 2 below). This is non-negotiable — Phase 6 verify reads it."`
   - `"If a Complexity Directive block is injected above (Small → ≤3 tasks; Large → ADR blurbs; no block → standard), obey it. The ceiling on tasks / pseudocode is not a suggestion."`
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
4. **Pre-sentinel self-audit** — sentinel 쓰기 직전, 방금 작성한 plan을 다시 읽고 spec의 `## Success Criteria` / `## Invariants` 섹션과 대조한다. eval checklist도 함께 읽어 spec의 grep-rule / 정규식 규칙이 빠짐없이 들어갔는지 확인한다. hit이 있으면 gate로 넘기지 말고 이번 pass에서 바로 수정한다. 각 gate round는 대략 40× local grep 비용이므로 여기서 먼저 정리한다. 수정이 있었다면 한 번 더 같은 검증을 반복(rerun)하고 clean 상태를 확인한 뒤에만 sentinel 단계로 이동한다.
5. **가장 마지막에** `.harness/{{runId}}/phase-3.done`을 생성하고 `{{phaseAttemptId}}` 한 줄만 기록.

## Invariants
- sentinel 이후 추가 작업 금지.
- plan 파일 경로는 `{{plan_path}}` 고정.
- checklist JSON 스키마 위반 시 `scripts/harness-verify.sh`가 실패. 스키마 정확히 준수.
- Complexity Directive 블록(있을 경우)의 지시는 non-optional. Small 분류에서 3 tasks 초과 / per-function 의사코드 삽입은 gate 리뷰어가 P1으로 잡을 근거가 된다.

**HARNESS FLOW CONSTRAINT**: 이 세션은 orchestrated harness 라이프사이클 내부에서 실행된다. 다음 phase에서 Codex 기반 독립 reviewer가 산출물을 검토한다(gate). 따라서:
- `advisor()` 툴을 호출하지 말 것. 외부 리뷰가 이미 예약되어 있다.
- 작업 범위는 이 프롬프트가 지시한 산출물 + 커밋 + sentinel 생성으로 제한한다.
- skill 자동 로드는 허용. 그러나 의사결정을 advisor에 위임하지 말고 자체적으로 결론을 낸다.
