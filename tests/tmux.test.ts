import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', async (importActual) => {
  const actual = await importActual<typeof import('child_process')>();
  return { ...actual, execSync: vi.fn() };
});

import { execSync } from 'child_process';
import { createSession, sessionExists, createWindow, killWindow, killSession, sendKeys, isInsideTmux, getCurrentSessionName, getActiveWindowId, windowExists, selectWindow } from '../src/tmux.js';

describe('tmux utilities', () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReset();
  });

  it('createSession calls tmux new-session with correct args', () => {
    createSession('test-session', '/tmp/test');
    expect(vi.mocked(execSync)).toHaveBeenCalledWith(
      expect.stringContaining('new-session'),
      expect.any(Object)
    );
    const cmd = vi.mocked(execSync).mock.calls[0][0] as string;
    expect(cmd).toContain('test-session');
    expect(cmd).toContain('/tmp/test');
  });

  it('sessionExists returns true on success', () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));
    expect(sessionExists('test')).toBe(true);
  });

  it('sessionExists returns false on error', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('no session'); });
    expect(sessionExists('test')).toBe(false);
  });

  it('createWindow returns window ID', () => {
    vi.mocked(execSync).mockReturnValue('@42\n');
    const id = createWindow('sess', 'win', 'echo hi');
    expect(id).toBe('@42');
  });

  it('createWindow command includes window name and command', () => {
    vi.mocked(execSync).mockReturnValue('@0\n');
    createWindow('my-session', 'phase-1', 'claude --model opus');
    const cmd = vi.mocked(execSync).mock.calls[0][0] as string;
    expect(cmd).toContain('new-window');
    expect(cmd).toContain('my-session');
    expect(cmd).toContain('phase-1');
    expect(cmd).toContain('claude --model opus');
  });

  it('killWindow is best-effort (no throw on error)', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('no window'); });
    expect(() => killWindow('sess', '@1')).not.toThrow();
  });

  it('killSession is best-effort (no throw on error)', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('no session'); });
    expect(() => killSession('sess')).not.toThrow();
  });

  it('selectWindow is best-effort (no throw on error)', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('no window'); });
    expect(() => selectWindow('sess', '@1')).not.toThrow();
  });

  it('sendKeys builds correct command', () => {
    sendKeys('sess', '0', 'harness __inner test-123');
    const cmd = vi.mocked(execSync).mock.calls[0][0] as string;
    expect(cmd).toContain('send-keys');
    expect(cmd).toContain('sess');
    expect(cmd).toContain('harness __inner test-123');
  });

  it('isInsideTmux checks TMUX env var', () => {
    const orig = process.env.TMUX;
    process.env.TMUX = '/tmp/tmux-501/default,12345,0';
    expect(isInsideTmux()).toBe(true);
    delete process.env.TMUX;
    expect(isInsideTmux()).toBe(false);
    if (orig) process.env.TMUX = orig;
  });

  it('getCurrentSessionName returns trimmed session name', () => {
    vi.mocked(execSync).mockReturnValue('my-session\n');
    expect(getCurrentSessionName()).toBe('my-session');
  });

  it('getCurrentSessionName returns null on error', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('not in tmux'); });
    expect(getCurrentSessionName()).toBeNull();
  });

  it('getActiveWindowId returns trimmed window ID', () => {
    vi.mocked(execSync).mockReturnValue('@3\n');
    expect(getActiveWindowId('sess')).toBe('@3');
  });

  it('getActiveWindowId returns null on error', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('fail'); });
    expect(getActiveWindowId('sess')).toBeNull();
  });

  it('windowExists returns true when window ID is in list-windows output', () => {
    vi.mocked(execSync).mockReturnValue('@0\n@1\n@2\n');
    expect(windowExists('sess', '@1')).toBe(true);
  });

  it('windowExists returns false when window ID is not in output', () => {
    vi.mocked(execSync).mockReturnValue('@0\n@2\n');
    expect(windowExists('sess', '@1')).toBe(false);
  });

  it('windowExists returns false on error', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('no session'); });
    expect(windowExists('sess', '@1')).toBe(false);
  });
});
