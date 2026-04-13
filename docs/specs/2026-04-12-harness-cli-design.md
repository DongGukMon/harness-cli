# Harness CLI — Design Spec

- Date: 2026-04-12
- Status: Approved (rev 69 — spec gate force-passed at attempt 68, remaining P1s deferred to implementation)
- Context: 현재 Claude skill로 구현된 harness를 CLI 툴로 마이그레이션

---

## Context & Decisions

### 왜 CLI인가
현재 harness는 Claude skill(SKILL.md) 기반으로 단일 세션 안에서 7개 phase를 오케스트레이션한다. 이 구조의 핵심 한계:
1. **세션 클리어 불가**: brainstorm→plan 단계에서 컨텍스트가 팽창해도 skill에서는 세션을 끊을 수 없다
2. **수동 커맨드 마찰**: `/model`, `/advisor` 등을 개발자가 매번 수동 입력해야 한다
3. **컨텍스트 유실**: 세션을 끊으면 brainstorm 결정사항이 날아간다

CLI가 세션 바깥에서 phase lifecycle을 관리함으로써 이 세 가지를 동시에 해결한다.

### 핵심 결정사항

**[ADR-1] 멀티 세션 (Option 1) 채택 — seamless 단일 세션(Option 2) 기각**
- 이유: Option 2는 컨텍스트 팽창과 self-bias 문제를 해결하지 못한다. CLI를 만드는 핵심 동기가 사라진다.
- UX 단절감은 phase 전환 시 명확한 상태 출력과 Decision Log 자동 주입으로 완화한다.

**[ADR-2] 모든 Claude-driven phase는 독립 서브프로세스, 컨텍스트는 파일로 이전**
- Phase 1(brainstorm), Phase 3(plan), Phase 5(impl)은 각각 별도의 `claude` 프로세스로 실행된다.
- "컨텍스트 연속성"은 OS 레벨 세션 공유가 아니라 **파일 기반 이전**으로 달성한다.
  - Phase 1 → Phase 3: spec doc + decision log를 Phase 3 초기 프롬프트에 주입
  - Phase 3 → Phase 5: spec + plan + decision log를 Phase 5 초기 프롬프트에 주입
- 명시적 세션 클리어 지점은 plan→impl (Phase 3→5), impl→eval (Phase 5→7) 두 곳이지만, 모든 phase 경계가 새 프로세스이므로 컨텍스트 팽창은 각 phase 단위로만 발생한다.
- gate review(Codex)는 이미 독립 프로세스이므로 별도 클리어 불필요.

**[ADR-3] Headless(claude -p) 방식 기각 — interactive claude만 사용**
- Plan 작성 중 spec 모호성 발견 시 에스컬레이션이 필요하다.
- headless는 mid-run escalation을 지원하지 못한다.
- Claude가 관여하는 모든 phase(1, 3, 5)는 interactive, Codex와 shell script는 automated.

**[ADR-4] Context carry: Spec + Plan + Decision Log**
- 구현 agent가 codebase를 직접 탐색할 수 있으므로 codebase 스냅샷은 불필요.
- brainstorm에서 결정된 "왜"는 spec doc에 불완전하게 담기므로 Decision Log를 별도 아티팩트로 도입.

**[ADR-5] `resume` 중 외부 커밋 감지 시 경고 후 진행 (hard-fail 기각)**
- `harness run` 이후 pause 기간 동안 사용자가 hotfix 등 외부 커밋을 push하는 경우가 발생할 수 있다.
- 이 경우 Phase 7 `git diff <baseCommit>...HEAD`에 해당 커밋이 포함되어 gate reviewer가 harness 범위 이상을 심사할 수 있다.
- hard-fail 기각 이유: 장시간 pause 후 재개 시 개발자가 외부 커밋을 반드시 제거하도록 강제하면 UX 마찰이 크다. 경고를 출력함으로써 개발자가 인지 후 판단하도록 책임을 이전한다.
- 보완책: Phase 7 초기 프롬프트에 외부 커밋 존재 여부를 명시하여 gate reviewer가 harness 관련 변경에 집중하도록 안내한다. 외부 커밋이 검출된 경우 Phase 7 프롬프트에 `harness implementation range: {baseCommit}..{implCommit}` + `eval report commit: {evalCommit}` 정보를 추가 제공한다. (`implCommit`은 Phase 5 완료 시점, `evalCommit`은 Phase 6 자동 커밋 시점.)

---

## 아키텍처 개요

```
harness-cli (TypeScript, orchestrator)
  ├── [Phase 1] claude --model opus    (interactive — brainstorm Q&A)
  │     ↓ 출력: spec doc + decision log (파일)
  ├── [Phase 2] codex companion        (automated  — spec gate)
  │     ↓ 입력: spec doc | 출력: verdict
  ├── [Phase 3] claude --model sonnet  (interactive — plan 작성)
  │     ↓ 입력: spec + decisions | 출력: plan doc
  ├── [Phase 4] codex companion        (automated  — plan gate)
  │     ↓ 입력: spec + plan | 출력: verdict
  ├── [Phase 5] claude --model sonnet  (interactive — impl, NEW SESSION)
  │     ↓ 입력: spec + plan + decisions | 출력: 코드 변경
  ├── [Phase 6] harness-verify.sh      (automated  — shell, exit code)
  │     ↓ 입력: checklist.json | 출력: eval report
  └── [Phase 7] codex companion        (automated  — eval gate)
        입력: spec + plan + eval report + git diff

각 Phase간 컨텍스트는 파일로 이전. OS 세션은 공유하지 않음.
```

CLI는 상태를 `.harness/<runId>/state.json`에 유지하며 각 phase를 순차 실행한다. 어느 시점에 중단되더라도 `harness resume`으로 재개 가능하다.

**동시 실행 방지**: 두 단계 lock으로 직렬화한다.
1. **repo-global lock** `.harness/repo.lock`: CLI 시작 시 생성. 동일 저장소에서 어떤 runId로든 하나의 CLI 인스턴스만 허용. lock 파일에 `{cliPid, childPid, childPhase, runId, startedAt, childStartedAt}` 기록. `startedAt`/`childStartedAt`은 spawn 직후 OS에서 읽은 process start time (epoch seconds, PID 재사용 감지용). 읽기 실패 시 null. child 종료 시 `childPid`/`childPhase`/`childStartedAt` 모두 `null`로 갱신.
2. **run-level lock** `.harness/<runId>/run.lock`: run 단위 식별. repo.lock과 동시에 생성/삭제.

**원자적 lock 획득**: `repo.lock` 생성 시 `O_EXCL` (exclusive create) 플래그를 사용한다. Node.js에서는 `fs.openSync(lockPath, 'wx')`로 구현. 파일이 이미 존재하면 `EEXIST` 에러가 발생하며 즉시 실패한다. `repo.lock` 획득에 성공한 뒤 `run.lock`을 생성한다. `run.lock` 생성 실패 시 `repo.lock`을 삭제하고 에러 출력 후 중단한다.

**Lock 파일 쓰기** (`repo.lock`):
- **초기 획득**: `O_EXCL` (`fs.openSync(lockPath, 'wx')`) — 이미 정의. 초기 획득 성공 후 즉시 JSON 내용을 write + close.
- **내용 업데이트** (childPid, childPhase, childStartedAt 등 갱신): `repo.lock.tmp`에 새 JSON 기록 → `fsync` → `fs.renameSync('repo.lock.tmp', 'repo.lock')`. state.json과 동일한 원자 rename 전략. ftruncate 중 crash로 인한 JSON parse 실패를 원천 방지한다. rename은 atomic이므로 `repo.lock`은 항상 이전 버전 또는 새 버전 중 하나 — 중간 상태 없음.
- **crash 복구**: `repo.lock.tmp`가 `repo.lock` 없이 존재하면 → crash가 lock 업데이트 중간(rename 직전)에 발생한 것으로 간주. **삭제 전 `.tmp`를 파싱하여 `cliPid`/`childPid` liveness check를 수행한다** (정상 `repo.lock`과 동일한 liveness 규칙 적용). live subprocess가 발견되면 에러 출력 후 중단: "Previous harness process may still be running (from repo.lock.tmp). Verify and kill if needed, then delete .harness/repo.lock.tmp." live subprocess가 없으면(모두 ESRCH): `.tmp`에 저장된 `runId` 기준으로 `.harness/<runId>/run.lock`도 삭제한 뒤 `.tmp`를 삭제하고 "no lock" 상태로 진행한다 (`repo.lock` stale 정리와 동일한 `run.lock` cleanup 규칙). `.tmp` 파싱 실패 → 에러 출력 후 중단: "repo.lock.tmp is unreadable. Delete .harness/repo.lock.tmp manually if safe." `repo.lock` parse 실패 → "repo.lock is unreadable. Verify manually and delete .harness/repo.lock if safe." 자동 삭제 금지.

**`run.lock` 계약**: `run.lock`은 presence-only 파일이다 — JSON을 저장하지 않으며, 빈 파일(또는 runId 한 줄)로 생성한다. `repo.lock`이 모든 메타데이터를 보유하므로, `run.lock`은 "이 run 디렉토리가 활성 run과 연결되어 있는가"를 나타내는 marker 역할만 한다. parse 실패 개념이 없으며 존재 여부로만 판정한다.

**`state.json` 쓰기** (lock 파일과 별도 규칙):
- 기록 방식: `state.json.tmp`에 기록 → `fsync` → `fs.renameSync('state.json.tmp', 'state.json')`.
- POSIX rename은 atomic — state.json은 항상 이전 버전 또는 새 버전 중 하나. 중간 상태 없음. **보장 범위: process crash 기준** (OS process kill 포함). power loss / host crash 시 durability는 parent directory fsync가 필요하지만 여기서는 요구하지 않는다.
- crash 복구: `state.json` 없고 `state.json.tmp` 있으면 → `.tmp` 파싱 시도 후 복원. `state.json` parse 실패 시 → unrecoverable error: "state.json is corrupted. Manual recovery required."
- 모든 상태 전이는 단일 atomic rename으로 완료 (partial state 없음).

**`childPid` 추적 범위**: interactive phase(claude subprocess)와 automated phase(codex gate, harness-verify.sh) 모두 포함. 어떤 subprocess를 spawn하더라도 시작 시 `{childPid, childPhase}`를 lock에 기록하고, 완료 시 `null`로 갱신한다. 이를 통해 CLI crash 후 resume 시 게이트/검증 프로세스 중복 실행을 방지한다.

**프로세스 그룹 격리**: 모든 subprocess는 새 process group으로 spawn한다 (Node.js `spawn` 옵션 `detached: true` + `unref()` 없이 사용 — process group만 분리하고 harness parent와 연결 유지). `detached: true`로 spawn된 자식의 PGID = 자식의 PID. 따라서 아래 `childPid` 참조는 곧 process group ID 역할도 한다.

종료 시 `childPid` 단독이 아닌 **process group 전체**를 대상으로 한다: `process.kill(-childPid, 'SIGTERM')` (음수 PID = process group). 이를 통해 `claude` 또는 `node codex-companion.mjs`가 내부적으로 자식 프로세스를 생성했을 때에도 완전히 종료할 수 있다.

**liveness 검사 (authoritative)**:
1. `kill(-childPid, 0)` (음수 = PGID = childPid) → **ESRCH이면 stale** (group 완전 종료).
2. **ESRCH가 아니면 (group alive) → 항상 active로 판정**한다. leader의 start time 불일치로 stale 판정하지 않는다 — `kill(-childPid, 0)` 성공은 해당 PGID에 프로세스가 존재한다는 POSIX 보증이며, 그것이 orphan이든 PGID 재사용이든 안전한 쪽(active)으로 판정하는 것이 중복 실행 방지에 유리하다. false-positive "active"의 비용(사용자가 수동 종료 필요)은 false-negative "stale"의 비용(중복 실행 → 데이터 손상)보다 낮다.

이미 lock이 존재할 경우:
- **`cliPid` liveness** (PID + start time 방식): `kill(cliPid, 0)` 성공 + `startedAt`과 process start time 일치(±2초) → active. 에러 출력 후 중단. start time 불일치 → PID 재사용, stale. `kill` 실패(ESRCH) → stale.
- **`cliPid` stale 확인 후 `childPid` liveness** (PGID 방식 — 위 liveness 검사 규칙 참조): `childPid == null` → stale. `kill(-childPid, 0)` → ESRCH이면 stale. ESRCH 아니면 **항상 active** (에러 출력 후 중단).
- stale 확정 시: `repo.lock`에 저장된 `runId` 기준으로 `.harness/<storedRunId>/run.lock`을 삭제한 뒤 `repo.lock` 삭제. `runId` 필드가 없거나 `run.lock` 파일이 없으면 `repo.lock`만 삭제 (무해한 누락).

`startedAt` / `childStartedAt` **저장 형식 및 liveness 검증 — 동일 메서드 원칙**:
- **저장**: spawn 직후 아래 platform-specific helper로 해당 PID의 OS process start time을 즉시 읽어 lock에 저장한다. `Date.now()`는 사용하지 않는다.
  - **Linux**: `/proc/<pid>/stat` field 22(starttime, clock ticks since boot) + `/proc/stat`의 `btime` 라인 → epoch seconds = btime + (starttime / CLK_TCK). 저장 단위: epoch seconds (정수).
  - **macOS**: `ps -o etimes= -p <pid>` (프로세스 경과 초, 정수) + `Date.now()/1000`에서 차감 → epoch seconds. 저장 단위: epoch seconds (정수).
- **검증**: resume 시 동일 helper를 다시 호출하여 epoch seconds 값을 다시 읽는다. 저장값과 일치하면(정확히 같거나 ±2초 이내) 동일 프로세스로 판정. 불일치이면 PID 재사용으로 간주.
- **조회 실패 처리**: spawn 시 start time 조회 실패(ESRCH, 권한 오류 등) → `startedAt`/`childStartedAt`을 `null`로 저장. 검증 시 null이면 `kill(pid, 0)` PID alive check만으로 판정 (단, PID 재사용 감지 불가 — 이미 죽었으면 ESRCH, 살아있으면 통과).
- **저장 실패 시 동작**: start time 읽기 실패는 lock 생성 실패가 아니다. null로 저장하고 계속 진행한다.

모든 subprocess spawn 시 child PID와 start time을 lock 파일에 기록 (`childPid`, `childPhase`, `childStartedAt`). **`childPid` null 갱신 시점**: process group 전체가 소멸된 후 — 즉, `kill(-childPid, 0)`이 ESRCH를 반환하거나, 명시적 SIGKILL 종료 절차(SIGTERM → wait 5s → SIGKILL) 완료 후. leader process만 exit한 시점에 즉시 null로 갱신하지 않는다 (leader 종료 후에도 orphan children이 PGID에 남아 있을 수 있으므로, group liveness가 확인될 때까지 `childPid`를 유지해야 resume 시 active group을 감지할 수 있음). Interactive phase의 경우, `claude` subprocess가 정상 완료 후 exit하면 CLI가 `kill(-childPid, 0)`으로 group 소멸을 확인한 뒤 null로 갱신한다.
CLI 정상 종료 시 두 lock 파일 모두 삭제. `skip/jump/resume`도 repo.lock 획득 후에만 실행.

---

## Phase별 입출력 계약

