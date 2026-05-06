import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tokenJaccard, StagnationDetector, loadStagnationConfig, __resetWarnCache } from '../../src/phases/stagnation.js';

beforeEach(() => {
  __resetWarnCache();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetWarnCache();
});

// ─── tokenJaccard ────────────────────────────────────────────────────────────

describe('tokenJaccard', () => {
  it('identical strings return 1', () => {
    expect(tokenJaccard('the quick brown fox', 'the quick brown fox')).toBe(1);
  });

  it('disjoint strings return 0', () => {
    expect(tokenJaccard('alpha beta', 'gamma delta')).toBe(0);
  });

  it('one-side empty returns null', () => {
    expect(tokenJaccard('', 'hello world')).toBeNull();
    expect(tokenJaccard('hello world', '')).toBeNull();
  });

  it('both empty returns null', () => {
    expect(tokenJaccard('', '')).toBeNull();
  });

  it('NFKC normalisation: ½ tokenises the same as 1 2', () => {
    // '½' normalises to '1/2' under NFKC → tokens ['1', '2']
    const sim = tokenJaccard('½ cup', '1 2 cup');
    expect(sim).not.toBeNull();
    expect(sim!).toBeGreaterThan(0.5);
  });

  it('case insensitive', () => {
    expect(tokenJaccard('Hello World', 'hello world')).toBe(1);
  });

  it('mixed Korean and English', () => {
    const sim = tokenJaccard('플랜이 누락됨 plan missing', '플랜이 누락됨 plan missing');
    expect(sim).toBe(1);
  });

  it('partial overlap returns value in (0, 1)', () => {
    const sim = tokenJaccard('plan is missing tests', 'plan needs tests and docs');
    expect(sim).not.toBeNull();
    expect(sim!).toBeGreaterThan(0);
    expect(sim!).toBeLessThan(1);
  });

  it('very long strings produce a finite result (length-stable)', () => {
    const long = 'word '.repeat(10_000).trim();
    const sim = tokenJaccard(long, long);
    expect(sim).toBe(1);
  });
});

// ─── StagnationDetector.record ────────────────────────────────────────────────

describe('StagnationDetector.record — FIFO buffer', () => {
  it('drops oldest entry when buffer exceeds RUN + WINDOW - 1 = 3', () => {
    const d = new StagnationDetector({ threshold: 0.70, run: 2, window: 2 });
    // push 4 items — capacity is 3
    d.record('a');
    d.record('b');
    d.record('c');
    d.record('d'); // 'a' should be evicted

    // Only last 3 entries matter; verify by checking shouldEscalate doesn't see 'a'
    // (if 'a' were still in buffer, we'd have 4 entries, but capacity is 3)
    // We check indirectly: 'a','b','c' → diverse; 'b','c','d' → b/c differ from d
    const { triggered } = d.shouldEscalate();
    // 'b' vs 'c' and 'c' vs 'd' — all distinct — should not trigger
    expect(triggered).toBe(false);
  });

  it('accepts RUN=3 and capacity is RUN + WINDOW - 1 = 4', () => {
    const d = new StagnationDetector({ threshold: 0.70, run: 3, window: 2 });
    const same = 'plan is missing tests and docs and coverage';
    d.record(same);
    d.record(same);
    d.record(same);
    d.record(same); // 4 entries, 3 adjacent pairs all sim=1.0
    const { triggered, similarities } = d.shouldEscalate();
    expect(triggered).toBe(true);
    expect(similarities).toHaveLength(3);
  });
});

// ─── StagnationDetector.shouldEscalate ────────────────────────────────────────

