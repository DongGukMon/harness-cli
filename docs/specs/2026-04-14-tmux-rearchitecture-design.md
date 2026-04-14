# harness-cli tmux Rearchitecture — Design Spec

- Date: 2026-04-14
- Status: Approved
- Scope: tmux 기반 UI/UX 전면 개편 — iTerm2 새 창에서 control panel + phase windows 관리

---

## Context & Decisions

### Why this work

harness-cli의 첫 실사용에서 근본적인 UX 문제가 드러남:

1. **Claude가 터미널을 점유** — `stdio: 'inherit'`로 spawn하면 CLI UI가 완전히 사라짐. 사용자는 harness 상태를 볼 수 없음.
2. **Phase 전환이 보이지 않음** — Claude 종료 후 sentinel 확인 → 다음 phase 시작까지 사용자에게 피드백 없음. "멈춘 것처럼" 보임.
3. **stdin 충돌** — Claude의 raw mode 점유 후 harness의 `promptChoice`가 키 입력을 받지 못함.
4. **Gate phase 블랙박스** — Codex가 2-4분간 동작하는데 터미널에 아무것도 표시 안 됨.
5. **tmux-in-tmux** — 이미 tmux/grove 안에서 harness를 실행하면 중첩 tmux 문제 발생.

이 문제들은 대증 치료(terminal clear, stdin restore 등)로는 근본 해결이 안 됨. tmux 기반 아키텍처로 전환하면 전부 해결.

### Decisions

**[ADR-1] `harness run`은 detached tmux 세션을 생성하고 iTerm2 새 창에서 attach한다.**
- 현재 터미널은 즉시 반환됨 (프롬프트로 돌아옴)
- iTerm2 새 창에서 harness tmux 세션이 열림
- iTerm2가 없으면 Terminal.app 폴백
- macOS 전용 (Linux 지원은 scope 밖)

**[ADR-2] tmux 세션 내부는 window 기반 — control panel(window 0) + phase windows(window 1+).**
- Window 0 ("control"): harness 상태 대시보드 + gate/verify 로그 스트리밍
- Window N ("phase-N"): interactive phase의 Claude 세션 (phase당 하나)
- Gate/verify phase는 control window에서 직접 실행 (별도 window 불필요)
- 사용자는 `Ctrl-B 0`으로 control, `Ctrl-B 1`로 Claude 세션 전환

**[ADR-3] `harness run`을 두 단계로 분리: outer(현재 터미널) + inner(tmux 안).**
- Outer: preflight + state 초기화 + tmux 세션 생성 + iTerm2 열기 → exit
- Inner: `harness __inner <runId>` — tmux window 0 안에서 phase loop 실행
- `__inner`는 숨겨진 내부 명령어. 사용자가 직접 호출하지 않음.

**[ADR-4] interactive phase의 Claude spawn은 `tmux new-window`로 변경.**
- 현재: `spawn('claude', { stdio: 'inherit' })` → 현재 터미널 점유
- 변경: `tmux new-window -n "phase-N" "claude --dangerously-skip-permissions --model ... @prompt"`
- Claude는 별도 window에서 실행 → control panel은 window 0에서 계속 상태 표시
- Sentinel 감지 시: Claude window 자동 닫기 → control panel로 포커스 이동

**[ADR-5] `harness resume`는 기존 tmux 세션에 re-attach한다.**
- tmux 세션이 살아있으면 → iTerm2에서 `tmux attach`
- 세션이 없으면 → 새 tmux 세션 생성 + `__inner` 실행

**[ADR-6] Control panel은 단순 console.log 기반이다. TUI 프레임워크(blessed, ink) 사용하지 않음.**
- 복잡도 대비 가치가 낮음
- 상태 업데이트 시 화면 clear + 재출력으로 충분

**[ADR-7] 이미 tmux 안에서 실행 시 — 현재 tmux 서버에 새 window 생성.**
- `$TMUX` 환경변수로 tmux 안인지 감지
- tmux 안이면: iTerm2 새 창 대신 `tmux new-window -n "harness-ctrl"` + `tmux new-window -n "phase-N"` 사용
- tmux-in-tmux 문제 회피

---

## Architecture

### 실행 흐름

```
[사용자 터미널]
$ harness run "태스크"
  │
  ├── 1. preflight (git, claude, codex 체크)
  ├── 2. state 초기화 (runId, state.json, task.md)
  ├── 3. tmux new-session -d -s harness-<runId> -c <cwd>
  ├── 4. tmux send-keys -t harness-<runId>:0 "harness __inner ..." Enter
  ├── 5. openTerminalWindow("harness-<runId>")  ← iTerm2 새 창
  └── 6. exit(0)  ← 원래 터미널 반환
  
[iTerm2 새 창 — tmux 세션]
Window 0 (control):
  harness __inner <runId> 실행 중
  ├── Phase 1 시작
  │   ├── tmux new-window -n "phase-1" "claude ..."
  │   ├── control에 "Phase 1 진행 중..." 표시
  │   ├── chokidar sentinel 감지
  │   ├── tmux kill-window -t "phase-1"
  │   └── control 업데이트: "Phase 1 ✓"
  ├── Phase 2 시작 (gate — control에서 직접)
  │   ├── Codex 스트리밍 로그 출력
  │   └── 결과: APPROVE/REJECT
  ├── Phase 3 시작
  │   ├── tmux new-window -n "phase-3" "claude ..."
  │   └── (같은 패턴)
  └── ... Phase 7까지
```