| Phase | Type | Required Input | Output | PASS 조건 (다음 phase 진행 조건) |
|-------|------|----------------|--------|-------------------------------|
| 1 (brainstorm) | interactive | `.harness/<runId>/task.md` (CLI arg를 `harness run` 시 저장) | `docs/specs/<runId>-design.md`, `.harness/<runId>/decisions.md` | sentinel + process exit + 두 파일 존재 및 비어있지 않음 |
| 2 (spec gate) | automated | spec doc | verdict (stdout) | process exit 0 + `APPROVE` in stdout. (`REJECT`는 정상 실행 결과 — 상태 머신의 Gate REJECT 전이 참조) |
| 3 (plan) | interactive | spec doc, decisions.md | `docs/plans/<runId>.md`, `.harness/<runId>/checklist.json` | sentinel + process exit + 두 파일 존재 및 비어있지 않음 + checklist schema 유효 |
| 4 (plan gate) | automated | spec doc, plan doc | verdict (stdout) | process exit 0 + `APPROVE` in stdout. (`REJECT`는 정상 실행 결과) |
| 5 (impl) | interactive | spec doc, plan doc, decisions.md | 코드 변경 (커밋 필수) | sentinel + process exit + `git log <implRetryBase>..HEAD` 1개 이상 커밋 존재 + working tree clean (`git status --porcelain` 비어있음) |
| 6 (verify) | automated | `.harness/<runId>/checklist.json` | `docs/process/evals/<runId>-eval.md` | `verify-result.json.exitCode == 0` + eval report 유효 (존재 + 비어있지 않음 + `## Summary` 포함). (`exitCode ≠ 0 + hasSummary`는 정상적인 Verify FAIL — 상태 머신의 Verify FAIL 전이 참조) |
| 7 (eval gate) | automated | spec, plan, eval report, git diff | verdict (stdout) | process exit 0 + `APPROVE` in stdout. (`REJECT`는 정상 실행 결과) |

**파일 경로 생성 규칙**: `runId = YYYY-MM-DD-<slug>[-N]`. 슬러그는 task description에서 아래 정규화 알고리즘으로 생성:
1. 소문자로 변환
2. Unicode NFD 정규화 후 non-ASCII 문자 제거 (transliteration 불사용 — 결정론적 결과 보장)
3. 알파벳, 숫자 이외의 문자를 `-`로 치환
4. 연속된 `-`를 단일 `-`로 병합
5. 앞뒤 `-` 제거
6. 최대 50자로 잘라냄 (단어 경계에서 자름: 마지막 `-` 위치 이하로)
7. 결과가 빈 문자열이면 `"untitled"` 사용

같은 날 같은 슬러그에 대해 `.harness/<runId>/` **디렉토리가 존재하면** 이미 점유된 runId로 간주하여 `-2`, `-3` 순으로 suffix 추가. 예: `2026-04-12-graphql-api`, `2026-04-12-graphql-api-2`.

**harness run 초기화 실패 시 cleanup**:
- `state.json` 쓰기 **전** 실패: partial artifacts(`.harness/<runId>/` 디렉토리 포함)와 이미 획득한 `repo.lock`/`run.lock` 모두 삭제 후 에러 출력. 단, `.gitignore` 커밋이 완료된 경우 해당 커밋은 유지한다 (harm-free). 재실행 시 동일 runId 재사용 가능.
- `state.json` 쓰기 **후** 실패 (예: `current-run` 갱신 전, Phase 1 spawn 전): run은 보존한다 (state.json이 있으므로 resume 가능). `repo.lock`/`run.lock` 삭제 후 에러 출력 시 runId를 함께 출력: "Run initialization failed after state was created. Resume with: `harness resume {runId}`" 사용자는 `harness resume {runId}` 또는 `harness list`로 복구한다.

**Phase 5 checklist.json**: Phase 3 (plan 작성) 완료 시 Claude가 plan에서 검증 커맨드를 추출하여 `.harness/<runId>/checklist.json`으로 생성한다.

**checklist.json 스키마** (harness-verify.sh 입력 계약):
```json
{
  "checks": [
    { "name": "Type Check", "command": "pnpm tsc --noEmit" },
    { "name": "Lint",       "command": "pnpm lint" }
  ]
}
```
Phase 3 완료 검증: 위 스키마로 JSON 파싱 가능 + `checks` 배열 비어있지 않음 + 각 check에 `name`(string)과 `command`(string) 존재.

`related_spec`/`related_plan` 필드: **선택적 (optional)**. `harness-verify.sh`가 이 필드를 읽어 report 헤더에 출력하며, 없으면 "N/A"로 표시한다. CLI 검증에서는 필수 요구하지 않는다. Phase 3 Claude 세션이 이 필드를 포함하도록 권장하지만 없어도 run이 실패하지 않는다.

**evalReport**: Phase 6 (`harness-verify.sh`)가 `docs/process/evals/<runId>-eval.md`를 생성한다. Phase 7은 이 파일을 입력으로 사용한다.

**Preflight validation**:

`jump N` 실행 전: target phase의 required input 파일이 존재하는지 확인. Phase 1의 required input은 `task.md`이므로 그 파일을 검증한다. 없으면:
- Phase 1 (`task.md` 없음): `Error: task.md is missing — start a new run with 'harness run "task description"'`
- Phase 2~7: `Error: Phase N requires <file> — run 'harness jump <prev-phase>' first`

`skip` 실행 전: 먼저 현재 phase의 `required input` 파일 존재를 확인한다 (`jump`와 동일 기준). required input이 없으면 에러 출력 후 중단. required input 확인 후, "이 phase가 생성했어야 할 output artifact"가 이미 유효하게 존재하는지 추가 확인한다. skip 검증은 정상 완료 검증과 동일한 기준을 적용한다 (sentinel/process exit 제외). skip-specific artifact 요건:

| Phase | skip 허용 조건 (정상 완료 검증과 동일 기준) |
|-------|------------------------------------------|
| 1 (brainstorm) | `spec` 파일 + `decisionLog` 파일 존재 + 비어있지 않음 |
| 2 (spec gate) | **추가 artifact 조건 없음** (gate는 artifact 생성 없음). 단, generic required-input check(spec doc 파일 존재)는 항상 적용. |
| 3 (plan) | `plan` 파일 + `checklist` 파일 존재 + 비어있지 않음 + checklist schema 유효 (`checks` 배열 비어있지 않음, 각 항목에 `name`/`command` 존재) |
| 4 (plan gate) | **추가 artifact 조건 없음**. 단, required-input check(spec + plan 파일 존재)는 항상 적용. |
| 5 (impl) | working tree clean (Phase 6이 즉시 clean tree를 요구하므로 skip 시에도 확인) |
| 6 (verify) | working tree clean (`git status --porcelain` 비어있음) — Phase 6 실행과 동일 기준 |
| 7 (eval gate) | **추가 artifact 조건 없음**. 단, required-input check(spec + plan + eval report 파일 존재)는 항상 적용. |

---

## Phase 완료 감지

### Interactive phase (1, 3, 5)

**완료 조건: sentinel 파일 존재(fresh — 내용 == `phaseAttemptId[N]`) AND child leader process 종료 AND 선언된 output 파일 존재 검증**. child process의 exit code는 완료 판정에 사용하지 않는다 — sentinel + artifacts가 있으면 exit code와 무관하게 완료로 처리한다. sentinel 없이 child가 종료하면(exit code 무관) `failed`로 기록.

**Phase 완료와 lock cleanup의 분리**: interactive phase 완료 판정은 leader process 종료로 trigger된다. 완료 판정 후, CLI는 process group 소멸을 확인한다:
1. `kill(-childPid, 0)` → ESRCH이면 즉시 `childPid = null` 갱신.
2. ESRCH가 아니면 (orphan children 잔존): 최대 **5초** 대기 후 재확인.
3. 여전히 alive이면: `process.kill(-childPid, 'SIGTERM')` → 최대 5초 대기 → 여전히 alive이면 `process.kill(-childPid, 'SIGKILL')` (gate/verify timeout과 동일한 강제 종료 절차).
4. group 소멸 확인 후 `childPid = null` 갱신.
group cleanup은 다음 phase의 subprocess spawn 전에 반드시 완료되어야 한다 (새 subprocess가 동일 PGID를 재사용하는 것 방지).

**실행 계약 (subprocess spawn)**:
- 초기 프롬프트를 argv로 직접 embed하지 않는다. 모든 phase의 초기 프롬프트는 임시 파일에 기록한 뒤 파일 경로만 argv로 전달한다:
  ```bash
  INIT_PROMPT_FILE=".harness/<runId>/phase-N-init-prompt.md"
  # {초기 프롬프트 내용 작성} → INIT_PROMPT_FILE
  spawn('claude', ['--model', model, '@' + INIT_PROMPT_FILE], { stdio: 'inherit' })
  ```
  **`@file` 호환성**: Claude Code CLI는 `claude --model <model> @<file>` 형태의 파일 참조를 지원한다 (Claude Code의 표준 파일 참조 기능). **Preflight 실패** (항목 5에서 exit non-0): 즉시 unrecoverable configuration error로 중단 — phase 상태 변경 없음. "claude @<file> syntax is required but not supported. Please upgrade Claude Code CLI." stdin fallback은 사용하지 않는다. **Runtime 실패** (preflight 통과했지만 실제 spawn 후 @file 미인식): Claude가 초기 프롬프트 없이 세션을 시작하고 sentinel을 생성하지 않으므로 phase가 `failed`로 처리된다 (다른 child exit 케이스와 동일). 이 경우 사용자에게 Claude Code CLI 업그레이드를 안내한다.
- **Phase 1 특이사항**: 태스크 설명(`harness run "..."` arg)은 `harness run` 시 `.harness/<runId>/task.md`에 저장하고, Phase 1 초기 프롬프트는 그 파일을 참조하는 짧은 지시문으로 구성한다. 태스크 설명 자체를 argv에 inline하지 않는다.
- 재오픈 시 feedback 파일 경로도 동일하게 파일 참조 형태로 프롬프트에 포함한다 (inline 금지).
- TTY와 stdio는 harness CLI 프로세스에서 상속 (`stdio: 'inherit'`) — 개발자가 실시간으로 세션을 볼 수 있음.
- child PID는 spawn 직후 `repo.lock`의 `childPid`/`childPhase`/`childStartedAt`에 기록. child 종료 시 `null`로 갱신.

각 phase 초기 프롬프트에 지시 포함:
> "이 phase 작업이 완료되면 `.harness/<runId>/phase-N.done` 파일을 생성하고 세션을 종료하라."

**Sentinel 내용 규칙**: sentinel 파일(`.harness/<runId>/phase-N.done`)은 빈 파일이 아닌, 현재 `phaseAttemptId`를 단일 행으로 기록한다. `phaseAttemptId`는 phase spawn 직전에 생성한 UUID v4를 state.json의 `phaseAttemptId[N]` 필드에 저장한다. sentinel freshness 판정은 mtime 대신 sentinel 내용과 `phaseAttemptId[N]`의 일치 여부로 수행한다. 이로써 1초 정밀도 환경에서의 stale sentinel 오인 문제를 완전히 제거한다. 초기 프롬프트에서 Claude에게 전달하는 sentinel 생성 지시에 phaseAttemptId 값을 포함한다: `"phase-N.done 파일을 생성하고 내용으로 '{phaseAttemptId}' 한 줄을 기록한 뒤 세션을 종료하라."`

CLI 동작:
1. child process와 `.harness/<runId>/phase-N.done` 파일을 동시에 watch
2. sentinel 파일 생성 감지 + child process 종료 확인 → output 아티팩트 검증:
   - Phase 1: `spec doc`, `decisions.md` 존재 + 비어있지 않음 + mtime >= `phaseOpenedAt[1]` (동일 밀리초 타임스탬프도 통과)
   - Phase 3: `plan doc`, `checklist.json` 존재 + 비어있지 않음 + checklist schema 유효 (`checks` 배열 비어있지 않음, 각 항목에 `name`/`command` 존재) + mtime >= `phaseOpenedAt[3]` (동일 밀리초 타임스탬프도 통과)
   - Phase 5: `Phase 5 완료 계약 (authoritative)` 섹션 참조 — 커밋 + working tree clean 요건
3. 아티팩트 검증 실패 → 에러 메시지 출력 후 `harness resume` 안내 (해당 phase `failed` 상태)
4. child process가 sentinel 없이 종료 → 해당 phase를 `failed`로 기록, `harness resume` 안내
5. **각 phase 시작 전**: 해당 run의 이전 sentinel 파일이 있으면 삭제 (stale 방지). **Phase 1/3은 출력 artifact 파일도 삭제(존재하면)**: Phase 1 → spec doc + decisions.md 삭제; Phase 3 → plan doc + checklist.json 삭제. 이를 통해 "spawn 전 존재하던 파일이 새로 생성된 것처럼 mtime check를 통과하는" false-positive를 방지한다 (1초 정밀도 환경에서 phaseOpenedAt과 같은 초에 생성된 이전 파일 문제). `phaseOpenedAt[N]` 타임스탬프를 state에 기록 (아티팩트 fresh 검증에 사용).
6. **Phase 1/3/6 완료 후 (정상 완료, skip, auto 경로 모두)**: CLI가 아래 `normalize_artifact_commit` 절차를 실행한다. 정상 완료와 skip 경로 모두 동일한 절차를 사용한다 (no-op 규칙 포함).

이 자동 커밋 덕분에: spec + plan은 Phase 5 시작 전에 commit된 상태, eval report는 Phase 7 시작 전에 commit된 상태가 됨. **단, normalize_artifact_commit은 staged changes만 검사하므로, unstaged dirty 변경이 있으면 Phase 6 진입 시 clean-tree 조건이 잡아낸다** (Phase 6 사전 조건이 최후 보루). Phase 7의 `git diff <baseCommit>...HEAD`가 spec, plan, impl, eval report 전체를 포함하는 완전한 그림이 됨 — gate reviewer는 모든 구현 결정을 누적으로 확인할 수 있음. (`implRetryBase`는 Phase 5 완료 확인 전용으로만 사용; Phase 7 diff 범위에는 사용하지 않음.)

**`normalize_artifact_commit` 절차** (Phase 1/3/6 완료·skip·auto 경로에 동일 적용):

각 phase가 커밋하는 파일 목록 (`.harness/` 하위 파일은 gitignored이므로 커밋 대상 아님):
- **Phase 1**: `docs/specs/<runId>-design.md` (decisions.md는 `.harness/` 하위이므로 gitignored)
- **Phase 3**: `docs/plans/<runId>.md` (checklist.json은 `.harness/` 하위이므로 gitignored)
- **Phase 6**: `docs/process/evals/<runId>-eval.md`

절차:
1. 해당 phase의 커밋 대상 파일에 대해 `git status --porcelain <file>`을 실행한다.
2. 파일이 변경/신규(untracked 포함)이면:
   a. **staged 변경 확인**: `git diff --cached --name-only`로 이미 staged된 파일 목록을 확인.
      - staged 없음 → step b 진행.
      - **대상 artifact 파일만 staged** (이전 normalize가 `git add` 후 `git commit` 전에 중단된 경우): `git add` 생략, 바로 `git commit -m "<msg>"` 실행 (interrupted normalize 복구).
      - **대상 artifact 이외의 파일이 staged됨**: 에러 출력 후 중단: "Cannot auto-commit artifact: other staged changes exist. Unstage them with `git restore --staged .`"
   b. staged에 이상 없으면: `git add <file> && git commit -m "<msg>"` 실행.
      - 정상 완료: `"harness[<runId>]: Phase N — <artifact>"` (예: `"harness[...]: Phase 1 — spec written"`)
      - skip/auto: `"harness[<runId>]: Phase N — <artifact> (skip)"`
