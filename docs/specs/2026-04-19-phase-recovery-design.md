# Phase Recovery — Design Spec (Group A)

관련 산출물:
- Implementation Plan: `docs/plans/2026-04-19-phase-recovery.md`
- Eval checklist: plan 하단 `## Eval Checklist` 섹션 (plan에 포함)
- 출처 관측:
  - `../gate-convergence/observations.md` §P1-NEW (checklist mtime bug, L114–130)
  - `../gate-convergence/observations.md` §P1-RESUME (P5 dirty tree bug, L185–200)
  - `../gate-convergence/FOLLOWUPS.md` §P1.1 (P5 pytest artifact no-recovery, L14–41)
- 관련 기존 설계:
  - `2026-04-14-tmux-rearchitecture-design.md` (ADR-13 symmetric crash recovery)
  - `2026-04-18-light-flow-design.md` (ADR-4 P7 REJECT → P1 reopen)

## Context & Decisions

### 배경

2026-04-18 light flow dogfood Round 2(meta-fix run)에서 phase 재진입 실패 두 건이 연쇄 관측됐다.

1. **[T1 — P1-NEW]** P7 REJECT #0 이후 P1 reopen 세션. Claude가 gate-7 피드백을 받아 `docs/specs/<runId>-design.md` + `decisions.md`는 적법하게 수정했지만 `checklist.json`은 **의도적으로 건드리지 않음**(eval 커맨드가 rev-invariant). Sentinel `phase-1.done`을 fresh attemptId로 올바르게 작성했음에도 `validatePhaseArtifacts`가 `checklist.json`의 `mtime < phaseOpenedAt[1]` 을 staleness 증거로 해석해 phase를 failed 처리. 25m 30s 낭비 후 수동 복구(`touch checklist.json` → state.json의 stale tmux 레퍼런스 정리 → resume).

2. **[T2 — P1.1 + P1-RESUME 통합]** P5 sentinel 시점에 `git status --porcelain`이 non-empty인 두 가지 현실적 경로:
   - **(A) 언어 표준 잔여물**: pytest(`__pycache__/`, `.pytest_cache/`), 또는 개발 중 생성된 `.venv/`, `node_modules/`. Claude가 scaffolding 시 `.gitignore`에 추가하지 않았다면 porcelain이 `??`로 잡고 validator가 failed 처리.
   - **(B) 외부 도구 편집**: 백그라운드에서 동작 중인 `oh-my-codex`·에디터·MCP 서버 등이 tracked 파일을 수정. Claude 세션 바깥 행동이라 세션 로그에 흔적 없음.

   `src/phases/runner.ts:196`에서 phase 5가 `'failed'` 반환 시 retry나 recovery 없이 즉시 종료. Round 1에서 45s의 성공적 impl 후 validator가 이 이유로 fail 처리 → session_end: interrupted → resume 루프 유발.

### Gate 7 revision — 해당 없음

Group A는 미발송 PR. Gate 7 feedback이 아직 없으므로 이 섹션은 본 revision에서 비워둔다.

### 핵심 결정

#### D1. T1 — mtime staleness check 제거 (드롭, 아니라 relax가 아님)

**문제 (interactive.ts:112 / resume.ts:493)**:
```ts
if (openedAt !== null && stat.mtimeMs < openedAt) return false;
```
`phaseOpenedAt`는 `preparePhase`에서 `Math.floor(Date.now()/1000) * 1000`으로 세팅. Reopen 시 `preparePhase`가 artifact를 지우지 **않으므로** 이전 완료된 파일의 `stat.mtimeMs`가 그대로 남아 있다. Claude가 rev-invariant 판단으로 해당 artifact를 건드리지 않으면 mtime < openedAt → fail.

**대안 검토**:

