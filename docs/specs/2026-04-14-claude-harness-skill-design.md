# harness Skill 외부 배포 — Design Spec

- Date: 2026-04-14
- Status: Draft (Rev 4 — gate-2 feedback 반영)
- Scope: `~/.claude/skills/`에 있는 harness 스킬을 공유 가능한 Claude Code 플러그인으로 패키징
- Related decisions: [decisions.md](../../.harness/2026-04-14-claude-harness-skill/decisions.md)

---

## Context & Decisions

### Why this work

harness 생태계는 현재 세 곳에 분산되어 있다:

1. **`~/.claude/skills/`** — `harness`, `codex-gate-review` 스킬 (로컬 전용, 공유 불가)
2. **`~/.claude/scripts/`** — `harness-verify.sh`, `harness-session-hook.sh` (로컬 전용)
3. **`harness-cli` npm 패키지** — CLI 오케스트레이터 (배포 가능하지만 스킬 미포함)

그리고 사용자의 글로벌 `~/.claude/CLAUDE.md`에 `harness-lifecycle` 규칙이, `~/.claude/settings.json`에 SessionStart 훅이 수동으로 설정되어 있다.

이 구조는 단일 사용자 환경에서는 동작하지만, 외부 공유가 불가능하다. 새 사용자가 harness를 사용하려면 스킬 파일 수동 복사, 스크립트 배치, CLAUDE.md 편집, settings.json 훅 추가를 모두 수작업으로 해야 한다.

Claude Code 플러그인 시스템이 이 문제의 표준 해법이다. 플러그인으로 패키징하면 `/plugin install` 한 줄로 스킬 + 스크립트 + 행동 규칙이 모두 설치된다.

### Key Decisions (요약)

> 전체 Decision Log: [decisions.md](../../.harness/2026-04-14-claude-harness-skill/decisions.md)

| ID | 결정 | Gate-2 피드백 반영 |
|----|------|-------------------|
| ADR-1 | 단일 GitHub 레포를 npm 패키지 + Claude Code 플러그인으로 동시 운영 (모노레포) | — |
| ADR-2 | 플러그인 CLAUDE.md에 harness-lifecycle 규칙 포함 | — |
| ADR-3 | 스크립트 경로 해석은 CLI 런타임 수행 (`resolveVerifyScriptPath()`) | — |
| ADR-4 | `harness init`은 marketplace 등록 + 훅만 설정. `enabledPlugins` 미관여 | **P1**: 설치 순서 충돌 해소 |
| ADR-5 | 스킬 내 스크립트 참조를 CLI 명령어로 대체 | — |
| ADR-6 | Codex 실행 경로도 CLI 명령어로 래핑 (`harness gate-exec`) | **P1**: 캐시 경로 하드코딩 제거 |
| ADR-7 | `minCliVersion` 선언 + 스킬 시작 시 CLI 버전 검증 | **P1**: 버전 불일치 호환성 계약 |
| ADR-8 | 의존성은 문서화된 사전 요구사항으로 처리 | — |

---

## Repository Structure (변경 후)

