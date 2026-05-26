# Phase-Harness Timeout Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every wall-clock timeout that can fail a phase or kill a runner. Phases end only on PID death or sentinel.

**Architecture:** Pure removal across `src/config.ts`, both runners (`src/runners/{codex,claude}.ts`), the three phase modules (`src/phases/{interactive,gate,verify,retrospective}.ts`), the user-config surface (`src/userConfig.ts` + `src/commands/config.ts`), the `LogEvent` union in `src/types.ts`, and the matching test/doc files. No new code beyond updated error messages and pruned tests.

**Tech Stack:** TypeScript (strict), Node.js, vitest, pnpm. No new dependencies.

Spec: `docs/specs/2026-05-26-timeout-removal-design.md`.

Working directory: `/Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/timeout-removal` (branch `timeout-removal`, baseline commit `40d8afd`).

Tasks are sequentially dependent. Run each, commit, then move to the next. Do **not** dispatch in parallel — `src/config.ts` constants can only be deleted after all callers (`runners/`, `phases/`, `commands/`, `userConfig.ts`) stop importing them, so ordering matters.

---

## Task 1: Remove runner-observability heartbeat + LogEvent variants + retrospective anomaly section

**Files:**
- Modify: `src/phases/interactive.ts` (heartbeat loop + options shape)
- Modify: `src/types.ts` (LogEvent union)
- Modify: `src/phases/retrospective.ts` (anomaly stats + markdown section)
- Modify: `tests/phases/interactive.test.ts` (heartbeat-related cases)
- Modify: `tests/phases/retrospective.test.ts` (runner-anomalies assertions)
- Modify: `tests/logger.test.ts` (event-shape assertions for the three variants)

- [ ] **Step 1.1: Delete the heartbeat loop in `src/phases/interactive.ts`**

Locate the block in `waitForPhaseCompletion` that starts with the comment `// #114 PR #2: observability heartbeat for interactive phases (1/3/5).` (around line 492) and ends with the closing `}, HEARTBEAT_INTERVAL_MS);` (around line 602). Delete the entire block.

Also delete the local variable `let heartbeatInterval: ReturnType<typeof setInterval> | null = null;` (around line 455) and the `clearInterval(heartbeatInterval!)` cleanup branch inside `settle()` (around lines 484-487).

In the imports near the top, remove `HEARTBEAT_INTERVAL_MS, STALL_THRESHOLD_MS, TIMEOUT_WARNING_FRACTION,` from the `'../config.js'` import line.

Also remove the `claudeSessionJsonlPath` import if its only consumer was the heartbeat loop's default `getOutputBytes`. Grep the file first:

```
grep -n claudeSessionJsonlPath src/phases/interactive.ts
```

If only the deleted block referenced it, drop the import.

- [ ] **Step 1.2: Trim `WaitForPhaseCompletionOptions`**

In `src/phases/interactive.ts`, drop `getOutputBytes?: () => number | undefined;` from the interface. Keep `logger?: Pick<SessionLogger, 'logEvent'>;` — other emit sites still use it.

If after this change the interface has only the `logger` field, leave it. If the `SessionLogger` import becomes unused anywhere in the file, remove that import too (only if grep confirms zero references).

- [ ] **Step 1.3: Delete the LogEvent variants in `src/types.ts`**

Find the union members for `runner_heartbeat`, `runner_stalled`, and `phase_timeout_warning`. Delete each variant object literal in the union (each is one `| { event: '...' ... }` arm). Also delete the JSDoc comment block immediately above them that calls out `#114 PR #1`.

Run `pnpm tsc --noEmit` after this step expecting compile errors in `retrospective.ts` and the matching tests — that is expected and gets fixed below.

- [ ] **Step 1.4: Drop the anomaly accumulators + markdown section in `src/phases/retrospective.ts`**

In the `RetrospectiveStats` interface (around line 35), delete:

```ts
  runnerAnomalies?: {
    stalls: Array<{ phase: number; attemptId: string; ts: number; silenceMs: number; elapsedMs: number; pidAlive: boolean }>;
    timeoutWarnings: Array<{ phase: number; attemptId: string; ts: number; elapsedMs: number; timeoutMs: number; remainingMs: number }>;
  };
```

…plus the JSDoc comment block immediately above it referencing `#114 PR #6`.

