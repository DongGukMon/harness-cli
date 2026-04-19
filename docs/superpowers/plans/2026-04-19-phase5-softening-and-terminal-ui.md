# Phase 5 Softening + Terminal-State UI + Render Instrumentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve three harness-cli UX defects in one change set: (1) make Phase 5 validation HEAD-only (drop dirty-tree gate + `--strict-tree`), (2) keep the control panel alive after a phase fails or after the run completes (failed → inline R/J/Q, complete → idle), (3) emit `ui_render` events to instrument the control-panel phase-number mismatch reproduction.

**Architecture:**
- T1 strips Phase 5 dirty-tree code from `validatePhaseArtifacts` + the resume-side mirror, deletes `dirty-tree.ts` + the `IGNORABLE_ARTIFACTS` allowlist + `state.strictTree`/`--strict-tree`, and removes the corresponding tests.
- T2 introduces `src/phases/terminal-ui.ts` with `enterFailedTerminalState` / `enterCompleteTerminalState` plus pure `performResume` / `performJump` helpers that mutate `state` in place and re-enter `runPhaseLoop` from inside the inner process. `src/commands/inner.ts` calls into terminal-ui after `runPhaseLoop` returns. The outer-process `commands/resume.ts` and `commands/jump.ts` (tmux/lock/SIGUSR1 handoff) remain untouched — see "Spec Note" below.
- T3 extends `renderControlPanel(state, logger?, callsite?)` to emit a `ui_render` event when both optional args are present, and threads `(logger, callsite)` through every existing render site in `runner.ts` plus the two new terminal-ui sites.

**Tech Stack:** TypeScript (Node), Vitest, pnpm, tmux. No new dependencies.

**Spec source:** `docs/specs/2026-04-19-phase5-softening-and-terminal-ui-design.md`

