# Harness Session Logging — Design Spec

- 상태: draft (rev 2, Codex gate feedback 반영)
- 작성일: 2026-04-18
- 담당: Claude Code (engineer), Codex (reviewer)
- 관련 문서:
  - Impl plan: `docs/plans/2026-04-18-session-logging.md` (작성 예정)
  - Eval report: `docs/process/evals/2026-04-18-session-logging-eval.md` (작성 예정)
  - 배경: `docs/HOW-IT-WORKS.md`

## 1. 배경과 목표

harness-cli를 end-to-end로 사용하면서 다음과 같은 관찰 가능성 질문에 답할 수 없다:

- 어느 phase가 얼마나 걸렸는가? 전체 run의 시간 분포는?
- Phase 4(plan gate)가 토큰을 과다 소모하는가? 어느 attempt에서?
- Phase 2에서 retry가 몇 번 일어났는가? 각 retry의 정확한 타임스탬프는?
- 자동으로 다음 phase로 넘어가야 하는데 실제로는 어떤 이벤트가 튀었는가(버그 후보)?
- 에스컬레이션에서 사용자가 C/S/Q 중 어느 선택을 했는가?

이 모든 정보를 각 `harness run` 세션마다 구조화된 로그로 남겨, 후속 분석으로 harness CLI 자체를 개선할 단서를 얻는다.

로깅은 **opt-in**이며 `harness start <task> --enable-logging` 플래그로 활성화한다. 기본값은 off로, 기존 사용자 경험에 변화가 없다.

> 참고: "그때의 feedback 원문은 무엇이었는가?"는 본 v1 범위에 포함되지 않는다. 현재 `gate-N-feedback.md` / `verify-feedback.md`는 다음 retry에서 덮어써지므로, 원문을 후속 분석할 수 있게 하려면 파일명 교체가 필요하다 (§8 YAGNI 참고). v1에서는 retry 이벤트의 타임스탬프, retry 인덱스, feedback 바이트 수, 피드백 요약 preview(앞 200자)만 기록한다.

## 2. Context & Decisions

### 핵심 결정사항

- **Opt-in 전용**: `--enable-logging` 플래그가 있을 때만 활성화. state에 `loggingEnabled: boolean` 플래그로 영속화하여 resume에서도 자동 승계. 플래그는 `harness start`에서만 받는다; `harness resume`은 state에서 읽는다.
- **이벤트 스트림 + 세션 요약**: `events.jsonl`(append-only 이벤트 스트림)이 **authoritative** 소스. `summary.json`은 events.jsonl에서 파생된 **best-effort** 집계 (phase/세션 단위).
- **저장 위치**: `~/.harness/sessions/<repoKey>/<runId>/`. `repoKey = sha1(harnessDir 절대경로).slice(0,12)`. 서로 다른 repo의 같은 runId 충돌 방지. meta.json에 `harnessDir`/`cwd` 원본 경로 저장하여 추후 역매핑 가능.
- **토큰 scope**: Codex runner gate의 `tokens used\n<총합>` stdout 라인만 파싱해 기록. Claude runner gate와 Claude interactive phase(1/3/5)는 실시간 토큰 측정 불가 → duration만 기록.
- **Content scope**: 메타데이터 + 파일 경로 참조만. spec/plan/feedback 본문은 복사하지 않는다.
- **중앙 SessionLogger + 명시적 호출**: runner/gate 핸들러에서 명시적으로 `logger.logEvent` 호출. logger는 `__inner` 서브프로세스(`src/commands/inner.ts`) 안에서 생성/소유한다. Outer `start`/`resume` 프로세스는 logger를 만들지 않는다 (프로세스 경계 때문).
- **비침투성 제1원칙**: logger 내부 실패는 상위로 전파되지 않는다. 로깅 실패가 harness run을 깨뜨리면 안 된다.
- **스키마 버전**: 모든 이벤트에 `v: 1` 필드. 이후 스키마 변경은 v 증가.
- **시도별(per-attempt) 타이밍**: phase 1/3/5는 `phaseAttemptId`로 구분, gate phase는 retry index로 구분. gate/verify 이벤트는 `retryIndex` + `recoveredFromSidecar` 플래그로 replay 구별.

### 제약 조건

