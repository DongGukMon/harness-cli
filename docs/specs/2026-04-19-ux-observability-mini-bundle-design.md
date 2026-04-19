# UX / Observability Mini-Bundle (Group E) — T8-a/b/c/d

**Status**: design + impl plan (combined, per compressed `/harness` flow)
**Date**: 2026-04-19
**Branch**: `feat/ux-observability`

## Cross-references

- `../gate-convergence/FOLLOWUPS.md` L106–109 — T8-a gate feedback archival origin
- `../gate-convergence/FOLLOWUPS.md` L112–117 — T8-b folder-trust watchdog origin
- `../gate-convergence/observations.md` L248–256 — T8-c preflight timeout origin
- `../gate-convergence/observations.md` L259–278 — T8-d eval-reset commit squash origin
- `src/phases/gate.ts` L27–29 `sidecarFeedback` — legacy feedback path
- `src/phases/runner.ts` L100–107 `saveGateFeedback` — feedback write site
- `src/phases/runner.ts` L592–672 `handleGateEscalation` — continue/skip/quit branches (cycle counter increment point)
- `src/phases/runner.ts` L798–810 — eval report commit site (live path)
- `src/resume.ts` L170–200 + L211–240 — eval report commit sites on resume recovery
- `src/artifact.ts` L61–130 `runPhase6Preconditions` — reset + clean check
- `src/artifact.ts` — `normalizeArtifactCommit` (add-always behavior) + new `commitEvalReport` helper
- `src/state.ts` / `src/types.ts` — new `gateEscalationCycles` field on `HarnessState`
- `src/preflight.ts` L135–175 `claudeAtFile` case — 5s timeout
- `src/commands/inner.ts` — control-pane entry (watchdog host)

## 1. Background

Dogfooding of the `gate-convergence` worktree surfaced four small UX / observability rough edges. Each is independent, trivially scoped, and benefits from being grouped into a single PR (`feat(ux-obs)`). No ADR affects another; order of implementation is by risk (ascending: T8-c → T8-a → T8-d → T8-b).

Summary:

| T | Slice | P | What the user sees today | What they should see |
|---|---|---|---|---|
| a | Gate feedback archival | P2 | After Gate N APPROVE, `gate-N-feedback.md` still contains the last REJECT comments — misleading post-hoc. | Per-retry archives preserved (`gate-N-cycle-C-retry-K-feedback.md`); approve metadata saved to `gate-N-cycle-C-verdict.json`. |
| b | Folder-trust watchdog | P2 | On first run, Claude blocks on folder-trust dialog; control pane stays silent at "Phase 1 ▶". | After 30s of silence post phase-start, control pane prints a one-shot hint. |
| c | Preflight `@file` timeout | P3 | `⚠️ preflight: claude @file check timed out (5s); skipping …` prints on every happy-path run. | 10s timeout + softer "delayed" wording. |
| d | Phase 6 double-commit | P3 | Each verify retry produces two commits (`reset eval report` + `eval report`). N verify rounds → 2·N−1 phase-6 commits (first round 1 commit, each subsequent retry +2). | One commit per verify round (`rev K eval report`), total = `verifyRetries + 1`. |

## 2. Goals / Non-goals

**Goals**:
- Preserve per-retry gate feedback history without silently overwriting on retry.
- Provide an early UX signal when Claude is blocked on a startup dialog.
- Reduce preflight warning noise on happy paths.
- Halve the commit count Phase 6 generates during retries, without breaking resume safety.

**Non-goals**:
- Events.jsonl schema changes (pure filesystem additions for archival).
- Touching Group A (validator / dirty-tree), Group B/C (wrapper skills), Group D (footer), Group F (retry ceilings).
- Smarter preflight skip logic (observe prior success, etc.) — 10s bump is sufficient.
- Making the reset process fully commit-free in the terminal case (force-pass still writes its own commit — unchanged).

## 3. ADRs

### ADR-1 — Gate feedback archival (T8-a)

