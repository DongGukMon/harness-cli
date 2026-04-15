import { existsSync } from 'fs';
import { join } from 'path';
import { getGitRoot } from '../git.js';
import { acquireLock, readLock, releaseLock, setLockHandoff, pollForHandoffComplete } from '../lock.js';
import { getPreflightItems, runPreflight, resolveCodexPath } from '../preflight.js';
import { findHarnessRoot, getCurrentRun, setCurrentRun } from '../root.js';
import { readState, writeState } from '../state.js';
import { sessionExists, createSession, sendKeys, selectWindow, isInsideTmux, getCurrentSessionName, getActiveWindowId, createWindow, killSession, killWindow, paneExists, getDefaultPaneId, sendKeysToPane } from '../tmux.js';
import { openTerminalWindow } from '../terminal.js';
import { isPidAlive } from '../process.js';
import { HANDOFF_TIMEOUT_MS } from '../config.js';
import { printError } from '../ui.js';
import type { PhaseType } from '../types.js';

export interface ResumeOptions {
  root?: string;
}

function phaseType(phase: number): PhaseType {
  if (phase === 1 || phase === 3 || phase === 5) return 'interactive';
  if (phase === 2 || phase === 4 || phase === 7) return 'gate';
  if (phase === 6) return 'verify';
  return 'ui_only';
}

export async function resumeCommand(runId?: string, options: ResumeOptions = {}): Promise<void> {
  // 1. Find harness root
  const harnessDir = findHarnessRoot(options.root);
  const cwd = options.root ?? getGitRoot();

  // 2. Resolve runId (explicit arg or current-run pointer)
  let targetRunId: string;
  if (runId !== undefined) {
    targetRunId = runId;
  } else {
    const current = getCurrentRun(harnessDir);
    if (current === null) {
      process.stderr.write(
        "No active run. Use 'harness start' to start a new run or 'harness list' to see all runs.\n"
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
    state = readState(runDir);
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
      `Run '${targetRunId}' is already completed. Use 'harness jump N' to re-run a phase.\n`
    );
    process.exit(1);
  }

  // 6. Phase-scoped preflight (minimum for current phase)
  const currentPhaseType = phaseType(state.currentPhase);
  runPreflight(getPreflightItems(currentPhaseType), cwd);

  // 7. Verify codexPath still valid; re-discover if missing
  if (!existsSync(state.codexPath)) {
    const resolved = resolveCodexPath();
    if (resolved === null) {
      process.stderr.write(
        `Error: Codex companion not found. Install the openai-codex Claude plugin.\n`
      );
      process.exit(1);
    }
    state.codexPath = resolved;
    writeState(runDir, state);
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
  const innerCmd = `node ${harnessPath} __inner ${targetRunId}`;

  if (!insideTmux) {
    createSession(sessionName, cwd);
    const controlPaneId = getDefaultPaneId(sessionName);
    sendKeys(sessionName, '0', `${innerCmd} --control-pane ${controlPaneId}`);
  } else {
    const ctrlWindowId = createWindow(sessionName, 'harness-ctrl', '');
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
