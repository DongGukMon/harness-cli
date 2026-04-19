# harness-cli Light Flow — Design Spec

- Date: 2026-04-18
- Status: Draft (Phase 1 output, Gate-2 rev-2)
- Scope: `harness start --light` — 중간 규모 작업(≈1–4h, ≤~500 LoC, 소수 모듈) 대상 경량 파이프라인
- Related decisions: [.harness/2026-04-18-light-flow/decisions.md](../../.harness/2026-04-18-light-flow/decisions.md)
- 구현 범위: **본 스펙은 설계만 다룬다. 실제 구현은 별도 세션에서 진행.**

> **See also:** `docs/specs/2026-04-19-untitled-2-design.md` — activates Phase 2 Codex review (ADR-15/16/17/18/19/20) for light runs. ADR-4 (P1 reopen on P7 REJECT) is unchanged.

---

## Context & Decisions

### Why this work

현재 harness-cli는 7-phase 풀 플로우(brainstorm → spec gate → plan → plan gate → impl → verify → eval gate)로 모든 태스크를 처리한다. 이 구조는 대규모·고위험 작업에는 적합하지만 중간 규모 작업에서는 비용이 과하다:

| 부담 요소 | 풀 플로우 | 영향 |
|---|---|---|
| Interactive phase 수 | 3 (Phase 1, 3, 5) | brainstorm→plan→impl 세션 클리어 사이 컨텍스트 재로딩 비용 |
| Gate 호출 수 | 3 (Phase 2, 4, 7) | Codex high-effort는 라운드당 ≈2–4분. reject 루프는 최대 3회(9회 리뷰) |
| Spec/plan 문서 분리 | 2개 doc | 중간 규모에서는 설계와 계획을 분리할 실익 낮음 |

**해법:** `harness start --light` 플래그로 선택되는 4-phase 경량 플로우 추가. 풀 플로우를 삭제·변경하지 않고 병렬 모드로 존재.

**언제 light를 쓰나 (러프 가이드라인):**
- 작업 크기: 1–4시간, ≈500 LoC 이하, 소수(≤3) 모듈 스코프
- 위험도: 마이그레이션/보안/계약 변경 등 독립 리뷰가 필수인 작업은 풀 플로우 권장
- 최종 판단은 사용자. CLI는 light/full을 자동 선택하지 않는다 (ADR-11 참조).

### Gate-2 Feedback 반영 요약 (rev-2)

이 리비전은 추가 Gate-2 리뷰의 **P1 1건** 반영:

| # | 이슈 | 이 리비전의 처리 |
|---|---|---|
| 5 | 스펙이 "풀 플로우 Phase 7 REJECT → Phase 3 reopen"이라고 잘못 기술 — 실제 코드(`src/phases/runner.ts:60-63`)는 Gate 7 → Phase 5. 풀 플로우 동작 변경은 본 스펙 범위 밖이며 OOB 회귀 위험 | **`Phase 7 — Eval Gate > REJECT 시 동작` 본문과 `File-level Change List > src/phases/gate.ts` 항목에서 "풀 플로우 reopen target = Phase 5"로 정정.** Phase 1 reopen 규칙은 `flow === 'light'`에만 적용됨을 명시. ADR-4 본문도 동일하게 재서술 (decisions.md 동기화) |

### Gate-2 Feedback 반영 요약 (rev-1)

이 리비전은 Gate-2 리뷰의 **P1 4건** 반영:

| # | 이슈 | 이 리비전의 처리 |
|---|---|---|
| 1 | `state.phases['3']==='completed'`를 light에서 dummy로 채우면 resume validator가 plan/checklist/planCommit을 요구함 | **ADR-1 수정 — `'skipped'` PhaseStatus 신규 도입.** phase 상태 검사 전역 분기 대신 skip 상태 추가로 해결 (ADR-1 Alternatives 재검토 표 참조) |
| 2 | Phase 7 gate assembler는 fresh(`199-220`)와 resume(`300-325`) 양쪽에서 `<plan>`을 요구 — resume 경로 미설계 | **§"Phase 7 프롬프트 조립"에서 fresh + resume 양쪽 모두 `flow==='light'` 분기 명시.** (ADR-12) |
| 3 | Phase 1 완료 검증이 실제 호출 경로(`src/config.ts:60-63` PHASE_ARTIFACT_FILES, `src/phases/interactive.ts:95-126` validatePhaseArtifacts, `src/resume.ts:478-505` completeInteractivePhaseFromFreshSentinel) 미반영 | **§"Phase 1 Completion 검증" + File-level Change List에 세 경로 모두 명시.** `getPhaseArtifactFiles(flow, phase)` helper 도입, light Phase 1 artifact set = `['spec','decisionLog','checklist']`, `## Implementation Plan` 헤더 regex 검사 추가. (ADR-13) |
| 4 | `P7 REJECT → P1 reopen → P5 재진입` 체인에서 P1 완료 시 `pendingAction` clear → Phase 5가 gate-7-feedback을 잃음 | **`state.carryoverFeedback` 필드 신규.** P7 REJECT(light) 시 carryoverFeedback에 gate-7 feedback path 저장 → P1 reopen 완료에도 보존 → P5 진입 assembler가 consumer. (ADR-14) |

