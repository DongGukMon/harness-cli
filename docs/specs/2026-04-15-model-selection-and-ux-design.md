# Model Selection & UX Improvements Design Spec

- Related plan: `docs/plans/2026-04-15-model-selection-and-ux.md` (TBD)
- Related config: `src/config.ts`, `src/ui.ts`, `src/types.ts`
- Related runners: `src/phases/interactive.ts`, `src/phases/gate.ts`

## Context & Decisions

### 배경
harness-cli의 컨트롤 패널에서 각 phase별 모델을 선택할 수 있도록 확장한다. 현재는 `PHASE_MODELS`와 `PHASE_EFFORTS`가 하드코딩되어 있어 모델 변경 시 코드 수정이 필요하다. 또한 Claude ↔ Codex 간 교차 사용이 불가능하다.

### 결정사항
1. **모든 phase (1-5, 7)에서 모델 선택 가능** — Gate phase 포함. Phase 6 (verify)만 제외 (shell script).
2. **Claude ↔ Codex 교차 사용** — Gate에 Claude를, Interactive에 Codex를 사용 가능.
3. **2개 runner** (Claude runner + Codex runner) — adapter 패턴 없이 각각 모듈로 분리. YAGNI.
4. **Model selection UI** — Phase 루프 진입 전 한 화면 요약 + 변경할 phase만 수정.
5. **Input manager** — Phase 루프 전체에서 stdin raw mode 유지로 방향키 leak 방지.

### 범위
- Phase별 모델 선택 기능
- Runner 추상화 (Claude runner / Codex runner)
- 컨트롤 패널 너비 확장 (50 → 64)
- stdin input manager (방향키/escape sequence 방지)
- Bug fix: Phase reopen 시 race condition + artifact 삭제 문제

## 1. Runner 분리

현재 `interactive.ts`와 `gate.ts`의 실행 로직을 runner 단위로 재구성한다.

### 1.1 Claude Runner (`src/runners/claude.ts`)

**Interactive phase (tmux pane 모드):**
- 현재 `interactive.ts`의 스폰 로직을 이동
- `claude --dangerously-skip-permissions --model <model> --effort <effort> @<promptFile>`
- tmux workspace pane에서 실행
- sentinel file + PID polling으로 완료 감지
- artifact validation은 기존 로직 유지
- **Child PID 등록**: spawn 후 `updateLockChild(harnessDir, childPid, phase, startTime)` 호출 — Codex runner와 동일하게 repo.lock에 등록. handleShutdown()이 childPid를 kill할 수 있어야 한다.
- **clearLockChild 시점**: §6.2 참조 — settle 시에는 clear하지 않음. 다음 phase가 자체 childPid를 등록할 때 덮어쓰여지거나, handleShutdown에서 처리.

**Gate phase (subprocess 모드):**
- `claude --print --model <model> --effort <effort>` + stdin으로 프롬프트 전달
- subprocess로 실행, stdout 캡처
- `parseVerdict()` 로 `## Verdict` 파싱 — 기존 gate.ts 파싱 로직 재사용
- timeout, PID tracking, sidecar 쓰기 등 기존 gate 인프라 재사용

### 1.2 Codex Runner (`src/runners/codex.ts`)

**Interactive phase (subprocess 모드):**
- `codex exec --model <model> -c model_reasoning_effort="<effort>" --sandbox workspace-write --full-auto -`
  - 프롬프트는 stdin으로 전달 (`-` = read from stdin). 프롬프트 파일(`phase-N-init-prompt.md`)을 작성한 뒤 `cat promptFile | codex exec ... -`로 실행. 기존 `MAX_PROMPT_SIZE_KB` 예산을 준수.
