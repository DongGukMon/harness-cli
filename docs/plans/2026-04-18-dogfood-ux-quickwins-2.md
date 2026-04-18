# Dog-Fooding UX Quick-Wins 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**관련 문서:**
- Spec: `docs/specs/2026-04-18-dogfood-ux-quickwins-2-design.md`
- Eval checklist: 본 문서 §Eval Checklist
- Eval report (작성 예정): `docs/process/evals/2026-04-18-dogfood-ux-quickwins-2-eval.md`

**Goal:** Dog-fooding QA에서 식별된 독립 이슈 3건(plan prompt env 격리 문구, advisor reminder 타이밍, InputManager pending-key 버퍼)을 한 번에 처리한다.

**Architecture:** 세 변경 모두 resume 작업 코드 면(`src/runners/codex.ts`, `src/phases/gate.ts`, `src/phases/runner.ts`, `src/commands/inner.ts`, `src/signal.ts`, `src/state.ts`, `src/types.ts`, `src/context/assembler.ts`)을 건드리지 않는다. 세 파일만 수정(`src/context/prompts/phase-3.md`, `src/phases/interactive.ts`, `src/input.ts`) + 각각 테스트. 이슈 단위 commit 3개.

**Tech Stack:** TypeScript (Node.js), vitest, 기존 InputManager private 메서드 `(im as any).onData(...)`로 테스트 인젝션.

---

## File Structure

### 수정 파일
- `src/context/prompts/phase-3.md` — checks 스키마 설명 뒤에 env 격리 제약 문장 1개 추가
- `src/phases/interactive.ts` — advisor reminder 호출 위치 이동 + 300ms sleep 제거
- `src/input.ts` — `pendingKey` 슬롯 + TTL 상수 + onData 버퍼링 분기 + waitForKey 사전 확인
- `tests/input.test.ts` — 5 pendingKey 케이스 추가
- `tests/phases/interactive.test.ts` — advisor reminder 순서 테스트 반전

### 신규 파일
없음.

---

## Task 1: Plan 프롬프트에 env 격리 제약 추가 (#4)

**Files:**
- Modify: `src/context/prompts/phase-3.md:17`

프롬프트는 정적 텍스트이므로 TDD 불필요. 한 문장 삽입만.

- [ ] **Step 1: `phase-3.md`에 env 격리 제약 문장 추가**

변경 전 (라인 17 주변):
```
`checks` 배열은 비어있지 않아야 하며 각 항목에 `name`(string)과 `command`(string)이 필수다.

`.harness/{{runId}}/phase-3.done` 파일을 생성하되 내용으로 '{{phaseAttemptId}}' 한 줄만 기록하라.
```

변경 후:
```
`checks` 배열은 비어있지 않아야 하며 각 항목에 `name`(string)과 `command`(string)이 필수다.

각 check command는 격리된 셸 환경에서 실행된다. venv/node_modules 등 의존성을 요구하는 검증은 절대경로 바이너리(`.venv/bin/python -m pytest`, `./node_modules/.bin/eslint`)나 env-aware 래퍼(`make test`, `pnpm test`)를 사용하라.

`.harness/{{runId}}/phase-3.done` 파일을 생성하되 내용으로 '{{phaseAttemptId}}' 한 줄만 기록하라.
```

- [ ] **Step 2: grep 확인**

```bash
grep -n "격리된 셸 환경" src/context/prompts/phase-3.md
```
Expected: 1 hit.

- [ ] **Step 3: 프롬프트 관련 테스트 회귀 확인**

```bash
pnpm -s vitest run tests/context/
```
Expected: 전부 green.

- [ ] **Step 4: Commit**

```bash
git add src/context/prompts/phase-3.md
git commit -m "fix(prompts): add env-isolated check command constraint to phase-3"
```

---

## Task 2: Advisor reminder 호출 위치 이동 (#10)

