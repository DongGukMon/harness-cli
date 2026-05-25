import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { writeDeferredStub } from './deferredStub.js';
import type { GateRejectEntry } from '../../types.js';

const entry = (ids: string[], cycle: number, retry: number, feedbackPath: string): GateRejectEntry => ({
  cycle, retryIndex: retry, feedbackPath, requirementIds: ids, ts: 1700000000000,
});

describe('writeDeferredStub', () => {
  let runDir: string;
  beforeEach(() => {
    runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stub-'));
  });
  afterEach(() => {
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('writes stub at <runDir>/deferred/phase-{N}-{id}.md', () => {
    const history: GateRejectEntry[] = [
      entry(['R1.b', 'R8'], 0, 0, 'gate-4-cycle-0-retry-0-feedback.md'),
      entry(['R1.b'],       0, 1, 'gate-4-cycle-0-retry-1-feedback.md'),
    ];
    const stubPath = writeDeferredStub(runDir, 4, 'R1.b', history, 4);
    expect(stubPath).toBe(path.join(runDir, 'deferred', 'phase-4-R1.b.md'));
    expect(fs.existsSync(stubPath)).toBe(true);
    const body = fs.readFileSync(stubPath, 'utf-8');
    expect(body).toContain('R1.b');
    expect(body).toContain('Phase 4');
    expect(body).toContain('Auto-deferred after threshold 4');
    expect(body).toContain('gate-4-cycle-0-retry-0-feedback.md');
    expect(body).toContain('gate-4-cycle-0-retry-1-feedback.md');
  });

  it('is idempotent — re-writing overwrites with current snapshot', () => {
    const h1 = [entry(['R1.b'], 0, 0, 'a.md')];
    const h2 = [entry(['R1.b'], 0, 0, 'a.md'), entry(['R1.b'], 0, 1, 'b.md')];
    const p1 = writeDeferredStub(runDir, 4, 'R1.b', h1, 4);
    const body1 = fs.readFileSync(p1, 'utf-8');
    expect(body1).not.toContain('b.md');

    const p2 = writeDeferredStub(runDir, 4, 'R1.b', h2, 4);
    expect(p2).toBe(p1);
    const body2 = fs.readFileSync(p2, 'utf-8');
    expect(body2).toContain('a.md');
    expect(body2).toContain('b.md');
  });

  it('creates deferred/ directory if missing', () => {
    expect(fs.existsSync(path.join(runDir, 'deferred'))).toBe(false);
    writeDeferredStub(runDir, 7, 'R3', [entry(['R3'], 0, 0, 'x.md')], 4);
    expect(fs.statSync(path.join(runDir, 'deferred')).isDirectory()).toBe(true);
  });

  it('only lists feedbackPaths whose entry actually mentioned the ID', () => {
    const mixed: GateRejectEntry[] = [
      entry(['R1.b', 'R8'], 0, 0, 'both.md'),
      entry(['R8'],         0, 1, 'r8-only.md'),
      entry(['R1.b'],       0, 2, 'r1b-only.md'),
    ];
    const stub = writeDeferredStub(runDir, 4, 'R1.b', mixed, 4);
    const body = fs.readFileSync(stub, 'utf-8');
    expect(body).toContain('both.md');
    expect(body).toContain('r1b-only.md');
    expect(body).not.toContain('r8-only.md');
  });
});
