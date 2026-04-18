# Gate Prompt Hardening & Phase-Start Logging — Design Spec

- Related QA notes: `~/Desktop/projects/harness/experimental-todo/observations.md`
- Scope of run these fixes target: full `harness run` lifecycle, especially gate phases 2/4/7 and interactive phases 1/3/5.

## Context & Decisions

Dog-fooding a fresh `harness run` on a vague todo-CLI prompt (2026-04-18) surfaced three recurring, high-leverage defects and one missing observability field:

- **BUG-A — Gate reviewers lack harness-lifecycle context.** The reviewer (Codex) reads `REVIEWER_CONTRACT + <spec>` without any signal that more artifacts (plan, impl) will be produced by later phases. Observed Gate 2 round-1: reviewer emitted a P1 ("plan file missing") blocking APPROVE even though Phase 3 had not yet run. Each such bogus P1 costs a full Phase-1 re-run (Opus 4.7 xHigh) plus another Gate 2 Codex review.
- **BUG-C — Reviewer imports external personal conventions.** Codex autoloads `~/.codex/AGENTS.md` on every session. Observed Gate 4 round-1: a P1 ("Lore Commit Protocol violation") was raised against a plan that had no reason to know about the user's personal commit-message protocol. Same reject-loop cost as BUG-A.
- **BUG-B — Inner Claude auto-invokes `advisor()` mid-phase.** The Claude Code `using-superpowers` skill instructs Claude to escalate non-trivial tasks to the advisor. Inside a harness interactive phase, the gate review at phase + 1 is already an independent reviewer; a per-phase advisor call duplicates it and adds ~2 min Opus 4.7 wall time per phase. Observed on Phase 1 retry and Phase 3 first-run.
- **Observability gap — `phase_start` log event omits runner/model/effort.** Post-hoc analysis of multi-phase runs cannot attribute tokens/wall time to a specific preset because `events.jsonl` only has preset data on `gate_verdict` / `gate_error`, not on interactive phase boundaries.

Key decisions:

| # | Decision | Summary |
|---|----------|---------|
| D1 | Edit gate prompts, not the Codex invocation | Scope-bleed via `~/.codex/AGENTS.md` could also be fixed by isolating HOME when spawning codex, but that's broad and risky. Prompt-level scope guidance is precise and easy to iterate. |
| D2 | Split lifecycle from scope guidance | Lifecycle ("plan will come later") is phase-specific; scope guidance ("review only what's given, ignore personal workspace conventions") applies to every gate. Keep scope in the shared `REVIEWER_CONTRACT`, inject lifecycle per-builder. |
| D3 | Ban `advisor()` in interactive prompts, keep skill loading | Advisor calls duplicate the gate reviewer. Skills (brainstorming, writing-plans) do produce higher-quality artifacts. Ban the former, allow the latter. |
| D4 | Add `preset` object to `phase_start` event | One extra field (`preset: { id, runner, model, effort }`) on interactive phase_start events. Gate `phase_start` already implicitly reconstructs preset via later gate_verdict, but capturing on start is cheaper and crash-safe. |
| D5 | Keep existing `REVIEWER_CONTRACT` approval rule unchanged | Approval rule ("APPROVE only if zero P0/P1 findings") stays. The fix narrows what qualifies as a finding, not the threshold. |

---

## 1. Goals & Non-Goals

### Goals
- Gate reviewers no longer flag artifacts that do not yet exist in the lifecycle.
- Gate reviewers no longer flag violations of conventions not present in the reviewed artifacts.
- Inner Claude interactive sessions do not call `advisor()` during harness phases.
- `phase_start` events carry the preset used, for all phases where a runner preset is applicable (interactive phases 1/3/5 and gate phases 2/4/7).

