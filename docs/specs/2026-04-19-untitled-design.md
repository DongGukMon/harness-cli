# Install Skills + CLI Rename — Design Spec (Light)

Related:
- Task: `.harness/2026-04-19-untitled/task.md`
- Decisions: `.harness/2026-04-19-untitled/decisions.md`
- Checklist: `.harness/2026-04-19-untitled/checklist.json`
- Previous gate feedback: `.harness/2026-04-19-untitled/gate-2-feedback.md`, `.harness/2026-04-19-untitled/gate-7-feedback.md`

## Complexity

Medium — 1차 impl 은 반영 완료, 2차 revision 범위는 벤더링 스킬 프롬프트 contract 정정 + 사용자 노출 문자열 치환으로 좁다. 단 여러 산출물(skill 2종 + CLI 2종 + README 1곳)을 동시에 일관되게 고쳐야 해서 Small 로 내리기는 애매.

## Context & Decisions

**현재 상태 (revision 직전)**
- 1차 impl 로 다음이 반영됨: `bin` rename, `src/context/skills-standalone/codex-gate-review/` 벤더링, `install-skills` / `uninstall-skills` 커맨드 + 테스트, `copy-assets.mjs` 추가 규칙, README/HOW-IT-WORKS/CLAUDE.md 일괄 치환.
- Gate 7 rejection 에서 세 건의 잔여 이슈 확인:
  1. **P1** — 벤더링된 `gate-prompts.md` 의 `## Common Output Contract` 는 `REJECT` 응답에 `Scope: design | impl | mixed` 한 줄을 요구하지 않음. 현 phase-harness Phase 7 eval gate 는 이 라인으로 재시작 phase 를 분기하므로 contract mismatch.
  2. **P1** — 벤더링된 `SKILL.md` (Gate eval 단계) + `gate-prompts.md` (`## Gate: Eval Review`) 가 **독립적인 impl plan artifact** 를 요구함. light flow 에서는 spec+plan 이 단일 결합 문서(`docs/specs/<slug>-design.md`) 로 합쳐져 별도 plan 파일이 없기 때문에 실제 호출 시 placeholder 채울 소스가 없어짐. full flow 와 light flow 양쪽을 지원해야 함.
  3. **P2** — 1차 rename 이 100% 완료되지 않아 다음 3곳에 `harness` 단독 사용 잔재: `README.md:361` (`harness jump <phase>`), `src/commands/resume.ts:23` (`'harness start --light'`), `src/commands/resume.ts:81` (`'harness jump N'`). `README.ko.md` 는 이미 고쳐진 상태.

**결정 사항 (revision 범위; 1차 ADR-1~9 는 유지)**

10. **Eval REJECT 에 `Scope:` 강제 (ADR-10)**: 벤더링 `gate-prompts.md` 의 `## Common Output Contract` 에 "REJECT 시에는 `## Verdict` 블록 내에서 `REJECT` 바로 아래 `Scope: design | impl | mixed` 한 줄을 반드시 기재" 문구를 추가한다. eval review 의 `<verification_loop>` 에도 대응 체크("before finalizing REJECT, emit `Scope:` line based on whether findings target spec/design, impl, or both") 를 추가한다. spec/plan review 는 Scope 개념이 무의미하므로 `Scope:` 요구는 eval 에만 적용(문서는 "evaluation review" 한정임을 명시).
11. **Light-flow 호환: Gate eval 입력의 "combined design doc" 분기 추가 (ADR-11)**: `SKILL.md` Step 1 `Gate eval` 블록과 `gate-prompts.md` `## Gate: Eval Review` 의 입력 자료 기술을 재작성한다.
    - 기본 기술: 입력은 "(a) full flow 에서는 spec doc + impl plan 각각 1개, (b) light flow 에서는 결합 design spec 1개" 로 명시.
    - placeholder 설계: `[SPEC_CONTENT]` 는 항상 필수. `[PLAN_CONTENT]` 는 optional — full flow 에서는 impl plan 전문, light flow 에서는 "(light flow — plan is embedded in the spec under `## Implementation Plan`)" 주석 1줄만 삽입하거나 블록 자체를 생략.
    - 프롬프트 assembly 설명도 "light flow 인 경우 `<plan_document>` 블록은 skip 또는 placeholder note 로 대체" 를 명시.
    - Step 1 checklist 는 "combined design doc 을 감지하려면 spec doc 에 `## Implementation Plan` 섹션 존재 여부로 판단" 가이드 추가.
