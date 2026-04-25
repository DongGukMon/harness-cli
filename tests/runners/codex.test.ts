import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { runCodexGate, spawnCodexInteractiveInPane, stderrTail, spawnCodexInPane } from '../../src/runners/codex.js';
import { sendKeysToPane } from '../../src/tmux.js';
import { type ModelPreset } from '../../src/config.js';
import type { HarnessState } from '../../src/types.js';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, spawn: vi.fn(), execSync: vi.fn(() => '/usr/local/bin/codex') };
});

vi.mock('../../src/git.js', () => ({
  getHead: vi.fn(() => 'abc123'),
  isPathGitignored: vi.fn(() => false),
  isInGitRepo: vi.fn(() => true),
}));
vi.mock('../../src/lock.js', () => ({
  updateLockChild: vi.fn(),
  clearLockChild: vi.fn(),
}));
vi.mock('../../src/process.js', () => ({
  getProcessStartTime: vi.fn(() => 100),
  killProcessGroup: vi.fn(async () => {}),
  isPidAlive: vi.fn().mockReturnValue(false),
}));
vi.mock('../../src/tmux.js', () => ({
  sendKeysToPane: vi.fn(),
  pollForPidFile: vi.fn().mockResolvedValue(12345),
}));
vi.mock('../../src/state.js', () => ({
  writeState: vi.fn(),
}));

function makeMockChild(opts: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  delayMs?: number;
}): any {
  const emitter: any = new EventEmitter();
  emitter.stdin = { write: vi.fn(), end: vi.fn() };
  emitter.stdout = new EventEmitter();
  emitter.stderr = new EventEmitter();
  emitter.pid = 2222;
  setTimeout(() => {
    if (opts.stdout) emitter.stdout.emit('data', Buffer.from(opts.stdout));
    if (opts.stderr) emitter.stderr.emit('data', Buffer.from(opts.stderr));
    emitter.emit('close', opts.exitCode ?? 0);
  }, opts.delayMs ?? 5);
  return emitter;
}

const preset: ModelPreset = {
  id: 'codex-high',
  runner: 'codex',
  model: 'gpt-5.5',
  effort: 'high',
  label: 'codex-high',
};

const SUCCESS_STDOUT =
  'session id: sid-xyz\n## Verdict\nAPPROVE\n\n## Comments\n\n## Summary\nok.\ntokens used\n100\n';

afterEach(() => { vi.clearAllMocks(); });

describe('Codex Runner — module exports', () => {
  it('module exports spawnCodexInteractiveInPane and runCodexGate', async () => {
    const mod = await import('../../src/runners/codex.js');
    expect(typeof mod.spawnCodexInteractiveInPane).toBe('function');
    expect(typeof mod.runCodexGate).toBe('function');
  });
});

describe('runCodexGate — CODEX_HOME env plumbing (BUG-C isolation)', () => {
  it('spawn env.CODEX_HOME matches provided path (fresh mode)', async () => {
    const cp = await import('child_process');
    (cp.spawn as any).mockImplementationOnce(() => makeMockChild({ stdout: SUCCESS_STDOUT }));
    await runCodexGate(2, preset, 'p', '/tmp/h', '/tmp/c', undefined, undefined, '/iso/here');
    const spawnOpts = (cp.spawn as any).mock.calls[0][2];
    expect(spawnOpts.env.CODEX_HOME).toBe('/iso/here');
  });

  it('spawn env.CODEX_HOME matches provided path (resume mode)', async () => {
    const cp = await import('child_process');
    (cp.spawn as any).mockImplementationOnce(() =>
      makeMockChild({ stdout: SUCCESS_STDOUT.replace('sid-xyz', 'prev-sid') })
    );
    await runCodexGate(2, preset, 'p', '/tmp/h', '/tmp/c', 'prev-sid', undefined, '/iso/resume');
    const spawnOpts = (cp.spawn as any).mock.calls[0][2];
    expect(spawnOpts.env.CODEX_HOME).toBe('/iso/resume');
  });

  it('spawn env.CODEX_HOME omitted when codexHome is null (escape hatch)', async () => {
    const cp = await import('child_process');
    const originalEnvHad = 'CODEX_HOME' in process.env;
    const originalValue = process.env.CODEX_HOME;
    delete process.env.CODEX_HOME;
    try {
      (cp.spawn as any).mockImplementationOnce(() => makeMockChild({ stdout: SUCCESS_STDOUT }));
      await runCodexGate(2, preset, 'p', '/tmp/h', '/tmp/c', undefined, undefined, null);
      const spawnOpts = (cp.spawn as any).mock.calls[0][2];
      expect(spawnOpts.env.CODEX_HOME).toBeUndefined();
    } finally {
      if (originalEnvHad) process.env.CODEX_HOME = originalValue;
    }
  });

  it('spawn env.CODEX_HOME omitted when codexHome param omitted (default null — backward compat)', async () => {
    const cp = await import('child_process');
    const originalEnvHad = 'CODEX_HOME' in process.env;
    const originalValue = process.env.CODEX_HOME;
    delete process.env.CODEX_HOME;
    try {
      (cp.spawn as any).mockImplementationOnce(() => makeMockChild({ stdout: SUCCESS_STDOUT }));
      await runCodexGate(2, preset, 'p', '/tmp/h', '/tmp/c');
      const spawnOpts = (cp.spawn as any).mock.calls[0][2];
      expect(spawnOpts.env.CODEX_HOME).toBeUndefined();
    } finally {
      if (originalEnvHad) process.env.CODEX_HOME = originalValue;
    }
  });
});

