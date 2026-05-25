import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

import { createInitialState, writeState, readState } from '../../src/state.js';
import { runVerifyPhase } from '../../src/phases/verify.js';
import { FileSessionLogger } from '../../src/logger.js';
import { generateRetrospective } from '../../src/phases/retrospective.js';
import { aggregateFooter } from '../../src/metrics/footer-aggregator.js';
import type { HarnessState, LogEvent } from '../../src/types.js';

// SC5 — Phase 6 mid-session dirty tolerance:
//   A new untracked file appearing AFTER the baseline was captured (e.g. a
//   tooling lock file written during the harness run) must NOT abort Phase 6.
//   Instead, runPhase6Preconditions auto-extends dirtyBaseline and runVerifyPhase
//   emits a `dirty_baseline_extended` event to events.jsonl.
//
// R4.c verification — the new event is additive and downstream consumers
//   (generateRetrospective + aggregateFooter) must iterate-and-skip without
//   throwing on the unknown event type.

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  tmpDirs.length = 0;
});

function makeTmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function initRepo(repoPath: string): void {
  // Configure a deterministic identity locally so `git commit` doesn't need
  // global config (CI machines may have neither user.email nor user.name).
  execSync('git init -q', { cwd: repoPath });
  execSync('git config user.email "test@example.com"', { cwd: repoPath });
  execSync('git config user.name "Test"', { cwd: repoPath });
  // Seed with one committed file so HEAD exists for git ls-tree, getStagedFiles, etc.
  fs.writeFileSync(path.join(repoPath, 'seed.txt'), 'seed\n');
  execSync('git add seed.txt && git commit -q -m "seed"', { cwd: repoPath });
}

describe('Phase 6 — mid-session dirty tolerance (SC5)', () => {
  it('writes dirty_baseline_extended event when a new untracked file appears mid-session', async () => {
    const harnessDir = makeTmpDir('p6-mid-harness-');
    const runDir = path.join(harnessDir, 'r1');
    fs.mkdirSync(runDir, { recursive: true });
    const sessionsRoot = path.join(harnessDir, 'sessions');

    const repoCwd = makeTmpDir('p6-mid-repo-');
    initRepo(repoCwd);

    // Build state matching a real Phase 6 entry. dirtyBaseline starts empty.
    const state = createInitialState('r1', 'test task', 'base-sha', false, true);
    state.trackedRepos = [{
      path: repoCwd,
      baseCommit: 'base-sha',
      implRetryBase: 'base-sha',
      implHead: null,
    }];
    state.dirtyBaseline = [];
    state.currentPhase = 6;
    state.phases['6'] = 'pending';
    writeState(runDir, state);

    // Drop an untracked file that appeared AFTER baseline capture
    // (e.g. a Claude Code scheduled-task lock file).
    const lockDir = path.join(repoCwd, '.claude');
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(path.join(lockDir, 'scheduled_tasks.lock'), 'lock');

    const logger = new FileSessionLogger('r1', harnessDir, { sessionsRoot, cwd: repoCwd });
    logger.writeMeta({ task: 'test task' });
    logger.logEvent({ event: 'session_start', task: 'test task', autoMode: false, baseCommit: 'base-sha', harnessVersion: 'test' });

    // runVerifyPhase runs the preconditions (extends baseline + emits the
    // event) BEFORE the subprocess machinery. Anything downstream (lock file
    // ENOENT, missing verify script, spawn failure) is acceptable — we only
    // care that the event was appended to events.jsonl before the throw.
    let threw = false;
    try {
      await runVerifyPhase(state, harnessDir, runDir, repoCwd, logger);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    const eventsPath = logger.getEventsPath();
    expect(eventsPath).not.toBeNull();
    const raw = fs.readFileSync(eventsPath!, 'utf-8');
    const events = raw.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

    const extendedEvents = events.filter((e: any) => e.event === 'dirty_baseline_extended');
    expect(extendedEvents).toHaveLength(1);
    const evt = extendedEvents[0];
    expect(evt.phase).toBe(6);
    expect(evt.addedPaths).toEqual(['.claude/scheduled_tasks.lock']);
    expect(evt.totalCount).toBe(1);

    // In-memory state mutation
    expect(state.dirtyBaseline).toHaveLength(1);
    expect(state.dirtyBaseline[0]).toContain('.claude/scheduled_tasks.lock');

    // Persisted state mutation
    const persisted = readState(runDir);
    expect(persisted).not.toBeNull();
    expect(persisted!.dirtyBaseline).toHaveLength(1);
    expect(persisted!.dirtyBaseline[0]).toContain('.claude/scheduled_tasks.lock');
  });

  // R4.c — downstream consumers must iterate-and-skip the new event type
  // without throwing. Build a minimal events.jsonl containing the new event
  // alongside required session boundaries, then feed it into both consumers.
  it('downstream consumers tolerate dirty_baseline_extended events (R4.c)', () => {
    const harnessDir = makeTmpDir('p6-r4c-harness-');
    const runDir = path.join(harnessDir, 'r2');
    fs.mkdirSync(runDir, { recursive: true });
    const sessionsRoot = path.join(harnessDir, 'sessions');

    const logger = new FileSessionLogger('r2', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 'r4c-task' });
    logger.logEvent({ event: 'session_start', task: 'r4c-task', autoMode: false, baseCommit: 'base', harnessVersion: 'test' });
    logger.logEvent({ event: 'phase_start', phase: 6, retryIndex: 0 });
    logger.logEvent({
      event: 'dirty_baseline_extended',
      phase: 6,
      addedPaths: ['.claude/scheduled_tasks.lock'],
      totalCount: 1,
    });
    logger.logEvent({ event: 'phase_end', phase: 6, status: 'completed', durationMs: 10 });
    logger.logEvent({ event: 'session_end', status: 'completed', totalWallMs: 100 });

    const eventsPath = logger.getEventsPath();
    expect(eventsPath).not.toBeNull();

    // generateRetrospective takes a file path
    const retro = generateRetrospective(eventsPath!);
    expect(retro).toBeTruthy();
    expect(retro.markdown).toBeTruthy();
    expect(retro.stats).toBeTruthy();
    expect(retro.stats.malformedLineCount).toBe(0);
    expect(retro.stats.eventCount).toBeGreaterThan(0);

    // aggregateFooter takes an event array directly
    const raw = fs.readFileSync(eventsPath!, 'utf-8');
    const events: LogEvent[] = raw.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    const stateSlice = {
      currentPhase: 6,
      gateRetries: { '2': 0, '4': 0, '7': 0 },
      phaseStatus: 'completed' as const,
    };
    const footer = aggregateFooter(events, stateSlice, Date.now());
    // Footer may legitimately be non-null since we emitted session_start.
    expect(footer).not.toBeNull();
    expect(footer!.currentPhase).toBe(6);
  });
});
