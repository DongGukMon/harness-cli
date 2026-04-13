# harness-cli 동작 원리

이 문서는 `harness run "task"`를 실행했을 때 실제로 어떤 일이 일어나는지를 설명합니다. 각 phase에서 사용하는 AI 에이전트, 모델, 입출력 위치, 세션 클리어 시점을 상세히 다룹니다.

전체 설계 근거(왜 multi-session인지, 왜 파일 기반 컨텍스트 전달인지)는 `docs/specs/2026-04-12-harness-cli-design.md`를 참조하세요.

---

## 개요

```
harness run "task"
  │
  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Phase 1: 브레인스토밍    claude    opus-4-6      interactive        │
│    ↓ spec + decisions (파일)                                        │
│  Phase 2: Spec Gate       codex     (자체 모델)    automated         │
│    ↓ APPROVE / REJECT                                               │
│  Phase 3: 계획 작성       claude    sonnet-4-6    interactive        │
│    ↓ plan + checklist                                               │
│  Phase 4: Plan Gate       codex     (자체 모델)    automated         │
│    ↓ APPROVE / REJECT                                               │
│  Phase 5: 구현            claude    sonnet-4-6    interactive        │
│    ↓ git commits                                                    │
│  Phase 6: 자동 검증        bash      N/A           automated         │
│    ↓ eval report                                                    │
│  Phase 7: Eval Gate       codex     (자체 모델)    automated         │
│    ↓ APPROVE → run 완료                                             │
└─────────────────────────────────────────────────────────────────────┘
```

**핵심 불변식**: 각 phase는 독립된 OS 프로세스에서 실행됩니다. Phase 간에 유지되는 "메인 Claude 세션" 같은 것은 존재하지 않습니다. 컨텍스트는 모두 파일로 전달됩니다.

---

## Phase별 상세 설명

### Phase 1 — 브레인스토밍

| | |
|---|---|
| **에이전트** | Claude Code CLI (`claude`) |
| **모델** | `claude-opus-4-6` |
| **모드** | Interactive (harness CLI에서 TTY 상속) |
| **실행 명령** | `claude --model claude-opus-4-6 @<init-prompt-file>` |
| **입력** | `.harness/<runId>/task.md` (`harness run`에 전달한 태스크 설명) |
| **출력** | `docs/specs/<runId>-design.md` (설계 스펙)<br>`.harness/<runId>/decisions.md` (ADR, 제약조건, 해소된 모호성 등 decision log) |
| **완료 신호** | `.harness/<runId>/phase-1.done` 파일 생성, 내용은 현재 `phaseAttemptId` (UUID v4) 한 줄 |

**동작 과정**: CLI가 Claude를 spawn하면서 task 파일을 가리키는 초기 프롬프트를 주입합니다. Claude는 질문을 주고받으며 접근 방식을 제안하고, 사용자가 승인하면 spec + decision log를 작성합니다. `phaseAttemptId`를 담은 sentinel 파일을 만들고 종료합니다.

**아티팩트 포맷**:
- Spec: 상단에 `## Context & Decisions` 섹션(ADR 포함)이 있는 마크다운
- Decision log: "핵심 결정사항 / 제약 조건 / 해소된 모호성 / 구현 시 주의사항" 구조의 마크다운

**완료 후 처리**: CLI가 아티팩트를 검증(존재, 비어있지 않음, mtime ≥ `phaseOpenedAt[1]`)하고, spec doc에 대해 `normalizeArtifactCommit`을 실행(decisions.md는 `.harness/` 하위이므로 gitignored, 커밋 대상 아님)한 뒤 `specCommit = git rev-parse HEAD`를 기록하고 Phase 2로 진행합니다.

---

### Phase 2 — Spec Gate

