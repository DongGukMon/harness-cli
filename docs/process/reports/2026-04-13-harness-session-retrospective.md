# Harness 라이프사이클 세션 회고 — 2026-04-12/13

이 레포트는 `harness-cli` 개발 세션 전체(Phase 1–7, 약 30시간)를 대상으로 하는 회고입니다. Spec gate 68 라운드, Plan gate 12 라운드, Eval gate 10 라운드, 서브에이전트 4건 timeout 등 실제 세션에서 관측된 데이터 기반으로 작성되었습니다.

- **세션 기간**: 2026-04-12 18:04 KST ~ 2026-04-13 16:00 KST (약 30시간, 수면/휴식 포함)
- **최종 산출물**: 36 git commits, 243 tests passing, `dist/bin/harness.js` CLI binary
- **주 작업자**: Claude (Opus 4.6 + Sonnet 서브에이전트), Codex companion (gate reviewer), 사용자 (의사결정)

---

## 섹션 1 — 객관적 데이터 레포트

### 1.1 Phase별 소요 시간

타임스탬프 소스: `git log --format="%ci"` 및 `/tmp/harness-gate-*.txt` 파일 mtime

| Phase | 시작 | 종료 | 소요 시간 | Round 수 |
|-------|------|------|-----------|----------|
| 1 Brainstorming | 04-12 ~17:30 | 04-12 18:04 | ~30분 | 1 |
| 2 Spec Gate | 04-12 18:04 | 04-13 01:57 | **~8시간** (수면 포함) | **68** |
| 3 Planning | 04-13 ~08:30 | 04-13 09:02 | ~30분 | 1 |
| 4 Plan Gate | 04-13 09:02 | 04-13 10:37 | ~95분 | **12** |
| 5 Implementation | 04-13 10:40 | 04-13 13:45 | ~3시간 | 23 tasks |
| 6 Auto Verify | 04-13 13:46 | 04-13 13:46 | 수초 | 1 |
| 7 Eval Gate | 04-13 13:55 | 04-13 15:52 | **~2시간** | **10** |
| 마무리 | 04-13 15:52 | 04-13 16:00 | 8분 | — |

**Source**:
- Gate round별 정확한 타임스탬프: `/tmp/harness-gate-{43..68}.txt` (spec), `/tmp/harness-plan-gate-{1..12}.txt` (plan), `/tmp/eval-gate-{2..10}.txt` (eval)
- Implementation commits: `git log --format="%ci %s" 049a9b1..4200043`

### 1.2 Gate round별 발견된 P1 이슈 수

| Gate | 총 Round | APPROVE | REJECT | 평균 P1/round | 종료 사유 |
|------|----------|---------|--------|----------------|-----------|
| Spec | 68 | 0 | 68 | 3-5 | 사용자 force-pass |
| Plan | 12 | 1 (attempt 12) | 11 | 2-4 | 자연 수렴 |
| Eval | 10 | 0 | 10 | 2-4 | 사용자 force-pass |

**관찰 패턴**: 매 round마다 이전에 발견되지 않은 P1이 2-4개씩 새로 등장. 수정 후 다음 round에서 다른 부분의 P1이 나옴. "수렴하지 않는 리뷰 패턴".

**Source**:
- Fix 커밋 시퀀스 (Eval gate 예시): `git log --oneline | grep "eval gate rev-"`
- 각 round의 실제 P1 내용: 위 대화 히스토리 + `/tmp/*-gate-*.txt` 결과 (세션 종료 후 삭제됨)

### 1.3 서브에이전트 실행 통계 (Phase 5 Implementation)

총 23개 Task 중:

