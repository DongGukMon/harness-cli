import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      close: vi.fn(async () => undefined),
    })),
  },
}));

vi.mock('../../src/process.js', () => ({
  isPidAlive: vi.fn(() => true),
}));

import { waitForPhaseCompletion } from '../../src/phases/interactive.js';
import { createInitialState } from '../../src/state.js';

const tmpDirs: string[] = [];

function makeTmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  tmpDirs.length = 0;
});

describe('waitForPhaseCompletion — sentinel polling fallback', () => {
  it('completes from a fresh sentinel while the Claude PID is still alive even if fs watcher events are missed', async () => {
    const cwd = makeTmpDir('sentinel-poll-cwd-');
    const runDir = makeTmpDir('sentinel-poll-run-');
    const state = createInitialState('run', 'task', 'base', false);

    const specPath = path.join(cwd, state.artifacts.spec);
    const decisionPath = path.join(cwd, state.artifacts.decisionLog);
    fs.mkdirSync(path.dirname(specPath), { recursive: true });
    fs.mkdirSync(path.dirname(decisionPath), { recursive: true });
    fs.writeFileSync(specPath, '# Spec\n\n## Complexity\n\nMedium\n');
    fs.writeFileSync(decisionPath, '# Decisions\n');

    const attemptId = 'attempt-fresh';
    const sentinelPath = path.join(runDir, 'phase-1.done');
    const resultPromise = waitForPhaseCompletion(sentinelPath, attemptId, 4242, 1, state, cwd, runDir);

    let settled = false;
    resultPromise.then(() => { settled = true; });

    fs.writeFileSync(sentinelPath, `${attemptId}\n`);
    await vi.advanceTimersByTimeAsync(600);
    await Promise.resolve();

    expect(settled).toBe(true);
    await expect(resultPromise).resolves.toEqual({ status: 'completed' });
  });
});
