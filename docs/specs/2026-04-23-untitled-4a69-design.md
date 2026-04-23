# Control Pane TUI Polish — Ink-based Control Panel (tmux retained)

- **Run ID**: 2026-04-23-untitled-4a69
- **Task source**: `.harness/2026-04-23-untitled-4a69/task.md`
- **Decisions log**: `.harness/2026-04-23-untitled-4a69/decisions.md`
- **Related ADRs**: `docs/specs/2026-04-14-tmux-rearchitecture-design.md`

## Context & Decisions

원본 task("phase-harness의 tmux 의존성을 제거하고 tui기반으로 재구성")의 진짜 목표를 brainstorming 세션에서 다시 풀어봤다. 사용자가 원한 본질은 **"claude code session 같은 polished TUI"** 였고, tmux 제거는 수단이었다. 분석 결과:

- 현재 tmux는 단순 chrome이 아니라 **두 독립 프로세스**(harness orchestrator + Claude/Codex CLI 풀스크린 TUI)를 한 화면에 동시에 보여주기 위한 다중화 계층이다. Claude/Codex가 각자 alt-screen을 점유하므로 같은 TTY를 공유할 수 없다.
- tmux를 떼려면 (a) embedded PTY로 자식 TUI를 직접 호스팅(=mini terminal multiplexer 자체 구현)하거나 (b) 시간 분할(sequential takeover)로 한 번에 한 TUI만 살아있게 해야 한다.
- (a)는 사실상 ANSI 파서·resize·focus·mouse routing을 처음부터 만드는 일이고, tmux(15년+ 검증)보다 안정성에서 떨어질 수밖에 없다. (b)는 동시 가시성을 잃는다.

**결정**: tmux는 **유지**한다. 다중화는 검증된 도구가 담당하고, polish가 필요한 영역은 control pane 내부 UI 한 곳뿐이다. 본 변경은 그 영역만 Ink(React-based TUI) 기반으로 재작성한다. 사용자 의도("엄청나고 완성도 있어보이는 TUI")는 이 범위로 충분히 달성 가능하다 — Claude Code 자체가 Ink로 구현된 것으로 알려져 있어 visual fidelity 목표와 동일 라이브러리를 쓴다.

추가로 고정된 결정:

- **언어/런타임**: TypeScript/Node.js 유지. Bubble Tea(Go) 또는 별도 Go 바이너리 분리는 채택하지 않는다.
- **UI 라이브러리**: `ink` v5 + `react` v18. 색·레이아웃은 `ink` 내장만 사용(추가 위젯 라이브러리 없음).
- **변경 표면**: control pane 안의 UI 레이어 한정. tmux/runner/state/sentinel/gate 흐름은 건드리지 않는다.
- **telemetry 호환성**: `events.jsonl`의 `ui_render`(callsite enum 9종) 및 `terminal_action` 이벤트 스키마와 발행 시점을 보존한다.

## Complexity

Medium — UI 레이어 한정 재작성(신규 디렉토리 + 호출부 변경). 멀티플렉싱·runner·state·sentinel은 미변경.

## Goals

1. Control pane의 visual fidelity를 "claude code session" 수준으로 끌어올린다 — 일관된 색 위계, spinner, 분명한 phase timeline, 명확한 action menu.
2. 현재 chalk 기반 raw print(`src/ui.ts`, 일부 `src/phases/terminal-ui.ts`)를 Ink 컴포넌트 트리로 대체한다.
3. Runner / state / gate / sentinel / tmux 다중화 계층을 **회귀 없이** 보존한다.
4. `events.jsonl` schema(특히 `ui_render.callsite` 리터럴 union 9종, `terminal_action`)와 발행 시점을 보존해 외부 도구·세션 로그 호환성을 유지한다.

## Non-Goals

