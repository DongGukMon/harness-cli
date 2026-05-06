# Auto Verification Report
- Date: 2026-05-06
- Related Spec: N/A
- Related Plan: N/A

## Results
| Check | Status | Detail |
|-------|--------|--------|
| typecheck | pass |  |
| test suite | pass |  |
| stagnation.ts exports tokenJaccard, StagnationDetector, loadStagnationConfig (SC#1) | pass |  |
| types.ts has gate_stagnation event variant (SC#2) | pass |  |
| types.ts has gate-stagnation escalation reason (SC#2) | pass |  |
| runner.ts wires loadStagnationConfig and gate_stagnation (SC#3) | pass |  |
| no new package.json dependency (SC#6) | pass |  |
| all four docs contain HARNESS_GATE_STAGNATION (SC#7) | pass |  |

## Summary
- Total: 8 checks
- Pass: 8
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

### test suite
**Command:** `pnpm vitest run`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

 RUN  v2.1.9 /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/improve-cycle

 ✓ tests/state.test.ts (53 tests) 41ms
 ✓ tests/context/skills-rendering.test.ts (45 tests) 51ms
 ✓ tests/logger.test.ts (32 tests) 70ms
 ✓ tests/phases/gate.test.ts (32 tests) 181ms
 ✓ tests/phases/runner-claude-resume.test.ts (13 tests) 40ms
 ✓ tests/phases/gate-resume.test.ts (12 tests) 187ms
 ✓ tests/runners/claude-usage.test.ts (17 tests) 132ms
 ✓ tests/signal.test.ts (17 tests) 501ms
 ✓ tests/commands/inner.test.ts (25 tests) 266ms
 ✓ tests/integration/logging.test.ts (15 tests) 292ms
 ✓ tests/phases/terminal-ui.test.ts (18 tests) 118ms
 ✓ tests/phases/runner.test.ts (83 tests) 695ms
 ✓ tests/lock.test.ts (20 tests) 195ms
 ✓ tests/commands/footer-ticker.test.ts (10 tests) 16ms
 ✓ tests/phases/stagnation.test.ts (32 tests) 11ms
 ✓ tests/phases/verify.test.ts (15 tests) 23ms
 ✓ tests/phases/runner-token-capture.test.ts (8 tests) 16ms
 ✓ tests/metrics/footer-aggregator.test.ts (11 tests) 14ms
 ✓ tests/orphan-cleanup.test.ts (20 tests) 23ms
 ✓ tests/integration/codex-session-resume.test.ts (6 tests) 141ms
 ✓ tests/preflight.test.ts (27 tests | 1 skipped) 180ms
 ✓ tests/runners/codex.test.ts (21 tests) 1610ms
   ✓ spawnCodexInteractiveInPane — pane injection > sends a top-level `codex` TUI command (not `codex exec`) with prompt arg, sandbox, CODEX_HOME 321ms
   ✓ spawnCodexInteractiveInPane — pane injection > uses --dangerously-bypass-approvals-and-sandbox for phase 5 304ms
   ✓ spawnCodexInPane — fresh > sends fresh top-level `codex` TUI command with prompt as cat-substitution arg 307ms
   ✓ spawnCodexInPane — fresh in non-git cwd > does NOT add --skip-git-repo-check even when cwd is non-git (trust-entry handles it) 304ms
   ✓ spawnCodexInPane — resume > sends top-level `codex resume <sessionId>` TUI command with prompt arg 303ms
 ✓ tests/context/assembler.test.ts (77 tests) 1826ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=1 trackedRepos[0].path===cwd → raw diff without ### repo: label 458ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=2 → diff sections with ### repo: label for each repo 575ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N>1 metadata uses "Harness implementation ranges (per tracked repo):" block 613ms
 ✓ tests/resume-light.test.ts (10 tests) 49ms
 ✓ tests/integration/light-flow.test.ts (4 tests) 237ms
 ✓ tests/runners/codex-resume.test.ts (8 tests) 61ms
 ✓ tests/commands/inner-footer.test.ts (2 tests) 11ms
 ✓ tests/runners/codex-isolation.test.ts (10 tests) 26ms
 ✓ tests/context/assembler-resume.test.ts (10 tests) 74ms
 ✓ tests/tmux.test.ts (34 tests) 820ms
   ✓ pollForPidFile > returns null on timeout when file never appears 404ms
   ✓ pollForPidFile > returns null when file contains non-numeric content 404ms
 ✓ tests/commands/resume-cmd.test.ts (12 tests) 2058ms
 ✓ tests/integration/gate-stagnation.test.ts (2 tests) 12ms
 ✓ tests/phases/interactive-watchdog.test.ts (6 tests) 9ms
 ✓ tests/state-invalidation.test.ts (5 tests) 31ms
 ✓ tests/phases/gate-feedback-archival.test.ts (2 tests) 60ms
 ✓ tests/runners/claude.test.ts (4 tests) 7ms
 ✓ tests/phases/verdict.test.ts (16 tests) 4ms
 ✓ tests/phases/gate-resume-escalation.test.ts (2 tests) 39ms
 ✓ tests/resume.test.ts (11 tests) 2749ms
   ✓ resumeRun > errors when specCommit is not in git history 312ms
 ✓ tests/runners/codex-usage.test.ts (6 tests) 316ms
   ✓ readCodexSessionUsage — pinned sessionId > returns null when file missing 307ms
 ✓ tests/root.test.ts (10 tests) 175ms
 ✓ tests/context/reviewer-contract.test.ts (4 tests) 65ms
 ✓ tests/commands/status-list.test.ts (7 tests) 624ms
 ✓ tests/ink/components/CurrentPhase.test.tsx (10 tests) 20ms
 ✓ tests/ui-footer.test.ts (9 tests) 5ms
 ✓ tests/commands/jump.test.ts (6 tests) 695ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-JZkpMZ/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-JZkpMZ/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-Ga0BjE/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-Ga0BjE/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-6zqY4h/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-6zqY4h/.claude/skills:
  phase-harness-codex-gate-review
No skills directory found at /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-czcwDT/.claude/skills. Nothing to uninstall.
 ✓ tests/uninstall-skills.test.ts (6 tests) 10ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-SezYzC/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-fL9VG6/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-RXf3HL/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-QpOVcN/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-Gc3UX9/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-Gc3UX9/.claude/skills:
  phase-harness-codex-gate-review
 ✓ tests/install-skills.test.ts (7 tests) 18ms
 ✓ tests/input.test.ts (12 tests) 4ms
 ✓ tests/git.test.ts (24 tests) 2508ms
[2J[H[2J[H ✓ tests/ui.test.ts (6 tests) 5ms
 ✓ tests/multi-worktree.test.ts (11 tests) 2685ms
   ✓ (a) depth=1 auto-detect — non-git outer cwd > detects exactly depth=1 git repos, skips non-git dirs 506ms
   ✓ (b) --track / --exclude flag combinations > --track replaces auto-detect 522ms
   ✓ (b) --track / --exclude flag combinations > --exclude removes from auto-detect 457ms
   ✓ (c) assembler diff concat for N=2 repos > includes ### repo: label for each repo in N=2 case 478ms
   ✓ (d) Phase 5 success: one-of-N advanced > returns true when only repo-a advanced in a 2-repo setup 508ms
 ✓ tests/ink/components/PhaseTimeline.test.tsx (6 tests) 44ms
 ✓ tests/ink/render.test.ts (11 tests) 31ms
 ✓ tests/scripts/harness-verify.test.ts (2 tests) 326ms
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  carryover feedback path not found on disk, skipping: /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/sk-g7zGS7/phase-5-carryover-missing.md
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  claude session resume fallback: no prior attempt id
⚠️  claude session resume fallback: no prior attempt id
⚠️  claude session resume fallback: no prior attempt id
⚠️  claude session resume fallback: jsonl missing
⚠️  claude session resume fallback: jsonl missing
⚠️  claude session resume fallback: jsonl missing
⚠️  claude session resume fallback: jsonl missing
⚠️  claude session resume fallback: no prior attempt id
⚠️  claude session resume fallback: no prior attempt id
⚠️  claude session resume fallback: no prior attempt id
⚠️  claude session resume fallback: jsonl missing
⚠️  claude session resume fallback: no prior attempt id
⚠️  claude session resume fallback: no prior attempt id
⚠️  claude session resume fallback: jsonl missing
ℹ Received control signal (SIGUSR1). Applying pending action...
✓ Applied: skip. Phase loop re-entering.
ℹ Received control signal (SIGUSR1). Applying pending action...
✓ Applied: jump → phase 3. Phase loop re-entering.
ℹ Received control signal (SIGUSR1). Applying pending action...
✓ Applied: skip. Phase loop re-entering.
ℹ Received control signal (SIGUSR1). Applying pending action...
[harness] phase=5 status=failed

Recent events:
(events.jsonl not present — logging disabled)

Working tree:
(git not available)

[R] Resume   [J] Jump to phase   [Q] Quit
[harness] phase=5 status=failed
fatal: not a git repository (or any of the parent directories): .git

Recent events:
(events.jsonl not present — logging disabled)

Working tree:
(git not available)

[R] Resume   [J] Jump to phase   [Q] Quit
[harness] phase=5 status=completed

Recent events:
(events.jsonl not present — logging disabled)

Working tree:
(git not available)
```

</details>

### stagnation.ts exports tokenJaccard, StagnationDetector, loadStagnationConfig (SC#1)
**Command:** `grep -q 'export function tokenJaccard' src/phases/stagnation.ts && grep -q 'export class StagnationDetector' src/phases/stagnation.ts && grep -q 'export function loadStagnationConfig' src/phases/stagnation.ts`
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

### types.ts has gate_stagnation event variant (SC#2)
**Command:** `grep -q "event: 'gate_stagnation'" src/types.ts`
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

### types.ts has gate-stagnation escalation reason (SC#2)
**Command:** `grep -q "'gate-stagnation'" src/types.ts`
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

### runner.ts wires loadStagnationConfig and gate_stagnation (SC#3)
**Command:** `grep -q 'loadStagnationConfig' src/phases/runner.ts && grep -q 'gate_stagnation' src/phases/runner.ts`
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

### no new package.json dependency (SC#6)
**Command:** `git diff --exit-code main -- package.json`
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

### all four docs contain HARNESS_GATE_STAGNATION (SC#7)
**Command:** `grep -q 'HARNESS_GATE_STAGNATION' README.md && grep -q 'HARNESS_GATE_STAGNATION' README.ko.md && grep -q 'HARNESS_GATE_STAGNATION' docs/HOW-IT-WORKS.md && grep -q 'HARNESS_GATE_STAGNATION' docs/HOW-IT-WORKS.ko.md`
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