**Decision**: On every `saveGateFeedback` call, write TWO files:
1. `gate-N-feedback.md` (existing path, overwrite — **mandatory**; callers `stat` this file, see Persistence semantics).
2. `gate-N-cycle-C-retry-K-feedback.md` (new archive — best-effort; cycle-indexed, see Naming scheme below).

Additionally on APPROVE verdict, write `gate-N-cycle-C-verdict.json` (best-effort) with `{ verdict, retryIndex, cycleIndex, codexSessionId?, tokensTotal?, durationMs?, timestamp }`. Cycle-indexed filename prevents overwrites across Continue-escalation cycles — matches the feedback archive contract.

**Naming scheme**: `gate-N-cycle-C-retry-K-feedback.md` where N = phase (2/4/7), **C = escalation cycle index** (0-based, increments on each user-chosen "Continue" after a gate retry-limit escalation), K = `retryIndex` at the moment of the write. Both `C` and `K` are threaded explicitly through every call site — `saveGateFeedback` gains `retryIndex: number` (4th param) AND `cycleIndex: number` (5th param). `handleGateEscalation` also gains `retryIndex: number` (propagated from `handleGateReject`, which captures the pre-mutation index at the retry-loop entry — currently runner.ts L467). The existing `gate_retry` event already carries the same `retryIndex`, so archive filenames align with the telemetry contract; `cycleIndex` is a new discriminator carried by this spec only.

**Cycle counter semantics**: `state.gateEscalationCycles[phase]` (new optional field on `HarnessState`, keys `'2'|'4'|'7'`, absent = 0) tracks the number of completed "Continue" escalations for that phase in the current run. The counter is **read** at every `saveGateFeedback` call site, and **mutated only inside the `handleGateEscalation` continue branch (runner.ts L621)**, AFTER the final-REJECT feedback has been archived for the ending cycle — this guarantees:

1. During an active retry cycle (including the final REJECT that triggers escalation): archives are keyed under the current `C`.
2. After user chooses Continue + state is reset (`gateRetries[phase] = 0`, `verifyRetries = 0` for phase 7): `state.gateEscalationCycles[phase] += 1`, so the next retry cycle's archives start under `cycle-{C+1}-retry-0`.
3. Quit / Skip branches do not mutate the counter (session terminates or force-passes; no further retries).

With C + K both in the filename, re-escalation cycles never overwrite prior archives within the same run. The counter persists across crash + `harness resume` because it lives in `state.json`. Migration: absent → treated as 0 by all readers (`state.gateEscalationCycles?.[phase] ?? 0`); no active migration write needed on load.

**Escalation K semantics**: at escalation entry (`retryCount >= GATE_RETRY_LIMIT`) the captured `retryIndex` equals `GATE_RETRY_LIMIT - 1` (the index of the attempt whose REJECT triggered the limit). `handleGateEscalation` continue/quit branches use that same `retryIndex` when calling `saveGateFeedback`. `cycleIndex` for that save is the pre-increment value read from `state.gateEscalationCycles[phase] ?? 0`.

**Scope**: feedback archival covers `handleGateReject` (runner.ts L531), `handleGateEscalation` continue branch (runner.ts L627), and `handleGateEscalation` quit branch (runner.ts L660). The continue branch additionally increments `state.gateEscalationCycles[phase]` AFTER the save + before `writeState`. Verdict JSON covers APPROVE only — not force-pass (force-pass already emits a dedicated `force_pass` event and has no codex session/tokens to record).

**Why not rename / abolish `gate-N-feedback.md`**: retained as the "last reject pointer" for codex resume Variant A (`gate.ts` L237 reads this exact path when `lastOutcome=reject`). Archival is purely additive.

**Persistence semantics**: the legacy `gate-N-feedback.md` write is **mandatory** — failure throws (current behavior; callers immediately `fs.statSync(feedbackPath).size` the result, so a silent failure would break telemetry and `pendingAction.feedbackPaths` resume). The archive file `gate-N-cycle-C-retry-K-feedback.md` and the `gate-N-cycle-C-verdict.json` APPROVE metadata are **best-effort** — wrapped in try/catch with a single `printWarning(…)` line per failure. Helper signature unchanged (`: string`); archive failures never alter the returned path.