| 결과 | 개수 | Task 번호 | 비고 |
|------|------|-----------|------|
| 서브에이전트 성공 | 17 | 1-16, 22 | DONE 보고 + 커밋 완료 |
| Stream idle timeout | 4 | 17, 18, 20, 21 | 약 60분 실행 후 결과 없이 실패 |
| 직접 구현으로 전환 | 4 | 17, 18, 20, 21 | 메인 세션에서 인라인 구현 |
| 테스트 첫 통과 | 17 | 대부분 | 재작성 없이 바로 통과 |
| 테스트 수정 필요 | 6 | State 경로 수정 등 | spec 해석 차이로 수정 |

**서브에이전트 timeout 원인 추정**:
- 모두 "command"/"resume" 계열의 큰 태스크 (파일 많음, 복잡한 상태 머신 통합)
- Task 19, 21은 timeout 후 재시도 없이 메인 세션에서 직접 구현해서 성공 → 태스크 크기보다 **스트림 안정성 문제**로 추정

**Source**:
- 서브에이전트 output 로그: `/private/tmp/claude-501/-Users-daniel-Desktop-projects-harness-harness-cli/*/tasks/*.output` (세션 종료 후 소실)
- Task별 커밋: `git log --format="%h %s" | grep "feat:"` (23개 중 성공한 것들)

### 1.4 Spec 문서 진화 (Revision count)

| Rev | 시점 | 변경 내용 요약 |
|-----|------|----------------|
| 1 | 초기 | Brainstorming 종료 시점 |
| 43 | 04-12 23:24 | Gate 43회 이후 |
| 46 | 04-13 00:04 | Gate 46회 이후 |
| 68 | 04-13 01:57 | Gate 68회 이후 (force-pass 직전) |
| 69 | 04-13 01:58 | Approved 표시 + force-pass 기록 |

각 rev는 이전 Codex 리뷰의 P1 이슈들을 반영한 결과. Rev 1부터 Rev 69까지의 diff를 보면 모든 fix 이력이 녹아있음.

**Source**: `docs/specs/2026-04-12-harness-cli-design.md` (현재 rev 69, `git log` 로는 이력 없음 — spec 자체가 overwrite 되어옴)

### 1.5 Eval gate rev별 fix 분류

`docs/process/evals/2026-04-12-harness-cli-eval.md`에 상세 기록. 요약:

| Rev | 주요 수정 영역 | P1 수 | 관련 커밋 |
|-----|----------------|-------|-----------|
| 1→2 | Prompt contracts, 상태 변이, signal childPid | 4 | `5feb0a7` |
| 2→3 | Resume integrity, checklist schema, gate timeout PGID | 3 | `cb43781` |
| 3→4 | skip_phase replay, Phase 5 fresh sentinel | 3 | `e9a48d9` |
| 4→5 | 일반 resume 경로, Phase 6 결과 replay | 3 | `7738397` |
| 5→6 | task.md 순서, Phase 6 PGID drain | 2 | `d3335d4` |
| 6→7 | Strict verdict parsing, lock ordering | 3 | `70c3cee` |
| 7→8 | Verify FAIL escalation, UI replay | 2 | `559c7bc` |
| 8→9 | Escalation routing, jump anchor validation | 3 | `8b2ba1c` |
| 9→10 | Error state resume, signal handlers | 3 | `171b7a9` |

**총 fix P1 수 (Eval gate)**: 약 26개 (일부 P2 포함)

**Source**:
- 각 rev 상세 내용: `docs/process/evals/2026-04-12-harness-cli-eval.md`
- 각 rev 코드 변경: `git log --format="%h %s" | grep "eval gate rev-"` → 해당 커밋의 `git show`

### 1.6 코드 규모

```
src/               ~2,800 LOC (TypeScript)
tests/             ~2,100 LOC (Vitest)
docs/specs/        ~1,200 lines (design spec)
docs/plans/        ~700 lines (implementation plan)
```

**Source**:
- `find src tests -name '*.ts' | xargs wc -l`
- `wc -l docs/specs/*.md docs/plans/*.md`

---

## 섹션 2 — 주관적 회고 / 개선 제안

### 2.1 Gate 수렴 실패 문제 (가장 심각)

