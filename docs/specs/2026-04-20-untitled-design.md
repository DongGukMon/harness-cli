# Same-Phase Same-Session (Claude Interactive Reopen) — Design Spec (Light)

Related docs:
- Task: `.harness/2026-04-20-untitled/task.md`
- Decisions: `.harness/2026-04-20-untitled/decisions.md`
- Checklist: `.harness/2026-04-20-untitled/checklist.json`
- Token capture (§D5 session-id pinning): `docs/specs/2026-04-18-claude-token-capture-design.md`
- Gate resume lineage (§4.1~4.10): `docs/specs/2026-04-18-gate-prompt-hardening-design.md`

## Complexity
Medium — 2~3 파일 수정 + 정책·호환성 체크 + 통합 테스트. 상태 스키마 1회 마이그레이션 + sentinel 재활용 무효화 경로 추가. Rev 2 는 Gate 7 rev-1 피드백(atomic lineage commit + runner-level argv 테스트) 반영 범위만 추가되며 복잡도 등급은 동일.

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

### Resume CLI 계약 (freeze — Gate 2 P1 resolution)
- **primary invocation**: `claude --dangerously-skip-permissions --resume <attemptId> --model <model> --effort <effort> @<promptFile>`.
- 근거: 기존 fresh-launch 경로(`--session-id <id> @<promptFile>`, `src/runners/claude.ts:65`)가 이미 `@<file>` 형식으로 초기 user turn 을 TUI 에 주입하고 있고, Claude Code CLI 의 `@<path>` argument 는 fresh/resume 에 관계없이 "세션의 다음 user message 로 파일 내용을 삽입" 하는 동일한 시맨틱을 공유한다. 따라서 `--session-id` 를 `--resume` 으로만 교체하고 나머지 argv 구조(특히 `@<promptFile>`)를 유지하는 것이 최소 차이 구현이자 구현·테스트의 단일 타깃이다.
- **대체 경로(stdin pipe)는 본 설계 범위에서 제외**. 실 구현 단계에서 이 계약이 경험적으로 무너지는 사실이 드러나면, 별도 spec/ADR 로 승격해 처리하고 본 플로우는 일시적으로 fresh 세션 fallback 으로 회귀한다.
- Pilot 단계는 두지 않는다. 설계가 계약을 고정하므로, Task 1 은 상태 스키마 + 마이그레이션부터 시작한다.

## Requirements / Scope

