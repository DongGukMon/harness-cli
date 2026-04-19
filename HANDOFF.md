# HANDOFF — Phase 5 Rev 2: Lineage atomic commit + runner argv tests

**Paused at**: 2026-04-20 (session token change)
**Worktree**: /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/claude-resume
**Branch**: claude-resume
**Base prompt**: `.harness/2026-04-20-untitled/phase-5-init-prompt.md` → spec: `docs/specs/2026-04-20-untitled-design.md`
**Reason**: token exhaustion / account switch

## Completed commits (이 worktree에서)

base = `10bbe13` (origin/main merge-base)

```
eb6abf3 harness[2026-04-20-untitled]: Phase 1 — spec
477fa4f harness[2026-04-20-untitled]: Phase 6 — rev 1 eval report
b7aefe7 docs: document Claude interactive reopen + sentinel purge + phaseClaudeSessions
e29af83 test: add resume + sentinel purge unit tests, update existing test fixtures
e2fa31a feat(phases): same-phase same-session Claude interactive reopen + sentinel purge
c71545f feat(runners): export claudeSessionJsonlPath + claudeSessionJsonlExists helpers
d5ab555 feat(state): add ClaudeSessionInfo + phaseClaudeSessions schema + migration
1f46679 docs(spec): harden pre-relaunch sentinel purge per Gate 2 retry-1 P1
fa5160c docs(spec): address Gate 2 P1 feedback — freeze resume CLI contract + pre-relaunch sentinel purge
ec10d04 docs(spec): add same-phase same-session design for Claude interactive reopen
```

## In-progress state

- **현재 task**: Task 6 (Lineage atomic commit reorder) — 미시작
- **마지막 완료 step**: 컨텍스트 읽기 완료 (spec, decisions, checklist, gate-7-feedback, runner.ts, claude.ts, interactive.ts 모두 읽음)
- **중단 직전 하던 action**: `src/phases/runner.ts:handleInteractivePhase` 수정 계획 수립 완료, 코드 변경 미시작
- **테스트 상태**: GREEN (기존 코드 변경 없음)
- **빌드 상태**: 미실행 (변경사항 없으므로 이전 빌드 상태 유지)
- **uncommitted 잔여물**: none

## Harness CLI 진행 중이면

- **runId**: 2026-04-20-untitled
- **flow**: light
- **현재 phase**: 5 (이 session이 phase 5 impl session — harness가 이 Claude 세션을 spawn함)
- **state.json**: harness outer가 관리하므로 직접 접근 불필요
- **pendingAction**: none
- **carryoverFeedback**: none
- **재개 커맨드**: N/A (이 세션 자체가 phase 5 구현 세션; 완료 후 sentinel 생성이 harness에게 완료 신호)
- **outer 세션(tmux)**: alive (harness가 sentinel을 watching 중)

## Decisions made this session

- [컨텍스트만 읽음] 이번 세션은 spec/decisions/gate-7-feedback/소스파일 읽기까지만 진행. 코드 변경 없음.

## Open questions / blockers

none (spec이 완전히 명세되어 있고 Gate 7 feedback도 명확함)

## Next concrete steps (ordered)

**Task 6: `src/phases/runner.ts:handleInteractivePhase` 수정**

1. **runner.ts lines 326-334 제거**: sentinel purge 전에 `state.phaseClaudeSessions` + `writeState` 호출하는 블록 전체 삭제:
   ```ts
   // 제거할 블록:
   if (preset?.runner === 'claude') {
     state.phaseClaudeSessions[String(phase) as '1' | '3' | '5'] = { ... };
     writeState(runDir, state);
   }
   ```

2. **runner.ts lines 346-353 이동**: `logger.logEvent({ event: 'phase_start', ... })` 블록을 try block 내 sentinel purge 이후로 이동 (현재 위치에서 제거)

