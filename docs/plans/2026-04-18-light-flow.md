# Light Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/specs/2026-04-18-light-flow-design.md`

**Goal:** Add `harness start --light` — a 4-phase (P1 → P5 → P6 → P7) flow that folds Phase 3's plan output into Phase 1's combined design doc, skipping the spec-gate (P2) and plan-gate (P4), while preserving the Phase 7 eval gate with flow-aware REJECT routing (light always reopens Phase 1).

**Architecture:**
- **Data:** introduce `state.flow: 'full' | 'light'`, a new `'skipped'` `PhaseStatus`, and a `state.carryoverFeedback: CarryoverFeedback | null` field that survives P1 reopen and is consumed by P5 (so the Gate-7 reject feedback reaches the impl session even though `pendingAction` is cleared on P1 completion).
- **Prompt plumbing:** add `getPhaseArtifactFiles(flow, phase)` in `src/config.ts` as the single source of truth for per-phase artifact sets; both `validatePhaseArtifacts` (live) and `completeInteractivePhaseFromFreshSentinel` (resume) call it. `buildGatePromptPhase7` and `buildResumeSections` both gain a `flow === 'light'` branch that skips the `<plan>` slot.
- **Control flow:** `createInitialState` accepts a `flow` arg; in light mode phases `'2'|'3'|'4'` initialize to `'skipped'`. Gate-7 REJECT target is resolved via a new `getReopenTarget(flow, gate)` — light → Phase 1, full → Phase 5 (unchanged). On light Gate-7 REJECT, `carryoverFeedback` is recorded and phases `5`/`6` are reset; P5 consumes it on entry and clears on completion.
- **Surface:** `--light` is a new flag on `harness start` (and `run` alias); `harness resume --light` is explicitly rejected (flow is frozen at run creation).

**Tech Stack:** TypeScript (strict), vitest suite (497 passed / 1 skipped baseline), pnpm workspace, commander CLI parser. All existing entrypoints (`assembleInteractivePrompt`, `assembleGatePrompt`, `buildResumeSections`, `runPhaseLoop`, `createInitialState`, `migrateState`) already have test coverage — every change lands alongside tests that exercise the new flow-aware branches.

**Scope note:** Each task ends with `pnpm vitest run <path>` and a commit. The final task runs the full suite + `pnpm tsc --noEmit` + `pnpm build` before the PR.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/types.ts` | Modify | Add `FlowMode`, `'skipped'` to `PhaseStatus`, `CarryoverFeedback` interface, `HarnessState.flow`, `HarnessState.carryoverFeedback`. |
| `src/state.ts` | Modify | Extend `createInitialState` to accept `flow`; initialize `phases['2']='skipped'` (etc.) for light; `migrateState` back-fills `flow='full'` and `carryoverFeedback=null` for legacy runs. |
| `src/config.ts` | Modify | Add `LIGHT_PHASE_DEFAULTS`, `LIGHT_REQUIRED_PHASE_KEYS`, `getPhaseArtifactFiles(flow, phase)` helper, `getReopenTarget(flow, gate)` helper. |
| `src/resume.ts` | Modify | `completeInteractivePhaseFromFreshSentinel` (≈472-526) replaces direct artifact-key list with `getPhaseArtifactFiles(state.flow, phase)`; light + phase 1 extra validation (`## Implementation Plan` regex + checklist schema). |
| `src/phases/interactive.ts` | Modify | `validatePhaseArtifacts` (≈95-151) replaces `PHASE_ARTIFACT_FILES[phase]` with helper; same extra validation for light phase 1; `preparePhase` deletion list uses helper. |
| `src/phases/runner.ts` | Modify | `normalizeInteractiveArtifacts` uses helper; `previousInteractivePhase` replaced by `getReopenTarget(state.flow, phase)` in REJECT path; light Gate-7 REJECT writes `state.carryoverFeedback` and resets phases 5 + 6; Phase 5 completion clears `carryoverFeedback`; skip interactive 2/3/4 when `'skipped'`. |
| `src/phases/gate.ts` | (no code change) | REJECT-target logic now lives in `runner.ts::handleGateReject`; gate.ts stays flow-agnostic. |
| `src/context/assembler.ts` | Modify | `assembleInteractivePrompt` picks `phase-1-light.md` template when `flow==='light' && phase===1`; injects `feedback_paths` from `state.carryoverFeedback` merged with `pendingAction.feedbackPaths` on phase 5; `buildGatePromptPhase7` and `buildResumeSections` both skip `<plan>` on light. |
| `src/context/prompts/phase-1-light.md` | **Create** | Light Phase 1 init prompt: combined design + plan in one doc; `## Implementation Plan` header required; checklist.json generation rules; reopen-time diff-focus wording. |
| `src/commands/start.ts` | Modify | `StartOptions.light?: boolean`; pass `flow` to `createInitialState`. |
| `src/commands/resume.ts` | Modify | Reject `--light` flag with clear error message (flow is frozen at run creation). |
| `src/commands/inner.ts` | Modify | `REQUIRED_PHASE_KEYS` → flow-aware via a new export `getRequiredPhaseKeys(flow)`; `promptModelConfig` and `runRunnerAwarePreflight` drive off that set. |
| `src/ui.ts` | Modify | `renderControlPanel` renders `'skipped'` as `(skipped)` with a dim glyph; `renderModelSelection` / `promptModelConfig` show only flow-applicable phases; preserve current Phase-6 fixed row. |
| `bin/harness.ts` | Modify | Register `--light` option on `start` and `run` commands. |
| `tests/state.test.ts` | Modify | New describe block covering `flow`/`carryoverFeedback` creation + migration. |
| `tests/phases/runner.test.ts` | Modify | New tests for light skip-phase advance, Gate-7 REJECT → Phase 1 reopen + carryoverFeedback set, Phase 5 completion clears carryoverFeedback, feedback paths merged. |
| `tests/phases/interactive.test.ts` | Modify | `validatePhaseArtifacts` light + phase 1 accepts combined doc + checklist; rejects missing `## Implementation Plan` header or invalid checklist. |
| `tests/resume.test.ts` | Modify | `completeInteractivePhaseFromFreshSentinel` light + phase 1 validates combined doc + checklist + plan header. |
| `tests/context/assembler.test.ts` | Modify | `assembleInteractivePrompt(1, light)` uses light template; `buildGatePromptPhase7` light skips `<plan>`. |
| `tests/context/assembler-resume.test.ts` | Modify | `buildResumeSections(7, light)` skips `<plan>`; fresh + resume assemble the same `<spec>`/`<eval_report>`/diff content. |
| `tests/commands/run.test.ts` | Modify | `--light` flag sets `state.flow='light'` and skipped phases; resume rejects `--light`. |
| `tests/integration/light-flow.test.ts` | **Create** | End-to-end: `harness start --light` drives through P1 → P5 → P6 → P7 with mocked Claude/Codex runners; state.json shape verified at each advance. |
| `docs/HOW-IT-WORKS.md` | Modify | Add "Light Flow" section after the full-flow overview. |
| `CLAUDE.md` (project) | Modify | Mention `--light` under "풀 프로세스 호출" section. |
| `dist/**` | Regenerate | `pnpm build` at end of plan; integration tests read `dist/bin/harness.js`. |

---

## Task Dependency Graph

```
Task 0 (baseline, no deps)
  ↓
Task 1 (types + state + migration)        ← foundation; blocks 2, 3, 4, 5, 6, 7, 8
  ↓
Task 2 (getPhaseArtifactFiles + getReopenTarget)  ← depends on Task 1 (types); blocks 6, 8
  ↓
Task 3 (phase-1-light.md + assembler interactive)  ← depends on Task 1 (state.flow, carryoverFeedback); blocks 8
  ↓
Task 4 (Phase 7 assembler fresh + resume)  ← depends on Task 1 (state.flow); blocks 8
  ↓
Task 5 (CLI surface --light, resume reject)  ← depends on Task 1 (createInitialState signature); blocks 8 (integration uses built CLI)
  ↓
Task 6 (runner flow-aware skip + REJECT + carryover lifecycle)  ← depends on Task 1 + Task 2; blocks 8
  ↓
Task 7 (UI)                                ← depends on Task 1 ('skipped' status); parallel with Task 6
  ↓
Task 8 (E2E integration)                   ← depends on Tasks 1-7
  ↓
Task 9 (docs)                              ← no code deps; can run anywhere after Task 1 confirms final type names
  ↓
Task 10 (final verification + build + PR)  ← must run last
```

**Parallelizable windows:** Tasks 3, 4, 5, 7 can be implemented in parallel once Task 1 + Task 2 are merged (they touch disjoint files). Task 6 runs after Task 2 (shares `getReopenTarget`). Task 8 is strictly serial at the end because it exercises the whole integration.

**Per-task acceptance:** every task's "Expected: … PASS" assertion at the end of each Step block is the acceptance gate. Final acceptance is the Eval Checklist at the bottom of this document.

---

## Task 0: Baseline verification

**Files:** none (pre-flight only).

- [ ] **Step 1: Confirm clean worktree on top of this plan's base commit**

Run:

```bash
cd /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/light-flow-plan
git status -s
git log --oneline main..HEAD | cat
```

Expected:
- `git status -s` prints nothing.
- `git log main..HEAD` shows the plan-branch commits only (e.g. the spec rename commit + this plan commit). No stray changes.

If the tree is dirty, stop and reconcile before coding.

- [ ] **Step 2: Capture the green test baseline**

