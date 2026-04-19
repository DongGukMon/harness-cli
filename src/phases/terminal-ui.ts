import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import type {
  HarnessState,
  InteractivePhase,
  PhaseStatus,
  SessionLogger,
} from '../types.js';
import type { InputManager } from '../input.js';
import { writeState, invalidatePhaseSessionsOnJump } from '../state.js';
import { renderControlPanel, printError, printInfo, printWarning } from '../ui.js';

export function anyPhaseFailed(state: HarnessState): boolean {
  return Object.values(state.phases).some(s => s === 'failed' || s === 'error');
}

function findFailedPhase(state: HarnessState): number | null {
  for (const key of Object.keys(state.phases)) {
    const s = state.phases[key];
    if (s === 'failed' || s === 'error') return Number(key);
  }
  return null;
}

function listJumpTargets(state: HarnessState): InteractivePhase[] {
  const interactiveKeys = (state.flow === 'light'
    ? ['1', '5'] : ['1', '3', '5']) as ('1' | '3' | '5')[];
  return interactiveKeys
    .filter(k => state.phases[k] !== 'skipped')
    .map(k => Number(k) as InteractivePhase);
}

function summarizeRecentEvents(runDir: string, limit = 10): string {
  const eventsPath = path.join(runDir, 'events.jsonl');
  try {
    const body = fs.readFileSync(eventsPath, 'utf-8').trimEnd();
    if (body.length === 0) return '(no events recorded)';
    const lines = body.split('\n');
    return lines.slice(-limit).join('\n');
  } catch {
    return '(events.jsonl not present — logging disabled)';
  }
}

function summarizeGitStatus(cwd: string, headLines = 10): string {
  try {
    const out = execSync('git status --porcelain', { cwd, encoding: 'utf-8' }).trimEnd();
    if (out.length === 0) return '(working tree clean)';
    const lines = out.split('\n');
    if (lines.length <= headLines) return out;
    return [...lines.slice(0, headLines), `… and ${lines.length - headLines} more`].join('\n');
  } catch {
    return '(git not available)';
  }
}

/**
 * Inner-process resume: reset the failed phase back to `pending` and re-enter
 * runPhaseLoop. Throws on fatal error; caller in terminal-ui catches and
 * re-renders.
 */
export async function performResume(
  state: HarnessState,
  harnessDir: string,
  runDir: string,
  cwd: string,
  inputManager: InputManager,
  logger: SessionLogger,
  sidecarReplayAllowed: { value: boolean },
): Promise<void> {
  const failed = findFailedPhase(state);
  if (failed !== null) {
    state.phases[String(failed)] = 'pending';
  }
  // Clear the run-level paused fields if anything left them set.
  state.status = 'in_progress';
  state.pauseReason = null;
  writeState(runDir, state);

  const { runPhaseLoop } = await import('./runner.js');
  await runPhaseLoop(state, harnessDir, runDir, cwd, inputManager, logger, sidecarReplayAllowed);
}

/**
 * Inner-process jump: reset phases ≥ target to pending (preserve `skipped`),
 * invalidate gate sessions at/after target, set currentPhase, re-enter loop.
 */
export async function performJump(
  targetPhase: InteractivePhase,
  state: HarnessState,
  harnessDir: string,
  runDir: string,
  cwd: string,
  inputManager: InputManager,
  logger: SessionLogger,
): Promise<void> {
  if (state.phases[String(targetPhase)] === 'skipped') {
    throw new Error(
      `Phase ${targetPhase} is skipped in this run (flow=${state.flow}); cannot jump to a skipped phase.`,
    );
  }

  for (let m = targetPhase; m <= 7; m++) {
    const cur = state.phases[String(m)] as PhaseStatus | undefined;
    state.phases[String(m)] = cur === 'skipped' ? 'skipped' : 'pending';
  }
  state.currentPhase = targetPhase;
  state.status = 'in_progress';
  state.pauseReason = null;
  state.pendingAction = null;
  invalidatePhaseSessionsOnJump(state, targetPhase, runDir);
  writeState(runDir, state);

  const { runPhaseLoop } = await import('./runner.js');
  // sidecarReplayAllowed always false on jump (we're starting fresh).
  await runPhaseLoop(state, harnessDir, runDir, cwd, inputManager, logger, { value: false });
}

