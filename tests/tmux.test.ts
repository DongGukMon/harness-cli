import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('child_process', async (importActual) => {
  const actual = await importActual<typeof import('child_process')>();
  return { ...actual, execSync: vi.fn() };
});

import { execSync } from 'child_process';
import { createSession, sessionExists, createWindow, killWindow, killSession, sendKeys, isInsideTmux, getCurrentSessionName, getActiveWindowId, windowExists, selectWindow, splitPane, sendKeysToPane, selectPane, paneExists, getDefaultPaneId, pollForPidFile } from '../src/tmux.js';

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

  // ─── Pane utility tests ──────────────────────────────────────────────────────

  it('splitPane returns new pane ID', () => {
    vi.mocked(execSync).mockReturnValue('%5\n');
    const id = splitPane('sess', '%0', 'h', 70);
    expect(id).toBe('%5');
  });

  it('splitPane command includes -h flag for horizontal split', () => {
    vi.mocked(execSync).mockReturnValue('%1\n');
    splitPane('my-session', '%0', 'h', 70);
    const cmd = vi.mocked(execSync).mock.calls[0][0] as string;
    expect(cmd).toContain('split-window');
    expect(cmd).toContain('-h');
    expect(cmd).toContain('70');
  });

  it('splitPane command includes -v flag for vertical split', () => {
    vi.mocked(execSync).mockReturnValue('%2\n');
    splitPane('my-session', '%0', 'v', 30);
    const cmd = vi.mocked(execSync).mock.calls[0][0] as string;
    expect(cmd).toContain('split-window');
    expect(cmd).toContain('-v');
    expect(cmd).toContain('30');
  });

  it('sendKeysToPane sends C-c without Enter', () => {
    sendKeysToPane('sess', '%0', 'C-c');
    const cmd = vi.mocked(execSync).mock.calls[0][0] as string;
    expect(cmd).toContain('send-keys');
    expect(cmd).toContain('C-c');
    expect(cmd).not.toContain('Enter');
  });

  it('sendKeysToPane sends regular keys with Enter', () => {
    sendKeysToPane('sess', '%0', 'echo hello');
    const cmd = vi.mocked(execSync).mock.calls[0][0] as string;
    expect(cmd).toContain('send-keys');
    expect(cmd).toContain('echo hello');
    expect(cmd).toContain('Enter');
  });

  it('selectPane is best-effort (no throw on error)', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('no pane'); });
    expect(() => selectPane('sess', '%1')).not.toThrow();
  });

  it('selectPane targets pane ID directly (no session prefix)', () => {
    selectPane('sess', '%3');
    const cmd = vi.mocked(execSync).mock.calls[0][0] as string;
    expect(cmd).toContain('select-pane');
    expect(cmd).toContain('%3');
    expect(cmd).not.toContain('sess');
  });

  it('paneExists returns true when pane ID is in list-panes output', () => {
    vi.mocked(execSync).mockReturnValue('%0\n%1\n%2\n');
    expect(paneExists('sess', '%1')).toBe(true);
  });

  it('paneExists returns false when pane ID is not in output', () => {
    vi.mocked(execSync).mockReturnValue('%0\n%2\n');
    expect(paneExists('sess', '%1')).toBe(false);
  });

  it('paneExists returns false on error', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('no session'); });
    expect(paneExists('sess', '%1')).toBe(false);
  });

  it('getDefaultPaneId returns first pane ID', () => {
    vi.mocked(execSync).mockReturnValue('%0\n%1\n');
    expect(getDefaultPaneId('sess')).toBe('%0');
  });

  it('getDefaultPaneId throws when no panes found', () => {
    vi.mocked(execSync).mockReturnValue('\n');
    expect(() => getDefaultPaneId('sess')).toThrow('No panes found');
  });

  it('getDefaultPaneId uses window target when provided', () => {
    vi.mocked(execSync).mockReturnValue('%3\n');
    getDefaultPaneId('sess', '@1');
    const cmd = vi.mocked(execSync).mock.calls[0][0] as string;
    expect(cmd).toContain('list-panes');
    expect(cmd).toContain('sess');
    expect(cmd).toContain('@1');
  });
});

describe('pollForPidFile', () => {
  it('returns PID when file contains a valid PID', async () => {
    const tmpFile = path.join(os.tmpdir(), `pid-test-${Date.now()}.pid`);
    fs.writeFileSync(tmpFile, '42\n');
    try {
      const result = await pollForPidFile(tmpFile, 1000);
      expect(result).toBe(42);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('returns null on timeout when file never appears', async () => {
    const tmpFile = path.join(os.tmpdir(), `pid-missing-${Date.now()}.pid`);
    // Do not create the file
    const result = await pollForPidFile(tmpFile, 300);
    expect(result).toBeNull();
  }, 2000);

  it('returns null when file contains non-numeric content', async () => {
    const tmpFile = path.join(os.tmpdir(), `pid-invalid-${Date.now()}.pid`);
    fs.writeFileSync(tmpFile, 'not-a-number\n');
    try {
      const result = await pollForPidFile(tmpFile, 400);
      expect(result).toBeNull();
    } finally {
      fs.unlinkSync(tmpFile);
    }
  }, 2000);
});
