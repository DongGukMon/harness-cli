import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { handleStubbornEscalationAuto, resetOldestEntryFor } from './stubbornEscalation.js';
import type { HarnessState, GateRejectEntry } from '../../types.js';

const e = (ids: string[], c: number, r: number, fp: string): GateRejectEntry => ({
  cycle: c, retryIndex: r, feedbackPath: fp, requirementIds: ids, ts: 1,
});

function mkState(): HarnessState {
  return {
    runId: 'test-run',
    autoMode: true,
    autoDeferIssues: false,
    phases: { '1':'completed','2':'completed','3':'completed','4':'pending','5':'pending','6':'pending','7':'pending' },
    gateRetries: { '2':0, '4':3, '7':0 },
    gateEscalationCycles: { '4': 0 },
    gateRejectHistory: { '4': [] },
    deferredRequirements: {},
    pendingAction: null,
    pauseReason: null,
    currentPhase: 4,
    // ... rest filled with safe defaults
  } as unknown as HarnessState;
}

describe('handleStubbornEscalationAuto', () => {
  let runDir: string;
  const logger = { logEvent: vi.fn() };

  beforeEach(() => {
    runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esc-'));
    logger.logEvent.mockReset();
  });
  afterEach(() => {
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('writes deferred stub for every stuck ID', () => {
    const state = mkState();
    state.gateRejectHistory!['4'] = [
      e(['R1.b'], 0, 0, 'a.md'), e(['R1.b'], 0, 1, 'b.md'),
      e(['R1.b'], 1, 0, 'c.md'), e(['R1.b'], 1, 1, 'd.md'),
    ];
    const comments = `- **[P1]** — Location: R1.b\n  Issue: stuck-only.`;
    const result = handleStubbornEscalationAuto({
      phase: 4, retryIndex: 1, stubbornIds: ['R1.b'], comments,
      state, runDir, threshold: 4, logger: logger as any,
    });
    expect(result.action).toBe('defer-and-force-pass');
    const stubPath = path.join(runDir, 'deferred', 'phase-4-R1.b.md');
    expect(fs.existsSync(stubPath)).toBe(true);
    expect(state.deferredRequirements!['4']?.[0].requirementId).toBe('R1.b');
    expect(state.deferredRequirements!['4']?.[0].rejectCount).toBe(4);
  });

  it('emits gate_stubborn_id event with action=defer-and-force-pass when filter empties feedback', () => {
    const state = mkState();
    state.gateRejectHistory!['4'] = [
      e(['R1.b'], 0, 0, 'a.md'), e(['R1.b'], 0, 1, 'b.md'),
      e(['R1.b'], 1, 0, 'c.md'), e(['R1.b'], 1, 1, 'd.md'),
    ];
    const comments = `- **[P1]** — Location: R1.b\n  Issue: stuck-only.`;
    handleStubbornEscalationAuto({
      phase: 4, retryIndex: 1, stubbornIds: ['R1.b'], comments,
      state, runDir, threshold: 4, logger: logger as any,
    });
    expect(logger.logEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'gate_stubborn_id',
      phase: 4,
      requirementIds: ['R1.b'],
      threshold: 4,
      action: 'defer-and-force-pass',
    }));
  });

  it('returns defer-and-continue + filtered feedback path when some items survive', () => {
    const state = mkState();
    state.gateRejectHistory!['4'] = [
      e(['R1.b'], 0, 0, 'a.md'), e(['R1.b'], 0, 1, 'b.md'),
      e(['R1.b'], 1, 0, 'c.md'), e(['R1.b'], 1, 1, 'd.md'),
    ];
    const comments = `- **[P1]** — Location: R1.b\n  Issue: stuck.\n- **[P1]** — Location: R8\n  Issue: fresh.`;
    const result = handleStubbornEscalationAuto({
      phase: 4, retryIndex: 1, stubbornIds: ['R1.b'], comments,
      state, runDir, threshold: 4, logger: logger as any,
    });
    expect(result.action).toBe('defer-and-continue');
    expect(result.filteredFeedbackPath).toBeDefined();
    const body = fs.readFileSync(result.filteredFeedbackPath!, 'utf-8');
    expect(body).not.toContain('R1.b');
    expect(body).toContain('R8');
  });

  it('emits action=already-deferred when ID is in state.deferredRequirements', () => {
    const state = mkState();
    state.deferredRequirements!['4'] = [{
      requirementId: 'R1.b', phase: 4, rejectCount: 4,
      feedbackPaths: [], stubPath: '/tmp/x', deferredAt: 0,
    }];
    state.gateRejectHistory!['4'] = [
      e(['R1.b'], 0, 0, 'a.md'), e(['R1.b'], 0, 1, 'b.md'),
      e(['R1.b'], 1, 0, 'c.md'), e(['R1.b'], 1, 1, 'd.md'),
      e(['R1.b'], 2, 0, 'e.md'),
    ];
    const comments = `- **[P1]** — R1.b\n  again.`;
    const result = handleStubbornEscalationAuto({
      phase: 4, retryIndex: 0, stubbornIds: ['R1.b'], comments,
      state, runDir, threshold: 4, logger: logger as any,
    });
    expect(result.action).toBe('already-deferred');
    expect(logger.logEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'gate_stubborn_id', action: 'already-deferred',
    }));
  });

  it('suppresses gate_stubborn_id event when emitEvent=false (manual-D path)', () => {
    const state = mkState();
    state.gateRejectHistory!['4'] = [
      e(['R1.b'], 0, 0, 'a.md'), e(['R1.b'], 0, 1, 'b.md'),
      e(['R1.b'], 1, 0, 'c.md'), e(['R1.b'], 1, 1, 'd.md'),
    ];
    const comments = `- **[P1]** — Location: R1.b\n  Issue: stuck-only.`;
    handleStubbornEscalationAuto({
      phase: 4, retryIndex: 1, stubbornIds: ['R1.b'], comments,
      state, runDir, threshold: 4, logger: logger as any,
      emitEvent: false,
    });
    // Verify gate_stubborn_id was NOT emitted; the caller (runner.ts manual-D)
    // is responsible for emitting its own `escalation` event in this path.
    const calls = logger.logEvent.mock.calls.map(c => c[0]);
    const stubbornEvents = calls.filter((e: any) => e?.event === 'gate_stubborn_id');
    expect(stubbornEvents).toHaveLength(0);
  });

  it('falls back to full feedback when filter parse fails', () => {
    const state = mkState();
    state.gateRejectHistory!['4'] = [
      e(['R1.b'], 0, 0, 'a.md'), e(['R1.b'], 0, 1, 'b.md'),
      e(['R1.b'], 1, 0, 'c.md'), e(['R1.b'], 1, 1, 'd.md'),
    ];
    const comments = 'garbled with R1.b but no item markers';
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = handleStubbornEscalationAuto({
      phase: 4, retryIndex: 1, stubbornIds: ['R1.b'], comments,
      state, runDir, threshold: 4, logger: logger as any,
    });
    expect(result.action).toBe('defer-and-continue');
    expect(result.filteredFeedbackPath).toBeUndefined(); // fell back, use original
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('feedback transform failed'));
    warnSpy.mockRestore();
  });
});