12. **잔여 `harness` 문자열 치환 (ADR-12)**:
    - `README.md:361` 의 `harness jump <phase>` → `phase-harness jump <phase>`.
    - `src/commands/resume.ts:23` 의 `'harness start --light'` → `'phase-harness start --light'`.
    - `src/commands/resume.ts:81` 의 `'harness jump N'` → `'phase-harness jump N'`.
    - 이후 repo 전체를 `grep -nE "\\bharness (run|start|jump|resume|skip|status|list|install-skills|uninstall-skills)\\b"` 등의 패턴으로 재검색하여 추가 누락이 없는지 확인(단, tmux 세션 prefix `harness-`, 파일 경로 `bin/harness.ts` 등 내부 식별자는 유지).

## Requirements / Scope

**IN (revision delta)**
- R12: `src/context/skills-standalone/codex-gate-review/gate-prompts.md` 의 `## Common Output Contract` 에 eval gate REJECT 시 `Scope: design | impl | mixed` 라인 요구 조건을 명시. eval review `<verification_loop>` 에 Scope 결정 로직을 추가.
- R13: 같은 파일의 `## Gate: Eval Review` 섹션과 `SKILL.md` Step 1 의 Gate eval 입력 기술이 **combined design spec (light flow)** 과 **separate spec+plan (full flow)** 양쪽을 명시적으로 지원하도록 문구·placeholder 기술을 갱신. `SKILL.md` invocation 예시에 light-flow 사용 시 plan 파일이 없음을 표기.
- R14: `README.md:361`, `src/commands/resume.ts:23`, `src/commands/resume.ts:81` 의 stale `harness` 문자열을 `phase-harness` 로 치환. 추가로 `grep` 으로 잔여 누락을 한 번 더 확인.
- R15: 기존 R11 의 빌드 검증(`pnpm tsc --noEmit`, `pnpm vitest run`, `pnpm build`) 을 재실행하여 회귀 없음 확인. 신규 grep 기반 eval 체크가 checklist.json 에 추가되어 검증 자동화.

**OUT (revision)**
- 1차에서 이미 반영된 R1~R11 범위 재작업. 기존 테스트는 그대로 통과해야 함.
- Scope 라인 파서·디스패처 구현은 phase-harness core 측 작업이며 본 워크트리 범위 아님(벤더링 프롬프트의 contract 만 맞춘다).
- `harness-` prefix 가 남아 있는 내부 식별자(예: tmux 세션명) 변경.

## Design

**변경 대상 파일 (revision 전체)**
```
src/context/skills-standalone/codex-gate-review/SKILL.md
src/context/skills-standalone/codex-gate-review/gate-prompts.md
README.md
src/commands/resume.ts
docs/specs/2026-04-19-untitled-design.md      # 본 문서 (rev 2)
.harness/2026-04-19-untitled/decisions.md      # ADR-10/11/12 추가
.harness/2026-04-19-untitled/checklist.json    # 신규 eval 체크 추가
```

**`gate-prompts.md` 변경 설계 (R12, R13)**

1. `## Common Output Contract` 에 조건부 섹션 추가:
   ```
   ## Verdict
   State exactly one of: `APPROVE` or `REJECT`

   When the verdict is `REJECT` and the gate type is `eval`, the next non-empty line in the Verdict section MUST be exactly:
     Scope: design | impl | mixed
   (choose one value). Omit the `Scope:` line for `APPROVE` and for non-eval gates.
   ```
   - `design`: 원 설계/요구가 불충분 → Phase 1 로 돌아감.
   - `impl`: 설계는 유효, 구현이 contract 불일치 → Phase 5 재시도.
   - `mixed`: 둘 다 해당.
