# Fix Three Light-Flow Bugs from 2026-04-18 Dogfood — Design Spec (Light)

관련 문서:
- Task: `.harness/2026-04-18-fix-three-light-flow/task.md`
- Decision Log: `.harness/2026-04-18-fix-three-light-flow/decisions.md`
- Eval Checklist: `.harness/2026-04-18-fix-three-light-flow/checklist.json`
- Gate 7 Feedback (incorporated in this revision): `.harness/2026-04-18-fix-three-light-flow/gate-7-feedback.md`
- 모태 설계: `docs/specs/2026-04-18-light-flow-design.md`, `docs/plans/2026-04-18-light-flow.md` (PR #10/#17)
- Dogfood 관찰: commits `6812980`, `34a3d3d`, `4a0f0a5`
- 관련 PR 배경: #11 (BUG-A/B/C + `HARNESS FLOW CONSTRAINT`), #15 (Phase 1 wrapper skill이 `## Open Questions` 강제), #16 (Claude token capture — `claude-usage.ts`의 stderr warn source)

## Context & Decisions

2026-04-18 dogfood (`harness start --light`) 라운드 1에서 세 가지 버그가 drain 됐다:

- **P0 Resume infinite-loop** — reused-tmux 모드에서 control pane이 stale일 때, `resumeCommand`가 tmux 상태를 디스크에 정리하지 않고 재귀 호출한다. 결과: 재귀가 같은 stale state를 다시 읽고 Case 2를 무한 반복 (V8 InterpreterEntryTrampoline spin). 회복하려면 `state.json`을 수동 편집해야 했다.
- **P2 Light Phase 1 `## Open Questions` 누락 regression** — Full flow는 PR #15 wrapper skill이 `## Open Questions`를 강제하지만, light flow는 standalone `phase-1-light.md` prompt를 사용하고 이 섹션을 요구하지 않는다. 그 결과 라운드 1의 세 combined doc 모두 해당 섹션이 누락되었다.
- **P3 Control panel mislabel** — `src/ui.ts`가 `state.flow`와 무관하게 Phase 1을 `"Spec 작성"`으로 표시한다. Light flow는 ADR-3대로 "brainstorm + plan"이므로 "Spec" label은 절반만 반영.

### Gate 7 feedback (2차 revision에서 반영)

1. **P1 (test rigor) — `tests/commands/resume-cmd.test.ts`의 `Case 2 stale pane (reused-mode)` 테스트가 실제 reused-모드 경로를 exercise 하지 않는다.** 리뷰어는 recursive call에서 `sessionExists`가 `false`를 반환하고 `createSession`을 assert 하는 것은 dedicated-스타일 fallback 검증이라 지적했다. spec의 **T1 의도(reused-모드 stale → Case 3 → `createWindow` 호출)** 를 검증하려면 (a) recursive call에서도 tmux 세션은 살아 있어야 하고, (b) `isInsideTmux === true` 세팅으로 reused-모드 Case 3 분기에서 새 control window 생성을 단언해야 한다.
   - 이 지적은 단순 테스트 보강으로 끝나지 않는다. **현재 P0 구현(55c16ec)은 `tmuxControlPane`/`tmuxControlWindow`/`tmuxWindows`만 비운다.** reused-모드에서 사용자 세션이 계속 살아 있으면 recursive call에서도 `tmuxAlive === true` → Case 2 재진입 → `tmuxControlPane === ''` → 다시 stale 브랜치 → 무한 루프가 그대로 재현된다. 즉, **reviewer의 test-rigor 지적은 구현 자체가 reused-모드 recursion을 Case 3로 빼내지 못함을 간접적으로 드러낸다.** 본 revision은 구현 범위를 확장해 `tmuxSession` (그리고 `tmuxMode`) 도 stale 브랜치에서 초기화해 recursion이 Case 3 `createWindow` 경로에 자연스럽게 떨어지도록 한다.
2. **P3 (eval artifact 신호/잡음) — `pnpm vitest run` stdout/stderr에 `[harness.claudeUsage] project dir unreadable /Users/daniel/.claude/projects/-tmp-cwd ENOENT` 다수 + `warning: Not a git repository. Use --no-index …` 1건이 찍혀 eval 리포트가 시끄럽다.** 리뷰어는 "해당 경고를 테스트 하니스에서 억제하거나 리포트에서 명시 annotate"을 제안. suppression을 기본 선택으로 삼는다 — claude-usage의 warn은 실제 production에서는 의미 있지만 test fixture에서는 거의 100% false-positive이므로, **test 경로에서만** suppressible 하게 만든다. Annotation은 보조 수단.

### Guiding Decisions

1. **Minimal surface (revised)** — P0/P2/P3 세 지점 + 테스트 하니스 stderr suppression만 고친다. 인접 리팩터·전역 flow-aware 레이블 도입(Full flow에서도) 등은 범위 외. 단, P0 수정 범위는 gate-7 feedback에 따라 **`tmuxSession` + `tmuxMode` clear** 까지 확대한다 (원래 "`Pane/Window/Windows`만"에서 확대).
2. **Full flow 회귀 zero** — `flow === 'full'` 경로는 동작·레이블·리턴값이 bit-identical 유지. 라벨 분기·정규식 분기에서만 `state.flow === 'light'` 가드 추가. resume.ts 변경은 `flow` 와 무관하게 reused/dedicated 양쪽 모두의 infinite-loop 회복 경로이므로 full flow에도 긍정 영향만 줌.
3. **ADR-13 symmetry** — Phase 1 artifact validation은 `interactive.ts::validatePhaseArtifacts`와 `resume.ts::completeInteractivePhaseFromFreshSentinel` 두 경로에서 동일한 규칙을 적용해야 한다 (첫 실행 / resume fresh sentinel 두 경로).
4. **Recursion safety (strengthened)** — resume의 recursive fallback은 반드시 (a) 다음 호출이 **디스크에 persist 된 상태**를 기반으로 진행하고, (b) 해당 상태가 같은 stale-분기로 재진입하지 않도록 **탈출 조건**을 만족해야 한다. reused-모드에서는 `tmuxSession` 까지 비워야 `sessionExists('') === false` → `tmuxAlive === false` → Case 3 분기로 빠지는 탈출 경로가 생긴다. `tmuxMode` 도 default(`'dedicated'`) 로 리셋해 Case 3가 `isInsideTmux()` 를 재평가하도록 한다 (현 tmux 컨텍스트에 맞춰 새 모드를 자연스럽게 결정).
5. **Flow-aware label은 Phase 1에 한정** — light에서 Phase 5/7 등은 full과 동일 의미이므로 기존 라벨 유지. Phase 1만 `설계+플랜`으로 분기.
6. **Prompt skeleton bump은 Phase 1의 "## Open Questions" 한 섹션만 추가**. 순서는 `Implementation Plan` 앞에 위치 (독자가 plan을 읽기 전 unknowns을 맥락으로 흡수하도록).
7. **stderr noise 정책** — `src/runners/claude-usage.ts::warn` 은 테스트 환경에서 침묵시킨다. 우선순위: **(a) vitest 파일 레벨에서 `process.stderr.write` spy 를 깔아 noise 억제, 혹은 (b) `claude-usage.ts` 가 `process.env.NODE_ENV === 'test'` 또는 전용 flag 를 감지해 warn 을 drop.** 구현 시 가장 국소적인 옵션을 선택. 생산 경로의 진단 정보는 보존한다.

## Requirements / Scope

### In scope
- `src/commands/resume.ts:127-142` — stale control-pane 정리 시 `tmuxControlPane`, `tmuxControlWindow`, `tmuxWindows`, **그리고 `tmuxSession`, `tmuxMode`** 를 clear + writeState 후 recursion. 이로써 reused-모드 infinite-loop 탈출.
- `src/context/prompts/phase-1-light.md` — `## Open Questions` 필수 섹션을 skeleton에 추가 + "누락 시 Phase 1 실패" 경고 문구.
- `src/phases/interactive.ts::validatePhaseArtifacts` (light + phase 1 브랜치, ≈L127-143) — `## Open Questions` regex 추가.
- `src/resume.ts::completeInteractivePhaseFromFreshSentinel` — 동일 regex 추가 (ADR-13 symmetry).
- `src/ui.ts::phaseLabel` + `renderControlPanel` + `renderModelSelection` + `promptModelConfig` — Phase 1 label을 `state.flow === 'light'`일 때 `"설계+플랜"`로 교체. Full flow는 `"Spec 작성"` 유지.
- `src/commands/inner.ts` — `promptModelConfig`에 `state.flow` 전달 (signature 확장).
- **테스트 하니스 stderr suppression** — claude-usage warn / git diff `--no-index` warning 이 발생하는 테스트 파일(들)에서 `process.stderr` spy 혹은 mock 을 깔아 noise 를 잠재운다. 대상 파일은 구현 시 repro로 특정 (유력 후보: `tests/runners/claude-usage.test.ts`, `tests/phases/runner-token-capture.test.ts`, 그리고 `git diff --no-index` 를 호출하는 통합 테스트).
- **신규/보강 테스트 4개 이상** (P0×1, P2×2, P3×1). **P0 테스트는 reused-모드 경로로 재작성**: `sessionExists.mockImplementation((name) => name === '<real-session>')` 로 recursive call에서도 세션이 살아 있게 유지 + `isInsideTmux === true` + `createWindow` 호출 단언. 기존 테스트 중 light presets 로 label 을 단언하는 케이스는 `flow` 파라미터를 전달하도록 업데이트.

### Out of scope
- Dedicated-mode 세션 kill 후의 후속 cleanup 확장. 현재 변경은 `tmuxSession='' + tmuxMode='dedicated'` clear 이므로 dedicated 에서도 무해 (Case 3 가 overwrite).
- Full flow의 phase label flow-aware 확장 (Phase 3/5/7 label 재검토 등).
- Wrapper skill `harness-phase-1-*.md` rewrite (이미 `## Open Questions` 강제. 본 작업은 **light** standalone prompt에만 평행 문구 추가).
- Dogfood observations 파일(`observations.md`) 재작성.
- Eval report format 변경 (stderr 섹션 annotation block 자동 삽입 등) — suppression으로 해결.

### Acceptance criteria
- `pnpm tsc --noEmit` / `pnpm vitest run` / `pnpm build` 모두 green.
- Vitest baseline 574 → **≥ 577 passed / 1 skipped** (각 P0/P2/P3마다 최소 1 신규 테스트; P2는 두 validator 대칭으로 2개).
- `pnpm vitest run tests/commands/resume-cmd.test.ts` 안의 **신규 reused-모드 stale-pane 테스트**가 (i) state.json 의 `tmuxControlPane === ''`, `tmuxControlWindow === ''`, `tmuxWindows === []`, `tmuxSession === ''` (recursion 직전 시점) 을 기록했는지, (ii) recursion 이후 `createWindow` 가 호출됐는지 (createSession 은 호출되지 않음) 를 단언.
- Light flow Phase 1 regression 테스트가 `## Open Questions` 누락 시 validate/resume-complete 둘 다 false 반환.
- 컨트롤 패널 렌더링 테스트가 `state.flow === 'light'`일 때 Phase 1 row에 `"설계+플랜"` 포함, full일 때 `"Spec 작성"` 포함.
- Full flow 경로의 기존 테스트 (≥574개)는 수정 없이 통과 — label 변경은 flow 분기 뒤에서만 발생.
- **Eval 실행 시 stderr 가 clean** — `[harness.claudeUsage] project dir unreadable` / `warning: Not a git repository` 라인이 벤치 reporter 에 노출되지 않음. 구현자는 Phase 6 eval report 의 stderr 섹션이 비어 있거나 noise 가 제거됐는지 확인한다.

## Design

### P0 — Resume stale-pane recursion fix (revised per Gate 7 P1)

`src/commands/resume.ts:123-143` (Case 2, stale control pane 브랜치):

```ts
if (state.tmuxControlPane && paneExists(state.tmuxSession, state.tmuxControlPane)) {
  // 유효 — 기존 경로 유지
  ...
} else {
  if (state.tmuxMode === 'dedicated') {
    killSession(state.tmuxSession);
  } else if (state.tmuxControlWindow) {
    killWindow(state.tmuxSession, state.tmuxControlWindow);
  }
  // stale tmux 참조를 디스크에 persist 후 recursion.
  // reused-모드 탈출을 위해 tmuxSession/tmuxMode 도 리셋 — 다음 호출은
  // sessionExists('') === false → Case 3 로 낙하하고, 거기서 isInsideTmux()
  // 가 true 면 createWindow(), false 면 createSession() 로 올바른 분기.
  state.tmuxControlPane = '';
  state.tmuxControlWindow = '';
  state.tmuxWindows = [];
  state.tmuxSession = '';
  state.tmuxMode = 'dedicated';
  writeState(runDir, state);

  releaseLock(harnessDir, targetRunId);
  return resumeCommand(runId, options);
}
```

Rationale (updated):

- **reused 모드**: `killWindow` 가 control window 만 제거하고 사용자 세션은 살아 있다. 이전 구현은 `tmuxSession` 을 보존해 recursive call 에서 `tmuxAlive === true` → Case 2 재진입 → `tmuxControlPane === ''` 이라도 **다시 stale 분기** → infinite loop. `tmuxSession = ''` 으로 비우면 recursive call 에서 `sessionExists('') === false` → `tmuxAlive === false` → Case 3 분기로 떨어진다. Case 3 는 `isInsideTmux()` 로 현재 tmux 컨텍스트를 재평가하고, 사용자가 여전히 원래 세션 안에 있으면 `getCurrentSessionName()` 로 같은 세션을 재획득해 `createWindow('harness-ctrl', ...)` 로 새 control window 를 생성한다. `state.tmuxMode` 도 재계산되어 `'reused'` 로 정확히 복원.
- **dedicated 모드**: `killSession` 이 세션 자체를 죽이므로 recursive call 에서 `sessionExists(state.tmuxSession) === false` → Case 3. `tmuxSession` 리셋은 불필요하지만 해롭지도 않다 (Case 3 가 새 `harness-<runId>` 이름으로 overwrite). 일관된 invariant 유지 차원에서 clear.
- **tmuxMode = 'dedicated' 로 리셋**: Case 3 가 `insideTmux ? 'reused' : 'dedicated'` 로 즉시 재계산하므로 기본값은 중립적인 `'dedicated'`. 만약 Case 3 로 가지 못하는 엣지 (예: 즉시 예외) 가 있어도 default 가 dedicated 면 다음 호출에서 `killSession` 시도만 발생 (빈 문자열에 대한 `killSession('')` 은 tmux 가 안전 무시) → 재귀 종료. infinite-loop invariants 보존.
- `tmuxOriginalWindow` 는 유지 (Case 3 reused 분기가 `getActiveWindowId` 로 재설정하지만, 사용자 meta 보존 의도상 보존해도 무해. 단, 현 Case 3 코드가 `insideTmux` 에서 무조건 overwrite 하므로 effect 는 없음).

### P2 — `## Open Questions` 강제 (ADR-13 symmetric enforcement)

**(a) Prompt skeleton** — `src/context/prompts/phase-1-light.md`:

```diff
 # <title> — Design Spec (Light)
 ## Context & Decisions
 ## Requirements / Scope
 ## Design
+## Open Questions              (필수 헤더, 정확히 이 텍스트 — 불확실·후속 조사 항목 기록. 없으면 "없음"으로 명시)
 ## Implementation Plan       (필수 헤더, 정확히 이 텍스트)
   - Task 1: ...
   - Task 2: ...
 ## Eval Checklist Summary    (checklist.json 요약; 실제 검증 JSON은 별도 파일)
```

경고 문구도 `## Implementation Plan` 패턴을 미러링 — "본 섹션이 누락되면 harness는 Phase 1을 실패로 간주한다."

**(b) `interactive.ts` validator** — 기존 Implementation Plan regex 블록 옆에 평행 블록:

```ts
if (!/^##\s+Open\s+Questions\s*$/m.test(body)) return false;
if (!/^##\s+Implementation\s+Plan\s*$/m.test(body)) return false;
```

**(c) `resume.ts::completeInteractivePhaseFromFreshSentinel` validator** — 동일 regex. 대칭성이 무너지면 `harness resume --light` 경로만 우회 통과.

Rationale:
- wrapper skill (full flow)과 standalone prompt (light flow)의 policy 동기화.
- regex는 라인 시작/끝 앵커로 Markdown 헤더 정확 매칭 — inline string `## Open Questions`는 제외 (full flow의 Implementation Plan regex와 동일 스타일).

### P3 — Flow-aware Phase 1 label

`src/ui.ts`:

```ts
function phaseLabel(phase: number, flow: Flow = 'full'): string {
  const labels: Record<number, string> = {
    1: flow === 'light' ? '설계+플랜' : 'Spec 작성',
    2: 'Spec Gate',
    3: 'Plan 작성',
    4: 'Plan Gate',
    5: '구현',
    6: '검증',
    7: 'Eval Gate',
  };
  return labels[phase] ?? `Phase ${phase}`;
}
```

- `renderControlPanel`: `phaseLabel(p, state.flow)`로 모든 호출 변경.
- `renderModelSelection(phasePresets, editablePhases?, flow: Flow = 'full')`: 파라미터 추가. 내부 `phaseLabels`의 `'1'` 값을 flow-aware로 계산.
- `promptModelConfig(currentPresets, inputManager, editablePhases?, flow?)`: 새 파라미터 뒤로 추가. `renderModelSelection`에 전파 + 내부 model-prompt `phaseLabels`도 flow-aware.
- `src/commands/inner.ts`: `promptModelConfig(state.phasePresets, inputManager, remainingPhases, state.flow)`.

Defaults ensure **full flow 경로는 호출자 수정 없이도 동일 동작** (flow 생략 시 `'full'`). 단 `promptModelConfig`/`renderModelSelection` 호출처는 의미상 flow를 전달해야 하는 곳(`inner.ts`, light 테스트)만 업데이트.

### stderr noise suppression (Gate 7 P3)

**원인**:
- `[harness.claudeUsage] project dir unreadable /Users/daniel/.claude/projects/-tmp-cwd ENOENT` — `src/runners/claude-usage.ts:102` `warn()` 호출. `readClaudeSessionUsage` 가 tmp cwd(`/tmp/cwd`) 에 대한 `.claude/projects/-tmp-cwd` 를 찾지 못해 발생. 이 경로는 테스트 fixture(특히 integration/token-capture) 에서 정상적으로 비어 있다.
- `warning: Not a git repository. Use --no-index …` — tmp cwd 에서 `git diff` 를 호출하는 곳. `git diff` 가 working tree 가 아닌 경로에서 실행될 때 발생.

**전략**:
- **claude-usage warn 억제 (우선 옵션 A)**: 원인 테스트 파일(들)의 `beforeEach/describe` 블록에서 `vi.spyOn(process.stderr, 'write').mockImplementation(() => true)` 로 한정 scope 억제. 억제는 테스트 파일 내부에서만 발효하고, 다른 테스트는 기존처럼 stderr 를 볼 수 있다.
- **claude-usage warn 억제 (대안 옵션 B)**: `src/runners/claude-usage.ts::warn` 이 `process.env.VITEST === 'true'` 또는 `process.env.HARNESS_SILENCE_USAGE_WARN === '1'` 감지 시 skip. Vitest 는 기본으로 `VITEST=true` 주입하므로 환경 감지만으로 충분. **이 대안을 최종 채택 이유**: 파일별 spy 를 깔면 테스트 수정 범위가 커지고, 미래에 claude-usage 를 새로 호출하는 테스트가 추가될 때마다 spy 를 잊을 리스크. 환경 감지는 1지점 수정으로 전역 커버. 생산 경로는 영향 없음 (`VITEST` 는 vitest 실행 시에만 set).
- **git diff --no-index warning**: 원인 추적 필요 — `git` CLI 가 tmp cwd 에서 fallback 으로 호출됐을 때 stderr 를 토해낸 경우. `src/git.ts` 에서 `git diff` 호출 시 `stdio: ['ignore', 'pipe', 'ignore']` 또는 `try/catch` 로 stderr 삼키기 / 이미 삼키고 있으면 특정 테스트에서 직접 호출됐을 가능성. 구현자는 `grep -rn "git diff" src/ tests/` 로 호출 지점을 찾고, 테스트 컨텍스트에서 발생하는 지점에 한해 stderr 를 억제 (producton 경로는 diff 출력 필요하므로 건드리지 않음).

두 경고 모두 실제 회귀 지표가 아니므로 **suppression 이 보존 대비 비용 > 편익**. 구현자는 최소 변경으로 clean stderr 달성 후 Phase 6 eval 에서 확인.

### Test design (revised per Gate 7 P1)

| # | 파일 | 케이스 | 단언 |
|---|---|---|---|
| T1 | `tests/commands/resume-cmd.test.ts` | **reused 모드**, 첫 호출 control-pane stale → recursion 후 Case 3 `createWindow` 경로 | `sessionExists.mockImplementation((name) => name === 'harness-test')` (recursive `''` 조회는 자연스럽게 false). `isInsideTmux.mockReturnValue(true)`. `getCurrentSessionName.mockReturnValue('harness-test')`. 후속 단언: (i) `state.json` 의 `tmuxControlPane === ''`, `tmuxControlWindow === ''`, `tmuxWindows === []`, `tmuxSession === ''` (recursion 직전 스냅샷을 별도 단언하려면 `writeState` spy 로 capture). (ii) recursion 뒤 `createWindow` 호출됨. (iii) `createSession` 호출 안 됨. (iv) releaseLock 이 recursion 이전에 한 번 호출됨. |
| T2a | `tests/phases/interactive.test.ts` | light + phase 1, 본문에 `## Implementation Plan` 있지만 `## Open Questions` 없음 | `validatePhaseArtifacts` → `false` |
| T2b | `tests/phases/interactive.test.ts` | light + phase 1, 두 섹션 모두 있음 | `true` (기존 accept 테스트를 Open Questions 포함하도록 강화) |
| T2c | `tests/resume-light.test.ts` | `## Open Questions` 누락 시 `completeInteractivePhaseFromFreshSentinel` → `false` |
| T3a | `tests/ui.test.ts` | `renderControlPanel` with `state.flow === 'light'` | transcript에 `Phase 1: 설계+플랜` 매치 |
| T3b | `tests/ui.test.ts` | `renderControlPanel` with `state.flow === 'full'` | transcript에 `Phase 1: Spec 작성` 매치 (기존 거동 보존) |
| — | `tests/ui.test.ts` — 기존 "flow-aware row visibility" 테스트 | light 세팅이므로 `Phase 1 \(설계\+플랜\)` 기대로 업데이트 (새 signature에 `'light'` 전달) |
| — | 필요 시 `tests/runners/claude-usage.test.ts` 및 `git diff` 호출 테스트 | stderr 노이즈 제거 | 구현 옵션 B(env 감지) 시 별도 테스트 불요. 옵션 A(spy) 시 해당 파일 `beforeEach` 에 spy 추가. |

총 신규 ≥3 (T1, T2a 또는 T2c, T3a) + 기존 2개 업데이트. baseline 574 → ≥577 달성. 현 Phase 5 dist 는 이미 580 pass 상태이므로 T1 재작성이 기존 T1 테스트를 교체하고 P0 구현 확장이 통과 테스트 수를 유지 또는 +1 한다.

## Open Questions

1. **stderr suppression 방식 A vs B** — 본 Design 은 환경 감지(B)를 권고하나, 구현자가 해당 테스트 파일을 열어봤을 때 spy(A) 가 더 국소적이라 판단되면 A 채택 허용. 단 A 는 **테스트 파일이 추가될 때마다 spy 를 까는 규율** 이 필요하다는 tech-debt 를 기록. `git diff --no-index` 경고도 동일 원칙으로 처리. 구현 commit message 에 최종 선택과 근거를 명시.
2. **`tmuxOriginalWindow` 보존 여부** — P0 stale 브랜치에서 `tmuxOriginalWindow` 도 clear 해야 하는가? 현재 Case 3 reused 분기가 `getActiveWindowId` 로 overwrite 하므로 실질 영향 없음. Design 은 **미터치**. 구현 시 테스트에서 `tmuxOriginalWindow` 를 assert 하지 않음으로써 미래 변경 여지 남김.
3. **P3 `설계+플랜` 표기 후보** — `"설계+플랜"` vs `"Spec+Plan"` vs `"설계·계획"` 등. 본 Design 은 task description 의 예시 표기(`설계+플랜`)를 그대로 채택. 팀 용어 컨벤션에 맞춰 후속 조정 가능.
4. **T1 구현 세부 — `writeState` spy 시점 분리** — T1 이 "recursion 직전의 스냅샷" 을 assert 하려면 `writeState` spy 로 호출 인자를 capture 해야 한다. 그러나 Case 3 로 떨어진 뒤에도 `writeState` 가 추가로 호출되므로 "첫 호출 (stale 브랜치)" 인자만 단언한다. 구현자는 `vi.mocked(...).mock.calls[0]` 패턴 혹은 state.json 의 최종 상태가 Case 3 overwrite 된 상태임을 감안해 assert 전략을 선택.

## Implementation Plan

- **Task 1 — P0 resume stale-pane fix (expanded)**
  - Edit `src/commands/resume.ts` stale-branch: clear `tmuxControlPane` / `tmuxControlWindow` / `tmuxWindows` **and** `tmuxSession` (`''`) **and** `tmuxMode` (`'dedicated'`), `writeState(runDir, state)` 후 `releaseLock` + `return resumeCommand(...)`.
  - Rewrite existing test `Case 2 stale pane (reused-mode) …` in `tests/commands/resume-cmd.test.ts`: reused 모드 활성화 (`tmuxMode: 'reused'`, `isInsideTmux: true`, `getCurrentSessionName: 'harness-test'`). `sessionExists.mockImplementation((name) => name === 'harness-test')`. Assert (a) state.json cleared + `tmuxSession === ''` (recursion 직전 스냅샷), (b) `createWindow` called, (c) `createSession` not called, (d) `releaseLock` called before recursion.

- **Task 2 — P2 `## Open Questions` symmetric enforcement**
  - Update `src/context/prompts/phase-1-light.md` skeleton: insert `## Open Questions` row between `## Design` and `## Implementation Plan`, add parallel 경고 문구.
  - Update `src/phases/interactive.ts::validatePhaseArtifacts` (light + phase 1 branch): add `/^##\s+Open\s+Questions\s*$/m` regex guard alongside Implementation Plan.
  - Update `src/resume.ts::completeInteractivePhaseFromFreshSentinel`: same regex guard.
  - Add/strengthen tests in `tests/phases/interactive.test.ts` (missing Open Questions → reject) and `tests/resume-light.test.ts` (missing Open Questions → reject). Existing "accepts combined doc" fixtures updated to include the header for continued green.

- **Task 3 — P3 flow-aware Phase 1 label**
  - Update `src/ui.ts::phaseLabel` signature to `(phase, flow = 'full')`, branch Phase 1 label.
  - Update `renderControlPanel` to pass `state.flow`; update `renderModelSelection` signature `(phasePresets, editablePhases?, flow = 'full')`; update `promptModelConfig` signature to accept and forward flow.
  - Update `src/commands/inner.ts` to pass `state.flow` into `promptModelConfig`.
  - Add test `tests/ui.test.ts`: `renderControlPanel` with `flow: 'light'` shows `설계+플랜`; with `flow: 'full'` shows `Spec 작성` (regression guard).
  - Update existing `renderModelSelection — flow-aware row visibility` test to pass `'light'` and expect `설계+플랜`.

- **Task 4 — stderr noise suppression (Gate 7 P3)**
  - 먼저 `pnpm vitest run 2>&1 | grep -E "harness.claudeUsage|Not a git repository"` 로 발생 테스트 파일(들) 식별.
  - 옵션 B (권고): `src/runners/claude-usage.ts::warn` 에 `if (process.env.VITEST === 'true') return;` 가드 추가. 생산 로그 영향 없음.
  - `git diff --no-index` 경고: 호출 지점을 `src/git.ts` 또는 테스트에서 찾아, vitest 컨텍스트에서 `stdio` 로 stderr 를 ignore 하거나 try/catch 로 silent 처리. 생산 경로(실제 repo diff)의 stderr 는 보존.
  - 회귀 방지용 명시적 테스트는 불요 (eval 리포트 수동 확인으로 충분). 구현자가 원하면 `tests/runners/claude-usage.test.ts` 에 `VITEST` env 감지 시 warn 미호출 단언 1건 추가 가능.

- **Task 5 — Verification**
  - Run `pnpm tsc --noEmit` — 0 errors.
  - Run `pnpm vitest run` — ≥577 passed / 1 skipped. stderr 에 `[harness.claudeUsage]` / `Not a git repository` 라인 0건.
  - Run `pnpm build` — dist 생성, copy-assets가 변경된 `phase-1-light.md`를 복사 확인.

- **Task 6 — Commit**
  - Atomic commit `fix(light-flow): resume stale-pane loop + Open Questions enforcement + Phase 1 label + test stderr suppression` (또는 분할 commit — light-flow vs stderr suppression 두 commit 으로 쪼갤지 구현 시점에 판단).
  - Body: dogfood observation 참조 (`6812980`, `34a3d3d`, `4a0f0a5`) + Gate 7 feedback 참조 (`.harness/2026-04-18-fix-three-light-flow/gate-7-feedback.md`).

## Eval Checklist Summary

`.harness/2026-04-18-fix-three-light-flow/checklist.json`에 3개 체크 등록:

| Name | Command | Purpose |
|---|---|---|
| `typecheck` | `pnpm tsc --noEmit` | 타입 회귀 방지. `phaseLabel`/`promptModelConfig`/`renderModelSelection` signature 변경 후 caller 들이 컴파일되는지 보증. |
| `tests` | `pnpm vitest run` | 전체 suite green + 신규/보강 테스트 통과. baseline 574 → ≥577 passed / 1 skipped. **추가로 구현자는 stderr 에 `[harness.claudeUsage]` / `Not a git repository` 라인이 없음을 육안/grep 으로 확인** (Gate 7 P3). |
| `build` | `pnpm build` | `scripts/copy-assets.mjs` 가 수정된 `phase-1-light.md` 를 dist 에 복사하고 전체 산출물이 빌드되는지 확인. |

각 커맨드는 격리된 셸에서 실행 가능하며 의존성은 모두 `pnpm` env-aware 래퍼로 해소된다. Stderr cleanliness 는 체크리스트에 자동 검증 항목으로 넣지 않는다 (사후 grep 으로 확인) — 단, `pnpm vitest run` 이 exit 0 이어야 하므로 suppression 이 test 자체를 깨뜨리지 않음은 보장된다.
