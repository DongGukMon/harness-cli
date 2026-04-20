# Auto Verification Report
- Date: 2026-04-20
- Related Spec: N/A
- Related Plan: N/A

## Results
| Check | Status | Detail |
|-------|--------|--------|
| typecheck | pass |  |
| unit-and-integration-tests | pass |  |
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

### unit-and-integration-tests
**Command:** `pnpm vitest run`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

 RUN  v2.1.9 /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/name-duplication

 ✓ tests/logger.test.ts (32 tests) 38ms
 ✓ tests/state.test.ts (45 tests) 38ms
 ✓ tests/context/skills-rendering.test.ts (45 tests) 42ms
 ✓ tests/phases/gate.test.ts (27 tests) 84ms
 ✓ tests/phases/runner-claude-resume.test.ts (13 tests) 38ms
 ✓ tests/commands/inner.test.ts (20 tests) 228ms
 ✓ tests/integration/logging.test.ts (15 tests) 233ms
 ✓ tests/runners/claude-usage.test.ts (17 tests) 172ms
 ✓ tests/phases/gate-resume.test.ts (13 tests) 191ms
 ✓ tests/commands/footer-ticker.test.ts (10 tests) 134ms
 ✓ tests/context/assembler.test.ts (64 tests) 386ms
 ✓ tests/lock.test.ts (20 tests) 262ms
 ✓ tests/preflight.test.ts (29 tests | 1 skipped) 233ms
 ✓ tests/signal.test.ts (16 tests) 483ms
 ✓ tests/phases/runner.test.ts (76 tests) 473ms
