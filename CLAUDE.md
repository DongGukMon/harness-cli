# CLAUDE.md — harness-cli

이 repo 전용 지침. 전역 규칙(`~/.claude/CLAUDE.md`)과 함께 적용된다.

## 프로젝트 한 줄

`harness-cli`는 AI 에이전트 개발 라이프사이클을 7단계 파이프라인(spec → gate → plan → gate → impl → verify → eval gate)으로 강제하는 CLI. Claude Code가 구현자, Codex가 독립 리뷰어.

## 먼저 읽을 것

순서대로 훑으면 30~60초 내 맥락 복구 가능.

1. `docs/HOW-IT-WORKS.md` (or `.ko.md`) — 전체 아키텍처 (outer/inner 세션, tmux, state.json, sentinel, phase 러너)
2. `docs/specs/2026-04-12-harness-cli-design.md` — 원 설계 rationale (ADR)
3. `docs/specs/2026-04-14-tmux-rearchitecture-design.md` — 현 tmux 아키텍처 ADR
4. `docs/specs/2026-04-14-claude-harness-skill-design.md` — `/harness` 슬래시 커맨드 플러그인 설계
5. **In-flight (구현 대기)**:
   - `docs/specs/2026-04-18-harness-skills-synthesis-{INTENT,design}.md`
   - `docs/plans/2026-04-18-harness-skills-synthesis.md`

## 코드 탐색 entry points

| 경로 | 역할 |
|---|---|
| `src/commands/` | CLI 서브커맨드 (`run`, `resume`, `jump`, `skip`, `inner`, `start`) |
| `src/phases/` | 라이프사이클 페이즈 구현 (interactive, gate, runner dispatcher, verdict) |
| `src/runners/` | Claude/Codex runner (`claude.ts` interactive+gate, `codex.ts` gate+resume) |
| `src/context/assembler.ts` | 페이즈별 프롬프트 조립 (interactive, gate, gate-resume Variant A/B) |
| `src/context/prompts/phase-{1,3,5}.md` | Phase 1/3/5 템플릿 (thin binding으로 전환 예정 — skills-synthesis plan 참조) |
| `src/state.ts`, `src/types.ts` | `state.json` 스키마 + migration + `GateSessionInfo` lineage |
| `src/signal.ts` | SIGUSR1 control-plane handler (online jump/skip) |
| `src/input.ts` | InputManager — pre-emptive key buffer (1s TTL pendingKey) |
| `scripts/harness-verify.sh` | Phase 6 결정론 평가 (checklist.json 소비) |

## 검증 커맨드 (eval checklist에 넣을 때 그대로)

```bash
pnpm tsc --noEmit   # typecheck (= pnpm lint; package.json에서 alias)
pnpm vitest run     # 전체 테스트 스위트
pnpm build          # tsc + scripts/copy-assets.mjs (dist 생성)
```

`lint`가 `tsc --noEmit`의 alias이므로 별도 ESLint 없음 — checklist에 둘 다 넣지 말 것.

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

## 현재 open issues (스펙/플랜 작성 대기)

| # | 요지 | 상태 |
|---|---|---|
| 1 | Gate reject 루프 비수렴 | scope 재설정 필요. **PR #8 이후 재실험 필수** (이전 측정은 resume 꺼진 상태였음). content-fix 후보는 "exhaustive-first hint" + "retry limit 상향". "already-addressed dedup"은 dog-fooding 관찰에서 **invalid로 판정** (Codex가 라운드마다 새 결함 발굴, 중복 raise 안 함) |
| 5 | Phase 3 interactive 폭주 (37분 runaway 관찰 이력) | 원인 미파악. 재현 실험 선행 후 soft-timeout 설계 |
| 7 | Interactive clarify dialog hook (`## Open Questions` 섹션 의무화) | `harness-skills-synthesis` plan의 Phase 1 wrapper에 흡수됨 — Skills 구현 시 처리 |

## Worktree 관례

- 위치: `~/.grove/github.com/DongGukMon/harness-cli/worktrees/<feature>`
- **문서 전용 PR**과 **코드 수정 PR**은 워크트리 분리 (서로 다른 브랜치)
- 새 worktree 생성 시 `pnpm install` 별도 필요 (symlink 복제 안 됨)
- 머지 후 정리: `git worktree remove <path> && git branch -D <name>`

## 풀 프로세스 호출

개발 전체 사이클은 `/harness` 스킬로 실행. 내부 phase 순서·gate 규약은 전역 규칙 `harness-lifecycle` 섹션 참조.