In `generateRetrospective`, delete:

- The two local accumulators `const stalls = [];` and `const timeoutWarnings = [];` (around lines 121-122).
- The two `if (e.event === 'runner_stalled')` and `if (e.event === 'phase_timeout_warning')` push branches (around lines 175-194).
- The `runnerAnomalies: { stalls, timeoutWarnings },` field on the returned `stats` object (around line 244).

In `renderMarkdown`, delete the `// 6b. Runner Anomalies (#114 PR #6)` block (around lines 372-396) in its entirety. The section between `## Escalations` and `## Verify` should be removed; the markdown layout becomes `Escalations → Verify` directly.

- [ ] **Step 1.5: Prune `tests/phases/interactive.test.ts` heartbeat cases**

Open `tests/phases/interactive.test.ts`. Delete every `describe` / `it` block whose subject mentions `heartbeat`, `runner_stalled`, `runner_heartbeat`, `phase_timeout_warning`, or "observability heartbeat".

The `getOutputBytes` option no longer exists, so tests that pass it via `WaitForPhaseCompletionOptions` must be deleted or rewritten to not pass it.

Verify with `grep -n "runner_heartbeat\|runner_stalled\|phase_timeout_warning\|getOutputBytes\|HEARTBEAT" tests/phases/interactive.test.ts`. Output should be empty after pruning.

- [ ] **Step 1.6: Prune `tests/phases/retrospective.test.ts`**

Delete every `describe` / `it` block whose subject mentions `runnerAnomalies`, `runner_stalled`, `phase_timeout_warning`, or "Runner Anomalies" (the markdown heading). Verify with:

```
grep -n "runner_stalled\|phase_timeout_warning\|runnerAnomalies\|Runner Anomalies" tests/phases/retrospective.test.ts
```

Output should be empty.

- [ ] **Step 1.7: Prune `tests/logger.test.ts`**

Delete each `it` block that asserts the shape of `runner_heartbeat`, `runner_stalled`, or `phase_timeout_warning`. Verify with:

```
grep -n "runner_heartbeat\|runner_stalled\|phase_timeout_warning" tests/logger.test.ts
```

Output should be empty.

- [ ] **Step 1.8: Typecheck + run affected test files**

```
pnpm tsc --noEmit
pnpm vitest run tests/phases/interactive.test.ts tests/phases/retrospective.test.ts tests/logger.test.ts
```

Expected: typecheck clean, all three test files pass with the remaining cases.

- [ ] **Step 1.9: Commit**

```
git add src/phases/interactive.ts src/phases/retrospective.ts src/types.ts \
        tests/phases/interactive.test.ts tests/phases/retrospective.test.ts tests/logger.test.ts
git commit -m "refactor(observability): remove runner heartbeat/stall/timeout-warning events"
```

---

## Task 2: Remove interactive wall-clock timeout (`absTimeout` + `nullPidTimeout`)

**Files:**
- Modify: `src/phases/interactive.ts` (timeout block, nullPidTimeout block, signature)
- Modify: `tests/phases/interactive.test.ts` (absolute-timeout cases)

- [ ] **Step 2.1: Drop the `absTimeout` block**

In `src/phases/interactive.ts`, locate the block:

```ts
    // Absolute timeout (issue #107). Fires even when claudePid is alive but
    // the runner refuses to exit (TUI mode after verdict; sentinel never
    // written). One stderr line so the operator knows why the phase failed.
    if (timeoutMs !== undefined && timeoutMs > 0) {
      absTimeout = setTimeout(() => {
        if (settled) return;
        process.stderr.write(
          `[harness] phase ${phase} timed out after ${Math.round(timeoutMs / 1000)}s waiting for sentinel\n`,
        );
        settle('failed');
      }, timeoutMs);
    }
```

Delete it entirely, plus the `let absTimeout: ReturnType<typeof setTimeout> | null = null;` declaration and the corresponding `clearTimeout(absTimeout)` branch inside `settle()`.

- [ ] **Step 2.2: Drop the `nullPidTimeout` block**

In the same file, locate:

```ts
    // Sentinel-only timeout: 10 minutes when claudePid is null
    if (claudePid === null) {
      nullPidTimeout = setTimeout(() => {
        settle('failed');
      }, 10 * 60 * 1000);
    }
```

