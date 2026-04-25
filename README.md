# phase-harness

`phase-harness` is a TypeScript CLI for running AI-assisted engineering work as a reproducible, resumable tmux workflow.

It supports:
- a **full 7-phase flow**: spec → spec gate → plan → plan gate → implement → verify → eval gate
- a **light 5-phase flow** for smaller tasks: design+plan → pre-impl gate → implement → verify → eval gate
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

Those defaults are configurable at runtime. On every `phase-harness start` / `phase-harness resume`, harness prompts for the model preset of every remaining non-verify phase.

Current built-in presets:
- `opus-1m-max`, `opus-1m-xhigh`, `opus-1m-high`
- `sonnet-1m-max`, `sonnet-1m-high`
- `opus-max`, `opus-xhigh`, `opus-high`
- `sonnet-max`, `sonnet-high`
- `codex-high`, `codex-medium`

Default phase assignments:
- Phase 1 → `opus-1m-xhigh`
- Phase 2 → `codex-high`
- Phase 3 → `sonnet-high`
- Phase 4 → `codex-high`
- Phase 5 → `sonnet-high`
- Phase 7 → `codex-high`

---

## Full flow vs light flow

### Full flow (`phase-harness start "task"`)

```text
P1 spec → P2 spec gate → P3 plan → P4 plan gate → P5 implement → P6 verify → P7 eval gate
```

Use the full flow when independent pre-implementation review matters: migrations, API/contract work, security-sensitive changes, or anything where the extra gate cost is worth it.

### Light flow (`phase-harness start --light "task"`)

```text
P1 design+plan → P2 pre-impl gate → P5 implement → P6 verify → P7 eval gate
```

In light flow:
- phases **3 / 4** are marked as `skipped` (P2 and P7 remain active Codex gates)
- phase 1 must produce a combined design document with `## Complexity` and `## Implementation Plan`
- **P2 (pre-impl gate)**: Codex reviews the combined design doc with a light-flow design rubric. REJECT reopens phase 1; the feedback is delivered only via `pendingAction.feedbackPaths` (no `carryoverFeedback` at Gate 2).
- phase 7 can reopen **phase 5** for impl-only feedback, or **phase 1** for design/mixed feedback
- gate retry limits: **light P2 = 3**, **light P7 = 5**, full flow = 3
- the flow is frozen when the run is created, so `phase-harness resume --light` is rejected

---

## Runtime layout inside tmux

Harness runs the workflow inside tmux with a top-bottom split-pane control surface:
- **top control pane**: current phase, retries, gate/verify output, escalation menus
- **bottom workspace pane**: the active interactive agent session, with most of the terminal height

Gate phases (2, 4, 7) run Codex CLI as an interactive TUI in the workspace pane (the same pane used by interactive phases). Codex writes its verdict to `<runDir>/gate-N-verdict.md` and harness detects completion via `<runDir>/phase-N.done`. While a gate is running, the footer shows `attach: tmux attach -t <session>` so you can watch the review live.

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
- The verify script (`harness-verify.sh`) is bundled in the package and resolved automatically at runtime.
- If you switch an interactive phase to a Codex preset, harness will use the Codex CLI for that phase too.
- By default, Codex phases run through the real `codex` CLI inside an isolated `<runDir>/codex-home`; use `--codex-no-isolate` only when you intentionally want inherited `CODEX_HOME` behavior.
- New runs now default Claude phases to the explicit `*-1m-*` presets. If your Claude Code environment does not support 1M context, pick one of the legacy non-1M presets during the model-selection step (or change the defaults in `src/config.ts` in your own fork).

---

## Installation

Install globally from npm:

```bash
npm install -g phase-harness
# or
pnpm add -g phase-harness
```

For local development:

```bash
git clone <repo-url> phase-harness
cd phase-harness
pnpm install
pnpm run build
pnpm link --global
```

After linking, `phase-harness` is available globally.

Rebuild after source changes:

```bash
pnpm run build
```

Remove the global link:

```bash
pnpm remove --global phase-harness
```

> **Note:** `pnpm unlink --global` silently does nothing for linked packages — use `pnpm remove --global` instead.

### Install standalone skills

After installation, install the bundled Claude Code skills into your user scope:

```bash
phase-harness install-skills          # installs to ~/.claude/skills/
phase-harness install-skills --project  # installs to ./.claude/skills/ (project scope)
```

This installs `phase-harness-codex-gate-review` — the gate review skill used by the harness lifecycle.
To uninstall:

```bash
phase-harness uninstall-skills
phase-harness uninstall-skills --project
```

