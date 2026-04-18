# harness-cli Light Flow — Design Spec

- Date: 2026-04-18
- Status: Draft (Phase 1 output)
- Scope: `harness start --light` — 중간 규모 작업(≈1–4h, ≤~500 LoC, 소수 모듈) 대상 경량 파이프라인
- Related decisions: [.harness/2026-04-18-untitled/decisions.md](../../.harness/2026-04-18-untitled/decisions.md)
- 구현 범위: **본 스펙은 설계만 다룬다. 실제 구현은 별도 세션에서 진행.**

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

### Key Decisions (요약)

> 전체 Decision Log: [.harness/2026-04-18-untitled/decisions.md](../../.harness/2026-04-18-untitled/decisions.md)

| ID | 결정 |
|----|------|
| ADR-1 | Light flow는 `{1, 5, 6, 7}` 하위집합. Phase 1이 brainstorm+plan을 흡수, Phase 2/3/4 전면 skip |
| ADR-2 | Phase 번호 스키마 재사용(신규 L1..L4 도입 안 함). state/resume/preset 재사용 이득 > 개념적 혼란 |
| ADR-3 | Light Phase 1 산출물: 단일 결합 문서 + checklist 분리 유지 |
| ADR-4 | Light Phase 7은 REJECT 시 항상 Phase 1을 reopen. Phase 5 reopen은 verify FAIL 전용 |
| ADR-5 | 활성화: `harness start --light` 플래그. `state.flow: 'full' \| 'light'` 필드로 영속화 |
| ADR-6 | Light mode 기본 preset: `opus-max`(P1) / `sonnet-high`(P5) / `codex-high`(P7) |
| ADR-7 | `state.flow` 마이그레이션 기본값 `'full'`. 기존 run 호환 보장 |
| ADR-8 | `--light` + `--auto` 직교. 동시 사용 허용. 자율 모드 규칙(3회 reject → 강제 통과)은 light에도 동일 적용 |
| ADR-9 | `/harness` 스킬 통합: 본 스펙 범위 밖(구현 시점에 설계). `--light` 플래그 전파가 기본 방향 |
| ADR-10 | Out of scope: mid-impl interactive gate, 런 도중 flow 전환, 태스크 크기 자동 판별 기반 동적 phase pruning |
| ADR-11 | CLI는 light/full을 자동 선택하지 않는다. 사용자 명시 플래그로만 활성화 |

---

## Flow Comparison

```
풀 플로우 (기존):
  P1 brainstorm → P2 spec-gate → P3 plan → P4 plan-gate
  → P5 impl → P6 verify → P7 eval-gate

라이트 플로우 (신규):
  P1 design(=brainstorm+plan) → P5 impl → P6 verify → P7 eval-gate
                                                           │
                                        REJECT → P1 reopen ┘
                                        verify FAIL → P5 reopen
```

- 유지: Phase 1, 5, 6, 7 (번호 보존 — ADR-2)
- Skip: Phase 2, 3, 4 (상태 `'skipped'` 표기, ADR-1)
- 유일한 Codex gate: Phase 7 (eval-gate)

---

## Phase Specification (Light Mode)

### Phase 1 — Design (brainstorm + plan 결합)

| | |
|---|---|
| **Agent** | Claude Code CLI |
| **Model (default)** | `opus-max` (Claude Opus 4.7 / xHigh) |
| **Mode** | Interactive |
| **Input** | `.harness/<runId>/task.md` |
| **Output** | `docs/specs/<runId>-design.md` (결합 문서)<br>`.harness/<runId>/checklist.json` (verify 검증 항목, 여전히 별도 파일) |
| **Completion signal** | `.harness/<runId>/phase-1.done` with `phaseAttemptId` |

**결합 문서 구조 (ADR-3):**