Delete it, plus the `let nullPidTimeout: ReturnType<typeof setTimeout> | null = null;` declaration and the corresponding `clearTimeout(nullPidTimeout)` branch inside `settle()`.

- [ ] **Step 2.3: Remove the `timeoutMs?` parameter**

In `src/phases/interactive.ts`, change the `waitForPhaseCompletion` signature so the parameter list goes from:

```ts
export async function waitForPhaseCompletion(
  sentinelPath: string,
  attemptId: string,
  claudePid: number | null,
  phase: number,
  state: HarnessState,
  cwd: string,
  runDir: string,
  timeoutMs?: number,
  options?: WaitForPhaseCompletionOptions,
): Promise<InteractiveResult> {
```

to:

```ts
export async function waitForPhaseCompletion(
  sentinelPath: string,
  attemptId: string,
  claudePid: number | null,
  phase: number,
  state: HarnessState,
  cwd: string,
  runDir: string,
  options?: WaitForPhaseCompletionOptions,
): Promise<InteractiveResult> {
```

Delete the JSDoc block above the signature that explains "Absolute wall-clock timeout. Issue #107…" (around lines 437-443).

- [ ] **Step 2.4: Update the two call sites inside `runInteractivePhase`**

In the same file, the Claude branch currently calls:

```ts
    const result = await waitForPhaseCompletion(
      sentinelPath, resolvedAttemptId, claudePid, phase, updatedState, cwd, runDir,
      effectiveTimeoutMs,
      logger ? { logger } : undefined,
    );
```

Change to:

```ts
    const result = await waitForPhaseCompletion(
      sentinelPath, resolvedAttemptId, claudePid, phase, updatedState, cwd, runDir,
      logger ? { logger } : undefined,
    );
```

The Codex branch currently calls:

```ts
    const result: InteractiveResult = await waitForPhaseCompletion(
      sentinelPath, attemptId, codexPid, phase, updatedState, cwd, runDir,
      effectiveTimeoutMs,
      logger ? { logger } : undefined,
    );
```

Change to:

```ts
    const result: InteractiveResult = await waitForPhaseCompletion(
      sentinelPath, attemptId, codexPid, phase, updatedState, cwd, runDir,
      logger ? { logger } : undefined,
    );
```

Also delete the line `const effectiveTimeoutMs = getEffectiveInteractiveTimeoutMs(phase);` and the JSDoc comment block above it. Remove the `getEffectiveInteractiveTimeoutMs` import from the `'../userConfig.js'` line — the only consumer is gone.

- [ ] **Step 2.5: Prune `tests/phases/interactive.test.ts` absolute-timeout cases**

Delete every `describe` / `it` block whose subject mentions `absolute timeout`, `issue #107`, `phase ${phase} timed out`, `nullPidTimeout`, `per-phase timeout override`, or `#116 B4`.

Verify with:

```
grep -n "absolute timeout\|#107\|timed out\|nullPidTimeout\|#116 B4\|getEffectiveInteractiveTimeoutMs" tests/phases/interactive.test.ts
```

Output should be empty.

- [ ] **Step 2.6: Typecheck + run interactive tests**

```
pnpm tsc --noEmit
pnpm vitest run tests/phases/interactive.test.ts
```

Expected: clean.

- [ ] **Step 2.7: Commit**

```
git add src/phases/interactive.ts tests/phases/interactive.test.ts
git commit -m "refactor(interactive): remove wall-clock timeout — phases end on PID/sentinel only"
```

---

## Task 3: Remove gate-runner timeouts (codex + claude)

**Files:**
- Modify: `src/runners/codex.ts`
- Modify: `src/runners/claude.ts`
- Modify: `src/phases/gate.ts`
- Modify: `src/phases/runner.ts` (the "Codex 리뷰 진행 중..." copy that prints `GATE_TIMEOUT_MS`)
- Modify: `tests/runners/codex-resume.test.ts`

- [ ] **Step 3.1: Drop the codex gate timeout**

In `src/runners/codex.ts`, locate the `setTimeout` (around line 112) inside the `finishResult` promise:

```ts
    const timeout = setTimeout(async () => {
      if (settled) return;
      settled = true;
      await killProcessGroup(childPid, SIGTERM_WAIT_MS);
      resolve({ exitCode: null, timedOut: true });
    }, GATE_TIMEOUT_MS);
```

