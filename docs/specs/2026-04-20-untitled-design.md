# harness-cli crash-loop hardening — Design Spec (Light)

관련 산출물:
- Task: `.harness/2026-04-20-untitled/task.md`
- Decision Log: `.harness/2026-04-20-untitled/decisions.md`
- Eval Checklist: `.harness/2026-04-20-untitled/checklist.json`
- Gate 2 피드백 반영: D4 live/contracted 경로 분리, 각 경로의 terminal-UI owner 명시 (v2 iteration)
- Gate 7 피드백 반영: 라이브 경로에서 `promptModelConfig` 앞을 short-circuit, contracted 경로는 interactive UI 포기하고 exit(1)로 회귀(v3 iteration)

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
  1. `src/resume.ts::resumeRun` Step 5 — 명시적 `process.exit(1)` (현 production 호출자 없음 — orphan. `tests/resume.test.ts:76`가 계약으로 assert, `docs/specs/2026-04-12-harness-cli-design.md:848`이 문서화).
  2. 라이브 resume 경로인 `src/commands/inner.ts`는 해당 조합을 명시적으로 처리하지 않는다 — 즉 같은 state로 `runPhaseLoop`에 진입해 crash-loop(①과 합성) 가능.
- 어느 경로든 사용자는 R/J/Q 없이 강제 종료를 경험한다.

### 공통 근본 원인

harness의 라이프사이클은 "실패는 모두 pendingAction 혹은 terminal UI(R/J/Q)로 수렴한다"는 계약을 전제로 설계되었다. 그러나 (a) loop가 `error`/`failed` 상태를 terminal 조건으로 인정하지 않고, (b) 라이브 resume 경로에는 조합 자체를 감지하는 분기가 없으며, (c) orphan resumeRun 경로는 interactive UI를 열 수 있는 입력 소스를 갖추지 못한 채 exit(1)만 수행한다. 본 fix는 라이브 경로에서 terminal UI(R/J/Q)를 반드시 보여주도록 보강하고, contracted(orphan) 경로는 명시적으로 non-interactive 탈출 경로로 유지한다.

### 핵심 설계 결정 (요약, 자세한 rationale: decisions.md)

1. **Gitignore-aware eval commit** — 원인(path 불일치)을 제거하되, harness 전역 `docs/`가 commit 가능해야 한다는 제약을 강요하지 않는다. eval report 경로가 gitignore에 포함되면 commit을 **우아하게 skip**(warn 로그 + `evalCommit=null`)한다. 기존 `requireCommittedClean`/`validateAncestry`가 `evalCommit=null` 입력을 이미 no-op으로 허용하므로 downstream은 변경 없이 호환된다.
2. **루프 종료 조건에 `error`/`failed` 추가** — Phase handler가 phase를 `error` 또는 `failed`로 남기면 `runPhaseLoop`에서 즉시 탈출한다. `inner.ts`의 post-loop classifier(`anyPhaseFailed`)가 이미 `'failed' | 'error'`를 인식하므로 terminal UI(R/J/Q)로 자동 라우팅된다.
3. **Resume의 `paused + null` 처리** — 라이브 경로(`inner.ts`)에서 **`promptModelConfig` 이전에 short-circuit**하여 터미널 UI를 즉시 연다. Contracted 경로(`resumeRun`)는 live InputManager가 없어 interactive UI를 제공할 수 없으므로 clarified exit(1)로 유지한다 (자세한 설계는 §D4).

### 모호함 없음

Gate 2/7 피드백에서 제기된 ownership/interactivity 문제는 D4/R3/Task 3 재작성으로 모두 흡수. 추가로 사용자에게 물을 결정 공백은 없다.

## Requirements / Scope

### 반드시 바뀌어야 하는 관찰 가능 동작

R1. eval report 경로가 `git check-ignore` 대상인 repo에서 `phase-harness start --light` / `run`을 실행했을 때, Phase 6 verify가 성공하면 크래시 없이 Phase 7로 진입한다. eval report는 작성되고 (로컬) 존재하지만 commit은 시도하지 않는다. 경고 한 줄이 stderr로 남는다.

R2. Phase 6에서 eval commit이 다른 이유로 실패(예: 다른 staged 파일 존재)하면 phase는 `error`로 남고 `runPhaseLoop`가 즉시 탈출한다. `inner.ts`는 `anyPhaseFailed` 분기로 `enterFailedTerminalState`를 호출하여 recent events / git status / R·J·Q 선택지를 사용자에게 보여준다.