### Key Decisions (요약)

> 전체 Decision Log: [.harness/2026-04-18-light-flow/decisions.md](../../.harness/2026-04-18-light-flow/decisions.md)

| ID | 결정 |
|----|------|
| ADR-1 | Light flow는 `{1, 5, 6, 7}` 하위집합. Phase 1이 brainstorm+plan 흡수. Phase 2/3/4는 `'skipped'` 상태 (신규 status; **rev-1 수정**) |
| ADR-2 | Phase 번호 스키마 재사용(신규 L1..L4 도입 안 함). state/resume/preset 재사용 이득 > 개념적 혼란 |
| ADR-3 | Light Phase 1 산출물: 단일 결합 문서 + checklist 분리 유지 |
| ADR-4 | Light Phase 7은 REJECT 시 항상 Phase 1을 reopen. Phase 5 reopen은 verify FAIL 전용 |
| ADR-5 | 활성화: `harness start --light` 플래그. `state.flow: 'full' \| 'light'` 필드로 영속화 |
| ADR-6 | Light mode 기본 preset: `opus-xhigh`(P1) / `sonnet-high`(P5) / `codex-high`(P7) |
| ADR-7 | `state.flow` 마이그레이션 기본값 `'full'`. `carryoverFeedback` 마이그레이션 기본값 `null` |
| ADR-8 | `--light` + `--auto` 직교. 동시 사용 허용 |
| ADR-9 | `/harness` 스킬 통합: 본 스펙 범위 밖 (구현 시점 별도 설계). `--light` 플래그 전파가 기본 방향 |
| ADR-10 | Out of scope: mid-impl interactive gate, 런 도중 flow 전환, 태스크 크기 자동 판별 기반 동적 phase pruning |
| ADR-11 | CLI는 light/full을 자동 선택하지 않는다. 사용자 명시 플래그로만 활성화 |
| ADR-12 | **Phase 7 프롬프트 조립은 fresh + resume 양쪽 모두 flow-aware.** light에서 `<plan>` 슬롯 완전 생략 (rev-1 신규) |
| ADR-13 | **Light Phase 1 완료 검증은 `interactive.validatePhaseArtifacts` + `resume.completeInteractivePhaseFromFreshSentinel` 양쪽에서 대칭적으로 구현.** `getPhaseArtifactFiles(flow, phase)` helper 공유 (rev-1 신규) |
| ADR-14 | **Gate-7 feedback은 `state.carryoverFeedback`으로 persistent 전달**, `pendingAction` lifecycle와 독립 (rev-1 신규) |

---

## Flow Comparison

```
풀 플로우 (기존):
  P1 brainstorm → P2 spec-gate → P3 plan → P4 plan-gate
  → P5 impl → P6 verify → P7 eval-gate

라이트 플로우 (신규):
  P1 design(=brainstorm+plan) → [P2/P3/P4 = skipped] → P5 impl → P6 verify → P7 eval-gate
                                                                                  │
                                          P7 REJECT → P1 reopen (+ carryoverFeedback) ┘
                                                           └─> P5 reopen (carryover 소비) ─> P6 ─> P7
                                          P6 FAIL → P5 reopen (직접)
```

- 유지: Phase 1, 5, 6, 7 (번호 보존 — ADR-2)
- Skip: Phase 2, 3, 4 (상태 `'skipped'` — ADR-1 rev-1)
- 유일한 Codex gate: Phase 7 (eval-gate)

---

## Phase Specification (Light Mode)

### Phase 1 — Design (brainstorm + plan 결합)

| | |
|---|---|
| **Agent** | Claude Code CLI |
| **Model (default)** | `opus-xhigh` (Claude Opus 4.7 / xHigh) |
| **Mode** | Interactive |
| **Input** | `.harness/<runId>/task.md` + (reopen 시) `gate-7-feedback.md` |
| **Output** | `docs/specs/<runId>-design.md` (결합 문서)<br>`.harness/<runId>/checklist.json` (verify 검증 항목, 여전히 별도 파일)<br>`.harness/<runId>/decisions.md` (Decision log) |
| **Completion signal** | `.harness/<runId>/phase-1.done` with `phaseAttemptId` |

**결합 문서 구조 (ADR-3):**

```
# <title> — Design Spec (Light)
## Context & Decisions
## Requirements / Scope
## Design
## Implementation Plan       ← 기존 Phase 3 산출물이 여기로 흡수 (필수 헤더)
  - Task 1: ...
  - Task 2: ...
## Eval Checklist Summary    ← checklist.json의 요약 미러
```

