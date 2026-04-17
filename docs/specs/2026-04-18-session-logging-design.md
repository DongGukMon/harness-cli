# Harness Session Logging — Design Spec

- 상태: draft (rev 15, Codex gate feedback 14차 반영)
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
- **Resume recovery**: 현재 production 코드에서 `src/resume.ts`의 `resumeRun`은 **dead code**(`inner.ts`에 `// For now, we skip calling resumeRun here` 주석 있음). 실제 replay는 **gate 한 종류**에만 존재: `src/phases/gate.ts`의 `runGatePhase` → `checkGateSidecars`가 존재하는 sidecar를 발견하면 Codex 재실행 없이 `GatePhaseResult`를 조립해 리턴. verify는 `runVerifyPhase`가 매번 `verify-result.json`을 삭제 후 재실행하므로 replay 없음. 로깅은 gate replay만 다룬다 → `GatePhaseResult.recoveredFromSidecar`로 구별.
- **Runner 가변성**: phase 2/4/7은 phasePresets에 따라 Codex 또는 Claude 런너를 쓸 수 있다 (`src/config.ts`). 따라서 `gate_verdict.tokensTotal`은 `runner === 'codex'`일 때만 존재.
- `~/.harness/` 생성 실패/디스크 full/권한 오류 가능 → best-effort, 첫 실패 이후 logger 비활성화 + stderr 1회 경고.

### 해소된 모호성

- **default on vs opt-in** → opt-in (`--enable-logging`).
- **token 분류(input/output/reasoning)** → Codex exec 모드는 총합만 노출 → `tokensTotal` 단일 숫자. v2에서 세분화.
- **runId 글로벌 충돌** → repoKey namespace로 해결.
- **session_start vs session_resumed 구분 시점** → `inner.ts`가 `options.resume` 플래그로 판단. `harness start`는 `__inner <runId>`(플래그 없음), `harness resume`은 `__inner <runId> --resume`으로 spawn하므로 이 신호가 가장 신뢰할 수 있다. 보조 체크: 세션 디렉토리의 `meta.json` 존재 여부(idempotency용).
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
- Gate replay(`checkGateSidecars`가 값을 리턴하는 경로)에서는 `GatePhaseResult`에 `recoveredFromSidecar: true`가 설정되고, runner.ts의 gate_verdict emit 시 이 플래그를 포함한다.
- `src/resume.ts`는 현재 dead code(caller 없음)지만 `runPhaseLoop`, `handleGateEscalation`, `handleVerifyEscalation`, `handleVerifyError` 등을 import/호출한다. 이들의 시그니처에 logger 파라미터가 추가되므로 compile 깨짐 방지를 위해 각 호출부에 `new NoopLogger()`를 전달하도록 수정한다. 기능 변경은 없음. 나중에 `resumeRun` 경로가 재활성화되면 v2에서 recoveredFromSidecar 전파 및 실제 logger 전달을 확장.

## 3. 구성요소

### 3.1 신규 파일

- **`src/logger.ts`**
  - `SessionLogger` 인터페이스 + `LogEvent` discriminated union
  - `FileSessionLogger` 클래스 (JSONL append + summary rewrite + meta upsert)
    - `hasBootstrapped(): boolean` — meta.json이 디스크에 존재하는지 여부. 초기화 시 on-disk 체크. `writeMeta`/`updateMeta` 첫 호출 시에도 true로 전환. `§5.1`의 `session_start` vs `session_resumed` emit 판단에만 사용.
  - `hasEmittedSessionOpen(): boolean` — 현재 `__inner` 프로세스 내에서 `session_start` 또는 `session_resumed` 이벤트가 emit됐는지 여부. 초기 false. 해당 이벤트 emit 직후 true로 전환. `onConfigCancel` lazy bootstrap 판단에 사용 (meta.json 존재와 이벤트 emit 상태를 분리해야 resume + pre-event cancel에서 누락 방지).
  - `NoopLogger` 클래스 (모든 메서드 no-op; `hasBootstrapped()` 및 `hasEmittedSessionOpen()`는 항상 true 반환하여 lazy bootstrap 로직이 no-op 경로로 skip되도록)
  - `createSessionLogger(runId, harnessDir, loggingEnabled, options)` factory
  - `computeRepoKey(harnessDir): string` helper (sha1 prefix)

### 3.2 수정 파일

