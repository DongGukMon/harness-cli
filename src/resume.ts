import { existsSync, readFileSync, statSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { isAbsolute, join } from 'path';
import { getHead, isAncestor, detectExternalCommits } from './git.js';
import { readState, writeState } from './state.js';
import { commitEvalReport, normalizeArtifactCommit } from './artifact.js';
import { checkGateSidecars } from './phases/gate.js';
import { readVerifyResult, isEvalReportValid } from './phases/verify.js';
import {
  runPhaseLoop,
  handleGateEscalation,
  handleVerifyEscalation,
  handleVerifyError,
} from './phases/runner.js';
import { InputManager } from './input.js';
import { NoopLogger } from './logger.js';
import { getGateRetryLimit, getPhaseArtifactFiles } from './config.js';
import { isValidChecklistSchema } from './phases/checklist.js';
import type { HarnessState, PhaseNumber } from './types.js';

/** Inline Complexity-section check (spec R5); mirrors `interactive.ts`. */
function specHasValidComplexity(specBody: string): boolean {
  // Spec Goal 1: "exactly one `## Complexity` section." Count matches first.
  const allHeaders = specBody.match(/^##\s+Complexity\s*$/gm);
  if (!allHeaders || allHeaders.length !== 1) return false;
  const headerMatch = specBody.match(/^##\s+Complexity\s*$/m);
  if (!headerMatch) return false;
  const offset = (headerMatch.index ?? 0) + headerMatch[0].length;
  const remainder = specBody.slice(offset);
  for (const rawLine of remainder.split('\n')) {
    const line = rawLine.trim();
    if (line === '') continue;
    return /^(small|medium|large)\b/i.test(line);
  }
  return false;
}

/** Create a no-op InputManager for use in resumeRun (deferred refactor: inputManager passed by inner.ts in future). */
function createNoOpInputManager(): InputManager {
  return new InputManager();
}

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

  // Step 6: General recovery — check for fresh sentinel / verify-result BEFORE re-entering loop
  await recoverGeneralState(state, harnessDir, runDir, cwd);

  // recoverGeneralState may have set a new pendingAction (e.g., Verify ERROR → show_verify_error).
  // Replay it before entering the phase loop.
  if (state.pendingAction !== null) {
    await replayPendingAction(state, harnessDir, runDir, cwd);
    return;
  }

  await runPhaseLoop(state, harnessDir, runDir, cwd, createNoOpInputManager(), new NoopLogger(), { value: false });
}

/**
 * Handle generic crash recovery for phases without pendingAction:
 * - Interactive in_progress/failed + fresh sentinel → complete inline (no respawn)
 * - Phase 6 in_progress + verify-result.json present → apply stored result
 */
async function recoverGeneralState(
  state: HarnessState,
  harnessDir: string,
  runDir: string,
  cwd: string
): Promise<void> {
  void harnessDir;
  const phase = state.currentPhase;
  const phaseKey = String(phase);
  const phaseStatus = state.phases[phaseKey];

  // Interactive phase in 'error' state with valid artifacts → retry normalize_artifact_commit
  // instead of respawning (which would delete the artifacts).
  if ((phase === 1 || phase === 3) && phaseStatus === 'error') {
    const completed = completeInteractivePhaseFromFreshSentinel(
      phase as PhaseNumber,
      state,
      cwd,
      runDir,
    );
    if (completed) {
      state.phases[phaseKey] = 'completed';
      state.currentPhase = phase + 1;
      writeState(runDir, state);
      return;
    }
    // Validation failed → abort with guidance; do NOT respawn (would erase artifacts)
    process.stderr.write(
      `Artifact validation failed for phase ${phase}. The artifact may have been modified or deleted.\n` +
      `Use 'harness jump ${phase}' to re-run from that phase.\n`
    );
    process.exit(1);
  }

  // Interactive phase with fresh sentinel → complete inline
  if (
    (phase === 1 || phase === 3 || phase === 5) &&
    (phaseStatus === 'in_progress' || phaseStatus === 'failed')
  ) {
    const sentinelPath = join(runDir, `phase-${phase}.done`);
    const expectedAttemptId = state.phaseAttemptId[phaseKey];

    if (existsSync(sentinelPath) && expectedAttemptId) {
      const content = readFileSync(sentinelPath, 'utf-8').trim();
      if (content === expectedAttemptId) {
        // Fresh sentinel — attempt inline completion
        try {
          const completed = completeInteractivePhaseFromFreshSentinel(
            phase as PhaseNumber,
            state,
            cwd,
            runDir,
          );
          if (completed) {
            state.phases[phaseKey] = 'completed';
            state.currentPhase = phase + 1;
            writeState(runDir, state);
          } else {
            // Artifact validation failed despite fresh sentinel.
            // This means artifacts are missing/invalid while sentinel is fresh.
            // Treat as stale sentinel — delete it, leave phase to be respawned.
            try {
              unlinkSync(sentinelPath);
            } catch { /* best-effort */ }
          }
        } catch (err) {
          // normalize_artifact_commit failure during resume: preserve artifacts + sentinel,
          // mark phase as error so user can inspect + `harness resume` to retry commit.
          // Critically: do NOT delete sentinel (reopening would erase Phase 1/3 artifacts).
          process.stderr.write(
            `Failed to commit Phase ${phase} artifact on resume: ${(err as Error).message}\n` +
            `Phase left in 'error' state; fix git state and run 'harness resume' to retry.\n`
          );
          state.phases[phaseKey] = 'error';
          writeState(runDir, state);
          process.exit(1);
        }
      }
    }
  }

  // Phase 6 in_progress + verify-result.json already written → apply stored result
  // This handles the crash window: verify ran, sidecar written, but state not yet advanced.
  if (phase === 6 && phaseStatus === 'in_progress') {
    const result = readVerifyResult(runDir);
    if (result !== null) {
      await applyStoredVerifyResult(result, state, runDir, cwd);
    }
  }

  // Phase 6 error + eval report exists → retry normalize_artifact_commit
  // (eval report was written, normalize failed, and we should retry the commit only)
  if (phase === 6 && phaseStatus === 'error') {
    const evalReportPath = join(cwd, state.artifacts.evalReport);
    if (isEvalReportValid(evalReportPath)) {
      try {
        commitEvalReport(state, cwd);
        const head = getHead(cwd);
        state.evalCommit = head;
        state.verifiedAtHead = head;
        state.phases['6'] = 'completed';
        state.currentPhase = 7;
        writeState(runDir, state);
        try { unlinkSync(join(runDir, 'verify-result.json')); } catch { /* best-effort */ }
        try { unlinkSync(join(runDir, 'verify-feedback.md')); } catch { /* best-effort */ }
      } catch (err) {
        process.stderr.write(
          `Phase 6 normalize_artifact_commit retry failed: ${(err as Error).message}\n` +
          `Fix git state and run 'harness resume' again.\n`
        );
        process.exit(1);
      }
    } else {
      // No eval report → Verify ERROR UI
      state.pendingAction = {
        type: 'show_verify_error',
        targetPhase: 6,
        sourcePhase: null,
        feedbackPaths: [],
      };
      writeState(runDir, state);
    }
  }
}

/**
 * Apply a stored verify-result.json outcome without re-running verify.
 * Handles the resume recovery matrix from the spec.
 */
async function applyStoredVerifyResult(
  result: { exitCode: number; hasSummary: boolean; timestamp: number },
  state: HarnessState,
  runDir: string,
  cwd: string
): Promise<void> {
  const evalReportPath = join(cwd, state.artifacts.evalReport);

  if (result.exitCode === 0 && isEvalReportValid(evalReportPath)) {
    // PASS: commit the eval report (normalize_artifact_commit), set anchors, advance
    try {
      commitEvalReport(state, cwd);
    } catch {
      // Commit failed — leave as error for runner to handle
      state.phases['6'] = 'error';
      writeState(runDir, state);
      return;
    }
    try {
      const head = getHead(cwd);
      state.evalCommit = head;
      state.verifiedAtHead = head;
    } catch { /* leave as-is */ }
    state.verifyRetries = 0;
    state.phases['6'] = 'completed';
    state.currentPhase = 7;
    writeState(runDir, state);
    // Delete sidecars AFTER state advance
    try { unlinkSync(join(runDir, 'verify-result.json')); } catch { /* best-effort */ }
    try { unlinkSync(join(runDir, 'verify-feedback.md')); } catch { /* best-effort */ }
  } else if (result.exitCode !== 0 && result.hasSummary) {
    // FAIL: increment verifyRetries. Check escalation threshold per spec.
    state.verifyRetries += 1;
    const retryCount = state.verifyRetries;
    const { VERIFY_RETRY_LIMIT } = await import('./config.js');

    const feedbackPath = join(runDir, 'verify-feedback.md');
    if (!existsSync(feedbackPath) && existsSync(evalReportPath)) {
      try {
        const content = readFileSync(evalReportPath, 'utf-8');
        const { writeFileSync } = await import('fs');
        writeFileSync(feedbackPath, content);
      } catch { /* best-effort */ }
    }

    if (retryCount >= VERIFY_RETRY_LIMIT && !state.autoMode) {
      // Escalation: pause with show_escalation pendingAction
      state.phases['6'] = 'failed';
      state.pendingAction = {
        type: 'show_escalation',
        targetPhase: 6,
        sourcePhase: 5,
        feedbackPaths: [feedbackPath],
      };
      state.status = 'paused';
      state.pauseReason = 'verify-escalation';
      writeState(runDir, state);
      try { unlinkSync(evalReportPath); } catch { /* best-effort */ }
    } else if (retryCount >= VERIFY_RETRY_LIMIT && state.autoMode) {
      // Auto-mode force-skip — delegate to runner's force-pass logic on next loop
      // Mark 6 as failed so runner detects verifyRetries >= limit and force-passes
      state.phases['6'] = 'failed';
      state.pendingAction = null;
      writeState(runDir, state);
      try { unlinkSync(evalReportPath); } catch { /* best-effort */ }
    } else {
      // Normal retry: reopen Phase 5
      state.pendingAction = {
        type: 'reopen_phase',
        targetPhase: 5,
        sourcePhase: 6,
        feedbackPaths: [feedbackPath],
      };
      state.phases['5'] = 'pending';
      state.phases['6'] = 'failed';
      state.currentPhase = 5;
      writeState(runDir, state);
      try { unlinkSync(evalReportPath); } catch { /* best-effort */ }
    }
  } else {
    // ERROR (exitCode != 0 && !hasSummary, OR exitCode==0 but eval report invalid):
    // Set Phase 6 to error + show_verify_error pendingAction so UI re-displays on loop re-entry
    state.phases['6'] = 'error';
    state.pendingAction = {
      type: 'show_verify_error',
      targetPhase: 6,
      sourcePhase: null,
      feedbackPaths: [],
    };
    writeState(runDir, state);
  }
}

function validateCompletedArtifacts(state: HarnessState, cwd: string): void {
  // Phase 1 completed: spec + decisionLog must exist and be non-empty
  if (state.phases['1'] === 'completed') {
    requireNonEmpty(join(cwd, state.artifacts.spec), 'spec', state.runId);
    requireNonEmpty(join(cwd, state.artifacts.decisionLog), 'decision log', state.runId);
    // Check spec is not modified since committed (decisionLog is gitignored — skip)
    requireCommittedClean(state.artifacts.spec, state.specCommit, cwd);
  }
  // Phase 3 completed: plan + checklist
  if (state.phases['3'] === 'completed') {
    requireNonEmpty(join(cwd, state.artifacts.plan), 'plan', state.runId);
    requireNonEmpty(join(cwd, state.artifacts.checklist), 'checklist', state.runId);
    // Validate checklist schema
    requireValidChecklist(join(cwd, state.artifacts.checklist));
    // Check plan is not modified since committed (checklist is gitignored — skip)
    requireCommittedClean(state.artifacts.plan, state.planCommit, cwd);
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
    requireCommittedClean(state.artifacts.evalReport, state.evalCommit, cwd);
  }
}

/**
 * Ensure the artifact has no uncommitted modifications relative to its recorded commit.
 * Per spec: `git diff <*Commit> -- <path>` must be empty.
 * Skips the check if no commit anchor is recorded (artifact might be gitignored).
 */
function requireCommittedClean(relPath: string, commit: string | null, cwd: string): void {
  if (commit === null) return;
  if (relPath.startsWith('.harness/')) return; // gitignored
  try {
    const diff = execSync(`git diff ${commit} -- "${relPath}"`, {
      cwd,
      encoding: 'utf-8',
    }).trim();
    if (diff.length > 0) {
      process.stderr.write(
        `Artifact ${relPath} has been modified since it was committed at ${commit}.\n` +
        `Commit changes first, or use 'harness jump N' to re-run from that phase.\n`
      );
      process.exit(1);
    }
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('__exit__')) throw err;
    // git error (e.g., commit doesn't exist) — skip (ancestry validation will catch this)
  }
}

/** Validate checklist.json matches the spec schema: `{ checks: [{ name, command }] }`. */
function requireValidChecklist(absPath: string): void {
  try {
    const raw = readFileSync(absPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.checks) || parsed.checks.length === 0) {
      throw new Error('checks array missing or empty');
    }
    for (const check of parsed.checks) {
      if (typeof check.name !== 'string' || typeof check.command !== 'string') {
        throw new Error('each check must have name (string) and command (string)');
      }
    }
  } catch (err) {
    const msg = (err as Error).message;
    process.stderr.write(
      `Checklist ${absPath} is invalid: ${msg}.\n` +
      `Use 'harness jump 3' to re-run planning.\n`
    );
    process.exit(1);
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
 *
 * Phase 5 success: HEAD has advanced past `implRetryBase`. No working-tree
 * cleanliness check (auto-recovery removed 2026-04-19). Reopen-zero-commit
 * is intentionally NOT accepted here because this helper runs only for
 * fresh-sentinel recovery (not the verify-failure reopen path).
 *
 * Returns true if the phase can be treated as completed.
 */
export function completeInteractivePhaseFromFreshSentinel(
  phase: PhaseNumber,
  state: HarnessState,
  cwd: string,
  runDir: string,
): boolean {
  try {
    if (phase === 1 || phase === 3) {
      // Check artifact existence + non-empty (reopen-aware: no mtime staleness check — see ADR-13)
      const artifactKeys = getPhaseArtifactFiles(state.flow, phase);
      if (artifactKeys.length === 0) return false;

      for (const key of artifactKeys) {
        const relPath = state.artifacts[key];
        if (!relPath) return false;
        const absPath = isAbsolute(relPath) ? relPath : join(cwd, relPath);
        if (!existsSync(absPath)) return false;
        const stat = statSync(absPath);
        if (stat.size === 0) return false;
      }

      // Phase 1 (both full + light flows): spec must contain a valid
      // `## Complexity` section (spec R5).
      if (phase === 1) {
        const specAbs = isAbsolute(state.artifacts.spec)
          ? state.artifacts.spec
          : join(cwd, state.artifacts.spec);
        try {
          const body = readFileSync(specAbs, 'utf-8');
          if (!specHasValidComplexity(body)) return false;
        } catch {
          return false;
        }
      }

      // Light + phase 1: checklist schema + '## Open Questions' + '## Implementation Plan' headers
      if (state.flow === 'light' && phase === 1) {
        const checklistAbs = isAbsolute(state.artifacts.checklist)
          ? state.artifacts.checklist
          : join(cwd, state.artifacts.checklist);
        if (!isValidChecklistSchema(checklistAbs)) return false;

        const specAbs = isAbsolute(state.artifacts.spec)
          ? state.artifacts.spec
          : join(cwd, state.artifacts.spec);
        try {
          const body = readFileSync(specAbs, 'utf-8');
          if (!/^##\s+Open\s+Questions\s*$/m.test(body)) return false;
          if (!/^##\s+Implementation\s+Plan\s*$/m.test(body)) return false;
        } catch {
          return false;
        }
      }

      // Run normalize_artifact_commit for non-gitignored artifacts
      for (const key of artifactKeys) {
        const relPath = state.artifacts[key];
        if (!relPath) continue;
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
      void runDir;
      const head = getHead(cwd);
      if (head === state.implRetryBase) {
        return false;
      }
      state.implCommit = head;
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * Replay phase-specific skip side effects idempotently for crash recovery.
 * Each phase's skip is safe to re-run: no-op if already applied.
 */
async function replayIncompleteSkip(
  phase: PhaseNumber,
  state: HarnessState,
  runDir: string,
  cwd: string
): Promise<void> {
  const { normalizeArtifactCommit: commit } = await import('./artifact.js');
  switch (phase) {
    case 1: {
      const specPath = join(cwd, state.artifacts.spec);
      if (existsSync(specPath)) {
        commit(state.artifacts.spec, `harness[${state.runId}]: Phase 1 — spec (skip)`, cwd);
        state.specCommit = getHead(cwd);
      }
      break;
    }
    case 3: {
      const planPath = join(cwd, state.artifacts.plan);
      if (existsSync(planPath)) {
        commit(state.artifacts.plan, `harness[${state.runId}]: Phase 3 — plan (skip)`, cwd);
        state.planCommit = getHead(cwd);
      }
      break;
    }
    case 5: {
      // Phase 5 skip: implCommit stays null
      state.implCommit = null;
      break;
    }
    case 6: {
      const evalReportPath = join(cwd, state.artifacts.evalReport);
      if (!existsSync(evalReportPath)) {
        // Generate synthetic report if missing
        const { writeFileSync, unlinkSync: u } = await import('fs');
        try { u(join(runDir, 'verify-feedback.md')); } catch { /* best-effort */ }
        const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
        const report =
          `# Verification Report (SKIPPED)\n` +
          `- Date: ${timestamp}\n` +
          `- Run ID: ${state.runId}\n\n` +
          `## Results\n\n| Check | Status |\n|-------|--------|\n| (skipped) | SKIPPED |\n\n` +
          `## Summary\n\nVERIFY SKIPPED\n`;
        writeFileSync(evalReportPath, report, 'utf-8');
      }
      commit(state.artifacts.evalReport, `harness[${state.runId}]: Phase 6 — eval report (skip)`, cwd);
      state.evalCommit = getHead(cwd);
      state.verifiedAtHead = getHead(cwd);
      break;
    }
    case 2:
    case 4:
    case 7:
      // Gate skips have no artifact side effects
      break;
  }
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
            cwd,
            runDir,
          );
          if (completed) {
            state.pendingAction = null;
            state.phases[targetPhaseKey] = 'completed';
            state.currentPhase = action.targetPhase + 1;
            writeState(runDir, state);
            // Continue phase loop from the next phase
            await runPhaseLoop(state, harnessDir, runDir, cwd, createNoOpInputManager(), new NoopLogger(), { value: false });
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
      const targetKey = String(action.targetPhase);
      if (state.phases[targetKey] === 'completed') {
        // Already completed — just clear pendingAction
        state.pendingAction = null;
        writeState(runDir, state);
      } else {
        // Re-run idempotent skip side effects for the target phase, then mark completed.
        // Phase-specific skip handlers are idempotent (no-op when already applied).
        await replayIncompleteSkip(action.targetPhase, state, runDir, cwd);
        state.phases[targetKey] = 'completed';
        state.currentPhase = action.targetPhase + 1;
        if (action.targetPhase === 7) state.status = 'completed';
        state.pendingAction = null;
        writeState(runDir, state);
      }
      break;
    }
    case 'show_escalation': {
      // Route by pauseReason (authoritative): gate-escalation vs verify-escalation.
      // show_escalation.targetPhase is the rejected gate (2/4/7) for gate escalation,
      // or Phase 6 for verify escalation.
      const wasVerifyEscalation = state.pauseReason === 'verify-escalation';

      state.status = 'in_progress';
      state.pendingAction = null;
      writeState(runDir, state);

      // Load feedback content for gate handler
      let comments = '';
      if (action.feedbackPaths.length > 0) {
        try {
          const raw = readFileSync(action.feedbackPaths[0], 'utf-8');
          const marker = '## Reviewer Comments\n\n';
          const idx = raw.indexOf(marker);
          comments = idx >= 0 ? raw.slice(idx + marker.length).trimEnd() : raw;
        } catch { /* best-effort */ }
      }

      if (wasVerifyEscalation) {
        const feedbackPath = action.feedbackPaths[0] ?? join(runDir, 'verify-feedback.md');
        await handleVerifyEscalation(feedbackPath, state, runDir, cwd, createNoOpInputManager(), new NoopLogger());
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
          createNoOpInputManager(),
          new NoopLogger(),
        );
      }
      if ((state.status as string) === 'paused') return;
      await runPhaseLoop(state, harnessDir, runDir, cwd, createNoOpInputManager(), new NoopLogger(), { value: false });
      return;
    }
    case 'show_verify_error': {
      state.status = 'in_progress';
      state.pendingAction = null;
      writeState(runDir, state);

      const errorPath = action.feedbackPaths[0] ?? undefined;
      await handleVerifyError(errorPath, state, harnessDir, runDir, cwd, createNoOpInputManager(), new NoopLogger());
      if ((state.status as string) === 'paused') return;
      await runPhaseLoop(state, harnessDir, runDir, cwd, createNoOpInputManager(), new NoopLogger(), { value: false });
      return;
    }
    case 'reopen_config': {
      // Clear pendingAction — model selection will restart in inner.ts
      state.pendingAction = null;
      state.status = 'in_progress';
      state.pauseReason = null;
      writeState(runDir, state);
      break;
    }
  }

  // After pendingAction handling, continue phase loop
  await runPhaseLoop(state, harnessDir, runDir, cwd, createNoOpInputManager(), new NoopLogger(), { value: false });
}
