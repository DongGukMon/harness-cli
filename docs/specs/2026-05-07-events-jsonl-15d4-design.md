# Auto-Retrospective from events.jsonl — Design

- runId: `2026-05-07-events-jsonl-15d4`
- task: `.harness/2026-05-07-events-jsonl-15d4/task.md`
- decisions log: `.harness/2026-05-07-events-jsonl-15d4/decisions.md`
- related code: `src/logger.ts` (events.jsonl + summary.json schema), `src/commands/inner.ts` (run-loop finally), `src/types.ts` (LogEvent union)

## Context & Decisions

오늘 시점에 harness는 `--enable-logging` 활성 시 `~/.harness/sessions/<repoKey>/<runId>/events.jsonl`에 phase/gate/verify/escalation 이벤트를 누적 기록하고, 같은 디렉토리에 `summary.json`을 finalize한다. 그러나 사용자가 "이번 런이 어디서 비용/시간을 썼는지", "어느 gate가 stagnation까지 갔는지", "ambiguity 점수가 어떻게 움직였는지"를 보려면 이벤트 라인을 직접 grep하거나 summary.json을 수동으로 해석해야 한다.

이 작업은 events.jsonl을 deterministic하게 분석해 사람이 읽는 retrospective 마크다운을 자동/오프라인 양쪽으로 생성하는 read-side analyzer를 추가한다. 다음 결정을 spec 단계에서 확정한다:

- **Trigger**: `inner.ts` 런 루프 `finally` 블록에서 `logger.finalizeSummary(state)` 직후 1회 호출. session_end 상태(completed/failed/paused/interrupted)와 무관하게 항상 시도. 단, `logger.getEventsPath()`가 `null`(NoopLogger, `--enable-logging` off)이면 no-op.
- **Output path**: `<harnessDir>/<runId>/retrospective.md` (`<harnessDir>` = `findHarnessRoot()` 결과 = 일반적으로 `<repoRoot>/.harness/`). `.harness/`는 repo `.gitignore`에 이미 등록되어 있어 별도 ignore 추가 불필요. 매 호출마다 덮어쓰기 (atomic temp + rename).
- **Source path**: `~/.harness/sessions/<repoKey>/<runId>/events.jsonl`. `repoKey`는 `computeRepoKey(harnessDir)` (logger.ts와 동일).
- **Token columns**: phase별 Claude 토큰과 Codex(gate) 토큰을 같은 행에 별도 컬럼으로 표시. 합산하지 않음. spike 탐지는 Claude 토큰 기준.
- **Spike heuristic**: phase별 `claudeTokens.total` 합을 정렬한 top-3 표 + max ≥ 2 × median(전체 claude phase) 일 때만 "Token spike detected" 라인을 추가.
- **Resume aggregation**: events.jsonl 전체를 단일 timeline으로 처리. 여러 session_start/session_end 쌍이 존재해도 phase별 attempt를 합산. 헤더의 wall time은 첫 `session_start.ts`부터 마지막 `session_end.ts`(또는 마지막 이벤트 ts)까지의 차이.
- **Fail-open vs fail-loud**: 자동 호출은 fail-open (단일 stderr warn, 런 실패 금지). `phase-harness retro <runId>` 서브커맨드는 fail-loud (exit 1 + stderr).
- **Determinism**: 동일 events.jsonl 입력 → 바이트 동일 markdown. body 내부에 wall-clock(`Date.now()`) 사용 금지. footer의 "generated-at"은 events.jsonl의 마지막 이벤트 `ts`에서 파생.
- **Schema 비변경**: 본 작업은 read-side analyzer만 추가한다. `LogEvent` 유니언, summary.json 포맷, 기존 이벤트 필드 추가/수정 금지.
- **Dependencies**: Node stdlib만 사용 (`fs`, `path`, `crypto` 이미 사용 중). 신규 npm 의존성 금지.

## Complexity

Medium — 신규 파일 2개(analyzer + subcommand) + inner.ts 1줄 wire-in + 테스트. 약 400~600 LoC. 기존 코드 변경 범위 최소.

## Goals

- `.harness/<runId>/retrospective.md`가 `--enable-logging` 런 종료 시 자동 생성된다.
- `phase-harness retro <runId>`로 같은 마크다운을 오프라인에서 재생성할 수 있다.
- 마크다운에는 phase 요약 표, 토큰 spike 표시, gate 활동(retry/REJECT/ambiguity 추이/stagnation/force_pass), escalation 이력, verify 결과, 총 wall time + 총 토큰이 포함된다.
- analyzer는 deterministic — 같은 events.jsonl이면 같은 출력.
- 자동 호출 실패가 런 자체를 실패시키지 않는다.

