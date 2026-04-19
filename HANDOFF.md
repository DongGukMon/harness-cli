# HANDOFF — Group B: Wrapper-skill pre-sentinel self-audit + P1-only triage

**Paused at**: 2026-04-19 11:30 local
**Worktree**: /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/wrapper-self-audit
**Branch**: feat/wrapper-self-audit
**Base prompt**: (Group B 프롬프트는 사용자 메시지로만 전달됨 — 원본 txt 파일 없음. 주요 goal은 아래 "Decisions made" 참조)
**Reason**: token exhaustion / account switch

## Completed commits (이 worktree에서)

`git log --oneline origin/main..HEAD`:

- 8164eb8 wip(spec): wrapper self-audit + P1-only design after gate-1 R1 fixes

(origin/main @ 849d8fe에서 fork)

## In-progress state

- **현재 task**: TaskList #1 — Run codex-gate-review on spec, **Round 2 재제출 대기**
- **마지막 완료 step**: Round 1 REJECT(1P0+3P1+2P2) → spec 수정 → WIP commit
- **중단 직전 하던 action**: `/tmp/gate-spec-round2.txt` 조립 완료 (324 lines).
  Codex 실행 커맨드:
  ```bash
  PROMPT=$(cat /tmp/gate-spec-round2.txt) && \
    node /Users/daniel/.claude/plugins/cache/openai-codex/codex/1.0.3/scripts/codex-companion.mjs \
      task --effort high "$PROMPT"
  ```
  이 커맨드를 실행하면 Round 2 verdict를 받을 수 있음. **`/tmp/gate-spec-round2.txt`는 세션 재시작 후 사라질 수 있음** — 필요시 아래 "Resume instructions"의 방법대로 재조립.
- **테스트 상태**: 미실행 (spec-only 변경, 코드 미수정). baseline: 617 passed / 1 skipped (`pnpm vitest run` @ 849d8fe).
- **빌드 상태**: `pnpm install` + `pnpm build` 완료 (dist 생성됨).
- **uncommitted 잔여물**: none. HANDOFF.md만 미커밋 (아래 단계에서 별도 커밋).

## Decisions made this session

- **[Round 1 P0 해소]** Phase 5 spec-bug escalation 채널을 "커밋 메시지 trailer"에서 "plan doc `## Deferred` 섹션 append"로 변경. 근거: `buildPhase7DiffAndMetadata`(`src/context/assembler.ts:253-310`) 실측 확인 결과 Gate 7은 `git diff`만 사용하고 커밋 메시지는 읽지 않음. `<plan>` 블록은 Gate 7에 포함되므로 plan 하단 `## Deferred` append가 skill-only로 도달 가능한 유일 채널.

- **[Round 1 P1-a 해소]** Phase 5 self-audit commit range를 `baseCommit..HEAD`로 pin. Gate 7 metadata가 `baseCommit..implCommit (Phase 1–5 commits)` 범위를 리뷰하므로 동일 범위로 맞춰야 audit-gate 일관성이 확보됨 (`implRetryBase..HEAD` 후보는 범위 불일치로 기각).

- **[Round 1 P1-b 해소]** Self-audit 입력을 구체화: (a) spec의 `## Success Criteria` / `## Invariants` 섹션의 grep/regex 규칙, (b) plan의 eval checklist `checks[].command` (이미 shell-executable). "machine-checkable invariants"라는 추상 표현을 구체 artifact로 대체.

- **[Round 1 P1-c 해소]** P2/deferred 채널을 phase별로 하나씩 고정: Phase 1 → spec `## Deferred`, Phase 3 → plan `## Deferred`, Phase 5 → plan `## Deferred` append + 별도 `plan: append deferred item` 커밋. "artifact 없이 gate feedback" 표현 제거.

- **[Round 1 P2 반영]** SC11 (`40× local grep` 문구), SC12 (`sentinel` 타이밍), SC13 (`baseCommit..HEAD` range), SC14 (`spec-bug:` + `## Deferred` 채널) 4개 regex 가드 추가. R5a로 다중 feedback 충돌 규칙 추가 (highest severity wins).