```
# <title> — Design Spec (Light)
## Context & Decisions
## Requirements / Scope
## Design
## Implementation Plan       ← 기존 Phase 3 산출물이 여기로 흡수
  - Task 1: ...
  - Task 2: ...
## Eval Checklist Summary    ← checklist.json의 요약 미러
```

**왜 checklist는 분리 유지?**
- `scripts/harness-verify.sh`가 JSON 스키마(`{checks: [{name, command}]}`)를 직접 파싱. 포맷 변경은 Phase 6 구현 변경을 강요함.
- 문서 내 인라인 JSON은 파싱 취약 (markdown 코드펜스 누락 시 깨짐).
- Gate 7 프롬프트 사이즈 관리(비-필수 항목 분리) 측면에서도 유리.

**Init prompt 차이 (구현 시 반영):**
- 풀 플로우의 Phase 1 프롬프트(`src/context/prompts/phase-1.md`)를 light 전용 템플릿으로 교체.
- "설계만 작성" → "설계 + 구현 태스크 분해 + checklist까지 단일 세션에서 작성"으로 문구 변경.
- 결합 문서 내 `## Implementation Plan` 섹션 필수임을 명시.
- checklist.json 생성 규약 포함 (Phase 3 프롬프트에서 이식).

**Completion 검증 (CLI 측):**
- `docs/specs/<runId>-design.md` 존재 + non-empty + mtime ≥ `phaseOpenedAt[1]`
- `## Implementation Plan` 헤더 존재 검사 (간단 regex; 풀 플로우에는 없는 추가 검증)
- `checklist.json` 존재 + 스키마 검증 (기존 Phase 3 검증 로직 재사용)

### Phase 5 — Implementation

| | |
|---|---|
| **Agent** | Claude Code CLI |
| **Model (default)** | `sonnet-high` |
| **Mode** | Interactive (**explicit session clear from Phase 1**) |
| **Input (ADR-3)** | `docs/specs/<runId>-design.md` (결합 문서)<br>`.harness/<runId>/decisions.md`<br>`.harness/<runId>/checklist.json` (참고용; verify 시 실행됨)<br>reopen 시: `gate-7-feedback.md`, `verify-feedback.md` (해당 시) |
| **Output** | git commits |
| **Completion signal** | `.harness/<runId>/phase-5.done` + 최소 1 commit + 작업 트리 clean |

Phase 5 입력 계약은 풀 플로우와 거의 동일하되 **plan doc이 빠지고 결합 doc으로 대체됨**. `src/context/assembler.ts`의 interactive variant에서 light 모드 분기 필요.

### Phase 6 — Auto Verification

풀 플로우와 **완전 동일**. 변경 없음.
- `scripts/harness-verify.sh <checklist> <eval-report>` 실행
- Output: `docs/process/evals/<runId>-eval.md`

### Phase 7 — Eval Gate

| | |
|---|---|
| **Agent** | Codex companion |
| **Model (default)** | `codex-high` |
| **Input (light)** | 결합 doc(`docs/specs/<runId>-design.md`) + eval report + `git diff <baseCommit>..HEAD` + metadata block |
| **REJECT 타겟 (ADR-4)** | **항상 Phase 1 reopen** |

**Phase 7 프롬프트 조립 (light 모드):**
- 풀 플로우는 `spec + plan + eval report + diff`를 인라인. light는 **spec 슬롯에 결합 doc을 넣고 plan 슬롯은 생략**.
- `src/context/assembler.ts`의 gate-7 variant에 `flow === 'light'` 분기 추가. 구현 시 plan 섹션을 조건부 스킵.
- 사이즈 한도(500KB 전체, 200KB 개별) 재사용.

