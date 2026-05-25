# Auto Verification Report
- Date: 2026-05-25
- Related Spec: N/A
- Related Plan: N/A

## Results
| Check | Status | Detail |
|-------|--------|--------|
| typecheck | pass |  |
| test-suite | pass |  |
| build | pass |  |
| invariant-i4-commitEvalReport-callsite-count | pass |  |

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

### test-suite
**Command:** `pnpm vitest run`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

 RUN  v2.1.9 /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/issue-tracking-branch

 ✓ tests/logger.test.ts (32 tests) 17ms
 ✓ tests/phases/retrospective.test.ts (24 tests) 47ms
 ✓ tests/context/skills-rendering.test.ts (45 tests) 47ms
 ✓ tests/state.test.ts (58 tests) 66ms
 ✓ tests/phases/gate.test.ts (40 tests) 220ms
 ✓ tests/phases/runner-claude-resume.test.ts (13 tests) 15ms
 ✓ tests/signal.test.ts (17 tests) 523ms
 ✓ tests/phases/runner.test.ts (87 tests) 525ms
 ✓ tests/runners/claude-usage.test.ts (17 tests) 179ms
 ✓ tests/phases/gate-resume.test.ts (12 tests) 211ms
 ✓ tests/phases/terminal-ui.test.ts (23 tests) 276ms
 ✓ tests/commands/inner.test.ts (25 tests) 356ms
 ✓ tests/integration/logging.test.ts (15 tests) 333ms
 ✓ tests/lock.test.ts (20 tests) 129ms
 ✓ tests/commands/footer-ticker.test.ts (10 tests) 109ms
 ✓ tests/phases/stagnation.test.ts (32 tests) 20ms
 ✓ tests/runners/codex.test.ts (21 tests) 1601ms
   ✓ spawnCodexInteractiveInPane — pane injection > sends a top-level `codex` TUI command (not `codex exec`) with prompt arg, sandbox, CODEX_HOME 309ms
   ✓ spawnCodexInteractiveInPane — pane injection > uses --dangerously-bypass-approvals-and-sandbox for phase 5 311ms
   ✓ spawnCodexInPane — fresh > sends fresh top-level `codex` TUI command with prompt as cat-substitution arg 308ms
   ✓ spawnCodexInPane — fresh in non-git cwd > does NOT add --skip-git-repo-check even when cwd is non-git (trust-entry handles it) 304ms
   ✓ spawnCodexInPane — resume > sends top-level `codex resume <sessionId>` TUI command with prompt arg 304ms
 ✓ tests/integration/light-flow.test.ts (5 tests) 585ms
 ✓ tests/phases/drift.test.ts (36 tests) 12ms
 ✓ tests/phases/verify.test.ts (15 tests) 30ms
 ✓ tests/context/assembler.test.ts (83 tests) 2372ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=1 trackedRepos[0].path===cwd → raw diff without ### repo: label 451ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=2 → diff sections with ### repo: label for each repo 771ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N>1 metadata uses "Harness implementation ranges (per tracked repo):" block 1001ms
 ✓ tests/metrics/footer-aggregator.test.ts (11 tests) 5ms
 ✓ tests/phases/runner-token-capture.test.ts (8 tests) 9ms
 ✓ tests/integration/codex-session-resume.test.ts (6 tests) 62ms
 ✓ tests/orphan-cleanup.test.ts (20 tests) 26ms
 ✓ tests/phases/ambiguity.test.ts (19 tests) 4ms
 ✓ tests/preflight.test.ts (27 tests | 1 skipped) 194ms
 ✓ tests/resume-light.test.ts (10 tests) 12ms
 ✓ tests/phases/verdict.test.ts (31 tests) 4ms
 ✓ tests/commands/inner-footer.test.ts (2 tests) 17ms
 ✓ tests/runners/codex-resume.test.ts (8 tests) 60ms
 ✓ tests/runners/codex-isolation.test.ts (10 tests) 26ms
 ✓ tests/context/assembler-resume.test.ts (10 tests) 63ms
