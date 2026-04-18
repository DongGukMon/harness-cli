# Fix Three Light-Flow Bugs from 2026-04-18 Dogfood — Design Spec (Light)

관련 문서:
- Task: `.harness/2026-04-18-fix-three-light-flow/task.md`
- Decision Log: `.harness/2026-04-18-fix-three-light-flow/decisions.md`
- Eval Checklist: `.harness/2026-04-18-fix-three-light-flow/checklist.json`
- 모태 설계: `docs/specs/2026-04-18-light-flow-design.md`, `docs/plans/2026-04-18-light-flow.md` (PR #10/#17)
- Dogfood 관찰: commits `6812980`, `34a3d3d`, `4a0f0a5`
- 관련 PR 배경: #11 (BUG-A/B/C + `HARNESS FLOW CONSTRAINT`), #15 (Phase 1 wrapper skill이 `## Open Questions` 강제)

## Context & Decisions

2026-04-18 dogfood (`harness start --light`) 라운드 1에서 세 가지 버그가 drain 됐다:

- **P0 Resume infinite-loop** — reused-tmux 모드에서 control pane이 stale일 때, `resumeCommand`가 tmux 상태를 디스크에 정리하지 않고 재귀 호출한다. 결과: 재귀가 같은 stale state를 다시 읽고 Case 2를 무한 반복 (V8 InterpreterEntryTrampoline spin). 회복하려면 `state.json`을 수동 편집해야 했다.
- **P2 Light Phase 1 `## Open Questions` 누락 regression** — Full flow는 PR #15 wrapper skill이 `## Open Questions`를 강제하지만, light flow는 standalone `phase-1-light.md` prompt를 사용하고 이 섹션을 요구하지 않는다. 그 결과 라운드 1의 세 combined doc 모두 해당 섹션이 누락되었다.
- **P3 Control panel mislabel** — `src/ui.ts`가 `state.flow`와 무관하게 Phase 1을 `"Spec 작성"`으로 표시한다. Light flow는 ADR-3대로 "brainstorm + plan"이므로 "Spec" label은 절반만 반영.

### Guiding Decisions

1. **Minimal surface**: P0/P2/P3 세 지점만 고친다. 인접 리팩터·전역 flow-aware 레이블 도입(Full flow에서도) 등은 범위 외.
2. **Full flow 회귀 zero**: `flow === 'full'` 경로는 동작·레이블·리턴값이 bit-identical 유지. 라벨 분기·정규식 분기에서만 `state.flow === 'light'` 가드 추가.
3. **ADR-13 symmetry**: Phase 1 artifact validation은 `interactive.ts::validatePhaseArtifacts`와 `resume.ts::completeInteractivePhaseFromFreshSentinel` 두 경로에서 동일한 규칙을 적용해야 한다 (첫 실행 / resume fresh sentinel 두 경로).
4. **Recursion safety**: resume의 recursive fallback은 반드시 **디스크에 persist 된** 정돈된 state를 기반으로 다음 호출을 해야 한다. local-only 정리는 재귀 호출이 파일에서 다시 읽으면 무효화된다.
5. **Flow-aware label은 Phase 1에 한정**: light에서 Phase 5/7 등은 full과 동일 의미이므로 기존 라벨 유지. Phase 1만 `설계+플랜`으로 분기.
6. **Prompt skeleton bump은 Phase 1의 "## Open Questions" 한 섹션만 추가**. 순서는 `Implementation Plan` 앞에 위치 (독자가 plan을 읽기 전 unknowns을 맥락으로 흡수하도록).

## Requirements / Scope

### In scope
- `src/commands/resume.ts:127-136` — stale control-pane 정리 시 `tmuxControlPane` / `tmuxControlWindow` / `tmuxWindows`를 **clear + writeState** 후 recursion.
- `src/context/prompts/phase-1-light.md` — `## Open Questions` 필수 섹션을 skeleton에 추가 + "누락 시 Phase 1 실패" 경고 문구.
- `src/phases/interactive.ts::validatePhaseArtifacts` (light + phase 1 브랜치, ≈L127-143) — `## Open Questions` regex 추가.
- `src/resume.ts::completeInteractivePhaseFromFreshSentinel` (L496-512 부근) — 동일 regex 추가 (ADR-13 symmetry).
- `src/ui.ts::phaseLabel` + `renderControlPanel` + `renderModelSelection` + `promptModelConfig` — Phase 1 label을 `state.flow === 'light'`일 때 `"설계+플랜"`로 교체. Full flow는 `"Spec 작성"` 유지.
- `src/commands/inner.ts:172` — `promptModelConfig`에 `state.flow` 전달 (signature 확장).
- **신규 테스트 3개 이상** (P0/P2/P3 각각 타겟팅). 기존 테스트 중 light presets로 label을 단언하는 케이스는 flow 파라미터를 전달하도록 업데이트.

### Out of scope
- Dedicated-mode 세션 kill 후의 후속 cleanup 확장 (현재는 `tmuxSession` 자체는 그대로 둠 — `sessionExists=false` 전이로 Case 3이 자연 처리).
- Full flow의 phase label flow-aware 확장 (Phase 3/5/7 label 재검토 등).
- Wrapper skill `harness-phase-1-*.md` rewrite (이미 `## Open Questions` 강제. 본 작업은 **light** standalone prompt에만 평행 문구 추가).
- Dogfood observations 파일(`observations.md`) 재작성.

### Acceptance criteria
- `pnpm tsc --noEmit` / `pnpm vitest run` / `pnpm build` 모두 green.
- Vitest baseline 574 → **≥ 577 passed / 1 skipped** (각 P0/P2/P3마다 최소 1 신규 테스트).
- `pnpm vitest run tests/commands/resume-cmd.test.ts` 안의 Case 2 stale-pane 경로가 state.json에 `tmuxControlPane === ''` + `tmuxControlWindow === ''` + `tmuxWindows === []`를 기록했는지 assert.
- Light flow Phase 1 regression 테스트가 `## Open Questions` 누락 시 validate/resume-complete 둘 다 false 반환.
- 컨트롤 패널 렌더링 테스트가 `state.flow === 'light'`일 때 Phase 1 row에 `"설계+플랜"` 포함, full일 때 `"Spec 작성"` 포함.
- Full flow 경로의 기존 테스트 (≥574개)는 수정 없이 통과 — label 변경은 flow 분기 뒤에서만 발생.

## Design

### P0 — Resume stale-pane recursion fix

`src/commands/resume.ts:123-137` (Case 2, stale control pane 브랜치):

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
  // NEW: stale tmux 참조를 디스크에 persist 후 recursion
  state.tmuxControlPane = '';
  state.tmuxControlWindow = '';
  state.tmuxWindows = [];
  writeState(runDir, state);

  releaseLock(harnessDir, targetRunId);
  return resumeCommand(runId, options);
}
```

Rationale:
- `reused` 모드에선 outer 세션이 여전히 살아있어 다음 호출도 `tmuxAlive === true` → Case 2 재진입. 제어 창만 청소됐으므로 `paneExists === false`는 다시 발생. 만약 control-pane 참조를 남겨두면 같은 분기에서 영구 루프. 비우면 다음 iteration의 `state.tmuxControlPane &&` 단축 평가가 즉시 false → Case 3 fallback으로 떨어지고, 거기서 Case 3가 새 세션/창을 만들거나 reused의 경우 새 control window를 만든다.
- `dedicated` 모드에선 `killSession` 이후 `sessionExists` → false 이므로 다음 호출은 Case 3으로 간다. 다만 tmuxSession 값이 stale이어도 Case 3가 overwrite 하므로 추가 clear는 불요. 방어적 관점에서도 control-pane/window/windows는 비우는 게 올바른 invariant.
- `tmuxSession` / `tmuxMode`는 건드리지 않는다 — Case 3가 책임지는 필드고, 섣부른 clear는 Case 3 재진입 로직을 깨뜨릴 수 있다.

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
- `src/commands/inner.ts:172`: `promptModelConfig(state.phasePresets, inputManager, remainingPhases, state.flow)`.

Defaults ensure **full flow 경로는 호출자 수정 없이도 동일 동작** (flow 생략 시 `'full'`). 단 `promptModelConfig`/`renderModelSelection` 호출처는 의미상 flow를 전달해야 하는 곳(`inner.ts`, light 테스트)만 업데이트.

### Test design

| # | 파일 | 케이스 | 단언 |
|---|---|---|---|
| T1 | `tests/commands/resume-cmd.test.ts` | Case 2 reused-mode, control-pane stale → post-call | `state.json`의 `tmuxControlPane === ''`, `tmuxControlWindow === ''`, `tmuxWindows.length === 0`. recursion 한 번만 일어나고 Case 3로 떨어짐 (e.g. `createWindow` 호출 확인) |
| T2a | `tests/phases/interactive.test.ts` | light + phase 1, 본문에 `## Implementation Plan` 있지만 `## Open Questions` 없음 | `validatePhaseArtifacts` → `false` |
| T2b | `tests/phases/interactive.test.ts` | light + phase 1, 두 섹션 모두 있음 | `true` (기존 accept 테스트를 Open Questions 포함하도록 강화) |
| T2c | `tests/resume-light.test.ts` | `## Open Questions` 누락 시 `completeInteractivePhaseFromFreshSentinel` → `false` |
| T3a | `tests/ui.test.ts` | `renderControlPanel` with `state.flow === 'light'` | transcript에 `Phase 1: 설계+플랜` 매치 |
| T3b | `tests/ui.test.ts` | `renderControlPanel` with `state.flow === 'full'` | transcript에 `Phase 1: Spec 작성` 매치 (기존 거동 보존) |
| — | `tests/ui.test.ts` — 기존 "flow-aware row visibility" 테스트 | 기존 regex `Phase 1 \(Spec 작성\)` → light 세팅이므로 `Phase 1 \(설계\+플랜\)` 기대로 업데이트 (새 signature에 `'light'` 전달) |

