# Pane Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tmux window-per-phase architecture with a two-pane layout — left 30% control panel + right 70% persistent workspace shell — so the user sees both simultaneously.

**Architecture:** Inner process splits its window into control (left) and workspace (right) panes. Claude commands are sent to the workspace pane via `send-keys` with an `exec` wrapper that writes the PID to a phase-scoped file. Completion is detected by sentinel file + PID polling. SIGUSR1 writes a phase-scoped interrupt flag and sends Ctrl-C to the workspace pane.

**Tech Stack:** TypeScript (ESM, Node16), vitest, tmux CLI, osascript (macOS), chokidar (existing).

**Related spec:** `docs/specs/2026-04-14-pane-layout-design.md` (rev5, gate-passed)

---

## Scope coverage check

| Spec section | Task |
|---|---|
| ADR-1: Single window, two panes | Task 2 (tmux.ts pane functions), Task 3 (inner.ts pane creation) |
| ADR-2: Permanent workspace shell | Task 4 (interactive.ts send-keys) |
| ADR-3: Sentinel + PID file polling | Task 4 (interactive.ts waitForPhaseCompletion) |
| ADR-4: Ctrl-C pre-send | Task 4 (interactive.ts phase spawn) |
| ADR-5: SIGUSR1 phase-aware | Task 5 (signal.ts) |
| ADR-6: Gate/verify workspace idle | No change needed (already runs in control pane) |
| ADR-7: Reused mode pane-based | Task 6 (run.ts), Task 7 (resume.ts) |
| ADR-8: Dedicated cleanup unchanged | Task 3 (inner.ts) |
| ADR-9: Control pane via CLI arg | Task 3 (inner.ts), Task 6 (run.ts), Task 7 (resume.ts) |
| ADR-10: Interrupt flag | Task 5 (signal.ts), Task 4 (interactive.ts) |
| State changes | Task 1 (types, state) |
| Testing | Task 8 |

---

## File Structure

### Modify
- `src/types.ts` — Add `tmuxWorkspacePane`, `tmuxControlPane` fields to HarnessState
- `src/state.ts` — Initialize new fields in `createInitialState`
- `src/tmux.ts` — Add pane functions: `splitPane`, `sendKeysToPane`, `selectPane`, `paneExists`, `getDefaultPaneId`, `pollForPidFile`
- `src/commands/inner.ts` — Add `--control-pane` option, pane split on startup, cleanup unchanged
- `src/phases/interactive.ts` — Replace `createWindow` with `sendKeysToPane`, PID-file-based `waitForPhaseCompletion`
- `src/signal.ts` — Phase-aware SIGUSR1: interrupt flag + Ctrl-C or child kill
- `src/commands/run.ts` — Capture default pane ID, pass `--control-pane` to `__inner`
- `src/commands/resume.ts` — Pane-aware Case 2 with stale-control fallback
- `bin/harness.ts` — Add `--control-pane` option to `__inner` command
- `tests/phases/interactive.test.ts` — Replace window mocks with pane mocks
- `tests/tmux.test.ts` — Add pane function tests

---

## Task 1: Types + State — Add pane fields

**Files:**
- Modify: `src/types.ts:48-52`
- Modify: `src/state.ts:116-120`

- [ ] **Step 1: Add pane fields to HarnessState**

In `src/types.ts`, after `tmuxOriginalWindow` (line 52), add:

```typescript
  tmuxWorkspacePane: string;
  tmuxControlPane: string;
```

- [ ] **Step 2: Initialize new fields in createInitialState**

In `src/state.ts`, after `tmuxControlWindow: ''` (line 119), add:

```typescript
    tmuxWorkspacePane: '',
    tmuxControlPane: '',
```

- [ ] **Step 3: Run lint**

```bash
pnpm run lint
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/state.ts
git commit -m "feat(pane): add tmuxWorkspacePane and tmuxControlPane to state"
```

---

## Task 2: tmux.ts — Pane utility functions

**Files:**
- Modify: `src/tmux.ts`

