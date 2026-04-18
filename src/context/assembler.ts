import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import type { HarnessState } from '../types.js';
import {
  MAX_FILE_SIZE_KB,
  MAX_PROMPT_SIZE_KB,
  MAX_DIFF_SIZE_KB,
  PER_FILE_DIFF_LIMIT_KB,
} from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Shared reviewer contract — common preamble across all gates (2, 4, 7).
 * Per-gate 5-axis rubric is appended via REVIEWER_CONTRACT_BY_GATE below.
 */
const REVIEWER_CONTRACT_BASE = `You are an independent technical reviewer. Review the provided documents and return a structured verdict.
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
`;

const FIVE_AXIS_SPEC_GATE = `
## Five-Axis Evaluation (Phase 2 — spec gate)
평가 대상은 spec 문서다. 다음 축만 적용:
1. Correctness — 요구사항/비요구사항/경계조건/성공기준이 명시되었는가?
2. Readability — 섹션 구성이 명확하고 모호 표현이 없는가?
3. Scope — 단일 구현 plan으로 분해 가능한 크기인가? 여러 독립 프로젝트 섞이지 않음?

Additional required check: spec MUST contain an explicit '## Open Questions' section. Missing/empty-without-rationale → P1.
`;

const FIVE_AXIS_PLAN_GATE = `
## Five-Axis Evaluation (Phase 4 — plan gate)
평가 대상은 plan + spec이다.
1. Correctness — plan이 spec의 모든 요구사항을 커버?
2. Architecture — 태스크 분해가 수직 슬라이스이고 의존성 순서가 명확?
3. Testability — 각 태스크에 수용 기준과 검증 절차 있음?
4. Readability — 맥락 없이 태스크 하나만 집어도 수행 가능?
`;

const FIVE_AXIS_EVAL_GATE = `
## Five-Axis Evaluation (Phase 7 — eval gate)
평가 대상은 spec + plan + eval report + diff. 5축 전부:
1. Correctness — 구현이 spec+plan과 일치? 경계조건·테스트 커버리지?
2. Readability — 이름/흐름/로컬 복잡도 적절?
3. Architecture — 기존 패턴 부합, 경계 선명, 조기 추상화 없음?
4. Security — 경계 입력 검증, 비밀 노출, 인증 경로?
5. Performance — N+1, 무한 루프, 핫패스 회귀?
Severity: P0/P1=Critical(블록), P2=Important, P3=Suggestion.
`;

const REVIEWER_CONTRACT_BY_GATE: Record<2 | 4 | 7, string> = {
  2: REVIEWER_CONTRACT_BASE + FIVE_AXIS_SPEC_GATE,
  4: REVIEWER_CONTRACT_BASE + FIVE_AXIS_PLAN_GATE,
  7: REVIEWER_CONTRACT_BASE + FIVE_AXIS_EVAL_GATE,
};

function readTemplateFile(filename: string): string {
  const templatePath = path.join(__dirname, 'prompts', filename);
  return fs.readFileSync(templatePath, 'utf-8');
}

function renderTemplate(template: string, vars: Record<string, string | undefined>): string {
  // Handle {{#if variable}}...{{/if}} blocks
  let result = template.replace(
    /\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match: string, varName: string, block: string): string => {
      const value = vars[varName];
      if (!value) return '';
      return block.replace(/\{\{(\w+)\}\}/g, (_m: string, k: string): string => vars[k] ?? '');
    }
  );
  // Handle plain {{variable}} substitutions
  result = result.replace(/\{\{(\w+)\}\}/g, (_match: string, k: string): string => vars[k] ?? '');
  return result;
}

function checkFileSize(absPath: string): { error: string } | null {
  try {
    const stat = fs.statSync(absPath);
    if (stat.size > MAX_FILE_SIZE_KB * 1024) {
      return {
        error: `Gate input too large: ${absPath} (${Math.round(stat.size / 1024)}KB > ${MAX_FILE_SIZE_KB}KB limit)`,
      };
    }
  } catch {
    // File doesn't exist — not a size error
  }
  return null;
}

function resolveArtifactPath(filePath: string, cwd: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
}