3. 파일이 이미 committed/clean이면 → no-op (Phase 6 normalize_artifact_commit 실패 후 resume 시 재시도에서 파일이 이미 커밋된 경우 해당). 참고: Phase 7 reject 후 Phase 6 재실행에서는 Phase 6 진입 전 사전 조건이 기존 eval report를 git rm + commit으로 삭제하므로, 이후 새로 생성된 report는 항상 신규 파일로 처리되어 no-op이 발생하지 않는다.
4. 커밋 실패(git 에러) → 에러 출력 후 중단:
   - Phase 1/3: phase status = `"error"`, `pendingAction = null`. 사용자에게 git 상태 확인 및 수동 수정 안내. resume 시 `error + currentPhase ∈ {1, 3}` 케이스 (sentinel 존재) → artifact re-validation 후 normalize_artifact_commit 재시도 (artifact validator 먼저, 통과 시만 커밋 재시도). pendingAction 없이 error state 자체가 recovery trigger.
   - Phase 6 (정상 실행 경로): phase status = `"error"`, pendingAction = `null`. resume 시 `error + currentPhase == 6` 케이스에서 eval report 파일 존재 여부로 분기:
     - eval report 파일 존재 → `normalize_artifact_commit` 재시도 (report는 이미 작성됨, 커밋만 재시도)
     - eval report 파일 없음 → Verify ERROR UI 표시 (정상 실행 경로 커밋 실패인데 report가 없으면 비정상)
   - Phase 6 (skip/auto 경로): skip 시 synthetic report가 이미 생성되어 있으므로 정상 실행 경로와 동일하게 처리 — phase status = `"error"`, pendingAction = `null`. resume 시 eval report 파일 존재 확인 후 `normalize_artifact_commit` 재시도. `rerun_verify`를 사용하지 않음 (skip 의도를 보존).
Phase 6 skip 시 생성되는 synthetic eval report도 이 절차로 자동 커밋한다.

**`phaseOpenedAt`**: state.json에 phase별 마지막 subprocess spawn 타임스탬프를 **Unix epoch milliseconds** (정수)로 저장 (`phaseOpenedAt: { "1": 1744444800000, "3": null, "5": null }`). spawn 직전에 `phaseOpenedAt[N] = Math.floor(Date.now() / 1000) * 1000` (1초 truncate)으로 캡처한다. Phase 1/3 **아티팩트** 완료 검증 시 파일 mtime(ms)이 `phaseOpenedAt[N]` 이상이어야 한다 — 단, Phase 1/3은 phase 시작 전 artifact를 삭제하므로 mtime check는 2차 방어선이다. **Sentinel 신선도 판정은 mtime 대신 `phaseAttemptId`로 수행한다** (아래 참조). mtime 읽기 시 `Math.floor(mtime_sec * 1000)` 변환.

**`phaseAttemptId`**: interactive phase를 열 때마다 새 UUID v4를 생성하여 `phaseAttemptId[N]`로 state에 저장. **생성 시점**: `pendingAction = reopen_phase`를 기록하는 동일 atomic write에 포함하여, crash 후 resume 시 새 attemptId가 이미 state에 있도록 보장한다. 최초 phase 시작 (`harness run` 또는 `jump`)에서도 phase 실행 전 state atomic write에 포함. sentinel 파일(`phase-N.done`)에 이 UUID를 단일 행으로 기록하도록 초기 프롬프트에 포함. sentinel 신선도 = `sentinel 파일 존재 AND 내용 == phaseAttemptId[N]`. 이전 attempt의 sentinel은 새 attemptId와 불일치하므로 자동으로 stale 판정된다.

**Resume 동작**: `harness resume` 시 아래 순서로 상태를 복구한다:
0. **먼저** repo.lock의 존재와 `cliPid`/`startedAt`을 확인한다 — `pendingAction` 여부와 무관하게 항상 선행 실행:
   - **repo.lock 없음** (정상 종료 후 lock 삭제된 일반 케이스) → 이전 CLI 없음으로 간주. 다음 단계 진행.
   - **repo.lock 있음 + JSON parse 실패** (corrupted lock 파일) → 에러 출력 후 중단: "repo.lock is unreadable. Verify manually and delete .harness/repo.lock if safe." 자동 삭제하지 않는다 (race condition 방지). state 검사나 lock 재획득 시도 전에 즉시 중단.
   - repo.lock 있음 + **`cliPid`가 살아있고** (`kill(cliPid, 0)` 성공) **startedAt과 process start time이 일치**하거나 **`startedAt == null`** (start time 조회 불가 — alive check만으로 active 판정)하면 → 에러 출력: "harness is already running (PID: {cliPid}). Stop it before resuming." 중단. (CLI가 gate error/escalation UI를 띄우고 대기 중인 상태 포함)
   - repo.lock 있음 + `cliPid`가 죽어있거나 PID 재사용 → 추가로 **authoritative 2-step PGID liveness check** (위에서 정의) 수행:
     - `childPid` null → stale. `repo.lock`에 저장된 `runId` 기준으로 `.harness/<storedRunId>/run.lock` 삭제 후 `repo.lock` 삭제. 다음 단계 진행.
     - `childPid` non-null: `kill(-childPid, 0)` 실행 → **ESRCH이면** (group 전체 종료): stale. 동일하게 `.harness/<storedRunId>/run.lock` 삭제 후 `repo.lock` 삭제 후 진행.
     - `kill(-childPid, 0)` **ESRCH 아님** (group 살아있음): **항상 active로 판정** (liveness 검사 규칙 참조). 에러 출력 후 중단: "이전 서브프로세스 그룹이 아직 실행 중입니다 (PGID: {childPid}, Phase: {childPhase}). 해당 프로세스 그룹을 종료한 후 resume하세요."
1. **completed phase artifact 존재 및 유효성 확인**: 이미 `completed`로 표시된 phase의 필수 artifact 파일이 실제로 존재하고 유효한지 검증한다 (git reset/rebase, .harness/ 파일 삭제 등으로 artifact가 사라진 경우 감지). **mtime freshness check는 수행하지 않는다.** **git-committed 상태 검증**: completed artifact가 해당 `*Commit` 기준으로 수정되었는지 확인한다. `git diff <*Commit> -- <artifactPath>`가 비어있지 않으면 uncommitted 수정이 존재 — 이 경우 에러 출력: "Artifact {path} has been modified since it was committed at {*Commit}. Commit changes first, or use 'harness jump N' to re-run from that phase." 이 검증은 Phase 7 `git diff` review 범위와 실제 파일 내용의 일관성을 보장한다. 사용자가 spec/plan을 의도적으로 수정한 경우 commit해야 Phase 7 diff에 반영된다. pendingAction replay 전에 수행하여 재생할 액션의 전제 artifact가 유효한지 먼저 확인한다.
   - `phases[1] == "completed"` → `artifacts.spec` 파일 + `artifacts.decisionLog` 파일 존재 + 비어있지 않음 확인
   - `phases[3] == "completed"` → `artifacts.plan` 파일 + `artifacts.checklist` 파일 존재 + 비어있지 않음 + checklist schema 유효 확인
   - `phases[6] == "completed"` → `artifacts.evalReport` 파일 존재 + 비어있지 않음 + `## Summary` 섹션 포함 확인 (skip 경로 포함 — synthetic report도 동일 형식이어야 함)
   - 누락/유효하지 않은 파일 발견 시: 에러 출력 "Artifact missing or invalid for completed phase N: {path}. Use 'harness jump N' to re-run from that phase." 중단.
2. `pendingAction`이 non-null이면 → 해당 액션을 즉시 실행 (아래 단계 생략). 완료 후 pendingAction = null.

이후 일반 복구 경로: run status → current phase status 순으로 판단한다:
3. **run status** 확인:
   - `run.status == "paused"` → `pendingAction`으로 분기 (step 2에서 이미 처리됨; paused run은 항상 대응하는 pendingAction이 설정되어 있음). `pauseReason`은 pendingAction handler 내부에서 UI 메시지 선택에만 사용 — resume 알고리즘 자체의 분기 조건이 아님.
   - `run.status == "in_progress"` → current **phase status** 확인:
     - **automated phase** (`currentPhase ∈ {2,4,7}`) + `pending` → 해당 gate 실행 시작 (jump 후 crash → spawn 전 미완 케이스; `in_progress` + pendingAction null과 동일하게 처리)
     - **automated phase** (`currentPhase ∈ {2,4,7}`) + `in_progress` + `pendingAction == null` (sentinel 없음; uncontrolled crash 케이스) → `gate-N-result.json` 존재 여부로 분기: 존재하면 저장된 결과로 verdict 파싱 + 정상 처리(APPROVE/REJECT/error 경로); 없으면 해당 gate 재실행 (gate execution error와 동일 처리)
     - **automated phase** (`currentPhase == 6`) + `pending` → Phase 6 시작 (jump 후 crash 케이스)
     - **automated phase** (`currentPhase == 6`) + `in_progress` + `pendingAction == null` → `verify-result.json` 존재 여부로 분기:
       - 존재하고 `exitCode == 0` → 전체 성공 조건 재검증: eval report 존재 + 비어있지 않음 + `## Summary` 포함. 모두 충족하면 `normalize_artifact_commit` 재시도 (PASS 결과; 커밋만 미완). 조건 미충족이면 Verify ERROR UI 표시 (비정상 성공 케이스)
       - 존재하고 `exitCode ≠ 0, hasSummary == true` → **live 실행과 동일한 Verify FAIL 핸들러를 호출한다**: `verifyRetries += 1` 증가 → `verifyRetries >= 3`이면 에스컬레이션 (또는 자율 모드면 강제 통과) → 미만이면: `verify-feedback.md` 이미 존재하면 feedback 복사 스킵; 없으면 eval report에서 복사 후 (eval report도 없으면 → Verify ERROR UI 표시). feedback 복사 완료(또는 스킵) 후, pendingAction = reopen_phase atomic write → 원본 eval report 삭제 → Phase 5 재오픈.
       - 존재하고 `exitCode ≠ 0, hasSummary == false` → Verify ERROR UI 표시
       - 없음 → **항상 Verify ERROR UI 표시** (eval report 존재 여부 무관). `verify-result.json` 없이는 PASS/FAIL을 안전하게 구분할 수 없음 — eval report가 존재해도 이전 FAIL 실행의 잔존 파일일 수 있음.
     - **interactive phase** (`currentPhase ∈ {1,3,5}`) + `pending` → 해당 phase 시작 (jump 후 crash → spawn 전 미완 케이스; `in_progress` + sentinel 없음과 동일하게 처리)
     - **interactive phase** (`currentPhase ∈ {1,3,5}`) + `in_progress` 또는 `failed` + sentinel 없음 → 해당 phase를 재오픈 (sentinel 정리 후 claude subprocess 재시작)
     - `in_progress` + sentinel 있음 → **sentinel 내용이 `phaseAttemptId[N]`과 일치하는지 확인**. 일치하면(fresh sentinel): 아티팩트 검증 실행. 검증 통과 시: Phase 1/3이면 `normalize_artifact_commit` 실행 후 다음 phase 진행. Phase 5이면 바로 다음 phase 진행. 불일치하면(stale sentinel): sentinel 삭제 후 "sentinel 없음" 경로로 처리 (해당 phase 재오픈).
     - `failed` + sentinel 있음 → **sentinel 내용이 `phaseAttemptId[N]`과 일치하는지 확인**. 일치하면(fresh): 아티팩트 검증 실행. 검증 통과 시: Phase 1/3이면 `normalize_artifact_commit` 후 다음 phase, Phase 5이면 바로 다음 phase. 검증 실패 시 해당 phase 재오픈. 불일치하면(stale): sentinel 삭제 후 해당 phase 재오픈.
     - `error` + currentPhase ∈ {2,4,7} → 해당 gate 재실행 (gate execution error 복구 경로)
     - `error` + currentPhase == 6 + eval report 파일 존재 → `normalize_artifact_commit` 재시도 (실행 및 skip/auto 경로 모두; report는 이미 작성됨, 커밋만 재시도). 성공 시 Phase 7 진행. 실패 시 에러 출력 후 중단.
     - `error` + currentPhase == 6 + eval report 파일 없음 → Verify ERROR UI 재표시 (retry: Phase 6 재실행, quit: paused)
     - `error` + currentPhase ∈ {1,3} + sentinel 존재 → **artifact re-validation 먼저 수행** (normalize_artifact_commit 직전에 정상 완료 시점과 동일한 validator 재실행): Phase 1이면 spec/decisions 파일 존재 + 비어있지 않음 + mtime >= phaseOpenedAt[1] 확인, Phase 3이면 plan/checklist 파일 + schema 유효 + mtime >= phaseOpenedAt[3] 확인. 검증 통과 시만 normalize_artifact_commit 재시도. 검증 실패 시 에러 출력 후 중단: "Artifact validation failed for phase N. The artifact may have been modified or deleted. Use 'harness jump N' to re-run from that phase."
     - `error` + currentPhase ∈ {1,3} + sentinel 없음 → **skip 경로 커밋 실패 복구**: artifact 존재 + 비어있지 않음 확인 (mtime check 없음 — skip 경로는 phaseOpenedAt 미설정). 검증 통과 시 normalize_artifact_commit 재시도. 검증 실패 시 에러: "Artifact missing for phase N. Use 'harness jump N' to re-run."
   - 위 어느 케이스에서도 단계 0에서 `childPid`가 죽어있음을 확인한 상태이므로 새 subprocess를 spawn해도 중복 실행이 없음이 보장됨

### Automated phase (2, 4, 7) — Codex Gate

**Codex companion 경로 해석**: CLI 초기화 시 glob으로 최신 버전을 탐색하여 경로를 결정한다.
```bash
# 버전 해석 (semver 내림차순 정렬 후 최신)
CODEX_PATH=$(ls ~/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs \
  2>/dev/null | sort -t/ -k9 -V | tail -1)
```
경로가 존재하지 않으면 `harness run` 시 에러 출력 후 중단. 경로는 state.json에 `codexPath`로 저장하여 run 중 재탐색 없이 사용.

**실행 계약:**
```bash
# 1. 프롬프트를 임시 파일에 기록 (argv 길이 제한 및 shell quoting 문제 회피)
PROMPT_FILE=$(mktemp /tmp/harness-gate-XXXXXX.txt)
printf '%s' "{assembled prompt}" > "$PROMPT_FILE"
# 2. stdin으로 전달 (argv embed 금지)
node "$CODEX_PATH" task --effort high < "$PROMPT_FILE"
rm -f "$PROMPT_FILE"
```

Node.js 구현 계약: `codexPath`는 `.mjs` 스크립트 경로이므로 Node 인터프리터를 명시적으로 사용한다: `spawn('node', [codexPath, 'task', '--effort', 'high'], { stdio: ['pipe', 'pipe', 'pipe'], cwd: projectRoot })` 후 `child.stdin.write(prompt); child.stdin.end()`. 이 방식은 PID 추적, timeout, sidecar 저장 등 비동기 subprocess 모델과 호환된다. 어떤 경우에도 프롬프트를 직접 argv string으로 embed하지 않는다.

- `cwd`: 프로젝트 루트
- timeout: 120초
- **Phase 시작 직전 sidecar 초기화**: gate phase(2/4/7) 시작 시 이전 실행의 stale sidecar를 삭제한다: `gate-N-raw.txt`, `gate-N-result.json`, `gate-N-error.md` (존재하면). 이를 통해 resume이 이전 결과를 새 결과로 오인하는 것을 방지한다.
- **Gate 결과 원자적 기록**: gate subprocess가 종료하는 즉시, 다른 파일 조작 전에 raw stdout을 `.harness/<runId>/gate-N-raw.txt`에 저장하고 exit code도 함께 `gate-N-result.json` = `{exitCode, timestamp}`로 기록한다. Gate 완료(state 갱신) 후 두 파일 모두 삭제한다.
- **Resume 시 sidecar 파일 사용 규칙** (partial existence / corruption 포함):
  - `gate-N-result.json` AND `gate-N-raw.txt` 모두 유효 → 저장된 결과로 verdict 파싱 + 정상 처리 (gate 재실행 없음)
  - `gate-N-result.json`만 있고 `gate-N-raw.txt` 없거나 비어있음 → gate 재실행 (raw output 없이는 verdict 파싱 불가)
  - `gate-N-raw.txt`만 있고 `gate-N-result.json` 없음 → gate 재실행 (exit code 없이는 성공/실패 구분 불가)
  - 둘 중 하나라도 parse 실패 → gate 재실행
  - 두 파일 모두 없음 → gate 재실행 (uncontrolled crash 케이스)
