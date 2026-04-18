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

- **Session scope = phase 단위**: `phaseCodexSessions: Record<'2'|'4'|'7', string | null>`을 `HarnessState`에 추가. 각 phase의 첫 Codex 호출에서 sessionId를 저장하고, 이후 같은 phase의 retry에서는 resume한다. 다른 phase로 넘어가면 fresh 세션.
- **Codex runner 전용**: phasePresets에서 runner가 'codex'인 gate에만 적용. 'claude' runner는 기존 동작 유지.
- **Resume 프롬프트 전략 C (사용자 승인)**: resume 호출의 프롬프트 = `updated artifacts + previous feedback`. REVIEWER_CONTRACT는 세션에 이미 있으므로 재전송하지 않는다. 아티팩트는 매 retry마다 Claude Code가 수정할 수 있으므로 full 재전송(stale 방지). 세션 이득은 Codex의 prior reasoning chain + Phase 7 파일 탐색 캐시.
- **적용 범위 = Gate 2/4/7 전체**: Phase 2/4도 세션 재사용 이득이 있음(prior reasoning, output format 확립). Phase 7이 파일 탐색 이득이 가장 크지만 2/4를 제외할 이유 없음.
- **Resume 실패 시 자동 fallback**: `codex exec resume`이 exit 0이 아닌 경우(세션 유실, 만료 등), 자동으로 fresh spawn으로 재시도한다. 사용자에게 실패로 노출하지 않음(투명한 fallback). fallback 이벤트는 로깅에 기록.
- **모델/effort 재지정 허용**: resume 호출도 `--model`, `-c model_reasoning_effort=` 플래그를 현 호출과 동일하게 넘긴다. 이는 `codex exec resume --help`로 지원 확인됨.

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
- **크래시 후 harness resume과의 상호작용은?** → `state.json`에 sessionId가 저장되어 있고 `~/.codex/sessions/`에 세션이 디스크 영속이므로, harness를 resume해도 다음 gate 호출이 정상적으로 이어진다. 세션이 Codex 측에서 사라졌다면 fallback이 처리.
- **Sidecar replay(`checkGateSidecars`)와 충돌 여부** → 없음. Sidecar replay는 **캐시된 결과를 반환**할 뿐 Codex를 호출하지 않는다. 따라서 `phaseCodexSessions` 상태를 변경하지 않는다. Replay 이후 같은 phase에서 다시 reject → retry가 발생하면 정상 resume 경로를 탄다.
- **Gate 통과 후 세션 id는?** → 유지. 현 run에서 그 phase는 더 이상 호출되지 않지만, 디버깅/감사 목적으로 state에 남겨둠. 메모리 비용 없음(문자열 하나).
- **첫 호출이 error로 끝난 경우(timeout 등) 세션 id를 저장할 것인가?** → 저장. Codex가 sessionId를 stdout에 찍었다면 세션은 시작된 것. 다음 재시도에서 resume 시도 → 실패 시 fallback.

### 구현 시 주의사항

- `runCodexGate` 시그니처에 `resumeSessionId?: string | null` 파라미터 추가. null/undefined면 fresh spawn, 값이 있으면 `codex exec resume <id> -` 경로.
- 프롬프트 조립은 `assembler.ts`에 새 함수 추가: `assembleGateResumePrompt(phase, state, cwd, previousFeedback)`. 기존 `assembleGatePrompt`는 fresh 경로 그대로 유지.
- `previousFeedback` 소스: `saveGateFeedback(runDir, phase, comments)`가 쓰는 `gate-${phase}-feedback.md`. 이전 retry에서 저장된 파일 그대로 재사용. (Phase 7 reject → Phase 5 재실행 흐름에서도 `gate-7-feedback.md`는 덮어쓰기 전까지 살아있음.)
- state migration: `migrateState`에 `phaseCodexSessions` 기본값 삽입 (`{ "2": null, "4": null, "7": null }`). 기존 state.json과 호환.
- `runGatePhase` 내부에서 resume 경로 선택 로직:
  - preset.runner === 'codex' AND `state.phaseCodexSessions[phase]` !== null → resume
  - 그 외 → fresh
  - 호출 후 반환된 `codexSessionId`를 `state.phaseCodexSessions[phase]`에 저장. 같은 id면 no-op이지만 defensive하게 늘 덮어씀.