function readArtifactContent(filePath: string, cwd: string): { content: string } | { error: string } {
  const absPath = resolveArtifactPath(filePath, cwd);
  const sizeError = checkFileSize(absPath);
  if (sizeError) return sizeError;
  try {
    return { content: fs.readFileSync(absPath, 'utf-8') };
  } catch {
    return { content: `(file not found: ${filePath})` };
  }
}

function truncateDiffPerFile(diff: string, perFileLimitBytes: number): string {
  const fileChunks = diff.split(/(?=^diff --git )/m);
  return fileChunks
    .map((chunk) => {
      if (chunk.length <= perFileLimitBytes) return chunk;
      const truncated = chunk.slice(0, perFileLimitBytes);
      const origBytes = chunk.length;
      return truncated + `\n--- (truncated: ${origBytes} bytes)\n`;
    })
    .join('');
}

function runGit(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8' });
  } catch {
    return '';
  }
}

// ─── Gate 2: Spec review ─────────────────────────────────────────────────────

function buildGatePromptPhase2(state: HarnessState, cwd: string): string | { error: string } {
  const specResult = readArtifactContent(state.artifacts.spec, cwd);
  if ('error' in specResult) return specResult;

  return (
    REVIEWER_CONTRACT_BY_GATE[2] +
    `\n<spec>\n${specResult.content}\n</spec>\n`
  );
}

// ─── Gate 4: Plan review (spec + plan, per spec) ─────────────────────────────

function buildGatePromptPhase4(state: HarnessState, cwd: string): string | { error: string } {
  const specResult = readArtifactContent(state.artifacts.spec, cwd);
  if ('error' in specResult) return specResult;

  const planResult = readArtifactContent(state.artifacts.plan, cwd);
  if ('error' in planResult) return planResult;

  return (
    REVIEWER_CONTRACT_BY_GATE[4] +
    `\n<spec>\n${specResult.content}\n</spec>\n\n` +
    `<plan>\n${planResult.content}\n</plan>\n`
  );
}

// ─── Gate 7: Eval review (spec + plan + eval report + diff + metadata) ───────

// §4.3/§4.4: shared Phase 7 diff + metadata builder. Used by both the fresh
// prompt and the resume prompt so resume variants include the same external-
// commit handling and metadata block as the first-time review.
function buildPhase7DiffAndMetadata(state: HarnessState, cwd: string): { diffSection: string; externalSummary: string; metadata: string } {
  let diffSection: string;
  let externalSummary = '';

  if (state.externalCommitsDetected) {
    let primary = '';
    if (state.implCommit !== null) {
      primary += runGit(`git diff ${state.baseCommit}...${state.implCommit}`, cwd);
      if (state.evalCommit !== null) {
        primary += '\n' + runGit(`git diff ${state.evalCommit}^..${state.evalCommit}`, cwd);
      }
    } else {
      const target = state.evalCommit ?? 'HEAD';
      primary = runGit(`git diff ${state.baseCommit}...${target}`, cwd);
      primary =
        `⚠️ IMPORTANT: Phase 5 was skipped and external commits were detected. ` +
        `The primary diff below includes BOTH harness and external changes — they cannot be separated. ` +
        `Focus on the eval report and spec/plan compliance rather than the diff.\n\n` +
        primary;
    }

    const maxDiffBytes = MAX_DIFF_SIZE_KB * 1024;
    if (primary.length > maxDiffBytes) {
      primary = truncateDiffPerFile(primary, PER_FILE_DIFF_LIMIT_KB * 1024);
    }

    diffSection = `<diff>\n${primary}\n</diff>\n`;

    const anchor = state.evalCommit ?? state.implCommit ?? state.baseCommit;
    const externalLog = runGit(`git log ${anchor}..HEAD --oneline`, cwd);
    if (externalLog.trim().length > 0) {
      externalSummary = `\n## External Commits (not reviewed)\n\n\`\`\`\n${externalLog}\n\`\`\`\n`;
    }
  } else {
    let diff = runGit(`git diff ${state.baseCommit}...HEAD`, cwd);
    const maxDiffBytes = MAX_DIFF_SIZE_KB * 1024;
    if (diff.length > maxDiffBytes) {
      diff = truncateDiffPerFile(diff, PER_FILE_DIFF_LIMIT_KB * 1024);
    }
    diffSection = diff ? `<diff>\n${diff}\n</diff>\n` : '';
  }

  const externalNote = state.externalCommitsDetected
    ? `Note: External commits detected. See '## External Commits (not reviewed)' section below.\nPrimary diff covers harness implementation range only.\n`
    : '';
  const implRange =
    state.implCommit !== null
      ? `Harness implementation range: ${state.baseCommit}..${state.implCommit} (Phase 1–5 commits).`
      : `Phase 5 skipped; no implementation commit anchor.`;

  const metadata =
    `<metadata>\n${externalNote}${implRange}\n` +
    `Harness eval report commit: ${state.evalCommit ?? '(none)'} (the commit that last modified the eval report).\n` +
    `Verified at HEAD: ${state.verifiedAtHead ?? '(none)'} (most recent Phase 6 run).\n` +
    `Focus review on changes within the harness ranges above.\n` +
    `</metadata>\n`;

  return { diffSection, externalSummary, metadata };
}

