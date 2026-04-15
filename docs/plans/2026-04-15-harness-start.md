# harness start Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `harness run` with `harness start` as the primary entry command, with optional task arg and in-tmux readline prompt when task is omitted.

**Architecture:** Rename `run.ts` → `start.ts`, make task optional, add readline prompt in `inner.ts` when task is empty. Signal handlers deferred until after task capture.

**Tech Stack:** TypeScript (ESM, Node16), vitest, readline (Node built-in), commander.

**Related spec:** `docs/specs/2026-04-15-harness-start-design.md` (v3, approved)

---

## Scope coverage check

| Spec section | Task |
|---|---|
| ADR-1: start as primary, run as alias | Task 1 (bin/harness.ts) |
| ADR-2: readline-based input | Task 2 (inner.ts) |
| ADR-3: task input in __inner | Task 2 (inner.ts) |
| ADR-4: empty task init + CLI normalization | Task 1 (start.ts) |
| ADR-5: welcome screen + pane focus | Task 2 (inner.ts), Task 3 (ui.ts) |
| ADR-6: empty/cancel input handling | Task 2 (inner.ts) |
| ADR-7: signal handler after task capture | Task 2 (inner.ts) |
| ADR-8: untitled runId preserved | No code change (existing behavior) |
| ADR-9: run also accepts no-arg | Task 1 (bin/harness.ts) |
| Message updates | Task 4 (list.ts, root.ts) |
| Testing | Task 5 |

---

## File Structure

### Rename
- `src/commands/run.ts` → `src/commands/start.ts`

### Modify
- `bin/harness.ts` — `start [task]` + `run [task]` alias
- `src/commands/start.ts` — task optional, trim normalization, empty task allowed
- `src/commands/inner.ts` — readline prompt, signal handler deferral, cancel cleanup
- `src/ui.ts` — `renderWelcome()` function
- `src/commands/list.ts` — message update
- `src/root.ts` — message update
- `tests/commands/run.test.ts` — import path update

---

## Task 1: Rename run → start + CLI registration

**Files:**
- Rename: `src/commands/run.ts` → `src/commands/start.ts`
- Modify: `bin/harness.ts`
- Modify: `src/commands/start.ts`

- [ ] **Step 1: Rename the file**

```bash
git mv src/commands/run.ts src/commands/start.ts
```

- [ ] **Step 2: Update exports in start.ts**

In `src/commands/start.ts`, rename the function and make task optional:

Change line 14-18:
```typescript
export interface StartOptions {
  allowDirty?: boolean;
  auto?: boolean;
  root?: string;
}
```

Change line 20:
```typescript
export async function startCommand(task: string | undefined, options: StartOptions = {}): Promise<void> {
```

Change lines 21-25 (task validation). Replace:
```typescript
  if (!task || task.trim() === '') {
    process.stderr.write('Error: task description cannot be empty.\n');
    process.exit(1);
  }
```
With:
```typescript
  const normalizedTask = task?.trim() || '';
```

Then replace all subsequent references to `task` with `normalizedTask` in the function. The key places:
- `generateRunId(normalizedTask)` call
- `writeFileSync(taskMdPath, normalizedTask)` call
- state initialization: use `normalizedTask`

- [ ] **Step 3: Update bin/harness.ts**

Replace the entire run command block (lines 19-27) and add start:

```typescript
import { startCommand } from '../src/commands/start.js';

program
  .command('start [task]')
  .description('start a new harness session')
  .option('--allow-dirty', 'allow unstaged/untracked changes at start')
  .option('--auto', 'autonomous mode (no user escalations)')
  .action(async (task: string | undefined, opts: { allowDirty?: boolean; auto?: boolean }) => {
    const globalOpts = program.opts();
    await startCommand(task, { ...opts, root: globalOpts.root });
  });

program
  .command('run [task]')
  .description('alias for start')
  .option('--allow-dirty', 'allow unstaged/untracked changes at start')
  .option('--auto', 'autonomous mode (no user escalations)')
  .action(async (task: string | undefined, opts: { allowDirty?: boolean; auto?: boolean }) => {
    const globalOpts = program.opts();
    await startCommand(task, { ...opts, root: globalOpts.root });
  });
```

Remove the old `import { runCommand }` line.

- [ ] **Step 4: Run lint**

```bash
pnpm run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/commands/start.ts bin/harness.ts
git commit -m "feat: rename run→start, make task optional, add run alias"
```

---

## Task 2: Inner readline prompt + signal handler deferral

**Files:**
- Modify: `src/commands/inner.ts`

- [ ] **Step 1: Add readline import**

At the top of `inner.ts`, add:

```typescript
import { createInterface } from 'readline';
```

- [ ] **Step 2: Add task prompt function**

Add before `innerCommand`:

```typescript
type PromptResult =
  | { kind: 'task'; value: string }
  | { kind: 'empty' }
  | { kind: 'eof' }
  | { kind: 'interrupt' };

async function promptForTask(): Promise<PromptResult> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });

  return new Promise<PromptResult>((resolve) => {
    let answered = false;

    // Ctrl-C
    rl.on('SIGINT', () => {
      answered = true;
      rl.close();
      resolve({ kind: 'interrupt' });
    });

    rl.question('  > ', (answer) => {
      answered = true;
      rl.close();
      const trimmed = answer.trim();
      resolve(trimmed ? { kind: 'task', value: trimmed } : { kind: 'empty' });
    });

    // Ctrl-D (EOF) — 'close' fires without question callback
    rl.on('close', () => {
      if (!answered) {
        resolve({ kind: 'eof' });
      }
    });
  });
}
```

- [ ] **Step 3: Restructure innerCommand — task prompt before signal handlers**

In `innerCommand`, after pane setup and before signal handler registration, add:

```typescript
  // Check if task is empty → prompt user (ADR-3, ADR-5)
  const taskMdPath = join(runDir, 'task.md');
  const existingTask = fs.readFileSync(taskMdPath, 'utf-8').trim();

  if (!existingTask) {
    // Ensure control pane has focus for readline (ADR-5)
    if (state.tmuxControlPane) {
      selectPane(state.tmuxSession, state.tmuxControlPane);
    }

    renderWelcome(state.runId);

    // Cancellation cleanup helper (ADR-6)
    function cancelAndExit(): never {
      process.stderr.write('\nHarness cancelled.\n');
      fs.rmSync(runDir, { recursive: true, force: true });
      clearCurrentRun(harnessDir); // reset current-run pointer
      releaseLock(harnessDir, runId);
      if (state.tmuxMode === 'dedicated') {
        killSession(state.tmuxSession);
      } else if (state.tmuxControlWindow) {
        killWindow(state.tmuxSession, state.tmuxControlWindow);
      }
      process.exit(0);
    }

    // Task input loop
    let capturedTask = '';
    while (!capturedTask) {
      const result = await promptForTask();
      switch (result.kind) {
        case 'task':
          capturedTask = result.value;
          break;
        case 'empty':
          process.stderr.write('  Task cannot be empty. Please enter a task description:\n');
          break;
        case 'eof':
        case 'interrupt':
          cancelAndExit();
      }
    }

    // Persist task to state AND task.md (ADR-4)
    state.task = capturedTask;
    fs.writeFileSync(taskMdPath, capturedTask);
    writeState(runDir, state);
  }

  // NOW register signal handlers (ADR-7: after task capture)
  registerSignalHandlers({ ... });
```

Move the existing `registerSignalHandlers()` call to AFTER this block. The signal handler registration that was previously near the top must be relocated.

Add import for `clearCurrentRun`:
```typescript
import { findHarnessRoot, clearCurrentRun } from '../root.js';
```

- [ ] **Step 4: Add selectPane import**

Add to tmux imports:
```typescript
import { killSession, killWindow, selectWindow, splitPane, paneExists, selectPane } from '../tmux.js';
```

Add ui import:
```typescript
import { renderWelcome } from '../ui.js';
```

- [ ] **Step 5: Run lint**

```bash
pnpm run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/commands/inner.ts
git commit -m "feat: readline task prompt in inner + deferred signal handlers"
```

---

## Task 3: UI — renderWelcome function

**Files:**
- Modify: `src/ui.ts`

- [ ] **Step 1: Add renderWelcome**

At the end of `src/ui.ts`, add:

```typescript
export function renderWelcome(runId: string): void {
  const SEPARATOR = '━'.repeat(50);
  process.stdout.write('\x1b[2J\x1b[H'); // clear screen
  console.error(SEPARATOR);
  console.error(`${GREEN}▶${RESET} Harness`);
  console.error(SEPARATOR);
  console.error(`  Run: ${runId}`);
  console.error('');
  console.error('  What would you like to build?');
}
```

- [ ] **Step 2: Run lint**

```bash
pnpm run lint
```

- [ ] **Step 3: Commit**

```bash
git add src/ui.ts
git commit -m "feat: add renderWelcome for task input screen"
```

---

## Task 4: Message updates (list.ts, root.ts)

**Files:**
- Modify: `src/commands/list.ts`
- Modify: `src/root.ts`

- [ ] **Step 1: Update list.ts messages**

Replace all `'harness run "task"'` with `'harness start "task"'` in `src/commands/list.ts` (lines 26, 36, 68).

- [ ] **Step 2: Update root.ts messages**

In `src/root.ts`:
- Line 44: `"harness run"` → `"harness start"`
- Line 76: `"harness run"` → `"harness start"`

- [ ] **Step 3: Run lint**