**왜 checklist는 분리 유지?**
- `scripts/harness-verify.sh`가 JSON 스키마(`{checks: [{name, command}]}`)를 직접 파싱. 포맷 변경은 Phase 6 구현 변경을 강요함.
- 문서 내 인라인 JSON은 파싱 취약 (markdown 코드펜스 누락 시 깨짐).
- Gate 7 프롬프트 사이즈 관리(비-필수 항목 분리) 측면에서도 유리.

**Init prompt 차이 (구현 시 반영):**
- 풀 플로우의 Phase 1 프롬프트(`src/context/prompts/phase-1.md`)를 light 전용 템플릿으로 교체(`phase-1-light.md`).
- "설계만 작성" → "설계 + 구현 태스크 분해 + checklist까지 단일 세션에서 작성"으로 문구 변경.
- 결합 문서 내 `## Implementation Plan` 섹션 필수임을 명시.
- checklist.json 생성 규약 포함 (Phase 3 프롬프트에서 이식).
- reopen 시 (`phaseReopenFlags['1']===true`): gate-7-feedback.md 경로를 assembler가 `feedback_path` 변수로 주입. 프롬프트는 "이전 설계의 어디를 수정해야 하는지 diff 기반 정리" 지시.

**Phase 1 Completion 검증 (CLI 측 — P1-3 해결, ADR-13):**

검증은 **두 경로**에서 호출되며 **대칭 로직**이어야 한다:

1. **정상 실행 경로** — `src/phases/interactive.ts::validatePhaseArtifacts(phase, state, cwd)`
2. **Resume 복구 경로** — `src/resume.ts::completeInteractivePhaseFromFreshSentinel(phase, state, cwd)`

두 함수 모두 **flow-aware**해야 한다:

```ts
// 공유 helper (src/config.ts에 신규 추가)
export function getPhaseArtifactFiles(
  flow: FlowMode,
  phase: PhaseNumber
): Array<keyof Artifacts> {
  if (flow === 'light') {
    if (phase === 1) return ['spec', 'decisionLog', 'checklist'];
    // light에서 phase 3은 존재하지 않음 (skipped)
    return [];
  }
  // full flow
  if (phase === 1) return ['spec', 'decisionLog'];
  if (phase === 3) return ['plan', 'checklist'];
  return [];
}
```

**추가 검증 (light + phase 1일 때만):**
- `checklist.json` 스키마 검증 — `isValidChecklistSchema()` 재사용
- `## Implementation Plan` 헤더 regex 검사 — `/^##\s+Implementation\s+Plan\s*$/m`로 결합 doc을 스캔. 누락 시 fail.

**공유 규약 (양쪽 함수 모두 적용):**
- `PHASE_ARTIFACT_FILES` 상수를 직접 참조하지 말고 `getPhaseArtifactFiles(state.flow, phase)`를 호출.
- Phase 1 완료 후 commit anchor 갱신: light에서는 `state.specCommit = HEAD` (plan/decisionLog 분리 anchor 불필요; plan은 같은 파일).

### Phase 5 — Implementation

| | |
|---|---|
| **Agent** | Claude Code CLI |
| **Model (default)** | `sonnet-high` |
| **Mode** | Interactive (**explicit session clear from Phase 1**) |
| **Input (ADR-3)** | `docs/specs/<runId>-design.md` (결합 문서)<br>`.harness/<runId>/decisions.md`<br>`.harness/<runId>/checklist.json` (참고용; verify 시 실행됨)<br>reopen 시: `gate-7-feedback.md` (ADR-14: `pendingAction.feedbackPaths` 또는 `state.carryoverFeedback.paths`), `verify-feedback.md` (해당 시) |
| **Output** | git commits |
| **Completion signal** | `.harness/<runId>/phase-5.done` + 최소 1 commit + 작업 트리 clean |

Phase 5 입력 계약은 풀 플로우와 거의 동일하되 **plan doc이 빠지고 결합 doc으로 대체됨**. `src/context/assembler.ts`의 interactive variant에서 light 모드 분기 필요.

**Phase 5 진입 시 carryoverFeedback 소비 (ADR-14):**
- Assembler가 prompt 조립 직전 `state.carryoverFeedback`을 읽음.
- 존재하고 `deliverToPhase === 5`이면, `pendingAction.feedbackPaths`와 병합해 `feedback_paths` 변수에 주입.
- Phase 5 완료 순간 — `runner.ts`의 기존 "clear pendingAction" 로직 옆에서 `state.carryoverFeedback = null` 처리.

### Phase 6 — Auto Verification

풀 플로우와 **완전 동일**. 변경 없음.
- `scripts/harness-verify.sh <checklist> <eval-report>` 실행
- Output: `docs/process/evals/<runId>-eval.md`

### Phase 7 — Eval Gate

