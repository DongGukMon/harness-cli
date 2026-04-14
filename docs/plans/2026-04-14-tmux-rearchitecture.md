# tmux Rearchitecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-terminal `stdio: 'inherit'` architecture with a tmux-based multi-window system where Claude runs in separate windows and a control panel provides real-time status.

**Architecture:** Split `harness run` into outer (preflight + tmux setup + iTerm2 open) and inner (`__inner` running in tmux window 0). Claude sessions spawn as tmux windows. Gate/verify run in the control window with stderr streaming.

**Tech Stack:** TypeScript (ESM, Node16), vitest, tmux CLI, osascript (macOS), chokidar (existing).

**Related spec:** `docs/specs/2026-04-14-tmux-rearchitecture-design.md` (rev4, Codex-approved)

---

## Scope coverage check

| Spec section | Task |
|---|---|
| ADR-1: iTerm2 new window | Task 2 (terminal.ts), Task 5 (run.ts) |
| ADR-2: window-based control + phase windows | Task 6 (interactive.ts), Task 7 (runner.ts) |
| ADR-3: outer/inner split | Task 4 (inner.ts), Task 5 (run.ts) |
| ADR-4: Claude → tmux new-window | Task 6 (interactive.ts) |
| ADR-5: resume re-attach | Task 9 (resume.ts) |
| ADR-6: console.log control panel | Task 7 (runner.ts) |
| ADR-7: reused-session mode | Task 2 (tmux.ts), Task 5 (run.ts) |
| ADR-8: lock handoff | Task 3 (lock.ts) |
| ADR-9: skip/jump control-plane | Task 8 (skip/jump/signal) |
| ADR-10: terminal open fallback | Task 2 (terminal.ts) |
| State changes | Task 1 (types + state) |
| Preflight tmux check | Task 1 |
| Testing | Task 10 |

---

## File Structure

### Create
- `src/tmux.ts` — tmux session/window management (createSession, createWindow, killWindow, etc.)
- `src/terminal.ts` — iTerm2/Terminal.app window opening via osascript
- `src/commands/inner.ts` — `__inner` hidden command (phase loop inside tmux window 0)

### Modify
- `src/types.ts` — HarnessState tmux fields + LockData handoff fields
- `src/state.ts` — createInitialState tmux field defaults
- `src/config.ts` — HANDOFF_TIMEOUT_MS constant
- `src/lock.ts` — handoff protocol + updateLockPid
- `src/preflight.ts` — add `tmux` preflight item
- `bin/harness.ts` — register `__inner` command
- `src/commands/run.ts` — outer logic (tmux create + iTerm2 open)
- `src/commands/resume.ts` — tmux re-attach with 3 cases
- `src/commands/skip.ts` — pending-action + SIGUSR1 (or fallback to new tmux)
- `src/commands/jump.ts` — pending-action + SIGUSR1 (or fallback to new tmux)
- `src/phases/interactive.ts` — spawn → tmux new-window
- `src/phases/runner.ts` — control panel rendering
- `src/phases/gate.ts` — stderr streaming
- `src/phases/verify.ts` — stdout/stderr streaming
- `src/signal.ts` — SIGUSR1 handler
- `tests/phases/interactive.test.ts` — spawn → tmux mock update
- `tests/conformance/phase-models.test.ts` — (no change needed but verify)

### Test files (new)
- `tests/tmux.test.ts`
- `tests/terminal.test.ts`
- `tests/commands/inner.test.ts`

---

## Task 1: Foundation — Types, State, Config, Preflight

**Files:**
- Modify: `src/types.ts`
- Modify: `src/state.ts`
- Modify: `src/config.ts`
- Modify: `src/preflight.ts`

- [ ] **Step 1: Add tmux fields to HarnessState in `src/types.ts`**

Add after the `phaseAttemptId` field (line 47):

```typescript
  tmuxSession: string;
  tmuxMode: 'dedicated' | 'reused';
  tmuxWindows: string[];
  tmuxControlWindow: string;
  tmuxOriginalWindow?: string;
```

Add handoff fields to `LockData` (after `childStartedAt`, line 56):

```typescript
  handoff?: boolean;
  outerPid?: number;
  tmuxSession?: string;
```

Add `'tmux'` to `PreflightItem` union (line 92):

```typescript
export type PreflightItem = 'git' | 'head' | 'node' | 'claude' | 'claudeAtFile' | 'verifyScript' | 'jq' | 'codexPath' | 'platform' | 'tty' | 'tmux';
```

- [ ] **Step 2: Update `createInitialState` in `src/state.ts`**

Add tmux field defaults to the return object (after `phaseAttemptId` block, line 115):

```typescript
    tmuxSession: '',
    tmuxMode: 'dedicated',
    tmuxWindows: [],
    tmuxControlWindow: '',
```

- [ ] **Step 3: Add HANDOFF_TIMEOUT_MS to `src/config.ts`**

Add after `GROUP_DRAIN_WAIT_MS` (line 16):

```typescript
export const HANDOFF_TIMEOUT_MS = 5_000;
```

- [ ] **Step 4: Add `tmux` preflight item to `src/preflight.ts`**

In the `PHASE_ITEMS` record, add `'tmux'` to the `interactive` array:

```typescript
const PHASE_ITEMS: Record<PhaseType, PreflightItem[]> = {
  interactive: ['git', 'head', 'node', 'claude', 'claudeAtFile', 'platform', 'tty', 'tmux'],
  // ... rest unchanged
};
```

Add the `case 'tmux'` handler in the `runItem` function switch statement:

```typescript
    case 'tmux': {
      try {
        execSync('tmux -V', { stdio: 'pipe' });
      } catch {
        throw new Error('tmux is required. Install with: brew install tmux');
      }
      return {};
    }
```

- [ ] **Step 5: Run lint**

