# HANDOFF — Group A (Phase Recovery: checklist mtime + P5 dirty-tree auto-recovery)

**Paused at**: 2026-04-19 11:27 KST
**Worktree**: `/Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/phase-recovery`
**Branch**: `feat/phase-recovery`
**Base prompt**: 해당 prompt는 `/clear` 이후 inline으로 전달되었음 (별도 txt 파일 없음). 원본 지시사항:
- Group A 스코프(T1 + T2), 실행 방식(자율 모드 full auto), 권장 해법(T1 mtime drop / T2 IGNORABLE_ARTIFACTS + auto-commit + `--strict-tree`), 충돌 주의(Group B/C와 동일 파일)
- 자율 모드: Codex 3 reject → 4회째 force-pass
- 전역 CLAUDE.md `harness-lifecycle` + P1-only 정책 적용
- Co-authored-by 금지 / `git add -f` 금지 / `pnpm link --global` 금지
- (중요) 원 prompt는 `harness start --light` dogfood을 지시했으나, 본 세션에서 **manual 4-phase discipline**으로 결정 변경. 사유는 `docs/specs/2026-04-19-phase-recovery-design.md::Deferred (D-i)` 참조.

**Reason**: 사용자 요청 (token 교체 / account 변경 예정)

## Completed commits (이 worktree에서)

`git log --oneline origin/main..HEAD`:

- `4d0be2e` wip(phase-recovery): slice 1 partial — interactive.ts mtime drop done, resume.ts pending

이 commit은 아래 5파일을 staged 상태로 포함:
1. `docs/specs/2026-04-19-phase-recovery-design.md` (신규 — design spec, T1+T2 결정 포함)
2. `docs/plans/2026-04-19-phase-recovery.md` (신규 — 5-slice plan + eval checklist)
3. `src/phases/interactive.ts` (수정 — `validatePhaseArtifacts` 에서 mtime check 삭제)
4. `tests/phases/interactive.test.ts` (수정 — Phase 1/3 reopen-semantic 테스트 2개 추가 + 기존 stale-mtime 테스트를 reopen-accept 로 rewrite)
5. `tests/resume-light.test.ts` (수정 — ADR-13 symmetric reopen 테스트 1개 추가; **현재 RED**)

## In-progress state

- **현재 task**: Plan Slice 1 (T1 — validator reopen-aware / mtime staleness check drop)
- **마지막 완료 step**: `src/phases/interactive.ts` L100 `openedAt` local + L112 mtime 조건문 삭제. `tests/phases/interactive.test.ts` 에 대한 검증은 2/2 신규 테스트 GREEN.
- **중단 직전 하던 action**: `src/resume.ts:493` 의 동일 패턴 제거.
  - 삭제할 정확한 줄 (현 파일 기준): `if (openedAt !== null && Math.floor(stat.mtimeMs) < openedAt) return false;`
  - `const openedAt = state.phaseOpenedAt[String(phase)];` (L484 근처) 도 unused 될 것이므로 함께 삭제.
- **테스트 상태**: **RED (targeted run 기준)**
  - `tests/resume-light.test.ts::completeInteractivePhaseFromFreshSentinel — light + phase 1 extras (ADR-13) > accepts phase 1 artifacts when mtime is older than phaseOpenedAt (ADR-13 symmetric reopen)` — expected `true`, got `false` (resume.ts 구 mtime check 미제거 때문)
  - 전체 스위트(`pnpm vitest run`)는 이 세션에서 미실행. 이론상 같은 1건 실패.
- **빌드 상태**:
  - `pnpm tsc --noEmit` 미실행 (slice 1 impl이 incomplete한 상태로 type check는 문제없음 — mtime 라인 하나 지운 것 + `openedAt` const 삭제 뿐). 다음 세션에서 실행 필요.
  - `pnpm build` 미실행.
- **uncommitted 잔여물**: none (HANDOFF.md commit 직전 기준). HANDOFF.md만 untracked.

## Decisions made this session

1. **[결정 1] Dogfood 대신 manual 4-phase discipline 채택**. 근거: T1 mtime 버그는 P7 REJECT 후 P1 reopen에서 결정적으로 발현해 dogfood 중간에 수동 복구 강제. observations.md Round 2 선례 있음. post-merge Round 3 dogfood는 PR 테스트 플랜에 포함. 설계 스펙 `docs/specs/2026-04-19-phase-recovery-design.md::Deferred (D-i)` 에 rationale 기록.
2. **[결정 2] T1 해법: mtime check 전역 drop (option 1)**. reopen-only relax (option 2)는 `phaseReopenFlags` threading 필요(5개 call site + resume path 3개). sentinel attemptId 매칭이 이미 freshness의 진짜 근거이므로 mtime check는 중복. safety argument는 설계 스펙 D1 기록.
3. **[결정 3] T2 IGNORABLE_ARTIFACTS 패턴 세트는 Python + Node + macOS 에 한정**. Rust/Go/Java/Ruby 확장은 follow-up PR로 defer. 설계 스펙 Deferred (D-iii) 기록.
4. **[결정 4] T2 auto-recovery는 untracked `??` 만 대상**. tracked-modified 는 blocker (사용자/외부 도구 의도 존중). 설계 스펙 D2 기록.
5. **[결정 5] `--strict-tree` escape hatch는 `state.strictTree` 영속화**. `harness resume` 이 원 선택 보존. `createInitialState` 파라미터 추가 + state migration (기본 false). 설계 스펙 D3 기록.
6. **[결정 6] Wrapper skill 변경은 phase-5만** (step 0 scaffolding gitignore + Invariant rewording). Phase 1/3 wrapper의 유사 rewording은 Group B 스코프로 defer. 스펙 D4/D5.

