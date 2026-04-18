# Light Flow Three-Bug Fix — Design Spec (Light)

관련 산출물:
- Task: `.harness/2026-04-18-fix-three-light-flow/task.md`
- Gate 7 피드백 (이번 revision에서 반영): `.harness/2026-04-18-fix-three-light-flow/gate-7-feedback.md`
- Decision Log: `.harness/2026-04-18-fix-three-light-flow/decisions.md`
- Eval Checklist (JSON): `.harness/2026-04-18-fix-three-light-flow/checklist.json`
- Dogfood 관측: `observations.md` (P0 / P0-FOLLOWUP / P2 / P3 섹션)

## Context & Decisions

### 배경
2026-04-18 light flow 도그푸딩(`experimental-todo-light`, run baseline `e03bb1d`)에서 세 가지 버그가 발견됐다:

1. **[P0]** `harness resume`가 reused-tmux 모드에서 stale control pane을 만나면 무한 recursion으로 silently 멈춤 (`observations.md` §P0 참조). 수동 복구(state.json 편집) 없이는 탈출 불가.
2. **[P2]** Light Phase 1 combined 문서에서 `## Open Questions` 섹션이 강제되지 않아 3회 round 모두 해당 섹션이 누락됨. Full flow는 PR #15 wrapper skill로 이 섹션을 enforce하지만 light flow는 standalone `phase-1-light.md`를 사용해 regression.
3. **[P3]** Control panel UI가 `state.flow === 'light'`이어도 Phase 1을 `"Spec 작성"`으로 라벨링해 "plan" 절반이 가려진다 (ADR-3: light P1 = brainstorm + plan 결합).

### Gate 7 revision 계기
이 revision 이전 구현(commit `55c16ec` + `20f11e8`)은 세 수정과 `Case 2 stale pane` 회귀 테스트 1개, `## Open Questions` regex validator 2곳, UI 라벨 스위치를 ship했다. Gate 7에서 다음 두 안건이 REJECT로 올라왔다:

- **[P1 — Gate 7]** `tests/commands/resume-cmd.test.ts::Case 2 stale pane (reused-mode)` 테스트는 recursive call에서 `sessionExists → false`, `isInsideTmux → false`를 강제해 **dedicated Case 3**에서 `createSession`을 검증한다. 스펙의 T1/Task 1이 요구한 "reused 모드 Case 3 → `createWindow` 호출 검증" 경로는 실제로 실행되지 않았다 — 즉 테스트가 의도한 버그 시나리오를 커버하지 않는다.
- **[P3 — Gate 7]** `docs/process/evals/2026-04-18-fix-three-light-flow-eval.md::tests::stderr`에 `[harness.claudeUsage] project dir unreadable ... ENOENT ...` 5줄 + `git diff --no-index` usage block이 기록됐는데 summary는 "3/3 checks pass"만 제시해 **고신호 아티팩트로 보이지만 실제로는 알려진 벤인 노이즈**가 섞여 있다. 억제하거나 리포트에 annotation이 필요.

### 핵심 결정

#### D1. P0 fix는 `tmuxSession` + `tmuxMode`까지 확장 (observations §P0-FOLLOWUP 반영)
- **현 구현** (`src/commands/resume.ts:134-139`): stale branch에서 `tmuxControlPane / tmuxControlWindow / tmuxWindows`만 clear 후 recursion.
- **문제** (reused 모드, 사용자 outer tmux 살아있음): recursive call에서 `state.tmuxSession`이 여전히 유효 → `tmuxAlive === true` → Case 2 재진입 → `state.tmuxControlPane === ''` (falsy) → else 브랜치 재진입 → `state.tmuxControlWindow === ''`라 `killWindow`도 skip → 이미 비어있는 필드 다시 clear → recursion → 무한루프.
- **수정**: stale branch에서 **`state.tmuxSession = ''` + `state.tmuxMode = 'dedicated'`도 clear**. 이후 recursion에서 `src/commands/resume.ts:102`의 `tmuxAlive = state.tmuxSession !== '' && sessionExists(state.tmuxSession)` short-circuit이 false로 평가되어 Case 3로 낙착 → `isInsideTmux()` 재평가해 reused/dedicated 재-derive.
- **대안 고려**: (a) `tmuxMode`를 그대로 두고 `tmuxSession`만 clear — `tmuxMode`가 오래된 값으로 남아도 Case 3에서 overwrite되므로 기능상 동등하나, 명시성을 위해 `'dedicated'`로 리셋해 "stale 상태" 의도를 표현. (b) recursion 대신 in-place Case 3 dispatch 리팩토링 — 스코프 확장이라 기각.