**Files:**
- Modify: `src/phases/interactive.ts:197-205`
- Modify: `tests/phases/interactive.test.ts:574-603`

TDD 순서: 테스트부터 기대 순서 뒤집기 → fail 확인 → 구현 이동 → pass 확인.

- [ ] **Step 1: 테스트 describe/it 이름 + assertion 반전**

`tests/phases/interactive.test.ts:574-603`의 describe 블록을 다음으로 교체:

변경 전:
```ts
// ─── runInteractivePhase: advisor reminder ordering ──────────────────────────

describe('runInteractivePhase — advisor reminder fires before sendKeysToPane', () => {
  it('printAdvisorReminder is called before sendKeysToPane', async () => {
    const { sendKeysToPane } = await import('../../src/tmux.js');
    const { printAdvisorReminder } = await import('../../src/ui.js');
    const { runInteractivePhase } = await import('../../src/phases/interactive.js');

    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();
    const repoDir = createTestRepo();

    const state = makeState({ tmuxSession: 'test-session', tmuxWorkspacePane: '%1', tmuxControlPane: '%0' });

    // Clear any previous call records from other tests
    vi.mocked(printAdvisorReminder).mockClear();
    vi.mocked(sendKeysToPane).mockClear();

    // Run; it will resolve as 'failed' (no sentinel, PID dies immediately) — that's fine
    await runInteractivePhase(1, state, harnessDir, runDir, repoDir, 'test-attempt-id');

    const reminderOrder = vi.mocked(printAdvisorReminder).mock.invocationCallOrder[0];
    // sendKeysToPane is called twice: C-c pre-clear, then the actual command
    const sendKeysToPaneOrder = vi.mocked(sendKeysToPane).mock.invocationCallOrder[0];

    expect(reminderOrder).toBeDefined();
    expect(sendKeysToPaneOrder).toBeDefined();
    expect(reminderOrder).toBeLessThan(sendKeysToPaneOrder);
    expect(vi.mocked(printAdvisorReminder)).toHaveBeenCalledWith(1, 'claude');
  });
```

변경 후:
```ts
// ─── runInteractivePhase: advisor reminder ordering ──────────────────────────

describe('runInteractivePhase — advisor reminder fires after runClaudeInteractive', () => {
  it('printAdvisorReminder is called after all sendKeysToPane calls', async () => {
    const { sendKeysToPane } = await import('../../src/tmux.js');
    const { printAdvisorReminder } = await import('../../src/ui.js');
    const { runInteractivePhase } = await import('../../src/phases/interactive.js');

    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();
    const repoDir = createTestRepo();

    const state = makeState({ tmuxSession: 'test-session', tmuxWorkspacePane: '%1', tmuxControlPane: '%0' });

    // Clear any previous call records from other tests
    vi.mocked(printAdvisorReminder).mockClear();
    vi.mocked(sendKeysToPane).mockClear();

    // Run; it will resolve as 'failed' (no sentinel, PID dies immediately) — that's fine
    await runInteractivePhase(1, state, harnessDir, runDir, repoDir, 'test-attempt-id');

    const reminderOrder = vi.mocked(printAdvisorReminder).mock.invocationCallOrder[0];
    // sendKeysToPane is called multiple times (C-c pre-clear, wrapped cmd);
    // reminder should fire after all of them (post-dispatch).
    const sendKeysCalls = vi.mocked(sendKeysToPane).mock.invocationCallOrder;
    const lastSendKeysOrder = sendKeysCalls[sendKeysCalls.length - 1];

    expect(reminderOrder).toBeDefined();
    expect(lastSendKeysOrder).toBeDefined();
    expect(reminderOrder).toBeGreaterThan(lastSendKeysOrder);
    expect(vi.mocked(printAdvisorReminder)).toHaveBeenCalledWith(1, 'claude');
  });
```

(두 번째 `it` "sendKeysToPane command includes --dangerously-skip-permissions and --effort"는 변경 없음.)

