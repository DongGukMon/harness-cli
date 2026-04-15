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
- 현재 `interactive.ts`의 스폰 로직을 그대로 이동
- `claude --dangerously-skip-permissions --model <model> --effort <effort> @<promptFile>`
- tmux workspace pane에서 실행
- sentinel file + PID polling으로 완료 감지
- artifact validation은 기존 로직 유지

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
- tmux pane visibility: Codex 출력을 컨트롤 패널에 실시간 스트리밍 (stderr/stdout pipe)
- **Child PID 등록**: spawn 후 `updateLockChild(harnessDir, childPid, phase, startTime)` 호출 — 기존 gate와 동일
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
  1. 기본 preflight (git, node, tmux, tty, platform) — runner 무관 공통 항목
  2. createInitialState() — phasePresets = PHASE_DEFAULTS
  3. tmux 세션 생성 → __inner 스폰
  
__inner (inner.ts):
  1. task 입력 (이미 있으면 스킵) — ADR-6/7 cancelAndExit 유지 (InputManager 미사용)
  2. signal handler 등록 (handleShutdown)
  3. InputManager.start() — 여기부터 raw mode 활성
  4. promptModelConfig() — 사용자가 preset 변경
  5. runner-aware preflight — 선택된 preset의 runner union 검증
  6. runPhaseLoop() 시작
  7. InputManager.stop()
```

`harness resume` 시:
```
  1. readState() + migrateState()
  2. promptModelConfig() — 남은 phase의 preset 재확인 (이미 완료된 phase는 변경 불가)
  3. runner-aware preflight — 현재 phase부터 남은 phase의 runner union 검증
  4. runPhaseLoop() 재개
```

**핵심: model selection이 preflight보다 먼저 실행된다.** 사용자가 모든 phase를 Claude로 선택하면 Codex preflight를 스킵할 수 있다.

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
type InputState = 'idle' | 'prompt-single' | 'prompt-line';

export class InputManager {
  private state: InputState = 'idle';
  private handler: ((key: string) => void) | null = null;

  start(): void;   // stdin.setRawMode(true), 'data' listener 등록
  stop(): void;     // stdin.setRawMode(false), listener 해제

  // promptChoice/model selection에서 사용
  waitForKey(validKeys: Set<string>): Promise<string>;
  // task 입력 등 텍스트 입력에서 사용
  waitForLine(): Promise<string>;
}
```

**동작:**
- `idle` 상태: 모든 입력 무시 (echo 없음, `^[[A` 방지)
- `prompt-single` 상태: 유효 키만 처리 (R/S/Q/C, 1-7 등)
- `prompt-line` 상태: 텍스트 입력 + Enter

**lifecycle:**
```
inner.ts:
  1. task 입력 (기존 readline 방식 유지 — InputManager 범위 밖)
     └─ Ctrl+C/Ctrl+D → cancelAndExit() (ADR-6/7: runDir 삭제, current-run 초기화)
  2. signal handler 등록
  3. inputManager.start()  ← 여기부터 raw mode
     ├─ promptModelConfig() → prompt-single
     └─ runPhaseLoop()
          ├─ idle (Phase 진행 중)
          ├─ promptChoice() → prompt-single
          └─ idle
  4. inputManager.stop()
```

**초기 task 입력은 InputManager 범위 밖이다.** task 입력 시 Ctrl+C는 기존 `cancelAndExit()` 경로를 따르며 (run 삭제, 정리), `handleShutdown()`이 아니다. InputManager는 task 확정 + signal handler 등록 이후에만 활성화된다.

기존 `promptChoice()`는 `InputManager.waitForKey()`를 사용하도록 리팩토링.

### 5.3 Escape Sequence 처리

`onData` 핸들러에서 multi-byte escape sequence 필터링:

```ts
const onData = (buf: Buffer) => {
  const str = buf.toString();
  // Ctrl+C / Ctrl+D: 기존 shutdown path로 라우팅 (process.exit 직접 호출 금지)
  // raw mode에서는 SIGINT가 자동 발생하지 않으므로, 수동으로 process.kill(process.pid, 'SIGINT') 호출
  if (str === '\x03' || str === '\x04') {
    process.kill(process.pid, 'SIGINT'); // → handleShutdown() 실행
    return;
  }
  // ESC로 시작하는 시퀀스 (방향키, Home, End 등): 무시
  if (str.startsWith('\x1b')) return;
  // idle 상태: 무시
  if (this.state === 'idle') return;
  // prompt 상태: handler에 전달
  this.handler?.(str);
};
```

