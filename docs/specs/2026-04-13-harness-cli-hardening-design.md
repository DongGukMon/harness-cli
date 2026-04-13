# harness-cli Hardening — Design Spec

- Date: 2026-04-13
- Status: Draft
- Scope: Stabilize harness-cli for local usage (NOT npm publish)
- Source of insights: `docs/process/reports/2026-04-13-harness-session-retrospective.md`

---

## Context & Decisions

### Why this work

In the previous `harness run` attempt against this very repo, the CLI hung for over 4 hours because the preflight's `claudeAtFile` check called `claude --print ''` with no timeout — `--print` mode never returned a response. The process sat in `ps` output with 0% CPU, silently blocking the entire run before Phase 1 could even start.

This exposed three categories of problems that must be resolved before the CLI is usable as `pnpm link --global` (or eventually `npm install -g`):

1. **Preflight can hang forever** — any spawned subprocess in preflight needs a timeout boundary.
2. **Advisor reminder is inherently fragile** — the CLI cannot activate `/advisor` (it's an in-session command), so the current `printAdvisorReminder` output is a text prompt for the developer. It needs to be visible at the right moment and contain correct Claude Code CLI syntax.
3. **`harness-verify.sh` location assumption breaks portability** — spec hardcoded `~/.claude/scripts/harness-verify.sh`, which only works on developer machines where the skill was previously installed. Any clean machine (or future npm install target) fails preflight.

Additionally, the retrospective (`docs/process/reports/2026-04-13-harness-session-retrospective.md`) identified a systemic issue during Phase 5 implementation: subagents silently drifted from spec for string-exact values (notably `src/state.ts` writing `docs/reports/...` instead of `docs/process/evals/...`). This was not caught by unit tests and surfaced only 2+ hours later when the path was actually accessed. Conformance tests that tie spec constants to code constants would have caught it immediately.

### Decisions

**[ADR-1] Preflight `claudeAtFile` keeps the check but adds a 5-second timeout and demotes failures to warnings.**
- Alternative considered: remove the check entirely (spec already labels it "weak-signal / best-effort").
- Rejected because the weak signal still has diagnostic value in unusual environments (old Claude CLI versions). A warning that does not block execution is more useful than complete removal.
- Runtime failures in Phase 1/3/5 still cause the phase to be marked `failed`, as already specified — this is the authoritative safety net.

**[ADR-2] Advisor reminder stays as stderr output (current approach) but the trigger moment moves to immediately before `claude` is spawned, and the message text is corrected to match actual Claude Code CLI syntax.**
- Alternative considered: write reminder to `.harness/<runId>/REMINDER.md` for later lookup.
- Rejected: adds state complexity for marginal UX benefit. Developer who misses the stderr line can re-read it by scrolling up, since `stdio: 'inherit'` preserves terminal scrollback. File-based reminder does not survive Claude's full-screen UI taking over.
- Alternative considered: embed reminder into the init prompt so Claude itself tells the user.
- Rejected: Claude reliably mentions external shell commands in prose, but enforcing `/advisor` via prompt text conflates model instruction with human UX.

**[ADR-3] `harness-verify.sh` resolution order is: package-local first, legacy fallback second. `src/phases/verify.ts` must use the same resolver as `src/preflight.ts`.**
- Current bug: `src/phases/verify.ts` hardcodes `path.join(os.homedir(), '.claude', 'scripts', 'harness-verify.sh')` even though `src/preflight.ts` already has `resolveVerifyScriptPath()` with the correct two-tier lookup.
- Consolidation: extract `resolveVerifyScriptPath()` to a shared module or export from `preflight.ts` so `verify.ts` imports it. Single source of truth.

**[ADR-4] Conformance tests cover three categories: artifact paths, `PHASE_MODELS`, and preflight item sets per phase type.**
- These are the three places where subagent drift (as observed in retrospective Case 3) or future refactor drift is most likely to produce silent bugs.
- Test format: read spec-defined constants from code, compare against canonical values hard-coded in the test (duplicated source of truth in test = intentional). When spec changes, both locations update together.

**[ADR-5] This work explicitly excludes npm publish.**
- User directive: "지금 npm publish는 고려하지마"
- All npm-specific work (package name finalization, `.npmignore`, README publish section, CI/CD workflows) deferred.
- `package.json` metadata already present (description/files/engines) is retained — it doesn't hurt local use.

**[ADR-6] Gate round limits and subagent-timeout detection from the retrospective are NOT in this scope.**
- The retrospective's `Gate round limit auto-force-pass` is a harness-SKILL concern (the orchestrator driving phase transitions), not a harness-CLI one. The CLI already exits on user SIGINT; it does not self-manage review loops.
- Subagent timeout detection is likewise a skill-level concern. The CLI has no awareness of subagents — it just spawns Claude and reads the sentinel.
- Adding these now would create CLI features that don't map to anything in the actual use case.

---

## Scope

### In scope

1. Preflight `claudeAtFile` hang fix (add 5s timeout, demote to warning)
2. Advisor reminder text correction + trigger timing
3. `harness-verify.sh` resolver consolidation (verify.ts uses preflight.ts's resolver)
4. Conformance tests: artifact paths, `PHASE_MODELS`, preflight items per phase type

### Out of scope

- npm publish, package rename, `.npmignore`, CI/CD
- Gate round limit / auto-force-pass (harness-skill concern)
- Subagent timeout detection (harness-skill concern)
- UI redesign for escalation/error menus
- New phases or phase reordering
- Large-scale refactor of `runner.ts` / `resume.ts`

---

## Design

### 1. Preflight `claudeAtFile` hardening

**Current code** (`src/preflight.ts`, the `claudeAtFile` case):
```typescript
execSync(`claude --model claude-sonnet-4-6 @${tmpFile} --print '' 2>&1`, {
  stdio: 'pipe',
  encoding: 'utf-8',
});
```
No `timeout` option → `execSync` waits indefinitely. If Claude CLI's `--print` mode blocks (as observed), the whole preflight blocks.

**Change**:
1. Replace `execSync` with an explicit `spawnSync` call that can be hard-killed:
   ```typescript
   const result = spawnSync('claude', ['--model', 'claude-sonnet-4-6', `@${tmpFile}`, '--print', ''], {
     stdio: 'pipe',
     encoding: 'utf-8',
     timeout: 5000,
     killSignal: 'SIGKILL',   // hard kill on timeout — no waiting for graceful SIGTERM exit
   });
   ```
   `killSignal: 'SIGKILL'` ensures that if `claude --print` ignores SIGTERM (the root cause of the original 4-hour hang), the process is forcibly terminated after 5s with no further wait.
2. Detection of timeout uses `result.error` with error code `'ETIMEDOUT'`, OR `result.signal === 'SIGKILL'`. On either condition, treat as timeout and:
   - Print one-line warning to stderr: `⚠️  preflight: claude @file check timed out (5s); skipping — runtime failure will be surfaced at phase level if @file is unsupported.`
   - Return normally from the check.
3. On non-timeout failure (`result.status !== 0` with no `error`/`signal`), retain existing warning behavior.
4. Clean up the temp file in a `finally` block.
5. **Not** using `execSync` — Node's `execSync` with `timeout` sends SIGTERM and still waits for graceful exit; processes that ignore SIGTERM (observed behavior of `claude --print` in the original bug) cause unbounded hangs. `spawnSync` + `killSignal: 'SIGKILL'` is the reliable hard stop.

**Rationale**: 5 seconds is generous for a weak-signal environment probe. Any timeout here means either the installed Claude version has a bug or an environment is misbehaving — neither warrants blocking the entire run, because Phase 1/3/5 failure paths already handle runtime `@file` misbehavior.

**Testing**: unit test with a mocked `execSync` that throws a timeout-shaped error, assert the function returns normally and writes to stderr.

### 2. Advisor reminder fine-tune

**Current implementation** problem (confirmed by code inspection):
- `printAdvisorReminder(phase)` is called at `src/phases/runner.ts:203` inside `handleInteractivePhase`, which is BEFORE `runInteractivePhase` is invoked.
- Actual `spawn('claude', ...)` happens inside `src/phases/interactive.ts:174`, AFTER prompt file preparation and state writes.
- Result: reminder prints early, then many lines of "state saved" etc. scroll by, and finally Claude takes the terminal — reminder is already off-screen.

**Changes**:

1. **Move the reminder call into the spawn path.** Delete the call from `src/phases/runner.ts:203` (or the equivalent line after code search). Add it to `src/phases/interactive.ts:runInteractivePhase`, specifically:
   - AFTER `preparePhase(...)` returns (state is written, artifacts cleaned)
   - AFTER the init prompt file is written to disk
   - IMMEDIATELY BEFORE the `spawn('claude', ...)` line (currently around `src/phases/interactive.ts:174`)
   - Add `await new Promise(r => setTimeout(r, 300))` after the reminder print so the stderr line has time to render before Claude's UI takes over.

2. **Correct the command text** in `src/ui.ts`. Current `/advisor on` may not match the actual Claude Code slash command. Verify and correct to the canonical invocation.
   - Verification step during implementation: check the local Claude CLI (run `claude --help` or inspect docs) for the exact advisor slash command syntax.
   - If the exact syntax cannot be confirmed, use the safer generic phrasing: `claude 세션에서 /advisor 를 입력해 설정을 확인하세요.`

3. **Phase-specific framing**: `printAdvisorReminder(phase)` already takes a phase number; expand the text to mention phase purpose:
   - Phase 1: "Brainstorming에서 advisor가 설계 트레이드오프 자문에 유용합니다."
   - Phase 3: "Plan 작성에서 advisor가 태스크 분해 판단에 유용합니다."
   - Phase 5: "구현에서 advisor가 복잡 로직 판단에 유용합니다."

4. **Do not add any file output.** Reminder is stderr-only per [ADR-2].

**Testing** — the authoritative test must prove the reminder prints at the spawn seam, not merely somewhere in the runner:

- Add a new unit test in `tests/phases/interactive.test.ts`:
  - Mock `printAdvisorReminder` AND `spawn` from `child_process` (via `vi.mock`).
  - Track call order via `vi.fn().mock.invocationCallOrder`.
  - Assert: `printAdvisorReminder.mock.invocationCallOrder[0] < spawn.mock.invocationCallOrder[0]`.
  - Assert: `printAdvisorReminder` is called with the correct phase argument.
- Additionally, update `tests/phases/runner.test.ts` to remove any assertion that `printAdvisorReminder` is called from `runner.ts` — the call site is moving, so existing tests that verify runner-level invocation must be updated.

### 3. `harness-verify.sh` resolver consolidation

**Current state (verified via code inspection)**:
- `src/preflight.ts` already exports `resolveVerifyScriptPath()` with two-tier lookup: package-local (`<__dirname>/../scripts/harness-verify.sh`) → legacy `~/.claude/scripts/harness-verify.sh`.
- `src/phases/verify.ts:104` already imports and calls `resolveVerifyScriptPath()`. The hardcoded `~/.claude` path has already been removed.
- `scripts/copy-assets.mjs` already copies `scripts/harness-verify.sh → dist/scripts/harness-verify.sh` with executable permission.
- The source consolidation is complete. This section is therefore **verification-only**, not a code change.

**Changes in this spec**: none to source code. Only add tests (below) to lock the behavior and prevent future regression.

**Testing**:
- Unit test for `resolveVerifyScriptPath()` that mocks BOTH `existsSync` and `accessSync` (the resolver gates on executable access via `R_OK | X_OK`, not just existence):
  - package-local exists AND accessible, legacy irrelevant → returns package-local
  - package-local exists but NOT accessible (accessSync throws), legacy exists + accessible → returns legacy
  - package-local absent, legacy exists + accessible → returns legacy
  - both absent → returns null
  - both present but neither accessible → returns null
  Alternative to mocking: write temp files with explicit `chmod` 0o755 / 0o644 (non-executable) to drive the four cases without mocks. Either approach is acceptable; pick whichever keeps the test readable.
- Unit test for `verify.ts` asserting it uses `resolveVerifyScriptPath()` (spy the import).

### 4. Conformance tests

Three new test files. Each test compares a code-level constant against a hard-coded canonical value defined inline. The intent is that if spec or code drifts, the test must be updated — making the drift visible in review.

**`tests/conformance/artifacts.test.ts`**

Imports `createInitialState` from `src/state.ts`. Constructs a state with `runId = 'test-run'` and asserts:
```typescript
expect(state.artifacts.spec).toBe('docs/specs/test-run-design.md');
expect(state.artifacts.plan).toBe('docs/plans/test-run.md');
expect(state.artifacts.decisionLog).toBe('.harness/test-run/decisions.md');
expect(state.artifacts.checklist).toBe('.harness/test-run/checklist.json');
expect(state.artifacts.evalReport).toBe('docs/process/evals/test-run-eval.md');
```

**`tests/conformance/phase-models.test.ts`**

Imports `PHASE_MODELS` from `src/config.ts` and asserts exact mapping:
```typescript
expect(PHASE_MODELS[1]).toBe('claude-opus-4-6');
expect(PHASE_MODELS[3]).toBe('claude-sonnet-4-6');
expect(PHASE_MODELS[5]).toBe('claude-sonnet-4-6');
```
Additionally asserts no keys for gate (2, 4, 7) or verify (6) phases — these shouldn't spawn Claude.

**Not adding a separate preflight-items conformance test.** `tests/preflight.test.ts` already contains exact assertions for `getPreflightItems` per phase type — duplicating them under `tests/conformance/` adds maintenance cost without new protection. Artifact paths and `PHASE_MODELS` DO need conformance coverage because no such asserts currently exist.

---

## File-level change list

### Modify
- `src/preflight.ts` — replace `execSync` call for `claudeAtFile` with `spawnSync + killSignal: 'SIGKILL' + timeout: 5000`, demote timeout failures to warning, temp-file cleanup in `finally`.
- `src/ui.ts` — update `printAdvisorReminder` message text and per-phase framing.
- `src/phases/runner.ts` — remove the existing `printAdvisorReminder(phase)` call.
- `src/phases/interactive.ts` — add `printAdvisorReminder(phase)` immediately before `spawn('claude', ...)`, followed by a 300ms delay.
- (no change required for `src/phases/verify.ts` — consolidation already complete in tree)

### Create
- `tests/conformance/artifacts.test.ts`
- `tests/conformance/phase-models.test.ts`
- (preflight items already covered by `tests/preflight.test.ts` — no new conformance file needed)

### No change
- `scripts/copy-assets.mjs` (already correct)
- `package.json` (already has npm metadata, not publishing yet)
- All spec / plan / eval report / retrospective docs under `docs/`
- `src/state.ts`, `src/config.ts`, `src/lock.ts`, `src/phases/interactive.ts`, `src/phases/gate.ts` beyond the targeted lines

### Delete
- None

---

## Testing strategy

### Unit tests (new)
- 3 conformance test files per "Conformance tests" section above
- Preflight timeout test: `tests/preflight.test.ts` gets one new case. In ESM, `src/preflight.ts` imports `spawnSync` directly from `child_process`, so a top-level `vi.mock('child_process', ...)` is required (vi.spyOn on the direct import does not intercept reliably in our setup). The mock makes `spawnSync` return `{ error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }), status: null, signal: 'SIGKILL' }`. Assert: `runPreflight(['claudeAtFile'])` does NOT throw and writes the warning to stderr.
  - Alternative to the module-level mock: extract `spawnSync` into a thin injectable helper inside `preflight.ts` so the test can pass a fake. Pick whichever keeps the test compact.
- Verify path resolution test: `tests/phases/verify.test.ts` gets one new case asserting the resolver is consulted (via spy).

### Unit tests (modified)
- `tests/phases/runner.test.ts` — remove existing assertions that `printAdvisorReminder` is invoked from the runner (those assertions will be stale after the call moves into `interactive.ts`).
- `tests/phases/interactive.test.ts` — add a new case asserting the reminder-before-spawn ordering at the actual spawn seam (described in "Advisor reminder fine-tune > Testing" above).

### Integration
- No new integration tests. Existing `tests/integration/lifecycle.test.ts` continues to cover the CLI surface end-to-end.

### Manual smoke test (post-implementation)
- `harness --help` — generic CLI sanity check (no hardened code paths here; just confirms binary is wired).
- In a clean temp directory: `git init && git commit --allow-empty -m init`, then run `harness run "smoke test" --allow-dirty`. This actually exercises preflight.
  - Must reach Phase 1 in under 10 seconds (preflight should NOT stall).
  - The `claudeAtFile` check must either succeed quickly or time out in 5s and print the warning.
  - After Phase 1 Claude spawns, the advisor reminder line must be the last stderr output immediately preceding Claude's UI takeover.
  - Immediately Ctrl-C after Claude appears, verify lock + state cleanup via `harness status` and `harness list`.

---

## Migration / rollout

### Backward compatibility
- `~/.claude/scripts/harness-verify.sh` legacy fallback is retained. Existing installations work unchanged.
- Advisor reminder is cosmetic; existing users see improved text but no behavior change.
- Preflight `claudeAtFile` timeout is a strict improvement — previously hanging installs now proceed.

### Rollback
- Every change is confined to four source files + three new test files. A single `git revert <commit>` removes them if issues surface.

### No data migration required
- No `.harness/` on-disk format changes. Existing runs remain resumable.

---

## Success criteria

1. `pnpm test` passes, including 3 new conformance test files and modified existing tests.
2. `pnpm run lint` (tsc --noEmit) passes with no errors.
3. `pnpm run build` produces `dist/` with `dist/scripts/harness-verify.sh` executable.
4. Manual smoke test: `harness run "test"` in a clean temp dir progresses past preflight in under 10 seconds (no hang).
5. `src/phases/verify.ts` contains no hardcoded `~/.claude` reference — verified as already true; conformance preserved by added test.
6. `printAdvisorReminder` message text matches actual Claude Code slash command syntax or uses the safe fallback phrasing.

---

## Risks

**R1: Claude Code's advisor slash command may have syntax we cannot confirm from this environment.**
- Mitigation: fall back to generic phrasing ("/advisor 를 세션에서 확인하세요") rather than guess a specific command. Document assumption in `src/ui.ts` comment.

**R2: `execSync` timeout error shape across Node versions.**
- Mitigation: check `err.signal === 'SIGTERM'` OR `err.killed === true` OR `err.code === 'ETIMEDOUT'`. Accept any of the three as the timeout signal.

**R3: `resolveVerifyScriptPath()` path computation may differ when running via `pnpm link` vs `node dist/bin/harness.js`.**
- Mitigation: implementation uses `path.dirname(fileURLToPath(import.meta.url))` which always resolves to the compiled file's directory, stable across invocation methods.

**R4: Conformance tests lock down spec constants and could feel brittle.**
- Mitigation: intentional. If a spec constant legitimately changes, updating both the code and the conformance test is the point — it forces a conscious edit rather than silent drift.

---

## Out of scope (explicit)

- **npm publish preparation** — deferred per user directive.
- **Gate round-limit auto-pass / subagent-timeout detection** — harness-skill concerns, not CLI.
- **New resume recovery paths / new pendingAction types** — current paths are sufficient for observed scenarios.
- **UI overhaul** — escalation menus remain as-is.
- **Signal handler extensions** — already covers SIGINT/SIGTERM.
- **Spec overhaul** — the 1,200-line design spec is accepted as-is; no retrofit of retrospective's "exact strings section" recommendation.
