# Auto Verification Report
- Date: 2026-04-24
- Related Spec: N/A
- Related Plan: N/A

## Results
| Check | Status | Detail |
|-------|--------|--------|
| typecheck | pass |  |
| unit-artifact | pass |  |
| unit-verify-phase | pass |  |
| full-test-suite | pass |  |
| build | pass |  |

## Summary
- Total: 5 checks
- Pass: 5
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

### unit-artifact
**Command:** `pnpm vitest run tests/artifact.test.ts`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

 RUN  v2.1.9 /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/bug-fix

 ✓ tests/artifact.test.ts (22 tests) 2959ms

 Test Files  1 passed (1)
      Tests  22 passed (22)
   Start at  02:12:30
   Duration  3.18s (transform 40ms, setup 0ms, collect 46ms, tests 2.96s, environment 0ms, prepare 32ms)
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```
fatal: not a git repository (or any of the parent directories): .git
```

</details>

### unit-verify-phase
**Command:** `pnpm vitest run tests/phases/verify.test.ts`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

 RUN  v2.1.9 /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/bug-fix

 ✓ tests/phases/verify.test.ts (14 tests) 10ms

 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  02:12:34
   Duration  217ms (transform 38ms, setup 0ms, collect 44ms, tests 10ms, environment 0ms, prepare 29ms)
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```

```

</details>

### full-test-suite
**Command:** `pnpm vitest run`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

 RUN  v2.1.9 /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/bug-fix

 ✓ tests/state.test.ts (50 tests) 63ms
 ✓ tests/context/skills-rendering.test.ts (45 tests) 107ms
 ✓ tests/phases/gate.test.ts (27 tests) 100ms
 ✓ tests/logger.test.ts (32 tests) 119ms
 ✓ tests/phases/runner-claude-resume.test.ts (13 tests) 50ms
 ✓ tests/commands/inner.test.ts (23 tests) 256ms