2. `## Gate: Eval Review` `<task>` 블록의 입력 기술을 아래로 교체:
   ```
   Inputs (one of two shapes):
   - Full flow:   [SPEC_CONTENT] + [PLAN_CONTENT] are two distinct documents.
   - Light flow:  [SPEC_CONTENT] is a combined design spec that embeds the implementation plan
                  in a `## Implementation Plan` section; [PLAN_CONTENT] is not provided separately.
   The `<plan_document>` block is optional: in light flow, omit it or replace it with a
   single-line note `(light flow — plan is in spec.Implementation Plan)`.
   ```
3. `<verification_loop>` 에 Scope 결정 가이드 추가:
   ```
   If you decide REJECT, classify each P0/P1 finding as
   - design-level  (requires spec revision)
   - impl-level    (requires code-only change)
   Then emit `Scope: design`, `Scope: impl`, or `Scope: mixed`.
   ```
4. `## Prompt Assembly Checklist` 에 "light flow 에서는 `[PLAN_CONTENT]` 치환을 skip" 항목 1줄 추가.

**`SKILL.md` 변경 설계 (R13)**

- Step 1 `Gate eval` 블록을 분기형으로 재작성:
  ```
  Gate eval:
  - spec doc 전문을 Read → [SPEC_CONTENT]에 삽입
  - impl plan 이 별도 파일로 존재하면(full flow) 전문을 Read → [PLAN_CONTENT]에 삽입
  - impl plan 이 spec 의 `## Implementation Plan` 섹션으로 내장되어 있으면(light flow)
    [PLAN_CONTENT] 블록은 생략하거나 `(light flow — plan embedded in spec)` 주석으로 대체
  - auto-verification report 전문을 Read → [EVAL_REPORT_CONTENT]에 삽입
  - git diff 전문 → [GIT_DIFF_CONTENT]
  ```
- Invocation 예시 아래에 짧은 note 추가: `phase-harness light flow uses a combined design spec; `--gate eval` will detect this automatically.`
- 출력 요약 섹션은 그대로. Scope 라인 설명은 `gate-prompts.md` 에 집중시킨다 (중복 방지).

**`README.md` 변경 설계 (R14)**
- L361 한 줄 교체.

**`src/commands/resume.ts` 변경 설계 (R14)**
- L23, L81 문자열 교체. 로직 변경 없음.

**Grep 기반 regression 방지 (R14)**
- checklist 에 추가되는 eval 체크:
  - `phase-harness`-정규화된 서브커맨드 사용자 노출 문자열만 잡도록 제약: `! grep -nE "\\b(Use|use|run)[^\\n]*\\bharness (run|start|jump|skip|status|list|install-skills|uninstall-skills)\\b" README.md README.ko.md src/commands/resume.ts` 형태로 좁게. 전역 `harness` 는 내부 식별자가 많아 매칭하면 안 됨.
  - 벤더링 프롬프트에 Scope 라인 요구가 존재함을 확인: `grep -q "Scope: design | impl | mixed" src/context/skills-standalone/codex-gate-review/gate-prompts.md` (dist 버전도 빌드 후 존재해야 하므로 선택적으로 dist 체크도 1개 추가).
  - 벤더링 프롬프트가 light flow 를 언급함을 확인: `grep -q "light flow" src/context/skills-standalone/codex-gate-review/gate-prompts.md` + `grep -q "light flow" src/context/skills-standalone/codex-gate-review/SKILL.md`.

**테스트 전략 (revision)**
- 기존 vitest suite 는 변경 없이 통과해야 함(문자열 수정은 resume 의 제어 흐름에 영향 없음).
- 신규 단위 테스트는 필요 없음: 벤더링 마크다운은 grep 기반 체크로 충분하며, CLI 문자열 교체는 타입·테스트에 영향 없음. (만약 resume 의 stderr 메시지에 대한 기존 assertion 이 있다면 기대값 업데이트 필요 — 구현 단계에서 grep 으로 확인.)

## Open Questions

- 본 워크트리는 프롬프트 contract 만 정정한다. phase-harness core 가 실제로 `Scope:` 라인을 파싱해 phase 라우팅을 수행하도록 고치는 작업은 별도 태스크로 남긴다 — 본 spec 의 R12 는 "contract 정의" 까지만 cover 한다.
- light flow 감지를 "spec 내 `## Implementation Plan` 섹션 존재 여부" 로 heuristic 하게 지시하지만, 추후 spec schema 가 바뀌면 재검토 필요. 현재는 Phase 1 init prompt 가 `## Implementation Plan` 섹션을 강제하므로 안전.
- 기존 `resume.ts` 의 stderr 메시지에 대한 vitest assertion 존재 여부는 구현 시 `grep -R "harness start --light" tests/` 로 확인. 있으면 함께 업데이트.

