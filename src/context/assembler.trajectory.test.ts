import { describe, it, expect } from 'vitest';
import { renderRejectTrajectory } from './assembler.js';
import type { GateRejectEntry } from '../types.js';

const e = (ids: string[], c: number, r: number, fp: string): GateRejectEntry => ({
  cycle: c, retryIndex: r, feedbackPath: fp, requirementIds: ids, ts: 1,
});

describe('renderRejectTrajectory', () => {
  it('empty history → exact backward-compat one-liner per path', () => {
    const out = renderRejectTrajectory(['a.md', 'b.md'], []);
    expect(out).toBe('- 이전 피드백 (반드시 반영): a.md\n- 이전 피드백 (반드시 반영): b.md');
  });

  it('non-empty history → renders latest + accumulated list + counters', () => {
    const hist: GateRejectEntry[] = [
      e(['R1.b'], 0, 0, 'old1.md'),
      e(['R1.b', 'R8'], 0, 1, 'old2.md'),
      e(['R1.b'], 1, 0, 'latest.md'),
    ];
    const out = renderRejectTrajectory(['latest.md'], hist);
    expect(out).toContain('가장 최근');
    expect(out).toContain('latest.md');
    expect(out).toContain('누적 reject 이력');
    expect(out).toContain('cycle 0 retry 0');
    expect(out).toContain('R1.b: 3');
    expect(out).toContain('R8: 1');
  });

  it('emits ⚠ marker for IDs at or above threshold', () => {
    const hist: GateRejectEntry[] = Array.from({ length: 4 }, (_, i) =>
      e(['R1.b'], Math.floor(i / 2), i % 2, `f${i}.md`),
    );
    const out = renderRejectTrajectory(['f3.md'], hist, 4);
    expect(out).toContain('⚠');
    expect(out).toContain('R1.b');
  });

  it('truncates oldest entries when history is huge', () => {
    const hist = Array.from({ length: 200 }, (_, i) =>
      e(['R1.b'], 0, i, `f${i}.md`),
    );
    const out = renderRejectTrajectory(['f199.md'], hist, 4);
    expect(out.length).toBeLessThan(3500);
    expect(out).toContain('earlier rejects truncated');
  });
});
