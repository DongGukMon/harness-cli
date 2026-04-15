# Auto Verification Report
- Date: 2026-04-15
- Related Spec: N/A
- Related Plan: N/A

## Results
| Check | Status | Detail |
|-------|--------|--------|
| Type check | pass |  |
| All tests pass | pass |  |
| Build succeeds | pass |  |
| CLI start help | pass |  |
| CLI run help (alias) | pass |  |
| start.ts exists | pass |  |
| run.ts removed | pass |  |
| startCommand exported | pass |  |
| task is optional in start | pass |  |
| run alias registered | pass |  |
| renderWelcome exists | pass |  |
| readline in inner.ts | pass |  |
| list.ts uses harness start | pass |  |
| root.ts uses harness start | pass |  |
| no harness run in list.ts | pass |  |
| no harness run in root.ts | pass |  |
| inner.ts has selectPane for focus | pass |  |
| inner.ts has cancel cleanup | pass |  |
| signal handlers after task capture | pass |  |

## Summary
- Total: 19 checks
- Pass: 19
- Fail: 0

## Raw Output

### Type check
**Command:** `pnpm run lint`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

> harness-cli@0.1.0 lint /Users/daniel/Desktop/projects/harness/harness-cli
> tsc --noEmit
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```

```

</details>

### All tests pass
**Command:** `pnpm test`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

> harness-cli@0.1.0 test /Users/daniel/Desktop/projects/harness/harness-cli
> vitest run


 RUN  v2.1.9 /Users/daniel/Desktop/projects/harness/harness-cli

 ✓ tests/phases/gate.test.ts (19 tests) 35ms
 ✓ tests/phases/verify.test.ts (12 tests) 57ms
 ✓ tests/phases/runner.test.ts (24 tests) 107ms
 ✓ tests/preflight.test.ts (25 tests | 1 skipped) 193ms
 ✓ tests/commands/inner.test.ts (5 tests) 12ms
 ✓ tests/context/assembler.test.ts (9 tests) 44ms
 ✓ tests/state.test.ts (6 tests) 47ms
 ✓ tests/lock.test.ts (20 tests) 505ms
 ✓ tests/signal.test.ts (15 tests) 572ms
 ✓ tests/tmux.test.ts (33 tests) 818ms
   ✓ pollForPidFile > returns null on timeout when file never appears 404ms
   ✓ pollForPidFile > returns null when file contains non-numeric content 409ms
 ✓ tests/root.test.ts (10 tests) 199ms
 ✓ tests/commands/status-list.test.ts (7 tests) 695ms
 ✓ tests/terminal.test.ts (5 tests) 2ms
 ✓ tests/ui.test.ts (6 tests) 2ms
 ✓ tests/process.test.ts (6 tests) 112ms
 ✓ tests/commands/jump.test.ts (5 tests) 825ms
 ✓ tests/commands/skip.test.ts (4 tests) 694ms
 ✓ tests/conformance/phase-models.test.ts (9 tests) 10ms
 ✓ tests/commands/resume-cmd.test.ts (8 tests) 1783ms
   ✓ resumeCommand > resumes with implicit current-run (Case 3: no session) 370ms
 ✓ tests/resume.test.ts (6 tests) 1828ms
   ✓ resumeRun > errors on paused run with null pendingAction 379ms
   ✓ resumeRun > clears pendingAction when rerun_gate target already completed 330ms
   ✓ resumeRun > clears skip_phase pendingAction when target completed 380ms
 ✓ tests/integration/lifecycle.test.ts (8 tests) 1256ms
 ✓ tests/git.test.ts (16 tests) 1649ms
 ✓ tests/artifact.test.ts (12 tests) 2633ms
   ✓ normalizeArtifactCommit > creates commit for new untracked file 459ms
   ✓ normalizeArtifactCommit > is no-op for already-committed file 308ms
   ✓ normalizeArtifactCommit > recovers from interrupted git add (target-only staged) 468ms
 ✓ tests/commands/run.test.ts (10 tests) 2399ms
   ✓ startCommand > accepts empty task as untitled 451ms
   ✓ startCommand > accepts whitespace-only task as untitled 301ms
   ✓ startCommand > creates run directory with state.json + task.md 436ms
 ✓ tests/phases/interactive.test.ts (33 tests) 4740ms
   ✓ validatePhaseArtifacts — Phase 5 > returns false when working tree is dirty 369ms
   ✓ runInteractivePhase — advisor reminder fires before sendKeysToPane > printAdvisorReminder is called before sendKeysToPane 1711ms
   ✓ runInteractivePhase — advisor reminder fires before sendKeysToPane > sendKeysToPane command includes --dangerously-skip-permissions and --effort 1674ms

 Test Files  25 passed (25)
      Tests  312 passed | 1 skipped (313)
   Start at  13:32:17
   Duration  5.13s (transform 1.24s, setup 0ms, collect 2.21s, tests 21.22s, environment 6ms, prepare 1.35s)
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```
fatal: not a git repository (or any of the parent directories): .git
fatal: not a git repository (or any of the parent directories): .git
fatal: not a git repository (or any of the parent directories): .git
fatal: not a git repository (or any of the parent directories): .git
fatal: not a git repository (or any of the parent directories): .git
fatal: not a git repository (or any of the parent directories): .git
fatal: not a git repository (or any of the parent directories): .git
fatal: not a git repository (or any of the parent directories): .git
fatal: not a git repository (or any of the parent directories): .git
fatal: not a git repository (or any of the parent directories): .git
ℹ Received control signal (SIGUSR1). Applying pending action...
✓ Applied: skip. Phase loop re-entering.
ℹ Received control signal (SIGUSR1). Applying pending action...
✓ Applied: jump → phase 3. Phase loop re-entering.
ℹ Received control signal (SIGUSR1). Applying pending action...
fatal: not a git repository (or any of the parent directories): .git
fatal: not a git repository (or any of the parent directories): .git
fatal: not a git repository (or any of the parent directories): .git
```