R3. state.json이 `status: "paused" + pendingAction: null` 조합인 채로 resume이 호출되면:
- **라이브 경로**(`phase-harness resume` → `src/commands/inner.ts`): 조합 감지 시 `promptModelConfig`/`invalidatePhaseSessionsOnPresetChange`는 **skip**한다(사용자가 config prompt에 묶이지 않도록). InputManager는 정상적으로 `start`된 뒤 `enterPhaseLoop` 모드로 전환되고, `runPhaseLoop` 자체를 호출하지 않고 **`enterFailedTerminalState`가 바로** 호출되어 R/J/Q 화면을 렌더한다. `runRunnerAwarePreflight`는 그대로 실행한다(비대화형 검증). R 선택 시 `performResume`가 `runPhaseLoop`을 수행.
- **Contracted 경로**(`src/resume.ts::resumeRun`): live TTY InputManager가 없는 컨텍스트이므로 interactive UI는 제공하지 않는다. 기존 exit(1)를 유지하되, 메시지에 "이 경로는 non-interactive — `phase-harness resume`(tmux 라이브 경로)을 사용하라"를 명시한다. 기존 테스트는 새 메시지로 업데이트.

### 범위 외(out of scope)

- eval report 저장 위치의 재설계 (별도 디렉토리로 옮기기, config flag 추가 등).
- `verifyRetries` 세만 설계 (fail vs error 재분류). 현 구조에서 commit 실패가 verifyRetries를 직접 증가시키는 경로는 없으며, R2가 루프 재진입을 차단하면 carry-over 문제는 소거된다.
- Phase 7 REJECT 경로의 atomic write 강화. Crash-mid-write는 저지할 수 없으므로 resume-side recovery(R3)로 대응한다.
- `resumeRun` orphan 상태의 재배선(deferred refactor) / `createNoOpInputManager`가 실제로는 비대화형이라는 pre-existing mismatch의 전면 개편.
- 로깅 스키마 변경.

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

`inner.ts` post-loop classifier(`anyPhaseFailed`)는 이미 error/failed를 동시에 인식해 `enterFailedTerminalState`로 라우팅하므로 루프 탈출만 보강하면 terminal UI가 자연히 열린다. `savePausedAtHead`는 루프 종료 후 `currentPhase === TERMINAL_PHASE` 경로에서만 호출되고 있어 변경 없음.

### D4 — `paused + pendingAction=null` 복구 (경로별 단일 선형 알고리즘)

**공통 합성 헬퍼**(`src/commands/inner.ts` 내 private 함수로 도입; contracted 경로는 재사용하지 않음):
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

#### D4a — 라이브 경로 (`src/commands/inner.ts`)

단일 선형 알고리즘:
1. `readState` + lock claim + pane setup (기존, 변경 없음).
2. **NEW**: `const synthesizedFailure = (state.status === 'paused' && state.pendingAction === null);`. 참이면 `synthesizeFailedFromInconsistentPause(state, runDir)` 호출.
3. Task prompt 블록 (기존; resume이면 skip).
4. Signal handlers 등록 (기존).
5. Logger bootstrap (기존).
6. InputManager 생성 + `inputManager.start('configuring')` (기존).
7. **Conditional branch**:
   - `synthesizedFailure === false` → 기존 Step 5.7~5.9 (remainingPhases 계산, `promptModelConfig`, `invalidatePhaseSessionsOnPresetChange`) 그대로 실행.
   - `synthesizedFailure === true` → **Step 5.7 / 5.8만 skip**. `promptModelConfig`과 preset invalidation은 호출하지 않는다. (사용자를 config prompt에 묶지 않기 위함.)
8. `runRunnerAwarePreflight(state.phasePresets, remainingPhases)` — 기존 그대로 실행(비대화형; 실패 시 기존 `onConfigCancel` 경로로 폴백).
9. Footer ticker 시작, `inputManager.enterPhaseLoop()` 전환 (기존).
10. **Conditional branch**:
    - `synthesizedFailure === false` → 기존 `runPhaseLoop` + post-loop classifier 흐름 전체.
    - `synthesizedFailure === true` → `runPhaseLoop`을 **호출하지 않고** 바로 `enterFailedTerminalState(state, harnessDir, runDir, cwd, inputManager, logger)` 호출. 반환 후 기존 post-loop classifier와 동일하게 `state.status` 기반으로 `sessionEndStatus`를 결정(`completed` → `enterIdle`, `paused` → sessionEndStatus='paused', 그 외 → 'interrupted').
11. 기존 finally 블록(logger/footer/input stop + release lock) 동일하게 실행.

이 구조의 핵심: D3의 loop-top 탈출은 동일하게 유지되지만(상호 보완), 라이브 경로 `synthesizedFailure` 케이스에서는 **애초에 `runPhaseLoop`을 돌지 않고** 터미널 UI를 즉시 연다. 이를 통해 (a) 사용자가 model config prompt에 막히지 않고, (b) post-loop classifier가 놓칠 수 있는 edge case(loop이 조건에 걸리지 않고 정상 종료되어 `currentPhase === TERMINAL_PHASE`로 오해하는 등)을 완전히 회피한다.

