import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createTestRepo } from '../helpers/test-repo.js';
import { jumpCommand } from '../../src/commands/jump.js';
import { createInitialState, writeState } from '../../src/state.js';
import { setCurrentRun } from '../../src/root.js';

vi.mock('../../src/phases/runner.js', () => ({
  runPhaseLoop: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/signal.js', () => ({
  registerSignalHandlers: vi.fn(),
}));

vi.mock('../../src/preflight.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/preflight.js')>('../../src/preflight.js');
  return {
    ...actual,
    runPreflight: vi.fn(() => ({})),
  };
});

function setupRun(repo: { path: string }, options: Partial<Record<string, unknown>> = {}) {
  const harnessDir = join(repo.path, '.harness');
  const runId = '2026-04-12-test';
  const runDir = join(harnessDir, runId);
  mkdirSync(runDir, { recursive: true });

  const baseCommit = execSync('git rev-parse HEAD', { cwd: repo.path, encoding: 'utf-8' }).trim();
  const state = createInitialState(runId, 'test task', baseCommit, '/fake/codex', false);
  Object.assign(state, options);
  writeState(runDir, state);
  setCurrentRun(harnessDir, runId);

  // Create required input artifacts so jump preflight passes for any phase
  writeFileSync(join(runDir, 'task.md'), 'test task');
  mkdirSync(join(repo.path, 'docs/specs'), { recursive: true });
  mkdirSync(join(repo.path, 'docs/plans'), { recursive: true });
  mkdirSync(join(repo.path, 'docs/process/evals'), { recursive: true });
  writeFileSync(join(repo.path, state.artifacts.spec), '# spec');
  writeFileSync(join(repo.path, state.artifacts.plan), '# plan');
  writeFileSync(join(repo.path, state.artifacts.evalReport), '# eval\n## Summary\nok\n');

  return { harnessDir, runId, runDir, state };
}

describe('jumpCommand', () => {
  let repo: { path: string; cleanup: () => void };
  let exitSpy: any;
  let stderrSpy: any;

  beforeEach(() => {
    repo = createTestRepo();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code}`);
    }) as never);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
    repo.cleanup();
  });

  it('rejects invalid phase number', async () => {
    setupRun(repo, { currentPhase: 5 });
    await expect(jumpCommand('abc', { root: repo.path })).rejects.toThrow('__exit__');
    await expect(jumpCommand('0', { root: repo.path })).rejects.toThrow('__exit__');
    await expect(jumpCommand('8', { root: repo.path })).rejects.toThrow('__exit__');
  });

  it('rejects forward jump', async () => {
    setupRun(repo, { currentPhase: 3 });
    await expect(jumpCommand('5', { root: repo.path })).rejects.toThrow('__exit__');
    expect(stderrSpy.mock.calls.map((c: any) => c[0]).join('')).toContain('forward');
  });

  it('allows jump from completed run', async () => {
    setupRun(repo, { currentPhase: 8, status: 'completed' });
    await jumpCommand('3', { root: repo.path });
    const state = JSON.parse(readFileSync(join(repo.path, '.harness/2026-04-12-test/state.json'), 'utf-8'));
    expect(state.currentPhase).toBe(3);
    expect(state.status).toBe('in_progress');
  });

  it('backward jump resets phases to pending', async () => {
    const { runDir } = setupRun(repo, {
      currentPhase: 5,
      phases: {
        '1': 'completed',
        '2': 'completed',
        '3': 'completed',
        '4': 'completed',
        '5': 'in_progress',
        '6': 'pending',
        '7': 'pending',
      },
    });

    await jumpCommand('3', { root: repo.path });

    const state = JSON.parse(readFileSync(join(runDir, 'state.json'), 'utf-8'));
    expect(state.phases['3']).toBe('pending');
    expect(state.phases['4']).toBe('pending');
    expect(state.phases['5']).toBe('pending');
    // Phases before N remain unchanged
    expect(state.phases['1']).toBe('completed');
    expect(state.phases['2']).toBe('completed');
  });

  it('clears commit anchors for phases >= N', async () => {
    const head = execSync('git rev-parse HEAD', { cwd: repo.path, encoding: 'utf-8' }).trim();
    const { runDir } = setupRun(repo, {
      currentPhase: 7,
      // Use real HEAD SHA so ancestry checks pass
      specCommit: head,
      planCommit: head,
      implCommit: head,
      evalCommit: head,
      verifiedAtHead: head,
    });

    await jumpCommand('3', { root: repo.path });

    const state = JSON.parse(readFileSync(join(runDir, 'state.json'), 'utf-8'));
    // N=3: clear planCommit, implCommit, evalCommit, verifiedAtHead
    expect(state.planCommit).toBeNull();
    expect(state.implCommit).toBeNull();
    expect(state.evalCommit).toBeNull();
    expect(state.verifiedAtHead).toBeNull();
    // specCommit preserved (N > 1)
    expect(state.specCommit).toBe(head);
  });

  it('resets retries and counters', async () => {
    const { runDir } = setupRun(repo, {
      currentPhase: 7,
      gateRetries: { '2': 1, '4': 2, '7': 3 },
      verifyRetries: 2,
    });

    await jumpCommand('4', { root: repo.path });

    const state = JSON.parse(readFileSync(join(runDir, 'state.json'), 'utf-8'));
    expect(state.gateRetries['4']).toBe(0);
    expect(state.gateRetries['7']).toBe(0);
    expect(state.gateRetries['2']).toBe(1); // N=4, gate 2 < N so preserved
    expect(state.verifyRetries).toBe(0); // N=4 <= 6
  });

  it('deletes sidecar files for reset phases', async () => {
    const { runDir } = setupRun(repo, { currentPhase: 7 });
    // Create sidecars
    writeFileSync(join(runDir, 'gate-7-raw.txt'), 'x');
    writeFileSync(join(runDir, 'gate-7-result.json'), '{}');
    writeFileSync(join(runDir, 'verify-result.json'), '{}');
    writeFileSync(join(runDir, 'phase-5.done'), 'attempt-id');

    await jumpCommand('5', { root: repo.path });

    expect(existsSync(join(runDir, 'gate-7-raw.txt'))).toBe(false);
    expect(existsSync(join(runDir, 'phase-5.done'))).toBe(false);
    expect(existsSync(join(runDir, 'verify-result.json'))).toBe(false);
  });

  it('clears pendingAction and pauseReason', async () => {
    const { runDir } = setupRun(repo, {
      currentPhase: 5,
      status: 'paused',
      pauseReason: 'gate-escalation',
      pendingAction: {
        type: 'show_escalation',
        targetPhase: 5,
        sourcePhase: null,
        feedbackPaths: [],
      },
    });

    await jumpCommand('3', { root: repo.path });

    const state = JSON.parse(readFileSync(join(runDir, 'state.json'), 'utf-8'));
    expect(state.pendingAction).toBeNull();
    expect(state.pauseReason).toBeNull();
    expect(state.status).toBe('in_progress');
  });
});
