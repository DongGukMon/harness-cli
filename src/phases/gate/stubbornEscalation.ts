import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { HarnessState, DeferredRequirement, GatePhase } from '../../types.js';
import { writeDeferredStub } from './deferredStub.js';
import { filterFeedbackByIds } from './parseRejectFeedback.js';

export interface StubbornEscalationInput {
  phase: GatePhase;
  retryIndex: number;
  stubbornIds: string[];
  comments: string;
  state: HarnessState;
  runDir: string;
  threshold: number;
  logger: { logEvent: (e: any) => void };
}

export interface StubbornEscalationResult {
  action: 'defer-and-continue' | 'defer-and-force-pass' | 'already-deferred';
  filteredFeedbackPath?: string; // present when action='defer-and-continue' AND filter parsed
  stubPaths: string[];
}

export function handleStubbornEscalationAuto(
  input: StubbornEscalationInput,
): StubbornEscalationResult {
  const { phase, retryIndex, stubbornIds, comments, state, runDir, threshold, logger } = input;
  // Mutates state.deferredRequirements in-place; caller is responsible for writeState.
  // Writes deferred stub files to <runDir>/deferred/ and an optional filtered.md.
  const histKey = String(phase) as '2' | '4' | '7';

  state.deferredRequirements = state.deferredRequirements ?? {};
  state.deferredRequirements[histKey] = state.deferredRequirements[histKey] ?? [];
  const alreadyDeferred = new Set(state.deferredRequirements[histKey]!.map(d => d.requirementId));

  // Detect "already deferred" — every stuck ID is already in state.
  const newStuck = stubbornIds.filter(id => !alreadyDeferred.has(id));
  const allAlreadyDeferred = newStuck.length === 0;

  const history = state.gateRejectHistory?.[histKey] ?? [];

  // Write stubs for the NEW stuck IDs only.
  const stubPaths: string[] = [];
  for (const id of newStuck) {
    const stubPath = writeDeferredStub(runDir, phase, id, history, threshold);
    stubPaths.push(stubPath);
    const feedbackPaths = history
      .filter(e => e.requirementIds.includes(id))
      .map(e => e.feedbackPath);
    const entry: DeferredRequirement = {
      requirementId: id, phase, rejectCount: feedbackPaths.length,
      feedbackPaths, stubPath, deferredAt: Date.now(),
    };
    state.deferredRequirements[histKey]!.push(entry);

    if (state.autoDeferIssues) {
      tryCreateGhIssue(entry, state.runId, runDir);
    }
  }

  // Filter the current reject feedback by ALL stuck IDs (deferred + new).
  const filterResult = filterFeedbackByIds(comments, stubbornIds);
  let action: StubbornEscalationResult['action'];
  let filteredFeedbackPath: string | undefined;

  if (allAlreadyDeferred) {
    action = 'already-deferred';
  } else if (filterResult.parsedOk && filterResult.filtered.trim() === '') {
    action = 'defer-and-force-pass';
  } else {
    action = 'defer-and-continue';
    if (filterResult.parsedOk) {
      const cycle = state.gateEscalationCycles?.[histKey] ?? 0;
      const fpath = path.join(runDir, `gate-${phase}-cycle-${cycle}-retry-${retryIndex}-filtered.md`);
      fs.writeFileSync(fpath, filterResult.filtered, 'utf-8');
      filteredFeedbackPath = fpath;
    } else {
      process.stderr.write(
        `[stubborn-id] feedback transform failed (no item markers); reopened with full feedback\n`,
      );
    }
  }

  logger.logEvent({
    event: 'gate_stubborn_id',
    phase, retryIndex,
    requirementIds: stubbornIds,
    threshold,
    action,
  });

  return { action, filteredFeedbackPath, stubPaths };
}

export function resetOldestEntryFor(
  history: import('../../types.js').GateRejectEntry[],
  stuckIds: string[],
): import('../../types.js').GateRejectEntry[] {
  const remaining = [...history];
  for (const id of stuckIds) {
    const idx = remaining.findIndex(e => e.requirementIds.includes(id));
    if (idx >= 0) remaining.splice(idx, 1);
  }
  return remaining;
}

function tryCreateGhIssue(entry: DeferredRequirement, runId: string, runDir: string): void {
  try {
    const title = `[stubborn-requirement] Phase ${entry.phase} ${entry.requirementId} did not converge in run ${runId}`;
    const body = fs.readFileSync(entry.stubPath, 'utf-8');
    const out = spawnSync('gh', [
      'issue', 'create',
      '--title', title,
      '--body', body,
      '--label', 'harness/auto-deferred',
      '--label', `phase-${entry.phase}`,
    ], { cwd: runDir, encoding: 'utf-8', timeout: 15000 });
    if (out.status === 0 && out.stdout) {
      const url = out.stdout.trim().split('\n').pop();
      if (url && url.startsWith('http')) entry.ghIssueUrl = url;
    } else if (out.signal === 'SIGTERM' || (out.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') {
      process.stderr.write(
        `[stubborn-id] gh issue create timed out (15s); file stub retained at ${entry.stubPath}\n`,
      );
    } else {
      process.stderr.write(
        `[stubborn-id] gh issue create failed (status=${out.status}); file stub retained at ${entry.stubPath}\n`,
      );
    }
  } catch (err) {
    process.stderr.write(
      `[stubborn-id] gh issue create threw (${(err as Error).message}); file stub retained at ${entry.stubPath}\n`,
    );
  }
}
