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

 ✓ tests/state.test.ts (53 tests) 50ms
 ✓ tests/logger.test.ts (32 tests) 85ms
 ✓ tests/context/skills-rendering.test.ts (45 tests) 78ms
 ✓ tests/phases/gate.test.ts (36 tests) 152ms
 ✓ tests/phases/runner-claude-resume.test.ts (13 tests) 44ms
 ✓ tests/phases/gate-resume.test.ts (12 tests) 156ms
 ✓ tests/runners/claude-usage.test.ts (17 tests) 90ms
 ✓ tests/signal.test.ts (17 tests) 411ms
 ✓ tests/phases/runner.test.ts (85 tests) 640ms
 ✓ tests/phases/terminal-ui.test.ts (18 tests) 145ms
 ✓ tests/commands/inner.test.ts (25 tests) 289ms
 ✓ tests/integration/logging.test.ts (15 tests) 305ms
 ✓ tests/commands/footer-ticker.test.ts (10 tests) 97ms
 ✓ tests/lock.test.ts (20 tests) 248ms
 ✓ tests/phases/stagnation.test.ts (32 tests) 18ms
 ✓ tests/phases/verify.test.ts (15 tests) 29ms
 ✓ tests/runners/codex.test.ts (21 tests) 1617ms
   ✓ spawnCodexInteractiveInPane — pane injection > sends a top-level `codex` TUI command (not `codex exec`) with prompt arg, sandbox, CODEX_HOME 308ms
   ✓ spawnCodexInteractiveInPane — pane injection > uses --dangerously-bypass-approvals-and-sandbox for phase 5 310ms
   ✓ spawnCodexInPane — fresh > sends fresh top-level `codex` TUI command with prompt as cat-substitution arg 305ms
   ✓ spawnCodexInPane — fresh in non-git cwd > does NOT add --skip-git-repo-check even when cwd is non-git (trust-entry handles it) 309ms
   ✓ spawnCodexInPane — resume > sends top-level `codex resume <sessionId>` TUI command with prompt arg 309ms
 ✓ tests/metrics/footer-aggregator.test.ts (11 tests) 11ms
 ✓ tests/phases/runner-token-capture.test.ts (8 tests) 16ms
 ✓ tests/integration/codex-session-resume.test.ts (6 tests) 76ms
 ✓ tests/orphan-cleanup.test.ts (20 tests) 21ms
 ✓ tests/phases/ambiguity.test.ts (19 tests) 5ms
 ✓ tests/preflight.test.ts (27 tests | 1 skipped) 222ms
 ✓ tests/context/assembler.test.ts (82 tests) 2333ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=1 trackedRepos[0].path===cwd → raw diff without ### repo: label 463ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=2 → diff sections with ### repo: label for each repo 1009ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N>1 metadata uses "Harness implementation ranges (per tracked repo):" block 661ms
 ✓ tests/integration/light-flow.test.ts (4 tests) 305ms
 ✓ tests/phases/verdict.test.ts (31 tests) 4ms
 ✓ tests/resume-light.test.ts (10 tests) 26ms
 ✓ tests/runners/codex-resume.test.ts (8 tests) 67ms
 ✓ tests/tmux.test.ts (34 tests) 821ms
   ✓ pollForPidFile > returns null on timeout when file never appears 406ms
   ✓ pollForPidFile > returns null when file contains non-numeric content 407ms
 ✓ tests/commands/inner-footer.test.ts (2 tests) 9ms
 ✓ tests/context/assembler-resume.test.ts (10 tests) 72ms
 ✓ tests/runners/codex-isolation.test.ts (10 tests) 37ms
 ✓ tests/integration/gate-stagnation.test.ts (2 tests) 23ms
 ✓ tests/phases/interactive-watchdog.test.ts (6 tests) 7ms
 ✓ tests/state-invalidation.test.ts (5 tests) 47ms
 ✓ tests/phases/gate-feedback-archival.test.ts (2 tests) 79ms
 ✓ tests/runners/claude.test.ts (4 tests) 14ms
 ✓ tests/commands/resume-cmd.test.ts (12 tests) 2194ms
   ✓ resumeCommand > resumes with implicit current-run (Case 3: no session) 321ms
 ✓ tests/phases/gate-resume-escalation.test.ts (2 tests) 72ms
 ✓ tests/resume.test.ts (11 tests) 3379ms
   ✓ resumeRun > exits with code 1 and non-interactive message on paused run with null pendingAction (D4b) 366ms
   ✓ resumeRun > clears pendingAction when rerun_gate target already completed 514ms
   ✓ resumeRun > errors when specCommit is not in git history 342ms
   ✓ completeInteractivePhaseFromFreshSentinel — Phase 5 multi-repo (FR-8) > returns false when no repo advanced (HEAD === implRetryBase) 368ms
   ✓ completeInteractivePhaseFromFreshSentinel — Phase 5 multi-repo (FR-8) > skips ancestry check for repos with implHead=null (null-safe FR-8) 336ms
 ✓ tests/runners/codex-usage.test.ts (6 tests) 326ms
   ✓ readCodexSessionUsage — pinned sessionId > returns null when file missing 307ms
 ✓ tests/root.test.ts (10 tests) 186ms
 ✓ tests/commands/status-list.test.ts (7 tests) 723ms
 ✓ tests/context/reviewer-contract.test.ts (4 tests) 70ms
 ✓ tests/git.test.ts (24 tests) 2682ms
 ✓ tests/commands/jump.test.ts (6 tests) 690ms
 ✓ tests/ink/components/CurrentPhase.test.tsx (10 tests) 34ms
 ✓ tests/ui-footer.test.ts (9 tests) 4ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-F6pptw/.claude/skills:
  phase-harness-codex-gate-review
 ✓ tests/input.test.ts (12 tests) 3ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-mr6Btu/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-oxVCec/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-zFDRJR/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-J3Yhez/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-Yxmrs6/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-Yxmrs6/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-J3Yhez/.claude/skills:
  phase-harness-codex-gate-review
 ✓ tests/install-skills.test.ts (7 tests) 22ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-udr9PQ/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-udr9PQ/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-gZ7tDu/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-gZ7tDu/.claude/skills:
  phase-harness-codex-gate-review
No skills directory found at /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-68stm4/.claude/skills. Nothing to uninstall.
 ✓ tests/uninstall-skills.test.ts (6 tests) 18ms
 ✓ tests/multi-worktree.test.ts (11 tests) 2909ms
   ✓ (a) depth=1 auto-detect — non-git outer cwd > detects exactly depth=1 git repos, skips non-git dirs 537ms
   ✓ (b) --track / --exclude flag combinations > --track replaces auto-detect 579ms
   ✓ (b) --track / --exclude flag combinations > --exclude removes from auto-detect 562ms
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  claude session resume fallback: no prior attempt id
⚠️  carryover feedback path not found on disk, skipping: /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/sk-vrW8Hf/phase-5-carryover-missing.md
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