</details>

### Build succeeds
**Command:** `pnpm run build`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

> harness-cli@0.1.0 build /Users/daniel/Desktop/projects/harness/harness-cli
> tsc && node scripts/copy-assets.mjs

[copy-assets] copied src/context/prompts -> dist/src/context/prompts
[copy-assets] copied scripts/harness-verify.sh -> dist/scripts/harness-verify.sh
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```

```

</details>

### CLI start help
**Command:** `node dist/bin/harness.js start --help`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```
Usage: harness start [options] [task]

start a new harness session

Options:
  --allow-dirty  allow unstaged/untracked changes at start
  --auto         autonomous mode (no user escalations)
  -h, --help     display help for command
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```

```

</details>

### CLI run help (alias)
**Command:** `node dist/bin/harness.js run --help`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```
Usage: harness run [options] [task]

alias for start

Options:
  --allow-dirty  allow unstaged/untracked changes at start
  --auto         autonomous mode (no user escalations)
  -h, --help     display help for command
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```

```

</details>

### start.ts exists
**Command:** `test -f src/commands/start.ts`
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

### run.ts removed
**Command:** `test ! -f src/commands/run.ts`
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

### startCommand exported
**Command:** `grep -q 'startCommand' src/commands/start.ts`
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

### task is optional in start
**Command:** `grep -q '\[task\]' bin/harness.ts`
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

### run alias registered
**Command:** `grep -q "command('run" bin/harness.ts`
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

### renderWelcome exists
**Command:** `grep -q 'renderWelcome' src/ui.ts`
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

### readline in inner.ts
**Command:** `grep -q 'createInterface' src/commands/inner.ts`
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

### list.ts uses harness start
**Command:** `grep -q 'harness start' src/commands/list.ts`
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

### root.ts uses harness start
**Command:** `grep -q 'harness start' src/root.ts`
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

### no harness run in list.ts
**Command:** `! grep -q 'harness run' src/commands/list.ts`
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

### no harness run in root.ts
**Command:** `! grep -q 'harness run' src/root.ts`
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

### inner.ts has selectPane for focus
**Command:** `grep -q 'selectPane' src/commands/inner.ts`
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

### inner.ts has cancel cleanup
**Command:** `grep -q 'cancelled' src/commands/inner.ts`
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

### signal handlers after task capture
**Command:** `grep -B5 'registerSignalHandlers' src/commands/inner.ts | grep -q 'writeState\|task'`
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
