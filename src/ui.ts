import { MODEL_PRESETS, REQUIRED_PHASE_KEYS, getPresetById } from './config.js';
export { formatFooter } from './metrics/footer-aggregator.js';
import type { HarnessState, FlowMode, SessionLogger, RenderCallsite } from './types.js';
import type { InputManager } from './input.js';
import { renderInkControlPanel, mounted } from './ink/render.js';

// ANSI color codes
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

function suppressedDuringMount(fn: string): boolean {
  if (mounted) {
    process.stderr.write(`[ui] suppressed ${fn} during Ink mount\n`);
    return true;
  }
  return false;
}

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
  renderInkControlPanel(state, logger, callsite);
}

export function writeFooterToPane(line: string, rows: number, columns: number): void {
  if (mounted) return; // Ink Footer component handles display
  void columns;
  if (line.length === 0) {
    return;
  }

  process.stderr.write(`\x1b[s\x1b[${rows};1H\x1b[2K${line}\x1b[u`);
}

export function clearFooterRow(rows: number): void {
  if (mounted) return; // Ink Footer component handles display
  process.stderr.write(`\x1b[s\x1b[${rows};1H\x1b[2K\x1b[u`);
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
  if (suppressedDuringMount('printPhaseTransition')) return;
  console.error(`${GREEN}✓${RESET} Phase ${fromPhase} 완료 (${fromStatus})`);
  console.error(separator());
  console.error(`${GREEN}▶${RESET} Phase ${toPhase} 시작: ${toLabel}`);
  console.error(separator());
}

/**
 * Print warning (yellow ⚠ prefix).
 */
export function printWarning(msg: string): void {
  if (suppressedDuringMount('printWarning')) return;
  console.error(`${YELLOW}⚠️  ${msg}${RESET}`);
}

/**
 * Print error (red ✗ prefix).
 */
export function printError(msg: string): void {
  if (suppressedDuringMount('printError')) return;
  console.error(`${RED}✗ ${msg}${RESET}`);
}

/**
 * Print success (green ✓ prefix).
 */
export function printSuccess(msg: string): void {
  if (suppressedDuringMount('printSuccess')) return;
  console.error(`${GREEN}✓ ${msg}${RESET}`);
}

/**
 * Print info line.
 */
export function printInfo(msg: string): void {
  if (suppressedDuringMount('printInfo')) return;
  console.error(`${BLUE}ℹ ${msg}${RESET}`);
}

export function renderWelcome(runId: string): void {
  if (suppressedDuringMount('renderWelcome')) return;
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
  if (suppressedDuringMount('renderModelSelection')) return;
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
  if (suppressedDuringMount('promptModelConfig')) return currentPresets;
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