- subprocess로 실행 (tmux pane이 아닌 background)
- 완료 감지: 프로세스 종료 + exit code 확인
- artifact validation: 기존 `validatePhaseArtifacts()` 재사용
- Phase 5 (구현): `--sandbox danger-full-access` 필요 (git commit 때문)
- tmux pane visibility: Codex 출력을 컨트롤 패널에 실시간 스트리밍. `renderControlPanel()`의 화면 초기화(clear)와 충돌하지 않도록, Codex interactive 실행 중에는 control panel 재렌더를 중단하고 progress line만 append 방식으로 출력. 기존 gate phase의 `[codex]` line streaming 패턴(`src/phases/gate.ts:211-218`)을 재사용.
- **Child PID 등록**: spawn 후 `updateLockChild(harnessDir, childPid, phase, startTime)` 호출 — gate와 동일
- **Spawn**: `{ detached: true }` 필수 — `killProcessGroup()`이 `-pgid` 시그널을 사용하므로 자체 process group이 필요. 기존 gate spawn과 동일.
- **Timeout**: `INTERACTIVE_TIMEOUT_MS` (기본 30분) 적용. 기존 gate의 timeout 패턴 재사용: `setTimeout` → `killProcessGroup` → error
- **clearLockChild**: 정상 종료/timeout/forced termination 후 호출
- **에러 핸들링**: exit code !== 0 시 stderr를 error sidecar(`codex-<phase>-error.md`)에 저장
- **Prompt size 검증**: spawn 전 `assembleInteractivePrompt()` 결과의 크기를 `MAX_PROMPT_SIZE_KB`와 비교. 초과 시 즉시 에러 반환 (phase error로 처리)
- **인터럽트 (skip/jump)**: SIGUSR1 시그널 핸들러에서:
  1. `interruptedPhase = state.currentPhase` — **state 변경 전에** 현재 phase를 캡처
  2. `interruptedRunner = getPresetById(state.phasePresets[interruptedPhase]).runner` — 캡처된 phase의 runner
  3. state.currentPhase 변경 (skip/jump 목표 phase로)
  4. 캡처된 runner 기준으로 인터럽트 디스패치:
     - Claude runner (tmux pane): 기존 방식 — workspace pane에 `C-c` 전송
     - Codex runner (subprocess): `killProcessGroup(childPid, SIGTERM_WAIT_MS)` 호출
  - **중요:** state.currentPhase 변경 후에 runner를 확인하면 cross-runner jump 시 잘못된 인터럽트 메커니즘이 적용됨

**Gate phase (subprocess 모드):**
- `codex exec --model <model> -c model_reasoning_effort="<effort>" -`
  - 프롬프트는 stdin으로 전달 (`-`). 기존 gate와 동일하게 prompt 문자열을 pipe.
- 현재 gate.ts와 동일한 패턴: subprocess → stdout → `parseVerdict()`
- 기존 companion (`node codexPath task`) 대신 standalone `codex exec` CLI 사용
- 기본 모델: `gpt-5.4` (사용자 시스템의 codex config 기준)

### 1.3 Runner 선택 로직

```ts
// runner dispatch (pseudo)
function getRunner(preset: ModelPreset): 'claude' | 'codex' {
  return preset.runner;
}

function runPhase(phase, preset, phaseType) {
  if (preset.runner === 'claude') {
    if (phaseType === 'interactive') return claudeRunner.runInteractive(phase, preset);
    if (phaseType === 'gate') return claudeRunner.runGate(phase, preset);
  } else {
    if (phaseType === 'interactive') return codexRunner.runInteractive(phase, preset);
    if (phaseType === 'gate') return codexRunner.runGate(phase, preset);
  }
}
```

### 1.4 Runner × Phase Type 매트릭스

| | Interactive (1,3,5) | Gate (2,4,7) |
|---|---|---|
| **Claude** | tmux pane + sentinel (기존) | `claude --print` subprocess + verdict 파싱 |
| **Codex** | `codex exec --sandbox` subprocess + artifact 검증 | `codex exec` subprocess + verdict 파싱 |

## 2. Model Configuration

### 2.1 Model Preset 정의

`src/config.ts`에 사용 가능한 모델 프리셋:

```ts
export interface ModelPreset {
  id: string;
  label: string;
  runner: 'claude' | 'codex';
  model: string;
  effort: string;
}

export const MODEL_PRESETS: ModelPreset[] = [
  { id: 'opus-max',     label: 'Claude Opus 4.6 / max',    runner: 'claude', model: 'claude-opus-4-6',   effort: 'max' },
  { id: 'opus-high',    label: 'Claude Opus 4.6 / high',   runner: 'claude', model: 'claude-opus-4-6',   effort: 'high' },
  { id: 'sonnet-high',  label: 'Claude Sonnet 4.6 / high', runner: 'claude', model: 'claude-sonnet-4-6', effort: 'high' },
  { id: 'codex-high',   label: 'Codex / high',             runner: 'codex',  model: 'gpt-5.4',           effort: 'high' },
  { id: 'codex-medium', label: 'Codex / medium',           runner: 'codex',  model: 'gpt-5.4',           effort: 'medium' },
];
```

### 2.2 Phase 기본값

```ts
export const PHASE_DEFAULTS: Record<number, string> = {
  1: 'opus-max',      // Spec 작성
  2: 'codex-high',    // Spec Gate
  3: 'sonnet-high',   // Plan 작성
  4: 'codex-high',    // Plan Gate
  5: 'sonnet-high',   // 구현
  // Phase 6: verify script, 모델 선택 불가
  7: 'codex-high',    // Eval Gate
};
```

