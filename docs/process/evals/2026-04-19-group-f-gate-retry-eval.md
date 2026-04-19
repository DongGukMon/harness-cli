# Auto Verification Report
- Date: 2026-04-19
- Related Spec: N/A
- Related Plan: N/A

## Results
| Check | Status | Detail |
|-------|--------|--------|
| Focused gate retry regressions | pass |  |
| Full Vitest suite | pass |  |
| TypeScript no-emit check | pass |  |
| Production build | pass |  |
| Docs mention routing and measurement | pass |  |

## Summary
- Total: 5 checks
- Pass: 5
- Fail: 0

## Raw Output

### Focused gate retry regressions
**Command:** `/bin/sh -lc 'cd /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/gate-retry-policy && /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/gate-retry-policy/node_modules/.bin/vitest run tests/context/assembler.test.ts tests/phases/verdict.test.ts tests/config.test.ts tests/phases/runner.test.ts'`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

 RUN  v2.1.9 /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/gate-retry-policy

 ✓ tests/config.test.ts (2 tests) 2ms
 ✓ tests/phases/verdict.test.ts (15 tests) 5ms
 ✓ tests/phases/runner.test.ts (74 tests) 95ms
 ✓ tests/context/assembler.test.ts (25 tests) 122ms

 Test Files  4 passed (4)
      Tests  116 passed (116)
   Start at  12:32:26
   Duration  472ms (transform 219ms, setup 0ms, collect 320ms, tests 224ms, environment 0ms, prepare 301ms)
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

### Full Vitest suite
**Command:** `/bin/sh -lc 'cd /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/gate-retry-policy && /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/gate-retry-policy/node_modules/.bin/vitest run'`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

 RUN  v2.1.9 /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/gate-retry-policy

 ✓ tests/logger.test.ts (28 tests) 21ms
 ✓ tests/state.test.ts (39 tests) 71ms
 ✓ tests/phases/gate.test.ts (27 tests) 70ms
 ✓ tests/context/assembler.test.ts (25 tests) 279ms
 ✓ tests/lock.test.ts (20 tests) 303ms
 ✓ tests/phases/gate-resume.test.ts (13 tests) 234ms
 ✓ tests/commands/inner.test.ts (20 tests) 152ms
 ✓ tests/phases/runner.test.ts (74 tests) 285ms
 ✓ tests/integration/logging.test.ts (15 tests) 183ms
 ✓ tests/signal.test.ts (16 tests) 572ms
 ✓ tests/integration/codex-session-resume.test.ts (6 tests) 56ms
 ✓ tests/context/skills-rendering.test.ts (12 tests) 40ms
 ✓ tests/runners/claude-usage.test.ts (12 tests) 18ms
 ✓ tests/preflight.test.ts (29 tests | 1 skipped) 254ms
 ✓ tests/phases/runner-token-capture.test.ts (6 tests) 7ms
 ✓ tests/runners/codex-resume.test.ts (8 tests) 75ms
 ✓ tests/phases/verify.test.ts (12 tests) 12ms
 ✓ tests/runners/codex-isolation.test.ts (8 tests) 33ms
 ✓ tests/context/assembler-resume.test.ts (9 tests) 189ms
 ✓ tests/state-invalidation.test.ts (5 tests) 6ms
 ✓ tests/tmux.test.ts (33 tests) 834ms
   ✓ pollForPidFile > returns null on timeout when file never appears 405ms
   ✓ pollForPidFile > returns null when file contains non-numeric content 405ms
 ✓ tests/phases/verdict.test.ts (15 tests) 4ms
 ✓ tests/runners/codex.test.ts (6 tests) 46ms
 ✓ tests/integration/light-flow.test.ts (2 tests) 135ms
 ✓ tests/resume-light.test.ts (4 tests) 12ms
 ✓ tests/resume.test.ts (6 tests) 1755ms
   ✓ resumeRun > errors on paused run with null pendingAction 420ms
   ✓ resumeRun > clears pendingAction when rerun_gate target already completed 301ms
 ✓ tests/root.test.ts (10 tests) 255ms
 ✓ tests/git.test.ts (16 tests) 1960ms
