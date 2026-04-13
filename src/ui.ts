import { PHASE_MODELS } from './config.js';

// ANSI color codes
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

const SEPARATOR = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

/**
 * Prompt user with single-key choices. Returns the selected key (uppercase).
 * Shows message + choices, waits for valid keypress.
 * choices example: [{ key: 'R', label: 'Retry' }, { key: 'S', label: 'Skip' }, { key: 'Q', label: 'Quit' }]
 */
export function promptChoice(
  message: string,
  choices: { key: string; label: string }[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('stdin is not a TTY — cannot prompt for input'));
      return;
    }

    const choiceText = choices.map((c) => `[${c.key.toUpperCase()}] ${c.label}`).join('  ');
    process.stderr.write(`\n${message}\n${choiceText}\n`);

    const validKeys = new Set(choices.map((c) => c.key.toLowerCase()));

    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onData = (buf: Buffer) => {
      const key = buf.toString().toLowerCase();

      // Handle Ctrl+C / Ctrl+D
      if (key === '\x03' || key === '\x04') {
        process.stdin.removeListener('data', onData);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stderr.write('\n');
        process.exit(1);
      }

      if (validKeys.has(key)) {
        process.stdin.removeListener('data', onData);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stderr.write('\n');
        resolve(key.toUpperCase());
      }
      // Invalid key — ignore and keep waiting
    };

    process.stdin.on('data', onData);
  });
}

/**
 * Print phase transition banner.
 * Example:
 *   ✓ Phase 2 완료 (Spec Gate — APPROVED)
 *   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   ▶ Phase 3 시작: Plan 작성
 *     모델: claude-sonnet-4-6
 *   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
export function printPhaseTransition(
  fromPhase: number,
  toPhase: number,
  fromStatus: string,
  toLabel: string,
): void {
  console.error(`${GREEN}✓${RESET} Phase ${fromPhase} 완료 (${fromStatus})`);
  console.error(SEPARATOR);
  console.error(`${GREEN}▶${RESET} Phase ${toPhase} 시작: ${toLabel}`);
  const model = PHASE_MODELS[toPhase];
  if (model) {
    console.error(`  모델: ${model}`);
  }
  console.error(SEPARATOR);
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

export function printAdvisorReminder(phase: number): void {
  const YELLOW = '\x1b[33m';
  const RESET = '\x1b[0m';
  const purpose = ADVISOR_PURPOSE[phase] ?? 'advisor 설정을 확인하세요.';

  console.error('');
  console.error(`${YELLOW}⚠️  Advisor Reminder (Phase ${phase})${RESET}`);
  console.error(`${YELLOW}   ${purpose}${RESET}`);
  console.error(`${YELLOW}   Claude 세션이 시작된 뒤 다음을 입력하세요:${RESET}`);
  console.error(`${YELLOW}     /advisor${RESET}`);
  console.error(`${YELLOW}   (정확한 slash command 문법은 Claude Code 버전에 따라 다를 수 있습니다.)${RESET}`);
  console.error('');
}
