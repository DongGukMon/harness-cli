import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  loadUserConfig,
  saveUserConfig,
  parseConfigKey,
  getEffectivePreset,
  getEffectiveInteractiveTimeoutMs,
  UserConfigParseError,
  UserConfigKeyError,
} from '../src/userConfig.js';
import { PHASE_DEFAULTS, INTERACTIVE_TIMEOUT_MS } from '../src/config.js';

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
  it("parses 'phase.1.preset' → { phase: '1', field: 'preset' }", () => {
    expect(parseConfigKey('phase.1.preset')).toEqual({ phase: '1', field: 'preset' });
  });
  it("parses 'phase.5.timeoutMs' → { phase: '5', field: 'timeoutMs' } (#116 B4)", () => {
    expect(parseConfigKey('phase.5.timeoutMs')).toEqual({ phase: '5', field: 'timeoutMs' });
  });
  it.each(['1', '3', '5'])(
    "accepts phase.%s.timeoutMs (interactive phases only)",
    (n) => {
      expect(parseConfigKey(`phase.${n}.timeoutMs`)).toEqual({ phase: n, field: 'timeoutMs' });
    },
  );
  it.each(['2', '4', '7'])(
    'rejects phase.%s.timeoutMs (gates use GATE_TIMEOUT_MS, not configurable here)',
    (n) => {
      expect(() => parseConfigKey(`phase.${n}.timeoutMs`)).toThrowError(UserConfigKeyError);
    },
  );
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

// ─── #116 B4: per-phase timeout override ─────────────────────────────────────

describe('phase.<N>.timeoutMs round-trip (#116 B4)', () => {
  it('saves and loads phase.5.timeoutMs through saveUserConfig/loadUserConfig', () => {
    const home = makeTmp();
    saveUserConfig({ phase: { '5': { timeoutMs: 3_600_000 } } }, home);
    expect(loadUserConfig(home)).toEqual({ phase: { '5': { timeoutMs: 3_600_000 } } });
  });
  it('preset and timeoutMs coexist on the same phase entry', () => {
    const home = makeTmp();
    saveUserConfig(
      { phase: { '5': { preset: 'sonnet-high', timeoutMs: 3_600_000 } } },
      home,
    );
    const loaded = loadUserConfig(home);
    expect(loaded.phase?.['5']?.preset).toBe('sonnet-high');
    expect(loaded.phase?.['5']?.timeoutMs).toBe(3_600_000);
  });
});

describe('getEffectiveInteractiveTimeoutMs (#116 B4)', () => {
  it('returns INTERACTIVE_TIMEOUT_MS default when no config file exists', () => {
    const home = makeTmp();
    expect(getEffectiveInteractiveTimeoutMs(3, home)).toBe(INTERACTIVE_TIMEOUT_MS);
  });
  it('returns INTERACTIVE_TIMEOUT_MS default when override is absent for that phase', () => {
    const home = makeTmp();
    fs.mkdirSync(path.join(home, '.harness'));
    fs.writeFileSync(
      path.join(home, '.harness', 'config.json'),
      JSON.stringify({ phase: { '5': { timeoutMs: 7_200_000 } } }),
    );
    expect(getEffectiveInteractiveTimeoutMs(3, home)).toBe(INTERACTIVE_TIMEOUT_MS);
  });
  it('returns override value when set for that phase', () => {
    const home = makeTmp();
    fs.mkdirSync(path.join(home, '.harness'));
    fs.writeFileSync(
      path.join(home, '.harness', 'config.json'),
      JSON.stringify({ phase: { '3': { timeoutMs: 3_600_000 } } }),
    );
    expect(getEffectiveInteractiveTimeoutMs(3, home)).toBe(3_600_000);
  });
  it.each([
    ['negative', -1],
    ['zero', 0],
    ['non-integer', 1234.5],
    ['string', 'oops' as unknown as number],
  ])('warns + falls back to default when stored value is %s', (_name, badValue) => {
    const home = makeTmp();
    fs.mkdirSync(path.join(home, '.harness'));
    fs.writeFileSync(
      path.join(home, '.harness', 'config.json'),
      JSON.stringify({ phase: { '3': { timeoutMs: badValue } } }),
    );
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(getEffectiveInteractiveTimeoutMs(3, home)).toBe(INTERACTIVE_TIMEOUT_MS);
    expect(stderrSpy).toHaveBeenCalled();
  });
});
