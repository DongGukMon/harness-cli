# Codex Gate (Phase 2/4/7) → Workspace-Pane Interactive TUI Migration — Design Spec

> **Ratification status (Phase 1, runId `2026-04-24-codex-gate-phase-2-4-7-4f26`)**
> 본 문서는 사전 승인된 source-of-truth 스펙(`docs/specs/2026-04-24-codex-session-migration-design.md`)을 harness Phase 1에서 ratify한 결과물이다. 설계 결정은 source 문서와 동일하게 보존했고, source의 "열린 결정" 3건은 본 ratification에서 모두 확정 결정으로 격상되었다(아래 §Resolved Decisions). 본 PR 스코프(N1–N4)와 비-스코프 경계는 유지된다.

관련 산출물:

- Source-of-truth spec: `docs/specs/2026-04-24-codex-session-migration-design.md`
- Brainstorming origin: 2026-04-24 채팅 세션 (사용자 동기 = "gate가 attach 불가하고 jump/skip 반응성이 interactive와 달라 UX가 갈라짐")
- 기반 설계 문서: `docs/specs/2026-04-14-tmux-rearchitecture-design.md` (tmux 아키텍처), `docs/specs/2026-04-18-gate-prompt-hardening-design.md` (gate prompt 계약)
- 영향받는 런타임: `src/runners/codex.ts`, `src/phases/{runner,gate,interactive,verdict}.ts`, `src/context/assembler.ts`, `src/ui.ts` / `src/ink/*`
- 결정 로그: `.harness/2026-04-24-codex-gate-phase-2-4-7-4f26/decisions.md`

## Complexity

Medium — 단일 runner 하나와 그 runner를 감싸는 dispatch 계층을 대칭 리팩터링. 새 서브시스템은 없고 tmux / sentinel / same-session-lineage 같은 기존 계약을 그대로 재사용한다. 단, dispatch 통합이 Phase 1/3/5(Claude interactive) 경로의 행동까지 건드릴 수 있어 regression 표면적이 얇지 않다.

## Context & Decisions

### 사용자 관찰

현재 Phase 2/4/7 gate는 Codex CLI를 `codex exec` non-interactive one-shot으로 **control 프로세스 안의 subprocess**로 실행한다. 그 결과:

1. Gate 실행 중에는 작업 현황이 control 화면의 stderr 스트림으로만 흘러간다 — `tmux attach`해도 별도 pane이 없어 모니터링 지점이 분리돼 있다.
2. `jump` / `skip` 같은 control-plane 커맨드가 SIGUSR1로 outer inner 프로세스에 닿지만, **Codex subprocess는 detached 상태라 즉각 반응하지 못하고** 다음 phase에서 pending-action이 적용된다. 유저 체감상 "interactive phase에서 보낸 jump는 즉시, gate에서 보낸 jump는 지연"이라는 비대칭이 생긴다.
3. 반면 Phase 1/3/5(Claude interactive)는 tmux workspace pane 안에서 실행되고, sentinel 파일로 완료를 감지하며, SIGUSR1 경로가 즉각 반영된다.

### 착각 교정 (근거)

초기 문의는 "Codex gate가 Claude Code 내부 codex plugin을 경유한다"는 전제로 시작했으나, `src/runners/codex.ts:15/57/207`을 확인한 결과 **이미 네이티브 `codex` 바이너리를 `spawn()`으로 직접 호출**하고 있었다. 혼동의 원인은 (a) README `docs/specs/2026-04-12` 초기 설계의 "codex companion" 표현, (b) `README.md:368`의 "older companion path" 레거시 문구, (c) UI가 gate에 대해 별도 attach 지점을 제공하지 않아 "plugin 뒤에 숨어있다"는 인상이 생긴 점 세 가지다. 따라서 이번 변경은 **CLI 래핑 교체가 아니라 tmux / 실행 모드 통합**이다.

### 핵심 설계 결정

1. **Gate를 interactive phase로 흡수** — Phase 2/4/7도 Phase 1/3/5와 같은 lifecycle(`preparePhase` → prompt 파일 → tmux pane 주입 → sentinel 대기 → artifact 검증)을 탄다. `src/phases/runner.ts`의 `handleInteractivePhase` / `handleGatePhase` 이중 분기를 단일 `handlePhase`로 수렴한다. Post-processing(artifact 스펙 검증 vs verdict 파싱)만 phase 번호로 갈린다.

2. **Codex 실행 모드를 interactive TUI로 전환** — `codex exec [...] -` → `codex [PROMPT-from-stdin]` (top-level TUI). `codex exec resume <sid>` → `codex resume <sid>`. Codex CLI 0.124.0에서 두 interactive 경로 모두 `--model`, `-c model_reasoning_effort`, `-s workspace-write`, `-a never`, `--full-auto`, `[PROMPT]`/stdin을 동일하게 지원함을 검증했다 (`codex --help` 확인).

