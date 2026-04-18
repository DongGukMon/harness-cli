# Auto Verification Report
- Date: 2026-04-18
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

 ✓ tests/state.test.ts (36 tests) 63ms
 ✓ tests/logger.test.ts (24 tests) 111ms
 ✓ tests/phases/gate.test.ts (24 tests) 107ms
 ✓ tests/commands/inner.test.ts (13 tests) 113ms
 ✓ tests/phases/gate-resume.test.ts (13 tests) 172ms
 ✓ tests/context/assembler.test.ts (25 tests) 322ms
 ✓ tests/integration/logging.test.ts (15 tests) 193ms
 ✓ tests/context/skills-rendering.test.ts (12 tests) 31ms
 ✓ tests/runners/claude-usage.test.ts (11 tests) 76ms
 ✓ tests/lock.test.ts (20 tests) 466ms
 ✓ tests/integration/codex-session-resume.test.ts (6 tests) 81ms
 ✓ tests/phases/runner.test.ts (68 tests) 468ms
 ✓ tests/signal.test.ts (16 tests) 518ms
 ✓ tests/preflight.test.ts (29 tests | 1 skipped) 256ms
 ✓ tests/phases/runner-token-capture.test.ts (6 tests) 15ms
 ✓ tests/phases/verify.test.ts (12 tests) 11ms
 ✓ tests/context/assembler-resume.test.ts (9 tests) 109ms
 ✓ tests/runners/codex-resume.test.ts (7 tests) 111ms
 ✓ tests/state-invalidation.test.ts (5 tests) 7ms
 ✓ tests/integration/light-flow.test.ts (2 tests) 134ms
 ✓ tests/tmux.test.ts (33 tests) 831ms
   ✓ pollForPidFile > returns null on timeout when file never appears 418ms
   ✓ pollForPidFile > returns null when file contains non-numeric content 404ms
 ✓ tests/root.test.ts (10 tests) 168ms
[2J[H[2J[H[2J[H[2J[H[2J[H ✓ tests/ui.test.ts (5 tests) 3ms
 ✓ tests/resume-light.test.ts (4 tests) 23ms
 ✓ tests/commands/status-list.test.ts (7 tests) 704ms
 ✓ tests/input.test.ts (12 tests) 3ms
 ✓ tests/phases/verdict.test.ts (7 tests) 2ms
 ✓ tests/context/reviewer-contract.test.ts (4 tests) 129ms
 ✓ tests/commands/jump.test.ts (6 tests) 896ms
 ✓ tests/resume.test.ts (6 tests) 1575ms
   ✓ resumeRun > clears pendingAction when rerun_gate target already completed 302ms
 ✓ tests/terminal.test.ts (5 tests) 2ms
 ✓ tests/conformance/phase-models.test.ts (9 tests) 2ms
 ✓ tests/git.test.ts (16 tests) 1754ms
 ✓ tests/ui-separator.test.ts (5 tests) 13ms
 ✓ tests/integration/lifecycle.test.ts (11 tests) 1513ms
 ✓ tests/commands/resume-cmd.test.ts (12 tests) 2309ms
 ✓ tests/process.test.ts (6 tests) 34ms
 ✓ tests/runners/claude.test.ts (1 test) 21ms
 ✓ tests/runners/codex.test.ts (1 test) 15ms
 ✓ tests/commands/skip.test.ts (4 tests) 539ms
 ✓ tests/phases/interactive.test.ts (37 tests) 3126ms
   ✓ runInteractivePhase — Claude dispatch command shape > sendKeysToPane command includes --dangerously-skip-permissions and --effort 1629ms
 ✓ tests/artifact.test.ts (12 tests) 2746ms
   ✓ normalizeArtifactCommit > creates commit for new untracked file 402ms
   ✓ normalizeArtifactCommit > recovers from interrupted git add (target-only staged) 388ms
 ✓ tests/commands/run.test.ts (15 tests) 3523ms
   ✓ startCommand > accepts empty task as untitled 324ms
   ✓ startCommand > accepts whitespace-only task as untitled 378ms
   ✓ startCommand > creates run directory with state.json + task.md 343ms
   ✓ startCommand > creates required directories 339ms
   ✓ startCommand > adds .harness/ to .gitignore 335ms
   ✓ startCommand > is no-op when .gitignore already has .harness/ 344ms

 Test Files  43 passed (43)
      Tests  580 passed | 1 skipped (581)
   Start at  23:44:43
   Duration  4.73s (transform 1.49s, setup 0ms, collect 4.23s, tests 23.29s, environment 4ms, prepare 2.90s)
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```
[harness.claudeUsage] project dir unreadable /Users/daniel/.claude/projects/-tmp-cwd: ENOENT: no such file or directory, scandir '/Users/daniel/.claude/projects/-tmp-cwd'
[harness.claudeUsage] project dir unreadable /Users/daniel/.claude/projects/-tmp-cwd: ENOENT: no such file or directory, scandir '/Users/daniel/.claude/projects/-tmp-cwd'
[harness.claudeUsage] project dir unreadable /Users/daniel/.claude/projects/-tmp-cwd: ENOENT: no such file or directory, scandir '/Users/daniel/.claude/projects/-tmp-cwd'
[harness.claudeUsage] project dir unreadable /Users/daniel/.claude/projects/-tmp-cwd: ENOENT: no such file or directory, scandir '/Users/daniel/.claude/projects/-tmp-cwd'
[harness.claudeUsage] project dir unreadable /Users/daniel/.claude/projects/-tmp-cwd: ENOENT: no such file or directory, scandir '/Users/daniel/.claude/projects/-tmp-cwd'
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
