# harness-skills Synthesis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**관련 문서:**
- Spec: `docs/specs/2026-04-18-harness-skills-synthesis-design.md` (rev 3)
- Intent/handoff: `docs/specs/2026-04-18-harness-skills-synthesis-INTENT.md`
- Eval checklist: §Eval Checklist (본 문서 하단)
- 흡수된 QA 이슈: `qa-observations.md` #7 (Interactive phase clarify dialog hook)

**Goal:** harness-cli Phase 1/3/5용 wrapper 스킬 3종을 신설하고, phase-N.md 프롬프트를 thin binding으로 축약하여 CLI 경로와 `/harness` 슬래시 커맨드 경로가 같은 contract로 수렴하게 만든다. 동시에 Gate 2/4/7 REVIEWER_CONTRACT를 게이트별 5축 rubric으로 분기한다.

**Architecture:** 3-layer composition — (A) 얇은 phase-N.md 템플릿이 `{{wrapper_skill}}` placeholder를 통해 (B) `src/context/skills/harness-phase-{1,3,5}-*.md` 래퍼 스킬을 inline 렌더링한다. 래퍼는 (C) superpowers 스킬 호출 + `src/context/playbooks/`에 vendored된 agent-skills playbook을 `@` 참조. Gate 프롬프트는 `REVIEWER_CONTRACT_BASE` + `FIVE_AXIS_{SPEC,PLAN,EVAL}_GATE`를 `REVIEWER_CONTRACT_BY_GATE` record로 조립한다.

**Tech Stack:** TypeScript (Node.js ≥18), vitest, markdown, tsc + esbuild-style copy-assets.

## Resume Behavior Decision (spec §11 항목 선택)

Spec §11은 `harness resume` 시 진행 중 run의 프롬프트 처리를 **"기존 프롬프트로 완주" vs "force rev-3 전환"** 중 택일로 열어둠. 본 plan은 **"force rev-3 전환"**을 선택한다.

**근거**: rev-3 wrapper 스킬은 기존 phase-N.md의 **superset**이다 — 같은 artifact 경로, 같은 sentinel 규칙, 같은 `{runId}/phase-N.done` 계약을 유지하면서 working discipline만 추가. 따라서 reopen된 old run이 새 프롬프트를 받아도 수행하지 못할 동작이 없다. 반대로 prompt-format versioning 또는 per-run snapshot을 도입하는 건 spec 스코프 대비 과한 복잡도(state 필드 추가, 저장 포맷 마이그레이션, resume 경로 갈래 처리).

**검증**: Task 7에 **resume-smoke regression test** 추가(실제 state.json 샘플을 로드 → `assembleInteractivePrompt` 호출 → 새 wrapper 내용이 정상 렌더되고 artifact 경로가 기존 state와 일치하는지 확인). 이 테스트는 "rev-3 적용 후 임의의 기존 run state로 재진입해도 프롬프트가 valid하다"를 보장.

---

## File Structure

### 신규 파일
- `src/context/playbooks/VENDOR.md` — upstream SHA + sync 절차
- `src/context/playbooks/LICENSE-agent-skills.md` — MIT attribution (upstream LICENSE 복사)
- `src/context/playbooks/context-engineering.md` — vendored from `addyosmani/agent-skills`
- `src/context/playbooks/git-workflow-and-versioning.md` — vendored from `addyosmani/agent-skills`
- `src/context/skills/harness-phase-1-spec.md` — Phase 1 wrapper (brainstorm + spec)
- `src/context/skills/harness-phase-3-plan.md` — Phase 3 wrapper (writing-plans)
- `src/context/skills/harness-phase-5-implement.md` — Phase 5 wrapper (subagent-driven / executing-plans)
- `tests/context/skills-rendering.test.ts` — wrapper skill inline + variable render 테스트
- `tests/context/reviewer-contract.test.ts` — per-gate 5축 rubric 포함 여부 검증

### 수정 파일
- `src/context/assembler.ts` — `REVIEWER_CONTRACT` 상수 분해, `FIVE_AXIS_*` 3종, `REVIEWER_CONTRACT_BY_GATE`, `buildGatePromptPhase{2,4,7}` wiring, `assembleInteractivePrompt`에 wrapper 스킬 읽기·프론트매터 strip·렌더·inline 로직
- `src/context/prompts/phase-1.md` — thin binding (`{{wrapper_skill}}` + 변수 목록)
- `src/context/prompts/phase-3.md` — 동일 패턴
- `src/context/prompts/phase-5.md` — 동일 패턴
- `scripts/copy-assets.mjs` — dist 빌드 시 skills/, playbooks/ 복사 추가
- 기존 테스트: `tests/context/assembler.test.ts` — REVIEWER_CONTRACT 분기·interactive 프롬프트 스냅샷 수동 갱신 (의도된 변화)

### 변경 없음 (명시적 확인)
- `src/runners/*.ts` — 러너는 wrapper 스킬을 읽지 않음 (assembler가 inline 처리)
- `src/phases/*.ts` — 페이즈 디스패처는 프롬프트 최종 문자열만 받음
- `scripts/harness-verify.sh` — Phase 6 결정론 유지
- `package.json` `files` 배열 — `dist` 이미 포함 → skills/playbooks는 dist 안에 들어가므로 자동 shipping

---

## Task Dependency Graph

```
T1 (vendor playbooks)  ┐
                       │── 독립, 병렬
T2 (wrapper skills)    ┘        │
                                │
T3 (REVIEWER_CONTRACT split) ──→ T4 (wrapper inline in assembler) ──→ T5 (thin phase-N.md)
                                                                            │
T6 (copy-assets) ── depends on T1 + T2 ────────────────────────────────────┤
                                                                            ▼
                                                                     T7 (final E2E + docs)
```

**Parallelization 기회:**
- **T1 · T2 동시 실행 가능** (파일 독립, 콘텐츠만 다름)
- T3 · T4는 `assembler.ts` 같은 파일의 다른 region을 건드리지만 의미상 선후 (contract split → wrapper rendering). Serial 처리 권장.
- T5는 T4의 wrapper rendering 로직 존재 전제.
- **T4↔T5 실행 순서 (authoritative)**: T4 Step 1–2 → T5 Step 2–4 → T4 Step 3. Graph의 단순 `T4 → T5` 표기는 conceptual dependency이며 실제 커밋 순서는 Task 4 Step 3 주석의 인터리브를 따른다. (gate-plan 2026-04-18 P2 resolved: graph 유지 + 실행 순서 명시)
- T6은 T1+T2 결과물만 있으면 언제든. T3~T5와는 무관.
- T7은 최종.

**리소스 분배 권장:** `superpowers:subagent-driven-development`. 태스크가 대체로 자기완결적이고 (파일/기능 경계 명확), 중간 런타임 조율이 필요 없음. whip-start 수준의 조율은 overkill.

---

## Task 1: Vendor agent-skills playbooks

upstream: `https://github.com/addyosmani/agent-skills` (MIT). 2개 playbook을 **pinned SHA** 기준으로 복사. 파일 콘텐츠 생성 태스크라 TDD 아님 — 파일 존재·프론트매터·원본 일치 smoke check만.

