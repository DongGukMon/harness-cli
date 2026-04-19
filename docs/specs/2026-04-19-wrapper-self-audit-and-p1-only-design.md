# Wrapper-skill pre-sentinel self-audit + P1-only feedback triage — Design

- Status: Draft (Phase 1 / harness-cli) — Round 5 Codex P1 피드백 반영 (R5: 2 P1 해소 + 2 P2; R4: 3 P1 + 1 P2; R3: 2 P1 + 2 P2; R2: 3 P1 + 1 P2; R1: 1 P0 + 3 P1 + 2 P2)
- Date: 2026-04-19
- Author: Claude Code (자율 모드)
- Related followups: `~/.grove/github.com/DongGukMon/harness-cli/worktrees/gate-convergence/FOLLOWUPS.md` §P1.2, §P1.3
- Target branch: `feat/wrapper-self-audit` (worktree: `wrapper-self-audit`)
- Scope key: T3 (self-audit) + T4 (P1-only triage)

### Round 5 fix 요약 (2026-04-19)

- **P1.1 (baseCommit 빈값 edge)**: Phase 5 self-audit 텍스트 + R3에 빈 문자열 감지 시 graceful degrade (warn + skip + proceed) 명시. 근본 fix는 `startCommand`/preflight 범위로 `## Deferred` §10에 기록. SC21 가드 추가.
- **P1.2 (`checks[].command` 계약)**: R3 + Phase 5 텍스트에 원천 (a) spec grep/regex = **실행** vs 원천 (b) plan `checks[].command` = **inspect-only (실행 금지, 정적 커버리지 검토만)** 분리 명시. 실제 실행은 Phase 6 verify 전속. SC20 가드 추가.
- **P2 (unlabeled + structural 충돌)**: `## Deferred` §9에 기록 — plan phase에서 R4 문구 정리.
- **P2 (R3a SC17→SC18 typo)**: 인라인 수정.

### Round 4 fix 요약 (2026-04-19)

- **P1.1 (baseCommit runtime lookup)**: R3 + Phase 5 self-audit 텍스트에 `jq -r .baseCommit .harness/{{runId}}/state.json` 읽기 절차 명시. `assembler.ts` 변경 없이 skill-only 범위 유지. SC17 가드 추가.
- **P1.2 (self-audit 발견 비구현성 이슈 처리)**: R3a 신규 — Phase 5 self-audit step이 "impl-only fix 불가 hit" 경로에서도 plan `## Deferred` append를 허용. feedback 블록과 독립적 경로로 명시. Phase 1/3는 대상이 자기 artifact이므로 별도 escalation 불필요. SC18 가드 추가.
- **P1.3 (reviewer 태그 해석 계약)**: Decision 4a + Non-goals + Phase 5 triage 프롬프트에 "`spec-bug:`/`plan-bug:` = informational signal, gate 자동 완화 없음" 명시. 후속 reviewer rubric 업데이트 PR에서 의미 부여. SC19 가드 추가.
- **P2 (Phase 1/3 단일 feedback 파일)**: spec `## Deferred` §8에 기록 — plan phase에서 R4 invariant 문구로 반영.

### Round 3 fix 요약 (2026-04-19)

