# phase-harness `config` subcommand — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `phase-harness config list|get|set|reset` to persist per-phase preset overrides in `~/.harness/config.json` and auto-apply them on fresh `start`/`run`.

**Architecture:** A new pure-I/O module `src/userConfig.ts` owns all config file access, key parsing, and start-time overlay logic. Four thin CLI handlers in `src/commands/config.ts` call into it. `src/commands/start.ts` calls `applyUserConfigOverrides(state)` once, between `createInitialState()` and the first `writeState()`.

**Tech Stack:** TypeScript, Node.js `fs`/`path`/`os` (stdlib only — no new deps), commander (existing), vitest.

- Related spec: `docs/specs/2026-05-12-phase-harness-cli-config-b565-design.md`
- Related decisions: `.harness/2026-05-12-phase-harness-cli-config-b565/decisions.md`

---

### Task 1: `src/userConfig.ts` + unit tests

**Files:**
- Create: `src/userConfig.ts`
- Create: `tests/userConfig.test.ts`
- Create: `tests/userConfigStartOverlay.test.ts`

- [ ] **Step 1: Write failing tests for `userConfig.ts`**

Create `tests/userConfig.test.ts`:

```typescript
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
```

Create `tests/userConfigStartOverlay.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/config-cmd
pnpm vitest run tests/userConfig.test.ts tests/userConfigStartOverlay.test.ts
```

Expected: errors like "Cannot find module '../src/userConfig.js'"

- [ ] **Step 3: Implement `src/userConfig.ts`**

Create `src/userConfig.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import os from 'os';
import { MODEL_PRESETS, PHASE_DEFAULTS, REQUIRED_PHASE_KEYS } from './config.js';
import type { HarnessState } from './types.js';

export interface UserConfig {
  phase?: Record<string, { preset?: string }>;
}

export class UserConfigParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserConfigParseError';
  }
}

export class UserConfigKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserConfigKeyError';
  }
}

const SUPPORTED_PHASES = new Set(['1', '2', '3', '4', '5', '7']);

export function getUserConfigPath(homeDir?: string): string {
  return path.join(homeDir ?? os.homedir(), '.harness', 'config.json');
}

export function loadUserConfig(homeDir?: string): UserConfig {
  const configPath = getUserConfigPath(homeDir);
  if (!fs.existsSync(configPath)) return {};
  const raw = fs.readFileSync(configPath, 'utf-8');
  try {
    return JSON.parse(raw) as UserConfig;
  } catch (err) {
    throw new UserConfigParseError(
      `~/.harness/config.json is not valid JSON: ${(err as Error).message}. Edit or delete the file to recover.`,
    );
  }
}

export function saveUserConfig(config: UserConfig, homeDir?: string): void {
  const configPath = getUserConfigPath(homeDir);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const tmpPath = configPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2));
  const fd = fs.openSync(tmpPath, 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmpPath, configPath);
}

export function parseConfigKey(key: string): { phase: string } {
  const match = key.match(/^phase\.(\w+)\.preset$/);
  if (!match) {
    throw new UserConfigKeyError(
      `Error: unknown config key '${key}'. Supported keys: phase.<1|2|3|4|5|7>.preset`,
    );
  }
  const phase = match[1];
  if (phase === '6') {
    throw new UserConfigKeyError(
      `Error: phase 6 is the verify script (no model); cannot configure. Supported phases: 1, 2, 3, 4, 5, 7.`,
    );
  }
  if (!SUPPORTED_PHASES.has(phase)) {
    throw new UserConfigKeyError(
      `Error: unknown phase '${phase}'. Supported phases: 1, 2, 3, 4, 5, 7.`,
    );
  }
  return { phase };
}

export function getOverride(config: UserConfig, key: string): string | undefined {
  const { phase } = parseConfigKey(key);
  return config.phase?.[phase]?.preset;
}

export function setOverride(config: UserConfig, key: string, value: string): UserConfig {
  const { phase } = parseConfigKey(key);
  return {
    ...config,
    phase: {
      ...(config.phase ?? {}),
      [phase]: { ...(config.phase?.[phase] ?? {}), preset: value },
    },
  };
}

export function clearOverride(config: UserConfig, key: string): UserConfig {
  const { phase } = parseConfigKey(key);
  if (!config.phase?.[phase]?.preset) return config;
  const newPhase = { ...(config.phase ?? {}) };
  const entry = { ...newPhase[phase] };
  delete entry.preset;
  if (Object.keys(entry).length === 0) {
    delete newPhase[phase];
  } else {
    newPhase[phase] = entry;
  }
  return { ...config, phase: newPhase };
}

export function getEffectivePreset(
  config: UserConfig,
  phase: string,
): { value: string; source: 'default' | 'override' } {
  const override = config.phase?.[phase]?.preset;
  if (override !== undefined) return { value: override, source: 'override' };
  return { value: PHASE_DEFAULTS[Number(phase)], source: 'default' };
}

export function applyUserConfigOverrides(state: HarnessState, homeDir?: string): void {
  const config = loadUserConfig(homeDir); // throws UserConfigParseError — caller handles
  const presetIds = new Set(MODEL_PRESETS.map(p => p.id));
  for (const phase of REQUIRED_PHASE_KEYS) {
    const override = config.phase?.[phase]?.preset;
    if (override === undefined) continue;
    if (!presetIds.has(override)) {
      process.stderr.write(
        `Saved config phase.${phase}.preset='${override}' is no longer a known preset; ` +
        `using built-in default '${PHASE_DEFAULTS[Number(phase)]}'.\n`,
      );
      continue;
    }
    state.phasePresets[phase] = override;
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm vitest run tests/userConfig.test.ts tests/userConfigStartOverlay.test.ts
```