| | |
|---|---|
| **에이전트** | Codex companion (독립 리뷰어) |
| **모델** | Codex 내부 모델 (companion 바이너리가 관리) |
| **모드** | Automated (non-interactive, 프롬프트는 stdin으로 전달) |
| **실행 명령** | `node <codexPath> task --effort high` |
| **입력** | `docs/specs/<runId>-design.md` (프롬프트에 인라인) + 공통 reviewer contract |
| **출력** | 구조화된 verdict를 stdout으로:<br>`## Verdict` (APPROVE/REJECT)<br>`## Comments` (P0/P1/P2/P3 severity + 위치 명시)<br>`## Summary` |
| **Sidecar 파일 (임시)** | `.harness/<runId>/gate-2-raw.txt` (raw stdout)<br>`.harness/<runId>/gate-2-result.json` ({exitCode, timestamp})<br>`.harness/<runId>/gate-2-error.md` (에러 시)<br>`.harness/<runId>/gate-2-feedback.md` (REJECT 시 — 다음 phase로 전달) |
| **타임아웃** | 120초 |

**동작 과정**: Codex가 spec을 독립적으로 리뷰합니다. 공통 reviewer contract(모든 gate에서 동일)는 "P0/P1 이슈가 0개일 때만 APPROVE; 모든 코멘트는 구체적 위치를 인용해야 함"을 강제합니다.

**결과별 분기**:
- **APPROVE**: sidecar 파일 삭제, Phase 3 진행
- **REJECT** (retry < 3): Phase 1이 `gate-2-feedback.md`를 주입받아 재오픈됨. `gateRetries[2]` 증가.
- **REJECT** (retry ≥ 3): 에스컬레이션 메뉴 — `[C]ontinue` (리셋 후 재오픈), `[S]kip` (강제 통과), `[Q]uit` (일시정지)
- **Error** (exit 0 아님, timeout, 또는 `## Verdict` 헤더 없음): Retry/Skip/Quit 메뉴. `gate-N-error.md`에 에러 저장.

---

### Phase 3 — 계획 작성

| | |
|---|---|
| **에이전트** | Claude Code CLI (`claude`) |
| **모델** | `claude-sonnet-4-6` |
| **모드** | Interactive |
| **실행 명령** | `claude --model claude-sonnet-4-6 @<init-prompt-file>` |
| **입력** | spec doc 경로 + decision log 경로 (Claude가 파일을 직접 읽음) |
| **출력** | `docs/plans/<runId>.md` (구현 계획)<br>`.harness/<runId>/checklist.json` (검증 체크리스트) |
| **완료 신호** | `.harness/<runId>/phase-3.done` + `phaseAttemptId` |

**Checklist 포맷** (완료 시 CLI가 스키마 검증):

```json
{
  "checks": [
    { "name": "Type Check", "command": "pnpm run lint" },
    { "name": "Unit Tests", "command": "pnpm test" }
  ]
}
```

**완료 후 처리**: CLI가 plan + checklist 스키마를 검증하고, plan에 대해 `normalizeArtifactCommit` 실행(checklist는 gitignored), `planCommit` 기록 후 Phase 4로 진행.

---

### Phase 4 — Plan Gate

| | |
|---|---|
| **에이전트** | Codex companion |
| **모드** | Automated |
| **입력** | spec doc + plan doc (둘 다 인라인) |
| **출력** | Phase 2와 동일한 구조화된 verdict |
| **Sidecar** | `gate-4-raw.txt`, `gate-4-result.json`, `gate-4-error.md`, `gate-4-feedback.md` |
| **타임아웃** | 120초 |

**REJECT 시**: Phase 3가 feedback과 함께 재오픈됩니다. Phase 2와 동일한 retry/escalation 규칙.

---

### Phase 5 — 구현

| | |
|---|---|
| **에이전트** | Claude Code CLI (`claude`) |
| **모델** | `claude-sonnet-4-6` |
| **모드** | Interactive (**NEW 세션 — 명시적 클리어 지점**) |
| **실행 명령** | `claude --model claude-sonnet-4-6 @<init-prompt-file>` |
| **입력** | spec doc, plan doc, decision log, feedback 파일들 (경로만 전달; Claude가 직접 읽음) |
| **출력** | Git commits (코드 변경 자체) |
| **완료 신호** | `.harness/<runId>/phase-5.done` + `phaseAttemptId` |
| **추가 완료 조건** | `implRetryBase` 이후 ≥ 1개 commit + working tree clean |

**동작 과정**: 이 시점이 라이프사이클 첫 번째 **명시적 세션 클리어 지점**입니다. Phase 5는 완전히 새로운 Claude 프로세스로 실행되며, Phase 1의 브레인스토밍 대화 내용은 모두 버려집니다. Claude는 committed된 설계 문서만 읽고 그에 따라 구현합니다.

