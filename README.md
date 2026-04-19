# harness-cli

`harness-cli` is a TypeScript CLI for running AI-assisted engineering work as a reproducible, resumable tmux workflow.

It supports:
- a **full 7-phase flow**: spec → spec gate → plan → plan gate → implement → verify → eval gate
- a **light 4-phase flow** for smaller tasks: design+plan → implement → verify → eval gate
- **per-phase model preset selection** at start/resume
- **tmux-based crash recovery** with `resume`, `status`, `list`, `skip`, and `jump`
- **optional session logging** and a live footer with elapsed time and token totals

Unlike a single long-lived chat session, harness passes context through files and state, so each phase can restart cleanly and independent review phases do not inherit the implementation session's context.

---

## What actually runs in each phase

By default, harness uses:
- **Claude** presets for interactive phases (1 / 3 / 5)
- **Codex** presets for review gates (2 / 4 / 7)
- the bundled **`harness-verify.sh`** script for phase 6

Those defaults are configurable at runtime. On every `harness start` / `harness resume`, harness prompts for the model preset of every remaining non-verify phase.

Current built-in presets:
- `opus-max`, `opus-xhigh`, `opus-high`
- `sonnet-max`, `sonnet-high`
- `codex-high`, `codex-medium`

Default phase assignments:
- Phase 1 → `opus-high`
- Phase 2 → `codex-high`
- Phase 3 → `sonnet-high`
- Phase 4 → `codex-high`
- Phase 5 → `sonnet-high`
- Phase 7 → `codex-high`

---

## Full flow vs light flow

### Full flow (`harness start "task"`)

```text
P1 spec → P2 spec gate → P3 plan → P4 plan gate → P5 implement → P6 verify → P7 eval gate
```

Use the full flow when independent pre-implementation review matters: migrations, API/contract work, security-sensitive changes, or anything where the extra gate cost is worth it.

### Light flow (`harness start --light "task"`)

```text
P1 design+plan → P5 implement → P6 verify → P7 eval gate
```

In light flow:
- phases **2 / 3 / 4** are marked as `skipped`
- phase 1 must produce a combined design document with `## Complexity`, `## Open Questions`, and `## Implementation Plan`
- phase 7 can reopen **phase 5** for impl-only feedback, or **phase 1** for design/mixed feedback
- light-flow gate retry limit is **5** (full flow stays at **3**)
- the flow is frozen when the run is created, so `harness resume --light` is rejected

---

## Runtime layout inside tmux

Harness runs the workflow inside tmux with a split-pane control surface:
- **control pane**: current phase, retries, gate/verify output, escalation menus
- **workspace pane**: the active interactive agent session

Behavior depends on where you launch it:
- **outside tmux**: creates a dedicated session named `harness-<runId>`
- **inside tmux**: reuses the current tmux session and creates a `harness-ctrl` window

On macOS, harness tries to open the tmux session automatically in **iTerm2** first, then **Terminal.app**.
On Linux, or when AppleScript launch fails, harness prints a manual attach command instead:

```bash
tmux attach -t harness-<runId>
```

---

## Prerequisites

Harness is designed for a git working tree and will auto-commit artifacts between phases.
Install these first:

| Dependency | Why it is needed |
|---|---|
| Node.js 18+ | CLI runtime |
| tmux | session / pane orchestration |
| Claude Code CLI (`claude`) | default interactive runner |
| Codex CLI (`codex`) | default gate runner and optional interactive runner |
| `jq` | checklist parsing in phase 6 verify |
| Git | commit anchors, diffs, artifact commits |
| Interactive TTY | start/resume model selection and escalation UI |

Notes:
- Supported platforms are **macOS and Linux**.
- The verify script is resolved from the installed package first, with legacy fallback to `~/.claude/scripts/harness-verify.sh`.
- If you switch an interactive phase to a Codex preset, harness will use the Codex CLI for that phase too.
- By default, Codex phases run through the real `codex` CLI inside an isolated `<runDir>/codex-home`; use `--codex-no-isolate` only when you intentionally want inherited `CODEX_HOME` behavior.

---

## Installation

For local development:

```bash
git clone <repo-url> harness-cli
cd harness-cli
pnpm install
pnpm run build
pnpm link --global
```

After linking, `harness` is available globally.

Rebuild after source changes:

```bash
pnpm run build
```

Remove the global link:

```bash
pnpm unlink --global harness-cli
```

---

## Quick start

Run harness from the target project root (or pass `--root` to place `.harness/` elsewhere):

```bash
cd /path/to/your/project
harness --help
```

Start a run:

```bash
harness start "Add GraphQL API with user authentication"
# same as: harness run "Add GraphQL API with user authentication"
```

If you omit the task, harness asks for it inside the control pane.
That control-pane prompt supports **multiline paste** while still treating a normal `Enter` as submit.

Typical sequence:
1. harness creates or finds `.harness/`
2. it creates the tmux control surface
3. it prompts for model presets for the remaining phases
4. it starts phase 1 (or the saved phase on resume)

