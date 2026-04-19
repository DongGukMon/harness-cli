import { MODEL_PRESETS, REQUIRED_PHASE_KEYS, getPresetById } from './config.js';
import type { FooterSummary } from './metrics/footer-aggregator.js';
import type { HarnessState, FlowMode, SessionLogger, RenderCallsite } from './types.js';
import type { InputManager } from './input.js';

// ANSI color codes
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

export function separator(): string {
  const cols = process.stdout.columns;
  const width = typeof cols === 'number' && cols > 0
    ? Math.max(16, Math.min(64, cols - 2))
    : 62;
  return '━'.repeat(width);
}

function phaseLabel(phase: number, flow: FlowMode = 'full'): string {
  const labels: Record<number, string> = {
    1: flow === 'light' ? '설계+플랜' : 'Spec 작성',
    2: 'Spec Gate',
    3: 'Plan 작성',
    4: 'Plan Gate',
    5: '구현',
    6: '검증',
    7: 'Eval Gate',
  };
  return labels[phase] ?? `Phase ${phase}`;
}

export function renderControlPanel(
  state: HarnessState,
  logger?: SessionLogger,
  callsite?: RenderCallsite,
): void {
  process.stdout.write('\x1b[2J\x1b[H'); // clear screen
  console.error(separator());
  console.error(`${GREEN}▶${RESET} Harness Control Panel`);
  console.error(separator());
  console.error(`  Run:   ${state.runId}`);
  console.error(`  Phase: ${state.currentPhase}/7 — ${phaseLabel(state.currentPhase, state.flow)}`);
  const preset = getPresetById(state.phasePresets?.[String(state.currentPhase)] ?? '');
  if (preset) console.error(`  Model: ${preset.label}`);
  console.error('');

  for (let p = 1; p <= 7; p++) {
    const status = state.phases[String(p)] ?? 'pending';
    const isSkipped = status === 'skipped';
    const icon = status === 'completed' ? `${GREEN}✓${RESET}`
      : status === 'in_progress' ? `${YELLOW}▶${RESET}`
      : status === 'failed' || status === 'error' ? `${RED}✗${RESET}`
      : isSkipped ? '—'
      : ' ';
    const statusLabel = isSkipped ? '(skipped)' : `(${status})`;
    const current = p === state.currentPhase ? ' ← current' : '';
    console.error(`  [${icon}] Phase ${p}: ${phaseLabel(p, state.flow)} ${statusLabel}${current}`);
  }
  console.error('');
  console.error(separator());

  if (logger !== undefined && callsite !== undefined) {
    const phaseStatus = state.phases[String(state.currentPhase)] ?? 'pending';
    logger.logEvent({
      event: 'ui_render',
      phase: state.currentPhase,
      phaseStatus,
      callsite,
    });
  }
}

export function formatFooter(summary: FooterSummary, columns: number): string {
  if (typeof columns !== 'number' || columns <= 0) {
    return '';
  }

  const phaseElapsed = formatPhaseDuration(summary.phaseRunningElapsedMs ?? 0, columns);
  const sessionElapsed = formatSessionDuration(summary.sessionElapsedMs, columns);

  if (summary.currentPhase === 6) {
    return columns >= 80
      ? `P6 · ${phaseElapsed} phase · ${sessionElapsed} session`
      : 'P6 · ' + `${phaseElapsed} / ${sessionElapsed}`;
  }

  const totalTokens = formatTokenMillions(summary.totalTokens);
  if (columns >= 80) {
    const claudeTokens = formatTokenMillions(summary.claudeTokens);
    const gateTokens = formatTokenMillions(summary.gateTokens);
    return `P${summary.currentPhase} attempt ${summary.attempt} · ${phaseElapsed} phase · ${sessionElapsed} session · ${totalTokens} tok (${claudeTokens} Claude + ${gateTokens} gate)`;
  }

  return `P${summary.currentPhase} a${summary.attempt} · ${phaseElapsed} / ${sessionElapsed} · ${totalTokens} tok`;
}

export function writeFooterToPane(line: string, rows: number, columns: number): void {
  void columns;
  if (line.length === 0) {
    return;
  }

  process.stderr.write(`\x1b[s\x1b[${rows};1H\x1b[2K${line}\x1b[u`);
}

export function clearFooterRow(rows: number): void {
  process.stderr.write(`\x1b[s\x1b[${rows};1H\x1b[2K\x1b[u`);
}

function formatPhaseDuration(elapsedMs: number, columns: number): string {
  return formatDuration(elapsedMs, columns >= 80);
}

function formatSessionDuration(elapsedMs: number, columns: number): string {
  return formatDuration(elapsedMs, columns >= 80);
}

