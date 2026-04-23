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

 ✓ tests/artifact.test.ts (23 tests) 3187ms

 Test Files  1 passed (1)
      Tests  23 passed (23)
   Start at  02:32:04
   Duration  3.40s (transform 45ms, setup 0ms, collect 49ms, tests 3.19s, environment 0ms, prepare 38ms)
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

 ✓ tests/phases/verify.test.ts (14 tests) 15ms

 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  02:32:08
   Duration  235ms (transform 36ms, setup 0ms, collect 44ms, tests 15ms, environment 0ms, prepare 28ms)
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

 ✓ tests/state.test.ts (50 tests) 75ms
 ✓ tests/context/skills-rendering.test.ts (45 tests) 127ms
 ✓ tests/phases/runner-claude-resume.test.ts (13 tests) 54ms
 ✓ tests/phases/gate.test.ts (27 tests) 115ms
 ✓ tests/logger.test.ts (32 tests) 136ms
 ✓ tests/commands/inner.test.ts (23 tests) 192ms
[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H ✓ tests/runners/claude-usage.test.ts (17 tests) 113ms
 ✓ tests/phases/terminal-ui.test.ts (18 tests) 109ms
 ✓ tests/signal.test.ts (16 tests) 535ms
 ✓ tests/lock.test.ts (20 tests) 292ms
 ✓ tests/phases/gate-resume.test.ts (13 tests) 231ms
 ✓ tests/integration/logging.test.ts (15 tests) 322ms
 ✓ tests/commands/footer-ticker.test.ts (10 tests) 94ms
 ✓ tests/phases/runner.test.ts (76 tests) 655ms
 ✓ tests/metrics/footer-aggregator.test.ts (11 tests) 12ms
 ✓ tests/orphan-cleanup.test.ts (20 tests) 16ms
 ✓ tests/runners/codex.test.ts (17 tests) 99ms
 ✓ tests/phases/verify.test.ts (14 tests) 21ms
 ✓ tests/preflight.test.ts (27 tests | 1 skipped) 181ms
 ✓ tests/integration/light-flow.test.ts (4 tests) 223ms
 ✓ tests/integration/codex-session-resume.test.ts (6 tests) 80ms
 ✓ tests/resume-light.test.ts (10 tests) 21ms
 ✓ tests/phases/runner-token-capture.test.ts (6 tests) 8ms
 ✓ tests/commands/inner-footer.test.ts (2 tests) 13ms
 ✓ tests/context/assembler.test.ts (72 tests) 1691ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=1 trackedRepos[0].path===cwd → raw diff without ### repo: label 450ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=2 → diff sections with ### repo: label for each repo 516ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N>1 metadata uses "Harness implementation ranges (per tracked repo):" block 528ms
 ✓ tests/runners/codex-resume.test.ts (8 tests) 65ms
 ✓ tests/tmux.test.ts (33 tests) 814ms
   ✓ pollForPidFile > returns null on timeout when file never appears 405ms
   ✓ pollForPidFile > returns null when file contains non-numeric content 403ms
 ✓ tests/phases/interactive-watchdog.test.ts (6 tests) 9ms
 ✓ tests/context/assembler-resume.test.ts (9 tests) 78ms
 ✓ tests/runners/codex-isolation.test.ts (8 tests) 19ms
 ✓ tests/state-invalidation.test.ts (5 tests) 8ms
 ✓ tests/phases/gate-feedback-archival.test.ts (2 tests) 73ms
[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H ✓ tests/ui.test.ts (8 tests) 5ms
 ✓ tests/runners/claude.test.ts (4 tests) 10ms
 ✓ tests/commands/resume-cmd.test.ts (12 tests) 2252ms
   ✓ resumeCommand > harness resume --light (rejected) > exits non-zero with a flow-frozen message 368ms
 ✓ tests/phases/verdict.test.ts (16 tests) 4ms
 ✓ tests/root.test.ts (10 tests) 159ms
 ✓ tests/resume.test.ts (11 tests) 2893ms
   ✓ resumeRun > exits with code 1 and non-interactive message on paused run with null pendingAction (D4b) 311ms
   ✓ resumeRun > skip_phase Phase 6 with gitignored eval report: skips commit and leaves evalCommit null 336ms
   ✓ completeInteractivePhaseFromFreshSentinel — Phase 5 multi-repo (FR-8) > returns true and sets implHead when any repo advanced 541ms
 ✓ tests/context/reviewer-contract.test.ts (4 tests) 50ms
 ✓ tests/commands/status-list.test.ts (7 tests) 568ms
 ✓ tests/phases/gate-resume-escalation.test.ts (1 test) 35ms
 ✓ tests/ui-footer.test.ts (9 tests) 3ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-OgNDQN/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-SyHh89/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-OgNDQN/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-RCNt03/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-yioQhC/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-yioQhC/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-rvCbKL/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-SowOoO/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-SowOoO/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-vHWkPh/.claude/skills:
  phase-harness-codex-gate-review
No skills directory found at /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-P7vq2g/.claude/skills. Nothing to uninstall.
 ✓ tests/uninstall-skills.test.ts (6 tests) 39ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-AFl3AV/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-AFl3AV/.claude/skills:
  phase-harness-codex-gate-review
 ✓ tests/install-skills.test.ts (7 tests) 50ms
 ✓ tests/integration/lifecycle.test.ts (11 tests) 1484ms
   ✓ CLI lifecycle integration > harness --help works 301ms
 ✓ tests/git.test.ts (20 tests) 2142ms
   ✓ isAncestor > returns false when not an ancestor 374ms
 ✓ tests/input.test.ts (12 tests) 4ms
 ✓ tests/commands/jump.test.ts (6 tests) 702ms
 ✓ tests/task-prompt.test.ts (7 tests) 4ms
 ✓ tests/multi-worktree.test.ts (11 tests) 2945ms
   ✓ (a) depth=1 auto-detect — non-git outer cwd > detects exactly depth=1 git repos, skips non-git dirs 558ms
   ✓ (b) --track / --exclude flag combinations > --track replaces auto-detect 437ms
   ✓ (b) --track / --exclude flag combinations > --exclude removes from auto-detect 728ms
   ✓ (c) assembler diff concat for N=2 repos > includes ### repo: label for each repo in N=2 case 421ms
   ✓ (d) Phase 5 success: one-of-N advanced > returns true when only repo-a advanced in a 2-repo setup 582ms
 ✓ tests/terminal.test.ts (5 tests) 2ms
[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H ✓ tests/ui-prompt-model-config.test.ts (3 tests) 5ms
 ✓ tests/conformance/phase-models.test.ts (9 tests) 4ms
 ✓ tests/preflight-claude-at-file.test.ts (2 tests) 4ms
 ✓ tests/ui-separator.test.ts (5 tests) 2ms
 ✓ tests/process.test.ts (6 tests) 24ms
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
⚠️  carryover feedback path not found on disk, skipping: /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/sk-dx9QKJ/phase-5-carryover-missing.md
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