**Testing / advanced:** Use `--project-dir <path>` to install to an arbitrary directory:

```bash
phase-harness install-skills --project-dir /tmp/test-skills
```

---

## Quick start

Run harness from the target project root (or pass `--root` to place `.harness/` elsewhere):

```bash
cd /path/to/your/project
phase-harness --help
```

Start a run:

```bash
phase-harness start "Add GraphQL API with user authentication"
# same as: phase-harness run "Add GraphQL API with user authentication"
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

### `phase-harness start [task]`

Starts a new run.

```bash
phase-harness start "task"
phase-harness run "task"                  # alias
phase-harness start --light "task"
phase-harness start --require-clean "task"
phase-harness start --enable-logging "task"
phase-harness start --root /tmp/demo "task"
```

Flags:
- `--require-clean` — block if the working tree has any uncommitted changes
- `--auto` — autonomous mode for escalation handling
- `--enable-logging` — write session logs under `~/.harness/sessions/...`
- `--light` — use the 5-phase light flow (P1 design+plan → P2 pre-impl gate → P5 → P6 → P7)
- `--codex-no-isolate` — disable per-run `CODEX_HOME` isolation for Codex subprocesses; not recommended
- global `--root <dir>` — use `<dir>/.harness` as the harness root

Important behavior:
- unstaged/untracked changes are allowed by default
- staged changes are warned about by default
- if `--require-clean` is set, both staged and unstaged changes are blocked
- on first run, harness ensures `.harness/` is present in `.gitignore`

### `phase-harness resume [runId]`

Resumes the current run or a specific run.

```bash
phase-harness resume
phase-harness resume 2026-04-19-graphql-api
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

### `phase-harness status`

Prints the current run state:
- run/task/status
- current phase
- artifact paths
- retry counters
- commit anchors
- pending action

### `phase-harness list`

Lists all runs under the harness root.

### `phase-harness skip`

Force-passes the current phase.

If the inner process is alive, harness writes a pending action and signals the running session immediately.
If not, the skip is saved and consumed by the next `phase-harness resume`.

### `phase-harness jump <phase>`

Jumps backward to an earlier phase.

```bash
phase-harness jump 3
```

Rules:
- backward only unless the run is already completed
- cannot jump into a `skipped` phase in light flow
- saved/applied the same way as `skip`

### `phase-harness install-skills`

Installs bundled Claude Code skills to the user or project scope.

```bash
phase-harness install-skills            # user scope: ~/.claude/skills/
phase-harness install-skills --project  # project scope: ./.claude/skills/
```

Options: `--user` (default), `--project`, `--project-dir <path>` (implies `--project`).

### `phase-harness uninstall-skills`

Removes `phase-harness-*` skills from the user or project scope. Skills without the `phase-harness-` prefix are preserved.

```bash
phase-harness uninstall-skills
phase-harness uninstall-skills --project
```

### `phase-harness cleanup`

Lists and kills orphaned `harness-*` tmux sessions scoped to the current `.harness/` directory.
A session is an orphan if its run directory exists locally but the lock state is stale, missing, or belongs to a different run.
Sessions whose run directory is not found under the current `.harness/` are classified as `unknown` and left alone.

```bash
phase-harness cleanup            # interactive: show table, prompt before killing
phase-harness cleanup --dry-run  # classify and print only, no kills
phase-harness cleanup --yes      # skip confirmation prompt
```

`start` also runs an automatic quiet sweep before creating a new session, cleaning up orphans without prompting.

---

## Artifacts and state

Run IDs have the shape `YYYY-MM-DD-<slug>-<rrrr>` where `<rrrr>` is a 4-hex random token (e.g. `2026-04-20-my-task-a3f1`). The random suffix makes each run ID unique without a counter ladder even for repeated no-task starts.

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
- A Codex preset on Phase 5 can hit a commit-discipline trap (sentinel fresh + uncommitted edits → silent failed loop). The harness now surfaces this with a stderr warn block + `phase_end.uncommittedRepos`. See `docs/HOW-IT-WORKS.md` (#84).
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
Run `phase-harness list` to discover existing runs, or start a new one.

**`flow is frozen at run creation`**  
`--light` is a start-time choice only. Resume the existing run as-is, or start a fresh light run.

**Need to inspect current progress from another terminal?**  
Use `phase-harness status`, `phase-harness skip`, or `phase-harness jump <phase>`.

---

## Related docs

- [`docs/HOW-IT-WORKS.md`](docs/HOW-IT-WORKS.md)
- [`README.ko.md`](README.ko.md)

---

## License

MIT