- resume 실패 감지: `runCodexGate`는 fresh/resume 둘 중 어느 쪽이 실패했는지 알 수 있음. resume 실패 시 내부에서 자동으로 fresh를 한 번 재시도. 재시도도 실패하면 error로 반환. 이벤트 로깅에 `resumeFallback: true` 필드로 표시.
- 로깅 확장: `gate_verdict`/`gate_error` 이벤트에 `resumedFrom?: string | null`, `resumeFallback?: boolean` 필드 추가. 기존 `codexSessionId`와의 관계:
  - `resumedFrom = null` + `codexSessionId = <uuid>` → fresh spawn
  - `resumedFrom = <prev_id>` + `codexSessionId = <prev_id>` → 성공적 resume
  - `resumedFrom = <prev_id>` + `resumeFallback = true` + `codexSessionId = <new_uuid>` → resume 실패 → fresh fallback
- sidecar(`gate-${phase}-result.json`)에는 `codexSessionId`만 기록(기존 동작 유지). `resumedFrom` 등은 이벤트 로그에만.
- `runClaudeGate` 경로는 변경 없음. preset.runner !== 'codex'일 때는 `phaseCodexSessions` 읽기/쓰기도 스킵.

## 3. 현 구조 분석

### 관련 파일과 역할

| 파일 | 현 역할 | 본 작업에서의 변경 |
|------|---------|--------------------|
| `src/runners/codex.ts` | `runCodexGate`가 `codex exec`로 cold spawn | resume 파라미터 수용, resume 실패 시 fallback |
| `src/phases/gate.ts` | `runGatePhase`가 프롬프트 조립 + 러너 디스패치 + sidecar 관리 | codex runner일 때 resume id 주입, 반환된 id로 state 업데이트 |
| `src/context/assembler.ts` | `assembleGatePrompt` (fresh only) | `assembleGateResumePrompt` 추가 |
| `src/types.ts` | `HarnessState`, `GateOutcome`, `GateError` | `phaseCodexSessions` 필드, `resumedFrom`/`resumeFallback` 로그 필드 |
| `src/state.ts` | `migrateState` | `phaseCodexSessions` 기본값 추가 |
| `src/phases/runner.ts` | `handleGateReject`가 피드백 저장 + reopen | 변경 없음 (resume 선택은 runGatePhase에서) |
| `src/phases/verdict.ts` | `extractCodexMetadata`로 stdout에서 sessionId 추출 | 변경 없음 (이미 동작) |
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
  ↓ if (runner === 'codex' AND state.phaseCodexSessions[phase]):
  ↓   prompt = assembleGateResumePrompt(...)      ← updated artifacts + previous feedback
  ↓   runCodexGate(..., resumeSessionId=<id>)     ← codex exec resume <id>
  ↓ else:
  ↓   prompt = assembleGatePrompt(...)            ← 기존 full 프롬프트
  ↓   runCodexGate(..., resumeSessionId=null)     ← cold spawn
  ↓ [반환된 codexSessionId를 state.phaseCodexSessions[phase]에 저장]
  ↓ [REJECT] 동일 (handleGateReject → saveGateFeedback → reopen)
  ↓ 다음 runGatePhase 호출 → resume 경로 활성
```

## 4. 설계 상세

### 4.1 State 스키마

```ts
// src/types.ts
export interface HarnessState {
  // 기존 필드들...
  phaseCodexSessions: Record<'2' | '4' | '7', string | null>;
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
  if (raw.phaseCodexSessions[k] === undefined) raw.phaseCodexSessions[k] = null;
}
```

### 4.2 Runner 시그니처 변경

```ts
// src/runners/codex.ts
export async function runCodexGate(
  phase: number,
  preset: ModelPreset,
  prompt: string,
  harnessDir: string,
  cwd: string,
  resumeSessionId?: string | null,   // ← 신규
): Promise<GatePhaseResult> { ... }
```

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

새 함수 `assembleGateResumePrompt(phase, state, cwd, previousFeedback, retryIndex)`:

```
## Retry {retryIndex} — Updated Artifacts

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

REVIEWER_CONTRACT 전문은 **포함하지 않는다**. 세션의 첫 turn에 이미 있음.

### 4.4 Control Flow in `runGatePhase`

