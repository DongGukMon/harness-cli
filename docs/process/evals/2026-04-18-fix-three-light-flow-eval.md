# Auto Verification Report
- Date: 2026-04-19
- Related Spec: N/A
- Related Plan: N/A

## Results
| Check | Status | Detail |
|-------|--------|--------|
| typecheck | pass |  |
| tests | pass |  |
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

### tests
**Command:** `pnpm vitest run`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

 RUN  v2.1.9 /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/dogfood-light

 ✓ tests/state.test.ts (36 tests) 56ms
 ✓ tests/logger.test.ts (24 tests) 118ms
 ✓ tests/phases/gate.test.ts (24 tests) 113ms
 ✓ tests/phases/gate-resume.test.ts (13 tests) 128ms
 ✓ tests/commands/inner.test.ts (13 tests) 164ms
 ✓ tests/integration/logging.test.ts (15 tests) 198ms
 ✓ tests/context/assembler.test.ts (25 tests) 288ms
 ✓ tests/runners/claude-usage.test.ts (12 tests) 67ms
 ✓ tests/context/skills-rendering.test.ts (12 tests) 48ms
 ✓ tests/lock.test.ts (20 tests) 446ms
 ✓ tests/integration/codex-session-resume.test.ts (6 tests) 94ms
 ✓ tests/phases/runner.test.ts (68 tests) 464ms
 ✓ tests/preflight.test.ts (29 tests | 1 skipped) 282ms
 ✓ tests/signal.test.ts (16 tests) 519ms
 ✓ tests/phases/runner-token-capture.test.ts (6 tests) 11ms
 ✓ tests/phases/verify.test.ts (12 tests) 19ms
 ✓ tests/runners/codex-resume.test.ts (7 tests) 196ms
 ✓ tests/context/assembler-resume.test.ts (9 tests) 192ms
 ✓ tests/state-invalidation.test.ts (5 tests) 19ms
 ✓ tests/integration/light-flow.test.ts (2 tests) 121ms
 ✓ tests/tmux.test.ts (33 tests) 819ms
   ✓ pollForPidFile > returns null on timeout when file never appears 408ms
   ✓ pollForPidFile > returns null when file contains non-numeric content 404ms
 ✓ tests/root.test.ts (10 tests) 238ms
 ✓ tests/resume-light.test.ts (4 tests) 6ms
[2J[H[2J[H[2J[H[2J[H[2J[H ✓ tests/ui.test.ts (5 tests) 5ms
 ✓ tests/context/reviewer-contract.test.ts (4 tests) 73ms
 ✓ tests/input.test.ts (12 tests) 6ms
 ✓ tests/commands/status-list.test.ts (7 tests) 742ms
 ✓ tests/phases/verdict.test.ts (7 tests) 2ms
 ✓ tests/terminal.test.ts (5 tests) 3ms
 ✓ tests/commands/jump.test.ts (6 tests) 855ms
 ✓ tests/resume.test.ts (6 tests) 1603ms
 ✓ tests/conformance/phase-models.test.ts (9 tests) 2ms
 ✓ tests/ui-separator.test.ts (5 tests) 2ms
 ✓ tests/process.test.ts (6 tests) 35ms
 ✓ tests/git.test.ts (16 tests) 1687ms
 ✓ tests/commands/skip.test.ts (4 tests) 542ms
 ✓ tests/integration/lifecycle.test.ts (11 tests) 1485ms
 ✓ tests/commands/resume-cmd.test.ts (12 tests) 2309ms
 ✓ tests/runners/claude.test.ts (1 test) 10ms
 ✓ tests/runners/codex.test.ts (1 test) 10ms
 ✓ tests/phases/interactive.test.ts (37 tests) 3266ms
   ✓ validatePhaseArtifacts — Phase 5 > returns true when HEAD has advanced and working tree is clean 352ms
   ✓ runInteractivePhase — Claude dispatch command shape > sendKeysToPane command includes --dangerously-skip-permissions and --effort 1628ms
 ✓ tests/artifact.test.ts (12 tests) 2630ms
   ✓ normalizeArtifactCommit > creates commit for new untracked file 439ms
   ✓ normalizeArtifactCommit > recovers from interrupted git add (target-only staged) 357ms
 ✓ tests/commands/run.test.ts (15 tests) 3483ms
   ✓ startCommand > accepts empty task as untitled 490ms
   ✓ startCommand > accepts whitespace-only task as untitled 336ms
   ✓ startCommand > creates run directory with state.json + task.md 391ms
   ✓ startCommand > creates required directories 370ms
   ✓ startCommand > adds .harness/ to .gitignore 333ms

 Test Files  43 passed (43)
      Tests  581 passed | 1 skipped (582)
   Start at  00:08:41
   Duration  4.54s (transform 1.47s, setup 0ms, collect 3.57s, tests 23.36s, environment 6ms, prepare 2.46s)
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```
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
    --inter-hunk-context <n>
                          show context between diff hunks up to the specified number of lines
    --output-indicator-new <char>
```

</details>

### build
**Command:** `pnpm build`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

> harness-cli@0.1.0 build /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/dogfood-light
> tsc && node scripts/copy-assets.mjs

[copy-assets] copied src/context/prompts -> dist/src/context/prompts
[copy-assets] copied src/context/skills -> dist/src/context/skills
[copy-assets] copied src/context/playbooks -> dist/src/context/playbooks
[copy-assets] copied scripts/harness-verify.sh -> dist/scripts/harness-verify.sh
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```

```

</details>
