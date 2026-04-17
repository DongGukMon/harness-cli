import { createHash } from 'crypto';
import type { SessionLogger, LogEvent, SessionMeta, HarnessState, DistributiveOmit } from './types.js';

export function computeRepoKey(harnessDir: string): string {
  return createHash('sha1').update(harnessDir).digest('hex').slice(0, 12);
}

export class NoopLogger implements SessionLogger {
  logEvent(_event: DistributiveOmit<LogEvent, 'v' | 'ts' | 'runId'>): void { /* no-op */ }
  writeMeta(_partial: Partial<SessionMeta> & { task: string }): void { /* no-op */ }
  updateMeta(_update: { pushResumedAt?: number; task?: string }): void { /* no-op */ }
  finalizeSummary(_state: HarnessState): void { /* no-op */ }
  close(): void { /* no-op */ }
  hasBootstrapped(): boolean { return true; }
  hasEmittedSessionOpen(): boolean { return true; }
  getStartedAt(): number { return Date.now(); }
}
