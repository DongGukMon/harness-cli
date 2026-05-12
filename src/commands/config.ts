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
