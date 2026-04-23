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

 ✓ tests/artifact.test.ts (23 tests) 3135ms

 Test Files  1 passed (1)
      Tests  23 passed (23)
   Start at  02:19:11
   Duration  3.46s (transform 67ms, setup 0ms, collect 90ms, tests 3.14s, environment 0ms, prepare 49ms)
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

 ✓ tests/phases/verify.test.ts (14 tests) 9ms

 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  02:19:15
   Duration  224ms (transform 40ms, setup 0ms, collect 48ms, tests 9ms, environment 0ms, prepare 34ms)
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

 ✓ tests/state.test.ts (50 tests) 50ms
 ✓ tests/logger.test.ts (32 tests) 78ms
 ✓ tests/context/skills-rendering.test.ts (45 tests) 79ms
 ✓ tests/phases/gate.test.ts (27 tests) 84ms
 ✓ tests/phases/runner-claude-resume.test.ts (13 tests) 46ms
 ✓ tests/commands/inner.test.ts (23 tests) 170ms
[2J[H ✓ tests/runners/claude-usage.test.ts (17 tests) 70ms
[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H ✓ tests/phases/terminal-ui.test.ts (18 tests) 109ms
 ✓ tests/signal.test.ts (16 tests) 499ms
 ✓ tests/commands/footer-ticker.test.ts (10 tests) 79ms
 ✓ tests/phases/gate-resume.test.ts (13 tests) 249ms
 ✓ tests/lock.test.ts (20 tests) 286ms
 ✓ tests/phases/runner.test.ts (76 tests) 580ms
 ✓ tests/integration/logging.test.ts (15 tests) 444ms
   ✓ Integration: real-wiring runPhaseLoop with mocked runners > bootstrap → phase loop with mocked runners → summary produced 361ms
 ✓ tests/metrics/footer-aggregator.test.ts (11 tests) 11ms
 ✓ tests/phases/verify.test.ts (14 tests) 17ms
 ✓ tests/orphan-cleanup.test.ts (20 tests) 15ms
 ✓ tests/runners/codex.test.ts (17 tests) 83ms
 ✓ tests/preflight.test.ts (27 tests | 1 skipped) 236ms
 ✓ tests/integration/light-flow.test.ts (4 tests) 193ms
 ✓ tests/integration/codex-session-resume.test.ts (6 tests) 43ms
 ✓ tests/resume-light.test.ts (10 tests) 15ms
 ✓ tests/phases/runner-token-capture.test.ts (6 tests) 15ms
 ✓ tests/context/assembler.test.ts (72 tests) 1658ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=1 trackedRepos[0].path===cwd → raw diff without ### repo: label 462ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=2 → diff sections with ### repo: label for each repo 512ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N>1 metadata uses "Harness implementation ranges (per tracked repo):" block 511ms
 ✓ tests/commands/inner-footer.test.ts (2 tests) 15ms
 ✓ tests/runners/codex-resume.test.ts (8 tests) 66ms
 ✓ tests/context/assembler-resume.test.ts (9 tests) 72ms
 ✓ tests/phases/interactive-watchdog.test.ts (6 tests) 7ms
 ✓ tests/tmux.test.ts (33 tests) 814ms
   ✓ pollForPidFile > returns null on timeout when file never appears 404ms
   ✓ pollForPidFile > returns null when file contains non-numeric content 404ms
 ✓ tests/phases/gate-feedback-archival.test.ts (2 tests) 70ms
 ✓ tests/state-invalidation.test.ts (5 tests) 18ms
 ✓ tests/runners/codex-isolation.test.ts (8 tests) 37ms
[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H ✓ tests/ui.test.ts (8 tests) 4ms
 ✓ tests/runners/claude.test.ts (4 tests) 5ms
 ✓ tests/phases/verdict.test.ts (16 tests) 3ms
 ✓ tests/commands/resume-cmd.test.ts (12 tests) 1916ms
 ✓ tests/root.test.ts (10 tests) 172ms
 ✓ tests/resume.test.ts (11 tests) 2845ms
   ✓ resumeRun > exits with code 1 and non-interactive message on paused run with null pendingAction (D4b) 313ms
   ✓ resumeRun > skip_phase Phase 6 with gitignored eval report: skips commit and leaves evalCommit null 308ms
   ✓ completeInteractivePhaseFromFreshSentinel — Phase 5 multi-repo (FR-8) > returns true and sets implHead when any repo advanced 408ms
 ✓ tests/commands/status-list.test.ts (7 tests) 593ms
 ✓ tests/context/reviewer-contract.test.ts (4 tests) 50ms
 ✓ tests/phases/gate-resume-escalation.test.ts (1 test) 26ms
 ✓ tests/ui-footer.test.ts (9 tests) 4ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-5pKvUI/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-5pKvUI/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-9OoGNM/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-9OoGNM/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-klKgB6/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-klKgB6/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-voV4X9/.claude/skills:
  phase-harness-codex-gate-review
No skills directory found at /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-cBeW3j/.claude/skills. Nothing to uninstall.
 ✓ tests/uninstall-skills.test.ts (6 tests) 16ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-MJGFhy/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-FXjTY6/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-Xzpvl3/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-Q0rwOE/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-Q0rwOE/.claude/skills:
  phase-harness-codex-gate-review
 ✓ tests/git.test.ts (20 tests) 1851ms
 ✓ tests/install-skills.test.ts (7 tests) 16ms
 ✓ tests/integration/lifecycle.test.ts (11 tests) 1334ms
 ✓ tests/input.test.ts (12 tests) 3ms
 ✓ tests/task-prompt.test.ts (7 tests) 4ms
 ✓ tests/multi-worktree.test.ts (11 tests) 2609ms
   ✓ (a) depth=1 auto-detect — non-git outer cwd > detects exactly depth=1 git repos, skips non-git dirs 547ms
   ✓ (b) --track / --exclude flag combinations > --track replaces auto-detect 407ms
   ✓ (b) --track / --exclude flag combinations > --exclude removes from auto-detect 518ms
   ✓ (c) assembler diff concat for N=2 repos > includes ### repo: label for each repo in N=2 case 419ms
   ✓ (d) Phase 5 success: one-of-N advanced > returns true when only repo-a advanced in a 2-repo setup 507ms
 ✓ tests/terminal.test.ts (5 tests) 2ms
[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H ✓ tests/ui-prompt-model-config.test.ts (3 tests) 3ms
 ✓ tests/commands/jump.test.ts (6 tests) 702ms
 ✓ tests/preflight-claude-at-file.test.ts (2 tests) 8ms
 ✓ tests/conformance/phase-models.test.ts (9 tests) 4ms
 ✓ tests/ui-separator.test.ts (5 tests) 1ms
 ✓ tests/process.test.ts (6 tests) 33ms
 ✓ tests/scripts/harness-verify.test.ts (2 tests) 408ms
 ✓ tests/config.test.ts (8 tests) 3ms
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  claude session resume fallback: no prior attempt id
⚠️  claude session resume fallback: no prior attempt id
⚠️  carryover feedback path not found on disk, skipping: /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/sk-bdwDZ4/phase-5-carryover-missing.md
⚠️  claude session resume fallback: no prior attempt id
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
