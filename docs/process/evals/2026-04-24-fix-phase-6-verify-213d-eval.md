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

 ✓ tests/artifact.test.ts (22 tests) 2974ms

 Test Files  1 passed (1)
      Tests  22 passed (22)
   Start at  02:14:26
   Duration  3.19s (transform 40ms, setup 0ms, collect 45ms, tests 2.97s, environment 0ms, prepare 37ms)
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

 ✓ tests/phases/verify.test.ts (14 tests) 10ms

 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  02:14:29
   Duration  213ms (transform 37ms, setup 0ms, collect 43ms, tests 10ms, environment 0ms, prepare 27ms)
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

 ✓ tests/state.test.ts (50 tests) 39ms
 ✓ tests/logger.test.ts (32 tests) 49ms
 ✓ tests/context/skills-rendering.test.ts (45 tests) 59ms
 ✓ tests/phases/gate.test.ts (27 tests) 88ms
 ✓ tests/phases/runner-claude-resume.test.ts (13 tests) 57ms
 ✓ tests/commands/inner.test.ts (23 tests) 184ms
[2J[H ✓ tests/runners/claude-usage.test.ts (17 tests) 123ms
[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H ✓ tests/phases/terminal-ui.test.ts (18 tests) 123ms
 ✓ tests/integration/logging.test.ts (15 tests) 355ms
 ✓ tests/signal.test.ts (16 tests) 507ms
 ✓ tests/commands/footer-ticker.test.ts (10 tests) 74ms
 ✓ tests/phases/gate-resume.test.ts (13 tests) 174ms
 ✓ tests/lock.test.ts (20 tests) 274ms
 ✓ tests/phases/runner.test.ts (76 tests) 597ms
 ✓ tests/metrics/footer-aggregator.test.ts (11 tests) 5ms
 ✓ tests/orphan-cleanup.test.ts (20 tests) 33ms
 ✓ tests/phases/verify.test.ts (14 tests) 23ms
 ✓ tests/runners/codex.test.ts (17 tests) 86ms
 ✓ tests/preflight.test.ts (27 tests | 1 skipped) 319ms
 ✓ tests/integration/codex-session-resume.test.ts (6 tests) 102ms
 ✓ tests/integration/light-flow.test.ts (4 tests) 222ms
 ✓ tests/resume-light.test.ts (10 tests) 35ms
 ✓ tests/context/assembler.test.ts (72 tests) 1818ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=1 trackedRepos[0].path===cwd → raw diff without ### repo: label 434ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=2 → diff sections with ### repo: label for each repo 574ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N>1 metadata uses "Harness implementation ranges (per tracked repo):" block 584ms
 ✓ tests/phases/runner-token-capture.test.ts (6 tests) 10ms
 ✓ tests/commands/inner-footer.test.ts (2 tests) 14ms
 ✓ tests/runners/codex-resume.test.ts (8 tests) 58ms
 ✓ tests/tmux.test.ts (33 tests) 819ms
   ✓ pollForPidFile > returns null on timeout when file never appears 405ms
   ✓ pollForPidFile > returns null when file contains non-numeric content 407ms
 ✓ tests/context/assembler-resume.test.ts (9 tests) 67ms
 ✓ tests/phases/interactive-watchdog.test.ts (6 tests) 6ms
 ✓ tests/runners/codex-isolation.test.ts (8 tests) 43ms
 ✓ tests/state-invalidation.test.ts (5 tests) 26ms
 ✓ tests/phases/gate-feedback-archival.test.ts (2 tests) 51ms
 ✓ tests/commands/resume-cmd.test.ts (12 tests) 2020ms
[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H ✓ tests/ui.test.ts (8 tests) 5ms
 ✓ tests/runners/claude.test.ts (4 tests) 9ms
 ✓ tests/phases/verdict.test.ts (16 tests) 4ms
 ✓ tests/root.test.ts (10 tests) 153ms
 ✓ tests/resume.test.ts (11 tests) 2793ms
   ✓ resumeRun > exits with code 1 and non-interactive message on paused run with null pendingAction (D4b) 330ms
 ✓ tests/context/reviewer-contract.test.ts (4 tests) 42ms
 ✓ tests/commands/status-list.test.ts (7 tests) 559ms
 ✓ tests/phases/gate-resume-escalation.test.ts (1 test) 31ms
 ✓ tests/ui-footer.test.ts (9 tests) 3ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-97jOsI/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-f58etV/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-97jOsI/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-xBCmBD/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-ohUVuB/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-xBCmBD/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-cls6Dz/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-GXcC2d/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-cls6Dz/.claude/skills:
  phase-harness-codex-gate-review
No skills directory found at /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-qlO4rw/.claude/skills. Nothing to uninstall.
 ✓ tests/uninstall-skills.test.ts (6 tests) 21ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-6AHN2b/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-kUvz7z/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-kUvz7z/.claude/skills:
  phase-harness-codex-gate-review
 ✓ tests/install-skills.test.ts (7 tests) 25ms
 ✓ tests/integration/lifecycle.test.ts (11 tests) 1171ms
 ✓ tests/input.test.ts (12 tests) 3ms
 ✓ tests/commands/jump.test.ts (6 tests) 672ms
 ✓ tests/git.test.ts (20 tests) 1811ms
 ✓ tests/multi-worktree.test.ts (11 tests) 2595ms
   ✓ (a) depth=1 auto-detect — non-git outer cwd > detects exactly depth=1 git repos, skips non-git dirs 607ms
   ✓ (b) --track / --exclude flag combinations > --track replaces auto-detect 453ms
   ✓ (b) --track / --exclude flag combinations > --exclude removes from auto-detect 425ms
   ✓ (c) assembler diff concat for N=2 repos > includes ### repo: label for each repo in N=2 case 409ms
   ✓ (d) Phase 5 success: one-of-N advanced > returns true when only repo-a advanced in a 2-repo setup 468ms
 ✓ tests/task-prompt.test.ts (7 tests) 2ms
 ✓ tests/terminal.test.ts (5 tests) 2ms
[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H ✓ tests/ui-prompt-model-config.test.ts (3 tests) 2ms
 ✓ tests/preflight-claude-at-file.test.ts (2 tests) 5ms
 ✓ tests/conformance/phase-models.test.ts (9 tests) 3ms
 ✓ tests/scripts/harness-verify.test.ts (2 tests) 363ms
 ✓ tests/process.test.ts (6 tests) 21ms
 ✓ tests/ui-separator.test.ts (5 tests) 1ms
 ✓ tests/config.test.ts (8 tests) 2ms
 ✓ tests/resolve-skills-root.test.ts (4 tests) 2ms
 ✓ tests/commands/skip.test.ts (4 tests) 390ms
 ✓ tests/phases/eval-report-commit-squash.test.ts (6 tests) 3837ms
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  claude session resume fallback: no prior attempt id
⚠️  carryover feedback path not found on disk, skipping: /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/sk-Bd3G5l/phase-5-carryover-missing.md
⚠️  claude session resume fallback: no prior attempt id
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