## Non-Goals

- LLM 기반 요약/분석 (deterministic 만).
- events.jsonl 스키마 변경, 신규 이벤트 추가, summary.json 포맷 변경.
- 마크다운 외 출력 포맷 (HTML, JSON, CSV).
- 신규 npm 의존성 도입.
- retrospective.md를 git에 commit (사용자 검토용; 자동 commit 금지).
- 멀티 런 비교/대시보드. 본 작업은 단일 런 단위.

## Architecture

### Modules

| 파일 | 역할 |
|---|---|
| `src/phases/retrospective.ts` | 순수 analyzer. events.jsonl 경로 → `{ markdown, stats }`. 파일 쓰기 없음. |
| `src/commands/retro.ts` | `phase-harness retro <runId>` 서브커맨드. runId 해석 + analyzer 호출 + 파일 쓰기. |
| `src/commands/inner.ts` | 기존 run-loop `finally` 블록에 retro 자동 호출 1줄 추가. |
| `src/bin/harness.ts` | `retro` 서브커맨드 등록 (CLI dispatcher 1줄). |

### Analyzer interface (`src/phases/retrospective.ts`)

```ts
export interface RetrospectiveStats {
  runId: string;
  harnessVersion: string | null;
  status: 'completed' | 'paused' | 'interrupted' | 'unknown';
  autoMode: boolean;
  startedAt: number;
  endedAt: number;
  totalWallMs: number;
  eventCount: number;
  malformedLineCount: number;
  phases: Array<{
    phase: number;
    attempts: number;
    durationMs: number;
    claudeTokens: number;       // sum across attempts of phase_end.claudeTokens.total
    codexTokens: number;        // sum of gate_verdict.tokensTotal + gate_error.tokensTotal for this phase
    finalStatus: 'completed' | 'failed' | 'unknown';
  }>;
  gates: Array<{
    phase: number;              // 2 | 4 | 7
    retryCount: number;
    rejectCount: number;
    codexTokens: number;
    ambiguityTrend: number[];   // gate_verdict.ambiguity values in order (phase 2 only; else [])
    stagnationTriggered: boolean;
    forcePass: { triggered: boolean; by?: 'auto' | 'user' };
  }>;
  escalations: Array<{ phase: number; reason: string; userChoice?: 'C' | 'S' | 'Q' | 'R' }>;
  verify: { passCount: number; failCount: number; lastFailedChecks: string[] };
  spike: { topPhases: Array<{ phase: number; tokens: number }>; flagged: boolean; ratio: number };
  totals: { claudeTokens: number; codexTokens: number };
}

export function generateRetrospective(eventsPath: string): { markdown: string; stats: RetrospectiveStats };
```

- 입력은 events.jsonl 절대 경로. 파일이 없거나 비어 있으면 명시적 에러를 throw (caller가 fail-open / fail-loud 결정).
- 파싱은 line-by-line `JSON.parse` (with try/catch per line). 파싱 실패 라인은 카운트만 올리고 skip.
- phase 매핑은 `String((e as any).phase ?? '')` 키 사용 (logger.ts의 summary 빌더와 동일 컨벤션).
- gate 집계는 `recoveredFromSidecar`가 true이면서 동일 `(phase, retryIndex)` 조합이 이미 authoritative event로 등장한 경우 중복 제거 (logger.ts와 동일 규칙). 단순 보존: 본 analyzer 안에서만 dedupe, 외부 의존성 없음.
- ambiguity trend는 phase 2의 `gate_verdict.ambiguity` 값(undefined가 아닌 것만) 시간순 배열. 다른 phase는 항상 빈 배열.
- spike:
  - `topPhases` = phases.claudeTokens 내림차순 top-3 (값이 0이면 entry 생략).
  - `median` = phases.claudeTokens 중 0이 아닌 값들의 중앙값. 값이 0개면 `flagged=false`.
  - `ratio = max / median` (median > 0인 경우에만). `flagged = ratio >= 2`.

### Markdown layout

Section 순서 (모두 deterministic, 빈 섹션도 placeholder 라인으로 출력):

