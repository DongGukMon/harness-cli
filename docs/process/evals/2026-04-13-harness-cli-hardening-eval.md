# Auto Verification Report
- Date: 2026-04-13
- Related Spec: docs/specs/2026-04-13-harness-cli-hardening-design.md
- Related Plan: docs/plans/2026-04-13-harness-cli-hardening.md

## Results
| Check | Status | Detail |
|-------|--------|--------|
| Type check | pass |  |
| Unit + conformance tests | pass |  |
| Build | pass |  |
| CLI help works | pass |  |
| No hardcoded ~/.claude in verify.ts | pass |  |
| dist/scripts/harness-verify.sh exists and is executable | pass |  |
| Preflight imports spawnSync from child_process | pass |  |
| Preflight uses killSignal: 'SIGKILL' for the @file probe | pass |  |
| Preflight no longer uses execSync for claudeAtFile (proves hang fix in source) | pass |  |
| Advisor reminder is invoked from interactive.ts spawn seam (not runner.ts) | pass |  |
| Smoke: harness run reaches phase 1 boundary in <10s (proves preflight hang fix end-to-end) | pass |  |

## Summary
- Total: 11 checks
- Pass: 11
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

### Unit + conformance tests
**Command:** `pnpm test`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

> harness-cli@0.1.0 test /Users/daniel/Desktop/projects/harness/harness-cli
> vitest run


 RUN  v2.1.9 /Users/daniel/Desktop/projects/harness/harness-cli

 ✓ tests/context/assembler.test.ts (9 tests) 6ms
 ✓ tests/phases/gate.test.ts (19 tests) 13ms
 ✓ tests/phases/verify.test.ts (12 tests) 16ms
 ✓ tests/phases/runner.test.ts (24 tests) 58ms
 ✓ tests/preflight.test.ts (25 tests | 1 skipped) 180ms
 ✓ tests/state.test.ts (6 tests) 50ms
 ✓ tests/lock.test.ts (20 tests) 326ms
 ✓ tests/signal.test.ts (11 tests) 354ms
 ✓ tests/root.test.ts (10 tests) 174ms
 ✓ tests/ui.test.ts (6 tests) 2ms
 ✓ tests/process.test.ts (6 tests) 27ms
 ✓ tests/commands/status-list.test.ts (7 tests) 681ms
 ✓ tests/conformance/phase-models.test.ts (5 tests) 2ms
 ✓ tests/resume.test.ts (6 tests) 1418ms
 ✓ tests/commands/resume-cmd.test.ts (6 tests) 893ms
 ✓ tests/commands/jump.test.ts (8 tests) 1441ms
 ✓ tests/integration/lifecycle.test.ts (8 tests) 1107ms
 ✓ tests/commands/skip.test.ts (6 tests) 1347ms
   ✓ skipCommand > Phase 6 skip generates synthetic eval report 433ms
 ✓ tests/git.test.ts (16 tests) 1439ms
 ✓ tests/phases/interactive.test.ts (32 tests) 1628ms
   ✓ runInteractivePhase — advisor reminder fires before spawn > printAdvisorReminder is called before spawn("claude", ...) 452ms
 ✓ tests/commands/run.test.ts (10 tests) 1867ms
   ✓ runCommand > creates run directory with state.json + task.md 336ms
   ✓ runCommand > creates required directories 356ms
 ✓ tests/artifact.test.ts (12 tests) 2178ms
   ✓ normalizeArtifactCommit > creates commit for new untracked file 354ms
   ✓ normalizeArtifactCommit > recovers from interrupted git add (target-only staged) 320ms

 Test Files  22 passed (22)
      Tests  263 passed | 1 skipped (264)
   Start at  19:15:06
   Duration  2.53s (transform 1.15s, setup 0ms, collect 1.79s, tests 15.21s, environment 2ms, prepare 1.22s)
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
fatal: not a git repository (or any of the parent directories): .git
fatal: not a git repository (or any of the parent directories): .git
fatal: not a git repository (or any of the parent directories): .git
```

</details>

### Build
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

### No hardcoded ~/.claude in verify.ts
**Command:** `! grep -nE "'\.claude/scripts'|\"\.claude/scripts\"" src/phases/verify.ts`
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

### dist/scripts/harness-verify.sh exists and is executable
**Command:** `test -x dist/scripts/harness-verify.sh`
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

### Preflight imports spawnSync from child_process
**Command:** `grep -qE "^import \{[^}]*\bspawnSync\b[^}]*\}\s+from\s+'child_process'" src/preflight.ts`
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

### Preflight uses killSignal: 'SIGKILL' for the @file probe
**Command:** `grep -qE "killSignal:\s*'SIGKILL'" src/preflight.ts`
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

### Preflight no longer uses execSync for claudeAtFile (proves hang fix in source)
**Command:** `! (sed -n "/case 'claudeAtFile'/,/^    case /p" src/preflight.ts | grep -q 'execSync(')`
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

### Advisor reminder is invoked from interactive.ts spawn seam (not runner.ts)
**Command:** `grep -q 'printAdvisorReminder' src/phases/interactive.ts && ! grep -q 'printAdvisorReminder' src/phases/runner.ts`
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

### Smoke: harness run reaches phase 1 boundary in <10s (proves preflight hang fix end-to-end)
**Command:** `bash scripts/smoke-preflight.sh "$PWD/dist/bin/harness.js"`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```
preflight smoke elapsed: 5s
stderr (first 5 lines):
  ⚠️  preflight: claude @file check timed out (5s); skipping — runtime failure will be surfaced at phase level if @file is unsupported.
  Error: harness requires an interactive terminal (TTY).
PASS: preflight reached phase 1 boundary in 5s (<10s)
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```

```

</details>