Claude는 반드시 코드 변경을 `git commit`해야 합니다. 초기 프롬프트에서 명시적으로 경고합니다: "commit 없이 세션을 종료하면 eval gate에서 변경분을 볼 수 없어 run이 실패한다."

**완료 후 처리**: CLI가 commit 존재(`git log <implRetryBase>..HEAD`가 비어있지 않음) + working tree clean을 검증. `implCommit = git rev-parse HEAD` 기록.

**Feedback 전달**: Phase 7이 나중에 reject하면 Phase 5가 재오픈됩니다. Phase 6이 이전에 fail한 상태(verify-feedback.md 존재)라면 `gate-7-feedback.md`와 `verify-feedback.md`를 모두 프롬프트에 포함해서 Claude가 양쪽 피드백을 모두 반영하도록 합니다.

---

### Phase 6 — 자동 검증

| | |
|---|---|
| **에이전트** | 셸 스크립트 (`~/.claude/scripts/harness-verify.sh`) |
| **모드** | Automated (AI 미사용) |
| **실행 명령** | `~/.claude/scripts/harness-verify.sh <checklistPath> <evalReportPath>` |
| **입력** | `.harness/<runId>/checklist.json` (실행할 체크 목록) |
| **출력** | `docs/process/evals/<runId>-eval.md` (평가 리포트) |
| **Sidecar** | `verify-result.json` ({exitCode, hasSummary, timestamp})<br>`verify-feedback.md` (FAIL 시 eval report 복사본)<br>`verify-error.md` (ERROR 시) |
| **타임아웃** | 300초 |

**사전 조건** (spawn 전 순서대로 실행):
1. Staged 변경 검사 — eval report 외 staged 파일 있으면 실패
2. Unstaged/untracked 검사 — eval report 외 dirty 파일 있으면 실패
3. Eval report 정리 — 파일 상태에 따라 다르게 처리:
   - untracked → `rm`
   - staged new → `git restore --staged` + `rm`
   - git-tracked → `git rm -f` + `git commit`
4. 최종 clean-tree 재검증

**Eval report 포맷**: 스크립트는 먼저 헤더를 쓰고, 모든 체크를 실행한 뒤 마지막에 `## Summary`를 추가합니다. CLI는 `## Summary` 존재 여부로 FAIL(스크립트 완료, 일부 체크 실패) vs ERROR(스크립트 중간 crash)를 구분합니다.

**결과별 분기**:
- **PASS** (exitCode 0 + `## Summary` 있음): eval report에 `normalizeArtifactCommit` 실행 → `evalCommit` + `verifiedAtHead` 기록 → Phase 7 진행
- **FAIL** (exitCode ≠ 0 + `## Summary` 있음): eval report를 `verify-feedback.md`로 복사 → Phase 5 재오픈 → `verifyRetries` 증가
- **ERROR** (exitCode ≠ 0 + `## Summary` 없음, 또는 `verify-result.json` 없음/parse 실패): `verify-error.md` 저장 → Retry/Quit 메뉴

**Verify retry 한도**: 3. 3회 연속 FAIL 시 에스컬레이션 메뉴(`[C]ontinue / [S]kip / [Q]uit`). `[S]kip`은 "VERIFY SKIPPED" 레이블의 synthetic eval report를 생성하고 Phase 7로 진행합니다.

---

### Phase 7 — Eval Gate

| | |
|---|---|
| **에이전트** | Codex companion |
| **모드** | Automated |
| **입력** | spec doc + plan doc + eval report + `git diff <baseCommit>...HEAD` + 메타데이터 블록 |
| **출력** | 동일한 구조화된 verdict |
| **Sidecar** | `gate-7-raw.txt`, `gate-7-result.json`, `gate-7-error.md`, `gate-7-feedback.md` |
| **타임아웃** | 120초 |

**프롬프트 메타데이터 블록** (외부 커밋 감지 여부와 무관하게 항상 포함):

```
Harness implementation range: <baseCommit>..<implCommit> (Phase 1–5 commits).
Harness eval report commit: <evalCommit> (the commit that last modified the eval report).
Verified at HEAD: <verifiedAtHead> (most recent Phase 6 run).
Focus review on changes within the harness ranges above.
```

