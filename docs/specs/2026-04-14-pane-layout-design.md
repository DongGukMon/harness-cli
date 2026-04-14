# harness-cli Pane Layout — Design Spec

- Date: 2026-04-14
- Status: Draft
- Scope: tmux 레이아웃을 window(탭) 기반에서 pane(화면분할) 기반으로 전환
- Related: `docs/specs/2026-04-14-tmux-rearchitecture-design.md` (현재 window 기반 아키텍처)

---

## Context & Decisions

### Why this work

현재 window 기반 아키텍처의 UX 한계:

1. **Control panel과 Claude를 동시에 볼 수 없음** — `Ctrl-B 0`/`Ctrl-B 1`로 전환해야 함. Phase 상태를 보려면 Claude에서 눈을 떼야 함.
2. **Claude 종료 후 window가 사라짐** — Claude가 exit하면 window가 소멸. 사용자가 그 공간에서 추가 작업(git log, 파일 확인 등)을 하려면 별도 터미널이 필요.
3. **Window 생성/삭제 오버헤드** — 매 interactive phase마다 window를 만들고 죽이는 것은 불필요한 복잡성.

Pane 기반 레이아웃으로 전환하면:
- Control panel이 항상 보임 (왼쪽 30%)
- Claude는 오른쪽 70%에서 실행되며, 종료 후에도 shell이 유지됨
- 사용자가 오른쪽 pane에서 자유롭게 명령 입력 가능
- 마우스 클릭으로 pane 전환 가능 (`mouse on` 이미 적용됨)

### Decisions

**[ADR-1] 단일 window, 두 pane 레이아웃.**
- Window 0 하나만 사용. 왼쪽 pane(30%) = control, 오른쪽 pane(70%) = workspace.
- Phase별 window 생성/삭제를 제거. Workspace pane은 영구적.
- `tmux split-window -h -p 70`로 분할.

**[ADR-2] Workspace pane은 영구 shell이다.**
- Claude 명령은 `tmux send-keys`로 workspace pane에 입력.
- Claude 종료 후 shell이 살아있어 사용자가 자유롭게 명령 입력 가능.
- Phase 전환 시 workspace pane을 kill하거나 respawn하지 않음.

**[ADR-3] Claude 프로세스 완료 감지: sentinel + PID polling.**
- `send-keys`로 Claude 시작 후 1초 대기, workspace pane의 foreground PID 캡처.
- 감지 방식: chokidar sentinel 감시 + PID 사망 polling (1초 간격).
- PID 사망 + sentinel fresh → completed.
- PID 사망 + no sentinel → failed.
- Sentinel detected (PID 아직 alive) → completed (PID polling 중단).

**[ADR-4] Phase 전환 시 workspace pane 정리: `Ctrl-C` 선전송.**
- 새 interactive phase 시작 전, workspace pane에 `Ctrl-C`를 send-keys하여 진행 중인 입력을 정리.
- 0.3초 대기 후 Claude 명령 send-keys.
- 사용자가 뭔가 타이핑 중이더라도 안전하게 처리됨.

**[ADR-5] SIGUSR1 (skip/jump) 처리: workspace pane에 `Ctrl-C` 전송.**
- 현재: `killWindow()`로 Claude window 삭제 → window 사망 감지 → settle.
- 변경: workspace pane에 `Ctrl-C` send-keys → Claude 프로세스 사망 → PID polling이 감지 → settle.
- Workspace pane은 유지됨 (shell로 복귀).

**[ADR-6] Gate/Verify phase에서 workspace pane은 idle.**
- Gate/verify 출력은 control pane(왼쪽)에서 직접 표시. 현재와 동일.
- Workspace pane은 비어있음. 사용자가 자유롭게 사용 가능.

**[ADR-7] Reused mode에서도 pane 기반.**
- 현재 tmux 세션 안에서 실행 시: 새 window(`harness-ctrl`) 생성 후 그 window를 pane으로 분할.
- 완료 시: 해당 window만 kill (부모 세션 유지).
- Window 내부의 개별 pane kill이 아닌, window 전체를 kill하는 것이 더 깔끔.

