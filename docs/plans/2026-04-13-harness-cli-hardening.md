# harness-cli Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the preflight hang bug, improve advisor reminder UX, and add a conformance test for `PHASE_MODELS` — making `harness-cli` usable for local `pnpm link --global` runs without stalling.

**Architecture:** Surgical changes to 3 source files + 1 new test file. No architectural changes. Each task is TDD-first (test, then implementation, then verify).

**Tech Stack:** TypeScript (ESM, Node16), vitest, child_process spawnSync.

**Related spec:** `docs/specs/2026-04-13-harness-cli-hardening-design.md` (approved by Codex gate spec review attempt 3).

---

## Scope coverage check (vs spec sections)

| Spec section | Covered by |
|---|---|
| Design §1 Preflight `claudeAtFile` | Task 1 |
| Design §2 Advisor reminder text | Task 2 |
| Design §2 Advisor call-site move | Task 3 |
| Design §3 verify-script resolver tests | Task 4 |
| Design §4 `PHASE_MODELS` conformance | Task 5 |
| Success criteria (lint/test/build/smoke) | Task 6 |

---

## File Structure

### Modified
- `src/preflight.ts` — `claudeAtFile` case switches `execSync` → `spawnSync` with `killSignal: 'SIGKILL'`, `timeout: 5000`
- `src/ui.ts` — `printAdvisorReminder` gets per-phase framing + correct slash-command reference
- `src/phases/runner.ts` — remove the pre-existing `printAdvisorReminder(phase)` call
- `src/phases/interactive.ts` — add `printAdvisorReminder(phase)` immediately before `spawn('claude', ...)`, followed by 300 ms delay
- `tests/preflight.test.ts` — add timeout regression test + resolver accessSync cases
- `tests/phases/runner.test.ts` — drop assertions that bind reminder to runner
- `tests/phases/interactive.test.ts` — add reminder-before-spawn ordering test
- `tests/phases/verify.test.ts` — add spy assertion that `resolveVerifyScriptPath()` is consulted

### Created
- `tests/conformance/phase-models.test.ts` — exact-value assertions on `PHASE_MODELS`

### Unchanged
- Everything under `docs/` (spec is already committed; no docs updates in this plan)
- `src/state.ts`, `src/config.ts`, `src/phases/verify.ts` (source — only tests added)
- `scripts/copy-assets.mjs`, `package.json`

---

## Task 1: Preflight `claudeAtFile` hang fix

**Files:**
- Modify: `src/preflight.ts` (the `case 'claudeAtFile'` block — currently uses `execSync`)
- Modify: `tests/preflight.test.ts` (new regression test)

- [ ] **Step 1: Read current state of `src/preflight.ts`**

Locate the `claudeAtFile` block; note the current `execSync` call signature and the temp-file cleanup logic (if any).

- [ ] **Step 2: Write the failing test**

Add to `tests/preflight.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Top-level module mock — required in ESM because preflight.ts imports spawnSync directly.
vi.mock('child_process', async (importActual) => {
  const actual = await importActual<typeof import('child_process')>();
  return { ...actual, spawnSync: vi.fn() };
});

import { spawnSync } from 'child_process';
import { runPreflight } from '../src/preflight.js';

describe('preflight claudeAtFile timeout behavior', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(spawnSync).mockReset();
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  it('demotes timeout to warning and does not throw', () => {
    const timeoutErr = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
    vi.mocked(spawnSync).mockReturnValue({
      pid: 0,
      output: [],
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      status: null,
      signal: 'SIGKILL',
      error: timeoutErr,
    } as ReturnType<typeof spawnSync>);

    expect(() => runPreflight(['claudeAtFile'])).not.toThrow();

    const stderrCalls = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stderrCalls).toMatch(/claude @file check timed out/);
  });
});
```

- [ ] **Step 3: Run the test and confirm it fails**

```bash
pnpm test tests/preflight.test.ts -t "timeout behavior"
```