- **[Scope pin]** Assembler 코드 변경 없음 (§Non-goals + Decision 5). `src/context/skills/harness-phase-{1,3,5}-*.md` 3개 파일 + `tests/context/skills-rendering.test.ts`만 수정 예정.

## Open questions / blockers

- **[질문]** Round 2에서 Codex가 여전히 reject하면 Round 3까지 진행. 자율 모드 rule: 동일 안건 4회 거절 시 강제 통과. 현재까지 Round 1만 수행했으므로 최대 3회 남음.

- **[관측 과제]** Spec §Open Questions #6 — `git log baseCommit..HEAD --format` 섹션을 Gate 7 prompt에 추가하는 후속 PR은 §Deferred 5번에 등록됨. 이번 PR 범위 아님.

- **[blocker]** none.

## Next concrete steps (ordered)

1. Round 2 Codex 실행: `PROMPT=$(cat /tmp/gate-spec-round2.txt) && node /Users/daniel/.claude/plugins/cache/openai-codex/codex/1.0.3/scripts/codex-companion.mjs task --effort high "$PROMPT"`
   - `/tmp/gate-spec-round2.txt` 없으면 `HANDOFF.md` §"Resume instructions → 재조립 방법" 따라 재생성.

2. Verdict 처리:
   - `APPROVE`: TaskUpdate #1 completed → Task #2 in_progress → `superpowers:writing-plans` 스킬 invoke해서 `docs/plans/2026-04-19-wrapper-self-audit.md` 작성.
   - `REJECT`: P1-only 정책 적용(P0+P1만 반영, P2는 `## Deferred` append) → spec 수정 → Round 3 재제출.

3. Plan 작성 시 5 slice 구성 (원 prompt 지침 따름):
   - slice 1: Phase 1 skill 수정 + 테스트
   - slice 2: Phase 3 skill 수정 + 테스트
   - slice 3: Phase 5 skill 수정 + 테스트
   - slice 4: (optional) assembler stanza — 이번엔 Deferred로 skip
   - slice 5: E2E snapshot 가드