Expected: all tests pass, no failures.

- [ ] **Step 5: Typecheck**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/userConfig.ts tests/userConfig.test.ts tests/userConfigStartOverlay.test.ts
git commit -m "feat(config): add userConfig module with I/O, key parsing, and start-time overlay"
```

---

### Task 2: `src/commands/config.ts` + `bin/harness.ts` + command tests

**Files:**
- Create: `src/commands/config.ts`
- Modify: `bin/harness.ts`
- Create: `tests/commands/config.test.ts`

- [ ] **Step 1: Write failing command tests**

Create `tests/commands/config.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm vitest run tests/commands/config.test.ts
```

Expected: "Cannot find module '../../src/commands/config.js'"

- [ ] **Step 3: Implement `src/commands/config.ts`**

Create `src/commands/config.ts`:

```typescript
import {
  loadUserConfig,
  saveUserConfig,
  parseConfigKey,
  getEffectivePreset,
  setOverride,
  clearOverride,
  UserConfigParseError,
  UserConfigKeyError,
  type UserConfig,
} from '../userConfig.js';
import { MODEL_PRESETS, REQUIRED_PHASE_KEYS } from '../config.js';

export interface ConfigCommandOptions {
  homeDir?: string;
}

const SUPPORTED_PRESET_IDS = new Set(MODEL_PRESETS.map(p => p.id));

function loadOrExit(homeDir?: string): UserConfig {
  try {
    return loadUserConfig(homeDir);
  } catch (err) {
    if (err instanceof UserConfigParseError) {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    }
    throw err;
  }
}

function parseKeyOrExit(key: string): { phase: string } {
  try {
    return parseConfigKey(key);
  } catch (err) {
    if (err instanceof UserConfigKeyError) {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    }
    throw err;
  }
}

function padRight(s: string, len: number): string {
  return s + ' '.repeat(Math.max(0, len - s.length));
}

export function configListCommand(opts: ConfigCommandOptions = {}): void {
  const config = loadOrExit(opts.homeDir);
  const rows: Array<{ key: string; value: string; source: string }> = [];
  for (const phase of REQUIRED_PHASE_KEYS) {
    const override = config.phase?.[phase]?.preset;
    let value: string;
    let source: string;
    if (override !== undefined) {
      const stale = !SUPPORTED_PRESET_IDS.has(override);
      value = stale ? `${override} (stale)` : override;
      source = stale ? 'override (stale)' : 'override';
    } else {
      value = getEffectivePreset(config, phase).value;
      source = 'default';
    }
    rows.push({ key: `phase.${phase}.preset`, value, source });
  }
  const header = { key: 'key', value: 'value', source: 'source' };
  const colKey = Math.max(header.key.length, ...rows.map(r => r.key.length));
  const colVal = Math.max(header.value.length, ...rows.map(r => r.value.length));
  const colSrc = Math.max(header.source.length, ...rows.map(r => r.source.length));
  const line = (r: { key: string; value: string; source: string }) =>
    `${padRight(r.key, colKey)}  ${padRight(r.value, colVal)}  ${r.source}\n`;
  process.stdout.write(line(header));
  process.stdout.write(`${'-'.repeat(colKey)}  ${'-'.repeat(colVal)}  ${'-'.repeat(colSrc)}\n`);
  for (const row of rows) process.stdout.write(line(row));
}

export function configGetCommand(key: string, opts: ConfigCommandOptions = {}): void {
  const { phase } = parseKeyOrExit(key);
  const config = loadOrExit(opts.homeDir);
  const override = config.phase?.[phase]?.preset;
  if (override !== undefined) {
    const stale = !SUPPORTED_PRESET_IDS.has(override);
    process.stdout.write(stale ? `${override} (override, stale)\n` : `${override}\n`);
  } else {
    process.stdout.write(`${getEffectivePreset(config, phase).value} (default)\n`);
  }
}

