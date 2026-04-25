# Spec — Codex Phase 5 uncommitted-changes detection

**Date**: 2026-04-25
**Issue**: [#84](https://github.com/DongGukMon/harness-cli/issues/84) — Phase 5 with codex preset loops failed when Codex skips git commit
**Related code**:
- `src/phases/interactive.ts` (Codex P5 dispatch + `validatePhaseArtifacts`)
- `src/phases/runner.ts` (`phase_end` event emission)
- `src/git.ts` (git helpers)

## Problem

When `phasePresets["5"]` resolves to a Codex preset, Phase 5 silently loops on `failed`
even when Codex (a) edited many files and (b) wrote a fresh `phase-5.done` sentinel
matching the current `attemptId`. `validatePhaseArtifacts(5)` only succeeds when HEAD
has advanced past `implRetryBase`, and `preparePhase` re-snaps `implRetryBase` to the
current HEAD on every retry. So a Codex impl session that ends with uncommitted edits
is indistinguishable from a no-op to the validator, and the operator gets no signal
pointing at the missing commit. The dogfood report (issue #84) burned 4 attempts /
~20 min before the cause was identified.

The Claude interactive branch does not hit this because `superpowers:subagent-driven-development`
enforces commits. The Codex branch has no equivalent guard.

## Goal

Make the failure mode visible. When Codex finishes a P5 attempt with the sentinel
fresh but the working tree dirty, surface a clear message (stderr) and a structured
event field (`events.jsonl`) so the operator knows exactly what to do — either commit
manually and resume, or switch the preset for P5 to a Claude variant.

This spec deliberately does **not** auto-recover. Auto-commit fallback is rejected
(see Out of Scope) because it relies on later phases catching bad code, and false-positive
commits would silently corrupt the run history.

## Trigger conditions

A new "uncommitted-changes" notice fires only when **all** of the following hold:

1. `phase === 5`
2. `preset.runner === 'codex'` (Claude branch unaffected)
3. The phase result is `failed` (validation rejected the attempt)
4. The sentinel file `phase-5.done` is *fresh* per `checkSentinelFreshness` —
   i.e., its content equals the current `attemptId`. This proves Codex itself
   declared completion. A stale/missing sentinel is a different failure mode
   (Codex crash / no completion claim) and uses the existing failure path.
5. At least one repo in `state.trackedRepos` has a non-empty `git status --porcelain`
   output.

When any of (1)–(5) is false, the existing failure path runs unchanged.

## UX — stderr message

On detection, write a single English block to stderr (matching the language of
existing operator-facing warns and `events.jsonl` field labels):

```
⚠️  Phase 5 failed: Codex completed (sentinel fresh) but left uncommitted changes:
    <repo path 1> — N files
    <repo path 2> — M files

  Resolve by:
    • Commit the changes manually, then Resume; or
    • Re-run with a Claude preset for phase 5 (e.g. claude-sonnet-default).
```

Written once per failed attempt via `process.stderr.write` (not `console.warn`,
to avoid interleaving with structured logger output). No ANSI coloring. Goes to
stderr unconditionally so operators see it even when `--enable-logging` is off.

## Telemetry — events.jsonl

Extend the existing `phase_end` event with an optional field (no new event type):

```ts
phase_end: {
  // ... existing fields
  uncommittedRepos?: Array<{ path: string; count: number }>;
}
```

Field semantics:
- Present (non-empty array) only when all 5 trigger conditions hold.
- Absent in every other case (Claude runs, non-P5 phases, clean working tree, etc.).
- `path` is the repo root absolute path; `count` is the line count of
  `git status --porcelain` (one-line-per-change convention).

The optional-field pattern matches the existing `claudeTokens?` 3-state contract
(present-on-applicable / absent-on-non-applicable / null-on-extraction-failure),
except here there is no "failure" state — git status is either non-empty or not.

CLAUDE.md's events table is updated to reflect this new field.

## Implementation outline

### New helper: `src/git.ts`

```ts
export interface UncommittedRepo {
  path: string;
  count: number;
}

export function detectUncommittedChanges(
  repoPaths: string[],
): UncommittedRepo[];
```

- Runs `git -C <path> status --porcelain` for each repo.
- Counts non-empty lines.
- Returns only repos with `count > 0`.
- Swallows per-repo errors (e.g. non-git path) silently; treats them as `count: 0`.
- Pure synchronous wrapper over `execSync` to match other helpers in `git.ts`.

### Detection site: `src/phases/interactive.ts`

Widen the existing `InteractiveResult` interface to include an optional
`uncommittedRepos?: UncommittedRepo[]` field, then in the Codex branch of
`runInteractivePhase`, after `waitForPhaseCompletion` returns and before the
final `return { ...result, attemptId }`:

```ts
if (
  phase === 5 &&
  result.status === 'failed' &&
  checkSentinelFreshness(sentinelPath, attemptId) === 'fresh'
) {
  const dirty = detectUncommittedChanges(state.trackedRepos.map(r => r.path));
  if (dirty.length > 0) {
    process.stderr.write(formatUncommittedWarn(dirty));
    result.uncommittedRepos = dirty;
  }
}
```

Stash the data on the result object so `runner.ts` can read it without re-running
git. `formatUncommittedWarn` is a small local helper that produces the block
shown in "UX — stderr message".

### Event emission: `src/phases/runner.ts`

Where `phase_end` is currently emitted for the P5 interactive path, read
`result.uncommittedRepos` (if defined) and include it in the event payload.

### Type extension: `src/types.ts`

Add `uncommittedRepos?: Array<{ path: string; count: number }>` to the `phase_end`
event type. Keep it strictly optional — older log readers must keep working.

## Documentation changes

Per CLAUDE.md doc-sync obligation, the following are updated in the same PR:

- `docs/HOW-IT-WORKS.md` + `.ko.md`: in the Phase 5 success-criteria section, add
  a callout that Codex on P5 depends on commit discipline, and describe the new
  notice + recommended remediation (commit + resume, or switch to Claude preset).
- `README.md` + `.ko.md`: scan for any P5 / preset coverage; add a one-line note
  if the existing sections cover Codex-on-P5. If they do not, add nothing — this
  is a niche failure mode and READMEs should not enumerate every edge case.
- `CLAUDE.md`: update the events.jsonl schema table to list the new
  `uncommittedRepos?` field on `phase_end`.

## Tests

- New `src/git.test.ts`: unit-test `detectUncommittedChanges` with a tmpdir git
  repo — clean tree returns `[]`; one-file dirty tree returns one entry with
  `count: 1`; non-git path returns `[]` without throwing.
- `src/phases/interactive.test.ts`: extend existing P5 + Codex test path. Three
  cases:
  1. Codex P5 + sentinel fresh + dirty tree → `uncommittedRepos` populated on
     result + stderr warn observed (spy on `process.stderr.write`).
  2. Codex P5 + sentinel fresh + clean tree → no warn, field absent.
  3. Claude P5 + dirty tree → no warn, field absent (Claude branch never calls
     the new code).
- `pnpm tsc --noEmit` and `pnpm vitest run` must both pass.

## Out of scope (explicitly rejected)

- **Auto-commit fallback** (issue suggestion #2): rejected. Relies on later phases
  catching bad code; false-positive commits silently corrupt run history. The
  reporter explicitly stated that even a stderr warn would have saved the run.
- **Codex prompt enforcement** (issue suggestion #3): rejected. Codex already
  receives the same commit instructions as Claude and ignores them. Adding more
  prompt text without a runner-side enforcement layer does not change behavior.
- **Reject codex-* presets for P5** (issue suggestion #4): rejected. Too aggressive
  for a niche failure mode; users may legitimately want Codex on P5.
- **Apply detection to Phase 1/3 / Claude branch**: rejected. Phase 1/3 do not
  depend on commit advancement, and Claude branch has commit-discipline guards
  via subagent-driven-development. Detection scope stays surgical to avoid
  false positives.
- **Opt-in `--codex-impl-auto-commit` flag**: rejected for now. YAGNI — easy to
  add later as a separate change if real users ask. This spec only ships
  detection + surfacing.

## Complexity

Small.