1. **R1. 세션 재사용 정책 도입.** Claude interactive phase 1/3/5가 reopen flag + 기존 `phaseAttemptId` + JSONL 존재 + preset 호환을 모두 만족하면 `--resume <attemptId>`로 launch 한다.
2. **R2. Fallback 안전성.** 위 조건 중 하나라도 틀어지면 새 UUID 발급 → `--session-id <newUUID>`로 기존 경로 유지. Fallback은 runtime warning(stderr)으로 관측 가능해야 한다(예: `resume fallback: jsonl missing`).
3. **R3. Preset 호환성 검증 상태 저장.** `state.phaseClaudeSessions: Record<'1'|'3'|'5', { runner: 'claude', model, effort } | null>`을 추가하여, Claude phase의 마지막 launch preset을 기록한다. 호환성 로직은 `phaseCodexSessions`와 대칭 구조. 기존 `phaseAttemptId`는 그대로 유지하되 이 신규 필드와 함께 보고 판단한다. **상태 마이그레이션 필요** (기존 run에선 null 시딩). **Rev 2 추가 제약 (R7 참조)**: `phaseAttemptId[phase]` 와 `phaseClaudeSessions[phase]` 는 한 쌍의 lineage record 로 취급하며, 이번 relaunch 가 spawn 직전의 경성 전제(R5 sentinel purge)를 통과하기 전까지 어느 한쪽도 업데이트해서는 안 된다.
4. **R4. Token 집계 불변성.** `readClaudeSessionUsage({ sessionId, cwd, phaseStartTs })`는 `phaseStartTs` 필터로 현재 phase attempt 구간만 집계하므로, 세션 재사용 시에도 기존 phase attempt token만 reporting 된다 (JSONL은 누적 추가이나 phaseStartTs 이후 라인만 합산). 구현 시 회귀 테스트 추가.
5. **R5. Stale sentinel 방어 (hard prerequisite — Gate 2 P1 retry resolution).** `attemptId` 가 재사용되면 기존 `.harness/<runId>/phase-N.done` 파일이 동일 payload(`{{phaseAttemptId}}`)이기 때문에 `checkSentinelFreshness` 만으로는 이전 attempt 의 완료 신호와 이번 reopen attempt 의 완료 신호를 구별할 수 없다. 이를 차단하기 위해 **interactive phase 를 relaunch 하는 시점에, claude 프로세스를 spawn 하기 직전에 `phase-N.done` 이 존재하면 반드시 삭제하고, 삭제 후 파일 부재를 재확인(existsSync === false)한다. 재확인에서도 파일이 남아 있으면(권한/FS 오류/동시성 레이스) relaunch 를 abort 하고 phase 를 실패 처리한다.** Best-effort swallow 는 허용하지 않는다 — payload 기반 freshness 가 resume 경로에서 구별력을 잃는 만큼 "spawn 이전 sentinel 부재" 를 **유일한 경성 불변식** 으로 격상한다. 이 삭제·검증은 resume 경로와 fresh 경로 모두에 적용된다(재진입 공통 경로). fresh 경로에서는 기존 stale 정리 효과만 남으므로 regression 없음. 구현은 `handleInteractivePhase` 에서 runner dispatch 직전에 수행한다(Task 3 참조).
6. **R6. 문서 동기화.** 동작 변경(세션 재사용 + sentinel 선삭제)은 `docs/HOW-IT-WORKS.md`의 reopen/retry 규칙 섹션에 1~2 문단 반영. README는 사용자 노출 흐름 변화 없으므로 변경 불필요를 PR 설명에 근거로 남김.

7. **R7. Lineage atomic commit (Gate 7 rev-1 P1 resolution).** `handleInteractivePhase` 에서 (a) sentinel purge(R5/D5) 가 성공적으로 통과하기 전까지 `state.phaseClaudeSessions[phase]` 를 쓰지 않으며, (b) purge 통과 직후 `state.phaseAttemptId[phase]` 와 `state.phaseClaudeSessions[phase]` 를 **동일 writeState 호출 한 번**으로 함께 commit 한다. 이 순서 불변식이 성립하면 purge 가 throw 할 때 두 필드 모두 직전 attempt 의 lineage 로 남아, 다음 reopen 시 호환성 판정이 "old attemptId ↔ new preset" 혼합 상태에서 오판(잘못된 resume)할 수 없다. 구현은 §D8 참조.

8. **R8. Runner-level argv 테스트 (Gate 7 rev-1 P2 resolution).** `runClaudeInteractive` 가 resume 모드에서 `--resume <attemptId>` 를 전송하며 `--session-id` 를 전송하지 않음을, fresh 모드에서 그 반대임을 **runner 레벨에서 직접 검증** 한다. 기존 `tests/phases/runner-claude-resume.test.ts` 는 `resume=true` 플래그 전파까지만 검증하며, 최종 spawn 커맨드의 argv 모양을 확인하지 않아 CLI 계약(ADR-7) 회귀 방어가 약하다. `tests/runners/claude.test.ts` 에 tmux `sendKeysToPane` 을 stub 해 실제 전송되는 wrapper 쉘 문자열을 관측·assert 한다.