### Non-Goals (this PR)
- Changing the Phase 1 default preset (opus-max → opus-high) — defer; `quality > speed > tokens` preference concern.
- Discouraging skill auto-loading or otherwise tuning overengineering — not reproduced as a hard failure yet; needs more data.
- Isolating Codex's HOME / disabling `~/.codex/AGENTS.md` globally — broader change, defer until prompt-level fix proves insufficient.
- Reducing Phase 3 advisor cost *inside* the gate itself (gate reviewer uses no advisor).

---

## 2. Changes overview

| File | Change |
|------|--------|
| `src/context/assembler.ts` | 1. Extend `REVIEWER_CONTRACT` with a scope guidance block. 2. Add a `buildLifecycleContext(phase)` helper. 3. Wire lifecycle context into `buildGatePromptPhase2/4/7`. |
| `src/context/prompts/phase-1.md` | Append a "harness flow constraints" stanza: no advisor() call. |
| `src/context/prompts/phase-3.md` | Same stanza as phase-1. |
| `src/context/prompts/phase-5.md` | Same stanza as phase-{1,3}, adapted. |
| `src/phases/runner.ts` | `handleInteractivePhase` and `handleGatePhase` emit `preset` on `phase_start`. Verify phase 6 uses `harness-verify.sh` and has no preset — no change there. |
| `src/types.ts` | Extend `LogEvent` union: optional `preset` field on `phase_start`. |
| `tests/context/assembler.test.ts` | New cases: Gate 2/4 prompt contains lifecycle stanza; REVIEWER_CONTRACT contains scope stanza. |
| `tests/context/` | Snapshot or substring assertions for each builder. |
| `tests/phases/*.test.ts` (add or extend) | Assert `phase_start` event includes `preset` for phases 1/3/5 and 2/4/7. |

No schema migration (logger event v:1 is already append-only; adding a field is backward-compatible).

---

## 3. Change detail

### 3.1 `REVIEWER_CONTRACT` scope guidance (BUG-C)

Current (src/context/assembler.ts:19-35):

```
You are an independent technical reviewer. …
Rules: APPROVE only if zero P0/P1 findings. Every comment must cite a specific location.
```

New trailing paragraph (inserted after the existing "Rules" line):

```
Scope rules:
- Review ONLY the artifacts provided in this prompt (e.g. <spec>, <plan>, <eval_report>, <diff>).
- Do NOT apply personal or workspace-level conventions (commit-message formats, naming rules, protocols) unless they are explicitly cited in the provided artifacts.
- Do NOT flag artifacts that are outside this phase's scope as "missing" — later harness phases produce plan/impl/eval artifacts.
```

(Bullet 3 is a complement to the phase-specific stanza; kept in the shared contract so every reviewer sees the rule even if we later add a gate that forgets to include a per-phase stanza.)

### 3.2 Phase-specific lifecycle stanza (BUG-A)

New helper in assembler:

```ts
function buildLifecycleContext(phase: 2 | 4 | 7): string {
  if (phase === 2) {
    return `<harness_lifecycle>\nThis is Gate 2 of a 7-phase harness lifecycle. You are reviewing ONLY the <spec> artifact. The implementation plan (Phase 3) and the implementation itself (Phase 5) have not yet been produced; their absence must NOT appear as a finding.\n</harness_lifecycle>\n\n`;
  }
  if (phase === 4) {
    return `<harness_lifecycle>\nThis is Gate 4 of a 7-phase harness lifecycle. You are reviewing the <spec> and <plan>. The implementation (Phase 5) has not yet been produced; its absence must NOT appear as a finding.\n</harness_lifecycle>\n\n`;
  }
  return `<harness_lifecycle>\nThis is Gate 7 of a 7-phase harness lifecycle. Spec, plan, implementation diff, and eval report are all provided. This is the terminal review — if APPROVE, the run is complete.\n</harness_lifecycle>\n\n`;
}
```

Each `buildGatePromptPhaseN` calls `REVIEWER_CONTRACT + buildLifecycleContext(N) + <artifacts>`.

Resume prompts (`buildResumeSections`) do NOT need re-injection (Strategy C: context is already in the resumed session) — no change there.

