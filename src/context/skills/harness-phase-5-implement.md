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
- Previous feedback (gate-7 또는 verify에서 온): {{feedback_paths}}

## Auxiliary playbooks (참조, @ 표기로 inline 로드)
superpowers가 커버하지 않는 두 원칙을 지킨다:
- Context management: @{{harnessDir}}/../dist/src/context/playbooks/context-engineering.md
- Git workflow: @{{harnessDir}}/../dist/src/context/playbooks/git-workflow-and-versioning.md

*(경로는 harness runtime이 dist에서 실행될 때 기준. 개발 환경에서는 `src/context/playbooks/` 하위.)*

## Process
1. Plan 헤더에 명시된 sub-skill을 invoke한다 (기본: `superpowers:subagent-driven-development`, 대안: `superpowers:executing-plans`). 다음 오버라이드를 전달한다:
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
