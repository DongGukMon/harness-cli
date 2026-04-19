# Group F — Gate retry policy 재검토 (Intent / Handoff)

- 상태: design + impl. 스펙 착수 전 seed 문서.
- 작성일: 2026-04-19
- 브랜치: `spec/gate-retry-policy` (worktree: `~/.grove/github.com/DongGukMon/harness-cli/worktrees/gate-retry-policy`)
- 실행 모드: **autonomous** (`--auto`). Codex 3 reject → 4회째 force pass.
- 관련 문서:
  - Dogfood 관측: `~/.grove/github.com/DongGukMon/harness-cli/worktrees/gate-convergence/observations.md` L202–222 (P1 "Gate-retry ceiling" 섹션)
  - 기반 ADR: `docs/specs/2026-04-18-light-flow-design.md` (ADR-4: 모든 gate REJECT → P1 reopen)
  - Reviewer contract 현 위치: `src/context/assembler.ts::REVIEWER_CONTRACT_BASE` + `FIVE_AXIS_{SPEC,PLAN,EVAL}_GATE` (+ `REVIEWER_CONTRACT_BY_GATE[2|4]`, `reviewerContractForGate7(flow)`)
  - Verdict parser 현 위치: `src/phases/verdict.ts::parseVerdict`
  - Retry 제한 현 위치: `src/config.ts::GATE_RETRY_LIMIT = 3` (flow-불문 단일 상수)
  - Reopen dispatch 현 위치: `src/phases/runner.ts::handleGateReject` + `src/config.ts::getReopenTarget(flow, gate)`

---

## 이 문서의 목적

다른 세션(Phase 1/3/5/7 inner Claude 또는 Codex gate 리뷰어)이 이 작업을 **맥락 없이 시작해도** Group F의 의도와 결정 사항을 1분 안에 복원할 수 있게 만드는 핸드오프 문서다. 상세 설계와 plan은 P1/P3이 생산한다. 이 문서는 seed — rationale + 기본 권장 + 금지 구역 기록.

---

## 왜 (Why) — 문제

Light-flow dogfood Round 1 (observations.md L202–222) 데이터:

| Cycle | 소요 | 내역 |
|---|---|---|
| 1 | 7m 49s | P1 rev1 → P5 → P6 → P7 #0 REJECT |
| 2 | 7m 5s + 2m 수동 복구 | P1 rev2 → P5 → P6 → P7 #1 REJECT |
| 3 | 11m 0s (P1 rev3만 7m 14s) | P1 rev3 → P5 → P6 → P7 #2 **APPROVE** |

총 walltime 29m 38s 중 **~28분이 reject chain**. ADR-4의 "P7 REJECT → 무조건 P1 reopen" 규약이 impl-level 이슈(예: "`list` command unnecessarily saves on every run")에도 full re-design 을 강제한다. LOW-spec 태스크에서 비용이 비대칭적으로 크다.

Legacy issue #8 (`opus-max` overweight) 이 이 스톰을 악화시켰다 — Phase 1 default가 `opus-xhigh` 였을 때 rev3가 7m 14s 걸림. PR #22/#23으로 default는 `opus-high`로 완화됐지만, retry-storm 자체는 직교 이슈로 남는다.

---

## 무엇을 (What) — 선택지 3안

> **P1 담당자에게**: 이 세 안을 스펙에서 pros/cons/impl complexity/expected impact로 비교한 뒤 하이브리드를 **명시적으로** 선택(또는 override)하라. 기각된 안은 "기각 근거 + 향후 전환 trigger" 문장을 남긴다.

### Option 1 — Mid-impl fast-path (scope signal)

Codex reviewer가 REJECT verdict에 `scope: impl | design | mixed` 한 줄을 포함한다. `scope: impl` 시그널 발견 시 → **P1 skip, P5만 reopen** (impl 수정만 재시도).

- **Pros**: 의도 일치(원인에 맞는 phase만 reopen), Codex가 자발 분류.
- **Cons**: Codex가 정확히 분류할지 신뢰성 미검증; contract 추가 → prompt overhead; mixed 분류 정책 필요.
- **Impl complexity**: 중간. reviewer contract 추가 + verdict parser 확장 + runner dispatch 분기.

### Option 2 — ADR-4 relaxation (static rule)

Light flow에서 P7 REJECT 시 무조건 P5 reopen (P1 skip). Option 1의 정적 버전.

- **Pros**: 구현 단순(분기 한 줄).
- **Cons**: 진짜 design-level REJECT(요구사항 오해, 아키텍처 결함)도 P5에서 땜빵하게 되어 quality 저하 리스크; light P1=brainstorm+plan이 결합이라 분리 역전 효과.
- **Impl complexity**: 낮음.

### Option 3 — Retry limit 상향 (scalar knob)

Light flow `GATE_RETRY_LIMIT` 3 → 5 (또는 4). Full flow는 유지.

