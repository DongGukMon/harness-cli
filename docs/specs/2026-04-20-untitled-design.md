# harness-cli crash-loop hardening — Design Spec (Light)

관련 산출물:
- Task: `.harness/2026-04-20-untitled/task.md`
- Decision Log: `.harness/2026-04-20-untitled/decisions.md`
- Eval Checklist: `.harness/2026-04-20-untitled/checklist.json`
- Gate 2 피드백 반영: `.harness/2026-04-20-untitled/gate-2-feedback.md` (P1/P2 모두 D4 + R3 + Task 3 재작성으로 해소)

## Complexity

Small — 단일 crash 두 건 모두 기존 phase 루프/resume 경로에 분기만 추가하면 풀린다. 새로운 서브시스템·스키마 변경·런타임 의존성 없음.

## Context & Decisions

### 관찰된 실패 시나리오

두 건은 공통적으로 "예외 상황을 사용자에게 노출하지 않고 조용히 exit(1) 또는 무한 재진입"으로 끝난다.

**① `docs/`가 .gitignore에 등록된 repo에서 Phase 6 eval report commit 실패**

- `src/state.ts:240` — eval report 기본 경로 `docs/process/evals/<runId>-eval.md`.
- 프로젝트 `.gitignore`에 `docs/`가 포함된 경우 `git add "docs/process/evals/..."`는 `fatal: paths are ignored by one of your .gitignore files` 로 실패 → `normalizeArtifactCommit`(src/artifact.ts:44)이 throw.
- `handleVerifyPhase`(src/phases/runner.ts:979)에서 catch → `phases['6'] = 'error'`, `pendingAction = null`, return.
- `runPhaseLoop`는 phase 상태가 `error`여도 루프 탈출 조건이 없다(src/phases/runner.ts:234~267). 같은 phase 6 진입을 반복 — verify 스크립트 재실행 과정에서 사이드 이펙트(eval report 덮어쓰기, 전처리)로 상태가 점점 오염되고, 그 사이에 누적된 `verifyRetries`가 limit에 도달하거나 preconditions throw로 inner 프로세스가 catch되지 않은 채 종료.
- 결과: 사용자에게는 아무런 선택지(Retry/Jump/Quit)가 제시되지 않고 크래시.

**② Phase 7 REJECT 이후 `status: paused` + `pendingAction: null` 조합**

- 정상 경로에서 `handleGateReject`(src/phases/runner.ts:648)는 pendingAction 세팅 + writeState를 atomic하게 한 번에 수행한다. 따라서 의도된 상태 전이만으로는 이 조합이 발생하지 않는다.
- 발생 조건: writeState 이전 단계 혹은 다른 handler(예: 사용자 Ctrl+C, SIGKILL, crash)에 의해 프로세스가 중단되어 state.json에 `paused`만 반영된 중간 스냅샷이 남은 경우.
- 이 조합을 만났을 때 두 곳에서 hard-exit 처리가 가능:
  1. `src/resume.ts::resumeRun` Step 5 — 명시적 `process.exit(1)` (현재 production 호출자는 없으나 `tests/resume.test.ts:76`가 계약으로 assert, `docs/specs/2026-04-12-harness-cli-design.md:848`이 공식 문서화).
  2. 라이브 resume 경로인 `src/commands/inner.ts`는 해당 조합을 명시적으로 처리하지 않는다 — 즉 같은 state로 `runPhaseLoop`에 진입해 crash-loop(①과 합성) 가능.
- 어느 경로든 사용자는 R/J/Q 없이 강제 종료를 경험한다.

### 공통 근본 원인

harness의 라이프사이클은 "실패는 모두 pendingAction 혹은 terminal UI(R/J/Q)로 수렴한다"는 계약을 전제로 설계되었다. 그러나 (a) loop가 `error`/`failed` 상태를 terminal 조건으로 인정하지 않고, (b) 두 resume 경로 모두 inconsistent state를 user-facing fallback 없이 hard-exit 또는 crash-loop에 맡긴다. 두 지점이 사용자 피드백 경로를 끊는다. 따라서 본 fix는 기존 terminal-UI 계약을 완성하는 방향으로 간다 — 새 복구 메커니즘을 만들지 않는다.

### 핵심 설계 결정 (요약, 자세한 rationale: decisions.md)