- **Verdict 파싱**: `gate-N-raw.txt`(또는 stdout)에서 `## Verdict` 헤더의 존재를 먼저 확인한다. 헤더가 없으면 gate execution error (구조 불완전). 헤더가 있으면 그 이후 첫 번째 `APPROVE` 또는 `REJECT` 토큰을 읽는다. (`## Comments`와 `## Summary`는 정보 제공용 — CLI는 verdict 파싱에만 사용하고 구조 유효성을 강제하지 않는다. 불완전한 Comments/Summary는 gate 결과에 영향 없음.)
- **비정상 종료** (exit code ≠ 0, timeout, 또는 exit 0이지만 `## Verdict` 헤더 없음 또는 `APPROVE`/`REJECT` 토큰 없음): gate execution error로 처리
- **Gate 실행 에러 진단 파일**: 비정상 종료 시 stdout/stderr를 `.harness/<runId>/gate-N-error.md`에 저장한다 (Phase 6의 `verify-error.md`와 동일한 패턴). retry 성공 또는 gate 정상 완료 시 삭제. jump reset 테이블에도 포함 (아래 참조).
- **종료 절차 (timeout/error 시)**: 아래 순서로 child process를 종료한 뒤 `childPid = null`을 기록하고 retry/quit를 허용한다.
  1. `process.kill(-childPid, 'SIGTERM')` 전송 (음수 = process group 전체)
  2. 최대 5초 대기 (group leader의 process exit 대기)
  3. 여전히 alive이면 `process.kill(-childPid, 'SIGKILL')` 전송
  4. process 종료 확인 후 → `childPid`/`childPhase`/`childStartedAt` = null로 lock 갱신
  5. stdout/stderr를 `gate-N-error.md`에 저장 후 사용자에게 retry / skip / quit 선택 제시:
     ```
     ⚠️  Gate execution error: {gate} 실행 실패.
         [R]etry — 동일 gate 재실행
         [S]kip  — 이 gate 강제 통과 (Gate REJECT 에스컬레이션 [S]kip과 동일 처리)
         [Q]uit  — run 중단 (resume 가능)
     ```
  이 절차 없이 `childPid = null`을 기록하면 retry 시 이전 프로세스가 살아있어 중복 실행이 발생할 수 있음.

**harness-verify.sh 종료도 동일 절차**: Phase 6 timeout/error 시에도 위 SIGTERM → wait → SIGKILL 순서를 적용한다.

**Phase 6 timeout 정책**: 전체 `harness-verify.sh` subprocess에 대한 총 실행 시간 상한을 **300초**로 설정한다 (개별 check별 timeout이 아닌 subprocess 전체). timeout 발생 시:
1. SIGTERM → 5초 대기 → SIGKILL (위와 동일 절차)
2. `verify-result.json` = `{exitCode: 1, hasSummary: false, timestamp: ...}` 기록 (hasSummary false → Verify ERROR 분류)
3. Verify ERROR 처리 경로 진입 (retry/quit 선택)

**출력 스키마** (structured_output_contract로 강제):
```
## Verdict
APPROVE | REJECT

## Comments
- **[P0|P1|P2|P3]** — Location: ...

## Summary
...
```

### Automated phase (6) — harness-verify.sh

**실행 계약:**
```bash
~/.claude/scripts/harness-verify.sh \
  .harness/<runId>/checklist.json \
  docs/process/evals/<runId>-eval.md
```

**Phase 6 진입 직전 sidecar 초기화**: harness-verify.sh 실행 전에 이전 실행의 stale `verify-result.json`을 삭제한다 (존재하면). 이를 통해 resume이 이전 verify 결과를 현재 실행 결과로 오인하는 것을 방지한다.

**Phase 6 상태 전이 규칙**: Phase 6 사전 조건(eval report 초기화, clean-tree 확인)은 `phases[6] = "pending"` 상태에서 실행한다. **`phases[6] = "in_progress"`로 전환하는 것은 harness-verify.sh subprocess를 실제로 spawn한 직후** (`childPid` 기록과 동시). 이를 통해 사전 조건 중 crash 시 resume이 `pending + currentPhase == 6` → Phase 6 처음부터 재시작 (사전 조건 재실행, idempotent)으로 처리되고, subprocess crash 시에만 `in_progress + verify-result.json 없음` → Verify ERROR로 분류된다.

**Phase 6 진입 전 사전 조건** (CLI가 harness-verify.sh 실행 전에 검증, `phases[6] = "pending"` 상태에서 실행, 아래 순서대로):
1. **전체 tree 사전 검사** (eval report 정리보다 먼저 수행 — git 상태를 변경하기 전에 중단 가능성을 확인):
   - `git diff --cached --name-only`로 staged 파일 목록 확인. eval report 경로 이외의 staged 변경이 있으면 에러 출력 후 중단: "Cannot reset eval report: other staged changes exist. Unstage them with `git restore --staged .`"
   - `git status --porcelain`으로 unstaged/untracked 파일 확인. eval report 경로를 제외한 파일이 있으면 에러 출력 후 중단: "Working tree must be clean before verification (unrelated changes detected). Commit or stash changes first." — **이 시점에서는 eval report를 아직 건드리지 않았으므로 git history 변경 없이 안전하게 중단된다.**
2. **Eval report 초기화** (step 1 통과 후: tree가 eval report 외에 clean함이 확인된 상태에서만 실행):
   - eval report 파일 상태별 처리 (`git ls-files <file>`와 `git status --porcelain <file>` 기준):
     - **파일 없음**: no-op.
     - **untracked** (`git ls-files` 결과 없음 + `git status --porcelain` = `??`): 일반 `rm`으로 삭제.
     - **staged new** (아직 commit 없음, `git status --porcelain` = `A `): `git restore --staged <file> && rm <file>` (un-stage 후 삭제).
     - **git-tracked** (committed — `git ls-files` 결과 있음): `git rm -f <file> && git commit -m "harness[<runId>]: Phase 6 — reset eval report for re-verification"`. step 1에서 eval report 외 dirty 변경이 없음을 확인했으므로 이 commit은 eval report 삭제만 포함한다.
   - 삭제 또는 commit 실패 → 에러 출력 후 중단.
3. **Working tree clean 최종 확인**: `git status --porcelain` 비어있어야 함 (step 2 완료 후 잔존 파일 방지용 최종 검증). dirty이면 에러 출력 후 중단. Phase 5 skip이나 `--allow-dirty` 여부와 무관하게 항상 적용.

**Phase 6 결과 원자적 기록**: `harness-verify.sh` subprocess가 종료하는 즉시, **다른 어떤 파일 조작보다 먼저** `.harness/<runId>/verify-result.json`을 기록한다:
```json
{ "exitCode": 1, "hasSummary": true, "timestamp": 1744444800000 }
```
이 파일이 존재하면 resume 시 eval report 존재 여부보다 이 파일의 결과를 우선한다. PASS/FAIL/ERROR 판정은 항상 이 파일 기반으로 수행한다. **`verify-result.json` 삭제 시점**: Phase 6 PASS 후 `normalize_artifact_commit` 완료 **AND** `phases[6] = "completed"` state atomic write 완료 후에 삭제한다 (state 전환 전에 삭제하면 crash 시 resume이 Verify ERROR로 오분류함). Phase 6 재실행 시 덮어쓴다. **Resume 시 `phases[6] = "completed"` + `verify-result.json` 없음**: crash가 state 전환 후 파일 삭제 전에 발생한 정상 케이스 — 이미 completed이므로 그냥 Phase 7로 진행한다 (Verify ERROR로 분류하지 않음).

**Phase 6 성공 조건**: `verify-result.json.exitCode == 0` + eval report 파일 존재 + 비어있지 않음 + `## Summary` 섹션 포함. `harness-verify.sh`는 모든 check 완료 후에만 `## Summary`를 추가하므로, exit 0이고 `## Summary`가 있으면 모든 check가 정상 완료된 것이다.

**Phase 6 실패는 두 가지 경우로 구분한다:**

`harness-verify.sh`는 report 헤더를 check 실행 전에 먼저 쓰고, 모든 check가 완료된 후에만 `## Summary` 섹션을 추가한다. 이 동작을 기반으로 FAIL/ERROR를 구분한다.

1. **Verify FAIL** (eval report 정상 완성): `verify-result.json.exitCode ≠ 0`이고 `hasSummary == true`인 경우 (스크립트 정상 완료, 1개 이상 check fail).
   - eval report를 `verify-feedback.md`에 저장 후 Verify Fail 복구 경로 진입 (Phase 5 재오픈 루프).

2. **Verify ERROR** (아래 중 하나): 
   - `verify-result.json.exitCode ≠ 0`이고 `hasSummary == false`인 경우 (스크립트 중간 crash)
   - `verify-result.json.exitCode ≠ 0`이고 eval report가 없거나 비어있는 경우 (report 작성 전 실패)
   - `verify-result.json.exitCode == 0`이지만 eval report가 없거나 비어있는 경우 (비정상 성공)
   - `verify-result.json` 자체가 없는 경우 (subprocess 시작 전 crash): **항상 Verify ERROR로 처리** (eval report 존재 여부 무관 — eval report 단독으로 PASS/FAIL 구분 불가)
   - `verify-result.json`이 존재하지만 JSON parse 실패 또는 필수 필드(`exitCode`, `hasSummary`) 누락: 파일이 없는 것과 동일하게 **Verify ERROR로 처리** (corrupt/incomplete sidecar)
   - 스크립트의 stdout/stderr를 캡처하여 `.harness/<runId>/verify-error.md`에 저장.
   - 사용자에게 알림 후 `[R]etry` / `[Q]uit` 선택 (verifyRetries 증가 없음).
   - retry: `verify-error.md` 덮어쓰기 허용 후 동일 Phase 6 재실행. quit: run.status = "paused", pauseReason = "verify-error".
   - Verify PASS 시 `verify-error.md` 삭제 (stale error artifact 정리).

---

## 실패 처리 & 상태 머신

### Gate Reject (Phase 2, 4, 7)

```
Gate REJECT
  → verdict와 comments를 .harness/<runId>/gate-<N>-feedback.md에 저장
  → gateRetries[N] += 1 (state에 기록)
  → gateRetries[N] < 3: 이전 interactive phase를 feedback과 함께 재오픈
      - Phase 2 reject → Phase 1 재오픈 (spec 수정)
      - Phase 4 reject → Phase 3 재오픈 (plan 수정)
      - Phase 7 reject → Phase 5 재오픈 (impl 수정) + Phase 6 재실행
  → 재오픈 시 해당 phase 프롬프트에 feedback 파일 경로 주입:
      "이전 리뷰 피드백 (반드시 반영): .harness/<runId>/gate-N-feedback.md"  (내용 inline 금지)
  → 수정 완료 후 해당 gate 재실행
  → gateRetries[N] >= 3: 에스컬레이션 (사용자 판단 요청) — "3회 reject됨" UI 표시
  → 자율 모드: gateRetries[N] >= 3 시 해당 gate 강제 통과

Gate 실행 에러 (exit code ≠ 0, timeout, 또는 exit 0이지만 `APPROVE`/`REJECT` 토큰 없음):
  → verdict 파싱 불가로 처리 (gateRetries 증가하지 않음)
  → state: 해당 phase status = "error"
  → stdout/stderr를 gate-N-error.md에 저장 후 사용자에게 retry / skip / quit 선택 (Codex Gate 섹션 UI와 동일)
  → retry 선택: 동일 gate 재실행 (phases[N] = "error" → in_progress)
  → skip 선택: Gate REJECT 에스컬레이션 [S]kip과 동일 처리 (전이 표의 "Gate execution error [S]kip" 행)
  → quit 선택: run status = "paused", CLI 정상 종료 (lock 삭제)
  → resume 시: 해당 gate 재실행 (이전 interactive phase 재오픈 없음)
```

**판단 단순화**: CLI 아키텍처에는 "Claude Code가 agree/disagree를 판단"하는 별도 actor가 없다. Gate REJECT 시 항상 이전 interactive phase를 재오픈하고, 그 세션의 Claude Code가 feedback을 보고 무엇을 반영할지 결정한다. 비동의 의견은 해당 세션 내에서 사용자와 대화로 처리한다.

**gateRetries 의미**: phase별 총 reject 횟수 (이슈 단위 아님, 실행 에러 포함 안 함). 임계값 3회: `gateRetries[N] >= 3`이면 에스컬레이션.

### Verify Fail (Phase 6)

```
Verify FAIL
  → eval report를 .harness/<runId>/verify-feedback.md에 복사
  → 원본 docs/process/evals/<runId>-eval.md 삭제 (Phase 5 working tree clean 보장)
  → verifyRetries 카운터 증가 (state에 기록)
  → Phase 5를 재오픈하여 failing check 수정
  → 재오픈 시 Phase 5 프롬프트에 verify-feedback.md 파일 경로 주입:
      "검증 실패 내용: .harness/<runId>/verify-feedback.md — 위 파일을 읽고 실패 항목들을 수정하라."  (내용 inline 금지)
  → 수정 완료 후 Phase 6 재실행
  → Phase 6 pass → verifyRetries 리셋 (0) → Phase 7 진행
  → Phase 7 REJECT로 Phase 5 재오픈 → Phase 6 재실행 시 verifyRetries 리셋 (0) (새 검증 사이클)
  → Phase 6 3회 연속 fail (verifyRetries >= 3) → 에스컬레이션
```

### 에스컬레이션 UI

```
⚠️  Gate 에스컬레이션: Codex가 3회 reject했습니다.
    이슈: [이슈 요약]
    [C]ontinue — 이전 phase 재오픈  [S]킵  [Q]uit:
```

### state.json 상태 전이

**Phase status:**
```
pending → in_progress → completed
                     ↘ failed   → in_progress (retry/resume)
                     ↘ error    → in_progress (retry/resume — gate execution error)
```

**Run status:**
```
in_progress → completed (모든 phase 완료)
           ↘ paused    (에스컬레이션 Quit 선택 또는 gate/verify error Quit — resume 가능)
```
유효한 `run.status` 값: `"in_progress"` | `"completed"` | `"paused"`. run 레벨 `"failed"` 또는 `"error"` 상태는 없다 — phase 레벨에만 `failed`/`error` 상태가 존재하고, 이 경우 `run.status = "in_progress"`를 유지한다 (언제든 resume 가능).

**완료 상태의 `currentPhase`**: Phase 7 APPROVE 후 상태 전이 표 규칙(`Gate APPROVE | N+1`)에 따라 `currentPhase = 8`로 설정하고 `run.status = "completed"`로 전환한다. `8`은 terminal sentinel 값으로 실제 phase가 아니다. `harness jump N` (N ∈ {1..7})은 `run.status == "completed"` 상태에서 항상 허용한다 — "현재 phase보다 작은 phase" 규칙은 `run.status == "in_progress"` 상태에서만 적용하며, 완료된 run에서는 N이 8 미만이면 모두 backward로 간주한다.

**이벤트별 상태 전이 (authoritative)**:

| 이벤트 | currentPhase | phases[N] | run.status | 비고 |
|--------|-------------|-----------|------------|------|
| Interactive phase 정상 완료 | N+1 | N: completed | in_progress | childPid = null |
| Interactive phase: child exit, sentinel 없음 | N | N: failed | in_progress | 재오픈 대기 |
| Interactive phase: 아티팩트 검증 실패 | N | N: failed | in_progress | 재오픈 대기 |
| Gate APPROVE (Phase 2 or 4) | N+1 | N: completed | in_progress | — |
| Gate APPROVE (Phase 7) | 8 | 7: completed | **completed** | run 완료 (terminal) |
| Gate REJECT — Phase 2 or 4 (retries < 3) | prev-interactive | N: in_progress, prev: in_progress | in_progress | feedback 저장, gateRetries[N]++ |
| Gate REJECT — Phase 7 (retries < 3) | 5 | 7: in_progress, 6: pending, 5: in_progress | in_progress | feedback 저장, gateRetries[7]++, verifyRetries 리셋. evalReport 파일은 건드리지 않음 — 실제 삭제/reset은 Phase 6 재진입 사전 조건이 담당 |
| Gate REJECT 에스컬레이션 [C]ontinue (Phase 2 or 4) | prev-interactive | N: in_progress, prev: in_progress | in_progress | gateRetries[N] 리셋 |
| Gate REJECT 에스컬레이션 [C]ontinue (Phase 7) | 5 | 7: in_progress, 6: pending, 5: in_progress | in_progress | gateRetries[7] 리셋, verifyRetries 리셋 — normal Phase 7 reject와 동일 처리. evalReport 파일은 건드리지 않음 |
| Gate REJECT 에스컬레이션 [S]kip (Phase 2 or 4) | N+1 | N: completed | in_progress | 강제 통과 |
| Gate REJECT 에스컬레이션 [S]kip (Phase 7) | 8 | 7: completed | **completed** | 강제 통과, run 완료 |
| Gate REJECT 에스컬레이션 [Q]uit | N | N: in_progress | paused | pauseReason = "gate-escalation" |
| Gate execution error [R]etry | N | N: in_progress (error → in_progress) | in_progress | gateRetries 증가 없음 |
| Gate execution error [S]kip (Phase 2 or 4) | N+1 | N: completed | in_progress | Gate REJECT 에스컬레이션 [S]kip과 동일 처리 |
| Gate execution error [S]kip (Phase 7) | 8 | 7: completed | **completed** | Gate REJECT 에스컬레이션 [S]kip (Phase 7)과 동일 처리 |
| Gate execution error [Q]uit | N | N: error | paused | pauseReason = "gate-error" |
| Verify PASS | 7 | 6: completed | in_progress | verifyRetries 리셋 (0) |
| Verify FAIL (retries < 3) | 5 | 6: failed, 5: in_progress | in_progress | feedback 저장, verifyRetries++ |
| Verify FAIL 에스컬레이션 [C]ontinue | 5 | 6: failed, 5: in_progress | in_progress | verifyRetries 리셋 (0) |
| Verify FAIL 에스컬레이션 [S]kip | 7 | 6: completed | in_progress | 강제 통과, verifyRetries 리셋. **skip 테이블의 Phase 6 skip 동작과 동일**: synthetic eval report 생성 + normalize_artifact_commit (evalCommit/verifiedAtHead 갱신) |
| Verify FAIL 에스컬레이션 [Q]uit | 6 | 6: failed | paused | pauseReason = "verify-escalation" |
| Verify ERROR [R]etry | 6 | 6: in_progress (error → in_progress) | in_progress | verifyRetries 증가 없음 |
| Verify ERROR [Q]uit | 6 | 6: error | paused | pauseReason = "verify-error" |

**Lock lifecycle:**
- `harness run/resume` 시작 → `repo.lock` + `run.lock` 생성 (O_EXCL 원자적 획득)
- 정상 종료 (completed, paused, error 포함 모든 CLI exit) → lock 삭제
- 비정상 종료 (kill, crash) → lock 잔존 (stale lock으로 다음 resume 시 처리)

**사용자 인터럽트 처리 (SIGINT/SIGTERM)**: CLI는 시작 시 SIGINT/SIGTERM 핸들러를 등록하고, 인터럽트 수신 시 아래 순서로 처리한다:
1. active child process group에 SIGTERM 전송(`process.kill(-childPid, 'SIGTERM')`) → 최대 5초 대기 → 여전히 alive이면 SIGKILL(`process.kill(-childPid, 'SIGKILL')`)
2. child 종료 확인 후 `childPid`/`childPhase`/`childStartedAt` = null로 lock 갱신
3. `pausedAtHead = git rev-parse HEAD` 저장
4. interactive phase (1,3,5) 중 인터럽트: phase status = "failed", run.status = "in_progress" (resume 가능)
5. automated phase (2,4,6,7) 중 인터럽트: phase status = "error", run.status = "in_progress", pendingAction = 해당 gate/verify rerun type
6. state.json atomic write (pendingAction 포함)
7. repo.lock + run.lock 삭제
8. exit

이 순서로 처리하면 resume 시 pendingAction 기반으로 중단 지점부터 재개 가능하다.
- **`resume` 시 항상 새 lock을 획득한다.** 기존 lock이 없으면 충돌 없이 바로 획득. 기존 lock이 있으면 PID 확인 후 stale 여부 판단.
  - 기존 `repo.lock` 없음 → O_EXCL로 새 `repo.lock` + `run.lock` 생성 후 state.json의 currentPhase/status 기준으로 복구
  - 기존 `repo.lock` 있음 → PID 확인 후 stale이면 삭제하고 새 lock 획득, stale이 아니면 에러 출력 후 중단
- **Orphaned `run.lock`**: `repo.lock`이 없는데 `.harness/<runId>/run.lock`만 존재하는 경우 → `run.lock`을 삭제 후 state.json 기준으로 복구. crash로 인해 `repo.lock`만 먼저 삭제된 케이스로 간주.

---

## Decision Log

### 목적
brainstorm에서 결정된 "왜"를 구조화해서 저장. Phase 3, 5 시작 시 초기 프롬프트에 주입.

### 위치
`.harness/<runId>/decisions.md`

### 포맷
```markdown
# Decision Log
Generated: YYYY-MM-DD | Spec: docs/specs/<runId>-design.md

## 핵심 결정사항
- **[ADR-N]** 결정 내용
  - 이유: ...
  - 기각된 대안: ... (이유: ...)

## 제약 조건
- ...

## 해소된 모호성
- Q: ... → A: ...

## 구현 시 주의사항
- ...
```

### 작성 시점
Phase 1 (brainstorm) 완료 직전, Claude가 spec 작성 후 이 파일을 함께 생성한다.

---

## Context 주입 전략

### Phase 1 (Brainstorm) 초기 프롬프트
```
다음 파일에서 태스크 설명을 읽고 요구사항을 분석한 뒤 설계 스펙과 Decision Log를 작성하라:
- Task: {task_path}
{if feedback_path}
- 이전 리뷰 피드백 (반드시 반영): {feedback_path}
{/if}

spec을 {spec_path}에, decision log를 {decisions_path}에 저장하고,
`.harness/{runId}/phase-1.done` 파일을 생성하되 내용으로 `{phaseAttemptId}` 한 줄만 기록한 뒤 세션을 종료하라.

spec 문서는 "docs/specs/{runId}-design.md" 경로에 작성하고, 상단에 "## Context & Decisions" 섹션을 포함하라.
decisions.md는 ".harness/{runId}/decisions.md" 경로에 작성하라.
```

### Phase 3 (Plan 작성) 초기 프롬프트
```
다음 파일을 읽고 컨텍스트를 파악한 뒤 구현 계획을 작성하라:
- Spec: {spec_path}
- Decision Log: {decisions_path}
{if feedback_path}
- 이전 리뷰 피드백 (반드시 반영): {feedback_path}  ← 파일 경로만 전달, Claude가 읽음
{/if}

plan을 {plan_path}에 저장하고,
eval checklist를 {checklist_path}에 아래 JSON 스키마로 저장하라:
```json
{
  "checks": [
    { "name": "<검증 항목 이름>", "command": "<실행 커맨드>" }
  ]
}
```
`checks` 배열은 비어있지 않아야 하며 각 항목에 `name`(string)과 `command`(string)이 필수다.
`.harness/{runId}/phase-3.done` 파일을 생성하되 내용으로 `{phaseAttemptId}` 한 줄만 기록한 뒤 세션을 종료하라.
```

### Phase 5 (Implementation) 초기 프롬프트
```
다음 파일을 읽고 컨텍스트를 파악한 뒤 구현을 진행하라:
- Spec: {spec_path}
- Plan: {plan_path}
- Decision Log: {decisions_path}
{for each path in feedback_paths}
- 이전 피드백 (반드시 반영): {path}  ← 파일 경로만 전달, Claude가 읽음
{/for}

구현 완료 후 `.harness/{runId}/phase-5.done` 파일을 생성하되 내용으로 `{phaseAttemptId}` 한 줄만 기록한 뒤 세션을 종료하라.
```

**Phase 5 feedback 수집 규칙**: `gate-7-feedback.md`와 `verify-feedback.md`가 모두 존재하면 둘 다 `feedback_paths[]`에 포함한다. `verify-feedback.md` 삭제 시점:
- Phase 6 **pass** 시: 정상 통과 — 이후 재오픈 없음
- Phase 6 **skip** 시 (direct skip 및 Verify FAIL 에스컬레이션 [S]kip 모두): skip 이후 Phase 7 reject → Phase 5 재오픈 시 이전 실패 feedback이 재주입되는 것을 방지. synthetic report 생성 전에 삭제한다.
gate-7-feedback.md는 새 gate 실행 시 덮어쓴다.

**feedback 주입 원칙**: 모든 phase에서 feedback은 파일 경로만 프롬프트에 포함한다 (inline 금지). CLI는 feedback 내용을 프롬프트 문자열에 embed하지 않으며, Claude가 해당 파일을 직접 읽는다.

### Gate phase 프롬프트 계약 (Phase 2, 4, 7)

Gate 프롬프트는 임시 파일에 기록한 뒤 stdin으로 Codex companion에 전달한다. CLI가 직접 조립한다.

**공통 역할 지시 (모든 gate phase)**:
```
You are an independent technical reviewer. Review the provided documents and return a structured verdict.
Output format — must include exactly these sections in order:

## Verdict
APPROVE or REJECT

## Comments
- **[P0|P1|P2|P3]** — Location: ...
  Issue: ...
  Suggestion: ...
  Evidence: ...

## Summary
One to two sentences.

Rules: APPROVE only if zero P0/P1 findings. Every comment must cite a specific location.
```

**Phase별 입력 파일 조립**:

| Gate | CLI가 조립하는 입력 |
|------|------------------|
| Phase 2 (spec gate) | spec doc 전문 |
| Phase 4 (plan gate) | spec doc 전문 + plan doc 전문 |
| Phase 7 (eval gate) | spec doc 전문 + plan doc 전문 + eval report 전문 + diff 출력 (아래 규칙 참조) |

**Phase 7 diff 범위 규칙**: 외부 커밋 감지 여부에 따라 diff 조립 방식이 달라진다.
- **외부 커밋 없음** (`externalCommitsDetected == false`): `git diff <baseCommit>...HEAD` 전체 사용.
- **외부 커밋 있음** (`externalCommitsDetected == true`): harness 범위와 외부 커밋을 분리한다.
  - **Primary diff** (harness 범위): `implCommit != null`이면 `git diff <baseCommit>...<implCommit>` (Phase 1-5 harness commits) + `git diff <evalCommit>^..<evalCommit>` (Phase 6 eval report commit만 독립 표시). `implCommit == null`(Phase 5 skip)이면 harness-only diff를 조립할 수 없다 — `git diff <baseCommit>...<evalCommit>`을 사용하되, 외부 커밋이 혼합될 수 있음을 명시적으로 경고한다. 프롬프트에 **`⚠️ IMPORTANT: Phase 5 was skipped and external commits were detected. The primary diff below includes BOTH harness and external changes — they cannot be separated. Focus on the eval report and spec/plan compliance rather than the diff.`** 경고를 추가한다. (ADR-5에 따라 hard-fail하지 않음. reviewer가 diff 대신 spec/plan 준수도 중심으로 리뷰하도록 유도.)
  - **External commits summary** (별도 섹션): `evalCommit`을 단일 anchor로 사용하여 `git log <evalCommit>..HEAD --oneline` 결과를 `## External Commits (not reviewed)` 블록으로 추가. `evalCommit == null`이면 `implCommit`을 fallback anchor로, `implCommit == null`이면 `baseCommit`을 fallback anchor로 사용. 내용은 commit 목록만; diff는 포함하지 않는다.
  - 이 분리로 외부 커밋이 harness 변경분을 truncation 정책으로 밀어내는 문제를 방지한다.

Phase 7 프롬프트에는 아래 메타데이터를 항상 포함한다 (외부 커밋 감지 여부와 무관):
```
{if externalCommitsDetected}
Note: External commits detected. See '## External Commits (not reviewed)' section below.
Primary diff covers harness implementation range only.
{/if}
{if implCommit != null}
Harness implementation range: {baseCommit}..{implCommit} (Phase 1–5 commits).
{else}
Phase 5 skipped; no implementation commit anchor.
{/if}
Harness eval report commit: {evalCommit} (the commit that last modified the eval report).
Verified at HEAD: {verifiedAtHead} (most recent Phase 6 run).
Focus review on changes within the harness ranges above.
```
(`implCommit`은 Phase 5 완료 시점; Phase 5 skip 시 null. `evalCommit`은 Phase 6 자동 커밋 시점; no-op commit 시 이전 commit 유지. `verifiedAtHead`는 가장 최근 Phase 6 실행 시점 HEAD. `implRetryBase`는 Phase 5 세션 내 신규 커밋 판정 전용으로 Phase 7 메타데이터에는 포함하지 않는다.)

**`externalCommitsDetected`**: **state.json에 저장한다** (boolean, 초기값 `false`). 다음 시점에서 검사하고 갱신한다:
1. `resume` 또는 `jump` 진입 시: `pausedAtHead != null`이면 `git log <pausedAtHead>..HEAD`에 커밋이 있으면 `true`로 설정 (pausedAtHead 이후 = harness 밖에서 추가된 커밋). `pausedAtHead == null`이면 `git log <baseCommit>..HEAD`에서 state의 known anchors(`specCommit`, `planCommit`, `implCommit`, `evalCommit`)에 해당하지 않는 커밋이 있으면 `true`로 설정. 이 fallback에서도 Phase 5 구현 커밋(`baseCommit..implCommit` 범위)은 자동으로 제외된다 (`implCommit`이 set되어 있으면 해당 범위의 모든 커밋은 harness 소유로 간주).
2. **Phase 7 프롬프트 조립 직전**: `git log <evalCommit or implCommit or baseCommit>..HEAD`에서 비-harness 커밋이 있으면 `true`로 설정. 이를 통해 active session 중 다른 셸에서 추가된 외부 커밋도 감지한다.
한 번 `true`가 되면 **이후 retry/재실행을 거쳐도 `false`로 되돌리지 않는다** — 외부 커밋이 한 번이라도 감지된 run에서는 Phase 7 reviewer에게 항상 경고를 전달한다. `harness run`으로 시작한 첫 세션에서는 외부 커밋이 없으므로 `false`.

모든 파일 내용은 CLI가 직접 읽어 프롬프트에 인라인으로 포함한다 (파일 경로만 전달 금지 — Codex sandbox에서 파일을 직접 읽을 수 없음).

**입력 크기 정책**: Phase 7 diff는 단일 range(`git diff <baseCommit>...HEAD`) 또는 복수 range(외부 커밋 분리 모드)로 조립될 수 있다. **모든 diff 섹션의 합산 크기**가 50KB를 초과하면 아래 방식으로 대체한다. 각 diff 섹션(primary, eval commit, external summary)에 독립적으로 적용:
- 해당 range의 `git diff --stat` (파일 목록 + 변경량 요약)
- 변경된 각 파일에 대해: 개별 파일 diff가 20KB 이하이면 전문 포함, 20KB 초과이면 `--- (truncated: {N} bytes)` 표시
- 프롬프트 상단에 `(diff partially truncated — full size: {N}KB)` 메모 추가
- 이 방식으로 특정 디렉토리에 한정하지 않고 모든 변경 파일을 커버한다

spec + plan + eval report 각각도 200KB를 초과하면 **gate execution error로 처리**한다: phase status = `"error"`, `pendingAction = {type: "rerun_gate", ...}`. 일반 gate execution error와 동일하게 `[R]etry` / `[S]kip` / `[Q]uit` 선택을 제시하고 에러 메시지 출력: "Gate input too large: {file} exceeds 200KB. Reduce file size and retry (or [S]kip to force-pass)." retry는 파일 크기를 줄인 후 동일 gate를 재실행한다.

