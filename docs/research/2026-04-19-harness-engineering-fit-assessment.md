# Research: "Harness Engineering — From CC to AI Coding" 적용 평가

- 작성일: 2026-04-19
- 원문: https://zhanghandong.github.io/harness-engineering-from-cc-to-ai-coding/ (Zhang Handong)
- 대상 시스템: `harness-cli` (이 repo, 7-phase pipeline)
- 협업: Web 1차 정독(Claude) → Codex CLI(`whip` task `59e0fe5c`, hard / sandbox) 비평 → 본 문서로 통합
- 검증 근거: Codex가 src/ 정적 분석으로 인용한 file:line은 spot-check로 일치 확인 (`src/state.ts:133-189` 등)

## TL;DR

원문은 30장 분량의 "Claude Code 소스를 교과서로 삼아 일반 AI 코딩 에이전트를 만드는 법" 서적이다. 11개 핵심 클레임을 추출해 harness-cli 코드와 일대일로 대조한 결과:

- **harness-cli는 일반 agent loop가 아니라 phase pipeline orchestrator라는 정체성이 더 선명해졌다.** 따라서 원문이 강조하는 무거운 mechanism(auto-compression, micro-compression, subagent runtime, CLAUDE.md stack)은 대부분 우리 포지셔닝과 어긋난다.
- **반면 prompt engineering / token budgeting / retry intelligence / lineage latching / observability 영역은 우리가 구조적 약점을 갖고 있고 직접 적용 가치가 크다.**
- 채택 1순위는 **Claim 11(harness-layer 6단)** + **Claim 2(sectioned prompt)** — 두 개를 합치면 "prompt manifest" 추상이 자연스럽게 나온다.

---

## 1. 원문 구조 요약 (1차 정독)

7부 30장 구성. 핵심 chapter pointer만:

| Part | 챕터 | 키워드 |
|---|---|---|
| 1 아키텍처 | ch1 (TS+Ink+Bun, 1,884 files), **ch3 Agent Loop** (앵커) | parallel prefetch, dual feature flags(89개), "On Distribution" |
| 2 프롬프트 | ch5 sectioned system prompt | `systemPromptSection()` vs `DANGEROUS_uncached…`, dynamic boundary |
| 3 컨텍스트 | ch9 auto-compress, ch11 micro-compress, ch12 token budget | 5단 파이프라인 |
| 4 캐시 | ch13 architecture, ch14 break detection, ch15 optimization | sticky-on latching, MCP→org scope downgrade |
| 5 보안 | ch16~19 권한/YOLO/Hooks/CLAUDE.md | 26 events × 4 hook types, 4-level memory stack |
| 6 고급 | ch20 subagent (Standard/Fork/Coordinator), ch21 effort/thinking | AsyncLocalStorage, ultrathink keyword |
| 7 교훈 | **ch25 6원칙**, ch30 6 layers | prompts-as-control-surface, fail-closed, latch-for-stability |

추천 path A(에이전트 빌더): 1→3→5→9→20→25–27→30. 우리가 따르기엔 ch9·ch20을 건너뛰고 ch3·5·25·30만 깊이 보면 ROI가 가장 높다.

핵심 통찰 두 가지를 강조해 둔다:
- **"A loop is not a loop when every iteration reshapes the world it runs in."** (ch3) — Claude Code의 agent loop는 self-modifying state machine이다.
- **"prompt 변경에는 cache_creation 토큰으로 측정 가능한 비용이 따른다"** (ch25) — 프롬프트는 비용 청구되는 control surface다.

---

## 2. 11개 클레임 × harness-cli 적합도

