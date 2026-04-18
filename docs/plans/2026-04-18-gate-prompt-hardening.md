# Gate Prompt Hardening + phase-start Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/specs/2026-04-18-gate-prompt-hardening-design.md`

**Goal:** Close three repeatable gate/phase defects (BUG-A lifecycle blind-spot, BUG-B auto-advisor, BUG-C external-convention bleed-through) and record preset identity on every phase boundary event so post-hoc token/wall-time attribution is possible.

**Architecture:** Prompt-level fixes in `src/context/assembler.ts` and `src/context/prompts/phase-{1,3,5}.md`; typed-log extensions in `src/types.ts` wired through `src/phases/runner.ts`. No schema migration (event log v:1 is additive), no runtime behaviour change beyond what the reviewer/Claude see in prompts.

**Tech Stack:** TypeScript (strict), vitest test suite, pnpm workspace, existing `assembleGatePrompt` / `assembleInteractivePrompt` entrypoints already covered by `tests/context/assembler.test.ts` and `tests/phases/runner.test.ts`.

**Scope note:** Each task ends with `pnpm vitest run <path>` and a commit. Final task runs the full suite + `pnpm tsc --noEmit` + `pnpm build` before the PR.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/context/assembler.ts` | Modify | Extend `REVIEWER_CONTRACT` with scope rules; add `buildLifecycleContext(phase)` helper; wire it into `buildGatePromptPhase{2,4,7}`. |
| `src/context/prompts/phase-1.md` | Modify | Append `HARNESS FLOW CONSTRAINT` stanza (no advisor). |
| `src/context/prompts/phase-3.md` | Modify | Append `HARNESS FLOW CONSTRAINT` stanza (no advisor). |
| `src/context/prompts/phase-5.md` | Modify | Append `HARNESS FLOW CONSTRAINT` stanza (no advisor). |
| `src/types.ts` | Modify | Add optional `preset` field to `phase_start`, `gate_verdict`, `gate_error` log event variants. |
| `src/phases/runner.ts` | Modify | Resolve preset via `getPresetById` and include it in `handleInteractivePhase`'s `phase_start` and `handleGatePhase`'s `gate_verdict` + `gate_error` logEvent calls. |
| `tests/context/assembler.test.ts` | Modify | New cases: Gate-2/4/7 lifecycle stanza, REVIEWER_CONTRACT scope block, phase-1/3/5 prompts contain the `HARNESS FLOW CONSTRAINT` wording, including the `advisor()` prohibition. |
| `tests/phases/runner.test.ts` | Modify | Extend existing `phase_start` + `gate_verdict` tests to assert `preset` presence. |
| `dist/**` | Regenerate | Built via `pnpm build` at end of plan (harness CLI is consumed as a pnpm link — dist must be fresh). |

---

## Task 0: Verify working tree & baseline tests

**Files:** none (pre-flight only).

- [ ] **Step 1: Confirm clean working tree and rebased onto latest main**

Run:

```bash
cd /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/new-experiment
git status -s
git log --oneline main..HEAD | cat
```

Expected:
- `git status -s` prints nothing (clean tree).
- `git log main..HEAD` shows only the two spec commits:
  - `docs(spec): gate prompt hardening + phase-start logging`
  - `docs(spec): clarify preset field lives on gate_verdict/gate_error for gates`

If the tree is dirty or HEAD is behind `main`, stop and investigate before touching code.

- [ ] **Step 2: Run the existing test suites we'll touch, green baseline**

Run:

```bash
pnpm vitest run tests/context/assembler.test.ts tests/phases/runner.test.ts 2>&1 | tail -40
```

Expected: both files pass. Record any pre-existing failures (there should be none on a clean `main` + spec commits).

---

## Task 1: Add scope-rules block to REVIEWER_CONTRACT (BUG-C)

**Files:**
- Modify: `src/context/assembler.ts` (around line 19 — the `REVIEWER_CONTRACT` constant).
- Modify: `tests/context/assembler.test.ts` (extend the existing Gate 2 describe block around line 119).

- [ ] **Step 1: Write the failing test**

In `tests/context/assembler.test.ts`, inside the existing `describe('Gate 2 prompt', …)` block, add:

```ts
  it('includes scope rules that forbid external conventions and not-yet-produced artifacts', () => {
    const state = makeState();
    const result = assembleGatePrompt(2, state, '/tmp/harness', makeTmpDir());
    if (typeof result !== 'string') throw new Error('expected string');
    expect(result).toContain('Scope rules:');
    expect(result).toContain('personal or workspace-level conventions');
    expect(result).toContain('later harness phases produce plan/impl/eval artifacts');
  });
```

Note: the existing Gate 2 tests pass a spec fixture — check the top of the file to see how `assembleGatePrompt` is called. Reuse the same fixture-setup pattern (check lines 119-155 for current invocation shape before writing the new test).

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run tests/context/assembler.test.ts -t 'includes scope rules' 2>&1 | tail -20
```

Expected: FAIL. The assertions on `'Scope rules:'` etc. do not yet match anything in the prompt.

- [ ] **Step 3: Extend `REVIEWER_CONTRACT`**

In `src/context/assembler.ts`, replace the existing constant (roughly lines 19-35) with:

```ts
const REVIEWER_CONTRACT = `You are an independent technical reviewer. Review the provided documents and return a structured verdict.
Output format — must include exactly these sections in order:

## Verdict
APPROVE or REJECT

## Comments
- **[P0|P1|P2|P3]** — Location: ...
  Issue: ...
  Suggestion: ...
  Evidence: ...

## Summary
One to two sentences.

Rules: APPROVE only if zero P0/P1 findings. Every comment must cite a specific location.

Scope rules:
- Review ONLY the artifacts provided in this prompt (e.g. <spec>, <plan>, <eval_report>, <diff>).
- Do NOT apply personal or workspace-level conventions (commit-message formats, naming rules, protocols) unless they are explicitly cited in the provided artifacts.
- Do NOT flag artifacts that are outside this phase's scope as "missing" — later harness phases produce plan/impl/eval artifacts.
`;
```

- [ ] **Step 4: Run the new test to verify it passes**

Run:

```bash
pnpm vitest run tests/context/assembler.test.ts -t 'includes scope rules' 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 5: Run the full assembler suite to confirm no regressions**

Run:

```bash
pnpm vitest run tests/context/assembler.test.ts 2>&1 | tail -20
```

Expected: All assembler tests pass (including the unchanged "includes full reviewer contract with location-citation rule" at line 139 — we added to the contract, did not remove).

- [ ] **Step 6: Commit**

```bash
git add src/context/assembler.ts tests/context/assembler.test.ts
git commit -m "$(cat <<'EOF'
fix(assembler): add scope rules to REVIEWER_CONTRACT (BUG-C)

Gate reviewers were importing the user's ~/.codex/AGENTS.md personal
conventions (e.g. Lore Commit Protocol) and flagging them against
unrelated projects. The scope-rules block makes explicit that the
reviewer reviews only the artifacts provided and must not apply external
workspace conventions.

Also forbids flagging not-yet-produced artifacts as missing — second half
of the lifecycle-awareness fix (see Task 2 for the per-phase stanza).

Observed: Gate 4 round-1 on the 2026-04-18 dog-fooding run raised a P1
"Lore Commit Protocol violation" against a plan with no such protocol
cited. One full Phase-3 re-run (Sonnet-high) per bogus P1.
EOF
)"
```

---

## Task 2: Add phase-specific lifecycle context to each gate builder (BUG-A)

**Files:**
- Modify: `src/context/assembler.ts` (add helper after line ~105, wire into `buildGatePromptPhase2/4/7` around lines 108/120/134).
- Modify: `tests/context/assembler.test.ts` (extend Gate 2 describe; add Gate 4 and Gate 7 describes if not present).

- [ ] **Step 1: Write failing tests for each gate's lifecycle stanza**

Add to `tests/context/assembler.test.ts`:

```ts
describe('Gate 2/4/7 lifecycle stanza', () => {
  it('Gate 2 prompt includes phase-2 lifecycle stanza (plan/impl/eval not yet produced)', () => {
    const state = makeState();
    const result = assembleGatePrompt(2, state, '/tmp/harness', makeTmpDir());
    if (typeof result !== 'string') throw new Error('expected string');
    expect(result).toContain('<harness_lifecycle>');
    expect(result).toContain('Gate 2');
    expect(result).toContain('have not yet been produced');
  });

  it('Gate 4 prompt includes phase-4 lifecycle stanza (impl not yet produced)', () => {
    const state = makeState();
    const result = assembleGatePrompt(4, state, '/tmp/harness', makeTmpDir());
    if (typeof result !== 'string') throw new Error('expected string');
    expect(result).toContain('<harness_lifecycle>');
    expect(result).toContain('Gate 4');
    expect(result).toContain('implementation (Phase 5) has not yet been produced');
  });

  it('Gate 7 prompt includes terminal lifecycle stanza without "not yet produced" wording', () => {
    const state = makeState();
    const result = assembleGatePrompt(7, state, '/tmp/harness', makeTmpDir());
    if (typeof result !== 'string') throw new Error('expected string');
    expect(result).toContain('<harness_lifecycle>');
    expect(result).toContain('Gate 7');
    expect(result).toContain('terminal review');
    expect(result).not.toContain('has not yet been produced');
  });
});
```

Note: `makeState()`, `makeTmpDir()`, and the fixture setup for `assembleGatePrompt` are already defined at the top of `tests/context/assembler.test.ts` — reuse them. If `assembleGatePrompt(4, …)` or `assembleGatePrompt(7, …)` requires additional state fields (plan, evalReport, etc.), look at the existing Gate-2 test fixtures (line 119-155) and the fixtures directory (`tests/context/fixtures/`) — the assembler signature and the minimal state shape are already established.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm vitest run tests/context/assembler.test.ts -t 'lifecycle stanza' 2>&1 | tail -30
```

Expected: 3 FAIL.

- [ ] **Step 3: Add `buildLifecycleContext` helper and wire it into each gate builder**

In `src/context/assembler.ts`, insert after the `runGit` helper (around line 104), before the `// ─── Gate 2: Spec review ───` comment:

```ts
function buildLifecycleContext(phase: 2 | 4 | 7): string {
  if (phase === 2) {
    return `<harness_lifecycle>\nThis is Gate 2 of a 7-phase harness lifecycle. You are reviewing ONLY the <spec> artifact. The implementation plan (Phase 3), the implementation itself (Phase 5), and the eval report (Phase 7) have not yet been produced; their absence must NOT appear as a finding.\n</harness_lifecycle>\n\n`;
  }
  if (phase === 4) {
    return `<harness_lifecycle>\nThis is Gate 4 of a 7-phase harness lifecycle. You are reviewing the <spec> and <plan>. The implementation (Phase 5) has not yet been produced; its absence must NOT appear as a finding.\n</harness_lifecycle>\n\n`;
  }
  return `<harness_lifecycle>\nThis is Gate 7 of a 7-phase harness lifecycle. Spec, plan, implementation diff, and eval report are all provided. This is the terminal review — if APPROVE, the run is complete.\n</harness_lifecycle>\n\n`;
}
```

Then modify each builder to prepend the lifecycle stanza **after** `REVIEWER_CONTRACT` and **before** `<spec>…`:

```ts
// buildGatePromptPhase2 — replace the current return:
return (
  REVIEWER_CONTRACT +
  buildLifecycleContext(2) +
  `<spec>\n${specResult.content}\n</spec>\n`
);
```

```ts
// buildGatePromptPhase4 — similarly:
return (
  REVIEWER_CONTRACT +
  buildLifecycleContext(4) +
  `<spec>\n${specResult.content}\n</spec>\n\n` +
  `<plan>\n${planResult.content}\n</plan>\n`
);
```

```ts
// buildGatePromptPhase7 — inject right after REVIEWER_CONTRACT.
// Locate the existing `return REVIEWER_CONTRACT + …` string concatenation and
// insert `buildLifecycleContext(7) +` before the `<spec>` block. If the
// function uses template literals, put `${buildLifecycleContext(7)}` in the
// corresponding spot. Do NOT change any downstream diff/metadata/externalSummary
// block ordering.
```

(Phase-7 builder uses a larger body with diff + externalSummary + metadata sections; lifecycle stanza goes immediately after `REVIEWER_CONTRACT` and before the first `<spec>` block.)

- [ ] **Step 4: Run the lifecycle tests**

Run:

```bash
pnpm vitest run tests/context/assembler.test.ts -t 'lifecycle stanza' 2>&1 | tail -30
```

Expected: 3 PASS.

- [ ] **Step 5: Run the full assembler suite + size-limit tests**

Run:

```bash
pnpm vitest run tests/context/assembler.test.ts tests/context/assembler-resume.test.ts 2>&1 | tail -30
```

Expected: all green. The resume-prompt builder (`buildResumeSections`) did not change; its tests must still pass. Resume prompts intentionally skip `REVIEWER_CONTRACT` and lifecycle stanza per spec §4.3 — the change in Task 1+2 does not touch that path.

- [ ] **Step 6: Commit**

```bash
git add src/context/assembler.ts tests/context/assembler.test.ts
git commit -m "$(cat <<'EOF'
fix(assembler): add per-gate lifecycle context to review prompt (BUG-A)

The reviewer previously had no signal that later-phase artifacts (plan,
impl, eval report) are produced in subsequent harness phases. It kept
flagging them as "missing" P1 findings and triggering full reject loops.

This change injects a phase-specific <harness_lifecycle> stanza into each
of buildGatePromptPhase2/4/7 via a new buildLifecycleContext helper.

- Gate 2: plan/impl/eval not yet produced.
- Gate 4: impl not yet produced.
- Gate 7: terminal review — all artifacts present.

Observed: Gate 2 round-1 on the 2026-04-18 dog-fooding run raised a P1
"plan file missing" against a spec that explicitly noted the plan is a
future-phase artifact. One full Phase-1 re-run (Opus 4.7 xHigh) +
another Gate 2 Codex call per bogus P1.

Resume prompts (buildResumeSections) intentionally skip the lifecycle
stanza per spec §4.3 — the context is already in the resumed session.
EOF
)"
```

---

## Task 3: Add `HARNESS FLOW CONSTRAINT` stanza to interactive phase prompts (BUG-B)

**Files:**
- Modify: `src/context/prompts/phase-1.md`
- Modify: `src/context/prompts/phase-3.md`
- Modify: `src/context/prompts/phase-5.md`
- Modify: `tests/context/assembler.test.ts`

- [ ] **Step 1: Write failing tests for each interactive phase**

Add to `tests/context/assembler.test.ts` (insert as a new describe block near the end of the interactive-prompt section, around line 100):

```ts
describe('Phase 1/3/5 HARNESS FLOW CONSTRAINT stanza', () => {
  it.each([1, 3, 5] as const)('Phase %i prompt forbids advisor() and explains the gate reviewer', (phase) => {
    const state = makeState({
      phaseAttemptId: { '1': 'aid', '3': 'aid', '5': 'aid' },
    });
    const prompt = assembleInteractivePrompt(phase, state, '/tmp/harness');
    expect(prompt).toContain('HARNESS FLOW CONSTRAINT');
    expect(prompt).toContain('advisor()');
    expect(prompt).toContain('독립 reviewer');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm vitest run tests/context/assembler.test.ts -t 'HARNESS FLOW CONSTRAINT' 2>&1 | tail -20
```

Expected: 3 FAIL (none of the phase prompts yet include the stanza).

- [ ] **Step 3: Append the stanza to each prompt template**

The stanza content (keep wording identical across all three files to let the test `it.each` assert one block):

```markdown

**HARNESS FLOW CONSTRAINT**: 이 세션은 orchestrated harness 라이프사이클 내부에서 실행된다. 다음 phase에서 Codex 기반 독립 reviewer가 산출물을 검토한다(gate). 따라서:
- `advisor()` 툴을 호출하지 말 것. 외부 리뷰가 이미 예약되어 있다.
- 작업 범위는 이 프롬프트가 지시한 산출물 + 커밋 + sentinel 생성으로 제한한다.
- skill 자동 로드는 허용. 그러나 의사결정을 advisor에 위임하지 말고 자체적으로 결론을 낸다.
```

Append this block to each of:
- `src/context/prompts/phase-1.md` (after the existing CRITICAL sentinel line and the final "decisions.md는 …에 작성하라." line)
- `src/context/prompts/phase-3.md` (after the existing CRITICAL sentinel line)
- `src/context/prompts/phase-5.md` (after the existing CRITICAL sentinel line)

Ensure there is exactly one blank line between the CRITICAL sentinel paragraph and the new stanza so the resulting markdown renders cleanly.

- [ ] **Step 4: Run the new tests**

Run:

```bash
pnpm vitest run tests/context/assembler.test.ts -t 'HARNESS FLOW CONSTRAINT' 2>&1 | tail -20
```

Expected: 3 PASS.

- [ ] **Step 5: Run the full assembler suite**

Run:

```bash
pnpm vitest run tests/context/assembler.test.ts 2>&1 | tail -20
```

Expected: all green. Existing "includes task.md path" / "includes feedback path" / "instructs writing '## Context & Decisions' section" tests still pass (we appended, did not remove).

- [ ] **Step 6: Commit**

```bash
git add src/context/prompts/phase-1.md src/context/prompts/phase-3.md src/context/prompts/phase-5.md tests/context/assembler.test.ts
git commit -m "$(cat <<'EOF'
fix(prompts): forbid advisor() in harness interactive phases (BUG-B)

The inner Claude session auto-invoked advisor() mid-phase (driven by
Claude Code's using-superpowers skill). Inside a harness lifecycle, a
gate reviewer at phase+1 already provides an independent second-look,
so advisor calls are redundant — each one cost ~2 min Opus 4.7 wall
time and thousands of tokens.

Append a HARNESS FLOW CONSTRAINT block to phase-{1,3,5}.md that:
- forbids advisor() invocations,
- scopes the work to prompt-specified artifact + commit + sentinel,
- keeps skill auto-loading intact (brainstorming / writing-plans help),
  but requires decisions to be made by the phase owner rather than
  delegated.

Observed: Phase 1 retry and Phase 3 first-run on the 2026-04-18
dog-fooding run each called advisor() at Opus 4.7, stretching Sonnet
phases to wall time equal to xHigh Opus phases.
EOF
)"
```

---

## Task 4: Add `preset` field to `phase_start`, `gate_verdict`, `gate_error` (logging)

**Files:**
- Modify: `src/types.ts` (extend the `LogEvent` union at ~line 175 and the `gate_verdict`/`gate_error` variants at ~lines 176-203).
- Modify: `src/phases/runner.ts` (two logEvent call sites at line 219 and inside `handleGatePhase`).
- Modify: `tests/phases/runner.test.ts` (extend existing `phase_start` and `gate_verdict` assertion tests).

- [ ] **Step 1: Write failing tests for each event**

In `tests/phases/runner.test.ts`, inside `describe('handleInteractivePhase — event emission', …)` (around line 731), add a new case:

```ts
  it('emits phase_start with preset { id, runner, model, effort } for phase 1', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 1 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(runInteractivePhase).mockImplementationOnce(async (phase, st, _h, _r, _c, attemptId) => {
      st.phases[String(phase)] = 'completed';
      return { status: 'completed', attemptId } as any;
    });

    try {
      await handleInteractivePhase(1, state, HDIR, runDir, CWD, logger);
      const events = readEvents(eventsPath);
      const phaseStart = events.find(e => e.event === 'phase_start');
      expect(phaseStart.preset).toMatchObject({
        id: expect.any(String),
        runner: expect.stringMatching(/^(claude|codex)$/),
        model: expect.any(String),
        effort: expect.any(String),
      });
    } finally {
      cleanup();
    }
  });
```

Inside `describe('handleGatePhase — gate_verdict emission (APPROVE)', …)` (around line 862), add:

```ts
  it('emits gate_verdict with preset for phase 2', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 2 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(runGatePhase).mockResolvedValueOnce({
      type: 'verdict',
      verdict: 'APPROVE',
      comments: '',
      runner: 'codex',
      durationMs: 100,
      tokensTotal: 1000,
      promptBytes: 500,
      codexSessionId: 'test-session',
      recoveredFromSidecar: false,
      resumedFrom: null,
      resumeFallback: false,
      sourcePreset: { model: 'gpt-5.4', effort: 'high' },
    } as any);

    try {
      await handleGatePhase(2, state, HDIR, runDir, CWD, createNoOpInputManager(), logger, { value: false });
      const events = readEvents(eventsPath);
      const verdict = events.find(e => e.event === 'gate_verdict');
      expect(verdict.preset).toMatchObject({
        id: expect.any(String),
        runner: 'codex',
        model: expect.any(String),
        effort: expect.any(String),
      });
    } finally {
      cleanup();
    }
  });
```

And one gate_error variant inside `describe('handleGatePhase — gate_error emission', …)` (around line 1123):

```ts
  it('emits gate_error with preset for phase 2', async () => {
    const runDir = makeTmpDir();
    const state = makeState({ currentPhase: 2 });
    const { logger, eventsPath, cleanup } = makeTestLogger(state.runId);

    vi.mocked(runGatePhase).mockResolvedValueOnce({
      type: 'error',
      error: 'timeout',
      runner: 'codex',
      exitCode: null,
      durationMs: 360_000,
      tokensTotal: 0,
      codexSessionId: undefined,
      recoveredFromSidecar: false,
      resumedFrom: null,
      resumeFallback: false,
      sourcePreset: { model: 'gpt-5.4', effort: 'high' },
    } as any);

    try {
      await handleGatePhase(2, state, HDIR, runDir, CWD, createNoOpInputManager(), logger, { value: false });
      const events = readEvents(eventsPath);
      const err = events.find(e => e.event === 'gate_error');
      expect(err.preset).toMatchObject({
        id: expect.any(String),
        runner: 'codex',
        model: expect.any(String),
        effort: expect.any(String),
      });
    } finally {
      cleanup();
    }
  });
```

Note: before writing, skim the existing gate_verdict tests (lines 862-1030) to copy the exact fixture shape (`makeState`, `mockResolvedValueOnce`, etc.) — the mocked return value must satisfy the type, which I gave a best-effort snapshot of above. If `GatePhaseResult` fields have drifted, line up with the currently-passing tests rather than this plan's snapshot.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm vitest run tests/phases/runner.test.ts -t 'preset' 2>&1 | tail -30
```

Expected: 3 FAIL (preset field not yet attached to any event).

- [ ] **Step 3: Extend the LogEvent union**

In `src/types.ts`, at the `phase_start` variant (around line 175), add the optional `preset` field. Replace:

```ts
  | (LogEventBase & { event: 'phase_start'; phase: number; attemptId?: string | null; reopenFromGate?: number | null; retryIndex?: number })
```

with:

```ts
  | (LogEventBase & {
      event: 'phase_start';
      phase: number;
      attemptId?: string | null;
      reopenFromGate?: number | null;
      retryIndex?: number;
      preset?: { id: string; runner: 'claude' | 'codex'; model: string; effort: string };
    })
```

At the `gate_verdict` variant (around line 176-189), add the same `preset?` field at the end of the shape. At `gate_error` (around line 190-203), do the same.

- [ ] **Step 4: Attach preset to phase_start in `handleInteractivePhase`**

In `src/phases/runner.ts`, find the `logger.logEvent({ event: 'phase_start', phase, attemptId, reopenFromGate });` call (line 219 before this edit) and resolve the preset just above it. Use the existing `getPresetById` import (already used elsewhere in the file).

```ts
  const preset = (() => {
    const id = state.phasePresets[String(phase)];
    const p = getPresetById(id);
    return p ? { id: p.id, runner: p.runner, model: p.model, effort: p.effort } : undefined;
  })();
  logger.logEvent({ event: 'phase_start', phase, attemptId, reopenFromGate, preset });
```

(If `getPresetById` is not yet imported in `runner.ts`, add it to the existing `from '../config.js'` import at the top of the file. Check the imports block before assuming.)

- [ ] **Step 5: Attach preset to gate_verdict and gate_error in `handleGatePhase`**

In `src/phases/runner.ts`, locate `handleGatePhase` (around line 340). There are three `logger.logEvent(...)` calls inside that function:
1. `event: 'gate_verdict'` on APPROVE (around line 365).
2. `event: 'gate_verdict'` on REJECT (around line 411).
3. `event: 'gate_error'` on error (around line 431).

Resolve the preset once near the top of `handleGatePhase` (after `state.phases[String(phase)] = 'in_progress'; writeState(...);`):

```ts
  const gatePresetMeta = (() => {
    const id = state.phasePresets[String(phase)];
    const p = getPresetById(id);
    return p ? { id: p.id, runner: p.runner, model: p.model, effort: p.effort } : undefined;
  })();
```

Then add `preset: gatePresetMeta,` to each of the three `logger.logEvent({ … })` objects (inside the existing shape, immediately after the existing `resumeFallback: …,` line — keep the order readable).

- [ ] **Step 6: Run the preset tests**

Run:

```bash
pnpm vitest run tests/phases/runner.test.ts -t 'preset' 2>&1 | tail -30
```

Expected: 3 PASS.

- [ ] **Step 7: Run the full runner + gate suites**

Run:

```bash
pnpm vitest run tests/phases/runner.test.ts tests/phases/gate.test.ts tests/phases/gate-resume.test.ts 2>&1 | tail -30
```

Expected: all green. The existing `phase_start` / `gate_verdict` / `gate_error` tests continue to pass — we only added a new optional field, did not change existing field values.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/phases/runner.ts tests/phases/runner.test.ts
git commit -m "$(cat <<'EOF'
feat(logging): attach preset to phase_start + gate_verdict/gate_error

Post-hoc analysis of a harness run previously couldn't attribute
wall-time or tokens to a specific preset on interactive phases — the
event log only carried `runner` on gate verdicts and nothing at all on
phase_start. This change adds an optional `preset: { id, runner, model,
effort }` object to:

- phase_start (phases 1/3/5) — resolved via getPresetById from the
  caller's state.phasePresets.
- gate_verdict / gate_error (phases 2/4/7) — same resolution inside
  handleGatePhase.

Verify phase 6 is unchanged (harness-verify.sh has no preset).

Backwards-compatible: optional field, existing parsers ignore it.
Observed need: the 2026-04-18 dog-fooding run showed that we cannot
cleanly measure Phase-1 Opus-xHigh cost vs Phase-3 Sonnet-high cost
from events.jsonl alone — this closes that gap.
EOF
)"
```

---

## Task 5: Final verification + build + rebase check

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run:

```bash
pnpm vitest run 2>&1 | tail -30
```

Expected: all tests pass. No snapshot drift, no newly-skipped tests. If anything outside the files we touched fails, stop and investigate — it means one of our prompt/type changes had an unexpected ripple.

- [ ] **Step 2: Typecheck**

Run:

```bash
pnpm tsc --noEmit 2>&1 | tail -20
```

Expected: no errors. `pnpm lint` is an alias for this per `CLAUDE.md` — do not run both.

- [ ] **Step 3: Rebuild dist/**

Run:

```bash
pnpm build 2>&1 | tail -10
```

Expected: `tsc` + `scripts/copy-assets.mjs` complete. `dist/src/context/prompts/phase-{1,3,5}.md` should contain the new `HARNESS FLOW CONSTRAINT` stanza.

Verify:

```bash
grep -c "HARNESS FLOW CONSTRAINT" dist/src/context/prompts/phase-*.md
```

Expected: each of the three prompt files reports `1`.

- [ ] **Step 4: Rebase check**

Run:

```bash
git fetch origin main
git log --oneline HEAD..origin/main | cat
```

Expected: empty output (no new commits on main since Task 0). If there are new commits, `git rebase origin/main` and re-run Task 5 Step 1-3 before opening the PR.

- [ ] **Step 5: Commit the rebuilt dist (if tracked)**

`dist/` is listed in `.gitignore` per `CLAUDE.md`. Verify:

```bash
git status -s dist/ 2>&1 | head
```

Expected: no output. If `dist/` is tracked, include it in the final commit; otherwise skip.

- [ ] **Step 6: Open the PR**

```bash
git push -u origin new-experiment
```

Then create a PR via `gh pr create` with the title `fix: gate prompt hardening + phase-start logging` and a body that lists:
- the three bugs (BUG-A, B, C) with their observed locations,
- the logging enhancement,
- a link to the spec and plan docs,
- the test plan (check each task's commit).

---

## Deferred / out-of-scope (explicitly not in this PR)

- Phase 1 default preset tuning (`opus-max` → `opus-high`).
- Skill-load-time reduction (separate investigation).
- Isolating `HOME` when spawning Codex to skip `~/.codex/AGENTS.md` globally.
- Per-phase Claude token accounting (not just Codex).
- Pane-width readability at narrow terminals.
- `harness-verify.sh` repeated `pip install` per check — a plan-prompt improvement, not a gate-prompt issue.
