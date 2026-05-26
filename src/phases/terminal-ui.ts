import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import type {
  HarnessState,
  PhaseNumber,
  PhaseStatus,
  SessionLogger,
} from '../types.js';
import { InputManager } from '../input.js';
import { writeState, invalidatePhaseSessionsOnJump } from '../state.js';
import { renderControlPanel, printError, printInfo } from '../ui.js';
import { isPidAlive, isSameProcessInstance } from '../process.js';
import type { WorkerLiveness } from '../ink/store.js';

// #117 Bug A: file-based action channel.
// Supervisor / external automation drops a one-line file into the run dir
// containing the action to inject: `R`, `Q`, or `J:<phase>`. `enterFailedTerminalState`
// polls for the file every TERMINAL_ACTION_POLL_MS and, when present, parses
// the body, deletes the file atomically, and fires the same code path as the
// matching keystroke — with `terminal_action.source = 'signal'` so retro tools
// can distinguish injected actions from user keypresses.
//
// Why this exists: when the harness's Ink TUI is the foreground program in a
// tmux pane, `tmux send-keys -t <pane> R` is silently dropped — the keystroke
// hits the underlying TTY but never reaches Ink's input loop. Without this
// channel, supervisor automation cannot reliably steer a failed-terminal run.
export const TERMINAL_ACTION_FILE = 'terminal-action.requested';
const TERMINAL_ACTION_POLL_MS = 500;

type SignalAction =
  | { kind: 'resume' }
  | { kind: 'quit' }
  | { kind: 'jump'; phase: PhaseNumber };

/**
 * Parse a `terminal-action.requested` body into a SignalAction. Returns null
 * on any malformed input — caller deletes the file and continues waiting.
 * Accepts `R`, `Q`, `J:<n>` (n in 1..7) — case-insensitive, whitespace-trimmed.
 */
function parseSignalAction(body: string): SignalAction | null {
  const t = body.trim().toUpperCase();
  if (t === 'R') return { kind: 'resume' };
  if (t === 'Q') return { kind: 'quit' };
  if (t.startsWith('J:')) {
    const phaseStr = t.slice(2);
    const n = Number(phaseStr);
    if (!Number.isInteger(n) || n < 1 || n > 7) return null;
    return { kind: 'jump', phase: n as PhaseNumber };
  }
  return null;
}

/**
 * Race a `waitForKey()` call against a poll of the signal file. Returns either
 * a key result OR a parsed signal action. If the signal file's body is malformed
 * (returns null from parseSignalAction), the file is deleted and the poll keeps
 * running — the keystroke path stays active throughout. The validKeys are passed
 * straight through to InputManager; the poll uses TERMINAL_ACTION_POLL_MS.
 */
async function waitForKeyOrSignal(
  inputManager: InputManager,
  validKeys: Set<string>,
  runDir: string,
): Promise<{ kind: 'key'; key: string } | { kind: 'signal'; action: SignalAction }> {
  const filePath = path.join(runDir, TERMINAL_ACTION_FILE);

  return new Promise((resolve, reject) => {
    let settled = false;

    const interval = setInterval(() => {
      let body: string;
      try { body = fs.readFileSync(filePath, 'utf-8'); } catch { return; }
      // Best-effort atomic consume: unlink first so a concurrent supervisor
      // writer can't have its action overwritten between our parse + the next
      // poll. If unlink fails, treat the file as absent (next poll re-checks).
      try { fs.unlinkSync(filePath); } catch { /* race: deleted under us */ }
      const action = parseSignalAction(body);
      if (action === null) {
        // Garbage body → file already deleted above; continue polling.
        return;
      }
      if (settled) return;
      settled = true;
      clearInterval(interval);
      inputManager.cancelWaitForKey();
      resolve({ kind: 'signal', action });
    }, TERMINAL_ACTION_POLL_MS);

    inputManager.waitForKey(validKeys).then((key) => {
      if (key === InputManager.CANCEL_SENTINEL) return; // cancelled by signal branch
      if (settled) return;
      settled = true;
      clearInterval(interval);
      resolve({ kind: 'key', key });
    }, (err) => {
      if (settled) return;
      settled = true;
      clearInterval(interval);
      reject(err);
    });
  });
}

/**
 * Issue #116 B1 — compute the workspace-pane worker liveness once at
 * terminal-failed entry. Uses the same PID-recycling guard as the SIGUSR1
 * kill path (`signal.ts`) so a long-dead PID whose slot was reused does
 * not surface as "alive". Returns undefined when no last PID is tracked
 * (e.g. interactive phase that never spawned a worker — nothing useful
 * to signal).
 */
function computeWorkerLiveness(state: HarnessState): WorkerLiveness | undefined {
  const pid = state.lastWorkspacePid;
  if (pid === null) return undefined;
  if (!isPidAlive(pid)) return 'dead';
  if (!isSameProcessInstance(pid, state.lastWorkspacePidStartTime)) {
    // Same PID number, different process instance — treat as dead so the
    // operator doesn't think they'll lose work pressing [R].
    return 'dead';
  }
  return 'alive';
}

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

