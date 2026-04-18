# CLAUDE.md — harness-cli

이 repo 전용 지침. 전역 규칙(`~/.claude/CLAUDE.md`)과 함께 적용된다.

## 프로젝트 한 줄

`harness-cli`는 AI 에이전트 개발 라이프사이클을 7단계 파이프라인(spec → gate → plan → gate → impl → verify → eval gate)으로 강제하는 CLI. Claude Code가 구현자, Codex가 독립 리뷰어. `--light` flag로 4-phase 경량 모드(P1 → P5 → P6 → P7)도 설계 완료(구현 대기).

## 먼저 읽을 것

순서대로 훑으면 30~60초 내 맥락 복구 가능.

1. `docs/HOW-IT-WORKS.md` (or `.ko.md`) — 전체 아키텍처 (outer/inner 세션, tmux, state.json, sentinel, phase 러너)
2. `docs/specs/2026-04-12-harness-cli-design.md` — 원 설계 rationale (ADR)
3. `docs/specs/2026-04-14-tmux-rearchitecture-design.md` — 현 tmux 아키텍처 ADR
4. `docs/specs/2026-04-14-claude-harness-skill-design.md` — `/harness` 슬래시 커맨드 플러그인 설계
5. **최근 shipped 설계** (main에 merged, 구현 일부 완료):
   - `docs/specs/2026-04-18-gate-prompt-hardening-design.md` + `docs/plans/2026-04-18-gate-prompt-hardening.md` (PR #11) — BUG-A/B/C 수정 + phase-start preset 로깅
   - `docs/specs/2026-04-18-harness-skills-synthesis-{INTENT,design}.md` + `docs/plans/2026-04-18-harness-skills-synthesis.md` (PR #12) — **T1/T2/T3/T6 완료, T4/T5/T7 대기**
6. **In-flight 설계** (구현 플랜 대기):
   - `docs/specs/2026-04-18-untitled-design.md` (PR #10) — `harness start --light` 경량 4-phase 플로우. **파일명 정리 필요** (`untitled` → 의미있는 이름).

## 코드 탐색 entry points

| 경로 | 역할 |
|---|---|
| `src/commands/` | CLI 서브커맨드 (`run`, `resume`, `jump`, `skip`, `inner`, `start`) |
| `src/phases/` | 라이프사이클 페이즈 구현 (interactive, gate, runner dispatcher, verdict) |
| `src/runners/` | Claude/Codex runner (`claude.ts` interactive+gate, `codex.ts` gate+resume) |
| `src/context/assembler.ts` | 페이즈별 프롬프트 조립. **주요 상수**: `REVIEWER_CONTRACT_BASE` + `FIVE_AXIS_{SPEC,PLAN,EVAL}_GATE` + `REVIEWER_CONTRACT_BY_GATE[2\|4\|7]`. **주요 함수**: `buildLifecycleContext(phase)` — Gate 2/4/7에 주입되는 `<harness_lifecycle>` stanza (PR #11, BUG-A fix). |
| `src/context/prompts/phase-{1,3,5}.md` | Phase 1/3/5 템플릿. 현재 `HARNESS FLOW CONSTRAINT` 블록 inline (PR #11, BUG-B fix — `advisor()` 중간 호출 금지). Skills-synthesis T5에서 thin binding으로 전환 시 이 constraint를 wrapper에 migrate하거나 유지해야 함. |
| `src/context/skills/` | Phase 1/3/5 wrapper 스킬 (`harness-phase-{1,3,5}-*.md`, T2 authored). **아직 assembler에 inline되지 않음** — T4 (`assembleInteractivePrompt`에 `{{wrapper_skill}}` 렌더링) 구현 대기. |
| `src/context/playbooks/` | Vendored agent-skills playbooks (T1 at pinned SHA `9534f44c`): `context-engineering.md`, `git-workflow-and-versioning.md`, MIT `LICENSE`, `VENDOR.md` (sync 절차). |
| `src/state.ts`, `src/types.ts` | `state.json` 스키마 + migration + `GateSessionInfo` lineage |
| `src/signal.ts` | SIGUSR1 control-plane handler (online jump/skip) |
| `src/input.ts` | InputManager — pre-emptive key buffer (1s TTL pendingKey) |
| `scripts/harness-verify.sh` | Phase 6 결정론 평가 (checklist.json 소비) |
| `scripts/copy-assets.mjs` | dist 빌드 시 `src/context/{prompts,skills,playbooks}` + `scripts/harness-verify.sh` 복사 |

## 검증 커맨드 (eval checklist에 넣을 때 그대로)

```bash
pnpm tsc --noEmit   # typecheck (= pnpm lint; package.json에서 alias)
pnpm vitest run     # 전체 테스트 스위트 (현재 baseline: 497 passed / 1 skipped)
pnpm build          # tsc + scripts/copy-assets.mjs (dist 생성)
```

`lint`가 `tsc --noEmit`의 alias이므로 별도 ESLint 없음 — checklist에 둘 다 넣지 말 것.

## 이벤트 로깅 스키마 (events.jsonl)

`--enable-logging`으로 활성화되는 세션 이벤트. 주요 필드 (PR #11 이후):

| 이벤트 | 핵심 필드 |
|---|---|
| `session_start` | `task`, `autoMode`, `baseCommit`, `harnessVersion` |
| `phase_start` | `phase`, `attemptId`, **`preset: { id, runner, model, effort }`** (PR #11 — phase 6 제외) |
| `phase_end` | `phase`, `attemptId`, `status`, `durationMs` |
| `gate_verdict` | `phase`, `retryIndex`, `runner`, `verdict`, `durationMs`, `tokensTotal`, `promptBytes`, `codexSessionId`, `resumedFrom`, `resumeFallback`, `preset` |
| `gate_retry` | `phase`, `retryIndex`, `retryCount`, `retryLimit`, `feedbackPath`, `feedbackBytes`, `feedbackPreview` |
| `gate_error` | `preset` (PR #11) |

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
| 1 | Gate reject 루프 비수렴 | **PR #11 이후 재실험 필수**. PR #11이 BUG-A (gate lifecycle 부재)와 BUG-C (codex AGENTS.md leak) 수정 → 이전 관찰 데이터 대부분 invalid. content-fix 후보는 "exhaustive-first hint" + "retry limit 상향". "already-addressed dedup"은 dog-fooding 결과 invalid. |
| 5 | Phase 3 interactive 폭주 (37분 runaway 이력) | 원인 미파악. 재현 실험 선행 후 soft-timeout 설계. |
| 7 | Interactive clarify dialog (`## Open Questions` 의무화) | **harness-skills-synthesis T2에서 wrapper skill에 흡수 완료**. T4/T5 완료 시 runtime 반영. |

### 2026-04-18 dog-fooding에서 확인된 신규 이슈 (`~/Desktop/projects/harness/experimental-todo/observations.md` 참조)

| # | 요지 | 심각도 | 상태 |
|---|---|---|---|
| 8 | Phase 1 default preset 과중 (`opus-max` xHigh) — 간단한 CLI에 4분+ 사용 | P1 | **미처리** (PR #11 §5 deferred). `--simple`/`--complex` 힌트 또는 `opus-high` 기본값 검토 필요. |
| 9 | `printAdvisorReminder` orphan text (control-pane tip이 Claude로 전달 안 됨) | P2 UX | PR #11 `HARNESS FLOW CONSTRAINT`가 `advisor()` 금지로 실질 무효화. 함수 자체 제거 검토. |
| 10 | Control-pane 64-char hardcoded (`src/ui.ts:12`) — 40/60 tmux split에서 라벨 줄바꿈 | P2 UX | 미처리. `Math.min(64, termWidth-2)` + 기본 split 60/40 재검토. |
| 11 | Claude Code folder-trust 다이얼로그 첫 실행 무감지 — hang처럼 보임 | P2 UX | 미처리. README tip 또는 pre-approval 검토. |
| 12 | 인터랙티브 Phase별 Claude 토큰 기록 부재 (`events.jsonl`에 `preset`만, token 수 없음) | P2 관측성 | 미처리. Claude 런 래핑 시 token meta 캡처 필요. |
| 13 | Codex `HOME` 격리 미도입 — BUG-C alternative fix | P3 | PR #11 `REVIEWER_CONTRACT` scope-rules로 일단 해결. 항구적 격리는 추후. |

## Worktree 관례

- 위치: `~/.grove/github.com/DongGukMon/harness-cli/worktrees/<feature>`
- **문서 전용 PR**과 **코드 수정 PR**은 워크트리 분리 (서로 다른 브랜치)
- 새 worktree 생성 시 `pnpm install` 별도 필요 (symlink 복제 안 됨). `pnpm build`도 최초 1회 필요 (integration 테스트가 dist 참조).
- 머지 후 정리: `git worktree remove <path> && git branch -D <name>`
- **실험 중에는 `pnpm link --global` 금지** — 글로벌 `harness` 바이너리가 Desktop dist(실험용)를 가리키므로 worktree의 빌드 산출물이 실험을 오염시킴.

## 풀 프로세스 호출

개발 전체 사이클은 `/harness` 스킬로 실행. 내부 phase 순서·gate 규약은 전역 규칙 `harness-lifecycle` 섹션 참조.