- [ ] **Step 1: Add `splitPane` function**

After the `sendKeys` function (line 77), add:

```typescript
/**
 * Split a pane horizontally or vertically. Returns the new pane ID (e.g., "%5").
 */
export function splitPane(
  session: string,
  targetPane: string,
  direction: 'h' | 'v',
  percent: number
): string {
  const flag = direction === 'h' ? '-h' : '-v';
  const output = execSync(
    `tmux split-window -t ${esc(session)}:${esc(targetPane)} ${flag} -p ${percent} -P -F '#{pane_id}'`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
  return output.trim();
}

/**
 * Send keys to a specific pane.
 * Special: if keys is 'C-c', sends Ctrl-C without Enter.
 */
export function sendKeysToPane(session: string, paneTarget: string, keys: string): void {
  if (keys === 'C-c') {
    execSync(`tmux send-keys -t ${esc(session)}:${esc(paneTarget)} C-c`, { stdio: 'pipe' });
  } else {
    execSync(`tmux send-keys -t ${esc(session)}:${esc(paneTarget)} ${esc(keys)} Enter`, {
      stdio: 'pipe',
    });
  }
}

/**
 * Focus a specific pane.
 */
export function selectPane(session: string, paneTarget: string): void {
  try {
    execSync(`tmux select-pane -t ${esc(session)}:${esc(paneTarget)}`, { stdio: 'pipe' });
  } catch {
    // Pane may already be gone — best-effort
  }
}

/**
 * Check if a pane exists in a session (exact match, read-only).
 */
export function paneExists(session: string, paneTarget: string): boolean {
  try {
    const output = execSync(
      `tmux list-panes -t ${esc(session)} -F '#{pane_id}'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return output.split('\n').some((line) => line.trim() === paneTarget);
  } catch {
    return false;
  }
}

/**
 * Get the first pane ID of a window (or active window if windowTarget omitted).
 */
