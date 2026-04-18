# Full Flow Dogfood — 2026-04-18

Target quality: MIDDLE
Harness baseline: e03bb1d (post PR #14/#15/#16/#17/#18/#19/#20)

> Session: `~/.harness/sessions/0f7dd70d1f23/2026-04-18-build-a-terminal-based/`
> Project under test: `~/Desktop/projects/harness/experimental-todo-full` (baseline f2ff652)
> Task: vague prompt — "Build a terminal-based todo manager for personal use…" (Round 1)

## Outcome headline

**Harness reported `session_end: interrupted` at Phase 5, but the actual impl landed in git and `pytest` passes 48/48.** Quality outcome is MIDDLE-or-above (394 LOC of production code, 591 LOC of tests, layered model/store/commands/cli, durable atomic writes, mutex-exclusive flags). The "failure" was a git-hygiene trip — pycache + unstaged `.gitignore` edit — not a code defect. See §"New observations / [P1] Phase 5 fails on pytest-left-behind artifacts".

## Rounds summary

| Round | Task | Total time | Claude tokens | Gate tokens | Gate retries (P2/P4/P7) | Phase outcome |
|---|---|---|---|---|---|---|
| 1 | vague init | 63 min wall (63.2 min `totalWallMs`) | **15.5M** Claude-side (incl. P5 fail run) | **211k** gate-side | 2/1/— | P1✅ P2✅ P3✅ P4✅ **P5 fail** P6/P7 not reached |

Round 2 was not executed — Round 1 alone consumed the full time + token budget.

## Phase breakdown (Round 1, actual timings)

| Phase | Attempt | Preset | Duration | Claude tokens (per attempt) | Result |
|---|---|---|---|---|---|
| P1 spec | 1 | opus-max xHigh | 4m 17s | 710,011 | handed to gate |
| P2 spec gate | 1 | codex-high | 56.6s | (gtok 26,370) | REJECT (2 P1 + 2 P2, all legit) |
| P1 spec | 2 | opus-max xHigh | 5m 28s | 1,598,507 | handed to gate |
| P2 spec gate | 2 | codex-high | 49.1s | (gtok 35,111) | REJECT (1 new P1, fix-induced) |
| P1 spec | 3 | opus-max xHigh | 4m 12s | 3,091,101 | handed to gate |
| P2 spec gate | 3 | codex-high | 36.4s | (gtok 43,683) | **APPROVE** |
| P3 plan | 1 | sonnet-high | 9m 36s | 833,446 | handed to gate |
| P4 plan gate | 1 | codex-high | 88.8s | (gtok 41,925) | REJECT (2 P1 + 2 P2, all legit; self-inconsistent w/ spec) |
| P3 plan | 2 | sonnet-high | 10m 27s | 2,901,825 | handed to gate |
| P4 plan gate | 2 | codex-high | 66.6s | (gtok 64,205) | **APPROVE** |
| P5 impl | 1 | sonnet-high | 23m 32s | 6,400,141 | **failed** (unclean tree; impl actually landed in git, all 48 tests pass) |
| P6 verify | — | — | not reached | — | (harness exited after P5 failure) |
| P7 eval gate | — | — | not reached | — | (harness exited after P5 failure) |

### P1 preset retry-tokens — the smoking gun

| Attempt | Duration | Claude tokens | Δ from previous |
|---|---|---|---|
| 1 | 4m 17s | 710,011 | — |
| 2 | 5m 28s | 1,598,507 | +125% |
| 3 | 4m 12s | 3,091,101 | +93% |

P1's tokens roughly doubled each retry even though gate feedback shrank (4 issues → 1 issue) and the spec revisions were modest edits, not full rewrites. Cumulative spec-only cost: **5.4M tokens**, 13m 57s wall clock — for a ~280-line Python todo-CLI spec.

## Verified shipped fixes

| # | Issue | Status | Evidence |
|---|---|---|---|
| 7 | `## Open Questions` 섹션 의무 | ✅ | Spec includes 6-item `## Open Questions` section; wrapper skill (`src/context/skills/harness-phase-1-spec.md:37`) enforces it |
| 8 | Phase 1 preset 과중 (opus-max xHigh) | **⚠ confirmed pathology** | See §"P1 preset retry-tokens"; default burned 5.4M tokens for a trivial CLI spec across 3 attempts |
| 9 | `/advisor` orphan reminder removed (PR #18) | ✅ | Control pane captured across full run — zero mentions of "advisor" |
| 10 | Adaptive separator width (PR #14) | ✅ | Pane width 45 → separator 43 chars, no wrap. `max(16,min(64,stdout.columns-2))` formula observed working. |
| 11 | Folder-trust first-run (PR #14 README hint) | ✅ w/ caveat | Dialog appeared in Claude pane on first run. README §Troubleshooting L248 has the hint. **Caveat**: no in-runtime UI pointer to it; user must think to search README. |
| 12 | `phase_end.claudeTokens` interactive capture (PR #16) | ✅ | Every interactive `phase_end` for `preset.runner==='claude'` carried `claudeTokens.total`. No `null` / missing in this run. |
| 13 | Codex HOME isolation / scope-rules (PR #11 mitigation) | ✅ | `gate-2-raw.txt`, `gate-4-feedback.md` scanned — no personal convention leakage (no "Lore Commit Protocol", no `~/.codex/AGENTS.md` references). Reviewer stayed on rubric. |
| 1 | Gate reject loop convergence | **❌ not resolved — still expensive** | Both gates rejected on round 1. P2 needed 3 attempts, P4 needed 2. Reject → fix → new issue pattern observed; see §"New observations / P1 gate churn". |
| 5 | Phase 3 runaway | ⚠ borderline | P3 attempts: 9m 36s and 10m 27s. Not 37-min runaway, but > the casual-user attention span. Plan output is 1584 lines (very long for a todo CLI). |

## New observations

### [P1] Spec-phase token blowup from retry-stacking on opus-max xHigh

- **Reproduction**: `hc-full start --enable-logging "<vague todo prompt>"`. Default Phase 1 preset `opus-max` with effort `xHigh`. Gate 2 rejects twice → 3 spec attempts.
- **Measured**: attempt tokens 710k → 1.6M → 3.1M; cumulative 5.4M Claude tokens for spec-only, 14 min wall clock.
- **Root cause hypothesis**:
  - Opus xHigh makes very thorough spec drafts (inlining lots of cross-section detail → gate finds more to scrutinize).
  - Claude re-reads existing spec + prior feedback + fresh skill load every retry → context keeps growing.
  - `xHigh` effort burns inside each pass on consistency-checking work that the gate then re-does anyway (duplicated thinking).
- **Impact**: On this run, spec-only cost = **18× the 500k total-budget** this brief set as its soft cap. User cannot afford this for "realistic 1–2 hour" tasks — one vague spec burns through a daily quota.
- **Proposed fix**: Two-phase exploration:
  1. Make P1 default `opus-high` (not xHigh) or even `sonnet-high` for Phase 1. Reserve xHigh for user-opt-in ("this is a hard / design-heavy task").
  2. On reject, reuse the prior draft instead of re-invoking the brainstorming skill from scratch — pass feedback as an *edit instruction* rather than "rewrite from the task".
- **Files**: `src/config.ts:20` (PHASE_DEFAULTS), `src/context/prompts/phase-1.md` (retry prompt shape), `src/context/skills/harness-phase-1-spec.md` (Process 1 instruction).

### [P1] Gate reject loop: each fix exposes the next contradiction

- **Reproduction**: Gate 2 rounds 1→2→3 feedback evolved:
  - R1: inconsistent storage-path resolution (D2 fallback `~/.todo.json` vs. resolve_path XDG); overclaimed power-loss safety vs. atomic-only writes; `--all`/`--done` mutex unspecified; `list` ordering undefined.
  - R2: (after adding `fsync` + splitting path → XDG-only + mutex + ordering) — **new** P1 emerged: `save()` re-raises raw `OSError` while `cli.py` only catches `StoreError`. This is a fix-induced inconsistency — the R1 rewrite grew the spec from 223 → 288 lines and the bigger surface area gave Codex new targets.
  - R3: single targeted edit, clean APPROVE.
  - Gate 4: similar — the plan re-introduced the same pattern one layer down (two `except StoreError` blocks in `cli.py`, `except Exception` in `commands.py` that the spec's own verification grep would flag).
- **Assessment**: Every gate reject was **legitimate**, not reviewer noise. That means the loop isn't "non-convergent because Codex is nitpicking." It's "non-convergent because the implementer isn't self-validating against the previous round's acceptance criteria before handing back to gate." Each revision introduces fresh micro-contradictions.
- **Root cause**: The wrapper skill tells Claude to "address feedback"; it does not require Claude to (a) re-scan the current spec for new internal contradictions **it just introduced** and (b) pre-run the eval checklist invariants (e.g. `grep -r 'except Exception' src/` from the spec's own success criterion).
- **Proposed fix**: Before sentinel, have the wrapper skill require a self-audit step: *"After edits, grep the current artifact for the exact invariants listed in the spec's own success-criteria section; fix any hits in this pass."* This is cheaper than another round-trip and converges faster.
- **Files**: `src/context/skills/harness-phase-1-spec.md` + `harness-phase-3-plan.md` — Process steps + Invariants.

### [P1] P1-only vs P1+P2 policy is undocumented to the implementer

- **Reproduction**: gate-2 feedback had 2 P1 + 2 P2. Claude's next attempt log ("I'll write the revised spec addressing all four issues") shows it interpreted "must reflect all feedback" literally.
- **Conflict**: Repo CLAUDE.md ("## 실행 모드 defaults") and global memory both say **"P1만 처리하고 P2는 plan 내 TODO로 기록"**. Runtime wrapper skills don't surface this.
- **Impact**: More work per retry, more tokens, and P2-driven changes to a spec that already passed on P1s — exactly the "fix exposes new issue" pattern above.
- **Proposed fix**: Wrapper skill Process step for retry path should say: *"Address all P1 comments. Each P2 comment: either fix inline if it's a 2-line edit, or add to `## Deferred (tracked in plan)` section. Do not let P2 drive spec restructuring."*
- **Files**: `src/context/skills/harness-phase-1-spec.md`, `harness-phase-3-plan.md` (same treatment needed on gate 4).

### [P1] Plan size explosion for trivial tasks

- **Measured**: Final plan is **1584 lines** — for a ~280-line spec of a vanilla CRUD todo CLI (model/store/commands/cli, ≈500 LOC production code expected).
- **Structure**: Task 1-7, each section with fake-failing tests written out in full, pseudocode-level implementation blocks per function, tmp-file names baked in, etc. For the target user (senior engineer kicking off a side project), the plan is *more* code to skim than the resulting codebase will be.
- **Root cause**: Phase 3 wrapper skill + `superpowers:writing-plans` default for "detailed plan" is tuned for large-surface-area features. No size/complexity hint is passed through from the task.
- **Proposed fix**: Pass a 1-line "task complexity signal" from Phase 1 spec ("Complexity: Small / Medium / Large") to Phase 3 prompt. Small → ≤3 tasks, no per-function pseudocode, just "what files, what tests, what acceptance." Medium → current behavior. Large → explicit mode to keep today's depth.
- **Files**: `src/context/skills/harness-phase-3-plan.md`, `src/context/assembler.ts` (inject complexity hint).

### [P1] Phase 5 "failed" on trivially-unclean tree, with no auto-recovery

- **Reproduction**: In this run, Phase 5 wrote all impl (5 commits `a727b7f..a76b21c`, layered todo CLI) + sentinel `phase-5.done` at attempt-end. Claude then (or pytest-on-verify) left `src/todo/__pycache__/`, `tests/__pycache__/` untracked and `.gitignore` modified with an unstaged `+.omx/` hunk. `validatePhaseArtifacts` (src/phases/interactive.ts:148) rejects any non-empty `git status --porcelain`, so `phase_end` fired with `status: "failed"` at 23m 32s / 6.4M tokens. `runPhaseLoop` (src/phases/runner.ts:196) returns immediately on `phases[N]==='failed'` — the session exits with `session_end: interrupted` and no retry, no resume hint, no user-facing "impl is actually fine, just clean the tree" message.
- **Impact**: The most expensive phase of the entire run is the one most likely to hit this, and the user loses the run. The actual artifact in this case passes `pytest tests/` 48/48 — the harness threw away ~9M of accumulated tokens and ~25 min of wall time over two untracked pycache dirs and a `.gitignore` diff that isn't even wrong. In a 1-2 hour realistic task, this failure mode is *the* thing that will make users distrust the harness.
- **Root cause**: (a) Phase 5's cleanliness invariant is stricter than the wrapper skill communicates to Claude — nowhere does the Phase 5 skill say "add language-standard `.gitignore` patterns in your scaffolding commit **and** commit every edit you make to tracked files." (b) When validation fails, there's no feedback loop back to Claude — just a silent return.
- **Proposed fix** (layered):
  1. **Wrapper skill**: `harness-phase-5-implement.md` Process step 0 — "If scaffolding a new language project, add that language's canonical `.gitignore` patterns (`__pycache__/`, `.pytest_cache/`, `.venv/`, `node_modules/`, `dist/`, etc.) in the scaffolding commit. Before sentinel, run `git status --porcelain` and commit any tracked-file edits with a follow-up `chore: gitignore` commit; stage nothing else."
  2. **Harness side**: when `validatePhaseArtifacts` returns false for Phase 5 and the tree is only dirty on *ignored*-able paths (heuristic: untracked `*__pycache__*`, untracked `*.pyc`, untracked `node_modules/`, etc.), auto-add to `.gitignore`, commit, and retry validation. Not perfect, but recovers the 80% case.
  3. **UX**: on failure, print one line: "Tree not clean. Files blocking: X. Run `hc-full resume` after committing/ignoring, or jump back with `hc-full jump 5`."
- **Files**: `src/context/skills/harness-phase-5-implement.md`, `src/phases/interactive.ts:148` (Phase 5 branch of `validatePhaseArtifacts`), `src/phases/runner.ts:342-355` (failure print).

### [P2] Gate feedback file is not overwritten after APPROVE

- **Reproduction**: After gate 2 round 3 APPROVE, `gate-2-feedback.md` still contained round-2 feedback (the APPROVE round was gate-2-raw-only before being cleaned). Similarly gate-4-feedback.md retained round-1 content after round-2 APPROVE. Raw file removed.
- **Impact**: Post-hoc debugging ("what did the approver actually say in the approving round?") requires reading events.jsonl + missing raw. Low-severity — the run succeeded — but makes audits awkward.
- **Proposed fix**: On APPROVE, overwrite `gate-N-feedback.md` with `# Gate N — APPROVE\n<optional summary>` or retain `gate-N-raw.txt` verbatim so the final round is recoverable.
- **Files**: `src/phases/gate.ts` (around line 320+) or `src/phases/runner.ts` success branch.

### [P2] No real-time retry/token visibility in control pane

- **Reproduction**: The control pane shows phase pending/in_progress/done ticks but no token/retry breakdown. To see "how much is this costing" the user must `tail -f events.jsonl` themselves.
- **Impact**: A user starting a vague task has zero feedback that it's already spent 9M+ tokens. The 60-minute budget was already blown past before the control pane would have given any warning.
- **Proposed fix**: Control pane footer: `P1 attempt 2/? · tokens so far: 2.3M · elapsed 14m`. At least elapsed + running attempt count would let users abort before disaster.
- **Files**: `src/ui.ts` (control pane render).

### [P3] folder-trust first-run discoverability relies on README

- Status: README L248 documents it (PR #14). But a fresh user running `hc-full start` for the first time sees only a silent "Phase 1 ▶" in control pane while the Claude pane hangs on the dialog. They have to *know* to swap windows (`C-b 1`) or to grep the README.
- **Proposed fix**: Control pane, if Phase 1 `phase_start` fired more than ~30s ago without `phase_end`, print: *"No output yet? Check the Claude window (`C-b 1`) — it may be waiting on folder-trust."* Self-clearing tip.
- **Files**: `src/ui.ts`, triggered by elapsed-since-phase_start watchdog.

## Recommendation

**Priority 1 small PRs (ordered by ratio of impact to diff size):**

1. **Flip Phase 1 default preset to `opus-high`** (or `sonnet-high` in light-flow). `opus-max` / `xHigh` should be opt-in via `--heavy` or an env flag, not the default for a greenfield vague task. On this run, the 3 P1 attempts averaged ~40× the cost of each P2 gate round; a 1-line `PHASE_DEFAULTS[1]` change is expected to cut spec-only cost by 50-70% with no gate-rubric change. *This is the PR being opened with this observation batch* (see "Next steps" below).
2. **Phase 5 tolerance of language-standard ignorable dirt**: either wrapper-skill fix ("add standard `.gitignore` patterns in scaffolding commit; commit all edits before sentinel") or harness-side auto-recovery on pycache-only dirtiness. Prevents the most expensive failure mode of the run. Code change: `src/phases/interactive.ts:148` + skill update.
3. **Wrapper-skill self-audit step** before sentinel, on retries. Require the implementer to pre-grep the current artifact for the spec's own listed invariants before handing to the gate. Expected to cut gate-reject rounds from 3→2 or 2→1. Observed: every reject this run was legit and self-detectable.
4. **Encode the P1-only policy into the wrapper skill prompt.** Currently only in CLAUDE.md / user memory, so the runtime Claude treats all P1+P2 comments as blocking. Move into `harness-phase-{1,3}-*.md` Process steps.

**Priority 2:**

5. Control-pane footer with running elapsed + retry count + cumulative tokens (wire to `events.jsonl` tail). Without this, the user cannot notice a runaway until post-mortem.
6. Complexity hint from Phase 1 → Phase 3 so a vanilla CRUD doesn't generate a 1584-line plan.
7. Post-APPROVE `gate-N-feedback.md` replacement (currently retains stale reject content).

**Meta**: The harness *works* — it produced a passing todo CLI from a vague prompt, via legitimately-useful gate feedback loops. The gap is throughput efficiency, not correctness. A few small quality-of-life PRs will bring the 60-minute-budget scenario within reach for simple tasks.

## Next steps (this session)

- [x] `observations.md` written and committed (this file)
- [ ] Open PR against harness-cli for Priority-1 item #1 (Phase 1 preset relaxation) — see §"PR scope" below
- [ ] Record Priority-1 items #2 / #3 / #4 and Priority-2 items as GitHub issues (or FOLLOWUPS.md) so they are visible to the next dogfooding/engineering session

### PR scope (#1 only, kept narrow deliberately)

- `src/config.ts`: `PHASE_DEFAULTS[1]` and `LIGHT_PHASE_DEFAULTS[1]` from `'opus-max'` → `'opus-high'`
- Any tests that assert on the default preset string
- `CLAUDE.md`: update "실행 모드 defaults" / defaults summary accordingly
- Short README note if user-facing help / preset table changes

This keeps the blast radius to one identifier, which is safe to roll back if any regression shows up.

## Raw evidence

- events.jsonl: `~/.harness/sessions/0f7dd70d1f23/2026-04-18-build-a-terminal-based/events.jsonl`
- run dir: `~/Desktop/projects/harness/experimental-todo-full/.harness/2026-04-18-build-a-terminal-based/`
- git log (dogfood target): `ba60857..HEAD` in `~/Desktop/projects/harness/experimental-todo-full`
- final spec: `docs/specs/2026-04-18-build-a-terminal-based-design.md` (288 lines)
- final plan: `docs/plans/2026-04-18-build-a-terminal-based.md` (1584 lines)
- eval checklist: `.harness/2026-04-18-build-a-terminal-based/checklist.json` (15 checks)
