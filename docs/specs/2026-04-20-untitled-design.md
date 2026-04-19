# Same-Phase Same-Session (Claude Interactive Reopen) — Design Spec (Light)

Related docs:
- Task: `.harness/2026-04-20-untitled/task.md`
- Decisions: `.harness/2026-04-20-untitled/decisions.md`
- Checklist: `.harness/2026-04-20-untitled/checklist.json`
- Token capture (§D5 session-id pinning): `docs/specs/2026-04-18-claude-token-capture-design.md`
- Gate resume lineage (§4.1~4.10): `docs/specs/2026-04-18-gate-prompt-hardening-design.md`

## Complexity
Medium — 2~3 파일 수정 + 정책·호환성 체크 + 통합 테스트. 상태 스키마 추가 확장 여지 있음.

## Context & Decisions

### 현재 구현 현황 (리뷰 결론)

1. **Gate phases (2/4/7, Codex) — 이미 "동일 phase 동일 session" 준수.**
   `state.phaseCodexSessions['2'|'4'|'7']`에 `GateSessionInfo { sessionId, runner, model, effort, lastOutcome }`를 저장하고, 재진입 시 `codex exec resume <sessionId>` 경로로 이어간다 (`src/phases/gate.ts:198-230`, `src/runners/codex.ts:192-200`). preset 호환성 체크(같은 runner/model/effort) 및 session_missing fallback(fresh 재실행)까지 구현됨. Phase 4 reject → Phase 3 reopen → Phase 4 재진입 시, **두 번째 Phase 4는 첫 번째 Codex 세션을 resume** 한다.

2. **Interactive phases (1/3/5, Claude) — "동일 phase 동일 session" 불만족.**
   `src/phases/runner.ts:287`에서 `handleInteractivePhase` 진입 시마다 무조건 `const attemptId = randomUUID()`로 새 UUID를 발급하고, `state.phaseAttemptId[phase]`를 덮어쓴다(`src/phases/interactive.ts:216`). 이 `attemptId`는 `claude --session-id <attemptId>`로 Claude에게 전달되어 신규 세션 JSONL을 생성한다(`src/runners/claude.ts:64-66`). 결과적으로 Phase 3이 reject → reopen으로 재진입할 때마다 **새로운 Claude 세션**이 열리고, 이전 컨텍스트(시스템 프롬프트, prior draft, assistant 응답 전부)를 재전송해야 하며, Claude prompt cache도 세션 단위로 분리되어 효율이 떨어진다.

3. **정책 불일치의 결과.**
   사용자가 원한 `P3→P4(reject)→P3(resubmit)→P4` 플로우에서:
   - Phase 3: 두 번 모두 새 세션 (기대: 동일 세션).
   - Phase 4: 두 번 모두 동일 세션 (기대와 일치).
   → interactive 측만 수정하면 정책이 맞춰진다.

### 정책 선언
- **Claude interactive phase가 동일 phase로 reopen 될 때, 직전 세션의 `attemptId`를 재사용하고 `claude --resume <attemptId>`로 이어간다.**
- **다음 조건 중 하나라도 틀어지면 fresh 세션(기존 `--session-id <newUUID>`)으로 fallback.**
  1. `state.phaseReopenFlags[phase] === false` (fresh 진입).
  2. `state.phaseAttemptId[phase]`가 null/비어있음.
  3. `~/.claude/projects/<encodedCwd>/<attemptId>.jsonl`이 존재하지 않음 (세션 파일 소실·수동 삭제).
  4. 현재 preset과 이전 기록된 preset이 runner/model/effort 기준 비호환 (gate와 동일 규칙).
- 사용자 override(jump/skip/terminal-resume) 및 flow 변경 시엔 `state.phaseAttemptId[phase]`를 null로 해제해 fresh 경로를 강제한다 (§D5 token-capture 설계의 JSONL 무결성 보존).

## Requirements / Scope

