# Codex Gate (Phase 2/4/7) → Workspace-Pane Interactive TUI Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Phase 2/4/7 Codex gate execution from a non-interactive subprocess into the same tmux workspace pane used by interactive phases, with sentinel-based completion detection and file-based verdict parsing.

**Architecture:** Gate phases (2/4/7) will use `sendKeysToPane` to inject `codex` TUI commands into `state.tmuxWorkspacePane`, wait for `phase-N.done` sentinel (same mechanism as Claude interactive phases), read `gate-N-verdict.md` for verdict, and extract tokens via a new `codex-usage.ts` JSONL reader. `handleGatePhase` gains `phase_start`/`phase_end` logging with `codexTokens`.

**Tech Stack:** TypeScript, Node.js, tmux (`sendKeysToPane`), Codex CLI 0.124.0, vitest, existing `chokidar`-based sentinel watcher

---

## File Structure

**New files:**
- `src/runners/codex-usage.ts` — JSONL-based Codex token + sessionId extractor (mirrors `claude-usage.ts`)
- `tests/runners/codex-usage.test.ts` — unit tests for above

**Modified files:**
- `src/types.ts` — add `codexTokens?: ClaudeTokens | null` to `phase_end` LogEvent; add `migrationVersion?: number` to `HarnessState`
- `src/state.ts` — add migration guard for `migrationVersion`; bump to version 2
- `src/context/assembler.ts` — add `buildGateOutputProtocol(phase, runDir, attemptId)` helper; append to both `assembleGatePrompt` and `assembleGateResumePrompt`
- `src/runners/codex.ts` — add `spawnCodexInPane(...)` for tmux pane gate injection (keep `runCodexInteractive` unchanged); export new `CodexSpawnResult` type
- `src/phases/verdict.ts` — add `buildGateResultFromFile(verdictPath)` reading `gate-N-verdict.md`; keep existing `buildGateResult(exitCode, stdout, stderr)` for Claude gate
- `src/phases/gate.ts` — add `runGatePhaseInteractive(...)` combining pane injection + sentinel wait + file-based verdict; route codex-runner path through it
- `src/phases/runner.ts` — update `handleGatePhase` to: log `phase_start`, record `phaseStartTs`, collect `codexTokens`, log `phase_end`
- `src/ink/components/Footer.tsx` — add one-line tmux attach hint when a gate phase is `in_progress`
- `tests/phases/gate-resume.test.ts` — update Codex spawn mock expectations to new `spawnCodexInPane` interface
- `tests/phases/gate.test.ts` — update mock references to new module exports
- `tests/integration/codex-session-resume.test.ts` — update to use new gate runner interface
- `README.md`, `README.ko.md`, `docs/HOW-IT-WORKS.md`, `docs/HOW-IT-WORKS.ko.md` — update gate execution description

---

## Task 1: `codex-usage.ts` — JSONL token/session extractor

**Files:**
- Create: `src/runners/codex-usage.ts`
- Test: `tests/runners/codex-usage.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/runners/codex-usage.test.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import os from 'os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  readCodexSessionUsage,
  codexSessionJsonlPath,
} from '../../src/runners/codex-usage.js';

function assistantLine(opts: {
  tsMs: number; input?: number; output?: number; cacheRead?: number; cacheCreate?: number;
}): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: new Date(opts.tsMs).toISOString(),
    message: {
      usage: {
        input_tokens: opts.input ?? 0,
        output_tokens: opts.output ?? 0,
        cache_read_input_tokens: opts.cacheRead ?? 0,
        cache_creation_input_tokens: opts.cacheCreate ?? 0,
      },
    },
  });
}

describe('codexSessionJsonlPath', () => {
  it('resolves to $codexHome/sessions/<sessionId>.jsonl', () => {
    expect(codexSessionJsonlPath('abc-123', '/tmp/codex-home'))
      .toBe('/tmp/codex-home/sessions/abc-123.jsonl');
  });
});

describe('readCodexSessionUsage — pinned sessionId', () => {
  const PHASE_START = 1_750_000_000_000;
  const SESSION_ID = 'aaaa-1111';
  let tmpHome: string;
  let stderrSpy: any;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-usage-test-'));
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns summed tokens from a pinned session file', async () => {
    const sessionDir = path.join(tmpHome, 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });
    const lines = [
      assistantLine({ tsMs: PHASE_START + 100, input: 10, output: 5, cacheRead: 2 }),
      assistantLine({ tsMs: PHASE_START + 200, input: 20, output: 10 }),
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(sessionDir, `${SESSION_ID}.jsonl`), lines);

    const result = await readCodexSessionUsage({
      sessionId: SESSION_ID,
      codexHome: tmpHome,
      phaseStartTs: PHASE_START,
    });
    expect(result?.tokens).toEqual({ input: 30, output: 15, cacheRead: 2, cacheCreate: 0, total: 47 });
    expect(result?.sessionId).toBe(SESSION_ID);
  });

  it('returns null when file missing', async () => {
    const result = await readCodexSessionUsage({
      sessionId: 'nonexistent',
      codexHome: tmpHome,
      phaseStartTs: PHASE_START,
    });
    expect(result).toBeNull();
  });

  it('returns null when total tokens is zero (no assistant lines)', async () => {
    const sessionDir = path.join(tmpHome, 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, `${SESSION_ID}.jsonl`),
      JSON.stringify({ type: 'user', message: 'hi' }) + '\n');
    const result = await readCodexSessionUsage({
      sessionId: SESSION_ID,
      codexHome: tmpHome,
      phaseStartTs: PHASE_START,
    });
    expect(result).toBeNull();
  });
});

describe('readCodexSessionUsage — no sessionId (scan fallback)', () => {
  const PHASE_START = 1_750_000_000_000;
  let tmpHome: string;
  let stderrSpy: any;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-usage-test-'));
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('picks most-recently-written session after phaseStartTs', async () => {
    const sessionDir = path.join(tmpHome, 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });
    // Write two sessions; second is newer
    const old = path.join(sessionDir, 'aaaa-old.jsonl');
    const newer = path.join(sessionDir, 'bbbb-new.jsonl');
    fs.writeFileSync(old, assistantLine({ tsMs: PHASE_START + 10, input: 1, output: 1 }) + '\n');
    fs.writeFileSync(newer, assistantLine({ tsMs: PHASE_START + 200, input: 99, output: 1 }) + '\n');
    // Make newer actually newer by touching mtimes
    const oldMtime = new Date(PHASE_START - 100);
    const newMtime = new Date(PHASE_START + 300);
    fs.utimesSync(old, oldMtime, oldMtime);
    fs.utimesSync(newer, newMtime, newMtime);

    const result = await readCodexSessionUsage({
      sessionId: null,
      codexHome: tmpHome,
      phaseStartTs: PHASE_START,
    });
    expect(result?.sessionId).toBe('bbbb-new');
  });

  it('returns null when sessions dir missing', async () => {
    const result = await readCodexSessionUsage({
      sessionId: null,
      codexHome: tmpHome,
      phaseStartTs: PHASE_START,
    });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/codex-session
pnpm vitest run tests/runners/codex-usage.test.ts
```

Expected: FAIL with `Cannot find module '../../src/runners/codex-usage.js'`

- [ ] **Step 3: Implement `src/runners/codex-usage.ts`**