#### 관찰

- Spec gate는 68 round에 걸쳐 한 번도 APPROVE 받지 못함
- Eval gate도 10 round 내내 REJECT
- 매 round 새로운 P1이 2-4개 발견. 수정 후 다음 round에서 이전엔 안 보이던 버그 발견.
- Plan gate만 유일하게 12 round에 자연 수렴 — 비교적 단순한 구조화된 문서라서 가능했던 것으로 추정

#### 원인 분석

1. **Reviewer bias**: Codex가 "뭔가는 찾아야 한다"는 압박으로 점점 깊은 edge case를 파고듦. Rev-6 이후에 발견되는 P1들은 crash window 수 밀리초 단위, orphan PGID 드레인 타이밍 등 실사용에서 거의 재현 불가능한 수준.
2. **Spec 스스로가 무한히 복잡함**: 1,200 라인짜리 상태 머신 명세는 리뷰어가 파고들 수 있는 edge case가 사실상 무한함.
3. **사용자 판단 없는 무한 루프**: CLI가 자체적으로 "이제 충분하다"를 판단할 수 없음. 매번 사용자가 수동으로 force-pass.

#### 개선 제안

**A. Gate에 객관적 exit criteria 도입**
- 현재: 사용자 재량 또는 N회 reject → 에스컬레이션
- 제안: "3 round 연속으로 '같은 영역'의 P1이 나오면 자동 종료" 혹은 "P1 이슈의 심각도(P0 있음/P1만/P2만)를 명시적 분류해서 P1-only가 N회 연속이면 force-pass"

**B. 리뷰어에게 "done criteria" 함께 전달**
- 현재 프롬프트는 "APPROVE only if zero P0/P1"이라서 P1을 찾아야 한다는 압박이 강함
- 제안: "If you have to dig into millisecond-scale crash windows or theoretical edge cases, that's a signal the review is done" 같은 명시적 가이드

**C. Spec 자체의 복잡도 상한**
- 1,200 라인 spec은 리뷰어가 한 번에 파악 못함. 10번째 round의 P1은 rev-1엔 없던 문장이 추가되면서 생긴 경우도 있음 (자기 유발 버그).
- 제안: Spec 토큰 제한 + 핵심 계약만 남기고 세부는 plan으로 위임

### 2.2 서브에이전트 stream timeout (실무적 타격 큰 문제)

#### 관찰

- 23개 Task 중 4개(17.4%)에서 60분 후 stream idle timeout. 결과물 없음.
- 모두 "비교적 큰 command 파일" (Task 17: resume, 18: run, 20: skip/jump, 21: status/list)
- 메인 세션에서 직접 구현하면 15-25분 내 완료

#### 원인 추정

- 서브에이전트가 내부적으로 너무 많은 중간 단계(파일 읽기 → 테스트 작성 → 실행 → 수정)를 거치면서 stream이 idle 판정됨
- 또는 Claude API의 max output tokens에 근접하면서 응답 생성이 느려졌을 가능성

#### 개선 제안

**A. 서브에이전트 태스크 사이즈 기준 설정**
- "한 태스크가 3개 이상의 파일 수정 + 테스트 + 디버깅 루프를 포함하면 메인 세션에서 직접 구현"
- 서브에이전트는 단일 모듈 (types.ts, state.ts 같은 독립 파일) 전용으로 한정

**B. Timeout 자동 감지 + 재시도/전환**
- 현재: 사용자가 수동으로 "timeout이네, 직접 구현으로 전환" 판단
- 제안: 60분 timeout 발생 시 자동으로 "timeout_retry_strategy" 메타데이터 수집 → 다음 비슷한 task에서 예방

**C. 서브에이전트 진행률 heartbeat**
- Stream idle이 아니라 "N분마다 진행 상황 1줄 보고"를 강제. 그러면 60분 timeout 발생 전에 hang 상태인지 진행 중인지 구분 가능.