1. `# Retrospective — <runId>`
2. **Header table** — version, status, autoMode, started, ended, total wall (humanize: `Hh Mm Ss`), event count, malformed-line count.
3. **`## Phase Summary`** — 컬럼 `Phase | Attempts | Duration | Claude tokens | Codex (gate) tokens | Final status`. phase 번호 오름차순. duration 0인 phase는 행을 출력하지 않음 (해당 flow에서 skip된 phase).
4. **`## Token Spike`** — top-3 ranking 표 + `> Token spike detected: phase N is X.Y× median` 라인 (flagged=true일 때만). 아니면 `_No notable spike._`.
5. **`## Gate Activity`** — phase 2/4/7 각각 sub-section:
   - `### Phase N gate`
   - `Retries: X | REJECTs: Y | Codex tokens: Z`
   - `Ambiguity trend: a → b → c` (phase 2이고 trend 비어있지 않을 때만)
   - `Stagnation: triggered` / `Stagnation: not triggered`
   - `Force pass: by auto` / `by user` / `not triggered`
   - 해당 phase에 gate 이벤트가 0개면 sub-section 자체를 생략.
6. **`## Escalations`** — 목록. 비어있으면 `_None._`.
7. **`## Verify`** — `Passes: X | Failures: Y`. 마지막 실패 시 `Last failed checks:` bullet 리스트. verify_result 이벤트가 0개면 `_No verify activity._`.
8. **`## Totals`** — 총 Claude tokens, 총 Codex tokens, 총 wall time.
9. **Footer** — `_Generated from <eventsPath> · <eventCount> events · ended at <ISO timestamp from last event ts>_`.

빈 phase/section은 위 규칙대로 처리되어 본문에 `Date.now()`/random 가 들어가지 않는다 → byte-determinism 유지.

### Subcommand (`src/commands/retro.ts`)

```
phase-harness retro <runId> [--root <dir>] [--stdout]
```

- runId 필수. `findHarnessRoot(--root, cwd)`로 harnessDir 해석 → `computeRepoKey` → `~/.harness/sessions/<repoKey>/<runId>/events.jsonl` 경로 산출.
- events.jsonl 부재/빈 파일 → exit 1, stderr `[retro] events.jsonl not found at <path>`.
- 정상 시 `<harnessDir>/<runId>/retrospective.md`에 atomic write (temp + rename). `<harnessDir>/<runId>/`가 없으면 `mkdir -p`.
- `--stdout` 플래그가 있으면 파일 쓰기 대신 markdown을 stdout으로 출력하고 exit 0.
- `--root`는 기존 `start`/`resume`와 동일한 의미.

### Auto-emit hook (`src/commands/inner.ts`)

`finally` 블록 내, `logger.finalizeSummary(state)` 직후, `logger.close()` 이전에:

```ts
const eventsPath = logger.getEventsPath();
if (eventsPath) {
  try {
    const { generateRetrospective } = await import('../phases/retrospective.js');
    const { markdown } = generateRetrospective(eventsPath);
    const outDir = join(harnessDir, runId);
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, 'retrospective.md');
    const tmp = outPath + '.tmp';
    fs.writeFileSync(tmp, markdown);
    fs.renameSync(tmp, outPath);
  } catch (err) {
    process.stderr.write(`[retro] failed to generate retrospective: ${(err as Error).message}\n`);
  }
}
```

- 단일 try/catch로 fail-open. warn은 한 번만 (auto-emit는 한 번만 호출되므로 warnOnce 불필요).
- import는 dynamic — retro 모듈이 보장되지 않은 환경(테스트 등)에서도 trigger 자체가 실패하지 않도록.
- NoopLogger는 `getEventsPath()`가 `null`을 반환하므로 자동 skip.

### CLI registration

`src/bin/harness.ts`(또는 명령어 dispatcher가 있는 entry)에 `retro` 케이스 추가. `start`/`resume`/`list` 등 기존 서브커맨드와 같은 방식.

## Data flow

```
events.jsonl (line-stream)
   │
   │  parse + skip malformed (count)
   ▼
LogEvent[]
   │
   │  group by phase (string key)
   │  collect gate events per phase
   │  collect escalations / verify_result / force_pass
   │
   ▼
RetrospectiveStats
   │
   │  render to markdown (section-by-section, deterministic)
   ▼
markdown string
   │
   ├── auto-emit: write <harnessDir>/<runId>/retrospective.md
   └── retro subcommand: write file or print to stdout
```

## Error handling

| 시나리오 | 자동 호출 | retro 서브커맨드 |
|---|---|---|
| events.jsonl 없음 | warn `[retro] events.jsonl not found at <path>` (NoopLogger 분기 제외 시) | exit 1, stderr 메시지 |
| events.jsonl 빈 파일 | warn `[retro] events.jsonl is empty` | exit 1 |
| events.jsonl 파싱 실패 라인 다수 | warn 없음 (analyzer 내부에서 카운트만, footer에 표시) | 동일 |
| 출력 디렉토리 mkdir 실패 | warn `[retro] failed to generate retrospective: <msg>` | exit 1 |
| 파일 rename 실패 | warn 동일 | exit 1 |
| analyzer 내부 throw | warn 동일 | exit 1 |
| `--enable-logging` off | NoopLogger.getEventsPath() === null → 자동 skip (warn 없음) | 해당 없음 (사용자 명시 호출) |