| | |
|---|---|
| **Agent** | Codex companion |
| **Model (default)** | `codex-high` |
| **Input (light)** | 결합 doc(`docs/specs/<runId>-design.md`) + eval report + `git diff <baseCommit>..HEAD` + metadata block. **`<plan>` 슬롯 완전 생략** (ADR-12) |
| **REJECT 타겟 (ADR-4)** | **항상 Phase 1 reopen** + carryoverFeedback 기록 (ADR-14) |

**Phase 7 프롬프트 조립 — fresh + resume 양쪽 flow-aware (ADR-12, P1-2 해결):**

풀 플로우에서 Phase 7은 두 경로로 조립된다. **두 경로 모두 light 분기가 필요**하다 (기존 리비전은 fresh만 다룸):

1. **Fresh 경로 — `buildGatePromptPhase7()` in `src/context/assembler.ts:199-220`**

   현행 (full only):
   ```ts
   return REVIEWER_CONTRACT +
     `<spec>...</spec>` + `<plan>...</plan>` + `<eval_report>...</eval_report>` +
     diffSection + externalSummary + metadata;
   ```

   Light 분기 (구현 가이드):
   ```ts
   if (state.flow === 'light') {
     // artifacts.plan이 빈 문자열이거나 아예 없을 수 있음 — 읽지 말 것.
     return REVIEWER_CONTRACT +
       `<spec>\n${specResult.content}\n</spec>\n` +    // 결합 doc (= plan 포함)
       `<eval_report>...</eval_report>` +
       diffSection + externalSummary + metadata;
   }
   // 기존 full 로직 유지
   ```

2. **Resume 경로 — `buildResumeSections()` in `src/context/assembler.ts:300-325`**

   현행 (full only):
   ```ts
   let body = `<spec>...</spec>`;
   if (phase === 4 || phase === 7) body += `<plan>...</plan>`;
   if (phase === 7) body += `<eval_report>...` + diff + metadata;
   ```

   Light 분기 (구현 가이드):
   ```ts
   if (phase === 7 && state.flow === 'light') {
     body += `<eval_report>...</eval_report>\n` + diff + externalSummary + metadata;
     // <plan> 건너뛰기
   } else if (phase === 4 || phase === 7) {
     body += `<plan>...</plan>`;
     // (phase === 7 && flow === 'full')만 eval_report + diff 추가 (기존)
   }
   ```

   **핵심:** light + phase 7 resume에서 `<plan>` 슬롯을 완전히 생략해야 Gate 7 reject 후 첫 resume 사이클이 `artifacts.plan` 빈값으로 실패하지 않음.

- 사이즈 한도(500KB 전체, 200KB 개별) 재사용.

**REJECT 시 동작 (ADR-4 + ADR-14):**
- Phase 7 REJECT → **Phase 1 reopen** (풀 플로우는 Phase 5 reopen — `src/phases/runner.ts::previousInteractivePhase` 참조; 본 스펙은 풀 플로우 동작을 변경하지 않는다). 이유: light에서는 spec과 plan이 한 문서이므로, 설계 수정과 계획 수정이 분리되지 않는다. 결합 doc을 재작성해야 impl이 따라간다.
- Phase 6 FAIL → Phase 5 reopen (변경 없음; verify 실패는 항상 impl 교정).
- Phase 7 reopen에서 결합 doc가 수정되면 impl도 그에 맞춰 다시 수행되어야 한다. 즉 reopen 체인은 `P7 REJECT → P1 reopen → (P1 재완료 시) P5 자동 재진입`. 이는 light mode에서 Phase 7 rerun이 Phase 5 reset을 자동 강제함을 의미.

**REJECT 체인 의사 상태 전이 (ADR-14 carryoverFeedback 포함):**
```
초기: phases: {1:done, 2:skipped, 3:skipped, 4:skipped, 5:done, 6:done, 7:rejected}
  gate.ts 레벨에서:
    state.carryoverFeedback = {
      sourceGate: 7,
      paths: ['.harness/<runId>/gate-7-feedback.md'],
      deliverToPhase: 5,
    }
    phases[1] = 'pending'; phaseReopenFlags['1'] = true
    phases[5] = 'pending'; phaseReopenFlags['5'] = true  // design 변경 시 impl 재수행
    phases[6] = 'pending'                                // impl 변경 시 verify 재수행
    phases[7] = 'pending'
    pendingAction = { type: 'reopen_phase', targetPhase: 1, sourcePhase: 7,
                      feedbackPaths: carryoverFeedback.paths }  // P1 즉시 소비용
    currentPhase = 1

P1 완료 시 (runner.ts:278-285):
    pendingAction = null                                  // 기존 동작
    state.carryoverFeedback 은 그대로 유지 (NEW)           // ADR-14 핵심
    advance to phase 5

P5 진입 assembler:
    if (state.carryoverFeedback?.deliverToPhase === 5) {
      prompt에 carryoverFeedback.paths 를 feedback_paths 로 주입
    }

P5 완료 시:
    state.carryoverFeedback = null                        // consume 완료
    pendingAction = null (기존 동작)
```

