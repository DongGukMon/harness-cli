# How harness-cli works

This document describes what actually happens when you run `harness run "task"` — each phase, the AI agent used, the model, the input/output locations, and when sessions are cleared between phases.

For the overall rationale (why multi-session, why file-based context transfer), see `docs/specs/2026-04-12-harness-cli-design.md`.

---

## Overview

```
harness run "task"
  │
  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Phase 1: Brainstorming     claude    opus-4-6      interactive     │
│    ↓ spec + decisions (files)                                       │
│  Phase 2: Spec Gate         codex     (its own)     automated       │
│    ↓ APPROVE / REJECT                                               │
│  Phase 3: Planning          claude    sonnet-4-6    interactive     │
│    ↓ plan + checklist                                               │
│  Phase 4: Plan Gate         codex     (its own)     automated       │
│    ↓ APPROVE / REJECT                                               │
│  Phase 5: Implementation    claude    sonnet-4-6    interactive     │
│    ↓ git commits                                                    │
│  Phase 6: Auto Verify       bash      N/A           automated       │
│    ↓ eval report                                                    │
│  Phase 7: Eval Gate         codex     (its own)     automated       │
│    ↓ APPROVE → run complete                                         │
└─────────────────────────────────────────────────────────────────────┘
```

**Key invariant**: each phase runs in a fresh OS process. There is no "main Claude session" that stays open across phases. Context is passed through files.

---

## Phase-by-phase breakdown

### Phase 1 — Brainstorming

| | |
|---|---|
| **Agent** | Claude Code CLI (`claude`) |
| **Model** | `claude-opus-4-6` |
| **Mode** | Interactive (TTY inherits from harness CLI) |
| **Spawn command** | `claude --model claude-opus-4-6 @<init-prompt-file>` |
| **Input** | `.harness/<runId>/task.md` (the task description you passed to `harness run`) |
| **Output** | `docs/specs/<runId>-design.md` (spec document)<br>`.harness/<runId>/decisions.md` (decision log with ADRs, constraints, resolved ambiguities) |
| **Completion signal** | Claude writes `.harness/<runId>/phase-1.done` containing the current `phaseAttemptId` (UUID v4) |

**What happens**: The CLI spawns Claude with an initial prompt that points Claude at the task file. Claude asks clarifying questions, proposes approaches, presents a design, and when you approve, writes the spec + decision log. Claude creates the sentinel file with its `phaseAttemptId` to signal completion, then exits.

**Artifact format**:
- Spec: Markdown with `## Context & Decisions` section at the top (contains ADRs)
- Decision log: Markdown structured by "핵심 결정사항 / 제약 조건 / 해소된 모호성 / 구현 시 주의사항"

**On completion**: CLI validates the artifacts (existence, non-empty, mtime ≥ `phaseOpenedAt[1]`), runs `normalizeArtifactCommit` for the spec doc (decisions.md is gitignored under `.harness/`), records `specCommit = git rev-parse HEAD`, and advances to Phase 2.

---

### Phase 2 — Spec Gate

| | |
|---|---|
| **Agent** | Codex companion (external reviewer) |
| **Model** | Codex's internal model (controlled by the companion binary) |
| **Mode** | Automated (non-interactive, reads prompt from stdin) |
| **Spawn command** | `node <codexPath> task --effort high` |
| **Input** | `docs/specs/<runId>-design.md` (inlined into prompt) + shared reviewer contract |
| **Output** | Structured verdict to stdout:<br>`## Verdict` (APPROVE/REJECT)<br>`## Comments` (with P0/P1/P2/P3 severity + locations)<br>`## Summary` |
| **Sidecar files (transient)** | `.harness/<runId>/gate-2-raw.txt` (raw stdout)<br>`.harness/<runId>/gate-2-result.json` ({exitCode, timestamp})<br>`.harness/<runId>/gate-2-error.md` (only on error)<br>`.harness/<runId>/gate-2-feedback.md` (only on REJECT, persisted for next phase) |
| **Timeout** | 120 seconds |

**What happens**: Codex reviews the spec independently. The reviewer contract (shared across all gates) instructs it to return `APPROVE` only if zero P0/P1 findings exist; every comment must cite a specific location.