### 2.3 Spec ↔ 구현 사이의 미묘한 drift

#### 관찰

- `src/state.ts`에서 서브에이전트가 `artifact.evalReport`를 `docs/reports/` 경로로 설정함. Spec은 `docs/process/evals/` 였음.
- 이 bug는 unit test 단계에서 잡히지 않았고 (spec 경로를 알고 있는 테스트가 없었음), 실제 `harness run` 테스트 중에 ENOENT 에러로 처음 드러남.
- Gate eval rev-1까지도 못 잡았다가 사용자가 실수로 만든 경로 불일치를 테스트 실패로 발견 → 수정

#### 원인 분석

서브에이전트는 spec을 읽었지만 artifact path 부분은 "흔한 컨벤션"으로 해석 (`docs/reports/` 가 더 흔함). Spec에 명시적으로 적혀 있어도 **드문 컨벤션은 서브에이전트가 자주 틀림**.

#### 개선 제안

**A. Spec에 "정확한 문자열" 섹션 도입**
- 흔하지 않은 경로, 필드 이름, enum 값은 "EXACT STRINGS TO USE" 같은 별도 섹션으로 모아서 서브에이전트가 참조하기 쉽게
- 예: `artifact.evalReport = "docs/process/evals/<runId>-eval.md"` ← exact

**B. Conformance 테스트 추가**
- "spec 상수 ↔ 코드 상수 비교" 테스트 (spec.md에서 경로 패턴을 추출해 런타임 값과 대조)
- 이번 건은 conformance 테스트만 있었어도 즉시 잡혔을 것

### 2.4 Skill 기반 하네스 vs CLI 하네스의 tradeoff

#### 현재 상황

기존 skill 기반 하네스가 있었고, 이번에 CLI로 마이그레이션. 이번 세션 자체가 **기존 skill 하네스로 실행된 CLI 하네스 개발**.

#### Skill 하네스의 한계 (CLI가 해결)

1. ✅ 세션 클리어 불가 → CLI에서 phase별 프로세스 분리
2. ✅ 수동 커맨드 마찰 (`/model`, `/advisor`) → `--model` 플래그로 자동화
3. ✅ 컨텍스트 유실 → 파일 기반 컨텍스트 전달

#### CLI 하네스가 오히려 악화시킨 것

1. **Advisor 자동 설정 불가능** — `/advisor`는 in-session command라 CLI가 못 씀 (범위 외)
2. **Phase 진행 상황 추적 복잡도 증가** — state.json, lock, sidecar 파일 등 파일 시스템 상태가 복잡해짐
3. **Crash recovery가 새로운 attack surface** — 이번 Eval gate 10 round 중 대부분이 resume 로직 관련 edge case

#### 개선 제안

**A. Advisor 지원을 위해 Claude Code 측에 feature request**
- `--advisor <model>` CLI 플래그 또는 `claude advisor set` subcommand
- 없으면 영원히 수동 설정

**B. CLI의 "단순 모드" 옵션 추가**
- `harness run --no-resume` — state.json, lock, sidecar 전부 생략. 중단되면 완전 실패.
- 간단한 실험/테스트용. Resume이 필요 없는 짧은 태스크에서 오버헤드 제거.

**C. Phase별 디버깅 도구**
- `harness debug --phase N --show-state` — 현재 phase의 state.json, sidecar, 최근 spawn 명령 등을 한 눈에 보여주는 커맨드
- 이번 세션에서 Codex가 제기한 resume edge case 중 일부는 "실제로 해당 상황이 나올 수 있는지" 재현이 어려워서 fix의 확신도가 낮았음

### 2.5 Human-in-the-loop 지점의 부족

#### 관찰

