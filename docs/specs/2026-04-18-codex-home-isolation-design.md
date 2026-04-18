# Codex Subprocess `CODEX_HOME` Isolation — BUG-C Permanent Fix

**Status**: design + impl plan + eval checklist (combined, per compressed `/harness` flow)
**Issue**: Project `CLAUDE.md` open-issues table row #13
**Date**: 2026-04-18

## Cross-references

- `docs/specs/2026-04-18-gate-prompt-hardening-design.md` §BUG-C — original contamination path + prompt-level mitigation (PR #11)
- `src/context/assembler.ts` `REVIEWER_CONTRACT_BASE` — "Scope rules" stanza from PR #11 (retained as defense in depth)
- `src/runners/codex.ts` — `runCodexInteractive` L25 + `runCodexGate` L312 (the two spawn sites)
- `src/types.ts` `HarnessState` — gains one new field (`codexNoIsolate`)

## 1. Background

Codex gate subprocesses spawn from harness inherit the parent's `HOME`. Codex then loads `~/.codex/AGENTS.md`, which contains the user's personal conventions (e.g., "Lore Commit Protocol"). When codex is acting as reviewer of an *external* project, it applies those personal conventions to the work under review — a reviewer-domain leak known as **BUG-C**.

PR #11 added a "Scope rules" stanza to `REVIEWER_CONTRACT_BASE` telling the reviewer to ignore personal `AGENTS.md` conventions. That is a prompt-level *mitigation* — effective against a cooperative reviewer, but brittle (a distracted/adversarial reviewer can still leak). This spec is the root-cause fix: make the personal `AGENTS.md` *unreadable* to the subprocess.

## 2. Goal / Non-goal

**Goal**: Codex gate + codex-interactive subprocesses run in an isolated codex home where the user's personal `AGENTS.md` (and other customizations: `agents/`, `prompts/`, `skills/`, `rules/`, `memories/`, `hooks.json`) are not reachable, while auth + session-resume continue to work.

**Non-goals**:
- Claude runner HOME isolation (separate issue).
- Modifying the user's real `~/.codex/` directory contents.
- Removing the PR #11 scope-rules stanza (retained as defense in depth).

## 3. Key finding (spike)

`codex exec` — both the fresh `exec` form and `exec resume` — respects the `CODEX_HOME` environment variable. Verified by manual smoke test:

```bash
# Spike 1: fresh exec with CODEX_HOME → only auth.json symlink → succeeds
mkdir -p /tmp/iso && ln -sf ~/.codex/auth.json /tmp/iso/auth.json
CODEX_HOME=/tmp/iso codex exec --model <m> 'FIRST_OK'   # → session id: <sid>
# Session file written under /tmp/iso/sessions/YYYY/MM/DD/rollout-*.jsonl

# Spike 2: resume round-trips, recalls prior context
CODEX_HOME=/tmp/iso codex exec resume <sid> --model <m> 'recall first reply'
# → codex replies: "RESUMED_OK FIRST_OK" (session fully reachable)
```

This means we can override `CODEX_HOME` (not full `HOME`) and bootstrap the isolated dir with **only `auth.json`**. `config.toml` is not required (codex falls back to defaults, which is what we want — the user's profile/aliases shouldn't apply to reviewer runs).

## 4. Design

### 4.1 Isolated directory layout — per-run

For each harness run, the isolated codex home lives at:

```
<runDir>/codex-home/            (= <harnessDir>/<runId>/codex-home/)
├── auth.json   → symlink to <real-codex-home>/auth.json
├── sessions/   (created by codex as needed — gate session rollouts)
└── …           (cache/, logs_2.sqlite, etc. — codex creates at will)
```

Where *real codex home* is resolved as: `process.env.CODEX_HOME || path.join(os.homedir(), '.codex')` — this respects users who have already set `CODEX_HOME` globally for their own terminal sessions.

**Why per-run (not per-project or global)**:
- Matches existing harness artifact layout (runDir holds `state.json`, `events.jsonl`, feedback files, etc.). One more subdir is natural.
- Run cleanup is automatic: deleting `.harness/<runId>/` reclaims codex artifacts too.
- Resume works because *all* gate invocations within one run see the same `runDir` → same `codex-home/` → same `sessions/` dir.
- No cross-run / cross-project session leakage.

**What gets symlinked**: only `auth.json`. Omitting `config.toml` means:
- No user profile leak (profiles in `config.toml` can re-introduce AGENTS-like prompts).
- Reviewer runs use codex defaults — deterministic.
- We already pass `--model` + `-c model_reasoning_effort=…` on every spawn, so defaults are fine.

**What is deliberately NOT present**: `AGENTS.md`, `agents/`, `prompts/`, `skills/`, `rules/`, `memories/`, `hooks.json`. Absence is the point — codex loads nothing personal.

### 4.2 Spawn-time env override

Both codex spawns (L55 `exec` and L197 `exec resume`) add:

```ts
spawn(codexBin, args, {
  …existing options…,
  env: codexHome === null
    ? process.env                                   // --codex-no-isolate escape
    : { ...process.env, CODEX_HOME: codexHome },
});
```

`codexHome: string | null` is a new parameter threaded in from the runner's caller:
- `runCodexInteractive(phase, state, preset, harnessDir, runDir, promptFile, cwd, codexHome)`
- `runCodexGate(phase, preset, prompt, harnessDir, cwd, resumeSessionId?, buildFreshPromptOnFallback?, codexHome?)`

`null` means "no isolation" (escape hatch). The default caller behavior is to always pass a non-null path.

### 4.3 Bootstrap — `ensureCodexIsolation(runDir)`

New module `src/runners/codex-isolation.ts`:

```ts
export class CodexIsolationError extends Error { readonly code = 'CODEX_ISOLATION_FAILED'; }

export function codexHomeFor(runDir: string): string {
  return path.join(runDir, 'codex-home');
}

export function ensureCodexIsolation(runDir: string): string {
  const codexHome = codexHomeFor(runDir);
  try {
    fs.mkdirSync(codexHome, { recursive: true });
  } catch (err) {
    throw new CodexIsolationError(
      `Failed to create isolated codex home at ${codexHome}: ${(err as Error).message}`
    );
  }

  const realHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const authSrc = path.join(realHome, 'auth.json');
  if (!fs.existsSync(authSrc)) {
    throw new CodexIsolationError(
      `Codex auth not found at ${authSrc}. Run 'codex login' first, ` +
      `or pass --codex-no-isolate to bypass isolation (not recommended).`
    );
  }

  const authDst = path.join(codexHome, 'auth.json');
  try { fs.unlinkSync(authDst); } catch { /* missing ok */ }
  try {
    fs.symlinkSync(authSrc, authDst);
  } catch (err) {
    throw new CodexIsolationError(
      `Failed to symlink codex auth into ${authDst}: ${(err as Error).message}`
    );
  }

  return codexHome;
}
```

**Idempotent**: every gate call re-runs `ensureCodexIsolation(runDir)`. `mkdirSync({recursive: true})` is a no-op on existing dirs; `unlink + symlink` refreshes the auth link (handles the edge case where the user re-logged in mid-run and `~/.codex/auth.json` was rewritten — symlinks resolve live, but an unlinked+remade symlink is guaranteed correct).

**All filesystem failures wrap to `CodexIsolationError`**: `mkdir`, the `auth.json` existence check, and `symlink` each live inside their own try/catch (or explicit existence check) that rethrows a `CodexIsolationError` with the underlying message. Raw EACCES/ENOENT/etc. never escape this function.

**Failure mode**: throws `CodexIsolationError` with an actionable message. Caller converts to gate-error (no retry — surfaces to user immediately).

### 4.4 Caller integration

```ts
// src/phases/gate.ts  (around L272)
const codexHome = state.codexNoIsolate ? null : ensureCodexIsolation(runDir);
const result = await runCodexGate(phase, preset, prompt, harnessDir, cwd,
                                  resumeSessionId, fallbackBuilder, codexHome);

// src/phases/interactive.ts  (around L213 for codex-interactive branch)
const codexHome = state.codexNoIsolate ? null : ensureCodexIsolation(runDir);
const result = await runCodexInteractive(phase, state, preset, harnessDir, runDir,
                                         promptFile, cwd, codexHome);
```

`ensureCodexIsolation` throwing propagates up to the normal error-handling path (`CodexIsolationError` is a subclass of `Error` so the existing try/catch boundaries catch it). Gate path converts to a `gate_error` event; interactive path fails the phase with the isolation error written to a sidecar `codex-<phase>-error.md`.

### 4.5 State + migration

Add one field to `HarnessState`:

```ts
export interface HarnessState {
  …existing fields…
  codexNoIsolate: boolean;  // escape hatch decision, persisted for resume
}
```

Migration (`src/state.ts` `migrateState`): `if (raw.codexNoIsolate === undefined) raw.codexNoIsolate = false;`

`createInitialState(runId, task, baseCommit, autoMode, loggingEnabled, codexNoIsolate = false)` threads the option.

**Test fixture sweep**. This repo has hand-written `HarnessState` objects in multiple test files that must be updated to include the new field, or `pnpm tsc --noEmit` fails. The sweep target list (discovered via `rg 'HarnessState' tests/`):

- `tests/state.test.ts` — migration + round-trip tests (update + add a `codexNoIsolate` migration case).
- `tests/phases/gate-resume.test.ts` — state fixtures used for resume/lineage tests.
- `tests/commands/inner.test.ts` — state fixtures for inner command tests.
- `tests/integration/logging.test.ts` — state fixtures that produce the session meta.
- Any additional files surfaced by `rg 'HarnessState' tests/` at impl time.

Each fixture either (a) uses `createInitialState(...)` — zero-diff thanks to default `codexNoIsolate = false`, or (b) constructs a state literal — requires adding `codexNoIsolate: false`.

### 4.6 CLI flag

New option on `harness start` and `harness run` in `bin/harness.ts`:

```ts
.option('--codex-no-isolate', 'bypass CODEX_HOME isolation for codex subprocesses (not recommended)')
```

`StartOptions.codexNoIsolate?: boolean` → passed to `createInitialState`.

Not surfaced on `harness resume` — decision is fixed at run-start time. Resume reads `state.codexNoIsolate` and honors it.

### 4.7 Logging

Add `codexHome` (absolute path) to `SessionMeta` (`~/.harness/sessions/<hash>/<runId>/meta.json`). Written once on session bootstrap by `sessionLogger.writeMeta(…)`. No per-event overhead.

Concrete integration points:

- `src/types.ts` — extend `SessionMeta` with `codexHome?: string` (optional for back-compat when `--codex-no-isolate` is set).
- `src/logger.ts` — **both** `FileSessionLogger.writeMeta` and `FileSessionLogger.updateMeta` build the `meta: SessionMeta` object from a fixed field list; neither spreads `partial`. A new `codexHome?` field would be silently dropped unless wired explicitly. Required changes:
  - `writeMeta`: add `...(partial.codexHome !== undefined ? { codexHome: partial.codexHome } : {})` to the constructed meta literal.
  - `updateMeta`: accept `codexHome` in the `update` param type; on the lazy-bootstrap branch (resume with missing meta.json), include it in the constructed meta; on the merge branch (meta.json exists), set `meta.codexHome = update.codexHome` when provided. Matches `task` handling semantics.
- `src/commands/inner.ts` — **all five** meta-writing call sites must thread `codexHome`. Using the helper `const codexHome = state.codexNoIsolate ? undefined : codexHomeFor(runDir);` at function entry:
  1. `bootstrapSessionLogger` L281 (fresh-start branch, `writeMeta`): `{ task: state.task }` → `{ task: state.task, codexHome }`.
  2. `bootstrapSessionLogger` L274 (resume branch, `updateMeta`): `{ pushResumedAt: Date.now(), task: state.task }` → `{ pushResumedAt: Date.now(), task: state.task, codexHome }`.
  3. `bootstrapSessionLogger` L278 (idempotent re-entry branch, `updateMeta`): `{ pushResumedAt: Date.now() }` → `{ pushResumedAt: Date.now(), codexHome }`.
  4. `buildConfigCancelHandler` L246 (fresh-start branch, `writeMeta`): same change as #1.
  5. `buildConfigCancelHandler` L243 (resume branch, `updateMeta`): same change as #2.
- Use `codexHomeFor` (pure function — no FS side effect) so meta reflects the planned path even before the first codex-phase invocation.

This is pure observability — post-mortem debugging ("where did that session rollout file go?") without bloating `events.jsonl`.

### 4.8 Defense in depth

The PR #11 scope-rules stanza in `REVIEWER_CONTRACT_BASE` **stays**. Reasons:

- Cheap (prompt tokens are fixed cost per run).
- Survives hypothetical bypasses of isolation (future bug in `ensureCodexIsolation`, new codex feature that ignores `CODEX_HOME`, etc.).
- Fail-closed: even if isolation silently degrades, the reviewer is still told "ignore personal conventions".

## 5. Scope

**Modify**
- `src/runners/codex.ts` — add `codexHome` param to both runner functions; thread to spawn `env`.
- `src/phases/gate.ts` — call `ensureCodexIsolation(runDir)` before `runCodexGate`.
- `src/phases/interactive.ts` — same, for codex-interactive branch.
- `src/types.ts` — `HarnessState.codexNoIsolate: boolean`.
- `src/state.ts` — migration default + `createInitialState` param.
- `src/commands/start.ts` — `StartOptions.codexNoIsolate` plumbing.
- `bin/harness.ts` — `--codex-no-isolate` option on `start` + `run`.
- `src/logger.ts` (or wherever `SessionMeta` is written) — include `codexHome` in meta.

**Create**
- `src/runners/codex-isolation.ts` — module described in §4.3.
- `tests/runners/codex-isolation.test.ts` — unit tests (§7).

**Do NOT modify**
- `src/context/assembler.ts` — `REVIEWER_CONTRACT_BASE` scope-rules stanza retained.
- Claude runner (`src/runners/claude.ts`) — separate issue.
- Real `~/.codex/` contents — never touched, only read via symlink.
- Gate prompt construction / verdict parsing — isolation is orthogonal.

## 6. Error handling

| Failure | Handling |
|---|---|
| `mkdir` fails (permission / disk full) | `CodexIsolationError` → gate error, visible to user. No retry. |
| Real `auth.json` missing | `CodexIsolationError` with "run `codex login`" message. No retry. |
| `symlink` syscall fails | `CodexIsolationError` with underlying errno. No retry. |
| Real `auth.json` exists but points at broken target | Codex spawn fails with auth error (same as today without isolation). |
| User passes `--codex-no-isolate` | Isolation skipped entirely. Log warning line in stderr at run-start. |

Fallback policy: **abort, not silent bypass**. Silent fallback to non-isolated would re-expose BUG-C with no signal. The escape hatch flag is the explicit user-authorized path.

## 7. Testing

### 7.1 Unit — `tests/runners/codex-isolation.test.ts` (new)

- `ensureCodexIsolation` creates `<runDir>/codex-home/` when absent.
- `ensureCodexIsolation` is idempotent (second call on same `runDir` succeeds).
- Symlink points at real `auth.json` (use `tmpdir` + fake real-home fixture; override `process.env.CODEX_HOME` for the test).
- Throws `CodexIsolationError` when real `auth.json` missing.
- Throws `CodexIsolationError` when `mkdir` fails (e.g., target path is an existing file).

### 7.2 Unit — `tests/runners/codex.test.ts` + `codex-resume.test.ts` (extend)

- When `codexHome` non-null is passed to `runCodexGate`, `spawn.mock.calls[0][2].env.CODEX_HOME` equals that path.
- When `codexHome` is null (escape hatch), `spawn.mock.calls[0][2].env` does NOT contain `CODEX_HOME` (or equals `process.env` unchanged — whichever the impl does).
- `runCodexInteractive` variant of the same check.
- Resume path: `CODEX_HOME` passed on both initial resume and fresh-fallback spawns.

### 7.3 Integration — existing harness

- First codex-phase invocation (gate or codex-interactive) creates `<runDir>/codex-home/auth.json` (symlink). Creation is lazy-at-first-use, not at `harness start` — this keeps the start path unchanged and auth errors surface as gate errors (the same boundary where they're already handled). `SessionMeta.codexHome` is pre-populated with the *planned* path at bootstrap time (via pure `codexHomeFor(runDir)`), so observability doesn't depend on creation timing.
- `--codex-no-isolate` flag: `codex-home/` is NOT created; `state.codexNoIsolate === true`; runner spawns without `CODEX_HOME`.
- `harness resume` on a run started with `--codex-no-isolate` preserves the decision (state already has the flag; resume doesn't re-ask).

### 7.4 Manual smoke (documented in PR body)

- Run `harness run --enable-logging "say hi"` in a throwaway git repo. Verify:
  - `.harness/<runId>/codex-home/auth.json` exists as a symlink.
  - `.harness/<runId>/codex-home/sessions/…/rollout-*.jsonl` is created by the first gate.
  - Gate verdict does NOT reference user's personal convention content (e.g., "Lore Commit Protocol" keywords absent from `gate-2-raw.txt`).
- Run with `--codex-no-isolate` and confirm `codex-home/` is not created.

## 8. Eval checklist (consumed by Phase 6 `harness-verify.sh`)

Structural (build gates):

```
- pnpm tsc --noEmit            → exit 0
- pnpm vitest run              → all pass (baseline 531 + new tests)
- pnpm build                   → exit 0 (tsc + copy-assets)
- file exists: src/runners/codex-isolation.ts
- grep-assert: "codexNoIsolate" present in src/types.ts
- grep-assert: "CODEX_HOME" present in src/runners/codex.ts
- grep-assert: "--codex-no-isolate" present in bin/harness.ts
- grep-assert: "Scope rules" still present in src/context/assembler.ts (defense-in-depth retained)
```

Behavioral (prove the fix, not just surface changes):

```
- test passes: "ensureCodexIsolation creates <runDir>/codex-home/ with auth.json symlink" in tests/runners/codex-isolation.test.ts
- test passes: "ensureCodexIsolation is idempotent on second call" in tests/runners/codex-isolation.test.ts
- test passes: "ensureCodexIsolation throws CodexIsolationError when real auth.json missing" in tests/runners/codex-isolation.test.ts
- test passes: "runCodexGate spawn env contains CODEX_HOME=<provided path>" in tests/runners/codex.test.ts OR codex-resume.test.ts
- test passes: "runCodexGate spawn env does NOT contain CODEX_HOME when codexHome is null (escape hatch)" (same file)
- test passes: "runCodexInteractive spawn env contains CODEX_HOME=<provided path>" (same file)
- test passes: "gate.ts propagates CodexIsolationError as gate_error (no retry)" in tests/phases/gate.test.ts
- test passes: "interactive.ts propagates CodexIsolationError as phase error" in tests/phases/interactive.test.ts
- test passes: "codex-interactive branch in interactive.ts calls ensureCodexIsolation(runDir) and passes codexHomeFor(runDir) to runCodexInteractive" in tests/phases/interactive.test.ts
- test passes: "startCommand with --codex-no-isolate sets state.codexNoIsolate=true and emits stderr warning" in tests/commands/run.test.ts
- test passes: "migrateState adds codexNoIsolate=false to legacy state" in tests/state.test.ts
- test passes: "resumeCommand preserves state.codexNoIsolate=true across resume" in tests/commands (or equivalent resume test file)
- test passes: "first gate invocation creates <runDir>/codex-home/auth.json symlink" in tests/phases/gate.test.ts (lazy-at-first-use, not startCommand)
- test passes: "ensureCodexIsolation bootstraps ONLY auth.json — absent: AGENTS.md, config.toml, agents/, prompts/, skills/, rules/, memories/, hooks.json" in tests/runners/codex-isolation.test.ts
- test passes: "SessionMeta contains codexHome path when isolation enabled" in tests/integration/logging.test.ts (or tests/logger.test.ts)
- test passes: "SessionMeta does NOT contain codexHome when --codex-no-isolate" (same file)
- test passes: "updateMeta lazy-bootstrap path (resume with missing meta.json) persists codexHome" in tests/logger.test.ts
- test passes: "buildConfigCancelHandler writeMeta path persists codexHome (regression guard for second call site)" in tests/logger.test.ts OR tests/commands/inner.test.ts
- test passes: "ensureCodexIsolation wraps mkdir/symlink EACCES failures as CodexIsolationError" in tests/runners/codex-isolation.test.ts
- test passes: "resume-fallback path (session_missing → fresh) — BOTH spawn calls carry CODEX_HOME=<provided path>" in tests/runners/codex-resume.test.ts
```

Evidence (attached to PR body):

```
- Manual smoke artifact: harness run in a throwaway repo produces
  .harness/<runId>/codex-home/auth.json as a symlink pointing at real auth.
- Manual smoke artifact: .harness/<runId>/codex-home/sessions/YYYY/MM/DD/rollout-*.jsonl
  is populated after first gate fires.
- Manual smoke artifact: gate verdict (gate-2-raw.txt) does NOT reference user's
  personal convention content (grep -i 'lore commit protocol' returns no hits).
- Manual smoke artifact: harness run --codex-no-isolate does NOT create codex-home/,
  state.json contains "codexNoIsolate": true, stderr warning line visible.
```

## 9. Implementation plan (ordered)

TDD rhythm: where a test is listed before its implementation, write the failing test first, then the code that makes it pass. Where an interface change precedes tests (e.g. adding a required state field), the fixture sweep is mechanical and tests come after.

1. **Write failing unit tests for `ensureCodexIsolation`** — `tests/runners/codex-isolation.test.ts` per §7.1. These fail because the module doesn't exist.
2. **Scaffold `src/runners/codex-isolation.ts`** (§4.3). Export `CodexIsolationError`, `codexHomeFor`, `ensureCodexIsolation`. Step 1 tests now pass.
3. **Type + state migration**:
   - `src/types.ts`: add `HarnessState.codexNoIsolate: boolean` and `SessionMeta.codexHome?: string`.
   - `src/state.ts`: `migrateState` defaults `codexNoIsolate = false`; extend `createInitialState` signature.
   - **Fixture sweep** (§4.5): update every hand-written `HarnessState` literal in tests to include `codexNoIsolate: false`. Run `pnpm tsc --noEmit` iteratively until clean.
   - Add one migration test case to `tests/state.test.ts`: legacy state (no field) → migrated state has `codexNoIsolate: false`.
4. **Runner signature extension**: `runCodexInteractive` + `runCodexGate` accept `codexHome: string | null` param. Spawn `env` branch per §4.2. Existing tests still pass (default null preserves current spawn options).
5. **Runner env tests** (§7.2) — extend `tests/runners/codex.test.ts` + `codex-resume.test.ts` with env-capture assertions: when `codexHome` is a path, `spawn.mock.calls[i][2].env.CODEX_HOME === codexHome`; when null, no `CODEX_HOME` present. Both fresh and resume spawn paths asserted.
6. **Caller integration** (gate):
   - Write failing test in `tests/phases/gate.test.ts` asserting `CodexIsolationError` → `gate_error` (no retry).
   - Modify `src/phases/gate.ts` to call `ensureCodexIsolation(runDir)` unless `state.codexNoIsolate`; wrap in try/catch producing a `GatePhaseResult` error. Test passes.
7. **Caller integration** (interactive):
   - Write failing tests in `tests/phases/interactive.test.ts` for the codex-interactive branch:
     - **Positive path**: when `state.codexNoIsolate === false`, `ensureCodexIsolation(runDir)` is invoked and `codexHomeFor(runDir)` is passed to `runCodexInteractive` (spy on `ensureCodexIsolation` + assert `runCodexInteractive.mock.calls[0]` includes the expected path arg).
     - **Error propagation**: when `ensureCodexIsolation` throws `CodexIsolationError`, the phase surfaces it as an interactive phase error (not a retry-eligible condition).
   - Modify `src/phases/interactive.ts` codex branch with same pattern as gate. Tests pass.
8. **CLI flag + warning**:
   - `bin/harness.ts`: add `--codex-no-isolate` option on `start` and `run` subcommands.
   - `src/commands/start.ts`: `StartOptions.codexNoIsolate?: boolean`, threaded into `createInitialState`. On `true`, emit stderr warning: `⚠️  CODEX_HOME isolation disabled. Codex subprocess may load personal conventions (BUG-C risk).`
   - Extend `tests/commands/run.test.ts` with two cases: flag sets `state.codexNoIsolate = true` AND emits the warning line; absence of flag leaves it `false`.
9. **Logger/SessionMeta integration** (per §4.7 — three file edits + five call-site updates):
   - `src/types.ts`: add `codexHome?: string` to `SessionMeta`.
   - `src/logger.ts` — `FileSessionLogger.writeMeta`: extend the constructed `meta: SessionMeta` literal with `...(partial.codexHome !== undefined ? { codexHome: partial.codexHome } : {})`. Mirror pattern used today for `bootstrapOnResume`.
   - `src/logger.ts` — `FileSessionLogger.updateMeta`: extend the `update` param type to include `codexHome?: string`. In the lazy-bootstrap branch, include it in the freshly constructed meta. In the merge branch, set `meta.codexHome = update.codexHome` when provided.
   - `src/commands/inner.ts` — **five** call-site updates. At the top of each function compute `const codexHome = state.codexNoIsolate ? undefined : codexHomeFor(runDir);`, then thread to every meta write:
     1. `bootstrapSessionLogger` L281: `writeMeta({ task: state.task, codexHome })`.
     2. `bootstrapSessionLogger` L274 (resume): `updateMeta({ pushResumedAt: Date.now(), task: state.task, codexHome })`.
     3. `bootstrapSessionLogger` L278 (idempotent re-entry): `updateMeta({ pushResumedAt: Date.now(), codexHome })`.
     4. `buildConfigCancelHandler` L246: `writeMeta({ task: state.task, codexHome })`.
     5. `buildConfigCancelHandler` L243 (resume): `updateMeta({ pushResumedAt: Date.now(), task: state.task, codexHome })`.
   - Tests (extending `tests/integration/logging.test.ts` or `tests/logger.test.ts`):
     - `meta.json` includes `codexHome` path after normal bootstrap.
     - `meta.json` does NOT include `codexHome` when `--codex-no-isolate`.
     - Lazy-bootstrap (resume with missing `meta.json`) via `bootstrapSessionLogger` path persists `codexHome`.
     - Idempotent re-entry via `bootstrapSessionLogger` L278 path preserves/writes `codexHome`.
     - Config-cancel path (both fresh-start and resume branches) writes/preserves `codexHome`.
10. **Typecheck + full vitest run + build**. Fix any breakage surfaced by the fixture sweep.
11. **Manual smoke** (§7.4). Capture evidence per §8 Evidence block. Save to PR body.
12. **PR**.

## 10. Open Questions — resolved

| # | Question | Resolution |
|---|---|---|
| Q1 | Isolated dir location | **(A) per-run** `<runDir>/codex-home/` — matches harness layout, auto-cleanup, same dir across gates in one run enables resume. |
| Q2 | Files to bootstrap | **`auth.json` only** (symlink). No `config.toml` — spike confirmed not required; also prevents profile-via-config leak. AGENTS.md absent by design. |
| Q3 | Env strategy | **`CODEX_HOME` override**, NOT full `HOME` override. Codex supports `CODEX_HOME` natively (confirmed by spike); preserves auth without symlink dance around credential files that may or may not live in `~/.codex/`. |
| Q4 | Resume compat | Same `runDir` → same `codex-home/` → same `sessions/` dir. Spike round-tripped `exec` → `exec resume` cleanly. |
| Q5 | Fallback | **Abort** on isolation failure (not silent bypass). Escape hatch = explicit `--codex-no-isolate` CLI flag, persisted to `state.codexNoIsolate`. |
| Q6 | Scope-rules stanza | **Keep** as defense-in-depth. Low cost, survives future isolation bypass bugs. |

## 11. Risks + mitigations

- **Risk: codex refreshes auth token and the symlink behavior under atomic-rename breaks**. Mitigation: symlinks resolve at read time; atomic rename of the real `auth.json` is seen by the next `open()` through the symlink. Tested: the real codex CLI uses `~/.codex/` directly and atomic-replaces; no observed issue during spike. If it ever becomes a concern, we can switch to a hard link (within same filesystem) or a copy-and-refresh heuristic.
- **Risk: user runs `codex login` mid-harness-session and the auth state diverges**. Mitigation: `ensureCodexIsolation` is called before every gate spawn and refreshes the symlink. Any subsequent gate sees the live `auth.json`.
- **Risk: Windows filesystem symlink permissions**. Not a concern — harness is macOS/Linux only (preflight gate already checks `platform`).
- **Risk: `CODEX_HOME` semantics change in a future codex release**. Mitigation: scope-rules stanza is still in the prompt; if `CODEX_HOME` silently stops working, the mitigation still blocks contamination. We'd see it in test output and can adjust.

## 12. Out of scope (explicit)

- Claude runner HOME isolation (separate PR, separate issue).
- Light-flow code (Group A).
- `advisor()` removal / orphan text fix (Group B).
- CLAUDE.md doc refresh (Group C).
- Changes to user's real `~/.codex/` directory.
- Enforcing codex login — if the user hasn't logged in, `ensureCodexIsolation` surfaces the missing-auth error, same UX as today.
