# Auto Verification Report
- Date: 2026-05-11
- Related Spec: N/A
- Related Plan: N/A

## Results
| Check | Status | Detail |
|-------|--------|--------|
| typecheck | pass |  |
| tests | pass |  |
| build | pass |  |
| docs-token-presence | pass |  |

## Summary
- Total: 4 checks
- Pass: 4
- Fail: 0

## Raw Output

### typecheck
**Command:** `cd /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/dogfood-no-drift && pnpm tsc --noEmit`
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
**Command:** `cd /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/dogfood-no-drift && pnpm vitest run`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

 RUN  v2.1.9 /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/dogfood-no-drift

 ✓ tests/state.test.ts (58 tests) 47ms
 ✓ tests/context/skills-rendering.test.ts (45 tests) 47ms
 ✓ tests/logger.test.ts (32 tests) 88ms
 ✓ tests/phases/gate.test.ts (38 tests) 155ms
 ✓ tests/phases/retrospective.test.ts (16 tests) 64ms
 ✓ tests/phases/runner-claude-resume.test.ts (13 tests) 43ms
 ✓ tests/signal.test.ts (17 tests) 423ms
 ✓ tests/phases/runner.test.ts (86 tests) 383ms
 ✓ tests/phases/gate-resume.test.ts (12 tests) 104ms
 ✓ tests/runners/claude-usage.test.ts (17 tests) 21ms
 ✓ tests/phases/terminal-ui.test.ts (18 tests) 119ms
 ✓ tests/integration/logging.test.ts (15 tests) 273ms
 ✓ tests/commands/inner.test.ts (25 tests) 300ms
 ✓ tests/lock.test.ts (20 tests) 228ms
 ✓ tests/phases/stagnation.test.ts (32 tests) 12ms
 ✓ tests/phases/verify.test.ts (15 tests) 23ms
 ✓ tests/commands/footer-ticker.test.ts (10 tests) 33ms
 ✓ tests/phases/runner-token-capture.test.ts (8 tests) 18ms
 ✓ tests/metrics/footer-aggregator.test.ts (11 tests) 8ms
 ✓ tests/phases/drift.test.ts (35 tests) 13ms
 ✓ tests/integration/codex-session-resume.test.ts (6 tests) 76ms
 ✓ tests/orphan-cleanup.test.ts (20 tests) 15ms
 ✓ tests/preflight.test.ts (27 tests | 1 skipped) 164ms
 ✓ tests/phases/ambiguity.test.ts (19 tests) 4ms
 ✓ tests/runners/codex.test.ts (21 tests) 1586ms
   ✓ spawnCodexInteractiveInPane — pane injection > sends a top-level `codex` TUI command (not `codex exec`) with prompt arg, sandbox, CODEX_HOME 308ms
   ✓ spawnCodexInteractiveInPane — pane injection > uses --dangerously-bypass-approvals-and-sandbox for phase 5 304ms
   ✓ spawnCodexInPane — fresh > sends fresh top-level `codex` TUI command with prompt as cat-substitution arg 306ms
   ✓ spawnCodexInPane — fresh in non-git cwd > does NOT add --skip-git-repo-check even when cwd is non-git (trust-entry handles it) 303ms
   ✓ spawnCodexInPane — resume > sends top-level `codex resume <sessionId>` TUI command with prompt arg 303ms
 ✓ tests/context/assembler.test.ts (83 tests) 1703ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=1 trackedRepos[0].path===cwd → raw diff without ### repo: label 412ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=2 → diff sections with ### repo: label for each repo 594ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N>1 metadata uses "Harness implementation ranges (per tracked repo):" block 499ms
 ✓ tests/integration/light-flow.test.ts (4 tests) 230ms
 ✓ tests/resume-light.test.ts (10 tests) 38ms
 ✓ tests/phases/verdict.test.ts (31 tests) 4ms
 ✓ tests/commands/inner-footer.test.ts (2 tests) 13ms
 ✓ tests/runners/codex-resume.test.ts (8 tests) 62ms
 ✓ tests/context/assembler-resume.test.ts (10 tests) 58ms
 ✓ tests/runners/codex-isolation.test.ts (10 tests) 49ms
 ✓ tests/tmux.test.ts (34 tests) 811ms
   ✓ pollForPidFile > returns null on timeout when file never appears 400ms
   ✓ pollForPidFile > returns null when file contains non-numeric content 405ms
 ✓ tests/integration/gate-stagnation.test.ts (2 tests) 13ms
 ✓ tests/phases/interactive-watchdog.test.ts (6 tests) 9ms
 ✓ tests/phases/gate-feedback-archival.test.ts (2 tests) 59ms
 ✓ tests/state-invalidation.test.ts (5 tests) 5ms
 ✓ tests/commands/resume-cmd.test.ts (13 tests) 2206ms
 ✓ tests/runners/claude.test.ts (4 tests) 64ms
 ✓ tests/resume.test.ts (11 tests) 2903ms
   ✓ completeInteractivePhaseFromFreshSentinel — Phase 5 multi-repo (FR-8) > returns true and sets implHead when any repo advanced 347ms
   ✓ completeInteractivePhaseFromFreshSentinel — Phase 5 multi-repo (FR-8) > returns false when no repo advanced (HEAD === implRetryBase) 449ms
 ✓ tests/phases/gate-resume-escalation.test.ts (2 tests) 134ms
 ✓ tests/runners/codex-usage.test.ts (6 tests) 333ms
   ✓ readCodexSessionUsage — pinned sessionId > returns null when file missing 322ms
 ✓ tests/root.test.ts (10 tests) 157ms
 ✓ tests/context/reviewer-contract.test.ts (4 tests) 71ms
 ✓ tests/commands/status-list.test.ts (7 tests) 599ms
 ✓ tests/git.test.ts (24 tests) 2540ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-eD3HMF/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-eD3HMF/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-rGUWPI/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-rGUWPI/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-kpVXdd/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-kpVXdd/.claude/skills:
  phase-harness-codex-gate-review
