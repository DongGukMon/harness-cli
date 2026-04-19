import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { assembleInteractivePrompt } from '../../src/context/assembler.js';
import type { HarnessState } from '../../src/types.js';

function stubState(tmp: string): HarnessState {
  return {
    runId: 'run-abc',
    baseCommit: 'base',
    implCommit: null,
    evalCommit: null,
    externalCommitsDetected: false,
    verifiedAtHead: null,
    implRetryBase: '',
    artifacts: {
      spec: path.join(tmp, 'spec.md'),
      plan: path.join(tmp, 'plan.md'),
      decisionLog: path.join(tmp, 'decisions.md'),
      checklist: path.join(tmp, 'checklist.json'),
      evalReport: path.join(tmp, 'eval.md'),
    },
    phasePresets: { '2': 'codex-high', '4': 'codex-high', '7': 'codex-high' },
    phases: { '1': 'pending', '2': 'pending', '3': 'pending', '4': 'pending', '5': 'pending', '6': 'pending', '7': 'pending' },
    phaseCodexSessions: { '2': null, '4': null, '7': null },
    phaseAttemptId: { '1': 'att-111', '3': 'att-333', '5': 'att-555' },
    phaseOpenedAt: {},
    phaseReopenFlags: {},
    gateRetries: { '2': 0, '4': 0, '7': 0 },
    pendingAction: null,
  } as unknown as HarnessState;
}

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-')); });

function renderPrompt(
  phase: 1 | 3 | 5,
  mutate?: (state: HarnessState) => void,
): string {
  const state = stubState(tmp);
  mutate?.(state);
  return assembleInteractivePrompt(phase, state, '/tmp/harness');
}

describe('assembleInteractivePrompt wrapper skill inline', () => {
  it('phase 1 — inlines harness-phase-1-spec wrapper with vars rendered', () => {
    const state = stubState(tmp);
    const prompt = assembleInteractivePrompt(1, state, '/tmp/harness');
    // wrapper body present
    expect(prompt).toContain('harness Phase 1 — Spec writing');
    // Ambiguity policy: developer-interaction instead of OQ stash
    expect(prompt).toMatch(/Ambiguity policy/);
    // variables rendered
    expect(prompt).toContain('run-abc');
    expect(prompt).toContain('att-111');
    // no unresolved vars
    expect(prompt).not.toContain('{{runId}}');
    expect(prompt).not.toContain('{{phaseAttemptId}}');
    expect(prompt).not.toContain('{{spec_path}}');
    // frontmatter stripped
    expect(prompt).not.toMatch(/^---\nname:/);
    expect(prompt).not.toContain('description: Use during harness-cli Phase 1');
  });

  it('phase 3 — inlines harness-phase-3-plan wrapper', () => {
    const state = stubState(tmp);
    const prompt = assembleInteractivePrompt(3, state, '/tmp/harness');
    expect(prompt).toContain('harness Phase 3 — Planning');
    expect(prompt).toContain('att-333');
    expect(prompt).toContain('superpowers:writing-plans');
    expect(prompt).toContain('checklist');
    expect(prompt).not.toContain('{{plan_path}}');
  });

  it('phase 1 — wrapper instructs brainstormer to emit `## Complexity` section', () => {
    const state = stubState(tmp);
    const prompt = assembleInteractivePrompt(1, state, '/tmp/harness');
    // Process step that tells the brainstormer to add the section.
    expect(prompt).toContain("'## Complexity' section");
    // Invariant line that enumerates the accepted enum values.
    expect(prompt).toMatch(/Small\s*\/\s*Medium\s*\/\s*Large/);
  });

  it('phase 3 — wrapper references "Complexity Directive block" without leaking the literal tag (regression guard)', () => {
    const state = stubState(tmp);
    // Use a state whose spec file does not exist on disk, so the assembler
    // emits an empty directive — the only `<complexity_directive>` tokens that
    // should ever appear in the prompt come from the rendered stanza itself,
    // never from the wrapper skill's prose.
    const prompt = assembleInteractivePrompt(3, state, '/tmp/harness');
    expect(prompt).toContain('Complexity Directive');
    expect(prompt).not.toContain('<complexity_directive>');
  });

  it('phase 5 — inlines harness-phase-5-implement wrapper with playbook refs', () => {
    const state = stubState(tmp);
    const prompt = assembleInteractivePrompt(5, state, '/tmp/harness');
    expect(prompt).toContain('harness Phase 5 — Implementation');
    expect(prompt).toContain('att-555');
    expect(prompt).toMatch(/context-engineering\.md/);
    expect(prompt).toMatch(/git-workflow-and-versioning\.md/);
    expect(prompt).toContain('superpowers:subagent-driven-development');
  });
});

