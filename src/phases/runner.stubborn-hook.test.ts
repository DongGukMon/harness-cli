import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { handleGateReject } from './runner.js';
import type { HarnessState } from '../types.js';

vi.mock('../ui.js', () => ({
  renderControlPanel: vi.fn(),
  printInfo: vi.fn(), printWarning: vi.fn(), printError: vi.fn(), printSuccess: vi.fn(),
  printPhaseTransition: vi.fn(),
  promptChoice: vi.fn(() => Promise.resolve('C')),
  separator: () => '----',
}));
vi.mock('./gate.js', () => ({ deleteGateSidecars: vi.fn(), runGatePhase: vi.fn() }));
vi.mock('../input.js', () => ({ promptChoice: vi.fn(() => Promise.resolve('C')) }));

const mkState = (autoMode: boolean): HarnessState => ({
  runId: 'test', autoMode, flow: 'full',
  phases: { '1':'completed','2':'completed','3':'completed','4':'pending','5':'pending','6':'pending','7':'pending' },
  gateRetries: { '2':0,'4':0,'7':0 }, gateEscalationCycles: { '4': 0 },
  gateRejectHistory: { '4': [] }, deferredRequirements: {},
  pendingAction: null, pauseReason: null, currentPhase: 4,
  phaseReopenFlags: {}, phaseReopenSource: {}, autoDeferIssues: false,
} as unknown as HarnessState);

describe('handleGateReject — stubborn-ID accumulator', () => {
  let runDir: string;
  beforeEach(() => { runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reject-')); });
  afterEach(() => { fs.rmSync(runDir, { recursive: true, force: true }); });

  it('persists requirementIds from feedback into gateRejectHistory', async () => {
    const state = mkState(true);
    const logger = { logEvent: vi.fn() } as any;
    const inputManager = {} as any;
    const comments = `- **[P1]** — R1.b\n  Issue: x.\n- **[P1]** — R8\n  Issue: y.`;
    await handleGateReject(4 as any, comments, 'plan' as any, 0, state, runDir, runDir, process.cwd(), inputManager, logger);
    expect(state.gateRejectHistory!['4']).toBeDefined();
    expect(state.gateRejectHistory!['4']!.length).toBeGreaterThan(0);
    expect(state.gateRejectHistory!['4']![0].requirementIds).toEqual(['R1.b', 'R8']);
  });
});
