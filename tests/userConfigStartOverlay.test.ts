import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { applyUserConfigOverrides, UserConfigParseError } from '../src/userConfig.js';
import { PHASE_DEFAULTS, REQUIRED_PHASE_KEYS } from '../src/config.js';
import type { HarnessState } from '../src/types.js';

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  vi.restoreAllMocks();
});
function makeTmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-test-'));
  tmpDirs.push(d);
  return d;
}
function makeState(): HarnessState {
  const phasePresets: Record<string, string> = {};
  for (const p of REQUIRED_PHASE_KEYS) phasePresets[p] = PHASE_DEFAULTS[Number(p)];
  return { phasePresets } as unknown as HarnessState;
}

describe('applyUserConfigOverrides', () => {
  it('no-op when config.json absent', () => {
    const state = makeState();
    const before = { ...state.phasePresets };
    applyUserConfigOverrides(state, makeTmp());
    expect(state.phasePresets).toEqual(before);
  });
  it('applies override for phase 1, leaves other phases at built-in default', () => {
    const home = makeTmp();
    fs.mkdirSync(path.join(home, '.harness'));
    fs.writeFileSync(
      path.join(home, '.harness', 'config.json'),
      JSON.stringify({ phase: { '1': { preset: 'opus-1m-max' } } }),
    );
    const state = makeState();
    applyUserConfigOverrides(state, home);
    expect(state.phasePresets['1']).toBe('opus-1m-max');
    expect(state.phasePresets['2']).toBe(PHASE_DEFAULTS[2]);
  });
  it('warns to stderr and keeps built-in default for stale override', () => {
    const home = makeTmp();
    fs.mkdirSync(path.join(home, '.harness'));
    fs.writeFileSync(
      path.join(home, '.harness', 'config.json'),
      JSON.stringify({ phase: { '1': { preset: 'stale-gone-preset' } } }),
    );
    const state = makeState();
    const stderrSpy = vi.spyOn(process.stderr, 'write');
    applyUserConfigOverrides(state, home);
    expect(state.phasePresets['1']).toBe(PHASE_DEFAULTS[1]);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('stale-gone-preset'));
  });
  it('throws UserConfigParseError on malformed config.json', () => {
    const home = makeTmp();
    fs.mkdirSync(path.join(home, '.harness'));
    fs.writeFileSync(path.join(home, '.harness', 'config.json'), '{bad}');
    expect(() => applyUserConfigOverrides(makeState(), home)).toThrowError(UserConfigParseError);
  });
});
