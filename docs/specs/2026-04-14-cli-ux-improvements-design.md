# harness-cli UX Improvements — Design Spec

- Date: 2026-04-14
- Status: Approved
- Scope: 4 targeted UX fixes based on first real usage feedback

---

## Context & Decisions

### Why this work

User tested `harness run` for the first time and reported 4 UX issues:
1. Claude spawns without `--dangerously-skip-permissions`, so every tool call requires manual approval — breaking the automated workflow.
2. No `--effort` flag passed to Claude — Phase 1 (brainstorming with Opus 4.6 1M context) runs at default effort instead of max.
3. After Claude writes the sentinel file, the Claude session stays alive waiting for user input. The harness CLI appears stuck because it waits for `child.on('exit')` which only fires when the user manually types `/exit`.
4. When Claude does exit, the terminal still shows Claude's full-screen TUI residue with no visible phase transition.

### Decisions

**[ADR-1] `--dangerously-skip-permissions` is added unconditionally to all interactive phase spawns.**
- No opt-out flag in this iteration. Harness sessions are autonomous by design.

**[ADR-2] `PHASE_EFFORTS` config mirrors `PHASE_MODELS` — one effort level per interactive phase.**
- Phase 1: `max` (brainstorming needs deepest reasoning)
- Phase 3: `high` (plan writing)
- Phase 5: `high` (implementation)

**[ADR-3] Sentinel detection triggers immediate SIGTERM to Claude (Option A).**
- chokidar already watches for the sentinel file. On fresh sentinel detection → `child.kill('SIGTERM')`.
- This is safe because the sentinel file IS the "all work done" contract. Writing it before completion is a prompt bug, not a system design issue.
- Phase prompts are strengthened to explicitly state: sentinel must be the absolute last action, and the session will terminate immediately after.
- The existing `child.on('exit')` → `evaluateCompletion()` flow remains unchanged — SIGTERM causes exit which triggers the existing evaluation pipeline.

**[ADR-4] Terminal clear (`\x1b[2J\x1b[H`) before phase transition banner.**
- Clears Claude's TUI residue so the harness banner is visible on a clean screen.
- Applied in runner.ts at each phase boundary, not in interactive.ts (separation of concerns).

---

## Design

### 1. Spawn args update (`src/phases/interactive.ts`)

Current (line 177):
```typescript
spawn('claude', ['--model', PHASE_MODELS[phase], '@' + path.resolve(promptFile)], ...)
```

New:
```typescript
spawn('claude', [
  '--dangerously-skip-permissions',
  '--model', PHASE_MODELS[phase],
  '--effort', PHASE_EFFORTS[phase],
  '@' + path.resolve(promptFile),
], { stdio: 'inherit', detached: true, cwd })
```

Import `PHASE_EFFORTS` from `../config.js`.

### 2. `PHASE_EFFORTS` config (`src/config.ts`)

```typescript
export const PHASE_EFFORTS: Record<number, string> = {
  1: 'max',
  3: 'high',
  5: 'high',
};
```

### 3. Sentinel auto-kill (`src/phases/interactive.ts`)

In `waitForPhaseCompletion`, modify the chokidar `add`/`change` handler:

```typescript
function onSentinelDetected(): void {
  const freshness = checkSentinelFreshness(sentinelPath, attemptId);
  if (freshness === 'fresh') {
    child.kill('SIGTERM');
    // SIGTERM → child exits → child.on('exit') fires → evaluateCompletion()
    // The existing flow handles the rest.
  }
}

watcher.on('add', onSentinelDetected);
watcher.on('change', onSentinelDetected);
```

Remove the existing `watcher.on('add', () => evaluateCompletion())` / `watcher.on('change', () => evaluateCompletion())` — those are replaced by `onSentinelDetected`.

The `evaluateCompletion` function remains unchanged. It still requires `childExited === true`, which will become true via the SIGTERM → exit chain.

### 4. Terminal clear (`src/phases/runner.ts`)

Before each `printPhaseTransition(...)` call in the runner's phase loop, add:

```typescript
process.stdout.write('\x1b[2J\x1b[H');
```

This clears the screen and moves cursor to top-left, removing Claude's TUI residue.

### 5. Prompt guardrail strengthening (`src/context/prompts/phase-{1,3,5}.md`)

Add to the end of each phase prompt, immediately before or as part of the sentinel instruction:

> **CRITICAL: sentinel 파일은 모든 작업(파일 작성, git commit 포함)이 완료된 후 가장 마지막에 생성하세요. sentinel 생성 즉시 이 세션이 자동 종료됩니다. sentinel 이후에는 어떤 작업도 실행되지 않습니다.**

---

## File-level change list

### Modify
- `src/config.ts` — add `PHASE_EFFORTS`
- `src/phases/interactive.ts` — spawn args + sentinel auto-kill in `waitForPhaseCompletion`
- `src/phases/runner.ts` — terminal clear before `printPhaseTransition`
- `src/context/prompts/phase-1.md` — sentinel guardrail text
- `src/context/prompts/phase-3.md` — sentinel guardrail text
- `src/context/prompts/phase-5.md` — sentinel guardrail text

### Create
- None

### Delete
- None

---

## Testing

- **Unit**: conformance test for `PHASE_EFFORTS` (mirrors existing `PHASE_MODELS` test)
- **Unit**: `waitForPhaseCompletion` — mock chokidar sentinel event, assert `child.kill('SIGTERM')` is called
- **Unit**: spawn args test — assert `--dangerously-skip-permissions` and `--effort` are in the args array
- **Source grep**: phase prompts contain sentinel guardrail text
- **Smoke**: `scripts/smoke-preflight.sh` still passes (spawn args change shouldn't break preflight)

---

## Success criteria

1. `pnpm test` passes with new conformance + unit tests
2. `pnpm run lint` clean
3. Phase prompts all contain sentinel guardrail text
4. Spawn args include `--dangerously-skip-permissions` and `--effort <level>`
5. Sentinel detection triggers `child.kill('SIGTERM')` (verified by unit test)