export function configSetCommand(key: string, value: string, opts: ConfigCommandOptions = {}): void {
  parseKeyOrExit(key);
  if (!SUPPORTED_PRESET_IDS.has(value)) {
    process.stderr.write(
      `Error: unknown preset id '${value}'. Run 'phase-harness config list' or see src/config.ts MODEL_PRESETS for valid ids.\n`,
    );
    process.exit(1);
  }
  const config = loadOrExit(opts.homeDir);
  saveUserConfig(setOverride(config, key, value), opts.homeDir);
  process.stdout.write(`${key} = ${value}\n`);
}

export function configResetCommand(key: string, opts: ConfigCommandOptions = {}): void {
  const { phase } = parseKeyOrExit(key);
  const config = loadOrExit(opts.homeDir);
  if (!config.phase?.[phase]?.preset) {
    process.stdout.write(`${key} already at default (no override to reset)\n`);
    return;
  }
  saveUserConfig(clearOverride(config, key), opts.homeDir);
  process.stdout.write(`reset ${key}\n`);
}
```

- [ ] **Step 4: Register `config` command in `bin/harness.ts`**

Add the import after the existing imports (before `const program = new Command();`):

```typescript
import {
  configListCommand,
  configGetCommand,
  configSetCommand,
  configResetCommand,
} from '../src/commands/config.js';
```

Add the command block before `program.parseAsync(process.argv)`:

```typescript
const configCmd = program
  .command('config')
  .description('manage per-phase preset overrides in ~/.harness/config.json');

configCmd
  .command('list')
  .description('list all phase preset keys with their current value and source')
  .action(() => { configListCommand(); });

configCmd
  .command('get <key>')
  .description('get the effective value for a config key (e.g. phase.1.preset)')
  .action((key: string) => { configGetCommand(key); });

configCmd
  .command('set <key> <value>')
  .description('set a config key to a preset id (e.g. phase.1.preset opus-1m-max)')
  .action((key: string, value: string) => { configSetCommand(key, value); });

configCmd
  .command('reset <key>')
  .description('remove the override for a config key, reverting to the built-in default')
  .action((key: string) => { configResetCommand(key); });
```

- [ ] **Step 5: Run tests and typecheck**

```bash
pnpm vitest run tests/commands/config.test.ts tests/userConfig.test.ts tests/userConfigStartOverlay.test.ts
pnpm tsc --noEmit
```

Expected: all pass, no type errors.

- [ ] **Step 6: Smoke-test the registered command**

```bash
pnpm build
node dist/bin/harness.js config list --help
node dist/bin/harness.js config --help
```

Expected: `list`, `get`, `set`, `reset` subcommands appear in help output.

- [ ] **Step 7: Commit**

```bash
git add src/commands/config.ts bin/harness.ts tests/commands/config.test.ts
git commit -m "feat(config): add config subcommand (list/get/set/reset) and bin registration"
```

---

### Task 3: `start.ts` overlay + doc updates

**Files:**
- Modify: `src/commands/start.ts`
- Modify: `README.md`
- Modify: `README.ko.md`
- Modify: `docs/HOW-IT-WORKS.md`
- Modify: `docs/HOW-IT-WORKS.ko.md`

- [ ] **Step 1: Add `applyUserConfigOverrides` call to `start.ts`**

At the top of `start.ts`, add the import alongside existing imports:

```typescript
import { applyUserConfigOverrides, UserConfigParseError } from '../userConfig.js';
```

In `startCommand`, after `state.dirtyBaseline = captureDirtyBaseline(trackedRepos[0].path);` (around line 256) and before `// 13. Save task.md`, insert:

```typescript
    // Apply user config overrides (from ~/.harness/config.json) before first writeState.
    try {
      applyUserConfigOverrides(state);
    } catch (err) {
      if (err instanceof UserConfigParseError) {
        process.stderr.write(`Error: ${err.message}\n`);
        process.exit(1);
      }
      throw err;
    }
```

- [ ] **Step 2: Run existing start tests to confirm no regression**

```bash
pnpm vitest run tests/commands/start.test.ts tests/state.test.ts
```

Expected: all pass (NFR-3 — no `~/.harness/config.json` means no-op).

- [ ] **Step 3: Add `config` section to `README.md`**

Find the `### \`phase-harness resume [runId]\`` heading in README.md. Insert the following block immediately before it:

```markdown
### `phase-harness config`

Manage per-phase preset overrides saved in `~/.harness/config.json`. Overrides apply to fresh `start`/`run` calls only; existing runs are unaffected.

```bash
phase-harness config list                           # show all phase keys with value and source
phase-harness config get phase.1.preset             # effective value (override or default)
phase-harness config set phase.1.preset opus-1m-max # persist override
phase-harness config reset phase.1.preset           # remove override, revert to built-in default
```

Resolution precedence on `start`/`run`: (1) saved config override, (2) built-in `PHASE_DEFAULTS`.

`resume` always uses the presets frozen in `state.json` at run-creation time — saved config is never re-applied on resume.

```

- [ ] **Step 4: Add `config` section to `README.ko.md`**

Find `### \`phase-harness resume [runId]\`` in README.ko.md. Insert immediately before it:

```markdown
### `phase-harness config`

`~/.harness/config.json`에 저장되는 페이즈별 프리셋 오버라이드를 관리합니다. 오버라이드는 새 `start`/`run` 실행 시에만 적용되며, 기존 실행에는 영향을 주지 않습니다.

```bash
phase-harness config list                           # 전체 페이즈 키와 현재 값·출처 표시
phase-harness config get phase.1.preset             # 유효 값 확인 (오버라이드 또는 기본값)
phase-harness config set phase.1.preset opus-1m-max # 오버라이드 저장
phase-harness config reset phase.1.preset           # 오버라이드 제거, 내장 기본값으로 복원
```

`start`/`run` 시 해결 우선순위: (1) 저장된 config 오버라이드, (2) 내장 `PHASE_DEFAULTS`.

`resume`은 항상 실행 생성 시 `state.json`에 고정된 프리셋을 사용합니다. 저장된 config는 resume 시 재적용되지 않습니다.

```

- [ ] **Step 5: Update `docs/HOW-IT-WORKS.md` "Built-in presets and defaults" section**

After the last sentence in the "Built-in presets and defaults" section (`Existing saved runs are not auto-migrated...`), add:

```markdown

### User config overrides

Users can persist per-phase preset overrides in `~/.harness/config.json` via `phase-harness config set`. On every fresh `phase-harness start` / `phase-harness run`, the harness reads this file and overlays any saved overrides onto the built-in `PHASE_DEFAULTS` before writing `state.json`. If a saved preset id is no longer in the catalog (stale), a stderr warning is emitted and the built-in default is used instead.

`phase-harness resume` never reads `~/.harness/config.json`; the presets in `state.json` are authoritative for existing runs.

If `~/.harness/config.json` contains invalid JSON, every `config` subcommand and any new `start`/`run` exits non-zero immediately.
```

- [ ] **Step 6: Update `docs/HOW-IT-WORKS.ko.md` "Built-in presets and defaults" section**

Find the equivalent Korean section header in HOW-IT-WORKS.ko.md and append after the last sentence of that section:

```markdown

### 사용자 config 오버라이드

`phase-harness config set`으로 `~/.harness/config.json`에 페이즈별 프리셋 오버라이드를 저장할 수 있습니다. 새 `phase-harness start` / `phase-harness run` 실행 시, 하네스가 이 파일을 읽어 내장 `PHASE_DEFAULTS` 위에 오버라이드를 덮어쓴 후 `state.json`을 기록합니다. 저장된 프리셋 id가 카탈로그에 더 이상 없으면(stale) stderr 경고를 출력하고 내장 기본값을 사용합니다.

`phase-harness resume`은 `~/.harness/config.json`을 읽지 않습니다. 기존 실행의 프리셋은 `state.json`이 기준입니다.

`~/.harness/config.json`이 유효하지 않은 JSON이면, 모든 `config` 서브커맨드와 새 `start`/`run`은 즉시 non-zero로 종료됩니다.
```

- [ ] **Step 7: Run full test suite and typecheck**

```bash
pnpm vitest run
pnpm tsc --noEmit
```

Expected: all tests pass (including existing tests — NFR-3 regression check), no type errors.

- [ ] **Step 8: Build and smoke-test**

```bash
pnpm build
node dist/bin/harness.js config list
```

Expected: 6-row table covering phases 1, 2, 3, 4, 5, 7 with all rows showing `default` source.

- [ ] **Step 9: Verify INV-8 doc grep**

```bash
grep -l "phase-harness config" README.md README.ko.md docs/HOW-IT-WORKS.md docs/HOW-IT-WORKS.ko.md
```

Expected: all four filenames printed.

- [ ] **Step 10: Commit**

```bash
git add src/commands/start.ts README.md README.ko.md docs/HOW-IT-WORKS.md docs/HOW-IT-WORKS.ko.md
git commit -m "feat(config): wire applyUserConfigOverrides into start.ts and update docs"
```
