# Phase Recovery — Implementation Plan (Group A)

관련 산출물:
- Design Spec: `docs/specs/2026-04-19-phase-recovery-design.md`
- Eval checklist: 이 문서 하단 `## Eval Checklist` 섹션

## Slices

순서대로 커밋. 각 slice는 **failing test → 구현 → green → commit**.

---

### Slice 1 — mtime staleness check 제거 (T1)

**Scope**: `src/phases/interactive.ts:112` + `src/resume.ts:493` 두 줄 제거. 단위 테스트 2개 추가.

**Tests (new)**:

1. `tests/phases/interactive.test.ts` — `validatePhaseArtifacts`에 추가:
   - **"accepts phase 1 reopen with unchanged checklist"**: temp runDir에 spec/decisions/checklist 3개를 작성 + `phaseOpenedAt[1]` 을 파일들의 `mtime + 1000ms` 로 세팅(강제 stale 상태). `validatePhaseArtifacts(1, state, cwd)` → `true` 기대.
   - **"accepts phase 3 reopen with unchanged plan"** (full flow): 동일 시나리오, phase 3.

2. `tests/resume.test.ts` 또는 `tests/phases/resume-complete.test.ts` — `completeInteractivePhaseFromFreshSentinel`:
   - **"accepts phase 1 with stale mtime"**: same scenario + verify `state.specCommit` 세팅된다.

   > 기존 `completeInteractivePhase` 테스트에 stale mtime으로 false를 기대하는 어설션이 있으면 업데이트 필요. Test-first로 구 테스트를 실행 + diagnose 후 적용.

**Impl**:
- `src/phases/interactive.ts:112` 삭제:
  ```diff
  -        // mtime must be >= phaseOpenedAt (both in ms)
  -        if (openedAt !== null && stat.mtimeMs < openedAt) return false;
  ```
  `openedAt` 사용처가 없어지면 local const 삭제(L100 `const openedAt = ...`).

- `src/resume.ts:493` 삭제 (동일 시맨틱):
  ```diff
  -        if (openedAt !== null && Math.floor(stat.mtimeMs) < openedAt) return false;
  ```
  `openedAt` 사용처 정리 L484.

**Commit**: `fix(phases): accept rev-invariant artifacts on reopen (drop mtime staleness check)`

---

### Slice 2 — IGNORABLE_ARTIFACTS + 자동 복구 모듈 (T2 core)

**Scope**:
- `src/config.ts`에 `IgnorablePattern` interface + `IGNORABLE_ARTIFACTS` 상수 export.
- `src/phases/dirty-tree.ts` 신규 모듈 — `tryAutoRecoverDirtyTree(cwd, runId)`.
- `src/phases/interactive.ts` phase-5 branch에서 호출.
- `src/resume.ts::completeInteractivePhaseFromFreshSentinel` phase-5 branch에서 호출 (ADR-13 symmetric).
- `src/types.ts`에 `strictTree: boolean` 필드 추가.
- `src/state.ts` migration + `createInitialState` 파라미터 추가(default false).

**Tests (new)**:

1. `tests/phases/dirty-tree.test.ts` 신규:
   - **"recovers python __pycache__ residuals"**: git repo fixture + untracked `todo/__pycache__/foo.pyc` → `recovered`, `.gitignore`에 `__pycache__/` 추가, commit 있음.
   - **"recovers pytest cache residuals"**: `.pytest_cache/v/cache/nodeids` → recovered.
   - **"recovers node_modules residuals"**: `node_modules/foo/package.json` → recovered.
   - **"blocks on tracked-modified file"**: 기존 tracked 파일 수정 → blocked.
   - **"blocks on unknown untracked file"**: `src/random.py` 같은 allowlist 밖 untracked → blocked.
   - **"idempotent when gitignore already contains entry"**: `.gitignore`에 이미 `__pycache__/` 있음 + untracked `__pycache__/foo.pyc` → git status는 여전히 파일을 보여줘야 하는가? (**주의**: 이미 ignored라면 `git status --porcelain`이 해당 라인 자체를 생성하지 않음. 따라서 이 시나리오는 `status=empty` → `outcome: 'clean'` 으로 조기 return. 테스트에서 확인.)
   - **"handles missing .gitignore"**: `.gitignore` 파일 자체 없음 + python residuals → 생성 + recovered.
   - **"handles commit failure gracefully"**: pre-staged 다른 파일 상태 유도 등으로 `git commit` 실패 → throw (validator 상위에서 catch).

