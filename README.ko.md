# harness-cli

AI 에이전트 개발 프로세스의 7단계 라이프사이클을 오케스트레이션하는 TypeScript CLI입니다: 브레인스토밍 → spec gate → plan → plan gate → 구현 → verify → eval gate.

각 phase는 독립된 서브프로세스에서 실행됩니다. Interactive phase는 Claude Code, gate review는 Codex companion, verify는 shell script가 담당합니다. Phase 간 컨텍스트는 파일로 전달되고 세션은 공유하지 않으므로, 컨텍스트 팽창 문제와 self-review bias가 원천적으로 해결됩니다.

CLI가 세션 바깥에서 phase lifecycle을 관리합니다. Atomic `state.json` 쓰기로 crash-safe 상태를 보장하고, 두 단계 파일 락(repo-global + run-level)과 PGID 기반 liveness check로 동시 실행을 방지합니다. Crash 후 `resume` / `jump` / `skip` 명령으로 중단 지점에서 재개할 수 있습니다.

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

**플랫폼**: macOS 또는 Linux만 지원합니다. Windows는 지원하지 않습니다 (POSIX process group과 signal 체계에 의존).

**터미널**: Phase 1/3/5와 에스컬레이션 메뉴는 실제 TTY가 필요합니다.

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

이 명령은 Phase 1(브레인스토밍)을 시작합니다. Claude가 현재 터미널에서 interactive로 열리고, 질문을 주고받으며 아래 파일을 작성합니다:

- `docs/specs/<runId>-design.md` — 설계 스펙 문서
- `.harness/<runId>/decisions.md` — Decision Log

Phase 1 완료 후 CLI가 자동으로 다음 단계들을 순차 실행합니다:

- **Phase 2**: Codex가 spec을 독립 리뷰 → `APPROVE` 또는 `REJECT`
- **Phase 3**: Claude가 구현 계획(`docs/plans/<runId>.md`) + checklist(`.harness/<runId>/checklist.json`) 작성
- **Phase 4**: Codex가 spec + plan 리뷰
- **Phase 5**: Claude가 구현 (종료 전 반드시 git commit)
- **Phase 6**: `harness-verify.sh`가 checklist 실행 → `docs/process/evals/<runId>-eval.md` 생성
- **Phase 7**: Codex가 전체 리뷰 (spec + plan + eval report + diff)

Phase 전환 시마다 터미널에 배너가 출력되어 현재 어느 단계인지 알 수 있습니다.

### `harness run` 플래그

```bash
harness run "태스크" --allow-dirty   # 시작 시 unstaged/untracked 변경 허용 (staged는 여전히 차단)
harness run "태스크" --auto          # 자율 모드: 에스컬레이션 메뉴 없이 한도 초과 시 강제 통과
harness run "태스크" --root <dir>    # git root 대신 <dir>/.harness/ 사용
```

### Run 재개

종료, crash, 터미널 손실 등이 발생해도 중단 지점에서 이어갈 수 있습니다:

```bash
harness resume                       # 현재 run 재개 (.harness/current-run 포인터 기준)
harness resume 2026-04-12-graphql-api   # 특정 runId 재개
```

Resume은 대기 중인 pendingAction을 재생하고, committed artifact를 git anchor 기준으로 검증하고, pause 중 외부에서 추가된 커밋을 감지한 뒤 phase loop를 이어갑니다.

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

`skip`은 현재 phase를 재실행하지 않고 다음 phase로 넘어갑니다. `jump N`은 N 이상의 phase를 `pending`으로 리셋하고 해당 retry/commit/sidecar를 초기화한 뒤 Phase N부터 다시 시작합니다.

`jump`는 **backward 전용**입니다 (N이 현재 phase보다 작아야 하거나, run이 completed 상태여야 함).

---

## 일반적인 워크플로우

```bash
# 1. Clean git repo에서 시작
cd ~/projects/my-app
git status   # clean해야 함

# 2. Run 시작
harness run "설정 페이지에 다크모드 토글 추가"

# 3. Codex가 spec을 reject하면 Claude가 피드백과 함께 자동 재오픈
#    3회 reject되면 에스컬레이션 메뉴 표시: [C]ontinue / [S]kip / [Q]uit

# 4. 잠시 쉬어야 하면 Ctrl-C — 상태가 자동 저장됨
harness status   # 현재 위치 확인
harness resume   # 나중에 재개

# 5. 특정 phase를 다시 하고 싶을 때:
harness jump 3   # Plan 단계로 복귀

# 6. 앞으로 건너뛰고 싶을 때 (예: spec이 충분해서 리뷰 불필요):
harness skip     # 현재 phase 건너뛰기
```

---

## 동작 원리

각 phase는 별도 OS 프로세스로 실행됩니다:

```
harness-cli (TypeScript orchestrator)
  ├── [1] claude --model opus      interactive 브레인스토밍
  │     ↓ spec doc + decisions.md
  ├── [2] codex companion          automated spec 리뷰
  │     ↓ APPROVE / REJECT
  ├── [3] claude --model sonnet    interactive 계획 작성
  │     ↓ plan doc + checklist.json
  ├── [4] codex companion          automated plan 리뷰
  ├── [5] claude --model sonnet    interactive 구현 (NEW 세션)
  │     ↓ git commits
  ├── [6] harness-verify.sh        automated 검증
  │     ↓ eval report
  └── [7] codex companion          automated eval 리뷰
        ↓ APPROVE → run 완료
```

상태는 `.harness/<runId>/state.json`에 atomic write로 영속화되며, 두 단계 락으로 동시 실행을 방지합니다. 모든 artifact(`spec`, `plan`, `eval report`)는 phase 경계에서 자동 커밋되므로 eval gate(Phase 7)가 전체 diff를 리뷰할 수 있습니다.

**Phase별 상세 (각 단계에서 쓰는 AI 에이전트, 모델, 출력 위치, 세션 클리어 시점, 상태 관리, signal 처리)** 는 [`docs/HOW-IT-WORKS.ko.md`](docs/HOW-IT-WORKS.ko.md)를 참조하세요.

**전체 설계 배경 (ADR, 엣지 케이스)** 은 [`docs/specs/2026-04-12-harness-cli-design.md`](docs/specs/2026-04-12-harness-cli-design.md)를 참조하세요.

---

## 문제 해결

**`harness requires a git repository`** — 최소 1개 commit이 있는 git repo 안에서 실행해야 합니다.

**`harness is already running (PID: ...)`** — 다른 CLI 인스턴스가 lock을 점유 중입니다. 실제로 죽은 프로세스면 `.harness/repo.lock`을 수동 확인하세요.

**`Cannot start harness run: staged changes exist`** — Harness가 artifact를 auto-commit하므로 staged changes가 있으면 시작할 수 없습니다. `git restore --staged .`로 unstage하거나 먼저 커밋하세요.

**`claude @file syntax is required but not supported`** — Claude Code CLI를 최신 버전으로 업그레이드하세요.

**Phase에서 멈춘 것 같을 때** — `harness status`로 현재 위치를 확인하고, `harness resume`으로 저장된 체크포인트에서 재시도하거나, `harness jump N`으로 이전 phase부터 다시 시작하세요.

---

## 라이선스

MIT