기존 `PHASE_MODELS`와 `PHASE_EFFORTS`는 삭제하고 `PHASE_DEFAULTS` + `MODEL_PRESETS`로 대체한다.

### 2.3 State 확장

`HarnessState`에 사용자 선택 저장:

```ts
// types.ts
export interface HarnessState {
  // ... existing fields
  phasePresets: Record<string, string>;  // keys "1"-"7" (6 제외), values = preset ID
}
```

`createInitialState()`에서 `PHASE_DEFAULTS`를 복사하여 초기화.

### 2.4 State Migration (기존 run 호환)

`readState()`에서 새 필드가 누락된 경우 read-time default를 적용:

```ts
const REQUIRED_PHASE_KEYS = ['1', '2', '3', '4', '5', '7'] as const;

function migrateState(raw: any): HarnessState {
  // phasePresets: 객체 레벨 + 개별 키 레벨 모두 검증
  if (!raw.phasePresets || typeof raw.phasePresets !== 'object') {
    raw.phasePresets = {};
  }
  // 필수 키 backfill + 유효성 검증
  for (const phase of REQUIRED_PHASE_KEYS) {
    const presetId = raw.phasePresets[phase];
    if (!presetId || !MODEL_PRESETS.find(p => p.id === presetId)) {
      raw.phasePresets[phase] = PHASE_DEFAULTS[Number(phase)] ?? 'sonnet-high';
    }
  }

  // lastWorkspacePid: null default + stale 보호 (Section 6.2 참조)
  if (raw.lastWorkspacePid === undefined) {
    raw.lastWorkspacePid = null;
  }
  if (raw.lastWorkspacePidStartTime === undefined) {
    raw.lastWorkspacePidStartTime = null;
  }

  // codexPath: nullable 호환
  if (raw.codexPath === undefined) {
    raw.codexPath = null;
  }

  return raw as HarnessState;
}
```

### 2.5 codexPath → Codex CLI 마이그레이션

기존 `state.codexPath` 필드는 companion 경로를 저장했다. 변경:

**타입 변경:**
```ts
// types.ts — codexPath를 deprecated + nullable로 변경
codexPath: string | null;  // deprecated: Codex runner는 standalone CLI 사용
```

**`createInitialState()` 변경:**
- 새 run에서는 `codexPath: null`로 생성
- `createInitialState()`의 `codexPath` 파라미터 제거

**`start.ts` 변경:**
- Codex companion preflight (`codexPath` resolve) 제거
- 기본 preflight만 실행 (공통 항목). Runner-aware preflight는 `inner.ts`에서 model selection 이후 실행

**`resume.ts` 변경:**
- `state.codexPath` null이면 re-resolve 시도하지 않음 (이전에는 `!existsSync(state.codexPath)`에서 재탐색)
- legacy run (codexPath가 string): 기존 로직 유지하되 Codex runner에서는 무시
- Codex runner는 항상 `which codex`로 standalone binary를 resolve (codexPath 불사용)

**Codex Runner 이진 파일 resolve:**
- `codex` binary를 PATH에서 resolve (`which codex`)
- 없으면 preflight에서 실패 — runner-aware preflight가 이미 검증했으므로 런타임에서는 발생하지 않음

## 3. Model Selection UI

### 3.1 Selection Flow & Startup Ordering

모델 선택과 preflight의 실행 순서:

```
harness run "task"
  1. 기본 preflight (git, node, tmux, tty, platform, verifyScript, jq) — runner 무관 공통 항목 (Phase 6 의존성 포함)
  2. createInitialState() — phasePresets = PHASE_DEFAULTS
  3. tmux 세션 생성 → __inner 스폰
  
__inner (inner.ts):
  1. task 입력 (이미 있으면 스킵) — ADR-6/7 cancelAndExit 유지 (InputManager 미사용)
  2. signal handler 등록 (handleShutdown)
  3. InputManager.start() — 여기부터 raw mode 활성. 단, 상태는 'configuring' (§5.4 참조)
  4. promptModelConfig() — 사용자가 preset 변경
  5. runner-aware preflight — 선택된 preset의 runner union 검증
     실패 시: handleConfigCancel()과 동일 경로 — pendingAction = reopen_config, status = paused, pauseReason = 'config-cancel', lock 해제, exit. Resume 시 model selection부터 재시작.
  6. InputManager 상태를 'idle'로 전환 (phase loop 진입)
  7. runPhaseLoop() 시작
  8. InputManager.stop()
```

