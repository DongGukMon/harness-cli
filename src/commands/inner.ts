import fs from 'fs';
import path, { join } from 'path';
import { getGitRoot } from '../git.js';
import { updateLockPid, readLock, releaseLock } from '../lock.js';
import { findHarnessRoot, clearCurrentRun } from '../root.js';
import { readState, writeState, invalidatePhaseSessionsOnPresetChange, invalidatePhaseSessionsOnJump } from '../state.js';
import { startFooterTicker } from './footer-ticker.js';
import { runPhaseLoop, handleVerifyError, handleGateEscalation, handleVerifyEscalation } from '../phases/runner.js';
import { registerSignalHandlers } from '../signal.js';
import { killSession, killSessionDetached, killWindow, killWindowDetached, selectWindow, splitPane, paneExists, selectPane } from '../tmux.js';
import { renderWelcome, promptModelConfig } from '../ui.js';
import { unmountInk } from '../ink/render.js';
import { InputManager } from '../input.js';
import { runRunnerAwarePreflight } from '../preflight.js';
import { REQUIRED_PHASE_KEYS, getEffectiveReopenTarget, getRequiredPhaseKeys, getGateRetryLimit } from '../config.js';
import { createSessionLogger } from '../logger.js';
import { HARNESS_VERSION } from '../version.js';
import { codexHomeFor } from '../runners/codex-isolation.js';
import { tryInlineCompleteFreshSentinel } from '../resume.js';
import type { SessionLogger, HarnessState } from '../types.js';
import { promptForTask } from '../task-prompt.js';