구현 측 힌트: `runPhaseLoop`의 reopen 처리에서 light mode일 때 REJECT 타겟 계산 로직(`getReopenTarget(flow, gate)`)을 분기. `phaseReopenFlags`/`phaseCodexSessions` 무효화 범위를 확장.

**Retry 한도:**
- Gate retry limit: 3 (`GATE_RETRY_LIMIT` 재사용)
- Verify retry limit: 3 (`VERIFY_RETRY_LIMIT` 재사용)
- 자율 모드(`--auto`): 4회째 강제 통과 규칙 동일 적용 (ADR-8)

---

## Activation — `harness start --light`

### CLI 표면

```bash
# 기본 (풀 플로우)
harness start "태스크 설명"

# 라이트 플로우
harness start --light "태스크 설명"

# 라이트 + 자율
harness start --light --auto "태스크 설명"
```

**파싱 위치:** `src/commands/start.ts`의 `StartOptions`에 `light?: boolean` 필드 추가. CLI argv 파서(`bin/harness.ts`)에서 `--light` 플래그를 수집.

**전파 경로:** `start → createInitialState(..., flow)` → `state.flow = 'light' | 'full'` → `state.json`에 영속화 → `inner` / `resume`에서 자동 재적용 (별도 플래그 불필요).

### Resume 동작

```bash
harness resume                  # state.json의 flow 값 그대로 재사용
harness resume --light          # ❌ 거부. flow는 run 생성 시 고정됨
```

**이유:** flow 변경은 phase 집합 자체를 바꾸므로 mid-run 전환은 상태 복구 경로가 복잡해짐 (ADR-10). 다른 flow로 재시작하려면 새 run을 생성해야 한다.

### 플래그 요약

| 플래그 | 영속 필드 | 상호작용 |
|---|---|---|
| `--light` | `state.flow = 'light'` | `--auto`와 직교 (동시 사용 OK, ADR-8) |
| `--auto` | `state.autoMode = true` | 기존 동작 그대로 |
| `--require-clean` | (ephemeral) | 변경 없음 |
| `--enable-logging` | `state.loggingEnabled` | 변경 없음 |

---

## State Schema Changes

### 추가 필드 (HarnessState)

```ts
// src/types.ts
export type FlowMode = 'full' | 'light';
export type PhaseStatus =
  | 'pending' | 'in_progress' | 'completed' | 'failed' | 'error'
  | 'skipped';   // 신규 — ADR-1 rev-1 (P1-1 해결)

export interface CarryoverFeedback {
  sourceGate: 7;                 // 발생 시점 gate
  paths: string[];               // gate-7-feedback.md absolute or relative paths
  deliverToPhase: 5;             // 소비 시점 phase (현재는 5 고정)
}

export interface HarnessState {
  // ... (기존 필드)
  flow: FlowMode;                           // 신규 (ADR-5)
  carryoverFeedback: CarryoverFeedback | null;  // 신규 (ADR-14)
  // ... (기존 필드)
}
```

### PHASE 상태 의미 확장 (rev-1 수정 — P1-1 해결, ADR-1)

- `phases: Record<'1'..'7', PhaseStatus>` 유지.
- Light 모드에서 `phases['2']`, `phases['3']`, `phases['4']`는 생성 시 **`'skipped'`** 로 초기화.
- **이유 (Gate-2 P1-1 반영):** 이전 리비전은 dummy `'completed'`를 사용했으나, `src/resume.ts:298-314`의 `validateCompletedArtifacts()`가 `phases['3']==='completed'` 시 `artifacts.plan`, `checklist`, `planCommit`을 요구한다. Light에서는 plan이 별도 파일로 존재하지 않으므로 dummy completed가 validator를 통과하지 못한다.
- **새 규약:** `'skipped'`는 phase 러너가 "이 phase를 실행하지 않는다"는 선언. 모든 validator는 `'completed'`만 검사 대상으로 취급하도록 자연스럽게 통과.
- **영향 범위 (PhaseStatus union 확장):** 하기 위치에 exhaustive switch 업데이트:
  - `src/resume.ts::validateCompletedArtifacts` — 이미 `=== 'completed'` guard만 사용 → 변경 불필요
  - `src/phases/runner.ts` — phase 진행 판단. `'skipped'`도 `'completed'`와 동일하게 "진행 가능"으로 취급.
  - `src/ui.ts` — status 표시 시 `'skipped'`는 `(skipped)` 렌더
  - 기타: `state.ts::createInitialState`, `inner.ts`의 status 요약 라인 등

### PHASE_DEFAULTS (light)

