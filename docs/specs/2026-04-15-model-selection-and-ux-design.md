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
- `codex exec --model <model> --sandbox workspace-write --full-auto <prompt>`
- subprocess로 실행 (tmux pane이 아닌 background)
- 완료 감지: 프로세스 종료 + exit code 확인
- artifact validation: 기존 `validatePhaseArtifacts()` 재사용
- Phase 5 (구현): `--sandbox danger-full-access` 필요 (git commit 때문)
- tmux pane visibility: Codex 출력을 컨트롤 패널에 실시간 스트리밍 (stderr/stdout pipe)

**Gate phase (subprocess 모드):**
- `codex exec --model <model> <prompt>`
- 현재 gate.ts와 동일한 패턴: subprocess → stdout → `parseVerdict()`
- 기존 companion (`node codexPath task`) 대신 standalone `codex exec` CLI 사용
- effort level: `codex exec`에 `--effort` 플래그 없음 — config override로 전달: `-c model_reasoning_effort="high"`
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

## 3. Model Selection UI

### 3.1 Selection Flow

`harness run` 실행 후, Phase 루프 진입 직전에 표시:

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
inner.ts: inputManager.start()
  └─ runPhaseLoop()
       ├─ idle (Phase 진행 중)
       ├─ promptModelConfig() → prompt-single
       ├─ promptChoice() → prompt-single
       └─ idle
inputManager.stop()
```

기존 `promptChoice()`는 `InputManager.waitForKey()`를 사용하도록 리팩토링.

### 5.3 Escape Sequence 처리

`onData` 핸들러에서 multi-byte escape sequence 필터링:

```ts
const onData = (buf: Buffer) => {
  const str = buf.toString();
  // Ctrl+C / Ctrl+D: 항상 처리
  if (str === '\x03' || str === '\x04') { process.exit(1); }
  // ESC로 시작하는 시퀀스 (방향키, Home, End 등): 무시
  if (str.startsWith('\x1b')) return;
  // idle 상태: 무시
  if (this.state === 'idle') return;
  // prompt 상태: handler에 전달
  this.handler?.(str);
};
```

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

이전 PID 추적을 위해 `HarnessState`에 `lastWorkspacePid: number | null` 필드를 추가한다.

## 7. 영향 범위

### 변경 파일
- `src/config.ts` — `ModelPreset`, `MODEL_PRESETS`, `PHASE_DEFAULTS` 추가; `PHASE_MODELS`, `PHASE_EFFORTS` 삭제
- `src/types.ts` — `HarnessState.phasePresets`, `HarnessState.lastWorkspacePid` 추가
- `src/ui.ts` — `renderModelSelection()`, `promptModelConfig()` 추가; separator 너비 변경
- `src/input.ts` — 신규 파일. `InputManager` 클래스
- `src/runners/claude.ts` — 신규 파일. Claude runner (interactive + gate)
- `src/runners/codex.ts` — 신규 파일. Codex runner (interactive + gate)
- `src/phases/interactive.ts` — runner dispatch 로직으로 리팩토링; race condition 수정; artifact 삭제 조건부 변경
- `src/phases/gate.ts` — runner dispatch 로직으로 리팩토링
- `src/phases/runner.ts` — `promptModelConfig()` 호출 추가
- `src/commands/inner.ts` — `InputManager` lifecycle 통합
- `src/state.ts` — `createInitialState()`에 `phasePresets` 초기화
- `src/preflight.ts` — Codex CLI 존재 확인 추가 (standalone `codex` binary)

### 삭제 파일
- 없음

### 신규 파일
- `src/input.ts`
- `src/runners/claude.ts`
- `src/runners/codex.ts`
