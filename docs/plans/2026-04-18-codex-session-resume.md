# Per-Phase Codex Session Resume — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**관련 문서:**
- Spec: `docs/specs/2026-04-18-codex-session-resume-design.md`
- Eval checklist: 본 문서 §Eval Checklist
- Eval report (작성 예정): `docs/process/evals/2026-04-18-codex-session-resume-eval.md`

**Goal:** Harness gate reject 루프에서 Codex 세션을 phase 단위로 재사용해 redundant cold-start을 제거한다. 동일 phase의 retry는 `codex exec resume <id>`로 이어가고, phase 간에는 격리한다.

**Architecture:** `HarnessState.phaseCodexSessions`에 각 gate phase(2/4/7)별 `GateSessionInfo` lineage 저장. `runCodexGate`가 `resumeSessionId` + `buildFreshPromptOnFallback` closure를 받아 resume 경로와 `session_missing` 카테고리 시 자동 fresh fallback을 처리. 세션 수명은 `phaseCodexSessions` null 세팅 + 관련 replay sidecar 삭제로 관리되며, preset 변경·backward jump에서 호출되는 invalidation helper가 이를 수행한다. `feedback` 파일은 reopen flow가 참조하므로 invalidation 대상이 아님.

**Tech Stack:** TypeScript (Node.js), vitest, Codex CLI 1.0.3+ (`codex exec resume` 지원), fs/child_process 동기·비동기 API.

---

## File Structure

### 신규 파일
- `tests/runners/codex-resume.test.ts` — resume/fallback/error taxonomy runner unit tests
- `tests/context/assembler-resume.test.ts` — Variant A/B 프롬프트 조립 tests
- `tests/phases/gate-resume.test.ts` — runGatePhase 경로 분기, sidecar compatibility gate tests
- `tests/state-invalidation.test.ts` — preset/jump invalidation helpers tests
- `tests/integration/codex-session-resume.test.ts` — cross-module scenarios
- `scripts/codex-resume-probe.mjs` — Task 0 pilot probe (체크인 후 로컬 실험용 — 선택적)

### 수정 파일
- `src/types.ts` — `GateSessionInfo` 추가, `HarnessState.phaseCodexSessions`, `GateResult.sourcePreset`, `GateOutcome`/`GateError`.sourcePreset/resumedFrom/resumeFallback, LogEvent 확장
- `src/state.ts` — `createInitialState` 기본값 + migration + `invalidatePhaseSessionsOnPresetChange` + `invalidatePhaseSessionsOnJump`
- `src/context/assembler.ts` — `assembleGateResumePrompt` 추가
- `src/runners/codex.ts` — `runCodexGate` 시그니처 확장, 내부 `runCodexExecRaw` + error classifier, `session_missing` fallback, 모든 종료 경로에서 metadata 추출
- `src/phases/gate.ts` — `runGatePhase` 경로 분기, sidecar replay compatibility gate, hydration 확장
- `src/phases/verdict.ts` — (변경 없음 예상, 단 `buildGateResult`에 sourcePreset 전파는 gate.ts에서 처리하므로 여기선 영향 없음)
- `src/phases/runner.ts` — verdict 경로까지 아우르는 redirect guard, gate_verdict/gate_error 이벤트에 resumedFrom/resumeFallback 전달
- `src/commands/inner.ts` — preset 교체 후 `invalidatePhaseSessionsOnPresetChange`, `consumePendingAction`의 jump 분기에 `invalidatePhaseSessionsOnJump` 호출
- `src/signal.ts` — SIGUSR1 jump 핸들러에 `invalidatePhaseSessionsOnJump` 호출
- 기존 테스트(`tests/state.test.ts`, `tests/phases/gate.test.ts`, `tests/runners/codex.test.ts`, `tests/commands/inner.test.ts`, `tests/signal.test.ts`, `tests/resume.test.ts`) — 시그니처 변경 반영

---

## Task 0: Codex CLI 동작 Pilot (pre-implementation probe)

스펙 §9 open questions 해소: 실존하지 않는 UUID로 resume 호출 시 stderr/exit 패턴, resume 후에도 stdout에 session id가 찍히는지, 모델 오버라이드가 원 세션과 달라도 동작하는지.

**Files:**
- Create: `scripts/codex-resume-probe.mjs` (optional probe script)
- Create: 본 태스크 실행 결과를 spec §9 바로 밑에 인라인 코멘트로 기록하거나, `docs/specs/2026-04-18-codex-session-resume-design.md`의 §9에 결과 서브섹션 추가

- [ ] **Step 1: fresh 호출 stdout에서 session id 추출 패턴 확인**

**중요**: pilot은 실제 repo에서 쓰는 Codex preset을 그대로 사용해야 한다. `src/config.ts`의 `codex-high`/`codex-medium`은 model=`gpt-5.4`, effort=`high`/`medium`으로 정의되어 있다 (참고: `src/config.ts:15-16`). 이 값들과 다른 preset으로 probe하면 open question의 답이 런타임과 어긋날 수 있다.

Run (fresh session으로 최소 프롬프트, 실제 preset과 일치):
```bash
echo "Say 'hello' and stop." | codex exec --model gpt-5.4 -c model_reasoning_effort="high" - 2>&1 | tee /tmp/codex-probe-fresh.txt
```
`session id:` 라인을 grep해서 UUID 형식 확인:
```bash
grep -iE "session id:\s*[0-9a-f-]+" /tmp/codex-probe-fresh.txt
```
Expected: 한 줄에 `session id: <uuid>` 형태로 출력.

**중요 — exit code 캡처 규약**: 아래 커맨드들은 `| tee`로 파이프를 통과한다. `$?`는 shell에 따라 pipeline의 **마지막** 명령(tee) exit code만 반환하므로, `codex exec`의 실제 exit code를 잘못 읽을 수 있다. 반드시 아래 중 하나를 사용:
- bash: `codex_ec="${PIPESTATUS[0]}"` (pipe 직후 즉시 읽기)
- zsh: `codex_ec="${pipestatus[1]}"` (zsh는 1-based)
- 또는 간단히 `set -o pipefail`을 세션 최상단에 두고 `$?` 읽기 (대신 pipefail은 tee 성공 여부도 고려하므로 정확한 "codex 자체의 exit code"가 필요하면 PIPESTATUS 권장)

- [ ] **Step 2: 실존 session id로 resume 호출 시 응답과 session id 패턴 확인**

위 Step 1에서 얻은 UUID를 `$SID`에 담고:
```bash
echo "Say 'world' and stop." | codex exec resume "$SID" - 2>&1 | tee /tmp/codex-probe-resume.txt
# bash
codex_ec="${PIPESTATUS[0]}"; echo "codex exit code: $codex_ec"
# zsh이면: codex_ec="${pipestatus[1]}"; echo "codex exit code: $codex_ec"
grep -iE "session id:\s*[0-9a-f-]+" /tmp/codex-probe-resume.txt
```
Expected: `codex_ec == 0`, stdout 또는 stderr에 같은 UUID 또는 새 UUID 찍힘. 결과를 §9 Q#2 (동일 id vs fork)에 반영.

- [ ] **Step 3: 존재하지 않는 UUID로 resume 호출 시 에러 패턴 확인**

```bash
echo "noop" | codex exec resume "00000000-0000-0000-0000-000000000000" - 2>&1 | tee /tmp/codex-probe-missing.txt
# bash
codex_ec="${PIPESTATUS[0]}"; echo "codex exit code: $codex_ec"
# zsh: codex_ec="${pipestatus[1]}"
```
Expected: `codex_ec`가 non-zero. stderr(`/tmp/codex-probe-missing.txt`)에 "session not found" 또는 유사 패턴이 포함됨. 이 정확한 문자열과 exit code를 §9 Q#1에 반영하여 Task 4 `session_missing` 정규식을 확정한다. **여기서 $?로만 읽으면 tee의 exit 0을 받게 되어 "exit 0인데 에러"라는 잘못된 가정이 Task 4에 전파될 위험이 있다.**

- [ ] **Step 4: 모델/effort 오버라이드 호환성 확인**

Step 1(`gpt-5.4` + effort=high)로 만든 세션을 `gpt-5.4` + effort=medium으로 resume해서 effort만 다를 때의 거동 확인:
```bash
echo "Summarize in one sentence." | codex exec resume "$SID" --model gpt-5.4 -c model_reasoning_effort="medium" - 2>&1 | tee /tmp/codex-probe-modelchange.txt
# bash: codex_ec="${PIPESTATUS[0]}"; echo "codex exit code: $codex_ec"
# zsh:  codex_ec="${pipestatus[1]}"; echo "codex exit code: $codex_ec"
```
Expected: `codex_ec == 0` 또는 document된 error. §9 Q#3에 결과 기록. 현재 spec 정책상 preset 변경 시 세션을 invalidate하므로 이 case가 런타임에 도달하지 않지만 edge case 자료로 남긴다. 두 effort(high ↔ medium) 모두 repo에서 실제로 선택 가능한 값이므로, 무효화 훅이 실패했을 때 fallback 거동을 판단하는 근거가 된다.

- [ ] **Step 5: 결과를 spec §9에 추가 (세 Q 각각 "pilot 결과" 서브-bullet)**

`docs/specs/2026-04-18-codex-session-resume-design.md`의 §9를 Edit. 각 open question 밑에 `> pilot 결과 (2026-04-18): ...` 한두 줄 요약 추가.

- [ ] **Step 6: Commit**

```bash
git add docs/specs/2026-04-18-codex-session-resume-design.md
git commit -m "docs(spec): record Codex CLI resume pilot findings in §9"
```

---

## Task 1: 타입 확장

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: `GateSessionInfo` 타입 추가**

`src/types.ts`의 `interface HarnessState` 선언 **직전**에:

```ts
export interface GateSessionInfo {
  sessionId: string;                         // non-empty, validated on save/load
  runner: 'claude' | 'codex';                // reserved — v1에서 실질 'codex'만 저장됨
  model: string;
  effort: string;
  lastOutcome: 'approve' | 'reject' | 'error';
}
```

- [ ] **Step 2: `HarnessState`에 `phaseCodexSessions` 필드 추가**

`HarnessState` interface 안, 다른 `Record<string, ...>` 필드들 주변에:

```ts
  // Per-phase Codex session resume (§4.1 of spec)
  phaseCodexSessions: Record<'2' | '4' | '7', GateSessionInfo | null>;
```

- [ ] **Step 3: `GateResult`에 `sourcePreset` 확장**

기존 `GateResult` 인터페이스에 필드 추가 (optional):

```ts
export interface GateResult {
  exitCode: number;
  timestamp: number;
  runner?: 'claude' | 'codex';
  promptBytes?: number;
  durationMs?: number;
  tokensTotal?: number;
  codexSessionId?: string;
  sourcePreset?: { model: string; effort: string };  // NEW
}
```

- [ ] **Step 4: `GateOutcome`/`GateError`에 resume 메타데이터 확장**

```ts
export interface GateOutcome {
  type: 'verdict';
  verdict: GateVerdict;
  comments: string;
  rawOutput: string;
  runner?: 'claude' | 'codex';
  promptBytes?: number;
  durationMs?: number;
  tokensTotal?: number;
  codexSessionId?: string;
  recoveredFromSidecar?: boolean;
  sourcePreset?: { model: string; effort: string };    // NEW (replay hydration)
  resumedFrom?: string | null;                          // NEW
  resumeFallback?: boolean;                             // NEW
}

export interface GateError {
  type: 'error';
  error: string;
  rawOutput?: string;
  runner?: 'claude' | 'codex';
  promptBytes?: number;
  durationMs?: number;
  exitCode?: number;
  tokensTotal?: number;
  codexSessionId?: string;
  recoveredFromSidecar?: boolean;
  sourcePreset?: { model: string; effort: string };    // NEW
  resumedFrom?: string | null;                          // NEW
  resumeFallback?: boolean;                             // NEW
}
```

- [ ] **Step 5: `LogEvent` 타입의 `gate_verdict`/`gate_error` variant에 신규 필드 추가**

기존 `gate_verdict` variant에:

```ts
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
      resumedFrom?: string | null;   // NEW
      resumeFallback?: boolean;       // NEW
    })
```

동일하게 `gate_error` variant에도:

```ts
  | (LogEventBase & {
      event: 'gate_error';
      phase: number;
      retryIndex: number;
      runner?: 'claude' | 'codex';
      error: string;
      exitCode?: number;
      durationMs?: number;
      tokensTotal?: number;
      codexSessionId?: string;
      recoveredFromSidecar?: boolean;
      resumedFrom?: string | null;   // NEW
      resumeFallback?: boolean;       // NEW
    })
```

- [ ] **Step 6: TypeScript 빌드 통과 확인**

```bash
pnpm -s tsc --noEmit
```
Expected: 에러 없음. 에러가 있으면 필드 누락이나 오타 확인.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add GateSessionInfo and resume-related metadata fields"
```

---

## Task 2: state.ts — 초기값, migration, invalidation helpers

**Files:**
- Modify: `src/state.ts`
- Create: `tests/state-invalidation.test.ts`

- [ ] **Step 1: `createInitialState`에 `phaseCodexSessions` 기본값 추가**

`createInitialState` 함수의 return 객체에, 다른 Record 필드들 주변에:

```ts
    phaseCodexSessions: { '2': null, '4': null, '7': null },
