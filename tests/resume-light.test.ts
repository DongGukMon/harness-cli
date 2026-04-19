import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createInitialState } from '../src/state.js';
import type { HarnessState } from '../src/types.js';

vi.mock('../src/artifact.js', () => ({
  normalizeArtifactCommit: vi.fn(),
}));
vi.mock('../src/git.js', () => ({
  getHead: vi.fn(() => 'head-sha'),
  isAncestor: vi.fn(() => true),
  detectExternalCommits: vi.fn(() => []),
}));
vi.mock('../src/phases/runner.js', () => ({
  runPhaseLoop: vi.fn(),
  handleGateEscalation: vi.fn(),
  handleVerifyEscalation: vi.fn(),
  handleVerifyError: vi.fn(),
}));

import { completeInteractivePhaseFromFreshSentinel } from '../src/resume.js';

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
});

function makeTmpDir(prefix = 'resume-light-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function makeState(overrides: Partial<HarnessState> = {}): HarnessState {
  const base = createInitialState('test-run', 'task', 'base', false, false, 'light');
  return {
    ...base,
    phaseOpenedAt: { '1': 0, '3': null, '5': null },
    ...overrides,
  };
}

describe('completeInteractivePhaseFromFreshSentinel — light + phase 1 extras (ADR-13)', () => {
  it('accepts a combined doc with "## Open Questions" + "## Implementation Plan" + valid checklist and updates specCommit', () => {
    const tmp = makeTmpDir();
    const state = makeState();
    state.artifacts.spec = path.join(tmp, 'spec.md');
    state.artifacts.decisionLog = path.join(tmp, 'decisions.md');
    state.artifacts.checklist = path.join(tmp, 'checklist.json');
    fs.writeFileSync(state.artifacts.spec,
      '# T\n## Complexity\n\nSmall\n\n## Open Questions\n없음\n\n## Implementation Plan\n- t\n');
    fs.writeFileSync(state.artifacts.decisionLog, '# D\n');
    fs.writeFileSync(state.artifacts.checklist,
      JSON.stringify({ checks: [{ name: 'n', command: 'true' }] }));

    expect(completeInteractivePhaseFromFreshSentinel(1, state, tmp)).toBe(true);
    expect(state.specCommit).toBe('head-sha');
  });

  it('rejects missing "## Open Questions" header', () => {
    const tmp = makeTmpDir();
    const state = makeState();
    state.artifacts.spec = path.join(tmp, 'spec.md');
    state.artifacts.decisionLog = path.join(tmp, 'decisions.md');
    state.artifacts.checklist = path.join(tmp, 'checklist.json');
    fs.writeFileSync(state.artifacts.spec,
      '# T\n## Complexity\n\nSmall\n\n## Implementation Plan\n- t\n');
    fs.writeFileSync(state.artifacts.decisionLog, '# D\n');
    fs.writeFileSync(state.artifacts.checklist,
      JSON.stringify({ checks: [{ name: 'n', command: 'true' }] }));
    expect(completeInteractivePhaseFromFreshSentinel(1, state, tmp)).toBe(false);
  });

  it('rejects missing "## Implementation Plan" header', () => {
    const tmp = makeTmpDir();
    const state = makeState();
    state.artifacts.spec = path.join(tmp, 'spec.md');
    state.artifacts.decisionLog = path.join(tmp, 'decisions.md');
    state.artifacts.checklist = path.join(tmp, 'checklist.json');
    fs.writeFileSync(state.artifacts.spec,
      '# T\n## Complexity\n\nSmall\n\n## Open Questions\n없음\n');
    fs.writeFileSync(state.artifacts.decisionLog, '# D\n');
    fs.writeFileSync(state.artifacts.checklist,
      JSON.stringify({ checks: [{ name: 'n', command: 'true' }] }));
    expect(completeInteractivePhaseFromFreshSentinel(1, state, tmp)).toBe(false);
  });

  it('rejects invalid checklist.json', () => {
    const tmp = makeTmpDir();
    const state = makeState();
    state.artifacts.spec = path.join(tmp, 'spec.md');
    state.artifacts.decisionLog = path.join(tmp, 'decisions.md');
    state.artifacts.checklist = path.join(tmp, 'checklist.json');
    fs.writeFileSync(state.artifacts.spec,
      '# T\n## Complexity\n\nSmall\n\n## Open Questions\n없음\n\n## Implementation Plan\n- t\n');
    fs.writeFileSync(state.artifacts.decisionLog, '# D\n');
    fs.writeFileSync(state.artifacts.checklist, '{"checks":[]}');
    expect(completeInteractivePhaseFromFreshSentinel(1, state, tmp)).toBe(false);
  });

  it('rejects a light combined doc that lacks the "## Complexity" header', () => {
    const tmp = makeTmpDir();
    const state = makeState();
    state.artifacts.spec = path.join(tmp, 'spec.md');
    state.artifacts.decisionLog = path.join(tmp, 'decisions.md');
    state.artifacts.checklist = path.join(tmp, 'checklist.json');
    fs.writeFileSync(state.artifacts.spec,
      '# T\n## Open Questions\n없음\n\n## Implementation Plan\n- t\n');
    fs.writeFileSync(state.artifacts.decisionLog, '# D\n');
    fs.writeFileSync(state.artifacts.checklist,
      JSON.stringify({ checks: [{ name: 'n', command: 'true' }] }));
    expect(completeInteractivePhaseFromFreshSentinel(1, state, tmp)).toBe(false);
  });
});

