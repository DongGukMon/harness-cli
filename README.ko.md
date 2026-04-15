# harness-cli

AI 에이전트 개발 프로세스의 7단계 라이프사이클을 오케스트레이션하는 TypeScript CLI입니다: 브레인스토밍 → spec gate → plan → plan gate → 구현 → verify → eval gate.

각 phase는 **tmux 세션** 안의 독립된 서브프로세스에서 실행됩니다. Interactive phase(Claude Code)는 각각 별도의 tmux window에서 실행되고, gate review(Codex companion)와 verify(shell script)는 control window에서 실행됩니다. tmux window 0의 control panel이 실시간으로 phase 상태를 보여주면서 Claude는 인접 window에서 작업합니다. Phase 간 컨텍스트는 파일로 전달되고 세션은 공유하지 않으므로, 컨텍스트 팽창 문제와 self-review bias가 원천적으로 해결됩니다.

CLI가 세션 바깥에서 phase lifecycle을 관리합니다. Atomic `state.json` 쓰기로 crash-safe 상태를 보장하고, atomic handoff(outer → inner 프로세스)가 포함된 두 단계 파일 락으로 동시 실행을 방지합니다. `resume` / `jump` / `skip` 명령으로 중단 지점에서 재개할 수 있습니다.

---

## 사전 요구사항

CLI 사용 전에 아래 의존성을 설치해야 합니다 (preflight에서 모두 검사합니다):

