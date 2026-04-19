# CLAUDE.md — harness-cli

이 repo 전용 지침. 전역 규칙(`~/.claude/CLAUDE.md`)과 함께 적용된다.

## 프로젝트 한 줄

`harness-cli`는 AI 에이전트 개발 라이프사이클을 7단계 파이프라인(spec → gate → plan → gate → impl → verify → eval gate)으로 강제하는 CLI. Claude Code가 구현자, Codex가 독립 리뷰어. `--light` flag로 4-phase 경량 모드(P1 → P5 → P6 → P7)도 설계 + 구현 플랜 완료(PR #10/#17), **구현 대기**.

## 먼저 읽을 것

순서대로 훑으면 30~60초 내 맥락 복구 가능.

1. `docs/HOW-IT-WORKS.md` (or `.ko.md`) — 전체 아키텍처 (outer/inner 세션, tmux, state.json, sentinel, phase 러너)
2. `docs/specs/2026-04-12-harness-cli-design.md` — 원 설계 rationale (ADR)
3. `docs/specs/2026-04-14-tmux-rearchitecture-design.md` — 현 tmux 아키텍처 ADR
4. `docs/specs/2026-04-14-claude-harness-skill-design.md` — `/harness` 슬래시 커맨드 플러그인 설계
5. **최근 shipped 설계** (main에 merged):
   - `docs/specs/2026-04-18-gate-prompt-hardening-design.md` + `docs/plans/2026-04-18-gate-prompt-hardening.md` (PR #11) — BUG-A/B/C 수정 + phase-start preset 로깅
   - `docs/specs/2026-04-18-harness-skills-synthesis-{INTENT,design}.md` + `docs/plans/2026-04-18-harness-skills-synthesis.md` (PR #12 + #15) — **T1–T7 전부 완료**. PR #15가 assembler inline(T4) + thin `phase-{1,3,5}.md` binding(T5) + E2E/docs(T7) 마감.
   - `docs/specs/2026-04-18-claude-token-capture-design.md` (PR #16) — interactive phase_end에 `claudeTokens` 필드 추가. 5 라운드 gate 리뷰를 거친 설계 + 구현.
6. **In-flight 설계** (구현 대기):
   - `docs/specs/2026-04-18-light-flow-design.md` + `docs/plans/2026-04-18-light-flow.md` (PR #10 spec + PR #17 plan) — `harness start --light` 경량 4-phase 플로우. 플랜은 gate 6라운드 후 Codex APPROVE 상태, 구현 세션 대기. 원 `untitled-design.md` 파일명은 PR #17에서 의미있는 이름으로 rename 완료.

## 코드 탐색 entry points

| 경로 | 역할 |
|---|---|
| `src/commands/` | CLI 서브커맨드 (`run`, `resume`, `jump`, `skip`, `inner`, `start`) |
| `src/phases/` | 라이프사이클 페이즈 구현 (interactive, gate, runner dispatcher, verdict) |
| `src/runners/` | Claude/Codex runner (`claude.ts` interactive+gate with `--session-id` pinning per PR #16; `codex.ts` gate+resume; `claude-usage.ts` PR #16 — Claude session JSONL 파싱 + `ClaudeTokens` 집계). |
| `src/context/assembler.ts` | 페이즈별 프롬프트 조립. **주요 상수**: `REVIEWER_CONTRACT_BASE` + `FIVE_AXIS_{SPEC,PLAN,EVAL}_GATE` + `REVIEWER_CONTRACT_BY_GATE[2\|4\|7]`. **주요 함수**: `buildLifecycleContext(phase)` — Gate 2/4/7에 주입되는 `<harness_lifecycle>` stanza (PR #11, BUG-A fix). `assembleInteractivePrompt`는 PR #15부터 wrapper skill body를 `{{wrapper_skill}}` 플레이스홀더로 inline 렌더링 (frontmatter strip, `playbookDir` 런타임 계산). |
| `src/context/prompts/phase-{1,3,5}.md` | Phase 1/3/5 **thin-binding 템플릿** (PR #15 이후). `{{wrapper_skill}}` + 런타임 컨텍스트 vars만 포함하고, `HARNESS FLOW CONSTRAINT`(PR #11 BUG-B fix — `advisor()` 중간 호출 금지)는 wrapper skill의 Invariants 섹션으로 migrate됨. |
| `src/context/skills/` | Phase 1/3/5 wrapper 스킬 (`harness-phase-{1,3,5}-*.md`). PR #15로 assembler inline 경로가 완성되어 **실 런타임에 반영됨**. BUG-B invariant + Phase 1 Open Questions 의무화가 여기에서 적용된다. |
| `src/context/playbooks/` | Vendored agent-skills playbooks (T1 at pinned SHA `9534f44c`): `context-engineering.md`, `git-workflow-and-versioning.md`, MIT `LICENSE`, `VENDOR.md` (sync 절차). |
| `src/phases/runner.ts` | Phase 러너 dispatcher. PR #16부터 Claude interactive 페이즈 4개 실자 `phase_end` 발행 지점(completed / artifact-commit 실패 / normal failed / catch-throw)에 `claudeTokens` 부착. redirected-by-signal 브랜치는 의도적으로 생략. |
| `src/state.ts`, `src/types.ts` | `state.json` 스키마 + migration + `GateSessionInfo` lineage. `types.ts`에 `ClaudeTokens` + `phase_end.claudeTokens?` 옵셔널 필드(PR #16). |
| `src/ui.ts` | 컨트롤 패널 UI. PR #14로 `separator()` 함수가 `max(16, min(64, stdout.columns − 2))`로 터미널 폭에 적응 (이전 이슈 #10 해소). |
| `src/signal.ts` | SIGUSR1 control-plane handler (online jump/skip) |
| `src/input.ts` | InputManager — pre-emptive key buffer (1s TTL pendingKey) |
| `scripts/harness-verify.sh` | Phase 6 결정론 평가 (checklist.json 소비) |
| `scripts/copy-assets.mjs` | dist 빌드 시 `src/context/{prompts,skills,playbooks}` + `scripts/harness-verify.sh` 복사 |

## 검증 커맨드 (eval checklist에 넣을 때 그대로)

```bash
pnpm tsc --noEmit   # typecheck (= pnpm lint; package.json에서 alias)
pnpm vitest run     # 전체 테스트 스위트 (현재 baseline: 514 passed / 1 skipped — PR #15/#16 이후)
pnpm build          # tsc + scripts/copy-assets.mjs (dist 생성)
```

`lint`가 `tsc --noEmit`의 alias이므로 별도 ESLint 없음 — checklist에 둘 다 넣지 말 것.

## 이벤트 로깅 스키마 (events.jsonl)

`--enable-logging`으로 활성화되는 세션 이벤트. 주요 필드 (PR #11 이후):

| 이벤트 | 핵심 필드 |
|---|---|
| `session_start` | `task`, `autoMode`, `baseCommit`, `harnessVersion` |
| `phase_start` | `phase`, `attemptId`, **`preset: { id, runner, model, effort }`** (PR #11 — phase 6 제외) |
| `phase_end` | `phase`, `attemptId`, `status`, `durationMs`, **`claudeTokens?: { input, output, cacheRead, cacheCreate, total } \| null`** (PR #16 — interactive 1/3/5 + `preset.runner === 'claude'` 실자 페이즈만; codex/redirect-by-signal 분기는 필드 자체 생략) |
| `gate_verdict` | `phase`, `retryIndex`, `runner`, `verdict`, `durationMs`, `tokensTotal`, `promptBytes`, `codexSessionId`, `resumedFrom`, `resumeFallback`, `preset` |
| `gate_retry` | `phase`, `retryIndex`, `retryCount`, `retryLimit`, `feedbackPath`, `feedbackBytes`, `feedbackPreview` |
| `gate_error` | `preset` (PR #11) |

`claudeTokens` 3-state 계약: 성공 시 객체, 추출 실패 시 `null` + 단일 stderr warn (best-effort, 런 실패시키지 않음), 시도 자체가 해당 없으면 필드 부재.

Session meta: `~/.harness/sessions/<hash>/<runId>/{events.jsonl, meta.json, summary.json}`.

## 커밋·PR 관례

- **브랜치**: 기능 단위 worktree 분리 (`git worktree add`). 이름은 `next-N` 또는 feature명.
- **커밋 메시지**: `fix(<scope>): <imperative>` / `feat(<scope>): <subject>` / `docs(<type>): <subject>`.
- **Co-authored-by 트레일러 금지** (전역 규칙).
- **PR**: squash merge 기본. 관련 PR 번호는 본문에 참조.
- **`.gitignore` 경로(`.harness/`, `node_modules/`, `dist/`, `.idea/`)는 `git add -f` 금지**.

## 실행 모드 defaults

- **Logging 기본 on**: `harness run` / `/harness` 실행 시 **항상 `--enable-logging` 포함**. (전역 메모리 규칙)
- **Gate escalation**: P1만 처리하고 P2는 plan 내 TODO로 기록 후 다음 phase 진입. (전역 메모리 규칙)
- **Autonomous mode**: 사용자가 "에스컬레이션 없이 진행" 지시 시 활성. 단일 안건에 대해 Codex 최대 3회 거절, 4회째 강제 통과.

## 현재 open issues

### 레거시 (전 세션 이월)

| # | 요지 | 상태 |
|---|---|---|
| 1 | Gate reject 루프 비수렴 | **부분 완화 shipped**: light flow는 Phase 7 REJECT 시 `Scope: impl` 이면 Phase 5 reopen, `design|mixed|missing` 이면 Phase 1 reopen, retry limit 5를 사용한다(full은 3 유지). post-ship 측정은 events.jsonl 확장 대신 `.harness/<runId>/gate-7-raw.txt` verdict-raw artifact 샘플링으로 false fast-path를 확인한다. rollback threshold는 아직 문서화되지 않았고 후속 dogfood에서 결정한다. |
| 5 | Phase 3 interactive 폭주 (37분 runaway 이력) | 원인 미파악. 재현 실험 선행 후 soft-timeout 설계. |

### 2026-04-18 dog-fooding에서 확인된 신규 이슈 (`~/Desktop/projects/harness/experimental-todo/observations.md` 참조)

| # | 요지 | 심각도 | 상태 |
|---|---|---|---|
| 8 | Phase 1 default preset 과중 — 간단한 CLI 한 번에 5.4M 토큰 (2026-04-18 dogfood-full 재측정) | P1 | **부분 해결**: (1) PR #22로 legacy `opus-max`(effort=xHigh) id를 `opus-xhigh`로 rename하고, 2026-04-19 PR로 `opus-max`(effort=max)·`sonnet-max`(effort=max) 두 preset을 카탈로그에 **신규 등록** — Opus 4.7의 3-tier(high/xHigh/max) + Sonnet 4.6의 2-tier(high/max) 축을 모두 노출. (2) PHASE_DEFAULTS[1]·LIGHT_PHASE_DEFAULTS[1]은 `opus-high`로 완화된 상태 유지 — max/xHigh는 `promptModelConfig`에서 수동 선택. `--heavy` CLI flag / 자동 난이도 힌트는 별도 follow-up (FOLLOWUPS.md P1.4). |
| 9 | `printAdvisorReminder` orphan text (control-pane tip이 Claude로 전달 안 됨) | P2 UX | PR #11 `HARNESS FLOW CONSTRAINT`가 `advisor()` 금지로 실질 무효화. **제거 PR 진행 중** (`fix/remove-advisor-reminder`, Group C). |
| 13 | Codex `HOME` 격리 미도입 — BUG-C alternative fix | P3 | PR #11 `REVIEWER_CONTRACT` scope-rules로 일단 해결. **영구 격리 PR 진행 중** (`feat/codex-home-isolation`, Group D). |

## Worktree 관례

- 위치: `~/.grove/github.com/DongGukMon/harness-cli/worktrees/<feature>`
- **문서 전용 PR**과 **코드 수정 PR**은 워크트리 분리 (서로 다른 브랜치)
- 새 worktree 생성 시 `pnpm install` 별도 필요 (symlink 복제 안 됨). `pnpm build`도 최초 1회 필요 (integration 테스트가 dist 참조).
- 머지 후 정리: `git worktree remove <path> && git branch -D <name>`
- **실험 중에는 `pnpm link --global` 금지** — 글로벌 `harness` 바이너리가 Desktop dist(실험용)를 가리키므로 worktree의 빌드 산출물이 실험을 오염시킴.

## 풀 프로세스 호출

> ⚠️ **`/harness` 슬래시 커맨드는 절대 호출 금지.** 전역 `~/.claude/skills/harness/`는 2026-04-19 삭제됨. 호출 시도 시 skill not found. **`harness-cli` CLI 자체는 dogfood로 계속 사용한다** — `/harness` 스킬만 제거되고 CLI는 정규 워크플로의 일부다.

개발 라이프사이클은 `harness-cli` 자체를 dogfood로 실행한다:

```bash
pnpm build                                    # 현 브랜치 변경분을 dist에 반영 (필수)
harness run --enable-logging "<task>"         # 7-phase 풀 플로우
# 또는 경량:
harness start --light "<task>"                # 4-phase 경량 (P1 → P5 → P6 → P7)
```

빌드 없이는 dist가 갱신되지 않으므로 소스 수정 직후엔 **항상 `pnpm build`** — 그 뒤 CLI 실행 결과가 실제 변경분을 반영한다. 내부 phase 순서·gate 규약·자율 모드 정책(Codex 3 reject → 4회째 강제 통과)은 전역 규칙 `harness-lifecycle` 섹션 참조.

경량 플로우 설계 상세는 `docs/HOW-IT-WORKS.md`의 "Light Flow" 섹션 + `docs/specs/2026-04-18-light-flow-design.md` 참조.