비범위 (non-goals):
- Claude gate runner(`runClaudeGate`, phase 2/4/7 중 claude 선택된 경우) 세션 재사용은 본 변경 대상이 아니다. `claude --print`는 stateless 이며 gate 재사용 정책은 별도 설계 필요.
- Phase 3→Phase 5 등 **다른 phase 간** 세션 공유는 정책 밖(task가 명시한 "동일 phase" 한정).
- Reopen prompt 압축(gate feedback만 짧게 전달) 최적화는 scope 외 — 현 assembler 의 full prompt 경로를 그대로 `--resume`에 넘긴다.
- stdin-pipe 기반 resume 경로 탐색 (계약 freeze 로 scope 제외).

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

### D3. Claude runner 분기 (`src/runners/claude.ts` runClaudeInteractive) — 계약 freeze
```ts
// 새 파라미터: resume: boolean
const sessionFlag = resume
  ? `--resume ${attemptId} `
  : `--session-id ${attemptId} `;
const claudeArgs = `--dangerously-skip-permissions ${sessionFlag}--model ${preset.model} --effort ${preset.effort} @${path.resolve(promptFile)}`;
```
- `runInteractivePhase` 시그니처에 `resume: boolean` 추가하여 `runClaudeInteractive`에 전달. Codex 분기는 무시.
- `@<promptFile>` 주입 시맨틱은 fresh/resume 에서 동일(다음 user turn 으로 파일 내용 삽입)하다는 계약을 고정. 별도 pilot 없이 구현·테스트의 단일 타깃으로 사용.

### D4. Fallback 경로
- D2 조건 실패 시 stderr warning + fresh UUID. Warning 포맷: `⚠️  claude session resume fallback: <reason>` (reason: `reopen=false`, `jsonl missing`, `preset incompatible`, `no prior attempt id`).
- session_missing(JSONL 소실) fallback은 fresh 경로로 자연 흡수. `claude --resume` 런타임 실패는 별도 처리 불가(run만 확인 가능) — 프로세스 exit 시점에서 catch 후 재시도 금지하고 phase 실패로 종료(사용자 resume/jump로 복구).

### D5. Stale sentinel 선삭제 + 부재 재확인 (R5 구현 규정 — Gate 2 P1 retry resolution)
- **위치**: `handleInteractivePhase` 에서 `runInteractivePhase` 호출 직전 (runner dispatch 공통 경로). 상태 업데이트(`phaseClaudeSessions`) 및 `phase_start` 이벤트 emit **이후**, spawn 직전. 이 순서는 "sentinel 제거 실패 → 이번 relaunch 절대 spawn 금지" 를 보장한다.
- **동작 (hard prerequisite)**:
  ```ts
  const sentinelPath = path.join(runDir, `phase-${phase}.done`);
  let lastErr: unknown = undefined;
  try {
    // rmSync({ force: true }) 는 부재여도 throw 하지 않음.
    fs.rmSync(sentinelPath, { force: true });
  } catch (e) {
    lastErr = e;
  }
  if (fs.existsSync(sentinelPath)) {
    // 삭제 실패 (권한/FS race/남은 lock 등) → 이번 relaunch 를 포기하고 phase 를 실패 처리한다.
    throw new Error(
      `pre-relaunch sentinel purge failed: ${sentinelPath} still present` +
        (lastErr instanceof Error ? ` (cause: ${lastErr.message})` : ''),
    );
  }
  ```
