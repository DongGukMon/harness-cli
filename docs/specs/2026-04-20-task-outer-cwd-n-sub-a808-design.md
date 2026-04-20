# Multi-Worktree Harness Flow — Design Spec

- Date: 2026-04-20
- Status: Draft (Phase 1 rev 2 — gate-2 P1 feedback incorporated)
- Related Task: `.harness/2026-04-20-task-outer-cwd-n-sub-a808/task.md`
- Related Decisions: `.harness/2026-04-20-task-outer-cwd-n-sub-a808/decisions.md`

---

## Context & Decisions

### 문제

`harness-cli`는 현재 "cwd = 단일 git repo"를 전제로 동작한다. 실무에서 자주 쓰이는 **grove mission 레이아웃** — outer 디렉토리에 `.gitignore`와 N개의 sub-worktree(독립 git repo)가 놓이고 **outer 자체는 git이 아닌** 구조 — 에서 `phase-harness run`을 돌리면 Phase 2에서 `Not inside a trusted directory` 에러로 즉시 실패한다. 또한 outer를 빈 git으로 만들어도 Phase 5 HEAD는 sub-worktree들 안에서 움직이므로 outer 기준 판정이 영구 false가 되고, gate에 주입되는 `git diff`도 빈 문자열이 된다. 장애가 preflight가 아닌 Phase 2에서야 드러나 디버깅 비용도 크다.

### 목표

outer + N sub-worktree 레이아웃에서 Phase 1~6이 자연스럽게 흐르도록 하고, **기존 "cwd = 단일 git repo" 플로우는 동작·성능·테스트 전부 regression 0**으로 유지한다.

### 핵심 결정 요약 (rationale)

**[ADR-N1] "N≥1 tracked repos" 단일 모델로 통합 — "single vs multi 모드" 분기 기각**
- single-repo와 multi-worktree를 별도 코드 경로로 나누지 않는다. 대신 harness는 항상 **`state.trackedRepos: Array<{path, baseCommit, implRetryBase}>` 순회 모델** (N≥1)로 동작한다. cwd가 git이면 `trackedRepos = [{ path: cwd, ... }]` 1원소로 자동 채워지고, cwd가 git이 아니면 depth=1 auto-detect 결과로 N원소가 된다.
- 이유: assembler, Phase 5 판정, preflight, resume ancestry 체크 등 다수 모듈이 "두 모드 분기문"을 두면 regression 표면이 커지고 테스트 매트릭스가 2배로 늘어난다. 반면 "항상 순회, N=1이 degenerate case"는 기존 동작을 그대로 포함한다.

**[ADR-N2] cwd depth=1 auto-detect (cwd가 git 아닐 때만)**
- cwd가 git이면 기존 single-repo 경로 (trackedRepos 자동 합성, 스캔 안 함).
- cwd가 git이 아니면 cwd 바로 아래 depth=1에서 git repo인 디렉토리를 자동 수집. 숨김 dir (`.*`), `node_modules`, `dist`, `build`, `.harness`는 skip. 결과는 경로 알파벳 정렬로 결정론화.
- `--track <path>` (repeatable): 명시 리스트 — auto-detect를 완전히 대체. 전달된 순서를 유지 (첫 인자 = docs home).
- `--exclude <path>` (repeatable): auto-detect 결과에서 제거.
- preflight 때 "Detected N tracked repos: [...]" 한 줄 출력. Y/n 프롬프트 없음.
- 0개 수집 + `--track` 없음 → preflight fail-fast: `"No tracked git repos found under cwd. Pass --track <path> or run from a git repo."`
- 기각: 재귀 스캔 (오탐 위험, node_modules 내부 구멍); `.gitignore` "Nested project worktrees" 섹션 파싱 (grove 전용 컨벤션).

**[ADR-N3] `state.trackedRepos` 도입, 기존 top-level 필드는 mirror**
- state 스키마에 `trackedRepos: Array<{path, baseCommit, implRetryBase, implHead}>` 추가.
- 기존 `state.baseCommit` / `state.implRetryBase` top-level 필드는 항상 `trackedRepos[0]`의 거울로 유지 — 기존 코드가 두 필드를 읽는 모든 지점에서 동작 불변.
- state migration: 기존 state.json 로드 시 top-level 두 필드로부터 `trackedRepos` 1원소를 합성 (`trackedRepos` 부재 시).
- 이유: 소비자 코드를 한꺼번에 바꾸지 않아도 되며 backward compat가 깨끗하다.

