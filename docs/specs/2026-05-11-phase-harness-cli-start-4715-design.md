# `--no-drift` start flag — design

Phase-harness `start` / `run` 명령에 `--no-drift` 플래그를 추가해 P5 → P6 drift 검출을 명시적으로 비활성화한다. `HARNESS_PHASE_DRIFT_THRESHOLD=off` env와 동등한 효과지만 한 번만 끌 때 더 짧고, run 생성 시점에 정책으로 박혀서 resume 사이에 표류하지 않는다.

Related artifacts:
- Task spec: `.harness/2026-05-11-phase-harness-cli-start-4715/task.md`
- Decisions log: `.harness/2026-05-11-phase-harness-cli-start-4715/decisions.md`
- Drift module spec (existing): `docs/specs/2026-05-11-p5-spec-plan-drift-p5-p6-4a02-design.md`

## Context & Decisions

이 design은 phase-1 brainstorming 세션에서 다음 결정과 함께 확정됐다. 각 결정의 *대안과 trade-off*는 decisions log에 별도로 기록한다(중복 금지).

- **D1 — Persistence model: 새 state field `noDrift: boolean`.** `state.codexNoIsolate`와 동일한 패턴을 따른다. 상태가 run 생성 시 한 번 박히고 resume에서 변하지 않는다.
- **D2 — Priority: `--no-drift` > `HARNESS_PHASE_DRIFT_THRESHOLD`.** state.noDrift가 true이면 env는 읽지 않는다. 사용자가 직접 답한 대화 결과("CLI > env"). 충돌은 에러로 만들지 않고 silent override.
- **D3 — Resume scope: frozen at start, like `--light`.** `phase-harness resume --no-drift`는 거부 후 exit non-zero. drift policy는 run 단위 immutable.
- **D4 — Signature 변경 위치: `loadDriftThreshold(autoMode, noDrift)`.** state 자체를 인자로 받지 않고 boolean 두 개. 기존 unit test 시그니처 변경 폭이 작다. caller(`scoreP5Drift`)만 state.noDrift를 풀어서 전달.
- **D5 — Resume reject message style: `--light`와 같은 형식.** `Error: --no-drift is only valid on 'phase-harness start' / 'phase-harness run'. Drift policy is frozen at run creation; start a new run with --no-drift if you want to skip drift.`

## Complexity

Small — 단일 boolean 한 줄짜리 정책 추가. 7개 파일 모두 well-localized 변경(plumbing 1줄 + 1 분기). 새 모듈/추상화/이벤트 없음.

## Goals

- `phase-harness start --no-drift "<task>"` 와 `phase-harness run --no-drift "<task>"` 가 P5 → P6 drift 검출을 비활성화하는 run을 만든다.
- 현재 env 기반 비활성화 (`HARNESS_PHASE_DRIFT_THRESHOLD=off` 또는 manual mode + env 미설정) 동작은 정확히 그대로 유지한다.
- `--no-drift`로 시작된 run은 resume 후에도 drift 정책이 유지된다 (state 기반).
- `--no-drift`가 set이면 numeric env (`HARNESS_PHASE_DRIFT_THRESHOLD=0.3` 등)와 무관하게 drift detection이 꺼진다.
- 추가 의존성 없음. 기존 fixture-driven 테스트 패턴 그대로 활용.

## Non-goals

- mid-run으로 drift를 toggle하는 UI/명령 (resume에서 거부).
- run 생성 후 state.noDrift를 다시 켜거나 끄는 경로.
- `--drift` counter-flag (이미 default가 env 기반이고, `--no-drift` 미지정으로 충분).
- numeric env와 충돌 시 fail-fast (silent override 채택).
- status / list / retro 출력에 drift policy 표시 (events.jsonl + state.json만으로 충분).
- `phase_drift` 이벤트 스키마 변경 (drift OFF면 event 자체가 발행되지 않는 기존 contract 유지).

## CLI surface

`bin/harness.ts`:

- `start [task]`: `--no-drift` 옵션 추가. description: `"skip P5 → P6 drift detection for this run (equivalent to HARNESS_PHASE_DRIFT_THRESHOLD=off, but persisted per-run)"`. Boolean flag (commander default semantics).
- `run [task]`: 동일 옵션 추가 (start의 alias). `start`와 동일 description, 동일 동작.
- `resume [runId]`: `--no-drift` 옵션 추가. action 함수 진입 즉시 거부. Description은 `"(rejected — drift policy is frozen at run creation)"` 정도로 표시(`--light`의 resume 거부 description 패턴과 동일).