- **실패 시 처리**: 이 throw 는 `handleInteractivePhase` 의 정상 실패 경로(catch/throw 브랜치)로 흡수되어 `phase_end { status: 'failed' }` 를 emit 하고 사용자는 터미널 UI 의 resume/jump/quit 선택으로 복구한다. 자동 retry 는 하지 않는다(근본 원인이 FS 측이면 재시도 루프는 무의미).
- **왜 공통 경로에 두는가**: resume 경로 전용이 아니라 모든 interactive relaunch 직전에 수행하면, "이 relaunch 이후 새로 만들어진 sentinel 만 watchdog 가 관찰한다" 는 불변식이 단순해진다. `attemptId` 가 새 UUID 인 fresh 경로에서는 기존에도 payload 가 다르면 stale 로 분류되었으므로 관측 가능 동작 변화 없음(다만 fresh 경로에서도 이제 "파일 잔존 → abort" 로 엄격해진다. 정상 상황에선 해당 파일이 없으므로 무영향).
- **대안 평가**: "두 번째 freshness discriminator (mtime/payload 버전 필드)" 도 Gate 2 피드백이 제시한 옵션이나, sentinel 포맷·`checkSentinelFreshness` 호출자 전역 파급이 발생한다. 단일 지점(`handleInteractivePhase`)에서 강제 삭제+검증하는 방식이 변경 범위를 최소화하면서 동등한 정확성을 제공하므로 본 설계에서 채택(ADR-6 참조).
- **테스트(§D7에 추가)**: (a) reopen resume 경로에서 기존 sentinel 파일(동일 attemptId 내용)이 spawn 직전 삭제되는지, (b) **삭제 후에도 파일이 남아 있도록 모킹한 경우 relaunch 가 abort 되고 phase 가 failed 로 종료되는지**, (c) watchdog 이 재생성된 sentinel 만 freshness=true 로 판단하는지, (d) 삭제 대상이 애초에 없는 케이스(fresh run 초기 진입)에서 abort 없이 정상 spawn 되는지.

### D5b. Atomic lineage commit 순서 (R7 — Gate 7 rev-1 P1 resolution)
`handleInteractivePhase` 의 단계 순서를 다음과 같이 고정한다:

1. 이전 상태 읽기만 수행 (`prevAttemptId`, `prevClaudeSess`, `isReopen`, `preset`). **어떤 state 필드도 mutate 하지 않는다.**
2. resume/fresh 결정 + 새 또는 재사용 `attemptId` 계산 (로컬 변수만).
3. **Sentinel purge (R5/D5)**: `fs.rmSync` + `existsSync` 재확인. 파일이 남아 있으면 throw → 상위 catch 가 `phase_end { status: 'failed' }` emit. 이 시점까지 `phaseAttemptId` / `phaseClaudeSessions` 는 **직전 attempt 의 기록** 그대로 유지된다. 따라서 throw 후 next reopen 이 판정하는 lineage 는 일관된 과거 상태이며, "새 preset + 옛 attemptId" 로 resume 하는 오판 경로가 제거된다.
4. **Lineage atomic commit**: `state.phaseAttemptId[phase] = attemptId; state.phaseClaudeSessions[phase] = { runner: 'claude', model, effort }; writeState(runDir, state);` — 한 호출로 두 필드를 함께 persist. 이 라인 이전까지 두 필드는 손대지 않는다.
5. `phase_start` 이벤트 logging.
6. `runInteractivePhase` 호출. 기존 `interactive.ts:217` 의 `state.phaseAttemptId = attemptId` + `writeState` 는 이미 동일 값을 다시 쓰는 no-op 이 된다(그대로 둬도 안전하고, cleanup 은 본 변경 scope 밖).

**유지 조건.** (i) resume 경로에서 `attemptId === prevAttemptId` 이므로 step 4 의 `phaseAttemptId` 쓰기는 본질적으로 no-op 이며 lineage 에 변화 없음. (ii) fresh 경로에서 `attemptId = randomUUID()` 이고, lineage 는 (new attemptId, new claudeSess) 로 동시에 갱신된다. (iii) step 3 이 throw 하면 두 필드 모두 unchanged — Gate 7 rev-1 이 지적한 "phaseClaudeSessions 만 바뀌고 phaseAttemptId 는 그대로 남는 중간 상태" 가 원천 차단.

**실패 경로 처리.** step 3 throw → `handleInteractivePhase` 의 catch 블록이 `phase_end { status: 'failed' }` 를 emit 하고 re-throw. 상위 `runPhaseLoop` 가 `state.phases[phase] = 'failed'` 로 전이시키면 `runPhaseLoop` 가 reopen-flag 를 유지한 채 루프를 탈출 → 다음 reopen 시 `state.phaseClaudeSessions` 는 이전 lineage 와 일관된 상태 (prevClaudeSess) 로 남아 판정 정확성 확보.