**[ADR-N4] Docs/artifacts 저장 위치 = `trackedRepos[0]`**
- 별도 `--docs-repo` 플래그 없음.
- single-repo: `cwd/docs/...` (= `trackedRepos[0]/docs`). 기존과 동일.
- multi: `trackedRepos[0]/docs/...`. 첫 번째 tracked repo에 spec/plan/eval artifact가 커밋된다.
- 사용자가 docs home을 제어하려면 `--track <docs-home>` 을 첫 인자로 명시.
- 이유: 플래그 추가는 YAGNI. `--track` 순서 규칙이 override 역할을 겸한다.

**[ADR-N5] Gate codex spawn = 항상 outer cwd. cwd가 git 아니면 `--skip-git-repo-check` 자동**
- `src/runners/codex.ts` gate spawn은 항상 outer cwd에서 실행.
- cwd가 git이면 기존 동작 (skip 플래그 없음).
- cwd가 git이 아니면 codex에 `--skip-git-repo-check` 자동 부착.
- diff는 어느 경우든 harness가 `assembler.ts`에서 tracked repos를 순회하여 조립한 뒤 prompt `<diff>` 블록에 주입. codex는 git을 직접 건드리지 않는다.
- codex 샌드박스는 outer cwd 하위 전체에 걸쳐 있어 tracked repos에 대한 read 접근이 자연스럽게 커버된다.
- **샌드박스-tracked repo 일관성 규칙 (gate-2 P1 반영)**: **모든 tracked repo 는 outer cwd 의 하위 경로(cwd-descendant) 여야 한다**. 이 전제 하에서만 codex 샌드박스(= outer cwd 트리)가 자동으로 tracked repos 를 읽기 범위에 포함한다. out-of-tree 경로 (`--track` 이 cwd 밖을 가리키는 경우) 는 start 시점 fail-fast. 상세 규칙은 FR-10. 본 spec 범위에서는 out-of-tree tracked repo 지원을 non-goal 로 둔다.
- 기각: "docs repo에서 스폰" — runner가 경로 선택 로직을 떠안게 돼 코드 경로가 늘어난다.
- 기각: "sandbox 를 out-of-tree 경로까지 확장" — codex CLI per-path whitelist 옵션 튜닝 + 에러 경로 확장이 필요. grove mission 실사용 레이아웃은 항상 cwd-descendant 이므로 이번 범위 제외.

**[ADR-N6] Phase 5 성공 판정 = "tracked repos 중 하나라도 advanced"**
- `src/phases/interactive.ts`의 Phase 5 판정을 단일 HEAD 비교에서 `trackedRepos` 순회로 교체: "어떤 tracked repo든 현재 HEAD가 해당 repo의 `implRetryBase`에서 전진했는가?"
- N=1 (single-repo)일 때 기존 의미와 동일.
- 기각: "전부 전진" — 한 repo만 건드리는 task에도 빈 ceremonial 커밋을 강요.
- Phase 5 reopen 시 각 `trackedRepos[i].implRetryBase`를 해당 시점 HEAD로 리셋.

**[ADR-N7] Gate diff 조립 = repo별 label + concat, 전체 size cap**
- `assembler.ts`가 `trackedRepos.forEach(repo => ...)` 로 `### repo: <path>\n\`\`\`diff\n<git diff base...HEAD>\n\`\`\`\n` 형태 섹션을 concat.
- 기존 `MAX_DIFF_SIZE_KB` 상한은 concat 전체 길이에 적용. 초과 시 기존 `truncateDiffPerFile` per-file 절단 규칙을 concat 결과에 그대로 적용.
- N=1이면 기존 단일 diff와 동일한 출력을 내도록 유지 (label 섹션 포맷이 기존 테스트 fixture를 깨지 않는 방식으로 도입 — 상세는 Invariants 참조).