```bash
pnpm run lint
```

- [ ] **Step 4: Commit**

```bash
git add src/commands/list.ts src/root.ts
git commit -m "fix: update user-facing messages from 'harness run' to 'harness start'"
```

---

## Task 5: Tests

**Files:**
- Modify: `tests/commands/run.test.ts`

- [ ] **Step 1: Update import path**

Change:
```typescript
import { runCommand } from '../../src/commands/run.js';
```
To:
```typescript
import { startCommand } from '../../src/commands/start.js';
```

Replace all `runCommand(` calls with `startCommand(`.

- [ ] **Step 2: Update test descriptions (optional but cleaner)**

Rename `describe('runCommand', ...)` to `describe('startCommand', ...)`.

- [ ] **Step 3: Add start-specific tests**

```typescript
it('starts with empty task when task is undefined', async () => {
  await startCommand(undefined, { allowDirty: true });
  // Verify: state.json created with empty task string
  // Verify: task.md is empty or contains empty string
  // Verify: no exit(1) — empty task is allowed
});

it('normalizes whitespace-only task to empty', async () => {
  await startCommand('   ', { allowDirty: true });
  // Verify: treated same as undefined task (normalizedTask === '')
});

it('starts normally with non-empty task', async () => {
  await startCommand('Add dark mode', { allowDirty: true });
  // Verify: state.json has task='Add dark mode'
  // Verify: task.md contains 'Add dark mode'
});
```

- [ ] **Step 4: Add inner readline tests (tests/commands/inner.test.ts)**

Add tests for the new readline flow:

```typescript
describe('task prompt in inner', () => {
  it('skips prompt when task.md has content', async () => {
    // Write task.md with content before calling innerCommand
    // Assert: promptForTask NOT called, phase loop starts immediately
  });

  it('prompts when task.md is empty', async () => {
    // Write empty task.md
    // Mock readline to return a task
    // Assert: state.task updated, task.md written, phase loop starts
  });
});
```

- [ ] **Step 4: Run full test suite**

```bash
pnpm test
```

- [ ] **Step 5: Run lint + build**

```bash
pnpm run lint
pnpm run build
```

- [ ] **Step 6: Commit**

```bash
git add tests/commands/run.test.ts
git commit -m "test: update tests for start command rename + empty task handling"
```

---

## Eval checklist

```json
{
  "checks": [
    { "name": "Type check", "command": "pnpm run lint" },
    { "name": "All tests pass", "command": "pnpm test" },
    { "name": "Build succeeds", "command": "pnpm run build" },
    { "name": "CLI start help", "command": "node dist/bin/harness.js start --help" },
    { "name": "CLI run help (alias)", "command": "node dist/bin/harness.js run --help" },
    { "name": "start.ts exists", "command": "test -f src/commands/start.ts" },
    { "name": "run.ts removed", "command": "test ! -f src/commands/run.ts" },
    { "name": "startCommand exported", "command": "grep -q 'startCommand' src/commands/start.ts" },
    { "name": "task is optional in start", "command": "grep -q 'task.*undefined\\|\\[task\\]' bin/harness.ts" },
    { "name": "run alias registered", "command": "grep -q \"command('run\" bin/harness.ts" },
    { "name": "renderWelcome exists", "command": "grep -q 'renderWelcome' src/ui.ts" },
    { "name": "readline in inner.ts", "command": "grep -q 'readline\\|createInterface' src/commands/inner.ts" },
    { "name": "list.ts uses harness start", "command": "grep -q 'harness start' src/commands/list.ts" },
    { "name": "root.ts uses harness start", "command": "grep -q 'harness start' src/root.ts" },
    { "name": "no harness run in list.ts", "command": "! grep -q 'harness run' src/commands/list.ts" },
    { "name": "no harness run in root.ts", "command": "! grep -q 'harness run' src/root.ts" },
    { "name": "inner.ts has selectPane for focus", "command": "grep -q 'selectPane' src/commands/inner.ts" },
    { "name": "inner.ts has cancelAndExit or cancel cleanup", "command": "grep -q 'cancelled\\|cancelAndExit\\|rmSync.*runDir' src/commands/inner.ts" },
    { "name": "signal handlers after task capture", "command": "grep -B5 'registerSignalHandlers' src/commands/inner.ts | grep -q 'task\\|writeState'" }
  ]
}
```

---

## Task dependencies

```
Task 1 (rename + CLI)     ← foundation
Task 2 (inner readline)   ← depends on Task 1
Task 3 (ui.ts)            ← independent (can parallel with 1)
Task 4 (messages)         ← independent (can parallel with 1)
Task 5 (tests)            ← depends on all
```

Parallel groups:
- Group A: Tasks 1, 3, 4 (disjoint files)
- Group B (after 1): Task 2
- Group C: Task 5 (final)
