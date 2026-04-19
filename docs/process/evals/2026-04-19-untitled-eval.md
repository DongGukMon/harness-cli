# Auto Verification Report
- Date: 2026-04-19
- Related Spec: N/A
- Related Plan: N/A

## Results
| Check | Status | Detail |
|-------|--------|--------|
| typecheck | pass |  |
| test | pass |  |
| build | pass |  |
| cli-name-phase-harness | pass |  |
| cli-name-not-harness-generic | pass |  |
| install-skills-help | pass |  |
| uninstall-skills-help | pass |  |
| standalone-skill-vendored | pass |  |
| standalone-skill-in-dist | pass |  |

## Summary
- Total: 9 checks
- Pass: 9
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

 RUN  v2.1.9 /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/install-skills

 ✓ tests/state.test.ts (45 tests) 43ms
 ✓ tests/context/skills-rendering.test.ts (45 tests) 59ms
 ✓ tests/logger.test.ts (32 tests) 107ms
 ✓ tests/phases/gate.test.ts (27 tests) 103ms
 ✓ tests/commands/inner.test.ts (20 tests) 161ms
 ✓ tests/lock.test.ts (20 tests) 379ms
 ✓ tests/context/assembler.test.ts (64 tests) 424ms
 ✓ tests/phases/runner.test.ts (76 tests) 447ms
 ✓ tests/integration/logging.test.ts (15 tests) 495ms
   ✓ Integration: real-wiring runPhaseLoop with mocked runners > bootstrap → phase loop with mocked runners → summary produced 428ms
