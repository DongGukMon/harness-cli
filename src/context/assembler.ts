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

const REVIEWER_CONTRACT = `## 리뷰어 계약

당신은 독립적인 게이트 리뷰어다. 다음 규칙을 반드시 따르라:

1. 최종 판정은 반드시 \`APPROVE\` 또는 \`REJECT\` 중 하나여야 한다.
2. 판정은 응답의 마지막 줄에 단독으로 위치해야 한다 (예: \`APPROVE\` 또는 \`REJECT\`).
3. 모든 코멘트는 구체적인 위치(파일명, 섹션, 줄 번호 등)를 인용해야 한다.
4. 모호한 일반론이나 위치 없는 지적은 허용되지 않는다. Every comment must cite a specific location.

### 응답 형식

\`\`\`
## 리뷰 요약
<전반적 평가>

## 상세 코멘트
- [파일/섹션/위치]: <코멘트>

## 판정
APPROVE | REJECT
\`\`\`
`;

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
      // Substitute variables inside the block
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
    return { content: `(파일 없음: ${filePath})` };
  }
}

function truncateDiffPerFile(diff: string, perFileLimitBytes: number): string {
  // Split diff into per-file chunks (keep the leading "diff --git" line with each chunk)
  const fileChunks = diff.split(/(?=^diff --git )/m);
  return fileChunks
    .map((chunk) => {
      if (chunk.length <= perFileLimitBytes) return chunk;
      return chunk.slice(0, perFileLimitBytes) + '\n... [diff truncated]\n';
    })
    .join('');
}

function buildGatePromptPhase2(state: HarnessState, cwd: string): string | { error: string } {
  const specResult = readArtifactContent(state.artifacts.spec, cwd);
  if ('error' in specResult) return specResult;

  return (
    `# Gate 2: Spec Review\n\n` +
    REVIEWER_CONTRACT +
    `\n## 검토 대상: 설계 스펙\n\n` +
    `경로: ${state.artifacts.spec}\n\n` +
    `\`\`\`\n${specResult.content}\n\`\`\`\n`
  );
}

function buildGatePromptPhase4(state: HarnessState, cwd: string): string | { error: string } {
  const planResult = readArtifactContent(state.artifacts.plan, cwd);
  if ('error' in planResult) return planResult;

  const checklistResult = readArtifactContent(state.artifacts.checklist, cwd);
  if ('error' in checklistResult) return checklistResult;

  return (
    `# Gate 4: Plan Review\n\n` +
    REVIEWER_CONTRACT +
    `\n## 검토 대상: 구현 계획\n\n` +
    `경로: ${state.artifacts.plan}\n\n` +
    `\`\`\`\n${planResult.content}\n\`\`\`\n\n` +
    `## 검토 대상: 평가 체크리스트\n\n` +
    `경로: ${state.artifacts.checklist}\n\n` +
    `\`\`\`\n${checklistResult.content}\n\`\`\`\n`
  );
}

function buildGatePromptPhase7(state: HarnessState, cwd: string): string | { error: string } {
  const evalResult = readArtifactContent(state.artifacts.evalReport, cwd);
  if ('error' in evalResult) return evalResult;

  // Build diff section
  let diffSection: string;
  if (state.externalCommitsDetected) {
    diffSection =
      `## 외부 커밋 감지\n\n` +
      `외부 커밋이 감지되어 diff를 자동으로 포함할 수 없습니다.\n` +
      `구현 커밋 기준점: ${state.implCommit ?? '(없음)'}\n`;
  } else {
    const baseRef = state.implRetryBase ?? state.baseCommit;
    let rawDiff = '';
    try {
      rawDiff = execSync(`git diff ${baseRef}..HEAD`, { cwd, encoding: 'utf-8' });
    } catch {
      rawDiff = '';
    }

    const maxDiffBytes = MAX_DIFF_SIZE_KB * 1024;
    const perFileBytes = PER_FILE_DIFF_LIMIT_KB * 1024;

    if (rawDiff.length > maxDiffBytes) {
      rawDiff = truncateDiffPerFile(rawDiff, perFileBytes);
    }

    diffSection = rawDiff
      ? `## 구현 Diff\n\n\`\`\`diff\n${rawDiff}\n\`\`\`\n`
      : `## 구현 Diff\n\n(diff를 가져올 수 없습니다)\n`;
  }

  const metadata =
    `## 메타데이터\n\n` +
    `- runId: ${state.runId}\n` +
    `- baseCommit: ${state.baseCommit}\n` +
    `- implRetryBase: ${state.implRetryBase}\n` +
    `- implCommit: ${state.implCommit ?? '(없음)'}\n` +
    `- externalCommitsDetected: ${state.externalCommitsDetected}\n`;

  return (
    `# Gate 7: Eval Review\n\n` +
    REVIEWER_CONTRACT +
    `\n## 검토 대상: 평가 리포트\n\n` +
    `경로: ${state.artifacts.evalReport}\n\n` +
    `\`\`\`\n${evalResult.content}\n\`\`\`\n\n` +
    diffSection +
    `\n` +
    metadata
  );
}

/**
 * Assemble initial prompt for interactive phases (1, 3, 5).
 * Reads template, substitutes variables, returns prompt string.
 */
export function assembleInteractivePrompt(
  phase: 1 | 3 | 5,
  state: HarnessState,
  harnessDir: string
): string {
  const templateFile = `phase-${phase}.md`;
  const template = readTemplateFile(templateFile);

  const feedbackPath = state.pendingAction?.feedbackPaths[0];
  const phaseAttemptId = state.phaseAttemptId[String(phase)] ?? '';

  const vars: Record<string, string | undefined> = {
    task_path: state.task,
    spec_path: state.artifacts.spec,
    decisions_path: state.artifacts.decisionLog,
    plan_path: state.artifacts.plan,
    checklist_path: state.artifacts.checklist,
    runId: state.runId,
    phaseAttemptId,
    feedback_path: feedbackPath,
    harnessDir,
  };

  return renderTemplate(template, vars);
}

/**
 * Assemble gate prompt (2, 4, 7). Reads files inline, applies size limits.
 * Returns prompt string or error object for size-limit violations.
 */
export function assembleGatePrompt(
  phase: 2 | 4 | 7,
  state: HarnessState,
  harnessDir: string,
  cwd: string
): string | { error: string } {
  void harnessDir; // reserved for future use

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