`harness resume` → `resume.ts` → `inner.ts`:
```
resume.ts (기존 resumeRun 로직):
  1. readState() + migrateState()
  2. consumePendingAction() — pending-action.json 또는 state.pendingAction 적용
  3. tmux 세션 복구/생성 → __inner 스폰

inner.ts (resume 경로 — isResume=true):
  1. signal handler 등록
  2. InputManager.start() (isPreLoop = true)
  3. promptModelConfig() — 남은 phase + pendingAction targets 편집
  4. runner-aware preflight
     실패 시: handleConfigCancel() 동일 경로
  5. inputManager.enterPhaseLoop() (isPreLoop = false)
  6. runPhaseLoop() 재개
  7. InputManager.stop()
```

**핵심: resume의 model selection과 runner preflight는 `inner.ts`에서 실행된다.** `resume.ts`는 state 복구와 tmux/세션 관리만 담당하고, 새로운 pre-loop 시퀀스(model selection, preflight)는 `inner.ts`가 isResume 여부에 관계없이 동일한 경로를 실행한다. 현재 `inner.ts`는 `resumeRun()`을 호출하지 않으므로, `inner.ts`에 resume 전용 branch를 추가하여 pending-action 적용 → model selection → preflight → phase loop 순서를 보장한다.

**핵심 1: model selection이 preflight보다 먼저 실행된다.** 사용자가 모든 phase를 Claude로 선택하면 Codex preflight를 스킵할 수 있다.

**핵심 2: Phase 6 (verify) 의존성은 outer preflight에 포함.** `verifyScript`과 `jq`는 모델 선택과 무관하므로 항상 검증.

**핵심 3: Late preflight 실패 시 cleanup.** runner-aware preflight가 inner에서 실패하면, run은 이미 생성되었으므로 삭제하지 않고 `paused` 상태로 저장. 사용자가 환경을 수정 후 `harness resume`로 재개 가능.

**핵심 4: Resume 시 pending action을 먼저 적용.** skip/jump이 SIGUSR1 처리 전에 프로세스가 죽었을 수 있으므로, resume 시 pending-action.json을 먼저 읽어 state에 반영한 뒤 model selection과 preflight를 진행한다.

컨트롤 패널 UI:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▶ Model Configuration
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [1] Phase 1 (Spec 작성):   Claude Opus 4.6 / max
  [2] Phase 2 (Spec Gate):   Codex / high
  [3] Phase 3 (Plan 작성):   Claude Sonnet 4.6 / high
  [4] Phase 4 (Plan Gate):   Codex / high
  [5] Phase 5 (구현):        Claude Sonnet 4.6 / high
      Phase 6 (검증):        harness-verify.sh (fixed)
  [7] Phase 7 (Eval Gate):   Codex / high

  Change? Phase 번호 입력 (1-5,7) or Enter to confirm:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 3.2 Sub-menu (Phase 선택 시)

Phase 번호 입력 시 해당 phase의 프리셋 선택:

```
  Phase 5 (구현) — model:
  [1] Claude Opus 4.6 / max
  [2] Claude Sonnet 4.6 / high  ← current
  [3] Codex / high
  [4] Codex / medium
  Select (1-4):
```

선택 후 메인 메뉴로 복귀. Enter로 전체 확정.

### 3.3 UI 함수

`src/ui.ts`에 추가:

```ts
export function renderModelSelection(phasePresets: Record<string, string>): void;
export function promptModelConfig(currentPresets: Record<string, string>): Promise<Record<string, string>>;
```

`promptModelConfig`는 input manager 위에서 동작 (Section 5 참조).

## 4. Control Panel Width

separator를 `'━'.repeat(50)` → `'━'.repeat(64)`로 확장.

영향 범위:
- `renderControlPanel()` (2곳)
- `renderWelcome()` (1곳)
- `printPhaseTransition()` — 전역 `SEPARATOR` 상수 사용

`SEPARATOR` 상수를 모듈 레벨에서 한 번만 정의하고 모든 함수에서 참조.

## 5. Input Manager

### 5.1 문제

현재 `promptChoice()` 외 시간에는 stdin이 raw mode가 아니어서, 방향키 입력 시 ANSI escape sequence (`^[[A`, `^[[B` 등)가 터미널에 leak된다.

### 5.2 해결: Always-on Stdin Consumer

`src/input.ts` — Phase 루프 전체에서 stdin을 관리하는 모듈:

```ts
type InputState = 'idle' | 'configuring' | 'prompt-single' | 'prompt-line';

export class InputManager {
  private state: InputState = 'idle';
  private handler: ((key: string) => void) | null = null;

  start(initialState?: InputState): void;   // stdin.setRawMode(true), 'data' listener 등록
  stop(): void;     // stdin.setRawMode(false), listener 해제
  setState(state: InputState): void;  // 상태 전환

  // promptChoice/model selection에서 사용
  waitForKey(validKeys: Set<string>): Promise<string>;
  // task 입력 등 텍스트 입력에서 사용
  waitForLine(): Promise<string>;
}
```

