# `--no-drift` start flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `--no-drift` boolean flag to `phase-harness start`/`run` that persists drift-detection policy in `state.json`, overrides `HARNESS_PHASE_DRIFT_THRESHOLD` env, and is rejected on `resume`.

**Architecture:** New `noDrift: boolean` field in `HarnessState` (mirrors `codexNoIsolate` pattern). `loadDriftThreshold` gains a second boolean param that short-circuits before reading env. `scoreP5Drift` unpacks `state.noDrift` and passes it through. `resumeCommand` rejects the flag early, before reading `state.json`.

**Tech Stack:** TypeScript, Commander.js (CLI), Vitest (tests)

> **Test file note:** The spec references `tests/unit/phases/drift.test.ts` and `tests/unit/state.test.ts`, but those paths do not exist in the repo. The actual files — `tests/phases/drift.test.ts` and `tests/state.test.ts` — are the correct targets and match the existing project structure.

---

## File map

| File | Change |
|---|---|
| `src/types.ts` | Add `noDrift: boolean` to `HarnessState` |
| `src/state.ts` | Add `noDrift` param to `createInitialState`; add migration line in `migrateState` |
| `src/phases/drift.ts` | `loadDriftThreshold(autoMode, noDrift=false)` — short-circuit; `scoreP5Drift` passes `state.noDrift` |
| `src/commands/start.ts` | `noDrift?: boolean` in `StartOptions`; pass to `createInitialState` |
| `src/commands/resume.ts` | `noDrift?: boolean` in `ResumeOptions`; early reject before reading state |
| `bin/harness.ts` | `--no-drift` option on `start`/`run`/`resume` |
| `tests/phases/drift.test.ts` | New cases in `loadDriftThreshold` describe block; new `scoreP5Drift` integration describe |
| `tests/state.test.ts` | New cases for migration + `createInitialState` + state round-trip |
| `tests/commands/resume-cmd.test.ts` | New case for `--no-drift` reject (exit code + stderr + state unread) |
| `README.md` | `--no-drift` flag + precedence sentence |
| `README.ko.md` | Korean sync |
| `docs/HOW-IT-WORKS.md` | Disabling per-run subsection; `noDrift` field in state schema list |
| `docs/HOW-IT-WORKS.ko.md` | Korean sync |

---

## Task 1: Core implementation + tests

**Files:**
- Modify: `src/types.ts`
- Modify: `src/state.ts`
- Modify: `src/phases/drift.ts`
- Modify: `src/commands/start.ts`
- Modify: `src/commands/resume.ts`
- Modify: `bin/harness.ts`
- Modify: `tests/phases/drift.test.ts`
- Modify: `tests/state.test.ts`
- Modify: `tests/commands/resume-cmd.test.ts`

- [ ] **Step 1: Write failing unit tests — `loadDriftThreshold` with `noDrift`**

  Add to the `loadDriftThreshold` describe block in `tests/phases/drift.test.ts`:

  ```ts
  it('noDrift=true, autoMode=true → null (short-circuits before env)', () => {
    expect(loadDriftThreshold(true, true)).toBe(null);
  });

  it('noDrift=true, autoMode=false → null', () => {
    expect(loadDriftThreshold(false, true)).toBe(null);
  });

  it('noDrift=true, env="0.3" → null (CLI > env)', () => {
    vi.stubEnv('HARNESS_PHASE_DRIFT_THRESHOLD', '0.3');
    expect(loadDriftThreshold(true, true)).toBe(null);
  });

  it('noDrift=true, env="0.5", autoMode=false → null', () => {
    vi.stubEnv('HARNESS_PHASE_DRIFT_THRESHOLD', '0.5');
    expect(loadDriftThreshold(false, true)).toBe(null);
  });

  it('noDrift=true, env="invalid" → null and warnOnce NOT called', () => {
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.stubEnv('HARNESS_PHASE_DRIFT_THRESHOLD', 'invalid');
    expect(loadDriftThreshold(true, true)).toBe(null);
    const warnCalls = errSpy.mock.calls.filter((c) => String(c[0]).includes('[drift] invalid'));
    expect(warnCalls.length).toBe(0);
    errSpy.mockRestore();
  });

  it('noDrift=false (default) preserves existing env behaviour', () => {
    vi.stubEnv('HARNESS_PHASE_DRIFT_THRESHOLD', '0.5');
    expect(loadDriftThreshold(true, false)).toBe(0.5);
  });
  ```

