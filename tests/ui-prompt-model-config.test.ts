import { describe, it, expect } from 'vitest';
import { promptModelConfig } from '../src/ui.js';
import type { InputManager } from '../src/input.js';
import { MODEL_PRESETS } from '../src/config.js';

function mockInput(queue: string[]): InputManager {
  const items = [...queue];
  return {
    waitForKey: async (_valid: Set<string>) => {
      const next = items.shift();
      if (next === undefined) throw new Error('test: no key/line queued');
      if (next === '\r' || next === '\n') return next;
      return next.toLowerCase().toUpperCase();
    },
    waitForLine: async () => {
      const next = items.shift();
      if (next === undefined) throw new Error('test: no line queued');
      return next;
    },
  } as unknown as InputManager;
}

describe('promptModelConfig — multi-digit preset selection', () => {
  it('accepts a numeric preset index typed as a line', async () => {
    const initial: Record<string, string> = {
      '1': MODEL_PRESETS[0].id,
      '2': 'codex-high',
      '3': 'sonnet-high',
      '4': 'codex-high',
      '5': 'sonnet-high',
      '7': 'codex-high',
    };
    const input = mockInput(['1', '5', '\r']);
    const out = await promptModelConfig(initial, input, ['1'], 'full');
    expect(out['1']).toBe(MODEL_PRESETS[4].id);
  });

  it('rejects out-of-range numeric input and re-prompts', async () => {
    const initial: Record<string, string> = {
      '1': MODEL_PRESETS[0].id,
      '2': 'codex-high',
      '3': 'sonnet-high',
      '4': 'codex-high',
      '5': 'sonnet-high',
      '7': 'codex-high',
    };
    const input = mockInput(['1', '99', '1', '2', '\r']);
    const out = await promptModelConfig(initial, input, ['1'], 'full');
    expect(out['1']).toBe(MODEL_PRESETS[1].id);
  });

  it('treats empty line as cancel and returns to phase select', async () => {
    const initial: Record<string, string> = {
      '1': MODEL_PRESETS[0].id,
      '2': 'codex-high',
      '3': 'sonnet-high',
      '4': 'codex-high',
      '5': 'sonnet-high',
      '7': 'codex-high',
    };
    // phase 1 → empty line (cancel) → confirm without changes
    const input = mockInput(['1', '', '\r']);
    const out = await promptModelConfig(initial, input, ['1'], 'full');
    expect(out['1']).toBe(MODEL_PRESETS[0].id);
  });
});
