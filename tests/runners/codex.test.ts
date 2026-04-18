import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { runCodexGate, runCodexInteractive } from '../../src/runners/codex.js';
import { type ModelPreset } from '../../src/config.js';
import type { HarnessState } from '../../src/types.js';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, spawn: vi.fn(), execSync: vi.fn(() => '/usr/local/bin/codex') };
});
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
