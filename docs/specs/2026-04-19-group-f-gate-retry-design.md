# Group F — Gate retry policy (scope-aware P5 fast-path + flow-aware retry limit)

- 상태: Phase 1 spec (harness run `2026-04-19-group-f-gate-retry`)
- 작성일: 2026-04-19
- 브랜치: `spec/gate-retry-policy`
- 관련 문서:
  - Seed / handoff: `docs/specs/2026-04-19-gate-retry-policy-INTENT.md`
  - 기반 ADR (full replay 정책): `docs/specs/2026-04-18-light-flow-design.md` §ADR-4
  - Dogfood 관측 (retry storm 원 데이터): `~/.grove/github.com/DongGukMon/harness-cli/worktrees/gate-convergence/observations.md` L202–222
  - 결정 로그 (trade-off 기록): `.harness/2026-04-19-group-f-gate-retry/decisions.md`
  - 다음 phase 산출물: `docs/plans/2026-04-19-group-f-gate-retry.md` (Phase 3 에서 생성)

---

## Context & Decisions

### 문제

`harness-cli --light` 플로우의 Round 1 dogfood (observations.md L202–222)에서, Phase 7 eval gate가 임플 수준 코멘트("`list` command unnecessarily saves on every run") 로 REJECT 되었을 때도 ADR-4 규약 ("light flow + gate 7 REJECT → Phase 1 reopen") 이 **spec 전체 재작성** 을 강제했다. 총 walltime 29m 38s 중 약 28분이 reject chain 이었다. LOW-spec 태스크에서 비용이 비대칭이다. Legacy issue #8 (`opus-xhigh` overweight) 은 PR #22/#23 으로 default 가 `opus-high` 로 완화되며 부분 해결되었지만, retry-storm 자체는 직교 이슈로 남았다. Full flow 는 이미 Phase 7 REJECT → Phase 5 reopen 구조라 본 이슈가 없다.

### 결정 요지 (ADR)

1. **Option 1 + Option 3 하이브리드 채택** — Codex reviewer 가 REJECT verdict 에 `Scope: design | impl | mixed` 한 줄을 포함하고, light flow + gate 7 + `scope === 'impl'` 인 경우에만 Phase 5 reopen (P1 skip). light flow 의 `GATE_RETRY_LIMIT` 는 3 → 5 로 상향하고, full flow 는 3 으로 유지한다. 두 변경은 직교하고 독립적으로 테스트 가능하다.
2. **Option 2 (static ADR-4 relaxation) 기각** — 정적 규칙은 false positive 위험(design-level REJECT 를 P5 에서 땜빵) 이 더 크다. Option 1 이 Option 2 의 상위호환이므로 정적 분기는 도입하지 않는다. 상세 trade-off 는 `.harness/2026-04-19-group-f-gate-retry/decisions.md` 참조.
3. **Full flow ADR-4 완화는 본 PR 범위 밖** — full flow 의 Phase 7 REJECT 동작은 기존 (`getReopenTarget('full', 7) === 5`) 을 유지한다. 본 변경은 reopen 타깃 전체 정책을 재설계하지 않고, 오직 **light + gate 7 + scope=impl** 의 single 분기만 추가한다.
4. **Scope 파싱 실패 → `mixed` fallback** — 파싱 실패, 누락, 불명 토큰은 모두 `mixed` 로 처리한다. `mixed` 는 기존 동작(light 면 P1 reopen) 과 동치이므로, 본 변경은 **APPROVE 경로와 "scope=impl 이 명시된 REJECT 경로" 만 영향** 을 주고 그 외 경로에는 영향이 없다 (backward compatible by construction).
5. **Reviewer contract 는 공통 preamble 에 둔다** — scope stanza 를 `REVIEWER_CONTRACT_BASE` 에 넣되, "본 규약은 Phase 7 eval gate 에서만 dispatch 에 영향을 준다. 다른 gate 는 parser 가 추출은 하지만 runner 가 사용하지 않는다" 는 문장을 포함한다. Gate 별로 stanza 를 중복 주입하는 것보다 유지보수 비용이 작다.

