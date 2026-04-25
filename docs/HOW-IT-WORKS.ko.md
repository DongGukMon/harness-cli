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
| `opus-1m-xhigh` | claude | `claude-opus-4-7[1m]` | `xhigh` |
| `opus-1m-high` | claude | `claude-opus-4-7[1m]` | `high` |
| `sonnet-1m-max` | claude | `claude-sonnet-4-6[1m]` | `max` |
| `sonnet-1m-high` | claude | `claude-sonnet-4-6[1m]` | `high` |
| `opus-max` | claude | `claude-opus-4-7` | `max` |
| `opus-xhigh` | claude | `claude-opus-4-7` | `xhigh` |
| `opus-high` | claude | `claude-opus-4-7` | `high` |
| `sonnet-max` | claude | `claude-sonnet-4-6` | `max` |
| `sonnet-high` | claude | `claude-sonnet-4-6` | `high` |
| `codex-high` | codex | `gpt-5.5` | `high` |
| `codex-medium` | codex | `gpt-5.5` | `medium` |

기본 매핑:
- full flow: P1 `opus-1m-xhigh`, P2 `codex-high`, P3 `sonnet-high`, P4 `codex-high`, P5 `sonnet-high`, P7 `codex-high`
- light flow: P1 `opus-1m-xhigh`, P2 `codex-high`, P5 `sonnet-high`, P7 `codex-high`

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

## 멀티 워크트리 플로우

`phase-harness start`와 `phase-harness run`은 **외부(non-git) 디렉터리**에서 실행을 지원합니다. 이 디렉터리에는 depth 1에 N개의 git 서브 레포가 있을 수 있습니다.

### 레포 자동 감지

1. **단일 레포 (레거시)**: outer cwd가 git 레포이면 해당 레포가 유일한 tracked repo가 됩니다. 기존 동작과 동일합니다.
2. **멀티 레포 자동 감지**: outer cwd가 git 레포가 아니면 depth-1 서브디렉터리를 스캔하고, 숨김 디렉터리 및 일반적인 비-레포 디렉터리(`node_modules`, `dist`, `build`, `.harness`)를 제외하여 발견된 모든 git 레포를 알파벳순으로 추적합니다.
3. **`--track <path>`**: 자동 감지를 명시적인 레포 경로로 재정의합니다. 경로는 outer cwd 내부에 있어야 합니다.
4. **`--exclude <dir>`**: 자동 감지 중 디렉터리를 건너뜁니다 (반복 가능).

### 상태: `trackedRepos[]`

`state.json`은 `trackedRepos: TrackedRepo[]`를 저장합니다 — tracked 레포마다 하나의 엔트리:
- `path`: 레포의 절대 경로
- `baseCommit`, `implRetryBase`: 레포별 커밋 앵커
- `implHead`: Phase 5 성공 후의 HEAD (완료 전에는 null)

첫 번째 엘리먼트(`trackedRepos[0]`)가 **docs 홈**입니다 — spec, plan, eval 아티팩트가 여기에 커밋됩니다.

레거시 미러(`state.baseCommit`, `state.implRetryBase`, `state.implCommit`)는 단일 레포 소비자가 변경 없이 동작하도록 유지되며, 매 state 쓰기 시 `trackedRepos[0]`으로부터 자동 동기화됩니다(`syncLegacyMirror`).

### Phase 5 성공 기준

tracked 레포 중 **하나 이상**이 `implRetryBase`를 넘어 진행되면 Phase 5가 성공합니다. 수정되지 않은 레포는 `implHead = null`으로 유지됩니다.

#### Codex 프리셋 + Phase 5 — commit 누락 함정 (issue #84)

Phase 5는 적어도 하나의 tracked 레포의 HEAD가 `implRetryBase`를 넘어 진전했을 때만 완료로 간주합니다. Codex가 구현은 마치고 sentinel은 남겼지만 commit을 빠뜨리는 경우가 있는데, validator 입장에서는 "진전 없음 = failed"로 보입니다. 하네스는 이 케이스(Codex 프리셋 + sentinel fresh + working tree dirty)를 정확히 검출하면 stderr에 `⚠️  Phase 5 failed: Codex completed (sentinel fresh) but left uncommitted changes` 블록을 출력하고, `phase_end` 이벤트에 `uncommittedRepos: [{ path, count }, …]` 필드를 부착해 operator가 다음 중 하나를 선택할 수 있게 안내합니다:

- 변경분을 직접 commit한 뒤 Resume, 또는
- Phase 5 프리셋을 Claude 계열(예: `claude-sonnet-default`)로 전환 — `superpowers:subagent-driven-development`가 commit 규율을 강제하므로 안전합니다.

Claude 브랜치는 wrapper skill에서 commit을 강제하므로 이 함정에 빠지지 않습니다.

### Gate diff (Phase 2/4/7)

- **N=1이고 `trackedRepos[0].path === cwd`**: diff 출력이 멀티 워크트리 이전 형식과 바이트 단위로 동일합니다 (레이블 없음).
- **N>1 또는 cwd가 아닌 단일 레포**: 각 레포의 diff가 `### repo: <relPath>` 헤딩 아래 출력됩니다. 파일별 트런케이션은 마크다운 래퍼 전에 실행되며, 전체 크기 상한이 concat 후 적용됩니다.