| # | 클레임 | 현 상태 | Gap | 채택 |
|---|---|---|---|---|
| 1 | Agent Loop = self-modifying state machine, 7 continuation × 10 terminal × 5단 compaction | 부분 (state machine은 있음, compaction 파이프라인 없음) | 중 | ❌ 패키지로는 비채택, terminal reason taxonomy만 차용 |
| 2 | Sectioned prompt + static/dynamic boundary | **없음** | **대** | ✅ **TOP** |
| 3 | Auto-compression at 83.5% + 9-segment summary + PTL retry | 없음 (hard-cap만 있음) | 소 | ⚠️ deterministic diff summarizer만 |
| 4 | Micro-compression (LLM 미사용 stale tool-result purge) | 없음 | — | ❌ 비채택 |
| 5 | Cache sticky-on latching | **씨앗 있음** (preset lineage invalidation) | 중 | ✅ 확장 채택 |
| 6 | Subagent modes (Standard/Fork/Coordinator) | 없음 | — | ❌ 비채택 |
| 7 | Effort/thinking layered + auto-escalation | **부분** (preset에 effort 박혀 있음, 자동 escalation 없음) | 중-대 | ✅ 채택 |
| 8 | Hooks (26 events × 4 types × exit-code 2 contract) | 부분 (event logging만 강함, hook bus 없음) | 중 | ⚠️ narrow hook surface만 |
| 9 | CLAUDE.md 4-level priority stack | 없음 | — | ❌ 비채택 (CLI가 이미 가짐) |
| 10 | 6 lessons (prompt-control / cache-aware / fail-closed / A/B / observe-first / latch) | 절반 (prompt-control + observability + 좁은 latch는 이미 있음) | 중 | ⚠️ 운영 원칙으로만 채택 |
| 11 | 6 harness layers (constitution/budget/sandbox/defense/bounded-retry/observability-first) | **부분** (대부분 있으나 per-channel budget · 명시적 multi-layer 없음) | **대** | ✅ **TOP** |

각 항목 상세 (Codex 비평 본문, src 인용 그대로 보존):

### Claim 1 — Agent Loop 5단 compaction
> 부분만 이미 있다. 상태 머신 자체는 분명하다. `src/types.ts:41-90`이 상태 벡터를 고정하고, `src/phases/runner.ts:225-267`이 루프를 돌리며, `src/signal.ts:126-180`이 SIGUSR1로 currentPhase를 직접 바꾼다. 하지만 여기까지는 pipeline control plane이지 Claude Code식 agent loop가 아니다. 7 continuation point, 10 terminal reason, 5단 context compaction 파이프라인은 없고 실제 컨텍스트 처리는 `src/context/assembler.ts:212-249,355-412,570-576`의 하드 캡과 diff truncation 정도다. 결론은 전체 패키지로는 비채택, 다만 terminal reason taxonomy를 더 선명하게 남기는 정도만 가치가 있다.

### Claim 2 — Sectioned prompt + static/dynamic boundary
> 이건 아직 안 되어 있고, gap이 실제로 중요하다. 현재 prompt 조립은 `REVIEWER_CONTRACT_BASE`와 gate별 문자열을 그대로 이어 붙이고 `src/context/assembler.ts:19-110,178-210,545-549`에서 템플릿 치환만 한다. 즉 static rubric, semi-static lifecycle, volatile artifact body 사이의 경계가 코드 구조로 드러나지 않는다. harness-cli는 prompt engineering이 제품 표면이므로 채택 가치가 높다. **첫 단계: assembler에 section builder를 도입해서 invariant block과 volatile artifact block을 분리하고 각 section 이름과 byte size를 로그(events.jsonl)에 남긴다.**

### Claim 3 — Auto-compression
> 현재 구현은 auto compression이 아니라 hard limit enforcement다. `src/config.ts:81-84`에 file/diff/prompt cap이 있고 `src/context/assembler.ts:241-249,355-412,570-576`에 per-file diff truncation과 prompt oversize error만 있다. 9-segment summary template, context ratio trigger, PTL retry는 전혀 없다. 우리 scale에서는 full 채택 가치가 낮다. 대형 diff가 자주 터질 때 deterministic diff summarizer 정도면 충분하고, Claude Code식 compression loop까지 들이는 것은 과하다.

### Claim 4 — Micro-compression
> 없다. 있는 것은 stale **context** cleanup이 아니라 stale **run artifact** cleanup이다. `src/phases/runner.ts:95-109`와 `src/phases/gate.ts:185-188`은 gate sidecar를 지우고, `src/phases/interactive.ts:58-73`은 sentinel과 artifact를 초기화한다. pipeline 경계마다 새 prompt를 다시 조립하는 구조라 tool-result micro-compression의 ROI가 거의 없다. 명확히 비채택.

### Claim 5 — Cache sticky-on latching
> 좁은 형태로는 이미 있다. `GateSessionInfo`가 runner/model/effort/lastOutcome를 저장하고 `src/state.ts:133-189`와 `src/phases/gate.ts:197-222,321-359`가 preset lineage가 바뀌면 세션을 무효화하거나 유지한다. 즉 cache sticky latch는 없지만 retry lineage latch는 있다. 이건 harness 성격과 잘 맞으므로 선택적 채택. **첫 단계: gate session lineage에 sandbox, codexNoIsolate, flow 같은 request-affecting 값까지 포함해서 재현성을 더 강하게 고정.**