- tmux 의존성 제거. 본 변경은 tmux를 그대로 둔다.
- Embedded PTY / 자체 ANSI 파서 / 자체 multiplexer 구현.
- `src/runners/{claude,codex}.ts`, `src/phases/runner.ts`의 phase 로직, `src/state.ts` 스키마, `scripts/harness-verify.sh`, sentinel/gate 규약, signal/SIGUSR1 control plane 변경.
- Headless / non-interactive resume path(`src/resume.ts`의 비대화형 분기)에 Ink를 도입하는 것 — 해당 경로는 plain log 출력을 유지한다.
- 새로운 phase 추가, gate rubric 변경, model preset 변경, 새 CLI 서브커맨드.
- Windows 지원 확장(현 상태 유지: macOS/Linux 한정).

## Architecture

```
tmux session (변경 없음)
├── control pane  ←  여기 안에 Ink <App /> 마운트 (신규)
└── workspace pane  ←  Claude / Codex 풀스크린 (변경 없음)
```

**신규 모듈** (`src/ink/`):

| 경로 | 역할 |
|---|---|
| `src/ink/render.ts` | Ink mount/unmount facade. 외부에서 호출하는 단일 진입점(`renderControlPanel(state, logger, callsite)`)을 export하여 기존 호출부와 시그니처 호환. 내부적으로 `render()`/`rerender()`/`unmount()` 라이프사이클을 관리. |
| `src/ink/store.ts` | `HarnessState` snapshot + 마지막 `RenderCallsite` + footer summary를 React state로 노출하는 작은 pub/sub. `renderControlPanel` 호출이 dispatch로 변환되고, `App`이 구독한다. |
| `src/ink/App.tsx` | Root 컴포넌트. theme provider + layout(Header / PhaseTimeline / CurrentPhase / GateVerdict / ActionMenu / Footer 배치). |
| `src/ink/theme.ts` | Color palette, glyph 상수, `useTerminalSize` 훅. 색 위계는 status별 단일 정의(green=ok, yellow=in-progress, red=fail, dim=pending, cyan=accent). |
| `src/ink/components/Header.tsx` | Brand title, run ID(축약), flow mode badge(full/light), elapsed time. |
| `src/ink/components/PhaseTimeline.tsx` | 7-phase(full) 또는 5-phase(light) 가로 타임라인. 각 phase에 status icon + label. 현재 phase 강조. |
| `src/ink/components/CurrentPhase.tsx` | 현재 phase 상세 박스: 이름, 상태, gate retry index(있으면), preset(model/runner/effort). |
| `src/ink/components/GateVerdict.tsx` | 가장 최근 gate verdict 요약(approved/rejected, retry index, runner). 없으면 hidden. |
| `src/ink/components/ActionMenu.tsx` | Context-sensitive R/J/Q 메뉴 (terminal-failed 시 prominent, 그 외 hint 형태). |
| `src/ink/components/Footer.tsx` | `FooterSummary`(token usage, phase elapsed) 표시. 폭 < 60일 때 자동 단축. |

**수정되는 모듈**:

- `src/ui.ts` — `renderControlPanel` 본문을 `src/ink/render.ts`로 위임하는 thin re-export로 축소한다. 같은 파일의 `formatFooter`, `printError`, `printInfo`, `separator` 같은 비-render 헬퍼는 그대로 둔다(다른 호출부가 사용 중).
- `src/phases/terminal-ui.ts` — R/J/Q 프롬프트 직전 호출하는 `renderControlPanel(..., 'terminal-failed')` / `'terminal-complete'`는 변경 없이 그대로 사용. R/J/Q 입력 자체는 기존 `InputManager`가 계속 처리(아래 InputManager 항목 참고).
- `src/phases/runner.ts` — `renderControlPanel` 호출부(현 7곳: `loop-top`, `interactive-redirect`, `interactive-complete`, `gate-redirect`, `gate-approve`, `verify-complete`, `verify-redirect`) 시그니처 그대로 유지. import 경로만 그대로(`'../ui.js'`).
- `src/input.ts` — **변경 없음**. Ink는 control pane의 시각 출력만 담당하고, R/J/Q 키 입력은 기존 `InputManager`가 raw stdin을 계속 다룬다(이유: pre-emptive 1s TTL `pendingKey`를 비롯한 검증된 race-handling을 보존하기 위함).

