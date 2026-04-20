# harness-cli crash-loop hardening — Design Spec (Light)

관련 산출물:
- Task: `.harness/2026-04-20-untitled/task.md`
- Decision Log: `.harness/2026-04-20-untitled/decisions.md`
- Eval Checklist: `.harness/2026-04-20-untitled/checklist.json`

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
- Resume는 이 조합을 "정상화 불가능"으로 분류하고 즉시 `process.exit(1)`(src/resume.ts:69) — 사용자는 state.json을 수동 편집하거나 run을 폐기해야만 복구할 수 있다.

### 공통 근본 원인

harness의 라이프사이클은 "실패는 모두 pendingAction 혹은 terminal UI(R/J/Q)로 수렴한다"는 계약을 전제로 설계되었다. 그러나 (a) loop가 `error` 상태를 terminal 조건으로 인정하지 않고, (b) resume가 inconsistent state를 user-facing fallback 없이 hard-exit 한다. 두 지점이 사용자 피드백 경로를 끊는다. 따라서 본 fix는 기존 terminal-UI 계약을 완성하는 방향으로 간다 — 새 복구 메커니즘을 만들지 않는다.

### 핵심 설계 결정 (요약, 자세한 rationale: decisions.md)

1. **Gitignore-aware eval commit** — 원인(path 불일치)을 제거하되, harness 전역 `docs/`가 commit 가능해야 한다는 제약을 강요하지 않는다. eval report 경로가 gitignore에 포함되면 commit을 **우아하게 skip**(warn 로그 + `evalCommit=null`)한다. 기존 `requireCommittedClean`/`validateAncestry`가 `evalCommit=null` 입력을 이미 no-op으로 허용하므로 downstream은 변경 없이 호환된다.
2. **루프 종료 조건에 `error` 추가** — Phase handler가 phase를 `error`로 남기면 `runPhaseLoop`에서 즉시 탈출한다. `inner.ts`의 post-loop classifier(`anyPhaseFailed`)가 이미 `'failed' | 'error'`를 인식하므로 terminal UI(R/J/Q)로 자동 라우팅된다.
3. **Resume의 `paused + null` 처리** — `exit(1)` 대신 현재 phase를 `failed`로 마킹하고 `status`를 `in_progress`로 올려 정상 phase 루프 및 post-loop terminal UI 흐름을 태운다. 사용자는 동일한 R/J/Q 화면에서 복구 경로를 선택할 수 있다.

### 모호함 없음

본 세션에서 추가로 사용자에게 물을 결정 공백은 없다. (a) gitignore-aware 동작은 graceful degrade가 항상 안전(evalCommit=null 경로 이미 존재), (b) 루프 탈출은 기존 contract를 완성하는 변경, (c) resume fallback은 기존 terminal UI 재사용. 세 결정 모두 기존 시스템의 invariants를 깨지 않으므로 합리적 판단 공백이 아니다.

## Requirements / Scope

### 반드시 바뀌어야 하는 관찰 가능 동작

R1. eval report 경로가 `git check-ignore` 대상인 repo에서 `phase-harness start --light` / `run`을 실행했을 때, Phase 6 verify가 성공하면 크래시 없이 Phase 7로 진입한다. eval report는 작성되고 (로컬) 존재하지만 commit은 시도하지 않는다. 경고 한 줄이 stderr로 남는다.

R2. Phase 6에서 eval commit이 다른 이유로 실패(예: 다른 staged 파일 존재)하면 phase는 `error`로 남고 `runPhaseLoop`가 즉시 탈출한다. `inner.ts`는 `anyPhaseFailed` 분기로 `enterFailedTerminalState`를 호출하여 recent events / git status / R·J·Q 선택지를 사용자에게 보여준다.

R3. state.json이 `status: "paused" + pendingAction: null` 조합인 채로 `phase-harness resume`을 실행하면, hard-exit 하지 않고 현재 phase를 `failed`로 올려 terminal UI 경로로 라우팅한다. 사용자는 R(resume) / J(jump) / Q(quit) 중 하나를 고를 수 있다.

### 범위 외(out of scope)

