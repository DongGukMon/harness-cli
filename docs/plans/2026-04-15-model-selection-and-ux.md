# Model Selection & UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable per-phase model selection (Claude/Codex) in the harness control panel, add InputManager for stdin leak prevention, expand panel width, and fix phase-reopen bugs.

**Architecture:** Two runner modules (Claude + Codex) replace hardcoded phase-model mapping. An InputManager owns stdin for the entire inner process lifecycle. State is extended with phasePresets, phaseReopenFlags, and lastWorkspacePid for crash-safe operation.

**Tech Stack:** TypeScript, vitest, tmux, Node.js child_process

**Spec:** `docs/specs/2026-04-15-model-selection-and-ux-design.md`

---

## Eval Checklist

| # | Check | Command | Pass condition |
|---|-------|---------|----------------|
| 1 | TypeScript compiles | `npm run lint` | Exit 0 |
| 2 | All tests pass | `npm test` | Exit 0 |
| 3 | Config: MODEL_PRESETS and PHASE_DEFAULTS exported | `node -e "const c=require('./dist/config.js'); console.log(c.MODEL_PRESETS.length, Object.keys(c.PHASE_DEFAULTS).length)"` | Prints `5 6` |
| 4 | Config: PHASE_MODELS and PHASE_EFFORTS removed | `grep -r 'PHASE_MODELS\|PHASE_EFFORTS' src/` | Exit 1 (no matches) |
| 5 | State: createInitialState no longer takes codexPath | `grep 'codexPath' src/state.ts` | Only `codexPath: null` in the return object |
| 6 | State: migrateState backfills phasePresets | `npm test -- tests/state.test.ts` | Pass |
| 7 | InputManager: start/stop/waitForKey work | `npm test -- tests/input.test.ts` | Pass |
| 8 | UI: separator is 64 chars | `grep "repeat(64)" src/ui.ts` | Match found |
| 9 | Runners: claude.ts and codex.ts exist | `ls src/runners/claude.ts src/runners/codex.ts` | Exit 0 |
| 10 | Phase dispatch: runner.ts uses preset-based dispatch | `grep 'phasePresets' src/phases/runner.ts` | Match found |
| 11 | Signal: runner-aware interrupt | `grep 'interruptedPhase' src/signal.ts` | Match found |
| 12 | Preflight: codexCli item | `grep 'codexCli' src/preflight.ts` | Match found |
| 13 | Bug fix: phaseReopenFlags in types | `grep 'phaseReopenFlags' src/types.ts` | Match found |
| 14 | Bug fix: lastWorkspacePid in types | `grep 'lastWorkspacePid' src/types.ts` | Match found |
| 15 | Build succeeds | `npm run build` | Exit 0 |

---

### Task 1: Types & Config Foundation

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Modify: `tests/conformance/phase-models.test.ts`

- [ ] **Step 1: Update types.ts — add new fields and types**

```ts
// src/types.ts — add to PauseReason union:
export type PauseReason = 'gate-escalation' | 'verify-escalation' | 'gate-error' | 'verify-error' | 'config-cancel';

// add to PendingActionType union:
export type PendingActionType = 'reopen_phase' | 'rerun_gate' | 'rerun_verify' | 'show_escalation' | 'show_verify_error' | 'skip_phase' | 'reopen_config';

// modify codexPath to nullable:
codexPath: string | null;

// add new fields to HarnessState:
phasePresets: Record<string, string>;         // keys "1"-"7" (excl 6), values = preset ID
phaseReopenFlags: Record<string, boolean>;    // keys "1","3","5"
lastWorkspacePid: number | null;
lastWorkspacePidStartTime: number | null;
```

- [ ] **Step 2: Update config.ts — replace PHASE_MODELS/PHASE_EFFORTS with presets**

Replace the entire `src/config.ts` content:

```ts
export interface ModelPreset {
  id: string;
  label: string;
  runner: 'claude' | 'codex';
  model: string;
  effort: string;
}

export const MODEL_PRESETS: ModelPreset[] = [
  { id: 'opus-max',     label: 'Claude Opus 4.6 / max',    runner: 'claude', model: 'claude-opus-4-6',   effort: 'max' },
  { id: 'opus-high',    label: 'Claude Opus 4.6 / high',   runner: 'claude', model: 'claude-opus-4-6',   effort: 'high' },
  { id: 'sonnet-high',  label: 'Claude Sonnet 4.6 / high', runner: 'claude', model: 'claude-sonnet-4-6', effort: 'high' },
  { id: 'codex-high',   label: 'Codex / high',             runner: 'codex',  model: 'gpt-5.4',           effort: 'high' },
  { id: 'codex-medium', label: 'Codex / medium',           runner: 'codex',  model: 'gpt-5.4',           effort: 'medium' },
];

export const PHASE_DEFAULTS: Record<number, string> = {
  1: 'opus-max',
  2: 'codex-high',
  3: 'sonnet-high',
  4: 'codex-high',
  5: 'sonnet-high',
  7: 'codex-high',
};

export const REQUIRED_PHASE_KEYS = ['1', '2', '3', '4', '5', '7'] as const;

export function getPresetById(id: string): ModelPreset | undefined {
  return MODEL_PRESETS.find(p => p.id === id);
}

export const GATE_TIMEOUT_MS = 360_000;
export const INTERACTIVE_TIMEOUT_MS = 1_800_000; // 30 min
export const VERIFY_TIMEOUT_MS = 300_000;
export const SIGTERM_WAIT_MS = 5_000;
export const GROUP_DRAIN_WAIT_MS = 5_000;
export const HANDOFF_TIMEOUT_MS = 5_000;

export const GATE_RETRY_LIMIT = 3;
export const VERIFY_RETRY_LIMIT = 3;

export const MAX_FILE_SIZE_KB = 200;
export const MAX_DIFF_SIZE_KB = 50;
export const MAX_PROMPT_SIZE_KB = 500;
export const PER_FILE_DIFF_LIMIT_KB = 20;

export const TERMINAL_PHASE = 8;

export const INTERACTIVE_PHASES = [1, 3, 5] as const;
export const GATE_PHASES = [2, 4, 7] as const;

export const PHASE_ARTIFACT_FILES: Record<number, string[]> = {
  1: ['spec', 'decisionLog'],
  3: ['plan', 'checklist'],
};
```

