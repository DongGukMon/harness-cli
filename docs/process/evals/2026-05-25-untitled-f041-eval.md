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

 ✓ tests/state.test.ts (58 tests) 51ms
 ✓ tests/phases/retrospective.test.ts (24 tests) 78ms
 ✓ tests/context/skills-rendering.test.ts (45 tests) 91ms
 ✓ tests/logger.test.ts (32 tests) 100ms
 ✓ tests/phases/gate.test.ts (40 tests) 192ms
 ✓ tests/phases/runner-claude-resume.test.ts (13 tests) 19ms
 ✓ tests/signal.test.ts (17 tests) 448ms
 ✓ tests/phases/gate-resume.test.ts (12 tests) 157ms
 ✓ tests/phases/terminal-ui.test.ts (23 tests) 167ms
 ✓ tests/runners/claude-usage.test.ts (17 tests) 128ms
 ✓ tests/phases/runner.test.ts (87 tests) 656ms
 ✓ tests/commands/inner.test.ts (25 tests) 344ms
 ✓ tests/integration/logging.test.ts (15 tests) 327ms
 ✓ tests/lock.test.ts (20 tests) 250ms
 ✓ tests/commands/footer-ticker.test.ts (10 tests) 124ms
 ✓ tests/phases/stagnation.test.ts (32 tests) 121ms
 ✓ tests/runners/codex.test.ts (21 tests) 1614ms
   ✓ spawnCodexInteractiveInPane — pane injection > sends a top-level `codex` TUI command (not `codex exec`) with prompt arg, sandbox, CODEX_HOME 314ms
   ✓ spawnCodexInteractiveInPane — pane injection > uses --dangerously-bypass-approvals-and-sandbox for phase 5 306ms
   ✓ spawnCodexInPane — fresh > sends fresh top-level `codex` TUI command with prompt as cat-substitution arg 303ms
   ✓ spawnCodexInPane — fresh in non-git cwd > does NOT add --skip-git-repo-check even when cwd is non-git (trust-entry handles it) 310ms
   ✓ spawnCodexInPane — resume > sends top-level `codex resume <sessionId>` TUI command with prompt arg 306ms
 ✓ tests/integration/light-flow.test.ts (5 tests) 728ms
   ✓ light-flow end-to-end (P1 → P5 → P6 → P7) > commitEvalReport "unchanged" path anchors state.evalCommit to HEAD (I4) 446ms
 ✓ tests/phases/verify.test.ts (15 tests) 40ms
 ✓ tests/phases/drift.test.ts (36 tests) 12ms
 ✓ tests/metrics/footer-aggregator.test.ts (11 tests) 9ms
 ✓ tests/phases/runner-token-capture.test.ts (8 tests) 13ms
 ✓ tests/context/assembler.test.ts (83 tests) 2368ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=1 trackedRepos[0].path===cwd → raw diff without ### repo: label 505ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=2 → diff sections with ### repo: label for each repo 900ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N>1 metadata uses "Harness implementation ranges (per tracked repo):" block 761ms
 ✓ tests/integration/codex-session-resume.test.ts (6 tests) 77ms
 ✓ tests/orphan-cleanup.test.ts (20 tests) 33ms
 ✓ tests/phases/ambiguity.test.ts (19 tests) 5ms
 ✓ tests/preflight.test.ts (27 tests | 1 skipped) 227ms
 ✓ tests/resume-light.test.ts (10 tests) 31ms
 ✓ tests/phases/verdict.test.ts (31 tests) 6ms
 ✓ tests/runners/codex-resume.test.ts (8 tests) 63ms
 ✓ tests/commands/inner-footer.test.ts (2 tests) 15ms
 ✓ tests/runners/codex-isolation.test.ts (10 tests) 23ms
 ✓ tests/context/assembler-resume.test.ts (10 tests) 70ms
 ✓ tests/tmux.test.ts (34 tests) 815ms
   ✓ pollForPidFile > returns null on timeout when file never appears 404ms
   ✓ pollForPidFile > returns null when file contains non-numeric content 404ms
reset phase.1.preset
 ✓ tests/commands/config.test.ts (16 tests) 44ms
 ✓ src/phases/gate/stubbornEscalation.test.ts (8 tests) 16ms
 ✓ tests/phases/verify-throw-offending-paths.test.ts (3 tests) 29ms
 ✓ tests/integration/gate-stagnation.test.ts (2 tests) 18ms
 ✓ tests/commands/resume-cmd.test.ts (13 tests) 2683ms
   ✓ resumeCommand > errors when run directory missing 302ms
 ✓ tests/phases/interactive-watchdog.test.ts (6 tests) 10ms
 ✓ tests/resume.test.ts (11 tests) 3050ms
   ✓ resumeRun > clears pendingAction when rerun_gate target already completed 430ms
   ✓ resumeRun > clears pendingAction when rerun_verify and phase 6 completed 453ms
 ✓ tests/state-invalidation.test.ts (5 tests) 6ms
 ✓ tests/phases/gate-feedback-archival.test.ts (2 tests) 65ms
 ✓ tests/runners/claude.test.ts (4 tests) 9ms
 ✓ tests/integration/p6-mid-session-dirt.test.ts (2 tests) 471ms
   ✓ Phase 6 — mid-session dirty tolerance (SC5) > writes dirty_baseline_extended event when a new untracked file appears mid-session 468ms
 ✓ tests/ink/components/CurrentPhase.test.tsx (12 tests) 21ms
 ✓ tests/phases/gate-resume-escalation.test.ts (2 tests) 39ms
 ✓ tests/runners/codex-usage.test.ts (6 tests) 321ms
   ✓ readCodexSessionUsage — pinned sessionId > returns null when file missing 310ms
 ✓ tests/root.test.ts (10 tests) 209ms
 ✓ tests/context/reviewer-contract.test.ts (4 tests) 65ms
 ✓ tests/commands/status-list.test.ts (7 tests) 627ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-aSxmsK/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-aSxmsK/.claude/skills:
  phase-harness-codex-gate-review
 ✓ tests/git.test.ts (24 tests) 2431ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-aasJ8p/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-aasJ8p/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-oX3bI1/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-oX3bI1/.claude/skills:
  phase-harness-codex-gate-review
No skills directory found at /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-kYCmDb/.claude/skills. Nothing to uninstall.
 ✓ tests/uninstall-skills.test.ts (6 tests) 22ms
 ✓ tests/ui-footer.test.ts (9 tests) 6ms
 ✓ src/phases/gate/parseRejectFeedback.test.ts (12 tests) 3ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-kXqzzr/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-jZphnr/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-kw4bzN/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-fBePqY/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-Euxdqi/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-Euxdqi/.claude/skills:
  phase-harness-codex-gate-review
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  carryover feedback path not found on disk, skipping: /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/sk-4XePPc/phase-5-carryover-missing.md
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
[ambiguity] ## Clarity Scores section missing or malformed — fail-open, verdict unchanged
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