### Claim 6 — Subagent modes
> runtime에는 없다. subagent 관련 내용은 `src/context/skills/harness-phase-5-implement.md:39-44,53-57`에서 Phase 5 에이전트에게 하위 스킬을 쓸 수 있다고 지시하는 수준이고, harness runtime 자체가 Standard/Fork/Coordinator 모드를 관리하지 않는다. 이 gap은 우리 scale에서 문제가 아니다. 오히려 general coordinator를 넣으면 pipeline orchestrator와 agent runtime의 경계가 무너진다. 비채택.

### Claim 7 — Effort/thinking
> 부분 채택. `src/config.ts:15-44`가 phase preset 카탈로그에 model과 effort tier를 박아두고, `src/runners/claude.ts:65,91-95`와 `src/runners/codex.ts:56-63,192-200`이 실제 CLI 호출에 effort를 전달한다. 반면 adaptive budget, keyword escalation, env override 우선순위는 없다. 이 gap이 꽤 중요하다. **gate reject가 반복되어도 reasoning budget은 그대로라서 인간이 직접 preset을 바꾸기 전까지 harness가 똑똑해지지 않는다.** 채택 가치 높음. **첫 단계: Phase 2/4/7에서 reject 횟수나 diff size가 임계치를 넘으면 medium→high, 또는 더 긴 context preset으로 올리는 명시 규칙.**

### Claim 8 — Hooks
> event logging은 강하지만 hook platform은 없다. `src/types.ts:211-270`와 `src/logger.ts:144-253`을 보면 lifecycle event는 많고 잘 typed 되어 있다. 하지만 command/prompt/agent/http hook registry도 없고 exit code 2 block semantics도 없으며 per-execution trust gate는 preflight 일부 외에는 없다. full hook bus는 과하지만 narrow hook surface는 채택 가치가 있다. **첫 단계: gate와 verify spawn 직전·직후에 policy callback 한 층을 두고, block reason을 이벤트로 남기게 만든다.**

### Claim 9 — CLAUDE.md 4-level stack
> 없다. repo에 CLAUDE.md는 있지만 harness code가 instruction file stack을 읽거나 merge하지 않는다. 실제 prompt 조립은 `src/context/assembler.ts:178-195,545-549`의 템플릿 및 wrapper inlining뿐이고, CLAUDE.md 계층은 `src/context/playbooks/context-engineering.md:22-42`의 문서 조언일 뿐 runtime 기능이 아니다. 이 gap은 중요하지 않다. **Claude와 Codex 자체가 이미 rules file semantics를 갖고 있어서 harness가 그 위에 또 stack을 만들면 중복과 drift만 생긴다.** 비채택.

### Claim 10 — ch25 6 lessons
> 절반은 이미 맞고 절반은 없다. prompt를 control surface로 쓰는 방향은 `src/context/assembler.ts:19-110`과 wrapper skill들에서 이미 강하다. observe-before-fix도 `src/types.ts:211-270`와 `src/logger.ts:158-253` 덕분에 어느 정도 구현되어 있고, latch-for-stability도 `src/state.ts:133-189`의 preset lineage invalidation으로 좁게 존재한다. 하지만 explicit static/dynamic cache boundary와 feature-flag 실험 체계는 없다. 선택적 채택. **첫 단계: prompt assembly 전략과 retry policy를 feature flag로 분리하고 `phase_start` metadata에 어떤 전략이 쓰였는지 기록.**

### Claim 11 — ch30 6 harness layers
> 가장 pipeline fit이 좋다. 이미 static asset과 dynamic artifact injection 분리는 약하게 존재한다. `src/context/assembler.ts:178-210,524-549`가 wrapper와 runtime var를 합치고, `src/runners/codex.ts:53-63` 및 `src/phases/verify.ts:111-148`가 Codex sandbox와 bash verify lane을 분리한다. bounded retries와 force pass도 `src/config.ts:77-79`, `src/phases/runner.ts:601-679,1022-1104`에 구현되어 있고, observability-first도 `src/types.ts:211-270`와 `src/logger.ts:158-253`에서 강하다. 빠진 것은 per-channel budget과 더 명시적인 multi-layer constraints다. 채택 가치 매우 높음. **첫 단계: prompt manifest 구조를 도입해서 static constitution, dynamic artifact, byte budget, truncation policy를 한 객체로 노출하고 `phase_start` 또는 `gate_verdict`와 함께 기록.**