3. **Tmux 구조: 단일 workspace pane 재사용** — Phase N 종료 시 Claude가 이미 쓰는 `sendKeysToPane(C-c)` + `killProcessGroup` + 새 커맨드 주입 시퀀스에 Codex wrappedCmd를 흘려보낸다. 같은 pane에서 Claude → Codex → Claude → … 순차 실행. 유저는 한 pane만 attach해두면 전체 lifecycle을 연속 관찰한다. window 라이프사이클을 phase별로 나누는 대안(α)은 관리 비용 대비 이득이 없어 기각.

4. **완료 판정은 Claude와 동일한 sentinel 프로토콜** — Codex 프롬프트 말미에 "verdict를 `<runDir>/gate-<N>-verdict.md`에 쓰고, 완료 후 `<runDir>/phase-<N>.done`에 attemptId 기록" 지시를 추가한다. harness는 기존 `waitForPhaseCompletion(sentinelPath, attemptId, pid, ...)`를 그대로 호출한다. verdict 파서는 입력 소스를 stdout에서 파일로 바꾸는 것 외 로직 변경 없음.

5. **Same-phase same-session 원칙 유지** — `state.phaseCodexSessions[N]` 스키마, preset-incompat/`session_missing`/phase7-verify-reset/sidecar-hydration 네 가지 엣지 케이스 처리를 전부 보존한다. 2/3회차 REJECT-retry 시 `codex resume <sessionId>`가 동일 pane에서 이어 실행되어 Codex 쪽 대화 히스토리가 연속된다.

6. **SIGUSR1 일원화** — `src/signal.ts`의 기존 handler가 `sendKeysToPane(C-c)` + `killProcessGroup(lastWorkspacePid)`를 실행하므로, Codex가 pane 안에 있는 새 구조에서는 **gate 중 jump/skip도 즉각 중단**된다. pending-action.json 라우팅 로직은 불변.

7. **SessionId 추출 경로 변경** — 기존 stderr 정규식 파싱은 non-interactive `codex exec` 포맷 전제라 TUI에서 깨질 수 있다. Claude의 `src/runners/claude-usage.ts` 모델을 따라 `$CODEX_HOME/sessions/<uuid>.jsonl`을 파싱하는 `codex-usage.ts`를 추가한다. 타이밍은 "sentinel 감지 → `C-c` → 프로세스 종료 대기 → JSONL 읽기". flush 실패 시 100ms × 3회 backoff, 최종 실패 시 `tokens: null` + stderr warn (Claude 3-state 계약 재사용).

8. **Cutover 전략: 단일 PR** — feature flag로 구/신 gate runner를 병존시키면 sentinel 경로가 이중화되어 유지 비용이 크다. 대신 PR 머지 전에 본 태스크 자체를 dogfood(full flow)로 검증한다. 구 sidecar(`gate-N-stdout.log`)는 1버전간 읽기 전용 호환을 남기고 다음 릴리스에서 제거.

### Resolved Decisions (Phase 1 ratification에서 확정; source의 "열린 결정"을 종결)

- **R-D1. Verdict 파일 네이밍 = `gate-<N>-verdict.md`** — 기존 `gate-<N>-stdout.log` / `gate-<N>-prompt.md` 네이밍 컨벤션과 일치. 대안 `phase-<N>-verdict.md`는 Phase 1/3/5 artifact(`docs/specs/...`, `docs/plans/...`)와 의미 충돌 가능성이 있어 기각.
- **R-D2. `phaseCodexSessions` / `phaseClaudeSessions` 통합 맵 (`phaseSessions`)는 본 PR 도입하지 않음** — 마이그레이션 자체가 별도 PR 분량이고 dispatch 통합과 같은 PR에 묶으면 risk surface가 두 배가 된다. 본 PR은 두 맵 분리를 그대로 유지하고, 통합은 **다음 PR 후보** 항목(비-스코프 §1)에서 단독으로 다룬다. helper 함수 prep도 introduce하지 않는다 — YAGNI.
- **R-D3. JSONL flush backoff = `100ms × 3 retries`** — `src/runners/claude-usage.ts`의 동일한 backoff와 일관성을 맞춘다. SIGINT → flush 실측은 plan/impl phase의 정상 검증 책무이며, 본 spec은 동일한 시작 파라미터를 명시적으로 고정한다. 측정 결과 부적합하면 후속 patch에서 동일 패턴을 두 runner에 같이 조정한다.

### 모호함 없음

