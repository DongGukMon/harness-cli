# harness-skills 합성 — Design Spec

- 상태: draft (design-only, 구현 미수행) — **rev 3** (wrapper-skill pivot, 2026-04-18)
- 작성일: 2026-04-18
- 담당: Claude Code (design), 구현자 미정
- 관련 문서:
  - Intent / Handoff: `docs/specs/2026-04-18-harness-skills-synthesis-INTENT.md`
  - Impl plan: (미작성 — 다음 세션에서 태스크 리스트업 + 리소스 분배 후 작성)
  - 생태계 참조: `~/.claude/skills/harness/SKILL.md`, `docs/specs/2026-04-14-claude-harness-skill-design.md`
  - 외부: [`addyosmani/agent-skills`](https://github.com/addyosmani/agent-skills) MIT, [`obra/superpowers`](https://github.com/obra/superpowers) (또는 현재 설치된 `claude-plugins-official` 패키지)

---

## 1. 배경과 목표

harness-cli는 7단계 파이프라인을 외부 런타임(tmux/lock/state.json)으로 강제하고, 이종 모델(Claude↔Codex) 게이트 + 결정론적 verify로 품질 하한선을 보장한다. 강점은 "도망갈 수 없는 구조"이지만 두 약점이 있다:

1. **단계 내부 의식(ritual)이 비어있음** — `src/context/prompts/phase-N.md`는 "무엇을 읽고 어디에 저장하라" 수준. 어떻게 브레인스토밍할지, 어떻게 계획을 쪼갤지, 어떻게 구현할지의 working discipline이 없음.
2. **게이트 리뷰 기준이 자유 서술** — `REVIEWER_CONTRACT`는 APPROVE/REJECT 포맷만 명시. 무엇을 볼지는 Codex 판단.

**기존 생태계 상태**:
- `/harness` 슬래시 커맨드(`~/.claude/skills/harness/SKILL.md`)는 이미 Phase 1/3/5에서 `superpowers:brainstorming`, `superpowers:writing-plans`, `superpowers:subagent-driven-development`를 런타임 prerequisite로 호출한다.
- `docs/plans/*.md` 헤더는 `superpowers:executing-plans` 또는 `superpowers:subagent-driven-development` 사용을 요구한다.
- 즉 **superpowers는 harness 생태계의 사실상 prerequisite**이다.

**문제**:
- `harness run` CLI 경로(슬래시 커맨드를 거치지 않고 직접 실행)에서는 superpowers 호출을 강제할 방법이 없다. Phase-N.md 프롬프트가 그냥 "구현하라"로 끝나므로 Claude가 superpowers를 안 써도 되고, 써도 harness 고유 출력 계약(sentinel 파일, `Context & Decisions` 섹션, checklist.json 스키마 등)을 모르고 쓸 수 있다.
- 반대로 슬래시 커맨드 경로에서는 superpowers를 호출하지만, 그 호출이 harness-specific 계약을 모른다. harness 스킬이 `"spec self-review 완료 후 'User reviews written spec' 단계를 건너뛰고..."` 같은 오버라이드를 텍스트로 전달하는 방식이라 결합이 느슨하다.
- **두 경로가 한 contract로 수렴하지 않는다**.

**목표 — rev 3 방향**:

**harness-cli에 fit한 neu wrapper 스킬 3종**(Phase 1/3/5 각각)을 신설한다. 각 스킬은:
1. harness-specific context(어느 게이트가 평가하는지, 출력 파일 경로, sentinel 규칙)를 announce한다.
2. 내부에서 대응 superpowers 스킬을 호출한다. 이때 harness-specific 오버라이드를 전달한다.
3. superpowers가 커버하지 않는 gap(context-engineering, git-workflow, 5축 루브릭 프리뷰)을 agent-skills 내용을 참고해 직접 주입한다.

결과:
- CLI 경로와 슬래시 커맨드 경로가 **같은 wrapper 스킬을 진입점으로** 쓴다 → 두 경로의 동작이 수렴
- superpowers 의존은 유지하되 호출이 **투명**해짐 (호출 위치/오버라이드가 명시적)
- harness 고유 contract가 **스킬 레이어에 인코딩**됨 (phase-N.md 프롬프트 문자열에 흩어져 있지 않음)

**비목표**:
- Phase 6 (`harness-verify.sh`) 변경 — 셸 결정론 평가 유지
- superpowers 자체 포크/재작성 — 외부 의존 유지 (Q5 결정)
- 도메인 스킬 주입 (frontend 등) — 향후 확장 후보
- Phase 2/4/7 Codex 게이트 동작 변경 — reviewer rubric 확장은 assembler.ts 레벨로 유지 (§6)

---

## 2. Context & Decisions

브레인스토밍과 rev-2, rev-3 단계에서 확정한 축. 이 표는 **다음 세션이 결정을 재현하기 위한 SSoT**다.

| Q | 질문 | 결정 | 근거 |
|---|---|---|---|
| Q1 | 이번 세션 산출물 범위 | **A — 설계 문서만** | 코드/스킬 본문 작성 없음. 다음 세션에서 태스크 리스트업 + 리소스 분배 후 구현 |
| Q2 | 합성 축 범위 | **B — Interactive + Gate** (Phase 1/3/5 + 2/4/7). 도메인 자동 선택(C) 제외 | rev-1 결정. rev-3도 유지 |
| Q3 | 플레이북 소비 방식 (v1) | ~~A (vendor 8개)~~ | rev-1 결정, rev-2에서 축소, rev-3에서 **폐기** (Q5로 대체) |
| Q4 | superpowers-agent-skills 공존 (rev 2) | 중복 제거 + 최소 vendor (2개) | rev-2 결정. 기준 3가지: 충돌 방지/외부 의존 최소화/병목 방지 |
| Q5 | **구현 전략 (rev 3)** | **중간안 — harness-native wrapper 스킬 신설 + 내부 superpowers 호출** | 세 기준을 더 강하게 충족. 풀 재작성 대비 작업비 ~1/3 |

### Q5 선택 근거 상세

세 기준 대비:

| 기준 | rev-2 (최소 vendor) | **rev-3 (wrapper)** | 풀 재작성 |
|---|---|---|---|
| 1. 충돌 방지 | 부분적 (위상 낮춘 보조 지침) | **거의 완전** (phase당 한 진입점) | 완전 |
| 2. 외부 의존 최소화 | superpowers 의존 유지 | superpowers 유지하되 호출 투명 | 의존 제거 |
| 3. 병목 방지 | 2개 playbook (~6-16KB) | 스킬 레이어가 orchestrate, prompt 증가 최소 | 스킬 본문에 따라 변동 |
| 작업 비용 | 낮음 | **중간** (스킬 3개, 각 100-200줄) | 높음 (각 300-500줄 + 테스트) |
| upstream 연결 | 유지 (vendor 파일) | 유지 (superpowers 호출) | 단절 |

**Q5 = 중간안**이 세 기준 + 작업 비용 + upstream 연결 다섯 축의 Pareto frontier에 있음. 풀 재작성은 "harness가 커뮤니티 생태계와 의도적으로 분기한다"는 전략적 판단이 있을 때만 정당화되는데 지금 그 증거가 없음.

### 원 vendor 2개의 처리 (rev-2 → rev-3)

rev-2에서 남긴 `context-engineering`, `git-workflow-and-versioning`은 rev-3에서 **wrapper 스킬이 참조하는 playbook 파일**로 유지한다 (§5 Directory layout 참조). 즉 wrapper 스킬이 2-hop 로딩:

```
phase-5.md  →  harness-phase-5-implement.md (wrapper skill)  →  playbooks/context-engineering.md
                                                            →  playbooks/git-workflow-and-versioning.md
```

이유: wrapper 스킬에 원문을 inline하면 upstream 연결이 끊긴다. 분리 유지하면 agent-skills가 개선될 때 파일만 교체해도 됨.

---

## 3. 아키텍처 — 3-layer

```
┌────────────────────────────────────────────────────────────────────┐
│  Layer A — Phase prompt (thin binding)                              │
│                                                                      │
│  src/context/prompts/phase-{1,3,5}.md                               │
│     "Invoke skill at @<...>/harness-phase-N-*.md. Context: {{...}}" │
│     - 기존보다 훨씬 짧음                                              │
│     - 변수 바인딩만 담당 (spec_path, plan_path, runId, sentinel 등)  │
└────────────────────────────────────────────────────────────────────┘
                                    │ @ 참조
                                    ▼
┌────────────────────────────────────────────────────────────────────┐
│  Layer B — harness wrapper skills (신설)                            │
│                                                                      │
│  src/context/skills/                                                 │
│    harness-phase-1-spec.md                                          │
│    harness-phase-3-plan.md                                          │
│    harness-phase-5-implement.md                                     │
│                                                                      │
│  각 스킬:                                                             │
│    - harness-specific context announce (게이트 루브릭 프리뷰)         │
│    - 대응 superpowers 스킬 호출 + override                           │
│    - 출력 계약 강제 (경로, sentinel, 섹션)                           │
│    - gap playbook 참조 (Phase 5만)                                  │
└────────────────────────────────────────────────────────────────────┘
                                    │ 호출 / @ 참조
                                    ▼
┌────────────────────────────────────────────────────────────────────┐
│  Layer C — 외부 자산 (변경 없음)                                     │
│                                                                      │
│  superpowers:brainstorming                                          │
│  superpowers:writing-plans                                          │
│  superpowers:subagent-driven-development / executing-plans          │
│                                                                      │
│  src/context/playbooks/ (vendor)                                    │
│    context-engineering.md                                           │
│    git-workflow-and-versioning.md                                   │
└────────────────────────────────────────────────────────────────────┘
```

**Gate 레이어 (Phase 2/4/7)**: `src/context/assembler.ts` 내 `REVIEWER_CONTRACT_BY_GATE` + `FIVE_AXIS_*` 상수로 인라인. 스킬 레이어 밖이다. Codex는 스킬을 invoke하지 않고 reviewer contract를 직접 읽음.

---

## 4. 신규 harness 스킬 3종 개요

| 스킬 | Phase | 입력 (harness 변수) | 출력 계약 | 호출하는 superpowers | 참조하는 playbook |
|---|---|---|---|---|---|
| `harness-phase-1-spec` | 1 | `task_path`, `spec_path`, `decisions_path`, `runId`, `phaseAttemptId`, `feedback_path?` | spec 파일 with "## Context & Decisions" 섹션, decisions.md, `.harness/<runId>/phase-1.done` (last) | `superpowers:brainstorming` | — |
| `harness-phase-3-plan` | 3 | `spec_path`, `decisions_path`, `plan_path`, `checklist_path`, `runId`, `phaseAttemptId`, `feedback_path?` | plan 파일, checklist.json (스키마 고정), `.harness/<runId>/phase-3.done` | `superpowers:writing-plans` | — |
| `harness-phase-5-implement` | 5 | `spec_path`, `plan_path`, `decisions_path`, `checklist_path`, `runId`, `phaseAttemptId`, `feedback_paths?` | 태스크별 git commit, `.harness/<runId>/phase-5.done` (last) | `superpowers:subagent-driven-development` (또는 `executing-plans`) | `context-engineering.md`, `git-workflow-and-versioning.md` |

---

## 5. 각 스킬 상세 설계 (skeleton)

각 스킬의 실제 본문은 **다음 세션의 구현 작업**. 여기서는 구조·책임·호출 순서만 명시.

### 5.1 `harness-phase-1-spec.md`

```
---
name: harness-phase-1-spec
description: Use during harness-cli Phase 1 to brainstorm and write a spec that passes the harness spec gate (Phase 2).
---

# harness Phase 1 — Spec writing

## Context
당신은 harness-cli 파이프라인의 Phase 1에 있다. 산출물은 Phase 2에서 Codex가
다음 축으로 평가한다:
- Correctness: 요구사항/비요구사항/경계조건/성공기준이 명시되었는가?
- Readability: 섹션 구성이 명확하고 모호한 표현이 없는가?
- Scope: 단일 구현 plan으로 분해 가능한 크기인가?

## Inputs
- Task spec: @{{task_path}}
- Previous feedback (있다면 반영): {{feedback_path}}

## Process
1. `superpowers:brainstorming` 스킬을 invoke한다. 다음 오버라이드를 전달한다:
   - "Save spec to exact path: {{spec_path}} (do not use the skill's default location)"
   - "Include '## Context & Decisions' section at the top of the spec"
   - "Skip the 'User reviews written spec' step — Codex gate (Phase 2) replaces it"
   - "After spec is written, proceed immediately to step 2 (decisions log) below"
2. decisions.md를 {{decisions_path}}에 작성한다.
3. 필요 시 git commit.
4. **마지막에** `.harness/{{runId}}/phase-1.done` 파일을 생성하고 '{{phaseAttemptId}}' 한 줄만 기록한다.

## Invariants
- sentinel 생성 이후 추가 작업 금지
- spec 파일 경로는 harness-cli가 지정한 {{spec_path}}만 사용 (superpowers가 기본 경로를 제안해도 무시)
- "Context & Decisions" 섹션은 스펙 상단에 있어야 gate 루브릭 scope 축이 평가 가능
```

### 5.2 `harness-phase-3-plan.md`

```
---
name: harness-phase-3-plan
description: Use during harness-cli Phase 3 to write an implementation plan + eval checklist that passes the harness plan gate (Phase 4).
---

# harness Phase 3 — Planning

## Context
Phase 4에서 Codex가 다음 축으로 평가한다:
- Correctness: plan이 spec의 모든 요구사항을 커버하는가?
- Architecture: 태스크 분해가 수직 슬라이스인가? 의존성 순서가 명확한가?
- Testability: 각 태스크에 수용 기준과 검증 절차가 있는가?

## Inputs
- Spec: @{{spec_path}}
- Decision Log: @{{decisions_path}}
- Previous feedback: {{feedback_path}}

## Process
1. `superpowers:writing-plans` 스킬을 invoke한다. 오버라이드:
   - "Save plan to exact path: {{plan_path}}"
   - "After plan is written, you MUST ALSO produce a machine-readable eval checklist (see step 2 below)"
2. eval checklist를 {{checklist_path}}에 **정확히 아래 JSON 스키마**로 저장한다:
   ```json
   {
     "checks": [
       { "name": "<검증 항목 이름>", "command": "<실행 커맨드>" }
     ]
   }
   ```
   - `checks` 배열은 비어있지 않아야 함
   - 각 항목에 `name`(string), `command`(string)이 필수
   - UI 변경이 있는 태스크는 시각적 검증 항목 추가
3. 필요 시 git commit.
4. **마지막에** `.harness/{{runId}}/phase-3.done` 생성 + '{{phaseAttemptId}}'.

## Invariants
- checklist JSON 스키마 위반 시 Phase 6 verify 스크립트가 깨짐
- plan 파일 경로는 {{plan_path}}만 사용
```

### 5.3 `harness-phase-5-implement.md`

```
---
name: harness-phase-5-implement
description: Use during harness-cli Phase 5 to implement the plan with harness invariants (commits, context management, git discipline).
---

# harness Phase 5 — Implementation

## Context
Phase 7에서 Codex가 5축(correctness/readability/architecture/security/performance)으로
spec + plan + eval report + diff을 종합 평가한다.
Phase 6의 자동 verify가 checklist.json의 모든 `command`를 독립 실행한다.

## Inputs
- Spec: @{{spec_path}}
- Plan: @{{plan_path}}
- Decision Log: @{{decisions_path}}
- Checklist: @{{checklist_path}}
- Previous feedback: {{feedback_paths}}

## Auxiliary playbooks (참조)
superpowers가 커버하지 않는 두 원칙을 반드시 따른다:
- Context management: @<baseDir>/playbooks/context-engineering.md
- Git workflow: @<baseDir>/playbooks/git-workflow-and-versioning.md

## Process
1. `superpowers:subagent-driven-development` (또는 plan 헤더가 지정하는 경우 `superpowers:executing-plans`)를 invoke한다. 오버라이드:
   - "After each task completes, git commit the changes. Do not defer commits."
   - "Do not create `.harness/{{runId}}/phase-5.done` until ALL tasks are committed."
2. 구현 중 Auxiliary playbooks의 원칙을 지킨다 (원자적 커밋, 수직 슬라이스, 컨텍스트 prune).
3. 모든 태스크 구현 + 커밋 완료 후 **마지막에** `.harness/{{runId}}/phase-5.done` 생성 + '{{phaseAttemptId}}'.

## Invariants
- sentinel 이전에 모든 변경사항이 git에 커밋되어야 함 (eval gate가 diff를 볼 수 있도록)
- sentinel 이후 추가 작업 금지
- Content Filter로 subagent dispatch가 거부되면 직접 구현으로 전환 + 로그 남김
```

---

## 6. Gate 루브릭 (Layer 2, rev-2 유지)

`src/context/assembler.ts`에서 `REVIEWER_CONTRACT`를 게이트별로 분기:

```typescript
const REVIEWER_CONTRACT_BASE = /* 기존 내용 유지 */;

const FIVE_AXIS_SPEC_GATE = `
## Five-Axis Evaluation (Phase 2 — spec gate)
평가 대상은 spec 문서다. 다음 축만 적용:
1. Correctness — 요구사항/비요구사항/경계조건/성공기준이 명시되었는가?
2. Readability — 섹션 구성 명확, 모호 표현 없음?
3. Scope — 단일 구현 plan으로 분해 가능한가? 여러 독립 프로젝트 섞이지 않음?
`;

const FIVE_AXIS_PLAN_GATE = `
## Five-Axis Evaluation (Phase 4 — plan gate)
평가 대상은 plan + spec이다.
1. Correctness — plan이 spec의 모든 요구사항을 커버?
2. Architecture — 수직 슬라이스, 의존성 순서 명확?
3. Testability — 각 태스크에 수용 기준·검증 절차 있음?
4. Readability — 맥락 없이 태스크 집어도 수행 가능?
`;

const FIVE_AXIS_EVAL_GATE = `
## Five-Axis Evaluation (Phase 7 — eval gate)
평가 대상은 spec + plan + eval report + diff. 5축 전부:
1. Correctness — 구현이 spec+plan과 일치? 경계조건·테스트 커버리지?
2. Readability — 이름/흐름/로컬 복잡도?
3. Architecture — 기존 패턴 부합, 경계 선명, 조기 추상화 없음?
4. Security — 경계 입력 검증, 비밀 노출, 인증 경로?
5. Performance — N+1, 무한 루프, 핫패스 회귀?
Severity: P0/P1=Critical(블록), P2=Important, P3=Suggestion.
`;

const REVIEWER_CONTRACT_BY_GATE: Record<2 | 4 | 7, string> = {
  2: REVIEWER_CONTRACT_BASE + FIVE_AXIS_SPEC_GATE,
  4: REVIEWER_CONTRACT_BASE + FIVE_AXIS_PLAN_GATE,
  7: REVIEWER_CONTRACT_BASE + FIVE_AXIS_EVAL_GATE,
};
```

`buildGatePromptPhase{2,4,7}`가 `REVIEWER_CONTRACT` 대신 `REVIEWER_CONTRACT_BY_GATE[phase]`를 참조.

**wrapper 스킬의 "Context" 섹션**에서 이 축들을 Claude에게 announce함 → 구현자와 리뷰어가 같은 루브릭을 공유.

---

## 7. 프롬프트 템플릿 변경 (Layer A, 얇아짐)

### 변경 후 `phase-5.md` (예시)

```markdown
이 단계는 다음 harness 스킬을 반드시 먼저 읽고 그대로 따른다:
@{{skillsBaseDir}}/harness-phase-5-implement.md

## Harness context (변수)
- spec_path: {{spec_path}}
- plan_path: {{plan_path}}
- decisions_path: {{decisions_path}}
- checklist_path: {{checklist_path}}
- runId: {{runId}}
- phaseAttemptId: {{phaseAttemptId}}
{{#if feedback_paths}}
- feedback_paths:
{{feedback_paths}}
{{/if}}
```

Phase 1/3 템플릿도 같은 패턴. 기존 프롬프트의 자유 서술 지시(sentinel 생성 규칙, commit 요구 등)는 **wrapper 스킬로 이동**. 템플릿은 변수 바인딩만 담당.

### `{{skillsBaseDir}}` 렌더링

`src/context/assembler.ts`에서 `__dirname` 기반으로 `src/context/skills/` 절대경로 계산.

### 렌더링 주의

기존 `{{spec_path}}` 등 변수는 **템플릿 본문과 wrapper 스킬 양쪽에서** 참조된다. wrapper 스킬이 `@{{spec_path}}` 같은 형태로 사용하려면 wrapper 스킬도 템플릿 엔진을 거쳐야 한다. 구현 결정사항:

- **Option A**: wrapper 스킬 파일도 `{{...}}` 변수를 포함하고, `assembleInteractivePrompt`가 wrapper 스킬 내용을 **읽어서 렌더링한 뒤** phase-N.md 템플릿에 inline. Claude는 `@` 참조 없이 통합된 프롬프트 하나를 받음.
- **Option B**: wrapper 스킬은 정적 파일. 변수는 phase-N.md 템플릿에만 있고, wrapper 스킬 본문은 `{{variable_name}}` 자리표시자를 literal로 출력. Claude가 문맥에서 치환.

**Option A 권장** — Claude에게 자리표시자 치환을 위임하면 실수 위험. 구현은 `assembleInteractivePrompt`에서 skill 파일을 read → template render → phase-N.md 안에 block으로 삽입.

---

## 8. 배포·소비 경로

### Repo 내 위치
- `src/context/skills/` — wrapper 스킬 3개 (harness-cli 본체가 직접 읽음)
- `src/context/playbooks/` — agent-skills vendor 2개 (wrapper 스킬이 @ 참조)
- `src/context/prompts/` — 기존 phase-N.md (thin binding으로 수정)

### 빌드
wrapper 스킬과 playbooks 모두 `dist/` 산출물에 포함되어야 `harness` CLI 바이너리가 런타임에 접근 가능. `package.json`의 `files` 배열 또는 빌드 스크립트 확인 항목.

### Claude 플러그인 배포 (선택적, 향후)
`docs/specs/2026-04-14-claude-harness-skill-design.md`의 플러그인 패키징에 wrapper 스킬을 포함할지 여부는 **별도 결정**. 두 경로:

- **Repo만**: wrapper 스킬은 `harness run` CLI 경로에서만 활성. `/harness` 슬래시 커맨드는 기존대로 superpowers 직접 호출.
- **Plugin 포함**: wrapper 스킬을 플러그인으로도 배포. `/harness` 스킬이 wrapper를 호출하도록 업데이트 (§9). 두 경로 통일.

**rev-3는 "Repo만" 배포를 먼저 구현하고, plugin 반영은 follow-up으로 권장**. CLI 경로에서 동작 검증 후 플러그인에 반영하는 안전한 rollout.

---

## 9. 기존 `/harness` 스킬과의 관계

`~/.claude/skills/harness/SKILL.md`는 현재 Phase 1/3/5에서 superpowers를 직접 호출한다. rev-3 도입 후 선택지:

| Option | 동작 | 장단점 |
|---|---|---|
| **유지** (A) | `/harness`는 superpowers 직접 호출 계속. wrapper 스킬은 CLI 경로 전용 | 무변경. 두 경로가 다른 동작. 장기적으로 divergence 위험 |
| **wrapper로 이관** (B) | `/harness`가 wrapper 스킬을 호출. wrapper가 superpowers 호출 | 두 경로 통일. `/harness` 스킬 수정 필요 (이 레포의 플러그인 배포 산출물) |
| **점진 이관** (C) | Phase별로 하나씩 wrapper로 이관. 나머지는 직접 호출 유지 | 리스크 분산. 상태 추적 복잡 |

**권장: 초기 B (wrapper로 이관) 또는 C (점진)**, 단 구현 일정은 다음 세션이 결정. rev-3 설계는 **wrapper 스킬이 B/C 어느 쪽이든 호환되도록** 설계 — wrapper가 자기 완결적이고 harness 변수만 받으면 동작하므로 호출 주체가 `/harness` 스킬이든 phase-N.md 프롬프트든 무관.

---

## 10. Directory layout

```
src/context/
├── prompts/
│   ├── phase-1.md                     ← thin binding으로 수정
│   ├── phase-3.md                     ← 동일
│   └── phase-5.md                     ← 동일
├── skills/                            ✨ 신설
│   ├── harness-phase-1-spec.md        ✨
│   ├── harness-phase-3-plan.md        ✨
│   └── harness-phase-5-implement.md   ✨
├── playbooks/                         ✨ 신설 (rev-2 vendor 2개)
│   ├── VENDOR.md                      ✨ upstream SHA + sync 절차
│   ├── LICENSE-agent-skills.md        ✨ MIT attribution
│   ├── context-engineering.md         ✨ from agent-skills
│   └── git-workflow-and-versioning.md ✨ from agent-skills
└── assembler.ts                       ← REVIEWER_CONTRACT_BY_GATE 분기 +
                                         wrapper 스킬 렌더링 로직 추가
```

**이 레이아웃이 다음 세션의 신설 파일 목록**. 태스크 리스트업 시 그대로 복사 가능.

---

## 11. 하위 호환 및 테스트

### 하위 호환
- **state.json 스키마**: 변경 없음
- **기존 phase-N.md 템플릿 변수**: 추가만 있음(`{{skillsBaseDir}}`), 기존 변수 동작 불변
- **`REVIEWER_CONTRACT` 상수**: 제거되고 `REVIEWER_CONTRACT_BY_GATE`로 대체. src/ 그렙 결과 내부에서만 사용 — 안전
- **기존 `harness resume`**: state.json 불변이므로 그대로 동작. 진행 중인 run은 rev-3 wrapper 스킬 없이 기존 프롬프트로 완주 (wrapper 스킬은 새로 시작하는 run부터 적용) — 단, 이건 구현 결정이며 "resume 시 강제 rev-3 전환"도 가능. 다음 세션에서 결정.

### 테스트 전략
1. **Wrapper 스킬 렌더링 스냅샷**: `assembleInteractivePrompt(1|3|5, ...)`가 wrapper 스킬을 읽어 harness 변수를 바르게 치환했는지 (Option A 방식).
2. **Wrapper 스킬 파일 실존 검증**: `src/context/skills/harness-phase-{1,3,5}-*.md` 3개 존재 확인.
3. **Playbook 파일 실존 검증**: `src/context/playbooks/{context-engineering,git-workflow-and-versioning}.md` 존재.
4. **Gate rubric 스냅샷**: `assembleGatePrompt(2|4|7, ...)`가 해당 `FIVE_AXIS_*`를 포함.
5. **Prompt size**: Phase 5 최종 프롬프트가 `MAX_PROMPT_SIZE_KB` 이하.

### 프롬프트 크기 추정
- wrapper 스킬 각 ~2-4KB (skeleton 기반 추정). Phase 5는 wrapper 1개 + playbook 2개 @ 참조 → 실제 Claude 수신은 wrapper 2-4KB + 참조된 playbook 6-16KB = ~8-20KB.
- Gate rubric 추가 ~0.5-1KB per gate.
- Claude 200K 토큰 창 대비 여유.

---

## 12. 비목표 및 향후 확장

### 이번 rev-3에서 명시적 제외
- superpowers 포크·재작성
- 도메인 스킬 주입 (frontend/api/security/perf/a11y 등)
- Phase 6 (`harness-verify.sh`) 변경
- `/harness` 스킬 갱신 (§9 — follow-up)
- wrapper 스킬의 Claude 플러그인 배포 (§8 — follow-up)
- 도메인 `--domain` 플래그

### 향후 확장 경로
1. **Phase 2/4/7용 gate wrapper** — Codex가 스킬을 invoke하지 않으므로 현재 불필요. 단, Codex가 스킬 호출 가능해지면 동일 패턴 적용 가능.
2. **도메인 오버레이** — wrapper 스킬이 `{{domain}}` 변수를 받아 추가 playbook을 선택적으로 참조하는 구조. Q2 C의 재개.
3. **superpowers → native 부분 마이그레이션** — 특정 superpowers 스킬이 harness와 부적합해지면 wrapper 내부에서 superpowers 호출 대신 native 구현으로 교체. 외부 인터페이스(wrapper 스킬 이름) 불변.
4. **wrapper 스킬의 slash command화** — `/phase-1-spec` 같은 단독 슬래시 커맨드로도 노출. 하네스 런타임 없이 스킬만 재활용.

---

## 13. 다음 세션을 위한 작업 스코프 (참고)

**이 spec은 설계만 담는다.** 구현 작업 리스트업·리소스 분배는 다음 세션에서 별도 진행. 참고용으로 개략적인 작업 단위만 나열:

| 작업 단위 | 성격 | 의존 | 설명 |
|---|---|---|---|
| Vendor 2 playbooks | 내용 복사 | 없음 | `src/context/playbooks/` 파일 2개 + VENDOR.md/LICENSE |
| Write 3 wrapper skills | 콘텐츠 작성 | vendor 완료 | harness-phase-{1,3,5}-*.md 스켈레톤을 본문화 |
| Refactor `assembler.ts` | 코드 | 위 2개 | wrapper 스킬 읽기·렌더링, `REVIEWER_CONTRACT_BY_GATE` 분기, `FIVE_AXIS_*` 상수 |
| Thin out phase-N.md | 코드 | assembler 완료 | 3개 템플릿을 변수 바인딩만 남기게 단축 |
| Build/dist 포함 확인 | 설정 | 없음 | `package.json` files, `tsconfig` output 점검 |
| 테스트 추가 | 테스트 | 위 전부 | §11 테스트 5종 |
| 문서 업데이트 | 문서 | 위 전부 | `README.md`, `docs/HOW-IT-WORKS.md`에 wrapper 구조 언급 |
| (선택) `/harness` 스킬 업데이트 | 플러그인 | 위 전부 | §9 Option B/C 결정 후 |

의존 그래프는 느슨함 — vendor와 wrapper 작성은 병렬 가능, assembler refactor는 그 뒤, 프롬프트 thinning은 그 뒤. 다음 세션이 태스크 그래프를 정식화.

---

## 14. 버전 이력

| rev | 날짜 | 요지 |
|---|---|---|
| 1 | 2026-04-18 | 최초 합성 설계: agent-skills 8개 vendor + phase 1/3/5 전면 주입 + gate 5축 루브릭 |
| 2 | 2026-04-18 | superpowers 생태계 인식 반영. 중복 제거로 vendor 8개→2개, Phase 1/3 주입 제거, Phase 5만 유지. 세 기준(충돌/외부의존/병목) 도입 |
| 3 | 2026-04-18 | **중간안 pivot**: wrapper 스킬 3개(harness-phase-{1,3,5}) 신설. superpowers는 wrapper가 호출. playbook 2개는 wrapper 참조용. 3-layer 아키텍처(prompt → wrapper skill → superpowers/playbook) |
