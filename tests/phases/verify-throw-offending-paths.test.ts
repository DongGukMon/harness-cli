import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import type { HarnessState } from '../../src/types.js';
import { createInitialState } from '../../src/state.js';
import { FileSessionLogger, computeRepoKey } from '../../src/logger.js';

// SC9 — `phase_end.details.offendingPaths` enrichment in handleVerifyPhase.
//
// When runVerifyPhase throws with a `Working tree must be clean before
// verification: dirty paths: …` shape (R3.b), the runner.ts catch block uses
// parseOffendingPaths to extract the path list and surface it via
// `phase_end.details.offendingPaths` (R3.d). For any other throw shape, the
// field is omitted entirely.

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
  return {
    ...actual,
    commitEvalReport: vi.fn().mockReturnValue('committed'),
    normalizeArtifactCommit: vi.fn().mockReturnValue(true),
    runPhase6Preconditions: vi.fn().mockReturnValue({ extendedBaseline: [] }),
  };
});

vi.mock('../../src/git.js', () => ({
  getHead: vi.fn().mockReturnValue('mock-head-sha'),
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

import { handleVerifyPhase } from '../../src/phases/runner.js';
import { runVerifyPhase } from '../../src/phases/verify.js';
import { promptChoice } from '../../src/ui.js';
import { InputManager } from '../../src/input.js';

const tmpDirs: string[] = [];

afterEach(() => {
  vi.clearAllMocks();
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  tmpDirs.length = 0;
});

function makeTmpDir(prefix = 'verify-throw-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function makeTestLogger(runId: string): { logger: FileSessionLogger; eventsPath: string } {
  const harnessDir = makeTmpDir('verify-throw-hdir-');
  const sessionsRoot = path.join(harnessDir, 'sessions');
  const logger = new FileSessionLogger(runId, harnessDir, { sessionsRoot });
  logger.writeMeta({ task: 'verify-throw-test' });
  const eventsPath = path.join(sessionsRoot, computeRepoKey(harnessDir), runId, 'events.jsonl');
  return { logger, eventsPath };
}

function readEvents(eventsPath: string): any[] {
  if (!fs.existsSync(eventsPath)) return [];
  return fs.readFileSync(eventsPath, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function makeState(overrides: Partial<HarnessState> = {}): HarnessState {
  return { ...createInitialState('verify-throw-run', '/task.md', 'sha', false), ...overrides };
}

const HDIR = '/tmp/harness-dir';
const CWD = '/tmp/cwd';

describe('handleVerifyPhase — phase_end.details.offendingPaths enrichment (SC9)', () => {
  it('emits phase_end.details.offendingPaths when precondition throws with R3.b prefix', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 6, verifyRetries: 0 });
    const { logger, eventsPath } = makeTestLogger(state.runId);

    // Shape mirrors runPhase6Preconditions Step 2 throw (R3.b): the path list
    // comes from porcelain lines, so each entry retains the XY prefix.
    const throwMsg =
      'Working tree must be clean before verification: dirty paths:  M src/foo.ts';
    vi.mocked(runVerifyPhase).mockRejectedValueOnce(new Error(throwMsg));
    vi.mocked(promptChoice).mockResolvedValueOnce('Q'); // quit out of handleVerifyError

    await handleVerifyPhase(state, HDIR, runDir, CWD, new InputManager(), logger);

    const events = readEvents(eventsPath);
    const phaseEnd = events.find((e: any) => e.event === 'phase_end' && e.phase === 6);
    expect(phaseEnd).toBeDefined();
    expect(phaseEnd.status).toBe('failed');
    expect(phaseEnd.details).toBeDefined();
    expect(phaseEnd.details.reason).toBe('verify_throw');
    expect(Array.isArray(phaseEnd.details.offendingPaths)).toBe(true);
    expect(phaseEnd.details.offendingPaths.length).toBeGreaterThan(0);
    // The porcelain XY prefix may be preserved; assert the file path is contained.
    expect(phaseEnd.details.offendingPaths.some((p: string) => p.includes('src/foo.ts'))).toBe(true);
  });

  it('emits phase_end.details.offendingPaths for the staged-files R3.b variant', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 6, verifyRetries: 0 });
    const { logger, eventsPath } = makeTestLogger(state.runId);

    // The other R3.b shape from Step 1 (staged files outside eval report).
    const throwMsg =
      'Working tree must be clean before verification: staged files outside eval report: src/bar.ts, src/baz.ts';
    vi.mocked(runVerifyPhase).mockRejectedValueOnce(new Error(throwMsg));
    vi.mocked(promptChoice).mockResolvedValueOnce('Q');

    await handleVerifyPhase(state, HDIR, runDir, CWD, new InputManager(), logger);

    const events = readEvents(eventsPath);
    const phaseEnd = events.find((e: any) => e.event === 'phase_end' && e.phase === 6);
    expect(phaseEnd).toBeDefined();
    expect(phaseEnd.details.reason).toBe('verify_throw');
    expect(phaseEnd.details.offendingPaths).toEqual(['src/bar.ts', 'src/baz.ts']);
  });

  it('omits details.offendingPaths when the caught error has a non-"Working tree" prefix', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 6, verifyRetries: 0 });
    const { logger, eventsPath } = makeTestLogger(state.runId);

    vi.mocked(runVerifyPhase).mockRejectedValueOnce(new Error('unrelated failure not about working tree'));
    vi.mocked(promptChoice).mockResolvedValueOnce('Q');

    await handleVerifyPhase(state, HDIR, runDir, CWD, new InputManager(), logger);

    const events = readEvents(eventsPath);
    const phaseEnd = events.find((e: any) => e.event === 'phase_end' && e.phase === 6);
    expect(phaseEnd).toBeDefined();
    expect(phaseEnd.details).toEqual({ reason: 'verify_throw' });
    // Key must be absent (per spec R3.d "omitted entirely")
    expect('offendingPaths' in phaseEnd.details).toBe(false);
  });
});
