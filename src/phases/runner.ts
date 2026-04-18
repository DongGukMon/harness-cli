import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { HarnessState, PendingAction, PhaseNumber, InteractivePhase, GatePhase, SessionLogger } from '../types.js';
import type { InputManager } from '../input.js';
import {
  GATE_RETRY_LIMIT,
  GATE_TIMEOUT_MS,
  VERIFY_RETRY_LIMIT,
  TERMINAL_PHASE,
  getPhaseArtifactFiles,
  getPresetById,
} from '../config.js';
import { writeState } from '../state.js';
import { getHead } from '../git.js';
import { normalizeArtifactCommit } from '../artifact.js';
import { runInteractivePhase } from './interactive.js';
import { runGatePhase } from './gate.js';
import { runVerifyPhase } from './verify.js';
import { readClaudeSessionUsage } from '../runners/claude-usage.js';
import {
  promptChoice,
  printPhaseTransition,
  renderControlPanel,
  printWarning,
  printError,
  printSuccess,
  printInfo,
} from '../ui.js';

// ─── Phase type dispatch helpers ──────────────────────────────────────────────

/**
 * Resolve the preset assigned to a phase into a log-event payload shape.
 * Returns undefined when no preset is configured (e.g. verify phase 6) — callers
 * should omit the `preset` field rather than emit a partial object.
 */
function getPhasePresetMeta(state: HarnessState, phase: number):
  | { id: string; runner: 'claude' | 'codex'; model: string; effort: string }
  | undefined {
  const id = state.phasePresets?.[String(phase)];
  if (!id) return undefined;
  const p = getPresetById(id);
  if (!p) return undefined;
  return { id: p.id, runner: p.runner, model: p.model, effort: p.effort };
}

function isInteractivePhase(phase: number): phase is InteractivePhase {
  return phase === 1 || phase === 3 || phase === 5;
}

function isGatePhase(phase: number): phase is GatePhase {
  return phase === 2 || phase === 4 || phase === 7;
}

function isVerifyPhase(phase: number): boolean {
  return phase === 6;
}

// ─── Phase label helpers ──────────────────────────────────────────────────────

function phaseLabel(phase: number): string {
  const labels: Record<number, string> = {
    1: 'Spec 작성',
    2: 'Spec Gate',
    3: 'Plan 작성',
    4: 'Plan Gate',
    5: '구현',
    6: '검증',
    7: 'Eval Gate',
  };
  return labels[phase] ?? `Phase ${phase}`;
}

// ─── Gate reject → previous interactive phase mapping ─────────────────────────

function previousInteractivePhase(gatePhase: GatePhase): InteractivePhase {
  if (gatePhase === 2) return 1;
  if (gatePhase === 4) return 3;
  return 5; // gate 7 → phase 5
}

function nextPhase(phase: number): number {
  return phase + 1;
}

// ─── Sidecar cleanup helpers ──────────────────────────────────────────────────

function deleteGateSidecars(runDir: string, phase: number): void {
  const files = [
    path.join(runDir, `gate-${phase}-raw.txt`),
    path.join(runDir, `gate-${phase}-result.json`),
  ];
  for (const f of files) {
    try { fs.unlinkSync(f); } catch { /* best-effort */ }
  }
}

function deleteVerifyResult(runDir: string): void {
  try {
    fs.unlinkSync(path.join(runDir, 'verify-result.json'));
  } catch { /* best-effort */ }
}

// ─── Save gate feedback ───────────────────────────────────────────────────────

function saveGateFeedback(runDir: string, phase: number, comments: string): string {
  const feedbackPath = path.join(runDir, `gate-${phase}-feedback.md`);
  const content =
    `# Gate ${phase} Feedback\n\n` +
    `## Reviewer Comments\n\n${comments}\n`;
  fs.writeFileSync(feedbackPath, content);
  return feedbackPath;
}

// ─── Normalize artifacts for Phase 1/3 ───────────────────────────────────────

/**
 * Normalize (auto-commit) Phase 1/3 artifacts.
 * Skips artifacts in `.harness/` (gitignored — no commit needed).
 * Throws on first commit failure so callers can mark the phase as `error`.
 */
function normalizeInteractiveArtifacts(
  phase: InteractivePhase,
  state: HarnessState,
  cwd: string
): void {
  const artifactKeys = getPhaseArtifactFiles(state.flow, phase);
  if (artifactKeys.length === 0) return;

  for (const key of artifactKeys) {
    const relPath = state.artifacts[key];
    if (!relPath) continue;
    // Skip gitignored artifacts (decisions.md, checklist.json are in .harness/)
    if (relPath.startsWith('.harness/')) continue;

    const message = `harness[${state.runId}]: Phase ${phase} — ${String(key)}`;
    normalizeArtifactCommit(relPath, message, cwd);
  }
}