4. Plan gate-review (Task #3) → APPROVE → implementation TDD (Task #4-6).

5. 구현 완료 후 `pnpm tsc/vitest/build` + `codex-gate-review --gate eval` → PR.

## Resume instructions

새 세션 시작 시 **첫 프롬프트로 이걸 그대로 붙여넣기**:

> 이 worktree는 Group B(Wrapper-skill pre-sentinel self-audit + P1-only triage)의 작업을 진행 중이다. 다음 순서로 컨텍스트를 복구하고 이어서 진행하라:
>
> 1. `~/.grove/AI_GUIDE.md` 읽기
> 2. 프로젝트 `CLAUDE.md` 읽기 (특히 "src/context/skills/" 엔트리 포인트 + 자율 모드 섹션)
> 3. `/Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/wrapper-self-audit/HANDOFF.md` 읽기 — 현재 상태 복구
> 4. `docs/specs/2026-04-19-wrapper-self-audit-and-p1-only-design.md` 읽기 — Round 1 fix 반영된 spec 확인
> 5. `git log --oneline origin/main..HEAD` + `git status` 확인
> 6. HANDOFF.md의 "Next concrete steps" 1번(Codex Round 2 재제출)부터 재개.
>
> 자율 모드 유지: 사용자에게 질문 금지, 단일 안건 Codex 4회 거절 시 강제 통과, 에스컬레이션 금지.
>
> 작업 재개 전에 현재 이해한 state를 1–2문장으로 요약해서 확인받고 시작할 것.

### 재조립 방법 — `/tmp/gate-spec-round2.txt` 사라진 경우

```bash
cat > /tmp/gate-spec-round2.txt <<'PROMPT_EOF'
<task>
You are reviewing a design specification document as an independent technical lead.
Your goal is to identify gaps, ambiguities, and feasibility concerns BEFORE implementation planning begins.

This is **Round 2** of review. Round 1 raised 1 P0 + 3 P1 + 2 P2 findings. The author addressed them by:
- (P0) Re-defining Phase 5 escalation channel: instead of "gate feedback without artifact", now uses **plan doc `## Deferred` section append** (reaches Gate 7 via `<plan>` block). Confirmed commit message trailer does NOT reach Gate 7 by reading `buildPhase7DiffAndMetadata`.
- (P1 commit range) Pinned Phase 5 self-audit to `baseCommit..HEAD` to match Gate 7 metadata range.
- (P1 inputs) Defined self-audit inputs as "spec's `## Success Criteria`/`## Invariants` grep/regex" + "plan checklist `checks[].command`".
- (P1 channel consistency) Unified: Phase 1 → spec `## Deferred`, Phase 3 → plan `## Deferred`, Phase 5 → plan `## Deferred` append.
- (P2 R6 guards) Added SC11-SC14 regex tests for rationale phrases.
- (P2 multi-feedback) Added R5a conflict rule: highest severity wins, dedupe same severity.

Key decisions (updated):
- Decision 1: Self-audit is a Process step, not an Invariant (preserves `sentinel.*추가 작업 금지` regex).
- Decision 2: Self-audit inputs differ per phase; Phase 5 pinned to `baseCommit..HEAD`.
- Decision 3: P1-only triage block lives only inside `{{#if feedback_*}}` conditional — absent on first pass.
- Decision 4: Phase 5 forbids spec/plan restructuring.
- Decision 4a: `## Deferred` section append is the unified channel.
- Decision 5: Assembler stanza injection deferred.

<spec_document>
PROMPT_EOF
cat docs/specs/2026-04-19-wrapper-self-audit-and-p1-only-design.md >> /tmp/gate-spec-round2.txt
cat >> /tmp/gate-spec-round2.txt <<'PROMPT_EOF'
</spec_document>

Review this spec for:
1. **Completeness**: Are all required behaviors specified? Are success/failure paths defined?
2. **Ambiguity**: Could any requirement be interpreted in multiple ways? Are boundary conditions clear?
3. **Feasibility**: Can this be implemented with the stated tech stack and constraints?
4. **Edge cases**: What scenarios are missing? What happens at boundaries, under failure, with empty/null inputs?
5. **Internal consistency**: Do different sections contradict each other?
</task>

<structured_output_contract>
Return your review as structured text with these sections in order:

## Verdict
State exactly one of: `APPROVE` or `REJECT`

## Comments
For each finding, use this format:
- **[P0|P1|P2|P3]** — Location: [section/file reference]
  - Issue: [what is wrong]
  - Suggestion: [concrete fix recommendation]
  - Evidence: [quote or reference from the document supporting this finding]

Order comments by severity (P0 first).
P0: Critical blocker — must fix before proceeding
P1: Significant issue — should fix before proceeding
P2: Improvement — worth fixing if low effort
P3: Minor note — record only

## Summary
One to two sentences: overall assessment and primary reason for verdict.

Rules:
- APPROVE only if there are zero P0 and zero P1 findings
- REJECT if any P0 or P1 finding exists
- Every comment must cite a specific section, requirement, or code location from the provided documents
- Do not raise issues that are explicitly addressed in the Key Decisions section or previously fixed between rounds
</structured_output_contract>

<grounding_rules>
Ground every finding in the provided documents or observable project state.
Do not invent requirements, constraints, or failure scenarios not supported by the documents.
If a finding depends on an inference, state that explicitly.
Key Decisions in the spec represent deliberate, user-approved tradeoffs — do not re-litigate them unless you find concrete evidence they lead to a problem.
Round 1 findings listed in the task section are resolved — do not re-open them unless the fix itself introduces a new P0/P1.
</grounding_rules>

<dig_deeper_nudge>
After finding the first issue, check for second-order problems: does fixing one gap reveal another?
Look for unstated assumptions about ordering, concurrency, data availability, and external dependencies.
</dig_deeper_nudge>
PROMPT_EOF
```