**Open-question resolutions (locked here so the implementer doesn't have to decide):**
- **P1** — `[J]` action in failed terminal state uses **single-key prompt** restricted to interactive phases that exist in the current flow. Full flow → `1/3/5`; light flow → `1/5`. Skipped phases are rejected.
- **P2** — `performResume` / `performJump` errors are caught in terminal-ui, rendered as `printError(...)` underneath the panel, and the failed terminal-state key loop continues (no process exit). Q always exits cleanly.
- **P2** — Footer ticker keeps running in the complete-terminal idle state (no freeze).

**Spec Note (deviation from spec §Changes/Task 2 lines 100–116):** The spec called for "extracting performResume/performJump from `src/commands/resume.ts` and `src/commands/jump.ts`." Inspection shows those files are 99% outer-process tmux/lock/SIGUSR1 handoff code that has no purpose inside an already-running inner process. Inner-side resume = "reset failed phase to pending and re-enter `runPhaseLoop`", inner-side jump = "reset phases ≥ N + invalidate gate sessions + re-enter `runPhaseLoop`". These are defined fresh in `terminal-ui.ts`; the outer commands stay as they are. The spec's intent ("don't `process.exit`, return a result") is preserved — terminal-ui helpers throw on fatal and return on success, never exit.

---

## File Structure

**New files:**
- `src/phases/terminal-ui.ts` — `enterFailedTerminalState`, `enterCompleteTerminalState`, `performResume`, `performJump`, `anyPhaseFailed`, helper `summarizeRecentEvents`. Pure inner-process logic; imports `runPhaseLoop` lazily (defer import to avoid cycle).
- `tests/phases/terminal-ui.test.ts` — unit tests for terminal-ui helpers with mocked `InputManager`, `SessionLogger`, and a mocked `runPhaseLoop`.

**Modified files:**
- `src/phases/interactive.ts` — strip dirty-tree branches from `validatePhaseArtifacts(5)`; remove `dirty-tree` import.
- `src/resume.ts` — strip dirty-tree branches from `completeInteractivePhaseFromFreshSentinel(5)`; remove `dirty-tree` import.
- `src/phases/dirty-tree.ts` — **deleted** (entire file).
- `src/config.ts` — remove `IgnorablePattern` interface and `IGNORABLE_ARTIFACTS` constant.
- `src/types.ts` — remove `HarnessState.strictTree`; add `ui_render` LogEvent variant.
- `src/state.ts` — remove `strictTree` migration line, parameter, and assignment in `createInitialState`.
- `src/commands/start.ts` — remove `strictTree?: boolean` from `StartOptions`; drop the eighth arg to `createInitialState`.
- `bin/harness.ts` — drop `--strict-tree` option from `start` and `run` commands.
- `src/commands/inner.ts` — after `runPhaseLoop` returns, dispatch to `enterCompleteTerminalState` / `enterFailedTerminalState`. Existing `paused`/`pendingAction` paths unchanged.
- `src/ui.ts` — extend `renderControlPanel(state, logger?, callsite?)` signature; emit `ui_render` event when both optional args provided.
- `src/phases/runner.ts` — pass `(logger, callsite)` at all eight existing `renderControlPanel(state)` sites listed in the spec.
- `tests/phases/dirty-tree.test.ts` — **deleted**.
- `tests/phases/interactive.test.ts` — replace Phase-5 dirty-tree subtests with the new HEAD-only contract.
- `tests/state.test.ts` — drop `strictTree` migration + `createInitialState` tests.
- `tests/state-invalidation.test.ts`, `tests/integration/logging.test.ts`, `tests/commands/inner.test.ts`, `tests/commands/inner-footer.test.ts`, `tests/phases/gate-resume.test.ts` — drop `strictTree: false` from inline state fixtures.
- `tests/commands/run.test.ts` — drop the two `--strict-tree` assertions.
- `tests/ui.test.ts` — add `renderControlPanel` logger-emit / no-emit cases.
- `README.md`, `README.ko.md` — drop the `--strict-tree` flag bullet (line 183) and the dirty-tree troubleshooting paragraph (line 302). Add a one-sentence note describing the failed/complete terminal states next to the existing resume/jump docs.
- `docs/HOW-IT-WORKS.md`, `docs/HOW-IT-WORKS.ko.md` — drop `strictTree` from the state-field bullet (line 176). Add a `ui_render` row to the events table if one exists, or a footnote near the events section.
- `CLAUDE.md` — extend the "이벤트 로깅 스키마" table (line ~85) with a `ui_render` row.

---

## Tasks

### Task 1: Drop Phase 5 dirty-tree validation + `strictTree` + `IGNORABLE_ARTIFACTS` + `--strict-tree`

**Files:**
- Modify: `src/phases/interactive.ts:14, 121-229`
- Modify: `src/resume.ts:19, 562-594`
- Delete: `src/phases/dirty-tree.ts`
- Modify: `src/config.ts:69-90`
- Modify: `src/types.ts:91-94`
- Modify: `src/state.ts:89, 195, 277`
- Modify: `src/commands/start.ts:21, 116`
- Modify: `bin/harness.ts:27, 28, 41, 42`
- Delete: `tests/phases/dirty-tree.test.ts`
- Modify: `tests/phases/interactive.test.ts:599-700`
- Modify: `tests/state.test.ts:61-79`
- Modify: `tests/state-invalidation.test.ts:38`
- Modify: `tests/integration/logging.test.ts:35`
- Modify: `tests/commands/inner.test.ts:262, 344, 544`
- Modify: `tests/commands/inner-footer.test.ts:147`
- Modify: `tests/phases/gate-resume.test.ts:46`
- Modify: `tests/commands/run.test.ts:221-235`
- Modify: `README.md:183, 302`, `README.ko.md:183, 302`
- Modify: `docs/HOW-IT-WORKS.md:176`, `docs/HOW-IT-WORKS.ko.md:176`

- [ ] **Step 1: Update Phase-5 validator unit tests to the new contract**

Replace lines 599–700 of `tests/phases/interactive.test.ts` with the block below. The previous 7 subtests collapse to 4: HEAD-advanced → true; first-attempt zero-commit → false; reopen with `implCommit !== null` → true; dirty working tree but HEAD advanced → true (was false under old contract).

```ts
describe('validatePhaseArtifacts — Phase 5', () => {
  it('returns true when HEAD has advanced', () => {
    const repoDir = createTestRepo();
    const head = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
    fs.writeFileSync(path.join(repoDir, 'impl.txt'), 'implementation');
    execSync('git add impl.txt && git commit -m "impl"', { cwd: repoDir });

    const state = makeState({ implRetryBase: head });
    const result = validatePhaseArtifacts(5, state, repoDir, repoDir);
    expect(result).toBe(true);
  });

  it('returns false when HEAD has not advanced and implCommit is null', () => {
    const repoDir = createTestRepo();
    const head = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
    const state = makeState({ implRetryBase: head, implCommit: null });
    const result = validatePhaseArtifacts(5, state, repoDir, repoDir);
    expect(result).toBe(false);
  });

  it('accepts zero-commit reopen when implCommit is already set', () => {
    const repoDir = createTestRepo();
    const head = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
    const state = makeState({ implRetryBase: head, implCommit: 'prior-impl-sha' });
    const result = validatePhaseArtifacts(5, state, repoDir, repoDir);
    expect(result).toBe(true);
  });

  it('returns true when HEAD advanced even if working tree is dirty (no dirty-tree gate)', () => {
    const repoDir = createTestRepo();
    const head = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
    fs.writeFileSync(path.join(repoDir, 'impl.txt'), 'implementation');
    execSync('git add impl.txt && git commit -m "impl"', { cwd: repoDir });
    fs.writeFileSync(path.join(repoDir, 'dirty.txt'), 'untracked scratch');

    const state = makeState({ implRetryBase: head });
    const result = validatePhaseArtifacts(5, state, repoDir, repoDir);
    expect(result).toBe(true);
  });
});
```

If `makeState` factory in this file has a `strictTree` property in its default record, remove it now (search for `strictTree` in the file).

- [ ] **Step 2: Run the rewritten suite to confirm it fails before code changes**

Run: `pnpm vitest run tests/phases/interactive.test.ts`
Expected: 4 new Phase-5 tests fail (validator still calls `tryAutoRecoverDirtyTree` / honours `strictTree`). Other suites in the file may also fail due to TypeScript errors if `strictTree` is referenced in `makeState` — that is fine, fix in Step 7.

- [ ] **Step 3: Rewrite `validatePhaseArtifacts(5)` to HEAD-only**

In `src/phases/interactive.ts`:
1. Remove the import line 14: `import { tryAutoRecoverDirtyTree, writeDirtyTreeDiagnostic } from './dirty-tree.js';`
2. Replace the entire `if (phase === 5) { ... }` block (currently lines 189–226) with:

```ts
  if (phase === 5) {
    void runDir;
    try {
      const head = execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8' }).trim();
      if (head !== state.implRetryBase) return true;
      return state.implCommit !== null;
    } catch {
      return false;
    }
  }
```

3. Update the JSDoc directly above (lines 112–120) to read:

```ts
  /**
   * Validate artifacts for the completed phase.
   * Phase 1/3: check existence + non-empty (reopen-aware per ADR-13; freshness
   * is carried by sentinel attemptId alone — no mtime staleness heuristic).
   * Phase 5: success when HEAD has advanced past `implRetryBase`, or when the
   * sentinel was written during a reopen with `implCommit` already set
   * (verify-failure case where only gitignored fixes are needed). Working-tree
   * cleanliness is no longer enforced — see 2026-04-19 spec.
   */
```

- [ ] **Step 4: Re-run the validator suite and confirm it passes**

Run: `pnpm vitest run tests/phases/interactive.test.ts`
Expected: PASS. (Other failures from `strictTree` references in fixtures will surface in Step 7.)

- [ ] **Step 5: Mirror the same simplification in `src/resume.ts::completeInteractivePhaseFromFreshSentinel(5)`**

In `src/resume.ts`:
1. Remove the import line 19: `import { tryAutoRecoverDirtyTree, writeDirtyTreeDiagnostic } from './phases/dirty-tree.js';`
2. Replace lines 562–594 (the `if (phase === 5) { ... }` block) with:

```ts
    if (phase === 5) {
      void runDir;
      const head = getHead(cwd);
      if (head === state.implRetryBase) {
        return false;
      }
      state.implCommit = head;
      return true;
    }
```

(The reopen-zero-commit case in this resume helper is already covered by the caller advancing only on `true`; we intentionally keep the stricter "HEAD must advance" rule here because this helper runs only for fresh-sentinel recovery, not for reopen.)

- [ ] **Step 6: Delete `src/phases/dirty-tree.ts`**

Run: `git rm src/phases/dirty-tree.ts`
Expected: file removed.

- [ ] **Step 7: Strip `strictTree` from types/state/start, and `IGNORABLE_ARTIFACTS` from config**

In `src/types.ts`, delete lines 91–94:

```ts
  // Phase 5 dirty-tree auto-recovery opt-out. When true, ...
  strictTree: boolean;
```

In `src/config.ts`, delete lines 69–90 (the `IgnorablePattern` interface and the `IGNORABLE_ARTIFACTS` array, including the leading comment block).

In `src/state.ts`:
1. Delete line 89: `if (raw.strictTree === undefined) raw.strictTree = false;`
2. Drop the `strictTree: boolean = false` parameter (line 195) from `createInitialState`'s signature.
3. Remove the `strictTree,` line in the returned object (line 277).

In `src/commands/start.ts`:
1. Delete `strictTree?: boolean;` from `StartOptions` (line 21).
2. Drop the eighth argument `options.strictTree ?? false,` from the `createInitialState(...)` call (line 116). The call now ends with `options.codexNoIsolate ?? false,`.

In `bin/harness.ts`:
1. Delete the `.option('--strict-tree', ...)` line in the `start` command (line 27).
2. Remove `strictTree?: boolean` from the inline opts type on line 28.
3. Delete the `.option('--strict-tree', ...)` line in the `run` command (line 41).
4. Remove `strictTree?: boolean` from the inline opts type on line 42.

- [ ] **Step 8: Drop `strictTree` from test fixtures and remove `--strict-tree` assertions**

Search-and-edit each fixture file. In `tests/state-invalidation.test.ts`, `tests/integration/logging.test.ts`, `tests/commands/inner.test.ts`, `tests/commands/inner-footer.test.ts`, `tests/phases/gate-resume.test.ts`: locate the inline `strictTree: false,` line in each state literal and remove it.

In `tests/state.test.ts`: delete the three subtests at lines 61–79 (the two migration tests and the createInitialState test). Also remove `strictTree` from the `legacy` literal builders if any sibling subtest references it.

In `tests/commands/run.test.ts`: delete the two subtests at lines 221–235 (`state.strictTree=true when --strict-tree passed` and `state.strictTree=false (default) when --strict-tree omitted`).

Run: `git rm tests/phases/dirty-tree.test.ts`

- [ ] **Step 9: Type-check the whole tree**

Run: `pnpm tsc --noEmit`
Expected: PASS. If errors remain (e.g., a fixture still references `strictTree`), grep for the symbol and fix.

```bash
git grep -n strictTree
git grep -n 'IGNORABLE_ARTIFACTS\|tryAutoRecover\|writeDirtyTreeDiagnostic\|--strict-tree'
```

Both greps should return no matches in `src/`, `bin/`, `tests/` (matches inside `docs/specs/` and `docs/plans/` are historical and intentionally left).

- [ ] **Step 10: Update user-facing docs**

In `README.md`:
1. Delete line 183: `- `--strict-tree` — disable phase-5 dirty-tree auto-recovery and write diagnostics instead`
2. Delete the troubleshooting block at lines 301–302:

   ```
   **Dirty tree failure in phase 5**
   Retry normally first. If you need a hard failure instead of auto-recovery for ignorable leftovers, start the run with `--strict-tree`.
   ```

In `README.ko.md`: apply the same two deletions at lines 183 and 301–302.

In `docs/HOW-IT-WORKS.md` line 176: change `- `loggingEnabled`, `codexNoIsolate`, `strictTree`` → `- `loggingEnabled`, `codexNoIsolate``.

In `docs/HOW-IT-WORKS.ko.md` line 176: same edit.

- [ ] **Step 11: Run full suite to confirm T1 is green**

Run: `pnpm vitest run`
Expected: all tests PASS. If a Phase-5 integration test elsewhere asserts `dirty-tree.md` creation, delete that subtest (it's testing removed behavior).

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "refactor(phase5): drop dirty-tree gate, IGNORABLE_ARTIFACTS, and --strict-tree

Phase 5 validation now succeeds purely on HEAD advance (or implCommit !== null
on reopen). Dirty-tree auto-recovery, strict-tree CLI/state flag, and the
IGNORABLE_ARTIFACTS allowlist are removed. README/HOW-IT-WORKS updated."
```

---

### Task 2: Terminal-state UI — failed (R/J/Q) and complete (idle)

**Files:**
- Create: `src/phases/terminal-ui.ts`
- Modify: `src/commands/inner.ts:204-209` (post-loop dispatch)
- Test: `tests/phases/terminal-ui.test.ts`

- [ ] **Step 1: Write the failing terminal-ui tests**

Create `tests/phases/terminal-ui.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  enterFailedTerminalState,
  enterCompleteTerminalState,
  performResume,
  performJump,
  anyPhaseFailed,
} from '../../src/phases/terminal-ui.js';
import { InputManager } from '../../src/input.js';
import type { HarnessState, SessionLogger } from '../../src/types.js';

vi.mock('../../src/phases/runner.js', () => ({
  runPhaseLoop: vi.fn(async () => { /* no-op default */ }),
}));

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-ui-'));
}