```ts
// src/config.ts — 신규 상수 추가
export const LIGHT_PHASE_DEFAULTS: Record<number, string> = {
  1: 'opus-xhigh',      // design (결합)
  5: 'sonnet-high',   // impl
  7: 'codex-high',    // eval-gate
  // 2/3/4는 skip, 6은 runner 없음
};

export const LIGHT_REQUIRED_PHASE_KEYS = ['1', '5', '7'] as const;

// 신규 flow-aware helper (ADR-13 — P1-3 해결)
export function getPhaseArtifactFiles(
  flow: FlowMode,
  phase: PhaseNumber
): Array<keyof Artifacts> {
  if (flow === 'light') return phase === 1 ? ['spec', 'decisionLog', 'checklist'] : [];
  if (phase === 1) return ['spec', 'decisionLog'];
  if (phase === 3) return ['plan', 'checklist'];
  return [];
}
```

`promptModelConfig()`와 `runRunnerAwarePreflight()`는 `flow` 값을 받아 해당 키 셋만 순회.
`PHASE_ARTIFACT_FILES` 직접 참조는 **제거**하고 모두 `getPhaseArtifactFiles()` 경유.

### `artifacts.plan` — light mode semantics (ADR-12 관련)

- Light run 생성 시 `state.artifacts.plan = ''` (빈 문자열).
- Assembler는 **flow 체크 없이** `artifacts.plan`을 읽으려 하면 안 된다 (현 코드의 버그).
- `buildGatePromptPhase7` + `buildResumeSections` 양쪽에 `if (flow === 'light') { /* plan 생략 */ }` 분기 (P1-2 해결).
- 대안(아래) 기각:
  - *`artifacts.plan`을 design.md에 alias*: 동일 콘텐츠를 `<spec>`/`<plan>` 양쪽에 중복 주입 → Codex 프롬프트 사이즈 낭비 + "왜 두 번?" 혼란.

### 기타 필드

- `phaseOpenedAt`, `phaseAttemptId`, `phaseReopenFlags`: 기존 키(`'1'|'3'|'5'`) 중 light에서는 `'1'|'5'`만 실제 사용. 구조 변경 없음 (`'3'` 슬롯은 null 유지).
- `phaseCodexSessions`: 풀은 `'2'|'4'|'7'`, light는 `'7'`만 사용. 구조 변경 없음 (null로 유지).
- `gateRetries`: 풀은 `{2,4,7}`, light는 `{7}`만 증가.

### Migration

`src/state.ts`의 `migrateState()`에 분기 추가:

```ts
if (!('flow' in state)) {
  state.flow = 'full';       // 기존 run은 전부 full로 해석 (ADR-7)
}
if (!('carryoverFeedback' in state)) {
  state.carryoverFeedback = null;  // 기본값 null (ADR-14)
}
```

**호환성:** 이 마이그레이션 이전에 생성된 state.json은 flow 필드가 없으므로 기본 `'full'`로 처리. `carryoverFeedback` 역시 null로 채움. light run은 본 변경 이후 생성된 run에만 존재.

---

## File-level Change List

### Modify