No skills directory found at /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-6MkUhS/.claude/skills. Nothing to uninstall.
 ✓ tests/uninstall-skills.test.ts (6 tests) 14ms
 ✓ tests/ink/components/CurrentPhase.test.tsx (10 tests) 17ms
 ✓ tests/commands/jump.test.ts (6 tests) 682ms
 ✓ tests/multi-worktree.test.ts (11 tests) 2767ms
   ✓ (a) depth=1 auto-detect — non-git outer cwd > detects exactly depth=1 git repos, skips non-git dirs 461ms
   ✓ (b) --track / --exclude flag combinations > --track replaces auto-detect 447ms
   ✓ (b) --track / --exclude flag combinations > --exclude removes from auto-detect 698ms
   ✓ (c) assembler diff concat for N=2 repos > includes ### repo: label for each repo in N=2 case 462ms
   ✓ (d) Phase 5 success: one-of-N advanced > returns true when only repo-a advanced in a 2-repo setup 515ms
 ✓ tests/ui-footer.test.ts (9 tests) 3ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-VtxpzS/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-xFKjK4/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-2LXQ2L/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-xpVvvT/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-8rdKEV/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-8rdKEV/.claude/skills:
  phase-harness-codex-gate-review
 ✓ tests/install-skills.test.ts (7 tests) 15ms
 ✓ tests/input.test.ts (12 tests) 5ms
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  carryover feedback path not found on disk, skipping: /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/sk-qC9nLA/phase-5-carryover-missing.md
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
fatal: not a git repository (or any of the parent directories): .git
[harness] phase=5 status=completed

Recent events:
(events.jsonl not present — logging disabled)

Working tree:
```

</details>

### build
**Command:** `cd /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/dogfood-no-drift && pnpm build`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

> phase-harness@1.0.10 build /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/dogfood-no-drift
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

### docs-token-presence
**Command:** `cd /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/dogfood-no-drift && grep -l '\-\-no-drift' README.md README.ko.md docs/HOW-IT-WORKS.md docs/HOW-IT-WORKS.ko.md | wc -l | xargs | grep -q '^4$'`
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
