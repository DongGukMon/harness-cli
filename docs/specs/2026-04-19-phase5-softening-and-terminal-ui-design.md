# Phase 5 Validation Softening + Terminal-State UI + Render Instrumentation

- Date: 2026-04-19
- Status: Design approved (brainstorming)
- Related prior docs: `docs/HOW-IT-WORKS.md` (Phase 5 dirty-tree 섹션 — 본 변경으로 삭제 대상), `src/phases/dirty-tree.ts` (삭제 대상), `src/phases/interactive.ts` (validatePhaseArtifacts), `src/phases/runner.ts` (runPhaseLoop 종료 경로), `src/ui.ts` (renderControlPanel)
- Driver session: runId `2026-04-19-untitled-2` 로그에서 드러난 두 이슈 (`phase-5-dirty-tree.md` blocker로 인한 3연속 "크래시", control panel Phase 번호 오표기)

## Intent

Harness-cli 디버깅 세션에서 표면화된 3가지 UX/동작 결함을 한 번의 변경으로 해소:

1. **Phase 5 validation 과잉 방어 제거** — `git status --porcelain` 기반 "dirty tree = failed" 로직이 스크래치 파일(e.g. `prompt.txt`) 하나로 phase 를 실패시켜 사용자 체감 "크래시"를 유발. HEAD advance만이 실제 불변량이므로 dirty-tree 체크를 완전히 제거.
2. **Phase 실패/전체 완료 시 프로세스 즉시 종료 대신 control panel 유지** — 현재는 실패/완료 모두 `session_end` 후 outer 프로세스가 그대로 종료돼 사용자가 컨텍스트/복구 경로를 확인할 수 없음. 실패 시 인라인 액션(`[R]esume / [J]ump / [Q]uit`), 완료 시 요약 idle 화면을 추가.
3. **Control panel Phase 번호 오표기 재현용 instrumentation** — 디버깅 세션에서 "Phase 5 진행 중인데 패널은 Phase 3 표기" 오표기가 실관찰됐으나 정적 분석으로는 원인 특정 실패. `events.jsonl`에 `ui_render` 이벤트를 추가해 다음 재현 시 타임라인 복원 가능하게.

## Goals

- G1. Phase 5 sentinel이 찍힌 시점에 `HEAD !== implRetryBase` (또는 reopen 경로에서 `implCommit !== null`) 만으로 성공 판정. untracked/tracked-modified 여부는 모두 무시.
- G2. `runPhaseLoop`가 "failed phase" 또는 "terminal phase 7 APPROVE 완료"로 종료될 때 프로세스를 즉시 끝내지 않고 terminal-state UI에 진입. 실패는 인라인 재개 가능, 완료는 idle 표시.
- G3. `renderControlPanel` 호출마다 `--enable-logging`이 켜진 세션에서 `ui_render` 이벤트 1줄을 `events.jsonl`에 기록. 필드는 `phase`, `phaseStatus`, `callsite`.

## Non-Goals

- 기존 `pause` / `pendingAction` 기반 UI (verify escalation, gate escalation) 변경 금지. 해당 경로는 이미 프로세스가 살아있고 별도 UI가 있음.
- `state.strictTree` 관련 사용자 설정/플래그 유지 금지 — `--strict-tree` 옵션도 함께 제거 (grep으로 사용처 확인 필요).
- `ui_render`에 `state_mismatch` (disk vs memory) diff 검사 미포함. Q3의 C안 선택 — 부족하면 후속 작업에서 추가.
- Task 2로 인한 CLI `harness resume` / `harness jump` 커맨드 자체의 사용자 인터페이스 변경 금지. 내부 core 함수만 추출.

## Changes

### Task 1 — Phase 5 validation 단순화

**`src/phases/interactive.ts`의 `validatePhaseArtifacts(5)` 변경**:

기존 189-226줄을 아래로 대체:

```ts
if (phase === 5) {
  try {
    const head = execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8' }).trim();
    if (head !== state.implRetryBase) return true;
    return state.implCommit !== null;
  } catch {
    return false;
  }
}
```