Expected: FAIL (current `execSync` path either hangs or doesn't write the warning).

- [ ] **Step 4: Replace `execSync` with `spawnSync` + SIGKILL in `src/preflight.ts`**

In the `case 'claudeAtFile'` block, change the preflight probe to:

```typescript
case 'claudeAtFile': {
  const tmpFile = path.join(os.tmpdir(), `harness-preflight-${process.pid}.txt`);
  try {
    fs.writeFileSync(tmpFile, '', 'utf-8');
    const result = spawnSync(
      'claude',
      ['--model', 'claude-sonnet-4-6', `@${tmpFile}`, '--print', ''],
      {
        stdio: 'pipe',
        encoding: 'utf-8',
        timeout: 5000,
        killSignal: 'SIGKILL',
      }
    );

    const timedOut =
      (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT' ||
      result.signal === 'SIGKILL';

    if (timedOut) {
      process.stderr.write(
        '⚠️  preflight: claude @file check timed out (5s); skipping — runtime failure will be surfaced at phase level if @file is unsupported.\n'
      );
      return;
    }

    if (result.status !== 0) {
      process.stderr.write(
        `⚠️  preflight: claude @file check exited with status ${result.status}; continuing (weak signal).\n`
      );
      return;
    }
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* best-effort */
    }
  }
  return;
}
```

Ensure `spawnSync` is imported at the top of `src/preflight.ts`:

```typescript
import { spawnSync } from 'child_process';
```

Remove any previously imported `execSync` binding if it becomes unused after the switch.

- [ ] **Step 5: Run the test and confirm it passes**

```bash
pnpm test tests/preflight.test.ts -t "timeout behavior"
```

Expected: PASS.

- [ ] **Step 6: Re-run the full preflight test file**

```bash
pnpm test tests/preflight.test.ts
```

Expected: all pre-existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src/preflight.ts tests/preflight.test.ts
git commit -m "fix(preflight): hard-stop claude @file check with spawnSync + SIGKILL + 5s timeout"
```

---

## Task 2: Advisor reminder — message text

**Files:**
- Modify: `src/ui.ts`
- Modify: existing test file that asserts `printAdvisorReminder` output, if any. If none, no test file touched in this task (ordering test in Task 3 is sufficient structural coverage).

- [ ] **Step 1: Read current `src/ui.ts` `printAdvisorReminder`**

Find the function. Note current message text and whether it takes a `phase` argument.

- [ ] **Step 2: Update `printAdvisorReminder` in `src/ui.ts`**

Replace the body with phase-aware framing. If the function does not yet take a `phase` parameter, add it:

```typescript
const ADVISOR_PURPOSE: Record<number, string> = {
  1: 'Brainstorming에서 advisor가 설계 트레이드오프 자문에 유용합니다.',
  3: 'Plan 작성에서 advisor가 태스크 분해 판단에 유용합니다.',
  5: '구현에서 advisor가 복잡 로직 판단에 유용합니다.',
};

export function printAdvisorReminder(phase: number): void {
  const YELLOW = '\x1b[33m';
  const RESET = '\x1b[0m';
  const purpose = ADVISOR_PURPOSE[phase] ?? 'advisor 설정을 확인하세요.';

  console.error('');
  console.error(`${YELLOW}⚠️  Advisor Reminder (Phase ${phase})${RESET}`);
  console.error(`${YELLOW}   ${purpose}${RESET}`);
  console.error(`${YELLOW}   Claude 세션이 시작된 뒤 다음을 입력하세요:${RESET}`);
  console.error(`${YELLOW}     /advisor${RESET}`);
  console.error(`${YELLOW}   (정확한 slash command 문법은 Claude Code 버전에 따라 다를 수 있습니다.)${RESET}`);
  console.error('');
}
```

Rationale for `/advisor` (bare, no argument): the exact subcommand form depends on the installed Claude Code version; the safe fallback per spec ADR-2 is the bare command plus a note that the user should check their version. Avoid guessing a specific subcommand like `/advisor on` if it is not verified for this version.

- [ ] **Step 3: Run existing tests to confirm nothing regressed**

```bash
pnpm test tests/
```

Expected: all tests pass (no test currently asserts the exact message text, per Step 1 check).

- [ ] **Step 4: Commit**

```bash
git add src/ui.ts
git commit -m "feat(ui): per-phase framing and safer slash-command reference in advisor reminder"
```

---

## Task 3: Advisor reminder — move call site to `interactive.ts`

**Files:**
- Modify: `src/phases/runner.ts` (remove existing `printAdvisorReminder(phase)` call)
- Modify: `src/phases/interactive.ts` (add the call right before `spawn('claude', ...)`)
- Modify: `tests/phases/runner.test.ts` (drop any existing assertion that reminder is called from runner)
- Modify: `tests/phases/interactive.test.ts` (add ordering test)

- [ ] **Step 1: Locate current reminder call in `src/phases/runner.ts`**

Search for `printAdvisorReminder(`. Note the surrounding code.

- [ ] **Step 2: Locate the spawn point in `src/phases/interactive.ts`**

Search for `spawn('claude'`. Note the function it lives in (`runInteractivePhase`) and the lines immediately before it.

- [ ] **Step 3: Write the failing ordering test**

`runInteractivePhase` touches lock APIs (`updateLockChild`, `clearLockChild`), reads process metadata (`getProcessStartTime`), and performs process-group cleanup. The new ordering test must mock these so the test runs without real lock files or PIDs. Required mocks (in addition to `child_process` and `../../src/ui.js` shown below):

```typescript
vi.mock('../../src/lock.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/lock.js')>();
  return { ...actual, updateLockChild: vi.fn(), clearLockChild: vi.fn() };
});

vi.mock('../../src/process.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/process.js')>();
  return {
    ...actual,
    getProcessStartTime: vi.fn(() => Math.floor(Date.now() / 1000)),
    isProcessGroupAlive: vi.fn(() => false),  // group "dies" immediately so cleanup wait short-circuits
    killProcessGroup: vi.fn().mockResolvedValue(undefined),
  };
});
```

Also ensure the test fixture writes a sentinel file matching `phaseAttemptId` so artifact validation passes (or mocks `chokidar` if the watcher is in play). Reuse helpers from existing `interactive.test.ts` cases — every required mock is already wired there for other tests; copy the pattern.

Now add the ordering test to `tests/phases/interactive.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/ui.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/ui.js')>();
  return { ...actual, printAdvisorReminder: vi.fn() };
});