**Outcomes**:
- **APPROVE**: sidecar files deleted, advance to Phase 3
- **REJECT** (retries < 3): Phase 1 reopens with `gate-2-feedback.md` injected into Claude's prompt. `gateRetries[2]` increments.
- **REJECT** (retries ≥ 3): Escalation menu — `[C]ontinue` (reset retries, reopen), `[S]kip` (force-pass), `[Q]uit` (paused)
- **Error** (non-zero exit, timeout, or no `## Verdict` header): Retry/Skip/Quit menu; `gate-N-error.md` saved for inspection

---

### Phase 3 — Planning

| | |
|---|---|
| **Agent** | Claude Code CLI (`claude`) |
| **Model** | `claude-sonnet-4-6` |
| **Mode** | Interactive |
| **Spawn command** | `claude --model claude-sonnet-4-6 @<init-prompt-file>` |
| **Input** | Spec doc path + decision log path (Claude reads the files) |
| **Output** | `docs/plans/<runId>.md` (implementation plan)<br>`.harness/<runId>/checklist.json` (verification checklist) |
| **Completion signal** | `.harness/<runId>/phase-3.done` with `phaseAttemptId` |

**Checklist format** (validated by CLI at completion):

```json
{
  "checks": [
    { "name": "Type Check", "command": "pnpm run lint" },
    { "name": "Unit Tests", "command": "pnpm test" }
  ]
}
```

**On completion**: CLI validates plan + checklist schema, runs `normalizeArtifactCommit` for the plan (checklist is gitignored), records `planCommit`, advances to Phase 4.

---

### Phase 4 — Plan Gate

| | |
|---|---|
| **Agent** | Codex companion |
| **Mode** | Automated |
| **Input** | Spec doc + plan doc (both inlined) |
| **Output** | Same structured verdict as Phase 2 |
| **Sidecar files** | `gate-4-raw.txt`, `gate-4-result.json`, `gate-4-error.md`, `gate-4-feedback.md` |
| **Timeout** | 120 seconds |

**On REJECT**: Phase 3 reopens with feedback. Same retry/escalation mechanics as Phase 2.

---

### Phase 5 — Implementation

| | |
|---|---|
| **Agent** | Claude Code CLI (`claude`) |
| **Model** | `claude-sonnet-4-6` |
| **Mode** | Interactive (**NEW session — explicit clear point**) |
| **Spawn command** | `claude --model claude-sonnet-4-6 @<init-prompt-file>` |
| **Input** | Spec doc, plan doc, decision log, feedback files (all paths; Claude reads them) |
| **Output** | Git commits (the code changes themselves) |
| **Completion signal** | `.harness/<runId>/phase-5.done` with `phaseAttemptId` |
| **Additional completion requirements** | ≥ 1 commit since `implRetryBase` + working tree clean |

**What happens**: This is the first explicit session clear point in the lifecycle. Phase 5 runs in a completely fresh Claude process, with only the spec/plan/decisions files as context. Phase 1's brainstorming dialog is discarded — Claude reads the committed design docs and implements against them.

Claude must `git commit` the code changes. The initial prompt explicitly warns: "commit 없이 세션을 종료하면 eval gate에서 변경분을 볼 수 없어 run이 실패한다."

**On completion**: CLI validates commits exist (`git log <implRetryBase>..HEAD` non-empty) and working tree is clean. Records `implCommit = git rev-parse HEAD`.

**Feedback flow**: If Phase 7 later rejects, Phase 5 reopens. If Phase 6 previously failed (verify-feedback.md exists), both `gate-7-feedback.md` and `verify-feedback.md` are passed in the prompt so Claude addresses both.

---

### Phase 6 — Automated Verification

| | |
|---|---|
| **Agent** | Shell script (`~/.claude/scripts/harness-verify.sh`) |
| **Mode** | Automated (no AI) |
| **Spawn command** | `~/.claude/scripts/harness-verify.sh <checklistPath> <evalReportPath>` |
| **Input** | `.harness/<runId>/checklist.json` (the checks to run) |
| **Output** | `docs/process/evals/<runId>-eval.md` (evaluation report) |
| **Sidecar files** | `verify-result.json` ({exitCode, hasSummary, timestamp})<br>`verify-feedback.md` (only on FAIL, copy of eval report)<br>`verify-error.md` (only on ERROR) |
| **Timeout** | 300 seconds |

**Preconditions** (run before spawn, in this order):
1. Staged changes check — fail if non-eval-report files are staged
2. Unstaged/untracked check — fail if non-eval-report files are dirty
3. Eval report cleanup — delete existing eval report based on git status:
   - untracked → `rm`
   - staged new → `git restore --staged` + `rm`
   - git-tracked → `git rm -f` + `git commit`
