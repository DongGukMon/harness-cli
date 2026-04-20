# harness-cli 동작 원리

이 문서는 `src/` 구현 기준의 현재 `harness-cli` 런타임 동작을 설명합니다.
문서와 코드가 충돌하면 코드를 우선하고, 같은 변경에서 이 문서도 같이 갱신하세요.

---

## 개요

`harness-cli`는 tmux 기반 control/workspace 레이아웃 안에서 작업을 실행하고, 상태를 `.harness/<runId>/` 아래에 저장합니다.
기본 라이프사이클은 다음과 같습니다.

```text
Full flow
P1 spec → P2 spec gate → P3 plan → P4 plan gate → P5 implement → P6 verify → P7 eval gate

Light flow (`--light`)
P1 design+plan → P2 pre-impl gate → P5 implement → P6 verify → P7 eval gate
```

핵심 불변식:
- 모든 phase는 새 OS 프로세스에서 실행됩니다
- phase 간 컨텍스트는 채팅 메모리가 아니라 파일과 `state.json`으로 전달됩니다
- interactive/gate phase는 시작/재개 시 고른 preset에 따라 runner가 결정됩니다
- Phase 6은 항상 고정된 verify 스크립트이며 AI runner를 쓰지 않습니다

---

## 내장 preset과 기본값

내장 preset은 `src/config.ts`에 정의되어 있습니다.

| id | runner | model | effort |
|---|---|---|---|
| `opus-1m-max` | claude | `claude-opus-4-7[1m]` | `max` |
| `opus-1m-xhigh` | claude | `claude-opus-4-7[1m]` | `xHigh` |
| `opus-1m-high` | claude | `claude-opus-4-7[1m]` | `high` |
| `sonnet-1m-max` | claude | `claude-sonnet-4-6[1m]` | `max` |
| `sonnet-1m-high` | claude | `claude-sonnet-4-6[1m]` | `high` |
| `opus-max` | claude | `claude-opus-4-7` | `max` |
| `opus-xhigh` | claude | `claude-opus-4-7` | `xHigh` |
| `opus-high` | claude | `claude-opus-4-7` | `high` |
| `sonnet-max` | claude | `claude-sonnet-4-6` | `max` |
| `sonnet-high` | claude | `claude-sonnet-4-6` | `high` |
| `codex-high` | codex | `gpt-5.4` | `high` |
| `codex-medium` | codex | `gpt-5.4` | `medium` |

기본 매핑:
- full flow: P1 `opus-1m-high`, P2 `codex-high`, P3 `sonnet-1m-high`, P4 `codex-high`, P5 `sonnet-1m-high`, P7 `codex-high`
- light flow: P1 `opus-1m-high`, P2 `codex-high`, P5 `sonnet-1m-high`, P7 `codex-high`

사용자는 `phase-harness start` / `phase-harness resume` 때 모든 non-verify phase preset을 바꿀 수 있고,
선택값은 `state.phasePresets`에 저장됩니다.
기존 saved run은 자동으로 1M 기본값으로 마이그레이션되지 않고, 새로 만드는 run에만 1M 기본값이 자동 적용됩니다.

---

## Full flow와 light flow

### Full flow

구현 전에 독립 리뷰가 중요한 작업에 적합합니다.
주요 산출물은 다음과 같습니다.
- P1 → `docs/specs/<runId>-design.md` + `.harness/<runId>/decisions.md`
- P3 → `docs/plans/<runId>.md` + `.harness/<runId>/checklist.json`
- P5 → git commits
- P6 → `docs/process/evals/<runId>-eval.md`

### Light flow (`phase-harness start --light`)

light flow는 phase 3/4를 `skipped`로 초기화하고 phase loop가 그대로 건너뜁니다.
Phase 2는 활성(`pending`) 상태로 결합 design doc에 대한 pre-impl Codex 리뷰를 실행합니다.
control panel에서 skipped phase는 `(skipped)`로 표시됩니다.

