# Dogfood follow-ups — 2026-04-18

Observations captured by the dogfood-full session (see
`observations.md` on branch `dogfood/full-flow`, commit `e9caee1`) that
are **not** addressed by the Phase 1 preset-relaxation PR.

Severity key: P0 = blocking / data loss · P1 = big throughput or quality
hit · P2 = UX or audit gap · P3 = nitpick.

## Open — Priority 1

### P1.1  Phase 5 "failed" on pytest-left-behind artifacts, no auto-recovery

Root cause:
- `validatePhaseArtifacts` (src/phases/interactive.ts:148) rejects any
  non-empty `git status --porcelain` at phase-5 end.
- Wrapper skill `src/context/skills/harness-phase-5-implement.md` does
  not require Claude to add language-standard `.gitignore` entries in
  the scaffolding commit, or to commit every tracked-file edit before
  sentinel.
- `runPhaseLoop` (src/phases/runner.ts:196) returns on
  `phases[N] === 'failed'` with no retry, no resume hint, no diagnosis.

Proposed change (one PR):
1. Wrapper-skill Process step 0 — "If scaffolding a new language
   project, add that language's canonical `.gitignore` patterns
   (`__pycache__/`, `.pytest_cache/`, `.venv/`, `node_modules/`, …) in
   the scaffolding commit. Before sentinel, run
   `git status --porcelain` and commit any tracked-file edits with a
   follow-up `chore: gitignore` commit; stage nothing else."
2. On validation failure, print blocking-path list + actionable resume
   command (`hc-full resume` / `hc-full jump 5`).
3. Optional: allow `validatePhaseArtifacts` to auto-add strictly-ignorable
   paths (`**/__pycache__/**`, `**/*.pyc`, `node_modules/`, etc.) to
   `.gitignore`, commit as `chore: auto-ignore`, re-validate once.
   Behind a `--strict-tree` flag if you want the old behavior back.

Evidence: run at
`~/.harness/sessions/0f7dd70d1f23/2026-04-18-build-a-terminal-based/`,
phase 5 failed at 1411.9s / 6.4M Claude tokens; actual impl landed in git
and `pytest tests/` passes 48/48.

### P1.2  Wrapper-skill self-audit before sentinel (gate-loop efficiency)

Root cause: every gate reject on the dogfood run was legitimate, and in
most cases re-caught internal contradictions that the implementer itself
*could* have detected by grepping the artifact it just wrote against the
spec's own success-criteria section. E.g., gate 4 rejected because the
plan had `except Exception` in `commands.py` — the spec's own §10
success-criterion 8 said to grep for that string. The implementer never
ran its own acceptance grep.

Proposed change:
- `harness-phase-{1,3,5}-*.md` Process, second-to-last step:
  "Before writing the sentinel, re-read the artifact you just authored
  and grep it against every machine-checkable invariant in the spec
  (or plan) you're implementing. If any hit, fix in this pass — do not
  hand to the gate. This step is load-bearing: each gate round costs
  ~40× a local grep."

Expected impact: from this run's data, 2 of 5 gate rejects would have
been caught pre-sentinel.

### P1.3  P1-only policy not surfaced to the runtime implementer

Repo `CLAUDE.md` and the user's global memory both say "gate에서 P1만
처리하고 P2는 plan 내 TODO로 기록." But the wrapper-skill prompt only
says "반드시 반영" for feedback — which Claude takes as "address all
P1 + P2 comments, blocking." On the dogfood run, gate-2 round 2 said
"addressing all four issues" (2 P1 + 2 P2); the P2-driven spec
restructuring exposed a new P1 inconsistency.

Proposed change:
- `harness-phase-{1,3}-*.md` retry Process step: "Address every P1
  comment. For each P2: fix inline only if it's a ≤2-line edit; else
  note in the artifact's `## Deferred` section for follow-up. Do not let
  P2 drive structural changes — they aren't blocking this gate."

### P1.4  Plan size explosion for trivial tasks

Final plan for a ~500 LOC todo CLI was 1584 lines. Phase 3 with
`sonnet-high` + `superpowers:writing-plans` default produces the same
depth regardless of task complexity.

Proposed change:
- Phase 1 spec adds a `## Complexity` one-liner (Small / Medium / Large).
- `src/context/assembler.ts` reads that line and injects a corresponding
  directive into the Phase 3 prompt:
  - Small → ≤3 tasks, no per-function pseudocode.
  - Medium → current behavior.
  - Large → same as Medium today.
- `harness-phase-3-plan.md` Process adds: "Respect the complexity
  signal from the spec; don't over-engineer a Small task into a detailed
  plan."

## Open — Priority 2

### P2.1  Control-pane footer has no running elapsed / token counter

Today the user sees phase ticks only. On the dogfood run, 60 min / 9M
tokens were spent before anyone noticed. Propose: tail `events.jsonl`
from the control pane and render a footer line
`P5 attempt 1 · 23m elapsed · 9.1M tokens so far`.

### P2.2  Post-APPROVE gate feedback file not cleaned up

After gate N approves, `.harness/<runId>/gate-N-feedback.md` still
contains the last *reject* feedback. Post-hoc "what did the approving
round actually say?" requires a missing raw file. Low severity.

### P2.3  Folder-trust first-run discoverability

README L248 has the hint. But on first run, the control pane sits at
"Phase 1 ▶" silently while Claude hangs on the dialog. Propose a
watchdog: if `phase_start` fired >30s ago without activity, control
pane prints "No output yet? Check the Claude window (`C-b 1`) — may be
waiting on folder-trust."

## Context / provenance

- All observations were produced by a single dogfood-full run on
  `~/Desktop/projects/harness/experimental-todo-full`, captured in
  `~/.harness/sessions/0f7dd70d1f23/2026-04-18-build-a-terminal-based/`.
- Shipped fixes #7/#9/#10/#11/#12/#13 all verified in-run; no regression
  hits.
- Round 2 was **not** executed — Round 1 alone consumed the budget.
  Re-validating these follow-ups will want a Round 2 run after PR #22
  (preset-id rename) and this PR both land, to measure the cost delta
  without a naming-churn variable in the mix.