1. **Gitignore-aware eval commit** — 원인(path 불일치)을 제거하되, harness 전역 `docs/`가 commit 가능해야 한다는 제약을 강요하지 않는다. eval report 경로가 gitignore에 포함되면 commit을 **우아하게 skip**(warn 로그 + `evalCommit=null`)한다. 기존 `requireCommittedClean`/`validateAncestry`가 `evalCommit=null` 입력을 이미 no-op으로 허용하므로 downstream은 변경 없이 호환된다.
2. **루프 종료 조건에 `error`/`failed` 추가** — Phase handler가 phase를 `error` 또는 `failed`로 남기면 `runPhaseLoop`에서 즉시 탈출한다. `inner.ts`의 post-loop classifier(`anyPhaseFailed`)가 이미 `'failed' | 'error'`를 인식하므로 terminal UI(R/J/Q)로 자동 라우팅된다.
3. **Resume의 `paused + null` 처리** — hard-exit 대신, 관측된 두 경로(`src/commands/inner.ts` live path + `src/resume.ts::resumeRun` contracted path)에서 각각 **동일한 선형 복구 알고리즘**을 적용한다. 복구 후 terminal UI의 owner는 경로별로 다르지만 최종 observable(R/J/Q 화면)은 동일하다 (자세한 설계는 §D4).

### 모호함 없음

본 세션에서 추가로 사용자에게 물을 결정 공백은 없다. Gate 2 P1/P2 피드백은 D4 + R3 + Task 3 재작성으로 흡수했다.

## Requirements / Scope

### 반드시 바뀌어야 하는 관찰 가능 동작

R1. eval report 경로가 `git check-ignore` 대상인 repo에서 `phase-harness start --light` / `run`을 실행했을 때, Phase 6 verify가 성공하면 크래시 없이 Phase 7로 진입한다. eval report는 작성되고 (로컬) 존재하지만 commit은 시도하지 않는다. 경고 한 줄이 stderr로 남는다.

R2. Phase 6에서 eval commit이 다른 이유로 실패(예: 다른 staged 파일 존재)하면 phase는 `error`로 남고 `runPhaseLoop`가 즉시 탈출한다. `inner.ts`는 `anyPhaseFailed` 분기로 `enterFailedTerminalState`를 호출하여 recent events / git status / R·J·Q 선택지를 사용자에게 보여준다.

R3. state.json이 `status: "paused" + pendingAction: null` 조합인 채로 resume이 호출되면, 경로와 상관없이 사용자에게 **R / J / Q 선택 화면**(`enterFailedTerminalState`)이 렌더된다. 구체적 owner:
- **라이브 경로**(`phase-harness resume` → `src/commands/inner.ts`): inner.ts 초기화 중 조합을 감지해 phase 상태를 failed로 합성 + status를 in_progress로 해제. `runPhaseLoop`은 loop-top의 `failed/error` 탈출(R2)로 즉시 리턴 → 기존 post-loop 분기(`anyPhaseFailed` → `enterFailedTerminalState`)가 그대로 R/J/Q를 렌더.
- **Contracted 경로**(`src/resume.ts::resumeRun`): 동일한 합성 수행 후 `enterFailedTerminalState`를 **resumeRun 내부에서 직접 호출**(no-op InputManager + NoopLogger 주입). runPhaseLoop는 호출하지 않는다.

### 범위 외(out of scope)

- eval report 저장 위치의 재설계 (별도 디렉토리로 옮기기, config flag 추가 등). 본 fix는 기존 경로를 유지한 채 gitignore 케이스만 graceful degrade 한다.
- `verifyRetries` 세만 설계 (fail vs error 재분류). 현 구조에서는 commit 실패가 verifyRetries를 직접 증가시키는 경로는 없고, 루프 재진입이 간접 원인이다. R2가 루프 재진입을 차단하면 carry-over 문제는 소거된다.
- Phase 7 REJECT 경로의 atomic write 강화. Crash-mid-write는 저지할 수 없으므로 resume-side recovery(R3)로 대응한다.
- `resumeRun` orphan 상태의 재배선(deferred refactor 정리). 본 fix는 두 경로를 동등하게 수리하되 호출 관계는 건드리지 않는다.
- 로깅 스키마 변경. 기존 `phase_end.status='failed'` + details로 충분하다.

## Design

### D1 — `src/git.ts`

새 helper:
```
isPathGitignored(relPath: string, cwd?: string): boolean
```
구현: `git check-ignore -q -- <relPath>` exit code 0 ⇒ true, 1 ⇒ false. 그 외 예외(git 부재 등)는 false로 conservative fallback.

### D2 — `src/artifact.ts` `commitEvalReport` + `forcePassVerify` synthetic commit

