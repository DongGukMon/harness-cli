# Phase-Harness TUI Polish And Top-Bottom Layout

## Context & Decisions
The task asks to make the phase-harness TUI cleaner and more usable, and to replace the current left-right tmux split with a top-bottom split. In this codebase, the user-visible harness TUI is the Ink-based control pane rendered from `src/ink/**`, while the workspace pane runs Claude/Codex interactive sessions. The tmux split is created in `src/commands/inner.ts` through `splitPane(state.tmuxSession, controlPaneId, 'h', 60, cwd)`, so that is the primary layout change.

Decisions:
- Treat "TUI UI/UX" as the harness control pane only; do not redesign Claude Code or Codex CLI screens running in the workspace pane.
- Make the control pane the top pane and the workspace the bottom pane. The control pane should stay compact, with the workspace receiving most vertical space.
- Keep this as a targeted UI polish pass, not a lifecycle/state-machine rewrite. Existing phase orchestration, sentinel behavior, gate routing, logging semantics, and runner behavior must remain unchanged.
- Prefer incremental improvements to the existing Ink components over replacing Ink or adding a new UI framework.
- Update user-facing runtime layout docs so the documented tmux layout matches the implementation.

## Complexity
Medium — touches tmux pane creation, several Ink UI components, docs, and focused tests without introducing a new subsystem.

## Problem
The current runtime experience is hard to scan because the control panel reads like stacked status lines with repeated separators, and the tmux layout puts the control pane beside the workspace pane. The side-by-side layout competes for terminal width, which is especially painful for agent TUIs that expect a wide workspace. Users need a calmer control surface that communicates run status, current phase, available actions, and attach/help information without stealing horizontal space from the active agent.

## Goals
- Change the tmux runtime layout from left-right to top-bottom.
- Improve the control pane so status, progress, current phase details, and actions are visually grouped and easy to scan.
- Preserve existing keyboard behavior and phase lifecycle behavior.
- Keep the implementation small enough for one implementation plan and one focused test pass.

## Non-Goals
- Do not change phase ordering, retry limits, gate verdict parsing, verify behavior, sentinel protocols, or commit behavior.
- Do not modify Claude/Codex prompts or runner command semantics except where display text must reference the new layout.
- Do not add a curses-like alternate renderer or replace Ink.
- Do not add new runtime dependencies unless they are already present in the project.

## Requirements

### Top-Bottom Tmux Layout
- `innerCommand` must create the workspace pane with a vertical tmux split (`splitPane(..., 'v', percent, cwd)`) when no valid distinct workspace pane already exists.
- The control pane must remain the original pane and appear above the workspace pane.
- The workspace pane must be created below the control pane and receive most of the terminal height. Use a stable percentage in the 65-75 range for the new workspace pane so the control pane stays compact but readable.
- Reuse behavior must stay unchanged: if both stored control and workspace panes are valid and distinct, do not recreate them.
- Failure behavior must stay unchanged: if the control pane is invalid, print the existing fatal error and exit.
- Persisted `state.tmuxWorkspacePane` and `state.tmuxControlPane` semantics must not change.

### Control Pane UI Polish
- Keep `renderControlPanel` as the public facade and continue using `renderInkControlPanel` internally.
- The control panel should present clear regions in this order:
  1. Header with product name, flow badge, run id, and elapsed time when available.
  2. Phase timeline/progress.
  3. Current phase summary, including status, model/runner when applicable, and retry count when applicable.
  4. Gate verdict or recent outcome summary when available.
  5. Action/status row.
  6. Footer metrics and attach hint when available.
- Replace repeated dot-line separators with a lighter section treatment. Acceptable approaches include spacing, compact labels, or a single subtle divider between major groups; the result should not look like a stack of raw logs.
- Use existing `COLORS` and `GLYPHS` conventions or extend them minimally. The UI must stay readable in monochrome terminals by keeping meaningful text labels beside icons.
- Ensure narrow terminals remain usable. At widths below 60 columns, phase labels may collapse to phase numbers and long fields such as run id, model, or attach hints must truncate or wrap rather than producing broken output.
- The terminal-complete state must clearly say the run is complete and how to exit.
- The terminal-failed state must keep the existing `[R] Resume`, `[J] Jump`, `[Q] Quit` actions visible and prominent.
- In-progress phases must clearly say the harness is waiting for phase completion.

### Documentation
- Update `README.md` and `README.ko.md` runtime layout text to describe a top control pane and bottom workspace pane.
- Documentation must still mention the manual tmux attach command behavior.

## Invariants
- No lifecycle semantics change: phase statuses, pending actions, reopen routing, gate retries, verify retries, terminal states, and sentinel file names stay as they are.
- No runner behavior change: Claude/Codex commands are still injected into `state.tmuxWorkspacePane`.
- No state schema migration is required.
- Non-TTY fallback in `renderInkControlPanel` remains a plain status line on stderr.
- Existing telemetry event `ui_render` continues to emit with the same callsite values.
- Top-bottom layout applies only to pane creation; existing valid pane pairs are reused.

## Success Criteria
- Starting or resuming a run with no valid workspace pane creates a bottom workspace pane with `splitPane(..., 'v', <65-75>, cwd)`.
- Tests assert `innerCommand` requests a vertical split and stores the returned workspace pane id.
- Existing tmux utility tests for both `h` and `v` split flags continue to pass.
- Ink component tests cover the polished header/current phase/action/footer behavior, including at least one narrow-width case.
- `pnpm run lint` passes.
- Focused test commands pass for the changed areas:
  - `pnpm vitest run tests/commands/inner.test.ts tests/tmux.test.ts`
  - `pnpm vitest run tests/ink/render.test.ts tests/ink/components`
- Documentation no longer describes the runtime layout as a left-right or side-by-side split.

## Suggested Implementation Surface
- `src/commands/inner.ts`: switch default workspace pane creation from horizontal to vertical split and choose the final workspace height percentage.
- `src/ink/App.tsx`: adjust overall grouping and reduce visual noise.
- `src/ink/theme.ts`: add only small theme/glyph helpers if needed for clearer labels.
- `src/ink/components/Header.tsx`: improve title, flow badge, elapsed time, and run id presentation.
- `src/ink/components/PhaseTimeline.tsx`: keep full/light flow correctness while improving scannability.
- `src/ink/components/CurrentPhase.tsx`: make current phase status/model/retry information more structured.
- `src/ink/components/GateVerdict.tsx`: keep verdict visibility without overwhelming non-gate states.
- `src/ink/components/ActionMenu.tsx`: preserve terminal action keys and improve state text.
- `src/ink/components/Footer.tsx`: preserve metrics and attach hint while avoiding overflow on narrow terminals.
- `README.md` and `README.ko.md`: update runtime layout wording.
- Tests under `tests/commands`, `tests/tmux.test.ts`, and `tests/ink/**`: update expectations and add narrow/status coverage.

## Validation Plan
- Run `pnpm run lint`.
- Run `pnpm vitest run tests/commands/inner.test.ts tests/tmux.test.ts`.
- Run `pnpm vitest run tests/ink/render.test.ts tests/ink/components`.
- If the implementation changes shared rendering or tmux helpers beyond the files above, broaden to `pnpm vitest run`.