describe('spawnCodexInteractiveInPane — pane injection', () => {
  it('sends a top-level `codex` TUI command (not `codex exec`) with prompt arg, sandbox, CODEX_HOME', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-pane-ci-'));
    const promptPath = path.join(tmp, 'p.txt');
    fs.writeFileSync(promptPath, 'hi');
    const runDir = path.join(tmp, 'run');
    fs.mkdirSync(runDir);
    const sentinelPath = path.join(runDir, 'phase-1.done');

    const state: HarnessState = {
      lastWorkspacePid: null,
      lastWorkspacePidStartTime: null,
      tmuxSession: 'sess',
      tmuxWorkspacePane: '%1',
    } as unknown as HarnessState;

    await spawnCodexInteractiveInPane({
      phase: 1,
      state,
      preset,
      harnessDir: '/tmp/h',
      runDir,
      promptFile: promptPath,
      cwd: '/tmp/c',
      codexHome: '/iso/interactive',
      attemptId: 'atmp-1',
      sentinelPath,
    });

    expect(vi.mocked(sendKeysToPane)).toHaveBeenCalled();
    const cmd: string = vi.mocked(sendKeysToPane).mock.calls.at(-1)![2];
    // Top-level TUI codex — pane stays interactive (input line + reasoning).
    expect(cmd).toMatch(/\bcodex\s+--model\b/);
    expect(cmd).not.toMatch(/\bcodex\s+exec\b/);
    expect(cmd).not.toMatch(/--skip-git-repo-check/);
    expect(cmd).toContain('CODEX_HOME="/iso/interactive"');
    expect(cmd).toContain('--sandbox workspace-write');
    expect(cmd).toContain('--full-auto');
    // Prompt as cat-substitution positional arg, not stdin redirect.
    expect(cmd).toContain(`"$(cat "${promptPath}")"`);
    expect(cmd).not.toMatch(/<\s+"[^"]*p\.txt"/);
    // No shell-level sentinel write — codex writes the sentinel via tool use
    // per phase-N prompt instructions, matching Claude TUI's pattern.
    expect(cmd).not.toContain('echo "atmp-1"');

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('uses danger-full-access sandbox for phase 5', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-pane-p5-'));
    const promptPath = path.join(tmp, 'p.txt');
    fs.writeFileSync(promptPath, 'hi');
    const runDir = path.join(tmp, 'run');
    fs.mkdirSync(runDir);

    const state: HarnessState = {
      lastWorkspacePid: null,
      lastWorkspacePidStartTime: null,
      tmuxSession: 'sess',
      tmuxWorkspacePane: '%1',
    } as unknown as HarnessState;

    await spawnCodexInteractiveInPane({
      phase: 5,
      state,
      preset,
      harnessDir: '/tmp/h',
      runDir,
      promptFile: promptPath,
      cwd: '/tmp/c',
      codexHome: null,
      attemptId: 'atmp-5',
      sentinelPath: path.join(runDir, 'phase-5.done'),
    });

    const cmd: string = vi.mocked(sendKeysToPane).mock.calls.at(-1)![2];
    expect(cmd).toMatch(/\bcodex\s+--model\b/);
    expect(cmd).not.toMatch(/\bcodex\s+exec\b/);
    expect(cmd).toContain('--sandbox danger-full-access');
    expect(cmd).not.toContain('CODEX_HOME');

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('stderrTail — helper unit tests', () => {
  it('returns last N non-empty lines', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
    const result = stderrTail(lines, 5);
    expect(result).toBe('line 26\nline 27\nline 28\nline 29\nline 30');
  });

  it('strips ANSI escape sequences', () => {
    const input = '\x1B[31mERROR\x1B[0m: something went wrong';
    const result = stderrTail(input);
    expect(result).toBe('ERROR: something went wrong');
  });

  it('filters out blank lines', () => {
    const input = 'line1\n\n   \nline2\n';
    const result = stderrTail(input);
    expect(result).toBe('line1\nline2');
  });

  it('returns empty string for empty input', () => {
    expect(stderrTail('')).toBe('');
    expect(stderrTail('\n\n   \n')).toBe('');
  });

  it('defaults to max 20 lines', () => {
    const lines = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join('\n');
    const result = stderrTail(lines);
    const resultLines = result.split('\n');
    expect(resultLines).toHaveLength(20);
    expect(resultLines[0]).toBe('line 6');
    expect(resultLines[19]).toBe('line 25');
  });
});

describe('runCodexGate — --skip-git-repo-check flag (FR-4)', () => {
  it('does NOT add --skip-git-repo-check when cwd is a git repo', async () => {
    const cp = await import('child_process');
    const gitMod = await import('../../src/git.js');
    (gitMod.isInGitRepo as any).mockReturnValueOnce(true);
    (cp.spawn as any).mockImplementationOnce(() => makeMockChild({ stdout: SUCCESS_STDOUT }));

    await runCodexGate(2, preset, 'p', '/tmp/h', '/tmp/c');

    const spawnArgs: string[] = (cp.spawn as any).mock.calls[0][1];
    expect(spawnArgs).not.toContain('--skip-git-repo-check');
  });

  it('adds --skip-git-repo-check when cwd is NOT a git repo', async () => {
    const cp = await import('child_process');
    const gitMod = await import('../../src/git.js');
    (gitMod.isInGitRepo as any).mockReturnValueOnce(false);
    (cp.spawn as any).mockImplementationOnce(() => makeMockChild({ stdout: SUCCESS_STDOUT }));

    await runCodexGate(2, preset, 'p', '/tmp/h', '/tmp/c');

    const spawnArgs: string[] = (cp.spawn as any).mock.calls[0][1];
    expect(spawnArgs).toContain('--skip-git-repo-check');
  });

  it('adds --skip-git-repo-check before --model flag', async () => {
    const cp = await import('child_process');
    const gitMod = await import('../../src/git.js');
    (gitMod.isInGitRepo as any).mockReturnValueOnce(false);
    (cp.spawn as any).mockImplementationOnce(() => makeMockChild({ stdout: SUCCESS_STDOUT }));

    await runCodexGate(2, preset, 'p', '/tmp/h', '/tmp/c');

    const spawnArgs: string[] = (cp.spawn as any).mock.calls[0][1];
    const skipIdx = spawnArgs.indexOf('--skip-git-repo-check');
    const modelIdx = spawnArgs.indexOf('--model');
    expect(skipIdx).toBeGreaterThan(-1);
    expect(skipIdx).toBeLessThan(modelIdx);
  });

  it('adds --skip-git-repo-check in resume mode when cwd is NOT a git repo', async () => {
    const cp = await import('child_process');
    const gitMod = await import('../../src/git.js');
    (gitMod.isInGitRepo as any).mockReturnValueOnce(false);
    (cp.spawn as any).mockImplementationOnce(() =>
      makeMockChild({ stdout: SUCCESS_STDOUT.replace('sid-xyz', 'resume-sid') })
    );

    await runCodexGate(2, preset, 'p', '/tmp/h', '/tmp/c', 'resume-sid');

    const spawnArgs: string[] = (cp.spawn as any).mock.calls[0][1];
    expect(spawnArgs).toContain('--skip-git-repo-check');
    // In resume mode: exec resume <sessionId> [--skip-git-repo-check] --model ...
    expect(spawnArgs[0]).toBe('exec');
    expect(spawnArgs[1]).toBe('resume');
    expect(spawnArgs[2]).toBe('resume-sid');
  });
});

describe('runCodexGate — nonzero_exit_other includes stderr tail (FR-4)', () => {
  it('includes stderr tail in error message when subprocess exits non-zero', async () => {
    const cp = await import('child_process');
    const gitMod = await import('../../src/git.js');
    (gitMod.isInGitRepo as any).mockReturnValueOnce(true);
    const stderrContent = 'fatal: something went wrong\ndetail: bad config\naborting';
    (cp.spawn as any).mockImplementationOnce(() =>
      makeMockChild({ stdout: '', stderr: stderrContent, exitCode: 1 })
    );

    const result = await runCodexGate(2, preset, 'p', '/tmp/h', '/tmp/c');

    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.error).toContain('Gate subprocess exited with code 1');
      expect(result.error).toContain('--- stderr (tail) ---');
      expect(result.error).toContain('fatal: something went wrong');
    }
  });

  it('omits stderr section when stderr is empty on non-zero exit', async () => {
    const cp = await import('child_process');
    const gitMod = await import('../../src/git.js');
    (gitMod.isInGitRepo as any).mockReturnValueOnce(true);
    (cp.spawn as any).mockImplementationOnce(() =>
      makeMockChild({ stdout: '', stderr: '', exitCode: 2 })
    );

    const result = await runCodexGate(2, preset, 'p', '/tmp/h', '/tmp/c');

    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.error).toBe('Gate subprocess exited with code 2');
      expect(result.error).not.toContain('--- stderr (tail) ---');
    }
  });
});