**Files:**
- Create: `src/context/playbooks/VENDOR.md`
- Create: `src/context/playbooks/LICENSE-agent-skills.md`
- Create: `src/context/playbooks/context-engineering.md`
- Create: `src/context/playbooks/git-workflow-and-versioning.md`

- [ ] **Step 1: Resolve upstream SHA**

```bash
SHA=$(curl -fsSL https://api.github.com/repos/addyosmani/agent-skills/branches/main \
        | grep -m1 '"sha"' | awk -F'"' '{print $4}')
echo "Pinned SHA: $SHA"
```
Expected: 40-char hex. `$SHA`를 이후 step에서 재사용.

- [ ] **Step 2: Discover upstream skill file paths**

```bash
curl -fsSL "https://api.github.com/repos/addyosmani/agent-skills/git/trees/${SHA}?recursive=1" \
  | grep -E 'skills/(context-engineering|git-workflow-and-versioning)' | head -10
```
Expected: `skills/context-engineering/SKILL.md`와 `skills/git-workflow-and-versioning/SKILL.md` 경로가 보임. 다른 파일명/경로라면 해당 경로로 교체.

- [ ] **Step 3: Fetch playbook content**

```bash
curl -fsSL "https://raw.githubusercontent.com/addyosmani/agent-skills/${SHA}/skills/context-engineering/SKILL.md" \
     -o src/context/playbooks/context-engineering.md
curl -fsSL "https://raw.githubusercontent.com/addyosmani/agent-skills/${SHA}/skills/git-workflow-and-versioning/SKILL.md" \
     -o src/context/playbooks/git-workflow-and-versioning.md
wc -l src/context/playbooks/*.md
```
Expected: 두 파일 모두 line count > 0.

- [ ] **Step 4: Fetch upstream LICENSE**

```bash
curl -fsSL "https://raw.githubusercontent.com/addyosmani/agent-skills/${SHA}/LICENSE" \
     -o src/context/playbooks/LICENSE-agent-skills.md
head -5 src/context/playbooks/LICENSE-agent-skills.md
```
Expected: `MIT License` 첫 줄.

- [ ] **Step 5: Write VENDOR.md**

`src/context/playbooks/VENDOR.md`:
```markdown
# Vendored Playbooks

Source: https://github.com/addyosmani/agent-skills (MIT)
Pinned SHA: <PASTE $SHA HERE>
Fetched: 2026-04-18

## Files
- `context-engineering.md` ← `skills/context-engineering/SKILL.md`
- `git-workflow-and-versioning.md` ← `skills/git-workflow-and-versioning/SKILL.md`
- `LICENSE-agent-skills.md` ← upstream `LICENSE`

## Sync procedure
1. 이 문서의 "Pinned SHA" 값을 새 SHA로 업데이트.
2. 다음 커맨드로 파일 재다운로드:
   ```bash
   SHA=<NEW_SHA>
   for name in context-engineering git-workflow-and-versioning; do
     curl -fsSL "https://raw.githubusercontent.com/addyosmani/agent-skills/${SHA}/skills/${name}/SKILL.md" \
          -o src/context/playbooks/${name}.md
   done
   curl -fsSL "https://raw.githubusercontent.com/addyosmani/agent-skills/${SHA}/LICENSE" \
        -o src/context/playbooks/LICENSE-agent-skills.md
   ```
3. 이전 버전과 `git diff` 검토. harness와 무관한 외부 툴/프로세스 언급이 있으면 상단에 `> NOTE: Apply principles, not specifics.` 한 줄 추가.
4. `git commit -m "chore(playbooks): bump vendor SHA to <NEW_SHA>"`.
```
`<PASTE $SHA HERE>`를 실제 SHA로 치환.

- [ ] **Step 6: Sanity check and add harness-adaptation note if needed**

두 playbook 파일을 훑어 본다. harness-cli와 무관한 외부 참조(예: Slack 워크플로, 특정 회사 도구)가 보이면 파일 맨 위에 다음 한 줄 추가:
```markdown
> NOTE: Some sections below may reference non-harness tooling. Apply principles, not specifics.
```

- [ ] **Step 7: Commit**

```bash
git add src/context/playbooks/
git commit -m "chore(playbooks): vendor agent-skills context-engineering + git-workflow at pinned SHA"
```

---

## Task 2: Write wrapper skill files

design spec §5의 skeleton을 본문화. 각 스킬은 YAML frontmatter(`name`, `description`) + 섹션(Context / Inputs / Process / Invariants) 구조. Process 섹션은 harness 변수(`{{spec_path}}` 등)를 템플릿으로 쓴다(Option A — assembler가 렌더링).

**Files:**
- Create: `src/context/skills/harness-phase-1-spec.md`
- Create: `src/context/skills/harness-phase-3-plan.md`
- Create: `src/context/skills/harness-phase-5-implement.md`