### ADR-2 — Folder-trust watchdog (T8-b)

**Decision**: When an interactive phase (1/3/5) starts with a Claude runner, arm a 30s one-shot timer. If the phase completes/errors/advances before the timer fires → cancel. If the timer fires first → print a single hint line to the control pane and mark "hint emitted" to prevent duplicates.

**Trigger condition**: `preset.runner === 'claude'` AND phase ∈ {1, 3, 5}. Codex interactive phases are not affected (no folder-trust analog).

**Timer placement**: in `handleInteractivePhase` (runner.ts), armed after the `logEvent phase_start` call, cleared in (a) completed branch, (b) normal failed branch, (c) catch block, (d) redirect branch. Using `setTimeout` + `ref/unref`: kept referenced so the Node process doesn't exit before it fires during a stuck phase. Cleared on all exits.

**TODO (round-2 P2 follow-up)**: the timer callback should additionally re-check `state.currentPhase === phase` and `state.phaseAttemptId[phase] === attemptId` before printing the hint, to cover the SIGUSR1-driven mid-phase skip/jump race (state can mutate while `runInteractivePhase` is still in flight). This guard is a minor addition — not tracked as a P1 for this bundle but will be folded into implementation of ADR-2 if cheaply doable; otherwise captured in `docs/gate-convergence/FOLLOWUPS.md` after the bundle lands.

**Hint text** (Korean, matching existing `printWarning` style):
```
⚠️  30s 동안 출력 없음 — Claude 창(C-b 1)에서 folder-trust 다이얼로그 대기 중일 수 있음.
```

**Why 30s**: dogfood observation shows Claude prompt typically begins output within 3–10s on a trusted folder. 30s is a comfortable upper bound that avoids false positives while still giving useful early feedback before the user gives up. Not a runtime knob; `WATCHDOG_DELAY_MS = 30_000` is a module-level constant in runner.ts.

**Test strategy (ESM-safe)**: imported `const` bindings are read-only under `"type": "module"` (package.json). Tests therefore use `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(30_000)` and assert the hint-emission side effect. No mutation of `WATCHDOG_DELAY_MS` is required. If a test needs a shorter delay for a non-fake-timer scenario, the module exports `__setWatchdogDelayMsForTesting(ms: number): void` (wraps a private `let _delayMs`) — but the default path uses fake timers and does **not** call this setter.

**Only fires once per phase**: re-entering the same phase (retry, reopen) arms a new timer with a fresh `attemptId`. No cross-phase suppression — each phase entry independently arms one.

**Non-dependency on events.jsonl**: The watchdog is a pure in-process timer in the phase runner. `--enable-logging` state is irrelevant. Confirms prompt requirement: "`--enable-logging` off인 경우에도 동작하게".

### ADR-3 — Preflight timeout bump (T8-c)

**Decision**: Bump `claudeAtFile` preflight `timeout: 5000 → 10000`. Reword stderr message to reduce alarm:

Before: `⚠️  preflight: claude @file check timed out (5s); skipping — runtime failure will be surfaced at phase level if @file is unsupported.`

After: `⚠️  preflight: claude @file check delayed (>10s); continuing — runtime failure will be surfaced at phase level if @file is unsupported.`

**Why not conditional skip** (observe prior success): over-engineered for the marginal gain. The preflight runs once per `harness start`; an extra 5s margin on a happy path is imperceptible (claude CLI typically returns in ~1–3s).

### ADR-4 — Phase 6 eval-report commit squash (T8-d)

**Decision**: Replace the dedicated "reset eval report for re-verification" commit with a **staged deletion that is squashed into the subsequent eval report commit**. All Phase 6 eval-report commits (live path AND resume recovery paths) are routed through a single shared helper `commitEvalReport(state, cwd)` that computes the `rev K` title from `state.verifyRetries` at commit time.