| 파일 | 변경 내용 |
|---|---|
| `bin/harness.ts` | `start` / `run` 명령에 `--enable-logging` CLI 플래그 등록 → `StartOptions`에 전달 |
| `src/commands/start.ts` | `StartOptions.enableLogging` 수신 → `state.loggingEnabled` persist |
| `src/commands/resume.ts` | 변경 없음 (state에서 자동 승계); 단, `src/resume.ts`의 `resumeRun`이 runner.ts 함수를 호출하는 경우 logger 파라미터가 추가되므로, `resumeRun`이 활성화될 경우를 위해 해당 호출부에 `NoopLogger`를 전달하도록 수정 필요 (현재 dead code이므로 호출부 존재 시 compile error 방지용) |
| `src/resume.ts` | `resumeRun` 내에서 runner.ts의 logger-aware 함수를 호출하는 경우 `new NoopLogger()` 전달. 기능 변경 없음 (dead code 유지). |
| `src/commands/inner.ts` | state 로드 후 `state.loggingEnabled`가 true면 logger 생성; `options.resume`으로 session_start vs session_resumed 판단; `runPhaseLoop`에 logger 주입; finally 블록에서 `session_end` + `finalizeSummary` + `logger.close()` |
| `src/types.ts` | `HarnessState`에 `loggingEnabled: boolean` 추가; `GatePhaseResult` verdict/error 타입 모두에 `tokensTotal?: number`, `codexSessionId?: string`, `durationMs?: number`, `runner?: 'claude'\|'codex'`, `recoveredFromSidecar?: boolean`, `promptBytes?: number` 추가 (모두 optional) |
| `src/state.ts` | `createInitialState` 시그니처에 `loggingEnabled` 추가; `migrateState`에서 기본값 `false` |
| `src/phases/runner.ts` | `runPhaseLoop`/`handleInteractivePhase`/`handleGatePhase`/`handleGateReject`/`handleGateEscalation`/`handleGateError`/`handleVerifyPhase`/`handleVerifyFail`/`handleVerifyEscalation`/`handleVerifyError`/`forcePassGate`/`forcePassVerify`에 logger 인자 추가 및 이벤트 호출. `handleInteractivePhase`에서 `attemptId = uuid()` 생성 후 `runInteractivePhase`에 전달 |
| `src/phases/interactive.ts` | `runInteractivePhase(state, ..., attemptId: string)` 시그니처에 `attemptId` 파라미터 추가. `preparePhase()` 내부에서 생성하던 `state.phaseAttemptId`를 외부에서 전달받은 값으로 대체. 반환 타입에 `attemptId: string` 추가 |
| `src/phases/gate.ts` | `runGatePhase` return에 `runner: 'claude'\|'codex'`, `recoveredFromSidecar`, `promptBytes`, `durationMs` 포함하도록 전파. `checkGateSidecars`가 조립하는 결과에 `recoveredFromSidecar: true` 설정. `gate-N-result.json` write 시 `runner`, `promptBytes`, `durationMs` 추가 저장 |
| `src/runners/codex.ts` | `runCodexGate`에서 stdout 파싱으로 tokensTotal/sessionId 채움 |
| `src/runners/claude.ts` | 변경 없음 (Claude gate는 tokensTotal 없이 runner 식별자만) |
| `src/phases/verdict.ts` | 보조 함수 `extractCodexMetadata(stdout)` 추가 |

### 3.3 테스트

- `tests/logger.test.ts` (신규 unit)
- `tests/integration/logging.test.ts` (신규 integration — mocked runners)
- `tests/phases/verdict.test.ts` (extractCodexMetadata 추가)
- `tests/phases/runner.test.ts`, `tests/state.test.ts`, `tests/commands/*.test.ts`, `tests/resume.test.ts` (모두 `createInitialState` 시그니처 변경 반영)

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
| `phase_start` | phase, attemptId, reopenFromGate?, retryIndex? (verify phase 재시도 시 `state.verifyRetries` pre-mutation 값. gate phase는 `phase_start`를 emit하지 않으므로 해당 없음; gate 재시도 인덱스는 `gate_verdict`/`gate_error`/`gate_retry`에만 존재) |
| `gate_verdict` | phase, retryIndex, runner ("claude"\|"codex"), verdict ("APPROVE"\|"REJECT"), durationMs? (fresh 실행 필수; legacy sidecar replay 시 undefined 허용 — 아래 §5.2 policy 참조), tokensTotal? (Codex만), promptBytes?, codexSessionId? (Codex만), recoveredFromSidecar?: boolean |
| `gate_error` | phase, retryIndex, runner?, error, exitCode?, durationMs?, recoveredFromSidecar?: boolean — `retryIndex = state.gateRetries[phase] ?? 0` (reject 카운터와 공유). `runner`, `durationMs`는 fresh 실행 시 필수, legacy sidecar replay 시 optional. |
| `gate_retry` | phase, retryIndex (pre-mutation, reject 직후 시점), retryCount (= retryIndex + 1), retryLimit, feedbackPath, feedbackBytes, feedbackPreview (앞 200자) |
| `escalation` | phase, reason ("gate-retry-limit"\|"gate-error"\|"verify-limit"\|"verify-error"), userChoice? ("C"\|"S"\|"Q"\|"R") |
| `force_pass` | phase, by ("auto"\|"user") |
| `verify_result` | passed, retryIndex, durationMs, failedChecks? |
| `phase_end` | phase, attemptId, status ("completed"\|"failed"), durationMs, details? ({ reason: string } — 예: `{ reason: 'redirected' }` for control-signal redirect case) |
| `state_anomaly` | kind, details |
| `session_end` | status ("completed"\|"paused"\|"interrupted"), totalWallMs |

