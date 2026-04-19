---
related:
  - .harness/2026-04-19-untitled-2/task.md
  - .harness/2026-04-19-untitled-2/decisions.md
  - .harness/2026-04-19-untitled-2/checklist.json
---

# Rename to `phase-harness` + npm publish prep — Design Spec (Light)

## Complexity

Medium — 패키지 이름 변경 + npm 배포 산출물(publishConfig, LICENSE, prepublish hook) 정비 + 사용자 대면 문자열(README 2종, skill frontmatter 3종) 동기화. 파일 수는 많지 않으나 여러 카테고리를 조화롭게 바꿔야 하므로 Small은 아니다.

## Context & Decisions

### 현재 상태
- `package.json`: `name=harness-cli`, `version=0.1.0`, `bin={ harness: ./dist/bin/harness.js }`, `files=[dist, scripts/harness-verify.sh, README.md, README.ko.md]`, MIT, `engines.node>=18`.
- `LICENSE` 파일 없음 (MIT 선언만 있음).
- `.npmignore`/`.npmrc` 없음 — `files` 화이트리스트로 배포 대상 제어 중.
- `prepublishOnly`/`repository`/`homepage`/`bugs` 필드 없음.
- `src/context/skills/harness-phase-{1,3,5}-*.md` frontmatter/본문에 `harness-cli Phase N` 문구 존재 (assembler가 런타임에 렌더 → Claude에게 노출됨).
- `README.md` / `README.ko.md` 제목/본문/설치 섹션이 `harness-cli`를 전제로 작성됨 (`pnpm link --global` 위주).
- `tests/context/skills-rendering.test.ts:64` — `description: Use during harness-cli Phase 1` 문구가 **렌더 결과에 남지 않음**을 assert (음수 조건). skill description을 rename해도 이 assertion은 여전히 참이어야 한다.
- `tests/runners/claude-usage.test.ts`의 경로 리터럴(`/Users/daniel/.grove/github.com/DongGukMon/harness-cli`)은 `encodeProjectDir` 인코딩 로직 검증용 → 패키지 이름과 무관, 변경 불필요.

### 핵심 결정

1. **패키지 이름**: `harness-cli` → `phase-harness` (unscoped). 스코프(`@owner/phase-harness`) 사용 여부는 사용자가 명시하지 않았으므로 unscoped 기본값.
2. **바이너리 이름 유지**: `bin.harness` 그대로. 이미 문서·스킬·tmux 세션명(`harness-<runId>`, `harness-ctrl`)·state 키까지 `harness` 토큰에 의존. 바이너리명을 바꾸면 사용자·운영자 학습 비용 증가 + 내부 문자열 수백 곳 연쇄 수정 필요. 패키지 식별자(`phase-harness`)와 명령어(`harness`)는 독립적이라는 것이 npm 표준 관례(예: `typescript` → `tsc`).
3. **LICENSE 파일 추가**: MIT 원문을 `LICENSE`로 작성 → npm registry가 자동 인식. `files`에 포함시키지 않아도 npm이 LICENSE/README를 자동 포함하나, 명시적으로 `files`에 `"LICENSE"` 추가하여 의도 명확화.
4. **prepublishOnly 훅**: `pnpm build`가 dist + 자산 복제를 수행하므로 `"prepublishOnly": "pnpm run build"` 추가 → `npm publish` 전 빌드 산출물 최신성 보장.
5. **publishConfig.access=public**: 향후 scoped name으로 바꾸더라도 안전; 현재 unscoped 이름에는 no-op이나 명시 권장.
6. **repository/homepage/bugs**: 현재 GitHub 경로(`github.com/DongGukMon/harness-cli`)를 참조. 리포 rename은 **사용자 요청 범위 밖**이므로 URL은 현 상태 유지(rename 후 GitHub 자동 리다이렉트).
7. **skill 문자열 rename**: `harness-cli Phase N` → `phase-harness Phase N`. Frontmatter `description`은 실 런타임에서 strip되므로 기능 영향 없음 (`skills-rendering.test.ts:64` 계약 유지). 본문에서 노출되는 인라인 언급도 함께 통일.
8. **README 2종 업데이트**: 제목/설명/설치 섹션. npm install 경로(`npm install -g phase-harness` / `pnpm add -g phase-harness`) 추가. `pnpm link --global`은 로컬 개발 섹션으로 유지. 7단계 → 5단계 light flow 등 기존 사실은 보존 (task에 명시된 "README 최신화"는 이름 변경 반영).
9. **테스트 조정**: `skills-rendering.test.ts:64` — 음수 assertion이므로 rename 후에도 참(description 문자열 자체가 렌더 결과에서 빠지므로). 단, 새 문자열 `phase-harness Phase 1`이 **본문에** 남는지 여부를 별도로 테스트하는 케이스가 없으므로 assertion 수정 불필요. 실제로 그리기만 검증.
10. **CLAUDE.md / docs/specs**: 이 결합 문서 및 향후 작업 문서는 갱신 대상. 하지만 `docs/specs/2026-04-12-harness-cli-design.md` 등 **역사 ADR**은 파일명에 날짜 + 구명칭을 포함하므로 변경하지 않는다 (ADR 불변성 관례). 본문 내용은 읽기만 할 뿐 기능에 영향 없음.
11. **pnpm-lock.yaml**: 의존성 변경 없음 → `pnpm install` 실행시 lockfile의 `name: harness-cli` 부분이 재생성될 수 있음. 빌드 중 패키지명 변경 후 한 번 `pnpm install` 실행하여 lockfile 동기화.