- Light flow에는 gate 2/7만 활성이므로 설계가 그대로 적용된다.
- Phase 6(verify, shell 스크립트)은 본 변경 범위 밖 — 영향 없음.
- UI(Ink)는 관찰 전용이라 변경 최소. attach 안내 footer 한 줄만 추가(`tmux attach -t <session>` + pane 이동 안내).
- `--codex-no-isolate` / per-run `CODEX_HOME` 격리 동작은 불변.

## Requirements / Scope

### 반드시 바뀌어야 하는 관찰 가능 동작

**R1.** Phase 2/4/7 실행 시, `tmux attach -t <session>`으로 붙은 유저는 **Codex TUI가 workspace pane 안에서 실행되는 것을 실시간으로 본다**. stdout이 control 화면에 `[codex] …` 접두로 긁혀 흐르는 기존 동작은 제거된다.

**R2.** Gate 실행 중 `phase-harness jump <N>` 또는 `phase-harness skip`을 보내면, **현 Codex 프로세스가 즉시 interrupt(`C-c`)되고 kill된다**. Phase 전환은 다음 loop tick에 반영된다. interactive phase 중 동일 커맨드를 보낸 경우와 시각적 반응 지연 차이가 나지 않는다(체감 1s 이내).

**R3.** Gate 완료 후 `<runDir>/gate-<N>-verdict.md`가 존재하고, 그 첫 markdown 섹션은 기존 계약과 동일한 `## Verdict` (`APPROVE` 또는 `REJECT`)로 시작한다. 유저는 이 파일을 직접 `cat`으로 확인할 수 있어야 하며, `events.jsonl`의 `gate_verdict` 이벤트가 이 파일 파싱 결과를 담는다.

**R4.** REJECT 이후 2/3회차 Gate 재진입 시 `codex resume <sessionId>`가 **동일 workspace pane에서 이어 실행**된다. `state.phaseCodexSessions[N].sessionId`가 보존되며, preset incompat / `session_missing` / phase7-verify-reset / sidecar-hydration 네 가지 엣지 케이스 처리는 기존 동작을 그대로 유지한다. 회귀 검증은 기존 `tests/gate.resume.*.test.ts` 스위트가 담당한다.

**R5.** `events.jsonl`의 `phase_end` 이벤트가 Phase 2/4/7에 대해서도 **`tokens` 필드 3-state 계약**(`{input, output, cacheRead, cacheCreate, total}` 객체 / `null` / 필드 부재)을 만족한다. 필드 이름은 기존 `claudeTokens`와 대칭을 유지하도록 `codexTokens`(Phase 1/3/5가 Codex preset인 경우도 동일)로 한다.

### 바뀌지 말아야 하는 것

**N1.** `state.json` 공개 스키마(`phaseCodexSessions`, `phasePresets`, `artifacts`, `pendingAction`)는 필드 이름/타입 변경 없음. `migrationVersion`만 bump하여 구버전 state를 기본값으로 보정해 로드한다.

**N2.** Gate의 `APPROVE` / `REJECT` 결과 스키마(Scope, P0/P1/P2/P3 severity, carryover feedback, reopen 규칙)는 불변.

**N3.** `scripts/harness-verify.sh`(Phase 6), `--enable-logging` 기본 OFF 정책, P1-only escalation, 자율 모드(Codex 3 reject → 4회차 강제 통과) 같은 운영 규칙은 불변.

**N4.** CLI 플래그 표면(`run`, `resume`, `jump`, `skip`, `start --light`, `install-skills`, `--codex-no-isolate` 등)은 이번 PR에서 새 플래그를 추가하지 않는다. footer UX 안내만 미세 조정.

### 비-스코프 (다음 PR 후보)

- `phaseCodexSessions` + `phaseClaudeSessions` → `phaseSessions` 통합 맵 마이그레이션.
- `harness attach` 편의 서브커맨드.
- Phase 1/3/5 Codex preset 사용 시 **interactive** TUI 전환 (현재는 `codex exec`로 non-interactive; 본 PR에서는 gate만 interactive화).
- Gate의 "유저가 중간 질문/근거 요구"를 정식 UX로 드러내기(가능은 해지지만 문서화/안내는 별도 PR).

## 구현 개요 (Plan phase가 채울 영역 스텁)

### 모듈별 영향 요약