**Flow (retry case, eval report was previously committed)**:
1. `runPhase6Preconditions` detects tracked eval report → runs `git rm -f <evalReportPath>` (stages deletion, removes working tree copy). **No commit.**
2. Final clean check relaxed: porcelain may contain staged/unstaged entries IF they are the eval report path. Other paths still fail.
3. `runVerifyPhase` writes new eval report to working tree.
4. `commitEvalReport(state, cwd)` runs `normalizeArtifactCommit(path, "harness[<runId>]: Phase 6 — rev K eval report", cwd)` with `K = state.verifyRetries + 1` AT COMMIT TIME — see §Resume safety). `normalizeArtifactCommit` internally `git add`s the path (always), then commits.

**Result**: ONE commit per retry instead of two. Commit title encodes revision: `rev 1 eval report`, `rev 2 eval report`, …

**Shared helper scope**: `src/resume.ts` L173 (error-path retry) and L218 (applyStoredVerifyResult PASS path) are both in scope — both currently use the legacy message `Phase 6 — eval report`. The round-3 spec adds them to the modification list and routes them through `commitEvalReport(state, cwd)` so all three sites share one title-computation source. Rationale: without this, resume-after-crash commits would keep the old title and the checklist claim "all message titles contain `rev K eval report`" would be false.

**Revision index semantics**: `K = state.verifyRetries + 1` **within a verify cycle**. `rev 1` is the first report committed in the current verify cycle — which is the first report of the run OR the first report after a Gate-7 reject/Continue-escalation that reset `state.verifyRetries` to 0 (runner.ts L509, L624). `rev K` values can therefore repeat across different verify cycles within the same run (e.g. `rev 1` commits before Gate 7 escalation AND `rev 1` commits after user chose Continue). This matches the existing `verifyRetries` reset semantics; adding a run-monotonic `evalReportRevisionCounter` would require additional state + migration and is **out of scope** for this bundle — captured as P2 follow-up in `docs/gate-convergence/FOLLOWUPS.md` after merge.

**Resume safety — crash in the gap**: crash after `git rm -f` but before the new eval report commits results in:
- Working tree: eval report path absent.
- Index: eval report path staged for deletion.
- `git status --porcelain`: `D  <evalReportPath>`.

Recovery on resume: re-entering Phase 6 calls `runPhase6Preconditions` again. The idempotency branch must accept "staged deletion, no worktree entry" as "already reset — no-op".

**Porcelain parsing detail** (addresses P2-1): `getFileStatus()` in `src/git.ts` currently returns `git status --porcelain <path>`.trim() — trimming loses the leading XY column distinction (leading `' '` in unstaged vs `'D'` in staged). To reliably detect "staged for deletion", the resume branch uses a dedicated helper that preserves the **raw XY** via `git status --porcelain -z` parsing, or a direct `git diff --cached --name-status <path>` check returning `D\t<path>`. Concretely, introduce `isStagedDeletion(filePath, cwd): boolean` in `src/git.ts` that runs `git diff --cached --name-status -- <path>` and returns true iff output starts with `D\t`. `runPhase6Preconditions` calls this before the tracked-file branch:
```ts
if (isStagedDeletion(evalReportPath, cwd)) {
  // already reset — no-op
} else if (isTracked(evalReportPath, cwd) && fileExists(evalReportPath)) {
  execSync(`git rm -f "${evalReportPath}"`, { cwd });
}
```
This keeps resume safe even if the crash occurred between rm and the new write, without relying on trimmed porcelain strings.

**Force-pass path unchanged**: `forcePassVerify` still writes + commits a synthetic report via `normalizeArtifactCommit`. No retry loop inside force-pass, so no double-commit concern.

**normalizeArtifactCommit contract change**: currently, if only the target file is staged, the function commits without re-adding. That must change: after a reset, the target is staged *as a deletion* while the working tree has the new file (untracked). To capture the new content, the function must always run `git add <filePath>` before commit. New behavior: `git add` is **idempotent** — always stages the current working-tree state of `filePath`.

