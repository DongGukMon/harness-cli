import { describe, it, expect, afterEach } from 'vitest';
import { separator } from '../src/ui.js';

describe('separator()', () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'columns');

  afterEach(() => {
    if (originalDescriptor) {
      Object.defineProperty(process.stdout, 'columns', originalDescriptor);
    }
  });

  function setColumns(value: number | undefined): void {
    Object.defineProperty(process.stdout, 'columns', {
      configurable: true,
      get: () => value,
    });
  }

  it('caps width at 64 on wide terminals', () => {
    setColumns(200);
    expect(separator()).toBe('━'.repeat(64));
  });

  it('fits within a 40-column terminal (narrow tmux split)', () => {
    setColumns(40);
    const s = separator();
    expect(s.length).toBeLessThanOrEqual(40);
    expect(s).toBe('━'.repeat(38));
  });

  it('respects minimum width of 16 when terminal is very narrow', () => {
    setColumns(8);
    expect(separator()).toBe('━'.repeat(16));
  });

  it('falls back to a default width when columns is unavailable', () => {
    setColumns(undefined);
    expect(separator()).toBe('━'.repeat(62));
  });

  it('recomputes on each call so terminal resize takes effect', () => {
    setColumns(40);
    const narrow = separator();
    setColumns(200);
    const wide = separator();
    expect(narrow.length).toBeLessThan(wide.length);
  });
});