reset phase.1.preset
 ✓ tests/tmux.test.ts (34 tests) 810ms
   ✓ pollForPidFile > returns null on timeout when file never appears 403ms
   ✓ pollForPidFile > returns null when file contains non-numeric content 402ms
 ✓ src/phases/gate/stubbornEscalation.test.ts (8 tests) 22ms
 ✓ tests/commands/config.test.ts (16 tests) 45ms
 ✓ tests/commands/resume-cmd.test.ts (13 tests) 2636ms
   ✓ resumeCommand > errors on completed run and updates current-run pointer 650ms
 ✓ tests/phases/verify-throw-offending-paths.test.ts (3 tests) 21ms
 ✓ tests/integration/gate-stagnation.test.ts (2 tests) 22ms
 ✓ tests/phases/interactive-watchdog.test.ts (6 tests) 8ms
 ✓ tests/resume.test.ts (11 tests) 3065ms
   ✓ resumeRun > clears pendingAction when rerun_gate target already completed 410ms
   ✓ resumeRun > clears pendingAction when rerun_verify and phase 6 completed 569ms
 ✓ tests/state-invalidation.test.ts (5 tests) 6ms
 ✓ tests/phases/gate-feedback-archival.test.ts (2 tests) 65ms
 ✓ tests/runners/claude.test.ts (4 tests) 9ms
 ✓ tests/integration/p6-mid-session-dirt.test.ts (2 tests) 443ms
   ✓ Phase 6 — mid-session dirty tolerance (SC5) > writes dirty_baseline_extended event when a new untracked file appears mid-session 438ms
 ✓ tests/ink/components/CurrentPhase.test.tsx (12 tests) 27ms
 ✓ tests/phases/gate-resume-escalation.test.ts (2 tests) 36ms
 ✓ tests/runners/codex-usage.test.ts (6 tests) 327ms
   ✓ readCodexSessionUsage — pinned sessionId > returns null when file missing 303ms
 ✓ tests/root.test.ts (10 tests) 185ms
 ✓ tests/context/reviewer-contract.test.ts (4 tests) 54ms
 ✓ tests/commands/status-list.test.ts (7 tests) 662ms
 ✓ tests/git.test.ts (24 tests) 2281ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-wneUP5/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-wneUP5/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-T73jl4/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-T73jl4/.claude/skills:
  phase-harness-codex-gate-review
 ✓ src/phases/gate/parseRejectFeedback.test.ts (12 tests) 4ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-RJxXf3/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-RJxXf3/.claude/skills:
  phase-harness-codex-gate-review
No skills directory found at /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-T1Kvup/.claude/skills. Nothing to uninstall.
 ✓ tests/uninstall-skills.test.ts (6 tests) 26ms
 ✓ tests/ui-footer.test.ts (9 tests) 3ms
 ✓ tests/input.test.ts (12 tests) 2ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-UJiXgN/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-GzKi0m/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-LSFVws/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-2j5rvB/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-tGe3w0/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-tGe3w0/.claude/skills:
  phase-harness-codex-gate-review
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  carryover feedback path not found on disk, skipping: /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/sk-pN4S90/phase-5-carryover-missing.md
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
[harness] gate 7 sidecar replay skipped: sidecar retryIndex=<absent> ≠ current retryIndex=1 (running fresh gate)
[harness] gate 7 sidecar replay skipped: sidecar retryIndex=<absent> ≠ current retryIndex=1 (running fresh gate)
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
ℹ Received control signal (SIGUSR1). Applying pending action...
✓ Applied: jump → phase 3. Phase loop re-entering.
ℹ Received control signal (SIGUSR1). Applying pending action...
✓ Applied: skip. Phase loop re-entering.
ℹ Received control signal (SIGUSR1). Applying pending action...
[ambiguity] ## Clarity Scores section missing or malformed — fail-open, verdict unchanged
[harness] phase=5 status=failed

Recent events:
(events.jsonl not present — logging disabled)

Working tree:
[harness] cleanup: killing dedicated session test-sess
(git not available)

[R] Resume   [J] Jump to phase   [Q] Quit
[harness] phase=5 status=failed

Recent events:
(events.jsonl not present — logging disabled)

Working tree:
(git not available)

[R] Resume   [J] Jump to phase   [Q] Quit
[harness] cleanup: killing dedicated session test-sess
[harness] phase=5 status=completed

Recent events:
```

</details>

### build
**Command:** `pnpm build`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

> phase-harness@1.1.0 build /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/issue-tracking-branch
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

### invariant-i4-commitEvalReport-callsite-count
**Command:** `test $(grep -rEn 'commitEvalReport\(' src --include='*.ts' --exclude='*.test.ts' | grep -v 'export function commitEvalReport' | wc -l | tr -d ' ') -eq 3`
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