export function getDefaultPaneId(session: string, windowTarget?: string): string {
  const target = windowTarget
    ? `${esc(session)}:${esc(windowTarget)}`
    : esc(session);
  const output = execSync(
    `tmux list-panes -t ${target} -F '#{pane_id}'`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
  const firstLine = output.split('\n')[0]?.trim();
  if (!firstLine) {
    throw new Error(`No panes found in session ${session}`);
  }
  return firstLine;
}
```

- [ ] **Step 2: Add `pollForPidFile` function**

After the pane functions, add:

```typescript
/**
 * Poll for a PID file to appear and contain a valid PID.
 * The file is written by: sh -c 'echo $$ > <pidFile>; exec claude ...'
 * Returns the PID or null on timeout.
 */
export async function pollForPidFile(pidFilePath: string, timeoutMs: number): Promise<number | null> {
  const fs = await import('fs');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const content = fs.readFileSync(pidFilePath, 'utf-8').trim();
      const pid = parseInt(content, 10);
      if (!isNaN(pid) && pid > 0) return pid;
    } catch {
      // File doesn't exist yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}
```

- [ ] **Step 3: Run lint**

```bash
pnpm run lint
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/tmux.ts
git commit -m "feat(pane): add pane utility functions (splitPane, sendKeysToPane, selectPane, paneExists, getDefaultPaneId, pollForPidFile)"
```

---

## Task 3: inner.ts — Pane split on startup + `--control-pane` option

**Files:**
- Modify: `src/commands/inner.ts`
- Modify: `bin/harness.ts:70-77`

- [ ] **Step 1: Add `--control-pane` option to InnerOptions and innerCommand**

In `src/commands/inner.ts`, update the `InnerOptions` interface:

```typescript
export interface InnerOptions {
  root?: string;
  controlPane?: string;
}
```

At the beginning of `innerCommand`, after loading state (line 28), add pane setup:

```typescript
  // 2. Claim lock ownership (outer → inner handoff)
  updateLockPid(harnessDir, process.pid);

  // 2.5 Pane setup — split workspace from control pane
  const controlPaneId = options.controlPane || '';
  state.tmuxControlPane = controlPaneId;

  if (controlPaneId && state.tmuxWorkspacePane && paneExists(state.tmuxSession, state.tmuxWorkspacePane)
      && state.tmuxWorkspacePane !== controlPaneId) {
    // Both panes valid and distinct — reuse (resume Case 2)
  } else if (controlPaneId) {
    // Create fresh workspace pane
    const workspacePaneId = splitPane(state.tmuxSession, controlPaneId, 'h', 70);
    state.tmuxWorkspacePane = workspacePaneId;
  }
  writeState(runDir, state);
```

Add imports at the top:

```typescript
import { killSession, killWindow, selectWindow, splitPane, paneExists } from '../tmux.js';
```

- [ ] **Step 2: Register `--control-pane` option in bin/harness.ts**

In `bin/harness.ts`, update the `__inner` command (line 70-77):

```typescript
program
  .command('__inner <runId>', { hidden: true })
  .description('(internal) run phase loop inside tmux session')
  .option('--root <dir>', 'explicit .harness/ parent directory')
  .option('--control-pane <paneId>', 'tmux pane ID for control panel')
  .action(async (runId: string, opts: { root?: string; controlPane?: string }) => {
    const globalOpts = program.opts();
    await innerCommand(runId, {
      root: opts.root ?? globalOpts.root,
      controlPane: opts.controlPane,
    });
  });
```

- [ ] **Step 3: Run lint**

```bash
pnpm run lint
```

- [ ] **Step 4: Commit**

```bash
git add src/commands/inner.ts bin/harness.ts
git commit -m "feat(pane): inner command splits workspace pane from --control-pane arg"
```

---

## Task 4: interactive.ts — send-keys spawn + PID-file completion

**Files:**
- Modify: `src/phases/interactive.ts`

- [ ] **Step 1: Replace imports**

At line 10, replace:
```typescript
import { createWindow, selectWindow, killWindow, windowExists } from '../tmux.js';
```
with:
```typescript
import { sendKeysToPane, selectPane, pollForPidFile } from '../tmux.js';
```

Add:
```typescript
import { isPidAlive } from '../process.js';
```

- [ ] **Step 2: Replace Claude spawn section (lines 173-189)**

Replace the section from `printAdvisorReminder` through `selectWindow` with:

```typescript
  // Step 3: Spawn Claude in workspace pane via send-keys
  printAdvisorReminder(phase);
  await new Promise<void>((resolve) => setTimeout(resolve, 300));

  const sessionName = updatedState.tmuxSession;
  const workspacePane = updatedState.tmuxWorkspacePane;

  // Ctrl-C pre-send to clear any in-progress input
  sendKeysToPane(sessionName, workspacePane, 'C-c');
  await new Promise<void>((resolve) => setTimeout(resolve, 300));

  // PID file (phase/attempt scoped)
  const pidFile = path.join(runDir, `claude-${phase}-${updatedState.phaseAttemptId[String(phase)]}.pid`);
  if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);

  // Launch Claude via exec wrapper (PID file = Claude's PID)
  const claudeArgs = `--dangerously-skip-permissions --model ${PHASE_MODELS[phase]} --effort ${PHASE_EFFORTS[phase]} @${path.resolve(promptFile)}`;
  const wrappedCmd = `sh -c 'echo $$ > ${pidFile}; exec claude ${claudeArgs}'`;
  sendKeysToPane(sessionName, workspacePane, wrappedCmd);

  // Capture Claude PID
  const claudePid = await pollForPidFile(pidFile, 5000);
```

- [ ] **Step 3: Replace waitForPhaseCompletion call**

Replace the existing call with:

```typescript
  const phaseResult = await waitForPhaseCompletion(
    sentinelPath,
    attemptId,
    claudePid,
    phase,
    updatedState,
    cwd,
    runDir
  );
```

- [ ] **Step 4: Rewrite `waitForPhaseCompletion` function**

Replace the entire `waitForPhaseCompletion` function (lines 211-281) with:

```typescript
async function waitForPhaseCompletion(
  sentinelPath: string,
  attemptId: string,
  claudePid: number | null,
  phase: InteractivePhase,
  state: HarnessState,
  cwd: string,
  runDir: string
): Promise<InteractiveResult> {
  return new Promise<InteractiveResult>((resolve) => {
    let settled = false;
    let watcher: ReturnType<typeof chokidar.watch> | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let interruptPollInterval: ReturnType<typeof setInterval> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    // Interrupt flag (phase-scoped) — clear stale flag from prior run
    const interruptFlagPath = path.join(runDir, `interrupted-${phase}.flag`);
    if (fs.existsSync(interruptFlagPath)) fs.unlinkSync(interruptFlagPath);

    function settle(status: 'completed' | 'failed'): void {
      if (settled) return;
      settled = true;
      if (watcher) { void watcher.close(); watcher = null; }
      if (pollInterval) clearInterval(pollInterval);
      if (interruptPollInterval) clearInterval(interruptPollInterval);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      // NOTE: workspace pane is NOT killed — permanent shell
      resolve({ status });
    }

    function onSentinelDetected(): void {
      if (settled) return;
      const freshness = checkSentinelFreshness(sentinelPath, attemptId);
      if (freshness === 'fresh') {
        const valid = validatePhaseArtifacts(phase, state, cwd);
        settle(valid ? 'completed' : 'failed');
      }
    }

    // Sentinel file watch
    watcher = chokidar.watch(sentinelPath, {
      persistent: true,
      ignoreInitial: false,
      usePolling: false,
    });
    watcher.on('add', onSentinelDetected);
    watcher.on('change', onSentinelDetected);

    // PID death polling (replaces window death polling)
    pollInterval = setInterval(() => {
      if (settled) return;
      if (claudePid !== null && !isPidAlive(claudePid)) {
        const freshness = checkSentinelFreshness(sentinelPath, attemptId);
        if (freshness === 'fresh') {
          const valid = validatePhaseArtifacts(phase, state, cwd);
          settle(valid ? 'completed' : 'failed');
        } else {
          settle('failed');
        }
      }
    }, 1000);

    // Interrupt flag polling (SIGUSR1 writes this for skip/jump)
    interruptPollInterval = setInterval(() => {
      if (settled) return;
      if (fs.existsSync(interruptFlagPath)) {
        try { fs.unlinkSync(interruptFlagPath); } catch { /* ignore */ }
        if (claudePid === null) {
          // PID unknown → flag is the only escape
          settle('failed');
        } else {
          // PID known → wait up to 3s for Claude to die
          const graceDeadline = Date.now() + 3000;
          const graceCheck = setInterval(() => {
            if (settled) { clearInterval(graceCheck); return; }
            if (!isPidAlive(claudePid) || Date.now() > graceDeadline) {
              clearInterval(graceCheck);
              settle('failed');
            }
          }, 200);
        }
      }
    }, 500);

    // Sentinel-only timeout (PID capture failure safety net)
    if (claudePid === null) {
      const SENTINEL_ONLY_TIMEOUT_MS = 10 * 60 * 1000;
      timeoutTimer = setTimeout(() => {
        if (!settled) {
          process.stderr.write('⚠️  Claude PID unknown + no sentinel after 10 min. Settling as failed.\n');
          settle('failed');
        }
      }, SENTINEL_ONLY_TIMEOUT_MS);
    }

    // Immediate sentinel check
    if (fs.existsSync(sentinelPath)) {
      onSentinelDetected();
    }
  });
}
```

- [ ] **Step 5: Remove post-completion window cleanup**

The existing code after `waitForPhaseCompletion` call that does `killWindow`/`selectWindow` should be removed. Settle no longer kills windows. If there's a cleanup block in the caller (the step 5/6 section), remove `killWindow` references.

- [ ] **Step 6: Run lint**

```bash
pnpm run lint
```

- [ ] **Step 7: Commit**

```bash
git add src/phases/interactive.ts
git commit -m "feat(pane): interactive phases use sendKeysToPane + PID-file completion detection"
```

---

## Task 5: signal.ts — Phase-aware SIGUSR1 with interrupt flag

**Files:**
- Modify: `src/signal.ts`

- [ ] **Step 1: Replace the window-killing block in SIGUSR1 handler**

In `src/signal.ts`, replace lines 140-144 (the `tmuxWindows`/`killWindow` block) with:

```typescript
    // Write phase-scoped interrupt flag (immediate settle for PID-null case)
    const interruptFlagPath = path.join(runDir, `interrupted-${currentState.currentPhase}.flag`);
    fs.writeFileSync(interruptFlagPath, '1');

    // Phase-type-aware interruption
    const phaseType = getCurrentPhaseType();
    if (phaseType === 'interactive' && currentState.tmuxWorkspacePane) {
      // Interactive phase: Ctrl-C to workspace pane
      sendKeysToPane(currentState.tmuxSession, currentState.tmuxWorkspacePane, 'C-c');
    } else {
      // Gate/verify phase: kill child process (existing behavior)
      const childPid = getChildPid();
      if (childPid) {
        try { process.kill(childPid, 'SIGTERM'); } catch { /* ignore */ }
      }
    }
    process.stderr.write(`✓ Applied: ${action.action}${action.phase ? ` → phase ${action.phase}` : ''}. Phase loop re-entering.\n`);
```

Update the import at the top of `signal.ts`:

Replace `import { killWindow } from '../tmux.js';` with:

```typescript
import { sendKeysToPane } from '../tmux.js';
```

- [ ] **Step 2: Run lint**

```bash
pnpm run lint
```

- [ ] **Step 3: Commit**

```bash
git add src/signal.ts
git commit -m "feat(pane): SIGUSR1 writes interrupt flag + phase-aware Ctrl-C or child kill"
```

---

## Task 6: run.ts — Capture default pane ID + pass --control-pane

**Files:**
- Modify: `src/commands/run.ts`

- [ ] **Step 1: Update imports**

Add to imports:

```typescript
import { getDefaultPaneId } from '../tmux.js';
```

- [ ] **Step 2: Update dedicated mode inner command launch (line 146)**

Replace:
```typescript
  sendKeys(sessionName, '0', innerCmd);
```
with:
```typescript
  const controlPaneId = getDefaultPaneId(sessionName);
  const innerCmdWithPane = `${innerCmd} --control-pane ${controlPaneId}`;
  sendKeys(sessionName, '0', innerCmdWithPane);
```

- [ ] **Step 3: Update reused mode inner command launch (line 148-152)**

Replace:
```typescript
  const ctrlWindowId = createWindow(sessionName, 'harness-ctrl', innerCmd);
```
with:
```typescript
  const ctrlWindowId = createWindow(sessionName, 'harness-ctrl', '');
  const controlPaneId = getDefaultPaneId(sessionName, ctrlWindowId);
  sendKeys(sessionName, ctrlWindowId, `${innerCmd} --control-pane ${controlPaneId}`);
```

Note: `createWindow` now receives `''` as the command (shell opens), and inner is started via `sendKeys`.

- [ ] **Step 4: Run lint**

```bash
pnpm run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/commands/run.ts
git commit -m "feat(pane): run.ts captures default pane ID and passes --control-pane to inner"
```

---

## Task 7: resume.ts — Pane-aware restart

**Files:**
- Modify: `src/commands/resume.ts`

- [ ] **Step 1: Add imports**

Add to imports:

```typescript
import { paneExists, getDefaultPaneId, sendKeysToPane } from '../tmux.js';
```

- [ ] **Step 2: Update Case 2 (lines 119-137)**

Replace the existing Case 2 block with:

```typescript
  if (tmuxAlive && !innerAlive) {
    // Case 2: Session alive, inner dead → restart inner (pane-aware)
    setCurrentRun(harnessDir, targetRunId);
    acquireLock(harnessDir, targetRunId);
    setLockHandoff(harnessDir, process.pid, state.tmuxSession);

    const harnessPath = process.argv[1];

    if (state.tmuxControlPane && paneExists(state.tmuxSession, state.tmuxControlPane)) {
      // Control pane valid → restart inner here
      const innerCmd = `node ${harnessPath} __inner ${targetRunId} --control-pane ${state.tmuxControlPane}`;
      sendKeysToPane(state.tmuxSession, state.tmuxControlPane, innerCmd);
    } else {
      // Control pane stale → cleanup by mode, then fall through to Case 3
      if (state.tmuxMode === 'dedicated') {
        killSession(state.tmuxSession);
      } else if (state.tmuxControlWindow) {
        killWindow(state.tmuxSession, state.tmuxControlWindow);
      }
      releaseLock(harnessDir, targetRunId);
      // Recursive: re-enter resume which will hit Case 3
      return resumeCommand(runId, options);
    }

    const handoffOk = pollForHandoffComplete(harnessDir, HANDOFF_TIMEOUT_MS);
    if (!handoffOk) {
      printError('Inner process failed to restart.');
      releaseLock(harnessDir, targetRunId);
      process.exit(1);
    }

    openTerminalWindow(state.tmuxSession);
    return;
  }
```

- [ ] **Step 3: Update Case 3 — add --control-pane to inner command**

In Case 3 (lines 139-184), update the dedicated mode branch:

Replace:
```typescript
  sendKeys(sessionName, '0', innerCmd);
```
with:
```typescript
  const controlPaneId = getDefaultPaneId(sessionName);
  sendKeys(sessionName, '0', `${innerCmd} --control-pane ${controlPaneId}`);
```

And the reused mode branch, replace:
```typescript
  const ctrlWindowId = createWindow(sessionName, 'harness-ctrl', innerCmd);
```
with:
```typescript
  const ctrlWindowId = createWindow(sessionName, 'harness-ctrl', '');
  const controlPaneId = getDefaultPaneId(sessionName, ctrlWindowId);
  sendKeys(sessionName, ctrlWindowId, `${innerCmd} --control-pane ${controlPaneId}`);
```

- [ ] **Step 4: Run lint**

```bash
pnpm run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/commands/resume.ts
git commit -m "feat(pane): resume with pane-aware Case 2 and --control-pane in Case 3"
```

---

## Task 8: Tests — Update mocks + add pane tests

**Files:**
- Modify: `tests/phases/interactive.test.ts`
- Modify: `tests/tmux.test.ts`

- [ ] **Step 1: Update interactive.test.ts mocks**

Replace the tmux mock (lines 20-24):

```typescript
vi.mock('../../src/tmux.js', () => ({
  sendKeysToPane: vi.fn(),
  selectPane: vi.fn(),
  pollForPidFile: vi.fn().mockResolvedValue(null), // PID unknown → sentinel-only
}));
```

Add process mock:

```typescript
vi.mock('../../src/process.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/process.js')>();
  return { ...actual, isPidAlive: vi.fn(() => false) };
});
```

- [ ] **Step 2: Update makeState helper to include pane fields**

In the `makeState` function, add:

```typescript
  tmuxWorkspacePane: '%1',
  tmuxControlPane: '%0',
