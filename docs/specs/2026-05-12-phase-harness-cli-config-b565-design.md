# phase-harness `config` subcommand — design

- Related plan: `docs/plans/2026-05-12-phase-harness-cli-config-b565.md` (to be written in Phase 3)
- Related decision log: `.harness/2026-05-12-phase-harness-cli-config-b565/decisions.md`
- Run id: `2026-05-12-phase-harness-cli-config-b565`

## Context & Decisions

### Why this exists
`phase-harness` today picks a model for each phase from one of two sources:
1. The user opens the model-config dialog every run and overrides (`promptModelConfig` in `src/ui.ts`).
2. Otherwise the run inherits the built-in `PHASE_DEFAULTS` table in `src/config.ts`.

There is no per-user persistent override. Users who consistently prefer e.g. `opus-1m-max` for Phase 1 have to re-pick it on every fresh run. This spec adds a `phase-harness config` subcommand that persists per-phase preset overrides in `~/.harness/config.json` and surfaces them as the dialog's default on new runs.

### Scope
- New CLI surface: `phase-harness config list|get|set|reset`.
- New storage: `~/.harness/config.json`, written atomically.
- Single supported key family in v1: `phase.<N>.preset` for `N ∈ {1, 2, 3, 4, 5, 7}`. Phase 6 is the verify script (no model) and is hard-rejected.
- Saved overrides influence **fresh `start`/`run` only**. `resume` re-uses the existing `state.json` `phasePresets` untouched, because those values already reflect user choices made when that run was first launched.

### Non-goals
- No `config edit` / `$EDITOR` open. Out of v1.
- No `config reset --all` / bulk operations. Out of v1.
- No project-local config (`.harness/config.json`). Always user-global (`~/.harness/config.json`).
- No new CLI flags for per-phase model selection at `start` time. Resolution precedence at start remains: (1) saved config, (2) built-in default. There is no (0) CLI flag in v1.
- No migration of the existing in-flight runs (their `state.json` already has frozen `phasePresets`).
- No changes to `migrateState()`'s legacy-preset fallback path. That migration is for **state.json** drift, not user config.

### Key decisions (live-resolved during brainstorm)
- **Resume scope**: saved config applies only at `start`. `resume` does **not** overlay saved config onto the existing `state.json`. Rationale: a `state.json` was already frozen at start with the user's intent; silently mutating it on resume is surprising.
- **`config get` of an unset key**: prints the effective built-in default with a `(default)` annotation, e.g. `opus-1m-xhigh (default)`, exit 0. Rationale: makes "what model would this phase actually use?" answerable in one command; the annotation prevents shell scripts from confusing default and override.
- **`config list` output**: 3-column table — `key`, `value`, `source` where `source ∈ {default, override}`. Rationale: surfaces every relevant key whether or not it has an override, which is what users want when sanity-checking before a run.
- **Invalid JSON in `~/.harness/config.json`**: error and exit non-zero on **every** read path (`config list/get/set/reset` and `start`/`run`). Rationale: silent fail-open hides the user's intent and silently regresses to built-in defaults. A loud error tells the user exactly what to fix.
- **Storage shape**: nested JSON (`{ "phase": { "1": { "preset": "..." } } }`) rather than flat dotted keys (`{ "phase.1.preset": "..." }`). Rationale: cleaner TypeScript types, room for future namespaces (e.g. `runner.*`, `gate.*`) without restructuring.
- **No new dependency**: parsing/printing the table is hand-rolled with column padding; no `cli-table` package is added.

## Complexity

Small — three new files (~250 LoC total), one ~10-line touch in `start.ts`, one ~10-line registration block in `bin/harness.ts`, and doc syncs. No cross-module refactor.

## Requirements

### Functional

**FR-1 — `config list`**: print a 3-column human-readable table to stdout listing every supported phase key (`phase.<N>.preset` for `N ∈ {1, 2, 3, 4, 5, 7}`). Columns: `key`, `value`, `source` (`default` or `override`). One row per supported phase. Exit 0.

**FR-2 — `config get <key>`**: print the effective value for `<key>` to stdout. If `<key>` is set in `~/.harness/config.json`, print the override value with no annotation. If unset, print the built-in default followed by ` (default)`. Exit 0 on success.

