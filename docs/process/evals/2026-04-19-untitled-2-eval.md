# Auto Verification Report
- Date: 2026-04-19
- Related Spec: docs/specs/2026-04-19-untitled-2-design.md
- Related Plan: docs/plans/2026-04-19-untitled-2.md
- RunId: 2026-04-19-untitled-2 (Phase 6 run manually after Phase 5→6 transition crash blocked on untracked prompt.txt)

## Results
| Check | Status | Detail |
|-------|--------|--------|
| typecheck | pass |  |
| tests | pass |  |
| build | pass |  |
| invariant: LIGHT_REQUIRED_PHASE_KEYS contains 2 | pass |  |
| invariant: LIGHT_PHASE_DEFAULTS[2] === codex-high | pass |  |
| invariant: getGateRetryLimit gate-aware signature | pass |  |
| invariant: createInitialState light phases[2]=pending not skipped | pass |  |
| invariant: FIVE_AXIS_DESIGN_GATE_LIGHT constant exists | pass |  |
| invariant: buildLifecycleContext 5-phase light stanza | pass |  |
| invariant: buildGatePromptPhase2 light branch present | pass |  |
| invariant: runner passes gate to getGateRetryLimit | pass |  |

## Summary
- Total: 11 checks
- Pass: 11
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

 RUN  v2.1.9 /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/light-pre-impl-gate

 ✓ tests/state.test.ts (46 tests) 48ms
 ✓ tests/context/skills-rendering.test.ts (45 tests) 98ms
 ✓ tests/logger.test.ts (31 tests) 102ms
 ✓ tests/phases/gate.test.ts (27 tests) 142ms
 ✓ tests/lock.test.ts (20 tests) 250ms
 ✓ tests/commands/inner.test.ts (20 tests) 265ms
 ✓ tests/commands/footer-ticker.test.ts (10 tests) 138ms
 ✓ tests/context/assembler.test.ts (64 tests) 383ms
 ✓ tests/integration/logging.test.ts (15 tests) 323ms
 ✓ tests/phases/gate-resume.test.ts (13 tests) 213ms
 ✓ tests/signal.test.ts (16 tests) 433ms
 ✓ tests/preflight.test.ts (29 tests | 1 skipped) 223ms
 ✓ tests/runners/claude-usage.test.ts (12 tests) 39ms
 ✓ tests/phases/runner.test.ts (76 tests) 512ms
 ✓ tests/metrics/footer-aggregator.test.ts (11 tests) 5ms
 ✓ tests/integration/codex-session-resume.test.ts (6 tests) 97ms
 ✓ tests/resume-light.test.ts (10 tests) 68ms
 ✓ tests/commands/inner-footer.test.ts (2 tests) 17ms
 ✓ tests/phases/runner-token-capture.test.ts (6 tests) 20ms
 ✓ tests/integration/light-flow.test.ts (4 tests) 180ms
 ✓ tests/runners/codex-resume.test.ts (8 tests) 60ms
 ✓ tests/phases/verify.test.ts (12 tests) 14ms
 ✓ tests/context/assembler-resume.test.ts (9 tests) 81ms
 ✓ tests/phases/interactive-watchdog.test.ts (6 tests) 8ms
 ✓ tests/phases/gate-feedback-archival.test.ts (2 tests) 50ms
 ✓ tests/runners/codex-isolation.test.ts (8 tests) 28ms
 ✓ tests/state-invalidation.test.ts (5 tests) 10ms
 ✓ tests/tmux.test.ts (33 tests) 814ms
   ✓ pollForPidFile > returns null on timeout when file never appears 404ms
   ✓ pollForPidFile > returns null when file contains non-numeric content 404ms
 ✓ tests/runners/codex.test.ts (6 tests) 53ms
 ✓ tests/phases/verdict.test.ts (16 tests) 3ms
 ✓ tests/root.test.ts (10 tests) 319ms
 ✓ tests/commands/status-list.test.ts (7 tests) 799ms
 ✓ tests/resume.test.ts (6 tests) 1499ms
   ✓ resumeRun > errors when specCommit is not in git history 329ms