// ─── Write synthetic eval report for skip ─────────────────────────────────────

function writeSyntheticEvalReport(
  evalReportPath: string,
  runId: string,
  cwd: string
): void {
  const absPath = path.isAbsolute(evalReportPath)
    ? evalReportPath
    : path.join(cwd, evalReportPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const content =
    `# Eval Report (Skipped)\n\n` +
    `runId: ${runId}\n\n` +
    `## Summary\n\n` +
    `Verification skipped by user (escalation override).\n`;
  fs.writeFileSync(absPath, content);
}

// ─── pausedAtHead helper ──────────────────────────────────────────────────────

function savePausedAtHead(state: HarnessState, cwd: string): void {
  try {
    state.pausedAtHead = getHead(cwd);
  } catch {
    // git not available — leave as null
  }
}

// ─── Main phase loop ───────────────────────────────────────────────────────────

/**
 * Run the phase loop starting from the current state. Advances through phases
 * until completion, pause, or error.
 */
export async function runPhaseLoop(
  state: HarnessState,
  harnessDir: string,
  runDir: string,
  cwd: string,
  inputManager: InputManager,
  logger: SessionLogger,
  sidecarReplayAllowed: { value: boolean },
): Promise<void> {
  while (state.currentPhase < TERMINAL_PHASE) {
    const phase = state.currentPhase;
    renderControlPanel(state);

    if (isInteractivePhase(phase)) {
      await handleInteractivePhase(phase, state, harnessDir, runDir, cwd, logger);
      // If state changed to paused or phase failed, check if we should stop
      if (state.status === 'paused') return;
      if (state.phases[String(phase)] === 'failed') return;
    } else if (isGatePhase(phase)) {
      await handleGatePhase(phase as GatePhase, state, harnessDir, runDir, cwd, inputManager, logger, sidecarReplayAllowed);
      if (state.status === 'paused') return;
      if (state.currentPhase === TERMINAL_PHASE) {
        // Completed
        savePausedAtHead(state, cwd);
        writeState(runDir, state);
        return;
      }
    } else if (isVerifyPhase(phase)) {
      await handleVerifyPhase(state, harnessDir, runDir, cwd, inputManager, logger);
      if (state.status === 'paused') return;
    }

    logger.finalizeSummary(state);
  }

  // currentPhase === TERMINAL_PHASE
  savePausedAtHead(state, cwd);
  writeState(runDir, state);
}

// ─── Interactive phase handler ─────────────────────────────────────────────────

export async function handleInteractivePhase(
  phase: InteractivePhase,
  state: HarnessState,
  harnessDir: string,
  runDir: string,
  cwd: string,
  logger: SessionLogger,
): Promise<void> {
  state.phases[String(phase)] = 'in_progress';
  writeState(runDir, state);

  const attemptId = randomUUID();
  const phaseStartTs = Date.now();

  const isReopen = state.phaseReopenFlags[String(phase)] ?? false;
  const reopenFromGate = isReopen ? (state.phaseReopenSource[String(phase)] ?? undefined) : undefined;
  const preset = getPhasePresetMeta(state, phase);

  // Token capture helper: runner=claude → read ~/.claude/projects/<cwd>/<attemptId>.jsonl;
  // runner=codex → return undefined so the field is omitted from phase_end entirely (§2.5).
  const collectClaudeTokens = () =>
    preset?.runner === 'claude'
      ? readClaudeSessionUsage({ sessionId: attemptId, cwd, phaseStartTs })
      : undefined;

  logger.logEvent({ event: 'phase_start', phase, attemptId, reopenFromGate, preset });

  // Clear the logging-only reopen source (keep phaseReopenFlags for runInteractivePhase)
  if (state.phaseReopenSource[String(phase)] !== null) {
    state.phaseReopenSource[String(phase)] = null;
    writeState(runDir, state);
  }

  try {
    const result = await runInteractivePhase(phase, state, harnessDir, runDir, cwd, attemptId);

    // Check for control-signal redirect BEFORE branching on result.status.
    // SIGUSR1 skip/jump can mutate state.currentPhase mid-run regardless of
    // whether runInteractivePhase itself returns completed or failed.
    if (state.currentPhase !== phase) {
      printInfo(`Phase ${phase} interrupted by control signal → phase ${state.currentPhase}`);
      renderControlPanel(state);
      logger.logEvent({
        event: 'phase_end',
        phase,
        attemptId,
        status: 'failed',
        durationMs: Date.now() - phaseStartTs,
        details: { reason: 'redirected' },
      });
      return;
    }

    if (result.status === 'completed') {
      // Normalize artifact commits for Phase 1/3. Failure → error (not completed).
      if (phase === 1 || phase === 3) {
        try {
          normalizeInteractiveArtifacts(phase, state, cwd);
        } catch (err) {
          printError(`Phase ${phase} artifact commit failed: ${(err as Error).message}`);
          state.phases[String(phase)] = 'error';
          savePausedAtHead(state, cwd);
          writeState(runDir, state);
          const tokens = collectClaudeTokens();
          logger.logEvent({
            event: 'phase_end',
            phase,
            attemptId,
            status: 'failed',
            durationMs: Date.now() - phaseStartTs,
            ...(tokens !== undefined ? { claudeTokens: tokens } : {}),
          });
          return;
        }
      }

      // Update commit anchors (only AFTER commit succeeds)
      try {
        const head = getHead(cwd);
        if (phase === 1) state.specCommit = head;
        if (phase === 3) state.planCommit = head;
        if (phase === 5) state.implCommit = head;
      } catch {
        // getHead unavailable — leave anchor as-is
      }

      // Clear pendingAction now that phase succeeded
      state.pendingAction = null;
      state.phases[String(phase)] = 'completed';

      // Advance to next phase
      const next = nextPhase(phase);
      state.currentPhase = next;

      renderControlPanel(state);
      writeState(runDir, state);

      const completedTokens = collectClaudeTokens();
      logger.logEvent({
        event: 'phase_end',
        phase,
        attemptId,
        status: 'completed',
        durationMs: Date.now() - phaseStartTs,
        ...(completedTokens !== undefined ? { claudeTokens: completedTokens } : {}),
      });

      // Anomaly: phase 5 completed but reopen flag still set
      if (phase === 5 && state.phaseReopenFlags['5'] === true) {
        logger.logEvent({
          event: 'state_anomaly',
          kind: 'phase_reopen_flag_stuck',
          details: { phase: 5 },
        });
      }
    } else {
      // Normal failure (redirect case already handled above)
      state.phases[String(phase)] = 'failed';
      savePausedAtHead(state, cwd);
      printError(`Phase ${phase} failed`);
      writeState(runDir, state);
      const failedTokens = collectClaudeTokens();
      logger.logEvent({
        event: 'phase_end',
        phase,
        attemptId,
        status: 'failed',
        durationMs: Date.now() - phaseStartTs,
        ...(failedTokens !== undefined ? { claudeTokens: failedTokens } : {}),
      });
    }
  } catch (err) {
    const thrownTokens = collectClaudeTokens();
    logger.logEvent({
      event: 'phase_end',
      phase,
      attemptId,
      status: 'failed',
      durationMs: Date.now() - phaseStartTs,
      ...(thrownTokens !== undefined ? { claudeTokens: thrownTokens } : {}),
    });
    throw err;
  }
}

// ─── Gate phase handler ────────────────────────────────────────────────────────

export async function handleGatePhase(
  phase: GatePhase,
  state: HarnessState,
  harnessDir: string,
  runDir: string,
  cwd: string,
  inputManager: InputManager,
  logger: SessionLogger,
  sidecarReplayAllowed: { value: boolean },
): Promise<void> {
  state.phases[String(phase)] = 'in_progress';
  writeState(runDir, state);

  // Capture retryIndex BEFORE any mutation (spec §5.3)
  const retryIndex = state.gateRetries[String(phase)] ?? 0;
  const gatePresetMeta = getPhasePresetMeta(state, phase);

  printInfo(`Codex 리뷰 진행 중... (최대 ${Math.round(GATE_TIMEOUT_MS / 1000)}초 소요)`);
  const result = await runGatePhase(phase, state, harnessDir, runDir, cwd, sidecarReplayAllowed);

  // §4.10 Verdict redirect guard — applies to BOTH verdict and error paths.
  // If SIGUSR1 jump/skip mutated state.currentPhase during the gate call, do
  // not apply the verdict (would overwrite jump destination) or the error (same).
  if (state.currentPhase !== phase) {
    printInfo(`Phase ${phase} interrupted by control signal → phase ${state.currentPhase}`);
    renderControlPanel(state);
    return;
  }

  if (result.type === 'verdict') {
    if (result.verdict === 'APPROVE') {
      // Emit gate_verdict (skip if legacy sidecar replay with runner undefined)
      if (result.runner) {
        logger.logEvent({
          event: 'gate_verdict',
          phase,
          retryIndex,
          runner: result.runner,
          verdict: 'APPROVE',
          durationMs: result.durationMs,
          tokensTotal: result.tokensTotal,
          promptBytes: result.promptBytes,
          codexSessionId: result.codexSessionId,
          recoveredFromSidecar: result.recoveredFromSidecar ?? false,
          resumedFrom: result.resumedFrom,
          resumeFallback: result.resumeFallback,
          preset: gatePresetMeta,
        });
      }

      state.phases[String(phase)] = 'completed';

      // Post-success sidecar cleanup
      deleteGateSidecars(runDir, phase);

      if (phase === 7) {
        // Terminal: run complete
        state.currentPhase = TERMINAL_PHASE;
        state.status = 'completed';
        printSuccess(`Phase ${phase} APPROVED — run complete`);
        writeState(runDir, state);
      } else {
        const next = nextPhase(phase);
        state.currentPhase = next;
        renderControlPanel(state);
        writeState(runDir, state);
      }

      // State anomaly check: pendingAction should be null after APPROVE
      if (state.pendingAction !== null) {
        logger.logEvent({
          event: 'state_anomaly',
          kind: 'pending_action_stale_after_approve',
          details: { phase, pendingActionType: (state.pendingAction as PendingAction).type },
        });
      }
    } else {
      // REJECT — emit gate_verdict before dispatching
      if (result.runner) {
        logger.logEvent({
          event: 'gate_verdict',
          phase,
          retryIndex,
          runner: result.runner,
          verdict: 'REJECT',
          durationMs: result.durationMs,
          tokensTotal: result.tokensTotal,
          promptBytes: result.promptBytes,
          codexSessionId: result.codexSessionId,
          recoveredFromSidecar: result.recoveredFromSidecar ?? false,
          resumedFrom: result.resumedFrom,
          resumeFallback: result.resumeFallback,
          preset: gatePresetMeta,
        });
      }
      await handleGateReject(phase, result.comments, retryIndex, state, harnessDir, runDir, cwd, inputManager, logger);
    }
  } else {
    // Error path. Redirect guard was already applied above.
    // Emit gate_error (skip if legacy sidecar replay with runner undefined)
    if (result.runner) {
      logger.logEvent({
        event: 'gate_error',
        phase,
        retryIndex,
        runner: result.runner,
        error: result.error,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        tokensTotal: result.tokensTotal,
        codexSessionId: result.codexSessionId,
        recoveredFromSidecar: result.recoveredFromSidecar ?? false,
        resumedFrom: result.resumedFrom,
        resumeFallback: result.resumeFallback,
        preset: gatePresetMeta,
      });
    }
    await handleGateError(phase, result.error, state, runDir, cwd, inputManager, logger);
  }
}

export async function handleGateReject(
  phase: GatePhase,
  comments: string,
  retryIndex: number,
  state: HarnessState,
  _harnessDir: string,
  runDir: string,
  cwd: string,
  inputManager: InputManager,
  logger: SessionLogger,
): Promise<void> {
  state.phases[String(phase)] = 'pending';

  // Increment retry counter AFTER capturing retryIndex (pre-mutation)
  state.gateRetries[String(phase)] = retryIndex + 1;

  // Phase 7 special: reset verifyRetries
  if (phase === 7) {
    state.verifyRetries = 0;
  }

  const retryCount = state.gateRetries[String(phase)];
  const targetInteractive = previousInteractivePhase(phase);

  printWarning(`Gate ${phase} REJECTED (retry ${retryCount}/${GATE_RETRY_LIMIT})`);
  if (comments) {
    printInfo(`Feedback:\n${comments}`);
  }

  if (retryCount < GATE_RETRY_LIMIT || state.autoMode) {
    if (retryCount >= GATE_RETRY_LIMIT && state.autoMode) {
      // Auto-mode force pass (no gate_retry event — force_pass covers this path)
      await forcePassGate(phase, state, runDir, cwd, 'auto', logger);
      return;
    }

    // Save feedback and reopen. For Phase 7 reject → Phase 5, include any existing
    // verify-feedback.md so Claude sees BOTH the eval gate feedback and prior verify failures.
    const feedbackPath = saveGateFeedback(runDir, phase, comments);
    const feedbackBytes = fs.statSync(feedbackPath).size;
    const feedbackPreview = comments.slice(0, 200);

    // Emit gate_retry BEFORE state mutation (retryIndex is the just-failed attempt)
    logger.logEvent({
      event: 'gate_retry',
      phase,
      retryIndex,
      retryCount: retryIndex + 1,
      retryLimit: GATE_RETRY_LIMIT,
      feedbackPath,
      feedbackBytes,
      feedbackPreview,
    });

    const feedbackPaths: string[] = [feedbackPath];
    if (phase === 7) {
      const verifyFeedback = path.join(runDir, 'verify-feedback.md');
      if (fs.existsSync(verifyFeedback)) {
        feedbackPaths.push(verifyFeedback);
      }
    }
    const pendingAction: PendingAction = {
      type: 'reopen_phase',
      targetPhase: targetInteractive,
      sourcePhase: phase as PhaseNumber,
      feedbackPaths,
    };

    // Crash-safe: feedback already saved → write pendingAction+state atomically
    state.pendingAction = pendingAction;
    state.phases[String(targetInteractive)] = 'pending';
    state.phaseReopenFlags[String(targetInteractive)] = true;
    state.phaseReopenSource[String(targetInteractive)] = phase; // track triggering gate
    state.currentPhase = targetInteractive;
    writeState(runDir, state);
  } else {
    // Escalation
    await handleGateEscalation(phase, comments, state, runDir, cwd, inputManager, logger);
  }
}

export async function handleGateEscalation(
  phase: GatePhase,
  comments: string,
  state: HarnessState,
  runDir: string,
  cwd: string,
  inputManager: InputManager,
  logger: SessionLogger,
): Promise<void> {
  printWarning(`Gate ${phase} retry limit reached (${GATE_RETRY_LIMIT})`);

  const choice = await promptChoice(
    `Gate ${phase} has been rejected ${GATE_RETRY_LIMIT} times. What would you like to do?`,
    [
      { key: 'C', label: 'Continue (reset retries, reopen)' },
      { key: 'S', label: 'Skip (force-pass)' },
      { key: 'Q', label: 'Quit (pause)' },
    ],
    inputManager,
  );

  // Emit escalation event after userChoice is resolved (exactly 1 per path)
  logger.logEvent({
    event: 'escalation',
    phase,
    reason: 'gate-retry-limit',
    userChoice: choice as 'C' | 'S' | 'Q',
  });

  if (choice === 'C') {
    // Reset retries, reopen
    state.gateRetries[String(phase)] = 0;
    if (phase === 7) state.verifyRetries = 0;

    const targetInteractive = previousInteractivePhase(phase);
    const feedbackPath = saveGateFeedback(runDir, phase, comments);
    state.pendingAction = {
      type: 'reopen_phase',
      targetPhase: targetInteractive,
      sourcePhase: phase as PhaseNumber,
      feedbackPaths: [feedbackPath],
    };
    state.phases[String(targetInteractive)] = 'pending';
    state.phaseReopenFlags[String(targetInteractive)] = true;
    state.phaseReopenSource[String(targetInteractive)] = phase; // track triggering gate
    state.currentPhase = targetInteractive;
    writeState(runDir, state);
  } else if (choice === 'S') {
    // Force-pass (skip) — user choice
    await forcePassGate(phase, state, runDir, cwd, 'user', logger);
  } else {
    // Quit
    const targetInteractive = previousInteractivePhase(phase);
    const feedbackPath = saveGateFeedback(runDir, phase, comments);
    state.pendingAction = {
      type: 'show_escalation',
      targetPhase: phase as PhaseNumber,
      sourcePhase: targetInteractive as PhaseNumber,
      feedbackPaths: [feedbackPath],
    };
    state.status = 'paused';
    state.pauseReason = 'gate-escalation';
    savePausedAtHead(state, cwd);
    writeState(runDir, state);
  }
}

export async function forcePassGate(
  phase: GatePhase,
  state: HarnessState,
  runDir: string,
  cwd: string,
  by: 'auto' | 'user',
  logger: SessionLogger,
): Promise<void> {
  state.pendingAction = { type: 'skip_phase', targetPhase: phase as PhaseNumber, sourcePhase: null, feedbackPaths: [] };
  writeState(runDir, state);

  // Emit force_pass as the sole terminal event for this path
  logger.logEvent({ event: 'force_pass', phase, by });

  // Side effects: cleanup, advance
  deleteGateSidecars(runDir, phase);
  state.phases[String(phase)] = 'completed';
  state.pendingAction = null;

  if (phase === 7) {
    state.currentPhase = TERMINAL_PHASE;
    state.status = 'completed';
    printSuccess(`Gate ${phase} force-passed — run complete`);
  } else {
    const next = nextPhase(phase);
    state.currentPhase = next;
    printInfo(`Gate ${phase} force-passed — advancing to Phase ${next}`);
  }
  writeState(runDir, state);
  void cwd;
}

export async function handleGateError(
  phase: GatePhase,
  error: string,
  state: HarnessState,
  runDir: string,
  cwd: string,
  inputManager: InputManager,
  logger: SessionLogger,
): Promise<void> {
  printError(`Gate ${phase} error: ${error}`);

  const choice = await promptChoice(
    `Gate ${phase} encountered an error. What would you like to do?`,
    [
      { key: 'R', label: 'Retry' },
      { key: 'S', label: 'Skip (force-pass)' },
      { key: 'Q', label: 'Quit (pause)' },
    ],
    inputManager,
  );

  // Emit escalation event after userChoice is resolved (exactly 1 per path)
  logger.logEvent({
    event: 'escalation',
    phase,
    reason: 'gate-error',
    userChoice: choice as 'R' | 'S' | 'Q',
  });

  if (choice === 'R') {
    // Retry: leave phase as-is, the loop will re-enter handleGatePhase
    state.phases[String(phase)] = 'pending';
    writeState(runDir, state);
    // currentPhase stays the same — loop retries
  } else if (choice === 'S') {
    await forcePassGate(phase, state, runDir, cwd, 'user', logger);
  } else {
    // Quit
    state.phases[String(phase)] = 'error';
    state.pendingAction = {
      type: 'rerun_gate',
      targetPhase: phase as PhaseNumber,
      sourcePhase: null,
      feedbackPaths: [],
    };
    state.status = 'paused';
    state.pauseReason = 'gate-error';
    savePausedAtHead(state, cwd);
    writeState(runDir, state);
  }
}

// ─── Verify phase handler ──────────────────────────────────────────────────────

export async function handleVerifyPhase(
  state: HarnessState,
  harnessDir: string,
  runDir: string,
  cwd: string,
  inputManager: InputManager,
  logger: SessionLogger,
): Promise<void> {
  const retryIndex = state.verifyRetries; // pre-mutation capture
  const phaseStartTs = Date.now();

  logger.logEvent({ event: 'phase_start', phase: 6, retryIndex });

  // Note: runVerifyPhase internally sets phase to 'in_progress' and calls writeState
  let outcome: Awaited<ReturnType<typeof runVerifyPhase>>;
  try {
    outcome = await runVerifyPhase(state, harnessDir, runDir, cwd);
  } catch (err) {
    // throw path: emit phase_end + route to handleVerifyError (no rethrow)
    logger.logEvent({
      event: 'phase_end',
      phase: 6,
      status: 'failed',
      durationMs: Date.now() - phaseStartTs,
      details: { reason: 'verify_throw' },
    });
    state.phases['6'] = 'error';
    writeState(runDir, state);
    await handleVerifyError(undefined, state, harnessDir, runDir, cwd, inputManager, logger);
    return; // no rethrow
  }

  const durationMs = Date.now() - phaseStartTs;

  if (outcome.type === 'pass') {
    // Emit verify_result before commit attempt (runVerifyPhase did pass)
    logger.logEvent({ event: 'verify_result', passed: true, retryIndex, durationMs });

    // Commit the eval report artifact (spec requires committed eval report before Phase 7)
    const evalReportPath = path.join(cwd, state.artifacts.evalReport);
    try {
      normalizeArtifactCommit(
        evalReportPath,
        `harness[${state.runId}]: Phase 6 — eval report`,
        cwd
      );
    } catch (err) {
      // Commit failure → phase goes to error, pendingAction for retry
      printError(`Failed to commit eval report: ${(err as Error).message}`);
      state.phases['6'] = 'error';
      state.pendingAction = null; // error state itself is recovery trigger
      savePausedAtHead(state, cwd);
      writeState(runDir, state);
      logger.logEvent({
        event: 'phase_end',
        phase: 6,
        status: 'failed',
        durationMs: Date.now() - phaseStartTs,
        details: { reason: 'eval_commit_failed' },
      });
      return;
    }

    // Update evalCommit + verifiedAtHead AFTER commit succeeds
    try {
      const head = getHead(cwd);
      state.evalCommit = head;
      state.verifiedAtHead = head;
    } catch {
      // leave as-is
    }
    state.verifyRetries = 0;
    state.phases['6'] = 'completed';
    state.pendingAction = null;
    state.currentPhase = 7;

    // Delete verify-result.json + verify-feedback.md AFTER state advance (crash-safe)
    writeState(runDir, state);
    deleteVerifyResult(runDir);
    try {
      fs.unlinkSync(path.join(runDir, 'verify-feedback.md'));
    } catch { /* best-effort: may not exist */ }

    logger.logEvent({ event: 'phase_end', phase: 6, status: 'completed', durationMs });
    renderControlPanel(state);
  } else if (outcome.type === 'fail') {
    logger.logEvent({ event: 'verify_result', passed: false, retryIndex, durationMs });
    logger.logEvent({ event: 'phase_end', phase: 6, status: 'failed', durationMs });
    await handleVerifyFail(outcome.feedbackPath, state, runDir, cwd, inputManager, logger);
  } else {
    // error — but check if SIGUSR1 redirected first
    if (state.currentPhase !== 6) {
      printInfo(`Phase 6 interrupted by control signal → phase ${state.currentPhase}`);
      logger.logEvent({
        event: 'phase_end',
        phase: 6,
        status: 'failed',
        durationMs,
        details: { reason: 'redirected' },
      });
      renderControlPanel(state);
      return;
    }
    // error (non-throw): NO verify_result per spec — only phase_end
    logger.logEvent({ event: 'phase_end', phase: 6, status: 'failed', durationMs });
    await handleVerifyError(outcome.errorPath, state, harnessDir, runDir, cwd, inputManager, logger);
  }
}

export async function handleVerifyFail(
  feedbackPath: string,
  state: HarnessState,
  runDir: string,
  cwd: string,
  inputManager: InputManager,
  logger: SessionLogger,
): Promise<void> {
  state.verifyRetries += 1;
  const retryCount = state.verifyRetries;

  printWarning(`Verify FAILED (retry ${retryCount}/${VERIFY_RETRY_LIMIT})`);

  if (retryCount < VERIFY_RETRY_LIMIT || state.autoMode) {
    if (retryCount >= VERIFY_RETRY_LIMIT && state.autoMode) {
      // Auto-mode: skip verify
      await forcePassVerify(state, runDir, cwd, 'auto', logger);
      return;
    }

    // Crash-safe ordering: feedback already saved by runVerifyPhase
    // Write pendingAction+state BEFORE deleting eval report
    const pendingAction: PendingAction = {
      type: 'reopen_phase',
      targetPhase: 5,
      sourcePhase: 6,
      feedbackPaths: [feedbackPath],
    };
    state.pendingAction = pendingAction;
    state.phases['5'] = 'pending';
    state.phases['6'] = 'pending';
    state.phaseReopenFlags['5'] = true;
    state.phaseReopenSource['5'] = 6; // verify phase triggered reopen
    state.currentPhase = 5;
    writeState(runDir, state);

    // Delete eval report AFTER state write
    try {
      const evalAbsPath = path.isAbsolute(state.artifacts.evalReport)
        ? state.artifacts.evalReport
        : path.join(cwd, state.artifacts.evalReport);
      fs.unlinkSync(evalAbsPath);
    } catch { /* ignore */ }
  } else {
    // Escalation
    await handleVerifyEscalation(feedbackPath, state, runDir, cwd, inputManager, logger);
  }
}

export async function handleVerifyEscalation(
  feedbackPath: string,
  state: HarnessState,
  runDir: string,
  cwd: string,
  inputManager: InputManager,
  logger: SessionLogger,
): Promise<void> {
  printWarning(`Verify retry limit reached (${VERIFY_RETRY_LIMIT})`);

  const choice = await promptChoice(
    `Verify has failed ${VERIFY_RETRY_LIMIT} times. What would you like to do?`,
    [
      { key: 'C', label: 'Continue (reset retries, reopen Phase 5)' },
      { key: 'S', label: 'Skip (force-pass verify)' },
      { key: 'Q', label: 'Quit (pause)' },
    ],
    inputManager,
  );

  // Emit escalation event after userChoice is resolved (exactly 1 per path)
  logger.logEvent({
    event: 'escalation',
    phase: 6,
    reason: 'verify-limit',
    userChoice: choice as 'C' | 'S' | 'Q',
  });

  if (choice === 'C') {
    state.verifyRetries = 0;
    state.pendingAction = {
      type: 'reopen_phase',
      targetPhase: 5,
      sourcePhase: 6,
      feedbackPaths: [feedbackPath],
    };
    state.phases['5'] = 'pending';
    state.phases['6'] = 'pending';
    state.phaseReopenFlags['5'] = true;
    state.phaseReopenSource['5'] = 6; // verify escalation triggered reopen
    state.currentPhase = 5;
    writeState(runDir, state);

    // Delete eval report AFTER state write
    try {
      const evalAbsPath = path.isAbsolute(state.artifacts.evalReport)
        ? state.artifacts.evalReport
        : path.join(cwd, state.artifacts.evalReport);
      fs.unlinkSync(evalAbsPath);
    } catch { /* ignore */ }
  } else if (choice === 'S') {
    await forcePassVerify(state, runDir, cwd, 'user', logger);
  } else {
    // Quit — verify-escalation uses show_escalation (per spec: only gate/verify error quit use show_verify_error)
    state.pendingAction = {
      type: 'show_escalation',
      targetPhase: 6,
      sourcePhase: 5,
      feedbackPaths: [feedbackPath],
    };
    state.status = 'paused';
    state.pauseReason = 'verify-escalation';
    savePausedAtHead(state, cwd);
    writeState(runDir, state);
  }
}

export async function forcePassVerify(
  state: HarnessState,
  runDir: string,
  cwd: string,
  by: 'auto' | 'user',
  logger: SessionLogger,
): Promise<void> {
  // Atomic write with skip_phase pendingAction before side effects
  state.pendingAction = { type: 'skip_phase', targetPhase: 6, sourcePhase: null, feedbackPaths: [] };
  writeState(runDir, state);

  // Emit force_pass as the sole terminal event for this path
  logger.logEvent({ event: 'force_pass', phase: 6, by });

  // Write synthetic eval report
  writeSyntheticEvalReport(state.artifacts.evalReport, state.runId, cwd);

  // Normalize the synthetic report — failure must mark phase as error (not silently skip)
  const message = `harness[${state.runId}]: Phase 6 — synthetic eval report (skip)`;
  try {
    normalizeArtifactCommit(state.artifacts.evalReport, message, cwd);
  } catch (err) {
    printError(`Failed to commit synthetic eval report: ${(err as Error).message}`);
    state.phases['6'] = 'error';
    state.pendingAction = null;
    savePausedAtHead(state, cwd);
    writeState(runDir, state);
    return;
  }

  // Update anchors AFTER commit succeeds
  try {
    const head = getHead(cwd);
    state.evalCommit = head;
    state.verifiedAtHead = head;
  } catch {
    // leave as-is
  }

  state.verifyRetries = 0;
  state.phases['6'] = 'completed';
  state.pendingAction = null;
  state.currentPhase = 7;
  writeState(runDir, state);
  deleteVerifyResult(runDir);
  try {
    fs.unlinkSync(path.join(runDir, 'verify-feedback.md'));
  } catch { /* best-effort */ }

  printInfo('Verify force-passed — advancing to Phase 7');
}

export async function handleVerifyError(
  errorPath: string | undefined,
  state: HarnessState,
  _harnessDir: string,
  runDir: string,
  cwd: string,
  inputManager: InputManager,
  logger: SessionLogger,
): Promise<void> {
  const errorInfo = errorPath ? ` (see ${errorPath})` : '';
  printError(`Verify error${errorInfo}`);

  const choice = await promptChoice(
    'Verify encountered an error. What would you like to do?',
    [
      { key: 'R', label: 'Retry' },
      { key: 'Q', label: 'Quit (pause)' },
    ],
    inputManager,
  );

  // Emit escalation event after userChoice is resolved (exactly 1 per path)
  logger.logEvent({
    event: 'escalation',
    phase: 6,
    reason: 'verify-error',
    userChoice: choice as 'R' | 'Q',
  });

  if (choice === 'R') {
    // Retry: reset phase status, loop re-enters
    state.phases['6'] = 'pending';
    writeState(runDir, state);
    // currentPhase stays 6
  } else {
    // Quit — Verify ERROR quit uses show_verify_error per spec
    state.phases['6'] = 'error';
    state.pendingAction = {
      type: 'show_verify_error',
      targetPhase: 6,
      sourcePhase: null,
      feedbackPaths: errorPath ? [errorPath] : [],
    };
    state.status = 'paused';
    state.pauseReason = 'verify-error';
    savePausedAtHead(state, cwd);
    writeState(runDir, state);
  }
}