**FR-3 — `config set <key> <value>`**: validate `<key>` against the supported key set and `<value>` against the `MODEL_PRESETS` catalog from `src/config.ts`. On success, atomically update `~/.harness/config.json` and print a confirmation to stdout. Exit 0 on success.

**FR-4 — `config reset <key>`**: remove the override for `<key>` from `~/.harness/config.json`. If `<key>` had no override (idempotent case), print a `(no override to reset)` notice and exit 0 — not an error. Atomic write. Exit 0 on success.

**FR-5 — Saved config drives start defaults**: when `phase-harness start` / `phase-harness run` builds the initial `state.json`, any override in `~/.harness/config.json` replaces the corresponding built-in `PHASE_DEFAULTS` entry **before** `state.json` is written. The downstream model-config dialog (`promptModelConfig` in `inner.ts`) then sees the override as the "current" value with no code change required in the dialog itself.

**FR-6 — `~/.harness/config.json` absence is fine**: when the file does not exist, every config subcommand and `start`/`run` behaves as if no overrides were set. No file is created lazily; `set` is the only command that creates it.

**FR-7 — Resume is unaffected**: `phase-harness resume <runId>` does not consult `~/.harness/config.json`. The existing `state.json` `phasePresets` is the source of truth.

### Non-functional

**NFR-1 — No new runtime dependencies**: no new `package.json` entries. Stdlib `fs`, `path`, `os` and existing helpers only.

**NFR-2 — Atomic writes**: `config set` / `config reset` write via a `config.json.tmp` + `fsync` + `rename` sequence (same pattern as `writeState` in `src/state.ts`).

**NFR-3 — Backward compatibility**: in the absence of `~/.harness/config.json`, every observable behavior of `start`, `run`, `resume`, the model-config dialog, and `state.json` migration is byte-identical to today.

**NFR-4 — Testability**: `userConfig.ts` accepts an optional `homeDir` override so tests can target a tmp directory without touching the real `~/.harness/`. Same pattern as `src/runners/claude-usage.ts` and `src/commands/install-skills.ts`.

## Architecture

### New modules

`src/userConfig.ts` — pure I/O + validation:
- `UserConfig` type: `{ phase?: Record<string, { preset?: string }> }`.
- `getUserConfigPath(homeDir?)`: returns the resolved path.
- `loadUserConfig(homeDir?)`: returns `UserConfig`. Returns `{}` when the file is missing. Throws a typed `UserConfigParseError` when the file exists but JSON parsing fails.
- `saveUserConfig(config, homeDir?)`: atomic write via tmp+fsync+rename; creates `~/.harness/` if missing.
- `parseConfigKey(key)`: returns `{ phase: string }` for a valid `phase.<N>.preset` (with `N ∈ {1,2,3,4,5,7}`) or throws a typed `UserConfigKeyError` with a message naming the invalid component. Specifically rejects `phase.6.preset` with a tailored error message.
- `getOverride(config, key)` / `setOverride(config, key, value)` / `clearOverride(config, key)`: small pure helpers used by the command handlers and the start-time overlay.
- `getEffectivePreset(config, phase)`: returns `{ value: string, source: 'default' | 'override' }` resolved against `PHASE_DEFAULTS` from `src/config.ts`.

`src/commands/config.ts` — CLI handlers, one per subcommand:
- `configListCommand(opts)`, `configGetCommand(key, opts)`, `configSetCommand(key, value, opts)`, `configResetCommand(key, opts)`.
- Each handler calls into `userConfig.ts`, formats output, and returns/exits.
- All four share a top-of-function `try { loadUserConfig() } catch (UserConfigParseError) → print error to stderr + exit 1` block — the loud-failure policy.

`bin/harness.ts` — adds a `config` parent command with four sub-actions, wired through `commander`'s nested-command API.

### Touch points in existing code

