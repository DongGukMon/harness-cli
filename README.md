# harness-cli

A TypeScript CLI that orchestrates a 7-phase AI agent development lifecycle: brainstorm → spec gate → plan → plan gate → implement → verify → eval gate.

Each phase runs in its own isolated subprocess inside a **tmux session** — Claude Code for interactive phases (each in a separate tmux window), Codex companion for independent gate review, and a shell script for automated verification. A control panel in tmux window 0 provides real-time phase status while Claude works in adjacent windows. Context is passed between phases through files, not shared sessions, so context bloat and self-review bias are eliminated.

The CLI manages phase lifecycle externally: crash-safe state via atomic `state.json` writes, two-level file locking with atomic handoff (outer → inner process), and full crash recovery through `resume` / `jump` / `skip` commands.

---

## Prerequisites

Before using the CLI, install these dependencies (all are checked by preflight):

| Dependency | Purpose | Install |
|------------|---------|---------|
| **Node.js ≥ 18** | Runtime for the CLI and Codex companion | [nodejs.org](https://nodejs.org) |
| **pnpm** | Package manager (for this repo) | `npm install -g pnpm` |
| **git** | Required; target project must be a git repo with ≥1 commit | built-in on macOS/Linux |
| **Claude Code CLI** (`claude`) | Used for interactive phases 1/3/5 | [claude.ai/code](https://claude.ai/code) |
| **Codex companion** | Used for gate phases 2/4/7. Path is auto-detected at `~/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs` | Install the `openai-codex` Claude plugin |
| **harness-verify.sh** | Used for Phase 6 auto-verification. Expected at `~/.claude/scripts/harness-verify.sh` | Copy from this repo's skill distribution |
| **jq** | Used by `harness-verify.sh` to parse `checklist.json` | `brew install jq` / `apt install jq` |
| **tmux** | Hosts the control panel and Claude windows | `brew install tmux` / `apt install tmux` |

**Platform**: macOS only. iTerm2 is preferred for automatic window opening; Terminal.app is used as fallback. Linux support is out of scope.

**Terminal**: The CLI opens a new iTerm2 (or Terminal.app) window for the tmux session. Your original terminal is returned immediately. Escalation menus run inside the tmux control window, so a TTY is always available.

---

## Installation

Clone the repo and link globally for development:

```bash
git clone <repo-url> harness-cli
cd harness-cli
pnpm install
pnpm run build
pnpm link --global
```

After linking, the `harness` command is available in any directory.

When you modify source code, rebuild to propagate changes to the global command:

```bash
pnpm run build
```

To uninstall:

```bash
pnpm unlink --global harness-cli
```

---

## Usage

Run all commands from a target git project (NOT from `harness-cli` itself):

```bash
cd /path/to/your/project
harness --help
```

### Start a new run

```bash
harness run "Add GraphQL API with user authentication"
```

This creates a **tmux session** and opens it in a new iTerm2 window. Your original terminal is returned immediately.

Inside the tmux session:
- **Window 0 (control panel)**: Shows real-time phase status, gate/verify streaming logs, and escalation menus
- **Window N (phase-N)**: Claude runs interactively in a separate window per phase

The control panel displays which phase is active. Switch between windows with `Ctrl-B 0` (control) and `Ctrl-B 1` (Claude).

Phase 1 (brainstorming) starts automatically. Claude asks clarifying questions and writes:

- `docs/specs/<runId>-design.md` — spec document
- `.harness/<runId>/decisions.md` — decision log

When Phase 1 finishes, the Claude window closes automatically, focus returns to the control panel, and the CLI advances through:

- **Phase 2**: Codex reviews the spec (progress streamed to control panel) → `APPROVE` or `REJECT`
- **Phase 3**: Claude opens in a new tmux window for planning → `docs/plans/<runId>.md` + `.harness/<runId>/checklist.json`
- **Phase 4**: Codex reviews spec + plan
- **Phase 5**: Claude opens in a new tmux window for implementation (must git commit before exit)
- **Phase 6**: `harness-verify.sh` runs the checklist (output streamed to control panel) → `docs/process/evals/<runId>-eval.md`
- **Phase 7**: Codex reviews everything (spec + plan + eval report + diff)

### Flags for `harness run`

```bash
harness run "task" --allow-dirty   # allow unstaged/untracked changes at start (staged still blocked)
harness run "task" --auto          # autonomous mode: no escalation menus, limit-exceeded → force-pass
harness run "task" --root <dir>    # use <dir>/.harness/ instead of the git root
```

**Already inside tmux?** The CLI detects `$TMUX` and creates a new window in your current session instead of launching a new terminal — no tmux-in-tmux nesting.

```bash
# Inside an existing tmux session:
harness run "task"   # creates a 'harness-ctrl' window in the current session
```

### Resume a run

If the terminal closes, the tmux session stays alive. Re-attach:

```bash
harness resume                       # resumes the current run (.harness/current-run pointer)
harness resume 2026-04-12-graphql-api   # resume a specific runId
```

Resume handles three cases automatically:
1. **Session + inner alive** — re-attaches to the existing tmux session (opens iTerm2 window)
2. **Session alive, inner dead** — restarts the phase loop inside the existing tmux session
3. **No session** — creates a fresh tmux session and starts the phase loop from the saved checkpoint

Pending actions (from `skip`/`jump`) are consumed on restart.

### Inspect state

```bash
harness status     # print current phase, artifacts, retries, pending action
harness list       # show all runs in this repo with their status
```

`status` and `list` are read-only and work without a TTY, so they're safe to use in CI or pipelines.

### Force progression

```bash
harness skip                  # force-pass the current phase (e.g., skip a re-review cycle)
harness jump 3                # backward jump — reset to Phase 3 and restart from there
```

These are **control-plane commands** — they don't acquire the lock. Instead:
- If the inner process is running: writes a `pending-action.json` file and sends `SIGUSR1` to the inner process. The active Claude window is killed and the phase loop re-enters at the new phase.
- If no inner process is running: saves the action to `pending-action.json` for the next `harness resume` to pick up.

`jump` is **backward-only** (N must be less than the current phase, or the run must be completed).

---

## Typical workflow

```bash
# 1. Start in a clean git repo
cd ~/projects/my-app
git status   # should be clean

# 2. Kick off a run — a new iTerm2 window opens with the tmux session
harness run "Add dark mode toggle to the settings page"
# Your terminal is returned immediately. Work happens in the new window.

# 3. In the tmux session:
#    - Ctrl-B 0 → control panel (phase status, gate logs)
#    - Ctrl-B 1 → active Claude window
#    If Codex rejects the spec, Claude reopens automatically with the feedback.
#    If it rejects 3 times, the control panel shows an escalation menu.

# 4. Close the iTerm2 window — the tmux session survives
harness status   # see where you are (read-only, works from any terminal)
harness resume   # re-attach to the running tmux session

# 5. Skip or jump while the session is running (from another terminal):
harness skip     # sends SIGUSR1 → current phase force-passed
harness jump 3   # sends SIGUSR1 → resets to Phase 3
```

---

## How it works

### Architecture: outer/inner split

`harness run` is split into two processes:

```
[Your terminal]                          [iTerm2 — tmux session]
$ harness run "task"                     Window 0 (control):
  ├── preflight checks                     harness __inner <runId>
  ├── state init                           ├── Phase 1: tmux new-window "claude ..."
  ├── tmux new-session                     │   ├── control shows "Phase 1 ▶"
  ├── tmux send-keys "__inner"             │   ├── sentinel detected → kill window
  ├── poll for handoff complete            │   └── control: "Phase 1 ✓"
  ├── open iTerm2 window                   ├── Phase 2: codex runs in control
  └── exit(0) ← terminal returned         │   └── stderr streamed live
                                           ├── Phase 3: tmux new-window "claude ..."
                                           └── ... through Phase 7
```

**Outer** (your terminal): preflight → state init → create tmux session → handoff lock to inner → open iTerm2 → exit.

**Inner** (`__inner`, hidden command): claims lock ownership → runs the phase loop inside tmux window 0. Claude sessions spawn as separate tmux windows. Gate/verify output streams to the control panel.

### Phase execution

```
tmux session "harness-<runId>"
  ├── Window 0 (control panel)
  │     harness __inner — phase loop + status display
  │     Gate/verify stderr streamed here
  │
  ├── Window "phase-1" (Claude brainstorm)    ← auto-created, auto-killed
  ├── Window "phase-3" (Claude planning)      ← auto-created, auto-killed
  └── Window "phase-5" (Claude implementation)← auto-created, auto-killed
```

| Phase | Where it runs | What happens |
|-------|--------------|--------------|
| 1 | tmux window `phase-1` | Claude brainstorms → spec doc |
| 2 | control window | Codex reviews spec (stderr streamed) |
| 3 | tmux window `phase-3` | Claude writes plan + checklist |
| 4 | control window | Codex reviews plan |
| 5 | tmux window `phase-5` | Claude implements (must git commit) |
| 6 | control window | `harness-verify.sh` runs checklist (output streamed) |
| 7 | control window | Codex reviews everything |

### Lock handoff

The outer process acquires the lock and sets `handoff: true` with its PID. The inner process claims ownership by updating `cliPid` to its own PID and setting `handoff: false`. The outer polls for this transition (max 5 seconds) before exiting. If the inner fails to start, the outer kills the tmux session and releases the lock.

### Execution modes

- **Dedicated mode** (default, outside tmux): Creates a new tmux session `harness-<runId>`. On completion, the entire session is killed.
- **Reused mode** (inside an existing tmux session): Creates windows in the current session. On completion, only harness-owned windows are killed; the parent session is preserved.

State is persisted in `.harness/<runId>/state.json` (atomically written). All artifacts (`spec`, `plan`, `eval report`) are auto-committed at phase boundaries so the eval gate (Phase 7) can review the full diff.

**For a detailed phase-by-phase breakdown** (which AI agent runs where, model names, output locations, session clear points, state management, signal handling) see [`docs/HOW-IT-WORKS.md`](docs/HOW-IT-WORKS.md).

**For the tmux rearchitecture design** (ADRs on outer/inner split, lock handoff, reused-session mode, control-plane signals), see [`docs/specs/2026-04-14-tmux-rearchitecture-design.md`](docs/specs/2026-04-14-tmux-rearchitecture-design.md).

**For the original CLI design rationale** (ADRs, edge cases), see [`docs/specs/2026-04-12-harness-cli-design.md`](docs/specs/2026-04-12-harness-cli-design.md).

---

## Troubleshooting

**`tmux is required. Install with: brew install tmux`** — The CLI requires tmux for its multi-window architecture. Install it and try again.

**`harness requires a git repository`** — Run from inside a git repo with at least one commit.

**`harness is already running (PID: ...)`** — Another CLI instance holds the lock. If it really is dead, check `.harness/repo.lock` manually.

**`Cannot start harness run: staged changes exist`** — Harness refuses to start with staged changes because it auto-commits artifacts. Unstage (`git restore --staged .`) or commit them first.

**`Inner process failed to start within 5 seconds.`** — The `__inner` process didn't claim lock ownership in time. The tmux session is cleaned up automatically. Check for errors with `tmux list-sessions` and retry.

**`Could not open a terminal window automatically.`** — Neither iTerm2 nor Terminal.app could be launched via AppleScript. The tmux session is still alive — attach manually with the printed `tmux attach -t harness-<runId>` command.

**`claude @file syntax is required but not supported`** — Upgrade Claude Code CLI to the current version.

**Closed the iTerm2 window by accident?** — The tmux session survives. Run `harness resume` to re-attach, or manually: `tmux attach -t harness-<runId>`.

**Stuck on a phase?** — `harness status` shows exactly where you are. `harness resume` re-attaches to the running session. `harness skip` / `harness jump N` work from any terminal, even while the session is running.

---

## License

MIT
