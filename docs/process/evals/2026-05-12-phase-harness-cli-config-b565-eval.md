# Auto Verification Report
- Date: 2026-05-12
- Related Spec: N/A
- Related Plan: N/A

## Results
| Check | Status | Detail |
|-------|--------|--------|
| typecheck | pass |  |
| test | pass |  |
| build | pass |  |
| smoke-config-list | pass |  |

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

### test
**Command:** `pnpm vitest run`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

 RUN  v2.1.9 /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/config-cmd

 ✓ tests/logger.test.ts (32 tests) 39ms
 ✓ tests/state.test.ts (58 tests) 46ms
 ✓ tests/context/skills-rendering.test.ts (45 tests) 53ms
 ✓ tests/phases/gate.test.ts (38 tests) 134ms
 ✓ tests/phases/retrospective.test.ts (16 tests) 47ms
 ✓ tests/phases/runner-claude-resume.test.ts (13 tests) 35ms
 ✓ tests/signal.test.ts (17 tests) 443ms
 ✓ tests/phases/runner.test.ts (86 tests) 370ms
 ✓ tests/phases/gate-resume.test.ts (12 tests) 130ms
 ✓ tests/runners/claude-usage.test.ts (17 tests) 85ms
 ✓ tests/commands/inner.test.ts (25 tests) 253ms
 ✓ tests/integration/logging.test.ts (15 tests) 268ms
 ✓ tests/phases/terminal-ui.test.ts (18 tests) 106ms
 ✓ tests/lock.test.ts (20 tests) 162ms
 ✓ tests/phases/stagnation.test.ts (32 tests) 8ms
 ✓ tests/commands/footer-ticker.test.ts (10 tests) 25ms
 ✓ tests/phases/verify.test.ts (15 tests) 18ms
 ✓ tests/phases/drift.test.ts (36 tests) 10ms
 ✓ tests/phases/runner-token-capture.test.ts (8 tests) 8ms
 ✓ tests/metrics/footer-aggregator.test.ts (11 tests) 6ms
 ✓ tests/integration/codex-session-resume.test.ts (6 tests) 88ms
 ✓ tests/orphan-cleanup.test.ts (20 tests) 28ms
 ✓ tests/phases/ambiguity.test.ts (19 tests) 5ms
 ✓ tests/preflight.test.ts (27 tests | 1 skipped) 177ms
 ✓ tests/runners/codex.test.ts (21 tests) 1592ms
   ✓ spawnCodexInteractiveInPane — pane injection > sends a top-level `codex` TUI command (not `codex exec`) with prompt arg, sandbox, CODEX_HOME 310ms
   ✓ spawnCodexInteractiveInPane — pane injection > uses --dangerously-bypass-approvals-and-sandbox for phase 5 309ms
   ✓ spawnCodexInPane — fresh > sends fresh top-level `codex` TUI command with prompt as cat-substitution arg 303ms
   ✓ spawnCodexInPane — fresh in non-git cwd > does NOT add --skip-git-repo-check even when cwd is non-git (trust-entry handles it) 303ms
   ✓ spawnCodexInPane — resume > sends top-level `codex resume <sessionId>` TUI command with prompt arg 304ms
 ✓ tests/context/assembler.test.ts (83 tests) 1542ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=1 trackedRepos[0].path===cwd → raw diff without ### repo: label 382ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=2 → diff sections with ### repo: label for each repo 537ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N>1 metadata uses "Harness implementation ranges (per tracked repo):" block 477ms
 ✓ tests/integration/light-flow.test.ts (4 tests) 224ms
 ✓ tests/resume-light.test.ts (10 tests) 63ms
 ✓ tests/phases/verdict.test.ts (31 tests) 6ms
 ✓ tests/commands/inner-footer.test.ts (2 tests) 11ms
 ✓ tests/runners/codex-resume.test.ts (8 tests) 58ms
 ✓ tests/tmux.test.ts (34 tests) 813ms
   ✓ pollForPidFile > returns null on timeout when file never appears 404ms
   ✓ pollForPidFile > returns null when file contains non-numeric content 404ms
 ✓ tests/context/assembler-resume.test.ts (10 tests) 69ms
 ✓ tests/runners/codex-isolation.test.ts (10 tests) 47ms