| 옵션 | 방식 | 판정 |
|---|---|---|
| 1. 전역 drop | mtime check 완전히 제거, 파일 존재+non-empty만 검증 | **채택** |
| 2. Reopen-only drop | `phaseReopenFlags[phase]` true일 때만 mtime 우회 | 기각 — 플래그는 `preparePhase`에서 validator 실행 전에 clear되므로 param threading 필요. 5군데 call site 수정. (`interactive.ts:188`에서 캡처 → `waitForPhaseCompletion`/codex branch로 forward, `resume.ts` 3개 call site에 isReopen 유도 로직 추가.) 수정 범위가 넓고 동등한 안전성을 보장하지 못함. |
| 3. Touch on phase open | `preparePhase`가 artifact들을 미리 touch해 mtime ≥ openedAt 보장 | 기각 — 원래 mtime 검사 의도("Claude가 실제로 작성했는가")를 테이블 밑에서 무효화. |
| 4. Init prompt에 "변경 없어도 touch" 지시 | 프롬프트 교육 | 기각 — 취약(Claude가 잊을 수 있음) + 정상 플로우에 noise. |

**옵션 1 safety argument**:
- mtime check는 heuristic. Freshness의 신뢰할 수 있는 source of truth는 **sentinel attemptId 매칭**.
- `preparePhase`는 first attempt(`!isReopen`)에서 artifact를 **삭제**한다(`interactive.ts:42-50`). 따라서 first attempt에서 파일이 "존재 + non-empty"면 Claude가 이번 attempt에서 작성했다는 것이 귀결적으로 참이다. 추가 mtime 검사는 중복.
- Reopen attempt에서는 artifact가 보존된다. Claude가 건드리지 않는 경우가 정상. mtime check는 이 정상 경로를 false negative로 잡는다 → T1 버그.
- Claude가 피드백을 무시하고 artifact를 건드리지 않은 비정상 경로는 **다음 Gate가 같은 피드백을 다시 던지며** 잡아낸다. Validator의 책임 바깥.

**적용 범위**: `interactive.ts:112` + `resume.ts:493` 두 곳에서 해당 라인 삭제. 다른 차원의 freshness 증명(sentinel content === expectedAttemptId)은 유지. ADR-13 symmetric property 보존.

#### D2. T2 — IGNORABLE_ARTIFACTS allowlist + 자동 `.gitignore` append + best-effort 자동 커밋

**문제**: P5 종료 시점 `git status --porcelain`이 non-empty면 즉시 fail. observations.md §P1-RESUME 및 FOLLOWUPS §P1.1에서 두 가지 재현 패턴:
- (A) untracked 언어 표준 잔여물 (`??  __pycache__/*`, `??  .pytest_cache/v/lastfailed` 등)
- (B) tracked 파일의 외부 편집 (` M  .gitignore` 등)

**채택 정책**:

1. **strict list 기반 allowlist** — hard-coded in `src/config.ts`:
   ```ts
   export interface IgnorablePattern {
     label: string;           // diagnostic
     pathRegex: RegExp;       // path match
     gitignoreGlob: string;   // entry to append
   }
   export const IGNORABLE_ARTIFACTS: readonly IgnorablePattern[] = [
     { label: 'Python bytecode cache',    pathRegex: /(?:^|\/)__pycache__\//,    gitignoreGlob: '__pycache__/' },
     { label: 'Python compiled file',     pathRegex: /\.pyc$/,                   gitignoreGlob: '*.pyc' },
     { label: 'Python optimized file',    pathRegex: /\.pyo$/,                   gitignoreGlob: '*.pyo' },
     { label: 'pytest cache',             pathRegex: /(?:^|\/)\.pytest_cache\//, gitignoreGlob: '.pytest_cache/' },
     { label: 'Python venv',              pathRegex: /(?:^|\/)\.venv\//,         gitignoreGlob: '.venv/' },
     { label: 'mypy cache',               pathRegex: /(?:^|\/)\.mypy_cache\//,   gitignoreGlob: '.mypy_cache/' },
     { label: 'ruff cache',               pathRegex: /(?:^|\/)\.ruff_cache\//,   gitignoreGlob: '.ruff_cache/' },
     { label: 'Python coverage',          pathRegex: /(?:^|\/)\.coverage(\.|$)/, gitignoreGlob: '.coverage' },
     { label: 'Python tox',               pathRegex: /(?:^|\/)\.tox\//,          gitignoreGlob: '.tox/' },
     { label: 'Node modules',             pathRegex: /(?:^|\/)node_modules\//,   gitignoreGlob: 'node_modules/' },
     { label: 'macOS Finder metadata',    pathRegex: /(?:^|\/)\.DS_Store$/,      gitignoreGlob: '.DS_Store' },
   ];
   ```
   > Node/macOS는 harness 자체를 dogfood할 때 발생하는 대표 사례 포함. 이후 언어별 추가는 PR 단위로 확장.