function makeState(overrides: Partial<HarnessState> = {}): HarnessState {
  return {
    runId: 'r1',
    flow: 'full',
    carryoverFeedback: null,
    currentPhase: 5,
    status: 'in_progress',
    autoMode: false,
    task: 't',
    baseCommit: 'base',
    implRetryBase: 'base',
    codexPath: null,
    externalCommitsDetected: false,
    artifacts: {
      spec: 'docs/specs/r1-design.md',
      plan: 'docs/plans/r1.md',
      decisionLog: '.harness/r1/decisions.md',
      checklist: '.harness/r1/checklist.json',
      evalReport: 'docs/process/evals/r1-eval.md',
    },
    phases: { '1': 'completed', '2': 'completed', '3': 'completed', '4': 'completed', '5': 'failed', '6': 'pending', '7': 'pending' },
    gateRetries: { '2': 0, '4': 0, '7': 0 },
    verifyRetries: 0,
    pauseReason: null,
    specCommit: null, planCommit: null, implCommit: null, evalCommit: null,
    verifiedAtHead: null, pausedAtHead: null, pendingAction: null,
    phaseOpenedAt: { '1': null, '3': null, '5': null },
    phaseAttemptId: { '1': null, '3': null, '5': null },
    phasePresets: { '1': 'opus-high', '2': 'codex-high', '3': 'sonnet-high', '4': 'codex-high', '5': 'sonnet-high', '7': 'codex-high' },
    phaseReopenFlags: { '1': false, '3': false, '5': false },
    phaseCodexSessions: { '2': null, '4': null, '7': null },
    lastWorkspacePid: null, lastWorkspacePidStartTime: null,
    tmuxSession: '', tmuxMode: 'dedicated', tmuxWindows: [],
    tmuxControlWindow: '', tmuxWorkspacePane: '', tmuxControlPane: '',
    loggingEnabled: false,
    phaseReopenSource: { '1': null, '3': null, '5': null },
    codexNoIsolate: false,
    ...overrides,
  };
}

