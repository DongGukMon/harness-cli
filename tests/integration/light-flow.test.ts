import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

vi.mock('../../src/phases/interactive.js', () => ({
  runInteractivePhase: vi.fn(),
  preparePhase: vi.fn(),
  checkSentinelFreshness: vi.fn(),
  validatePhaseArtifacts: vi.fn(() => true),
}));

vi.mock('../../src/phases/gate.js', () => ({
  runGatePhase: vi.fn(),
  checkGateSidecars: vi.fn(() => null),
  buildGateResult: vi.fn(),
  parseVerdict: vi.fn(),
}));

vi.mock('../../src/phases/verify.js', () => ({
  runVerifyPhase: vi.fn(async () => ({ type: 'pass' } as const)),
  readVerifyResult: vi.fn(() => null),
  isEvalReportValid: vi.fn(() => true),
}));

vi.mock('../../src/artifact.js', () => ({
  normalizeArtifactCommit: vi.fn(),
  runPhase6Preconditions: vi.fn(),
}));

vi.mock('../../src/git.js', () => ({
  getHead: vi.fn(() => 'mock-head'),
  getGitRoot: vi.fn(() => '/'),
  isAncestor: vi.fn(() => true),
  detectExternalCommits: vi.fn(() => []),
}));

vi.mock('../../src/ui.js', () => ({
  promptChoice: vi.fn(),
  printPhaseTransition: vi.fn(),
  renderControlPanel: vi.fn(),
  printWarning: vi.fn(),
  printError: vi.fn(),
  printSuccess: vi.fn(),
  printInfo: vi.fn(),
  printAdvisorReminder: vi.fn(),
}));

import { runPhaseLoop, handleGatePhase } from '../../src/phases/runner.js';
import { runInteractivePhase } from '../../src/phases/interactive.js';
import { runGatePhase } from '../../src/phases/gate.js';
import { createInitialState, writeState, readState } from '../../src/state.js';
import { NoopLogger } from '../../src/logger.js';
import { InputManager } from '../../src/input.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'light-flow-int-'));
}

function createNoOpInputManager(): InputManager {
  return new InputManager();
}

describe('light-flow end-to-end (P1 → P5 → P6 → P7)', () => {
  let harnessDir: string;
  let runDir: string;
  let cwd: string;

  beforeEach(() => {
    vi.mocked(runInteractivePhase).mockReset();
    vi.mocked(runGatePhase).mockReset();
    cwd = makeTmpDir();
    harnessDir = path.join(cwd, '.harness');
    const runId = 'r1';
    runDir = path.join(harnessDir, runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.mkdirSync(path.join(cwd, 'docs/specs'), { recursive: true });
    fs.mkdirSync(path.join(cwd, 'docs/process/evals'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('happy path: approves at Gate 7 and reaches TERMINAL_PHASE', async () => {
    const state = createInitialState('r1', 'dummy', 'base-sha', false, false, 'light');
    writeState(runDir, state);

    vi.mocked(runInteractivePhase).mockImplementationOnce(async (_p: any, st: any, _h: any, _r: any, _c: any, aid: any) => {
      st.phases['1'] = 'completed';
      return { status: 'completed', attemptId: aid } as any;
    });
    vi.mocked(runInteractivePhase).mockImplementationOnce(async (_p: any, st: any, _h: any, _r: any, _c: any, aid: any) => {
      st.phases['5'] = 'completed';
      st.implCommit = 'impl-sha';
      return { status: 'completed', attemptId: aid } as any;
    });

    vi.mocked(runGatePhase).mockResolvedValueOnce({
      type: 'verdict', verdict: 'APPROVE', comments: '',
      rawOutput: '## Verdict\nAPPROVE\n', runner: 'codex',
      durationMs: 1, tokensTotal: 0, promptBytes: 0,
      codexSessionId: 's', recoveredFromSidecar: false,
      resumedFrom: null, resumeFallback: false,
      sourcePreset: { model: 'gpt-5.4', effort: 'high' },
    } as any);

    const logger = new NoopLogger();
    await runPhaseLoop(state, harnessDir, runDir, cwd, createNoOpInputManager(), logger, { value: false });

    const persisted = readState(runDir)!;
    expect(persisted.flow).toBe('light');
    expect(persisted.phases['2']).toBe('skipped');
    expect(persisted.phases['3']).toBe('skipped');
    expect(persisted.phases['4']).toBe('skipped');
    expect(persisted.phases['1']).toBe('completed');
    expect(persisted.phases['5']).toBe('completed');
    expect(persisted.phases['7']).toBe('completed');
    expect(persisted.status).toBe('completed');
  });

  it('Gate-7 REJECT reopens Phase 1 and records carryoverFeedback', async () => {
    const state = createInitialState('r1', 'dummy', 'base-sha', false, false, 'light');
    state.phases['1'] = 'completed';
    state.phases['5'] = 'completed';
    state.phases['6'] = 'completed';
    state.currentPhase = 7;
    writeState(runDir, state);

    vi.mocked(runGatePhase).mockResolvedValueOnce({
      type: 'verdict', verdict: 'REJECT', comments: 'fix design',
      rawOutput: '## Verdict\nREJECT\n## Comments\n- **[P1]** fix\n',
      runner: 'codex',
      durationMs: 1, tokensTotal: 0, promptBytes: 0,
      codexSessionId: 's', recoveredFromSidecar: false,
      resumedFrom: null, resumeFallback: false,
      sourcePreset: { model: 'gpt-5.4', effort: 'high' },
    } as any);

    const logger = new NoopLogger();
    await handleGatePhase(7, state, harnessDir, runDir, cwd, createNoOpInputManager(), logger, { value: false });

    const persisted = readState(runDir)!;
    expect(persisted.currentPhase).toBe(1);
    expect(persisted.phases['1']).toBe('pending');
    expect(persisted.phases['5']).toBe('pending');
    expect(persisted.phases['6']).toBe('pending');
    expect(persisted.phaseReopenFlags['1']).toBe(true);
    expect(persisted.carryoverFeedback).not.toBeNull();
    expect(persisted.carryoverFeedback?.deliverToPhase).toBe(5);
    expect(persisted.carryoverFeedback?.paths[0]).toMatch(/gate-7-feedback\.md$/);
  });
});