- [ ] **Step 2: Write failing integration tests — `scoreP5Drift` with `noDrift`**

  Add a new describe block at the bottom of `tests/phases/drift.test.ts`. This requires adding two imports at the top of the file:
  - `import { scoreP5Drift } from '../../src/phases/drift.js';` (already imported via the existing named import; add `scoreP5Drift` to it)
  - `import { createInitialState } from '../../src/state.js';`

  ```ts
  describe('scoreP5Drift integration — noDrift flag', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('noDrift=true → activated:false even when HARNESS_PHASE_DRIFT_THRESHOLD=0.3', async () => {
      vi.stubEnv('HARNESS_PHASE_DRIFT_THRESHOLD', '0.3');
      const state = createInitialState('run-nd', 'task', 'abc', true, false, 'full', false, true);
      const result = await scoreP5Drift({ state, runDir: '/tmp', cwd: '/tmp' });
      expect(result.activated).toBe(false);
    });

    it('noDrift=false + env=off → activated:false (existing env-off behaviour unchanged)', async () => {
      vi.stubEnv('HARNESS_PHASE_DRIFT_THRESHOLD', 'off');
      const state = createInitialState('run-nd', 'task', 'abc', true);
      const result = await scoreP5Drift({ state, runDir: '/tmp', cwd: '/tmp' });
      expect(result.activated).toBe(false);
    });
  });
  ```

- [ ] **Step 3: Write failing unit tests — state migration and `createInitialState`**

  Add to `tests/state.test.ts`:

  ```ts
  describe('noDrift field', () => {
    it('migrateState defaults noDrift=false when field missing', () => {
      const legacy = JSON.parse(JSON.stringify(createInitialState('run-abc', 'task', 'abc123', false)));
      delete legacy.noDrift;
      const migrated = migrateState(legacy);
      expect(migrated.noDrift).toBe(false);
    });

    it('migrateState preserves existing noDrift=true', () => {
      const legacy = JSON.parse(JSON.stringify(createInitialState('run-abc', 'task', 'abc123', false)));
      legacy.noDrift = true;
      const migrated = migrateState(legacy);
      expect(migrated.noDrift).toBe(true);
    });

    it('createInitialState defaults noDrift=false', () => {
      const state = createInitialState('run-abc', 'task', 'abc123', false);
      expect(state.noDrift).toBe(false);
    });

    it('createInitialState stores noDrift=true when passed', () => {
      const state = createInitialState('run-abc', 'task', 'abc123', false, false, 'full', false, true);
      expect(state.noDrift).toBe(true);
    });

    it('noDrift=true round-trips through writeState/readState (persistence integration)', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noDrift-int-'));
      tmpDirs.push(tmpDir);
      const state = createInitialState('run-nd', 'task', 'abc123', false, false, 'full', false, true);
      writeState(tmpDir, state);
      const restored = readState(tmpDir);
      expect(restored?.noDrift).toBe(true);
    });
  });
  ```

