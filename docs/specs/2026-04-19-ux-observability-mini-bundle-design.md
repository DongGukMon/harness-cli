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
- `src/phases/runner.ts` L798–810 — eval report commit site
- `src/artifact.ts` L61–130 `runPhase6Preconditions` — reset + clean check
- `src/preflight.ts` L135–175 `claudeAtFile` case — 5s timeout
- `src/commands/inner.ts` — control-pane entry (watchdog host)

## 1. Background

Dogfooding of the `gate-convergence` worktree surfaced four small UX / observability rough edges. Each is independent, trivially scoped, and benefits from being grouped into a single PR (`feat(ux-obs)`). No ADR affects another; order of implementation is by risk (ascending: T8-c → T8-a → T8-d → T8-b).

Summary:

| T | Slice | P | What the user sees today | What they should see |
|---|---|---|---|---|
| a | Gate feedback archival | P2 | After Gate N APPROVE, `gate-N-feedback.md` still contains the last REJECT comments — misleading post-hoc. | Per-retry archives preserved; approve metadata saved to `gate-N-verdict.json`. |
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
2. `gate-N-retry-K-feedback.md` (new archive — best-effort).

Additionally on APPROVE verdict, write `gate-N-verdict.json` (best-effort) with `{ verdict, retryIndex, codexSessionId?, tokensTotal?, durationMs?, timestamp }`.

**Naming scheme**: `gate-N-retry-K-feedback.md` where N = phase (2/4/7), K = retryIndex at the moment of the write. `K` is sourced by **threading the pre-mutation `retryIndex` through every call site** — `saveGateFeedback` gains a fourth `retryIndex: number` parameter, and `handleGateEscalation` gains a new `retryIndex: number` parameter (propagated from `handleGateReject`, which already captures it at gate.ts L385–386). Rationale: the existing `gate_retry` event carries the same `retryIndex`, so archive filenames align with the telemetry contract.

**Escalation K semantics**: at escalation entry (`retryCount >= GATE_RETRY_LIMIT`) the captured `retryIndex` equals `GATE_RETRY_LIMIT - 1` (the index of the attempt whose REJECT triggered the limit). `handleGateEscalation` continue/quit branches use that same `retryIndex` when calling `saveGateFeedback`. Continue-then-retry starts from `retryIndex = 0` again on the next reject, so no collision with the stored archive of the prior escalation round.

**Scope**: feedback archival covers `handleGateReject` (gate.ts L531), `handleGateEscalation` continue branch (L627), and `handleGateEscalation` quit branch (L660). Verdict JSON covers APPROVE only — not force-pass (force-pass already emits a dedicated `force_pass` event and has no codex session/tokens to record).

**Why not rename / abolish `gate-N-feedback.md`**: retained as the "last reject pointer" for codex resume Variant A (`gate.ts` L237 reads this exact path when `lastOutcome=reject`). Archival is purely additive.

**Persistence semantics**: the legacy `gate-N-feedback.md` write is **mandatory** — failure throws (current behavior; callers immediately `fs.statSync(feedbackPath).size` the result, so a silent failure would break telemetry and `pendingAction.feedbackPaths` resume). The archive file `gate-N-retry-K-feedback.md` and the `gate-N-verdict.json` APPROVE metadata are **best-effort** — wrapped in try/catch with a single `printWarning(…)` line per failure. Helper signature unchanged (`: string`); archive failures never alter the returned path.

### ADR-2 — Folder-trust watchdog (T8-b)

**Decision**: When an interactive phase (1/3/5) starts with a Claude runner, arm a 30s one-shot timer. If the phase completes/errors/advances before the timer fires → cancel. If the timer fires first → print a single hint line to the control pane and mark "hint emitted" to prevent duplicates.

**Trigger condition**: `preset.runner === 'claude'` AND phase ∈ {1, 3, 5}. Codex interactive phases are not affected (no folder-trust analog).

**Timer placement**: in `handleInteractivePhase` (runner.ts), armed after the `logEvent phase_start` call, cleared in (a) completed branch, (b) normal failed branch, (c) catch block, (d) redirect branch. Using `setTimeout` + `ref/unref`: kept referenced so the Node process doesn't exit before it fires during a stuck phase. Cleared on all exits.

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

**Decision**: Replace the dedicated "reset eval report for re-verification" commit with a **staged deletion that is squashed into the subsequent eval report commit**.