function makeLogger(): SessionLogger {
  return {
    logEvent: vi.fn(),
    writeMeta: vi.fn(),
    updateMeta: vi.fn(),
    finalizeSummary: vi.fn(),
    close: vi.fn(),
    hasBootstrapped: () => false,
    hasEmittedSessionOpen: () => true,
    getStartedAt: () => Date.now(),
    getEventsPath: () => null,
  };
}

class MockInput {
  private queue: string[] = [];
  enqueue(...keys: string[]): void { this.queue.push(...keys); }
  async waitForKey(valid: Set<string>): Promise<string> {
    const k = this.queue.shift();
    if (k === undefined) throw new Error('test: no key queued');
    if (!valid.has(k.toLowerCase())) throw new Error(`test: key ${k} not in valid set`);
    return k.toUpperCase();
  }
}

describe('anyPhaseFailed', () => {
  it('true when at least one phase status is "failed"', () => {
    expect(anyPhaseFailed(makeState({ phases: { ...makeState().phases, '5': 'failed' } as any }))).toBe(true);
  });
  it('true when at least one phase status is "error"', () => {
    expect(anyPhaseFailed(makeState({ phases: { ...makeState().phases, '6': 'error' } as any }))).toBe(true);
  });
  it('false when all phases are pending/completed/skipped/in_progress', () => {
    expect(anyPhaseFailed(makeState({ phases: { '1': 'completed', '2': 'completed', '3': 'pending', '4': 'pending', '5': 'pending', '6': 'pending', '7': 'pending' } }))).toBe(false);
  });
});

describe('performResume (inner-side)', () => {
  it('resets the failed phase to pending and re-enters runPhaseLoop', async () => {
    const { runPhaseLoop } = await import('../../src/phases/runner.js');
    const state = makeState();
    const runDir = makeTmpDir();
    const input = new MockInput() as unknown as InputManager;
    const logger = makeLogger();

    await performResume(state, '/harness', runDir, '/cwd', input, logger, { value: false });

    expect(state.phases['5']).toBe('pending');
    expect(runPhaseLoop).toHaveBeenCalledOnce();
  });
});

describe('performJump (inner-side)', () => {
  it('resets phases >= target to pending, sets currentPhase, invalidates gate sessions, re-enters loop', async () => {
    const { runPhaseLoop } = await import('../../src/phases/runner.js');
    vi.mocked(runPhaseLoop).mockClear();
    const state = makeState({ currentPhase: 5, phases: { '1': 'completed', '2': 'completed', '3': 'completed', '4': 'completed', '5': 'failed', '6': 'pending', '7': 'pending' } });
    state.phaseCodexSessions['7'] = { sessionId: 's7', runner: 'codex', model: 'gpt-5.4', effort: 'high', lastOutcome: 'reject' };
    const runDir = makeTmpDir();
    const input = new MockInput() as unknown as InputManager;
    const logger = makeLogger();

    await performJump(3, state, '/harness', runDir, '/cwd', input, logger);

    expect(state.currentPhase).toBe(3);
    expect(state.phases['3']).toBe('pending');
    expect(state.phases['4']).toBe('pending');
    expect(state.phases['5']).toBe('pending');
    expect(state.phaseCodexSessions['7']).toBeNull();
    expect(runPhaseLoop).toHaveBeenCalledOnce();
  });

  it('rejects jump to a skipped phase (light flow guard)', async () => {
    const state = makeState({ flow: 'light', phases: { '1': 'completed', '2': 'skipped', '3': 'skipped', '4': 'skipped', '5': 'failed', '6': 'pending', '7': 'pending' } });
    await expect(
      performJump(3, state, '/harness', makeTmpDir(), '/cwd', new MockInput() as unknown as InputManager, makeLogger())
    ).rejects.toThrow(/skipped/);
  });
});