1. **R1. 세션 재사용 정책 도입.** Claude interactive phase 1/3/5가 reopen flag + 기존 `phaseAttemptId` + JSONL 존재 + preset 호환을 모두 만족하면 `--resume <attemptId>`로 launch 한다.
2. **R2. Fallback 안전성.** 위 조건 중 하나라도 틀어지면 새 UUID 발급 → `--session-id <newUUID>`로 기존 경로 유지. Fallback은 runtime warning(stderr)으로 관측 가능해야 한다(예: `resume fallback: jsonl missing`).
3. **R3. Preset 호환성 검증 상태 저장.** `state.phaseClaudeSessions: Record<'1'|'3'|'5', { runner: 'claude', model, effort } | null>`을 추가하여, Claude phase의 마지막 launch preset을 기록한다. 호환성 로직은 `phaseCodexSessions`와 대칭 구조. 기존 `phaseAttemptId`는 그대로 유지하되 이 신규 필드와 함께 보고 판단한다. **상태 마이그레이션 필요** (기존 run에선 null 시딩).
4. **R4. Token 집계 불변성.** `readClaudeSessionUsage({ sessionId, cwd, phaseStartTs })`는 `phaseStartTs` 필터로 현재 phase attempt 구간만 집계하므로, 세션 재사용 시에도 기존 phase attempt token만 reporting 된다 (JSONL은 누적 추가이나 phaseStartTs 이후 라인만 합산). 구현 시 회귀 테스트 추가.
5. **R5. Sentinel 호환성 불변.** `.harness/<runId>/phase-N.done` 내용은 `{{phaseAttemptId}}` 한 줄. `attemptId` 재사용 시에도 sentinel freshness check(`checkSentinelFreshness`)는 동일 UUID 매칭으로 성공.
6. **R6. 문서 동기화.** 동작 변경(세션 재사용)은 `docs/HOW-IT-WORKS.md`의 reopen/retry 규칙 섹션에 1~2 문단 반영. README는 사용자 노출 흐름 변화 없으므로 변경 불필요를 PR 설명에 근거로 남김.

비범위 (non-goals):
- Claude gate runner(`runClaudeGate`, phase 2/4/7 중 claude 선택된 경우) 세션 재사용은 본 변경 대상이 아니다. `claude --print`는 stateless 이며 gate 재사용 정책은 별도 설계 필요.
- Phase 3→Phase 5 등 **다른 phase 간** 세션 공유는 정책 밖(task가 명시한 "동일 phase" 한정).
- Reopen prompt 압축(gate feedback만 짧게 전달) 최적화는 scope 외 — 현 assembler 의 full prompt 경로를 그대로 `--resume`에 넘긴다.

## Design

### D1. 상태 스키마 확장
```ts
// src/types.ts
export interface ClaudeSessionInfo {
  runner: 'claude';
  model: string;
  effort: string;
}

export interface HarnessState {
  // ... 기존 필드 ...
  phaseClaudeSessions: Record<'1' | '3' | '5', ClaudeSessionInfo | null>;
}
```
- `src/state.ts`: defaults + `migrate()`에서 누락 시 `{ '1': null, '3': null, '5': null }` 주입.
- `phaseAttemptId`는 이미 UUID를 들고 있으므로 별도 세션 id 필드 불필요 — attempt id가 곧 Claude session id.

