import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { HarnessState } from '../../src/types.js';
import { createInitialState } from '../../src/state.js';
import { getGateRetryLimit } from '../../src/config.js';
import { FileSessionLogger, computeRepoKey } from '../../src/logger.js';
import { __resetWarnCache } from '../../src/phases/stagnation.js';

vi.mock('../../src/phases/interactive.js', () => ({
  runInteractivePhase: vi.fn(),
  preparePhase: vi.fn(),
  checkSentinelFreshness: vi.fn(),
  validatePhaseArtifacts: vi.fn(),
}));

vi.mock('../../src/phases/gate.js', () => ({
  runGatePhase: vi.fn(),
  checkGateSidecars: vi.fn(),
  buildGateResult: vi.fn(),
  parseVerdict: vi.fn(),
}));

vi.mock('../../src/phases/verify.js', () => ({
  runVerifyPhase: vi.fn(),
  readVerifyResult: vi.fn(),
  isEvalReportValid: vi.fn(),
}));

vi.mock('../../src/ui.js', () => ({
  promptChoice: vi.fn(),
  printPhaseTransition: vi.fn(),
  renderControlPanel: vi.fn(),
  printWarning: vi.fn(),
  printError: vi.fn(),
  printSuccess: vi.fn(),
  printInfo: vi.fn(),
}));

vi.mock('../../src/artifact.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/artifact.js')>();
  return { ...actual, commitEvalReport: vi.fn().mockReturnValue('committed'), normalizeArtifactCommit: vi.fn().mockReturnValue(true), runPhase6Preconditions: vi.fn() };
});

vi.mock('../../src/git.js', () => ({
  getHead: vi.fn().mockReturnValue('mock-sha'),
  getGitRoot: vi.fn(),
  isAncestor: vi.fn(),
  isWorkingTreeClean: vi.fn(),
  hasStagedChanges: vi.fn(),
  getStagedFiles: vi.fn(),
  getFileStatus: vi.fn(),
  generateRunId: vi.fn(),
  detectExternalCommits: vi.fn(),
  isPathGitignored: vi.fn().mockReturnValue(false),
}));

vi.mock('../../src/state.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/state.js')>();
  return { ...actual, writeState: vi.fn() };
});

import { handleGateReject, __resetDetectors } from '../../src/phases/runner.js';
import { promptChoice } from '../../src/ui.js';
import { InputManager } from '../../src/input.js';

const tmpDirs: string[] = [];

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  __resetDetectors();
  __resetWarnCache();
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs.length = 0;
});

function makeTmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stagnation-int-'));
  tmpDirs.push(d);
  return d;
}

function makeTestLogger(runId: string): { logger: FileSessionLogger; eventsPath: string; cleanup: () => void } {
  const harnessDir = makeTmpDir();
  const sessionsRoot = path.join(harnessDir, 'sessions');
  const logger = new FileSessionLogger(runId, harnessDir, { sessionsRoot });
  logger.writeMeta({ task: 't' });
  const eventsPath = path.join(sessionsRoot, computeRepoKey(harnessDir), runId, 'events.jsonl');
  return { logger, eventsPath, cleanup: () => {} };
}

function readEvents(eventsPath: string): any[] {
  if (!fs.existsSync(eventsPath)) return [];
  return fs.readFileSync(eventsPath, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function makeState(overrides: Partial<HarnessState> = {}): HarnessState {
  return { ...createInitialState('int-run', '/task.md', 'sha', false), ...overrides };
}

const HDIR = '/tmp/harness-dir';
const CWD = '/tmp/cwd';
const FULL_LIMIT = getGateRetryLimit('full');
const STAGNANT = 'plan does not cover spec requirements; tests are missing; edge cases unhandled';

// ─── Test 10: Integration — 3 stagnant rejects → event ordering ──────────────

describe('Integration Test 10: 3 stagnant auto-mode rejects → gate_retry×2, gate_stagnation, escalation(gate-stagnation), no force_pass', () => {
  it('events appear in correct order with no force_pass', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ autoMode: true, currentPhase: 2 });
    const { logger, eventsPath } = makeTestLogger(state.runId);

    vi.mocked(promptChoice).mockResolvedValueOnce('Q');

    // 3 rejects with identical feedback
    await handleGateReject(2, STAGNANT, undefined, 0, state, HDIR, runDir, CWD, new InputManager(), logger);
    await handleGateReject(2, STAGNANT, undefined, 1, state, HDIR, runDir, CWD, new InputManager(), logger);
    await handleGateReject(2, STAGNANT, undefined, 2, state, HDIR, runDir, CWD, new InputManager(), logger);

    const events = readEvents(eventsPath);

    // gate_retry × 2 (retryIndex 0 and 1 only; retryIndex 2 goes to stagnation)
    const gateRetries = events.filter((e: any) => e.event === 'gate_retry');
    expect(gateRetries).toHaveLength(2);
    expect(gateRetries[0].retryIndex).toBe(0);
    expect(gateRetries[1].retryIndex).toBe(1);

    // gate_stagnation × 1
    const stagnations = events.filter((e: any) => e.event === 'gate_stagnation');
    expect(stagnations).toHaveLength(1);
    expect(stagnations[0].phase).toBe(2);
    expect(stagnations[0].action).toBe('escalate');
    expect(stagnations[0].threshold).toBe(0.70);

    // escalation × 1 with reason gate-stagnation
    const escalations = events.filter((e: any) => e.event === 'escalation');
    expect(escalations).toHaveLength(1);
    expect(escalations[0].reason).toBe('gate-stagnation');
    expect(escalations[0].phase).toBe(2);

    // NO force_pass
    expect(events.filter((e: any) => e.event === 'force_pass')).toHaveLength(0);

    // Order: last gate_retry < gate_stagnation < escalation
    const lastRetryIdx  = events.map((e: any, i: number) => e.event === 'gate_retry'      ? i : -1).filter(i => i >= 0).pop()!;
    const stagnationIdx = events.findIndex((e: any) => e.event === 'gate_stagnation');
    const escalationIdx = events.findIndex((e: any) => e.event === 'escalation');
    expect(lastRetryIdx).toBeLessThan(stagnationIdx);
    expect(stagnationIdx).toBeLessThan(escalationIdx);
  });
});

// ─── Test 11: Regression — pre-existing event shapes are unchanged ─────────────

describe('Integration Test 11: regression — force_pass and escalation event shapes unchanged for non-stagnant runs', () => {
  it('non-stagnant auto-mode run produces force_pass with by=auto, no gate_stagnation', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ autoMode: true, currentPhase: 2 });
    const { logger, eventsPath } = makeTestLogger(state.runId);

    const feedback = ['the type signatures are wrong', 'missing null check in handler', 'lint errors in new file'];
    for (let i = 0; i < FULL_LIMIT; i++) {
      await handleGateReject(2, feedback[i] ?? `distinct feedback ${i}`, undefined, i, state, HDIR, runDir, CWD, new InputManager(), logger);
    }

    const events = readEvents(eventsPath);
    const forcePass = events.find((e: any) => e.event === 'force_pass');
    expect(forcePass).toBeDefined();
    expect(forcePass.by).toBe('auto');
    expect(forcePass.phase).toBe(2);
    expect(events.find((e: any) => e.event === 'gate_stagnation')).toBeUndefined();
  });
});