This subtly changes existing Phase 1/3 artifact commit behavior: when the artifact was previously staged and the user added unstaged changes to the same file between stage and commit, the new code will include those unstaged changes. This is correct behavior ("commit the current state"), matches user intent, and is exercised by zero existing tests negatively.

**Non-tracked path (fresh run, no prior commit)**: unchanged. `runPhase6Preconditions` hits the "file doesn't exist" branch (no-op), verify writes the report, `normalizeArtifactCommit` adds + commits as today.

## 4. Interfaces

### 4.1 `saveGateFeedback` (runner.ts) + escalation propagation + cycle counter

```ts
// BEFORE
function saveGateFeedback(runDir: string, phase: number, comments: string): string

// AFTER — accepts retryIndex AND cycleIndex to generate archive path
function saveGateFeedback(
  runDir: string,
  phase: number,
  comments: string,
  retryIndex: number,
  cycleIndex: number,
): string  // returns legacy feedback path (unchanged return contract).
          // Legacy write throws on failure. Archive write + verdict JSON are best-effort (try/catch + printWarning).
          // Archive filename: `gate-${phase}-cycle-${cycleIndex}-retry-${retryIndex}-feedback.md`.
```

Sibling helper (best-effort, no throw on failure):
```ts
function saveGateApproveVerdict(
  runDir: string,
  phase: number,
  retryIndex: number,
  cycleIndex: number,
  metadata: { codexSessionId?: string; tokensTotal?: number; durationMs?: number },
): void  // writes `gate-${phase}-cycle-${cycleIndex}-verdict.json`.
```

**Call site for `saveGateApproveVerdict`**: invoked from the APPROVE branch of the gate phase handler (currently `handleGatePhase` / `handleGateApprove` in `src/phases/runner.ts`), immediately after verdict parsing and **before** state mutation (so captured `retryIndex` reflects pre-mutation state). Arguments: `retryIndex` from the same pre-mutation capture used by `saveGateFeedback`; `cycleIndex = state.gateEscalationCycles?.[String(phase)] ?? 0`; `metadata` extracted from the Codex runner result (`codexSessionId`, `tokensTotal`, `durationMs`). Failure is warning-only — does not block APPROVE advancement, matching the best-effort contract.

Call-site propagation:
```ts
// BEFORE
export async function handleGateEscalation(
  phase, comments, state, runDir, cwd, inputManager, logger,
): Promise<void>

// AFTER — accepts retryIndex (propagated from handleGateReject pre-mutation capture).
// cycleIndex is derived inside this function from state.gateEscalationCycles[phase] ?? 0.
export async function handleGateEscalation(
  phase, comments, retryIndex, state, runDir, cwd, inputManager, logger,
): Promise<void>
```

`handleGateReject` passes its captured `retryIndex` (runner.ts L467, pre-mutation) into the escalation branch (runner.ts L588). All three `saveGateFeedback` call sites (runner.ts L531 / L627 / L660) receive both a concrete `retryIndex` AND a concrete `cycleIndex` (latter read from `state.gateEscalationCycles[phase] ?? 0` at the call site).

**Resume path (`show_escalation` replay, `src/resume.ts:753`)**: when `handleResume` replays a paused `show_escalation` pendingAction, the caller no longer has a pre-mutation capture for `retryIndex`. The spec requires resume.ts to **derive** it from persisted state before invoking `handleGateEscalation`:

```ts
// In the `show_escalation` case of handleResume (replacing current resume.ts L753)
const retryIndex = Math.max(0, (state.gateRetries[String(gatePhase)] ?? GATE_RETRY_LIMIT) - 1);
await handleGateEscalation(gatePhase, comments, retryIndex, state, runDir, cwd, createNoOpInputManager(), new NoopLogger());
```

