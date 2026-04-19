# HANDOFF — harness-cli 3종 UX 결함 해소 (spec 완료, plan 미작성)

**Paused at**: 2026-04-19 (local)
**Worktree**: /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/debugging
**Branch**: debugging
**Base prompt**: `docs/specs/2026-04-19-phase5-softening-and-terminal-ui-design.md` (이번 세션에서 작성한 spec)
**Reason**: token exhaustion / account switch

## Completed commits (이 worktree에서)

base = `93f828a` (origin/main merge-base)

- 8649663 docs(spec): phase 5 softening + terminal-state UI + render instrumentation

## In-progress state

- **현재 task**: Spec 작성 완료. 다음은 `superpowers:writing-plans` 스킬로 implementation plan 작성.
- **마지막 완료 step**: `docs/specs/2026-04-19-phase5-softening-and-terminal-ui-design.md` 작성 + 커밋 (8649663).
- **중단 직전 하던 action**: handoff 준비. 소스 코드 변경 없음.
- **테스트 상태**: 미실행 (spec-only 작업, 코드 변경 없음)
- **빌드 상태**: 미실행 (spec-only 작업)
- **uncommitted 잔여물**: none

## Harness CLI 진행 중이면 (아니면 "N/A"로 남기고 skip)

N/A — 이번 세션은 harness run/start로 실행된 게 아니라 superpowers:brainstorming으로 설계만 진행. 이전 runId `2026-04-19-untitled-2`는 이 worktree가 아닌 다른 worktree(`worktrees/light-pre-impl-gate`)에서 실행된 failed 세션이고, 본 spec이 그 세션의 실패 원인 3종을 해소하려는 후속 작업임. 해당 세션은 복구 대상 아님 (HANDOFF 밖 컨텍스트).

## Decisions made this session

브레인스토밍 중 유저 확답 받은 설계 결정:

- **[Q1 → C]** Phase 실패 시 인라인 액션 UI, 전체 완료 시 idle 정보 화면으로 분리.
- **[Q2 → A]** Phase 5 dirty-tree 체크 완전 제거. HEAD advance (또는 reopen 시 `implCommit !== null`)만으로 성공 판정. `tryAutoRecoverDirtyTree`, `IGNORABLE_ARTIFACTS`, `writeDirtyTreeDiagnostic`, `state.strictTree`, `--strict-tree` CLI 플래그까지 함께 삭제.
- **[Q3 → C]** `ui_render` 이벤트만 추가 (state.json disk-vs-memory diff는 안 넣음). 오버엔지 방지.
- **[Q4 → B]** 실패 terminal-state에서 `[R]`은 outer 프로세스 살아있는 채 인라인 resume 호출 (별도 터미널 커맨드 안 띄우게). `src/commands/resume.ts`와 `jump.ts`의 core 로직을 `process.exit` 없는 순수 함수(`performResume`, `performJump`)로 추출.
- **[Handoff 경로]** 다음 세션은 `superpowers:writing-plans` → TDD 구현 → `superpowers:requesting-code-review`. Spec이 완결돼 있어 harness light flow P1 재실행은 중복.

## Open questions / blockers

spec 파일 "Open Questions / TODO for Plan Phase" 섹션에 기록된 2건을 plan 작성 단계에서 결정:

- **[P1]** `[J]` jump 액션에서 phase 선택 UI — single-key (1/3/5)로 갈지 text 입력으로 갈지. 기본안: single-key.
- **[P2]** `performResume` 에러 시 terminal-ui의 catch에서 루프 유지할지 프로세스 종료할지. 기본안: 에러 메시지 + 패널 재렌더 + 루프 유지.
- **[P2]** complete terminal state에서 footer ticker 세션 시간 흐름 중지 여부. 기본안: 계속 흐름.

## Next concrete steps (ordered)

1. `superpowers:writing-plans` 스킬 호출. 인자로 `docs/specs/2026-04-19-phase5-softening-and-terminal-ui-design.md` 경로 전달.
2. Plan에서 task decomposition — 최소 3개 독립 task 권장: T1(Phase 5 validation 단순화 + dirty-tree 관련 심볼 제거), T2(`performResume`/`performJump` 순수함수 추출 리팩터), T3(terminal-ui 신규 모듈 + runPhaseLoop 종료 경로 연결 + `ui_render` 이벤트).
3. Plan의 eval checklist에 `pnpm tsc --noEmit`, `pnpm vitest run`, `pnpm build` 3개 포함 (CLAUDE.md 의무).
4. Plan 승인 후 TDD 순서로 구현 — 각 task마다 테스트 먼저 작성 후 구현.
5. 구현 끝나면 `pnpm tsc --noEmit && pnpm vitest run && pnpm build` 전체 통과 확인 후 `superpowers:requesting-code-review` 호출.

## Resume instructions

새 세션 시작 시 **아래 블록을 그대로 복붙해서 첫 프롬프트로** 보낸다:

```
이 worktree는 harness-cli 3종 UX 결함 해소 작업(spec 완료, plan 미작성)을 진행 중이다. 다음 순서로 컨텍스트를 복구하고 이어서 진행하라:

1. ~/.grove/AI_GUIDE.md 읽기 (worktree가 ~/.grove/ 하위)
2. 프로젝트 CLAUDE.md 읽기 (/Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/debugging/CLAUDE.md)
3. HANDOFF.md 읽기 — 현재 상태 복구
4. docs/specs/2026-04-19-phase5-softening-and-terminal-ui-design.md 읽기 — 전체 goal/scope/out-of-scope 재확인
5. `git log --oneline -10` + `git status` 확인
6. harness CLI 세션은 없음 (이번 작업은 superpowers 경로). harness resume 불필요.
7. HANDOFF.md의 "Next concrete steps" 1번부터 재개. 즉 `superpowers:writing-plans` 스킬을 spec 파일 경로 인자로 호출해 implementation plan을 작성하는 것부터 시작.

작업 재개 전에 현재 이해한 state를 1–2문장으로 요약해서 확인받고 시작할 것.
```