describe('StagnationDetector.shouldEscalate', () => {
  const SAME = 'plan does not cover spec requirements; tests are missing; docs incomplete';
  const DIFF = 'implementation looks correct but formatting needs work';

  it('buffer < RUN+1 entries → triggered false', () => {
    const d = new StagnationDetector({ threshold: 0.70, run: 2, window: 2 });
    d.record(SAME); // 1 entry, need ≥3
    d.record(SAME); // 2 entries, need ≥3
    expect(d.shouldEscalate().triggered).toBe(false);
  });

  it('last RUN pairs all ≥ threshold → triggered true', () => {
    const d = new StagnationDetector({ threshold: 0.70, run: 2, window: 2 });
    d.record(SAME);
    d.record(SAME);
    d.record(SAME);
    const { triggered, similarities } = d.shouldEscalate();
    expect(triggered).toBe(true);
    expect(similarities).toHaveLength(2);
    similarities.forEach(s => expect(s).toBeGreaterThanOrEqual(0.70));
  });

  it('one pair below threshold → triggered false', () => {
    const d = new StagnationDetector({ threshold: 0.70, run: 2, window: 2 });
    d.record(SAME);
    d.record(DIFF); // this pair will be < threshold
    d.record(SAME);
    expect(d.shouldEscalate().triggered).toBe(false);
  });

  it('pair where one side tokenizes to empty → triggered false (null similarity)', () => {
    const d = new StagnationDetector({ threshold: 0.70, run: 2, window: 2 });
    d.record(SAME);
    d.record(''); // empty → null similarity
    d.record(SAME);
    expect(d.shouldEscalate().triggered).toBe(false);
  });

  it('threshold 0 → always triggers when buffer is full', () => {
    const d = new StagnationDetector({ threshold: 0, run: 2, window: 2 });
    d.record('alpha');
    d.record('beta');
    d.record('gamma'); // all disjoint but sim ≥ 0
    const { triggered } = d.shouldEscalate();
    expect(triggered).toBe(true);
  });
});

// ─── loadStagnationConfig ─────────────────────────────────────────────────────

