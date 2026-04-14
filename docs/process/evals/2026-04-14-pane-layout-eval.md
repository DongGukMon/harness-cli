# Auto Verification Report
- Date: 2026-04-14
- Related Spec: N/A
- Related Plan: N/A

## Results
| Check | Status | Detail |
|-------|--------|--------|
| Type check | pass |  |
| All tests pass | pass |  |
| Build succeeds | pass |  |
| CLI help works | pass |  |
| splitPane exists in tmux.ts | pass |  |
| sendKeysToPane exists in tmux.ts | pass |  |
| paneExists exists in tmux.ts | pass |  |
| pollForPidFile exists in tmux.ts | pass |  |
| getDefaultPaneId exists in tmux.ts | pass |  |
| interactive.ts uses sendKeysToPane not createWindow | pass |  |
| interactive.ts uses isPidAlive not windowExists | pass |  |
| signal.ts uses sendKeysToPane not killWindow | pass |  |
| signal.ts writes interrupt flag | pass |  |
| run.ts passes --control-pane | pass |  |
| resume.ts uses paneExists | pass |  |
| inner.ts accepts --control-pane | pass |  |
| inner.ts calls splitPane | pass |  |
| HarnessState has tmuxWorkspacePane | pass |  |
| HarnessState has tmuxControlPane | pass |  |
| __inner command has --control-pane option | pass |  |
| tmux pane tests exist | pass |  |
| signal test updated for pane | pass |  |
| run test updated for --control-pane | pass |  |
| resume test updated for paneExists | pass |  |
| inner test updated for splitPane | pass |  |
| gate.ts does NOT use workspace pane (ADR-6) | pass |  |
| verify.ts does NOT use workspace pane (ADR-6) | pass |  |

## Summary
- Total: 27 checks
- Pass: 27
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

 ✓ tests/phases/verify.test.ts (12 tests) 16ms
 ✓ tests/phases/gate.test.ts (19 tests) 13ms
 ✓ tests/phases/runner.test.ts (24 tests) 66ms
 ✓ tests/commands/inner.test.ts (5 tests) 8ms
 ✓ tests/context/assembler.test.ts (9 tests) 13ms
 ✓ tests/preflight.test.ts (25 tests | 1 skipped) 315ms
 ✓ tests/lock.test.ts (20 tests) 438ms
 ✓ tests/state.test.ts (6 tests) 26ms
 ✓ tests/signal.test.ts (15 tests) 538ms
 ✓ tests/tmux.test.ts (33 tests) 824ms
   ✓ pollForPidFile > returns null on timeout when file never appears 411ms
   ✓ pollForPidFile > returns null when file contains non-numeric content 406ms
 ✓ tests/root.test.ts (10 tests) 170ms
 ✓ tests/terminal.test.ts (5 tests) 2ms
 ✓ tests/commands/status-list.test.ts (7 tests) 687ms
 ✓ tests/ui.test.ts (6 tests) 10ms
 ✓ tests/commands/jump.test.ts (5 tests) 740ms
 ✓ tests/commands/resume-cmd.test.ts (8 tests) 1452ms
 ✓ tests/resume.test.ts (6 tests) 1526ms
   ✓ resumeRun > errors on paused run with null pendingAction 365ms
 ✓ tests/process.test.ts (6 tests) 70ms
 ✓ tests/commands/skip.test.ts (4 tests) 561ms
 ✓ tests/conformance/phase-models.test.ts (9 tests) 2ms
 ✓ tests/integration/lifecycle.test.ts (8 tests) 1118ms
 ✓ tests/git.test.ts (16 tests) 1510ms
 ✓ tests/commands/run.test.ts (10 tests) 1925ms
   ✓ runCommand > creates run directory with state.json + task.md 339ms
   ✓ runCommand > creates required directories 370ms
 ✓ tests/artifact.test.ts (12 tests) 2455ms
   ✓ normalizeArtifactCommit > creates commit for new untracked file 465ms
 ✓ tests/phases/interactive.test.ts (33 tests) 4512ms
   ✓ runInteractivePhase — advisor reminder fires before sendKeysToPane > printAdvisorReminder is called before sendKeysToPane 1709ms
   ✓ runInteractivePhase — advisor reminder fires before sendKeysToPane > sendKeysToPane command includes --dangerously-skip-permissions and --effort 1651ms

 Test Files  25 passed (25)
      Tests  312 passed | 1 skipped (313)
   Start at  23:42:27
   Duration  5.02s (transform 1.69s, setup 0ms, collect 2.62s, tests 19.00s, environment 2ms, prepare 2.04s)
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

