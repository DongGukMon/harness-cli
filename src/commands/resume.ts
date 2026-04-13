import { existsSync } from 'fs';
import { join } from 'path';
import { getGitRoot } from '../git.js';
import { acquireLock, readLock, releaseLock } from '../lock.js';
import { getPreflightItems, runPreflight, resolveCodexPath } from '../preflight.js';
import { findHarnessRoot, getCurrentRun, setCurrentRun } from '../root.js';
import { readState, writeState } from '../state.js';
import { registerSignalHandlers } from '../signal.js';
import { resumeRun } from '../resume.js';
import type { PhaseType } from '../types.js';

export interface ResumeOptions {
  allowDirty?: boolean;
  root?: string;
}

function phaseType(phase: number): PhaseType {
  if (phase === 1 || phase === 3 || phase === 5) return 'interactive';
  if (phase === 2 || phase === 4 || phase === 7) return 'gate';
  if (phase === 6) return 'verify';
  return 'ui_only';
}

export async function resumeCommand(runId?: string, options: ResumeOptions = {}): Promise<void> {
  // 1. Find harness root
  const harnessDir = findHarnessRoot(options.root);
  const cwd = options.root ?? getGitRoot();

  // 2. Resolve runId (explicit arg or current-run pointer)
  let targetRunId: string;
  if (runId !== undefined) {
    targetRunId = runId;
  } else {
    const current = getCurrentRun(harnessDir);
    if (current === null) {
      process.stderr.write(
        "No active run. Use 'harness run' to start a new run or 'harness list' to see all runs.\n"
      );
      process.exit(1);
    }
    targetRunId = current as string;
  }

  // 3. Validate run directory exists
  const runDir = join(harnessDir, targetRunId);
  if (!existsSync(runDir)) {
    process.stderr.write(`Run '${targetRunId}' not found.\n`);
    process.exit(1);
  }

  // 4. Read state.json
  const stateJsonPath = join(runDir, 'state.json');
  if (!existsSync(stateJsonPath) && !existsSync(stateJsonPath + '.tmp')) {
    process.stderr.write(`Run '${targetRunId}' has no state. Manual recovery required.\n`);
    process.exit(1);
  }

  let state;
  try {
    state = readState(runDir);
  } catch (err) {
    process.stderr.write(
      `state.json for run '${targetRunId}' is corrupted: ${(err as Error).message}\n`
    );
    process.exit(1);
  }

  if (state === null) {
    process.stderr.write(`Run '${targetRunId}' has no state. Manual recovery required.\n`);
    process.exit(1);
  }

  // 5. Completed run: update current-run pointer then error
  if (state.status === 'completed') {
    setCurrentRun(harnessDir, targetRunId);
    process.stderr.write(
      `Run '${targetRunId}' is already completed. Use 'harness jump N' to re-run a phase.\n`
    );
    process.exit(1);
  }

  // 6. Phase-scoped preflight (minimum for current phase)
  const currentPhaseType = phaseType(state.currentPhase);
  runPreflight(getPreflightItems(currentPhaseType), cwd);

  // 7. Verify codexPath still valid; re-discover if missing
  if (!existsSync(state.codexPath)) {
    const resolved = resolveCodexPath();
    if (resolved === null) {
      process.stderr.write(
        `Error: Codex companion not found. Install the openai-codex Claude plugin.\n`
      );
      process.exit(1);
    }
    state.codexPath = resolved;
    writeState(runDir, state);
  }

  // 8. Update current-run pointer (now that we're committed)
  setCurrentRun(harnessDir, targetRunId);

  // 9. Acquire lock
  acquireLock(harnessDir, targetRunId);

  // 10. Register signal handlers (childPid lookup reads from lock)
  registerSignalHandlers({
    harnessDir,
    runId: targetRunId,
    getState: () => state!,
    setState: (s) => Object.assign(state!, s),
    getChildPid: () => readLock(harnessDir)?.childPid ?? null,
    getCurrentPhaseType: () => {
      const phase = state!.currentPhase;
      if (phase === 1 || phase === 3 || phase === 5) return 'interactive';
      return 'automated';
    },
    cwd,
  });

  // 11. Run resume algorithm
  try {
    await resumeRun(state, harnessDir, runDir, cwd);
  } finally {
    releaseLock(harnessDir, targetRunId);
  }
}
