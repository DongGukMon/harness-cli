---
name: harness-phase-5-implement
description: Use during phase-harness Phase 5 to implement the plan with harness invariants (commits, context management, git discipline).
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

  **Feedback triage (P1-only 정책 · Phase 5 전용)** — 각 comment에 대해:
  1. **P1 (blocker · impl-only fix)**: 구현 파일 변경만으로 해결되면 반드시 반영한다.
  2. **P2 (impl/worktree origin)**: 대상이 src/, tests/ 등 Phase 5 worktree 변경 범위이고 ≤2 line inline fix로 해소되면 지금 수정한다. 그 외에는 plan 문서 하단 `## Deferred` 섹션에 1-2 line 항목을 append하고 `plan: append deferred item` 커밋으로 넘긴다. spec/plan 재구조화는 금지다.
  3. **severity 누락**: blocker 가정으로 처리한다.
  4. **spec/plan 재구조화가 필요한 P1**: 구현 쪽은 그대로 두고 plan 문서의 `## Deferred` 섹션에 `spec-bug: <detail>` 1-2 line을 append한 뒤 `plan: append deferred item` 커밋으로 escalation한다. 태그는 reviewer에게 informational signal로만 제공되며 gate 자동 완화는 없다.
  4a. **plan 또는 eval checklist 자체 결함으로 인한 P1**: `plan-bug: <detail>`를 `## Deferred`에 append하고 `plan: append deferred item` 커밋으로 escalation한다. 해당 P1이 지적한 단일 요소만 최소 수정하는 narrow, targeted 수정을 허용한다. 예: 잘못된 `checks[].command` 한 줄 교체, 틀린 regex 한 개 수정. plan 전체 재구조화는 여전히 금지다.
  5. **다중 피드백 충돌**: 동일 쟁점은 `동일 파일/영역 + 동일 요구 변경(문구 차이 무관)`으로 정의한다. 서로 다른 severity면 highest severity wins, 동일 severity면 한 번만 반영한다.

  세 escalation 카테고리(`spec-bug:`, `plan-bug:`, 일반 defer)는 모두 plan 문서의 `## Deferred` 섹션에 기록한다. `## Deferred`가 없으면 파일 끝에 새로 만들고 append한다. unlabeled comment라도 구조 변경이나 spec/plan 재구조화가 필요하면 같은 경로로 보낸다.
{{/if}}

## Auxiliary playbooks (참조, @ 표기로 inline 로드)
superpowers가 커버하지 않는 두 원칙을 지킨다:
- Context management: @{{playbookDir}}/context-engineering.md
- Git workflow: @{{playbookDir}}/git-workflow-and-versioning.md

*(`{{playbookDir}}`는 phase-harness 설치 디렉터리(dist 또는 src) 내부의 `playbooks/` 경로로 assembler가 해결한다.)*

## Process
0. **(Scaffolding only — prevention-first gitignore)** 구현을 시작하기 전에 대상 언어·프레임워크의 표준 `.gitignore` 엔트리(예: `__pycache__/`, `.pytest_cache/`, `.venv/`, `node_modules/`, `dist/`, `build/`, `.DS_Store`)를 프로젝트 루트 `.gitignore`에 보강한다. 기존 `.gitignore`가 이미 해당 엔트리를 포함하면 no-op. 이 변경은 `chore: add standard gitignore entries` 등 **독립된 scaffolding commit**으로 두고, impl 커밋과 섞지 않는다. Sentinel 직전에 `git status --porcelain`을 셀프 체크해 tracked 파일이 전부 커밋된 상태인지 확인한다. 하네스에 자동 recovery가 있어도 이 단계는 효율성과 로그 가독성 측면에서 값어치가 있다.
1. 기본 sub-skill로 `superpowers:subagent-driven-development`를 invoke한다. 단일 세션 구현이 plan에서 적합하다고 판단되면 `superpowers:executing-plans`를 대안으로 쓸 수 있다. 어느 경우든 다음 오버라이드를 전달한다:
   - `"After each task completes, git commit the changes. Do not defer commits to the end."`
   - `"Do NOT create .harness/{{runId}}/phase-5.done until ALL tasks in the plan are committed."`
   - `"If Content Filter rejects a subagent dispatch, fall back to direct in-session implementation and record the fallback in the task note."`