vi.mock('child_process', async (importActual) => {
  const actual = await importActual<typeof import('child_process')>();
  const mockedSpawn = vi.fn(() => {
    // Return a minimal ChildProcess stub. CRITICAL: runInteractivePhase listens for
    // 'exit' (not 'close'). Verify by greping src/phases/interactive.ts before relying
    // on this stub — adjust the emitted event if implementation changes.
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    const cp = {
      pid: 12345,
      on: (event: string, cb: (...args: unknown[]) => void) => {
        (listeners[event] ||= []).push(cb);
        if (event === 'exit') {
          // exit handler signature: (code: number | null, signal: NodeJS.Signals | null)
          setImmediate(() => cb(0, null));
        }
        return cp;
      },
      kill: vi.fn(),
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      stdin: { end: vi.fn(), write: vi.fn() },
    };
    return cp;
  });
  return { ...actual, spawn: mockedSpawn };
});

import { printAdvisorReminder } from '../../src/ui.js';
import { spawn } from 'child_process';

describe('runInteractivePhase advisor ordering', () => {
  beforeEach(() => {
    vi.mocked(printAdvisorReminder).mockClear();
    vi.mocked(spawn).mockClear();
  });

  it('prints advisor reminder immediately before spawning claude', async () => {
    // The actual invocation path: construct state for Phase 1 and call runInteractivePhase.
    // Use the existing test helper `createInitialState` and a tmp runDir.
    // (Pattern the test after existing interactive.test.ts cases — see the nearby `runInteractivePhase` tests.)

    // Smoke-style assertion: after runInteractivePhase completes (mocked spawn closes immediately),
    // both functions have been called and reminder precedes spawn via invocationCallOrder.
    // Populate arguments using existing test fixtures.

    // Minimal illustrative assertion:
    const reminderOrder = vi.mocked(printAdvisorReminder).mock.invocationCallOrder[0];
    const spawnOrder = vi.mocked(spawn).mock.invocationCallOrder[0];
    expect(reminderOrder).toBeDefined();
    expect(spawnOrder).toBeDefined();
    expect(reminderOrder).toBeLessThan(spawnOrder!);
  });
});
```

Note: reuse the existing `runInteractivePhase` setup helpers already present in `tests/phases/interactive.test.ts` so the test actually runs the function under test. If those helpers are not present, follow the existing pattern from other tests in the same file for constructing state/runDir fixtures.

- [ ] **Step 4: Run the new test and confirm it fails**

```bash
pnpm test tests/phases/interactive.test.ts -t "advisor ordering"
```

Expected: FAIL. Either `printAdvisorReminder` is never called from `runInteractivePhase` (current state) or its call order precedes `spawn` inconsistently.

- [ ] **Step 5: Remove the call from `src/phases/runner.ts`**

Delete the `printAdvisorReminder(phase);` line (and the corresponding import if the function is not used elsewhere in `runner.ts`).

- [ ] **Step 6: Add the call to `src/phases/interactive.ts`**

In `runInteractivePhase`, immediately before `spawn('claude', ...)`, add:

```typescript
import { printAdvisorReminder } from '../ui.js'; // at top of file if not already imported