`StartOptions` 인터페이스 (`src/commands/start.ts`):

- 추가: `noDrift?: boolean`.

`ResumeOptions` 인터페이스 (`src/commands/resume.ts`):

- 추가: `noDrift?: boolean`. resume action에서 일찍 reject용으로만 참조.

## Type / state changes

`src/types.ts` — `HarnessState`에 추가:

```ts
// CLI: --no-drift on start/run. When true, P5 → P6 drift detection is
// disabled regardless of HARNESS_PHASE_DRIFT_THRESHOLD env. Frozen at
// run creation; resume rejects --no-drift to enforce immutability.
noDrift: boolean;
```

`codexNoIsolate`와 동일하게 **non-optional + migration default false**로 처리한다. (codexNoIsolate처럼 declared optional이 아니라 required로 두되, 마이그레이션이 보장하는 패턴.)

`src/state.ts` 변경:

- `createInitialState(...)` 시그니처 끝에 `noDrift: boolean = false` 추가. `codexNoIsolate` 다음 위치(positional 마지막).
- 반환 객체에 `noDrift` 필드 포함.
- `migrateState`에 한 줄: `if (raw.noDrift === undefined) raw.noDrift = false;` (기존 `codexNoIsolate` 마이그레이션 바로 옆에 배치).

`src/commands/start.ts`:

- `startCommand`에서 `createInitialState(... options.codexNoIsolate ?? false, options.noDrift ?? false)` 형태로 새 인자 전달.

`bin/harness.ts`:

- `start` / `run` action 함수의 opts 타입에 `noDrift?: boolean` 포함.
- `startCommand(task, { ..., noDrift: opts.noDrift, ... })` 로 전달.

## Priority rules

`state.noDrift === true` 일 때:

1. `loadDriftThreshold(autoMode, noDrift=true)` 는 **즉시 `null` 반환**. env 변수 (`HARNESS_PHASE_DRIFT_THRESHOLD`)는 읽지 않는다.
2. `scoreP5Drift` 는 `{ activated: false }` 반환.
3. `runner.ts`의 phase-5 후처리 분기는 `if (driftResult.activated)` 가드로 인해 `phase_drift` 이벤트를 발행하지 않고 success path로 떨어진다.

`state.noDrift === false` (default) 일 때:

1. 기존 env-only 동작 그대로. autoMode + env 미설정 → 0.3, manual + env 미설정 → null, `off` → null, numeric → parsed.

## Resume semantics

- `phase-harness resume --no-drift` 또는 `phase-harness resume <runId> --no-drift`:
  - `resumeCommand` 진입 즉시 옵션 검사. `--light` 거부 분기와 동일한 위치/스타일.
  - stderr로 거부 메시지 출력 후 `process.exit(1)`. **state.json은 읽지도 쓰지도 않는다.**
- `phase-harness resume` (플래그 없음): 기존 흐름 그대로. state.json에 박힌 `noDrift`가 그대로 적용된다.
- 마이그레이션: 이전 PR로 만든 run이 resume될 때 `migrateState`가 `noDrift: false`로 채운다 → 기존 env 동작 유지.

## Drift signature change

`src/phases/drift.ts`:

```ts
// Before
export function loadDriftThreshold(autoMode: boolean): number | null

// After
export function loadDriftThreshold(autoMode: boolean, noDrift: boolean = false): number | null
```

본문 첫 줄에 short-circuit 추가:

```ts
if (noDrift) return null;
```

이 분기는 env 읽기보다 먼저 위치한다. `noDrift=true`일 때는 env 검증 / `warnOnce` 경로가 실행되지 않는다 (사용자가 명시적으로 끈 정책에 invalid env 경고를 띄울 이유 없음).

`scoreP5Drift` (같은 파일):

```ts
// Before
const threshold = loadDriftThreshold(input.state.autoMode === true);
// After
const threshold = loadDriftThreshold(
  input.state.autoMode === true,
  input.state.noDrift === true,
);
```

`runner.ts`는 변경 없음 (`scoreP5Drift`의 `{ activated: false }` 계약을 통해 자동 전파).

## Logging / events.jsonl

