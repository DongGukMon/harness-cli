# harness Skill 외부 배포 — Design Spec

- Date: 2026-04-14
- Status: Draft (Rev 7 — gate-2 feedback 반영)
- Scope: `~/.claude/skills/`에 있는 harness 스킬을 공유 가능한 Claude Code 플러그인으로 패키징
- Related decisions: [decisions.md](../../.harness/2026-04-14-claude-harness-skill/decisions.md)

---

## Context & Decisions

### Why this work

harness 생태계는 현재 세 곳에 분산되어 있다:

1. **`~/.claude/skills/`** — `harness`, `codex-gate-review` 스킬 (로컬 전용, 공유 불가)
2. **`~/.claude/scripts/`** — `harness-verify.sh`, `harness-session-hook.sh` (로컬 전용)
3. **`harness-cli` npm 패키지** — CLI 오케스트레이터 (배포 가능하지만 스킬 미포함)

사용자의 글로벌 `~/.claude/CLAUDE.md`에 `harness-lifecycle` 규칙, `~/.claude/settings.json`에 SessionStart 훅이 수동 설정되어 있다.

외부 공유가 불가능한 구조다. 새 사용자가 harness를 쓰려면 스킬 파일 복사, 스크립트 배치, CLAUDE.md 편집, settings.json 훅 추가를 수작업으로 해야 한다.

**해법:** Claude Code 플러그인으로 패키징. `/plugin install` 한 줄로 스킬 + 스크립트 + 행동 규칙이 설치된다.

### Gate-2 Feedback Resolution Matrix

아래 표는 gate-2 리뷰에서 지적된 모든 항목과 본 스펙에서의 해소 위치를 명시한다.

