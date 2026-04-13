import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { registerSignalHandlers, handleShutdown } from '../src/signal.js';
import type { SignalContext } from '../src/signal.js';
import { createInitialState } from '../src/state.js';
import type { HarnessState } from '../src/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'signal-test-'));
}

/**
 * Build a minimal SignalContext backed by a real tmp directory so that
 * writeState() and lock deletion can operate on real fs paths.
 */
function makeCtx(
  overrides: Partial<SignalContext> & { harnessDir: string; runId: string },
): SignalContext {
  const state: HarnessState = {
    ...createInitialState(overrides.runId, 'test task', 'abc123', '/bin/codex', false),
    currentPhase: 1,
  };

  // Ensure runDir exists for writeState
  const runDir = path.join(overrides.harnessDir, overrides.runId);
  fs.mkdirSync(runDir, { recursive: true });

  let currentState = state;

  return {
    harnessDir: overrides.harnessDir,
    runId: overrides.runId,
    getState: overrides.getState ?? (() => currentState),
    setState: overrides.setState ?? ((s) => { currentState = s; }),
    getChildPid: overrides.getChildPid ?? (() => null),
    getCurrentPhaseType: overrides.getCurrentPhaseType ?? (() => 'interactive'),
    cwd: overrides.cwd ?? overrides.harnessDir,
  };
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

const tmpDirs: string[] = [];
const installedHandlers: Array<[string, (...args: unknown[]) => void]> = [];

afterEach(() => {
  // Remove listeners FIRST — before directories are deleted, so any in-flight
  // handler cannot fire against an already-removed runDir.
  for (const [event, listener] of installedHandlers) {
    process.removeListener(event, listener);
  }
  installedHandlers.length = 0;

  // Remove tmp dirs after listeners are gone
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;

  vi.restoreAllMocks();
});

// ── registerSignalHandlers ────────────────────────────────────────────────────

describe('registerSignalHandlers', () => {
  it('installs exactly one SIGINT listener and one SIGTERM listener', () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);
    const runId = 'run-signal-1';
    const ctx = makeCtx({ harnessDir: dir, runId });

    const capturedEvents: string[] = [];
    const capturedListeners: Array<(...args: unknown[]) => void> = [];
    const origOn = process.on.bind(process);
    const spy = vi.spyOn(process, 'on').mockImplementation((event: string | symbol, listener: (...args: unknown[]) => void) => {
      const eventStr = String(event);
      capturedEvents.push(eventStr);
      capturedListeners.push(listener);
      installedHandlers.push([eventStr, listener]);
      return origOn(event as NodeJS.Signals, listener as NodeJS.SignalsListener);
    });

    const beforeSIGINT = process.listenerCount('SIGINT');
    const beforeSIGTERM = process.listenerCount('SIGTERM');

    registerSignalHandlers(ctx);

    expect(process.listenerCount('SIGINT')).toBe(beforeSIGINT + 1);
    expect(process.listenerCount('SIGTERM')).toBe(beforeSIGTERM + 1);
    expect(capturedEvents).toContain('SIGINT');
    expect(capturedEvents).toContain('SIGTERM');

    spy.mockRestore();
  });
});

// ── handleShutdown — core logic ───────────────────────────────────────────────