- `src/runners/codex.ts` — `runCodexInteractive` / `runCodexGate` 병합 → `spawnCodexInPane(preset, promptFile, resumeInfo, codexHome)`. 반환은 `{ pid, sessionIdPromise }` 구조로 통일. stderr 정규식 파싱 제거.
- `src/runners/codex-usage.ts` (신규) — `claude-usage.ts`와 대칭. JSONL 파싱 + 토큰 집계 + sessionId 추출. backoff = 100ms × 3 (R-D3).
- `src/phases/runner.ts` — `handleInteractivePhase` / `handleGatePhase` → `handlePhase`. Post-processing만 분기.
- `src/phases/gate.ts` — dispatch 책임 제거 후 **verdict 파일 파싱 + 엣지 케이스 판정 + persistence**만 담당. 파일명은 유지(책임 축소로 크기 절반 예상).
- `src/phases/verdict.ts` — `buildGateResult` 시그니처 `(exitCode, stdout, stderr)` → `(sentinelStatus, verdictFilePath)`. 내부 `parseVerdict`는 불변.
- `src/phases/interactive.ts` — `validatePhaseArtifacts`에 gate verdict 파일 검증 분기 추가(또는 gate.ts로 위임). `waitForPhaseCompletion`은 pure. 변경 없음.
- `src/context/assembler.ts` — `assembleGatePrompt` / `assembleGateResumePrompt` 말미에 §Output Protocol 블록 주입(verdict 경로 = `gate-<N>-verdict.md`, sentinel = `phase-<N>.done`). `<attemptId>`, `<runDir>` 템플릿 변수 추가.
- `src/state.ts` / `src/types.ts` — `migrationVersion` bump. `GateSessionInfo`는 변경 없음. `phase_end.codexTokens` 필드 타입 추가.
- `src/ink/components/Footer.tsx` — attach 안내 한 줄 보강. 나머지 컴포넌트는 불변.
- 테스트 — `tests/gate.*.test.ts`의 spawn mock에서 Codex 커맨드 인자 기대값을 `exec` → top-level로 수정. `tests/claude-usage.test.ts` 패턴을 참고해 `codex-usage.test.ts` 추가. integration 테스트는 sentinel-첫-경로로 재작성.
- 문서 — `README.md`, `README.ko.md`(Prerequisites, Troubleshooting), `docs/HOW-IT-WORKS.md`/`.ko.md`(Gate 섹션 + "interactive/gate lifecycle 통합").

### 하위 호환

- 구 `gate-<N>-stdout.log` sidecar는 1버전간 읽기 전용 호환을 유지(존재하면 무시, 없어도 무방). 다음 릴리스에서 제거 — README 변경 로그에 기록.
- `state.json` `migrationVersion` bump으로 구버전 state는 기본값으로 보정 로드(필드 추가만 발생; 기존 키 의미 변화 없음).

## Acceptance / 평가 기준 (Eval checklist 초안)

- **E1.** `phase-harness start --enable-logging "<demo task>"`를 실행하고 `tmux attach -t <session>`으로 붙은 상태에서 P1~P7을 통과시킨다. **workspace pane에 Claude TUI와 Codex TUI가 교대로 떠야** 한다. 스크린샷/pane capture 증거 필요.
- **E2.** P2/P4 REJECT를 프롬프트 조작으로 강제한 fixture로 **같은 sessionId를 이어받은 resume**이 같은 pane에서 일어나는 것을 확인. `state.phaseCodexSessions["2"|"4"|"7"].sessionId`가 retry 전후로 동일해야 한다.
- **E3.** 진행 중인 gate에 `phase-harness jump 3`을 보냈을 때 **Codex 프로세스가 1s 이내 kill되고** workspace pane이 새 Phase 3 커맨드로 덮이는 것을 `tmux capture-pane`으로 확인.
- **E4.** `events.jsonl`에서 P2/P4/P7 `phase_end` 레코드가 `codexTokens: {...}`(성공), `null`(추출 실패), 필드 부재(해당 없음) 중 하나임을 스위프로 검증. 3-state 계약 위반 없음.
- **E5.** `pnpm tsc --noEmit`, `pnpm vitest run`, `pnpm build`가 모두 green.
- **E6.** `README.md` / `README.ko.md` / `docs/HOW-IT-WORKS.md` / `docs/HOW-IT-WORKS.ko.md`에 "gate도 workspace pane에서 실행" 사실이 반영되고, `--enable-logging` 기본값, CLI 플래그 표면, resume/retry 규칙 서술이 현 구현과 일치.
- **E7.** 기존 `tests/gate.resume.*.test.ts` 전부 green. Codex spawn mock 기대값만 업데이트, lineage 분기 커버리지는 유지.

## Invariants (gate validator 입력)

- 본 spec 파일 경로 = `/Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/codex-session/docs/specs/2026-04-24-codex-gate-phase-2-4-7-4f26-design.md` (고정).
- `## Complexity` 섹션의 다음 비공백 줄 = `Medium`으로 시작 (case-insensitive). enum 외 토큰 금지.
- `## Context & Decisions` 섹션이 spec 본문 상단(첫 H2 두 개 안)에 위치.
- 모든 R / N / E 식별자는 본 spec 안에서만 정의; 다른 spec과 공유 없음.

## Implementation Plan

(Plan phase — `writing-plans` — 에서 채움. 본 spec의 §구현 개요 + §Resolved Decisions + §Acceptance가 입력으로 사용됨.)