총 신규 ≥3 (T1, T2a or T2c, T3a) + 기존 1개 업데이트. baseline 574 → ≥577 달성.

## Implementation Plan

- **Task 1 — P0 resume stale-pane fix**
  - Edit `src/commands/resume.ts` stale-branch: clear `tmuxControlPane` / `tmuxControlWindow` / `tmuxWindows` + `writeState(runDir, state)` 후 `releaseLock` + `return resumeCommand(...)`.
  - Add targeted test in `tests/commands/resume-cmd.test.ts`: reused mode, stale pane → assert cleared fields in state.json + `createWindow`/Case 3 trajectory (no infinite recursion).

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

- **Task 4 — Verification**
  - Run `pnpm tsc --noEmit` — 0 errors.
  - Run `pnpm vitest run` — 577+ passed / 1 skipped.
  - Run `pnpm build` — dist 생성, copy-assets가 변경된 `phase-1-light.md`를 복사 확인.

- **Task 5 — Commit**
  - Atomic commit `fix(light-flow): resume stale-pane loop + Open Questions + Phase 1 label` (또는 세 커밋으로 쪼갤지 구현 시점에 판단).
  - Body: dogfood observation 참조 (commits `6812980`, `34a3d3d`, `4a0f0a5`).

## Open Questions