### D6. 이벤트 로깅
- `phase_start` 이벤트에 `claudeResumeSessionId?: string | null` 추가: resume 발생 시 이전 attemptId 기록, 아니면 undefined/null.
- 기존 `reopenFromGate`와 직교 — reopen 이더라도 fallback이 발생할 수 있으므로 각각 관찰.

### D7. 테스트 전략
- **Unit (handleInteractivePhase)**: `tests/phases/runner-claude-resume.test.ts` 추가 케이스 — reopen=true + prior session 존재 + preset 동일 → `resume=true` 경로 선택. Fallback 분기 각 사유별 1개. Sentinel 선삭제 동작 검증 (existsSync → unlink). **Rev 2 추가 (R7)**: sentinel purge 가 throw 하도록 모킹한 경우, `state.phaseClaudeSessions[phase]` 가 기존 값(또는 null) 그대로 남아 있는지 직접 assert — "새 preset 기록이 선제로 써지지 않음" 이 관측 가능 속성이다.
- **Unit (runClaudeInteractive) — Rev 2 추가 (R8)**: `tests/runners/claude.test.ts` 에 `tmux.sendKeysToPane` / `pollForPidFile` / `process.getProcessStartTime` / `lock.updateLockChild` / `state.writeState` 를 stub 하고 `runClaudeInteractive(..., resume)` 을 직접 호출해 전송되는 wrapper 쉘 문자열을 캡처한다. 기대:
  - `resume=true` → 문자열에 `--resume <attemptId>` 포함, `--session-id` 는 **포함되지 않음**.
  - `resume=false` → 문자열에 `--session-id <attemptId>` 포함, `--resume` 는 포함되지 않음.
  - 두 경우 모두 `@<promptFile>` 끝부분 불변, `--model` / `--effort` 유지.
- **Integration**: `tests/integration/` 또는 `runner.integration.test.ts`에서 Phase 3 → 실패 simulate → reopen Phase 3 시 `claude --resume`이 invoked 되는지 spawn stub으로 검증. Sentinel 재활용 무효화 시나리오(재사용 attemptId 에서 기존 `phase-3.done` 이 stale 완료로 오인되지 않는지) 포함.
- **Regression**: 기존 token capture 테스트가 `phaseStartTs` 필터로 resume 시에도 이번 phase attempt 만 집계하는지 확인.

## Open Questions

1. **Q1. `claude --session-id <id>` 두 번째 호출(같은 UUID 재사용) 시 동작.** D2가 resume 경로에 빠졌을 때 fallback으로 fresh UUID를 주므로 실사용엔 영향 없지만, 만약 `--session-id`가 기존 파일에 append(= de facto resume) 한다면 `--resume` 분기 자체를 단순화할 여지가 있다. Gate 7 이후 후속 조사 항목으로 남긴다(본 설계 범위 외).
2. **Q2. User-driven reopen (terminal-resume Continue) 시 재사용 허용 여부.** Gate reject로 인한 자동 reopen은 resume이 자연스럽지만, 사용자가 manual continue로 phase를 다시 연 경우에도 동일 세션을 이어갈지 / fresh로 시작할지. 기본 정책은 "reopen flag 가 true 이면 공통적으로 resume 시도, JSONL이 없거나 preset 변경되면 fallback"으로 보수적 통합. 별도 UX 피드백 없으면 유지.

(Gate 2 cycle 0 P1 "resume prompt-delivery contract" 는 §Context & Decisions Resume CLI 계약 에서, Gate 2 retry 1 P1 "stale sentinel purge 는 best-effort 여선 안 된다" 는 §R5·§D5 (hard-delete + 부재 재확인, 실패 시 relaunch abort) 에서 본 설계 내에 해결됨. Gate 7 rev-1 P1 "phaseClaudeSessions 가 launch commit 전에 persist 되어 lineage split 발생" 는 §R7 + §D5b (atomic lineage commit — sentinel purge 통과 후 한 번의 writeState 로 phaseAttemptId + phaseClaudeSessions 공동 persist) 에서, Gate 7 rev-1 P2 "resume argv 계약이 runner 레벨에서 검증되지 않는다" 는 §R8 + §D7 Unit(runClaudeInteractive) 케이스에서 해결됨.)

