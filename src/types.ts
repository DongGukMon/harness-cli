export type PhaseNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type InteractivePhase = 1 | 3 | 5;
export type GatePhase = 2 | 4 | 7;
export type PhaseStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'error' | 'skipped';
export type FlowMode = 'full' | 'light';

export interface CarryoverFeedback {
  sourceGate: 7;
  paths: string[];
  deliverToPhase: 5;
}
export type RunStatus = 'in_progress' | 'completed' | 'paused';
export type PauseReason = 'gate-escalation' | 'verify-escalation' | 'gate-error' | 'verify-error' | 'config-cancel';
export type PendingActionType = 'reopen_phase' | 'rerun_gate' | 'rerun_verify' | 'show_escalation' | 'show_verify_error' | 'skip_phase' | 'reopen_config';

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

export interface GateSessionInfo {
  sessionId: string;
  runner: 'claude' | 'codex';
  model: string;
  effort: string;
  lastOutcome: 'approve' | 'reject' | 'error';
}

export interface HarnessState {
  runId: string;
  flow: FlowMode;
  carryoverFeedback: CarryoverFeedback | null;
  currentPhase: number; // 1-7 or 8 (terminal sentinel)
  status: RunStatus;
  autoMode: boolean;
  task: string;
  baseCommit: string;
  implRetryBase: string;
  codexPath: string | null;
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
  phasePresets: Record<string, string>;         // keys "1"-"7" (excl 6), values = preset ID
  phaseReopenFlags: Record<string, boolean>;    // keys "1","3","5"
  // Per-phase Codex session resume (§4.1 of spec)
  phaseCodexSessions: Record<'2' | '4' | '7', GateSessionInfo | null>;
  lastWorkspacePid: number | null;
  lastWorkspacePidStartTime: number | null;
  tmuxSession: string;
  tmuxMode: 'dedicated' | 'reused';
  tmuxWindows: string[];
  tmuxControlWindow: string;
  tmuxOriginalWindow?: string;
  tmuxWorkspacePane: string;
  tmuxControlPane: string;
  // --- Session logging (opt-in) ---
  loggingEnabled: boolean;
  // Tracks which phase triggered a reopen (for phase_start.reopenFromGate)
  // keys "1","3","5" → number (triggering phase 2/4/6/7) or null
  phaseReopenSource: Record<string, number | null>;
  // BUG-C root-cause fix (Issue #13): when true, codex subprocesses run with
  // the user's inherited CODEX_HOME (no isolation). Default false — every
  // codex-phase spawn runs inside <runDir>/codex-home/ with only auth.json
  // symlinked in. Persisted so that `harness resume` honors the decision.
  codexNoIsolate: boolean;
  // Phase 5 dirty-tree auto-recovery opt-out. When true, `validatePhaseArtifacts`
  // skips `tryAutoRecoverDirtyTree` and fails immediately on non-empty porcelain.
  // Persisted so that `harness resume` honors the original `--strict-tree` choice.
  strictTree: boolean;
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
  // Session logging metadata (v1: optional for backward compat)
  runner?: 'claude' | 'codex';
  promptBytes?: number;
  durationMs?: number;
  tokensTotal?: number;
  codexSessionId?: string;
  // Preset lineage at write time — used by sidecar replay compatibility gate (§4.7)
  sourcePreset?: { model: string; effort: string };
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
  // Session logging metadata
  runner?: 'claude' | 'codex';
  promptBytes?: number;
  durationMs?: number;
  tokensTotal?: number;
  codexSessionId?: string;
  recoveredFromSidecar?: boolean;
  // Preset lineage at write time (§4.7 replay hydration)
  sourcePreset?: { model: string; effort: string };
  // Session resume metadata (§4.6)
  resumedFrom?: string | null;
  resumeFallback?: boolean;
}

export interface GateError {
  type: 'error';
  error: string;
  rawOutput?: string;
  // Session logging metadata
  runner?: 'claude' | 'codex';
  promptBytes?: number;
  durationMs?: number;
  exitCode?: number;
  tokensTotal?: number;
  codexSessionId?: string;
  recoveredFromSidecar?: boolean;
  // Preset lineage at write time (§4.7 replay hydration)
  sourcePreset?: { model: string; effort: string };
  // Session resume metadata (§4.6)
  resumedFrom?: string | null;
  resumeFallback?: boolean;
}

export type GatePhaseResult = GateOutcome | GateError;

