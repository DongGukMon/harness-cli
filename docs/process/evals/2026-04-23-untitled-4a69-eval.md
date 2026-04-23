# Auto Verification Report
- Date: 2026-04-24
- Related Spec: N/A
- Related Plan: N/A

## Results
| Check | Status | Detail |
|-------|--------|--------|
| typecheck | pass |  |
| tests | pass |  |
| build | pass |  |
| dist/ink/render.js exists | pass |  |
| src/ink files all present | pass |  |
| render.ts has stdin:undefined exitOnCtrlC:false patchConsole:false (3 hits) | pass |  |
| mounted is exported from render.ts | pass |  |
| unmountInk is exported from render.ts | pass |  |
| inner.ts calls unmountInk before inputManager.stop | pass |  |
| ink/ does not touch process.stdin | pass |  |
| ink/ does not import tmux module | pass |  |
| package.json has ink and react dependencies | pass |  |
| RenderCallsite type preserved — terminal-complete present | pass |  |
| RenderCallsite type preserved — loop-top present | pass |  |
| light flow timeline slots contain no phase 3 or 4 key | pass |  |
| PhaseTimeline imports from phase-labels not local getSlots | pass |  |
| CurrentPhase imports from phase-labels | pass |  |

## Summary
- Total: 17 checks
- Pass: 17
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

 RUN  v2.1.9 /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/pretty

 ✓ tests/logger.test.ts (32 tests) 43ms
 ✓ tests/state.test.ts (50 tests) 45ms
 ✓ tests/context/skills-rendering.test.ts (45 tests) 62ms
 ✓ tests/phases/gate.test.ts (27 tests) 93ms
 ✓ tests/phases/runner-claude-resume.test.ts (13 tests) 28ms
 ✓ tests/runners/claude-usage.test.ts (17 tests) 71ms
 ✓ tests/phases/gate-resume.test.ts (13 tests) 160ms
 ✓ tests/signal.test.ts (16 tests) 486ms
 ✓ tests/phases/runner.test.ts (76 tests) 475ms
 ✓ tests/lock.test.ts (20 tests) 252ms
 ✓ tests/phases/terminal-ui.test.ts (18 tests) 129ms
 ✓ tests/commands/inner.test.ts (23 tests) 294ms
 ✓ tests/commands/footer-ticker.test.ts (10 tests) 73ms
 ✓ tests/integration/logging.test.ts (15 tests) 340ms
 ✓ tests/metrics/footer-aggregator.test.ts (11 tests) 7ms
 ✓ tests/runners/codex.test.ts (17 tests) 87ms
 ✓ tests/phases/verify.test.ts (14 tests) 16ms
 ✓ tests/orphan-cleanup.test.ts (20 tests) 36ms
 ✓ tests/preflight.test.ts (27 tests | 1 skipped) 217ms
 ✓ tests/integration/light-flow.test.ts (4 tests) 198ms
 ✓ tests/integration/codex-session-resume.test.ts (6 tests) 66ms
 ✓ tests/resume-light.test.ts (10 tests) 19ms
 ✓ tests/phases/runner-token-capture.test.ts (6 tests) 14ms
 ✓ tests/commands/inner-footer.test.ts (2 tests) 13ms
 ✓ tests/runners/codex-resume.test.ts (8 tests) 58ms
 ✓ tests/context/assembler.test.ts (72 tests) 1790ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=1 trackedRepos[0].path===cwd → raw diff without ### repo: label 462ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N=2 → diff sections with ### repo: label for each repo 621ms
   ✓ buildPhase7DiffAndMetadata — multi-repo (FR-5, ADR-N7, ADR-D1) > N>1 metadata uses "Harness implementation ranges (per tracked repo):" block 560ms
 ✓ tests/tmux.test.ts (33 tests) 821ms
   ✓ pollForPidFile > returns null on timeout when file never appears 406ms
   ✓ pollForPidFile > returns null when file contains non-numeric content 405ms
 ✓ tests/context/assembler-resume.test.ts (9 tests) 93ms
 ✓ tests/phases/interactive-watchdog.test.ts (6 tests) 8ms
 ✓ tests/phases/gate-feedback-archival.test.ts (2 tests) 99ms
 ✓ tests/state-invalidation.test.ts (5 tests) 14ms
 ✓ tests/runners/codex-isolation.test.ts (8 tests) 35ms
 ✓ tests/runners/claude.test.ts (4 tests) 14ms
 ✓ tests/phases/verdict.test.ts (16 tests) 5ms
 ✓ tests/commands/resume-cmd.test.ts (12 tests) 2402ms
   ✓ resumeCommand > resumeCommand — loggingEnabled inheritance > resume defaults to false when state has loggingEnabled=false 318ms
 ✓ tests/root.test.ts (10 tests) 191ms
 ✓ tests/resume.test.ts (11 tests) 3234ms
   ✓ resumeRun > exits with code 1 and non-interactive message on paused run with null pendingAction (D4b) 324ms
   ✓ resumeRun > skip_phase Phase 6 with gitignored eval report: skips commit and leaves evalCommit null 396ms
   ✓ completeInteractivePhaseFromFreshSentinel — Phase 5 multi-repo (FR-8) > returns true and sets implHead when any repo advanced 547ms
 ✓ tests/context/reviewer-contract.test.ts (4 tests) 51ms
 ✓ tests/commands/status-list.test.ts (7 tests) 647ms
 ✓ tests/phases/gate-resume-escalation.test.ts (1 test) 38ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-ZrsZFz/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-ZrsZFz/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-qtlbFW/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-qtlbFW/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-tEbWfq/.claude/skills:
  phase-harness-codex-gate-review