Delete it. In the surrounding `child.on('close', ...)` and `child.on('error', ...)` callbacks, remove the `clearTimeout(timeout);` calls — there is no timer to clear.

Remove `GATE_TIMEOUT_MS` and `SIGTERM_WAIT_MS` from the `'../config.js'` import IF they are no longer used anywhere else in the file. Grep first; `killProcessGroup` after the `await` (line 132) still uses `SIGTERM_WAIT_MS`, so keep that import. Only `GATE_TIMEOUT_MS` should go.

- [ ] **Step 3.2: Drop the `'timeout'` category in codex runner**

In `src/runners/codex.ts`, find `RawCategory`:

```ts
type RawCategory = 'success_verdict' | 'success_no_verdict' | 'spawn_error' | 'timeout' | 'nonzero_exit_other' | 'session_missing';
```

Remove `'timeout'`. Also delete the `timedOut?: boolean;` field from the `finishResult` promise resolve type and from the `RawExecResult`-shaped return object — search the file and remove every `timedOut` reference.

In `rawToResult` (around line 186), delete the line:

```ts
    raw.category === 'timeout' ? `Codex gate timed out after ${GATE_TIMEOUT_MS}ms` :
```

…and adjust the conditional chain so the remaining categories still cover every case (`spawn_error`, `success_no_verdict`, `session_missing`, fallback exit-code branch). Concretely the chain becomes:

```ts
  const errorMessage =
    raw.category === 'spawn_error' ? `Codex gate error: ${raw.spawnError ?? 'unknown spawn failure'}` :
    raw.category === 'success_no_verdict' ? 'Gate output missing ## Verdict header' :
    raw.category === 'session_missing' ? `Codex resume failed: session not found (stderr: ${raw.stderr.trim().slice(0, 200)})` :
    (() => {
      const tail = stderrTail(raw.stderr);
      return tail.length > 0
        ? `Gate subprocess exited with code ${raw.exitCode ?? 'null'}\n--- stderr (tail) ---\n${tail}\n---`
        : `Gate subprocess exited with code ${raw.exitCode ?? 'null'}`;
    })();
```

In the `category` resolver (around line 138), remove the line:

```ts
  else if (finishResult.timedOut) category = 'timeout';
```

so the chain becomes:

```ts
  if (finishResult.spawnError !== undefined) category = 'spawn_error';
  else if (finishResult.exitCode !== null && finishResult.exitCode !== 0) {
    category = isResumeSessionMissingError(stderr) ? 'session_missing' : 'nonzero_exit_other';
  } else {
    category = parseVerdictPresent(stdout) ? 'success_verdict' : 'success_no_verdict';
  }
```

- [ ] **Step 3.3: Drop the claude gate timeout**

In `src/runners/claude.ts`, locate the equivalent setTimeout block that resolves `{ type: 'error', error: 'Claude gate timed out after ${GATE_TIMEOUT_MS}ms' }`. Delete the entire `setTimeout(...)` call, the local timer variable, and any `clearTimeout(timer)` calls in the surrounding `child.on('close'/'error')` handlers. Remove the `GATE_TIMEOUT_MS` import from `'../config.js'` line.

Verify with:

```
grep -n "GATE_TIMEOUT_MS\|timed out" src/runners/claude.ts
```

Output should be empty.

- [ ] **Step 3.4: Drop the timeout arg from `src/phases/gate.ts`**

Locate the call around line 393-400 that passes `GATE_TIMEOUT_MS` (typically into `waitForPhaseCompletion` or a similar helper). Drop the argument and the comment "// Pass GATE_TIMEOUT_MS so a Codex CLI that emits its verdict to stdout but…".

Verify with `grep -n "GATE_TIMEOUT_MS" src/phases/gate.ts` — output should be empty.

- [ ] **Step 3.5: Drop the "Codex 리뷰 진행 중..." copy in `src/phases/runner.ts`**

Locate the line:

```ts
  printInfo(`Codex 리뷰 진행 중... (최대 ${Math.round(GATE_TIMEOUT_MS / 1000)}초 소요)`);
```

Replace with:

```ts
  printInfo('Codex 리뷰 진행 중...');
```