// Helper for spawnCodexInPane tests
function makeMinimalState(): HarnessState {
  return {
    runId: 'test-run',
    flow: 'full',
    carryoverFeedback: null,
    currentPhase: 2,
    status: 'in_progress',
    autoMode: false,
    task: 'test',
    baseCommit: 'abc',
    implRetryBase: 'abc',
    trackedRepos: [],
    codexPath: null,
    externalCommitsDetected: false,
    artifacts: { spec: '', plan: '', decisionLog: '', checklist: '', evalReport: '' },
    phases: {},
    gateRetries: {},
    verifyRetries: 0,
    pauseReason: null,
    specCommit: null,
    planCommit: null,
    implCommit: null,
    evalCommit: null,
    verifiedAtHead: null,
    pausedAtHead: null,
    pendingAction: null,
    phaseOpenedAt: {},
    phaseAttemptId: {},
    phasePresets: {},
    phaseReopenFlags: {},
    phaseCodexSessions: { '2': null, '4': null, '7': null },
    phaseClaudeSessions: { '1': null, '3': null, '5': null },
    lastWorkspacePid: null,
    lastWorkspacePidStartTime: null,
    tmuxSession: 'harness-sess',
    tmuxMode: 'dedicated',
    tmuxWindows: [],
    tmuxControlWindow: '',
    tmuxWorkspacePane: '%5',
    tmuxControlPane: '',
    loggingEnabled: false,
    phaseReopenSource: {},
    codexNoIsolate: false,
    dirtyBaseline: [],
  } as HarnessState;
}

