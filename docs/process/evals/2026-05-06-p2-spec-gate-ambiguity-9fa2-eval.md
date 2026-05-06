# Auto Verification Report
- Date: 2026-05-06
- Related Spec: N/A
- Related Plan: N/A

## Results
| Check | Status | Detail |
|-------|--------|--------|
| typecheck | pass |  |
| test suite | pass |  |
| build | pass |  |

## Summary
- Total: 3 checks
- Pass: 3
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

### test suite
**Command:** `pnpm vitest run`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

 RUN  v2.1.9 /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/ambiguity-gate

 ✓ tests/state.test.ts (53 tests) 45ms
 ✓ tests/context/skills-rendering.test.ts (45 tests) 71ms
 ✓ tests/logger.test.ts (32 tests) 91ms
 ✓ tests/phases/gate.test.ts (35 tests) 149ms
 ✓ tests/phases/runner-claude-resume.test.ts (13 tests) 36ms
 ✓ tests/phases/gate-resume.test.ts (12 tests) 120ms
 ✓ tests/signal.test.ts (17 tests) 395ms
 ✓ tests/runners/claude-usage.test.ts (17 tests) 94ms
 ✓ tests/commands/inner.test.ts (25 tests) 202ms
 ✓ tests/phases/runner.test.ts (85 tests) 612ms
 ✓ tests/integration/logging.test.ts (15 tests) 251ms
 ✓ tests/phases/terminal-ui.test.ts (18 tests) 112ms
 ✓ tests/lock.test.ts (20 tests) 203ms
 ✓ tests/commands/footer-ticker.test.ts (10 tests) 61ms
 ✓ tests/phases/stagnation.test.ts (32 tests) 12ms
 ✓ tests/phases/runner-token-capture.test.ts (8 tests) 19ms
 ✓ tests/phases/verify.test.ts (15 tests) 26ms
 ✓ tests/metrics/footer-aggregator.test.ts (11 tests) 6ms
 ✓ tests/orphan-cleanup.test.ts (20 tests) 75ms
 ✓ tests/integration/codex-session-resume.test.ts (6 tests) 106ms
 ✓ tests/preflight.test.ts (27 tests | 1 skipped) 156ms
 ✓ tests/runners/codex.test.ts (21 tests) 1587ms
   ✓ spawnCodexInteractiveInPane — pane injection > sends a top-level `codex` TUI command (not `codex exec`) with prompt arg, sandbox, CODEX_HOME 304ms
   ✓ spawnCodexInteractiveInPane — pane injection > uses --dangerously-bypass-approvals-and-sandbox for phase 5 312ms
   ✓ spawnCodexInPane — fresh > sends fresh top-level `codex` TUI command with prompt as cat-substitution arg 303ms
   ✓ spawnCodexInPane — fresh in non-git cwd > does NOT add --skip-git-repo-check even when cwd is non-git (trust-entry handles it) 302ms
   ✓ spawnCodexInPane — resume > sends top-level `codex resume <sessionId>` TUI command with prompt arg 303ms
 ✓ tests/integration/light-flow.test.ts (4 tests) 256ms
 ✓ tests/context/assembler.test.ts (82 tests) 1673ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=1 trackedRepos[0].path===cwd → raw diff without ### repo: label 360ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=2 → diff sections with ### repo: label for each repo 515ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N>1 metadata uses "Harness implementation ranges (per tracked repo):" block 603ms
 ✓ tests/phases/ambiguity.test.ts (19 tests) 5ms
 ✓ tests/phases/verdict.test.ts (31 tests) 5ms
 ✓ tests/resume-light.test.ts (10 tests) 14ms
 ✓ tests/tmux.test.ts (34 tests) 814ms
   ✓ pollForPidFile > returns null on timeout when file never appears 402ms
   ✓ pollForPidFile > returns null when file contains non-numeric content 406ms
 ✓ tests/runners/codex-resume.test.ts (8 tests) 60ms
 ✓ tests/context/assembler-resume.test.ts (10 tests) 59ms
 ✓ tests/commands/inner-footer.test.ts (2 tests) 11ms
 ✓ tests/runners/codex-isolation.test.ts (10 tests) 21ms
 ✓ tests/integration/gate-stagnation.test.ts (2 tests) 12ms
 ✓ tests/commands/resume-cmd.test.ts (12 tests) 2188ms
   ✓ resumeCommand > Case 2 stale pane (reused-mode): outer session stays alive, recursion creates new control window 325ms
 ✓ tests/phases/interactive-watchdog.test.ts (6 tests) 5ms
 ✓ tests/state-invalidation.test.ts (5 tests) 13ms
 ✓ tests/runners/claude.test.ts (4 tests) 5ms
 ✓ tests/phases/gate-feedback-archival.test.ts (2 tests) 69ms
 ✓ tests/phases/gate-resume-escalation.test.ts (2 tests) 33ms
 ✓ tests/resume.test.ts (11 tests) 2777ms
   ✓ resumeRun > errors when phase 5 completed but all trackedRepos implHead are null (state anomaly) 341ms
   ✓ resumeRun > skip_phase Phase 6 with gitignored eval report: skips commit and leaves evalCommit null 302ms
 ✓ tests/runners/codex-usage.test.ts (6 tests) 311ms
   ✓ readCodexSessionUsage — pinned sessionId > returns null when file missing 304ms
 ✓ tests/root.test.ts (10 tests) 154ms
 ✓ tests/commands/status-list.test.ts (7 tests) 597ms
 ✓ tests/context/reviewer-contract.test.ts (4 tests) 59ms
 ✓ tests/ink/components/CurrentPhase.test.tsx (10 tests) 20ms
 ✓ tests/ui-footer.test.ts (9 tests) 4ms
 ✓ tests/commands/jump.test.ts (6 tests) 687ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-WXERsW/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-UNmrDo/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-WXERsW/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-bUinqZ/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-bUinqZ/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-z8c98I/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-ZmEPXc/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-vJOWjN/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-vJOWjN/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-GA5kyS/.claude/skills:
  phase-harness-codex-gate-review
