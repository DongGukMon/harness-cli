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
0. **(Scaffolding only — prevention-first gitignore)** 구현을 시작하기 전에 대상 언어·프레임워크의 표준 `.gitignore` 엔트리(예: `__pycache__/`, `.pytest_cache/`, `.venv/`, `node_modules/`, `dist/`, `build/`, `.DS_Store`)를 프로젝트 루트 `.gitignore`에 보강한다. 기존 `.gitignore`가 이미 해당 엔트리를 포함하면 no-op. 이 변경은 `chore: add standard gitignore entries` 등 **독립된 scaffolding commit**으로 두고, impl 커밋과 섞지 않는다. Sentinel 직전에 `git status --porcelain`을 셀프 체크해 tracked 파일이 전부 커밋된 상태인지 확인한다. 하네스에 자동 recovery가 있어도 이 단계는 효율성과 로그 가독성 측면에서 값어치가 있다.
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
- Reopen 시 artifact를 변경하지 않아도 phase는 valid — sentinel attemptId 매칭이 freshness의 근거다. Claude가 gate 피드백이 rev-invariant(현 산출물로 반박 가능)하다고 판단하면 **건드리지 않는 것이 옳다**. (대응: ADR-13 symmetric reopen + T1 mtime drop.)

**HARNESS FLOW CONSTRAINT**: 이 세션은 orchestrated harness 라이프사이클 내부에서 실행된다. 다음 phase에서 Codex 기반 독립 reviewer가 산출물을 검토한다(gate). 따라서:
- `advisor()` 툴을 호출하지 말 것. 외부 리뷰가 이미 예약되어 있다.
- 작업 범위는 이 프롬프트가 지시한 산출물 + 커밋 + sentinel 생성으로 제한한다.
- skill 자동 로드는 허용. 그러나 의사결정을 advisor에 위임하지 말고 자체적으로 결론을 낸다.
