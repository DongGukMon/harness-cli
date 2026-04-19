# CLAUDE.md — harness-cli

이 repo 전용 지침. 전역 규칙(`~/.claude/CLAUDE.md`)과 함께 적용된다.

## 프로젝트 한 줄

`harness-cli`는 AI 에이전트 개발 라이프사이클을 7단계 파이프라인(spec → gate → plan → gate → impl → verify → eval gate) 또는 `--light` 4단계 파이프라인(P1 → P5 → P6 → P7)으로 실행하는 CLI. runner/model은 phase preset으로 결정되고, 기본 gate runner는 Codex CLI, 기본 interactive runner는 Claude Code CLI다.

## 먼저 읽을 것

순서대로 훑으면 30~60초 내 맥락 복구 가능.

1. `docs/HOW-IT-WORKS.md` (or `.ko.md`) — 전체 아키텍처 (outer/inner 세션, tmux, state.json, sentinel, phase 러너)
2. `docs/specs/2026-04-12-harness-cli-design.md` — 원 설계 rationale (ADR)
3. `docs/specs/2026-04-14-tmux-rearchitecture-design.md` — 현 tmux 아키텍처 ADR
4. `docs/specs/2026-04-14-claude-harness-skill-design.md` — `/harness` 슬래시 커맨드 플러그인 설계
5. **현재 코드와 직접 연결된 설계/배경 문서**:
   - `docs/specs/2026-04-18-gate-prompt-hardening-design.md` + `docs/plans/2026-04-18-gate-prompt-hardening.md`
   - `docs/specs/2026-04-18-harness-skills-synthesis-{INTENT,design}.md` + `docs/plans/2026-04-18-harness-skills-synthesis.md`
   - `docs/specs/2026-04-18-claude-token-capture-design.md`
   - `docs/specs/2026-04-18-light-flow-design.md` + `docs/plans/2026-04-18-light-flow.md` (**현재는 구현 완료 상태**. 구현 여부는 설계 문서가 아니라 `README*`, `docs/HOW-IT-WORKS*`, `src/`를 기준으로 판단할 것.)

## 문서 동기화 의무

- 구현체를 바꿔서 사용자/운영자 관찰 가능 동작이 달라지면, **반드시 같은 변경에서** `README.md`, `README.ko.md`, `docs/HOW-IT-WORKS.md`, `docs/HOW-IT-WORKS.ko.md`의 영향 범위를 검토한다.
- 변경된 동작이 CLI 플래그, phase 흐름, reopen/retry 규칙, runner 선택, preset 기본값, state/artifact 경로, verify/gate 동작, tmux/attach 동작, logging/footer에 영향을 주면 관련 문서를 즉시 최신화한다.
- 문서 영향이 없다고 판단한 경우에도 PR/커밋 설명에 `README/HOW-IT-WORKS 검토 결과 문서 변경 불필요`라는 취지의 근거를 남긴다.
- 임시 실험 메모·handoff·세션 산출물은 장기 문서처럼 취급하지 말고, 기준 문서는 `README*`와 `docs/HOW-IT-WORKS*`로 유지한다.

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
pnpm vitest run     # 전체 테스트 스위트
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
| `ui_render` | `phase`, `phaseStatus`, `callsite: RenderCallsite` (PR #39 — emitted from every `renderControlPanel(state, logger, callsite)` call; `callsite` is a literal union of `loop-top`, `interactive-*`, `gate-*`, `verify-*`, `terminal-*`) |
| `terminal_action` | `action: 'resume' \| 'jump' \| 'quit'`, `fromPhase: number`, `targetPhase?: number` (PR #39 — emitted from `enterFailedTerminalState` when user picks an action) |

`claudeTokens` 3-state 계약: 성공 시 객체, 추출 실패 시 `null` + 단일 stderr warn (best-effort, 런 실패시키지 않음), 시도 자체가 해당 없으면 필드 부재.

Session meta: `~/.harness/sessions/<hash>/<runId>/{events.jsonl, meta.json, summary.json}`.

## 커밋·PR 관례

- **브랜치**: 기능 단위 worktree 분리 (`git worktree add`). 이름은 `next-N` 또는 feature명.
- **커밋 메시지**: `fix(<scope>): <imperative>` / `feat(<scope>): <subject>` / `docs(<type>): <subject>`.
- **Co-authored-by 트레일러 금지** (전역 규칙).
- **PR**: squash merge 기본. 관련 PR 번호는 본문에 참조.
- **`.gitignore` 경로(`.harness/`, `node_modules/`, `dist/`, `.idea/`)는 `git add -f` 금지**.

## 실행 모드 defaults

- **Logging은 opt-in**: 코드 기본값은 off이며, 세션 증적이 필요할 때만 `--enable-logging`을 명시한다.
- **Gate escalation**: P1만 처리하고 P2는 plan 내 TODO로 기록 후 다음 phase 진입. (전역 메모리 규칙)
- **Autonomous mode**: 사용자가 "에스컬레이션 없이 진행" 지시 시 활성. 단일 안건에 대해 Codex 최대 3회 거절, 4회째 강제 통과.

## 현재 이슈 메모 취급

- 세션성 이슈 메모나 과거 dogfood 산출물은 쉽게 stale해진다. 현재 동작 판단에는 우선순위를 주지 말고, 필요 시 이슈 트래커/PR/코드로 재검증할 것.
- 장기적으로 유지할 사실은 `README*`, `docs/HOW-IT-WORKS*`, 그리고 해당 설계/spec 문서에 반영한다.

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