#### D2. 테스트를 "reused 모드, outer tmux 유지" 시나리오로 재작성
- Gate 7 리뷰어 의도는 명확: **outer tmux session이 살아있는 상태에서도** stale-branch가 무한루프에 빠지지 않고 recursive call이 reused Case 3(`createWindow`)로 수렴함을 검증.
- `tmux` mock 시나리오:
  - `sessionExists.mockReturnValue(true)` — outer 세션은 계속 살아있음. (recursive call에서 `state.tmuxSession === ''`로 short-circuit되어 `sessionExists` 호출이 skip되므로 `mockReturnValueOnce`를 쓸 필요 없음.)
  - `paneExists.mockReturnValue(false)` — control pane stale.
  - `isPidAlive.mockReturnValue(false)` — inner dead.
  - `isInsideTmux.mockReturnValue(true)` — reused 모드 (Case 3 reused 분기 유도).
  - `getCurrentSessionName.mockReturnValue('harness-reused')` — Case 3가 새 session 이름 derive.
  - `createWindow.mockReturnValue('@new-ctrl')` / `getDefaultPaneId.mockReturnValue('%new-ctrl')`.
- 어설션:
  - `killWindow` 1회 호출 (stale branch의 reused-mode cleanup).
  - 재진입 후 `createWindow` 호출 (Case 3 reused 경로).
  - `createSession` **호출되지 않음** (기존 테스트의 dedicated 경로와 구분).
  - `state.json`의 `tmuxControlPane === ''`, `tmuxControlWindow === ''`, `tmuxWindows === []`, `tmuxSession === 'harness-reused'` (Case 3가 getCurrentSessionName 결과로 재할당).
  - `tmuxMode === 'reused'` (Case 3 재-derive 결과).
  - `releaseLock` 호출 확인 (recursion 전 cleanup 검증).
- **기존 dedicated-mode 테스트(`sessionExists → false` 경로)는 삭제**. 이유: (a) Gate 7 feedback이 실제 버그 시나리오(reused)를 강제함 (b) 동일 파일의 `'resumes with explicit runId (Case 3: no session)'` 테스트가 이미 dedicated Case 3 경로를 커버함 (c) redundant 테스트는 signal을 흐리고 test baseline을 부풀림.

#### D3. Eval artifact 노이즈는 **상류(source) 억제** — annotation 대신 silence
- `src/runners/claude-usage.ts:97-104`: project dir enumerate 실패 시 `warn`. 실패 사유가 `ENOENT`(디렉토리 자체 존재 안 함)이면 "이 cwd에서 claude 세션이 한 번도 실행된 적 없음"이라는 **정상 상태**. 테스트 환경 tmpdir에서는 기본값이다. 반면 `EACCES`/`EIO`/기타는 진짜 I/O error → warn 유지.
- 수정: readdirSync catch에서 에러 `code === 'ENOENT'`이면 silent `return null`; 그 외는 기존 `warn` 유지. `claude-token-capture-design.md`의 "hard I/O error" 계약은 유지 (ENOENT는 hard I/O error가 아닌 "session 없음"으로 재해석).
- **git diff --no-index 경고**에 대한 결정: 이 경고는 `tests/git.test.ts`가 "git 저장소 바깥 경로에 `git diff` 호출" 에러 경로를 의도적으로 실행한 결과다. 해당 테스트는 exit-code/stderr 자체를 assertion으로 사용하고 pipe 억제 없이 `execSync` 기본 동작을 신뢰한다. 이 노이즈를 억제하려면 테스트 assertion 구조를 건드려야 해 scope-creep 위험이 크다. **결론**: git 경고는 건드리지 않는다; eval report 품질은 claudeUsage 억제만으로 상당히 향상(dogfood 기준 5줄 → 0줄이 큰 덩어리)되고, git 경고 5~6줄은 signal-noise 비율 측면에서 수용 가능. Phase 6 eval report 생성 로직은 변경하지 않는다.