- **Pros**: 1-knob, orthogonal; Option 1/2와 조합 가능.
- **Cons**: REJECT 자체의 근본 원인은 해결 못 하고 budget 확장만 제공; retry마다 full-cycle이므로 budget × cycle cost.
- **Impl complexity**: 낮음. `getGateRetryLimit(flow)` 헬퍼.

### 기본 권장 — **Option 1 + Option 3 하이브리드**

- **근거**: impl-scoped REJECT는 fast-path(Option 1)로 비용 절감, design-scoped REJECT는 retry 여유(Option 3)로 수렴 확률 증대. 두 실패 모드가 다르고 두 변경은 orthogonal + 독립 테스트 가능.
- **Option 2 기각**: static rule은 false positive(design 이슈를 impl로 돌림) 위험이 더 크다. Option 1이 Option 2의 상위호환.

P1이 데이터로 override 가능 — 스펙에서 3안 비교표 작성 후 최종 선택을 ADR로 박제하라.

---

## 어떻게 (How) — 구체 설계 초안

### 1. Reviewer contract 확장

`src/context/assembler.ts::REVIEWER_CONTRACT_BASE` (모든 gate 공통) 또는 gate별 contract에 scope 규약 추가. 초안:

```
Scope tagging (REJECT only) — REJECT verdict에는 `Scope: design | impl | mixed` 한 줄을 반드시 포함한다.
  - design: spec/plan 재구조화가 필요한 이슈 (요구사항 오해, 아키텍처 결함, 누락된 비요구사항).
  - impl: 구현 단계에서 해결 가능한 이슈 (tests, naming, edge cases, dead code, 컴파일 오류, 테스트 실패).
  - mixed: 양쪽 모두 손대야 하는 이슈.
APPROVE 일 때는 Scope 라인을 생략한다.
```

위치는 gate 7 eval에서만 의미 있음(Phase 5 → P5 fast-path). 즉 `REVIEWER_CONTRACT_BY_GATE[2|4]` + `reviewerContractForGate7`에 **gate 7만** 삽입해야 할 수도 있다 — P1 담당자가 판단. 권장: 공통 preamble에 두고 "Phase 7 eval에서만 동작에 영향" 명시.

### 2. Verdict parser 확장

`src/phases/verdict.ts::parseVerdict` 반환 타입:

```typescript
{ verdict: 'APPROVE' | 'REJECT'; comments: string; scope?: 'design' | 'impl' | 'mixed' }
```

- REJECT 시 `## Comments` 섹션 바로 뒤(또는 `## Verdict` 섹션 내부) `^Scope:\s*(design|impl|mixed)\s*$` 라인 regex 매치.
- 파싱 실패 또는 누락 시 fallback: `scope = 'mixed'` (기존 동작과 equivalent — 전체 reopen).
- 대소문자 관대 매치 (`Scope:` / `scope:`), 여러 라인 허용 시 첫 매치만.

### 3. Runner dispatch 분기

`src/phases/runner.ts::handleGateReject` (phase 7 path):

- 현재: `getReopenTarget(state.flow, 7)` → light=`1`, full=`5`.
- 변경: light + phase 7 + `scope === 'impl'` 시 `reopenTargetPhase = 5` (P1 skip). 그 외 기존 유지.
- Full flow는 기존 유지 (본 PR 범위 밖).
- Light phase-reset 로직(L565–577 `carryoverFeedback` / `state.phases['5']='pending'` / `state.phaseCodexSessions['7']=null`)은 scope=impl 경로에도 적용 — **phase 5만 reset, phase 1 건드리지 않음**.

### 4. Config flow-aware retry limit

`src/config.ts`:

```typescript
export const GATE_RETRY_LIMIT_FULL = 3;
export const GATE_RETRY_LIMIT_LIGHT = 5;
export function getGateRetryLimit(flow: FlowMode): number {
  return flow === 'light' ? GATE_RETRY_LIMIT_LIGHT : GATE_RETRY_LIMIT_FULL;
}
// 기존 GATE_RETRY_LIMIT export는 deprecated alias(호환) — tests에서만 참조되는지 확인 후 제거 여부 결정.
```

Runner에서 `GATE_RETRY_LIMIT` 참조(L517, L522, L523, L541, L601, L604) 를 모두 `getGateRetryLimit(state.flow)` 로 전환.

### 5. Events.jsonl 호환

- `gate_retry` 이벤트의 `retryLimit` 필드를 flow-aware 값으로 emit (line 541).
- `types.ts::LogEventBase`의 `gate_retry` 타입은 이미 `retryLimit: number` — 스키마 호환.
- Session meta/summary 규약 변경 없음.

### 6. 테스트 전략

- **Unit — verdict parser**: `Scope: impl` / `Scope: design` / `Scope: mixed` / 누락 → 각각 예상 field. APPROVE 시 Scope 무시.
- **Unit — getGateRetryLimit**: `full`/`light` 분기.
- **Unit — getReopenTarget** (optional): scope 파라미터 추가 시 동작. 하지만 dispatch 분기는 `handleGateReject` 내부에서 처리하는 편이 단순.
- **Integration — handleGateReject**: mock codex verdict with `scope: impl` + `state.flow='light'` + `phase=7` → `state.phases['5']='pending'`, `state.phases['1']` 불변.
- **Snapshot — assembler**: REVIEWER_CONTRACT에 scope stanza 포함되는지.
- **Regression — full flow 변경 없음**: full flow + scope=impl 조합은 **기존 동작 유지**(P1 reopen). 명시적 테스트.

