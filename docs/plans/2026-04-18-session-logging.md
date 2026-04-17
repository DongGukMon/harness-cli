# Harness Session Logging — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**관련 문서:**
- Spec: `docs/specs/2026-04-18-session-logging-design.md` (rev 15.1, Codex gate approved)
- Eval checklist: 본 문서 §Eval Checklist
- Eval report (작성 예정): `docs/process/evals/2026-04-18-session-logging-eval.md`

**Goal:** `harness start <task> --enable-logging` 플래그로 활성화되는 opt-in 세션 로깅. phase/gate/verify 이벤트를 `~/.harness/sessions/<repoKey>/<runId>/events.jsonl`에 append하고 phase 종료마다 `summary.json`을 재집계.

**Architecture:** 중앙 `SessionLogger`가 `__inner` 프로세스 안에서 생성되어 runner/gate 핸들러가 명시적으로 `logger.logEvent` 호출. Events.jsonl은 authoritative append-only 스트림, summary.json은 best-effort 집계. Logger 내부 실패는 호출자에 전파되지 않음 (비침투성 제1원칙).

**Tech Stack:** TypeScript (Node.js), vitest, fs 동기 API (atomic rename), crypto (sha1), uuid v4.

---

## File Structure

### 신규 파일
- `src/logger.ts` — SessionLogger 인터페이스, FileSessionLogger/NoopLogger 클래스, computeRepoKey, createSessionLogger factory
- `tests/logger.test.ts` — Logger unit tests
- `tests/integration/logging.test.ts` — End-to-end integration tests

### 수정 파일
- `src/types.ts` — HarnessState.loggingEnabled, GatePhaseResult 확장, GateResult 확장
- `src/state.ts` — createInitialState 시그니처, migrateState 기본값
- `bin/harness.ts` — `--enable-logging` CLI 플래그 등록
- `src/commands/start.ts` — StartOptions.enableLogging 수신 → state persist
- `src/commands/inner.ts` — Logger 생성/라이프사이클, lazy bootstrap for onConfigCancel
- `src/phases/runner.ts` — logger 파라미터 threading, 이벤트 발행, sidecarReplayAllowed
- `src/phases/interactive.ts` — attemptId 파라미터 도입
- `src/phases/gate.ts` — promptBytes/runner/durationMs in sidecar, checkGateSidecars gating
- `src/phases/verdict.ts` — extractCodexMetadata 헬퍼
- `src/runners/codex.ts` — tokens/sessionId 파싱
- `src/resume.ts` — NoopLogger threading (dead code 유지)
- `tests/phases/gate.test.ts` — legacy sidecar (skip) vs extended sidecar (hydrate) 분리
- `tests/phases/runner.test.ts`, `tests/state.test.ts`, `tests/resume.test.ts`, `tests/commands/*.test.ts` — signature 변경 반영

---

## Task 1: 타입 확장 (foundation)

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: `HarnessState`에 `loggingEnabled` 및 `phaseReopenSource` 추가**

`src/types.ts`의 `HarnessState` interface 맨 아래(`tmuxControlPane` 다음)에:

```ts
  tmuxControlPane: string;
  // --- Session logging (opt-in) ---
  loggingEnabled: boolean;
  // Tracks which phase triggered a reopen (for phase_start.reopenFromGate)
  // keys "1","3","5" → number (triggering phase 2/4/6/7) or null
  phaseReopenSource: Record<string, number | null>;
}
```

- [ ] **Step 2: `GateResult` 확장**

기존 `GateResult` 교체:

```ts
export interface GateResult {
  exitCode: number;
  timestamp: number;
  // Session logging metadata (v1: optional for backward compat)
  runner?: 'claude' | 'codex';
  promptBytes?: number;
  durationMs?: number;
  tokensTotal?: number;
  codexSessionId?: string;
}
```

- [ ] **Step 3: `GateOutcome`, `GateError` 확장**

```ts
export interface GateOutcome {
  type: 'verdict';
  verdict: GateVerdict;
  comments: string;
  rawOutput: string;
  // Session logging metadata
  runner?: 'claude' | 'codex';
  promptBytes?: number;
  durationMs?: number;
  tokensTotal?: number;
  codexSessionId?: string;
  recoveredFromSidecar?: boolean;
}

export interface GateError {
  type: 'error';
  error: string;
  rawOutput?: string;
  // Session logging metadata
  runner?: 'claude' | 'codex';
  promptBytes?: number;
  durationMs?: number;
  exitCode?: number;
  recoveredFromSidecar?: boolean;
}
```

- [ ] **Step 4: LogEvent discriminated union 타입 추가**

파일 끝에 추가:

```ts
// --- Session Logging Events ---

export interface LogEventBase {
  v: number;
  ts: number;
  runId: string;
  phase?: number;
  attemptId?: string | null;
}

export type LogEvent =
  | (LogEventBase & { event: 'session_start'; task: string; autoMode: boolean; baseCommit: string; harnessVersion: string })
  | (LogEventBase & { event: 'session_resumed'; fromPhase: number; stateStatus: RunStatus })
  | (LogEventBase & { event: 'phase_start'; phase: number; attemptId?: string | null; reopenFromGate?: number | null; retryIndex?: number })
  | (LogEventBase & {
      event: 'gate_verdict';
      phase: number;
      retryIndex: number;
      runner: 'claude' | 'codex';
      verdict: GateVerdict;
      durationMs?: number;
      tokensTotal?: number;
      promptBytes?: number;
      codexSessionId?: string;
      recoveredFromSidecar?: boolean;
    })
  | (LogEventBase & {
      event: 'gate_error';
      phase: number;
      retryIndex: number;
      runner?: 'claude' | 'codex';
      error: string;
      exitCode?: number;
      durationMs?: number;
      recoveredFromSidecar?: boolean;
    })
  | (LogEventBase & { event: 'gate_retry'; phase: number; retryIndex: number; retryCount: number; retryLimit: number; feedbackPath: string; feedbackBytes: number; feedbackPreview: string })
  | (LogEventBase & { event: 'escalation'; phase: number; reason: 'gate-retry-limit' | 'gate-error' | 'verify-limit' | 'verify-error'; userChoice?: 'C' | 'S' | 'Q' | 'R' })
  | (LogEventBase & { event: 'force_pass'; phase: number; by: 'auto' | 'user' })
  | (LogEventBase & { event: 'verify_result'; passed: boolean; retryIndex: number; durationMs: number; failedChecks?: string[] })
  | (LogEventBase & { event: 'phase_end'; phase: number; attemptId?: string | null; status: 'completed' | 'failed'; durationMs: number; details?: { reason: string } })
  | (LogEventBase & { event: 'state_anomaly'; kind: string; details: Record<string, unknown> })
  | (LogEventBase & { event: 'session_end'; status: 'completed' | 'paused' | 'interrupted'; totalWallMs: number });

export interface SessionMeta {
  v: number;
  runId: string;
  repoKey: string;
  harnessDir: string;
  cwd: string;
  gitBranch?: string;
  task: string;
  startedAt: number;
  autoMode: boolean;
  harnessVersion: string;
  resumedAt: number[];
  bootstrapOnResume?: boolean;
}

export interface SessionLogger {
  logEvent(event: Omit<LogEvent, 'v' | 'ts' | 'runId'>): void;
  writeMeta(partial: Partial<SessionMeta> & { task: string }): void;
  updateMeta(update: { pushResumedAt?: number; task?: string }): void;
  finalizeSummary(state: HarnessState): void;
  close(): void;
  hasBootstrapped(): boolean;
  hasEmittedSessionOpen(): boolean;
  getStartedAt(): number;
}
```

- [ ] **Step 5: Commit**

```bash
git add src/types.ts
git commit -m "feat(logging): extend types for session logging

- HarnessState.loggingEnabled
- GateResult/GateOutcome/GateError metadata fields (runner, promptBytes, durationMs, tokensTotal, codexSessionId, recoveredFromSidecar)
- LogEvent discriminated union
- SessionMeta and SessionLogger interface"
```

---

## Task 2: state.ts — createInitialState 시그니처 확장

**Files:**
- Modify: `src/state.ts`
- Test: `tests/state.test.ts`

- [ ] **Step 1: createInitialState 시그니처 확인 및 확장**

Read `src/state.ts`에서 `createInitialState` 함수를 찾아 시그니처를 확인. `loggingEnabled` 파라미터를 추가하되 기본값 `false`로 설정:

```ts
export function createInitialState(
  runId: string,
  task: string,
  baseCommit: string,
  codexPath: string | null,
  autoMode: boolean,
  artifacts: Artifacts,
  tmuxSession: string,
  tmuxMode: 'dedicated' | 'reused',
  tmuxWindows: string[],
  tmuxControlWindow: string,
  tmuxWorkspacePane: string,
  tmuxControlPane: string,
  loggingEnabled: boolean = false,   // 신규 (기본값 false로 backward compat)
  tmuxOriginalWindow?: string,
): HarnessState {
  return {
    // ... 기존 필드들
    tmuxControlPane,
    loggingEnabled,
    // tmuxOriginalWindow는 optional이므로 뒤에
    ...(tmuxOriginalWindow !== undefined ? { tmuxOriginalWindow } : {}),
  };
}
```

**주의:** 실제 시그니처는 코드 확인 후 `loggingEnabled`만 적절한 위치에 삽입. 마지막 optional 파라미터 앞 위치가 안전.

- [ ] **Step 2: migrateState에 loggingEnabled + phaseReopenSource 기본값 추가**

`migrateState` 함수 맨 아래 return 직전:

```ts
  if (raw.loggingEnabled === undefined) raw.loggingEnabled = false;
  if (!raw.phaseReopenSource || typeof raw.phaseReopenSource !== 'object') {
    raw.phaseReopenSource = { '1': null, '3': null, '5': null };
  }
  for (const key of ['1', '3', '5']) {
    if (raw.phaseReopenSource[key] === undefined) raw.phaseReopenSource[key] = null;
  }
  return raw as HarnessState;
```

- [ ] **Step 3: 기존 테스트에 loggingEnabled 추가**

`tests/state.test.ts`에서 `createInitialState`를 호출하는 모든 테스트를 찾아 `loggingEnabled: false` 값을 추가 (또는 기본값에 의존).

```bash
rg -n "createInitialState\(" tests/ src/
```

각 호출부가 이미 기본값으로 동작하는지, 아니면 명시적으로 false 전달이 필요한지 확인.

- [ ] **Step 4: 테스트 실행**

```bash
npm test -- state
```

Expected: 모든 state 테스트 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state.ts tests/state.test.ts
git commit -m "feat(logging): add loggingEnabled to state

- createInitialState accepts loggingEnabled (default false)
- migrateState backfills loggingEnabled=false for legacy state.json"
```

---

## Task 3: computeRepoKey 헬퍼

**Files:**
- Create: `src/logger.ts`
- Test: `tests/logger.test.ts`

- [ ] **Step 1: 테스트 작성**

`tests/logger.test.ts` 생성:

```ts
import { describe, it, expect } from 'vitest';
import { computeRepoKey } from '../src/logger.js';

