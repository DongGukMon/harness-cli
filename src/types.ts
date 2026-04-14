export type PhaseNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type InteractivePhase = 1 | 3 | 5;
export type GatePhase = 2 | 4 | 7;
export type PhaseStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'error';
export type RunStatus = 'in_progress' | 'completed' | 'paused';
export type PauseReason = 'gate-escalation' | 'verify-escalation' | 'gate-error' | 'verify-error';
export type PendingActionType = 'reopen_phase' | 'rerun_gate' | 'rerun_verify' | 'show_escalation' | 'show_verify_error' | 'skip_phase';

export interface PendingAction {
  type: PendingActionType;
  targetPhase: PhaseNumber;
  sourcePhase: PhaseNumber | null;
  feedbackPaths: string[];
}

export interface Artifacts {
  spec: string;
  plan: string;
  decisionLog: string;
  checklist: string;
  evalReport: string;
}

export interface HarnessState {
  runId: string;
  currentPhase: number; // 1-7 or 8 (terminal sentinel)
  status: RunStatus;
  autoMode: boolean;
  task: string;
  baseCommit: string;
  implRetryBase: string;
  codexPath: string;
  externalCommitsDetected: boolean;
  artifacts: Artifacts;
  phases: Record<string, PhaseStatus>; // keys "1"-"7"
  gateRetries: Record<string, number>; // keys "2","4","7"
  verifyRetries: number;
  pauseReason: PauseReason | null;
  specCommit: string | null;
  planCommit: string | null;
  implCommit: string | null;
  evalCommit: string | null;
  verifiedAtHead: string | null;
  pausedAtHead: string | null;
  pendingAction: PendingAction | null;
  phaseOpenedAt: Record<string, number | null>; // keys "1","3","5" — epoch ms
  phaseAttemptId: Record<string, string | null>; // keys "1","3","5" — UUID v4
  tmuxSession: string;
  tmuxMode: 'dedicated' | 'reused';
  tmuxWindows: string[];
  tmuxControlWindow: string;
  tmuxOriginalWindow?: string;
}

export interface LockData {
  cliPid: number;
  childPid: number | null;
  childPhase: number | null;
  runId: string;
  startedAt: number | null; // epoch seconds
  childStartedAt: number | null; // epoch seconds
  handoff?: boolean;
  outerPid?: number;
  tmuxSession?: string;
}

export interface GateResult {
  exitCode: number;
  timestamp: number;
}

export interface VerifyResult {
  exitCode: number;
  hasSummary: boolean;
  timestamp: number;
}

export type GateVerdict = 'APPROVE' | 'REJECT';

export interface GateOutcome {
  type: 'verdict';
  verdict: GateVerdict;
  comments: string;
  rawOutput: string;
}

export interface GateError {
  type: 'error';
  error: string;
  rawOutput?: string;
}

export type GatePhaseResult = GateOutcome | GateError;

export type VerifyOutcome =
  | { type: 'pass' }
  | { type: 'fail'; feedbackPath: string }
  | { type: 'error'; errorPath?: string };

export type PreflightItem = 'git' | 'head' | 'node' | 'claude' | 'claudeAtFile' | 'verifyScript' | 'jq' | 'codexPath' | 'platform' | 'tty' | 'tmux';

export type PhaseType = 'interactive' | 'gate' | 'verify' | 'terminal' | 'ui_only';