### 모듈 구조

```
src/
├── tmux.ts              ← 새 모듈: tmux 세션/window 유틸리티
├── terminal.ts          ← 새 모듈: iTerm2/Terminal.app 열기
├── commands/
│   ├── run.ts           ← 변경: outer 로직 (preflight + tmux + iTerm2)
│   ├── resume.ts        ← 변경: tmux re-attach 로직
│   └── inner.ts         ← 새 모듈: __inner 명령어 (tmux 안에서 phase loop)
├── phases/
│   ├── runner.ts        ← 변경: control panel 출력
│   ├── interactive.ts   ← 변경: spawn → tmux new-window
│   ├── gate.ts          ← 변경: stdout 실시간 출력
│   └── verify.ts        ← 변경: stdout 실시간 출력
└── bin/
    └── harness.ts       ← 변경: __inner 명령어 등록
```

### `src/tmux.ts` — tmux 유틸리티

```typescript
export function createSession(name: string, cwd: string): void;
  // tmux new-session -d -s <name> -c <cwd>

export function sessionExists(name: string): boolean;
  // tmux has-session -t <name>

export function createWindow(session: string, windowName: string, command: string): void;
  // tmux new-window -t <session> -n <windowName> <command>

export function selectWindow(session: string, windowName: string): void;
  // tmux select-window -t <session>:<windowName>

export function killWindow(session: string, windowName: string): void;
  // tmux kill-window -t <session>:<windowName>

export function killSession(name: string): void;
  // tmux kill-session -t <name>

export function sendKeys(session: string, window: string, keys: string): void;
  // tmux send-keys -t <session>:<window> <keys> Enter

export function isInsideTmux(): boolean;
  // process.env.TMUX !== undefined
```

### `src/terminal.ts` — 터미널 창 열기

```typescript
export function openTerminalWindow(tmuxSessionName: string): void;
  // 1. iTerm2 있으면: osascript로 새 창 열고 tmux attach
  // 2. 없으면: Terminal.app 폴백
  // 3. 이미 tmux 안이면: 아무것도 안 함 (window 이미 보임)
```

iTerm2 AppleScript:
```applescript
tell application "iTerm2"
  create window with default profile
  tell current session of current window
    write text "tmux attach -t <sessionName>"
  end tell
end tell
```

### `src/commands/inner.ts` — __inner 명령어

```typescript
export async function innerCommand(runId: string, options: { root?: string }): Promise<void>;
  // 1. runDir에서 state.json 로드
  // 2. signal handler 등록
  // 3. runPhaseLoop() 실행 (기존 runner.ts 재활용)
  // 4. 완료 시 tmux 세션 종료
```

### `src/phases/interactive.ts` — Claude를 tmux window로 실행

현재:
```typescript
const child = spawn('claude', [...args], { stdio: 'inherit', detached: true, cwd });
```

변경:
```typescript
const sessionName = state.tmuxSession;  // harness-<runId>
const windowName = `phase-${phase}`;
const claudeCmd = `claude --dangerously-skip-permissions --model ${PHASE_MODELS[phase]} --effort ${PHASE_EFFORTS[phase]} @${promptFile}`;

// Claude를 별도 tmux window에서 실행
createWindow(sessionName, windowName, claudeCmd);
selectWindow(sessionName, windowName);  // 사용자에게 Claude window 보여줌

// Sentinel 감시 (chokidar — 기존 로직 유지)
// Sentinel 감지 시:
//   1. killWindow(sessionName, windowName)  ← Claude window 닫기
//   2. selectWindow(sessionName, 'control') ← control panel로 포커스
//   3. settle('completed')
```

`waitForPhaseCompletion`의 변경:
- `child.on('exit')` 대신 → tmux window의 존재 여부 + sentinel 파일로 판단
- sentinel fresh → `killWindow` → settle
- tmux window가 자체 종료됨 (Claude `/exit`) → sentinel 체크 → settle

### `src/phases/gate.ts` — stdout 실시간 스트리밍

현재: `stdio: ['pipe', 'pipe', 'pipe']` → stdout 모아서 한번에 처리

변경: Codex stderr 로그를 control window에 실시간 출력

```typescript
child.stderr.on('data', (chunk: Buffer) => {
  const line = chunk.toString();
  // [codex] prefix가 있는 줄만 필터링
  if (line.includes('[codex]')) {
    process.stderr.write(`  ${line}`);
  }
});
```