```typescript
import fs from 'fs';
import path from 'path';
import type { ClaudeTokens } from '../types.js';

export interface CodexSessionResult {
  tokens: ClaudeTokens;
  sessionId: string;
}

export interface ReadCodexSessionUsageInput {
  sessionId: string | null;
  codexHome: string;
  phaseStartTs: number;
}

export function codexSessionJsonlPath(sessionId: string, codexHome: string): string {
  return path.join(codexHome, 'sessions', `${sessionId}.jsonl`);
}

function warn(msg: string): void {
  process.stderr.write(`[harness.codexUsage] ${msg}\n`);
}

function zeroTokens(): ClaudeTokens {
  return { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, total: 0 };
}

function toNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function parseSessionFile(absPath: string): { tokens: ClaudeTokens; skippedLines: number } {
  const raw = fs.readFileSync(absPath, 'utf-8');
  const tokens = zeroTokens();
  let skipped = 0;
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let entry: any;
    try { entry = JSON.parse(line); } catch { skipped++; continue; }
    if (!entry || entry.type !== 'assistant') continue;
    const usage = entry?.message?.usage;
    if (!usage || typeof usage !== 'object') continue;
    tokens.input += toNumber(usage.input_tokens);
    tokens.output += toNumber(usage.output_tokens);
    tokens.cacheRead += toNumber(usage.cache_read_input_tokens);
    tokens.cacheCreate += toNumber(usage.cache_creation_input_tokens);
  }
  tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreate;
  return { tokens, skippedLines: skipped };
}

const BACKOFF_DELAYS = [100, 100, 100]; // ms × 3 retries (R-D3)

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function readWithBackoff(absPath: string): Promise<{ tokens: ClaudeTokens; skippedLines: number } | null> {
  for (let i = 0; i <= BACKOFF_DELAYS.length; i++) {
    if (fs.existsSync(absPath)) {
      try {
        return parseSessionFile(absPath);
      } catch (err) {
        warn(`failed to read ${absPath}: ${(err as Error).message}`);
        return null;
      }
    }
    if (i < BACKOFF_DELAYS.length) await sleep(BACKOFF_DELAYS[i]);
  }
  return null;
}

export async function readCodexSessionUsage(
  input: ReadCodexSessionUsageInput,
): Promise<CodexSessionResult | null> {
  const { sessionId, codexHome, phaseStartTs } = input;
  const sessionsDir = path.join(codexHome, 'sessions');

  if (sessionId !== null) {
    const absPath = codexSessionJsonlPath(sessionId, codexHome);
    const outcome = await readWithBackoff(absPath);
    if (!outcome) return null;
    if (outcome.skippedLines > 0) warn(`skipped ${outcome.skippedLines} malformed line(s) in ${absPath}`);
    if (outcome.tokens.total === 0) return null;
    return { tokens: outcome.tokens, sessionId };
  }

  // Scan fallback: pick the most-recently-modified .jsonl file whose mtime > phaseStartTs
  let entries: string[];
  try {
    entries = fs.readdirSync(sessionsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      warn(`sessions dir unreadable ${sessionsDir}: ${(err as Error).message}`);
    }
    return null;
  }

  const candidates: Array<{ name: string; mtime: number }> = [];
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue;
    try {
      const stat = fs.statSync(path.join(sessionsDir, name));
      if (stat.mtimeMs >= phaseStartTs) candidates.push({ name, mtime: stat.mtimeMs });
    } catch { /* skip */ }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name));

  const winner = candidates[0];
  const absPath = path.join(sessionsDir, winner.name);
  const outcome = await readWithBackoff(absPath);
  if (!outcome) return null;
  if (outcome.skippedLines > 0) warn(`skipped ${outcome.skippedLines} malformed line(s) in ${winner.name}`);
  if (outcome.tokens.total === 0) return null;
  return {
    tokens: outcome.tokens,
    sessionId: winner.name.replace(/\.jsonl$/, ''),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run tests/runners/codex-usage.test.ts
```

Expected: all tests PASS

- [ ] **Step 5: Typecheck**

```bash
pnpm tsc --noEmit
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/runners/codex-usage.ts tests/runners/codex-usage.test.ts
git commit -m "feat(runners): add codex-usage JSONL session/token extractor"
```

---

## Task 2: Types — `codexTokens` in `phase_end` + `migrationVersion` in `HarnessState`

**Files:**
- Modify: `src/types.ts`
- Modify: `src/state.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/state.test.ts` (or create a short focused test inline):

```typescript
// In tests/state.test.ts — add one case:
it('migrateState sets migrationVersion=2 when field absent', () => {
  const raw = {
    runId: 'r1', flow: 'full', carryoverFeedback: null, currentPhase: 1,
    status: 'in_progress', autoMode: false, task: 't', baseCommit: '',
    implRetryBase: '', trackedRepos: [], codexPath: null,
    externalCommitsDetected: false,
    artifacts: { spec: '', plan: '', decisionLog: '', checklist: '', evalReport: '' },
    phases: {}, gateRetries: {}, verifyRetries: 0, pauseReason: null,
    specCommit: null, planCommit: null, implCommit: null, evalCommit: null,
    verifiedAtHead: null, pausedAtHead: null, pendingAction: null,
    phaseOpenedAt: {}, phaseAttemptId: {}, phasePresets: {},
    phaseReopenFlags: {}, phaseCodexSessions: { '2': null, '4': null, '7': null },
    phaseClaudeSessions: { '1': null, '3': null, '5': null },
    lastWorkspacePid: null, lastWorkspacePidStartTime: null,
    tmuxSession: '', tmuxMode: 'dedicated', tmuxWindows: [],
    tmuxControlWindow: '', tmuxWorkspacePane: '', tmuxControlPane: '',
    loggingEnabled: false, phaseReopenSource: {}, codexNoIsolate: false, dirtyBaseline: [],
    // migrationVersion intentionally absent
  };
  const state = migrateState(raw);
  expect(state.migrationVersion).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run tests/state.test.ts
```

Expected: FAIL — `state.migrationVersion` is `undefined` not `2`

- [ ] **Step 3: Update `src/types.ts`**

Add `migrationVersion?: number` to `HarnessState` interface:

```typescript
// In HarnessState, after dirtyBaseline:
  dirtyBaseline: string[];
  migrationVersion?: number;  // 2 = codex-pane-gate migration
```

Add `codexTokens` to `phase_end` LogEvent:

```typescript
// Replace:
| (LogEventBase & { event: 'phase_end'; phase: number; attemptId?: string | null; status: 'completed' | 'failed'; durationMs: number; details?: { reason: string }; claudeTokens?: ClaudeTokens | null })
// With:
| (LogEventBase & { event: 'phase_end'; phase: number; attemptId?: string | null; status: 'completed' | 'failed'; durationMs: number; details?: { reason: string }; claudeTokens?: ClaudeTokens | null; codexTokens?: ClaudeTokens | null })
```

- [ ] **Step 4: Update `src/state.ts` — migration guard**

In `migrateState`, add near the end (after existing guards, before the return):

```typescript
// migrationVersion: bump to 2 (codex pane-gate migration; state schema unchanged)
if (!raw.migrationVersion || raw.migrationVersion < 2) {
  raw.migrationVersion = 2;
}
```

- [ ] **Step 5: Run tests to verify pass**

```bash
pnpm vitest run tests/state.test.ts
pnpm tsc --noEmit
```

Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/state.ts tests/state.test.ts
git commit -m "feat(types): add codexTokens to phase_end + migrationVersion to HarnessState"
```

---

## Task 3: `assembler.ts` — Output Protocol block in gate prompts

Gate prompts must instruct Codex to write the verdict file and sentinel. Both `assembleGatePrompt` and `assembleGateResumePrompt` must append this block.

**Files:**
- Modify: `src/context/assembler.ts`
- Test: `tests/context/assembler.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/context/assembler.test.ts` (or add a focused test):

```typescript
// Add import:
import { assembleGatePrompt, assembleGateResumePrompt } from '../../src/context/assembler.js';