[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H ✓ tests/phases/terminal-ui.test.ts (17 tests) 65ms
 ✓ tests/metrics/footer-aggregator.test.ts (11 tests) 7ms
 ✓ tests/orphan-cleanup.test.ts (20 tests) 18ms
 ✓ tests/commands/inner-footer.test.ts (2 tests) 19ms
 ✓ tests/phases/runner-token-capture.test.ts (6 tests) 20ms
 ✓ tests/integration/codex-session-resume.test.ts (6 tests) 79ms
 ✓ tests/resume-light.test.ts (10 tests) 52ms
 ✓ tests/integration/light-flow.test.ts (4 tests) 214ms
 ✓ tests/runners/codex-resume.test.ts (8 tests) 60ms
 ✓ tests/phases/verify.test.ts (12 tests) 10ms
 ✓ tests/phases/interactive-watchdog.test.ts (6 tests) 6ms
 ✓ tests/context/assembler-resume.test.ts (9 tests) 69ms
[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H ✓ tests/ui.test.ts (8 tests) 5ms
 ✓ tests/phases/gate-feedback-archival.test.ts (2 tests) 60ms
 ✓ tests/runners/codex-isolation.test.ts (8 tests) 40ms
 ✓ tests/state-invalidation.test.ts (5 tests) 10ms
 ✓ tests/runners/codex.test.ts (6 tests) 35ms
 ✓ tests/phases/verdict.test.ts (16 tests) 3ms
 ✓ tests/tmux.test.ts (33 tests) 819ms
   ✓ pollForPidFile > returns null on timeout when file never appears 411ms
   ✓ pollForPidFile > returns null when file contains non-numeric content 403ms
 ✓ tests/runners/claude.test.ts (3 tests) 5ms
 ✓ tests/root.test.ts (10 tests) 160ms
 ✓ tests/context/reviewer-contract.test.ts (4 tests) 53ms
 ✓ tests/resume.test.ts (6 tests) 1168ms
 ✓ tests/phases/gate-resume-escalation.test.ts (1 test) 45ms
 ✓ tests/ui-footer.test.ts (9 tests) 3ms
 ✓ tests/git.test.ts (17 tests) 1359ms
 ✓ tests/commands/status-list.test.ts (7 tests) 658ms
 ✓ tests/commands/resume-cmd.test.ts (12 tests) 1840ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-nIR60K/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-nIR60K/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-ZllTN5/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-ZllTN5/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-IJQTsN/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-IJQTsN/.claude/skills:
  phase-harness-codex-gate-review
No skills directory found at /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-JuYDLV/.claude/skills. Nothing to uninstall.
 ✓ tests/commands/jump.test.ts (6 tests) 719ms
 ✓ tests/uninstall-skills.test.ts (6 tests) 17ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-woOzAA/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-u7jW5L/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-qN9gy5/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-n7ZcCb/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-CqSiS1/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-CqSiS1/.claude/skills:
  phase-harness-codex-gate-review
 ✓ tests/install-skills.test.ts (7 tests) 14ms
 ✓ tests/input.test.ts (12 tests) 3ms
 ✓ tests/task-prompt.test.ts (7 tests) 4ms
[2J[H[2J[H[2J[H[2J[H ✓ tests/terminal.test.ts (5 tests) 2ms
[2J[H[2J[H[2J[H ✓ tests/ui-prompt-model-config.test.ts (3 tests) 4ms
 ✓ tests/integration/lifecycle.test.ts (11 tests) 1312ms
 ✓ tests/preflight-claude-at-file.test.ts (2 tests) 3ms
 ✓ tests/conformance/phase-models.test.ts (9 tests) 3ms
 ✓ tests/process.test.ts (6 tests) 29ms
 ✓ tests/ui-separator.test.ts (5 tests) 2ms
 ✓ tests/config.test.ts (8 tests) 2ms
 ✓ tests/resolve-skills-root.test.ts (4 tests) 1ms
 ✓ tests/commands/skip.test.ts (4 tests) 450ms
 ✓ tests/phases/interactive.test.ts (45 tests) 3151ms
   ✓ runInteractivePhase — Claude dispatch command shape > sendKeysToPane command includes --dangerously-skip-permissions and --effort 1620ms
 ✓ tests/artifact.test.ts (12 tests) 2725ms
   ✓ normalizeArtifactCommit > recovers from interrupted git add (target-only staged) 305ms
   ✓ runPhase6Preconditions > git rm stages tracked eval report deletion without creating a reset commit 380ms
 ✓ tests/phases/eval-report-commit-squash.test.ts (6 tests) 3450ms
   ✓ eval report commit squash > stages tracked eval report deletion without creating a reset commit and commits one rev-K report per round 979ms
   ✓ eval report commit squash > treats an already-staged eval report deletion as an idempotent precondition 521ms
   ✓ eval report commit squash > resumes cleanly from the staged-D crash window and produces exactly one new rev-K commit 769ms
   ✓ eval report commit squash > uses the rev 1 eval report message on the live verify pass path 632ms
   ✓ eval report commit squash > uses the rev-K eval report message on both resume recovery paths 322ms
 ✓ tests/commands/run.test.ts (17 tests) 3951ms
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  carryover feedback path not found on disk, skipping: /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/sk-6X5OPW/phase-5-carryover-missing.md
warning: Not a git repository. Use --no-index to compare two paths outside a working tree
usage: git diff --no-index [<options>] <path> <path>

Diff output format options
    -p, --patch           generate patch
    -s, --no-patch        suppress diff output
    -u                    generate patch
    -U, --unified[=<n>]   generate diffs with <n> lines context
    -W, --[no-]function-context
                          generate diffs with <n> lines context
    --raw                 generate the diff in raw format
    --patch-with-raw      synonym for '-p --raw'
    --patch-with-stat     synonym for '-p --stat'
    --numstat             machine friendly --stat
    --shortstat           output only the last line of --stat
    -X, --dirstat[=<param1>,<param2>...]
                          output the distribution of relative amount of changes for each sub-directory
    --cumulative          synonym for --dirstat=cumulative
    --dirstat-by-file[=<param1>,<param2>...]
                          synonym for --dirstat=files,<param1>,<param2>...
    --check               warn if changes introduce conflict markers or whitespace errors
    --summary             condensed summary such as creations, renames and mode changes
    --name-only           show only names of changed files
    --name-status         show only names and status of changed files
    --stat[=<width>[,<name-width>[,<count>]]]
                          generate diffstat
    --stat-width <width>  generate diffstat with a given width
    --stat-name-width <width>
                          generate diffstat with a given name width
    --stat-graph-width <width>
                          generate diffstat with a given graph width
    --stat-count <count>  generate diffstat with limited lines
    --[no-]compact-summary
                          generate compact summary in diffstat
    --binary              output a binary diff that can be applied
    --[no-]full-index     show full pre- and post-image object names on the "index" lines
    --[no-]color[=<when>] show colored diff
    --ws-error-highlight <kind>
                          highlight whitespace errors in the 'context', 'old' or 'new' lines in the diff
    -z                    do not munge pathnames and use NULs as output field terminators in --raw or --numstat
    --[no-]abbrev[=<n>]   use <n> digits to display object names
    --src-prefix <prefix> show the given source prefix instead of "a/"
    --dst-prefix <prefix> show the given destination prefix instead of "b/"
    --line-prefix <prefix>
                          prepend an additional prefix to every line of output
    --no-prefix           do not show any source or destination prefix
    --default-prefix      use default prefixes a/ and b/
```

</details>

### build
**Command:** `pnpm build`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

> phase-harness@0.2.2 build /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/name-duplication
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