```

- [ ] **Step 2: `migrateState`에 `phaseCodexSessions` 호환 처리 추가**

`migrateState` 함수 body 끝부분(기존 `phaseReopenSource` 처리 아래)에:

```ts
  if (!raw.phaseCodexSessions || typeof raw.phaseCodexSessions !== 'object') {
    raw.phaseCodexSessions = { '2': null, '4': null, '7': null };
  }
  for (const k of ['2', '4', '7'] as const) {
    const v = raw.phaseCodexSessions[k];
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
      raw.phaseCodexSessions[k] = null;
    }
  }
```

- [ ] **Step 3: 실패하는 invalidation 테스트 작성**

`tests/state-invalidation.test.ts` 생성:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  invalidatePhaseSessionsOnPresetChange,
  invalidatePhaseSessionsOnJump,
} from '../src/state.js';
import type { HarnessState, GateSessionInfo } from '../src/types.js';

function makeSession(model: string, effort: string): GateSessionInfo {
  return { sessionId: 'abc-123', runner: 'codex', model, effort, lastOutcome: 'reject' };
}

function makeState(): HarnessState {
  // 테스트용 최소 state — 실제 스키마의 미사용 필드는 any 캐스트
  return {
    phasePresets: {
      '2': 'codex-high',
      '4': 'codex-high',
      '7': 'codex-high',
    },
    phaseCodexSessions: {
      '2': makeSession('gpt-5.4', 'high'),
      '4': makeSession('gpt-5.4', 'high'),
      '7': makeSession('gpt-5.4', 'high'),
    },
  } as unknown as HarnessState;
}

function makeRunDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-inv-'));
}

function touch(runDir: string, filename: string) {
  fs.writeFileSync(path.join(runDir, filename), 'x');
}

function exists(runDir: string, filename: string): boolean {
  return fs.existsSync(path.join(runDir, filename));
}

describe('invalidatePhaseSessionsOnPresetChange', () => {
  it('nulls session when preset model changes for same runner', () => {
    const state = makeState();
    const prev = { '2': 'codex-high', '4': 'codex-high', '7': 'codex-high' };
    state.phasePresets['2'] = 'codex-medium';
    const runDir = makeRunDir();
    invalidatePhaseSessionsOnPresetChange(state, prev, runDir);
    expect(state.phaseCodexSessions['2']).toBeNull();
    expect(state.phaseCodexSessions['4']).not.toBeNull();
  });

  it('nulls session when runner changes from codex to claude', () => {
    const state = makeState();
    const prev = { '2': 'codex-high', '4': 'codex-high', '7': 'codex-high' };
    state.phasePresets['4'] = 'sonnet-high';
    const runDir = makeRunDir();
    invalidatePhaseSessionsOnPresetChange(state, prev, runDir);
    expect(state.phaseCodexSessions['4']).toBeNull();
    expect(state.phaseCodexSessions['2']).not.toBeNull();
  });

  it('keeps session when preset unchanged (no-op)', () => {
    const state = makeState();
    const prev = { '2': 'codex-high', '4': 'codex-high', '7': 'codex-high' };
    const runDir = makeRunDir();
    invalidatePhaseSessionsOnPresetChange(state, prev, runDir);
    expect(state.phaseCodexSessions['2']).not.toBeNull();
    expect(state.phaseCodexSessions['4']).not.toBeNull();
    expect(state.phaseCodexSessions['7']).not.toBeNull();
  });

  it('deletes replay sidecars but preserves feedback file on invalidation', () => {
    const state = makeState();
    const runDir = makeRunDir();
    touch(runDir, 'gate-2-raw.txt');
    touch(runDir, 'gate-2-result.json');
    touch(runDir, 'gate-2-error.md');
    touch(runDir, 'gate-2-feedback.md');
    const prev = { '2': 'codex-high', '4': 'codex-high', '7': 'codex-high' };
    state.phasePresets['2'] = 'codex-medium';
    invalidatePhaseSessionsOnPresetChange(state, prev, runDir);
    expect(exists(runDir, 'gate-2-raw.txt')).toBe(false);
    expect(exists(runDir, 'gate-2-result.json')).toBe(false);
    expect(exists(runDir, 'gate-2-error.md')).toBe(false);
    expect(exists(runDir, 'gate-2-feedback.md')).toBe(true);
  });
});

describe('invalidatePhaseSessionsOnJump', () => {
  it('nulls sessions for gate phases >= targetPhase only', () => {
    const state = makeState();
    const runDir = makeRunDir();
    invalidatePhaseSessionsOnJump(state, 3, runDir);
    expect(state.phaseCodexSessions['2']).not.toBeNull();
    expect(state.phaseCodexSessions['4']).toBeNull();
    expect(state.phaseCodexSessions['7']).toBeNull();
  });

  it('deletes replay sidecars but preserves feedback file on jump', () => {
    const state = makeState();
    const runDir = makeRunDir();
    touch(runDir, 'gate-7-raw.txt');
    touch(runDir, 'gate-7-result.json');
    touch(runDir, 'gate-7-feedback.md');
    invalidatePhaseSessionsOnJump(state, 5, runDir);
    expect(exists(runDir, 'gate-7-raw.txt')).toBe(false);
    expect(exists(runDir, 'gate-7-result.json')).toBe(false);
    expect(exists(runDir, 'gate-7-feedback.md')).toBe(true);
  });
});
```

- [ ] **Step 4: 테스트 실행 → 실패 확인 (함수 미구현)**

```bash
pnpm -s vitest run tests/state-invalidation.test.ts
```
Expected: "invalidatePhaseSessionsOnPresetChange is not a function" 류 에러.

- [ ] **Step 5: `invalidatePhaseSessionsOnPresetChange` 구현**

`src/state.ts` 상단 import에 `getPresetById` 추가(없다면):

```ts
import { PHASE_DEFAULTS, REQUIRED_PHASE_KEYS, MODEL_PRESETS, getPresetById } from './config.js';
```

파일 끝에 다음 함수 추가:

```ts
/**
 * Invalidate stored Codex gate sessions when user changes phase preset mid-run.
 * Deletes replay sidecars to prevent sidecar replay from bypassing invalidation.
 * Feedback file (gate-N-feedback.md) is preserved — reopen flow depends on it.
 */
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
      for (const filename of [`gate-${phase}-raw.txt`, `gate-${phase}-result.json`, `gate-${phase}-error.md`]) {
        try { fs.unlinkSync(path.join(runDir, filename)); } catch { /* ignore missing */ }
      }
    }
  }
}
```

필요한 import (`path`)가 이미 상단에 있으면 재사용, 없으면 추가.

- [ ] **Step 6: `invalidatePhaseSessionsOnJump` 구현**

`src/state.ts` 파일 끝에:

```ts
/**
 * Invalidate Codex gate sessions for phases >= targetPhase on backward jump.
 * Deletes replay sidecars to prevent sidecar replay after jump.
 * Feedback file preserved — reopen flow dependency.
 */
export function invalidatePhaseSessionsOnJump(
  state: HarnessState,
  targetPhase: number,
  runDir: string,
): void {
  for (const phase of [2, 4, 7] as const) {
    if (phase >= targetPhase) {
      state.phaseCodexSessions[String(phase) as '2' | '4' | '7'] = null;
      for (const filename of [`gate-${phase}-raw.txt`, `gate-${phase}-result.json`, `gate-${phase}-error.md`]) {
        try { fs.unlinkSync(path.join(runDir, filename)); } catch { /* ignore missing */ }
      }
    }
  }
}
```

- [ ] **Step 7: 테스트 재실행 → 통과 확인**

```bash
pnpm -s vitest run tests/state-invalidation.test.ts
```
Expected: 6 passed.

- [ ] **Step 8: 기존 state 테스트 migration 케이스 업데이트**

`tests/state.test.ts`에서 `createInitialState` 또는 `migrateState` 테스트 블록이 있으면 `phaseCodexSessions` 기본값 / legacy state 호환 케이스 추가:

```ts
it('migrateState sets default phaseCodexSessions for legacy state', () => {
  const legacy = {
    /* ...existing legacy fixture without phaseCodexSessions... */
  };
  const migrated = migrateState(legacy as any);
  expect(migrated.phaseCodexSessions).toEqual({ '2': null, '4': null, '7': null });
});

it('migrateState discards malformed GateSessionInfo entries', () => {
  const legacy = {
    /* ... */
    phaseCodexSessions: {
      '2': { sessionId: '', runner: 'codex', model: 'x', effort: 'high', lastOutcome: 'reject' },
      '4': null,
      '7': { sessionId: 'abc', runner: 'codex', model: 'x', effort: 'high', lastOutcome: 'invalid' },
    },
  };
  const migrated = migrateState(legacy as any);
  expect(migrated.phaseCodexSessions['2']).toBeNull(); // empty sessionId → null
  expect(migrated.phaseCodexSessions['7']).toBeNull(); // invalid lastOutcome → null
});

// §5 상호작용 요구사항: graceful 종료 경로에서 저장된 세션 lineage가 디스크 round-trip을
// 통과해 `harness resume`에서 동일 값으로 복원되어야 한다.
it('phaseCodexSessions survives writeState → readState round-trip (§5)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-persist-'));
  const state = createInitialState('run-xyz', { /* ...필수 필드 채우기... */ } as any);
  state.phaseCodexSessions['2'] = {
    sessionId: 'sess-gate2-uuid',
    runner: 'codex',
    model: 'gpt-5.4',
    effort: 'high',
    lastOutcome: 'reject',
  };
  state.phaseCodexSessions['7'] = {
    sessionId: 'sess-gate7-uuid',
    runner: 'codex',
    model: 'gpt-5.4',
    effort: 'high',
    lastOutcome: 'approve',
  };
  writeState(dir, state);
  const restored = readState(dir);
  expect(restored.phaseCodexSessions['2']).toEqual(state.phaseCodexSessions['2']);
  expect(restored.phaseCodexSessions['4']).toBeNull();
  expect(restored.phaseCodexSessions['7']).toEqual(state.phaseCodexSessions['7']);
});

// §5 in-flight crash 시나리오: Codex가 sessionId를 stdout에 찍었지만 state 저장 전에
// 크래시하면 phaseCodexSessions[phase]는 null이어야 하고, 다음 resume은 fresh 경로를 탄다.
// 여기서는 state 레벨 invariant만 검증 (fresh spawn 선택은 runGatePhase 테스트 영역).
it('fresh state has phaseCodexSessions=null for all gates (in-flight crash invariant)', () => {
  const state = createInitialState('run-abc', { /* ...필수 필드 채우기... */ } as any);
  expect(state.phaseCodexSessions).toEqual({ '2': null, '4': null, '7': null });
});
```

위 테스트는 기존 `writeState`/`readState`를 그대로 사용하므로 Task 1/2 구현만으로 통과한다. 이로써 §5의 "graceful 경로 persist"와 "in-flight crash → fresh fallback" 두 시나리오의 **상태 레이어 계약**이 회귀 방지된다.

- [ ] **Step 9: 전체 state 테스트 통과 확인**

```bash
pnpm -s vitest run tests/state.test.ts tests/state-invalidation.test.ts
```
Expected: all passed.

- [ ] **Step 10: Commit**

```bash
git add src/state.ts tests/state.test.ts tests/state-invalidation.test.ts
git commit -m "feat(state): add phaseCodexSessions and invalidation helpers"
```

---

## Task 3: assembler.ts — assembleGateResumePrompt (Variant A/B)

**Files:**
- Modify: `src/context/assembler.ts`
- Create: `tests/context/assembler-resume.test.ts`

- [ ] **Step 1: 실패하는 resume prompt 테스트 작성**

`tests/context/assembler-resume.test.ts` 생성:

```ts
import { describe, it, expect } from 'vitest';
import { assembleGateResumePrompt } from '../../src/context/assembler.js';
import type { HarnessState } from '../../src/types.js';

function makeState(overrides: Partial<HarnessState> = {}): HarnessState {
  // 최소 state — test에 필요한 필드만 채움.
  // 주의: `assembleGateResumePrompt`는 artifact 파일을 `path.join(cwd, filePath)`로 resolve한다.
  // test에서 `cwd = 'tests/context/fixtures'`로 지정하므로, artifact 경로는 fixtures 디렉토리
  // 내부의 **상대** 경로(= bare 파일명)여야 실제 파일을 찾는다. 'fixtures/spec.md'로 두면
  // `tests/context/fixtures/fixtures/spec.md`를 찾다가 놓치고 "(file not found ...)" placeholder로
  // fallthrough — 테스트가 실질 로딩을 검증하지 못한다.
  return {
    runId: 'r1',
    artifacts: {
      spec: 'spec.md',
      plan: 'plan.md',
      evalReport: 'eval.md',
      decisionLog: '.harness/r1/decisions.md',
      checklist: '.harness/r1/checklist.json',
    },
    baseCommit: 'abc',
    implCommit: null,
    evalCommit: null,
    verifiedAtHead: null,
    externalCommitsDetected: false,
    ...overrides,
  } as unknown as HarnessState;
}

describe('assembleGateResumePrompt — Variant A (reject)', () => {
  it('includes updated artifacts and previous feedback', () => {
    const cwd = 'tests/context/fixtures'; // 테스트용 실존 fixture 경로
    const state = makeState();
    const res = assembleGateResumePrompt(2, state, cwd, 'reject', 'P1: fix X\nP1: fix Y');
    expect(typeof res).toBe('string');
    if (typeof res === 'string') {
      expect(res).toMatch(/Updated Artifacts \(Re-Review Requested\)/);
      expect(res).toMatch(/previous feedback/i);
      expect(res).toMatch(/P1: fix X/);
      // Fixture 파일이 **실제로 로드**되었는지 검증 — placeholder fallback 회피:
      // fixtures/spec.md는 Step 2에서 "# Spec\ncontent\n"으로 생성되므로, 프롬프트에 "content"가 있어야 한다.
      // 경로 mismatch로 `(file not found ...)` placeholder가 뿌려지면 이 어설션이 실패한다.
      expect(res).toMatch(/# Spec[\s\S]*content/);
      expect(res).not.toMatch(/file not found/i);
      // REVIEWER_CONTRACT 전문은 포함 안 함
      expect(res).not.toMatch(/You are an independent technical reviewer/);
    }
  });
});

describe('assembleGateResumePrompt — Variant B (error or approve)', () => {
  it('omits previous feedback block for error outcome', () => {
    const cwd = 'tests/context/fixtures';
    const state = makeState();
    const res = assembleGateResumePrompt(2, state, cwd, 'error', '');
    expect(typeof res).toBe('string');
    if (typeof res === 'string') {
      expect(res).toMatch(/Continue Review/);
      expect(res).not.toMatch(/Your Previous Feedback/);
      expect(res).not.toMatch(/You are an independent technical reviewer/);
    }
  });

  it('treats approve as Variant B for safety', () => {
    const cwd = 'tests/context/fixtures';
    const state = makeState();
    const res = assembleGateResumePrompt(4, state, cwd, 'approve', '');
    expect(typeof res).toBe('string');
    if (typeof res === 'string') {
      expect(res).toMatch(/Continue Review/);
      expect(res).not.toMatch(/Your Previous Feedback/);
    }
  });
});
```

Fixtures 디렉토리와 파일이 없으면 Step 2에서 생성.

- [ ] **Step 2: 테스트 fixture 생성**

```bash
mkdir -p tests/context/fixtures
printf '# Spec\ncontent\n' > tests/context/fixtures/spec.md
printf '# Plan\ncontent\n' > tests/context/fixtures/plan.md
printf '# Eval\ncontent\n' > tests/context/fixtures/eval.md
```

- [ ] **Step 3: 테스트 실행 → 실패 확인 (함수 미구현)**

```bash
pnpm -s vitest run tests/context/assembler-resume.test.ts
```
Expected: `assembleGateResumePrompt is not a function` 류 에러.

- [ ] **Step 4: `assembleGateResumePrompt` 구현**

`src/context/assembler.ts` 파일의 `assembleGatePrompt` 함수 **위**에 (REVIEWER_CONTRACT는 기존 export 없음이지만 resume 경로는 포함 안 하므로 상관없음):

```ts
function buildResumeSectionsPhase2(state: HarnessState, cwd: string): string | { error: string } {
  const spec = readArtifactContent(state.artifacts.spec, cwd);
  if ('error' in spec) return spec;
  return `<spec>\n${spec.content}\n</spec>\n`;
}

function buildResumeSectionsPhase4(state: HarnessState, cwd: string): string | { error: string } {
  const spec = readArtifactContent(state.artifacts.spec, cwd);
  if ('error' in spec) return spec;
  const plan = readArtifactContent(state.artifacts.plan, cwd);
  if ('error' in plan) return plan;
  return `<spec>\n${spec.content}\n</spec>\n\n<plan>\n${plan.content}\n</plan>\n`;
}

function buildResumeSectionsPhase7(state: HarnessState, cwd: string): string | { error: string } {
  // phase 7은 기존 assembleGatePrompt의 buildGatePromptPhase7 로직을 재활용.
  // 차이점: REVIEWER_CONTRACT가 프롬프트 본문에 포함되지 않음. 여기서는 아티팩트 + diff + metadata만.
  const spec = readArtifactContent(state.artifacts.spec, cwd);
  if ('error' in spec) return spec;
  const plan = readArtifactContent(state.artifacts.plan, cwd);
  if ('error' in plan) return plan;
  const evalRep = readArtifactContent(state.artifacts.evalReport, cwd);
  if ('error' in evalRep) return evalRep;
  // diff + metadata는 기존 buildGatePromptPhase7과 동일 로직 (중복 제거 위해 헬퍼 분리 권장).
  // v1에서는 복붙 허용, 이후 리팩토링 태스크.
  let diffSection: string;
  let externalSummary = '';
  if (state.externalCommitsDetected) {
    let primary = '';
    if (state.implCommit !== null) {
      primary += runGit(`git diff ${state.baseCommit}...${state.implCommit}`, cwd);
      if (state.evalCommit !== null) {
        primary += '\n' + runGit(`git diff ${state.evalCommit}^..${state.evalCommit}`, cwd);
      }
    } else {
      const target = state.evalCommit ?? 'HEAD';
      primary = runGit(`git diff ${state.baseCommit}...${target}`, cwd);
      primary =
        `⚠️ IMPORTANT: Phase 5 was skipped and external commits were detected. ` +
        `Focus on the eval report and spec/plan compliance rather than the diff.\n\n` + primary;
    }
    const maxDiffBytes = MAX_DIFF_SIZE_KB * 1024;
    if (primary.length > maxDiffBytes) {
      primary = truncateDiffPerFile(primary, PER_FILE_DIFF_LIMIT_KB * 1024);
    }
    diffSection = `<diff>\n${primary}\n</diff>\n`;
    const anchor = state.evalCommit ?? state.implCommit ?? state.baseCommit;
    const externalLog = runGit(`git log ${anchor}..HEAD --oneline`, cwd);
    if (externalLog.trim().length > 0) {
      externalSummary = `\n## External Commits (not reviewed)\n\n\`\`\`\n${externalLog}\n\`\`\`\n`;
    }
  } else {
    let diff = runGit(`git diff ${state.baseCommit}...HEAD`, cwd);
    const maxDiffBytes = MAX_DIFF_SIZE_KB * 1024;
    if (diff.length > maxDiffBytes) {
      diff = truncateDiffPerFile(diff, PER_FILE_DIFF_LIMIT_KB * 1024);
    }
    diffSection = diff ? `<diff>\n${diff}\n</diff>\n` : '';
  }
  const externalNote = state.externalCommitsDetected
    ? `Note: External commits detected. See '## External Commits (not reviewed)' section below.\nPrimary diff covers harness implementation range only.\n`
    : '';
  const implRange = state.implCommit !== null
    ? `Harness implementation range: ${state.baseCommit}..${state.implCommit} (Phase 1–5 commits).`
    : `Phase 5 skipped; no implementation commit anchor.`;
  const metadata = `<metadata>\n${externalNote}${implRange}\nHarness eval report commit: ${state.evalCommit ?? '(none)'} (the commit that last modified the eval report).\nVerified at HEAD: ${state.verifiedAtHead ?? '(none)'} (most recent Phase 6 run).\nFocus review on changes within the harness ranges above.\n</metadata>\n`;
  return (
    `<spec>\n${spec.content}\n</spec>\n\n` +
    `<plan>\n${plan.content}\n</plan>\n\n` +
    `<eval_report>\n${evalRep.content}\n</eval_report>\n\n` +
    diffSection + externalSummary + '\n' + metadata
  );
}

/**
 * Assemble resume prompt for an already-open Codex gate session (§4.3 of spec).
 * Variant A (lastOutcome='reject'): updated artifacts + previous feedback.
 * Variant B (lastOutcome='error' | 'approve'): continuation without feedback block.
 * REVIEWER_CONTRACT is NOT included (already in session first turn).
 */
export function assembleGateResumePrompt(
  phase: 2 | 4 | 7,
  state: HarnessState,
  cwd: string,
  lastOutcome: 'approve' | 'reject' | 'error',
  previousFeedback: string,
): string | { error: string } {
  const artifacts =
    phase === 2 ? buildResumeSectionsPhase2(state, cwd)
    : phase === 4 ? buildResumeSectionsPhase4(state, cwd)
    : buildResumeSectionsPhase7(state, cwd);
  if (typeof artifacts !== 'string') return artifacts;

  let prompt: string;
  if (lastOutcome === 'reject') {
    prompt =
      `## Updated Artifacts (Re-Review Requested)\n\n` +
      `The artifacts have been updated based on your previous feedback. Re-review the new versions and verify your prior concerns were addressed.\n\n` +
      artifacts + '\n' +
      `## Your Previous Feedback (for reference)\n\n${previousFeedback}\n\n` +
      `## Instructions\n\nReturn a verdict in the same structured format you used before (## Verdict / ## Comments / ## Summary). APPROVE only if zero P0/P1 findings, and especially verify whether your prior P0/P1 concerns have been addressed.\n`;
  } else {
    // Variant B (error or approve safety-fallback)
    prompt =
      `## Continue Review\n\n` +
      `The previous review turn did not complete. Here are the artifacts to review (unchanged from the prior turn, unless modifications occurred in the interim):\n\n` +
      artifacts + '\n' +
      `## Instructions\n\nReturn a verdict in the same structured format you used before (## Verdict / ## Comments / ## Summary).\n`;
  }

  if (prompt.length > MAX_PROMPT_SIZE_KB * 1024) {
    return { error: `Assembled gate resume prompt too large: ${Math.round(prompt.length / 1024)}KB > ${MAX_PROMPT_SIZE_KB}KB limit` };
  }
  return prompt;
}
```

- [ ] **Step 5: 테스트 재실행 → 통과 확인**

```bash
pnpm -s vitest run tests/context/assembler-resume.test.ts
```
Expected: 3 passed.

- [ ] **Step 6: 기존 assembler 회귀 확인**

```bash
pnpm -s vitest run tests/context/
```
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/context/assembler.ts tests/context/assembler-resume.test.ts tests/context/fixtures/
git commit -m "feat(assembler): add assembleGateResumePrompt with Variant A/B"
```

---

## Task 4: runners/codex.ts — resume path, error taxonomy, fallback

**Files:**
- Modify: `src/runners/codex.ts`
- Create: `tests/runners/codex-resume.test.ts`

- [ ] **Step 1: `runCodexGate` 시그니처 확장 + 내부 refactor**

`src/runners/codex.ts` 상단에 내부 헬퍼 타입 정의:

```ts
type RawExecCategory =
  | 'success_verdict'     // exit 0, stdout에 ## Verdict 존재
  | 'success_no_verdict'  // exit 0인데 ## Verdict 없음 (리뷰 품질 문제)
  | 'session_missing'     // resume 대상 세션을 찾을 수 없음 (fallback 트리거)
  | 'timeout'
  | 'spawn_error'
  | 'nonzero_exit_other';

interface RawExecResult {
  category: RawExecCategory;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  codexSessionId?: string;
  tokensTotal?: number;
}
```

기존 `runCodexGate`를 내부 헬퍼 `runCodexExecRaw`와 공개 래퍼로 분리.

- [ ] **Step 2: `isResumeSessionMissingError` 구현 (Task 0 결과 반영)**

Task 0 Step 3에서 기록된 실제 stderr 문자열을 기반으로 정규식 확정. 초기 보수적 패턴:

```ts
function isResumeSessionMissingError(stderr: string): boolean {
  // Task 0 pilot 결과에 따라 갱신. 기본 보수적 패턴.
  // 다수의 파악된 표현을 |로 엮되, 너무 넓게 잡지 않음 (오탐 시 cost 낭비).
  return /session\s+(not\s+found|missing|expired|does\s+not\s+exist|unknown)/i.test(stderr)
      || /no\s+such\s+session/i.test(stderr);
}
```

- [ ] **Step 3: `runCodexExecRaw` 내부 헬퍼 구현**

기존 gate `spawn` 로직을 이 함수로 옮기고 metadata 추출 + category 분류 포함. 공개 API (`runCodexGate`)는 뒤에 래퍼로 재구성.

