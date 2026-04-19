# phase-harness

`phase-harness`는 AI 기반 개발 작업을 **재현 가능하고 재개 가능한 tmux 워크플로우**로 실행하는 TypeScript CLI입니다.

지원 기능:
- **7단계 full flow**: spec → spec gate → plan → plan gate → implement → verify → eval gate
- 작은 작업을 위한 **5단계 light flow**: design+plan → pre-impl gate → implement → verify → eval gate
- 시작/재개 시점의 **phase별 모델 preset 선택**
- `resume`, `status`, `list`, `skip`, `jump`를 통한 **tmux 기반 복구/제어**
- **선택적 세션 로깅**과 경과 시간·토큰 수를 보여주는 live footer

하나의 긴 채팅 세션을 계속 끌고 가는 대신, harness는 파일과 상태를 통해 phase 간 컨텍스트를 넘깁니다. 그래서 각 phase를 깨끗하게 다시 시작할 수 있고, 독립 리뷰 단계도 구현 세션의 문맥을 그대로 물려받지 않습니다.

---

## 각 phase에서 실제로 무엇이 실행되나

기본값은 다음과 같습니다:
- interactive phase(1 / 3 / 5) → **Claude** preset
- review gate(2 / 4 / 7) → **Codex** preset
- phase 6 → 번들된 **`harness-verify.sh`** 스크립트

이 기본값은 런타임에 바꿀 수 있습니다. `phase-harness start` / `phase-harness resume`를 실행할 때마다, 남아 있는 non-verify phase들에 대해 모델 preset 선택 UI가 먼저 뜹니다.

현재 내장 preset:
- `opus-1m-max`, `opus-1m-xhigh`, `opus-1m-high`
- `sonnet-1m-max`, `sonnet-1m-high`
- `opus-max`, `opus-xhigh`, `opus-high`
- `sonnet-max`, `sonnet-high`
- `codex-high`, `codex-medium`

기본 phase 매핑:
- Phase 1 → `opus-1m-high`
- Phase 2 → `codex-high`
- Phase 3 → `sonnet-1m-high`
- Phase 4 → `codex-high`
- Phase 5 → `sonnet-1m-high`
- Phase 7 → `codex-high`

---

## Full flow와 light flow

### Full flow (`phase-harness start "task"`)

```text
P1 spec → P2 spec gate → P3 plan → P4 plan gate → P5 implement → P6 verify → P7 eval gate
```

마이그레이션, API/contract 변경, 보안 민감 작업처럼 **구현 전에 독립 리뷰가 중요한 경우** full flow가 적합합니다.

### Light flow (`phase-harness start --light "task"`)

```text
P1 design+plan → P2 pre-impl gate → P5 implement → P6 verify → P7 eval gate
```

light flow에서는:
- **3 / 4 phase**가 `skipped` 상태로 처리됩니다 (P2/P7 Codex gate는 활성)
- phase 1이 `## Complexity`, `## Open Questions`, `## Implementation Plan`이 들어간 결합 문서를 만들어야 합니다
- **P2 (pre-impl gate)**: Codex가 결합 설계 문서를 light flow 전용 design rubric으로 리뷰합니다. REJECT 시 phase 1을 reopen하고, 피드백은 `pendingAction.feedbackPaths`로만 전달됩니다 (Gate 2는 `carryoverFeedback`를 쓰지 않음).
- phase 7 피드백이 구현 범위면 **phase 5**, 설계/혼합 범위면 **phase 1**을 다시 엽니다
- gate retry 한도: **light P2 = 3**, **light P7 = 5**, full flow = 3
- flow는 run 생성 시점에 고정되므로 `phase-harness resume --light`는 거부됩니다

---

## tmux 안에서의 실행 구조

Harness는 tmux 안에 **pane 기반 control surface**를 만듭니다:
- **control pane**: 현재 phase, retry, gate/verify 출력, escalation 메뉴
- **workspace pane**: 현재 interactive agent 세션

