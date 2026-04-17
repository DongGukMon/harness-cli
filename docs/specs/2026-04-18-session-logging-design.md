# Harness Session Logging — Design Spec

- 상태: draft
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
- Phase 2에서 retry가 몇 번 일어났는가? 그때 피드백은 어떤 것이었는가?
- 자동으로 다음 phase로 넘어가야 하는데 실제로는 어떤 이벤트가 튀었는가(버그 후보)?
- 에스컬레이션에서 사용자가 C/S/Q 중 어느 선택을 했는가?

이 모든 정보를 각 `harness run` 세션마다 구조화된 로그로 남겨, 후속 분석으로 harness CLI 자체를 개선할 단서를 얻는다.

로깅은 **opt-in**이며 `harness start <task> --enable-logging` 플래그로 활성화한다. 기본값은 off로, 기존 사용자 경험에 변화가 없다.

## 2. Context & Decisions

### 핵심 결정사항

- **Opt-in 전용**: `--enable-logging` 플래그가 있을 때만 활성화. state에 `loggingEnabled: boolean` 플래그로 영속화하여 resume에서도 자동 승계.
- **이벤트 스트림 + 세션 요약**: `events.jsonl`(append-only 이벤트 스트림) + `summary.json`(phase/세션 단위 집계)을 모두 생성. jsonl은 타임라인 재구성, summary는 빠른 조회용.
- **저장 위치**: `~/.harness/sessions/<runId>/`. 프로젝트별 `.harness/<runId>/` 와 분리. 자동 정리 없음; 향후 `harness logs prune` 같은 명시 명령으로 관리 (본 스펙 범위 외).
- **토큰 scope**: Codex gate의 `tokens used\n<총합>` stdout 라인만 파싱해 기록. Claude interactive phase(1/3/5)는 TTY 상속이라 실시간 측정 불가 → duration만 기록.
- **Content scope**: 메타데이터 + 파일 경로 참조만. spec/plan/feedback 본문은 복사하지 않는다 (git에서 조회 가능).
- **중앙 SessionLogger + 명시적 호출**: `runPhaseLoop`/runner/gate 핸들러에서 명시적으로 logger.logEvent를 호출. EventEmitter 같은 간접 패턴은 현재 규모에서 과설계.
- **비침투성 제1원칙**: logger 내부 실패는 상위로 전파되지 않는다. 로깅 실패가 harness run을 깨뜨리면 안 된다.
- **스키마 버전**: 모든 이벤트에 `v: 1` 필드. 이후 스키마 변경은 v 증가로 분석 도구 호환성 확보.
- **시도별(per-attempt) 타이밍**: phase 1/3/5는 gate reject로 여러 번 재실행될 수 있어 `phaseAttemptId`로 구분하여 집계. gate phase는 retry index로 구분.

### 제약 조건

- harness는 이미 작동하는 CLI이고 테스트 스위트가 있다 → 기존 호출부 시그니처 변경을 최소화하되, 변경이 필요한 곳(`createInitialState`, `runPhaseLoop`)은 모든 호출부/테스트를 함께 갱신한다.
- interactive phase는 stdin/stdout이 Claude TTY에 inherit되므로 runner 수준에서 stdout 가로채기 불가.
- gate sidecar(`gate-N-raw.txt`)는 APPROVE 후 삭제된다 → 토큰/세션ID는 삭제 **이전에** 이벤트로 인라인 저장.
- `~/.harness/` 생성 실패/디스크 full/권한 오류 가능 → best-effort, 첫 실패 이후 logger 비활성화 + stderr 1회 경고.

### 해소된 모호성

- **default on vs opt-in** → opt-in (`--enable-logging`). 사용자 선택.
- **token 분류(input/output/reasoning)** → Codex exec 모드는 `tokens used\n<총합>`만 노출 → `tokensTotal` 단일 숫자로 기록. 향후 Codex 출력이 확장되면 스키마 v2에서 세분화.
- **재분석 시 raw Codex output 필요성** → 현재는 메타데이터+경로만. 필요해지면 별도 스펙으로 `--log-codex-raw` 추가.
- **전체 transcript 저장** → 하지 않는다. runDir의 gate-N-raw.txt는 어차피 삭제되고, Claude 세션은 `~/.claude/projects/…`에 CLI가 따로 남긴다.

### 구현 시 주의사항

