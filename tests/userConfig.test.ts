import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  loadUserConfig,
  saveUserConfig,
  parseConfigKey,
  getEffectivePreset,
  UserConfigParseError,
  UserConfigKeyError,
} from '../src/userConfig.js';
import { PHASE_DEFAULTS } from '../src/config.js';

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  vi.restoreAllMocks();
});
function makeTmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'userconfig-test-'));
  tmpDirs.push(d);
  return d;
}

describe('loadUserConfig', () => {
  it('returns {} when file absent', () => {
    expect(loadUserConfig(makeTmp())).toEqual({});
  });
  it('parses valid JSON', () => {
    const home = makeTmp();
    fs.mkdirSync(path.join(home, '.harness'));
    fs.writeFileSync(
      path.join(home, '.harness', 'config.json'),
      JSON.stringify({ phase: { '1': { preset: 'opus-1m-max' } } }),
    );
    expect(loadUserConfig(home)).toEqual({ phase: { '1': { preset: 'opus-1m-max' } } });
  });
  it('throws UserConfigParseError on malformed JSON', () => {
    const home = makeTmp();
    fs.mkdirSync(path.join(home, '.harness'));
    fs.writeFileSync(path.join(home, '.harness', 'config.json'), '{bad json}');
    expect(() => loadUserConfig(home)).toThrowError(UserConfigParseError);
  });
});

describe('saveUserConfig', () => {
  it('writes atomically — no tmp file left behind', () => {
    const home = makeTmp();
    saveUserConfig({ phase: { '1': { preset: 'sonnet-high' } } }, home);
    const configPath = path.join(home, '.harness', 'config.json');
    expect(fs.existsSync(configPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(configPath, 'utf-8'))).toEqual({
      phase: { '1': { preset: 'sonnet-high' } },
    });
    expect(fs.existsSync(configPath + '.tmp')).toBe(false);
  });
  it('creates ~/.harness/ when missing', () => {
    const home = makeTmp();
    saveUserConfig({}, home);
    expect(fs.existsSync(path.join(home, '.harness'))).toBe(true);
  });
});

describe('parseConfigKey', () => {
  it("parses 'phase.1.preset' → { phase: '1' }", () => {
    expect(parseConfigKey('phase.1.preset')).toEqual({ phase: '1' });
  });
  it("throws UserConfigKeyError for 'phase.6.preset' and names phase 6", () => {
    expect(() => parseConfigKey('phase.6.preset')).toThrowError(UserConfigKeyError);
    try { parseConfigKey('phase.6.preset'); } catch (e) {
      expect((e as Error).message).toContain('phase 6');
    }
  });
  it.each(['phase.0.preset', 'phase.8.preset', 'phase.foo.preset', 'phase.1.model', 'random.thing', ''])(
    'throws UserConfigKeyError for invalid key %s',
    (key) => expect(() => parseConfigKey(key)).toThrowError(UserConfigKeyError),
  );
});

describe('getEffectivePreset', () => {
  it('returns built-in default when no override', () => {
    expect(getEffectivePreset({}, '1')).toEqual({ value: PHASE_DEFAULTS[1], source: 'default' });
  });
  it('returns override when present', () => {
    expect(getEffectivePreset({ phase: { '1': { preset: 'opus-1m-max' } } }, '1')).toEqual({
      value: 'opus-1m-max',
      source: 'override',
    });
  });
});