No skills directory found at /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-RfjN6J/.claude/skills. Nothing to uninstall.
 ✓ tests/uninstall-skills.test.ts (6 tests) 20ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-fs0w56/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-fs0w56/.claude/skills:
  phase-harness-codex-gate-review
 ✓ tests/install-skills.test.ts (7 tests) 27ms
 ✓ tests/input.test.ts (12 tests) 3ms
 ✓ tests/multi-worktree.test.ts (11 tests) 2852ms
   ✓ (a) depth=1 auto-detect — non-git outer cwd > detects exactly depth=1 git repos, skips non-git dirs 970ms
   ✓ (b) --track / --exclude flag combinations > --track replaces auto-detect 391ms
   ✓ (b) --track / --exclude flag combinations > --exclude removes from auto-detect 385ms
   ✓ (c) assembler diff concat for N=2 repos > includes ### repo: label for each repo in N=2 case 421ms
   ✓ (d) Phase 5 success: one-of-N advanced > returns true when only repo-a advanced in a 2-repo setup 474ms
 ✓ tests/git.test.ts (24 tests) 2554ms
   ✓ getGitRoot > returns repo root path 306ms
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  carryover feedback path not found on disk, skipping: /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/sk-PK2Qk4/phase-5-carryover-missing.md
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
[ambiguity] ## Clarity Scores section missing or malformed — fail-open, verdict unchanged
⚠️  claude session resume fallback: jsonl missing
ℹ Received control signal (SIGUSR1). Applying pending action...
✓ Applied: skip. Phase loop re-entering.
ℹ Received control signal (SIGUSR1). Applying pending action...
✓ Applied: jump → phase 3. Phase loop re-entering.
ℹ Received control signal (SIGUSR1). Applying pending action...
✓ Applied: skip. Phase loop re-entering.
ℹ Received control signal (SIGUSR1). Applying pending action...
fatal: not a git repository (or any of the parent directories): .git
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
```

</details>

### build
**Command:** `pnpm build`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

> phase-harness@1.0.10 build /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/ambiguity-gate
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