**최종 조립 프롬프트 크기 상한**: 개별 파일 크기 체크 통과 후 모든 내용을 인라인하여 최종 프롬프트를 조립할 때, 총 크기가 500KB를 초과하면 gate execution error로 처리 (동일 처리: phase error + pendingAction = rerun_gate, `[R]etry` / `[S]kip` / `[Q]uit` UI 제시). 에러 메시지: "Assembled gate prompt too large: {N}KB. Reduce document sizes and retry (or [S]kip to force-pass)."

### Phase별 모델 설정
CLI가 claude 서브프로세스 spawn 시 `--model` 플래그로 자동 설정:

| Phase | 모델 |
|-------|------|
| 1 (brainstorm) | claude-opus-4-6 |
| 3 (plan) | claude-sonnet-4-6 |
| 5 (impl) | claude-sonnet-4-6 |

---

## CLI 커맨드

**전역 플래그** (모든 커맨드에 적용 가능):
```
  --root <dir>             # .harness/ 탐색 루트 명시 (기본: git root 또는 cwd 상위 탐색)
```

```bash
harness run "기능 설명"    # 새 run 시작 (Phase 1부터), runId 자동 생성
                           # 빈 문자열 → 에러 출력 후 중단
                           # slug 정규화 결과가 빈 값이면 "untitled" 사용
                           # .harness/current-run 포인터 갱신 — state.json 초기 기록 + lock 획득 성공 후에만 갱신.
                           #   초기화 실패 시 current-run을 이전 값으로 유지 (broken pointer 방지).
                           # preflight: git repo 확인, 의존성 확인, working tree clean 확인
  --allow-dirty            # working tree가 dirty해도 시작 검사 우회 (경고 출력).
                           # Phase 5 완료 조건(working tree clean)에는 영향 없음
  --auto                   # 자율 모드 활성화 (에스컬레이션 없음, 한도 초과 시 강제 통과)
harness resume [runId]     # runId 없으면 .harness/current-run 포인터 기준으로 재개
                           # runId 지정 시 해당 run 재개 + current-run 포인터 갱신
                           # 에러 케이스:
                           #   - runId 미지정 + .harness/current-run 없음:
                           #     "No active run. Use 'harness run' to start a new run or 'harness list' to see all runs."
                           #   - .harness/<runId>/ 디렉토리 없음:
                           #     "Run '{runId}' not found."
                           #   - state.json 없음 (run 디렉토리는 있음):
                           #     "Run '{runId}' has no state. Manual recovery required."
                           #   - state.json parse 실패:
                           #     "state.json for run '{runId}' is corrupted. Manual recovery required."
                           #   - run.status == "completed":
                           #     `.harness/current-run`을 해당 runId로 갱신한 뒤 에러 출력:
                           #     "Run '{runId}' is already completed. Use 'harness jump N' to re-run a phase."
                           #     (current-run 갱신 후 종료이므로 이후 'harness jump N'이 해당 run에 적용됨)
                           # preflight: git repo 확인 + 의존성 preflight (run과 동일)
                           # git 상태 확인 (ancestry validation):
                           #   - phases[1] 완료 + specCommit != null: HEAD가 specCommit의 descendant인지 검증
                           #   - phases[3] 완료 + planCommit != null: HEAD가 planCommit의 descendant인지 검증
                           #   - phases[5] 미완료: HEAD가 baseCommit의 descendant인지 검증
                           #   - phases[5] 완료 + implCommit != null: HEAD가 implCommit의 descendant인지 검증
                           #   - phases[5] 완료 + implCommit == null (skip): HEAD가 baseCommit의 descendant인지 검증
                           #   - phases[6] 완료 + evalCommit != null: HEAD가 evalCommit의 descendant인지 검증
                           #   - descendant 아님 → 에러 출력 후 중단 (manual recovery)
                           #   - 외부 커밋 감지: externalCommitsDetected 규칙(상태 관리 섹션)과 동일한
                           #     알고리즘 사용. 비-harness 커밋 있으면 경고 출력 + state에 true 저장 후 진행.
  --allow-dirty            # working tree dirty 시에도 진행 (경고 출력)
harness status             # 현재 phase, 아티팩트 경로, 각 phase 상태 출력
                           # 대상 run: .harness/current-run 포인터 기준
                           # current-run 없거나 해당 runId의 state.json이 없으면 에러:
                           #   "No active run. Use 'harness list' to see all runs."
harness list               # 모든 run 목록과 상태 출력 (non-git에서도 동작)
harness skip               # 현재 phase 강제 통과 (SKILL의 "내가 승인할게"에 대응)
                           # 대상 run: .harness/current-run 포인터 기준
                           # current-run 없거나 해당 runId의 state.json이 없으면 에러
                           # run.status == "in_progress"일 때만 허용.
                           #   paused 상태이면 에러: "Cannot skip: run is paused. Use 'harness resume' first."
                           #   completed 상태이면 에러: "Cannot skip: run is completed. Use 'harness jump N' to re-run a phase."
                           # 기존 pendingAction/pauseReason은 skip 전 null로 초기화 (jump와 동일)
                           # crash-safe 실행 순서: pendingAction = {type:"skip_phase", targetPhase:N} atomic write
                           #   → skip side effects (파일 삭제, synthetic report 생성 등) → state 갱신 → pendingAction null
                           # phase별 skip 정책: 아래 표 참조
harness jump <phase>       # **backward-only**: 현재 phase보다 작은 phase N으로만 이동
                           # 대상 run: .harness/current-run 포인터 기준
                           # current-run 없거나 해당 runId의 state.json이 없으면 에러
                           # forward jump는 지원하지 않음 (에러 출력)
                           # preflight: target phase의 required input 파일 존재 확인
                           # git anchor validation (jump 실행 전): resume와 동일한 ancestry check 수행
                           #   - implCommit != null && phases[5] == "completed" && N > 5:
                           #     git merge-base --is-ancestor <implCommit> HEAD 실패 시 에러 출력 후 중단:
                           #     "Committed implementation work may have been lost (HEAD has diverged from implCommit). Manual recovery required."
                           #   - implCommit == null && phases[5] == "completed" && N > 5 (Phase 5 skip 케이스):
                           #     git merge-base --is-ancestor <baseCommit> HEAD 실패 시 에러 출력 후 중단:
                           #     "HEAD has diverged from baseCommit. Harness diff (Phase 7) will be invalid. Use 'harness jump 1' to restart from base."
                           #   - evalCommit != null && phases[6] == "completed" && N > 6:
                           #     git merge-base --is-ancestor <evalCommit> HEAD 실패 시 에러 출력 후 중단:
                           #     "Eval report commit is no longer in git history (HEAD has diverged from evalCommit). Use 'harness jump 6' to re-run verification."
                           # 외부 커밋 감지 (resume와 동일): externalCommitsDetected 규칙과 동일한
                           #   알고리즘. 비-harness 커밋 있으면 경고 출력 + state에 true 저장 후 진행 (ADR-5).
                           # 아래 jump 초기화 규칙 적용
                           # 실행 순서: state 초기화 → currentPhase = N → run.status = "in_progress"
                           #   → phases[N] = "pending" → 즉시 phase N 실행 시작 (resume 불필요)
```

**자율 모드**: `harness run --auto` 또는 state의 `"autoMode": true`로 활성화. 활성화 시:
- gate 한도(3회) 초과 → 에스컬레이션 없이 해당 gate 강제 통과
- verify 한도(3회) 초과 → 에스컬레이션 없이 verify skip 처리 후 Phase 7 진행 (skip 테이블의 Phase 6 skip 동작과 동일 — synthetic eval report 생성 포함)

**에스컬레이션 이후 상태 전이 (manual 모드)**:

Gate 에스컬레이션:
```
⚠️  Gate 에스컬레이션: {gate} 3회 reject됨.
    [C]ontinue — 이전 phase 재오픈 (reject 카운터 리셋)
    [S]kip — 이 gate 강제 통과
    [Q]uit — run 중단 (resume 가능)
```

Verify 에스컬레이션:
```
⚠️  Verify 에스컬레이션: 3회 연속 실패.
    [C]ontinue — Phase 5 재오픈 (verifyRetries 리셋)
    [S]kip — verify 통과 처리 후 Phase 7 진행 (Phase 6 skip 경로와 동일: synthetic eval report 생성 + normalize_artifact_commit)
    [Q]uit — run 중단 (resume 가능)
```

Quit 선택 시 state `status: "paused"`. `harness resume`으로 재개 가능.

**`pauseReason` enum** (`run.status == "paused"` 시 설정):
| pauseReason | 설정 시점 | resume 시 동작 |
|-------------|-----------|---------------|
| `"gate-escalation"` | Gate REJECT 에스컬레이션 [Q]uit | Gate 에스컬레이션 UI 재표시 |
| `"verify-escalation"` | Verify FAIL 에스컬레이션 [Q]uit | Verify 에스컬레이션 UI 재표시 |
| `"gate-error"` | Gate execution error [Q]uit | 해당 gate 재실행 (`pendingAction.type = "rerun_gate"`) |
| `"verify-error"` | Verify ERROR [Q]uit | Verify ERROR UI 재표시 (retry/quit) |

**`pauseReason` vs `pendingAction` 역할 분리**:
- `pendingAction`: resume 시 **실행 경로를 결정하는** authoritative driver. `run.status == "paused"` 상태도 항상 `pendingAction`을 통해 복구한다.
- `pauseReason`: `pendingAction` handler 내부에서 어떤 UI를 표시할지 구분하는 metadata. resume 순서에서 `pendingAction`보다 먼저 읽히지 않는다.

따라서 `run.status == "paused"`로 전환할 때 항상 대응하는 `pendingAction`도 함께 설정한다:
| pause 전환 | pendingAction type | pauseReason |
|------------|-------------------|-------------|
| Gate escalation [Q]uit | `"show_escalation"` | `"gate-escalation"` |
| Verify escalation [Q]uit | `"show_escalation"` | `"verify-escalation"` |
| Gate error [Q]uit | `"rerun_gate"` | `"gate-error"` |
| Verify ERROR [Q]uit | `"show_verify_error"` | `"verify-error"` |

`gate-error`는 에스컬레이션이 아니라 기술적 오류이므로 resume 시 gate를 직접 재실행한다 (`pendingAction.type = "rerun_gate"`). `show_escalation`은 reject 한도 초과 에스컬레이션 전용이다.

`pendingAction`이 null이면 `pauseReason`도 null — resume 시 비정상 상태로 처리한다: 에러 출력 "Run state is inconsistent: paused run has no pendingAction. Use 'harness jump N' to re-run from a specific phase or delete .harness/<runId>/ to discard this run." 후 중단.

### Skip 정책 (phase별)

| Phase | Skip 허용 | Skip 시 동작 |
|-------|----------|-------------|
| 1 (brainstorm) | 허용 (기존 spec/decisions 파일이 있을 때) | 해당 파일을 그대로 사용, Phase 2로 진행 |
| 2 (spec gate) | 허용 | gate 통과 처리, Phase 3로 진행 |
| 3 (plan) | 허용 (기존 plan/checklist 파일이 있을 때) | 해당 파일을 그대로 사용, Phase 4로 진행 |
| 4 (plan gate) | 허용 | gate 통과 처리, Phase 5로 진행 |
| 5 (impl) | 허용 (조건부) | working tree clean 필수 (dirty이면 에러). 추가로 `git log <implRetryBase>..HEAD`에 커밋이 존재하면 skip 불가: "Cannot skip Phase 5: implementation commits already exist. Use 'harness resume' to complete or 'harness jump 5' to restart." 커밋이 없으면 `implCommit = null`로 유지하고 Phase 6 진행. |
| 6 (verify) | 허용 (working tree clean 필요) | working tree dirty이면 에러: "Phase 6 skip requires clean working tree. Commit or stash changes first." clean이면 `verify-feedback.md` 삭제 (존재하면 — stale feedback 재주입 방지) 후 CLI가 synthetic eval report 생성 후 Phase 7로 진행. synthetic report 전체 형식 (정상 완료 성공 조건 충족 필요):<br>`# Verification Report (SKIPPED)`<br>`- Date: {YYYY-MM-DD HH:MM:SS}`<br>`- Run ID: {runId}`<br>`- Related Spec: {artifacts.spec or N/A}`<br>`- Related Plan: {artifacts.plan or N/A}`<br>`## Results`<br>`\| Check \| Status \| Output \|`<br>`\|-------\|--------\|--------\|`<br>`\| (skipped) \| SKIPPED \| — \|`<br>`## Summary`<br>`VERIFY SKIPPED — no checks were run. This eval gate review is based on code diff and spec/plan review only.`<br>(경고 출력) |
| 7 (eval gate) | 허용 | gate 통과 처리, run 완료 |

### Jump 초기화 규칙

`harness jump N` (backward) 실행 시 phase N 이후의 관련 상태를 초기화한다:

| 리셋 대상 | 조건 |
|----------|------|
| `phases[M]` → `pending` (M >= N) | 항상 |
| `gateRetries[M]` → 0 (gate phase M >= N) | 항상 (target phase 자신의 retry 카운터도 초기화) |
| `verifyRetries` → 0 (N ≤ 6) | N이 verify 이전/포함이면 |
| `phase-M.done` 삭제 (M >= N) | 항상 |
| `gate-M-feedback.md` 삭제 (gate M >= N) | 항상 (target phase의 stale feedback도 삭제) |
| `gate-M-raw.txt` 삭제 (gate M >= N) | 항상 (stale sidecar 오인 방지) |
| `gate-M-result.json` 삭제 (gate M >= N) | 항상 (stale sidecar 오인 방지) |
| `gate-M-error.md` 삭제 (gate M >= N) | 항상 (stale error diagnostic 삭제) |
| `verify-result.json` 삭제 (N ≤ 6) | N이 verify 이전/포함이면 (stale result 오인 방지) |
| `verify-feedback.md` 삭제 (N ≤ 6) | N이 verify 이전/포함이면 |
| `verify-error.md` 삭제 (N ≤ 6) | N이 verify 이전/포함이면 |
| `evalReport` artifact 경로: **유지** (runId에서 결정론적으로 도출되므로 null 리셋 불필요; 실제 파일 삭제는 Phase 6 진입 전 사전 조건이 담당) | — |
| `checklist.json` 삭제 (N ≤ 3) | N이 plan phase 이전/포함이면 (Phase 3이 checklist를 생성하므로) |
| `phaseOpenedAt[M]` 리셋 (M >= N) | 항상 |
| `specCommit` → null (N ≤ 1) | N이 brainstorm 이전/포함이면 (Phase 1 재실행이므로 이전 specCommit 무효화) |
| `planCommit` → null (N ≤ 3) | N이 plan 이전/포함이면 |
| `implCommit` → null (N ≤ 5) | N이 impl 이전/포함이면 |
| `implRetryBase` 리셋 → baseCommit (N ≤ 5) | N이 impl 이전/포함이면 |
| `evalCommit` → null (N ≤ 6) | N이 verify 이전/포함이면 |
| `verifiedAtHead` → null (N ≤ 6) | N이 verify 이전/포함이면 |
| `pendingAction` → null | 항상 (stale pendingAction이 jump 의도를 덮어쓰는 것 방지) |
| `pauseReason` → null | 항상 (pendingAction 초기화와 함께) |
| `run.status` → `"in_progress"` | 항상 (paused 상태에서 jump 시 복구; completed 상태에서 backward jump 시 재개) |
| spec/plan/decisions 아티팩트 | **보존** (덮어쓰기는 해당 phase에서). 단, Phase 1/3 시작 시 output artifact 삭제는 step 5에서 수행 — jump 후 즉시 phase가 시작되므로, `jump 1` 후에는 spec/decisions가 삭제되고 `jump 3` 후에는 plan/checklist가 삭제된다. **따라서 `jump N` 후 해당 phase의 `skip`은 artifact가 이미 삭제되어 실패한다.** 기존 artifact를 보존하려면 `jump N+1`로 다음 phase에서 시작해야 한다. |

