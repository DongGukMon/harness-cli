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
  fs.mkdirSync(codexHome, { recursive: true });

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
  fs.symlinkSync(authSrc, authDst);

  return codexHome;
}
```

**Idempotent**: every gate call re-runs `ensureCodexIsolation(runDir)`. `mkdirSync({recursive: true})` is a no-op on existing dirs; `unlink + symlink` refreshes the auth link (handles the edge case where the user re-logged in mid-run and `~/.codex/auth.json` was rewritten — symlinks resolve live, but an unlinked+remade symlink is guaranteed correct).

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

### 4.6 CLI flag

New option on `harness start` and `harness run` in `bin/harness.ts`:

```ts
.option('--codex-no-isolate', 'bypass CODEX_HOME isolation for codex subprocesses (not recommended)')
```

`StartOptions.codexNoIsolate?: boolean` → passed to `createInitialState`.

Not surfaced on `harness resume` — decision is fixed at run-start time. Resume reads `state.codexNoIsolate` and honors it.

### 4.7 Logging

Add `codexHome` (absolute path) to `SessionMeta` (`~/.harness/sessions/<hash>/<runId>/meta.json`). Written once on session bootstrap by `sessionLogger.writeMeta(…)`. No per-event overhead.

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

- Default `harness start`/`harness run` new-run creates `<runDir>/codex-home/auth.json` (symlink) before any gate fires.
- `--codex-no-isolate` flag: `codex-home/` is NOT created; `state.codexNoIsolate === true`.
- `harness resume` on a run started with `--codex-no-isolate` preserves the decision.

### 7.4 Manual smoke (documented in PR body)

- Run `harness run --enable-logging "say hi"` in a throwaway git repo. Verify:
  - `.harness/<runId>/codex-home/auth.json` exists as a symlink.
  - `.harness/<runId>/codex-home/sessions/…/rollout-*.jsonl` is created by the first gate.
  - Gate verdict does NOT reference user's personal convention content (e.g., "Lore Commit Protocol" keywords absent from `gate-2-raw.txt`).
- Run with `--codex-no-isolate` and confirm `codex-home/` is not created.

## 8. Eval checklist (consumed by Phase 6 `harness-verify.sh`)

```
- pnpm tsc --noEmit            → exit 0
- pnpm vitest run              → all pass (baseline 531 + new tests)
- pnpm build                   → exit 0 (tsc + copy-assets)
- test exists: tests/runners/codex-isolation.test.ts
- test exists: assertion "CODEX_HOME" in tests/runners/codex.test.ts OR codex-resume.test.ts
- file exists: src/runners/codex-isolation.ts
- grep-assert: "codexNoIsolate" present in src/types.ts
- grep-assert: "CODEX_HOME" present in src/runners/codex.ts
- grep-assert: "--codex-no-isolate" present in bin/harness.ts
- grep-assert: "Scope rules" still present in src/context/assembler.ts (defense-in-depth retained)
```

## 9. Implementation plan (ordered)

1. **Scaffold `src/runners/codex-isolation.ts`** (§4.3). Export `CodexIsolationError`, `codexHomeFor`, `ensureCodexIsolation`.
2. **Unit test `tests/runners/codex-isolation.test.ts`** (§7.1) — TDD: write first, fail, then step 1 makes them pass.
3. **Type + state migration**: `HarnessState.codexNoIsolate`, `migrateState`, `createInitialState` signature. Update existing call sites (`start.ts`).
4. **Runner signature extension**: `runCodexInteractive` + `runCodexGate` accept `codexHome: string | null`. Spawn `env` branch. Existing tests still pass (backward-compat default).
5. **Runner env tests** (§7.2) — extend existing codex test files with env-capture assertions.
6. **Caller integration**: `src/phases/gate.ts` + `src/phases/interactive.ts` call `ensureCodexIsolation(runDir)` unless `state.codexNoIsolate`.
7. **CLI flag**: `bin/harness.ts` + `StartOptions` (`src/commands/start.ts`).
8. **Logging**: add `codexHome` to `SessionMeta` write-through.
9. **Integration test updates** (§7.3) — extend `tests/commands/run.test.ts` and related.
10. **Typecheck + full vitest run + build**. Fix any breakage.
11. **Manual smoke** (§7.4). Capture output in PR body.
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