**REJECT 시 동작 (ADR-4):**
- Phase 7 REJECT → **Phase 1 reopen** (풀 플로우는 Phase 5 reopen). 이유: light에서는 spec과 plan이 한 문서이므로, 설계 수정과 계획 수정이 분리되지 않는다. 결합 doc을 재작성해야 impl이 따라간다.
- Phase 6 FAIL → Phase 5 reopen (변경 없음; verify 실패는 항상 impl 교정).
- Phase 7 reopen에서 결합 doc가 수정되면 impl도 그에 맞춰 다시 수행되어야 한다. 즉 reopen 체인은 `P7 REJECT → P1 reopen → (P1 재완료 시) P5 자동 재진입`. 이는 light mode에서 Phase 7 rerun이 Phase 5 reset을 자동 강제함을 의미.

**REJECT 체인 의사 상태 전이:**
```
phases: {1:done, 5:done, 6:done, 7:REJECT}
  → reopen target = 1
  → phases[1] = pending (reopen flag true)
  → phases[5] = pending (design 변경 시 impl 재수행)
  → phases[6] = pending (impl 변경 시 verify 재수행)
  → phases[7] = pending
  → currentPhase = 1
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

export interface HarnessState {
  // ... (기존 필드)
  flow: FlowMode;                                // 신규
  // ... (기존 필드)
}
```

### PHASE 상태 의미 확장

- `phases: Record<'1'..'7', PhaseStatus>` 유지.
- Light 모드에서 `phases['2']`, `phases['3']`, `phases['4']`는 생성 시 `'completed'`로 초기화 (더미 완료 처리). Phase 러너는 light 모드일 때 해당 phase를 건너뛴다.
- 대안(신규 status `'skipped'` 도입)은 기각: PhaseStatus union 확장은 CLI 전역 분기를 유발. completed로 채우면 phase 전진 로직(`currentPhase++`)을 그대로 재사용 가능.

### PHASE_DEFAULTS (light)

```ts
// src/config.ts — 신규 상수 추가
export const LIGHT_PHASE_DEFAULTS: Record<number, string> = {
  1: 'opus-max',      // design (결합)
  5: 'sonnet-high',   // impl
  7: 'codex-high',    // eval-gate
  // 2/3/4는 skip, 6은 runner 없음
};

export const LIGHT_REQUIRED_PHASE_KEYS = ['1', '5', '7'] as const;
```

`promptModelConfig()`와 `runRunnerAwarePreflight()`는 `flow` 값을 받아 해당 키 셋만 순회.

### 기타 필드

- `phaseOpenedAt`, `phaseAttemptId`, `phaseReopenFlags`: 기존 키(`'1'|'3'|'5'`) 중 light에서는 `'1'|'5'`만 실제 사용. 구조 변경 없음.
- `phaseCodexSessions`: 풀은 `'2'|'4'|'7'`, light는 `'7'`만 사용. 구조 변경 없음 (null로 유지).
- `gateRetries`: 풀은 `{2,4,7}`, light는 `{7}`만 증가.

### Migration

`src/state.ts`의 `migrateState()`에 분기 추가:

```ts
if (!('flow' in state)) {
  state.flow = 'full';       // 기존 run은 전부 full로 해석 (ADR-7)
}
```

**호환성:** 이 마이그레이션 이전에 생성된 state.json은 flow 필드가 없으므로 기본 `'full'`로 처리. light run은 본 변경 이후 생성된 run에만 존재.

---

## File-level Change List

### Modify