1. **P0 `dedicated` 모드에서 `tmuxSession` 자체도 clear 해야 하나?** — 현재 Design은 `tmuxSession` / `tmuxMode`는 건드리지 않는다 (Case 3가 overwrite 하므로). 만약 `sessionExists` 쪽 edge case에서 kill 직후 stale name이 false-positive로 alive 반환하는 tmux 타이밍 이슈가 있다면 추가 clear가 필요. 구현 시 `tmux.ts::sessionExists`의 race 경계를 확인하고, 관찰되면 보완 commit.
2. **P2 Prompt skeleton 순서** — `## Open Questions`를 `## Design` 뒤 vs `## Implementation Plan` 뒤 어느 쪽에 둘지. 본 Design은 "plan 전"을 선택 (unknowns을 계획 수립 전 surface 하는 것이 가치). 추후 사용자 피드백으로 뒤로 이동 가능.
3. **P3 `설계+플랜` 표기 후보** — `"설계+플랜"` vs `"Spec+Plan"` vs `"설계·계획"` 등. 본 Design은 task description의 예시 표기(`설계+플랜`)를 그대로 채택. 팀 용어 컨벤션에 맞춰 후속 조정 가능.
4. **Test 파일 위치** — P0 테스트를 `tests/commands/resume-cmd.test.ts`에 추가 (현재 resume-cmd 테스트와 mock 재사용)가 기본. tmux/lock mock을 새로 짤 필요 있으면 별도 파일로 빼는 것도 고려.

## Eval Checklist Summary

`.harness/2026-04-18-fix-three-light-flow/checklist.json`에 3개 체크 등록:

| Name | Command | Purpose |
|---|---|---|
| `typecheck` | `pnpm tsc --noEmit` | 타입 회귀 방지. `phaseLabel`/`promptModelConfig`/`renderModelSelection` signature 변경 후 caller들이 컴파일되는지 보증. |
| `tests` | `pnpm vitest run` | 전체 suite green + 신규 3+ 테스트 통과. baseline 574 → ≥577 passed / 1 skipped. |
| `build` | `pnpm build` | `scripts/copy-assets.mjs`가 수정된 `phase-1-light.md`를 dist에 복사하고 전체 산출물이 빌드되는지 확인. |

각 커맨드는 격리된 셸에서 실행 가능하며 의존성은 모두 `pnpm` env-aware 래퍼로 해소된다.