Remove `GATE_TIMEOUT_MS` from the `'../config.js'` import (keep the other imports on that line).

- [ ] **Step 3.6: Prune codex-resume tests that depend on `timedOut`**

In `tests/runners/codex-resume.test.ts`, delete every `describe` / `it` block whose subject or body asserts the `timedOut` raw category or `Codex gate timed out` error message. Verify with:

```
grep -n "timedOut\|timed out" tests/runners/codex-resume.test.ts
```

Output should be empty.

- [ ] **Step 3.7: Typecheck + run gate-related tests**

```
pnpm tsc --noEmit
pnpm vitest run tests/runners/codex-resume.test.ts tests/phases/gate
```

Expected: clean.

- [ ] **Step 3.8: Commit**

```
git add src/runners/codex.ts src/runners/claude.ts src/phases/gate.ts src/phases/runner.ts tests/runners/codex-resume.test.ts
git commit -m "refactor(gate): remove gate-runner wall-clock timeout"
```

---

## Task 4: Remove verify timeout

**Files:**
- Modify: `src/phases/verify.ts`

- [ ] **Step 4.1: Drop the setTimeout in verify**

In `src/phases/verify.ts`, locate the block in `runVerifyPhase` (around line 168):

```ts
  const outcome = await new Promise<VerifyOutcome>((resolve) => {
    let timedOut = false;

    const timer = setTimeout(async () => {
      timedOut = true;
      await killProcessGroup(childPid, SIGTERM_WAIT_MS);
      writeVerifyResult(runDir, 1, false);
      resolve(buildErrorOutcome(runDir, '', ''));
    }, VERIFY_TIMEOUT_MS);

    child.on('close', (exitCode: number | null) => {
      if (timedOut) return;
      clearTimeout(timer);

      const code = exitCode ?? 1;
      …
    });
```

Rewrite as (keep the existing close-handler body, just drop the timer plumbing):

```ts
  const outcome = await new Promise<VerifyOutcome>((resolve) => {
    child.on('close', (exitCode: number | null) => {
      const code = exitCode ?? 1;
      …
    });
```

Also drop the `let timedOut = false;` line and the `if (timedOut) return; clearTimeout(timer);` guard.

Remove `VERIFY_TIMEOUT_MS` from the `'../config.js'` import. Verify the remaining `SIGTERM_WAIT_MS` import is still needed (the file likely uses it for other process-group cleanup); keep it if so.

- [ ] **Step 4.2: Typecheck**

```
pnpm tsc --noEmit
```

Expected: clean. No test changes needed if the existing verify tests don't exercise the timer.

- [ ] **Step 4.3: Commit**

```
git add src/phases/verify.ts
git commit -m "refactor(verify): remove verify wall-clock timeout"
```

---

## Task 5: Remove user-config `timeoutMs` field

**Files:**
- Modify: `src/userConfig.ts`
- Modify: `src/commands/config.ts`
- Modify: `tests/userConfig.test.ts`
- Modify: `tests/commands/config.test.ts`

- [ ] **Step 5.1: Remove the field from `src/userConfig.ts`**

Delete:

1. The `timeoutMs?: number;` line in `PhaseUserConfig`.
2. The JSDoc comment above it referencing `#116 B4`.
3. The `'timeoutMs'` member of `ConfigFieldName` — narrow the type alias to `export type ConfigFieldName = 'preset';`.
4. The `TIMEOUT_CONFIGURABLE_PHASES` constant and its JSDoc.
5. The `(preset|timeoutMs)` alternation in the key-regex; replace with `preset` only.
6. The `field === 'timeoutMs'` branch in the validator.
7. The entire `getEffectiveInteractiveTimeoutMs` function and its JSDoc.
8. The `INTERACTIVE_TIMEOUT_MS` import from `'./config.js'`.

Update the "unknown config key" error message so it lists only `phase.<1|2|3|4|5|7>.preset`.

- [ ] **Step 5.2: Remove `timeoutMs` from `src/commands/config.ts`**

Delete:

1. The `INTERACTIVE_TIMEOUT_MS` import.
2. The `field === 'timeoutMs'` (or equivalent) handling in `config get`, `config set`, and `config list`.
3. Any printed `'timeoutMs'` row / `default` text inside `config list` output.