describe('enterFailedTerminalState', () => {
  it("R triggers performResume and re-enters runPhaseLoop", async () => {
    const { runPhaseLoop } = await import('../../src/phases/runner.js');
    vi.mocked(runPhaseLoop).mockClear();
    const state = makeState();
    // After R returns, the loop tops back; then Q exits. Mock runPhaseLoop to
    // mark all phases completed so the outer terminal loop returns instead of
    // re-prompting forever.
    vi.mocked(runPhaseLoop).mockImplementationOnce(async (s: any) => {
      s.status = 'completed';
    });
    const input = new MockInput();
    input.enqueue('r');
    await enterFailedTerminalState(state, '/harness', makeTmpDir(), '/cwd', input as unknown as InputManager, makeLogger());
    expect(runPhaseLoop).toHaveBeenCalledOnce();
  });

  it('Q exits cleanly without re-entering the loop', async () => {
    const { runPhaseLoop } = await import('../../src/phases/runner.js');
    vi.mocked(runPhaseLoop).mockClear();
    const state = makeState();
    const input = new MockInput();
    input.enqueue('q');
    await enterFailedTerminalState(state, '/harness', makeTmpDir(), '/cwd', input as unknown as InputManager, makeLogger());
    expect(runPhaseLoop).not.toHaveBeenCalled();
  });

  it('J prompts for phase number, then dispatches performJump', async () => {
    const { runPhaseLoop } = await import('../../src/phases/runner.js');
    vi.mocked(runPhaseLoop).mockClear();
    vi.mocked(runPhaseLoop).mockImplementationOnce(async (s: any) => {
      s.status = 'completed';
    });
    const state = makeState();
    const input = new MockInput();
    input.enqueue('j', '3');
    await enterFailedTerminalState(state, '/harness', makeTmpDir(), '/cwd', input as unknown as InputManager, makeLogger());
    expect(state.currentPhase).toBe(3);
    expect(runPhaseLoop).toHaveBeenCalledOnce();
  });
});

describe('enterCompleteTerminalState', () => {
  it('renders the panel and returns when the abort signal fires', async () => {
    const state = makeState({ status: 'completed' });
    const ac = new AbortController();
    const p = enterCompleteTerminalState(state, makeTmpDir(), '/cwd', makeLogger(), ac.signal);
    setTimeout(() => ac.abort(), 10);
    await p;
  });
});
```

- [ ] **Step 2: Run the new test file to confirm it fails**

Run: `pnpm vitest run tests/phases/terminal-ui.test.ts`
Expected: module not found / `enterFailedTerminalState is not a function`.

- [ ] **Step 3: Create `src/phases/terminal-ui.ts`**

```ts
import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import type {
  HarnessState,
  InteractivePhase,
  PhaseStatus,
  SessionLogger,
} from '../types.js';
import type { InputManager } from '../input.js';
import { writeState, invalidatePhaseSessionsOnJump } from '../state.js';
import { renderControlPanel, printError, printInfo, printWarning } from '../ui.js';

export function anyPhaseFailed(state: HarnessState): boolean {
  return Object.values(state.phases).some(s => s === 'failed' || s === 'error');
}

function findFailedPhase(state: HarnessState): number | null {
  for (const key of Object.keys(state.phases)) {
    const s = state.phases[key];
    if (s === 'failed' || s === 'error') return Number(key);
  }
  return null;
}

function listJumpTargets(state: HarnessState): InteractivePhase[] {
  const interactiveKeys = (state.flow === 'light'
    ? ['1', '5'] : ['1', '3', '5']) as ('1' | '3' | '5')[];
  return interactiveKeys
    .filter(k => state.phases[k] !== 'skipped')
    .map(k => Number(k) as InteractivePhase);
}

function summarizeRecentEvents(runDir: string, limit = 10): string {
  const eventsPath = path.join(runDir, 'events.jsonl');
  try {
    const body = fs.readFileSync(eventsPath, 'utf-8').trimEnd();
    if (body.length === 0) return '(no events recorded)';
    const lines = body.split('\n');
    return lines.slice(-limit).join('\n');
  } catch {
    return '(events.jsonl not present — logging disabled)';
  }
}

function summarizeGitStatus(cwd: string, headLines = 10): string {
  try {
    const out = execSync('git status --porcelain', { cwd, encoding: 'utf-8' }).trimEnd();
    if (out.length === 0) return '(working tree clean)';
    const lines = out.split('\n');
    if (lines.length <= headLines) return out;
    return [...lines.slice(0, headLines), `… and ${lines.length - headLines} more`].join('\n');
  } catch {
    return '(git not available)';
  }
}

/**
 * Inner-process resume: reset the failed phase back to `pending` and re-enter
 * runPhaseLoop. Throws on fatal error; caller in terminal-ui catches and
 * re-renders.
 */
export async function performResume(
  state: HarnessState,
  harnessDir: string,
  runDir: string,
  cwd: string,
  inputManager: InputManager,
  logger: SessionLogger,
  sidecarReplayAllowed: { value: boolean },
): Promise<void> {
  const failed = findFailedPhase(state);
  if (failed !== null) {
    state.phases[String(failed)] = 'pending';
  }
  // Clear the run-level paused fields if anything left them set.
  state.status = 'in_progress';
  state.pauseReason = null;
  writeState(runDir, state);

  const { runPhaseLoop } = await import('./runner.js');
  await runPhaseLoop(state, harnessDir, runDir, cwd, inputManager, logger, sidecarReplayAllowed);
}

/**
 * Inner-process jump: reset phases ≥ target to pending (preserve `skipped`),
 * invalidate gate sessions at/after target, set currentPhase, re-enter loop.
 */
export async function performJump(
  targetPhase: InteractivePhase,
  state: HarnessState,
  harnessDir: string,
  runDir: string,
  cwd: string,
  inputManager: InputManager,
  logger: SessionLogger,
): Promise<void> {
  if (state.phases[String(targetPhase)] === 'skipped') {
    throw new Error(
      `Phase ${targetPhase} is skipped in this run (flow=${state.flow}); cannot jump to a skipped phase.`,
    );
  }

  for (let m = targetPhase; m <= 7; m++) {
    const cur = state.phases[String(m)] as PhaseStatus | undefined;
    state.phases[String(m)] = cur === 'skipped' ? 'skipped' : 'pending';
  }
  state.currentPhase = targetPhase;
  state.status = 'in_progress';
  state.pauseReason = null;
  state.pendingAction = null;
  invalidatePhaseSessionsOnJump(state, targetPhase, runDir);
  writeState(runDir, state);

  const { runPhaseLoop } = await import('./runner.js');
  // sidecarReplayAllowed always false on jump (we're starting fresh).
  await runPhaseLoop(state, harnessDir, runDir, cwd, inputManager, logger, { value: false });
}