실행 위치에 따라 동작이 달라집니다:
- **tmux 밖에서 시작**: `harness-<runId>` 이름의 dedicated session 생성
- **tmux 안에서 시작**: 현재 tmux session을 재사용하고 `harness-ctrl` window 생성

macOS에서는 가능한 경우 **iTerm2 → Terminal.app** 순서로 세션을 자동으로 엽니다.
Linux이거나 AppleScript 실행이 실패하면, 아래처럼 수동 attach 명령만 출력합니다:

```bash
tmux attach -t harness-<runId>
```

---

## 사전 요구사항

Harness는 git working tree를 기준으로 동작하며, phase 경계에서 artifact를 자동 커밋합니다.
먼저 아래를 준비하세요:

| 의존성 | 필요한 이유 |
|---|---|
| Node.js 18+ | CLI 런타임 |
| tmux | 세션 / pane 오케스트레이션 |
| Claude Code CLI (`claude`) | 기본 interactive runner |
| Codex CLI (`codex`) | 기본 gate runner, 그리고 선택 가능한 interactive runner |
| `jq` | phase 6 verify의 checklist 파싱 |
| Git | commit anchor, diff, artifact commit |
| Interactive TTY | start/resume 시 모델 선택 UI와 escalation UI |

참고:
- 지원 플랫폼은 **macOS와 Linux**입니다.
- verify script는 먼저 설치된 패키지 내부 경로에서 찾고, 없으면 `~/.claude/scripts/harness-verify.sh`를 레거시 fallback으로 사용합니다.
- interactive phase를 Codex preset으로 바꾸면, 해당 phase도 Codex CLI로 실행됩니다.
- 기본적으로 Codex phase는 실제 `codex` CLI를 사용하고, `<runDir>/codex-home` 격리 환경에서 실행됩니다. 사용자 전역 `CODEX_HOME` 동작이 필요할 때만 `--codex-no-isolate`를 사용하세요.
- 새 run은 이제 Claude phase 기본값으로 `*-1m-*` preset을 사용합니다. Claude Code 환경에서 1M context를 쓸 수 없다면, 모델 선택 단계에서 기존 non-1M preset으로 직접 바꾸거나 자체 포크의 `src/config.ts` 기본값을 수정하세요.

---

## 설치

npm에서 전역 설치:

```bash
npm install -g phase-harness
# or
pnpm add -g phase-harness
```

로컬 개발 기준 설치:

```bash
git clone <repo-url> phase-harness
cd phase-harness
pnpm install
pnpm run build
pnpm link --global
```

이후 `phase-harness` 명령을 전역에서 사용할 수 있습니다.

소스 변경 후 재빌드:

```bash
pnpm run build
```

전역 링크 제거:

```bash
pnpm unlink --global phase-harness
```

### 독립 스킬 설치

설치 후, 번들된 Claude Code 스킬을 사용자 스코프에 설치합니다:

```bash
phase-harness install-skills            # 사용자 스코프: ~/.claude/skills/
phase-harness install-skills --project  # 프로젝트 스코프: ./.claude/skills/
```

harness 라이프사이클에서 사용하는 `phase-harness-codex-gate-review` 스킬이 설치됩니다.
삭제하려면:

```bash
phase-harness uninstall-skills
phase-harness uninstall-skills --project
```

**테스트 / 고급:** `--project-dir <path>`로 임의 경로에 설치할 수 있습니다:

```bash
phase-harness install-skills --project-dir /tmp/test-skills
```

---

## 빠른 시작

대상 프로젝트 루트에서 실행하세요. `.harness/` 위치를 따로 두고 싶으면 `--root`를 사용하면 됩니다.

```bash
cd /path/to/your/project
phase-harness --help
```

새 run 시작:

```bash
phase-harness start "사용자 인증 기능이 포함된 GraphQL API 추가"
# 동일: phase-harness run "사용자 인증 기능이 포함된 GraphQL API 추가"
```

