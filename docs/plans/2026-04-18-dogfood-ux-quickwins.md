# Dog-Fooding UX Quick-Wins — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**관련 문서:**
- Spec: `docs/specs/2026-04-18-dogfood-ux-quickwins-design.md`
- Eval checklist: 본 문서 §Eval Checklist
- Eval report (작성 예정): `docs/process/evals/2026-04-18-dogfood-ux-quickwins-eval.md`

**Goal:** Dog-fooding QA에서 식별된 UX 이슈 3건(pane 비율, 거짓 sentinel contract, 슬러그 길이)을 한 번에 묶어 수정한다.

**Architecture:** 세 이슈 모두 표면 텍스트/상수 변경. 공유 상태 없음, 코드 면 분리 → 독립 작업 3개를 순차 commit. resume 작업 코드 면(`src/runners/codex.ts`, `src/phases/verdict.ts`)은 건드리지 않아 `codex-optimization` 브랜치와 충돌 없음.

**Tech Stack:** TypeScript (Node.js), vitest, tmux split-window CLI.

---

## File Structure

### 수정 파일
- `src/commands/inner.ts` — `splitPane(..., 'h', 70)` → `60` 한 곳
- `src/context/prompts/phase-1.md` — CRITICAL 라인 교체
- `src/context/prompts/phase-3.md` — CRITICAL 라인 교체
- `src/context/prompts/phase-5.md` — CRITICAL 라인 교체
- `src/git.ts` — `generateRunId`의 max 50 → 25 (주석 2곳 + 코드 1곳)
- `tests/git.test.ts` — `truncates slug to 50 chars` → 25 기대값 갱신

### 신규 파일
없음.

---

## Task 1: 컨트롤 pane 비율 60:40으로 변경 (#6)

**Files:**
- Modify: `src/commands/inner.ts:56`

`tests/commands/inner.test.ts`의 `splitPane` mock은 percent 인자를 assert하지 않으므로 테스트 업데이트 불필요. 회귀만 확인.

- [ ] **Step 1: `splitPane` percent 상수 변경**

`src/commands/inner.ts:56` 한 줄:

변경 전:
```ts
    const workspacePaneId = splitPane(state.tmuxSession, controlPaneId, 'h', 70);
```

변경 후:
```ts
    const workspacePaneId = splitPane(state.tmuxSession, controlPaneId, 'h', 60);
```

- [ ] **Step 2: 기존 테스트 회귀 확인**

```bash
pnpm -s vitest run tests/commands/inner.test.ts
```
Expected: 기존 테스트 전부 통과 (splitPane mock은 인자에 불관여).

- [ ] **Step 3: TypeScript 빌드 확인**

```bash
pnpm -s tsc --noEmit
```
Expected: 에러 없음.

- [ ] **Step 4: Commit**

```bash
git add src/commands/inner.ts
git commit -m "fix(ui): widen control pane to 40% (splitPane 70 -> 60)"
```

---

## Task 2: Phase 프롬프트 sentinel 거짓 contract 정정 (#8)

**Files:**
- Modify: `src/context/prompts/phase-1.md:10`
- Modify: `src/context/prompts/phase-3.md:21`
- Modify: `src/context/prompts/phase-5.md:14`

CRITICAL 라인은 세 파일에서 구조가 동일하며 `phase-N.done`의 N만 다르다. 각 파일에서 같은 규칙으로 교체.

- [ ] **Step 1: `phase-1.md` CRITICAL 라인 교체**

`src/context/prompts/phase-1.md:10`

변경 전:
```
**CRITICAL: sentinel 파일(phase-1.done)은 모든 작업(파일 작성, git commit 포함)이 완료된 후 가장 마지막에 생성하라. sentinel 생성 즉시 이 세션이 자동 종료된다. sentinel 이후에는 어떤 작업도 실행되지 않는다.**
```

변경 후:
```
**CRITICAL: sentinel 파일(phase-1.done)은 모든 작업(파일 작성, git commit 포함)이 완료된 후 가장 마지막에 생성하라. sentinel 생성 이후 하네스는 다음 단계(리뷰/피드백)로 넘어가므로 추가 작업을 하지 말 것.**
```

- [ ] **Step 2: `phase-3.md` CRITICAL 라인 교체**

`src/context/prompts/phase-3.md:21`

변경 전:
```
**CRITICAL: sentinel 파일(phase-3.done)은 모든 작업(파일 작성, git commit 포함)이 완료된 후 가장 마지막에 생성하라. sentinel 생성 즉시 이 세션이 자동 종료된다. sentinel 이후에는 어떤 작업도 실행되지 않는다.**
```

변경 후:
```
**CRITICAL: sentinel 파일(phase-3.done)은 모든 작업(파일 작성, git commit 포함)이 완료된 후 가장 마지막에 생성하라. sentinel 생성 이후 하네스는 다음 단계(리뷰/피드백)로 넘어가므로 추가 작업을 하지 말 것.**
```

- [ ] **Step 3: `phase-5.md` CRITICAL 라인 교체**

