import { describe, it, expect, afterEach } from 'vitest';
import { findStubbornIds, loadStubbornIdThreshold, __resetThresholdWarn } from './stubbornIds.js';
import type { GateRejectEntry } from '../types.js';

const entry = (
  ids: string[],
  cycle = 0,
  retry = 0,
): GateRejectEntry => ({
  cycle, retryIndex: retry,
  feedbackPath: `gate-4-cycle-${cycle}-retry-${retry}-feedback.md`,
  requirementIds: ids,
  ts: 0,
});

describe('findStubbornIds', () => {
  it('empty history → []', () => {
    expect(findStubbornIds([])).toEqual([]);
  });

  it('3 entries of R1.b below threshold 4 → []', () => {
    const hist = [entry(['R1.b']), entry(['R1.b'], 0, 1), entry(['R1.b'], 0, 2)];
    expect(findStubbornIds(hist)).toEqual([]);
  });

  it('4 entries of R1.b → ["R1.b"]', () => {
    const hist = [
      entry(['R1.b']), entry(['R1.b'], 0, 1),
      entry(['R1.b'], 1, 0), entry(['R1.b'], 1, 1),
    ];
    expect(findStubbornIds(hist)).toEqual(['R1.b']);
  });

  it('R1.b and R8 both at 4 → ordered by first occurrence', () => {
    const hist = [
      entry(['R1.b', 'R8']),
      entry(['R1.b', 'R8'], 0, 1),
      entry(['R1.b', 'R8'], 1, 0),
      entry(['R1.b', 'R8'], 1, 1),
    ];
    expect(findStubbornIds(hist)).toEqual(['R1.b', 'R8']);
  });

  it('duplicate R1.b inside one entry counts as one strike', () => {
    const dup = entry(['R1.b', 'R1.b'], 0, 0);
    expect(findStubbornIds([dup, dup, dup, dup])).toEqual(['R1.b']);
    // exactly 4 entries — survives, dedup within entry is honored
  });

  it('respects custom threshold via 2nd arg', () => {
    const hist = [entry(['R1.b']), entry(['R1.b'], 0, 1)];
    expect(findStubbornIds(hist, 2)).toEqual(['R1.b']);
  });

  it('clamps threshold < 2 to 2 (no throw)', () => {
    const hist = [entry(['R1.b']), entry(['R1.b'], 0, 1)];
    expect(findStubbornIds(hist, 0)).toEqual(['R1.b']);
    expect(findStubbornIds(hist, -5)).toEqual(['R1.b']);
  });

  it('entries with no IDs do not contribute', () => {
    const hist = [entry([]), entry([]), entry([]), entry([])];
    expect(findStubbornIds(hist)).toEqual([]);
  });
});

describe('loadStubbornIdThreshold', () => {
  afterEach(() => {
    delete process.env['HARNESS_STUBBORN_ID_THRESHOLD'];
    __resetThresholdWarn();
  });

  it('returns 4 when env unset', () => {
    expect(loadStubbornIdThreshold()).toBe(4);
  });

  it('parses valid env integer', () => {
    process.env['HARNESS_STUBBORN_ID_THRESHOLD'] = '6';
    expect(loadStubbornIdThreshold()).toBe(6);
  });

  it('falls back to 4 on invalid (non-int)', () => {
    process.env['HARNESS_STUBBORN_ID_THRESHOLD'] = 'abc';
    expect(loadStubbornIdThreshold()).toBe(4);
  });

  it('falls back to 4 on too-small (< 2)', () => {
    process.env['HARNESS_STUBBORN_ID_THRESHOLD'] = '1';
    expect(loadStubbornIdThreshold()).toBe(4);
  });
});
