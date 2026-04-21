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

 ✓ tests/state.test.ts (50 tests) 35ms
 ✓ tests/context/skills-rendering.test.ts (45 tests) 37ms
 ✓ tests/logger.test.ts (32 tests) 57ms
 ✓ tests/phases/gate.test.ts (27 tests) 74ms
 ✓ tests/phases/runner-claude-resume.test.ts (13 tests) 43ms
 ✓ tests/commands/inner.test.ts (22 tests) 242ms
 ✓ tests/runners/claude-usage.test.ts (17 tests) 208ms
 ✓ tests/integration/logging.test.ts (15 tests) 334ms
 ✓ tests/commands/footer-ticker.test.ts (10 tests) 183ms
[2J[H[2J[H[2J[H[2J[H ✓ tests/phases/gate-resume.test.ts (13 tests) 241ms
[2J[H[2J[H[2J[H[2J[H ✓ tests/phases/terminal-ui.test.ts (17 tests) 108ms
 ✓ tests/signal.test.ts (16 tests) 533ms
 ✓ tests/lock.test.ts (20 tests) 323ms
 ✓ tests/phases/runner.test.ts (76 tests) 571ms
 ✓ tests/metrics/footer-aggregator.test.ts (11 tests) 9ms
 ✓ tests/orphan-cleanup.test.ts (20 tests) 12ms
 ✓ tests/runners/codex.test.ts (17 tests) 103ms
 ✓ tests/phases/verify.test.ts (14 tests) 17ms
 ✓ tests/preflight.test.ts (27 tests | 1 skipped) 204ms
 ✓ tests/integration/light-flow.test.ts (4 tests) 216ms
 ✓ tests/integration/codex-session-resume.test.ts (6 tests) 56ms
 ✓ tests/resume-light.test.ts (10 tests) 10ms
 ✓ tests/phases/runner-token-capture.test.ts (6 tests) 5ms
 ✓ tests/commands/inner-footer.test.ts (2 tests) 12ms
 ✓ tests/runners/codex-resume.test.ts (8 tests) 63ms
 ✓ tests/tmux.test.ts (33 tests) 812ms
   ✓ pollForPidFile > returns null on timeout when file never appears 403ms
   ✓ pollForPidFile > returns null when file contains non-numeric content 402ms
 ✓ tests/context/assembler-resume.test.ts (9 tests) 66ms
 ✓ tests/context/assembler.test.ts (72 tests) 1731ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=1 trackedRepos[0].path===cwd → raw diff without ### repo: label 409ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=2 → diff sections with ### repo: label for each repo 550ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N>1 metadata uses "Harness implementation ranges (per tracked repo):" block 442ms
 ✓ tests/phases/interactive-watchdog.test.ts (6 tests) 8ms
 ✓ tests/phases/gate-feedback-archival.test.ts (2 tests) 63ms
 ✓ tests/runners/codex-isolation.test.ts (8 tests) 61ms
[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H ✓ tests/ui.test.ts (8 tests) 7ms
 ✓ tests/state-invalidation.test.ts (5 tests) 6ms
 ✓ tests/runners/claude.test.ts (4 tests) 9ms
 ✓ tests/phases/verdict.test.ts (16 tests) 3ms
 ✓ tests/commands/resume-cmd.test.ts (12 tests) 2050ms
   ✓ resumeCommand > resumeCommand — loggingEnabled inheritance > resume defaults to false when state has loggingEnabled=false 325ms
 ✓ tests/root.test.ts (10 tests) 149ms
 ✓ tests/resume.test.ts (11 tests) 2884ms
   ✓ resumeRun > exits with code 1 and non-interactive message on paused run with null pendingAction (D4b) 360ms
   ✓ resumeRun > skip_phase Phase 6 with gitignored eval report: skips commit and leaves evalCommit null 388ms
   ✓ completeInteractivePhaseFromFreshSentinel — Phase 5 multi-repo (FR-8) > returns true and sets implHead when any repo advanced 440ms
 ✓ tests/commands/status-list.test.ts (7 tests) 650ms
 ✓ tests/context/reviewer-contract.test.ts (4 tests) 62ms
 ✓ tests/ui-footer.test.ts (9 tests) 4ms
 ✓ tests/phases/gate-resume-escalation.test.ts (1 test) 39ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-Ln7sz4/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-dV31q3/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-VlI1IE/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-meGt3h/.claude/skills:
  phase-harness-codex-gate-review
 ✓ tests/git.test.ts (20 tests) 2130ms
   ✓ isAncestor > returns false when not an ancestor 377ms
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-meGt3h/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-ve4ceJ/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-e1lJBv/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-cYWmCi/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-e1lJBv/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-cYWmCi/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-FKwBrf/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-FKwBrf/.claude/skills:
  phase-harness-codex-gate-review
No skills directory found at /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-JKACcO/.claude/skills. Nothing to uninstall.
 ✓ tests/install-skills.test.ts (7 tests) 31ms
 ✓ tests/uninstall-skills.test.ts (6 tests) 19ms
 ✓ tests/multi-worktree.test.ts (11 tests) 2752ms
   ✓ (a) depth=1 auto-detect — non-git outer cwd > detects exactly depth=1 git repos, skips non-git dirs 502ms
   ✓ (b) --track / --exclude flag combinations > --track replaces auto-detect 432ms
   ✓ (b) --track / --exclude flag combinations > --exclude removes from auto-detect 680ms
   ✓ (c) assembler diff concat for N=2 repos > includes ### repo: label for each repo in N=2 case 361ms
   ✓ (d) Phase 5 success: one-of-N advanced > returns true when only repo-a advanced in a 2-repo setup 547ms
 ✓ tests/integration/lifecycle.test.ts (11 tests) 1249ms
 ✓ tests/input.test.ts (12 tests) 4ms
 ✓ tests/task-prompt.test.ts (7 tests) 3ms
 ✓ tests/commands/jump.test.ts (6 tests) 795ms
 ✓ tests/terminal.test.ts (5 tests) 2ms
[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H ✓ tests/ui-prompt-model-config.test.ts (3 tests) 5ms
 ✓ tests/preflight-claude-at-file.test.ts (2 tests) 4ms
 ✓ tests/phases/interactive.test.ts (47 tests) 4019ms
   ✓ runInteractivePhase — Claude dispatch command shape > sendKeysToPane command includes --dangerously-skip-permissions and --effort 1617ms
   ✓ validatePhaseArtifacts — Phase 5 multi-repo (FR-6, ADR-D4) > returns true when any repo advanced; sets implHead on advanced repos only 538ms
 ✓ tests/conformance/phase-models.test.ts (9 tests) 3ms
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  carryover feedback path not found on disk, skipping: /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/sk-tmDIxc/phase-5-carryover-missing.md
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  claude session resume fallback: no prior attempt id
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

Working tree:
(git not available)

[R] Resume   [J] Jump to phase   [Q] Quit
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