**[ADR-N8] Phase 6 verify는 변경 없음 (checklist-level 책임)**
- `scripts/harness-verify.sh`는 건드리지 않는다. multi-repo 타깃이 필요한 명령은 Phase 3 plan 작성 시 checklist에 `cd <repo-path> && <cmd>` 형태로 저자가 직접 쓴다.
- eval report artifact 커밋은 기존과 동일하게 `trackedRepos[0]/docs/process/evals/` 아래 생성 (ADR-N4 룰에 따름).

**[ADR-N9] Preflight에 per-repo git+head 체크 활성화, codex 에러 메시지에 stderr 프리뷰 포함**
- `src/commands/start.ts`가 현재 호출하지 않는 `git` / `head` 항목을 **`trackedRepos` 순회**로 호출. single은 1회, multi는 N회. 실패 시 Phase 2 전에 친절한 메시지로 중단.
- `src/runners/codex.ts`의 "Gate subprocess exited with code 1" 에러 메시지에 codex stderr 마지막 ~20줄을 포함. 모드 무관 UX 버그 수정.

**[ADR-N10] Resume 다중 repo는 동일 순회 패턴으로 자연 파생 (별도 설계 불필요)**
- `src/resume.ts`의 ancestry 체크, Phase 5 fresh-sentinel 재판정, external commits 감지, implRetryBase 리셋을 전부 `trackedRepos` 순회로 교체.
- N=1일 때 기존 동작과 동일하므로 별도 마이그레이션 없음.
- 본 spec에 구현 범위로 포함 (task.md §"성공 기준"의 "Phase 1~6이 에러 없이 진행"은 resume을 포함한 iterative 사용이 성립해야만 의미가 있음).

---

## Complexity

Large — state schema 마이그레이션 + assembler, interactive(phase 5 판정), preflight, codex runner, resume, harness-verify(간접), 그리고 ADR/HOW-IT-WORKS 문서까지 다모듈 touched. 단일 파일·수백 LoC 범위가 아님.

---

## 아키텍처 개요

```
outer cwd (git 일 수도, 아닐 수도)
  ├── docs/                    ← trackedRepos[0] 가 git 이어야 함 (artifact 커밋 대상)
  ├── repo-a/                  ← auto-detect / --track 으로 참여
  ├── repo-b/                  ← 〃
  └── .harness/<runId>/
        ├── state.json         ← trackedRepos[] 포함
        └── ...

harness process
  ├── start.ts
  │   ├── (cwd가 git?) → trackedRepos = [{ cwd, HEAD, HEAD }]
  │   └── (아니면)    → depth=1 scan + --track/--exclude 반영 → trackedRepos[]
  │   └── per-repo preflight (git+head) → fail-fast on miss
  │
  ├── phases/interactive.ts
  │   └── Phase 5 판정: trackedRepos.some(r => currentHEAD(r.path) !== r.implRetryBase)
  │
  ├── context/assembler.ts
  │   └── Gate diff: trackedRepos.map(r => "### repo: …\n```diff\n git diff r.base...HEAD```") 로 concat
  │
  ├── runners/codex.ts
  │   └── gate spawn: cwd = outer, cwd가 git 아니면 --skip-git-repo-check
  │   └── error path: exit≠0 시 stderr 마지막 ~20줄을 에러 메시지에 포함
  │
  └── resume.ts
      └── ancestry / external-commit / Phase 5 재판정: 전부 trackedRepos 순회
```

---

## Functional Requirements

### FR-1 모드 진입 규칙

- `phase-harness start` / `run` / `start --light` 가 호출되면:
  1. cwd가 git repo인지 확인.
  2. git이면 → `trackedRepos = [{ path: cwd, baseCommit: HEAD, implRetryBase: HEAD, implHead: null }]`. 스캔·플래그 무시. 기존 플로우와 완전히 동일한 경로.
  3. git이 아니면 → auto-detect 또는 `--track` 리스트로 `trackedRepos`를 만든다. 결과가 비어 있으면 start 중단 (fail-fast).