| # | Severity | Issue | Resolution | Spec Section |
|---|----------|-------|------------|--------------|
| F1 | P1 | `harness init`이 `enabledPlugins`에 미설치 플러그인 등록 → 설치 순서 충돌 | ADR-4: `harness init`은 `extraKnownMarketplaces` + 훅만 설정. `enabledPlugins`는 Claude Code `/plugin install`이 fetch 성공 후 자동 관리. | [harness init](#harness-init), [Install Flow](#install-flow-사용자-관점) |
| F2 | P1 | `codex-gate-review`가 로컬 캐시 절대 경로 하드코딩 | ADR-6: 새 CLI 명령어 `harness gate-exec`가 런타임에 경로 해석. 스킬에서 절대 경로 완전 제거. | [harness gate-exec](#harness-gate-exec), [codex-gate-review 변경](#skillscodex-gate-reviewskillmd) |
| F3 | P1 | CLI↔플러그인 버전 불일치 시 호환성 계약 부재 | ADR-7: `plugin.json`에 `minCliVersion` 선언. 스킬이 CLI 명령어 호출 전 `harness --version`으로 검증. 미달 시 차단 메시지. | [Version Compatibility Contract](#version-compatibility-contract) |
| F4 | P2 | `harness session-hook` 출력 계약 모호 | stdout JSON 스키마, exit code 규약, stderr 규칙, 비정상 상황 동작, 예시 payload 명시. | [harness session-hook](#harness-session-hook) |

### Key Decisions (요약)

> 전체 Decision Log: [decisions.md](../../.harness/2026-04-14-claude-harness-skill/decisions.md)

| ID | 결정 | Gate-2 피드백 | 해소 방법 |
|----|------|--------------|-----------|
| ADR-1 | 단일 GitHub 레포를 npm 패키지 + Claude Code 플러그인으로 동시 운영 | — | — |
| ADR-2 | 플러그인 CLAUDE.md에 harness-lifecycle 규칙 포함 | — | — |
| ADR-3 | 스크립트 경로 해석은 CLI 런타임 수행 (`resolveVerifyScriptPath()`) | — | — |
| ADR-4 | `harness init`은 marketplace + 훅만 설정. `enabledPlugins` 미관여 | F1 (P1) | `enabledPlugins`를 CLI가 조작하지 않음. Claude Code가 fetch 성공 후 자동 추가. |
| ADR-5 | 스킬 내 스크립트 참조를 CLI 명령어로 대체 | — | — |
| ADR-6 | Codex 실행 경로를 CLI 명령어로 래핑 (`harness gate-exec`) | F2 (P1) | 캐시 경로 하드코딩 완전 제거 |
| ADR-7 | `minCliVersion` 선언 + 스킬 시작 시 CLI 버전 검증 | F3 (P1) | 호환성 계약 + 업데이트 순서 + semver 범위 명시 |
| ADR-8 | 의존성은 문서화된 사전 요구사항으로 처리 | — | — |

---

## Repository Structure (변경 후)

```
harness-cli/
├── .claude-plugin/
│   ├── plugin.json          ← 플러그인 메타데이터 (minCliVersion 포함, ADR-7)
│   └── marketplace.json     ← 마켓플레이스 정보
├── skills/
│   ├── harness/
│   │   └── SKILL.md         ← ~/.claude/skills/harness/SKILL.md 이전
│   └── codex-gate-review/
│       ├── SKILL.md         ← 절대 경로 제거됨 (ADR-6, F2 해소)
│       └── gate-prompts.md  ← 변경 없음
├── scripts/
│   ├── harness-verify.sh    ← 기존 위치 유지 (이미 npm files에 포함)
│   └── harness-session-hook.sh  ← ~/.claude/scripts/에서 이전
├── bin/
│   └── harness.ts           ← init, verify, session-hook, gate-exec 명령어 추가
├── src/
│   ├── commands/
│   │   ├── init.ts          ← 새 파일 (ADR-4: marketplace + 훅만 설정)
│   │   ├── verify-cmd.ts    ← 새 파일: harness verify 래퍼
│   │   ├── session-hook.ts  ← 새 파일: harness session-hook 래퍼 (F4 해소)
│   │   ├── gate-exec.ts     ← 새 파일: harness gate-exec 래퍼 (ADR-6)
│   │   └── ... (기존 명령어)
│   └── ... (기존 소스)
├── CLAUDE.md                ← 새 파일: 플러그인 레벨 harness-lifecycle 규칙 (ADR-2)
├── package.json             ← files 필드 업데이트, version bump
└── README.md                ← 설치 가이드 업데이트
```

---

## Plugin Metadata

### `.claude-plugin/plugin.json`

```json
{
  "name": "harness",
  "description": "AI agent harness — 7-phase brainstorm/spec/plan/implement/verify lifecycle with Codex gate reviews",
  "version": "0.1.0",
  "minCliVersion": "0.2.0",
  "author": {
    "name": "DongGukMon"
  },
  "homepage": "https://github.com/<org>/harness-cli",
  "repository": "https://github.com/<org>/harness-cli",
  "license": "MIT",
  "keywords": ["harness", "lifecycle", "codex", "gate-review", "agent"]
}
```

`minCliVersion` 필드 (ADR-7, F3 해소): 이 플러그인이 정상 동작하기 위해 필요한 최소 harness-cli 버전. 스킬 시작 시 `harness --version`과 비교하여 미달 시 차단 메시지 출력.

### `.claude-plugin/marketplace.json`

```json
{
  "name": "harness",
  "description": "AI agent harness lifecycle orchestrator",
  "owner": {
    "name": "DongGukMon"
  },
  "plugins": [
    {
      "name": "harness",
      "description": "7-phase AI development lifecycle with Codex gate reviews",
      "version": "0.1.0",
      "source": "./"
    }
  ]
}
```

---

## Plugin CLAUDE.md

플러그인 루트의 `CLAUDE.md`에 현재 `~/.claude/CLAUDE.md`의 `harness-lifecycle` 섹션을 이전한다 (ADR-2).

내용:
- Phase 순서 (1~7)
- 실행 모드 (기본/자율)
- 산출물 교차 참조 규칙
- 프로젝트 문서 구조 권장

이 파일은 플러그인 활성화 시 자동으로 Claude Code 컨텍스트에 로드된다.

---

## New CLI Commands

### `harness init`

> **F1 해소 (P1):** 이 명령어는 `enabledPlugins`를 조작하지 않는다 (ADR-4). `enabledPlugins` 등록은 Claude Code `/plugin install`이 플러그인 fetch 성공 후 자동 수행한다.

```
harness init [--dry-run]
```

실행 내용:
1. **의존성 진단**: `tmux`, `jq`, `node`, `claude`, codex 플러그인, superpowers 플러그인 상태 확인. 누락 항목은 설치 안내와 함께 출력.
2. **settings.json 패치** (`~/.claude/settings.json`):
   - `extraKnownMarketplaces`에 harness 마켓플레이스 등록
   - `hooks.SessionStart`에 `harness session-hook` 훅 등록
   - **`enabledPlugins`는 조작하지 않는다** — 이 필드는 Claude Code의 `/plugin install`이 fetch/install 성공 후 자동 관리한다.
3. **결과 출력**: 적용된 변경 사항 + 다음 단계 안내 ("`/plugin install harness@harness`를 Claude Code 세션에서 실행하세요")

`--dry-run`: 실제 변경 없이 적용될 내용만 출력.

멱등성 보장: 이미 설정된 항목은 건너뜀.

**재시작 필요 여부:** `extraKnownMarketplaces` 변경은 Claude Code 재시작 없이 반영된다 (다음 `/plugin install` 시 참조). `hooks.SessionStart` 변경은 다음 세션 시작 시 적용된다. 현재 실행 중인 세션에는 영향 없음.

### `harness verify`

```
harness verify <checklist.json> <output-report.md>
```

내부적으로 `resolveVerifyScriptPath()` (ADR-3)로 스크립트를 찾아 `exec`한다.
기존 Phase 6 로직의 스크립트 호출부와 동일한 경로 해석.

Exit code: 스크립트의 exit code를 그대로 전파 (0 = 전체 pass, 1 = 하나 이상 fail).

### `harness session-hook`

> **F4 해소 (P2):** stdout JSON 스키마, exit code, stderr 규칙, 비정상 상황 동작을 아래에 명시한다.

```
harness session-hook
```

SessionStart 훅에서 호출되는 명령어.

**stdout JSON schema:**

```json
{
  "type": "info",
  "message": "[Harness] 하네스 라이프사이클이 사용 가능합니다. 풀 프로세스가 필요하면 /harness 스킬을 사용하세요.",
  "version": "0.2.0"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `type` | `string` | Y | 메시지 유형. 유효값: `"info"`. 향후 `"warning"` 등 확장 가능. |
| `message` | `string` | Y | Claude Code 컨텍스트에 주입되는 안내 메시지. |
| `version` | `string` | Y | 현재 설치된 harness-cli 버전 (semver). |

**Exit code 규약:**

| Exit code | 의미 | 훅 소비자 동작 |
|-----------|------|---------------|
| `0` | 성공 | stdout JSON을 Claude Code 컨텍스트에 주입 |
| Non-zero | 실패 | Silent skip — 세션은 정상 진행, harness 안내 메시지 미표시 |

**stderr 규칙:** stderr는 진단 전용 (디버그 로그, 에러 상세). Claude Code는 stderr를 파싱하지 않는다.

**비정상 상황 동작:**

| 상황 | 동작 |
|------|------|
| harness-cli 미설치 | 훅 명령어 자체 실패 (command not found, exit != 0) → silent skip |
| CLI 설치됨, 내부 오류 | exit != 0 → silent skip |
| stdout이 유효 JSON 아님 | 훅 소비자가 파싱 실패 → silent skip (Claude Code의 기본 훅 에러 처리) |

**예시 payload (정상):**
```json
{"type":"info","message":"[Harness] 하네스 라이프사이클이 사용 가능합니다. 풀 프로세스가 필요하면 /harness 스킬을 사용하세요.","version":"0.2.0"}
```

### `harness gate-exec`

> **F2 해소 (P1):** 이 명령어로 인해 `codex-gate-review/SKILL.md`에서 캐시 절대 경로 참조가 완전히 제거된다 (ADR-6).

```
harness gate-exec "<prompt>"
```

Codex companion을 통해 gate review를 실행하는 래퍼.

실행 내용:
1. `resolveCodexPath()` (`src/preflight.ts`)로 최신 codex-companion.mjs 경로를 런타임 탐색
2. 경로 미발견 → 에러 메시지 + exit code 1: `"Codex companion not found. Install codex plugin: /plugin install codex@openai-codex"`
3. 경로 발견 → `node <resolved-path> task --effort high "<prompt>"` exec

스킬은 `harness gate-exec "<prompt>"`만 호출하며, 경로 해석 로직을 전혀 알 필요 없다.

### `harness --version`

```
harness --version
```

package.json의 `version` 필드를 stdout에 출력. 스킬의 CLI 버전 검증에 사용 (ADR-7).

---

## Version Compatibility Contract

> **F3 해소 (P1):** CLI와 플러그인이 독립 배포 단위이므로, 아래 계약으로 버전 불일치를 감지하고 차단한다 (ADR-7).

### 메커니즘

```
[Plugin: plugin.json]                    [CLI: package.json]
  minCliVersion: "0.2.0"    ←compare→     version: "0.2.0"
```

### 검증 시점

스킬이 CLI 명령어 (`harness verify`, `harness gate-exec` 등)를 호출하기 직전.

### 검증 절차

1. `harness --version` 실행 → 현재 CLI 버전 획득
2. `plugin.json`의 `minCliVersion`과 semver 비교
3. CLI 버전 < minCliVersion → 차단 메시지:
   ```
   harness-cli version X.Y.Z is too old for this plugin (requires >= A.B.C).
   Run: npm update -g harness-cli
   ```
4. CLI 미설치 (exit code != 0) → 설치 안내:
   ```
   harness-cli not found.
   Run: npm install -g harness-cli
   ```

### 업데이트 순서

반드시 아래 순서를 따른다:

1. **CLI 먼저:** `npm update -g harness-cli`
2. **플러그인 나중:** `/plugin update harness@harness` (Claude Code 세션 내)

이 순서를 따르면 새 플러그인이 새 CLI 명령어를 호출할 때 항상 사용 가능하다.

### 호환 범위 (semver)

| 변경 유형 | CLI 동작 | 플러그인 영향 |
|-----------|----------|-------------|
| patch (0.2.x → 0.2.y) | 버그 수정만. 기존 명령어/옵션 변경 없음 | 영향 없음 |
| minor (0.x → 0.y) | 새 명령어/옵션 추가. 기존 제거 불가 | 새 명령어 사용 시 `minCliVersion` bump |
| major (x → y) | breaking change 가능 | `minCliVersion` bump 필수 |

---

## Skill Content Changes

### `skills/harness/SKILL.md`

스크립트 참조 변경 (ADR-5):

| 현재 (로컬) | 변경 (플러그인) |
|-------------|----------------|
| `~/.claude/scripts/harness-verify.sh <checklist> <output>` | `harness verify <checklist> <output>` |

CLI 버전 검증 추가 (ADR-7): 스킬 실행 시작 시 `harness --version`으로 호환성 확인 안내 포함.

그 외 스킬 로직 변경 없음. Phase 1~7 오케스트레이션 규칙 유지.

### `skills/codex-gate-review/SKILL.md`

> **F2 해소 (P1):** 절대 경로 완전 제거, CLI 명령어로 대체 (ADR-6).

Codex 실행 경로 참조 변경:

| 현재 (로컬) | 변경 (플러그인) |
|-------------|----------------|
| `node ~/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs task --effort high "<prompt>"` | `harness gate-exec "<prompt>"` |

스킬 내부에 캐시 경로가 전혀 남지 않는다. 경로 해석은 전적으로 CLI `resolveCodexPath()` 함수가 런타임에 수행한다.

CLI 버전 검증 추가 (ADR-7): `harness gate-exec` 호출 전 `harness --version`으로 호환성 확인.

### `skills/codex-gate-review/gate-prompts.md`

변경 없음. 프롬프트 템플릿 구조와 내용 유지.

---

## Install Flow (사용자 관점)

### 신규 설치

> **F1 해소 (P1):** step 2(`harness init`)는 marketplace + 훅만 등록. step 3(`/plugin install`)에서 Claude Code가 fetch 성공 후 `enabledPlugins`를 자동 추가. 순서 충돌 없음.

```bash
# Step 1. CLI 설치 (npm 글로벌)
npm install -g harness-cli

# Step 2. 초기 설정 — marketplace 등록 + SessionStart 훅 등록 + 의존성 진단
#   enabledPlugins는 건드리지 않는다 (ADR-4)
harness init

# Step 3. Claude Code 세션에서 플러그인 설치
#   Claude Code가 fetch 성공 후 enabledPlugins에 자동 등록
/plugin install harness@harness

# Step 4. 의존성 플러그인 설치 (아직 없는 경우)
/plugin install codex@openai-codex
/plugin install superpowers@claude-plugins-official
```

**Step 2→3 순서가 필요한 이유:** `harness init`이 `extraKnownMarketplaces`를 등록해야 `/plugin install`에서 harness 플러그인을 찾을 수 있다.

**재시작 필요 여부:** Step 2 후 Claude Code 재시작 불필요. `extraKnownMarketplaces`는 다음 `/plugin install` 실행 시 참조된다. `hooks.SessionStart`는 다음 세션 시작 시 적용.

### 기존 사용자 마이그레이션

```bash
# 1. CLI 업데이트 (CLI 먼저 — 버전 호환 계약 준수, ADR-7)
npm update -g harness-cli

# 2. settings.json 갱신 (marketplace 등록 + 훅 교체)
harness init

# 3. 플러그인 설치 (Claude Code 세션 내)
/plugin install harness@harness

# 4. 로컬 스킬 파일 제거 (플러그인이 대체)
rm -rf ~/.claude/skills/harness ~/.claude/skills/codex-gate-review

# 5. 글로벌 CLAUDE.md에서 harness-lifecycle 섹션 제거
#    (플러그인 CLAUDE.md가 대체, ADR-2. 수동 편집)

# 6. 레거시 스크립트 제거 (선택)
#    CLI가 resolveVerifyScriptPath()에서 레거시 폴백으로 계속 참조하므로 남겨도 무방
```

---

## File-level Change List

### Create

| File | Purpose |
|------|---------|
| `.claude-plugin/plugin.json` | 플러그인 메타데이터 (`minCliVersion` 포함, ADR-7) |
| `.claude-plugin/marketplace.json` | 마켓플레이스 정보 |
| `skills/harness/SKILL.md` | harness 오케스트레이터 스킬 |
| `skills/codex-gate-review/SKILL.md` | gate review 스킬 (절대 경로 제거, `harness gate-exec` 사용, ADR-6) |
| `skills/codex-gate-review/gate-prompts.md` | gate prompt 템플릿 (변경 없음) |
| `CLAUDE.md` | 플러그인 레벨 harness-lifecycle 규칙 (ADR-2) |
| `src/commands/init.ts` | `harness init` 명령어 (ADR-4: enabledPlugins 미관여) |
| `src/commands/verify-cmd.ts` | `harness verify` 래퍼 명령어 |
| `src/commands/session-hook.ts` | `harness session-hook` 래퍼 명령어 (F4: 출력 계약 구현) |
| `src/commands/gate-exec.ts` | `harness gate-exec` 래퍼 명령어 (ADR-6) |

### Modify

| File | Change |
|------|--------|
| `bin/harness.ts` | `init`, `verify`, `session-hook`, `gate-exec` 명령어 등록 |
| `package.json` | `"files"` 필드에 `.claude-plugin/`, `skills/`, `scripts/harness-session-hook.sh` 추가. `version` bump |

### Delete

없음.

### External (사용자 수동)

| File | Change |
|------|--------|
| `~/.claude/skills/harness/` | 플러그인 설치 후 제거 (선택) |
| `~/.claude/skills/codex-gate-review/` | 플러그인 설치 후 제거 (선택) |
| `~/.claude/CLAUDE.md` | `harness-lifecycle` 섹션 제거 (선택, ADR-2) |

---

## Risks

| ID | Risk | Mitigation |
|----|------|------------|
| R1 | 패키지 로컬과 레거시 스크립트 중복 존재 | `resolveVerifyScriptPath()`가 패키지 로컬 우선 → 레거시 폴백 순으로 탐색 (ADR-3). 중복은 동작에 영향 없음 |
| R2 | CLI↔플러그인 버전 불일치 | ADR-7: `minCliVersion` 계약 + 스킬 시작 시 `harness --version` 검증 + 문서화된 업데이트 순서 (CLI 먼저 → 플러그인 나중). 불일치 시 차단 메시지 출력. |
| R3 | 로컬 스킬과 플러그인 스킬 동시 활성화 | 마이그레이션 가이드에 로컬 스킬 제거 단계 포함. Claude Code가 동명 스킬을 플러그인 우선으로 로드하는지 구현 시 테스트 |
| R4 | Codex 플러그인 캐시 구조 변경 | `resolveCodexPath()`가 디렉토리 순회 기반 동적 탐색 수행 (ADR-6). glob 의존 없음 |