```ts
// src/phases/gate.ts
export async function runGatePhase(phase, state, harnessDir, runDir, cwd, allowSidecarReplay?) {
  // 1. sidecar replay (기존)
  // 2. sidecar cleanup (기존)

  // 3. Resolve preset
  const preset = getPresetById(state.phasePresets[String(phase)]);

  // 4. 프롬프트 조립 분기
  const useCodexResume =
    preset.runner === 'codex' &&
    state.phaseCodexSessions[String(phase) as '2'|'4'|'7'] !== null;

  let prompt: string;
  if (useCodexResume) {
    const feedbackPath = path.join(runDir, `gate-${phase}-feedback.md`);
    const previousFeedback = fs.existsSync(feedbackPath)
      ? fs.readFileSync(feedbackPath, 'utf-8')
      : '(feedback file missing; Claude Code may have reopened phase without feedback save)';
    const retryIndex = state.gateRetries[String(phase)];
    const result = assembleGateResumePrompt(phase, state, cwd, previousFeedback, retryIndex);
    if (typeof result !== 'string') return { type: 'error', error: result.error };
    prompt = result;
  } else {
    const result = assembleGatePrompt(phase, state, harnessDir, cwd);
    if (typeof result !== 'string') return { type: 'error', error: result.error };
    prompt = result;
  }

  // 5. Dispatch
  const resumeId = useCodexResume ? state.phaseCodexSessions[String(phase) as '2'|'4'|'7'] : null;
  const rawResult = preset.runner === 'codex'
    ? await runCodexGate(phase, preset, prompt, harnessDir, cwd, resumeId)
    : await runClaudeGate(phase, preset, prompt, harnessDir, cwd);

  // 6. 세션 id 저장 (codex runner에 한함, error/success 불문)
  if (preset.runner === 'codex' && rawResult.codexSessionId) {
    state.phaseCodexSessions[String(phase) as '2'|'4'|'7'] = rawResult.codexSessionId;
    writeState(runDir, state);
  }

  // 7. sidecar 기록, metadata 부착 (기존)
  ...
}
```

### 4.5 Resume 실패 시 Fallback

`runCodexGate` 내부:

```ts
async function runCodexGate(phase, preset, prompt, harnessDir, cwd, resumeSessionId) {
  if (!resumeSessionId) {
    return await runCodexExec(phase, preset, prompt, harnessDir, cwd, /* fresh */);
  }

  // Resume 시도
  const resumeResult = await runCodexExec(phase, preset, prompt, harnessDir, cwd, resumeSessionId);
  if (resumeResult.type === 'verdict') {
    return resumeResult;
  }

  // Resume가 error(세션 유실/만료 등)라면 → fresh spawn fallback
  // 단, 사용자 Ctrl-C나 timeout 같은 "리뷰 자체 문제"는 fallback하지 않음.
  if (isResumeSessionMissingError(resumeResult)) {
    const freshResult = await runCodexExec(phase, preset, prompt, harnessDir, cwd, /* fresh */);
    return { ...freshResult, resumeFallback: true, resumedFrom: resumeSessionId };
  }

  return resumeResult;
}
```

`isResumeSessionMissingError`: stderr 파싱으로 "session not found" 또는 그와 유사한 패턴 검사. 정확한 문자열은 구현 시 `codex exec resume <random-uuid>`로 실험해서 확정.

**중요**: fallback 시 프롬프트는 **resume용으로 조립된 것**이 그대로 쓰인다 (updated artifacts + previous feedback 포함). cold spawn은 REVIEWER_CONTRACT 없는 프롬프트를 받게 되므로, fallback 시에는 REVIEWER_CONTRACT를 prompt에 prepend한다.

구현 방법:
```ts
if (isResumeSessionMissingError(resumeResult)) {
  // Resume 프롬프트에는 REVIEWER_CONTRACT가 없으므로, fresh 호출 전에 prepend
  const freshPrompt = REVIEWER_CONTRACT + '\n' + prompt;
  const freshResult = await runCodexExec(phase, preset, freshPrompt, ...);
  ...
}
```

REVIEWER_CONTRACT를 `assembler.ts`에서 export해서 재사용.

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