describe('resetOldestEntryFor (R key behaviour)', () => {
  const e = (ids: string[], c: number, r: number, fp: string) => ({
    cycle: c, retryIndex: r, feedbackPath: fp, requirementIds: ids, ts: c * 10 + r,
  });

  it('drops the oldest entry containing the ID', () => {
    const hist = [
      e(['R1.b'], 0, 0, 'a.md'),
      e(['R1.b', 'R8'], 0, 1, 'b.md'),
      e(['R8'], 1, 0, 'c.md'),
      e(['R1.b'], 1, 1, 'd.md'),
    ];
    const out = resetOldestEntryFor(hist as any, ['R1.b']);
    // first entry (a.md) is the oldest containing R1.b → dropped
    expect(out.map(x => x.feedbackPath)).toEqual(['b.md', 'c.md', 'd.md']);
  });

  it('handles multiple stuck IDs by dropping oldest per ID', () => {
    const hist = [
      e(['R1.b'], 0, 0, 'a.md'),
      e(['R8'],   0, 1, 'b.md'),
      e(['R1.b'], 1, 0, 'c.md'),
      e(['R8'],   1, 1, 'd.md'),
    ];
    const out = resetOldestEntryFor(hist as any, ['R1.b', 'R8']);
    // a.md (oldest R1.b) and b.md (oldest R8) both dropped
    expect(out.map(x => x.feedbackPath)).toEqual(['c.md', 'd.md']);
  });
});