**변경되지 않는 모듈**: `src/tmux.ts`, `src/runners/{claude.ts,codex.ts,claude-usage.ts}`, `src/state.ts`, `src/types.ts`(스키마), `src/signal.ts`, `src/resume.ts`, `src/commands/{run,start,inner,resume,jump,skip}.ts`, `scripts/harness-verify.sh`, `src/context/**`, sentinel·gate·preset 흐름 전체.

## Rendering & Lifecycle

- 외부 호출 시그니처 보존: `renderControlPanel(state: HarnessState, logger?: SessionLogger, callsite?: RenderCallsite): void`. 호출부는 변경 없음.
- 내부 동작: 첫 호출 시 Ink `render()`로 마운트. 이후 호출은 store dispatch → React re-render. tmux pane이 사라지거나 `process.exit` 직전에는 `unmount()` cleanup. `process.stdin.isTTY === false`인 비대화형 환경에서는 Ink 마운트를 건너뛰고 한 줄 plain status를 stderr에 기록(현 `console.error` 동작과 호환).
- alt-screen은 사용하지 않는다 — control pane은 흐르는 로그처럼 보이지 않고 정적인 panel처럼 보여야 하지만, alt-screen을 켜면 tmux pane scrollback이 깨지므로 일반 화면 모드에서 `\x1b[2J\x1b[H` clear 후 그린다(현 동작과 동일).
- Resize: Ink가 SIGWINCH를 자체 처리한다. `useTerminalSize`로 폭 < 60일 때 component가 축약 표시로 자동 전환한다.

## Telemetry & Compatibility

- `events.jsonl`의 `ui_render` 이벤트는 기존과 동일한 (event, phase, phaseStatus, callsite) shape으로 발행한다. 발행 위치는 `src/ink/render.ts`의 진입점 한 곳으로 일원화한다(현재는 `src/ui.ts`).
- `RenderCallsite` 리터럴 union(9종)을 그대로 보존한다. 신규 callsite 추가하지 않는다.
- `terminal_action` 이벤트(`action: 'resume' | 'jump' | 'quit'`, `fromPhase`, `targetPhase?`)는 `src/phases/terminal-ui.ts`의 `enterFailedTerminalState`가 계속 발행한다(미변경).
- `phase_start.preset`, `phase_end.claudeTokens`, `gate_verdict`, `gate_retry`, `gate_error` 이벤트는 모두 미변경.
- `~/.harness/sessions/<hash>/<runId>/{events.jsonl, meta.json, summary.json}` 경로 미변경.

## Build & Tooling

- `package.json`: dependencies에 `ink@^5`, `react@^18` 추가. devDependencies에 `@types/react`, `ink-testing-library` 추가.
- `tsconfig.json`: `"jsx": "react-jsx"` 활성화(또는 동등 설정). target ES2022 유지.
- `scripts/copy-assets.mjs`: `src/ink/**/*.tsx`는 tsc가 컴파일하므로 별도 복사 불필요. 기존 prompts/skills/playbooks 복사 로직 미변경.
- `pnpm tsc --noEmit`(= `pnpm lint`)와 `pnpm vitest run`이 신규 `.tsx` 파일을 포함해 통과해야 한다.
- `pnpm build`가 `dist/` 내에 컴파일된 `ink/` 산출물을 포함해야 하며, `dist/cli.js` 실행 시 Ink가 정상 마운트되어야 한다(integration 검증).

## Testing

- **Component tests** (`ink-testing-library`): 각 component(`PhaseTimeline`, `CurrentPhase`, `GateVerdict`, `ActionMenu`, `Footer`)에 대해 (a) full flow / light flow snapshot, (b) phase status 조합(pending/in_progress/completed/failed/skipped) 렌더링, (c) 폭 < 60 축약 분기.
- **Render facade test** (`src/ink/render.test.ts`): `renderControlPanel`을 9가지 callsite 모두로 호출 → 각 호출에서 logger가 (event=`ui_render`, callsite=호출값) 1건을 기록하는지 검증.
- **회귀 방지**: 기존 vitest 스위트(`src/**/*.test.ts`)가 그대로 통과해야 한다 — runner/state/gate/sentinel 테스트 미수정.
- **수동 dogfood**: `pnpm build && phase-harness start --light "<dummy task>"`로 Phase 1까지 진행해 control pane이 정상 렌더링되는지, R/J/Q 입력이 동작하는지, tmux pane resize 시 깨지지 않는지 확인.