2. **매치 범위는 `??` (untracked)만**. `M`/`A`/`D`/`R`(tracked 상태) 은 auto-recovery 대상이 **아님** — 유저/외부 도구가 변경한 tracked 파일을 harness가 임의로 드롭하는 건 과도한 개입. Blocker로 분류.

3. **자동 복구 시퀀스** (`tryAutoRecoverDirtyTree(cwd, runId)`):
   - `git status --porcelain` 파싱 → 라인별 `flag`/`path` 분리. Rename은 `"R  old -> new"` 형식에서 `new` 경로 채택.
   - 각 untracked 라인에 대해 `IGNORABLE_ARTIFACTS`의 `pathRegex` 매칭 시도. 매칭 시 `gitignoreGlob`을 수집. 미매칭이면 `blockers` 배열에 라인 보관.
   - Tracked 상태 라인은 **즉시** blocker로 분류.
   - `blockers.length > 0` → `outcome: 'blocked'` 반환 (recovery 포기).
   - 수집된 글롭 중 `.gitignore`에 아직 없는 것만 filter해서 append:
     ```
     # harness auto-ignore (P5 residual artifacts)
     __pycache__/
     .pytest_cache/
     ...
     ```
   - `git add .gitignore && git commit -m "chore(harness): auto-ignore residual artifacts [<runId>]"`.
   - `git status --porcelain` 재실행. Empty면 `outcome: 'recovered'`. 여전히 non-empty면 `outcome: 'blocked'` (무한 재귀 방지).

4. **validator 통합** (`validatePhaseArtifacts` phase 5 branch, `interactive.ts:149-166`):
   ```ts
   let porcelain = execSync('git status --porcelain', ...).trim();
   if (porcelain !== '') {
     if (state.strictTree) {
       writeDirtyTreeDiagnostic(runDir, 'strict-tree', porcelain);
       return false;
     }
     const recovery = tryAutoRecoverDirtyTree(cwd, state.runId);
     if (recovery.outcome === 'blocked') {
       writeDirtyTreeDiagnostic(runDir, 'blocked', recovery.blockers.join('\n'));
       return false;
     }
     // outcome='recovered' — HEAD advanced (gitignore commit). Fall through.
   }
   const head = execSync('git rev-parse HEAD', ...).trim();
   if (head !== state.implRetryBase) return true;
   return state.implCommit !== null;
   ```

5. **Diagnostic 파일**: recovery가 실패하면 `<runDir>/phase-5-dirty-tree.md`에 `git status --porcelain` 출력 + 재개 안내 커맨드 2줄을 기록. stderr에도 동일 본문 1줄 요약 출력.

6. **Symmetric resume path** (`resume.ts::completeInteractivePhaseFromFreshSentinel` phase 5 branch, L531-543): 같은 auto-recovery 호출. 같은 blocker/recovered 분기. 이로써 ADR-13 symmetric 유지 (interactive 런타임 검증 == resume 재검증).

7. **검토된 대안**:

| 옵션 | 방식 | 판정 |
|---|---|---|
| 1. `git status --porcelain -uno` | untracked 전부 무시 | 기각 — 진짜 빠뜨린 tracked-new 커밋도 놓침. 안전장치 약화. |
| 2. 스냅샷-비교 | Claude 시작/종료 스냅샷 diff, 바깥 변경만 허용 | 기각 — 구현 복잡도 급증. git object 레벨 추가 상태 저장 필요. |
| 3. (채택) strict allowlist + .gitignore commit | 제한된 패턴만 자동 복구 | **채택** — 블라스트 반경 제한, 가독성 높은 diagnostic, 유저가 .gitignore를 나중에 검토 가능. |

#### D3. `--strict-tree` escape hatch

**필요성**: 일부 사용자가 D2의 자동 `.gitignore` 편집을 원치 않을 수 있다(리포지토리 convention, 엄격 CI 등). `harness-cli`의 기존 `--codex-no-isolate` 패턴을 따라 opt-out 플래그 제공.

**결정**:
- CLI flag `--strict-tree` on `harness run` + `harness start` (full + light 공통). `StartOptions.strictTree: boolean` (default false).
- `createInitialState`의 마지막 옵션 파라미터로 추가 → `state.strictTree: boolean` 영속화 → `harness resume`도 원 run의 선택 보존.
- `state.ts`의 migration 로직에 기본값 `false` 추가 (기존 `state.json`은 auto-recovery 활성).
- 문서: README에 1줄 예시 추가 (PR 본문 test plan에서 검증).

#### D4. Wrapper skill `harness-phase-5-implement.md` Process step 0 추가

**FOLLOWUPS §P1.1 의도와 정합**. 신규 언어 scaffold 시 Claude가 standard `.gitignore`를 생성하도록 유도. 자동 복구가 있어도 prevention-first 가 low-noise.

**추가 문구** (현 `## Process` 1번 앞에 **step 0** 삽입):
```
0. (scaffolding only) 구현 시작 전, 대상 언어·프레임워크의 표준 `.gitignore`
   엔트리(`__pycache__/`, `.pytest_cache/`, `.venv/`, `node_modules/`, `dist/`,
   `build/`, `.DS_Store` 등)를 프로젝트 루트 `.gitignore`에 보강한다. 기존
   `.gitignore`가 이미 해당 엔트리를 포함하면 no-op. 이 커밋은
   `chore: add standard gitignore entries` 등 독립된 scaffolding commit으로
   두는 것이 권장되며, impl 커밋과 섞지 않는다. Sentinel 직전에
   `git status --porcelain`을 셀프 체크해 tracked 파일이 전부 커밋된 상태
   인지 확인한다. 이 단계는 자동 recovery가 있어도 효율성과 로그 가독성 측면
   에서 값어치가 있다.
```

##### 충돌 주의 (Group B 공유)

같은 wrapper skill 파일을 Group B(`## Process` 마지막-1 step에 self-audit 추가)도 수정한다. 두 PR은 각각 다른 섹션을 건드리므로 trivial rebase 가능해야 한다. 먼저 머지되는 쪽이 baseline, 다른 쪽 rebase.

#### D5. wrapper skill `## Invariants` 업데이트

기존 invariant L40은 다음 문장을 이미 포함:
> "Reopen 시 gitignored artifact만 수정한 경우(예: `.harness/<runId>/checklist.json` 수정) 새 커밋 없이도 phase-5 valid (spec §Bug D 대응)."

T1 수정으로 **P1/P3에서 checklist 수정 없이도 valid**가 된다. 관련 문장을 Phase 5에 한정하지 말고 전반화:
> "Reopen 시 artifact를 변경하지 않아도 phase는 valid (sentinel attemptId 매칭만 필요). Claude가 gate-7 피드백이 rev-invariant 판단이면 건드리지 않는 것이 옳다."

