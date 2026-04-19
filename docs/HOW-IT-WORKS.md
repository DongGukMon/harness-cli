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
P1 design+plan → P5 implement → P6 verify → P7 eval gate
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
| `opus-max` | claude | `claude-opus-4-7` | `max` |
| `opus-xhigh` | claude | `claude-opus-4-7` | `xHigh` |
| `opus-high` | claude | `claude-opus-4-7` | `high` |
| `sonnet-max` | claude | `claude-sonnet-4-6` | `max` |
| `sonnet-high` | claude | `claude-sonnet-4-6` | `high` |
| `codex-high` | codex | `gpt-5.4` | `high` |
| `codex-medium` | codex | `gpt-5.4` | `medium` |

Default assignments:
- full flow: P1 `opus-high`, P2 `codex-high`, P3 `sonnet-high`, P4 `codex-high`, P5 `sonnet-high`, P7 `codex-high`
- light flow: P1 `opus-high`, P5 `sonnet-high`, P7 `codex-high`

Users can change every non-verify phase preset during `harness start` and `harness resume`.
Selections persist in `state.phasePresets`.

---

## Full flow vs light flow

### Full flow

Use the full flow when independent pre-implementation review matters.
Phase outputs are:
- P1 → `docs/specs/<runId>-design.md` + `.harness/<runId>/decisions.md`
- P3 → `docs/plans/<runId>.md` + `.harness/<runId>/checklist.json`
- P5 → git commits
- P6 → `docs/process/evals/<runId>-eval.md`

### Light flow (`harness start --light`)

Light flow skips phases 2, 3, and 4 by initializing them as `skipped`.
The control panel renders them as `(skipped)` and the phase loop jumps past them.

Light-flow specifics:
- P1 writes a combined design+plan doc to `docs/specs/<runId>-design.md`
- the combined doc must include `## Complexity`, `## Open Questions`, and `## Implementation Plan`
- `checklist.json` still exists as a separate file under `.harness/<runId>/checklist.json`
- `harness resume --light` is rejected because flow is frozen at run creation
- gate retry limit is 5 in light flow, 3 in full flow
- on P7 `REJECT`:
  - `Scope: impl` → reopen P5
  - `Scope: design`, `Scope: mixed`, or missing scope → reopen P1 and preserve carryover feedback for P5

---

## Phase-by-phase summary

| Phase | Default preset | Runner type | Main outputs | On reject/fail |
|---|---|---|---|---|
| P1 Spec / Design+Plan | `opus-high` | interactive | spec/design doc + decisions + checklist (light only) | Gate 2 reject reopens P1; light-flow P7 design/mixed reject also reopens P1 |
| P2 Spec Gate | `codex-high` | gate | verdict + optional feedback sidecars | reopen P1 |
| P3 Plan | `sonnet-high` | interactive | plan + checklist | Gate 4 reject reopens P3 |
| P4 Plan Gate | `codex-high` | gate | verdict + optional feedback sidecars | reopen P3 |
| P5 Implement | `sonnet-high` | interactive | git commits | P6 fail reopens P5; P7 full-flow reject reopens P5; light-flow impl reject reopens P5 |
| P6 Verify | fixed script | automated shell | eval report + verify sidecars | fail reopens P5; retry limit 3 |
| P7 Eval Gate | `codex-high` | gate | verdict + optional feedback sidecars | full: reopen P5; light: reopen P5 or P1 based on scope |

Current timeout constants (`src/config.ts`):
- interactive phases: 30 minutes
- gate phases: 6 minutes
- verify: 5 minutes

---

## Runner behavior

### Claude interactive phases

When the selected preset runner is `claude`, harness launches Claude inside the tmux workspace pane and pins the Claude session to the current `phaseAttemptId`:

```bash
claude --session-id <attemptId> --model <model> --effort <effort> @<prompt-file>
```

Current behavior:
- the PID is captured via `claude-<phase>-<attemptId>.pid`
- Claude token usage is read back from the pinned session JSONL and attached to `phase_end.claudeTokens` when available
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

---

## Verify behavior (Phase 6)

Phase 6 always runs the bundled `harness-verify.sh` script.
The script path is resolved from the installed package first, with legacy fallback to `~/.claude/scripts/harness-verify.sh`.

Inputs and outputs:
- input: `.harness/<runId>/checklist.json`
- output: `docs/process/evals/<runId>-eval.md`
- sidecars: `verify-result.json`, `verify-feedback.md`, `verify-error.md`

Before verify runs, harness enforces a clean tree outside the eval report path and cleans/replaces any existing eval report artifact as needed.
A verify pass auto-commits the eval report.
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
- tmux/session bookkeeping
- `loggingEnabled`, `codexNoIsolate`, `strictTree`

Artifact locations:
- spec/design doc: `docs/specs/<runId>-design.md`
- plan doc: `docs/plans/<runId>.md` (full flow only)
- decisions: `.harness/<runId>/decisions.md`
- checklist: `.harness/<runId>/checklist.json`
- eval report: `docs/process/evals/<runId>-eval.md`

State writes are atomic: write `state.json.tmp` → fsync → rename.

---

## Resume and recovery

`harness resume` handles three cases:
1. tmux session alive + inner alive → attach only
2. tmux session alive + inner dead → restart inner in the existing control pane when possible
3. no tmux session → recreate tmux and continue from saved state

Recovery is built from:
- atomic state writes
- sentinel-based completion for Claude interactive phases
- `pendingAction` replay for skipped/reopened/error states
- artifact commit anchors (`specCommit`, `planCommit`, `implCommit`, `evalCommit`)
- gate sidecars and verify sidecars

`harness jump <phase>` only moves backward unless the run is already complete.
In light flow, jumping into skipped phases is rejected.

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

Important logged events include `phase_start`, `phase_end`, `gate_verdict`, `gate_error`, `gate_retry`, `verify_result`, and `session_end`.
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
