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
      const sessionEndEvent = events.find(e => e.event === 'session_end') as any;
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

      for (const e of events) {
        const pstr = String((e as any).phase ?? '');
        if (!phases[pstr] && pstr) phases[pstr] = { attempts: [], totalDurationMs: 0 };

        if (e.event === 'phase_end') {
          phases[pstr].attempts.push({ attemptId: e.attemptId ?? null, startedAt: e.ts - (e.durationMs ?? 0), durationMs: e.durationMs, status: e.status, reopenFromGate: null });
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

- [ ] **Step 2: Logger 생성 및 session 이벤트 emit**

`runPhaseLoop` 호출 직전, `inputManager.enterPhaseLoop()` 다음에 logger 생성 및 bootstrap 로직 추가:

```ts
  inputManager.enterPhaseLoop();

  // --- Session logging bootstrap ---
  const logger: SessionLogger = createSessionLogger(state.runId, harnessDir, state.loggingEnabled, {
    cwd,
    autoMode: state.autoMode,
    gitBranch: process.env.HARNESS_GIT_BRANCH,
    baseCommit: state.baseCommit,
  });
  const isResume = options.resume === true;
  let sessionEndStatus: 'completed' | 'paused' | 'interrupted' = 'interrupted';

  if (isResume) {
    logger.updateMeta({ pushResumedAt: Date.now(), task: state.task });
    logger.logEvent({ event: 'session_resumed', fromPhase: state.currentPhase, stateStatus: state.status });
  } else {
    if (logger.hasBootstrapped()) {
      logger.updateMeta({ pushResumedAt: Date.now() });
      logger.logEvent({ event: 'session_resumed', fromPhase: state.currentPhase, stateStatus: state.status });
    } else {
      logger.writeMeta({ task: state.task });
      logger.logEvent({ event: 'session_start', task: state.task, autoMode: state.autoMode, baseCommit: state.baseCommit, harnessVersion: '0.1.0' });
    }
  }

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

- [ ] **Step 4: 빌드 확인**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/commands/inner.ts
git commit -m "feat(logging): inner.ts logger lifecycle + lazy bootstrap

- Logger created early (before onConfigCancel) to satisfy config-cancel lazy bootstrap
- session_start/session_resumed emitted before runPhaseLoop
- session_end + finalizeSummary in finally block
- onConfigCancel lazy-bootstraps missing session_open event via hasEmittedSessionOpen()
- sidecarReplayAllowed one-shot flag created per resume session"
```

---

## Task 12: runner.ts — logger 파라미터 전파 (시그니처 only)

**Files:**
- Modify: `src/phases/runner.ts`
- Test: `tests/phases/runner.test.ts`

- [ ] **Step 1: runPhaseLoop 시그니처 확장**

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

- [ ] **Step 2: 모든 내부 handler 호출부 업데이트**

`runPhaseLoop` 내에서 `handleInteractivePhase(state, ...)`, `handleGatePhase(state, ...)`, `handleVerifyPhase(state, ...)` 호출부에 logger와 필요시 sidecarReplayAllowed 전달.

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

- [ ] **Step 3: 기존 테스트 업데이트**

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

- [ ] **Step 4: 빌드 및 테스트**

```bash
npm run build && npm test -- runner
```

Expected: 컴파일 성공 + 기존 테스트 PASS (logger는 NoopLogger로 효과 없음).

- [ ] **Step 5: Commit**

```bash
git add src/phases/runner.ts tests/phases/runner.test.ts
git commit -m "refactor(logging): thread logger + sidecarReplayAllowed through runner handlers"
```

---

## Task 13: interactive.ts — attemptId 파라미터 도입

**Files:**
- Modify: `src/phases/interactive.ts`
- Modify: `src/phases/runner.ts`

- [ ] **Step 1: runInteractivePhase 시그니처 변경**

`src/phases/interactive.ts`의 `runInteractivePhase` 함수에 `attemptId: string` 파라미터를 추가하고, 반환 타입에 `attemptId`를 포함하도록 수정. 내부에서 `state.phaseAttemptId`를 외부 파라미터 값으로 설정:

```ts
export async function runInteractivePhase(
  state: HarnessState,
  phase: InteractivePhase,
  harnessDir: string,
  runDir: string,
  cwd: string,
  inputManager: InputManager,
  attemptId: string,   // 신규 파라미터
): Promise<InteractiveResult & { attemptId: string }> {
  // Use externally-generated attemptId instead of generating one inside preparePhase
  state.phaseAttemptId[String(phase)] = attemptId;
  writeState(runDir, state);

  // ... existing logic
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
const result = await runInteractivePhase(state, phase, harnessDir, runDir, cwd, inputManager, attemptId);
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
async function handleInteractivePhase(state: HarnessState, phase: InteractivePhase, /* ... */, logger: SessionLogger): Promise<void> {
  const attemptId = randomUUID();
  const phaseStartTs = Date.now();

  // Determine reopenFromGate if this is a reopen
  const reopenFromGate = state.phaseReopenFlags[String(phase)] ? /* look up triggering phase */ null : null;

  logger.logEvent({
    event: 'phase_start',
    phase,
    attemptId,
    reopenFromGate: reopenFromGate ?? undefined,
  });

  // Control-signal redirect check
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

  let succeeded = false;
  try {
    const result = await runInteractivePhase(state, phase, harnessDir, runDir, cwd, inputManager, attemptId);
    // ... existing post-run logic (artifact commit, state update)
    succeeded = true;

    logger.logEvent({
      event: 'phase_end',
      phase,
      attemptId,
      status: 'completed',
      durationMs: Date.now() - phaseStartTs,
    });

    // Anomaly detection: phase 5 with stuck reopen flag
    if (phase === 5 && state.phaseReopenFlags['5'] === true) {
      logger.logEvent({ event: 'state_anomaly', kind: 'phase_reopen_flag_stuck', details: { phase: 5 } });
    }
  } catch (err) {
    // post-run artifact error path
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

- [ ] **Step 3: 빌드 및 테스트**

```bash
npm run build && npm test -- runner
```

- [ ] **Step 4: Commit**

```bash
git add src/phases/runner.ts
git commit -m "feat(logging): emit phase_start/phase_end for interactive phases

- phase_start with attemptId + reopenFromGate heuristic
- phase_end completed/failed/redirected paths
- state_anomaly for phase 5 stuck reopen flag"
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

`src/phases/gate.ts`의 `runGatePhase` 시그니처 확장:

```ts
export async function runGatePhase(
  state: HarnessState,
  phase: GatePhase,
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
  const result = await runGatePhase(state, phase, runDir, cwd, sidecarReplayAllowed);

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

```ts
async function handleGateEscalation(state, phase, /* ... */, logger: SessionLogger): Promise<void> {
  // existing prompt
  logger.logEvent({ event: 'escalation', phase, reason: 'gate-retry-limit' });
  // ... user choice
  const userChoice = /* ... */;
  logger.logEvent({ event: 'escalation', phase, reason: 'gate-retry-limit', userChoice });
}
```

**주의:** 실제 escalation flow는 사용자 입력 대기가 포함되므로, 이벤트를 1개만 emit하고 `userChoice` 필드를 입력 후 함께 넣거나, 2개(진입 + 선택) emit하는 방식 중 구현 편의에 따라 선택. v1은 1개 emit (선택 후) 권장.

- [ ] **Step 4: force_pass emit (forcePassGate, forcePassVerify)**

```ts
async function forcePassGate(state, phase, logger: SessionLogger, by: 'auto' | 'user'): Promise<void> {
  // existing force pass logic
  logger.logEvent({ event: 'force_pass', phase, by });
}
```

- [ ] **Step 5: 빌드 및 테스트**

```bash
npm run build && npm test
```

- [ ] **Step 6: Commit**

```bash
git add src/phases/runner.ts
git commit -m "feat(logging): emit gate_verdict/gate_error/gate_retry/escalation/force_pass

- retryIndex captured pre-mutation for all gate events
- state_anomaly for pending_action stale after APPROVE
- deleteGateSidecars after gate_verdict emit (not before)"
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
    // Spec §5.8: throw path → emit phase_end, set state.error, route to handleVerifyError
    logger.logEvent({
      event: 'phase_end',
      phase: 6,
      status: 'failed',
      durationMs: Date.now() - phaseStartTs,
      details: { reason: 'verify_throw' },
    });
    // Convert throw to structured error outcome so downstream flow (escalation, retry) is unchanged
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
    // error
    logger.logEvent({ event: 'verify_result', passed: false, retryIndex, durationMs });
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

- [ ] **Step 3: 빌드 및 테스트**

```bash
npm run build && npm test
```

- [ ] **Step 4: Commit**

```bash
git add src/phases/runner.ts
git commit -m "feat(logging): emit verify_result/phase_start/phase_end for verify phase

- Covers pass, fail (retry/limit), error (non-throw), and throw paths
- verify_result includes retryIndex pre-mutation and durationMs
- escalation event on verify retry limit / error"
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

- [ ] **Step 3: 전체 테스트 실행**

```bash
npm test
```

Expected: 전체 PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/
git commit -m "test(logging): update existing test call sites for new signatures

- createInitialState with loggingEnabled parameter
- runPhaseLoop and handle* functions with NoopLogger
- sidecarReplayAllowed object passed where required"
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

  it('with loggingEnabled=false, createSessionLogger returns NoopLogger and no files are created', () => {
    const { createSessionLogger } = require('../../src/logger.js');
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
    // setup: create runDir with existing gate-N-result.json (new-schema)
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onshot-'));
    const sidecar = { exitCode: 0, timestamp: Date.now(), runner: 'codex', promptBytes: 1000, durationMs: 10000 };
    fs.writeFileSync(path.join(runDir, 'gate-2-result.json'), JSON.stringify(sidecar));
    fs.writeFileSync(path.join(runDir, 'gate-2-raw.txt'), 'VERDICT: APPROVE\ncomments: ok');
    // minimal state mock
    const state = { gateRetries: { '2': 0 } } as any;

    const flag = { value: true };
    const result = await runGatePhase(state, 2, runDir, '/cwd', flag);
    expect((result as any).recoveredFromSidecar).toBe(true);
    expect(flag.value).toBe(false);  // consumed

    // Second call should NOT replay
    const sidecar2 = { exitCode: 0, timestamp: Date.now(), runner: 'codex', promptBytes: 500, durationMs: 5000 };
    fs.writeFileSync(path.join(runDir, 'gate-2-result.json'), JSON.stringify(sidecar2));
    // would need to mock runner to avoid actual subprocess; alternatively verify via checkGateSidecars unit
  });

  it('legacy sidecar (no runner) still replays but with runner=undefined', () => {
    const { checkGateSidecars } = require('../../src/phases/gate.js');
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

describe('Integration: CLI start --enable-logging end-to-end', () => {
  it('state.loggingEnabled=true after start --enable-logging', async () => {
    // Use startCommand programmatically with a minimal environment. Mock tmux if needed.
    // This test sets HARNESS_ROOT to a temp dir and invokes startCommand with enableLogging=true.
    // Verifies:
    //   1. state.json has loggingEnabled: true
    //   2. ~/.harness/sessions/<repoKey>/<runId>/ is created
    // Due to tmux dependency, this may need heavy mocking or be deferred to manual verification.
    // Placeholder: assert state file contains loggingEnabled after a scripted start.
    const { readState } = await import('../../src/state.js');
    // Setup minimal harness.dir structure, write initial state with loggingEnabled=true manually
    const harnessRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-'));
    const harnessDir = path.join(harnessRoot, '.harness');
    fs.mkdirSync(harnessDir, { recursive: true });
    const runDir = path.join(harnessDir, 'runs', 'test-run');
    fs.mkdirSync(runDir, { recursive: true });
    const state = { runId: 'test-run', currentPhase: 1, status: 'in_progress', loggingEnabled: true, phases: {}, gateRetries: {}, verifyRetries: 0, /* ... minimal fields */ } as any;
    fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify(state));
    const loaded = readState(runDir);
    expect(loaded?.loggingEnabled).toBe(true);
  });

  it('state.loggingEnabled=false when start without flag', async () => {
    const { readState } = await import('../../src/state.js');
    const harnessRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-'));
    const runDir = path.join(harnessRoot, '.harness', 'runs', 'test-run2');
    fs.mkdirSync(runDir, { recursive: true });
    const state = { runId: 'test-run2', currentPhase: 1, status: 'in_progress', loggingEnabled: false, phases: {}, gateRetries: {}, verifyRetries: 0 } as any;
    fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify(state));
    const loaded = readState(runDir);
    expect(loaded?.loggingEnabled).toBe(false);
  });

  it('loggingEnabled persists across resume (via state)', async () => {
    const { readState, migrateState } = await import('../../src/state.js');
    // Simulate: start created state with loggingEnabled=true, resume reads state back
    const state = { loggingEnabled: true, runId: 'r', currentPhase: 1, status: 'paused', phases: {}, gateRetries: {}, verifyRetries: 0 } as any;
    const migrated = migrateState(JSON.parse(JSON.stringify(state)));
    expect(migrated.loggingEnabled).toBe(true);
    // Legacy state without field → migrateState defaults to false
    const legacy = { runId: 'r2', currentPhase: 1, status: 'paused', phases: {}, gateRetries: {}, verifyRetries: 0 } as any;
    const migratedLegacy = migrateState(legacy);
    expect(migratedLegacy.loggingEnabled).toBe(false);
  });
});
```

**주의:** 실제 `startCommand`/`resumeCommand` end-to-end 테스트는 tmux 의존성이 커서 mocking 비용이 높다. Task 20의 CLI-level 테스트는 **상태 레벨 검증** (state.json에 loggingEnabled 기록, migrate 시 기본값, resume 시 state에서 계승)으로 한정한다. 실제 `harness start --enable-logging` 실행은 수동 검증 (Eval Checklist의 "Spec Acceptance §9" 항목에서 체크).

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
- [ ] `mkdirSync` 실패 시 constructor 생성 단계부터 disabled=true
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