export type VerifyOutcome =
  | { type: 'pass' }
  | { type: 'fail'; feedbackPath: string }
  | { type: 'error'; errorPath?: string };

export type PreflightItem = 'git' | 'head' | 'node' | 'claude' | 'claudeAtFile' | 'verifyScript' | 'jq' | 'codexPath' | 'platform' | 'tty' | 'tmux' | 'codexCli';

export type PhaseType = 'interactive' | 'gate' | 'verify' | 'terminal' | 'ui_only';

// --- Claude interactive token usage (phase_end.claudeTokens) ---

export interface ClaudeTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
  total: number;
}

// --- Session Logging Events ---

// Distributive Omit: applies Omit to each member of a union separately,
// preserving discriminated-union specificity (needed for LogEvent variants).
export type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;

export interface LogEventBase {
  v: number;
  ts: number;
  runId: string;
  phase?: number;
  attemptId?: string | null;
}

export type LogEvent =
  | (LogEventBase & { event: 'session_start'; task: string; autoMode: boolean; baseCommit: string; harnessVersion: string })
  | (LogEventBase & { event: 'session_resumed'; fromPhase: number; stateStatus: RunStatus })
  | (LogEventBase & {
      event: 'phase_start';
      phase: number;
      attemptId?: string | null;
      reopenFromGate?: number | null;
      retryIndex?: number;
      preset?: { id: string; runner: 'claude' | 'codex'; model: string; effort: string };
    })
  | (LogEventBase & {
      event: 'gate_verdict';
      phase: number;
      retryIndex: number;
      runner: 'claude' | 'codex';
      verdict: GateVerdict;
      durationMs?: number;
      tokensTotal?: number;
      promptBytes?: number;
      codexSessionId?: string;
      recoveredFromSidecar?: boolean;
      resumedFrom?: string | null;
      resumeFallback?: boolean;
      preset?: { id: string; runner: 'claude' | 'codex'; model: string; effort: string };
    })
  | (LogEventBase & {
      event: 'gate_error';
      phase: number;
      retryIndex: number;
      runner?: 'claude' | 'codex';
      error: string;
      exitCode?: number;
      durationMs?: number;
      tokensTotal?: number;
      codexSessionId?: string;
      recoveredFromSidecar?: boolean;
      resumedFrom?: string | null;
      resumeFallback?: boolean;
      preset?: { id: string; runner: 'claude' | 'codex'; model: string; effort: string };
    })
  | (LogEventBase & { event: 'gate_retry'; phase: number; retryIndex: number; retryCount: number; retryLimit: number; feedbackPath: string; feedbackBytes: number; feedbackPreview: string })
  | (LogEventBase & { event: 'escalation'; phase: number; reason: 'gate-retry-limit' | 'gate-error' | 'verify-limit' | 'verify-error'; userChoice?: 'C' | 'S' | 'Q' | 'R' })
  | (LogEventBase & { event: 'force_pass'; phase: number; by: 'auto' | 'user' })
  | (LogEventBase & { event: 'verify_result'; passed: boolean; retryIndex: number; durationMs: number; failedChecks?: string[] })
  | (LogEventBase & { event: 'phase_end'; phase: number; attemptId?: string | null; status: 'completed' | 'failed'; durationMs: number; details?: { reason: string }; claudeTokens?: ClaudeTokens | null })
  | (LogEventBase & { event: 'state_anomaly'; kind: string; details: Record<string, unknown> })
  | (LogEventBase & { event: 'session_end'; status: 'completed' | 'paused' | 'interrupted'; totalWallMs: number });

export interface SessionMeta {
  v: number;
  runId: string;
  repoKey: string;
  harnessDir: string;
  cwd: string;
  gitBranch?: string;
  task: string;
  startedAt: number;
  autoMode: boolean;
  harnessVersion: string;
  resumedAt: number[];
  bootstrapOnResume?: boolean;
  codexHome?: string;
}

export interface SessionLogger {
  logEvent(event: DistributiveOmit<LogEvent, 'v' | 'ts' | 'runId'>): void;
  writeMeta(partial: Partial<SessionMeta> & { task: string }): void;
  updateMeta(update: { pushResumedAt?: number; task?: string; codexHome?: string }): void;
  finalizeSummary(state: HarnessState): void;
  close(): void;
  hasBootstrapped(): boolean;
  hasEmittedSessionOpen(): boolean;
  getStartedAt(): number;
}