```ts
import { parseVerdict, extractCodexMetadata } from '../phases/verdict.js';

interface RawExecInput {
  mode: 'fresh' | 'resume';
  sessionId?: string;   // mode === 'resume'일 때 required
  prompt: string;
  preset: ModelPreset;
  harnessDir: string;
  cwd: string;
  phase: number;        // lock 갱신 등에 사용
}

async function runCodexExecRaw(input: RawExecInput): Promise<RawExecResult> {
  const codexBin = resolveCodexBin();
  // 주의: `codex exec resume`의 인자 순서는 `[SESSION_ID] [PROMPT]`가 positional (spec §2 CLI 계약).
  // sessionId를 '--model' 같은 플래그 뒤에 두면 CLI가 flag value로 오인하거나 parser 에러가 날 수 있다.
  // 반드시 'resume' 직후 sessionId → 플래그들 → prompt placeholder(`-`) 순서를 지킨다.
  const args = input.mode === 'resume'
    ? ['exec', 'resume', input.sessionId!,
       '--model', input.preset.model,
       '-c', `model_reasoning_effort="${input.preset.effort}"`,
       '-']
    : ['exec',
       '--model', input.preset.model,
       '-c', `model_reasoning_effort="${input.preset.effort}"`,
       '-'];

  const child = spawn(codexBin, args, { stdio: ['pipe', 'pipe', 'pipe'], detached: true, cwd: input.cwd });
  const childPid = child.pid!;
  const startTime = getProcessStartTime(childPid);
  updateLockChild(input.harnessDir, childPid, input.phase, startTime);

  child.stdin.write(input.prompt);
  child.stdin.end();

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on('data', (c: Buffer) => stdoutChunks.push(c));
  child.stderr.on('data', (c: Buffer) => {
    stderrChunks.push(c);
    const text = c.toString();
    for (const line of text.split('\n')) {
      if (line.includes('[codex]')) process.stderr.write(`  ${line}\n`);
    }
  });

  // Promise: close/timeout/error 모든 경로에서 metadata 추출 후 resolve
  const finishResult = await new Promise<{
    exitCode: number | null; spawnError?: string; timedOut?: boolean;
  }>((resolve) => {
    let settled = false;
    const timeout = setTimeout(async () => {
      if (settled) return; settled = true;
      await killProcessGroup(childPid, SIGTERM_WAIT_MS);
      resolve({ exitCode: null, timedOut: true });
    }, GATE_TIMEOUT_MS);
    child.on('close', (code) => {
      if (settled) return; settled = true;
      clearTimeout(timeout);
      resolve({ exitCode: code ?? 1 });
    });
    child.on('error', (err) => {
      if (settled) return; settled = true;
      clearTimeout(timeout);
      resolve({ exitCode: null, spawnError: err.message });
    });
  });
  await killProcessGroup(childPid, SIGTERM_WAIT_MS);
  try { clearLockChild(input.harnessDir); } catch { /* best-effort */ }

  const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
  const stderr = Buffer.concat(stderrChunks).toString('utf-8');
  const meta = extractCodexMetadata(stdout);

  let category: RawExecCategory;
  if (finishResult.spawnError) category = 'spawn_error';
  else if (finishResult.timedOut) category = 'timeout';
  else if (finishResult.exitCode !== 0) {
    category = input.mode === 'resume' && isResumeSessionMissingError(stderr)
      ? 'session_missing'
      : 'nonzero_exit_other';
  } else {
    category = parseVerdict(stdout) !== null ? 'success_verdict' : 'success_no_verdict';
  }

  return {
    category,
    exitCode: finishResult.exitCode,
    stdout,
    stderr,
    codexSessionId: meta.codexSessionId,
    tokensTotal: meta.tokensTotal,
  };
}
```

- [ ] **Step 4: 공개 `runCodexGate` 래퍼 재작성**

기존 구현을 다음으로 교체:

```ts
export async function runCodexGate(
  phase: number,
  preset: ModelPreset,
  prompt: string,
  harnessDir: string,
  cwd: string,
  resumeSessionId?: string | null,
  buildFreshPromptOnFallback?: () => string | { error: string },
): Promise<GatePhaseResult> {
  const phaseState = { current: resumeSessionId ? 'resume' as const : 'fresh' as const };

  const first = await runCodexExecRaw({
    mode: resumeSessionId ? 'resume' : 'fresh',
    sessionId: resumeSessionId ?? undefined,
    prompt, preset, harnessDir, cwd, phase,
  });

  // session_missing → fresh fallback
  if (first.category === 'session_missing') {
    if (!buildFreshPromptOnFallback) {
      return rawToError(first, `session_missing but no fallback prompt builder provided`, {
        resumedFrom: resumeSessionId ?? null,
        resumeFallback: false,
        preset,
      });
    }
    const promptOrError = buildFreshPromptOnFallback();
    if (typeof promptOrError !== 'string') {
      return {
        type: 'error',
        error: promptOrError.error,
        rawOutput: first.stdout,
        runner: 'codex',
        durationMs: undefined,
        tokensTotal: first.tokensTotal,
        codexSessionId: first.codexSessionId,
        sourcePreset: { model: preset.model, effort: preset.effort },
        resumedFrom: resumeSessionId ?? null,
        resumeFallback: true,
      };
    }
    const fresh = await runCodexExecRaw({
      mode: 'fresh', prompt: promptOrError, preset, harnessDir, cwd, phase,
    });
    return rawToResult(fresh, preset, /* resumedFrom */ resumeSessionId ?? null, /* resumeFallback */ true);
  }

  return rawToResult(first, preset, resumeSessionId ?? null, /* resumeFallback */ false);
}

function rawToResult(
  raw: RawExecResult,
  preset: ModelPreset,
  resumedFrom: string | null,
  resumeFallback: boolean,
): GatePhaseResult {
  if (raw.category === 'success_verdict') {
    const parsed = parseVerdict(raw.stdout)!;
    return {
      type: 'verdict',
      verdict: parsed.verdict,
      comments: parsed.comments,
      rawOutput: raw.stdout,
      runner: 'codex',
      codexSessionId: raw.codexSessionId,
      tokensTotal: raw.tokensTotal,
      sourcePreset: { model: preset.model, effort: preset.effort },
      resumedFrom,
      resumeFallback,
    };
  }
  // 그 외 모두 error 취급
  const msg =
    raw.category === 'timeout' ? `Codex gate timed out after ${GATE_TIMEOUT_MS}ms` :
    raw.category === 'spawn_error' ? `Codex spawn error` :
    raw.category === 'success_no_verdict' ? `Gate output missing ## Verdict header` :
    `Gate subprocess exited with code ${raw.exitCode ?? -1}`;
  return rawToError(raw, msg, { resumedFrom, resumeFallback, preset });
}

function rawToError(
  raw: RawExecResult,
  message: string,
  opts: { resumedFrom: string | null; resumeFallback: boolean; preset: ModelPreset },
): GatePhaseResult {
  return {
    type: 'error',
    error: message,
    rawOutput: raw.stdout,
    runner: 'codex',
    exitCode: raw.exitCode ?? undefined,
    codexSessionId: raw.codexSessionId,
    tokensTotal: raw.tokensTotal,
    sourcePreset: { model: opts.preset.model, effort: opts.preset.effort },
    resumedFrom: opts.resumedFrom,
    resumeFallback: opts.resumeFallback,
  };
}
```

기존 `runCodexInteractive`는 변경 없음 (gate 전용 작업).

- [ ] **Step 5: 실패하는 runner 테스트 작성 (mocked spawn)**

`tests/runners/codex-resume.test.ts` 생성:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { runCodexGate } from '../../src/runners/codex.js';
import { GATE_TIMEOUT_MS, type ModelPreset } from '../../src/config.js';

// child_process.spawn을 모킹해 args/stdout/stderr/exitCode를 제어
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, spawn: vi.fn(), execSync: vi.fn(() => '/usr/local/bin/codex') };
});

function makeMockChild(opts: {
  stdout?: string; stderr?: string; exitCode?: number; delayMs?: number;
  /** true면 data emit은 하되 'close' 이벤트를 영원히 발생시키지 않음 — timeout 경로 테스트용 */
  neverClose?: boolean;
}): any {
  const emitter: any = new EventEmitter();
  emitter.stdin = { write: vi.fn(), end: vi.fn() };
  emitter.stdout = new EventEmitter();
  emitter.stderr = new EventEmitter();
  emitter.pid = 12345;
  setTimeout(() => {
    if (opts.stdout) emitter.stdout.emit('data', Buffer.from(opts.stdout));
    if (opts.stderr) emitter.stderr.emit('data', Buffer.from(opts.stderr));
    if (!opts.neverClose) emitter.emit('close', opts.exitCode ?? 0);
  }, opts.delayMs ?? 5);
  return emitter;
}

const preset: ModelPreset = { id: 'codex-high', runner: 'codex', model: 'gpt-5.4', effort: 'high', label: 'codex-high' };

const SUCCESS_STDOUT = `session id: abc-session-123\n## Verdict\nAPPROVE\n\n## Comments\n\n## Summary\nAll good.\ntokens used\n1234\n`;

afterEach(() => { vi.clearAllMocks(); });

describe('runCodexGate — fresh path', () => {
  it('spawns codex exec without resume when no sessionId passed', async () => {
    const cp = await import('child_process');
    (cp.spawn as any).mockImplementationOnce(() => makeMockChild({ stdout: SUCCESS_STDOUT }));
    const result = await runCodexGate(2, preset, 'prompt', '/tmp/h', '/tmp/c');
    expect(result.type).toBe('verdict');
    if (result.type === 'verdict') {
      expect(result.codexSessionId).toBe('abc-session-123');
      expect(result.resumedFrom).toBeNull();
      expect(result.resumeFallback).toBe(false);
      expect(result.sourcePreset).toEqual({ model: 'gpt-5.4', effort: 'high' });
    }
    // 첫 호출 args에 'resume'이 **포함되지 않아야**
    const args = (cp.spawn as any).mock.calls[0][1] as string[];
    expect(args).not.toContain('resume');
  });
});

describe('runCodexGate — resume path', () => {
  it('spawns codex exec resume <sessionId> when resumeSessionId provided', async () => {
    const cp = await import('child_process');
    (cp.spawn as any).mockImplementationOnce(() => makeMockChild({ stdout: SUCCESS_STDOUT.replace('abc-session-123', 'same-session') }));
    const result = await runCodexGate(2, preset, 'prompt', '/tmp/h', '/tmp/c', 'same-session');
    expect(result.type).toBe('verdict');
    if (result.type === 'verdict') {
      expect(result.resumedFrom).toBe('same-session');
      expect(result.resumeFallback).toBe(false);
    }
    const args = (cp.spawn as any).mock.calls[0][1] as string[];
    expect(args).toContain('resume');
    expect(args).toContain('same-session');
  });
});

describe('runCodexGate — session_missing fallback', () => {
  it('falls back to fresh spawn when resume fails with session_missing stderr', async () => {
    const cp = await import('child_process');
    // 1st call: resume fails with session not found
    (cp.spawn as any).mockImplementationOnce(() =>
      makeMockChild({ stderr: 'error: session not found\n', exitCode: 1 })
    );
    // 2nd call: fresh succeeds
    (cp.spawn as any).mockImplementationOnce(() =>
      makeMockChild({ stdout: SUCCESS_STDOUT.replace('abc-session-123', 'new-session') })
    );
    const freshPromptBuilder = () => 'fresh prompt body';
    const result = await runCodexGate(
      2, preset, 'resume prompt', '/tmp/h', '/tmp/c', 'dead-session', freshPromptBuilder
    );
    expect(result.type).toBe('verdict');
    if (result.type === 'verdict') {
      expect(result.resumedFrom).toBe('dead-session');
      expect(result.resumeFallback).toBe(true);
      expect(result.codexSessionId).toBe('new-session');
    }
    // 두 번째 spawn args는 'resume' 없음
    const args2 = (cp.spawn as any).mock.calls[1][1] as string[];
    expect(args2).not.toContain('resume');
  });

  it('does NOT fall back on nonzero_exit_other (non-session-missing stderr)', async () => {
    const cp = await import('child_process');
    (cp.spawn as any).mockImplementationOnce(() =>
      makeMockChild({ stderr: 'error: generic failure\n', exitCode: 1 })
    );
    const result = await runCodexGate(
      2, preset, 'resume prompt', '/tmp/h', '/tmp/c', 'some-session', () => 'fresh'
    );
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.resumeFallback).toBe(false);
    }
  });

  // 주의: `category`는 `src/runners/codex.ts` 내부 타입(§4.5)이며 외부 반환 타입에는 노출되지 않는다.
  // 따라서 관찰 가능한 신호(error type, error message, resumeFallback flag, spawn 호출 수)만 assert한다.
  it('does NOT fall back on timeout (관찰 가능한 신호로 검증, no second spawn)', async () => {
    vi.useFakeTimers();
    try {
      const cp = await import('child_process');
      (cp.spawn as any).mockImplementationOnce(() =>
        // exit/close 이벤트를 영원히 보내지 않는 child
        makeMockChild({ stdout: '', neverClose: true })
      );
      const pending = runCodexGate(
        2, preset, 'resume prompt', '/tmp/h', '/tmp/c', 'some-session', () => 'fresh'
      );
      // GATE_TIMEOUT_MS 초과 시점까지 시계를 전진
      await vi.advanceTimersByTimeAsync(GATE_TIMEOUT_MS + 1000);
      const result = await pending;
      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.resumeFallback).toBe(false);
        // §4.5 rawToResult: timeout 카테고리는 `Codex gate timed out after ${GATE_TIMEOUT_MS}ms` 메시지로 투영
        expect(result.error).toMatch(/timed out/i);
      }
      // 두 번째 spawn이 호출되지 않음 (fallback 미발생)
      expect((cp.spawn as any).mock.calls.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT fall back on success_no_verdict (exit 0이지만 ## Verdict 헤더 없음)', async () => {
    const cp = await import('child_process');
    (cp.spawn as any).mockImplementationOnce(() =>
      makeMockChild({
        stdout: `session id: live-session\ntokens used\n10\n\nReviewer replied but never emitted a Verdict header.\n`,
        exitCode: 0,
      })
    );
    const result = await runCodexGate(
      2, preset, 'resume prompt', '/tmp/h', '/tmp/c', 'live-session', () => 'fresh'
    );
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.resumeFallback).toBe(false);
      // §4.5 rawToResult: success_no_verdict은 "Gate output missing ## Verdict header" 메시지로 투영
      expect(result.error).toMatch(/missing ## Verdict header/i);
      // sessionId는 stdout에서 추출되어 유지 (fallback은 아니지만 감사 목적)
      expect(result.codexSessionId).toBe('live-session');
    }
    // 두 번째 spawn 없음 — success_no_verdict은 "리뷰 자체 문제"로 fallback 아님
    expect((cp.spawn as any).mock.calls.length).toBe(1);
  });
});