---

## 3. 최종 권고

### TOP 5 ADOPT (우선순위 순)

| 순 | 클레임 | 첫 단계 | 영향 영역 |
|---|---|---|---|
| 1 | **Claim 2 — Sectioned prompt** | `assembler.ts`에 `section(name, body, {static\|dynamic, bytes})` builder 도입, byte size를 `phase_start`/`gate_verdict`에 emit | `src/context/assembler.ts`, `src/types.ts` events |
| 2 | **Claim 11 — Prompt manifest (harness-layer 6단)** | static constitution + dynamic artifact + byte budget + truncation policy를 단일 manifest 객체로; manifest를 logging | 위와 동일, but 추상 한 단 위 |
| 3 | **Claim 7 — Retry-aware effort escalation** | gate reject ≥ N회 또는 diff size > threshold → preset auto-escalate (medium→high, 또는 long-context preset 전환); 이벤트로 escalation 사실 남기기 | `src/phases/gate.ts`, `src/config.ts`, `src/runners/*` |
| 4 | **Claim 5 — Lineage latch 확장** | `GateSessionInfo`를 `requestLineage` 구조로 확장 (sandbox, codexNoIsolate, flow까지 포함) → resume/reproducibility 강화 | `src/state.ts:133-189`, `src/phases/gate.ts` |
| 5 | **Claim 10 — Strategy as feature flag + observability** | prompt assembly 전략과 retry policy를 named flag로 분리; `phase_start.strategyFlags` 필드로 emit; A/B 비교 가능하게 | `src/types.ts`, `src/logger.ts` |

**의존성 메모:** 1 + 2는 사실상 한 PRD로 묶이고(2가 1의 상위 추상), 3·4·5는 1·2가 깔린 뒤에 따라온다. 따라서 다음 액션은 **Claim 2+11 합본 spec**부터.

### 3 DO NOT ADOPT

| # | 클레임 | 이유 |
|---|---|---|
| ❌ Claim 6 | Subagent runtime (Standard/Fork/Coordinator) | pipeline orchestrator와 agent runtime의 경계가 무너지고 failure surface만 폭증. 이미 Phase 5 wrapper skill이 "필요하면 하위 스킬 호출"로 충분. |
| ❌ Claim 9 | CLAUDE.md 4-level stack runtime | upstream Claude/Codex CLI가 이미 rules file semantics를 갖고 있음. harness가 그 위에 또 stack을 만들면 중복·drift만 생김. |
| ❌ Claim 4 | Micro-compression | long-running chat loop 최적화. 우리는 phase 경계마다 새 prompt를 만들기 때문에 ROI 사실상 0. |

---

## 4. 잔여 리스크 / Follow-up

- **실 데이터 부재:** 본 평가는 src 정적 분석 + 원문 정독 기반. 대형 diff·장문 spec에서 prompt budget이 실제로 얼마나 자주 압력받는지는 runtime profiling 필요. → Claim 2+11 spec 작성 시 첫 작업으로 "최근 90일 events.jsonl에서 prompt size 분포 측정" 추가 권장.
- **테스트 영향:** Codex가 `pnpm install --frozen-lockfile / lint / test (817 pass) / build` 모두 통과 확인. 이번 변경은 docs-only이므로 추가 검증 불필요.
- **다음 액션:** Claim 2 + Claim 11을 묶은 design spec 작성을 권장 (`docs/specs/2026-04-19-prompt-manifest-design.md` 가칭). 그 후 Claim 7·5는 retry/resume 안정화 트랙으로 합쳐 후속 처리.

---

## 5. 출처 / 협업 기록

- 원문: https://zhanghandong.github.io/harness-engineering-from-cc-to-ai-coding/
- 1차 정독 chapter: ch1, ch3, ch5, ch9, ch11, ch13, ch18, ch19, ch20, ch21, ch25, ch30
- Codex critique task: `whip task 59e0fe5c` (backend=codex, hard, review-gated, master-irc=`wp-master-harness-research`)
- Codex verification: `pnpm install --frozen-lockfile && pnpm lint && pnpm test && pnpm build` 모두 green
- File:line citation spot-check: `src/state.ts:133-189` (`invalidatePhaseSessionsOnPresetChange`) 일치 확인
