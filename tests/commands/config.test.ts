import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  configListCommand,
  configGetCommand,
  configSetCommand,
  configResetCommand,
} from '../../src/commands/config.js';
import { PHASE_DEFAULTS } from '../../src/config.js';

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  vi.restoreAllMocks();
});
function makeTmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'config-cmd-test-'));
  tmpDirs.push(d);
  return d;
}
function writeConfig(home: string, data: object): void {
  fs.mkdirSync(path.join(home, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(home, '.harness', 'config.json'), JSON.stringify(data));
}
function captureStdout(fn: () => void): string {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((s) => { chunks.push(String(s)); return true; });
  try { fn(); } finally { spy.mockRestore(); }
  return chunks.join('');
}
function captureStderr(fn: () => void): string {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation((s) => { chunks.push(String(s)); return true; });
  try { fn(); } finally { spy.mockRestore(); }
  return chunks.join('');
}

describe('configListCommand', () => {
  it('prints 6 data rows + header + separator when no overrides', () => {
    const home = makeTmp();
    const out = captureStdout(() => configListCommand({ homeDir: home }));
    const lines = out.trim().split('\n');
    expect(lines).toHaveLength(8); // header + separator + 6 rows
    expect(out).toContain('phase.1.preset');
    expect(out).toContain('phase.7.preset');
    expect(out).toContain('default');
  });
  it('shows override source and value for overridden phase', () => {
    const home = makeTmp();
    writeConfig(home, { phase: { '1': { preset: 'opus-1m-max' } } });
    const out = captureStdout(() => configListCommand({ homeDir: home }));
    expect(out).toContain('opus-1m-max');
    expect(out).toContain('override');
  });
});

describe('configGetCommand', () => {
  it('prints bare value when override present', () => {
    const home = makeTmp();
    writeConfig(home, { phase: { '1': { preset: 'opus-1m-max' } } });
    const out = captureStdout(() => configGetCommand('phase.1.preset', { homeDir: home }));
    expect(out.trim()).toBe('opus-1m-max');
  });
  it('prints default value with (default) annotation when unset', () => {
    const home = makeTmp();
    const out = captureStdout(() => configGetCommand('phase.1.preset', { homeDir: home }));
    expect(out).toContain(PHASE_DEFAULTS[1]);
    expect(out).toContain('(default)');
  });
  it('exits 1 with stderr mentioning phase 6 for phase.6.preset', () => {
    const home = makeTmp();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit1'); });
    const err = captureStderr(() => {
      try { configGetCommand('phase.6.preset', { homeDir: home }); } catch { /* exit mock */ }
    });
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(err).toContain('phase 6');
  });
});

describe('configSetCommand', () => {
  it('writes config.json and prints "key = value" confirmation', () => {
    const home = makeTmp();
    const out = captureStdout(() => configSetCommand('phase.1.preset', 'opus-1m-max', { homeDir: home }));
    expect(out.trim()).toBe('phase.1.preset = opus-1m-max');
    const saved = JSON.parse(fs.readFileSync(path.join(home, '.harness', 'config.json'), 'utf-8'));
    expect(saved.phase['1'].preset).toBe('opus-1m-max');
  });
  it('exits 1 for bogus preset id, does not create config.json', () => {
    const home = makeTmp();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit1'); });
    const err = captureStderr(() => {
      try { configSetCommand('phase.1.preset', 'bogus-id', { homeDir: home }); } catch { /* exit mock */ }
    });
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(err).toContain('bogus-id');
    expect(fs.existsSync(path.join(home, '.harness', 'config.json'))).toBe(false);
  });
  it('exits 1 for phase.6.preset, does not create config.json', () => {
    const home = makeTmp();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit1'); });
    captureStderr(() => {
      try { configSetCommand('phase.6.preset', 'opus-1m-max', { homeDir: home }); } catch { /* exit mock */ }
    });
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(fs.existsSync(path.join(home, '.harness', 'config.json'))).toBe(false);
  });
});

describe('configResetCommand', () => {
  it('removes override and prints "reset <key>"', () => {
    const home = makeTmp();
    writeConfig(home, { phase: { '1': { preset: 'opus-1m-max' } } });
    const out = captureStdout(() => configResetCommand('phase.1.preset', { homeDir: home }));
    expect(out).toContain('reset phase.1.preset');
    const saved = JSON.parse(fs.readFileSync(path.join(home, '.harness', 'config.json'), 'utf-8'));
    expect(saved.phase?.['1']?.preset).toBeUndefined();
  });
  it('is idempotent — prints no-op message and exits 0 on second reset', () => {
    const home = makeTmp();
    writeConfig(home, { phase: { '1': { preset: 'opus-1m-max' } } });
    configResetCommand('phase.1.preset', { homeDir: home });
    const out2 = captureStdout(() => configResetCommand('phase.1.preset', { homeDir: home }));
    expect(out2).toContain('no override to reset');
  });
});

describe('malformed config.json — all four subcommands exit 1', () => {
  function writeBadConfig(home: string): void {
    fs.mkdirSync(path.join(home, '.harness'), { recursive: true });
    fs.writeFileSync(path.join(home, '.harness', 'config.json'), '{bad json}');
  }
  it.each([
    ['list', (home: string) => configListCommand({ homeDir: home })],
    ['get', (home: string) => configGetCommand('phase.1.preset', { homeDir: home })],
    ['set', (home: string) => configSetCommand('phase.1.preset', 'opus-1m-max', { homeDir: home })],
    ['reset', (home: string) => configResetCommand('phase.1.preset', { homeDir: home })],
  ] as const)('config %s exits 1 with config.json in stderr', (_name, fn) => {
    const home = makeTmp();
    writeBadConfig(home);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit1'); });
    const err = captureStderr(() => { try { fn(home); } catch { /* exit mock */ } });
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(err).toContain('config.json');
  });
});

describe('stale override annotation', () => {
  it('config list shows (stale) for unknown preset id', () => {
    const home = makeTmp();
    fs.mkdirSync(path.join(home, '.harness'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.harness', 'config.json'),
      JSON.stringify({ phase: { '1': { preset: 'old-preset-removed' } } }),
    );
    const out = captureStdout(() => configListCommand({ homeDir: home }));
    expect(out).toContain('stale');
  });
  it('config get shows (override, stale) for unknown preset id', () => {
    const home = makeTmp();
    fs.mkdirSync(path.join(home, '.harness'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.harness', 'config.json'),
      JSON.stringify({ phase: { '1': { preset: 'old-preset-removed' } } }),
    );
    const out = captureStdout(() => configGetCommand('phase.1.preset', { homeDir: home }));
    expect(out).toContain('(override, stale)');
  });
});