Rationale: the quit branch of `handleGateEscalation` (runner.ts L657-671) does **not** reset `gateRetries`, so at resume time `state.gateRetries[phase]` still equals `GATE_RETRY_LIMIT` (the value reached that triggered escalation); `GATE_RETRY_LIMIT - 1` equals the pre-mutation `retryIndex` that would have been captured live. `Math.max(0, ...)` guards a defensive floor in the unlikely case a future code path resets the counter before pausing. `cycleIndex` does not need resume-time derivation because it is read from `state.gateEscalationCycles` inside `handleGateEscalation` itself.

**TODO (round-4 P2 follow-ups, tracked in `docs/gate-convergence/FOLLOWUPS.md` after merge)**:
- **FUP-3 (resume replay test coverage)**: add a `tests/phases/gate-resume-escalation.test.ts` case that exercises `handleResume` → `show_escalation` → derived `retryIndex` → `handleGateEscalation` and asserts the resumed archive path matches `gate-N-cycle-C-retry-${GATE_RETRY_LIMIT - 1}-feedback.md`. Not currently in §5/§8 because the replay path is also tested indirectly via existing `gate-resume.test.ts`, but an explicit archive-name assertion would close the verification gap.
- **FUP-4 (raw comments preservation on resume)**: today `src/resume.ts` `show_escalation` replay loads `comments = readFileSync(action.feedbackPaths[0], 'utf-8')` — which is the *formatted* `gate-N-feedback.md` (headers + "## Reviewer Comments" block). Passing that back through `saveGateFeedback` would nest the markdown. Mitigation options:  (a) resume parses the `## Reviewer Comments` body before the call, or (b) persist raw `comments` in `pendingAction.rawComments` at pause time. Option (b) is preferred long-term (no parse fragility), but is a schema change; for this bundle, **option (a) is the minimum bar** and must be included in the resume-path fix during implementation. If deferred, the archive written on resume will diverge from the live-path archive and violate the "same content" archive invariant.

State type addition (`src/types.ts`):
```ts
export interface HarnessState {
  // ...existing fields...
  gateEscalationCycles?: Partial<Record<'2' | '4' | '7', number>>;
  // Optional for backward compat with existing state.json files; readers use `?? 0`.
  // Inner Partial<> lets callers materialize the record with `{}` (type-safe partial init).
}
```

Increment site: inside `handleGateEscalation` continue branch (runner.ts L621), AFTER `saveGateFeedback` returns and BEFORE `writeState`:
```ts
state.gateEscalationCycles = state.gateEscalationCycles ?? {};
const key = String(phase) as '2' | '4' | '7';
state.gateEscalationCycles[key] =
  (state.gateEscalationCycles[key] ?? 0) + 1;
```

### 4.2 `WATCHDOG_DELAY_MS` (runner.ts)

```ts
export const WATCHDOG_DELAY_MS = 30_000;  // module constant; tests drive via fake timers.
```

### 4.3 `runPhase6Preconditions` (artifact.ts) + `isStagedDeletion` (git.ts)

Signatures unchanged for existing callers. Internal behavior:
- Already staged for deletion (detected via new `isStagedDeletion()` helper on `git diff --cached --name-status -- <path>`) → no-op.
- Tracked/clean eval report → `git rm -f <path>` only (no commit).
- Final clean check scoped: allow staged-deleted eval report path; reject any other dirty path.

New helper in `src/git.ts`:
```ts
// Returns true iff <filePath> appears in the index as a staged deletion.
export function isStagedDeletion(filePath: string, cwd?: string): boolean;
```

### 4.4 `normalizeArtifactCommit` (artifact.ts)

Signature unchanged. Internal behavior: always run `git add "<filePath>"` before commit, eliminating the "only target staged → skip add" branch. Non-target staged files still throw.

### 4.5 `commitEvalReport` (artifact.ts) — shared helper for all Phase 6 eval-report commits

New helper that centralizes the `rev K` title computation so normal-path (runner.ts L801) and resume recovery paths (resume.ts L173, L218) produce identical commit messages for the same `(runId, verifyRetries)` pair:

```ts
// src/artifact.ts
export function commitEvalReport(state: HarnessState, cwd: string): void {
  const filePath = state.artifacts.evalReport;
  const k = state.verifyRetries + 1;
  const message = `harness[${state.runId}]: Phase 6 — rev ${k} eval report`;
  normalizeArtifactCommit(filePath, message, cwd);
}
```

Call-site migration:
- `src/phases/runner.ts` L800–805 — replace inline `normalizeArtifactCommit(...)` call with `commitEvalReport(state, cwd)`.
- `src/resume.ts` L173 — same replacement (inside `handleResume` phase-6 error retry branch).
- `src/resume.ts` L218 — same replacement (inside `applyStoredVerifyResult` PASS branch).

Throw semantics preserved — `normalizeArtifactCommit` still throws on git failure; callers retain their existing try/catch boundaries. The force-pass synthetic-report path remains on direct `normalizeArtifactCommit` with its own message (`Phase 6 — eval report (force-pass)`) since it does not participate in the retry-rev scheme.

## 5. Testing

One vitest file per slice, colocated with existing tests:

| Slice | Test file | Key assertions |
|---|---|---|
| T8-a | `tests/phases/gate-feedback-archival.test.ts` | Retry creates `gate-N-cycle-0-retry-K-feedback.md` (K=0..2). After a Continue escalation + next retry REJECT, archive lives at `gate-N-cycle-1-retry-0-feedback.md` (distinct from cycle-0 archive; no overwrite). APPROVE creates `gate-N-cycle-C-verdict.json` with `verdict:"APPROVE"`. Legacy `gate-N-feedback.md` still written + returned. |
| T8-b | `tests/phases/interactive-watchdog.test.ts` | Under `vi.useFakeTimers()`: timer arms on claude preset, fires exactly once after `vi.advanceTimersByTimeAsync(WATCHDOG_DELAY_MS)`, is cleared (no late fire) on completed/failed/throw/redirect. Not armed for codex preset. |
| T8-c | `tests/preflight-claude-at-file.test.ts` | Timeout constant = 10000. Message text contains "delayed" (not "timed out") and "continuing". Exit status ≠ 0 still warns and returns. |
| T8-d | `tests/phases/eval-report-commit-squash.test.ts` | Retry cycle: commit-count delta per round = 1 (measure via `git rev-list` before/after). Messages contain `rev 1 eval report`, `rev 2 eval report`. `commitEvalReport(state, cwd)` used for all three sites (live runner path + resume.ts L173 + L218) — assert via message title check after simulating each path (live retry; phase-6 error → `handleResume` retry; `applyStoredVerifyResult` PASS). Resume after simulated crash (staged-D only, no worktree entry) resumes cleanly without throw and produces exactly one new `rev K eval report` commit. Force-pass path still writes one synthetic commit with the legacy force-pass message (unchanged). |

Test strategy:
- **T8-b timer tests**: use `vi.useFakeTimers()` + run `vi.advanceTimersByTimeAsync(WATCHDOG_DELAY_MS)`. Mock `runInteractivePhase` to return a controlled Promise so we can time the timer fire against the phase resolution.
- **T8-d git scenarios**: real temp git repos (matching `tests/artifact.test.ts` pattern — see that file for the established fixture). Execute `git log --oneline | wc -l` before/after; assert count deltas.

## 6. Risks