---

## Scope 경계

### Modify 대상
- `src/context/assembler.ts` — REVIEWER_CONTRACT stanza 추가
- `src/phases/verdict.ts` — parser scope 추출
- `src/phases/runner.ts` — reopen dispatch 분기 (phase 7 light)
- `src/config.ts` — flow-aware retry limit helper
- `src/types.ts` — `GatePhaseResult`/verdict 반환 타입에 `scope?` 추가 (필요 시)
- 테스트 파일: `tests/phases/verdict.test.ts`, `tests/phases/runner.test.ts`, `tests/config.test.ts`, `tests/context/assembler.test.ts`(해당 스냅샷 있으면)

### Create 대상
- 새 테스트 파일 (필요 시)
- 본 INTENT + Phase 1이 만드는 spec + Phase 3이 만드는 plan

### 금지 구역
- `src/context/playbooks/*` — vendored agent-skills, 변경 금지
- `src/runners/*` — claude/codex runner 본체 변경 금지
- Full flow ADR-4 완화 — **본 PR 범위 밖**. Follow-up spec으로 분리.
- Group A (validator / dirty-tree), Group B (feedback stanza), Group C (complexity directive), Group D (control pane), Group E (preflight) — 충돌 주의 구역이되, 다른 PR에서 작업 중. 해당 영역 건드리지 말 것.
- `pnpm link --global` 금지.

---

## 충돌 주의

| 파일 | 다른 Group이 건드리는 영역 | 본 PR이 건드릴 영역 |
|---|---|---|
| `src/context/assembler.ts` | Group B (feedback stanza, optional), Group C (complexity directive) | REVIEWER_CONTRACT에 scope 규약 추가 — **다른 주입 지점** |
| `src/phases/runner.ts` | Group A (failed branch recovery), Group E (phase 6 reset commit) | `handleGateReject` phase-7 reopen 분기 — **다른 분기** |
| `src/config.ts` | Group A (IGNORABLE_ARTIFACTS), Group C (complexity) | `GATE_RETRY_LIMIT` flow-aware — **다른 export** |

병합 시 rebase/충돌은 세심히 — 다른 PR에 없는 새 심볼만 추가하므로 일반적으로 clean merge.

---

## 완료 후 PR

- **Title**: `feat(gate): scope-aware P5 reopen + flow-aware retry limit (light)`
- **Base**: `main`
- **Body 구성**:
  1. T6 근거 (observations.md L202–222 요약 + Round 1 retry chain 데이터)
  2. 3안 비교표 (스펙에서 발췌)
  3. 선택한 하이브리드 + Option 2 기각 근거
  4. Reviewer contract stanza 원문
  5. Retry limit full/light 분기 + 근거
  6. Full-flow ADR-4 완화는 follow-up 스펙 — 본 PR 범위 밖 명시
  7. Events.jsonl 호환성 — `retryLimit` 필드 flow-aware emit
- **Test plan**: `pnpm tsc --noEmit`, `pnpm vitest run`, `pnpm build`, (가능 시) light-flow Round 3 mock dogfood (`scope: impl` 주입된 verdict → P5 reopen 경로 E2E).

---

## 자율 모드 운영

- Gate 2/4/7 각각 Codex 최대 3 reject → 4회째 자동 force pass.
- **사용자에게 에스컬레이션 금지**. Ambiguity는 이 INTENT + 관측 데이터 기준으로 스스로 결정한다.
- P1-only gate feedback 정책: gate reject 시 P1(Priority 1)만 처리, P2+는 TODO로 다음 phase 진입.

---

## 체크리스트 (eval checklist summary 초안)

- [ ] `parseVerdict`가 `Scope: impl|design|mixed` 라인을 추출한다 (REJECT only).
- [ ] Scope 누락 시 fallback = `mixed` (기존 동작 보존).
- [ ] `getGateRetryLimit('full')` = 3, `getGateRetryLimit('light')` = 5.
- [ ] `handleGateReject(phase=7, flow='light', scope='impl')` → `state.phases['5']='pending'`, `state.phases['1']` 미변경.
- [ ] `handleGateReject(phase=7, flow='light', scope='design'|'mixed')` → 기존 P1 reopen 경로 유지.
- [ ] `handleGateReject(phase=7, flow='full', scope='impl')` → 기존 P5 reopen 유지 (full은 이미 P5 reopen).
- [ ] Reviewer contract에 scope 규약 stanza 포함됨.
- [ ] `pnpm tsc --noEmit` 통과.
- [ ] `pnpm vitest run` 617+ 테스트 통과 (현재 baseline: 617 passed / 1 skipped).
- [ ] `pnpm build` 성공.