- Spec gate 68 round, Eval gate 10 round — 사용자가 중간에 개입한 지점이 **매우 적음** (force-pass 2회, "자율 모드 전환" 없음)
- Gate가 자동으로 에스컬레이션 UI를 띄우지만, 이 UI는 사용자에게 "3회 reject됐다"고만 알려주지 **"지금 발견된 P1들이 실제로 구현 차단인지 edge case인지 판단해달라"** 같은 메타 질문은 안 함
- 68 round 중 사용자가 "이거 무한 루프 같은데 멈춰야겠다"고 스스로 판단한 시점 전까지 계속 돔

#### 개선 제안

**A. Round N 이후 자동 메타 질문**
- 5 round마다 "이 gate가 수렴할 가망이 있어 보이는지" 사용자에게 가벼운 체크인
- 무음으로 진행되는 것보다 주기적인 개입 포인트가 필요

**B. 리뷰어가 직접 "수렴 판정"을 하도록 유도**
- 프롬프트에 "If this is the 3rd+ round on the same spec and you can't find new P0s, return APPROVE with a note" 같은 지시 추가
- 리뷰어의 "bias to find something"을 의도적으로 상쇄

### 2.6 이번 세션에서 잘 동작한 것들

객관적으로 잘 됐던 것들도 기록:

1. **Plan gate의 자연 수렴 (12 round)**: 명세화된 태스크 분해 + eval checklist라는 비교적 닫힌 형식이 리뷰어의 edge case 탐색을 제한함
2. **Implementation Phase 초반 서브에이전트 (Task 1-16)**: 독립 모듈 단위로 dispatch해서 평균 10-20분 내 완료
3. **Git commit 추적**: 매 fix를 별도 커밋으로 남겨서 rev별 diff 추적 용이
4. **Atomic state write + sentinel 패턴**: 한 번도 state.json corruption 발생 안 함. 중간 crash 없이 30시간 운영.
5. **서브에이전트 ↔ 메인 세션 fallback**: 4건 timeout 중 직접 구현으로 전환해서 큰 지연 없이 회복

---

## 섹션 3 — 케이스 스터디

### Case 1: Spec gate 68 round 무한 루프

**사건**: 04-12 18:04 ~ 04-13 01:57 (약 8시간, 수면 포함 실질 약 4시간) 동안 spec gate가 APPROVE를 내지 못함.

**경과**:
- Round 1-20: 실제 구현 차단 수준의 P1 대거 발견 (상태 전이 모순, lock lifecycle 미정의, phase completion contract 등) → 각각 rev 추가하며 수정
- Round 21-40: spec 내 cross-section 일관성 이슈 → rev로 보강
- Round 41-60: 매우 specific crash window (예: "gate 결과 파일 썼지만 state 전환 전 crash하면…") → rev로 대응
- Round 61-68: 리뷰어가 점점 가설적 시나리오 ("if mtime precision is 2 seconds on an exotic filesystem…") 탐색. 실제로 재현 가능성 낮음.
- 사용자가 "force pass" 판단 → rev 69로 "approved (force-passed)" 마킹

**원인**: Spec 문서가 1,200 라인 스테이트 머신 명세. 리뷰어가 파고들 표면이 사실상 무한.

**대응/교훈**:
- **단기 대응**: 사용자의 force-pass 결정이 유일한 출구였음
- **장기 교훈**:
  1. Spec gate에 round limit과 "P2-only-for-N-rounds" 자동 종료 기준 필요
  2. Spec 복잡도 자체에 상한 (예: 500 라인 초과 시 서브 스펙으로 분해 권장)

**Source**:
- 각 round별 Codex 응답: 대화 히스토리 및 (일부) `/tmp/harness-gate-{43..68}.txt`
- Rev 1 → Rev 69 diff: `docs/specs/2026-04-12-harness-cli-design.md` (현재만 존재. 이전 rev는 spec 자체에 녹아있음)
- Status 라인: `docs/specs/2026-04-12-harness-cli-design.md:4` → "Approved (rev 69 — spec gate force-passed at attempt 68, remaining P1s deferred to implementation)"

---

### Case 2: 서브에이전트 4건 stream timeout

