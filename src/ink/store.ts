import type { HarnessState, RenderCallsite } from '../types.js';
import type { FooterSummary } from '../metrics/footer-aggregator.js';

/**
 * Liveness of the workspace-pane worker (Claude/Codex TUI + any child like
 * `codex-companion task`). Set by `enterFailedTerminalState` when entering
 * the terminal-failed state so the operator can tell at a glance whether
 * pressing `[R]` will kill an in-progress worker (#116 B1).
 *
 * Undefined = not applicable (phase is not in a terminal-failed UI render).
 */
export type WorkerLiveness = 'alive' | 'dead';

export interface StoreSnapshot {
  state: HarnessState;
  callsite: RenderCallsite | undefined;
  footerSummary: FooterSummary | null;
  workerLiveness?: WorkerLiveness;
}

type Listener = (snap: StoreSnapshot) => void;

let current: StoreSnapshot | null = null;
const listeners = new Set<Listener>();

export function dispatch(update: Omit<StoreSnapshot, 'footerSummary'>): void {
  current = { ...update, footerSummary: current?.footerSummary ?? null };
  listeners.forEach(l => l(current!));
}

export function dispatchFooter(summary: FooterSummary): void {
  if (current === null) return;
  current = { ...current, footerSummary: summary };
  listeners.forEach(l => l(current!));
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function getSnapshot(): StoreSnapshot | null {
  return current;
}