[2J[H[2J[H ✓ tests/commands/footer-ticker.test.ts (10 tests) 69ms
 ✓ tests/phases/gate-resume.test.ts (13 tests) 116ms
[2J[H[2J[H ✓ tests/signal.test.ts (16 tests) 707ms
[2J[H[2J[H[2J[H[2J[H ✓ tests/phases/terminal-ui.test.ts (17 tests) 86ms
 ✓ tests/preflight.test.ts (29 tests | 1 skipped) 185ms
 ✓ tests/runners/claude-usage.test.ts (13 tests) 50ms
 ✓ tests/metrics/footer-aggregator.test.ts (11 tests) 23ms
 ✓ tests/integration/codex-session-resume.test.ts (6 tests) 82ms
 ✓ tests/commands/inner-footer.test.ts (2 tests) 21ms
 ✓ tests/phases/runner-token-capture.test.ts (6 tests) 17ms
 ✓ tests/resume-light.test.ts (10 tests) 70ms
 ✓ tests/integration/light-flow.test.ts (4 tests) 214ms
 ✓ tests/runners/codex-resume.test.ts (8 tests) 57ms
 ✓ tests/phases/verify.test.ts (12 tests) 8ms
 ✓ tests/phases/interactive-watchdog.test.ts (6 tests) 8ms
 ✓ tests/context/assembler-resume.test.ts (9 tests) 75ms
 ✓ tests/phases/gate-feedback-archival.test.ts (2 tests) 43ms
 ✓ tests/runners/codex-isolation.test.ts (8 tests) 17ms
[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H ✓ tests/ui.test.ts (8 tests) 6ms
 ✓ tests/state-invalidation.test.ts (5 tests) 15ms
 ✓ tests/runners/codex.test.ts (6 tests) 36ms
 ✓ tests/phases/verdict.test.ts (16 tests) 3ms
 ✓ tests/tmux.test.ts (33 tests) 835ms
   ✓ pollForPidFile > returns null on timeout when file never appears 425ms
   ✓ pollForPidFile > returns null when file contains non-numeric content 403ms
 ✓ tests/root.test.ts (10 tests) 166ms
 ✓ tests/phases/gate-resume-escalation.test.ts (1 test) 44ms
 ✓ tests/context/reviewer-contract.test.ts (4 tests) 48ms
 ✓ tests/commands/status-list.test.ts (7 tests) 644ms
 ✓ tests/ui-footer.test.ts (9 tests) 4ms
 ✓ tests/resume.test.ts (6 tests) 1338ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-Wkstl2/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-Wkstl2/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-NuHpoa/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-NuHpoa/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-hOgM8g/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-hOgM8g/.claude/skills:
  phase-harness-codex-gate-review
No skills directory found at /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-WXqfIJ/.claude/skills. Nothing to uninstall.
 ✓ tests/uninstall-skills.test.ts (6 tests) 21ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-3PnEyV/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-zuGVKw/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-vhDwG2/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-S000CG/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-J4P2BL/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-J4P2BL/.claude/skills:
  phase-harness-codex-gate-review
 ✓ tests/install-skills.test.ts (7 tests) 18ms
 ✓ tests/input.test.ts (12 tests) 2ms
 ✓ tests/commands/jump.test.ts (6 tests) 753ms
 ✓ tests/task-prompt.test.ts (7 tests) 2ms
 ✓ tests/commands/resume-cmd.test.ts (12 tests) 1937ms
 ✓ tests/git.test.ts (16 tests) 1414ms
 ✓ tests/integration/lifecycle.test.ts (11 tests) 1285ms
[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H[2J[H ✓ tests/ui-prompt-model-config.test.ts (3 tests) 2ms
 ✓ tests/conformance/phase-models.test.ts (9 tests) 3ms
 ✓ tests/terminal.test.ts (5 tests) 2ms
 ✓ tests/preflight-claude-at-file.test.ts (2 tests) 3ms
 ✓ tests/ui-separator.test.ts (5 tests) 2ms
 ✓ tests/process.test.ts (6 tests) 35ms
 ✓ tests/config.test.ts (8 tests) 4ms
 ✓ tests/resolve-skills-root.test.ts (4 tests) 1ms
 ✓ tests/runners/claude.test.ts (1 test) 16ms
 ✓ tests/phases/interactive.test.ts (45 tests) 3193ms
   ✓ runInteractivePhase — Claude dispatch command shape > sendKeysToPane command includes --dangerously-skip-permissions and --effort 1589ms
 ✓ tests/commands/skip.test.ts (4 tests) 378ms
 ✓ tests/artifact.test.ts (12 tests) 2494ms
   ✓ normalizeArtifactCommit > recovers from interrupted git add (target-only staged) 349ms
   ✓ runPhase6Preconditions > git rm stages tracked eval report deletion without creating a reset commit 367ms
 ✓ tests/phases/eval-report-commit-squash.test.ts (6 tests) 3086ms
   ✓ eval report commit squash > stages tracked eval report deletion without creating a reset commit and commits one rev-K report per round 1070ms
   ✓ eval report commit squash > treats an already-staged eval report deletion as an idempotent precondition 554ms
   ✓ eval report commit squash > resumes cleanly from the staged-D crash window and produces exactly one new rev-K commit 725ms
   ✓ eval report commit squash > uses the rev-K eval report message on both resume recovery paths 319ms
 ✓ tests/commands/run.test.ts (17 tests) 3577ms
   ✓ startCommand > accepts empty task as untitled 339ms
   ✓ startCommand > accepts whitespace-only task as untitled 308ms
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  carryover feedback path not found on disk, skipping: /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/sk-ZMHspr/phase-5-carryover-missing.md
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

> phase-harness@0.1.0 build /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/install-skills
> tsc && node scripts/copy-assets.mjs

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

### cli-name-phase-harness
**Command:** `node dist/bin/harness.js --help | grep -q 'phase-harness'`
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

### cli-name-not-harness-generic
**Command:** `! node dist/bin/harness.js --help | grep -qE '^Usage: harness( |$)'`
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

### install-skills-help
**Command:** `node dist/bin/harness.js install-skills --help | grep -q 'install-skills'`
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

### uninstall-skills-help
**Command:** `node dist/bin/harness.js uninstall-skills --help | grep -q 'uninstall-skills'`
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

### standalone-skill-vendored
**Command:** `test -f src/context/skills-standalone/codex-gate-review/SKILL.md && grep -q 'name: phase-harness-codex-gate-review' src/context/skills-standalone/codex-gate-review/SKILL.md`
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

### standalone-skill-in-dist
**Command:** `test -f dist/src/context/skills-standalone/codex-gate-review/SKILL.md`
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