function buildGatePromptPhase7(state: HarnessState, cwd: string): string | { error: string } {
  const specResult = readArtifactContent(state.artifacts.spec, cwd);
  if ('error' in specResult) return specResult;

  const planResult = readArtifactContent(state.artifacts.plan, cwd);
  if ('error' in planResult) return planResult;

  const evalResult = readArtifactContent(state.artifacts.evalReport, cwd);
  if ('error' in evalResult) return evalResult;

  const { diffSection, externalSummary, metadata } = buildPhase7DiffAndMetadata(state, cwd);

  return (
    REVIEWER_CONTRACT_BY_GATE[7] +
    `\n<spec>\n${specResult.content}\n</spec>\n\n` +
    `<plan>\n${planResult.content}\n</plan>\n\n` +
    `<eval_report>\n${evalResult.content}\n</eval_report>\n\n` +
    diffSection +
    externalSummary +
    '\n' +
    metadata
  );
}

// ─── Interactive prompt assembly ──────────────────────────────────────────────

/**
 * Assemble initial prompt for interactive phases (1, 3, 5).
 * Per spec: task.md path (not raw task string) is passed to Phase 1;
 * Phase 5 supports multiple feedback paths (gate-7-feedback + verify-feedback).
 */
export function assembleInteractivePrompt(
  phase: 1 | 3 | 5,
  state: HarnessState,
  harnessDir: string
): string {
  const templateFile = `phase-${phase}.md`;
  const template = readTemplateFile(templateFile);
  const phaseAttemptId = state.phaseAttemptId[String(phase)] ?? '';

  // Phase 1 uses task.md file path (not raw task string) per spec
  const taskMdPath = path.join('.harness', state.runId, 'task.md');

  // feedback_path: first feedback from pendingAction, if any
  // feedback_paths: all feedbacks (Phase 5 may have both gate-7 + verify)
  const feedbackPaths = state.pendingAction?.feedbackPaths ?? [];
  const feedbackPath = feedbackPaths[0];
  const feedbackPathsList = feedbackPaths
    .map((p) => `- 이전 피드백 (반드시 반영): ${p}`)
    .join('\n');

  const vars: Record<string, string | undefined> = {
    task_path: taskMdPath,
    spec_path: state.artifacts.spec,
    decisions_path: state.artifacts.decisionLog,
    plan_path: state.artifacts.plan,
    checklist_path: state.artifacts.checklist,
    runId: state.runId,
    phaseAttemptId,
    feedback_path: feedbackPath,
    feedback_paths: feedbackPathsList.length > 0 ? feedbackPathsList : undefined,
    harnessDir,
  };

  return renderTemplate(template, vars);
}

export function assembleGatePrompt(
  phase: 2 | 4 | 7,
  state: HarnessState,
  harnessDir: string,
  cwd: string
): string | { error: string } {
  void harnessDir;

  let result: string | { error: string };

  if (phase === 2) {
    result = buildGatePromptPhase2(state, cwd);
  } else if (phase === 4) {
    result = buildGatePromptPhase4(state, cwd);
  } else {
    result = buildGatePromptPhase7(state, cwd);
  }

  if (typeof result === 'string' && result.length > MAX_PROMPT_SIZE_KB * 1024) {
    return {
      error: `Assembled gate prompt too large: ${Math.round(result.length / 1024)}KB > ${MAX_PROMPT_SIZE_KB}KB limit`,
    };
  }

  return result;
}