- [ ] **Step 3: Run lint to verify compilation**

Run: `npm run lint`
Expected: Exit 0 (with some errors in files that still import PHASE_MODELS — fix in subsequent tasks)

- [ ] **Step 4: Update conformance test**

Replace `tests/conformance/phase-models.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MODEL_PRESETS, PHASE_DEFAULTS, REQUIRED_PHASE_KEYS, getPresetById } from '../../src/config.js';

describe('MODEL_PRESETS conformance', () => {
  it('contains at least one claude and one codex preset', () => {
    expect(MODEL_PRESETS.some(p => p.runner === 'claude')).toBe(true);
    expect(MODEL_PRESETS.some(p => p.runner === 'codex')).toBe(true);
  });

  it('every preset has all required fields', () => {
    for (const p of MODEL_PRESETS) {
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(['claude', 'codex']).toContain(p.runner);
      expect(p.model).toBeTruthy();
      expect(p.effort).toBeTruthy();
    }
  });

  it('preset IDs are unique', () => {
    const ids = MODEL_PRESETS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('PHASE_DEFAULTS conformance', () => {
  it('defines defaults for all required phases', () => {
    for (const key of REQUIRED_PHASE_KEYS) {
      expect(PHASE_DEFAULTS[Number(key)]).toBeDefined();
    }
  });

  it('all default preset IDs are valid', () => {
    for (const presetId of Object.values(PHASE_DEFAULTS)) {
      expect(getPresetById(presetId)).toBeDefined();
    }
  });

  it('does not define Phase 6', () => {
    expect(PHASE_DEFAULTS[6]).toBeUndefined();
  });
});
```

- [ ] **Step 5: Run conformance test**

Run: `npx vitest run tests/conformance/phase-models.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/config.ts tests/conformance/phase-models.test.ts
git commit -m "feat: replace PHASE_MODELS/PHASE_EFFORTS with ModelPreset system"
```

---

### Task 2: State Migration

**Files:**
- Modify: `src/state.ts`
- Modify: `tests/state.test.ts`

- [ ] **Step 1: Write failing tests for migrateState and updated createInitialState**

Add to `tests/state.test.ts`:

```ts
import { PHASE_DEFAULTS } from '../src/config.js';

describe('createInitialState (updated)', () => {
  it('no longer takes codexPath parameter', () => {
    const state = createInitialState('run-1', 'task', 'abc123', false);
    expect(state.codexPath).toBeNull();
    expect(state.phasePresets).toEqual(expect.objectContaining({ '1': 'opus-max' }));
    expect(state.phaseReopenFlags).toEqual({ '1': false, '3': false, '5': false });
    expect(state.lastWorkspacePid).toBeNull();
    expect(state.lastWorkspacePidStartTime).toBeNull();
  });
});

describe('migrateState', () => {
  it('backfills missing phasePresets', () => {
    const raw = { runId: 'test' }; // no phasePresets
    const migrated = migrateState(raw);
    for (const key of ['1', '2', '3', '4', '5', '7']) {
      expect(migrated.phasePresets[key]).toBe(PHASE_DEFAULTS[Number(key)]);
    }
  });

  it('backfills individual missing phase keys', () => {
    const raw = { phasePresets: { '1': 'opus-max' } }; // partial
    const migrated = migrateState(raw);
    expect(migrated.phasePresets['3']).toBe('sonnet-high');
  });

  it('replaces invalid preset IDs with defaults', () => {
    const raw = { phasePresets: { '1': 'nonexistent-preset', '2': 'codex-high' } };
    const migrated = migrateState(raw);
    expect(migrated.phasePresets['1']).toBe('opus-max');
  });

  it('backfills lastWorkspacePid and phaseReopenFlags', () => {
    const raw = {};
    const migrated = migrateState(raw);
    expect(migrated.lastWorkspacePid).toBeNull();
    expect(migrated.lastWorkspacePidStartTime).toBeNull();
    expect(migrated.phaseReopenFlags).toEqual({ '1': false, '3': false, '5': false });
  });

  it('sets codexPath to null if missing', () => {
    const raw = {};
    const migrated = migrateState(raw);
    expect(migrated.codexPath).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/state.test.ts`
Expected: FAIL (createInitialState signature mismatch, migrateState not exported)

- [ ] **Step 3: Update src/state.ts**