- **프로세스 경계**: `harness start` / `harness resume`은 tmux로 `__inner <runId>` 서브프로세스를 spawn하고 자기 자신은 곧 종료한다. `runPhaseLoop`는 `__inner` 안에서만 실행된다. 따라서 logger 라이프사이클은 `__inner`에 종속된다.
- **Task 캡처 타이밍**: `inner.ts`가 task를 대화형으로 입력받을 수 있으므로(`task.md` 비어있을 때), `meta.json.task`와 `session_start` 이벤트는 **task 캡처 후**에 쓴다.
- **Resume recovery**: `src/resume.ts`에는 `applyStoredVerifyResult` 등 sidecar 기반 replay 로직이 있다. 로깅은 이 replay 경로에서도 누락/중복 없이 동작해야 한다 → `recoveredFromSidecar: true` 플래그로 구별.
- **Runner 가변성**: phase 2/4/7은 phasePresets에 따라 Codex 또는 Claude 런너를 쓸 수 있다 (`src/config.ts`). 따라서 `gate_verdict.tokensTotal`은 `runner === 'codex'`일 때만 존재.
- `~/.harness/` 생성 실패/디스크 full/권한 오류 가능 → best-effort, 첫 실패 이후 logger 비활성화 + stderr 1회 경고.

### 해소된 모호성

- **default on vs opt-in** → opt-in (`--enable-logging`).
- **token 분류(input/output/reasoning)** → Codex exec 모드는 총합만 노출 → `tokensTotal` 단일 숫자. v2에서 세분화.
- **runId 글로벌 충돌** → repoKey namespace로 해결.
- **session_start vs session_resumed 구분 시점** → `inner.ts`가 task.md 상태로 판단 (existingTask = `fs.existsSync(taskMdPath) && 파일이 비어있지 않음`). existingTask가 없었는데 새로 캡처 → `session_start`. existingTask가 이미 있으면 → `session_resumed`.
- **Replay idempotency** → authoritative: events.jsonl. 중복 허용하되 terminal 이벤트(gate_verdict/verify_result/phase_end)에는 `recoveredFromSidecar: boolean`과 `retryIndex`를 포함시켜 분석기가 dedupe 가능하게 한다.
- **Summary for incomplete sessions** → events.jsonl가 authoritative. summary.json은 마지막 `phase_end` 또는 `session_end`까지만 집계. `session_end` 없으면 `summary.status = "interrupted"`, `endedAt = 마지막 event ts`.

### 구현 시 주의사항

- `gate_verdict` 이벤트는 `deleteGateSidecars` 호출 **이전에** emit한다. 토큰/세션ID는 이미 `runCodexGate` 반환값에 포함돼 있어 sidecar 접근 불필요.
- `runCodexGate`는 기존 return에 `tokensTotal?: number`, `codexSessionId?: string` 필드를 추가. `GatePhaseResult.verdict`/`error`에 동일 필드 확장.
- `runClaudeGate`에는 토큰 필드 추가 없음 (Claude `--print`은 총합 미노출). `runner` 식별자만 logger로 전달.
- `createInitialState` 시그니처 확장 → 모든 테스트 호출부 갱신 필요.
- `NoopLogger`는 모든 메서드 즉시 return. 로깅 off에서 hot path에 영향을 주지 않는다.
- 모든 `logEvent`/`finalizeSummary` 호출은 logger 내부에서 try/catch 되어 있어야 한다; 호출자는 감싸지 않는다.
- Logger는 **inner 프로세스** 소유. start.ts/resume.ts는 오직 `--enable-logging` 플래그를 state로 persist 하는 역할만.
- `src/resume.ts`의 `applyStoredVerifyResult` 등 replay 진입점에서는 emit 시 `recoveredFromSidecar: true` 플래그 포함.

## 3. 구성요소

### 3.1 신규 파일

- **`src/logger.ts`**
  - `SessionLogger` 인터페이스 + `LogEvent` discriminated union
  - `FileSessionLogger` 클래스 (JSONL append + summary rewrite + meta upsert)
  - `NoopLogger` 클래스 (모든 메서드 no-op)
  - `createSessionLogger(runId, harnessDir, loggingEnabled, options)` factory
  - `computeRepoKey(harnessDir): string` helper (sha1 prefix)

### 3.2 수정 파일

