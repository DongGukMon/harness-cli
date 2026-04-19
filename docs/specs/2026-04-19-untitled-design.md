# Install Skills + CLI Rename — Design Spec (Light)

Related:
- Task: `.harness/2026-04-19-untitled/task.md`
- Decisions: `.harness/2026-04-19-untitled/decisions.md`
- Checklist: `.harness/2026-04-19-untitled/checklist.json`

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
5. **커맨드 신설**: `phase-harness install-skills [--user|--project]` (기본 `--user`), `phase-harness uninstall-skills [--user|--project]`.
   - `install-skills`: `dist/src/context/skills-standalone/*` 하위 각 스킬 디렉터리를 타겟 스코프(`~/.claude/skills/phase-harness-<name>/` 또는 `<cwd>/.claude/skills/phase-harness-<name>/`)에 복사. 기존 디렉터리가 있으면 덮어쓰되(`--force` 기본 true 동작), 비-phase-harness 접두 스킬은 건드리지 않음.
   - `uninstall-skills`: 타겟 스코프에서 `phase-harness-*` 접두 디렉터리만 제거.
   - 추가로 **레거시 감지**: `install-skills` 실행 시 타겟 스코프에 접두 없는 `codex-gate-review/`가 남아 있으면 **경고 메시지로 안내**(자동 삭제는 하지 않음 — 사용자 동의 없이 파괴적 행동 금지).
6. **본 구현 중 1회성 작업**: 현재 개발 머신의 stale `~/.claude/skills/codex-gate-review/` 디렉터리는 구현 단계 마지막 수동 정리 태스크로 제거한다(사용자 요구 1번). 이는 일회성 쉘 액션이며 제품 코드에 들어가지 않는다.
7. **문서 업데이트 범위**: `README.md`, `README.ko.md`, `docs/HOW-IT-WORKS.md`, `docs/HOW-IT-WORKS.ko.md`, `CLAUDE.md`(repo)의 `harness <subcommand>` 용례를 `phase-harness <subcommand>` 로 치환. CLI 도움말(Commander `.name()`) 도 `phase-harness` 로 갱신.

## Requirements / Scope

**IN**
- R1: `package.json` 의 `bin` 을 `{"phase-harness": "./dist/bin/harness.js"}` 로 변경. `name` 은 그대로 `phase-harness` 유지.
- R2: `bin/harness.ts` Commander `.name('harness')` → `.name('phase-harness')`. `.description` 도 일치 갱신.
- R3: `codex-gate-review` SKILL.md + gate-prompts.md 를 `src/context/skills-standalone/codex-gate-review/` 로 복사. 프론트매터 `name: codex-gate-review` → `name: phase-harness-codex-gate-review`. 본문 내 `/codex-gate-review --gate ...` 사용 예시를 `/phase-harness-codex-gate-review --gate ...` 로 갱신.
- R4: `scripts/copy-assets.mjs` 에 `src/context/skills-standalone` → `dist/src/context/skills-standalone` 복사 규칙 추가.
- R5: 신규 커맨드 `install-skills [--user|--project] [--project-dir <path>]` 구현.
  - 기본: `--user` (홈 스코프 `~/.claude/skills/`).
  - `--project`: cwd 기준 `./.claude/skills/`. `--project-dir` 로 override 가능.
  - 기존 접두 없는 `codex-gate-review/` 감지 시 stderr 경고(“legacy skill 감지, 수동 제거 권장”).
- R6: 신규 커맨드 `uninstall-skills [--user|--project] [--project-dir <path>]` 구현.
- R7: `README.md`, `README.ko.md`, `docs/HOW-IT-WORKS.md`, `docs/HOW-IT-WORKS.ko.md`, `CLAUDE.md` 의 CLI 용례 치환 + 신규 커맨드 문서 추가.
- R8: 개발 머신의 stale `~/.claude/skills/codex-gate-review/` 1회성 제거 (사용자 요구 1번).
- R9: 단위 테스트: `install-skills` / `uninstall-skills` 가 임시 홈 디렉터리 기준으로 정확히 파일을 배치·삭제하는지 검증.
- R10: `pnpm tsc --noEmit` + `pnpm vitest run` + `pnpm build` 모두 통과.