## Implementation Plan

1. **Task 1 — 상태 스키마 + 마이그레이션.**
   - `src/types.ts`에 `ClaudeSessionInfo` + `phaseClaudeSessions` 필드 추가.
   - `src/state.ts` defaults / `migrate()`에서 기존 run의 누락 값 시딩 (null).
   - `src/types.ts`의 `phase_start` LogEvent 정의에 `claudeResumeSessionId?: string | null` 선택 필드 추가.

2. **Task 2 — JSONL 존재 헬퍼 추출.**
   - `src/runners/claude-usage.ts`에 내부적으로 존재하는 `encodeCwd`/경로 조립 로직을 public helper `claudeSessionJsonlPath(sessionId, cwd)` + `claudeSessionJsonlExists(sessionId, cwd)`로 export.
   - 단위 테스트: 존재/부재 케이스.

3. **Task 3 — Runner 분기 + sentinel 선삭제(hard prerequisite) 도입.**
   - `src/phases/runner.ts:handleInteractivePhase`: attemptId 발급 로직을 Task 1·2 기반 재사용 판정으로 교체. fallback 사유별 stderr warning. `state.phaseClaudeSessions[phase]` 업데이트 및 `writeState()`.
   - 동일 위치에서 `runInteractivePhase` 호출 직전에 `phase-<N>.done` 을 `fs.rmSync(..., { force: true })` 로 제거한 뒤 `fs.existsSync` 로 부재를 재확인. 파일이 남아 있으면 throw 하여 relaunch abort → 상위 catch 브랜치가 `phase_end { status: 'failed' }` 를 emit 하도록 한다 (R5/D5).
   - `src/phases/interactive.ts:runInteractivePhase` 시그니처에 `resume: boolean` 추가, `runClaudeInteractive`에 전달.
   - `src/runners/claude.ts:runClaudeInteractive`: resume 모드면 `--resume <id>`, 아니면 기존 `--session-id <id>`.
   - `phase_start` 이벤트에 `claudeResumeSessionId` 주입.

4. **Task 4 — 테스트.**
   - Unit: runner/interactive 분기 테스트 (mock `claudeSessionJsonlExists` + state fixture). Sentinel 선삭제 unit 케이스: (i) 파일 존재 → 삭제 후 spawn, (ii) **삭제 후에도 존재하도록 `existsSync` 모킹 → throw 되어 relaunch abort + phase failed 로 종료**, (iii) 파일 부재 → no-op 후 spawn.
   - Integration: tmux/spawn stub 레벨에서 reopen 시 `--resume`이 사용되는지 + 재사용 attemptId 에서 prior sentinel 오인 없이 새 완료 신호만 수락되는지 검증.
   - Regression: token capture (`readClaudeSessionUsage`) 반복 resume 시 현재 attempt 구간 token만 집계.

5. **Task 5 — 문서 동기화.**
   - `docs/HOW-IT-WORKS.md`의 reopen 절에 "Claude interactive reopen reuses prior session id + pre-relaunch sentinel purge" 단락 추가.
   - `CLAUDE.md`(`src/phases/runner.ts` entry point 설명)에 `phaseClaudeSessions` 필드 언급 추가.
   - README는 운영자 관찰 동작이 변하지 않으므로(UX 동일, 내부 토큰 절감) 변경 없음 — PR 설명에 근거 기재.

### Rev 2 delta (Gate 7 rev-1 resolution — 본 iteration 의 실질 구현 범위)

