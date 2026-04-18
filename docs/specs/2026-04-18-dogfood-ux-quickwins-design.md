# Dog-Fooding UX Quick-Wins — Design Spec

- 상태: draft
- 작성일: 2026-04-18
- 담당: Claude Code (engineer)
- 관련 문서:
  - 근거 QA 관찰: `qa-observations.md` (Priority 2 #6, Priority 3 #8 #12)
  - 세션 맥락: `SESSION_CONTEXT.md` §5 (저난도 번들 권장)
  - Impl plan: `docs/plans/2026-04-18-dogfood-ux-quickwins.md` (작성 예정)
  - Eval report: `docs/process/evals/2026-04-18-dogfood-ux-quickwins-eval.md` (작성 예정)

## 1. 배경과 목표

`todo-manager` dog-fooding run(2026-04-18)에서 식별된 저난도 UX 이슈 3건을 한 번에 묶어 고친다. 모두 코드 면/파일이 분리되어 있어 동시에 처리해도 충돌 위험이 없고, 각각 수십 줄 이하의 표면 변경이다.

**범위에 포함**:

- **#6**: 컨트롤 pane이 좁아 모델 설정/게이트 피드백/escalation 문구가 심하게 word-wrap.
- **#8**: Phase 프롬프트(phase-1/3/5.md)에 "sentinel 생성 즉시 세션이 자동 종료된다"는 거짓 contract.
- **#12**: Run ID 슬러그가 과도하게 길어 경로/파일명이 비대해짐.

**비목표**:

- `#9 tokensTotal undefined` — SESSION_CONTEXT §5에서 resume 작업에 끼워 넣기 권장. 본 작업과 같은 Codex stdout 파서 코드 면을 건드리므로 병합 충돌 회피 위해 제외.
- `#4 venv checklist`, `#7 clarify dialog`, `#5 37분 폭주`, `#10 advisor 타이밍`, `#11 escalation 키입력` — 설계 논의 또는 재현 실험이 추가로 필요하므로 별도 작업.

**성공 기준**:

- 114 cols 터미널에서 컨트롤 pane이 45 cols 이상 확보되어 한국어/영어 혼용 문구의 word-wrap이 실질적으로 감소.
- Phase 프롬프트의 거짓 mechanism 주장 제거. 단, "sentinel은 마지막 단계" 행동 신호(AI가 commit 전 sentinel 먼저 쓰는 실수 방지)는 유지.
- Run ID 총 길이가 기존 대비 40% 이상 감축(예: 59자 → 33자 수준).
- 기존 테스트 전부 green, 회귀 0.

## 2. Context & Decisions

### 핵심 결정사항

- **#6 pane ratio**: `splitPane` percent 파라미터 값을 **70 → 60**으로 변경. 동적 계산(tmux width 측정) 도입하지 않음 — 와이드 터미널에서 workspace가 과하게 좁아지는 테스트 매트릭스 확장 비용을 이번 작업이 감수하지 않음. 필요해지면 후속 작업.
- **#8 sentinel contract**: CRITICAL 라인의 거짓 문구만 **교체**(삭제 아님). "sentinel 생성 즉시 자동 종료 / 이후 어떤 작업도 실행되지 않는다" → "sentinel 생성 이후 하네스는 다음 단계(리뷰/피드백)로 넘어가므로 추가 작업을 하지 말 것." AI가 "sentinel은 마지막 단계" 개념을 유지하되, 시스템이 kill을 보장한다는 거짓 주장은 제거.
- **#12 slug cap**: `generateRunId`의 max 50 → **25**. Word-boundary cut 로직과 dedup 루프(`-2`, `-3`)는 그대로 유지. Hash 방식은 채택하지 않음 — `ls .harness/` 가독성 손실이 명확한 이득 없이 도입됨.

### 제약 조건

- **후속 resume 작업과의 병합**: `gate-convergence` 브랜치는 `main`(70c8e5a) 베이스, `codex-optimization` 브랜치의 resume 작업과 독립. 본 작업은 `src/runners/codex.ts`, `src/phases/verdict.ts`, `src/phases/gate.ts`를 **건드리지 않는다** → resume 브랜치 머지 시 파일 단위 conflict 없음.
- **한국어 프롬프트 정합성**: phase-1/3/5.md가 모두 한국어 혼용 스타일 → 교체 문구도 기존 톤/어휘 따름.
- **slug 길이 하한**: 25자면 "build-a-terminal-based"(22자 word-boundary cut) 수준 가능. 3~5단어 태스크 기술이면 가독성 유지. 극단 1-2단어 태스크("fix bug" 7자)도 잘 동작(cap 미발동).

### 해소된 모호성

- **왜 동적 pane 계산이 아닌가?**: 대부분의 터미널이 80-120 cols 범위(노트북 개발 기본). 고정 60:40은 이 범위 전부에서 control 32~48 cols 확보 → 현 상황(34 cols 불만) 개선에 충분. 와이드 모니터 사용자는 workspace가 충분히 커서 60% 비율도 합리적.
- **왜 CRITICAL 라인 통삭제(B1) 대신 교체(B2)인가?**: "sentinel 마지막 생성" 순서 지시는 여전히 유효한 행동 신호. AI가 sentinel 먼저 쓰고 뒤에 commit을 누락하는 실수를 방지. 삭제하면 이 신호도 함께 잃음.
- **왜 25자인가, 30이나 20이 아닌가?**: 25 × 0.7 ≈ 17자 정도가 word-boundary cut 후 실질 남는 길이. 관찰된 dog-fooding 태스크들("harness jump integration", "codex session resume" 등 대부분 20자 내외) 기준 원형 보존. 20은 too short(`terminal-based-todo` 수준이 이미 그 길이). 30은 감축 효과 미미(관찰 사례 48자 → 30자, 아직 길음).

### 구현 시 주의사항

- `src/commands/inner.ts:56` 한 곳만 수정. `splitPane(...)` 호출부. `src/tmux.ts`의 `splitPane` 함수 자체는 건드리지 않음(타 호출자 영향 없음).
- `src/context/prompts/phase-{1,3,5}.md` 세 파일 모두 동일 CRITICAL 라인 교체. grep로 다른 prompt 파일에 같은 문구 있는지 확인하고 있으면 동일 처리.
- `src/git.ts:119`의 `if (slug.length > 50)` 상수만 변경. 주석(`// 6. Max 50 chars...`)도 25로 동기화. 테스트 `tests/git.test.ts`에 slug length 검증 있으면 기대값 업데이트.

## 3. 현 구조 분석

### 관련 파일과 역할

| 파일 | 현 역할 | 본 작업에서의 변경 |
|------|---------|--------------------|
| `src/commands/inner.ts` | `__inner` 커맨드, pane 생성 + 세션 루프 진입 | `splitPane(..., 'h', 70)` → `'h', 60` |
| `src/context/prompts/phase-1.md` | Phase 1(spec 작성) 프롬프트 템플릿 | CRITICAL 라인 교체 |
| `src/context/prompts/phase-3.md` | Phase 3(plan 작성) 프롬프트 템플릿 | CRITICAL 라인 교체 |
| `src/context/prompts/phase-5.md` | Phase 5(구현) 프롬프트 템플릿 | CRITICAL 라인 교체 |
| `src/git.ts` | `generateRunId` 슬러그 생성 | 50 → 25, 주석 동기화 |
| `tests/git.test.ts` | `generateRunId` 테스트 | cap 변경 반영 |
| `tests/commands/inner.test.ts` | inner splitPane 호출 검증 | percent 인자 기대값 갱신 |

## 4. 설계 상세

### 4.1 #6 컨트롤 pane 비율

**변경 전** (`src/commands/inner.ts:56`):

```ts
const workspacePaneId = splitPane(state.tmuxSession, controlPaneId, 'h', 70);
```

**변경 후**:

```ts
const workspacePaneId = splitPane(state.tmuxSession, controlPaneId, 'h', 60);
```

**효과**:

| 터미널 너비 | 변경 전 control cols | 변경 후 control cols |
|-------------|---------------------|---------------------|
| 80          | 24                  | 32                  |
| 114         | 34                  | **~45**             |
| 160         | 48                  | 64                  |
| 200         | 60                  | 80                  |

60 cols 미만 환경에선 여전히 빡빡하지만 dog-fooding 관찰 114 cols에서 명확히 완화. Workspace는 여전히 60% 확보.

**테스트**: `tests/commands/inner.test.ts`에 `splitPane` mock의 인자 검증이 있으면 `70` → `60` 업데이트. 없으면 수동 smoke 확인으로 충분(렌더링은 tmux 몫, unit test 대상 아님).

### 4.2 #8 Phase 프롬프트 거짓 contract 교체

세 파일(`src/context/prompts/phase-{1,3,5}.md`) 모두 동일 구조의 라인 존재(각 파일에서 `N`은 해당 phase 번호로 1/3/5). 교체 규칙 단일:

**변경 전** (모든 phase, `N`은 파일별 해당 숫자):

```
**CRITICAL: sentinel 파일(phase-N.done)은 모든 작업(파일 작성, git commit 포함)이 완료된 후 가장 마지막에 생성하라. sentinel 생성 즉시 이 세션이 자동 종료된다. sentinel 이후에는 어떤 작업도 실행되지 않는다.**
```

**변경 후** (모든 phase):

```
**CRITICAL: sentinel 파일(phase-N.done)은 모든 작업(파일 작성, git commit 포함)이 완료된 후 가장 마지막에 생성하라. sentinel 생성 이후 하네스는 다음 단계(리뷰/피드백)로 넘어가므로 추가 작업을 하지 말 것.**
```

차이점: `sentinel 생성 즉시 이 세션이 자동 종료된다. sentinel 이후에는 어떤 작업도 실행되지 않는다` → `sentinel 생성 이후 하네스는 다음 단계(리뷰/피드백)로 넘어가므로 추가 작업을 하지 말 것`.

**행동 의도 보존**:

- ✅ sentinel은 "마지막 단계" — AI가 commit 전 sentinel 쓰는 실수 방지.
- ✅ sentinel 이후 추가 작업 자제 — 여전히 지시됨(mechanism 아닌 행동 지시).
- ❌ "세션이 kill된다"는 거짓 주장 — 제거.

**테스트**: 프롬프트 교체는 정적 텍스트 변경. 기존 템플릿 렌더 테스트가 이 문자열을 하드코드 assert하고 있지 않으면 추가 테스트 불필요. Grep로 확인.

### 4.3 #12 Run ID 슬러그 cap

**변경 전** (`src/git.ts:87-143`):

```ts
// Rules:
// ...
// 6. Max 50 chars (cut at word boundary = last -)
// ...
  // 6. Max 50 chars, cut at word boundary (last -)
  if (slug.length > 50) {
    const truncated = slug.slice(0, 50);
    const lastDash = truncated.lastIndexOf('-');
    slug = lastDash > 0 ? truncated.slice(0, lastDash) : truncated;
  }
```

**변경 후**:

```ts
// Rules:
// ...
// 6. Max 25 chars (cut at word boundary = last -)
// ...
  // 6. Max 25 chars, cut at word boundary (last -)
  if (slug.length > 25) {
    const truncated = slug.slice(0, 25);
    const lastDash = truncated.lastIndexOf('-');
    slug = lastDash > 0 ? truncated.slice(0, lastDash) : truncated;
  }
```

**효과** (dog-fooding 실제 케이스):

| Task 입력 | 변경 전 runId | 변경 후 runId |
|-----------|--------------|---------------|
| `"Build a terminal-based todo manager for personal use"` | `2026-04-18-build-a-terminal-based-todo-manager-for-personal` (59자) | `2026-04-18-build-a-terminal-based` (33자) |
| `"Add codex session resume"` | `2026-04-18-add-codex-session-resume` (35자) | `2026-04-18-add-codex-session` (28자) |
| `"fix bug"` | `2026-04-18-fix-bug` (18자) | `2026-04-18-fix-bug` (18자, cap 미발동) |

**Edge case**: 25자 cap이 첫 단어조차 못 담는 경우 (예: 단일 단어 `supercalifragilisticexpialidocious` 34자) → `lastDash > 0` 조건이 false → `slug = truncated` (25자 그대로). 기존 50-cap에서도 같은 로직이므로 회귀 아님.

**테스트**: `tests/git.test.ts`에 `generateRunId` 테스트 있으면 cap 50 → 25 기대값 업데이트. Word-boundary cut/dedup 테스트는 로직 불변이라 그대로 통과.

## 5. 테스트 전략

### 5.1 단위 테스트

- **#6**: `tests/commands/inner.test.ts` — `splitPane` mock 인자 검증 존재 시 `70` → `60`.
- **#8**: 정적 텍스트 변경. 기존 테스트가 CRITICAL 문자열을 assert하지 않으면 추가 없음. 있으면 기대값 업데이트.
- **#12**: `tests/git.test.ts` — `generateRunId` 테스트에서 50자 경계 케이스가 있으면 25자 경계로 갱신. 신규 테스트: long-task 입력 시 총 length 확인.

### 5.2 회귀

- `pnpm -s vitest run` 전체 green.
- `pnpm -s tsc --noEmit` 에러 0.
- `pnpm -s lint` 에러 0.

### 5.3 수동 smoke (선택)

- 실제 `harness start "Long task name here that exceeds the cap"` 실행 → `.harness/2026-04-18-long-task-name-here-that/` 생성 확인.
- tmux 세션에서 control pane이 기존보다 넓어진 것을 시각 확인(114 cols 기준).

## 6. 마이그레이션 및 호환성

- **기존 `.harness/<old-long-runid>/` 디렉토리**: 영향 없음. `generateRunId`는 신규 run만 생성. 기존 디렉토리는 그대로 읽힘(runId는 state.json에 저장되어 이름과 무관).
- **기존 Phase 프롬프트 텍스트를 비교/assert하는 외부 코드**: 없음(내부 template만 사용).
- **pane ratio**: 런타임 프로세스에만 영향. 기존 세션 이어가기(`harness resume`)에서는 pane 재생성이 없으면 기존 비율 유지(state에 pane ID 저장됨). 새 세션/새 pane 생성 시점부터 60:40 적용.

## 7. YAGNI / 범위 밖

다음은 **이번 작업에 포함하지 않는다**:

- 동적 pane width 계산(A2). 현 변화로 충분.
- Slug hash 접미사(C2) / 완전 hash runId(C3). dedup 루프가 충돌 처리 중.
- phase-1/3/5 프롬프트의 다른 톤/구조 개선. CRITICAL 라인만 타깃.
- 기타 dog-fooding 이슈(#4, #5, #7, #9, #10, #11) — 본 spec 바깥.

## 8. Open Questions

- 없음. 세 변경 모두 mechanism이 명확하고 관찰 데이터로 값이 결정됨.