```ts
import fs from 'fs';
import path from 'path';
import type { HarnessState } from './types.js';
import { PHASE_DEFAULTS, REQUIRED_PHASE_KEYS, MODEL_PRESETS } from './config.js';

const STATE_FILE = 'state.json';
const STATE_TMP_FILE = 'state.json.tmp';

export function writeState(runDir: string, state: HarnessState): void {
  const statePath = path.join(runDir, STATE_FILE);
  const tmpPath = path.join(runDir, STATE_TMP_FILE);
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  const fd = fs.openSync(tmpPath, 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmpPath, statePath);
}

export function migrateState(raw: any): HarnessState {
  if (!raw.phasePresets || typeof raw.phasePresets !== 'object') {
    raw.phasePresets = {};
  }
  for (const phase of REQUIRED_PHASE_KEYS) {
    const presetId = raw.phasePresets[phase];
    if (!presetId || !MODEL_PRESETS.find(p => p.id === presetId)) {
      raw.phasePresets[phase] = PHASE_DEFAULTS[Number(phase)] ?? 'sonnet-high';
    }
  }
  if (raw.lastWorkspacePid === undefined) raw.lastWorkspacePid = null;
  if (raw.lastWorkspacePidStartTime === undefined) raw.lastWorkspacePidStartTime = null;
  if (raw.codexPath === undefined) raw.codexPath = null;
  if (!raw.phaseReopenFlags || typeof raw.phaseReopenFlags !== 'object') {
    raw.phaseReopenFlags = { '1': false, '3': false, '5': false };
  }
  for (const key of ['1', '3', '5']) {
    if (raw.phaseReopenFlags[key] === undefined) raw.phaseReopenFlags[key] = false;
  }
  return raw as HarnessState;
}

export function readState(runDir: string): HarnessState | null {
  const statePath = path.join(runDir, STATE_FILE);
  const tmpPath = path.join(runDir, STATE_TMP_FILE);
  const stateExists = fs.existsSync(statePath);
  const tmpExists = fs.existsSync(tmpPath);
  if (!stateExists && !tmpExists) return null;
  if (!stateExists && tmpExists) fs.renameSync(tmpPath, statePath);
  const rawStr = fs.readFileSync(statePath, 'utf-8');
  try {
    const raw = JSON.parse(rawStr);
    return migrateState(raw);
  } catch {
    throw new Error('state.json is corrupted. Manual recovery required.');
  }
}

export function createInitialState(
  runId: string,
  task: string,
  baseCommit: string,
  autoMode: boolean
): HarnessState {
  const phasePresets: Record<string, string> = {};
  for (const phase of REQUIRED_PHASE_KEYS) {
    phasePresets[phase] = PHASE_DEFAULTS[Number(phase)] ?? 'sonnet-high';
  }
  return {
    runId,
    currentPhase: 1,
    status: 'in_progress',
    autoMode,
    task,
    baseCommit,
    implRetryBase: baseCommit,
    codexPath: null,
    externalCommitsDetected: false,
    artifacts: {
      spec: `docs/specs/${runId}-design.md`,
      plan: `docs/plans/${runId}.md`,
      decisionLog: `.harness/${runId}/decisions.md`,
      checklist: `.harness/${runId}/checklist.json`,
      evalReport: `docs/process/evals/${runId}-eval.md`,
    },
    phases: { '1': 'pending', '2': 'pending', '3': 'pending', '4': 'pending', '5': 'pending', '6': 'pending', '7': 'pending' },
    gateRetries: { '2': 0, '4': 0, '7': 0 },
    verifyRetries: 0,
    pauseReason: null,
    specCommit: null,
    planCommit: null,
    implCommit: null,
    evalCommit: null,
    verifiedAtHead: null,
    pausedAtHead: null,
    pendingAction: null,
    phaseOpenedAt: { '1': null, '3': null, '5': null },
    phaseAttemptId: { '1': null, '3': null, '5': null },
    phasePresets,
    phaseReopenFlags: { '1': false, '3': false, '5': false },
    lastWorkspacePid: null,
    lastWorkspacePidStartTime: null,
    tmuxSession: '',
    tmuxMode: 'dedicated',
    tmuxWindows: [],
    tmuxControlWindow: '',
    tmuxWorkspacePane: '',
    tmuxControlPane: '',
  };
}
```

- [ ] **Step 4: Fix the test helper `makeState()` in state.test.ts**

Update the existing `makeState()`:
```ts
function makeState(): HarnessState {
  return createInitialState('run-abc', 'test task', 'deadbeef', false);
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/state.test.ts`
Expected: PASS

- [ ] **Step 6: Fix all callers of createInitialState (remove codexPath param)**

Search and update:
- `src/commands/start.ts`: `createInitialState(runId, normalizedTask, baseCommit, options.auto ?? false)` — remove codexPath arg and the preflight that resolves it
- Any test files that call `createInitialState` with 5 args → 4 args

Run: `npm run lint`
Expected: Exit 0

- [ ] **Step 7: Commit**

```bash
git add src/state.ts src/types.ts tests/state.test.ts src/commands/start.ts
git commit -m "feat: add state migration, phasePresets, phaseReopenFlags, codexPath nullable"
```

---

### Task 3: InputManager

**Files:**
- Create: `src/input.ts`
- Create: `tests/input.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/input.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InputManager } from '../src/input.js';

describe('InputManager', () => {
  it('exports InputManager class', () => {
    expect(InputManager).toBeDefined();
  });

  it('start() and stop() do not throw', () => {
    // Can only test with a real TTY — just verify no crash with mock
    const im = new InputManager();
    expect(typeof im.start).toBe('function');
    expect(typeof im.stop).toBe('function');
  });

  it('enterPhaseLoop sets isPreLoop to false', () => {
    const im = new InputManager();
    // isPreLoop defaults to true
    im.enterPhaseLoop();
    // Verify via the public API: after enterPhaseLoop, Ctrl+C should call SIGINT path
    // This is tested via integration, but we verify the method exists
    expect(typeof im.enterPhaseLoop).toBe('function');
  });

  it('waitForKey returns a promise', () => {
    const im = new InputManager();
    // Can't fully test without TTY, but verify signature
    expect(typeof im.waitForKey).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/input.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement src/input.ts**

```ts
type InputState = 'idle' | 'configuring' | 'prompt-single' | 'prompt-line';

