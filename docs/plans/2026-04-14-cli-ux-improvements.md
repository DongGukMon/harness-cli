# CLI UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 UX issues from first real usage: bypass permissions, effort flag, sentinel auto-kill, terminal clear.

**Architecture:** Surgical changes to 4 source files + 3 prompt templates + 1 new conformance test. No new modules or architectural changes.

**Tech Stack:** TypeScript (ESM, Node16), vitest, chokidar (existing).

**Related spec:** `docs/specs/2026-04-14-cli-ux-improvements-design.md`

---

## Scope coverage check

| Spec section | Task |
|---|---|
| §1 Spawn args (`--dangerously-skip-permissions`) | Task 1 |
| §2 `PHASE_EFFORTS` config | Task 1 |
| §3 Sentinel auto-kill | Task 2 |
| §4 Terminal clear | Task 3 |
| §5 Prompt guardrails | Task 4 |
| Testing | Task 5 |

---

## File Structure

### Modified
- `src/config.ts` — add `PHASE_EFFORTS`
- `src/phases/interactive.ts` — spawn args + sentinel auto-kill in `waitForPhaseCompletion`
- `src/phases/runner.ts` — terminal clear before `printPhaseTransition`
- `src/context/prompts/phase-1.md` — sentinel guardrail
- `src/context/prompts/phase-3.md` — sentinel guardrail
- `src/context/prompts/phase-5.md` — sentinel guardrail
- `tests/phases/interactive.test.ts` — spawn args assertion + sentinel auto-kill test
- `tests/conformance/phase-models.test.ts` — extend with `PHASE_EFFORTS` conformance

### Created
- None

---

## Task 1: Config + Spawn args (`--dangerously-skip-permissions` + `--effort`)

**Files:**
- Modify: `src/config.ts:1-5`
- Modify: `src/phases/interactive.ts:177`

- [ ] **Step 1: Add `PHASE_EFFORTS` to config**

In `src/config.ts`, add after `PHASE_MODELS`:

```typescript
export const PHASE_EFFORTS: Record<number, string> = {
  1: 'max',
  3: 'high',
  5: 'high',
};
```

- [ ] **Step 2: Update spawn args in `interactive.ts`**

In `src/phases/interactive.ts`, add import for `PHASE_EFFORTS`:

```typescript
import { PHASE_MODELS, PHASE_EFFORTS, PHASE_ARTIFACT_FILES, SIGTERM_WAIT_MS } from '../config.js';
```

Replace line 177:

```typescript
const child = spawn('claude', ['--model', PHASE_MODELS[phase], '@' + path.resolve(promptFile)], {
```

With:

```typescript
const child = spawn('claude', [
  '--dangerously-skip-permissions',
  '--model', PHASE_MODELS[phase],
  '--effort', PHASE_EFFORTS[phase],
  '@' + path.resolve(promptFile),
], {
```

- [ ] **Step 3: Run lint**

```bash
pnpm run lint
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/config.ts src/phases/interactive.ts
git commit -m "feat: add --dangerously-skip-permissions and --effort to claude spawn args"
```

---

## Task 2: Sentinel auto-kill

**Files:**
- Modify: `src/phases/interactive.ts:252-260` (the `waitForPhaseCompletion` function)

- [ ] **Step 1: Read current `waitForPhaseCompletion`**

The function is at `src/phases/interactive.ts:217-280`. Note the chokidar watcher setup at lines 252-260.

- [ ] **Step 2: Replace chokidar event handlers with sentinel-triggered kill**

In `waitForPhaseCompletion`, replace the current watcher event handlers:

```typescript
watcher.on('add', () => evaluateCompletion());
watcher.on('change', () => evaluateCompletion());
```

With:

```typescript
function onSentinelDetected(): void {
  if (settled) return;
  const freshness = checkSentinelFreshness(sentinelPath, attemptId);
  if (freshness === 'fresh') {
    // Sentinel confirmed — kill Claude so exit handler triggers evaluation
    child.kill('SIGTERM');
  }
}

watcher.on('add', onSentinelDetected);
watcher.on('change', onSentinelDetected);
```