| File | Change | Gate-2 P1 매핑 |
|---|---|---|
| `src/types.ts` | `FlowMode` 타입 + `'skipped'` PhaseStatus 추가 + `CarryoverFeedback` 타입 + `HarnessState.flow` + `HarnessState.carryoverFeedback` 필드 | P1-1, P1-4 |
| `src/state.ts` | `createInitialState(runId, task, base, auto, logging, flow)` 시그니처 확장; `migrateState()`에 `flow` + `carryoverFeedback` 기본값 백필; light 모드일 때 `phases['2']='skipped'` 등 초기화 | P1-1, P1-4 |
| `src/config.ts` | `LIGHT_PHASE_DEFAULTS`, `LIGHT_REQUIRED_PHASE_KEYS`, `getFlowDefaults(flow)`, **`getPhaseArtifactFiles(flow, phase)` 공용 helper** | P1-3 |
| `src/commands/start.ts` | `StartOptions.light` 추가; `createInitialState`에 flow 전달 | — |
| `src/commands/inner.ts` | 모델 선택/preflight에 flow 기반 phase 집합 전달 | — |
| `src/commands/resume.ts` | `--light` 플래그 거부; state.flow 그대로 신뢰 | — |
| **`src/resume.ts`** | `validateCompletedArtifacts()`는 `'completed'` guard만 쓰므로 `'skipped'` 추가에 자동 호환. **`completeInteractivePhaseFromFreshSentinel()`(478-505)에서 `PHASE_ARTIFACT_FILES` 직접 참조를 `getPhaseArtifactFiles(state.flow, phase)`로 대체. light + phase 1일 때 추가로 `## Implementation Plan` 헤더 regex 검사 + `isValidChecklistSchema()` 호출.** light에서 specCommit만 갱신(plan commit 분리 anchor 없음) | **P1-1, P1-3** |
| **`src/phases/interactive.ts`** | **`validatePhaseArtifacts()`(95-126)에서 `PHASE_ARTIFACT_FILES` 직접 참조를 `getPhaseArtifactFiles(state.flow, phase)`로 대체. light + phase 1일 때 checklist schema + `## Implementation Plan` 헤더 검사 추가.** `preparePhase()`에서 light + phase 1일 때 init prompt를 light 전용 템플릿으로 교체; light mode에서 `phaseReopenFlags['1']`이 true이면 결합 doc 보존 | **P1-3** |
| `src/phases/runner.ts` | light에서는 phase 2/3/4를 `'skipped'`로 초기화된 상태로 스킵 후 5로 진행; gate-7 REJECT target을 flow에 따라 분기; light + P7 REJECT 시 `state.carryoverFeedback` 세팅, phases[5,6] 동시 reset; **Phase 5 완료 순간 `state.carryoverFeedback = null` 클리어** (ADR-14 consume) | P1-1, P1-4 |
| `src/phases/gate.ts` | Phase 7 REJECT 시 `getReopenTarget(flow, gate=7)` 호출 → **light면 `1`, full이면 `5`** (full 동작 변경 없음 — 현행 `previousInteractivePhase()` 결과와 동일). 분기는 `flow === 'light'` 조건에만 적용 | — |
| **`src/context/assembler.ts`** | **Phase 1 light-mode 템플릿 분기; Phase 5 interactive variant에서 `state.carryoverFeedback`을 `pendingAction.feedbackPaths`와 병합해 `feedback_paths` 주입; `buildGatePromptPhase7`(199-220)와 `buildResumeSections`(300-325) 양쪽에서 `flow==='light'`일 때 `<plan>` 슬롯 완전 생략** | **P1-2, P1-4** |
| `src/context/prompts/phase-1.md` | 기존은 full 전용으로 유지 | — |
| `src/ui.ts` | 모델 선택 UI가 flow에 따라 다른 phase 집합 표시; `'skipped'` status를 `(skipped)`로 렌더 | P1-1 |
| `bin/harness.ts` | `start` 커맨드에 `--light` 플래그 등록 | — |
| `docs/HOW-IT-WORKS.md` | Light flow 섹션 추가 (풀 플로우 오버뷰 밑에 보조 단락) | — |
| `CLAUDE.md` (프로젝트) | "풀 프로세스 호출" 섹션에 light 모드 언급 | — |

### Create

| File | Purpose |
|---|---|
| `src/context/prompts/phase-1-light.md` | Light mode Phase 1 init prompt (brainstorm+plan 결합 지시; `## Implementation Plan` 섹션 필수 명시; checklist.json 생성 규약; reopen 시 gate-7-feedback 반영 지시) |
| `docs/specs/2026-04-18-light-flow-design.md` | 본 문서 |
| `.harness/2026-04-18-light-flow/decisions.md` | Decision log |

### Delete

없음.

### `/harness` Skill Integration (ADR-9, 구현 범위 밖)

구현 시점에 별도 설계. 후보 방향:
- **A.** `/harness --light [태스크]` — 동일 스킬이 플래그로 경량 흐름 안내
- **B.** `/harness-light [태스크]` — 별도 스킬 파일
- **기본 방향: A** (스킬 중복 회피). 본 스펙은 CLI 레이어만 확정.

---

## Risks

| ID | Risk | Mitigation |
|---|---|---|
| R1 | Light mode에서 설계 품질 저하 (pre-impl 독립 리뷰 부재) | 사용 가이드라인(러프 기준)을 문서화. 고위험 작업은 full 권장 명시. 사용자 선택 책임 |
| R2 | Phase 1 결합 doc이 너무 커져서 Phase 7 프롬프트 사이즈 한도 초과 | 기존 `MAX_FILE_SIZE_KB=200`, `MAX_PROMPT_SIZE_KB=500` 재사용. Phase 1 프롬프트에 결합 doc 적정 크기(±50KB) 가이드 포함 |
| R3 | Phase 7 REJECT가 Phase 1 reopen을 유발 → impl 전부 무효화 | 의도된 동작(ADR-4). 사용자가 이 비용을 피하려면 full 선택. 에스컬레이션 메뉴(`[S]kip`)로 강제 통과 가능 |
| R4 | `'skipped'` status가 UI/로그에서 오해 유발 | 로그/status 출력에서 `'skipped'`는 `(skipped)`로 표시 (ADR-1 rev-1 Consequences) |
| R5 | migration 이전 state.json과의 호환성 (`flow` 필드 부재) | `migrateState()`에서 기본 `'full'` 주입. 기존 run 동작 불변 (ADR-7) |
| R6 | light와 full phase prompt drift | 공통 재료(decisions 작성 규약, artifact format)는 `src/context/prompts/` 내에서 partial 파일로 공유 — 구현 시 소폭 리팩터 |
| R7 | Resume에서 `--light` 플래그를 넣었을 때 기대 불일치 | `harness resume --light`는 명시적으로 거부하고 에러 메시지 출력 ("flow is frozen at run creation. start a new run with `harness start --light`.") |
| R8 | (신규) `carryoverFeedback`이 consume 전 마이그레이션/crash로 날아감 | `state.json` 저장 타이밍 보장: `gate.ts`에서 carryoverFeedback 기록 직후 즉시 `writeState()`. resume은 기존 state 그대로 로드 (migrateState 기본값은 null이라 기존 run에는 영향 없음). Phase 5 assembler에서 path 존재 검증 추가 — 파일이 없으면 warning 후 feedback 없이 진행 |
| R9 | (신규) `'skipped'` status가 존재하는 state를 구버전 CLI가 로드 | forward-only 마이그레이션. state.json에 스키마 버전 태그 없음은 기존 제약 — 본 스펙 범위 밖. release note에 명시 |
| R10 | (신규) P7 REJECT → P1 reopen → P1 재완료 → P5 재실행 체인 중 외부 git commit이 끼어들어 `specCommit` 추적 꼬임 | 기존 external-commit 감지 로직(`externalCommitsDetected`) 재사용. light 신규 이슈 아님 |