- eval report 저장 위치의 재설계 (별도 디렉토리로 옮기기, config flag 추가 등). 본 fix는 기존 경로를 유지한 채 gitignore 케이스만 graceful degrade 한다.
- `verifyRetries` 세만 설계 (fail vs error 재분류). 현 구조에서는 commit 실패가 verifyRetries를 직접 증가시키는 경로는 없고, 루프 재진입이 간접 원인이다. R2가 루프 재진입을 차단하면 carry-over 문제는 소거된다.
- Phase 7 REJECT 경로의 atomic write 강화. Crash-mid-write는 저지할 수 없으므로 resume-side recovery(R3)로 대응한다.
- 로깅 스키마 변경. 기존 `phase_end.status='failed'` + details로 충분하다.

## Design

### 변경 지점

#### D1 — `src/git.ts`

새 helper:
```
isPathGitignored(relPath: string, cwd?: string): boolean
```
구현: `git check-ignore -q -- <relPath>` exit code 0 ⇒ true, 1 ⇒ false. 그 외 예외(git 부재 등)는 false로 conservative fallback.

#### D2 — `src/artifact.ts` `commitEvalReport`

gitignore-aware 분기 추가:
1. `isPathGitignored(state.artifacts.evalReport, cwd)` 가 true일 때
   - `process.stderr.write` 로 한 줄 경고: `⚠️  eval report path '<path>' is gitignored — skipping commit (evalCommit will remain null).`
   - 즉시 return (no throw, `evalCommit` 미갱신 → null 유지)
2. 아니면 기존 `normalizeArtifactCommit` 호출 그대로.

Phase 6 synthetic(skip) 경로(`forcePassVerify`)도 동일 helper를 통해 보호하여 대칭 유지.

Phase 1/3 artifact commit(`normalizeInteractiveArtifacts`)도 같은 원리로 보호하면 좋지만 범위상 본 fix에서는 eval report 전용 경로(D2)만 건드린다. 다른 artifact는 이미 `.harness/` prefix check로 gitignore 디렉토리를 skip하는 로직이 있다.

#### D3 — `src/phases/runner.ts` `runPhaseLoop`

각 branch 종료 직후(이미 `status === 'paused'` 체크가 있는 자리)에 phase error 탈출을 추가한다. 의사 로직:

```
각 isInteractivePhase / isGatePhase / isVerifyPhase handler 호출 직후:
  if (state.phases[String(phase)] === 'error') return;
```

이 한 줄만으로 R2가 성립한다. inner.ts post-loop classifier는 이미 error를 failed와 동급으로 본다(`anyPhaseFailed`).

동시에, phase가 `error`로 남으면 `savePausedAtHead`는 호출되지 않는 것이 맞다(이미 handler 내에서 저장됨; 루프 종료 시점의 중복 저장은 불필요). 기존 코드가 loop 종료 후 `savePausedAtHead`를 호출하는 것은 `currentPhase === TERMINAL_PHASE` 경로뿐이므로 변경 없음.

#### D4 — `src/resume.ts` Step 5

`paused + pendingAction=null` 분기 교체 (line 69~75):

- 현재: stderr 안내 후 `process.exit(1)`.
- 변경: 상태 복구 후 fall-through — `state.phases[String(state.currentPhase)] = 'failed'`, `state.status = 'in_progress'`, `state.pauseReason = null`, writeState. 이어서 기존 Step 6 (`recoverGeneralState`) 는 skip하고 바로 `runPhaseLoop` 호출 — loop는 첫 iteration에서 해당 phase 가 `failed`임을 인지하지 못하므로(loop는 `skipped`만 건너뜀) 오히려 다시 respawn 시도한다. 따라서 정확한 경로는 **loop를 실행하지 않고** return — 호출자 `inner.ts` line 205 `runPhaseLoop` 결과 후 classifier가 처리하는 것이 아니라, `resumeRun`은 `inner.ts`의 별도 호출 경로(`src/resume.ts` 진입)에서 사용된다. 실제로 `src/commands/inner.ts`는 `resumeRun`을 호출하지 않고 `consumePendingAction` + `runPhaseLoop`만 돈다. `src/resume.ts`의 `resumeRun`은 상위 `run` 커맨드 경로에서 사용된다.

  따라서 D4의 올바른 복구 형태는: `state.phases[currentPhase]='failed'` + `status='in_progress'` + writeState 후 **`runPhaseLoop`를 호출** — loop의 첫 이터레이션은 **해당 phase를 건너뛰지 않고 실행**해버린다. 재진입을 막기 위해 R2(D3)가 선행되어야 한다. 즉 D3과 D4는 서로 보완: D3이 없으면 D4가 가리키는 failed phase를 그대로 실행해 새 crash가 날 수 있다.

  따라서 D4는 다음 두 방식 중 하나:
  1. phase_N.failed 인 상태로 loop 진입 → loop top에서 즉시 검출 후 종료(추가 보호 필요). **채택**. `runPhaseLoop` loop top의 `state.phases[phaseKey]==='skipped'` 분기 옆에 `state.phases[phaseKey]==='failed' || 'error'` 분기를 추가하여 즉시 return 한다.
  2. `resumeRun` 내에서 아예 `runPhaseLoop` 호출하지 않고 return, 호출자(`src/commands/run.ts` 계열)가 terminal UI를 열도록 refactor. **기각** — 호출 경로가 더 많이 바뀜.

  최종 채택 D4 = 방법 1. D3의 "handler 후 error 탈출"에 더해 **loop top에서 `failed`/`error` status 즉시 탈출**도 추가한다. 이중 방어.

