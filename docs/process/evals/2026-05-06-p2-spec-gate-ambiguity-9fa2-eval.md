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

 ✓ tests/state.test.ts (53 tests) 46ms
 ✓ tests/context/skills-rendering.test.ts (45 tests) 60ms
 ✓ tests/logger.test.ts (32 tests) 85ms
 ✓ tests/phases/gate.test.ts (37 tests) 167ms
 ✓ tests/phases/runner-claude-resume.test.ts (13 tests) 69ms
 ✓ tests/phases/gate-resume.test.ts (12 tests) 173ms
 ✓ tests/signal.test.ts (17 tests) 419ms
 ✓ tests/runners/claude-usage.test.ts (17 tests) 111ms
 ✓ tests/commands/inner.test.ts (25 tests) 236ms
 ✓ tests/phases/runner.test.ts (85 tests) 507ms
 ✓ tests/integration/logging.test.ts (15 tests) 258ms
 ✓ tests/phases/terminal-ui.test.ts (18 tests) 99ms
 ✓ tests/lock.test.ts (20 tests) 194ms
 ✓ tests/commands/footer-ticker.test.ts (10 tests) 49ms
 ✓ tests/phases/stagnation.test.ts (32 tests) 20ms
 ✓ tests/phases/verify.test.ts (15 tests) 21ms
 ✓ tests/phases/runner-token-capture.test.ts (8 tests) 11ms
 ✓ tests/metrics/footer-aggregator.test.ts (11 tests) 6ms
 ✓ tests/integration/codex-session-resume.test.ts (6 tests) 77ms
 ✓ tests/orphan-cleanup.test.ts (20 tests) 17ms
 ✓ tests/preflight.test.ts (27 tests | 1 skipped) 156ms
 ✓ tests/phases/ambiguity.test.ts (19 tests) 4ms
 ✓ tests/runners/codex.test.ts (21 tests) 1585ms
   ✓ spawnCodexInteractiveInPane — pane injection > sends a top-level `codex` TUI command (not `codex exec`) with prompt arg, sandbox, CODEX_HOME 310ms
   ✓ spawnCodexInteractiveInPane — pane injection > uses --dangerously-bypass-approvals-and-sandbox for phase 5 308ms
   ✓ spawnCodexInPane — fresh > sends fresh top-level `codex` TUI command with prompt as cat-substitution arg 304ms
   ✓ spawnCodexInPane — fresh in non-git cwd > does NOT add --skip-git-repo-check even when cwd is non-git (trust-entry handles it) 302ms
   ✓ spawnCodexInPane — resume > sends top-level `codex resume <sessionId>` TUI command with prompt arg 303ms
 ✓ tests/integration/light-flow.test.ts (4 tests) 225ms
 ✓ tests/context/assembler.test.ts (82 tests) 1689ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=1 trackedRepos[0].path===cwd → raw diff without ### repo: label 374ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=2 → diff sections with ### repo: label for each repo 571ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N>1 metadata uses "Harness implementation ranges (per tracked repo):" block 539ms
 ✓ tests/phases/verdict.test.ts (31 tests) 4ms
 ✓ tests/resume-light.test.ts (10 tests) 21ms
 ✓ tests/runners/codex-resume.test.ts (8 tests) 61ms
 ✓ tests/tmux.test.ts (34 tests) 813ms
   ✓ pollForPidFile > returns null on timeout when file never appears 404ms
   ✓ pollForPidFile > returns null when file contains non-numeric content 403ms
 ✓ tests/commands/inner-footer.test.ts (2 tests) 12ms
 ✓ tests/runners/codex-isolation.test.ts (10 tests) 33ms
 ✓ tests/context/assembler-resume.test.ts (10 tests) 270ms
 ✓ tests/integration/gate-stagnation.test.ts (2 tests) 25ms
 ✓ tests/commands/resume-cmd.test.ts (12 tests) 2354ms
   ✓ resumeCommand > resumeCommand — loggingEnabled inheritance > resume defaults to false when state has loggingEnabled=false 399ms
 ✓ tests/phases/interactive-watchdog.test.ts (6 tests) 6ms
 ✓ tests/state-invalidation.test.ts (5 tests) 6ms
 ✓ tests/runners/claude.test.ts (4 tests) 17ms
 ✓ tests/phases/gate-feedback-archival.test.ts (2 tests) 67ms
 ✓ tests/phases/gate-resume-escalation.test.ts (2 tests) 33ms
 ✓ tests/resume.test.ts (11 tests) 2983ms
   ✓ resumeRun > skip_phase Phase 6 with gitignored eval report: skips commit and leaves evalCommit null 563ms
   ✓ completeInteractivePhaseFromFreshSentinel — Phase 5 multi-repo (FR-8) > returns true and sets implHead when any repo advanced 405ms
 ✓ tests/runners/codex-usage.test.ts (6 tests) 318ms
   ✓ readCodexSessionUsage — pinned sessionId > returns null when file missing 307ms
 ✓ tests/root.test.ts (10 tests) 173ms
 ✓ tests/commands/status-list.test.ts (7 tests) 647ms
 ✓ tests/context/reviewer-contract.test.ts (4 tests) 64ms
 ✓ tests/ink/components/CurrentPhase.test.tsx (10 tests) 25ms
 ✓ tests/git.test.ts (24 tests) 2627ms
   ✓ isAncestor > returns false when not an ancestor 449ms
 ✓ tests/ui-footer.test.ts (9 tests) 3ms
 ✓ tests/commands/jump.test.ts (6 tests) 662ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-uzhoXP/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-UqEKGN/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-uzhoXP/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-jTrocq/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-I2S5rk/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-I2S5rk/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-C2hAPA/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-I5swkw/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-I5swkw/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-3cJyRP/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-vtC76U/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-vtC76U/.claude/skills:
  phase-harness-codex-gate-review
No skills directory found at /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-2rRFjh/.claude/skills. Nothing to uninstall.
 ✓ tests/input.test.ts (12 tests) 3ms
 ✓ tests/install-skills.test.ts (7 tests) 16ms
 ✓ tests/uninstall-skills.test.ts (6 tests) 13ms
 ✓ tests/multi-worktree.test.ts (11 tests) 2940ms
   ✓ (a) depth=1 auto-detect — non-git outer cwd > detects exactly depth=1 git repos, skips non-git dirs 535ms
   ✓ (b) --track / --exclude flag combinations > --track replaces auto-detect 856ms
   ✓ (b) --track / --exclude flag combinations > --exclude removes from auto-detect 399ms
   ✓ (c) assembler diff concat for N=2 repos > includes ### repo: label for each repo in N=2 case 439ms
   ✓ (d) Phase 5 success: one-of-N advanced > returns true when only repo-a advanced in a 2-repo setup 460ms
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  carryover feedback path not found on disk, skipping: /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/sk-7tfl1f/phase-5-carryover-missing.md
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
