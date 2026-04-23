import type { HarnessState, RenderCallsite } from '../types.js';
import type { FooterSummary } from '../metrics/footer-aggregator.js';

export interface StoreSnapshot {
  state: HarnessState;
  callsite: RenderCallsite | undefined;
  footerSummary: FooterSummary | null;
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
