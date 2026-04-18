---
name: harness-phase-5-implement
description: Use during harness-cli Phase 5 to implement the plan with harness invariants (commits, context management, git discipline).
---

# harness Phase 5 — Implementation

## Context
Phase 6의 자동 verify가 `{{checklist_path}}`의 모든 `command`를 독립 셸에서 실행한다. Phase 7에서 Codex가 spec + plan + eval report + diff을 5축(correctness/readability/architecture/security/performance)으로 종합 평가한다.

## Inputs
- Spec: @{{spec_path}}
- Plan: @{{plan_path}}
- Decision log: @{{decisions_path}}
- Checklist: @{{checklist_path}}
{{#if feedback_paths}}
- Previous feedback(s) — gate-7 또는 verify에서 온 (반드시 반영):
{{feedback_paths}}
{{/if}}

## Auxiliary playbooks (참조, @ 표기로 inline 로드)
superpowers가 커버하지 않는 두 원칙을 지킨다:
- Context management: @{{playbookDir}}/context-engineering.md
- Git workflow: @{{playbookDir}}/git-workflow-and-versioning.md

*(`{{playbookDir}}`는 harness-cli 설치 디렉터리(dist 또는 src) 내부의 `playbooks/` 경로로 assembler가 해결한다.)*

## Process
1. 기본 sub-skill로 `superpowers:subagent-driven-development`를 invoke한다. 단일 세션 구현이 plan에서 적합하다고 판단되면 `superpowers:executing-plans`를 대안으로 쓸 수 있다. 어느 경우든 다음 오버라이드를 전달한다:
   - `"After each task completes, git commit the changes. Do not defer commits to the end."`
   - `"Do NOT create .harness/{{runId}}/phase-5.done until ALL tasks in the plan are committed."`
   - `"If Content Filter rejects a subagent dispatch, fall back to direct in-session implementation and record the fallback in the task note."`
2. 구현 중 위 Auxiliary playbooks의 원칙(원자적 커밋, 수직 슬라이스, 컨텍스트 prune)을 적용한다.
3. 모든 태스크 구현 + 커밋 완료 후 **가장 마지막에** `.harness/{{runId}}/phase-5.done`을 생성하고 `{{phaseAttemptId}}` 한 줄만 기록.

## Invariants
- sentinel 이전에 모든 변경사항이 **git에 커밋**되어야 한다. Phase 7 eval은 diff 기반이므로 uncommitted 변경은 보이지 않음.
- sentinel 이후 추가 작업 금지.
- Content Filter로 subagent dispatch 실패 시 fallback → 직접 구현 + 로그 남김 (plan의 각 task 하단에 `fallback: direct` 메모).
- Reopen 시 gitignored artifact만 수정한 경우(예: `.harness/<runId>/checklist.json` 수정) 새 커밋 없이도 phase-5 valid (spec §Bug D 대응).

**HARNESS FLOW CONSTRAINT**: 이 세션은 orchestrated harness 라이프사이클 내부에서 실행된다. 다음 phase에서 Codex 기반 독립 reviewer가 산출물을 검토한다(gate). 따라서:
- `advisor()` 툴을 호출하지 말 것. 외부 리뷰가 이미 예약되어 있다.
- 작업 범위는 이 프롬프트가 지시한 산출물 + 커밋 + sentinel 생성으로 제한한다.
- skill 자동 로드는 허용. 그러나 의사결정을 advisor에 위임하지 말고 자체적으로 결론을 낸다.
