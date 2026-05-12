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