### 범위 밖
- GitHub 리포 rename
- 바이너리 이름 변경
- 버전 범프 (현재 `0.1.0` 유지 — 첫 publish 후 사용자 결정)
- `npm publish` 실제 실행 (토큰/권한 필요, 본 phase는 준비만)
- 오래된 design doc/plan doc 내 `harness-cli` 단어 전수 치환 (ADR 불변성)

## Requirements / Scope

**필수 산출물**
1. `package.json`이 `phase-harness`로 publish 가능 (npm pack dry-run 성공, 필수 필드 존재).
2. `LICENSE` 파일 존재 + MIT 원문.
3. `README.md` / `README.ko.md` 첫 단락·설치 섹션이 새 이름 반영.
4. 사용자 대면 skill 문자열(`src/context/skills/*.md`)이 새 이름 반영.
5. `pnpm tsc --noEmit` / `pnpm vitest run` / `pnpm build` 모두 grün.

**비-목표**
- 바이너리 command 이름 변경
- 기능적 동작(phase flow, runner 선택, state 스키마) 변경
- 역사 문서(`docs/specs/*-design.md`, `docs/plans/*.md`) 내 구명칭 전수 치환

## Design

### 1. `package.json` 변환

Before → After 핵심 diff:

```jsonc
{
  "name": "phase-harness",                       // 변경
  "version": "0.1.0",                            // 유지
  "description": "AI agent harness orchestrator — multi-phase brainstorm/spec/plan/implement/verify lifecycle with gate reviews",
  "type": "module",
  "bin": { "harness": "./dist/bin/harness.js" }, // 바이너리명 유지
  "files": ["dist", "scripts/harness-verify.sh", "README.md", "README.ko.md", "LICENSE"], // LICENSE 추가
  "repository": {
    "type": "git",
    "url": "git+https://github.com/DongGukMon/harness-cli.git"
  },
  "homepage": "https://github.com/DongGukMon/harness-cli#readme",
  "bugs": { "url": "https://github.com/DongGukMon/harness-cli/issues" },
  "publishConfig": { "access": "public" },
  "scripts": {
    "build": "tsc && node scripts/copy-assets.mjs",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit",
    "prepublishOnly": "pnpm run build"           // 추가
  },
  // keywords, license, engines, devDependencies, dependencies 유지
}
```

### 2. `LICENSE` 파일

표준 MIT 라이선스 (저작권: `2026 Daniel Mon`). `files` 배열에 명시.

### 3. skill 문자열 rename

- `src/context/skills/harness-phase-1-spec.md`
  - `description: Use during harness-cli Phase 1 to ...` → `description: Use during phase-harness Phase 1 to ...`
  - `당신은 harness-cli 파이프라인의 Phase 1에 있다` → `당신은 phase-harness 파이프라인의 Phase 1에 있다`
