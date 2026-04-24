import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  invalidatePhaseSessionsOnPresetChange,
  invalidatePhaseSessionsOnJump,
} from '../src/state.js';
import type { HarnessState, GateSessionInfo } from '../src/types.js';

function makeSession(model: string, effort: string): GateSessionInfo {
  return { sessionId: 'abc-123', runner: 'codex', model, effort, lastOutcome: 'reject' };
}

function makeState(): HarnessState {
  return {
    runId: 'r1', flow: 'full', carryoverFeedback: null,
    currentPhase: 2, status: 'in_progress', autoMode: false,
    task: 't', baseCommit: '', implRetryBase: '',
    trackedRepos: [{ path: '', baseCommit: '', implRetryBase: '', implHead: null }],
    codexPath: null,
    externalCommitsDetected: false,
    artifacts: { spec: 's', plan: 'p', decisionLog: 'd', checklist: 'c', evalReport: 'e' },
    phases: { '1': 'pending', '2': 'pending', '3': 'pending', '4': 'pending', '5': 'pending', '6': 'pending', '7': 'pending' },
    gateRetries: { '2': 0, '4': 0, '7': 0 },
    verifyRetries: 0,
    pauseReason: null, specCommit: null, planCommit: null, implCommit: null,
    evalCommit: null, verifiedAtHead: null, pausedAtHead: null, pendingAction: null,
    phaseOpenedAt: { '1': null, '3': null, '5': null },
    phaseAttemptId: { '1': null, '3': null, '5': null },
    phasePresets: { '1': 'opus-xhigh', '2': 'codex-high', '3': 'sonnet-high', '4': 'codex-high', '5': 'sonnet-high', '7': 'codex-high' },
    phaseReopenFlags: { '1': false, '3': false, '5': false },
    phaseCodexSessions: { '2': null, '4': null, '7': null },
    phaseClaudeSessions: { '1': null, '3': null, '5': null },
    lastWorkspacePid: null, lastWorkspacePidStartTime: null,
    tmuxSession: '', tmuxMode: 'dedicated', tmuxWindows: [],
    tmuxControlWindow: '', tmuxWorkspacePane: '', tmuxControlPane: '',
    loggingEnabled: false,
    phaseReopenSource: { '1': null, '3': null, '5': null },
    codexNoIsolate: false,
    dirtyBaseline: [],
  };
}

let runDir: string;
beforeEach(() => { runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-inv-')); });

describe('invalidatePhaseSessionsOnPresetChange', () => {
  it('nulls sessions and deletes replay sidecars for changed phases only', () => {
    const state = makeState();
    state.phaseCodexSessions['2'] = makeSession('gpt-5.5', 'high');
    state.phaseCodexSessions['4'] = makeSession('gpt-5.5', 'high');
    state.phaseCodexSessions['7'] = makeSession('gpt-5.5', 'high');
    const prev = { ...state.phasePresets };
    // phase 2 preset 변경
    state.phasePresets['2'] = 'sonnet-high';
    for (const p of [2, 4, 7]) {
      fs.writeFileSync(path.join(runDir, `gate-${p}-raw.txt`), 'x');
      fs.writeFileSync(path.join(runDir, `gate-${p}-result.json`), '{}');
      fs.writeFileSync(path.join(runDir, `gate-${p}-feedback.md`), 'f');
    }
    invalidatePhaseSessionsOnPresetChange(state, prev, runDir);

    expect(state.phaseCodexSessions['2']).toBeNull();
    expect(state.phaseCodexSessions['4']).not.toBeNull();
    expect(state.phaseCodexSessions['7']).not.toBeNull();
    expect(fs.existsSync(path.join(runDir, 'gate-2-raw.txt'))).toBe(false);
    expect(fs.existsSync(path.join(runDir, 'gate-2-result.json'))).toBe(false);
    expect(fs.existsSync(path.join(runDir, 'gate-2-feedback.md'))).toBe(true);
    expect(fs.existsSync(path.join(runDir, 'gate-4-raw.txt'))).toBe(true);
  });

  it('is no-op when no preset changed', () => {
    const state = makeState();
    state.phaseCodexSessions['2'] = makeSession('gpt-5.5', 'high');
    const prev = { ...state.phasePresets };
    invalidatePhaseSessionsOnPresetChange(state, prev, runDir);
    expect(state.phaseCodexSessions['2']).not.toBeNull();
  });

  it('tolerates missing sidecar files', () => {
    const state = makeState();
    const prev = { ...state.phasePresets };
    state.phasePresets['4'] = 'sonnet-high';
    expect(() =>
      invalidatePhaseSessionsOnPresetChange(state, prev, runDir),
    ).not.toThrow();
  });
});

describe('invalidatePhaseSessionsOnJump', () => {
  it('nulls sessions and deletes replay sidecars at or after targetPhase', () => {
    const state = makeState();
    state.phaseCodexSessions['2'] = makeSession('gpt-5.5', 'high');
    state.phaseCodexSessions['4'] = makeSession('gpt-5.5', 'high');
    state.phaseCodexSessions['7'] = makeSession('gpt-5.5', 'high');
    for (const p of [2, 4, 7]) {
      fs.writeFileSync(path.join(runDir, `gate-${p}-raw.txt`), 'x');
      fs.writeFileSync(path.join(runDir, `gate-${p}-result.json`), '{}');
      fs.writeFileSync(path.join(runDir, `gate-${p}-feedback.md`), 'f');
    }
    invalidatePhaseSessionsOnJump(state, 4, runDir);

    expect(state.phaseCodexSessions['2']).not.toBeNull();
    expect(state.phaseCodexSessions['4']).toBeNull();
    expect(state.phaseCodexSessions['7']).toBeNull();
    expect(fs.existsSync(path.join(runDir, 'gate-2-raw.txt'))).toBe(true);
    expect(fs.existsSync(path.join(runDir, 'gate-4-raw.txt'))).toBe(false);
    expect(fs.existsSync(path.join(runDir, 'gate-7-raw.txt'))).toBe(false);
    // feedback 보존
    expect(fs.existsSync(path.join(runDir, 'gate-4-feedback.md'))).toBe(true);
    expect(fs.existsSync(path.join(runDir, 'gate-7-feedback.md'))).toBe(true);
  });

  it('targetPhase=2: all gate sessions invalidated', () => {
    const state = makeState();
    state.phaseCodexSessions['2'] = makeSession('gpt-5.5', 'high');
    state.phaseCodexSessions['4'] = makeSession('gpt-5.5', 'high');
    state.phaseCodexSessions['7'] = makeSession('gpt-5.5', 'high');
    invalidatePhaseSessionsOnJump(state, 2, runDir);
    expect(state.phaseCodexSessions).toEqual({ '2': null, '4': null, '7': null });
  });
});