4. Final clean-tree verification

**Eval report format**: The script writes a header first, runs all checks, then appends `## Summary`. The CLI uses presence of `## Summary` to distinguish between FAIL (script completed, some checks failed) vs ERROR (script crashed mid-run).

**Outcomes**:
- **PASS** (exitCode 0 + `## Summary` present): `normalizeArtifactCommit` for eval report → `evalCommit` + `verifiedAtHead` set → advance to Phase 7
- **FAIL** (exitCode ≠ 0 + `## Summary` present): Copy eval report to `verify-feedback.md` → Phase 5 reopens with feedback → `verifyRetries` increments
- **ERROR** (exitCode ≠ 0 + no `## Summary`, or `verify-result.json` missing, or parse failure): `verify-error.md` saved → Retry/Quit menu

**Verify retry limit**: 3. On the 3rd consecutive FAIL, escalation menu appears (`[C]ontinue / [S]kip / [Q]uit`). `[S]kip` creates a synthetic eval report labeled "VERIFY SKIPPED" and advances to Phase 7.

---

### Phase 7 — Eval Gate

| | |
|---|---|
| **Agent** | Codex companion |
| **Mode** | Automated |
| **Input** | Spec doc + plan doc + eval report + `git diff <baseCommit>...HEAD` + metadata block |
| **Output** | Same structured verdict |
| **Sidecar files** | `gate-7-raw.txt`, `gate-7-result.json`, `gate-7-error.md`, `gate-7-feedback.md` |
| **Timeout** | 120 seconds |

**Prompt metadata block** (always present, regardless of external commits):

```
Harness implementation range: <baseCommit>..<implCommit> (Phase 1–5 commits).
Harness eval report commit: <evalCommit> (the commit that last modified the eval report).
Verified at HEAD: <verifiedAtHead> (most recent Phase 6 run).
Focus review on changes within the harness ranges above.
```

**Diff assembly**:
- Normal mode: `git diff <baseCommit>...HEAD` (full harness range)
- External commits detected: split into `git diff <baseCommit>...<implCommit>` + `git show <evalCommit>` + `## External Commits (not reviewed)` section

**Size limits**: per-file diff > 20KB is truncated with marker; per-input file > 200KB → gate execution error; total assembled prompt > 500KB → gate execution error.

**Outcomes**:
- **APPROVE**: `run.status = "completed"`, `currentPhase = 8` (terminal sentinel)
- **REJECT** (retries < 3): Phase 5 reopens with `gate-7-feedback.md` + any prior `verify-feedback.md`. `gateRetries[7]` increments. `verifyRetries` resets.
- **REJECT** (retries ≥ 3): Escalation menu
- **Error**: Retry/Skip/Quit menu

---

## Model Selection

Each interactive phase (1, 3, 5) and each gate phase (2, 4, 7) has a configurable model preset. Phase 6 (automated shell verification) has no AI model. At the start of every `harness run` or `harness resume`, the CLI presents a model-selection UI (via `promptModelConfig()` in `src/ui.ts`) that lets the user assign a preset to each remaining phase before any phase work begins.

Available presets are defined in `MODEL_PRESETS` in `src/config.ts`: `opus-max` (Claude Opus 4.6 / max effort), `opus-high`, `sonnet-high`, `codex-high` (Codex gpt-5.4 / high effort), and `codex-medium`. Default per-phase assignments come from `PHASE_DEFAULTS` in the same file (e.g., phase 1 defaults to `opus-max`, phases 3 and 5 to `sonnet-high`, gates 2/4/7 to `codex-high`). The model shown in each phase table above is the default preset; users can override per-phase at run start. Selections are persisted in `state.phasePresets` and survive resume; `migrateState()` in `src/state.ts` backfills defaults for older state files that predate the preset system.

---

## Runner Architecture

Phases that involve an AI agent are dispatched to one of two runners depending on the preset's `runner` field (`claude` or `codex`).

**`src/runners/claude.ts`** handles Claude interactive and gate modes. Interactive: Claude is launched inside the tmux workspace pane via `sendKeysToPane` using a wrapper that writes the Claude process PID to a sentinel file (`claude-<phase>-<attemptId>.pid`); the harness polls `pollForPidFile` to capture the PID, then watches for the phase completion sentinel (`phase-N.done`) using chokidar + PID polling. Gate: a `claude --print` subprocess is spawned with stdio piped; stdout is captured for verdict parsing. **`src/runners/codex.ts`** handles Codex interactive and gate modes. Interactive: a `codex exec --sandbox <level> --full-auto -` subprocess reads the assembled prompt from stdin and streams `[codex]`-prefixed progress lines to the control panel; there is no sentinel file — artifacts are validated directly after subprocess exit. Gate: `codex exec -` with stdin prompt, stdout captured.