// ... inside runInteractivePhase, right before spawn:
printAdvisorReminder(phase);
await new Promise<void>((resolve) => setTimeout(resolve, 300));
const child = spawn('claude', ['--model', PHASE_MODELS[phase], '@' + path.resolve(promptFile)], {
  stdio: 'inherit',
  detached: true,
  cwd,
});
```

- [ ] **Step 7: Update `tests/phases/runner.test.ts`**

Search the file for any assertion on `printAdvisorReminder` and remove those assertions. The runner no longer owns this call.

If the file currently mocks `printAdvisorReminder`, leave the mock in place (harmless); remove only the `expect(printAdvisorReminder).toHaveBeenCalled…` assertions.

- [ ] **Step 8: Run the new and updated tests**

```bash
pnpm test tests/phases/interactive.test.ts
pnpm test tests/phases/runner.test.ts
```

Expected: both files pass.

- [ ] **Step 9: Commit**

```bash
git add src/phases/runner.ts src/phases/interactive.ts tests/phases/runner.test.ts tests/phases/interactive.test.ts
git commit -m "feat(interactive): move advisor reminder to spawn seam with 300ms render delay"
```

---

## Task 4: Lock `resolveVerifyScriptPath` behavior with tests

**Files:**
- Modify: `tests/preflight.test.ts` (add resolver cases)
- Modify: `tests/phases/verify.test.ts` (add spy assertion)

**Source change scope**: a small intentional refactor — adding the optional `packageLocalRoot` parameter to `resolveVerifyScriptPath()` (Step 1 below). This is a non-breaking test seam, not behavior change. The spec's "consolidation already complete" framing covered the call-site unification; this plan adds one optional argument to make the resolver deterministically testable. Existing zero-arg callers continue to work.

- [ ] **Step 1: Refactor `resolveVerifyScriptPath` for testability (small)**

The current resolver reads its own `__dirname` for package-local lookup, which makes deterministic per-test isolation impossible. To enable proper coverage of all four cases (package-local present/accessible, package-local present/inaccessible, legacy fallback, both absent), introduce one optional parameter that overrides the package-local lookup root. This is a non-breaking change.

Edit `src/preflight.ts`. Update `resolveVerifyScriptPath` signature and body:

```typescript
import { existsSync, accessSync, constants } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const DEFAULT_PACKAGE_LOCAL_ROOT = path.dirname(__filename);