describe('assembleGatePrompt — Output Protocol block', () => {
  it('includes gate-N-verdict.md instruction', () => {
    // minimal state sufficient for phase-2 prompt assembly
    const state = makeLightState(); // use existing helper from the test file
    const result = assembleGatePrompt(2, state, '/tmp/h', '/tmp/cwd');
    expect(typeof result).toBe('string');
    const prompt = result as string;
    expect(prompt).toContain('gate-2-verdict.md');
    expect(prompt).toContain('phase-2.done');
  });

  it('includes attemptId in sentinel instruction', () => {
    const state = makeLightState();
    state.phaseAttemptId['2'] = 'test-attempt-uuid';
    const result = assembleGatePrompt(2, state, '/tmp/h', '/tmp/cwd');
    const prompt = result as string;
    expect(prompt).toContain('test-attempt-uuid');
  });
});

describe('assembleGateResumePrompt — Output Protocol block', () => {
  it('includes gate-N-verdict.md instruction on resume', () => {
    const state = makeLightState();
    state.phaseAttemptId['2'] = 'resume-uuid';
    const result = assembleGateResumePrompt(2, state, '/tmp/cwd', 'reject', 'P1 feedback', '/tmp/runDir');
    const prompt = result as string;
    expect(prompt).toContain('gate-2-verdict.md');
    expect(prompt).toContain('phase-2.done');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run tests/context/assembler.test.ts
```

Expected: FAIL — prompt does not contain `gate-2-verdict.md`

- [ ] **Step 3: Implement `buildGateOutputProtocol` in `src/context/assembler.ts`**

Add after the `buildLifecycleContext` function:

```typescript
/**
 * Output Protocol block injected at the end of every gate prompt.
 * Instructs Codex to write verdict file + sentinel — enabling sentinel-based
 * completion detection (R3/R4 of codex-pane-gate spec).
 */
function buildGateOutputProtocol(
  phase: 2 | 4 | 7,
  runDir: string,
  attemptId: string,
): string {
  const verdictFile = path.join(runDir, `gate-${phase}-verdict.md`);
  const sentinelFile = path.join(runDir, `phase-${phase}.done`);
  return (
    '\n\n---\n\n' +
    '## Output Protocol (REQUIRED — do not skip)\n\n' +
    'After producing your verdict, you MUST perform these two file writes in order:\n\n' +
    `1. Write your full verdict response (the \`## Verdict\`, \`## Comments\`, \`## Summary\` sections) to:\n   \`${verdictFile}\`\n\n` +
    `2. Write exactly this text to:\n   \`${sentinelFile}\`\n\n` +
    `   Content: \`${attemptId}\`\n\n` +
    'Use your file-write tool (apply_patch, write_file, or equivalent) for both writes.\n' +
    'Do NOT omit either write — the harness waits for the sentinel file to know you are done.\n'
  );
}
```

Update `assembleGatePrompt` to append the protocol block:

```typescript
export function assembleGatePrompt(
  phase: 2 | 4 | 7,
  state: HarnessState,
  harnessDir: string,
  cwd: string
): string | { error: string } {
  void harnessDir;

  let result: string | { error: string };

  if (phase === 2) {
    result = buildGatePromptPhase2(state, cwd);
  } else if (phase === 4) {
    result = buildGatePromptPhase4(state, cwd);
  } else {
    result = buildGatePromptPhase7(state, cwd);
  }

  if (typeof result !== 'string') return result;

  // Append Output Protocol block (R3: verdict file + sentinel write instructions)
  const runDir = path.join(harnessDir, state.runId);   // harnessDir is <root>/.harness
  const attemptId = state.phaseAttemptId[String(phase)] ?? '';
  result = result + buildGateOutputProtocol(phase, runDir, attemptId);

  if (result.length > MAX_PROMPT_SIZE_KB * 1024) {
    return {
      error: `Assembled gate prompt too large: ${Math.round(result.length / 1024)}KB > ${MAX_PROMPT_SIZE_KB}KB limit`,
    };
  }

  return result;
}
```

Update `assembleGateResumePrompt` similarly — at the end, before returning `prompt`:

```typescript
  // Append Output Protocol block (same requirement on resume path)
  const runDir = path.join(/* caller passes harnessDir implicitly via state */ '');
  // NOTE: assembleGateResumePrompt currently has no harnessDir param.
  // We need to add runDir parameter. See signature update below.
  prompt = prompt + buildGateOutputProtocol(phase, runDir, state.phaseAttemptId[String(phase)] ?? '');
  return prompt;
```

Since `assembleGateResumePrompt` needs `runDir`, update its signature:

```typescript
export function assembleGateResumePrompt(
  phase: 2 | 4 | 7,
  state: HarnessState,
  cwd: string,
  lastOutcome: 'approve' | 'reject' | 'error',
  previousFeedback: string,
  runDir: string,   // required: path to the run directory for Output Protocol
): string | { error: string }
```

And append at the return site:
```typescript
  return prompt + buildGateOutputProtocol(phase, runDir, state.phaseAttemptId[String(phase)] ?? '');
```

Update callers of `assembleGateResumePrompt` in `src/phases/gate.ts` to pass `runDir`.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run tests/context/assembler.test.ts
pnpm tsc --noEmit
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/context/assembler.ts tests/context/assembler.test.ts
git commit -m "feat(assembler): inject Output Protocol block into gate prompts (R3)"
```

---

## Task 4: `codex.ts` — `spawnCodexInPane` for tmux-based gate execution

Add a new function that mirrors `runClaudeInteractive` but for Codex gate phases. The existing `runCodexInteractive` (Phase 1/3/5) and `runCodexGate` (subprocess path) remain unchanged — the new function is additive and will be called by `gate.ts`.

**Files:**
- Modify: `src/runners/codex.ts`
- Test: `tests/runners/codex.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/runners/codex.test.ts`:

```typescript
import { spawnCodexInPane } from '../../src/runners/codex.js';
import { sendKeysToPane } from '../../src/tmux.js';
import { pollForPidFile } from '../../src/tmux.js';

vi.mock('../../src/tmux.js', () => ({
  sendKeysToPane: vi.fn(),
  pollForPidFile: vi.fn().mockResolvedValue(12345),
}));
vi.mock('../../src/process.js', () => ({
  getProcessStartTime: vi.fn().mockReturnValue(100),
  killProcessGroup: vi.fn().mockResolvedValue(undefined),
  isPidAlive: vi.fn().mockReturnValue(false),
}));
vi.mock('../../src/lock.js', () => ({
  updateLockChild: vi.fn(),
  clearLockChild: vi.fn(),
}));
vi.mock('../../src/state.js', () => ({ writeState: vi.fn() }));

describe('spawnCodexInPane — fresh', () => {
  it('sends fresh codex command to pane and returns pid', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-pane-'));
    const preset = { id: 'codex-high', runner: 'codex' as const, model: 'gpt-5.5', effort: 'high' };
    const state = makeMinimalState();
    state.tmuxSession = 'harness-sess';
    state.tmuxWorkspacePane = '%5';

    const result = await spawnCodexInPane({
      phase: 2,
      state,
      preset,
      harnessDir: tmpDir,
      runDir: tmpDir,
      promptFile: path.join(tmpDir, 'prompt.md'),
      cwd: tmpDir,
      codexHome: tmpDir,
      mode: 'fresh',
    });

    expect(result.pid).toBe(12345);
    expect(vi.mocked(sendKeysToPane).mock.calls[0][1]).toBe('%5');
    // Command must include 'codex' and redirect stdin from prompt file
    const cmd: string = vi.mocked(sendKeysToPane).mock.calls[0][2];
    expect(cmd).toContain('codex');
    expect(cmd).toContain('--full-auto');
    expect(cmd).not.toMatch(/\bcodex\s+exec\b/); // reject legacy 'codex exec' form; shell exec wrapper is expected
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('spawnCodexInPane — resume', () => {
  it('sends codex resume command with sessionId', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-pane-'));
    const preset = { id: 'codex-high', runner: 'codex' as const, model: 'gpt-5.5', effort: 'high' };
    const state = makeMinimalState();
    state.tmuxSession = 'harness-sess';
    state.tmuxWorkspacePane = '%5';

    await spawnCodexInPane({
      phase: 2,
      state,
      preset,
      harnessDir: tmpDir,
      runDir: tmpDir,
      promptFile: path.join(tmpDir, 'resume-prompt.md'),
      cwd: tmpDir,
      codexHome: tmpDir,
      mode: 'resume',
      sessionId: 'sess-abc-123',
    });

    const cmd: string = vi.mocked(sendKeysToPane).mock.calls[0][2];
    expect(cmd).toContain('resume');
    expect(cmd).toContain('sess-abc-123');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm vitest run tests/runners/codex.test.ts
```

Expected: FAIL — `spawnCodexInPane` not exported

- [ ] **Step 3: Implement `spawnCodexInPane` in `src/runners/codex.ts`**

Add at the end of `src/runners/codex.ts`:

```typescript
export interface SpawnCodexInPaneInput {
  phase: number;
  state: HarnessState;
  preset: ModelPreset;
  harnessDir: string;
  runDir: string;
  promptFile: string;
  cwd: string;
  codexHome: string | null;
  mode: 'fresh' | 'resume';
  sessionId?: string;
}

export interface CodexSpawnResult {
  pid: number | null;
}

/**
 * Inject a Codex TUI command into the tmux workspace pane.
 * Used for gate phases (2/4/7). Mirrors runClaudeInteractive: sends the
 * command via sendKeysToPane, polls for a PID file, updates state.lastWorkspacePid.
 */
export async function spawnCodexInPane(input: SpawnCodexInPaneInput): Promise<CodexSpawnResult> {
  const { phase, state, preset, harnessDir, runDir, promptFile, cwd, codexHome, mode, sessionId } = input;
  const { sendKeysToPane, pollForPidFile } = await import('../tmux.js');
  const { getProcessStartTime } = await import('../process.js');
  const { updateLockChild } = await import('../lock.js');

  const sessionName = state.tmuxSession;
  const workspacePane = state.tmuxWorkspacePane;

  // Kill previous workspace process if alive (same guard as runClaudeInteractive)
  if (state.lastWorkspacePid !== null) {
    const { isPidAlive, killProcessGroup } = await import('../process.js');
    if (isPidAlive(state.lastWorkspacePid)) {
      const savedStart = state.lastWorkspacePidStartTime;
      const actualStart = getProcessStartTime(state.lastWorkspacePid);
      if (savedStart !== null && actualStart !== null && Math.abs(actualStart - savedStart) <= 2) {
        sendKeysToPane(sessionName, workspacePane, 'C-c');
        const deadline = Date.now() + 5000;
        while (isPidAlive(state.lastWorkspacePid) && Date.now() < deadline) {
          await new Promise<void>((r) => setTimeout(r, 200));
        }
        if (isPidAlive(state.lastWorkspacePid)) {
          await killProcessGroup(state.lastWorkspacePid, SIGTERM_WAIT_MS);
        }
      }
    }
    state.lastWorkspacePid = null;
    state.lastWorkspacePidStartTime = null;
    writeState(runDir, state);
  }

  sendKeysToPane(sessionName, workspacePane, 'C-c');
  await new Promise<void>((r) => setTimeout(r, 500));

  const pidFile = path.join(runDir, `codex-gate-${phase}.pid`);
  if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);

  const codexBin = resolveCodexBin();
  const skipGitFlag = !isInGitRepo(cwd) ? '--skip-git-repo-check ' : '';
  const codexHomeEnv = codexHome ? `CODEX_HOME='${codexHome}' ` : '';

  let codexCmd: string;
  if (mode === 'resume' && sessionId) {
    // Resume: codex resume <sessionId> --model ... -c ... -s workspace-write -a never --full-auto < promptFile
    codexCmd =
      `${codexBin} resume '${sessionId}' ` +
      `${skipGitFlag}` +
      `--model ${preset.model} ` +
      `-c model_reasoning_effort="${preset.effort}" ` +
      `-s workspace-write -a never --full-auto ` +
      `< '${promptFile}'`;
  } else {
    // Fresh: codex --model ... -c ... -s workspace-write -a never --full-auto < promptFile
    codexCmd =
      `${codexBin} ` +
      `${skipGitFlag}` +
      `--model ${preset.model} ` +
      `-c model_reasoning_effort="${preset.effort}" ` +
      `-s workspace-write -a never --full-auto ` +
      `< '${promptFile}'`;
  }

  // Wrap: cd to cwd, write PID, exec codex (same pattern as runClaudeInteractive)
  const wrappedCmd = `sh -c 'cd "${cwd}" && echo $$ > ${pidFile} && ${codexHomeEnv}exec ${codexCmd}'`;
  sendKeysToPane(sessionName, workspacePane, wrappedCmd);

  const codexPid = await pollForPidFile(pidFile, 5000);

  if (codexPid !== null) {
    const startTime = getProcessStartTime(codexPid);
    updateLockChild(harnessDir, codexPid, phase, startTime);
    state.lastWorkspacePid = codexPid;
    state.lastWorkspacePidStartTime = startTime;
    writeState(runDir, state);
  }

  return { pid: codexPid };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run tests/runners/codex.test.ts
pnpm tsc --noEmit
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/runners/codex.ts tests/runners/codex.test.ts
git commit -m "feat(runners): add spawnCodexInPane for tmux workspace gate execution (R1/R2)"
```

---

## Task 5: `gate.ts` + `verdict.ts` — interactive gate execution with file-based verdict

Add `buildGateResultFromFile` to `verdict.ts` and `runGatePhaseInteractive` to `gate.ts`. Route codex-runner gate execution through the new interactive path.

**Files:**
- Modify: `src/phases/interactive.ts` — export `waitForPhaseCompletion`; widen `phase` type; add gate-phase pass-through in `validatePhaseArtifacts`
- Modify: `src/phases/verdict.ts`
- Modify: `src/phases/gate.ts`
- Test: `tests/phases/gate.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/phases/gate.test.ts`:

```typescript
import { buildGateResultFromFile } from '../../src/phases/verdict.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

describe('buildGateResultFromFile', () => {
  it('reads verdict from file and returns verdict result', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-test-'));
    const verdictPath = path.join(tmpDir, 'gate-2-verdict.md');
    fs.writeFileSync(verdictPath,
      '## Verdict\nAPPROVE\n\n## Comments\nNone\n\n## Summary\nLooks good.\n');
    const result = buildGateResultFromFile(verdictPath);
    expect(result.type).toBe('verdict');
    if (result.type === 'verdict') {
      expect(result.verdict).toBe('APPROVE');
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns error result when verdict file is missing', () => {
    const result = buildGateResultFromFile('/nonexistent/gate-2-verdict.md');
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.error).toContain('verdict file missing');
    }
  });

  it('returns error result when verdict header absent', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-test-'));
    const verdictPath = path.join(tmpDir, 'gate-2-verdict.md');
    fs.writeFileSync(verdictPath, '# No verdict section here\n');
    const result = buildGateResultFromFile(verdictPath);
    expect(result.type).toBe('error');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm vitest run tests/phases/gate.test.ts 2>&1 | head -40
```

Expected: FAIL — `buildGateResultFromFile` not exported

- [ ] **Step 2b: Prepare `src/phases/interactive.ts` — export `waitForPhaseCompletion` + gate-phase support**

Three minimal changes required so gate phases (2/4/7) can call the existing sentinel wait path:

```typescript
// 1. Change: async function waitForPhaseCompletion → export async function waitForPhaseCompletion
// 2. Widen parameter:  phase: InteractivePhase → phase: number  (in both waitForPhaseCompletion
//    and validatePhaseArtifacts signatures)
// 3. In validatePhaseArtifacts, add before the existing if-branches:
if (phase === 2 || phase === 4 || phase === 7) {
  return true; // gate completion is sentinel-only; caller verifies verdict file separately
}
```

No other changes to `interactive.ts`.

- [ ] **Step 3: Add `buildGateResultFromFile` to `src/phases/verdict.ts`**

```typescript
/**
 * Read verdict from a file written by Codex (Output Protocol, R3).
 * Returns error result if file missing, unreadable, or has no ## Verdict header.
 */
export function buildGateResultFromFile(verdictFilePath: string): GatePhaseResult {
  let raw: string;
  try {
    raw = fs.readFileSync(verdictFilePath, 'utf-8');
  } catch {
    return {
      type: 'error',
      error: `Gate verdict file missing or unreadable: ${verdictFilePath}`,
      rawOutput: '',
    };
  }

  const parsed = parseVerdict(raw);
  if (!parsed) {
    return {
      type: 'error',
      error: `Gate output missing ## Verdict header (from verdict file ${verdictFilePath})`,
      rawOutput: raw,
    };
  }

  return {
    type: 'verdict',
    verdict: parsed.verdict,
    comments: parsed.comments,
    scope: parsed.scope,
    rawOutput: raw,
  };
}
```

Add `import fs from 'fs'` at top of `verdict.ts` if not present.

- [ ] **Step 4: Add `runGatePhaseInteractive` to `src/phases/gate.ts`**

This function orchestrates: prompt assembly → pane injection → sentinel wait → verdict file read → session persistence. It replaces the subprocess path for codex runner.

```typescript
// Add imports at top:
import os from 'os';
import { spawnCodexInPane } from '../runners/codex.js';
import { buildGateResultFromFile } from './verdict.js';
import { readCodexSessionUsage } from '../runners/codex-usage.js';
import { waitForPhaseCompletion } from './interactive.js'; // reuses existing sentinel protocol (spec decision 4)
import { ensureCodexIsolation, CodexIsolationError } from '../runners/codex-isolation.js';

/**
 * Run a gate phase using tmux workspace pane + sentinel protocol (R1-R4).
 * Handles sidecar replay, resume-session logic, pane injection, and verdict file reading.
 * Replaces the subprocess path for codex-runner gates.
 */
export async function runGatePhaseInteractive(
  phase: 2 | 4 | 7,
  state: HarnessState,
  harnessDir: string,
  runDir: string,
  cwd: string,
  allowSidecarReplay?: { value: boolean },
): Promise<GatePhaseResult & { codexTokens?: ClaudeTokens | null }> {
  const phaseKey = String(phase) as GatePhaseKey;

  // Step 1: One-shot sidecar replay (preserves existing resume semantics)
  if (allowSidecarReplay?.value) {
    allowSidecarReplay.value = false;
    const replay = checkGateSidecars(runDir, phase);
    if (replay !== null) {
      const currentPreset = getPresetById(state.phasePresets[phaseKey]);
      const replayCompatible =
        currentPreset !== undefined &&
        replay.runner !== undefined &&
        replay.runner === currentPreset.runner &&
        (replay.runner === 'claude'
          ? true
          : (replay.sourcePreset?.model === currentPreset.model &&
             replay.sourcePreset?.effort === currentPreset.effort));
      if (replayCompatible) {
        // Codex hydration (same logic as runGatePhase)
        if (
          typeof replay.codexSessionId === 'string' &&
          replay.codexSessionId.trim().length > 0 &&
          replay.runner === 'codex' &&
          state.phaseCodexSessions[phaseKey] === null &&
          currentPreset?.runner === 'codex'
        ) {
          const lastOutcome: 'approve' | 'reject' | 'error' =
            replay.type === 'verdict'
              ? (replay.verdict === 'APPROVE' ? 'approve' : 'reject')
              : 'error';
          state.phaseCodexSessions[phaseKey] = {
            sessionId: replay.codexSessionId!,
            runner: 'codex',
            model: currentPreset!.model,
            effort: currentPreset!.effort,
            lastOutcome,
          };
          try { writeState(runDir, state); } catch (err) {
            return {
              type: 'error',
              error: `Failed to persist phaseCodexSessions during sidecar hydration: ${(err as Error).message}`,
              rawOutput: '',
            };
          }
        }
        return { ...replay, recoveredFromSidecar: true };
      }
    }
  }

  // Step 2: Pre-run cleanup
  const rawPath = path.join(runDir, `gate-${phase}-raw.txt`);
  const resultPath = path.join(runDir, `gate-${phase}-result.json`);
  const errorPath = path.join(runDir, `gate-${phase}-error.md`);
  const verdictPath = path.join(runDir, `gate-${phase}-verdict.md`);
  const sentinelPath = path.join(runDir, `phase-${phase}.done`);
  for (const p of [rawPath, resultPath, errorPath, verdictPath]) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }

  // Step 3: Resolve preset
  const presetId = state.phasePresets[phaseKey];
  const preset = getPresetById(presetId);
  if (!preset) return { type: 'error', error: `Unknown preset for phase ${phase}: ${presetId}` };

  // Step 4: Resume-compatibility check (same logic as runGatePhase)
  const savedSession = state.phaseCodexSessions[phaseKey];
  const savedCompatible =
    savedSession !== null &&
    typeof savedSession.sessionId === 'string' &&
    savedSession.sessionId.trim().length > 0 &&
    savedSession.runner === 'codex' &&
    preset.runner === 'codex' &&
    savedSession.model === preset.model &&
    savedSession.effort === preset.effort;

  if (savedSession !== null && !savedCompatible) {
    state.phaseCodexSessions[phaseKey] = null;
    try { writeState(runDir, state); } catch (err) {
      return { type: 'error', error: `Failed to clear incompatible session: ${(err as Error).message}` };
    }
  }

  // Step 5: Assemble prompt (resume vs fresh) and write to file
  let promptText: string;
  let resumeSessionId: string | null = null;

  if (savedCompatible && savedSession !== null) {
    resumeSessionId = savedSession.sessionId;
    let previousFeedback = '';
    if (savedSession.lastOutcome === 'reject') {
      try { previousFeedback = fs.readFileSync(path.join(runDir, `gate-${phase}-feedback.md`), 'utf-8'); } catch {
        previousFeedback = '(feedback file missing despite lastOutcome=reject)';
      }
    }
    const resumeResult = assembleGateResumePrompt(
      phase, state, cwd, savedSession.lastOutcome, previousFeedback, runDir,
    );
    if (typeof resumeResult !== 'string') return { type: 'error', error: resumeResult.error };
    promptText = resumeResult;
  } else {
    const freshResult = assembleGatePrompt(phase, state, harnessDir, cwd);
    if (typeof freshResult !== 'object' || !('error' in freshResult)) {
      promptText = freshResult as string;
    } else {
      return { type: 'error', error: (freshResult as { error: string }).error };
    }
  }

  const promptFile = path.join(runDir, `gate-${phase}-prompt.md`);
  fs.writeFileSync(promptFile, promptText, 'utf-8');
  const promptBytes = Buffer.byteLength(promptText, 'utf8');

  // Step 6: Codex isolation setup
  let codexHome: string | null = null;
  if (preset.runner === 'codex' && !state.codexNoIsolate) {
    try { codexHome = ensureCodexIsolation(runDir); }
    catch (err) {
      if (err instanceof CodexIsolationError) return { type: 'error', error: err.message, runner: 'codex' };
      throw err;
    }
  }

  // Purge stale sentinel before spawn
  try { fs.rmSync(sentinelPath, { force: true }); } catch { /* ignore */ }
  if (fs.existsSync(sentinelPath)) {
    return { type: 'error', error: `Pre-spawn sentinel purge failed: ${sentinelPath} still present` };
  }

  const phaseStartTs = Date.now();

  // Step 7: Dispatch to runner
  const runner = preset.runner;
  if (runner === 'claude') {
    // Claude gate: legacy subprocess path (unchanged)
    const { runClaudeGate } = await import('../runners/claude.js');
    const rawResult = await runClaudeGate(phase, preset, promptText, harnessDir, cwd);
    const durationMs = Date.now() - phaseStartTs;
    const result: GatePhaseResult = { ...rawResult, runner, promptBytes, durationMs };
    if (state.currentPhase !== phase) return result;
    await _persistSidecars(result, runDir, phase, runner, promptBytes, durationMs, preset);
    return result;
  }

  // Codex runner: pane injection path
  const spawnResult = await spawnCodexInPane({
    phase,
    state,
    preset,
    harnessDir,
    runDir,
    promptFile,
    cwd,
    codexHome,
    mode: resumeSessionId ? 'resume' : 'fresh',
    sessionId: resumeSessionId ?? undefined,
  });

  // Step 8: Wait for sentinel using existing waitForPhaseCompletion (spec decision 4).
  // interactive.ts must export waitForPhaseCompletion and accept phase: number so gate
  // phases (2/4/7) can call it. validatePhaseArtifacts returns true for gate phases
  // since verdict check is handled by buildGateResultFromFile after this call.
  const attemptId = state.phaseAttemptId[String(phase)] ?? '';
  const sentinelResult = await waitForPhaseCompletion(sentinelPath, attemptId, spawnResult.pid, phase, state, cwd, runDir);

  const durationMs = Date.now() - phaseStartTs;

  // Step 9: Redirect guard
  if (state.currentPhase !== phase) {
    return { type: 'error', error: `Phase ${phase} interrupted by control signal`, runner: 'codex', promptBytes, durationMs };
  }

  // Step 10: Read verdict file
  let gateResult: GatePhaseResult;
  if (sentinelResult.status === 'failed') {
    gateResult = {
      type: 'error',
      error: `Gate ${phase} failed (timed out or interrupted)`,
      runner: 'codex',
      promptBytes,
      durationMs,
      resumedFrom: resumeSessionId,
      resumeFallback: false,
      sourcePreset: { model: preset.model, effort: preset.effort },
    };
  } else {
    gateResult = buildGateResultFromFile(verdictPath);
    gateResult = {
      ...gateResult,
      runner: 'codex',
      promptBytes,
      durationMs,
      resumedFrom: resumeSessionId,
      resumeFallback: false,
      sourcePreset: { model: preset.model, effort: preset.effort },
    };
  }

  // Step 11: Collect codexTokens from JSONL.
  // When --codex-no-isolate is active, codexHome is null. Resolve the real home via
  // $CODEX_HOME env var or the Codex default (~/.codex) so JSONL files are findable
  // regardless of isolation mode (N4/R4). The empty-string fallback would scan the wrong dir.
  const effectiveCodexHome = codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex');
  let codexTokens: import('../types.js').ClaudeTokens | null | undefined;
  try {
    const usageResult = await readCodexSessionUsage({
      sessionId: resumeSessionId,
      codexHome: effectiveCodexHome,
      phaseStartTs,
    });
    if (usageResult !== null) {
      codexTokens = usageResult.tokens;
      // Extract sessionId from JSONL if we didn't have one
      if (!resumeSessionId && usageResult.sessionId) {
        (gateResult as any).codexSessionId = usageResult.sessionId;
      }
    } else {
      codexTokens = null;
    }
  } catch {
    codexTokens = null;
  }

  // Step 12: Persist session + sidecars (same logic as runGatePhase)
  if (state.currentPhase === phase) {
    const codexSessionId = (gateResult as any).codexSessionId as string | undefined;
    _persistCodexSession(state, phase, gateResult, resumeSessionId, codexSessionId, preset, runDir);
    await _persistSidecars(gateResult, runDir, phase, 'codex', promptBytes, durationMs, preset);
  }

  return { ...gateResult, codexTokens };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

// Note: sentinel wait is handled by waitForPhaseCompletion from interactive.ts.
// Before calling it, interactive.ts must be updated:
//   1. Export waitForPhaseCompletion (change private → export)
//   2. Widen phase parameter from InteractivePhase to number in both
//      waitForPhaseCompletion and validatePhaseArtifacts
//   3. In validatePhaseArtifacts, add: if (phase === 2 || phase === 4 || phase === 7)
//      return true; // gate completion is sentinel-only; verdict checked by caller
// These are the only changes to interactive.ts required by this migration.

function _persistCodexSession(
  state: HarnessState,
  phase: 2 | 4 | 7,
  result: GatePhaseResult,
  resumeSessionId: string | null,
  codexSessionId: string | undefined,
  preset: ModelPreset,
  runDir: string,
): void {
  const phaseKey = String(phase) as GatePhaseKey;
  if (result.resumeFallback === true) {
    state.phaseCodexSessions[phaseKey] = null;
  }
  const isValidId = typeof codexSessionId === 'string' && codexSessionId.trim().length > 0;
  const isStaleCarryforward =
    result.resumeFallback === true &&
    typeof resumeSessionId === 'string' &&
    codexSessionId === resumeSessionId;
  if (isValidId && !isStaleCarryforward) {
    const lastOutcome: 'approve' | 'reject' | 'error' =
      result.type === 'verdict'
        ? (result.verdict === 'APPROVE' ? 'approve' : 'reject')
        : 'error';
    state.phaseCodexSessions[phaseKey] = {
      sessionId: codexSessionId!,
      runner: 'codex',
      model: preset.model,
      effort: preset.effort,
      lastOutcome,
    };
  }
  try { writeState(runDir, state); } catch { /* best-effort: callers handle null session */ }
}

async function _persistSidecars(
  result: GatePhaseResult,
  runDir: string,
  phase: number,
  runner: 'claude' | 'codex',
  promptBytes: number,
  durationMs: number,
  preset: ModelPreset,
): Promise<void> {
  const rawPath = path.join(runDir, `gate-${phase}-raw.txt`);
  const resultPath = path.join(runDir, `gate-${phase}-result.json`);
  const errorPath = path.join(runDir, `gate-${phase}-error.md`);

  const stdout = result.type === 'verdict' ? result.rawOutput : (result.rawOutput ?? '');
  const exitCode = result.type === 'verdict' ? 0 : 1;
  const gateResult: GateResult = {
    exitCode,
    timestamp: Date.now(),
    runner,
    promptBytes,
    durationMs,
    ...(result.tokensTotal !== undefined ? { tokensTotal: result.tokensTotal } : {}),
    ...(result.codexSessionId !== undefined ? { codexSessionId: result.codexSessionId } : {}),
    ...(runner === 'codex' ? { sourcePreset: { model: preset.model, effort: preset.effort } } : {}),
  };
  try {
    fs.writeFileSync(rawPath, stdout);
    fs.writeFileSync(resultPath, JSON.stringify(gateResult, null, 2));
  } catch { /* best-effort */ }

  if (result.type === 'error') {
    try {
      fs.writeFileSync(
        errorPath,
        `# Gate ${phase} Error\n\nError: ${result.error}\n\n## Output\n\n\`\`\`\n${stdout}\n\`\`\`\n`,
      );
    } catch { /* best-effort */ }
  }
}
```

Update `runGatePhase` to call `runGatePhaseInteractive` for the codex runner path (and keep the claude path as before). The simplest approach is to replace the body of `runGatePhase` with a delegation:

```typescript
export async function runGatePhase(
  phase: 2 | 4 | 7,
  state: HarnessState,
  harnessDir: string,
  runDir: string,
  cwd: string,
  allowSidecarReplay?: { value: boolean },
): Promise<GatePhaseResult> {
  // Route through interactive path (tmux pane + sentinel) for all runners.
  // The interactive path handles sidecar replay, session resume, verdict file, and sidecars.
  return runGatePhaseInteractive(phase, state, harnessDir, runDir, cwd, allowSidecarReplay);
}
```

- [ ] **Step 5: Run tests to verify pass**

```bash
pnpm vitest run tests/phases/gate.test.ts
pnpm tsc --noEmit
```

Expected: PASS (some pre-existing tests may need mock updates — see Task 8)

- [ ] **Step 6: Commit**

```bash
git add src/phases/verdict.ts src/phases/gate.ts
git commit -m "feat(gate): add runGatePhaseInteractive with pane injection + sentinel wait (R1-R4)"
```

---

## Task 6: `runner.ts` — `handleGatePhase` with `phase_start`/`phase_end`/`codexTokens`

Gate phases currently log only `gate_verdict`/`gate_error`, without `phase_start` or `phase_end`. Per R5, gate `phase_end` must include `codexTokens`.

**Files:**
- Modify: `src/phases/runner.ts`
- Test: `tests/phases/runner-token-capture.test.ts` (add gate token capture test)

- [ ] **Step 1: Write failing test**

Add to `tests/phases/runner-token-capture.test.ts`:

```typescript
describe('handleGatePhase — codexTokens in phase_end', () => {
  it('logs phase_start and phase_end with codexTokens for gate phases', async () => {
    // ... set up state with gate phase, mock runGatePhase to return a verdict,
    // assert logger.logEvent was called with phase_start and phase_end + codexTokens
  });
});
```

For the test, mock `runGatePhaseInteractive` to return `{ type: 'verdict', verdict: 'APPROVE', comments: '', rawOutput: '', codexTokens: { input: 10, output: 5, cacheRead: 0, cacheCreate: 0, total: 15 } }` and assert that `logger.logEvent` received a `phase_end` event with `codexTokens`.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm vitest run tests/phases/runner-token-capture.test.ts
```

Expected: FAIL — `handleGatePhase` doesn't emit `phase_start` or `phase_end`

- [ ] **Step 3: Update `handleGatePhase` in `src/phases/runner.ts`**

Add `phase_start` logging at the top and `phase_end` logging at each exit point:

```typescript
export async function handleGatePhase(
  phase: GatePhase,
  state: HarnessState,
  harnessDir: string,
  runDir: string,
  cwd: string,
  inputManager: InputManager,
  logger: SessionLogger,
  sidecarReplayAllowed: { value: boolean },
): Promise<void> {
  state.phases[String(phase)] = 'in_progress';
  writeState(runDir, state);

  const retryIndex = state.gateRetries[String(phase)] ?? 0;
  const gatePresetMeta = getPhasePresetMeta(state, phase);
  const phaseStartTs = Date.now();

  // Persist attemptId for the gate phase (used by Output Protocol block)
  const attemptId = state.phaseAttemptId[String(phase)] ?? randomUUID();
  state.phaseAttemptId[String(phase)] = attemptId;
  writeState(runDir, state);

  logger.logEvent({
    event: 'phase_start',
    phase,
    attemptId,
    preset: gatePresetMeta,
  });

  printInfo(`Codex 리뷰 진행 중... (최대 ${Math.round(GATE_TIMEOUT_MS / 1000)}초 소요)`);
  const rawResult = await runGatePhase(phase, state, harnessDir, runDir, cwd, sidecarReplayAllowed);

  // Extract codexTokens from result (runGatePhaseInteractive appends it)
  const codexTokens = (rawResult as any).codexTokens as import('../types.js').ClaudeTokens | null | undefined;
  const result: GatePhaseResult = rawResult; // strip codexTokens from GatePhaseResult type

  // Redirect guard (same as before)
  if (state.currentPhase !== phase) {
    printInfo(`Phase ${phase} interrupted by control signal → phase ${state.currentPhase}`);
    renderControlPanel(state, logger, 'gate-redirect');
    logger.logEvent({
      event: 'phase_end',
      phase,
      attemptId,
      status: 'failed',
      durationMs: Date.now() - phaseStartTs,
      details: { reason: 'redirected' },
      ...(codexTokens !== undefined ? { codexTokens } : {}),
    });
    return;
  }

  if (result.type === 'verdict') {
    const durationMs = Date.now() - phaseStartTs;
    if (result.verdict === 'APPROVE') {
      // ... (existing APPROVE handling) ...
      logger.logEvent({
        event: 'phase_end',
        phase,
        attemptId,
        status: 'completed',
        durationMs,
        ...(codexTokens !== undefined ? { codexTokens } : {}),
      });
    } else {
      // REJECT
      logger.logEvent({
        event: 'phase_end',
        phase,
        attemptId,
        status: 'failed',
        durationMs,
        ...(codexTokens !== undefined ? { codexTokens } : {}),
      });
      await handleGateReject(/* ... */);
    }
  } else {
    // Error
    logger.logEvent({
      event: 'phase_end',
      phase,
      attemptId,
      status: 'failed',
      durationMs: Date.now() - phaseStartTs,
      ...(codexTokens !== undefined ? { codexTokens } : {}),
    });
    await handleGateError(/* ... */);
  }
}
```

Also add `import { randomUUID } from 'crypto'` if not present.

- [ ] **Step 4: Run tests to verify pass**

```bash
pnpm vitest run tests/phases/runner-token-capture.test.ts tests/phases/runner.test.ts
pnpm tsc --noEmit
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/phases/runner.ts tests/phases/runner-token-capture.test.ts
git commit -m "feat(runner): log phase_start/phase_end with codexTokens for gate phases (R5)"
```

---

## Task 7: Test updates — gate-resume, gate.test, integration

Update tests that mock `runCodexGate` (the old subprocess interface) to use the new `spawnCodexInPane` + sentinel-based interface.

**Files:**
- Modify: `tests/phases/gate-resume.test.ts`
- Modify: `tests/phases/gate.test.ts`
- Modify: `tests/integration/codex-session-resume.test.ts`

- [ ] **Step 1: Update mock in `tests/phases/gate-resume.test.ts`**

Replace:
```typescript
vi.mock('../../src/runners/codex.js', () => ({ runCodexGate: vi.fn() }));
import { runCodexGate } from '../../src/runners/codex.js';
```

With:
```typescript
vi.mock('../../src/runners/codex.js', () => ({
  runCodexGate: vi.fn(),  // kept for any direct caller
  spawnCodexInPane: vi.fn().mockResolvedValue({ pid: 99999 }),
}));

// readCodexSessionUsage must be mocked so _persistCodexSession receives a codexSessionId.
// Without this mock the JSONL lookup returns null → codexSessionId is undefined →
// phaseCodexSessions stays null, breaking same-session resume assertions (R4/E2/E7).
vi.mock('../../src/runners/codex-usage.js', () => ({
  readCodexSessionUsage: vi.fn().mockResolvedValue({
    sessionId: 'aa-11',
    tokens: { input: 10, output: 5, cacheRead: 0, cacheCreate: 0, total: 15 },
  }),
}));
```

Since `runGatePhaseInteractive` internally calls `spawnCodexInPane` and then waits for a sentinel, the tests need to also write the sentinel file. Create helpers:

```typescript
function writeSentinel(runDir: string, phase: number, attemptId: string): void {
  fs.writeFileSync(path.join(runDir, `phase-${phase}.done`), attemptId);
}

function writeVerdictFile(runDir: string, phase: number, verdict: 'APPROVE' | 'REJECT', comments = ''): void {
  fs.writeFileSync(
    path.join(runDir, `gate-${phase}-verdict.md`),
    `## Verdict\n${verdict}\n\n## Comments\n${comments}\n\n## Summary\nOk.\n`,
  );
}
```

Update each test to: (1) write a verdict file, (2) write the sentinel, (3) assert on `state.phaseCodexSessions`.

Example update for first test:

```typescript
it('saves new session after first call (fresh)', async () => {
  const state = makeState();
  state.phaseAttemptId['2'] = 'attempt-001';
  
  // Set up sentinel + verdict file for phase 2
  vi.mocked(spawnCodexInPane).mockImplementationOnce(async () => {
    writeVerdictFile(runDir, 2, 'REJECT', 'P1 issue');
    writeSentinel(runDir, 2, 'attempt-001');
    return { pid: null };
  });

  const res = await runGatePhase(2, state, runDir, runDir, runDir);
  expect(res.type).toBe('verdict');
  // sessionId extracted from mocked readCodexSessionUsage → persisted in phaseCodexSessions
  expect(state.phaseCodexSessions['2']?.sessionId).toBe('aa-11');
  expect(state.phaseCodexSessions['2']?.lastOutcome).toBe('reject');
});
```

- [ ] **Step 2: Update `tests/phases/gate.test.ts`**

Update the mock to use `spawnCodexInPane` and update assertions for the new verdict file path:

```typescript
vi.mock('../../src/runners/codex.js', () => ({
  runCodexGate: vi.fn(),
  spawnCodexInPane: vi.fn().mockResolvedValue({ pid: null }),
}));
```

- [ ] **Step 3: Update `tests/integration/codex-session-resume.test.ts`**

Replace `runCodexGate` mock with `spawnCodexInPane` + sentinel setup pattern.

- [ ] **Step 3b: Add `codexNoIsolate: true` test (P1 regression — N4/R4)**

Add to `tests/phases/gate-resume.test.ts` (or `tests/phases/gate.test.ts`):

```typescript
describe('runGatePhase — codexNoIsolate path', () => {
  it('does not fail when codexNoIsolate=true and codexHome is null', async () => {
    const state = makeState();
    state.codexNoIsolate = true;
    state.phaseAttemptId['2'] = 'attempt-isolate';

    vi.mocked(spawnCodexInPane).mockImplementationOnce(async () => {
      writeVerdictFile(runDir, 2, 'APPROVE', 'ok');
      writeSentinel(runDir, 2, 'attempt-isolate');
      return { pid: null };
    });

    const res = await runGatePhase(2, state, runDir, runDir, runDir);
    // codexNoIsolate means codexHome=null in spawnCodexInPane;
    // effectiveCodexHome fallback must not cause a crash or wrong dir scan
    expect(res.type).toBe('verdict');
    if (res.type === 'verdict') expect(res.verdict).toBe('APPROVE');
  });
});
```

- [ ] **Step 4: Run all affected tests**

```bash
pnpm vitest run tests/phases/gate-resume.test.ts tests/phases/gate.test.ts tests/integration/codex-session-resume.test.ts
```

Expected: all PASS

- [ ] **Step 5: Run full test suite**

```bash
pnpm vitest run
```

Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add tests/phases/gate-resume.test.ts tests/phases/gate.test.ts tests/integration/codex-session-resume.test.ts
git commit -m "test(gate): update tests to spawnCodexInPane + sentinel pattern"
```

