import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { createTestRepo } from '../helpers/test-repo.js';

// Use the built CLI
const CLI_PATH = resolve(process.cwd(), 'dist/bin/harness.js');

function runCli(args: string[], options: { cwd?: string; env?: Record<string, string> } = {}) {
  return spawnSync('node', [CLI_PATH, ...args], {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: 'utf-8',
    stdio: 'pipe',
  });
}

describe('CLI lifecycle integration', () => {
  let repo: { path: string; cleanup: () => void };

  beforeEach(() => {
    repo = createTestRepo();
  });

  afterEach(() => {
    repo.cleanup();
  });

  it('harness --help works', () => {
    const result = runCli(['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('harness');
    expect(result.stdout).toContain('run');
    expect(result.stdout).toContain('resume');
    expect(result.stdout).toContain('status');
    expect(result.stdout).toContain('list');
  });

  it('harness --version outputs version', () => {
    const result = runCli(['--version']);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('0.1.0');
  });

  it('harness list shows empty in fresh repo', () => {
    const result = runCli(['--root', repo.path, 'list']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('No runs found');
  });

  it('harness status without current-run errors', () => {
    const result = runCli(['--root', repo.path, 'status']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('No active run');
  });

  it('harness list shows existing runs', () => {
    // Manually create a run directory
    const harnessDir = join(repo.path, '.harness');
    mkdirSync(join(harnessDir, '2026-04-12-sample'), { recursive: true });
    writeFileSync(
      join(harnessDir, '2026-04-12-sample/state.json'),
      JSON.stringify({
        runId: '2026-04-12-sample',
        currentPhase: 3,
        status: 'in_progress',
        task: 'sample task',
        artifacts: {
          spec: 'docs/specs/2026-04-12-sample-design.md',
          plan: 'docs/plans/2026-04-12-sample.md',
          decisionLog: '.harness/2026-04-12-sample/decisions.md',
          checklist: '.harness/2026-04-12-sample/checklist.json',
          evalReport: 'docs/process/evals/2026-04-12-sample-eval.md',
        },
        phases: { '1': 'completed', '2': 'completed', '3': 'in_progress', '4': 'pending', '5': 'pending', '6': 'pending', '7': 'pending' },
        gateRetries: { '2': 0, '4': 0, '7': 0 },
        verifyRetries: 0,
        autoMode: false,
        baseCommit: 'abc',
        implRetryBase: 'abc',
        codexPath: '/fake',
        externalCommitsDetected: false,
        pauseReason: null,
        specCommit: null,
        planCommit: null,
        implCommit: null,
        evalCommit: null,
        verifiedAtHead: null,
        pausedAtHead: null,
        pendingAction: null,
        phaseOpenedAt: { '1': null, '3': null, '5': null },
        phaseAttemptId: { '1': null, '3': null, '5': null },
      }, null, 2)
    );

    const result = runCli(['--root', repo.path, 'list']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('2026-04-12-sample');
    expect(result.stdout).toContain('sample task');
  });

  it('harness resume with unknown runId errors', () => {
    const result = runCli(['--root', repo.path, 'resume', 'nonexistent-run']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not found');
  });

  it('harness jump with invalid phase errors', () => {
    const harnessDir = join(repo.path, '.harness');
    mkdirSync(harnessDir, { recursive: true });
    // Need a current-run for jump to process further
    writeFileSync(join(harnessDir, 'current-run'), 'nonexistent');

    const result = runCli(['--root', repo.path, 'jump', '99']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Must be 1-7');
  });

  it('harness skip with no current-run errors', () => {
    const result = runCli(['--root', repo.path, 'skip']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('No active run');
  });
});

describe('CLI parser — --light flag registration (Task 5 smoke test)', () => {
  it('start --help lists --light', () => {
    const res = runCli(['start', '--help']);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/--light/);
  });
  it('run --help lists --light', () => {
    const res = runCli(['run', '--help']);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/--light/);
  });
  it('resume --help lists --light (option is captured so runtime can reject it)', () => {
    const res = runCli(['resume', '--help']);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/--light/);
  });
});