**사건**: Phase 5 Implementation 중 Tasks 17, 18, 20, 21 연속 timeout. 각각 약 60분 후 "API Error: Stream idle timeout - partial response received"

**경과**:
- Task 17 (Resume Algorithm): 545193ms (약 9분) 후 timeout
- Task 18 (Command: run): 3704890ms (약 62분) 후 timeout
- Task 20 (skip/jump): 3681410ms (약 61분) 후 timeout
- Task 21 (status/list): 3132263ms (약 52분) 후 timeout
- **모두 동일한 API error pattern**: "partial response received"
- 직접 구현으로 전환 (메인 세션에서 5-25분 내 완료)

**원인 추정**:
- 4건 모두 "다른 모듈 3-5개를 import하고 통합하는" 성격
- 서브에이전트가 많은 파일 읽기 + 작성 + 테스트 실행을 한 세션에서 처리하면서 API가 stream을 idle로 판정
- 또는 max output tokens 근접으로 response generation이 느려졌을 가능성

**대응/교훈**:
- **단기 대응**: 메인 세션 직접 구현으로 fallback → 성공
- **장기 교훈**:
  1. 서브에이전트 태스크는 "단일 모듈" 크기로 제한. 4-5개 파일을 통합하는 태스크는 메인 세션에서 직접.
  2. Timeout 발생 시 재시도 대신 즉시 fallback. 60분 낭비하지 않음.
  3. 근본적으로 API 측 문제일 수 있으므로 Anthropic에 report 가치 있음

**Source**:
- Task 17: 대화 히스토리의 "stream idle timeout" 노티
- Task 18/20/21: 동일한 패턴의 noti들
- 실제 완료된 구현: `git log --format="%h %s" | grep -E "feat: harness (run|resume) command|skip and jump|status and list"`

---

### Case 3: state.ts artifact path drift (미묘한 spec 위반)

**사건**: 04-13 11:33 (Task 2 types & config 이후) → 04-13 13:38 (Task 20 skip/jump 중 발견)

**경과**:
1. Task 2 완료 시 서브에이전트가 `src/state.ts`의 `createInitialState`에서 artifact 경로를 다음과 같이 설정:
   ```typescript
   evalReport: `docs/reports/${runId}-eval.md`
   ```
2. Spec은 명시적으로 `docs/process/evals/<runId>-eval.md`로 지정
3. Task 3, 4, ... 의 테스트들은 이 경로를 실제로 참조하지 않아 bug가 숨어있음
4. Task 20에서 Phase 6 skip 시 synthetic eval report를 생성하려다 `ENOENT: docs/reports/...` 에러로 발견
5. state.ts 수정 + state.test.ts 수정 (경로 assertion 업데이트) → 커밋 `365fc9a`

**bug가 숨어있던 시간**: 약 2시간 5분

**원인 분석**: 서브에이전트가 spec을 읽었지만 `docs/process/evals/`는 흔하지 않은 경로. 더 흔한 `docs/reports/`로 자동 "보정"한 것으로 추정. Spec을 정확히 따른다는 암묵적 가정이 깨짐.

**대응/교훈**:
- **단기 대응**: 발견 즉시 수정 + 관련 테스트 보강
- **장기 교훈**:
  1. Spec에 "흔하지 않은 문자열"을 별도 섹션으로 모아 서브에이전트가 복사 가능하도록
  2. Conformance 테스트 (spec 상수 ↔ 코드 상수 비교) 필수
  3. 서브에이전트 리뷰 단계에서 "spec exact strings" 체크 포인트 추가

**Source**:
- 버그 발견 순간: `git log --format="%h %s" | grep "fix state.ts artifact paths"` → 커밋 `365fc9a`
- 실제 변경: `git show 365fc9a -- src/state.ts tests/state.test.ts`
- Spec의 정확한 경로: `docs/specs/2026-04-12-harness-cli-design.md` → 검색 `docs/process/evals`