// ─── Gate resume prompts (spec §4.3) ─────────────────────────────────────────
//
// Strategy C: resume prompts do NOT include REVIEWER_CONTRACT (already in session).
// Artifacts are resent fresh each time (updates between retries). Two variants:
//   A) lastOutcome='reject' + previousFeedback: "artifacts updated + previous feedback"
//   B) lastOutcome='error'/'approve': "continue review" without feedback block

function buildResumeSections(
  phase: 2 | 4 | 7,
  state: HarnessState,
  cwd: string,
): string | { error: string } {
  const specResult = readArtifactContent(state.artifacts.spec, cwd);
  if ('error' in specResult) return specResult;
  let body = `<spec>\n${specResult.content}\n</spec>\n`;

  if (phase === 4 || phase === 7) {
    const planResult = readArtifactContent(state.artifacts.plan, cwd);
    if ('error' in planResult) return planResult;
    body += `\n<plan>\n${planResult.content}\n</plan>\n`;
  }
  if (phase === 7) {
    const evalResult = readArtifactContent(state.artifacts.evalReport, cwd);
    if ('error' in evalResult) return evalResult;
    body += `\n<eval_report>\n${evalResult.content}\n</eval_report>\n`;

    // §4.3: Phase 7 resume prompt must include the same diff + external summary
    // + metadata block as the fresh Phase 7 prompt (external-commit-aware).
    // Reuse the shared builder so the two paths never drift.
    const { diffSection, externalSummary, metadata } = buildPhase7DiffAndMetadata(state, cwd);
    body += `\n${diffSection}${externalSummary}\n${metadata}`;
  }
  return body;
}

export function assembleGateResumePrompt(
  phase: 2 | 4 | 7,
  state: HarnessState,
  cwd: string,
  lastOutcome: 'approve' | 'reject' | 'error',
  previousFeedback: string,
): string | { error: string } {
  const sections = buildResumeSections(phase, state, cwd);
  if (typeof sections !== 'string') return sections;

  // §4.3: resume-prompt instruction blocks restate the structured output contract
  // and, for Variant A, the "prior concerns addressed" check + "APPROVE only if
  // zero P0/P1 findings" approval rule. REVIEWER_CONTRACT itself is already in the
  // session, so we do not re-include it — only the per-turn instruction tail.
  const structuredOutputReminder =
    'Respond with the same structured sections as before:\n' +
    '- `## Verdict` (exactly `APPROVE` or `REJECT`)\n' +
    '- `## Comments` (each finding labeled `[P0|P1|P2|P3]`, with Location/Issue/Suggestion/Evidence)\n' +
    '- `## Summary` (1–2 sentences)\n' +
    'Approval rule: `APPROVE` only if there are zero P0 and zero P1 findings.\n';

  let prompt: string;
  // §4.4: variant is driven by lastOutcome, not by whether feedback exists.
  // If lastOutcome='reject' but feedback file was missing/unreadable, the caller
  // should still pass a placeholder string so Variant A is selected.
  if (lastOutcome === 'reject') {
    const feedbackBlock = previousFeedback.trim().length > 0
      ? previousFeedback
      : '(feedback file missing despite lastOutcome=reject — spec anomaly)';
    prompt =
      '## Updated Artifacts (Re-Review Requested)\n\n' +
      'The artifacts have been updated based on your previous feedback. Re-review the new versions and verify your prior concerns were addressed.\n\n' +
      sections +
      '\n## Your Previous Feedback (for reference)\n\n' +
      feedbackBlock + '\n\n' +
      '## Instructions\n\n' +
      'Verify that each P0/P1 concern from your previous feedback has been addressed in the updated artifacts. ' +
      'Raise any new issues you discover. If prior concerns remain unresolved, keep the matching severity labels.\n\n' +
      structuredOutputReminder;
  } else {
    // Variant B for 'approve' | 'error'
    prompt =
      '## Continue Review\n\n' +
      'The previous review turn did not complete with a verdict. Re-examine the current artifacts and emit a verdict now.\n\n' +
      sections +
      '\n## Instructions\n\n' +
      structuredOutputReminder;
  }

  if (prompt.length > MAX_PROMPT_SIZE_KB * 1024) {
    return {
      error: `Assembled resume prompt too large: ${Math.round(prompt.length / 1024)}KB > ${MAX_PROMPT_SIZE_KB}KB limit`,
    };
  }
  return prompt;
}