- [ ] **Step 2: 테스트 실행 → 실패 확인 (구현 미변경)**

```bash
pnpm -s vitest run tests/phases/interactive.test.ts -t "advisor reminder"
```
Expected: FAIL — `reminderOrder`가 아직 `lastSendKeysOrder`보다 작음.

- [ ] **Step 3: `interactive.ts`에서 호출 위치 이동**

`src/phases/interactive.ts`의 `runInteractivePhase` 함수 안, Claude 분기 처리 직전 라인들.

변경 전 (라인 197-224 근방):
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
    const { runCodexInteractive } = await import('../runners/codex.js');
    const result = await runCodexInteractive(
      phase, updatedState, preset, harnessDir, runDir, promptFile, cwd,
    );
    if (result.status === 'failed') {
      return { status: 'failed', attemptId };
    }
    // Validate artifacts after Codex completes
    const valid = validatePhaseArtifacts(phase, updatedState, cwd);
    return { status: valid ? 'completed' : 'failed', attemptId };
  }
```

변경 후:
```ts
  // Dispatch to runner
  if (preset.runner === 'claude') {
    const { pid: claudePid } = await runClaudeInteractive(
      phase, updatedState, preset, harnessDir, runDir, promptFile,
    );
    printAdvisorReminder(phase, preset.runner);
    const sentinelPath = path.join(runDir, `phase-${phase}.done`);
    const resolvedAttemptId = updatedState.phaseAttemptId[String(phase)] ?? attemptId;
    const result = await waitForPhaseCompletion(
      sentinelPath, resolvedAttemptId, claudePid, phase, updatedState, cwd, runDir
    );
    return { ...result, attemptId };
  } else {
    // Codex runner — printAdvisorReminder is a no-op for codex, omit call
    const { runCodexInteractive } = await import('../runners/codex.js');
    const result = await runCodexInteractive(
      phase, updatedState, preset, harnessDir, runDir, promptFile, cwd,
    );
    if (result.status === 'failed') {
      return { status: 'failed', attemptId };
    }
    // Validate artifacts after Codex completes
    const valid = validatePhaseArtifacts(phase, updatedState, cwd);
    return { status: valid ? 'completed' : 'failed', attemptId };
  }