**[ADR-8] Dedicated mode cleanup은 기존과 동일 (`killSession`).**
- Dedicated 세션 전체를 kill. 내부 pane 구조는 무관.

---

## Architecture

### 실행 흐름

```
[사용자 터미널]
$ harness run "태스크"
  │
  ├── 1. preflight
  ├── 2. state 초기화
  ├── 3. tmux new-session -d -s harness-<runId>
  ├── 4. tmux send-keys "harness __inner ..." Enter
  ├── 5. openTerminalWindow()
  └── 6. exit(0)

[iTerm2 — tmux 세션, Window 0]
┌─────────────────────┬──────────────────────────────────┐
│ Control (30%)       │ Workspace (70%)                  │
│                     │                                  │
│ __inner 실행        │ $SHELL (영구)                    │
│ Phase 상태 표시     │                                  │
│ Gate/verify 로그    │ ← Phase 1: claude send-keys      │
│                     │ ← Phase 3: claude send-keys      │
│                     │ ← Phase 5: claude send-keys      │
│                     │                                  │
│                     │ 사용자 자유 입력 가능            │
└─────────────────────┴──────────────────────────────────┘
```

### Inner 시작 시 pane 생성

```typescript
// __inner가 시작되면:
// 1. Lock claim (기존)
// 2. Workspace pane 생성
const workspacePaneId = splitPane(sessionName, controlPaneId, 'h', 70);
state.tmuxWorkspacePane = workspacePaneId;
writeState(runDir, state);
// 3. Phase loop 시작
```

### Interactive phase (1/3/5) — Claude spawn

```typescript
// 1. Workspace pane 정리
sendKeysToPane(sessionName, workspacePaneId, 'C-c');
await sleep(300);

// 2. Claude 명령 전송
const claudeCmd = `claude --dangerously-skip-permissions --model ${model} --effort ${effort} @${promptFile}`;
sendKeysToPane(sessionName, workspacePaneId, claudeCmd);

// 3. Claude PID 캡처 (1초 대기 후)
await sleep(1000);
const claudePid = getPaneForegroundPid(sessionName, workspacePaneId);

// 4. 완료 대기 (sentinel + PID polling)
const result = await waitForPhaseCompletion(sentinelPath, attemptId, claudePid, ...);

// 5. Focus를 control pane으로 (선택적)
selectPane(sessionName, controlPaneId);
```

### waitForPhaseCompletion 변경

```typescript
async function waitForPhaseCompletion(
  sentinelPath: string,
  attemptId: string,
  claudePid: number | null,
  phase: InteractivePhase,
  state: HarnessState,
  cwd: string
): Promise<InteractiveResult> {
  return new Promise<InteractiveResult>((resolve) => {
    let settled = false;
    let watcher: ReturnType<typeof chokidar.watch> | null = null;

    function settle(status: 'completed' | 'failed'): void {
      if (settled) return;
      settled = true;
      if (watcher) { void watcher.close(); watcher = null; }
      clearInterval(pollInterval);
      // NOTE: workspace pane은 kill하지 않음 (영구 shell)
      resolve({ status });
    }

    function onSentinelDetected(): void {
      if (settled) return;
      const freshness = checkSentinelFreshness(sentinelPath, attemptId);
      if (freshness === 'fresh') {
        const valid = validatePhaseArtifacts(phase, state, cwd);
        settle(valid ? 'completed' : 'failed');
      }
    }

    // Sentinel file watch
    watcher = chokidar.watch(sentinelPath, { persistent: true, ignoreInitial: false });
    watcher.on('add', onSentinelDetected);
    watcher.on('change', onSentinelDetected);

    // PID death polling (window death 대체)
    const pollInterval = setInterval(() => {
      if (settled) return;
      if (claudePid !== null && !isPidAlive(claudePid)) {
        // Claude 프로세스가 죽음 — sentinel 확인
        const freshness = checkSentinelFreshness(sentinelPath, attemptId);
        if (freshness === 'fresh') {
          const valid = validatePhaseArtifacts(phase, state, cwd);
          settle(valid ? 'completed' : 'failed');
        } else {
          settle('failed');
        }
      }
    }, 1000);

    // Immediate check
    if (fs.existsSync(sentinelPath)) {
      onSentinelDetected();
    }
  });
}
```