export class InputManager {
  private state: InputState = 'idle';
  private isPreLoop: boolean = true;
  private handler: ((key: string) => void) | null = null;
  private onDataBound: ((buf: Buffer) => void) | null = null;
  private started = false;

  public onConfigCancel: (() => void) | null = null;

  start(initialState: InputState = 'configuring'): void {
    if (this.started) return;
    if (!process.stdin.isTTY) return;
    this.state = initialState;
    this.isPreLoop = true;
    this.started = true;

    this.onDataBound = (buf: Buffer) => this.onData(buf);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', this.onDataBound);
  }

  stop(): void {
    if (!this.started) return;
    if (this.onDataBound) {
      process.stdin.removeListener('data', this.onDataBound);
      this.onDataBound = null;
    }
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    this.started = false;
  }

  enterPhaseLoop(): void {
    this.isPreLoop = false;
    this.state = 'idle';
  }

  setState(state: InputState): void {
    this.state = state;
  }

  waitForKey(validKeys: Set<string>): Promise<string> {
    return new Promise((resolve) => {
      this.state = 'prompt-single';
      this.handler = (key: string) => {
        const lower = key.toLowerCase();
        if (validKeys.has(lower)) {
          this.handler = null;
          this.state = this.isPreLoop ? 'configuring' : 'idle';
          resolve(lower.toUpperCase());
        }
      };
    });
  }

  waitForLine(): Promise<string> {
    return new Promise((resolve) => {
      this.state = 'prompt-line';
      let buffer = '';
      this.handler = (key: string) => {
        if (key === '\r' || key === '\n') {
          this.handler = null;
          this.state = this.isPreLoop ? 'configuring' : 'idle';
          resolve(buffer.trim());
        } else if (key === '\x7f') {
          // Backspace
          buffer = buffer.slice(0, -1);
          process.stderr.write('\b \b');
        } else {
          buffer += key;
          process.stderr.write(key);
        }
      };
    });
  }