`src/context/prompts/phase-5.md:14`

변경 전:
```
**CRITICAL: sentinel 파일(phase-5.done)은 모든 작업(파일 작성, git commit 포함)이 완료된 후 가장 마지막에 생성하라. sentinel 생성 즉시 이 세션이 자동 종료된다. sentinel 이후에는 어떤 작업도 실행되지 않는다.**
```

변경 후:
```
**CRITICAL: sentinel 파일(phase-5.done)은 모든 작업(파일 작성, git commit 포함)이 완료된 후 가장 마지막에 생성하라. sentinel 생성 이후 하네스는 다음 단계(리뷰/피드백)로 넘어가므로 추가 작업을 하지 말 것.**
```

- [ ] **Step 4: 거짓 문구가 전부 사라졌는지 grep 확인**

```bash
grep -rn "자동 종료" src/context/prompts/ || echo "No matches — clean."
grep -rn "sentinel 이후에는 어떤 작업도" src/context/prompts/ || echo "No matches — clean."
```
Expected: 두 grep 모두 "No matches — clean." 출력.

- [ ] **Step 5: 프롬프트 관련 테스트 회귀 확인**

```bash
pnpm -s vitest run tests/context/ tests/phases/interactive.test.ts
```
Expected: 전부 통과. (기존 테스트는 프롬프트 텍스트를 assert하지 않음.)

- [ ] **Step 6: Commit**

```bash
git add src/context/prompts/phase-1.md src/context/prompts/phase-3.md src/context/prompts/phase-5.md
git commit -m "fix(prompts): remove false sentinel auto-termination claim"
```

---

## Task 3: Run ID 슬러그 cap 50 → 25 (#12)

**Files:**
- Modify: `src/git.ts:87-123` (주석 2곳 + 코드 1곳)
- Modify: `tests/git.test.ts:182-190` (기대값 갱신)

TDD 순서: 기존 테스트를 25로 갱신 → 실패 확인 → 구현 변경 → 통과 확인.

- [ ] **Step 1: `tests/git.test.ts`의 cap 기대값 50 → 25로 갱신 (실패하는 상태로 둠)**

`tests/git.test.ts:182-190` 교체. describe 테스트 이름도 동기화.

변경 전:
```ts
  it('truncates slug to 50 chars at word boundary', () => {
    // Create a task that produces a slug longer than 50 chars
    const task = 'implement the full authentication and authorization system for users';
    const id = generateRunId(task, harnessDir);
    const slug = id.slice('YYYY-MM-DD-'.length);
    expect(slug.length).toBeLessThanOrEqual(50);
    // Should not end with a partial word (no trailing -)
    expect(slug).not.toMatch(/-$/);
  });
```

변경 후:
```ts
  it('truncates slug to 25 chars at word boundary', () => {
    // Create a task that produces a slug longer than 25 chars
    const task = 'implement the full authentication and authorization system for users';
    const id = generateRunId(task, harnessDir);
    const slug = id.slice('YYYY-MM-DD-'.length);
    expect(slug.length).toBeLessThanOrEqual(25);
    // Should not end with a partial word (no trailing -)
    expect(slug).not.toMatch(/-$/);
  });
```

- [ ] **Step 2: 테스트 실행 → 실패 확인 (현 코드는 50 cap)**

```bash
pnpm -s vitest run tests/git.test.ts -t "truncates slug"
```
Expected: FAIL. 현재 코드가 50-char cap이므로 "implement-the-full-authentication-and-authorization-system-for-users"를 50자로 자름 → 25자 기대와 불일치.

- [ ] **Step 3: `src/git.ts`의 cap 상수 50 → 25로 변경**

`src/git.ts:87-94` 주석 블록에서:

변경 전:
```ts
// Generate a runId from task description.
// Rules:
// 1. Lowercase
// 2. Unicode NFD normalize, remove non-ASCII
// 3. Replace non-alphanumeric with -
// 4. Collapse consecutive -
// 5. Trim leading/trailing -
// 6. Max 50 chars (cut at word boundary = last -)
// 7. Empty → "untitled"
// Format: YYYY-MM-DD-<slug>[-N] (N if directory exists)
```

변경 후 (6번 줄만):
```ts
// 6. Max 25 chars (cut at word boundary = last -)
```

`src/git.ts:118-123` 코드 블록에서:

변경 전:
```ts
  // 6. Max 50 chars, cut at word boundary (last -)
  if (slug.length > 50) {
    const truncated = slug.slice(0, 50);
    const lastDash = truncated.lastIndexOf('-');
    slug = lastDash > 0 ? truncated.slice(0, lastDash) : truncated;
  }
```