#### D4. Full-flow 회귀 방지
- `tmuxMode`, `tmuxSession` clear는 dedicated/reused 모두에 안전 (Case 3가 `isInsideTmux`로 재-derive). 기존 dedicated 테스트(`Case 2 → recursive Case 3 dedicated`) 회귀 없음 — `resumes with explicit runId (Case 3: no session)` 테스트로 커버.
- `claude-usage.ts` 변경은 ENOENT에만 영향; full-flow 런타임 경로는 claude session이 존재하므로 ENOENT 발생 지점이 기본적으로 없음. 기존 `tests/runners/claude-usage.test.ts`에서 ENOENT 케이스를 테스트하는지 확인 후 필요시 어설션 업데이트.
- `phase-1-light.md` / `src/ui.ts` / `validatePhaseArtifacts` 변경은 이미 merged된 상태 유지 (이번 revision은 추가/수정 없음).

## Requirements / Scope

### 기능 요구사항
1. **R1 — resume.ts stale branch 확장**: `src/commands/resume.ts` Case 2 stale else 브랜치에서 recursion 전 `state.tmuxSession = ''` + `state.tmuxMode = 'dedicated'` 추가 clear. 기존 3개 필드(`tmuxControlPane`, `tmuxControlWindow`, `tmuxWindows`)는 그대로 유지.
2. **R2 — reused-mode 회귀 테스트 재작성**: `tests/commands/resume-cmd.test.ts::Case 2 stale pane (reused-mode)` 테스트가 (a) outer tmux 유지 (b) `isInsideTmux → true` (c) `createWindow` 호출 (d) `createSession` 미호출 (e) state.json의 모든 control refs + tmuxSession 재할당 확인.
3. **R3 — claudeUsage ENOENT silence**: `src/runners/claude-usage.ts`의 `readdirSync` catch에서 `err.code === 'ENOENT'`이면 warn 호출 생략하고 `return null`.
4. **R4 — P0/P2/P3 기존 수정 보존**: 이미 merged된 `tmuxControlPane/Window/Windows` clear, `phase-1-light.md` Open Questions 섹션, `validatePhaseArtifacts` regex, `src/ui.ts`의 light 라벨 모두 유지.

### 비기능/스코프 요구사항
- **NFR-1**: full flow 경로 회귀 없음. 기존 resume dedicated Case 3 테스트와 Phase 1/3 validator 테스트 통과.
- **NFR-2**: 각 fix에 최소 1개의 타겟 테스트. (R1+R2 테스트 하나, R3 테스트 하나 추가.)
- **NFR-3**: vitest 전체 suite **≥ 577 passed / 1 skipped** (task.md 요구). 현 baseline은 580 passed / 1 skipped (eval report 기준) — R2 재작성으로 net-zero, R3 추가로 +1 → 581 passed 예상.
- **NFR-4**: `pnpm tsc --noEmit` 0 에러 / `pnpm build` 성공.
- **NFR-5**: 커밋 메시지는 project convention (`fix(<scope>): <imperative>`) + Co-authored-by 금지.

### Out of Scope
- observations.md의 다른 항목들: [P1-RESUME] validator side-effect, [P1-NEW] mtime reopen 친화 완화, [P1] gate-retry ceiling, [P3] preflight timeout, [P3] Phase-6 reset commit 노이즈. 각각 별도 PR/spec에서 처리.
- git `--no-index` 테스트 경고 억제 (§D3 참조).
- Phase 6 eval report 생성기(harness-verify.sh) 변경.

## Design

### 변경 파일 맵 (본 revision 한정)

| 파일 | 수정 종류 | 요지 |
|---|---|---|
| `src/commands/resume.ts` | diff-aware edit | stale branch에서 `tmuxSession`, `tmuxMode` 추가 clear |
| `src/runners/claude-usage.ts` | diff-aware edit | `readdirSync` catch에서 ENOENT silence |
| `tests/commands/resume-cmd.test.ts` | test rewrite | `Case 2 stale pane (reused-mode)`를 reused 모드-살아있음 시나리오로 재구성 |
| `tests/runners/claude-usage.test.ts` | test addition | ENOENT silent / non-ENOENT warn 분기 커버 |

(이전 Round에 merged된 `src/context/prompts/phase-1-light.md`, `src/ui.ts`, `src/phases/interactive.ts`, `src/resume.ts`, `tests/integration/light-flow.test.ts` 등 수정은 본 revision에서 건드리지 않는다.)

### 구현 상세

#### S1 (R1) — `src/commands/resume.ts` stale branch 확장

현재 (commit `55c16ec` 적용 후):