3. **try block 내 sentinel purge 직후** (현재 line ~394, `if (fs.existsSync(sentinelPath)) throw` 바로 다음)에 추가:
   ```ts
   // Lineage atomic commit (R7/D5b): sentinel purge 통과 후 단일 writeState로 두 필드 함께 persist
   state.phaseAttemptId[String(phase)] = attemptId;
   if (preset?.runner === 'claude') {
     state.phaseClaudeSessions[String(phase) as '1' | '3' | '5'] = {
       runner: 'claude',
       model: preset.model,
       effort: preset.effort,
     };
   }
   writeState(runDir, state);
   // phase_start logging AFTER lineage commit (D5b step 5)
   logger.logEvent({
     event: 'phase_start',
     phase,
     attemptId,
     reopenFromGate,
     preset,
     ...(claudeResumeSessionId !== null ? { claudeResumeSessionId } : {}),
   });
   ```

4. **Task 6 commit**: `git commit -m "fix(phases): atomic lineage commit after sentinel purge (R7/D5b)"`

**Task 7a: `tests/runners/claude.test.ts`에 argv assertion 테스트 추가** (R8/ADR-9):

5. 기존 `tests/runners/claude.test.ts` 읽기 (세션에서 내용 미확인)
6. `runClaudeInteractive` 직접 호출, `sendKeysToPane` stub으로 wrapper 문자열 캡처
   - `resume=true` → `--resume <attemptId>` 포함, `--session-id` 미포함 assert
   - `resume=false` → `--session-id <attemptId>` 포함, `--resume` 미포함 assert
   - 공통: `@<promptFile>`, `--model`, `--effort`, `--dangerously-skip-permissions` assert
   - Mock: `src/tmux.js` (sendKeysToPane, pollForPidFile), `src/process.js` (getProcessStartTime, isPidAlive), `src/lock.js` (updateLockChild), `src/state.js` (writeState)

**Task 7b: `tests/phases/runner-claude-resume.test.ts`에 lineage-atomicity 회귀 케이스 추가** (R7):

7. 기존 파일 읽기 후, sentinel purge throw 시 `state.phaseClaudeSessions[phase]`가 기존 값 그대로인지 assert 케이스 추가
   - `existsSync` → true 반환으로 purge throw 유도
   - assert: throw 후 `state.phaseClaudeSessions[phase]` === purge 전 값 (null 또는 기존 값)

**Task 7c: `docs/HOW-IT-WORKS.md` 한 문장 추가**:

8. reopen 섹션에 "pre-relaunch sentinel purge가 실패하면 phaseAttemptId / phaseClaudeSessions가 동시에 불변" 한 문장 추가

**검증 + sentinel**:

9. `pnpm tsc --noEmit && pnpm vitest run && pnpm build` 전부 통과 확인
10. 통과 후 `git commit -m "test(phases): lineage-atomicity regression + runner argv argv assertions (R7/R8)"`
11. 통과 후 `echo '3140136d-7f32-4972-8688-09eb99972506' > .harness/2026-04-20-untitled/phase-5.done` (가장 마지막)

## Resume instructions

새 세션 시작 시 **아래 블록을 그대로 복붙해서 첫 프롬프트로** 보낸다:

```
이 worktree는 harness-cli Phase 5 Rev 2 구현 작업을 진행 중이다. 다음 순서로 컨텍스트를 복구하고 이어서 진행하라:

1. ~/.grove/AI_GUIDE.md 읽기
2. 프로젝트 CLAUDE.md 읽기
3. /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/claude-resume/HANDOFF.md 읽기 — 현재 상태 복구
4. docs/specs/2026-04-20-untitled-design.md 읽기 — 전체 goal/scope/out-of-scope 재확인 (## Implementation Plan의 Rev 2 delta 섹션이 실제 구현 범위)
5. git log --oneline -10 + git status 확인
6. HANDOFF.md의 "Next concrete steps" 1번부터 재개 (Task 6: runner.ts 수정부터)

작업 재개 전에 현재 이해한 state를 1–2문장으로 요약해서 확인받고 시작할 것.
```