task를 생략하면 control pane 안에서 직접 입력받습니다.
이 control pane 입력은 일반 `Enter=제출` 동작을 유지하면서도 **멀티라인 붙여넣기**를 지원합니다.

일반적인 순서:
1. `.harness/`를 찾거나 생성
2. tmux control surface 생성
3. 남은 phase에 대한 모델 preset 선택
4. phase 1(또는 resume 시 저장된 phase) 시작

---

## 명령어 레퍼런스

### `phase-harness start [task]`

새 run을 시작합니다.

```bash
phase-harness start "task"
phase-harness run "task"                  # alias
phase-harness start --light "task"
phase-harness start --require-clean "task"
phase-harness start --enable-logging "task"
phase-harness start --root /tmp/demo "task"
```

플래그:
- `--require-clean` — working tree에 uncommitted change가 하나라도 있으면 차단
- `--auto` — escalation 처리 시 autonomous mode 사용
- `--enable-logging` — `~/.harness/sessions/...` 아래에 세션 로그 저장
- `--light` — 5단계 light flow 사용 (P1 design+plan → P2 pre-impl gate → P5 → P6 → P7)
- `--codex-no-isolate` — Codex subprocess의 per-run `CODEX_HOME` isolation 비활성화; 권장하지 않음
- 전역 `--root <dir>` — harness root를 `<dir>/.harness`로 강제

중요 동작:
- 기본적으로 unstaged/untracked 변경은 허용됩니다
- staged 변경은 기본적으로 경고만 합니다
- `--require-clean`을 주면 staged/unstaged 둘 다 차단됩니다
- 첫 실행 시 `.gitignore`에 `.harness/`가 없으면 자동으로 추가합니다

### `phase-harness resume [runId]`

현재 run 또는 특정 run을 재개합니다.

```bash
phase-harness resume
phase-harness resume 2026-04-19-graphql-api
```

resume은 세 경우를 자동 처리합니다:
1. tmux session alive + inner alive → 재연결만 수행
2. tmux session alive + inner dead → 기존 세션 안에서 inner loop 재시작
3. tmux session 없음 → tmux를 다시 만들고 저장된 상태부터 계속 진행

resume 때도 남아 있는 phase들에 대해 모델 preset 선택 UI가 다시 뜹니다.

### Terminal-state UI

`runPhaseLoop`가 종료해도 control panel이 사라지지 않고 화면에 남습니다:
- **Phase 실패 시** → 인라인 액션 프롬프트가 뜹니다. `[R]esume` (실패한 phase 재시도), `[J]ump` (interactive phase 선택; full flow는 `1/3/5`, light flow는 `1/5` single-key), `[Q]uit` (정상 종료). R/J 도중 에러가 나도 패널은 그대로 유지되어 다른 액션을 시도할 수 있습니다.
- **전체 완료 시** → eval report 경로, commit range, wall time을 보여주는 idle 요약 패널이 떠 있습니다. Ctrl+C로 종료합니다.

### `phase-harness status`

현재 run 상태를 출력합니다:
- run/task/status
- current phase
- artifact 경로
- retry 카운터
- commit anchor
- pending action

### `phase-harness list`

현재 harness root 아래의 모든 run을 나열합니다.

### `phase-harness skip`

현재 phase를 강제로 통과시킵니다.

inner process가 살아 있으면 pending action을 기록하고 즉시 signal을 보냅니다.
inner가 없으면 action만 저장해 두었다가 다음 `phase-harness resume`에서 소비합니다.

### `phase-harness jump <phase>`

이전 phase로 되돌립니다.

```bash
phase-harness jump 3
```

규칙:
- completed run이 아닌 경우 backward jump만 허용
- light flow에서 `skipped` phase로는 jump 불가
- 적용 방식은 `skip`과 동일

### `phase-harness install-skills`