**Diff 조립**:
- 일반 모드: `git diff <baseCommit>...HEAD` (전체 harness 범위)
- 외부 커밋 감지 시: `git diff <baseCommit>...<implCommit>` + `git show <evalCommit>` + `## External Commits (not reviewed)` 섹션으로 분리

**크기 제한**: 파일별 diff > 20KB는 truncation 마커와 함께 자름; 개별 파일 > 200KB → gate execution error; 최종 프롬프트 > 500KB → gate execution error.

**결과별 분기**:
- **APPROVE**: `run.status = "completed"`, `currentPhase = 8` (terminal sentinel)
- **REJECT** (retry < 3): Phase 5 재오픈 — `gate-7-feedback.md` + 기존 `verify-feedback.md` 모두 주입. `gateRetries[7]` 증가. `verifyRetries` 리셋.
- **REJECT** (retry ≥ 3): 에스컬레이션 메뉴
- **Error**: Retry/Skip/Quit 메뉴

---

## 세션 클리어 시점

"세션 클리어"란 이전 Claude 세션의 메모리 상 컨텍스트가 완전히 사라지는 것을 의미합니다. CLI는 새 OS 프로세스를 spawn함으로써 명시적 클리어 지점을 만듭니다.

### 자동 클리어 (모든 phase 경계)

모든 phase는 새 프로세스입니다. 따라서 **연속되는 모든 phase 쌍 사이에서** 이전 세션의 메모리는 사라집니다. 컨텍스트는 파일로만 전달됩니다.

### 명시적 "hard" 클리어 (설계 스펙에서 언급)

모든 phase 경계가 클리어지만, 두 지점은 특히 "명시적 세션 클리어 지점"으로 명시됩니다:

1. **Phase 3 → Phase 5**: 계획 작성 컨텍스트 폐기; 구현은 spec + plan + decisions만 읽고 fresh하게 시작
2. **Phase 5 → Phase 7**: 구현 컨텍스트 폐기; eval gate는 아티팩트 + diff만 봄

이 두 경계는 가장 확실한 break 지점입니다. 특히 Phase 5는 설계에서 "NEW SESSION"으로 명시되어 있으며, 구현자는 Phase 1의 브레인스토밍이나 Phase 3의 계획 작성 대화 히스토리 없이 fresh하게 시작합니다.

### Phase 내부 (클리어 없음)

Phase 1/3/5용 Claude가 spawn되면 그 세션은 완료될 때까지 유지됩니다. CLI는 phase 중간에 Claude를 재시작하지 않습니다. Reopen 시나리오(gate REJECT 또는 verify FAIL 이후)에서 feedback은 **새 Claude 프로세스**를 spawn할 때 초기 프롬프트에 파일 경로를 주입하는 방식으로 전달됩니다 — Claude가 직접 파일을 읽습니다.

### Reopen 시 (Gate REJECT / Verify FAIL)

Phase N이 이후 phase의 reject로 재오픈될 때 **새 Claude 프로세스**가 spawn되며, 초기 프롬프트에 다음을 포함합니다:
- 기존 컨텍스트 파일들 (phase에 맞게 spec, plan, decisions)
- Feedback 파일 경로 (`gate-N-feedback.md`, `verify-feedback.md`)
- 새로운 `phaseAttemptId` (UUID v4)

이전 sentinel 파일은 새 `phaseAttemptId`와 비교되어 — 불일치(stale)하면 삭제되고 새 세션이 fresh sentinel을 씁니다.

---

## 상태 관리

### Run 디렉토리 구조

```
.harness/
├── repo.lock               # repo 전역 lock (JSON: {cliPid, childPid, childPhase, runId, startedAt, childStartedAt})
├── current-run             # 현재 활성 runId (텍스트 파일)
└── <runId>/               # 예: 2026-04-12-graphql-api/
    ├── state.json          # 권위 있는 run state (아래 참조)
    ├── run.lock            # run 단위 marker (빈 파일)
    ├── task.md             # 원본 태스크 설명
    ├── decisions.md        # Phase 1 출력 (gitignored)
    ├── checklist.json      # Phase 3 출력 (gitignored)
    ├── phase-1.done        # sentinel (phaseAttemptId 내용)
    ├── phase-3.done
    ├── phase-5.done
    ├── gate-2-raw.txt      # 임시 (state 갱신 후 삭제)
    ├── gate-2-result.json
    ├── gate-2-error.md     # 에러 시만
    ├── gate-2-feedback.md  # REJECT 시만 (reopen 위해 보존)
    ├── gate-4-*
    ├── gate-7-*
    ├── verify-result.json
    ├── verify-feedback.md  # FAIL 시만
    └── verify-error.md     # ERROR 시만
```

