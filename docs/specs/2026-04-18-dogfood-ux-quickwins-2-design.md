# Dog-Fooding UX Quick-Wins 2 — Design Spec

- 상태: draft
- 작성일: 2026-04-18
- 담당: Claude Code (engineer)
- 관련 문서:
  - 근거 QA 관찰: `qa-observations.md` (#4, #10, #11)
  - 이전 번들: `docs/specs/2026-04-18-dogfood-ux-quickwins-design.md`
  - Impl plan: `docs/plans/2026-04-18-dogfood-ux-quickwins-2.md` (작성 예정)
  - Eval report: `docs/process/evals/2026-04-18-dogfood-ux-quickwins-2-eval.md` (작성 예정)

## 1. 배경과 목표

1차 quickwins 번들(pane ratio, sentinel contract, slug cap)이 main에 머지된 이후, resume 작업과 무관한 다음 독립 후보 3건을 한 번에 묶어 처리한다.

**범위에 포함**:

- **#4**: Phase 3 plan이 venv 밖 `pytest -q` 같은 env-naive checklist를 생성해 Phase 6 verify가 전체 fail.
- **#10**: Advisor reminder가 `printAdvisorReminder`를 Claude dispatch **전**에 호출 → 워크스페이스 pane 활동(Ctrl+C, 래퍼 명령 타이핑)에 주의가 먼저 쏠려 리마인더가 "이미 작업 시작 후 등장한 것처럼" 인지됨.
- **#11**: Escalation 단일키(`S`/`C`/`Q`)가 때때로 첫 입력에서 반응 안 함. 원인: `InputManager.onData`가 `state === 'idle'` 시 키를 드롭 → 사용자가 프롬프트 표시 직후/직전 키를 누르면 첫 키 유실.

**비목표**:

- Resume 작업 코드 면(`src/runners/codex.ts`, `src/phases/gate.ts`, `src/phases/runner.ts`, `src/commands/inner.ts`, `src/signal.ts`, `src/state.ts`, `src/types.ts`, `src/context/assembler.ts`) 수정 전면 금지.
- Verify 스크립트(`scripts/harness-verify.sh`) 확장(#4 B안, checklist schema `setup` 필드). 본 작업은 프롬프트 제약만.
- Advisor 워크플로 근본 재설계(prompt-before-submit 지원 등). Reminder 배치만.
- 입력 시스템 전면 재작성(readline 전환 등). pending-key 버퍼링만.

**성공 기준**:

- Python 프로젝트 dog-fooding run에서 Phase 6 초기 실행이 venv 경유해 pytest를 실행.
- Claude dispatch 직후 (PID 확보 완료 시점) 컨트롤 pane에 advisor reminder가 출력되어, 사용자 행동 가능 시점과 시각적 alignment.
- Escalation 프롬프트에서 첫 키스트로크가 유효 키이면 즉시 반응. Idle 상태 pre-emptive 입력(1초 이내)이 유실되지 않음.
- 기존 테스트 전부 green, 회귀 0.

## 2. Context & Decisions

### 핵심 결정사항

- **#4 plan prompt env constraint**: `src/context/prompts/phase-3.md`의 checklist 스키마 블록 바로 아래에 환경 격리 제약 한 문장 추가. 예:
  > 각 check command는 격리된 셸 환경에서 실행된다. venv/node_modules 등 의존성을 요구하는 검증은 절대경로 바이너리(`.venv/bin/python -m pytest`, `./node_modules/.bin/eslint`)나 env-aware 래퍼(`make test`, `pnpm test`)를 사용하라.
- **#10 advisor reminder 이동**: `src/phases/interactive.ts:198` (Claude dispatch 전 호출 + 300ms sleep)을 **제거**. 대신 Claude 경로의 `runClaudeInteractive` 반환 직후(`waitForPhaseCompletion` 호출 **전**) 같은 reminder 호출. Codex 경로는 변경 없음(`printAdvisorReminder`는 runner==='codex'에서 no-op).
- **#11 pendingKey 버퍼**: `InputManager`에 `pendingKey: { key: string; timestamp: number } | null` 필드 추가. `onData`에서 `state === 'idle' || 'configuring'`이면서 printable 키일 때 이 슬롯에 저장(최근 1개). `waitForKey(validKeys)` 진입 시 슬롯 확인 → 유효키 + 1초 이내면 즉시 resolve, 아니면 슬롯 clear 후 기존 대기 로직.

### 제약 조건

- **Resume 작업 코드 면 회피**: `git diff main origin/codex-optimization -- src/` 기준 수정 파일(`src/types.ts`, `src/state.ts`, `src/context/assembler.ts` 등)은 건드리지 않음. 본 작업은 `src/context/prompts/phase-3.md`, `src/phases/interactive.ts`, `src/input.ts`만 수정 → 겹침 0.
- **InputManager 하위 호환**: `pendingKey` 추가는 기존 `waitForKey`/`waitForLine` 동작을 idle 상태 드롭 이외에는 바꾸지 않는다. 기존 `tests/input.test.ts` 회귀 없음을 검증.
- **Reminder 텍스트 의미론**: "Claude 세션이 시작된 뒤 /advisor 입력" 문구가 이미 "Claude 시작 후" 시점을 가리킨다 → 호출 위치를 시작 후로 옮기는 것이 문구 의도와 일치.

### 해소된 모호성

- **#10이 정말 "reminder가 뒤에 나온다"는 것이냐, "reminder가 미리 나오는데 놓친다"는 것이냐?**: 현 코드는 dispatch 전에 호출한다. 즉 "미리 나오지만 놓친다"가 정확. 원인은 Claude dispatch 과정에서 워크스페이스 pane에 연쇄 활동(prev PID kill → Ctrl+C → wrapper typing) 발생 → 사용자 주의가 워크스페이스로 이동. 본 결정의 이동은 **시각 주의 시점과 reminder 출력 시점을 정렬**하기 위함. Reminder 텍스트 의미론도 이 이동과 일치.
- **`pendingKey` 타임스탬프 이유**: 타임스탬프 없이 슬롯만 두면, 몇 분 전 user가 눌러둔 유령 키가 새 프롬프트에서 consume될 위험. 1초 제한으로 "프롬프트 표시 직전 pre-emptive 입력"만 consume하고 이전 잔여는 무시.
- **1초 기준 근거**: tmux pane render lag + stderr write + 사용자 반응 시간의 합. 보수적으로 500ms도 가능하나 1초가 안전. 향후 조정 가능한 상수.
- **`promptChoice` API 불변**: `promptChoice` 호출부는 변경 없음. `waitForKey` 내부 슬롯 확인만 추가 → caller 영향 0.

### 구현 시 주의사항

- **#4**: phase-3.md에 추가하는 문구는 JSON 스키마 블록 바로 아래, `checks` 배열 검증 규칙 문장 **뒤**에 배치. 기존 CRITICAL sentinel 라인과 분리.
- **#10**: interactive.ts의 호출 위치 이동 시, Codex 경로에서 호출하지 않는 기존 semantics 유지. 이동 지점이 여러 개면 (Claude 경로 내부로 이동) runClaudeInteractive 반환 직후가 가장 자연스러움. 300ms sleep 삭제(dispatch 관련 race 방지 목적이었으나 새 위치에선 불필요).
- **#11**: `onData`에서 arrow keys/F-keys(`\x1b` 시작)는 기존처럼 건너뛰기. `\x7f`(backspace), `\x03`/`\x04`(Ctrl+C/D)는 기존 처리 유지. 슬롯에 저장할 키 조건: 상태가 idle/configuring이면서 printable ASCII(문자/숫자)인 단일 바이트.
- **#11 타임스탬프 소스**: `Date.now()` — monotonic 아님에도 수 초 단위 비교엔 충분.

## 3. 현 구조 분석

### 관련 파일과 역할

| 파일 | 현 역할 | 본 작업에서의 변경 |
|------|---------|--------------------|
| `src/context/prompts/phase-3.md` | Phase 3(plan 작성) 프롬프트 템플릿 | checks 스키마 직후 env 격리 제약 한 문장 추가 |
| `src/phases/interactive.ts` | Phase 1/3/5 interactive 디스패치, advisor reminder 호출 | 리마인더 호출을 runClaudeInteractive 반환 직후로 이동, 기존 300ms sleep 제거 |
| `src/input.ts` | InputManager: raw-mode stdin, waitForKey/waitForLine | `pendingKey` 슬롯 추가, `onData`에서 idle/configuring 키 버퍼링, `waitForKey`에서 슬롯 확인 후 즉시 resolve 경로 추가 |
| `tests/input.test.ts` | InputManager 단위 테스트 | pendingKey 신규 case 추가 (pre-emptive key 유효 vs stale 유령 키) |
| `tests/phases/interactive.test.ts` | Interactive phase 테스트 (advisor reminder 관련 2 케이스 포함) | reminder 호출 순서 테스트 갱신 (sendKeysToPane **후** 호출) |

### 현 호출 흐름 (변경 전)

```
runInteractivePhase(claude)
  printAdvisorReminder(phase, 'claude')   ← 현재 위치
  await setTimeout(300)
  runClaudeInteractive(...)
    killPrev? → sendKeysToPane(C-c) → sleep500 → sendKeysToPane(wrappedCmd)
    pollForPidFile
  waitForPhaseCompletion(...)
```

### 변경 후

```
runInteractivePhase(claude)
  runClaudeInteractive(...)
    killPrev? → sendKeysToPane(C-c) → sleep500 → sendKeysToPane(wrappedCmd)
    pollForPidFile
  printAdvisorReminder(phase, 'claude')   ← 새 위치
  waitForPhaseCompletion(...)
```

Codex 경로는 `runCodexInteractive` 내부에서 동작이 다르고 reminder가 no-op이므로 변경 없음.

## 4. 설계 상세

### 4.1 #4 Plan prompt env 격리 제약

**변경 위치**: `src/context/prompts/phase-3.md:17` 뒤(검증 규칙 문장 다음).

**추가 문장**:

```
각 check command는 격리된 셸 환경에서 실행된다. venv/node_modules 등 의존성을 요구하는 검증은 절대경로 바이너리(`.venv/bin/python -m pytest`, `./node_modules/.bin/eslint`)나 env-aware 래퍼(`make test`, `pnpm test`)를 사용하라.
```

배치 예 (변경 후 전체):

```markdown
...
`checks` 배열은 비어있지 않아야 하며 각 항목에 `name`(string)과 `command`(string)이 필수다.

각 check command는 격리된 셸 환경에서 실행된다. venv/node_modules 등 의존성을 요구하는 검증은 절대경로 바이너리(`.venv/bin/python -m pytest`, `./node_modules/.bin/eslint`)나 env-aware 래퍼(`make test`, `pnpm test`)를 사용하라.

`.harness/{{runId}}/phase-3.done` 파일을 생성하되 내용으로 '{{phaseAttemptId}}' 한 줄만 기록하라.
...
```

**테스트**: 프롬프트는 정적 텍스트 → 현 테스트가 문자열을 assert하지 않음(기존 확인). 회귀 없음. 실제 동작 검증은 다음 dog-fooding run으로 확인.

### 4.2 #10 Advisor reminder 위치 이동

**변경 위치**: `src/phases/interactive.ts`의 `runInteractivePhase` Claude 분기.

**변경 전** (라인 197-211 근방):

```ts
  printAdvisorReminder(phase, preset.runner);
  await new Promise<void>((resolve) => setTimeout(resolve, 300));

  // Dispatch to runner
  if (preset.runner === 'claude') {
    const { pid: claudePid } = await runClaudeInteractive(
      phase, updatedState, preset, harnessDir, runDir, promptFile,
    );
    const sentinelPath = path.join(runDir, `phase-${phase}.done`);
    const resolvedAttemptId = updatedState.phaseAttemptId[String(phase)] ?? attemptId;
    const result = await waitForPhaseCompletion(
      sentinelPath, resolvedAttemptId, claudePid, phase, updatedState, cwd, runDir
    );
    return { ...result, attemptId };
  } else {
    // Codex runner
    ...
  }
```

**변경 후**:

```ts
  // Dispatch to runner
  if (preset.runner === 'claude') {
    const { pid: claudePid } = await runClaudeInteractive(
      phase, updatedState, preset, harnessDir, runDir, promptFile,
    );
    printAdvisorReminder(phase, preset.runner);  // 이동된 호출
    const sentinelPath = path.join(runDir, `phase-${phase}.done`);
    const resolvedAttemptId = updatedState.phaseAttemptId[String(phase)] ?? attemptId;
    const result = await waitForPhaseCompletion(
      sentinelPath, resolvedAttemptId, claudePid, phase, updatedState, cwd, runDir
    );
    return { ...result, attemptId };
  } else {
    // Codex runner — reminder no-op for codex, call omitted
    ...
  }
```

기존 `printAdvisorReminder(phase, preset.runner);` + `await setTimeout(300);` 두 줄을 Claude 분기 안으로 옮김. Codex 경로는 reminder 호출 자체가 없어졌지만 기존에도 no-op이었으므로 동작 동일.

**테스트 영향**: `tests/phases/interactive.test.ts`의 "printAdvisorReminder is called before sendKeysToPane" 테스트가 **반대 기대**로 바뀜. 신규 기대: `sendKeysToPane` **후** `printAdvisorReminder` 호출 순서 + "sendKeysToPane command includes --dangerously-skip-permissions and --effort" 테스트는 그대로 유효.

### 4.3 #11 pendingKey 슬롯

**변경 위치**: `src/input.ts` InputManager 클래스 전체.

**타입 정의**:

```ts
interface PendingKey {
  key: string;
  timestamp: number;
}
```

**새 필드**:

```ts
private pendingKey: PendingKey | null = null;
private static readonly PENDING_KEY_TTL_MS = 1000;
```

**`onData` 변경**:

```ts
private onData(buf: Buffer): void {
  const str = buf.toString();

  if (str === '\x03' || str === '\x04') {
    if (this.isPreLoop) {
      this.onConfigCancel?.();
    } else {
      process.kill(process.pid, 'SIGINT');
    }
    return;
  }

  if (str.startsWith('\x1b')) return;

  // NEW: idle/configuring 상태 pre-emptive 키 버퍼링
  if (this.state === 'idle' || this.state === 'configuring') {
    // 단일 printable ASCII 문자만 (multibyte/연타 버퍼는 제외)
    if (str.length === 1 && str.charCodeAt(0) >= 0x20 && str.charCodeAt(0) < 0x7f) {
      this.pendingKey = { key: str, timestamp: Date.now() };
    }
    return;
  }

  this.handler?.(str);
}
```

**`waitForKey` 변경**:

```ts
waitForKey(validKeys: Set<string>): Promise<string> {
  return new Promise((resolve) => {
    this.state = 'prompt-single';

    // NEW: pending key 확인
    if (this.pendingKey !== null) {
      const { key, timestamp } = this.pendingKey;
      this.pendingKey = null;
      if (
        Date.now() - timestamp <= InputManager.PENDING_KEY_TTL_MS &&
        validKeys.has(key.toLowerCase())
      ) {
        this.state = this.isPreLoop ? 'configuring' : 'idle';
        resolve(key.toLowerCase().toUpperCase());
        return;
      }
    }

    this.handler = (key: string) => {
      const lower = key.toLowerCase();
      if (validKeys.has(lower)) {
        this.handler = null;
        this.state = this.isPreLoop ? 'configuring' : 'idle';
        resolve(lower.toUpperCase());
      }
    };
  });
}
```

**`waitForLine` 변경 없음**: line-based 입력은 이 이슈와 무관.

**`stop()` 변경**:

```ts
stop(): void {
  // ...기존...
  this.pendingKey = null;  // NEW: cleanup
  this.started = false;
}
```

### 4.4 테스트 설계

**#11 단위 테스트 신규** (`tests/input.test.ts`):

- `waitForKey resolves immediately with pending key pressed during idle`
  - InputManager start, state=idle 상태에서 onData('s') 주입, 이후 waitForKey({'s','c','q'}) → 즉시 'S' resolve.
- `waitForKey ignores stale pending key older than TTL`
  - onData('s') 주입, 1.1초 대기(fake timer로 Date.now() 시뮬), waitForKey → pending 무시, 새 키 대기.
- `waitForKey ignores pending key outside validKeys`
  - onData('x') 주입, waitForKey({'s','c','q'}) → pending 폐기, 새 키 대기.
- `onData does not buffer control chars/ESC in pending`
  - onData('\x1b') → pendingKey null 유지.
- `waitForKey normal path unchanged when no pending`
  - waitForKey 진입 후 onData('s') → 'S' resolve (기존 동작 회귀 없음).

**#10 기존 테스트 갱신** (`tests/phases/interactive.test.ts`):

- describe 블록 이름 `runInteractivePhase — advisor reminder fires before sendKeysToPane` → `... fires after runClaudeInteractive`로 갱신.
- 내부 it 이름 `printAdvisorReminder is called before sendKeysToPane` → `printAdvisorReminder is called after all sendKeysToPane calls`.
- assertion 갱신: `sendKeysToPane`이 여러 번 호출되므로(C-c pre-clear, wrapped cmd) **마지막** invocationCallOrder와 reminder의 invocationCallOrder 비교. 구체:
  ```ts
  const reminderOrder = vi.mocked(printAdvisorReminder).mock.invocationCallOrder[0];
  const sendKeysCalls = vi.mocked(sendKeysToPane).mock.invocationCallOrder;
  const lastSendKeysOrder = sendKeysCalls[sendKeysCalls.length - 1];
  expect(reminderOrder).toBeGreaterThan(lastSendKeysOrder);
  ```
- 기존 "sendKeysToPane command includes --dangerously-skip-permissions and --effort" 변경 없음.

**#4 테스트**: 정적 프롬프트 텍스트 변경. 추가 단위 테스트 불필요. 원하면 `tests/context/`에 phase-3.md가 env 제약 문구를 포함하는지 grep 스타일 assertion 1개 추가(선택).

## 5. 테스트 전략

### 5.1 단위 테스트

- **#4**: (선택) `tests/context/` 계열에 phase-3.md 로드 후 env 제약 문구 포함 검증 1건. 없어도 회귀 없음.
- **#10**: `tests/phases/interactive.test.ts` — sendKeysToPane 후 printAdvisorReminder 순서 검증.
- **#11**: `tests/input.test.ts` — 5 신규 케이스.

### 5.2 회귀

- `pnpm -s vitest run` 전체 green.
- `pnpm -s tsc --noEmit` 에러 0.
- `pnpm -s lint` 에러 0.

### 5.3 수동 smoke

- Python 태스크 dog-fooding run에서 Phase 3 생성한 checklist가 `.venv/bin/` 접두어 또는 `make test` 쓰는지 확인(선택).
- 실제 escalation 프롬프트에서 pre-emptive 키 입력 테스트(선택).

## 6. 마이그레이션 및 호환성

- Phase 3 프롬프트 텍스트 변경은 기존 외부 코드 영향 없음.
- InputManager 변경은 내부 동작만, 공개 API 불변(`waitForKey`, `waitForLine` 시그니처 동일).
- Interactive phase 호출 흐름은 interactive.ts 내부 구조만 변경, 외부 caller(`runPhaseLoop` 등)에 영향 없음.

## 7. YAGNI / 범위 밖

본 작업 **포함하지 않음**:

- Checklist 스키마에 `setup` 필드 도입(#4 B안). harness-verify.sh 변경 필요.
- Advisor 워크플로 근본 재설계 (pre-submit interactive phase 등).
- InputManager의 readline 기반 재작성.
- ESC sequence / arrow key 처리 확장.
- 1차 quickwins에서 다룬 영역 추가 수정(pane ratio, sentinel contract, slug cap).

## 8. Open Questions

- 없음. 세 변경 모두 mechanism이 명확하고 원인 분석으로 결정 확정.