---

## Requirements

### R1. Reviewer contract — scope tagging

- `REVIEWER_CONTRACT_BASE` (또는 gate 7 전용 contract) 에 다음 문단을 추가한다.
  ```
  Scope tagging (REJECT only) — REJECT verdict 에는 `Scope: design | impl | mixed` 한 줄을 반드시 포함한다.
    - design: spec/plan 재구조화 가 필요한 이슈 (요구사항 오해, 아키텍처 결함, 누락된 비요구사항).
    - impl: 구현 단계 에서 해결 가능한 이슈 (tests, naming, edge cases, dead code, 컴파일/테스트 실패).
    - mixed: 양쪽 모두 손대야 하는 이슈.
  APPROVE 일 때는 Scope 라인을 생략한다.
  이 규약은 Phase 7 eval gate 에서만 dispatch 에 영향을 준다 (다른 gate 는 무시).
  ```
- 위치: `src/context/assembler.ts::REVIEWER_CONTRACT_BASE`. `FIVE_AXIS_EVAL_GATE_{FULL,LIGHT}` 에 재차 언급할 필요 없음 — base 에 한 번만.

### R2. Verdict parser — scope 추출

- 반환 타입을 다음과 같이 확장한다.
  ```typescript
  export type Scope = 'design' | 'impl' | 'mixed';
  export function parseVerdict(
    rawOutput: string,
  ): { verdict: 'APPROVE' | 'REJECT'; comments: string; scope?: Scope } | null;
  ```
- `GateOutcome` (`src/types.ts`) 에도 optional `scope?: Scope` 필드를 추가한다.
- 파싱 규칙:
  - `## Verdict` 섹션 이후부터 문서 끝까지 (또는 `^(?:#|---)` 경계까지) 전 범위를 스캔하고, `^\s*Scope:\s*(design|impl|mixed)\b.*$` 를 대소문자 무관 match 한다. 여러 매치 시 **첫 번째만** 사용한다.
  - 매치가 있고 `verdict === 'REJECT'` 이면 `scope` 를 세팅한다.
  - 매치가 있지만 `verdict === 'APPROVE'` 이면 scope 를 무시한다 (fallthrough).
  - 매치가 없거나 토큰이 `design|impl|mixed` 가 아니면 `scope` 필드를 생략한다 (undefined).
- **Fallback 계약**: `GateOutcome.scope` 가 undefined 인 REJECT 는 기존 경로(`getReopenTarget` 결과) 로 dispatch 된다. 즉 light + gate 7 에서는 P1 reopen — 변경 전 동작과 동일.

### R3. Runner dispatch — light + gate 7 + scope=impl fast-path

- `src/phases/runner.ts::handleGateReject` 에 다음 분기를 추가한다.
  - 조건: `state.flow === 'light'` **AND** `phase === 7` **AND** `scope === 'impl'`.
  - 동작: `targetInteractive = 5` (i.e. `getReopenTarget` 결과를 override).
  - 현재 light + gate 7 경로에서 수행되는 reset 로직 (L565–577) 은 **그대로** 적용한다. 즉:
    - `state.phases['5'] = 'pending'`, `state.phases['6'] = 'pending'`.
    - `state.phaseCodexSessions['7'] = null` + `deleteGateSidecars(runDir, 7)`.
    - `state.carryoverFeedback` 는 `deliverToPhase: 5` 로 설정 (기존 동작과 동일).
  - `state.phases['1']` 은 **건드리지 않는다** (fast-path 의 핵심).
- 그 외 조합 (scope=design, scope=mixed, scope=undefined, full flow, gate 2/4) 은 기존 동작 유지.

### R4. Config — flow-aware retry limit

- `src/config.ts` 에 다음을 추가한다.
  ```typescript
  export const GATE_RETRY_LIMIT_FULL = 3;
  export const GATE_RETRY_LIMIT_LIGHT = 5;
  export function getGateRetryLimit(flow: FlowMode): number {
    return flow === 'light' ? GATE_RETRY_LIMIT_LIGHT : GATE_RETRY_LIMIT_FULL;
  }
  ```
