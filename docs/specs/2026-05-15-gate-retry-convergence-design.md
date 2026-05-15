# Gate Retry Convergence — Trajectory + Stubborn-Requirement-ID Detection

- Spec date: 2026-05-15
- Branch / worktree: `retry-limit`
- Builds on (does not replace): `docs/specs/2026-05-06-phase-harness-gate-retry-8ea9-design.md` (stagnation v1, Jaccard adjacent-pair)
- Triggering issues:
  - `#111` — P3 plan-rewrite "whack-a-mole" loop: same spec requirement (R1.b, R8) rejected ≥4 times across distinct retries with non-identical wording, hash/Jaccard-based detector never fires
  - `#110` — `resume <runId>` silent crash on `pendingAction.type=show_escalation` (out of scope here, separate PR)

## Context

### Problem

`phase-harness` retry budget today is **count-based** (`gateRetries[phase]` integer). When the planner (Sonnet 4.6 in P3) "improves" the same spec requirement four different ways across cycles — each with different prose — three protections all fail to break the loop:

1. **Token-Jaccard stagnation detector** (v1) compares adjacent reject feedbacks. Different prose ⇒ similarity below 0.70 ⇒ never fires.
2. **`gateRetries` retry-limit** (3 in full, 5 in light) just resets after `[C] Continue` and the loop restarts.
3. **Reopen prompt** carries only the *latest* reject feedback. The planner does not see "you have already broken R1.b in 3 different ways" — from its perspective each cycle is a fresh single concern.

Observed instance (run `2026-05-14-untitled-396c`, full reject files in `.harness/`):

| Cycle.Retry | How R1.b broke this round (8 distinct hashes, never repeating) |
|---|---|
| 0.0 | `validateMatchData` lacks `providerId`, emits wrong shape |
| 0.2 | `throwForIssues` collapses individual issues |
| 1.0 | invents new `matchDataIssues` shape, drops `required`/`received` |
| 2.2 | `required` becomes joined hint string, `received` is whole payload |

