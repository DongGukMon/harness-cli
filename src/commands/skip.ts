import { execSync } from 'child_process';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { getGitRoot, getHead, isWorkingTreeClean } from '../git.js';
import { acquireLock, releaseLock } from '../lock.js';
import { getPreflightItems, runPreflight } from '../preflight.js';
import { findHarnessRoot, getCurrentRun } from '../root.js';
import { readState, writeState } from '../state.js';
import { normalizeArtifactCommit } from '../artifact.js';
import { runPhaseLoop } from '../phases/runner.js';
import type { HarnessState, PendingAction, PhaseNumber, PhaseType } from '../types.js';

export interface SkipOptions {
  root?: string;
}

function phaseType(phase: number): PhaseType {
  if (phase === 1 || phase === 3 || phase === 5) return 'interactive';
  if (phase === 2 || phase === 4) return 'gate';
  if (phase === 7) return 'terminal';
  if (phase === 6) return 'verify';
  return 'ui_only';
}

export async function skipCommand(options: SkipOptions = {}): Promise<void> {
  // 1. Resolve harnessDir + runId
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

  // 2. Validate run.status
  if (state.status === 'paused') {
    process.stderr.write(`Cannot skip: run is paused. Use 'harness resume' first.\n`);
    process.exit(1);
  }
  if (state.status === 'completed') {
    process.stderr.write(`Cannot skip: run is completed. Use 'harness jump N' to re-run a phase.\n`);
    process.exit(1);
  }

  const cwd = options.root ?? getGitRoot();
  const phase = state.currentPhase as PhaseNumber;

  // 3. Acquire lock
  acquireLock(harnessDir, runId);

  try {
    // 4. Clear stale pendingAction/pauseReason
    state.pendingAction = null;
    state.pauseReason = null;

    // 5. Validate required inputs for current phase
    validateRequiredInputs(phase, state, cwd);

    // 6. Determine next phase type and run its preflight
    // After skip, next phase is phase+1
    const nextPhaseNum = phase + 1;
    const nextType = phaseType(nextPhaseNum > 7 ? 7 : nextPhaseNum);
    // If skipping Phase 7, next is terminal (no subprocess)
    const preflightType = phase === 7 ? 'terminal' : nextType;
    runPreflight(getPreflightItems(preflightType), cwd);

    // 7. Write pendingAction = skip_phase atomically BEFORE side effects
    const pendingAction: PendingAction = {
      type: 'skip_phase',
      targetPhase: phase,
      sourcePhase: null,
      feedbackPaths: [],
    };
    state.pendingAction = pendingAction;
    writeState(runDir, state);

    // 8. Execute phase-specific skip side effects
    await executeSkipSideEffects(phase, state, harnessDir, runDir, cwd);

    // 9. Advance state
    state.phases[String(phase)] = 'completed';
    state.currentPhase = phase + 1;
    if (phase === 7) {
      state.status = 'completed';
    }
    state.pendingAction = null;
    state.pausedAtHead = getHead(cwd);
    writeState(runDir, state);

    // 10. Continue phase loop unless terminal
    if (phase < 7 && state.status === 'in_progress') {
      await runPhaseLoop(state, harnessDir, runDir, cwd);
    }
  } finally {
    releaseLock(harnessDir, runId);
  }
}