- [ ] **Step 4: Write failing test — resume rejects `--no-drift`, state unread**

  Add to `tests/commands/resume-cmd.test.ts`. This test creates a run dir with a real `state.json` and asserts its mtime is unchanged after rejection:

  ```ts
  it('rejects --no-drift with exit(1), stderr message, and state.json unread', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-nd-'));
    const stateFile = path.join(tmpDir, 'state.json');
    fs.writeFileSync(stateFile, JSON.stringify({ dummy: true }));
    const mtimeBefore = fs.statSync(stateFile).mtimeMs;

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      throw new Error('process.exit');
    });

    await expect(resumeCommand(undefined, { noDrift: true })).rejects.toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderrSpy.mock.calls.some((c) => String(c[0]).includes('--no-drift'))).toBe(true);
    expect(fs.statSync(stateFile).mtimeMs).toBe(mtimeBefore);

    stderrSpy.mockRestore();
    exitSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  ```

  Note: the mtime assertion validates that `resumeCommand` exits before ever touching `state.json` when `--no-drift` is passed.

- [ ] **Step 5: Run tests to confirm failures**

  ```bash
  cd /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/dogfood-no-drift
  pnpm vitest run tests/phases/drift.test.ts tests/state.test.ts tests/commands/resume-cmd.test.ts 2>&1 | tail -30
  ```

  Expected: failures on the new test cases (wrong arg count / missing field / no rejection).

- [ ] **Step 6: Implement — `src/types.ts`**

  Add `noDrift: boolean;` immediately after `codexNoIsolate: boolean;` in `HarnessState`:

  ```ts
  codexNoIsolate: boolean;
  noDrift: boolean;
  dirtyBaseline: string[];
  ```

- [ ] **Step 7: Implement — `src/state.ts` (migrateState)**

  Add migration line immediately after the `codexNoIsolate` migration line (~line 112):

  ```ts
  if (raw.codexNoIsolate === undefined) raw.codexNoIsolate = false;
  if (raw.noDrift === undefined) raw.noDrift = false;
  ```

- [ ] **Step 8: Implement — `src/state.ts` (createInitialState)**

  Update signature to add `noDrift: boolean = false` as the last parameter:

  ```ts
  export function createInitialState(
    runId: string,
    task: string,
    baseCommit: string,
    autoMode: boolean,
    loggingEnabled: boolean = false,
    flow: 'full' | 'light' = 'full',
    codexNoIsolate: boolean = false,
    noDrift: boolean = false,
  ): HarnessState {
  ```

  Add `noDrift` to the return object immediately after `codexNoIsolate`:

  ```ts
  codexNoIsolate,
  noDrift,
  dirtyBaseline: [],
  ```

- [ ] **Step 9: Implement — `src/phases/drift.ts`**

  Update `loadDriftThreshold` signature and add short-circuit as the very first line of the function body (before the env read):

  ```ts
  export function loadDriftThreshold(autoMode: boolean, noDrift: boolean = false): number | null {
    if (noDrift) return null;
    const raw = process.env['HARNESS_PHASE_DRIFT_THRESHOLD'];
    // ... rest of function unchanged
  ```

  Update `scoreP5Drift`'s call to `loadDriftThreshold` (~line 455):

  ```ts
  const threshold = loadDriftThreshold(
    input.state.autoMode === true,
    input.state.noDrift === true,
  );
  ```

- [ ] **Step 10: Implement — `src/commands/start.ts`**

  Add `noDrift?: boolean;` to `StartOptions` (after `codexNoIsolate`):

  ```ts
  export interface StartOptions {
    requireClean?: boolean;
    auto?: boolean;
    root?: string;
    enableLogging?: boolean;
    light?: boolean;
    codexNoIsolate?: boolean;
    noDrift?: boolean;
    track?: string[];
    exclude?: string[];
  }
  ```

  Update the `createInitialState` call in `startCommand` (~line 237) to pass `noDrift` as the last argument:

  ```ts
  const state = createInitialState(
    runId,
    normalizedTask,
    baseCommit,
    options.auto ?? false,
    options.enableLogging ?? false,
    options.light ? 'light' : 'full',
    options.codexNoIsolate ?? false,
    options.noDrift ?? false,
  );
  ```

