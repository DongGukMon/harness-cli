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
| `tests/commands/run.test.ts` | New persistence cases: `noDrift=true` and default `false`; env-override + scoreP5Drift chain |
| `tests/integration/lifecycle.test.ts` | New `--no-drift flag registration` describe (proves Commander accepts the flag) |
| `tests/phases/drift.test.ts` | New cases in `loadDriftThreshold` describe; new `scoreP5Drift` noDrift describe |
| `tests/state.test.ts` | New `noDrift field` describe: migration, createInitialState, round-trip |
| `tests/commands/resume-cmd.test.ts` | New case: reject + readState not called |
| `README.md` | `--no-drift` in start/run flags + precedence sentence + resume freeze note |
| `README.ko.md` | Korean sync |
| `docs/HOW-IT-WORKS.md` | Disabling per-run subsection; `noDrift` in state field list |
| `docs/HOW-IT-WORKS.ko.md` | Korean sync |

---

## Task 1: Core implementation + tests

**Files:** `src/types.ts`, `src/state.ts`, `src/phases/drift.ts`, `src/commands/start.ts`, `src/commands/resume.ts`, `bin/harness.ts`, `tests/commands/run.test.ts`, `tests/integration/lifecycle.test.ts`, `tests/phases/drift.test.ts`, `tests/state.test.ts`, `tests/commands/resume-cmd.test.ts`

- [ ] **Step 1: Write failing tests — `run.test.ts` persistence (P1 integration coverage)**

  Add to the existing `startCommand` describe block in `tests/commands/run.test.ts`:

  ```ts
  it('state.noDrift=true when --no-drift passed', async () => {
    await startCommand('test task', { root: repo.path, noDrift: true });
    const harnessDir = join(repo.path, '.harness');
    const runId = readFileSync(join(harnessDir, 'current-run'), 'utf-8').trim();
    const state = JSON.parse(readFileSync(join(harnessDir, runId, 'state.json'), 'utf-8'));
    expect(state.noDrift).toBe(true);
  });

  it('state.noDrift=false (default) when flag omitted', async () => {
    await startCommand('test task', { root: repo.path });
    const harnessDir = join(repo.path, '.harness');
    const runId = readFileSync(join(harnessDir, 'current-run'), 'utf-8').trim();
    const state = JSON.parse(readFileSync(join(harnessDir, runId, 'state.json'), 'utf-8'));
    expect(state.noDrift).toBe(false);
  });

  it('--no-drift + HARNESS_PHASE_DRIFT_THRESHOLD=0.3 → scoreP5Drift returns activated:false', async () => {
    vi.stubEnv('HARNESS_PHASE_DRIFT_THRESHOLD', '0.3');
    await startCommand('test task', { root: repo.path, noDrift: true });
    const harnessDir = join(repo.path, '.harness');
    const runId = readFileSync(join(harnessDir, 'current-run'), 'utf-8').trim();
    const rawState = JSON.parse(readFileSync(join(harnessDir, runId, 'state.json'), 'utf-8'));
    const { migrateState } = await import('../../src/state.js');
    const { scoreP5Drift } = await import('../../src/phases/drift.js');
    const persistedState = migrateState(rawState);
    const result = await scoreP5Drift({ state: persistedState, runDir: join(harnessDir, runId), cwd: repo.path });
    expect(result.activated).toBe(false);
    vi.unstubAllEnvs();
  });
  ```

- [ ] **Step 2: Write failing tests — `lifecycle.test.ts` Commander flag registration (P1)**

  Add a new describe block to `tests/integration/lifecycle.test.ts`, following the existing `--light flag registration` pattern:

  ```ts
  describe('CLI parser — --no-drift flag registration', () => {
    it('start --help lists --no-drift', () => {
      const res = runCli(['start', '--help']);
      expect(res.status).toBe(0);
      expect(res.stdout).toMatch(/--no-drift/);
    });

    it('run --help lists --no-drift', () => {
      const res = runCli(['run', '--help']);
      expect(res.status).toBe(0);
      expect(res.stdout).toMatch(/--no-drift/);
    });

    it('resume --help lists --no-drift (captured so runtime can reject it)', () => {
      const res = runCli(['resume', '--help']);
      expect(res.status).toBe(0);
      expect(res.stdout).toMatch(/--no-drift/);
    });
  });
  ```

  Note: `tests/integration/lifecycle.test.ts` uses the **built** `dist/bin/harness.js`. Run `pnpm build` before running these tests after the implementation step.