gitignore-aware 분기 추가:
1. `isPathGitignored(state.artifacts.evalReport, cwd)` 가 true일 때
   - `process.stderr.write` 로 한 줄 경고: `⚠️  eval report path '<path>' is gitignored — skipping commit (evalCommit will remain null).`
   - 즉시 return (no throw, `evalCommit` 미갱신 → null 유지)
2. 아니면 기존 `normalizeArtifactCommit` 호출 그대로.

Phase 6 synthetic(skip) 경로(`forcePassVerify`의 `normalizeArtifactCommit` 호출 — `src/phases/runner.ts:1178`)도 동일 helper로 보호하여 대칭 유지.

Phase 1/3 artifact commit(`normalizeInteractiveArtifacts`)은 이미 `.harness/` prefix check로 gitignored 디렉토리를 skip하는 로직이 있으므로 본 fix에서 건드리지 않는다.

### D3 — `src/phases/runner.ts` `runPhaseLoop` 종료 조건 확장

이중 방어 구조:
- **loop top**: `state.phases[phaseKey] === 'skipped'` 조기 continue 블록 옆에 `state.phases[phaseKey] === 'failed' || 'error'` 즉시 return 추가.
- **각 handler 직후**: 기존 `if (state.status === 'paused') return;` 직후에 `if (state.phases[String(phase)] === 'error' || 'failed') return;` 추가.

`inner.ts` post-loop classifier(`anyPhaseFailed`)는 이미 error/failed를 동시에 인식해 `enterFailedTerminalState`로 라우팅하므로 루프 탈출만 보강하면 terminal UI가 자연히 열린다.

`savePausedAtHead`는 루프 종료 후 `currentPhase === TERMINAL_PHASE` 경로에서만 호출되고 있어 변경 없음.

### D4 — `paused + pendingAction=null` 복구 (단일 선형 알고리즘)

**공통 합성 헬퍼**(예: `src/state.ts` 또는 `src/resume.ts` 내 로컬 함수로 추가):
```
synthesizeFailedFromInconsistentPause(state, runDir):
  process.stderr.write(
    `⚠️  Run ${state.runId} detected inconsistent pause state (paused + pendingAction=null); `
    + `synthesizing failed phase ${state.currentPhase} and routing to failed terminal UI.\n`
  );
  state.phases[String(state.currentPhase)] = 'failed';
  state.status = 'in_progress';
  state.pauseReason = null;
  writeState(runDir, state);
```

**라이브 경로 (`src/commands/inner.ts`, 라인 32~40 `readState` 직후 삽입)**:
1. `readState` 후 state가 null이 아님을 확인(기존).
2. **신규**: `if (state.status === 'paused' && state.pendingAction === null)` ⇒ `synthesizeFailedFromInconsistentPause(state, runDir)` 호출. 이후 code path는 기존 그대로 — 즉 task-prompt는 이미 존재하므로 skip, `runPhaseLoop` 진입.
3. `runPhaseLoop`는 D3에 의해 loop-top에서 즉시 return.
4. 기존 post-loop 분기(`anyPhaseFailed(state)` → `enterFailedTerminalState`, `src/commands/inner.ts:227`)가 R/J/Q를 렌더.

**Contracted 경로 (`src/resume.ts::resumeRun` Step 5)**:
1. 기존 `process.exit(1)` 제거.
2. `synthesizeFailedFromInconsistentPause(state, runDir)` 호출.
3. `runPhaseLoop`을 호출하지 않는다 — 대신 `enterFailedTerminalState`를 **resumeRun이 직접 import + 호출** (`no-op InputManager` + `NoopLogger` 주입, 기존 다른 replayPendingAction 분기들이 쓰던 것과 동일).
4. return — Step 6는 실행하지 않는다.

이 분기는 라이브 경로와 별개의 return을 구성한다: resumeRun에서 loop 없이 terminal UI만 열고 끝난다. inner.ts는 loop + post-loop 분기에 의존한다. 두 경로의 user-facing 결과는 동일(동일한 R/J/Q UI).

**관련 테스트 업데이트 (Task 3 포함)**: `tests/resume.test.ts:76` ("errors on paused run with null pendingAction")는 새 계약에 맞춰 exit 대신 `enterFailedTerminalState` 호출(또는 그 내부 로직 spy)로 goldenpath 변경. "inconsistent" 문자열 assert는 warn 메시지 기준으로 재작성.

### 상호작용/호환성