```

- [ ] **Step 3: Update ordering test**

Replace the `printAdvisorReminder is called before createWindow` test with:

```typescript
  it('printAdvisorReminder is called before sendKeysToPane', async () => {
    const { sendKeysToPane } = await import('../../src/tmux.js');
    const { printAdvisorReminder } = await import('../../src/ui.js');
    const { runInteractivePhase } = await import('../../src/phases/interactive.js');

    vi.mocked(printAdvisorReminder).mockClear();
    vi.mocked(sendKeysToPane).mockClear();

    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();
    const repoDir = createTestRepo();
    const state = makeState();

    await runInteractivePhase(1, state, harnessDir, runDir, repoDir);

    const reminderOrder = vi.mocked(printAdvisorReminder).mock.invocationCallOrder[0];
    // sendKeysToPane is called multiple times (C-c + claude cmd), get the claude cmd call
    const sendCalls = vi.mocked(sendKeysToPane).mock.invocationCallOrder;
    const claudeCmdOrder = sendCalls.length > 1 ? sendCalls[1] : sendCalls[0];

    expect(reminderOrder).toBeDefined();
    expect(claudeCmdOrder).toBeDefined();
    expect(reminderOrder).toBeLessThan(claudeCmdOrder!);
  });
```

- [ ] **Step 4: Update spawn args test**

Replace the `createWindow command includes --dangerously-skip-permissions` test with:

```typescript
  it('sendKeysToPane command includes --dangerously-skip-permissions and --effort', async () => {
    const { sendKeysToPane } = await import('../../src/tmux.js');
    const { runInteractivePhase } = await import('../../src/phases/interactive.js');

    vi.mocked(sendKeysToPane).mockClear();

    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();
    const repoDir = createTestRepo();
    const state = makeState();

    await runInteractivePhase(1, state, harnessDir, runDir, repoDir);

    // Find the Claude command call (not the C-c call)
    const claudeCall = vi.mocked(sendKeysToPane).mock.calls.find(
      (call) => typeof call[2] === 'string' && call[2].includes('claude')
    );
    expect(claudeCall).toBeDefined();
    const command: string = claudeCall![2];

    expect(command).toContain('--dangerously-skip-permissions');
    expect(command).toContain('--effort');
    expect(command).toContain('exec claude');
  });