## Success Criteria

1. `pnpm tsc --noEmit` 통과(신규 `.tsx` 포함, 0 error).
2. `pnpm vitest run` 전체 통과(신규 ink 컴포넌트 테스트 + 기존 테스트 모두 green).
3. `pnpm build` 성공 후 `dist/ink/` 디렉토리 존재 확인 가능.
4. `grep -rn "renderControlPanel" src/` 결과의 모든 호출부가 동일 시그니처(`(state, logger?, callsite?)`)로 호출되어야 하며, callsite 인자는 `RenderCallsite` 리터럴 union 9종 안에 있어야 한다.
5. `src/ink/` 디렉토리가 존재하며 다음 파일을 모두 포함한다: `render.ts`, `store.ts`, `App.tsx`, `theme.ts`, `components/Header.tsx`, `components/PhaseTimeline.tsx`, `components/CurrentPhase.tsx`, `components/GateVerdict.tsx`, `components/ActionMenu.tsx`, `components/Footer.tsx`.
6. `src/types.ts`의 `RenderCallsite` 리터럴 union이 9종(loop-top, interactive-redirect, interactive-complete, gate-redirect, gate-approve, verify-complete, verify-redirect, terminal-failed, terminal-complete) 그대로 유지된다 — 추가/제거 금지.
7. `package.json` dependencies에 `ink`와 `react`가 등록된다.

## Invariants

- **tmux 사용 유지**: `src/tmux.ts` export(`createSession`, `createWindow`, `splitPane`, `sendKeys`, `sendKeysToPane`, `killSession`, `killWindow`, `selectWindow`, `selectPane`, `paneExists`, `isInsideTmux`, `getCurrentSessionName`, `getActiveWindowId`, `getDefaultPaneId`, `pollForPidFile`, `windowExists`)는 유지되며, `src/ink/` 어디에서도 import하지 않는다(`grep -rn "from.*tmux" src/ink/` 결과 0건).
- **Runner 미변경**: `src/runners/claude.ts`, `src/runners/codex.ts`, `src/runners/claude-usage.ts`의 변경 없음. `git diff main -- src/runners/` 결과는 빈 diff여야 한다.
- **State 스키마 미변경**: `src/state.ts`와 `src/types.ts`의 `HarnessState`/`LogEvent`/`ClaudeTokens`/`GateSessionInfo` 정의 미변경.
- **Sentinel/gate 흐름 미변경**: `src/phases/runner.ts`의 phase 1~7 dispatch 로직, `harness-verify.sh`, `src/context/assembler.ts`의 gate 컨트랙트 미변경.
- **InputManager 미변경**: `src/input.ts`의 `InputManager` 클래스 미변경(pre-emptive 1s TTL pendingKey, raw stdin handling 보존).
- **Telemetry 호환**: 기존 `events.jsonl` 컨슈머가 본 변경 후에도 동일 schema로 이벤트를 받을 수 있어야 한다 — `ui_render`/`terminal_action` 외 새 이벤트 추가 금지, 기존 이벤트 필드 제거/이름 변경 금지.
- **Headless 보존**: `process.stdin.isTTY === false` 환경에서 Ink mount 시도 없이 plain stderr 출력 fallback이 동작해야 한다.

## Out of Scope (defer)

- tmux 완전 제거 또는 embedded PTY 구현. 향후 별도 spec에서 별도 옵트인 플래그로 검토할 수 있다.
- `--no-color` / `NO_COLOR` 환경변수 지원(현 코드에도 일관된 처리 없음 — 본 변경에서 추가하지 않음).
- 마우스 인터랙션, 클릭 가능한 phase navigation.
- Ink로 새로운 정보 표시(현 control panel에 없는 metric 추가) — 이 spec은 polish 한정이며 정보 추가는 별도 spec.
- Windows 지원.