light flow 특이사항:
- P1은 결합 design+plan 문서를 `docs/specs/<runId>-design.md`에 작성합니다
- 결합 문서에는 `## Complexity`, `## Implementation Plan`이 반드시 있어야 합니다
- `checklist.json`은 여전히 `.harness/<runId>/checklist.json`으로 별도 유지됩니다
- flow는 run 생성 시 고정되므로 `phase-harness resume --light`는 거부됩니다
- P2 (pre-impl gate): Codex가 결합 design doc를 4축 루브릭으로 리뷰합니다. REJECT 시 즉시 P1 재진입 — feedback은 `pendingAction.feedbackPaths`로만 전달되고 `state.carryoverFeedback`는 Gate 2에서 설정되지 않습니다. Gate retry limit 3 (풀 플로우 P2와 동일). P2 활성화 이전에 생성된 legacy light run은 `phases['2']='skipped'` 상태를 유지합니다 — activation은 `createInitialState`를 통한 forward-only이고 retroactive migration이 아닙니다.
- gate retry limit: light P2 = 3회, light P7 = 5회, 풀 플로우 = 3회
- P7 `REJECT` 시:
  - `Scope: impl` → P5 재오픈
  - `Scope: design`, `Scope: mixed`, scope 누락 → P1 재오픈 + carryover feedback을 P5까지 유지

---

## Phase별 요약

| Phase | 기본 preset | runner 유형 | 주요 산출물 | reject/fail 시 |
|---|---|---|---|---|
| P1 Spec / Design+Plan | `opus-1m-high` | interactive | spec/design 문서 + decisions + checklist(light) | Gate 2 reject 시 P1 재오픈, light P7 design/mixed reject도 P1 재오픈 |
| P2 Spec Gate | `codex-high` | gate | verdict + feedback sidecar | P1 재오픈 |
| P3 Plan | `sonnet-1m-high` | interactive | plan + checklist | Gate 4 reject 시 P3 재오픈 |
| P4 Plan Gate | `codex-high` | gate | verdict + feedback sidecar | P3 재오픈 |
| P5 Implement | `sonnet-1m-high` | interactive | git commits | P6 fail, full-flow P7 reject, light-flow impl reject 시 P5 재오픈 |
| P6 Verify | 고정 스크립트 | 자동 셸 | eval report + verify sidecar | fail 시 P5 재오픈, retry limit 3 |
| P7 Eval Gate | `codex-high` | gate | verdict + feedback sidecar | full은 P5, light는 scope에 따라 P5 또는 P1 |

현재 timeout 상수(`src/config.ts`):
- interactive: 30분
- gate: 6분
- verify: 5분

---

## Runner 동작

### Claude interactive phase

선택된 preset의 runner가 `claude`이면, harness는 tmux workspace pane 안에서 Claude를 실행하고 현재 `phaseAttemptId`를 Claude session ID로 고정합니다.

```bash
claude --session-id <attemptId> --model <model> --effort <effort> @<prompt-file>
```

현재 동작:
- PID는 `claude-<phase>-<attemptId>.pid` 파일로 캡처됩니다
- Claude 토큰 사용량은 pinned session JSONL에서 다시 읽어 `phase_end.claudeTokens`에 붙습니다
- 새 Claude interactive phase를 띄우기 전에 이전 workspace PID를 종료하려 시도해, 오래된 Claude 프롬프트에 입력이 타이핑되는 것을 막습니다

### Codex interactive phase

선택된 preset의 runner가 `codex`이면 다음 형태로 실행합니다.

```bash
codex exec --model <model> -c model_reasoning_effort="<effort>" --sandbox <level> --full-auto -
```

sandbox 레벨:
- phase 1, 3 → `workspace-write`
- phase 5 → `danger-full-access`

Codex interactive phase는 sentinel 파일을 쓰지 않고, subprocess 종료 후 harness가 산출물을 직접 검증합니다.

### Gate phase

gate phase도 preset 기반입니다.
기본적으로는 예전 companion 경로가 아니라 실제 `codex` CLI를 사용합니다.

```bash
codex exec --model <model> -c model_reasoning_effort="<effort>" -
```

gate phase를 Claude preset으로 강제로 매핑한 경우에만 `claude --print` gate subprocess를 사용합니다.

