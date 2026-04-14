# harness Skill 외부 배포 — Design Spec

- Date: 2026-04-14
- Status: Draft
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

### Decisions

**[ADR-1] 단일 GitHub 레포를 npm 패키지 + Claude Code 플러그인으로 동시 운영한다 (모노레포).**
- 스킬은 CLI 명령어를 참조하고, CLI는 스킬이 정의한 프로세스를 실행한다. 양쪽이 밀결합.
- 별도 레포로 분리하면 버전 싱크 문제 발생 (스킬 v2가 CLI v1의 존재하지 않는 명령어 참조).
- npm publish 시 `"files"` 필드로 dist/scripts만 포함 — 플러그인 메타데이터는 npm tarball에 불포함.
- 플러그인 install 시 GitHub 전체 레포가 캐시됨 — skills/, scripts/, CLAUDE.md 모두 포함.
- 선례: superpowers 플러그인도 단일 레포에 skills + docs + CLAUDE.md + agents를 모두 포함.

**[ADR-2] 플러그인 CLAUDE.md에 harness-lifecycle 규칙을 포함한다.**
- Claude Code는 활성 플러그인의 루트 CLAUDE.md를 자동 로드한다.
- 현재 사용자 글로벌 `~/.claude/CLAUDE.md`에 수동 삽입된 `harness-lifecycle` 섹션을 플러그인 CLAUDE.md로 이전.
- 사용자가 글로벌 CLAUDE.md를 편집할 필요 없음.
- 선례: superpowers 플러그인의 `CLAUDE.md` (컨트리뷰터 가이드라인 + 행동 규칙 포함).

**[ADR-3] 스크립트 경로 해석은 CLI가 런타임에 수행한다. 심볼릭 링크나 고정 경로 불필요.**
- `resolveVerifyScriptPath()`가 이미 패키지 로컬 → `~/.claude/scripts/` 순서로 탐색 (구현 완료).
- npm 글로벌 설치 시 `<npm-root>/harness-cli/scripts/harness-verify.sh`에 스크립트 존재 → 패키지 로컬 경로로 발견.
- 플러그인 캐시 경로에서도 스크립트 존재하지만, CLI가 직접 호출하므로 플러그인 경로를 알 필요 없음.
- `~/.claude/scripts/` 폴백은 하위호환용으로 유지 (기존 사용자 마이그레이션 경로).

**[ADR-4] `harness init` 명령어로 settings.json 설정을 자동화한다.**
- 신규 사용자가 수행해야 할 settings.json 변경:
  - SessionStart 훅 등록 (`harness session-hook` CLI 명령어 호출)
  - marketplace 등록 (플러그인 소스 GitHub 레포 지정)
- `harness init`가 이 설정을 자동으로 패치한다.
- 멱등성 보장: 이미 설정된 항목은 건너뜀.
- `--dry-run` 옵션으로 변경 사항 미리보기 지원.

**[ADR-5] 스킬 내 스크립트 참조를 CLI 명령어로 대체한다.**
- 현재: `~/.claude/scripts/harness-verify.sh <checklist> <output>` (경로 하드코딩)
- 변경: `harness verify <checklist> <output>` (CLI 래핑)
- CLI가 내부적으로 `resolveVerifyScriptPath()`로 올바른 스크립트를 찾아 실행.
- 스킬 텍스트에 절대 경로가 사라지므로 환경 의존성 제거.
- `harness session-hook` 명령어도 추가하여 SessionStart 훅에서 사용.

**[ADR-6] 의존성은 문서화된 사전 요구사항으로 처리한다. 설치 시 하드 체크하지 않음.**
- `codex@openai-codex` 플러그인: gate review에 필요. README에 설치 안내.
- `superpowers@claude-plugins-official` 플러그인: brainstorming, writing-plans 등 참조. README에 설치 안내.
- 시스템 도구: `tmux`, `jq`, `node ≥ 18`. 기존 `runPreflight()`가 런타임에 체크.
- `harness init`가 의존성 상태를 진단하고 누락 항목을 안내한다 (설치는 하지 않음).