**배경.** Task 1~5 의 핵심 구현은 rev 1 에서 이미 merge 되어 있다(최근 커밋 `e2fa31a` / `e29af83` / `b7aefe7` / `c71545f`). Rev 2 는 Gate 7 피드백이 지적한 두 결함 — (P1) lineage split, (P2) runner-level argv 검증 부재 — 만 고친다. 따라서 본 iteration 의 Implementation Plan 은 Task 6·7 두 개로 압축되며, Task 1~5 는 참조 이력 용도로 남긴다.

6. **Task 6 — Lineage atomic commit 리오더 (R7 / D5b / Gate 7 rev-1 P1).**
   - `src/phases/runner.ts:handleInteractivePhase` 를 §D5b 순서대로 재배열:
     1. prev 값 읽기 + resume/fresh 결정까지는 현재와 동일(state write 없음).
     2. **sentinel purge 블록(현재 `try { fs.rmSync ... } if (existsSync) throw` 구조)을 `state.phaseClaudeSessions[...] = {...}` 쓰기보다 앞으로 이동**.
     3. purge 통과 직후 `state.phaseAttemptId[String(phase)] = attemptId` 와 `state.phaseClaudeSessions[String(phase) as '1'|'3'|'5'] = { runner: 'claude', model, effort }` 를 **동일 block 에서 한 번의 `writeState(runDir, state)` 로** persist.
     4. 이후 `phase_start` logging → `runInteractivePhase` 호출 순서 유지.
   - `src/phases/interactive.ts:217` 의 `state.phaseAttemptId[String(phase)] = attemptId; writeState(...)` 는 동일 값을 다시 쓰는 no-op 이 되지만 안전상 그대로 둔다(범위 밖).
   - 기존 테스트가 "resume 판정 이후 phaseClaudeSessions 가 기록됨" 을 assert 하는 케이스(`runner-claude-resume.test.ts` — `records phaseClaudeSessions after launch`)는 여전히 통과해야 한다 (최종 상태는 동일).

7. **Task 7 — Runner argv assertion 테스트 + lineage-atomicity 회귀 케이스 (R8 + R7 / Gate 7 rev-1 P2 + P1 재발 방지).**
   - `tests/runners/claude.test.ts` 에 신규 describe block 2개:
     - `resume=true` 호출 시 캡처된 wrapper 문자열에 `--resume <attemptId>` 포함 + `--session-id` **미포함** assert.
     - `resume=false` 호출 시 `--session-id <attemptId>` 포함 + `--resume` **미포함** assert.
     - 공통: `@<promptFile>` suffix, `--model`, `--effort`, `--dangerously-skip-permissions` 존재. Mock 대상: `src/tmux.js` (sendKeysToPane, pollForPidFile), `src/process.js` (getProcessStartTime, isPidAlive), `src/lock.js` (updateLockChild), `src/state.js` (writeState). `sendKeysToPane` 의 두 번째(Ctrl-C)·세 번째(wrapped cmd) 호출을 구분해 검증.
   - `tests/phases/runner-claude-resume.test.ts` 에 신규 케이스: sentinel purge throw 를 유도한 뒤, `state.phaseClaudeSessions[phase]` 가 **호출 이전 값 그대로** 남아 있는지 assert (rev 1 에서는 new preset 이 기록되어 있었으므로 이 assert 가 현재 코드에서 실패하면 회귀 탐지).
   - 문서: `docs/HOW-IT-WORKS.md` 의 reopen 섹션에 "pre-relaunch sentinel purge 가 실패하면 phaseAttemptId / phaseClaudeSessions 가 **동시에** 불변" 이라는 한 문장 추가. README 변경 없음(운영자 노출 동작 불변).

## Eval Checklist Summary

- `pnpm tsc --noEmit` (= `pnpm lint` alias) — 타입 무결성.
- `pnpm vitest run` — 기존 + 신규 unit/integration 테스트.
- `pnpm build` — tsc + asset copy, dist 산출물 재현.

(실제 실행 명세는 `.harness/2026-04-20-untitled/checklist.json` 참조.)