2. `tests/phases/interactive.test.ts` — `validatePhaseArtifacts` phase 5:
   - **"phase 5 dirty tree with ignorable artifacts auto-recovers"**: implRetryBase 대비 HEAD 전진 + `__pycache__` untracked → `validatePhaseArtifacts(5, state, cwd)` returns `true`, `.gitignore`에 엔트리 추가됨.
   - **"phase 5 dirty tree with blocking artifacts fails"**: untracked non-allowlist 파일 → `false`, `<runDir>/phase-5-dirty-tree.md` 생성됨.
   - **"phase 5 strictTree=true skips auto-recovery"**: ignorable residual + `state.strictTree = true` → `false`, diagnostic 파일 생성.

3. `tests/state.test.ts` — migration:
   - **"migrates old state without strictTree field"**: legacy state.json → load → `state.strictTree === false`.

**Impl**:

- `src/config.ts` (상수 export):
  ```ts
  export interface IgnorablePattern {
    label: string;
    pathRegex: RegExp;
    gitignoreGlob: string;
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

- `src/phases/dirty-tree.ts` 신규:
  - `interface DirtyTreeRecoveryResult { outcome: 'clean' | 'recovered' | 'blocked'; blockers: string[]; addedEntries: string[] }`.
  - `tryAutoRecoverDirtyTree(cwd, runId)` — spec D2 시퀀스.
  - `writeDirtyTreeDiagnostic(runDir, reason, body)` — `<runDir>/phase-5-dirty-tree.md` 생성. 내용: 타임스탬프, 이유, porcelain body, "To recover manually:\n  - fix git state then `harness resume`\n  - or `harness jump 5` to re-execute Phase 5".

- `src/types.ts`: `HarnessState`에 `strictTree: boolean` 필드 추가.

- `src/state.ts`:
  - Migration(L82 근처): `if (raw.strictTree === undefined) raw.strictTree = false;`.
  - `createInitialState` 시그니처: `strictTree: boolean = false` 파라미터 추가, 반환 object에 포함.

- `src/phases/interactive.ts` phase-5 branch:
  ```ts
  if (phase === 5) {
    try {
      const base = state.implRetryBase;
      const runDir = path.join(state.harnessDir /* ... */);  // 실제: runDir는 어디서?
      let porcelain = execSync('git status --porcelain', { cwd, encoding: 'utf-8' }).trim();
      if (porcelain !== '') {
        // ...
      }
      // ...
    }
  }
  ```
  > **주의**: `validatePhaseArtifacts`는 현재 `runDir`를 인자로 받지 않는다. 시그니처에 추가 필요 → 모든 call site 업데이트. `interactive.ts`의 세 call site(L247, L301, L330) + `resume.ts`의 세 call site(92, 124, 673)에서 runDir 전달. 깨끗한 파라미터 추가이므로 위험 낮음.

- `src/resume.ts::completeInteractivePhaseFromFreshSentinel`:
  - 시그니처에 `runDir: string` 추가.
  - Phase 5 branch: 동일 auto-recovery 호출 + diagnostic 작성.

**Commit**: `feat(phase-recovery): auto-recover P5 dirty tree for standard language artifacts`

---

### Slice 3 — Wrapper skill gitignore step 0

**Scope**:
- `src/context/skills/harness-phase-5-implement.md` — `## Process` 1번 앞에 step 0 삽입 (spec D4 문구).
- `## Invariants` 업데이트 (spec D5 문구).
- Assembler inline 경로(`src/context/assembler.ts`)가 frontmatter 제거 + placeholder 치환을 수행함을 재검증. 별도 assembler 수정 없음.

**Tests (new)**:

1. `tests/context/assembler.test.ts` 또는 기존 assembler 테스트 확장:
   - **"phase 5 prompt includes gitignore scaffolding mandate"**: assembleInteractivePrompt(5, ...) 결과에 `chore: add standard gitignore entries` 문자열 포함 + `git status --porcelain` 언급 포함.
   - **"phase 5 invariants mention reopen-ok without changes"**: Invariants 섹션에 개정 문구 포함.

**Impl**: 단순 markdown 수정. 줄 추가/수정.

**Commit**: `feat(phase-5-skill): mandate standard gitignore in scaffolding + generalize reopen invariant`

---