[2J[H[2J[H[2J[H[2J[H[2J[H ✓ tests/ui.test.ts (5 tests) 3ms
 ✓ tests/commands/resume-cmd.test.ts (12 tests) 2418ms
   ✓ resumeCommand > resumeCommand — loggingEnabled inheritance > resume defaults to false when state has loggingEnabled=false 301ms
 ✓ tests/git.test.ts (16 tests) 1615ms
 ✓ tests/phases/gate-resume-escalation.test.ts (1 test) 33ms
 ✓ tests/ui-footer.test.ts (9 tests) 3ms
 ✓ tests/context/reviewer-contract.test.ts (4 tests) 69ms
 ✓ tests/input.test.ts (12 tests) 6ms
 ✓ tests/preflight-claude-at-file.test.ts (2 tests) 5ms
 ✓ tests/terminal.test.ts (5 tests) 4ms
 ✓ tests/conformance/phase-models.test.ts (9 tests) 6ms
 ✓ tests/commands/jump.test.ts (6 tests) 689ms
 ✓ tests/integration/lifecycle.test.ts (11 tests) 1725ms
   ✓ CLI lifecycle integration > harness --version outputs version 380ms
 ✓ tests/ui-separator.test.ts (5 tests) 3ms
 ✓ tests/process.test.ts (6 tests) 23ms
 ✓ tests/config.test.ts (8 tests) 2ms
 ✓ tests/runners/claude.test.ts (1 test) 16ms
 ✓ tests/commands/skip.test.ts (4 tests) 464ms
 ✓ tests/phases/dirty-tree.test.ts (12 tests) 2706ms
   ✓ tryAutoRecoverDirtyTree > recovers python __pycache__ residuals under a tracked parent dir 366ms
   ✓ tryAutoRecoverDirtyTree > recovers pytest cache residuals 318ms
   ✓ tryAutoRecoverDirtyTree > recovers node_modules residuals 374ms
   ✓ tryAutoRecoverDirtyTree > creates .gitignore when missing 357ms
   ✓ tryAutoRecoverDirtyTree > commits with the expected chore message and includes runId 301ms
 ✓ tests/artifact.test.ts (12 tests) 2988ms
   ✓ normalizeArtifactCommit > recovers from interrupted git add (target-only staged) 402ms
   ✓ runPhase6Preconditions > no eval report → no-op, passes 355ms
   ✓ runPhase6Preconditions > deletes untracked eval report 306ms
   ✓ runPhase6Preconditions > git rm stages tracked eval report deletion without creating a reset commit 423ms
 ✓ tests/phases/eval-report-commit-squash.test.ts (6 tests) 3653ms
   ✓ eval report commit squash > stages tracked eval report deletion without creating a reset commit and commits one rev-K report per round 1035ms
   ✓ eval report commit squash > treats an already-staged eval report deletion as an idempotent precondition 616ms
   ✓ eval report commit squash > resumes cleanly from the staged-D crash window and produces exactly one new rev-K commit 932ms
   ✓ eval report commit squash > uses the rev 1 eval report message on the live verify pass path 372ms
   ✓ eval report commit squash > uses the rev-K eval report message on both resume recovery paths 475ms
 ✓ tests/phases/interactive.test.ts (48 tests) 4285ms
   ✓ validatePhaseArtifacts — Phase 5 > returns true when HEAD has advanced and working tree is clean 313ms
   ✓ validatePhaseArtifacts — Phase 5 > auto-recovers a dirty tree with ignorable artifacts and returns true 429ms
   ✓ validatePhaseArtifacts — Phase 5 > blocks on non-ignorable residual and writes diagnostic 332ms
   ✓ validatePhaseArtifacts — Phase 5 > strictTree=true skips auto-recovery and writes strict-tree diagnostic 334ms
   ✓ runInteractivePhase — Claude dispatch command shape > sendKeysToPane command includes --dangerously-skip-permissions and --effort 1629ms
 ✓ tests/commands/run.test.ts (19 tests) 4450ms
   ✓ startCommand > accepts empty task as untitled 367ms
   ✓ startCommand > creates required directories 313ms
   ✓ startCommand > adds .harness/ to .gitignore 483ms
   ✓ startCommand > is no-op when .gitignore already has .harness/ 382ms

 Test Files  55 passed (55)
      Tests  803 passed | 1 skipped (804)
   Start at  19:27:20
   Duration  5.48s (transform 1.57s, setup 0ms, collect 3.80s, tests 32.46s, environment 6ms, prepare 2.43s)
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

> harness-cli@0.1.0 build /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/light-pre-impl-gate
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

### invariant: LIGHT_REQUIRED_PHASE_KEYS contains 2
**Command:** `grep -q "'2'" src/config.ts && grep -q 'LIGHT_REQUIRED_PHASE_KEYS' src/config.ts`
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

### invariant: LIGHT_PHASE_DEFAULTS[2] === codex-high
**Command:** `grep -q '2:.*codex-high' src/config.ts`
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

### invariant: getGateRetryLimit gate-aware signature
**Command:** `grep -q 'gate\?: GatePhase' src/config.ts`
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

### invariant: createInitialState light phases[2]=pending not skipped
**Command:** `grep -q "'2': 'pending', '3': 'skipped'" src/state.ts`
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

### invariant: FIVE_AXIS_DESIGN_GATE_LIGHT constant exists
**Command:** `grep -q 'FIVE_AXIS_DESIGN_GATE_LIGHT' src/context/assembler.ts`
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

### invariant: buildLifecycleContext 5-phase light stanza
**Command:** `grep -q '5-phase light harness lifecycle' src/context/assembler.ts`
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

### invariant: buildGatePromptPhase2 light branch present
**Command:** `grep -q "state.flow === 'light'" src/context/assembler.ts`
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

### invariant: runner passes gate to getGateRetryLimit
**Command:** `grep -q 'getGateRetryLimit(state.flow, phase)' src/phases/runner.ts`
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