```ts
} else {
  // Control pane stale → cleanup by mode, then fall through to Case 3
  if (state.tmuxMode === 'dedicated') {
    killSession(state.tmuxSession);
  } else if (state.tmuxControlWindow) {
    killWindow(state.tmuxSession, state.tmuxControlWindow);
  }
  // Persist cleared control-pane references before recursion so the next
  // call doesn't re-enter this stale branch (reused-mode infinite-loop fix)
  state.tmuxControlPane = '';
  state.tmuxControlWindow = '';
  state.tmuxWindows = [];
  writeState(runDir, state);
  releaseLock(harnessDir, targetRunId);
  // Re-enter resume which will hit Case 3
  return resumeCommand(runId, options);
}
```

Revision 후:

```ts
} else {
  // Control pane stale → cleanup by mode, then fall through to Case 3
  if (state.tmuxMode === 'dedicated') {
    killSession(state.tmuxSession);
  } else if (state.tmuxControlWindow) {
    killWindow(state.tmuxSession, state.tmuxControlWindow);
  }
  // Persist cleared tmux references before recursion so Case 3 re-derives
  // session + mode from isInsideTmux(). Without clearing session/mode the
  // reused-mode recursive call would re-enter Case 2 and loop forever.
  state.tmuxControlPane = '';
  state.tmuxControlWindow = '';
  state.tmuxWindows = [];
  state.tmuxSession = '';
  state.tmuxMode = 'dedicated';
  writeState(runDir, state);
  releaseLock(harnessDir, targetRunId);
  // Re-enter resume which will hit Case 3
  return resumeCommand(runId, options);
}
```

Trace (reused 모드 — bug scenario):
1. 1st call: `state.tmuxSession='harness-X'`, `tmuxMode='reused'`, `tmuxControlPane='%stale'`, `tmuxControlWindow='@stale'`. `sessionExists('harness-X') → true`, `innerAlive=false` → Case 2. `paneExists → false` → stale else. `killWindow('harness-X', '@stale')`. state clear(모든 필드 + session=''/mode='dedicated'). recurse.
2. 2nd call: `state.tmuxSession === ''` → short-circuit 평가 `tmuxAlive = false`. Case 3. `isInsideTmux() → true`, `getCurrentSessionName() → 'harness-X'`, `tmuxMode = 'reused'`, `createWindow → '@new'`, `getDefaultPaneId → '%new'`, `sendKeys`. 완료.

Trace (dedicated 모드):
1. 1st call: `tmuxMode='dedicated'`. stale branch → `killSession('harness-X')` → outer session 죽음. state clear. recurse.
2. 2nd call: `sessionExists('')` short-circuit false. Case 3. `isInsideTmux() → false` → `createSession` + 신규 session. 기존 거동과 동일 (회귀 없음).

#### S2 (R2) — 테스트 재작성

`tests/commands/resume-cmd.test.ts` 기존 `Case 2 stale pane (reused-mode)` 테스트(203–244행)를 다음과 같이 대체한다 (시그니처 골격):

```ts
it('Case 2 stale pane (reused-mode): outer session stays alive, recursion creates new control window', async () => {
  const { harnessDir, runId, runDir } = setupRun(repo, {
    tmuxSession: 'harness-reused',
    tmuxControlPane: '%stale',
    tmuxControlWindow: '@stale',
    tmuxWindows: ['@stale'],
    tmuxMode: 'reused',
  });
  setCurrentRun(harnessDir, runId);

  const tmux = await import('../../src/tmux.js');
  const lock = await import('../../src/lock.js');
  const proc = await import('../../src/process.js');

  // Outer tmux session remains alive throughout. In the recursive call the
  // short-circuit `state.tmuxSession !== ''` skips sessionExists, so we
  // don't need mockReturnValueOnce.
  vi.mocked(tmux.sessionExists).mockReturnValue(true);
  vi.mocked(tmux.paneExists).mockReturnValue(false);
  vi.mocked(tmux.isInsideTmux).mockReturnValue(true);
  vi.mocked(tmux.getCurrentSessionName).mockReturnValue('harness-reused');
  vi.mocked(tmux.getActiveWindowId).mockReturnValue('@orig');
  vi.mocked(tmux.createWindow).mockReturnValue('@new-ctrl');
  vi.mocked(tmux.getDefaultPaneId).mockReturnValue('%new-ctrl');
  vi.mocked(lock.readLock).mockReturnValue({ cliPid: 999, handoff: false, childPid: null, childPhase: null, runId, startedAt: null, childStartedAt: null });
  vi.mocked(proc.isPidAlive).mockReturnValue(false);
  vi.mocked(lock.pollForHandoffComplete).mockReturnValue(true);

  // mockClear() 대상
  vi.mocked(tmux.killWindow).mockClear();
  vi.mocked(tmux.createSession).mockClear();
  vi.mocked(tmux.createWindow).mockClear();
  vi.mocked(lock.releaseLock).mockClear();

  await resumeCommand(undefined, { root: repo.path });

  // State: all control refs + tmuxSession cleared and then re-derived
  const savedState = JSON.parse(readFileSync(join(runDir, 'state.json'), 'utf-8'));
  expect(savedState.tmuxControlPane).toBe('');     // intermediate clear → then Case 3 sets controlWindow/windows, not controlPane
  expect(savedState.tmuxMode).toBe('reused');      // re-derived in Case 3
  expect(savedState.tmuxSession).toBe('harness-reused');  // re-derived in Case 3
  expect(savedState.tmuxControlWindow).toBe('@new-ctrl'); // Case 3 reused path assigns
  expect(savedState.tmuxWindows).toEqual(['@new-ctrl']);  // Case 3 reused path pushes

  // Behavior: stale cleanup → recursion → reused Case 3 path
  expect(vi.mocked(tmux.killWindow)).toHaveBeenCalledWith('harness-reused', '@stale');
  expect(vi.mocked(lock.releaseLock)).toHaveBeenCalled();
  expect(vi.mocked(tmux.createWindow)).toHaveBeenCalledWith('harness-reused', 'harness-ctrl', '');
  expect(vi.mocked(tmux.createSession)).not.toHaveBeenCalled();
});
```