- **cwd-descendant 제약 (gate-2 P1)**: 채택된 모든 tracked repo 경로는 `path.resolve(cwd, …)` 후 `path.relative(cwd, resolved)` 가 `..` 로 시작하지 않아야 한다 (= cwd 트리 내부). auto-detect 는 cwd 직속 child 만 보므로 자동 만족. `--track` 이 위반하면 start 시점에 fail-fast (상세: FR-10).
- `--track <path>` 가 하나라도 주어지면 auto-detect는 **완전히 무시**되고 명시 리스트만 사용된다.
- `--exclude <path>` 는 auto-detect 결과에서 경로 일치(정규화 후) 제거. `--track` 과 조합 시 `--exclude` 는 노옵(explicit list에는 적용 안 함).

### FR-2 State 스키마

- `state.trackedRepos: Array<{ path: string; baseCommit: string; implRetryBase: string; implHead: string | null }>` 신규 필드.
  - `path`: cwd 기준 정규화된 절대경로. **cwd-descendant 여야 한다** (FR-1 / ADR-N5).
  - `baseCommit`: run 시작 시점의 해당 repo HEAD.
  - `implRetryBase`: 해당 repo에서 Phase 5 재시도 기준 HEAD (초기값 = baseCommit, reopen 시 현재 HEAD로 갱신).
  - `implHead`: 해당 repo 에서 Phase 5 성공 판정 시점에 관찰된 HEAD. Phase 5 미완료 또는 해당 repo 가 advanced 되지 않은 경우 `null`.
- **legacy top-level 필드 미러링 규칙 (gate-2 P1 명시화)**:
  - `state.baseCommit ≡ state.trackedRepos[0].baseCommit` — 항상 mirror (write 시 동기화).
  - `state.implRetryBase ≡ state.trackedRepos[0].implRetryBase` — 항상 mirror.
  - `state.implCommit ≡ state.trackedRepos[0].implHead` — mirror. **`trackedRepos[0]` 이 advanced 되지 않아 `implHead = null` 이면 `state.implCommit = null`**.
  - 따라서 N=1 single-repo 케이스(= trackedRepos[0] 가 cwd) 에서 legacy 소비자(`state.implCommit` 을 단일 구현 anchor 로 읽는 모든 경로)는 기존 의미가 그대로 유지된다. N>1 multi-repo 에서 repo 0 만 변경 안 된 경우 `state.implCommit` 이 `null` 로 떨어지므로, 단일 anchor 전제 소비자는 **null-safe 경로를 타야 한다** (상세: FR-5, FR-8).
- state migration: `state.json` 로드 시 `trackedRepos` 가 undefined 또는 빈 배열이면 `[{ path: cwd, baseCommit: state.baseCommit, implRetryBase: state.implRetryBase, implHead: state.implCommit }]` 로 합성 (`state.implCommit` 이 null 이면 `implHead` 도 null).

### FR-3 Preflight

- `start.ts` 가 `runPreflight(['node','tmux','tty','platform','verifyScript','jq'], cwd)` 에 추가로 `trackedRepos` 확정 직후 `for (const repo of trackedRepos) runPreflight(['git','head'], repo.path)` 를 호출.
- 현재 `src/preflight.ts` 의 `'git'` / `'head'` 케이스는 변경 없이 재사용된다 (message는 repo.path context를 포함하도록 경량 수정 — 메시지 문자열에 `repo: <path>` 접미).
- 실패 시 종료 메시지: `"harness requires a git repository in: <path>"` 또는 `"harness requires at least one commit in: <path>"`.

### FR-4 Gate (Phase 2/4/7) codex 스폰

- `src/runners/codex.ts` 의 gate spawn 경로에서 cwd 판정:
  - outer cwd가 git repo → 기존 동작 (argv 변화 없음).
  - outer cwd가 git 아님 → codex argv 에 `--skip-git-repo-check` 자동 추가.
- spawn `cwd` 는 항상 outer cwd (프로세스 `process.cwd()` 또는 harness 가 들고 있는 cwd 값). 어떤 tracked repo로도 바뀌지 않는다.
- codex 에러 경로 (`runners/codex.ts:305` 근처) 에서 exit code ≠ 0 시, captured stderr 의 마지막 ~20줄을 에러 message 에 포함 (`"Gate subprocess exited with code 1\n--- stderr (tail) ---\n<...>\n---"`). 20줄 제한과 ANSI escape stripping 적용.