```

- [ ] **Step 5: Add pane tests to tests/tmux.test.ts**

Add these tests after the existing `windowExists` tests:

```typescript
describe('pane utilities', () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReset();
  });

  it('splitPane calls tmux split-window with correct args', () => {
    vi.mocked(execSync).mockReturnValue('%5\n');
    const { splitPane } = require('../src/tmux.js');
    const id = splitPane('sess', '%0', 'h', 70);
    expect(id).toBe('%5');
    const cmd = vi.mocked(execSync).mock.calls[0][0] as string;
    expect(cmd).toContain('split-window');
    expect(cmd).toContain('-h');
    expect(cmd).toContain('-p 70');
  });

  it('sendKeysToPane sends C-c without Enter', () => {
    const { sendKeysToPane } = require('../src/tmux.js');
    sendKeysToPane('sess', '%0', 'C-c');
    const cmd = vi.mocked(execSync).mock.calls[0][0] as string;
    expect(cmd).toContain('C-c');
    expect(cmd).not.toContain('Enter');
  });

  it('sendKeysToPane sends regular command with Enter', () => {
    const { sendKeysToPane } = require('../src/tmux.js');
    sendKeysToPane('sess', '%0', 'echo hi');
    const cmd = vi.mocked(execSync).mock.calls[0][0] as string;
    expect(cmd).toContain('Enter');
  });

  it('paneExists returns true on exact match', () => {
    vi.mocked(execSync).mockReturnValue('%0\n%1\n%10\n');
    const { paneExists } = require('../src/tmux.js');
    expect(paneExists('sess', '%1')).toBe(true);
    expect(paneExists('sess', '%10')).toBe(true);
    expect(paneExists('sess', '%100')).toBe(false);
  });

  it('paneExists returns false on error', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error(); });
    const { paneExists } = require('../src/tmux.js');
    expect(paneExists('sess', '%0')).toBe(false);
  });

  it('getDefaultPaneId returns first pane', () => {
    vi.mocked(execSync).mockReturnValue('%3\n%4\n');
    const { getDefaultPaneId } = require('../src/tmux.js');
    expect(getDefaultPaneId('sess')).toBe('%3');
  });

  it('getDefaultPaneId with windowTarget includes it in command', () => {
    vi.mocked(execSync).mockReturnValue('%7\n');
    const { getDefaultPaneId } = require('../src/tmux.js');
    expect(getDefaultPaneId('sess', '@2')).toBe('%7');
    const cmd = vi.mocked(execSync).mock.calls[0][0] as string;
    expect(cmd).toContain('@2');
  });

  it('getDefaultPaneId throws on empty output', () => {
    vi.mocked(execSync).mockReturnValue('\n');
    const { getDefaultPaneId } = require('../src/tmux.js');
    expect(() => getDefaultPaneId('sess')).toThrow('No panes found');
  });
});
```

- [ ] **Step 6: Run full test suite**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 7: Run lint + build**

```bash
pnpm run lint
pnpm run build
```

Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add tests/phases/interactive.test.ts tests/tmux.test.ts
git commit -m "test: update mocks for pane architecture + add pane utility tests"
```