Shared verdict helpers (`parseVerdict`, `buildGateResult`) live in `src/phases/verdict.ts` to avoid circular imports between the runner files and `src/phases/gate.ts`. Phase dispatch: `runGatePhase()` in `src/phases/gate.ts` and `runInteractivePhase()` in `src/phases/interactive.ts` both call `getPresetById(state.phasePresets[phase])` to resolve the preset and then branch on `preset.runner`.

---

## Session clear points

A "session clear" means a previous Claude session's in-memory context is completely discarded. The CLI creates explicit clear points by spawning fresh OS processes.

### Automatic clears (every phase boundary)

Every phase is a new process. So between **every pair of consecutive phases**, the previous session's memory is gone. Context flows only through files.

### Explicit "hard" clears (mentioned in design spec)

While all phase boundaries are clears, two are specifically called out as "explicit session clear points":

1. **Phase 3 → Phase 5**: Planning context discarded; impl starts fresh reading only spec + plan + decisions
2. **Phase 5 → Phase 7**: Impl context discarded; eval gate sees only artifacts + diff

These two boundaries are the hardest breaks. Phase 5 specifically is called out as "NEW SESSION" in the design because the implementer starts fresh with no dialog history from Phase 1's brainstorming or Phase 3's planning.

### Within a phase (no clear)

Once Claude is spawned for Phase 1/3/5, its session runs to completion. The CLI does not restart Claude mid-phase. Feedback for reopen scenarios (after a gate REJECT or verify FAIL) is delivered by spawning a NEW Claude process with feedback file paths in the initial prompt — Claude reads the files itself.

### On reopen (Gate REJECT / Verify FAIL)

When Phase N reopens due to a later phase rejecting, a **new Claude process** is spawned with:
- All original context files (spec, plan, decisions as appropriate)
- Feedback file paths injected (`gate-N-feedback.md`, `verify-feedback.md`)
- A fresh `phaseAttemptId` (UUID v4)

The previous sentinel file is checked against the new `phaseAttemptId` — if stale, it's deleted so the new session can write a fresh one.

---

## State management

### Run directory layout

```
.harness/
├── repo.lock               # repo-global lock (JSON: {cliPid, childPid, childPhase, runId, startedAt, childStartedAt})
├── current-run             # text file: runId of the currently active run
└── <runId>/               # e.g. 2026-04-12-graphql-api/
    ├── state.json          # authoritative run state (see below)
    ├── run.lock            # run-level marker (empty file)
    ├── task.md             # original task description
    ├── decisions.md        # Phase 1 output (gitignored)
    ├── checklist.json      # Phase 3 output (gitignored)
    ├── phase-1.done        # sentinel (contains phaseAttemptId)
    ├── phase-3.done
    ├── phase-5.done
    ├── gate-2-raw.txt      # transient (deleted after state advance)
    ├── gate-2-result.json
    ├── gate-2-error.md     # only on error
    ├── gate-2-feedback.md  # only on REJECT (persisted for reopen)
    ├── gate-4-*
    ├── gate-7-*
    ├── verify-result.json
    ├── verify-feedback.md  # only on FAIL
    └── verify-error.md     # only on ERROR
```

### `state.json` contents

```json
{
  "runId": "2026-04-12-graphql-api",
  "currentPhase": 3,
  "status": "in_progress",
  "autoMode": false,
  "task": "GraphQL API 추가",
  "baseCommit": "<sha>",
  "implRetryBase": "<sha>",
  "codexPath": "/Users/.../codex-companion.mjs",
  "externalCommitsDetected": false,
  "artifacts": { "spec": "...", "plan": "...", "decisionLog": "...", "checklist": "...", "evalReport": "..." },
  "phases": { "1": "completed", "2": "completed", "3": "in_progress", "4": "pending", ... },
  "gateRetries": { "2": 0, "4": 0, "7": 0 },
  "verifyRetries": 0,
  "pauseReason": null,
  "specCommit": "<sha>",   // set after Phase 1 normalize
  "planCommit": null,
  "implCommit": null,      // set after Phase 5 completion
  "evalCommit": null,      // set after Phase 6 normalize
  "verifiedAtHead": null,
  "pausedAtHead": null,
  "pendingAction": null,   // crash-recovery hint
  "phaseOpenedAt": { "1": 1744444800000, "3": null, "5": null },
  "phaseAttemptId": { "1": "uuid-v4", "3": null, "5": null }
}
```

