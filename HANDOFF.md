# HANDOFF — Group F (Gate retry policy, T6)

**Paused at**: 2026-04-19 11:27 KST
**Worktree**: `/Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/gate-retry-policy`
**Branch**: `spec/gate-retry-policy`
**Base prompt**: inline prompt from parent orchestration (user's Group F brief — full text re-derivable from `docs/specs/2026-04-19-gate-retry-policy-INTENT.md` which was committed as a durable seed)
**Reason**: token exhaustion / account switch (user-initiated pause)

## Completed commits (이 worktree에서)

`git log --oneline origin/main..HEAD`:

- `b2a935d` docs(intent): Group F gate retry policy handoff

(Base: `849d8fe` on `origin/main`, tip of main when this worktree forked.)

## In-progress state

- **현재 task**: Workflow orchestration — `harness-cli` 풀 7-phase dogfood. Currently blocked at Phase 1 (spec 작성) kickoff.
- **마지막 완료 step**: INTENT doc 작성 + commit (b2a935d). Kicked off `harness run --auto --enable-logging` inside a new tmux session `harness-2026-04-19-group-f-gate-retry`. Inner `__inner` node process (PID 38157 at pause time) was alive for ~4m40s.
- **중단 직전 하던 action**: Waiting for Phase 1 inner Claude session to spawn and produce the first artifact. `state.json` shows `currentPhase: 1, status: in_progress, phases.1: "pending"` — Phase 1 runner had not yet transitioned to `running` at pause time. No `phase_start` event emitted yet.
- **테스트 상태**: GREEN (baseline `pnpm vitest run` = 617 passed / 1 skipped, captured before any impl work started).
- **빌드 상태**: `pnpm build` succeeded in this worktree. `pnpm tsc --noEmit` not separately re-run (build implies it).
- **uncommitted 잔여물**: none. Working tree clean at pause. The harness run directory `.harness/2026-04-19-group-f-gate-retry/` is gitignored and contains `state.json` + `task.md` + `run.lock`.

### Running background processes at pause time

| Process | PID | Notes |
|---|---|---|
| `node dist/bin/harness.js __inner 2026-04-19-group-f-gate-retry` | 38157 | Harness orchestrator in tmux session `harness-2026-04-19-group-f-gate-retry`. Autonomous mode — will continue 7-phase lifecycle unattended. |
| tmux session `harness-2026-04-19-group-f-gate-retry` | — | Created 11:22:22. Detached (no longer attached to a terminal). |
| Monitor task `b7lwewasa` (this Claude Code session) | — | Will die with my session. |
| Background poll task `b1m71p09q` (this session) | — | Will die with my session. |

**중요**: The harness inner process was **NOT stopped** at pause time per the "새 작업 시작 금지" rule. It may:
- (a) continue running to completion (autonomous mode force-passes after 3 Codex rejects, so theoretically terminal), producing commits on this branch;
- (b) crash mid-phase and leave partial state;
- (c) get OOM-killed by macOS as host RAM fluctuates.

**Resume session MUST check harness status first** before touching code — see "Next concrete steps" below.

## Decisions made this session

- **[결정 1] Binary choice for dogfood**: Used the **worktree's own `dist/bin/harness.js`** (fresh `pnpm build`), **NOT** the global `harness` bin (which symlinks to `~/Desktop/projects/harness/harness-cli`, dist from Apr 13 — pre-PR #11/#15/#16/#21-#24). Reason: dogfood must test the post-PR-#22/#23 preset defaults + PR #16 claudeTokens logging.
- **[결정 2] TTY handling**: Harness preflight requires `process.stdin.isTTY && process.stdout.isTTY`. Claude Code's Bash tool pipes stdout → wrapped the invocation in `script -q /tmp/harness-kickoff.log env -u TMUX ...` to (a) allocate a PTY via `script(1)` and (b) unset `$TMUX` so harness creates a **dedicated** tmux session rather than a new window in my current session (avoiding visual disruption for the user).
- **[결정 3] INTENT seed doc**: Per advisor feedback, the Phase 1 inner Claude session cannot see my conversation history. Wrote a durable `docs/specs/2026-04-19-gate-retry-policy-INTENT.md` containing the full Group F brief (3-option comparison, hybrid recommendation, reviewer-contract stanza draft, parser regex draft, flow-aware config helper, events.jsonl impact, test strategy, scope boundaries, conflict notes with Groups A–E) and committed it as the baseCommit so all subsequent phases (and Codex reviewers) read it. Task string passed to `harness run` explicitly points the inner agent at this INTENT file.
- **[결정 4] Recommended hybrid = Option 1 + Option 3**: INTENT records the default recommendation but explicitly allows P1 to override based on deeper analysis. Option 2 (ADR-4 static relaxation) was pre-rejected as a strict subset of Option 1 — documented in INTENT L68–70.
- **[결정 5] Autonomous mode engaged**: `harness run --auto`. Codex 3 reject → 4회째 force pass per global `harness-lifecycle` rule.
- **[결정 6] Full-flow ADR-4 relaxation out of scope**: Explicitly scoped OUT of this PR (INTENT L120 + L176). Follow-up spec needed if desired.

## Open questions / blockers

- **[질문]** When resuming, should the in-flight harness run (tmux session `harness-2026-04-19-group-f-gate-retry`) be:
  - (A) **let it finish** — if it's already past Gate 2 APPROVE, resuming into its deliverables is the cheapest path; OR
  - (B) **killed + restarted** — if the inner is stuck (e.g., hit Phase 1 timeout, orphaned prompt), a clean restart may be faster.
  - Recommended heuristic: if `state.json.currentPhase >= 3` or `status == completed`, prefer (A). If still at Phase 1 after >30 min elapsed wall time, prefer (B).
- **[blocker]** None. Work can resume independently.

## Next concrete steps (ordered)

1. **Check harness state**: `cat .harness/2026-04-19-group-f-gate-retry/state.json | jq '{runId, currentPhase, status, phases, gateRetries}'`. If `status == "completed"`, skip to step 4. If `status == "paused"`, inspect `pauseReason` + `pendingAction` for recovery.
2. **Check inner process**: `ps -p 38157 -o pid,etime,command 2>&1` (PID may differ — find with `ps aux | grep '__inner 2026-04-19-group-f-gate-retry'`). If alive + making progress (events appended to `~/.harness/sessions/c38556e1f039/2026-04-19-group-f-gate-retry/events.jsonl` within last 5 min), let it run; re-attach a Monitor. If alive but stalled (>15 min without events), attach tmux (`tmux attach -t harness-2026-04-19-group-f-gate-retry`) to inspect inner Claude pane.
3. **If harness needs restart**: Kill inner cleanly (`kill <pid>` — lets state.json settle), remove lock (`rm .harness/2026-04-19-group-f-gate-retry/run.lock` if stale), then `node dist/bin/harness.js resume 2026-04-19-group-f-gate-retry` OR delete the run dir + `.harness/current-run` and re-run fresh.
4. **When harness completes** (autonomous or user-terminated): inspect deliverables with `git log --oneline origin/main..HEAD`. Expected artifacts: `docs/specs/2026-04-19-gate-retry-policy*.md` (from P1), `docs/plans/2026-04-19-*.md` + `checklist.json` (from P3), impl diff on `src/{config,types,context/assembler,phases/verdict,phases/runner}.ts` + test files (from P5), `docs/process/evals/*` (from P6).
5. **Verification + PR**: Run `pnpm tsc --noEmit && pnpm vitest run && pnpm build`. Open PR per INTENT L153–167 (title: `feat(gate): scope-aware P5 reopen + flow-aware retry limit (light)`; body per INTENT template; base: `main`).

## Resume instructions

새 세션 시작 시 **첫 프롬프트로 이걸 그대로 붙여넣기**:

> 이 worktree는 Group F (gate retry policy, T6)의 작업을 진행 중이다. 다음 순서로 컨텍스트를 복구하고 이어서 진행하라:
>
> 1. `~/.grove/AI_GUIDE.md` 읽기
> 2. 프로젝트 `CLAUDE.md` 읽기
> 3. `/Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/gate-retry-policy/HANDOFF.md` 읽기 — 현재 상태 복구
> 4. `/Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/gate-retry-policy/docs/specs/2026-04-19-gate-retry-policy-INTENT.md` 읽기 — 전체 goal/scope/out-of-scope + 3안 비교 + 채택 하이브리드 확인
> 5. `git log --oneline -10` + `git status` 확인. 그리고 **harness 런이 아직 돌고 있는지 반드시 확인**: `ps aux | grep '__inner 2026-04-19-group-f-gate-retry' | grep -v grep` + `cat .harness/2026-04-19-group-f-gate-retry/state.json | jq '{currentPhase, status, phases}'`.
> 6. HANDOFF.md의 "Next concrete steps" 1번부터 재개.
>
> 작업 재개 전에 현재 이해한 state(특히 harness 런이 살아있는지 / Phase 몇까지 진행됐는지 / 내가 이어서 할 action이 무엇인지)를 1–2문장으로 요약해서 확인받고 시작할 것.