## Implementation Plan

- [ ] **Task 1 — Common Output Contract 갱신 (R12)**: `src/context/skills-standalone/codex-gate-review/gate-prompts.md` 의 `## Common Output Contract` 에 "REJECT on eval gate 시 `Scope: design | impl | mixed` 한 줄 필수" 조항 삽입. 상세 문구는 Design 섹션 1번 참조.
- [ ] **Task 2 — Eval Review 섹션 light-flow 호환 (R13)**: 같은 파일 `## Gate: Eval Review` `<task>` 에 full/light 분기 입력 기술 + `<plan_document>` optional 명시 추가. `<verification_loop>` 에 Scope 결정 가이드 추가. `## Prompt Assembly Checklist` 에 light-flow 주의 항목 1줄 추가.
- [ ] **Task 3 — SKILL.md Step 1 재작성 (R13)**: `src/context/skills-standalone/codex-gate-review/SKILL.md` Step 1 의 `Gate eval:` 블록을 Design 섹션의 새 기술로 교체. Invocation 예시에 light-flow note 추가.
- [ ] **Task 4 — 잔여 CLI 문자열 치환 (R14)**: `README.md:361`, `src/commands/resume.ts:23`, `src/commands/resume.ts:81` 세 곳을 `phase-harness ...` 로 수정. 이후 `grep -nE "\\bharness (run|start|jump|skip|status|list|install-skills|uninstall-skills)\\b" README.md README.ko.md src/commands/resume.ts src/commands/*.ts` 로 1회 재검사. 발견되면 본 태스크 내에서 함께 수정.
- [ ] **Task 5 — 빌드 검증 및 grep 체크 포함 재실행 (R15)**: `pnpm tsc --noEmit`, `pnpm vitest run`, `pnpm build` 통과 확인. `node dist/bin/harness.js --help` 출력 확인(회귀 방지). 신규 grep 체크(`scope-contract-in-gate-prompts`, `light-flow-in-skill`, `no-stale-harness-cli-refs`) 실행 확인.

## Eval Checklist Summary

세부 검증은 `.harness/2026-04-19-untitled/checklist.json` 참조. 본 revision 에서 변경/추가되는 항목:
- `typecheck`, `test`, `build` — 기존 유지.
- `cli-name-phase-harness`, `cli-name-not-harness-generic`, `install-skills-help`, `uninstall-skills-help`, `standalone-skill-vendored`, `standalone-skill-in-dist` — 기존 유지.
- **신규**: `scope-contract-in-gate-prompts` — `gate-prompts.md` 에 `Scope: design | impl | mixed` 문구 존재.
- **신규**: `light-flow-in-eval-skill` — `SKILL.md` 와 `gate-prompts.md` 에 `light flow` 언급 존재.
- **신규**: `no-stale-harness-cli-refs` — README.md / README.ko.md / src/commands/resume.ts 에서 `harness run|start|jump|skip|status|list|install-skills|uninstall-skills` 단독 사용 패턴 0건.