```bash
pnpm run lint
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/state.ts src/config.ts src/preflight.ts
git commit -m "feat: add tmux fields to types/state/config + tmux preflight check"
```

---

## Task 2: tmux.ts + terminal.ts (new modules)

**Files:**
- Create: `src/tmux.ts`
- Create: `src/terminal.ts`

- [ ] **Step 1: Create `src/tmux.ts`**

```typescript
import { execSync } from 'child_process';

/**
 * Create a detached tmux session.
 * Throws if tmux is not available or session name already exists.
 */
export function createSession(name: string, cwd: string): void {
  execSync(`tmux new-session -d -s ${esc(name)} -c ${esc(cwd)}`, { stdio: 'pipe' });
}

/**
 * Check if a tmux session exists.
 */
export function sessionExists(name: string): boolean {
  try {
    execSync(`tmux has-session -t ${esc(name)}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a new window in an existing session with a command.
 * Returns the tmux window ID (e.g., "@1").
 */
export function createWindow(session: string, windowName: string, command: string): string {
  const output = execSync(
    `tmux new-window -t ${esc(session)} -n ${esc(windowName)} -P -F '#{window_id}' ${esc(command)}`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
  return output.trim();
}

/**
 * Select (focus) a window by name or ID.
 */
export function selectWindow(session: string, windowTarget: string): void {
  try {
    execSync(`tmux select-window -t ${esc(session)}:${esc(windowTarget)}`, { stdio: 'pipe' });
  } catch {
    // Window may already be gone — best-effort
  }
}

/**
 * Kill a window by name or ID.
 */
export function killWindow(session: string, windowTarget: string): void {
  try {
    execSync(`tmux kill-window -t ${esc(session)}:${esc(windowTarget)}`, { stdio: 'pipe' });
  } catch {
    // Window may already be gone — best-effort
  }
}

/**
 * Kill an entire tmux session.
 */
export function killSession(name: string): void {
  try {
    execSync(`tmux kill-session -t ${esc(name)}`, { stdio: 'pipe' });
  } catch {
    // Session may already be gone
  }
}

/**
 * Send keys to a window (types the text + presses Enter).
 */
export function sendKeys(session: string, windowTarget: string, keys: string): void {
  execSync(`tmux send-keys -t ${esc(session)}:${esc(windowTarget)} ${esc(keys)} Enter`, {
    stdio: 'pipe',
  });
}

/**
 * Check if we're running inside a tmux session.
 */
export function isInsideTmux(): boolean {
  return process.env.TMUX !== undefined && process.env.TMUX !== '';
}

/**
 * Get the current tmux session name (only valid when isInsideTmux() is true).
 */
export function getCurrentSessionName(): string | null {
  try {
    return execSync('tmux display-message -p "#{session_name}"', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Get the currently active window ID in a session.
 */
export function getActiveWindowId(session: string): string | null {
  try {
    return execSync(
      `tmux display-message -t ${esc(session)} -p '#{window_id}'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
  } catch {
    return null;
  }
}

/**
 * Check if a specific window exists in a session.
 */
export function windowExists(session: string, windowTarget: string): boolean {
  try {
    execSync(`tmux select-window -t ${esc(session)}:${esc(windowTarget)}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Shell-escape a string for use in tmux commands. */
function esc(s: string): string {
  // Single-quote the string, escaping any internal single quotes
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
```

- [ ] **Step 2: Create `src/terminal.ts`**

```typescript
import { execSync } from 'child_process';
import { isInsideTmux } from './tmux.js';

/**
 * Open a new terminal window that attaches to the given tmux session.
 * Priority: iTerm2 → Terminal.app → manual fallback.
 *
 * If already inside tmux, does nothing (the user is already in the tmux server).
 *
 * Returns true if a window was opened, false if the user must manually attach.
 */
export function openTerminalWindow(tmuxSessionName: string): boolean {
  if (isInsideTmux()) {
    return true; // Already inside tmux — windows are visible
  }

  // Try iTerm2
  if (tryITerm2(tmuxSessionName)) {
    return true;
  }

  // Try Terminal.app
  if (tryTerminalApp(tmuxSessionName)) {
    return true;
  }

  // Manual fallback
  process.stderr.write(`\nCould not open a terminal window automatically.\n`);
  process.stderr.write(`Attach manually with:\n`);
  process.stderr.write(`  tmux attach -t ${tmuxSessionName}\n\n`);
  return false;
}

function tryITerm2(sessionName: string): boolean {
  try {
    execSync('osascript -e \'tell application "System Events" to get name of application processes\' 2>/dev/null | grep -q iTerm', {
      stdio: 'pipe',
    });
  } catch {
    // iTerm2 not running or not installed
    return false;
  }

  try {
    const script = `
tell application "iTerm2"
  create window with default profile
  tell current session of current window
    write text "tmux attach -t ${sessionName}"
  end tell
end tell`;
    execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function tryTerminalApp(sessionName: string): boolean {
  try {
    const script = `
tell application "Terminal"
  activate
  do script "tmux attach -t ${sessionName}"
end tell`;
    execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Run lint**

```bash
pnpm run lint
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/tmux.ts src/terminal.ts
git commit -m "feat: add tmux utility module + terminal window opener (iTerm2/Terminal.app)"
```

---

## Task 3: Lock handoff protocol

**Files:**
- Modify: `src/lock.ts`

- [ ] **Step 1: Update `assessLiveness` to handle handoff state**

In `src/lock.ts`, modify the `assessLiveness` function. After the existing `cliAlive` check block (before `// cliPid dead → check childPid`), add handoff handling:

```typescript
function assessLiveness(lock: LockData): 'active' | 'stale' {
  // Handoff check: if lock is in handoff state, check outerPid
  if (lock.handoff === true) {
    if (lock.outerPid !== undefined && isPidAlive(lock.outerPid)) {
      return 'active'; // Outer process is still alive, handoff in progress
    }
    // outerPid dead → abandoned handoff → stale
    return 'stale';
  }

  // ... existing cliAlive + childPid logic unchanged ...
```

- [ ] **Step 2: Add `updateLockPid` function**

Add after `clearLockChild`:

```typescript
/**
 * Update cliPid and clear handoff flag. Used by __inner to claim lock ownership.
 */
export function updateLockPid(harnessDir: string, newPid: number): void {
  const lockPath = repoLockPath(harnessDir);
  const tmpPath = repoLockTmpPath(harnessDir);

  const raw = fs.readFileSync(lockPath, 'utf-8');
  const lock = JSON.parse(raw) as LockData;

  lock.cliPid = newPid;
  lock.startedAt = getProcessStartTime(newPid);
  lock.handoff = false;
  lock.outerPid = undefined;

  fs.writeFileSync(tmpPath, JSON.stringify(lock, null, 2));
  const fd = fs.openSync(tmpPath, 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmpPath, lockPath);
}

/**
 * Set handoff state in lock. Used by outer before spawning __inner.
 */
export function setLockHandoff(harnessDir: string, outerPid: number, tmuxSession: string): void {
  const lockPath = repoLockPath(harnessDir);
  const tmpPath = repoLockTmpPath(harnessDir);

  const raw = fs.readFileSync(lockPath, 'utf-8');
  const lock = JSON.parse(raw) as LockData;

  lock.handoff = true;
  lock.outerPid = outerPid;
  lock.tmuxSession = tmuxSession;

  fs.writeFileSync(tmpPath, JSON.stringify(lock, null, 2));
  const fd = fs.openSync(tmpPath, 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmpPath, lockPath);
}

/**
 * Poll until lock's cliPid changes from outerPid (handoff completed).
 * Returns true if handoff completed, false on timeout.
 */
export function pollForHandoffComplete(harnessDir: string, timeoutMs: number): boolean {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const lock = readLock(harnessDir);
    if (lock && lock.handoff === false) {
      return true;
    }
    // Busy-wait 200ms
    const waitUntil = Date.now() + 200;
    while (Date.now() < waitUntil) { /* spin */ }
  }
  return false;
}
```

- [ ] **Step 3: Run lint + existing lock tests**

```bash
pnpm run lint
pnpm test tests/lock.test.ts
```

Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add src/lock.ts
git commit -m "feat: lock handoff protocol (assessLiveness handoff state, updateLockPid, setLockHandoff, poll)"
```

---

## Task 4: `__inner` command + registration

**Files:**
- Create: `src/commands/inner.ts`
- Modify: `bin/harness.ts`

- [ ] **Step 1: Create `src/commands/inner.ts`**

```typescript
import fs from 'fs';
import { join } from 'path';
import { getGitRoot } from '../git.js';
import { updateLockPid, readLock, releaseLock } from '../lock.js';
import { findHarnessRoot } from '../root.js';
import { readState, writeState } from '../state.js';
import { runPhaseLoop } from '../phases/runner.js';
import { registerSignalHandlers } from '../signal.js';
import { killSession, killWindow, selectWindow } from '../tmux.js';
import type { HarnessState } from '../types.js';

export interface InnerOptions {
  root?: string;
}

export async function innerCommand(runId: string, options: InnerOptions = {}): Promise<void> {
  const harnessDir = findHarnessRoot(options.root);
  const cwd = options.root ?? getGitRoot();
  const runDir = join(harnessDir, runId);

  // 1. Load state
  const state = readState(runDir);
  if (state === null) {
    process.stderr.write(`Run '${runId}' has no state.\n`);
    process.exit(1);
  }

  // 2. Claim lock ownership (outer → inner handoff)
  updateLockPid(harnessDir, process.pid);

  // 3. Consume pending-action.json if present
  consumePendingAction(runDir, state);

  // 4. Register signal handlers
  registerSignalHandlers({
    harnessDir,
    runId,
    getState: () => state,
    setState: (s) => Object.assign(state, s),
    getChildPid: () => readLock(harnessDir)?.childPid ?? null,
    getCurrentPhaseType: () => {
      const phase = state.currentPhase;
      if (phase === 1 || phase === 3 || phase === 5) return 'interactive';
      return 'automated';
    },
    cwd,
  });

  // 5. Run phase loop
  try {
    await runPhaseLoop(state, harnessDir, runDir, cwd);
  } finally {
    releaseLock(harnessDir, runId);
  }

  // 6. Cleanup tmux on completion
  if (state.tmuxMode === 'dedicated') {
    killSession(state.tmuxSession);
  } else {
    // Reused mode: kill only harness-owned windows
    for (const windowId of state.tmuxWindows) {
      killWindow(state.tmuxSession, windowId);
    }
    if (state.tmuxOriginalWindow) {
      selectWindow(state.tmuxSession, state.tmuxOriginalWindow);
    }
  }
}

function consumePendingAction(runDir: string, state: HarnessState): void {
  const pendingPath = join(runDir, 'pending-action.json');
  if (!fs.existsSync(pendingPath)) return;

  try {
    const raw = fs.readFileSync(pendingPath, 'utf-8');
    const action = JSON.parse(raw) as { action: string; phase?: number };

    if (action.action === 'skip') {
      // Mark current phase as completed and advance
      state.phases[String(state.currentPhase)] = 'completed';
      state.currentPhase = state.currentPhase + 1;
    } else if (action.action === 'jump' && typeof action.phase === 'number') {
      // Reset phases >= target and set currentPhase
      for (let m = action.phase; m <= 7; m++) {
        state.phases[String(m)] = 'pending';
      }
      state.currentPhase = action.phase;
      state.pendingAction = null;
      state.pauseReason = null;
    }

    writeState(runDir, state);
    fs.unlinkSync(pendingPath);
  } catch {
    // Best-effort: corrupted pending action is skipped
    try { fs.unlinkSync(pendingPath); } catch { /* ignore */ }
  }
}
```

- [ ] **Step 2: Register `__inner` in `bin/harness.ts`**

Add after the `jump` command registration (before `program.parseAsync`):

```typescript
import { innerCommand } from '../src/commands/inner.js';

program
  .command('__inner <runId>')
  .description('(internal) run phase loop inside tmux session')
  .option('--root <dir>', 'explicit .harness/ parent directory')
  .action(async (runId: string, opts: { root?: string }) => {
    const globalOpts = program.opts();
    await innerCommand(runId, { root: opts.root ?? globalOpts.root });
  });
```

Note: The `__inner` command is hidden from help (commander hides commands starting with `__` by convention, or we can add `.hideHelp()`).

Actually, commander doesn't auto-hide `__` prefixed commands. Add `.hideHelp()`:

```typescript
program
  .command('__inner <runId>', { hidden: true })
  .description('(internal) run phase loop inside tmux session')
  .action(async (runId: string, opts: { root?: string }) => {
    const globalOpts = program.opts();
    await innerCommand(runId, { root: opts.root ?? globalOpts.root });
  });
```

- [ ] **Step 3: Run lint**

```bash
pnpm run lint
```

- [ ] **Step 4: Commit**

```bash
git add src/commands/inner.ts bin/harness.ts
git commit -m "feat: add __inner hidden command for tmux-hosted phase loop"
```

---

## Task 5: Refactor `run.ts` to outer logic

**Files:**
- Modify: `src/commands/run.ts`

- [ ] **Step 1: Read current `src/commands/run.ts`**

The current flow is: preflight → state init → signal handlers → `runPhaseLoop()` → release lock.

The new flow is: preflight → state init → tmux session create → handoff to `__inner` → iTerm2 open → exit.

- [ ] **Step 2: Rewrite `runCommand` function**

Replace the section starting from `// 17. Register signal handlers` (line 122) through the end of the `try` block. The new code replaces `registerSignalHandlers` + `runPhaseLoop` with tmux setup:

```typescript
    // 17. Determine tmux mode
    const insideTmux = isInsideTmux();
    const sessionName = insideTmux
      ? getCurrentSessionName()!
      : `harness-${runId}`;

    state.tmuxSession = sessionName;
    state.tmuxMode = insideTmux ? 'reused' : 'dedicated';

    if (insideTmux) {
      state.tmuxOriginalWindow = getActiveWindowId(sessionName) ?? undefined;
    }

    writeState(runDir, state);

    // 18. Set lock handoff state
    setLockHandoff(harnessDir, process.pid, sessionName);

    // 19. Create tmux session (dedicated) or window (reused)
    const harnessPath = process.argv[1]; // path to harness.js
    const innerCmd = `node ${harnessPath} __inner ${runId}${options.root ? ` --root ${options.root}` : ''}`;

    if (!insideTmux) {
      createSession(sessionName, cwd);
      sendKeys(sessionName, '0', innerCmd);
    } else {
      const ctrlWindowId = createWindow(sessionName, 'harness-ctrl', innerCmd);
      state.tmuxControlWindow = ctrlWindowId;
      state.tmuxWindows.push(ctrlWindowId);
      writeState(runDir, state);
      selectWindow(sessionName, ctrlWindowId);
    }

    // 20. Wait for inner to claim lock (handoff complete)
    const handoffOk = pollForHandoffComplete(harnessDir, HANDOFF_TIMEOUT_MS);
    if (!handoffOk) {
      printError('Inner process failed to start within 5 seconds.');
      if (!insideTmux) {
        killSession(sessionName);
      }
      releaseLock(harnessDir, runId);
      process.exit(1);
    }

    // 21. Open terminal window (dedicated mode only)
    if (!insideTmux) {
      const opened = openTerminalWindow(sessionName);
      if (!opened) {
        process.exit(1);
      }
    }

    printSuccess(`Harness session started: ${sessionName}`);
    // Do NOT release lock — inner owns it now
    lockAcquired = false; // Prevent finally block from releasing
```

Add imports at the top of `run.ts`:

```typescript
import { isInsideTmux, getCurrentSessionName, getActiveWindowId, createSession, createWindow, sendKeys, killSession, selectWindow } from '../tmux.js';
import { openTerminalWindow } from '../terminal.js';
import { setLockHandoff, pollForHandoffComplete } from '../lock.js';
import { HANDOFF_TIMEOUT_MS } from '../config.js';
import { printSuccess, printError } from '../ui.js';
```

Remove the now-unused imports: `runPhaseLoop`, `registerSignalHandlers`, `readLock`.

- [ ] **Step 3: Run lint**

```bash
pnpm run lint
```

- [ ] **Step 4: Commit**

```bash
git add src/commands/run.ts
git commit -m "feat: refactor run.ts to outer logic (tmux create + handoff + iTerm2)"
```

---

## Task 6: interactive.ts — tmux window spawn + test update

**Files:**
- Modify: `src/phases/interactive.ts`
- Modify: `tests/phases/interactive.test.ts`

- [ ] **Step 1: Refactor `runInteractivePhase` to use tmux windows**

In `src/phases/interactive.ts`, replace the spawn section (Step 3, lines 174-181) with tmux window creation:

```typescript
  // Step 3: Spawn Claude in a tmux window
  printAdvisorReminder(phase);
  await new Promise<void>((resolve) => setTimeout(resolve, 300));

  const sessionName = state.tmuxSession;
  const windowName = `phase-${phase}`;
  const claudeCmd = [
    'claude',
    '--dangerously-skip-permissions',
    '--model', PHASE_MODELS[phase],
    '--effort', PHASE_EFFORTS[phase],
    '@' + path.resolve(promptFile),
  ].join(' ');

  const windowId = createWindow(sessionName, windowName, claudeCmd);
  state.tmuxWindows.push(windowId);
  writeState(runDir, state);
  selectWindow(sessionName, windowId);
```

Replace imports: remove `spawn` from `child_process`, add:

```typescript
import { createWindow, selectWindow, killWindow, windowExists } from '../tmux.js';
```

- [ ] **Step 2: Rewrite `waitForPhaseCompletion`**

Replace the entire `waitForPhaseCompletion` function:

```typescript
async function waitForPhaseCompletion(
  sessionName: string,
  windowId: string,
  sentinelPath: string,
  attemptId: string,
  phase: InteractivePhase,
  state: HarnessState,
  cwd: string
): Promise<InteractiveResult> {
  return new Promise<InteractiveResult>((resolve) => {
    let settled = false;
    let watcher: ReturnType<typeof chokidar.watch> | null = null;

    function settle(status: 'completed' | 'failed'): void {
      if (settled) return;
      settled = true;
      if (watcher) {
        void watcher.close();
        watcher = null;
      }
      // Kill the Claude window + return focus to control
      killWindow(sessionName, windowId);
      selectWindow(sessionName, state.tmuxControlWindow || '0');
      resolve({ status });
    }

    // Sentinel detection → kill window → evaluate
    function onSentinelDetected(): void {
      if (settled) return;
      const freshness = checkSentinelFreshness(sentinelPath, attemptId);
      if (freshness === 'fresh') {
        const valid = validatePhaseArtifacts(phase, state, cwd);
        settle(valid ? 'completed' : 'failed');
      }
    }

    // Set up chokidar watcher on sentinel path
    watcher = chokidar.watch(sentinelPath, {
      persistent: true,
      ignoreInitial: false,
      usePolling: false,
    });

    watcher.on('add', onSentinelDetected);
    watcher.on('change', onSentinelDetected);

    // Also poll for tmux window death (user did /exit without sentinel)
    const pollInterval = setInterval(() => {
      if (settled) {
        clearInterval(pollInterval);
        return;
      }
      if (!windowExists(sessionName, windowId)) {
        clearInterval(pollInterval);
        // Window died — check sentinel one last time
        const freshness = checkSentinelFreshness(sentinelPath, attemptId);
        if (freshness === 'fresh') {
          const valid = validatePhaseArtifacts(phase, state, cwd);
          settle(valid ? 'completed' : 'failed');
        } else {
          settle('failed');
        }
      }
    }, 1000);

    // Immediate check
    if (fs.existsSync(sentinelPath)) {
      onSentinelDetected();
    }
  });
}
```

Update the call site in `runInteractivePhase`:

```typescript
  const phaseResult = await waitForPhaseCompletion(
    sessionName,
    windowId,
    sentinelPath,
    attemptId,
    phase,
    updatedState,
    cwd
  );
```

Remove the post-completion process group cleanup (Step 5/6 block) — tmux window cleanup is now inside `waitForPhaseCompletion`.

- [ ] **Step 3: Update `tests/phases/interactive.test.ts`**

The existing mocks for `child_process.spawn` need to be replaced with mocks for `tmux.js`. Replace the module-level mocks:

```typescript
vi.mock('../../src/tmux.js', () => ({
  createWindow: vi.fn(() => '@99'),
  selectWindow: vi.fn(),
  killWindow: vi.fn(),
  windowExists: vi.fn(() => false), // Window dies immediately in tests
}));
```

Keep the existing `ui.js`, `lock.js`, `process.js`, `context/assembler.js` mocks.

Remove the `child_process` mock entirely.

Update the ordering test to verify `printAdvisorReminder` is called before `createWindow` (replacing the spawn ordering check):

```typescript
  it('printAdvisorReminder is called before createWindow', async () => {
    const { createWindow } = await import('../../src/tmux.js');
    const { printAdvisorReminder } = await import('../../src/ui.js');
    const { runInteractivePhase } = await import('../../src/phases/interactive.js');

    vi.mocked(printAdvisorReminder).mockClear();
    vi.mocked(createWindow).mockClear();

    // Write sentinel to auto-complete the phase
    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();
    const repoDir = createTestRepo();
    const state = makeState();

    await runInteractivePhase(1, state, harnessDir, runDir, repoDir);

    const reminderOrder = vi.mocked(printAdvisorReminder).mock.invocationCallOrder[0];
    const createOrder = vi.mocked(createWindow).mock.invocationCallOrder[0];

    expect(reminderOrder).toBeDefined();
    expect(createOrder).toBeDefined();
    expect(reminderOrder).toBeLessThan(createOrder);
  });
```

Update spawn args test to check createWindow args:

```typescript
  it('createWindow is called with correct claude args', async () => {
    const { createWindow } = await import('../../src/tmux.js');
    const { runInteractivePhase } = await import('../../src/phases/interactive.js');

    vi.mocked(createWindow).mockClear();

    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();
    const repoDir = createTestRepo();
    const state = makeState();

    await runInteractivePhase(1, state, harnessDir, runDir, repoDir);

    const call = vi.mocked(createWindow).mock.calls[0];
    const command: string = call[2]; // third arg is the command string

    expect(command).toContain('--dangerously-skip-permissions');
    expect(command).toContain('--effort');
    expect(command).toContain('--model');
  });
```

- [ ] **Step 4: Run tests**

```bash
pnpm test tests/phases/interactive.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/phases/interactive.ts tests/phases/interactive.test.ts
git commit -m "feat: interactive phases spawn Claude via tmux new-window (replaces stdio:inherit)"
```

---

## Task 7: Control panel + gate/verify streaming

**Files:**
- Modify: `src/phases/runner.ts`
- Modify: `src/phases/gate.ts`
- Modify: `src/phases/verify.ts`
- Modify: `src/ui.ts`

- [ ] **Step 1: Add `renderControlPanel` to `src/ui.ts`**

```typescript
export function renderControlPanel(state: HarnessState): void {
  const SEPARATOR = '━'.repeat(50);
  process.stdout.write('\x1b[2J\x1b[H'); // clear screen
  console.error(SEPARATOR);
  console.error(`${GREEN}▶${RESET} Harness Control Panel`);
  console.error(SEPARATOR);
  console.error(`  Run:   ${state.runId}`);
  console.error(`  Phase: ${state.currentPhase}/7 — ${phaseLabel(state.currentPhase)}`);
  const model = PHASE_MODELS[state.currentPhase];
  if (model) console.error(`  Model: ${model}`);
  console.error('');

  for (let p = 1; p <= 7; p++) {
    const status = state.phases[String(p)] ?? 'pending';
    const icon = status === 'completed' ? `${GREEN}✓${RESET}`
      : status === 'in_progress' ? `${YELLOW}▶${RESET}`
      : status === 'failed' || status === 'error' ? `${RED}✗${RESET}`
      : ' ';
    const current = p === state.currentPhase ? ' ← current' : '';
    console.error(`  [${icon}] Phase ${p}: ${phaseLabel(p)} (${status})${current}`);
  }
  console.error('');
  console.error(SEPARATOR);
}
```

Add the import for `PHASE_MODELS` and `HarnessState` at the top of `ui.ts`.

- [ ] **Step 2: Update `runner.ts` — render control panel at phase transitions**

Replace the existing `printPhaseTransition` calls with `renderControlPanel`:

Before each phase handler, call `renderControlPanel(state)`.

In `handleInteractivePhase`, before the phase starts:

```typescript
  renderControlPanel(state);
```

After completion:

```typescript
  if (result.status === 'completed') {
    // ... existing commit/anchor logic ...
    state.phases[String(phase)] = 'completed';
    const next = nextPhase(phase);
    state.currentPhase = next;
    writeState(runDir, state);
    renderControlPanel(state);
  }
```

Do the same for `handleGatePhase` and `handleVerifyPhase`.

Remove the old `process.stdout.write('\x1b[2J\x1b[H')` + `printPhaseTransition` calls and replace with `renderControlPanel(state)`.

- [ ] **Step 3: Add gate stderr streaming in `src/phases/gate.ts`**

After the existing `child.stderr.on('data', ...)` line (line 209), modify to print codex progress:

```typescript
  child.stderr.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk);
    // Stream [codex] progress lines to control panel
    const text = chunk.toString();
    for (const line of text.split('\n')) {
      if (line.includes('[codex]')) {
        process.stderr.write(`  ${line}\n`);
      }
    }
  });
```

- [ ] **Step 4: Add verify.ts stderr streaming**

In `src/phases/verify.ts`, add stderr streaming for the harness-verify.sh subprocess. Find the existing `child.stderr.on('data', ...)` line and ensure it outputs to the control panel:

```typescript
  child.stderr.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk);
    // Stream verify progress to control panel
    process.stderr.write(chunk.toString());
  });
```

Similarly for stdout:

```typescript
  child.stdout.on('data', (chunk: Buffer) => {
    stdoutChunks.push(chunk);
    // Stream check results to control panel
    const text = chunk.toString();
    if (text.includes('Running:') || text.includes('PASS') || text.includes('FAIL')) {
      process.stderr.write(`  ${text}`);
    }
  });
```

- [ ] **Step 5: Run lint**

```bash
pnpm run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/ui.ts src/phases/runner.ts src/phases/gate.ts src/phases/verify.ts
git commit -m "feat: control panel rendering + gate/verify stderr streaming"
```

---

## Task 8: skip/jump control-plane + SIGUSR1

**Files:**
- Modify: `src/commands/skip.ts`
- Modify: `src/commands/jump.ts`
- Modify: `src/signal.ts`

- [ ] **Step 1: Refactor `skipCommand` in `src/commands/skip.ts`**

The key change: if an inner process is alive, write `pending-action.json` + send SIGUSR1 instead of acquiring lock + running phase loop.

At the top of `skipCommand`, after loading state, add the active-inner check:

```typescript
  // Check if inner process is running
  const lock = readLock(harnessDir);
  const innerAlive = lock && lock.handoff === false && isPidAlive(lock.cliPid);

  if (innerAlive) {
    // Active tmux session — send control-plane signal
    const pendingPath = join(runDir, 'pending-action.json');
    writeFileSync(pendingPath, JSON.stringify({ action: 'skip' }));
    process.kill(lock!.cliPid, 'SIGUSR1');
    process.stderr.write(`Skip signal sent to active harness session.\n`);
    return;
  }

  // No active inner → fall through to legacy behavior (acquire lock + run)
```

Add import for `isPidAlive` from `../process.js` and `writeFileSync` from `fs`.

- [ ] **Step 2: Refactor `jumpCommand` in `src/commands/jump.ts`**

Same pattern as skip:

```typescript
  const lock = readLock(harnessDir);
  const innerAlive = lock && lock.handoff === false && isPidAlive(lock.cliPid);

  if (innerAlive) {
    const pendingPath = join(runDir, 'pending-action.json');
    writeFileSync(pendingPath, JSON.stringify({ action: 'jump', phase: N }));
    process.kill(lock!.cliPid, 'SIGUSR1');
    process.stderr.write(`Jump to phase ${N} signal sent to active harness session.\n`);
    return;
  }
```

- [ ] **Step 3: Add SIGUSR1 handler to `src/signal.ts`**

In `registerSignalHandlers`, add after the existing SIGINT/SIGTERM handlers:

```typescript
  // SIGUSR1: control-plane signal for skip/jump
  // Import consumePendingAction from inner.ts (or inline the logic)
  process.on('SIGUSR1', () => {
    process.stderr.write('ℹ Received control signal (SIGUSR1). Applying pending action...\n');

    // Read and apply pending-action.json immediately
    const runDir = path.join(harnessDir, runId);
    const pendingPath = path.join(runDir, 'pending-action.json');
    if (!fs.existsSync(pendingPath)) return;

    try {
      const raw = fs.readFileSync(pendingPath, 'utf-8');
      const action = JSON.parse(raw) as { action: string; phase?: number };
      const state = getState();

      if (action.action === 'skip') {
        state.phases[String(state.currentPhase)] = 'completed';
        state.currentPhase = state.currentPhase + 1;
        state.pendingAction = null;
      } else if (action.action === 'jump' && typeof action.phase === 'number') {
        for (let m = action.phase; m <= 7; m++) {
          state.phases[String(m)] = 'pending';
        }
        state.currentPhase = action.phase;
        state.pendingAction = null;
        state.pauseReason = null;
      }

      setState(state);
      writeState(runDir, state);
      fs.unlinkSync(pendingPath);

      // Interrupt the current phase — the runner will pick up the new state
      // on its next iteration. For interactive phases (Claude in tmux window),
      // kill the window to force re-evaluation.
      process.stderr.write(`✓ Applied: ${action.action}${action.phase ? ` → phase ${action.phase}` : ''}. Phase loop will re-enter.\n`);
    } catch {
      process.stderr.write('⚠️  Failed to apply pending action.\n');
    }
  });
```

- [ ] **Step 4: Run lint**

```bash
pnpm run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/commands/skip.ts src/commands/jump.ts src/signal.ts
git commit -m "feat: skip/jump as control-plane commands (pending-action + SIGUSR1)"
```

---

## Task 9: resume.ts — tmux re-attach

**Files:**
- Modify: `src/commands/resume.ts`

- [ ] **Step 1: Rewrite `resumeCommand`**

The new resume logic has 3 cases per spec. Replace the section after state loading and validation with:

```typescript
  // Check tmux session state
  const tmuxAlive = state.tmuxSession && sessionExists(state.tmuxSession);
  const lock = readLock(harnessDir);
  const innerAlive = lock && lock.handoff === false && isPidAlive(lock.cliPid);

  if (tmuxAlive && innerAlive) {
    // Case 1: Session + inner both alive → re-attach only
    setCurrentRun(harnessDir, targetRunId);
    const opened = openTerminalWindow(state.tmuxSession);
    if (!opened) {
      process.stderr.write(`Attach manually: tmux attach -t ${state.tmuxSession}\n`);
    }
    return;
  }

  if (tmuxAlive && !innerAlive) {
    // Case 2: Session alive, inner dead → restart inner
    setCurrentRun(harnessDir, targetRunId);
    acquireLock(harnessDir, targetRunId);
    setLockHandoff(harnessDir, process.pid, state.tmuxSession);

    const harnessPath = process.argv[1];
    const ctrlWindow = state.tmuxControlWindow || '0';
    sendKeys(state.tmuxSession, ctrlWindow, `node ${harnessPath} __inner ${targetRunId}`);

    const handoffOk = pollForHandoffComplete(harnessDir, HANDOFF_TIMEOUT_MS);
    if (!handoffOk) {
      process.stderr.write('Inner process failed to restart.\n');
      releaseLock(harnessDir, targetRunId);
      process.exit(1);
    }

    openTerminalWindow(state.tmuxSession);
    return;
  }

  // Case 3: No session → create new + start inner
  // ... (existing preflight, codex path check, then tmux setup like run.ts)
```

For Case 3, replicate the tmux setup logic from `run.ts` Task 5.

Add imports:

```typescript
import { sessionExists, createSession, sendKeys, selectWindow, isInsideTmux, getCurrentSessionName, getActiveWindowId, createWindow } from '../tmux.js';
import { openTerminalWindow } from '../terminal.js';
import { setLockHandoff, pollForHandoffComplete } from '../lock.js';
import { isPidAlive } from '../process.js';
import { HANDOFF_TIMEOUT_MS } from '../config.js';
```

- [ ] **Step 2: Run lint**

```bash
pnpm run lint
```

- [ ] **Step 3: Commit**

```bash
git add src/commands/resume.ts
git commit -m "feat: resume with 3-case tmux re-attach (alive, dead-inner, no session)"
```

---

## Task 10: Tests + Full Verification

**Files:**
- Create: `tests/tmux.test.ts`
- Create: `tests/terminal.test.ts`
- Modify: existing test files as needed

- [ ] **Step 1: Create `tests/tmux.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', async (importActual) => {
  const actual = await importActual<typeof import('child_process')>();
  return { ...actual, execSync: vi.fn() };
});

import { execSync } from 'child_process';
import { createSession, sessionExists, createWindow, killWindow, isInsideTmux } from '../src/tmux.js';

describe('tmux utilities', () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReset();
  });

  it('createSession calls tmux new-session with correct args', () => {
    createSession('test-session', '/tmp/test');
    expect(vi.mocked(execSync)).toHaveBeenCalledWith(
      expect.stringContaining('new-session'),
      expect.any(Object)
    );
    const cmd = vi.mocked(execSync).mock.calls[0][0] as string;
    expect(cmd).toContain('test-session');
    expect(cmd).toContain('/tmp/test');
  });

  it('sessionExists returns true on success', () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));
    expect(sessionExists('test')).toBe(true);
  });

  it('sessionExists returns false on error', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('no session'); });
    expect(sessionExists('test')).toBe(false);
  });

  it('createWindow returns window ID', () => {
    vi.mocked(execSync).mockReturnValue('@42\n');
    const id = createWindow('sess', 'win', 'echo hi');
    expect(id).toBe('@42');
  });

  it('isInsideTmux checks TMUX env var', () => {
    const orig = process.env.TMUX;
    process.env.TMUX = '/tmp/tmux-501/default,12345,0';
    expect(isInsideTmux()).toBe(true);
    delete process.env.TMUX;
    expect(isInsideTmux()).toBe(false);
    if (orig) process.env.TMUX = orig;
  });
});
```

- [ ] **Step 2: Create `tests/terminal.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', async (importActual) => {
  const actual = await importActual<typeof import('child_process')>();
  return { ...actual, execSync: vi.fn() };
});

vi.mock('../src/tmux.js', () => ({
  isInsideTmux: vi.fn(() => false),
}));

import { execSync } from 'child_process';
import { isInsideTmux } from '../src/tmux.js';
import { openTerminalWindow } from '../src/terminal.js';

describe('openTerminalWindow', () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReset();
    vi.mocked(isInsideTmux).mockReturnValue(false);
  });

  it('returns true when already inside tmux', () => {
    vi.mocked(isInsideTmux).mockReturnValue(true);
    expect(openTerminalWindow('test')).toBe(true);
    expect(vi.mocked(execSync)).not.toHaveBeenCalled();
  });

  it('tries iTerm2 first', () => {
    // First call: grep iTerm → success, second call: osascript → success
    vi.mocked(execSync)
      .mockReturnValueOnce(Buffer.from('iTerm2'))  // grep check
      .mockReturnValueOnce(Buffer.from(''));         // osascript

    expect(openTerminalWindow('test-session')).toBe(true);
  });

  it('falls through to Terminal.app when iTerm2 fails', () => {
    // First call: grep iTerm → fail, second call: Terminal osascript → success
    vi.mocked(execSync)
      .mockImplementationOnce(() => { throw new Error('no iTerm'); }) // grep
      .mockReturnValueOnce(Buffer.from(''));  // Terminal.app osascript

    expect(openTerminalWindow('test-session')).toBe(true);
  });

  it('returns false when both fail', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('fail'); });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    expect(openTerminalWindow('test-session')).toBe(false);
    const output = stderrSpy.mock.calls.map(c => String(c[0])).join('');
    expect(output).toContain('tmux attach');

    stderrSpy.mockRestore();
  });
});
```

- [ ] **Step 3: Run full test suite**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 4: Run lint + build**

```bash
pnpm run lint
pnpm run build
```

Expected: both clean.

- [ ] **Step 5: Commit tests**

```bash
git add tests/tmux.test.ts tests/terminal.test.ts
git commit -m "test: tmux + terminal unit tests"
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
    { "name": "tmux.ts exists", "command": "test -f src/tmux.ts" },
    { "name": "terminal.ts exists", "command": "test -f src/terminal.ts" },
    { "name": "inner.ts exists", "command": "test -f src/commands/inner.ts" },
    { "name": "interactive.ts uses createWindow not spawn",
      "command": "grep -q 'createWindow' src/phases/interactive.ts && ! grep -q \"spawn('claude'\" src/phases/interactive.ts" },
    { "name": "run.ts creates tmux session",
      "command": "grep -q 'createSession\\|createWindow' src/commands/run.ts" },
    { "name": "lock.ts has handoff support",
      "command": "grep -q 'setLockHandoff' src/lock.ts" },
    { "name": "HarnessState has tmuxSession field",
      "command": "grep -q 'tmuxSession' src/types.ts" },
    { "name": "tmux preflight item exists",
      "command": "grep -q \"'tmux'\" src/preflight.ts" },
    { "name": "Gate stderr streaming present",
      "command": "grep -q 'codex' src/phases/gate.ts" },
    { "name": "Verify stderr streaming present",
      "command": "grep -q 'process.stderr.write' src/phases/verify.ts" },
    { "name": "SIGUSR1 handler consumes pending-action",
      "command": "grep -q 'pending-action.json' src/signal.ts" },
    { "name": "skip.ts writes pending-action for active inner",
      "command": "grep -q 'pending-action.json' src/commands/skip.ts" },
    { "name": "jump.ts writes pending-action for active inner",
      "command": "grep -q 'pending-action.json' src/commands/jump.ts" },
    { "name": "resume.ts handles 3 cases (session+inner, session+dead, none)",
      "command": "grep -c 'sessionExists\\|innerAlive\\|Case' src/commands/resume.ts | head -1 | grep -qE '[3-9]'" },
    { "name": "renderControlPanel exists in ui.ts",
      "command": "grep -q 'renderControlPanel' src/ui.ts" },
    { "name": "tmux unit tests exist",
      "command": "test -f tests/tmux.test.ts" },
    { "name": "terminal unit tests exist",
      "command": "test -f tests/terminal.test.ts" }
  ]
}
```

---

## Task dependencies

```
Task 1 (types/state/config/preflight)  ← foundation — all depend on this
Task 2 (tmux.ts + terminal.ts)         ← depends on Task 1
Task 3 (lock handoff)                  ← depends on Task 1
Task 4 (inner.ts + harness.ts)         ← depends on Task 1, 3
Task 5 (run.ts refactor)               ← depends on Task 2, 3
Task 6 (interactive.ts + tests)         ← depends on Task 2
Task 7 (runner.ts + gate.ts + verify.ts)← depends on Task 1
Task 8 (skip/jump + signal)            ← depends on Task 1, 3, 4
Task 9 (resume.ts)                     ← depends on Task 2, 3, 4
Task 10 (tests + verification)         ← depends on all
```

Serial execution order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10

Parallel groups (if subagent dispatch):
- Group A: Task 1 (must go first)
- Group B (after 1): Tasks 2, 3, 7 (disjoint files)
- Group C (after 2+3): Tasks 4, 5, 6, 8, 9 (must be serial due to overlapping files)
- Group D: Task 10 (final)