번들된 Claude Code 스킬을 사용자 또는 프로젝트 스코프에 설치합니다.

```bash
phase-harness install-skills            # 사용자 스코프: ~/.claude/skills/
phase-harness install-skills --project  # 프로젝트 스코프: ./.claude/skills/
```

옵션: `--user` (기본값), `--project`, `--project-dir <path>` (`--project` 암묵 선택).

### `phase-harness uninstall-skills`

`phase-harness-*` 접두 스킬을 사용자 또는 프로젝트 스코프에서 삭제합니다. `phase-harness-` 접두가 없는 스킬은 보존됩니다.

```bash
phase-harness uninstall-skills
phase-harness uninstall-skills --project
```

---

## Artifact와 상태 파일

Harness는 run 상태를 `.harness/<runId>/` 아래에 저장합니다.

주요 파일:
- `.harness/<runId>/state.json` — atomic run state
- `.harness/<runId>/task.md` — 정규화된 task 텍스트
- `.harness/current-run` — `resume`, `status`, `skip`, `jump`가 쓰는 현재 run 포인터
- `docs/specs/<runId>-design.md` — spec 또는 결합 design 문서
- `docs/plans/<runId>.md` — full flow용 plan 문서
- `.harness/<runId>/checklist.json` — verify checklist
- `docs/process/evals/<runId>-eval.md` — phase 6 평가 리포트

선택적 세션 로깅(`--enable-logging`)을 켜면 아래에도 기록됩니다:

```text
~/.harness/sessions/<repoKey>/<runId>/
  meta.json
  events.jsonl
  summary.json
```

logging이 켜져 있으면 control pane footer에 다음 정보가 표시됩니다:
- 현재 phase / attempt
- phase 경과 시간
- 현재 세션 경과 시간
- 누적 Claude + gate token 총량

---

## 운영 메모

- Harness는 **atomic state write**와 **outer/inner lock handoff**를 사용합니다.
- interactive phase 완료는 `.harness/<runId>/phase-1.done` 같은 sentinel 파일로 검증합니다.
- phase 5는 기본적으로 clean tree와 `implRetryBase` 이후 최소 1개 commit이 필요합니다. 단, reopen 경로에서 commit 없는 artifact 수정만 필요한 경우는 예외가 있습니다.
- `skip`과 `jump`는 control-plane 연산이므로 main run lock을 직접 잡지 않습니다.
- 모델 preset을 다시 고르면 effective runner/model lineage가 바뀐 gate replay sidecar는 무효화될 수 있습니다.

---

## 문제 해결

**처음 실행했는데 Phase 1에서 멈춘 것처럼 보일 때**  
workspace pane 쪽에서 Claude가 디렉터리 trust / proceed 확인을 기다리는 경우가 있습니다. workspace pane으로 이동해서 승인하세요.

**`Codex CLI not found in PATH`**  
Codex CLI를 설치한 뒤 다시 시도하세요. 이제는 예전 companion 경로가 아니라 실제 `codex` 바이너리를 검사합니다.

**`Could not open a terminal window automatically.`**  
Linux에서는 정상 동작일 수 있고, macOS에서도 자동 실행이 실패할 수 있습니다. 출력된 `tmux attach -t ...` 명령으로 수동 attach 하세요.

**`No active run.`**  
`phase-harness list`로 기존 run을 확인하거나 새 run을 시작하세요.

**`flow is frozen at run creation`**  
`--light`는 start 시점에만 고를 수 있습니다. 기존 run은 그대로 resume하고, light flow가 필요하면 새 run을 시작하세요.

**다른 터미널에서 현재 진행 상황을 보고 싶을 때**  
`phase-harness status`, `phase-harness skip`, `phase-harness jump <phase>`를 사용하세요.

---

## 관련 문서

- [`docs/HOW-IT-WORKS.ko.md`](docs/HOW-IT-WORKS.ko.md)
- [`README.md`](README.md)

---

## 라이선스

MIT