---

## Repository Structure (변경 후)

```
harness-cli/
├── .claude-plugin/
│   ├── plugin.json          ← 플러그인 메타데이터
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
├── src/
│   ├── bin/harness.ts       ← init, verify, session-hook 명령어 추가
│   ├── commands/
│   │   ├── init.ts          ← 새 파일: settings.json 자동 설정
│   │   ├── verify-cmd.ts    ← 새 파일: harness verify 래퍼
│   │   ├── session-hook.ts  ← 새 파일: harness session-hook 래퍼
│   │   └── ... (기존 명령어)
│   └── ... (기존 소스)
├── CLAUDE.md                ← 새 파일: 플러그인 레벨 harness-lifecycle 규칙
├── package.json             ← files 필드 업데이트
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
  "author": {
    "name": "DongGukMon"
  },
  "homepage": "https://github.com/<org>/harness-cli",
  "repository": "https://github.com/<org>/harness-cli",
  "license": "MIT",
  "keywords": ["harness", "lifecycle", "codex", "gate-review", "agent"]
}
```

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
1. **의존성 진단**: `tmux`, `jq`, `node`, `claude`, codex 플러그인, superpowers 플러그인 상태 확인
2. **settings.json 패치**:
   - `extraKnownMarketplaces`에 harness 마켓플레이스 등록
   - `enabledPlugins`에 `harness@harness` 추가
   - `hooks.SessionStart`에 `harness session-hook` 훅 등록
3. **결과 출력**: 적용된 변경 사항 + 누락 의존성 안내

`--dry-run`: 실제 변경 없이 적용될 내용만 출력.

settings.json 읽기/쓰기는 기존 Claude Code 설정 파일 형식(`~/.claude/settings.json`)을 따른다.

### `harness verify`

```
harness verify <checklist.json> <output-report.md>
```

내부적으로 `resolveVerifyScriptPath()`로 스크립트를 찾아 `exec`한다.
기존 Phase 6 로직의 스크립트 호출부와 동일한 경로 해석.

### `harness session-hook`

```
harness session-hook
```

SessionStart 훅에서 호출되는 명령어. JSON 형식의 안내 메시지를 stdout으로 출력.
기존 `harness-session-hook.sh`의 역할을 CLI 명령어로 래핑.

---

## Skill Content Changes

### `skills/harness/SKILL.md`

스크립트 참조 변경:

| 현재 | 변경 |
|------|------|
| `~/.claude/scripts/harness-verify.sh` | `harness verify` |

그 외 스킬 로직은 변경 없음. Phase 1~7 오케스트레이션 규칙 유지.

### `skills/codex-gate-review/SKILL.md`

Codex 실행 경로 참조 변경:

| 현재 | 변경 |
|------|------|
| `node ~/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs` | 변경 없음 — Codex 경로는 codex 플러그인의 설치 위치에 의존하며, 이 glob 패턴이 버전 무관하게 동작 |

기타 변경 없음.

### `skills/codex-gate-review/gate-prompts.md`

변경 없음.

---

## Install Flow (사용자 관점)

### 신규 설치

```bash
# 1. CLI 설치 (npm)
npm install -g harness-cli

# 2. 초기 설정 (settings.json 패치 + 의존성 진단)
harness init

# 3. Claude Code에서 플러그인 활성화 (Claude Code 세션 내)
/plugin install harness@harness

# 4. 의존성 플러그인 설치 (아직 없는 경우)
/plugin install codex@openai-codex
/plugin install superpowers@claude-plugins-official
```

### 기존 사용자 마이그레이션

```bash
# 1. CLI 업데이트
npm update -g harness-cli

# 2. 로컬 스킬 파일 제거 (플러그인이 대체)
rm -rf ~/.claude/skills/harness ~/.claude/skills/codex-gate-review

# 3. 글로벌 CLAUDE.md에서 harness-lifecycle 섹션 제거 (플러그인 CLAUDE.md가 대체)

# 4. settings.json 훅 업데이트
harness init

# 5. 플러그인 설치
# (Claude Code 세션 내) /plugin install harness@harness
```

