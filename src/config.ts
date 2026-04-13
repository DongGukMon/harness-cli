export const PHASE_MODELS: Record<number, string> = {
  1: 'claude-opus-4-6',
  3: 'claude-sonnet-4-6',
  5: 'claude-sonnet-4-6',
};

export const PHASE_EFFORTS: Record<number, string> = {
  1: 'max',
  3: 'high',
  5: 'high',
};

export const GATE_TIMEOUT_MS = 120_000;
export const VERIFY_TIMEOUT_MS = 300_000;
export const SIGTERM_WAIT_MS = 5_000;
export const GROUP_DRAIN_WAIT_MS = 5_000;

export const GATE_RETRY_LIMIT = 3;
export const VERIFY_RETRY_LIMIT = 3;

export const MAX_FILE_SIZE_KB = 200;
export const MAX_DIFF_SIZE_KB = 50;
export const MAX_PROMPT_SIZE_KB = 500;
export const PER_FILE_DIFF_LIMIT_KB = 20;

export const TERMINAL_PHASE = 8;

export const INTERACTIVE_PHASES = [1, 3, 5] as const;
export const GATE_PHASES = [2, 4, 7] as const;

export const PHASE_ARTIFACT_FILES: Record<number, string[]> = {
  1: ['spec', 'decisionLog'],
  3: ['plan', 'checklist'],
};