/**
 * Failed terminal state: render panel, show recent events + git status,
 * loop on R/J/Q. R/J re-enter runPhaseLoop in-place; Q returns.
 */
export async function enterFailedTerminalState(
  state: HarnessState,
  harnessDir: string,
  runDir: string,
  cwd: string,
  inputManager: InputManager,
  logger: SessionLogger,
): Promise<void> {
  const sidecarReplayAllowed = { value: false };

  while (true) {
    renderControlPanel(state);

    const failedPhase = findFailedPhase(state);
    if (failedPhase !== null) {
      printError(`Phase ${failedPhase} failed.`);
    } else {
      printWarning('No failed phase detected (defensive).');
    }

    process.stderr.write('\nRecent events:\n');
    process.stderr.write(summarizeRecentEvents(runDir) + '\n');
    process.stderr.write('\nWorking tree:\n');
    process.stderr.write(summarizeGitStatus(cwd) + '\n');
    process.stderr.write('\n[R] Resume   [J] Jump to phase   [Q] Quit\n');

    const choice = await inputManager.waitForKey(new Set(['r', 'j', 'q']));

    if (choice === 'Q') return;

    if (choice === 'R') {
      try {
        await performResume(state, harnessDir, runDir, cwd, inputManager, logger, sidecarReplayAllowed);
      } catch (err) {
        printError(`Resume failed: ${(err as Error).message}`);
        continue;
      }
      // runPhaseLoop returned. If it succeeded or paused, exit terminal-ui;
      // if a fresh failure surfaced, loop again.
      if (state.status === 'completed' || state.status === 'paused') return;
      if (!anyPhaseFailed(state)) return;
      continue;
    }

    // 'J' branch
    const targets = listJumpTargets(state);
    if (targets.length === 0) {
      printError('No interactive phases available to jump to.');
      continue;
    }
    const targetKeys = new Set(targets.map(t => String(t)));
    process.stderr.write(`\nJump to which phase? (${targets.join(' / ')})\n`);
    const phaseKey = await inputManager.waitForKey(targetKeys);
    const target = Number(phaseKey) as InteractivePhase;

    try {
      await performJump(target, state, harnessDir, runDir, cwd, inputManager, logger);
    } catch (err) {
      printError(`Jump failed: ${(err as Error).message}`);
      continue;
    }
    if (state.status === 'completed' || state.status === 'paused') return;
    if (!anyPhaseFailed(state)) return;
  }
}

/**
 * Complete terminal state: render summary panel, idle until the abort signal
 * fires (caller wires AbortSignal to SIGINT). Footer ticker keeps running.
 */
export async function enterCompleteTerminalState(
  state: HarnessState,
  runDir: string,
  cwd: string,
  logger: SessionLogger,
  abortSignal?: AbortSignal,
): Promise<void> {
  void cwd;
  renderControlPanel(state);

  process.stderr.write('\n');
  printInfo('Run complete.');
  process.stderr.write(`  Eval report: ${state.artifacts.evalReport}\n`);
  if (state.baseCommit && state.evalCommit) {
    process.stderr.write(`  Commits:     ${state.baseCommit.slice(0, 7)}..${state.evalCommit.slice(0, 7)}\n`);
  }
  const startedAt = logger.getStartedAt();
  const wallSec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  process.stderr.write(`  Wall time:   ${Math.floor(wallSec / 60)}m ${String(wallSec % 60).padStart(2, '0')}s\n`);
  process.stderr.write('\nPress Ctrl+C to exit.\n');

  if (abortSignal !== undefined) {
    if (abortSignal.aborted) return;
    await new Promise<void>((resolve) => {
      abortSignal.addEventListener('abort', () => resolve(), { once: true });
    });
    return;
  }

  await new Promise<void>((resolve) => {
    process.once('SIGINT', () => resolve());
  });
  void runDir;
}
