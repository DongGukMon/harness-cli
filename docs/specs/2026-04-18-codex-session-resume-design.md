# Per-Phase Codex Session Resume — Design Spec

- 상태: draft
- 작성일: 2026-04-18
- 담당: Claude Code (engineer), Codex (reviewer)
- 관련 문서:
  - Impl plan: `docs/plans/2026-04-18-codex-session-resume.md` (작성 예정)
  - Eval report: `docs/process/evals/2026-04-18-codex-session-resume-eval.md` (작성 예정)
  - 배경: `docs/HOW-IT-WORKS.md`, `docs/specs/2026-04-18-session-logging-design.md`

## 1. 배경과 목표

harness-cli의 gate phase(2/4/7)는 Codex를 독립 리뷰어로 호출한다. 현재 `src/runners/codex.ts`의 `runCodexGate`는 매 호출마다 `spawn(codexBin, ['exec', ...])`로 cold start하며, 세션 재사용 로직이 없다. 결과:

- Gate reject 루프에서 같은 아티팩트(spec/plan/diff)를 매 retry마다 처음부터 재전송 → 매번 reviewer contract를 다시 읽고, 아티팩트를 파싱하고, Phase 7의 경우 관련 파일을 재탐색한다.
- 사용자가 관찰한 사례: 같은 gate가 N회 reject될 때 N번의 완전 cold 시행이 발생한다.
- 특히 Phase 7은 프롬프트에 `<spec> + <plan> + <eval_report> + <diff>`가 모두 포함되고, Codex가 그 위에서 파일 탐색 도구를 사용한다. 재호출마다 같은 탐색이 반복된다.

**목표**: Codex CLI의 네이티브 `codex exec resume <SESSION_ID> [PROMPT]` 기능을 활용해, 동일 gate phase의 reject 루프 내에서는 세션을 재사용하여 redundant work를 제거한다. **리뷰 품질은 유지하면서** 시간/토큰 소모만 줄이는 것이 핵심.

**비목표**:
- 전체 harness run에 걸친 global Codex 세션 공유. (각 phase는 독립된 성격의 리뷰이므로 phase 간에는 격리.)
- Claude runner에 대한 세션 재사용. (Claude gate는 `--print` 일회성 호출로, 동등한 resume 메커니즘이 없음.)
- 파일 레벨 prompt caching 또는 토큰 최적화의 다른 축. 본 작업은 오직 "같은 세션 재사용"에만 집중.

## 2. Context & Decisions

### 핵심 결정사항

- **Session scope = phase 단위**: `phaseCodexSessions: Record<'2'|'4'|'7', GateSessionInfo | null>`을 `HarnessState`에 추가 (canonical shape — §4.1 참고. `GateSessionInfo`는 `{ sessionId, runner, model, effort, lastOutcome }` 구조). 각 phase의 첫 Codex 호출에서 lineage 전체를 저장하고, 이후 같은 phase의 retry에서는 resume한다. 다른 phase로 넘어가면 fresh 세션.
- **Codex runner 전용**: phasePresets에서 runner가 'codex'인 gate에만 적용. 'claude' runner는 기존 동작 유지.
- **Resume 프롬프트 전략 C (사용자 승인)**: resume 호출의 프롬프트 = `updated artifacts + previous feedback`. REVIEWER_CONTRACT는 세션에 이미 있으므로 재전송하지 않는다. 아티팩트는 매 retry마다 Claude Code가 수정할 수 있으므로 full 재전송(stale 방지). 세션 이득은 Codex의 prior reasoning chain + Phase 7 파일 탐색 캐시.
- **적용 범위 = Gate 2/4/7 전체**: Phase 2/4도 세션 재사용 이득이 있음(prior reasoning, output format 확립). Phase 7이 파일 탐색 이득이 가장 크지만 2/4를 제외할 이유 없음.
- **Resume 실패 시 제한된 자동 fallback**: `codex exec resume`이 **"session not found/missing/expired" 카테고리**로 실패한 경우에만 자동 fresh spawn으로 재시도한다. Timeout, Ctrl-C, 일반 리뷰 실패(모델 내부 에러 등), prompt 크기 초과 등 "리뷰 자체 문제"는 fallback하지 않고 error 그대로 반환한다 (사용자가 재시도 판단). Error taxonomy는 §4.5에서 정의. fallback 이벤트는 로깅에 기록.
- **모델/effort 재지정 허용**: resume 호출도 `--model`, `-c model_reasoning_effort=` 플래그를 현 호출과 동일하게 넘긴다. 이는 `codex exec resume --help`로 지원 확인됨.
- **Lifecycle invalidation**: preset 변경(§4.8)과 backward jump(§4.9) 두 경로에서 (1) `phaseCodexSessions[phase] = null`로 세션 무효화 + (2) **replay 사이드카**(`gate-${phase}-{raw,result,error}`) 삭제. **Feedback 파일(`gate-${phase}-feedback.md`)은 삭제하지 않는다** — 기존 reopen/escalation 경로가 이 파일을 참조하기 때문. Replay sidecar를 삭제하는 이유: `harness resume` 시 `runGatePhase`의 one-shot sidecar replay가 stale verdict를 반환해 invalidation 의도를 우회하는 것을 방지. Session 무효화만으로도 다음 **live** gate 호출이 fresh 경로를 타지만, replay 경로는 session 체크보다 먼저 발동하므로 sidecar 자체를 제거해야 안전. Sidecar replay hydration은 sidecar에 기록된 `sourcePreset`과 현재 preset이 일치할 때만 수행(§4.7)한다. `runGatePhase`의 lineage 호환성 재확인(§4.4)은 **preset mismatch 방어만** 커버 — jump/artifact 변화에 대한 방어는 invalidation 훅의 정확성에 의존하며 테스트로 보증한다.

### 제약 조건

- **세션 영속성**: Codex는 `~/.codex/sessions/` 하위에 year 기반 디렉토리 구조로 세션을 디스크 저장한다. 프로세스 재시작/크래시 후에도 resume 가능. 단, Codex 자체의 cleanup 정책(만료, 삭제)은 harness가 제어할 수 없다 → 반드시 fallback 필요.
- **Phase 간 격리**: Gate 2 세션에 spec만 있고 plan/code는 없다. Gate 4로 넘어갈 때 그 세션을 재사용하면 plan을 새로 로드해야 하고, Codex가 "이전 리뷰의 관점"을 이어가서 편향을 일으킬 수 있다 → phase마다 fresh 세션이 정답.
- **REVIEWER_CONTRACT 중복 방지**: 첫 호출(fresh)에만 전문 포함. resume 호출에는 "return verdict in the same format you used before" 같은 간결한 지시만.
- **아티팩트 업데이트 전달 필수**: Gate reject 후 Claude Code가 spec/plan/code를 수정하므로, resume 프롬프트에 **반드시** 업데이트된 아티팩트를 다시 포함시킨다. 세션의 과거 메시지는 stale 상태임을 명시.
- **`codex exec resume` CLI 계약**:
  - 인자: `[SESSION_ID] [PROMPT]`. `-`를 prompt 자리에 쓰면 stdin에서 읽음.
  - 지원 플래그: `-m/--model`, `-c key=value`, `-c model_reasoning_effort=...`, `--json`, `-o`, `--last`, `--skip-git-repo-check`, `--ephemeral`, `--full-auto`, `--dangerously-bypass-approvals-and-sandbox`.
  - 미지원: 명시적 `--sandbox` 플래그. 단 현 `runCodexGate`는 `--sandbox`를 애초에 붙이지 않으므로 무관(gate는 read-only 디폴트로 충분).

### 해소된 모호성