`src/commands/start.ts` — after `createInitialState(...)` returns and before the first `writeState(...)`, call a new `applyUserConfigOverrides(state)` helper (lives in `userConfig.ts`):
- Reads `loadUserConfig()`. If it throws `UserConfigParseError`, print the error to stderr and `process.exit(1)` before any directory side effects past the lock. Lock is released by the existing `finally` block.
- For each `phase ∈ REQUIRED_PHASE_KEYS`, look up the override. If the override's preset id is still in `MODEL_PRESETS`, overwrite `state.phasePresets[phase]`. If the override's preset id is stale (preset has since been removed from the catalog), emit a stderr warning naming the phase + the stale id and keep the built-in default.

`src/state.ts` — unchanged. `createInitialState` continues to seed from `PHASE_DEFAULTS`. The overlay is applied by `start.ts` afterward so `state.ts` stays pure and free of `os.homedir()` I/O.

`src/commands/inner.ts` — unchanged. `promptModelConfig` already reads `state.phasePresets` as the dialog's "current" value, so overrides surface automatically.

`src/commands/resume.ts` — unchanged. No overlay on resume per FR-7.

### Storage shape

`~/.harness/config.json`:

```json
{
  "phase": {
    "1": { "preset": "opus-1m-max" },
    "2": { "preset": "codex-medium" }
  }
}
```

Empty file (no overrides) is represented by either the file's absence or `{ "phase": {} }` / `{}`. All three are equivalent.

### Validation rules

| Rule | Behavior |
|---|---|
| Unknown subcommand | commander handles (`Unknown command`, exit 1). |
| `config get|set|reset` missing `<key>` | commander handles (`missing required argument`, exit 1). |
| Unsupported key family (anything not matching `phase.<N>.preset`) | Print `Error: unknown config key '<raw>'. Supported keys: phase.<1|2|3|4|5|7>.preset` to stderr, exit 1. |
| `phase.6.preset` | Print `Error: phase 6 is the verify script (no model); cannot configure. Supported phases: 1, 2, 3, 4, 5, 7.` to stderr, exit 1. |
| Numeric phase outside `{1,2,3,4,5,7}` (`phase.0.preset`, `phase.8.preset`, ...) | Print `Error: unknown phase '<N>'. Supported phases: 1, 2, 3, 4, 5, 7.` to stderr, exit 1. |
| `set` with an unknown preset id | Print `Error: unknown preset id '<value>'. Run 'phase-harness config list' or see src/config.ts MODEL_PRESETS for valid ids.` to stderr, exit 1. Do NOT modify config.json. |
| `~/.harness/config.json` exists but is not valid JSON | Print `Error: ~/.harness/config.json is not valid JSON: <parse-error>. Edit or delete the file to recover.` to stderr, exit 1. |
| Stale override (preset id in config.json was valid at write time but later removed from `MODEL_PRESETS`) | At start time: stderr warn (`Saved config phase.<N>.preset='<id>' is no longer a known preset; using built-in default '<default>'.`), keep built-in default. At `config list` time: print row with `value` column showing `<id> (stale)` and `source` column showing `override (stale)`. At `config get` time: print `<id> (override, stale)`. At `config set` time: not applicable (set always validates). At `config reset` time: removes the stale entry normally. |

### `config list` output format

```
key                value                  source
---                -----                  ------
phase.1.preset     opus-1m-max            override
phase.2.preset     codex-high             default
phase.3.preset     sonnet-high            default
phase.4.preset     codex-high             default
phase.5.preset     sonnet-high            default
phase.7.preset     codex-high             default
```

Columns are padded to the longest cell. A simple ASCII header underline separates the header row from data. Output goes to stdout.

### `config get` output format

Override present:
```
opus-1m-max
```

Unset:
```
opus-1m-xhigh (default)
```

Stale override:
```
opus-1m-max (override, stale)
```

### `config set` output format

```
phase.1.preset = opus-1m-max
```

### `config reset` output format

Override removed:
```
reset phase.1.preset
```

No-op (idempotent):
```
phase.1.preset already at default (no override to reset)
```

## Error handling

- Every command path that opens `~/.harness/config.json` re-throws `UserConfigParseError` after a single read. Handlers catch it once at the top and translate to stderr + `process.exit(1)`.
- `saveUserConfig` is responsible for ensuring `~/.harness/` exists (`mkdirSync(..., { recursive: true })`) before writing.
- Validation errors are printed once to stderr in a single line beginning with `Error:`, matching the style used elsewhere in the CLI.
- `process.exit(1)` is reserved for user-fixable errors. Internal I/O failures (e.g. EACCES on `~/.harness/`) surface the system errno verbatim and also exit 1.