**v1 범위 축소:** `runner_spawn`/`runner_exit`는 v1에 포함하지 않는다. 이유:
- Interactive phase(Claude tmux) subprocess는 pid만 얻을 수 있고 exitCode/duration은 pane 안에서 자체 종료 → harness가 관측 불가
- Verify subprocess는 `src/phases/verify.ts`가 독점 관리 → logger 주입 scope 확대 필요
- Gate Codex subprocess는 runCodexGate가 pid/exitCode/duration 모두 알지만 `gate_verdict`/`gate_error`가 이미 커버

v2에서 필요시 verify.ts/runClaudeInteractive까지 logger를 확장해 추가한다.

### 4.4 summary.json

**Dedupe 규칙:**
- `gate_verdict`: 같은 `(phase, retryIndex)` 키에서 `recoveredFromSidecar === true` 이벤트는 authoritative(false) 이벤트와 중복되면 **버린다**. authoritative가 없으면 recovered를 대체 소스로 사용.
- `gate_error`: 사이드카는 phase당 1개(`gate-N-result.json`)만 존재하므로, 같은 `(phase)` 키에서 `recoveredFromSidecar === true` gate_error 이벤트는 authoritative gate_error 이벤트가 있으면 버린다. `retryIndex`가 같은 phase의 여러 error retry와 충돌할 수 있으므로 `(phase, retryIndex)` 대신 `(phase)` 단위로 dedupe. authoritative가 없으면 recovered를 대체로 사용.

**Incomplete session:** `session_end`가 없으면 `summary.status = "interrupted"`, `summary.endedAt = 마지막 이벤트의 ts`.

**`totalWallMs` 정의:** `session_end.ts - meta.startedAt`. 즉 첫 세션 시작부터 세션 종료까지의 wall-clock 전체(pause/resume 사이의 공백 포함). 사용자가 run을 일주일 동안 내버려뒀다가 resume하면 그 시간도 포함됨을 명시적으로 선언. active 시간만 원할 경우 분석기가 events.jsonl의 `phase_start`/`phase_end` 구간 합으로 따로 계산해야 한다.

**`session_end.status` 매핑:**
- `state.status === 'completed'` → `"completed"`
- `state.status === 'paused'` → `"paused"`
- finally 블록 진입 시점에 아직 `state.status === 'in_progress'` (정상 session_end 경로를 타지 못하고 빠져나옴) → `"interrupted"`
- 즉, v1에서는 `"failed"` 상태는 emit하지 않는다. phase-level failure는 `phase_end.status === 'failed'`로 충분히 추적 가능.

```jsonc
{
  "v": 1,
  "runId": "2026-04-18-...",
  "repoKey": "a1b2c3d4e5f6",
  "startedAt": 1713430000000,
  "endedAt": 1713439000000,
  "totalWallMs": 9000000,
  "status": "completed",  // "interrupted" | "paused" 가능 (v1에서 "failed" 없음)
  "autoMode": false,
  "phases": {
    "1": {
      "attempts": [
        { "attemptId": "uuid-1", "startedAt": 1713430000000, "durationMs": 300000, "status": "completed", "reopenFromGate": null }
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
  "resumedAt": [ 1713435000000 ],
  "bootstrapOnResume": true   // 선택적 — resume 시 meta.json이 없어 bootstrap된 경우. totalWallMs 신뢰도 저하 표시.
}
```

