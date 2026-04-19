# Install Skills + CLI Rename — Design Spec (Light)

Related:
- Task: `.harness/2026-04-19-untitled/task.md`
- Decisions: `.harness/2026-04-19-untitled/decisions.md`
- Checklist: `.harness/2026-04-19-untitled/checklist.json`
- Previous gate feedback: `.harness/2026-04-19-untitled/gate-2-feedback.md`

## Complexity

Medium — 여러 산출물(신규 커맨드 + 스킬 벤더링 + bin 이름 변경)과 전 프로젝트 문서 갱신이 얽혀 있다. 한 편, 로직 자체는 단순 파일 복사/이름 치환이라 Large는 아님.

## Context & Decisions

**현재 상태**
- npm 패키지 이름은 `phase-harness`, bin 이름은 `harness`(`package.json:6`). 사용자는 `harness run|start|resume|...` 로 호출한다.
- `src/context/skills/harness-phase-{1,3,5}-*.md` 는 **어셈블러 인라인 전용**(PR #15 이후 `{{wrapper_skill}}` 플레이스홀더로 렌더). 일반 Claude Code 세션에서 의미 있는 독립 스킬 아님.
- `codex-gate-review` 스킬은 **오직 사용자 스코프**(`~/.claude/skills/codex-gate-review/`)에만 존재하며, 레포에 소스가 벤더링되어 있지 않다. 과거 수동 설치의 잔여. 이전 `harness` 슬래시 커맨드는 이미 삭제되었으나 이 스킬만 남아 outdated 상태.
- 현재 CLI 이름 `harness`는 npm 전역 bin 공간에서 다른 패키지(예: `@badrap/harness` 류)와 이름이 겹칠 위험이 있다.

**결정 사항**
1. **bin 이름 `harness` → `phase-harness`** 로 변경. 패키지 이름과 bin 이름을 일치시켜 npm 전역 설치 시 충돌을 피한다. 기존 `harness` 별칭은 **유지하지 않는다**(사용자가 명시적으로 "unique name" 요청). 단, 레포 경로 `bin/harness.ts`·`dist/bin/harness.js` 파일명은 유지(내부 파일 경로 변경의 ripple을 줄이기 위함). `package.json` `bin` 매핑만 바꾼다.
2. **독립 설치 대상 스킬은 `codex-gate-review` 한 개로 시작**. phase-1/3/5 wrapper는 인라인 렌더용이라 제외한다. 차후 독립 invocable 스킬이 추가되면 동일 메커니즘으로 확장.
3. **스킬 이름 네임스페이스**: 사용자/프로젝트 스코프에 설치될 때 디렉터리 + 프론트매터 `name` 을 `phase-harness-codex-gate-review` 로 치환하여 타 패키지와 충돌 방지. SKILL.md 본문 내 예시 호출(`/codex-gate-review --gate ...`)도 새 이름으로 수정.
4. **스킬 레포 벤더링 위치**: `src/context/skills/` 내부는 어셈블러 인라인 전용이므로 혼동을 피하려 **`src/context/skills-standalone/codex-gate-review/`** 신설. 어셈블러는 이 경로를 건드리지 않는다. `scripts/copy-assets.mjs` 에 복사 규칙 추가.
5. **커맨드 신설**: `phase-harness install-skills [--user|--project] [--project-dir <path>]` (기본 `--user`), `phase-harness uninstall-skills [--user|--project] [--project-dir <path>]`.
   - `install-skills`: 각 독립 스킬 디렉터리를 타겟 스코프(`~/.claude/skills/phase-harness-<name>/` 또는 `<target>/.claude/skills/phase-harness-<name>/`)에 복사. 기존 디렉터리가 있으면 덮어쓰되, 비-`phase-harness-` 접두 스킬은 건드리지 않음.
   - `uninstall-skills`: 타겟 스코프에서 `phase-harness-*` 접두 디렉터리만 제거.
   - 추가로 **레거시 감지**: `install-skills` 실행 시 타겟 스코프에 접두 없는 `codex-gate-review/`가 남아 있으면 **경고 메시지로 안내**(자동 삭제는 하지 않음 — 사용자 동의 없이 파괴적 행동 금지).
6. **경로 해석 & HOME 주입 규약 (ADR-6/7 참조)**: 타겟 루트 해석을 순수 함수 `resolveSkillsRoot({ scope, projectDir?, homeDir? })` 로 분리한다. `scope === 'user'` 면 `path.join(homeDir ?? os.homedir(), '.claude', 'skills')`, `scope === 'project'` 면 `path.join(projectDir ?? process.cwd(), '.claude', 'skills')`. 테스트는 이 함수에 tmp `homeDir` 을 주입해 `--user` 기본 경로(홈 디렉터리 기반)를 직접 검증한다. CLI 래퍼는 이 함수를 호출만 하며, `process.env.HOME` 조작은 하지 않는다.
7. **옵션 조합 규약 (ADR-8)**:
   - `--user` 와 `--project` 는 상호배타. 둘 다 있으면 `process.exit(1)` + stderr 에러.
   - `--project-dir <path>` 는 `--project` 를 **암묵적으로 선택**한다. `--user` 와 `--project-dir` 이 동시에 지정되면 상호배타 에러.
   - 둘 다 지정하지 않으면 기본값 `--user`.
   - `--project-dir` 값이 존재하지 않는 경로여도 `install-skills` 는 해당 경로를 생성하며 진행(테스트 친화적 동작). 단 쓰기 권한이 없으면 친절한 에러.
8. **레거시 정리 분리 (ADR-9)**: 개발 머신의 stale `~/.claude/skills/codex-gate-review/` 제거는 **제품 요구사항이 아닌 운영 체크리스트**로 다룬다. 본 레포 코드·테스트와 독립이며 `install-skills` 의 경고 출력이 artifact 검증의 대리 지표다. Requirements 에서 분리되어 "운영 체크리스트" 부록으로 이동.
9. **문서 업데이트 범위**: `README.md`, `README.ko.md`, `docs/HOW-IT-WORKS.md`, `docs/HOW-IT-WORKS.ko.md`, `CLAUDE.md`(repo)의 `harness <subcommand>` 용례를 `phase-harness <subcommand>` 로 치환. CLI 도움말(Commander `.name()`) 도 `phase-harness` 로 갱신.

## Requirements / Scope

**IN**
- R1: `package.json` 의 `bin` 을 `{"phase-harness": "./dist/bin/harness.js"}` 로 변경. `name` 은 그대로 `phase-harness` 유지.
- R2: `bin/harness.ts` Commander `.name('harness')` → `.name('phase-harness')`. `.description` 도 일치 갱신.
- R3: `codex-gate-review` SKILL.md + gate-prompts.md 를 `src/context/skills-standalone/codex-gate-review/` 로 복사. 프론트매터 `name: codex-gate-review` → `name: phase-harness-codex-gate-review`. 본문 내 `/codex-gate-review --gate ...` 사용 예시를 `/phase-harness-codex-gate-review --gate ...` 로 갱신.
- R4: `scripts/copy-assets.mjs` 에 `src/context/skills-standalone` → `dist/src/context/skills-standalone` 복사 규칙 추가.
- R5: 신규 커맨드 `install-skills [--user|--project] [--project-dir <path>]` 구현.
  - 기본: `--user` (홈 스코프 `~/.claude/skills/`).
  - `--project`: cwd 기준 `./.claude/skills/`. `--project-dir <path>` 는 `--project` 를 암묵적으로 선택하고 base 경로를 override.
  - `--user` + `--project` 혹은 `--user` + `--project-dir` 조합은 에러 (ADR-8).
  - 기존 접두 없는 `codex-gate-review/` 감지 시 stderr 경고.
- R6: 신규 커맨드 `uninstall-skills [--user|--project] [--project-dir <path>]` 구현. 옵션 조합 규칙은 R5 와 동일.
- R7: `README.md`, `README.ko.md`, `docs/HOW-IT-WORKS.md`, `docs/HOW-IT-WORKS.ko.md`, `CLAUDE.md` 의 CLI 용례 치환 + 신규 커맨드 문서 추가.
- R8: 순수 경로 해석 함수 `resolveSkillsRoot({ scope, projectDir?, homeDir? })` 를 분리 구현하고, `--user` 기본 경로가 주입된 `homeDir` 기준으로 `<homeDir>/.claude/skills` 를 반환하는지 단위 테스트로 직접 검증한다.
- R9: 통합 테스트: `install-skills` / `uninstall-skills` 가 (a) 주입 `homeDir` 기반의 `--user` 기본 경로, (b) `--project-dir` 기반의 프로젝트 스코프, 두 경로 모두에서 파일을 배치·삭제하는지 검증. 접두 없는 더미 스킬이 uninstall 후에도 보존되는지 확인.
- R10: 옵션 조합 에러 테스트: `--user --project` 조합 시 non-zero exit, `--user --project-dir <x>` 조합 시 non-zero exit.
- R11: `pnpm tsc --noEmit` + `pnpm vitest run` + `pnpm build` 모두 통과.

**OUT**
- phase-1/3/5 wrapper 스킬의 독립 설치(현재 어셈블러 인라인 전용 — 별도 태스크에서 재검토).
- `harness` 레거시 별칭 유지(사용자가 unique 요청).
- `SessionStart` hook 자동 설치 기능.
- 설치 스킬 업데이트 자동 감지(버전 비교). 현재는 overwrite 단순 복사.
- 개발 머신의 stale `~/.claude/skills/codex-gate-review/` 자동 제거 (운영 체크리스트로 이동, 부록 참조).

## Design

**파일 레이아웃 (신설)**
```
src/
  context/
    skills-standalone/
      codex-gate-review/
        SKILL.md          # name: phase-harness-codex-gate-review
        gate-prompts.md
  commands/
    install-skills.ts     # CLI 진입점 + resolve/copy 흐름
    uninstall-skills.ts
  skills/
    install.ts            # resolveSkillsRoot 등 순수 헬퍼 (테스트 용이)
```

**copy-assets.mjs 추가 규칙**
```
{ from: 'src/context/skills-standalone', to: 'dist/src/context/skills-standalone', recursive: true }
```

**Commander 등록 (`bin/harness.ts`)**
- `program.name('phase-harness')`.
- 신규 서브커맨드:
  - `install-skills` — options: `--user` (default-by-absence), `--project`, `--project-dir <path>`.
  - `uninstall-skills` — 동일 옵션.

**경로 해석 (순수 함수)**
```ts
// src/skills/install.ts
export type SkillsScope = 'user' | 'project';
export function resolveSkillsRoot(opts: {
  scope: SkillsScope;
  projectDir?: string;
  homeDir?: string;
}): string {
  if (opts.scope === 'user') {
    return path.join(opts.homeDir ?? os.homedir(), '.claude', 'skills');
  }
  return path.join(opts.projectDir ?? process.cwd(), '.claude', 'skills');
}
```
CLI 래퍼는 flag 파싱 결과를 그대로 이 함수에 전달. `process.env.HOME` override 는 금지.

**옵션 조합 결정 로직**
1. `opts.user && opts.project` → stderr 에러 "--user and --project are mutually exclusive" + `process.exit(1)`.
2. `opts.user && opts.projectDir` → 동일 에러.
3. `opts.project || opts.projectDir` → `scope = 'project'`, `projectDir = opts.projectDir ?? process.cwd()`.
4. else → `scope = 'user'`, `homeDir = os.homedir()` (테스트는 DI 로 override).

**`install-skills` 동작**
1. 옵션 조합 검사 → 타겟 루트 결정(`resolveSkillsRoot`).
2. 소스 루트: 러닝 타임 실행 파일(`import.meta.url`) 기준 `dist/src/context/skills-standalone/`. 개발 시(소스 실행)에는 `src/context/skills-standalone/` fallback.
3. 소스 루트의 각 하위 디렉터리(= 스킬)마다:
   - 대상 디렉터리 `<target>/phase-harness-<dirname>/` 생성(이미 있으면 지우고 재생성 — overwrite).
   - `cpSync` 로 재귀 복사.
4. 레거시 감지: `<target>/codex-gate-review/` 존재 시 경고 출력(삭제 안 함).
5. stdout 에 설치된 경로·스킬 목록 요약 출력.

**`uninstall-skills` 동작**
1. 옵션 조합 검사 → 타겟 루트 결정(동일).
2. 타겟 루트 내 `phase-harness-*` 접두 디렉터리만 열거하여 `rmSync({ recursive, force })`.
3. 접두 없는 디렉터리(다른 스킬)는 건드리지 않는다.
4. 제거된 스킬 목록 출력.

**에러 처리**
- 소스 스킬 디렉터리가 비어 있으면(`existsSync === false`) 사용자에게 친절한 에러 메시지(`pnpm build` 선행 필요). 예외 throw 대신 `process.exit(1)`.
- 타겟 디렉터리 생성 실패(권한) 시 원인 메시지 노출.
- 옵션 상호배타 위반 시 usage 힌트 + `process.exit(1)`.

**테스트 전략 (vitest)**
- `resolve-skills-root.test.ts` (단위): `resolveSkillsRoot({scope:'user', homeDir:'/tmp/fakehome'})` → `/tmp/fakehome/.claude/skills`. `scope:'project', projectDir:'/tmp/proj'` → `/tmp/proj/.claude/skills`. `homeDir` 미지정 시 `os.homedir()` 사용. **→ R8 (P1 feedback 대응)**.
- `install-skills.test.ts`:
  - (a) `--project-dir <tmp>` 경로에 설치 후 `phase-harness-codex-gate-review/SKILL.md` 존재 및 프론트매터 `name: phase-harness-codex-gate-review` assert.
  - (b) `--user` 기본 경로 검증: CLI 함수를 직접 호출하거나 `resolveSkillsRoot` + copy 함수를 조합해서 tmp `homeDir` 로 주입 → `<tmpHome>/.claude/skills/phase-harness-codex-gate-review/` 생성을 assert. **→ R9 (P1 feedback 대응)**.
  - (c) 옵션 조합 에러: `--user` + `--project-dir <x>` 호출 시 non-zero exit + stderr 메시지. **→ R10**.
- `uninstall-skills.test.ts`: install → 접두 없는 더미 `plain-skill/` 추가 → uninstall → `phase-harness-*` 제거, `plain-skill/` 보존 assert. `--user` + tmp home 경로에서도 동일 동작 확인.

**문서 갱신 포인트**
- `README.md` / `README.ko.md`: Quick Start 코드블록(`harness run ...`) 을 `phase-harness run ...` 로 치환. "Install standalone skills" 섹션 신설.
- `docs/HOW-IT-WORKS.md` / `.ko.md`: CLI 예시 치환.
- `CLAUDE.md`: "풀 프로세스 호출" 섹션의 `harness run` 샘플 치환. Install-skills 사용 예 추가.

**부록: 운영 체크리스트 (제품 요구 아님)**
- 본 feature merge 이후, 구현자는 개발 머신에서 stale `~/.claude/skills/codex-gate-review/` 디렉터리를 수동으로 `rm -rf` 한다. 이는 재현 불가능한 환경 상태이므로 eval checklist 대상이 아니며 PR 설명에 수행 여부만 기록한다. `install-skills` 의 legacy 감지 경고가 정상 동작함을 스냅샷/수동 로그로 확인하는 정도로 충분하다.

## Open Questions

- `--project-dir` 플래그가 공개 API 로 노출되는 것이 과한 스코프일 수 있다. 현 설계에서는 테스트·어드밴스드 용도로 유지하되, 문서는 `--user` / `--project` 기본 흐름만 메인 예제로 쓰고 `--project-dir` 은 "Testing / advanced" 섹션에 별도 노출한다. 추후 사용자 피드백에 따라 private flag 로 전환 가능.
- 레거시 `~/.claude/skills/codex-gate-review/` 자동 제거 플래그(`install-skills --cleanup-legacy`) 도입 여부는 보류(후속 이슈). MVP 에서는 경고만.
- 스킬 배포 버전관리(업데이트 감지·diff·선택적 overwrite) 는 MVP 이후. 현재는 무조건 overwrite.

## Implementation Plan

- [ ] **Task 1 — 스킬 벤더링**: `src/context/skills-standalone/codex-gate-review/{SKILL.md, gate-prompts.md}` 생성. `SKILL.md` 프론트매터 `name:` 을 `phase-harness-codex-gate-review` 로 변경, 본문 invocation 예시를 새 이름으로 갱신. `scripts/copy-assets.mjs` 에 `skills-standalone` 복사 규칙 추가.
- [ ] **Task 2 — CLI 이름 변경**: `package.json` `bin` 맵 `{"phase-harness": "./dist/bin/harness.js"}` 로 수정. `bin/harness.ts` 의 `.name('harness')` → `.name('phase-harness')`. 로그/에러 메시지 중 사용자 노출 `harness` 키워드가 있는지 grep 하여 자연스러운 표현으로 치환(내부 경로/세션명은 그대로 유지 OK).
- [ ] **Task 3 — 경로 해석 + install-skills**: `src/skills/install.ts` 에 `resolveSkillsRoot` 순수 함수 작성(scope/projectDir/homeDir DI). `src/commands/install-skills.ts` 작성(`--user`/`--project`/`--project-dir`, 옵션 조합 상호배타 검사, 레거시 감지 경고). 소스 루트는 `import.meta.url` 기반으로 `dist/src/context/skills-standalone` 우선, 없으면 `src/context/skills-standalone` fallback. 각 하위 스킬 디렉터리를 `<target>/phase-harness-<dirname>/` 로 overwrite 복사. `bin/harness.ts` 서브커맨드 등록.
- [ ] **Task 4 — uninstall-skills**: `src/commands/uninstall-skills.ts` 작성. `resolveSkillsRoot` 재사용. 타겟 루트에서 `phase-harness-*` 접두 디렉터리만 `rmSync` 로 제거. 접두 없는 디렉터리 보존. 옵션 조합 검사 동일. `bin/harness.ts` 등록.
- [ ] **Task 5 — 테스트**: 
  - `tests/resolve-skills-root.test.ts`: 순수 함수 단위 테스트 (user/project 각각, homeDir/projectDir 주입 포함) — **P1 대응**.
  - `tests/install-skills.test.ts`: (a) `--project-dir` 경로 설치 assert, (b) tmp `homeDir` 주입으로 `--user` 기본 경로 설치 assert — **P1 대응**, (c) 옵션 조합 에러 — **R10**.
  - `tests/uninstall-skills.test.ts`: install → 더미 skill 생성 → uninstall → 접두 보존 assert, `--user` tmp home 경로도 동일 검증.
- [ ] **Task 6 — 문서 갱신**: `README.md`, `README.ko.md`, `docs/HOW-IT-WORKS.md`, `docs/HOW-IT-WORKS.ko.md`, `CLAUDE.md` 의 `harness <cmd>` 용례를 `phase-harness <cmd>` 로 일관 치환. 각 README 에 "Install standalone skills" 섹션(한국어는 "독립 스킬 설치") 추가. `--user`/`--project` 기본 예시 + `--project-dir` 은 "Testing / advanced" 하위에 별도 노출. 신규 커맨드 설명 포함.
- [ ] **Task 7 — 빌드 검증 & 운영 체크리스트 실행**: `pnpm tsc --noEmit`, `pnpm vitest run`, `pnpm build` 통과 확인. `node dist/bin/harness.js --help` 출력에 `phase-harness` 표기 확인. 운영 체크리스트로서 개발 머신의 stale `~/.claude/skills/codex-gate-review/` 수동 `rm -rf` 수행 (제품 요구 아님 — PR 설명에 수행 기록).

## Eval Checklist Summary

세부 검증은 `.harness/2026-04-19-untitled/checklist.json` 참조. 포함 항목:
- `typecheck` — `pnpm tsc --noEmit`
- `test` — `pnpm vitest run` (단위 `resolveSkillsRoot` + `--user` 기본 경로 통합 테스트 포함)
- `build` — `pnpm build`
- `cli-name-phase-harness` — 빌드 산출물의 `--help` 출력에 `phase-harness` 포함
- `cli-name-not-harness-generic` — `Usage: harness` 가 포함되지 않음
- `install-skills-help` — `install-skills --help` 존재
- `uninstall-skills-help` — `uninstall-skills --help` 존재
- `standalone-skill-vendored` — 소스에 `phase-harness-codex-gate-review` 프론트매터 포함된 SKILL.md 존재
- `standalone-skill-in-dist` — dist 빌드 산출물에도 SKILL.md 포함