변경 없음. `checkGateSidecars`는 `codexSessionId`를 이미 읽어오므로, replay 후 다음 retry에서 state의 sessionId 기반으로 resume 경로가 자연스럽게 활성화됨.

단, replay 시에는 Codex가 실제로 호출되지 않으므로 `resumedFrom`/`resumeFallback`은 replay 결과에는 포함되지 않는다 (`recoveredFromSidecar: true`만 표시).

## 5. Harness Resume 및 크래시 복구와의 상호작용

| 시나리오 | 동작 |
|----------|------|
| Gate 2 호출 중 Codex가 sessionId 찍은 후 crash → `harness resume` | `state.phaseCodexSessions['2']`에 id가 persist됨. 재진입한 __inner가 같은 runId로 state 로드 → sidecar replay가 실패하거나 존재하지 않으면 runGatePhase가 다시 호출 → 저장된 id로 resume 시도 → Codex 디스크에 세션이 살아있으면 이어서, 없으면 fallback. |
| Gate 2 reject 후 Claude가 spec 수정 중 crash → resume | 같음. Phase 1(interactive)로 돌아가 있을 것이고, 완료 후 Gate 2 재호출 시 저장된 id로 resume. |
| Gate 2 approve 후 Gate 4 진입 중 crash → resume | Gate 4는 `phaseCodexSessions['4'] = null` 상태로 시작 → fresh spawn. Gate 2의 세션 id는 state에 남지만 사용되지 않음. |
| 장기간 방치 후 resume (예: Codex 세션 만료) | `state.phaseCodexSessions[phase]`에 id는 있지만 디스크에서 사라짐 → `codex exec resume <id>` 실패 → 자동 fresh fallback. 프롬프트에 REVIEWER_CONTRACT prepend되어 올바르게 동작. |

## 6. 테스트 전략

### 6.1 단위 테스트

- **`assembleGateResumePrompt`** 신규 함수:
  - Phase 2/4/7 각각 필요한 섹션만 포함되는지
  - `previousFeedback`이 올바르게 삽입되는지
  - REVIEWER_CONTRACT가 **포함되지 않는지** (resume 세션 중복 방지 검증)
  - 크기 제한(MAX_PROMPT_SIZE_KB) 적용 확인
- **`migrateState`**: 기존 state.json(phaseCodexSessions 없음)을 로드했을 때 기본값이 주입되는지
- **`extractCodexMetadata`**: 이미 테스트되어 있음. 변경 없음.

### 6.2 Runner 테스트

Codex CLI는 모킹이 어려우므로, `src/runners/codex.ts`의 테스트는 기존 패턴(child_process.spawn 모킹)을 따른다.

- `resumeSessionId` 파라미터가 주어졌을 때 `codex exec resume <id>` 인자로 전달되는지
- resume 실패 시(mock stderr에 "session not found" 주입) fresh spawn으로 재시도되는지
- fallback 후 반환되는 `resumeFallback: true`, `resumedFrom: <prev>`
- 정상 resume 시 `resumeFallback`이 false 또는 미설정인지

### 6.3 통합 테스트

- Mock runner(`runCodexGate`를 MSW처럼 swap)를 써서 `runGatePhase`의 선택 로직 검증:
  - 첫 호출: `resumeSessionId = undefined` + 전체 프롬프트
  - 반환값 sessionId가 state에 저장
  - 둘째 호출: `resumeSessionId = <저장된 id>` + resume 프롬프트
  - runner='claude'일 때는 resume 로직 건너뜀 (state.phaseCodexSessions 불변)

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

1. **`codex exec resume` 세션 유실 에러의 정확한 문자열/exit code** — 구현 시 실존하지 않는 UUID로 호출해서 stderr/exit 패턴 확인 필요.
2. **Codex가 resume 시에도 동일 sessionId를 stdout에 찍는지, 또는 fork해서 새 id를 만드는지** — 실험으로 확인. `codexSessionId` 저장 로직이 둘 다 커버하도록 defensive하게 작성.
3. **resume 시 `--model`/`model_reasoning_effort`가 세션의 원 설정과 다르면 어떻게 동작하는지** — 본 작업에서는 phasePresets가 단일 run 내에서 불변이므로 실전에서 문제되지 않지만, edge case 문서화.

위 세 가지는 impl plan의 첫 태스크(Codex CLI 동작 실험 태스크)에서 해소한다.