describe('runCodexGate — metadata on error paths', () => {
  it('captures sessionId and tokensTotal on nonzero exit', async () => {
    const cp = await import('child_process');
    (cp.spawn as any).mockImplementationOnce(() =>
      makeMockChild({
        stdout: `session id: partial-sid\ntokens used\n42\n`,
        stderr: 'some error\n',
        exitCode: 1,
      })
    );
    const result = await runCodexGate(2, preset, 'prompt', '/tmp/h', '/tmp/c');
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.codexSessionId).toBe('partial-sid');
      expect(result.tokensTotal).toBe(42);
    }
  });
});
```

- [ ] **Step 6: 테스트 실행 → 통과 확인**

```bash
pnpm -s vitest run tests/runners/codex-resume.test.ts
```
Expected: 주요 케이스 통과. Timeout 케이스는 별도 타임아웃 주입 필요 시 `vi.useFakeTimers()` 추가.

- [ ] **Step 7: 기존 codex runner 테스트 회귀 확인**

```bash
pnpm -s vitest run tests/runners/
```
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/runners/codex.ts tests/runners/codex-resume.test.ts
git commit -m "feat(runners/codex): add resume + session_missing fallback"
```

---

## Task 5: phases/gate.ts — 경로 분기, sidecar replay compatibility gate

**Files:**
- Modify: `src/phases/gate.ts`
- Create: `tests/phases/gate-resume.test.ts`

**TDD 순서 (테스트 먼저)**:

- [ ] **Step 1 (TDD): 실패하는 gate-resume 테스트 파일 먼저 작성**

아래 Step 8에 정의된 테스트 내용을 `tests/phases/gate-resume.test.ts`로 먼저 생성하고 실행.

```bash
pnpm -s vitest run tests/phases/gate-resume.test.ts
```
Expected: 다수 테스트가 implementation 없음으로 실패 (함수 미존재 또는 기존 구현 mismatch).

이후 구현 단계로 진행.

- [ ] **Step 2: `checkGateSidecars`에 `sourcePreset` hydration 추가**

`src/phases/gate.ts`의 `checkGateSidecars` 함수 내 metadata 블록에 한 줄 추가:

```ts
  const metadata = {
    runner: gateResult.runner,
    promptBytes: gateResult.promptBytes,
    durationMs: gateResult.durationMs,
    tokensTotal: gateResult.tokensTotal,
    codexSessionId: gateResult.codexSessionId,
    sourcePreset: gateResult.sourcePreset,  // NEW
  };
```

- [ ] **Step 3: `runGatePhase`에서 sidecar replay compatibility gate 구현**

`runGatePhase`의 Step 1 sidecar replay 블록을 교체:

```ts
  // Step 1: One-shot sidecar replay
  if (allowSidecarReplay && allowSidecarReplay.value) {
    allowSidecarReplay.value = false;
    const replay = checkGateSidecars(runDir, phase);
    if (replay !== null) {
      const currentPreset = getPresetById(state.phasePresets[String(phase)]);

      // (A) Replay-level compatibility gate
      const replayCompatible = (
        currentPreset !== undefined &&
        replay.runner !== undefined &&
        replay.runner === currentPreset.runner &&
        (
          replay.runner === 'claude'
            ? true
            : (replay.sourcePreset !== undefined &&
               replay.sourcePreset.model === currentPreset.model &&
               replay.sourcePreset.effort === currentPreset.effort)
        )
      );

      if (replayCompatible) {
        // (B) Hydration gate
        const canHydrate =
          replay.codexSessionId !== undefined &&
          replay.runner === 'codex' &&
          state.phaseCodexSessions[String(phase) as '2'|'4'|'7'] === null &&
          currentPreset!.runner === 'codex' &&
          replay.sourcePreset !== undefined &&
          replay.sourcePreset.model === currentPreset!.model &&
          replay.sourcePreset.effort === currentPreset!.effort;

        if (canHydrate) {
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
      }
      // replayCompatible === false → fall through to live execution path
    }
  }
```

상단 import에 `getPresetById` 추가(아직 없다면).

- [ ] **Step 4: `runGatePhase` 경로 분기 구현 (resume vs fresh)**

`runGatePhase`의 기존 Step 3-5(assemble prompt + dispatch)를 다음으로 교체:

```ts
  // Step 3: Resolve preset
  const presetId = state.phasePresets[String(phase)];
  const preset = getPresetById(presetId);
  if (!preset) {
    return { type: 'error', error: `Unknown preset for phase ${phase}: ${presetId}` };
  }

  // Step 4: Resume-compatibility check + prompt assembly
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

  // Defense-in-depth: 비호환이면 저장된 세션 null 처리
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
    const resumeRes = assembleGateResumePrompt(phase, state, cwd, session.lastOutcome, previousFeedback);
    if (typeof resumeRes !== 'string') return { type: 'error', error: resumeRes.error };
    prompt = resumeRes;
  } else {
    const result = assembleGatePrompt(phase, state, harnessDir, cwd);
    if (typeof result === 'object' && 'error' in result) {
      return { type: 'error', error: result.error };
    }
    prompt = result as string;
  }

  const promptBytes = Buffer.byteLength(prompt, 'utf8');
  const resumeId = useCodexResume ? (savedSession as GateSessionInfo).sessionId : null;

  // Step 5: Dispatch
  const runner = preset.runner;
  const runStartedAt = Date.now();
  const rawResult = runner === 'claude'
    ? await runClaudeGate(phase, preset, prompt, harnessDir, cwd)
    : await runCodexGate(
        phase, preset, prompt, harnessDir, cwd, resumeId,
        () => {
          if (state.currentPhase !== phase) {
            return { error: `phase ${phase} stale (currentPhase=${state.currentPhase})` };
          }
          return assembleGatePrompt(phase, state, harnessDir, cwd);
        },
      );
  const durationMs = Date.now() - runStartedAt;

  const result: GatePhaseResult = { ...rawResult, runner, promptBytes, durationMs };
```

`GateSessionInfo` import 추가 필요 (`src/types.ts`에서).

- [ ] **Step 5: Step 6(세션 저장) 추가**

Dispatch 이후, sidecar 쓰기 전에:

```ts
  // Step 6: Save session lineage if still on active phase
  const stillActivePhase = state.currentPhase === phase;
  if (preset.runner === 'codex' && stillActivePhase) {
    if (result.resumeFallback) {
      state.phaseCodexSessions[String(phase) as '2'|'4'|'7'] = null;
    }
    const newId = result.codexSessionId;
    if (typeof newId === 'string' && newId.trim().length > 0) {
      const lastOutcome: 'approve' | 'reject' | 'error' =
        result.type === 'verdict'
          ? (result.verdict === 'APPROVE' ? 'approve' : 'reject')
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
```

- [ ] **Step 5: Step 5(기존 sidecar 쓰기)를 sourcePreset 포함으로 갱신**

기존 `const gateResult: GateResult = { ... }`에서 `sourcePreset` 필드 추가:

```ts
  const gateResult: GateResult = {
    exitCode,
    timestamp: Date.now(),
    runner,
    promptBytes,
    durationMs,
    ...(result.tokensTotal !== undefined ? { tokensTotal: result.tokensTotal } : {}),
    ...(result.codexSessionId !== undefined ? { codexSessionId: result.codexSessionId } : {}),
    ...(runner === 'codex'
      ? { sourcePreset: { model: preset.model, effort: preset.effort } }
      : {}),
  };
```

- [ ] **Step 6: 실패하는 gate-resume 테스트 작성**

`tests/phases/gate-resume.test.ts` 생성:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { runGatePhase } from '../../src/phases/gate.js';
import type { HarnessState, GatePhaseResult } from '../../src/types.js';

vi.mock('../../src/runners/codex.js');
vi.mock('../../src/runners/claude.js');

import { runCodexGate } from '../../src/runners/codex.js';

function makeState(): HarnessState {
  return {
    runId: 'r1',
    currentPhase: 2,
    phasePresets: { '2': 'codex-high', '4': 'codex-high', '7': 'codex-high' },
    phaseCodexSessions: { '2': null, '4': null, '7': null },
    artifacts: { spec: '.harness/r1/spec.md', plan: '.harness/r1/plan.md', evalReport: '.harness/r1/eval.md', decisionLog: '.harness/r1/decisions.md', checklist: '.harness/r1/checklist.json' },
    gateRetries: { '2': 0, '4': 0, '7': 0 },
    /* ...minimally cast */
  } as unknown as HarnessState;
}

let runDir: string;
beforeEach(() => {
  runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-gate-'));
  // fixture spec/plan/eval 파일 준비
  const dir = path.join(runDir, '.harness/r1'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'spec.md'), '# Spec');
  fs.writeFileSync(path.join(dir, 'plan.md'), '# Plan');
  fs.writeFileSync(path.join(dir, 'eval.md'), '# Eval');
});
afterEach(() => { vi.clearAllMocks(); });

function mockVerdict(overrides: Partial<GatePhaseResult> = {}): GatePhaseResult {
  return {
    type: 'verdict', verdict: 'REJECT', comments: 'P1', rawOutput: 'session id: sess-1\n## Verdict\nREJECT',
    runner: 'codex', codexSessionId: 'sess-1',
    sourcePreset: { model: 'gpt-5.4', effort: 'high' },
    resumedFrom: null, resumeFallback: false,
    ...overrides,
  } as GatePhaseResult;
}

describe('runGatePhase — first call (fresh)', () => {
  it('calls runCodexGate without resumeSessionId and saves new session', async () => {
    const state = makeState();
    (runCodexGate as any).mockResolvedValueOnce(mockVerdict());
    const res = await runGatePhase(2, state, runDir, runDir, runDir);
    expect(res.type).toBe('verdict');
    expect((runCodexGate as any).mock.calls[0][5]).toBeNull(); // resumeSessionId
    expect(state.phaseCodexSessions['2']).toEqual({
      sessionId: 'sess-1', runner: 'codex', model: 'gpt-5.4', effort: 'high', lastOutcome: 'reject',
    });
  });
});

describe('runGatePhase — second call (resume)', () => {
  it('passes stored sessionId on compatible preset', async () => {
    const state = makeState();
    state.phaseCodexSessions['2'] = {
      sessionId: 'sess-1', runner: 'codex', model: 'gpt-5.4', effort: 'high', lastOutcome: 'reject',
    };
    (runCodexGate as any).mockResolvedValueOnce(
      mockVerdict({ verdict: 'APPROVE', resumedFrom: 'sess-1', codexSessionId: 'sess-1' })
    );
    await runGatePhase(2, state, runDir, runDir, runDir);
    expect((runCodexGate as any).mock.calls[0][5]).toBe('sess-1');
  });
});

describe('runGatePhase — incompatible session', () => {
  it('nulls saved session and uses fresh path when model differs', async () => {
    const state = makeState();
    state.phaseCodexSessions['2'] = {
      sessionId: 'sess-1', runner: 'codex', model: 'old-model', effort: 'high', lastOutcome: 'reject',
    };
    (runCodexGate as any).mockResolvedValueOnce(mockVerdict());
    await runGatePhase(2, state, runDir, runDir, runDir);
    expect((runCodexGate as any).mock.calls[0][5]).toBeNull();
  });
});

describe('runGatePhase — resumeFallback clears stale id', () => {
  it('clears stale id when fallback fires with no new id', async () => {
    const state = makeState();
    state.phaseCodexSessions['2'] = {
      sessionId: 'stale', runner: 'codex', model: 'gpt-5.4', effort: 'high', lastOutcome: 'reject',
    };
    (runCodexGate as any).mockResolvedValueOnce({
      type: 'error', error: 'fallback failed', runner: 'codex',
      resumedFrom: 'stale', resumeFallback: true, codexSessionId: undefined,
    });
    await runGatePhase(2, state, runDir, runDir, runDir);
    expect(state.phaseCodexSessions['2']).toBeNull();
  });
});

describe('runGatePhase — stillActivePhase guard', () => {
  it('skips session persist if currentPhase changed during call', async () => {
    const state = makeState();
    (runCodexGate as any).mockImplementationOnce(async (...args: any[]) => {
      state.currentPhase = 3; // simulate SIGUSR1 jump during call
      return mockVerdict({ codexSessionId: 'should-not-save' });
    });
    await runGatePhase(2, state, runDir, runDir, runDir);
    expect(state.phaseCodexSessions['2']).toBeNull();
  });
});

