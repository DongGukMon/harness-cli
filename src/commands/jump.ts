import { execSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { detectExternalCommits, getGitRoot, isAncestor } from '../git.js';
import { acquireLock, releaseLock } from '../lock.js';
import { getPreflightItems, runPreflight } from '../preflight.js';
import { findHarnessRoot, getCurrentRun } from '../root.js';
import { readState, writeState } from '../state.js';
import { runPhaseLoop } from '../phases/runner.js';
import type { HarnessState, PhaseNumber, PhaseType } from '../types.js';

export interface JumpOptions {
  root?: string;
}

function phaseType(phase: number): PhaseType {
  if (phase === 1 || phase === 3 || phase === 5) return 'interactive';
  if (phase === 2 || phase === 4 || phase === 7) return 'gate';
  if (phase === 6) return 'verify';
  return 'ui_only';
}

export async function jumpCommand(phaseArg: string, options: JumpOptions = {}): Promise<void> {
  // 1. Parse phase number
  const targetPhase = parseInt(phaseArg, 10);
  if (isNaN(targetPhase) || targetPhase < 1 || targetPhase > 7) {
    process.stderr.write(`Error: invalid phase '${phaseArg}'. Must be 1-7.\n`);
    process.exit(1);
  }
  const N = targetPhase as PhaseNumber;

  // 2. Resolve harnessDir + runId
  const harnessDir = findHarnessRoot(options.root);
  const runId = getCurrentRun(harnessDir);
  if (runId === null) {
    process.stderr.write("No active run. Use 'harness list' to see all runs.\n");
    process.exit(1);
  }

  const runDir = join(harnessDir, runId);
  const state = readState(runDir);
  if (state === null) {
    process.stderr.write(`Run '${runId}' has no state. Manual recovery required.\n`);
    process.exit(1);
  }

  // 3. Forward jump rejected (unless from completed)
  const isCompleted = state.status === 'completed' || state.currentPhase === 8;
  if (!isCompleted && N >= state.currentPhase) {
    process.stderr.write(
      `Error: forward jumps not allowed. Current phase: ${state.currentPhase}, target: ${N}.\n`
    );
    process.exit(1);
  }

  const cwd = options.root ?? getGitRoot();

  // 4. Acquire lock
  acquireLock(harnessDir, runId);

  try {
    // 5. Run phase-type preflight BEFORE any state mutation
    const pt = phaseType(N);
    runPreflight(getPreflightItems(pt), cwd);

    // 5b. Required-input validation BEFORE state mutation (spec: harness jump preflight)
    validateJumpRequiredInputs(N, state, harnessDir, runId, cwd);

    // 6. Ancestry validation (spec: jump git anchor validation)
    if (state.specCommit && N > 1 && !isAncestor(state.specCommit, 'HEAD', cwd)) {
      process.stderr.write(
        `Error: Spec commit is no longer in git history. Use 'harness jump 1' to re-run brainstorming.\n`
      );
      process.exit(1);
    }
    if (state.planCommit && N > 3 && !isAncestor(state.planCommit, 'HEAD', cwd)) {
      process.stderr.write(`Error: Plan commit is no longer in git history.\n`);
      process.exit(1);
    }
    // Phase 5 completed: implCommit != null → implCommit ancestry.
    // Phase 5 skip → implCommit == null but baseCommit must still be ancestor (protects Phase 7 diff).
    if (state.phases['5'] === 'completed' && N > 5) {
      if (state.implCommit !== null) {
        if (!isAncestor(state.implCommit, 'HEAD', cwd)) {
          process.stderr.write(
            `Error: Committed implementation work may have been lost (HEAD has diverged from implCommit). Manual recovery required.\n`
          );
          process.exit(1);
        }
      } else {
        // Phase 5 was skipped — enforce baseCommit ancestry
        if (!isAncestor(state.baseCommit, 'HEAD', cwd)) {
          process.stderr.write(
            `Error: HEAD has diverged from baseCommit. Harness diff (Phase 7) will be invalid. Use 'harness jump 1' to restart from base.\n`
          );
          process.exit(1);
        }
      }
    }
    if (state.evalCommit && N > 6 && !isAncestor(state.evalCommit, 'HEAD', cwd)) {
      process.stderr.write(
        `Error: Eval report commit is no longer in git history (HEAD has diverged from evalCommit). Use 'harness jump 6' to re-run verification.\n`
      );
      process.exit(1);
    }

    // 7. External commit detection
    const anchor = state.pausedAtHead ?? state.baseCommit;
    const knownAnchors = [state.specCommit, state.planCommit, state.implCommit, state.evalCommit];
    const implRange = state.implCommit
      ? { from: state.baseCommit, to: state.implCommit }
      : null;
    const external = detectExternalCommits(anchor, knownAnchors, implRange, cwd);
    if (external.length > 0) {
      process.stderr.write(`⚠️  External commits detected (${external.length}). Jumping anyway.\n`);
      state.externalCommitsDetected = true;
    }

    // 8. Apply jump reset matrix
    applyJumpReset(state, N);

    // 9. Delete sidecar files for reset phases
    deleteSidecarsForJump(runDir, N);

    // 10. Set currentPhase and write state
    state.currentPhase = N;
    state.status = 'in_progress';
    writeState(runDir, state);

    // 11. Immediately start phase N execution
    await runPhaseLoop(state, harnessDir, runDir, cwd);
  } finally {
    releaseLock(harnessDir, runId);
  }
}

/**
 * Validate that the target phase's required input files exist before jumping.
 * Per spec "harness jump" preflight: missing required input → error with guidance.
 */
function validateJumpRequiredInputs(
  N: PhaseNumber,
  state: HarnessState,
  harnessDir: string,
  runId: string,
  cwd: string
): void {
  const checkFile = (relPath: string, label: string, hint: string) => {
    const abs = join(cwd, relPath);
    if (!existsSync(abs)) {
      process.stderr.write(`Error: Phase ${N} requires ${label} (${relPath}). ${hint}\n`);
      process.exit(1);
    }
  };
  // Phase 1 requires task.md
  if (N === 1) {
    const taskMd = join(harnessDir, runId, 'task.md');
    if (!existsSync(taskMd)) {
      process.stderr.write(
        `Error: task.md is missing — start a new run with 'harness run "task description"'.\n`
      );
      process.exit(1);
    }
    return;
  }
  // Phase 2-7 need earlier phase outputs
  if (N >= 2) checkFile(state.artifacts.spec, 'spec', "Run 'harness jump 1' first.");
  if (N >= 4) checkFile(state.artifacts.plan, 'plan', "Run 'harness jump 3' first.");
  if (N === 7) checkFile(state.artifacts.evalReport, 'eval report', "Run 'harness jump 6' first.");
}

function applyJumpReset(state: HarnessState, N: PhaseNumber): void {
  // phases[M >= N] → pending
  for (let M = N; M <= 7; M++) {
    state.phases[String(M)] = 'pending';
  }

  // gateRetries[M >= N] → 0
  for (const g of [2, 4, 7]) {
    if (g >= N) state.gateRetries[String(g)] = 0;
  }

  // verifyRetries → 0 if N <= 6
  if (N <= 6) state.verifyRetries = 0;

  // pendingAction and pauseReason → null
  state.pendingAction = null;
  state.pauseReason = null;

  // Commit anchors
  if (N <= 1) state.specCommit = null;
  if (N <= 3) state.planCommit = null;
  if (N <= 5) {
    state.implCommit = null;
    state.implRetryBase = state.baseCommit;
  }
  if (N <= 6) {
    state.evalCommit = null;
    state.verifiedAtHead = null;
  }

  // phaseOpenedAt and phaseAttemptId for M >= N (only interactive phases: 1, 3, 5)
  for (const p of ['1', '3', '5']) {
    if (Number(p) >= N) {
      state.phaseOpenedAt[p] = null;
      state.phaseAttemptId[p] = null;
    }
  }
}

function deleteSidecarsForJump(runDir: string, N: PhaseNumber): void {
  const tryUnlink = (file: string) => {
    try {
      unlinkSync(join(runDir, file));
    } catch {
      // best-effort
    }
  };

  // Sentinels for M >= N
  for (const p of [1, 3, 5]) {
    if (p >= N) tryUnlink(`phase-${p}.done`);
  }

  // Gate sidecars for gate M >= N
  for (const g of [2, 4, 7]) {
    if (g >= N) {
      tryUnlink(`gate-${g}-raw.txt`);
      tryUnlink(`gate-${g}-result.json`);
      tryUnlink(`gate-${g}-error.md`);
      tryUnlink(`gate-${g}-feedback.md`);
    }
  }

  // Verify sidecars if N <= 6
  if (N <= 6) {
    tryUnlink('verify-result.json');
    tryUnlink('verify-feedback.md');
    tryUnlink('verify-error.md');
  }

  // checklist.json if N <= 3
  if (N <= 3) {
    tryUnlink('checklist.json');
  }
}