**동작:**
- `idle` 상태: 모든 입력 무시 (echo 없음, `^[[A` 방지). Ctrl+C → `handleShutdown()` (phase-aware 종료)
- `configuring` 상태: 모든 입력 무시 (prompt 외). Ctrl+C → `handleConfigCancel()` (pre-loop 종료):
  - `state.status = 'paused'`
  - `state.pauseReason = 'config-cancel'` (신규 PauseReason)
  - `state.pendingAction = { type: 'reopen_config', targetPhase: state.currentPhase, sourcePhase: null, feedbackPaths: [] }` — pending action을 설정하여 resume 시 invariant 위반 방지 (`'reopen_config'`은 신규 PendingActionType)
  - lock 해제 → exit
  - resume 시: `pendingAction.type === 'reopen_config'`이면 model selection부터 다시 시작. `consumePendingAction()`에서 이 타입을 처리: pendingAction 제거 후 정상 resume flow 진입
- `prompt-single` 상태: 유효 키만 처리 (R/S/Q/C, 1-7 등)
- `prompt-line` 상태: 텍스트 입력 + Enter

### 5.4 Ctrl+C Routing — Context Flag

Ctrl+C 라우팅은 `InputState`가 아닌 별도 **context flag** (`isPreLoop: boolean`)로 결정한다. 이유: model selection 중에는 state가 `prompt-single`로 전환되지만, Ctrl+C는 여전히 config-cancel 경로를 따라야 한다.

```ts
class InputManager {
  private isPreLoop: boolean = true;  // configuring context
  
  enterPhaseLoop(): void { this.isPreLoop = false; }  // inner.ts가 runPhaseLoop() 직전에 호출
}

const onData = (buf: Buffer) => {
  const str = buf.toString();
  if (str === '\x03' || str === '\x04') {
    if (this.isPreLoop) {
      // Pre-loop (model selection, preflight 포함): phase를 mutate하지 않고 종료
      this.onConfigCancel?.();  // → reopen_config pendingAction, paused, exit
    } else {
      // Phase loop 진행 중: 기존 shutdown path
      process.kill(process.pid, 'SIGINT'); // → handleShutdown()
    }
    return;
  }
  // ... (기존 escape/idle/prompt 처리)
};
```

이렇게 하면 model selection submenu(`prompt-single`)에서도 Ctrl+C가 config-cancel로 라우팅된다.

**lifecycle:**
```
inner.ts:
  1. task 입력 (기존 readline 방식 유지 — InputManager 범위 밖)
     └─ Ctrl+C/Ctrl+D → cancelAndExit() (ADR-6/7: runDir 삭제, current-run 초기화)
  2. signal handler 등록
  3. inputManager.start('configuring')  ← 여기부터 raw mode
     ├─ promptModelConfig() → prompt-single (configuring 컨텍스트)
     ├─ runner-aware preflight
  4. inputManager.setState('idle')  ← phase loop 진입
     └─ runPhaseLoop()
          ├─ idle (Phase 진행 중)
          ├─ promptChoice() → prompt-single
          └─ idle
  5. inputManager.stop()
```

**초기 task 입력은 InputManager 범위 밖이다.** task 입력 시 Ctrl+C는 기존 `cancelAndExit()` 경로를 따르며 (run 삭제, 정리), `handleShutdown()`이 아니다. InputManager는 task 확정 + signal handler 등록 이후에만 활성화된다.

기존 `promptChoice()`는 `InputManager.waitForKey()`를 사용하도록 리팩토링.

### 5.3 Escape Sequence 처리

`onData` 핸들러에서 ESC sequence 필터링 (§5.4의 Ctrl+C routing 이후):

```ts
// ESC로 시작하는 시퀀스 (방향키, Home, End, F-keys 등): 항상 무시
if (str.startsWith('\x1b')) return;
// idle/configuring 상태: 모든 입력 무시
if (this.state === 'idle' || this.state === 'configuring') return;
// prompt 상태: handler에 전달
this.handler?.(str);
```

**주의:** raw mode에서는 터미널이 Ctrl+C를 SIGINT로 변환하지 않는다. §5.4에서 상태별로 적절한 종료 경로를 수동 디스패치한다.

## 6. Bug Fixes

### 6.1 Phase Reopen 시 Artifact 삭제 문제

