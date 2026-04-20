# How harness-cli works

This document describes the current runtime behavior of `harness-cli` as implemented in `src/`.
If this document ever disagrees with the code, treat the code as the source of truth and update this file in the same change.

---

## Overview

`harness-cli` runs work inside a tmux control/workspace layout and persists state under `.harness/<runId>/`.
The default lifecycle is:

```text
Full flow
P1 spec → P2 spec gate → P3 plan → P4 plan gate → P5 implement → P6 verify → P7 eval gate

Light flow (`--light`)
P1 design+plan → P2 pre-impl gate → P5 implement → P6 verify → P7 eval gate
```

Key invariants:
- every phase runs in a fresh OS process
- phase-to-phase context is passed through files and `state.json`, not chat memory
- interactive phases and gate phases are preset-driven at run start/resume
- Phase 6 is always the bundled verify script, not an AI runner

---

## Built-in presets and defaults

Built-in presets come from `src/config.ts`:

| id | runner | model | effort |
|---|---|---|---|
| `opus-1m-max` | claude | `claude-opus-4-7[1m]` | `max` |
| `opus-1m-xhigh` | claude | `claude-opus-4-7[1m]` | `xHigh` |
| `opus-1m-high` | claude | `claude-opus-4-7[1m]` | `high` |
| `sonnet-1m-max` | claude | `claude-sonnet-4-6[1m]` | `max` |
| `sonnet-1m-high` | claude | `claude-sonnet-4-6[1m]` | `high` |
| `opus-max` | claude | `claude-opus-4-7` | `max` |
| `opus-xhigh` | claude | `claude-opus-4-7` | `xHigh` |
| `opus-high` | claude | `claude-opus-4-7` | `high` |
| `sonnet-max` | claude | `claude-sonnet-4-6` | `max` |
| `sonnet-high` | claude | `claude-sonnet-4-6` | `high` |
| `codex-high` | codex | `gpt-5.4` | `high` |
| `codex-medium` | codex | `gpt-5.4` | `medium` |

Default assignments:
- full flow: P1 `opus-1m-high`, P2 `codex-high`, P3 `sonnet-1m-high`, P4 `codex-high`, P5 `sonnet-1m-high`, P7 `codex-high`
- light flow: P1 `opus-1m-high`, P2 `codex-high`, P5 `sonnet-1m-high`, P7 `codex-high`

Users can change every non-verify phase preset during `phase-harness start` and `phase-harness resume`.
Selections persist in `state.phasePresets`.
Existing saved runs are not auto-migrated to the new 1M defaults; only newly created runs pick them up automatically.

---

## Full flow vs light flow

### Full flow

Use the full flow when independent pre-implementation review matters.
Phase outputs are:
- P1 → `docs/specs/<runId>-design.md` + `.harness/<runId>/decisions.md`
- P3 → `docs/plans/<runId>.md` + `.harness/<runId>/checklist.json`
- P5 → git commits
- P6 → `docs/process/evals/<runId>-eval.md`

### Light flow (`phase-harness start --light`)

Light flow skips phases 3 and 4 by initializing them as `skipped`.
Phase 2 is active (`pending`) and runs a pre-impl Codex review of the combined design doc.
The control panel renders skipped phases as `(skipped)` and the phase loop jumps past them.

Light-flow specifics:
- P1 writes a combined design+plan doc to `docs/specs/<runId>-design.md`
- the combined doc must include `## Complexity` and `## Implementation Plan`
- `checklist.json` still exists as a separate file under `.harness/<runId>/checklist.json`
- `phase-harness resume --light` is rejected because flow is frozen at run creation
- P2 (pre-impl gate): Codex reviews the combined design doc using a 4-axis rubric. REJECT → immediate P1 reopen with feedback delivered via `pendingAction.feedbackPaths` only; `state.carryoverFeedback` is not set at Gate 2. Gate retry limit 3 (same as full-flow P2). Legacy light runs created before P2 activation keep `phases['2']='skipped'` — activation is forward-only via `createInitialState`, not retroactive migration.
- gate retry limit: light P2 = 3, light P7 = 5, full flow = 3
- on P7 `REJECT`:
  - `Scope: impl` → reopen P5
  - `Scope: design`, `Scope: mixed`, or missing scope → reopen P1 and preserve carryover feedback for P5

---

## Phase-by-phase summary

