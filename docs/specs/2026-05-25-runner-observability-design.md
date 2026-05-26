# Runner Observability for Silent-Freeze Detection — Design Spec

> **Status: Partially superseded by [docs/specs/2026-05-26-timeout-removal-design.md](2026-05-26-timeout-removal-design.md)** — the `runner_heartbeat`, `runner_stalled`, and `phase_timeout_warning` events plus their underlying interactive-phase wall-clock timeout were removed. The tmux pane capture portion (#114 PR #3) and PR-runner stdio persistence (#114 PR #4) remain in effect.

- issue: [#114](https://github.com/DongGukMon/harness-cli/issues/114)
- related code: `src/types.ts` (LogEvent union), `src/phases/interactive.ts` (timeout + sentinel waiter), `src/runners/claude.ts` + `src/runners/codex.ts` (runner spawn), `src/phases/terminal-ui.ts` (auto-resume), `src/logger.ts` (events.jsonl writer)
- related design history: `docs/specs/2026-05-07-events-jsonl-15d4-design.md` (events.jsonl auto-retrospective — read-side; this spec is write-side)

## Complexity

Medium — 신규 이벤트 타입 3개 (`runner_heartbeat`, `runner_stalled`, `phase_timeout_warning`) + runner stdout/stderr persist 경로 추가 + autoMode 게이팅 점검. `LogEvent` 유니언 확장 (additive), 스키마 마이그레이션 불필요. 약 400-600 LoC + 테스트.

## Problem statement

P5 attempt 1이 30분 hard cap (`INTERACTIVE_TIMEOUT_MS = 1_800_000`)에 걸려 `phase_end status=failed durationMs=1801277 claudeTokens=null`로 종료된 사례 (issue #114). 그 30분 동안 `events.jsonl`에는 **단 한 줄의 진단 이벤트도 발행되지 않았다**:

- `runner_heartbeat` 없음 → 부모 worker가 살아있는지 죽었는지 외부 관측자(supervisor / 운영자)가 알 수 없음
- runner stdout/stderr가 디스크에 persist되지 않음 → post-mortem 시 freeze 원인 추적 불가 (tmux 스크롤백은 다음 attempt가 같은 pane을 reuse하면서 덮어씌움)
- `phase_timeout_warning` 없음 → cap에 가까워지는 시점에 supervisor가 선제 조치 불가
- `terminal_action action=resume`이 `autoMode=false`에서 self-fire한 정황 → 의도된 동작인지 버그인지 문서 불명

결과: 30분 동안 모든 외부 관측자가 "정상 long-running phase"로 분류 가능한 상황과 "완전 freeze된 phase" 상황이 **이벤트 라인 수준에서 구별되지 않는다**.

## Context & Decisions

### 1. `runner_heartbeat` 이벤트 — interactive 페이즈에만 발행

**결정**: 매 N=30초마다 `events.jsonl`에 발행. 페이로드는 phase 진행 액티브 시그널 (PID 생존 + workspace pane 출력 카운터 또는 토큰 카운터) 기반.

**스키마** (`src/types.ts` LogEvent 추가):
```ts
| (LogEventBase & {
    event: 'runner_heartbeat';
    phase: 1 | 3 | 5;
    attemptId: string;
    pid: number | null;
    pidAlive: boolean;
    // Optional progress signals; absent means "couldn't compute".
    // outputBytesSinceLastHeartbeat: bytes appended to runner.log since prior heartbeat
    // (only populated when stdout persistence is enabled — see decision 2).
    outputBytesSinceLastHeartbeat?: number;
    elapsedMs: number;  // ms since phase_start
  })
```

**Trigger 위치**: `src/phases/interactive.ts` 의 `waitForPhaseCompletion` 내부 setInterval (기존 sentinelPollInterval / pidPollInterval과 동일한 lifecycle. `settle()`에서 함께 clear).

**왜 30초인가**: 기존 pid poll이 1초, sentinel poll이 0.5초로 이미 빠르다. heartbeat의 목적은 long-running 신호이므로 30초가 적절한 신호/노이즈 비율. events.jsonl 부피 영향: 30분 phase 기준 60개 추가 라인 (~6 KB JSON Lines).

**왜 interactive에만**: gate는 6분 cap이고 batch 처리라 freeze 발생 시 timeout 자체가 빠르게 fire. interactive (P1/P3/P5)는 30분 cap + 사람-LLM mid-run interaction이라 freeze 진단 가치가 압도적으로 높다.

### 2. Runner stdout/stderr persist — 모든 페이즈

**결정**: runner stdout/stderr를 `<harnessDir>/<runId>/runner-phase<N>-<attemptId>.log`에 append 기록. session_end / phase_end 시점에 close.

**범위**:
- **Claude interactive** (`src/runners/claude.ts:runClaudeInteractive`): tmux pane으로 spawn하므로 stdio capture 불가. **stdout capture 대신 `tmux capture-pane`을 사용해 phase_end 시점 1회 buffer dump**. 라이브 streaming 아님 — phase 종료 시 사후 캡처. 이 buffer는 `<harnessDir>/<runId>/runner-phase<N>-<attemptId>.tmux-capture.log`로 저장.
- **Claude gate** (`runClaudeGate`): 이미 `stdoutChunks` / `stderrChunks`로 메모리 capture 중. close 핸들러에서 파일로 flush.
- **Codex interactive / gate** (`src/runners/codex.ts`): Claude interactive와 동일하게 tmux pane spawn. 같은 tmux-capture 정책 적용.

**Tmux capture 형식**: `tmux capture-pane -t <pane> -p -S -<lines>` 사용. 기본 `-S -3000` (3000줄). 3000줄은 30분 phase의 일반적인 출력량을 포괄.

**왜 라이브 streaming 아닌가**: 라이브 stream을 stdout capture로 갈아끼우려면 tmux 우회 경로 (예: PTY로 직접 spawn 후 fan-out)가 필요하고 이는 현 tmux 아키텍처 (`docs/specs/2026-04-14-tmux-rearchitecture-design.md`)를 광범위하게 수정해야 한다. **Post-mortem 가능성**이 본 spec의 1차 목표이므로 사후 1회 capture로 충분.

**파일 lifecycle**: 새 attempt이 동일 pane을 reuse하기 전에 capture 완료를 보장 (즉 `respawnPane` 호출 직전에 prior attempt의 log가 이미 디스크에 있어야 함). 이 순서는 `src/phases/runner.ts`의 phase orchestration 코드에서 강제한다.

**.gitignore**: `<harnessDir>` 전체가 이미 gitignore에 포함되어 있어 별도 추가 불필요.

### 3. `runner_stalled` 이벤트 — heartbeat 침묵 5분 임계

**결정**: heartbeat 발행 루프 내부에서 자체 침묵을 감지하는 게 아니라, **`outputBytesSinceLastHeartbeat === 0`이 연속 10회 (= 5분)** 감지되면 `runner_stalled` 발행.

**스키마**:
```ts
| (LogEventBase & {
    event: 'runner_stalled';
    phase: 1 | 3 | 5;
    attemptId: string;
    pid: number | null;
    pidAlive: boolean;
    silenceMs: number;     // 침묵 지속 시간
    elapsedMs: number;     // phase_start 이후 경과
  })
```

**Re-arming**: `runner_stalled` 발행 후에도 페이즈는 계속 진행. 다음 stall에 또 발행 (작은 지터: 침묵이 다시 5분 연속이면 재발행). 즉, 같은 phase 내 multiple `runner_stalled` 가능. spec 외 freeze 인지가 목적이므로 dedup 불필요.

**Supervisor 통합**: `phase-harness-supervisor` 스킬의 인터벤션 테이블에 `runner_stalled` 행 추가 (본 spec 외 follow-up). 현재 supervisor는 "PID 살아있고 토큰 진행 보임 = L1 normal"로 분류하지만 토큰 진행은 parent worker만 보고 subagent freeze에는 둔감. `runner_stalled`는 이 갭의 1차 신호.

### 4. `phase_timeout_warning` 이벤트 — cap의 80% 지점

**결정**: `INTERACTIVE_TIMEOUT_MS`의 80% (= 24분) 시점에 1회 발행.

**스키마**:
```ts
| (LogEventBase & {
    event: 'phase_timeout_warning';
    phase: 1 | 3 | 5;
    attemptId: string;
    elapsedMs: number;
    timeoutMs: number;      // 설정된 cap
    remainingMs: number;    // timeoutMs - elapsedMs
  })
```

**Trigger 위치**: heartbeat 루프에서 elapsed/timeout 비율을 매 tick에 확인, 80%를 넘어가는 첫 tick에 발행 후 별도 flag로 dedupe.

**왜 80%인가**: 50%는 너무 이르고 (정상 long-phase 노이즈), 95%는 너무 늦다 (운영자 개입 여유 < 90초). 80%는 supervisor가 L3 escalate하기에 적절한 5-6분 마진.

### 5. `terminal_action action=resume` auto-fire 동작 명확화

**문제**: 이슈 보고에서 `autoMode=false`인데도 `terminal_action action=resume`이 self-fire한 것으로 관측됨. 코드를 보면 (`src/phases/terminal-ui.ts:248-249`) `choice === 'R'` 분기에서만 발행되며, `choice`는 `inputManager.waitForKey()` 결과. 즉 명시적인 자동 발행 경로는 없다.

**가능성**: (a) `waitForKey`가 SIGUSR1 / pre-emptive buffer로 'R'을 합성해서 반환하는 경로가 있을 수 있고, (b) supervisor가 키를 inject한 것을 사용자가 봤을 수도 있다 (이 경우 보고가 부정확).

**결정**: 본 spec에서 동작 변경은 **하지 않는다**. 대신 `terminal_action` 이벤트에 `source: 'user-key' | 'auto' | 'signal'` 옵셔널 필드를 추가하여 origin을 명시적으로 기록한다. 향후 `autoMode` 게이팅 결정은 별도 PR/이슈로 분리.

**스키마 변경** (additive, 기존 라인과 호환):
```ts
| (LogEventBase & {
    event: 'terminal_action';
    action: 'resume' | 'jump' | 'quit';
    fromPhase: number;
    targetPhase?: number;
    source?: 'user-key' | 'auto' | 'signal';
    confirmedKill?: boolean;  // #116 B3에서 추가 예정 — 이 spec과 독립적이지만 함께 documented
  })
```

기존 retro analyzer (`docs/specs/2026-05-07-events-jsonl-15d4-design.md`)는 `source`/`confirmedKill` 부재를 허용해야 한다. 새 필드는 누락 시 `'user-key'`로 추정 (현 코드의 유일한 경로).

### 6. Subagent 에러 prompt 강화 — 본 spec 범위 밖

이슈 본문 5번 ("subagent 에러를 부모 runner의 prompt에 명시")은 prompt 엔지니어링 영역이며 본 spec의 events.jsonl 관측성 결정과 직교한다. 별도 spec/PR로 분리.

### 7. Schema versioning

`LogEvent` 유니언은 본 spec으로 3개의 신규 event 타입과 2개의 옵셔널 필드가 추가된다. 모두 **additive**이며 기존 reader가 무시 가능 (`switch`문에 default가 있거나 unknown 이벤트를 silent skip). `retrospective.ts` analyzer는 새 이벤트들을 무시하거나 (안전) 또는 별도 섹션을 추가할 수 있다 (개선 — 본 spec 외 follow-up).

`events.jsonl`은 schema 버전 필드를 갖지 않는다 (line-level union이므로). 새 reader는 unknown event를 skip하는 forward-compatible 패턴이어야 한다.

### 8. 성능 영향

- heartbeat 30초 주기 → 30분 phase 60개 추가 line × 평균 250 byte ≈ 15 KB events.jsonl 부피 증가
- tmux capture-pane → phase_end 1회 호출. 3000줄 dump ≈ 50-200 KB. 1 attempt당 1회.
- `runner_stalled` / `phase_timeout_warning` → 빈도 매우 낮음 (timeout 근처 / stall 시점만)

총 디스크 추가량은 정상 30분 phase 기준 ≤ 250 KB. 무시 가능.

CPU 영향: heartbeat 함수는 `isPidAlive(pid)` (probe-only, ESRCH 체크) + 파일 크기 stat 1회. 둘 다 마이크로초 단위. 30초 주기에서 무시 가능.

### 9. 테스트 전략

- **Unit**: `waitForPhaseCompletion` 에서 fake timer로 30초 / 5분 / 24분 시점 검증. heartbeat / stalled / timeout_warning이 정확한 시점에 발행되는지.
- **Integration**: tmux capture-pane을 mock한 채 phase_end 시 .log 파일이 생성되는지.
- **Regression**: 기존 retro analyzer가 새 이벤트 라인을 보고도 crash하지 않는지 (forward-compat).

## Goals

1. interactive phase 종료 후 `runner-phase<N>-<attemptId>.tmux-capture.log` 파일이 디스크에 존재한다.
2. 30분 phase 동안 events.jsonl에 30초 간격으로 `runner_heartbeat`이 누적된다.
3. 5분 연속 stdout 침묵 시 최소 1회 `runner_stalled`이 발행된다.
4. phase wall-clock 80% 시점에 `phase_timeout_warning`이 1회 발행된다.
5. `terminal_action.source` 필드가 모든 신규 발행에 채워진다 (기존 라인은 미설정 허용).
6. 기존 `retrospective.md` 자동 생성 / `phase-harness retro` 서브커맨드가 새 이벤트 라인이 섞여 있어도 정상 동작한다 (backward compat).

## Non-Goals

- runner stdout/stderr 라이브 streaming (현 tmux 아키텍처로 우회 불가, 사후 capture로 갈음).
- `runner_stalled` 발생 시 자동 escalation (signal-only, 동작은 사용자/supervisor 결정).
- `phase_timeout_warning` 자동 연장 / 사용자 prompt (별도 spec — 이슈 #116 B4).
- `terminal_action` auto-fire 동작 자체 변경 (`source` 라벨링만).
- subagent 에러 prompt 강화 (이슈 #114 5번; 별도 spec).
- events.jsonl schema 버전 필드 도입 (forward-compat additive로 처리).
- 기존 이벤트 타입의 필드 추가/변경 (위 6번 결정 외).

## Architecture

### 새 모듈 / 변경 모듈

| 파일 | 변경 종류 | 역할 |
|---|---|---|
| `src/types.ts` | additive | `LogEvent` 유니언에 `runner_heartbeat`, `runner_stalled`, `phase_timeout_warning` 추가. `terminal_action`에 `source?: ...` 옵셔널 추가. |
| `src/phases/interactive.ts` | additive | `waitForPhaseCompletion` 내 heartbeat / stall / warning 발행 setInterval. settle()에 clear 추가. |
| `src/phases/runner.ts` 또는 `src/runners/{claude,codex}.ts` | additive | phase_end 직전 tmux capture-pane 호출, `<harnessDir>/<runId>/runner-phase<N>-<attemptId>.tmux-capture.log` 작성. |
| `src/runners/claude.ts:runClaudeGate` | minor | stdoutChunks/stderrChunks 메모리 → 파일 flush 추가 (close 핸들러 내). |
| `src/runners/codex.ts` (gate 경로) | minor | 동일하게 stdio capture → 파일 flush. |
| `src/phases/terminal-ui.ts` | minor | `terminal_action` 발행 지점에 `source: 'user-key'` 명시 (기본값). |
| `src/phases/retrospective.ts` | optional / follow-up | 새 이벤트 라인을 표에 추가 (본 spec에서 미포함, 별도 PR). |

### 새 이벤트 흐름

```
phase_start
  ↓
waitForPhaseCompletion 시작
  ↓ 
heartbeat setInterval (30s)
  ├─ runner_heartbeat (매 tick)
  ├─ runner_stalled (10회 연속 0-output 시)
  └─ phase_timeout_warning (elapsed/timeout >= 0.8 첫 tick)
  ↓
sentinel detect or timeout
  ↓
settle() — heartbeat interval clear
  ↓
runner.ts: tmux capture-pane → runner-phase<N>-<attemptId>.tmux-capture.log
  ↓
phase_end
```

### Interface 변경 (요약)

```ts
// src/types.ts — additive
export type LogEvent =
  // ... existing variants ...
  | (LogEventBase & {
      event: 'runner_heartbeat';
      phase: 1 | 3 | 5;
      attemptId: string;
      pid: number | null;
      pidAlive: boolean;
      outputBytesSinceLastHeartbeat?: number;
      elapsedMs: number;
    })
  | (LogEventBase & {
      event: 'runner_stalled';
      phase: 1 | 3 | 5;
      attemptId: string;
      pid: number | null;
      pidAlive: boolean;
      silenceMs: number;
      elapsedMs: number;
    })
  | (LogEventBase & {
      event: 'phase_timeout_warning';
      phase: 1 | 3 | 5;
      attemptId: string;
      elapsedMs: number;
      timeoutMs: number;
      remainingMs: number;
    });

// terminal_action — source 옵셔널 추가 (additive)
event: 'terminal_action';
action: 'resume' | 'jump' | 'quit';
fromPhase: number;
targetPhase?: number;
source?: 'user-key' | 'auto' | 'signal';
confirmedKill?: boolean;  // #116 B3가 추가
```

## Open questions for implementation phase

1. `runner-phase<N>-<attemptId>.tmux-capture.log` 파일이 다음 attempt에서 reused pane으로 인해 사라질 수 있는가? `respawnPane` 호출 순서를 명시 검증 필요.
2. `outputBytesSinceLastHeartbeat`을 어떻게 계산할 것인가 — (a) tmux capture-pane을 매 heartbeat마다 호출하기엔 비용 부담, (b) Claude session JSONL 파일 (`~/.claude/projects/<encodedCwd>/<attemptId>.jsonl`) 크기 stat이 더 가볍다. **결정**: (b) 채택. attemptId가 있는 Claude interactive 페이즈에 한해 발행 가능. Codex / no-attemptId 케이스에서는 필드 생략.
3. 30분 phase가 정상 완료된 경우의 events.jsonl 라인 누적량 (60+ heartbeat) 이 retro analyzer 성능에 영향을 줄 가능성. 현재 retro는 단일 패스 line-stream 이므로 60줄 추가는 무시 가능 — 확인만.
4. `runner_stalled` 발행 후 phase가 결국 정상 완료된 경우 retrospective.md에 어떻게 표시할 것인가 — 본 spec 외, retrospective 후속 PR에서 결정.

## Implementation tracking

- [ ] PR 1: `LogEvent` 유니언 확장 + 테스트 (additive, no behavior change)
- [ ] PR 2: heartbeat / stalled / timeout_warning 발행 로직 (interactive.ts)
- [ ] PR 3: tmux capture-pane → .log 파일 (runner.ts orchestration)
- [ ] PR 4: gate stdout/stderr flush → .log 파일 (Claude + Codex gate)
- [ ] PR 5: `terminal_action.source` 라벨링
- [ ] PR 6 (optional, follow-up): retro analyzer가 새 이벤트를 표에 반영

각 PR은 본 spec의 결정 번호 (decisions 1-9)를 참조한다. PR 1이 base이고 나머지는 독립 병렬 가능.