reset phase.1.preset
 ✓ tests/commands/config.test.ts (16 tests) 37ms
 ✓ tests/integration/gate-stagnation.test.ts (2 tests) 15ms
 ✓ tests/phases/interactive-watchdog.test.ts (6 tests) 7ms
 ✓ tests/commands/resume-cmd.test.ts (13 tests) 2044ms
 ✓ tests/phases/gate-feedback-archival.test.ts (2 tests) 67ms
 ✓ tests/state-invalidation.test.ts (5 tests) 33ms
 ✓ tests/runners/claude.test.ts (4 tests) 5ms
 ✓ tests/phases/gate-resume-escalation.test.ts (2 tests) 35ms
 ✓ tests/resume.test.ts (11 tests) 2501ms
 ✓ tests/runners/codex-usage.test.ts (6 tests) 314ms
   ✓ readCodexSessionUsage — pinned sessionId > returns null when file missing 305ms
 ✓ tests/root.test.ts (10 tests) 187ms
 ✓ tests/commands/status-list.test.ts (7 tests) 600ms
 ✓ tests/context/reviewer-contract.test.ts (4 tests) 52ms
 ✓ tests/git.test.ts (24 tests) 2324ms
 ✓ tests/ink/components/CurrentPhase.test.tsx (10 tests) 37ms
 ✓ tests/commands/jump.test.ts (6 tests) 740ms
 ✓ tests/ui-footer.test.ts (9 tests) 3ms
 ✓ tests/input.test.ts (12 tests) 5ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-RfmWy2/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-r7qcgZ/.claude/skills:
  phase-harness-codex-gate-review
 ✓ tests/multi-worktree.test.ts (11 tests) 2588ms
   ✓ (a) depth=1 auto-detect — non-git outer cwd > detects exactly depth=1 git repos, skips non-git dirs 486ms
   ✓ (b) --track / --exclude flag combinations > --track replaces auto-detect 481ms
   ✓ (b) --track / --exclude flag combinations > --exclude removes from auto-detect 411ms
   ✓ (c) assembler diff concat for N=2 repos > includes ### repo: label for each repo in N=2 case 406ms
   ✓ (d) Phase 5 success: one-of-N advanced > returns true when only repo-a advanced in a 2-repo setup 566ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-JwcxsV/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-kwHAd1/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-vJvc2k/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-vJvc2k/.claude/skills:
  phase-harness-codex-gate-review
 ✓ tests/install-skills.test.ts (7 tests) 17ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-Wedmip/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-Wedmip/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-Yjt3B5/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-Yjt3B5/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-uOoMxN/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-uOoMxN/.claude/skills:
  phase-harness-codex-gate-review
No skills directory found at /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-eX4eeD/.claude/skills. Nothing to uninstall.
 ✓ tests/uninstall-skills.test.ts (6 tests) 108ms
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  carryover feedback path not found on disk, skipping: /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/sk-TeT6Xb/phase-5-carryover-missing.md
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
[harness] cleanup: killing dedicated session test-sess
[harness] cleanup: killing dedicated session test-sess
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
```

</details>

### build
**Command:** `pnpm build`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

> phase-harness@1.1.0 build /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/config-cmd
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

### smoke-config-list
**Command:** `node dist/bin/harness.js config list`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```
key             value          source
--------------  -------------  -------
phase.1.preset  opus-1m-xhigh  default
phase.2.preset  codex-high     default
phase.3.preset  sonnet-high    default
phase.4.preset  codex-high     default
phase.5.preset  sonnet-high    default
phase.7.preset  codex-high     default
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```

```

</details>