### 3.3 Interactive phase stanza (BUG-B)

Appended to each of `src/context/prompts/phase-{1,3,5}.md` (after the existing CRITICAL sentinel warning):

```
**HARNESS FLOW CONSTRAINT**: 이 세션은 orchestrated harness 라이프사이클 내부에서 실행된다. 다음 phase에서 Codex 기반 독립 reviewer가 산출물을 검토한다(gate). 따라서:
- `advisor()` 툴을 호출하지 말 것. 외부 리뷰가 이미 예약되어 있다.
- 작업 범위는 이 프롬프트가 지시한 산출물 + 커밋 + sentinel 생성으로 제한한다.
- skill 자동 로드는 허용. 그러나 의사결정을 advisor에 위임하지 말고 자체적으로 결론을 낸다.
```

### 3.4 `phase_start` preset field (logging)

Extend the `phase_start` variant of the `LogEvent` union in `src/types.ts:175` with an optional `preset` field:

```ts
// before
| (LogEventBase & { event: 'phase_start'; phase: number; attemptId?: string | null; reopenFromGate?: number | null; retryIndex?: number })

// after
| (LogEventBase & {
    event: 'phase_start';
    phase: number;
    attemptId?: string | null;
    reopenFromGate?: number | null;
    retryIndex?: number;
    preset?: { id: string; runner: 'claude' | 'codex'; model: string; effort: string };
  })
```

`handleInteractivePhase` (src/phases/runner.ts:219) already resolves the preset via `getPresetById`; include it in `logger.logEvent({ event: 'phase_start', ... })`.

`handleGatePhase` similarly has the preset available; include on its `phase_start` event.

Verify phase 6 uses `harness-verify.sh` and has no preset — emit `phase_start` without the `preset` field (no change).

---

## 4. Testing

Unit tests (vitest, existing fixtures in `tests/context/`):

- **Gate 2 prompt** contains both the scope-rules block AND the phase-2 lifecycle stanza ("has not yet been produced").
- **Gate 4 prompt** contains scope rules AND phase-4 lifecycle stanza mentioning "implementation … has not yet been produced".
- **Gate 7 prompt** contains scope rules AND a lifecycle stanza that does NOT say "has not yet been produced" (terminal review).
- **REVIEWER_CONTRACT**'s approval rule (zero P0/P1) is still present verbatim — guards against accidental regression.
- **Phase 1/3/5 interactive prompts** contain the `HARNESS FLOW CONSTRAINT` block and the `advisor()` prohibition.
- **`phase_start` event** emits `preset: { id, runner, model, effort }` for phases 1/3/5 and 2/4/7. Test via existing logger integration tests or add a minimal new one.

No manual end-to-end retest required for this PR; dog-fooding will re-run the full lifecycle in a follow-up session to measure reject-loop reduction.

---

## 5. Out of Scope / Deferred

- Phase 1 default preset tuning (opus-max → opus-high) — user-preference-sensitive.
- Skill-load-time reduction in interactive phases — low-confidence fix, needs more data.
- Per-phase token accounting for Claude (not just Codex gates).
- Pane layout auto-width / readability at narrow terminals.
- `harness-verify.sh` repeated setup-per-check pattern (plan-phase prompt guidance issue, not gate-prompt issue).

---

## 6. Risks

| Risk | Mitigation |
|------|-----------|
| Scope stanza weakens reviewer rigor (reviewer stops flagging legitimate contract violations). | Stanza is scoped to "personal/workspace conventions not cited in artifacts" — spec-defined contracts are still in bounds. |
| Advisor ban harms quality for genuinely ambiguous design choices. | Gate reviewer catches those; if the gate misses the gap, the reject loop forces a re-try. |
| Preset field breaks older event-log parsers. | New field is optional. Existing readers ignore unknown fields (`logger.ts` serializes as JSON; downstream tooling must be additive-tolerant). |