- [ ] **Step 1: Create `harness-phase-1-spec.md`** (qa #7 invariant 포함)

```markdown
---
name: harness-phase-1-spec
description: Use during harness-cli Phase 1 to brainstorm and write a spec that passes the harness spec gate (Phase 2).
---

# harness Phase 1 — Spec writing

## Context
당신은 harness-cli 파이프라인의 Phase 1에 있다. 산출물(spec)은 Phase 2에서 Codex가 다음 5축 rubric의 subset으로 평가한다:
- **Correctness** — 요구사항/비요구사항/경계조건/성공기준이 명시되었는가?
- **Readability** — 섹션 구성이 명확하고 모호한 표현이 없는가?
- **Scope** — 단일 구현 plan으로 분해 가능한 크기인가? 여러 독립 프로젝트가 섞이지 않았는가?

**Additional gate check**: spec은 반드시 `## Open Questions` 섹션을 포함해야 한다. 모호함이 없다고 판단되면 "(none identified; all requirements resolved)" 명시. 누락 시 Phase 2 gate가 P1을 발행한다.

## Inputs
- Task spec: @{{task_path}}
- Previous gate-2 feedback (있다면 반드시 반영): {{feedback_path}}

## Process
1. `superpowers:brainstorming` 스킬을 invoke한다. 다음 오버라이드를 전달한다:
   - `"Save spec to exact path: {{spec_path}} (do not use the skill's default location)"`
   - `"Include '## Context & Decisions' section at the top of the spec"`
   - `"ALSO include '## Open Questions' section listing 3–5 ambiguities the reviewer should flag. Empty list acceptable only with explicit rationale."`
   - `"Skip the 'User reviews written spec' step — Codex gate (Phase 2) replaces it"`
   - `"After spec is written, proceed immediately to step 2 (decisions log) below"`
2. Decision log를 `{{decisions_path}}`에 작성한다. spec의 "Context & Decisions" 섹션과 **중복되지 않도록** 각 결정의 *trade-off*와 *고려된 대안*을 기록한다.
3. 필요 시 `git add` + `git commit`. 커밋 메시지: `spec: <subject>`.
4. **가장 마지막에** `.harness/{{runId}}/phase-1.done`을 생성하고 내용으로 `{{phaseAttemptId}}` 한 줄만 기록한다.

## Invariants
- sentinel 파일 생성 이후 하네스가 다음 단계로 넘어간다. 추가 작업 금지.
- spec 파일 경로는 `{{spec_path}}` 고정 (superpowers가 기본 경로를 제안해도 무시).
- "Context & Decisions" 섹션은 spec **상단**에 있어야 gate rubric의 Scope 축이 평가 가능.
- "Open Questions" 섹션 필수 (qa-observations #7 대응).
```

- [ ] **Step 2: Create `harness-phase-3-plan.md`**

```markdown
---
name: harness-phase-3-plan
description: Use during harness-cli Phase 3 to write an implementation plan + eval checklist that passes the harness plan gate (Phase 4).
---

# harness Phase 3 — Planning

## Context
Phase 4에서 Codex가 다음 축으로 평가한다:
- **Correctness** — plan이 spec의 모든 요구사항을 커버하는가?
- **Architecture** — 태스크 분해가 수직 슬라이스인가? 의존성 순서가 명확한가?
- **Testability** — 각 태스크에 수용 기준과 검증 절차(테스트 or 수동 확인)가 명시되었는가?
- **Readability** — 맥락 없이 태스크 하나만 집어도 수행 가능한가?

## Inputs
- Spec: @{{spec_path}}
- Decision log: @{{decisions_path}}
- Previous gate-4 feedback (있다면 반영): {{feedback_path}}

## Process
1. `superpowers:writing-plans` 스킬을 invoke한다. 다음 오버라이드를 전달한다:
   - `"Save plan to exact path: {{plan_path}} (do not use the skill's default location)"`
   - `"After the plan is written, you MUST ALSO produce a machine-readable eval checklist at {{checklist_path}} (see step 2 below). This is non-negotiable — Phase 6 verify reads it."`
2. Eval checklist를 `{{checklist_path}}`에 **정확히 다음 JSON 스키마**로 저장한다:
   ```json
   {
     "checks": [
       { "name": "<검증 항목 이름>", "command": "<실행 커맨드>" }
     ]
   }
   ```
   - `checks` 배열은 비어있지 않아야 함.
   - 각 항목은 `name`(string), `command`(string) 필수. 다른 키 금지.
   - 각 `command`는 **격리된 셸 환경에서 실행**된다. 절대경로 바이너리(`.venv/bin/pytest`) 또는 env-aware 래퍼(`make test`)를 사용할 것. 글로벌 PATH에만 있는 도구는 피함 (qa-observations #4 대응).
   - UI/시각적 변경이 있는 태스크가 있다면 스크린샷/시각 검증 항목을 적어도 한 건 추가.
3. 필요 시 `git commit -m "plan: <subject>"`.
4. **가장 마지막에** `.harness/{{runId}}/phase-3.done`을 생성하고 `{{phaseAttemptId}}` 한 줄만 기록.

## Invariants
- sentinel 이후 추가 작업 금지.
- plan 파일 경로는 `{{plan_path}}` 고정.
- checklist JSON 스키마 위반 시 `scripts/harness-verify.sh`가 실패. 스키마 정확히 준수.
- Plan은 spec의 "Open Questions" 항목을 태스크 레벨에서 해소하거나 명시적으로 defer해야 함.
```

- [ ] **Step 3: Create `harness-phase-5-implement.md`**

```markdown
---
name: harness-phase-5-implement
description: Use during harness-cli Phase 5 to implement the plan with harness invariants (commits, context management, git discipline).
---

# harness Phase 5 — Implementation

## Context
Phase 6의 자동 verify가 `{{checklist_path}}`의 모든 `command`를 독립 셸에서 실행한다. Phase 7에서 Codex가 spec + plan + eval report + diff을 5축(correctness/readability/architecture/security/performance)으로 종합 평가한다.

## Inputs
- Spec: @{{spec_path}}
- Plan: @{{plan_path}}
- Decision log: @{{decisions_path}}
- Checklist: @{{checklist_path}}
- Previous feedback (gate-7 또는 verify에서 온): {{feedback_paths}}

## Auxiliary playbooks (참조, @ 표기로 inline 로드)
superpowers가 커버하지 않는 두 원칙을 지킨다:
- Context management: @{{harnessDir}}/../dist/src/context/playbooks/context-engineering.md
- Git workflow: @{{harnessDir}}/../dist/src/context/playbooks/git-workflow-and-versioning.md

*(경로는 harness runtime이 dist에서 실행될 때 기준. 개발 환경에서는 `src/context/playbooks/` 하위.)*

## Process
1. Plan 헤더에 명시된 sub-skill을 invoke한다 (기본: `superpowers:subagent-driven-development`, 대안: `superpowers:executing-plans`). 다음 오버라이드를 전달한다:
   - `"After each task completes, git commit the changes. Do not defer commits to the end."`
   - `"Do NOT create .harness/{{runId}}/phase-5.done until ALL tasks in the plan are committed."`
   - `"If Content Filter rejects a subagent dispatch, fall back to direct in-session implementation and record the fallback in the task note."`
2. 구현 중 위 Auxiliary playbooks의 원칙(원자적 커밋, 수직 슬라이스, 컨텍스트 prune)을 적용한다.
3. 모든 태스크 구현 + 커밋 완료 후 **가장 마지막에** `.harness/{{runId}}/phase-5.done`을 생성하고 `{{phaseAttemptId}}` 한 줄만 기록.

## Invariants
- sentinel 이전에 모든 변경사항이 **git에 커밋**되어야 한다. Phase 7 eval은 diff 기반이므로 uncommitted 변경은 보이지 않음.
- sentinel 이후 추가 작업 금지.
- Content Filter로 subagent dispatch 실패 시 fallback → 직접 구현 + 로그 남김 (plan의 각 task 하단에 `fallback: direct` 메모).
- Reopen 시 gitignored artifact만 수정한 경우(예: `.harness/<runId>/checklist.json` 수정) 새 커밋 없이도 phase-5 valid (spec §Bug D 대응).
```

- [ ] **Step 4: Verify all three wrapper skills parse as valid markdown + frontmatter**

```bash
node -e "
const fs = require('fs');
const files = ['harness-phase-1-spec', 'harness-phase-3-plan', 'harness-phase-5-implement'];
let ok = true;
for (const f of files) {
  const p = 'src/context/skills/' + f + '.md';
  const c = fs.readFileSync(p, 'utf-8');
  const m = c.match(/^---\n([\s\S]*?)\n---/);
  if (!m) { console.error('[FAIL] missing frontmatter:', f); ok = false; continue; }
  if (!/name:\s*harness-/.test(m[1]))        { console.error('[FAIL] name field:', f); ok = false; }
  if (!/description:\s*.+/.test(m[1]))       { console.error('[FAIL] description field:', f); ok = false; }
  if (!/## Process/.test(c))                  { console.error('[FAIL] missing Process section:', f); ok = false; }
  if (!/## Invariants/.test(c))               { console.error('[FAIL] missing Invariants section:', f); ok = false; }
  if (ok) console.log('[OK]', f);
}
if (!ok) process.exit(1);
"
```
Expected: 3 `[OK]` lines, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/context/skills/
git commit -m "feat(skills): add wrapper skills for Phase 1/3/5 (harness-native process overlay)"
```

---

## Task 3: REVIEWER_CONTRACT split + 5-axis rubric per gate

spec §6. 단일 `REVIEWER_CONTRACT` 상수를 base + per-gate 5축 rubric으로 분해하고, `buildGatePromptPhase{2,4,7}`를 새 분기로 wiring.

**Files:**
- Modify: `src/context/assembler.ts:19-35` (`REVIEWER_CONTRACT` 정의부)
- Modify: `src/context/assembler.ts:108-221` (`buildGatePromptPhase{2,4,7}`)
- Create: `tests/context/reviewer-contract.test.ts`

- [ ] **Step 1: Write failing test — each gate includes its 5-axis rubric**

Create `tests/context/reviewer-contract.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { assembleGatePrompt } from '../../src/context/assembler.js';
import type { HarnessState } from '../../src/types.js';

function stubState(tmp: string): HarnessState {
  fs.writeFileSync(path.join(tmp, 'spec.md'), '# spec\n## Context & Decisions\n- x\n## Open Questions\n- y\n');
  fs.writeFileSync(path.join(tmp, 'plan.md'), '# plan\n');
  fs.writeFileSync(path.join(tmp, 'eval.md'), '# eval\n');
  return {
    runId: 'test-run',
    baseCommit: 'abc',
    implCommit: null,
    evalCommit: null,
    externalCommitsDetected: false,
    verifiedAtHead: null,
    implRetryBase: '',
    artifacts: {
      spec: path.join(tmp, 'spec.md'),
      plan: path.join(tmp, 'plan.md'),
      decisionLog: path.join(tmp, 'decisions.md'),
      checklist: path.join(tmp, 'checklist.json'),
      evalReport: path.join(tmp, 'eval.md'),
    },
    phasePresets: { '2': 'codex-high', '4': 'codex-high', '7': 'codex-high' },
    phases: { '1': 'pending', '2': 'pending', '3': 'pending', '4': 'pending', '5': 'pending', '6': 'pending', '7': 'pending' },
    phaseCodexSessions: { '2': null, '4': null, '7': null },
    phaseAttemptId: {},
    phaseOpenedAt: {},
    phaseReopenFlags: {},
    gateRetries: { '2': 0, '4': 0, '7': 0 },
    pendingAction: null,
  } as unknown as HarnessState;
}

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-')); });

describe('REVIEWER_CONTRACT_BY_GATE', () => {
  it('gate 2 — spec rubric (Correctness/Readability/Scope + Open Questions check)', () => {
    const s = stubState(tmp);
    const p = assembleGatePrompt(2, s, tmp, tmp);
    expect(typeof p).toBe('string');
    const prompt = p as string;
    expect(prompt).toContain('Five-Axis Evaluation (Phase 2');
    expect(prompt).toMatch(/1\.\s*Correctness/);
    expect(prompt).toMatch(/2\.\s*Readability/);
    expect(prompt).toMatch(/3\.\s*Scope/);
    expect(prompt).toMatch(/Open Questions/);           // qa #7 gate check
    expect(prompt).not.toMatch(/\bSecurity\b/);         // not in spec gate
    expect(prompt).not.toMatch(/\bPerformance\b/);      // not in spec gate
  });

  it('gate 4 — plan rubric (Correctness/Architecture/Testability/Readability)', () => {
    const s = stubState(tmp);
    const p = assembleGatePrompt(4, s, tmp, tmp);
    const prompt = p as string;
    expect(prompt).toContain('Five-Axis Evaluation (Phase 4');
    expect(prompt).toMatch(/Architecture/);
    expect(prompt).toMatch(/Testability/);
    expect(prompt).not.toMatch(/\bSecurity\b/);
    expect(prompt).not.toMatch(/\bPerformance\b/);
  });

  it('gate 7 — eval rubric (all 5 axes + severity)', () => {
    const s = stubState(tmp);
    const p = assembleGatePrompt(7, s, tmp, tmp);
    const prompt = p as string;
    expect(prompt).toContain('Five-Axis Evaluation (Phase 7');
    expect(prompt).toMatch(/Correctness/);
    expect(prompt).toMatch(/Readability/);
    expect(prompt).toMatch(/Architecture/);
    expect(prompt).toMatch(/Security/);
    expect(prompt).toMatch(/Performance/);
    expect(prompt).toMatch(/P0\/P1=Critical/);
  });

  it('REVIEWER_CONTRACT_BASE common parts present in all three', () => {
    const s = stubState(tmp);
    for (const g of [2, 4, 7] as const) {
      const prompt = assembleGatePrompt(g, s, tmp, tmp) as string;
      expect(prompt).toMatch(/## Verdict/);
      expect(prompt).toMatch(/## Comments/);
      expect(prompt).toMatch(/## Summary/);
      expect(prompt).toMatch(/APPROVE only if zero P0\/P1/);
    }
  });
});
```
Run:
```bash
pnpm vitest run tests/context/reviewer-contract.test.ts
```
Expected: FAIL — "Five-Axis Evaluation" 문자열이 아직 없음.

- [ ] **Step 2: Refactor constants in `src/context/assembler.ts`**

L15-35 블록을 다음으로 교체:
```typescript
/**
 * Shared reviewer contract — common preamble across all gates (2, 4, 7).
 * Per-gate 5-axis rubric is appended via REVIEWER_CONTRACT_BY_GATE below.
 */
const REVIEWER_CONTRACT_BASE = `You are an independent technical reviewer. Review the provided documents and return a structured verdict.
Output format — must include exactly these sections in order:

## Verdict
APPROVE or REJECT

## Comments
- **[P0|P1|P2|P3]** — Location: ...
  Issue: ...
  Suggestion: ...
  Evidence: ...

## Summary
One to two sentences.

Rules: APPROVE only if zero P0/P1 findings. Every comment must cite a specific location.
`;

const FIVE_AXIS_SPEC_GATE = `
## Five-Axis Evaluation (Phase 2 — spec gate)
평가 대상은 spec 문서다. 다음 축만 적용:
1. Correctness — 요구사항/비요구사항/경계조건/성공기준이 명시되었는가?
2. Readability — 섹션 구성이 명확하고 모호 표현이 없는가?
3. Scope — 단일 구현 plan으로 분해 가능한 크기인가? 여러 독립 프로젝트 섞이지 않음?

Additional required check: spec MUST contain an explicit '## Open Questions' section. Missing/empty-without-rationale → P1.
`;

const FIVE_AXIS_PLAN_GATE = `
## Five-Axis Evaluation (Phase 4 — plan gate)
평가 대상은 plan + spec이다.
1. Correctness — plan이 spec의 모든 요구사항을 커버?
2. Architecture — 태스크 분해가 수직 슬라이스이고 의존성 순서가 명확?
3. Testability — 각 태스크에 수용 기준과 검증 절차 있음?
4. Readability — 맥락 없이 태스크 하나만 집어도 수행 가능?
`;

const FIVE_AXIS_EVAL_GATE = `
## Five-Axis Evaluation (Phase 7 — eval gate)
평가 대상은 spec + plan + eval report + diff. 5축 전부:
1. Correctness — 구현이 spec+plan과 일치? 경계조건·테스트 커버리지?
2. Readability — 이름/흐름/로컬 복잡도 적절?
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

- [ ] **Step 3: Wire buildGatePromptPhase{2,4,7} to use BY_GATE[phase]**

세 함수 내부의 `REVIEWER_CONTRACT +` 참조를 다음으로 교체:
```typescript
// buildGatePromptPhase2
return (
  REVIEWER_CONTRACT_BY_GATE[2] +
  `\n<spec>\n${specResult.content}\n</spec>\n`
);

// buildGatePromptPhase4
return (
  REVIEWER_CONTRACT_BY_GATE[4] +
  `\n<spec>\n${specResult.content}\n</spec>\n\n` +
  `<plan>\n${planResult.content}\n</plan>\n`
);

// buildGatePromptPhase7
return (
  REVIEWER_CONTRACT_BY_GATE[7] +
  `\n<spec>\n${specResult.content}\n</spec>\n\n` +
  `<plan>\n${planResult.content}\n</plan>\n\n` +
  `<eval_report>\n${evalResult.content}\n</eval_report>\n\n` +
  diffSection +
  externalSummary +
  '\n' +
  metadata
);
```

`assembleGateResumePrompt` / `buildResumeSections`는 **변경 없음**. spec §4.3 Strategy C에 따라 resume 프롬프트는 REVIEWER_CONTRACT를 포함하지 않음 (이미 세션 내 존재).

- [ ] **Step 4: Run new test**

```bash
pnpm vitest run tests/context/reviewer-contract.test.ts
```
Expected: 4 PASS.

- [ ] **Step 5: Run existing assembler tests + update snapshots if needed**

```bash
pnpm vitest run tests/context/assembler.test.ts
```
스냅샷 불일치 시:
1. 각 실패 diff를 수동으로 검토. 변경 내용이 전부 "REVIEWER_CONTRACT에 5축 rubric 추가됨" 같은 **의도된** 변화인지 확인.
2. `pnpm vitest run tests/context/assembler.test.ts -u`로 스냅샷 갱신.
3. 갱신된 스냅샷 파일을 `git diff`로 재검토.

- [ ] **Step 6: Lint + tsc**

```bash
pnpm lint
pnpm tsc --noEmit
```
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/context/assembler.ts tests/context/reviewer-contract.test.ts tests/context/__snapshots__/
git commit -m "feat(assembler): split REVIEWER_CONTRACT into per-gate 5-axis rubric"
```

---

## Task 4: Wrapper skill inline rendering in `assembleInteractivePrompt`

spec §7 Option A. Assembler가 wrapper 스킬 파일을 읽고 frontmatter 제거 후 변수 렌더링하여 phase-N.md 템플릿의 `{{wrapper_skill}}` placeholder에 주입한다.

**Files:**
- Modify: `src/context/assembler.ts:230-264` (`assembleInteractivePrompt`)
- Create: `tests/context/skills-rendering.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/context/skills-rendering.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { assembleInteractivePrompt } from '../../src/context/assembler.js';
import type { HarnessState } from '../../src/types.js';

function stubState(tmp: string): HarnessState {
  return {
    runId: 'run-abc',
    baseCommit: 'base',
    implCommit: null,
    evalCommit: null,
    externalCommitsDetected: false,
    verifiedAtHead: null,
    implRetryBase: '',
    artifacts: {
      spec: path.join(tmp, 'spec.md'),
      plan: path.join(tmp, 'plan.md'),
      decisionLog: path.join(tmp, 'decisions.md'),
      checklist: path.join(tmp, 'checklist.json'),
      evalReport: path.join(tmp, 'eval.md'),
    },
    phasePresets: { '2': 'codex-high', '4': 'codex-high', '7': 'codex-high' },
    phases: { '1': 'pending', '2': 'pending', '3': 'pending', '4': 'pending', '5': 'pending', '6': 'pending', '7': 'pending' },
    phaseCodexSessions: { '2': null, '4': null, '7': null },
    phaseAttemptId: { '1': 'att-111', '3': 'att-333', '5': 'att-555' },
    phaseOpenedAt: {},
    phaseReopenFlags: {},
    gateRetries: { '2': 0, '4': 0, '7': 0 },
    pendingAction: null,
  } as unknown as HarnessState;
}

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-')); });

describe('assembleInteractivePrompt wrapper skill inline', () => {
  it('phase 1 — inlines harness-phase-1-spec wrapper with vars rendered', () => {
    const state = stubState(tmp);
    const prompt = assembleInteractivePrompt(1, state, '/tmp/harness');
    // wrapper body present
    expect(prompt).toContain('harness Phase 1 — Spec writing');
    // #7 invariant visible to implementer
    expect(prompt).toContain('Open Questions');
    // variables rendered
    expect(prompt).toContain('run-abc');
    expect(prompt).toContain('att-111');
    // no unresolved vars
    expect(prompt).not.toContain('{{runId}}');
    expect(prompt).not.toContain('{{phaseAttemptId}}');
    expect(prompt).not.toContain('{{spec_path}}');
    // frontmatter stripped
    expect(prompt).not.toMatch(/^---\nname:/);
    expect(prompt).not.toContain('description: Use during harness-cli Phase 1');
  });

  it('phase 3 — inlines harness-phase-3-plan wrapper', () => {
    const state = stubState(tmp);
    const prompt = assembleInteractivePrompt(3, state, '/tmp/harness');
    expect(prompt).toContain('harness Phase 3 — Planning');
    expect(prompt).toContain('att-333');
    expect(prompt).toContain('superpowers:writing-plans');
    expect(prompt).toContain('checklist');
    expect(prompt).not.toContain('{{plan_path}}');
  });

  it('phase 5 — inlines harness-phase-5-implement wrapper with playbook refs', () => {
    const state = stubState(tmp);
    const prompt = assembleInteractivePrompt(5, state, '/tmp/harness');
    expect(prompt).toContain('harness Phase 5 — Implementation');
    expect(prompt).toContain('att-555');
    expect(prompt).toMatch(/context-engineering\.md/);
    expect(prompt).toMatch(/git-workflow-and-versioning\.md/);
    expect(prompt).toContain('superpowers:subagent-driven-development');
  });
});

describe('wrapper contract invariants — literal (per spec §4/§5)', () => {
  // spec §4/§5 outputs contract가 rendered prompt에 literal로 들어갔는지 확인.
  // loose string match만으로는 프롬프트가 잘못 그라운딩될 수 있음. 구체 경로/문구 그대로 검증.

  it('phase 1 — spec output artifact path + sentinel rule literal', () => {
    const state = stubState(tmp);
    state.runId = 'rid-1';
    state.artifacts.spec = '/abs/spec-out.md';
    state.artifacts.decisionLog = '/abs/decisions-out.md';
    const prompt = assembleInteractivePrompt(1, state, '/tmp/harness');
    // output artifacts rendered with their exact paths
    expect(prompt).toContain('/abs/spec-out.md');
    expect(prompt).toContain('/abs/decisions-out.md');
    // sentinel literal path + run-scoped
    expect(prompt).toMatch(/\.harness\/rid-1\/phase-1\.done/);
    // "sentinel 생성 후 추가 작업 금지" invariant literal
    expect(prompt).toMatch(/sentinel.*추가 작업 금지/);
    // Context & Decisions section requirement surfaced
    expect(prompt).toMatch(/Context & Decisions/);
  });

  it('phase 3 — plan + checklist paths + JSON schema literal + isolated-shell note', () => {
    const state = stubState(tmp);
    state.runId = 'rid-3';
    state.artifacts.plan = '/abs/plan-out.md';
    state.artifacts.checklist = '/abs/checklist-out.json';
    const prompt = assembleInteractivePrompt(3, state, '/tmp/harness');
    expect(prompt).toContain('/abs/plan-out.md');
    expect(prompt).toContain('/abs/checklist-out.json');
    expect(prompt).toMatch(/\.harness\/rid-3\/phase-3\.done/);
    // checklist schema literal (checks / name / command keys)
    expect(prompt).toMatch(/"checks"\s*:/);
    expect(prompt).toMatch(/"name"/);
    expect(prompt).toMatch(/"command"/);
    // qa #4 isolated-shell guidance literal
    expect(prompt).toMatch(/격리된 셸 환경/);
  });

  it('phase 5 — commit-per-task rule + sentinel-after-all-commits + playbook absolute refs', () => {
    const state = stubState(tmp);
    state.runId = 'rid-5';
    const prompt = assembleInteractivePrompt(5, state, '/tmp/harness');
    expect(prompt).toMatch(/\.harness\/rid-5\/phase-5\.done/);
    // "After each task completes, git commit" override literal
    expect(prompt).toMatch(/After each task completes, git commit/);
    // "sentinel 이전에 모든 변경사항이 git에 커밋" invariant literal
    expect(prompt).toMatch(/sentinel 이전에 모든 변경사항이.*커밋/);
    // playbook @-references resolved literally (context-engineering + git-workflow)
    expect(prompt).toMatch(/playbooks\/context-engineering\.md/);
    expect(prompt).toMatch(/playbooks\/git-workflow-and-versioning\.md/);
  });
});
```

Run:
```bash
pnpm vitest run tests/context/skills-rendering.test.ts
```
Expected: FAIL (wrapper content not yet inlined).

- [ ] **Step 2: Implement wrapper skill reader + inline in assembler**

`src/context/assembler.ts` — `readTemplateFile` 아래에 추가:
```typescript
const WRAPPER_SKILL_BY_PHASE: Record<1 | 3 | 5, string> = {
  1: 'harness-phase-1-spec.md',
  3: 'harness-phase-3-plan.md',
  5: 'harness-phase-5-implement.md',
};

function readWrapperSkill(phase: 1 | 3 | 5): string {
  const skillPath = path.join(__dirname, 'skills', WRAPPER_SKILL_BY_PHASE[phase]);
  const raw = fs.readFileSync(skillPath, 'utf-8');
  // Strip YAML frontmatter (--- ... ---)
  return raw.replace(/^---\n[\s\S]*?\n---\n?/, '');
}
```

`assembleInteractivePrompt` 본문 교체:
```typescript
export function assembleInteractivePrompt(
  phase: 1 | 3 | 5,
  state: HarnessState,
  harnessDir: string
): string {
  const phaseAttemptId = state.phaseAttemptId[String(phase)] ?? '';
  const taskMdPath = path.join('.harness', state.runId, 'task.md');

  const feedbackPaths = state.pendingAction?.feedbackPaths ?? [];
  const feedbackPath = feedbackPaths[0];
  const feedbackPathsList = feedbackPaths
    .map((p) => `- 이전 피드백 (반드시 반영): ${p}`)
    .join('\n');

  const vars: Record<string, string | undefined> = {
    task_path: taskMdPath,
    spec_path: state.artifacts.spec,
    decisions_path: state.artifacts.decisionLog,
    plan_path: state.artifacts.plan,
    checklist_path: state.artifacts.checklist,
    runId: state.runId,
    phaseAttemptId,
    feedback_path: feedbackPath,
    feedback_paths: feedbackPathsList.length > 0 ? feedbackPathsList : undefined,
    harnessDir,
  };

  // Render the wrapper skill (vars rendered; frontmatter already stripped in reader)
  const wrapperSkillRendered = renderTemplate(readWrapperSkill(phase), vars);

  // Render phase-N.md template, injecting the rendered wrapper skill into {{wrapper_skill}}
  const phaseTemplate = readTemplateFile(`phase-${phase}.md`);
  return renderTemplate(phaseTemplate, { ...vars, wrapper_skill: wrapperSkillRendered });
}
```

- [ ] **Step 3: Run test**

```bash
pnpm vitest run tests/context/skills-rendering.test.ts
```
Expected: 3 PASS.

**주의**: 이 시점에 기존 `phase-N.md`는 아직 thin 처리되지 않은 상태 → `{{wrapper_skill}}` placeholder가 없음. 테스트는 wrapper content가 최종 결과에 포함되는지만 확인하므로, 현 phase-N.md에 placeholder가 없다면 wrapper 내용이 누락됨 → 이 테스트는 Task 5 전까지 FAIL일 수 있음. 그 경우 **임시로** Task 5를 먼저 수행 (placeholder만 추가) 후 여기 돌아와 PASS 확인해도 된다. 또는 Task 5까지 함께 묶어 한 번에 commit.

권장 순서: Task 4 Step 2까지 구현 → Task 5 Step 2~4로 phase-N.md에 `{{wrapper_skill}}` 추가 → Task 4 Step 3 실행 → Task 4 Step 4 commit → Task 5 Step 6 commit.

- [ ] **Step 4: Commit (Task 5 이후)**

Task 5 완료 후:
```bash
git add src/context/assembler.ts tests/context/skills-rendering.test.ts
git commit -m "feat(assembler): inline wrapper skill into interactive prompt (Phase 1/3/5)"
```

---

## Task 5: Thin `phase-N.md` templates to wrapper binding

phase-N.md는 `{{wrapper_skill}}` placeholder + harness runtime 변수 목록만 남긴다.

**Files:**
- Modify: `src/context/prompts/phase-1.md`
- Modify: `src/context/prompts/phase-3.md`
- Modify: `src/context/prompts/phase-5.md`

- [ ] **Step 1: Backup existing prompt bodies (검토용, 커밋 안 함)**

```bash
mkdir -p .tmp-prompt-backup
cp src/context/prompts/phase-{1,3,5}.md .tmp-prompt-backup/
echo '.tmp-prompt-backup/' >> .git/info/exclude
```
(`.git/info/exclude`를 쓰면 `.gitignore` 커밋 안 해도 됨.)

- [ ] **Step 2: Rewrite `src/context/prompts/phase-1.md`**

```markdown
{{wrapper_skill}}

---

## Harness Runtime Context (reference)

- runId: `{{runId}}`
- phaseAttemptId: `{{phaseAttemptId}}`
- task spec path: `{{task_path}}`
- spec output path: `{{spec_path}}`
- decisions log path: `{{decisions_path}}`
{{#if feedback_path}}
- previous feedback: `{{feedback_path}}`
{{/if}}

위 wrapper 스킬을 먼저 읽고 Process 순서 그대로 따른다. Invariants 섹션의 sentinel 규칙을 반드시 준수.
```

- [ ] **Step 3: Rewrite `src/context/prompts/phase-3.md`**

```markdown
{{wrapper_skill}}

---

## Harness Runtime Context (reference)

- runId: `{{runId}}`
- phaseAttemptId: `{{phaseAttemptId}}`
- spec path: `{{spec_path}}`
- decisions log: `{{decisions_path}}`
- plan output path: `{{plan_path}}`
- checklist output path: `{{checklist_path}}`
{{#if feedback_path}}
- previous feedback: `{{feedback_path}}`
{{/if}}

위 wrapper 스킬의 Process 순서를 준수. Checklist JSON 스키마를 정확히 따르고, sentinel은 최종 단계에서만 생성.
```

- [ ] **Step 4: Rewrite `src/context/prompts/phase-5.md`**

```markdown
{{wrapper_skill}}

---

## Harness Runtime Context (reference)

- runId: `{{runId}}`
- phaseAttemptId: `{{phaseAttemptId}}`
- spec path: `{{spec_path}}`
- plan path: `{{plan_path}}`
- decisions log: `{{decisions_path}}`
- checklist path: `{{checklist_path}}`
{{#if feedback_paths}}
- previous feedback(s):
{{feedback_paths}}
{{/if}}

위 wrapper 스킬의 Process 순서 및 Invariants 섹션(git commit 규율, sentinel 타이밍)을 준수.
```

- [ ] **Step 5: Run full test suite**

```bash
pnpm vitest run
```
Expected: 모두 PASS. 일부 기존 snapshot이 `REVIEWER_CONTRACT_BY_GATE` 이행 + `{{wrapper_skill}}` placeholder 주입으로 깨질 수 있음 → 수동 검토 후 `-u`.

- [ ] **Step 6: Lint + tsc**

```bash
pnpm lint
pnpm tsc --noEmit
```

- [ ] **Step 7: Clean up + commit**

```bash
rm -rf .tmp-prompt-backup
git add src/context/prompts/ tests/context/__snapshots__/
git commit -m "refactor(prompts): thin phase-1/3/5 templates to wrapper skill binding"
```

---

## Task 6: Build packaging — `dist` includes skills + playbooks

`scripts/copy-assets.mjs`의 assets 배열에 2개 항목 추가.

**Files:**
- Modify: `scripts/copy-assets.mjs`

- [ ] **Step 1: Extend assets array**

`scripts/copy-assets.mjs`의 `const assets = [...]` 블록을 다음으로 교체:
```javascript
const assets = [
  { from: 'src/context/prompts',   to: 'dist/src/context/prompts',   recursive: true },
  { from: 'src/context/skills',    to: 'dist/src/context/skills',    recursive: true },
  { from: 'src/context/playbooks', to: 'dist/src/context/playbooks', recursive: true },
  { from: 'scripts/harness-verify.sh', to: 'dist/scripts/harness-verify.sh', recursive: false, executable: true },
];
```

- [ ] **Step 2: Clean + rebuild**

```bash
rm -rf dist
pnpm build
```
Expected: 빌드 로그에 `[copy-assets] copied src/context/skills -> dist/src/context/skills`, `... playbooks -> ...` 포함.

- [ ] **Step 3: Verify dist structure**

```bash
ls dist/src/context/
ls dist/src/context/skills/
ls dist/src/context/playbooks/
```
Expected:
- `dist/src/context/` 하위에 `prompts/`, `skills/`, `playbooks/` 3개 디렉터리
- `skills/`에 `harness-phase-{1,3,5}-*.md` 3개 파일
- `playbooks/`에 `VENDOR.md`, `LICENSE-agent-skills.md`, `context-engineering.md`, `git-workflow-and-versioning.md` 4개

- [ ] **Step 4: Runtime smoke — global `harness` binary picks up new assets**

현재 세션의 `~/Library/pnpm/harness`는 `~/Desktop/projects/harness/harness-cli/dist/...`를 가리킨다 (globally linked). 새 빌드를 linked copy에 반영해야 함:
```bash
# If this repo is the linked source:
pnpm link --global
# OR if separate: rsync dist/ to the linked location.
harness --help 2>&1 | head -5
```
Expected: `harness --help`이 에러 없이 출력.

- [ ] **Step 5: Commit**

```bash
git add scripts/copy-assets.mjs
git commit -m "build: copy skills + playbooks into dist for runtime access"
```

---

## Task 7: Final E2E verification + docs

프롬프트 크기 검증, #7 invariant 명시 assertion, 문서 업데이트.

**Files:**
- Modify: `tests/context/skills-rendering.test.ts` — e2e assertions 추가
- Modify: `docs/HOW-IT-WORKS.md` — 3-layer 아키텍처 단락 추가

- [ ] **Step 1: Add size guard + #7 explicit check to `tests/context/skills-rendering.test.ts`**

파일 하단에 추가:
```typescript
describe('prompt size and qa-integration guards', () => {
  it('phase 5 prompt (largest) stays well under a generous ceiling', () => {
    const state = stubState(tmp);
    const prompt = assembleInteractivePrompt(5, state, '/tmp/harness');
    // MAX_PROMPT_SIZE_KB is 64KB per config. Wrapper+vars+context must fit comfortably.
    expect(prompt.length).toBeLessThan(60 * 1024);
  });

  it('phase 1 wrapper surfaces Open Questions requirement (qa #7)', () => {
    const state = stubState(tmp);
    const prompt = assembleInteractivePrompt(1, state, '/tmp/harness');
    expect(prompt).toMatch(/Open Questions/);
    expect(prompt).toMatch(/P1/);  // gate severity warning for missing section
    // Wrapper body mentions Open Questions in both Context (gate-level) and Invariants — at least 2 hits
    expect((prompt.match(/Open Questions/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('resume-smoke — pre-rev-3 state.json loads and re-renders under rev-3 wrapper without error (spec §11 force-rev-3 decision)', () => {
    // Simulate: a run that started pre-rev-3 is resumed. state.json has no wrapper-specific fields
    // (wrapper 구조는 phaseCodexSessions 같은 state 변경 없음 — spec §11 보장). 현 assembler가
    // 기존 state를 받아 new wrapper 템플릿으로 문제없이 렌더되는지 smoke-check.
    const legacyState = stubState(tmp);
    // 기존 run state는 artifact 경로에 .harness/<runId>/... 형태만 가짐 (스키마 v1 동일)
    legacyState.runId = 'legacy-run-id';
    legacyState.artifacts.spec = path.join('.harness', 'legacy-run-id', 'spec.md');
    legacyState.artifacts.plan = path.join('.harness', 'legacy-run-id', 'plan.md');
    legacyState.artifacts.decisionLog = path.join('.harness', 'legacy-run-id', 'decisions.md');
    legacyState.artifacts.checklist = path.join('.harness', 'legacy-run-id', 'checklist.json');
    legacyState.phaseAttemptId = { '1': 'legacy-a1', '3': 'legacy-a3', '5': 'legacy-a5' };

    for (const phase of [1, 3, 5] as const) {
      const prompt = assembleInteractivePrompt(phase, legacyState, '/tmp/harness');
      // 렌더 성공 + runId/attemptId/경로가 프롬프트에 올바르게 들어감
      expect(prompt.length).toBeGreaterThan(100);
      expect(prompt).toContain('legacy-run-id');
      expect(prompt).toContain(`legacy-a${phase}`);
      expect(prompt).not.toContain('{{runId}}');
      expect(prompt).not.toContain('{{phaseAttemptId}}');
    }
  });
});
```

- [ ] **Step 2: Run test**

```bash
pnpm vitest run tests/context/skills-rendering.test.ts
```
Expected: 5 total PASS.

- [ ] **Step 3: Update `docs/HOW-IT-WORKS.md`**

기존 "Interactive phase" 섹션 근처(혹은 "Prompt assembly" 섹션)에 다음 단락을 추가:

```markdown
### Phase 1/3/5 Wrapper Skill Layer (2026-04-18 rev)

Interactive phase 프롬프트는 3-layer 구조로 조립된다:

1. **phase-N.md template** (`src/context/prompts/`) — thin binding. `{{wrapper_skill}}` placeholder와 harness runtime 변수(runId, phaseAttemptId, artifact 경로 등) 선언만.
2. **Wrapper skill** (`src/context/skills/harness-phase-{1,3,5}-*.md`) — harness 특화 process (대응 superpowers 스킬 호출 + 오버라이드, sentinel 규칙, #7 Open Questions 같은 gate invariant 명시). `assembleInteractivePrompt`가 frontmatter를 제거하고 변수 렌더링 후 placeholder에 inline.
3. **Auxiliary playbooks** (`src/context/playbooks/`) — agent-skills에서 vendored된 원칙 문서 2건. Phase 5 wrapper에서 `@` 표기로 참조.

Gate 프롬프트는 별도 레이어: `REVIEWER_CONTRACT_BY_GATE`가 base contract + `FIVE_AXIS_{SPEC,PLAN,EVAL}_GATE` rubric을 gate별로 조립.
```

- [ ] **Step 4: Final suite + lint + tsc**

```bash
pnpm vitest run
pnpm lint
pnpm tsc --noEmit
```
Expected: 전부 clean.

- [ ] **Step 5: Commit**

```bash
git add tests/context/skills-rendering.test.ts docs/HOW-IT-WORKS.md
git commit -m "test(skills): prompt size guard + Open Questions invariant; docs: wrapper skill layer"
```

---

## Eval Checklist

Phase 6 verify용 머신 판독 checklist. Plan 구현 완료 시 `.harness/<runId>/checklist.json`으로 저장. 각 command는 격리된 셸에서 실행됨을 전제 (qa #4 반영).

```json
{
  "checks": [
    { "name": "TypeScript compile clean", "command": "pnpm tsc --noEmit" },
    { "name": "Full test suite",          "command": "pnpm vitest run" },
    { "name": "Build produces skills/playbooks in dist",
      "command": "pnpm build && test -d dist/src/context/skills && test -d dist/src/context/playbooks && ls dist/src/context/skills/harness-phase-1-spec.md dist/src/context/skills/harness-phase-3-plan.md dist/src/context/skills/harness-phase-5-implement.md" },
    { "name": "Reviewer contract 5-axis per gate",
      "command": "pnpm vitest run tests/context/reviewer-contract.test.ts" },
    { "name": "Wrapper skill inlined in interactive prompt",
      "command": "pnpm vitest run tests/context/skills-rendering.test.ts" },
    { "name": "Open Questions invariant present (qa #7)",
      "command": "grep -q 'Open Questions' src/context/skills/harness-phase-1-spec.md && grep -q 'Open Questions' src/context/assembler.ts" },
    { "name": "Playbook VENDOR pin documented",
      "command": "grep -q 'Pinned SHA' src/context/playbooks/VENDOR.md" },
    { "name": "Playbook LICENSE present",
      "command": "grep -q 'MIT License' src/context/playbooks/LICENSE-agent-skills.md" },
    { "name": "phase-N.md thinned to wrapper binding",
      "command": "test $(wc -l < src/context/prompts/phase-1.md) -lt 30 && test $(wc -l < src/context/prompts/phase-3.md) -lt 30 && test $(wc -l < src/context/prompts/phase-5.md) -lt 30" }
  ]
}
```

---

## Open Questions (구현 중 해소)

1. **upstream `addyosmani/agent-skills` 실제 디렉터리 구조** — Task 1 Step 2에서 `tree` API로 확인. 경로가 예상(`skills/<name>/SKILL.md`)과 다르면 curl URL 수정.
2. **`tests/context/assembler.test.ts` 기존 snapshot 수 깨짐 범위** — Task 3 Step 5에서 수동 검토. 모두 **의도된** 5축 rubric 추가 or `{{wrapper_skill}}` placeholder 주입으로 설명 가능한지 확인 후 `-u`.
3. **`pnpm link --global` 필요성** — Task 6 Step 4. 이미 linked라면 rebuild만으로 반영될 수 있음. `readlink ~/Library/pnpm/harness`로 확인.
4. **`/harness` 슬래시 커맨드 스킬 업데이트 여부** — spec §9 Option A/B/C. 본 plan 범위 **밖**. 결정은 implementation 완료 후.
5. **Claude 플러그인 배포** — spec §8 follow-up. 별도 PR.
6. **`test-todo` 등 dog-fooding project에 새 assembler 적용 타이밍** — 이 repo의 `harness` CLI 빌드/링크 경로가 독립 — dog-food 프로젝트는 새 dist를 참조만 하면 됨.

## TODO — Deferred from gate-plan review (2026-04-18, Codex round 1) — RESOLVED 2026-04-18

사용자 preference에 따라 P1만 수정·재검증하고 P2는 본 섹션에 기록 후 진행한다. Implementation 진입 시점(2026-04-18 skills-synth 브랜치 시작)에 다음과 같이 확정:

- **[P2] Task dependency graph 일관성** (Codex flagged) — **RESOLVED**: Option 1/2 모두 기각. Graph의 `T3 → T4 → T5`를 conceptual dependency로 유지하고, 실제 실행 순서(`T4 Step 1–2 → T5 Step 2–4 → T4 Step 3`)를 "Parallelization 기회" 섹션에 명시. 근거: Option 1 reorder는 T5 thin binding이 T4 assembler 렌더링 로직에 의존하므로 성립 안 함. Option 2 merge는 단일 commit의 atomic 크기를 비대화시켜 리뷰 비용 증가.

- **[P2] Eval checklist lint duplication** (Codex flagged) — **RESOLVED**: `ESLint clean` 항목 삭제. 근거: `package.json`에서 `"lint": "tsc --noEmit"` alias이므로 `TypeScript compile clean`과 동일 signal. 중복 제거가 가장 간단한 해결.

---

## Handoff Notes

- **Plan이 완료되면** 이 문서를 Spec/Plan gate(Phase 4 Codex review) 대상으로 넘긴다: `codex-gate-review --gate plan --spec docs/specs/2026-04-18-harness-skills-synthesis-design.md --plan docs/plans/2026-04-18-harness-skills-synthesis.md`.
- **구현 주체**: `superpowers:subagent-driven-development` 권장. Task 1~7을 순차로 subagent에 dispatch.
- **병렬화**: Task 1·Task 2는 동시 dispatch 가능(파일 독립). Task 3·4·5는 assembler/prompts를 연속 건드리므로 serial.
- **우선 완료 블록**: Task 1~2 이 모두 끝나야 Task 6이 의미 있는 dist를 만든다. Task 3~5는 assembler/prompts refactor의 단일 PR 단위로도 모을 수 있음.