// Full-flow parity for spec R5 ("applies to both full and light flows") and
// spec R7 ("Validator (phase 1, resume path): same cases, via
// `completeInteractivePhaseFromFreshSentinel`"). The full flow does not
// require `## Open Questions` / `## Implementation Plan` / checklist.json at
// Phase 1 (those are light's combined-doc extras), so we only exercise the
// Complexity branch here.

describe('completeInteractivePhaseFromFreshSentinel — full + phase 1 Complexity', () => {
  function makeFullState(overrides: Partial<HarnessState> = {}): HarnessState {
    const base = createInitialState('test-run', 'task', 'base', false, false, 'full');
    return {
      ...base,
      phaseOpenedAt: { '1': 0, '3': null, '5': null },
      ...overrides,
    };
  }

  it('accepts a full-flow spec with a valid `## Complexity` section', () => {
    const tmp = makeTmpDir();
    const state = makeFullState();
    state.artifacts.spec = path.join(tmp, 'spec.md');
    state.artifacts.decisionLog = path.join(tmp, 'decisions.md');
    fs.writeFileSync(state.artifacts.spec, '# T\n\n## Complexity\n\nSmall\n');
    fs.writeFileSync(state.artifacts.decisionLog, '# D\n');
    expect(completeInteractivePhaseFromFreshSentinel(1, state, tmp)).toBe(true);
  });

  it('rejects a full-flow spec that lacks the `## Complexity` header', () => {
    const tmp = makeTmpDir();
    const state = makeFullState();
    state.artifacts.spec = path.join(tmp, 'spec.md');
    state.artifacts.decisionLog = path.join(tmp, 'decisions.md');
    fs.writeFileSync(state.artifacts.spec, '# T\n\n## Context & Decisions\n\nNo complexity here.\n');
    fs.writeFileSync(state.artifacts.decisionLog, '# D\n');
    expect(completeInteractivePhaseFromFreshSentinel(1, state, tmp)).toBe(false);
  });

  it('rejects a full-flow spec whose `## Complexity` body token is outside the 3-value enum', () => {
    const tmp = makeTmpDir();
    const state = makeFullState();
    state.artifacts.spec = path.join(tmp, 'spec.md');
    state.artifacts.decisionLog = path.join(tmp, 'decisions.md');
    fs.writeFileSync(state.artifacts.spec, '# T\n\n## Complexity\n\nExtraLarge\n');
    fs.writeFileSync(state.artifacts.decisionLog, '# D\n');
    expect(completeInteractivePhaseFromFreshSentinel(1, state, tmp)).toBe(false);
  });

  it('rejects a full-flow spec with duplicate `## Complexity` sections (spec Goal 1: "exactly one")', () => {
    const tmp = makeTmpDir();
    const state = makeFullState();
    state.artifacts.spec = path.join(tmp, 'spec.md');
    state.artifacts.decisionLog = path.join(tmp, 'decisions.md');
    fs.writeFileSync(
      state.artifacts.spec,
      '# T\n\n## Complexity\n\nSmall\n\n## Other\n\n## Complexity\n\nLarge\n',
    );
    fs.writeFileSync(state.artifacts.decisionLog, '# D\n');
    expect(completeInteractivePhaseFromFreshSentinel(1, state, tmp)).toBe(false);
  });
});