(정확한 mock state + assertion 조합은 구현 단계에서 Case 3 코드 경로(`src/commands/resume.ts:156-189`)에 맞춰 fine-tune.)

기존 `Case 2 stale pane (reused-mode): clears tmuxControlPane/Window/Windows in state.json then reaches Case 3` 테스트는 **삭제**: §D2 근거.

#### S3 (R3) — `src/runners/claude-usage.ts` ENOENT silence

현재 (`src/runners/claude-usage.ts:97-104`):

```ts
try {
  entries = fs.readdirSync(projectDir);
} catch (err) {
  warn(`project dir unreadable ${projectDir}: ${(err as Error).message}`);
  return null;
}
```

Revision 후:

```ts
try {
  entries = fs.readdirSync(projectDir);
} catch (err) {
  // ENOENT on project dir == "no claude session ever recorded for this cwd".
  // This is the default state for test tmpdirs and some fresh cwds; don't
  // pollute stderr. Other I/O errors (EACCES, EIO) still warn once per phase.
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
    warn(`project dir unreadable ${projectDir}: ${(err as Error).message}`);
  }
  return null;
}
```

3-state 계약 (`docs/specs/2026-04-18-claude-token-capture-design.md::Error handling`) 상:
- 성공 → tokens 객체.
- 실패 (return null) 유지 — 호출자(`src/phases/runner.ts`)는 `claudeTokens: null`을 이벤트에 기록.
- Warn: ENOENT silent / 그 외 유지.

#### S4 (R3 test) — `tests/runners/claude-usage.test.ts` 보강

추가 테스트 케이스:

1. `readdirSync throws ENOENT → returns null and does not warn` — stderr capture 후 `"project dir unreadable"` 문자열 부재 확인.
2. `readdirSync throws non-ENOENT (e.g., EACCES) → returns null and warns once` — stderr capture에서 warn 문자열 존재 확인.

기존 테스트가 ENOENT를 warn-포함으로 assertion하고 있으면 expectation을 "no warn"으로 업데이트.

### Risks & Mitigations

| Risk | Mitigation |
|---|---|
| reused 모드 테스트의 Case 3 재-derive가 mock 순서에 민감 | `sessionExists.mockReturnValue(true)` (전역) + short-circuit 믿고 `mockReturnValueOnce` 미사용. 모든 Case 3 필수 mock(`createWindow`, `getDefaultPaneId`, `getActiveWindowId`, `getCurrentSessionName`, `isInsideTmux`)을 명시적으로 stub. |
| ENOENT silence가 실제 운영 환경의 "잘못된 경로 구성" 디버그를 방해 | 운영 환경에서 project dir이 ENOENT인 경우는 "claude 미실행" 상태와 동일하므로 silence가 맞다. 잘못된 경로 구성이면 `pinnedPath` 존재 여부 체크가 선행되어 로그가 나오도록 보장됨 (기존 경로 유지). |
| 기존 ENOENT warn을 assertion하는 테스트 존재 여부 미확인 | 구현 단계에서 `tests/runners/claude-usage.test.ts`를 우선 읽고 필요시 기존 케이스 expectation 업데이트. |
| Case 3 `state.tmuxWindows.push(ctrlWindowId)` 는 기존 배열에 append — clear한 빈 배열에 append된 결과가 `['@new-ctrl']`이 되는지 확인 필요 | `src/commands/resume.ts:186` `state.tmuxWindows.push(ctrlWindowId)` 확인 완료. 빈 배열 + push = 길이 1. |

