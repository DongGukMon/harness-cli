# Auto Verification Report
- Date: 2026-05-07
- Related Spec: N/A
- Related Plan: N/A

## Results
| Check | Status | Detail |
|-------|--------|--------|
| TypeScript typecheck | pass |  |
| Analyzer unit tests (retrospective fixtures) | pass |  |
| Retro subcommand tests | pass |  |
| Full test suite (regression) | pass |  |

## Summary
- Total: 4 checks
- Pass: 4
- Fail: 0

## Raw Output

### TypeScript typecheck
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

### Analyzer unit tests (retrospective fixtures)
**Command:** `pnpm vitest run tests/phases/retrospective.test.ts`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

 RUN  v2.1.9 /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/auto-retro

 ✓ tests/phases/retrospective.test.ts (16 tests) 11ms

 Test Files  1 passed (1)
      Tests  16 passed (16)
   Start at  14:39:52
   Duration  210ms (transform 30ms, setup 0ms, collect 35ms, tests 11ms, environment 0ms, prepare 24ms)
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```

```

</details>

### Retro subcommand tests
**Command:** `pnpm vitest run tests/commands/retro.test.ts`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

 RUN  v2.1.9 /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/auto-retro

 ✓ tests/commands/retro.test.ts (4 tests) 8ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  14:39:53
   Duration  350ms (transform 65ms, setup 0ms, collect 82ms, tests 8ms, environment 0ms, prepare 52ms)
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```

```

</details>

### Full test suite (regression)
**Command:** `pnpm vitest run`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

 RUN  v2.1.9 /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/auto-retro

 ✓ tests/state.test.ts (53 tests) 45ms
 ✓ tests/context/skills-rendering.test.ts (45 tests) 48ms
 ✓ tests/logger.test.ts (32 tests) 67ms
 ✓ tests/phases/gate.test.ts (38 tests) 162ms
 ✓ tests/phases/retrospective.test.ts (16 tests) 57ms
 ✓ tests/phases/runner-claude-resume.test.ts (13 tests) 32ms
 ✓ tests/signal.test.ts (17 tests) 416ms
 ✓ tests/phases/gate-resume.test.ts (12 tests) 153ms
 ✓ tests/commands/inner.test.ts (25 tests) 234ms
 ✓ tests/runners/claude-usage.test.ts (17 tests) 99ms
 ✓ tests/phases/runner.test.ts (85 tests) 526ms
 ✓ tests/phases/terminal-ui.test.ts (18 tests) 90ms
 ✓ tests/integration/logging.test.ts (15 tests) 289ms
 ✓ tests/lock.test.ts (20 tests) 117ms
 ✓ tests/commands/footer-ticker.test.ts (10 tests) 23ms
 ✓ tests/phases/stagnation.test.ts (32 tests) 10ms
 ✓ tests/phases/verify.test.ts (15 tests) 14ms
 ✓ tests/metrics/footer-aggregator.test.ts (11 tests) 5ms
 ✓ tests/phases/runner-token-capture.test.ts (8 tests) 6ms
 ✓ tests/integration/codex-session-resume.test.ts (6 tests) 67ms
 ✓ tests/orphan-cleanup.test.ts (20 tests) 13ms
 ✓ tests/phases/ambiguity.test.ts (19 tests) 4ms
 ✓ tests/preflight.test.ts (27 tests | 1 skipped) 165ms
 ✓ tests/runners/codex.test.ts (21 tests) 1593ms
   ✓ spawnCodexInteractiveInPane — pane injection > sends a top-level `codex` TUI command (not `codex exec`) with prompt arg, sandbox, CODEX_HOME 308ms
   ✓ spawnCodexInteractiveInPane — pane injection > uses --dangerously-bypass-approvals-and-sandbox for phase 5 307ms
   ✓ spawnCodexInPane — fresh > sends fresh top-level `codex` TUI command with prompt as cat-substitution arg 304ms
   ✓ spawnCodexInPane — fresh in non-git cwd > does NOT add --skip-git-repo-check even when cwd is non-git (trust-entry handles it) 302ms
   ✓ spawnCodexInPane — resume > sends top-level `codex resume <sessionId>` TUI command with prompt arg 306ms
 ✓ tests/context/assembler.test.ts (83 tests) 1638ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=1 trackedRepos[0].path===cwd → raw diff without ### repo: label 391ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=2 → diff sections with ### repo: label for each repo 523ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N>1 metadata uses "Harness implementation ranges (per tracked repo):" block 517ms
 ✓ tests/integration/light-flow.test.ts (4 tests) 215ms
 ✓ tests/phases/verdict.test.ts (31 tests) 6ms
 ✓ tests/resume-light.test.ts (10 tests) 31ms
 ✓ tests/runners/codex-resume.test.ts (8 tests) 58ms
 ✓ tests/commands/inner-footer.test.ts (2 tests) 11ms
 ✓ tests/tmux.test.ts (34 tests) 814ms
   ✓ pollForPidFile > returns null on timeout when file never appears 402ms
   ✓ pollForPidFile > returns null when file contains non-numeric content 406ms
 ✓ tests/runners/codex-isolation.test.ts (10 tests) 27ms
 ✓ tests/context/assembler-resume.test.ts (10 tests) 71ms
 ✓ tests/integration/gate-stagnation.test.ts (2 tests) 12ms
 ✓ tests/phases/interactive-watchdog.test.ts (6 tests) 7ms
 ✓ tests/state-invalidation.test.ts (5 tests) 7ms
 ✓ tests/phases/gate-feedback-archival.test.ts (2 tests) 48ms
 ✓ tests/commands/resume-cmd.test.ts (12 tests) 1842ms
 ✓ tests/runners/claude.test.ts (4 tests) 7ms
 ✓ tests/phases/gate-resume-escalation.test.ts (2 tests) 38ms
 ✓ tests/resume.test.ts (11 tests) 2349ms
 ✓ tests/runners/codex-usage.test.ts (6 tests) 316ms
   ✓ readCodexSessionUsage — pinned sessionId > returns null when file missing 308ms
 ✓ tests/root.test.ts (10 tests) 195ms
 ✓ tests/commands/status-list.test.ts (7 tests) 543ms
 ✓ tests/context/reviewer-contract.test.ts (4 tests) 53ms
 ✓ tests/ink/components/CurrentPhase.test.tsx (10 tests) 19ms
 ✓ tests/commands/jump.test.ts (6 tests) 861ms
 ✓ tests/git.test.ts (24 tests) 2344ms
 ✓ tests/ui-footer.test.ts (9 tests) 3ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-RDyHno/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-RDyHno/.claude/skills:
  phase-harness-codex-gate-review
 ✓ tests/multi-worktree.test.ts (11 tests) 2619ms
   ✓ (a) depth=1 auto-detect — non-git outer cwd > detects exactly depth=1 git repos, skips non-git dirs 459ms
   ✓ (b) --track / --exclude flag combinations > --track replaces auto-detect 432ms
   ✓ (b) --track / --exclude flag combinations > --exclude removes from auto-detect 392ms
   ✓ (c) assembler diff concat for N=2 repos > includes ### repo: label for each repo in N=2 case 431ms
   ✓ (d) Phase 5 success: one-of-N advanced > returns true when only repo-a advanced in a 2-repo setup 691ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-VEFif9/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-VEFif9/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-q9Yo05/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-q9Yo05/.claude/skills:
  phase-harness-codex-gate-review
