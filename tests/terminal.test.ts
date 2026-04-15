import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', async (importActual) => {
  const actual = await importActual<typeof import('child_process')>();
  return { ...actual, execSync: vi.fn() };
});

vi.mock('../src/tmux.js', () => ({
  isInsideTmux: vi.fn(() => false),
}));

import { execSync } from 'child_process';
import { isInsideTmux } from '../src/tmux.js';
import { openTerminalWindow } from '../src/terminal.js';

describe('openTerminalWindow', () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReset();
    vi.mocked(isInsideTmux).mockReturnValue(false);
  });

  it('returns true when already inside tmux', () => {
    vi.mocked(isInsideTmux).mockReturnValue(true);
    expect(openTerminalWindow('test')).toBe(true);
    expect(vi.mocked(execSync)).not.toHaveBeenCalled();
  });

  it('tries iTerm2 first', () => {
    // First call: grep iTerm → success, second call: osascript → success
    vi.mocked(execSync)
      .mockReturnValueOnce(Buffer.from('iTerm2'))  // grep check
      .mockReturnValueOnce(Buffer.from(''));         // osascript

    expect(openTerminalWindow('test-session')).toBe(true);
  });

  it('falls through to Terminal.app when iTerm2 fails', () => {
    // First call: grep iTerm → fail, second call: Terminal osascript → success
    vi.mocked(execSync)
      .mockImplementationOnce(() => { throw new Error('no iTerm'); }) // grep
      .mockReturnValueOnce(Buffer.from(''));  // Terminal.app osascript

    expect(openTerminalWindow('test-session')).toBe(true);
  });

  it('returns false when both fail', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('fail'); });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    expect(openTerminalWindow('test-session')).toBe(false);
    const output = stderrSpy.mock.calls.map(c => String(c[0])).join('');
    expect(output).toContain('tmux attach');

    stderrSpy.mockRestore();
  });

  it('includes session name in manual fallback message', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('fail'); });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    openTerminalWindow('harness-abc123');
    const output = stderrSpy.mock.calls.map(c => String(c[0])).join('');
    expect(output).toContain('harness-abc123');

    stderrSpy.mockRestore();
  });
});