// Targets = non-skipped phases ≤ failedPhase. Gate phases (2/4/7) and the
// verify phase (6) are valid jump targets because each gate/verify attempt
// spawns its own session (and `invalidatePhaseSessionsOnJump` clears the
// at-or-after sidecars), so the user can re-run any prior phase that owns
// an independent runner invocation. Forward jumps are deliberately excluded:
// the failed phase still needs to complete — that is what `[R] Resume` /
// `phase-harness skip` are for.
function listJumpTargets(state: HarnessState, failedPhase: number): PhaseNumber[] {
  const targets: PhaseNumber[] = [];
  for (let n = 1 as PhaseNumber; n <= failedPhase; n = (n + 1) as PhaseNumber) {
    const status = state.phases[String(n)];
    if (status === undefined || status === 'skipped') continue;
    targets.push(n);
  }
  return targets;
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

  try {
    const { runPhaseLoop } = await import('./runner.js');
    await runPhaseLoop(state, harnessDir, runDir, cwd, inputManager, logger, sidecarReplayAllowed);
  } catch (err) {
    // Rollback: restore phases[failed]='failed' so the failed-terminal-UI loop
    // can re-enter on the next R press. Without this, phases[failed]='pending'
    // remains on disk, findFailedPhase returns null on the next resume, and every
    // subsequent R press throws "performResume called with no failed phase"
    // in an unrecoverable cycle. Observed in 0.3.0/0.3.2 when runner.js lazy
    // import fails because the installed module was removed under a long-running
    // inner process.
    state.phases[String(failed)] = 'failed';
    writeState(runDir, state);
    try {
      logger.logEvent({
        event: 'resume_error',
        phase: failed,
        message: (err as Error)?.message ?? String(err),
      });
    } catch { /* logger must not mask the original error */ }
    throw err;
  }
}

/**
 * Inner-process jump: reset phases ≥ target to pending (preserve `skipped`),
 * invalidate gate sessions at/after target, set currentPhase, re-enter loop.
 */
export async function performJump(
  targetPhase: PhaseNumber,
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
    // Compute worker liveness once per loop iteration — the operator is
    // about to pick an action so a single snapshot is the right granularity
    // (per design constraint: pure rendering signal, no long-running polling).
    const workerLiveness = computeWorkerLiveness(state);
    renderControlPanel(state, logger, 'terminal-failed', workerLiveness);

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

    const dispatch = await waitForKeyOrSignal(inputManager, new Set(['r', 'j', 'q']), runDir);
    const fromPhase = findFailedPhase(state) ?? state.currentPhase;

    // Reduce the dispatched event into (choice, source) — keystroke and signal
    // share the rest of the R/J/Q code paths but emit distinct `source` labels.
    const source: 'user-key' | 'signal' = dispatch.kind === 'signal' ? 'signal' : 'user-key';
    let choice: 'R' | 'J' | 'Q';
    let signalJumpTarget: PhaseNumber | null = null;
    if (dispatch.kind === 'key') {
      choice = dispatch.key as 'R' | 'J' | 'Q';
    } else {
      if (dispatch.action.kind === 'resume') choice = 'R';
      else if (dispatch.action.kind === 'quit') choice = 'Q';
      else { choice = 'J'; signalJumpTarget = dispatch.action.phase; }
    }

    if (choice === 'Q') {
      logger.logEvent({ event: 'terminal_action', action: 'quit', fromPhase, source });
      return;
    }

    if (choice === 'R') {
      // #116 B3: when a workspace worker is still alive, `respawnPane()`
      // (called via performResume → runPhaseLoop) will SIGKILL it together
      // with any in-progress child (e.g. a long-running codex subtask). Show
      // an Ink Y/N confirmation BEFORE proceeding so the operator can't
      // silently lose mid-flight work. Dead / undefined liveness skips this
      // branch entirely — byte-identical to the pre-B3 R path.
      //
      // #117 Bug A: file-channel signals deliberately bypass the Y/N prompt.
      // The supervisor has no way to answer it (their channel is one-shot
      // file-drop), and the very reason the supervisor invoked R is that it
      // already decided the worker should be killed. Treat signal R with an
      // alive worker as an implicit confirmedKill — same outcome the operator
      // would produce by pressing Y, but recorded with source='signal'.
      let confirmedKill: boolean | undefined;
      if (workerLiveness === 'alive') {
        if (source === 'signal') {
          confirmedKill = true;
        } else {
          renderControlPanel(state, logger, 'terminal-failed-confirm-kill', workerLiveness);
          const confirm = await inputManager.waitForKey(new Set(['y', 'n']));
          if (confirm === 'N') {
            // Bail out without emitting a terminal_action — N is neither
            // "confirmed kill" nor a blind press; it's a no-op. Re-enter the
            // loop and re-render the R/J/Q action menu.
            continue;
          }
          confirmedKill = true;
        }
      }

      logger.logEvent(
        confirmedKill === true
          ? { event: 'terminal_action', action: 'resume', fromPhase, confirmedKill: true, source }
          : { event: 'terminal_action', action: 'resume', fromPhase, source },
      );
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
    const targets = listJumpTargets(state, fromPhase);
    if (targets.length === 0) {
      printError('No phases available to jump to.');
      continue;
    }
    let target: PhaseNumber;
    if (signalJumpTarget !== null) {
      // #117 Bug A: signal already specified the target — validate against the
      // dynamic target list and drop silently on out-of-range / skipped. The
      // file has already been deleted by the poller; the next poll iteration
      // (after re-rendering the R/J/Q menu) will see no file.
      if (!targets.includes(signalJumpTarget)) {
        // Quietly absorb — caller can re-issue with a valid target.
        continue;
      }
      target = signalJumpTarget;
    } else {
      const targetKeys = new Set(targets.map(t => String(t)));
      process.stderr.write(`\nJump to which phase? (${targets.join(' / ')})\n`);
      const phaseKey = await inputManager.waitForKey(targetKeys);
      target = Number(phaseKey) as PhaseNumber;
    }
    logger.logEvent({ event: 'terminal_action', action: 'jump', fromPhase, targetPhase: target, source });

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