describe('wrapper contract invariants — literal (per spec §4/§5)', () => {
  // spec §4/§5 outputs contract가 rendered prompt에 literal로 들어갔는지 확인.
  // loose string match만으로는 프롬프트가 잘못 그라운딩될 수 있음. 구체 경로/문구 그대로 검증.

  it('phase 1 — spec output artifact path + sentinel rule literal', () => {
    const state = stubState(tmp);
    state.runId = 'rid-1';
    state.artifacts.spec = '/abs/spec-out.md';
    state.artifacts.decisionLog = '/abs/decisions-out.md';
    const prompt = assembleInteractivePrompt(1, state, '/tmp/harness');
    // output artifacts rendered with their exact paths
    expect(prompt).toContain('/abs/spec-out.md');
    expect(prompt).toContain('/abs/decisions-out.md');
    // sentinel literal path + run-scoped
    expect(prompt).toMatch(/\.harness\/rid-1\/phase-1\.done/);
    // "sentinel 생성 후 추가 작업 금지" invariant literal
    expect(prompt).toMatch(/sentinel.*추가 작업 금지/);
    // Context & Decisions section requirement surfaced
    expect(prompt).toMatch(/Context & Decisions/);
  });

  it('phase 3 — plan + checklist paths + JSON schema literal + isolated-shell note', () => {
    const state = stubState(tmp);
    state.runId = 'rid-3';
    state.artifacts.plan = '/abs/plan-out.md';
    state.artifacts.checklist = '/abs/checklist-out.json';
    const prompt = assembleInteractivePrompt(3, state, '/tmp/harness');
    expect(prompt).toContain('/abs/plan-out.md');
    expect(prompt).toContain('/abs/checklist-out.json');
    expect(prompt).toMatch(/\.harness\/rid-3\/phase-3\.done/);
    // checklist schema literal (checks / name / command keys)
    expect(prompt).toMatch(/"checks"\s*:/);
    expect(prompt).toMatch(/"name"/);
    expect(prompt).toMatch(/"command"/);
    // qa #4 isolated-shell guidance literal
    expect(prompt).toMatch(/격리된 셸 환경/);
  });

  it('phase 5 — commit-per-task rule + sentinel-after-all-commits + playbook absolute refs', () => {
    const state = stubState(tmp);
    state.runId = 'rid-5';
    const prompt = assembleInteractivePrompt(5, state, '/tmp/harness');
    expect(prompt).toMatch(/\.harness\/rid-5\/phase-5\.done/);
    // "After each task completes, git commit" override literal
    expect(prompt).toMatch(/After each task completes, git commit/);
    // "sentinel 이전에 모든 변경사항이 git에 커밋" invariant literal
    expect(prompt).toMatch(/sentinel 이전에 모든 변경사항이.*커밋/);
    // playbook @-references resolved literally (context-engineering + git-workflow)
    expect(prompt).toMatch(/playbooks\/context-engineering\.md/);
    expect(prompt).toMatch(/playbooks\/git-workflow-and-versioning\.md/);
  });
});

describe('BUG-B regression — HARNESS FLOW CONSTRAINT survives thin binding', () => {
  // PR #11 added "HARNESS FLOW CONSTRAINT" (advisor() forbidden) inline to
  // phase-{1,3,5}.md. T5 thinned those templates; the constraint now lives in
  // each wrapper's Invariants section. Guard against regressing the migration.
  it.each([1, 3, 5] as const)('phase %i — advisor() forbidden + reviewer explanation present', (phase) => {
    const state = stubState(tmp);
    const prompt = assembleInteractivePrompt(phase, state, '/tmp/harness');
    expect(prompt).toContain('HARNESS FLOW CONSTRAINT');
    expect(prompt).toContain('advisor()');
    expect(prompt).toContain('독립 reviewer');
  });
});