No skills directory found at /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-yQHx6Q/.claude/skills. Nothing to uninstall.
 ✓ tests/uninstall-skills.test.ts (6 tests) 85ms
 ✓ tests/input.test.ts (12 tests) 2ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-tQuigU/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-25USbD/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-QNZnvF/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-rgCpZ2/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-eMNtvW/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-eMNtvW/.claude/skills:
  phase-harness-codex-gate-review
 ✓ tests/install-skills.test.ts (7 tests) 29ms
 ✓ tests/commands/retro.test.ts (4 tests) 9ms
[2J[H[2J[H ✓ tests/ui.test.ts (6 tests) 5ms
 ✓ tests/ink/render.test.ts (11 tests) 22ms
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  carryover feedback path not found on disk, skipping: /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/sk-Sm2kA0/phase-5-carryover-missing.md
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  claude session resume fallback: no prior attempt id
⚠️  claude session resume fallback: no prior attempt id
⚠️  claude session resume fallback: no prior attempt id
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
⚠️  claude session resume fallback: jsonl missing
[ambiguity] ## Clarity Scores section missing or malformed — fail-open, verdict unchanged
ℹ Received control signal (SIGUSR1). Applying pending action...
✓ Applied: skip. Phase loop re-entering.
ℹ Received control signal (SIGUSR1). Applying pending action...
✓ Applied: jump → phase 3. Phase loop re-entering.
ℹ Received control signal (SIGUSR1). Applying pending action...
✓ Applied: skip. Phase loop re-entering.
ℹ Received control signal (SIGUSR1). Applying pending action...
[harness] phase=5 status=failed

Recent events:
(events.jsonl not present — logging disabled)

Working tree:
(git not available)

[R] Resume   [J] Jump to phase   [Q] Quit
[harness] phase=5 status=failed

Recent events:
(events.jsonl not present — logging disabled)

Working tree:
(git not available)

[R] Resume   [J] Jump to phase   [Q] Quit
[harness] phase=5 status=completed

Recent events:
(events.jsonl not present — logging disabled)

Working tree:
(git not available)
```

</details>