**현재 동작:** `preparePhase()`가 Phase 1/3 reopen 시 spec/decisionLog 파일을 디스크에서 삭제.

**문제:** Gate 피드백은 "기존 spec을 수정하라"는 내용인데, spec 파일이 없어서 Claude가 원본을 참조할 수 없음.

**수정:**
`preparePhase()`에 명시적 `isReopen: boolean` 파라미터를 추가:

```ts
function preparePhase(phase, state, harnessDir, runDir, cwd, isReopen: boolean) {
  // ...
  if (!isReopen) {
    // 첫 실행: artifact 삭제 — stale mtime 방지
    // delete artifacts (existing logic)
  }
  // reopen: artifact 유지 — Claude/Codex가 기존 파일을 수정
}
```

`isReopen` 결정은 **`HarnessState.phaseReopenFlags`** 필드를 사용:

```ts
// types.ts
phaseReopenFlags: Record<string, boolean>;  // keys "1","3","5" — reopen 여부
```

**lifecycle:**
- **Set**: `handleGateReject()`/`handleVerifyFail()`에서 target interactive phase를 `pending`으로 전환할 때:
  ```ts
  state.phaseReopenFlags[String(targetPhase)] = true;
  state.phases[String(targetPhase)] = 'pending';
  ```
- **Read**: `preparePhase()`에서:
  ```ts
  const isReopen = state.phaseReopenFlags[String(phase)] ?? false;
  if (!isReopen) { /* delete artifacts */ }
  ```
- **Clear**: `preparePhase()` 끝에서 (sentinel/attemptId 갱신 후):
  ```ts
  state.phaseReopenFlags[String(phase)] = false;
  ```

`phaseReopenFlags`는 state.json에 영구 저장되므로 crash/resume 경계에서도 정확하게 동작. `replayPendingAction()`이 pendingAction을 clear해도 영향 없음.

`migrateState()`에서 초기값: `phaseReopenFlags` 누락 시 `{ '1': false, '3': false, '5': false }`.

### 6.2 Workspace Pane Race Condition

**현재 동작:** Phase 1 완료 시 `settle('completed')` 호출 → Claude 프로세스를 종료하지 않음 → Phase 2 gate 실행 → Gate reject → Phase 1 reopen → Ctrl-C + 300ms 후 새 명령 전송.

**문제 (likely cause):** 이전 Claude가 300ms 내에 종료되지 않으면, 새 `claude ...` 명령이 이전 Claude의 입력 버퍼로 전달됨 → 새 Claude 미시작 → PID file 미생성 → timeout → failed.

**수정:** Phase reopen 시 workspace pane 정리를 강화:

```ts
// interactive.ts — runInteractivePhase 시작 부분
// 1. 이전 Claude PID가 있으면 종료 대기
if (previousClaudePid && isPidAlive(previousClaudePid)) {
  sendKeysToPane(session, pane, 'C-c');
  await waitForPidDeath(previousClaudePid, 5000); // 최대 5초 대기
}

// 2. Pane에 shell prompt가 있는지 확인 (safety)
sendKeysToPane(session, pane, 'C-c');
await sleep(500);

// 3. 새 Claude 스폰
sendKeysToPane(session, pane, wrappedCmd);
```

이전 PID 추적을 위해 `HarnessState`에 다음 필드를 추가:

```ts
lastWorkspacePid: number | null;
lastWorkspacePidStartTime: number | null;  // epoch seconds — PID reuse 방지
```

**lifecycle:**
- **Set**: Claude runner가 interactive phase 스폰 후, PID file에서 PID를 읽은 직후:
  ```ts
  state.lastWorkspacePid = claudePid;
  state.lastWorkspacePidStartTime = getProcessStartTime(claudePid);
  writeState(runDir, state);
  ```
- **사용**: 다음 interactive phase 스폰 전, 이전 PID가 살아있는지 확인:
  ```ts
  if (state.lastWorkspacePid !== null
      && isPidAlive(state.lastWorkspacePid)
      && isSameProcessInstance(state.lastWorkspacePid, state.lastWorkspacePidStartTime)) {
    // 진짜 이전 Claude — kill 후 대기
  }

  // isSameProcessInstance: lock.ts의 기존 tolerance (±2초) 재사용
  function isSameProcessInstance(pid: number, savedStartTime: number | null): boolean {
    if (savedStartTime === null) return false;
    const actualStart = getProcessStartTime(pid);
    if (actualStart === null) return false;
    return Math.abs(actualStart - savedStartTime) <= 2;
  }
  ```
  macOS의 `ps -o etime` 기반 start-time은 초 단위 정밀도이므로, `lock.ts`와 동일한 ±2초 tolerance를 적용.