## 5. 통합 지점 상세

### 5.1 Logger 라이프사이클 (`__inner` 내부)

```ts
// src/commands/inner.ts (simplified — 실제 구조에 삽입)
async function innerCommand(runId, options) {
  const state = readState(runDir);
  // ... (pane setup, task 캡처)

  // InputManager 생성 직후, runPhaseLoop 호출 직전에:
  const logger = createSessionLogger(runId, harnessDir, state.loggingEnabled);
  const isResume = options.resume === true;

  let sessionEndStatus: 'completed' | 'paused' | 'interrupted' = 'interrupted';
  try {
    if (isResume) {
      logger.logEvent({ event: 'session_resumed', fromPhase: state.currentPhase, stateStatus: state.status });
      logger.updateMeta({ pushResumedAt: Date.now() });
    } else {
      // meta.json이 이미 존재하면(재시작 중 finally 재진입 등 idempotent case) resumed로 처리
      const metaExists = logger.hasBootstrapped();
      if (metaExists) {
        logger.logEvent({ event: 'session_resumed', fromPhase: state.currentPhase, stateStatus: state.status });
      } else {
        logger.logEvent({ event: 'session_start', task: state.task, autoMode: state.autoMode, baseCommit: state.baseCommit, harnessVersion });
        logger.writeMeta({ /* ... */ });
      }
    }

    await runPhaseLoop(state, harnessDir, runDir, cwd, inputManager, logger);

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
}
```

- `logger.getStartedAt()`은 meta.json에 기록된 `startedAt` (최초 `harness start` 시각).
- `sessionEndStatus`는 try 블록 정상 종료 시 state.status로 매핑, 예외/비정상 종료 시 `"interrupted"` 기본값.

**meta.json bootstrap 규칙 (resume + crash case):** `options.resume === true`인데 meta.json이 존재하지 않을 경우 (이전 세션 직후 crash로 meta.json 미생성), logger는 즉시 새 meta.json을 작성하되 `bootstrapOnResume: true` 마커를 추가하고 `startedAt = Date.now()`으로 설정한다. 이 경우 `totalWallMs`는 실제 세션 전체 시간이 아닌 이 resume 시점부터의 경과 시간이 된다 (분석기가 이를 고려해야 함). `session_resumed` 이벤트는 정상적으로 emit한다.

`createSessionLogger`는 `state.loggingEnabled === false`이면 즉시 `NoopLogger` 반환.

### 5.2 Resume 경로

`src/commands/resume.ts`(outer)는 두 가지 경로를 가진다:

1. **Reattach-only 경로**: tmux 세션과 `__inner` 프로세스가 이미 살아있으면 `openTerminalWindow` 후 즉시 리턴. 이 경우 새로운 `__inner` 프로세스가 시작되지 않으므로 `session_resumed` 이벤트가 발생하지 않는다. 로깅 관점에서 이 경로는 투명하게 지나간다.

2. **새 `__inner` 스폰 경로**: 기존 프로세스가 없으면 `__inner <runId> --resume`으로 새 서브프로세스 spawn. `__inner`가 `options.resume === true`로 진입 → logger 생성 → `session_resumed` 이벤트 emit + `meta.json.resumedAt`에 timestamp push.

별도 flag 추가 없음 (state.loggingEnabled는 이미 persist됨).

**Gate sidecar replay** (`src/phases/gate.ts` → `checkGateSidecars`): sidecar가 존재해서 Codex 재실행 없이 결과를 리턴하는 경우, `GatePhaseResult`에 `recoveredFromSidecar: true`를 설정한다. `runner.ts`의 `handleGatePhase`는 이 플래그를 그대로 `gate_verdict.recoveredFromSidecar`로 emit.

**Sidecar replay 제한 (v1 확정 — session-scoped one-shot flag):** `checkGateSidecars`는 **`__inner --resume`으로 진입한 세션이 첫 번째로 도달하는 gate 호출에서만** 실행된다. 그 이후(같은 `__inner` 프로세스 생명 내) 모든 gate 호출은 `checkGateSidecars`를 건너뛴다.