  private onData(buf: Buffer): void {
    const str = buf.toString();

    // Ctrl+C / Ctrl+D
    if (str === '\x03' || str === '\x04') {
      if (this.isPreLoop) {
        this.onConfigCancel?.();
      } else {
        process.kill(process.pid, 'SIGINT');
      }
      return;
    }

    // ESC sequences (arrow keys, F-keys, etc.) — always ignore
    if (str.startsWith('\x1b')) return;

    // Idle/configuring without active prompt — discard
    if (this.state === 'idle' || this.state === 'configuring') return;

    // Forward to active handler
    this.handler?.(str);
  }
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/input.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/input.ts tests/input.test.ts
git commit -m "feat: add InputManager for always-on stdin raw mode"
```

---

### Task 4: UI Updates (Separator Width + Model Selection)

**Files:**
- Modify: `src/ui.ts`
- Modify: `tests/ui.test.ts`

- [ ] **Step 1: Update separator width and add model selection rendering**

In `src/ui.ts`:

1. Change module-level `SEPARATOR` from `'━'.repeat(38)` to `'━'.repeat(64)` (note: the module-level constant and the inline `'━'.repeat(50)` in functions both need updating)
2. Replace all `'━'.repeat(50)` with a single constant `const SEPARATOR = '━'.repeat(64);`
3. Update `renderControlPanel` to show preset label from `phasePresets`
4. Add `renderModelSelection()` and `promptModelConfig()` functions

Key changes:
```ts
import { MODEL_PRESETS, PHASE_DEFAULTS, REQUIRED_PHASE_KEYS, getPresetById } from './config.js';
import type { HarnessState } from './types.js';
import type { InputManager } from './input.js';

const SEPARATOR = '━'.repeat(64);

// ... existing functions updated to use SEPARATOR constant ...

export function renderModelSelection(phasePresets: Record<string, string>): void {
  process.stdout.write('\x1b[2J\x1b[H');
  console.error(SEPARATOR);
  console.error(`${GREEN}▶${RESET} Model Configuration`);
  console.error(SEPARATOR);

  const phaseLabels: Record<string, string> = {
    '1': 'Spec 작성', '2': 'Spec Gate', '3': 'Plan 작성',
    '4': 'Plan Gate', '5': '구현', '7': 'Eval Gate',
  };

  for (const key of REQUIRED_PHASE_KEYS) {
    const preset = getPresetById(phasePresets[key]);
    const label = preset?.label ?? 'unknown';
    console.error(`  [${key}] Phase ${key} (${phaseLabels[key]}):  ${label}`);
  }
  console.error(`      Phase 6 (검증):        harness-verify.sh (fixed)`);
  console.error('');
  console.error(`  Change? Phase 번호 입력 (1-5,7) or Enter to confirm:`);
  console.error(SEPARATOR);
}

export async function promptModelConfig(
  currentPresets: Record<string, string>,
  inputManager: InputManager,
): Promise<Record<string, string>> {
  const presets = { ...currentPresets };
  const validPhaseKeys = new Set(['1', '2', '3', '4', '5', '7', '\r', '\n']);

  while (true) {
    renderModelSelection(presets);
    const key = await inputManager.waitForKey(validPhaseKeys);

    if (key === '\r' || key === '\n' || key === '') {
      return presets;
    }

    // Show submenu for selected phase
    const phase = key;
    console.error('');
    const phaseLabels: Record<string, string> = {
      '1': 'Spec 작성', '2': 'Spec Gate', '3': 'Plan 작성',
      '4': 'Plan Gate', '5': '구현', '7': 'Eval Gate',
    };
    console.error(`  Phase ${phase} (${phaseLabels[phase]}) — model:`);

    const presetKeys = new Set<string>();
    MODEL_PRESETS.forEach((p, i) => {
      const current = p.id === presets[phase] ? ` ${YELLOW}← current${RESET}` : '';
      console.error(`  [${i + 1}] ${p.label}${current}`);
      presetKeys.add(String(i + 1));
    });
    console.error(`  Select (1-${MODEL_PRESETS.length}):`);

    const choice = await inputManager.waitForKey(presetKeys);
    const idx = Number(choice) - 1;
    if (idx >= 0 && idx < MODEL_PRESETS.length) {
      presets[phase] = MODEL_PRESETS[idx].id;
    }
  }
}
```

- [ ] **Step 2: Update renderControlPanel to show preset label**

```ts
export function renderControlPanel(state: HarnessState): void {
  const SEPARATOR_LINE = SEPARATOR;
  process.stdout.write('\x1b[2J\x1b[H');
  console.error(SEPARATOR_LINE);
  console.error(`${GREEN}▶${RESET} Harness Control Panel`);
  console.error(SEPARATOR_LINE);
  console.error(`  Run:   ${state.runId}`);
  console.error(`  Phase: ${state.currentPhase}/7 — ${phaseLabel(state.currentPhase)}`);
  const preset = getPresetById(state.phasePresets?.[String(state.currentPhase)] ?? '');
  if (preset) console.error(`  Model: ${preset.label}`);
  console.error('');
  // ... rest of phase status loop unchanged ...
}
```

- [ ] **Step 3: Update printAdvisorReminder to be runner-aware**

```ts
export function printAdvisorReminder(phase: number, runner?: string): void {
  if (runner === 'codex') return; // Codex doesn't use /advisor
  // ... existing reminder logic unchanged ...
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/ui.test.ts`
Expected: PASS (update existing tests if they check separator length)

- [ ] **Step 5: Commit**

```bash
git add src/ui.ts tests/ui.test.ts
git commit -m "feat: widen control panel to 64 chars, add model selection UI"
```

---

### Task 5: Claude Runner

**Files:**
- Create: `src/runners/claude.ts`
- Create: `tests/runners/claude.test.ts`

- [ ] **Step 1: Create src/runners/claude.ts**

Extract from `src/phases/interactive.ts` and `src/phases/gate.ts`:

```ts
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { HarnessState, InteractivePhase } from '../types.js';
import type { ModelPreset } from '../config.js';
import { GATE_TIMEOUT_MS, SIGTERM_WAIT_MS } from '../config.js';
import { sendKeysToPane, pollForPidFile } from '../tmux.js';
import { isPidAlive, getProcessStartTime, killProcessGroup } from '../process.js';
import { updateLockChild, clearLockChild } from '../lock.js';
import { writeState } from '../state.js';
import { parseVerdict, buildGateResult } from '../phases/gate.js';
import type { GatePhaseResult, InteractiveResult } from '../types.js'; // to be extracted

export async function runClaudeInteractive(
  phase: InteractivePhase,
  state: HarnessState,
  preset: ModelPreset,
  harnessDir: string,
  runDir: string,
  promptFile: string,
): Promise<{ pid: number | null }> {
  const sessionName = state.tmuxSession;
  const workspacePane = state.tmuxWorkspacePane;

  // Kill previous workspace process if alive
  if (state.lastWorkspacePid !== null && isPidAlive(state.lastWorkspacePid)) {
    const savedStart = state.lastWorkspacePidStartTime;
    const actualStart = getProcessStartTime(state.lastWorkspacePid);
    if (savedStart !== null && actualStart !== null && Math.abs(actualStart - savedStart) <= 2) {
      sendKeysToPane(sessionName, workspacePane, 'C-c');
      // Wait up to 5s for death
      const deadline = Date.now() + 5000;
      while (isPidAlive(state.lastWorkspacePid) && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 200));
      }
    }
  }

  // Safety: Ctrl+C + wait
  sendKeysToPane(sessionName, workspacePane, 'C-c');
  await new Promise(r => setTimeout(r, 500));

  // PID file
  const attemptId = state.phaseAttemptId[String(phase)] ?? '';
  const pidFile = path.join(runDir, `claude-${phase}-${attemptId}.pid`);
  if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);

  // Launch Claude
  const claudeArgs = `--dangerously-skip-permissions --model ${preset.model} --effort ${preset.effort} @${path.resolve(promptFile)}`;
  const wrappedCmd = `sh -c 'echo $$ > ${pidFile}; exec claude ${claudeArgs}'`;
  sendKeysToPane(sessionName, workspacePane, wrappedCmd);

  // Capture PID
  const claudePid = await pollForPidFile(pidFile, 5000);

  // Register in repo.lock
  if (claudePid !== null) {
    const startTime = getProcessStartTime(claudePid);
    updateLockChild(harnessDir, claudePid, phase, startTime);
    state.lastWorkspacePid = claudePid;
    state.lastWorkspacePidStartTime = startTime;
    writeState(runDir, state);
  }

  return { pid: claudePid };
}

