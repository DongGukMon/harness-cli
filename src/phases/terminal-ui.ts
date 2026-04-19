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
import { renderControlPanel, printError, printInfo } from '../ui.js';

export function anyPhaseFailed(state: HarnessState): boolean {
  return Object.values(state.phases).some(s => s === 'failed' || s === 'error');
}

// Sort numerically so "lowest-numbered failed phase" doesn't depend on V8's
// integer-like key enumeration order (which a JSON round-trip could disturb).
export function findFailedPhase(state: HarnessState): number | null {
  const sortedKeys = Object.keys(state.phases).sort((a, b) => Number(a) - Number(b));
  for (const key of sortedKeys) {
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

function fastClaudeFailureHint(eventsPath: string): string | null {
  try {
    const raw = fs.readFileSync(eventsPath, 'utf-8');
    const lines = raw.trimEnd().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      let ev: any;
      try { ev = JSON.parse(lines[i]); } catch { continue; }
      if (ev.event !== 'phase_end' || ev.status !== 'failed') continue;
      const tokens = ev.claudeTokens;
      const dur = ev.durationMs ?? 0;
      const zeroObj = tokens && typeof tokens === 'object' && tokens.total === 0;
      const nullToken = tokens === null;
      if ((zeroObj || nullToken) && dur < 30_000) {
        return [
          'Hint: Claude exited within ' + Math.round(dur / 1000) + 's with no assistant output.',
          'Common causes: folder-trust dialog blocking the workspace pane, immediate crash,',
          'or the Claude binary failing to launch. Check the workspace tmux pane for a dialog',
          'before pressing [R] (a fresh attempt will hit the same wall).',
        ].join('\n');
      }
      return null;
    }
  } catch { /* file missing or unreadable */ }
  return null;
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
  if (failed === null) {
    throw new Error('performResume called with no failed phase — caller should gate via anyPhaseFailed');
  }
  state.phases[String(failed)] = 'pending';
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
    renderControlPanel(state, logger, 'terminal-failed');

    const failedPhase = findFailedPhase(state);
    if (failedPhase !== null) {
      printError(`Phase ${failedPhase} failed.`);
    }
    // else: unreachable — anyPhaseFailed gates entry; asserted via tests.

    process.stderr.write('\nRecent events:\n');
    process.stderr.write(summarizeRecentEvents(runDir) + '\n');

    const hint = fastClaudeFailureHint(path.join(runDir, 'events.jsonl'));
    if (hint !== null) {
      process.stderr.write('\n' + hint + '\n');
    }

    process.stderr.write('\nWorking tree:\n');
    process.stderr.write(summarizeGitStatus(cwd) + '\n');
    process.stderr.write('\n[R] Resume   [J] Jump to phase   [Q] Quit\n');

    const choice = await inputManager.waitForKey(new Set(['r', 'j', 'q']));
    const fromPhase = findFailedPhase(state) ?? state.currentPhase;

    if (choice === 'Q') {
      logger.logEvent({ event: 'terminal_action', action: 'quit', fromPhase });
      return;
    }

    if (choice === 'R') {
      logger.logEvent({ event: 'terminal_action', action: 'resume', fromPhase });
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
    logger.logEvent({ event: 'terminal_action', action: 'jump', fromPhase, targetPhase: target });

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
  _runDir: string,
  _cwd: string,
  logger: SessionLogger,
  abortSignal?: AbortSignal,
): Promise<void> {
  renderControlPanel(state, logger, 'terminal-complete');

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

  // Fallback path: no AbortSignal supplied. Production callers (inner.ts)
  // always pass a signal, but this branch keeps the helper usable from
  // ad-hoc scripts / future callers without forcing them to wire one up.
  // NOTE: the SIGINT handler is registered via `once`, so it auto-removes
  // on fire — but if the caller resolves through some other path before
  // SIGINT, the listener leaks until the process exits. This is acceptable
  // because the helper is only invoked at terminal state.
  await new Promise<void>((resolve) => {
    process.once('SIGINT', () => resolve());
  });
}