If `config get` previously printed `${INTERACTIVE_TIMEOUT_MS} (default)`, delete that line entirely.

- [ ] **Step 5.3: Prune `tests/userConfig.test.ts`**

Delete every `describe` / `it` block whose subject or body references `timeoutMs`, `TIMEOUT_CONFIGURABLE_PHASES`, or `getEffectiveInteractiveTimeoutMs`. Verify:

```
grep -n "timeoutMs\|TIMEOUT_CONFIGURABLE\|getEffectiveInteractiveTimeoutMs" tests/userConfig.test.ts
```

Output should be empty.

- [ ] **Step 5.4: Prune `tests/commands/config.test.ts`**

Delete every `describe` / `it` block that exercises `phase.<N>.timeoutMs` via the CLI. Verify:

```
grep -n "timeoutMs" tests/commands/config.test.ts
```

Output should be empty.

- [ ] **Step 5.5: Typecheck + run config tests**

```
pnpm tsc --noEmit
pnpm vitest run tests/userConfig.test.ts tests/commands/config.test.ts
```

Expected: clean.

- [ ] **Step 5.6: Commit**

```
git add src/userConfig.ts src/commands/config.ts tests/userConfig.test.ts tests/commands/config.test.ts
git commit -m "refactor(config): remove phase.<N>.timeoutMs user override"
```

---

## Task 6: Delete now-unused constants from `src/config.ts`

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 6.1: Delete the six constants**

Open `src/config.ts` and delete:

```ts
export const GATE_TIMEOUT_MS = 360_000;  // 6 min — Codex high-effort typically takes 2-4 min
export const VERIFY_TIMEOUT_MS = 300_000;
export const INTERACTIVE_TIMEOUT_MS = 1_800_000; // 30 min
```

…plus, slightly lower:

```ts
// #114 PR #2: cadence + thresholds for the runner-observability heartbeat loop
// inside `waitForPhaseCompletion`. Encoded in ms (not tick counts) so the cadence
// can be retuned later without breaking the stall threshold's semantic meaning.
export const HEARTBEAT_INTERVAL_MS = 30_000;       // 30 s heartbeat cadence
export const STALL_THRESHOLD_MS = 300_000;         // 5 min of consecutive zero-output → runner_stalled
export const TIMEOUT_WARNING_FRACTION = 0.8;       // phase_timeout_warning fires once at this fraction of timeoutMs
```

Keep `SIGTERM_WAIT_MS`, `GROUP_DRAIN_WAIT_MS`, `HANDOFF_TIMEOUT_MS`, `GATE_RETRY_LIMIT_FULL`, and any other constants below.

- [ ] **Step 6.2: Confirm no remaining references**

```
grep -rn "GATE_TIMEOUT_MS\|INTERACTIVE_TIMEOUT_MS\|VERIFY_TIMEOUT_MS\|HEARTBEAT_INTERVAL_MS\|STALL_THRESHOLD_MS\|TIMEOUT_WARNING_FRACTION" src/ tests/
```

Output should be empty.

- [ ] **Step 6.3: Full typecheck + full test suite**

```
pnpm tsc --noEmit
pnpm vitest run
```

Expected: typecheck clean. All 1440 (1 skipped) baseline tests still pass minus the cases pruned in Tasks 1, 2, 3, 5.

- [ ] **Step 6.4: Build**

```
pnpm build
```

Expected: clean, dist refreshed.

- [ ] **Step 6.5: Commit**

```
git add src/config.ts
git commit -m "refactor(config): drop now-unused timeout constants"
```

---

## Task 7: Documentation updates

**Files:**
- Modify: `README.md`
- Modify: `README.ko.md`
- Modify: `docs/HOW-IT-WORKS.md`
- Modify: `docs/HOW-IT-WORKS.ko.md`
- Modify: `docs/specs/2026-05-25-runner-observability-design.md` (status note only)
- Modify: `CLAUDE.md` (only if it references the three removed LogEvent rows)

- [ ] **Step 7.1: Search docs for stale references**

```
grep -n "INTERACTIVE_TIMEOUT_MS\|GATE_TIMEOUT_MS\|VERIFY_TIMEOUT_MS\|HEARTBEAT_INTERVAL_MS\|STALL_THRESHOLD_MS\|phase.*timeoutMs\|runner_heartbeat\|runner_stalled\|phase_timeout_warning" README.md README.ko.md docs/HOW-IT-WORKS.md docs/HOW-IT-WORKS.ko.md CLAUDE.md
```

