import type { GateRejectEntry } from '../types.js';

const DEFAULT_THRESHOLD = 4;
const MIN_THRESHOLD = 2;

let warnedOnce = false;

export function findStubbornIds(
  history: GateRejectEntry[],
  threshold: number = DEFAULT_THRESHOLD,
): string[] {
  const t = Math.max(MIN_THRESHOLD, Math.floor(threshold));
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  let order = 0;
  for (const entry of history) {
    const unique = new Set(entry.requirementIds);
    for (const id of unique) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
      if (!firstSeen.has(id)) firstSeen.set(id, order++);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= t)
    .sort(([a], [b]) => (firstSeen.get(a)! - firstSeen.get(b)!))
    .map(([id]) => id);
}

export function loadStubbornIdThreshold(): number {
  const raw = process.env['HARNESS_STUBBORN_ID_THRESHOLD'];
  if (raw === undefined) return DEFAULT_THRESHOLD;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < MIN_THRESHOLD) {
    if (!warnedOnce) {
      console.warn(
        `[stubborn-id] invalid HARNESS_STUBBORN_ID_THRESHOLD="${raw}" — using default ${DEFAULT_THRESHOLD}`,
      );
      warnedOnce = true;
    }
    return DEFAULT_THRESHOLD;
  }
  return n;
}

// Test hook
export function __resetThresholdWarn(): void {
  warnedOnce = false;
}