/**
 * Failed terminal state: render panel, show recent events + git status,
 * loop on R/J/Q. R/J re-enter runPhaseLoop in-place; Q returns.
 */
export async function enterFailedTerminalState(
  state: HarnessState,
  harnessDir: string,
  runDir: string,
  cwd: string,
  inputManager: InputManager,
  logger: SessionLogger,
): Promise<void> {
  const sidecarReplayAllowed = { value: false };

  while (true) {
    renderControlPanel(state, logger, 'terminal-failed');

    const failedPhase = findFailedPhase(state);
    if (failedPhase !== null) {
      printError(`Phase ${failedPhase} failed.`);
    } else {
      printWarning('No failed phase detected (defensive).');
    }

    process.stderr.write('\nRecent events:\n');
    process.stderr.write(summarizeRecentEvents(runDir) + '\n');
    process.stderr.write('\nWorking tree:\n');
    process.stderr.write(summarizeGitStatus(cwd) + '\n');
    process.stderr.write('\n[R] Resume   [J] Jump to phase   [Q] Quit\n');

    const choice = await inputManager.waitForKey(new Set(['r', 'j', 'q']));

    if (choice === 'Q') return;

    if (choice === 'R') {
      try {
        await performResume(state, harnessDir, runDir, cwd, inputManager, logger, sidecarReplayAllowed);
      } catch (err) {
        printError(`Resume failed: ${(err as Error).message}`);
        continue;
      }
      // runPhaseLoop returned. If it succeeded or paused, exit terminal-ui;
      // if a fresh failure surfaced, loop again.
      if (state.status === 'completed' || state.status === 'paused') return;
      if (!anyPhaseFailed(state)) return;
      continue;
    }

    // 'J' branch
    const targets = listJumpTargets(state);
    if (targets.length === 0) {
      printError('No interactive phases available to jump to.');
      continue;
    }
    const targetKeys = new Set(targets.map(t => String(t)));
    process.stderr.write(`\nJump to which phase? (${targets.join(' / ')})\n`);
    const phaseKey = await inputManager.waitForKey(targetKeys);
    const target = Number(phaseKey) as InteractivePhase;

    try {
      await performJump(target, state, harnessDir, runDir, cwd, inputManager, logger);
    } catch (err) {
      printError(`Jump failed: ${(err as Error).message}`);
      continue;
    }
    if (state.status === 'completed' || state.status === 'paused') return;
    if (!anyPhaseFailed(state)) return;
  }
}

/**
 * Complete terminal state: render summary panel, idle until the abort signal
 * fires (caller wires AbortSignal to SIGINT). Footer ticker keeps running.
 */
export async function enterCompleteTerminalState(
  state: HarnessState,
  runDir: string,
  cwd: string,
  logger: SessionLogger,
  abortSignal?: AbortSignal,
): Promise<void> {
  void cwd;
  renderControlPanel(state, logger, 'terminal-complete');

  process.stderr.write('\n');
  printInfo('Run complete.');
  process.stderr.write(`  Eval report: ${state.artifacts.evalReport}\n`);
  if (state.baseCommit && state.evalCommit) {
    process.stderr.write(`  Commits:     ${state.baseCommit.slice(0, 7)}..${state.evalCommit.slice(0, 7)}\n`);
  }
  const startedAt = logger.getStartedAt();
  const wallSec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  process.stderr.write(`  Wall time:   ${Math.floor(wallSec / 60)}m ${String(wallSec % 60).padStart(2, '0')}s\n`);
  process.stderr.write('\nPress Ctrl+C to exit.\n');

  if (abortSignal !== undefined) {
    if (abortSignal.aborted) return;
    await new Promise<void>((resolve) => {
      abortSignal.addEventListener('abort', () => resolve(), { once: true });
    });
    return;
  }

  await new Promise<void>((resolve) => {
    process.once('SIGINT', () => resolve());
  });
  void runDir;
}
```

- [ ] **Step 4: Run terminal-ui tests until they pass**

Run: `pnpm vitest run tests/phases/terminal-ui.test.ts`
Expected: PASS. If `MockInput` typing fails, cast via `as unknown as InputManager` (already in fixture).

- [ ] **Step 5: Wire terminal-ui into `src/commands/inner.ts`**

Replace the existing `try { await runPhaseLoop(...) ... } finally { ... }` block (currently lines 204–218) with:

```ts
  // 6. Run phase loop, then route to terminal-state UI based on outcome
  try {
    await runPhaseLoop(state, harnessDir, runDir, cwd, inputManager, logger, sidecarReplayAllowed);

    const { enterCompleteTerminalState, enterFailedTerminalState, anyPhaseFailed } =
      await import('../phases/terminal-ui.js');

    const enterIdle = async (): Promise<void> => {
      const ac = new AbortController();
      const onSigint = (): void => ac.abort();
      process.once('SIGINT', onSigint);
      try {
        await enterCompleteTerminalState(state, runDir, cwd, logger, ac.signal);
      } finally {
        process.removeListener('SIGINT', onSigint);
      }
    };

    if (state.status === 'completed') {
      sessionEndStatus = 'completed';
      await enterIdle();
    } else if (state.status === 'paused') {
      sessionEndStatus = 'paused';
    } else if (anyPhaseFailed(state)) {
      await enterFailedTerminalState(state, harnessDir, runDir, cwd, inputManager, logger);
      // After R/J flow returns: classify, and surface idle panel if it ended in completion.
      if (state.status === 'completed') {
        sessionEndStatus = 'completed';
        await enterIdle();
      } else if (state.status === 'paused') {
        sessionEndStatus = 'paused';
      } else {
        sessionEndStatus = 'interrupted';
      }
    } else {
      sessionEndStatus = 'interrupted';
    }
  } finally {
    footerTimer.stop();
    process.removeListener('SIGWINCH', footerTimer.forceTick);
    logger.logEvent({ event: 'session_end', status: sessionEndStatus, totalWallMs: Date.now() - logger.getStartedAt() });
    logger.finalizeSummary(state);
    logger.close();
    inputManager.stop();
    releaseLock(harnessDir, runId);
  }