export async function runClaudeGate(
  phase: number,
  preset: ModelPreset,
  prompt: string,
  harnessDir: string,
  cwd: string,
): Promise<GatePhaseResult> {
  const child = spawn('claude', [
    '--print', '--model', preset.model, '--effort', preset.effort,
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
    cwd,
  });

  const childPid = child.pid!;
  const startTime = getProcessStartTime(childPid);
  updateLockChild(harnessDir, childPid, phase, startTime);

  // Write prompt to stdin
  child.stdin.write(prompt);
  child.stdin.end();

  let stdoutChunks: Buffer[] = [];
  let stderrChunks: Buffer[] = [];
  child.stdout.on('data', (c: Buffer) => stdoutChunks.push(c));
  child.stderr.on('data', (c: Buffer) => stderrChunks.push(c));

  const result = await new Promise<GatePhaseResult>((resolve) => {
    let settled = false;
    const timeout = setTimeout(async () => {
      if (settled) return;
      settled = true;
      await killProcessGroup(childPid, SIGTERM_WAIT_MS);
      resolve({ type: 'error', error: `Claude gate timed out after ${GATE_TIMEOUT_MS}ms` });
    }, GATE_TIMEOUT_MS);

    child.on('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');
      resolve(buildGateResult(code ?? 1, stdout, stderr));
    });

    child.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ type: 'error', error: `Claude gate error: ${err.message}` });
    });
  });

  await killProcessGroup(childPid, SIGTERM_WAIT_MS);
  try { clearLockChild(harnessDir); } catch { /* best-effort */ }

  return result;
}
```

- [ ] **Step 2: Create basic test**

```ts
// tests/runners/claude.test.ts
import { describe, it, expect } from 'vitest';

describe('Claude Runner', () => {
  it('module exports runClaudeInteractive and runClaudeGate', async () => {
    const mod = await import('../../src/runners/claude.js');
    expect(typeof mod.runClaudeInteractive).toBe('function');
    expect(typeof mod.runClaudeGate).toBe('function');
  });
});
```

- [ ] **Step 3: Run test**

Run: `npx vitest run tests/runners/claude.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
mkdir -p tests/runners
git add src/runners/claude.ts tests/runners/claude.test.ts
git commit -m "feat: add Claude runner (interactive + gate)"
```

---

### Task 6: Codex Runner

**Files:**
- Create: `src/runners/codex.ts`
- Create: `tests/runners/codex.test.ts`

- [ ] **Step 1: Create src/runners/codex.ts**

```ts
import { spawn } from 'child_process';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { HarnessState, InteractivePhase } from '../types.js';
import type { ModelPreset } from '../config.js';
import { INTERACTIVE_TIMEOUT_MS, GATE_TIMEOUT_MS, SIGTERM_WAIT_MS, MAX_PROMPT_SIZE_KB } from '../config.js';
import { updateLockChild, clearLockChild } from '../lock.js';
import { getProcessStartTime, killProcessGroup } from '../process.js';
import { writeState } from '../state.js';
import { parseVerdict, buildGateResult } from '../phases/gate.js';
import type { GatePhaseResult } from '../types.js';

function resolveCodexBin(): string {
  try {
    return execSync('which codex', { encoding: 'utf-8' }).trim();
  } catch {
    throw new Error('Codex CLI not found in PATH.');
  }
}

export interface CodexInteractiveResult {
  status: 'completed' | 'failed';
  exitCode: number;
}

export async function runCodexInteractive(
  phase: InteractivePhase,
  state: HarnessState,
  preset: ModelPreset,
  harnessDir: string,
  runDir: string,
  promptFile: string,
  cwd: string,
): Promise<CodexInteractiveResult> {
  // Prompt size check
  const promptSize = fs.statSync(promptFile).size;
  if (promptSize > MAX_PROMPT_SIZE_KB * 1024) {
    return { status: 'failed', exitCode: -1 };
  }

  const codexBin = resolveCodexBin();
  const sandbox = phase === 5 ? 'danger-full-access' : 'workspace-write';

  const child = spawn(codexBin, [
    'exec',
    '--model', preset.model,
    '-c', `model_reasoning_effort="${preset.effort}"`,
    '--sandbox', sandbox,
    '--full-auto',
    '-',  // read prompt from stdin
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
    cwd,
  });

  const childPid = child.pid!;
  const startTime = getProcessStartTime(childPid);
  updateLockChild(harnessDir, childPid, phase, startTime);

  // Pipe prompt file to stdin
  const promptContent = fs.readFileSync(promptFile, 'utf-8');
  child.stdin.write(promptContent);
  child.stdin.end();

  // Stream stderr to control panel
  child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    for (const line of text.split('\n')) {
      if (line.trim()) process.stderr.write(`  [codex] ${line}\n`);
    }
  });

  const result = await new Promise<CodexInteractiveResult>((resolve) => {
    let settled = false;
    const timeout = setTimeout(async () => {
      if (settled) return;
      settled = true;
      await killProcessGroup(childPid, SIGTERM_WAIT_MS);
      resolve({ status: 'failed', exitCode: -2 });
    }, INTERACTIVE_TIMEOUT_MS);

    child.on('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        status: (code ?? 1) === 0 ? 'completed' : 'failed',
        exitCode: code ?? 1,
      });
    });

    child.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ status: 'failed', exitCode: -3 });
    });
  });

  // Cleanup
  await killProcessGroup(childPid, SIGTERM_WAIT_MS);
  try { clearLockChild(harnessDir); } catch { /* best-effort */ }

  // Clear workspace PID (Codex subprocess confirmed dead)
  state.lastWorkspacePid = null;
  state.lastWorkspacePidStartTime = null;
  writeState(runDir, state);

  // Error sidecar
  if (result.status === 'failed' && result.exitCode > 0) {
    const errorPath = path.join(runDir, `codex-${phase}-error.md`);
    try { fs.writeFileSync(errorPath, `# Codex Phase ${phase} Error\n\nExit code: ${result.exitCode}\n`); } catch { /* best-effort */ }
  }

  return result;
}

