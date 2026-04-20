# Auto Verification Report
- Date: 2026-04-20
- Related Spec: N/A
- Related Plan: N/A

## Results
| Check | Status | Detail |
|-------|--------|--------|
| typecheck | pass |  |
| tests | pass |  |
| build | pass |  |
| multi-worktree tests | pass |  |

## Summary
- Total: 4 checks
- Pass: 4
- Fail: 0

## Raw Output

### typecheck
**Command:** `pnpm tsc --noEmit`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```

```

</details>

### tests
**Command:** `pnpm vitest run`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

 RUN  v2.1.9 /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/code1

 ✓ tests/state.test.ts (50 tests) 62ms
 ✓ tests/logger.test.ts (32 tests) 143ms
 ✓ tests/phases/runner-claude-resume.test.ts (13 tests) 87ms
 ✓ tests/context/skills-rendering.test.ts (45 tests) 157ms
 ✓ tests/phases/gate.test.ts (27 tests) 166ms
 ✓ tests/runners/claude-usage.test.ts (17 tests) 162ms
 ✓ tests/commands/inner.test.ts (22 tests) 344ms
 ✓ tests/integration/logging.test.ts (15 tests) 353ms
 ✓ tests/commands/footer-ticker.test.ts (10 tests) 178ms
[2J[H ✓ tests/phases/gate-resume.test.ts (13 tests) 219ms
 ✓ tests/signal.test.ts (16 tests) 552ms
[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H ✓ tests/lock.test.ts (20 tests) 310ms
 ✓ tests/phases/terminal-ui.test.ts (17 tests) 120ms
 ✓ tests/metrics/footer-aggregator.test.ts (11 tests) 7ms
 ✓ tests/phases/runner.test.ts (76 tests) 684ms
 ✓ tests/runners/codex.test.ts (17 tests) 81ms
 ✓ tests/orphan-cleanup.test.ts (20 tests) 24ms
 ✓ tests/preflight.test.ts (27 tests | 1 skipped) 277ms
 ✓ tests/integration/codex-session-resume.test.ts (6 tests) 104ms
 ✓ tests/integration/light-flow.test.ts (4 tests) 255ms
 ✓ tests/resume-light.test.ts (10 tests) 20ms
 ✓ tests/phases/runner-token-capture.test.ts (6 tests) 9ms
 ✓ tests/commands/inner-footer.test.ts (2 tests) 25ms
 ✓ tests/runners/codex-resume.test.ts (8 tests) 62ms
 ✓ tests/phases/verify.test.ts (12 tests) 15ms
 ✓ tests/tmux.test.ts (33 tests) 815ms
   ✓ pollForPidFile > returns null on timeout when file never appears 403ms
   ✓ pollForPidFile > returns null when file contains non-numeric content 403ms
 ✓ tests/context/assembler.test.ts (67 tests) 1835ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=1 trackedRepos[0].path===cwd → raw diff without ### repo: label 446ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=2 → diff sections with ### repo: label for each repo 604ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N>1 metadata uses "Harness implementation ranges (per tracked repo):" block 501ms
 ✓ tests/phases/interactive-watchdog.test.ts (6 tests) 9ms
 ✓ tests/context/assembler-resume.test.ts (9 tests) 94ms
 ✓ tests/phases/gate-feedback-archival.test.ts (2 tests) 56ms
 ✓ tests/runners/codex-isolation.test.ts (8 tests) 36ms
[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H ✓ tests/ui.test.ts (8 tests) 4ms
 ✓ tests/state-invalidation.test.ts (5 tests) 8ms
 ✓ tests/commands/resume-cmd.test.ts (12 tests) 2001ms
 ✓ tests/runners/claude.test.ts (4 tests) 8ms
 ✓ tests/phases/verdict.test.ts (16 tests) 3ms
 ✓ tests/root.test.ts (10 tests) 157ms
 ✓ tests/resume.test.ts (11 tests) 2667ms
   ✓ resumeRun > exits with code 1 and non-interactive message on paused run with null pendingAction (D4b) 306ms
   ✓ resumeRun > skip_phase Phase 6 with gitignored eval report: skips commit and leaves evalCommit null 347ms
 ✓ tests/context/reviewer-contract.test.ts (4 tests) 69ms
 ✓ tests/commands/status-list.test.ts (7 tests) 635ms
 ✓ tests/phases/gate-resume-escalation.test.ts (1 test) 51ms
 ✓ tests/ui-footer.test.ts (9 tests) 4ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-2JIWts/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-2JIWts/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-udHKFt/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-DHnQkK/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-DHnQkK/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-mOFi6z/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-B01P0T/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-B01P0T/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-G8vGIc/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-GjLWgA/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-BoZSUq/.claude/skills:
  phase-harness-codex-gate-review
No skills directory found at /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-CUwuQn/.claude/skills. Nothing to uninstall.
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-BoZSUq/.claude/skills:
  phase-harness-codex-gate-review
 ✓ tests/uninstall-skills.test.ts (6 tests) 41ms
 ✓ tests/install-skills.test.ts (7 tests) 32ms
 ✓ tests/commands/jump.test.ts (6 tests) 756ms
 ✓ tests/task-prompt.test.ts (7 tests) 2ms
 ✓ tests/input.test.ts (12 tests) 7ms
 ✓ tests/integration/lifecycle.test.ts (11 tests) 1376ms
 ✓ tests/git.test.ts (20 tests) 1904ms
 ✓ tests/multi-worktree.test.ts (10 tests) 2731ms
   ✓ (a) depth=1 auto-detect — non-git outer cwd > detects exactly depth=1 git repos, skips non-git dirs 527ms
   ✓ (b) --track / --exclude flag combinations > --track replaces auto-detect 557ms
   ✓ (b) --track / --exclude flag combinations > --exclude removes from auto-detect 415ms
   ✓ (c) assembler diff concat for N=2 repos > includes ### repo: label for each repo in N=2 case 429ms
   ✓ (d) Phase 5 success: one-of-N advanced > returns true when only repo-a advanced in a 2-repo setup 551ms
 ✓ tests/terminal.test.ts (5 tests) 3ms
[2J[H[2J[H ✓ tests/phases/interactive.test.ts (47 tests) 4134ms
   ✓ runInteractivePhase — Claude dispatch command shape > sendKeysToPane command includes --dangerously-skip-permissions and --effort 1587ms
   ✓ validatePhaseArtifacts — Phase 5 multi-repo (FR-6, ADR-D4) > returns true when any repo advanced; sets implHead on advanced repos only 523ms
[2J[H[2J[H[2J[H[2J[H[2J[H ✓ tests/ui-prompt-model-config.test.ts (3 tests) 32ms
 ✓ tests/preflight-claude-at-file.test.ts (2 tests) 3ms
 ✓ tests/conformance/phase-models.test.ts (9 tests) 3ms
 ✓ tests/process.test.ts (6 tests) 132ms
 ✓ tests/artifact.test.ts (14 tests) 3528ms
   ✓ normalizeArtifactCommit > creates commit for new untracked file 344ms
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  claude session resume fallback: no prior attempt id
⚠️  claude session resume fallback: no prior attempt id
⚠️  claude session resume fallback: no prior attempt id
⚠️  claude session resume fallback: jsonl missing
⚠️  carryover feedback path not found on disk, skipping: /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/sk-ZtLbUv/phase-5-carryover-missing.md
⚠️  claude session resume fallback: jsonl missing
⚠️  claude session resume fallback: jsonl missing
⚠️  claude session resume fallback: jsonl missing
⚠️  claude session resume fallback: jsonl missing
⚠️  claude session resume fallback: no prior attempt id
⚠️  claude session resume fallback: no prior attempt id
⚠️  claude session resume fallback: no prior attempt id
⚠️  claude session resume fallback: jsonl missing
⚠️  claude session resume fallback: no prior attempt id
⚠️  claude session resume fallback: no prior attempt id
fatal: not a git repository (or any of the parent directories): .git
ℹ Received control signal (SIGUSR1). Applying pending action...
✓ Applied: skip. Phase loop re-entering.
ℹ Received control signal (SIGUSR1). Applying pending action...
✓ Applied: jump → phase 3. Phase loop re-entering.

Recent events:
(events.jsonl not present — logging disabled)

Working tree:
(git not available)

[R] Resume   [J] Jump to phase   [Q] Quit
ℹ Received control signal (SIGUSR1). Applying pending action...

Recent events:
(events.jsonl not present — logging disabled)

Working tree:
(git not available)

[R] Resume   [J] Jump to phase   [Q] Quit

Recent events:
(events.jsonl not present — logging disabled)

Working tree:
(git not available)

[R] Resume   [J] Jump to phase   [Q] Quit

Recent events:
(events.jsonl not present — logging disabled)
```

</details>

### build
**Command:** `pnpm build`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

> phase-harness@0.2.5 build /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/code1
> tsc -p tsconfig.build.json && node scripts/copy-assets.mjs

[copy-assets] copied src/context/prompts -> dist/src/context/prompts
[copy-assets] copied src/context/skills -> dist/src/context/skills
[copy-assets] copied src/context/skills-standalone -> dist/src/context/skills-standalone
[copy-assets] copied src/context/playbooks -> dist/src/context/playbooks
[copy-assets] copied scripts/harness-verify.sh -> dist/scripts/harness-verify.sh
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```

```

</details>

### multi-worktree tests
**Command:** `pnpm vitest run tests/multi-worktree.test.ts`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

 RUN  v2.1.9 /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/code1

 ✓ tests/multi-worktree.test.ts (10 tests) 1251ms

 Test Files  1 passed (1)
      Tests  10 passed (10)
   Start at  23:16:54
   Duration  1.52s (transform 77ms, setup 0ms, collect 99ms, tests 1.25s, environment 0ms, prepare 30ms)
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```

```

</details>