| File | Change |
|---|---|
| `src/types.ts` | `FlowMode` 타입 + `HarnessState.flow` 필드 추가 |
| `src/state.ts` | `createInitialState(runId, task, base, auto, logging, flow)` 시그니처 확장; `migrateState()`에 `flow` 기본값 백필 |
| `src/config.ts` | `LIGHT_PHASE_DEFAULTS`, `LIGHT_REQUIRED_PHASE_KEYS`, `getFlowDefaults(flow)` helper 추가 |
| `src/commands/start.ts` | `StartOptions.light` 추가; `createInitialState`에 flow 전달 |
| `src/commands/inner.ts` | 모델 선택/preflight에 flow 기반 phase 집합 전달 |
| `src/commands/resume.ts` | `--light` 플래그 거부; state.flow 그대로 신뢰 |
| `src/phases/runner.ts` | light에서는 phase 2/3/4 자동 completed 처리 후 5로 진행; gate-7 REJECT target을 flow에 따라 분기 |
| `src/phases/interactive.ts` | `preparePhase()`에서 light + phase 1일 때 init prompt를 light 전용 템플릿으로 교체; light mode에서 `phaseReopenFlags['1']`이 true이면 결합 doc 보존 |
| `src/phases/gate.ts` | Phase 7 REJECT 시 `getReopenTarget(flow, gate=7)` 호출 → light면 `1`, full이면 `5` |
| `src/context/assembler.ts` | Phase 1 light-mode 템플릿 분기; Phase 5 interactive variant에서 plan doc 참조 제거(결합 doc만 인라인); Phase 7 gate variant에서 plan 섹션 조건부 스킵 |
| `src/context/prompts/phase-1.md` | 기존은 full 전용으로 유지; light 전용 별도 파일 추가 |
| `src/ui.ts` | 모델 선택 UI가 flow에 따라 다른 phase 집합 표시 |
| `bin/harness.ts` | `start` 커맨드에 `--light` 플래그 등록 |
| `docs/HOW-IT-WORKS.md` | Light flow 섹션 추가 (풀 플로우 오버뷰 밑에 보조 단락) |
| `CLAUDE.md` (프로젝트) | "풀 프로세스 호출" 섹션에 light 모드 언급 |

### Create

| File | Purpose |
|---|---|
| `src/context/prompts/phase-1-light.md` | Light mode Phase 1 init prompt (brainstorm+plan 결합 지시) |
| `docs/specs/2026-04-18-untitled-design.md` | 본 문서 |
| `.harness/2026-04-18-untitled/decisions.md` | Decision log |

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
| R4 | `phases['2']='completed'`이 UI/로그에서 오해 유발 | 로그/status 출력에서 `flow==='light'`일 때 phase 2/3/4를 `(skipped)`로 표시 |
| R5 | migration 이전 state.json과의 호환성 (`flow` 필드 부재) | `migrateState()`에서 기본 `'full'` 주입. 기존 run 동작 불변 (ADR-7) |
| R6 | light와 full phase prompt drift | 공통 재료(decisions 작성 규약, artifact format)는 `src/context/prompts/` 내에서 partial 파일로 공유 — 구현 시 소폭 리팩터 |
| R7 | Resume에서 `--light` 플래그를 넣었을 때 기대 불일치 | `harness resume --light`는 명시적으로 거부하고 에러 메시지 출력 ("flow is frozen at run creation. start a new run with `harness start --light`.") |

---

## Out of Scope (ADR-10)

- **Mid-impl interactive gate:** Phase 5 중간에 Codex에게 체크인 요청하는 기능
- **Runtime flow switch:** 이미 시작된 run의 flow를 중간에 full↔light 전환
- **Task-size heuristic으로 flow 자동 선택:** CLI가 태스크 설명/git stat으로 light/full을 추천. 본 스펙에서는 사용자 명시만 허용 (ADR-11)
- **Light-only CLI 분기 명령어** (`harness start-light` 같은 별도 서브커맨드): 플래그만 유지하여 표면 최소화

---

## Open Questions (구현 세션에서 해소)

1. **Phase 1 결합 doc의 `## Implementation Plan` 섹션 검증 강도:** 단순 헤더 존재 확인만? 아니면 최소 1개 체크박스/번호 목록 요구? (권장: 헤더만. 과한 검증은 Phase 1 재귀 실패 유발.)
2. **`/harness` 스킬 변경 세부:** ADR-9 A안 구체화 — init prompt에 light 가이드 블록을 조건부로 주입.
3. **Preset 선택 UI에서 light phase 집합만 보여줄지, 전체를 보여주되 skip 표시할지:** UX 관점에서 소폭 조정 가능.

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