### CLI help works
**Command:** `node dist/bin/harness.js --help`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```
Usage: harness [options] [command]

AI agent harness orchestrator

Options:
  -V, --version             output the version number
  --root <dir>              explicit .harness/ parent directory
  -h, --help                display help for command

Commands:
  run [options] <task>      start a new harness run
  resume [options] [runId]  resume an existing run
  status                    show current run status
  list                      list all runs
  skip                      skip the current phase
  jump <phase>              jump backward to a previous phase (1-7)
  help [command]            display help for command
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```

```

</details>

### splitPane exists in tmux.ts
**Command:** `grep -q 'splitPane' src/tmux.ts`
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

### sendKeysToPane exists in tmux.ts
**Command:** `grep -q 'sendKeysToPane' src/tmux.ts`
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

### paneExists exists in tmux.ts
**Command:** `grep -q 'paneExists' src/tmux.ts`
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

### pollForPidFile exists in tmux.ts
**Command:** `grep -q 'pollForPidFile' src/tmux.ts`
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

### getDefaultPaneId exists in tmux.ts
**Command:** `grep -q 'getDefaultPaneId' src/tmux.ts`
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

### interactive.ts uses sendKeysToPane not createWindow
**Command:** `grep -q 'sendKeysToPane' src/phases/interactive.ts && ! grep -q 'createWindow' src/phases/interactive.ts`
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

### interactive.ts uses isPidAlive not windowExists
**Command:** `grep -q 'isPidAlive' src/phases/interactive.ts && ! grep -q 'windowExists' src/phases/interactive.ts`
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

### signal.ts uses sendKeysToPane not killWindow
**Command:** `grep -q 'sendKeysToPane' src/signal.ts && ! grep -q 'killWindow' src/signal.ts`
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

### signal.ts writes interrupt flag
**Command:** `grep -q 'interrupted-' src/signal.ts`
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

### run.ts passes --control-pane
**Command:** `grep -q 'control-pane' src/commands/run.ts`
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

### resume.ts uses paneExists
**Command:** `grep -q 'paneExists' src/commands/resume.ts`
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

### inner.ts accepts --control-pane
**Command:** `grep -q 'controlPane' src/commands/inner.ts`
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

### inner.ts calls splitPane
**Command:** `grep -q 'splitPane' src/commands/inner.ts`
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

### HarnessState has tmuxWorkspacePane
**Command:** `grep -q 'tmuxWorkspacePane' src/types.ts`
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

### HarnessState has tmuxControlPane
**Command:** `grep -q 'tmuxControlPane' src/types.ts`
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

### __inner command has --control-pane option
**Command:** `grep -q 'control-pane' bin/harness.ts`
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

### tmux pane tests exist
**Command:** `grep -q 'splitPane' tests/tmux.test.ts`
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

### signal test updated for pane
**Command:** `grep -q 'sendKeysToPane' tests/signal.test.ts`
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

### run test updated for --control-pane
**Command:** `grep -q 'getDefaultPaneId' tests/commands/run.test.ts`
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

### resume test updated for paneExists
**Command:** `grep -q 'paneExists' tests/commands/resume-cmd.test.ts`
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

### inner test updated for splitPane
**Command:** `grep -q 'splitPane' tests/commands/inner.test.ts`
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

### gate.ts does NOT use workspace pane (ADR-6)
**Command:** `! grep -q 'tmuxWorkspacePane' src/phases/gate.ts && ! grep -q 'sendKeysToPane' src/phases/gate.ts`
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

### verify.ts does NOT use workspace pane (ADR-6)
**Command:** `! grep -q 'tmuxWorkspacePane' src/phases/verify.ts && ! grep -q 'sendKeysToPane' src/phases/verify.ts`
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