### 상호작용/호환성

- 기존 test: `src/phases/runner.ts`의 loop에 `error` 탈출이 생겨도, 지금까지 error를 만들고 loop를 돌게 했던 경로는 Phase 6 commit 실패 단 한 곳이며 해당 경로를 안전하게 종료시키는 것이 의도된 방향이므로 regression 가능성 낮음.
- `.harness/` artifact는 변경 없음. `evalCommit=null` 경로는 기존 코드가 이미 허용.
- light flow 기준으로 설명했으나 full flow에서도 동일하게 적용된다(Phase 6는 공통).

## Implementation Plan

동일 계층의 작은 변경 3개로 나뉜다. Task 간 의존: Task 1 → Task 2 (Task 2의 warn 메시지가 Task 1 helper를 사용)는 약함. Task 3은 독립적.

- **Task 1 — gitignore helper + eval commit graceful skip**
  - [ ] `src/git.ts`에 `isPathGitignored(relPath, cwd)` 추가 (`git check-ignore -q`).
  - [ ] `src/artifact.ts` `commitEvalReport` 상단에 gitignore 분기(warn + return). `forcePassVerify`의 synthetic commit 경로도 같은 분기 적용.
  - [ ] vitest: `isPathGitignored` 유닛 테스트 + `commitEvalReport` 분기 테스트 (evalCommit 미갱신, no throw).
  - [ ] 문서 반영 검토: `README.md` / `README.ko.md` / `docs/HOW-IT-WORKS.md` / `docs/HOW-IT-WORKS.ko.md` — Phase 6 동작 설명에 "eval report path가 gitignored면 commit skip + evalCommit null" 한 줄 추가 또는 "검토 후 변경 불필요" 사유 명시.

- **Task 2 — 루프 종료 조건에 phase error/failed 추가**
  - [ ] `src/phases/runner.ts` `runPhaseLoop` loop top 및 각 handler 직후에 `state.phases[phaseKey] === 'error' || 'failed'` 체크를 추가하여 loop 탈출. (loop top의 `skipped` 분기와 대칭 위치.)
  - [ ] `inner.ts` post-loop classifier(`anyPhaseFailed` → `enterFailedTerminalState`)가 자연히 동작하는지 integration test로 검증.
  - [ ] `phase_end` 이벤트의 `status: 'failed'` + `details.reason`이 terminal UI의 Recent events 섹션에서 사용자에게 노출되는지 확인.

- **Task 3 — resume Step 5 hard-exit 제거**
  - [ ] `src/resume.ts` line 69~75 교체: `state.phases[String(state.currentPhase)] = 'failed'; state.status = 'in_progress'; state.pauseReason = null; writeState(...)` 후 기존 Step 6로 fall-through(Task 2 loop 탈출이 있으므로 안전).
  - [ ] vitest: 해당 state 조합에서 `resumeRun` 호출 시 (a) exit 하지 않고 (b) runPhaseLoop 복귀 후 state가 `failed`로 관찰되는지 테스트.

## Eval Checklist Summary

전 세 항목 모두 프로젝트 기본 검증(type + unit + build)과 일치. 자세한 JSON은 `.harness/2026-04-20-untitled/checklist.json`.

- `pnpm tsc --noEmit` — typecheck (ESLint alias 아니라 실제 tsc; project convention 상 `lint`는 이 커맨드의 alias이므로 중복 등록 금지).
- `pnpm vitest run` — 유닛 + integration 스위트. 본 fix의 새 유닛 테스트(Task 1/3) 포함.
- `pnpm build` — `tsc` + `scripts/copy-assets.mjs`. dist 생성이 성공해야 dogfood 재실행 가능.