- 기존 `export const GATE_RETRY_LIMIT = 3` 는 **deprecated alias 로 유지하지 않고 제거** 한다. Phase 3 plan 단계에서 `GATE_RETRY_LIMIT` 의 grep 참조를 모두 `getGateRetryLimit(state.flow)` 로 전환한다 (`src/phases/runner.ts` L517, L522–L523, L541, L601, L604). 테스트 코드가 상수를 import 하고 있으면 헬퍼로 교체한다.
- 제거 근거: 상수와 헬퍼가 공존하면 "flow-미지정 경로가 상수를 쓰는지 헬퍼를 쓰는지" 의 인지 부담이 생긴다. grep 으로 일괄 전환 가능한 규모이며, 외부 소비자가 없으므로 deprecated alias 의 이득이 없다.

### R5. Events.jsonl 호환

- `gate_retry` 이벤트의 `retryLimit` 필드는 `getGateRetryLimit(state.flow)` 값을 emit 한다 (line 541).
- 필드 타입 (`LogEventBase.retryLimit: number`) 는 변경 없음 — 스키마 호환.
- 다른 이벤트 (`phase_end`, `gate_verdict`, `gate_error`) 의 스키마 변경 없음. `GateOutcome.scope` 는 runtime state 에만 존재하고, events.jsonl 에는 emit 하지 않는다 (P3 plan 단계에서 "scope 를 log 에도 담을지" 를 재확인 — 본 spec 의 디폴트: emit 하지 않음; Open Questions Q1 참조).

### R6. 테스트 전략 (Phase 3 plan 에서 태스크화)

- **Unit — `parseVerdict`** (tests/phases/verdict.test.ts):
  - REJECT + `Scope: impl` → `{ verdict: 'REJECT', scope: 'impl', ... }`.
  - REJECT + `Scope: design` / `Scope: mixed` → 각 해당 값.
  - REJECT + `scope: impl` (소문자) → `'impl'` (case-insensitive 확인).
  - REJECT + `Scope:` 없음 → `scope` 필드 부재.
  - APPROVE + `Scope: impl` (오타 시나리오) → `scope` 필드 부재 (APPROVE 는 무시).
  - REJECT + `Scope: bogus` → `scope` 필드 부재.
- **Unit — `getGateRetryLimit`** (tests/config.test.ts):
  - `getGateRetryLimit('full') === 3`, `getGateRetryLimit('light') === 5`.
- **Integration — `handleGateReject`** (tests/phases/runner.test.ts):
  - `flow='light', phase=7, scope='impl'` → `state.phases['5']='pending'`, `state.phases['1']` 기존 값 보존, `carryoverFeedback.deliverToPhase===5`, gate-7 Codex session invalidated.
  - `flow='light', phase=7, scope='design'` → 기존 P1 reopen 경로 (carryoverFeedback + P1 pending).
  - `flow='light', phase=7, scope=undefined` → 기존 P1 reopen (fallback 확인).
  - `flow='full', phase=7, scope='impl'` → 기존 P5 reopen 유지 (변경 없음 증거).
  - `flow='full', phase=2, scope='impl'` → 기존 P1 reopen 유지 (scope 무시 증거).
- **Snapshot — assembler** (tests/context/assembler.test.ts, 해당 스냅샷 있으면 갱신):
  - `REVIEWER_CONTRACT_BASE` 에 "Scope tagging" stanza 포함됨.
- **Regression — events.jsonl**: `gate_retry.retryLimit` 이 light 런 에서 `5`, full 런 에서 `3` 을 emit 하는 것을 fixture 기반 테스트로 확인.

### R7. 문서 업데이트 (Phase 3 plan 에서 태스크화)