| Phase | Default preset | Runner type | Main outputs | On reject/fail |
|---|---|---|---|---|
| P1 Spec / Design+Plan | `opus-1m-high` | interactive | spec/design doc + decisions + checklist (light only) | Gate 2 reject reopens P1; light-flow P7 design/mixed reject also reopens P1 |
| P2 Spec Gate | `codex-high` | gate | verdict + optional feedback sidecars | reopen P1 |
| P3 Plan | `sonnet-1m-high` | interactive | plan + checklist | Gate 4 reject reopens P3 |
| P4 Plan Gate | `codex-high` | gate | verdict + optional feedback sidecars | reopen P3 |
| P5 Implement | `sonnet-1m-high` | interactive | git commits | P6 fail reopens P5; P7 full-flow reject reopens P5; light-flow impl reject reopens P5 |
| P6 Verify | fixed script | automated shell | eval report + verify sidecars | fail reopens P5; retry limit 3 |
| P7 Eval Gate | `codex-high` | gate | verdict + optional feedback sidecars | full: reopen P5; light: reopen P5 or P1 based on scope |

Current timeout constants (`src/config.ts`):
- interactive phases: 30 minutes
- gate phases: 6 minutes
- verify: 5 minutes

---

## Runner behavior

### Claude interactive phases

When the selected preset runner is `claude`, harness launches Claude inside the tmux workspace pane and pins the Claude session to the current `phaseAttemptId`.

**Fresh launch** (first entry or any fallback):
```bash
claude --session-id <attemptId> --model <model> --effort <effort> @<prompt-file>
```

**Reopen launch** (same-phase same-session — when all resume conditions are met):
```bash
claude --resume <attemptId> --model <model> --effort <effort> @<prompt-file>
```

Same-phase same-session policy: when a Claude interactive phase is reopened by a gate reject (e.g. P4→P3 reopen), harness reuses the prior Claude session instead of starting a new one. Resume conditions (all must hold):
1. `phaseReopenFlags[phase] === true` (reopen, not fresh entry)
2. `phaseAttemptId[phase]` is a non-empty string
3. `phaseClaudeSessions[phase]` matches the current preset (`model` + `effort`)
4. `~/.claude/projects/<encodedCwd>/<attemptId>.jsonl` exists on disk

If any condition fails, harness falls back to a fresh session (new UUID, `--session-id`), emitting a single `stderr` warning with the reason (`jsonl missing`, `preset incompatible`, `no prior attempt id`, or `no prior claude session record`).

The last-launched preset for each interactive phase is persisted in `state.phaseClaudeSessions: Record<'1'|'3'|'5', ClaudeSessionInfo | null>` and migrated to `null` on state upgrade.

**Pre-relaunch sentinel purge (hard prerequisite):** Before spawning Claude (on both resume and fresh paths), harness deletes any existing `phase-<N>.done` sentinel and verifies the file is absent. If the file cannot be deleted, the relaunch is aborted and the phase is marked failed. This prevents a prior-attempt sentinel from being mistaken for the current attempt's completion signal when the `attemptId` is reused. When the purge fails and the relaunch is aborted, `phaseAttemptId` and `phaseClaudeSessions` are both left unchanged — neither field is updated until the purge succeeds — so the next reopen can make a consistent resume-eligibility decision based on the previous attempt's lineage.

