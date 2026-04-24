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

vi.mock('../../src/artifact.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/artifact.js')>();
  return {
    ...actual,
    commitEvalReport: vi.fn().mockReturnValue('committed'),
    normalizeArtifactCommit: vi.fn(),
    runPhase6Preconditions: vi.fn(),
  };
});

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

  it('happy path: P1 → P2(APPROVE) → P5 → P6 → P7(APPROVE) and reaches TERMINAL_PHASE', async () => {
    const state = createInitialState('r1', 'dummy', 'base-sha', false, false, 'light');
    writeState(runDir, state);

    // Create spec file — Gate 2 assembler reads it
    fs.writeFileSync(path.join(cwd, 'docs/specs/r1-design.md'), '# combined spec');

    // Phase 1
    vi.mocked(runInteractivePhase).mockImplementationOnce(async (_p: any, st: any, _h: any, _r: any, _c: any, aid: any) => {
      st.phases['1'] = 'completed';
      return { status: 'completed', attemptId: aid } as any;
    });

    // Gate 2 APPROVE (runs before Gate 7)
    vi.mocked(runGatePhase).mockResolvedValueOnce({
      type: 'verdict', verdict: 'APPROVE', comments: '',
      rawOutput: '## Verdict\nAPPROVE\n', runner: 'codex',
      durationMs: 1, tokensTotal: 0, promptBytes: 0,
      codexSessionId: 's-gate2', recoveredFromSidecar: false,
      resumedFrom: null, resumeFallback: false,
      sourcePreset: { model: 'gpt-5.5', effort: 'high' },
    } as any);

    // Phase 5
    vi.mocked(runInteractivePhase).mockImplementationOnce(async (_p: any, st: any, _h: any, _r: any, _c: any, aid: any) => {
      st.phases['5'] = 'completed';
      st.implCommit = 'impl-sha';
      return { status: 'completed', attemptId: aid } as any;
    });

    // Gate 7 APPROVE
    vi.mocked(runGatePhase).mockResolvedValueOnce({
      type: 'verdict', verdict: 'APPROVE', comments: '',
      rawOutput: '## Verdict\nAPPROVE\n', runner: 'codex',
      durationMs: 1, tokensTotal: 0, promptBytes: 0,
      codexSessionId: 's-gate7', recoveredFromSidecar: false,
      resumedFrom: null, resumeFallback: false,
      sourcePreset: { model: 'gpt-5.5', effort: 'high' },
    } as any);

    const logger = new NoopLogger();
    await runPhaseLoop(state, harnessDir, runDir, cwd, createNoOpInputManager(), logger, { value: false });

    const persisted = readState(runDir)!;
    expect(persisted.flow).toBe('light');
    expect(persisted.phases['1']).toBe('completed');
    expect(persisted.phases['2']).toBe('completed');   // P2 now active and APPROVED
    expect(persisted.phases['3']).toBe('skipped');
    expect(persisted.phases['4']).toBe('skipped');
    expect(persisted.phases['5']).toBe('completed');
    expect(persisted.phases['7']).toBe('completed');
    expect(persisted.status).toBe('completed');
  });

  it('seeded P1=done P2=pending: Gate 2 APPROVE skips P3/P4 and loop advances to P5 (SC#4)', async () => {
    const state = createInitialState('r1', 'dummy', 'base-sha', false, false, 'light');
    state.phases['1'] = 'completed';
    state.phases['2'] = 'pending';
    state.phases['3'] = 'skipped';
    state.phases['4'] = 'skipped';
    state.currentPhase = 2;
    writeState(runDir, state);

    fs.writeFileSync(path.join(cwd, 'docs/specs/r1-design.md'), '# combined spec');

    vi.mocked(runGatePhase).mockResolvedValueOnce({
      type: 'verdict', verdict: 'APPROVE', comments: '',
      rawOutput: '## Verdict\nAPPROVE\n', runner: 'codex',
      durationMs: 1, tokensTotal: 0, promptBytes: 0,
      codexSessionId: 's-gate2', recoveredFromSidecar: false,
      resumedFrom: null, resumeFallback: false,
      sourcePreset: { model: 'gpt-5.5', effort: 'high' },
    } as any);

    // Phase 5 fails immediately so the loop stops there
    vi.mocked(runInteractivePhase).mockResolvedValueOnce({
      status: 'failed', attemptId: 'aid-5',
    } as any);

    const logger = new NoopLogger();
    await runPhaseLoop(state, harnessDir, runDir, cwd, createNoOpInputManager(), logger, { value: false });

    const persisted = readState(runDir)!;
    expect(persisted.phases['2']).toBe('completed');
    expect(persisted.phases['3']).toBe('skipped');    // loop short-circuited P3
    expect(persisted.phases['4']).toBe('skipped');    // loop short-circuited P4
    expect(persisted.phases['5']).toBe('failed');     // reached P5
  });

  it('Gate-2 REJECT reopens Phase 1 with feedbackPaths, no carryoverFeedback (SC#5)', async () => {
    const state = createInitialState('r1', 'dummy', 'base-sha', false, false, 'light');
    state.phases['1'] = 'completed';
    state.phases['2'] = 'pending';
    state.currentPhase = 2;
    writeState(runDir, state);

    fs.writeFileSync(path.join(cwd, 'docs/specs/r1-design.md'), '# spec content');

    vi.mocked(runGatePhase).mockResolvedValueOnce({
      type: 'verdict', verdict: 'REJECT', comments: 'missing open questions',
      rawOutput: '## Verdict\nREJECT\nScope: design\n## Comments\n- **[P1]** — Location: spec\n  Issue: no OQ\n',
      runner: 'codex',
      durationMs: 1, tokensTotal: 0, promptBytes: 0,
      codexSessionId: 's-gate2', recoveredFromSidecar: false,
      resumedFrom: null, resumeFallback: false,
      sourcePreset: { model: 'gpt-5.5', effort: 'high' },
    } as any);

    const logger = new NoopLogger();
    await handleGatePhase(2, state, harnessDir, runDir, cwd, createNoOpInputManager(), logger, { value: false });

    const persisted = readState(runDir)!;
    expect(persisted.currentPhase).toBe(1);
    expect(persisted.phases['1']).toBe('pending');
    expect(persisted.phaseReopenFlags['1']).toBe(true);
    expect(persisted.pendingAction).not.toBeNull();
    expect(persisted.pendingAction?.feedbackPaths.length).toBeGreaterThan(0);
    expect(persisted.pendingAction?.feedbackPaths[0]).toMatch(/gate-2-feedback\.md$/);
    // ADR-18: no carryoverFeedback at P2 REJECT (unlike P7 REJECT in light flow)
    expect(persisted.carryoverFeedback).toBeNull();
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
      sourcePreset: { model: 'gpt-5.5', effort: 'high' },
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