**주의:** raw mode에서는 터미널이 Ctrl+C를 SIGINT로 변환하지 않는다. InputManager가 수동으로 `process.kill(process.pid, 'SIGINT')`를 호출하여 기존 `handleShutdown()` 경로(lock 해제, tmux cleanup, child 종료, paused state 저장)를 그대로 따르게 한다.

## 6. Bug Fixes

### 6.1 Phase Reopen 시 Artifact 삭제 문제

**현재 동작:** `preparePhase()`가 Phase 1/3 reopen 시 spec/decisionLog 파일을 디스크에서 삭제.

**문제:** Gate 피드백은 "기존 spec을 수정하라"는 내용인데, spec 파일이 없어서 Claude가 원본을 참조할 수 없음.

**수정:**
`preparePhase()`에서 artifact 삭제를 조건부로 변경:

```ts
// reopen (pendingAction 있음): artifact를 삭제하지 않음 — Claude가 기존 파일을 수정
// 첫 실행 (pendingAction 없음): artifact 삭제 — stale mtime 방지
if (!state.pendingAction) {
  // delete artifacts (existing logic)
}
```

reopen 시에는 기존 artifact를 유지하여 Claude가 피드백을 반영하여 수정할 수 있게 한다.

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
      && getProcessStartTime(state.lastWorkspacePid) === state.lastWorkspacePidStartTime) {
    // 진짜 이전 Claude — kill 후 대기
  }
  ```
  start-time 비교로 PID reuse false positive를 방지.
- **Clear**: Phase 완료 후 또는 Codex runner로 전환 시:
  ```ts
  state.lastWorkspacePid = null;
  state.lastWorkspacePidStartTime = null;
  ```

## 7. Runner-aware Preflight

현재 `getPreflightItems(phaseType)` 는 `interactive` → Claude 검증, `gate` → Codex companion 검증을 하드코딩한다. 이를 runner-aware로 변경:

### 7.1 Start 시 (전체 union 검증)

`harness run` 실행 시, 사용자가 선택한 `phasePresets`에서 사용된 runner 종류를 추출:

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

### 7.2 Resume 시 (현재 phase의 runner만 검증)

```ts
const currentPreset = getPresetById(state.phasePresets[String(state.currentPhase)]);
if (currentPreset.runner === 'codex') {
  // codex CLI 존재 확인
} else {
  // claude CLI 존재 확인
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
- `src/types.ts` — `HarnessState.phasePresets`, `HarnessState.lastWorkspacePid`, `HarnessState.lastWorkspacePidStartTime` 추가; `codexPath` nullable 변경
- `src/ui.ts` — `renderModelSelection()`, `promptModelConfig()` 추가; separator 너비 변경
- `src/input.ts` — 신규 파일. `InputManager` 클래스
- `src/runners/claude.ts` — 신규 파일. Claude runner (interactive + gate)
- `src/runners/codex.ts` — 신규 파일. Codex runner (interactive + gate)
- `src/phases/interactive.ts` — runner dispatch 로직으로 리팩토링; race condition 수정; artifact 삭제 조건부 변경
- `src/phases/gate.ts` — runner dispatch 로직으로 리팩토링
- `src/phases/runner.ts` — `promptModelConfig()` 호출 추가
- `src/commands/inner.ts` — `InputManager` lifecycle 통합
- `src/state.ts` — `createInitialState()`에 `phasePresets` 초기화; `readState()`에 migration 추가
- `src/signal.ts` — runner-aware 인터럽트: Claude(tmux C-c) vs Codex(killProcessGroup)
- `src/preflight.ts` — `codexCli` 항목 추가; runner-aware preflight 로직
- `src/commands/start.ts` — runner-aware preflight 호출; model selection 통합
- `src/commands/resume.ts` — runner-aware preflight; codexPath 호환

### 삭제 파일
- 없음

### 신규 파일
- `src/input.ts`
- `src/runners/claude.ts`
- `src/runners/codex.ts`