describe('self-audit + feedback triage rendering', () => {
  it('phase 1 — self-audit step present in Process', () => {
    const prompt = renderPrompt(1);
    expect(prompt).toMatch(/## Process[\s\S]*Pre-sentinel self-audit/);
  });

  it('phase 1 — self-audit references spec success criteria, regex scan, and rerun-until-clean before sentinel', () => {
    const prompt = renderPrompt(1);
    expect(prompt).toMatch(/spec[\s\S]*Success Criteria[\s\S]*Invariants/);
    expect(prompt).toMatch(/grep[\s\S]*정규식|정규식[\s\S]*grep/);
    expect(prompt).toMatch(/한 번 더 같은 검증을 반복|rerun/);
    expect(prompt).toMatch(/sentinel 쓰기 직전/);
  });

  it('phase 1 — triage block is absent without feedback_path', () => {
    const prompt = renderPrompt(1);
    expect(prompt).not.toMatch(/P1-only 정책/);
    expect(prompt).not.toMatch(/## Deferred/);
  });

  it('phase 1 — triage block renders P1-only policy, Deferred fallback, and unlabeled-structural defer path when feedback_path is set', () => {
    const prompt = renderPrompt(1, (state) => {
      state.pendingAction = {
        type: 'reopen_phase',
        targetPhase: 1,
        sourcePhase: 2,
        feedbackPaths: ['/tmp/phase-1-feedback.md'],
      };
    });
    expect(prompt).toMatch(/P1-only 정책/);
    expect(prompt).toMatch(/없으면[\s\S]*파일 끝[\s\S]*## Deferred/);
    expect(prompt).toMatch(/severity 라벨 누락/);
    expect(prompt).toMatch(/구조 변경[\s\S]*## Deferred/);
  });

  it('phase 3 — self-audit step present in Process', () => {
    const prompt = renderPrompt(3);
    expect(prompt).toMatch(/## Process[\s\S]*Pre-sentinel self-audit/);
  });

  it('phase 3 — self-audit compares the plan and checklist against spec rules, then reruns until clean before sentinel', () => {
    const prompt = renderPrompt(3);
    expect(prompt).toMatch(/plan[\s\S]*spec[\s\S]*Success Criteria[\s\S]*Invariants/);
    expect(prompt).toMatch(/eval checklist[\s\S]*grep-rule|grep-rule[\s\S]*eval checklist/);
    expect(prompt).toMatch(/한 번 더 같은 검증을 반복|rerun/);
    expect(prompt).toMatch(/sentinel 쓰기 직전/);
  });

  it('phase 3 — triage block is absent without feedback_path', () => {
    const prompt = renderPrompt(3);
    expect(prompt).not.toMatch(/P1-only 정책/);
    expect(prompt).not.toMatch(/구조 변경[\s\S]*## Deferred/);
  });

  it('phase 3 — triage block renders P1-only policy, Deferred fallback, and unlabeled-structural defer path when feedback_path is set', () => {
    const prompt = renderPrompt(3, (state) => {
      state.pendingAction = {
        type: 'reopen_phase',
        targetPhase: 3,
        sourcePhase: 4,
        feedbackPaths: ['/tmp/phase-3-feedback.md'],
      };
    });
    expect(prompt).toMatch(/P1-only 정책/);
    expect(prompt).toMatch(/없으면[\s\S]*파일 끝[\s\S]*## Deferred/);
    expect(prompt).toMatch(/severity 라벨 누락/);
    expect(prompt).toMatch(/구조 변경[\s\S]*## Deferred/);
  });

  it('phase 5 — self-audit step present in Process', () => {
    const prompt = renderPrompt(5);
    expect(prompt).toMatch(/## Process[\s\S]*Pre-sentinel self-audit/);
  });

  it('phase 5 — self-audit pins baseCommit...HEAD from state.json and treats checklist commands as inspect-only', () => {
    const prompt = renderPrompt(5);
    expect(prompt).toMatch(/state\.json[\s\S]*baseCommit/);
    expect(prompt).toMatch(/baseCommit\.\.\.HEAD/);
    expect(prompt).toMatch(/inspect-only|실행 금지|실행하지 않음/);
  });

  it('phase 5 — self-audit reruns until clean before sentinel and degrades with WARN when baseCommit is empty', () => {
    const prompt = renderPrompt(5);
    expect(prompt).toMatch(/WARN: skip self-audit|empty baseCommit|빈 .*baseCommit/);
    expect(prompt).toMatch(/한 번 더 같은 검증을 반복|rerun/);
    expect(prompt).toMatch(/sentinel 쓰기 직전/);
  });

  it('phase 5 — self-audit escalates 해결 불가 findings to spec-bug or plan-bug Deferred entries', () => {
    const prompt = renderPrompt(5);
    expect(prompt).toMatch(/해결 불가/);
    expect(prompt).toMatch(/spec-bug:/);
    expect(prompt).toMatch(/plan-bug:/);
    expect(prompt).toMatch(/## Deferred/);
  });

  it('phase 5 — self-audit escalation names plan document target + missing-section fallback (R3a feedback-independent)', () => {
    const prompt = renderPrompt(5);
    expect(prompt).toMatch(/해결 불가[\s\S]{0,400}plan 문서 하단 `## Deferred`/);
    expect(prompt).toMatch(/plan 문서에 `## Deferred` 섹션이 없으면[\s\S]{0,200}파일 끝/);
    expect(prompt).toMatch(/feedback 블록과 독립적|첫 패스에서도 동일/);
  });

  it('phase 5 — triage block is absent without feedback_paths', () => {
    const prompt = renderPrompt(5);
    expect(prompt).not.toMatch(/P1-only 정책 · Phase 5 전용/);
  });

  it('phase 5 — triage block renders P1-only policy, P2 impl-only boundaries, and the spec/plan restructuring ban', () => {
    const prompt = renderPrompt(5, (state) => {
      state.pendingAction = {
        type: 'reopen_phase',
        targetPhase: 5,
        sourcePhase: 7,
        feedbackPaths: ['/tmp/phase-5-feedback-a.md', '/tmp/phase-5-feedback-b.md'],
      };
    });
    expect(prompt).toMatch(/P1-only 정책/);
    expect(prompt).toMatch(/Phase 5 전용/);
    expect(prompt).toMatch(/src\/, tests\/ 등 Phase 5 worktree 변경 범위/);
    expect(prompt).toMatch(/spec\/plan 재구조화/);
  });

  it('phase 5 — plan-bug handling is narrow and targeted rather than full plan restructuring', () => {
    const prompt = renderPrompt(5, (state) => {
      state.pendingAction = {
        type: 'reopen_phase',
        targetPhase: 5,
        sourcePhase: 7,
        feedbackPaths: ['/tmp/phase-5-feedback.md'],
      };
    });
    expect(prompt).toMatch(/plan-bug:/);
    expect(prompt).toMatch(/narrow, targeted 수정|단일 요소만 최소 수정/);
    expect(prompt).toMatch(/plan 전체 재구조화는 여전히 금지/);
  });

  it('phase 5 — duplicate issue identity is same file/area plus same requested change', () => {
    const prompt = renderPrompt(5, (state) => {
      state.pendingAction = {
        type: 'reopen_phase',
        targetPhase: 5,
        sourcePhase: 7,
        feedbackPaths: ['/tmp/phase-5-feedback.md'],
      };
    });
    expect(prompt).toMatch(/동일 파일\/영역 \+ 동일 요구 변경\(문구 차이 무관\)/);
  });

  it('phase 5 — R5a severity resolution renders highest-wins with same-severity dedup', () => {
    const prompt = renderPrompt(5, (state) => {
      state.pendingAction = {
        type: 'reopen_phase',
        targetPhase: 5,
        sourcePhase: 7,
        feedbackPaths: ['/tmp/phase-5-feedback.md'],
      };
    });
    expect(prompt).toMatch(/highest severity wins|highest severity/);
    expect(prompt).toMatch(/동일 severity면 한 번만 반영|same-severity/);
  });

  it('phase 5 — spec-bug and plan-bug tags are informational signals only', () => {
    const prompt = renderPrompt(5, (state) => {
      state.pendingAction = {
        type: 'reopen_phase',
        targetPhase: 5,
        sourcePhase: 7,
        feedbackPaths: ['/tmp/phase-5-feedback.md'],
      };
    });
    expect(prompt).toMatch(/informational signal/);
    expect(prompt).toMatch(/자동 완화는 없다|gate 자동 완화는 없다/);
  });
});

describe('cross-phase rendering guards', () => {
  it.each([1, 3, 5] as const)('phase %i — self-audit explains the 40× local grep rationale', (phase) => {
    const prompt = renderPrompt(phase);
    expect(prompt).toMatch(/40× local grep/);
  });

  it.each([1, 3, 5] as const)('phase %i — self-audit stays immediately before sentinel instructions', (phase) => {
    const prompt = renderPrompt(phase);
    expect(prompt).toMatch(/Pre-sentinel self-audit[\s\S]{0,600}sentinel/);
  });

  it.each([1, 3, 5] as const)('phase %i — triage text includes the missing-Deferred fallback', (phase) => {
    const prompt = renderPrompt(phase, (state) => {
      state.pendingAction = {
        type: 'reopen_phase',
        targetPhase: phase,
        sourcePhase: phase === 5 ? 7 : (phase + 1) as 2 | 4,
        feedbackPaths: [`/tmp/phase-${phase}-feedback-a.md`, `/tmp/phase-${phase}-feedback-b.md`],
      };
    });
    expect(prompt).toMatch(/없으면[\s\S]*파일 끝[\s\S]*## Deferred/);
  });

  it.each([1, 3] as const)('phase %i — only one feedback file is rendered in single-feedback phases', (phase) => {
    const prompt = renderPrompt(phase, (state) => {
      state.pendingAction = {
        type: 'reopen_phase',
        targetPhase: phase,
        sourcePhase: phase === 1 ? 2 : 4,
        feedbackPaths: [`/tmp/phase-${phase}-feedback-a.md`, `/tmp/phase-${phase}-feedback-b.md`],
      };
    });
    expect(prompt).toContain(`/tmp/phase-${phase}-feedback-a.md`);
    expect(prompt).not.toContain(`/tmp/phase-${phase}-feedback-b.md`);
  });

  it('phase 5 — carryoverFeedback missing files are dropped and valid feedback still renders triage', () => {
    const pendingPath = path.join(tmp, 'phase-5-pending.md');
    const validCarryoverPath = path.join(tmp, 'phase-5-carryover-valid.md');
    const missingCarryoverPath = path.join(tmp, 'phase-5-carryover-missing.md');
    fs.writeFileSync(pendingPath, 'pending');
    fs.writeFileSync(validCarryoverPath, 'carryover');

    const prompt = renderPrompt(5, (state) => {
      state.pendingAction = {
        type: 'reopen_phase',
        targetPhase: 5,
        sourcePhase: 7,
        feedbackPaths: [pendingPath],
      };
      state.carryoverFeedback = {
        sourceGate: 7,
        deliverToPhase: 5,
        paths: [missingCarryoverPath, validCarryoverPath],
      };
    });

    expect(prompt).toContain(pendingPath);
    expect(prompt).toContain(validCarryoverPath);
    expect(prompt).not.toContain(missingCarryoverPath);
    expect(prompt).toMatch(/P1-only 정책/);
  });
});

describe('prompt size and qa-integration guards', () => {
  it('phase 5 prompt (largest) stays well under a generous ceiling', () => {
    const state = stubState(tmp);
    const prompt = assembleInteractivePrompt(5, state, '/tmp/harness');
    // MAX_PROMPT_SIZE_KB is 64KB per config. Wrapper+vars+context must fit comfortably.
    expect(prompt.length).toBeLessThan(60 * 1024);
  });

  it('phase 1 wrapper enforces live-interaction ambiguity policy (no OQ stash)', () => {
    const state = stubState(tmp);
    const prompt = assembleInteractivePrompt(1, state, '/tmp/harness');
    // The old OQ requirement has been removed in favor of direct developer Q&A.
    expect(prompt).not.toMatch(/ALSO include '## Open Questions' section/);
    expect(prompt).not.toMatch(/Open Questions.*섹션 필수/);
    // Core ambiguity-policy wording surfaces in Context, Process override, and
    // Invariants — so the implementer sees the rule multiple times.
    expect(prompt).toMatch(/Ambiguity policy/);
    expect(prompt).toMatch(/사용자에게 직접 질문/);
    expect(prompt).toMatch(/asking the developer directly/);
    expect((prompt.match(/Ambiguity|ambiguit/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it('resume-smoke — pre-rev-3 state.json loads and re-renders under rev-3 wrapper without error (spec §11 force-rev-3 decision)', () => {
    // Simulate: a run that started pre-rev-3 is resumed. state.json has no wrapper-specific fields
    // (wrapper 구조는 phaseCodexSessions 같은 state 변경 없음 — spec §11 보장). 현 assembler가
    // 기존 state를 받아 new wrapper 템플릿으로 문제없이 렌더되는지 smoke-check.
    const legacyState = stubState(tmp);
    // 기존 run state는 artifact 경로에 .harness/<runId>/... 형태만 가짐 (스키마 v1 동일)
    legacyState.runId = 'legacy-run-id';
    legacyState.artifacts.spec = path.join('.harness', 'legacy-run-id', 'spec.md');
    legacyState.artifacts.plan = path.join('.harness', 'legacy-run-id', 'plan.md');
    legacyState.artifacts.decisionLog = path.join('.harness', 'legacy-run-id', 'decisions.md');
    legacyState.artifacts.checklist = path.join('.harness', 'legacy-run-id', 'checklist.json');
    legacyState.phaseAttemptId = { '1': 'legacy-a1', '3': 'legacy-a3', '5': 'legacy-a5' };

    for (const phase of [1, 3, 5] as const) {
      const prompt = assembleInteractivePrompt(phase, legacyState, '/tmp/harness');
      // 렌더 성공 + runId/attemptId/경로가 프롬프트에 올바르게 들어감
      expect(prompt.length).toBeGreaterThan(100);
      expect(prompt).toContain('legacy-run-id');
      expect(prompt).toContain(`legacy-a${phase}`);
      expect(prompt).not.toContain('{{runId}}');
      expect(prompt).not.toContain('{{phaseAttemptId}}');
    }
  });
});