- [ ] **Step 11: Implement — `src/commands/resume.ts`**

  Add `noDrift?: boolean;` to `ResumeOptions`:

  ```ts
  export interface ResumeOptions {
    root?: string;
    light?: boolean;
    noDrift?: boolean;
  }
  ```

  Add the `noDrift` early-reject block immediately after the existing `options.light` reject block (before `findHarnessRoot`, before any state reads):

  ```ts
  if (options.noDrift) {
    process.stderr.write(
      "Error: --no-drift is only valid on 'phase-harness start' / 'phase-harness run'. " +
      "Drift policy is frozen at run creation; start a new run with --no-drift if you want to skip drift.\n",
    );
    process.exit(1);
  }
  ```

- [ ] **Step 12: Implement — `bin/harness.ts`**

  Add `--no-drift` to the `start` command (after `--codex-no-isolate`):

  ```ts
  .option('--no-drift', 'skip P5 → P6 drift detection for this run (equivalent to HARNESS_PHASE_DRIFT_THRESHOLD=off, but persisted per-run)')
  ```

  Update the `start` action opts type to include `noDrift?: boolean`:

  ```ts
  .action(async (task: string | undefined, opts: { requireClean?: boolean; auto?: boolean; enableLogging?: boolean; light?: boolean; codexNoIsolate?: boolean; noDrift?: boolean; track?: string[]; exclude?: string[] }) => {
  ```

  Apply the identical `--no-drift` option and updated opts type to the `run` command.

  Add `--no-drift` to the `resume` command and update its opts type:

  ```ts
  .option('--no-drift', '(rejected — drift policy is frozen at run creation)')
  .action(async (runId: string | undefined, opts: { light?: boolean; noDrift?: boolean }) => {
  ```

  `noDrift` flows via `{ ...opts }` spread in start/run; resume forwards `opts` to `resumeCommand` which rejects early.

- [ ] **Step 13: Run focused tests — expect green**

  ```bash
  pnpm vitest run tests/phases/drift.test.ts tests/state.test.ts tests/commands/resume-cmd.test.ts 2>&1 | tail -30
  ```

  Expected: all new cases pass, no regressions.

- [ ] **Step 14: Full typecheck + test suite + build**

  ```bash
  pnpm tsc --noEmit && pnpm vitest run && pnpm build 2>&1 | tail -30
  ```

  Expected: zero type errors, all tests green, build succeeds.

- [ ] **Step 15: Commit**

  ```bash
  git add src/types.ts src/state.ts src/phases/drift.ts src/commands/start.ts src/commands/resume.ts bin/harness.ts tests/phases/drift.test.ts tests/state.test.ts tests/commands/resume-cmd.test.ts
  git commit -m "feat(drift): add --no-drift start flag to disable drift detection per-run"
  ```

---

## Task 2: Docs sync

**Files:**
- Modify: `README.md`
- Modify: `README.ko.md`
- Modify: `docs/HOW-IT-WORKS.md`
- Modify: `docs/HOW-IT-WORKS.ko.md`

- [ ] **Step 1: Update `README.md`**

  In the `### phase-harness start [task]` section, add `--no-drift` to the Flags list (after `--codex-no-isolate`):

  ```
  - `--no-drift` — skip P5 → P6 drift detection for this run (equivalent to `HARNESS_PHASE_DRIFT_THRESHOLD=off`, but persisted per-run)
  ```

  In the `HARNESS_PHASE_DRIFT_THRESHOLD` row of the env-variable table, append to the existing description:

  ```
  `--no-drift` overrides `HARNESS_PHASE_DRIFT_THRESHOLD` when both are set.
  ```

  In the `### phase-harness resume [runId]` section, add a freeze note analogous to the `--light` note:

  ```
  `--no-drift` is a start-time choice only. Drift policy is frozen at run creation; `phase-harness resume --no-drift` is rejected.
  ```