### D2. 재사용 판정 로직 (`src/phases/runner.ts` handleInteractivePhase 상단)
```ts
const isReopen = state.phaseReopenFlags[String(phase)] ?? false;
const prevAttemptId = state.phaseAttemptId[String(phase)];
const prevClaudeSess = state.phaseClaudeSessions[String(phase) as '1'|'3'|'5'];
const preset = getPhasePresetMeta(state, phase);

let attemptId: string;
let resume = false;
if (
  isReopen &&
  preset?.runner === 'claude' &&
  typeof prevAttemptId === 'string' && prevAttemptId.trim().length > 0 &&
  prevClaudeSess !== null &&
  prevClaudeSess.model === preset.model &&
  prevClaudeSess.effort === preset.effort &&
  claudeSessionJsonlExists(prevAttemptId, cwd) // ~/.claude/projects/<encCwd>/<id>.jsonl
) {
  attemptId = prevAttemptId;
  resume = true;
} else {
  attemptId = randomUUID();
  // warning이 필요한 경우(의도한 resume인데 실패한 경우) stderr 1회 출력
}
```
- `claudeSessionJsonlExists(sessionId, cwd)`는 `src/runners/claude-usage.ts`의 경로 헬퍼 재사용(encodeCwd 로직 추출).
- resume 판정 이후 `state.phaseClaudeSessions[phase] = { runner: 'claude', model: preset.model, effort: preset.effort }`로 업데이트 (새 세션 발급 시에도 동일 기록).

### D3. Claude runner 분기 (`src/runners/claude.ts` runClaudeInteractive)
```ts
// 새 파라미터: resume: boolean (또는 state에서 phaseClaudeSessions를 다시 조회)
const sessionFlag = resume
  ? `--resume ${attemptId} `
  : `--session-id ${attemptId} `;
const claudeArgs = `--dangerously-skip-permissions ${sessionFlag}--model ${preset.model} --effort ${preset.effort} @${path.resolve(promptFile)}`;
```
- `runInteractivePhase` 시그니처에 `resume: boolean` 추가하여 `runClaudeInteractive`에 전달. Codex 분기는 무시.
- `--resume <id> @promptFile`이 prompt를 이어질 user message로 삽입하는지 확인 필요 → §Open Questions Q1.

### D4. Fallback 경로
- D2 조건 실패 시 stderr warning + fresh UUID. Warning 포맷: `⚠️  claude session resume fallback: <reason>` (reason: `reopen=false`, `jsonl missing`, `preset incompatible`, `no prior attempt id`).
- session_missing(JSONL 소실) fallback은 fresh 경로로 자연 흡수. `claude --resume` 런타임 실패는 별도 처리 불가(run만 확인 가능) — 프로세스 exit 시점에서 catch 후 재시도 금지하고 phase 실패로 종료(사용자 resume/jump로 복구).

### D5. 이벤트 로깅
- `phase_start` 이벤트에 `claudeResumeSessionId?: string | null` 추가: resume 발생 시 이전 attemptId 기록, 아니면 undefined/null.
- 기존 `reopenFromGate`와 직교 — reopen 이더라도 fallback이 발생할 수 있으므로 각각 관찰.

### D6. 테스트 전략
- **Unit**: `runner.test.ts` 추가 케이스 — reopen=true + prior session 존재 + preset 동일 → `resume=true` 경로 선택. Fallback 분기 각 사유별 1개.
- **Integration**: `tests/integration/` 또는 `runner.integration.test.ts`에서 Phase 3 → 실패 simulate → reopen Phase 3 시 `claude --resume`이 invoked 되는지 spawn stub으로 검증.
- **Regression**: 기존 token capture 테스트가 `phaseStartTs` 필터로 resume 시에도 이번 phase attempt 만 집계하는지 확인.

## Open Questions

1. **Q1. `claude --resume <id> @promptFile` 의 prompt 주입 시맨틱.** Claude Code CLI가 resume 세션에 file-path arg를 새 user message로 append 하는지, 아니면 무시 / 에러를 내는지 empirically 확인 필요. 만약 append 대신 새 session 생성 / 무시 동작이면 stdin 경로(`claude --resume <id>` + stdin pipe)로 전환해야 한다. 구현 첫 단계(Task 1)에서 pilot 커밋으로 검증한다.
2. **Q2. `claude --session-id <id>` 두 번째 호출(같은 UUID 재사용) 시 동작.** D2가 resume 경로에 빠졌을 때 fallback으로 fresh UUID를 주므로 실사용엔 영향 없지만, 만약 `--session-id`가 기존 파일에 append(= de facto resume) 한다면 `--resume` 분기 자체를 단순화할 여지가 있다. Pilot 결과에 따라 D3 분기 통합 가능.
3. **Q3. User-driven reopen (terminal-resume Continue) 시 재사용 허용 여부.** Gate reject로 인한 자동 reopen은 resume이 자연스럽지만, 사용자가 manual continue로 phase를 다시 연 경우에도 동일 세션을 이어갈지 / fresh로 시작할지. 기본 정책은 "reopen flag 가 true 이면 공통적으로 resume 시도, JSONL이 없거나 preset 변경되면 fallback"으로 보수적 통합. 별도 UX 피드백 없으면 유지.