### SIGUSR1 처리 변경

```typescript
// signal.ts — SIGUSR1 handler 내부
// 현재: killWindow(currentState.tmuxSession, lastWindow)
// 변경:
if (currentState.tmuxWorkspacePane) {
  sendKeysToPane(currentState.tmuxSession, currentState.tmuxWorkspacePane, 'C-c');
}
```

---

## 모듈 변경

### `src/tmux.ts` — 새 함수 추가

```typescript
export function splitPane(session: string, targetPane: string, direction: 'h' | 'v', percent: number): string;
  // tmux split-window -t <session>:<targetPane> -{h|v} -p <percent> -P -F '#{pane_id}'
  // Returns pane ID (e.g., "%5")

export function sendKeysToPane(session: string, paneTarget: string, keys: string): void;
  // tmux send-keys -t <session>:<paneTarget> <keys> Enter
  // Special: 'C-c' → no Enter suffix

export function selectPane(session: string, paneTarget: string): void;
  // tmux select-pane -t <session>:<paneTarget>

export function getPaneForegroundPid(session: string, paneTarget: string): number | null;
  // tmux list-panes -t <session>:<paneTarget> -F '#{pane_pid}' → shell PID
  // Shell의 foreground child: pgrep -P <shellPid> (macOS/Linux)
  // Claude가 shell의 직접 자식이므로 첫 번째 child PID 반환
  // pgrep 결과 없으면 null (Claude 아직 미시작 또는 이미 종료)

export function getControlPaneId(session: string): string | null;
  // tmux display-message -t <session> -p '#{pane_id}'
  // Returns current pane ID (control pane, since __inner runs here)
```

### 기존 함수 유지/제거

| 함수 | 상태 |
|------|------|
| `createSession` | 유지 (dedicated mode) |
| `sessionExists` | 유지 |
| `createWindow` | 유지 (reused mode에서 window 생성) |
| `selectWindow` | 유지 (reused mode) |
| `killWindow` | 유지 (reused mode cleanup) |
| `killSession` | 유지 (dedicated mode cleanup) |
| `sendKeys` | 유지 (run.ts에서 inner 시작 시 사용) |
| `isInsideTmux` | 유지 |
| `getCurrentSessionName` | 유지 |
| `getActiveWindowId` | 유지 |
| `windowExists` | 제거 가능 (interactive.ts에서 더 이상 사용 안 함) |

### `src/types.ts` — State 변경

```typescript
interface HarnessState {
  // ... 기존 필드 ...
  tmuxSession: string;
  tmuxMode: 'dedicated' | 'reused';
  tmuxWindows: string[];           // reused mode cleanup용 (window 단위)
  tmuxControlWindow: string;       // reused mode에서 생성한 window ID
  tmuxOriginalWindow?: string;     // reused mode 복구용
  tmuxWorkspacePane: string;       // 새 필드: workspace pane ID ("%N")
  tmuxControlPane: string;         // 새 필드: control pane ID ("%N")
}
```

### `src/phases/interactive.ts` — 핵심 변경

- `createWindow()` 호출 제거 → `sendKeysToPane()` 사용
- `waitForPhaseCompletion` 시그니처 변경: `windowId` → `claudePid`
- `windowExists` polling → `isPidAlive` polling
- `killWindow` + `selectWindow` settle 로직 제거 → settle에서 pane 유지

### `src/commands/inner.ts` — pane 생성 추가

- `innerCommand` 시작 시 workspace pane 생성 (`splitPane`)
- Cleanup: dedicated mode는 `killSession` (변경 없음), reused mode는 `killWindow` (변경 없음)

