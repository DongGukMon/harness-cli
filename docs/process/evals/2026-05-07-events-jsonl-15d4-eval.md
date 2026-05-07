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

 ✓ tests/phases/retrospective.test.ts (16 tests) 10ms

 Test Files  1 passed (1)
      Tests  16 passed (16)
   Start at  14:30:44
   Duration  215ms (transform 30ms, setup 0ms, collect 34ms, tests 10ms, environment 0ms, prepare 27ms)
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

 ✓ tests/commands/retro.test.ts (4 tests) 7ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  14:30:44
   Duration  208ms (transform 38ms, setup 0ms, collect 43ms, tests 7ms, environment 0ms, prepare 28ms)
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

 ✓ tests/state.test.ts (53 tests) 46ms
 ✓ tests/context/skills-rendering.test.ts (45 tests) 52ms
 ✓ tests/logger.test.ts (32 tests) 72ms
 ✓ tests/phases/gate.test.ts (38 tests) 143ms
 ✓ tests/phases/retrospective.test.ts (16 tests) 45ms
 ✓ tests/phases/runner-claude-resume.test.ts (13 tests) 16ms
 ✓ tests/signal.test.ts (17 tests) 437ms
 ✓ tests/commands/inner.test.ts (25 tests) 206ms
 ✓ tests/phases/gate-resume.test.ts (12 tests) 138ms
 ✓ tests/phases/runner.test.ts (85 tests) 464ms
 ✓ tests/runners/claude-usage.test.ts (17 tests) 94ms
 ✓ tests/integration/logging.test.ts (15 tests) 263ms
 ✓ tests/phases/terminal-ui.test.ts (18 tests) 97ms
 ✓ tests/lock.test.ts (20 tests) 152ms
 ✓ tests/commands/footer-ticker.test.ts (10 tests) 17ms
 ✓ tests/phases/stagnation.test.ts (32 tests) 8ms
 ✓ tests/phases/verify.test.ts (15 tests) 15ms
 ✓ tests/phases/runner-token-capture.test.ts (8 tests) 8ms
 ✓ tests/metrics/footer-aggregator.test.ts (11 tests) 5ms
 ✓ tests/integration/codex-session-resume.test.ts (6 tests) 59ms
 ✓ tests/orphan-cleanup.test.ts (20 tests) 32ms
 ✓ tests/preflight.test.ts (27 tests | 1 skipped) 176ms
 ✓ tests/phases/ambiguity.test.ts (19 tests) 4ms
 ✓ tests/runners/codex.test.ts (21 tests) 1584ms
   ✓ spawnCodexInteractiveInPane — pane injection > sends a top-level `codex` TUI command (not `codex exec`) with prompt arg, sandbox, CODEX_HOME 307ms
   ✓ spawnCodexInteractiveInPane — pane injection > uses --dangerously-bypass-approvals-and-sandbox for phase 5 303ms
   ✓ spawnCodexInPane — fresh > sends fresh top-level `codex` TUI command with prompt as cat-substitution arg 306ms
   ✓ spawnCodexInPane — fresh in non-git cwd > does NOT add --skip-git-repo-check even when cwd is non-git (trust-entry handles it) 302ms
   ✓ spawnCodexInPane — resume > sends top-level `codex resume <sessionId>` TUI command with prompt arg 303ms
 ✓ tests/context/assembler.test.ts (83 tests) 1673ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=1 trackedRepos[0].path===cwd → raw diff without ### repo: label 420ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=2 → diff sections with ### repo: label for each repo 528ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N>1 metadata uses "Harness implementation ranges (per tracked repo):" block 522ms
 ✓ tests/integration/light-flow.test.ts (4 tests) 214ms
 ✓ tests/phases/verdict.test.ts (31 tests) 4ms
 ✓ tests/resume-light.test.ts (10 tests) 30ms
 ✓ tests/runners/codex-resume.test.ts (8 tests) 61ms
 ✓ tests/commands/inner-footer.test.ts (2 tests) 13ms
 ✓ tests/tmux.test.ts (34 tests) 815ms
   ✓ pollForPidFile > returns null on timeout when file never appears 404ms
   ✓ pollForPidFile > returns null when file contains non-numeric content 405ms
 ✓ tests/context/assembler-resume.test.ts (10 tests) 79ms
 ✓ tests/runners/codex-isolation.test.ts (10 tests) 52ms
 ✓ tests/integration/gate-stagnation.test.ts (2 tests) 14ms
 ✓ tests/commands/resume-cmd.test.ts (12 tests) 1960ms
 ✓ tests/phases/interactive-watchdog.test.ts (6 tests) 7ms
 ✓ tests/state-invalidation.test.ts (5 tests) 6ms
 ✓ tests/phases/gate-feedback-archival.test.ts (2 tests) 72ms
 ✓ tests/runners/claude.test.ts (4 tests) 7ms
 ✓ tests/resume.test.ts (11 tests) 2705ms
   ✓ completeInteractivePhaseFromFreshSentinel — Phase 5 multi-repo (FR-8) > returns true and sets implHead when any repo advanced 369ms
   ✓ completeInteractivePhaseFromFreshSentinel — Phase 5 multi-repo (FR-8) > returns false when no repo advanced (HEAD === implRetryBase) 330ms
 ✓ tests/phases/gate-resume-escalation.test.ts (2 tests) 38ms
 ✓ tests/runners/codex-usage.test.ts (6 tests) 317ms
   ✓ readCodexSessionUsage — pinned sessionId > returns null when file missing 307ms
 ✓ tests/root.test.ts (10 tests) 158ms
 ✓ tests/context/reviewer-contract.test.ts (4 tests) 63ms
 ✓ tests/commands/status-list.test.ts (7 tests) 595ms
 ✓ tests/git.test.ts (24 tests) 2491ms
 ✓ tests/ui-footer.test.ts (9 tests) 5ms
 ✓ tests/ink/components/CurrentPhase.test.tsx (10 tests) 20ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-8pBW2o/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-8pBW2o/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-Iftf42/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-Iftf42/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-t8hLsI/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-t8hLsI/.claude/skills:
  phase-harness-codex-gate-review