Run:

```bash
pnpm vitest run 2>&1 | tail -20
pnpm tsc --noEmit 2>&1 | tail -5
```

Expected: `497 passed | 1 skipped` (or newer baseline) and zero TS errors. Record the actual numbers in the commit message of Task 10 so drift is visible.

---

## Task 1: Types + state schema + migration

**Files:**
- Modify: `src/types.ts` (lines 4, 32-74)
- Modify: `src/state.ts` (lines 62-109, 173-249)
- Modify: `tests/state.test.ts`

- [ ] **Step 1: Write failing tests for the new state fields + migration**

Add to `tests/state.test.ts` (inside a new `describe('flow + carryoverFeedback (light-flow spec)', …)` block near the bottom, before the trailing `tmpDirs` helper):

```ts
describe('flow + carryoverFeedback (light-flow spec)', () => {
  it('createInitialState defaults flow to "full" and carryoverFeedback to null', () => {
    const state = createInitialState('r1', 't', 'base', false);
    expect(state.flow).toBe('full');
    expect(state.carryoverFeedback).toBeNull();
    expect(state.phases['2']).toBe('pending');
    expect(state.phases['3']).toBe('pending');
    expect(state.phases['4']).toBe('pending');
  });

  it('createInitialState with flow="light" marks phases 2/3/4 as "skipped"', () => {
    const state = createInitialState('r1', 't', 'base', false, false, 'light');
    expect(state.flow).toBe('light');
    expect(state.phases['1']).toBe('pending');
    expect(state.phases['2']).toBe('skipped');
    expect(state.phases['3']).toBe('skipped');
    expect(state.phases['4']).toBe('skipped');
    expect(state.phases['5']).toBe('pending');
    expect(state.phases['6']).toBe('pending');
    expect(state.phases['7']).toBe('pending');
    expect(state.artifacts.plan).toBe('');
  });

  it('migrateState backfills missing flow as "full" and carryoverFeedback as null', () => {
    const base = createInitialState('r1', 't', 'base', false);
    const raw: any = JSON.parse(JSON.stringify(base));
    delete raw.flow;
    delete raw.carryoverFeedback;
    const migrated = migrateState(raw);
    expect(migrated.flow).toBe('full');
    expect(migrated.carryoverFeedback).toBeNull();
  });

  it('migrateState preserves an existing light flow value', () => {
    const base = createInitialState('r1', 't', 'base', false, false, 'light');
    const raw = JSON.parse(JSON.stringify(base));
    const migrated = migrateState(raw);
    expect(migrated.flow).toBe('light');
    expect(migrated.carryoverFeedback).toBeNull();
  });

  it('carryoverFeedback survives writeState → readState round-trip', () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);
    const state = createInitialState('r1', 't', 'base', false, false, 'light');
    state.carryoverFeedback = {
      sourceGate: 7,
      paths: ['.harness/r1/gate-7-feedback.md'],
      deliverToPhase: 5,
    };
    writeState(dir, state);
    const restored = readState(dir);
    expect(restored?.carryoverFeedback).toEqual(state.carryoverFeedback);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm vitest run tests/state.test.ts -t 'light-flow spec' 2>&1 | tail -30
```

Expected: 5 FAIL. Some will be `TypeError: createInitialState only accepts 5 args`; others will be `expected undefined to be "full"`.

- [ ] **Step 3: Extend `src/types.ts`**

Replace the `PhaseStatus` union at line 4 with:

```ts
export type PhaseStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'error' | 'skipped';
```

Add after the `PendingAction` interface (roughly line 15):

```ts
export type FlowMode = 'full' | 'light';

export interface CarryoverFeedback {
  sourceGate: 7;
  paths: string[];
  deliverToPhase: 5;
}
```

Inside `HarnessState` (around line 32), add the two fields immediately after `runId: string;`:

```ts
  flow: FlowMode;
  carryoverFeedback: CarryoverFeedback | null;
```

(The spec §"State Schema Changes" shows the final shape; ordering inside the interface is ours to choose — keep it near `runId` for readability.)

- [ ] **Step 4: Extend `createInitialState` to accept `flow`**

In `src/state.ts` replace the signature (line 173) with:

```ts
export function createInitialState(
  runId: string,
  task: string,
  baseCommit: string,
  autoMode: boolean,
  loggingEnabled: boolean = false,
  flow: 'full' | 'light' = 'full',
): HarnessState {
```

Inside the function, compute the phase map in a flow-aware way. Replace the literal `phases: { '1': 'pending', … '7': 'pending' }` block with:

```ts
  const phases: Record<string, PhaseStatus> =
    flow === 'light'
      ? { '1': 'pending', '2': 'skipped', '3': 'skipped', '4': 'skipped',
          '5': 'pending', '6': 'pending', '7': 'pending' }
      : { '1': 'pending', '2': 'pending', '3': 'pending', '4': 'pending',
          '5': 'pending', '6': 'pending', '7': 'pending' };
```

Then, at the end of the returned object literal, add:

```ts
    flow,
    carryoverFeedback: null,
```

Light runs do not produce a plan doc, so also override the plan artifact path when `flow==='light'`:

```ts
  const artifacts = flow === 'light'
    ? {
        spec: `docs/specs/${runId}-design.md`,
        plan: '',
        decisionLog: `.harness/${runId}/decisions.md`,
        checklist: `.harness/${runId}/checklist.json`,
        evalReport: `docs/process/evals/${runId}-eval.md`,
      }
    : {
        spec: `docs/specs/${runId}-design.md`,
        plan: `docs/plans/${runId}.md`,
        decisionLog: `.harness/${runId}/decisions.md`,
        checklist: `.harness/${runId}/checklist.json`,
        evalReport: `docs/process/evals/${runId}-eval.md`,
      };
```

Use `phases` and `artifacts` in the returned object, replacing the inline literals.

Import `PhaseStatus` at the top of `src/state.ts` alongside `HarnessState`:

```ts
import type { HarnessState, PhaseStatus } from './types.js';
```

- [ ] **Step 5: Extend `migrateState` to back-fill the new fields**

In `src/state.ts::migrateState`, append to the existing body (after the `phaseCodexSessions` block around line 108) and before `return raw as HarnessState;`:

```ts
  if (raw.flow !== 'full' && raw.flow !== 'light') {
    raw.flow = 'full';
  }
  if (!('carryoverFeedback' in raw) || raw.carryoverFeedback === undefined) {
    raw.carryoverFeedback = null;
  }
```

Do **not** validate `carryoverFeedback.paths` contents here — Phase 5 assembler will warn + skip if the file is unreadable (spec R8). The migration is a shape guarantee only.

- [ ] **Step 6: Run the new tests**

Run:

```bash
pnpm vitest run tests/state.test.ts -t 'light-flow spec' 2>&1 | tail -20
```

Expected: 5 PASS.

- [ ] **Step 7: Run the full state suite to confirm no regressions**

Run:

```bash
pnpm vitest run tests/state.test.ts tests/state-invalidation.test.ts 2>&1 | tail -20
```

Expected: all green. Previous `phaseCodexSessions` / invalidation tests still pass because we only appended to `createInitialState` and `migrateState`.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/state.ts tests/state.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add flow + carryoverFeedback fields; light skips 2/3/4

- Introduce FlowMode ('full' | 'light') and a new 'skipped' PhaseStatus.
- Add HarnessState.flow + HarnessState.carryoverFeedback (CarryoverFeedback | null).
- createInitialState(flow) initializes phases 2/3/4 to 'skipped' and
  blanks artifacts.plan when flow === 'light'.
- migrateState backfills flow='full' and carryoverFeedback=null on legacy
  state.json files (ADR-7).
EOF
)"
```

---

## Task 2: `getPhaseArtifactFiles` helper + `getReopenTarget` helper

**Files:**
- Modify: `src/config.ts` (after line 63)
- Modify: `src/phases/interactive.ts` (replace `PHASE_ARTIFACT_FILES[phase]` usages at lines 43 and 102)
- Modify: `src/phases/runner.ts` (replace `PHASE_ARTIFACT_FILES[phase]` at line 128; replace `previousInteractivePhase` caller at line 493)
- Modify: `src/resume.ts` (replace the hard-coded artifact keys at lines 480-481)
- Modify: `tests/phases/interactive.test.ts`
- Modify: `tests/phases/runner.test.ts`

- [ ] **Step 1: Write failing tests for the two helpers**

Add to `tests/state.test.ts` (or create `tests/config.test.ts` if preferred — this plan assumes `tests/state.test.ts` because config has no existing test file):

```ts
import { getPhaseArtifactFiles, getReopenTarget } from '../src/config.js';

describe('getPhaseArtifactFiles (ADR-13)', () => {
  it('full + phase 1 → spec + decisionLog', () => {
    expect(getPhaseArtifactFiles('full', 1)).toEqual(['spec', 'decisionLog']);
  });
  it('full + phase 3 → plan + checklist', () => {
    expect(getPhaseArtifactFiles('full', 3)).toEqual(['plan', 'checklist']);
  });
  it('light + phase 1 → spec + decisionLog + checklist', () => {
    expect(getPhaseArtifactFiles('light', 1)).toEqual(['spec', 'decisionLog', 'checklist']);
  });
  it('light + phase 3 → empty (phase is skipped)', () => {
    expect(getPhaseArtifactFiles('light', 3)).toEqual([]);
  });
  it('any flow + phase 5 → empty (no on-disk artifact set)', () => {
    expect(getPhaseArtifactFiles('full', 5)).toEqual([]);
    expect(getPhaseArtifactFiles('light', 5)).toEqual([]);
  });
});