- **세션 재사용이 정확성에 해를 끼치지 않는가?** → 아티팩트를 매 retry마다 업데이트된 full 버전으로 재전송하기 때문에, Codex는 항상 현재 상태를 본다. 세션 히스토리는 "내가 이전에 이 점을 지적했다 → 이번에 반영됐는지 확인" 같은 맥락만 제공. 품질 유지.
- **크래시 후 harness resume과의 상호작용은?** → **Graceful 종료 경로만** sessionId 영속성 보장. `state.phaseCodexSessions[phase]`는 `runGatePhase`가 `runCodexGate` 반환 후 writeState를 호출한 시점에만 persist된다. In-flight 크래시(Codex가 sessionId를 stdout에 찍은 직후 + runGatePhase가 state 업데이트 전에 프로세스가 죽는 경우)에서는 id가 유실될 수 있다 → 이 경우 다음 gate 호출은 fresh spawn (품질/정확성 영향 없음, 단지 최적화 이득을 못 봄). Graceful 경로(success, timeout, error-with-stdout-parsed)는 모두 id를 보존. 이는 spec에서 의도된 tradeoff로, 추가 write-through 복잡도를 도입하지 않는다.
- **Sidecar replay(`checkGateSidecars`)와 충돌 여부** → §4.7에서 두 단계 gate 추가: (A) Replay-level compatibility gate — sidecar의 runner/sourcePreset이 현재 preset과 호환되어야 replay 수용; legacy sidecar(metadata 없음)는 skip. (B) State hydration gate — (A)를 통과한 replay만 state에 세션 id를 주입. 또한 §4.8/§4.9 invalidation 훅이 replay sidecar를 물리적으로 삭제해 jump/preset 변경 후 replay가 아예 발생하지 않도록 한다. Replay 이후 같은 phase에서 다시 reject → retry가 발생하면 정상 resume 또는 fresh 경로를 탄다.
- **Gate 통과 후 세션 id는?** → 유지. 현 run에서 그 phase는 더 이상 호출되지 않지만, 디버깅/감사 목적으로 state에 남겨둠. 메모리 비용 없음(문자열 하나).
- **첫 호출이 error로 끝난 경우(timeout 등) 세션 id를 저장할 것인가?** → 저장 (단, 모든 종료 경로가 accumulated stdout을 파싱해야 함 — §4.4 구현 요구사항 참고). Codex가 sessionId를 stdout에 찍었다면 세션은 시작된 것. 다음 재시도에서 resume 시도 → 실패 시 §4.5의 error taxonomy에 따라 fallback 또는 error 반환.
- **Preset이 run 중 변경되면 기존 세션은 어떻게 되는가?** → 변경 감지 시 무효화. `src/commands/inner.ts`와 `src/ui.ts`는 사용자가 mid-run에 phase preset을 바꿀 수 있게 허용한다 (re-prompt model config, individual preset replacement). 변경 케이스별 규칙:
  - Codex → Claude: `phaseCodexSessions[phase] = null` (해당 phase는 이후 Claude runner 사용, Codex session 의미 없음)
  - Codex(modelA/effortA) → Codex(modelB/effortB): 같은 phase에서 모델/effort가 바뀌면 `phaseCodexSessions[phase] = null`. 이유: 이전 세션은 다른 설정으로 열렸고, resume 시 설정 미스매치 거동을 보장할 수 없음. 새 fresh spawn으로 시작.
  - Claude → Codex: 영향 없음(기존 `phaseCodexSessions[phase]`가 이미 null일 것).
  - 무효화 시점: preset 변경 커밋 경로에서 직접 수행 (§4.8 참고).

### 구현 시 주의사항

- `runCodexGate` 시그니처에 `resumeSessionId?: string | null` 파라미터 추가. null/undefined면 fresh spawn, 값이 있으면 `codex exec resume <id> -` 경로.
- 프롬프트 조립은 `assembler.ts`에 새 함수 추가: `assembleGateResumePrompt(phase, state, cwd, lastOutcome, previousFeedback)`. 기존 `assembleGatePrompt`는 fresh 경로 그대로 유지. 변형 선택은 `lastOutcome`으로 결정 (§4.3 참고).
- `previousFeedback` 소스: `lastOutcome === 'reject'`일 때만 `gate-${phase}-feedback.md`를 읽어 전달. `lastOutcome === 'error'`이면 feedback 파일이 stale일 수 있으므로 빈 문자열을 전달 (변형 B).
- state migration: `migrateState`에 `phaseCodexSessions` 기본값 삽입 (`{ "2": null, "4": null, "7": null }`). 기존 state.json과 호환.
- `runGatePhase` 내부에서 resume 경로 선택 로직은 §4.4 참고. 요약하면: 저장된 세션의 lineage(runner/model/effort)가 현재 preset과 호환될 때만 resume 경로, 아니면 fresh. 호출 후에는 현재 phase가 여전히 active한지 확인한 뒤 `GateSessionInfo` 객체 전체(sessionId/runner/model/effort/lastOutcome)를 저장.
- resume 실패 감지: `runCodexGate` 내부에서 수행. 모든 종료 경로(close/timeout/error)가 accumulated stdout과 stderr를 보존하고 metadata + error classification을 추출한 다음 resolve해야 함. 현재 `buildGateResult`는 stderr를 버리므로, resume 경로용 내부 헬퍼는 `buildGateResult` 호출 **전에** stderr를 검사해 "session missing" 분류를 내야 한다 (§4.5 구현 상세).
- session id 보존: 현재 `runCodexGate`의 timeout/error 브랜치는 accumulated stdoutChunks를 파싱하지 않고 바로 resolve한다. 본 작업에서 이 브랜치들도 `Buffer.concat(stdoutChunks).toString()` → `extractCodexMetadata` 호출 → `codexSessionId`/`tokensTotal`을 `GateError`에 포함시키도록 수정한다. `GateError` 타입은 이미 이 필드들을 optional로 가지고 있음(변경 없음).
- 로깅 확장: `gate_verdict`/`gate_error` 이벤트에 `resumedFrom?: string | null`, `resumeFallback?: boolean` 필드 추가. 기존 `codexSessionId`와의 관계:
  - `resumedFrom = null` + `codexSessionId = <uuid>` → fresh spawn
  - `resumedFrom = <prev_id>` + `codexSessionId = <prev_id>` → 성공적 resume
  - `resumedFrom = <prev_id>` + `resumeFallback = true` + `codexSessionId = <new_uuid>` → resume 실패 → fresh fallback
- sidecar(`gate-${phase}-result.json`)에는 `codexSessionId`만 기록(기존 동작 유지). `resumedFrom` 등은 이벤트 로그에만.
- `runClaudeGate` 경로는 변경 없음. preset.runner !== 'codex'일 때는 `phaseCodexSessions` 읽기/쓰기도 스킵.

## 3. 현 구조 분석

### 관련 파일과 역할

※ 파일 역할/변경 요약표. `src/commands/inner.ts`는 preset 변경 invalidation과 jump invalidation 두 목적 모두 건드림.

| 파일 | 현 역할 | 본 작업에서의 변경 |
|------|---------|--------------------|
| `src/runners/codex.ts` | `runCodexGate`가 `codex exec`로 cold spawn | resume 파라미터 수용, 모든 종료 경로에서 metadata 추출, error taxonomy 분류, session_missing 시 fresh fallback |
| `src/phases/gate.ts` | `runGatePhase`가 프롬프트 조립 + 러너 디스패치 + sidecar 관리 | codex runner일 때 resume id 주입, 반환된 id로 state 업데이트, sidecar replay 시 state hydration |
| `src/context/assembler.ts` | `assembleGatePrompt` (fresh only) | `assembleGateResumePrompt` 추가 |
| `src/types.ts` | `HarnessState`, `GateOutcome`, `GateError` | `phaseCodexSessions` 필드, `resumedFrom`/`resumeFallback` 로그 필드 |
| `src/state.ts` | `migrateState`, `createInitialState` | `phaseCodexSessions` 기본값 추가 (`GateSessionInfo` lineage 포함), sessionId validation, `invalidatePhaseSessionsOnPresetChange`/`invalidatePhaseSessionsOnJump` helper (session만 null; feedback 파일은 유지) |
| `src/commands/inner.ts` | **State mutation 소유자**: `promptModelConfig` 후 `state.phasePresets` 갱신 + `consumePendingAction`에서 offline jump action 적용(실제 state 변경) | **authoritative invalidation 지점**. (1) preset 교체 전 snapshot 저장, 교체 후 `invalidatePhaseSessionsOnPresetChange(state, prevPresets, runDir)`. (2) `consumePendingAction`의 jump 적용 분기에서 `invalidatePhaseSessionsOnJump(state, targetPhase, runDir)` |
| `src/ui.ts` | UI 레이어 — 사용자 입력으로 preset map을 **반환만** (state mutation 없음) | **변경 없음**. Invalidation 호출은 호출자(inner.ts)에서 state를 쓸 때 수행 |
| `src/commands/jump.ts` | CLI 엔트리 — `pending-action.json`만 씀, state.json 건드리지 않음 | **변경 없음**. 실제 state mutation은 `harness resume` 경로에서 `consumePendingAction`이 수행 (inner.ts 행 참고) |
| `src/signal.ts` | SIGUSR1 handler — state mutation 소유자 중 하나 (currentPhase 등) | **authoritative invalidation 지점**. SIGUSR1 jump handler에서 phase 리셋과 함께 `invalidatePhaseSessionsOnJump(state, targetPhase, runDir)` 호출 |
| `src/phases/runner.ts` | `handleGateReject`가 피드백 저장 + reopen, gate dispatch handler의 redirect guard는 error 경로에만 존재 | (1) redirect guard를 verdict 경로까지 포괄하도록 이동 (§4.10). (2) gate_verdict/gate_error emit 시 `resumedFrom`/`resumeFallback` 전달 |
| `src/phases/verdict.ts` | `extractCodexMetadata`로 stdout에서 sessionId 추출, `buildGateResult` | 변경 없음. 단, runner 내부에서 stderr 기반 분류 후 `buildGateResult` 호출 |
| `src/logger.ts` (session-logging) | `logEvent` | `resumedFrom`/`resumeFallback` 필드 수용 |

