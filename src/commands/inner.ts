import fs from 'fs';
import path, { join } from 'path';
import { getGitRoot } from '../git.js';
import { updateLockPid, readLock, releaseLock } from '../lock.js';
import { findHarnessRoot, clearCurrentRun } from '../root.js';
import { readState, writeState, invalidatePhaseSessionsOnPresetChange, invalidatePhaseSessionsOnJump } from '../state.js';
import { startFooterTicker } from './footer-ticker.js';
import { runPhaseLoop, handleVerifyError } from '../phases/runner.js';
import { registerSignalHandlers } from '../signal.js';
import { killSession, killWindow, selectWindow, splitPane, paneExists, selectPane } from '../tmux.js';
import { renderWelcome, promptModelConfig } from '../ui.js';
import { unmountInk } from '../ink/render.js';
import { InputManager } from '../input.js';
import { runRunnerAwarePreflight } from '../preflight.js';
import { REQUIRED_PHASE_KEYS, getEffectiveReopenTarget, getRequiredPhaseKeys } from '../config.js';
import { createSessionLogger } from '../logger.js';
import { HARNESS_VERSION } from '../version.js';
import { codexHomeFor } from '../runners/codex-isolation.js';
import type { SessionLogger, HarnessState } from '../types.js';
import { promptForTask } from '../task-prompt.js';

export interface InnerOptions {
  root?: string;
  controlPane?: string;
  resume?: boolean;
}