## Open Questions

1. **Q1**: `tests/runners/claude-usage.test.ts`가 현재 ENOENT warn을 assertion하고 있는지 — 구현 단계에서 먼저 읽어 expectation 업데이트 여부를 확정한다. 만약 assertion이 이미 없다면 보강 테스트 2개만 추가; 있다면 업데이트 + 2개 추가.
2. **Q2**: `git diff --no-index` usage block을 발생시키는 구체 테스트 파일/라인 — 본 revision에서는 건드리지 않기로 했으나 (§D3), follow-up PR 시점에 출처(`tests/git.test.ts` 추정)와 억제 전략(pipe stderr, 아니면 test-level spy)을 결정해야 한다. 본 revision 스코프 외.
3. **Q3**: Phase 6 eval report의 stderr 섹션이 "known-benign noise" annotation을 지원할 헤더를 갖고 있는가. 현재는 raw stderr truncation뿐. 필요시 `scripts/harness-verify.sh` 개선안으로 별도 spec. 본 revision은 상류 억제로 우회.

## Implementation Plan

- **Task 1 — Extend P0 resume stale-branch clear**: `src/commands/resume.ts:127-143`의 else 브랜치에서 recursion 직전 `state.tmuxSession = ''`와 `state.tmuxMode = 'dedicated'`를 추가. 주석도 "reused-mode infinite-loop fix" → "re-derive session + mode in Case 3"으로 업데이트. (Diff-aware: 기존 3필드 clear 블록에 2줄 추가 + 주석 수정.)
- **Task 2 — Rewrite reused-mode regression test**: `tests/commands/resume-cmd.test.ts`의 `Case 2 stale pane (reused-mode): clears tmuxControlPane/Window/Windows ...` (203–244행) 삭제 후, §S2 설계대로 `Case 2 stale pane (reused-mode): outer session stays alive, recursion creates new control window` 신설. `sessionExists` 전역 true, `isInsideTmux=true`, `getCurrentSessionName='harness-reused'`, `createWindow='@new-ctrl'` mock. Assertion: `killWindow` 호출, `createWindow` 호출, `createSession` 미호출, state.json 최종값(reused 재-derive) 확인, `releaseLock` 호출.
- **Task 3 — Silence ENOENT in claudeUsage**: `src/runners/claude-usage.ts:97-104`의 readdirSync catch에서 `err.code === 'ENOENT'`일 때 warn 생략. 주석으로 근거 명시 (test tmpdir 기본 상태).
- **Task 4 — ClaudeUsage ENOENT / non-ENOENT 테스트**: `tests/runners/claude-usage.test.ts`에 ENOENT silent case와 non-ENOENT warn case 두 개 추가 (또는 기존 ENOENT 케이스의 expectation을 "no warn"으로 업데이트하고 non-ENOENT 케이스 신설). stderr capture 방법은 기존 테스트 패턴 답습.
- **Task 5 — Full verification**: `pnpm tsc --noEmit`, `pnpm vitest run`, `pnpm build` 3개 통과 확인. 테스트 baseline `≥577 passed / 1 skipped` 달성 확인 (현실적 예상: 581 passed).
- **Task 6 — 커밋**: conventional message `fix(light-flow): reused-mode recursion + claude-usage ENOENT silence (gate-7 revision)` 또는 유사. Co-authored-by 금지.

## Eval Checklist Summary

세 개의 기본 검증 명령(`checklist.json`에 저장):

| Check | Command | 목적 |
|---|---|---|
| typecheck | `pnpm tsc --noEmit` | 타입 오류 0 |
| tests | `pnpm vitest run` | 전체 suite 통과 + `≥577 passed / 1 skipped` |
| build | `pnpm build` | `dist/` 산출물 + assets copy 성공 |

실제 JSON은 `.harness/2026-04-18-fix-three-light-flow/checklist.json` 참조.