### 현 호출 경로 (reject 루프 기준, 변경 전)

```
runGatePhase(phase, state)
  ↓ assembleGatePrompt(phase, state, cwd)    ← 전체 아티팩트 포함 프롬프트
  ↓ runCodexGate(phase, preset, prompt, ...)  ← cold spawn
  ↓ [REJECT] handleGateReject → saveGateFeedback → reopen interactive phase
  ↓ Claude가 아티팩트 수정
  ↓ runGatePhase(phase, state) 재호출       ← 또 cold spawn, 같은 작업 반복
```

### 새 호출 경로 (reject 루프 기준, 변경 후)

```
runGatePhase(phase, state)
  ↓ if (runner === 'codex' AND savedCompatible session in state.phaseCodexSessions[phase]):
  ↓   prompt = assembleGateResumePrompt(..., lastOutcome, feedback)  ← Variant A/B by lastOutcome
  ↓   runCodexGate(..., resumeSessionId=<id>, buildFreshPromptOnFallback=closure)
  ↓ else:
  ↓   if savedSession exists but incompatible → null it out (defense-in-depth)
  ↓   prompt = assembleGatePrompt(...)                               ← 기존 full 프롬프트
  ↓   runCodexGate(..., resumeSessionId=null)                        ← cold spawn
  ↓ [stillActivePhase check → GateSessionInfo { sessionId, runner, model, effort, lastOutcome }
  ↓   를 state.phaseCodexSessions[phase]에 저장]
  ↓ [REJECT] 동일 (handleGateReject → saveGateFeedback → reopen)
  ↓ 다음 runGatePhase 호출 → resume 경로 활성
```

## 4. 설계 상세

### 4.1 State 스키마

세션 ID만 저장하는 대신, **lineage 정보**(runner, model, effort)를 함께 저장한다. 이렇게 하면 `runGatePhase`가 resume 경로 진입 전에 현재 preset과 저장된 lineage의 호환성을 체크할 수 있어, invalidation 훅이 놓친 경우에도 잘못된 resume을 차단할 수 있다 (defense-in-depth). Lineage 불일치 감지 시 저장된 id를 null로 간주하고 fresh로 진행.

```ts
// src/types.ts
export interface GateSessionInfo {
  sessionId: string;                       // non-empty
  runner: 'claude' | 'codex';              // reserved — 현재는 'codex'만 저장됨
  model: string;                           // 해당 세션이 열릴 때의 preset.model
  effort: string;                          // 해당 세션이 열릴 때의 preset.effort
  lastOutcome: 'approve' | 'reject' | 'error';
                                           //   - 'approve': APPROVE verdict. 정상 흐름에선 state.phases[phase]='completed'로
                                           //     바뀌고 runPhaseLoop가 건너뛰므로 재호출되지 않음. 단 state 저장 후
                                           //     phase status 저장 전 crash 등 edge case를 위해 정확히 기록.
                                           //     만약 이 값으로 resume 경로에 진입하게 되면 Variant B 사용(stale 우려 없음).
                                           //   - 'reject': REJECT verdict (gate-N-feedback.md 존재 보증)
                                           //   - 'error': error 반환 (feedback 파일 없을 수 있음)
}

export interface HarnessState {
  // 기존 필드들...
  phaseCodexSessions: Record<'2' | '4' | '7', GateSessionInfo | null>;
}
```

`createInitialState`:
```ts
phaseCodexSessions: { '2': null, '4': null, '7': null }
```

`migrateState`:
```ts
if (!raw.phaseCodexSessions || typeof raw.phaseCodexSessions !== 'object') {
  raw.phaseCodexSessions = { '2': null, '4': null, '7': null };
}
for (const k of ['2', '4', '7']) {
  const v = raw.phaseCodexSessions[k];
  // Validate: must be null or a proper GateSessionInfo with non-empty sessionId
  if (v === undefined || v === null) {
    raw.phaseCodexSessions[k] = null;
    continue;
  }
  if (
    typeof v !== 'object' ||
    typeof v.sessionId !== 'string' ||
    v.sessionId.trim().length === 0 ||
    typeof v.runner !== 'string' ||
    typeof v.model !== 'string' ||
    typeof v.effort !== 'string' ||
    (v.lastOutcome !== 'approve' && v.lastOutcome !== 'reject' && v.lastOutcome !== 'error')
  ) {
    raw.phaseCodexSessions[k] = null;  // malformed → discard
  }
}
```

**ID 유효성 규칙** (모든 사용 지점에 적용): `sessionId`는 `typeof === 'string' && sessionId.trim().length > 0`일 때만 유효. 이 조건을 만족하지 않으면 저장/resume/hydration 대상이 아니다. 이 검증은 resume 시점과 sidecar hydration 시점 모두에서 수행.

### 4.2 Runner 시그니처 변경

```ts
// src/runners/codex.ts
export async function runCodexGate(
  phase: number,
  preset: ModelPreset,
  prompt: string,
  harnessDir: string,
  cwd: string,
  resumeSessionId?: string | null,
  // Closure for lazy fresh-prompt build (only called on session_missing fallback).
  // Returns the prompt string or { error } on size/IO failure.
  buildFreshPromptOnFallback?: () => string | { error: string },
): Promise<GatePhaseResult> { ... }
```

Closure 기반이기 때문에 (1) 사전에 fresh 프롬프트를 조립/검증하지 않아 resume 경로의 지연을 추가하지 않고, (2) fallback이 실제 필요할 때만 `assembleGatePrompt`의 크기 검증이 수행되어, 정상 resume이 "speculative fallback 프롬프트가 너무 크다"는 이유로 차단되지 않는다.

내부 분기:
```ts
const args = resumeSessionId
  ? ['exec', 'resume', resumeSessionId,
     '--model', preset.model,
     '-c', `model_reasoning_effort="${preset.effort}"`,
     '-']
  : ['exec',
     '--model', preset.model,
     '-c', `model_reasoning_effort="${preset.effort}"`,
     '-'];

const child = spawn(codexBin, args, { stdio: ['pipe', 'pipe', 'pipe'], detached: true, cwd });
```

### 4.3 Resume 프롬프트 (Strategy C)

새 함수 `assembleGateResumePrompt(phase, state, cwd, lastOutcome, previousFeedback)`:

**변형 A — Retry after reject (기본)**: `lastOutcome === 'reject'` (이전 호출이 REJECT verdict를 반환해 `gate-${phase}-feedback.md`가 저장된 상태, `previousFeedback`에 해당 내용 전달됨).

```
## Updated Artifacts (Re-Review Requested)

The artifacts have been updated based on your previous feedback. Re-review the new versions and verify your prior concerns were addressed.

<spec>
{최신 spec 내용}
</spec>

[Phase 4/7에 plan 포함]
<plan>
{최신 plan 내용}
</plan>

[Phase 7에 eval_report, diff, metadata 포함]
<eval_report>
{최신 eval_report 내용}
</eval_report>

<diff>
{최신 git diff}
</diff>

<metadata>
{기존 Phase 7 메타데이터 블록}
</metadata>

## Your Previous Feedback (for reference)

{gate-${phase}-feedback.md 전체 내용}

## Instructions

Return a verdict in the same structured format you used before (## Verdict / ## Comments / ## Summary). APPROVE only if zero P0/P1 findings, and especially verify whether your prior P0/P1 concerns have been addressed.
```

**변형 B — Retry after error (no fresh feedback)**: `lastOutcome === 'error'` (이전 호출이 error로 끝남). 예: 첫 호출 타임아웃 또는 nonzero_exit_other로 실패 → sessionId는 저장됐지만 **현재 retry 관점에서는 새로운 feedback이 없음**. 이전 reject의 feedback 파일이 디스크에 남아있을 수 있으나, 그것은 이 세션의 직전 turn에 해당하지 않으므로 무시하고 변형 B 사용.