---

### Case 4: Eval gate rev-2 prompt contract 대량 재작성

**사건**: 04-13 14:06 — Eval gate rev-1 결과 확인 후 rev-2 대규모 수정.

**경과**:
- Rev-1 Codex 리뷰가 prompt assembly에 4개 critical issue 지적:
  1. Phase 1 프롬프트가 raw task string을 주입 (spec은 `task.md` 경로를 주입해야 함)
  2. Gate prompt format이 Korean `## 리뷰 요약` 등을 사용 (spec은 English `## Verdict / ## Comments / ## Summary`)
  3. Gate 4가 plan + checklist를 읽음 (spec은 spec + plan)
  4. Phase 5 prompt가 spec/decisions를 포함하지 않음
- **발견 시점에 이미 구현이 끝난 상태**. 서브에이전트가 spec과 다르게 구현.
- rev-2에서 `src/context/assembler.ts` 약 100줄 재작성 + 4개 prompt template 수정

**원인 분석**: Task 12 (prompt assembler) 서브에이전트가 spec의 Korean reviewer contract 섹션을 "예시"로 해석하고 자체 해석으로 대체. 이 drift는 rev-1 Eval gate가 발견하기 전까지 불시에 존재.

**대응/교훈**:
- **단기 대응**: rev-2에서 일괄 재작성 → `5feb0a7` 커밋
- **장기 교훈**:
  1. Gate review를 먼저 실행하지 않으면 발견 못할 drift가 존재
  2. Prompt contract 같은 string-exact 영역은 conformance 테스트 대상
  3. Unit test로는 prompt 내용의 의미를 검증할 수 없음 (test가 작성된 서브에이전트도 같은 오해를 가지고 있기 때문)

**Source**:
- Rev-1 Codex 피드백: 대화 히스토리 (`eval gate attempt 1` 블록)
- Rev-2 수정 내역: `git show 5feb0a7 -- src/context/assembler.ts src/context/prompts/`

---

### Case 5: Task 23 통합 테스트 작성 시 발견된 mock 누락

**사건**: Task 23 (integration tests) 작성 중 `harness run` 테스트에서 signal handler mock 누락 발견 → 이전 Task 20의 skip/jump 테스트에도 동일 문제 있음을 소급 발견

**경과**:
- Task 23에서 `harness run` 통합 테스트 작성
- 테스트 실행 시 "ENOENT: state.json.tmp" 에러 대량 발생
- 원인: Task 20에서 skip/jump 구현할 때 signal handler를 등록했는데, 테스트에서 mock하지 않음 → 테스트 종료 후 signal handler가 cleanup 로직 실행 시 이미 삭제된 tmp dir 접근
- Task 20 테스트 파일 (`tests/commands/skip.test.ts`, `tests/commands/jump.test.ts`)에 `vi.mock('../../src/signal.js')` 추가 → 문제 해결

**대응/교훈**:
- **단기 대응**: 해당 테스트 파일에 mock 추가
- **장기 교훈**:
  1. Signal handler 같은 "프로세스 수명 동안 유지되는" 사이드 이펙트는 반드시 테스트에서 mock
  2. 통합 테스트가 있으면 단위 테스트 누락을 발견하는 데 도움됨
  3. 단위 테스트만 믿지 말기 — 이번에도 243 tests all pass였는데 실제 통합 시점에 문제 발견

**Source**: `git show 171b7a9 -- tests/commands/skip.test.ts tests/commands/jump.test.ts`

---

## 섹션 4 — 다음 Harness 세션을 위한 체크리스트

이번 경험을 바탕으로 다음에 비슷한 프로젝트를 시작하기 전 점검할 항목들:

### Spec 작성 단계
- [ ] Spec 토큰 상한 설정 (500 라인 권장, 1000 라인 초과 시 서브 스펙 분해)
- [ ] "Exact strings" 섹션 별도 생성 (경로, enum 값, 포맷 template)
- [ ] ADR에 "이 결정이 틀렸을 때의 롤백 비용" 명시