### FR-5 Gate diff 조립

- `src/context/assembler.ts` 의 gate 프롬프트 조립 지점(§Phase 4, §Phase 7, 그리고 buildPhase7DiffAndMetadata)에서 단일 `runGit("git diff …", cwd)` 호출을 `trackedRepos` 순회로 교체.
- 각 repo 의 diff 는 다음 포맷으로 concat:

  ```
  ### repo: <path relative to cwd if possible, else absolute>
  ```diff
  <git diff ${baseCommit}...HEAD in that repo>
  ```
  ```

- `trackedRepos.length === 1` **and** `trackedRepos[0].path === cwd` 인 경우 (= 기존 single-repo 케이스) **label 섹션 없이 기존 raw diff 포맷을 그대로 출력**한다. 기존 gate prompt golden fixture 가 깨지지 않도록 하는 의도적 N=1 백워드 경로다.
- `MAX_DIFF_SIZE_KB` 상한은 concat 전체에 적용. 초과 시 `truncateDiffPerFile(concat, PER_FILE_DIFF_LIMIT_KB * 1024)` 를 그대로 호출 (단, multi-repo 포맷에서 per-file 절단 경계가 repo 섹션과 맞물리는 세부 규칙은 **Deferred §D-1** 로 이월 — gate-2 P2).
- **Phase 7 metadata block — multi-repo 분기 규칙 (gate-2 P1 반영)**:
  - N=1 single-repo 케이스 (= `trackedRepos.length === 1 && trackedRepos[0].path === cwd`): 기존 포맷 그대로. `"Harness implementation range: ${state.baseCommit}..${state.implCommit}"` 한 줄. `state.implCommit = null` 이면 `"Phase 5 skipped; no implementation commit anchor."` (기존 동작과 동일).
  - N>1 multi-repo 케이스: 단일 `baseCommit..implCommit` 라인을 **출력하지 않고**, 대신 `"Harness implementation ranges (per tracked repo):"` 블록을 출력한다. 각 repo 별로 `"  - <path>: <baseCommit>..<implHead>"` (해당 repo 가 advanced). `implHead === null` 인 repo 는 `"  - <path>: no change (baseCommit=<baseCommit>)"` 로 출력. 이로써 "top-level `implCommit` 이 null 이어도 metadata 가 정보 손실 없이 gate reviewer 에게 전달됨".
- Phase 7 의 `externalCommitsDetected` 경로 및 `buildPhase7DiffAndMetadata` 의 `primary` diff 구성도 동일한 per-repo 순회로 일반화. 기존 코드에서 `state.implCommit` / `state.evalCommit` 을 단일 anchor 로 쓰는 외부-커밋 주석 로직은 **`trackedRepos[0]` 기준** 으로 유지하되 (`implCommit` 이 null 일 수 있으므로 null-guard 추가), 각 tracked repo 의 external commit log 는 repo 별로 수집해 `"## External Commits (not reviewed)"` 섹션에 repo 헤더와 함께 append.

### FR-6 Phase 5 성공 판정

- `src/phases/interactive.ts:187-196` 의 Phase 5 sentinel 후속 판정 및 `src/resume.ts:580-588` 의 fresh-sentinel 판정에서 `getHead(cwd) === state.implRetryBase` 단일 비교를 다음으로 교체 (gate-2 P1 반영 — `implHead`/`implCommit` 을 advance 여부에 따라 조건부로 기록):

  ```
  let anyAdvanced = false;
  for (const r of state.trackedRepos) {
    const h = getHead(r.path);
    if (h !== r.implRetryBase) {
      r.implHead = h;                 // advance 한 repo 에만 implHead 를 설정
      anyAdvanced = true;
    } else {
      r.implHead = null;              // 변경 없음 repo 는 implHead 를 null 로 남김
    }
  }
  if (!anyAdvanced) return false;
  state.implCommit = state.trackedRepos[0].implHead;   // legacy mirror: repo 0 advance 안 했으면 null
  return true;
  ```