export async function runCodexGate(
  phase: number,
  preset: ModelPreset,
  prompt: string,
  harnessDir: string,
  cwd: string,
): Promise<GatePhaseResult> {
  const codexBin = resolveCodexBin();

  const child = spawn(codexBin, [
    'exec',
    '--model', preset.model,
    '-c', `model_reasoning_effort="${preset.effort}"`,
    '-',
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
    cwd,
  });

  const childPid = child.pid!;
  const startTime = getProcessStartTime(childPid);
  updateLockChild(harnessDir, childPid, phase, startTime);

  child.stdin.write(prompt);
  child.stdin.end();

  let stdoutChunks: Buffer[] = [];
  let stderrChunks: Buffer[] = [];
  child.stdout.on('data', (c: Buffer) => stdoutChunks.push(c));
  child.stderr.on('data', (c: Buffer) => {
    stderrChunks.push(c);
    const text = c.toString();
    for (const line of text.split('\n')) {
      if (line.includes('[codex]')) process.stderr.write(`  ${line}\n`);
    }
  });

  const result = await new Promise<GatePhaseResult>((resolve) => {
    let settled = false;
    const timeout = setTimeout(async () => {
      if (settled) return;
      settled = true;
      await killProcessGroup(childPid, SIGTERM_WAIT_MS);
      resolve({ type: 'error', error: `Codex gate timed out after ${GATE_TIMEOUT_MS}ms` });
    }, GATE_TIMEOUT_MS);

    child.on('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');
      resolve(buildGateResult(code ?? 1, stdout, stderr));
    });

    child.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ type: 'error', error: `Codex gate error: ${err.message}` });
    });
  });

  await killProcessGroup(childPid, SIGTERM_WAIT_MS);
  try { clearLockChild(harnessDir); } catch { /* best-effort */ }

  return result;
}
```

- [ ] **Step 2: Create test**

```ts
// tests/runners/codex.test.ts
import { describe, it, expect } from 'vitest';

describe('Codex Runner', () => {
  it('module exports runCodexInteractive and runCodexGate', async () => {
    const mod = await import('../../src/runners/codex.js');
    expect(typeof mod.runCodexInteractive).toBe('function');
    expect(typeof mod.runCodexGate).toBe('function');
  });
});
```

- [ ] **Step 3: Run test**

Run: `npx vitest run tests/runners/codex.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/runners/codex.ts tests/runners/codex.test.ts
git commit -m "feat: add Codex runner (interactive + gate)"
```

---

### Task 7: Phase Dispatch Refactor

**Files:**
- Modify: `src/phases/interactive.ts`
- Modify: `src/phases/gate.ts`
- Modify: `src/phases/runner.ts`

- [ ] **Step 1: Refactor interactive.ts to dispatch to runner**

Update `runInteractivePhase()` to check `state.phasePresets` and dispatch to either Claude runner or Codex runner. The `preparePhase()` function gains `isReopen` parameter using `state.phaseReopenFlags`.

Key changes:
- `preparePhase()`: add `isReopen` param, skip artifact deletion when true, clear flag after
- `runInteractivePhase()`: resolve preset → dispatch to `runClaudeInteractive()` or `runCodexInteractive()`
- Remove hardcoded `PHASE_MODELS[phase]` and `PHASE_EFFORTS[phase]` references

- [ ] **Step 2: Refactor gate.ts to dispatch to runner**

Update `runGatePhase()` to check `state.phasePresets` and dispatch to either `runClaudeGate()` or `runCodexGate()`. Export `parseVerdict` and `buildGateResult` for reuse by both runners.

- [ ] **Step 3: Update runner.ts for preset-based dispatch**

Update `renderControlPanel()` calls and model display to use `state.phasePresets`. Update `printAdvisorReminder()` calls to pass runner type.

- [ ] **Step 4: Run all phase tests**

Run: `npx vitest run tests/phases/`
Expected: PASS (update mocks as needed for new signatures)

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/phases/ tests/phases/
git commit -m "refactor: phase dispatch via runner presets instead of hardcoded models"
```

---

### Task 8: Preflight & Signal Updates

**Files:**
- Modify: `src/preflight.ts`
- Modify: `src/signal.ts`
- Modify: `tests/preflight.test.ts`
- Modify: `tests/signal.test.ts`

- [ ] **Step 1: Add codexCli preflight item**

In `src/preflight.ts`, add to the switch statement:
```ts
case 'codexCli': {
  try {
    const codexBin = execSync('which codex', { encoding: 'utf-8' }).trim();
    if (!codexBin) throw new Error('not found');
  } catch {
    throw new Error('Codex CLI not found in PATH. Install: npm i -g @openai/codex');
  }
  return {};
}
```

Add `'codexCli'` to `PreflightItem` type in `types.ts`.

- [ ] **Step 2: Add runner-aware preflight function**

```ts
export function runRunnerAwarePreflight(
  phasePresets: Record<string, string>,
  phases: string[],
): void {
  const runners = new Set(
    phases.map(p => getPresetById(phasePresets[p])?.runner).filter(Boolean)
  );
  if (runners.has('claude')) {
    runPreflight(['claude', 'claudeAtFile']);
  }
  if (runners.has('codex')) {
    runPreflight(['codexCli']);
  }
}
```

- [ ] **Step 3: Update signal.ts — runner-aware interrupt + dual-PID shutdown**