// §4.7 two-stage replay compatibility gate — 4 scenarios:
// (1) compatible Codex sidecar → replay accepted + hydration into phaseCodexSessions
// (2) mismatched sourcePreset → replay skipped, live path taken
// (3) legacy sidecar (no metadata) → replay skipped (authoritative gate blocks unknown-lineage replay)
// (4) Claude sidecar → runner-only compatibility accepted, but no hydration (Claude ≠ codex)
describe('runGatePhase — sidecar replay compatibility gate (§4.7)', () => {
  // Helper to write a fake sidecar pair consumed by checkGateSidecars.
  function writeSidecar(
    phase: 2 | 4 | 7,
    result: { verdict?: 'APPROVE' | 'REJECT'; runner: 'claude' | 'codex';
              codexSessionId?: string;
              sourcePreset?: { model: string; effort: string } },
  ) {
    const raw = `session id: ${result.codexSessionId ?? 'sc-sid'}\n## Verdict\n${result.verdict ?? 'APPROVE'}\n`;
    fs.writeFileSync(path.join(runDir, `gate-${phase}-raw.txt`), raw);
    fs.writeFileSync(
      path.join(runDir, `gate-${phase}-result.json`),
      JSON.stringify({
        exitCode: 0, timestamp: Date.now(),
        runner: result.runner,
        codexSessionId: result.codexSessionId,
        sourcePreset: result.sourcePreset,
      }),
    );
  }

  it('(1) compatible Codex sidecar: replay accepted, hydrates phaseCodexSessions', async () => {
    const state = makeState();
    writeSidecar(2, {
      verdict: 'REJECT', runner: 'codex', codexSessionId: 'side-sid',
      sourcePreset: { model: 'gpt-5.4', effort: 'high' },
    });
    // state.phasePresets[2] = 'codex-high' per makeState; getPresetById resolves to gpt-5.4/high
    const res = await runGatePhase(2, state, runDir, runDir, runDir);
    // runCodexGate는 호출되지 않아야 함 (replay hit)
    expect((runCodexGate as any).mock.calls.length).toBe(0);
    expect(res.type).toBe('verdict');
    // Hydration 확인
    expect(state.phaseCodexSessions['2']).toEqual({
      sessionId: 'side-sid', runner: 'codex', model: 'gpt-5.4', effort: 'high',
      lastOutcome: 'reject',
    });
  });

  it('(2) mismatched sourcePreset: replay skipped, live path taken', async () => {
    const state = makeState();
    writeSidecar(2, {
      verdict: 'APPROVE', runner: 'codex', codexSessionId: 'mismatch-sid',
      sourcePreset: { model: 'some-other-model', effort: 'high' },
    });
    (runCodexGate as any).mockResolvedValueOnce(mockVerdict({ codexSessionId: 'live-sid' }));
    await runGatePhase(2, state, runDir, runDir, runDir);
    // Live path 탔는지 확인
    expect((runCodexGate as any).mock.calls.length).toBe(1);
    // Hydration은 일어나지 않고, live 결과로 저장
    expect(state.phaseCodexSessions['2']?.sessionId).toBe('live-sid');
  });

  it('(3) legacy sidecar (no runner/sourcePreset metadata): replay skipped', async () => {
    const state = makeState();
    // metadata 없는 legacy sidecar
    fs.writeFileSync(path.join(runDir, 'gate-2-raw.txt'), 'session id: legacy\n## Verdict\nAPPROVE\n');
    fs.writeFileSync(
      path.join(runDir, 'gate-2-result.json'),
      JSON.stringify({ exitCode: 0, timestamp: Date.now() }),
    );
    (runCodexGate as any).mockResolvedValueOnce(mockVerdict({ codexSessionId: 'live-sid' }));
    await runGatePhase(2, state, runDir, runDir, runDir);
    // replay skip → live spawn
    expect((runCodexGate as any).mock.calls.length).toBe(1);
    expect(state.phaseCodexSessions['2']?.sessionId).toBe('live-sid');
  });

  it('(4) Claude sidecar with matching runner: replay accepted, no codex hydration', async () => {
    const state = makeState();
    // Claude runner 로 교체
    state.phasePresets['2'] = 'sonnet-high';
    writeSidecar(2, {
      verdict: 'APPROVE', runner: 'claude',
      // Claude는 sourcePreset 검증 대상 아님
    });
    const res = await runGatePhase(2, state, runDir, runDir, runDir);
    // runCodexGate 미호출 (Claude replay hit)
    expect((runCodexGate as any).mock.calls.length).toBe(0);
    expect(res.type).toBe('verdict');
    // Claude replay는 phaseCodexSessions hydrate 대상 아님
    expect(state.phaseCodexSessions['2']).toBeNull();
  });
});
```

- [ ] **Step 7: 테스트 실행 → 통과 확인**

```bash
pnpm -s vitest run tests/phases/gate-resume.test.ts
```
Expected: 5 passed.

- [ ] **Step 8: 기존 gate 테스트 회귀 확인 (+ 필요시 시그니처 갱신)**

```bash
pnpm -s vitest run tests/phases/gate.test.ts
```
시그니처 충돌이 있으면 기존 테스트 업데이트 (예: `runCodexGate` 모킹이 새 시그니처 따르도록).

- [ ] **Step 9: Commit**

```bash
git add src/phases/gate.ts tests/phases/gate-resume.test.ts tests/phases/gate.test.ts
git commit -m "feat(gate): add resume path dispatch and sidecar compatibility gate"
```

---

## Task 6: phases/runner.ts — verdict redirect guard + 로그 필드 전달

**Files:**
- Modify: `src/phases/runner.ts`
- Modify: `tests/phases/runner.test.ts` (시그니처 반영 + 신규 테스트)

- [ ] **Step 1: gate dispatch 함수에서 redirect guard를 verdict/error 공통으로 이동**

`src/phases/runner.ts`의 gate dispatch 함수(예: `runGateDispatch` 또는 `runPhase2/4/7Dispatch`에서 `runGatePhase` 호출 직후)를 찾아 구조 변경:

**변경 전 (개념)**:
```ts
const result = await runGatePhase(...);
if (result.type === 'verdict') { ... }
else {
  if (state.currentPhase !== phase) { ...redirect... }
  ...
}
```

**변경 후**:
```ts
const result = await runGatePhase(...);
if (state.currentPhase !== phase) {
  printInfo(`Phase ${phase} interrupted by control signal → phase ${state.currentPhase}`);
  renderControlPanel(state);
  return;
}
if (result.type === 'verdict') { ... }
else { /* error 처리 — redirect guard는 위로 이동 */ ... }
```

(실제 라인 번호는 현재 파일 구조에 따라 다름. `runGatePhase(` 호출 지점을 grep으로 찾아 주변 10줄을 수정.)

- [ ] **Step 2: `gate_verdict`/`gate_error` 이벤트 payload에 `resumedFrom`/`resumeFallback` 전달**

기존 `logger.logEvent({ event: 'gate_verdict', ... })` 호출 지점을 찾아 신규 필드 추가:

```ts
logger.logEvent({
  event: 'gate_verdict',
  phase,
  retryIndex,
  runner: result.runner!,
  verdict: result.verdict,
  durationMs: result.durationMs,
  tokensTotal: result.tokensTotal,
  promptBytes: result.promptBytes,
  codexSessionId: result.codexSessionId,
  recoveredFromSidecar: result.recoveredFromSidecar ?? false,
  resumedFrom: result.resumedFrom,
  resumeFallback: result.resumeFallback,
});
```

`gate_error` 경로에도 동일 패턴 적용.

- [ ] **Step 3a: 실제 logger의 `events.jsonl` 직렬화 검증 테스트 추가 (§4.6 end-to-end)**

Mocked logger가 아니라 **실제 `src/logger.ts`의 `SessionLogger`**가 디스크에 쓴 JSON line에 `resumedFrom`/`resumeFallback` 필드가 정상 직렬화되는지 확인. `tests/logger.test.ts`에 추가(기존 파일이 있음 — 없으면 신설):

```ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SessionLogger } from '../src/logger.js';

