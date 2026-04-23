import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('../../src/state.js', () => ({ writeState: vi.fn() }));
vi.mock('../../src/lock.js', () => ({ updateLockChild: vi.fn(), clearLockChild: vi.fn() }));
vi.mock('../../src/artifact.js', () => ({ runPhase6Preconditions: vi.fn() }));
vi.mock('../../src/process.js', () => ({
  getProcessStartTime: vi.fn(() => 0),
  isProcessGroupAlive: vi.fn(() => false),
  killProcessGroup: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('child_process', async (importActual) => {
  const actual = await importActual<typeof import('child_process')>();
  return { ...actual, spawn: vi.fn() };
});

import { readVerifyResult, isEvalReportValid, runVerifyPhase } from '../../src/phases/verify.js';
import * as preflightModule from '../../src/preflight.js';
import type { HarnessState, VerifyResult } from '../../src/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'verify-test-'));
}

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
});

function tmpDir(): string {
  const dir = makeTmpDir();
  tmpDirs.push(dir);
  return dir;
}

// ── readVerifyResult ──────────────────────────────────────────────────────────

describe('readVerifyResult', () => {
  it('parses valid JSON', () => {
    const dir = tmpDir();
    const result: VerifyResult = { exitCode: 0, hasSummary: true, timestamp: 1234567890 };
    fs.writeFileSync(path.join(dir, 'verify-result.json'), JSON.stringify(result));

    const parsed = readVerifyResult(dir);

    expect(parsed).not.toBeNull();
    expect(parsed!.exitCode).toBe(0);
    expect(parsed!.hasSummary).toBe(true);
    expect(parsed!.timestamp).toBe(1234567890);
  });

  it('returns null for missing file', () => {
    const dir = tmpDir();

    const parsed = readVerifyResult(dir);

    expect(parsed).toBeNull();
  });

  it('returns null for corrupt JSON', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'verify-result.json'), '{ not valid json {{');

    const parsed = readVerifyResult(dir);

    expect(parsed).toBeNull();
  });
});

// ── isEvalReportValid ─────────────────────────────────────────────────────────

describe('isEvalReportValid', () => {
  it('returns true when file has ## Summary', () => {
    const dir = tmpDir();
    const reportPath = path.join(dir, 'eval.md');
    fs.writeFileSync(reportPath, '# Eval Report\n\n## Summary\n\nAll tests passed.\n');

    expect(isEvalReportValid(reportPath)).toBe(true);
  });

  it('returns false when file is missing', () => {
    const dir = tmpDir();
    const reportPath = path.join(dir, 'eval.md');

    expect(isEvalReportValid(reportPath)).toBe(false);
  });

  it('returns false when file has no ## Summary', () => {
    const dir = tmpDir();
    const reportPath = path.join(dir, 'eval.md');
    fs.writeFileSync(reportPath, '# Eval Report\n\nSome content without summary heading.\n');

    expect(isEvalReportValid(reportPath)).toBe(false);
  });

  it('returns false for empty file', () => {
    const dir = tmpDir();
    const reportPath = path.join(dir, 'eval.md');
    fs.writeFileSync(reportPath, '');

    expect(isEvalReportValid(reportPath)).toBe(false);
  });
});

// ── Classification logic (via file-based helpers) ────────────────────────────

describe('classification: PASS — exitCode 0 + valid report', () => {
  it('readVerifyResult shows exitCode 0, isEvalReportValid true', () => {
    const dir = tmpDir();

    // Write verify-result.json as subprocess would
    const result: VerifyResult = { exitCode: 0, hasSummary: true, timestamp: Date.now() };
    fs.writeFileSync(path.join(dir, 'verify-result.json'), JSON.stringify(result));

    // Write a valid eval report
    const reportPath = path.join(dir, 'eval-report.md');
    fs.writeFileSync(reportPath, '# Eval\n\n## Summary\n\nPassed.\n');

    const parsed = readVerifyResult(dir);
    expect(parsed).not.toBeNull();
    expect(parsed!.exitCode).toBe(0);

    const valid = isEvalReportValid(reportPath);
    expect(valid).toBe(true);

    // Classification: exitCode == 0 && evalReportValid → PASS
    const isPass = parsed!.exitCode === 0 && valid;
    expect(isPass).toBe(true);
  });
});

