function tokenize(text: string): string[] {
  return Array.from(
    text.normalize('NFKC').toLowerCase().matchAll(/[\p{L}\p{N}_]+/gu),
    m => m[0],
  );
}

export function tokenJaccard(a: string, b: string): number | null {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (A.size === 0 || B.size === 0) return null;
  let inter = 0;
  for (const x of A) { if (B.has(x)) inter++; }
  const union = A.size + B.size - inter;
  if (union === 0) return null;
  return inter / union;
}

export class StagnationDetector {
  private buf: string[] = [];
  private readonly capacity: number;

  constructor(private readonly cfg: { threshold: number; run: number; window: number }) {
    this.capacity = cfg.run + (cfg.window - 1);
  }

  record(comments: string): void {
    this.buf.push(comments);
    if (this.buf.length > this.capacity) this.buf.shift();
  }

  shouldEscalate(): { triggered: boolean; similarities: number[] } {
    const { run, threshold } = this.cfg;
    if (this.buf.length < run + 1) return { triggered: false, similarities: [] };
    const similarities: number[] = [];
    for (let i = this.buf.length - run - 1; i < this.buf.length - 1; i++) {
      const sim = tokenJaccard(this.buf[i], this.buf[i + 1]);
      if (sim === null || sim < threshold) return { triggered: false, similarities: [] };
      similarities.push(sim);
    }
    return { triggered: true, similarities };
  }
}

const warnedKeys = new Set<string>();
let featureDisabledForProcess = false;

export function loadStagnationConfig(autoMode: boolean): {
  enabled: boolean; threshold: number; run: number; window: number;
} {
  const base = { threshold: 0.70, run: 2, window: 2 };

  if (featureDisabledForProcess) return { enabled: false, ...base };

  const envMain      = process.env['HARNESS_GATE_STAGNATION'];
  const envThreshold = process.env['HARNESS_GATE_STAGNATION_THRESHOLD'];
  const envRun       = process.env['HARNESS_GATE_STAGNATION_RUN'];
  // HARNESS_GATE_STAGNATION_WINDOW is reserved/no-op in v1 — intentionally not read

  let anyInvalid = false;
  let enabled   = autoMode;
  let threshold = base.threshold;
  let run       = base.run;

  if (envMain !== undefined) {
    const lower = envMain.toLowerCase();
    if (lower === 'on') {
      enabled = true;
    } else if (lower === 'off') {
      enabled = false;
    } else {
      if (!warnedKeys.has('HARNESS_GATE_STAGNATION')) {
        console.warn(`[stagnation] invalid HARNESS_GATE_STAGNATION="${envMain}" — feature disabled`);
        warnedKeys.add('HARNESS_GATE_STAGNATION');
      }
      anyInvalid = true;
    }
  }

  if (envThreshold !== undefined) {
    const parsed = parseFloat(envThreshold);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 1) {
      if (!warnedKeys.has('HARNESS_GATE_STAGNATION_THRESHOLD')) {
        console.warn(`[stagnation] invalid HARNESS_GATE_STAGNATION_THRESHOLD="${envThreshold}" — feature disabled`);
        warnedKeys.add('HARNESS_GATE_STAGNATION_THRESHOLD');
      }
      anyInvalid = true;
    } else {
      threshold = parsed;
    }
  }

  if (envRun !== undefined) {
    const parsed = parseInt(envRun, 10);
    if (Number.isNaN(parsed) || parsed < 2) {
      if (!warnedKeys.has('HARNESS_GATE_STAGNATION_RUN')) {
        console.warn(`[stagnation] invalid HARNESS_GATE_STAGNATION_RUN="${envRun}" — feature disabled`);
        warnedKeys.add('HARNESS_GATE_STAGNATION_RUN');
      }
      anyInvalid = true;
    } else {
      run = parsed;
    }
  }

  if (anyInvalid) {
    featureDisabledForProcess = true;
    return { enabled: false, ...base };
  }

  return { enabled, threshold, run, window: 2 };
}

// Test hook — resets warn dedup set and process-level disabled latch.
export function __resetWarnCache(): void {
  warnedKeys.clear();
  featureDisabledForProcess = false;
}