- [ ] **Step 2: Update `README.ko.md`**

  Apply the same three changes in Korean:

  Flags 목록에 추가 (after `--codex-no-isolate`):
  ```
  - `--no-drift` — 이 run에서 P5 → P6 drift 검출을 비활성화 (`HARNESS_PHASE_DRIFT_THRESHOLD=off`와 동등하나 run 단위로 영구 저장됨)
  ```

  `HARNESS_PHASE_DRIFT_THRESHOLD` 항목 끝에 추가:
  ```
  두 설정이 동시에 적용되면 `--no-drift`가 `HARNESS_PHASE_DRIFT_THRESHOLD`를 덮어씁니다.
  ```

  `resume` 섹션에 추가:
  ```
  `--no-drift`는 start 시점에만 유효합니다. Drift 정책은 run 생성 시 고정되므로 `phase-harness resume --no-drift`는 거부됩니다.
  ```

- [ ] **Step 3: Update `docs/HOW-IT-WORKS.md`**

  In the `### Drift detection (P5→P6)` section, append after the existing content:

  ```markdown
  **Disabling per-run (`--no-drift`):** Pass `--no-drift` to `phase-harness start` or `phase-harness run` to disable drift detection for that run entirely. The flag is persisted as `state.noDrift: true` at run creation and takes precedence over `HARNESS_PHASE_DRIFT_THRESHOLD` for the lifetime of the run. `phase-harness resume --no-drift` is rejected — drift policy is frozen at run creation. To re-enable drift detection, start a new run without the flag.
  ```

  In the state.json field list (~line 318), add `noDrift` on the same line as `codexNoIsolate`:

  ```
  - `loggingEnabled`, `codexNoIsolate`, `noDrift`
  ```

- [ ] **Step 4: Update `docs/HOW-IT-WORKS.ko.md`**

  Apply the same changes in Korean.

  Drift 검출 섹션에 추가:
  ```markdown
  **per-run 비활성화 (`--no-drift`):** `phase-harness start` 또는 `phase-harness run`에 `--no-drift`를 전달하면 해당 run에서 drift 검출이 완전히 비활성화됩니다. 이 플래그는 run 생성 시 `state.noDrift: true`로 저장되며, run 수명 전체에 걸쳐 `HARNESS_PHASE_DRIFT_THRESHOLD`보다 우선합니다. `phase-harness resume --no-drift`는 거부됩니다 — drift 정책은 run 생성 시 고정됩니다. drift 검출을 다시 활성화하려면 플래그 없이 새 run을 시작하세요.
  ```

  state.json 필드 목록에 `noDrift` 추가:
  ```
  - `loggingEnabled`, `codexNoIsolate`, `noDrift`
  ```

- [ ] **Step 5: Verify grep — all 4 docs contain `--no-drift` token**

  ```bash
  grep -l '\-\-no-drift' \
    README.md README.ko.md \
    docs/HOW-IT-WORKS.md docs/HOW-IT-WORKS.ko.md
  ```

  Expected: all 4 filenames printed.

- [ ] **Step 6: Typecheck + full test suite + build (regression guard)**

  ```bash
  pnpm tsc --noEmit && pnpm vitest run && pnpm build 2>&1 | tail -20
  ```

  Expected: zero errors, all green, build succeeds.

- [ ] **Step 7: Commit**

  ```bash
  git add README.md README.ko.md docs/HOW-IT-WORKS.md docs/HOW-IT-WORKS.ko.md
  git commit -m "docs: add --no-drift to README and HOW-IT-WORKS (docs sync)"
  ```

---

## Deferred

- P2: The resume-cmd test's mtime assertion requires the test creates a tmp `state.json` in the test body rather than using the existing test-repo helper — this is handled inline in Step 4 above.
- P2: `tests/unit/phases/drift.test.ts` path used in spec's Testing section does not match the actual repo layout (`tests/phases/drift.test.ts`). No action needed beyond the clarification note at the top of this plan.
