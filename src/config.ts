import type { PendingAction, FlowMode, PhaseNumber, Artifacts, GatePhase, InteractivePhase } from './types.js';

export interface ModelPreset {
  id: string;
  label: string;
  runner: 'claude' | 'codex';
  model: string;
  effort: string;
}

// Model effort axes (per Anthropic 2026-04 guidance):
//   - Opus 4.7: high < xHigh < max (three distinct tiers)
//   - Sonnet 4.6: high < max (two tiers; no xHigh)
// The catalog registers every tier on each axis so users can make explicit
// cost/quality tradeoffs via `promptModelConfig`. PHASE_DEFAULTS still points
// at the conservative tier; `max` variants are opt-in.
export const MODEL_PRESETS: ModelPreset[] = [
  { id: 'opus-max',     label: 'Claude Opus 4.7 / max',    runner: 'claude', model: 'claude-opus-4-7',   effort: 'max'    },
  { id: 'opus-xhigh',   label: 'Claude Opus 4.7 / xHigh',  runner: 'claude', model: 'claude-opus-4-7',   effort: 'xHigh'  },
  { id: 'opus-high',    label: 'Claude Opus 4.7 / high',   runner: 'claude', model: 'claude-opus-4-7',   effort: 'high'   },
  { id: 'sonnet-max',   label: 'Claude Sonnet 4.6 / max',  runner: 'claude', model: 'claude-sonnet-4-6', effort: 'max'    },
  { id: 'sonnet-high',  label: 'Claude Sonnet 4.6 / high', runner: 'claude', model: 'claude-sonnet-4-6', effort: 'high'   },
  { id: 'codex-high',   label: 'Codex / high',             runner: 'codex',  model: 'gpt-5.4',           effort: 'high'   },
  { id: 'codex-medium', label: 'Codex / medium',           runner: 'codex',  model: 'gpt-5.4',           effort: 'medium' },
];

export const PHASE_DEFAULTS: Record<number, string> = {
  1: 'opus-high',
  2: 'codex-high',
  3: 'sonnet-high',
  4: 'codex-high',
  5: 'sonnet-high',
  7: 'codex-high',
};

export const REQUIRED_PHASE_KEYS = ['1', '2', '3', '4', '5', '7'] as const;

export function getPresetById(id: string): ModelPreset | undefined {
  return MODEL_PRESETS.find(p => p.id === id);
}

export function getEffectiveReopenTarget(pa: PendingAction): number | null {
  if (pa.type === 'reopen_phase') return pa.targetPhase;
  if (pa.type === 'show_escalation') return pa.sourcePhase;
  return null;
}

export const GATE_TIMEOUT_MS = 360_000;  // 6 min — Codex high-effort typically takes 2-4 min
export const VERIFY_TIMEOUT_MS = 300_000;
export const INTERACTIVE_TIMEOUT_MS = 1_800_000; // 30 min
export const SIGTERM_WAIT_MS = 5_000;
export const GROUP_DRAIN_WAIT_MS = 5_000;
export const HANDOFF_TIMEOUT_MS = 5_000;

export const GATE_RETRY_LIMIT_FULL = 3;
export const GATE_RETRY_LIMIT_LIGHT = 5;
export const VERIFY_RETRY_LIMIT = 3;

export const MAX_FILE_SIZE_KB = 200;
export const MAX_DIFF_SIZE_KB = 50;
export const MAX_PROMPT_SIZE_KB = 500;
export const PER_FILE_DIFF_LIMIT_KB = 20;

export const TERMINAL_PHASE = 8;

export const INTERACTIVE_PHASES = [1, 3, 5] as const;
export const GATE_PHASES = [2, 4, 7] as const;

// P5 dirty-tree auto-recovery allowlist. Matched against untracked (`??`)
// lines from `git status --porcelain`; tracked-modified paths never qualify.
// Python / Node / macOS coverage only — Rust/Go/Java/Ruby deferred.
export interface IgnorablePattern {
  label: string;
  pathRegex: RegExp;
  gitignoreGlob: string;
}

export const IGNORABLE_ARTIFACTS: readonly IgnorablePattern[] = [
  { label: 'Python bytecode cache',    pathRegex: /(?:^|\/)__pycache__\//,    gitignoreGlob: '__pycache__/' },
  { label: 'Python compiled file',     pathRegex: /\.pyc$/,                   gitignoreGlob: '*.pyc' },
  { label: 'Python optimized file',    pathRegex: /\.pyo$/,                   gitignoreGlob: '*.pyo' },
  { label: 'pytest cache',             pathRegex: /(?:^|\/)\.pytest_cache\//, gitignoreGlob: '.pytest_cache/' },
  { label: 'Python venv',              pathRegex: /(?:^|\/)\.venv\//,         gitignoreGlob: '.venv/' },
  { label: 'mypy cache',               pathRegex: /(?:^|\/)\.mypy_cache\//,   gitignoreGlob: '.mypy_cache/' },
  { label: 'ruff cache',               pathRegex: /(?:^|\/)\.ruff_cache\//,   gitignoreGlob: '.ruff_cache/' },
  { label: 'Python coverage',          pathRegex: /(?:^|\/)\.coverage(\.|$)/, gitignoreGlob: '.coverage' },
  { label: 'Python tox',               pathRegex: /(?:^|\/)\.tox\//,          gitignoreGlob: '.tox/' },
  { label: 'Node modules',             pathRegex: /(?:^|\/)node_modules\//,   gitignoreGlob: 'node_modules/' },
  { label: 'macOS Finder metadata',    pathRegex: /(?:^|\/)\.DS_Store$/,      gitignoreGlob: '.DS_Store' },
];

export const PHASE_ARTIFACT_FILES: Record<number, string[]> = {
  1: ['spec', 'decisionLog'],
  3: ['plan', 'checklist'],
};

export const LIGHT_REQUIRED_PHASE_KEYS = ['1', '2', '5', '7'] as const;

export const LIGHT_PHASE_DEFAULTS: Record<number, string> = {
  1: 'opus-high',
  2: 'codex-high',
  5: 'sonnet-high',
  7: 'codex-high',
};

export function getRequiredPhaseKeys(flow: FlowMode): readonly string[] {
  return flow === 'light' ? LIGHT_REQUIRED_PHASE_KEYS : REQUIRED_PHASE_KEYS;
}

export function getPhaseDefaults(flow: FlowMode): Record<number, string> {
  return flow === 'light' ? LIGHT_PHASE_DEFAULTS : PHASE_DEFAULTS;
}

export function getPhaseArtifactFiles(
  flow: FlowMode,
  phase: PhaseNumber,
): Array<keyof Artifacts> {
  if (flow === 'light') {
    return phase === 1 ? ['spec', 'decisionLog', 'checklist'] : [];
  }
  if (phase === 1) return ['spec', 'decisionLog'];
  if (phase === 3) return ['plan', 'checklist'];
  return [];
}

export function getReopenTarget(flow: FlowMode, gate: GatePhase): InteractivePhase {
  if (flow === 'light' && gate === 7) return 1;
  if (gate === 2) return 1;
  if (gate === 4) return 3;
  return 5; // gate 7 + full
}

export function getGateRetryLimit(flow: FlowMode, gate?: GatePhase): number {
  if (flow === 'light' && gate === 2) return GATE_RETRY_LIMIT_FULL;
  return flow === 'light' ? GATE_RETRY_LIMIT_LIGHT : GATE_RETRY_LIMIT_FULL;
}