### Codex isolation

기본적으로 Codex subprocess는 `<runDir>/codex-home/` 안에서 실행되고, 그 안에는 `auth.json`만 symlink됩니다.
이렇게 해야 사용자 전역 `CODEX_HOME` 규칙이 런타임에 섞여들지 않습니다.
`--codex-no-isolate`는 이 안전장치를 끕니다.

Claude Code 환경에서 1M context를 사용할 수 없다면, 모델 선택기에서 기존 non-1M Claude preset을 계속 사용하거나 자체 포크의 `src/config.ts` 기본값을 바꾸면 됩니다.

---

## Verify 동작 (Phase 6)

Phase 6은 항상 번들된 `harness-verify.sh` 스크립트를 실행합니다.
스크립트 경로는 설치된 패키지 내부를 우선 사용하고, 없으면 레거시 fallback으로 `~/.claude/scripts/harness-verify.sh`를 사용합니다.

입출력:
- 입력: `.harness/<runId>/checklist.json`
- 출력: `docs/process/evals/<runId>-eval.md`
- sidecar: `verify-result.json`, `verify-feedback.md`, `verify-error.md`

verify 실행 전에는 eval report 경로를 제외한 working tree가 깨끗해야 하며,
기존 eval report가 있으면 상태에 맞게 정리/교체합니다.
verify PASS면 eval report를 auto-commit합니다. 단, eval report 경로가 `.gitignore` 대상이면 commit을 skip하고 경고를 stderr에 한 줄 남깁니다(`evalCommit`은 `null`로 유지). FAIL이면 `verify-feedback.md`를 남기고 P5를 재오픈합니다.

---

## 세션 라이프사이클과 고아 정리

### Run ID 형식

모든 run ID는 `YYYY-MM-DD-<slug>-<rrrr>` 형식입니다. `<rrrr>`은 `crypto.randomBytes(2)`에서 생성한 4자리 16진 랜덤 토큰입니다(예: `2026-04-20-my-task-a3f1`).
랜덤 suffix 덕분에 기존 `untitled-2`, `untitled-3`… 카운터 ladder 없이 반복 시작에도 고유한 ID가 생성되고, 동시 시작 레이스 윈도우도 줄어듭니다.
첫 번째 랜덤 후보가 이미 존재하는 경우(극히 드문 충돌) 최대 5회 재시도 후 마지막으로 뽑힌 base에 `-N` 카운터를 붙여 종료를 보장합니다.

### 고아 tmux 세션

비정상 종료(창 닫기, kill -9, SIGHUP) 시 `harness-<runId>` tmux 세션이 남을 수 있습니다. inner 프로세스의 정상 종료 경로에서만 정리가 실행되기 때문입니다.

**`phase-harness cleanup`**은 `harness-*` tmux 세션을 열거하고 현재 `.harness/` 기준으로 각각을 분류한 뒤 고아 세션을 선택적으로 종료합니다.

| 분류 | 조건 | 동작 |
|---|---|---|
| `active` | run 디렉토리 존재 + `run.lock` 존재 + `repo.lock` active + `lock.runId === runId` | 종료 안 함 |
| `orphan` | run 디렉토리 존재 + 다음 중 하나: `run.lock` 없음, `repo.lock` 없음, `repo.lock` stale, `repo.lock`이 다른 run 가리킴 | 확인 후 종료 |
| `unknown` | 현재 `.harness/` 아래에 run 디렉토리 없음 — 다른 repo/worktree 세션일 수 있음 | 종료 안 함 |

플래그: `--dry-run` (출력만, 종료 없음), `--yes` (확인 프롬프트 생략).

**`start`**는 새 tmux 세션 생성 전에 자동으로 조용한 sweep을 실행합니다(`cleanup --yes --quiet`와 동일). sweep 실패는 치명적이지 않은 경고입니다.

---

## 상태와 아티팩트