- `CLAUDE.md` 의 "현재 open issues" 섹션에서 retry-storm 관련 표기 업데이트 (Phase 3 plan 에서 scope 정하기).
- `docs/HOW-IT-WORKS.md` 의 Light Flow 섹션에 "gate 7 REJECT 시 scope 에 따라 P1 또는 P5 reopen" 을 한 문장 추가.

---

## Non-requirements (out of scope)

- **Full flow 의 ADR-4 완화** — full flow 는 이미 `getReopenTarget('full', 7) === 5` 이므로 본 이슈가 없다. 혹시 full flow 에도 "P1 완전 skip" 같은 변경을 하려면 별도 spec 이 필요하다.
- **Reviewer contract 의 scope 규약을 gate 2/4 runner 에서 활용** — 본 PR 은 gate 7 dispatch 만 변경한다. 향후 gate 2/4 에서 "plan 차원 재작성이 필요 없는 spec-fix 만" 같은 fast-path 가 필요해지면 별도 설계.
- **Scope classification 정확도 튜닝** — Codex 가 실제로 impl vs design 을 정확히 분류하는지 는 post-ship dogfood 로 측정한다 (rollback trigger: Open Questions Q3). 본 PR 은 contract 만 선언하고, 정확도 개선 (예: few-shot 예시 주입) 은 follow-up.
- **Retry limit 추가 knob** — light 의 5, full 의 3 은 ADR 로 박제하고, CLI flag / env var 로 override 하는 UX 는 넣지 않는다.
- **`opus-xhigh` preset 자동 선택 / `--heavy` CLI flag** — 개별 follow-up (Issue #8, FOLLOWUPS.md P1.4). 본 PR 과 직교.
- **Group A/B/C/D/E 의 영역 변경** — INTENT 의 "충돌 주의" 표 참조. 본 PR 은 다른 Group 의 주입 지점 / 분기 / export 를 건드리지 않는다.

---

## 경계 조건 & Edge cases

1. **Codex 가 APPROVE 인데 `Scope: impl` 라인을 넣은 경우** — parser 가 scope 를 무시한다. Runner 는 APPROVE 경로로 진행 — REJECT-only 계약이 유지된다.
2. **Codex 가 `Scope:` 다음에 여러 값을 쓴 경우** (예: `Scope: impl, design`) — 첫 매치의 첫 토큰만 사용. `impl, design` 은 regex 매치 안 됨 → undefined → mixed fallback → P1 reopen. 안전 측면의 fallback.
3. **Codex 가 `Scope: mixed` 를 반환** — R3 분기 조건 (`scope === 'impl'`) 을 만족하지 않으므로 기존 경로 (P1 reopen). 의도된 동작.
4. **Codex 가 `Scope:` 를 raw output 내 Comments 섹션 안에 넣은 경우** — regex 가 `## Verdict` 이후 문서 전체를 스캔하므로 매치된다. 의도된 동작 (reviewer 의 배치 자유도 허용).
5. **Light flow 에서 retry 5 회 소진 후 auto-mode** — `retryCount >= 5 && autoMode` → `forcePassGate` 경로 (R4 의 헬퍼 경유). 기존 auto-mode 동작과 동일, limit 만 5 로 변경.
6. **Light flow 에서 retry 5 회 소진 후 non-auto** — `handleGateEscalation` 경로. 사용자 프롬프트 (C/S/Q) 유지. 메시지의 "rejected 3 times" 를 `getGateRetryLimit(state.flow)` 로 교체.
7. **Full flow 에서 scope=impl REJECT** — R3 분기 조건 (`state.flow === 'light'`) 을 만족하지 않으므로 기존 경로 (`getReopenTarget('full', 7) === 5` → P5 reopen). 즉 full flow 는 scope 를 emit 받아도 **dispatch 가 변하지 않는다** (non-regression 보증).
8. **Light flow 의 gate 2/4 에서 scope=impl REJECT** — R3 분기 조건 (`phase === 7`) 을 만족하지 않으므로 기존 경로. spec/plan 재작성이 맞다.

---

## 성공 기준 (acceptance)

- [ ] Parser 가 R2 의 6개 케이스를 올바르게 반환한다 (tests green).
- [ ] `getGateRetryLimit` 이 R4 의 2 케이스를 만족한다.
- [ ] `handleGateReject` 가 R6 integration 5 케이스를 만족한다.
- [ ] Reviewer contract snapshot 에 "Scope tagging" stanza 가 포함된다.
- [ ] `pnpm tsc --noEmit` green.
- [ ] `pnpm vitest run` 617+ baseline 유지 (신규 테스트만 추가, 기존 테스트 regression 없음).
- [ ] `pnpm build` 성공.
- [ ] **Mocked dogfood (optional)**: light flow + gate 7 verdict 에 `Scope: impl` 주입한 fixture 로 P5 reopen 경로를 end-to-end 확인. Phase 3 plan 에서 "실 harness 실행 필요" 인지 "integration 테스트로 충분" 인지 정한다.

---

## Implementation 노트 (Phase 3 plan 을 위한 힌트)

- **태스크 분해 권장 순서** (수직 슬라이스):
  1. T1. types + parser (R2) — self-contained, 테스트 먼저.
  2. T2. config 헬퍼 (R4) + runner 의 `GATE_RETRY_LIMIT` → `getGateRetryLimit(state.flow)` 일괄 전환.
  3. T3. runner dispatch 분기 (R3) — T1 의 `scope` 필드 활용.
  4. T4. assembler reviewer contract (R1) — 독립적이지만 T1 의 parser 가 짝이 맞아야 E2E 검증 가능.
  5. T5. integration 테스트 (R6).
  6. T6. 문서 업데이트 (R7).
- **의존성**: T1 → T3, T5. T2 → T5. T4 는 T1 과 병렬.
- **충돌 주의**: Group B/C 가 `assembler.ts` 의 다른 stanza 를 건드릴 가능성. base stanza 에 새 문단 추가는 clean merge 될 가능성이 높지만, Phase 3 plan 에서 base 파일의 최신 커밋을 확인하고 필요 시 rebase.

---

## Scope 경계 (구현 금지 구역)

- `src/context/playbooks/*` — vendored agent-skills, 변경 금지.
- `src/runners/*` — claude/codex runner 본체 변경 금지. scope 처리는 **phases/** 레이어에서만.
- Full flow ADR-4 완화 — 별도 follow-up spec.
- `pnpm link --global` 금지 (실험 중 오염 방지).
- Group A/B/C/D/E 영역 — INTENT 의 충돌 주의 표 참조.

---

## Open Questions

> Phase 2 gate 리뷰어는 다음 중 해결이 필요하다고 판단되는 항목을 P1/P2 로 올려주십시오. 본 spec 의 설계 제안 (괄호 안 "현 스펙") 은 기각 가능합니다.

- **Q1. Scope 를 events.jsonl 에 emit 할까?** — 현 스펙: 안 한다 (runtime-only). 근거: scope 는 dispatch 에만 쓰이고 post-hoc 분석 가치가 크지 않다고 판단. 반대 의견: 롤아웃 후 "Codex 가 실제 어떤 scope 를 얼마나 반환하는지" 메트릭이 필요할 수 있다 → 그 경우 `gate_verdict` 이벤트에 `scope?: Scope` 추가가 최소 변경이다. Phase 2 가 "metric 용 필드를 P1 에 포함하라" 고 하면 R5 를 확장한다.
- **Q2. Light flow `GATE_RETRY_LIMIT_LIGHT = 5` 는 적정한가?** — 현 스펙: 5 (INTENT 권장). 근거: Round 1 데이터가 3회 중 3회째 APPROVE 였으므로 "여유가 있으면 더 수렴했을 가능성" 에 대한 argument 는 약하다. 하지만 Option 1 (fast-path) 이 cycle 당 비용을 낮추므로 5 회 소진이 예산 면에서 감당 가능. 대안: 4 (보수), 6 (적극). Phase 2 가 " data 가 3 을 감당 못 한다는 직접 증거가 약하니 4 로" 라고 하면 수용 가능.
- **Q3. 롤아웃 후 rollback trigger 를 명시할까?** — 현 스펙: 명시하지 않음. Phase 2 가 "scope classification 정확도 < X%, 또는 false-fast-path 가 design-level regression 을 유발하면 Option 1 off" 같은 조건을 spec 에 박제하라고 하면 "Rollback trigger" 섹션을 추가한다. 현 스펙은 follow-up dogfood 에서 측정 후 판단.
- **Q4. `GateOutcome.scope` 를 `gate_verdict` 이벤트 스키마에 넣지 않으면, 재시도 체인 분석이 쉬운가?** — Q1 의 구체화. events.jsonl 만 보고 "이 REJECT 는 impl 이었나 design 이었나" 를 알 수 없으면 dogfood 디버깅이 어렵다. 의견: 이것만 봐도 Q1 의 답이 "emit 한다" 쪽으로 기울 수 있음. Phase 2 가 이 지점을 짚어주기를 기대.
- **Q5. 기존 `GATE_RETRY_LIMIT` 상수 제거 vs deprecated alias 유지** — 현 스펙: 제거. 반대 의견: 외부 consumer (예: `harness` CLI 를 node 모듈로 import 하는 third-party) 가 있을 수 있다. 현 구조상 그럴 가능성은 매우 낮지만, Phase 2 가 "API 안정성 차원에서 한 버전은 alias 로 유지" 를 요구하면 deprecation JSDoc + 다음 메이저에서 제거로 타협 가능.

---

## Appendix A — 3 안 비교표

| 축 | Option 1 (scope signal) | Option 2 (static ADR-4 relax) | Option 3 (retry++) |
|---|---|---|---|
| 해결 범위 | impl REJECT 의 cycle cost | impl+design REJECT 공통 P5 땜빵 | REJECT 근본 원인 해결 X, budget 확장 |
| False positive 리스크 | Codex 오분류 시 design 이슈를 P5 에서 땜빵 | 100% (모든 design REJECT 을 P5 에서 땜빵) | N/A (분기 없음) |
| 구현 난이도 | 중간 (contract + parser + runner 분기) | 낮음 (한 줄 분기) | 낮음 (helper) |
| 기존 동작 보존 | fallback 경로 있음 (scope 누락 → mixed) | 없음 (동작 강제 변경) | 완전 보존 |
| 직교성 | 1/3 조합 가능 | 1/3 조합 시 의미 없어짐 | 1/2 와 조합 가능 |

**결론**: Option 1 + Option 3 (본 스펙). Option 2 는 Option 1 의 열등 변종이므로 기각.

---

## Appendix B — 파일별 변경 요약

| 파일 | 변경 |
|---|---|
| `src/context/assembler.ts` | `REVIEWER_CONTRACT_BASE` 에 "Scope tagging" stanza 추가 |
| `src/phases/verdict.ts` | `parseVerdict` 반환 타입에 `scope?: Scope` 추가 + 정규식 |
| `src/phases/runner.ts` | `handleGateReject` 의 light+gate7+scope=impl 분기; `GATE_RETRY_LIMIT` → `getGateRetryLimit(state.flow)` |
| `src/config.ts` | `GATE_RETRY_LIMIT_FULL` / `GATE_RETRY_LIMIT_LIGHT` / `getGateRetryLimit` export; 기존 `GATE_RETRY_LIMIT` 제거 |
| `src/types.ts` | `Scope` 타입 export + `GateOutcome.scope?` 필드 |
| `tests/phases/verdict.test.ts` | R6 unit 케이스 |
| `tests/config.test.ts` | R6 getGateRetryLimit 케이스 |
| `tests/phases/runner.test.ts` | R6 integration 케이스 |
| `tests/context/assembler.test.ts` | snapshot (있으면 갱신) |
| `CLAUDE.md` | issue 표기 |
| `docs/HOW-IT-WORKS.md` | Light Flow 섹션 한 문장 |