/**
 * Resolve the harness-verify.sh path.
 * Lookup order:
 *  1. Package-local: <packageLocalRoot>/../scripts/harness-verify.sh (after build → dist/scripts/...)
 *  2. Legacy fallback: ~/.claude/scripts/harness-verify.sh
 * Returns null if neither is present + executable.
 *
 * @param packageLocalRoot - override the package-local search root (defaults to this module's __dirname).
 *                           Tests may pass a temp dir to deterministically exercise the package-local branch.
 */
export function resolveVerifyScriptPath(
  packageLocalRoot: string = DEFAULT_PACKAGE_LOCAL_ROOT
): string | null {
  const packageLocal = path.join(packageLocalRoot, '..', 'scripts', 'harness-verify.sh');
  if (existsSync(packageLocal)) {
    try {
      accessSync(packageLocal, constants.R_OK | constants.X_OK);
      return packageLocal;
    } catch {
      /* not accessible — fall through to legacy */
    }
  }

  const legacy = path.join(os.homedir(), '.claude', 'scripts', 'harness-verify.sh');
  if (existsSync(legacy)) {
    try {
      accessSync(legacy, constants.R_OK | constants.X_OK);
      return legacy;
    } catch {
      /* not accessible */
    }
  }

  return null;
}
```

Update any internal callers in the same file to use the default (zero-arg) call — no behavior change.

- [ ] **Step 2: Run lint to confirm signature change does not break callers**

```bash
pnpm run lint
```

Expected: zero errors. Existing callers (e.g., in `src/phases/verify.ts` and inside `runPreflight`) use the zero-arg form which still resolves to the default.

- [ ] **Step 3: Write deterministic resolver unit tests**

Add to `tests/preflight.test.ts`:

```typescript
import { mkdtempSync, writeFileSync, chmodSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveVerifyScriptPath } from '../src/preflight.js';