The flow is: chokidar detects sentinel → `child.kill('SIGTERM')` → Claude exits → `child.on('exit')` fires → `evaluateCompletion()` runs → sentinel re-verified + artifacts validated → settle.

- [ ] **Step 3: Run existing tests**

```bash
pnpm test tests/phases/interactive.test.ts
```

Expected: all existing tests still pass. The existing ordering test's mock spawn emits `exit` via `setImmediate`, which fires before any chokidar events, so the auto-kill path is not triggered in existing tests.

- [ ] **Step 4: Commit**

```bash
git add src/phases/interactive.ts
git commit -m "feat: sentinel detection triggers SIGTERM to auto-close Claude session"
```

---

## Task 3: Terminal clear before phase transition

**Files:**
- Modify: `src/phases/runner.ts:236, 279, 525`

- [ ] **Step 1: Add terminal clear before each `printPhaseTransition` call**

There are 3 call sites in `src/phases/runner.ts`. Before each `printPhaseTransition(...)` call, add a terminal clear:

**Line 236** (interactive phase completion):

```typescript
    // Clear Claude's TUI residue before showing transition banner
    process.stdout.write('\x1b[2J\x1b[H');
    printPhaseTransition(phase, next, phaseLabel(phase) + ' — 완료', phaseLabel(next));
```

**Line 279** (gate phase APPROVED):

```typescript
        process.stdout.write('\x1b[2J\x1b[H');
        printPhaseTransition(phase, next, phaseLabel(phase) + ' — APPROVED', phaseLabel(next));
```

**Line 525** (verify phase PASS):

```typescript
    process.stdout.write('\x1b[2J\x1b[H');
    printPhaseTransition(6, 7, phaseLabel(6) + ' — PASS', phaseLabel(7));
```

- [ ] **Step 2: Run lint**

```bash
pnpm run lint
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/phases/runner.ts
git commit -m "feat: clear terminal before phase transition banners"
```

---

## Task 4: Prompt sentinel guardrails

**Files:**
- Modify: `src/context/prompts/phase-1.md`
- Modify: `src/context/prompts/phase-3.md`
- Modify: `src/context/prompts/phase-5.md`

- [ ] **Step 1: Update phase-1.md**

Replace the sentinel instruction (currently the last paragraph mentioning `phase-1.done`). The full file becomes:

```
다음 파일에서 태스크 설명을 읽고 요구사항을 분석한 뒤 설계 스펙과 Decision Log를 작성하라:
- Task: {{task_path}}
{{#if feedback_path}}
- 이전 리뷰 피드백 (반드시 반영): {{feedback_path}}
{{/if}}

spec을 {{spec_path}}에, decision log를 {{decisions_path}}에 저장하고,
`.harness/{{runId}}/phase-1.done` 파일을 생성하되 내용으로 '{{phaseAttemptId}}' 한 줄만 기록하라.

**CRITICAL: sentinel 파일(phase-1.done)은 모든 작업(파일 작성, git commit 포함)이 완료된 후 가장 마지막에 생성하라. sentinel 생성 즉시 이 세션이 자동 종료된다. sentinel 이후에는 어떤 작업도 실행되지 않는다.**

spec 문서는 "{{spec_path}}" 경로에 작성하고, 상단에 "## Context & Decisions" 섹션을 포함하라.
decisions.md는 "{{decisions_path}}" 경로에 작성하라.
```

- [ ] **Step 2: Update phase-3.md**

Full file:

```
다음 파일을 읽고 컨텍스트를 파악한 뒤 구현 계획을 작성하라:
- Spec: {{spec_path}}
- Decision Log: {{decisions_path}}
{{#if feedback_path}}
- 이전 리뷰 피드백 (반드시 반영): {{feedback_path}}
{{/if}}

plan을 {{plan_path}}에 저장하고,
eval checklist를 {{checklist_path}}에 아래 JSON 스키마로 저장하라:
```json
{
  "checks": [
    { "name": "<검증 항목 이름>", "command": "<실행 커맨드>" }
  ]
}
```
`checks` 배열은 비어있지 않아야 하며 각 항목에 `name`(string)과 `command`(string)이 필수다.

`.harness/{{runId}}/phase-3.done` 파일을 생성하되 내용으로 '{{phaseAttemptId}}' 한 줄만 기록하라.

**CRITICAL: sentinel 파일(phase-3.done)은 모든 작업(파일 작성, git commit 포함)이 완료된 후 가장 마지막에 생성하라. sentinel 생성 즉시 이 세션이 자동 종료된다. sentinel 이후에는 어떤 작업도 실행되지 않는다.**
```