### `src/commands/run.ts` — 변경 없음

Outer 로직은 동일: session 생성 → `sendKeys`로 inner 시작 → iTerm2 열기. Pane 분할은 inner 책임.

### `src/commands/resume.ts` — 최소 변경

- Case 1/2: 기존과 동일 (session re-attach / inner 재시작)
- Case 3: 기존과 동일 (새 session 생성)
- Inner가 재시작되면 workspace pane을 다시 생성 (기존 pane이 없으므로)

### `src/signal.ts` — SIGUSR1 변경

- `killWindow` → `sendKeysToPane(..., 'C-c')`

---

## File-level change list

### Modify
- `src/tmux.ts` — `splitPane`, `sendKeysToPane`, `selectPane`, `getPaneForegroundPid`, `getControlPaneId` 추가
- `src/types.ts` — `tmuxWorkspacePane`, `tmuxControlPane` 필드 추가
- `src/state.ts` — 새 필드 초기화
- `src/commands/inner.ts` — workspace pane 생성 로직 추가
- `src/phases/interactive.ts` — `createWindow` → `sendKeysToPane`, `waitForPhaseCompletion` PID 기반으로 변경
- `src/signal.ts` — SIGUSR1 handler: `killWindow` → `sendKeysToPane(..., 'C-c')`
- `tests/phases/interactive.test.ts` — tmux mock 업데이트

### Create
- None (기존 모듈에 추가)

### Delete
- None

---

## Testing

### Unit tests
- `tests/tmux.test.ts` — `splitPane`, `sendKeysToPane`, `selectPane`, `getPaneForegroundPid` mock 검증 추가
- `tests/phases/interactive.test.ts` — `sendKeysToPane` mock으로 전환, PID polling 테스트

### Manual smoke
- `harness run "test"` → iTerm2 새 창, 왼쪽 control + 오른쪽 shell 확인
- 오른쪽 pane에서 Claude 자동 시작 확인
- Claude 종료 후 오른쪽 pane에 shell prompt 유지 확인
- 마우스로 pane 클릭 전환 확인
- Pane 경계선 드래그로 크기 조절 확인
- `harness skip` → Claude에 Ctrl-C 전달, 다음 phase 진행 확인
- `harness resume` → 기존 세션 재연결 확인
- 이미 tmux 안에서: reused mode 동작 확인

---

## Success criteria

1. `harness run` 시 왼쪽 30% control panel + 오른쪽 70% workspace로 분할됨
2. Interactive phase에서 Claude가 workspace pane에서 실행됨
3. Claude 종료 후 workspace pane의 shell이 살아있음 (사용자 자유 입력 가능)
4. Gate/verify phase에서 workspace pane은 idle, control pane에서 로그 출력
5. 마우스로 pane 클릭 전환 가능
6. `harness skip`/`jump` 시 Claude가 Ctrl-C로 중단됨
7. `pnpm test` 통과, `pnpm run lint` 클린

---

## Risks

**R1: `send-keys`로 보낸 Claude 명령이 사용자 입력과 충돌**
- 완화: Phase 시작 전 `Ctrl-C` 선전송 + 0.3초 대기.
- 사용자가 인지하고 있으므로 큰 문제 아님.

**R2: Claude PID 캡처 실패 (프로세스가 아직 시작 안 됨)**
- 완화: 1초 대기 후 캡처. 실패 시 sentinel-only 모드로 fallback.

**R3: Pane ID가 session 재연결 후 변경될 수 있음**
- 완화: `state.tmuxWorkspacePane`을 resume 시 재캡처. Pane이 없으면 다시 split.

---

## Out of scope

- Control pane에서의 interactive 조작 (skip/jump 버튼 등) — 별도 터미널에서 CLI로 제어
- Pane 비율 커스터마이징 옵션 — 30/70 고정
- 3-pane 이상 분할
- TUI 프레임워크 (blessed, ink)
