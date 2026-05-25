import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearFooterRow, formatFooter, writeFooterToPane } from '../src/ui.js';
import type { FooterSummary } from '../src/metrics/footer-aggregator.js';

function makeSummary(overrides: Partial<FooterSummary> = {}): FooterSummary {
  return {
    currentPhase: 5,
    attempt: 1,
    phaseRunningElapsedMs: 83_000,
    sessionElapsedMs: 724_000,
    claudeTokens: 8_700_000,
    gateTokens: 400_000,
    totalTokens: 9_100_000,
    ...overrides,
  };
}

describe('footer formatting helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('formats the wide footer with all segments present', () => {
    expect(formatFooter(makeSummary(), 100)).toBe(
      'P5 attempt 1 · 1m 23s phase · 12m 04s session · 9.1M tok (8.7M Claude + 0.4M gate)',
    );
  });

  it('formats the compact footer', () => {
    expect(formatFooter(makeSummary(), 79)).toBe('P5 a1 · 1m23s / 12m04s · 9.1M tok');
  });

  it('formats the phase-6 wide footer exactly', () => {
    expect(
      formatFooter(
        makeSummary({
          currentPhase: 6,
          attempt: 2,
          phaseRunningElapsedMs: 83_000,
          sessionElapsedMs: 724_000,
          claudeTokens: 0,
          gateTokens: 0,
          totalTokens: 0,
        }),
        100,
      ),
    ).toBe('P6 · 1m 23s phase · 12m 04s session');
  });

  it('formats the phase-6 compact footer exactly', () => {
    expect(
      formatFooter(
        makeSummary({
          currentPhase: 6,
          attempt: 2,
          phaseRunningElapsedMs: 83_000,
          sessionElapsedMs: 724_000,
          claudeTokens: 0,
          gateTokens: 0,
          totalTokens: 0,
        }),
        79,
      ),
    ).toBe('P6 · 1m23s / 12m04s');
  });

  it('omits the token segment for phase 6 even when totalTokens is non-zero', () => {
    const summary = makeSummary({
      currentPhase: 6,
      attempt: 3,
      phaseRunningElapsedMs: 83_000,
      sessionElapsedMs: 724_000,
      claudeTokens: 8_700_000,
      gateTokens: 400_000,
      totalTokens: 9_100_000,
    });

    expect(formatFooter(summary, 100)).toBe('P6 · 1m 23s phase · 12m 04s session');
    expect(formatFooter(summary, 79)).toBe('P6 · 1m23s / 12m04s');
  });

  it('returns an empty string when columns are zero or negative', () => {
    expect(formatFooter(makeSummary(), 0)).toBe('');
    expect(formatFooter(makeSummary(), -1)).toBe('');
  });

  it('renders the actual failed-attempt duration (not "0m 00s") when phaseRunningElapsedMs is provided after timeout (#116 B2)', () => {
    // 30-minute hard-cap timeout: the aggregator now supplies the actual
    // failed-attempt duration; the formatted footer must reflect it instead
    // of the misleading "0m 00s" that the operator reads as "phase failed
    // instantly".
    const line = formatFooter(
      makeSummary({
        currentPhase: 3,
        attempt: 1,
        phaseRunningElapsedMs: 1_800_000,
      }),
      100,
    );

    expect(line).toContain('30m 00s phase');
    // Must not show the misleading "· 0m 00s phase" segment (the leading
    // separator distinguishes from "30m 00s phase" which contains "0m 00s"
    // as a substring).
    expect(line).not.toContain('· 0m 00s phase');
  });

  it('writes the exact footer ANSI sequence to stderr for a non-empty line', () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    writeFooterToPane('footer line', 24, 100);

    expect(stderrWrite).toHaveBeenCalledTimes(1);
    expect(stderrWrite).toHaveBeenCalledWith('\x1b[s\x1b[24;1H\x1b[2Kfooter line\x1b[u');
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it('does not write anything when the footer line is empty', () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    writeFooterToPane('', 24, 100);

    expect(stderrWrite).not.toHaveBeenCalled();
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it('writes the exact clear-row ANSI sequence to stderr', () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    clearFooterRow(24);

    expect(stderrWrite).toHaveBeenCalledTimes(1);
    expect(stderrWrite).toHaveBeenCalledWith('\x1b[s\x1b[24;1H\x1b[2K\x1b[u');
    expect(stdoutWrite).not.toHaveBeenCalled();
  });
});