[2J[H[2J[H[2J[H[2J[H[2J[H ✓ tests/integration/logging.test.ts (15 tests) 296ms
[2J[H[2J[H[2J[H ✓ tests/phases/terminal-ui.test.ts (18 tests) 115ms
 ✓ tests/runners/claude-usage.test.ts (17 tests) 171ms
 ✓ tests/signal.test.ts (16 tests) 462ms
 ✓ tests/phases/gate-resume.test.ts (13 tests) 129ms
 ✓ tests/commands/footer-ticker.test.ts (10 tests) 57ms
 ✓ tests/lock.test.ts (20 tests) 251ms
 ✓ tests/phases/runner.test.ts (76 tests) 615ms
 ✓ tests/metrics/footer-aggregator.test.ts (11 tests) 7ms
 ✓ tests/orphan-cleanup.test.ts (20 tests) 20ms
 ✓ tests/phases/verify.test.ts (14 tests) 17ms
 ✓ tests/runners/codex.test.ts (17 tests) 83ms
 ✓ tests/preflight.test.ts (27 tests | 1 skipped) 183ms
 ✓ tests/integration/light-flow.test.ts (4 tests) 176ms
 ✓ tests/integration/codex-session-resume.test.ts (6 tests) 65ms
 ✓ tests/resume-light.test.ts (10 tests) 49ms
 ✓ tests/commands/inner-footer.test.ts (2 tests) 8ms
 ✓ tests/phases/runner-token-capture.test.ts (6 tests) 6ms
 ✓ tests/runners/codex-resume.test.ts (8 tests) 60ms
 ✓ tests/tmux.test.ts (33 tests) 818ms
   ✓ pollForPidFile > returns null on timeout when file never appears 403ms
   ✓ pollForPidFile > returns null when file contains non-numeric content 406ms
 ✓ tests/context/assembler.test.ts (72 tests) 1843ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=1 trackedRepos[0].path===cwd → raw diff without ### repo: label 425ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=2 → diff sections with ### repo: label for each repo 537ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N>1 metadata uses "Harness implementation ranges (per tracked repo):" block 587ms
 ✓ tests/context/assembler-resume.test.ts (9 tests) 136ms
 ✓ tests/phases/interactive-watchdog.test.ts (6 tests) 10ms
 ✓ tests/phases/gate-feedback-archival.test.ts (2 tests) 50ms
 ✓ tests/runners/codex-isolation.test.ts (8 tests) 53ms
 ✓ tests/state-invalidation.test.ts (5 tests) 10ms
 ✓ tests/commands/resume-cmd.test.ts (12 tests) 2009ms
   ✓ resumeCommand > Case 2 stale pane (reused-mode): outer session stays alive, recursion creates new control window 302ms
[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H ✓ tests/ui.test.ts (8 tests) 4ms
 ✓ tests/runners/claude.test.ts (4 tests) 6ms
 ✓ tests/phases/verdict.test.ts (16 tests) 4ms
 ✓ tests/root.test.ts (10 tests) 168ms
 ✓ tests/resume.test.ts (11 tests) 2782ms
   ✓ resumeRun > exits with code 1 and non-interactive message on paused run with null pendingAction (D4b) 323ms
   ✓ resumeRun > errors when phase 5 completed but all trackedRepos implHead are null (state anomaly) 332ms
   ✓ resumeRun > skip_phase Phase 6 with gitignored eval report: skips commit and leaves evalCommit null 369ms
   ✓ completeInteractivePhaseFromFreshSentinel — Phase 5 multi-repo (FR-8) > returns true and sets implHead when any repo advanced 314ms
 ✓ tests/context/reviewer-contract.test.ts (4 tests) 63ms
 ✓ tests/commands/status-list.test.ts (7 tests) 589ms
 ✓ tests/git.test.ts (20 tests) 1963ms
 ✓ tests/ui-footer.test.ts (9 tests) 5ms
 ✓ tests/phases/gate-resume-escalation.test.ts (1 test) 36ms
 ✓ tests/multi-worktree.test.ts (11 tests) 2713ms
   ✓ (a) depth=1 auto-detect — non-git outer cwd > detects exactly depth=1 git repos, skips non-git dirs 457ms
   ✓ (b) --track / --exclude flag combinations > --track replaces auto-detect 667ms
   ✓ (b) --track / --exclude flag combinations > --exclude removes from auto-detect 437ms
   ✓ (c) assembler diff concat for N=2 repos > includes ### repo: label for each repo in N=2 case 385ms
   ✓ (d) Phase 5 success: one-of-N advanced > returns true when only repo-a advanced in a 2-repo setup 554ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-UEXFpp/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-cX3vEr/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-zIUJxU/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-cX3vEr/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-LkIF2R/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-jHthma/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-jHthma/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-uXEJJf/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-RKAnE8/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-RKAnE8/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-NeB6r6/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-NeB6r6/.claude/skills:
  phase-harness-codex-gate-review
 ✓ tests/install-skills.test.ts (7 tests) 21ms
No skills directory found at /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-oS8b6i/.claude/skills. Nothing to uninstall.
 ✓ tests/uninstall-skills.test.ts (6 tests) 28ms
 ✓ tests/input.test.ts (12 tests) 5ms
 ✓ tests/task-prompt.test.ts (7 tests) 3ms
 ✓ tests/commands/jump.test.ts (6 tests) 725ms
 ✓ tests/terminal.test.ts (5 tests) 2ms
 ✓ tests/integration/lifecycle.test.ts (11 tests) 1336ms
[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H ✓ tests/ui-prompt-model-config.test.ts (3 tests) 4ms
 ✓ tests/preflight-claude-at-file.test.ts (2 tests) 3ms
 ✓ tests/conformance/phase-models.test.ts (9 tests) 6ms
 ✓ tests/ui-separator.test.ts (5 tests) 2ms
 ✓ tests/process.test.ts (6 tests) 35ms
 ✓ tests/scripts/harness-verify.test.ts (2 tests) 383ms
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
⚠️  carryover feedback path not found on disk, skipping: /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/sk-BiZpEe/phase-5-carryover-missing.md
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

> phase-harness@0.3.3 build /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/bug-fix
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