- `gate_verdict` 이벤트는 `deleteGateSidecars` 호출 **이전에** emit한다 (`src/phases/runner.ts`의 APPROVE 분기).
- `runCodexGate`는 기존 return 값에 `tokensTotal?: number`, `codexSessionId?: string` 필드를 추가한다. 기존 호출부(runner.ts gate handler)는 이 필드를 logger로 전달만 한다.
- `createInitialState` 시그니처 확장은 모든 테스트의 호출부 업데이트 필요.
- `NoopLogger`는 모든 메서드가 즉시 return. 로깅 off가 hot path에 영향을 주지 않도록 한다.
- 모든 logEvent 호출은 try/catch 내부에 있어야 한다; 호출자는 감싸지 않는다.

## 3. 구성요소

### 3.1 신규 파일

- **`src/logger.ts`**
  - `SessionLogger` 인터페이스 + `LogEvent` discriminated union 타입
  - `FileSessionLogger` 클래스 (JSONL append + summary rewrite)
  - `NoopLogger` 클래스 (모든 메서드 no-op)
  - `createSessionLogger(runId, loggingEnabled, options)` factory

### 3.2 수정 파일

| 파일 | 변경 내용 |
|---|---|
| `src/commands/start.ts` | `--enable-logging` 플래그 파싱; logger 생성; state에 `loggingEnabled` 저장; `runPhaseLoop`에 주입 |
| `src/commands/resume.ts` | `state.loggingEnabled`로 logger 재생성(append); `session_resumed` 이벤트; `runPhaseLoop`에 주입 |
| `src/types.ts` | `HarnessState`에 `loggingEnabled: boolean` 추가 |
| `src/state.ts` | `createInitialState` 시그니처 확장, `migrateState`에 `loggingEnabled: false` 기본값 |
| `src/phases/runner.ts` | `runPhaseLoop`/`handleInteractivePhase`/`handleGatePhase`/`handleGateReject`/`handleGateEscalation`/`handleGateError`/`handleVerifyPhase`/`handleVerifyFail`/`handleVerifyEscalation`/`handleVerifyError`/`forcePassGate`/`forcePassVerify`에 logger 인자 추가 및 이벤트 호출 |
| `src/runners/codex.ts` | `runCodexGate` return에 `tokensTotal?`, `codexSessionId?` 추가 (stdout 정규식 파싱) |
| `src/phases/verdict.ts` | 보조 함수 `extractCodexMetadata(stdout)` 추가 (tokensTotal + sessionId 추출) |
| `src/types.ts` | `GatePhaseResult.verdict`/`error` 둘 다에 `tokensTotal?: number`, `codexSessionId?: string`, `durationMs?: number` 추가 |

### 3.3 테스트

- `tests/logger.test.ts` (신규 unit)
- `tests/integration/logging.test.ts` (신규 integration — mocked runners)
- `tests/phases/runner.test.ts`, `tests/state.test.ts`, `tests/commands/*.test.ts` (시그니처 변경 반영)

## 4. 데이터 스키마

### 4.1 파일 레이아웃

```
~/.harness/sessions/<runId>/
├── meta.json         # { v, runId, task, startedAt, cwd, gitBranch, autoMode, harnessVersion, resumedAt[] }
├── events.jsonl      # 한 줄 = 한 이벤트 (append-only)
└── summary.json      # phase/세션 집계 (phase 종료마다 rewrite, 종료 시 최종)
```

### 4.2 이벤트 공통

```jsonc
{ "v": 1, "ts": 1713430000000, "runId": "2026-04-18-session-logging", "phase": 2, "attemptId": null, "event": "...", /* ... */ }
```

- `v`: 스키마 버전 (현재 1)
- `ts`: epoch ms
- `runId`: 현재 run ID
- `phase?`: 관련 phase 번호 (해당 시)
- `attemptId?`: interactive phase의 phaseAttemptId (gate는 null)

### 4.3 이벤트 목록 (v=1)

| event | 주요 payload |
|---|---|
| `session_start` | task, autoMode, baseCommit, harnessVersion |
| `session_resumed` | fromPhase, stateStatus |
| `phase_start` | phase, attemptId, reopenFromGate? |
| `runner_spawn` | phase, runner ("claude"\|"codex"), model, effort, promptBytes? |
| `runner_exit` | phase, runner, pid, exitCode, durationMs |
| `gate_verdict` | phase, attempt, verdict ("APPROVE"\|"REJECT"), tokensTotal?, promptBytes, codexSessionId?, commentSeverities?: {P0,P1,P2,P3} |
| `gate_error` | phase, error, exitCode?, durationMs |
| `gate_retry` | phase, retryCount, retryLimit |
| `escalation` | phase, reason ("gate-retry-limit"\|"gate-error"\|"verify-limit"\|"verify-error"), userChoice? ("C"\|"S"\|"Q"\|"R") |
| `force_pass` | phase, by ("auto"\|"user") |
| `verify_result` | passed, durationMs, failedChecks? |
| `phase_end` | phase, attemptId, status ("completed"\|"failed"\|"reopened"), durationMs |
| `state_anomaly` | kind, details |
| `session_end` | status, totalDurationMs |