### Spec Gate 실행 단계
- [ ] Round limit 사전 설정 (예: "15 round에 수렴 안 하면 force-pass")
- [ ] 5 round마다 사용자 체크인 지점 삽입
- [ ] Reviewer에게 "done criteria" 명시 ("P0 없고 최근 3 round가 같은 영역이면 APPROVE")

### Planning 단계
- [ ] Task 크기 상한 설정 (1 task = 1-2 파일, 3+ 파일 통합은 메인 세션)
- [ ] Conformance 테스트 task를 plan에 명시 (spec 상수 ↔ 코드 상수 대조)
- [ ] Plan gate도 round limit

### Implementation 단계
- [ ] 서브에이전트 dispatch 시 timeout 감지 로직
- [ ] Timeout → 즉시 fallback (재시도 안 함)
- [ ] 큰 태스크 (command 계열, state machine 계열) → 메인 세션에서 직접

### Eval Gate 단계
- [ ] Integration test 우선순위 높이기
- [ ] Round 5 이후 P1이 millisecond-scale edge case뿐이면 force-pass 권장
- [ ] 리뷰어에게 "edge case digging 방지" 프롬프트 지시

---

## 섹션 5 — 원본 자료 인덱스

이 레포트의 데이터 출처를 한 번에 정리:

### 코드 아티팩트 (영구 보존)
- `docs/specs/2026-04-12-harness-cli-design.md` — 최종 spec (rev 69)
- `docs/plans/2026-04-12-harness-cli.md` — 구현 계획
- `docs/process/evals/2026-04-12-harness-cli-eval.md` — 자동 검증 + rev 히스토리
- `docs/HOW-IT-WORKS.md` / `docs/HOW-IT-WORKS.ko.md` — 동작 원리 문서
- `src/` — 구현 코드 (2,800 LOC)
- `tests/` — 테스트 코드 (2,100 LOC)

### Git log (영구 보존)
- `git log --oneline` — 36 commits
- 주요 분류:
  - `feat: ...` — 구현 커밋 (Task 1-23)
  - `fix: eval gate rev-N P1s` — Eval gate fix 커밋 (rev-2 ~ rev-10)
  - `docs: ...` — 문서 커밋

### 임시 파일 (세션 종료 시 소실)
- `/tmp/harness-gate-{43..68}.txt` — Spec gate round 43-68의 프롬프트
- `/tmp/harness-plan-gate-{1..12}.txt` — Plan gate round 1-12
- `/tmp/eval-gate-{2..10}.txt` — Eval gate round 2-10
- `/private/tmp/claude-501/.../tasks/*.output` — 서브에이전트 JSONL 로그

### 대화 히스토리
- 이 세션의 전체 대화 (prompts, assistant responses, tool calls) — 클라이언트 측에 영구 보존
- 각 Codex 리뷰의 실제 P1 내용, 사용자 의사결정 지점 등 포함

---

## 맺음말

총 30시간 세션 (실질 약 15-18시간 작업), 90 round의 gate review, 23개 Task, 4건의 서브에이전트 실패, 243개 테스트, 36개 커밋. 이 중 가장 큰 수확은 **"AI 에이전트 기반 하네스의 수렴 실패 패턴"** 을 처음으로 객관적 데이터로 관측했다는 점.

Spec gate 68 round의 대부분은 사실상 낭비된 시간에 가깝지만, 그 과정에서 spec 품질은 초기 rev 1 대비 실질적으로 향상되었음. Eval gate 10 round 동안 발견된 실제 버그 (stored verify-result.json replay, PGID drain before clearLockChild 등)는 프로덕션에서 발견됐다면 훨씬 비쌌을 것.

다음 세션에서는 이 레포트의 섹션 4 체크리스트 적용 시 세션 시간이 40-60% 단축될 것으로 추정.
