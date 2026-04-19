# HANDOFF — Group E UX/Observability mini-bundle (T8-a/b/c/d)

**Paused at**: 2026-04-19 (session-end token exhaustion)
**Worktree**: /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/ux-observability
**Branch**: feat/ux-observability
**Base prompt**: (inline prompt from this session — no external txt file; reproduced below under "Base prompt recap")
**Reason**: user-requested pause for token/account rotation

## Completed commits (this worktree)

`git log --oneline 849d8fe..HEAD` (base = origin/main @ 849d8fe):

- `d54c8fb` docs(spec): address gate-spec round 1 feedback (retryIndex propagation, ESM-safe test, commit-count semantics, porcelain parse)  ← this session
- `10e3e13` docs(spec): Group E UX/observability mini-bundle design (T8-a/b/c/d)  ← prior session

## In-progress state

- **현재 task**: Task #2 "Gate spec review" — round 2 just completed with Codex REJECT. Round 3 not yet submitted.
- **마지막 완료 step**: Spec doc revised + committed (`d54c8fb`) to address round-1 P1-1/2/3/4 + P2-1. Round 2 Codex review executed and response captured in `/tmp/gate-review/spec-review-2.txt`.
- **중단 직전 하던 action**: About to edit `docs/specs/2026-04-19-ux-observability-mini-bundle-design.md` to address round-2 feedback (see "Next concrete steps"). No files changed yet for round 3.
- **테스트 상태**: GREEN (baseline from session start: `pnpm vitest run` → 617 passed / 1 skipped; `pnpm tsc --noEmit` exit 0). **No code changes yet this session — still at baseline.**
- **빌드 상태**: not re-run this session (docs-only commits so far).
- **uncommitted 잔여물**: none (working tree clean at pause time).

## Decisions made this session

- **Spec round-1 P1-1 (retryIndex propagation)** → thread `retryIndex` through `handleGateEscalation` + `saveGateFeedback` (4-param); captured pre-mutation in `handleGateReject` at gate.ts L496.
- **Spec round-1 P1-2 (best-effort contract)** → legacy `gate-N-feedback.md` mandatory (throws on failure); archive + verdict JSON best-effort (try/catch + printWarning). Helper signature unchanged.
- **Spec round-1 P1-3 (commit-count semantics)** → Summary table now "N rounds → 2·N−1 commits today, verifyRetries+1 after". §8 item 7 asserts commit count == `verifyRetries + 1`.
- **Spec round-1 P1-4 (ESM const)** → tests use `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(30_000)`. No const mutation. Optional `__setWatchdogDelayMsForTesting` setter mentioned but non-default.
- **Spec round-1 P2-1 (porcelain parse)** → new `isStagedDeletion()` helper in git.ts using `git diff --cached --name-status`, replacing trimmed porcelain check. `runPhase6Preconditions` calls it before tracked-file branch.
- **Autonomous mode in effect** per base prompt — Codex max 3 rejects per issue, 4th force-pass. Currently at 1 rejection on round 2 P1s (fresh issues, not round-1 repeats). So **not yet at force-pass threshold** for round 2 issues.

## Open questions / blockers

- **Q1 (round-2 P1-1)**: Archive filename scheme needs a second discriminator for post-escalation retry cycles. Candidate options:
  - (a) Add an `escalationCycle` counter in `state.gateEscalationCycles[phase]` and rename archive → `gate-N-cycle-C-retry-K-feedback.md`.
  - (b) Narrow the spec's history-preservation claim to "within a retry cycle" (acknowledge overwrite across Continue).
  - (c) Directory layout: `gate-N-cycle-C/retry-K.md`.
  - **Decision needed next session**: (a) is cleaner and matches the "preserve history" stated goal; (b) is simpler but weakens the deliverable.
- **Q2 (round-2 P1-2)**: `src/resume.ts` L173 + L218 also commit eval reports with the old `Phase 6 — eval report` title. Need to either (a) route through a shared helper computing `rev K`, or (b) explicitly scope spec to normal-path only and accept resume commits keep old title.
  - **Decision needed next session**: (a) is correct for consistency, but requires wider change + test — weigh against P1-only scope.
- **Q3 (round-2 P2-1)**: Watchdog timer callback should re-check `state.currentPhase === phase` + `attemptId` before printing hint (SIGUSR1 mid-phase skip race). P2 per Codex. Likely fold into ADR-2 timer impl as a small guard — low effort, accept.
- **Q4 (round-2 P2-2)**: `verifyRetries` resets on Gate 7 reject/escalation (runner.ts L509, L624), so `rev K` can repeat in same run. P2. Options: (a) narrow wording to "within verify cycle", (b) add monotonic `evalReportRevisionCounter`. (a) is low effort.

## Base prompt recap

