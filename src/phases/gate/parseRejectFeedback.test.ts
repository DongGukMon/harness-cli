import { describe, it, expect } from 'vitest';
import { extractRequirementIds, filterFeedbackByIds } from './parseRejectFeedback.js';

describe('extractRequirementIds', () => {
  it('returns empty array for empty input', () => {
    expect(extractRequirementIds('')).toEqual([]);
  });

  it('extracts requirement IDs from real Codex reject feedback', () => {
    const sample = `
- **[P1]** — Location: \`<spec>\` R1.b "Deprecated-key denylist"; \`<plan>\` Task 2 Step 3
  Issue: The plan does not preserve the specified validation error contract.
  Evidence: Spec R1.b states the error is \`invalidUserData(...)\`.
- **[P2]** — Location: \`<spec>\` R8 "Negative tests for the L3 deprecated denylist"
  Issue: Only id-nik-match coverage.
- **[P2]** — Location: \`<spec>\` R9; \`<plan>\` Task 9 Step 3
`;
    expect(extractRequirementIds(sample)).toEqual(['R1.b', 'R8', 'R9']);
  });

  it('dedupes repeated IDs preserving first-occurrence order', () => {
    const sample = 'R8 mentioned, then R1.b, then R8 again, then R1.b again, then R9';
    expect(extractRequirementIds(sample)).toEqual(['R8', 'R1.b', 'R9']);
  });

  it('returns empty for foreign convention REQ-1.2', () => {
    expect(extractRequirementIds('See REQ-1.2 and req-3')).toEqual([]);
  });

  it('caps scan at 64 KB without throwing', () => {
    const huge = 'x'.repeat(64 * 1024) + ' R99 should be ignored after cap';
    const t0 = Date.now();
    const result = extractRequirementIds(huge);
    const dt = Date.now() - t0;
    expect(result).toEqual([]);
    expect(dt).toBeLessThan(100); // perf guard
  });

  it('handles ID at very start of input', () => {
    expect(extractRequirementIds('R1 starts here')).toEqual(['R1']);
  });

  it('does not match Rxx in word-internal positions like FOOR1.b', () => {
    expect(extractRequirementIds('FOOR1.b and BAR8')).toEqual([]);
  });
});

describe('filterFeedbackByIds', () => {
  const sample = `
- **[P1]** — Location: \`<spec>\` R1.b
  Issue: stuck-only item.
  Evidence: R1.b stuff.
- **[P1]** — Location: \`<spec>\` R8
  Issue: fresh item.
- **[P2]** — Location: \`<spec>\` R9
  Issue: another fresh item.
`;

  it('drops items whose IDs are all in the stuck set', () => {
    const { filtered, dropped } = filterFeedbackByIds(sample, ['R1.b']);
    expect(filtered).not.toContain('R1.b');
    expect(filtered).toContain('R8');
    expect(filtered).toContain('R9');
    expect(dropped).toBe(1);
  });

  it('keeps items mentioning a stuck ID alongside a fresh ID', () => {
    const mixed = `
- **[P1]** — Location: R1.b and also R8 are both mentioned.
  Issue: mixed.
- **[P1]** — Location: R1.b only.
  Issue: stuck-only.
`;
    const { filtered, dropped } = filterFeedbackByIds(mixed, ['R1.b']);
    expect(filtered).toContain('mixed');
    expect(filtered).not.toContain('stuck-only');
    expect(dropped).toBe(1);
  });

  it('returns empty filtered when every item is stuck-only', () => {
    const allStuck = `
- **[P1]** — Location: R1.b
  Issue: a.
- **[P1]** — Location: R1.b
  Issue: b.
`;
    const { filtered, dropped } = filterFeedbackByIds(allStuck, ['R1.b']);
    expect(filtered.trim()).toBe('');
    expect(dropped).toBe(2);
  });

  it('returns input unchanged when stuck set is empty', () => {
    const { filtered, dropped } = filterFeedbackByIds(sample, []);
    expect(filtered).toBe(sample);
    expect(dropped).toBe(0);
  });

  it('marks parse failure when input has no item markers', () => {
    const garbled = 'just some text with R1.b in it but no list items';
    const { filtered, dropped, parsedOk } = filterFeedbackByIds(garbled, ['R1.b']);
    expect(parsedOk).toBe(false);
    expect(filtered).toBe(garbled);
    expect(dropped).toBe(0);
  });
});