- [ ] **Step 3: Write failing tests — `drift.test.ts` unit + integration**

  Add to the `loadDriftThreshold` describe block in `tests/phases/drift.test.ts` (also add `scoreP5Drift` and `createInitialState` to the imports):

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

  Add a new describe block at the bottom of the file:

  ```ts
  describe('scoreP5Drift — noDrift flag', () => {
    afterEach(() => { vi.unstubAllEnvs(); });

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

- [ ] **Step 4: Write failing tests — `state.test.ts` migration + createInitialState + round-trip**

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

    it('noDrift=true round-trips through writeState/readState', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noDrift-int-'));
      tmpDirs.push(tmpDir);
      const state = createInitialState('run-nd', 'task', 'abc123', false, false, 'full', false, true);
      writeState(tmpDir, state);
      const restored = readState(tmpDir);
      expect(restored?.noDrift).toBe(true);
    });
  });
  ```

- [ ] **Step 5: Write failing test — resume rejects `--no-drift` with `readState` not called**

  Add to `tests/commands/resume-cmd.test.ts` inside the `resumeCommand` describe block:

  ```ts
  it('rejects --no-drift before reading state: exit(1) + stderr + readState not called', async () => {
    setupRun(repo); // creates a valid harness dir + state.json via the helper
    const stateModule = await import('../../src/state.js');
    const readStateSpy = vi.spyOn(stateModule, 'readState');

    await expect(resumeCommand(undefined, { noDrift: true, root: repo.path })).rejects.toThrow('__exit__');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderrSpy.mock.calls.map((c: any) => c[0]).join('')).toContain('--no-drift');
    expect(readStateSpy).not.toHaveBeenCalled();

    readStateSpy.mockRestore();
  });
  ```

- [ ] **Step 6: Run failing tests to confirm they fail**

  ```bash
  cd /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/dogfood-no-drift
  pnpm vitest run tests/commands/run.test.ts tests/phases/drift.test.ts tests/state.test.ts tests/commands/resume-cmd.test.ts 2>&1 | tail -30
  ```

  Expected: failures on all new cases (wrong arg count / missing field / no rejection).

- [ ] **Step 7: Implement — `src/types.ts`**

  Add `noDrift: boolean;` immediately after `codexNoIsolate: boolean;` in `HarnessState`:

  ```ts
  codexNoIsolate: boolean;
  noDrift: boolean;
  dirtyBaseline: string[];
  ```

- [ ] **Step 8: Implement — `src/state.ts` (migrateState)**

  Add migration line immediately after the `codexNoIsolate` migration line:

  ```ts
  if (raw.codexNoIsolate === undefined) raw.codexNoIsolate = false;
  if (raw.noDrift === undefined) raw.noDrift = false;
  ```

- [ ] **Step 9: Implement — `src/state.ts` (createInitialState)**

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

- [ ] **Step 10: Implement — `src/phases/drift.ts`**

  Update `loadDriftThreshold` signature and add short-circuit as the very first statement (before env read):

  ```ts
  export function loadDriftThreshold(autoMode: boolean, noDrift: boolean = false): number | null {
    if (noDrift) return null;
    const raw = process.env['HARNESS_PHASE_DRIFT_THRESHOLD'];
    // ... rest of function unchanged
  ```

  Update `scoreP5Drift`'s call to `loadDriftThreshold`:

  ```ts
  const threshold = loadDriftThreshold(
    input.state.autoMode === true,
    input.state.noDrift === true,
  );
  ```

- [ ] **Step 11: Implement — `src/commands/start.ts`**

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

  Update the `createInitialState` call to pass `noDrift` as the last argument:

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

- [ ] **Step 12: Implement — `src/commands/resume.ts`**

  Add `noDrift?: boolean;` to `ResumeOptions`:

  ```ts
  export interface ResumeOptions {
    root?: string;
    light?: boolean;
    noDrift?: boolean;
  }
  ```

  Add the `noDrift` early-reject block immediately after the `options.light` reject block, before `findHarnessRoot`:

  ```ts
  if (options.noDrift) {
    process.stderr.write(
      "Error: --no-drift is only valid on 'phase-harness start' / 'phase-harness run'. " +
      "Drift policy is frozen at run creation; start a new run with --no-drift if you want to skip drift.\n",
    );
    process.exit(1);
  }
  ```

- [ ] **Step 13: Implement — `bin/harness.ts`**

  Add `--no-drift` to the `start` command (after `--codex-no-isolate`) and update the opts type:

  ```ts
  .option('--no-drift', 'skip P5 → P6 drift detection for this run (equivalent to HARNESS_PHASE_DRIFT_THRESHOLD=off, but persisted per-run)')
  // in action:
  .action(async (task: string | undefined, opts: { requireClean?: boolean; auto?: boolean; enableLogging?: boolean; light?: boolean; codexNoIsolate?: boolean; noDrift?: boolean; track?: string[]; exclude?: string[] }) => {
  ```

  Apply the identical change to the `run` command.

  Add `--no-drift` to the `resume` command and update its opts type:

  ```ts
  .option('--no-drift', '(rejected — drift policy is frozen at run creation)')
  .action(async (runId: string | undefined, opts: { light?: boolean; noDrift?: boolean }) => {
  ```

  `noDrift` flows via `{ ...opts }` spread in start/run; resume forwards `opts` to `resumeCommand` which rejects early.