- **Clear**: PID가 확인 가능하게 종료된 후에만:
  - Claude runner: 다음 interactive phase 스폰 직전에 이전 PID death 확인 후 clear. Phase 완료(settle) 시에는 clear하지 않음 — settle은 sentinel 감지이지 프로세스 종료가 아니기 때문.
  - Codex runner: subprocess 종료 + clearLockChild 후 clear (프로세스가 확실히 종료됨)
  - `handleShutdown()`: childPid(repo.lock) kill 후, lastWorkspacePid도 같은 PID이면 clear
  ```ts
  // clear 시점: 이전 PID 종료 확인 후
  if (!isPidAlive(state.lastWorkspacePid)) {
    state.lastWorkspacePid = null;
    state.lastWorkspacePidStartTime = null;
  }
  ```
  **repo.lock.childPid**도 동일 원칙: Claude runner가 `updateLockChild`로 등록하되, settle 시에는 clearLockChild하지 않음. 다음 phase 스폰 전 또는 handleShutdown에서 처리.

### 6.3 Shutdown에서의 이중 PID 처리

`handleShutdown()`은 repo.lock.childPid를 kill하지만, Claude interactive 후 gate phase로 넘어가면 lock.childPid가 gate 자식으로 덮어씌워지고 이전 Claude PID가 잔존할 수 있다.

**수정:** `handleShutdown()`에서 두 PID를 모두 처리:

```ts
async function handleShutdown() {
  // 1. repo.lock의 현재 childPid kill (gate/verify 자식 또는 현재 interactive 자식)
  const lockChildPid = getChildPid(harnessDir);
  if (lockChildPid) await killProcessGroup(lockChildPid, SIGTERM_WAIT_MS);

  // 2. lastWorkspacePid가 lockChildPid와 다르고 아직 살아있으면 kill
  if (state.lastWorkspacePid !== null
      && state.lastWorkspacePid !== lockChildPid
      && isPidAlive(state.lastWorkspacePid)
      && isSameProcessInstance(state.lastWorkspacePid, state.lastWorkspacePidStartTime)) {
    await killProcessGroup(state.lastWorkspacePid, SIGTERM_WAIT_MS);
  }

  // 3. 기존 cleanup (lock 해제, state 저장 등)
}
```

SIGUSR1 인터럽트도 동일: interruptedPhase의 runner가 Claude이면 lastWorkspacePid도 kill.

## 7. Runner-aware Preflight

현재 `getPreflightItems(phaseType)` 는 `interactive` → Claude 검증, `gate` → Codex companion 검증을 하드코딩한다. 이를 runner-aware로 변경:

### 7.1 Inner에서의 Runner-union 검증 (start + resume 공통)

`inner.ts`에서 `promptModelConfig()` 이후 실행. (`start.ts`는 공통 preflight만 담당, runner-aware preflight는 inner에서 실행.)

사용자가 선택한 `phasePresets`에서 사용된 runner 종류를 추출:

```ts
const usedRunners = new Set(
  Object.values(state.phasePresets).map(id => getPresetById(id).runner)
);

if (usedRunners.has('claude')) {
  runPreflight(['claude', 'claudeAtFile', ...commonItems]);
}
if (usedRunners.has('codex')) {
  runPreflight(['codexCli', ...commonItems]);  // 'codexCli' = standalone binary
}
```

### 7.2 Resume 시 (남은 phase의 runner union 검증)

Start와 동일하게 남은 phase 전체의 runner union을 검증한다. "현재 phase만 검증"하지 않는다 — 이유: Phase 3에서 resume했는데 Phase 5의 Codex가 없으면, Phase 3-4를 완료한 뒤 Phase 5에서야 실패하는 것이 더 나쁜 UX.

```ts
// 남은 phase: currentPhase부터 7까지 + pendingAction의 targetPhase
// 에스컬레이션 pause 시 currentPhase는 gate(2/4/7)이지만,
// Continue 선택 시 targetPhase(1/3/5)가 실제로 실행될 phase
const remainingSet = new Set(
  REQUIRED_PHASE_KEYS.filter(
    p => Number(p) >= state.currentPhase && state.phases[p] !== 'completed'
  )
);
// pendingAction이 가리키는 targetPhase도 포함 (reopen 대상)
if (state.pendingAction?.targetPhase) {
  remainingSet.add(String(state.pendingAction.targetPhase));
}
const remainingPhases = [...remainingSet];

const usedRunners = new Set(
  remainingPhases.map(p => getPresetById(state.phasePresets[p]).runner)
);

if (usedRunners.has('claude')) runPreflight(['claude', 'claudeAtFile']);
if (usedRunners.has('codex')) runPreflight(['codexCli']);
```