```
## Continue Review

The previous review turn did not complete. Here are the artifacts to review (unchanged from the prior turn, unless modifications occurred in the interim):

<spec>...</spec>
(and plan/eval_report/diff/metadata per phase, as in 변형 A)

## Instructions

Return a verdict in the same structured format you used before (## Verdict / ## Comments / ## Summary).
```

**구별 규칙**: `GateSessionInfo.lastOutcome`으로 판단한다.
- `lastOutcome === 'reject'` → 직전 호출이 REJECT verdict였고 `gate-${phase}-feedback.md`가 보증됨 → 변형 A 선택, feedback 파일 내용을 프롬프트에 삽입
- `lastOutcome === 'error'` → 직전 호출이 error였음 → 변형 B 선택 (feedback 파일이 있더라도 그것은 더 이전 retry의 stale feedback이므로 무시)
- `lastOutcome === 'approve'` → 정상 흐름에선 도달하지 않음. 안전 fallback으로 변형 B 선택 (stale 주장 없이 단순 재요청).

`assembleGateResumePrompt`는 `lastOutcome` 파라미터를 추가로 받아 분기한다. `retryIndex`는 프롬프트에 포함하지 않는다 (현재 `state.gateRetries`는 REJECT count만 세므로 error 시퀀스에서 의미가 모호해짐, §4.3 Variant B 참고):
```ts
export function assembleGateResumePrompt(
  phase: 2 | 4 | 7,
  state: HarnessState,
  cwd: string,
  lastOutcome: 'approve' | 'reject' | 'error',
  previousFeedback: string,   // lastOutcome !== 'reject'면 빈 문자열
): string | { error: string } { ... }
```

`runGatePhase`는 `savedSession.lastOutcome`과 (lastOutcome==='reject'일 때만) `gate-${phase}-feedback.md`를 읽어 assembler에 전달.

REVIEWER_CONTRACT 전문은 **포함하지 않는다** (두 변형 모두). 세션의 첫 turn에 이미 있음.

### 4.4 Control Flow in `runGatePhase`

```ts
// src/phases/gate.ts
export async function runGatePhase(phase, state, harnessDir, runDir, cwd, allowSidecarReplay?) {
  // 1. sidecar replay (기존)
  // 2. sidecar cleanup (기존)

  // 3. Resolve preset
  const preset = getPresetById(state.phasePresets[String(phase)]);

  // 4. 프롬프트 조립 분기
  const savedSession = state.phaseCodexSessions[String(phase) as '2'|'4'|'7'];
  const savedCompatible = (
    savedSession !== null &&
    typeof savedSession.sessionId === 'string' &&
    savedSession.sessionId.trim().length > 0 &&
    savedSession.runner === 'codex' &&
    preset.runner === 'codex' &&
    savedSession.model === preset.model &&
    savedSession.effort === preset.effort
  );
  const useCodexResume = savedCompatible;
  // 비호환 감지 시 저장된 id는 신뢰하지 않음 (invalidation 훅 miss에 대한 방어)
  if (savedSession !== null && !savedCompatible) {
    state.phaseCodexSessions[String(phase) as '2'|'4'|'7'] = null;
    writeState(runDir, state);
  }

  let prompt: string;
  if (useCodexResume) {
    const session = savedSession as GateSessionInfo;
    let previousFeedback = '';
    if (session.lastOutcome === 'reject') {
      const feedbackPath = path.join(runDir, `gate-${phase}-feedback.md`);
      previousFeedback = fs.existsSync(feedbackPath)
        ? fs.readFileSync(feedbackPath, 'utf-8')
        : '(feedback file missing despite lastOutcome=reject — spec anomaly)';
    }
    // Variant A/B 선택은 lastOutcome으로만 결정 (feedback 파일 존재 여부가 아님).
    // lastOutcome === 'approve'는 정상 흐름에서 도달하지 않는 edge case이나, safety-fallback으로 Variant B 처리.
    const resumeRes = assembleGateResumePrompt(
      phase, state, cwd, session.lastOutcome, previousFeedback
    );
    if (typeof resumeRes !== 'string') return { type: 'error', error: resumeRes.error };
    prompt = resumeRes;
    // fallback fresh prompt는 closure로 전달(§4.5 lazy). Eager assembly 불필요.
  } else {
    const result = assembleGatePrompt(phase, state, harnessDir, cwd);
    if (typeof result !== 'string') return { type: 'error', error: result.error };
    prompt = result;
  }

  // 5. Dispatch
  const resumeId = useCodexResume ? (savedSession as GateSessionInfo).sessionId : null;
  // fallbackFreshPrompt는 caller가 미리 조립하지 않고 **closure**로 전달 (§4.5 lazy fallback).
  const rawResult = preset.runner === 'codex'
    ? await runCodexGate(
        phase, preset, prompt, harnessDir, cwd, resumeId,
        /* buildFreshPromptOnFallback */ () => assembleGatePrompt(phase, state, harnessDir, cwd),
      )
    : await runClaudeGate(phase, preset, prompt, harnessDir, cwd);

  // 6. **Redirect guard (verdict application 포함)**: gate 실행 중 SIGUSR1 jump(§4.9)으로
  //    `state.currentPhase !== phase`가 된 경우, 반환된 verdict/error 모두 stale이다.
  //    이 경우:
  //      - sessionId를 state에 저장하지 않음 (invalidation을 덮어쓰지 않도록)
  //      - 호출한 phase handler(runner.ts의 gate handler)가 verdict 반영/reopen을 일으키지 않도록
  //        `runGatePhase` 자체가 이 상태를 호출자에게 전달해야 함
  //    구현 선택: `runGatePhase`가 redirect 감지 시 특수 sentinel 결과 반환.
  //    ```
  //    if (state.currentPhase !== phase) {
  //      return { type: 'error', error: `phase ${phase} redirected to ${state.currentPhase} mid-run`,
  //               exitCode: undefined };
  //      // caller(gate handler in runner.ts)는 이 error를 보고 verdict 반영 스킵.
  //      // 기존 코드에 이미 "error 경로에서 state.currentPhase !== phase면 redirect"
  //      // 처리가 runner.ts:415에 있으므로 같은 패턴 활용.
  //    }
  //    ```
  //    (verdict 반영 스킵은 runner.ts에 이미 있는 redirect guard가 커버한다 — 관련 수정은 §4.10.)
  //
  //    단, resumeFallback=true면 원래의 stale lineage는 무조건 지운 뒤 새 id를 저장한다.
  //    이유: fresh fallback이 실패해 새 id를 못 얻은 경우에도 stale lineage를 남기면 안 됨
  //    (다음 retry가 또 dead session을 resume 시도 → 같은 session_missing 에러 반복).
  const stillActivePhase = state.currentPhase === phase;
  if (preset.runner === 'codex' && stillActivePhase) {
    if (rawResult.resumeFallback) {
      state.phaseCodexSessions[String(phase) as '2'|'4'|'7'] = null;
    }
    const newId = rawResult.codexSessionId;
    if (typeof newId === 'string' && newId.trim().length > 0) {
      // lastOutcome 결정: verdict 타입이면 APPROVE/REJECT 구분, error면 'error'.
      const lastOutcome: 'approve' | 'reject' | 'error' =
        rawResult.type === 'verdict'
          ? (rawResult.verdict === 'APPROVE' ? 'approve' : 'reject')
          : 'error';
      state.phaseCodexSessions[String(phase) as '2'|'4'|'7'] = {
        sessionId: newId,
        runner: 'codex',
        model: preset.model,
        effort: preset.effort,
        lastOutcome,
      };
    }
    writeState(runDir, state);
  }

  // 7. sidecar 기록, metadata 부착 (기존)
  ...
}
```

### 4.5 Resume 실패 시 Fallback

**Error taxonomy** (authoritative — §2와 아래 로직 모두 이 분류를 따름):

| 카테고리 | 감지 방법 | 조치 |
|----------|-----------|------|
| `session_missing` | stderr에 "session not found", "no such session", "unknown session id" 등 Codex가 세션을 찾지 못했음을 시사하는 패턴 | 자동 fresh fallback (sessionId 초기화 + fresh prompt로 재실행) |
| `timeout` | `runCodexGate` 내부 setTimeout이 트리거 | fallback 안 함. `GateError` 반환 |
| `nonzero_exit_other` | non-zero exit이지만 session_missing 패턴 아님 (모델 에러, prompt 파싱 실패 등) | fallback 안 함. `GateError` 반환 |
| `spawn_error` | child.on('error') (CLI 자체 실행 실패) | fallback 안 함. `GateError` 반환 |
| `success_verdict` | exit 0 + stdout에 `## Verdict` 섹션 존재 | 정상 반환 |
| `success_no_verdict` | exit 0 + `## Verdict` 섹션 미발견 | fallback 안 함. `GateError` 반환 (리뷰 품질 문제) |