**삭제**:
- `src/phases/dirty-tree.ts` 파일 전체
- `src/config.ts`의 `IGNORABLE_ARTIFACTS`, `IgnorablePattern` 타입 및 export
- `HarnessState.strictTree` 필드 (`src/types.ts`) — 기존 run의 state.json에 남아 있어도 읽을 때 단순 무시 (forward-compat, migration 불필요: optional field drop)
- `harness run/start`의 `--strict-tree` CLI 플래그 (grep하여 파싱 로직 정리)
- 모든 dirty-tree 관련 테스트 (grep `dirty-tree|IGNORABLE_ARTIFACTS|tryAutoRecover|writeDirtyTreeDiagnostic|strictTree`)
- `README.md`, `README.ko.md`, `docs/HOW-IT-WORKS.md`, `docs/HOW-IT-WORKS.ko.md`의 dirty-tree/auto-recovery/strict-tree 언급 섹션

**유지**:
- `writeState`의 기존 state.json 파일에 `strictTree` 필드가 있어도 JSON 파싱은 성공 (TypeScript 타입만 제거). 새로 쓰일 때 필드는 없어짐.

### Task 2 — Terminal-State UI

**신규 모듈** `src/phases/terminal-ui.ts`:

```ts
export async function enterFailedTerminalState(
  state: HarnessState,
  runDir: string,
  cwd: string,
  inputManager: InputManager,
  logger: SessionLogger,
): Promise<void>

export async function enterCompleteTerminalState(
  state: HarnessState,
  runDir: string,
  cwd: string,
  logger: SessionLogger,
): Promise<void>
```

**enterFailedTerminalState 동작**:
1. `renderControlPanel(state, logger, 'terminal-failed')` 호출
2. 실패 phase 번호, 최근 `phase_end` / `gate_verdict` / `gate_retry` 이벤트 digest, `git status --porcelain` 요약(첫 10줄까지 표시 + N more)을 `console.error`로 패널 아래에 표시
3. 키 힌트 표시: `[R] Resume   [J] Jump to phase   [Q] Quit`
4. `inputManager.waitForKey(new Set(['r', 'j', 'q']))` 루프
   - `r` → `performResume(state, harnessDir, runDir, cwd, inputManager, logger, sidecarReplayAllowed)` 호출, 성공 시 `runPhaseLoop` 재진입
   - `j` → phase 번호 프롬프트(1,3,5 중 선택), `performJump(targetPhase, state, harnessDir, runDir, cwd, inputManager, logger)` 호출, 성공 시 재진입
   - `q` → 정상 종료 (footer ticker stop, lock release)

**enterCompleteTerminalState 동작**:
1. `renderControlPanel(state, logger, 'terminal-complete')` 호출
2. 완료 요약 표시:
   - Eval report path (`state.artifacts.evalReport`)
   - 커밋 범위 (`baseCommit`..`evalCommit`)
   - 총 wall time (세션 시작~now)
   - 총 토큰 (summary.json 집계 또는 events.jsonl 합산)
3. 안내: `Press Ctrl+C to exit` (키 루프 없이 `await new Promise<never>(() => {})` 또는 SIGINT 핸들러 대기)
4. footer ticker는 계속 돌리되 "wall time freezes at final" 표시는 추후

**리팩터링**: `src/commands/resume.ts`와 `src/commands/jump.ts`에서 core 로직 추출
- `process.exit` 호출을 제거하고, 대신 `{ ok: true } | { ok: false; reason: string }` 또는 throw로 신호 전달
- CLI 엔트리 함수 (`runResume`, `runJump`)는 core 함수를 호출하고 결과에 따라 `process.exit` 하는 얇은 래퍼로 유지 → 기존 CLI UX 불변
- Core 함수 signature:
  ```ts
  export async function performResume(
    state: HarnessState, harnessDir: string, runDir: string, cwd: string,
    inputManager: InputManager, logger: SessionLogger,
    sidecarReplayAllowed: { value: boolean },
  ): Promise<void>  // throws on fatal, returns on success (state mutated in-place, caller re-enters runPhaseLoop)

  export async function performJump(
    targetPhase: InteractivePhase, state: HarnessState,
    harnessDir: string, runDir: string, cwd: string,
    inputManager: InputManager, logger: SessionLogger,
  ): Promise<void>
  ```

