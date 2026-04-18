# harness-skills 합성 — Intent / Handoff

- 상태: design-only (코드 변경 없음) — **rev 3** (wrapper-skill pivot)
- 작성일: 2026-04-18
- 브랜치: `compare` (worktree: `~/.grove/github.com/DongGukMon/harness-cli/worktrees/compare`)
- 관련 문서:
  - Design spec: `docs/specs/2026-04-18-harness-skills-synthesis-design.md` (rev 3)
  - 생태계: `~/.claude/skills/harness/SKILL.md`, `docs/specs/2026-04-14-claude-harness-skill-design.md`
  - 외부 참조: [`addyosmani/agent-skills`](https://github.com/addyosmani/agent-skills) MIT, superpowers (이미 설치된 `claude-plugins-official` 플러그인)

---

## 이 문서의 목적

다른 세션(또는 리뷰어, 다른 브랜치에서 충돌 해결 중인 나 자신)이 이 작업을 **맥락 없이 시작해도** 의도와 결정사항을 1분 안에 복원할 수 있게 만드는 핸드오프 문서다. 설계 상세는 옆의 design spec에 있고, 이 문서는 "왜 / 무엇을 / 지금 어디까지 / 어떻게 이어갈지"의 인덱스 역할만 한다.

---

## 왜 (Why)

세 생태계가 각자 다른 약점을 갖고 있다:

- **harness-cli** (이 레포): 외부 런타임으로 프로세스를 강제하지만, **단계 *내부*의 working discipline이 비어있음** (phase-N.md 프롬프트가 "구현하라" 수준).
- **superpowers** (`claude-plugins-official`): 브레인스토밍/계획/TDD 같은 의식(ritual)은 풍부하지만, harness의 고유 contract(sentinel, `Context & Decisions`, checklist.json 스키마)를 모른다.
- **agent-skills** (`addyosmani/agent-skills`): 20개 도메인/프로세스 플레이북이 있지만, 강제 메커니즘이 없고 harness와 연결점도 없다.

**세 기준**(사용자 명시)에 따라 합성 방향을 잡는다:
1. superpowers와 agent-skills가 **충돌 안 나야** 한다
2. **외부 의존을 최소화**한다
3. **과한 skills가 병목**이 되지 않아야 한다

---

## 무엇을 (What)

**합성 이름**: `harness-skills` (작업명, 제품명 아님)

**rev 3 방향 — 중간안 (wrapper 스킬 신설)**:

harness-cli에 fit한 **wrapper 스킬 3종**을 신설하고, 그 안에서 superpowers를 호출하면서 harness-specific 오버라이드를 전달한다.

```
Layer A (prompt)   — phase-N.md: 변수 바인딩만, thin
      ↓ @ 참조
Layer B (skills)   — harness-phase-1-spec.md
                     harness-phase-3-plan.md
                     harness-phase-5-implement.md
      ↓ 호출 / @ 참조
Layer C (외부)     — superpowers:brainstorming / writing-plans / subagent-driven
                     src/context/playbooks/{context-engineering,git-workflow-and-versioning}.md
```

Gate 레이어(Phase 2/4/7)는 별개: `REVIEWER_CONTRACT_BY_GATE`에 5축 루브릭 subset을 인라인. Codex는 스킬을 invoke하지 않고 reviewer contract를 직접 읽음.

Phase 6(`harness-verify.sh`)은 건드리지 않음 (셸 결정론 유지).

### 세 기준 충족 방식

| 기준 | rev-3 실현 |
|---|---|
| 충돌 방지 | wrapper가 phase당 유일한 진입점 → 한 목소리 |
| 외부 의존 최소화 | superpowers는 이미 `/harness`의 prerequisite — 신규 의존 없음. wrapper가 superpowers 호출을 투명하게 만듦 |
| 병목 방지 | wrapper 본문 자체가 얇음(~2-4KB). playbook은 Phase 5에만 2개, @ 참조로 lazy 로드 |

---

## 결정 요약 (Q&A trail)

브레인스토밍과 rev-2, rev-3 단계에서 확정한 축.

| 질문 | 선택 | 의미 |
|---|---|---|
| **Q1. 이번 세션 산출물 범위** | **A** (설계 문서만) | 코드/스킬 본문 작성 없음. 다음 세션에서 태스크 리스트업 + 리소스 분배 후 구현 |
| **Q2. 합성 축 범위** | **B** (Interactive + Gate) | Phase 1/3/5 + 2/4/7 모두. 도메인 자동 선택(C) 제외 |
| ~~Q3. 플레이북 소비 방식 (v1)~~ | ~~A (vendor 8개)~~ | rev-3에서 Q5로 대체. 폐기 |
| **Q4. superpowers 공존 (rev 2)** | 중복 제거 + vendor 최소화 | 세 기준 도입. rev-2까지는 vendor 2개로 축소 |
| **Q5. 구현 전략 (rev 3)** | **중간안 (wrapper 스킬)** | harness-phase-{1,3,5} 스킬 신설. 내부에서 superpowers 호출. 풀 재작성 대비 작업비 ~1/3 |

재협상 여지는 있지만, 재협상하려면 design spec의 해당 섹션을 수정하고 본 문서 `계보` 섹션에 변경 이력 append할 것.

---

## 지금 어디까지 (Current state)

- [x] 양쪽 프로젝트 구조 파악 및 비교 분석
- [x] 합성 범위 협의 (Q1/Q2 결정)
- [x] rev-1 설계 섹션별 승인 (Layer 1/2 injection)
- [x] superpowers 생태계 확인 → rev-2로 범위 축소 (Q4, 2→vendor)
- [x] 중간안 pivot 결정 → rev-3 (Q5, wrapper 스킬)
- [x] Design spec 작성 완료 (rev 3)
- [x] Intent/handoff 문서 작성 완료 (본 문서)
- [ ] 태스크 리스트업 + 리소스 분배 — **다음 세션**
- [ ] 3개 wrapper 스킬 본문 작성
- [ ] 2개 playbook vendor (VENDOR.md/LICENSE 포함)
- [ ] `assembler.ts` refactor + phase-N.md thinning
- [ ] `/harness` 스킬 업데이트 결정 (§9 Option A/B/C)
- [ ] 테스트 추가

---

## 다른 세션에서 이어가려면 (Re-entry 순서)

콜드 세션이 이 작업을 이어받을 때 아래 순서로 읽으면 30-60초 내 맥락 복구:

1. **본 문서 (INTENT.md)** — 전체 그림, rev 이력, 결정 트레일
2. **design spec §1-2** — 배경·목표와 결정(Q1-Q5) 재현
3. **design spec §3** — 3-layer 아키텍처
4. **design spec §5** — 3개 wrapper 스킬 skeleton (본문 작성의 출발점)
5. **design spec §13** — 다음 세션 작업 스코프 개요
6. **`src/context/assembler.ts`** — refactor 대상
7. **`src/context/prompts/phase-{1,3,5}.md`** — thin binding으로 축약 대상
8. **`~/.claude/skills/harness/SKILL.md`** — 기존 /harness 스킬, §9 관계 설계 대상
9. `docs/HOW-IT-WORKS.md` — 필요 시 전체 파이프라인 보강

---

## 코드베이스 앵커 포인트 (rev 3)

구현 세션이 손대야 할 지점들. 파일 단위로 고정.

| 경로 | 역할 | 수정 여부 |
|---|---|---|
| `src/context/skills/` | (신설) wrapper 스킬 3개 | 신설 — harness-phase-{1,3,5}-*.md |
| `src/context/playbooks/` | (신설) agent-skills vendor 2개 + VENDOR/LICENSE | 신설 — context-engineering, git-workflow-and-versioning |
| `src/context/prompts/phase-1.md` | Phase 1 템플릿 | 단축 (wrapper 스킬 참조로) |
| `src/context/prompts/phase-3.md` | Phase 3 템플릿 | 단축 |
| `src/context/prompts/phase-5.md` | Phase 5 템플릿 | 단축 |
| `src/context/assembler.ts:19` | `REVIEWER_CONTRACT` 상수 | `REVIEWER_CONTRACT_BY_GATE`로 분기 + `FIVE_AXIS_*` 상수 |
| `src/context/assembler.ts:228` | `assembleInteractivePrompt` | wrapper 스킬 read·render·inline 로직 |
| `src/runners/claude.ts` | Claude CLI 런칭 | 변경 없음 |
| `src/phases/*.ts` | 단계 루프 및 verify | 변경 없음 |
| `scripts/harness-verify.sh` | Phase 6 결정론 평가 | 변경 없음 |
| `~/.claude/skills/harness/SKILL.md` | `/harness` 슬래시 커맨드 스킬 | 선택적 (§9 Option B/C) |
| `package.json` | 빌드 files 배열 | 추가 — skills/, playbooks/를 dist에 포함 |

---

## 예상 충돌 지점 및 대응 (rev 3)

1. **다른 PR이 `phase-N.md`를 수정한 경우** → rev-3은 phase-N.md를 대폭 축약하는 방향이므로 단순 병합 불가. design spec §7(프롬프트 변경)의 "변경 후" 예시를 기준으로 기존 지시를 wrapper 스킬로 이동시키며 수동 병합.
2. **`assembler.ts`의 `REVIEWER_CONTRACT` 또는 `assembleInteractivePrompt` 수정** → rev-3가 둘 다 리팩터링. design spec §6, §7 참고. 기존 변경을 `REVIEWER_CONTRACT_BASE` 또는 wrapper 렌더링 로직에 흡수.
3. **`/harness` 스킬이 다른 브랜치에서 수정된 경우** → rev-3 §9 Option 선택에 따라 처리. 기본 Option A(`/harness` 유지)를 선택하면 충돌 없음.
4. **agent-skills upstream 변경** → VENDOR.md의 고정 SHA 기준으로 copy 유지. 업데이트는 수동, PR에서 diff 리뷰 필수.
5. **superpowers 인터페이스 변경** → wrapper 스킬은 `superpowers:brainstorming` 등을 **이름으로 호출**. superpowers가 해당 스킬을 rename/remove하면 wrapper 수정 필요. 생태계 변화는 rev-4 트리거.
6. **범위 재협상 (도메인 추가, Gate wrapper 등)** → design spec §12(향후 확장)으로 이동. 본 문서 결정 요약에 Q6… append.

---

## 계보 (Lineage)

- 2026-04-18 — 대화: 두 프로젝트 input→output 프로세스 비교 분석
- 2026-04-18 — 결정: Q1=A(문서만), Q2=B(Interactive+Gate)
- 2026-04-18 — 설계 rev 1: vendor 8개 + Phase 1/3/5 전면 주입 + 5축 루브릭
- 2026-04-18 — 발견: `/harness` 스킬이 superpowers prerequisite로 호출 중 + 기준 3가지(충돌/외부의존/병목) 명시
- 2026-04-18 — 설계 rev 2: 중복 제거, vendor 2개로 축소, Phase 5만 주입 (Q4)
- 2026-04-18 — 방향 재검토: 중간안(wrapper 스킬) 제안
- 2026-04-18 — 설계 rev 3: wrapper 스킬 3개 신설. superpowers 호출은 wrapper 내부로. 3-layer 아키텍처 (Q5)
- 2026-04-18 — 산출: 본 INTENT.md + design spec (rev 3)
