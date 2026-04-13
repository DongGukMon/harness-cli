import { existsSync, readFileSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { getHead, isAncestor, detectExternalCommits } from './git.js';
import { readState, writeState } from './state.js';
import { normalizeArtifactCommit } from './artifact.js';
import { checkGateSidecars } from './phases/gate.js';
import { readVerifyResult, isEvalReportValid } from './phases/verify.js';
import { runPhaseLoop } from './phases/runner.js';
import type { HarnessState, PhaseNumber } from './types.js';

/**
 * Resume a run. Validates state, performs recovery based on pendingAction or
 * phase status, then delegates to runPhaseLoop to continue execution.
 */
export async function resumeRun(
  state: HarnessState,
  harnessDir: string,
  runDir: string,
  cwd: string
): Promise<void> {
  // Step 1: Validate completed phase artifacts exist and match committed state
  validateCompletedArtifacts(state, cwd);

  // Step 2: Ancestry validation
  validateAncestry(state, cwd);

  // Step 3: External commit detection
  updateExternalCommitsDetected(state, cwd, runDir);

  // Step 4: PendingAction replay (if present)
  if (state.pendingAction !== null) {
    await replayPendingAction(state, harnessDir, runDir, cwd);
    return;
  }

  // Step 5: Paused without pendingAction → error
  if (state.status === 'paused' && state.pendingAction === null) {
    process.stderr.write(
      `Run state is inconsistent: paused run has no pendingAction.\n` +
      `Use 'harness jump N' to re-run from a specific phase or delete .harness/${state.runId}/ to discard this run.\n`
    );
    process.exit(1);
  }

  // Step 6: General recovery — re-enter runPhaseLoop
  // runPhaseLoop inspects state.currentPhase and state.phases[N] to decide what to do
  // For sentinel-based recovery, the phase runners themselves check freshness
  await runPhaseLoop(state, harnessDir, runDir, cwd);
}

function validateCompletedArtifacts(state: HarnessState, cwd: string): void {
  // Phase 1 completed: spec + decisionLog must exist and be non-empty
  if (state.phases['1'] === 'completed') {
    requireNonEmpty(join(cwd, state.artifacts.spec), 'spec', state.runId);
    requireNonEmpty(join(cwd, state.artifacts.decisionLog), 'decision log', state.runId);
  }
  // Phase 3 completed: plan + checklist
  if (state.phases['3'] === 'completed') {
    requireNonEmpty(join(cwd, state.artifacts.plan), 'plan', state.runId);
    requireNonEmpty(join(cwd, state.artifacts.checklist), 'checklist', state.runId);
  }
  // Phase 6 completed: eval report
  if (state.phases['6'] === 'completed') {
    if (!isEvalReportValid(join(cwd, state.artifacts.evalReport))) {
      process.stderr.write(
        `Artifact missing or invalid for completed phase 6: ${state.artifacts.evalReport}.\n` +
        `Use 'harness jump 6' to re-run from that phase.\n`
      );
      process.exit(1);
    }
  }
}

function requireNonEmpty(path: string, label: string, runId: string): void {
  if (!existsSync(path)) {
    process.stderr.write(
      `Artifact missing for completed phase: ${path}.\n` +
      `Use 'harness jump N' to re-run from that phase.\n`
    );
    process.exit(1);
  }
  try {
    const content = readFileSync(path, 'utf-8');
    if (content.trim().length === 0) {
      process.stderr.write(
        `Artifact empty for completed phase: ${path}.\n` +
        `Use 'harness jump N' to re-run from that phase.\n`
      );
      process.exit(1);
    }
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('__exit__')) throw err;
    process.stderr.write(`Cannot read artifact ${path}: ${msg}\n`);
    process.exit(1);
  }
}

