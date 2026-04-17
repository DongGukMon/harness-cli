import { describe, it, expect } from 'vitest';

describe('Codex Runner', () => {
  it('module exports runCodexInteractive and runCodexGate', async () => {
    const mod = await import('../../src/runners/codex.js');
    expect(typeof mod.runCodexInteractive).toBe('function');
    expect(typeof mod.runCodexGate).toBe('function');
  });
});