- [ ] **Step 3: Update phase-5.md**

Full file:

```
다음 파일을 읽고 컨텍스트를 파악한 뒤 구현을 진행하라:
- Spec: {{spec_path}}
- Plan: {{plan_path}}
- Decision Log: {{decisions_path}}
- Checklist: {{checklist_path}}
{{#if feedback_paths}}
{{feedback_paths}}
{{/if}}

각 태스크 완료 시 반드시 변경사항을 git commit하라. commit 없이 세션을 종료하면 eval gate에서 변경분을 볼 수 없어 run이 실패한다.

구현 완료 후 `.harness/{{runId}}/phase-5.done` 파일을 생성하되 내용으로 '{{phaseAttemptId}}' 한 줄만 기록하라.

**CRITICAL: sentinel 파일(phase-5.done)은 모든 작업(파일 작성, git commit 포함)이 완료된 후 가장 마지막에 생성하라. sentinel 생성 즉시 이 세션이 자동 종료된다. sentinel 이후에는 어떤 작업도 실행되지 않는다.**
```

- [ ] **Step 4: Run build to verify prompts copy correctly**

```bash
pnpm run build
```

Expected: `[copy-assets]` output shows prompts copied.

- [ ] **Step 5: Commit**

```bash
git add src/context/prompts/phase-1.md src/context/prompts/phase-3.md src/context/prompts/phase-5.md
git commit -m "feat: add sentinel guardrail warning to all phase prompts"
```

---

## Task 5: Tests + Verification

**Files:**
- Modify: `tests/conformance/phase-models.test.ts` — add `PHASE_EFFORTS` tests
- Modify: `tests/phases/interactive.test.ts` — add spawn args + sentinel kill tests

- [ ] **Step 1: Add `PHASE_EFFORTS` conformance tests**

Append to `tests/conformance/phase-models.test.ts`:

```typescript
import { PHASE_EFFORTS } from '../../src/config.js';

describe('PHASE_EFFORTS conformance', () => {
  it('Phase 1 uses max effort', () => {
    expect(PHASE_EFFORTS[1]).toBe('max');
  });

  it('Phase 3 uses high effort', () => {
    expect(PHASE_EFFORTS[3]).toBe('high');
  });

  it('Phase 5 uses high effort', () => {
    expect(PHASE_EFFORTS[5]).toBe('high');
  });

  it('defines exactly three entries (for phases 1, 3, 5)', () => {
    expect(Object.keys(PHASE_EFFORTS).sort()).toEqual(['1', '3', '5']);
  });
});
```

- [ ] **Step 2: Add spawn args test to `interactive.test.ts`**

In the existing `runInteractivePhase — advisor reminder fires before spawn` describe block, add a new test after the existing one:

```typescript
  it('spawn args include --dangerously-skip-permissions and --effort', async () => {
    const { spawn } = await import('child_process');
    const { runInteractivePhase } = await import('../../src/phases/interactive.js');

    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();
    const repoDir = createTestRepo();
    const state = makeState();

    vi.mocked(spawn as ReturnType<typeof vi.fn>).mockClear();

    await runInteractivePhase(1, state, harnessDir, runDir, repoDir);

    const spawnArgs = vi.mocked(spawn as ReturnType<typeof vi.fn>).mock.calls[0];
    const args: string[] = spawnArgs[1];

    expect(args).toContain('--dangerously-skip-permissions');
    expect(args).toContain('--effort');
    // Phase 1 → max effort
    const effortIdx = args.indexOf('--effort');
    expect(args[effortIdx + 1]).toBe('max');
  });
```

