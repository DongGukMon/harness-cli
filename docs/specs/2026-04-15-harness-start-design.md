# harness start — Design Spec

- Date: 2026-04-15
- Status: Draft
- Scope: `harness run` → `harness start`로 전환. tmux 안에서 태스크 입력 가능.
- Related: `docs/specs/2026-04-14-pane-layout-design.md` (pane 아키텍처)

---

## Context & Decisions

### Why this work

현재 `harness run "task"` 명령은 터미널에서 태스크 설명을 인자로 받고, tmux 세션을 열고, 즉시 phase loop를 시작한다. 이 흐름의 불편함:

1. **터미널에서 태스크 설명을 미리 작성해야 함** — tmux 환경을 먼저 보면서 태스크를 고민할 수 없음.
2. **`run`이라는 이름이 직관적이지 않음** — "시작"이라는 의미에 `start`가 더 자연스러움.
3. **tmux control panel이 수동적** — 출력만 하고 사용자 입력을 받지 않음 (gate escalation 제외).

### Decisions

**[ADR-1] `harness start`가 기본 진입 명령어. `harness run`은 alias.**
- `harness start "task"` — 태스크 인자 포함 시 기존 `run`과 동일하게 즉시 시작.
- `harness start` — 인자 없이 실행 시 tmux를 열고, control panel에서 태스크 프롬프트를 입력받음.
- `harness run "task"` — `start`의 alias로 유지 (하위 호환).

**[ADR-2] 태스크 입력은 readline 기반. TUI 프레임워크 사용하지 않음.**
- Node.js `readline` 모듈로 한 줄 입력.
- 기존 `promptChoice` 패턴과 동일한 인프라.
- 충분한 이유: 태스크 설명은 한 줄이면 됨. 복잡한 입력은 별도 파일 참조(`@file`)로 대체 가능.

**[ADR-3] 태스크 입력은 `__inner` 내부에서 처리.**
- Outer(`start` 명령)는 기존 `run`과 동일: preflight → state init → tmux → inner 시작.
- Inner가 시작될 때 task가 비어있으면 readline으로 입력받음.
- task가 있으면 즉시 phase loop 시작 (기존 동작).
- 이유: 입력 UI를 control pane에서 보여주려면 inner에서 처리해야 함.

**[ADR-4] 빈 task로 state를 초기화하고, inner에서 task를 채운다.**
- Outer: `createInitialState()`에 `task: ''`로 초기화. `task.md`는 빈 상태로 생성.
- Inner: task가 비어있으면 readline prompt → 입력받은 task로 state와 task.md 갱신.
- 이유: outer는 tmux 생성 + handoff만 담당하고 빠르게 exit해야 함.

**[ADR-5] Control panel 초기 화면.**
- Inner 시작 시 task가 비어있으면:
  ```
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ▶ Harness
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    Run: <runId>

    What would you like to build?
    > 
  ```
- 사용자가 입력하면 state 갱신 → `renderControlPanel()` 표시 → phase loop 시작.

---

## Architecture

### 실행 흐름 — `harness start` (인자 없음)

```
[사용자 터미널]
$ harness start
  │
  ├── 1. preflight (기존과 동일)
  ├── 2. state 초기화 (task: '' — 빈 상태)
  ├── 3. tmux 세션 생성
  ├── 4. __inner 시작 (task 인자 없음)
  ├── 5. iTerm2 열기
  └── 6. exit(0)

[iTerm2 — tmux 세션]
┌─────────────────────┬──────────────────────────────────┐
│ ▶ Harness           │                                  │
│                     │  (workspace - idle)              │
│ What would you      │                                  │
│ like to build?      │                                  │
│                     │                                  │
│ > █                 │                                  │
│                     │                                  │
└─────────────────────┴──────────────────────────────────┘

사용자 입력 후 → phase loop 시작 (기존과 동일)
```

### 실행 흐름 — `harness start "task"` (인자 있음)

현재 `harness run "task"`와 완전히 동일. Inner가 task를 인자로 받으므로 readline 스킵.

### 모듈 변경

**`bin/harness.ts`:**
- `start [task]` 명령 추가 (task는 optional).
- `run <task>`를 `start`의 alias로 변경 (하위 호환).

**`src/commands/run.ts` → `src/commands/start.ts`로 rename:**
- 함수명: `runCommand` → `startCommand`
- task 파라미터가 optional로 변경
- task가 비어있어도 state 초기화 + tmux 생성 진행
- `task.md`는 task가 비어있으면 빈 파일로 생성

**`src/commands/inner.ts`:**
- `innerCommand` 시작 시 state.task가 비어있으면:
  1. Welcome 화면 출력
  2. `readline`으로 태스크 입력받기
  3. State + task.md 갱신
- Task가 있으면 기존대로 즉시 phase loop.

**기존 `run.ts`의 empty-task validation 제거:**
- 현재 `if (!task || task.trim() === '') { ... exit(1); }` → 제거.
- Task 없이 시작하는 것이 정상 흐름.

---

## File-level change list

### Create
- None (rename만)

### Rename
- `src/commands/run.ts` → `src/commands/start.ts`

### Modify
- `bin/harness.ts` — `start [task]` 추가, `run`을 alias로 변경
- `src/commands/start.ts` (renamed) — task optional, empty task 허용
- `src/commands/inner.ts` — readline prompt 추가
- `src/ui.ts` — `renderWelcome(runId: string)` 함수 추가
- `tests/commands/run.test.ts` → 파일명 변경 또는 import 수정

### Delete
- None

---

## Success criteria

1. `harness start` (인자 없음) → tmux 열림 → control panel에 태스크 입력 프롬프트 표시
2. 태스크 입력 후 phase loop 시작 (기존과 동일)
3. `harness start "task"` → 기존 `harness run "task"`와 동일 동작
4. `harness run "task"` → 하위 호환 유지 (alias)
5. `pnpm test` 통과, `pnpm run lint` 클린

---

## Risks

**R1: readline이 tmux pane에서 제대로 동작하지 않을 수 있음.**
- 완화: `__inner`는 tmux window 0의 control pane에서 직접 실행됨. stdin은 정상 사용 가능 (기존 `promptChoice`도 동일 패턴).

**R2: Empty task로 시작 시 preflight의 일부 체크가 의미 없을 수 있음.**
- 완화: preflight는 환경 체크(git, claude, tmux)이므로 task 유무와 무관.

---

## Out of scope

- 여러 줄 입력 (한 줄 readline으로 충분)
- TUI 프레임워크 (blessed, ink)
- 파일 첨부 UI (@file은 task 설명 안에 텍스트로 참조)
- Control panel에서 skip/jump 조작 (별도 터미널에서 CLI로 제어)