## Testing

### Unit tests

`tests/userConfig.test.ts` (new):
- `loadUserConfig` returns `{}` when file absent.
- `loadUserConfig` parses valid JSON.
- `loadUserConfig` throws `UserConfigParseError` on malformed JSON.
- `saveUserConfig` writes atomically (tmp file present mid-write, real file appears after rename — verified by listing dir after write).
- `saveUserConfig` creates `~/.harness/` when missing.
- `parseConfigKey('phase.1.preset')` → `{ phase: '1' }`.
- `parseConfigKey('phase.6.preset')` throws a `UserConfigKeyError` whose message names phase 6 + the supported set.
- `parseConfigKey('phase.0.preset')`, `'phase.8.preset'`, `'phase.foo.preset'`, `'phase.1.model'`, `'random.thing'`, `''` → all throw with a recognizable message.
- `getEffectivePreset(config, '1')` returns `{ value: PHASE_DEFAULTS[1], source: 'default' }` when no override, and `{ value: '<override>', source: 'override' }` when present.

`tests/commands/config.test.ts` (new):
- `config list`: with no override, every row shows `default`. With an override, that row shows `override` and the overridden value; others stay `default`.
- `config get phase.1.preset`: prints override value bare when present, default + ` (default)` when absent.
- `config get phase.6.preset`: stderr error + exit 1; does not read or print phase 6 default.
- `config set phase.1.preset opus-1m-max`: writes config.json; subsequent `loadUserConfig` reflects the change; output matches the spec format.
- `config set phase.1.preset bogus-id`: stderr error + exit 1; config.json is unchanged on disk.
- `config set phase.6.preset opus-1m-max`: stderr error + exit 1; config.json unchanged.
- `config reset phase.1.preset` after a set: override removed; second `reset` of the same key prints the idempotent no-op message and exits 0.
- All four subcommands: when `~/.harness/config.json` is malformed JSON, stderr error + exit 1.
- Stale override case: `config list` and `config get` annotate `(stale)` when the preset id is no longer in `MODEL_PRESETS`. (Simulate by hand-writing config.json with a fake id, then reading.)

`tests/userConfigStartOverlay.test.ts` (new):
- Given a config.json with `phase.1.preset = opus-1m-max`, calling `applyUserConfigOverrides(state)` mutates `state.phasePresets['1']` to `opus-1m-max` and leaves other phases at `PHASE_DEFAULTS`.
- Given a stale-id override, `applyUserConfigOverrides(state)` emits the expected stderr warning and leaves the built-in default in place.
- Given no config.json, `applyUserConfigOverrides(state)` is a no-op (state.phasePresets unchanged, no stderr output).
- Given a malformed config.json, `applyUserConfigOverrides(state)` throws `UserConfigParseError`. (start.ts handles the throw.)

### Regression checks

- Existing tests under `tests/state.test.ts`, `tests/promptModelConfig*.test.ts`, `tests/commands/start*.test.ts` keep passing unchanged. New behavior must be invisible when `~/.harness/config.json` is absent (NFR-3).
- `pnpm tsc --noEmit` must pass with the new types.
- `pnpm build` must produce a usable `dist/bin/harness.js` that registers the `config` parent command (smoke-checked via `node dist/bin/harness.js config list --help`).

## Success Criteria

A reviewer can verify all of the following hold:

1. `phase-harness config list` prints a 6-row table covering phases 1, 2, 3, 4, 5, 7 with a `source` column.
2. `phase-harness config set phase.1.preset opus-1m-max` followed by `phase-harness config get phase.1.preset` prints `opus-1m-max` (no annotation).
3. `phase-harness config set phase.6.preset X` exits non-zero, prints a stderr error naming phase 6, and does not create or modify `~/.harness/config.json`.
4. `phase-harness config set phase.1.preset bogus` exits non-zero, prints a stderr error naming the bogus id, and does not modify `~/.harness/config.json`.
5. With an override in `~/.harness/config.json`, a new `phase-harness start` (or `run`) writes a `state.json` whose `phasePresets` reflects the override for the overridden phase and the built-in default for every other phase.
6. With no `~/.harness/config.json`, every `start`/`run`/`resume` code path observable to a user behaves identically to the pre-change build. The regression test suite passes unmodified beyond the new tests.
7. `phase-harness resume <existing-runId>` is byte-identical to today regardless of whether `~/.harness/config.json` exists or not.
8. A malformed `~/.harness/config.json` causes every config subcommand and any new `start`/`run` to exit non-zero with a stderr message naming the file path and the parse error.
9. README.md, README.ko.md, docs/HOW-IT-WORKS.md, docs/HOW-IT-WORKS.ko.md each document the `config` subcommand and the new resolution precedence.
10. `pnpm tsc --noEmit`, `pnpm vitest run`, and `pnpm build` succeed.

## Invariants

The Phase 2 reviewer / Phase 6 verifier can grep for these:

- **INV-1**: `src/userConfig.ts` exists and exports `loadUserConfig`, `saveUserConfig`, `applyUserConfigOverrides`, `parseConfigKey`, `getEffectivePreset`. (`grep -nE "export function (loadUserConfig|saveUserConfig|applyUserConfigOverrides|parseConfigKey|getEffectivePreset)" src/userConfig.ts` returns 5 hits.)
- **INV-2**: `src/commands/config.ts` exists and exports `configListCommand`, `configGetCommand`, `configSetCommand`, `configResetCommand`. (`grep -nE "export (async )?function config(List|Get|Set|Reset)Command" src/commands/config.ts` returns 4 hits.)
- **INV-3**: `bin/harness.ts` registers a `config` parent command. (`grep -n "\.command('config" bin/harness.ts` returns at least 1 hit.)
- **INV-4**: `package.json` has **no new dependency entries** vs. the pre-change baseline (`git diff main -- package.json` shows no `+` lines under `"dependencies"` or `"devDependencies"`). This enforces NFR-1.
- **INV-5**: `src/state.ts` `createInitialState` is unchanged in signature (`grep -n "export function createInitialState" src/state.ts` returns one hit with the same parameter list as before — the overlay lives in `start.ts`, not `state.ts`).
- **INV-6**: `src/commands/resume.ts` contains zero references to `userConfig` or `loadUserConfig`. (`grep -n "userConfig\|loadUserConfig" src/commands/resume.ts` returns zero hits.) Enforces FR-7.
- **INV-7**: `src/commands/start.ts` calls `applyUserConfigOverrides` exactly once, before the first `writeState`. (`grep -n "applyUserConfigOverrides" src/commands/start.ts` returns at least one hit ordered before the first `writeState(`.)
- **INV-8**: All four doc files (`README.md`, `README.ko.md`, `docs/HOW-IT-WORKS.md`, `docs/HOW-IT-WORKS.ko.md`) mention `phase-harness config`. (`grep -l "phase-harness config" README.md README.ko.md docs/HOW-IT-WORKS.md docs/HOW-IT-WORKS.ko.md` returns all four paths.)

## File Impact Summary

| Path | Change |
|---|---|
| `src/userConfig.ts` | NEW — atomic I/O, key parsing, validation, start-time overlay helper |
| `src/commands/config.ts` | NEW — four subcommand handlers |
| `bin/harness.ts` | EDIT — register `config` parent command with four sub-actions |
| `src/commands/start.ts` | EDIT — call `applyUserConfigOverrides` after `createInitialState`, before first `writeState`; handle `UserConfigParseError` |
| `tests/userConfig.test.ts` | NEW |
| `tests/commands/config.test.ts` | NEW |
| `tests/userConfigStartOverlay.test.ts` | NEW |
| `README.md` | EDIT — `Config` section |
| `README.ko.md` | EDIT — `Config` section |
| `docs/HOW-IT-WORKS.md` | EDIT — "Default model resolution" section |
| `docs/HOW-IT-WORKS.ko.md` | EDIT — "Default model resolution" section |

No edits to `src/state.ts`, `src/commands/inner.ts`, `src/commands/resume.ts`, `src/ui.ts`, `src/config.ts`.