구체적 구현:
1. `inner.ts`에서 `const sidecarReplayAllowed = { value: options.resume === true }`라는 one-shot 객체를 생성. `options.resume === false`(fresh start)이면 `value = false`.
2. `runPhaseLoop`에 이 객체를 파라미터로 전달 → gate 핸들러 → `runGatePhase(..., sidecarReplayAllowed)` 전달.
3. `runGatePhase` 시그니처: `runGatePhase(..., sidecarReplayAllowed: { value: boolean })`.
4. `runGatePhase` 진입 시:
   ```ts
   if (sidecarReplayAllowed.value) {
     sidecarReplayAllowed.value = false;  // consume 즉시 false로
     const replay = checkGateSidecars(runDir, phase);
     if (replay) return { ...replay, recoveredFromSidecar: true };
   }
   // 정상 gate 실행 (checkGateSidecars skip)
   ```
5. 이렇게 하면 `recoveredFromSidecar: true`는 **resume 세션의 첫 gate 호출 + 기존 sidecar 존재** 조합에서만 발생. Fresh start 또는 resume 이후의 2번째+ gate 호출에서는 절대 발생하지 않음.

**resume이 gate가 아닌 phase에 착륙한 경우:** one-shot 플래그는 **첫 gate 호출에서 소비**되므로, resume이 interactive phase로 시작되어도 그 세션 내 첫 gate 실행 시 replay가 동작한다. 즉 "이 resumed inner 세션이 만나는 최초의 gate는 sidecar replay를 시도할 수 있다"는 의미.

**Sidecar cleanup:** APPROVE/force-pass 후 `deleteGateSidecars` 호출은 기존 코드대로 유지. REJECT/error 후에는 `sidecarReplayAllowed.value === false`가 이미 소비됐으므로 stale replay가 발생하지 않아 삭제 불필요.

```ts
// src/phases/gate.ts — checkGateSidecars 수정 (결과 조립 시)
return {
  type: 'verdict',
  verdict: parsed.verdict,
  comments: parsed.comments,
  rawOutput,
  recoveredFromSidecar: true,      // ← 추가
  runner: /* sidecar 없이는 알 수 없음 */,  // 아래 주의 참고
};
```

**주의:** sidecar replay 경로는 `runner`(claude|codex), `promptBytes`, `durationMs` 정보를 sidecar만으로 알 수 없다. 해결: `gate-N-result.json`에 이 필드들을 추가로 저장(원래 실행 시 write할 때). `checkGateSidecars`가 이 필드들을 `GatePhaseResult`에 hydrate한다.

**`gate-N-result.json` 확장 schema (v1):** 기존 필드(`exitCode`, `timestamp`)는 유지하고, logging/replay용 메타데이터 필드만 신규 추가한다. Raw output은 기존대로 별도 파일 `gate-N-raw.txt`에 저장.

```jsonc
// 기존 코드의 GateResult shape + 신규 필드 (모두 optional)
{
  "exitCode": 0,                   // 기존 필드
  "timestamp": 1713430000000,      // 기존 필드
  // 신규 (logging/replay용, optional - legacy sidecar 호환)
  "runner": "claude" | "codex",
  "promptBytes": 12345,
  "durationMs": 30000,
  "tokensTotal": 45000,            // Codex runner만
  "codexSessionId": "..."          // Codex runner만
}
```

`checkGateSidecars`의 verdict/error 판단 로직은 그대로 `exitCode !== 0` 기준. `src/types.ts`의 `GateResult` 타입 확장(또는 별도 `GateResultWithMeta`)으로 신규 필드 추가. §3.2 수정 파일 목록의 `src/phases/gate.ts` 및 `src/types.ts`에 포함.

**Legacy sidecar policy:** 기존 `gate-N-result.json`에 이 필드들이 없는 경우 (`runner` 또는 `durationMs`가 undefined):
- `runner`가 없으면: `gate_verdict` / `gate_error` 이벤트를 emit하지 않고 조용히 skip. Events.jsonl에 누락으로 기록되지 않으며, summary 계산 시 해당 replay 항목도 없음.
- `runner`가 있고 `durationMs` 또는 `promptBytes`만 없으면: 해당 필드는 `undefined`로 emit (schema에서 optional). 기존 테스트는 이 필드가 없어도 읽기 호환(optional)으로.

**Gate error sidecar replay:** `checkGateSidecars`가 sidecar를 읽었지만 verdict 파싱 실패 또는 exitCode !== 0인 경우, `GatePhaseResult`에 `{ type: 'error', recoveredFromSidecar: true }`를 설정한다. `runner.ts`의 `handleGateError`는 이 플래그를 `gate_error.recoveredFromSidecar: true`로 emit해야 한다. 이로써 `gate_error` 이벤트도 replay vs. 신규 에러를 구별할 수 있다.