| 파일 | 변경 내용 |
|---|---|
| `src/commands/start.ts` | `--enable-logging` 플래그 파싱 → `state.loggingEnabled` persist |
| `src/commands/resume.ts` | 변경 없음 (state에서 자동 승계) |
| `src/commands/inner.ts` | state 로드 후 `state.loggingEnabled`가 true면 logger 생성; task 캡처 후 `session_start` 또는 `session_resumed` 이벤트; `runPhaseLoop`에 logger 주입; finally 블록에서 `session_end` + `finalizeSummary` + `logger.close()` |
| `src/resume.ts` | replay 진입점(`applyStoredVerifyResult`, 기타 sidecar 기반 회복)에 logger 인자 추가; 각 emit에 `recoveredFromSidecar: true` 포함 |
| `src/types.ts` | `HarnessState`에 `loggingEnabled: boolean` 추가; `GatePhaseResult`에 `tokensTotal?: number`, `codexSessionId?: string`, `durationMs?: number`, `runner: 'claude'\|'codex'` 추가 |
| `src/state.ts` | `createInitialState` 시그니처에 `loggingEnabled` 추가; `migrateState`에서 기본값 `false` |
| `src/phases/runner.ts` | `runPhaseLoop`/`handleInteractivePhase`/`handleGatePhase`/`handleGateReject`/`handleGateEscalation`/`handleGateError`/`handleVerifyPhase`/`handleVerifyFail`/`handleVerifyEscalation`/`handleVerifyError`/`forcePassGate`/`forcePassVerify`에 logger 인자 추가 및 이벤트 호출 |
| `src/phases/gate.ts` | `runGatePhase` return에 `runner: 'claude'\|'codex'` 포함되도록 전파 |
| `src/runners/codex.ts` | `runCodexGate`에서 stdout 파싱으로 tokensTotal/sessionId 채움 |
| `src/runners/claude.ts` | 변경 없음 (Claude gate는 tokensTotal 없이 runner 식별자만) |
| `src/phases/verdict.ts` | 보조 함수 `extractCodexMetadata(stdout)` 추가 |

### 3.3 테스트

- `tests/logger.test.ts` (신규 unit)
- `tests/integration/logging.test.ts` (신규 integration — mocked runners)
- `tests/phases/verdict.test.ts` (extractCodexMetadata 추가)
- `tests/phases/runner.test.ts`, `tests/state.test.ts`, `tests/commands/*.test.ts`, `tests/resume.test.ts` (시그니처 변경 반영)

## 4. 데이터 스키마

### 4.1 파일 레이아웃

```
~/.harness/sessions/<repoKey>/<runId>/
├── meta.json         # { v, runId, repoKey, harnessDir, cwd, gitBranch?, task, startedAt, autoMode, harnessVersion, resumedAt[] }
├── events.jsonl      # 한 줄 = 한 이벤트 (append-only, authoritative)
└── summary.json      # phase/세션 집계 (phase 종료마다 rewrite, 종료 시 최종; best-effort)
```

`repoKey = sha1(harnessDir 절대경로).slice(0,12)` — 예: `a1b2c3d4e5f6`. meta.json에 원본 경로가 있어 사람이 추적 가능.

### 4.2 이벤트 공통

```jsonc
{ "v": 1, "ts": 1713430000000, "runId": "2026-04-18-session-logging", "phase": 2, "attemptId": null, "event": "...", /* ... */ }
```

- `v`: 스키마 버전 (현재 1)
- `ts`: epoch ms
- `runId`: 현재 run ID
- `phase?`: 관련 phase 번호
- `attemptId?`: interactive phase의 phaseAttemptId (gate는 null/없음)

### 4.3 이벤트 목록 (v=1)

| event | 주요 payload |
|---|---|
| `session_start` | task, autoMode, baseCommit, harnessVersion |
| `session_resumed` | fromPhase, stateStatus |
| `phase_start` | phase, attemptId, reopenFromGate? |
| `runner_spawn` | phase, runner ("claude"\|"codex"), model, effort, promptBytes? |
| `runner_exit` | phase, runner, pid, exitCode, durationMs |
| `gate_verdict` | phase, retryIndex, runner ("claude"\|"codex"), verdict ("APPROVE"\|"REJECT"), tokensTotal? (Codex만), promptBytes, codexSessionId? (Codex만), commentSeverities?: {P0,P1,P2,P3}, recoveredFromSidecar?: boolean |
| `gate_error` | phase, retryIndex, runner, error, exitCode?, durationMs |
| `gate_retry` | phase, retryCount, retryLimit, feedbackPath, feedbackBytes, feedbackPreview (앞 200자) |
| `escalation` | phase, reason ("gate-retry-limit"\|"gate-error"\|"verify-limit"\|"verify-error"), userChoice? ("C"\|"S"\|"Q"\|"R") |
| `force_pass` | phase, by ("auto"\|"user") |
| `verify_result` | passed, retryIndex, durationMs, failedChecks?, recoveredFromSidecar?: boolean |
| `phase_end` | phase, attemptId, status ("completed"\|"failed"\|"reopened"), durationMs |
| `state_anomaly` | kind, details |
| `session_end` | status ("completed"\|"paused"\|"failed"\|"interrupted"), totalDurationMs |