Note every hit. Each becomes one of the next steps.

- [ ] **Step 7.2: Update `README.md` / `README.ko.md`**

For each hit in the README files: delete the sentence, paragraph, or table row that describes the timeout behavior or `phase.<N>.timeoutMs`. If a section like "Per-phase timeout override" exists, delete the whole section. If a section describes "phases fail after N minutes", rewrite to "phases end when the runner exits or writes the sentinel".

- [ ] **Step 7.3: Update `docs/HOW-IT-WORKS.md` / `.ko.md`**

Same treatment: every block describing timeouts is either deleted or replaced with a one-sentence note that phases end on PID death or sentinel only. The "Light Flow" / "Phase Lifecycle" diagrams may need an asterisk update if they show timer arrows; remove those arrows.

- [ ] **Step 7.4: Mark the runner-observability spec as superseded**

In `docs/specs/2026-05-25-runner-observability-design.md`, immediately under the title (line 1-2 area), insert:

```
Status: Superseded by docs/specs/2026-05-26-timeout-removal-design.md (heartbeat / stall / warning portions removed; tmux pane capture portion retained).
```

Do not edit anything else in the body. Historical context stays intact.

- [ ] **Step 7.5: Trim CLAUDE.md if needed**

Only edit `CLAUDE.md` if Step 7.1 surfaced hits inside it (the events.jsonl schema table lists `runner_heartbeat` etc.). Delete only the rows for the three removed events. Leave every other row.

- [ ] **Step 7.6: Re-verify docs grep is empty for removed symbols**

```
grep -n "INTERACTIVE_TIMEOUT_MS\|GATE_TIMEOUT_MS\|VERIFY_TIMEOUT_MS\|HEARTBEAT_INTERVAL_MS\|STALL_THRESHOLD_MS\|phase.*timeoutMs\|runner_heartbeat\|runner_stalled\|phase_timeout_warning" README.md README.ko.md docs/HOW-IT-WORKS.md docs/HOW-IT-WORKS.ko.md CLAUDE.md
```

Output should be empty (the supersede note in the older spec is fine — that file is not in this grep).

- [ ] **Step 7.7: Commit**

```
git add README.md README.ko.md docs/HOW-IT-WORKS.md docs/HOW-IT-WORKS.ko.md docs/specs/2026-05-25-runner-observability-design.md CLAUDE.md
git commit -m "docs: remove timeout / runner-observability references"
```

---

## Final verification

- [ ] **Final Step A: Full sweep**

```
grep -rn "INTERACTIVE_TIMEOUT_MS\|GATE_TIMEOUT_MS\|VERIFY_TIMEOUT_MS\|HEARTBEAT_INTERVAL_MS\|STALL_THRESHOLD_MS\|TIMEOUT_WARNING_FRACTION\|getEffectiveInteractiveTimeoutMs\|TIMEOUT_CONFIGURABLE_PHASES\|runner_heartbeat\|runner_stalled\|phase_timeout_warning" src/ tests/
```

Expected: empty.

- [ ] **Final Step B: Full build pipeline**

```
pnpm tsc --noEmit
pnpm vitest run
pnpm build
```

Expected: typecheck clean, all tests pass, build clean.

- [ ] **Final Step C: Glance at git log**

```
git log --oneline main..HEAD
```

Expected: 7 atomic commits matching Tasks 1-7. Reorder via interactive rebase only if a logical-grouping issue surfaces.

---

## Notes for the executor

- Do NOT introduce any new abstraction (`maybeTimeout`, `TimeoutPolicy`, etc.). The work is pure removal.
- Do NOT add comments explaining "we removed timeouts because…" — the spec + commit history is the record.
- If you find an unreferenced helper that only existed to support the removed code (e.g. a `formatTimeoutSeconds` utility), remove it. If unsure, grep for callers before deleting.
- If a deleted test was the only consumer of a fixture file, delete the fixture too.
- Each commit must keep `pnpm tsc --noEmit` clean — if Task N would leave a broken compile, fold the dependent edit into Task N's commit instead of deferring.