- 따라서 N=1 케이스에서는 `state.implCommit = getHead(cwd)` 와 동치 (기존 동작 보존). N>1 에서 repo 0 이 advance 안 한 경우 `state.implCommit = null` 이 되고, 이 값의 의미는 "legacy anchor 없음; 구현 결과는 `trackedRepos[*].implHead` 를 순회해 확인" 이다.
- Phase 5 reopen 경로 (`src/phases/interactive.ts` preparePhase / resume 의 reopen 계열) 에서는 `for (const r of trackedRepos) { r.implRetryBase = getHead(r.path); r.implHead = null; }` 을 수행하고 top-level `state.implRetryBase` 도 `trackedRepos[0].implRetryBase` 로 갱신, `state.implCommit` 도 `null` 로 리셋.

### FR-7 Artifact 경로 해석 (docs home)

- spec / plan / eval report / decisions 등 artifact 의 상대 경로는 모두 `trackedRepos[0].path` 를 root로 해석한다.
- 현재 `artifacts.spec = "docs/specs/…md"` 와 같은 상대 표기는 단일 치환점 (새로운 헬퍼 `resolveArtifact(state, rel)` 또는 기존 `isAbsolute ? rel : join(cwd, rel)` 지점을 `join(state.trackedRepos[0].path, rel)` 로 교체) 을 통해 리라우팅.
- N=1 + trackedRepos[0].path === cwd 일 때 기존 경로와 완전히 동일하므로 single-repo 테스트·dogfood 동작 불변.
- artifact commit (기존 `normalizeArtifactCommit`) 는 `trackedRepos[0].path` 에서 실행.

### FR-8 Resume 다중 repo 동작

- `src/resume.ts`
  - **`ancestry check` (gate-2 P1 반영, null-safe)**: `trackedRepos` 순회해 각 repo 별로 다음 규칙을 적용한다 —
    - `r.implHead !== null` 이면 `isAncestor(r.implHead, 'HEAD', r.path)` 검사. 실패 시 manual recovery 메시지에 실패한 `r.path` 를 명시하고 exit.
    - `r.implHead === null` 이면 해당 repo 는 아직 Phase 5 가 commit 을 남기지 않은 상태 (미완료 run 또는 "advance 안 함" repo). ancestry 체크 **skip** — 검사할 anchor 가 없다.
    - 추가적으로, `state.phases['5'] === 'completed'` 인데 모든 `r.implHead === null` 인 경우는 내부 불변식 위반 — `state_anomaly` 로그 emit 후 manual recovery.
  - **`updateExternalCommitsDetected` (null-safe)**: `trackedRepos` 순회로 per-repo external commit 감지. 각 repo 의 anchor 는 `r.implHead ?? r.implRetryBase ?? r.baseCommit` 순으로 fallback. 어느 하나라도 external commit 발견 시 `state.externalCommitsDetected = true` 로 설정하고 emit 시 repo.path 를 로그 메시지에 포함.
  - Phase 5 fresh-sentinel 재판정: FR-6 규칙 그대로 사용 (이미 null-safe — advance 하지 않은 repo 는 `implHead = null` 로 기록되므로 후속 ancestry/external 체크가 자동으로 skip/fallback 경로를 탄다).

### FR-9 Phase 6 verify (변경 범위)

- `scripts/harness-verify.sh` 소스 변경 없음.
- Phase 3 plan 작성 시 multi-repo target 이 필요한 checklist command 는 `cd <repo-path> && <cmd>` 형태로 작성하도록 Phase 3 wrapper skill / 문서에 안내만 추가 (행동 변화는 plan 저자의 책임).
- eval report artifact commit 은 FR-7 에 의해 `trackedRepos[0]` 내부에 착지.

### FR-10 CLI 플래그

- `phase-harness start|run|start --light` 에 다음 반복 플래그 추가:
  - `--track <path>` — 경로는 절대/상대 모두 입력 가능하나, **최종 해석 결과는 반드시 outer cwd 의 하위 경로여야 한다 (cwd-descendant)**. 검증 규칙 (순서대로):
    1. `path.resolve(cwd, <path>)` 로 절대화.
    2. `path.relative(cwd, resolved)` 가 `..` 로 시작하거나 절대경로면 fail-fast (메시지: `"--track ${path}: must be inside cwd (${cwd})"`). 이 규칙으로 ADR-N5 의 샌드박스-범위 일관성이 보장됨.
    3. 존재하지 않으면 fail-fast (`"--track ${path}: path not found"`).
    4. git repo (`.git` 디렉토리 또는 gitdir 파일) 가 아니면 fail-fast (`"--track ${path}: not a git repo"`).
  - `--exclude <path>` — auto-detect 결과에서만 효력. `--track` 과 조합되면 no-op (warning 표시). `--exclude` 도 cwd-descendant 검증을 동일하게 받음 (밖 경로는 의미 없음).