권위 있는 run 상태는 `.harness/<runId>/state.json`입니다.
중요 필드는 다음과 같습니다.
- `flow`: `full` / `light`
- `currentPhase`, `status`, `phases`
- `phasePresets`
- `gateRetries`, `verifyRetries`
- `pendingAction`
- `carryoverFeedback` (light P7 design/mixed reject 핸드오프)
- `specCommit`, `planCommit`, `implCommit`, `evalCommit`, `verifiedAtHead`
- `phaseAttemptId`, `phaseOpenedAt`
- tmux/session bookkeeping
- `loggingEnabled`, `codexNoIsolate`

아티팩트 경로:
- spec/design 문서: `docs/specs/<runId>-design.md`
- plan 문서: `docs/plans/<runId>.md` (full flow만)
- decisions: `.harness/<runId>/decisions.md`
- checklist: `.harness/<runId>/checklist.json`
- eval report: `docs/process/evals/<runId>-eval.md`

상태 파일은 항상 atomic하게 기록됩니다: `state.json.tmp` 쓰기 → fsync → rename.

---

## Resume와 복구

`phase-harness resume`는 세 경우를 처리합니다.
1. tmux session alive + inner alive → attach만 수행
2. tmux session alive + inner dead → 가능한 경우 기존 control pane에서 inner 재시작
3. tmux session 없음 → tmux를 다시 만들고 저장 상태부터 계속 진행

복구 메커니즘:
- atomic state write
- Claude interactive phase용 sentinel 기반 완료 판정
- `pendingAction` replay
- artifact commit anchor (`specCommit`, `planCommit`, `implCommit`, `evalCommit`)
- gate / verify sidecar

`phase-harness jump <phase>`는 완료된 run이 아닌 이상 backward-only입니다.
light flow에서는 skipped phase로 jump할 수 없습니다.

`runPhaseLoop`가 종료해도 inner process는 즉시 종료하지 않고 control panel을 유지합니다:
- 실패한 phase가 있으면 인라인 액션 루프(`[R]esume` / `[J]ump` / `[Q]uit`)에 진입합니다. R/J는 state를 정리한 뒤 그대로 `runPhaseLoop`에 재진입하고, Q는 정상 종료합니다.
- 전체 완료 시에는 idle 요약 패널(eval report 경로, commit range, wall time)이 뜨고 `SIGINT`를 기다립니다.

이 동작은 `src/phases/terminal-ui.ts`에 있으며, 위에서 설명한 outer-process `commands/resume.ts` / `commands/jump.ts` (tmux/lock/SIGUSR1 plumbing)는 변경되지 않은 채 cross-process 복구 흐름을 그대로 담당합니다.

---

## 로깅과 footer

세션 로깅은 `--enable-logging`으로 켜는 opt-in 기능입니다.
켜면 다음 경로에 기록됩니다.

```text
~/.harness/sessions/<repoKey>/<runId>/
  meta.json
  events.jsonl
  summary.json
```

주요 이벤트는 `phase_start`, `phase_end`, `gate_verdict`, `gate_error`, `gate_retry`, `verify_result`, `ui_render`, `terminal_action`, `session_end` 등입니다.
control pane footer는 이 로그를 바탕으로 경과 시간과 Claude/gate 토큰 합계를 집계합니다.

---

## Preflight와 플랫폼 가정

핵심 preflight는 Node, tmux, TTY, platform, verify script, `jq`, 그리고 다음 phase에 필요한 runner CLI를 검사합니다.
지원 플랫폼은 macOS와 Linux입니다.
tmux 밖에서 시작하면 iTerm2를 먼저 시도하고, 그다음 Terminal.app, 마지막으로 수동 `tmux attach` 명령을 출력합니다.

---

## 실제 동작 확인용 소스 파일

행동이 헷갈릴 때는 먼저 아래 파일을 보세요.
- `src/config.ts`
- `src/commands/start.ts`
- `src/commands/resume.ts`
- `src/commands/inner.ts`
- `src/phases/runner.ts`
- `src/phases/interactive.ts`
- `src/phases/gate.ts`
- `src/phases/verify.ts`
- `src/runners/claude.ts`
- `src/runners/codex.ts`
- `src/runners/codex-isolation.ts`
- `src/state.ts`
