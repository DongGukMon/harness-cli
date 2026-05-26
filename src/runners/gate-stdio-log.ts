import fs from 'fs';
import path from 'path';

/**
 * #114 PR #4: persist a gate runner's stdout + stderr to a per-phase log file
 * so a frozen / timed-out / spawn-error gate retains a post-mortem record after
 * the in-memory buffers are discarded. Mirrors PR #3's per-attempt tmux pane
 * capture for interactive phases — same intent (offline debug), same best-effort
 * contract (capture failure must not abort the harness).
 *
 * File path: `<runDir>/gate-<N>-runner.stdio.log`. Overwritten on retry — last
 * retry wins, matching the existing `gate-<N>-raw.txt` sidecar convention.
 * If preserving per-retry history is later required, a follow-up PR can switch
 * to the `gate-<N>-cycle-<C>-retry-<R>-*.log` naming pattern already used for
 * stubborn-id feedback files (`src/phases/stubbornIds.test.ts:11`).
 */
export function persistGateRunnerStdio(
  runDir: string,
  phase: number,
  stdout: string,
  stderr: string,
): void {
  const logPath = path.join(runDir, `gate-${phase}-runner.stdio.log`);
  const body =
    `===== STDOUT =====\n${stdout}\n` +
    `===== STDERR =====\n${stderr}\n`;
  try {
    fs.writeFileSync(logPath, body, 'utf-8');
  } catch (err) {
    process.stderr.write(
      `[harness] failed to persist gate ${phase} runner stdio to ${logPath}: ${(err as Error).message}\n`,
    );
  }
}