function formatDuration(elapsedMs: number, wide: boolean): string {
  const totalSeconds = Math.max(Math.floor(elapsedMs / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = String(seconds).padStart(2, '0');
  return wide ? `${minutes}m ${paddedSeconds}s` : `${minutes}m${paddedSeconds}s`;
}

function formatTokenMillions(tokens: number): string {
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

/**
 * Prompt user with single-key choices. Returns the selected key (uppercase).
 * Shows message + choices, waits for valid keypress.
 * choices example: [{ key: 'R', label: 'Retry' }, { key: 'S', label: 'Skip' }, { key: 'Q', label: 'Quit' }]
 */
export async function promptChoice(
  message: string,
  choices: { key: string; label: string }[],
  inputManager: InputManager,
): Promise<string> {
  const choiceText = choices.map((c) => `[${c.key.toUpperCase()}] ${c.label}`).join('  ');
  process.stderr.write(`\n${message}\n${choiceText}\n`);
  const validKeys = new Set(choices.map((c) => c.key.toLowerCase()));
  const key = await inputManager.waitForKey(validKeys);
  process.stderr.write('\n');
  return key;
}

/**
 * Print phase transition banner.
 * Example:
 *   ✓ Phase 2 완료 (Spec Gate — APPROVED)
 *   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   ▶ Phase 3 시작: Plan 작성
 *   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
export function printPhaseTransition(
  fromPhase: number,
  toPhase: number,
  fromStatus: string,
  toLabel: string,
): void {
  console.error(`${GREEN}✓${RESET} Phase ${fromPhase} 완료 (${fromStatus})`);
  console.error(separator());
  console.error(`${GREEN}▶${RESET} Phase ${toPhase} 시작: ${toLabel}`);
  console.error(separator());
}

/**
 * Print warning (yellow ⚠ prefix).
 */
export function printWarning(msg: string): void {
  console.error(`${YELLOW}⚠️  ${msg}${RESET}`);
}

/**
 * Print error (red ✗ prefix).
 */
export function printError(msg: string): void {
  console.error(`${RED}✗ ${msg}${RESET}`);
}

/**
 * Print success (green ✓ prefix).
 */
export function printSuccess(msg: string): void {
  console.error(`${GREEN}✓ ${msg}${RESET}`);
}

/**
 * Print info line.
 */
export function printInfo(msg: string): void {
  console.error(`${BLUE}ℹ ${msg}${RESET}`);
}

export function renderWelcome(runId: string): void {
  process.stdout.write('\x1b[2J\x1b[H');
  console.error(separator());
  console.error(`${GREEN}▶${RESET} Harness`);
  console.error(separator());
  console.error(`  Run: ${runId}`);
  console.error('');
  console.error('  What would you like to build?');
}

export function renderModelSelection(
  phasePresets: Record<string, string>,
  editablePhases?: Set<string>,
  flow: FlowMode = 'full',
): void {
  process.stdout.write('\x1b[2J\x1b[H');
  console.error(separator());
  console.error(`${GREEN}▶${RESET} Model Configuration`);
  console.error(separator());

  const phaseLabels: Record<string, string> = {
    '1': flow === 'light' ? '설계+플랜' : 'Spec 작성',
    '2': 'Spec Gate', '3': 'Plan 작성',
    '4': 'Plan Gate', '5': '구현', '7': 'Eval Gate',
  };

  for (const key of REQUIRED_PHASE_KEYS) {
    const editable = !editablePhases || editablePhases.has(key);
    if (!editable) continue;
    const preset = getPresetById(phasePresets[key]);
    const label = preset?.label ?? 'unknown';
    console.error(`  [${key}] Phase ${key} (${phaseLabels[key]}):  ${label}`);
  }
  console.error(`      Phase 6 (검증):        harness-verify.sh (fixed)`);
  console.error('');
  console.error(`  Change? Phase 번호 입력 or Enter to confirm:`);
  console.error(separator());
}

export async function promptModelConfig(
  currentPresets: Record<string, string>,
  inputManager: InputManager,
  editablePhases?: string[],
  flow: FlowMode = 'full',
): Promise<Record<string, string>> {
  const presets = { ...currentPresets };
  const editable = editablePhases ? new Set(editablePhases) : new Set(REQUIRED_PHASE_KEYS as readonly string[]);
  const validPhaseKeys = new Set([...editable, '\r', '\n']);

  while (true) {
    renderModelSelection(presets, editable, flow);
    const key = await inputManager.waitForKey(validPhaseKeys);

    if (key === '\r' || key === '\n' || key === '') {
      return presets;
    }

    const phase = key;
    if (!editable.has(phase)) continue;

    const phaseLabels: Record<string, string> = {
      '1': flow === 'light' ? '설계+플랜' : 'Spec 작성',
      '2': 'Spec Gate', '3': 'Plan 작성',
      '4': 'Plan Gate', '5': '구현', '7': 'Eval Gate',
    };
    console.error('');
    console.error(`  Phase ${phase} (${phaseLabels[phase]}) — model:`);

    MODEL_PRESETS.forEach((p, i) => {
      const current = p.id === presets[phase] ? ` ${YELLOW}← current${RESET}` : '';
      console.error(`  [${i + 1}] ${p.label}${current}`);
    });
    console.error(`  Select (1-${MODEL_PRESETS.length}, Enter to cancel):`);

    const choice = (await inputManager.waitForLine()).trim();
    if (choice === '') continue;
    const idx = Number(choice) - 1;
    if (Number.isInteger(idx) && idx >= 0 && idx < MODEL_PRESETS.length) {
      presets[phase] = MODEL_PRESETS[idx].id;
    }
  }
}