---

## File-level Change List

### Create

| File | Purpose |
|------|---------|
| `.claude-plugin/plugin.json` | 플러그인 메타데이터 |
| `.claude-plugin/marketplace.json` | 마켓플레이스 정보 |
| `skills/harness/SKILL.md` | harness 오케스트레이터 스킬 |
| `skills/codex-gate-review/SKILL.md` | gate review 스킬 |
| `skills/codex-gate-review/gate-prompts.md` | gate prompt 템플릿 |
| `CLAUDE.md` | 플러그인 레벨 harness-lifecycle 규칙 |
| `src/commands/init.ts` | `harness init` 명령어 |
| `src/commands/verify-cmd.ts` | `harness verify` 래퍼 명령어 |
| `src/commands/session-hook.ts` | `harness session-hook` 래퍼 명령어 |

### Modify

| File | Change |
|------|--------|
| `src/bin/harness.ts` | `init`, `verify`, `session-hook` 명령어 등록 |
| `package.json` | `"files"` 필드에 `scripts/harness-session-hook.sh` 추가 |
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

## Success Criteria

1. `harness init`으로 settings.json이 올바르게 패치됨 (멱등성 확인)
2. `/plugin install harness@harness`로 스킬이 Claude Code에 등록되어 `/harness`, `/codex-gate-review` 호출 가능
3. 플러그인 CLAUDE.md가 자동 로드되어 harness-lifecycle 규칙 적용
4. `harness verify <checklist> <output>`이 기존 `harness-verify.sh`와 동일하게 동작
5. `harness session-hook`이 SessionStart 훅에서 정상 출력
6. npm publish 시 `.claude-plugin/`, `skills/`가 tarball에 포함되지 않음
7. 기존 `~/.claude/scripts/harness-verify.sh` 폴백 경로가 계속 동작 (하위호환)
8. `pnpm test` 통과, `pnpm run lint` 클린

---

## Risks

**R1: 플러그인 CLAUDE.md 로딩 동작이 변경될 수 있음.**
- Claude Code 플러그인 시스템은 아직 성숙 단계. 로딩 규칙이 변경되면 harness-lifecycle 규칙이 누락될 수 있음.
- 완화: `harness init --check`로 규칙 로딩 여부를 검증하는 진단 추가 가능.

**R2: npm 글로벌 설치와 플러그인 캐시의 버전 불일치.**
- npm에서 CLI v0.2.0을 설치했지만 플러그인 캐시에 v0.1.0 스킬이 남아있으면 불일치.
- 완화: 스킬은 CLI 명령어를 참조하므로 CLI가 하위호환을 유지하면 안전. 스킬 자체의 로직 변경은 플러그인 업데이트로 반영.

**R3: settings.json 수동 편집으로 인한 JSON 파싱 실패.**
- `harness init`가 settings.json을 읽고 쓸 때, 사용자가 수동 편집한 trailing comma 등으로 파싱 실패 가능.
- 완화: JSON5/jsonc 파서 대신 표준 JSON.parse 사용 + 파싱 실패 시 명확한 에러 메시지.

**R4: 마켓플레이스 GitHub 레포가 private일 경우 플러그인 install 실패.**
- 완화: 레포를 public으로 유지. private 필요 시 사용자가 GitHub 인증을 설정해야 함.

---

## Out of Scope

- 스킬 내용 변경 (오케스트레이션 로직, gate 프로토콜 등) — 이번 작업은 패키징만
- Linux/Windows 지원 — 기존 macOS 전용 제약 유지
- 자동 업데이트 메커니즘 — 사용자가 수동으로 npm update + plugin update
- CI/CD 파이프라인 — npm publish, GitHub release 자동화는 별도 태스크
- 스킬 테스트 프레임워크 — 스킬 동작 검증은 수동 smoke 테스트
