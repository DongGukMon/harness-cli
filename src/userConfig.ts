import fs from 'fs';
import path from 'path';
import os from 'os';
import { MODEL_PRESETS, PHASE_DEFAULTS, REQUIRED_PHASE_KEYS, INTERACTIVE_TIMEOUT_MS } from './config.js';
import type { HarnessState } from './types.js';

export interface UserConfigPhaseEntry {
  preset?: string;
  /** Per-phase override for INTERACTIVE_TIMEOUT_MS (issue #116 B4). Valid only
   * for interactive phases (1 / 3 / 5). Stored as a positive integer ms. */
  timeoutMs?: number;
}

export interface UserConfig {
  phase?: Record<string, UserConfigPhaseEntry>;
}

export type ConfigFieldName = 'preset' | 'timeoutMs';
/** Phases that accept a `timeoutMs` override — interactive runners only. The
 * gate phases (2/4/7) have their own GATE_TIMEOUT_MS cap and are intentionally
 * not configurable here (see issue #116 B4 scope). */
export const TIMEOUT_CONFIGURABLE_PHASES = new Set(['1', '3', '5']);

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

export function parseConfigKey(key: string): { phase: string; field: ConfigFieldName } {
  // Matches phase.<N>.<field> where field is one of the known suffixes.
  const match = key.match(/^phase\.(\w+)\.(preset|timeoutMs)$/);
  if (!match) {
    throw new UserConfigKeyError(
      `Error: unknown config key '${key}'. Supported keys: phase.<1|2|3|4|5|7>.preset, phase.<1|3|5>.timeoutMs`,
    );
  }
  const phase = match[1];
  const field = match[2] as ConfigFieldName;
  if (phase === '6') {
    throw new UserConfigKeyError(
      `Error: phase 6 is the verify script (no model); cannot configure. Supported phases: 1, 2, 3, 4, 5, 7.`,
    );
  }
  if (field === 'preset') {
    if (!SUPPORTED_PHASES.has(phase)) {
      throw new UserConfigKeyError(
        `Error: unknown phase '${phase}'. Supported phases: 1, 2, 3, 4, 5, 7.`,
      );
    }
  } else {
    // field === 'timeoutMs' — interactive phases only (#116 B4).
    if (!TIMEOUT_CONFIGURABLE_PHASES.has(phase)) {
      throw new UserConfigKeyError(
        `Error: phase.${phase}.timeoutMs is not configurable. ` +
        `timeoutMs may only be set on interactive phases (1, 3, 5). ` +
        `Gates (2, 4, 7) use GATE_TIMEOUT_MS and are not exposed here.`,
      );
    }
  }
  return { phase, field };
}

export function getOverride(config: UserConfig, key: string): string | number | undefined {
  const { phase, field } = parseConfigKey(key);
  return config.phase?.[phase]?.[field];
}

export function setOverride(
  config: UserConfig,
  key: string,
  value: string | number,
): UserConfig {
  const { phase, field } = parseConfigKey(key);
  const existing = config.phase?.[phase] ?? {};
  const updated: UserConfigPhaseEntry = { ...existing };
  if (field === 'preset') {
    if (typeof value !== 'string') {
      throw new TypeError(`preset override must be a string, got ${typeof value}`);
    }
    updated.preset = value;
  } else {
    if (typeof value !== 'number') {
      throw new TypeError(`timeoutMs override must be a number, got ${typeof value}`);
    }
    updated.timeoutMs = value;
  }
  return {
    ...config,
    phase: {
      ...(config.phase ?? {}),
      [phase]: updated,
    },
  };
}

export function clearOverride(config: UserConfig, key: string): UserConfig {
  const { phase, field } = parseConfigKey(key);
  if (config.phase?.[phase]?.[field] === undefined) return config;
  const newPhase = { ...(config.phase ?? {}) };
  const entry = { ...newPhase[phase] };
  delete entry[field];
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

/**
 * Resolve the effective interactive-phase timeout (ms) for an interactive
 * phase (1 / 3 / 5). Reads `~/.harness/config.json` via `loadUserConfig`. If
 * the saved value is missing, malformed, or non-positive, emits a single
 * stderr warning and falls back to `INTERACTIVE_TIMEOUT_MS` (issue #116 B4).
 *
 * This helper is called from `runInteractivePhase` at phase entry; it MUST
 * NOT throw — the timeout resolver should never block a phase from starting.
 * `loadUserConfig` can throw on malformed JSON, which `start`/`run` already
 * surfaces at session entry, so by the time we reach this helper the file
 * has been validated. As a belt-and-suspenders measure, parse errors here
 * silently fall back to the default (best-effort).
 */
export function getEffectiveInteractiveTimeoutMs(
  phase: number,
  homeDir?: string,
): number {
  let config: UserConfig;
  try {
    config = loadUserConfig(homeDir);
  } catch {
    return INTERACTIVE_TIMEOUT_MS;
  }
  const phaseKey = String(phase);
  const override = config.phase?.[phaseKey]?.timeoutMs;
  if (override === undefined) return INTERACTIVE_TIMEOUT_MS;
  if (typeof override !== 'number' || !Number.isInteger(override) || override <= 0) {
    process.stderr.write(
      `[harness] config phase.${phaseKey}.timeoutMs='${String(override)}' is not a positive integer; ` +
      `falling back to built-in default ${INTERACTIVE_TIMEOUT_MS} ms.\n`,
    );
    return INTERACTIVE_TIMEOUT_MS;
  }
  return override;
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