| Risk | Mitigation |
|---|---|
| T8-b timer leaks if phase never completes (e.g., user kills process) | Node holds timer in its event loop; process exit frees it. Keep timer unref'd? No — `setTimeout` is unref-optional; we leave it referenced (default) so short-lived test processes correctly observe it, and we always clear in handlers. |
| T8-d staged-deletion resume path silently recreates old content if `git add` runs on a missing file | `git add` on a missing file is a no-op (it doesn't touch the index when the working tree entry is gone). Resume path guarantees file exists (Phase 6 rewrites it) before commit — so `git add` sees the new content. |
| T8-d force-pass path touches `normalizeArtifactCommit` post-change | Existing force-pass test (`runner.test.ts` or equivalent) still passes: idempotent `git add` on an untracked new file behaves identically to current code. |
| T8-a extra file writes add ~0.1ms per gate retry | Negligible; archive files are sub-KB markdown. |
| T8-c bump masks a genuine preflight failure | Preflight failure is already surfaced at phase level (runtime error visibility unchanged); 10s is still a hard ceiling. |

## 7. Out of scope

- Group A (validator / dirty-tree): `src/preflight.ts` dirty-tree enforcement, validator — separate PR.
- Group B/C: wrapper skills (`src/context/skills/*`), `advisor()` reminder removal — separate PRs.
- Group D: control-pane footer elapsed/token counter — separate PR.
- Group F: gate retry ceiling increases — separate PR.
- Events.jsonl schema for archival / watchdog telemetry — pure filesystem signal for now; can be added later without schema break.

## 8. Eval checklist (consumed by plan)

Verification is deterministic; the plan includes `.harness-eval.json` with:

1. **typecheck** — `pnpm tsc --noEmit` → exit 0.
2. **tests** — `pnpm vitest run` → exit 0, 617 → 621+ passed, 1 skipped.
3. **build** — `pnpm build` → exit 0, `dist/src/phases/runner.js` + `dist/src/preflight.js` + `dist/src/artifact.js` exist.
4. **T8-a signatures + archive path** — `src/phases/runner.ts` `saveGateFeedback` takes 5 params (`retryIndex: number, cycleIndex: number`). `handleGateEscalation` takes `retryIndex` param. `grep -q "cycle-.*-retry-.*-feedback.md" src/phases/runner.ts`. `src/types.ts` exports `gateEscalationCycles?: Partial<Record<'2' | '4' | '7', number>>` on `HarnessState` (inner `Partial<>` supports type-safe `{}` initialization at the increment site). `src/resume.ts` `show_escalation` replay derives `retryIndex` from `state.gateRetries` before calling `handleGateEscalation` (grep: `grep -q "handleGateEscalation(.*retryIndex" src/resume.ts`).
5. **T8-b constant** — `grep -q "WATCHDOG_DELAY_MS" src/phases/runner.ts`.
6. **T8-c string** — `grep -q "timeout: 10_\\?000" src/preflight.ts`.
7. **T8-d commit-count + shared helper** — dedicated test verifies for N verify rounds within a verify cycle (1 initial + `verifyRetries`), Phase 6 commit count == `verifyRetries + 1` (one per round), all message titles contain `rev K eval report` for K ∈ {1..verifyRetries+1}. Resume-from-staged-D scenario commits exactly one additional `rev K eval report`. `src/artifact.ts` exports `commitEvalReport(state, cwd)`; `grep -q "commitEvalReport" src/phases/runner.ts` AND `grep -q "commitEvalReport" src/resume.ts` (both live path and both resume recovery sites route through the shared helper).

Each checklist item maps to an automated command in `.harness-eval.json`.

### 8.1 Deferred to follow-up (acknowledged P2 from round-2 gate review)

These are captured here as documentation so they survive into `docs/gate-convergence/FOLLOWUPS.md` when the bundle lands; they are **not** blockers for this PR:

- **FUP-1 (watchdog attempt-id guard)**: re-check `state.currentPhase === phase` + `phaseAttemptId[phase] === attemptId` inside the timer callback before printing, to cover the SIGUSR1 mid-phase skip/jump race. Add if implementation proves cheap; otherwise file as its own issue post-merge.
- **FUP-2 (rev K run-monotonic counter)**: the current spec narrows "first report committed for the run" → "first report committed in the current verify cycle" because `verifyRetries` resets on Gate-7 reject/escalation-Continue. A run-monotonic `evalReportRevisionCounter` on `HarnessState` would close this, but adds a state migration + ordering guarantees outside the scope of this UX/observability bundle.