describe('getReopenTarget (ADR-4)', () => {
  it('full + gate 2 → phase 1', () => {
    expect(getReopenTarget('full', 2)).toBe(1);
  });
  it('full + gate 4 → phase 3', () => {
    expect(getReopenTarget('full', 4)).toBe(3);
  });
  it('full + gate 7 → phase 5 (unchanged from current behaviour)', () => {
    expect(getReopenTarget('full', 7)).toBe(5);
  });
  it('light + gate 7 → phase 1 (design combined doc is re-authored)', () => {
    expect(getReopenTarget('light', 7)).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm vitest run tests/state.test.ts -t 'getPhaseArtifactFiles|getReopenTarget' 2>&1 | tail -20
```

Expected: 9 FAIL (symbol not exported).

- [ ] **Step 3: Add the helpers to `src/config.ts`**

Append after the existing `PHASE_ARTIFACT_FILES` constant (after line 63):

```ts
import type { FlowMode, PhaseNumber, Artifacts, GatePhase, InteractivePhase } from './types.js';

export const LIGHT_REQUIRED_PHASE_KEYS = ['1', '5', '7'] as const;

export const LIGHT_PHASE_DEFAULTS: Record<number, string> = {
  1: 'opus-max',
  5: 'sonnet-high',
  7: 'codex-high',
};

export function getRequiredPhaseKeys(flow: FlowMode): readonly string[] {
  return flow === 'light' ? LIGHT_REQUIRED_PHASE_KEYS : REQUIRED_PHASE_KEYS;
}

export function getPhaseDefaults(flow: FlowMode): Record<number, string> {
  return flow === 'light' ? LIGHT_PHASE_DEFAULTS : PHASE_DEFAULTS;
}

export function getPhaseArtifactFiles(
  flow: FlowMode,
  phase: PhaseNumber,
): Array<keyof Artifacts> {
  if (flow === 'light') {
    return phase === 1 ? ['spec', 'decisionLog', 'checklist'] : [];
  }
  if (phase === 1) return ['spec', 'decisionLog'];
  if (phase === 3) return ['plan', 'checklist'];
  return [];
}

export function getReopenTarget(flow: FlowMode, gate: GatePhase): InteractivePhase {
  if (flow === 'light' && gate === 7) return 1;
  if (gate === 2) return 1;
  if (gate === 4) return 3;
  return 5; // gate 7 + full
}
```

(Import `FlowMode`/`PhaseNumber`/`Artifacts`/`GatePhase`/`InteractivePhase` at the top of `config.ts`; the file currently only imports `PendingAction`, so add the other type-only imports next to it.)

- [ ] **Step 4: Re-wire the three call sites**

In `src/phases/interactive.ts`, replace the body of `validatePhaseArtifacts` lines 100-128. Change

```ts
const artifactKeys = PHASE_ARTIFACT_FILES[phase] as (keyof Artifacts)[] | undefined;
if (!artifactKeys) return false;
```

to

```ts
const artifactKeys = getPhaseArtifactFiles(state.flow, phase);
if (artifactKeys.length === 0) return false;
```

Do the same substitution inside `preparePhase` at line 43 and inside `normalizeInteractiveArtifacts` in `src/phases/runner.ts` at line 128. In every case `state.flow` is reachable from the call site.

Update the imports at the top of each file: remove the `PHASE_ARTIFACT_FILES` import (it stays exported for backwards compatibility but is no longer used internally) and add `getPhaseArtifactFiles`.

In `src/resume.ts::completeInteractivePhaseFromFreshSentinel` replace lines 480-481:

```ts
const artifactKeys: Array<'spec' | 'decisionLog' | 'plan' | 'checklist'> =
  phase === 1 ? ['spec', 'decisionLog'] : ['plan', 'checklist'];
```

with

```ts
const artifactKeys = getPhaseArtifactFiles(state.flow, phase);
```

(Same import update — add `getPhaseArtifactFiles` from `./config.js`.)

- [ ] **Step 5: Run the helper tests**

Run:

```bash
pnpm vitest run tests/state.test.ts -t 'getPhaseArtifactFiles|getReopenTarget' 2>&1 | tail -20
```

Expected: 9 PASS.

- [ ] **Step 6: Run every suite that touches the call sites**

Run:

```bash
pnpm vitest run tests/phases/interactive.test.ts tests/phases/runner.test.ts tests/resume.test.ts 2>&1 | tail -30
```

Expected: all green. Existing tests pass the `state` object which defaults to `flow='full'`, so the helper returns the previous artifact sets.

- [ ] **Step 7: Commit**

```bash
git add src/config.ts src/phases/interactive.ts src/phases/runner.ts src/resume.ts tests/state.test.ts
git commit -m "$(cat <<'EOF'
feat(config): add flow-aware getPhaseArtifactFiles + getReopenTarget

Replaces three hard-coded PHASE_ARTIFACT_FILES readers
(interactive.ts, runner.ts, resume.ts) with the single
getPhaseArtifactFiles(flow, phase) helper — required so light + phase 1
can demand a checklist.json alongside the combined design doc
(ADR-13).

getReopenTarget centralises the Gate-N → previous-interactive mapping
so light mode can branch Gate-7 REJECT back to Phase 1 without touching
the full-flow contract.
EOF
)"
```

---

## Task 3: Light Phase 1 init prompt + interactive assembler wiring

**Files:**
- Create: `src/context/prompts/phase-1-light.md`
- Modify: `src/context/assembler.ts::assembleInteractivePrompt` (around line 306-340)
- Modify: `tests/context/assembler.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/context/assembler.test.ts` (near the existing interactive-prompt describe blocks):

```ts
describe('assembleInteractivePrompt — flow-aware Phase 1 (light)', () => {
  it('light + phase 1 renders phase-1-light.md with combined-doc wording', () => {
    const state = makeState({ flow: 'light', phaseAttemptId: { '1': 'aid-light' } });
    const prompt = assembleInteractivePrompt(1, state, '/tmp/harness');
    expect(prompt).toContain('## Implementation Plan');
    expect(prompt).toContain('checklist.json');
    expect(prompt).toContain('결합');
    expect(prompt).toContain('aid-light');
  });

  it('full + phase 1 still renders the classic phase-1.md', () => {
    const state = makeState({ flow: 'full', phaseAttemptId: { '1': 'aid-full' } });
    const prompt = assembleInteractivePrompt(1, state, '/tmp/harness');
    // phase-1.md does NOT mention the plan header; phase-1-light.md does.
    expect(prompt).not.toContain('## Implementation Plan');
    expect(prompt).toContain('## Context & Decisions');
  });

  it('light + phase 5 injects carryoverFeedback paths alongside pendingAction feedback', () => {
    const state = makeState({
      flow: 'light',
      phaseAttemptId: { '5': 'aid-5' },
      pendingAction: {
        type: 'reopen_phase', targetPhase: 5, sourcePhase: 6,
        feedbackPaths: ['.harness/r/verify-feedback.md'],
      },
      carryoverFeedback: {
        sourceGate: 7,
        paths: ['.harness/r/gate-7-feedback.md'],
        deliverToPhase: 5,
      },
    });
    const prompt = assembleInteractivePrompt(5, state, '/tmp/harness');
    expect(prompt).toContain('verify-feedback.md');
    expect(prompt).toContain('gate-7-feedback.md');
  });
});
```

(`makeState` in this test file already accepts arbitrary `HarnessState` overrides — extend it if needed so `flow`, `carryoverFeedback`, and `pendingAction` are accepted.)

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm vitest run tests/context/assembler.test.ts -t 'flow-aware Phase 1' 2>&1 | tail -20
```

Expected: 3 FAIL (template missing, or template identical between flows).

- [ ] **Step 3: Create `src/context/prompts/phase-1-light.md`**

Write the full template file (no placeholders — the harness substitutes `{{…}}` at assembly time). Use the same Mustache-like dialect as `phase-1.md`:

````markdown
다음 파일에서 태스크 설명을 읽고 요구사항을 분석한 뒤 **설계 + 구현 태스크 분해 + 체크리스트**를 하나의 결합 문서에 작성하라:
- Task: {{task_path}}
{{#if feedback_path}}
- 이전 리뷰 피드백 (반드시 반영 — 결합 문서의 관련 섹션을 diff-aware하게 수정하라): {{feedback_path}}
{{/if}}

결합 문서는 "{{spec_path}}" 경로에 작성한다. 아래 섹션을 **순서 그대로** 포함하라:

```
# <title> — Design Spec (Light)
## Context & Decisions
## Requirements / Scope
## Design
## Implementation Plan       (필수 헤더, 정확히 이 텍스트)
  - Task 1: ...
  - Task 2: ...
## Eval Checklist Summary    (checklist.json 요약; 실제 검증 JSON은 별도 파일)
```

`## Implementation Plan` 섹션은 구현 태스크를 각각 1개 이상 체크리스트 아이템(또는 번호 목록)으로 분해하라. 본 섹션이 누락되면 harness는 Phase 1을 실패로 간주한다.

Decision Log는 "{{decisions_path}}" 경로에 별도 파일로 작성하라.

Eval Checklist는 "{{checklist_path}}" 경로에 아래 JSON 스키마로 저장하라:
```json
{
  "checks": [
    { "name": "<검증 항목 이름>", "command": "<실행 커맨드>" }
  ]
}
```
`checks` 배열은 비어있지 않아야 하며 각 항목에 `name`(string)과 `command`(string)이 필수다.

각 check command는 격리된 셸 환경에서 실행된다. venv/node_modules 등 의존성을 요구하는 검증은 절대경로 바이너리(`.venv/bin/python -m pytest`, `./node_modules/.bin/eslint`)나 env-aware 래퍼(`make test`, `pnpm test`)를 사용하라.

작업을 모두 마친 뒤 `.harness/{{runId}}/phase-1.done` 파일을 생성하되 내용으로 '{{phaseAttemptId}}' 한 줄만 기록하라.

**CRITICAL: sentinel 파일(phase-1.done)은 모든 작업(파일 작성, git commit 포함)이 완료된 후 가장 마지막에 생성하라. sentinel 생성 이후 하네스는 다음 단계(impl)로 넘어가므로 추가 작업을 하지 말 것.**

**HARNESS FLOW CONSTRAINT**: 이 세션은 orchestrated harness 라이프사이클(light flow) 내부에서 실행된다. spec-gate와 plan-gate는 이 플로우에서 skip 된다. 다음 phase(구현)은 이 결합 문서를 읽고 바로 코드를 작성하므로:
- `advisor()` 툴을 호출하지 말 것. 외부 리뷰가 Gate 7에서 예약되어 있다.
- 작업 범위는 이 프롬프트가 지시한 산출물(결합 문서 + decisions.md + checklist.json) + 커밋 + sentinel 생성으로 제한한다.
- skill 자동 로드는 허용. 그러나 의사결정을 advisor에 위임하지 말고 자체적으로 결론을 낸다.
````

(Verbatim — no TBDs, no placeholders other than `{{…}}` variables.)

- [ ] **Step 4: Update `assembleInteractivePrompt` to pick the light template**

In `src/context/assembler.ts` at line ~311 (start of `assembleInteractivePrompt`):

```ts
const templateFile = phase === 1 && state.flow === 'light' ? 'phase-1-light.md' : `phase-${phase}.md`;
```

Replace the current `const templateFile = …` line with the above.

Then, inside the same function, extend the `feedbackPaths` construction (around line 320) to merge `state.carryoverFeedback`:

```ts
const carryoverPaths =
  state.carryoverFeedback && state.carryoverFeedback.deliverToPhase === phase
    ? state.carryoverFeedback.paths
    : [];
const pendingPaths = state.pendingAction?.feedbackPaths ?? [];
const feedbackPaths = [...pendingPaths, ...carryoverPaths];
const feedbackPath = feedbackPaths[0];
const feedbackPathsList = feedbackPaths
  .map((p) => `- 이전 피드백 (반드시 반영): ${p}`)
  .join('\n');
```

(Drop the original `const feedbackPaths = state.pendingAction?.feedbackPaths ?? [];` line — replaced above.)

- [ ] **Step 5: Make sure `copy-assets` packages the new prompt file**

Open `scripts/copy-assets.mjs`. The prompts directory is already copied as a whole, so no change should be needed — but read the script to confirm. If it whitelists filenames, extend the whitelist to include `phase-1-light.md`.

- [ ] **Step 6: Run the new tests**

Run:

```bash
pnpm vitest run tests/context/assembler.test.ts -t 'flow-aware Phase 1' 2>&1 | tail -20
```

Expected: 3 PASS.

- [ ] **Step 7: Run the full assembler + interactive suites to confirm no regressions**

Run:

```bash
pnpm vitest run tests/context/assembler.test.ts tests/context/assembler-resume.test.ts tests/phases/interactive.test.ts 2>&1 | tail -30
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/context/prompts/phase-1-light.md src/context/assembler.ts tests/context/assembler.test.ts scripts/copy-assets.mjs
git commit -m "$(cat <<'EOF'
feat(assembler): light Phase 1 combined-doc template + carryoverFeedback merge

- New src/context/prompts/phase-1-light.md: brainstorm + plan + checklist
  instructions in one template; mandates '## Implementation Plan' section.
- assembleInteractivePrompt picks phase-1-light.md when state.flow==='light'
  && phase===1; full flow unchanged.
- Phase 5 assembler merges state.carryoverFeedback.paths into feedback_paths
  when deliverToPhase matches — survives the P7→P1→P5 reopen chain
  (ADR-14).
EOF
)"
```

---

## Task 4: Phase 7 assembler flow-aware (fresh + resume)

**Files:**
- Modify: `src/context/assembler.ts::buildGatePromptPhase7` (lines 274-297)
- Modify: `src/context/assembler.ts::buildResumeSections` (lines 376-402)
- Modify: `tests/context/assembler.test.ts`
- Modify: `tests/context/assembler-resume.test.ts`

- [ ] **Step 1: Write failing tests for both assemblers**

Add to `tests/context/assembler.test.ts`:

```ts
describe('buildGatePromptPhase7 — flow-aware (ADR-12)', () => {
  it('light flow omits the <plan> slot entirely', () => {
    const state = makeLightEvalState();
    const result = assembleGatePrompt(7, state, '/tmp/harness', makeTmpDir());
    if (typeof result !== 'string') throw new Error('expected string');
    expect(result).toContain('<spec>');
    expect(result).toContain('<eval_report>');
    expect(result).not.toContain('<plan>');
  });

  it('full flow still includes the <plan> slot', () => {
    const state = makeFullEvalState();
    const result = assembleGatePrompt(7, state, '/tmp/harness', makeTmpDir());
    if (typeof result !== 'string') throw new Error('expected string');
    expect(result).toContain('<plan>');
  });
});
```

(Add `makeLightEvalState` / `makeFullEvalState` helpers at the top of the test file that build a state with all phases completed and the right artifact fixtures on disk.)

Add to `tests/context/assembler-resume.test.ts`:

```ts
describe('buildResumeSections — Phase 7 flow-aware (ADR-12)', () => {
  it('light + phase 7 resume omits <plan> but keeps <eval_report> + diff + metadata', () => {
    const state = makeLightEvalState();
    const prompt = assembleGateResumePrompt(7, state, makeTmpDir(), 'reject', 'prior feedback');
    if (typeof prompt !== 'string') throw new Error('expected string');
    expect(prompt).toContain('<spec>');
    expect(prompt).toContain('<eval_report>');
    expect(prompt).toContain('<metadata>');
    expect(prompt).not.toContain('<plan>');
  });

  it('full + phase 7 resume still includes <plan>', () => {
    const state = makeFullEvalState();
    const prompt = assembleGateResumePrompt(7, state, makeTmpDir(), 'reject', 'prior feedback');
    if (typeof prompt !== 'string') throw new Error('expected string');
    expect(prompt).toContain('<plan>');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm vitest run tests/context/assembler.test.ts tests/context/assembler-resume.test.ts -t 'flow-aware' 2>&1 | tail -30
```

Expected: 4 FAIL. In particular the light assertions will fail with `expected "<plan>" not to be in result` because current code always injects the plan.

- [ ] **Step 3: Branch `buildGatePromptPhase7` on flow**

In `src/context/assembler.ts`, replace the body of `buildGatePromptPhase7` (lines 274-297) with:

```ts
function buildGatePromptPhase7(state: HarnessState, cwd: string): string | { error: string } {
  const specResult = readArtifactContent(state.artifacts.spec, cwd);
  if ('error' in specResult) return specResult;

  const evalResult = readArtifactContent(state.artifacts.evalReport, cwd);
  if ('error' in evalResult) return evalResult;

  const { diffSection, externalSummary, metadata } = buildPhase7DiffAndMetadata(state, cwd);

  if (state.flow === 'light') {
    return (
      REVIEWER_CONTRACT_BY_GATE[7] +
      buildLifecycleContext(7) +
      `<spec>\n${specResult.content}\n</spec>\n\n` +
      `<eval_report>\n${evalResult.content}\n</eval_report>\n\n` +
      diffSection +
      externalSummary +
      '\n' +
      metadata
    );
  }

  const planResult = readArtifactContent(state.artifacts.plan, cwd);
  if ('error' in planResult) return planResult;

  return (
    REVIEWER_CONTRACT_BY_GATE[7] +
    buildLifecycleContext(7) +
    `<spec>\n${specResult.content}\n</spec>\n\n` +
    `<plan>\n${planResult.content}\n</plan>\n\n` +
    `<eval_report>\n${evalResult.content}\n</eval_report>\n\n` +
    diffSection +
    externalSummary +
    '\n' +
    metadata
  );
}
```

- [ ] **Step 4: Branch `buildResumeSections` on flow**

In `src/context/assembler.ts`, replace `buildResumeSections` (lines 376-402) with:

```ts
function buildResumeSections(
  phase: 2 | 4 | 7,
  state: HarnessState,
  cwd: string,
): string | { error: string } {
  const specResult = readArtifactContent(state.artifacts.spec, cwd);
  if ('error' in specResult) return specResult;
  let body = `<spec>\n${specResult.content}\n</spec>\n`;

  const lightEvalGate = phase === 7 && state.flow === 'light';

  if ((phase === 4 || phase === 7) && !lightEvalGate) {
    const planResult = readArtifactContent(state.artifacts.plan, cwd);
    if ('error' in planResult) return planResult;
    body += `\n<plan>\n${planResult.content}\n</plan>\n`;
  }

  if (phase === 7) {
    const evalResult = readArtifactContent(state.artifacts.evalReport, cwd);
    if ('error' in evalResult) return evalResult;
    body += `\n<eval_report>\n${evalResult.content}\n</eval_report>\n`;

    const { diffSection, externalSummary, metadata } = buildPhase7DiffAndMetadata(state, cwd);
    body += `\n${diffSection}${externalSummary}\n${metadata}`;
  }
  return body;
}
```

- [ ] **Step 5: Run the new tests**

Run:

```bash
pnpm vitest run tests/context/assembler.test.ts tests/context/assembler-resume.test.ts -t 'flow-aware' 2>&1 | tail -30
```

Expected: 4 PASS.

- [ ] **Step 6: Run both full assembler suites**

Run:

```bash
pnpm vitest run tests/context/assembler.test.ts tests/context/assembler-resume.test.ts tests/context/reviewer-contract.test.ts 2>&1 | tail -30
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/context/assembler.ts tests/context/assembler.test.ts tests/context/assembler-resume.test.ts
git commit -m "$(cat <<'EOF'
feat(assembler): omit <plan> on light Gate-7 fresh + resume prompts (ADR-12)

buildGatePromptPhase7 and buildResumeSections now short-circuit the
<plan> slot when state.flow === 'light'. The combined design doc served
via <spec> already contains the Implementation Plan section, so
injecting a blank artifacts.plan would waste prompt budget and (on
resume) fail the size-limit / readArtifactContent path.

Full flow behaviour is unchanged — covered by the two existing 'full'
tests in the same describe blocks.
EOF
)"
```

---

## Task 5: CLI surface — `--light` on `start`/`run`, reject on `resume`

**Files:**
- Modify: `bin/harness.ts` (lines 19-39, 41-47)
- Modify: `src/commands/start.ts` (`StartOptions`, `createInitialState` call)
- Modify: `src/commands/resume.ts` (add a flag rejection path)
- Modify: `tests/commands/run.test.ts`
- Modify: `tests/commands/resume-cmd.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/commands/run.test.ts` (follow the existing invocation pattern at the top of the file — it already spawns the built CLI via `spawnSync`):

```ts
describe('harness start --light', () => {
  it('writes state.json with flow="light" and phases 2/3/4 skipped', () => {
    const repo = createTestRepo();
    try {
      const res = runCli(['start', '--light', 'dummy task'], { cwd: repo.path });
      expect(res.status).toBe(0);
      const runsDir = join(repo.path, '.harness');
      const runId = fs.readdirSync(runsDir).find((n) => n !== 'current-run' && n !== 'repo.lock');
      const statePath = join(runsDir, runId!, 'state.json');
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      expect(state.flow).toBe('light');
      expect(state.phases['2']).toBe('skipped');
      expect(state.phases['3']).toBe('skipped');
      expect(state.phases['4']).toBe('skipped');
    } finally {
      repo.cleanup();
    }
  });
});
```

(Integration tests run the built CLI; Task 0 of this plan already requires `pnpm build`. If this step runs before a build exists, add `pnpm build` to the per-test setup or mark this integration test `skip: process.env.CI || !existsSync(CLI_PATH)` consistent with `tests/integration/lifecycle.test.ts`.)

Add to `tests/commands/resume-cmd.test.ts`:

```ts
describe('harness resume --light (rejected)', () => {
  it('exits non-zero with a flow-frozen message', () => {
    const repo = createTestRepo();
    try {
      // seed a full-flow run first
      const seed = runCli(['start', 'seed task'], { cwd: repo.path });
      expect(seed.status).toBe(0);
      const res = runCli(['resume', '--light'], { cwd: repo.path });
      expect(res.status).not.toBe(0);
      expect(res.stderr).toMatch(/flow is frozen|--light is only valid on start/i);
    } finally {
      repo.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm vitest run tests/commands/run.test.ts tests/commands/resume-cmd.test.ts -t 'light' 2>&1 | tail -20
```

Expected: 2 FAIL (CLI does not yet accept `--light`; resume silently ignores it).

- [ ] **Step 3: Register `--light` on `start`/`run` in `bin/harness.ts`**

Replace lines 20-28 and 30-39 to include the flag:

```ts
program
  .command('start [task]')
  .description('start a new harness session')
  .option('--require-clean', 'block if working tree has any uncommitted changes')
  .option('--auto', 'autonomous mode (no user escalations)')
  .option('--enable-logging', 'enable session logging to ~/.harness/sessions')
  .option('--light', 'use the 4-phase light flow (P1 → P5 → P6 → P7)')
  .action(async (task: string | undefined, opts: { requireClean?: boolean; auto?: boolean; enableLogging?: boolean; light?: boolean }) => {
    const globalOpts = program.opts();
    await startCommand(task, { ...opts, root: globalOpts.root });
  });

program
  .command('run [task]')
  .description('alias for start')
  .option('--require-clean', 'block if working tree has any uncommitted changes')
  .option('--auto', 'autonomous mode (no user escalations)')
  .option('--enable-logging', 'enable session logging to ~/.harness/sessions')
  .option('--light', 'use the 4-phase light flow (P1 → P5 → P6 → P7)')
  .action(async (task: string | undefined, opts: { requireClean?: boolean; auto?: boolean; enableLogging?: boolean; light?: boolean }) => {
    const globalOpts = program.opts();
    await startCommand(task, { ...opts, root: globalOpts.root });
  });
```

Also add a `.option('--light', …)` entry to the `resume` command so commander **captures** the flag; we still reject it at runtime so commander doesn't treat it as an unknown option:

```ts
program
  .command('resume [runId]')
  .description('resume an existing run')
  .option('--light', '(rejected — flow is frozen at run creation)')
  .action(async (runId: string | undefined, opts: { light?: boolean }) => {
    const globalOpts = program.opts();
    await resumeCommand(runId, { ...opts, root: globalOpts.root });
  });
```

- [ ] **Step 4: Propagate `light` in `src/commands/start.ts`**

Extend `StartOptions` (line 14):

```ts
export interface StartOptions {
  requireClean?: boolean;
  auto?: boolean;
  root?: string;
  enableLogging?: boolean;
  light?: boolean;
}
```

At line 105 change the `createInitialState` call to:

```ts
const state = createInitialState(
  runId,
  normalizedTask,
  baseCommit,
  options.auto ?? false,
  options.enableLogging ?? false,
  options.light ? 'light' : 'full',
);
```

- [ ] **Step 5: Reject `--light` in `src/commands/resume.ts`**

Extend `ResumeOptions`:

```ts
export interface ResumeOptions {
  root?: string;
  light?: boolean;
}
```

At the very top of `resumeCommand` (right after the function opening brace at line 18):

```ts
if (options.light) {
  process.stderr.write(
    "Error: --light is only valid on 'harness start'. flow is frozen at run creation; " +
    "start a new run with 'harness start --light' if you want the light flow.\n",
  );
  process.exit(1);
}
```

- [ ] **Step 6: Run the new tests**

Run:

```bash
pnpm build && pnpm vitest run tests/commands/run.test.ts tests/commands/resume-cmd.test.ts -t 'light' 2>&1 | tail -20
```

Expected: 2 PASS.

- [ ] **Step 7: Run the full commands suite**

Run:

```bash
pnpm vitest run tests/commands 2>&1 | tail -20
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add bin/harness.ts src/commands/start.ts src/commands/resume.ts tests/commands/run.test.ts tests/commands/resume-cmd.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): add --light flag on start/run; reject on resume

--light wires StartOptions.light → createInitialState(…, flow='light').
resume explicitly rejects --light with a message pointing users to
'harness start --light' — flow is frozen at run creation (ADR-5/ADR-10).
EOF
)"
```

---

## Task 6: Phase runner flow-aware (skip, reopen target, carryoverFeedback)

**Files:**
- Modify: `src/phases/runner.ts::runPhaseLoop` (lines 176-214), `handleInteractivePhase` (advance-to-next block at line 300-312), `handleGateReject` (line 493-545), `handleGateEscalation` (line 581-599)
- Modify: `tests/phases/runner.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/phases/runner.test.ts` (inside the file's existing top-level `describe`, below the existing Gate 7 reject tests):

```ts
describe('light flow — runPhaseLoop (spec §4 + ADR-1/ADR-4/ADR-14)', () => {
  it('skips phases 2/3/4 and advances from phase 1 directly to phase 5', async () => {
    const runDir = makeTmpDir();
    const state = makeLightState({ currentPhase: 1 });
    const logger = new NoopLogger();

    vi.mocked(runInteractivePhase).mockImplementationOnce(async (_p, st, _h, _r, _c, aid) => {
      st.phases['1'] = 'completed';
      return { status: 'completed', attemptId: aid } as any;
    });
    vi.mocked(runInteractivePhase).mockImplementationOnce(async (_p, st, _h, _r, _c, aid) => {
      st.phases['5'] = 'completed';
      st.implCommit = 'impl';
      return { status: 'completed', attemptId: aid } as any;
    });
    vi.mocked(runVerifyPhase).mockResolvedValueOnce({ type: 'pass' } as any);
    vi.mocked(runGatePhase).mockResolvedValueOnce({
      type: 'verdict', verdict: 'APPROVE', comments: '', rawOutput: '',
      runner: 'codex', durationMs: 1, tokensTotal: 0, promptBytes: 0,
      codexSessionId: 'x', recoveredFromSidecar: false,
      resumedFrom: null, resumeFallback: false,
    } as any);

    await runPhaseLoop(state, HDIR, runDir, CWD, createNoOpInputManager(), logger, { value: false });

    expect(state.phases['2']).toBe('skipped');
    expect(state.phases['3']).toBe('skipped');
    expect(state.phases['4']).toBe('skipped');
    expect(state.status).toBe('completed');
    // handleInteractivePhase must have been invoked for 1 and 5 only
    expect(vi.mocked(runInteractivePhase).mock.calls.map((c) => c[0])).toEqual([1, 5]);
  });

  it('Gate-7 REJECT on light reopens phase 1 and sets carryoverFeedback', async () => {
    const runDir = makeTmpDir();
    const state = makeLightState({
      currentPhase: 7,
      phases: { '1': 'completed', '2': 'skipped', '3': 'skipped', '4': 'skipped',
                '5': 'completed', '6': 'completed', '7': 'pending' },
    });
    const logger = new NoopLogger();

    vi.mocked(runGatePhase).mockResolvedValueOnce({
      type: 'verdict', verdict: 'REJECT', comments: 'design needs rework', rawOutput: '',
      runner: 'codex', durationMs: 1, tokensTotal: 0, promptBytes: 0,
      codexSessionId: 'x', recoveredFromSidecar: false,
      resumedFrom: null, resumeFallback: false,
    } as any);

    await handleGatePhase(7, state, HDIR, runDir, CWD, createNoOpInputManager(), logger, { value: false });

    expect(state.currentPhase).toBe(1);
    expect(state.phases['1']).toBe('pending');
    expect(state.phases['5']).toBe('pending');
    expect(state.phases['6']).toBe('pending');
    expect(state.phaseReopenFlags['1']).toBe(true);
    expect(state.carryoverFeedback).not.toBeNull();
    expect(state.carryoverFeedback?.deliverToPhase).toBe(5);
    expect(state.carryoverFeedback?.sourceGate).toBe(7);
  });

  it('Gate-7 REJECT on full still reopens phase 5 (unchanged)', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 7 });
    const logger = new NoopLogger();

    vi.mocked(runGatePhase).mockResolvedValueOnce({
      type: 'verdict', verdict: 'REJECT', comments: 'impl off-spec', rawOutput: '',
      runner: 'codex', durationMs: 1, tokensTotal: 0, promptBytes: 0,
      codexSessionId: 'x', recoveredFromSidecar: false,
      resumedFrom: null, resumeFallback: false,
    } as any);

    await handleGatePhase(7, state, HDIR, runDir, CWD, createNoOpInputManager(), logger, { value: false });

    expect(state.currentPhase).toBe(5);
    expect(state.phases['5']).toBe('pending');
    expect(state.carryoverFeedback).toBeNull(); // full flow never uses it
  });

  it('Phase 5 completion clears carryoverFeedback', async () => {
    const runDir = makeTmpDir();
    const state = makeLightState({
      currentPhase: 5,
      carryoverFeedback: { sourceGate: 7, paths: ['f'], deliverToPhase: 5 },
    });
    const logger = new NoopLogger();

    vi.mocked(runInteractivePhase).mockResolvedValueOnce({
      status: 'completed', attemptId: 'aid',
    } as any);
    // Make the Phase 5 success path happy by advancing phases.
    vi.mocked(runInteractivePhase).mockImplementationOnce(async (_p, st, _h, _r, _c, aid) => {
      st.phases['5'] = 'completed';
      st.implCommit = 'impl';
      return { status: 'completed', attemptId: aid } as any;
    });

    await handleInteractivePhase(5, state, HDIR, runDir, CWD, logger);

    expect(state.carryoverFeedback).toBeNull();
    expect(state.currentPhase).toBe(6);
  });
});
```

(`makeLightState` is a new helper at the top of the file that calls `createInitialState(…, flow='light')`. Add it next to the existing `makeState`.)

- [ ] **Step 2: Run the new tests to verify they fail**

Run:

```bash
pnpm vitest run tests/phases/runner.test.ts -t 'light flow — runPhaseLoop' 2>&1 | tail -40
```

Expected: 4 FAIL. In particular the skip test will fail because the loop calls `handleInteractivePhase(2)` instead of advancing past it.

- [ ] **Step 3: Teach `runPhaseLoop` to skip `'skipped'` phases**

In `src/phases/runner.ts::runPhaseLoop`, inside the `while` body (around line 186) add a short-circuit before the dispatch tree:

```ts
while (state.currentPhase < TERMINAL_PHASE) {
  const phase = state.currentPhase;

  // §ADR-1 rev-1: a phase left in 'skipped' by createInitialState
  // (light mode only) advances without running its handler.
  if (state.phases[String(phase)] === 'skipped') {
    state.currentPhase = phase + 1;
    writeState(runDir, state);
    continue;
  }

  renderControlPanel(state);
  // … existing body
}
```

- [ ] **Step 4: Use `getReopenTarget(state.flow, phase)` inside `handleGateReject`**

Remove the stand-alone `previousInteractivePhase` helper (or keep it for fallback tests — the plan does not require deletion). Replace the two `previousInteractivePhase(phase)` calls in `handleGateReject` (line 493) and `handleGateEscalation` (line 581) with:

```ts
import { getReopenTarget } from '../config.js';
// …
const targetInteractive = getReopenTarget(state.flow, phase);
```

Also update `handleGateError`'s quit branch (line 688-700) if it references `previousInteractivePhase` — currently it does not (only `handleGateEscalation`), so no change there. (Verify with `grep 'previousInteractivePhase' src/phases/runner.ts` after the edit — it should appear ≤1 times as a local function you can now drop.)

- [ ] **Step 5: Set carryoverFeedback + reset P5/P6 on light Gate-7 REJECT**

In `handleGateReject`, at the reopen branch (after `saveGateFeedback` is called — roughly line 509) add immediately before `const pendingAction: PendingAction = …`:

```ts
if (state.flow === 'light' && phase === 7) {
  state.carryoverFeedback = {
    sourceGate: 7,
    paths: [feedbackPath],
    deliverToPhase: 5,
  };
  // reset downstream phases so impl + verify re-run after the design doc is patched
  state.phases['5'] = 'pending';
  state.phases['6'] = 'pending';
  state.phaseReopenFlags['5'] = true;
  state.phaseReopenSource['5'] = 7;
}
```

Do the equivalent in `handleGateEscalation`'s `choice === 'C'` branch (after `state.gateRetries[String(phase)] = 0;` at line 583):

```ts
if (state.flow === 'light' && phase === 7) {
  state.carryoverFeedback = {
    sourceGate: 7,
    paths: [feedbackPath],
    deliverToPhase: 5,
  };
  state.phases['5'] = 'pending';
  state.phases['6'] = 'pending';
  state.phaseReopenFlags['5'] = true;
  state.phaseReopenSource['5'] = 7;
}
```

- [ ] **Step 6: Clear carryoverFeedback on Phase 5 completion**

In `handleInteractivePhase`, inside the `result.status === 'completed'` block (after `state.pendingAction = null;` at line 296), add:

```ts
if (phase === 5 && state.carryoverFeedback !== null) {
  state.carryoverFeedback = null;
}
```

(Keep it minimal — no logging, no anomaly check; Phase 5 is the sole consumer per ADR-14.)

- [ ] **Step 7: Run the new tests to verify they pass**

Run:

```bash
pnpm vitest run tests/phases/runner.test.ts -t 'light flow — runPhaseLoop' 2>&1 | tail -40
```

Expected: 4 PASS.

- [ ] **Step 8: Run the full runner + gate test suites**

Run:

```bash
pnpm vitest run tests/phases/runner.test.ts tests/phases/gate.test.ts tests/phases/gate-resume.test.ts 2>&1 | tail -40
```

Expected: all green. The existing full-flow Gate 7 REJECT tests continue to expect `state.currentPhase === 5` — `getReopenTarget('full', 7)` returns `5`, so they pass unchanged.

- [ ] **Step 9: Commit**

```bash
git add src/phases/runner.ts tests/phases/runner.test.ts
git commit -m "$(cat <<'EOF'
feat(runner): flow-aware skip + Gate-7 REJECT routing + carryoverFeedback

- runPhaseLoop short-circuits 'skipped' phases so light advances P1→P5
  without touching 2/3/4 handlers.
- handleGateReject / handleGateEscalation resolve the REJECT target via
  getReopenTarget(state.flow, phase); light Gate-7 REJECT → Phase 1.
- On light Gate-7 REJECT, runner records state.carryoverFeedback
  {sourceGate:7, paths:[gate-7-feedback], deliverToPhase:5} and resets
  phases 5+6 so the P1 rewrite cascades into re-impl + re-verify
  (ADR-4 + ADR-14).
- handleInteractivePhase clears state.carryoverFeedback on Phase 5
  success so it is only consumed once.

Full flow behaviour unchanged: getReopenTarget('full', 7) === 5, which
matches the previous previousInteractivePhase() result.
EOF
)"
```

---

## Task 7: UI rendering — `'skipped'` status + flow-aware model selection

**Files:**
- Modify: `src/ui.ts::renderControlPanel` (lines 38-47)
- Modify: `src/ui.ts::renderModelSelection` + `promptModelConfig` (lines 146-214)
- Modify: `src/commands/inner.ts` (lines 152-158 — use `getRequiredPhaseKeys(state.flow)`)
- Modify: `tests/ui.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/ui.test.ts`:

```ts
describe('renderControlPanel — skipped phases', () => {
  it('renders "skipped" as "(skipped)" without success/error glyphs', () => {
    const state = makeState({ flow: 'light' });
    state.phases['2'] = 'skipped';
    state.phases['3'] = 'skipped';
    state.phases['4'] = 'skipped';
    const captured: string[] = [];
    const origErr = console.error;
    console.error = (...args: any[]) => { captured.push(args.join(' ')); };
    try {
      renderControlPanel(state);
    } finally {
      console.error = origErr;
    }
    const transcript = captured.join('\n');
    expect(transcript).toMatch(/Phase 2: .* \(skipped\)/);
    expect(transcript).toMatch(/Phase 3: .* \(skipped\)/);
    expect(transcript).toMatch(/Phase 4: .* \(skipped\)/);
    // no red X next to skipped phases
    expect(transcript).not.toMatch(/✗.*Phase [234]/);
  });
});

describe('renderModelSelection — flow-aware row visibility', () => {
  it('hides spec-gate + plan-gate rows for light', () => {
    const captured: string[] = [];
    const origErr = console.error;
    console.error = (...args: any[]) => { captured.push(args.join(' ')); };
    try {
      renderModelSelection(
        { '1': 'opus-max', '5': 'sonnet-high', '7': 'codex-high' },
        new Set(['1', '5', '7']),
      );
    } finally {
      console.error = origErr;
    }
    const transcript = captured.join('\n');
    expect(transcript).toMatch(/Phase 1 \(Spec 작성\)/);
    expect(transcript).toMatch(/Phase 5 \(구현\)/);
    expect(transcript).toMatch(/Phase 7 \(Eval Gate\)/);
    expect(transcript).not.toMatch(/Phase 2 \(Spec Gate\)/);
    expect(transcript).not.toMatch(/Phase 3 \(Plan 작성\)/);
    expect(transcript).not.toMatch(/Phase 4 \(Plan Gate\)/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm vitest run tests/ui.test.ts -t 'skipped|flow-aware row' 2>&1 | tail -20
```

Expected: 2 FAIL. `'skipped'` currently renders as a blank-space glyph with the raw status string, and `renderModelSelection` always prints all `REQUIRED_PHASE_KEYS` rows.

- [ ] **Step 3: Update `renderControlPanel`**

In `src/ui.ts`, replace the loop at lines 38-47 with:

```ts
for (let p = 1; p <= 7; p++) {
  const status = state.phases[String(p)] ?? 'pending';
  const isSkipped = status === 'skipped';
  const icon = status === 'completed' ? `${GREEN}✓${RESET}`
    : status === 'in_progress' ? `${YELLOW}▶${RESET}`
    : status === 'failed' || status === 'error' ? `${RED}✗${RESET}`
    : isSkipped ? '—'
    : ' ';
  const statusLabel = isSkipped ? '(skipped)' : `(${status})`;
  const current = p === state.currentPhase ? ' ← current' : '';
  console.error(`  [${icon}] Phase ${p}: ${phaseLabel(p)} ${statusLabel}${current}`);
}
```

- [ ] **Step 4: Update `renderModelSelection` to accept an editable set**

`renderModelSelection` already accepts `editablePhases?: Set<string>` (see line 148). Extend the iteration at line 160 to **also** skip rows that are not in the editable set — not merely render a different prefix:

```ts
for (const key of REQUIRED_PHASE_KEYS) {
  const editable = !editablePhases || editablePhases.has(key);
  if (!editable) continue;                              // ← new: hide non-editable rows entirely
  const preset = getPresetById(phasePresets[key]);
  const label = preset?.label ?? 'unknown';
  console.error(`  [${key}] Phase ${key} (${phaseLabels[key]}):  ${label}`);
}
```

This way callers pass only the flow's applicable set (`['1','5','7']` for light).

- [ ] **Step 5: Drive the editable set off `state.flow` in `inner.ts`**

In `src/commands/inner.ts`, extend the Step 5.7 block (lines 152-158):

```ts
import { REQUIRED_PHASE_KEYS, getEffectiveReopenTarget, getRequiredPhaseKeys } from '../config.js';
// …
const flowPhaseKeys = getRequiredPhaseKeys(state.flow);
const remainingSet = new Set<string>();
for (const p of flowPhaseKeys) {
  if (Number(p) >= state.currentPhase && state.phases[p] !== 'completed' && state.phases[p] !== 'skipped') {
    remainingSet.add(p);
  }
}
```

(The `'skipped'` guard is harmless on full flow — phases are never initialized as skipped there.)

- [ ] **Step 6: Run the new UI tests + inner.test.ts**

Run:

```bash
pnpm vitest run tests/ui.test.ts tests/commands/inner.test.ts 2>&1 | tail -20
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/ui.ts src/commands/inner.ts tests/ui.test.ts
git commit -m "$(cat <<'EOF'
feat(ui): render 'skipped' phases + hide non-editable model rows

- renderControlPanel shows 'skipped' phases with an em-dash glyph and
  the label '(skipped)' — no red error glyph (ADR-1 rev-1).
- renderModelSelection now hides rows the caller did not mark editable
  instead of graying them in-place; combined with
  getRequiredPhaseKeys('light') in inner.ts this yields a 3-row config
  screen for light runs (phases 1/5/7 only).
EOF
)"
```

---

## Task 8: End-to-end integration test for light flow

**Files:**
- Create: `tests/integration/light-flow.test.ts`
- Modify (if needed): `tests/helpers/test-repo.ts` (verify it is re-usable as-is)

- [ ] **Step 1: Scaffold the integration test file**

Write the full test file (verbatim — the harness-verify.sh mock lives in `tests/helpers/mock-verify.sh` and is reused by `tests/integration/lifecycle.test.ts`; follow that precedent):

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { HarnessState } from '../../src/types.js';

// Mock runners so we don't spawn real Claude/Codex processes
vi.mock('../../src/runners/claude.js', () => ({
  runClaudeInteractive: vi.fn(),
  runClaudeGate: vi.fn(),
}));
vi.mock('../../src/runners/codex.js', () => ({
  runCodexGate: vi.fn(),
  runCodexInteractive: vi.fn(),
}));

import { runPhaseLoop } from '../../src/phases/runner.js';
import { createInitialState, writeState, readState } from '../../src/state.js';
import { NoopLogger } from '../../src/logger.js';
import { InputManager } from '../../src/input.js';
import { runClaudeInteractive } from '../../src/runners/claude.js';
import { runCodexGate } from '../../src/runners/codex.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'light-flow-int-'));
}

function createNoOpInputManager(): InputManager {
  return new InputManager();
}

describe('light-flow end-to-end (P1 → P5 → P6 → P7)', () => {
  let harnessDir: string;
  let runDir: string;
  let cwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
    harnessDir = path.join(cwd, '.harness');
    const runId = 'r1';
    runDir = path.join(harnessDir, runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.mkdirSync(path.join(cwd, 'docs/specs'), { recursive: true });
    fs.mkdirSync(path.join(cwd, 'docs/process/evals'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('happy path: approves at Gate 7 and reaches TERMINAL_PHASE', async () => {
    const state = createInitialState('r1', 'dummy', 'base-sha', false, false, 'light');
    writeState(runDir, state);

    // Phase 1 (design) — write combined doc + decisions + checklist, then sentinel
    vi.mocked(runClaudeInteractive).mockImplementationOnce(async (phase, st) => {
      fs.writeFileSync(path.join(cwd, st.artifacts.spec),
        '# Design Spec (Light)\n## Context & Decisions\n\n## Implementation Plan\n- Task 1\n');
      fs.writeFileSync(path.join(cwd, st.artifacts.decisionLog), '# Decisions\n');
      fs.writeFileSync(path.join(cwd, st.artifacts.checklist),
        JSON.stringify({ checks: [{ name: 'smoke', command: 'true' }] }));
      fs.writeFileSync(path.join(runDir, 'phase-1.done'), st.phaseAttemptId['1']!);
      return { pid: 0 } as any;
    });

    // Phase 5 (impl) — mark success, create a commit marker file
    vi.mocked(runClaudeInteractive).mockImplementationOnce(async (_p, st) => {
      fs.writeFileSync(path.join(runDir, 'phase-5.done'), st.phaseAttemptId['5']!);
      return { pid: 0 } as any;
    });

    // Gate 7 verdict APPROVE
    vi.mocked(runCodexGate).mockResolvedValueOnce({
      type: 'verdict', verdict: 'APPROVE', comments: '',
      rawOutput: '## Verdict\nAPPROVE\n', codexSessionId: 's',
      sourcePreset: { model: 'gpt-5.4', effort: 'high' },
    } as any);

    // Verify: call the runner but have it resolve as "pass" by providing a passing eval report
    // (Phase 6 uses harness-verify.sh; we mock it by stubbing runVerifyPhase directly)
    // For brevity: mock runVerifyPhase via vi.mock at the top if the E2E surface becomes awkward.

    const logger = new NoopLogger();
    await runPhaseLoop(state, harnessDir, runDir, cwd, createNoOpInputManager(), logger, { value: false });

    const persisted = readState(runDir)!;
    expect(persisted.flow).toBe('light');
    expect(persisted.phases['2']).toBe('skipped');
    expect(persisted.phases['3']).toBe('skipped');
    expect(persisted.phases['4']).toBe('skipped');
    expect(persisted.phases['1']).toBe('completed');
    expect(persisted.phases['5']).toBe('completed');
    expect(persisted.phases['7']).toBe('completed');
    expect(persisted.status).toBe('completed');
  });

  it('Gate-7 REJECT reopens Phase 1 and records carryoverFeedback', async () => {
    const state = createInitialState('r1', 'dummy', 'base-sha', false, false, 'light');
    state.phases['1'] = 'completed';
    state.phases['5'] = 'completed';
    state.phases['6'] = 'completed';
    state.currentPhase = 7;
    writeState(runDir, state);

    vi.mocked(runCodexGate).mockResolvedValueOnce({
      type: 'verdict', verdict: 'REJECT', comments: 'fix design',
      rawOutput: '## Verdict\nREJECT\n## Comments\n- **[P1]** fix\n',
      codexSessionId: 's',
      sourcePreset: { model: 'gpt-5.4', effort: 'high' },
    } as any);

    const logger = new NoopLogger();
    // We only want the gate phase to execute and observe state mutation, so we
    // don't run another full loop iteration. Call handleGatePhase directly:
    const { handleGatePhase } = await import('../../src/phases/runner.js');
    await handleGatePhase(7, state, harnessDir, runDir, cwd, createNoOpInputManager(), logger, { value: false });

    const persisted = readState(runDir)!;
    expect(persisted.currentPhase).toBe(1);
    expect(persisted.phases['1']).toBe('pending');
    expect(persisted.phases['5']).toBe('pending');
    expect(persisted.phases['6']).toBe('pending');
    expect(persisted.phaseReopenFlags['1']).toBe(true);
    expect(persisted.carryoverFeedback).not.toBeNull();
    expect(persisted.carryoverFeedback?.deliverToPhase).toBe(5);
    expect(persisted.carryoverFeedback?.paths[0]).toMatch(/gate-7-feedback\.md$/);
  });
});
```

(Adjust mock surfaces — in particular `runVerifyPhase` — to make the happy-path test actually reach Gate 7 if the above is not sufficient. It is acceptable to also `vi.mock('../../src/phases/verify.js', () => ({ runVerifyPhase: vi.fn().mockResolvedValue({ type: 'pass' }) }))` at the top. Keep the test hermetic: no network, no child processes.)

- [ ] **Step 2: Run the new integration test**

Run:

```bash
pnpm vitest run tests/integration/light-flow.test.ts 2>&1 | tail -40
```

Expected: 2 PASS.

- [ ] **Step 3: Run the full integration suite to confirm no regressions**

Run:

```bash
pnpm vitest run tests/integration 2>&1 | tail -20
```

Expected: all green. The existing `lifecycle.test.ts` and `codex-session-resume.test.ts` suites rely on full flow and must still pass — the mock-surface changes in this file are isolated by `vi.mock` inside the new test file.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/light-flow.test.ts
git commit -m "$(cat <<'EOF'
test(integration): end-to-end light flow — happy path + Gate-7 REJECT

Drives the phase loop with mocked Claude/Codex runners to verify:
- P1 → (2/3/4 skipped) → P5 → P6 → P7 APPROVE reaches TERMINAL_PHASE.
- P7 REJECT reopens P1 with phaseReopenFlags['1']=true and sets
  state.carryoverFeedback with deliverToPhase=5 (ADR-14).
EOF
)"
```

---

## Task 9: Docs update

**Files:**
- Modify: `docs/HOW-IT-WORKS.md`
- Modify: `CLAUDE.md` (project root)

- [ ] **Step 1: Add a Light Flow section to `docs/HOW-IT-WORKS.md`**

Open `docs/HOW-IT-WORKS.md`. Locate the "Full Flow" / "Phases" overview section (grep for `Phase 1` or `7-phase`). Immediately after that section, add a new H2:

````markdown
## Light Flow (`harness start --light`)

For medium tasks (≈1–4h, ≤~500 LoC, ≤3 modules) the default full flow's
three interactive sessions and three Codex gates are overkill. `--light`
selects a 4-phase pipeline:

```
P1 design(=brainstorm+plan) → [P2/P3/P4 skipped] → P5 impl → P6 verify → P7 eval-gate
                                                                                  │
                                       P7 REJECT → P1 reopen (+ carryoverFeedback) ┘
                                                        └─> P5 reopen (carryover 소비) ─> P6 ─> P7
                                       P6 FAIL → P5 reopen (직접)
```

- **state.flow**: `'full' | 'light'`, frozen at run creation. `harness resume --light` is rejected.
- **skipped phases**: `phases['2'|'3'|'4']` initialize to the new `'skipped'` `PhaseStatus`. `runPhaseLoop` short-circuits past them.
- **Phase 1 output**: single combined doc at `docs/specs/<runId>-design.md` containing a mandatory `## Implementation Plan` section. `checklist.json` stays a separate file so `harness-verify.sh` still parses it.
- **Phase 7 REJECT**: routed back to Phase 1 (not Phase 5 — the combined doc is re-authored). `state.carryoverFeedback` survives the P1 completion that clears `pendingAction` and is consumed by P5 on re-entry.
- **Defaults**: P1 = `opus-max`, P5 = `sonnet-high`, P7 = `codex-high`. Same presets as full flow, minus P2/P3/P4.
- **Activation**: `harness start --light "task"` (or `harness run --light …`). `--light` composes with `--auto`.
- **When full flow is still right**: migration/security/contract work, anything wanting independent pre-impl review.
````

If `HOW-IT-WORKS.md` has a Korean twin (`HOW-IT-WORKS.ko.md`), mirror the section.

- [ ] **Step 2: Add a one-paragraph mention to project `CLAUDE.md`**

Open `CLAUDE.md` at the repo root. Inside the "풀 프로세스 호출" section near the bottom, append:

```markdown
경량 4-phase 플로우는 `harness start --light "<task>"` 로 활성화한다. 상세한 동작은
`docs/HOW-IT-WORKS.md`의 "Light Flow" 섹션과 `docs/specs/2026-04-18-light-flow-design.md`를 참조.
```

- [ ] **Step 3: Confirm typecheck still passes (docs can't break it but check anyway)**

Run:

```bash
pnpm tsc --noEmit 2>&1 | tail -5
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add docs/HOW-IT-WORKS.md CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: document --light in HOW-IT-WORKS + project CLAUDE.md

Captures the 4-phase pipeline, REJECT routing to Phase 1, and
carryoverFeedback delivery contract (ADR-4 + ADR-14).
EOF
)"
```

---

## Task 10: Final verification + build + PR

**Files:** none (verification + PR only).

- [ ] **Step 1: Run the full test suite**

Run:

```bash
pnpm vitest run 2>&1 | tail -30
```

Expected: all tests pass. Count should be the Task 0 baseline plus the new tests from Tasks 1/2/3/4/5/6/7/8. If any previously-green test fails, STOP and investigate — our changes rippled.

- [ ] **Step 2: Typecheck**

Run:

```bash
pnpm tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors.

- [ ] **Step 3: Rebuild `dist/`**

Run:

```bash
pnpm build 2>&1 | tail -15
```

Expected: `tsc` + `scripts/copy-assets.mjs` complete. `dist/src/context/prompts/phase-1-light.md` should exist.

Verify:

```bash
ls dist/src/context/prompts/phase-1-light.md
grep -c "Implementation Plan" dist/src/context/prompts/phase-1-light.md
```

Expected: file exists; grep reports `≥1`.

- [ ] **Step 4: Rebase check**

Run:

```bash
git fetch origin main
git log --oneline HEAD..origin/main | cat
```

Expected: empty. If there are new commits on `main` since Task 0, `git rebase origin/main` and re-run Steps 1-3 before opening the PR.

- [ ] **Step 5: Confirm `dist/` stays ignored**

Run:

```bash
git status -s dist/
```

Expected: no output (per `CLAUDE.md` — `dist/` is gitignored).

- [ ] **Step 6: Open the PR**

```bash
git push -u origin <branch-name>
```

Then `gh pr create` with title `feat: light flow (harness start --light)` and a body that includes:
- Summary of the 4-phase pipeline.
- Spec + plan doc paths.
- Note on the `'skipped'` PhaseStatus + `state.flow` + `state.carryoverFeedback` additions.
- Test plan (unit + integration tests added; `497 + N → M` count from Task 0 baseline).
- Reference to PR #10 (spec) and this plan.

---

## TODO — Deferred

Anything that came up during plan-gate review but is not a P1 blocker lands here. This section is populated as the plan gate runs; keep entries short and link to the reviewer comment.

- (none yet — populated by `codex-gate-review --gate plan`.)

---

## Eval Checklist

```json
{
  "checks": [
    { "name": "typecheck", "command": "pnpm tsc --noEmit" },
    { "name": "full test suite", "command": "pnpm vitest run" },
    { "name": "build dist", "command": "pnpm build" },
    { "name": "light-flow integration test", "command": "pnpm vitest run tests/integration/light-flow.test.ts" },
    { "name": "assembler flow branches", "command": "pnpm vitest run tests/context/assembler.test.ts tests/context/assembler-resume.test.ts" },
    { "name": "runner flow branches", "command": "pnpm vitest run tests/phases/runner.test.ts -t 'light flow'" },
    { "name": "state schema migration", "command": "pnpm vitest run tests/state.test.ts -t 'light-flow spec'" },
    { "name": "config helpers", "command": "pnpm vitest run tests/state.test.ts -t 'getPhaseArtifactFiles|getReopenTarget'" },
    { "name": "phase-1-light.md packaged to dist", "command": "test -f dist/src/context/prompts/phase-1-light.md" }
  ]
}
```