### Codex (outer-cwd gate)

outer cwd가 git 레포가 아니어도 codex가 trust 프롬프트나 git-repo 안전 거절 없이 진입할 수 있도록, `ensureCodexIsolation`이 `<runDir>/codex-home/config.toml`에 `[projects."<realpath cwd>"] trust_level = "trusted"` 엔트리를 자동으로 기록합니다. (codex 0.124.0에서 top-level `--skip-git-repo-check` 플래그가 제거됐기 때문에 trust-entry 방식이 정식 대체 경로입니다.)

---

## Phase별 요약

| Phase | 기본 preset | runner 유형 | 주요 산출물 | reject/fail 시 |
|---|---|---|---|---|
| P1 Spec / Design+Plan | `opus-1m-xhigh` | interactive | spec/design 문서 + decisions + checklist(light) | Gate 2 reject 시 P1 재오픈, light P7 design/mixed reject도 P1 재오픈 |
| P2 Spec Gate | `codex-high` | gate | verdict + feedback sidecar | P1 재오픈 |
| P3 Plan | `sonnet-high` | interactive | plan + checklist | Gate 4 reject 시 P3 재오픈 |
| P4 Plan Gate | `codex-high` | gate | verdict + feedback sidecar | P3 재오픈 |
| P5 Implement | `sonnet-high` | interactive | git commits | P6 fail, full-flow P7 reject, light-flow impl reject 시 P5 재오픈 |
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

선택된 preset의 runner가 `codex`이면 harness는 workspace pane에 top-level `codex` TUI를 띄웁니다. Claude와 동일한 UX(입력 라인 + reasoning stream 가시화 + 실시간 개입 가능):

```bash
codex --model <model> -c model_reasoning_effort="<effort>" --dangerously-bypass-approvals-and-sandbox "$(cat <prompt-file>)"
```

프롬프트는 셸 command-substitution(`$(cat ...)`)을 통해 실행 시점에 positional CLI argument로 주입됩니다. tmux send-keys가 운반하는 건 짧은 wrapper뿐이라 프롬프트 크기가 수십 KB가 되어도 문제없습니다. agent 자신이 phase 프롬프트의 지시에 따라 tool use로 `phase-N.done` sentinel을 작성하며, 이는 Claude의 동작 패턴과 일치합니다.

승인/샌드박스: 모든 Codex interactive phase(1/3/5)에 `--dangerously-bypass-approvals-and-sandbox`(yolo)를 적용합니다. 신뢰 경계는 harness 호출 시점이며, codex는 샌드박스/승인 프롬프트 없이 실행되므로 워크트리 간 쓰기·git 조작이 자율 루프를 yes/no 프롬프트로 막지 않습니다.

### Gate phase

gate phase도 preset 기반입니다. Codex gate는 interactive phase와 **동일한 tmux workspace pane**에서 top-level `codex` TUI로 실행됩니다.

```bash
codex --model <model> -c model_reasoning_effort="<effort>" --dangerously-bypass-approvals-and-sandbox "$(cat <prompt-file>)"
```

reopen 시에는 동일한 플래그로 `codex resume <session_id>`를 사용합니다. gate phase를 Claude preset으로 강제로 매핑한 경우에만 `claude --print` gate subprocess를 사용합니다.

Codex는 `<runDir>/gate-N-verdict.md`에 판정 결과를 기록하고, harness는 `<runDir>/phase-N.done` sentinel 파일로 완료를 감지합니다. gate 실행 중에는 control pane footer에 `attach: tmux attach -t <session>`이 표시되므로 workspace pane으로 이동해 실시간으로 리뷰 진행 상황을 확인할 수 있습니다.

### Codex isolation

기본적으로 Codex subprocess는 `<runDir>/codex-home/` 안에서 실행되며, 다음 두 가지를 harness가 채워 넣습니다:
- 사용자의 실제 `~/.codex/` (또는 `$CODEX_HOME`)에서 `auth.json` symlink
- `[projects."<realpath cwd>"] trust_level = "trusted"` 단일 엔트리만 담은 harness 제어용 `config.toml` — codex TUI가 trust 프롬프트나 git-repo 거절 없이 cwd를 받아들이도록 함

이렇게 해야 사용자 전역 `CODEX_HOME` 규약이 런타임에 섞여들지 않고, cwd trust도 사용자 글로벌 config을 변경하지 않은 채 per-run으로만 적용됩니다. `--codex-no-isolate`로 isolation을 끄면 사용자의 `~/.codex/config.toml` 및 trust 캐시가 그대로 사용되며, 이 모드에서는 비-git cwd에 처음 들어갈 때 trust 프롬프트가 뜹니다.
`--codex-no-isolate`는 이 안전장치를 끕니다.

Claude Code 환경에서 1M context를 사용할 수 없다면, 모델 선택기에서 기존 non-1M Claude preset을 계속 사용하거나 자체 포크의 `src/config.ts` 기본값을 바꾸면 됩니다.

---

## Verify 동작 (Phase 6)

Phase 6은 항상 번들된 `harness-verify.sh` 스크립트를 실행합니다.
스크립트는 설치된 패키지 내부의 `dist/scripts/harness-verify.sh`를 사용합니다. npm 설치 시 실행 권한이 제거된 경우, 런타임에 자동으로 복원합니다.

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