function validateRequiredInputs(phase: PhaseNumber, state: HarnessState, cwd: string): void {
  const checkFile = (relPath: string, label: string) => {
    const p = join(cwd, relPath);
    if (!existsSync(p)) {
      process.stderr.write(`Error: Phase ${phase} skip requires ${label} (${relPath}) to exist.\n`);
      process.exit(1);
    }
  };

  switch (phase) {
    case 1:
      checkFile(state.artifacts.spec, 'spec');
      checkFile(state.artifacts.decisionLog, 'decisions');
      break;
    case 2:
      checkFile(state.artifacts.spec, 'spec');
      break;
    case 3:
      checkFile(state.artifacts.plan, 'plan');
      checkFile(state.artifacts.checklist, 'checklist');
      break;
    case 4:
      checkFile(state.artifacts.spec, 'spec');
      checkFile(state.artifacts.plan, 'plan');
      break;
    case 5: {
      // Working tree must be clean and no impl commits since implRetryBase
      if (!isWorkingTreeClean(cwd)) {
        process.stderr.write(
          `Error: Phase 5 skip requires clean working tree. Commit or stash changes first.\n`
        );
        process.exit(1);
      }
      try {
        const commits = execSync(`git log ${state.implRetryBase}..HEAD --oneline`, {
          cwd,
          encoding: 'utf-8',
        }).trim();
        if (commits.length > 0) {
          process.stderr.write(
            `Error: Cannot skip Phase 5: implementation commits already exist.\n` +
            `Use 'harness resume' to complete or 'harness jump 5' to restart.\n`
          );
          process.exit(1);
        }
      } catch (err) {
        const msg = (err as Error).message || '';
        if (msg.includes('__exit__')) throw err;
        // Non-exit git error: continue
      }
      break;
    }
    case 6: {
      if (!isWorkingTreeClean(cwd)) {
        process.stderr.write(
          `Error: Phase 6 skip requires clean working tree. Commit or stash changes first.\n`
        );
        process.exit(1);
      }
      break;
    }
    case 7:
      checkFile(state.artifacts.spec, 'spec');
      checkFile(state.artifacts.plan, 'plan');
      checkFile(state.artifacts.evalReport, 'eval report');
      break;
  }
}

async function executeSkipSideEffects(
  phase: PhaseNumber,
  state: HarnessState,
  harnessDir: string,
  runDir: string,
  cwd: string
): Promise<void> {
  switch (phase) {
    case 1: {
      const specPath = join(cwd, state.artifacts.spec);
      const decisionsPath = join(cwd, state.artifacts.decisionLog);
      normalizeArtifactCommit(specPath, `harness[${state.runId}]: Phase 1 — spec (skip)`, cwd);
      // decisionLog is in .harness/ (gitignored) — no commit needed
      state.specCommit = getHead(cwd);
      break;
    }
    case 3: {
      const planPath = join(cwd, state.artifacts.plan);
      normalizeArtifactCommit(planPath, `harness[${state.runId}]: Phase 3 — plan (skip)`, cwd);
      state.planCommit = getHead(cwd);
      break;
    }
    case 5: {
      // Phase 5 skip: implCommit stays null (no impl commits)
      state.implCommit = null;
      break;
    }
    case 6: {
      // Delete stale verify-feedback.md before synthetic report
      const feedbackPath = join(runDir, 'verify-feedback.md');
      try {
        unlinkSync(feedbackPath);
      } catch {
        // best-effort
      }

      // Generate synthetic eval report
      const evalReportPath = join(cwd, state.artifacts.evalReport);
      const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const report =
        `# Verification Report (SKIPPED)\n` +
        `- Date: ${timestamp}\n` +
        `- Run ID: ${state.runId}\n` +
        `- Related Spec: ${state.artifacts.spec}\n` +
        `- Related Plan: ${state.artifacts.plan}\n\n` +
        `## Results\n\n` +
        `| Check | Status | Output |\n` +
        `|-------|--------|--------|\n` +
        `| (skipped) | SKIPPED | — |\n\n` +
        `## Summary\n\n` +
        `VERIFY SKIPPED — no checks were run. This eval gate review is based on code diff and spec/plan review only.\n`;
      writeFileSync(evalReportPath, report, 'utf-8');

      normalizeArtifactCommit(
        evalReportPath,
        `harness[${state.runId}]: Phase 6 — eval report (skip)`,
        cwd
      );
      state.evalCommit = getHead(cwd);
      state.verifiedAtHead = getHead(cwd);
      break;
    }
    case 2:
    case 4:
    case 7: {
      // Gate skip: no artifacts — just state advance
      break;
    }
  }
}