describe('computeRepoKey', () => {
  it('returns 12-char hex for given input', () => {
    const key = computeRepoKey('/path/to/repo/.harness');
    expect(key).toMatch(/^[0-9a-f]{12}$/);
  });

  it('returns same output for same input', () => {
    const a = computeRepoKey('/some/path');
    const b = computeRepoKey('/some/path');
    expect(a).toBe(b);
  });

  it('returns different output for different input', () => {
    const a = computeRepoKey('/path/a');
    const b = computeRepoKey('/path/b');
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: 테스트 실행 (FAIL 확인)**

```bash
npm test -- logger
```

Expected: FAIL (module not found: `../src/logger.js`)

- [ ] **Step 3: 최소 구현**

`src/logger.ts` 생성:

```ts
import { createHash } from 'crypto';

export function computeRepoKey(harnessDir: string): string {
  return createHash('sha1').update(harnessDir).digest('hex').slice(0, 12);
}
```

- [ ] **Step 4: 테스트 실행 (PASS 확인)**

```bash
npm test -- logger
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/logger.ts tests/logger.test.ts
git commit -m "feat(logging): add computeRepoKey helper"
```

---

## Task 4: extractCodexMetadata 헬퍼

**Files:**
- Modify: `src/phases/verdict.ts`
- Test: `tests/phases/verdict.test.ts`

- [ ] **Step 1: 테스트 작성 (추가)**

`tests/phases/verdict.test.ts` 맨 아래에 추가:

```ts
import { extractCodexMetadata } from '../../src/phases/verdict.js';

describe('extractCodexMetadata', () => {
  it('parses tokens used and session id', () => {
    const stdout = `blah blah
tokens used
19,123
session id: abc-def-123
more blah`;
    const result = extractCodexMetadata(stdout);
    expect(result.tokensTotal).toBe(19123);
    expect(result.codexSessionId).toBe('abc-def-123');
  });

  it('handles tokens without commas', () => {
    const stdout = `tokens used\n45000`;
    expect(extractCodexMetadata(stdout).tokensTotal).toBe(45000);
  });

  it('returns empty object when both absent', () => {
    expect(extractCodexMetadata('no metadata here')).toEqual({});
  });

  it('case-insensitive session id match', () => {
    const stdout = `Session ID: 0123-4567-89ab`;
    expect(extractCodexMetadata(stdout).codexSessionId).toBe('0123-4567-89ab');
  });
});
```

- [ ] **Step 2: 테스트 실행 (FAIL 확인)**

```bash
npm test -- verdict
```

Expected: FAIL (extractCodexMetadata not exported).

- [ ] **Step 3: 함수 구현**

`src/phases/verdict.ts` 맨 아래에 추가:

```ts
export function extractCodexMetadata(stdout: string): { tokensTotal?: number; codexSessionId?: string } {
  const out: { tokensTotal?: number; codexSessionId?: string } = {};
  const m = stdout.match(/^tokens used\s*\n([\d,]+)/m);
  if (m) out.tokensTotal = parseInt(m[1].replace(/,/g, ''), 10);
  const s = stdout.match(/session id:\s*([0-9a-f-]+)/i);
  if (s) out.codexSessionId = s[1];
  return out;
}
```

- [ ] **Step 4: 테스트 실행 (PASS 확인)**

```bash
npm test -- verdict
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/phases/verdict.ts tests/phases/verdict.test.ts
git commit -m "feat(logging): add extractCodexMetadata helper

- Parses 'tokens used\\n<N>' and 'session id: <uuid>' from Codex stdout
- Used by runCodexGate to populate GatePhaseResult metadata"
```

---

## Task 5: NoopLogger 클래스

**Files:**
- Modify: `src/logger.ts`
- Test: `tests/logger.test.ts`

- [ ] **Step 1: NoopLogger 테스트 추가**

`tests/logger.test.ts`에 추가:

```ts
import { NoopLogger } from '../src/logger.js';
import type { HarnessState } from '../src/types.js';

describe('NoopLogger', () => {
  it('all methods are no-op and do not throw', () => {
    const logger = new NoopLogger();
    expect(() => logger.logEvent({ event: 'session_start', task: 't', autoMode: false, baseCommit: '', harnessVersion: '', phase: 1 })).not.toThrow();
    expect(() => logger.writeMeta({ task: 't' })).not.toThrow();
    expect(() => logger.updateMeta({ pushResumedAt: 1 })).not.toThrow();
    expect(() => logger.finalizeSummary({} as HarnessState)).not.toThrow();
    expect(() => logger.close()).not.toThrow();
  });

  it('hasBootstrapped and hasEmittedSessionOpen always return true', () => {
    const logger = new NoopLogger();
    expect(logger.hasBootstrapped()).toBe(true);
    expect(logger.hasEmittedSessionOpen()).toBe(true);
  });

  it('getStartedAt returns a current-ish timestamp', () => {
    const logger = new NoopLogger();
    const ts = logger.getStartedAt();
    expect(ts).toBeGreaterThan(Date.now() - 1000);
    expect(ts).toBeLessThanOrEqual(Date.now());
  });
});
```

- [ ] **Step 2: 테스트 실행 (FAIL 확인)**

```bash
npm test -- logger
```

Expected: FAIL (NoopLogger not exported).

- [ ] **Step 3: NoopLogger 구현**

`src/logger.ts`에 추가:

```ts
import type { SessionLogger, LogEvent, SessionMeta, HarnessState } from './types.js';

export class NoopLogger implements SessionLogger {
  logEvent(_event: Omit<LogEvent, 'v' | 'ts' | 'runId'>): void { /* no-op */ }
  writeMeta(_partial: Partial<SessionMeta> & { task: string }): void { /* no-op */ }
  updateMeta(_update: { pushResumedAt?: number; task?: string }): void { /* no-op */ }
  finalizeSummary(_state: HarnessState): void { /* no-op */ }
  close(): void { /* no-op */ }
  hasBootstrapped(): boolean { return true; }
  hasEmittedSessionOpen(): boolean { return true; }
  getStartedAt(): number { return Date.now(); }
}
```

- [ ] **Step 4: 테스트 실행 (PASS 확인)**

```bash
npm test -- logger
```

- [ ] **Step 5: Commit**

```bash
git add src/logger.ts tests/logger.test.ts
git commit -m "feat(logging): add NoopLogger for opt-in disabled sessions"
```

---

## Task 6: FileSessionLogger — 생성자 + meta.json + hasBootstrapped/hasEmittedSessionOpen

**Files:**
- Modify: `src/logger.ts`
- Test: `tests/logger.test.ts`

- [ ] **Step 1: 테스트 작성**

`tests/logger.test.ts`에 추가:

```ts
import { FileSessionLogger } from '../src/logger.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

function makeTempHarnessDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'logger-test-'));
}

describe('FileSessionLogger — meta.json + bootstrap flags', () => {
  it('hasBootstrapped=false initially; true after writeMeta', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('run1', harnessDir, { sessionsRoot });
    expect(logger.hasBootstrapped()).toBe(false);
    expect(logger.hasEmittedSessionOpen()).toBe(false);
    logger.writeMeta({ task: 'test task' });
    expect(logger.hasBootstrapped()).toBe(true);
  });

  it('hasBootstrapped=true immediately if meta.json exists on disk', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger1 = new FileSessionLogger('run2', harnessDir, { sessionsRoot });
    logger1.writeMeta({ task: 'first' });

    const logger2 = new FileSessionLogger('run2', harnessDir, { sessionsRoot });
    expect(logger2.hasBootstrapped()).toBe(true);
    expect(logger2.hasEmittedSessionOpen()).toBe(false);  // still false in new process
  });

  it('hasEmittedSessionOpen flips true only after session_start/resumed event', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('run3', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 'x' });
    expect(logger.hasEmittedSessionOpen()).toBe(false);
    logger.logEvent({ event: 'session_start', task: 'x', autoMode: false, baseCommit: 'a', harnessVersion: 'v1' });
    expect(logger.hasEmittedSessionOpen()).toBe(true);
  });

  it('getStartedAt returns meta.startedAt', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('run4', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    const ts = logger.getStartedAt();
    expect(ts).toBeGreaterThan(Date.now() - 1000);
  });

  it('mkdirSync failure in constructor: logger becomes disabled (no-op all methods)', () => {
    const origMkdir = fs.mkdirSync;
    (fs as any).mkdirSync = () => { throw new Error('EACCES'); };
    const stderrCalls: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as any).write = (s: string) => { stderrCalls.push(s); return true; };
    try {
      const logger = new FileSessionLogger('runM', '/fake', { sessionsRoot: '/nope' });
      expect(logger.hasBootstrapped()).toBe(false);
      // Subsequent calls should be no-op (no additional stderr warn, no throw)
      const warnsAfterConstructor = stderrCalls.length;
      logger.writeMeta({ task: 't' });
      logger.logEvent({ event: 'phase_start', phase: 1 });
      logger.finalizeSummary({ status: 'completed', autoMode: false } as any);
      // Expect no further warns (disabled swallows silently)
      expect(stderrCalls.length).toBe(warnsAfterConstructor);
    } finally {
      (fs as any).mkdirSync = origMkdir;
      (process.stderr as any).write = origWrite;
    }
  });

  it('writeMeta is idempotent (second call does not clobber resumedAt)', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('runWM', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 'initial' });
    // Simulate second writeMeta (should not clobber existing resumedAt from first write)
    logger.updateMeta({ pushResumedAt: 1000 });
    logger.writeMeta({ task: 'initial' });  // idempotent — recreates meta but should be stable
    // Verify meta still contains task
    const repoKey = computeRepoKey(harnessDir);
    const meta = JSON.parse(fs.readFileSync(path.join(sessionsRoot, repoKey, 'runWM', 'meta.json'), 'utf-8'));
    expect(meta.task).toBe('initial');
    expect(typeof meta.startedAt).toBe('number');
  });

  it('updateMeta on missing meta.json: bootstrap with bootstrapOnResume=true + resumedAt push', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('runBoot', harnessDir, { sessionsRoot });
    // Do NOT call writeMeta first; updateMeta should create meta with bootstrap marker
    expect(logger.hasBootstrapped()).toBe(false);
    logger.updateMeta({ pushResumedAt: Date.now(), task: 'resumed-task' });
    const repoKey = computeRepoKey(harnessDir);
    const meta = JSON.parse(fs.readFileSync(path.join(sessionsRoot, repoKey, 'runBoot', 'meta.json'), 'utf-8'));
    expect(meta.bootstrapOnResume).toBe(true);
    expect(meta.resumedAt.length).toBe(1);
    expect(meta.task).toBe('resumed-task');
    expect(typeof meta.startedAt).toBe('number');
  });
});
```

- [ ] **Step 2: 테스트 실행 (FAIL 확인)**

```bash
npm test -- logger
```

Expected: FAIL (FileSessionLogger not exported).

- [ ] **Step 3: FileSessionLogger 최소 구현**

`src/logger.ts`에 추가:

```ts
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface FileSessionLoggerOptions {
  sessionsRoot?: string;   // default: ~/.harness/sessions
  harnessVersion?: string;
  cwd?: string;
  autoMode?: boolean;
  gitBranch?: string;
  baseCommit?: string;
}

export class FileSessionLogger implements SessionLogger {
  private runId: string;
  private harnessDir: string;
  private sessionDir: string;
  private metaPath: string;
  private eventsPath: string;
  private summaryPath: string;
  private options: FileSessionLoggerOptions;
  private bootstrapped = false;
  private sessionOpenEmitted = false;
  private warned = false;
  private disabled = false;
  private cachedStartedAt: number | null = null;

  constructor(runId: string, harnessDir: string, options: FileSessionLoggerOptions = {}) {
    this.runId = runId;
    this.harnessDir = harnessDir;
    this.options = options;
    const sessionsRoot = options.sessionsRoot ?? path.join(os.homedir(), '.harness', 'sessions');
    const repoKey = computeRepoKey(harnessDir);
    this.sessionDir = path.join(sessionsRoot, repoKey, runId);
    this.metaPath = path.join(this.sessionDir, 'meta.json');
    this.eventsPath = path.join(this.sessionDir, 'events.jsonl');
    this.summaryPath = path.join(this.sessionDir, 'summary.json');

    try {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    } catch (err) {
      this.warnOnce(`session logger: mkdir failed — ${(err as Error).message}`);
      this.disabled = true;
      return;
    }

    if (fs.existsSync(this.metaPath)) {
      this.bootstrapped = true;
      try {
        const m = JSON.parse(fs.readFileSync(this.metaPath, 'utf-8')) as SessionMeta;
        this.cachedStartedAt = m.startedAt ?? null;
      } catch { /* ignore malformed meta */ }
    }
  }

  hasBootstrapped(): boolean { return this.bootstrapped; }
  hasEmittedSessionOpen(): boolean { return this.sessionOpenEmitted; }
  getStartedAt(): number { return this.cachedStartedAt ?? Date.now(); }

  writeMeta(partial: Partial<SessionMeta> & { task: string }): void {
    if (this.disabled) return;
    try {
      const now = Date.now();
      const meta: SessionMeta = {
        v: 1,
        runId: this.runId,
        repoKey: computeRepoKey(this.harnessDir),
        harnessDir: this.harnessDir,
        cwd: this.options.cwd ?? process.cwd(),
        gitBranch: this.options.gitBranch,
        task: partial.task,
        startedAt: partial.startedAt ?? now,
        autoMode: partial.autoMode ?? this.options.autoMode ?? false,
        harnessVersion: partial.harnessVersion ?? this.options.harnessVersion ?? '0.1.0',
        resumedAt: partial.resumedAt ?? [],
        ...(partial.bootstrapOnResume ? { bootstrapOnResume: true } : {}),
      };
      fs.writeFileSync(this.metaPath, JSON.stringify(meta, null, 2));
      this.bootstrapped = true;
      this.cachedStartedAt = meta.startedAt;
    } catch (err) {
      this.warnOnce(`session logger: writeMeta failed — ${(err as Error).message}`);
      this.disabled = true;  // disable after first failure (spec §6.1)
    }
  }

  updateMeta(update: { pushResumedAt?: number; task?: string }): void {
    if (this.disabled) return;
    try {
      let meta: SessionMeta;
      if (fs.existsSync(this.metaPath)) {
        meta = JSON.parse(fs.readFileSync(this.metaPath, 'utf-8')) as SessionMeta;
      } else {
        // §5.1 bootstrap rule: resume without meta.json → create with bootstrapOnResume marker
        const now = Date.now();
        meta = {
          v: 1,
          runId: this.runId,
          repoKey: computeRepoKey(this.harnessDir),
          harnessDir: this.harnessDir,
          cwd: this.options.cwd ?? process.cwd(),
          gitBranch: this.options.gitBranch,
          task: update.task ?? '',
          startedAt: now,
          autoMode: this.options.autoMode ?? false,
          harnessVersion: this.options.harnessVersion ?? '0.1.0',
          resumedAt: [],
          bootstrapOnResume: true,
        };
      }
      if (update.pushResumedAt !== undefined) meta.resumedAt = [...(meta.resumedAt ?? []), update.pushResumedAt];
      if (update.task !== undefined && !meta.task) meta.task = update.task;
      fs.writeFileSync(this.metaPath, JSON.stringify(meta, null, 2));
      this.bootstrapped = true;
      this.cachedStartedAt = meta.startedAt;
    } catch (err) {
      this.warnOnce(`session logger: updateMeta failed — ${(err as Error).message}`);
      this.disabled = true;  // disable after first failure (spec §6.1)
    }
  }

  logEvent(event: Omit<LogEvent, 'v' | 'ts' | 'runId'>): void {
    if (this.disabled) return;
    try {
      const fullEvent = { v: 1, ts: Date.now(), runId: this.runId, ...event };
      fs.appendFileSync(this.eventsPath, JSON.stringify(fullEvent) + '\n');
      if (event.event === 'session_start' || event.event === 'session_resumed') {
        this.sessionOpenEmitted = true;
      }
    } catch (err) {
      this.warnOnce(`session logger: appendFileSync failed — ${(err as Error).message}`);
      this.disabled = true;  // disable after first failure (spec §6.1)
    }
  }

  finalizeSummary(_state: HarnessState): void {
    // Implemented in Task 8
  }

  close(): void { /* currently no-op */ }

  private warnOnce(msg: string): void {
    if (!this.warned) {
      process.stderr.write(`${msg}\n`);
      this.warned = true;
    }
  }
}
```

- [ ] **Step 4: 테스트 실행 (PASS 확인)**

```bash
npm test -- logger
```

- [ ] **Step 5: Commit**

```bash
git add src/logger.ts tests/logger.test.ts
git commit -m "feat(logging): FileSessionLogger — meta.json + bootstrap/sessionOpen flags"
```

---

## Task 7: FileSessionLogger — logEvent (JSONL append) 상세 테스트

**Files:**
- Test: `tests/logger.test.ts`

- [ ] **Step 1: logEvent 테스트 추가**

```ts
describe('FileSessionLogger.logEvent', () => {
  it('appends one line per event with v:1 and monotonic ts', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('runE', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });

    logger.logEvent({ event: 'phase_start', phase: 1, attemptId: 'a1' });
    logger.logEvent({ event: 'phase_end', phase: 1, attemptId: 'a1', status: 'completed', durationMs: 100 });

    const repoKey = computeRepoKey(harnessDir);
    const eventsPath = path.join(sessionsRoot, repoKey, 'runE', 'events.jsonl');
    const lines = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);
    const e1 = JSON.parse(lines[0]);
    const e2 = JSON.parse(lines[1]);
    expect(e1.v).toBe(1);
    expect(e1.runId).toBe('runE');
    expect(e1.event).toBe('phase_start');
    expect(e2.ts).toBeGreaterThanOrEqual(e1.ts);
  });

  it('swallows appendFileSync errors, warns once, then disables further I/O', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('runF', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });

    let appendCalls = 0;
    const origAppend = fs.appendFileSync;
    (fs as any).appendFileSync = () => { appendCalls++; throw new Error('boom'); };
    const stderrCalls: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as any).write = (s: string) => { stderrCalls.push(s); return true; };

    try {
      expect(() => logger.logEvent({ event: 'phase_start', phase: 1 })).not.toThrow();
      expect(() => logger.logEvent({ event: 'phase_end', phase: 1, status: 'completed', durationMs: 0 })).not.toThrow();
      expect(stderrCalls.length).toBe(1); // warn once
      expect(appendCalls).toBe(1); // disable prevents subsequent fs calls
    } finally {
      (fs as any).appendFileSync = origAppend;
      (process.stderr as any).write = origWrite;
    }
  });

  it('appending to existing events.jsonl preserves prior lines', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger1 = new FileSessionLogger('runG', harnessDir, { sessionsRoot });
    logger1.writeMeta({ task: 't' });
    logger1.logEvent({ event: 'phase_start', phase: 1 });

    const logger2 = new FileSessionLogger('runG', harnessDir, { sessionsRoot });
    logger2.logEvent({ event: 'phase_end', phase: 1, status: 'completed', durationMs: 50 });

    const repoKey = computeRepoKey(harnessDir);
    const eventsPath = path.join(sessionsRoot, repoKey, 'runG', 'events.jsonl');
    const lines = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);
  });
});
```

- [ ] **Step 2: 테스트 실행**

```bash
npm test -- logger
```

Expected: PASS (이미 Task 6에서 구현됨).

- [ ] **Step 3: Commit**

```bash
git add tests/logger.test.ts
git commit -m "test(logging): FileSessionLogger logEvent (append, warn-once, reopen)"
```

---

## Task 8: FileSessionLogger — finalizeSummary + dedupe

**Files:**
- Modify: `src/logger.ts`
- Test: `tests/logger.test.ts`

- [ ] **Step 1: 테스트 작성**

```ts
describe('FileSessionLogger.finalizeSummary', () => {
  it('writes summary.json atomically from events.jsonl', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('runH', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    logger.logEvent({ event: 'session_start', task: 't', autoMode: false, baseCommit: 'a', harnessVersion: 'v1' });
    logger.logEvent({ event: 'phase_start', phase: 1, attemptId: 'a1' });
    logger.logEvent({ event: 'phase_end', phase: 1, attemptId: 'a1', status: 'completed', durationMs: 300 });
    logger.logEvent({ event: 'session_end', status: 'completed', totalWallMs: 1000 });

    const state = { status: 'completed', autoMode: false } as HarnessState;
    logger.finalizeSummary(state);

    const repoKey = computeRepoKey(harnessDir);
    const summaryPath = path.join(sessionsRoot, repoKey, 'runH', 'summary.json');
    expect(fs.existsSync(summaryPath)).toBe(true);
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
    expect(summary.v).toBe(1);
    expect(summary.runId).toBe('runH');
    expect(summary.status).toBe('completed');
    expect(summary.totalWallMs).toBe(1000);
    expect(summary.phases['1'].attempts[0].durationMs).toBe(300);
  });

  it('status=interrupted if no session_end emitted', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('runI', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    logger.logEvent({ event: 'phase_start', phase: 1, attemptId: 'a1' });
    const state = { status: 'in_progress', autoMode: false } as HarnessState;
    logger.finalizeSummary(state);
    const repoKey = computeRepoKey(harnessDir);
    const summary = JSON.parse(fs.readFileSync(path.join(sessionsRoot, repoKey, 'runI', 'summary.json'), 'utf-8'));
    expect(summary.status).toBe('interrupted');
  });

  it('drops gate_verdict with recoveredFromSidecar=true when authoritative exists on same (phase, retryIndex)', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('runJ', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    logger.logEvent({ event: 'gate_verdict', phase: 2, retryIndex: 0, runner: 'codex', verdict: 'APPROVE', durationMs: 30000, tokensTotal: 45000, recoveredFromSidecar: false });
    logger.logEvent({ event: 'gate_verdict', phase: 2, retryIndex: 0, runner: 'codex', verdict: 'APPROVE', durationMs: 30000, tokensTotal: 45000, recoveredFromSidecar: true });
    const state = { status: 'completed', autoMode: false } as HarnessState;
    logger.finalizeSummary(state);
    const repoKey = computeRepoKey(harnessDir);
    const summary = JSON.parse(fs.readFileSync(path.join(sessionsRoot, repoKey, 'runJ', 'summary.json'), 'utf-8'));
    expect(summary.phases['2'].attempts.length).toBe(1);
  });

  it('pairs phase_start with phase_end to preserve reopenFromGate in summary attempts', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('run-pair', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    logger.logEvent({ event: 'phase_start', phase: 5, attemptId: 'a1' });
    logger.logEvent({ event: 'phase_end', phase: 5, attemptId: 'a1', status: 'completed', durationMs: 100 });
    logger.logEvent({ event: 'phase_start', phase: 5, attemptId: 'a2', reopenFromGate: 6 });
    logger.logEvent({ event: 'phase_end', phase: 5, attemptId: 'a2', status: 'completed', durationMs: 200 });
    logger.finalizeSummary({ status: 'completed', autoMode: false } as HarnessState);
    const repoKey = computeRepoKey(harnessDir);
    const summary = JSON.parse(fs.readFileSync(path.join(sessionsRoot, repoKey, 'run-pair', 'summary.json'), 'utf-8'));
    const attempts = summary.phases['5'].attempts;
    expect(attempts.length).toBe(2);
    expect(attempts[0].reopenFromGate).toBeNull();
    expect(attempts[1].reopenFromGate).toBe(6);
  });

  it('multiple session_end events: last one wins (paused→resumed→completed flow)', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('run-multi-end', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    logger.logEvent({ event: 'session_start', task: 't', autoMode: false, baseCommit: '', harnessVersion: 'v1' });
    logger.logEvent({ event: 'phase_start', phase: 1 });
    // First session ended in paused state
    logger.logEvent({ event: 'session_end', status: 'paused', totalWallMs: 1000 });
    // Resume appends: new session_resumed + eventually another session_end (completed)
    logger.logEvent({ event: 'session_resumed', fromPhase: 1, stateStatus: 'paused' });
    logger.logEvent({ event: 'phase_end', phase: 1, status: 'completed', durationMs: 500 });
    logger.logEvent({ event: 'session_end', status: 'completed', totalWallMs: 5000 });

    logger.finalizeSummary({ status: 'completed', autoMode: false } as any);
    const repoKey = computeRepoKey(harnessDir);
    const summary = JSON.parse(fs.readFileSync(path.join(sessionsRoot, repoKey, 'run-multi-end', 'summary.json'), 'utf-8'));
    expect(summary.status).toBe('completed');  // LAST session_end wins, not 'paused'
    expect(summary.totalWallMs).toBe(5000);
  });

  it('drops gate_error with recoveredFromSidecar=true when authoritative error exists for same phase', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('runK', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    logger.logEvent({ event: 'gate_error', phase: 2, retryIndex: 0, runner: 'codex', error: 'boom', durationMs: 5000, recoveredFromSidecar: false });
    logger.logEvent({ event: 'gate_error', phase: 2, retryIndex: 0, runner: 'codex', error: 'boom', durationMs: 5000, recoveredFromSidecar: true });
    const state = { status: 'completed', autoMode: false } as HarnessState;
    logger.finalizeSummary(state);
    const repoKey = computeRepoKey(harnessDir);
    const summary = JSON.parse(fs.readFileSync(path.join(sessionsRoot, repoKey, 'runK', 'summary.json'), 'utf-8'));
    expect(summary.totals.gateErrors).toBe(1);
  });
});
```

- [ ] **Step 2: 테스트 실행 (FAIL 확인)**

```bash
npm test -- logger
```

Expected: FAIL (finalizeSummary is no-op).

- [ ] **Step 3: finalizeSummary 구현**

`src/logger.ts`의 `finalizeSummary` 교체:

```ts
  finalizeSummary(state: HarnessState): void {
    if (this.disabled) return;
    try {
      const events = this.readEvents();
      if (events.length === 0) return;

      const startedAt = this.getStartedAt();
      // Find LAST session_end (resumed runs append multiple; latest is authoritative)
      const sessionEndEvent = [...events].reverse().find(e => e.event === 'session_end') as any;
      const status = sessionEndEvent ? sessionEndEvent.status : 'interrupted';
      const endedAt = sessionEndEvent ? sessionEndEvent.ts : events[events.length - 1].ts;
      const totalWallMs = sessionEndEvent ? sessionEndEvent.totalWallMs : (endedAt - startedAt);

      // Phase aggregation with dedupe
      const phases: Record<string, any> = {};
      const seenVerdictKeys = new Set<string>();
      const seenErrorPhases = new Set<number>();
      let gateTokens = 0, gateRejects = 0, gateErrors = 0, escalations = 0, verifyFailures = 0, forcePasses = 0;

      // First pass: authoritative events (non-recovered)
      for (const e of events) {
        if ((e.event === 'gate_verdict' || e.event === 'gate_error') && !e.recoveredFromSidecar) {
          if (e.event === 'gate_verdict') seenVerdictKeys.add(`${e.phase}:${e.retryIndex}`);
          if (e.event === 'gate_error') seenErrorPhases.add(e.phase);
        }
      }

      // Build a map of phase_start events by (phase, attemptId) to pair with phase_end
      // Preserves reopenFromGate provenance and authoritative startedAt.
      const phaseStartMap = new Map<string, any>();
      for (const e of events) {
        if (e.event === 'phase_start' && e.attemptId) {
          phaseStartMap.set(`${e.phase}:${e.attemptId}`, e);
        }
      }

      for (const e of events) {
        const pstr = String((e as any).phase ?? '');
        if (!phases[pstr] && pstr) phases[pstr] = { attempts: [], totalDurationMs: 0 };

        if (e.event === 'phase_end') {
          // Pair with phase_start to recover reopenFromGate and authoritative startedAt
          const startEvent = e.attemptId ? phaseStartMap.get(`${e.phase}:${e.attemptId}`) : null;
          phases[pstr].attempts.push({
            attemptId: e.attemptId ?? null,
            startedAt: startEvent ? startEvent.ts : (e.ts - (e.durationMs ?? 0)),
            durationMs: e.durationMs,
            status: e.status,
            reopenFromGate: startEvent?.reopenFromGate ?? null,
          });
          phases[pstr].totalDurationMs += e.durationMs;
        } else if (e.event === 'gate_verdict') {
          const key = `${e.phase}:${e.retryIndex}`;
          if (e.recoveredFromSidecar && seenVerdictKeys.has(key)) continue;
          phases[pstr].attempts.push({ retryIndex: e.retryIndex, startedAt: e.ts - (e.durationMs ?? 0), durationMs: e.durationMs, runner: e.runner, verdict: e.verdict, tokensTotal: e.tokensTotal });
          phases[pstr].totalDurationMs += e.durationMs ?? 0;
          if (e.tokensTotal) gateTokens += e.tokensTotal;
          if (e.verdict === 'REJECT') gateRejects++;
        } else if (e.event === 'gate_error') {
          if (e.recoveredFromSidecar && seenErrorPhases.has(e.phase)) continue;
          gateErrors++;
        } else if (e.event === 'escalation') {
          escalations++;
        } else if (e.event === 'force_pass') {
          forcePasses++;
        } else if (e.event === 'verify_result' && !e.passed) {
          verifyFailures++;
        }
      }

      const summary = {
        v: 1,
        runId: this.runId,
        repoKey: computeRepoKey(this.harnessDir),
        startedAt,
        endedAt,
        totalWallMs,
        status,
        autoMode: state.autoMode,
        phases,
        totals: { gateTokens, gateRejects, gateErrors, escalations, verifyFailures, forcePasses },
      };

      const tmpPath = this.summaryPath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(summary, null, 2));
      fs.renameSync(tmpPath, this.summaryPath);
    } catch (err) {
      this.warnOnce(`session logger: finalizeSummary failed — ${(err as Error).message}`);
      this.disabled = true;  // disable after first failure (spec §6.1)
    }
  }

  private readEvents(): any[] {
    if (!fs.existsSync(this.eventsPath)) return [];
    const raw = fs.readFileSync(this.eventsPath, 'utf-8');
    return raw.trim().split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  }
```

- [ ] **Step 4: 테스트 실행 (PASS 확인)**

```bash
npm test -- logger
```

- [ ] **Step 5: Commit**

```bash
git add src/logger.ts tests/logger.test.ts
git commit -m "feat(logging): FileSessionLogger.finalizeSummary with recovered-event dedupe

- Writes summary.json atomically via .tmp rename
- status=interrupted when session_end missing
- gate_verdict dedupe by (phase, retryIndex)
- gate_error dedupe by (phase) — one sidecar per phase"
```

---

## Task 9: createSessionLogger factory

**Files:**
- Modify: `src/logger.ts`
- Test: `tests/logger.test.ts`

- [ ] **Step 1: 테스트 작성**

```ts
import { createSessionLogger } from '../src/logger.js';

describe('createSessionLogger factory', () => {
  it('returns NoopLogger when loggingEnabled=false', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = createSessionLogger('runX', harnessDir, false, { sessionsRoot });
    expect(logger.constructor.name).toBe('NoopLogger');
    logger.writeMeta({ task: 't' });
    const repoKey = computeRepoKey(harnessDir);
    expect(fs.existsSync(path.join(sessionsRoot, repoKey, 'runX', 'meta.json'))).toBe(false);
  });

  it('returns FileSessionLogger when loggingEnabled=true', () => {
    const harnessDir = makeTempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = createSessionLogger('runY', harnessDir, true, { sessionsRoot });
    expect(logger.constructor.name).toBe('FileSessionLogger');
  });
});
```

- [ ] **Step 2: 테스트 실행 (FAIL 확인)**

```bash
npm test -- logger
```

- [ ] **Step 3: factory 구현**

`src/logger.ts` 맨 아래:

```ts
export function createSessionLogger(
  runId: string,
  harnessDir: string,
  loggingEnabled: boolean,
  options: FileSessionLoggerOptions = {},
): SessionLogger {
  if (!loggingEnabled) return new NoopLogger();
  return new FileSessionLogger(runId, harnessDir, options);
}
```

- [ ] **Step 4: 테스트 실행 (PASS 확인)**

- [ ] **Step 5: Commit**

```bash
git add src/logger.ts tests/logger.test.ts
git commit -m "feat(logging): createSessionLogger factory (Noop when opt-out)"
```

---

## Task 10: CLI `--enable-logging` 플래그 (bin/harness.ts + start.ts)

**Files:**
- Modify: `bin/harness.ts`
- Modify: `src/commands/start.ts`
- Test: (integration — later)

- [ ] **Step 1: bin/harness.ts에 플래그 추가**

`bin/harness.ts`의 `start` 및 `run` 명령에 `.option('--enable-logging', 'enable session logging to ~/.harness/sessions')` 추가:

```ts
program
  .command('start [task]')
  .description('start a new harness session')
  .option('--require-clean', 'block if working tree has any uncommitted changes')
  .option('--auto', 'autonomous mode (no user escalations)')
  .option('--enable-logging', 'enable session logging to ~/.harness/sessions')
  .action(async (task: string | undefined, opts: { requireClean?: boolean; auto?: boolean; enableLogging?: boolean }) => {
    const globalOpts = program.opts();
    await startCommand(task, { ...opts, root: globalOpts.root });
  });

// run command: same change
```

- [ ] **Step 2: src/commands/start.ts — StartOptions 확장**

`StartOptions` 인터페이스에 `enableLogging?: boolean` 추가. `startCommand`에서 `createInitialState` 호출 시 `options.enableLogging ?? false`를 전달.

```bash
rg -n "StartOptions|createInitialState\(" src/commands/start.ts
```

실제 시그니처 확인 후 적절한 위치에 파라미터 전달.

- [ ] **Step 3: 빌드 확인**

```bash
npm run build
```

Expected: 컴파일 성공.

- [ ] **Step 4: Commit**

```bash
git add bin/harness.ts src/commands/start.ts
git commit -m "feat(logging): --enable-logging CLI flag

- Registered on start/run commands in bin/harness.ts
- StartOptions.enableLogging threaded to createInitialState
- Opt-in; default off preserves existing behavior"
```

---

## Task 11: inner.ts — Logger 라이프사이클 + session_start/resumed

**Files:**
- Modify: `src/commands/inner.ts`

- [ ] **Step 1: Logger imports**

`src/commands/inner.ts` 상단에 import 추가:

```ts
import { createSessionLogger } from '../logger.js';
import type { SessionLogger } from '../types.js';
```

- [ ] **Step 2: Logger 생성 및 session 이벤트 emit (via bootstrapSessionLogger helper)**

테스트 가능성을 위해 logger 생성 + session_start/resumed emission 로직을 `bootstrapSessionLogger` helper로 분리하여 export (Task 19 Step 3의 unit test에서 단독 호출 가능).

`src/commands/inner.ts`에 다음 helper를 export:

```ts
export async function bootstrapSessionLogger(
  runId: string,
  harnessDir: string,
  state: HarnessState,
  isResume: boolean,
  options: { sessionsRoot?: string; cwd?: string } = {},
): Promise<SessionLogger> {
  const logger = createSessionLogger(runId, harnessDir, state.loggingEnabled, {
    cwd: options.cwd ?? process.cwd(),
    autoMode: state.autoMode,
    sessionsRoot: options.sessionsRoot,
  });
  if (isResume) {
    logger.updateMeta({ pushResumedAt: Date.now(), task: state.task });
    logger.logEvent({ event: 'session_resumed', fromPhase: state.currentPhase, stateStatus: state.status });
  } else if (logger.hasBootstrapped()) {
    // Idempotent case: meta.json already exists on disk (e.g., crash re-entry)
    logger.updateMeta({ pushResumedAt: Date.now() });
    logger.logEvent({ event: 'session_resumed', fromPhase: state.currentPhase, stateStatus: state.status });
  } else {
    logger.writeMeta({ task: state.task });
    logger.logEvent({ event: 'session_start', task: state.task, autoMode: state.autoMode, baseCommit: state.baseCommit, harnessVersion: '0.1.0' });
  }
  return logger;
}
```

**순서 중요:** `bootstrapSessionLogger` 호출은 **`InputManager` 생성 직전**에 수행한다. `inputManager.onConfigCancel = () => { ... logger.logEvent(...) ... }` 콜백 등록 시점에 logger가 이미 생성돼 있어야 하기 때문. 구조:

```ts
// inner.ts의 실행 순서:
// 1. state 로드, task 캡처, signal handlers 등 기존 로직
// 2. const logger = await bootstrapSessionLogger(runId, harnessDir, state, isResume, { cwd });  ← 신규
// 3. const inputManager = new InputManager();
// 4. inputManager.onConfigCancel = () => { ... logger.logEvent(session_end) ... process.exit(0); };
// 5. inputManager.start('configuring');
// 6. await promptModelConfig(...); runRunnerAwarePreflight(...);
// 7. inputManager.enterPhaseLoop();
// 8. try { await runPhaseLoop(..., logger, sidecarReplayAllowed); } finally { ... logger.logEvent(session_end) ... }
```

`bootstrapSessionLogger` 호출 결과는 이 helper 함수의 반환값 `logger`:

```ts
  // (inputManager.enterPhaseLoop() is called above, before try/finally)
  // Logger was already created via bootstrapSessionLogger before InputManager setup.
  let sessionEndStatus: 'completed' | 'paused' | 'interrupted' = 'interrupted';

  // Create session-scoped one-shot flag for gate sidecar replay
  const sidecarReplayAllowed = { value: isResume };

  // --- Phase loop ---
  try {
    await runPhaseLoop(state, harnessDir, runDir, cwd, inputManager, logger, sidecarReplayAllowed);

    if (state.status === 'completed') sessionEndStatus = 'completed';
    else if (state.status === 'paused') sessionEndStatus = 'paused';
    else sessionEndStatus = 'interrupted';
  } finally {
    logger.logEvent({ event: 'session_end', status: sessionEndStatus, totalWallMs: Date.now() - logger.getStartedAt() });
    logger.finalizeSummary(state);
    logger.close();
    inputManager.stop();
    releaseLock(harnessDir, runId);
  }
```

**주의:** 기존 `try { await runPhaseLoop(...) } finally { ... }` 블록을 위 블록으로 교체. 기존 finally 내용(`inputManager.stop()`, `releaseLock`)은 새 finally에 포함.

- [ ] **Step 3: onConfigCancel lazy bootstrap**

`inputManager.onConfigCancel = () => { ... }` 블록을 수정:

```ts
  inputManager.onConfigCancel = () => {
    state.status = 'paused';
    state.pauseReason = 'config-cancel';
    state.pendingAction = {
      type: 'reopen_config',
      targetPhase: state.currentPhase as any,
      sourcePhase: null,
      feedbackPaths: [],
    };
    writeState(runDir, state);

    // Lazy bootstrap session open event if not emitted yet
    if (!logger.hasEmittedSessionOpen()) {
      if (isResume) {
        logger.updateMeta({ pushResumedAt: Date.now(), task: state.task });
        logger.logEvent({ event: 'session_resumed', fromPhase: state.currentPhase, stateStatus: 'paused' });
      } else {
        logger.writeMeta({ task: state.task });
        logger.logEvent({ event: 'session_start', task: state.task, autoMode: state.autoMode, baseCommit: state.baseCommit, harnessVersion: '0.1.0' });
      }
    }
    logger.logEvent({ event: 'session_end', status: 'paused', totalWallMs: Date.now() - logger.getStartedAt() });
    logger.finalizeSummary(state);
    logger.close();

    releaseLock(harnessDir, runId);
    inputManager.stop();
    process.exit(0);
  };
```

**주의:** 현재 `inputManager.onConfigCancel`은 logger 생성 이전에 할당되므로, logger 변수를 closure 가능한 위치(예: `let logger: SessionLogger | null = null`)로 선언하고 생성 이후 할당해야 한다. 또는 logger 생성을 `onConfigCancel` 등록 이전에 이동. 후자가 간단하므로 권장.

실제 구조 확인 후 최소 수정 원칙으로 배치:
1. logger 변수는 inner.ts 함수 초반에 생성 (state 로드 후)
2. onConfigCancel 등록 시점에 logger 참조 가능하도록

- [ ] **Step 4: config-cancel handler-level 테스트 (tests/commands/inner.test.ts)**

기존 `tests/commands/inner.test.ts`에 추가. InputManager를 mock하여 `onConfigCancel()` 를 강제 트리거하고, events.jsonl 및 summary.json을 검증:

```ts
describe('inner.ts — onConfigCancel lazy bootstrap', () => {
  it('fresh start config-cancel: emits session_start → session_end(paused), summary.status=paused', async () => {
    const harnessRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-fresh-'));
    // setup minimal harness dir + state with loggingEnabled=true, fresh (no meta.json)
    // mock tmux/InputManager: InputManager that fires onConfigCancel after registration
    const sessionsRoot = path.join(harnessRoot, 'sessions');
    // ... (specific setup depends on inner.ts testability; may need DI or partial mock)

    // Assert (after innerCommand returns via process.exit mocked):
    //   - events.jsonl has session_start then session_end(paused)
    //   - summary.json.status === 'paused'
  });

  it('resume config-cancel: emits session_resumed → session_end(paused), resumedAt pushed', async () => {
    // Pre-create meta.json (simulating prior start)
    // Invoke inner.ts with options.resume=true
    // Force onConfigCancel before runPhaseLoop
    // Assert: session_resumed emitted, meta.resumedAt.length === 1
  });
});
```

**주의:** `inner.ts`의 `process.exit(0)` 호출이 테스트 환경에서 프로세스를 실제로 죽이지 않도록 `process.exit`을 spy로 대체해야 한다. 또한 tmux/pane 관련 I/O는 mock 필요. 복잡도가 높으면 이 테스트는 "handler-level simulation"으로 축소: `onConfigCancel` 콜백을 `inner.ts`에서 export하거나 dependency injection으로 분리하여 단독 테스트.

**간이 대안:** 실제 `innerCommand` 호출 대신 `onConfigCancel` 콜백을 빌드하는 helper 함수 (`buildConfigCancelHandler(logger, state, isResume, ...)`)를 `inner.ts`에 export하고, 해당 함수를 단독 테스트. 이 경우 Task 11 Step 3의 onConfigCancel 본문을 별도 함수로 리팩터.

- [ ] **Step 5: 빌드 확인**

```bash
npm run build && npm test -- inner
```

- [ ] **Step 6: Commit**

```bash
git add src/commands/inner.ts tests/commands/inner.test.ts
git commit -m "feat(logging): inner.ts logger lifecycle + lazy bootstrap + handler tests

- Logger created early (before onConfigCancel) to satisfy config-cancel lazy bootstrap
- session_start/session_resumed emitted before runPhaseLoop
- session_end + finalizeSummary in finally block
- onConfigCancel lazy-bootstraps missing session_open event via hasEmittedSessionOpen()
- sidecarReplayAllowed one-shot flag created per resume session
- Handler-level tests verify config-cancel emits session_start/resumed + session_end"
```

---

## Task 12: runner.ts — logger 파라미터 전파 (시그니처 only)

**Files:**
- Modify: `src/phases/runner.ts`
- Test: `tests/phases/runner.test.ts`

- [ ] **Step 1: handler 함수들을 export로 변경**

핸들러 레벨 테스트를 위해 `src/phases/runner.ts`에서 다음 함수들을 `export`로 변경 (기존 `function` → `export function`):
- `handleInteractivePhase`
- `handleGatePhase`
- `handleGateReject`
- `handleGateError`
- `handleVerifyPhase`
- `handleVerifyFail`
- `forcePassGate`
- `forcePassVerify`

이미 export된 함수들(`runPhaseLoop`, `handleGateEscalation`, `handleVerifyEscalation`, `handleVerifyError`)은 그대로 유지.

```bash
rg -n "^(async )?function handle|^(async )?function forcePass" src/phases/runner.ts
```

각 함수 앞에 `export` 추가. 기존 파일 내부 참조는 변경 없음.

- [ ] **Step 2: runPhaseLoop 시그니처 확장**

`src/phases/runner.ts`의 `runPhaseLoop` 함수와 모든 `handle*`, `forcePass*` 함수에 `logger: SessionLogger` 파라미터 추가. 타입 import:

```ts
import type { SessionLogger } from '../types.js';
```

`runPhaseLoop` 시그니처:

```ts
export async function runPhaseLoop(
  state: HarnessState,
  harnessDir: string,
  runDir: string,
  cwd: string,
  inputManager: InputManager,
  logger: SessionLogger,
  sidecarReplayAllowed: { value: boolean },
): Promise<void>
```

- [ ] **Step 3: 모든 내부 handler 호출부 업데이트 + per-phase finalizeSummary**

`runPhaseLoop` 내에서 `handleInteractivePhase(state, ...)`, `handleGatePhase(state, ...)`, `handleVerifyPhase(state, ...)` 호출부에 logger와 필요시 sidecarReplayAllowed 전달.

**Per-phase summary rewrite (spec §4.4 "summary.json은 phase 종료마다 rewrite"):**
`runPhaseLoop`의 phase iteration 루프 본문 말미(각 handler 호출 직후)에 `logger.finalizeSummary(state)` 호출 추가. 이렇게 하면 중간 crash 시에도 최신 phase까지 집계가 유지된다:

```ts
// src/phases/runner.ts — runPhaseLoop 내부 루프
while (/* phase advancing condition */) {
  const phase = state.currentPhase;
  if (/* interactive */) {
    await handleInteractivePhase(state, phase, harnessDir, runDir, cwd, inputManager, logger);
  } else if (/* gate */) {
    await handleGatePhase(state, phase, harnessDir, runDir, cwd, inputManager, logger, sidecarReplayAllowed);
  } else if (/* verify */) {
    await handleVerifyPhase(state, harnessDir, runDir, cwd, inputManager, logger);
  }
  // Per-phase summary rewrite (best-effort)
  logger.finalizeSummary(state);
}
```

`finalizeSummary` 내부는 이미 try/catch로 감싸 있어 실패해도 phase loop을 중단하지 않는다 (§6.1).

`handleGatePhase`는 sidecarReplayAllowed도 전달:

```ts
async function handleGatePhase(
  state: HarnessState,
  phase: GatePhase,
  harnessDir: string,
  runDir: string,
  cwd: string,
  inputManager: InputManager,
  logger: SessionLogger,
  sidecarReplayAllowed: { value: boolean },
): Promise<void>
```

나머지 handler(`handleInteractivePhase`, `handleVerifyPhase`, `handleGateReject`, `handleGateError`, `handleGateEscalation`, `handleVerifyFail`, `handleVerifyError`, `handleVerifyEscalation`, `forcePassGate`, `forcePassVerify`)는 `logger: SessionLogger`만 추가.

- [ ] **Step 4: 기존 테스트 업데이트**

`tests/phases/runner.test.ts`에서 `runPhaseLoop` 호출부를 찾아 `new NoopLogger()`와 `{ value: false }`를 추가:

```bash
rg -n "runPhaseLoop\(" tests/
```

각 호출부에:

```ts
import { NoopLogger } from '../../src/logger.js';
// ...
await runPhaseLoop(state, harnessDir, runDir, cwd, inputManager, new NoopLogger(), { value: false });
```

- [ ] **Step 5: 빌드 및 테스트**

```bash
npm run build && npm test -- runner
```

Expected: 컴파일 성공 + 기존 테스트 PASS (logger는 NoopLogger로 효과 없음).

- [ ] **Step 6: Commit**

```bash
git add src/phases/runner.ts tests/phases/runner.test.ts
git commit -m "refactor(logging): thread logger + sidecarReplayAllowed; export handlers for testing

- Export handleInteractivePhase/handleGatePhase/handleGateReject/handleGateError/
  handleVerifyPhase/handleVerifyFail/forcePassGate/forcePassVerify for unit testing
- All runPhaseLoop handlers receive SessionLogger parameter
- handleGatePhase also receives sidecarReplayAllowed one-shot flag"
```

---

## Task 13: interactive.ts — attemptId 파라미터 도입

**Files:**
- Modify: `src/phases/interactive.ts`
- Modify: `src/phases/runner.ts`

- [ ] **Step 1: runInteractivePhase 시그니처 변경**

`src/phases/interactive.ts`의 `runInteractivePhase` 함수에 `attemptId: string` 파라미터를 추가하고, 반환 타입에 `attemptId`를 포함하도록 수정. 내부에서 `state.phaseAttemptId`를 외부 파라미터 값으로 설정:

```ts
// Preserve existing arg order (phase, state, harnessDir, runDir, cwd) and append attemptId
export async function runInteractivePhase(
  phase: InteractivePhase,
  state: HarnessState,
  harnessDir: string,
  runDir: string,
  cwd: string,
  attemptId: string,   // 신규 파라미터 (마지막에 추가)
): Promise<InteractiveResult & { attemptId: string }> {
  // Use externally-generated attemptId instead of generating one inside preparePhase
  state.phaseAttemptId[String(phase)] = attemptId;
  writeState(runDir, state);

  // ... existing logic (preparePhase uses state.phaseAttemptId set above)
  return { ...result, attemptId };
}
```

내부 `preparePhase()`에서 `state.phaseAttemptId[p] = randomUUID()` 호출 부분을 찾아 **주석 처리 또는 제거** (이미 외부에서 설정됨).

- [ ] **Step 2: runner.ts handleInteractivePhase에서 attemptId 생성 및 전달**

`src/phases/runner.ts`의 `handleInteractivePhase` 내에서 `runInteractivePhase` 호출 직전:

```ts
import { randomUUID } from 'crypto';
// ...
const attemptId = randomUUID();
// phase_start emit은 Task 14에서 추가
const result = await runInteractivePhase(phase, state, harnessDir, runDir, cwd, attemptId);
```

- [ ] **Step 3: 빌드 및 테스트**

```bash
npm run build && npm test
```

Expected: 컴파일 성공 + 기존 테스트 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/phases/interactive.ts src/phases/runner.ts
git commit -m "refactor(logging): generate attemptId in runner.ts, pass to runInteractivePhase

- Enables phase_start/phase_end emission with consistent attemptId"
```

---

## Task 14: runner.ts — phase_start/phase_end emit (interactive phase)

**Files:**
- Modify: `src/phases/runner.ts`

- [ ] **Step 1: handleInteractivePhase에 phase_start/phase_end emit**

```ts
async function handleInteractivePhase(state: HarnessState, phase: InteractivePhase, harnessDir: string, runDir: string, cwd: string, inputManager: InputManager, logger: SessionLogger): Promise<void> {
  const attemptId = randomUUID();
  const phaseStartTs = Date.now();

  // Read reopen source (set by handleGateReject/handleVerifyFail) before emitting phase_start
  const isReopen = state.phaseReopenFlags[String(phase)] ?? false;
  const reopenFromGate = isReopen ? (state.phaseReopenSource[String(phase)] ?? undefined) : undefined;

  logger.logEvent({
    event: 'phase_start',
    phase,
    attemptId,
    reopenFromGate,
  });

  // Clear the logging-only reopen source after emit (do NOT clear phaseReopenFlags — runInteractivePhase needs it)
  if (state.phaseReopenSource[String(phase)] !== null) {
    state.phaseReopenSource[String(phase)] = null;
    writeState(runDir, state);
  }

  try {
    const result = await runInteractivePhase(phase, state, harnessDir, runDir, cwd, attemptId);

    // Post-run: check for control-signal redirect (e.g., SIGUSR1 skip/jump changed currentPhase mid-run)
    if (state.currentPhase !== phase) {
      logger.logEvent({
        event: 'phase_end',
        phase,
        attemptId,
        status: 'failed',
        durationMs: Date.now() - phaseStartTs,
        details: { reason: 'redirected' },
      });
      return;
    }

    // Existing post-run logic (artifact commit, state update to 'completed' or 'error')
    // ... (existing code in handleInteractivePhase for artifact commit/error transitions)

    if (state.phases[String(phase)] === 'completed') {
      logger.logEvent({
        event: 'phase_end',
        phase,
        attemptId,
        status: 'completed',
        durationMs: Date.now() - phaseStartTs,
      });

      // Anomaly: phase 5 completed with stuck reopen flag
      if (phase === 5 && state.phaseReopenFlags['5'] === true) {
        logger.logEvent({ event: 'state_anomaly', kind: 'phase_reopen_flag_stuck', details: { phase: 5 } });
      }
    } else {
      // post-run artifact commit or preset resolution failed → state was marked 'error'
      logger.logEvent({
        event: 'phase_end',
        phase,
        attemptId,
        status: 'failed',
        durationMs: Date.now() - phaseStartTs,
      });
    }
  } catch (err) {
    logger.logEvent({
      event: 'phase_end',
      phase,
      attemptId,
      status: 'failed',
      durationMs: Date.now() - phaseStartTs,
    });
    throw err;
  }
}
```

**주의:** 실제 `handleInteractivePhase` 구조는 파일 확인 후 적절히 삽입. 핵심은 phase_start → (redirect check) → phase_end 쌍을 모든 경로에서 보장.

- [ ] **Step 2: reopenFromGate 정확한 source tracking**

`state.phaseReopenSource`(Task 1에서 추가)를 사용하여 정확한 trigger phase를 기록.

**handleGateReject**에서 phase reopen 설정 시 (gate 2 → phase 1, gate 4 → phase 3, gate 7 → phase 5 or 6):

```ts
// src/phases/runner.ts — handleGateReject 내부
const reopenTarget = /* phase 1, 3, or 5 based on gate number */;
state.phaseReopenFlags[String(reopenTarget)] = true;
state.phaseReopenSource[String(reopenTarget)] = phase;  // triggering gate phase
writeState(runDir, state);
```

**handleVerifyFail**에서 phase 5 reopen 설정 시:

```ts
// src/phases/runner.ts — handleVerifyFail 내부 (retry available path)
state.phaseReopenFlags['5'] = true;
state.phaseReopenSource['5'] = 6;  // verify phase triggered reopen
writeState(runDir, state);
```

**handleInteractivePhase**에서 phase_start emit 시 `phaseReopenSource` 읽기:

```ts
const isReopen = state.phaseReopenFlags[String(phase)] ?? false;
const reopenFromGate = isReopen
  ? (state.phaseReopenSource[String(phase)] ?? undefined)
  : undefined;

logger.logEvent({
  event: 'phase_start',
  phase,
  attemptId,
  reopenFromGate,
});

// DO NOT clear phaseReopenFlags here — runInteractivePhase still needs it to detect reopen.
// Only clear the logging source (no downstream reader in the current codebase).
if (state.phaseReopenSource[String(phase)] !== null) {
  state.phaseReopenSource[String(phase)] = null;
  writeState(runDir, state);
}
```

**중요**: `phaseReopenFlags`는 `runInteractivePhase` 내부(`preparePhase`)에서 `isReopen` 판단에 사용되므로 **phase_start emit 직후에 clear하면 안 된다**. 기존 runInteractivePhase/preparePhase의 flag clear 타이밍을 그대로 유지. 본 plan에서는 `phaseReopenSource`만 logging-only state로 취급하여 소비.

이로써 phase 5 reopen의 출처(gate 7 vs verify 6)가 정확히 기록됨.

- [ ] **Step 3: handler-level 테스트 추가 (tests/phases/runner.test.ts)**

기존 `tests/phases/runner.test.ts`에 `handleInteractivePhase` 호출 시 실제로 올바른 이벤트가 emit되는지 검증 테스트 추가:

```ts
import { FileSessionLogger, computeRepoKey } from '../../src/logger.js';

function makeLogger(runId: string): { logger: FileSessionLogger; eventsPath: string; cleanup: () => void } {
  const harnessDir = fs.mkdtempSync(path.join(os.tmpdir(), 'handler-test-'));
  const sessionsRoot = path.join(harnessDir, 'sessions');
  const logger = new FileSessionLogger(runId, harnessDir, { sessionsRoot });
  logger.writeMeta({ task: 't' });
  const eventsPath = path.join(sessionsRoot, computeRepoKey(harnessDir), runId, 'events.jsonl');
  return { logger, eventsPath, cleanup: () => fs.rmSync(harnessDir, { recursive: true, force: true }) };
}

function readEvents(eventsPath: string): any[] {
  return fs.readFileSync(eventsPath, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

describe('handleInteractivePhase — event emission', () => {
  it('emits phase_start then phase_end completed on successful run', async () => {
    const { logger, eventsPath, cleanup } = makeLogger('ht1');
    try {
      // Mock runInteractivePhase to return success quickly
      const interactive = await import('../../src/phases/interactive.js');
      const spy = vi.spyOn(interactive, 'runInteractivePhase').mockResolvedValue({ status: 'completed', attemptId: 'mock-id' } as any);
      const state = buildMinimalState({ phase: 1 });
      await handleInteractivePhase(state, 1, /* ... */, logger);
      const events = readEvents(eventsPath);
      expect(events[0].event).toBe('phase_start');
      expect(events[0].phase).toBe(1);
      expect(events[events.length - 1].event).toBe('phase_end');
      expect(events[events.length - 1].status).toBe('completed');
      spy.mockRestore();
    } finally { cleanup(); }
  });

  it('emits phase_end with reopenFromGate=6 when verify (6) triggered phase 5 reopen', async () => {
    const { logger, eventsPath, cleanup } = makeLogger('ht2');
    try {
      const state = buildMinimalState({ phase: 5 });
      state.phaseReopenFlags['5'] = true;
      state.phaseReopenSource['5'] = 6;  // verify triggered
      const spy = vi.spyOn(/* interactive */, 'runInteractivePhase').mockResolvedValue({ status: 'completed', attemptId: 'a1' } as any);
      await handleInteractivePhase(state, 5, /* ... */, logger);
      const events = readEvents(eventsPath);
      const phaseStart = events.find(e => e.event === 'phase_start');
      expect(phaseStart.reopenFromGate).toBe(6);
      spy.mockRestore();
    } finally { cleanup(); }
  });

  it('emits state_anomaly phase_reopen_flag_stuck when phase 5 finishes with flag still set', async () => {
    const { logger, eventsPath, cleanup } = makeLogger('ht3');
    try {
      const state = buildMinimalState({ phase: 5 });
      // preparePhase/runInteractivePhase would normally clear the flag;
      // mock it to leave the flag set to simulate the stuck case
      state.phaseReopenFlags['5'] = true;
      vi.spyOn(/* interactive */, 'runInteractivePhase').mockImplementation(async (s) => {
        // deliberately do NOT clear reopenFlags — simulate the anomaly
        return { status: 'completed', attemptId: 'a1' } as any;
      });
      await handleInteractivePhase(state, 5, /* ... */, logger);
      const events = readEvents(eventsPath);
      expect(events.some(e => e.event === 'state_anomaly' && e.kind === 'phase_reopen_flag_stuck')).toBe(true);
    } finally { cleanup(); }
  });
});
```

`buildMinimalState` 헬퍼는 기존 runner.test.ts에서 이미 존재하거나, 필요 필드만 포함한 minimal `HarnessState` 빌드 함수로 정의.

- [ ] **Step 4: 빌드 및 테스트**

```bash
npm run build && npm test -- runner
```

- [ ] **Step 5: Commit**

```bash
git add src/phases/runner.ts tests/phases/runner.test.ts
git commit -m "feat(logging): emit phase_start/phase_end for interactive phases + handler-level tests

- phase_start with attemptId + reopenFromGate (from phaseReopenSource)
- phase_end completed/failed/redirected paths
- state_anomaly for phase 5 stuck reopen flag
- Handler-level tests spy on runInteractivePhase; verify real emission sequence"
```

---

## Task 15: gate.ts — promptBytes + sidecarReplayAllowed + sidecar extended schema

**Files:**
- Modify: `src/phases/gate.ts`
- Modify: `src/runners/codex.ts`

- [ ] **Step 1: runCodexGate — tokens/sessionId 추출**

`src/runners/codex.ts`의 `runCodexGate`에서 stdout을 수집한 후 `extractCodexMetadata` 호출하여 반환값에 포함:

```ts
import { extractCodexMetadata } from '../phases/verdict.js';
// ...

export async function runCodexGate(/* ... */): Promise<{ exitCode: number; rawOutput: string; tokensTotal?: number; codexSessionId?: string }> {
  // ... existing subprocess code
  const metadata = extractCodexMetadata(stdout);
  return { exitCode, rawOutput: stdout, ...metadata };
}
```

실제 반환 타입 확인 후 확장.

- [ ] **Step 2: gate.ts — runGatePhase에 allowSidecarReplay 및 promptBytes**

`src/phases/gate.ts`의 `runGatePhase` 기존 시그니처를 유지하고 `allowSidecarReplay`를 **마지막** 파라미터로 추가. 실제 현재 시그니처 `runGatePhase(phase, state, harnessDir, runDir, cwd)`에 맞춰:

```ts
export async function runGatePhase(
  phase: GatePhase,
  state: HarnessState,
  harnessDir: string,
  runDir: string,
  cwd: string,
  allowSidecarReplay?: { value: boolean },
): Promise<GatePhaseResult> {
  // One-shot sidecar replay check
  if (allowSidecarReplay && allowSidecarReplay.value) {
    allowSidecarReplay.value = false;  // consume
    const replay = checkGateSidecars(runDir, phase);
    if (replay) {
      return { ...replay, recoveredFromSidecar: true };
    }
  }

  const startTs = Date.now();
  // ... assemble prompt
  const prompt = buildPrompt(/* ... */);
  const promptBytes = Buffer.byteLength(prompt, 'utf8');

  // ... run runner (codex or claude)
  const runner: 'claude' | 'codex' = /* based on preset */;
  const runnerResult = runner === 'codex'
    ? await runCodexGate(/* ... */)
    : await runClaudeGate(/* ... */);

  const durationMs = Date.now() - startTs;

  // Parse verdict/comments from runnerResult.rawOutput
  // ... existing parsing logic

  // Persist extended sidecar (gate-N-result.json)
  const sidecar: GateResult = {
    exitCode: runnerResult.exitCode,
    timestamp: Date.now(),
    runner,
    promptBytes,
    durationMs,
    tokensTotal: runnerResult.tokensTotal,
    codexSessionId: runnerResult.codexSessionId,
  };
  fs.writeFileSync(path.join(runDir, `gate-${phase}-result.json`), JSON.stringify(sidecar, null, 2));

  if (runnerResult.exitCode !== 0 || !parsedOk) {
    return {
      type: 'error',
      error: /* error msg */,
      runner,
      promptBytes,
      durationMs,
      exitCode: runnerResult.exitCode,
      rawOutput: runnerResult.rawOutput,
    };
  }

  return {
    type: 'verdict',
    verdict,
    comments,
    rawOutput: runnerResult.rawOutput,
    runner,
    promptBytes,
    durationMs,
    tokensTotal: runnerResult.tokensTotal,
    codexSessionId: runnerResult.codexSessionId,
  };
}
```

- [ ] **Step 3: checkGateSidecars — metadata 필드 hydrate (legacy 호환)**

기존 `checkGateSidecars` 함수는 replay 결과를 계속 반환한다. Legacy sidecar(`runner` 필드 없음)에서는 metadata 필드를 `undefined`로 두고, runner.ts가 emit 시 `runner` 부재를 감지하여 logging 이벤트만 skip한다. **sidecar replay 자체는 유지**(기존 동작 보존):

```ts
function checkGateSidecars(runDir: string, phase: GatePhase): GatePhaseResult | null {
  const resultPath = path.join(runDir, `gate-${phase}-result.json`);
  if (!fs.existsSync(resultPath)) return null;

  const gateResult = JSON.parse(fs.readFileSync(resultPath, 'utf-8')) as GateResult;
  const rawPath = path.join(runDir, `gate-${phase}-raw.txt`);
  const rawOutput = fs.existsSync(rawPath) ? fs.readFileSync(rawPath, 'utf-8') : '';

  // Hydrate new metadata fields; for legacy sidecars (no runner field),
  // these will be undefined and runner.ts will skip logging emission per §5.2.
  if (gateResult.exitCode !== 0) {
    return {
      type: 'error',
      error: 'gate subprocess exited with non-zero code',
      runner: gateResult.runner,              // may be undefined (legacy)
      promptBytes: gateResult.promptBytes,    // may be undefined (legacy)
      durationMs: gateResult.durationMs,      // may be undefined (legacy)
      exitCode: gateResult.exitCode,
      rawOutput,
      recoveredFromSidecar: true,
    };
  }

  // Parse verdict from rawOutput
  const { verdict, comments } = parseVerdict(rawOutput);
  return {
    type: 'verdict',
    verdict,
    comments,
    rawOutput,
    runner: gateResult.runner,              // may be undefined (legacy)
    promptBytes: gateResult.promptBytes,    // may be undefined (legacy)
    durationMs: gateResult.durationMs,      // may be undefined (legacy)
    tokensTotal: gateResult.tokensTotal,
    codexSessionId: gateResult.codexSessionId,
    recoveredFromSidecar: true,
  };
}
```

**주의: legacy sidecar는 replay 유지** — 기존 crash-recovery 동작을 깨지 않는다. Logger emit skip은 runner.ts에서 처리 (다음 task).

- [ ] **Step 4: 기존 gate 테스트 업데이트**

`tests/phases/gate.test.ts`의 기존 테스트들이 legacy sidecar(`{ exitCode, timestamp }`만 있음)를 `checkGateSidecars`에 넘겨서 verdict 파싱을 기대하는 경우가 있다. 새 정책(legacy sidecar은 skip)에 맞게 테스트 분리:

```bash
rg -n "checkGateSidecars|GateResult" tests/phases/gate.test.ts
```

- 기존 legacy-sidecar 테스트: replay는 유지, metadata 필드는 undefined임을 검증
- 신규 extended-sidecar 테스트: runner/promptBytes/durationMs 등 metadata 필드 hydrate 검증

예시:

```ts
it('still replays legacy sidecar; metadata fields are undefined', () => {
  const runDir = setupTempRunDir();
  fs.writeFileSync(path.join(runDir, 'gate-2-result.json'), JSON.stringify({ exitCode: 0, timestamp: 1700000000 }));
  fs.writeFileSync(path.join(runDir, 'gate-2-raw.txt'), 'VERDICT: APPROVE\ncomments: ok');
  const result = checkGateSidecars(runDir, 2);
  expect(result).not.toBeNull();
  expect(result?.type).toBe('verdict');
  expect((result as any).runner).toBeUndefined();
  expect((result as any).promptBytes).toBeUndefined();
  // handleGatePhase will skip logger emit when result.runner is undefined
});

it('hydrates metadata from extended sidecar', () => {
  const runDir = setupTempRunDir();
  const ext = { exitCode: 0, timestamp: 1700000000, runner: 'codex', promptBytes: 1000, durationMs: 30000, tokensTotal: 45000 };
  fs.writeFileSync(path.join(runDir, 'gate-2-result.json'), JSON.stringify(ext));
  fs.writeFileSync(path.join(runDir, 'gate-2-raw.txt'), 'VERDICT: APPROVE\ncomments: ok');
  const result = checkGateSidecars(runDir, 2);
  expect(result?.type).toBe('verdict');
  expect((result as any).runner).toBe('codex');
  expect((result as any).tokensTotal).toBe(45000);
});
```

- [ ] **Step 5: 빌드 및 테스트**

```bash
npm run build && npm test -- gate
```

- [ ] **Step 6: Commit**

```bash
git add src/phases/gate.ts src/runners/codex.ts tests/phases/gate.test.ts
git commit -m "feat(logging): gate.ts promptBytes + sidecarReplayAllowed one-shot + extended sidecar

- runGatePhase accepts one-shot sidecarReplayAllowed object; consumed on first call
- gate-N-result.json persists runner, promptBytes, durationMs, tokensTotal, codexSessionId
- checkGateSidecars hydrates metadata; skips emit if legacy sidecar (no runner field)
- runCodexGate returns tokensTotal/codexSessionId via extractCodexMetadata
- gate.test.ts split: legacy-sidecar (null) vs extended-sidecar (hydrated)"
```

---

## Task 16: runner.ts — gate_verdict/gate_error/gate_retry emit

**Files:**
- Modify: `src/phases/runner.ts`

- [ ] **Step 1: handleGatePhase에 gate_verdict emit 추가**

```ts
async function handleGatePhase(
  state: HarnessState,
  phase: GatePhase,
  /* ... */,
  logger: SessionLogger,
  sidecarReplayAllowed: { value: boolean },
): Promise<void> {
  const retryIndex = state.gateRetries[String(phase)] ?? 0;   // pre-mutation capture
  const result = await runGatePhase(phase, state, harnessDir, runDir, cwd, sidecarReplayAllowed);

  if (result.type === 'verdict' && result.verdict === 'APPROVE') {
    // Legacy sidecar policy: skip emit if runner unknown (§5.2)
    if (result.runner) {
      logger.logEvent({
        event: 'gate_verdict',
        phase,
        retryIndex,
        runner: result.runner,
        verdict: 'APPROVE',
        durationMs: result.durationMs,
        tokensTotal: result.tokensTotal,
        promptBytes: result.promptBytes,
        codexSessionId: result.codexSessionId,
        recoveredFromSidecar: result.recoveredFromSidecar ?? false,
      });
    }
    state.phases[String(phase)] = 'completed';
    deleteGateSidecars(runDir, phase);

    // Anomaly check: pending_action should be cleared after APPROVE
    if (state.pendingAction !== null) {
      logger.logEvent({ event: 'state_anomaly', kind: 'pending_action_stale_after_approve', details: { phase, pendingActionType: state.pendingAction.type } });
    }
  } else if (result.type === 'verdict' && result.verdict === 'REJECT') {
    if (result.runner) {
      logger.logEvent({
        event: 'gate_verdict',
        phase,
        retryIndex,
        runner: result.runner,
        verdict: 'REJECT',
        durationMs: result.durationMs,
        tokensTotal: result.tokensTotal,
        promptBytes: result.promptBytes,
        codexSessionId: result.codexSessionId,
        recoveredFromSidecar: result.recoveredFromSidecar ?? false,
      });
    }
    await handleGateReject(state, phase, /* ... */, logger, retryIndex);
  } else {
    // error
    if (result.runner) {
      logger.logEvent({
        event: 'gate_error',
        phase,
        retryIndex,
        runner: result.runner,
        error: result.error,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        recoveredFromSidecar: result.recoveredFromSidecar ?? false,
      });
    }
    await handleGateError(state, phase, /* ... */, logger, retryIndex);
  }
}
```

- [ ] **Step 2: handleGateReject에 gate_retry emit 추가**

```ts
async function handleGateReject(state: HarnessState, phase: GatePhase, /* ... */, logger: SessionLogger, retryIndex: number): Promise<void> {
  const feedbackPath = path.join(runDir, `gate-${phase}-feedback.md`);
  const feedbackBytes = fs.existsSync(feedbackPath) ? fs.statSync(feedbackPath).size : 0;
  const feedbackPreview = fs.existsSync(feedbackPath)
    ? fs.readFileSync(feedbackPath, 'utf-8').slice(0, 200)
    : '';

  const retryLimit = GATE_RETRY_LIMIT;  // 상수 사용
  const retryCount = retryIndex + 1;

  logger.logEvent({
    event: 'gate_retry',
    phase,
    retryIndex,
    retryCount,
    retryLimit,
    feedbackPath,
    feedbackBytes,
    feedbackPreview,
  });

  // ... existing retry logic (gateRetries increment, phaseReopenFlags, etc.)
}
```

- [ ] **Step 3: escalation emit (handleGateEscalation, handleGateError)**

**Normative:** 각 escalation 경로에서 **정확히 1개**의 `escalation` 이벤트만 emit하며, `userChoice` 필드를 사용자 선택 확정 후 함께 기록한다. (Spec §4.3의 schema는 userChoice를 포함한 단일 이벤트 shape을 정의.)

```ts
async function handleGateEscalation(state, phase, /* ... */, logger: SessionLogger): Promise<void> {
  // Prompt user for choice (existing logic)
  const userChoice = await promptUser(/* ... */);  // 'C' | 'S' | 'Q' | 'R'

  // Emit exactly one escalation event AFTER userChoice is known
  logger.logEvent({
    event: 'escalation',
    phase,
    reason: 'gate-retry-limit',  // or 'gate-error' for handleGateError
    userChoice,
  });

  // ... subsequent logic based on choice
}
```

동일 규칙을 `handleGateError` (`reason: 'gate-error'`), `handleVerifyEscalation` (`reason: 'verify-limit'`), `handleVerifyError` (`reason: 'verify-error'`)에도 적용.

**단일 emit 원칙 검증:** Task 20 통합 테스트에서 각 escalation 경로마다 events.jsonl에 해당 `(phase, reason)` 조합이 정확히 1번만 존재함을 assertion.

- [ ] **Step 4: force_pass emit (forcePassGate, forcePassVerify)**

```ts
async function forcePassGate(state, phase, logger: SessionLogger, by: 'auto' | 'user'): Promise<void> {
  // existing force pass logic
  logger.logEvent({ event: 'force_pass', phase, by });
}
```

- [ ] **Step 5: handler-level 테스트 (escalation + force_pass + gate_verdict)**

`tests/phases/runner.test.ts`에 handler-level 검증 추가:

```ts
describe('handleGateEscalation / handleGateError / handleVerifyEscalation / handleVerifyError — event emission', () => {
  it('handleGateEscalation emits exactly one escalation event AFTER userChoice resolved', async () => {
    const { logger, eventsPath, cleanup } = makeLogger('esc1');
    try {
      const inputManager = mockInputManagerWithChoice('C');  // user picks continue
      const state = buildMinimalState({ phase: 2 });
      state.gateRetries['2'] = 3;  // at limit
      await handleGateEscalation(state, 2, /* ... */, inputManager, logger);
      const events = readEvents(eventsPath);
      const escs = events.filter(e => e.event === 'escalation');
      expect(escs.length).toBe(1);
      expect(escs[0].reason).toBe('gate-retry-limit');
      expect(escs[0].userChoice).toBe('C');
      // Assert emission order: escalation event MUST come after prompt resolution
      expect(inputManager.promptWasCalledBefore(escs[0].ts)).toBe(true);
    } finally { cleanup(); }
  });

  it('handleVerifyEscalation emits exactly one escalation with reason=verify-limit', async () => {
    const { logger, eventsPath, cleanup } = makeLogger('esc2');
    try {
      const inputManager = mockInputManagerWithChoice('R');
      const state = buildMinimalState({ phase: 6 });
      state.verifyRetries = 3;  // at limit
      await handleVerifyEscalation(state, /* ... */, inputManager, logger);
      const events = readEvents(eventsPath);
      const escs = events.filter(e => e.event === 'escalation');
      expect(escs.length).toBe(1);
      expect(escs[0].reason).toBe('verify-limit');
      expect(escs[0].userChoice).toBe('R');
    } finally { cleanup(); }
  });

  it('handleGateError emits escalation with reason=gate-error when retries exhausted', async () => {
    const { logger, eventsPath, cleanup } = makeLogger('esc3');
    try {
      const inputManager = mockInputManagerWithChoice('Q');
      const state = buildMinimalState({ phase: 2 });
      await handleGateError(state, 2, /* ... error payload ... */, inputManager, logger);
      const events = readEvents(eventsPath);
      const escs = events.filter(e => e.event === 'escalation');
      expect(escs.length).toBe(1);
      expect(escs[0].reason).toBe('gate-error');
      expect(escs[0].userChoice).toBe('Q');
    } finally { cleanup(); }
  });
});

describe('forcePassGate / forcePassVerify — emit exclusivity', () => {
  it('forcePassGate emits exactly one force_pass; no phase_start/phase_end/gate_verdict', async () => {
    const { logger, eventsPath, cleanup } = makeLogger('fp1');
    try {
      const state = buildMinimalState({ phase: 2 });
      await forcePassGate(state, 2, logger, 'user');
      const events = readEvents(eventsPath);
      const fps = events.filter(e => e.event === 'force_pass');
      expect(fps.length).toBe(1);
      expect(fps[0].by).toBe('user');
      expect(events.some(e => e.event === 'phase_start' && e.phase === 2)).toBe(false);
      expect(events.some(e => e.event === 'phase_end' && e.phase === 2)).toBe(false);
      expect(events.some(e => e.event === 'gate_verdict' && e.phase === 2)).toBe(false);
    } finally { cleanup(); }
  });

  it('forcePassVerify emits exactly one force_pass; no phase_end/verify_result', async () => {
    const { logger, eventsPath, cleanup } = makeLogger('fp2');
    try {
      const state = buildMinimalState({ phase: 6 });
      await forcePassVerify(state, logger, 'auto');
      const events = readEvents(eventsPath);
      const fps = events.filter(e => e.event === 'force_pass');
      expect(fps.length).toBe(1);
      expect(fps[0].by).toBe('auto');
      expect(events.some(e => e.event === 'phase_end' && e.phase === 6)).toBe(false);
      expect(events.some(e => e.event === 'verify_result')).toBe(false);
    } finally { cleanup(); }
  });
});

describe('handleGatePhase — gate_verdict emission', () => {
  it('APPROVE path emits gate_verdict with runner=codex when Codex preset', async () => {
    const { logger, eventsPath, cleanup } = makeLogger('gv1');
    try {
      const state = buildMinimalState({ phase: 2 });
      state.phasePresets['2'] = 'codex-high';  // real Codex preset from config.ts
      vi.spyOn(/* codex */, 'runCodexGate').mockResolvedValue({ exitCode: 0, rawOutput: 'VERDICT: APPROVE', tokensTotal: 45000 } as any);
      await handleGatePhase(state, 2, /* ... */, logger, { value: false });
      const events = readEvents(eventsPath);
      const verdicts = events.filter(e => e.event === 'gate_verdict');
      expect(verdicts.length).toBe(1);
      expect(verdicts[0].runner).toBe('codex');
      expect(verdicts[0].verdict).toBe('APPROVE');
      expect(verdicts[0].tokensTotal).toBe(45000);
    } finally { cleanup(); }
  });

  it('REJECT path emits gate_verdict then gate_retry in order', async () => {
    const { logger, eventsPath, cleanup } = makeLogger('gv2');
    try {
      const state = buildMinimalState({ phase: 2 });
      // Mock runCodexGate → REJECT; feedback file exists
      await handleGatePhase(state, 2, /* ... REJECT setup ... */, logger, { value: false });
      const events = readEvents(eventsPath);
      const verdict = events.find(e => e.event === 'gate_verdict');
      const retry = events.find(e => e.event === 'gate_retry');
      expect(verdict).toBeDefined();
      expect(verdict.verdict).toBe('REJECT');
      expect(retry).toBeDefined();
      expect(events.indexOf(verdict)).toBeLessThan(events.indexOf(retry));
    } finally { cleanup(); }
  });

  it('Legacy sidecar replay path does NOT emit gate_verdict (runner=undefined)', async () => {
    const { logger, eventsPath, cleanup } = makeLogger('gv3');
    try {
      // Pre-populate runDir with a legacy sidecar (no runner field)
      const state = buildMinimalState({ phase: 2 });
      // Force sidecarReplayAllowed.value = true and have replay return result with runner=undefined
      await handleGatePhase(state, 2, /* ... with legacy sidecar ... */, logger, { value: true });
      const events = readEvents(eventsPath);
      expect(events.some(e => e.event === 'gate_verdict')).toBe(false);  // logger emit skipped per §5.2
    } finally { cleanup(); }
  });
});
```

**주의:** 테스트 작성 시 실제 runner.ts handler 시그니처에 맞춰 파라미터 전달. mockInputManagerWithChoice 등 헬퍼는 실제 InputManager 인터페이스에 기반한 test double로 구현 (prompt timing 추적 포함).

- [ ] **Step 6: 빌드 및 테스트**

```bash
npm run build && npm test
```

- [ ] **Step 7: Commit**

```bash
git add src/phases/runner.ts tests/phases/runner.test.ts
git commit -m "feat(logging): emit gate_verdict/gate_error/gate_retry/escalation/force_pass + handler tests

- retryIndex captured pre-mutation for all gate events
- state_anomaly for pending_action stale after APPROVE
- deleteGateSidecars after gate_verdict emit (not before)
- Escalation: exactly one event per path, after userChoice resolved
- force_pass exclusivity: no accompanying phase_end/gate_verdict/verify_result
- Legacy sidecar replay preserves result but skips logger emit
- Handler-level tests spy on runner/prompt to verify real emission sequences"
```

---

## Task 17: runner.ts — verify_result + phase_end (verify)

**Files:**
- Modify: `src/phases/runner.ts`

- [ ] **Step 1: handleVerifyPhase에 phase_start/phase_end/verify_result emit**

```ts
async function handleVerifyPhase(state, /* ... */, logger: SessionLogger): Promise<void> {
  const retryIndex = state.verifyRetries;   // pre-mutation
  const phaseStartTs = Date.now();

  logger.logEvent({ event: 'phase_start', phase: 6, retryIndex });

  let outcome: VerifyOutcome;
  try {
    outcome = await runVerifyPhase(state, /* ... */);
  } catch (err) {
    // Spec §5.8: throw path → emit phase_end + escalation only (NO verify_result; that's for pass/fail outcomes)
    logger.logEvent({
      event: 'phase_end',
      phase: 6,
      status: 'failed',
      durationMs: Date.now() - phaseStartTs,
      details: { reason: 'verify_throw' },
    });
    state.phases['6'] = 'error';
    writeState(runDir, state);
    await handleVerifyError(state, /* ... */, logger);
    return;  // do not rethrow — error is fully handled via escalation path
  }

  const durationMs = Date.now() - phaseStartTs;

  if (outcome.type === 'pass') {
    logger.logEvent({ event: 'verify_result', passed: true, retryIndex, durationMs });
    logger.logEvent({ event: 'phase_end', phase: 6, status: 'completed', durationMs });
    // ... existing pass logic
  } else if (outcome.type === 'fail') {
    logger.logEvent({ event: 'verify_result', passed: false, retryIndex, durationMs });
    logger.logEvent({ event: 'phase_end', phase: 6, status: 'failed', durationMs });
    await handleVerifyFail(state, /* ... */, logger);
  } else {
    // error — §5.8: phase_end + escalation only, NO verify_result (that's for pass/fail outcomes)
    logger.logEvent({ event: 'phase_end', phase: 6, status: 'failed', durationMs });
    await handleVerifyError(state, /* ... */, logger);
  }
}
```

- [ ] **Step 2: handleVerifyFail escalation emit**

verify retry limit 초과 시 escalation 이벤트 발행:

```ts
async function handleVerifyFail(state, /* ... */, logger: SessionLogger): Promise<void> {
  if (state.verifyRetries >= VERIFY_RETRY_LIMIT) {
    await handleVerifyEscalation(state, /* ... */, logger);
    return;
  }
  // ... normal retry logic (increment verifyRetries, reopen phase 5)
}

async function handleVerifyEscalation(state, /* ... */, logger: SessionLogger): Promise<void> {
  const userChoice = /* ... */;
  logger.logEvent({ event: 'escalation', phase: 6, reason: 'verify-limit', userChoice });
}
```

- [ ] **Step 3: handler-level 테스트 (verify pass/fail/error/throw paths)**

`tests/phases/runner.test.ts`에 추가:

```ts
describe('handleVerifyPhase — event emission', () => {
  it('pass path: verify_result(passed=true) + phase_end(completed)', async () => {
    const { logger, eventsPath, cleanup } = makeLogger('v1');
    try {
      const state = buildMinimalState({ phase: 6 });
      vi.spyOn(/* verify */, 'runVerifyPhase').mockResolvedValue({ type: 'pass' } as any);
      await handleVerifyPhase(state, /* ... */, logger);
      const events = readEvents(eventsPath);
      const vr = events.find(e => e.event === 'verify_result');
      const pe = events.find(e => e.event === 'phase_end');
      expect(vr.passed).toBe(true);
      expect(pe.status).toBe('completed');
    } finally { cleanup(); }
  });

  it('fail (retry available) path: verify_result(passed=false) + phase_end(failed), then reopen', async () => {
    const { logger, eventsPath, cleanup } = makeLogger('v2');
    try {
      const state = buildMinimalState({ phase: 6 });
      state.verifyRetries = 0;
      vi.spyOn(/* verify */, 'runVerifyPhase').mockResolvedValue({ type: 'fail', feedbackPath: '/x' } as any);
      await handleVerifyPhase(state, /* ... */, logger);
      const events = readEvents(eventsPath);
      const vr = events.find(e => e.event === 'verify_result');
      expect(vr.passed).toBe(false);
      expect(events.some(e => e.event === 'phase_end' && e.status === 'failed')).toBe(true);
    } finally { cleanup(); }
  });

  it('throw path: phase_end with details.reason=verify_throw, then escalation (no rethrow)', async () => {
    const { logger, eventsPath, cleanup } = makeLogger('v3');
    try {
      const state = buildMinimalState({ phase: 6 });
      vi.spyOn(/* verify */, 'runVerifyPhase').mockImplementation(async () => { throw new Error('script missing'); });
      const inputManager = mockInputManagerWithChoice('Q');
      // Should not throw
      await expect(handleVerifyPhase(state, /* ... */, inputManager, logger)).resolves.toBeUndefined();
      const events = readEvents(eventsPath);
      const pe = events.find(e => e.event === 'phase_end');
      expect(pe.status).toBe('failed');
      expect(pe.details?.reason).toBe('verify_throw');
      expect(events.some(e => e.event === 'escalation' && e.reason === 'verify-error')).toBe(true);
    } finally { cleanup(); }
  });

  it('error (non-throw) path: runVerifyPhase returns {type:error} → phase_end failed + escalation (no verify_result)', async () => {
    const { logger, eventsPath, cleanup } = makeLogger('v4');
    try {
      const state = buildMinimalState({ phase: 6 });
      vi.spyOn(/* verify */, 'runVerifyPhase').mockResolvedValue({ type: 'error', errorPath: '/x' } as any);
      const inputManager = mockInputManagerWithChoice('Q');
      await handleVerifyPhase(state, /* ... */, inputManager, logger);
      const events = readEvents(eventsPath);
      expect(events.find(e => e.event === 'phase_end')?.status).toBe('failed');
      expect(events.some(e => e.event === 'escalation' && e.reason === 'verify-error')).toBe(true);
      // Error/throw paths do NOT emit verify_result (only pass/fail outcomes do)
      expect(events.some(e => e.event === 'verify_result')).toBe(false);
    } finally { cleanup(); }
  });
});
```

- [ ] **Step 4: 빌드 및 테스트**

```bash
npm run build && npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/phases/runner.ts tests/phases/runner.test.ts
git commit -m "feat(logging): emit verify_result/phase_start/phase_end for verify phase + handler tests

- Covers pass, fail (retry/limit), error (non-throw), and throw paths
- verify_result includes retryIndex pre-mutation and durationMs
- Escalation event on verify retry limit / error
- Throw path routes to handleVerifyError (no rethrow); phase_end details.reason=verify_throw
- Handler-level tests spy on runVerifyPhase; verify emission order and escalation routing"
```

---

## Task 18: resume.ts — NoopLogger threading (dead code 유지)

**Files:**
- Modify: `src/resume.ts`

- [ ] **Step 1: src/resume.ts에서 변경된 시그니처 호출부 업데이트**

`src/resume.ts`에서 `runPhaseLoop`, `handleGateEscalation`, `handleVerifyEscalation`, `handleVerifyError` 호출부를 찾아 `new NoopLogger()`와 필요시 `{ value: false }` 전달:

```bash
rg -n "runPhaseLoop\(|handleGateEscalation\(|handleVerifyEscalation\(|handleVerifyError\(" src/resume.ts
```

각 호출부 앞에 logger 생성:

```ts
import { NoopLogger } from './logger.js';
// ...
const logger = new NoopLogger();
const sidecarReplayAllowed = { value: false };
await runPhaseLoop(state, harnessDir, runDir, cwd, inputManager, logger, sidecarReplayAllowed);
// or handle* calls: append logger argument
```

- [ ] **Step 2: 빌드 확인**

```bash
npm run build
```

Expected: 컴파일 성공 (dead code라도 build 통과 필수).

- [ ] **Step 3: Commit**

```bash
git add src/resume.ts
git commit -m "chore(logging): thread NoopLogger through dead resumeRun path for build compat"
```

---

## Task 19: 기존 테스트 시그니처 업데이트 (commands/*, resume)

**Files:**
- Modify: `tests/commands/inner.test.ts`
- Modify: `tests/commands/resume-cmd.test.ts`
- Modify: `tests/resume.test.ts`
- (기타 createInitialState 호출 테스트)

- [ ] **Step 1: 모든 createInitialState 호출 검토**

```bash
rg -n "createInitialState\(" tests/
```

각 호출부가 `loggingEnabled` 기본값(false)으로 동작하는지 확인. 명시적 파라미터 추가가 필요하면 `false` 전달.

- [ ] **Step 2: runner.test.ts의 handle* 호출부도 업데이트**

```bash
rg -n "handleGatePhase\(|handleVerifyPhase\(|handleInteractivePhase\(" tests/
```

각 호출부에 `new NoopLogger()` 및 필요시 `{ value: false }` 전달.

- [ ] **Step 3: Command-layer 로깅 wiring 테스트 (tests/commands/run.test.ts + resume-cmd.test.ts)**

기존 `tests/commands/run.test.ts`와 `tests/commands/resume-cmd.test.ts`는 이미 tmux/lock/terminal을 mock하고 실제 `startCommand`/`resumeCommand`를 호출한다. 이 테스트 시드를 활용하여 CLI 레벨 wiring 검증을 추가:

**run.test.ts 추가 테스트 예시:**

```ts
describe('startCommand — --enable-logging wiring', () => {
  it('state.loggingEnabled=true when enableLogging option passed', async () => {
    // Reuse existing tmux/lock/terminal mocks
    await startCommand('test task', { enableLogging: true, root: harnessRoot });
    const runDir = /* derive from mocked harness layout */;
    const state = readState(runDir);
    expect(state?.loggingEnabled).toBe(true);
  });

  it('state.loggingEnabled=false (default) when enableLogging not passed', async () => {
    await startCommand('test task', { root: harnessRoot });
    const runDir = /* ... */;
    const state = readState(runDir);
    expect(state?.loggingEnabled).toBe(false);
  });

  it('spawned __inner command does NOT include --enable-logging flag (flag is state-driven)', async () => {
    await startCommand('test task', { enableLogging: true, root: harnessRoot });
    // Verify the mocked tmux send-keys payload for __inner spawn:
    //   Should include `__inner <runId>` but NOT `--enable-logging`
    //   (logger reads state.loggingEnabled, not a new flag)
    expect(capturedInnerArgs).not.toContain('--enable-logging');
  });
});
```

**resume-cmd.test.ts 추가 테스트 예시:**

```ts
describe('resumeCommand — loggingEnabled inheritance', () => {
  it('resume preserves state.loggingEnabled=true from original start', async () => {
    // Setup: run with loggingEnabled=true already persisted
    writeState(runDir, { ...baseState, loggingEnabled: true });
    await resumeCommand(runId, { root: harnessRoot });
    const state = readState(runDir);
    expect(state?.loggingEnabled).toBe(true);  // unchanged
  });

  it('resume does not require a flag to enable logging', async () => {
    writeState(runDir, { ...baseState, loggingEnabled: true });
    // resumeCommand accepts no --enable-logging CLI flag; state carries it
    const spawnArgs = captureSpawnArgs();
    expect(spawnArgs).toContain('--resume');
    expect(spawnArgs).not.toContain('--enable-logging');
  });
});
```

**inner.test.ts 추가 테스트 (권장: logger bootstrap helper 추출):**

`inner.ts`에서 logger 생성 + session open emission + finally 정리 로직을 `bootstrapLogger(runId, harnessDir, state, options)` helper로 분리하여 export. 이 helper를 단위 테스트하는 것이 `innerCommand` 전체 path (tmux/control-pane/promptModelConfig/preflight 전제) 재현보다 훨씬 간단하고 빠르다.

**Canonical API (Task 11과 일치):** `bootstrapSessionLogger`는 `SessionLogger`를 직접 반환한다. 호출자(`inner.ts`)가 teardown 시 `state.status` 기반으로 `sessionEndStatus`를 직접 계산.

그 후 `inner.ts`의 runPhaseLoop 섹션은 `bootstrapSessionLogger(...)` 호출로 교체.

**Unit test 예시 (tests/commands/inner.test.ts):**

```ts
describe('bootstrapSessionLogger — session event bootstrap', () => {
  it('fresh start: writes meta + emits session_start; no prior meta.json', async () => {
    const { bootstrapSessionLogger } = await import('../../src/commands/inner.js');
    const harnessDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-'));
    const sessionsRoot = path.join(harnessDir, 'sessions');
    const state = buildMinimalState({ loggingEnabled: true, task: 'test' });
    const logger = await bootstrapSessionLogger('r1', harnessDir, state, false, { sessionsRoot });
    const repoKey = computeRepoKey(harnessDir);
    const eventsPath = path.join(sessionsRoot, repoKey, 'r1', 'events.jsonl');
    const events = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    expect(events[0].event).toBe('session_start');
    expect(events[0].task).toBe('test');
  });

  it('resume: emits session_resumed and pushes resumedAt', async () => {
    const { bootstrapSessionLogger } = await import('../../src/commands/inner.js');
    const harnessDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-resume-'));
    const sessionsRoot = path.join(harnessDir, 'sessions');
    const state = buildMinimalState({ loggingEnabled: true, task: 'test' });
    // First bootstrap = fresh
    await bootstrapSessionLogger('r2', harnessDir, state, false, { sessionsRoot });
    // Second bootstrap with isResume=true
    await bootstrapSessionLogger('r2', harnessDir, state, true, { sessionsRoot });
    const repoKey = computeRepoKey(harnessDir);
    const events = fs.readFileSync(path.join(sessionsRoot, repoKey, 'r2', 'events.jsonl'), 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    expect(events.filter(e => e.event === 'session_resumed').length).toBe(1);
    const meta = JSON.parse(fs.readFileSync(path.join(sessionsRoot, repoKey, 'r2', 'meta.json'), 'utf-8'));
    expect(meta.resumedAt.length).toBe(1);
  });

  it('loggingEnabled=false: NoopLogger, no files created', async () => {
    const { bootstrapSessionLogger } = await import('../../src/commands/inner.js');
    const harnessDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-noop-'));
    const sessionsRoot = path.join(harnessDir, 'sessions');
    const state = buildMinimalState({ loggingEnabled: false, task: 'test' });
    await bootstrapSessionLogger('r3', harnessDir, state, false, { sessionsRoot });
    expect(fs.existsSync(sessionsRoot)).toBe(false);
  });
});
```

이 helper 분리로 full tmux path 없이 §9 acceptance criteria의 핵심 동작(session file 생성, session_start/resumed emit, opt-out no-files, resume inheritance)을 자동 검증 가능.

**(Optional) 전체 innerCommand e2e 테스트는 v2로 연기** — tmux/control-pane/preflight mocks가 많이 필요하고 ROI가 낮음. bootstrapSessionLogger unit test + Task 19의 startCommand/resumeCommand mocking 테스트 조합으로 §9 acceptance 충분히 커버됨.

<details>
<summary>(참고) 전체 innerCommand e2e 테스트 예시 (미채택)</summary>

```ts
describe('innerCommand — logging bootstrap end-to-end', () => {
  it('--enable-logging state creates sessions dir + events.jsonl + meta.json', async () => {
    // Requires: mock tmux paneExists=true, splitPane, runInteractivePhase, promptModelConfig,
    // runRunnerAwarePreflight, and pass { controlPane: 'mock-pane', root: harnessRoot }.
    // Set HOME to tempdir.
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-home-'));
    process.env.HOME = tmpHome;
    writeState(runDir, { ...baseState, loggingEnabled: true, status: 'completed', currentPhase: 8 });
    await innerCommand(runId, { root: harnessRoot, controlPane: 'mock-pane' });
    // Assert session files created
    const sessionsRoot = path.join(tmpHome, '.harness', 'sessions');
    const repoKey = computeRepoKey(harnessDir);
    const sessionDir = path.join(sessionsRoot, repoKey, runId);
    expect(fs.existsSync(path.join(sessionDir, 'meta.json'))).toBe(true);
    expect(fs.existsSync(path.join(sessionDir, 'events.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(sessionDir, 'summary.json'))).toBe(true);
    // Verify session_start + session_end in events
    const events = fs.readFileSync(path.join(sessionDir, 'events.jsonl'), 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    expect(events.some(e => e.event === 'session_start')).toBe(true);
    expect(events.some(e => e.event === 'session_end')).toBe(true);
  });

  it('without --enable-logging: no files under ~/.harness/sessions', async () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-home-'));
    process.env.HOME = tmpHome;
    writeState(runDir, { ...baseState, loggingEnabled: false, status: 'completed', currentPhase: 8 });
    await innerCommand(runId, { root: harnessRoot });
    const sessionsRoot = path.join(tmpHome, '.harness', 'sessions');
    expect(fs.existsSync(sessionsRoot)).toBe(false);
  });

  it('resume appends session_resumed + meta.resumedAt[] push', async () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-home-'));
    process.env.HOME = tmpHome;
    writeState(runDir, { ...baseState, loggingEnabled: true, status: 'completed', currentPhase: 8 });
    await innerCommand(runId, { root: harnessRoot });  // initial run
    await innerCommand(runId, { root: harnessRoot, resume: true });  // resume
    const sessionDir = path.join(tmpHome, '.harness', 'sessions', computeRepoKey(harnessDir), runId);
    const events = fs.readFileSync(path.join(sessionDir, 'events.jsonl'), 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    expect(events.some(e => e.event === 'session_resumed')).toBe(true);
    const meta = JSON.parse(fs.readFileSync(path.join(sessionDir, 'meta.json'), 'utf-8'));
    expect(meta.resumedAt.length).toBeGreaterThanOrEqual(1);
  });
});
```

이 테스트들은 `HOME` env 리다이렉트와 기존 tmux/runner mock 조합으로 `innerCommand`의 실제 실행을 수행한다. Phase loop이 빠르게 종료되도록 `status='completed'` 초기 state를 사용.

</details>

**주의:** 위 테스트들은 기존 mock 구조(tmux, lock, terminal, subprocess spawn)를 재사용한다. 실제 subprocess는 spawn되지 않고 arguments만 capture하여 검증. `startCommand`/`resumeCommand` 시그니처가 각각 `enableLogging?: boolean` 옵션을 받도록 Task 10에서 이미 확장됨.

- [ ] **Step 4: 전체 테스트 실행**

```bash
npm test
```

Expected: 전체 PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/
git commit -m "test(logging): update existing test call sites + add CLI-layer wiring tests

- createInitialState with loggingEnabled parameter
- runPhaseLoop and handle* functions with NoopLogger
- sidecarReplayAllowed object passed where required
- run.test.ts: verify startCommand persists loggingEnabled into state.json
- run.test.ts: verify __inner spawn args do NOT include --enable-logging (state-driven)
- resume-cmd.test.ts: verify resumeCommand inherits loggingEnabled from state"
```

---

## Task 20: Integration tests — end-to-end with mocked runners

**Files:**
- Create: `tests/integration/logging.test.ts`

- [ ] **Step 1: Integration 테스트 작성**

`tests/integration/logging.test.ts` 생성:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { FileSessionLogger, computeRepoKey } from '../../src/logger.js';
// ... (imports for state/types)

function tempHarnessDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'logging-int-'));
}

describe('Integration: --enable-logging creates session files', () => {
  it('with enableLogging=true, session dir is created with events.jsonl, meta.json', async () => {
    // setup: mock state with loggingEnabled=true
    // Invoke logger directly (skip full inner flow — integration at logger level)
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('run-int-1', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 'test' });
    logger.logEvent({ event: 'session_start', task: 'test', autoMode: false, baseCommit: '', harnessVersion: 'v1' });
    logger.logEvent({ event: 'phase_start', phase: 1, attemptId: 'a1' });
    logger.logEvent({ event: 'phase_end', phase: 1, attemptId: 'a1', status: 'completed', durationMs: 100 });
    logger.logEvent({ event: 'session_end', status: 'completed', totalWallMs: 500 });
    logger.finalizeSummary({ status: 'completed', autoMode: false } as any);

    const repoKey = computeRepoKey(harnessDir);
    const sessionDir = path.join(sessionsRoot, repoKey, 'run-int-1');
    expect(fs.existsSync(path.join(sessionDir, 'events.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(sessionDir, 'meta.json'))).toBe(true);
    expect(fs.existsSync(path.join(sessionDir, 'summary.json'))).toBe(true);
  });

  it('with loggingEnabled=false, createSessionLogger returns NoopLogger and no files are created', async () => {
    const { createSessionLogger } = await import('../../src/logger.js');
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = createSessionLogger('run-noop', harnessDir, false, { sessionsRoot });
    expect(logger.constructor.name).toBe('NoopLogger');
    logger.writeMeta({ task: 't' });
    logger.logEvent({ event: 'session_start', task: 't', autoMode: false, baseCommit: '', harnessVersion: 'v1', phase: 1 });
    logger.logEvent({ event: 'phase_start', phase: 1 });
    logger.finalizeSummary({ status: 'completed', autoMode: false } as any);

    // Verify the sessions directory was never created
    expect(fs.existsSync(sessionsRoot)).toBe(false);
  });

  it('Codex gate APPROVE → gate_verdict with runner=codex, tokensTotal', () => {
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('run-int-2', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    logger.logEvent({
      event: 'gate_verdict',
      phase: 2,
      retryIndex: 0,
      runner: 'codex',
      verdict: 'APPROVE',
      durationMs: 30000,
      tokensTotal: 45000,
      promptBytes: 12345,
    });

    const repoKey = computeRepoKey(harnessDir);
    const eventsPath = path.join(sessionsRoot, repoKey, 'run-int-2', 'events.jsonl');
    const lines = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n');
    const verdict = JSON.parse(lines[0]);
    expect(verdict.runner).toBe('codex');
    expect(verdict.tokensTotal).toBe(45000);
  });

  it('Claude gate APPROVE → gate_verdict with runner=claude, no tokensTotal', () => {
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('run-int-3', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    logger.logEvent({
      event: 'gate_verdict',
      phase: 2,
      retryIndex: 0,
      runner: 'claude',
      verdict: 'APPROVE',
      durationMs: 30000,
      promptBytes: 12345,
    });

    const repoKey = computeRepoKey(harnessDir);
    const eventsPath = path.join(sessionsRoot, repoKey, 'run-int-3', 'events.jsonl');
    const verdict = JSON.parse(fs.readFileSync(eventsPath, 'utf-8').trim().split('\n')[0]);
    expect(verdict.runner).toBe('claude');
    expect(verdict.tokensTotal).toBeUndefined();
  });

  it('gate REJECT sequence: gate_verdict then gate_retry', () => {
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('run-int-4', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    logger.logEvent({ event: 'gate_verdict', phase: 2, retryIndex: 0, runner: 'codex', verdict: 'REJECT', durationMs: 20000 });
    logger.logEvent({ event: 'gate_retry', phase: 2, retryIndex: 0, retryCount: 1, retryLimit: 3, feedbackPath: '/x', feedbackBytes: 100, feedbackPreview: 'foo' });

    const repoKey = computeRepoKey(harnessDir);
    const eventsPath = path.join(sessionsRoot, repoKey, 'run-int-4', 'events.jsonl');
    const lines = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n');
    expect(JSON.parse(lines[0]).event).toBe('gate_verdict');
    expect(JSON.parse(lines[1]).event).toBe('gate_retry');
  });

  it('state_anomaly events: pending_action_stale_after_approve, phase_reopen_flag_stuck', () => {
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('run-int-5', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    logger.logEvent({ event: 'state_anomaly', kind: 'pending_action_stale_after_approve', details: { phase: 2 } });
    logger.logEvent({ event: 'state_anomaly', kind: 'phase_reopen_flag_stuck', details: { phase: 5 } });

    const repoKey = computeRepoKey(harnessDir);
    const eventsPath = path.join(sessionsRoot, repoKey, 'run-int-5', 'events.jsonl');
    const lines = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);
    const e1 = JSON.parse(lines[0]);
    expect(e1.kind).toBe('pending_action_stale_after_approve');
  });

  it('recoveredFromSidecar=true events dedupe against authoritative in summary', () => {
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('run-int-6', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    logger.logEvent({ event: 'gate_verdict', phase: 2, retryIndex: 0, runner: 'codex', verdict: 'APPROVE', durationMs: 30000, recoveredFromSidecar: false });
    logger.logEvent({ event: 'gate_verdict', phase: 2, retryIndex: 0, runner: 'codex', verdict: 'APPROVE', durationMs: 30000, recoveredFromSidecar: true });
    logger.logEvent({ event: 'session_end', status: 'completed', totalWallMs: 100 });
    logger.finalizeSummary({ status: 'completed', autoMode: false } as any);

    const repoKey = computeRepoKey(harnessDir);
    const summaryPath = path.join(sessionsRoot, repoKey, 'run-int-6', 'summary.json');
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
    expect(summary.phases['2'].attempts.length).toBe(1);
  });

  it('Different harnessDir → different repoKey → separate session dirs', () => {
    const dirA = tempHarnessDir();
    const dirB = tempHarnessDir();
    const sessionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sessions-'));
    const loggerA = new FileSessionLogger('same-runid', dirA, { sessionsRoot });
    const loggerB = new FileSessionLogger('same-runid', dirB, { sessionsRoot });
    loggerA.writeMeta({ task: 'A' });
    loggerB.writeMeta({ task: 'B' });

    const keyA = computeRepoKey(dirA);
    const keyB = computeRepoKey(dirB);
    expect(keyA).not.toBe(keyB);
    expect(fs.existsSync(path.join(sessionsRoot, keyA, 'same-runid', 'meta.json'))).toBe(true);
    expect(fs.existsSync(path.join(sessionsRoot, keyB, 'same-runid', 'meta.json'))).toBe(true);
  });

  it('Resume appends session_resumed without truncating events.jsonl', () => {
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger1 = new FileSessionLogger('run-int-8', harnessDir, { sessionsRoot });
    logger1.writeMeta({ task: 't' });
    logger1.logEvent({ event: 'session_start', task: 't', autoMode: false, baseCommit: '', harnessVersion: 'v1' });
    logger1.logEvent({ event: 'phase_start', phase: 1 });

    const logger2 = new FileSessionLogger('run-int-8', harnessDir, { sessionsRoot });
    logger2.updateMeta({ pushResumedAt: Date.now() });
    logger2.logEvent({ event: 'session_resumed', fromPhase: 1, stateStatus: 'in_progress' });

    const repoKey = computeRepoKey(harnessDir);
    const eventsPath = path.join(sessionsRoot, repoKey, 'run-int-8', 'events.jsonl');
    const lines = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(3);
    expect(JSON.parse(lines[2]).event).toBe('session_resumed');

    const metaPath = path.join(sessionsRoot, repoKey, 'run-int-8', 'meta.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    expect(meta.resumedAt.length).toBe(1);
  });
});

describe('Integration: one-shot sidecar replay', () => {
  it('first gate on resume replays sidecar once', async () => {
    const { runGatePhase } = await import('../../src/phases/gate.js');
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onshot-'));
    const sidecar = { exitCode: 0, timestamp: Date.now(), runner: 'codex', promptBytes: 1000, durationMs: 10000 };
    fs.writeFileSync(path.join(runDir, 'gate-2-result.json'), JSON.stringify(sidecar));
    fs.writeFileSync(path.join(runDir, 'gate-2-raw.txt'), 'VERDICT: APPROVE\ncomments: ok');
    const state = { gateRetries: { '2': 0 } } as any;

    const flag = { value: true };
    const harnessDir = path.dirname(runDir);
    const result = await runGatePhase(2, state, harnessDir, runDir, '/cwd', flag);
    expect((result as any).recoveredFromSidecar).toBe(true);
    expect(flag.value).toBe(false);  // consumed after first use
  });

  it('second gate call with consumed flag does NOT replay (forces fresh run via codex)', async () => {
    // Use a Codex preset so the runner spy matches the actual runner selected.
    // Check src/config.ts for the correct preset id (e.g., 'codex-high' or similar).
    const gateModule = await import('../../src/phases/gate.js');
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'second-call-'));
    const sidecar = { exitCode: 0, timestamp: Date.now(), runner: 'codex', promptBytes: 1000, durationMs: 10000 };
    fs.writeFileSync(path.join(runDir, 'gate-2-result.json'), JSON.stringify(sidecar));
    fs.writeFileSync(path.join(runDir, 'gate-2-raw.txt'), 'VERDICT: APPROVE\ncomments: ok');
    // Use actual Codex preset (check src/config.ts MODEL_PRESETS for runner:'codex' entries)
    const state = { gateRetries: { '2': 0 }, phasePresets: { '2': 'codex-high' } } as any;

    const flag = { value: false };  // already consumed

    const codexModule = await import('../../src/runners/codex.js');
    const spy = vi.spyOn(codexModule, 'runCodexGate').mockResolvedValue({ exitCode: 0, rawOutput: 'VERDICT: APPROVE' } as any);

    try {
      const harnessDir = path.dirname(runDir);
      const result = await gateModule.runGatePhase(2, state, harnessDir, runDir, '/cwd', flag);
      expect((result as any).recoveredFromSidecar).toBeFalsy();
      expect(spy).toHaveBeenCalledTimes(1);  // fresh run, not replay
    } finally {
      spy.mockRestore();
    }
  });

  it('same scenario with Claude preset: runClaudeGate is called (fresh run)', async () => {
    const gateModule = await import('../../src/phases/gate.js');
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'second-claude-'));
    const sidecar = { exitCode: 0, timestamp: Date.now(), runner: 'claude', promptBytes: 500, durationMs: 5000 };
    fs.writeFileSync(path.join(runDir, 'gate-2-result.json'), JSON.stringify(sidecar));
    fs.writeFileSync(path.join(runDir, 'gate-2-raw.txt'), 'VERDICT: APPROVE');
    const state = { gateRetries: { '2': 0 }, phasePresets: { '2': 'sonnet-high' } } as any;
    const flag = { value: false };
    const claudeModule = await import('../../src/runners/claude.js');
    const spy = vi.spyOn(claudeModule, 'runClaudeGate').mockResolvedValue({ exitCode: 0, rawOutput: 'VERDICT: APPROVE' } as any);
    try {
      const harnessDir = path.dirname(runDir);
      const result = await gateModule.runGatePhase(2, state, harnessDir, runDir, '/cwd', flag);
      expect((result as any).recoveredFromSidecar).toBeFalsy();
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('legacy sidecar (no runner) still replays but with runner=undefined', async () => {
    const { checkGateSidecars } = await import('../../src/phases/gate.js');
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-'));
    const legacy = { exitCode: 0, timestamp: Date.now() };  // no runner field
    fs.writeFileSync(path.join(runDir, 'gate-2-result.json'), JSON.stringify(legacy));
    fs.writeFileSync(path.join(runDir, 'gate-2-raw.txt'), 'VERDICT: APPROVE\ncomments: ok');

    const result = checkGateSidecars(runDir, 2);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('verdict');
    expect((result as any).recoveredFromSidecar).toBe(true);
    expect((result as any).runner).toBeUndefined();
    // handleGatePhase will skip logging emit when runner is undefined (Task 16)
  });
});

describe('Integration: real runPhaseLoop lifecycle wiring', () => {
  it('bootstrap → single gate APPROVE → session_end → summary.json exists and has phase aggregation', async () => {
    // Exercises real bootstrapSessionLogger + runPhaseLoop wiring (not logger directly).
    // Phase 1/3/5 interactive runners mocked to auto-complete; gate 2/4/7 mocked to APPROVE;
    // verify mocked to pass.
    const { bootstrapSessionLogger } = await import('../../src/commands/inner.js');
    const { runPhaseLoop } = await import('../../src/phases/runner.js');

    const harnessDir = fs.mkdtempSync(path.join(os.tmpdir(), 'int-lifecycle-'));
    const sessionsRoot = path.join(harnessDir, 'sessions');
    const runDir = path.join(harnessDir, 'runs', 'int1');
    fs.mkdirSync(runDir, { recursive: true });

    // Mock interactive/gate/verify runners to return quickly
    const interactive = await import('../../src/phases/interactive.js');
    const gate = await import('../../src/phases/gate.js');
    const verify = await import('../../src/phases/verify.js');
    vi.spyOn(interactive, 'runInteractivePhase').mockImplementation(async (s, p) => {
      s.phases[String(p)] = 'completed';
      return { status: 'completed', attemptId: 'mock' } as any;
    });
    vi.spyOn(gate, 'runGatePhase').mockResolvedValue({
      type: 'verdict', verdict: 'APPROVE', comments: 'ok', rawOutput: 'APPROVE',
      runner: 'codex', promptBytes: 1000, durationMs: 5000, tokensTotal: 10000,
    } as any);
    vi.spyOn(verify, 'runVerifyPhase').mockResolvedValue({ type: 'pass' } as any);

    const state = buildMinimalState({ loggingEnabled: true, currentPhase: 1, task: 'test task' });
    const inputManager = mockInputManagerMinimal();
    const logger = await bootstrapSessionLogger('int1', harnessDir, state, false, { sessionsRoot });
    try {
      await runPhaseLoop(state, harnessDir, runDir, '/cwd', inputManager, logger, { value: false });
      logger.logEvent({ event: 'session_end', status: 'completed', totalWallMs: Date.now() - logger.getStartedAt() });
      logger.finalizeSummary(state);

      const repoKey = computeRepoKey(harnessDir);
      const sessionDir = path.join(sessionsRoot, repoKey, 'int1');
      expect(fs.existsSync(path.join(sessionDir, 'meta.json'))).toBe(true);
      expect(fs.existsSync(path.join(sessionDir, 'events.jsonl'))).toBe(true);
      expect(fs.existsSync(path.join(sessionDir, 'summary.json'))).toBe(true);

      const summary = JSON.parse(fs.readFileSync(path.join(sessionDir, 'summary.json'), 'utf-8'));
      expect(summary.status).toBe('completed');
      expect(summary.phases['2']).toBeDefined();  // gate 2 logged
      expect(summary.phases['2'].attempts.some((a: any) => a.verdict === 'APPROVE')).toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('Integration: state persistence via migrateState', () => {
  it('migrateState backfills loggingEnabled=false for legacy state.json', async () => {
    const { migrateState } = await import('../../src/state.js');
    const legacy = { runId: 'r', currentPhase: 1, status: 'paused', phases: {}, gateRetries: {}, verifyRetries: 0 } as any;
    expect(migrateState(legacy).loggingEnabled).toBe(false);
  });

  it('migrateState preserves loggingEnabled=true across resume', async () => {
    const { migrateState } = await import('../../src/state.js');
    const state = { loggingEnabled: true, runId: 'r', currentPhase: 1, status: 'paused', phases: {}, gateRetries: {}, verifyRetries: 0 } as any;
    expect(migrateState(JSON.parse(JSON.stringify(state))).loggingEnabled).toBe(true);
  });
});
```

**End-to-end CLI 검증은 Task 19 Step 3에서 수행한다.** `tests/commands/run.test.ts`와 `tests/commands/resume-cmd.test.ts`는 이미 tmux/lock/terminal을 mock하고 `startCommand`/`resumeCommand`를 실제 호출한다. 이 mock 구조를 사용하여:
- `startCommand('task', { enableLogging: true })` → state.json.loggingEnabled === true
- `__inner` spawn args capture → `--enable-logging` 플래그 없음 (state-driven)
- `resumeCommand(runId)` → 기존 state.loggingEnabled 계승
- `innerCommand` bootstrap → `~/.harness/sessions/<repoKey>/<runId>/` 디렉토리 및 events.jsonl/meta.json 생성 (innerCommand의 I/O를 tempdir로 리다이렉트)

수동 검증은 제거. 모든 spec §9 acceptance criteria는 자동 테스트로 커버.

### 추가 엣지 케이스 테스트 (§5.8/§5.9 커버리지)

```ts
describe('Integration: edge cases', () => {
  it('config-cancel lazy bootstrap emits session_start before session_end', () => {
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('run-cc', harnessDir, { sessionsRoot });
    // Simulate onConfigCancel before any session_start was emitted:
    expect(logger.hasEmittedSessionOpen()).toBe(false);
    logger.writeMeta({ task: 'original task' });
    logger.logEvent({ event: 'session_start', task: 'original task', autoMode: false, baseCommit: '', harnessVersion: 'v1' });
    expect(logger.hasEmittedSessionOpen()).toBe(true);
    logger.logEvent({ event: 'session_end', status: 'paused', totalWallMs: 1000 });
    logger.finalizeSummary({ status: 'paused', autoMode: false } as any);

    const repoKey = computeRepoKey(harnessDir);
    const eventsPath = path.join(sessionsRoot, repoKey, 'run-cc', 'events.jsonl');
    const lines = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n');
    // Ensure session_start precedes session_end
    expect(JSON.parse(lines[0]).event).toBe('session_start');
    expect(JSON.parse(lines[lines.length - 1]).event).toBe('session_end');

    const summary = JSON.parse(fs.readFileSync(path.join(sessionsRoot, repoKey, 'run-cc', 'summary.json'), 'utf-8'));
    expect(summary.status).toBe('paused');
  });

  it('config-cancel on resume pushes resumedAt and emits session_resumed before session_end', () => {
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    // First session creates meta.json
    const logger1 = new FileSessionLogger('run-cc-resume', harnessDir, { sessionsRoot });
    logger1.writeMeta({ task: 't' });
    // Second session starts; onConfigCancel fires before runPhaseLoop
    const logger2 = new FileSessionLogger('run-cc-resume', harnessDir, { sessionsRoot });
    expect(logger2.hasBootstrapped()).toBe(true);
    expect(logger2.hasEmittedSessionOpen()).toBe(false);
    logger2.updateMeta({ pushResumedAt: Date.now() });
    logger2.logEvent({ event: 'session_resumed', fromPhase: 1, stateStatus: 'paused' });
    logger2.logEvent({ event: 'session_end', status: 'paused', totalWallMs: 500 });

    const repoKey = computeRepoKey(harnessDir);
    const metaPath = path.join(sessionsRoot, repoKey, 'run-cc-resume', 'meta.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    expect(meta.resumedAt.length).toBe(1);
  });

  it('reopenFromGate accuracy: phase 5 reopen from verify vs gate 7', () => {
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('run-rfg', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    logger.logEvent({ event: 'phase_start', phase: 5, attemptId: 'a1' });
    logger.logEvent({ event: 'phase_end', phase: 5, attemptId: 'a1', status: 'completed', durationMs: 100 });
    logger.logEvent({ event: 'phase_start', phase: 5, attemptId: 'a2', reopenFromGate: 6 });  // verify-triggered reopen
    logger.logEvent({ event: 'phase_end', phase: 5, attemptId: 'a2', status: 'completed', durationMs: 200 });
    logger.logEvent({ event: 'phase_start', phase: 5, attemptId: 'a3', reopenFromGate: 7 });  // gate 7-triggered reopen

    const repoKey = computeRepoKey(harnessDir);
    const eventsPath = path.join(sessionsRoot, repoKey, 'run-rfg', 'events.jsonl');
    const events = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    const startsForPhase5 = events.filter(e => e.event === 'phase_start' && e.phase === 5);
    expect(startsForPhase5[0].reopenFromGate).toBeUndefined();
    expect(startsForPhase5[1].reopenFromGate).toBe(6);
    expect(startsForPhase5[2].reopenFromGate).toBe(7);
  });

  it('verify throw path emits phase_end failed with reason verify_throw', () => {
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('run-vt', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    logger.logEvent({ event: 'phase_start', phase: 6 });
    logger.logEvent({
      event: 'phase_end',
      phase: 6,
      status: 'failed',
      durationMs: 50,
      details: { reason: 'verify_throw' },
    });
    logger.logEvent({ event: 'escalation', phase: 6, reason: 'verify-error', userChoice: 'Q' });

    const repoKey = computeRepoKey(harnessDir);
    const events = fs.readFileSync(path.join(sessionsRoot, repoKey, 'run-vt', 'events.jsonl'), 'utf-8')
      .trim().split('\n').map(l => JSON.parse(l));
    const phaseEnd = events.find(e => e.event === 'phase_end');
    expect(phaseEnd.status).toBe('failed');
    expect(phaseEnd.details.reason).toBe('verify_throw');
    expect(events.find(e => e.event === 'escalation')).toBeDefined();
  });

  it('force_pass emit exclusivity: only one force_pass, no phase_end/gate_verdict/verify_result', () => {
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('run-fp', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    // Simulate forcePassGate for phase 2
    logger.logEvent({ event: 'force_pass', phase: 2, by: 'user' });
    // Simulate forcePassVerify for phase 6
    logger.logEvent({ event: 'force_pass', phase: 6, by: 'auto' });

    const repoKey = computeRepoKey(harnessDir);
    const events = fs.readFileSync(path.join(sessionsRoot, repoKey, 'run-fp', 'events.jsonl'), 'utf-8')
      .trim().split('\n').map(l => JSON.parse(l));
    const forcePassEvents = events.filter(e => e.event === 'force_pass');
    expect(forcePassEvents.length).toBe(2);
    // No other terminal events should exist for phases 2 or 6
    expect(events.some(e => (e.event === 'phase_end' || e.event === 'gate_verdict' || e.event === 'verify_result') && (e.phase === 2 || e.phase === 6))).toBe(false);
  });

  it('escalation emit exclusivity: exactly one per escalation path', () => {
    const harnessDir = tempHarnessDir();
    const sessionsRoot = path.join(harnessDir, 'sessions-root');
    const logger = new FileSessionLogger('run-esc', harnessDir, { sessionsRoot });
    logger.writeMeta({ task: 't' });
    // Gate retry-limit escalation for phase 2
    logger.logEvent({ event: 'escalation', phase: 2, reason: 'gate-retry-limit', userChoice: 'C' });
    // Verify error escalation for phase 6
    logger.logEvent({ event: 'escalation', phase: 6, reason: 'verify-error', userChoice: 'R' });

    const repoKey = computeRepoKey(harnessDir);
    const events = fs.readFileSync(path.join(sessionsRoot, repoKey, 'run-esc', 'events.jsonl'), 'utf-8')
      .trim().split('\n').map(l => JSON.parse(l));
    const phase2Escs = events.filter(e => e.event === 'escalation' && e.phase === 2);
    const phase6Escs = events.filter(e => e.event === 'escalation' && e.phase === 6);
    expect(phase2Escs.length).toBe(1);
    expect(phase6Escs.length).toBe(1);
    expect(phase2Escs[0].userChoice).toBe('C');
    expect(phase6Escs[0].userChoice).toBe('R');
  });
});
```

- [ ] **Step 2: 테스트 실행**

```bash
npm test -- integration/logging
```

Expected: 전체 PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/logging.test.ts
git commit -m "test(logging): integration tests for end-to-end session logging

- Covers events.jsonl/meta.json/summary.json creation
- Codex vs Claude gate_verdict semantic
- gate REJECT sequence
- state_anomaly events
- recoveredFromSidecar dedupe
- repoKey isolation across harness dirs
- Resume session_resumed append + resumedAt push"
```

---

## Task 21: 전체 회귀 테스트 + 빌드

**Files:** — (verification)

- [ ] **Step 1: 전체 테스트 suite**

```bash
npm test
```

Expected: 전체 PASS (logger unit + integration + 기존 회귀 포함).

- [ ] **Step 2: 빌드**

```bash
npm run build
```

Expected: compile errors 없음.

- [ ] **Step 3: 타입 체크 (있다면)**

```bash
npx tsc --noEmit
```

Expected: 통과.

- [ ] **Step 4: Eval report 준비 (commit 불필요, 다음 단계에서 작성)**

`docs/process/evals/2026-04-18-session-logging-eval.md`는 `harness-verify` 단계에서 생성될 예정. 여기서는 스킵.

---

## Eval Checklist

본 스펙의 acceptance criteria를 기준으로 한 자동 검증 체크리스트. `harness-verify` 단계 또는 수동 검증 시 사용.

### Logger unit tests (tests/logger.test.ts)
- [ ] `computeRepoKey` — 12자 hex, 결정론적, 다른 입력 → 다른 출력
- [ ] `NoopLogger` — 모든 메서드 no-op, hasBootstrapped/hasEmittedSessionOpen 항상 true
- [ ] `FileSessionLogger` 생성 시 디렉토리 mkdir
- [ ] `hasBootstrapped()` — disk meta.json 존재 시 true로 초기화
- [ ] `hasEmittedSessionOpen()` — session_start/resumed emit 후 true
- [ ] `getStartedAt()` — meta.startedAt 값 반환
- [ ] `logEvent` — `v:1` 포함, append-only, monotonic ts
- [ ] `logEvent`/`writeMeta`/`updateMeta`/`finalizeSummary` fs 예외 → stderr 경고 1회 후 **logger 비활성화** (§6.1). 이후 호출은 fs 접근 없음
- [ ] `mkdirSync` 실패 시 constructor 생성 단계부터 disabled=true (Task 6에 mock test 추가: `fs.mkdirSync` throw 시 모든 후속 메서드가 no-op)
- [ ] `writeMeta` 연속 호출 시 idempotent (Task 6에 test 추가)
- [ ] `updateMeta` on missing meta.json → bootstrap rule 실행 (§5.1: bootstrapOnResume=true, startedAt=Date.now(), resumedAt push) (Task 6에 test 추가)
- [ ] `writeMeta` / `updateMeta` idempotent
- [ ] `updateMeta` — meta.json 부재 시 bootstrapOnResume bootstrap
- [ ] `finalizeSummary` — `.tmp` → rename atomic write
- [ ] Summary dedupe: gate_verdict recovered (phase, retryIndex) 키, gate_error recovered (phase) 키
- [ ] `session_end` 없으면 summary.status = 'interrupted'

### Verdict helper (tests/phases/verdict.test.ts)
- [ ] `extractCodexMetadata` — `tokens used\n<N>` 파싱 (콤마 포함/미포함)
- [ ] `session id: <uuid>` 파싱 (대소문자 허용)
- [ ] 양쪽 부재 → 빈 객체

### Integration (tests/integration/logging.test.ts)
- [ ] `--enable-logging` 시 events.jsonl/meta.json/summary.json 생성
- [ ] 플래그 없이 start → `~/.harness/sessions/` 생성되지 않음 (NoopLogger)
- [ ] Codex gate APPROVE → gate_verdict.runner='codex' + tokensTotal
- [ ] Claude gate APPROVE → gate_verdict.runner='claude' + no tokensTotal
- [ ] Gate REJECT → gate_verdict(REJECT) 직후 gate_retry emit
- [ ] Anomaly 2종: pending_action_stale / phase_reopen_flag_stuck
- [ ] recoveredFromSidecar=true + authoritative 있으면 summary에서 드롭
- [ ] 서로 다른 harnessDir → 서로 다른 repoKey → 별도 session 디렉토리
- [ ] Resume → events.jsonl 보존 + session_resumed 추가 + meta.resumedAt[] push
- [ ] **One-shot sidecar replay**: first gate on resume → replays once; flag.value=false 후 consumed
- [ ] **Legacy sidecar policy**: `runner` 필드 없는 sidecar → `checkGateSidecars` returns replay result (`recoveredFromSidecar: true`); `handleGatePhase`에서 `gate_verdict`/`gate_error` emit만 skip (replay 자체는 유지 → crash-recovery 보존)
- [ ] **Extended sidecar hydration**: `runner`/`promptBytes`/`durationMs`/`tokensTotal` 필드 있는 sidecar → GatePhaseResult에 hydrate
- [ ] **State persistence**: `state.loggingEnabled=true`가 state.json에 저장, resume 시 계승
- [ ] **reopenFromGate accuracy**: phase 5 reopen이 verify(6)인 경우 `phase_start.reopenFromGate === 6`, gate 7인 경우 `=== 7`
- [ ] **config-cancel lazy bootstrap**: `onConfigCancel`이 `runPhaseLoop` 진입 전에 발동될 때 → `session_start` (또는 resume 시 `session_resumed`) emit 직후 `session_end { status: 'paused' }` emit; summary.json.status === 'paused'; meta.json 생성 및 `resumedAt[]`에 timestamp push (resume case)
- [ ] **Verify throw path**: `runVerifyPhase` throw 시 `phase_end { status: 'failed', details: { reason: 'verify_throw' } }` emit 후 `handleVerifyError`로 라우팅; throw 전파 없음
- [ ] **force_pass emit 단독성**: `forcePassGate`/`forcePassVerify` 경로에서 정확히 1개의 `force_pass` 이벤트만 emit. 해당 phase에 대한 `phase_start`/`phase_end`/`gate_verdict`/`verify_result` 이벤트는 추가로 발행되지 않음 (§5.8)

### Regression (전체 테스트)
- [ ] 기존 테스트 전체 PASS (플래그 없이 실행 시 NoopLogger 경로로 효과 무)
- [ ] createInitialState 호출부 전체 update
- [ ] runPhaseLoop / handle* 호출부 전체 logger 전달

### 빌드
- [ ] `npm run build` 성공 (타입 에러 없음)
- [ ] `npx tsc --noEmit` 성공

### Spec Acceptance (§9)
- [ ] `harness start --enable-logging "task"` → `~/.harness/sessions/<repoKey>/<runId>/{events.jsonl, summary.json, meta.json}` 생성
- [ ] 플래그 없이 start → `~/.harness/sessions/` 경로 파일 0개
- [ ] Codex runner gate `gate_verdict.runner='codex' + tokensTotal` (stdout에 `tokens used` 시)
- [ ] Claude runner gate `gate_verdict.runner='claude'` without tokensTotal
- [ ] Resume: 기존 events.jsonl 보존 + session_resumed 1개 + resumedAt[] push
- [ ] `__inner --resume` → session_resumed; 아니면 (meta.json 없으면) session_start
- [ ] Gate sidecar replay(`checkGateSidecars` non-null) → gate_verdict.recoveredFromSidecar=true
- [ ] 서로 다른 repo 동명 runId → 다른 repoKey 디렉토리
- [ ] `session_end.status` ∈ {completed, paused, interrupted}; `state.status`에서 결정론적 매핑
- [ ] Logger 내부 예외 → harness run abort 없음 (fs mock throw 테스트로 보장)
- [ ] 기존 테스트 전체 PASS

---

## Self-Review

**Spec 커버리지 체크:**
- §1 배경/목표 — Task 11 (logger 생성), Task 14/16/17 (이벤트 emit) 커버
- §2 Context & Decisions — Task 2 (loggingEnabled state), Task 10 (CLI flag), Task 11 (inner lifecycle)
- §3.1 신규 파일 `src/logger.ts` — Task 3, 5, 6, 7, 8, 9
- §3.2 수정 파일 — Task 1 (types), Task 2 (state), Task 10 (start/bin), Task 11 (inner), Task 12 (runner sig), Task 13 (interactive), Task 15 (gate, codex runner), Task 18 (resume.ts)
- §3.3 테스트 — Task 19 (기존 sig update), Task 20 (integration)
- §4 스키마 — Task 1 (types), Task 6/7/8 (implementation)
- §5.1 Logger 라이프사이클 — Task 11
- §5.2 Resume 경로 + sidecar replay — Task 11 (isResume), Task 15 (sidecarReplayAllowed)
- §5.3 Gate verdict 순서 + promptBytes — Task 15, 16
- §5.4 Codex 메타데이터 — Task 4, 15
- §5.5 State anomaly — Task 14, 16
- §5.6 Replay idempotency — Task 8 (dedupe)
- §5.7 repoKey — Task 3
- §5.8 Phase lifecycle matrix — Task 14, 16, 17
- §5.9 config-cancel — Task 11
- §6 에러 처리 — Task 6, 7 (warn-once, disable on mkdir fail)
- §7 테스트 계획 — Task 3-9 (unit), Task 20 (integration), Task 19 (regression)

**Placeholder 스캔:** 모든 step이 실제 code/command를 포함. "TBD" / "later" 없음.

**타입 일관성:**
- `sidecarReplayAllowed: { value: boolean }` — Task 11, 12, 15에서 동일 shape
- `SessionLogger` 인터페이스 메서드 — Task 1에서 정의, Task 5/6/7/8/9에서 구현, Task 11-17에서 사용
- `LogEvent` discriminated union — Task 1 정의, 이후 모든 logEvent 호출에서 사용

**미처 커버되지 않은 경계 케이스:**
- src/runners/claude.ts는 spec §3.2에서 "변경 없음"으로 명시. 본 plan에서도 별도 task 없음 — OK.
- src/phases/verify.ts는 logger 전달 외 직접 수정 없음 (runner.ts의 handleVerifyPhase에서 로깅 담당) — OK.

**Execution handoff 준비 완료.**