describe('SessionLogger — §4.6 resume log fields', () => {
  it('serializes resumedFrom and resumeFallback into events.jsonl', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-log-'));
    const logger = new SessionLogger(dir, 'run-1');
    logger.logEvent({
      event: 'gate_verdict',
      phase: 2,
      retryIndex: 0,
      runner: 'codex',
      verdict: 'APPROVE',
      codexSessionId: 'new-uuid',
      resumedFrom: 'dead-uuid',
      resumeFallback: true,
    } as any);
    logger.logEvent({
      event: 'gate_error',
      phase: 2,
      retryIndex: 0,
      runner: 'codex',
      error: 'Codex gate timed out after 360000ms',
      codexSessionId: 'partial-uuid',
      resumedFrom: 'prev-uuid',
      resumeFallback: false,
    } as any);

    const lines = fs
      .readFileSync(path.join(dir, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    const verdictLine = lines.find((l) => l.event === 'gate_verdict');
    const errorLine = lines.find((l) => l.event === 'gate_error');

    expect(verdictLine.resumedFrom).toBe('dead-uuid');
    expect(verdictLine.resumeFallback).toBe(true);
    expect(errorLine.resumedFrom).toBe('prev-uuid');
    expect(errorLine.resumeFallback).toBe(false);
  });
});
```

이는 §4.6 "fresh / successful resume / fallback / error" 4-경로 중 directly serializable한 두 경로를 **실제 로거 + 파일시스템**으로 고정한다. Runner.test.ts의 mocked logger 테스트는 payload assembly를, 이 테스트는 serialization wire format을 담당해서 분리된 실패가 교차 검증된다.

- [ ] **Step 3: redirect guard + §4.6 로그 필드 방출 테스트 추가**

`tests/phases/runner.test.ts`에서 gate dispatch에 해당하는 describe 블록에 테스트 추가:

```ts
it('does not apply verdict when state.currentPhase changed during gate run', async () => {
  // mock runGatePhase to mutate state.currentPhase then return verdict
  const state = makeState();
  state.currentPhase = 2;
  (runGatePhase as any).mockImplementationOnce(async () => {
    state.currentPhase = 3; // external jump simulated
    return {
      type: 'verdict', verdict: 'APPROVE', comments: '', rawOutput: '', runner: 'codex',
    };
  });
  await runGateDispatch(2, state, runDir, cwd, logger);
  // phases['2']가 'completed'로 바뀌지 않아야
  expect(state.phases['2']).not.toBe('completed');
});

// §4.6: fresh spawn (resumedFrom=null, resumeFallback=false)
it('emits gate_verdict with resumedFrom=null, resumeFallback=false on fresh spawn', async () => {
  const state = makeState();
  const emitted: any[] = [];
  const logger = { logEvent: vi.fn((ev) => emitted.push(ev)) } as any;
  (runGatePhase as any).mockImplementationOnce(async () => ({
    type: 'verdict', verdict: 'APPROVE', comments: '', rawOutput: '', runner: 'codex',
    codexSessionId: 'fresh-uuid', resumedFrom: null, resumeFallback: false,
  }));
  await runGateDispatch(2, state, runDir, cwd, logger);
  const verdictEvent = emitted.find((e) => e.event === 'gate_verdict');
  expect(verdictEvent).toBeDefined();
  expect(verdictEvent.resumedFrom).toBeNull();
  expect(verdictEvent.resumeFallback).toBe(false);
  expect(verdictEvent.codexSessionId).toBe('fresh-uuid');
});

// §4.6: 성공적 resume (resumedFrom=<prev>, resumeFallback=false, codexSessionId === prev)
it('emits gate_verdict with resumedFrom set + resumeFallback=false on successful resume', async () => {
  const state = makeState();
  const emitted: any[] = [];
  const logger = { logEvent: vi.fn((ev) => emitted.push(ev)) } as any;
  (runGatePhase as any).mockImplementationOnce(async () => ({
    type: 'verdict', verdict: 'REJECT', comments: 'x', rawOutput: '', runner: 'codex',
    codexSessionId: 'prev-sid', resumedFrom: 'prev-sid', resumeFallback: false,
  }));
  await runGateDispatch(2, state, runDir, cwd, logger);
  const verdictEvent = emitted.find((e) => e.event === 'gate_verdict');
  expect(verdictEvent.resumedFrom).toBe('prev-sid');
  expect(verdictEvent.resumeFallback).toBe(false);
});

// §4.6: session_missing → fresh fallback (resumedFrom=<prev>, resumeFallback=true, 새 sessionId)
it('emits gate_verdict with resumeFallback=true on session_missing fallback', async () => {
  const state = makeState();
  const emitted: any[] = [];
  const logger = { logEvent: vi.fn((ev) => emitted.push(ev)) } as any;
  (runGatePhase as any).mockImplementationOnce(async () => ({
    type: 'verdict', verdict: 'APPROVE', comments: '', rawOutput: '', runner: 'codex',
    codexSessionId: 'new-uuid', resumedFrom: 'dead-sid', resumeFallback: true,
  }));
  await runGateDispatch(2, state, runDir, cwd, logger);
  const verdictEvent = emitted.find((e) => e.event === 'gate_verdict');
  expect(verdictEvent.resumedFrom).toBe('dead-sid');
  expect(verdictEvent.resumeFallback).toBe(true);
  expect(verdictEvent.codexSessionId).toBe('new-uuid');
});

// §4.6: error 경로에서도 resume 메타데이터 방출
it('emits gate_error with resumedFrom/resumeFallback on error path', async () => {
  const state = makeState();
  const emitted: any[] = [];
  const logger = { logEvent: vi.fn((ev) => emitted.push(ev)) } as any;
  (runGatePhase as any).mockImplementationOnce(async () => ({
    type: 'error', error: 'Codex gate timed out after 360000ms', runner: 'codex',
    codexSessionId: 'partial-sid', resumedFrom: 'prev-sid', resumeFallback: false,
  }));
  await runGateDispatch(2, state, runDir, cwd, logger);
  const errorEvent = emitted.find((e) => e.event === 'gate_error');
  expect(errorEvent).toBeDefined();
  expect(errorEvent.resumedFrom).toBe('prev-sid');
  expect(errorEvent.resumeFallback).toBe(false);
});
```

(테스트 파일 구조에 따라 import/setup 조정. `runGateDispatch`/`makeState`/`logger` 이름은 기존 파일 컨벤션에 맞춰 교체.)

- [ ] **Step 4: 테스트 실행 + 기존 runner 테스트 회귀 확인**

```bash
pnpm -s vitest run tests/phases/runner.test.ts
```
Expected: 새 테스트 포함 all passed.

- [ ] **Step 5: Commit**

```bash
git add src/phases/runner.ts tests/phases/runner.test.ts
git commit -m "feat(runner): extend gate redirect guard to verdict path and emit resume metadata"
```

---

## Task 7: State mutation sites — inner.ts + signal.ts

**Files:**
- Modify: `src/commands/inner.ts`
- Modify: `src/signal.ts`
- Modify: `tests/commands/inner.test.ts` (필요 시)
- Modify: `tests/signal.test.ts` (필요 시)

- [ ] **Step 1: `src/commands/inner.ts`의 `promptModelConfig` 직후 invalidate 호출 추가**

`promptModelConfig(...)` 호출 직후 (기존 `state.phasePresets = ...` 줄):

```ts
// 변경 전 스냅샷
const prevPresets = { ...state.phasePresets };
state.phasePresets = await promptModelConfig(state.phasePresets, inputManager);
invalidatePhaseSessionsOnPresetChange(state, prevPresets, runDir);
writeState(runDir, state);
```

상단 import에 `invalidatePhaseSessionsOnPresetChange` 추가.

- [ ] **Step 2: `consumePendingAction`의 jump 적용 분기에 invalidate 호출 추가**

`consumePendingAction` 함수 내에서 pending action이 `type: 'jump'` (또는 실제 사용되는 jump type)인 분기를 찾아, phase 리셋 로직 뒤에:

```ts
invalidatePhaseSessionsOnJump(state, targetPhase, runDir);
```

상단 import에 `invalidatePhaseSessionsOnJump` 추가.

(실제 jump action shape는 기존 `src/commands/inner.ts`에 정의된 `PendingAction` 유니온 참고.)

- [ ] **Step 3: `src/signal.ts` SIGUSR1 jump 핸들러에 invalidate 호출 추가**

SIGUSR1 핸들러가 phase 리셋하는 지점을 찾아:

```ts
invalidatePhaseSessionsOnJump(state, targetPhase, runDir);
```

상단 import에 `invalidatePhaseSessionsOnJump` 추가.

- [ ] **Step 4: 기존 테스트 회귀 확인 + 필요 시 inner/signal 테스트 보강**

```bash
pnpm -s vitest run tests/commands/inner.test.ts tests/signal.test.ts
```
시그니처 깨짐이나 새 기대값 추가. 최소 추가:

```ts
it('consumePendingAction invalidates sessions for jump to earlier phase', async () => {
  const state = makeState();
  state.phaseCodexSessions['4'] = { sessionId: 'sess-4', runner: 'codex', model: 'gpt-5.4', effort: 'high', lastOutcome: 'reject' };
  state.phaseCodexSessions['7'] = { sessionId: 'sess-7', runner: 'codex', model: 'gpt-5.4', effort: 'high', lastOutcome: 'reject' };
  state.pendingAction = { type: 'jump', targetPhase: 3 } as any; // 실제 shape 맞추기
  await consumePendingAction(state, runDir, /* ... */);
  expect(state.phaseCodexSessions['2']).not.toBeNull();
  expect(state.phaseCodexSessions['4']).toBeNull();
  expect(state.phaseCodexSessions['7']).toBeNull();
});

// §4.8 authoritative wiring in inner.ts — preset-change 경로가
// `invalidatePhaseSessionsOnPresetChange`를 실제로 호출하는지 behavioral 검증.
// 단순 helper 단위 테스트(Task 2)나 grep(EC-12)이 아니라 "promptModelConfig 이후 진짜로
// 무효화가 발동하는가"를 증명해야 §4.8의 authoritative site 계약이 회귀 방지된다.
it('preset change via promptModelConfig nulls session, deletes replay sidecars, preserves feedback', async () => {
  const state = makeState();
  // 사전 상태: phase 2/4/7에 Codex 세션 저장 + replay sidecar + feedback 파일
  state.phaseCodexSessions['2'] = { sessionId: 'sess-2', runner: 'codex', model: 'gpt-5.4', effort: 'high', lastOutcome: 'reject' };
  state.phaseCodexSessions['4'] = { sessionId: 'sess-4', runner: 'codex', model: 'gpt-5.4', effort: 'high', lastOutcome: 'reject' };
  state.phasePresets = { '2': 'codex-high', '4': 'codex-high', '7': 'codex-high' };
  for (const phase of [2, 4]) {
    fs.writeFileSync(path.join(runDir, `gate-${phase}-raw.txt`), 'raw');
    fs.writeFileSync(path.join(runDir, `gate-${phase}-result.json`), '{}');
    fs.writeFileSync(path.join(runDir, `gate-${phase}-feedback.md`), 'feedback content');
  }

  // promptModelConfig가 preset을 다른 모델로 교체하도록 모킹 (phase 2만 변경)
  vi.mock('../../src/ui.js', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
      ...actual,
      promptModelConfig: vi.fn(async (_prev: any, _im: any) => ({
        '2': 'sonnet-high', '4': 'codex-high', '7': 'codex-high',
      })),
    };
  });

  // inner.ts의 preset-change 진입점(실제 이름은 구현에 맞춰 조정 — 예: `reopenModelConfig`)을 호출
  const innerModule = await import('../../src/commands/inner.js');
  // ↓ 실제 API 이름으로 교체. 요지는 promptModelConfig → state.phasePresets 적용 경로를 밟는 것.
  await innerModule.applyModelConfigChange(state, runDir, /* inputManager */ {} as any);

  // (1) 바뀐 phase(2)만 세션 무효화
  expect(state.phaseCodexSessions['2']).toBeNull();
  // (2) phase 4는 preset 변화 없으니 유지
  expect(state.phaseCodexSessions['4']?.sessionId).toBe('sess-4');
  // (3) phase 2의 replay sidecar(raw/result)는 삭제, feedback은 보존
  expect(fs.existsSync(path.join(runDir, 'gate-2-raw.txt'))).toBe(false);
  expect(fs.existsSync(path.join(runDir, 'gate-2-result.json'))).toBe(false);
  expect(fs.existsSync(path.join(runDir, 'gate-2-feedback.md'))).toBe(true);
  // (4) phase 4 side는 손대지 않음
  expect(fs.existsSync(path.join(runDir, 'gate-4-raw.txt'))).toBe(true);
});
```

> 주의: 위 테스트는 실제 `inner.ts` 구현의 진입점 이름(예: `applyModelConfigChange`, `reopenModelConfig`, 혹은 inline 경로)에 맞춰 호출부를 조정. mock된 `promptModelConfig`가 새 preset map을 반환하고, 그 직후 `invalidatePhaseSessionsOnPresetChange`가 실행되는 **authoritative wiring**이 검증된다.

- [ ] **Step 5: Commit**

```bash
git add src/commands/inner.ts src/signal.ts tests/commands/inner.test.ts tests/signal.test.ts
git commit -m "feat(state-sites): wire up phaseCodexSessions invalidation on preset change and jumps"
```

---

## Task 8: 통합 테스트

**Files:**
- Create: `tests/integration/codex-session-resume.test.ts`

- [ ] **Step 1: 통합 테스트 작성**

`tests/integration/codex-session-resume.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { runGatePhase } from '../../src/phases/gate.js';
import { invalidatePhaseSessionsOnPresetChange, invalidatePhaseSessionsOnJump } from '../../src/state.js';
import type { HarnessState, GatePhaseResult } from '../../src/types.js';

vi.mock('../../src/runners/codex.js');
import { runCodexGate } from '../../src/runners/codex.js';

function makeState(): HarnessState { /* ...same helper as gate-resume.test.ts... */ return ({} as any); }