**호출 지점** (`src/commands/inner.ts` 또는 `src/phases/runner.ts`의 runPhaseLoop 후 처리):
- `runPhaseLoop` 종료 직후:
  ```ts
  if (state.status === 'paused') {
    // 기존 경로: pendingAction UI 또는 프로세스 종료
  } else if (state.status === 'completed') {
    await enterCompleteTerminalState(state, runDir, cwd, logger);
  } else if (anyPhaseFailed(state)) {
    await enterFailedTerminalState(state, runDir, cwd, inputManager, logger);
  }
  ```
- `anyPhaseFailed`: `Object.values(state.phases).includes('failed' | 'error')`. 단, 진행 중인 실패(현재 phase만 failed, 나머지 pending)인 경우만 해당. 이미 resume으로 복구된 후 새 runPhaseLoop 이터레이션은 `completed` 또는 새 `failed`로 귀결.

**tmux 처리**: `Q` 또는 SIGINT에서 기존 `lockRelease` + `footerTicker.stop()` 외에 추가 cleanup 없음. workspace pane/control pane 자체는 tmux 세션이 유지되는 동안 남음 (기존 동작 유지).

### Task 3 — `ui_render` 이벤트

**`src/types.ts`에 LogEvent 추가**:

```ts
| {
    event: 'ui_render';
    phase: number;
    phaseStatus: PhaseStatus;
    callsite: string;
  }
```

**`src/ui.ts`의 `renderControlPanel` 시그니처 확장**:

```ts
export function renderControlPanel(
  state: HarnessState,
  logger?: SessionLogger,
  callsite?: string,
): void {
  // 기존 렌더 로직 그대로
  if (logger && callsite) {
    logger.logEvent({
      event: 'ui_render',
      phase: state.currentPhase,
      phaseStatus: state.phases[String(state.currentPhase)] ?? 'pending',
      callsite,
    });
  }
}
```

**호출부 업데이트** (`src/phases/runner.ts` 8곳):
- `runPhaseLoop` line 245: `'loop-top'`
- `handleInteractivePhase` line 336 (redirect): `'interactive-redirect'`
- `handleInteractivePhase` line 395 (completed): `'interactive-complete'`
- `handleGatePhase` line 475 (redirect): `'gate-redirect'`
- `handleGatePhase` line 522 (approve): `'gate-approve'`
- `handleVerifyPhase` line 948 (verify-complete): `'verify-complete'`
- `handleVerifyPhase` line 964 (verify-redirect): `'verify-redirect'`

**호출부 업데이트** (`src/phases/terminal-ui.ts` 2곳):
- `enterFailedTerminalState`: `'terminal-failed'`
- `enterCompleteTerminalState`: `'terminal-complete'`

**Logger 주입**: `handleInteractivePhase`, `handleGatePhase`, `handleVerifyPhase`는 이미 `logger` 파라미터를 받고 있으므로 `renderControlPanel(state, logger, '...')` 형태로 호출. `runPhaseLoop` line 245도 동일. 테스트에서 logger 미주입 경로는 기존 signature 유효성 유지 (optional param).

**볼륨 예상**: 세션당 `ui_render` 이벤트 ~20-40개. `events.jsonl`에 무시 가능한 수준 (기존 phase_start/phase_end와 비슷).

## Architecture

```
runPhaseLoop (runner.ts)
  ├─ while loop: renderControlPanel(..., 'loop-top')
  ├─ handleInteractivePhase → renderControlPanel(..., 'interactive-*')
  ├─ handleGatePhase → renderControlPanel(..., 'gate-*')
  └─ handleVerifyPhase → renderControlPanel(..., 'verify-*')

runPhaseLoop 종료 후 (inner.ts 마무리)
  ├─ status === 'completed' → enterCompleteTerminalState
  │   └─ renderControlPanel(..., 'terminal-complete')
  │   └─ idle (SIGINT 대기)
  └─ anyPhaseFailed(state) → enterFailedTerminalState
      ├─ renderControlPanel(..., 'terminal-failed')
      ├─ waitForKey loop {R, J, Q}
      ├─ R → performResume → state 복구 → runPhaseLoop 재호출
      ├─ J → performJump → state 복구 → runPhaseLoop 재호출
      └─ Q → cleanup + exit
```

