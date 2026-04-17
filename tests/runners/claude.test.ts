import { describe, it, expect } from 'vitest';

describe('Claude Runner', () => {
  it('module exports runClaudeInteractive and runClaudeGate', async () => {
    const mod = await import('../../src/runners/claude.js');
    expect(typeof mod.runClaudeInteractive).toBe('function');
    expect(typeof mod.runClaudeGate).toBe('function');
  });
});
