import { existsSync } from 'fs';
import { join } from 'path';
import { getGitRoot } from '../git.js';
import { acquireLock, readLock, releaseLock, setLockHandoff, pollForHandoffComplete } from '../lock.js';
import { resolveCodexPath } from '../preflight.js';
import { findHarnessRoot, getCurrentRun, setCurrentRun } from '../root.js';
import { readState, writeState } from '../state.js';
import { sessionExists, createSession, sendKeys, selectWindow, isInsideTmux, getCurrentSessionName, getActiveWindowId, createWindow, killSession, killWindow, paneExists, getDefaultPaneId, sendKeysToPane } from '../tmux.js';
import { openTerminalWindow } from '../terminal.js';
import { isPidAlive } from '../process.js';
import { HANDOFF_TIMEOUT_MS } from '../config.js';
import { printError } from '../ui.js';

export interface ResumeOptions {
  root?: string;
  light?: boolean;
}

export async function resumeCommand(runId?: string, options: ResumeOptions = {}): Promise<void> {
  if (options.light) {
    process.stderr.write(
      "Error: --light is only valid on 'phase-harness start'. flow is frozen at run creation; " +
      "start a new run with 'phase-harness start --light' if you want the light flow.\n",
    );
    process.exit(1);
  }

  // 1. Find harness root
  const harnessDir = findHarnessRoot(options.root);
  let cwd: string;
  try { cwd = options.root ?? getGitRoot(); } catch { cwd = options.root ?? process.cwd(); }

  // 2. Resolve runId (explicit arg or current-run pointer)
  let targetRunId: string;
  if (runId !== undefined) {
    targetRunId = runId;
  } else {
    const current = getCurrentRun(harnessDir);
    if (current === null) {
      process.stderr.write(
        "No active run. Use 'phase-harness start' to start a new run or 'phase-harness list' to see all runs.\n"
      );
      process.exit(1);
    }
    targetRunId = current as string;
  }

  // 3. Validate run directory exists
  const runDir = join(harnessDir, targetRunId);
  if (!existsSync(runDir)) {
    process.stderr.write(`Run '${targetRunId}' not found.\n`);
    process.exit(1);
  }

  // 4. Read state.json
  const stateJsonPath = join(runDir, 'state.json');
  if (!existsSync(stateJsonPath) && !existsSync(stateJsonPath + '.tmp')) {
    process.stderr.write(`Run '${targetRunId}' has no state. Manual recovery required.\n`);
    process.exit(1);
  }

  let state;
  try {
    state = readState(runDir, cwd);
  } catch (err) {
    process.stderr.write(
      `state.json for run '${targetRunId}' is corrupted: ${(err as Error).message}\n`
    );
    process.exit(1);
  }

  if (state === null) {
    process.stderr.write(`Run '${targetRunId}' has no state. Manual recovery required.\n`);
    process.exit(1);
  }

  // 5. Completed run: update current-run pointer then error
  if (state.status === 'completed') {
    setCurrentRun(harnessDir, targetRunId);
    process.stderr.write(
      `Run '${targetRunId}' is already completed. Use 'phase-harness jump N' to re-run a phase.\n`
    );
    process.exit(1);
  }

  // 6. (Runner-aware preflight deferred to inner.ts after model selection)

  // 7. Legacy codexPath compatibility (only for old runs with string codexPath)
  if (state.codexPath !== null && !existsSync(state.codexPath)) {
    const resolved = resolveCodexPath();
    if (resolved !== null) {
      state.codexPath = resolved;
      writeState(runDir, state);
    }
    // If null: Codex runner uses standalone CLI — preflight will verify in inner
  }

  // 8. Update current-run pointer (now that we're committed)
  setCurrentRun(harnessDir, targetRunId);

  // 9. Check tmux session and inner process state
  const tmuxAlive = state.tmuxSession !== '' && sessionExists(state.tmuxSession);
  const lock = readLock(harnessDir);
  const innerAlive = lock !== null && lock.handoff === false && isPidAlive(lock.cliPid);

  if (tmuxAlive && innerAlive) {
    // Case 1: Session + inner both alive → re-attach only
    const opened = openTerminalWindow(state.tmuxSession);
    if (!opened) {
      process.stderr.write(`Attach manually: tmux attach -t ${state.tmuxSession}\n`);
    }
    return;
  }

  if (tmuxAlive && !innerAlive) {
    // Case 2: Session alive, inner dead → pane-aware restart
    setCurrentRun(harnessDir, targetRunId);
    acquireLock(harnessDir, targetRunId);
    setLockHandoff(harnessDir, process.pid, state.tmuxSession);

    const harnessPath = process.argv[1];

    if (state.tmuxControlPane && paneExists(state.tmuxSession, state.tmuxControlPane)) {
      // Control pane valid → restart inner here
      const innerCmd = `node ${harnessPath} __inner ${targetRunId} --resume --control-pane ${state.tmuxControlPane}`;
      sendKeysToPane(state.tmuxSession, state.tmuxControlPane, innerCmd);
    } else {
      // Control pane stale → cleanup by mode, then fall through to Case 3
      if (state.tmuxMode === 'dedicated') {
        killSession(state.tmuxSession);
      } else if (state.tmuxControlWindow) {
        killWindow(state.tmuxSession, state.tmuxControlWindow);
      }
      // Clear all tmux references before recursion so Case 3 re-derives
      // session + mode from isInsideTmux(). Without clearing tmuxSession the
      // reused-mode recursive call re-enters Case 2 (tmuxAlive still true)
      // and loops forever.
      state.tmuxControlPane = '';
      state.tmuxControlWindow = '';
      state.tmuxWindows = [];
      state.tmuxSession = '';
      state.tmuxMode = 'dedicated';
      writeState(runDir, state);
      releaseLock(harnessDir, targetRunId);
      // Re-enter resume which will hit Case 3
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

  // Case 3: No session → create new tmux session + start inner
  const insideTmux = isInsideTmux();
  const sessionName = insideTmux
    ? getCurrentSessionName()!
    : `harness-${targetRunId}`;

  state.tmuxSession = sessionName;
  state.tmuxMode = insideTmux ? 'reused' : 'dedicated';

  if (insideTmux) {
    state.tmuxOriginalWindow = getActiveWindowId(sessionName) ?? undefined;
  }

  writeState(runDir, state);

  acquireLock(harnessDir, targetRunId);
  setLockHandoff(harnessDir, process.pid, sessionName);

  const harnessPath = process.argv[1];
  const innerCmd = `node ${harnessPath} __inner ${targetRunId} --resume`;

  if (!insideTmux) {
    createSession(sessionName, cwd);
    const controlPaneId = getDefaultPaneId(sessionName);
    sendKeys(sessionName, '0', `${innerCmd} --control-pane ${controlPaneId}`);
  } else {
    const ctrlWindowId = createWindow(sessionName, 'harness-ctrl', '', cwd);
    const controlPaneId = getDefaultPaneId(sessionName, ctrlWindowId);
    sendKeys(sessionName, ctrlWindowId, `${innerCmd} --control-pane ${controlPaneId}`);
    state.tmuxControlWindow = ctrlWindowId;
    state.tmuxWindows.push(ctrlWindowId);
    writeState(runDir, state);
    selectWindow(sessionName, ctrlWindowId);
  }

  const handoffOk = pollForHandoffComplete(harnessDir, HANDOFF_TIMEOUT_MS);
  if (!handoffOk) {
    printError('Inner process failed to start within 5 seconds.');
    if (!insideTmux) {
      killSession(sessionName);
    }
    releaseLock(harnessDir, targetRunId);
    process.exit(1);
  }

  if (!insideTmux) {
    openTerminalWindow(sessionName);
  }
}