## Testing

`test/phases/retrospective.test.ts` (vitest):

- **fixture-completed**: P1→…→P7 정상 종료, 모든 phase에 phase_end 1회씩, gate 2/4/7 APPROVE 1회씩 → 각 phase 행 출력, gate sub-section 출력, spike 미발생, force_pass 없음.
- **fixture-failed**: P5에서 phase_end status='failed' → Phase Summary 마지막 행 finalStatus='failed', 이후 phase는 행 없음, escalation 이벤트 1개 → Escalations 섹션 1줄.
- **fixture-resumed**: session_start/session_end 두 쌍 → phases attempt 합산, 헤더 wall time = 첫 start ~ 마지막 end.
- **fixture-stagnation**: phase 4 gate에 retry 3회 + gate_stagnation action='escalate' + force_pass by='auto' → Phase 4 gate sub-section에 모두 표시.
- **fixture-ambiguity**: phase 2 gate_verdict 3건에 ambiguity 0.8 → 0.6 → 0.4 → trend 라인 정확히 출력.
- **fixture-spike**: phase 5 claude tokens가 다른 phase median의 3배 → flagged + ratio 3.0 출력.
- **fixture-malformed**: events.jsonl에 깨진 라인 2개 포함 → footer에 `2 malformed lines skipped` 표시, analyzer 정상 종료.
- **determinism**: 같은 fixture를 두 번 호출 → 결과 markdown 문자열 strict equal.

`test/commands/retro.test.ts`:

- runId 미존재 → exit 1.
- events.jsonl 부재 → exit 1, stderr 메시지 매칭.
- 정상 호출 → `<harnessDir>/<runId>/retrospective.md` 존재 + 0이 아닌 byte.
- `--stdout` → 파일 미생성, stdout에 markdown.

자동 호출 통합 테스트는 inner.ts 전체를 띄우지 않고 hook 단위로만 (mocked logger.getEventsPath()) 검증.

## Success Criteria

- `--enable-logging` 옵션으로 실행한 모든 런이 종료된 직후 `<harnessDir>/<runId>/retrospective.md` 파일이 생성된다 (events.jsonl 존재 시).
- 같은 events.jsonl로 `phase-harness retro <runId>`를 두 번 호출하면 byte-identical markdown이 생성된다.
- retro 생성 실패가 발생해도 run의 exit code는 0(성공) 또는 본래의 fail 코드를 유지하며, retro 실패로 인해 변하지 않는다.
- 마크다운에 다음 섹션이 모두 포함된다: header, Phase Summary, Token Spike, Gate Activity (해당 gate phase에 이벤트 있을 시), Escalations, Verify, Totals, footer.
- 신규 npm 의존성 0개. `package.json` dependencies 필드 변경 없음.
- 기존 `LogEvent` 유니언, summary.json 포맷, 기존 이벤트 필드의 schema 변경 0건.

## Invariants

- analyzer 모듈은 fs write를 호출하지 않는다 (read 전용). 모든 파일 쓰기는 caller(자동 hook 또는 retro subcommand)에서만 일어난다.
- analyzer 출력의 markdown body 안에 `Date.now()` / `Math.random()` / `process.hrtime()` / process env 기반 가변값이 직접 노출되지 않는다. 모든 시간 값은 events.jsonl의 ts에서 파생.
- retro 자동 호출은 throw하지 않는다. 모든 에러 경로가 단일 try/catch 안에 위치한다.
- retrospective.md는 `<harnessDir>/<runId>/` 아래에만 생성된다. 다른 경로(repo root, tmp 등)에 부수 효과 없음.
- 신규 의존성 import는 Node stdlib (`fs`, `path`, `crypto`, `os`)만 허용. 외부 npm 패키지 import 금지.
- `LogEvent` 유니언, `SessionMeta`, `summary.json` 스키마는 본 작업으로 변경되지 않는다.
- `.gitignore`에 `.harness/`가 이미 포함되어 있어 retrospective.md가 의도치 않게 커밋되지 않는다 (.gitignore는 본 작업으로 변경하지 않음).
- `--enable-logging` off (NoopLogger) 상태에서는 자동 hook이 어떤 stderr 출력도 만들지 않는다.

## Out-of-scope (next iterations)

- 멀티 런 비교 보드, HTML/JSON 출력.
- retrospective.md 자동 commit / PR 첨부.
- LLM 기반 narrative summary.
- gate ambiguity 외 추가 정량 지표(예: clarityScores 세부 분해).
