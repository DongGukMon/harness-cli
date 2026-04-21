# Auto Verification Report
- Date: 2026-04-21
- Related Spec: N/A
- Related Plan: N/A

## Results
| Check | Status | Detail |
|-------|--------|--------|
| lint | pass |  |
| test | pass |  |
| build | pass |  |

## Summary
- Total: 3 checks
- Pass: 3
- Fail: 0

## Raw Output

### lint
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

### test
**Command:** `pnpm vitest run`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

 RUN  v2.1.9 /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/cross-repo

 ✓ tests/state.test.ts (50 tests) 46ms
 ✓ tests/logger.test.ts (32 tests) 78ms
 ✓ tests/context/skills-rendering.test.ts (45 tests) 66ms
 ✓ tests/phases/runner-claude-resume.test.ts (13 tests) 58ms
 ✓ tests/phases/gate.test.ts (27 tests) 116ms
 ✓ tests/commands/inner.test.ts (22 tests) 262ms
 ✓ tests/runners/claude-usage.test.ts (17 tests) 168ms
 ✓ tests/integration/logging.test.ts (15 tests) 360ms
 ✓ tests/commands/footer-ticker.test.ts (10 tests) 161ms
 ✓ tests/phases/gate-resume.test.ts (13 tests) 243ms
[2J[H[2J[H[2J[H[2J[H[2J[H ✓ tests/signal.test.ts (16 tests) 630ms
[2J[H[2J[H[2J[H ✓ tests/lock.test.ts (20 tests) 436ms
 ✓ tests/phases/runner.test.ts (76 tests) 714ms
 ✓ tests/phases/terminal-ui.test.ts (17 tests) 208ms
 ✓ tests/metrics/footer-aggregator.test.ts (11 tests) 5ms
 ✓ tests/phases/verify.test.ts (14 tests) 46ms
 ✓ tests/orphan-cleanup.test.ts (20 tests) 70ms
 ✓ tests/runners/codex.test.ts (17 tests) 78ms
 ✓ tests/integration/light-flow.test.ts (4 tests) 191ms
 ✓ tests/preflight.test.ts (27 tests | 1 skipped) 216ms
 ✓ tests/integration/codex-session-resume.test.ts (6 tests) 59ms
 ✓ tests/resume-light.test.ts (10 tests) 42ms
 ✓ tests/commands/inner-footer.test.ts (2 tests) 21ms
 ✓ tests/phases/runner-token-capture.test.ts (6 tests) 20ms
 ✓ tests/runners/codex-resume.test.ts (8 tests) 56ms
 ✓ tests/context/assembler.test.ts (70 tests) 1909ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=1 trackedRepos[0].path===cwd → raw diff without ### repo: label 688ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=2 → diff sections with ### repo: label for each repo 594ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N>1 metadata uses "Harness implementation ranges (per tracked repo):" block 430ms
 ✓ tests/context/assembler-resume.test.ts (9 tests) 58ms
 ✓ tests/tmux.test.ts (33 tests) 816ms
   ✓ pollForPidFile > returns null on timeout when file never appears 403ms
   ✓ pollForPidFile > returns null when file contains non-numeric content 404ms
 ✓ tests/phases/interactive-watchdog.test.ts (6 tests) 9ms
[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H ✓ tests/ui.test.ts (8 tests) 4ms
 ✓ tests/phases/gate-feedback-archival.test.ts (2 tests) 67ms
 ✓ tests/runners/codex-isolation.test.ts (8 tests) 92ms
 ✓ tests/state-invalidation.test.ts (5 tests) 6ms
 ✓ tests/runners/claude.test.ts (4 tests) 5ms
 ✓ tests/phases/verdict.test.ts (16 tests) 7ms
 ✓ tests/commands/resume-cmd.test.ts (12 tests) 1875ms
 ✓ tests/root.test.ts (10 tests) 201ms
 ✓ tests/resume.test.ts (11 tests) 2876ms
   ✓ resumeRun > exits with code 1 and non-interactive message on paused run with null pendingAction (D4b) 570ms
   ✓ completeInteractivePhaseFromFreshSentinel — Phase 5 multi-repo (FR-8) > returns true and sets implHead when any repo advanced 306ms
 ✓ tests/commands/status-list.test.ts (7 tests) 633ms
 ✓ tests/context/reviewer-contract.test.ts (4 tests) 54ms
 ✓ tests/phases/gate-resume-escalation.test.ts (1 test) 48ms
 ✓ tests/ui-footer.test.ts (9 tests) 4ms
 ✓ tests/git.test.ts (20 tests) 1798ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-HaajgW/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-HaajgW/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-5lvcsh/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-5lvcsh/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-cqPPZe/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-cqPPZe/.claude/skills:
  phase-harness-codex-gate-review
No skills directory found at /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-tewLfk/.claude/skills. Nothing to uninstall.
 ✓ tests/uninstall-skills.test.ts (6 tests) 24ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-xF1fb4/.claude/skills:
  phase-harness-codex-gate-review
 ✓ tests/input.test.ts (12 tests) 3ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-UkMci2/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-DkXv0B/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-x7ITcc/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-UPK7ku/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-UPK7ku/.claude/skills:
  phase-harness-codex-gate-review
 ✓ tests/install-skills.test.ts (7 tests) 17ms
 ✓ tests/multi-worktree.test.ts (11 tests) 2471ms
   ✓ (a) depth=1 auto-detect — non-git outer cwd > detects exactly depth=1 git repos, skips non-git dirs 489ms
   ✓ (b) --track / --exclude flag combinations > --track replaces auto-detect 381ms
   ✓ (b) --track / --exclude flag combinations > --exclude removes from auto-detect 450ms
   ✓ (c) assembler diff concat for N=2 repos > includes ### repo: label for each repo in N=2 case 424ms
   ✓ (d) Phase 5 success: one-of-N advanced > returns true when only repo-a advanced in a 2-repo setup 503ms
 ✓ tests/integration/lifecycle.test.ts (11 tests) 1399ms
 ✓ tests/task-prompt.test.ts (7 tests) 2ms
[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H ✓ tests/ui-prompt-model-config.test.ts (3 tests) 4ms
 ✓ tests/terminal.test.ts (5 tests) 4ms
 ✓ tests/conformance/phase-models.test.ts (9 tests) 3ms
 ✓ tests/commands/jump.test.ts (6 tests) 774ms
 ✓ tests/preflight-claude-at-file.test.ts (2 tests) 3ms
 ✓ tests/ui-separator.test.ts (5 tests) 3ms
 ✓ tests/process.test.ts (6 tests) 25ms
 ✓ tests/config.test.ts (8 tests) 2ms
 ✓ tests/resolve-skills-root.test.ts (4 tests) 2ms
 ✓ tests/phases/interactive.test.ts (47 tests) 4295ms
   ✓ preparePhase — Phase 5 implRetryBase > updates implRetryBase to HEAD for Phase 5 303ms
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  claude session resume fallback: no prior attempt id
⚠️  carryover feedback path not found on disk, skipping: /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/sk-PXDUH8/phase-5-carryover-missing.md
⚠️  claude session resume fallback: no prior attempt id
⚠️  claude session resume fallback: no prior attempt id
⚠️  claude session resume fallback: jsonl missing
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
✓ Applied: skip. Phase loop re-entering.
ℹ Received control signal (SIGUSR1). Applying pending action...
✓ Applied: jump → phase 3. Phase loop re-entering.

Recent events:
(events.jsonl not present — logging disabled)

Working tree:
ℹ Received control signal (SIGUSR1). Applying pending action...
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

> phase-harness@0.3.0 build /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/cross-repo
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