function validateAncestry(state: HarnessState, cwd: string): void {
  try {
    if (state.phases['1'] === 'completed' && state.specCommit) {
      if (!isAncestor(state.specCommit, 'HEAD', cwd)) {
        process.stderr.write(
          `Spec commit is no longer in git history (HEAD has diverged from specCommit).\n` +
          `Use 'harness jump 1' to re-run brainstorming.\n`
        );
        process.exit(1);
      }
    }
    if (state.phases['3'] === 'completed' && state.planCommit) {
      if (!isAncestor(state.planCommit, 'HEAD', cwd)) {
        process.stderr.write(
          `Plan commit is no longer in git history.\n` +
          `Use 'harness jump 3' to re-run planning.\n`
        );
        process.exit(1);
      }
    }
    if (state.phases['5'] === 'completed') {
      const anchor = state.implCommit ?? state.baseCommit;
      if (!isAncestor(anchor, 'HEAD', cwd)) {
        process.stderr.write(
          `Implementation commit is no longer in git history.\n` +
          `Manual recovery required.\n`
        );
        process.exit(1);
      }
    }
    if (state.phases['6'] === 'completed' && state.evalCommit) {
      if (!isAncestor(state.evalCommit, 'HEAD', cwd)) {
        process.stderr.write(
          `Eval report commit is no longer in git history.\n` +
          `Use 'harness jump 6' to re-run verification.\n`
        );
        process.exit(1);
      }
    }
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('__exit__')) throw err;
    // git errors during ancestry → continue (non-fatal)
  }
}

function updateExternalCommitsDetected(state: HarnessState, cwd: string, runDir: string): void {
  try {
    const anchor = state.pausedAtHead ?? state.baseCommit;
    const knownAnchors = [state.specCommit, state.planCommit, state.implCommit, state.evalCommit];
    const implRange = state.implCommit
      ? { from: state.baseCommit, to: state.implCommit }
      : null;
    const external = detectExternalCommits(anchor, knownAnchors, implRange, cwd);
    if (external.length > 0) {
      process.stderr.write(`⚠️  External commits detected (${external.length} commits).\n`);
      state.externalCommitsDetected = true;
      writeState(runDir, state);
    }
  } catch {
    // Non-fatal
  }
}

/**
 * Validate Phase 1/3/5 artifacts when fresh sentinel is detected on resume.
 * Runs normalize_artifact_commit for Phase 1/3.
 * Returns true if the phase can be treated as completed.
 */