`src/resume.ts`는 본 스펙에서 변경 없음.

### 5.3 Gate verdict 추출 순서 및 promptBytes 플럼빙

`src/phases/gate.ts`의 `runGatePhase` 내부에서 prompt 문자열을 조립한 직후 `promptBytes = Buffer.byteLength(prompt, 'utf8')`을 계산해 `GatePhaseResult`에 포함한다. `runner.ts`는 이 값을 그대로 전달한다.

**`retryIndex` 캡처 규칙:** `gate_verdict`, `gate_error`, `verify_result`, `gate_retry` 이벤트의 `retryIndex`는 **mutation 이전에 캡처한 값**을 사용한다. 즉, `handleGateReject`/`handleGateError`/`handleVerifyFail`가 `state.gateRetries[phase]++` 또는 `state.verifyRetries++`를 하기 **전에** 현재 값을 읽어서 이벤트에 넣는다. 첫 번째 시도(실패 없음)는 `retryIndex: 0`. 첫 번째 reject/fail 이벤트의 `retryIndex`도 `0`이며, 그 다음 재시도의 `phase_start`가 `retryIndex: 1`을 가진다.

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
    promptBytes: result.promptBytes,       // Buffer.byteLength(prompt, 'utf8') in runGatePhase
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

1. 현재 production code에서 실제 sidecar replay 경로는 **gate phase 하나만** 존재: `runGatePhase`의 초입 `checkGateSidecars`가 non-null을 리턴하면 Codex 재실행 없이 결과가 반환된다. 이 경로에서 `GatePhaseResult.recoveredFromSidecar = true`를 설정하고, runner.ts 핸들러는 그대로 `gate_verdict.recoveredFromSidecar` 또는 `gate_error.recoveredFromSidecar`로 emit. verdict와 error 모두 동일하게 적용.
2. verify phase는 `runVerifyPhase`가 매번 `verify-result.json`을 삭제 후 재실행 → replay 없음.
3. events.jsonl은 authoritative. `gate_verdict`는 같은 `(phase, retryIndex)` 키에, `gate_error`는 같은 `(phase)` 키에 authoritative 이벤트가 존재하면 분석기는 recovered를 버린다. (§4.4 dedupe 규칙과 일치)
4. summary.json 재계산 시 이 dedupe 규칙을 적용.
5. authoritative 이벤트가 누락된 경우(JSONL flush 이전 crash): recovered가 유일 증거로 사용.

### 5.8 Phase lifecycle event emission matrix

`phase_start`와 `phase_end`의 정확한 emit 시점, status 값, `durationMs` 계산 방법을 핸들러별로 명세한다.

**공통 규칙:**
- `phase_start` emit 시 `phaseStartTs = Date.now()`를 핸들러 로컬 변수로 캡처.
- `phase_end.durationMs = Date.now() - phaseStartTs`.
- `phase_end.attemptId`는 interactive phase에서만 유효 (verify는 null).
- **Gate phase(2/4/7)는 `phase_start`/`phase_end`를 emit하지 않는다.** Gate 실행 타이밍은 `gate_verdict`/`gate_error`의 `durationMs`로 추적.

**Interactive & Verify phase lifecycle:**

| 핸들러 | phase_start 시점 | phase_end 시점 | phase_end.status |
|---|---|---|---|
| `handleInteractivePhase` (normal complete) | `runInteractivePhase` 호출 직전 | `runInteractivePhase` 성공 리턴 직후 (post-run artifact 작업 포함) | `'completed'` |
| `handleInteractivePhase` (post-run artifact error) | 동일 | post-run 작업(artifact auto-commit 등) 실패 → phase status `error` 설정 직전 | `'failed'` |
| `handleInteractivePhase` (control-signal redirect) | 동일 | `state.currentPhase !== phase` 감지 후 early return 직전 | `'failed'` (redirect로 이 시도가 버려짐을 표현; `details.reason='redirected'`를 attemptId와 함께 기록) |
| `handleVerifyPhase` (pass) | `runVerifyPhase` 호출 직전 | verify passed → 다음 phase 전환 직전 | `'completed'` |
| `handleVerifyPhase` (fail, retry 가능) | 동일 | `handleVerifyFail`가 phase 5 reopen 설정 직전 | `'failed'` |
| `handleVerifyPhase` (fail → retry limit) | 동일 | escalation 직전 | `'failed'` |
| `handleVerifyPhase` (runVerifyPhase returns `{type:'error'}`) | `runVerifyPhase` 호출 직전 | `handleVerifyError`로 분기 직전 (retry / quit 선택 무관하게 emit) | `'failed'` |
| `handleVerifyPhase` (runVerifyPhase throw) | 동일 | try/catch로 감싸 catch 블록에서 emit; state는 error로 설정 | `'failed'` |
| `forcePassVerify` | (없음 — phase_start 없음) | (phase_end emit 안 함 — 아래 주의 참고) | N/A |

