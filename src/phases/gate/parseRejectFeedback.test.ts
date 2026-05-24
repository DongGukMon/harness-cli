import { describe, it, expect } from 'vitest';
import { extractRequirementIds } from './parseRejectFeedback.js';

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