function completeInteractivePhaseFromFreshSentinel(
  phase: PhaseNumber,
  state: HarnessState,
  cwd: string
): boolean {
  try {
    if (phase === 1 || phase === 3) {
      // Check artifact existence + non-empty + mtime >= phaseOpenedAt
      const artifactKeys: Array<'spec' | 'decisionLog' | 'plan' | 'checklist'> =
        phase === 1 ? ['spec', 'decisionLog'] : ['plan', 'checklist'];
      const openedAt = state.phaseOpenedAt[String(phase)];

      for (const key of artifactKeys) {
        const relPath = state.artifacts[key];
        const absPath = join(cwd, relPath);
        if (!existsSync(absPath)) return false;
        const stat = statSync(absPath);
        if (stat.size === 0) return false;
        if (openedAt !== null && Math.floor(stat.mtimeMs) < openedAt) return false;
      }

      // Run normalize_artifact_commit for non-gitignored artifacts
      for (const key of artifactKeys) {
        const relPath = state.artifacts[key];
        if (relPath.startsWith('.harness/')) continue;
        const message = `harness[${state.runId}]: Phase ${phase} — ${String(key)}`;
        normalizeArtifactCommit(relPath, message, cwd);
      }

      // Update commit anchor
      const head = getHead(cwd);
      if (phase === 1) state.specCommit = head;
      if (phase === 3) state.planCommit = head;
      return true;
    }

    if (phase === 5) {
      // Phase 5 completion: at least 1 commit since implRetryBase + clean tree
      // Trust the sentinel was written after those conditions were met at original exit
      const head = getHead(cwd);
      state.implCommit = head;
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

async function replayPendingAction(
  state: HarnessState,
  harnessDir: string,
  runDir: string,
  cwd: string
): Promise<void> {
  const action = state.pendingAction!;

  switch (action.type) {
    case 'rerun_gate': {
      // Idempotency: if phase already completed → clear + advance
      if (state.phases[String(action.targetPhase)] === 'completed') {
        state.pendingAction = null;
        writeState(runDir, state);
      } else {
        // Check sidecars for stored result
        const sidecar = checkGateSidecars(runDir, action.targetPhase);
        if (sidecar) {
          // Has stored result — let runPhaseLoop handle it
          state.pendingAction = null;
          writeState(runDir, state);
        } else {
          // Re-execute gate
          state.pendingAction = null;
          state.phases[String(action.targetPhase)] = 'pending';
          writeState(runDir, state);
        }
      }
      break;
    }
    case 'rerun_verify': {
      if (state.phases['6'] === 'completed') {
        state.pendingAction = null;
        writeState(runDir, state);
      } else {
        state.pendingAction = null;
        state.phases['6'] = 'pending';
        writeState(runDir, state);
      }
      break;
    }
    case 'reopen_phase': {
      // Verify FAIL source: delete eval report if present (idempotent Verify FAIL step ②)
      if (action.sourcePhase === 6) {
        const evalReportPath = join(cwd, state.artifacts.evalReport);
        try {
          unlinkSync(evalReportPath);
        } catch {
          /* best-effort */
        }
      }

      // Check sentinel freshness for target phase
      const targetPhaseKey = String(action.targetPhase);
      const sentinelPath = join(runDir, `phase-${action.targetPhase}.done`);
      const expectedAttemptId = state.phaseAttemptId[targetPhaseKey];

      if (existsSync(sentinelPath) && expectedAttemptId) {
        const content = readFileSync(sentinelPath, 'utf-8').trim();
        if (content === expectedAttemptId) {
          // Fresh sentinel — complete phase inline without respawn
          const completed = completeInteractivePhaseFromFreshSentinel(
            action.targetPhase,
            state,
            cwd
          );
          if (completed) {
            state.pendingAction = null;
            state.phases[targetPhaseKey] = 'completed';
            state.currentPhase = action.targetPhase + 1;
            writeState(runDir, state);
            // Continue phase loop from the next phase
            await runPhaseLoop(state, harnessDir, runDir, cwd);
            return;
          } else {
            // Artifact validation failed — treat sentinel as stale
            try {
              unlinkSync(sentinelPath);
            } catch {
              /* best-effort */
            }
          }
        } else {
          // Stale sentinel — delete, set to pending for respawn
          try {
            unlinkSync(sentinelPath);
          } catch {
            /* best-effort */
          }
        }
      }

      // No fresh sentinel — spawn fresh interactive phase
      state.pendingAction = null;
      state.phases[targetPhaseKey] = 'pending';
      state.currentPhase = action.targetPhase;
      writeState(runDir, state);
      break;
    }
    case 'skip_phase': {
      if (state.phases[String(action.targetPhase)] === 'completed') {
        state.pendingAction = null;
        writeState(runDir, state);
      } else {
        // Re-run skip: mark pending so skip can be reattempted via CLI
        // For simplicity, just clear pendingAction and let user re-run skip
        state.pendingAction = null;
        writeState(runDir, state);
      }
      break;
    }
    case 'show_escalation':
    case 'show_verify_error': {
      // Re-trigger the UI by re-entering the appropriate phase with retry counter at max
      // so runPhaseLoop shows the escalation menu again.
      // For show_escalation: the target phase is the gate that exceeded retries.
      // For show_verify_error: Phase 6 with error status.
      state.status = 'in_progress';
      if (action.type === 'show_verify_error') {
        // Phase 6 stays as "error" — runPhaseLoop's verify handler will see error state
        // and re-show the UI via handleVerifyError
        state.phases['6'] = 'error';
      } else {
        // show_escalation: set phase to exceed threshold so UI re-displays
        const tp = String(action.targetPhase);
        if (action.targetPhase === 6) {
          state.phases['6'] = 'failed';
        } else {
          state.phases[tp] = 'in_progress';
        }
      }
      state.pendingAction = null;
      writeState(runDir, state);
      break;
    }
  }

  // After pendingAction handling, continue phase loop
  await runPhaseLoop(state, harnessDir, runDir, cwd);
}
