# PR body draft — Control-pane multiline task paste support

**Branch:** `fix/control-pane-multiline-task-paste` → `main`
**Interview spec:** `.omx/specs/deep-interview-multiline-task-intake.md`

## Summary

Fixes the no-argument `harness start` / `harness run` task prompt so the control
panel can accept a pasted multiline task brief without truncating at the first
line or leaking the remaining lines into later prompts.

The existing prompt used `readline.question()`, which is fundamentally a
single-line abstraction. This PR replaces only that pre-loop intake surface with
an isolated custom buffered prompt that preserves the current `Enter = submit`
behavior for normal typing while safely admitting multiline paste blobs.

## Why

Users often paste spec-style task briefs into the initial control-panel prompt.
With the old single-line prompt, the first newline ended the answer, so only the
first line was captured and the rest of the pasted text could bleed into the
next control prompt.

## What changed

- Added `src/task-prompt.ts`
  - custom buffered task prompt for the initial no-arg task-entry path
  - explicit bracketed-paste handling (`\x1b[200~` / `\x1b[201~`)
  - implicit multiline-paste fallback for multiline chunks delivered without
    bracketed wrappers
  - preserves normal `Enter = submit` typing behavior
- Updated `src/commands/inner.ts`
  - removed the old `readline.question()` task prompt
  - routed no-arg task entry through the new buffered prompt
- Added `tests/task-prompt.test.ts`
  - submit-on-enter behavior
  - implicit multiline paste capture
  - explicit bracketed paste capture
  - split escape-sequence handling
  - backspace behavior
- Updated `README.md` / `README.ko.md`
  - documented that the control-pane prompt supports multiline paste

## Simplifications

- The change is intentionally scoped to the **pre-loop no-arg task prompt only**.
  It does not redesign the general phase-loop input system.
- CLI one-shot task ingress (`harness start "..."`, `--task-file`, stdin) stays
  out of scope.
- Shift+Enter / typed multiline authoring is intentionally not introduced.

## Verification

```text
pnpm run lint
pnpm run build
pnpm test
```

Observed result on this branch:
- `pnpm run lint` ✅
- `pnpm run build` ✅
- `pnpm test` ✅ (`56 passed`, `794 passed / 1 skipped`)

## Remaining risks

1. **Real terminal variance:** bracketed paste support depends on terminal/tmux
   behavior. The implementation includes a multiline-chunk fallback, but a real
   manual smoke test is still valuable.
2. **Prompt redraw behavior:** the prompt now performs a redraw on paste/control
   edits. This is intentionally isolated to the startup task prompt so any UX
   flicker risk does not affect the phase loop.
3. **Out of scope ingress footguns remain:** shell-quoted one-shot invocation
   can still be tripped up by shell quoting/backticks because this PR only fixes
   the control-pane prompt path.

## Manual smoke to run before merge

```bash
harness start
```

Then in the control pane:
- paste a multiline brief containing blank lines
- confirm the full text lands in `.harness/<runId>/task.md`
- confirm later prompts are not polluted by trailing pasted lines
- confirm a normal one-line typed task still submits with a single Enter

## Scope notes

- In scope: no-arg control-pane task entry only
- Out of scope: CLI one-shot task ingress improvements, typed multiline authoring,
  Shift+Enter conventions, editor-based compose UI