| 의존성 | 용도 | 설치 방법 |
|--------|------|-----------|
| **Node.js ≥ 18** | CLI와 Codex companion 실행 | [nodejs.org](https://nodejs.org) |
| **pnpm** | 패키지 매니저 | `npm install -g pnpm` |
| **git** | 필수. 대상 프로젝트는 최소 1개 commit이 있는 git repo여야 함 | macOS/Linux 기본 제공 |
| **Claude Code CLI** (`claude`) | Phase 1/3/5 interactive 실행 | [claude.ai/code](https://claude.ai/code) |
| **Codex companion** | Phase 2/4/7 gate review 실행. `~/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs` 경로를 자동 탐색 | `openai-codex` Claude 플러그인 설치 |
| **harness-verify.sh** | Phase 6 자동 검증. `~/.claude/scripts/harness-verify.sh`에 위치해야 함 | skill 배포판에서 복사 |
| **jq** | `harness-verify.sh`가 `checklist.json` 파싱에 사용 | `brew install jq` / `apt install jq` |
| **tmux** | Control panel과 Claude window 호스팅 | `brew install tmux` / `apt install tmux` |

**플랫폼**: macOS 전용. iTerm2를 우선 사용하며 Terminal.app으로 폴백합니다. Linux 지원은 scope 밖입니다.

**터미널**: CLI가 tmux 세션을 위한 새 iTerm2(또는 Terminal.app) 창을 엽니다. 원래 터미널은 즉시 반환됩니다. 에스컬레이션 메뉴는 tmux control window 안에서 실행되므로 TTY가 항상 보장됩니다.

---

## 설치

Repo를 클론하고 전역으로 link합니다:

```bash
git clone <repo-url> harness-cli
cd harness-cli
pnpm install
pnpm run build
pnpm link --global
```

Link 이후에는 어느 디렉토리에서나 `harness` 명령을 사용할 수 있습니다.

소스 코드를 수정한 뒤에는 rebuild만 하면 전역 명령에 즉시 반영됩니다:

```bash
pnpm run build
```

제거할 때:

```bash
pnpm unlink --global harness-cli
```

---

## 사용법

모든 명령은 **대상 git 프로젝트**에서 실행합니다 (`harness-cli` repo 자체에서 실행하지 않음):

```bash
cd /path/to/your/project
harness --help
```

### 새 run 시작

```bash
harness run "사용자 인증 기능이 포함된 GraphQL API 추가"
```

이 명령은 **tmux 세션**을 생성하고 새 iTerm2 창에서 엽니다. 원래 터미널은 즉시 반환됩니다.

tmux 세션 내부:
- **Window 0 (control panel)**: 실시간 phase 상태, gate/verify 스트리밍 로그, 에스컬레이션 메뉴 표시
- **Window N (phase-N)**: Claude가 phase별로 별도 window에서 interactive 실행

Control panel에 현재 활성 phase가 표시됩니다. `Ctrl-B 0`(control)과 `Ctrl-B 1`(Claude) 으로 window를 전환합니다.

Phase 1(브레인스토밍)이 자동 시작됩니다. Claude가 질문을 주고받으며 아래 파일을 작성합니다:

- `docs/specs/<runId>-design.md` — 설계 스펙 문서
- `.harness/<runId>/decisions.md` — Decision Log

Phase 1 완료 시 Claude window가 자동으로 닫히고, control panel로 포커스가 이동하며, CLI가 다음 단계를 순차 실행합니다:

- **Phase 2**: Codex가 spec을 리뷰 (진행 상황이 control panel에 스트리밍) → `APPROVE` 또는 `REJECT`
- **Phase 3**: Claude가 새 tmux window에서 구현 계획 작성 → `docs/plans/<runId>.md` + `.harness/<runId>/checklist.json`
- **Phase 4**: Codex가 spec + plan 리뷰
- **Phase 5**: Claude가 새 tmux window에서 구현 (종료 전 반드시 git commit)
- **Phase 6**: `harness-verify.sh`가 checklist 실행 (출력이 control panel에 스트리밍) → `docs/process/evals/<runId>-eval.md`
- **Phase 7**: Codex가 전체 리뷰 (spec + plan + eval report + diff)

### `harness run` 플래그

```bash
harness run "태스크" --allow-dirty   # 시작 시 unstaged/untracked 변경 허용 (staged는 여전히 차단)
harness run "태스크" --auto          # 자율 모드: 에스컬레이션 메뉴 없이 한도 초과 시 강제 통과
harness run "태스크" --root <dir>    # git root 대신 <dir>/.harness/ 사용
```

**이미 tmux 안에서 실행 중인 경우?** CLI가 `$TMUX` 환경변수를 감지하여 새 터미널을 열지 않고 현재 세션에 window를 생성합니다. tmux-in-tmux 문제가 발생하지 않습니다.

```bash
# 기존 tmux 세션 안에서:
harness run "태스크"   # 현재 세션에 'harness-ctrl' window 생성
```

### Run 재개

터미널 창을 닫아도 tmux 세션은 살아있습니다. 다시 연결하세요:

```bash
harness resume                       # 현재 run 재개 (.harness/current-run 포인터 기준)
harness resume 2026-04-12-graphql-api   # 특정 runId 재개
```

Resume은 세 가지 경우를 자동으로 처리합니다:
1. **세션 + inner 모두 살아있음** — 기존 tmux 세션에 재연결 (iTerm2 창 열기)
2. **세션은 살아있지만 inner가 죽음** — 기존 tmux 세션 안에서 phase loop 재시작
3. **세션 없음** — 새 tmux 세션을 생성하고 저장된 체크포인트에서 phase loop 시작

Pending action(`skip`/`jump`)은 재시작 시 자동으로 소비됩니다.

### 상태 확인

```bash
harness status     # 현재 phase, artifact, retry 횟수, pendingAction 출력
harness list       # 이 repo의 모든 run과 상태를 나열
```

`status`와 `list`는 read-only 명령이며 TTY 없이도 동작하므로 CI/pipeline에서도 사용 가능합니다.

### 진행 강제

```bash
harness skip                  # 현재 phase를 강제 통과 (예: 재리뷰 사이클 건너뛰기)
harness jump 3                # 역방향 jump — Phase 3로 되돌아가서 재실행
```

이들은 **control-plane 명령**입니다 — lock을 획득하지 않습니다. 대신:
- Inner 프로세스가 실행 중인 경우: `pending-action.json` 파일을 기록하고 inner 프로세스에 `SIGUSR1`을 전송합니다. 활성 Claude window가 종료되고 phase loop가 새 phase에서 재진입합니다.
- Inner 프로세스가 없는 경우: `pending-action.json`에 action을 저장하고 다음 `harness resume`에서 소비합니다.

`jump`는 **backward 전용**입니다 (N이 현재 phase보다 작아야 하거나, run이 completed 상태여야 함).

---

## 일반적인 워크플로우

```bash
# 1. Clean git repo에서 시작
cd ~/projects/my-app
git status   # clean해야 함

# 2. Run 시작 — tmux 세션이 담긴 새 iTerm2 창이 열림
harness run "설정 페이지에 다크모드 토글 추가"
# 원래 터미널은 즉시 반환됨. 작업은 새 창에서 진행.

# 3. tmux 세션 안에서:
#    - Ctrl-B 0 → control panel (phase 상태, gate 로그)
#    - Ctrl-B 1 → 활성 Claude window
#    Codex가 spec을 reject하면 Claude가 피드백과 함께 자동 재오픈.
#    3회 reject되면 control panel에 에스컬레이션 메뉴 표시.

# 4. iTerm2 창을 닫아도 tmux 세션은 살아있음
harness status   # 현재 위치 확인 (read-only, 아무 터미널에서 가능)
harness resume   # 실행 중인 tmux 세션에 재연결

# 5. 세션이 실행 중인 동안 다른 터미널에서 skip/jump 가능:
harness skip     # SIGUSR1 전송 → 현재 phase 강제 통과
harness jump 3   # SIGUSR1 전송 → Phase 3로 리셋
```

---

## 동작 원리

### 아키텍처: outer/inner 분리

`harness run`은 두 프로세스로 분리됩니다:

```
[사용자 터미널]                            [iTerm2 — tmux 세션]
$ harness run "태스크"                     Window 0 (control):
  ├── preflight 검사                         harness __inner <runId>
  ├── state 초기화                           ├── Phase 1: tmux new-window "claude ..."
  ├── tmux new-session                       │   ├── control에 "Phase 1 ▶" 표시
  ├── tmux send-keys "__inner"               │   ├── sentinel 감지 → window kill
  ├── handoff 완료 대기                      │   └── control: "Phase 1 ✓"
  ├── iTerm2 창 열기                         ├── Phase 2: codex가 control에서 실행
  └── exit(0) ← 터미널 반환                 │   └── stderr 실시간 스트리밍
                                             ├── Phase 3: tmux new-window "claude ..."
                                             └── ... Phase 7까지
```

**Outer** (사용자 터미널): preflight → state 초기화 → tmux 세션 생성 → lock을 inner에게 handoff → iTerm2 열기 → exit.

**Inner** (`__inner`, 숨겨진 명령어): lock ownership 획득 → tmux window 0 안에서 phase loop 실행. Claude 세션은 별도 tmux window로 spawn. Gate/verify 출력은 control panel에 스트리밍.

### Phase 실행

```
tmux 세션 "harness-<runId>"
  ├── Window 0 (control panel)
  │     harness __inner — phase loop + 상태 표시
  │     Gate/verify stderr 스트리밍
  │
  ├── Window "phase-1" (Claude 브레인스토밍)   ← 자동 생성, 자동 종료
  ├── Window "phase-3" (Claude 계획 작성)      ← 자동 생성, 자동 종료
  └── Window "phase-5" (Claude 구현)           ← 자동 생성, 자동 종료
```

| Phase | 실행 위치 | 동작 |
|-------|----------|------|
| 1 | tmux window `phase-1` | Claude 브레인스토밍 → spec doc |
| 2 | control window | Codex가 spec 리뷰 (stderr 스트리밍) |
| 3 | tmux window `phase-3` | Claude가 plan + checklist 작성 |
| 4 | control window | Codex가 plan 리뷰 |
| 5 | tmux window `phase-5` | Claude가 구현 (반드시 git commit) |
| 6 | control window | `harness-verify.sh`가 checklist 실행 (출력 스트리밍) |
| 7 | control window | Codex가 전체 리뷰 |

### Lock handoff

Outer 프로세스가 lock을 획득하고 자신의 PID와 함께 `handoff: true`를 설정합니다. Inner 프로세스가 `cliPid`를 자신의 PID로 갱신하고 `handoff: false`로 전환하여 ownership을 가져갑니다. Outer는 이 전환이 완료될 때까지 polling합니다 (최대 5초). Inner가 시작되지 않으면 outer가 tmux 세션을 kill하고 lock을 해제합니다.

### 실행 모드

- **Dedicated 모드** (기본, tmux 바깥에서 실행): `harness-<runId>` 이름의 새 tmux 세션을 생성합니다. 완료 시 세션 전체가 kill됩니다.
- **Reused 모드** (기존 tmux 세션 안에서 실행): 현재 세션에 window를 생성합니다. 완료 시 harness가 생성한 window만 kill하고 부모 세션은 유지됩니다.

상태는 `.harness/<runId>/state.json`에 atomic write로 영속화됩니다. 모든 artifact(`spec`, `plan`, `eval report`)는 phase 경계에서 자동 커밋되므로 eval gate(Phase 7)가 전체 diff를 리뷰할 수 있습니다.

**Phase별 상세 (각 단계에서 쓰는 AI 에이전트, 모델, 출력 위치, 세션 클리어 시점, 상태 관리, signal 처리)** 는 [`docs/HOW-IT-WORKS.ko.md`](docs/HOW-IT-WORKS.ko.md)를 참조하세요.

**tmux 재아키텍처 설계 (outer/inner 분리, lock handoff, reused-session 모드, control-plane 시그널 관련 ADR)** 는 [`docs/specs/2026-04-14-tmux-rearchitecture-design.md`](docs/specs/2026-04-14-tmux-rearchitecture-design.md)를 참조하세요.

**원래 CLI 설계 배경 (ADR, 엣지 케이스)** 은 [`docs/specs/2026-04-12-harness-cli-design.md`](docs/specs/2026-04-12-harness-cli-design.md)를 참조하세요.

---

## 문제 해결

**`tmux is required. Install with: brew install tmux`** — CLI의 multi-window 아키텍처에 tmux가 필요합니다. 설치 후 재시도하세요.

**`harness requires a git repository`** — 최소 1개 commit이 있는 git repo 안에서 실행해야 합니다.

**`harness is already running (PID: ...)`** — 다른 CLI 인스턴스가 lock을 점유 중입니다. 실제로 죽은 프로세스면 `.harness/repo.lock`을 수동 확인하세요.

**`Cannot start harness run: staged changes exist`** — Harness가 artifact를 auto-commit하므로 staged changes가 있으면 시작할 수 없습니다. `git restore --staged .`로 unstage하거나 먼저 커밋하세요.

**`Inner process failed to start within 5 seconds.`** — `__inner` 프로세스가 제한 시간 내에 lock ownership을 가져오지 못했습니다. tmux 세션은 자동으로 정리됩니다. `tmux list-sessions`로 오류를 확인하고 재시도하세요.

**`Could not open a terminal window automatically.`** — iTerm2와 Terminal.app 모두 AppleScript로 실행할 수 없었습니다. tmux 세션은 살아있으므로 출력된 `tmux attach -t harness-<runId>` 명령으로 수동 연결하세요.

**`claude @file syntax is required but not supported`** — Claude Code CLI를 최신 버전으로 업그레이드하세요.

**실수로 iTerm2 창을 닫았을 때** — tmux 세션은 살아있습니다. `harness resume`으로 재연결하거나, 직접 `tmux attach -t harness-<runId>`를 실행하세요.

**Phase에서 멈춘 것 같을 때** — `harness status`로 현재 위치를 확인하세요. `harness resume`으로 실행 중인 세션에 재연결합니다. `harness skip` / `harness jump N`은 세션이 실행 중인 동안에도 아무 터미널에서 사용 가능합니다.

---

## 라이선스

MIT
