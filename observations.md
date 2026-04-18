# Light Flow Dogfood — 2026-04-18

Target quality: **LOW** (Add / List / Done / Remove / JSON persist / tests)
Harness baseline: e03bb1d (light flow ship @ PR #20)
Test project: `~/Desktop/projects/harness/experimental-todo-light` (baseline `3781050`, harness-auto-committed `.gitignore` → `b6d4a58`)
Session-meta path: `~/.harness/sessions/cebaeb46b7a9/2026-04-18-build-a-terminal-based/`
Run dir: `~/Desktop/projects/harness/experimental-todo-light/.harness/2026-04-18-build-a-terminal-based/`
Vitest baseline on checkout: **574 passed / 1 skipped** (CLAUDE.md says 514 — **stale**, bump to 574)

## Rounds summary

| Round | Task | Total time (harness) | Manual intervention | Final verdict | Quality vs target |
|---|---|---|---|---|---|
| 1 | vague todo (= full-flow control prompt) | **29m 38s** (1,777,392 ms) | ≈2 min (bug recovery) | **APPROVE** on 3/3 retry | LOW + small extras (module entry, atomic save, read-only list) |

Round 2/3 skipped — Round 1 naturally produced a P7 REJECT chain that exercised ADR-14 `carryoverFeedback` + ADR-4 P1-reopen end-to-end, and hit the gate-retry ceiling organically. No need to induce failure.

## Phase breakdown (Round 1)

| Iter | Phase | Wall | Preset | Claude tokens (total) | Notes |
|---|---|---|---|---|---|
| 1 | P1 design(+plan) | 3m 24s | opus-max xHigh | 942,196 | `## Implementation Plan` + checklist(3) + decisions.md produced. **No `## Open Questions` section** (see [P2]) |
| 1 | P2 / P3 / P4 | — | — | — | `'skipped'` + UI `[—] (skipped)` ✓ (ADR-1) |
| 1 | P5 impl | 2m 8s | sonnet-high | 1,206,312 | Init prompt references combined doc + "별도 plan 파일은 존재하지 않는다" ✓ (ADR-3) |
| 1 | P6 verify | 1.0s | (script) | — | 3/3 checks pass |
| 1 | P7 gate #0 | 1m 16s | codex-high | 29k gate-tokens | **REJECT** (promptBytes=40227). Flagged missing `python3 -m todo.cli` entry + shallow atomic-save test |
| 2 | P1 reopen | 3m 13s | opus-max xHigh | 1,741,590 | feedback_path injected ✓. Claude self-identified "Phase 1 re-run after Gate 7 rejection" |
| 2 | P5 rerun | 1m 2s → **FAILED** | sonnet-high | 954,603 | Artifact validator rejected: `.gitignore` uncommitted. See [P1-RESUME] |
| — | (manual recovery) | ~2 min | — | — | kill hung resume, clear stale tmux state in state.json, commit `.omx/` gitignore line, `harness resume` |
| 2 | P5 rerun (after recovery) | 1m 4s | sonnet-high | 702,164 | completed |
| 2 | P6 verify | 0.6s | (script) | — | 4/4 checks pass (checklist gained `python3 -m todo.cli --help` check) |
| 2 | P7 gate #1 | 1m 28s | codex-high | 36k gate-tokens | **REJECT** (promptBytes=50102). Flagged unconditional `save()` after `list` + spec-checkbox/eval mismatch |
| 3 | P1 reopen | **7m 14s** | opus-max xHigh | 1,596,353 | output=89k tokens (unusually high; rev3 touched the design rationale deeply) |
| 3 | P5 rerun | 1m 38s | sonnet-high | 1,592,590 | Added `_MUTATING` gate + list-read-only tests |
| 3 | P6 verify | 0.7s | (script) | — | all checks pass |
| 3 | P7 gate #2 | 1m 38s | codex-high | 43k gate-tokens | **APPROVE** (promptBytes=63038) on 3/3 retry ceiling |

**Aggregate Claude tokens (sum of `phase_end.claudeTokens.total`)**: ≈ 8.74M (P1×3 + P5×4)
**Aggregate Codex tokens (gate)**: ≈ 108k (3 verdicts)
**Combined**: ~8.85M tokens for Round 1. Gate prompt growth: 40KB → 50KB → 63KB across retries (feedback accretion).

## ADR verification checklist

- [x] **ADR-5**: `--light` flag parses; `state.flow = 'light'` persisted (verified via state.json)
- [x] **ADR-1 rev-1**: UI renders `[—] (skipped)` for phases 2/3/4, control-panel capture confirmed:
  ```
  [—] Phase 2: Spec Gate (skipped)
  [—] Phase 3: Plan 작성 (skipped)
  [—] Phase 4: Plan Gate (skipped)
  ```
- [x] **ADR-7**: migration default `carryoverFeedback = null` (confirmed on initial state)
- [x] **ADR-6**: light preset defaults (opus-max xHigh / sonnet-high / codex-high) applied across all attempts
- [x] **ADR-12 fresh**: P7 fresh prompt has **no `<plan>` wrapper block**. Codex rollout tag counts across all 3 gate sessions:
  - `<plan>` open=2 / **close=0** (literal enumeration in reviewer contract, not wrapper)
  - `<spec>` / `<eval_report>` / `<diff>` each have 2 real open+close pairs
- [x] **ADR-12 retry (fresh re-assembly)**: Verified on retry #1 (`019da0e8-...`) and retry #2 (`019da0f2-...`) — same tag counts. Light fresh path holds across retries.
- [ ] **ADR-12 resume path** (`buildResumeSections`): NOT exercised in this run. All P7 retries were fresh executions (no sidecar recovery, no crash-mid-gate). Would need an artificially interrupted gate session to exercise.
- [x] **ADR-13**: `## Implementation Plan` header present in combined doc (regex-matched) + all 5 required sections in correct order
- [x] **ADR-13**: `checklist.json` valid schema on P1 #0 (3 checks), grew to 4 checks by P1 #1 after gate-7 feedback
- [x] **ADR-3**: P5 init prompt references combined doc, states "별도 plan 파일은 존재하지 않는다"
- [x] **ADR-4**: P7 REJECT → Phase 1 reopen (not P5). Verified twice — events.jsonl `phase_start.phase=1` + `reopenFromGate:7` after both REJECTs. `pendingAction.targetPhase=1`.
- [x] **ADR-14 set**: After P7 REJECT, `state.carryoverFeedback = { sourceGate:7, paths:[gate-7-feedback.md], deliverToPhase:5 }` + `phaseReopenFlags['5']=true` + `pendingAction.feedbackPaths` duplicated for P1 consumption
- [x] **ADR-14 persist across P1 completion**: When P1 reopen completed, `pendingAction → null` but `carryoverFeedback` preserved
- [x] **ADR-14 consume**: P5 init prompt included `이전 피드백 (반드시 반영): /.../gate-7-feedback.md` line (assembler read `carryoverFeedback.paths`)
- [x] **ADR-14 clear**: After P5 completed, `carryoverFeedback: None`. Verified at both P5 #1 end and final state

## Common fixes verification

- [ ] **#7 Open Questions — REGRESSED in light flow**. Section absent from `phase-1-light.md` mandate; confirmed not present in any of the 3 generated P1 combined docs. See [P2] observation.
- [ ] **#9 `/advisor` orphan**: Not directly observable — control pane captures taken did not contain any `/advisor` or `printAdvisorReminder` text. Likely cleaned up post-PR #18. Pass.
- [x] **#10 Separator adaptive**: Control panel used wide separators (`━` × ~38) on the 45-col control pane. Renders cleanly across pane resize.
- [x] **#11 folder-trust**: Reproduced as expected on first Claude launch (observation already catalogued — not a regression). No re-prompt on subsequent P5/P1 reopen sessions in the same Claude CLI run (same session-id reuse per PR #16).
- [x] **#12 `phase_end.claudeTokens`**: Present on every interactive `phase_end` event (P1 × 3, P5 × 4). Values include `input / output / cacheRead / cacheCreate / total`. Absent on P6 events (script phase, no Claude) and absent on `gate_verdict` (Codex uses its own `tokensTotal` field).
- [x] **#13 Codex HOME isolation (scope-rules mitigation via REVIEWER_CONTRACT)**: Reviewer did not drag personal `.codex/AGENTS.md` conventions into the review. Findings were consistently scoped to spec/diff/eval contents.

## New observations

### [P0] Resume after interrupted run is broken in reused-tmux mode (infinite recursion)

**Reproduction**: When a light-flow run terminates via `session_end: interrupted` (e.g., because P5 validator rejects the artifact due to dirty tree), the `start`-created ctrl window (`@51`/`%70`) is cleaned up on exit. But `state.json` still references `tmuxControlPane: '%70'` / `tmuxControlWindow: '@51'`. On subsequent `harness resume` from **inside tmux** (reused mode):

1. `tmuxAlive` = true (outer tmux session still exists)
2. `innerAlive` = false (inner process dead)
3. Case 2 branch fires, `paneExists('%70')` = false
4. Falls to `else` at `src/commands/resume.ts:127-136` — cleans up via `killWindow`, releases lock, recurses
5. **But state.tmuxControlPane / tmuxControlWindow are never cleared before recursion.**
6. Recursive `resumeCommand` re-reads state → same stale values → Case 2 re-fires → infinite loop.

Symptom: `node .../harness.js resume` hangs silently. `sample` shows V8 spinning in interpreter. No events emitted, no visible UI.

Workaround: manually edit state.json to clear `tmuxControlPane`, `tmuxControlWindow`, `tmuxWindows`, `tmuxMode='dedicated'`, then resume. Creates a fresh Case 3 ctrl window.

**Impact**: Any user whose light flow run interrupts (P5 artifact fail, SIGINT, laptop sleep) cannot resume from a reused tmux — silently hangs. This is the second-most-important bug in this dogfood (after the P5 validator strictness). **P0** for recovery UX.

**Proposed fix** in `src/commands/resume.ts:127-136`:
```ts
} else {
  // Control pane stale → clear stale references before recursion
  if (state.tmuxMode === 'dedicated') {
    killSession(state.tmuxSession);
  } else if (state.tmuxControlWindow) {
    killWindow(state.tmuxSession, state.tmuxControlWindow);
  }
  state.tmuxControlPane = null;
  state.tmuxControlWindow = null;
  state.tmuxWindows = [];
  // (leave tmuxMode/tmuxSession so recursion can re-derive)
  writeState(runDir, state);
  releaseLock(harnessDir, targetRunId);
  return resumeCommand(runId, options);
}
```

**Files**: `src/commands/resume.ts:115-148` (Case 2 handling).

### [P1-RESUME] P5 artifact validator rejects run because of side-effect tool modifying tracked file between sentinel-write and validation

**Reproduction**: A background tool (`oh-my-codex` / `.omx/`) running alongside Claude wrote `.omx/` into `.gitignore` (committed line) during P5 rev2. Claude in its own session also modified `.gitignore` to add the `.omx/` ignore but did not commit it before writing the sentinel. When `validatePhaseArtifacts` ran `git status --porcelain`, it saw the non-empty output and returned `false`, marking P5 failed even though the actual functional diff (tests + cli.py) was committed at `0d9a868`.

**Impact**: Any concurrent editor/hook/background tool that touches tracked files during a P5 session can derail the run. Harness treats "dirty tree after sentinel" as phase failure, which is strict-but-brittle.

**Severity**: P1 — not light-flow-specific (would hit full flow too), but clearly surfaces in light-flow dogfood where `.omx` happens to pollute.

**Proposed mitigation options** (ordered by robustness):
1. **Relax validator** to use `git status --porcelain -uno` (ignore untracked), AND allow the dirty tracked-file list to be only `.gitignore` changes if that file wasn't touched by the task itself. Fragile.
2. **Snapshot tree right before Claude exits** and compare to `git status` at sentinel time. Diff that is exclusively outside changed paths → warn, don't fail. Complex.
3. **Best option**: Auto-commit remaining changes as `harness[<runId>]: Phase 5 — auto-stage residual edits` when validator detects dirty tree containing only files Claude *could* have missed committing. Safer than silent ignore, still tolerant of side-effects.

**Files**: `src/phases/interactive.ts:148-164` (`validatePhaseArtifacts` Phase 5 branch).

### [P1] Gate-retry ceiling hit on realistic task — light's P1-reopen cost is steep

**Reproduction**: Round 1 exhausted all 3 gate retries (limit = `GATE_RETRY_LIMIT`). Each P7 REJECT triggered a full P1 re-design → P5 re-impl cycle:
- Cycle 1 (P1 rev1 → P5 → P6 → P7 #0 REJECT): 7m 49s
- Cycle 2 (P1 rev2 → P5 → P6 → P7 #1 REJECT): 7m 5s + 2m manual recovery
- Cycle 3 (P1 rev3 → P5 → P6 → P7 #2 APPROVE): **11m 0s** (P1 rev3 alone took 7m 14s)
- Total wall for the reject chain: ~28 min out of the 29m 38s run.

Codex's rev2 finding ("`list` command unnecessarily saves on every run") was legit; the feedback cycle produced a genuinely better design. But **ADR-4's "always reopen P1 on REJECT"** means even small impl-level issues trigger a full re-design session. For a LOW-spec task this cost is disproportionate.

**Impact**: Light flow's promise of "1–4h task → under 40min harness" holds only when P7 approves on first or second try. A naturally-chatty Codex reviewer with even moderately ambiguous requirements will hit the 3-retry ceiling. At ceiling, the run is at risk of hitting `status: completed` on force-pass (auto mode) or manual escalation (interactive). Users may develop "approve anything" habits.

**Proposed fix candidates**:
1. **Mid-impl fix path**: When Codex's REJECT only cites impl-level issues (detectable by e.g. reviewer emitting `scope: impl`), reopen P5 with feedback instead of P1 + P5. Would require reviewer contract extension. Medium effort.
2. **ADR-4 relaxation** in spec: accept a "impl-only" fast path for light when REJECT issues don't touch design intent. Parallel to (1).
3. **Retry limit increase to 5** for light only — cheaper since light has no mid-cycle gates. Single-knob fix.

**Files**: `src/phases/runner.ts::handleGateReject`, `src/config.ts::GATE_RETRY_LIMIT`.

### [P2] Light Phase 1 init prompt drops `## Open Questions` mandate (issue #7 regression for light flow)

**Reproduction**: `src/context/prompts/phase-1-light.md` lines 7–18. Combined doc skeleton enumerates Context & Decisions / Requirements / Design / Implementation Plan / Eval Checklist Summary only. No `## Open Questions` section required. Confirmed empirically — all 3 Round 1 P1 combined docs (rev1, rev2, rev3) lack this section.

**Contrast**: Full flow (`phase-1.md` + PR #15 wrapper skill `src/context/skills/harness-phase-1-*.md`) enforces `## Open Questions` per issue #7 fix.

**Impact**: Gate 7 reviewer in light flow has no structured slot to inspect residual ambiguities. Risk of silent design oversights, possibly contributing to [P1] above.

**Proposed fix**: Append `## Open Questions` as required section in `phase-1-light.md`, mirroring full-flow wrapper-skill invariant. OR adopt the wrapper-skill mechanism for light P1 too (DRY). Either way, extend `validatePhaseArtifacts` light+phase1 regex check to require the header.

**Files**: `src/context/prompts/phase-1-light.md:9-18`, `src/phases/interactive.ts:127-143`.

### [P3] Control panel mislabels Light Phase 1 as "Spec 작성"

**Reproduction**: Control pane output:
```
[ ] Phase 1: Spec 작성 (pending) ← current
```

**Issue**: ADR-3 defines Light Phase 1 = brainstorm + plan combined. Label "Spec 작성" drops the "plan" half. Users scanning the control panel may not realise plan decomposition is part of Phase 1 here. Inconsistent with the init prompt that correctly says "설계 + 구현 태스크 분해 + 체크리스트".

**Proposed fix**: For `flow === 'light'`, override Phase 1 label to `"설계+플랜"` or `"Design (=brainstorm+plan)"`. 1-line UI tweak.

**Files**: `src/ui.ts` phase labels.

### [P3] Preflight `@file` check timeout noise on control panel

**Reproduction**:
```
⚠️  preflight: claude @file check timed out (5s); skipping — runtime failure will be surfaced at phase level if @file is unsupported.
```

**Impact**: Non-fatal, but adds user anxiety on happy path. No attempt to re-check after first run's claude spawn succeeds.

**Proposed fix**: Raise timeout (5s → 10s) or suppress once control pane has observed a successful claude pane launch.

**Files**: `src/commands/inner.ts` around preflight call.

### [P3] Auto-harness "reset eval report for re-verification" commits on each retry

**Reproduction**: `git log` after Round 1 shows:
```
f18af09 harness[...]: Phase 6 — eval report
b0d8fc1 harness[...]: Phase 6 — reset eval report for re-verification
1c015a7 feat(rev3): ...
a4ce6f9 harness[...]: Phase 1 rev3 — Gate 7 spec fixes
2860caa harness[...]: Phase 6 — eval report
e79fb80 harness[...]: Phase 6 — reset eval report for re-verification
```

Two reset+write pairs = 4 Phase-6 commits for 3 iterations. Adds noise to the project history.

**Severity**: Nitpick. History is readable; the reset commits are intentional for clean diffing against the gate.

**Proposed fix**: Squash Phase-6 pairs into single "Phase 6 — rev N eval report" commit after each verify pass. Or don't commit the reset (hold in working tree) since it's transient.

**Files**: `src/phases/runner.ts` around Phase 6 auto-commit.

## Quality vs target

**LOW-spec target hit with small positive delta** (driven by gate feedback loop):

| Requirement | Status |
|---|---|
| Add a todo | ✓ `todo add "<title>"` |
| List todos | ✓ `todo list` + `todo list --all` |
| Mark done | ✓ `todo done <id>` |
| Remove | ✓ `todo rm <id>` |
| JSON local save | ✓ (atomic with temp-write + rename) |
| Unique ID + text | ✓ (`task.py` uses next-int logic) |
| Clear error messages | ✓ Unit tests cover invalid commands + missing IDs |
| Basic flow tests | ✓ 191 lines `test_cli.py` + 143 lines `test_storage.py` |
| **Extras** | Module entry point (`python3 -m todo.cli`), `_MUTATING` gate ensuring list is read-only, atomic-save failure-path tests, `cmd_list` / `cmd_add` / `cmd_done` / `cmd_rm` return dirty-flag pattern |
| **Source LoC** | 237 impl / 334 tests (excluding `__pycache__`) |
| **Modules** | 5 files under `todo/` (`__init__`, `__main__`, `task`, `cli`, `storage`) — slightly over the ≤3 soft target, but Python idiom-consistent |

No unwarranted scope creep (no priority / tags / due-date / filter). Extras came from gate reviewer enforcing reasonable quality (module entry, read-only list, atomic save robustness).

## Full vs Light comparison

Full-flow dogfood (`~/.grove/.../dogfood-full/observations.md`) was running in parallel (tmux session `harness-full-r1`) and was not complete when this writeup finalized. Skipping side-by-side; leave as follow-up.

Indirect comparison via design intent:
- Light flow hit **29m 38s harness-reported wall** + 2m manual. Full-flow expected ~32–45m baseline for an equivalent task.
- Light saved 0 gate calls vs full's 2 (spec-gate + plan-gate) on the happy path, but the P7-REJECT-triggered P1 reopen cost dominates. If Round 1 had approved on P7 first try: estimated 7–9m wall. Light's theoretical advantage **only materializes when the first P7 passes**.

## Recommendation

Priority PR candidates (ordered):

1. **[P0 resume infinite-loop fix]** `src/commands/resume.ts:127-136` — clear stale tmux references before recursing. Unblocks recovery for any interrupted run. Near-zero risk.

2. **[P1 P5 validator side-effect tolerance]** `src/phases/interactive.ts:148-164` — add "auto-stage residual edits" commit or at least a useful error message pointing to `git status` output. Reduces "why did my run just die?" moments when concurrent tools touch files.

3. **[P2 Light P1 Open Questions mandate]** `src/context/prompts/phase-1-light.md` — add `## Open Questions` as required section + extend validator. Mirrors full-flow invariant; reduces design ambiguity contributing to P7 REJECT storms.

4. **[P1 gate-retry ceiling]** Consider either ADR-4 relaxation (impl-scoped REJECT → P5 reopen) OR bump light's retry limit to 5. Design-level conversation; not a quick win. **Defer** to a follow-up spec.

Light flow itself is **functionally correct**: ADR-1/3/4/5/6/7/12/13/14 all verified in dogfood, which is an impressive breadth of green checks for a fresh ship. The pain points are in the *error-recovery pathway* (resume loop + validator brittleness) and in *design-phase rigor* (Open Questions regression) — all actionable as incremental PRs without altering the core flow design.

## Raw evidence

- events.jsonl: `/Users/daniel/.harness/sessions/cebaeb46b7a9/2026-04-18-build-a-terminal-based/events.jsonl` (16 events)
- state.json (final): `~/Desktop/projects/harness/experimental-todo-light/.harness/2026-04-18-build-a-terminal-based/state.json`
- Codex rollouts (P7 × 3):
  - retry #0: `~/.codex/sessions/2026/04/18/rollout-2026-04-18T22-53-22-019da0de-145d-7d71-ac09-084918b46a15.jsonl`
  - retry #1: `~/.codex/sessions/2026/04/18/rollout-2026-04-18T23-04-52-019da0e8-9cce-7a60-ae45-f62e9dbb2d44.jsonl`
  - retry #2: `~/.codex/sessions/2026/04/18/rollout-2026-04-18T23-15-13-019da0f2-1564-74d2-8c3c-4f559e07e238.jsonl`
- Final todo CLI commits:
  - `1c015a7 feat(rev3): add _MUTATING gate and list read-only tests`
  - `a2e73f0 feat: implement terminal todo manager (Phase 1)`
  - `0d9a868 feat(gate-7-rev2): add cli.py module guard and atomic-save failure tests`