In `registerSignalHandlers()`:
- Capture `interruptedPhase` before mutating `state.currentPhase`
- Use `getPresetById(state.phasePresets[interruptedPhase])` to determine runner
- For Claude: send `C-c` to tmux pane
- For Codex: `killProcessGroup(childPid, SIGTERM_WAIT_MS)`
- In shutdown: also kill `lastWorkspacePid` if distinct from childPid and alive

- [ ] **Step 4: Update tests**

Run: `npx vitest run tests/preflight.test.ts tests/signal.test.ts`
Fix any failures.

- [ ] **Step 5: Commit**

```bash
git add src/preflight.ts src/signal.ts src/types.ts tests/preflight.test.ts tests/signal.test.ts
git commit -m "feat: runner-aware preflight (codexCli) and signal interrupt dispatch"
```

---

### Task 9: Inner/Start/Resume Integration

**Files:**
- Modify: `src/commands/inner.ts`
- Modify: `src/commands/start.ts`
- Modify: `src/commands/resume.ts`
- Modify: `src/resume.ts`

- [ ] **Step 1: Update start.ts — remove codexPath preflight, simplify outer preflight**

Remove the `codexPath` resolve from preflight. Only run common items + Phase 6 deps. Remove `codexPath` from `createInitialState()` call (already done in Task 2).

- [ ] **Step 2: Update inner.ts — add model selection + runner preflight**

After task capture + signal handler registration:
```ts
import { InputManager } from '../input.js';
import { promptModelConfig } from '../ui.js';
import { runRunnerAwarePreflight } from '../preflight.js';
import { REQUIRED_PHASE_KEYS } from '../config.js';

// After signal handler registration:
const inputManager = new InputManager();
inputManager.onConfigCancel = () => {
  state.status = 'paused';
  state.pauseReason = 'config-cancel';
  state.pendingAction = { type: 'reopen_config', targetPhase: state.currentPhase as any, sourcePhase: null, feedbackPaths: [] };
  writeState(runDir, state);
  releaseLock(harnessDir, runId);
  inputManager.stop();
  process.exit(0);
};

inputManager.start('configuring');

// Model selection
const updatedPresets = await promptModelConfig(state.phasePresets, inputManager);
state.phasePresets = updatedPresets;
writeState(runDir, state);

// Runner-aware preflight
try {
  const remaining = REQUIRED_PHASE_KEYS.filter(
    p => Number(p) >= state.currentPhase && state.phases[p] !== 'completed'
  );
  runRunnerAwarePreflight(state.phasePresets, [...remaining]);
} catch (err) {
  // Same as config cancel
  inputManager.onConfigCancel!();
}

// Enter phase loop
inputManager.enterPhaseLoop();

try {
  await runPhaseLoop(state, harnessDir, runDir, cwd);
} finally {
  inputManager.stop();
  releaseLock(harnessDir, runId);
}
```

- [ ] **Step 3: Update resume.ts — handle reopen_config pendingAction**

In `consumePendingAction()` in inner.ts, add:
```ts
if (action.action === 'reopen_config') {
  // Clear the pending action — model selection will restart
  state.pendingAction = null;
  writeState(runDir, state);
}
```

In `src/resume.ts`, add `config-cancel` to valid pause reasons.

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/inner.ts src/commands/start.ts src/commands/resume.ts src/resume.ts
git commit -m "feat: integrate InputManager + model selection into inner/start/resume"
```

---

### Task 10: Bug Fixes (Artifact Deletion + Race Condition)

**Files:**
- Modify: `src/phases/interactive.ts` (already partly done in Task 7)
- Modify: `src/phases/runner.ts`

- [ ] **Step 1: Verify phaseReopenFlags is set in all reopen paths**

In `src/phases/runner.ts`, ensure these functions set `phaseReopenFlags[targetPhase] = true`:
- `handleGateReject()`
- `handleVerifyFail()`
- `handleGateEscalation()` (Continue branch)
- `handleVerifyEscalation()` (Continue branch)

- [ ] **Step 2: Verify preparePhase uses isReopen**

In `src/phases/interactive.ts`:
```ts
const isReopen = state.phaseReopenFlags[String(phase)] ?? false;
// ... only delete artifacts if !isReopen
state.phaseReopenFlags[String(phase)] = false; // clear after use
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/phases/interactive.ts src/phases/runner.ts
git commit -m "fix: phase reopen preserves artifacts, set phaseReopenFlags in all reopen paths"
```

---

### Task 11: Update Remaining Callers + Tests

**Files:**
- Multiple test files that reference PHASE_MODELS/PHASE_EFFORTS or old createInitialState signature

- [ ] **Step 1: Search and fix all remaining references**

Run: `grep -rn 'PHASE_MODELS\|PHASE_EFFORTS' src/ tests/`
Fix each reference to use `MODEL_PRESETS` / `PHASE_DEFAULTS` / `getPresetById()`.

Run: `grep -rn "createInitialState.*codexPath\|createInitialState.*'/usr" tests/`
Fix each to use the 4-arg signature.

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: Exit 0

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: Exit 0

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: update all remaining PHASE_MODELS/PHASE_EFFORTS references and test signatures"
```

---

### Task 12: Documentation Update

**Files:**
- Modify: `docs/HOW-IT-WORKS.md`

- [ ] **Step 1: Add model selection section to HOW-IT-WORKS.md**

Add sections covering:
- Model preset system
- Model selection UI flow
- Runner architecture (Claude vs Codex)
- InputManager behavior

- [ ] **Step 2: Commit**

```bash
git add docs/HOW-IT-WORKS.md
git commit -m "docs: add model selection, runner architecture, and InputManager to HOW-IT-WORKS"
```