## Open questions / blockers

- [확인 필요] `docs/plans/2026-04-19-phase-recovery.md::Slice 2` 에서 `validatePhaseArtifacts` 시그니처에 `runDir: string` 파라미터 추가하기로 계획. **지금 interactive.ts 내부에서는 `runDir`를 받지 않음**. 다음 세션에서 추가 시 `interactive.ts` 3개 call site (L247, L301, L330) + `resume.ts` 3개 call site (92, 124, 673) + 기존 테스트 `validatePhaseArtifacts(...)` 호출부 전부 업데이트 필요. 안전한 리팩토링이지만 scope 주의.
- [확인 필요] `src/context/assembler.test.ts` (or wherever assembler tests live) 가 실재하는지 확인. Slice 3 테스트 "phase 5 prompt includes gitignore scaffolding mandate" 를 해당 파일에 추가할지, 아니면 신규 테스트 파일을 만들지 재결정.
- [blocker 없음]

## Next concrete steps (ordered)

1. **resume.ts mtime 제거**: `src/resume.ts` 에서 `const openedAt = state.phaseOpenedAt[String(phase)];` + `if (openedAt !== null && Math.floor(stat.mtimeMs) < openedAt) return false;` 두 줄 삭제 (L484 + L493 근처). `grep -n "openedAt" src/resume.ts` 로 정확한 위치 재확인 후 Edit.
2. **테스트 재실행**: `pnpm vitest run tests/phases/interactive.test.ts tests/resume-light.test.ts` → 46/46 GREEN 기대.
3. **전체 테스트 + typecheck**: `pnpm tsc --noEmit && pnpm vitest run`. Baseline 617 + 신규 3개 = 620 pass / 1 skipped 기대.
4. **Slice 1 GREEN 커밋**: WIP commit `4d0be2e`를 rebase 정리 (squash with new fix) 하거나, 후속 커밋 `fix(phases): drop mtime staleness check on resume.ts as well` 로 append 후 PR 단계에서 squash. **권장**: 후속 커밋으로 쌓고 PR 시점에 squash-merge — WIP commit 을 rewrite 하지 않는 편이 안전.
5. **Slice 2 착수** (plan Slice 2 그대로):
   - `src/config.ts` 에 `IgnorablePattern` + `IGNORABLE_ARTIFACTS` export
   - `src/types.ts::HarnessState` 에 `strictTree: boolean`
   - `src/state.ts` migration + `createInitialState` 시그니처
   - `src/phases/dirty-tree.ts` 신규 (tryAutoRecoverDirtyTree + writeDirtyTreeDiagnostic)
   - `src/phases/interactive.ts` phase-5 branch 에 integration (시그니처에 `runDir` 추가 — Open Question 1번 참고)
   - `src/resume.ts::completeInteractivePhaseFromFreshSentinel` phase-5 branch 동일 integration
   - 신규 테스트: `tests/phases/dirty-tree.test.ts` + interactive.test.ts / resume-light.test.ts phase-5 확장
6. **Slice 3**: `src/context/skills/harness-phase-5-implement.md` step 0 + Invariant rewording. Assembler 테스트에 regex 어설션 추가 (위치는 Open Question 2번).
7. **Slice 4**: `bin/harness.ts` `--strict-tree` flag + StartOptions + start.ts 전달. 통합 테스트.
8. **Slice 5**: `pnpm tsc --noEmit && pnpm vitest run && pnpm build` 최종 확인. 테스트 카운트 617 → 629± 확인.
9. **PR 생성**: title/body 는 원본 prompt의 `## 완료 후 PR` 섹션 그대로 따름. base=`main`.

## Resume instructions

새 세션 시작 시 **첫 프롬프트로 이걸 그대로 붙여넣기**:

> 이 worktree는 Group A(Phase Recovery: checklist mtime + P5 dirty-tree auto-recovery) 작업을 진행 중이다. 다음 순서로 컨텍스트를 복구하고 이어서 진행하라:
>
> 1. `~/.grove/AI_GUIDE.md` 읽기
> 2. 프로젝트 `CLAUDE.md` 읽기
> 3. `/Users/daniel/.grove/github.com/DongGukMon/harness-cli/worktrees/phase-recovery/HANDOFF.md` 읽기 — 현재 상태 복구
> 4. `docs/specs/2026-04-19-phase-recovery-design.md` + `docs/plans/2026-04-19-phase-recovery.md` 읽기 — 설계·플랜 재확인
> 5. `git log --oneline origin/main..HEAD` + `git status` 확인
> 6. HANDOFF.md의 "Next concrete steps" 1번부터 재개. 테스트 상태가 RED이므로 먼저 step 1 (`src/resume.ts` mtime 제거)로 GREEN 전환.
>
> 자율 모드: 에스컬레이션 없이 진행, 단일 안건 Codex 3 reject → 4회째 force-pass. Co-authored-by 금지, `git add -f` 금지.
>
> 작업 재개 전에 현재 이해한 state를 1–2문장으로 요약해서 확인받고 시작할 것.