### 4.4 summary.json

**Dedupe 규칙:** summary는 events.jsonl을 순회해 phase별로 집계한다. `gate_verdict` / `verify_result` 중 `recoveredFromSidecar === true`인 이벤트는 같은 `(phase, retryIndex)` 키의 authoritative(=false) 이벤트와 중복되면 **버린다**. 단, authoritative가 없을 경우에는 recovered를 대체 소스로 사용한다.

**Incomplete session:** `session_end`가 없으면 `summary.status = "interrupted"`, `summary.endedAt = 마지막 이벤트의 ts`.

```jsonc
{
  "v": 1,
  "runId": "2026-04-18-...",
  "repoKey": "a1b2c3d4e5f6",
  "startedAt": 1713430000000,
  "endedAt": 1713439000000,
  "totalDurationMs": 9000000,
  "status": "completed",  // "interrupted" | "paused" | "failed" 가능
  "autoMode": false,
  "phases": {
    "1": {
      "attempts": [
        { "attemptId": "uuid-1", "startedAt": 1713430000000, "durationMs": 300000, "status": "completed", "reopenedFromGate": null }
      ],
      "totalDurationMs": 300000
    },
    "2": {
      "attempts": [
        { "retryIndex": 0, "startedAt": 1713430300000, "durationMs": 30000, "runner": "codex", "verdict": "REJECT", "tokensTotal": 45000 },
        { "retryIndex": 1, "startedAt": 1713430330000, "durationMs": 28000, "runner": "codex", "verdict": "APPROVE", "tokensTotal": 42000 }
      ],
      "totalDurationMs": 58000,
      "totalTokens": 87000,
      "gateRetries": 1
    }
  },
  "totals": {
    "gateTokens": 120000,
    "gateRejects": 1,
    "escalations": 0,
    "verifyFailures": 0,
    "forcePasses": 0
  }
}
```

### 4.5 meta.json

```jsonc
{
  "v": 1,
  "runId": "...",
  "repoKey": "a1b2c3d4e5f6",
  "harnessDir": "/path/to/repo/.harness",
  "cwd": "/path/to/repo",
  "gitBranch": "logging",
  "task": "사용자 task 원문",
  "startedAt": 1713430000000,
  "autoMode": false,
  "harnessVersion": "0.x.y",
  "resumedAt": [ 1713435000000 ]
}
```

## 5. 통합 지점 상세

### 5.1 Logger 라이프사이클 (`__inner` 내부)

```ts
// src/commands/inner.ts (simplified — 실제 구조에 삽입)
async function innerCommand(runId, options) {
  const state = readState(runDir);
  // ... (pane setup)

  // task 캡처 블록 종료 직후, InputManager 생성 직후 지점에:
  const logger = createSessionLogger(runId, harnessDir, state.loggingEnabled);
  const isFirstStart = !wasTaskPresentBeforeThisInvocation;  // 기존 taskMdPath 존재 + 비어있지 않음 여부
  try {
    if (isFirstStart) {
      logger.logEvent({ event: 'session_start', task: state.task, autoMode: state.autoMode, baseCommit: state.baseCommit, harnessVersion });
    } else {
      logger.logEvent({ event: 'session_resumed', fromPhase: state.currentPhase, stateStatus: state.status });
    }

    await runPhaseLoop(state, harnessDir, runDir, cwd, inputManager, logger);

    logger.logEvent({ event: 'session_end', status: state.status, totalDurationMs: Date.now() - startedAtMs });
  } finally {
    logger.finalizeSummary(state);
    logger.close();
    inputManager.stop();
    releaseLock(harnessDir, runId);
  }
}
```

`createSessionLogger`는 `state.loggingEnabled === false`이면 즉시 `NoopLogger` 반환.

### 5.2 Resume 경로

`src/commands/resume.ts`(outer) → `state.loggingEnabled`를 argv로 전달할 필요 없음 (state에 이미 있음).  
`__inner` 진입 시 state 기반으로 logger 생성 → `session_resumed` 이벤트 emit + `meta.json.resumedAt`에 timestamp push.

`src/resume.ts`의 sidecar replay 경로(`applyStoredVerifyResult` 등)에서:

```ts
// 예: applyStoredVerifyResult 내부 PASS 분기
if (logger) {
  logger.logEvent({
    event: 'verify_result',
    passed: true,
    retryIndex: state.verifyRetries,
    durationMs: 0,          // replay에는 실행 시간 없음
    recoveredFromSidecar: true,
  });
}
```

logger 인자는 inner.ts에서 resume 재개 헬퍼로 명시 전달.

### 5.3 Gate verdict 추출 순서

`src/phases/runner.ts` → `handleGatePhase` APPROVE 분기:

```ts
if (result.type === 'verdict' && result.verdict === 'APPROVE') {
  logger.logEvent({
    event: 'gate_verdict',
    phase,
    retryIndex: state.gateRetries[String(phase)] ?? 0,
    runner: result.runner,          // 'claude' | 'codex'
    verdict: 'APPROVE',
    tokensTotal: result.tokensTotal,       // undefined if runner === 'claude'
    promptBytes,
    codexSessionId: result.codexSessionId, // undefined if runner === 'claude'
  });
  state.phases[String(phase)] = 'completed';
  deleteGateSidecars(runDir, phase);
  // ...advance
}
```

REJECT 분기에서도 동일 순서로 `gate_verdict`(verdict=REJECT) + `gate_retry` 이벤트를 emit.

### 5.4 Codex 메타데이터 추출

```ts
// src/phases/verdict.ts 에 추가
export function extractCodexMetadata(stdout: string): { tokensTotal?: number; codexSessionId?: string } {
  const out: { tokensTotal?: number; codexSessionId?: string } = {};
  const m = stdout.match(/^tokens used\s*\n([\d,]+)/m);
  if (m) out.tokensTotal = parseInt(m[1].replace(/,/g, ''), 10);
  const s = stdout.match(/session id:\s*([0-9a-f-]+)/i);
  if (s) out.codexSessionId = s[1];
  return out;
}
```

`runCodexGate` 내부에서 stdout 수집 후 호출해 `GatePhaseResult`에 첨부. `runClaudeGate`는 변경 없음.

### 5.5 State anomaly (v1 최소 감지)

다음 두 지점에 명시적 anomaly 이벤트:

- `handleGatePhase` APPROVE 완료 직후: `state.pendingAction !== null` → `state_anomaly { kind: 'pending_action_stale_after_approve', details: { phase, pendingActionType } }`
- `handleInteractivePhase` phase 5 completed 직후: `state.phaseReopenFlags['5'] === true` → `state_anomaly { kind: 'phase_reopen_flag_stuck', details: { phase: 5 } }`

### 5.6 Replay / Idempotency 규칙

1. Runner/sidecar가 **실제로 재실행되지 않고** 저장된 결과만 적용되는 경로(`src/resume.ts`의 recovery 함수들)에서 terminal 이벤트(gate_verdict, verify_result)는 `recoveredFromSidecar: true`로 emit.
2. events.jsonl은 authoritative. 같은 `(phase, retryIndex)` 키에 authoritative(=false) 이벤트가 먼저 존재하면 분석기는 recovered를 버린다.
3. summary.json 재계산 시 이 dedupe 규칙을 적용.
4. authoritative 이벤트가 누락된 경우(JSONL flush 이전 crash): recovered가 유일한 terminal 증거로 사용된다.

### 5.7 repoKey 계산

```ts
// src/logger.ts
import { createHash } from 'crypto';
export function computeRepoKey(harnessDir: string): string {
  return createHash('sha1').update(harnessDir).digest('hex').slice(0, 12);
}
```

Sessions 디렉토리 조회는 meta.json을 읽어 `cwd`로 매핑.

## 6. 에러 처리

### 6.1 I/O 실패

- `mkdirSync(~/.harness/sessions/<repoKey>/<runId>, {recursive:true})` 실패 → logger 즉시 비활성화 + stderr 1줄 경고
- `appendFileSync` 실패 → 1회 stderr 경고, 이후 실패 조용히 삼킴
- `renameSync` (summary.json 원자 write) 실패 → 경고 후 다음 phase에서 재시도

### 6.2 시그널 / 비정상 종료

- JSONL append-only → SIGKILL 시 마지막 쓴 줄까지 유효
- `summary.json`은 phase 종료마다 overwrite → 중단돼도 최신 phase까지 집계 유지
- `session_end` 없을 시: summary는 `status: "interrupted"`, `endedAt = 마지막 event.ts`

### 6.3 Resume와 append