No skills directory found at /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-lHMt6N/.claude/skills. Nothing to uninstall.
 ✓ tests/uninstall-skills.test.ts (6 tests) 12ms
 ✓ tests/commands/jump.test.ts (6 tests) 653ms
 ✓ tests/multi-worktree.test.ts (11 tests) 2755ms
   ✓ (a) depth=1 auto-detect — non-git outer cwd > detects exactly depth=1 git repos, skips non-git dirs 450ms
   ✓ (b) --track / --exclude flag combinations > --track replaces auto-detect 573ms
   ✓ (b) --track / --exclude flag combinations > --exclude removes from auto-detect 623ms
   ✓ (c) assembler diff concat for N=2 repos > includes ### repo: label for each repo in N=2 case 394ms
   ✓ (d) Phase 5 success: one-of-N advanced > returns true when only repo-a advanced in a 2-repo setup 505ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-ecBkjg/.claude/skills:
  phase-harness-codex-gate-review
 ✓ tests/input.test.ts (12 tests) 4ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-YEuHWb/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-q1fiRF/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-9IWA2f/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-BovcXO/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-BovcXO/.claude/skills:
  phase-harness-codex-gate-review
 ✓ tests/install-skills.test.ts (7 tests) 17ms
 ✓ tests/commands/retro.test.ts (4 tests) 9ms
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  carryover feedback path not found on disk, skipping: /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/sk-RWhXJb/phase-5-carryover-missing.md
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
ℹ Received control signal (SIGUSR1). Applying pending action...
✓ Applied: skip. Phase loop re-entering.
[ambiguity] ## Clarity Scores section missing or malformed — fail-open, verdict unchanged
ℹ Received control signal (SIGUSR1). Applying pending action...
✓ Applied: jump → phase 3. Phase loop re-entering.
ℹ Received control signal (SIGUSR1). Applying pending action...
✓ Applied: skip. Phase loop re-entering.
ℹ Received control signal (SIGUSR1). Applying pending action...
[harness] phase=5 status=failed

Recent events:
(events.jsonl not present — logging disabled)

Working tree:
fatal: not a git repository (or any of the parent directories): .git
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
```

</details>