---

## Task 8: `Footer.tsx` attach hint + docs update

**Files:**
- Modify: `src/ink/components/Footer.tsx`
- Modify: `README.md`, `README.ko.md`, `docs/HOW-IT-WORKS.md`, `docs/HOW-IT-WORKS.ko.md`

- [ ] **Step 1: Update `src/ink/components/Footer.tsx`**

The footer receives `summary` + `columns`. When a gate phase is running, add an attach hint. Pass `tmuxSession` to the footer or add it via the existing `FooterSummary` type.

In `src/metrics/footer-aggregator.ts`, check if `FooterSummary` has a `tmuxSession` field. If not, add it:

```typescript
// In FooterSummary interface, add:
tmuxSession?: string;
```

In `Footer.tsx`, add the hint line:

```typescript
export function Footer({ summary, columns }: Props): React.ReactElement | null {
  if (summary === null) return null;
  const line = formatFooter(summary, columns);
  if (!line && !summary.tmuxSession) return null;
  return (
    <Box flexDirection="column">
      {line && <Text dimColor>{line}</Text>}
      {summary.tmuxSession && (
        <Text dimColor>
          {`attach: tmux attach -t ${summary.tmuxSession}`}
        </Text>
      )}
    </Box>
  );
}
```

- [ ] **Step 2: Run footer tests**