## Implementation Plan

1. **Task 1 — Pilot: `claude --resume` prompt 주입 시맨틱 확인.**
   - `claude --dangerously-skip-permissions --resume <uuid> @/path/to/followup.md` 한 번, stdin 경로(`echo "msg" | claude --resume <uuid> -p`) 한 번 실행하여 JSONL append 여부 관찰.
   - 결과를 `.harness/2026-04-20-untitled/resume-pilot.md`에 기록하고 필요 시 D3의 `sessionFlag` 포맷(파일 vs stdin) 결정을 업데이트.

2. **Task 2 — 상태 스키마 + 마이그레이션.**
   - `src/types.ts`에 `ClaudeSessionInfo` + `phaseClaudeSessions` 필드 추가.
   - `src/state.ts` defaults / `migrate()`에서 기존 run의 누락 값 시딩 (null).
   - `src/types.ts`의 `phase_start` LogEvent 정의에 `claudeResumeSessionId?: string | null` 선택 필드 추가.

3. **Task 3 — JSONL 존재 헬퍼 추출.**
   - `src/runners/claude-usage.ts`에 내부적으로 존재하는 `encodeCwd`/경로 조립 로직을 public helper `claudeSessionJsonlPath(sessionId, cwd)` + `claudeSessionJsonlExists(sessionId, cwd)`로 export.
   - 단위 테스트: 존재/부재 케이스.

4. **Task 4 — Runner 분기 도입.**
   - `src/phases/runner.ts:handleInteractivePhase`: attemptId 발급 로직을 Task 2 기반 재사용 판정으로 교체. fallback 사유별 stderr warning. `state.phaseClaudeSessions[phase]` 업데이트 및 `writeState()`.
   - `src/phases/interactive.ts:runInteractivePhase` 시그니처에 `resume: boolean` 추가, `runClaudeInteractive`에 전달.
   - `src/runners/claude.ts:runClaudeInteractive`: resume 모드면 `--resume <id>`, 아니면 기존 `--session-id <id>`.
   - `phase_start` 이벤트에 `claudeResumeSessionId` 주입.

5. **Task 5 — 테스트.**
   - Unit: runner/interactive 분기 테스트 (mock claudeSessionJsonlExists + state fixture).
   - Integration: tmux/spawn stub 레벨에서 reopen 시 `--resume`이 사용되는지 검증.
   - Regression: token capture (`readClaudeSessionUsage`) 반복 resume 시 현재 attempt 구간 token만 집계.

6. **Task 6 — 문서 동기화.**
   - `docs/HOW-IT-WORKS.md`의 reopen 절에 "Claude interactive reopen reuses prior session id" 단락 추가.
   - `CLAUDE.md`(`src/phases/runner.ts` entry point 설명)에 `phaseClaudeSessions` 필드 언급 추가.
   - README는 운영자 관찰 동작이 변하지 않으므로(UX 동일, 내부 토큰 절감) 변경 없음 — PR 설명에 근거 기재.

## Eval Checklist Summary

- `pnpm tsc --noEmit` (= `pnpm lint` alias) — 타입 무결성.
- `pnpm vitest run` — 기존 + 신규 unit/integration 테스트.
- `pnpm build` — tsc + asset copy, dist 산출물 재현.

(실제 실행 명세는 `.harness/2026-04-20-untitled/checklist.json` 참조.)