---

## Command reference

### `harness start [task]`

Starts a new run.

```bash
harness start "task"
harness run "task"                  # alias
harness start --light "task"
harness start --require-clean "task"
harness start --enable-logging "task"
harness start --root /tmp/demo "task"
```

Flags:
- `--require-clean` — block if the working tree has any uncommitted changes
- `--auto` — autonomous mode for escalation handling
- `--enable-logging` — write session logs under `~/.harness/sessions/...`
- `--light` — use the 4-phase light flow
- `--codex-no-isolate` — disable per-run `CODEX_HOME` isolation for Codex subprocesses; not recommended
- global `--root <dir>` — use `<dir>/.harness` as the harness root

Important behavior:
- unstaged/untracked changes are allowed by default
- staged changes are warned about by default
- if `--require-clean` is set, both staged and unstaged changes are blocked
- on first run, harness ensures `.harness/` is present in `.gitignore`

### `harness resume [runId]`

Resumes the current run or a specific run.

```bash
harness resume
harness resume 2026-04-19-graphql-api
```

Resume handles three cases automatically:
1. tmux session alive + inner process alive → reattach only
2. tmux session alive + inner process dead → restart the inner loop in place
3. no tmux session → recreate tmux and continue from saved state

On resume, harness again prompts for presets for the remaining phases.

### Terminal-state UI

When `runPhaseLoop` returns, the control panel stays on screen instead of dropping you to a shell:
- **Failed phase** → an inline action prompt appears with `[R]esume` (re-runs the failed phase in place), `[J]ump` (single-key prompt for an interactive phase: `1/3/5` in full flow, `1/5` in light), and `[Q]uit` (clean exit). Errors during R/J keep the panel open so you can try a different action.
- **Run complete** → an idle summary panel shows the eval report path, commit range, and wall time. Press Ctrl+C to exit.

### `harness status`

Prints the current run state:
- run/task/status
- current phase
- artifact paths
- retry counters
- commit anchors
- pending action

### `harness list`

Lists all runs under the harness root.

### `harness skip`

Force-passes the current phase.

If the inner process is alive, harness writes a pending action and signals the running session immediately.
If not, the skip is saved and consumed by the next `harness resume`.

### `harness jump <phase>`

Jumps backward to an earlier phase.

```bash
harness jump 3
```

Rules:
- backward only unless the run is already completed
- cannot jump into a `skipped` phase in light flow
- saved/applied the same way as `skip`

---

## Artifacts and state

Harness stores run state under `.harness/<runId>/`.

Common artifacts:
- `.harness/<runId>/state.json` — atomic run state
- `.harness/<runId>/task.md` — normalized task text
- `.harness/current-run` — pointer used by `resume`, `status`, `skip`, and `jump`
- `docs/specs/<runId>-design.md` — spec or combined design doc
- `docs/plans/<runId>.md` — full-flow implementation plan
- `.harness/<runId>/checklist.json` — verify checklist
- `docs/process/evals/<runId>-eval.md` — phase 6 evaluation report

Optional session logging (`--enable-logging`) writes to:

```text
~/.harness/sessions/<repoKey>/<runId>/
  meta.json
  events.jsonl
  summary.json
```

When logging is enabled, the control pane footer shows:
- current phase / attempt
- phase elapsed time
- current session elapsed time
- cumulative Claude + gate token totals

---

## Operational notes

- Harness uses **atomic state writes** and **lock handoff** between the outer starter process and the inner tmux process.
- Interactive phases are validated with sentinel files such as `.harness/<runId>/phase-1.done`.
- Phase 5 requires a clean tree and at least one commit after `implRetryBase` unless it is a reopen path that only fixes non-commit artifacts.
- `skip` and `jump` are control-plane operations; they do not take the main run lock.
- Re-selecting presets can invalidate saved gate replay sidecars when the effective runner/model lineage changes.

---

## Troubleshooting

**First run looks idle on Phase 1**  
Claude may be waiting in the workspace pane for a directory trust / proceed confirmation. Switch to the workspace pane and approve it.

**`Codex CLI not found in PATH`**  
Install the Codex CLI and retry. Harness now validates the actual `codex` binary, not the older companion path.

**`Could not open a terminal window automatically.`**  
Expected on Linux and possible on macOS fallback failure. Attach manually with the printed `tmux attach -t ...` command.

**`No active run.`**  
Run `harness list` to discover existing runs, or start a new one.

**`flow is frozen at run creation`**  
`--light` is a start-time choice only. Resume the existing run as-is, or start a fresh light run.

**Need to inspect current progress from another terminal?**  
Use `harness status`, `harness skip`, or `harness jump <phase>`.

---

## Related docs

- [`docs/HOW-IT-WORKS.md`](docs/HOW-IT-WORKS.md)
- [`README.ko.md`](README.ko.md)

---

## License

MIT