export async function emitRetroHook(
  logger: Pick<SessionLogger, 'getEventsPath'>,
  harnessDir: string,
  runId: string,
  state?: HarnessState,
): Promise<void> {
  const eventsPath = logger.getEventsPath();
  if (!eventsPath) return;
  try {
    const { generateRetrospective } = await import('../phases/retrospective.js');
    const { markdown } = generateRetrospective(eventsPath, state);
    const outDir  = join(harnessDir, runId);
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, 'retrospective.md');
    const tmp     = outPath + '.tmp';
    fs.writeFileSync(tmp, markdown);
    fs.renameSync(tmp, outPath);
  } catch (err) {
    process.stderr.write(`[retro] failed to generate retrospective: ${(err as Error).message}\n`);
  }
}

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
    const workspacePaneId = splitPane(state.tmuxSession, controlPaneId, 'v', 70, cwd);
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

  // Step 5.5: Pre-loop inline-completion recovery for fresh-sentinel resumes
  // (issue #117 Bug B follow-up).
  //
  // The full `resumeRun` codepath is still deliberately skipped here (the
  // remaining validateCompletedArtifacts / validateAncestry / runPhaseLoop
  // pieces live in resume.ts; pulling them in is a separate refactor). What we
  // DO call is the sliver that re-uses PR #120's diagnostic + sentinel
  // hygiene policy verbatim: when the current phase is 1/3/5 in 'in_progress'
  // or 'failed' AND a sentinel file matches `state.phaseAttemptId[phase]`,
  // attempt inline completion before computing `remainingPhases` and before
  // promptModelConfig. Without this, the originally reported scenario
  // (P5 failed + fresh sentinel + advanced HEAD) loops back to the
  // [R][J][Q] failed UI on every `phase-harness resume` invocation through
  // the tmux path with no log signal — `recoverGeneralState` never fires
  // here, only inside `resumeRun`.
  //
  // The helper either advances `state.currentPhase` (silent or with the
  // PR #120 success stderr line), or emits one of the PR #120 rejection
  // lines, or is a silent no-op when there's no sentinel to recover.
  //
  // typed state.pendingAction (reopen_phase, show_verify_error, etc.) is still
  // handled below by the existing inline dispatchers and runner.ts logic;
  // consumePendingAction handles file-based actions earlier.
  tryInlineCompleteFreshSentinel(state, cwd, runDir);

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
  // Issue #110: also skip when resuming into a show_escalation pendingAction.
  // The prior session already chose presets, so the prompt is unnecessary — and
  // while it is waiting for a keystroke the launching pane's SIGHUP propagates
  // to `__inner`, fires `onConfigCancel`, and exits the process before any key
  // can be read. The inline dispatcher below routes show_escalation to the C/S/Q
  // UI directly (mirroring the show_verify_error precedent at the next block).
  const skipModelConfigForEscalation = state.pendingAction?.type === 'show_escalation';
  if (!inconsistentPauseDetected && !skipModelConfigForEscalation) {
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

      // Issue #110: surface the gate/verify escalation C/S/Q UI on resume.
      // Without this, after the model-config skip above, line 263's `state.status === 'paused'`
      // short-circuit fires and the run silently exits — the user is stuck in paused state and
      // the only recovery is manual state.json editing. Mirrors replayPendingAction's
      // case 'show_escalation' in resume.ts (routes by pauseReason).
      if (state.pendingAction?.type === 'show_escalation') {
        const action = state.pendingAction;
        const wasVerifyEscalation = state.pauseReason === 'verify-escalation';
        state.status = 'in_progress';
        state.pauseReason = null;
        state.pendingAction = null;
        writeState(runDir, state);

        // Load feedback content for gate handler (strip the standard
        // '## Reviewer Comments\n\n' marker if present so the C/S/Q prompt
        // shows just the body, matching the original handler's input shape).
        let comments = '';
        if (action.feedbackPaths.length > 0) {
          try {
            const raw = fs.readFileSync(action.feedbackPaths[0], 'utf-8');
            const marker = '## Reviewer Comments\n\n';
            const idx = raw.indexOf(marker);
            comments = idx >= 0 ? raw.slice(idx + marker.length).trimEnd() : raw;
          } catch { /* best-effort */ }
        }

        if (wasVerifyEscalation) {
          const feedbackPath = action.feedbackPaths[0] ?? path.join(runDir, 'verify-feedback.md');
          await handleVerifyEscalation(feedbackPath, state, runDir, cwd, inputManager, logger);
        } else {
          // Gate escalation: targetPhase is the rejected gate (2/4/7)
          const gatePhase = action.targetPhase as 2 | 4 | 7;
          const retryIndex = Math.max(
            0,
            (state.gateRetries[String(gatePhase)] ?? getGateRetryLimit(state.flow, gatePhase)) - 1,
          );
          await handleGateEscalation(
            gatePhase,
            comments,
            action.scope,
            retryIndex,
            state,
            runDir,
            cwd,
            inputManager,
            logger,
          );
        }
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

    // Decide sessionEndStatus first WITHOUT blocking on the idle wait. The
    // failed-terminal R/J/Q flow can mutate state.status, so it must run before
    // we read the final status. The completed-idle wait, however, MUST run
    // AFTER we flush session_end / retro to disk (see flush block below).
    if (state.status === 'completed') {
      sessionEndStatus = 'completed';
    } else if (state.status === 'paused') {
      sessionEndStatus = 'paused';
    } else if (anyPhaseFailed(state)) {
      await enterFailedTerminalState(state, harnessDir, runDir, cwd, inputManager, logger);
      // After R/J flow returns: classify. The else-if chain narrowed state.status
      // to 'in_progress'; enterFailedTerminalState can mutate it, so widen via
      // indirect access before classifying.
      const postStatus = (state as HarnessState).status;
      if (postStatus === 'completed') sessionEndStatus = 'completed';
      else if (postStatus === 'paused') sessionEndStatus = 'paused';
      else sessionEndStatus = 'interrupted';
    } else {
      sessionEndStatus = 'interrupted';
    }

    // Flush session_end / summary / retro BEFORE the completed-idle wait.
    // Previously these lived in the outer finally, but when state.status was
    // 'completed' the harness blocked in `await enterIdle()` and the user's
    // Ctrl+C arrived through Node's SIGINT default path before the async
    // finally got a chance to flush — session_end and retrospective.md never
    // reached disk (issue #98 follow-up observed during PR #102 dogfood).
    logger.logEvent({ event: 'session_end', status: sessionEndStatus, totalWallMs: Date.now() - logger.getStartedAt() });
    logger.finalizeSummary(state);
    await emitRetroHook(logger, harnessDir, runId, state);

    if (sessionEndStatus === 'completed' && (state as HarnessState).status === 'completed') {
      await enterIdle();
    }
  } finally {
    footerTimer.stop();
    process.removeListener('SIGWINCH', footerTimer.forceTick);
    logger.close();
    unmountInk();
    inputManager.stop();
    releaseLock(harnessDir, runId);

    // Restore the pre-run pane layout: kill the harness-owned tmux window(s)
    // (reused) or the whole dedicated session, then refocus the original
    // window the user was on. This used to live AFTER the finally block,
    // which meant it never ran when `await enterIdle()` returned via SIGINT
    // — the harness left dangling `harness-ctrl` windows after every
    // completed run (observed during PR #102 dogfood). Moving it into the
    // finally guarantees execution on all exit paths.
    //
    // Self-kill race: in `reused` mode the inner Node process is itself
    // running inside the window we're about to kill, so the synchronous
    // `tmux kill-window` races our incoming SIGHUP — Node sometimes dies
    // before tmux's kill side-effect propagates, leaving the window alive.
    // `killWindowDetached` / `killSessionDetached` fire the tmux command
    // as a detached child so it lives past this process's exit.
    if (state.tmuxMode === 'dedicated') {
      process.stderr.write(`[harness] cleanup: killing dedicated session ${state.tmuxSession}\n`);
      killSessionDetached(state.tmuxSession);
    } else if (state.tmuxWindows.length > 0) {
      process.stderr.write(`[harness] cleanup: killing ${state.tmuxWindows.length} harness window(s) in session ${state.tmuxSession}\n`);
      // Refocus the original window FIRST while it's still selectable —
      // doing so after kill-window can race with the destruction.
      if (state.tmuxOriginalWindow) {
        selectWindow(state.tmuxSession, state.tmuxOriginalWindow);
      }
      for (const windowId of state.tmuxWindows) {
        killWindowDetached(state.tmuxSession, windowId);
      }
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
  return async () => {
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
    await emitRetroHook(logger, harnessDir, runId, state);
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