---

## Out of Scope (ADR-10)

- **Mid-impl interactive gate:** Phase 5 중간에 Codex에게 체크인 요청하는 기능
- **Runtime flow switch:** 이미 시작된 run의 flow를 중간에 full↔light 전환
- **Task-size heuristic으로 flow 자동 선택:** CLI가 태스크 설명/git stat으로 light/full을 추천. 본 스펙에서는 사용자 명시만 허용 (ADR-11)
- **Light-only CLI 분기 명령어** (`harness start-light` 같은 별도 서브커맨드): 플래그만 유지하여 표면 최소화
- **Multi-level carryoverFeedback** (예: P7 → P3 → P1 체인): 현 설계는 `deliverToPhase` 단일 값. 향후 더 복잡한 체인 필요 시 배열로 확장 가능하지만 본 스펙 범위 밖.

---

## Open Questions (구현 세션에서 해소)

1. **Phase 1 결합 doc의 `## Implementation Plan` 섹션 검증 강도:** 단순 헤더 존재 확인만? 아니면 최소 1개 체크박스/번호 목록 요구? (권장: 헤더만. 과한 검증은 Phase 1 재귀 실패 유발. 이 리비전에서는 헤더 regex로 고정.)
2. **`/harness` 스킬 변경 세부:** ADR-9 A안 구체화 — init prompt에 light 가이드 블록을 조건부로 주입.
3. **Preset 선택 UI에서 light phase 집합만 보여줄지, 전체를 보여주되 skip 표시할지:** UX 관점에서 소폭 조정 가능.
4. **`carryoverFeedback.deliverToPhase`를 array로 확장할 가치:** 현 설계는 `5` 고정. 미래에 P7 → P1 → P5 + P6 체인이 생기면 리팩터 필요. 현재는 YAGNI.

---

## Acceptance (본 Phase 1 산출물에 대해)

- [x] `## Context & Decisions` 섹션 상단 존재
- [x] 7 phase vs 4 phase 비교 명시
- [x] Phase 번호 재사용 결정(ADR-2) 이유 포함
- [x] 결합 doc + checklist 분리(ADR-3) 이유 포함
- [x] Phase 5 input 계약(ADR-3) 명시
- [x] Phase 7 REJECT target(ADR-4) 결정 및 체인 전이 기술
- [x] `--light` + `--auto` 직교(ADR-8) 명시
- [x] Migration 기본값 `'full'`(ADR-7) 명시
- [x] `/harness` 스킬 통합 방향(ADR-9) — 범위 밖이나 방향 표기
- [x] Out-of-scope(ADR-10) 명시
- [x] 사용 가이드라인(러프 기준) 포함
- [x] **Gate-2 P1-1: resume validator compatibility — `'skipped'` status 도입 (ADR-1 rev-1)**
- [x] **Gate-2 P1-2: Phase 7 프롬프트 fresh + resume 양쪽 light 분기 (ADR-12)**
- [x] **Gate-2 P1-3: Phase 1 completion 검증 대칭성 — interactive.ts + resume.ts 양쪽 + `getPhaseArtifactFiles` helper (ADR-13)**
- [x] **Gate-2 P1-4: P7→P1→P5 체인 feedback 전달 — `state.carryoverFeedback` (ADR-14)**
- [x] **Gate-2 rev-2 P1-5: 풀 플로우 Phase 7 REJECT reopen target은 P5(현행) 유지 — 본 스펙은 풀 플로우 동작을 변경하지 않음 (Phase 7 REJECT 본문 + File-level Change List + decisions.md ADR-4 동기화)**