### `state.json` 내용

```json
{
  "runId": "2026-04-12-graphql-api",
  "currentPhase": 3,
  "status": "in_progress",
  "autoMode": false,
  "task": "GraphQL API 추가",
  "baseCommit": "<sha>",
  "implRetryBase": "<sha>",
  "codexPath": "/Users/.../codex-companion.mjs",
  "externalCommitsDetected": false,
  "artifacts": { "spec": "...", "plan": "...", "decisionLog": "...", "checklist": "...", "evalReport": "..." },
  "phases": { "1": "completed", "2": "completed", "3": "in_progress", "4": "pending", ... },
  "gateRetries": { "2": 0, "4": 0, "7": 0 },
  "verifyRetries": 0,
  "pauseReason": null,
  "specCommit": "<sha>",   // Phase 1 normalize 후 설정
  "planCommit": null,
  "implCommit": null,      // Phase 5 완료 후 설정
  "evalCommit": null,      // Phase 6 normalize 후 설정
  "verifiedAtHead": null,
  "pausedAtHead": null,
  "pendingAction": null,   // crash-recovery hint
  "phaseOpenedAt": { "1": 1744444800000, "3": null, "5": null },
  "phaseAttemptId": { "1": "uuid-v4", "3": null, "5": null }
}
```

### Atomic write

모든 `state.json` 갱신은 `state.json.tmp 쓰기 → fsync → rename` 패턴을 사용합니다. POSIX rename은 atomic이므로 `state.json`은 항상 이전 버전 또는 새 버전 중 하나 — 중간 상태 없음.

### Commit anchor

CLI는 각 phase 경계에서 git SHA를 기록하여 resume 시 ancestry 검증을 가능하게 합니다:

| Anchor | 설정 시점 | 용도 |
|--------|-----------|------|
| `baseCommit` | `harness run` (.gitignore 커밋 후) | Phase 7 diff 시작점 |
| `specCommit` | Phase 1 normalize | Resume ancestry + artifact dirty check |
| `planCommit` | Phase 3 normalize | 동일 |
| `implCommit` | Phase 5 완료 | Phase 7 diff 종료점 (harness 범위) |
| `evalCommit` | Phase 6 normalize | Phase 7 eval 리뷰 |
| `verifiedAtHead` | Phase 6 PASS (및 skip) | Phase 7 메타데이터 |
| `pausedAtHead` | 모든 의도적 exit 시 | Resume 시 외부 커밋 감지 |

---

## 동시성 제어

### 두 단계 락

1. **repo 전역 락** `.harness/repo.lock` — `fs.openSync(path, 'wx')` (O_EXCL)로 atomic하게 생성. 동일 repo에서 두 개의 `harness` 프로세스가 동시에 실행되는 것을 방지. JSON 포맷으로 PID + start time 메타데이터를 담아 PID 재사용 감지 가능.

2. **run 단위 락** `.harness/<runId>/run.lock` — presence-only marker 파일. `repo.lock`과 함께 생성/삭제. 버려진 `repo.lock`이 어느 run에 속했는지 식별에 사용.

### Liveness check (PGID 기반)

다른 락이 발견되면 CLI가 다음을 검사합니다:
- `cliPid`가 살아있는가? → `kill(cliPid, 0)` + start time 일치 검사
- CLI가 죽어있다면, child process group이 살아있는가? → `kill(-childPid, 0)` (음수 PID = PGID)
- PGID alive → 항상 active로 판정 (orphan children을 놓치는 것보다 false-positive "active"가 더 안전)
- PGID dead (ESRCH) → stale, 두 락 모두 삭제 후 진행

### Process group