[2J[H[2J[H[2J[H[2J[H[2J[H ✓ tests/ui.test.ts (5 tests) 3ms
 ✓ tests/commands/resume-cmd.test.ts (12 tests) 2540ms
 ✓ tests/commands/status-list.test.ts (7 tests) 838ms
 ✓ tests/commands/jump.test.ts (6 tests) 933ms
 ✓ tests/input.test.ts (12 tests) 34ms
 ✓ tests/context/reviewer-contract.test.ts (4 tests) 85ms
 ✓ tests/conformance/phase-models.test.ts (9 tests) 2ms
 ✓ tests/terminal.test.ts (5 tests) 4ms
 ✓ tests/process.test.ts (6 tests) 19ms
 ✓ tests/runners/claude.test.ts (1 test) 64ms
 ✓ tests/ui-separator.test.ts (5 tests) 1ms
 ✓ tests/config.test.ts (2 tests) 3ms
 ✓ tests/phases/interactive.test.ts (40 tests) 3674ms
   ✓ validatePhaseArtifacts — Phase 5 > returns true when HEAD has advanced and working tree is clean 335ms
   ✓ validatePhaseArtifacts — Phase 5 > returns false when working tree is dirty 427ms
   ✓ runInteractivePhase — Claude dispatch command shape > sendKeysToPane command includes --dangerously-skip-permissions and --effort 1654ms
 ✓ tests/commands/skip.test.ts (4 tests) 511ms
 ✓ tests/integration/lifecycle.test.ts (11 tests) 1996ms
 ✓ tests/artifact.test.ts (12 tests) 3241ms
   ✓ normalizeArtifactCommit > creates commit for new untracked file 447ms
   ✓ normalizeArtifactCommit > is no-op for already-committed file 387ms
   ✓ normalizeArtifactCommit > recovers from interrupted git add (target-only staged) 345ms
   ✓ runPhase6Preconditions > deletes untracked eval report 329ms
   ✓ runPhase6Preconditions > unstages + deletes staged-new eval report 311ms
   ✓ runPhase6Preconditions > git rm + commit for tracked eval report 394ms
 ✓ tests/commands/run.test.ts (17 tests) 4607ms
   ✓ startCommand > accepts empty task as untitled 458ms
   ✓ startCommand > accepts whitespace-only task as untitled 537ms
   ✓ startCommand > creates run directory with state.json + task.md 359ms
   ✓ startCommand > creates required directories 318ms
   ✓ startCommand > adds .harness/ to .gitignore 375ms
   ✓ startCommand > is no-op when .gitignore already has .harness/ 367ms
   ✓ startCommand > allows unstaged changes by default 309ms

 Test Files  45 passed (45)
      Tests  633 passed | 1 skipped (634)
   Start at  12:32:27
   Duration  6.06s (transform 1.78s, setup 0ms, collect 6.08s, tests 26.42s, environment 5ms, prepare 5.50s)
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

### TypeScript no-emit check
**Command:** `/bin/sh -lc 'cd /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/gate-retry-policy && /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/gate-retry-policy/node_modules/.bin/tsc --noEmit'`
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

### Production build
**Command:** `/bin/sh -lc 'cd /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/gate-retry-policy && pnpm build'`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

> harness-cli@0.1.0 build /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/gate-retry-policy
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

### Docs mention routing and measurement
**Command:** `/bin/sh -lc 'cd /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/gate-retry-policy && /usr/bin/grep -nE "Scope: impl|Phase 7 REJECT|retry limit (of )?5|verdict-raw|gate-7-raw\.txt" CLAUDE.md docs/HOW-IT-WORKS.md'`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```
CLAUDE.md:90:| 1 | Gate reject 루프 비수렴 | **부분 완화 shipped**: light flow는 Phase 7 REJECT 시 `Scope: impl` 이면 Phase 5 reopen, `design|mixed|missing` 이면 Phase 1 reopen, retry limit 5를 사용한다(full은 3 유지). post-ship 측정은 events.jsonl 확장 대신 `.harness/<runId>/gate-7-raw.txt` verdict-raw artifact 샘플링으로 false fast-path를 확인한다. rollback threshold는 아직 문서화되지 않았고 후속 dogfood에서 결정한다. |
docs/HOW-IT-WORKS.md:55:- **Phase 7 REJECT**: `Scope: impl`이면 Phase 5 reopen, `Scope: design|mixed` 또는 scope 누락이면 Phase 1 reopen. Phase 1 reopen일 때는 combined doc를 다시 작성하고, `state.carryoverFeedback` 는 그 completion 이후에도 살아남아 Phase 5 on re-entry에서 소비된다.
docs/HOW-IT-WORKS.md:56:- **Gate retry limit**: light flow는 retry limit 5, full flow는 retry limit 3을 사용한다.
docs/HOW-IT-WORKS.md:59:- **Measurement source**: rollout 후 scope 분류 점검은 events.jsonl schema를 늘리지 않고 `.harness/<runId>/gate-7-raw.txt` verdict-raw artifact를 샘플링해 수행한다. rollback threshold는 아직 codify되지 않았다.
docs/HOW-IT-WORKS.md:216:| **Sidecar files** | `gate-7-raw.txt`, `gate-7-result.json`, `gate-7-error.md`, `gate-7-feedback.md` |
docs/HOW-IT-WORKS.md:236:- **REJECT** (retries < limit): full flow는 Phase 5 reopen. light flow는 `Scope: impl` 이면 Phase 5 reopen, `Scope: design|mixed|missing` 이면 Phase 1 reopen. `gate-7-feedback.md` 는 저장되고, light flow의 Phase 1 reopen 경로에서는 `carryoverFeedback` 으로 다시 전달된다. `gateRetries[7]` increments. `verifyRetries` resets.
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```

```

</details>