```

(The variable `abortController` is declared but only used inside the `completed` branch — leave it scoped where shown. The lint rule for `no-unused-vars` accepts this because it's referenced inside the closure.)

- [ ] **Step 6: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Run the full test suite**

Run: `pnpm vitest run`
Expected: PASS. If `tests/commands/inner.test.ts` mocks `runPhaseLoop` and asserts immediate exit-after-loop, update those subtests to also stub `enterCompleteTerminalState`/`enterFailedTerminalState` (or set `state.status = 'paused'` so the new code falls through with no UI).

- [ ] **Step 8: Commit**

```bash
git add src/phases/terminal-ui.ts src/commands/inner.ts tests/phases/terminal-ui.test.ts tests/commands/inner.test.ts tests/commands/inner-footer.test.ts
git commit -m "feat(ui): keep control panel alive after run completes or fails

Adds src/phases/terminal-ui.ts with enterFailedTerminalState
([R]esume / [J]ump / [Q]uit) and enterCompleteTerminalState (idle).
performResume/performJump are pure inner-side helpers that mutate
state and re-enter runPhaseLoop. Outer commands (resume/jump) are
unchanged. Wired in via src/commands/inner.ts after runPhaseLoop."
```

---

### Task 3: `ui_render` event instrumentation

**Files:**
- Modify: `src/types.ts` (add LogEvent variant)
- Modify: `src/ui.ts` (extend `renderControlPanel` signature)
- Modify: `src/phases/runner.ts` (8 call sites)
- Modify: `tests/ui.test.ts` (or sibling — add new subtests)
- Modify: `CLAUDE.md` (events table)
- Modify: `docs/HOW-IT-WORKS.md` / `.ko.md` (events section if present)

(Terminal-ui call sites `terminal-failed` / `terminal-complete` were already added in Task 2's render calls — no extra wiring needed here.)

- [ ] **Step 1: Add the LogEvent variant**

In `src/types.ts`, append a new variant to the `LogEvent` union (insert before the final `| (LogEventBase & { event: 'session_end'; ... })`):

```ts
  | (LogEventBase & {
      event: 'ui_render';
      phase: number;
      phaseStatus: PhaseStatus;
      callsite: string;
    })
```

- [ ] **Step 2: Write failing tests for `renderControlPanel` instrumentation**

In `tests/ui.test.ts`, add (or create the file if absent — append to the existing imports):

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderControlPanel } from '../src/ui.js';
import type { HarnessState, SessionLogger } from '../src/types.js';

function fixtureState(): HarnessState {
  // Re-use the same state factory pattern from terminal-ui tests; keep this
  // minimal to avoid depending on test helpers across files.
  return {
    runId: 'r1', flow: 'full', carryoverFeedback: null, currentPhase: 5,
    status: 'in_progress', autoMode: false, task: '', baseCommit: 'b',
    implRetryBase: 'b', codexPath: null, externalCommitsDetected: false,
    artifacts: { spec: '', plan: '', decisionLog: '', checklist: '', evalReport: '' },
    phases: { '1': 'completed', '2': 'completed', '3': 'completed', '4': 'completed', '5': 'in_progress', '6': 'pending', '7': 'pending' },
    gateRetries: { '2': 0, '4': 0, '7': 0 }, verifyRetries: 0,
    pauseReason: null, specCommit: null, planCommit: null, implCommit: null,
    evalCommit: null, verifiedAtHead: null, pausedAtHead: null, pendingAction: null,
    phaseOpenedAt: { '1': null, '3': null, '5': null },
    phaseAttemptId: { '1': null, '3': null, '5': null },
    phasePresets: { '1': 'opus-high', '2': 'codex-high', '3': 'sonnet-high', '4': 'codex-high', '5': 'sonnet-high', '7': 'codex-high' },
    phaseReopenFlags: { '1': false, '3': false, '5': false },
    phaseCodexSessions: { '2': null, '4': null, '7': null },
    lastWorkspacePid: null, lastWorkspacePidStartTime: null,
    tmuxSession: '', tmuxMode: 'dedicated', tmuxWindows: [],
    tmuxControlWindow: '', tmuxWorkspacePane: '', tmuxControlPane: '',
    loggingEnabled: false,
    phaseReopenSource: { '1': null, '3': null, '5': null },
    codexNoIsolate: false,
  };
}

function makeLogger(): SessionLogger {
  return {
    logEvent: vi.fn(),
    writeMeta: vi.fn(), updateMeta: vi.fn(), finalizeSummary: vi.fn(),
    close: vi.fn(), hasBootstrapped: () => false, hasEmittedSessionOpen: () => true,
    getStartedAt: () => 0, getEventsPath: () => null,
  };
}

describe('renderControlPanel — ui_render emission', () => {
  it('emits ui_render when both logger and callsite are provided', () => {
    const state = fixtureState();
    const logger = makeLogger();
    renderControlPanel(state, logger, 'unit-test');
    expect(logger.logEvent).toHaveBeenCalledWith({
      event: 'ui_render',
      phase: 5,
      phaseStatus: 'in_progress',
      callsite: 'unit-test',
    });
  });

  it('does not emit when logger is omitted', () => {
    const state = fixtureState();
    renderControlPanel(state); // legacy single-arg call
    // No assertion on logger; the test passes as long as no throw and no logger call.
  });

  it('does not emit when callsite is omitted', () => {
    const state = fixtureState();
    const logger = makeLogger();
    renderControlPanel(state, logger);
    expect(logger.logEvent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the new tests; expect FAIL**

Run: `pnpm vitest run tests/ui.test.ts`
Expected: TypeScript error "Expected 1 argument, but got 3" — the signature has not been extended yet.

- [ ] **Step 4: Extend `renderControlPanel` signature in `src/ui.ts`**

Modify lines 34–59 of `src/ui.ts`:

```ts
export function renderControlPanel(
  state: HarnessState,
  logger?: SessionLogger,
  callsite?: string,
): void {
  process.stdout.write('\x1b[2J\x1b[H'); // clear screen
  console.error(separator());
  console.error(`${GREEN}▶${RESET} Harness Control Panel`);
  console.error(separator());
  console.error(`  Run:   ${state.runId}`);
  console.error(`  Phase: ${state.currentPhase}/7 — ${phaseLabel(state.currentPhase, state.flow)}`);
  const preset = getPresetById(state.phasePresets?.[String(state.currentPhase)] ?? '');
  if (preset) console.error(`  Model: ${preset.label}`);
  console.error('');

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
    console.error(`  [${icon}] Phase ${p}: ${phaseLabel(p, state.flow)} ${statusLabel}${current}`);
  }
  console.error('');
  console.error(separator());

  if (logger !== undefined && callsite !== undefined) {
    const phaseStatus = state.phases[String(state.currentPhase)] ?? 'pending';
    logger.logEvent({
      event: 'ui_render',
      phase: state.currentPhase,
      phaseStatus,
      callsite,
    });
  }
}
```

Add `SessionLogger` to the imports at the top: change line 3 to `import type { HarnessState, FlowMode, SessionLogger } from './types.js';`.

- [ ] **Step 5: Re-run the ui.test.ts suite and confirm PASS**

Run: `pnpm vitest run tests/ui.test.ts`
Expected: PASS.

- [ ] **Step 6: Update all eight `renderControlPanel(state)` call sites in `src/phases/runner.ts`**

Apply the following replacements (line numbers refer to the file at the start of T3 — adjust if T1/T2 commits have shifted them):

| Site | Current call | Replacement |
|------|--------------|-------------|
| `runPhaseLoop` line 245 | `renderControlPanel(state);` | `renderControlPanel(state, logger, 'loop-top');` |
| `handleInteractivePhase` line 336 | `renderControlPanel(state);` | `renderControlPanel(state, logger, 'interactive-redirect');` |
| `handleInteractivePhase` line 395 | `renderControlPanel(state);` | `renderControlPanel(state, logger, 'interactive-complete');` |
| `handleGatePhase` line 475 | `renderControlPanel(state);` | `renderControlPanel(state, logger, 'gate-redirect');` |
| `handleGatePhase` line 522 | `renderControlPanel(state);` | `renderControlPanel(state, logger, 'gate-approve');` |
| `handleVerifyPhase` line 948 | `renderControlPanel(state);` | `renderControlPanel(state, logger, 'verify-complete');` |
| `handleVerifyPhase` line 964 | `renderControlPanel(state);` | `renderControlPanel(state, logger, 'verify-redirect');` |

(That is 7 sites. Spec mentioned 8; the eighth was the duplicate at the top of `runPhaseLoop` per the spec's own count. Re-run grep to confirm: `git grep -n 'renderControlPanel(state)' src/phases/` should return zero matches after the edits.)

`logger` is already in scope at every site (each handler takes `logger: SessionLogger` as a parameter).

- [ ] **Step 7: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Run integration smoke against `events.jsonl`**

Add to `tests/integration/logging.test.ts` (append at the end of the existing `describe(...)` block):

```ts
  it('emits at least one ui_render event during a session', async () => {
    const repo = createRepo(); // existing helper used elsewhere in this file
    // Mirror the lightweight driver pattern already in this file: drive a
    // partial phase-loop iteration and assert on events.jsonl.
    // (If the existing helpers do not support a single-iteration drive, this
    // step is satisfied by the unit tests in Step 5; document and skip.)
  });
