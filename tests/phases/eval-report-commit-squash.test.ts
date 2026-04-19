import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestRepo } from '../helpers/test-repo.js';
import { createInitialState, writeState } from '../../src/state.js';
import { commitEvalReport, runPhase6Preconditions } from '../../src/artifact.js';

const repos: Array<{ cleanup: () => void }> = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (repos.length > 0) {
    repos.pop()!.cleanup();
  }
});

function makeRepo() {
  const repo = createTestRepo();
  repos.push(repo);
  return repo;
}

function writeRepoFile(repoPath: string, relPath: string, content: string): void {
  const absPath = path.join(repoPath, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content);
}

function commitCount(cwd: string): number {
  return Number(execSync('git rev-list --count HEAD', { cwd, encoding: 'utf-8' }).trim());
}

function lastCommitMessage(cwd: string): string {
  return execSync('git log -1 --pretty=%s', { cwd, encoding: 'utf-8' }).trim();
}

function stagedDeletionStatus(cwd: string, relPath: string): string {
  return execSync(`git diff --cached --name-status -- "${relPath}"`, {
    cwd,
    encoding: 'utf-8',
  }).trim();
}

describe('eval report commit squash', () => {
  it('stages tracked eval report deletion without creating a reset commit and commits one rev-K report per round', () => {
    const repo = makeRepo();
    const state = createInitialState('eval-run', 'task', 'base-sha', false);
    const evalReportPath = state.artifacts.evalReport;

    writeRepoFile(repo.path, evalReportPath, '# Eval Report\n\n## Summary\n\nround 1\n');
    execSync(`git add "${evalReportPath}" && git commit -m "seed eval report"`, { cwd: repo.path });

    const commitsBeforeReset = commitCount(repo.path);
    runPhase6Preconditions(evalReportPath, state.runId, repo.path);

    expect(commitCount(repo.path)).toBe(commitsBeforeReset);
    expect(stagedDeletionStatus(repo.path, evalReportPath)).toBe(`D\t${evalReportPath}`);

    writeRepoFile(repo.path, evalReportPath, '# Eval Report\n\n## Summary\n\nround 1 replacement\n');
    state.verifyRetries = 0;
    commitEvalReport(state, repo.path);

    expect(lastCommitMessage(repo.path)).toBe(`harness[${state.runId}]: Phase 6 — rev 1 eval report`);

    const commitsBeforeRoundTwo = commitCount(repo.path);
    runPhase6Preconditions(evalReportPath, state.runId, repo.path);

    expect(commitCount(repo.path)).toBe(commitsBeforeRoundTwo);
    expect(stagedDeletionStatus(repo.path, evalReportPath)).toBe(`D\t${evalReportPath}`);

    writeRepoFile(repo.path, evalReportPath, '# Eval Report\n\n## Summary\n\nround 2 replacement\n');
    state.verifyRetries = 1;
    commitEvalReport(state, repo.path);

    expect(commitCount(repo.path)).toBe(commitsBeforeRoundTwo + 1);
    expect(lastCommitMessage(repo.path)).toBe(`harness[${state.runId}]: Phase 6 — rev 2 eval report`);
  });

  it('treats an already-staged eval report deletion as an idempotent precondition', () => {
    const repo = makeRepo();
    const state = createInitialState('staged-delete-run', 'task', 'base-sha', false);
    const evalReportPath = state.artifacts.evalReport;

    writeRepoFile(repo.path, evalReportPath, '# Eval Report\n\n## Summary\n\nseed\n');
    execSync(`git add "${evalReportPath}" && git commit -m "seed eval report"`, { cwd: repo.path });

    runPhase6Preconditions(evalReportPath, state.runId, repo.path);
    const commitsAfterFirstReset = commitCount(repo.path);

    expect(() => runPhase6Preconditions(evalReportPath, state.runId, repo.path)).not.toThrow();
    expect(commitCount(repo.path)).toBe(commitsAfterFirstReset);
    expect(stagedDeletionStatus(repo.path, evalReportPath)).toBe(`D\t${evalReportPath}`);
  });

  it('uses the rev 1 eval report message on the live verify pass path', async () => {
    const repo = makeRepo();
    const harnessDir = path.join(repo.path, '.harness');
    const runId = 'live-pass-run';
    const runDir = path.join(harnessDir, runId);
    fs.mkdirSync(runDir, { recursive: true });

    const baseCommit = execSync('git rev-parse HEAD', { cwd: repo.path, encoding: 'utf-8' }).trim();
    const state = createInitialState(runId, 'task', baseCommit, false);
    writeState(runDir, state);
    writeRepoFile(repo.path, state.artifacts.evalReport, '# Eval Report\n\n## Summary\n\nlive pass\n');

    vi.resetModules();
    vi.doMock('../../src/phases/verify.js', () => ({
      runVerifyPhase: vi.fn().mockResolvedValue({ type: 'pass' }),
      readVerifyResult: vi.fn(),
      isEvalReportValid: vi.fn(),
    }));
    vi.doMock('../../src/ui.js', () => ({
      promptChoice: vi.fn(),
      printPhaseTransition: vi.fn(),
      renderControlPanel: vi.fn(),
      printWarning: vi.fn(),
      printError: vi.fn(),
      printSuccess: vi.fn(),
      printInfo: vi.fn(),
    }));

    const { handleVerifyPhase } = await import('../../src/phases/runner.js');
    const { InputManager } = await import('../../src/input.js');
    const { NoopLogger } = await import('../../src/logger.js');

    await handleVerifyPhase(
      state,
      harnessDir,
      runDir,
      repo.path,
      new InputManager(),
      new NoopLogger(),
    );

    expect(lastCommitMessage(repo.path)).toBe(`harness[${runId}]: Phase 6 — rev 1 eval report`);
  });

  it('uses the rev-K eval report message on both resume recovery paths', async () => {
    const repo = makeRepo();
    const baseCommit = execSync('git rev-parse HEAD', { cwd: repo.path, encoding: 'utf-8' }).trim();

    vi.resetModules();
    vi.doUnmock('../../src/phases/verify.js');
    vi.doUnmock('../../src/ui.js');
    vi.doMock('../../src/phases/runner.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/phases/runner.js')>();
      return {
        ...actual,
        runPhaseLoop: vi.fn().mockResolvedValue(undefined),
      };
    });

    const { resumeRun } = await import('../../src/resume.js');

    const errorRunId = 'resume-error-run';
    const errorHarnessDir = path.join(repo.path, '.harness');
    const errorRunDir = path.join(errorHarnessDir, errorRunId);
    fs.mkdirSync(errorRunDir, { recursive: true });

    const errorState = createInitialState(errorRunId, 'task', baseCommit, false);
    errorState.currentPhase = 6;
    errorState.phases['1'] = 'pending';
    errorState.phases['2'] = 'pending';
    errorState.phases['3'] = 'pending';
    errorState.phases['4'] = 'pending';
    errorState.phases['5'] = 'pending';
    errorState.phases['6'] = 'error';
    errorState.verifyRetries = 1;
    writeState(errorRunDir, errorState);
    writeRepoFile(repo.path, errorState.artifacts.evalReport, '# Eval Report\n\n## Summary\n\nresume error\n');

    await resumeRun(errorState, errorHarnessDir, errorRunDir, repo.path);
    expect(errorState.phases['6']).toBe('completed');
    expect(errorState.currentPhase).toBe(7);
    expect(lastCommitMessage(repo.path)).toBe(`harness[${errorRunId}]: Phase 6 — rev 2 eval report`);

    const storedRunId = 'resume-stored-run';
    const storedHarnessDir = path.join(repo.path, '.harness');
    const storedRunDir = path.join(storedHarnessDir, storedRunId);
    fs.mkdirSync(storedRunDir, { recursive: true });

    const storedState = createInitialState(storedRunId, 'task', baseCommit, false);
    storedState.currentPhase = 6;
    storedState.phases['1'] = 'pending';
    storedState.phases['2'] = 'pending';
    storedState.phases['3'] = 'pending';
    storedState.phases['4'] = 'pending';
    storedState.phases['5'] = 'pending';
    storedState.phases['6'] = 'in_progress';
    storedState.verifyRetries = 0;
    writeState(storedRunDir, storedState);
    writeRepoFile(repo.path, storedState.artifacts.evalReport, '# Eval Report\n\n## Summary\n\nstored result\n');
    fs.writeFileSync(
      path.join(storedRunDir, 'verify-result.json'),
      JSON.stringify({ exitCode: 0, hasSummary: true, timestamp: Date.now() }),
    );

    await resumeRun(storedState, storedHarnessDir, storedRunDir, repo.path);
    expect(lastCommitMessage(repo.path)).toBe(`harness[${storedRunId}]: Phase 6 — rev 1 eval report`);
  });
});