let runDir: string;
beforeEach(() => { runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-int-')); });
afterEach(() => { vi.clearAllMocks(); });

describe('End-to-end: reject loop uses resume', () => {
  it('first call fresh, second call resumes same session', async () => {
    const state = makeState();
    (runCodexGate as any)
      .mockResolvedValueOnce({
        type: 'verdict', verdict: 'REJECT', comments: 'P1', rawOutput: 'session id: s1',
        runner: 'codex', codexSessionId: 's1',
        sourcePreset: { model: 'gpt-5.4', effort: 'high' },
        resumedFrom: null, resumeFallback: false,
      } as GatePhaseResult)
      .mockResolvedValueOnce({
        type: 'verdict', verdict: 'APPROVE', comments: '', rawOutput: '',
        runner: 'codex', codexSessionId: 's1',
        sourcePreset: { model: 'gpt-5.4', effort: 'high' },
        resumedFrom: 's1', resumeFallback: false,
      } as GatePhaseResult);

    await runGatePhase(2, state, runDir, runDir, runDir);
    expect((runCodexGate as any).mock.calls[0][5]).toBeNull();
    expect(state.phaseCodexSessions['2']?.sessionId).toBe('s1');

    await runGatePhase(2, state, runDir, runDir, runDir);
    expect((runCodexGate as any).mock.calls[1][5]).toBe('s1');
  });
});

describe('End-to-end: session_missing triggers fallback and new session id saved', () => {
  it('fallback response updates state with new session id', async () => {
    const state = makeState();
    state.phaseCodexSessions['2'] = {
      sessionId: 'dead', runner: 'codex', model: 'gpt-5.4', effort: 'high', lastOutcome: 'reject',
    };
    (runCodexGate as any).mockResolvedValueOnce({
      type: 'verdict', verdict: 'APPROVE', comments: '', rawOutput: '',
      runner: 'codex', codexSessionId: 'new-sess',
      sourcePreset: { model: 'gpt-5.4', effort: 'high' },
      resumedFrom: 'dead', resumeFallback: true,
    } as GatePhaseResult);
    await runGatePhase(2, state, runDir, runDir, runDir);
    expect(state.phaseCodexSessions['2']?.sessionId).toBe('new-sess');
  });
});

// §5 "Gate 2 호출 완료 후 state persist → crash → `harness resume`" 시나리오:
// state가 디스크 round-trip을 거친 뒤 runGatePhase가 저장된 sessionId로 resume 경로를 탄다.
describe('End-to-end: crash/resume — persisted session drives resume path (§5)', () => {
  it('after writeState → readState, next runGatePhase call resumes with saved id', async () => {
    const { writeState, readState } = await import('../../src/state.js');
    const state = makeState();
    state.phaseCodexSessions['2'] = {
      sessionId: 'persisted-sess', runner: 'codex', model: 'gpt-5.4', effort: 'high',
      lastOutcome: 'reject',
    };
    writeState(runDir, state);
    const restored = readState(runDir);
    expect(restored.phaseCodexSessions['2']?.sessionId).toBe('persisted-sess');

    (runCodexGate as any).mockResolvedValueOnce({
      type: 'verdict', verdict: 'APPROVE', comments: '', rawOutput: '',
      runner: 'codex', codexSessionId: 'persisted-sess',
      sourcePreset: { model: 'gpt-5.4', effort: 'high' },
      resumedFrom: 'persisted-sess', resumeFallback: false,
    } as GatePhaseResult);
    await runGatePhase(2, restored, runDir, runDir, runDir);
    // 6번째 인자(resumeSessionId)가 복원된 id여야 함
    expect((runCodexGate as any).mock.calls[0][5]).toBe('persisted-sess');
  });
});

describe('End-to-end: preset change invalidates session + sidecars', () => {
  it('subsequent gate call uses fresh path after preset change', async () => {
    const state = makeState();
    state.phaseCodexSessions['2'] = {
      sessionId: 's1', runner: 'codex', model: 'gpt-5.4', effort: 'high', lastOutcome: 'reject',
    };
    // create fake sidecars + feedback
    fs.writeFileSync(path.join(runDir, 'gate-2-raw.txt'), 'x');
    fs.writeFileSync(path.join(runDir, 'gate-2-result.json'), '{}');
    fs.writeFileSync(path.join(runDir, 'gate-2-feedback.md'), 'prior');

    const prev = { '2': 'codex-high', '4': 'codex-high', '7': 'codex-high' };
    state.phasePresets['2'] = 'codex-medium';
    invalidatePhaseSessionsOnPresetChange(state, prev, runDir);

    expect(state.phaseCodexSessions['2']).toBeNull();
    expect(fs.existsSync(path.join(runDir, 'gate-2-raw.txt'))).toBe(false);
    expect(fs.existsSync(path.join(runDir, 'gate-2-feedback.md'))).toBe(true); // preserved

    (runCodexGate as any).mockResolvedValueOnce({
      type: 'verdict', verdict: 'APPROVE', comments: '', rawOutput: '',
      runner: 'codex', codexSessionId: 'new',
      sourcePreset: { model: 'gpt-5.4', effort: 'medium' },
      resumedFrom: null, resumeFallback: false,
    } as GatePhaseResult);
    await runGatePhase(2, state, runDir, runDir, runDir);
    expect((runCodexGate as any).mock.calls[0][5]).toBeNull(); // fresh
  });
});

describe('End-to-end: jump invalidates downstream sessions', () => {
  it('jump to phase 3 invalidates gate 4 and 7 sessions', async () => {
    const state = makeState();
    state.phaseCodexSessions['4'] = { sessionId: 's4', runner: 'codex', model: 'gpt-5.4', effort: 'high', lastOutcome: 'reject' };
    state.phaseCodexSessions['7'] = { sessionId: 's7', runner: 'codex', model: 'gpt-5.4', effort: 'high', lastOutcome: 'reject' };
    invalidatePhaseSessionsOnJump(state, 3, runDir);
    expect(state.phaseCodexSessions['4']).toBeNull();
    expect(state.phaseCodexSessions['7']).toBeNull();
  });
});
```

- [ ] **Step 2: 전체 테스트 스위트 실행**

```bash
pnpm -s vitest run
```
Expected: all green (unit + integration).

- [ ] **Step 3: TypeScript 빌드 최종 확인**

```bash
pnpm -s tsc --noEmit
```
Expected: 에러 없음.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/codex-session-resume.test.ts
git commit -m "test(integration): end-to-end codex session resume scenarios"
```

---

## Task 9: 린트 + 최종 검증

- [ ] **Step 1: 린트 통과 확인**

```bash
pnpm -s lint
```
Expected: 에러 없음.

- [ ] **Step 2: 전체 스위트 한 번 더**

```bash
pnpm -s test
```

- [ ] **Step 3: 실행 흐름 sanity-check (수동)**

다음 명령으로 로컬 smoke test:
```bash
pnpm -s build && node ./bin/harness.js --help
```
출력에 기존 플래그가 그대로 살아있는지 확인.

- [ ] **Step 4: Commit (필요 시 마이너 수정만)**

```bash
# 필요 시에만
git add -u && git commit -m "chore: lint fixes for codex session resume"
```

---

## Deferred Followups (round-4 P2s — 구현 중 우선순위 낮음으로 처리)

Plan gate round-4에서 올라온 P2 지적사항은 Phase 5 구현 도중 발견되면 즉시 반영, 아니면 Phase 6/7에서 별도 팔로업으로 관리한다. 통과 기준을 넘는 blocking 이슈는 아니지만 정확성 보강을 위한 작업.

- [ ] **TODO-1 (P2, §7 migration)**: `--enable-logging` 없이도 resume이 동작하는 loose coupling 검증
  - 목적: Spec §7 "로깅 비활성 run에서도 resume 최적화가 동작"을 EC로 고정
  - 작업: `createSessionLogger(false, ...)` → `NoopLogger`를 주입해 `runGatePhase`를 fresh + resume 두 번 돌리는 통합 테스트 추가. `phaseCodexSessions['2']`가 정상 업데이트되는지 확인.
  - 위치: `tests/integration/codex-session-resume.test.ts`에 새 describe "logging disabled path"
  - EC 신설: EC-20 (미할당) — logging-off path 통합 테스트 통과

- [ ] **TODO-2 (P2, Task 6 Step 3a API alignment)**: logger 테스트의 API를 현 코드베이스에 맞추기
  - 현상: Step 3a가 `new SessionLogger(dir, 'run-1')` + `path.join(dir, 'events.jsonl')`을 사용하지만, 실제 `src/logger.ts`는 `createSessionLogger(enabled, runId, harnessDir, options)` → `FileSessionLogger`를 export하고, events.jsonl은 `sessionsRoot/<repoKey>/<runId>/events.jsonl` 위치에 생성된다 (`tests/logger.test.ts` 참고).
  - 작업: Step 3a 샘플 코드를 `createSessionLogger(true, 'run-1', harnessDir, { sessionsRoot: dir })` 또는 `new FileSessionLogger('run-1', harnessDir, { sessionsRoot: dir })`로 교체하고 `computeRepoKey`로 실제 경로 계산.
  - 위치: Task 6 Step 3a 샘플 코드 수정
  - 참고: 구현자는 `tests/logger.test.ts`의 기존 패턴을 따를 것.

위 2 개는 Phase 5 착수 전 사전 수정 대상이지만, 구현 중 해당 지점에 도달할 때 같이 처리하는 편이 마찰이 적다. Phase 7 eval gate에서 Codex가 다시 지적하면 그 시점에 강제 반영.

---

## Eval Checklist

각 항목은 실행 가능한 커맨드와 pass 조건을 갖는다. `harness-verify.sh`가 이 체크리스트를 소비한다.

### Objective criteria (기계 검증)

- [ ] **EC-1**: `pnpm -s tsc --noEmit` exit 0
  - Pass: stdout 비어있음 + exit 0
- [ ] **EC-2**: `pnpm -s vitest run tests/state-invalidation.test.ts` all passed
  - Pass: summary `Tests  6 passed (6)` 이상
- [ ] **EC-3**: `pnpm -s vitest run tests/context/assembler-resume.test.ts` all passed
  - Pass: summary에 fail 0
- [ ] **EC-4**: `pnpm -s vitest run tests/runners/codex-resume.test.ts` all passed
  - Pass: summary에 fail 0
- [ ] **EC-5**: `pnpm -s vitest run tests/phases/gate-resume.test.ts` all passed
  - Pass: summary에 fail 0
- [ ] **EC-6**: `pnpm -s vitest run tests/integration/codex-session-resume.test.ts` all passed
  - Pass: summary에 fail 0
- [ ] **EC-7**: `pnpm -s vitest run` (전체) — 기존 회귀 없음
  - Pass: total tests 이전 수 이상 + fail 0
- [ ] **EC-8**: `pnpm -s lint` exit 0
  - Pass: stdout에 error 0
- [ ] **EC-9**: Task 0 pilot 결과가 spec §9에 모두 기록됨
  - Command: `grep -c "pilot 결과 (2026-04-18)" docs/specs/2026-04-18-codex-session-resume-design.md`
  - Pass: 출력값 ≥ 3 (§9의 세 open question Q#1/Q#2/Q#3 각각에 pilot 결과 서브-bullet이 존재). 실패하면 Task 0이 skip된 것으로 간주하고 gate eval에서 반영.
  - 부가 확인: `test -f docs/specs/2026-04-18-codex-session-resume-design.md` (링크 경로)
- [ ] **EC-10**: State migration 호환성 — legacy state.json이 깨지지 않음
  - Command: `pnpm -s vitest run tests/state.test.ts -t "migrateState"` all passed
- [ ] **EC-11**: `grep -r "phaseCodexSessions" src/ | wc -l`가 4 이상
  - Pass: 최소 types.ts, state.ts, phases/gate.ts, 합해서 4+ occurrences (실제 정착 확인)
- [ ] **EC-12**: `grep -r "invalidatePhaseSessions" src/ | wc -l`가 4 이상
  - Pass: state.ts (정의 2) + inner.ts (2 호출) + signal.ts (1 호출) = 5+
- [ ] **EC-13**: resume-sensitive 코드 경로 존재 확인
  - Check: `grep -l "resume" src/runners/codex.ts`와 `grep -l "buildFreshPromptOnFallback" src/phases/gate.ts` 각각 hit
- [ ] **EC-14**: `pnpm -s vitest run tests/state.test.ts -t "phaseCodexSessions survives"` all passed
  - Pass: §5 graceful-resume persistence round-trip + in-flight crash invariant 테스트 통과 (fail 0)
- [ ] **EC-15**: `pnpm -s vitest run tests/integration/codex-session-resume.test.ts -t "persisted session drives resume"` all passed
  - Pass: §5 `harness resume` end-to-end path가 저장된 sessionId로 resume 경로를 탐
- [ ] **EC-16**: `pnpm -s vitest run tests/commands/inner.test.ts tests/signal.test.ts` all passed
  - Pass: §4.8/§4.9 authoritative mutation sites(inner.ts, signal.ts)의 behavioral test가 통과 — 단순 presence grep을 넘어 "preset 변경/jump 후 세션·sidecar가 실제로 무효화되는지" 회귀 방지
- [ ] **EC-16a**: `pnpm -s vitest run tests/commands/inner.test.ts -t "preset change via promptModelConfig"` all passed
  - Pass: §4.8 authoritative wiring 전용 behavioral test — `promptModelConfig` 이후 바뀐 phase의 세션 null화, replay sidecar 삭제, feedback 파일 보존이 실제로 일어남을 증명
- [ ] **EC-17**: `pnpm -s vitest run tests/phases/runner.test.ts -t "resumedFrom|resumeFallback"` all passed
  - Pass: §4.6 로그 필드(`resumedFrom`, `resumeFallback`)가 fresh/successful-resume/fallback/error 네 경로에서 runner dispatch payload에 정확히 포함됨을 회귀 방지. fail 0
- [ ] **EC-18**: `pnpm -s vitest run tests/logger.test.ts -t "resume log fields"` all passed
  - Pass: 실제 `SessionLogger`가 `events.jsonl`로 직렬화한 JSON line에 `resumedFrom`/`resumeFallback` 필드가 존재 (mocked logger 경로를 넘어 wire format 보장). fail 0
- [ ] **EC-19**: `pnpm -s vitest run tests/phases/gate-resume.test.ts -t "sidecar replay compatibility gate"` all passed
  - Pass: §4.7 replay compat gate의 4 시나리오(compatible codex hydrate / mismatched sourcePreset skip / legacy metadata skip / claude runner replay) 전부 통과

### Spec traceability (spec 요구사항 → 구현 태스크 매핑)

| Spec section | 요구사항 요약 | 구현 태스크 | 검증 EC |
|--------------|--------------|-------------|---------|
| §4.1 State 스키마 | `GateSessionInfo`, `phaseCodexSessions` | Task 1, 2 | EC-1, EC-10, EC-11 |
| §4.2 Runner 시그니처 | `resumeSessionId`, `buildFreshPromptOnFallback` | Task 4 | EC-4, EC-13 |
| §4.3 Resume 프롬프트 Variant A/B | `assembleGateResumePrompt` | Task 3 | EC-3 |
| §4.4 Control flow | resume dispatch, stillActivePhase | Task 5 | EC-5, EC-6 |
| §4.5 Fallback | session_missing 감지 + closure | Task 4, 5 | EC-4, EC-6 |
| §4.6 Logging | resumedFrom/resumeFallback 필드 + 이벤트 방출 + wire format 직렬화 | Task 1, 6 | EC-1, EC-7, **EC-17**, **EC-18** |
| §4.7 Sidecar replay compat gate | replay-level + hydration-level (4 scenarios: codex-compat/mismatch/legacy/claude) | Task 5 | EC-5, **EC-19** |
| §4.8 Preset 변경 invalidation | helper + inner.ts mutation site (behavioral test) | Task 2, 7 | EC-2, **EC-16**, EC-12 |
| §4.9 Jump invalidation | helper + SIGUSR1 + consumePendingAction (behavioral test) | Task 2, 7 | EC-2, **EC-16**, EC-12 |
| §4.10 Verdict redirect guard | runner.ts 공통 guard | Task 6 | EC-7 |
| §5 Harness resume / 크래시 복구 | state round-trip persist, in-flight crash invariant, persisted-id resume dispatch | Task 1, 2, 8 | **EC-14, EC-15** |
| §9 Open questions | pilot 결과 spec 기록 | Task 0 | EC-9 |

### Subjective criteria (리뷰어 판단)

- [ ] **SC-1**: 코드 품질 — 새 모듈들이 기존 스타일(mod 구조, 에러 반환 패턴, 로깅 방식)을 따르는가
- [ ] **SC-2**: 스펙 §4의 세부 규칙이 구현 주석이나 변수명에 녹아들었는가 (예: `savedCompatible`, `replayCompatible` 명명)
- [ ] **SC-3**: 장기 관찰 metric — `--enable-logging`으로 실제 run 한 번 수행 후 `events.jsonl`에 `resumedFrom` 값이 정상 기록되는가 (수동 검증, optional)

### 성능 샘플 (선택적, 수치 기록만)

Spec §1의 "시간/토큰 절감" 목표를 실측 자료로 남기기 위한 optional 단계. pass/fail 기준 아니라 기록 목적.

- [ ] **PS-1**: 가짜 reject 루프(reject 3회 → approve) 시나리오에서 `--enable-logging` 활성화 run 수행. events.jsonl에서 phase 2 `gate_verdict` 이벤트들의 `durationMs`, `tokensTotal`을 추출해 평균/총합 기록
- [ ] **PS-2**: 동일 시나리오를 resume 비활성화(환경변수 또는 임시 패치) 버전으로도 측정해 비교. 차이를 eval report에 숫자로 기록

---

## Notes for Implementer

- TDD 원칙: 각 Task의 Step 순서(test → fail → impl → pass → commit)를 지켜.
- `src/runners/codex.ts`의 기존 `runCodexInteractive`는 건드리지 않아. 본 작업은 gate 경로 한정.
- Task 4의 mocked spawn 패턴은 기존 `tests/runners/codex.test.ts`가 이미 쓰고 있다면 거기의 helper를 import해 중복 줄여.
- Task 5 테스트의 `makeState()` helper는 기존 테스트 파일에 유사한 것이 있으면 `tests/helpers/` 하위로 뽑아 공유 권장(YAGNI 범위 밖이면 복붙 허용).
- Session ID 정규식(`isResumeSessionMissingError`)은 Task 0 pilot 결과가 가장 중요. 실제 stderr 문자열을 확인한 뒤 Task 4 Step 2의 정규식을 그에 맞춰 **좁게** 갱신.
- 각 커밋은 `git status` 확인 후 이루어져야. 공백 변경이나 IDE 자동 포맷 제외.