### Slice 4 — `--strict-tree` CLI flag + end-to-end integration

**Scope**:
- `bin/harness.ts`: `harness start` + `harness run` 두 커맨드에 `--strict-tree` option 등록.
- `src/commands/start.ts::StartOptions`에 `strictTree?: boolean` 추가 + `createInitialState`로 전달.
- `src/commands/run.ts`(existing run path) 대응. 실제로 run.ts가 존재하는지 확인 후 동일 처리.

**Tests (new)**:

1. `tests/commands/run.test.ts` 또는 start test:
   - **"--strict-tree persists to state.json"**: `startCommand('task', { strictTree: true })` → `state.strictTree === true`.
   - **"--strict-tree default false"**: option 생략 → `state.strictTree === false`.

2. Integration test (가능한 경우 가벼운 e2e):
   - Test fixture(git repo) + state + phase-5 sentinel + dirty tree (`__pycache__/` untracked). `strictTree=false`에서 validator 성공 + gitignore 커밋. `strictTree=true`에서 validator 실패 + diagnostic 파일 생성.

**Impl**:
- `bin/harness.ts`:
  ```ts
  .option('--strict-tree', 'disable phase-5 dirty-tree auto-recovery (strict mode)')
  ```
  두 커맨드 블록(L17~29, L30~42)에 각각 추가. `opts.strictTree` 를 `startCommand`에 패스.

- `src/commands/start.ts`:
  - `StartOptions.strictTree?: boolean`.
  - `createInitialState(..., options.strictTree ?? false)`.

**Commit**: `feat(cli): add --strict-tree flag to disable P5 dirty-tree auto-recovery`

---

### Slice 5 — 최종 검증 + 문서

**Scope**:
- `pnpm tsc --noEmit`.
- `pnpm vitest run` — 기대 baseline 617 + 신규 테스트 ~12개 → 629±.
- `pnpm build` — dist 갱신.
- (선택) README 또는 `docs/HOW-IT-WORKS.md`에 `--strict-tree` 한 줄 예시 추가.

**Commit**: 필요 시 `docs(readme): document --strict-tree flag` (없으면 skip).

---

## 실행 순서

1. Slice 1 (T1, 파일 2개 한 줄씩 제거 + 테스트).
2. Slice 2 (T2 core, 새 모듈 + 시그니처 변경).
3. Slice 3 (wrapper skill).
4. Slice 4 (CLI flag).
5. Slice 5 (최종 검증 + 문서).

각 slice 끝에 `pnpm tsc --noEmit && pnpm vitest run` green 유지.

---

## Eval Checklist

Phase 6 자동 verify가 소비할 checklist.json 형식:

```json
[
  { "id": "tsc",    "command": "pnpm tsc --noEmit",
    "expect": { "kind": "exit-code", "code": 0 } },
  { "id": "vitest", "command": "pnpm vitest run",
    "expect": { "kind": "exit-code", "code": 0 } },
  { "id": "build",  "command": "pnpm build",
    "expect": { "kind": "exit-code", "code": 0 } },
  { "id": "test-count", "command": "pnpm vitest run --reporter=json 2>/dev/null | jq '.numTotalTests'",
    "expect": { "kind": "ge", "value": 625 } }
]
```

> `test-count`는 신규 테스트가 실제로 추가되었음을 검증(baseline 617 + 최소 8개). 상한은 두지 않음.

PR 본문 test plan에는 다음을 포함:
- `pnpm tsc --noEmit` 결과 pass
- `pnpm vitest run` 통과 개수(기대 629+)
- `pnpm build` dist 업데이트 확인
- Post-merge dogfood Round 3에서 observations.md §P1-NEW/P1-RESUME 시나리오 재현 → 둘 다 자동 recovery 성공 기대
- `--strict-tree` 한 줄 예시 CLI 출력 (help 확인)

---

## Deferred (plan 차원)

- **Complexity hint 기반 plan 사이즈 제어** — FOLLOWUPS §P1.4. Group C.
- **Gate retry ceiling 상향 / ADR-4 impl-only 경로** — Group F. FOLLOWUPS §P1.2/P1.3.
- **Self-audit 단계 추가** — wrapper skill 공유 파일 수정. Group B.
- **Allowlist 언어 확장** — Rust/Go/Java/Ruby. follow-up PR.
- **Dogfood Round 3 재현 자체** — PR 머지 후 별도 세션.