**`forcePassVerify` / `forcePassGate`의 phase_end 누락:** force pass 경로는 `phase_start`를 emit하지 않으므로 `phase_end`도 emit하지 않는다. 대신 `force_pass` 이벤트만 남긴다. `phase_end.durationMs = Date.now() - phaseStartTs` 공통 규칙이 유효하려면 `phase_start`/`phase_end`가 쌍이어야 하기 때문. 분석기는 force pass된 phase의 duration을 0 또는 `phase_start → force_pass`의 인접 이벤트 간 시간으로 해석할 수 있다.

**v1 단순화: `'reopened'` status는 v1에서 emit하지 않는다.** Phase event enum에서 `'reopened'`를 제거하고, reopen 정보는 **다음 번 `phase_start.reopenFromGate: <gatePhase>`** 필드로만 추적한다. 이유:
- Gate reject/escalation이 이전 interactive 시도를 되돌릴 때, 이미 emit된 `phase_end { status: 'completed' }`는 authoritative로 남겨두고 (실제로 그 시도는 완료됨), 재개는 새 `phase_start`로 표기한다.
- 분석기는 `phase_start.reopenFromGate`를 단서로 이전 attempt가 gate에 의해 reopen되었음을 복원 가능.
- 이렇게 하면 `handleGateReject`와 `handleGateEscalation` choice `C` 경로 모두 별도의 retroactive phase_end emit 로직이 불필요.

**`runVerifyPhase` throw 처리:** `handleVerifyPhase`는 `runVerifyPhase(...)`를 `try/catch`로 감싸 throw가 발생하면:
1. `phase_end { phase: 6, status: 'failed', durationMs }` emit
2. state를 `error`로 설정 (기존 코드 로직 유지)
3. escalation 이벤트로 사용자 개입 유도 (기존 에러 처리 흐름과 동일)

**Gate timing (phase_start/phase_end 없음):**

| 이벤트 | emit 시점 | durationMs 출처 |
|---|---|---|
| `gate_verdict` | APPROVE/REJECT 판단 직후, `deleteGateSidecars` 이전 | `runGatePhase` 내부 타이밍 (`runCodexGate`/`runClaudeGate` 실행 시간) |
| `gate_error` | gate 실패 확정 직후 | 동일 |

**`phase_start.reopenFromGate` 사용법:** interactive phase(1/3/5)가 gate REJECT 또는 verify fail로 reopen될 때, 해당 phase_start에 `reopenFromGate: <triggerPhaseNumber>`를 포함한다. 예: phase 2 REJECT → phase 1 reopen → `phase_start { phase: 1, reopenFromGate: 2 }`. 또 phase 6(verify) fail → phase 5 reopen → `phase_start { phase: 5, reopenFromGate: 6 }`. (필드 이름은 역사적 이유로 `reopenFromGate`지만 verify trigger도 포함.)

**`handleInteractivePhase`의 `phase_end.attemptId`:** `src/phases/interactive.ts`의 `runInteractivePhase`가 반환하는 `phaseAttemptId`를 사용. 이 값은 `phase_start`에도 동일하게 포함.

### 5.9 config-cancel path

`src/commands/inner.ts`의 `onConfigCancel` 콜백은 현재 `process.exit(0)`을 직접 호출한다. 이 경우 `try/finally` 블록이 실행되지 않아 `session_end`가 emit되지 않는다.

**해결:** `onConfigCancel` 콜백은 `runPhaseLoop` 시작 전에도 호출될 수 있다 (promptModelConfig / runnerAwarePreflight 단계). 따라서 `session_start`/`session_resumed` 이벤트가 아직 emit되지 않았을 수 있다.

`onConfigCancel`은 **lazy bootstrap** 방식으로 처리한다. 기존 state mutation(status='paused', pauseReason, pendingAction, writeState) 은 **반드시 그대로 유지**하며, logger 정리는 그 이후에 수행한다:

```ts
onConfigCancel: () => {
  // 기존 state 변경 (현재 코드 그대로 유지)
  state.status = 'paused';
  state.pauseReason = 'config-cancel';
  state.pendingAction = { type: 'reopen_config', ... };
  writeState(runDir, state);

  // Logger lazy bootstrap (session_start/session_resumed 이벤트 미발생 시)
  // 주의: 현재 inner.ts 코드에서 task 캡처는 InputManager/onConfigCancel 등록 이전에 완료되므로
  //      이 시점에서 state.task는 이미 유효하다.
  // hasEmittedSessionOpen()으로 판단 (hasBootstrapped()는 meta.json on-disk 존재 여부이며,
  // resume 세션에서는 이미 true이므로 이벤트 emit 여부 판단에 사용 불가).
  if (!logger.hasEmittedSessionOpen()) {
    if (isResume) {
      logger.updateMeta({ pushResumedAt: Date.now() });
      logger.logEvent({ event: 'session_resumed', fromPhase: state.currentPhase, stateStatus: 'paused' });
    } else {
      logger.writeMeta({ task: state.task, ... });
      logger.logEvent({ event: 'session_start', task: state.task, autoMode: state.autoMode, ... });
    }
  }

  logger.logEvent({ event: 'session_end', status: 'paused', totalWallMs: Date.now() - logger.getStartedAt() });
  logger.finalizeSummary(state);
  logger.close();
  inputManager.stop();
  releaseLock(harnessDir, runId);
  process.exit(0);
}
```

**`resumedAt` 보장:** lazy bootstrap의 resume 분기에서 `writeMeta` 호출 시 `resumedAt: [Date.now()]`를 포함해 §5.2 및 §9의 resume 메타 계약을 만족시킨다.

`logger.hasEmittedSessionOpen()` 정의는 §3.1 참고 (in-memory 플래그: `session_start` 또는 `session_resumed` 이벤트 emit 시 true).

이 규칙에 따라 `session_start`/`session_resumed`는 반드시 `session_end` 이전에 emit됨이 보장된다 (resume + meta.json 선존재 상황에서도 이벤트는 별도 추적).

### 5.10 repoKey 계산

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
- summary 생성 시 `gate_verdict.recoveredFromSidecar === true`가 `(phase, retryIndex)` 중복이면 드롭
- summary 생성 시 `gate_error.recoveredFromSidecar === true`가 같은 `(phase)` 키에 authoritative gate_error가 존재하면 드롭. authoritative와 recovered가 함께 존재 시 authoritative 우선 사용

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
- `recoveredFromSidecar:true` emit 경로: `checkGateSidecars`가 non-null을 리턴하는 경우를 mock으로 시뮬레이션 → `gate_verdict.recoveredFromSidecar === true` 확인 + summary dedupe 확인

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
- **`gate_verdict.commentSeverities`** — P0/P1/P2/P3 comment counts 파싱. v2에서 `extractCommentSeverities(rawOutput)` 헬퍼와 함께 추가.

## 9. 수락 기준

- `harness start --enable-logging "task"` 실행 시 `~/.harness/sessions/<repoKey>/<runId>/{events.jsonl, summary.json, meta.json}` 생성
- `--enable-logging` 없이 start → `~/.harness/sessions/` 경로에 어떤 파일도 생성되지 않음
- Codex runner gate(기본 2/4/7)의 `gate_verdict` 이벤트에 `runner:'codex'` + `tokensTotal` 포함 (Codex stdout에 `tokens used` 라인이 있을 때)
- Claude runner gate의 `gate_verdict` 이벤트에 `runner:'claude'` 포함, `tokensTotal` 없음
- Resume 시 기존 `events.jsonl` 보존 + `session_resumed` 이벤트 1개 추가 + `meta.json.resumedAt[]`에 push
- `__inner`가 `--resume`으로 spawn된 경우 `session_resumed` emit, 아니면 (그리고 meta.json이 없는 경우) `session_start` emit
- Gate sidecar replay(`checkGateSidecars`가 non-null 리턴) 경로에서 emit되는 `gate_verdict`는 `recoveredFromSidecar: true`
- 서로 다른 repo의 동명 runId → 서로 다른 `<repoKey>` 디렉토리로 분리
- `session_end.status`는 `completed`/`paused`/`interrupted` 중 하나; `state.status`에서 결정론적으로 매핑
- Logger 내부 예외는 harness run을 abort시키지 않음 (fs mock throw 테스트로 보장)
- 기존 테스트 스위트 전체 통과