- 기존 플래그·의미 변경 없음.

---

## Non-functional Requirements

- 기존 vitest suite **전체 통과** 를 regression gate 로 둔다. single-repo 코드 경로의 모든 기존 테스트는 변경 없이 통과해야 한다.
- multi-worktree 신규 테스트: (a) cwd 가 git 아닐 때 depth=1 scan fixture (b) `--track`/`--exclude` 조합 (c) N=2 tracked repos 에서 assembler diff concat (d) Phase 5 판정에서 "하나만 advanced" 시 success (e) state migration (legacy state.json 로드→trackedRepos 합성).
- harness-cli 자체 dogfood (cwd = harness-cli worktree, git repo) 경로에서 `phase-harness run` 동작이 코드 수정 전후 완전히 동일해야 한다.
- state 파일 크기 증가: `trackedRepos` 배열 추가로 single-repo 에서도 수십 바이트 증가. 수용 가능.

---

## Success Criteria

- 문서:
  1. 본 spec doc 존재, 경로 `docs/specs/2026-04-20-task-outer-cwd-n-sub-a808-design.md`.
  2. `docs/HOW-IT-WORKS.md` 및 `.ko.md` 의 "Architecture" / "Lifecycle" 해당 섹션에 multi-worktree 모델 설명 추가 (Phase 3 plan 에서 구현 범위로 포함).
- 코드:
  3. state schema migration 포함 `trackedRepos[]` 도입, 기존 top-level 필드 mirror 유지.
  4. 기존 vitest 통과 + 신규 multi-worktree 테스트 통과.
  5. cwd 가 grove mission 레이아웃 (git 아님 + depth=1 에 git sub-repos) 일 때 `phase-harness run` 실행 시 Phase 1~6 이 에러 없이 진행 (수동 dogfood 기준).
  6. cwd 가 git 아님 + tracked repo 0 개인 상태에서 `phase-harness run` 호출 시 Phase 2 가 아닌 start 시점에 명시적 메시지와 함께 exit 1.
  7. codex gate subprocess 실패 시 에러 메시지에 stderr tail 이 포함된다.

---

## Invariants

- `state.trackedRepos.length >= 1` 이 run 전 구간에서 항상 참.
- `state.baseCommit === state.trackedRepos[0].baseCommit` 이 run 전 구간에서 항상 참 (write 시 동기화).
- `state.implRetryBase === state.trackedRepos[0].implRetryBase` 이 run 전 구간에서 항상 참.
- `state.implCommit === state.trackedRepos[0].implHead` 가 run 전 구간에서 항상 참 (둘 다 null 허용; write 시 동기화) — gate-2 P1 반영.
- **모든 `trackedRepos[i].path` 는 outer cwd 의 하위 경로여야 한다** (`path.relative(cwd, path).startsWith('..')` 금지) — gate-2 P1 반영.
- `trackedRepos.length === 1 && trackedRepos[0].path === cwd` 인 경우 gate diff 출력 바이트, Phase 5 판정 결과 (`implCommit = getHead(cwd)`), artifact 경로, state.json 의 legacy 필드가 **구현 전과 byte-identical**.
- auto-detect 는 cwd 가 git repo 일 때 **수행되지 않는다** (short-circuit).
- `--track` 이 있으면 auto-detect 결과와 `--exclude` 는 모두 무시된다 (`--exclude` 단독 경고).
- Phase 5 성공 판정은 `trackedRepos` 순회로 "어떤 repo 든 `currentHEAD(r) !== r.implRetryBase`" 에 해당하는 단일 규칙만 사용한다 (단일 HEAD 비교 금지).
- Phase 5 성공 후 각 `r.implHead` 는 advance 한 repo 만 `getHead(r.path)` 로 설정되고, 변경 없는 repo 는 `null` 로 남는다. 이 `null` 값은 FR-8 resume ancestry 체크에서 skip 신호로 사용된다 — gate-2 P1 반영.
- codex gate spawn 은 **항상 outer cwd** 에서 실행된다. 어떤 tracked repo 로도 chdir 하지 않는다.
- FR-5 의 `### repo:` label 섹션은 N=1 + trackedRepos[0].path === cwd 케이스에서 **출력되지 않는다** (기존 golden fixture 보호).
- Phase 7 metadata 의 `Harness implementation range: ${baseCommit}..${implCommit}` 단일 라인 포맷은 **N=1 single-repo 케이스에서만** 출력된다. N>1 에서는 `"Harness implementation ranges (per tracked repo):"` 블록으로 교체된다 — gate-2 P1 반영.