Other behavior:
- the PID is captured via `claude-<phase>-<attemptId>.pid`
- Claude token usage is read back from the pinned session JSONL and attached to `phase_end.claudeTokens` when available (on resume path, `phaseStartTs` filter restricts aggregation to the current attempt's lines)
- before launching a new Claude interactive phase, harness tries to stop the previous saved workspace PID to avoid typing into an old Claude prompt

### Codex interactive phases

When the selected preset runner is `codex`, harness runs:

```bash
codex exec --model <model> -c model_reasoning_effort="<effort>" --sandbox <level> --full-auto -
```

Sandbox level:
- phases 1 and 3 → `workspace-write`
- phase 5 → `danger-full-access`

Codex interactive phases do not use sentinel files; harness validates artifacts after the subprocess exits.

### Gate phases

Gate phases are preset-driven too.
By default they run through the real `codex` CLI, not the older companion-path flow:

```bash
codex exec --model <model> -c model_reasoning_effort="<effort>" -
```

If a gate phase is explicitly mapped to a Claude preset, harness instead runs a `claude --print` gate subprocess.

### Codex isolation

By default, Codex subprocesses run inside `<runDir>/codex-home/` with only `auth.json` symlinked in.
This avoids inheriting unrelated user-level `CODEX_HOME` conventions.
`--codex-no-isolate` disables that safeguard.

If your Claude Code environment does not support 1M context, keep using the legacy non-1M Claude presets from the model picker or change the defaults in `src/config.ts` in your own fork.

---

## Verify behavior (Phase 6)

Phase 6 always runs the bundled `harness-verify.sh` script.
The script path is resolved from the installed package first, with legacy fallback to `~/.claude/scripts/harness-verify.sh`.

Inputs and outputs:
- input: `.harness/<runId>/checklist.json`
- output: `docs/process/evals/<runId>-eval.md`
- sidecars: `verify-result.json`, `verify-feedback.md`, `verify-error.md`

Before verify runs, harness enforces a clean tree outside the eval report path and cleans/replaces any existing eval report artifact as needed.
A verify pass auto-commits the eval report. If the eval report path is covered by `.gitignore`, the commit is skipped (a one-line warning is emitted to stderr; `evalCommit` stays `null`).
A verify fail copies the eval report to `verify-feedback.md` and reopens P5.

---

## State and artifacts

The authoritative run state lives in `.harness/<runId>/state.json`.
Important fields include:
- `flow`: `full` or `light`
- `currentPhase`, `status`, `phases`
- `phasePresets`
- `gateRetries`, `verifyRetries`
- `pendingAction`
- `carryoverFeedback` (light-flow P7 design/mixed rejection handoff)
- `specCommit`, `planCommit`, `implCommit`, `evalCommit`, `verifiedAtHead`
- `phaseAttemptId`, `phaseOpenedAt`
- `phaseCodexSessions` — per-gate Codex session resume lineage
- `phaseClaudeSessions` — per-interactive Claude session resume lineage (model + effort; `null` until first launch)
- tmux/session bookkeeping
- `loggingEnabled`, `codexNoIsolate`

Artifact locations:
- spec/design doc: `docs/specs/<runId>-design.md`
- plan doc: `docs/plans/<runId>.md` (full flow only)
- decisions: `.harness/<runId>/decisions.md`
- checklist: `.harness/<runId>/checklist.json`
- eval report: `docs/process/evals/<runId>-eval.md`

State writes are atomic: write `state.json.tmp` → fsync → rename.

---

## Resume and recovery

`phase-harness resume` handles three cases:
1. tmux session alive + inner alive → attach only
2. tmux session alive + inner dead → restart inner in the existing control pane when possible
3. no tmux session → recreate tmux and continue from saved state

Recovery is built from:
- atomic state writes
- sentinel-based completion for Claude interactive phases
- `pendingAction` replay for skipped/reopened/error states
- artifact commit anchors (`specCommit`, `planCommit`, `implCommit`, `evalCommit`)
- gate sidecars and verify sidecars

`phase-harness jump <phase>` only moves backward unless the run is already complete.
In light flow, jumping into skipped phases is rejected.

When `runPhaseLoop` returns, the inner process keeps the control panel alive instead of exiting:
- A failed phase enters an inline action loop (`[R]esume` / `[J]ump` / `[Q]uit`); R and J reset state and re-enter `runPhaseLoop` in place. Q is a clean exit.
- A completed run renders an idle summary panel (eval report path, commit range, wall time) and waits for `SIGINT`.

This is implemented in `src/phases/terminal-ui.ts`; outer-process `commands/resume.ts` and `commands/jump.ts` (tmux/lock/SIGUSR1 plumbing) are unchanged and still drive the cross-process recovery flow above.

---

## Logging and footer

Session logging is opt-in via `--enable-logging`.
When enabled, harness writes under:

```text
~/.harness/sessions/<repoKey>/<runId>/
  meta.json
  events.jsonl
  summary.json
```

Important logged events include `phase_start`, `phase_end`, `gate_verdict`, `gate_error`, `gate_retry`, `verify_result`, `ui_render`, `terminal_action`, and `session_end`.
The control-pane footer aggregates elapsed time plus Claude/gate token totals from those logs.

---

## Preflight and platform assumptions

Core preflight checks cover Node, tmux, TTY, platform, verify-script availability, `jq`, and the required runner CLIs for the next phase.
Supported platforms are macOS and Linux.
When launched outside tmux, harness tries iTerm2 first, then Terminal.app, and finally prints a manual `tmux attach` command.

---

## Source-of-truth files

When behavior questions come up, read these first:
- `src/config.ts`
- `src/commands/start.ts`
- `src/commands/resume.ts`
- `src/commands/inner.ts`
- `src/phases/runner.ts`
- `src/phases/interactive.ts`
- `src/phases/gate.ts`
- `src/phases/verify.ts`
- `src/runners/claude.ts`
- `src/runners/codex.ts`
- `src/runners/codex-isolation.ts`
- `src/state.ts`