### 4.4 summary.json

```jsonc
{
  "v": 1,
  "runId": "2026-04-18-...",
  "startedAt": 1713430000000,
  "endedAt": 1713439000000,
  "totalDurationMs": 9000000,
  "status": "completed",
  "autoMode": false,
  "phases": {
    "1": {
      "attempts": [
        { "attemptId": "uuid-1", "startedAt": ..., "durationMs": 300000, "status": "completed", "reopenedFromGate": null }
      ],
      "totalDurationMs": 300000
    },
    "2": {
      "attempts": [
        { "retryIndex": 0, "startedAt": ..., "durationMs": 30000, "verdict": "REJECT", "tokensTotal": 45000 },
        { "retryIndex": 1, "startedAt": ..., "durationMs": 28000, "verdict": "APPROVE", "tokensTotal": 42000 }
      ],
      "totalDurationMs": 58000,
      "totalTokens": 87000,
      "gateRetries": 1
    }
    /* ... phase 3~7 동일 구조 */
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
  "task": "…사용자가 입력한 task 원문…",
  "startedAt": 1713430000000,
  "cwd": "/path/to/repo",
  "gitBranch": "logging",
  "autoMode": false,
  "harnessVersion": "0.x.y",
  "resumedAt": [ 1713435000000 ]   // 각 resume 시 push
}
```

## 5. 통합 지점 상세

### 5.1 Logger 라이프사이클

```ts
// src/commands/start.ts (simplified)
const loggingEnabled = flags['enable-logging'] === true;
const logger = createSessionLogger(runId, loggingEnabled);
try {
  logger.logEvent({ event: 'session_start', task, autoMode, baseCommit, harnessVersion });
  const state = createInitialState(runId, task, baseCommit, autoMode, loggingEnabled);
  writeState(runDir, state);
  await runPhaseLoop(state, harnessDir, runDir, cwd, inputManager, logger);
  logger.logEvent({ event: 'session_end', status: state.status, totalDurationMs: Date.now() - startedAtMs });
} finally {
  logger.finalizeSummary(state);
  logger.close();
}
```

### 5.2 Resume

```ts
// src/commands/resume.ts (simplified)
const state = readState(runDir);
const logger = createSessionLogger(state.runId, state.loggingEnabled, { append: true });
logger.logEvent({ event: 'session_resumed', fromPhase: state.currentPhase, stateStatus: state.status });
await runPhaseLoop(state, harnessDir, runDir, cwd, inputManager, logger);
```

### 5.3 Gate verdict 추출 순서 (critical path)

`src/phases/runner.ts` → `handleGatePhase` → APPROVE 분기:

```ts
if (result.type === 'verdict' && result.verdict === 'APPROVE') {
  // 1) 이벤트 먼저 emit (sidecar에 접근하지 않음; tokensTotal은 result에 이미 포함)
  logger.logEvent({
    event: 'gate_verdict',
    phase, attempt: state.gateRetries[String(phase)] ?? 0,
    verdict: 'APPROVE',
    tokensTotal: result.tokensTotal,
    promptBytes: /* 이미 알고 있는 prompt 크기 */,
    codexSessionId: result.codexSessionId,
  });
  state.phases[String(phase)] = 'completed';
  deleteGateSidecars(runDir, phase);    // 2) 삭제는 그 다음
  // ...advance
}
```

REJECT 분기에서도 동일 순서로 `gate_verdict`(verdict=REJECT) + `gate_retry` 이벤트를 emit한 뒤 reopen 로직으로 진입.

### 5.4 토큰 추출

`src/phases/verdict.ts` 확장:

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

`runCodexGate` 내부에서 stdout 수집 이후 호출해 `GatePhaseResult`에 첨부.

### 5.5 State anomaly (v1 최소 감지)

다음 두 지점에만 명시적 anomaly 이벤트:

- `handleGatePhase` APPROVE 완료 직후: `state.pendingAction !== null` → `{ kind: 'pending_action_stale_after_approve', details: { phase, pendingActionType: state.pendingAction.type } }`
- `handleInteractivePhase` phase 5 completed 직후: `state.phaseReopenFlags['5'] === true` → `{ kind: 'phase_reopen_flag_stuck', details: { phase: 5 } }`

이 감지는 깊지 않고, 실제 원인 분석은 외부 스크립트가 이벤트 스트림을 순회하며 수행한다.

## 6. 에러 처리

### 6.1 I/O 실패

- `mkdirSync(~/.harness/sessions/<runId>, {recursive:true})` 실패 → logger는 즉시 비활성화 상태로 전환 + stderr 1줄 경고
- `appendFileSync` 실패 → 1회 stderr 경고, 이후 실패는 조용히 삼킨다 (과다 로깅 방지)
- `renameSync` (summary.json 원자 write) 실패 → 경고 후 다음 phase에서 다시 시도

### 6.2 시그널 / 비정상 종료

- JSONL은 append-only → 중간에 SIGKILL 받아도 마지막 쓴 줄까지 유효
- `summary.json`은 각 phase 종료마다 overwrite → 중단돼도 최신 phase까지 집계 유지
- `session_end` 이벤트가 없는 경우: 분석 도구는 마지막 이벤트의 ts를 endedAt proxy로 사용

### 6.3 Resume와 append

- `events.jsonl`을 truncate하지 않음 (append 모드)
- `meta.json`은 idempotent하게 업데이트: `resumedAt` 배열에 push

## 7. 테스트 계획

### 7.1 Unit (`tests/logger.test.ts`)

- `FileSessionLogger.logEvent`: 한 줄 append, `v` 필드 포함, ts 단조 증가
- `logEvent` fs.appendFileSync 실패 시 예외 전파 없음, stderr warn 1회
- `NoopLogger`: 모든 메서드 즉시 return, 디렉토리 미생성
- `finalizeSummary`: `summary.json.tmp` → rename, 파일 원자 교체
- append 모드 재오픈: 기존 이벤트 보존

### 7.2 Verdict helper (`tests/phases/verdict.test.ts`)

- `extractCodexMetadata`: `tokens used\n19,123` → 19123, `session id: abc…` → 문자열
- 두 라인 모두 부재 → 빈 객체
- 콤마 없는 숫자 / 대소문자 변형 허용

### 7.3 Integration (`tests/integration/logging.test.ts`)

- `harness start --enable-logging` → `~/.harness/sessions/<runId>/` 생성, `session_start` 이벤트 존재, `state.loggingEnabled === true`
- 플래그 없이 start → `~/.harness/sessions/<runId>/` 미생성
- resume → `session_resumed` 이벤트 1개 추가, 기존 줄 보존
- mocked runner로 gate APPROVE → `gate_verdict` 이벤트에 tokensTotal 포함
- gate REJECT → `gate_verdict`(REJECT) + `gate_retry` 이벤트 순서 확인
- anomaly 2종 감지 (pending_action stale / reopen_flag stuck)

### 7.4 회귀

- `--enable-logging` 없이 기존 테스트 수트 100% 통과 (NoopLogger)
- 시그니처 변경된 호출부 전부 업데이트

## 8. 범위 외 (YAGNI)

- `harness logs <runId>` / `harness logs list` / `harness logs prune` CLI
- 전체 Codex stdout / Claude transcript 저장
- 토큰 세분화 (input/output/reasoning)
- 실시간 tail UI
- 자동 retention/rotation
- 로그 업로드·텔레메트리

위 항목은 본 스펙 통과 후 별도 스펙에서 다룬다.

## 9. 수락 기준 (간략)

- `harness start --enable-logging "task"` 실행 시 `~/.harness/sessions/<runId>/{events.jsonl, summary.json, meta.json}` 생성
- 기본(`--enable-logging` 없음)에서는 `~/.harness/sessions/` 경로에 어떤 파일도 생성되지 않음
- Gate phase(2/4/7)의 `gate_verdict` 이벤트에 `tokensTotal`이 포함 (Codex stdout에 `tokens used` 라인이 있을 때)
- Resume 시 기존 `events.jsonl`이 보존되고 `session_resumed` 이벤트가 추가
- Logger 내부 예외는 harness run을 abort시키지 않음 (fs mock throw 테스트로 보장)
- 기존 테스트 스위트 전체 통과