Phase 1/3의 wrapper skill(`harness-phase-1-*.md`, `harness-phase-3-*.md`)도 유사 정책을 둘 필요가 있는지는 **따로 논의**. 현 PR 스코프 밖 (Group B scope). 본 PR은 phase-5 wrapper만 update.

## Requirements

**R1**. `validatePhaseArtifacts(phase=1|3, ...)`는 artifact가 존재 + non-empty일 때 `true`. Mtime 검사는 수행하지 않는다.

**R2**. `completeInteractivePhaseFromFreshSentinel(phase=1|3, ...)`도 R1과 동일 (ADR-13 symmetric).

**R3**. `validatePhaseArtifacts(phase=5, ...)`는 `git status --porcelain` non-empty 시, `state.strictTree === false`면 `tryAutoRecoverDirtyTree(cwd, runId)`를 호출한다.

**R4**. `tryAutoRecoverDirtyTree`는 untracked (`??`) 라인만 `IGNORABLE_ARTIFACTS`에 매치되는지 시도한다. 모든 라인이 매치되면 `.gitignore`에 신규 globs append + `chore(harness): auto-ignore residual artifacts [<runId>]` 커밋. Non-match 또는 tracked 상태 라인이 있으면 `blocked` 반환.

**R5**. Recovery 결과가 `blocked`면 `<runDir>/phase-5-dirty-tree.md`에 blocker 목록 + 재개 커맨드(`harness resume`, `harness jump 5`) 기록 + stderr에 1줄 요약.

**R6**. `--strict-tree` flag 전달 시 `state.strictTree = true`. Validator는 auto-recovery를 건너뛰고 blocker를 그대로 기록 후 false 반환.

**R7**. `state.ts` migration: 기존 `state.json`에서 `strictTree`가 undefined면 `false`로 채운다.

**R8**. `harness-phase-5-implement.md`에 scaffolding gitignore 의무화 step 0 추가 + Invariant 문구 업데이트. Assembler inline 경로(`src/context/assembler.ts`)가 `{{wrapper_skill}}`로 이 내용을 반영하므로 별도 assembler 수정 불필요.

**R9**. 모든 변경은 `pnpm tsc --noEmit`, `pnpm vitest run`, `pnpm build` 통과.

## Open Questions

### Q1. Auto-recovery가 invoke되어 .gitignore가 수정되면 Gate 7 diff 리뷰가 해당 커밋을 포함한다. 리뷰어가 혼란스러워하지 않을까?

