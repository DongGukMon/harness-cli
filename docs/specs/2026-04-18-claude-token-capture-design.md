# Claude Token Capture on Interactive Phases — Design Spec + Plan

- Related:
  - `docs/specs/2026-04-18-gate-prompt-hardening-design.md` — prior PR that added `preset` to `phase_start` (observability gap #12 parent).
  - CLAUDE.md "이벤트 로깅 스키마" — current event schema to be extended.
  - `~/Desktop/projects/harness/experimental-todo/observations.md` — dog-fooding observation that surfaced the gap.
- Process: light 4-phase flow (spec + plan in this single doc → codex plan gate → impl → verify).

---

## 1. Problem & Goals

### Problem
`events.jsonl` records `preset: { id, runner, model, effort }` on every interactive `phase_start` (PR #11), but no token count on the matching `phase_end`. Gate phases already capture `tokensTotal` (from Codex stderr). The asymmetry prevents answering "which phase burnt how many tokens?" in post-hoc analysis — blocking Issue #1 (gate reject convergence) diagnosis and making Issue #8 (Phase 1 preset over-provisioning) hard to quantify.

### Goals
- Interactive `phase_end` events (phases 1/3/5) gain an optional `claudeTokens` field when `preset.runner === 'claude'`.
- Field carries per-phase aggregated input / output / cache-read / cache-create / total.
- Best-effort: missing/unparseable logs yield `claudeTokens: null`, never throw, never block the lifecycle.

### Non-Goals
- Codex interactive token capture (Codex interactive runner doesn't expose per-session token counts the way gate runs do; separate issue).
- Gate/verify phase re-capture (gate already has `tokensTotal`; verify has no preset).
- Cost/$$$ calc. Numbers only.
- Dashboard or summary.json schema change.
- Changing existing preset defaults (Issue #8).
- UI/docs refresh of CLAUDE.md event-schema table — deferred to next session index refresh, per repo convention.

---

## 2. Design

### 2.1 Token source — pinned Claude session UUID

**Primary:** pass `--session-id ${attemptId}` when launching `claude` in `runClaudeInteractive`. The harness already mints a fresh UUID (`attemptId` via `randomUUID()`) for each phase attempt in `handleInteractivePhase` and propagates it into `state.phaseAttemptId[String(phase)]`. Reusing the same UUID as the Claude session id makes the log filename deterministic:

```
~/.claude/projects/<encodedCwd>/<attemptId>.jsonl
```

where `encodedCwd = cwd.replace(/[^a-zA-Z0-9]/g, '-')`. Confirmed empirically: `/Users/daniel/.grove/github.com/...` → `-Users-daniel--grove-github-com-...` (slash and dot both collapse to `-`).

**Rejected alternatives:**
- stdout/stderr end-of-session summary — Claude Code does not emit one in interactive mode (verified via `claude --help`).
- Stop hook — requires user-level `~/.claude/settings.json` mutation; brittle across Claude versions and pollutes user global config.
- `claude /usage` subcommand — does not exist (verified via `claude --help`).
- Time-window scan only — ambiguous if Claude's auto-generated session id shifts or overlaps with concurrent sessions.

### 2.2 Fallback — time-window scan

If the pinned file is missing or empty when we read it (e.g., a future Claude version silently ignores `--session-id`), fall back to scanning `~/.claude/projects/<encodedCwd>/*.jsonl` for files whose **first assistant entry's timestamp** is `>= phaseStartTs`. Among matches, pick the one with the **smallest** first-assistant timestamp (i.e., the session that began closest to — but not before — phase open). Parse the same way.

Scan is opt-in per call, bounded to the phase's own project dir, and short-circuits on the first match. On any error the reader still returns `null`.

### 2.3 JSONL line format

Observed shape of the entries we care about (other line types — `queue-operation`, `user`, `system`, etc. — are ignored):

```json
{
  "type": "assistant",
  "timestamp": "2026-04-18T07:06:05.269Z",
  "sessionId": "67e99f92-...",
  "message": {
    "usage": {
      "input_tokens": 3,
      "output_tokens": 595,
      "cache_read_input_tokens": 0,
      "cache_creation_input_tokens": 23100
    }
  }
}
```

Only the four numeric fields inside `message.usage` are summed. Missing fields default to 0. Other fields (`service_tier`, `iterations`, etc.) are ignored.

### 2.4 Aggregation

```ts
interface ClaudeTokens {
  input: number;       // Σ input_tokens
  output: number;      // Σ output_tokens
  cacheRead: number;   // Σ cache_read_input_tokens
  cacheCreate: number; // Σ cache_creation_input_tokens
  total: number;       // input + output + cacheRead + cacheCreate
}
```

Zero assistant turns → `{ input: 0, output: 0, cacheRead: 0, cacheCreate: 0, total: 0 }` (distinct from `null`; means "Claude ran but emitted nothing billable").

### 2.5 Event schema

`phase_end` LogEvent gains an optional field:

```ts
// src/types.ts — LogEvent union
| (LogEventBase & {
    event: 'phase_end';
    phase: number;
    attemptId?: string | null;
    status: 'completed' | 'failed';
    durationMs: number;
    details?: { reason: string };
    claudeTokens?: ClaudeTokens | null;  // NEW
  })
```

Emission rules:
- Emit `claudeTokens` only when the phase preset has `runner === 'claude'`.
- `null` means the attempt ran on Claude but token extraction failed.
- `undefined` (field omitted) means extraction wasn't attempted — runner is codex, or phase is not interactive (gate/verify), or the phase ended via the early "redirected by control signal" branch where token metering is meaningless.

### 2.6 Integration points

| File | Change |
|------|--------|
| `src/types.ts` | Add `ClaudeTokens` interface; add optional `claudeTokens` on the `phase_end` variant. |
| `src/runners/claude.ts` | `runClaudeInteractive`: prepend `--session-id ${attemptId}` to `claudeArgs`. |
| `src/runners/claude-usage.ts` **(new)** | Pure module exposing `encodeProjectDir(cwd)` and `readClaudeSessionUsage({ sessionId, cwd, phaseStartTs, homeDir? })`. |
| `src/phases/runner.ts` | `handleInteractivePhase`: after `runInteractivePhase` returns, call the reader when `preset.runner === 'claude'` and attach `claudeTokens` to every `phase_end` emission in that function. |
| `tests/runners/claude-usage.test.ts` **(new)** | Unit tests for the parser, driven by fixtures under `tests/fixtures/claude-sessions/`. |
| `tests/phases/runner-token-capture.test.ts` **(new)** | Integration-ish test: fake a jsonl, run `handleInteractivePhase`, assert the emitted `phase_end` event carries `claudeTokens`. |

No state.json schema change. No migration. `events.jsonl` v:1 is append-only with optional fields — backward-compatible.

### 2.7 Error handling

`readClaudeSessionUsage` never throws. On any error (missing dir, ENOENT, malformed JSON line, fs permission, invalid shape) it logs **one** `warnOnce`-style stderr line per failure and returns `null`. Callers in `handleInteractivePhase` do not wrap in extra try/catch beyond this contract.

### 2.8 Testing strategy

**Unit (`tests/runners/claude-usage.test.ts`):**

Fixtures under `tests/fixtures/claude-sessions/`:
- `happy-multi-turn.jsonl` — three assistant entries with mixed cache usage.
- `malformed-line.jsonl` — one bad JSON line surrounded by valid entries; parser skips the bad line and sums the rest.
- `no-assistant-entries.jsonl` — only `queue-operation` / `user` entries; returns `{0,0,0,0,0}`.
- `cache-only.jsonl` — all entries miss `input_tokens` but have `cache_creation_input_tokens`; correct sum.
- `fallback-candidate.jsonl` — used to exercise the time-window fallback (pinned UUID file missing, scan finds this one).

Cases:
1. happy path, pinned UUID, correct totals.
2. pinned file missing + fallback finds the right file.
3. pinned file missing + fallback finds nothing → `null`.
4. malformed line skipped.
5. no assistant entries → zero sum (not null).
6. cache-only entries sum correctly.
7. project dir missing entirely → `null` + single stderr warn.

**Integration (`tests/phases/runner-token-capture.test.ts`):**
- Set up a temp `$HOME` via env; drop a fixture jsonl at `<HOME>/.claude/projects/<encoded>/<attemptId>.jsonl`.
- Stub `runInteractivePhase` to return `{ status: 'completed', attemptId }` without actually launching Claude.
- Drive `handleInteractivePhase` and assert the `phase_end` log event carries `claudeTokens` matching the fixture.
- Codex preset case: assert `claudeTokens` is absent (undefined, not null).

**Run with existing harness**: `pnpm tsc --noEmit` + `pnpm vitest run`. New tests should not disturb the 497/1-skipped baseline.

---

## 3. Implementation Plan (TDD task order)

### T1 — types & shared interface
**Files:** `src/types.ts`
- Define `ClaudeTokens`.
- Extend `phase_end` variant with `claudeTokens?: ClaudeTokens | null`.
- **Exit criterion:** `pnpm tsc --noEmit` clean; no downstream compile failures.

### T2 — parser module + unit tests (TDD)
**Files:** `src/runners/claude-usage.ts` (new), `tests/runners/claude-usage.test.ts` (new), `tests/fixtures/claude-sessions/*.jsonl` (new).

1. Write failing tests first for the 7 cases in §2.8.
2. Implement `encodeProjectDir(cwd)` — single-regex replace.
3. Implement `readClaudeSessionUsage({ sessionId, cwd, phaseStartTs, homeDir = os.homedir() })`:
   - Compute pinned path. If exists: parse line-by-line, sum.
   - Else: list project dir, find earliest jsonl whose first assistant entry timestamp ≥ phaseStartTs; parse it.
   - On any caught error: stderr warn once, return `null`.
4. Re-run tests; all pass.

**Exit criterion:** `pnpm vitest run tests/runners/claude-usage.test.ts` green.

### T3 — pin session id in Claude runner
**Files:** `src/runners/claude.ts`.
- In `runClaudeInteractive`, insert `--session-id ${attemptId}` into `claudeArgs` BEFORE `@${promptFile}`:
  ```ts
  const claudeArgs = `--dangerously-skip-permissions --session-id ${attemptId} --model ${preset.model} --effort ${preset.effort} @${path.resolve(promptFile)}`;
  ```
- `attemptId` is already derived on line 55 from `state.phaseAttemptId[String(phase)]`.
- Guard against empty attemptId (shouldn't happen given upstream contract): if `attemptId === ''`, skip the flag rather than emit an invalid CLI call.

**Exit criterion:** manual read + `pnpm tsc --noEmit` clean. No existing test regresses.

### T4 — wire reader into phase_end
**Files:** `src/phases/runner.ts`, `tests/phases/runner-token-capture.test.ts` (new).

In `handleInteractivePhase`:
- Determine runner: `const runnerName = preset?.runner` (from `getPhasePresetMeta`).
- Helper inside the function: `const collectTokens = () => runnerName === 'claude' ? readClaudeSessionUsage({ sessionId: attemptId, cwd, phaseStartTs }) : undefined;`.
- Call it once **after** `runInteractivePhase` resolves and attach to every `phase_end` emission in the function (completed path, failed path, redirected-by-signal path **skip** — redirect means the phase didn't really run its own work).
- Don't add tokens to the early `throw` catch path's phase_end — unreachable in practice (integration tests to confirm).

Tests:
- Drop fixture jsonl at the expected path.
- Mock/stub `runInteractivePhase` to return completed.
- Drive `handleInteractivePhase` with a minimal state; capture the logged event.
- Assert `claudeTokens` present and correct.
- Repeat with codex preset; assert field absent.

**Exit criterion:** new test green; existing `pnpm vitest run` baseline (497 passed / 1 skipped) still holds (count may increase with new tests).

### T5 — smoke & PR
**Files:** none (runtime verification).
- `pnpm build` → dist produced.
- Copy / rebuild into `~/Desktop/projects/harness/harness-cli` (or keep separate dist) and run a simple `harness run --enable-logging` task.
- Grep `~/.harness/sessions/<repoKey>/<runId>/events.jsonl` for `phase_end` entries; confirm phases 1/3/5 carry `claudeTokens` with plausible values (total > 0).
- Attach a redacted sample to PR description.

**Exit criterion:** PR body contains smoke result; checklist green; PR opened against `main`.

---

## 4. Eval Checklist (Phase 6 `harness-verify.sh` input)

`.harness/checklist.json` equivalent (placed inside commit of the same PR per repo convention; actual file is written by plan phase in full harness but we're in light flow, so listed here for reviewer reference):

```json
{
  "checks": [
    { "name": "typecheck",  "command": "pnpm tsc --noEmit" },
    { "name": "vitest",     "command": "pnpm vitest run" },
    { "name": "build",      "command": "pnpm build" }
  ]
}
```

Manual smoke (not automatable — requires an interactive Claude session):
- `pnpm build` in this worktree.
- Run a trivial `harness run --enable-logging "<task>"` from a scratch worktree (or Desktop experimental dir).
- Verify `events.jsonl` phases 1/3/5 `phase_end` events have `claudeTokens` with `total > 0` and the four subfields.
- Sample (last 5 lines or redacted) → PR body.

---

## 5. Open Questions

**Q1. Does `claude --session-id <uuid>` work in interactive (non `--print`) mode?**
- `claude --help` does not scope `--session-id` to `--print`. Assume yes.
- **If Claude silently ignores it in interactive mode:** §2.2 time-window fallback covers this case. The observable cost is a marginally slower path (one directory scan), which is well below the phase-level timing.
- We also cover this in testing by explicitly exercising the fallback path with the pinned file absent.

**Q2. Flush lag on the last assistant turn.**
- Claude appears to append per-turn; no observed buffering in existing logs.
- If the final turn's line is being flushed at exactly the moment we read, we may under-count it. Acceptable: tokens are a metric, not a billing record. No retry/sleep.

**Q3. Should phase_end carry `claudeSessionId` too?**
- Deferred. `attemptId` already equals the Claude session id by construction after T3. Duplicating is cost without new information.

**Q4. What about phase 5 reopen (verify-failure retry) — multiple attempts, multiple jsonl files?**
- Each retry gets a fresh `attemptId`, so each `phase_end` captures only that attempt's tokens. That's the desired semantic.

**Q5. Safety of inserting `--session-id` as a shell-quoted command for tmux?**
- `attemptId` is a v4 UUID (`randomUUID()`), so characters are `[0-9a-f-]` only — no shell-escaping concerns. The existing tmux command uses `sh -c '...'` single-quoted, and UUIDs interpolate safely.

---

## 6. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|-----------|
| `--session-id` causes Claude to attempt to resume a non-existent session and error out | low | attemptId is freshly random; Claude's docs say the flag "uses a specific session ID for the conversation". If observed, gate behind a boolean constant and fall back to time-window scan only. |
| fs.readFileSync of a multi-MB jsonl blows up memory | low | typical phase jsonl is <2 MB per observation; we scan line-by-line via `split('\n')`. If needed, switch to streaming later. |
| Race: phase_end fires before Claude flushes last turn | low | accepted; see Q2. |
| Project dir encoding drift (Claude Code changes the hash scheme) | medium | pinned lookup still works (filename == attemptId regardless of parent dir). Fallback scan relies on encoding — if Claude changes it, unit-test fails fast and we patch `encodeProjectDir`. |

---

## 7. Out of Scope (reminder)

- Codex interactive token capture.
- Gate / verify token re-capture.
- Cost / pricing.
- CLAUDE.md event-schema table refresh (follow-up doc-only PR).
- Phase preset changes (Issue #8).
- State.json, checklist.json, or other persistent schema changes.