2. 구현 중 위 Auxiliary playbooks의 원칙(원자적 커밋, 수직 슬라이스, 컨텍스트 prune)을 적용한다.
3. **Pre-sentinel self-audit** — sentinel 쓰기 직전, 이번 phase의 commits 합집합을 다시 확인한다.
   - `BASE=$(jq -r .baseCommit .harness/{{runId}}/state.json)`로 `state.json`의 `baseCommit` 값을 읽는다. 빈 값이면 `echo 'WARN: skip self-audit (empty baseCommit)' >&2` 후 self-audit을 건너뛰고 sentinel 단계로 진행한다.
   - `git diff "$BASE"...HEAD`를 기준으로 변경된 tracked files를 검토한다. 이 범위는 `baseCommit...HEAD`와 동일한 three-dot 범위다.
   - 검증 원천은 두 가지다. (a) spec의 `## Success Criteria` / `## Invariants` 섹션에 적힌 grep/정규식 규칙은 직접 실행한다. (b) plan의 eval checklist `checks[].command`는 inspect-only로 다루고 실행하지 않는다. 대신 해당 command들이 spec의 grep/regex 규칙을 빠짐없이 커버하는지만 정적으로 검토한다.
   - hit이 구현 수정으로 해결 가능하면 이번 pass에서 바로 수정하고, 수정이 있었다면 한 번 더 같은 검증을 반복(rerun)한 뒤 clean 상태를 확인하고 넘어간다. 각 gate round는 대략 40× local grep 비용이므로 gate로 넘기기 전에 여기서 정리한다.
   - hit이 구현 수정만으로 해결 불가하면 **plan 문서 하단 `## Deferred` 섹션**에 `spec-bug: <detail>` 또는 `plan-bug: <detail>`를 append하고 `plan: append deferred item` 커밋으로 escalation한다. 해당 plan 문서에 `## Deferred` 섹션이 없으면 파일 끝에 새로 헤딩을 만든 뒤 append한다. 이 escalation 경로는 feedback 블록과 독립적이며 첫 패스에서도 동일하게 적용된다. 해결 불가 항목은 reviewer가 참고할 signal이지만 자동 완화는 없다.
4. 모든 태스크 구현 + 커밋 완료 후 **가장 마지막에** `.harness/{{runId}}/phase-5.done`을 생성하고 `{{phaseAttemptId}}` 한 줄만 기록.

## Invariants
- sentinel 이전에 모든 변경사항이 **git에 커밋**되어야 한다. Phase 7 eval은 diff 기반이므로 uncommitted 변경은 보이지 않음.
- sentinel 이후 추가 작업 금지.
- Content Filter로 subagent dispatch 실패 시 fallback → 직접 구현 + 로그 남김 (plan의 각 task 하단에 `fallback: direct` 메모).
- Reopen 시 artifact를 변경하지 않아도 phase는 valid — sentinel attemptId 매칭이 freshness의 근거다. Claude가 gate 피드백이 rev-invariant(현 산출물로 반박 가능)하다고 판단하면 **건드리지 않는 것이 옳다**. (대응: ADR-13 symmetric reopen + T1 mtime drop.)
- **예외**: 현 round feedback이 **"still unresolved"**, **"still persists"**, **"fix was insufficient"** 등으로 이전 round 의 수정이 부족하다고 명시하면 rev-invariant 판단을 해서는 안 된다. 직전 reopen 이 해당 이슈에 대해 커밋을 생성했더라도, 현재 feedback 이 그것을 불충분으로 지목한 이상 **추가 수정 또는 `plan-bug:`/`spec-bug:` escalation** 중 하나를 반드시 수행한다. "이미 이전 세션에서 처리했다"는 판단으로 zero-commit 종료하지 말 것.

**HARNESS FLOW CONSTRAINT**: 이 세션은 orchestrated harness 라이프사이클 내부에서 실행된다. 다음 phase에서 Codex 기반 독립 reviewer가 산출물을 검토한다(gate). 따라서:
- `advisor()` 툴을 호출하지 말 것. 외부 리뷰가 이미 예약되어 있다.
- 작업 범위는 이 프롬프트가 지시한 산출물 + 커밋 + sentinel 생성으로 제한한다.
- skill 자동 로드는 허용. 그러나 의사결정을 advisor에 위임하지 말고 자체적으로 결론을 낸다.
