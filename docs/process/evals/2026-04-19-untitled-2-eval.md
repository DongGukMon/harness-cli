# Auto Verification Report
- Date: 2026-04-19
- Related Spec: N/A
- Related Plan: N/A

## Results
| Check | Status | Detail |
|-------|--------|--------|
| typecheck | pass |  |
| vitest | pass |  |
| build | pass |  |
| package-name-is-phase-harness | pass |  |
| license-file-exists | pass |  |
| npm-pack-dry-run | pass |  |

## Summary
- Total: 6 checks
- Pass: 6
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

### vitest
**Command:** `pnpm vitest run`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

 RUN  v2.1.9 /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/npm-release

 ✓ tests/state.test.ts (48 tests) 89ms
 ✓ tests/logger.test.ts (32 tests) 127ms
 ✓ tests/context/skills-rendering.test.ts (45 tests) 128ms
 ✓ tests/phases/gate.test.ts (27 tests) 157ms
 ✓ tests/lock.test.ts (20 tests) 262ms
 ✓ tests/commands/inner.test.ts (20 tests) 253ms
 ✓ tests/commands/footer-ticker.test.ts (10 tests) 75ms
 ✓ tests/phases/gate-resume.test.ts (13 tests) 140ms
 ✓ tests/context/assembler.test.ts (64 tests) 419ms
 ✓ tests/integration/logging.test.ts (15 tests) 333ms
 ✓ tests/signal.test.ts (16 tests) 556ms
 ✓ tests/preflight.test.ts (29 tests | 1 skipped) 291ms
 ✓ tests/runners/claude-usage.test.ts (12 tests) 34ms
 ✓ tests/phases/runner.test.ts (76 tests) 694ms
 ✓ tests/metrics/footer-aggregator.test.ts (11 tests) 5ms
 ✓ tests/commands/inner-footer.test.ts (2 tests) 23ms
 ✓ tests/phases/runner-token-capture.test.ts (6 tests) 29ms
 ✓ tests/integration/codex-session-resume.test.ts (6 tests) 87ms
 ✓ tests/resume-light.test.ts (10 tests) 76ms
 ✓ tests/runners/codex-resume.test.ts (8 tests) 62ms
 ✓ tests/integration/light-flow.test.ts (4 tests) 175ms
 ✓ tests/phases/verify.test.ts (12 tests) 7ms
 ✓ tests/phases/interactive-watchdog.test.ts (6 tests) 8ms
 ✓ tests/context/assembler-resume.test.ts (9 tests) 73ms
 ✓ tests/phases/gate-feedback-archival.test.ts (2 tests) 47ms
 ✓ tests/runners/codex-isolation.test.ts (8 tests) 23ms
 ✓ tests/state-invalidation.test.ts (5 tests) 11ms
 ✓ tests/runners/codex.test.ts (6 tests) 34ms
 ✓ tests/tmux.test.ts (33 tests) 810ms
   ✓ pollForPidFile > returns null on timeout when file never appears 403ms
   ✓ pollForPidFile > returns null when file contains non-numeric content 402ms
 ✓ tests/phases/verdict.test.ts (16 tests) 4ms
 ✓ tests/root.test.ts (10 tests) 186ms
 ✓ tests/commands/resume-cmd.test.ts (12 tests) 2036ms
 ✓ tests/resume.test.ts (6 tests) 1309ms
 ✓ tests/commands/status-list.test.ts (7 tests) 699ms