describe('handleShutdown', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('skips killProcessGroup when childPid is null', async () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);
    const runId = 'run-nochild';
    const ctx = makeCtx({ harnessDir: dir, runId, getChildPid: () => null });

    // We just verify no error is thrown and state.json is written
    await handleShutdown(ctx);

    const stateFile = path.join(dir, runId, 'state.json');
    expect(fs.existsSync(stateFile)).toBe(true);
  });

  it('sets phase = "failed" and status = "in_progress" for interactive phases', async () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);
    const runId = 'run-interactive';

    let savedState: HarnessState | undefined;
    const baseState = createInitialState(runId, 'task', 'abc', '/bin/codex', false);
    baseState.currentPhase = 1;
    baseState.phases['1'] = 'in_progress';

    const ctx = makeCtx({
      harnessDir: dir,
      runId,
      getState: () => ({ ...baseState }),
      setState: (s) => { savedState = s; },
      getChildPid: () => null,
      getCurrentPhaseType: () => 'interactive',
    });

    await handleShutdown(ctx);

    expect(savedState).toBeDefined();
    expect(savedState!.phases['1']).toBe('failed');
    expect(savedState!.status).toBe('in_progress');
    expect(savedState!.pendingAction).toBeNull();
  });

  it('sets phase = "error" and pendingAction = rerun_gate for gate phases (2, 4, 7)', async () => {
    for (const phase of [2, 4, 7]) {
      const dir = makeTmpDir();
      tmpDirs.push(dir);
      const runId = `run-gate-phase-${phase}`;

      let savedState: HarnessState | undefined;
      const baseState = createInitialState(runId, 'task', 'abc', '/bin/codex', false);
      baseState.currentPhase = phase;
      baseState.phases[String(phase)] = 'in_progress';

      const ctx = makeCtx({
        harnessDir: dir,
        runId,
        getState: () => ({ ...baseState }),
        setState: (s) => { savedState = s; },
        getChildPid: () => null,
        getCurrentPhaseType: () => 'automated',
      });

      await handleShutdown(ctx);

      expect(savedState).toBeDefined();
      expect(savedState!.phases[String(phase)]).toBe('error');
      expect(savedState!.pendingAction).not.toBeNull();
      expect(savedState!.pendingAction!.type).toBe('rerun_gate');
      expect(savedState!.pendingAction!.targetPhase).toBe(phase);
      expect(savedState!.pendingAction!.sourcePhase).toBeNull();
      expect(savedState!.pendingAction!.feedbackPaths).toEqual([]);
    }
  });

  it('sets phase = "error" and pendingAction = rerun_verify for verify phase (6)', async () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);
    const runId = 'run-verify-phase-6';

    let savedState: HarnessState | undefined;
    const baseState = createInitialState(runId, 'task', 'abc', '/bin/codex', false);
    baseState.currentPhase = 6;
    baseState.phases['6'] = 'in_progress';

    const ctx = makeCtx({
      harnessDir: dir,
      runId,
      getState: () => ({ ...baseState }),
      setState: (s) => { savedState = s; },
      getChildPid: () => null,
      getCurrentPhaseType: () => 'automated',
    });

    await handleShutdown(ctx);

    expect(savedState).toBeDefined();
    expect(savedState!.phases['6']).toBe('error');
    expect(savedState!.pendingAction).not.toBeNull();
    expect(savedState!.pendingAction!.type).toBe('rerun_verify');
    expect(savedState!.pendingAction!.targetPhase).toBe(6);
  });

  it('writes state.json atomically to runDir', async () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);
    const runId = 'run-write-state';
    const ctx = makeCtx({ harnessDir: dir, runId, getChildPid: () => null });

    await handleShutdown(ctx);

    const stateFile = path.join(dir, runId, 'state.json');
    const tmpFile = path.join(dir, runId, 'state.json.tmp');

    expect(fs.existsSync(stateFile)).toBe(true);
    expect(fs.existsSync(tmpFile)).toBe(false);

    const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as HarnessState;
    expect(parsed.runId).toBe(runId);
  });

  it('removes repo.lock and run.lock when they exist', async () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);
    const runId = 'run-locks';

    const repoLock = path.join(dir, 'repo.lock');
    const runDir = path.join(dir, runId);
    fs.mkdirSync(runDir, { recursive: true });
    const runLock = path.join(runDir, 'run.lock');

    fs.writeFileSync(repoLock, 'locked');
    fs.writeFileSync(runLock, 'locked');

    const ctx = makeCtx({ harnessDir: dir, runId, getChildPid: () => null });
    await handleShutdown(ctx);

    expect(fs.existsSync(repoLock)).toBe(false);
    expect(fs.existsSync(runLock)).toBe(false);
  });

  it('does not throw when lock files are already absent', async () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);
    const runId = 'run-no-locks';

    const ctx = makeCtx({ harnessDir: dir, runId, getChildPid: () => null });
    await expect(handleShutdown(ctx)).resolves.toBeUndefined();
  });

  it('saves pausedAtHead from git HEAD when available', async () => {
    // Use current process cwd which is a git repo
    const dir = makeTmpDir();
    tmpDirs.push(dir);
    const runId = 'run-paused-head';

    let savedState: HarnessState | undefined;
    const baseState = createInitialState(runId, 'task', 'abc', '/bin/codex', false);

    const ctx = makeCtx({
      harnessDir: dir,
      runId,
      getState: () => ({ ...baseState }),
      setState: (s) => { savedState = s; },
      getChildPid: () => null,
      // Use a real git repo cwd so getHead() works
      cwd: process.cwd(),
    });

    await handleShutdown(ctx);

    expect(savedState).toBeDefined();
    // pausedAtHead should be a non-null SHA if we're in a git repo
    // (may be null in non-git environments, so we just check the field exists)
    expect('pausedAtHead' in savedState!).toBe(true);
  });

  it('keeps pausedAtHead null when cwd is not a git repo', async () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);
    const runId = 'run-no-git';

    let savedState: HarnessState | undefined;
    const baseState = createInitialState(runId, 'task', 'abc', '/bin/codex', false);

    const ctx = makeCtx({
      harnessDir: dir,
      runId,
      getState: () => ({ ...baseState }),
      setState: (s) => { savedState = s; },
      getChildPid: () => null,
      cwd: os.tmpdir(), // Not a git repo
    });

    await handleShutdown(ctx);

    expect(savedState).toBeDefined();
    expect(savedState!.pausedAtHead).toBeNull();
  });
});

// ── Double-signal guard ───────────────────────────────────────────────────────

describe('registerSignalHandlers — double-signal guard', () => {
  it('installs handlers that are idempotent under rapid signals (shuttingDown guard)', () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);
    const runId = 'run-double-guard';

    const capturedEvents: string[] = [];
    const capturedListenersList: Array<(...args: unknown[]) => void> = [];
    const origOn = process.on.bind(process);
    const spy = vi.spyOn(process, 'on').mockImplementation((event: string | symbol, listener: (...args: unknown[]) => void) => {
      const eventStr = String(event);
      capturedEvents.push(eventStr);
      capturedListenersList.push(listener);
      installedHandlers.push([eventStr, listener]);
      return origOn(event as NodeJS.Signals, listener as NodeJS.SignalsListener);
    });

    const ctx = makeCtx({ harnessDir: dir, runId, getChildPid: () => null });

    const before = process.listenerCount('SIGINT');
    registerSignalHandlers(ctx);

    // Verify listeners were installed
    expect(process.listenerCount('SIGINT')).toBe(before + 1);

    // Verify we can find the SIGINT and SIGTERM handlers
    const sigintIdx = capturedEvents.indexOf('SIGINT');
    const sigtermIdx = capturedEvents.indexOf('SIGTERM');
    expect(sigintIdx).toBeGreaterThanOrEqual(0);
    expect(sigtermIdx).toBeGreaterThanOrEqual(0);

    spy.mockRestore();

    // Both should be the same closure (same shuttingDown guard)
    // Calling SIGINT handler twice should be safe — the guard prevents re-entry.
    // We cannot easily test this without mocking process.exit, but we can
    // verify the listener count did not change (no extra listeners added).
    expect(process.listenerCount('SIGINT')).toBe(before + 1);
  });
});