**Flow (retry case, eval report was previously committed)**:
1. `runPhase6Preconditions` detects tracked eval report → runs `git rm -f <evalReportPath>` (stages deletion, removes working tree copy). **No commit.**
2. Final clean check relaxed: porcelain may contain staged/unstaged entries IF they are the eval report path. Other paths still fail.
3. `runVerifyPhase` writes new eval report to working tree.
4. `normalizeArtifactCommit` runs `git add <path>` (replaces staged deletion with staged modification / new content), then `git commit -m "harness[<runId>]: Phase 6 — rev K eval report"` (K = `state.verifyRetries` AT COMMIT TIME — see §Resume safety).

**Result**: ONE commit per retry instead of two. Commit title encodes revision: `rev 1 eval report`, `rev 2 eval report`, …

**Revision index semantics**: `K = state.verifyRetries + 1` at commit time. The first (pre-retry) verify commits `rev 1`, the first retry commits `rev 2`, etc. This matches user intuition: `rev 1` is the first report committed for the run.

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

### 4.1 `saveGateFeedback` (runner.ts) + escalation propagation

```ts
// BEFORE
function saveGateFeedback(runDir: string, phase: number, comments: string): string

// AFTER — accepts retryIndex to generate archive path
function saveGateFeedback(
  runDir: string,
  phase: number,
  comments: string,
  retryIndex: number,
): string  // returns legacy feedback path (unchanged return contract).
          // Legacy write throws on failure. Archive write is best-effort (try/catch + printWarning).
```

Sibling helper (best-effort, no throw on failure):
```ts
function saveGateApproveVerdict(
  runDir: string,
  phase: number,
  retryIndex: number,
  metadata: { codexSessionId?: string; tokensTotal?: number; durationMs?: number },
): void
```

Call-site propagation:
```ts
// BEFORE
export async function handleGateEscalation(
  phase, comments, state, runDir, cwd, inputManager, logger,
): Promise<void>

// AFTER — accepts retryIndex (propagated from handleGateReject pre-mutation capture)
export async function handleGateEscalation(
  phase, comments, retryIndex, state, runDir, cwd, inputManager, logger,
): Promise<void>
```

`handleGateReject` passes its captured `retryIndex` (gate.ts L496) into the escalation branch (L588). All three `saveGateFeedback` call sites (L531 / L627 / L660) receive a concrete retry index.

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

## 5. Testing

One vitest file per slice, colocated with existing tests:

| Slice | Test file | Key assertions |
|---|---|---|
| T8-a | `tests/phases/gate-feedback-archival.test.ts` | Retry creates `gate-N-retry-K-feedback.md`. APPROVE creates `gate-N-verdict.json` with `verdict:"APPROVE"`. Legacy `gate-N-feedback.md` still written. |
| T8-b | `tests/phases/interactive-watchdog.test.ts` | Under `vi.useFakeTimers()`: timer arms on claude preset, fires exactly once after `vi.advanceTimersByTimeAsync(WATCHDOG_DELAY_MS)`, is cleared (no late fire) on completed/failed/throw. Not armed for codex preset. |
| T8-c | `tests/preflight-claude-at-file.test.ts` | Timeout constant = 10000. Message text contains "delayed" (not "timed out") and "continuing". Exit status ≠ 0 still warns and returns. |
| T8-d | `tests/phases/eval-report-commit-squash.test.ts` | Retry cycle: commit-count delta per round = 1 (measure via `git rev-list` before/after). Messages contain `rev 1 eval report`, `rev 2 eval report`. Resume after simulated crash (staged-D only, no worktree entry) resumes cleanly without throw and produces exactly one new commit. Force-pass path still writes one synthetic commit. |

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
3. **build** — `pnpm build` → exit 0, `dist/src/phases/runner.js` + `dist/src/preflight.js` exist.
4. **T8-a file** — `src/phases/runner.ts` `saveGateFeedback` takes 4 params (`retryIndex: number`). `handleGateEscalation` takes `retryIndex` param. `grep -q "retry-.*-feedback.md" src/phases/runner.ts`.
5. **T8-b constant** — `grep -q "WATCHDOG_DELAY_MS" src/phases/runner.ts`.
6. **T8-c string** — `grep -q "timeout: 10_\\?000" src/preflight.ts`.
7. **T8-d commit-count** — dedicated test verifies for N verify rounds (1 initial + verifyRetries), Phase 6 commit count == `verifyRetries + 1` (one per round), all message titles contain `rev K eval report` for K ∈ {1..verifyRetries+1}. Resume-from-staged-D scenario commits exactly one additional `rev K eval report`.

Each checklist item maps to an automated command in `.harness-eval.json`.