- `src/context/skills/harness-phase-3-plan.md`
  - `description: Use during harness-cli Phase 3 ...` → `description: Use during phase-harness Phase 3 ...`
- `src/context/skills/harness-phase-5-implement.md`
  - `description: Use during harness-cli Phase 5 ...` → `description: Use during phase-harness Phase 5 ...`
  - `harness-cli 설치 디렉터리(dist 또는 src)` → `phase-harness 설치 디렉터리(dist 또는 src)`

파일명은 `harness-phase-*`로 유지 (assembler가 실제 파일명 토큰을 사용; 이름 변경 시 assembler 수정 필요). **파일 rename 없음.**

### 4. README 업데이트 (2종 동시)

- 제목: `# harness-cli` → `# phase-harness`
- 첫 문단: 이름 반영
- 설치 섹션에 npm install 경로 추가:
  ```bash
  # global install (end users)
  npm install -g phase-harness
  # or
  pnpm add -g phase-harness
  ```
- 기존 `git clone` 로컬 개발 블록은 유지 (디렉터리명만 `phase-harness`로, repo URL은 유지). `pnpm unlink --global harness-cli` → `pnpm unlink --global phase-harness`.

### 5. 테스트/빌드 검증 전략

- `pnpm install` 한 번 실행하여 lockfile 동기화 (의도적 커밋 대상).
- `pnpm tsc --noEmit`으로 타입 회귀 확인 (skill MD 변경은 타입에 영향 없음).
- `pnpm vitest run`으로 전체 스위트 실행.
- `pnpm build`로 dist + 자산 복제 확인 (copy-assets가 새 skill 문자열을 그대로 복제).
- `npm pack --dry-run`으로 tarball 구조 점검 (checklist에 포함).

## Open Questions

- **npm scope 여부**: 사용자가 unscoped `phase-harness`를 원하는지, 개인/조직 scope(예: `@danielmon/phase-harness`)를 원하는지 미확인. 현 설계는 unscoped 가정. 실 publish 직전 사용자 확인 필요.
- **GitHub 리포 rename 타이밍**: `package.json.repository`가 현재 `DongGukMon/harness-cli`를 가리킨다. 리포 자체 rename은 본 작업 범위 밖이므로 URL은 현 상태. 리포 rename 시 GitHub redirect가 자동 유효하나, 사용자가 리포도 rename하기를 원하는 경우 후속 작업으로 분리.
- **버전 정책**: 현 `0.1.0` 유지 (pre-1.0). 초기 publish 후 SemVer 정책은 사용자 결정.

## Implementation Plan

- **Task 1 — package.json 재구성**: `name`, `repository`, `homepage`, `bugs`, `publishConfig`, `prepublishOnly`, `files`(+LICENSE) 추가/변경.
- **Task 2 — LICENSE 파일 생성**: MIT 표준 원문 + 저작권 연도/이름.
- **Task 3 — skill 문자열 rename**: `src/context/skills/harness-phase-{1,3,5}-*.md` 본문/frontmatter의 `harness-cli` → `phase-harness` (파일 rename 없음).
- **Task 4 — README.md + README.ko.md 업데이트**: 제목·첫 문단·설치 섹션(npm install 경로 추가)·unlink 명령 동기화.
- **Task 5 — 의존성/빌드 동기화**: `pnpm install` 실행하여 `pnpm-lock.yaml`을 새 이름으로 갱신, `pnpm build`로 dist 재생성.
- **Task 6 — 검증**: `pnpm tsc --noEmit` / `pnpm vitest run` / `pnpm build` / `npm pack --dry-run` 모두 성공 확인. skills-rendering 테스트의 음수 assertion이 여전히 참인지 재확인.

## Eval Checklist Summary

실제 검증 JSON은 `.harness/2026-04-19-untitled-2/checklist.json` 참조. 요약:

1. **typecheck** — `pnpm tsc --noEmit`
2. **vitest** — `pnpm vitest run`
3. **build** — `pnpm build`
4. **package name** — `node -e` 로 `package.json.name === 'phase-harness'` 단언
5. **npm pack dry-run** — `npm pack --dry-run`가 0-exit로 완료하고 tarball에 `LICENSE` 포함
6. **LICENSE exists** — `test -f LICENSE`