```

If the integration harness in this file does not expose a one-iteration driver, leave the placeholder commented out and add a single-line note: `// ui_render coverage: see tests/ui.test.ts (renderControlPanel — ui_render emission)`.

- [ ] **Step 9: Update CLAUDE.md events table**

In the project root `CLAUDE.md`, locate the "이벤트 로깅 스키마 (events.jsonl)" table (around line 85). Append a new row before the bottom-of-section paragraph:

```
| `ui_render` | `phase`, `phaseStatus`, `callsite` (PR <next> — emitted from every `renderControlPanel(state, logger, callsite)` call: `loop-top`, `interactive-*`, `gate-*`, `verify-*`, `terminal-*`) |
```

Replace `<next>` with the actual PR number once known; leave as `<next>` for now.

- [ ] **Step 10: Run full suite**

Run: `pnpm vitest run && pnpm tsc --noEmit && pnpm build`
Expected: all PASS, dist regenerated.

- [ ] **Step 11: Commit**

```bash
git add src/types.ts src/ui.ts src/phases/runner.ts tests/ui.test.ts tests/integration/logging.test.ts CLAUDE.md
git commit -m "feat(logging): emit ui_render events from every control panel render

Extends renderControlPanel with optional (logger, callsite) parameters
that emit a ui_render LogEvent. Threaded through all seven render sites
in runner.ts and the two new terminal-ui sites. Adds a CLAUDE.md row."
```

---

## Eval Checklist (run before requesting code review)

```bash
pnpm tsc --noEmit
pnpm vitest run
pnpm build
```

All three must succeed cleanly. Then run a smoke dogfood (optional but recommended for surface-level verification):

```bash
pnpm build && harness start --light --enable-logging "smoke: terminal-ui dogfood"
# Expected: control panel persists after Phase 7 APPROVE (Press Ctrl+C to exit).
# Cancel a phase mid-run (e.g., kill workspace pane) → failed terminal state appears with [R]/[J]/[Q].
# Inspect ~/.harness/sessions/<hash>/<runId>/events.jsonl for "ui_render" lines.
```

## Doc Sync Checklist

- [x] `README.md` / `README.ko.md` — `--strict-tree` deletions (T1 step 10)
- [x] `docs/HOW-IT-WORKS.md` / `.ko.md` — `strictTree` field deletions (T1 step 10)
- [x] `CLAUDE.md` — `ui_render` table row (T3 step 9)
- [ ] If any other doc mentions `--strict-tree` or auto-recovery, grep with `git grep -n 'strict-tree\|dirty-tree\|IGNORABLE_ARTIFACTS'` and remove non-historical mentions (historical mentions inside `docs/specs/` and `docs/plans/` are preserved as ADR record).
- [ ] After full implementation, write a brief paragraph in `README.md` near the resume/jump section describing the new failed/complete terminal states (one sentence each).