- D3의 loop-top 탈출은 "phase가 error/failed로 남은 상태로 loop에 재진입한 경우"에만 영향. 현재까지 이 상태를 만드는 경로는 Phase 6 commit 실패(①) 한 곳 + D4가 명시적으로 합성하는 경로. 두 경우 모두 터미널 UI로 가는 것이 의도된 동작.
- `.harness/` artifact는 변경 없음. `evalCommit=null` 경로는 기존 코드가 이미 허용.
- `resumeRun` 오퍼 ↔ live inner.ts 간 행동은 R3에서 **관찰 가능 동작 동일**로 수렴. 내부 경로는 다르지만 사용자 관점에서는 같은 화면.
- light flow 기준으로 설명했으나 full flow에서도 동일하게 적용된다(Phase 6는 공통).

## Implementation Plan

Small 제약(max 3 tasks, per-function 의사코드 금지) 준수. Task 1 → Task 2 느슨한 의존(Task 2의 경로 중 하나가 Task 1 warn 메시지를 트리거), Task 3은 D3의 loop-top 탈출에 의존(Task 2 먼저). Task 간 파일은 대부분 독립.

- **Task 1 — gitignore helper + eval commit graceful skip**
  - [ ] `src/git.ts`에 `isPathGitignored(relPath, cwd)` 추가 (`git check-ignore -q -- <relPath>`).
  - [ ] `src/artifact.ts` `commitEvalReport` 진입점에 gitignore 분기(warn + return). `forcePassVerify`의 `normalizeArtifactCommit`(src/phases/runner.ts:1178) 호출 직전에도 같은 분기 적용.
  - [ ] vitest: `isPathGitignored` 유닛 테스트 + `commitEvalReport` 분기 테스트(evalCommit 미갱신, no throw).
  - [ ] 문서 반영 검토: `README.md` / `README.ko.md` / `docs/HOW-IT-WORKS.md` / `docs/HOW-IT-WORKS.ko.md` — Phase 6 동작 설명에 "eval report path가 gitignored면 commit skip + evalCommit null" 한 줄 추가 또는 "검토 후 변경 불필요" 사유 PR에 명시.

- **Task 2 — 루프 종료 조건에 phase error/failed 추가**
  - [ ] `src/phases/runner.ts` `runPhaseLoop` loop top에 `failed || error` 즉시 return 추가 (`skipped` 분기 대칭 위치).
  - [ ] 각 phase handler 호출 직후 `if (state.phases[phaseKey] === 'error' || 'failed') return;` 추가 (기존 `status==='paused'` 분기 바로 뒤).
  - [ ] integration test: Phase 6 commit failure simulate → loop 탈출 + `inner.ts` 경유 시 `enterFailedTerminalState`가 호출되는지 확인(spy).
  - [ ] `phase_end` 이벤트의 `status: 'failed'` + `details.reason`이 terminal UI Recent events에서 그대로 노출되는지 확인.

- **Task 3 — resume paused+null 선형 복구 + 테스트 재작성**
  - [ ] D4 공통 헬퍼(`synthesizeFailedFromInconsistentPause`) 구현 (위치: `src/resume.ts` 내 private 함수 또는 `src/state.ts` export).
  - [ ] `src/commands/inner.ts`에서 `readState` 후 조합 감지 시 헬퍼 호출 (라이브 경로; 이후 코드는 기존 그대로, post-loop classifier가 UI 담당).
  - [ ] `src/resume.ts::resumeRun` Step 5의 `process.exit(1)`를 헬퍼 호출 + `enterFailedTerminalState` 직접 호출(no-op InputManager + NoopLogger 주입)로 교체. Step 6는 호출하지 않음.
  - [ ] `tests/resume.test.ts:76` 테스트를 새 계약에 맞게 재작성: exit 대신 `enterFailedTerminalState` 호출 확인(모듈 spy) + warn 메시지 assert.
  - [ ] `tests/inner.test.ts` 또는 상응 integration harness에 라이브 경로 케이스 추가: `paused+null` 상태에서 inner 구동 → R/J/Q 렌더 확인.

## Eval Checklist Summary

전 세 항목 모두 프로젝트 기본 검증(type + unit + build)과 일치. 자세한 JSON은 `.harness/2026-04-20-untitled/checklist.json`.

- `pnpm tsc --noEmit` — typecheck (ESLint alias 아니라 실제 tsc; project convention 상 `lint`는 이 커맨드의 alias이므로 중복 등록 금지).
- `pnpm vitest run` — 유닛 + integration 스위트. 본 fix의 새/변경 유닛 테스트(Task 1/2/3) 포함.
- `pnpm build` — `tsc` + `scripts/copy-assets.mjs`. dist 생성이 성공해야 dogfood 재실행 가능.
