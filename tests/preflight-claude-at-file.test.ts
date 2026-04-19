import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('child_process', async (importActual) => {
  const actual = await importActual<typeof import('child_process')>();
  return { ...actual, spawnSync: vi.fn() };
});

import { spawnSync } from 'child_process';
import { runPreflight } from '../src/preflight.js';

describe('claude @file preflight', () => {
  let stderrSpy: any;

  beforeEach(() => {
    vi.mocked(spawnSync).mockReset();
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('uses a 10 second timeout and soft delayed wording when the probe times out', () => {
    const timeoutErr = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
    vi.mocked(spawnSync).mockReturnValue({
      pid: 0,
      output: [],
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      status: null,
      signal: 'SIGKILL',
      error: timeoutErr,
    } as ReturnType<typeof spawnSync>);

    expect(() => runPreflight(['claudeAtFile'])).not.toThrow();

    expect(vi.mocked(spawnSync)).toHaveBeenCalledWith(
      'claude',
      ['--model', 'claude-sonnet-4-6[1m]', expect.stringMatching(/^@/), '--print', ''],
      expect.objectContaining({ timeout: 10_000, killSignal: 'SIGKILL' }),
    );

    const stderr = stderrSpy.mock.calls.map((call: unknown[]) => String(call[0])).join('');
    expect(stderr).toContain('claude @file check delayed (>10s)');
    expect(stderr).toContain('continuing');
    expect(stderr).not.toContain('timed out');
  });

  it('keeps non-zero exit as a warning-only signal', () => {
    vi.mocked(spawnSync).mockReturnValue({
      pid: 0,
      output: [],
      stdout: Buffer.from(''),
      stderr: Buffer.from('some error'),
      status: 7,
      signal: null,
      error: undefined,
    } as ReturnType<typeof spawnSync>);

    expect(() => runPreflight(['claudeAtFile'])).not.toThrow();

    const stderr = stderrSpy.mock.calls.map((call: unknown[]) => String(call[0])).join('');
    expect(stderr).toContain('claude @file check exited with status 7');
    expect(stderr).toContain('continuing');
  });
});
