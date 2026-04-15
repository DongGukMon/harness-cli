import { vi, describe, it, expect, beforeEach } from 'vitest';
import { printAdvisorReminder } from '../src/ui.js';

describe('printAdvisorReminder', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('emits phase number in output', () => {
    printAdvisorReminder(1);
    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toMatch(/Phase 1/);
  });

  it('emits phase-specific framing for phase 1', () => {
    printAdvisorReminder(1);
    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toMatch(/Brainstorming/);
  });

  it('emits phase-specific framing for phase 3', () => {
    printAdvisorReminder(3);
    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toMatch(/Plan/);
  });

  it('emits phase-specific framing for phase 5', () => {
    printAdvisorReminder(5);
    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toMatch(/구현/);
  });

  it('emits /advisor slash command reference', () => {
    printAdvisorReminder(1);
    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toMatch(/\/advisor/);
  });

  it('falls back for unknown phase without throwing', () => {
    expect(() => printAdvisorReminder(99)).not.toThrow();
    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toMatch(/Phase 99/);
  });
});