```
harness-cli/
├── .claude-plugin/
│   ├── plugin.json          ← 플러그인 메타데이터 (minCliVersion 포함)
│   └── marketplace.json     ← 마켓플레이스 정보
├── skills/
│   ├── harness/
│   │   └── SKILL.md         ← ~/.claude/skills/harness/SKILL.md 이전
│   └── codex-gate-review/
│       ├── SKILL.md         ← ~/.claude/skills/codex-gate-review/SKILL.md 이전
│       └── gate-prompts.md  ← ~/.claude/skills/codex-gate-review/gate-prompts.md 이전
├── scripts/
│   ├── harness-verify.sh    ← 기존 위치 유지 (이미 npm files에 포함)
│   └── harness-session-hook.sh  ← ~/.claude/scripts/에서 이전
├── bin/
│   └── harness.ts           ← init, verify, session-hook, gate-exec 명령어 추가
├── src/
│   ├── commands/
│   │   ├── init.ts          ← 새 파일: settings.json 자동 설정
│   │   ├── verify-cmd.ts    ← 새 파일: harness verify 래퍼
│   │   ├── session-hook.ts  ← 새 파일: harness session-hook 래퍼
│   │   ├── gate-exec.ts     ← 새 파일: harness gate-exec 래퍼
│   │   └── ... (기존 명령어)
│   └── ... (기존 소스)
├── CLAUDE.md                ← 새 파일: 플러그인 레벨 harness-lifecycle 규칙
├── package.json             ← files 필드 업데이트, version 업데이트
├── README.md                ← 설치 가이드 업데이트
└── README.ko.md             ← 설치 가이드 업데이트
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

`minCliVersion` 필드는 이 플러그인이 정상 동작하기 위해 필요한 최소 harness-cli 버전을 명시한다. 스킬 시작 시 `harness --version` 출력과 비교하여 미달 시 차단 메시지를 출력한다.

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

플러그인 루트의 `CLAUDE.md`에 현재 `~/.claude/CLAUDE.md`의 `harness-lifecycle` 섹션을 이전한다.

내용:
- Phase 순서 (1~7)
- 실행 모드 (기본/자율)
- 산출물 교차 참조 규칙
- 프로젝트 문서 구조 권장

이 파일은 플러그인 활성화 시 자동으로 Claude Code 컨텍스트에 로드된다.

---

## New CLI Commands

### `harness init`

```
harness init [--dry-run]
```

실행 내용:
1. **의존성 진단**: `tmux`, `jq`, `node`, `claude`, codex 플러그인, superpowers 플러그인 상태 확인. 누락 항목은 설치 안내와 함께 출력.
2. **settings.json 패치** (`~/.claude/settings.json`):
   - `extraKnownMarketplaces`에 harness 마켓플레이스 등록
   - `hooks.SessionStart`에 `harness session-hook` 훅 등록
   - **`enabledPlugins`는 조작하지 않는다** — Claude Code `/plugin install`이 담당
3. **결과 출력**: 적용된 변경 사항 + 다음 단계 안내 ("`/plugin install harness@harness`를 Claude Code 세션에서 실행하세요")

`--dry-run`: 실제 변경 없이 적용될 내용만 출력.

멱등성 보장: 이미 설정된 항목은 건너뜀.

**재시작 필요 여부:** `extraKnownMarketplaces` 변경은 Claude Code 재시작 없이 반영된다 (다음 `/plugin install` 시 참조). `hooks.SessionStart` 변경은 다음 세션 시작 시 적용된다. 현재 실행 중인 세션에는 영향 없음.

### `harness verify`

```
harness verify <checklist.json> <output-report.md>
```

내부적으로 `resolveVerifyScriptPath()`로 스크립트를 찾아 `exec`한다.
기존 Phase 6 로직의 스크립트 호출부와 동일한 경로 해석.

Exit code: 스크립트의 exit code를 그대로 전파 (0 = 전체 pass, 1 = 하나 이상 fail).

### `harness session-hook`

```
harness session-hook
```

SessionStart 훅에서 호출되는 명령어.

**출력 계약 (gate-2 P2 피드백 반영):**

stdout JSON schema:
```json
{
  "type": "info",
  "message": "[Harness] 하네스 라이프사이클이 사용 가능합니다. 풀 프로세스가 필요하면 /harness 스킬을 사용하세요.",
  "version": "0.2.0"
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `type` | `"info"` | 메시지 유형. 현재는 `"info"`만 사용. 향후 `"warning"` 등 확장 가능. |
| `message` | `string` | Claude Code 컨텍스트에 주입되는 안내 메시지. |
| `version` | `string` | 현재 설치된 harness-cli 버전 (semver). |

Exit code 규약:
- `0`: 성공. stdout의 JSON을 Claude Code가 컨텍스트로 주입한다.
- Non-zero: 훅 실패. Claude Code는 세션을 계속 진행하되 harness 안내 메시지를 표시하지 않는다. 훅 소비자는 non-zero를 silent skip으로 처리해야 한다.

stderr 사용 규칙:
- stderr는 진단 목적으로만 사용한다 (디버그 로그, 에러 상세). Claude Code는 stderr를 파싱하지 않는다.

비정상 상황 동작:
- harness-cli가 설치되지 않은 경우 → 훅 명령어 자체가 실패 (exit code != 0) → Claude Code가 silent skip
- settings.json 훅 등록이 있으나 CLI가 제거된 경우 → 동일하게 silent skip

예시 payload (정상):
```json
{"type":"info","message":"[Harness] 하네스 라이프사이클이 사용 가능합니다. 풀 프로세스가 필요하면 /harness 스킬을 사용하세요.","version":"0.2.0"}
```

### `harness gate-exec`

```
harness gate-exec "<prompt>"
```

Codex companion을 통해 gate review를 실행하는 래퍼 명령어.

실행 내용:
1. `resolveCodexPath()`(`preflight.ts`)로 최신 codex-companion.mjs 경로를 탐색
2. 경로를 찾지 못하면 에러 메시지와 함께 exit code 1 반환: `"Codex companion not found. Install codex plugin: /plugin install codex@openai-codex"`
3. 경로 발견 시 `node <resolved-path> task --effort high "<prompt>"`를 exec

이 명령어로 인해 `codex-gate-review/SKILL.md`에서 절대 경로 참조가 완전히 제거된다.

### `harness --version`

```
harness --version
```

package.json의 `version` 필드를 stdout에 출력한다. 스킬의 CLI 버전 검증에 사용된다.

---

## Version Compatibility Contract

### 메커니즘

```
[Plugin: plugin.json]                    [CLI: package.json]
  minCliVersion: "0.2.0"    ←compare→     version: "0.2.0"
```

검증 시점: 스킬이 CLI 명령어(`harness verify`, `harness gate-exec` 등)를 호출하기 직전.

검증 절차:
1. `harness --version` 실행 → 현재 CLI 버전 획득
2. `plugin.json`의 `minCliVersion`과 semver 비교
3. CLI 버전 < minCliVersion → 차단 메시지 출력:
   ```
   harness-cli version X.Y.Z is too old for this plugin (requires >= A.B.C).
   Run: npm update -g harness-cli
   ```
4. CLI를 찾을 수 없음 (exit code != 0) → 설치 안내 출력:
   ```
   harness-cli not found.
   Run: npm install -g harness-cli
   ```

### 업데이트 순서

1. CLI 먼저: `npm update -g harness-cli`
2. 플러그인 나중: `/plugin update harness@harness` (Claude Code 세션 내)

이 순서를 따르면 새 플러그인이 새 CLI 명령어를 호출할 때 항상 사용 가능하다.

### 호환 범위

CLI는 semver 규약을 따른다:
- **patch** (0.2.x → 0.2.y): 버그 수정만. 기존 명령어/옵션 변경 없음.
- **minor** (0.x → 0.y): 새 명령어/옵션 추가 가능. 기존 명령어/옵션 제거 불가.
- **major** (x → y): breaking change 가능. `minCliVersion` bump 필수.

---

## Skill Content Changes

### `skills/harness/SKILL.md`

스크립트 참조 변경:

| 현재 | 변경 |
|------|------|
| `~/.claude/scripts/harness-verify.sh <checklist> <output>` | `harness verify <checklist> <output>` |

CLI 버전 검증 추가: 스킬 실행 시작 시점에 `harness --version`으로 호환성을 확인하는 안내 문구를 포함한다.

그 외 스킬 로직은 변경 없음. Phase 1~7 오케스트레이션 규칙 유지.

### `skills/codex-gate-review/SKILL.md`

Codex 실행 경로 참조 변경:

| 현재 | 변경 |
|------|------|
| `node ~/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs task --effort high "<prompt>"` | `harness gate-exec "<prompt>"` |

절대 경로가 완전히 제거되고, CLI의 `resolveCodexPath()` 런타임 해석으로 대체된다.

CLI 버전 검증 추가: `harness gate-exec` 호출 전 `harness --version`으로 호환성을 확인한다.

### `skills/codex-gate-review/gate-prompts.md`

변경 없음. 프롬프트 템플릿 구조와 내용 유지.

---

## Install Flow (사용자 관점)

### 신규 설치

```bash
# 1. CLI 설치 (npm 글로벌)
npm install -g harness-cli

# 2. 초기 설정 (marketplace 등록 + SessionStart 훅 등록 + 의존성 진단)
harness init

# 3. Claude Code 세션에서 플러그인 설치
#    (Claude Code가 enabledPlugins를 자동 관리)
/plugin install harness@harness

# 4. 의존성 플러그인 설치 (아직 없는 경우)
/plugin install codex@openai-codex
/plugin install superpowers@claude-plugins-official
```

**단계 2와 3의 순서가 중요하다:** `harness init`은 마켓플레이스만 등록한다. 마켓플레이스가 등록되어야 `/plugin install`에서 harness 플러그인을 찾을 수 있다. `enabledPlugins`는 step 3에서 Claude Code가 플러그인 fetch 성공 후 자동으로 추가한다.

### 기존 사용자 마이그레이션

```bash
# 1. CLI 업데이트
npm update -g harness-cli

# 2. settings.json 훅 업데이트 (마켓플레이스 등록 + 훅 교체)
harness init

# 3. 플러그인 설치 (Claude Code 세션 내)
/plugin install harness@harness

# 4. 로컬 스킬 파일 제거 (플러그인이 대체)
rm -rf ~/.claude/skills/harness ~/.claude/skills/codex-gate-review

# 5. 글로벌 CLAUDE.md에서 harness-lifecycle 섹션 제거 (플러그인 CLAUDE.md가 대체)
# (수동 편집)

# 6. 레거시 스크립트 제거 (선택 — CLI가 폴백으로 계속 참조하므로 남겨도 무방)
# rm ~/.claude/scripts/harness-session-hook.sh
```

---

## File-level Change List

### Create

| File | Purpose |
|------|---------|
| `.claude-plugin/plugin.json` | 플러그인 메타데이터 (`minCliVersion` 포함) |
| `.claude-plugin/marketplace.json` | 마켓플레이스 정보 |
| `skills/harness/SKILL.md` | harness 오케스트레이터 스킬 |
| `skills/codex-gate-review/SKILL.md` | gate review 스킬 (절대 경로 제거, `harness gate-exec` 사용) |
| `skills/codex-gate-review/gate-prompts.md` | gate prompt 템플릿 |
| `CLAUDE.md` | 플러그인 레벨 harness-lifecycle 규칙 |
| `src/commands/init.ts` | `harness init` 명령어 |
| `src/commands/verify-cmd.ts` | `harness verify` 래퍼 명령어 |
| `src/commands/session-hook.ts` | `harness session-hook` 래퍼 명령어 |
| `src/commands/gate-exec.ts` | `harness gate-exec` 래퍼 명령어 |

### Modify

| File | Change |
|------|--------|
| `bin/harness.ts` | `init`, `verify`, `session-hook`, `gate-exec` 명령어 등록 |
| `package.json` | `"files"` 필드에 `scripts/harness-session-hook.sh`, `.claude-plugin/`, `skills/` 추가. `version` bump |
| `README.md` | 설치 가이드에 플러그인 설치 단계 추가 |
| `README.ko.md` | 동일 |

### Delete

없음. 기존 파일 삭제 없음.

### External (사용자 수동)

| File | Change |
|------|--------|
| `~/.claude/skills/harness/` | 플러그인 설치 후 제거 (선택) |
| `~/.claude/skills/codex-gate-review/` | 플러그인 설치 후 제거 (선택) |
| `~/.claude/CLAUDE.md` | `harness-lifecycle` 섹션 제거 (선택) |

---

## Risks

| ID | Risk | Mitigation |
|----|------|------------|
| R1 | 플러그인 캐시와 npm 글로벌의 스크립트가 중복 존재 | `resolveVerifyScriptPath()`가 패키지 로컬 우선 → 레거시 폴백 순으로 탐색. 중복은 동작에 영향 없음 |
| R2 | CLI와 플러그인 버전 불일치 | ADR-7: `minCliVersion` 계약 + 스킬 시작 시 버전 검증 + 문서화된 업데이트 순서 |
| R3 | 기존 사용자가 로컬 스킬과 플러그인 스킬을 동시에 활성화 | 마이그레이션 가이드에 로컬 스킬 제거 단계 포함. Claude Code가 동명 스킬을 플러그인 우선으로 로드하는지 확인 필요 (구현 시 테스트) |
| R4 | Codex 플러그인 캐시 구조 변경 시 `resolveCodexPath()` 실패 | `resolveCodexPath()`가 이미 동적 탐색 수행. glob 대신 디렉토리 순회이므로 구조 변경에 상대적으로 강건 |