### 자동 진행 원칙
Automated phase (gate, verify)는 완료 즉시 자동으로 다음 phase를 시작한다. 개발자 확인을 기다리지 않는다. Interactive phase는 sentinel + process exit 이후 다음 phase가 자동 시작된다.

### Phase 전환 터미널 출력
```
✓ Phase 2 완료 (Spec Gate — APPROVED)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▶ Phase 3 시작: Plan 작성
  컨텍스트: spec ✓  decisions ✓
  모델: claude-sonnet-4-6
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 상태 관리

### `.harness/<runId>/state.json`
```json
{
  "runId": "2026-04-12-graphql-api",
  "currentPhase": 3,
  "status": "in_progress",
  "autoMode": false,
  "task": "GraphQL API 추가",
  "baseCommit": "a3f9c21",
  "implRetryBase": "a3f9c21",
  "codexPath": "/Users/daniel/.claude/plugins/cache/openai-codex/codex/1.0.3/scripts/codex-companion.mjs",
  "artifacts": {
    "spec": "docs/specs/2026-04-12-graphql-api-design.md",
    "plan": "docs/plans/2026-04-12-graphql-api.md",
    "decisionLog": ".harness/2026-04-12-graphql-api/decisions.md",
    "checklist": ".harness/2026-04-12-graphql-api/checklist.json",
    "evalReport": "docs/process/evals/2026-04-12-graphql-api-eval.md"
  },
  "phases": {
    "1": "completed",
    "2": "completed",
    "3": "in_progress",
    "4": "pending",
    "5": "pending",
    "6": "pending",
    "7": "pending"
  },
  "gateRetries": {
    "2": 0,
    "4": 0,
    "7": 0
  },
  "verifyRetries": 0,
  "externalCommitsDetected": false,
  "pauseReason": null,
  "specCommit": null,
  "planCommit": null,
  "implCommit": null,
  "evalCommit": null,
  "verifiedAtHead": null,
  "pausedAtHead": null,
  "pendingAction": null,
  "phaseOpenedAt": {
    "1": null,
    "3": null,
    "5": null
  },
  "phaseAttemptId": {
    "1": null,
    "3": null,
    "5": null
  }
}
```

**Git 저장소 preflight**: `harness run` 및 `harness resume` 시작 시 아래 두 가지를 순서대로 확인한다:
1. `git rev-parse --show-toplevel` 성공 여부 — 실패 시: "harness requires a git repository."
2. `git rev-parse HEAD` 성공 여부 — 실패 시: "harness requires at least one commit. Run 'git commit' to create an initial commit first."
`harness status`와 `harness list`는 non-git에서도 동작한다.

**`.harness/` 루트 탐색 규칙** (status/list 등 non-git 명령):
1. `cwd`에서 시작하여 부모 디렉토리 방향으로 `.harness/` 디렉토리가 있는 가장 가까운 경로를 찾는다.
2. 파일시스템 루트(`/`)까지 찾지 못하면 에러: "No `.harness/` directory found. Run 'harness run' first."
3. git repo가 있는 경우에는 `git rev-parse --show-toplevel` 결과를 우선 사용한다 (탐색 일관성).
4. `--root <dir>` 플래그로 명시적 루트 지정 가능 (테스트 및 비표준 레이아웃 대응).

**의존성 preflight** 실행 시점: `harness run`, `harness resume`, `harness jump`, `harness skip` 시작 시. 단, `run`은 전체 preflight, `resume/jump/skip`은 **다음에 실행될 phase에 필요한 최소 preflight**만 수행한다 (단계별 독립 실행 원칙 보장 + 불필요한 의존성 오류로 유효한 복구가 막히는 것 방지):

`jump N`과 `skip`은 상태 변경(phase 초기화, sentinel 삭제 등) **이전에** 다음 실행 phase를 확정하고, 그 phase 유형에 맞는 아래 preflight를 수행한다. preflight 실패 시 상태 변경 없이 중단한다.

| 다음 실행 phase 유형 | 필요한 preflight 항목 |
|---------------------|----------------------|
| interactive phase (1,3,5) | 1(git), 2(HEAD), 3(node), 4(claude), 5(claude @file), 9(platform), 10(TTY) |
| gate phase (2,4,7) | 1(git), 2(HEAD), 3(node), 8(codexPath), 9(platform), 10(TTY) |
| verify phase (6) | 1(git), 2(HEAD), 3(node), 6(harness-verify.sh), 7(jq), 9(platform), 10(TTY) |
| terminal completion (Phase 7 skip → run 완료) | 1(git), 9(platform) — subprocess spawn 없이 state 갱신만 |
| pendingAction UI only (show_escalation, show_verify_error) | 9(platform), 10(TTY) — UI 메뉴 표시 전 최소 체크. **사용자 선택 후 2차 preflight**: 선택한 action이 subprocess spawn을 필요로 하면 해당 phase 유형의 preflight를 실행한다. 예: [C]ontinue→interactive phase preflight, [R]etry→gate/verify preflight, [S]kip→skip side effects에 필요한 git preflight만. 2차 preflight 실패 시 에러 출력 후 UI 메뉴를 다시 표시한다 (다른 선택 가능). |

`harness run`은 첫 실행이므로 어떤 phase가 올지 미확정 → 전체 preflight(1–10) 수행.

아래 항목 중 하나라도 실패하면 **unrecoverable configuration error**로 즉시 중단한다. phase `failed`로 처리하지 않으며, retry 루프에 진입하지 않는다.

```
1. git binary + repo:   git rev-parse --show-toplevel  (기존 git preflight와 동일)
2. git HEAD:            git rev-parse HEAD  (초기 커밋 없는 빈 repo 방지)
3. node binary:         node --version
4. claude binary:       which claude (또는 claude --version)
5. claude @file 지원:   임시 파일(`/tmp/harness-preflight-XXXX.md`)에 빈 내용 기록 후 `claude --model claude-sonnet-4-6 @<tmpfile> --print '' 2>&1`로 --model + @file 조합 검증. **이 검사는 약한 신호(best-effort)다** — preflight는 `--print` 모드, 실제 runtime은 interactive(`stdio: 'inherit'`) 모드이므로 완전한 동등 테스트가 아니다. 그러나 `@file` argument 파싱은 mode와 무관한 CLI 공통 기능이므로, `--print`에서 통과하면 interactive에서도 통과하는 것으로 간주한다. 성공(exit 0) 시 지원 확인. 임시 파일 삭제. **Runtime 실패 경로**: 실제 Phase 1/3/5 spawn 후 claude가 `@file` 구문을 인식하지 못하면 초기 프롬프트 없이 세션이 시작되고 sentinel이 생성되지 않아 phase가 `failed`로 처리된다. 이 경우 사용자는 Claude Code CLI를 업그레이드해야 한다고 안내한다.
6. harness-verify.sh:   ~/.claude/scripts/harness-verify.sh 파일 존재 및 실행 권한
7. jq binary:           jq --version  (harness-verify.sh가 checklist.json 파싱에 필수 사용)
8. codexPath:           glob 탐색 (기존 정의와 동일)
9. **플랫폼 체크**:      `process.platform === 'win32'`이면 즉시 에러:
                        "harness requires macOS or Linux. Windows is not supported in v1."
                        harness는 POSIX process group (음수 PID signal), `/proc/<pid>/stat` 또는 `ps -o etimes=` 기반 start time 조회에 의존하므로 non-POSIX 환경을 지원하지 않는다. 이 체크는 모든 명령(`run/resume/jump/skip/status/list`)에 적용한다.
10. TTY check:          `process.stdin.isTTY && process.stdout.isTTY`. 비-TTY이면 에러:
                        "harness requires an interactive terminal (TTY). Run in a terminal."
                        interactive phase (1, 3, 5)와 에스컬레이션 UI([R]/[Q]/[C]/[S])가 TTY를 필요로 하므로 `run/resume/jump/skip`에만 적용한다.
                        `status`와 `list`는 read-only 조회 명령이므로 TTY 검사를 수행하지 않는다 (비-TTY 환경에서도 사용 가능).
