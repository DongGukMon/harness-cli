import fs from 'fs';

export interface RetrospectiveStats {
  runId: string;
  harnessVersion: string | null;
  status: 'completed' | 'failed' | 'paused' | 'interrupted' | 'unknown';
  autoMode: boolean;
  startedAt: number;
  endedAt: number;
  totalWallMs: number;
  eventCount: number;
  malformedLineCount: number;
  phases: Array<{
    phase: number;
    attempts: number;
    durationMs: number;
    claudeTokens: number;
    codexTokens: number;
    finalStatus: 'completed' | 'failed' | 'unknown';
  }>;
  gates: Array<{
    phase: number;
    retryCount: number;
    rejectCount: number;
    codexTokens: number;
    ambiguityTrend: number[];
    stagnationTriggered: boolean;
    forcePass: { triggered: boolean; by?: 'auto' | 'user' };
  }>;
  escalations: Array<{ phase: number; reason: string; userChoice?: 'C' | 'S' | 'Q' | 'R' }>;
  verify: { passCount: number; failCount: number; lastFailedChecks: string[] };
  spike: { topPhases: Array<{ phase: number; tokens: number }>; flagged: boolean; ratio: number };
  totals: { claudeTokens: number; codexTokens: number };
}

export function generateRetrospective(_eventsPath: string): { markdown: string; stats: RetrospectiveStats } {
  throw new Error('not implemented');
}