Uninstalled 1 skill(s) from /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-tEbWfq/.claude/skills:
  phase-harness-codex-gate-review
No skills directory found at /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/uninstall-skills-test-j5I0Yn/.claude/skills. Nothing to uninstall.
 ✓ tests/uninstall-skills.test.ts (6 tests) 27ms
 ✓ tests/git.test.ts (20 tests) 2295ms
   ✓ isAncestor > returns true when ancestor is an ancestor of descendant 323ms
 ✓ tests/ui-footer.test.ts (9 tests) 3ms
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-xQTiMQ/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-UQc4DZ/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-jbrNT4/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-b9v4ke/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-UYZCVJ/.claude/skills:
  phase-harness-codex-gate-review
Installed 1 skill(s) to /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/install-skills-test-UYZCVJ/.claude/skills:
  phase-harness-codex-gate-review
 ✓ tests/install-skills.test.ts (7 tests) 13ms
 ✓ tests/input.test.ts (12 tests) 4ms
 ✓ tests/commands/jump.test.ts (6 tests) 731ms
 ✓ tests/multi-worktree.test.ts (11 tests) 3144ms
   ✓ (a) depth=1 auto-detect — non-git outer cwd > detects exactly depth=1 git repos, skips non-git dirs 650ms
   ✓ (b) --track / --exclude flag combinations > --track replaces auto-detect 634ms
   ✓ (b) --track / --exclude flag combinations > --exclude removes from auto-detect 641ms
   ✓ (c) assembler diff concat for N=2 repos > includes ### repo: label for each repo in N=2 case 452ms
   ✓ (d) Phase 5 success: one-of-N advanced > returns true when only repo-a advanced in a 2-repo setup 536ms