- [ ] **Step 14: Build, then run all tests including lifecycle integration**

  ```bash
  pnpm build && pnpm vitest run 2>&1 | tail -30
  ```

  Expected: `dist/bin/harness.js` updated, all tests green including the lifecycle `--no-drift` flag registration tests.

- [ ] **Step 15: Commit**

  ```bash
  git add src/types.ts src/state.ts src/phases/drift.ts src/commands/start.ts src/commands/resume.ts bin/harness.ts tests/commands/run.test.ts tests/integration/lifecycle.test.ts tests/phases/drift.test.ts tests/state.test.ts tests/commands/resume-cmd.test.ts
  git commit -m "feat(drift): add --no-drift start flag to disable drift detection per-run"
  ```

---

## Task 2: Docs sync

**Files:** `README.md`, `README.ko.md`, `docs/HOW-IT-WORKS.md`, `docs/HOW-IT-WORKS.ko.md`

- [ ] **Step 1: Update `README.md`**

  In the `### phase-harness start [task]` section, add `--no-drift` to the Flags list (after `--codex-no-isolate`) and add a note that `run` accepts the same flags:

  ```
  - `--no-drift` — skip P5 → P6 drift detection for this run (equivalent to `HARNESS_PHASE_DRIFT_THRESHOLD=off`, but persisted per-run)
  ```

  After the Flags list, add:
  ```
  `phase-harness run` accepts all the same flags as `start`.
  ```

  In the `HARNESS_PHASE_DRIFT_THRESHOLD` row of the env-variable table, append to the existing description:

  ```
  `--no-drift` overrides `HARNESS_PHASE_DRIFT_THRESHOLD` when both are set.
  ```

  In the `### phase-harness resume [runId]` section, add a freeze note (after the `--light` freeze note if present):

  ```
  `--no-drift` is a start-time choice only. Drift policy is frozen at run creation; `phase-harness resume --no-drift` is rejected.
  ```

- [ ] **Step 2: Update `README.ko.md`**

  Apply the same four changes in Korean:

  Flags 목록에 추가:
  ```
  - `--no-drift` — 이 run에서 P5 → P6 drift 검출을 비활성화 (`HARNESS_PHASE_DRIFT_THRESHOLD=off`와 동등하나 run 단위로 영구 저장됨)
  ```

  `run`도 동일 플래그 수용 안내:
  ```
  `phase-harness run`도 `start`와 동일한 플래그를 모두 지원합니다.
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

  In the state.json field list, add `noDrift` on the `codexNoIsolate` line:

  ```
  - `loggingEnabled`, `codexNoIsolate`, `noDrift`
  ```

- [ ] **Step 4: Update `docs/HOW-IT-WORKS.ko.md`**

  Apply the same changes in Korean.

  Drift 검출 섹션에 추가:
  ```markdown
  **per-run 비활성화 (`--no-drift`):** `phase-harness start` 또는 `phase-harness run`에 `--no-drift`를 전달하면 해당 run에서 drift 검출이 완전히 비활성화됩니다. 이 플래그는 run 생성 시 `state.noDrift: true`로 저장되며, run 수명 전체에 걸쳐 `HARNESS_PHASE_DRIFT_THRESHOLD`보다 우선합니다. `phase-harness resume --no-drift`는 거부됩니다 — drift 정책은 run 생성 시 고정됩니다. drift 검출을 다시 활성화하려면 플래그 없이 새 run을 시작하세요.
  ```

  state.json 필드 목록:
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

- [ ] **Step 6: Typecheck + full test suite + build**

  ```bash
  pnpm tsc --noEmit && pnpm vitest run && pnpm build 2>&1 | tail -20
  ```

  Expected: zero errors, all green.

- [ ] **Step 7: Commit**

  ```bash
  git add README.md README.ko.md docs/HOW-IT-WORKS.md docs/HOW-IT-WORKS.ko.md
  git commit -m "docs: add --no-drift to README and HOW-IT-WORKS (docs sync)"
  ```

---

## Deferred

- P2 (prior round): `tests/unit/phases/drift.test.ts` path in spec does not match actual repo layout (`tests/phases/drift.test.ts`); no action needed beyond the note at the top of this plan.
- plan-bug: gate-7 P1 — eval report shows "Verification skipped by user (escalation override)"; Phase 6 harness-verify.sh must re-run with actual results. Local verification confirmed all green: `pnpm tsc --noEmit` ✅ `pnpm vitest run` (1215 tests) ✅ `pnpm build` ✅. Phase 5 cannot update the eval report (Phase 6 artifact); requires Phase 6 re-execution.
- plan-bug: checklist.json `docs-token-presence` command broken on macOS — `wc -l` outputs leading spaces (`       4\n`), causing `grep -q '^4$'` to fail. Fixed in-place: added `| xargs` before final grep to strip whitespace. Root cause of all Phase 6 verify-feedback `docs-token-presence: FAIL` reruns.
