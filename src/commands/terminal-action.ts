import { renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getGitRoot } from '../git.js';
import { readLock } from '../lock.js';
import { isPidAlive } from '../process.js';
import { findHarnessRoot, getCurrentRun } from '../root.js';
import { readState } from '../state.js';
import { anyPhaseFailed } from '../phases/terminal-ui.js';
import { TERMINAL_ACTION_FILE } from '../phases/terminal-ui.js';

export interface TerminalActionOptions {
  root?: string;
}

/**
 * Validate an action token. Accepts `R`, `Q`, `J:<n>` (n in 1..7),
 * case-insensitive. Returns the canonical body to write, or `null` on rejection.
 */
function canonicalizeAction(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toUpperCase();
  if (t === 'R' || t === 'Q') return t;
  if (t.startsWith('J:')) {
    const phaseStr = t.slice(2);
    const n = Number(phaseStr);
    if (!Number.isInteger(n) || n < 1 || n > 7) return null;
    return `J:${n}`;
  }
  return null;
}

/**
 * Admin subcommand: `phase-harness terminal-action <runId?> <action>`.
 *
 * Writes `<runDir>/terminal-action.requested` so the inner process's R/J/Q wait
 * picks up the action on its next poll cycle (~500 ms). Used by supervisor
 * automation when `tmux send-keys` to the ctrl pane is silently dropped (issue
 * #117 Bug A).
 *
 * Validations:
 *   - Action token must be `R`, `Q`, or `J:<phase>` with phase in 1..7.
 *   - runId must resolve to an existing run with valid state.
 *   - Run must currently be in a terminal-failed state (at least one phase
 *     has status `failed` or `error` AND status is not `completed`). The
 *     inner process only consumes the file from the R/J/Q wait, so writing
 *     it outside that state would leave a stale file the harness never reads.
 */
export async function terminalActionCommand(
  runIdArg: string | undefined,
  actionArg: string,
  options: TerminalActionOptions = {},
): Promise<void> {
  // 1. Validate action token first — cheap and gives the operator a clear error
  //    before we touch the filesystem.
  const canonical = canonicalizeAction(actionArg);
  if (canonical === null) {
    process.stderr.write(
      `Error: invalid action '${actionArg}'. Expected 'R', 'Q', or 'J:<phase>' (phase in 1..7).\n`,
    );
    process.exit(1);
  }

  // 2. Resolve harnessDir + runId. If runIdArg is omitted, fall back to the
  //    current-run pointer (does NOT rewrite it — admin tooling should not
  //    have side effects on the active-run state beyond writing the action file).
  const harnessDir = findHarnessRoot(options.root);
  let runId: string;
  if (runIdArg !== undefined && runIdArg !== '') {
    runId = runIdArg;
  } else {
    const current = getCurrentRun(harnessDir);
    if (current === null) {
      process.stderr.write(
        "No active run. Provide a runId or use 'phase-harness list' to see all runs.\n",
      );
      process.exit(1);
    }
    runId = current;
  }

  const runDir = join(harnessDir, runId);
  let cwd: string;
  try { cwd = options.root ?? getGitRoot(); } catch { cwd = options.root ?? process.cwd(); }
  const state = readState(runDir, cwd);
  if (state === null) {
    process.stderr.write(
      `Run '${runId}' has no state (no state.json found). Use 'phase-harness list' to see available runs.\n`,
    );
    process.exit(1);
  }

  // 3. Guard: is the run in a state where the file would actually be consumed?
  //    The inner process polls the file only inside `enterFailedTerminalState`,
  //    which is entered iff `anyPhaseFailed(state) && state.status !== completed/paused`.
  if (state.status === 'completed') {
    process.stderr.write(
      `Run '${runId}' is completed. terminal-action only applies to failed runs awaiting R/J/Q.\n`,
    );
    process.exit(1);
  }
  if (!anyPhaseFailed(state)) {
    process.stderr.write(
      `Run '${runId}' is not at terminal-failed (no phase has status 'failed' or 'error').\n` +
      `Wait for the run to fail, or run 'phase-harness status' to check.\n`,
    );
    process.exit(1);
  }

  // 4. Atomic write: write to .tmp then rename so the inner process never
  //    reads a half-written file. The inner poll consumes (read + unlink) the
  //    canonical name.
  const dstPath = join(runDir, TERMINAL_ACTION_FILE);
  const tmpPath = `${dstPath}.tmp`;
  writeFileSync(tmpPath, canonical);
  renameSync(tmpPath, dstPath);

  // 5. Informational message. If the inner process is alive, the file is
  //    expected to be consumed within ~500ms; otherwise it sits until next
  //    resume re-enters terminal-failed (then runs immediately).
  const lock = readLock(harnessDir);
  const innerAlive = lock !== null && lock.handoff === false && isPidAlive(lock.cliPid);
  if (innerAlive) {
    process.stderr.write(
      `Terminal action '${canonical}' written to ${dstPath} — inner process will pick it up on the next poll.\n`,
    );
  } else {
    process.stderr.write(
      `Terminal action '${canonical}' written to ${dstPath}. No live inner process detected; ` +
      `the file will be consumed the next time the run re-enters terminal-failed via 'phase-harness resume'.\n`,
    );
  }
}