---

## Non-goals

- 3+ depth 중첩 repo / submodule 자동 처리 — 지원 안 함. 필요 시 `--track` 명시 (단 cwd-descendant 여야 함).
- **out-of-tree tracked repo** (cwd 밖의 path) — gate-2 P1 반영. codex 샌드박스 확장이 필요한 설계라 non-goal.
- tracked repos 간 cross-repo 변경을 atomic commit 으로 묶는 기능.
- docs-repo 전용 전담 플래그 (`--docs-repo`) — YAGNI 처리.
- `--multi-worktree` 명시 플래그 — `trackedRepos.length >= 1` 단일 모델로 대체.
- `scripts/harness-verify.sh` 의 multi-repo 인식 — checklist 저자 책임으로 이전.
- grove mission 외의 레이아웃(예: monorepo + submodule 혼합) 튜닝.

---

## Open issues resolved during brainstorming

(이 섹션은 gate reviewer 참고용. 실구현이 끝나면 제거 가능.)

- "per-repo tracking 이 정말 필요한가?" → 필요. `baseCommit` 은 run 시작 시점 스냅샷이며 "세션 동안 뭐가 바뀌었는가" 를 나중에 재구성하려면 시작 HEAD 기록 필수.
- "single vs multi 두 모드로 분기?" → 기각. "N≥1 단일 모델" 로 통합해 regression 표면 축소.
- "docs-repo 플래그 추가?" → 기각 (YAGNI). `--track` 순서 규칙이 override 겸용.
- "codex gate 스폰을 docs repo로?" → 기각. 항상 outer cwd, cwd 가 git 아니면 `--skip-git-repo-check` 자동.
- "resume 다중 repo 는 후속 spec?" → 거부. Phase 5 reopen 이 resume 경로와 직결돼 있어 분리 불가능. 본 spec 범위에 포함.
- **gate-2 P1 — `--track` 절대경로 허용 vs 샌드박스 일관성** → cwd-descendant 제약으로 해결. out-of-tree tracked repo 지원은 non-goal.
- **gate-2 P1 — multi-repo 에서 `state.implCommit` 의미 손상** → `state.implCommit ≡ trackedRepos[0].implHead` 로 재정의 (null 허용). Phase 7 metadata 는 N=1/N>1 분기해서 포맷 변경. 소비자는 null-safe 경로 준수.
- **gate-2 P1 — resume ancestry 체크 null 처리 부재** → `r.implHead !== null` 에서만 ancestry 검사. external-commit anchor 는 `implHead ?? implRetryBase ?? baseCommit` fallback.

---

## Deferred

(gate-2 리뷰 피드백 중 본 pass 에서 ≤2 line 수정으로 해결할 수 없는 항목. Phase 3 plan 에서 세부 구현 설계.)

- **D-1 (gate-2 P2)** — Diff size cap / `truncateDiffPerFile` 계약과 새 multi-repo `### repo:` 헤더 + fenced code block 래핑의 상호작용 미명세. 옵션: (i) raw per-repo diff 를 먼저 `truncateDiffPerFile` 한 뒤 markdown 래핑, (ii) `truncateDiffPerFile` 을 fenced block 인식하도록 확장, (iii) 전체 concat 바이트 초과 시 wholesale 버림. Phase 3 plan 에서 세부 규칙 확정 + 유닛테스트 시나리오 정의.