```

(기존 `printAdvisorReminder(phase, preset.runner);` + `await new Promise<void>((resolve) => setTimeout(resolve, 300));` 두 줄 제거. Claude 분기 안에 reminder 한 줄 추가.)

- [ ] **Step 4: 테스트 실행 → 통과 확인**

```bash
pnpm -s vitest run tests/phases/interactive.test.ts
```
Expected: 전체 interactive 테스트 green (34 passed). advisor reminder 테스트 포함.

- [ ] **Step 5: TypeScript 빌드 확인**

```bash
pnpm -s tsc --noEmit
```
Expected: 에러 없음.

- [ ] **Step 6: Commit**

```bash
git add src/phases/interactive.ts tests/phases/interactive.test.ts
git commit -m "fix(interactive): move advisor reminder to post-Claude-launch"
```

---

## Task 3: InputManager pendingKey 버퍼 (#11)

**Files:**
- Modify: `src/input.ts`
- Modify: `tests/input.test.ts`

TDD 순서: 실패하는 테스트 5개 추가 → fail 확인 → 구현 → pass 확인.

- [ ] **Step 1: `tests/input.test.ts`에 5 신규 케이스 추가**

`tests/input.test.ts` 끝부분에 신규 describe 블록 추가:

```ts
describe('InputManager — pendingKey buffer', () => {
  it('waitForKey resolves immediately with pending key pressed during idle', async () => {
    const im = new InputManager();
    im.enterPhaseLoop(); // state -> idle
    // Inject a key while idle (private onData via any-cast)
    (im as any).onData(Buffer.from('s'));
    const key = await im.waitForKey(new Set(['s', 'c', 'q']));
    expect(key).toBe('S');
  });

  it('waitForKey ignores pending key outside validKeys', async () => {
    const im = new InputManager();
    im.enterPhaseLoop();
    (im as any).onData(Buffer.from('x'));
    // pending is 'x' which is not valid; waitForKey should clear it and wait.
    // Feed a valid key via handler (synthesize by directly invoking handler after Promise starts)
    const p = im.waitForKey(new Set(['s', 'c', 'q']));
    // Simulate later keypress in prompt-single state
    (im as any).handler?.('s');
    const key = await p;
    expect(key).toBe('S');
  });

  it('waitForKey ignores stale pending key older than TTL', async () => {
    const im = new InputManager();
    im.enterPhaseLoop();
    (im as any).onData(Buffer.from('s'));
    // Manually age the pending entry beyond TTL (1000ms)
    (im as any).pendingKey.timestamp = Date.now() - 2000;
    const p = im.waitForKey(new Set(['s', 'c', 'q']));
    // pending is stale → cleared; waitForKey is now waiting on handler.
    (im as any).handler?.('c');
    const key = await p;
    expect(key).toBe('C');
  });

  it('onData does not buffer ESC sequences or control chars in pending', () => {
    const im = new InputManager();
    im.enterPhaseLoop();
    (im as any).onData(Buffer.from('\x1b[A')); // arrow up
    expect((im as any).pendingKey).toBeNull();
    (im as any).onData(Buffer.from('\x7f')); // DEL
    expect((im as any).pendingKey).toBeNull();
  });

  it('waitForKey normal path unchanged when no pending', async () => {
    const im = new InputManager();
    im.enterPhaseLoop();
    // No pre-emptive key; waitForKey enters normal wait.
    const p = im.waitForKey(new Set(['s', 'c', 'q']));
    (im as any).handler?.('q');
    const key = await p;
    expect(key).toBe('Q');
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인 (pendingKey 미구현)**

```bash
pnpm -s vitest run tests/input.test.ts -t "pendingKey buffer"
```
Expected: FAIL — `pendingKey` 프로퍼티 없음 / `onData`가 키를 드롭.

- [ ] **Step 3: `src/input.ts`에 pendingKey 슬롯 + TTL 상수 추가**

파일 최상단 타입 선언 영역(라인 1-3 근방)에 추가:

```ts
interface PendingKey {
  key: string;
  timestamp: number;
}
```

`InputManager` 클래스 본문 필드 섹션 (라인 4-10 근방)에 추가:

```ts
  private pendingKey: PendingKey | null = null;
  private static readonly PENDING_KEY_TTL_MS = 1000;
```

- [ ] **Step 4: `onData`에 pending 버퍼링 분기 추가**

`onData` 메서드(라인 81-102)를 다음으로 교체:

변경 전:
```ts
  private onData(buf: Buffer): void {
    const str = buf.toString();

    // Ctrl+C / Ctrl+D
    if (str === '\x03' || str === '\x04') {
      if (this.isPreLoop) {
        this.onConfigCancel?.();
      } else {
        process.kill(process.pid, 'SIGINT');
      }
      return;
    }

    // ESC sequences (arrow keys, F-keys, etc.)
    if (str.startsWith('\x1b')) return;

    // Idle/configuring without active prompt
    if (this.state === 'idle' || this.state === 'configuring') return;

    // Forward to active handler
    this.handler?.(str);
  }
```

변경 후:
```ts
  private onData(buf: Buffer): void {
    const str = buf.toString();

    // Ctrl+C / Ctrl+D
    if (str === '\x03' || str === '\x04') {
      if (this.isPreLoop) {
        this.onConfigCancel?.();
      } else {
        process.kill(process.pid, 'SIGINT');
      }
      return;
    }

    // ESC sequences (arrow keys, F-keys, etc.)
    if (str.startsWith('\x1b')) return;

    // Idle/configuring without active prompt — buffer single printable ASCII
    // so a pre-emptive keystroke (typed while escalation prompt was printing)
    // is not lost on the next waitForKey.
    if (this.state === 'idle' || this.state === 'configuring') {
      if (str.length === 1 && str.charCodeAt(0) >= 0x20 && str.charCodeAt(0) < 0x7f) {
        this.pendingKey = { key: str, timestamp: Date.now() };
      }
      return;
    }

    // Forward to active handler
    this.handler?.(str);
  }
```

- [ ] **Step 5: `waitForKey`에 pending 사전 확인 추가**

`waitForKey` 메서드(라인 47-59)를 다음으로 교체:

변경 전:
```ts
  waitForKey(validKeys: Set<string>): Promise<string> {
    return new Promise((resolve) => {
      this.state = 'prompt-single';
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

변경 후:
```ts
  waitForKey(validKeys: Set<string>): Promise<string> {
    return new Promise((resolve) => {
      this.state = 'prompt-single';

      // Consume pending key from idle-state buffer if still fresh and valid.
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

- [ ] **Step 6: `stop`에 pendingKey cleanup 추가**

`stop` 메서드(라인 25-36)의 끝부분 교체:

변경 전:
```ts
  stop(): void {
    if (!this.started) return;
    if (this.onDataBound) {
      process.stdin.removeListener('data', this.onDataBound);
      this.onDataBound = null;
    }
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    this.started = false;
  }
```

변경 후:
```ts
  stop(): void {
    if (!this.started) return;
    if (this.onDataBound) {
      process.stdin.removeListener('data', this.onDataBound);
      this.onDataBound = null;
    }
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    this.pendingKey = null;
    this.started = false;
  }
```

- [ ] **Step 7: 테스트 실행 → 통과 확인**

```bash
pnpm -s vitest run tests/input.test.ts
```
Expected: 전체 input 테스트 green (기존 7개 + 신규 5개 = 12 이상).

- [ ] **Step 8: TypeScript 빌드 확인**

```bash
pnpm -s tsc --noEmit
```
Expected: 에러 없음.

- [ ] **Step 9: Commit**

```bash
git add src/input.ts tests/input.test.ts
git commit -m "fix(input): buffer pre-emptive keystrokes to avoid drops at prompts"
```

---

## Task 4: 최종 전체 검증

- [ ] **Step 1: 전체 테스트 스위트 실행**

```bash
pnpm -s vitest run
```
Expected: 전체 green, fail 0. 이전 수(427) 이상.

- [ ] **Step 2: 린트 통과 확인**

```bash
pnpm -s lint
```
Expected: 에러 0.

- [ ] **Step 3: TypeScript 최종 확인**

```bash
pnpm -s tsc --noEmit
```
Expected: 에러 0.

- [ ] **Step 4: 커밋 히스토리 확인**

```bash
git log --oneline -6
```
Expected: 최근 3 fix 커밋 + 1 spec 커밋 + PR 머지 커밋.

---

## Eval Checklist

### Objective criteria (기계 검증)

- [ ] **EC-1**: `pnpm -s tsc --noEmit` exit 0
  - Pass: stdout 비어있음 + exit 0
- [ ] **EC-2**: `pnpm -s lint` exit 0
  - Pass: error 0
- [ ] **EC-3**: `pnpm -s vitest run` 전체 통과
  - Pass: fail 0, 총 테스트 수 ≥ 432 (427 baseline + 최소 5 신규)
- [ ] **EC-4**: #4 env 격리 문구 반영
  - Command: `grep -n "격리된 셸 환경" src/context/prompts/phase-3.md`
  - Pass: 1 hit
- [ ] **EC-5**: #10 advisor reminder 이동 완료 (원 위치 삭제)
  - Command: `grep -n "setTimeout(resolve, 300)" src/phases/interactive.ts || echo "clean"`
  - Pass: "clean" 또는 0 hits
- [ ] **EC-6**: #10 advisor reminder가 Claude 분기 안에 위치
  - Command: `awk '/if \(preset.runner === .claude.\)/,/waitForPhaseCompletion/' src/phases/interactive.ts | grep -c printAdvisorReminder`
  - Pass: 1
- [ ] **EC-7**: #11 pendingKey 슬롯 선언됨
  - Command: `grep -n "pendingKey: PendingKey" src/input.ts`
  - Pass: 1 hit
- [ ] **EC-8**: #11 TTL 상수 선언됨
  - Command: `grep -n "PENDING_KEY_TTL_MS" src/input.ts`
  - Pass: 최소 2 hits (선언 1 + 사용 1)
- [ ] **EC-9**: #11 onData 버퍼링 분기 존재
  - Command: `grep -n "this.pendingKey = { key: str" src/input.ts`
  - Pass: 1 hit
- [ ] **EC-10**: Interactive reminder 순서 테스트 pass
  - Command: `pnpm -s vitest run tests/phases/interactive.test.ts -t "advisor reminder"`
  - Pass: 1 passed (describe 이름 변경 포함)
- [ ] **EC-11**: Input pendingKey 테스트 pass
  - Command: `pnpm -s vitest run tests/input.test.ts -t "pendingKey buffer"`
  - Pass: 5 passed
- [ ] **EC-12**: Spec 링크 유효
  - Command: `test -f docs/specs/2026-04-18-dogfood-ux-quickwins-2-design.md`
  - Pass: exit 0

### Spec traceability

| Spec section | 요구사항 | 구현 태스크 | 검증 EC |
|--------------|----------|-------------|---------|
| §2/§4.1 #4 env 격리 | phase-3.md 한 문장 추가 | Task 1 | EC-4 |
| §2/§4.2 #10 reminder 이동 | interactive.ts 호출 위치 + 테스트 반전 | Task 2 | EC-5, EC-6, EC-10 |
| §2/§4.3 #11 pendingKey | input.ts 필드/TTL/onData/waitForKey/stop | Task 3 | EC-7, EC-8, EC-9, EC-11 |
| §5 테스트 전략 | 회귀 green | Task 4 | EC-1, EC-2, EC-3 |

### Subjective criteria

- [ ] **SC-1**: 세 변경이 서로 간섭 없이 적용됨 (파일 면 분리: prompts, interactive.ts, input.ts)
- [ ] **SC-2**: 커밋 3개가 이슈 단위로 분리됨, 각 타이틀이 해당 이슈를 정확히 기술
- [ ] **SC-3**: #11 TTL 1000ms이 주석으로 의도 명시 (pre-emptive window)
- [ ] **SC-4**: 수동 smoke (optional) — 실제 escalation 프롬프트에서 pre-emptive `S`/`C`/`Q` 입력이 첫 키에 반응

---

## Notes for Implementer

- Task 1은 TDD 불필요(정적 텍스트). Task 2/3만 TDD.
- Task 2의 assertion 반전은 상대 순서 비교(`toBeGreaterThan`). invocationCallOrder는 전역 카운터라 여러 테스트에서 값이 누적되지만, 각 테스트에서 `mockClear()`로 리셋 후 `mock.invocationCallOrder` 배열은 해당 테스트 호출만 포함.
- Task 3 테스트에서 `(im as any).handler?.('s')`로 handler를 직접 invoke하는 이유: TTY 없는 환경에서 `onData`를 호출해도 handler가 set되기 전에 state 전이가 완료되어 의도한 경로를 재현하기 위함. handler는 `waitForKey`가 set하므로 Promise 생성 직후 `.then(resolve)` 이전에 호출 가능.
- 커밋 메시지는 `fix(<scope>): <imperative>` 형식 유지.
- resume 작업 코드 면(`src/runners/codex.ts`, `src/phases/gate.ts`, `src/phases/runner.ts`, `src/commands/inner.ts`, `src/signal.ts`, `src/state.ts`, `src/types.ts`, `src/context/assembler.ts`)은 건드리지 말 것.