변경 후:
```ts
  // 6. Max 25 chars, cut at word boundary (last -)
  if (slug.length > 25) {
    const truncated = slug.slice(0, 25);
    const lastDash = truncated.lastIndexOf('-');
    slug = lastDash > 0 ? truncated.slice(0, lastDash) : truncated;
  }
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

```bash
pnpm -s vitest run tests/git.test.ts
```
Expected: `generateRunId` 스위트 전부 통과 (5/5).

- [ ] **Step 5: TypeScript 빌드 확인**

```bash
pnpm -s tsc --noEmit
```
Expected: 에러 없음.

- [ ] **Step 6: Commit**

```bash
git add src/git.ts tests/git.test.ts
git commit -m "fix(git): tighten runId slug cap to 25 chars for shorter paths"
```

---

## Task 4: 최종 전체 검증

- [ ] **Step 1: 전체 테스트 스위트 실행**

```bash
pnpm -s vitest run
```
Expected: 전체 green, fail 0. 이전 수 이상의 테스트.

- [ ] **Step 2: 린트 통과 확인**

```bash
pnpm -s lint
```
Expected: 에러 0.

- [ ] **Step 3: TypeScript 최종 확인**

```bash
pnpm -s tsc --noEmit
```
Expected: 에러 0.

- [ ] **Step 4: 커밋 히스토리 확인**

```bash
git log --oneline -5
```
Expected: 최근 3 커밋이 Task 1/2/3 순서로 남아있음 (+ 이전 spec/plan doc 커밋 위).

---

## Eval Checklist

### Objective criteria (기계 검증)

- [ ] **EC-1**: `pnpm -s tsc --noEmit` exit 0
  - Pass: stdout 비어있음 + exit 0
- [ ] **EC-2**: `pnpm -s lint` exit 0
  - Pass: error 0
- [ ] **EC-3**: `pnpm -s vitest run` 전체 통과
  - Pass: fail 0
- [ ] **EC-4**: `pnpm -s vitest run tests/git.test.ts -t "truncates slug"` 통과
  - Pass: 1 passed
- [ ] **EC-5**: pane 비율 변경이 코드에 반영됨
  - Command: `grep -n "'h', 60" src/commands/inner.ts`
  - Pass: 정확히 1건 hit
- [ ] **EC-6**: pane 비율 구 값이 완전 제거됨
  - Command: `grep -n "'h', 70" src/commands/inner.ts || echo "clean"`
  - Pass: "clean" 출력 또는 0 hits
- [ ] **EC-7**: sentinel 거짓 문구 전원 제거
  - Command: `grep -rn "자동 종료" src/context/prompts/ || echo "clean"`
  - Pass: "clean" 출력 또는 0 hits
- [ ] **EC-8**: sentinel 대체 문구 세 파일 모두 적용
  - Command: `grep -l "다음 단계(리뷰/피드백)로 넘어가므로" src/context/prompts/phase-1.md src/context/prompts/phase-3.md src/context/prompts/phase-5.md | wc -l`
  - Pass: 3
- [ ] **EC-9**: slug cap 25 상수 반영
  - Command: `grep -n "slug.length > 25" src/git.ts`
  - Pass: 1 hit
- [ ] **EC-10**: slug cap 50 구 값 제거
  - Command: `grep -n "slug.length > 50" src/git.ts || echo "clean"`
  - Pass: "clean" 또는 0 hits
- [ ] **EC-11**: Spec 링크 유효
  - Command: `test -f docs/specs/2026-04-18-dogfood-ux-quickwins-design.md`
  - Pass: exit 0

### Spec traceability

| Spec section | 요구사항 | 구현 태스크 | 검증 EC |
|--------------|----------|-------------|---------|
| §2/§4.1 #6 pane ratio | splitPane 70→60 | Task 1 | EC-5, EC-6 |
| §2/§4.2 #8 sentinel contract | 세 phase 프롬프트 교체 | Task 2 | EC-7, EC-8 |
| §2/§4.3 #12 slug cap | 50→25 + 테스트 갱신 | Task 3 | EC-4, EC-9, EC-10 |
| §5 테스트 전략 | 회귀 green | Task 4 | EC-1, EC-2, EC-3 |

### Subjective criteria

- [ ] **SC-1**: 세 변경이 서로 간섭 없이 독립적으로 적용됨 (파일 면 분리)
- [ ] **SC-2**: 커밋 3개가 각 이슈 단위로 분리되어 블레임 추적 용이
- [ ] **SC-3**: 수동 smoke (optional): `harness start "long task name here that exceeds twenty five chars"` 실행 시 runId가 `2026-04-18-long-task-name-here` 수준으로 축약되는지 확인

---

## Notes for Implementer

- Task 1/2는 TDD가 필요 없음(표면 변경). Task 3만 TDD 순서(test 먼저 갱신 → fail 확인 → 구현).
- 커밋은 이슈 단위로 분리. 메시지는 `fix(<scope>): <imperative>` 형식.
- Task 2의 세 phase 프롬프트는 교체 규칙 단일 — 텍스트를 복붙하지 말고 각 파일 열어 CRITICAL 라인만 정확히 교체.
- `pnpm -s vitest run` 결과가 이전 커밋 대비 테스트 수/fail 변화 없는지 확인. resume 작업 merge 전까지 이 브랜치는 main + 3 spec/plan 커밋 + 3 fix 커밋만 존재.