### `src/phases/runner.ts` — control panel

Phase 전환 시 화면 갱신:

```typescript
function renderControlPanel(state: HarnessState): void {
  process.stdout.write('\x1b[2J\x1b[H');  // clear
  console.log('┌─ Harness Control Panel ────────────────┐');
  console.log(`│ Run: ${state.runId}`);
  console.log(`│ Phase: ${state.currentPhase}/7 ${phaseLabel(state.currentPhase)}`);
  // ... 각 phase 상태 출력
  console.log('└────────────────────────────────────────┘');
}
```

### `harness resume` 변경

```typescript
export async function resumeCommand(runId, options): Promise<void> {
  // ... 기존 state 로드 로직 ...
  
  const sessionName = `harness-${runId}`;
  
  if (sessionExists(sessionName)) {
    // tmux 세션 살아있음 → re-attach
    openTerminalWindow(sessionName);
  } else {
    // 세션 없음 → 새로 생성
    createSession(sessionName, cwd);
    sendKeys(sessionName, '0', `harness __inner ${runId}`);
    openTerminalWindow(sessionName);
  }
}
```

---

## State 변경

`HarnessState`에 `tmuxSession` 필드 추가:

```typescript
interface HarnessState {
  // ... 기존 필드 ...
  tmuxSession: string;  // tmux 세션 이름 (harness-<runId>)
}
```

---

## File-level change list

### Create
- `src/tmux.ts` — tmux 유틸리티 (createSession, createWindow, killWindow, etc.)
- `src/terminal.ts` — iTerm2/Terminal.app 창 열기
- `src/commands/inner.ts` — `__inner` 명령어

### Modify
- `bin/harness.ts` — `__inner` 명령어 등록
- `src/commands/run.ts` — outer 로직 (preflight + tmux + iTerm2 + exit)
- `src/commands/resume.ts` — tmux re-attach
- `src/phases/interactive.ts` — `spawn('claude')` → `tmux new-window`
- `src/phases/runner.ts` — control panel 렌더링
- `src/phases/gate.ts` — stderr 실시간 스트리밍
- `src/phases/verify.ts` — stdout/stderr 실시간 스트리밍
- `src/types.ts` — `tmuxSession` 필드
- `src/state.ts` — `tmuxSession` 초기화

### Delete
- None

---

## Testing

### Unit tests
- `tests/tmux.test.ts` — tmux 명령어 생성 검증 (실제 tmux 호출은 mock)
- `tests/terminal.test.ts` — osascript 생성 검증
- `tests/commands/inner.test.ts` — state 로드 + phase loop 호출 검증
- 기존 `tests/phases/interactive.test.ts` — spawn → tmux 변경 반영

### Integration
- `tests/integration/tmux-lifecycle.test.ts` — tmux 세션 생성 → window 생성 → 종료 (실제 tmux 필요)

### Manual smoke
- iTerm2에서 `harness run "test"` → 새 창 열림 확인
- Control panel 표시 확인
- Claude window 전환 확인 (Ctrl-B 1)
- Sentinel 후 자동 종료 + control 복귀 확인
- `harness resume` → 기존 세션 re-attach 확인

---

## Success criteria

1. `harness run` 실행 시 현재 터미널 즉시 반환 + iTerm2 새 창 열림
2. Control panel에서 phase 상태 실시간 표시
3. Claude는 별도 tmux window에서 실행 — control panel과 독립
4. Gate phase에서 Codex 로그 스트리밍
5. Sentinel 감지 → Claude window 자동 종료 → control로 포커스 이동
6. `harness resume` → 기존 tmux 세션에 re-attach
7. 이미 tmux 안에서 실행 시 → tmux-in-tmux 없이 새 window로 생성
8. `pnpm test` 통과, `pnpm run lint` 클린

---

## Risks

**R1: iTerm2가 설치되지 않은 환경**
- Terminal.app 폴백. AppleScript 실패 시 에러 메시지 + 수동 attach 안내 출력.

**R2: tmux가 설치되지 않은 환경**
- preflight에 `tmux` 체크 추가. 없으면 `brew install tmux` 안내.

**R3: Claude가 tmux window에서 TTY를 제대로 인식하지 못할 수 있음**
- `tmux new-window`로 실행하면 pseudo-TTY가 자동 할당됨. smoke-preflight.sh에서 확인됨.

**R4: tmux window 내에서 Claude `/exit` 시 window가 바로 닫힘**
- Claude가 exit하면 shell이 없으므로 tmux window가 자동 소멸. 이건 정상 동작 — sentinel 체크 후 settle.
- `remain-on-exit` 옵션으로 보존 가능하지만 불필요.

---

## Out of scope

- Linux 지원 (gnome-terminal, alacritty 등)
- grove 직접 통합 (grove API 호출)
- TUI 프레임워크 (blessed, ink, charm)
- tmux pane 분할 (window 기반으로 충분)
- 실시간 elapsed timer (단순 timestamp으로 대체)
