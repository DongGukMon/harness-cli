import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { runPreflight } from '../preflight.js';
import { findHarnessRoot } from '../root.js';
import { readState } from '../state.js';
import type { HarnessState } from '../types.js';

export interface ListOptions {
  root?: string;
}

interface RunSummary {
  runId: string;
  currentPhase: number;
  status: string;
  task: string;
}

export async function listCommand(options: ListOptions = {}): Promise<void> {
  runPreflight(['platform']);

  let harnessDir: string;
  try {
    harnessDir = findHarnessRoot(options.root);
  } catch {
    process.stdout.write("No runs found. Use 'harness run \"task\"' to start.\n");
    return;
  }

  const runs: RunSummary[] = [];

  let entries: string[];
  try {
    entries = readdirSync(harnessDir);
  } catch {
    process.stdout.write("No runs found. Use 'harness run \"task\"' to start.\n");
    return;
  }

  for (const entry of entries) {
    const entryPath = join(harnessDir, entry);
    let isDir = false;
    try {
      isDir = statSync(entryPath).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;

    const stateJsonPath = join(entryPath, 'state.json');
    let state: HarnessState | null;
    try {
      state = readState(entryPath);
    } catch {
      continue;
    }
    if (state === null) continue;

    runs.push({
      runId: state.runId,
      currentPhase: state.currentPhase,
      status: state.status,
      task: state.task,
    });
  }

  if (runs.length === 0) {
    process.stdout.write("No runs found. Use 'harness run \"task\"' to start.\n");
    return;
  }

  // Sort by runId descending (most recent first)
  runs.sort((a, b) => (b.runId > a.runId ? 1 : b.runId < a.runId ? -1 : 0));

  const header = 'Run ID'.padEnd(40) + 'Phase'.padEnd(10) + 'Status'.padEnd(14) + 'Task';
  process.stdout.write(header + '\n');
  process.stdout.write('-'.repeat(80) + '\n');
  for (const r of runs) {
    const phase = r.currentPhase === 8 ? 'done' : `${r.currentPhase}/7`;
    const task = r.task.length > 40 ? r.task.slice(0, 37) + '...' : r.task;
    process.stdout.write(
      r.runId.padEnd(40) + phase.padEnd(10) + r.status.padEnd(14) + task + '\n'
    );
  }
}