모든 subprocess spawn은 `detached: true`를 사용합니다. 이로써 child가 자신의 process group leader가 됩니다. CLI는 `process.kill(-childPid, 'SIGTERM')` → 5초 대기 → `SIGKILL`로 종료하여 child가 spawn한 손자 프로세스까지 모두 정리합니다.

정상 완료 시 CLI는 PGID `ESRCH` 확인 후에만 lock의 `childPid`를 null로 갱신합니다 — 다음 phase가 이전 phase의 orphan이 사라지기 전에 spawn되는 것을 방지.

---

## Signal 처리

`harness run`과 `harness resume` (그리고 phase loop에 진입한 후의 `skip`/`jump`)은 `SIGINT` + `SIGTERM` 핸들러를 등록합니다. Signal 수신 시:

1. Child process group kill: SIGTERM → 5초 대기 → SIGKILL
2. `pausedAtHead = git rev-parse HEAD` 저장
3. Phase 상태 갱신 (interactive → `failed`, automated → `error` + `pendingAction`)
4. Atomic state 쓰기
5. 두 lock 파일 모두 삭제
6. Exit code 130 (SIGINT 관례)

따라서 Ctrl-C는 항상 안전합니다. 상태가 보존되고 `harness resume`으로 저장된 체크포인트에서 이어갈 수 있습니다.

---

## 에러 복구

Crash-safe 복구는 다음 메커니즘으로 달성됩니다:

1. **Atomic state writes** — `state.json`은 중간에 corrupt되지 않음
2. **Sentinel-based completion** — interactive phase 완료는 `phaseAttemptId`와 일치하는 fresh sentinel을 요구. Crash한 부분 세션은 매치되지 않음.
3. **pendingAction replay** — state 전환 전에 의도한 action을 atomic하게 기록. Resume 시 idempotent하게 replay.
4. **Committed artifacts** — spec, plan, eval report는 auto-commit됨. Resume이 `*Commit` anchor 기준으로 변조 여부를 검증.
5. **Lock `.tmp` recovery** — lock 갱신 중 crash가 발생하면 `.tmp` 파일을 parse하고 liveness check 후 안전하게 정리

권위 있는 resume 알고리즘은 `src/resume.ts`에 있습니다. 주요 분기:

- `pendingAction` non-null → type별 replay (`reopen_phase`, `rerun_gate`, `rerun_verify`, `show_escalation`, `show_verify_error`, `skip_phase`)
- Phase 1/3/5가 `in_progress`/`failed` + fresh sentinel → inline 완료 (respawn 없음)
- Phase 1/3가 `error` + valid artifacts → normalize_artifact_commit 재시도
- Phase 6가 `in_progress` + `verify-result.json` → 저장된 PASS/FAIL/ERROR 결과 적용
- Phase 6가 `error` + valid eval report → normalize 재시도

---

## Preflight

모든 명령은 실제 작업 전에 의존성 검사를 실행합니다:

| 항목 | 검사 방법 |
|------|-----------|
| git | `git rev-parse --show-toplevel` |
| head | `git rev-parse HEAD` (빈 repo 거부) |
| node | `node --version` |
| claude | `which claude` |
| claudeAtFile | `claude --model claude-sonnet-4-6 @<tmpfile> --print ''` (weak signal) |
| verifyScript | `~/.claude/scripts/harness-verify.sh` 존재 + 실행 권한 |
| jq | `jq --version` |
| codexPath | `~/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs` glob 탐색 |
| platform | `process.platform`이 `darwin` 또는 `linux` (win32 거부) |
| tty | `process.stdin.isTTY && process.stdout.isTTY` (`status`/`list`은 건너뜀) |

각 명령은 필요한 부분집합만 실행합니다:

- `harness run` → 10개 항목 모두
- `harness resume` / `jump` / `skip` → 다음 실행될 phase에 필요한 항목만
- `harness status` / `list` → platform만 (TTY 불필요)

---

## 추가 자료

- `docs/specs/2026-04-12-harness-cli-design.md` — ADR과 모든 엣지 케이스 근거가 담긴 전체 설계 스펙
- `docs/plans/2026-04-12-harness-cli.md` — 구현 계획 (태스크 분해)
- `docs/process/evals/2026-04-12-harness-cli-eval.md` — 자동 검증 리포트
