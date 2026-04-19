import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HarnessState } from '../../src/types.js';
import { createInitialState, writeState } from '../../src/state.js';
import { NoopLogger } from '../../src/logger.js';
import { InputManager } from '../../src/input.js';
import { GATE_RETRY_LIMIT_FULL as GATE_RETRY_LIMIT } from '../../src/config.js';

vi.mock('../../src/ui.js', () => ({
  promptChoice: vi.fn(),
  printPhaseTransition: vi.fn(),
  renderControlPanel: vi.fn(),
  printWarning: vi.fn(),
  printError: vi.fn(),
  printSuccess: vi.fn(),
  printInfo: vi.fn(),
}));

vi.mock('../../src/git.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/git.js')>();
  return {
    ...actual,
    getHead: vi.fn().mockReturnValue('mock-head-sha'),
    isAncestor: vi.fn().mockReturnValue(true),
    detectExternalCommits: vi.fn().mockReturnValue([]),
  };
});

vi.mock('../../src/phases/runner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/phases/runner.js')>();
  return {
    ...actual,
    runPhaseLoop: vi.fn().mockResolvedValue(undefined),
  };
});

import { promptChoice } from '../../src/ui.js';
import { handleGateEscalation } from '../../src/phases/runner.js';
import { resumeRun } from '../../src/resume.js';

const tmpDirs: string[] = [];

afterEach(() => {
  vi.clearAllMocks();
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
});

function makeTmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function makeState(overrides: Partial<HarnessState> = {}): HarnessState {
  return {
    ...createInitialState('gate-resume-run', 'task', 'base-sha', false),
    ...overrides,
  };
}

function createNoOpInputManager(): InputManager {
  return new InputManager();
}

describe('resume gate escalation replay', () => {
  it('parses raw reviewer comments before replaying show_escalation', async () => {
    const liveRunDir = makeTmpDir('gate-live-');
    const liveState = makeState({
      currentPhase: 2,
      gateRetries: { '2': GATE_RETRY_LIMIT, '4': 0, '7': 0 },
    });

    vi.mocked(promptChoice).mockResolvedValueOnce('Q');
    await handleGateEscalation(
      2,
      'P1: keep the reviewer body raw',
      undefined,
      2,
      liveState,
      liveRunDir,
      liveRunDir,
      createNoOpInputManager(),
      new NoopLogger(),
    );

    const liveArchive = fs.readFileSync(
      path.join(liveRunDir, 'gate-2-cycle-0-retry-2-feedback.md'),
      'utf-8',
    );

    const cwd = makeTmpDir('gate-resume-cwd-');
    const harnessDir = path.join(cwd, '.harness');
    const runDir = path.join(harnessDir, 'gate-resume-run');
    fs.mkdirSync(runDir, { recursive: true });

    const state = makeState({
      currentPhase: 2,
      status: 'paused',
      pauseReason: 'gate-escalation',
      gateRetries: { '2': GATE_RETRY_LIMIT, '4': 0, '7': 0 },
      pendingAction: {
        type: 'show_escalation',
        targetPhase: 2,
        sourcePhase: 1,
        feedbackPaths: [path.join(runDir, 'gate-2-feedback.md')],
      },
    });
    writeState(runDir, state);

    fs.writeFileSync(
      path.join(runDir, 'gate-2-feedback.md'),
      '# Gate 2 Feedback\n\n## Reviewer Comments\n\nP1: keep the reviewer body raw\n',
    );

    vi.mocked(promptChoice).mockResolvedValueOnce('Q');
    await resumeRun(state, harnessDir, runDir, cwd);

    const resumedArchive = fs.readFileSync(
      path.join(runDir, 'gate-2-cycle-0-retry-2-feedback.md'),
      'utf-8',
    );

    expect(resumedArchive).toBe(liveArchive);
    expect(resumedArchive).toContain('P1: keep the reviewer body raw');
    expect(resumedArchive).not.toContain('# Gate 2 Feedback\n\n## Reviewer Comments\n\n# Gate 2 Feedback');
  });
});