- **P1.1 (baseCommit..HEAD vs Gate 7 three-dot)**: Phase 5 self-audit 범위를 `git diff baseCommit...HEAD` (three-dot)로 변경. Gate 7 non-external path `assembler.ts:287` 문자열과 동일. externalCommits 분기는 Phase 5 self-audit 시점에 발생 불가능하므로 제외 (Decision 2 rewrite).
- **P1.2 (Phase 5 P2 inline-fix 범위)**: R5 + Phase 5 triage 프롬프트에서 P2 inline fix 범위를 `src/`, `tests/` 등 Phase 5 worktree 구현 파일로 한정. spec/plan 본문이나 eval checklist에 대한 P2 comment는 라인 수 무관하게 `## Deferred` 경로 사용.
- **P2 items**: spec `## Deferred` §6 (Goal #4 wording unify), §7 (carryoverFeedback test case) 추가 — plan 단계에서 반영.

### Round 2 fix 요약 (2026-04-19)

- **P1.1 (Deferred fallback)**: R4a 신규 요건 + 세 phase 프롬프트에 "섹션 없으면 파일 끝에 새로 만들고 append" 문장 명시 + SC15 가드 추가.
- **P1.2 (Phase 5 plan/checklist-origin P1)**: R5를 3-way로 확장 — (a) impl-only fix, (b) spec-bug escalation, (c) plan-bug escalation. 구현 수정 불가 P1은 전부 plan doc `## Deferred` append. SC16 가드 추가.
- **P1.3 (stale baseline)**: Goals #5 · SC2에서 고정 숫자(617) 의존 제거. "회귀 없음 + 순증만" 기준으로 재정의.
- **P2 (commit message inconsistency)**: P1.2 fix 과정에서 in-situ 해소 — 세 escalation 카테고리 모두 `plan: append deferred item` 단일 커밋 메시지 사용, 분류는 본문 태그로.

## Context & Decisions

### 왜 지금

`gate-convergence/FOLLOWUPS.md` dogfood-full 관측 결과:

- **P1.2**: gate reject 5건 중 2건은 implementer가 작성한 artifact를 자기 자신이 spec의 machine-checkable success-criterion(예: grep `except Exception`)으로 한 번만 재검증했다면 pre-sentinel에서 잡을 수 있었다. 각 gate round ≈ 40× local grep 비용.
- **P1.3**: repo CLAUDE.md + 전역 메모리에는 "gate에서 P1만 처리, P2는 TODO" 정책이 있지만, **wrapper skill prompt에 전달되지 않는다.** 현재 wrapper는 "Previous gate feedback (반드시 반영)"이라고만 지시하므로 Claude가 P1+P2를 모두 blocking으로 처리하고, P2-driven restructuring이 새 P1 불일치를 유발하는 회귀 패턴이 관찰됨.

두 이슈 모두 wrapper skill 텍스트 한 구간씩 추가하면 해결 가능. 런타임/상태 변경은 필요 없다.

### 설계 결정 (rationale)

**결정 1 — Self-audit은 Process step, 아니라 Invariant**
- 기존 Process 마지막 step은 sentinel 생성. self-audit을 sentinel 바로 앞 step(= N-1)으로 삽입하고, sentinel은 step N으로 그대로 둔다. Invariant 섹션은 "sentinel 이후 추가 작업 금지" 문구 그대로 유지 — `tests/context/skills-rendering.test.ts:95`의 `sentinel.*추가 작업 금지` 매치 보존 필요.
- 고려된 대안: Invariants에 "self-audit 필수" 추가. 기각 — Invariants는 "하지 말아야 하는 것" 위주여서 능동적 검증 루틴은 Process에 더 적합. 또한 Process로 넣어야 Claude가 "grep 돌리기"를 순서상 수행한다고 해석하기 쉬움.

**결정 2 — Self-audit 대상이 phase마다 다름**
- Phase 1: 방금 작성한 spec 본문을 spec 자신의 success-criteria/invariants 섹션과 대조 (implementer == spec author라는 구조상 동일 artifact 내 self-consistency 체크).
- Phase 3: 방금 작성한 plan 본문을 **spec**의 success-criteria/invariants 섹션과 대조 (plan이 spec을 모두 커버하는지). plan의 eval checklist도 spec의 grep-rule을 포함하는지 별도 체크.
- Phase 5: **구현 커밋 diff + tracked files**를 `spec의 ## Success Criteria / ## Invariants 섹션에 명시된 grep/regex 규칙` + `plan의 eval checklist checks[].command (이미 shell-executable)`와 대조. Phase 5에서는 단일 artifact가 아니라 여러 커밋의 합집합이 검증 대상이므로 표현을 달리 한다.
- **Phase 5 commit 범위 pin**: `git diff baseCommit...HEAD` (three-dot). Gate 7 non-external path (`buildPhase7DiffAndMetadata` line 287)의 `git diff ${baseCommit}...HEAD`와 **문자열까지 동일하게** 맞춘다. Phase 5 self-audit은 Phase 5 실행 중에만 돌고, 그 시점에는 정의상 external commit이 존재할 수 없다 (external commit은 Phase 5 done 이후 HEAD가 추가 전진한 경우를 Gate 7 진입 시 감지하는 개념). 따라서 externalCommitsDetected 분기는 self-audit 관점에서 발생 불가능 경로이며, 본 PR의 self-audit 대상은 Gate 7 non-external path와 1:1 대응한다. Phase 5가 `skip` 된 시나리오는 self-audit 자체가 실행되지 않으므로 범위 논의 밖이다. `baseCommit..HEAD` (two-dot) 나 `implRetryBase..HEAD`는 선택하지 않음.

**결정 3 — P1-only triage 블록은 조건부 렌더에만 존재**
- `{{#if feedback_path}}` (phase 1/3) 또는 `{{#if feedback_paths}}` (phase 5) 조건문 내부에 배치. 첫 pass(retry가 아닌)에서는 rendering되지 않아야 함 — P1-only triage는 gate feedback에 대한 정책이지 최초 작성 지침이 아니기 때문.
- 구현 상: wrapper 본문의 feedback 조건부 블록에 새 문장을 추가하면 assembler의 기존 `renderTemplate` two-pass 렌더가 자동 처리. 추가 로직 불필요.

**결정 4 — Phase 5는 spec/plan re-structuring 명시 금지**
- dogfood 관측: P2-driven restructuring이 새 P1 불일치 유발. Phase 5는 implementation phase이므로 P1 fix가 spec/plan 수정을 요구한다고 판단되면 gate에 그 판단 자체를 올리고, 구현 쪽은 규정된 채널에 기록한다. 채널은 아래 "결정 4a".
- 고려된 대안: Phase 5 retry에서도 P1은 무조건 반영. 기각 — 실제 spec/plan bug면 Phase 5 재구현이 더 큰 노이즈를 만든다. 다음 round에서 gate 리뷰어가 명시적으로 spec/plan 수정 요청한 경우만 P5 범위 이탈을 허용하고, 그 외에는 retry를 fail시키고 P1→P3 escalation을 따르는 것이 올바름.

**결정 4a — P2/deferred 기록 채널을 phase별로 고정 (P0 gate-1 fix)**
- 기존 문서 내 "artifact 없이 gate feedback", "`## Deferred`", "`TODO.md`" 혼재를 해소. **Gate 7 prompt는 `<spec>`, `<plan>`, `<eval_report>`, `<diff>`(= `git diff baseCommit...HEAD`, 커밋 메시지 미포함), `<metadata>`만 전달한다** (`src/context/assembler.ts:253-310`의 `buildPhase7DiffAndMetadata` 실측 확인). 따라서 reviewer에게 도달할 수 있는 채널은 `<spec>`/`<plan>`/`<eval_report>`/`<diff>` 내부 file-level 변경뿐이다.
- 채널 배정:
  - **Phase 1**: spec doc 하단 `## Deferred` 섹션 (자기 자신 수정).
  - **Phase 3**: plan doc 하단 `## Deferred` 섹션 (자기 자신 수정).
  - **Phase 5 P2 defer**: plan doc 하단 `## Deferred` 섹션에 **1-2 라인 append-only 추가** + 별도 `plan: append deferred item` 커밋. Phase 5는 plan 본문 재구조화 금지이지만 `## Deferred` 섹션 append는 "구조 변경"이 아닌 "기록" 이므로 허용.
  - **Phase 5 P1 spec-bug (spec/plan 재구조화 유발)**: plan doc 하단 `## Deferred` 섹션에 `spec-bug: <detail>` 1-2 라인 append + `plan: append deferred item` 커밋. Gate 7이 `<plan>` 블록에서 해당 줄을 읽어 reviewer 판단에 반영. 후속 round 또는 별도 plan 업데이트 phase에서 본격 재구조화.
  - **Phase 5 P1 plan-bug (plan 본문/eval checklist 자체 결함)**: plan doc 하단 `## Deferred` 섹션에 `plan-bug: <detail>` 1-2 라인 append + `plan: append deferred item` 커밋. 구현 변경 금지.
- 모든 세 카테고리(`spec-bug:`, `plan-bug:`, 일반 defer)가 동일한 커밋 메시지 `plan: append deferred item`을 공유한다. 분류는 append한 본문의 태그 prefix로 수행. 이는 커밋 메시지 policy의 단일성을 유지하면서 Gate 7 `<plan>` 블록 내 태그로 reviewer가 구분 가능하게 함.
- **Reviewer-side 태그 해석 계약**: `spec-bug:`/`plan-bug:` prefix는 **informational signal**이다. 본 PR은 `reviewerContractForGate7` / Gate 7 rubric을 변경하지 않으므로, reviewer가 태그 때문에 gate를 자동 완화하지 않는다. 태그는 (a) 문제 인지를 reviewer에게 넘기는 channel, (b) 후속 plan-update phase 또는 reviewer contract 업데이트 PR에서 의미를 부여할 수 있는 marker 로만 동작한다. 따라서 태그 append 후에도 Gate 7이 REJECT할 수 있고, 그 경우 정규 gate-retry 경로(또는 후속 spec-bug 해소 PR)로 처리된다. 이 명시는 Round 4 P1 피드백 반영.
- `## Deferred` 섹션이 artifact에 없을 경우 파일 끝에 새 헤딩으로 생성한 뒤 append (R4a 참조).
- "커밋 메시지 trailer" 채널은 **Gate 7 prompt가 커밋 메시지를 읽지 않으므로 무효**. 이 PR에서는 사용 금지. 다만 `git log` 추가는 §Deferred의 후속 항목으로 append.
- 근거: Gate 7 입력 계약을 건드리지 않으면서 "skill-only" 스코프 유지. plan doc `## Deferred` 섹션 append는 이미 Phase 3 채널과 동일한 규칙을 재사용하므로 reviewer 인지 부담도 낮다.

**결정 5 — assembler stanza 주입은 이번 PR 범위 밖(deferred)**
- skill-only 수정이 충분한지 먼저 관측. 다음 dogfood round에서 effect 측정 후 stanza 필요성 재평가. 이번 설계 본문의 §Deferred에 사유와 trigger 조건을 남겨둔다.
- 고려된 대안: 지금 함께 주입. 기각 — two-pass 렌더가 이미 wrapper를 inline하므로 skill 텍스트만으로도 Claude 프롬프트에 도달. stanza는 **skill 비활성 경로(light flow Phase 1/5)** 에만 추가 가치가 있는데, light flow는 단순 flow이므로 별도 검토 필요.

## Goals / Non-goals

### Goals

1. Phase 1/3/5 wrapper skill 각각에 **pre-sentinel self-audit step** 추가 (Process 끝-1 위치).
2. Phase 1/3 wrapper skill의 **feedback 조건부 블록에 P1-only triage 문장** 추가.
3. Phase 5 wrapper skill의 `{{#if feedback_paths}}` 블록에 **Phase 5 전용 P1-only triage** 추가 (spec/plan re-structuring 금지 명시).
4. assembler inline 경로(two-pass 렌더)를 통해 새 블록이 Claude 프롬프트에 실제 도달함을 snapshot/grep 테스트로 증명.
5. **기존 테스트 회귀 없음** — 현재 branch HEAD(`feat/wrapper-self-audit` @ `d9f2621` 시점 측정: `617 passed / 1 skipped`) 대비 fail 발생 없음, 새 테스트만 순증. 절대 숫자는 branch가 진행되면서 바뀔 수 있으므로 "회귀 없음 + 새 테스트 순증"이 기준이다.

### Non-goals

- `src/context/assembler.ts`에 별도 `<harness_feedback_policy>` stanza 주입 (deferred; §Deferred 참조).
- Phase 2/4/7 gate rubric 변경 — reviewer 쪽은 이번 PR에서 건드리지 않음. 따라서 `spec-bug:`/`plan-bug:` 태그는 reviewer가 **informational signal**로만 취급되며 gate 자동 완화는 없다 (Decision 4a 참조).
- Light flow (`phase-{1,5}-light.md`) 내부에 동일 규칙 복제 — 별도 경로이며 dogfood 관측도 full-flow 기준.
- `events.jsonl`에 P1-only 정책 이벤트 로그 추가 — 후속.
- phase-{1,3,5}.md thin-binding 템플릿 본문 변경 (prompt에서 금지된 영역).

## Requirements

### Functional

- **R1** — Phase 1 wrapper skill Process에 self-audit step 추가. 위치: 기존 sentinel step 바로 앞. 문구는 "방금 작성한 spec을 자기 자신의 success-criteria/invariants 섹션과 대조 (grep 또는 정규식 스캔)" 취지.
- **R2** — Phase 3 wrapper skill Process에 self-audit step 추가. 위치: 기존 sentinel step 바로 앞. 문구는 "방금 작성한 plan을 spec의 success-criteria/invariants와 대조. plan 내 eval checklist도 spec grep-rule 포함 여부 체크" 취지.
- **R3** — Phase 5 wrapper skill Process에 self-audit step 추가. 대상: `git diff $(baseCommit)...HEAD` (three-dot) + 해당 범위에서 변경된 tracked files. wrapper skill 문구는 `baseCommit` 값을 `.harness/{{runId}}/state.json`의 `baseCommit` 필드에서 `jq -r .baseCommit`로 읽어 사용하도록 지시한다 (assembler 변경 없이 runtime lookup — `{{runId}}`는 기존 interactive prompt var; `jq`는 preflight `src/preflight.ts:54`에 이미 포함됨). 빈 `baseCommit` 값 (초기 repo 엣지)은 **graceful degrade** — warn to stderr + skip self-audit + proceed to sentinel. 근본 fix는 `startCommand`/preflight 범위로 본 PR 밖. 검증 규칙 원천: (a) spec `## Success Criteria/## Invariants` 섹션 grep/regex **실행**, (b) plan eval checklist `checks[].command`의 **커버리지 정적 검토 (inspect-only, 실행 금지)**. `checks[].command` 실행은 Phase 6 verify 전속. 문구에 "단일 artifact가 아닌 commits 합집합" + "baseCommit...HEAD 범위 (Gate 7 non-external path `assembler.ts:287`와 문자열 동일)" + "state.json에서 baseCommit 읽기" + "빈값 degrade" + "inspect-only vs execute" 분리 명시.
- **R3a** — **Self-audit hit이 구현 수정으로 해결 불가능한 경우** (spec/plan 재구조화 필요 등): feedback 블록과 독립적으로, Phase 5 wrapper skill Process의 self-audit step이 다음 경로를 포함해야 한다 — "hit이 있는데 구현 수정만으로 해결 불가시 plan doc `## Deferred`에 `spec-bug: <detail>` 또는 `plan-bug: <detail>` 1-2 라인 append + `plan: append deferred item` 커밋을 수행한 뒤 정상적으로 sentinel 생성." (Phase 1/3는 self-audit 대상이 자기 자신 artifact이므로 별도 escalation 불필요 — 자기 artifact 수정 후 진행.) SC 가드: SC18 — `harness-phase-5-implement.md`에 self-audit 블록 내에 `해결 불가` 또는 유사 표현 + `## Deferred` 조합 존재.
- **R4** — Phase 1/3 wrapper skill의 `{{#if feedback_path}}` feedback 블록에 P1-only triage 3-tier 지침 추가 (P1 반드시, P2 ≤2-line inline or `## Deferred`, severity 누락은 blocker 가정).
- **R4a** — **`## Deferred` 섹션 부재 시 fallback**: R4/R5의 모든 "Deferred append" 지시는 대상 artifact(spec 또는 plan doc)에 `## Deferred` 헤딩이 **없으면 파일 끝에 새로 생성한 뒤 append**한다. 이 fallback 문장은 세 phase 모두의 P1-only triage 프롬프트 본문에 명시적으로 포함되어야 하며 rendering 테스트로 가드한다(SC15).
- **R5** — Phase 5 wrapper skill의 `{{#if feedback_paths}}` 블록에 P1-only triage 추가. 추가 조항: "**구현 전용 변경**으로 해결 가능한 P1만 Phase 5에서 반영한다. 다음은 모두 **plan doc 하단 `## Deferred` 섹션에 1-2 라인 append** + 별도 `plan: append deferred item` 커밋으로 escalation: (a) P2 defer, (b) spec/plan 재구조화가 필요한 P1 (`spec-bug: <detail>`), (c) plan 또는 eval checklist 자체 결함으로 인한 P1 (예: `checks[].command` 오류, 잘못된 regex) (`plan-bug: <detail>`). plan 본문 재구조화 금지 유지 — `## Deferred` append-only는 허용. **P2 inline fix 범위는 src/ · tests/ 등 Phase 5 worktree 구현 파일로 제한** — spec/plan 본문이나 eval checklist에 대한 P2 comment는 라인 수 무관하게 `## Deferred` append 경로를 사용한다."
- **R5a** — 다중 feedback 경로(`pendingAction.feedbackPaths` + `carryoverFeedback.paths`) 충돌 처리: "동일 쟁점이 서로 다른 severity로 중복될 때 highest severity wins, 동일 severity면 한 번만 반영." (`src/context/assembler.ts:368-391` 참조)
- **R6** — 모든 self-audit 문구에 "sentinel에 쓰기 직전" + "각 gate round ≈ 40× local grep 비용" 취지 포함 (이유 제시가 문구 유지에 효과적). **테스트 가드**: SC11-SC13에서 세 phase 모두 `sentinel` 단어와 `40× local grep` 문구 존재를 regex 검증.

### Non-functional

- **NF1** — 새 wrapper 블록 추가 후 `phase 5 prompt (largest)` 기준 총 프롬프트 크기가 60 KB 미만 유지 (`skills-rendering.test.ts:150`의 기존 가드).
- **NF2** — 기존 invariant 검증 regex(`sentinel.*추가 작업 금지`, `Open Questions`, `After each task completes, git commit` 등)가 계속 매치되도록 문구 보존.
- **NF3** — 추가 문장은 한국어 imperative 어조. 기존 wrapper skill 어조와 일관.
- **NF4** — TDD: 각 slice는 먼저 failing test → skill edit → green. Snapshot 대신 regex 기반 다중 assertion (기존 `skills-rendering.test.ts` 패턴과 일치).

## High-level Design

### 파일 수정 목록

| 파일 | 추가 내용 |
|---|---|
| `src/context/skills/harness-phase-1-spec.md` | Process step (sentinel 바로 앞) + feedback 조건부 블록에 P1-only triage |
| `src/context/skills/harness-phase-3-plan.md` | Process step + feedback 조건부 블록에 P1-only triage (plan→spec grep 포함) |
| `src/context/skills/harness-phase-5-implement.md` | Process step (diff/commits 대상) + feedback 조건부 블록에 P1-only triage (spec/plan re-structuring 금지) |
| `tests/context/skills-rendering.test.ts` | self-audit + P1-only 존재/부재 케이스 신규 테스트 |

### 텍스트 설계 — Phase 1/3 self-audit step

```
   (기존 step 3: 커밋) 다음
4. **Pre-sentinel self-audit** — sentinel 쓰기 직전, 방금 작성한 artifact를
   다시 읽고 spec(또는 plan)의 machine-checkable success-criteria/invariants
   에 대해 스스로 grep/검증한다. spec이 `## Success Criteria` / `## Invariants`
   / 유사 섹션에 정규식·grep 규칙을 명시했다면 **모두** 실행. hit이 있으면
   이번 pass에서 수정 — gate로 넘기지 말 것. 각 gate round ≈ 40× local grep 비용.
5. **가장 마지막에** `.harness/{{runId}}/phase-{N}.done`을 생성 ... (기존 step 4, 번호만 이동)
```

### 텍스트 설계 — Phase 1/3 P1-only triage (feedback 조건부 내부)

```
{{#if feedback_path}}
- Previous gate-N feedback (반드시 반영): @{{feedback_path}}

  **Feedback triage (P1-only 정책)** — 각 comment에 대해:
  1. **P1 (blocker)**: 반드시 반영.
  2. **P2**: inline 반영이 ≤2 라인 edit이면 지금 수정. 그 외엔 artifact의
     `## Deferred` 섹션에 항목으로 기록 후 진행. **P2가 구조 변경을 유발
     하면 거부** — 이번 gate는 P2로 rerun하지 않음.
  3. **severity 라벨 누락된 comment**: blocker 가정(보수적). 단 reviewer가
     P1으로 명시한 항목만 구조 변경을 정당화.

  `## Deferred` 섹션이 artifact에 **없으면 파일 끝에 `## Deferred`
  헤딩을 새로 만든 뒤** 1-2 라인 항목을 append한다.
{{/if}}
```

### 텍스트 설계 — Phase 5 self-audit step

```
   (기존 step 2) 다음
3. **Pre-sentinel self-audit** — sentinel 쓰기 직전:
   - `baseCommit` 값을 읽는다: `BASE=$(jq -r .baseCommit
     .harness/{{runId}}/state.json)`. **빈 문자열이면** (초기 repo에
     `startCommand`가 빈 `baseCommit`으로 세팅했을 엣지 — 정상 harness 진입
     경로에서는 미발생) `echo 'WARN: skip self-audit (empty baseCommit)' >&2`
     후 self-audit을 건너뛰고 sentinel 생성으로 진행. 실제 runtime 보장은
     `startCommand` + preflight 범위이며 본 PR에서 다루지 않는다.
   - 다음을 실행: `git diff "$BASE"...HEAD` (three-dot; Gate 7 non-external
     path `assembler.ts:287`와 문자열 동일) 및 그 범위에서 변경된 tracked
     files.
   - 검증 원천:
     - (a) spec의 `## Success Criteria` / `## Invariants` 섹션에 명시된
       grep/regex 규칙을 **실행** (예: `grep -rn "except Exception" src/`,
       `rg "pattern"`). Hit은 곧 violation이며 R3 본 경로에서 처리.
     - (b) plan의 eval checklist `checks[].command`을 **inspect-only**
       (실행하지 않음). plan 파일을 열어 `checks` 배열의 `command` 필드들이
       (a)의 grep/regex 규칙을 커버하는지 **정적 검토** — 누락된 rule이
       있으면 plan-bug escalation (R3a) 경로로 `plan: append deferred item`
       커밋. `checks[].command` 실행은 Phase 6 verify의 authoritative
       책임이며 self-audit은 중복 실행하지 않는다 (40× grep 비용 원칙 유지).
     - 대상은 단일 artifact가 아니라 이번 phase의 **commits 합집합**.
   - **hit이 구현 수정으로 해결 가능**: 이번 pass에서 수정 후 추가 커밋 —
     gate로 넘기지 말 것.
   - **hit이 구현 수정만으로 해결 불가능** (spec/plan 재구조화 필요): plan
     doc 하단 `## Deferred` 섹션에 `spec-bug: <detail>` 또는
     `plan-bug: <detail>` 1-2 라인 append (섹션 없으면 파일 끝에 새로 생성)
     + 별도 `plan: append deferred item` 커밋. 그 후 정상적으로 sentinel
     생성. Gate 7 reviewer가 `<plan>` 블록에서 해당 라인을 **참고용 signal**
     로 읽는다 (reviewer contract는 본 PR에서 변경되지 않으므로 자동 완화는
     없음 — 후속 reviewer rubric 업데이트 PR에서 의미 부여).
   - 각 gate round ≈ 40× local grep 비용.
4. 모든 태스크 구현 + 커밋 완료 후 **가장 마지막에** `.harness/{{runId}}/
   phase-5.done`을 ... (기존 step 3)
```

### 텍스트 설계 — Phase 5 P1-only triage (feedback 조건부 내부)

```
{{#if feedback_paths}}
- Previous feedback(s) — gate-7 또는 verify에서 온 (반드시 반영):
{{feedback_paths}}

  **Feedback triage (P1-only 정책 · Phase 5 전용)** — 각 comment에 대해:
  1. **P1 (blocker · impl-only fix)**: **구현 파일 변경만으로** 해결되면
     반드시 반영.
  2. **P2 (impl/worktree origin)**: 대상이 **구현 파일(src/, tests/ 등 Phase
     5 worktree 변경 범위)** 이고 ≤2 라인 inline fix로 해소되면 지금 수정.
     그 외(spec/plan 본문·eval checklist 등 artifact 원천 comment는 라인
     수 무관하게 포함)는 **plan doc 하단 `## Deferred` 섹션에 1-2 라인
     append** + 별도 `plan: append deferred item` 커밋. P2로 spec/plan 본문
     재구조화 금지. `## Deferred` append는 "구조 변경"이 아니라 허용.
  3. **severity 누락**: blocker 가정.
  4. **spec/plan 재구조화가 필요한 P1**: Phase 5 범위 밖. 구현 쪽은 그대로
     두고 plan doc의 `## Deferred` 섹션에 `spec-bug: <detail>` 1-2 라인을
     append → `plan: append deferred item` 커밋. 본격적 재구조화는 후속 plan
     업데이트 phase 책임. (커밋 메시지 trailer는 Gate 7 prompt에 포함되지
     않으므로 채널로 사용하지 않는다 — `assembler.ts:253-310`.) **태그는
     reviewer에게 informational signal로만 제공되며 gate 자동 완화는 없다**
     — Gate 7이 REJECT하면 정규 gate-retry 경로로 처리한다.
  4a. **plan 또는 eval checklist 자체 결함으로 인한 P1**: (예: 잘못된
     `checks[].command`, 맞지 않는 regex, 범위 오지정) 역시 Phase 5 범위 밖.
     plan doc의 `## Deferred` 섹션에 `plan-bug: <detail>` 1-2 라인을 append
     → `plan: append deferred item` 커밋. 구현 변경은 하지 않는다.
  5. **다중 피드백 충돌**: `pendingAction.feedbackPaths`와 `carryoverFeedback.
     paths`가 중복 제시될 수 있다. 동일 쟁점이 서로 다른 severity로 올라오면
     highest severity wins, 동일 severity면 한 번만 반영.

  세 escalation 카테고리(`spec-bug:`, `plan-bug:`, 일반 P2 defer) 모두
  plan doc 하단 `## Deferred` 섹션이 **없으면 파일 끝에 새로 만들고** 항목을
  append한다. 커밋 메시지는 세 카테고리 모두 `plan: append deferred item`
  으로 통일 — 내용 분류는 append한 본문 태그(`spec-bug:`/`plan-bug:`/defer)
  로 수행한다.
{{/if}}
```

### 테스트 설계

`tests/context/skills-rendering.test.ts`에 다음 describe 블록 추가:

```ts
describe('pre-sentinel self-audit (P1.2)', () => {
  it.each([1, 3, 5] as const)('phase %i — self-audit step present in Process', ...);
  it('phase 1 — self-audit references grep/success-criteria', ...);
  it('phase 3 — self-audit targets plan against spec', ...);
  it('phase 5 — self-audit targets commits/diff, not a single artifact', ...);
});

describe('P1-only feedback triage (P1.3)', () => {
  it.each([1, 3] as const)('phase %i — triage block absent when no feedback', ...);
  it.each([1, 3] as const)('phase %i — triage block present when feedback_path set', ...);
  it('phase 5 — triage block absent when no feedback', ...);
  it('phase 5 — triage block present when feedback_paths set', ...);
  it('phase 5 — forbids spec/plan re-structuring in retry', ...);
  it.each([1, 3, 5] as const)('phase %i — `## Deferred` fallback instruction present (SC15)', ...);
  it('phase 5 — `plan-bug:` escalation category present (SC16)', ...);
});
```

state stub에 `pendingAction: { feedbackPaths: ['path/to/feedback.md'] }`를 주입해서 feedback이 있는 케이스를 시뮬레이션.

## Open Questions

1. **Phase 5 self-audit이 추가 커밋을 유발하면, `implCommit` 상태 업데이트는 어떻게 되는가?**
   - 현재 `validatePhaseArtifacts`는 `git status --porcelain`이 empty인지 확인. self-audit으로 발견한 문제를 수정하면 새 커밋이 생기고, 그 커밋은 Phase 7 eval diff에 포함된다. 별도 state 변경 불필요. 대응: "self-audit fix 커밋도 정규 커밋 절차 준수" 한 줄 추가.
2. **P2 항목의 기록 채널 — phase 별로 한 곳만? (Decision 4a로 해소)**
   - 해소됨: Phase 1 → spec doc `## Deferred`, Phase 3 → plan doc `## Deferred`, Phase 5 → **plan doc `## Deferred` 섹션 append** + 별도 `plan: append deferred item` 커밋. 커밋 메시지 trailer는 Gate 7에 도달 불가로 채널로 쓰지 않는다.
3. **severity 라벨 누락 comment의 "blocker 가정" 정책이 gate feedback parser와 충돌하지 않는가?**
   - gate feedback은 markdown comment이고 Claude가 읽어서 라벨을 해석하므로 parser 레이어 없음. Claude 해석만으로 정책 적용 가능. 대응: 이대로 진행.
4. **Group A PR과의 충돌 — Phase 5 Process step 번호 변경이 있을 때?**
   - Group A는 step 0(prepend)을 추가. 이번 PR은 step N-1(append)을 추가. 번호 충돌 없음. Rebase 충돌시 trivial. 대응: prompt 지시에 따라 별도 step으로 분리 유지.
5. **assembler stanza 주입 후속의 trigger 조건은?**
   - 다음 dogfood-full 라운드에서 gate reject 비율이 P1.2 개선분(~40% 감소 기대)에 도달하지 못하면 stanza 추가 고려. (현 skill-only 효과 측정 후 follow-up.)
6. **Gate 7 prompt가 커밋 메시지를 포함하는지? (해소됨)**
   - 실측: `buildPhase7DiffAndMetadata`는 `git diff baseCommit...HEAD`만 호출하므로 커밋 메시지는 Gate 7 prompt에 **포함되지 않는다**. 따라서 P5 escalation 채널은 "커밋 메시지 trailer"가 아니라 "plan doc `## Deferred` 섹션 append"로 재설계됨 (결정 4a). `git log` 주입은 §Deferred의 후속 항목으로 append (필요 시 Phase 5 커밋 메시지 기반 P3 후속 feedback 이벤트 로깅까지 확장 가능).

## Success Criteria

### Machine-checkable (Phase 6 verify 대상)

- **SC1** — `pnpm tsc --noEmit` passes.
- **SC2** — `pnpm vitest run`: **기존 테스트 회귀 없음**, 새 테스트는 이 PR이 순증만 추가. 절대 baseline은 branch HEAD 기준이며 고정 숫자로 검증하지 않는다 (측정 시점에 따라 상이 — `d9f2621`에서 617 passed / 1 skipped 관측, PR 머지 시점에 재측정).
- **SC3** — `pnpm build` OK (assets copy 포함).
- **SC4** — grep test: `src/context/skills/harness-phase-1-spec.md`에 `Pre-sentinel self-audit` 문자열 존재.
- **SC5** — grep test: `src/context/skills/harness-phase-3-plan.md`에 `Pre-sentinel self-audit` 존재.
- **SC6** — grep test: `src/context/skills/harness-phase-5-implement.md`에 `Pre-sentinel self-audit` 존재.
- **SC7** — grep test: `src/context/skills/harness-phase-1-spec.md`에 `P1-only 정책` 존재.
- **SC8** — grep test: `src/context/skills/harness-phase-3-plan.md`에 `P1-only 정책` 존재.
- **SC9** — grep test: `src/context/skills/harness-phase-5-implement.md`에 `P1-only 정책` + `Phase 5 전용` 존재.
- **SC10** — grep test: `src/context/skills/harness-phase-5-implement.md`에 `spec/plan 재구조화` 문구 존재 (P5 전용 조항).
- **SC11** — grep test: 세 phase wrapper(`harness-phase-{1,3,5}-*.md`) 모두에 `40× local grep` 문구 존재 (R6 rationale 가드).
- **SC12** — grep test: 세 phase wrapper 모두에 `sentinel` 단어 존재 + self-audit 블록 직전 라인에 "sentinel" 어휘 포함 (R6 timing 가드).
- **SC13** — grep test: `harness-phase-5-implement.md`에 `baseCommit...HEAD` (three-dot) 문자열 존재 (Phase 5 commit range pin 가드 — Gate 7 non-external path `assembler.ts:287`과 문자열 일치).
- **SC14** — grep test: `harness-phase-5-implement.md`에 `spec-bug:` + `## Deferred` 문자열 존재 (Phase 5 escalation 채널 가드 — plan doc Deferred 섹션 append 경로).
- **SC15** — grep test: 세 phase wrapper(`harness-phase-{1,3,5}-*.md`) 모두에 `없으면` + `파일 끝` + `## Deferred` 문자열 조합 존재 (R4a `## Deferred` 부재 fallback 가드 — P1.1 Round 2 fix).
- **SC16** — grep test: `harness-phase-5-implement.md`에 `plan-bug:` 문자열 존재 (R5 Round 2 fix — plan/checklist 결함 escalation 카테고리 가드).
- **SC17** — grep test: `harness-phase-5-implement.md`의 self-audit 섹션(line 기준 근접 문맥)에 `state.json` + `baseCommit` 조합 존재 (R3 Round 4 fix — baseCommit runtime lookup 가드).
- **SC18** — grep test: `harness-phase-5-implement.md`에 `해결 불가` + `## Deferred` 또는 의미상 동등한 문구 존재 (R3a Round 4 fix — self-audit 발견 비구현성 이슈 escalation 경로 가드).
- **SC19** — grep test: `harness-phase-5-implement.md`에 `informational signal` 또는 `자동 완화` 키워드 존재 (Decision 4a Round 4 fix — reviewer 해석 계약 명시 가드).
- **SC20** — grep test: `harness-phase-5-implement.md`에 `inspect-only` 또는 `실행 금지`/`실행하지 않음` 키워드 존재 (R3 Round 5 fix — `checks[].command` 정적 검토 계약 가드).
- **SC21** — grep test: `harness-phase-5-implement.md`에 `empty baseCommit` 또는 `빈 baseCommit`/`WARN: skip self-audit` 키워드 존재 (R3 Round 5 fix — graceful degrade 경로 가드).

### Invariants (회귀 금지)

- **INV1** — `sentinel.*추가 작업 금지` regex 매치 유지 (기존 test).
- **INV2** — phase 5 prompt length < 60 KB (기존 NF1).
- **INV3** — `Open Questions` 문자열 phase 1 prompt에서 ≥2 hit 유지 (기존 test).
- **INV4** — BUG-B regression guard 유지: `HARNESS FLOW CONSTRAINT`, `advisor()`, `독립 reviewer` 3개 문자열이 phase 1/3/5 prompt에 모두 존재.
- **INV5** — 첫 pass(feedback 없을 때) 렌더에 P1-only triage 블록이 **없어야** 한다.

## Deferred (다음 PR 후보)

1. **assembler `<harness_feedback_policy>` stanza 주입** — skill-only 효과 측정 후 결정. trigger: 다음 dogfood-full에서 P1.3 증상 (P2-driven restructuring이 새 P1 유발) 재발 시.
2. **Light flow 템플릿(`phase-{1,5}-light.md`)에 동일 규칙** — full flow에서 효과 검증 후 이식.
3. **`events.jsonl`에 `feedback_triage` 이벤트** — P1-only 정책 적용 빈도 관측 지표. prompt의 Out of scope에 명시됨.
4. **Phase 5 self-audit "auto-fix" 허용 여부** — 현재 명시적 수정 + 커밋. 자동화 검토는 별도.
5. **Gate 7 prompt에 `git log baseCommit..HEAD --format` 섹션 추가** — 커밋 메시지를 reviewer에게 직접 전달해 P5 escalation을 plan doc 변경 없이 할 수 있게 함. 현재는 plan doc `## Deferred` append로 우회. trigger: plan doc touch-every-phase가 spec coherence에 해가 된다는 관측.
6. **Goal #4 wording vs NF4 정합성** (Round 3 P2) — Goal #4는 "snapshot/grep 테스트" 표현이고 NF4는 "Snapshot 대신 regex 기반 다중 assertion"이다. Plan 작성 시 NF4 문구로 통일 (Goal #4를 "regex-based rendering/grep tests"로 rewrite). spec 자체는 지금 수정하지 않고 plan 작성 단계에서 해소.
7. **Phase 5 rendering test에 carryoverFeedback 경로 포함** (Round 3 P2) — 현 테스트 설계 stub은 `pendingAction.feedbackPaths`만 시뮬레이션하지만 실 prompt는 `pendingAction.feedbackPaths + carryoverFeedback.paths` 머지 경로와 missing file drop 로직(`assembler.ts:368-391`)을 거친다. 추가 테스트 케이스: `pendingAction + carryoverFeedback(일부 missing)` 두 경로 동시 세팅 시 triage 블록이 정상 렌더되는지 검증. Plan slice 3 또는 5에 추가.
8. **Phase 1/3 feedback 단일 파일 invariant 명시** (Round 4 P2) — assembler는 `pendingPaths + carryoverPaths`를 합친 뒤 Phase 1/3에는 첫 번째만 `feedback_path`로 전달한다 (`assembleInteractivePrompt` feedbackPath selection). spec은 현재 이 사실을 명시하지 않는다. Plan phase에서 R4에 "Phase 1/3는 feedback file 최대 1개 보장, 추가 파일은 Phase 5 머지 규칙(R5a) 대상이다" 한 줄 invariant 추가.
9. **Unlabeled comment + structural 충돌 명시** (Round 5 P2) — "severity 누락 → blocker 가정" 과 "reviewer가 P1으로 명시한 항목만 구조 변경 정당화" 가 충돌할 때의 처리가 미정의. Plan phase에서 "severity 누락 & structural fix 필요 → `## Deferred` append (P1 구조변경 패스와 동일), 재구조화 금지" 한 줄 명시.
10. **startCommand/preflight의 baseCommit 빈값 근본 fix** (Round 5 P1.1 반영) — `startCommand`가 `getHead()` 실패 시 `baseCommit = ''`을 저장하는 경로와 preflight가 `git`/`head`를 보장하지 않는 문제. 본 PR은 self-audit 쪽 graceful degrade만 제공. 근본 fix는 별도 PR로 preflight에 `git` + `HEAD 존재` 체크 추가 + startCommand 검증 강화.

## References

- `CLAUDE.md` (project) — "## 실행 모드 defaults" 섹션
- `~/.claude/CLAUDE.md` (global) — `harness-lifecycle` 섹션
- `../gate-convergence/FOLLOWUPS.md` L44–78 — P1.2 + P1.3 근거
- `../gate-convergence/observations.md` — dogfood-full 관측
- `src/context/assembler.ts:358-423` — `assembleInteractivePrompt` two-pass 렌더 로직
- `tests/context/skills-rendering.test.ts` — 기존 wrapper inline 테스트 패턴