#### D4b — Contracted 경로 (`src/resume.ts::resumeRun`)

`resumeRun`은 production 호출자가 없는 orphan이며, 호출 컨텍스트에 live InputManager가 주입되지 않는다. 기존 `createNoOpInputManager()` 헬퍼는 `new InputManager()`만 반환하고 `start()`를 호출하지 않으므로 `enterFailedTerminalState`가 요구하는 `waitForKey` 가 영원히 resolve되지 않는다(hang).

본 fix에서는 이 경로의 interactive UI 제공을 포기한다:

1. Step 5 분기 내부에서 **기존 `process.exit(1)` 거동을 유지**하되, 메시지를 다음으로 교체:
   ```
   Run state is inconsistent: paused run has no pendingAction (non-interactive resume path).
   Re-run `phase-harness resume <runId>` to recover via the interactive terminal UI,
   or `phase-harness jump N` to restart from a specific phase.
   ```
2. `tests/resume.test.ts:76` 케이스는 동일하게 exit을 assert하되 새 메시지 substring(예: `non-interactive`)을 사용하도록 재작성.

이 결정은 interactive UI의 ownership을 라이브 경로로 집중시키고, orphan 경로의 refactor(InputManager injection 추가 등)를 별도 PR로 유보한다.

### 상호작용/호환성

- D3의 loop-top 탈출은 "phase가 error/failed로 남은 상태로 loop에 재진입한 경우"에 영향한다. 현재까지 이 상태를 만드는 경로는 Phase 6 commit 실패(①) 한 곳 뿐이며, 두 경우 모두 터미널 UI로 가는 것이 의도된 동작.
- 라이브 경로 `synthesizedFailure === true` 브랜치는 `promptModelConfig`를 건너뛰므로 `state.phasePresets`는 이전 run의 값을 그대로 재사용한다. R 선택 시 `performResume`의 `runPhaseLoop`가 해당 presets으로 동작한다.
- `runRunnerAwarePreflight`는 두 브랜치에서 동일하게 실행된다. 바이너리 누락 시 기존 `onConfigCancel` 경로로 폴백하므로 regression risk 낮음.
- `.harness/` artifact는 변경 없음. `evalCommit=null` 경로는 기존 코드가 이미 허용.
- light flow 기준으로 설명했으나 full flow에서도 동일하게 적용된다(Phase 6는 공통).

## Implementation Plan

Small 제약(max 3 tasks, per-function 의사코드 금지) 준수. Task 1 → Task 2 느슨한 의존. Task 3는 D3(Task 2)의 보조 방어에 의존.

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

- **Task 3 — resume paused+null 복구: 라이브 short-circuit + contracted clarified exit**
  - [ ] `src/commands/inner.ts`에 private `synthesizeFailedFromInconsistentPause` 함수 도입.
  - [ ] `innerCommand`의 `readState` 직후 조합 감지 → 헬퍼 호출 + 로컬 `synthesizedFailure` 플래그 set.
  - [ ] `innerCommand`의 Step 5.7/5.8(`promptModelConfig` + `invalidatePhaseSessionsOnPresetChange`)를 `!synthesizedFailure` 가드로 감싼다.
  - [ ] Step 6 `runPhaseLoop` 호출을 `!synthesizedFailure` 가드로 감싸고, `synthesizedFailure === true` 브랜치에서는 `enterFailedTerminalState` 직접 호출 + 기존 post-loop classifier와 동일 규칙으로 `sessionEndStatus` 결정.
  - [ ] `src/resume.ts::resumeRun` Step 5: `process.exit(1)`를 유지하되 메시지를 D4b 명세대로 교체(`non-interactive resume path` substring 포함).
  - [ ] `tests/resume.test.ts:76` 케이스를 새 메시지 substring으로 재작성(exit은 그대로 assert).
  - [ ] 라이브 경로 integration 테스트 추가: `paused + pendingAction=null` state.json으로 inner 구동 → `promptModelConfig`이 호출되지 않고 `enterFailedTerminalState`가 호출되는지(spy) 확인.

## Eval Checklist Summary

전 세 항목 모두 프로젝트 기본 검증(type + unit + build)과 일치. 자세한 JSON은 `.harness/2026-04-20-untitled/checklist.json`.

- `pnpm tsc --noEmit` — typecheck (ESLint alias 아니라 실제 tsc; project convention 상 `lint`는 이 커맨드의 alias이므로 중복 등록 금지).
- `pnpm vitest run` — 유닛 + integration 스위트. 본 fix의 새/변경 유닛 테스트(Task 1/2/3) 포함.
- `pnpm build` — `tsc` + `scripts/copy-assets.mjs`. dist 생성이 성공해야 dogfood 재실행 가능.