- `phase_drift` 이벤트는 `state.noDrift === true`일 때 **발행되지 않는다.** (현 contract 유지.)
- `state.noDrift` 자체는 `state.json`에만 기록된다. retro / session_start 이벤트에 추가 필드를 넣지 않는다 (YAGNI; state.json이 source of truth).
- 본 task의 sub-목적인 "최근 머지된 4개 feature(#96/#97/#99/#100) + wedge fix(#101) 신호가 events.jsonl에 정상적으로 쌓이는지 확인" 은 별도 산출물이 아니라 통합 dogfood의 자연스러운 부산물로 검증된다 — 신규 검증 항목 추가 없음.

## Backward compatibility & migration

- `state.json` schema migration: `migrateState`가 `noDrift === undefined`이면 `false`로 채움. 기존 run의 resume 동작 변하지 않음.
- env-only 사용자: `--no-drift` 미지정 시 모든 기존 env 분기 (off / numeric / autoMode default 0.3 / manual default null / invalid → null) 그대로 유지.
- runner / preset / artifact path / sentinel rule 변경 없음.

## Testing

기존 `tests/unit/phases/drift.test.ts` 등의 fixture 패턴을 그대로 활용한다. 새 실 케이스:

**Unit — `loadDriftThreshold(autoMode, noDrift)`** (`tests/unit/phases/drift.test.ts`):

- `noDrift=true, env=unset, autoMode=true` → `null`.
- `noDrift=true, env=unset, autoMode=false` → `null`.
- `noDrift=true, env="0.3", autoMode=true` → `null` (CLI > env 검증).
- `noDrift=true, env="0.5", autoMode=false` → `null`.
- `noDrift=true, env="invalid"` → `null`이고 `warnOnce`가 호출되지 **않는다** (env가 아예 읽히지 않아야 한다).
- 기존 `noDrift=false`(default) regression: 기존 모든 env 분기가 그대로 동작.

**Unit — state migration** (`tests/unit/state.test.ts`):

- `noDrift` 필드가 없는 raw state → `migrateState` 후 `noDrift === false`.
- `noDrift: true`가 박힌 raw state → `migrateState` 후 그대로 유지.

**Unit — `createInitialState`**:

- 새 인자 default false 동작 검증.
- `noDrift=true`로 호출하면 반환 state에 그대로 포함.

**Integration (fixture-driven, `HARNESS_DRIFT_CODEX_FIXTURE` 사용 가능)**:

- `phase-harness start --no-drift "<task>"` 는 state.json에 `noDrift: true`를 기록한다.
- `phase-harness start --no-drift` 로 만든 run에서 `HARNESS_PHASE_DRIFT_THRESHOLD=0.3`을 export하고 phase-5를 통과시켜도 `events.jsonl`에 `phase_drift` 이벤트가 0건이다.
- `phase-harness start "<task>"` (플래그 없음) 는 state.json에 `noDrift: false`를 기록한다 (default).

**Integration — resume reject**:

- 기존 run에 대해 `phase-harness resume --no-drift <runId>` 호출 → exit code 1, stderr에 정해진 메시지, state.json mtime 변하지 않음.

**기존 회귀**: `pnpm tsc --noEmit && pnpm vitest run` 모두 그린.

## Documentation sync

이 repo CLAUDE.md의 "문서 동기화 의무" 조항에 따라 다음 4개 파일을 같은 PR에서 갱신한다.

1. `README.md`:
   - `start` / `run` / `resume` CLI options 표(또는 본문)에 `--no-drift` 추가.
   - "Drift detection" 또는 동등 섹션에 "Disabling drift" 서브섹션 — `--no-drift` vs `HARNESS_PHASE_DRIFT_THRESHOLD=off` 차이 한 문단.
   - precedence 한 줄: "`--no-drift` overrides `HARNESS_PHASE_DRIFT_THRESHOLD` when both are set."
2. `README.ko.md`: 1번의 한국어 동기화. 동일 정보, 동일 위치.
3. `docs/HOW-IT-WORKS.md`:
   - drift detection 섹션에 "Disabling per-run" 항목 — start-frozen / resume-rejected 명시.
   - state.json 스키마 표가 있다면 `noDrift: boolean` 항목 추가.
4. `docs/HOW-IT-WORKS.ko.md`: 3번의 한국어 동기화.

영문/한국어 4개 모두 같은 commit에 들어간다 (CLAUDE.md 정책: "반드시 같은 변경에서").

## Success Criteria

각 항목은 phase-6 자동 검증 또는 unit/integration test로 검증 가능하다.