- `events.jsonl` truncate 안 함 (append 모드)
- `meta.json` idempotent 업데이트: `resumedAt` 배열에 push, 다른 필드는 첫 기록 유지
- 세션 초기 생성 시점이 아닌 resume 진입이면 meta.json이 이미 존재 → 단순 merge

## 7. 테스트 계획

### 7.1 Unit (`tests/logger.test.ts`)

- `FileSessionLogger.logEvent`: 한 줄 append, `v` 필드 포함, ts 단조 증가
- `logEvent` fs.appendFileSync throw 시 예외 전파 없음, stderr warn 1회
- `NoopLogger`: 모든 메서드 즉시 return, 디렉토리 미생성
- `finalizeSummary`: `summary.json.tmp` → rename
- append 모드 재오픈: 기존 이벤트 보존
- `computeRepoKey`: 같은 입력 → 같은 출력, 다른 입력 → 다른 출력, 결과 길이 12
- summary 생성 시 `recoveredFromSidecar === true`가 `(phase, retryIndex)` 중복이면 드롭

### 7.2 Verdict helper (`tests/phases/verdict.test.ts`)

- `extractCodexMetadata`: `tokens used\n19,123` → 19123, `session id: abc…` → 문자열
- 두 라인 모두 부재 → 빈 객체
- 콤마 유무 / 대소문자 변형 허용

### 7.3 Integration (`tests/integration/logging.test.ts`)

- `harness start --enable-logging` → 적절한 `<repoKey>/<runId>` 디렉토리 생성, `session_start` 이벤트 존재, `state.loggingEnabled === true`
- 플래그 없이 start → `~/.harness/sessions/` 경로에 어떤 파일도 미생성
- resume → `session_resumed` 이벤트 1개 추가, 기존 줄 보존
- mocked runner로 Codex gate APPROVE → `gate_verdict` 이벤트에 `runner:'codex'` + `tokensTotal` 포함
- mocked Claude gate APPROVE → `gate_verdict`에 `runner:'claude'`, `tokensTotal` 없음
- gate REJECT → `gate_verdict`(REJECT) + `gate_retry` 이벤트 순서 확인
- anomaly 2종 감지 (pending_action stale / reopen_flag stuck)
- `recoveredFromSidecar:true` emit 경로 (applyStoredVerifyResult mock) → summary dedupe 확인

### 7.4 회귀

- `--enable-logging` 없이 기존 테스트 스위트 100% 통과 (NoopLogger)
- 시그니처 변경된 호출부 전부 업데이트 (runPhaseLoop, createInitialState, resume handlers)

## 8. 범위 외 (YAGNI)

- `harness logs <runId>` / `harness logs list` / `harness logs prune` CLI
- 전체 Codex stdout / Claude transcript 저장
- 토큰 세분화 (input/output/reasoning)
- 실시간 tail UI / live metrics export
- 자동 retention/rotation
- 로그 업로드·텔레메트리
- **retry별 feedback 파일 원문 보존** — `gate-N-feedback.md` / `verify-feedback.md`를 `gate-N-feedback-r<idx>.md` 스킴으로 교체하는 작업. v1에서는 `gate_retry` 이벤트의 preview 200자만 기록. 사용자 선택에 따라 v2에서 전체 filename refactor.

## 9. 수락 기준

- `harness start --enable-logging "task"` 실행 시 `~/.harness/sessions/<repoKey>/<runId>/{events.jsonl, summary.json, meta.json}` 생성
- `--enable-logging` 없이 start → `~/.harness/sessions/` 경로에 어떤 파일도 생성되지 않음
- Codex runner gate(기본 2/4/7)의 `gate_verdict` 이벤트에 `runner:'codex'` + `tokensTotal` 포함 (Codex stdout에 `tokens used` 라인이 있을 때)
- Claude runner gate의 `gate_verdict` 이벤트에 `runner:'claude'` 포함, `tokensTotal` 없음
- Resume 시 기존 `events.jsonl` 보존 + `session_resumed` 이벤트 1개 추가 + `meta.json.resumedAt[]`에 push
- `src/resume.ts`의 sidecar replay 경로에서 emit되는 terminal 이벤트는 `recoveredFromSidecar: true`
- 서로 다른 repo의 동명 runId → 서로 다른 `<repoKey>` 디렉토리로 분리
- Logger 내부 예외는 harness run을 abort시키지 않음 (fs mock throw 테스트로 보장)
- 기존 테스트 스위트 전체 통과
