import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { runCodexGate } from '../../src/runners/codex.js';
import { GATE_TIMEOUT_MS, type ModelPreset } from '../../src/config.js';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, spawn: vi.fn(), execSync: vi.fn(() => '/usr/local/bin/codex') };
});

// Skip lock/process side effects — test focuses on argv/branch behavior
vi.mock('../../src/lock.js', () => ({
  updateLockChild: vi.fn(),
  clearLockChild: vi.fn(),
}));
vi.mock('../../src/process.js', () => ({
  getProcessStartTime: vi.fn(() => 0),
  killProcessGroup: vi.fn(async () => {}),
}));

function makeMockChild(opts: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  delayMs?: number;
  /** true면 data emit은 하되 'close' 이벤트를 영원히 발생시키지 않음 — timeout 경로 테스트용 */
  neverClose?: boolean;
}): any {
  const emitter: any = new EventEmitter();
  emitter.stdin = { write: vi.fn(), end: vi.fn() };
  emitter.stdout = new EventEmitter();
  emitter.stderr = new EventEmitter();
  emitter.pid = 12345;
  setTimeout(() => {
    if (opts.stdout) emitter.stdout.emit('data', Buffer.from(opts.stdout));
    if (opts.stderr) emitter.stderr.emit('data', Buffer.from(opts.stderr));
    if (!opts.neverClose) emitter.emit('close', opts.exitCode ?? 0);
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
  'session id: abc-123-def\n## Verdict\nAPPROVE\n\n## Comments\n\n## Summary\nAll good.\ntokens used\n1234\n';

afterEach(() => { vi.clearAllMocks(); });

describe('runCodexGate — fresh path', () => {
  it('spawns codex exec without resume when no sessionId passed', async () => {
    const cp = await import('child_process');
    (cp.spawn as any).mockImplementationOnce(() => makeMockChild({ stdout: SUCCESS_STDOUT }));
    const result = await runCodexGate(2, preset, 'prompt', '/tmp/h', '/tmp/c');
    expect(result.type).toBe('verdict');
    if (result.type === 'verdict') {
      expect(result.codexSessionId).toBe('abc-123-def');
      expect(result.sourcePreset).toEqual({ model: 'gpt-5.4', effort: 'high' });
      expect(result.resumedFrom).toBeNull();
      expect(result.resumeFallback).toBe(false);
    }
    const args = (cp.spawn as any).mock.calls[0][1] as string[];
    expect(args[0]).toBe('exec');
    expect(args).not.toContain('resume');
  });
});

describe('runCodexGate — resume path', () => {
  it('spawns codex exec resume with sessionId positional before flags', async () => {
    const cp = await import('child_process');
    (cp.spawn as any).mockImplementationOnce(() =>
      makeMockChild({ stdout: SUCCESS_STDOUT.replace('abc-123-def', 'abcd-1234') }),
    );
    const result = await runCodexGate(2, preset, 'prompt', '/tmp/h', '/tmp/c', 'abcd-1234');
    expect(result.type).toBe('verdict');
    if (result.type === 'verdict') {
      expect(result.resumedFrom).toBe('abcd-1234');
      expect(result.resumeFallback).toBe(false);
      expect(result.codexSessionId).toBe('abcd-1234');
    }
    const args = (cp.spawn as any).mock.calls[0][1] as string[];
    // spec §2: [exec, resume, SESSION_ID, ...flags, '-'] 순서
    expect(args[0]).toBe('exec');
    expect(args[1]).toBe('resume');
    expect(args[2]).toBe('abcd-1234');
  });

  it('falls back to fresh spawn on session_missing stderr', async () => {
    const cp = await import('child_process');
    (cp.spawn as any)
      .mockImplementationOnce(() =>
        makeMockChild({ stderr: 'error: session not found\n', exitCode: 1 }),
      )
      .mockImplementationOnce(() =>
        makeMockChild({ stdout: SUCCESS_STDOUT.replace('abc-123-def', 'ffee-dd11') }),
      );
    const result = await runCodexGate(
      2, preset, 'resume prompt', '/tmp/h', '/tmp/c', 'dead-sid',
      () => 'fresh prompt body',
    );
    expect(result.type).toBe('verdict');
    if (result.type === 'verdict') {
      expect(result.resumedFrom).toBe('dead-sid');
      expect(result.resumeFallback).toBe(true);
      expect(result.codexSessionId).toBe('ffee-dd11');
    }
    const args2 = (cp.spawn as any).mock.calls[1][1] as string[];
    expect(args2).not.toContain('resume');
  });

  it('does NOT fall back on nonzero_exit_other (non-session-missing stderr)', async () => {
    const cp = await import('child_process');
    (cp.spawn as any).mockImplementationOnce(() =>
      makeMockChild({ stderr: 'error: generic failure\n', exitCode: 1 }),
    );
    const result = await runCodexGate(
      2, preset, 'resume prompt', '/tmp/h', '/tmp/c', 'some-sid', () => 'fresh',
    );
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.resumeFallback).toBe(false);
    }
    expect((cp.spawn as any).mock.calls.length).toBe(1);
  });

  it('does NOT fall back on timeout (observable: no second spawn, timeout message)', async () => {
    vi.useFakeTimers();
    try {
      const cp = await import('child_process');
      (cp.spawn as any).mockImplementationOnce(() =>
        makeMockChild({ stdout: '', neverClose: true }),
      );
      const pending = runCodexGate(
        2, preset, 'resume prompt', '/tmp/h', '/tmp/c', 'some-sid', () => 'fresh',
      );
      await vi.advanceTimersByTimeAsync(GATE_TIMEOUT_MS + 1000);
      const result = await pending;
      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.resumeFallback).toBe(false);
        expect(result.error).toMatch(/timed out/i);
      }
      expect((cp.spawn as any).mock.calls.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT fall back on success_no_verdict (exit 0이지만 ## Verdict 헤더 없음)', async () => {
    const cp = await import('child_process');
    (cp.spawn as any).mockImplementationOnce(() =>
      makeMockChild({
        stdout:
          'session id: aabb-ccdd\ntokens used\n10\n\nReviewer replied but never emitted a Verdict header.\n',
        exitCode: 0,
      }),
    );
    const result = await runCodexGate(
      2, preset, 'resume prompt', '/tmp/h', '/tmp/c', 'aabb-ccdd', () => 'fresh',
    );
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.resumeFallback).toBe(false);
      expect(result.error).toMatch(/missing ## Verdict header/i);
      expect(result.codexSessionId).toBe('aabb-ccdd');
    }
    expect((cp.spawn as any).mock.calls.length).toBe(1);
  });
});

describe('runCodexGate — metadata captured on error paths', () => {
  it('captures sessionId and tokensTotal on nonzero exit', async () => {
    const cp = await import('child_process');
    (cp.spawn as any).mockImplementationOnce(() =>
      makeMockChild({
        stdout: 'session id: bbaa-1122\ntokens used\n42\n',
        stderr: 'some error\n',
        exitCode: 1,
      }),
    );
    const result = await runCodexGate(2, preset, 'prompt', '/tmp/h', '/tmp/c');
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.codexSessionId).toBe('bbaa-1122');
      expect(result.tokensTotal).toBe(42);
    }
  });
});