1. **CLI parses flag**: `phase-harness start --no-drift "task"` 가 commander error 없이 받아진다.
2. **Persistence**: 그렇게 만든 run의 `state.json` 안에 `"noDrift": true`가 존재한다.
3. **Default off**: `phase-harness start "task"` (플래그 없음) 의 `state.json` 안에 `"noDrift": false`가 존재한다.
4. **CLI > env**: `HARNESS_PHASE_DRIFT_THRESHOLD=0.3` 환경에서 `--no-drift`로 시작한 run 의 `events.jsonl`에 `phase_drift` 이벤트가 0건이다 (P5 phase가 최소 1회 완료된 시점 기준).
5. **Default behavior preserved**: `--no-drift` 없이 시작한 manual-mode run 은 env 미설정 시 `phase_drift` 이벤트를 발행하지 않는다 (기존 동작).
6. **Default behavior preserved (auto)**: `--no-drift` 없이 `--auto`로 시작한 run 은 env 미설정 시 threshold=0.3로 `phase_drift` 이벤트를 발행한다 (기존 동작).
7. **Resume reject**: `phase-harness resume --no-drift <runId>` 호출 시 exit code 1, stderr에 거부 메시지가 포함된다, state.json은 읽히지 않는다(mtime 불변).
8. **Migration safety**: `noDrift` 필드가 없는 legacy state.json을 읽으면 `migrateState` 결과 객체의 `noDrift === false`이고, drift detection 동작이 변하지 않는다.
9. **Type/lint clean**: `pnpm tsc --noEmit` 그린, `pnpm vitest run` 그린, `pnpm build` 그린.
10. **Docs synced**: README.md / README.ko.md / docs/HOW-IT-WORKS.md / docs/HOW-IT-WORKS.ko.md 4개 파일에서 `--no-drift` 토큰이 검색된다(`grep -l '\-\-no-drift'` 가 4개 파일 모두 매치).

## Invariants

이 invariant들은 phase-6 verify 단계의 grep / regex 점검 가능 항목이다.

- **INV-1 — short-circuit position**: `src/phases/drift.ts`의 `loadDriftThreshold` 본문에서 `if (noDrift) return null;` 분기가 `process.env['HARNESS_PHASE_DRIFT_THRESHOLD']` 첫 read 이전에 위치한다.
- **INV-2 — caller passes state.noDrift**: `src/phases/drift.ts`의 `scoreP5Drift` 가 `loadDriftThreshold` 호출 시 `input.state.noDrift === true` 을 두 번째 인자로 전달한다.
- **INV-3 — resume rejects**: `src/commands/resume.ts` 가 `--light` 거부 분기와 동일 패턴으로 `options.noDrift`를 검사하고 stderr + `process.exit(1)` 한다. state.json이 그 분기에서 읽히지 않는다.
- **INV-4 — migration default false**: `src/state.ts` 의 `migrateState` 가 `raw.noDrift === undefined` 이면 `false`로 채운다.
- **INV-5 — frozen at start**: 코드 어디에서도 `state.noDrift = ...` 형태의 mutation이 `createInitialState` (또는 `migrateState`) 외부에서 수행되지 않는다 — `grep -nE 'state\.noDrift\s*=' src/` 결과는 `createInitialState`/`migrateState` 두 곳만 매치.
- **INV-6 — events contract preserved**: `state.noDrift === true` 인 run에서 `events.jsonl`을 통째로 grep해도 `"event":"phase_drift"` 가 0건. (구현이 `scoreP5Drift`를 우회하지 않는 한 자동 보장.)
- **INV-7 — docs token presence**: `grep -l '\-\-no-drift' README.md README.ko.md docs/HOW-IT-WORKS.md docs/HOW-IT-WORKS.ko.md` 가 4개 파일 모두 매치.
- **INV-8 — no extra deps**: `package.json`의 `dependencies` / `devDependencies` 가 변경되지 않는다 (`git diff package.json` 빈 결과 또는 version-bump 외 변경 없음).

## Out of scope / deferred

- Mid-run drift toggle UI 또는 status panel 표시 — 향후 별도 PR. 본 PR의 frozen-at-start 결정과 충돌하지 않도록 별도 design이 필요할 수 있음.
- `--drift` counter-flag (재활성화 경로) — 현재로선 default가 충분히 좋다.
- numeric env vs flag 충돌의 fail-fast 모드 — 사용자 답변에 따라 silent override 채택했으므로 deferred.
- retro / status / list 출력에 drift policy 시각화 — events.jsonl과 state.json이 source of truth라는 결정에 따라 deferred.
