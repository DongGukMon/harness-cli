import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { runCodexGate, runCodexInteractive, stderrTail } from '../../src/runners/codex.js';
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
  getProcessStartTime: vi.fn(() => 0),
  killProcessGroup: vi.fn(async () => {}),
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
  model: 'gpt-5.4',
  effort: 'high',
  label: 'codex-high',
};

const SUCCESS_STDOUT =
  'session id: sid-xyz\n## Verdict\nAPPROVE\n\n## Comments\n\n## Summary\nok.\ntokens used\n100\n';

afterEach(() => { vi.clearAllMocks(); });

describe('Codex Runner — module exports', () => {
  it('module exports runCodexInteractive and runCodexGate', async () => {
    const mod = await import('../../src/runners/codex.js');
    expect(typeof mod.runCodexInteractive).toBe('function');
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

describe('runCodexInteractive — CODEX_HOME env plumbing', () => {
  it('spawn env.CODEX_HOME matches provided path', async () => {
    const cp = await import('child_process');
    (cp.spawn as any).mockImplementationOnce(() => makeMockChild({ stdout: 'ok\n' }));

    const state = { lastWorkspacePid: null, lastWorkspacePidStartTime: null } as unknown as HarnessState;

    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-iso-ci-'));
    const promptPath = path.join(tmp, 'p.txt');
    fs.writeFileSync(promptPath, 'hi');
    const runDir = path.join(tmp, 'run');
    fs.mkdirSync(runDir);

    await runCodexInteractive(1, state, preset, '/tmp/h', runDir, promptPath, '/tmp/c', '/iso/interactive');
    const spawnOpts = (cp.spawn as any).mock.calls[0][2];
    expect(spawnOpts.env.CODEX_HOME).toBe('/iso/interactive');

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