## Testing Strategy

- **Task 1**:
  - 단위: `validatePhaseArtifacts(5, {implRetryBase: 'A', implCommit: null}, cwd)` where HEAD=A → false (first attempt, no advance)
  - 단위: HEAD=B (!= A) → true
  - 단위: HEAD=A, implCommit='X' → true (reopen case)
  - 통합: Phase 5 sentinel 찍힌 후 dirty working tree여도 success (기존 integration test 수정)
  - 삭제 확인: `tryAutoRecoverDirtyTree` 호출 assertion 있는 테스트 전부 제거
- **Task 2**:
  - 단위: `enterFailedTerminalState` — mock inputManager로 'r' 입력 시 `performResume` 호출 확인
  - 단위: `enterFailedTerminalState` — 'j' 입력 + phase 3 선택 시 `performJump(3, ...)` 호출 확인
  - 단위: `enterFailedTerminalState` — 'q' 입력 시 즉시 return
  - 단위: `enterCompleteTerminalState` — 패널 렌더링 후 Promise pending 상태로 남음 (timeout 테스트)
  - 리팩터 회귀: 기존 `commands/resume.test.ts`, `commands/jump.test.ts` 통과 유지
  - E2E smoke: `tsc --noEmit` + `vitest run` 통과
- **Task 3**:
  - 단위: `renderControlPanel(state, mockLogger, 'test-site')` → `mockLogger.logEvent` 호출 1회, 이벤트 필드 검증
  - 단위: `renderControlPanel(state)` (logger 미전달) → `logEvent` 호출 없음
  - 통합: 세션 실행 후 `events.jsonl` grep `"event":"ui_render"` → 최소 1개 존재

## Open Questions / TODO for Plan Phase

- **P1 (결정 필요)**: `enterFailedTerminalState`의 `J` 액션에서 phase 선택 UI — 단일 키(1/3/5)로 충분한가, 아니면 텍스트 입력? 기존 `promptChoice`로 충분해 보임 → single-key.
- **P2 (TODO, 구현 중 결정)**: `performResume` 추출 과정에서 기존 resume.ts의 `process.exit` 호출부 중 "치명적 실패 → 프로세스 강제 종료"가 필요한 케이스를 다시 throw Error로 바꿀 때, terminal-ui 쪽 catch에서 에러 메시지를 패널에 노출하고 다시 idle 루프로 돌아갈지, 아니면 바로 프로세스 종료할지. 기본안: 에러 메시지 + 패널 재렌더 + 루프 유지.
- **P2 (TODO)**: footer ticker를 complete terminal state에서 "세션 시간 흐름 중지" 표시할지 여부. 기본안: 계속 흐름 (사용자가 얼마나 idle 상태인지 보이도록).

## Doc Sync Checklist

구현 머지 시 동시 갱신:
- `README.md` / `README.ko.md` — dirty-tree/strict-tree 언급 삭제, terminal-state UI 동작 추가
- `docs/HOW-IT-WORKS.md` / `.ko.md` — 동일
- `CLAUDE.md` — "검증 커맨드" 섹션은 불변. "이벤트 로깅 스키마" 테이블에 `ui_render` 행 추가

## Handoff Decision

이 spec은 완결 상태. 다음 세션은 다음 경로로 이어감:

**선택**: `superpowers:writing-plans` → TDD 구현

**근거**: spec이 이미 설계/스코프/검증 전략까지 포함하고 있어 harness-cli light flow(P1)의 "design+plan" 재실행은 중복. 실제 경로 의존성(resume.ts/jump.ts 리팩터 + inner.ts 종료 경로 재조정)이 있어 plan 단계에서 task decomposition은 필요하지만, 그건 superpowers:writing-plans로 충분히 커버됨. 구현 후 `pnpm tsc --noEmit && pnpm vitest run && pnpm build` + `superpowers:requesting-code-review`로 검증.