`session_missing` 정확한 패턴은 구현 시 실험으로 확정(§9 Open Question #1). 안전한 기본은 "매우 좁게" 잡는 것: 확실한 session-missing 패턴만 fallback, 애매하면 error 반환. 오탐으로 fallback하면 비용 낭비, 누락하면 사용자 경험 약간 나빠지지만 안전.

**내부 구조** (의사 코드):

```ts
async function runCodexGate(phase, preset, prompt, harnessDir, cwd, resumeSessionId) {
  if (!resumeSessionId) {
    // Fresh 경로
    return await runCodexExecRaw({ mode: 'fresh', prompt, preset, ... });
  }

  // Resume 경로
  const rawResume = await runCodexExecRaw({ mode: 'resume', sessionId: resumeSessionId, prompt, preset, ... });

  // rawResume은 stdout/stderr/exitCode/timedOut 등의 원시 정보를 포함
  // (GatePhaseResult로 collapse 전에 분류)

  if (rawResume.category === 'session_missing') {
    // Lazy fresh-prompt build via closure. assembleGatePrompt runs its own size check.
    // Caller(runGatePhase)는 closure 안에서 stillActivePhase 체크를 수행해 SIGUSR1 jump로 인해
    // 현 gate가 이미 stale해진 경우 fallback 실행을 중단한다 (§4.5 closure 계약).
    if (!buildFreshPromptOnFallback) {
      return { type: 'error', error: 'session_missing but no fallback prompt builder provided',
               resumedFrom: resumeSessionId };
    }
    const freshPromptOrError = buildFreshPromptOnFallback();
    if (typeof freshPromptOrError !== 'string') {
      // Fresh prompt can't be assembled. 발생 원인:
      //   1) 크기 초과 (MAX_PROMPT_SIZE_KB) → `assembleGatePrompt`가 error 반환
      //   2) 현 phase가 jump로 stale → closure가 `{ error: 'phase stale' }` 반환 (§4.5 계약)
      //
      // **현재 assembler 계약 유지**: 개별 아티팩트 read 실패(파일 부재/IO)는 error가 아니라
      // placeholder(`(file not found: <path>)`)로 주입된다 (`assembler.ts:75` 기존 동작).
      // 본 작업은 이 계약을 바꾸지 않으며, 위 목록의 1번/2번만 error 원인이다.
      //
      // 어느 경우든 stale 세션 복구 불가 → error 반환 (fallback flag은 켠다).
      return { type: 'error', error: freshPromptOrError.error,
               resumedFrom: resumeSessionId, resumeFallback: true };
    }
    const rawFresh = await runCodexExecRaw({ mode: 'fresh', prompt: freshPromptOrError, preset, ... });
    const fresh = buildGateResultFromRaw(rawFresh);
    return { ...fresh, resumeFallback: true, resumedFrom: resumeSessionId };
  }

  // session_missing 아니면 그대로 반환 (fallback 없음)
  return { ...buildGateResultFromRaw(rawResume), resumedFrom: resumeSessionId };
}
```

**타입**:
```ts
interface RawExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
  category: 'session_missing' | 'timeout' | 'nonzero_exit_other'
          | 'spawn_error' | 'success_verdict' | 'success_no_verdict';
  codexSessionId?: string;   // extractCodexMetadata로 stdout에서 파싱
  tokensTotal?: number;
}
```

이 내부 타입은 `src/runners/codex.ts` 안에서만 쓰고 외부에 노출하지 않는다. 외부 API(`runCodexGate`)의 반환 타입은 기존 `GatePhaseResult` 유지.

**Lazy fallback prompt**: `runGatePhase`는 resume 경로일 때 resume 프롬프트만 미리 조립/검증하고, fresh 프롬프트는 **closure**로 감싸 `runCodexGate`에 넘긴다. Closure는 session_missing이 감지된 시점에만 호출되어 `assembleGatePrompt(phase, state, ...)`를 실행 — 이 시점에 크기 체크도 함께 수행된다. 정상 resume 성공 시에는 fresh 프롬프트 조립 비용을 지불하지 않음.

```ts
// src/phases/gate.ts, runGatePhase (resume 경로)
if (useCodexResume) {
  const resumeResult = assembleGateResumePrompt(...);  // 크기 체크 포함
  if (typeof resumeResult !== 'string') return { type: 'error', error: resumeResult.error };
  const rawResult = await runCodexGate(
    phase, preset, resumeResult, harnessDir, cwd, resumeId,
    // Closure 계약: 호출 시점에 state.currentPhase가 여전히 phase인지 확인한 뒤
    // fresh 프롬프트 조립. SIGUSR1 jump로 stale해졌으면 `{ error }` 반환.
    /* buildFreshPromptOnFallback */ () => {
      if (state.currentPhase !== phase) {
        return { error: `phase ${phase} stale (currentPhase=${state.currentPhase})` };
      }
      return assembleGatePrompt(phase, state, harnessDir, cwd);
    },
  );
  // ...
}
```

**중요**: fallback 경로가 발동하면 이후 §4.4의 sessionId 저장 로직에 의해 `state.phaseCodexSessions[phase]`는 새 fresh 세션의 id로 덮어써진다 (다음 retry는 새 세션에서 resume). Fresh 프롬프트는 `assembleGatePrompt`이 조립하므로 자동으로 `REVIEWER_CONTRACT`를 포함 — REVIEWER_CONTRACT를 별도로 export/prepend할 필요 없음.

### 4.6 로깅 확장

`LogEvent` 타입(`src/types.ts`):
```ts
| (LogEventBase & {
    event: 'gate_verdict';
    // 기존 필드...
    resumedFrom?: string | null;     // 신규: resume 시 이전 세션 id, fresh면 null
    resumeFallback?: boolean;         // 신규: resume 실패 후 fresh fallback 여부
  })
| (LogEventBase & {
    event: 'gate_error';
    // 기존 필드...
    resumedFrom?: string | null;
    resumeFallback?: boolean;
  })
```

`runner.ts`의 gate_verdict/gate_error emit 지점에서 `result.resumedFrom`, `result.resumeFallback`을 결과에서 꺼내 이벤트에 포함.

`GatePhaseResult` 타입 확장:
```ts
export interface GateOutcome {
  // 기존...
  resumedFrom?: string | null;
  resumeFallback?: boolean;
}
export interface GateError {
  // 기존...
  resumedFrom?: string | null;
  resumeFallback?: boolean;
}
```

### 4.7 Sidecar replay 경로

**Sidecar + GatePhaseResult 스키마 확장**: 기존 `GateResult`는 `runner` 필드만 가지지만, session hydration 시 preset 호환성을 판단하기 위해 `sourcePreset?: { model: string; effort: string }` 필드를 추가한다. 이는 해당 gate 실행 시점의 preset 스냅샷이다. 기존 sidecar(필드 없음)는 hydration에서 제외된다(보수적 동작).

또한 `checkGateSidecars`가 반환하는 `GatePhaseResult`에도 동일한 필드를 전파해야 한다 (replay 경로의 hydration이 이 값을 읽어야 하기 때문). 즉 `GateOutcome`과 `GateError`에도 `sourcePreset?` 추가.

```ts
// src/types.ts
export interface GateResult {
  // 기존 필드...
  runner?: 'claude' | 'codex';
  sourcePreset?: { model: string; effort: string };  // NEW
  // ...
}

export interface GateOutcome {
  // 기존 필드...
  sourcePreset?: { model: string; effort: string };  // NEW (replay hydration)
}

export interface GateError {
  // 기존 필드...
  sourcePreset?: { model: string; effort: string };  // NEW (replay hydration)
}
```

`checkGateSidecars`는 이미 `gate-N-result.json`을 JSON.parse해서 `GateResult`로 읽은 뒤 metadata 필드를 `GatePhaseResult`에 hydrate하는 로직(`src/phases/gate.ts:52`의 metadata 블록)을 가지고 있으므로, 여기에 `sourcePreset`을 한 줄 추가하면 됨.

**Sidecar replay 자체의 preset 호환성 gate**: replay가 **반환되는 조건**도 preset 호환성에 의해 제한된다. 즉 sidecar에 기록된 `sourcePreset`(또는 `runner`)이 현재 `state.phasePresets[phase]`의 preset과 호환되지 않으면 replay를 건너뛰고 live gate 실행으로 진행한다. 이는 preset이 변경된 경우 캐시된 verdict를 재사용하지 않도록 하기 위함(§4.8 invalidation 의도 존중).

**호환 판단 규칙 (authoritative, 단일)**: Replay는 **sidecar가 versioned compatibility 메타데이터를 완전히 갖췄을 때만** 수용한다. 즉 다음 모두를 만족해야 `replayCompatible = true`:

1. `replay.runner !== undefined` (legacy pre-session-logging sidecar는 자동 skip)
2. `replay.runner === currentPreset.runner`
3. `replay.runner === 'claude'`이면 (2)만 충족해도 통과 (Claude는 resume 대상 아님)
4. `replay.runner === 'codex'`이면 추가로:
   - `replay.sourcePreset !== undefined`
   - `replay.sourcePreset.model === currentPreset.model`
   - `replay.sourcePreset.effort === currentPreset.effort`

이 규칙은 **legacy sidecar(runner나 sourcePreset 없음)를 일괄 skip**하므로 안전. 기존 동작보다 엄격한 방향이지만, 본 작업 이전 sidecar가 크게 쌓여있을 일이 거의 없고(run 단위), 최악의 경우 한 번의 live 실행만 추가됨.

비호환 판정 시 sidecar를 물리적으로 삭제할 필요는 없다 — fall through된 뒤 runGatePhase의 Step 2(pre-run sidecar cleanup)에서 삭제되고 Step 5에서 현 preset 기준 새 sidecar로 대체됨.

**State hydration 로직** (위 호환성 gate를 통과한 replay에만 적용): `runGatePhase`가 sidecar replay로 조기 리턴하기 직전에:
1. replay된 `GatePhaseResult.codexSessionId`가 존재하고
2. replay된 `runner === 'codex'`이고
3. `state.phaseCodexSessions[phase]`가 null이고
4. replay된 `sourcePreset`이 현재 `state.phasePresets[phase]`의 model/effort와 일치

위 네 조건이 모두 충족될 때만 state를 하이드레이트한다.

```ts
// src/phases/gate.ts, runGatePhase 내 sidecar replay 분기
if (allowSidecarReplay?.value) {
  allowSidecarReplay.value = false;
  const replay = checkGateSidecars(runDir, phase);
  if (replay !== null) {
    const currentPreset = getPresetById(state.phasePresets[String(phase)]);

    // (A) Replay-level compatibility gate: 위 authoritative 규칙의 구현.
    // Legacy sidecar (runner undefined 또는 codex sourcePreset 없음) → 전부 skip.
    const replayCompatible = (
      currentPreset !== undefined &&
      replay.runner !== undefined &&
      replay.runner === currentPreset.runner &&
      (
        replay.runner === 'claude'
          ? true  // Claude: runner 일치만으로 통과
          : (replay.sourcePreset !== undefined &&
             replay.sourcePreset.model === currentPreset.model &&
             replay.sourcePreset.effort === currentPreset.effort)
      )
    );
    if (!replayCompatible) {
      // replay 건너뛰고 live 실행으로. sidecar 파일은 지우지 않음 — step 5에서 overwrite.
      // 아래 "Step 2: Pre-run sidecar cleanup"이 어차피 이들을 삭제함.
      // falls through to live execution path
    } else {
      // (B) Hydration gate (기존 로직)
      const canHydrate =
        replay.codexSessionId !== undefined &&
        replay.runner === 'codex' &&
        state.phaseCodexSessions[String(phase) as '2'|'4'|'7'] === null &&
        currentPreset?.runner === 'codex' &&
        replay.sourcePreset !== undefined &&
        replay.sourcePreset.model === currentPreset.model &&
        replay.sourcePreset.effort === currentPreset.effort;

      if (canHydrate) {
      // replay.codexSessionId는 위 검증에서 non-empty string 확인됨.
      // lastOutcome 결정: verdict 타입이면 APPROVE/REJECT 구분, error면 'error'.
      const lastOutcome: 'approve' | 'reject' | 'error' =
        replay.type === 'verdict'
          ? (replay.verdict === 'APPROVE' ? 'approve' : 'reject')
          : 'error';
        state.phaseCodexSessions[String(phase) as '2'|'4'|'7'] = {
          sessionId: replay.codexSessionId!,
          runner: 'codex',
          model: currentPreset!.model,
          effort: currentPreset!.effort,
          lastOutcome,
        };
        writeState(runDir, state);
      }
      return { ...replay, recoveredFromSidecar: true };
    } // end replayCompatible
  }
}
```

**Sidecar 쓰기 시에도 preset 기록**: `runGatePhase` step 5(sidecar 쓰기)에서 현재 preset을 `sourcePreset`으로 기록한다.

```ts
const gateResult: GateResult = {
  exitCode,
  timestamp: Date.now(),
  runner,
  sourcePreset: runner === 'codex' ? { model: preset.model, effort: preset.effort } : undefined,
  // ...
};
```

단, replay 자체에서는 Codex가 호출되지 않으므로 `resumedFrom`/`resumeFallback`은 replay 결과에는 포함되지 않는다 (`recoveredFromSidecar: true`만 표시).

### 4.8 Preset 변경 시 Session 무효화

Harness 현 구조상 사용자는 mid-run에 phasePresets를 바꿀 수 있다 (`src/commands/inner.ts`의 `promptModelConfig`, `src/ui.ts`의 개별 preset 교체 UI). preset 변경 시 해당 phase의 저장된 Codex 세션이 무효화되어야 한다 — 세션이 이전 모델/effort로 열렸기 때문에 resume 시 설정 미스매치가 발생할 수 있음.

**무효화 규칙** (§2 해소된 모호성과 동일):
- 변경 후 `runner === 'claude'` → `phaseCodexSessions[phase] = null`
- 변경 후 `runner === 'codex'`지만 `model` 또는 `effort`가 이전 preset과 다름 → `phaseCodexSessions[phase] = null`
- 변경 후 preset이 이전과 identical (change가 no-op) → 변경 없음

**구현 위치**: preset을 수정하는 모든 호출 사이트. 현 코드 기준:
1. `inner.ts`에서 `state.phasePresets = await promptModelConfig(...)` 직후 (전체 re-prompt)
2. `ui.ts`에서 개별 preset 교체 직후

두 경로 모두에서, 변경 전 preset 스냅샷과 변경 후 preset을 비교해 `phaseCodexSessions`를 갱신하는 헬퍼 함수를 호출한다:

```ts
// src/state.ts 또는 별도 helper에 추가
// feedback 파일(gate-N-feedback.md)은 건드리지 않는다 (reopen/escalation flow가 참조).
// 단 replay용 sidecar(gate-N-raw.txt, gate-N-result.json, gate-N-error.md)는 삭제 —
// 세션과 같은 freshness domain이며, 남겨두면 `harness resume`의 one-shot 사이드카 replay가
// preset 변경을 우회하고 stale verdict를 반환할 수 있음.
export function invalidatePhaseSessionsOnPresetChange(
  state: HarnessState,
  prevPresets: Record<string, string>,
  runDir: string,
): void {
  for (const phase of ['2', '4', '7'] as const) {
    const prevId = prevPresets[phase];
    const currId = state.phasePresets[phase];
    if (prevId === currId) continue;
    const prev = getPresetById(prevId);
    const curr = getPresetById(currId);
    if (
      !prev || !curr ||
      prev.runner !== curr.runner ||
      (curr.runner === 'codex' && (prev.model !== curr.model || prev.effort !== curr.effort))
    ) {
      state.phaseCodexSessions[phase] = null;
      // Replay sidecar 삭제 (feedback은 건드리지 않음)
      for (const filename of [`gate-${phase}-raw.txt`, `gate-${phase}-result.json`, `gate-${phase}-error.md`]) {
        try { fs.unlinkSync(path.join(runDir, filename)); } catch { /* 없으면 무시 */ }
      }
    }
  }
}
```

호출 사이트(inner.ts, ui.ts)에서 변경 전 snapshot을 유지하고 변경 후 이 helper 호출 → writeState.

**왜 feedback 파일을 삭제하지 않는가?**: 기존 reopen/escalation 흐름(`src/phases/runner.ts handleGateReject`, `src/resume.ts show_escalation`, `src/context/assembler.ts assembleInteractivePrompt`)이 `pendingAction.feedbackPaths`의 파일 경로를 계속 참조한다. Invalidation이 이 파일을 삭제하면 reopen된 interactive phase가 빈 경로를 읽어 Claude Code에 피드백이 전달되지 않는다. Session(`phaseCodexSessions`)만 null로 비우면 다음 gate 호출은 fresh spawn을 타고 Variant A/B 분기 자체가 발생하지 않으므로, stale feedback 이슈도 자연스럽게 해소된다. **Feedback 파일은 별도 lifecycle**: 다음 REJECT에서 `saveGateFeedback`이 덮어쓰거나, phase가 APPROVE로 최종 통과하면 그대로 남는다 (gate 단위 artifact).

**Test**: preset 변경 시 `phaseCodexSessions`가 기대대로 갱신되는지 단위 테스트.

### 4.9 Backward phase movement 시 Session 무효화

사용자는 `harness jump <phase>` 또는 SIGUSR1 control signal로 run을 이전 phase로 되돌릴 수 있다 (`src/commands/jump.ts`, `src/signal.ts`). 이때 이후 gate의 입력(spec/plan/code)이 바뀔 수 있으므로 저장된 gate 세션이 stale이 된다. 방치하면 Gate는 이전 리뷰 컨텍스트로 resume하여 현재 상태와 맞지 않는 피드백을 주거나 자동 APPROVE 편향을 발생시킬 수 있다.

**규칙**: phase K로 jump할 때, `phaseCodexSessions[P]`를 모든 gate phase P (2, 4, 7 중) 에 대해 `P >= K`인 경우 null로 초기화.

| jump 대상 K | 무효화되는 gate session |
|------------|------------------------|
| K=1 | 2, 4, 7 |
| K=2 | 2, 4, 7 |
| K=3 | 4, 7 |
| K=4 | 4, 7 |
| K=5 | 7 |
| K=6 | 7 |
| K=7 | 7 |

**구현 위치 (authoritative — state mutation이 실제로 일어나는 지점에만)**:

1. **Online jump (active session, SIGUSR1 경로)** — `src/signal.ts` SIGUSR1 핸들러에서 phase 리셋과 동시에 `invalidatePhaseSessionsOnJump(state, targetPhase, runDir)` 호출.
2. **Offline jump 적용 (pending-action consume 시)** — `src/commands/inner.ts`의 `consumePendingAction`의 jump 적용 분기에서 `invalidatePhaseSessionsOnJump(state, targetPhase, runDir)` 호출.

**주의**: `src/commands/jump.ts`와 `src/ui.ts`는 UI/CLI 엔트리 레이어로 state.json을 직접 수정하지 않으므로 invalidation 호출 **대상 아님**. (`jump.ts`는 `pending-action.json`만 쓰고 state mutation은 위 (2)에서 수행.)

```ts
// src/state.ts
// feedback 파일(gate-N-feedback.md)은 건드리지 않는다.
// Replay sidecar는 §4.8과 같은 이유로 삭제 — jump 이후 사이드카 replay가 stale verdict를
// 반환해 jump 의도를 우회하는 것을 방지.
export function invalidatePhaseSessionsOnJump(
  state: HarnessState,
  targetPhase: number,
  runDir: string,
): void {
  for (const phase of [2, 4, 7] as const) {
    if (phase >= targetPhase) {
      state.phaseCodexSessions[String(phase) as '2'|'4'|'7'] = null;
      for (const filename of [`gate-${phase}-raw.txt`, `gate-${phase}-result.json`, `gate-${phase}-error.md`]) {
        try { fs.unlinkSync(path.join(runDir, filename)); } catch { /* 없으면 무시 */ }
      }
    }
  }
}
```

**Test**: jump 시 기대되는 session이 null로 초기화되는지. SIGUSR1 핸들러 경로도 유사하게.

**주의**: `harness skip <phase>` (현 phase 강제 통과)는 phase status만 'completed'로 바꾸며 backward 이동이 아니므로 session 무효화 대상이 아니다. 다만 skip 이후 이전 phase로 돌아오는 jump가 발생하면 §4.9 규칙이 적용된다.

### 4.10 Jump race 시 Verdict 반영 방지

기존 코드는 `src/phases/runner.ts`의 gate handler(`runGatePhase` 직후 약 line 352)에서 error 결과일 때만 `state.currentPhase !== phase`를 체크해 redirect 처리하고(line 415 근처), verdict 결과일 때는 체크 없이 바로 반영한다. 이는 다음 race를 열어둔다:

1. Gate 2 실행 중 Codex 리뷰 진행
2. 사용자 SIGUSR1 jump → `state.currentPhase` 변경
3. Gate 2가 APPROVE verdict 반환
4. gate handler가 state.phases['2']='completed'로 덮어쓰고 다음 phase로 진행 → jump 의도 덮어씀

**규칙**: `runGatePhase`가 반환된 직후, verdict/error를 반영하기 **전에** `state.currentPhase === phase`를 확인한다. 불일치면 stale 결과로 취급하고 반영 없이 즉시 return.

**구현 위치**: `src/phases/runner.ts`의 gate dispatch 함수(현재 `handleGatePhase` 근처, runGatePhase 호출 직후). 현재 error 경로에만 있는 redirect guard를 verdict 경로에도 공통으로 앞쪽에 배치:

```ts
const result = await runGatePhase(phase, state, harnessDir, runDir, cwd, sidecarReplayAllowed);

// NEW: redirect guard — verdict/error 어느 쪽이든 stale이면 반영 안 함
if (state.currentPhase !== phase) {
  printInfo(`Phase ${phase} interrupted by control signal → phase ${state.currentPhase}`);
  renderControlPanel(state);
  return;
}

if (result.type === 'verdict') { /* 기존 처리 */ }
else { /* 기존 error 처리 — redirect guard는 위로 이동했으니 여기서는 중복 제거 */ }
```

**Test**: gate runner mock이 SIGUSR1 jump를 중간에 시뮬레이트하고, verdict 반환 시 gate handler가 verdict를 반영하지 않는지 (state.phases, currentPhase 둘 다 변하지 않음) 확인.

## 5. Harness Resume 및 크래시 복구와의 상호작용

| 시나리오 | 동작 |
|----------|------|
| Gate 2 호출 완료 (success/timeout/error) 후 state persist → crash → `harness resume` | `state.phaseCodexSessions['2']`에 id가 persist됨. 재진입한 __inner가 같은 runId로 state 로드 → sidecar replay가 실패하거나 존재하지 않으면 runGatePhase가 다시 호출 → 저장된 id로 resume 시도 → Codex 디스크에 세션이 살아있으면 이어서, 없으면 fallback. |
| Gate 2 호출 중 Codex가 sessionId 찍은 **직후** + runGatePhase가 state 저장 **전** crash → `harness resume` | sessionId 유실 → `phaseCodexSessions['2']`는 null 상태 → 재호출 시 fresh spawn. 정확성 영향 없음, 최적화 이득만 포기. 의도된 tradeoff (§2 해소된 모호성). |
| Gate 2 reject 후 Claude가 spec 수정 중 crash → resume | 같음. Phase 1(interactive)로 돌아가 있을 것이고, 완료 후 Gate 2 재호출 시 저장된 id로 resume. |
| Gate 2 approve 후 Gate 4 진입 중 crash → resume | Gate 4는 `phaseCodexSessions['4'] = null` 상태로 시작 → fresh spawn. Gate 2의 세션 id는 state에 남지만 사용되지 않음. |
| 장기간 방치 후 resume (예: Codex 세션 만료) | `state.phaseCodexSessions[phase]`에 lineage는 있지만 디스크에서 세션이 사라짐 → `codex exec resume <id>` 실패(category=session_missing) → `runCodexGate`가 closure를 호출해 `assembleGatePrompt`로 fresh 프롬프트 조립(REVIEWER_CONTRACT 자동 포함, 크기 체크 자동 수행) → fresh 호출. 새 sessionId가 state에 저장됨. |

## 6. 테스트 전략

### 6.1 단위 테스트

- **`assembleGateResumePrompt`** 신규 함수:
  - Phase 2/4/7 각각 필요한 섹션만 포함되는지
  - 변형 A (`lastOutcome === 'reject'`, previousFeedback 전달됨): "The artifacts have been updated based on your previous feedback" 섹션 포함, `## Your Previous Feedback` 블록 포함
  - 변형 B (`lastOutcome === 'error'`, previousFeedback 빈 문자열): "The previous review turn did not complete" 메시지, `## Your Previous Feedback` 블록 **미포함**
  - Stale feedback 시나리오: `gate-N-feedback.md`가 디스크에 존재하지만 `session.lastOutcome === 'error'`일 때, 변형 B가 선택되고 feedback 파일 내용은 프롬프트에 포함되지 않는지
  - REVIEWER_CONTRACT가 **포함되지 않는지** (resume 세션 중복 방지 검증, 두 변형 모두)
  - 크기 제한(MAX_PROMPT_SIZE_KB) 적용 확인
- **`migrateState`**: 기존 state.json(phaseCodexSessions 없음)을 로드했을 때 기본값이 주입되는지
- **`extractCodexMetadata`**: 이미 테스트되어 있음. 변경 없음.

### 6.2 Runner 테스트

Codex CLI는 모킹이 어려우므로, `src/runners/codex.ts`의 테스트는 기존 패턴(child_process.spawn 모킹)을 따른다.

- `resumeSessionId` 파라미터가 주어졌을 때 `codex exec resume <id>` 인자로 전달되는지
- 정상 resume 시 `resumedFrom: <id>` 반환, `resumeFallback`이 false 또는 미설정
- Resume 실패 카테고리별 분류:
  - stderr에 "session not found" → category = `session_missing` → closure 호출되어 `assembleGatePrompt` 결과로 fresh 호출 → `resumeFallback: true` + 결과에 새 `codexSessionId` (또는 fresh도 실패 시 `resumeFallback: true`인 error)
  - stderr에 일반 에러 → category = `nonzero_exit_other` → fallback 없음, error 반환
  - Timeout 트리거 → category = `timeout` → fallback 없음, error 반환
- 모든 종료 경로에서 stdout의 `codexSessionId`가 `GateError`에도 포함되는지 (timeout, nonzero, success_no_verdict 포함)

### 6.3 통합 테스트

- Mock runner(`runCodexGate`를 MSW처럼 swap)를 써서 `runGatePhase`의 선택 로직 검증:
  - 첫 호출: `resumeSessionId = undefined` + 전체 프롬프트
  - 반환값 sessionId가 state에 저장
  - 둘째 호출: `resumeSessionId = <저장된 id>` + resume 프롬프트
  - runner='claude'일 때는 resume 로직 건너뜀 (state.phaseCodexSessions 불변)
- Sidecar replay hydration:
  - 기존 sidecar에 `codexSessionId`와 `sourcePreset`이 있고 state에는 없을 때, 현재 preset과 sourcePreset이 일치하면 hydration 발생
  - 현재 preset의 model/effort가 sourcePreset과 다르면 hydration **발생 안 함**
  - legacy sidecar (sourcePreset 필드 없음)는 hydration 발생 안 함 (보수적)
- Jump/SIGUSR1 invalidation (feedback 파일은 건드리지 않음):
  - `jump targetPhase=3` (online, SIGUSR1 경로) → `phaseCodexSessions['4']`, `['7']`이 null로 초기화. `['2']`는 유지. **모든 `gate-N-feedback.md` 파일은 건드리지 않음**
  - `jump targetPhase=1` (online) → 모두 null. feedback 파일 유지
  - Offline jump → resume 경로: `pending-action.json`이 jump action을 담은 상태에서 `consumePendingAction` 적용 시 동일 invalidation (feedback 파일 유지). `pendingAction.feedbackPaths`의 파일이 여전히 읽을 수 있는지 확인
  - skip phase는 session 무효화 대상 아님
- Preset 변경 invalidation (feedback 파일은 건드리지 않음): session만 null, feedback 파일 유지
- Runtime lineage 호환성 체크 (defense-in-depth, preset mismatch만 커버):
  - state에 `{ model: codex-high }` 세션이 저장된 상태에서 `preset.effort`가 `medium`으로 변경된 뒤 invalidation 훅이 호출되지 않은 경우(simulated miss)에도, `runGatePhase`가 resume 경로를 타지 않고 fresh spawn으로 전환되는지
  - 빈 문자열/whitespace sessionId는 저장/resume 대상이 아닌지 (migration 및 runtime 모두에서 검증)
- SIGUSR1 jump race:
  - Gate가 실행 중이고 Codex가 sessionId를 반환한 직후, `state.currentPhase`가 SIGUSR1로 다른 값으로 바뀐 상태라면, §4.4 step 6이 sessionId를 저장하지 않고 스킵하는지 확인 (stillActivePhase 가드)
  - §4.10 verdict 반영 guard: gate가 APPROVE를 반환해도 `state.currentPhase !== phase`이면 gate handler가 `state.phases`를 업데이트하지 않고 다음 phase로 진행하지 않는지 (jump 의도가 유지됨)
  - Sidecar replay compatibility gate: preset이 변경된 후 resume하면, legacy sidecar(`sourcePreset` 없음) 또는 불일치하는 sourcePreset의 sidecar가 replay되지 않고 live 실행으로 진행하는지
- Session_missing fallback 상태 관리:
  - State에 stale id가 있는 상태에서 session_missing 감지 → 먼저 id를 null로 clear → fresh fallback 수행 → 성공 시 새 id 저장
  - Fresh fallback도 실패(sessionId 없이 error)한 경우 → state에 dead id 남지 않고 null 상태 유지 (다음 retry는 fresh spawn)
- Preset 변경 시 session 무효화:
  - Gate 2 Codex 세션이 저장된 상태에서 preset을 `codex-high` → `codex-medium`으로 교체 → `phaseCodexSessions['2']`이 null로 초기화
  - Gate 2 Codex 세션이 저장된 상태에서 preset을 Codex → Claude로 교체 → `phaseCodexSessions['2']`이 null
  - 같은 preset으로 "교체" (no-op) 시 세션 유지
  - 다른 phase의 세션은 영향받지 않음

### 6.4 엔드-투-엔드 (수동 또는 로깅 기반)

- `--enable-logging`으로 실제 run 실행, reject을 유도해 `gate_verdict` 이벤트에 `resumedFrom`이 기대대로 찍히는지 확인
- 듀레이션 비교: fresh vs resume의 `durationMs` 차이가 의미있게 줄어드는지 (품질 유지는 comments 내용 수동 검토)

## 7. 마이그레이션 및 호환성

- 기존 `state.json`(phaseCodexSessions 없음) → `migrateState`가 자동으로 기본값 주입. 하위 호환 보장.
- 기존 sidecar(`gate-${phase}-result.json`) 파일 포맷: `codexSessionId` 필드 이미 optional. 변경 없음.
- `--enable-logging`이 없는 run에서도 resume 최적화는 동작(상태는 state.json에 저장되므로 로깅 off와 무관).

## 8. YAGNI / 범위 밖

다음은 **이번 작업에 포함하지 않는다**:

- Codex 세션의 사용자 접근 가능한 inspect 명령(`harness codex-sessions` 같은 CLI). 필요해지면 v2.
- Phase 간 세션 공유(예: Gate 2 세션을 Gate 4에서 이어받기). 설계상 의도적으로 분리.
- 대체 gate transport(HTTP, IPC 등). Codex CLI stdin/stdout 기반 유지.
- Resume 이득의 자동 측정/리포트. 로그 필드만 추가하고 분석은 수동.
- `codex exec resume --last`로 id 없이 재개하는 경로. state에 id 저장하므로 `--last`는 불필요하고 덜 안전.
- Claude runner에도 유사 메커니즘 추가(현재 Claude `--print`는 세션 개념 노출 없음).

## 9. Open Questions (구현 시 확정)

1. **`codex exec resume` 세션 유실 에러의 정확한 문자열/exit code** — 구현 시 실존하지 않는 UUID로 호출해서 stderr/exit 패턴 확인 필요. 결과에 따라 §4.5의 `session_missing` 감지 정규식을 확정한다. 안전 기본: 패턴이 확실할 때만 매칭, 애매하면 non-match(= fallback 없음).
2. **Codex가 resume 시에도 동일 sessionId를 stdout에 찍는지, 또는 fork해서 새 id를 만드는지** — 실험으로 확인. `codexSessionId` 저장 로직이 둘 다 커버하도록 defensive하게 작성 (§4.4: "반환된 id를 늘 덮어씀"). fork라면 새 id로 갱신되어 이후 retry는 새 id로 resume.
3. **resume 중 `--model`/`effort`가 원 세션과 다른 설정으로 전달된 경우 실제 동작** — §4.8에서 preset 변경 시 session을 무효화하도록 정책을 잡았으므로, 실전에서 이 케이스는 발생하지 않는다. 단, 구현 태스크에서 확인 테스트로 1회 실행 (다른 모델로 resume이 성공하는지/에러를 뱉는지 기록)해서 향후 안전 마진 판단 자료로 남긴다.

위 세 가지는 impl plan의 첫 태스크(Codex CLI 동작 실험 태스크)에서 해소한다.