describe('resolveVerifyScriptPath — package-local branch (deterministic via override)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'harness-pkglocal-'));
    // Layout: <tmp>/lib/preflight.js (simulated package-local root) and <tmp>/scripts/harness-verify.sh (target)
    mkdirSync(join(tmp, 'lib'), { recursive: true });
    mkdirSync(join(tmp, 'scripts'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns package-local path when present and executable', () => {
    const target = join(tmp, 'scripts', 'harness-verify.sh');
    writeFileSync(target, '#!/bin/sh\necho ok\n');
    chmodSync(target, 0o755);
    const result = resolveVerifyScriptPath(join(tmp, 'lib'));
    expect(result).toBe(target);
  });

  it('returns legacy path when package-local is absent and legacy is present + executable', () => {
    // No package-local file created; pkgLocalRoot points at <tmp>/lib (which has no ../scripts/harness-verify.sh).

    const homeBackup = process.env.HOME;
    const fakeHome = mkdtempSync(join(tmpdir(), 'harness-fake-home-'));
    const legacyDir = join(fakeHome, '.claude', 'scripts');
    mkdirSync(legacyDir, { recursive: true });
    const legacyTarget = join(legacyDir, 'harness-verify.sh');
    writeFileSync(legacyTarget, '#!/bin/sh\necho ok\n');
    chmodSync(legacyTarget, 0o755);
    process.env.HOME = fakeHome;

    try {
      const result = resolveVerifyScriptPath(join(tmp, 'lib'));
      expect(result).toBe(legacyTarget);
    } finally {
      process.env.HOME = homeBackup;
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it('falls through to legacy when package-local exists but is not executable', () => {
    const pkgTarget = join(tmp, 'scripts', 'harness-verify.sh');
    writeFileSync(pkgTarget, '#!/bin/sh\necho ok\n');
    chmodSync(pkgTarget, 0o644); // not executable

    // Set up a controlled legacy path via HOME override
    const homeBackup = process.env.HOME;
    const fakeHome = mkdtempSync(join(tmpdir(), 'harness-fake-home-'));
    const legacyDir = join(fakeHome, '.claude', 'scripts');
    mkdirSync(legacyDir, { recursive: true });
    const legacyTarget = join(legacyDir, 'harness-verify.sh');
    writeFileSync(legacyTarget, '#!/bin/sh\necho ok\n');
    chmodSync(legacyTarget, 0o755);
    process.env.HOME = fakeHome;

    try {
      const result = resolveVerifyScriptPath(join(tmp, 'lib'));
      expect(result).toBe(legacyTarget);
    } finally {
      process.env.HOME = homeBackup;
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it('returns null when package-local is missing and legacy is missing', () => {
    const homeBackup = process.env.HOME;
    const fakeHome = mkdtempSync(join(tmpdir(), 'harness-fake-home-'));
    process.env.HOME = fakeHome;
    try {
      const result = resolveVerifyScriptPath(join(tmp, 'lib'));
      expect(result).toBeNull();
    } finally {
      process.env.HOME = homeBackup;
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it('returns null when both package-local and legacy exist but neither is executable', () => {
    const pkgTarget = join(tmp, 'scripts', 'harness-verify.sh');
    writeFileSync(pkgTarget, '#!/bin/sh\necho ok\n');
    chmodSync(pkgTarget, 0o644);

    const homeBackup = process.env.HOME;
    const fakeHome = mkdtempSync(join(tmpdir(), 'harness-fake-home-'));
    const legacyDir = join(fakeHome, '.claude', 'scripts');
    mkdirSync(legacyDir, { recursive: true });
    const legacyTarget = join(legacyDir, 'harness-verify.sh');
    writeFileSync(legacyTarget, '#!/bin/sh\necho ok\n');
    chmodSync(legacyTarget, 0o644);
    process.env.HOME = fakeHome;

    try {
      const result = resolveVerifyScriptPath(join(tmp, 'lib'));
      expect(result).toBeNull();
    } finally {
      process.env.HOME = homeBackup;
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });
});
```

Each case is fully deterministic — no environment-dependent skips. All four spec cases (package-local accessible / package-local inaccessible → legacy / both absent / both present-but-inaccessible) are covered.

- [ ] **Step 4: Add spy assertion to `tests/phases/verify.test.ts`**

Find an existing test that calls `runVerifyPhase` and add this assertion (or add a new focused test case):

```typescript
import * as preflightModule from '../../src/preflight.js';

it('delegates script resolution to resolveVerifyScriptPath', async () => {
  const spy = vi.spyOn(preflightModule, 'resolveVerifyScriptPath');

  try {
    // Run verify phase using existing test fixtures from this file.
    // (Use the same setup as other tests in this file.)
    // If resolveVerifyScriptPath returns null, runVerifyPhase should throw with a
    // recognizable message; we only care that the spy was called.
    await expect(async () => {
      // Call the smallest path that reaches script resolution. If there is no
      // lightweight entry, call runVerifyPhase with mocked state and expect it
      // to either throw or return without error — either way, the spy must fire.
    }).rejects; // or resolves — replace based on the surrounding file's pattern
  } catch {
    /* ignore — we only assert the spy below */
  }

  expect(spy).toHaveBeenCalled();
});
```

If the existing `verify.test.ts` already uses a more ergonomic pattern (e.g., module mocks), follow that pattern instead. The only requirement is: after any path through `runVerifyPhase`, `resolveVerifyScriptPath` must have been invoked.

- [ ] **Step 5: Run the tests**

```bash
pnpm test tests/preflight.test.ts
pnpm test tests/phases/verify.test.ts
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add src/preflight.ts tests/preflight.test.ts tests/phases/verify.test.ts
git commit -m "test+refactor: deterministic resolveVerifyScriptPath tests via packageLocalRoot override"
```

---

## Task 5: `PHASE_MODELS` conformance test

**Files:**
- Create: `tests/conformance/phase-models.test.ts`

- [ ] **Step 1: Create the conformance test**

Write `tests/conformance/phase-models.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { PHASE_MODELS } from '../../src/config.js';

describe('PHASE_MODELS conformance', () => {
  it('Phase 1 uses claude-opus-4-6', () => {
    expect(PHASE_MODELS[1]).toBe('claude-opus-4-6');
  });

  it('Phase 3 uses claude-sonnet-4-6', () => {
    expect(PHASE_MODELS[3]).toBe('claude-sonnet-4-6');
  });

  it('Phase 5 uses claude-sonnet-4-6', () => {
    expect(PHASE_MODELS[5]).toBe('claude-sonnet-4-6');
  });

  it('does not define models for non-interactive phases', () => {
    expect(PHASE_MODELS[2]).toBeUndefined();
    expect(PHASE_MODELS[4]).toBeUndefined();
    expect(PHASE_MODELS[6]).toBeUndefined();
    expect(PHASE_MODELS[7]).toBeUndefined();
  });

  it('defines exactly three entries (for phases 1, 3, 5)', () => {
    expect(Object.keys(PHASE_MODELS).sort()).toEqual(['1', '3', '5']);
  });
});
```

- [ ] **Step 2: Run the new test**

```bash
pnpm test tests/conformance/phase-models.test.ts
```

Expected: all 5 cases pass (the current `src/config.ts` matches the spec).

- [ ] **Step 3: Commit**

```bash
git add tests/conformance/phase-models.test.ts
git commit -m "test(conformance): lock PHASE_MODELS to exact spec values"
```

---

## Task 6: Full verification + manual smoke test

**Files:** none modified — this is a verification pass.

- [ ] **Step 1: Run the complete test suite**

```bash
pnpm test
```

Expected: all tests pass, including the new/modified cases from Tasks 1–5. No skips introduced.

- [ ] **Step 2: Run lint (strict tsc)**

```bash
pnpm run lint
```

Expected: zero errors.

- [ ] **Step 3: Build**

```bash
pnpm run build
```

Expected: exits 0. Confirm `dist/src/preflight.js` and `dist/src/ui.js` reflect the changes.

- [ ] **Step 4: Manual smoke test — CLI help (generic sanity)**

```bash
node dist/bin/harness.js --help
```

Expected: help text prints, process exits 0 within 1 second.

- [ ] **Step 5: Manual smoke test — `harness run` in a clean temp dir, with Ctrl-C interrupt**

This is a real interactive smoke test. Run it in a terminal you control (not as a piped/non-TTY command).

```bash
TMP=$(mktemp -d)
cd "$TMP"
git init -q
git commit --allow-empty -q -m init
# Using the globally linked harness (assumes `pnpm link --global` was run in the repo)
harness run "smoke test" --allow-dirty
```

Observe within ~10 seconds:
1. Preflight runs without hanging.
2. If `claude @file` check is slow, it times out in 5s and prints the `⚠️  preflight: claude @file check timed out (5s)` warning, then preflight continues.
3. The advisor reminder appears (yellow, phase-1 framing) immediately before Claude takes the terminal.
4. Claude Code spawns (interactive session starts).

Now press **Ctrl-C** to send SIGINT. The CLI should:
- Kill the Claude child process group (SIGTERM → SIGKILL after 5s).
- Save state with `pausedAtHead` populated.
- Release `repo.lock` and `run.lock`.
- Exit with code 130.

Verify cleanup with `harness status` and `harness list` from the same temp dir:

```bash
harness status
# Expected: prints the current run's state (status: in_progress, currentPhase: 1, pausedAtHead set).
# Must NOT report "harness is already running" (that would mean lock leaked).

harness list
# Expected: shows the smoke run with status `in_progress`.
```

Confirm both lock files are gone:

```bash
ls .harness/repo.lock 2>&1 | grep -q "No such file" && echo "repo.lock cleaned ✓"
ls .harness/*/run.lock 2>&1 | grep -q "No such file" && echo "run.lock cleaned ✓"
```

Finally clean up:

```bash
cd /Users/daniel/Desktop/projects/harness/harness-cli
rm -rf "$TMP"
```

- [ ] **Step 6: No commit needed for this task** — it is a verification pass, not a code change. If earlier tasks' commits have not yet been pushed to the `main` branch they remain local; pushing is not in scope of this plan.

---

## Eval checklist (for Phase 6 auto-verification)

```json
{
  "checks": [
    { "name": "Type check",                     "command": "pnpm run lint" },
    { "name": "Unit + conformance tests",       "command": "pnpm test" },
    { "name": "Build",                          "command": "pnpm run build" },
    { "name": "CLI help works",                 "command": "node dist/bin/harness.js --help" },
    { "name": "No hardcoded ~/.claude in verify.ts",
      "command": "! grep -nE \"'\\.claude/scripts'|\\\"\\.claude/scripts\\\"\" src/phases/verify.ts" },
    { "name": "dist/scripts/harness-verify.sh exists and is executable",
      "command": "test -x dist/scripts/harness-verify.sh" },
    { "name": "Preflight imports spawnSync from child_process",
      "command": "grep -qE \"^import \\{[^}]*\\bspawnSync\\b[^}]*\\}\\s+from\\s+'child_process'\" src/preflight.ts" },
    { "name": "Preflight uses killSignal: 'SIGKILL' for the @file probe",
      "command": "grep -qE \"killSignal:\\s*'SIGKILL'\" src/preflight.ts" },
    { "name": "Preflight no longer uses execSync for claudeAtFile (proves hang fix in source)",
      "command": "! awk '/case .claudeAtFile.:/,/return;/' src/preflight.ts | grep -q 'execSync('" },
    { "name": "Advisor reminder is invoked from interactive.ts spawn seam (not runner.ts)",
      "command": "grep -q 'printAdvisorReminder' src/phases/interactive.ts && ! grep -q 'printAdvisorReminder' src/phases/runner.ts" }
  ]
}
```

Notes:
- The end-to-end smoke proof is left to the manual step in Task 6 — `harness run` requires a TTY (preflight item 10) and the eval-verifier sandbox cannot satisfy that constraint reliably across machines (and `timeout(1)` is not always available on macOS).
- The `spawnSync killSignal` grep proves the source code change is in place. The CLI help check proves the binary boots. Together they cover the regression that caused the original 4-hour hang without requiring an interactive session.
- The advisor-seam grep proves the call-site moved (not still in runner) and that interactive.ts now owns the call.
- Each check exits 0 on pass, non-zero on failure. `harness-verify.sh` runs them sequentially and appends `## Summary` when all checks complete.

---

## Task dependencies

```
Task 1 (preflight timeout)        ── modifies src/preflight.ts + tests/preflight.test.ts
Task 2 (reminder text)            ── independent (src/ui.ts only)
Task 3 (reminder call-site move)  ── depends on Task 2 (safer to have new text before moving)
Task 4 (resolver tests)           ── modifies src/preflight.ts + tests/preflight.test.ts (overlaps Task 1)
Task 5 (conformance test)         ── independent (only tests/conformance/phase-models.test.ts)
Task 6 (verification)             ── depends on Tasks 1–5
```

Parallel execution groups (if using subagent dispatch):

- Group A (parallel — disjoint files): Task 2, Task 5
- Group B (serial — both touch tests/preflight.test.ts and src/preflight.ts): Task 1 → Task 4
- Group C (after Task 2): Task 3
- Group D (after all): Task 6

If running purely serially: Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 is also valid and avoids any merge concerns.