describe('classification: FAIL — exitCode != 0 + hasSummary true → feedback saved', () => {
  it('copies eval report to verify-feedback.md', () => {
    const dir = tmpDir();

    // Write verify-result.json as subprocess would after failure
    const result: VerifyResult = { exitCode: 1, hasSummary: true, timestamp: Date.now() };
    fs.writeFileSync(path.join(dir, 'verify-result.json'), JSON.stringify(result));

    // Write an eval report with ## Summary
    const reportPath = path.join(dir, 'eval-report.md');
    const reportContent = '# Eval\n\n## Summary\n\nFailed checks:\n- Test 1 failed\n';
    fs.writeFileSync(reportPath, reportContent);

    const parsed = readVerifyResult(dir);
    expect(parsed).not.toBeNull();
    expect(parsed!.exitCode).toBe(1);
    expect(parsed!.hasSummary).toBe(true);

    // FAIL condition: exitCode != 0 && hasSummary == true
    const isFail = parsed!.exitCode !== 0 && parsed!.hasSummary;
    expect(isFail).toBe(true);

    // Simulate saving feedback
    const feedbackPath = path.join(dir, 'verify-feedback.md');
    fs.copyFileSync(reportPath, feedbackPath);

    expect(fs.existsSync(feedbackPath)).toBe(true);
    expect(fs.readFileSync(feedbackPath, 'utf-8')).toBe(reportContent);
  });
});

describe('classification: ERROR — exitCode != 0 + hasSummary false', () => {
  it('is an error when subprocess exits non-zero without summary', () => {
    const dir = tmpDir();

    // Write verify-result.json: exitCode != 0, hasSummary false
    const result: VerifyResult = { exitCode: 1, hasSummary: false, timestamp: Date.now() };
    fs.writeFileSync(path.join(dir, 'verify-result.json'), JSON.stringify(result));

    const parsed = readVerifyResult(dir);
    expect(parsed).not.toBeNull();
    expect(parsed!.exitCode).toBe(1);
    expect(parsed!.hasSummary).toBe(false);

    // ERROR condition: exitCode != 0 && hasSummary == false
    const isError = parsed!.exitCode !== 0 && !parsed!.hasSummary;
    expect(isError).toBe(true);
  });
});

describe('classification: ERROR — verify-result.json missing (subprocess crash)', () => {
  it('returns null from readVerifyResult — treated as error', () => {
    const dir = tmpDir();

    // Simulate subprocess crash: no verify-result.json written
    const parsed = readVerifyResult(dir);

    expect(parsed).toBeNull();
    // Null result maps to ERROR classification
    const isError = parsed === null;
    expect(isError).toBe(true);
  });
});

describe('runVerifyPhase — script resolution', () => {
  it('delegates script resolution to resolveVerifyScriptPath', async () => {
    const spy = vi.spyOn(preflightModule, 'resolveVerifyScriptPath').mockReturnValue(null);
    const dir = tmpDir();

    const state = {
      runId: 'test-run',
      phases: {},
      artifacts: { checklist: 'checklist.json', evalReport: 'eval.md' },
    } as unknown as HarnessState;

    try {
      await runVerifyPhase(state, dir, dir, dir);
    } catch {
      // expected — resolveVerifyScriptPath returns null → throws
    }

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('runVerifyPhase — docsRoot (FR-3/6)', () => {
  it('passes trackedRepos[0].path as docsRoot to runPhase6Preconditions when outer cwd differs', async () => {
    const outerCwd = tmpDir();
    const docsRootDir = path.join(outerCwd, 'repo-backend');
    fs.mkdirSync(docsRootDir);

    const { runPhase6Preconditions } = await import('../../src/artifact.js');
    const mockPreconditions = vi.mocked(runPhase6Preconditions);
    mockPreconditions.mockClear();

    const state = {
      runId: 'test-run',
      phases: {},
      artifacts: { checklist: 'checklist.json', evalReport: 'eval.md' },
      trackedRepos: [{ path: docsRootDir, baseCommit: 'abc', implRetryBase: 'abc', implHead: null }],
    } as unknown as HarnessState;

    vi.spyOn(preflightModule, 'resolveVerifyScriptPath').mockReturnValue(null);

    try {
      await runVerifyPhase(state, outerCwd, outerCwd, outerCwd);
    } catch {
      // expected — resolveVerifyScriptPath returns null → throws after preconditions
    }

    expect(mockPreconditions).toHaveBeenCalledWith('eval.md', 'test-run', docsRootDir, []);
  });

  it('falls back to outer cwd when trackedRepos is empty or path is empty', async () => {
    const outerCwd = tmpDir();

    const { runPhase6Preconditions } = await import('../../src/artifact.js');
    const mockPreconditions = vi.mocked(runPhase6Preconditions);
    mockPreconditions.mockClear();

    const state = {
      runId: 'test-run',
      phases: {},
      artifacts: { checklist: 'checklist.json', evalReport: 'eval.md' },
      trackedRepos: [{ path: '', baseCommit: 'abc', implRetryBase: 'abc', implHead: null }],
    } as unknown as HarnessState;

    vi.spyOn(preflightModule, 'resolveVerifyScriptPath').mockReturnValue(null);

    try {
      await runVerifyPhase(state, outerCwd, outerCwd, outerCwd);
    } catch {
      // expected
    }

    expect(mockPreconditions).toHaveBeenCalledWith('eval.md', 'test-run', outerCwd, []);
  });
});