describe('loadStagnationConfig', () => {
  it('manual mode default: enabled=false', () => {
    const cfg = loadStagnationConfig(false);
    expect(cfg.enabled).toBe(false);
    expect(cfg.threshold).toBe(0.70);
    expect(cfg.run).toBe(2);
    expect(cfg.window).toBe(2);
  });

  it('auto mode default: enabled=true', () => {
    const cfg = loadStagnationConfig(true);
    expect(cfg.enabled).toBe(true);
    expect(cfg.threshold).toBe(0.70);
    expect(cfg.run).toBe(2);
    expect(cfg.window).toBe(2);
  });

  it('HARNESS_GATE_STAGNATION=off overrides auto-mode default', () => {
    vi.stubEnv('HARNESS_GATE_STAGNATION', 'off');
    expect(loadStagnationConfig(true).enabled).toBe(false);
  });

  it('HARNESS_GATE_STAGNATION=on overrides manual-mode default', () => {
    vi.stubEnv('HARNESS_GATE_STAGNATION', 'on');
    expect(loadStagnationConfig(false).enabled).toBe(true);
  });

  it('HARNESS_GATE_STAGNATION=ON (uppercase) is accepted', () => {
    vi.stubEnv('HARNESS_GATE_STAGNATION', 'ON');
    expect(loadStagnationConfig(true).enabled).toBe(true);
  });

  it('invalid HARNESS_GATE_STAGNATION → enabled=false + exactly one warn', () => {
    vi.stubEnv('HARNESS_GATE_STAGNATION', 'maybe');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    loadStagnationConfig(true);
    loadStagnationConfig(true); // second call — warn must NOT fire again
    const stagnationWarns = warnSpy.mock.calls.filter(args => String(args[0]).includes('HARNESS_GATE_STAGNATION'));
    expect(stagnationWarns).toHaveLength(1);
    expect(loadStagnationConfig(true).enabled).toBe(false);
  });

  it('valid HARNESS_GATE_STAGNATION_THRESHOLD is parsed', () => {
    vi.stubEnv('HARNESS_GATE_STAGNATION_THRESHOLD', '0.85');
    const cfg = loadStagnationConfig(true);
    expect(cfg.threshold).toBe(0.85);
    expect(cfg.enabled).toBe(true);
  });

  it('invalid HARNESS_GATE_STAGNATION_THRESHOLD → enabled=false + one warn for that key', () => {
    vi.stubEnv('HARNESS_GATE_STAGNATION_THRESHOLD', 'not-a-number');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    loadStagnationConfig(true);
    loadStagnationConfig(true);
    const warns = warnSpy.mock.calls.filter(args => String(args[0]).includes('HARNESS_GATE_STAGNATION_THRESHOLD'));
    expect(warns).toHaveLength(1);
  });

  it('HARNESS_GATE_STAGNATION_THRESHOLD out of [0,1] range → enabled=false', () => {
    vi.stubEnv('HARNESS_GATE_STAGNATION_THRESHOLD', '1.5');
    expect(loadStagnationConfig(true).enabled).toBe(false);
    __resetWarnCache();
    vi.stubEnv('HARNESS_GATE_STAGNATION_THRESHOLD', '-0.1');
    expect(loadStagnationConfig(true).enabled).toBe(false);
  });

  it('valid HARNESS_GATE_STAGNATION_RUN is parsed', () => {
    vi.stubEnv('HARNESS_GATE_STAGNATION_RUN', '3');
    const cfg = loadStagnationConfig(true);
    expect(cfg.run).toBe(3);
    expect(cfg.enabled).toBe(true);
  });

  it('invalid HARNESS_GATE_STAGNATION_RUN → enabled=false + one warn', () => {
    vi.stubEnv('HARNESS_GATE_STAGNATION_RUN', 'bad');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    loadStagnationConfig(true);
    loadStagnationConfig(true);
    const warns = warnSpy.mock.calls.filter(args => String(args[0]).includes('HARNESS_GATE_STAGNATION_RUN'));
    expect(warns).toHaveLength(1);
  });

  it('HARNESS_GATE_STAGNATION_RUN < 2 → enabled=false', () => {
    vi.stubEnv('HARNESS_GATE_STAGNATION_RUN', '1');
    expect(loadStagnationConfig(true).enabled).toBe(false);
  });

  it('HARNESS_GATE_STAGNATION_WINDOW set to any value → window=2, no warn, enabled unaffected', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const val of ['5', '-1', 'not-a-number', '']) {
      __resetWarnCache();
      vi.stubEnv('HARNESS_GATE_STAGNATION_WINDOW', val);
      const cfg = loadStagnationConfig(true);
      expect(cfg.window).toBe(2);
      expect(cfg.enabled).toBe(true);
      const windowWarns = warnSpy.mock.calls.filter(args => String(args[0]).includes('HARNESS_GATE_STAGNATION_WINDOW'));
      expect(windowWarns).toHaveLength(0);
      vi.unstubAllEnvs();
    }
  });

  it('all-valid envs return parsed values with enabled=true in auto-mode', () => {
    vi.stubEnv('HARNESS_GATE_STAGNATION', 'on');
    vi.stubEnv('HARNESS_GATE_STAGNATION_THRESHOLD', '0.80');
    vi.stubEnv('HARNESS_GATE_STAGNATION_RUN', '3');
    vi.stubEnv('HARNESS_GATE_STAGNATION_WINDOW', '5'); // no-op
    const cfg = loadStagnationConfig(true);
    expect(cfg.enabled).toBe(true);
    expect(cfg.threshold).toBe(0.80);
    expect(cfg.run).toBe(3);
    expect(cfg.window).toBe(2);
  });

  it('two invalid validated envs → both keys warned once each, feature disabled', () => {
    vi.stubEnv('HARNESS_GATE_STAGNATION', 'maybe');      // invalid
    vi.stubEnv('HARNESS_GATE_STAGNATION_THRESHOLD', '999'); // invalid
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    loadStagnationConfig(true);
    loadStagnationConfig(true); // second call — neither key warns again
    const mainWarns = warnSpy.mock.calls.filter(args => String(args[0]).includes('HARNESS_GATE_STAGNATION='));
    const threshWarns = warnSpy.mock.calls.filter(args => String(args[0]).includes('HARNESS_GATE_STAGNATION_THRESHOLD'));
    expect(mainWarns).toHaveLength(1);
    expect(threshWarns).toHaveLength(1);
    expect(loadStagnationConfig(true).enabled).toBe(false);
  });

  it('process latch: once any key is invalid, enabled=false survives env correction until __resetWarnCache', () => {
    vi.stubEnv('HARNESS_GATE_STAGNATION', 'maybe'); // invalid → sets latch
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    loadStagnationConfig(true); // latch engaged
    vi.unstubAllEnvs();          // env is now "corrected" (no bad values)
    // Latch still set → must stay disabled
    expect(loadStagnationConfig(true).enabled).toBe(false);
    // Reset latch → re-enabled
    __resetWarnCache();
    expect(loadStagnationConfig(true).enabled).toBe(true);
  });
});
