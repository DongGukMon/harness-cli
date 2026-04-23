import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Footer } from '../../../src/ink/components/Footer.js';
import type { FooterSummary } from '../../../src/metrics/footer-aggregator.js';

function makeSummary(overrides: Partial<FooterSummary> = {}): FooterSummary {
  return {
    currentPhase: 1,
    attempt: 1,
    phaseRunningElapsedMs: 60_000,
    sessionElapsedMs: 120_000,
    claudeTokens: 500_000,
    gateTokens: 100_000,
    totalTokens: 600_000,
    ...overrides,
  };
}

describe('Footer', () => {
  it('renders nothing when summary is null', () => {
    const { lastFrame } = render(<Footer summary={null} columns={80} />);
    expect(lastFrame()).toBe('');
  });

  it('renders token info when summary provided (wide)', () => {
    const { lastFrame } = render(<Footer summary={makeSummary()} columns={80} />);
    const frame = lastFrame();
    expect(frame).toContain('P1');
    expect(frame).toContain('tok');
  });

  it('renders compact format when columns < 60', () => {
    const { lastFrame } = render(<Footer summary={makeSummary()} columns={40} />);
    const frame = lastFrame();
    expect(frame).toContain('P1');
    expect(frame).toContain('a1');
    expect(frame).not.toContain('attempt 1');
  });
});
