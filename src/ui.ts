import { MODEL_PRESETS, REQUIRED_PHASE_KEYS, getPresetById } from './config.js';
import type { HarnessState } from './types.js';
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

function phaseLabel(phase: number): string {
  const labels: Record<number, string> = {
    1: 'Spec 작성',
    2: 'Spec Gate',
    3: 'Plan 작성',
    4: 'Plan Gate',
    5: '구현',
    6: '검증',
    7: 'Eval Gate',
  };
  return labels[phase] ?? `Phase ${phase}`;
}

export function renderControlPanel(state: HarnessState): void {
  process.stdout.write('\x1b[2J\x1b[H'); // clear screen
  console.error(separator());
  console.error(`${GREEN}▶${RESET} Harness Control Panel`);
  console.error(separator());
  console.error(`  Run:   ${state.runId}`);
  console.error(`  Phase: ${state.currentPhase}/7 — ${phaseLabel(state.currentPhase)}`);
  const preset = getPresetById(state.phasePresets?.[String(state.currentPhase)] ?? '');
  if (preset) console.error(`  Model: ${preset.label}`);
  console.error('');

  for (let p = 1; p <= 7; p++) {
    const status = state.phases[String(p)] ?? 'pending';
    const icon = status === 'completed' ? `${GREEN}✓${RESET}`
      : status === 'in_progress' ? `${YELLOW}▶${RESET}`
      : status === 'failed' || status === 'error' ? `${RED}✗${RESET}`
      : ' ';
    const current = p === state.currentPhase ? ' ← current' : '';
    console.error(`  [${icon}] Phase ${p}: ${phaseLabel(p)} (${status})${current}`);
  }
  console.error('');
  console.error(separator());
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

const ADVISOR_PURPOSE: Record<number, string> = {
  1: 'Brainstorming에서 advisor가 설계 트레이드오프 자문에 유용합니다.',
  3: 'Plan 작성에서 advisor가 태스크 분해 판단에 유용합니다.',
  5: '구현에서 advisor가 복잡 로직 판단에 유용합니다.',
};

export function printAdvisorReminder(phase: number, runner?: string): void {
  if (runner === 'codex') return;
  const purpose = ADVISOR_PURPOSE[phase] ?? 'advisor 설정을 확인하세요.';

  console.error('');
  console.error(`${YELLOW}⚠️  Advisor Reminder (Phase ${phase})${RESET}`);
  console.error(`${YELLOW}   ${purpose}${RESET}`);
  console.error(`${YELLOW}   Claude 세션이 시작된 뒤 다음을 입력하세요:${RESET}`);
  console.error(`${YELLOW}     /advisor${RESET}`);
  console.error(`${YELLOW}   (정확한 slash command 문법은 Claude Code 버전에 따라 다를 수 있습니다.)${RESET}`);
  console.error('');
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
): void {
  process.stdout.write('\x1b[2J\x1b[H');
  console.error(separator());
  console.error(`${GREEN}▶${RESET} Model Configuration`);
  console.error(separator());

  const phaseLabels: Record<string, string> = {
    '1': 'Spec 작성', '2': 'Spec Gate', '3': 'Plan 작성',
    '4': 'Plan Gate', '5': '구현', '7': 'Eval Gate',
  };

  for (const key of REQUIRED_PHASE_KEYS) {
    const preset = getPresetById(phasePresets[key]);
    const label = preset?.label ?? 'unknown';
    const editable = !editablePhases || editablePhases.has(key);
    const prefix = editable ? `[${key}]` : `   `;
    console.error(`  ${prefix} Phase ${key} (${phaseLabels[key]}):  ${label}`);
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
): Promise<Record<string, string>> {
  const presets = { ...currentPresets };
  const editable = editablePhases ? new Set(editablePhases) : new Set(REQUIRED_PHASE_KEYS as readonly string[]);
  const validPhaseKeys = new Set([...editable, '\r', '\n']);

  while (true) {
    renderModelSelection(presets, editable);
    const key = await inputManager.waitForKey(validPhaseKeys);

    if (key === '\r' || key === '\n' || key === '') {
      return presets;
    }

    const phase = key;
    if (!editable.has(phase)) continue;

    const phaseLabels: Record<string, string> = {
      '1': 'Spec 작성', '2': 'Spec Gate', '3': 'Plan 작성',
      '4': 'Plan Gate', '5': '구현', '7': 'Eval Gate',
    };
    console.error('');
    console.error(`  Phase ${phase} (${phaseLabels[phase]}) — model:`);

    const presetKeys = new Set<string>();
    MODEL_PRESETS.forEach((p, i) => {
      const current = p.id === presets[phase] ? ` ${YELLOW}← current${RESET}` : '';
      console.error(`  [${i + 1}] ${p.label}${current}`);
      presetKeys.add(String(i + 1));
    });
    console.error(`  Select (1-${MODEL_PRESETS.length}):`);

    const choice = await inputManager.waitForKey(presetKeys);
    const idx = Number(choice) - 1;
    if (idx >= 0 && idx < MODEL_PRESETS.length) {
      presets[phase] = MODEL_PRESETS[idx].id;
    }
  }
}