[2J[H[2J[H ✓ tests/ui.test.ts (6 tests) 4ms
 ✓ tests/phases/interactive.test.ts (51 tests) 4738ms
   ✓ runInteractivePhase — Claude dispatch command shape > sendKeysToPane command includes --dangerously-skip-permissions and --effort 1586ms
   ✓ validatePhaseArtifacts — Phase 5 multi-repo (FR-6, ADR-D4) > returns true when any repo advanced; sets implHead on advanced repos only 541ms
 ✓ tests/ink/components/CurrentPhase.test.tsx (9 tests) 20ms
 ✓ tests/scripts/harness-verify.test.ts (2 tests) 359ms
 ✓ tests/task-prompt.test.ts (7 tests) 2ms
 ✓ tests/ink/components/PhaseTimeline.test.tsx (6 tests) 25ms
 ✓ tests/terminal.test.ts (5 tests) 2ms
 ✓ tests/ink/store.test.ts (4 tests) 10ms
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.
⚠️  carryover feedback path not found on disk, skipping: /var/folders/vx/1ln4rqh969s1ynxythgw3y8m0000gn/T/sk-LO1Es1/phase-5-carryover-missing.md
⚠️  claude session resume fallback: no prior attempt id
⚠️  claude session resume fallback: no prior attempt id
⚠️  claude session resume fallback: no prior attempt id
⚠️  claude session resume fallback: jsonl missing
⚠️  claude session resume fallback: jsonl missing
⚠️  claude session resume fallback: jsonl missing
⚠️  claude session resume fallback: jsonl missing
⚠️  claude session resume fallback: no prior attempt id
⚠️  claude session resume fallback: jsonl missing
⚠️  claude session resume fallback: no prior attempt id
⚠️  claude session resume fallback: no prior attempt id
⚠️  claude session resume fallback: jsonl missing
⚠️  claude session resume fallback: no prior attempt id
⚠️  claude session resume fallback: no prior attempt id
ℹ Received control signal (SIGUSR1). Applying pending action...
✓ Applied: skip. Phase loop re-entering.
ℹ Received control signal (SIGUSR1). Applying pending action...
✓ Applied: jump → phase 3. Phase loop re-entering.
ℹ Received control signal (SIGUSR1). Applying pending action...
[harness] phase=5 status=failed

Recent events:
(events.jsonl not present — logging disabled)

Working tree:
(git not available)

[R] Resume   [J] Jump to phase   [Q] Quit
[harness] phase=5 status=failed

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

[R] Resume   [J] Jump to phase   [Q] Quit
[harness] phase=5 status=failed
```

</details>

### build
**Command:** `pnpm build`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```

> phase-harness@0.3.3 build /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/pretty
> tsc -p tsconfig.build.json && node scripts/copy-assets.mjs

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

### dist/ink/render.js exists
**Command:** `ls dist/src/ink/render.js`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```
dist/src/ink/render.js
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```

```

</details>

### src/ink files all present
**Command:** `ls src/ink/render.ts src/ink/store.ts src/ink/App.tsx src/ink/theme.ts src/ink/phase-labels.ts src/ink/components/Header.tsx src/ink/components/PhaseTimeline.tsx src/ink/components/CurrentPhase.tsx src/ink/components/GateVerdict.tsx src/ink/components/ActionMenu.tsx src/ink/components/Footer.tsx`
**Exit code:** 0

<details>
<summary>stdout (truncated to 100 lines)</summary>

```
src/ink/App.tsx
src/ink/components/ActionMenu.tsx
src/ink/components/CurrentPhase.tsx
src/ink/components/Footer.tsx
src/ink/components/GateVerdict.tsx
src/ink/components/Header.tsx
src/ink/components/PhaseTimeline.tsx
src/ink/phase-labels.ts
src/ink/render.ts
src/ink/store.ts
src/ink/theme.ts
```

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

```

```

</details>

### render.ts has stdin:undefined exitOnCtrlC:false patchConsole:false (3 hits)
**Command:** `test $(grep -cE 'stdin: undefined|exitOnCtrlC: false|patchConsole: false' src/ink/render.ts) -eq 3`
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

### mounted is exported from render.ts
**Command:** `grep -qE 'export.*mounted' src/ink/render.ts`
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

### unmountInk is exported from render.ts
**Command:** `grep -q 'export function unmountInk' src/ink/render.ts`
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

### inner.ts calls unmountInk before inputManager.stop
**Command:** `python3 -c "src=open('src/commands/inner.ts').read(); ui=src.index('unmountInk()'); im=src.index('inputManager.stop()'); assert ui < im, 'unmountInk must appear before inputManager.stop()'"`
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

### ink/ does not touch process.stdin
**Command:** `test $(grep -rnE 'process\.stdin\.(setRawMode|on\(|resume\()' src/ink/ | wc -l) -eq 0`
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

### ink/ does not import tmux module
**Command:** `test $(grep -rn 'from.*tmux' src/ink/ | wc -l) -eq 0`
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

### package.json has ink and react dependencies
**Command:** `node -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf8')); if(!p.dependencies.ink||!p.dependencies.react)process.exit(1)"`
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

### RenderCallsite type preserved — terminal-complete present
**Command:** `grep -q 'terminal-complete' src/types.ts`
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

### RenderCallsite type preserved — loop-top present
**Command:** `grep -q 'loop-top' src/types.ts`
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

### light flow timeline slots contain no phase 3 or 4 key
**Command:** `python3 -c "import re,sys; src=open('src/ink/phase-labels.ts').read(); m=re.search(r\"getLightFlowSlots.*?return \\[(.*?)\\];\", src, re.DOTALL); sys.exit(0 if m and \"'3'\" not in m.group(1) and \"'4'\" not in m.group(1) else 1)"`
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

### PhaseTimeline imports from phase-labels not local getSlots
**Command:** `grep -q 'from.*phase-labels' src/ink/components/PhaseTimeline.tsx`
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

### CurrentPhase imports from phase-labels
**Command:** `grep -q 'from.*phase-labels' src/ink/components/CurrentPhase.tsx`
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
