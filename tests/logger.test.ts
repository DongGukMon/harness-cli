import { describe, it, expect } from 'vitest';
import { computeRepoKey } from '../src/logger.js';

describe('computeRepoKey', () => {
  it('returns 12-char hex for given input', () => {
    const key = computeRepoKey('/path/to/repo/.harness');
    expect(key).toMatch(/^[0-9a-f]{12}$/);
  });

  it('returns same output for same input', () => {
    const a = computeRepoKey('/some/path');
    const b = computeRepoKey('/some/path');
    expect(a).toBe(b);
  });

  it('returns different output for different input', () => {
    const a = computeRepoKey('/path/a');
    const b = computeRepoKey('/path/b');
    expect(a).not.toBe(b);
  });
});
