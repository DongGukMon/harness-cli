import { join } from 'path';
import { runPreflight } from '../preflight.js';
import { findHarnessRoot, getCurrentRun } from '../root.js';
import { readState } from '../state.js';
import type { HarnessState } from '../types.js';

export interface StatusOptions {
  root?: string;
}

export async function statusCommand(options: StatusOptions = {}): Promise<void> {
  runPreflight(['platform']);

  const harnessDir = findHarnessRoot(options.root);
  const runId = getCurrentRun(harnessDir);

  if (runId === null) {
    process.stderr.write("No active run. Use 'harness list' to see all runs.\n");
    process.exit(1);
  }

  const runDir = join(harnessDir, runId);
  let state: HarnessState | null;
  try {
    state = readState(runDir);
  } catch (err) {
    process.stderr.write(
      `Run '${runId}' state is corrupted: ${(err as Error).message}\n`
    );
    process.exit(1);
  }

  if (state === null) {
    process.stderr.write(
      `Run '${runId}' has no state. Manual recovery required.\n`
    );
    process.exit(1);
  }

  printStatus(state);
}

function printStatus(state: HarnessState): void {
  const out = process.stdout;
  out.write(`Run: ${state.runId}\n`);
  out.write(`Task: ${state.task}\n`);
  out.write(`Status: ${state.status}`);
  if (state.pauseReason) {
    out.write(` (${state.pauseReason})`);
  }
  out.write('\n');
  out.write(`Current Phase: ${state.currentPhase}\n`);
  out.write(`Auto Mode: ${state.autoMode}\n`);
  out.write('\n');

  out.write('Phases:\n');
  for (const phase of ['1', '2', '3', '4', '5', '6', '7']) {
    const status = state.phases[phase] ?? 'pending';
    const marker = state.currentPhase === Number(phase) ? '→' : ' ';
    out.write(`  ${marker} Phase ${phase}: ${status}\n`);
  }
  out.write('\n');

  out.write('Artifacts:\n');
  out.write(`  spec:        ${state.artifacts.spec}\n`);
  out.write(`  plan:        ${state.artifacts.plan}\n`);
  out.write(`  decisions:   ${state.artifacts.decisionLog}\n`);
  out.write(`  checklist:   ${state.artifacts.checklist}\n`);
  out.write(`  evalReport:  ${state.artifacts.evalReport}\n`);
  out.write('\n');

  out.write('Retries:\n');
  out.write(`  gate[2]: ${state.gateRetries['2'] ?? 0}\n`);
  out.write(`  gate[4]: ${state.gateRetries['4'] ?? 0}\n`);
  out.write(`  gate[7]: ${state.gateRetries['7'] ?? 0}\n`);
  out.write(`  verify:  ${state.verifyRetries}\n`);
  out.write('\n');

  out.write('Commit Anchors:\n');
  out.write(`  baseCommit:     ${state.baseCommit}\n`);
  out.write(`  specCommit:     ${state.specCommit ?? '(none)'}\n`);
  out.write(`  planCommit:     ${state.planCommit ?? '(none)'}\n`);
  out.write(`  implCommit:     ${state.implCommit ?? '(none)'}\n`);
  out.write(`  evalCommit:     ${state.evalCommit ?? '(none)'}\n`);
  out.write(`  verifiedAtHead: ${state.verifiedAtHead ?? '(none)'}\n`);
  out.write(`  pausedAtHead:   ${state.pausedAtHead ?? '(none)'}\n`);
  out.write('\n');

  if (state.externalCommitsDetected) {
    out.write('⚠️  External commits detected\n');
  }

  if (state.pendingAction) {
    out.write(
      `Pending Action: ${state.pendingAction.type} (targetPhase=${state.pendingAction.targetPhase})\n`
    );
  }
}