`promptModelConfig()`도 동일: 남은 phase + effective reopen target을 편집 가능하게 표시.

**pendingAction payload 계약:**
- `reopen_phase`: `targetPhase` = 재실행할 interactive phase (1/3/5), `sourcePhase` = reject한 gate/verify phase
- `show_escalation`: `targetPhase` = 거절된 gate phase (2/4/7), `sourcePhase` = 재실행 대상 interactive phase. **주의: `targetPhase`가 gate이고 실제 reopen 대상은 `sourcePhase`**
- `reopen_config`: `targetPhase` = 현재 phase (정보용), `sourcePhase` = null
- `rerun_gate`/`rerun_verify`: `targetPhase` = 재실행할 gate/verify phase

remaining-phase 계산 시 reopen 대상 결정:
```ts
function getEffectiveReopenTarget(pa: PendingAction): number | null {
  if (pa.type === 'reopen_phase') return pa.targetPhase;
  if (pa.type === 'show_escalation') return pa.sourcePhase;  // gate가 아닌 interactive
  return null;
}
```

### 7.3 Preflight Items 추가

```ts
case 'codexCli': {
  // PATH에서 standalone codex binary 검색
  const codexBin = execSync('which codex', { encoding: 'utf-8' }).trim();
  if (!codexBin) throw new Error('Codex CLI not found in PATH.');
  return {};
}
```

### 7.4 Mode-specific Capability Validation

CLI 모드별 세부 기능(`--print`, `--sandbox`, `-c model_reasoning_effort` 등)은 **preflight에서 검증하지 않는다.** 이유:
- 이 플래그들은 CLI 버전에 따라 다를 수 있고, dry-run 검증 비용이 높음
- 대신 **런타임 실패 시 명확한 에러 메시지**를 제공:

```ts
// Runner 실행 실패 시 에러 메시지 예시
if (exitCode !== 0 && stderr.includes('unrecognized option')) {
  throw new Error(
    `${runner} does not support required flag. ` +
    `Ensure ${runner === 'claude' ? 'Claude Code' : 'Codex CLI'} is up to date.`
  );
}
```

이 접근은 YAGNI 원칙에 부합: 문제가 발생하면 즉시 알려주되, 사전 검증 비용은 피한다.

## 8. 영향 범위

### 변경 파일
- `src/config.ts` — `ModelPreset`, `MODEL_PRESETS`, `PHASE_DEFAULTS` 추가; `PHASE_MODELS`, `PHASE_EFFORTS` 삭제
- `src/types.ts` — `HarnessState.phasePresets`, `HarnessState.lastWorkspacePid`, `HarnessState.lastWorkspacePidStartTime`, `HarnessState.phaseReopenFlags` 추가; `codexPath` nullable; `PauseReason`에 `'config-cancel'` 추가; `PendingActionType`에 `'reopen_config'` 추가
- `src/ui.ts` — `renderModelSelection()`, `promptModelConfig()` 추가; separator 너비 변경; `printAdvisorReminder()`를 runner-aware로 변경 (Codex 선택 시 스킵 또는 Codex 전용 안내 출력)
- `src/input.ts` — 신규 파일. `InputManager` 클래스
- `src/runners/claude.ts` — 신규 파일. Claude runner (interactive + gate)
- `src/runners/codex.ts` — 신규 파일. Codex runner (interactive + gate)
- `src/phases/interactive.ts` — runner dispatch 로직으로 리팩토링; race condition 수정; artifact 삭제 조건부 변경
- `src/phases/gate.ts` — runner dispatch 로직으로 리팩토링
- `src/phases/runner.ts` — runner dispatch 로직 (preset 기반)
- `src/commands/inner.ts` — `InputManager` lifecycle 통합
- `src/state.ts` — `createInitialState()`에 `phasePresets` 초기화; `readState()`에 migration 추가
- `src/signal.ts` — runner-aware 인터럽트: Claude(tmux C-c) vs Codex(killProcessGroup)
- `src/preflight.ts` — `codexCli` 항목 추가; runner-aware preflight 로직
- `src/commands/start.ts` — outer preflight만 (공통 + Phase 6); codexPath 파라미터 제거
- `src/commands/resume.ts` — runner-aware preflight; codexPath 호환; `reopen_config` pendingAction 처리
- `src/resume.ts` — `config-cancel` pauseReason + `reopen_config` pendingAction 지원

### 삭제 파일
- 없음

### 신규 파일
- `src/input.ts`
- `src/runners/claude.ts`
- `src/runners/codex.ts`