### Atomic writes

All `state.json` updates use: `write to state.json.tmp → fsync → rename`. POSIX rename is atomic, so `state.json` is always either the old version or the new version — never corrupted mid-write.

### Commit anchors

The CLI records git SHAs at each phase boundary to enable ancestry validation on resume:

| Anchor | Set at | Used for |
|--------|--------|----------|
| `baseCommit` | `harness run` (after `.gitignore` commit) | Phase 7 diff start |
| `specCommit` | Phase 1 normalize | Resume ancestry + artifact dirty check |
| `planCommit` | Phase 3 normalize | Same |
| `implCommit` | Phase 5 completion | Phase 7 diff end (harness range) |
| `evalCommit` | Phase 6 normalize | Phase 7 eval review |
| `verifiedAtHead` | Phase 6 PASS (and skip) | Phase 7 metadata |
| `pausedAtHead` | Every intentional exit | External commit detection on resume |

---

## Concurrency control

### Two-level locking

1. **repo-global lock** `.harness/repo.lock` — atomically created via `fs.openSync(path, 'wx')` (O_EXCL). Prevents two `harness` processes from operating on the same repo simultaneously. JSON format with PID + start time metadata for PID-reuse detection.

2. **run-level lock** `.harness/<runId>/run.lock` — presence-only marker file created/deleted alongside `repo.lock`. Helps identify which run owned an abandoned `repo.lock`.

### Liveness check (PGID-based)

When another lock is found, the CLI checks:
- Is `cliPid` alive? → check via `kill(cliPid, 0)` + start time match
- If CLI is dead, is the child process group still alive? → `kill(-childPid, 0)` (negative PID = PGID)
- If PGID alive → ALWAYS active (safer false-positive than missing orphan children)
- If PGID dead (ESRCH) → stale, delete both locks and proceed

### Process groups

Every subprocess spawn uses `detached: true`. This makes the child the leader of its own process group. The CLI kills via `process.kill(-childPid, 'SIGTERM')` → 5s wait → `SIGKILL` to ensure any subprocesses the child spawned are also terminated.

On normal completion, the CLI waits for PGID `ESRCH` before clearing `childPid` in the lock — prevents the next phase from spawning before the previous one's orphans are gone.

---

## Signal handling

`harness run` and `harness resume` (and `skip`/`jump` once they enter the phase loop) register `SIGINT` + `SIGTERM` handlers. On signal:

1. Kill child process group: SIGTERM → 5s wait → SIGKILL
2. Save `pausedAtHead = git rev-parse HEAD`
3. Update phase status (interactive → `failed`, automated → `error` with `pendingAction`)
4. Atomic state write
5. Release both lock files
6. Exit code 130 (SIGINT convention)

So hitting Ctrl-C is always safe: state is preserved, and `harness resume` picks up from the saved checkpoint.

---

## InputManager

`src/input.ts` exports `InputManager`, which owns stdin in raw mode for the entire lifetime of the `__inner` process. It is started (`inputManager.start('configuring')`) before model selection and stopped (`inputManager.stop()`) only after the phase loop exits. Without raw-mode ownership, arrow-key presses while no readline prompt is active emit raw ANSI sequences (`^[[A`) that clutter the control panel output.

The manager tracks four internal states: `idle` (phase loop running, Claude owns the terminal), `configuring` (model-selection UI active), `prompt-single` (waiting for a single keypress via `waitForKey(validKeys)`), and `prompt-line` (text input via `waitForLine()`). Ctrl+C routing depends on the `isPreLoop` flag: before `enterPhaseLoop()` is called (during model selection), Ctrl+C invokes `onConfigCancel`, which persists state as paused and exits cleanly. After `enterPhaseLoop()`, Ctrl+C is forwarded as `SIGINT` to trigger the normal shutdown handler. The initial task prompt (when no `task.md` exists yet) uses a standard readline interface rather than InputManager — per ADR-6/7, stdin raw mode is not active at that point.

---

## Error recovery

Crash-safe recovery is achieved through:

1. **Atomic state writes** — `state.json` is never corrupted mid-write
2. **Sentinel-based completion** — interactive phase completion requires a fresh sentinel matching `phaseAttemptId`; a partial Claude session that crashed won't match
3. **pendingAction replay** — before making a state transition, the runner writes the intended action atomically. On resume, the action is replayed idempotently.
4. **Committed artifacts** — spec, plan, eval report are auto-committed. Resume validates each against its `*Commit` anchor to detect tampering.
5. **Lock `.tmp` recovery** — if a crash happens during a lock update, the `.tmp` file is parsed, liveness-checked, and safely cleaned up on next startup

The authoritative resume algorithm is in `src/resume.ts`. Key branches:

- `pendingAction` non-null → replay by type (`reopen_phase`, `rerun_gate`, `rerun_verify`, `show_escalation`, `show_verify_error`, `skip_phase`)
- Phase 1/3/5 in `in_progress`/`failed` with fresh sentinel → complete inline (no respawn)
- Phase 1/3 in `error` with valid artifacts → retry normalize_artifact_commit
- Phase 6 in `in_progress` with `verify-result.json` → apply stored PASS/FAIL/ERROR outcome
- Phase 6 in `error` with valid eval report → retry normalize

---

## Resume + Config-Cancel

`harness resume` passes a `--resume` flag through to `__inner`; `inner.ts` receives it as `options.resume`. When the flag is set and a `task.md` already exists, `inner.ts` skips the task-prompt step and immediately processes any `pendingAction` stored in `state.json`. This allows recovery from any paused state — including mid-phase crashes, gate escalations, and the config-cancel flow described below.

Config-cancel is a special pause mode triggered when the user presses Ctrl+C during the model-selection step. The InputManager's `onConfigCancel` handler sets `state.pauseReason = 'config-cancel'` and `state.pendingAction = { type: 'reopen_config' }`, writes state atomically, and exits. On resume, `inner.ts` sees the existing task, loads the state, calls `getEffectiveReopenTarget()` (defined in `src/config.ts`) to compute which phase to show in the model selector, and re-enters the selection UI — effectively restarting from just before any phase was launched. `getEffectiveReopenTarget` resolves the target phase from the pending action: `reopen_phase` → `targetPhase`; `show_escalation` → `sourcePhase`; `reopen_config` → uses `currentPhase` directly.

---

## Bug Fixes

Two durable state fields address races that could corrupt artifacts or leave orphan processes:

`state.phaseReopenFlags` (a `Record<'1'|'3'|'5', boolean>`) is set to `true` before a phase is queued to reopen after a gate REJECT. `preparePhase()` in `src/phases/interactive.ts` reads this flag via `isReopen` and, when true, skips deleting the phase's artifacts — preserving the existing spec or plan so Claude can edit rather than start from scratch. The flag is cleared to `false` at the end of `preparePhase()`.

`state.lastWorkspacePid` + `state.lastWorkspacePidStartTime` track the PID and start-time of the most recently spawned Claude workspace process. Before launching a new interactive phase, `runClaudeInteractive()` checks whether the previous PID is still alive (verified by start-time to guard against PID reuse) and sends it a Ctrl+C before proceeding. `handleShutdown` in `src/signal.ts` performs a dual-PID kill: it terminates both the current child process group (via the repo lock's `childPid`) and the saved `lastWorkspacePid`, preventing orphan Claude sessions from persisting after harness exits.

---

## Preflight

Every command runs dependency checks before doing any work:

| Item | Check |
|------|-------|
| git | `git rev-parse --show-toplevel` |
| head | `git rev-parse HEAD` (rejects empty repos) |
| node | `node --version` |
| claude | `which claude` |
| claudeAtFile | `claude --model claude-sonnet-4-6 @<tmpfile> --print ''` (weak signal) |
| verifyScript | `~/.claude/scripts/harness-verify.sh` exists + executable |
| jq | `jq --version` |
| codexPath | glob resolution in `~/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs` |
| platform | `process.platform` must be `darwin` or `linux` (rejects win32) |
| tty | `process.stdin.isTTY && process.stdout.isTTY` (skipped for `status`/`list`) |

Each command runs only the subset it needs:

- `harness run` → all 10 items
- `harness resume` / `jump` / `skip` → items for the phase that will execute next
- `harness status` / `list` → platform only (TTY-free)

---

## Further reading

- `docs/specs/2026-04-12-harness-cli-design.md` — full design spec with ADRs and every edge case rationale
- `docs/plans/2026-04-12-harness-cli.md` — implementation plan (task decomposition)
- `docs/process/evals/2026-04-12-harness-cli-eval.md` — auto-verification report
