import { describe, expect, it } from 'vitest';
import { getGateRetryLimit } from '../src/config.js';

describe('getGateRetryLimit', () => {
  it('returns 3 for full flow', () => {
    expect(getGateRetryLimit('full')).toBe(3);
  });

  it('returns 5 for light flow', () => {
    expect(getGateRetryLimit('light')).toBe(5);
  });
});