**OUT**
- phase-1/3/5 wrapper 스킬의 독립 설치(현재 어셈블러 인라인 전용 — 별도 태스크에서 재검토).
- `harness` 레거시 별칭 유지(사용자가 unique 요청).
- `SessionStart` hook 자동 설치 기능.
- 설치 스킬 업데이트 자동 감지(버전 비교). 현재는 overwrite 단순 복사.

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
    install-skills.ts
    uninstall-skills.ts
```

**copy-assets.mjs 추가 규칙**
```
{ from: 'src/context/skills-standalone', to: 'dist/src/context/skills-standalone', recursive: true }
```

**Commander 등록 (`bin/harness.ts`)**
- `program.name('phase-harness')`.
- 신규 서브커맨드:
  - `install-skills` — options: `--user` (default), `--project`, `--project-dir <path>`.
  - `uninstall-skills` — 동일 옵션.

**`install-skills` 동작**
1. 타겟 루트 결정: `--project` 면 `<cwd>/.claude/skills/` 혹은 `<project-dir>/.claude/skills/`, 아니면 `~/.claude/skills/`.
2. 소스 루트: 러닝 타임 실행 파일(`import.meta.url`) 기준 `dist/src/context/skills-standalone/`. 개발 시(소스 실행)에는 `src/context/skills-standalone/` fallback.
3. 소스 루트의 각 하위 디렉터리(= 스킬)마다:
   - 대상 디렉터리 `<target>/phase-harness-<dirname>/` 생성(이미 있으면 지우고 재생성 — overwrite).
   - `cpSync` 로 재귀 복사.
4. 레거시 감지: `<target>/codex-gate-review/` 존재 시 경고 출력(삭제 안 함).
5. stdout 에 설치된 경로·스킬 목록 요약 출력.

**`uninstall-skills` 동작**
1. 타겟 루트 결정(동일).
2. 타겟 루트 내 `phase-harness-*` 접두 디렉터리만 열거하여 `rmSync({recursive, force})`.
3. 접두 없는 디렉터리(다른 스킬)는 건드리지 않는다.
4. 제거된 스킬 목록 출력.

**에러 처리**
- 소스 스킬 디렉터리가 비어 있으면(`existsSync === false`) 사용자에게 친절한 에러 메시지(`pnpm build` 선행 필요). 예외 throw 아니고 process.exit(1).
- 타겟 디렉터리 생성 실패(권한) 시 원인 메시지 노출.

**테스트 전략 (vitest)**
- `install-skills.test.ts`: `tmp` 디렉터리를 HOME처럼 간주하고(`--project-dir` 또는 `HOME` env override 중 단순한 쪽 선택 — `--project-dir` 사용 + 프로젝트 스코프로 검증해도 정상성 확인 충분), 설치 후 `phase-harness-codex-gate-review/SKILL.md` 존재·프론트매터 `name:` 일치를 assert.
- `uninstall-skills.test.ts`: 먼저 install → 디렉터리 존재 확인 → uninstall → 디렉터리 부재 확인. 동시에 접두 없는 더미 스킬 디렉터리를 만들어 두고 uninstall 후에도 남아 있는지 확인.

**문서 갱신 포인트**
- `README.md` / `README.ko.md`: Quick Start 코드블록(`harness run ...`) 을 `phase-harness run ...` 로 치환. "Install standalone skills" 섹션 신설.
- `docs/HOW-IT-WORKS.md` / `.ko.md`: CLI 예시 치환.
- `CLAUDE.md`: "풀 프로세스 호출" 섹션의 `harness run` 샘플 치환. Install-skills 사용 예 추가.

## Open Questions

- `--project-dir` 플래그가 과한 스코프일 수 있음. MVP에서는 `--user` 와 `--project` 두 모드만으로 충분한지 구현 중 재판단한다. 테스트 편의를 위해서는 `--project-dir` 이 있는 편이 가장 단순 → 포함하기로 잠정 결정.
- 레거시 `~/.claude/skills/codex-gate-review/` 자동 제거 기능(`install-skills --cleanup-legacy` 같은 플래그)을 제공할지 여부. MVP 에서는 경고만, 자동 삭제는 보류. 필요 시 후속 이슈.

## Implementation Plan

- [ ] **Task 1 — 스킬 벤더링**: `src/context/skills-standalone/codex-gate-review/{SKILL.md, gate-prompts.md}` 생성. `SKILL.md` 프론트매터 `name:` 을 `phase-harness-codex-gate-review` 로 변경, 본문 invocation 예시를 새 이름으로 갱신. `scripts/copy-assets.mjs` 에 `skills-standalone` 복사 규칙 추가.
- [ ] **Task 2 — CLI 이름 변경**: `package.json` `bin` 맵 `{"phase-harness": "./dist/bin/harness.js"}` 로 수정. `bin/harness.ts` 의 `.name('harness')` → `.name('phase-harness')`. 로그/에러 메시지 중 사용자 노출 `harness` 키워드가 있는지 grep 하여 자연스러운 표현으로 치환(내부 경로/세션명은 그대로 유지 OK).
- [ ] **Task 3 — install-skills 커맨드**: `src/commands/install-skills.ts` 작성(`--user`/`--project`/`--project-dir`). 소스 루트는 `import.meta.url` 기반으로 `dist/src/context/skills-standalone` 우선, 없으면 `src/context/skills-standalone` fallback. 각 하위 스킬 디렉터리를 `<target>/phase-harness-<dirname>/` 로 overwrite 복사. 레거시 `codex-gate-review/` 감지 시 stderr 경고. `bin/harness.ts` 에 서브커맨드 등록.
- [ ] **Task 4 — uninstall-skills 커맨드**: `src/commands/uninstall-skills.ts` 작성. 타겟 루트에서 `phase-harness-*` 접두 디렉터리만 `rmSync` 로 제거. 접두 없는 디렉터리는 보존. `bin/harness.ts` 등록.
- [ ] **Task 5 — 테스트**: `tests/install-skills.test.ts`, `tests/uninstall-skills.test.ts` 작성(`--project-dir` 로 tmp 디렉터리 스코프 테스트). 설치 후 SKILL.md 프론트매터 내용·파일 존재 assert, uninstall 후 접두 없는 스킬 보존 assert.
- [ ] **Task 6 — 문서 갱신**: `README.md`, `README.ko.md`, `docs/HOW-IT-WORKS.md`, `docs/HOW-IT-WORKS.ko.md`, `CLAUDE.md` 의 `harness <cmd>` 용례를 `phase-harness <cmd>` 로 일관 치환. 각 README 에 "Install standalone skills" 섹션(한국어는 "독립 스킬 설치") 추가. 신규 커맨드 설명 포함.
- [ ] **Task 7 — 레거시 정리 & 빌드 검증**: 개발 머신에서 stale `~/.claude/skills/codex-gate-review/` 수동 제거(`rm -rf`). `pnpm tsc --noEmit`, `pnpm vitest run`, `pnpm build` 통과 확인. `node dist/bin/harness.js --help` 실행 결과가 `phase-harness` 로 표시되는지 확인.

## Eval Checklist Summary

세부 검증은 `.harness/2026-04-19-untitled/checklist.json` 참조. 포함 항목:
- `typecheck` — `pnpm tsc --noEmit`
- `test` — `pnpm vitest run`
- `build` — `pnpm build`
- `cli-name` — 빌드 산출물의 `--help` 출력에 `phase-harness` 가 포함되고 `Usage: harness` 는 포함되지 않는지 확인
- `install-skills-help` — `install-skills --help` 서브커맨드가 존재하는지 확인