describe('spawnCodexInPane — fresh', () => {
  it('sends fresh top-level `codex` TUI command with prompt as cat-substitution arg', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-pane-'));
    const state = makeMinimalState();
    const promptFile = path.join(tmpDir, 'prompt.md');
    const result = await spawnCodexInPane({
      phase: 2,
      state,
      preset,
      harnessDir: tmpDir,
      runDir: tmpDir,
      promptFile,
      cwd: tmpDir,
      codexHome: null,
      mode: 'fresh',
    });
    expect(result.pid).toBe(12345);
    const sendCalls = vi.mocked(sendKeysToPane).mock.calls;
    const cmds = sendCalls.map(c => c[2]);
    const wrappedCmd = cmds.find(c => /\bcodex\b/.test(c) && !c.startsWith('C-'));
    expect(wrappedCmd).toBeDefined();
    // Top-level `codex` (TUI), not `codex exec` — TUI gives the user a visible
    // input line and reasoning stream, restoring PR #74's intent. Trust entry
    // pre-written by ensureCodexIsolation removes the need for the
    // exec-only `--skip-git-repo-check` flag in non-git cwds.
    expect(wrappedCmd).toMatch(/\bcodex\s+--model\b/);
    expect(wrappedCmd).not.toMatch(/\bcodex\s+exec\b/);
    expect(wrappedCmd).not.toMatch(/--skip-git-repo-check/);
    // Sandbox + auto-approval still required so codex can write verdict + sentinel.
    expect(wrappedCmd).toMatch(/-s\s+workspace-write/);
    expect(wrappedCmd).toMatch(/--full-auto/);
    // Prompt is injected via shell command substitution at execution time so
    // tmux send-keys carries only the short wrapper, not the 40+ KB prompt.
    expect(wrappedCmd).toContain(`"$(cat "${promptFile}")"`);
    // No stdin redirect (top-level codex rejects "stdin is not a terminal").
    expect(wrappedCmd).not.toMatch(/<\s+"[^"]*prompt\.md"/);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('spawnCodexInPane — fresh in non-git cwd', () => {
  it('does NOT add --skip-git-repo-check even when cwd is non-git (trust-entry handles it)', async () => {
    // PR #80/#82/#83 used --skip-git-repo-check conditionally on non-git cwd.
    // The trust-entry approach (ensureCodexIsolation) makes that flag both
    // unsupported (top-level codex 0.124.0 dropped it) and unnecessary.
    const gitMod = await import('../../src/git.js');
    (gitMod.isInGitRepo as any).mockReturnValueOnce(false);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-pane-nongit-'));
    const state = makeMinimalState();
    await spawnCodexInPane({
      phase: 2,
      state,
      preset,
      harnessDir: tmpDir,
      runDir: tmpDir,
      promptFile: path.join(tmpDir, 'prompt.md'),
      cwd: tmpDir,
      codexHome: null,
      mode: 'fresh',
    });
    const sendCalls = vi.mocked(sendKeysToPane).mock.calls;
    const cmds = sendCalls.map(c => c[2]);
    const wrappedCmd = cmds.find(c => /\bcodex\s+--model\b/.test(c));
    expect(wrappedCmd).toBeDefined();
    expect(wrappedCmd).not.toMatch(/--skip-git-repo-check/);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('spawnCodexInPane — resume', () => {
  it('sends top-level `codex resume <sessionId>` TUI command with prompt arg', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-pane-'));
    const state = makeMinimalState();
    const promptFile = path.join(tmpDir, 'resume-prompt.md');
    await spawnCodexInPane({
      phase: 2,
      state,
      preset,
      harnessDir: tmpDir,
      runDir: tmpDir,
      promptFile,
      cwd: tmpDir,
      codexHome: null,
      mode: 'resume',
      sessionId: 'sess-abc-123',
    });
    const sendCalls = vi.mocked(sendKeysToPane).mock.calls;
    const cmds = sendCalls.map(c => c[2]);
    const wrappedCmd = cmds.find(c => c.includes('resume'));
    expect(wrappedCmd).toBeDefined();
    // Top-level `codex resume <id>`, NOT `codex exec resume`. Top-level resume
    // accepts -s and --full-auto (unlike exec resume), so fresh and resume
    // share the same flag set.
    expect(wrappedCmd).toMatch(/\bcodex\s+resume\s+sess-abc-123\b/);
    expect(wrappedCmd).not.toMatch(/\bcodex\s+exec\s+resume\b/);
    expect(wrappedCmd).not.toMatch(/--skip-git-repo-check/);
    expect(wrappedCmd).toMatch(/-s\s+workspace-write/);
    expect(wrappedCmd).toMatch(/--full-auto/);
    expect(wrappedCmd).toContain(`"$(cat "${promptFile}")"`);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