export async function innerCommand(runId: string, options: InnerOptions = {}): Promise<void> {
  const harnessDir = findHarnessRoot(options.root);
  let cwd: string;
  try { cwd = options.root ?? getGitRoot(); } catch { cwd = options.root ?? process.cwd(); }
  const runDir = join(harnessDir, runId);

  // 1. Load state
  const state = readState(runDir, cwd);
  if (state === null) {
    process.stderr.write(`Run '${runId}' has no state.\n`);
    process.exit(1);
  }

  // D4 live path: detect inconsistent state and synthesize failed phase immediately.
  let inconsistentPauseDetected = false;
  if (state.status === 'paused' && state.pendingAction === null) {
    synthesizeFailedFromInconsistentPause(state, runDir);
    inconsistentPauseDetected = true;
  }

  // 2. Claim lock ownership (outer → inner handoff)
  updateLockPid(harnessDir, process.pid);

  // Pane setup — idempotent pair validation (ADR-9)
  const controlPaneId = options.controlPane;
  if (!controlPaneId) {
    process.stderr.write('Fatal: --control-pane argument is required for __inner.\n');
    process.exit(1);
  }
  state.tmuxControlPane = controlPaneId;

  const controlValid = paneExists(state.tmuxSession, controlPaneId);
  const workspaceValid = !!state.tmuxWorkspacePane
    && paneExists(state.tmuxSession, state.tmuxWorkspacePane)
    && state.tmuxWorkspacePane !== controlPaneId;

  if (controlValid && workspaceValid) {
    // Both panes valid and distinct — reuse
  } else if (controlValid) {
    const workspacePaneId = splitPane(state.tmuxSession, controlPaneId, 'h', 60, cwd);
    state.tmuxWorkspacePane = workspacePaneId;
  } else {
    process.stderr.write(`Fatal: control pane ${controlPaneId} does not exist.\n`);
    process.exit(1);
  }
  writeState(runDir, state);

  // 3. Task prompt if empty (ADR-3, ADR-5, ADR-6)
  const taskMdPath = join(runDir, 'task.md');
  const existingTask = fs.existsSync(taskMdPath)
    ? fs.readFileSync(taskMdPath, 'utf-8').trim()
    : '';

  if (!existingTask && !inconsistentPauseDetected) {
    if (state.tmuxControlPane) {
      selectPane(state.tmuxSession, state.tmuxControlPane);
    }
    renderWelcome(state.runId);

    const cancelAndExit = (): never => {
      process.stderr.write('\nHarness cancelled.\n');
      fs.rmSync(runDir, { recursive: true, force: true });
      clearCurrentRun(harnessDir);
      releaseLock(harnessDir, runId);
      if (state.tmuxMode === 'dedicated') {
        killSession(state.tmuxSession);
      } else if (state.tmuxControlWindow) {
        killWindow(state.tmuxSession, state.tmuxControlWindow);
      }
      process.exit(0);
    };

    let capturedTask = '';
    while (!capturedTask) {
      const result = await promptForTask(state.runId);
      switch (result.kind) {
        case 'task':
          capturedTask = result.value;
          break;
        case 'empty':
          process.stderr.write('  Task cannot be empty. Please enter a task description:\n');
          break;
        case 'eof':
        case 'interrupt':
          cancelAndExit();
      }
    }

    state.task = capturedTask;
    fs.writeFileSync(taskMdPath, capturedTask);
    writeState(runDir, state);

    // Fresh start: discard any pending actions written during prompt
    // (ADR-7: skip/jump before task capture is meaningless)
    const pendingPath = join(runDir, 'pending-action.json');
    try { fs.unlinkSync(pendingPath); } catch { /* ignore */ }
  } else {
    if (inconsistentPauseDetected) {
      // D4a: delete stale file-based actions — the failed terminal UI must be unconditional.
      try { fs.unlinkSync(join(runDir, 'pending-action.json')); } catch { /* best-effort */ }
    } else {
      consumePendingAction(runDir, state);
    }
  }

  // 5. Register signal handlers (ADR-7: after task capture)
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

  // Step 5.5: Resume recovery (if --resume flag)
  // Note: resumeRun from src/resume.ts currently does recovery + runs phase loop.
  // For now, we skip calling resumeRun here (deferred refactor).
  // consumePendingAction already handles file-based actions.
  // typed state.pendingAction (reopen_phase, etc.) will be replayed inside the phase loop
  // via existing logic in runner.ts.

  // Step 5.6: Create logger (before InputManager so onConfigCancel can close over it)
  const isResume = options.resume === true;
  const logger = await bootstrapSessionLogger(runId, harnessDir, state, isResume, { cwd });
  const sidecarReplayAllowed = { value: isResume };
  let sessionEndStatus: 'completed' | 'paused' | 'interrupted' = 'interrupted';

  // Step 5.6: Create InputManager
  const inputManager = new InputManager();
  inputManager.onConfigCancel = buildConfigCancelHandler({ state, runDir, harnessDir, runId, isResume, logger, inputManager });
  inputManager.start('configuring');

  // Step 5.7: Compute remaining phases (including pendingAction reopen target).
  // Light flow skips 2/3/4 so the key set is narrowed at source (getRequiredPhaseKeys).
  const flowPhaseKeys = getRequiredPhaseKeys(state.flow);
  const remainingSet = new Set<string>();
  for (const p of flowPhaseKeys) {
    if (
      Number(p) >= state.currentPhase &&
      state.phases[p] !== 'completed' &&
      state.phases[p] !== 'skipped'
    ) {
      remainingSet.add(p);
    }
  }
  const reopenTarget = state.pendingAction
    ? getEffectiveReopenTarget(state.pendingAction)
    : null;
  if (reopenTarget !== null) remainingSet.add(String(reopenTarget));
  const remainingPhases = [...remainingSet];

  // Step 5.8 + 5.9: Skip model config and preflight on synthesized failure (D4a).
  if (!inconsistentPauseDetected) {
    // Step 5.8: Prompt for model selection. Snapshot prev presets to detect changes for §4.8 invalidation.
    const prevPresets = { ...state.phasePresets };
    state.phasePresets = await promptModelConfig(state.phasePresets, inputManager, remainingPhases, state.flow);
    invalidatePhaseSessionsOnPresetChange(state, prevPresets, runDir);

    // Clear reopen_config pendingAction (written by onConfigCancel) — model selection succeeded
    if (state.pendingAction?.type === 'reopen_config') {
      state.pendingAction = null;
      state.pauseReason = null;
      state.status = 'in_progress';
    }
    writeState(runDir, state);

    // Step 5.9: Runner-aware preflight
    try {
      runRunnerAwarePreflight(state.phasePresets, remainingPhases);
    } catch (err) {
      process.stderr.write(`Preflight failed: ${(err as Error).message}\n`);
      inputManager.onConfigCancel?.();
      return; // onConfigCancel calls process.exit(0)
    }
  }

  // Step 5.10: Enter phase loop mode
  inputManager.enterPhaseLoop();
  const stateJsonPath = path.join(runDir, 'state.json');
  const footerTimer = startFooterTicker({
    logger,
    stateJsonPath,
    intervalMs: 1000,
  });
  process.on('SIGWINCH', footerTimer.forceTick);

  // 6. Run phase loop, then route to terminal-state UI based on outcome
  try {
    // D4a: skip runPhaseLoop on synthesized failure — state already has phases[N]='failed',
    // so anyPhaseFailed fires and routes to enterFailedTerminalState.
    if (!inconsistentPauseDetected) {
      // Consume typed pendingAction that resume.ts's dispatcher would otherwise handle.
      // §5.5 note: inner.ts skips calling resumeRun, but show_verify_error written by
      // a prior Verify ERROR Quit must surface its R/Q UI here or the run silently
      // exits after model selection (state.status='paused' short-circuits below).
      if (state.pendingAction?.type === 'show_verify_error') {
        const action = state.pendingAction;
        state.status = 'in_progress';
        state.pauseReason = null;
        state.pendingAction = null;
        writeState(runDir, state);
        const errorPath = action.feedbackPaths[0] ?? undefined;
        await handleVerifyError(errorPath, state, harnessDir, runDir, cwd, inputManager, logger);
      }

      // If the pendingAction dispatcher re-paused (user picked Q), skip the loop
      // so the post-loop classifier emits session_end cleanly.
      if ((state.status as HarnessState['status']) !== 'paused') {
        await runPhaseLoop(state, harnessDir, runDir, cwd, inputManager, logger, sidecarReplayAllowed);
      }
    }

    const { enterCompleteTerminalState, enterFailedTerminalState, anyPhaseFailed } =
      await import('../phases/terminal-ui.js');

    const enterIdle = async (): Promise<void> => {
      const ac = new AbortController();
      const onSigint = (): void => ac.abort();
      process.once('SIGINT', onSigint);
      try {
        await enterCompleteTerminalState(state, runDir, cwd, logger, ac.signal);
      } finally {
        process.removeListener('SIGINT', onSigint);
      }
    };

    if (state.status === 'completed') {
      sessionEndStatus = 'completed';
      await enterIdle();
    } else if (state.status === 'paused') {
      sessionEndStatus = 'paused';
    } else if (anyPhaseFailed(state)) {
      await enterFailedTerminalState(state, harnessDir, runDir, cwd, inputManager, logger);
      // After R/J flow returns: classify, and surface idle panel if it ended in completion.
      // The else-if chain narrowed state.status to 'in_progress'; the call above can mutate it,
      // so widen via indirect access before classifying.
      const postStatus = (state as HarnessState).status;
      if (postStatus === 'completed') {
        sessionEndStatus = 'completed';
        await enterIdle();
      } else if (postStatus === 'paused') {
        sessionEndStatus = 'paused';
      } else {
        sessionEndStatus = 'interrupted';
      }
    } else {
      sessionEndStatus = 'interrupted';
    }
  } finally {
    footerTimer.stop();
    process.removeListener('SIGWINCH', footerTimer.forceTick);
    logger.logEvent({ event: 'session_end', status: sessionEndStatus, totalWallMs: Date.now() - logger.getStartedAt() });
    logger.finalizeSummary(state);
    logger.close();
    unmountInk();
    inputManager.stop();
    releaseLock(harnessDir, runId);
  }

  // 7. Cleanup tmux on completion
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

export interface ConfigCancelHandlerArgs {
  state: HarnessState;
  runDir: string;
  harnessDir: string;
  runId: string;
  isResume: boolean;
  logger: SessionLogger;
  inputManager: InputManager;
}

export function buildConfigCancelHandler(args: ConfigCancelHandlerArgs): () => void {
  const { state, runDir, harnessDir, runId, isResume, logger, inputManager } = args;
  return () => {
    state.status = 'paused';
    state.pauseReason = 'config-cancel';
    state.pendingAction = {
      type: 'reopen_config',
      targetPhase: state.currentPhase as any,
      sourcePhase: null,
      feedbackPaths: [],
    };
    writeState(runDir, state);

    const codexHome = state.codexNoIsolate ? undefined : codexHomeFor(runDir);

    // Lazy bootstrap session open event if not yet emitted
    if (!logger.hasEmittedSessionOpen()) {
      if (isResume) {
        logger.updateMeta({ pushResumedAt: Date.now(), task: state.task, codexHome });
        logger.logEvent({ event: 'session_resumed', fromPhase: state.currentPhase, stateStatus: 'paused' });
      } else {
        logger.writeMeta({ task: state.task, codexHome });
        logger.logEvent({ event: 'session_start', task: state.task, autoMode: state.autoMode, baseCommit: state.baseCommit, harnessVersion: HARNESS_VERSION });
      }
    }
    logger.logEvent({ event: 'session_end', status: 'paused', totalWallMs: Date.now() - logger.getStartedAt() });
    logger.finalizeSummary(state);
    logger.close();

    releaseLock(harnessDir, runId);
    unmountInk();
    inputManager.stop();
    process.exit(0);
  };
}

export async function bootstrapSessionLogger(
  runId: string,
  harnessDir: string,
  state: HarnessState,
  isResume: boolean,
  options: { sessionsRoot?: string; cwd?: string } = {},
): Promise<SessionLogger> {
  const logger = createSessionLogger(runId, harnessDir, state.loggingEnabled, {
    cwd: options.cwd ?? process.cwd(),
    autoMode: state.autoMode,
    baseCommit: state.baseCommit,
    sessionsRoot: options.sessionsRoot,
  });
  const runDir = join(harnessDir, runId);
  const codexHome = state.codexNoIsolate ? undefined : codexHomeFor(runDir);
  if (isResume) {
    logger.updateMeta({ pushResumedAt: Date.now(), task: state.task, codexHome });
    logger.logEvent({ event: 'session_resumed', fromPhase: state.currentPhase, stateStatus: state.status });
  } else if (logger.hasBootstrapped()) {
    // Idempotent case: meta.json already exists on disk (e.g., crash re-entry)
    logger.updateMeta({ pushResumedAt: Date.now(), codexHome });
    logger.logEvent({ event: 'session_resumed', fromPhase: state.currentPhase, stateStatus: state.status });
  } else {
    logger.writeMeta({ task: state.task, codexHome });
    logger.logEvent({ event: 'session_start', task: state.task, autoMode: state.autoMode, baseCommit: state.baseCommit, harnessVersion: HARNESS_VERSION });
  }
  return logger;
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
      // Reset phases >= target and set currentPhase. Preserve 'skipped'
      // (light flow only) so P2/P3/P4 do not resurrect as 'pending'.
      for (let m = action.phase; m <= 7; m++) {
        const cur = state.phases[String(m)];
        state.phases[String(m)] = cur === 'skipped' ? 'skipped' : 'pending';
      }
      state.currentPhase = action.phase;
      state.pendingAction = null;
      state.pauseReason = null;
      // §4.9: invalidate gate sessions at/after target phase + delete replay sidecars
      invalidatePhaseSessionsOnJump(state, action.phase, runDir);
    }

    writeState(runDir, state);
    fs.unlinkSync(pendingPath);
  } catch {
    // Best-effort: corrupted pending action is skipped
    try { fs.unlinkSync(pendingPath); } catch { /* ignore */ }
  }
}

function synthesizeFailedFromInconsistentPause(state: HarnessState, runDir: string): void {
  process.stderr.write(
    `⚠️  Run ${state.runId} detected inconsistent pause state (paused + pendingAction=null); ` +
    `synthesizing failed phase ${state.currentPhase} and routing to failed terminal UI.\n`
  );
  state.phases[String(state.currentPhase)] = 'failed';
  state.status = 'in_progress';
  state.pauseReason = null;
  writeState(runDir, state);
}