```bash
pnpm vitest run tests/ink/components/Footer.test.tsx
```

Expected: PASS (add fixture for tmuxSession if test breaks)

- [ ] **Step 3: Update docs**

In `README.md` and `README.ko.md`, update the "Gate phases" section to describe:
- Gate phases (2/4/7) now run as Codex TUI inside the same workspace pane as interactive phases
- Users can watch gate execution with `tmux attach -t <session>`
- `phase-harness jump <N>` / `phase-harness skip` immediately interrupts a running gate

In `docs/HOW-IT-WORKS.md` and `docs/HOW-IT-WORKS.ko.md`, update the "Gate" section to describe:
- Sentinel-based completion detection (same as Phase 1/3/5)
- `gate-N-verdict.md` file written by Codex
- `codexTokens` in `phase_end` events

- [ ] **Step 4: Build and full test**

```bash
pnpm build
pnpm vitest run
pnpm tsc --noEmit
```

Expected: all green

- [ ] **Step 5: Commit**

```bash
git add src/ink/components/Footer.tsx src/metrics/footer-aggregator.ts README.md README.ko.md docs/HOW-IT-WORKS.md docs/HOW-IT-WORKS.ko.md
git commit -m "feat(ui): add tmux attach hint to footer; docs: update gate lifecycle description"
```

---

## Eval Checklist

The eval checklist is at `.harness/2026-04-24-codex-gate-phase-2-4-7-4f26/checklist.json`.

See spec `## Acceptance` criteria:
- E1: `phase-harness start` + `tmux attach` shows Codex TUI in workspace pane
- E2: REJECT resume uses same pane + same sessionId
- E3: `phase-harness jump 3` kills gate process within 1s
- E4: `events.jsonl` gate `phase_end` has `codexTokens` 3-state
- E5: `pnpm tsc --noEmit`, `pnpm vitest run`, `pnpm build` all green
- E6: README/HOW-IT-WORKS gate section updated
- E7: `tests/phases/gate-resume.test.ts` all green