---

## Eval checklist

```json
{
  "checks": [
    { "name": "Type check", "command": "pnpm run lint" },
    { "name": "All tests pass", "command": "pnpm test" },
    { "name": "Build succeeds", "command": "pnpm run build" },
    { "name": "CLI help works", "command": "node dist/bin/harness.js --help" },
    { "name": "splitPane exists in tmux.ts", "command": "grep -q 'splitPane' src/tmux.ts" },
    { "name": "sendKeysToPane exists in tmux.ts", "command": "grep -q 'sendKeysToPane' src/tmux.ts" },
    { "name": "paneExists exists in tmux.ts", "command": "grep -q 'paneExists' src/tmux.ts" },
    { "name": "pollForPidFile exists in tmux.ts", "command": "grep -q 'pollForPidFile' src/tmux.ts" },
    { "name": "getDefaultPaneId exists in tmux.ts", "command": "grep -q 'getDefaultPaneId' src/tmux.ts" },
    { "name": "interactive.ts uses sendKeysToPane not createWindow", "command": "grep -q 'sendKeysToPane' src/phases/interactive.ts && ! grep -q 'createWindow' src/phases/interactive.ts" },
    { "name": "interactive.ts uses isPidAlive not windowExists", "command": "grep -q 'isPidAlive' src/phases/interactive.ts && ! grep -q 'windowExists' src/phases/interactive.ts" },
    { "name": "signal.ts uses sendKeysToPane not killWindow", "command": "grep -q 'sendKeysToPane' src/signal.ts && ! grep -q 'killWindow' src/signal.ts" },
    { "name": "signal.ts writes interrupt flag", "command": "grep -q 'interrupted-' src/signal.ts" },
    { "name": "run.ts passes --control-pane", "command": "grep -q 'control-pane' src/commands/run.ts" },
    { "name": "resume.ts uses paneExists", "command": "grep -q 'paneExists' src/commands/resume.ts" },
    { "name": "inner.ts accepts --control-pane", "command": "grep -q 'controlPane' src/commands/inner.ts" },
    { "name": "inner.ts calls splitPane", "command": "grep -q 'splitPane' src/commands/inner.ts" },
    { "name": "HarnessState has tmuxWorkspacePane", "command": "grep -q 'tmuxWorkspacePane' src/types.ts" },
    { "name": "HarnessState has tmuxControlPane", "command": "grep -q 'tmuxControlPane' src/types.ts" },
    { "name": "__inner command has --control-pane option", "command": "grep -q 'control-pane' bin/harness.ts" },
    { "name": "tmux pane tests exist", "command": "grep -q 'splitPane' tests/tmux.test.ts" }
  ]
}
```

---

## Task dependencies

```
Task 1 (types/state)         ← foundation
Task 2 (tmux.ts pane funcs)  ← depends on Task 1
Task 3 (inner.ts + harness)  ← depends on Task 1, 2
Task 4 (interactive.ts)      ← depends on Task 2
Task 5 (signal.ts)           ← depends on Task 2
Task 6 (run.ts)              ← depends on Task 2
Task 7 (resume.ts)           ← depends on Task 2, 3
Task 8 (tests)               ← depends on all
```

Parallel groups:
- Group A: Task 1 (must go first)
- Group B (after 1): Task 2
- Group C (after 2): Tasks 3, 4, 5, 6 (disjoint files)
- Group D (after 3): Task 7
- Group E: Task 8 (final)
