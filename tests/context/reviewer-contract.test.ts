import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { assembleGatePrompt } from '../../src/context/assembler.js';
import type { HarnessState } from '../../src/types.js';

function stubState(tmp: string): HarnessState {
  fs.writeFileSync(path.join(tmp, 'spec.md'), '# spec\n## Context & Decisions\n- x\n## Open Questions\n- y\n');
  fs.writeFileSync(path.join(tmp, 'plan.md'), '# plan\n');
  fs.writeFileSync(path.join(tmp, 'eval.md'), '# eval\n');
  return {
    runId: 'test-run',
    baseCommit: 'abc',
    implCommit: null,
    evalCommit: null,
    externalCommitsDetected: false,
    verifiedAtHead: null,
    implRetryBase: '',
    artifacts: {
      spec: path.join(tmp, 'spec.md'),
      plan: path.join(tmp, 'plan.md'),
      decisionLog: path.join(tmp, 'decisions.md'),
      checklist: path.join(tmp, 'checklist.json'),
      evalReport: path.join(tmp, 'eval.md'),
    },
    phasePresets: { '2': 'codex-high', '4': 'codex-high', '7': 'codex-high' },
    phases: { '1': 'pending', '2': 'pending', '3': 'pending', '4': 'pending', '5': 'pending', '6': 'pending', '7': 'pending' },
    phaseCodexSessions: { '2': null, '4': null, '7': null },
    phaseAttemptId: {},
    phaseOpenedAt: {},
    phaseReopenFlags: {},
    gateRetries: { '2': 0, '4': 0, '7': 0 },
    pendingAction: null,
  } as unknown as HarnessState;
}

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-')); });

describe('REVIEWER_CONTRACT_BY_GATE', () => {
  it('gate 2 — spec rubric (Correctness/Readability/Scope + Open Questions check)', () => {
    const s = stubState(tmp);
    const p = assembleGatePrompt(2, s, tmp, tmp);
    expect(typeof p).toBe('string');
    const prompt = p as string;
    expect(prompt).toContain('Five-Axis Evaluation (Phase 2');
    expect(prompt).toMatch(/1\.\s*Correctness/);
    expect(prompt).toMatch(/2\.\s*Readability/);
    expect(prompt).toMatch(/3\.\s*Scope/);
    expect(prompt).toMatch(/Open Questions/);           // qa #7 gate check
    expect(prompt).not.toMatch(/\bSecurity\b/);         // not in spec gate
    expect(prompt).not.toMatch(/\bPerformance\b/);      // not in spec gate
  });

  it('gate 4 — plan rubric (Correctness/Architecture/Testability/Readability)', () => {
    const s = stubState(tmp);
    const p = assembleGatePrompt(4, s, tmp, tmp);
    const prompt = p as string;
    expect(prompt).toContain('Five-Axis Evaluation (Phase 4');
    expect(prompt).toMatch(/Architecture/);
    expect(prompt).toMatch(/Testability/);
    expect(prompt).not.toMatch(/\bSecurity\b/);
    expect(prompt).not.toMatch(/\bPerformance\b/);
  });

  it('gate 7 — eval rubric (all 5 axes + severity)', () => {
    const s = stubState(tmp);
    const p = assembleGatePrompt(7, s, tmp, tmp);
    const prompt = p as string;
    expect(prompt).toContain('Five-Axis Evaluation (Phase 7');
    expect(prompt).toMatch(/Correctness/);
    expect(prompt).toMatch(/Readability/);
    expect(prompt).toMatch(/Architecture/);
    expect(prompt).toMatch(/Security/);
    expect(prompt).toMatch(/Performance/);
    expect(prompt).toMatch(/P0\/P1=Critical/);
  });

  it('REVIEWER_CONTRACT_BASE common parts present in all three', () => {
    const s = stubState(tmp);
    for (const g of [2, 4, 7] as const) {
      const prompt = assembleGatePrompt(g, s, tmp, tmp) as string;
      expect(prompt).toMatch(/## Verdict/);
      expect(prompt).toMatch(/## Comments/);
      expect(prompt).toMatch(/## Summary/);
      expect(prompt).toMatch(/APPROVE only if zero P0\/P1/);
      expect(prompt).toContain('Scope tagging (REJECT only)');
      expect(prompt).toContain('Scope: design | impl | mixed');
      expect(prompt).toContain('Phase 7 eval gate 에서만 dispatch');
    }
  });
});