The session prompt (reproduced for next session's context):

- Goal: 4 UX/observability improvements bundled as single PR `feat(ux-obs)`:
  - **T8-a**: Gate feedback archival (per-retry + APPROVE verdict JSON).
  - **T8-b**: Folder-trust watchdog (30s one-shot timer, Claude interactive 1/3/5).
  - **T8-c**: Preflight `@file` timeout 5s → 10s + softer wording.
  - **T8-d**: Phase 6 eval-report commit squash (one commit per verify round).
- Workflow: `superpowers:brainstorming` → spec (done) → `codex-gate-review --gate spec` (in progress, round 2 REJECT) → TDD impl (T8-c → T8-a → T8-d → T8-b order) → `codex-gate-review --gate eval` → PR.
- **Autonomous mode** — no escalation; force-pass after 4 Codex rejects on the same issue.
- `--enable-logging` default on for harness runs (not relevant to this worktree — no harness runs yet).
- P1-only gate feedback policy.

Scope:
- Modify: `src/phases/gate.ts`, `src/phases/runner.ts`, `src/commands/inner.ts`, `src/preflight.ts`, `src/git.ts` (new `isStagedDeletion`), `src/artifact.ts` (eval-report reset + `normalizeArtifactCommit`).
- Create: 4 new test files under `tests/phases/` and `tests/preflight-*.test.ts`.
- Out-of-scope: events.jsonl schema, `src/runners/*`, `src/context/playbooks/*`, Group A/B/C/D/F territories.

PR title: `feat(ux-obs): gate archival + folder-trust watchdog + preflight bump + eval-reset squash`. Base: main.

Co-authored-by forbidden. No `git add -f`. No `pnpm link --global`.

## Next concrete steps (ordered)

1. **Decide Q1 / Q2**: choose archive filename scheme (recommend option (a): add `cycle` counter to state + filename) and resume.ts commit path policy (recommend option (a): shared helper for `rev K`). Update spec doc accordingly.
2. **Apply spec edits** for round-2 P1-1 + P1-2 + (optionally P2-1, P2-2). Target file: `docs/specs/2026-04-19-ux-observability-mini-bundle-design.md`. Sections: ADR-1 "Escalation K semantics" + §4 interfaces for cycle counter; ADR-4 + §4.3/4.4 to include resume.ts commit helper; ADR-2 timer callback guard; ADR-4 revision wording narrow.
3. **Commit spec round 3**: `docs(spec): address gate-spec round 2 feedback (archive cycle discriminator, resume-path rev K, watchdog attemptId guard)`.
4. **Re-submit gate spec round 3** via `/tmp/gate-review/prompt-r3.txt` built the same way as round 2 (see `/tmp/gate-review/prompt-r2.txt` for template). Execute `node ~/.claude/plugins/cache/openai-codex/codex/1.0.3/scripts/codex-companion.mjs task --effort high "$(cat /tmp/gate-review/prompt-r3.txt)"`.
5. **On APPROVE**: mark Task #2 completed, move to Task #3 (T8-c preflight bump, lowest risk, TDD start).
6. **On REJECT round 3**: round 4 = force-pass threshold under autonomous mode (Codex 4th reject → force-pass that specific issue). Log force-pass reasoning in commit message.
7. **TDD implementation order** (per base prompt): T8-c → T8-a → T8-d → T8-b. Each slice: (a) write failing test, (b) implement, (c) `pnpm tsc --noEmit && pnpm vitest run`, (d) commit `feat(<scope>): <subject>`. See spec §5 Testing table for per-slice assertions.
8. **After all 4 slices land**: run `pnpm build` + final `pnpm vitest run` snapshot → eval report → `codex-gate-review --gate eval` → open PR per "Completed" section below.

## Session tasks snapshot (TaskList)

- #1 [completed] Baseline tests + build
- #2 [in_progress] Gate spec review ← **pause point**
- #3 [pending] T8-c preflight timeout bump
- #4 [pending] T8-a gate feedback archival
- #5 [pending] T8-d Phase 6 eval commit squash
- #6 [pending] T8-b folder-trust watchdog
- #7 [pending] Gate eval review
- #8 [pending] Open PR

## Artifacts on disk (not committed; /tmp survives)

- `/tmp/gate-review/prompt.txt` — round 1 prompt
- `/tmp/gate-review/spec-review-1.txt` — round 1 Codex response (REJECT + 4 P1s + 1 P2)
- `/tmp/gate-review/prompt-r2.txt` — round 2 prompt
- `/tmp/gate-review/spec-review-2.txt` — round 2 Codex response (REJECT + 2 P1s + 2 P2s) ← **read this first to see the exact round-2 issues verbatim**

## Resume instructions

새 세션 시작 시 **첫 프롬프트로 이걸 그대로 붙여넣기**:

> 이 worktree는 Group E UX/observability mini-bundle (T8-a/b/c/d) 작업을 진행 중이다. 다음 순서로 컨텍스트를 복구하고 이어서 진행하라:
>
> 1. `~/.grove/AI_GUIDE.md` 읽기
> 2. 프로젝트 `CLAUDE.md` 읽기 (`/Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/ux-observability/CLAUDE.md`)
> 3. `/Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/ux-observability/HANDOFF.md` 읽기 — 현재 상태 복구
> 4. `docs/specs/2026-04-19-ux-observability-mini-bundle-design.md` 읽기 — 현재 spec 내용 확인
> 5. `/tmp/gate-review/spec-review-2.txt` 읽기 — round 2 Codex REJECT 이슈 정확한 문구 확인 (/tmp가 없어졌다면 HANDOFF.md "Open questions" 섹션의 Q1–Q4 이슈로 대체)
> 6. `git log --oneline -10` + `git status` 확인
> 7. HANDOFF.md의 "Next concrete steps" 1번부터 재개 — Q1/Q2 결정 → 스펙 문서 수정 → 라운드 3 재제출.
>
> **자율 모드**: Codex 4회 거절 시 해당 안건 강제 통과. P1-only gate feedback.
> 작업 재개 전에 현재 이해한 state를 1–2문장으로 요약해서 확인받고 시작할 것.