Twelve+ P3/P4 cycles before the user manually edited the plan and force-passed via `state.json` surgery. `[C]` was a loop, `[Q]` was a dead-end (#110).

### Insight

The reviewer (Codex/GPT-5.5) is already producing **machine-extractable requirement IDs** in every reject:

```
- **[P1]** — Location: `<spec>` R1.b "Deprecated-key denylist"; `<plan>` Task 2 Step 3 ...
  Issue: ...
  Suggestion: ...
  Evidence: Spec R1.b states ...
```

The harness ignores them. If we parse and track them, we can detect "same requirement rejected N times under different wording" — exactly the pattern hash/Jaccard misses.

### Design organising principle

Convert retry budget from **count-based per phase** to **count-based per requirement ID**, and let the planner see the trajectory. When a single requirement crosses the per-ID threshold, treat it as a **structural escalation** distinct from retry-limit / Jaccard-stagnation, and route to a deferred follow-up rather than another retry or a C/S/Q prompt.

## Goals

1. Detect "same requirement repeatedly rejected with non-identical wording" — a class the existing detectors do not catch.
2. Give the planner *trajectory context* on every reopen so it stops oscillating around the same spec area.
3. When a requirement is provably stuck (default ≥4 distinct rejects), **defer that requirement** to a follow-up artifact and let the rest of the retry loop continue. Other concerns are unaffected.
4. Survive `phase-harness resume` — detector state lives in `state.json`, not process memory.
5. In `--auto`, never prompt the user for stuck-requirement decisions. In manual mode, present a single-key D/R/Q prompt distinct from the existing C/S/Q escalation.
6. Preserve graceful degrade: if the parser finds no IDs (foreign reviewer style, malformed feedback), behaviour collapses to today's retry/stagnation path with no surface change.

## Non-goals

- No change to the existing **Jaccard adjacent-pair stagnation detector** (`src/phases/stagnation.ts`). It runs in parallel; the two detectors are OR-combined at the escalation site.
- No change to **reviewer prompt** beyond what is already there. Codex already emits requirement IDs in the standard format; we only parse them. (Hardening the prompt to *guarantee* IDs is a follow-up — see Out of scope.)
- No model swap (Sonnet → Opus, Codex effort bump) when stuck. That is a separate spec.
- No first-class CLI command `phase-harness gate-skip` for manual escape. Out of scope (separate PR).
- No fix for #110 resume crash. Out of scope (separate PR).
- No change to `verifyRetries` (Phase 6 verify) — only gate retries (phases 2/4/7).
- No support for non-`R<digit>(.<segment>)?` requirement ID conventions in v1. If the reviewer convention changes, parser returns empty ⇒ feature degrades silently.
- No automatic `gh issue create` by default. v1 emits a file-based stub; auto-issue is opt-in via `--auto-defer-issues`.

## Architecture overview

Three new units, one hook into existing path:

```
            handleGateReject (existing)
                    │
                    ▼
          ┌─── extractRequirementIds(comments)  [unit 2: parser]
          │
          ▼
   gateRejectHistory[phase].push({...ids})   [unit 1: state schema]
          │
          ▼
   findStubbornIds(history, threshold=4)      [unit 3: detector]
          │
          ├── empty → existing retry/Jaccard-stagnation/escalation path
          │            (assembler renders trajectory block via existing
          │             feedback_paths variable — unit 4: trajectory inject)
          │
          └── non-empty → handleStubbornEscalation(stubbornIds)
                          │
                          ├── autoMode: transform feedback (drop stuck IDs)
                          │             ├── all P1 stuck → forcePassGate + write deferred stub
                          │             └── partial    → reopen with filtered feedback + deferred stub
                          │
                          └── manual: prompt D/R/Q, route accordingly
```

## Data schema

### State additions (additive, no migration version bump)

```ts
// src/types.ts — HarnessState
gateRejectHistory?: Partial<Record<'2' | '4' | '7', GateRejectEntry[]>>;
deferredRequirements?: Partial<Record<'2' | '4' | '7', DeferredRequirement[]>>;

interface GateRejectEntry {
  cycle: number;        // gateEscalationCycles[phase] at time of reject
  retry: number;        // retryIndex (0-based, the just-failed attempt)
  feedbackPath: string; // .harness/<run>/gate-N-cycle-C-retry-R-feedback.md
  requirementIds: string[]; // dedup, ordered by first occurrence; [] if parser found none
  ts: number;           // epoch ms
}

interface DeferredRequirement {
  requirementId: string;     // e.g. "R1.b"
  phase: 2 | 4 | 7;
  rejectCount: number;       // count at time of defer
  feedbackPaths: string[];   // every prior reject mentioning this ID
  stubPath: string;          // .harness/<run>/deferred/phase-N-Rxxx.md
  deferredAt: number;        // epoch ms
  ghIssueUrl?: string;       // populated only if --auto-defer-issues succeeded
}
```

Both fields are `Partial<Record<...>>`-typed and read with `?? {}` everywhere. Existing runs (no field present) start with empty maps. No `migrationVersion` bump because no existing field is renamed, removed, or retyped.

### File-system additions

- `<runDir>/deferred/phase-{N}-{id}.md` — markdown stub per deferred requirement. Contains: requirement ID, phase, total reject count, every reject feedback file path with snippet, "Manual review needed before merge" footer.
- Added by both `--auto` and `D` (manual) deferral paths. Idempotent (re-deferral overwrites).

## Parser contract

```ts
// src/phases/gate/parseRejectFeedback.ts (new)
export function extractRequirementIds(feedback: string): string[];
```

Implementation:
- Regex `/\bR\d+(?:\.[A-Za-z0-9]+)?\b/g`
- Dedupe preserving first-occurrence order
- Never throws — wrap match in try/catch, return `[]` on any error (defensive; the regex itself cannot throw, but feedback can be arbitrarily large so we cap at first 64 KB scan to bound time)
- No dependency on Codex output structure beyond the ID token itself

Why this regex covers v1:
- Confirmed against `gate-4-cycle-{0,1,2}-retry-{0,1,2}-feedback.md` from run `2026-05-14-untitled-396c`: matches `R1.b`, `R1.d`, `R8`, `R9` — i.e. every requirement the reviewer cited.
- Other conventions (`REQ-1`, bare `1.b`) are intentionally ignored. Empty match ⇒ feature off ⇒ existing path runs.

## Detector

```ts
// src/phases/stubbornIds.ts (new)
export function findStubbornIds(
  history: GateRejectEntry[],
  threshold: number = 4,
): string[];
```

Algorithm:
- For each entry, take `new Set(entry.requirementIds)` (same ID twice in one feedback ≠ two strikes)
- Count distinct entries each ID appears in
- Return IDs whose count ≥ threshold (default 4), preserving first-occurrence order

Threshold rationale:
- Run `2026-05-14-untitled-396c` data: R1.b reached 4-distinct at cycle 2 retry 2 (the manual escape moment). Threshold 4 fires *exactly* at the human-recognised stuck point in this concrete trace.
- Threshold 3 would risk firing on planner-genuinely-progressing runs (a single ID may legitimately need 3 corrections). Threshold 5+ defers escalation past the user's tolerance window.
- Tunable via `HARNESS_STUBBORN_ID_THRESHOLD` (integer ≥ 2; invalid → default + single stderr warn, mirroring stagnation env-loader pattern). The pure `findStubbornIds(history, threshold)` clamps `threshold < 2` to `2` (no throw) so a future caller misuse cannot crash the runner.

### Hook position

`src/phases/runner.ts` `handleGateReject`, after `saveGateFeedback()` and *before* the existing retry/stagnation branching:

```ts
// (existing) save feedback path
const feedbackPath = saveGateFeedback(runDir, phase, comments, retryIndex, cycleIndex);

// NEW: parse and persist
const ids = extractRequirementIds(comments);
state.gateRejectHistory = state.gateRejectHistory ?? {};
const histKey = String(phase) as '2' | '4' | '7';
state.gateRejectHistory[histKey] = state.gateRejectHistory[histKey] ?? [];
state.gateRejectHistory[histKey]!.push({
  cycle: cycleIndex, retry: retryIndex, feedbackPath, requirementIds: ids, ts: Date.now(),
});

// NEW: stubborn-ID check fires BEFORE retry-limit / Jaccard checks
const stubborn = findStubbornIds(state.gateRejectHistory[histKey]!);
if (stubborn.length > 0) {
  await handleStubbornEscalation(phase, stubborn, comments, scope, retryIndex,
                                  state, harnessDir, runDir, cwd, inputManager, logger);
  return;  // skip existing retry/stagnation path
}

// (existing) gateRetries++; retry-limit branching; Jaccard stagnation; etc.
```

This ordering is deliberate: stubborn-ID detection fires the moment the threshold is hit, *not* after retry-limit. In #111's trace this means the loop breaks at cycle 2 retry 2 instead of cycle 2 retry 3 / 3 / 4 / 4 (twelve more retries before manual escape).

## Escalation policy

### Auto mode (`state.autoMode === true`)

Steps:

1. Emit `gate_stubborn_id` event:
   ```ts
   { event: 'gate_stubborn_id', phase, retryIndex, requirementIds: string[],
     threshold: number, action: 'defer-and-continue' | 'defer-and-force-pass' }
   ```

2. **Filter feedback**: split `comments` into reviewer items by the `- **[P0]** | **[P1]** | **[P2]** —` header pattern (Codex contract). For each item, extract IDs via the same regex. Drop items whose ID set is fully contained in `stubbornIds`. Re-join the survivors as `comments_filtered`.

3. **Branch on filter result**:
   - `comments_filtered.trim() === ''` (every P1 was stuck) → `forcePassGate(phase, ..., 'auto-stubborn')` + write deferred stub for every stuck ID. `gate_stubborn_id.action = 'defer-and-force-pass'`. The `force_pass.by` enum is extended from `'auto' | 'user'` to `'auto' | 'user' | 'auto-stubborn'` (additive enum widening; existing consumers must accept the new value).
   - non-empty → set `pendingAction.feedbackPaths` to a *new* feedback file (`gate-N-cycle-C-retry-R-filtered.md`) containing `comments_filtered`, write deferred stubs for stuck IDs, then take the existing reopen branch (`pendingAction.type = 'reopen_phase'`). `gate_stubborn_id.action = 'defer-and-continue'`. `gateRetries[phase]` is *not* incremented for the deferred portion (deferral is not a retry).

4. **Write deferred stub** for each stuck ID:
   - Path: `<runDir>/deferred/phase-{N}-{id}.md`
   - Body: ID, phase, total reject count, list every prior `feedbackPath` with the matching item snippet, "Auto-deferred after threshold N" footer
   - Idempotent: subsequent re-deferrals overwrite (single source of truth)

5. **Append to retrospective**: at session end, `retrospective.ts` adds a `## Deferred Stubborn Requirements` section listing every entry in `state.deferredRequirements`.

6. **Optional GH issue (opt-in)**: if `state.autoDeferIssues === true` (set by new `--auto-defer-issues` start flag), shell out to `gh issue create` with title `[stubborn-requirement] Phase {N} {id} did not converge in run {runId}`, body = stub contents, labels `harness/auto-deferred`, `phase-{N}`. On any failure (gh missing, network, auth, non-zero exit) emit one stderr warn line and proceed — file stub is always written first, so no data loss.

### Manual mode (`state.autoMode === false`)

Replace the C/S/Q prompt at the *stubborn-ID* fire site (existing C/S/Q remains for retry-limit and Jaccard-stagnation paths). New prompt:

```
Stubborn requirement(s) detected: R1.b, R8 — rejected ≥4 times each.
[D] Defer to follow-up issue and continue
[R] Retry once more (counter resets for these IDs)
[Q] Quit (pause for manual fix)
```

- `D` → identical to auto-mode steps 2–6 (transform feedback + deferral + reopen-or-force-pass)
- `R` → for each stuck ID, drop the **oldest** entry from `gateRejectHistory[phase]` so the count falls below threshold; resume normal retry path. One use only — re-fire on the next reject is immediate (i.e., R doesn't disarm the detector permanently).
- `Q` → existing pause flow (`pauseReason: 'gate-stubborn-id'`)

`escalation` event extended: `reason` enum gains `'gate-stubborn-id'`; `userChoice` enum gains `'D' | 'R'` (existing `'C' | 'S' | 'Q'` unchanged for legacy paths).

### Edge cases

- **Parser found no IDs in any reject** → `findStubbornIds` returns `[]` → existing path runs unchanged. Feature is invisible.
- **Single feedback contains both a stuck ID and a fresh ID** → filter keeps the fresh-only items, drops the stuck-only items, defers the stuck IDs. Mixed items (item that mentions both) stay in `comments_filtered` (planner sees the residual concerns about the deferred ID; that's acceptable noise — the deferral stub records the structural state). v1 does not attempt finer-grained item splitting.
- **Reviewer cites a previously-deferred ID again in a later reject** → that ID is already in `deferredRequirements`. Skip re-deferral; emit `gate_stubborn_id_repeat` (subtype of `gate_stubborn_id`, no separate event in v1 — same event with `action: 'already-deferred'`). Proceed with filter as usual.
- **Threshold lowered mid-run via env var** → next `findStubbornIds` call uses new threshold against existing history. May fire immediately on resume. Documented as expected.

## Trajectory inject (assembler)

Single-point change in `src/context/assembler.ts` `assembleInteractivePrompt`. Existing variable `feedback_paths` (rendered into `{{feedback_paths}}` placeholder in phase 1/3/5 templates) gets a richer body. **No new placeholder. No wrapper-skill change. No template change.**

```ts
// existing
const feedbackPathsList = feedbackPaths.map(p => `- 이전 피드백 (반드시 반영): ${p}`).join('\n');

// replaced with
const sourcePhase =
  state.pendingAction?.sourcePhase ?? state.phaseReopenSource[String(phase)] ?? null;
const history = sourcePhase != null
  ? (state.gateRejectHistory?.[String(sourcePhase) as '2'|'4'|'7'] ?? [])
  : [];
const feedbackPathsList = renderRejectTrajectory(feedbackPaths, history);
```

`renderRejectTrajectory(latestPaths, history)`:
- If `history.length === 0` → return existing simple list (backward compat, exact same string)
- Otherwise:
  ```
  이전 피드백 (반드시 반영):
  - 가장 최근 (this attempt's reject): <latestPaths[0]>
  ... additional latest paths if any ...

  이 phase 누적 reject 이력 (oldest → newest):
  1. cycle C retry R — IDs — <feedbackPath>
  2. ...

  요건별 reject 횟수:
  - R1.b: 4회 ← 4회 이상은 다음 cycle에서 자동 deferred 처리됨
  - R8: 3회

  ⚠ R1.b는 이미 4가지 다른 형태로 깨졌다. spec의 literal shape를 그대로 보존하라.
  ```
- Marker `⚠` lines only emitted for IDs at or above threshold. Total length capped at ~3 KB; if history is huge, oldest entries are dropped and a `(N earlier rejects truncated)` footer is added (avoids prompt bloat).

Why no separate placeholder: keeps the change surface small and avoids touching wrapper skills (`src/context/skills/harness-phase-{1,3,5}-*.md`) and thin templates (`src/context/prompts/phase-{1,3,5}.md`). The placeholder sits in a "이전 피드백을 반영하라" context already; richer body inherits the same instruction.

## Error handling and fail-open

Mirroring stagnation v1's defensive posture (single-warn, never harder than today):

| Failure | Behaviour |
|---|---|
| Parser regex match throws (impossible but defended) | catch → return `[]` → no detection this cycle |
| `extractRequirementIds` returns `[]` for every entry | `findStubbornIds` returns `[]` → no detection ever fires → existing path runs |
| `gateRejectHistory` schema missing on existing run | `?? {}` defaults; first reject populates it |
| Filter (item-split) fails to parse Codex format | skip transform → use original `comments` for reopen + write stubs anyway. Single stderr warn `[stubborn-id] feedback transform failed (<reason>); reopened with full feedback`. |
| `gh issue create` fails (auto-defer-issues opt-in only) | single stderr warn; file stub already written, run proceeds |
| `forcePassGate` throws in stubborn-force-pass branch | bubbles up (matches existing force-pass error handling — no special wrap) |
| `HARNESS_STUBBORN_ID_THRESHOLD` invalid | revert to default 4, single stderr warn, latch off-warn for process |

Resume safety:
- All persisted state lives in `state.json`. `phase-harness resume <runId>` rehydrates `gateRejectHistory` and `deferredRequirements` exactly. Detector is pure-function over history, no in-memory ring buffer. **A run that hit threshold 4, was paused, and resumed will fire detection on the very next reject** (intentional — picking up where we left off).

## Observability

### Events (`events.jsonl`)

New events (additive — no existing event field renamed/removed/retyped). Each stubborn-ID fire emits **exactly one** `gate_stubborn_id` (the auto-mode action) **or** **exactly one** `escalation` (the manual-mode user choice). They never coexist for the same fire — this preserves the "1 escalation event per escalation moment" invariant the analytics layer already assumes.

```ts
| (LogEventBase & {
    event: 'gate_stubborn_id';
    phase: number;
    retryIndex: number;
    requirementIds: string[];
    threshold: number;
    action: 'defer-and-continue' | 'defer-and-force-pass' | 'already-deferred';
  })
```

Existing `escalation` event extended (no new event class for manual D/R/Q):
- `escalation.reason` enum gains `'gate-stubborn-id'`
- `escalation.userChoice` enum gains `'D' | 'R'` (`'C' | 'S' | 'Q'` unchanged for legacy paths)
- New optional field `escalation.requirementIds?: string[]` — populated only when `reason === 'gate-stubborn-id'`

### Retrospective.md

`retrospective.ts` aggregator gains a new section emitted only when `state.deferredRequirements` is non-empty:

```
## Deferred Stubborn Requirements

- **R1.b** (Phase 4) — rejected 4 times across 3 cycles
  - Stub: .harness/<run>/deferred/phase-4-R1.b.md
  - Reject feedback files: gate-4-cycle-0-retry-0-feedback.md, gate-4-cycle-1-retry-0-feedback.md, ...
  - GH issue: https://github.com/.../issues/123  (only if --auto-defer-issues)
- **R8** (Phase 4) — rejected 4 times ...
```

Existing per-gate counter line (`Retries: N | REJECTs: M | Codex tokens: T`) gets a `| Deferred IDs: N` segment when applicable.

### UI

No new control-panel callsite. The Ink renderer reads `state.deferredRequirements` and surfaces a one-line banner (`✦ Deferred: R1.b, R8`) in the gate-status block when non-empty. Live during the run and on terminal completion.

## Configuration surface

Single new env var; single new CLI flag.

| Knob | Default | Effect |
|---|---|---|
| `HARNESS_STUBBORN_ID_THRESHOLD` | 4 | Detector trigger threshold (integer ≥ 2) |
| `--auto-defer-issues` (start flag) | off | Enable opt-in `gh issue create` after deferral. File stub is always written regardless. |

The flag is persisted on `HarnessState.autoDeferIssues: boolean` (additive field, default false). Honored by `phase-harness resume`.

## Testing strategy

Three test files, ≈ 25 cases total, all `vitest run`.

### `src/phases/gate/parseRejectFeedback.test.ts`
- Empty input → `[]`
- Real reject text from `2026-05-14-untitled-396c` cycle 0 retry 0 → exactly `['R1.b', 'R8', 'R9']` in order
- Multiple occurrences of `R1.b` → single entry (dedup)
- Foreign convention `REQ-1.2` → `[]` (intentional miss)
- 64 KB+ feedback → caps scan, returns IDs from first 64 KB only, no perf cliff (timing assertion)

### `src/phases/stubbornIds.test.ts`
- Empty history → `[]`
- 3-entry history, R1.b in all 3 → `[]` (below default threshold 4)
- 4-entry history, R1.b in all 4 → `['R1.b']`
- 4-entry history with R1.b + R8 each in 4 → `['R1.b', 'R8']` ordered
- 4-entry history, same retry duplicated R1.b → `[]` (one strike per entry)
- Custom threshold via 2nd arg → respects override
- Threshold 0/negative → throws (invariant; loader handles env validation upstream)

### `src/phases/runner.stubborn-escalation.test.ts` (integration via existing harness fixtures)
- Auto-mode, 3 distinct rejects of R1.b, then 4th → `gate_stubborn_id` event emitted, deferred stub written, no C/S/Q prompt
- Auto-mode, 4th reject contains only R1.b → `forcePassGate` called with reason `'auto-stubborn'`, `gate_stubborn_id.action = 'defer-and-force-pass'`
- Auto-mode, 4th reject contains R1.b + R-fresh → `comments_filtered` written, reopen taken, `gateRetries` not incremented
- Manual mode, threshold hit, user keys `D` → defer path runs; user keys `R` → oldest R1.b history entry dropped, retry continues; user keys `Q` → pause with `pauseReason: 'gate-stubborn-id'`
- Resume after threshold hit + pause → detector fires on next reject (no history loss)
- Parser returns `[]` for all rejects → existing C/S/Q + Jaccard path runs unchanged (regression guard)
- Filter parse fails → falls back to full feedback reopen + warn stderr (regression guard)

### Doc sync (per CLAUDE.md)

`README.md`, `README.ko.md`, `docs/HOW-IT-WORKS.md`, `docs/HOW-IT-WORKS.ko.md` updated with:
- Stubborn-ID detector description in the gate-retry section
- New env var `HARNESS_STUBBORN_ID_THRESHOLD` in env reference
- New `--auto-defer-issues` flag in start command help
- Deferred-requirements artifact path in the artifact map
- New events in events.jsonl schema reference

## Out of scope (separate PRs)

Each is a discrete deliverable. Some are referenced in #111's "Suggested fix directions"; we deliberately defer them to keep this spec's plan budget honest.

1. **#110 — `resume <runId>` silent crash on `pendingAction.type=show_escalation`**. Independent bug, separate PR.
2. **`phase-harness gate-skip --gate N --reason "..."` CLI command** — first-class manual escape hatch (#111 suggestion 5). Separate spec.
3. **Reviewer prompt hardening to *guarantee* requirement ID emission** — today Codex emits IDs reliably but isn't contractually required to. If a future reviewer change strips them, this feature degrades silently. A follow-up spec can add `<R-id>` field to the reviewer contract template.
4. **Cross-model planner switch on stubborn-ID fire** — e.g., escalate from Sonnet to Opus, or bump Codex effort. Larger design (preset registry, swap policy, cost ceiling). Separate spec.
5. **Deferred-section budget reviewer hardening** (#111 suggestion 3) — make the gate prompt count items in the plan's `Deferred` section against spec-required artifacts. Reviewer-prompt-level change, separate spec.
6. **Stubborn-ID-aware reopen prompt directive** — explicit "preserve literal spec shapes" instruction injected only when stuck IDs exist (#111 suggestion 4). Could be added in this spec but expands the assembler change surface; deferred for clean v1.

## Doc sync impact (per CLAUDE.md)

Behaviour changes that must be reflected in `README*` and `HOW-IT-WORKS*`:
- New gate retry behaviour (per-requirement-ID budget on top of count-based retry-limit)
- New escalation reason `gate-stubborn-id` and new manual prompt D/R/Q
- New env var, new CLI flag, new state fields, new events, new artifact directory
- New retrospective section

These are user-visible. Both English and Korean docs updated in the same PR.

## References

- Issue #111 — P3 plan-rewrite whack-a-mole loop (the empirical case driving this spec)
- Issue #110 — resume crash on gate-escalation (related, out of scope)
- `docs/specs/2026-05-06-phase-harness-gate-retry-8ea9-design.md` — stagnation v1 (Jaccard, in-memory). This spec OR-combines with that detector.
- `docs/HOW-IT-WORKS.md` — current gate retry/escalation flow
- Run `2026-05-14-untitled-396c` reject feedback files in `~/.grove/missions/9269e21a/.harness/2026-05-14-untitled-396c/` — empirical data behind threshold = 4 choice