답변: 커밋 메시지 `chore(harness): auto-ignore residual artifacts [<runId>]`가 의도를 명확히 밝힌다. Reviewer contract(`REVIEWER_CONTRACT`)는 `chore(harness):` 접두어를 이미 harness-generated commit 으로 인지하도록 가이드함(gate-prompt-hardening PR #11). 추가 문서화 없이 수용 가능.

### Q2. `state.strictTree = true` 런타임에 Claude가 `.gitignore`를 직접 수정하는 것은 허용되나?

답변: 허용. `--strict-tree`는 **harness의 auto-recovery를 비활성화**하는 것이지 `.gitignore` 편집 자체를 금지하는 것이 아니다. Claude가 수동으로 Step 0 gitignore 엔트리를 추가하면 dirty tree가 발생하지 않아 validator가 통과.

### Q3. `IGNORABLE_ARTIFACTS`에 포함되지 않은 새 언어(Rust, Go, Ruby 등)가 올라오면?

답변: 해당 언어의 scaffolded 잔여물이 untracked로 남으면 blocker로 분류 → validator fail. 이 시점에서 diagnostic 파일에 path가 드러나므로 follow-up PR에서 allowlist 확장 가능. 본 PR 스코프 밖.

### Q4. `.gitignore`가 존재하지 않는 리포지토리에서 auto-recovery가 동작하나?

답변: `fs.appendFileSync`는 파일이 없으면 생성한다. `git add .gitignore` → 새 트래킹. 정상 동작.

### Q5. `pnpm install` 중 발생한 `node_modules/` 잔여물도 auto-ignore하는 것이 위험하지 않나?

답변: harness phase 5는 **implementation** 단계지 install 단계가 아니다. 하지만 Claude가 P5에서 `pnpm install`을 trigger할 수 있다. 이 경우 `node_modules/`는 안전하게 ignore 대상. 대부분 프로젝트가 이미 `.gitignore`에 포함. 추가 커밋은 no-op(기존 엔트리 skip).

### Q6. Concurrent git operation 중 `git commit -m "chore(harness): auto-ignore..."`가 실패하면?

답변: `execSync`가 throw → validator의 `catch` 블록에서 false 반환 → phase failed. 기존 동작과 동일한 failure surface. 사용자는 `.harness/<runId>/phase-5-dirty-tree.md`에 기록된 안내로 수동 복구 가능.

### Q7. Group B와 같은 wrapper skill 파일 수정 충돌 가능성?

답변: Group A는 `## Process` 앞(step 0)을 삽입, Group B는 마지막-1 step 삽입. 둘은 서로 다른 앵커. `## Invariants` 섹션도 Group A는 rewording(L40), Group B는 새 문장 추가로 구분. Git merge conflict 가능성 낮음. 먼저 머지되는 쪽이 baseline이 되고 두 번째 PR은 간단 rebase.

### Q8. dogfood 대신 manual 4-phase로 진행한 선택이 스펙 품질에 영향을 주는가?

답변: **관련 결정은 아래 `## Deferred` 참조.**

## Deferred

### (D-i) dogfood vs manual 4-phase 실행 방식 선택

**결정**: 원 task prompt는 `harness start --light` 실행을 지시했다. 본 PR은 **manual 4-phase discipline**으로 진행한다(design → plan → TDD impl → verify).

**사유**:
1. T1 mtime 버그는 P7 REJECT 후 P1 reopen에서 **결정적으로** 발현한다. dogfood 세션 안에서 버그를 고치는 사이 buggy validator(outer harness는 구 dist 사용)가 작동해 mid-run 수동 복구를 강제한다. 이미 Round 2에서 25m 낭비 + 수동 state.json 편집이 필요했다.
2. Claude Code의 Bash 툴 세션에서 30+분짜리 tmux orchestrated flow를 안정적으로 모니터링하기 어렵다(수동 복구 중 진단 명령 실행 비용이 높음).
3. PR body test plan에 **post-merge Round 3 dogfood 재현 시험**이 이미 포함돼 있어, dogfood 검증은 더 안전한 post-merge 맥락으로 deferred.

**영향**: 본 PR 스펙 품질에는 영향 없음 — ADR 수준 결정을 모두 포함, 대안 검토 테이블 포함, 테스트 증분 계획 포함. Round 3 dogfood는 PR merge 후 별도 세션에서 재현 테스트(`../gate-convergence/observations.md` §P1-NEW/P1-RESUME 시나리오 재현 → 각각 recovery 성공 검증).

### (D-ii) Gate retry ceiling / complexity hint / ADR-4 relaxation

`../gate-convergence/FOLLOWUPS.md` §P1.4 (plan size)와 observations §P1 gate-retry ceiling은 본 PR 스코프 밖. Group C / Group F 소관.

### (D-iii) Allowlist 언어 확장

Rust(`target/`), Go(`vendor/` — 주의: vendored deps는 의도적 커밋일 수 있음), Java(`.gradle/`, `build/`), Ruby(`.bundle/`, `vendor/bundle/`) 등. 본 PR은 Python/Node/macOS에 한정. 추가 언어는 수요 확인 후 follow-up PR.

## Implementation Plan 참조

상세 slice 분해, TDD 단계, 커밋 순서는 `docs/plans/2026-04-19-phase-recovery.md` 참조.