[2J[H[2J[H[2J[H[2J[H[2J[H ✓ tests/ui.test.ts (5 tests) 4ms
 ✓ tests/phases/gate-resume-escalation.test.ts (1 test) 35ms
 ✓ tests/ui-footer.test.ts (9 tests) 7ms
 ✓ tests/context/reviewer-contract.test.ts (4 tests) 51ms
 ✓ tests/git.test.ts (16 tests) 1361ms
 ✓ tests/input.test.ts (12 tests) 3ms
 ✓ tests/task-prompt.test.ts (7 tests) 2ms
 ✓ tests/integration/lifecycle.test.ts (11 tests) 1333ms
 ✓ tests/commands/jump.test.ts (6 tests) 664ms
 ✓ tests/terminal.test.ts (5 tests) 3ms
 ✓ tests/preflight-claude-at-file.test.ts (2 tests) 6ms
 ✓ tests/conformance/phase-models.test.ts (9 tests) 6ms
 ✓ tests/config.test.ts (8 tests) 2ms
 ✓ tests/ui-separator.test.ts (5 tests) 1ms
 ✓ tests/process.test.ts (6 tests) 37ms
 ✓ tests/runners/claude.test.ts (1 test) 14ms
 ✓ tests/commands/skip.test.ts (4 tests) 439ms
 ✓ tests/phases/dirty-tree.test.ts (12 tests) 2361ms
   ✓ tryAutoRecoverDirtyTree > recovers python __pycache__ residuals under a tracked parent dir 334ms
 ✓ tests/artifact.test.ts (12 tests) 2584ms
   ✓ normalizeArtifactCommit > recovers from interrupted git add (target-only staged) 381ms
   ✓ runPhase6Preconditions > git rm stages tracked eval report deletion without creating a reset commit 360ms
 ✓ tests/phases/eval-report-commit-squash.test.ts (6 tests) 3255ms
   ✓ eval report commit squash > stages tracked eval report deletion without creating a reset commit and commits one rev-K report per round 988ms
   ✓ eval report commit squash > treats an already-staged eval report deletion as an idempotent precondition 566ms
   ✓ eval report commit squash > resumes cleanly from the staged-D crash window and produces exactly one new rev-K commit 706ms
   ✓ eval report commit squash > uses the rev 1 eval report message on the live verify pass path 333ms
   ✓ eval report commit squash > uses the rev-K eval report message on both resume recovery paths 428ms
 ✓ tests/phases/interactive.test.ts (48 tests) 4199ms
   ✓ validatePhaseArtifacts — Phase 5 > returns true when HEAD has advanced and working tree is clean 311ms
   ✓ validatePhaseArtifacts — Phase 5 > auto-recovers a dirty tree with ignorable artifacts and returns true 338ms
   ✓ runInteractivePhase — Claude dispatch command shape > sendKeysToPane command includes --dangerously-skip-permissions and --effort 1600ms
 ✓ tests/commands/run.test.ts (19 tests) 3977ms
   ✓ startCommand > accepts empty task as untitled 346ms
   ✓ startCommand > creates required directories 319ms
   ✓ startCommand > adds .harness/ to .gitignore 319ms
   ✓ startCommand > is no-op when .gitignore already has .harness/ 303ms

 Test Files  56 passed (56)
      Tests  813 passed | 1 skipped (814)
   Start at  20:16:32
   Duration  5.28s (transform 1.54s, setup 0ms, collect 3.74s, tests 29.61s, environment 52ms, prepare 2.55s)
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
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
```

</details>

### build
**Command:** `pnpm build`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

> phase-harness@0.1.0 build /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/npm-release
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

### package-name-is-phase-harness
**Command:** `node -e "const p=require('./package.json'); if(p.name!=='phase-harness'){console.error('expected name=phase-harness, got '+p.name);process.exit(1)}"`
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

### license-file-exists
**Command:** `test -f LICENSE`
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

### npm-pack-dry-run
**Command:** `npm pack --dry-run`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```
phase-harness-0.1.0.tgz
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```
npm notice
npm notice 📦  phase-harness@0.1.0
npm notice Tarball Contents
npm notice 1.1kB LICENSE
npm notice 11.7kB README.ko.md
npm notice 10.5kB README.md
npm notice 31B dist/bin/harness.d.ts
npm notice 3.9kB dist/bin/harness.js
npm notice 3.6kB dist/bin/harness.js.map
npm notice 3.3kB dist/scripts/harness-verify.sh
npm notice 865B dist/src/artifact.d.ts
npm notice 5.1kB dist/src/artifact.js
npm notice 3.8kB dist/src/artifact.js.map
npm notice 328B dist/src/commands/footer-ticker.d.ts
npm notice 2.4kB dist/src/commands/footer-ticker.js
npm notice 2.3kB dist/src/commands/footer-ticker.js.map
npm notice 816B dist/src/commands/inner.d.ts
npm notice 13.5kB dist/src/commands/inner.js
npm notice 11.9kB dist/src/commands/inner.js.map
npm notice 145B dist/src/commands/jump.d.ts
npm notice 2.8kB dist/src/commands/jump.js
npm notice 2.7kB dist/src/commands/jump.js.map
npm notice 127B dist/src/commands/list.d.ts
npm notice 2.2kB dist/src/commands/list.js
npm notice 2.6kB dist/src/commands/list.js.map
npm notice 170B dist/src/commands/resume.d.ts
npm notice 7.9kB dist/src/commands/resume.js
npm notice 6.6kB dist/src/commands/resume.js.map
npm notice 127B dist/src/commands/skip.d.ts
npm notice 2.1kB dist/src/commands/skip.js
npm notice 2.0kB dist/src/commands/skip.js.map
npm notice 310B dist/src/commands/start.d.ts
npm notice 10.4kB dist/src/commands/start.js
npm notice 8.5kB dist/src/commands/start.js.map
npm notice 133B dist/src/commands/status.d.ts
npm notice 3.1kB dist/src/commands/status.js
npm notice 3.8kB dist/src/commands/status.js.map
npm notice 2.5kB dist/src/config.d.ts
npm notice 6.1kB dist/src/config.js
npm notice 5.7kB dist/src/config.js.map
npm notice 1.0kB dist/src/context/assembler.d.ts
npm notice 28.5kB dist/src/context/assembler.js
npm notice 15.3kB dist/src/context/assembler.js.map
npm notice 11.1kB dist/src/context/playbooks/context-engineering.md
npm notice 10.5kB dist/src/context/playbooks/git-workflow-and-versioning.md
npm notice 1.1kB dist/src/context/playbooks/LICENSE-agent-skills.md
npm notice 1.1kB dist/src/context/playbooks/VENDOR.md
npm notice 3.6kB dist/src/context/prompts/phase-1-light.md
npm notice 466B dist/src/context/prompts/phase-1.md
npm notice 544B dist/src/context/prompts/phase-3.md
```

</details>
