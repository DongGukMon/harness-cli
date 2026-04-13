# harness-cli

A TypeScript CLI that orchestrates a 7-phase AI agent development lifecycle: brainstorm → spec gate → plan → plan gate → implement → verify → eval gate.

Each phase runs in its own isolated subprocess — Claude Code for interactive phases, Codex companion for independent gate review, and a shell script for automated verification. Context is passed between phases through files, not shared sessions, so context bloat and self-review bias are eliminated.

The CLI manages phase lifecycle externally: crash-safe state via atomic `state.json` writes, two-level file locking (repo-global + run-level) with PGID-based liveness checks, and full crash recovery through `resume` / `jump` / `skip` commands.

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

**Platform**: macOS or Linux only. Windows is not supported (depends on POSIX process groups and signal semantics).

**Terminal**: Interactive phases (1, 3, 5) and escalation menus require a real TTY.

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

This kicks off Phase 1 (brainstorming). Claude opens interactively in the current terminal, asks clarifying questions, and writes:

- `docs/specs/<runId>-design.md` — spec document
- `.harness/<runId>/decisions.md` — decision log

When Phase 1 finishes, the CLI automatically advances through:

- **Phase 2**: Codex reviews the spec and returns `APPROVE` or `REJECT`
- **Phase 3**: Claude writes the implementation plan (`docs/plans/<runId>.md`) + checklist (`.harness/<runId>/checklist.json`)
- **Phase 4**: Codex reviews spec + plan
- **Phase 5**: Claude implements the plan (must git commit before exit)
- **Phase 6**: `harness-verify.sh` runs the checklist → `docs/process/evals/<runId>-eval.md`
- **Phase 7**: Codex reviews everything (spec + plan + eval report + diff)

Between phases, the CLI prints a banner so you always know where you are.

### Flags for `harness run`

```bash
harness run "task" --allow-dirty   # allow unstaged/untracked changes at start (staged still blocked)
harness run "task" --auto          # autonomous mode: no escalation menus, limit-exceeded → force-pass
harness run "task" --root <dir>    # use <dir>/.harness/ instead of the git root
```

### Resume a run

If you quit, crash, or lose the terminal, pick up where you left off:

```bash
harness resume                       # resumes the current run (.harness/current-run pointer)
harness resume 2026-04-12-graphql-api   # resume a specific runId
```

Resume replays any pending action, validates committed artifacts against their git anchors, detects external commits that landed during pause, and then continues the phase loop.

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

`skip` advances to the next phase without re-running the current one. `jump N` resets phases ≥N to `pending` and clears the corresponding retries/commits/sidecars, then starts Phase N fresh.

`jump` is **backward-only** (N must be less than the current phase, or the run must be completed).

---

## Typical workflow

```bash
# 1. Start in a clean git repo
cd ~/projects/my-app
git status   # should be clean

# 2. Kick off a run
harness run "Add dark mode toggle to the settings page"

# 3. If Codex rejects the spec, Claude reopens automatically with the feedback.
#    If it rejects 3 times, you get an escalation menu: [C]ontinue / [S]kip / [Q]uit

# 4. If you need to take a break, hit Ctrl-C — state is saved automatically
harness status   # see where you are
harness resume   # pick up later

# 5. If you want to redo a phase:
harness jump 3   # back to planning

# 6. If you want to skip ahead (e.g., spec is fine, no review needed):
harness skip     # advance past the current phase
```

---

## How it works

Each phase is a separate OS process:

```
harness-cli (TypeScript orchestrator)
  ├── [1] claude --model opus      interactive brainstorm
  │     ↓ spec doc + decisions.md
  ├── [2] codex companion          automated spec review
  │     ↓ APPROVE / REJECT
  ├── [3] claude --model sonnet    interactive planning
  │     ↓ plan doc + checklist.json
  ├── [4] codex companion          automated plan review
  ├── [5] claude --model sonnet    interactive implementation (NEW session)
  │     ↓ git commits
  ├── [6] harness-verify.sh        automated verification
  │     ↓ eval report
  └── [7] codex companion          automated eval review
        ↓ APPROVE → run complete
```

State is persisted in `.harness/<runId>/state.json` (atomically written), with two-level locking to prevent concurrent runs. All artifacts (`spec`, `plan`, `eval report`) are auto-committed at phase boundaries so the eval gate (Phase 7) can review the full diff.

**For a detailed phase-by-phase breakdown** (which AI agent runs where, model names, output locations, session clear points, state management, signal handling) see [`docs/HOW-IT-WORKS.md`](docs/HOW-IT-WORKS.md).

**For full design rationale** (ADRs, edge cases), see [`docs/specs/2026-04-12-harness-cli-design.md`](docs/specs/2026-04-12-harness-cli-design.md).

---

## Troubleshooting

**`harness requires a git repository`** — Run from inside a git repo with at least one commit.

**`harness is already running (PID: ...)`** — Another CLI instance holds the lock. If it really is dead, check `.harness/repo.lock` manually.

**`Cannot start harness run: staged changes exist`** — Harness refuses to start with staged changes because it auto-commits artifacts. Unstage (`git restore --staged .`) or commit them first.

**`claude @file syntax is required but not supported`** — Upgrade Claude Code CLI to the current version.

**Stuck on a phase?** — `harness status` shows exactly where you are. `harness resume` retries from the saved checkpoint. `harness jump N` restarts from an earlier phase.

---

## License

MIT