```

에러 메시지 예: `"Dependency check failed: 'claude' not found in PATH. Please install Claude Code CLI."`

**아티팩트 디렉토리 준비 및 `.gitignore` 보장**: `harness run` 시작 시 (의존성 preflight 통과 후) CLI가 아래를 수행한다. Claude 세션이나 외부 스크립트에 이 책임을 넘기지 않는다.
1. 아래 디렉토리를 `mkdir -p`로 생성:
   ```
   docs/specs/
   docs/plans/
   docs/process/evals/
   .harness/<runId>/
   ```
2. `.harness/` gitignore 보장: `.gitignore`를 수정하기 전에 아래 사전 검사를 먼저 수행한다. 사전 검사를 통과한 경우에만 파일을 수정하고 커밋한다. `.harness/` (또는 `.harness`) 항목이 이미 존재하면 수정/커밋 없이 이 단계 전체를 건너뛴다.
   a. **사전 상태 확인 (수정 전)**: `git status --porcelain .gitignore`로 `.gitignore`에 기존 staged 또는 unstaged 변경이 있는지 먼저 확인. 출력이 비어있지 않으면 에러 출력 후 중단: "Cannot auto-commit .gitignore: file has uncommitted changes. Commit or stash .gitignore changes first." — 수정 전 검사이므로 harness의 변경이 아닌 사용자 기존 변경만 차단한다.
   b. **다른 staged 변경 사전 확인**: `git diff --cached --name-only`로 staged된 파일 확인 — `.gitignore` 이외의 staged 변경이 있으면 에러 출력 후 중단: "Cannot commit .gitignore: other staged changes exist. Unstage them first."
   c. **사전 검사 통과 후**: 프로젝트 루트의 `.gitignore`를 읽어 `.harness/` 항목이 없으면 줄 추가. `.gitignore`가 없으면 `.harness/` 한 줄로 새로 생성. 그 후 `git add .gitignore && git commit -m "harness: add .harness/ to .gitignore"` 실행.
   d. **commit 실패 시**: 에러 출력 후 중단. "Failed to commit .gitignore. Fix git state and retry 'harness run'." — run state가 아직 생성되지 않은 시점이므로 resume이 아닌 재실행으로 복구한다.
   이 동작은 `harness run` 때만 수행하며 Phase 1 시작 전에 완료되므로 이후 normalize_artifact_commit의 clean-tree 보장에 영향을 주지 않는다.
   이 동작은 `harness run` 때만 수행하며 `harness resume`은 이미 보장된 것으로 간주한다.

**`baseCommit`**: `harness run` 시 `.gitignore` 자동 커밋 및 아티팩트 디렉토리 준비 **완료 후**, Phase 1 subprocess spawn **전에** `git rev-parse HEAD`를 캡처한다. `.gitignore` 커밋이 발생한 경우 그 커밋 이후의 HEAD가 `baseCommit`이 되므로, Phase 7 `git diff <baseCommit>...HEAD`는 harness 작업 커밋만 포함하고 `.gitignore` 설정 커밋은 제외된다. Phase 7의 `git diff <baseCommit>...HEAD`에 사용. 이 기준으로 spec, plan, impl, eval report 커밋 전체를 포함하는 완전한 diff를 생성한다. 외부 커밋이 감지된 경우 Phase 7 프롬프트 메타데이터(`Harness implementation range: {baseCommit}..{implCommit}`)에도 사용.

**`specCommit`**: Phase 1 `normalize_artifact_commit` 성공 후 (새 커밋 여부 무관) 항상 `specCommit = git rev-parse HEAD`로 갱신. Phase 1 skip 시에도 동일. `resume` 시 `phases[1] == "completed"`이고 `specCommit != null`이면 `HEAD`가 `specCommit`의 descendant인지 검증한다 (`git merge-base --is-ancestor <specCommit> HEAD`). 실패 시 → 에러 출력 후 중단: "Spec commit is no longer in git history (HEAD has diverged from specCommit). Use 'harness jump 1' to re-run brainstorming."

**`planCommit`**: Phase 3 `normalize_artifact_commit` 성공 후 (새 커밋 여부 무관) 항상 `planCommit = git rev-parse HEAD`로 갱신. Phase 3 skip 시에도 동일. `resume` 시 `phases[3] == "completed"`이고 `planCommit != null`이면 `HEAD`가 `planCommit`의 descendant인지 검증한다. 실패 시 → 에러 출력 후 중단: "Plan commit is no longer in git history. Use 'harness jump 3' to re-run planning."

**`implCommit`**: Phase 5 완료 시 `git rev-parse HEAD`를 state에 저장. Phase 7 reject 후 Phase 5 재오픈 시 갱신. `resume` 시 Phase 5 이후(`phases[5] == "completed"`)이고 `implCommit != null`이면 `HEAD`가 `implCommit`의 descendant인지 검증한다. 아닌 경우(외부 reset/rebase로 구현 커밋이 사라진 것) → 에러 출력 후 중단: "Committed implementation work may have been lost (HEAD has diverged from implCommit). Manual recovery required."

**`verifiedAtHead`**: Phase 6 PASS 시 (normalize_artifact_commit 완료 후) `git rev-parse HEAD`를 저장한다. eval report 내용이 이전 Phase 6 실행과 동일하여 no-op commit이 발생해도 갱신한다. **Phase 6 skip 시에도 동일하게 갱신한다** (direct `harness skip` 및 Verify FAIL 에스컬레이션 [S]kip 모두 포함) — normalize_artifact_commit 완료 후 HEAD를 저장. Phase 7 프롬프트의 reviewer 메타데이터에 사용: "Verified at commit: {verifiedAtHead}". `evalCommit`은 eval report를 git에 commit한 시점 (no-op이면 이전 commit 유지); `verifiedAtHead`는 가장 최근 verify/skip 실행 시점 HEAD — 두 필드 모두 Phase 7 메타데이터에 제공한다.

**`evalCommit` ancestry 검증**: `phases[6] == "completed"`이고 `evalCommit != null`이면, `resume` 시 `HEAD`가 `evalCommit`의 descendant인지 검증한다. `git merge-base --is-ancestor <evalCommit> HEAD` 실패 시 → 에러 출력 후 중단: "Eval report commit is no longer in git history (HEAD has diverged from evalCommit). Use 'harness jump 6' to re-run verification." `phases[5]`에 대한 `implCommit` 검증은 별도로 그대로 유지한다.

**`evalCommit`**: Phase 6 `normalize_artifact_commit` 후 갱신 규칙:
- **새 커밋 생성** (HEAD가 변경됨): `evalCommit = git rev-parse HEAD` (새 커밋 SHA).
- **no-op** (이미 committed, HEAD 변경 없음): 기존 `evalCommit` 값 유지. 기존 `evalCommit`이 null이면 (crash 복구 — 커밋은 이미 생겼는데 state에 미기록) 현재 HEAD에서 eval report 파일을 마지막으로 수정한 커밋을 `git log -1 --format='%H' -- <evalReportPath>`로 찾아 저장한다.
Phase 7 프롬프트에서 `git diff <evalCommit>^..<evalCommit>`으로 eval report 변경만 표시하므로, `evalCommit`은 반드시 해당 파일을 수정한 커밋이어야 한다. Phase 6 skip 시에도 synthetic report auto-commit 후 동일하게 저장.

**`pausedAtHead`**: resume 가능한 상태를 남기고 종료하는 모든 intentional exit 시마다 `git rev-parse HEAD`를 `pausedAtHead`로 저장한다. 대상 exit: completed, paused (escalation quit, gate/verify error [Q]uit 포함 — 이 경우 `run.status = "paused"` + `pendingAction`으로 resume 가능), 사용자 인터럽트. Lock lifecycle의 "error 포함 모든 CLI exit"와 일치한다. `resume` 시 `git log <pausedAtHead>..HEAD` 결과가 비어있지 않으면 외부 커밋이 존재한다는 의미이므로 경고를 출력한다. `pausedAtHead = null` (CLI crash 등으로 미기록)이면 `baseCommit`을 fallback anchor로 사용한다 — `git log <baseCommit>..HEAD`에는 harness auto-commit도 포함되므로 false positive 경고가 발생할 수 있으나, Phase 7 프롬프트의 harness range 메타데이터로 reviewer가 구분할 수 있다. resume 완료 후(새 subprocess 종료 또는 에스컬레이션 처리 후) 다시 갱신한다.

**Phase 5 skip 시 `implCommit` 처리**: `harness skip`으로 Phase 5를 건너뛰면 `implCommit = null`로 유지한다 (커밋 없음 표시). `resume` 시 `phases[5] == "completed"`이더라도 `implCommit == null`이면 implCommit descendant 검증을 건너뛰는 대신, `baseCommit` ancestry 검증을 수행한다: `git merge-base --is-ancestor <baseCommit> HEAD` 실패 시 → 에러 출력 후 중단: "HEAD has diverged from baseCommit. Harness diff (Phase 7) will be invalid. Use 'harness jump 1' to restart from base." 이는 skip 이후에도 Phase 7 diff 유효성을 보장하기 위한 최소 보호다. 동일 규칙이 `harness jump` git anchor validation에도 적용된다: `phases[5] == "completed" && implCommit == null && N > 5`이면 implCommit 대신 baseCommit ancestry를 검증한다.

**`pendingAction`**: CLI가 crash 복구 시 재개해야 할 액션을 기록. resume 시 (childPid liveness 검사 통과 후) `pendingAction`이 non-null이면 해당 액션을 우선 실행하고 null로 초기화.

**`pendingAction` 스키마** (문자열이 아닌 구조체):
```json
{
  "type": "reopen_phase" | "rerun_gate" | "rerun_verify" | "show_escalation" | "show_verify_error" | "skip_phase",
  "targetPhase": 5,
  "sourcePhase": 7,
  "feedbackPaths": [".harness/<runId>/gate-7-feedback.md"]
}
```
- `targetPhase`: 재오픈/재실행할 phase 번호
- `sourcePhase`: 트리거가 된 gate/verify phase 번호 (type에 따라 null 가능)
- `feedbackPaths`: 재오픈 시 주입할 feedback 파일 경로 배열 (없으면 빈 배열)

복합 전이의 pendingAction 기록 순서 (authoritative):

**원칙: 모든 이벤트에서 pendingAction을 state 갱신보다 먼저 기록한다.** state.json을 갱신하기 전에 `pendingAction` 필드를 포함한 새 state를 tmp→rename으로 기록. crash 후 resume 시 pendingAction이 있으면 state 재해석 없이 해당 액션만 실행하여 idempotency 보장.

| 전이 이벤트 | pendingAction 설정 시점 | type | 완료 후 |
|------------|------------------------|------|---------|
| Gate REJECT (retry) | feedback 파일 저장 후, state 갱신(phase 상태 변경) 전 | `"reopen_phase"` | state 갱신 + spawn 완료 후 null |
| Verify FAIL (retry) | ① feedback 파일(`verify-feedback.md`) 저장 → ② pendingAction 포함 state atomic write (`{type:"reopen_phase",...}` + phase state 갱신 함께) → ③ eval report 원본 삭제(`docs/process/evals/...`) → ④ spawn 시작. **① 후 ② 전 crash**: pendingAction 없음, `verify-feedback.md` **있음** (step ①에서 생성됨). resume의 Verify FAIL 처리 시 `verify-feedback.md` 이미 존재 확인 → feedback 복사 skip, verifyRetries++ 후 Verify FAIL 핸들러 진입. **② 후 ③ 전 crash**: pendingAction(`reopen_phase`) 있음 → eval report가 아직 존재 → replay 시 먼저 eval report 삭제 후 spawn. **③ 후 ④ 전 crash**: pendingAction 있음, eval report 없음 → replay 시 바로 spawn (eval report 삭제 idempotent). | `"reopen_phase"` | state 갱신 + spawn 완료 후 null |
| Gate execution error | pendingAction을 포함하여 state 한 번에 갱신 (error 상태와 함께) | `"rerun_gate"` | gate 재실행 완료 후 null |
| Verify ERROR (retry) | pendingAction을 포함하여 state 한 번에 갱신 (error 상태와 함께) | `"rerun_verify"` | verify 재실행 완료 후 null |
| Escalation Quit | pendingAction을 포함하여 state 한 번에 갱신 (paused 상태와 함께) | `"show_escalation"` | 에스컬레이션 UI 표시 + 선택 후 null |
| Verify ERROR Quit | pendingAction을 포함하여 state 한 번에 갱신 (paused 상태와 함께) | `"show_verify_error"` | error UI 표시 + 선택 후 null |
| skip 진입 (어느 경로든: `harness skip` CLI, Gate REJECT/error `[S]kip`, Verify escalation `[S]kip`, auto-mode 강제 통과) | **모든 skip 진입점은 동일한 crash-safe 순서를 따른다**: 다른 side effect(파일 삭제, synthetic report 생성, normalize_artifact_commit) 전에 먼저 `pendingAction = {type: "skip_phase", targetPhase: N}` atomic write. 이후 skip side effects → state 갱신(phases[N]=completed, currentPhase=N+1 등). 완료 후 pendingAction null. | `"skip_phase"` | phase 완료 처리 후 null |

**Gate REJECT/Verify FAIL의 "state 갱신 전" 의미**: feedback 파일 저장 → state.tmp에 `{pendingAction: {type: "reopen_phase", ...}, phases: {...}}`를 함께 기록 → rename → spawn 시작. crash 복구 시 pendingAction만 보고 즉시 spawn할 수 있음. **Gate execution error/Verify ERROR의 경우**: error 상태와 pendingAction을 하나의 atomic write로 같이 기록 — "pendingAction 먼저" 원칙을 단일 atomic write로 만족.

**pendingAction replay 멱등성 보장 규칙**: resume 시 pendingAction을 실행하기 전에 현재 실제 상태를 먼저 확인하여 중복 실행을 방지한다. 각 type별 확인:

| type | replay 전 확인 | 이미 완료된 경우 처리 |
|------|--------------|-------------------|
| `reopen_phase` | (1) sentinel freshness: `phase-N.done` 존재 + content에 `phaseAttemptId` 일치; (2) `feedbackPaths[]` 존재 + 비어있지 않음; (3) Verify FAIL에서 온 경우: eval report 잔존하면 삭제 (idempotent) | **fresh sentinel이면**: 일반 resume의 `in_progress + sentinel 있음` 분기와 동일한 completion pipeline 수행 — 아티팩트 검증 → Phase 1/3이면 `normalize_artifact_commit` + `specCommit/planCommit` 갱신 → `pendingAction = null` → 다음 phase 전이. **stale/없으면**: 기존 sentinel 삭제 → spawn 시작. feedbackPaths 누락 → 에러 중단. |
| `rerun_gate` | `phases[targetPhase] == "completed"` | 이미 완료 → pendingAction null 초기화 후 다음 phase 진행 |
| `rerun_verify` | `phases[6] == "completed"` | 이미 완료 → pendingAction null 초기화 후 Phase 7 진행 |
| `show_escalation` | 항상 (UI 표시는 부작용 없음) | — |
| `show_verify_error` | 항상 (UI 표시는 부작용 없음) | — |
| `skip_phase` | `phases[targetPhase] == "completed"` 확인. **완료 → pendingAction null 후 다음 phase 진행.** **미완료 → phase별 skip handler를 처음부터 idempotent하게 재실행한다.** Phase 6 skip의 경우: (1) synthetic eval report 존재 여부 확인 — 없으면 생성; (2) `normalize_artifact_commit` — 이미 commit됨이면 no-op; (3) `evalCommit` 설정 — 이미 설정됨이면 skip; (4) state 완료 처리. 각 step이 idempotent이므로 어느 지점에서 재시작해도 안전. | (위 참조) |

참고: 단계 0의 `childPid` liveness 검사 및 단계 1의 artifact 존재 확인이 먼저 통과된 이후에만 pendingAction이 실행되므로 live subprocess와의 충돌 및 누락 artifact에 의한 재생 실패는 이미 방지됨.

**Working tree 조건**:
- `harness run` 시 working tree 검사는 **두 단계**로 수행한다 (preflight 통과 직후, `.gitignore` 처리 전):
  1. **staged 변경 검사** (`git diff --cached --quiet`): 결과가 비어있지 않으면 **`--allow-dirty` 여부와 무관하게** 즉시 에러: "Cannot start harness run: staged changes exist. Commit or unstage them first (`git restore --staged .`)." staged 변경은 `normalize_artifact_commit`이 harness artifact 외의 변경을 commit에 포함할 위험이 있으므로 항상 차단한다.
  2. **unstaged/untracked 변경 검사** (`git status --porcelain`): 비어있지 않으면 에러로 중단. `--allow-dirty` 플래그로 이 검사만 우회 가능 (경고 출력).
- `harness resume` 시 working tree 검사: **기본값은 검사 없음** — resume은 진행 중인 run을 재개하는 것이므로 run 시작처럼 clean 상태를 강제하지 않는다. `--allow-dirty` 플래그는 resume에서도 수락하되 noOp (기본이 이미 검사 없음). 단, descendant 검증과 외부 커밋 경고(ADR-5)는 이 검사와 별개로 항상 수행한다. Phase 6 진입 시에만 working tree clean이 강제된다 (기존 Phase 6 사전 조건 그대로).
- **`--allow-dirty` 적용 범위**: `harness run` 시작 시 unstaged/untracked 검사(2단계)만 우회한다. 다음 조건에는 영향을 주지 않는다:
  - staged 변경 검사(1단계): `--allow-dirty`로도 우회 불가 — 항상 차단.
  - Phase 5 완료 조건 (`working tree clean`): run 시작 전 dirty 변경을 commit하거나 stash해야 Phase 5를 완료할 수 있다.
  - Phase 6 진입 조건 (`working tree clean`): 항상 강제 적용.
  - `normalize_artifact_commit` (Phase 1, 3, 6): staged 변경이 존재하면 에러로 중단 (동일 원칙).
  `--allow-dirty`는 "harness와 무관한 **unstaged/untracked** 변경이 있지만 일단 시작은 하고 싶다"는 경우에만 사용한다. staged 변경이 있으면 `--allow-dirty`로도 시작할 수 없다.

**`codexPath` 정책**: `harness run` 시 glob으로 탐색하여 state에 저장. resume 시 저장된 경로를 먼저 사용. 경로가 없거나 파일이 존재하지 않으면 재탐색 후 갱신. 재탐색도 실패하면 에러 출력 후 중단.

**Phase 5 완료 계약 (authoritative)**:
- 완료 조건은 입출력 계약 표를 따른다: sentinel + process exit + `git log <implRetryBase>..HEAD` 1개 이상 커밋 + working tree clean. 커밋이 없거나 working tree가 dirty하면 `failed` 처리. "경고만" 경로는 없다.
- working tree clean 요건은 Phase 6/7 간 검증 대상 일치를 보장한다: Phase 6은 committed 상태를 검증하고, Phase 7은 `git diff <baseCommit>...HEAD`로 committed 변경만 심사한다. uncommitted 변경이 있으면 두 단계가 서로 다른 상태를 본다.
- **`implRetryBase`**: Phase 5가 시작될 때마다 `git rev-parse HEAD`를 state에 저장. 재오픈 시에도 갱신. 이 기준으로 "이번 세션에서 새 커밋이 생겼는지" 판정.
- 단, `harness skip`으로 Phase 5를 건너뛰면 커밋 요건 없이 Phase 6으로 진행. 단, skip 시에도 working tree clean 여부는 확인한다 — Phase 6이 즉시 clean tree를 요구하기 때문이며, skip 테이블에 명시됨.

Phase 5 초기 프롬프트에 포함:
> "각 태스크 완료 시 반드시 변경사항을 git commit하라. commit 없이 세션을 종료하면 eval gate에서 변경분을 볼 수 없어 run이 실패한다."

### `.harness/` 디렉토리 구조
```
.harness/
├── repo.lock               # repo-global lock {pid, runId, startedAt}
├── current-run             # 현재 활성 runId 텍스트 (harness resume 기본값)
└── <runId>/               # run별 격리 (예: 2026-04-12-graphql-api)
    ├── state.json
    ├── run.lock            # run-level lock (repo.lock과 동시 생성/삭제)
    ├── task.md             # harness run "..." arg 저장 (Phase 1 프롬프트에서 참조)
    ├── decisions.md
    ├── checklist.json
    ├── phase-1.done        # sentinel files
    ├── phase-3.done
    ├── phase-5.done
    ├── gate-2-raw.txt      # gate 실행 직후 raw stdout 저장 (state 갱신 후 삭제)
    ├── gate-2-result.json  # gate 실행 직후 {exitCode, timestamp} 저장 (state 갱신 후 삭제)
    ├── gate-2-error.md     # gate 비정상 종료 시 stdout/stderr 저장 (retry 성공 또는 정상 완료 시 삭제)
    ├── gate-2-feedback.md  # gate reject 시 생성
    ├── gate-4-raw.txt
    ├── gate-4-result.json
    ├── gate-4-error.md
    ├── gate-4-feedback.md
    ├── gate-7-raw.txt
    ├── gate-7-result.json
    ├── gate-7-error.md
    ├── gate-7-feedback.md
    ├── verify-result.json  # verify 실행 직후 기록 {exitCode, hasSummary, timestamp}
    ├── verify-feedback.md  # verify fail 시 생성
    └── verify-error.md     # verify ERROR 시 생성 (stdout/stderr 캡처)
```

`.harness/`는 `.gitignore`에 추가한다.

---

## 프로젝트 구조 (TypeScript)

```
harness-cli/
├── package.json
├── tsconfig.json
├── bin/
│   └── harness.ts                  # CLI entrypoint
├── src/
│   ├── commands/
│   │   ├── run.ts                  # harness run [--allow-dirty] [--auto]
│   │   ├── resume.ts               # harness resume [runId]
│   │   ├── status.ts               # harness status
│   │   ├── list.ts                 # harness list
│   │   ├── skip.ts                 # harness skip
│   │   └── jump.ts                 # harness jump <phase> (backward-only)
│   ├── phases/
│   │   ├── runner.ts               # Phase lifecycle 관리, 상태 전이
│   │   ├── interactive.ts          # claude subprocess spawn/watch/sentinel
│   │   ├── gate.ts                 # Codex gate 실행 + verdict 파싱
│   │   └── verify.ts               # harness-verify.sh 실행
│   ├── context/
│   │   ├── assembler.ts            # phase별 초기 프롬프트 조립
│   │   └── prompts/                # phase별 프롬프트 템플릿
│   │       ├── phase-1.md
│   │       ├── phase-3.md
│   │       └── phase-5.md
│   ├── types/
│   │   └── index.ts                # HarnessState, PhaseStatus, GateVerdict 등
│   ├── state.ts                    # .harness/<runId>/state.json read/write
│   └── config.ts                   # 모델 설정, 경로 constants
└── docs/
    └── specs/
        └── 2026-04-12-harness-cli-design.md
```

---

## 범위 외 (이번 마이그레이션에서 제외)

- advisor 자동 설정 (`/advisor`는 in-session 커맨드라 CLI에서 직접 제어 불가 — 추후 설정 파일 방식 검토)
- harness-verify.sh 자체 개선 (현재 스크립트 재사용, 경로: `~/.claude/scripts/harness-verify.sh`)
- 기존 skill 파일 삭제 (마이그레이션 검증 후 별도 결정)