- [ ] **Step 3: Add sentinel auto-kill test**

In the same describe block, add:

```typescript
  it('kills child on fresh sentinel detection', async () => {
    const { spawn } = await import('child_process');
    const { runInteractivePhase } = await import('../../src/phases/interactive.js');

    const runDir = makeTmpDir();
    const harnessDir = makeTmpDir();
    const repoDir = createTestRepo();
    const state = makeState();

    // Override spawn mock: do NOT auto-emit 'exit' — let sentinel auto-kill trigger it
    const killFn = vi.fn();
    const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
    vi.mocked(spawn as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      const cp = {
        pid: 99999,
        on: (event: string, cb: (...a: unknown[]) => void) => {
          (listeners[event] ||= []).push(cb);
          return cp;
        },
        kill: killFn.mockImplementation(() => {
          // Simulate SIGTERM causing exit
          for (const cb of listeners['exit'] ?? []) {
            setImmediate(() => cb(null, 'SIGTERM'));
          }
        }),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        stdin: { end: vi.fn(), write: vi.fn() },
      };
      return cp;
    });

    // Start the phase — it will wait for sentinel
    const resultPromise = runInteractivePhase(1, state, harnessDir, runDir, repoDir);

    // Give chokidar time to set up, then write the sentinel file
    await new Promise((r) => setTimeout(r, 200));
    const attemptId = state.phaseAttemptId['1'] ?? '';
    const sentinelPath = path.join(runDir, 'phase-1.done');
    fs.writeFileSync(sentinelPath, attemptId);

    const result = await resultPromise;

    // child.kill should have been called with SIGTERM
    expect(killFn).toHaveBeenCalledWith('SIGTERM');
  });
```

- [ ] **Step 4: Run all tests**

```bash
pnpm test
```

Expected: all tests pass including new ones.

- [ ] **Step 5: Run lint**

```bash
pnpm run lint
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add tests/conformance/phase-models.test.ts tests/phases/interactive.test.ts
git commit -m "test: spawn args conformance + sentinel auto-kill assertion"
```

---

## Eval checklist

```json
{
  "checks": [
    { "name": "Type check", "command": "pnpm run lint" },
    { "name": "All tests pass", "command": "pnpm test" },
    { "name": "Build succeeds", "command": "pnpm run build" },
    { "name": "Spawn includes --dangerously-skip-permissions",
      "command": "grep -q 'dangerously-skip-permissions' src/phases/interactive.ts" },
    { "name": "Spawn includes --effort",
      "command": "grep -q \"'--effort', PHASE_EFFORTS\" src/phases/interactive.ts" },
    { "name": "PHASE_EFFORTS exported from config",
      "command": "grep -q 'PHASE_EFFORTS' src/config.ts" },
    { "name": "Sentinel auto-kill uses SIGTERM",
      "command": "grep -q \"child.kill('SIGTERM')\" src/phases/interactive.ts" },
    { "name": "Terminal clear before phase transition",
      "command": "grep -c '\\\\x1b\\[2J' src/phases/runner.ts | grep -q '[3-9]'" },
    { "name": "Phase 1 prompt contains sentinel guardrail",
      "command": "grep -q 'sentinel 생성 즉시' src/context/prompts/phase-1.md" },
    { "name": "Phase 3 prompt contains sentinel guardrail",
      "command": "grep -q 'sentinel 생성 즉시' src/context/prompts/phase-3.md" },
    { "name": "Phase 5 prompt contains sentinel guardrail",
      "command": "grep -q 'sentinel 생성 즉시' src/context/prompts/phase-5.md" }
  ]
}
```

---

## Task dependencies

```
Task 1 (config + spawn args)     — independent
Task 2 (sentinel auto-kill)      — independent (same file as Task 1 but different function)
Task 3 (terminal clear)          — independent (runner.ts only)
Task 4 (prompt guardrails)       — independent (prompt files only)
Task 5 (tests)                   — depends on Tasks 1-4
```

Parallel groups:
- Group A (parallel): Tasks 1, 2, 3, 4
- Group B (after all): Task 5
