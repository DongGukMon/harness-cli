import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import type { HarnessState, FlowMode, TrackedRepo } from '../types.js';
import { resolveArtifact } from '../artifact.js';
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

Scope tagging (REJECT only) — REJECT verdict 에는 \`Scope: design | impl | mixed\` 한 줄을 반드시 포함한다.
  - design: spec/plan 재구조화 가 필요한 이슈 (요구사항 오해, 아키텍처 결함, 누락된 비요구사항).
  - impl: 구현 단계 에서 해결 가능한 이슈 (tests, naming, edge cases, dead code, 컴파일/테스트 실패).
  - mixed: 양쪽 모두 손대야 하는 이슈.
APPROVE 일 때는 Scope 라인을 생략한다.
이 규약은 Phase 7 eval gate 에서만 dispatch 에 영향을 준다 (다른 gate 는 무시).

Scope rules:
- Review ONLY the artifacts provided in this prompt (e.g. <spec>, <plan>, <eval_report>, <diff>).
- Do NOT apply personal or workspace-level conventions (commit-message formats, naming rules, protocols) unless they are explicitly cited in the provided artifacts.
- Do NOT flag artifacts that are outside this phase's scope as "missing" — later harness phases produce plan/impl/eval artifacts.
`;

const FIVE_AXIS_SPEC_GATE = `
## Five-Axis Evaluation (Phase 2 — spec gate)
평가 대상은 spec 문서다. 다음 축만 적용:
1. Correctness — 요구사항/비요구사항/경계조건/성공기준이 명시되었는가?
2. Readability — 섹션 구성이 명확하고 모호 표현이 없는가?
3. Scope — 단일 구현 plan으로 분해 가능한 크기인가? 여러 독립 프로젝트 섞이지 않음?

Note: Phase 1 resolves design ambiguities live with the developer. Do not penalize for missing "Open Questions" / "TODO" / deferred-items sections — those are intentionally absent.
`;

const FIVE_AXIS_PLAN_GATE = `
## Five-Axis Evaluation (Phase 4 — plan gate)
평가 대상은 plan + spec이다.
1. Correctness — plan이 spec의 모든 요구사항을 커버?
2. Architecture — 태스크 분해가 수직 슬라이스이고 의존성 순서가 명확?
3. Testability — 각 태스크에 수용 기준과 검증 절차 있음?
4. Readability — 맥락 없이 태스크 하나만 집어도 수행 가능?
`;

const FIVE_AXIS_EVAL_GATE_FULL = `
## Five-Axis Evaluation (Phase 7 — eval gate)
평가 대상은 spec + plan + eval report + diff. 5축 전부:
1. Correctness — 구현이 spec+plan과 일치? 경계조건·테스트 커버리지?
2. Readability — 이름/흐름/로컬 복잡도 적절?
3. Architecture — 기존 패턴 부합, 경계 선명, 조기 추상화 없음?
4. Security — 경계 입력 검증, 비밀 노출, 인증 경로?
5. Performance — N+1, 무한 루프, 핫패스 회귀?
Severity: P0/P1=Critical(블록), P2=Important, P3=Suggestion.
`;

const FIVE_AXIS_EVAL_GATE_LIGHT = `
## Five-Axis Evaluation (Phase 7 — eval gate, light flow)
평가 대상은 **결합 design spec** (spec + Implementation Plan 섹션이 한 문서에 있음) + eval report + diff. 5축 전부:
1. Correctness — 구현이 결합 spec의 Implementation Plan 섹션과 일치? 경계조건·테스트 커버리지?
2. Readability — 이름/흐름/로컬 복잡도 적절?
3. Architecture — 기존 패턴 부합, 경계 선명, 조기 추상화 없음?
4. Security — 경계 입력 검증, 비밀 노출, 인증 경로?
5. Performance — N+1, 무한 루프, 핫패스 회귀?
Severity: P0/P1=Critical(블록), P2=Important, P3=Suggestion.
Note: 이 플로우에는 별도의 plan 아티팩트가 없다. plan 부재를 finding으로 올리지 말 것.
`;

const FIVE_AXIS_DESIGN_GATE_LIGHT = `
## Five-Axis Evaluation (Phase 2 — design gate, light flow)
평가 대상은 결합 design spec (spec + Implementation Plan 섹션이 한 문서에 있음). 4축 적용:
1. Correctness — 요구사항/비요구사항/경계조건/성공기준 명시; plan 섹션이 spec 요구사항을 커버?
2. Architecture — 태스크 분해가 수직 슬라이스이고 의존성 순서가 명확?
3. Readability — 섹션 구성이 명확하고 모호 표현이 없는가?
4. Scope — 단일 구현 세션으로 분해 가능한 크기? 여러 독립 프로젝트 섞이지 않음?

Note: Phase 1 resolves design ambiguities live with the developer. Do not penalize for missing "Open Questions" / "TODO" / deferred-items sections — those are intentionally absent.
Note: light flow에는 별도 plan 아티팩트가 없다. plan 파일 부재를 finding으로 올리지 말 것. 구현(Phase 5) 아직 수행되지 않음 — 구현 관련 이슈는 Phase 7에서 다룬다.
`;

function reviewerContractForGate7(flow: FlowMode): string {
  return REVIEWER_CONTRACT_BASE + (flow === 'light' ? FIVE_AXIS_EVAL_GATE_LIGHT : FIVE_AXIS_EVAL_GATE_FULL);
}

const REVIEWER_CONTRACT_BY_GATE: Record<2 | 4, string> = {
  2: REVIEWER_CONTRACT_BASE + FIVE_AXIS_SPEC_GATE,
  4: REVIEWER_CONTRACT_BASE + FIVE_AXIS_PLAN_GATE,
};

// ─── Complexity signal (spec R2/R3) ──────────────────────────────────────────
//
// Phase 1 spec must contain a `## Complexity` section whose first non-blank
// body line is Small/Medium/Large (case-insensitive). Phase 3 assembler parses
// this and injects a per-bucket directive into the plan-writing prompt.
// Medium / parse-failure paths are empty-string fallbacks (preserve today's
// behavior). Parse failure emits exactly one stderr warn per process.

let complexityWarningEmitted = false;

export function __resetComplexityWarning(): void {
  complexityWarningEmitted = false;
}

export function parseComplexitySignal(
  specText: string,
): 'small' | 'medium' | 'large' | null {
  // Spec Goal 1: "Phase 1 spec must contain exactly one `## Complexity`
  // section." Duplicate headers are rejected (author error) — not silently
  // reduced to the first one.
  const allHeaders = specText.match(/^##\s+Complexity\s*$/gm);
  if (!allHeaders || allHeaders.length !== 1) return null;
  const headerMatch = specText.match(/^##\s+Complexity\s*$/m);
  if (!headerMatch) return null;
  const offset = (headerMatch.index ?? 0) + headerMatch[0].length;
  const remainder = specText.slice(offset);
  const lines = remainder.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '') continue;
    const tokenMatch = line.match(/^(small|medium|large)\b/i);
    return tokenMatch
      ? (tokenMatch[1].toLowerCase() as 'small' | 'medium' | 'large')
      : null;
  }
  return null;
}

const SMALL_DIRECTIVE =
  '<complexity_directive>\n' +
  'This task is classified **Small**. Keep the plan to **at most 3 tasks**. ' +
  'Do not emit per-function pseudocode or ASCII diagrams. Prefer bundling related edits in one task over splitting them. ' +
  'Keep `checklist.json` to at most 4 `checks` entries — typecheck + test + build is usually enough.\n' +
  '</complexity_directive>\n';

const LARGE_DIRECTIVE =
  '<complexity_directive>\n' +
  'This task is classified **Large**. Decompose into clear vertical slices with explicit dependency order. ' +
  'Capture architecturally-relevant decisions as short ADR blurbs inline in the plan. Standard depth otherwise.\n' +
  '</complexity_directive>\n';

export function buildComplexityDirective(
  level: 'small' | 'medium' | 'large' | null,
): string {
  if (level === 'small') return SMALL_DIRECTIVE;
  if (level === 'large') return LARGE_DIRECTIVE;
  if (level === 'medium') return '';
  if (!complexityWarningEmitted) {
    process.stderr.write(
      '⚠️  Complexity signal missing or invalid in spec; defaulting to Medium.\n',
    );
    complexityWarningEmitted = true;
  }
  return '';
}

function readTemplateFile(filename: string): string {
  const templatePath = path.join(__dirname, 'prompts', filename);
  return fs.readFileSync(templatePath, 'utf-8');
}

const WRAPPER_SKILL_BY_PHASE: Record<1 | 3 | 5, string> = {
  1: 'harness-phase-1-spec.md',
  3: 'harness-phase-3-plan.md',
  5: 'harness-phase-5-implement.md',
};

// Strip YAML frontmatter (--- ... ---) so the wrapper body can be inlined
// directly into the phase template without duplicating the metadata header.
function readWrapperSkill(phase: 1 | 3 | 5): string {
  const skillPath = path.join(__dirname, 'skills', WRAPPER_SKILL_BY_PHASE[phase]);
  const raw = fs.readFileSync(skillPath, 'utf-8');
  return raw.replace(/^---\n[\s\S]*?\n---\n?/, '');
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

// ─── Lifecycle context ──────────────────────────────────────────────────────
//
// Each gate sees a phase-specific stanza so the reviewer understands which
// later-phase artifacts do not yet exist. Keeps BUG-A from recurring: gates
// used to flag "plan file missing" at Gate 2 even though plan = Phase 3.

function buildLifecycleContext(phase: 2 | 4 | 7, flow: FlowMode = 'full'): string {
  if (phase === 2) {
    if (flow === 'light') {
      return (
        '<harness_lifecycle>\n' +
        'This is Gate 2 of a 5-phase light harness lifecycle (P1 design → P2 pre-impl review → P5 impl → P6 verify → P7 eval). ' +
        'The combined design spec contains the Implementation Plan section; there is no separate plan artifact. ' +
        'Implementation has not yet been produced.\n' +
        '</harness_lifecycle>\n\n'
      );
    }
    return (
      '<harness_lifecycle>\n' +
      'This is Gate 2 of a 7-phase harness lifecycle. You are reviewing ONLY the <spec> artifact. ' +
      'The implementation plan (Phase 3), the implementation itself (Phase 5), and the eval report (Phase 7) ' +
      'have not yet been produced; their absence must NOT appear as a finding.\n' +
      '</harness_lifecycle>\n\n'
    );
  }
  if (phase === 4) {
    return (
      '<harness_lifecycle>\n' +
      'This is Gate 4 of a 7-phase harness lifecycle. You are reviewing the <spec> and <plan>. ' +
      'The implementation (Phase 5) has not yet been produced; its absence must NOT appear as a finding.\n' +
      '</harness_lifecycle>\n\n'
    );
  }
  // phase === 7
  if (flow === 'light') {
    return (
      '<harness_lifecycle>\n' +
      'This is Gate 7 of a 5-phase light harness lifecycle (P1 design → P2 pre-impl review → P5 impl → P6 verify → P7 eval). ' +
      'The combined design spec contains the Implementation Plan section; there is no separate plan artifact. ' +
      'This is the terminal review — if APPROVE, the run is complete.\n' +
      '</harness_lifecycle>\n\n'
    );
  }
  return (
    '<harness_lifecycle>\n' +
    'This is Gate 7 of a 7-phase harness lifecycle. Spec, plan, implementation diff, and eval report are all provided. ' +
    'This is the terminal review — if APPROVE, the run is complete.\n' +
    '</harness_lifecycle>\n\n'
  );
}

// ─── Gate Output Protocol block (R3) ─────────────────────────────────────────
//
// Injected at the END of every gate prompt (fresh and resume). Instructs Codex
// to write the verdict file and sentinel file after producing its verdict.
// The harness waits for the sentinel to know the gate run is complete.

function buildGateOutputProtocol(
  phase: 2 | 4 | 7,
  runDir: string,
  attemptId: string,
): string {
  const verdictFile = path.join(runDir, `gate-${phase}-verdict.md`);
  const sentinelFile = path.join(runDir, `phase-${phase}.done`);
  return (
    '\n\n---\n\n' +
    '## Output Protocol (REQUIRED — do not skip)\n\n' +
    'After producing your verdict, you MUST perform these two file writes in order:\n\n' +
    `1. Write your full verdict response (the \`## Verdict\`, \`## Comments\`, \`## Summary\` sections) to:\n   \`${verdictFile}\`\n\n` +
    `2. Write exactly this text to:\n   \`${sentinelFile}\`\n\n` +
    `   Content: \`${attemptId}\`\n\n` +
    'Use your file-write tool (apply_patch, write_file, or equivalent) for both writes.\n' +
    'Do NOT omit either write — the harness waits for the sentinel file to know you are done.\n'
  );
}

// ─── Gate 2: Spec review ─────────────────────────────────────────────────────

function buildGatePromptPhase2(state: HarnessState, cwd: string): string | { error: string } {
  const docsRoot = state.trackedRepos?.[0]?.path || cwd;
  const specResult = readArtifactContent(state.artifacts.spec, docsRoot);
  if ('error' in specResult) return specResult;

  if (state.flow === 'light') {
    return (
      REVIEWER_CONTRACT_BASE + FIVE_AXIS_DESIGN_GATE_LIGHT +
      buildLifecycleContext(2, 'light') +
      `<spec>\n${specResult.content}\n</spec>\n`
    );
  }

  return (
    REVIEWER_CONTRACT_BY_GATE[2] +
    buildLifecycleContext(2) +
    `<spec>\n${specResult.content}\n</spec>\n`
  );
}

// ─── Gate 4: Plan review (spec + plan, per spec) ─────────────────────────────

function buildGatePromptPhase4(state: HarnessState, cwd: string): string | { error: string } {
  const docsRoot = state.trackedRepos?.[0]?.path || cwd;
  const specResult = readArtifactContent(state.artifacts.spec, docsRoot);
  if ('error' in specResult) return specResult;

  const planResult = readArtifactContent(state.artifacts.plan, docsRoot);
  if ('error' in planResult) return planResult;

  return (
    REVIEWER_CONTRACT_BY_GATE[4] +
    buildLifecycleContext(4) +
    `<spec>\n${specResult.content}\n</spec>\n\n` +
    `<plan>\n${planResult.content}\n</plan>\n`
  );
}

// ─── Gate 7: Eval review (spec + plan + eval report + diff + metadata) ───────

// §4.3/§4.4: shared Phase 7 diff + metadata builder. Used by both the fresh
// prompt and the resume prompt so resume variants include the same external-
// commit handling and metadata block as the first-time review.
function buildPhase7DiffAndMetadata(state: HarnessState, cwd: string): { diffSection: string; externalSummary: string; metadata: string } {
  const repos = (state.trackedRepos && state.trackedRepos.length > 0)
    ? state.trackedRepos
    : [{ path: cwd, baseCommit: state.baseCommit, implRetryBase: state.implRetryBase, implHead: state.implCommit } as TrackedRepo];

  const isSingleRepoCwd = repos.length === 1 && repos[0].path === cwd;

  // Per-repo diff builder (ADR-D1: truncateDiffPerFile before markdown wrapping)
  function buildRepoDiff(repo: TrackedRepo): string {
    if (state.externalCommitsDetected) {
      if (repo.implHead !== null) {
        let d = runGit(`git diff ${repo.baseCommit}...${repo.implHead}`, repo.path);
        // Per-repo pre-truncation before wrapping (ADR-D1)
        d = truncateDiffPerFile(d, PER_FILE_DIFF_LIMIT_KB * 1024);
        // For docs-home repo (trackedRepos[0]), also include eval commit diff
        if (repo === repos[0] && state.evalCommit !== null) {
          d += '\n' + runGit(`git diff ${state.evalCommit}^..${state.evalCommit}`, repo.path);
        }
        return d;
      } else {
        // No impl anchor — exclude from harness diff to avoid mixing unreviewed external changes
        return `(no harness implementation anchor for this repo — diff excluded; external commits may exist)`;
      }
    } else {
      let d = runGit(`git diff ${repo.baseCommit}...HEAD`, repo.path);
      d = truncateDiffPerFile(d, PER_FILE_DIFF_LIMIT_KB * 1024);
      return d;
    }
  }

  let combinedDiff: string;
  if (isSingleRepoCwd) {
    // N=1 backward path: raw diff, no ### repo: label (ADR-N7, FR-5 invariant)
    // For N=1 + externalCommitsDetected with null implCommit, preserve the ⚠️ prefix
    if (state.externalCommitsDetected && repos[0].implHead === null) {
      const target = state.evalCommit ?? 'HEAD';
      let primary = runGit(`git diff ${state.baseCommit}...${target}`, cwd);
      const maxDiffBytes = MAX_DIFF_SIZE_KB * 1024;
      if (primary.length > maxDiffBytes) {
        primary = truncateDiffPerFile(primary, PER_FILE_DIFF_LIMIT_KB * 1024);
      }
      primary =
        `⚠️ IMPORTANT: Phase 5 was skipped and external commits were detected. ` +
        `The primary diff below includes BOTH harness and external changes — they cannot be separated. ` +
        `Focus on the eval report and spec/plan compliance rather than the diff.\n\n` +
        primary;
      combinedDiff = primary;
    } else {
      combinedDiff = buildRepoDiff(repos[0]);
    }
  } else {
    // Multi-repo: concat with ### repo: labels
    const sections: string[] = [];
    for (const repo of repos) {
      const relOrAbs = path.relative(cwd, repo.path) || repo.path;
      const rawDiff = buildRepoDiff(repo);
      sections.push(`### repo: ${relOrAbs}\n\`\`\`diff\n${rawDiff}\n\`\`\``);
    }
    combinedDiff = sections.join('\n\n');
  }

  // Global size cap after concat (ADR-D1)
  const maxDiffBytes = MAX_DIFF_SIZE_KB * 1024;
  if (combinedDiff.length > maxDiffBytes) {
    combinedDiff = combinedDiff.slice(0, maxDiffBytes) +
      `\n--- (diff truncated: total exceeds ${MAX_DIFF_SIZE_KB}KB) ---\n`;
  }

  const diffSection = combinedDiff ? `<diff>\n${combinedDiff}\n</diff>\n` : '';

  // External commits summary
  let externalSummary = '';
  if (state.externalCommitsDetected) {
    if (isSingleRepoCwd) {
      // N=1: existing format
      const anchor = state.evalCommit ?? state.implCommit ?? state.baseCommit;
      const externalLog = runGit(`git log ${anchor}..HEAD --oneline`, cwd);
      if (externalLog.trim().length > 0) {
        externalSummary = `\n## External Commits (not reviewed)\n\n\`\`\`\n${externalLog}\n\`\`\`\n`;
      }
    } else {
      // N>1: per-repo sections
      const sections: string[] = [];
      for (const repo of repos) {
        const anchor = repo.implHead ?? repo.implRetryBase ?? repo.baseCommit;
        const externalLog = runGit(`git log ${anchor}..HEAD --oneline`, repo.path);
        if (externalLog.trim().length > 0) {
          const relOrAbs = path.relative(cwd, repo.path) || repo.path;
          sections.push(`### ${relOrAbs}\n\`\`\`\n${externalLog}\n\`\`\``);
        }
      }
      if (sections.length > 0) {
        externalSummary = `\n## External Commits (not reviewed)\n\n${sections.join('\n\n')}\n`;
      }
    }
  }

  // Metadata block: N=1 vs N>1 format (FR-5, gate-2 P1)
  const externalNote = state.externalCommitsDetected
    ? `Note: External commits detected. See '## External Commits (not reviewed)' section below.\nPrimary diff covers harness implementation range only.\n`
    : '';

  let implRange: string;
  if (isSingleRepoCwd) {
    // N=1: preserve existing single-line format (backward compat)
    implRange = state.implCommit !== null
      ? `Harness implementation range: ${state.baseCommit}..${state.implCommit} (Phase 1–5 commits).`
      : `Phase 5 skipped; no implementation commit anchor.`;
  } else {
    // N>1: per-repo format
    const lines = repos.map(repo => {
      const relOrAbs = path.relative(cwd, repo.path) || repo.path;
      return repo.implHead !== null
        ? `  - ${relOrAbs}: ${repo.baseCommit}..${repo.implHead}`
        : `  - ${relOrAbs}: no change (baseCommit=${repo.baseCommit})`;
    });
    implRange = `Harness implementation ranges (per tracked repo):\n${lines.join('\n')}`;
  }

  const metadata =
    `<metadata>\n${externalNote}${implRange}\n` +
    `Harness eval report commit: ${state.evalCommit ?? '(none)'} (the commit that last modified the eval report).\n` +
    `Verified at HEAD: ${state.verifiedAtHead ?? '(none)'} (most recent Phase 6 run).\n` +
    `Focus review on changes within the harness ranges above.\n` +
    `</metadata>\n`;

  return { diffSection, externalSummary, metadata };
}

function buildGatePromptPhase7(state: HarnessState, cwd: string): string | { error: string } {
  const docsRoot = state.trackedRepos?.[0]?.path || cwd;
  const specResult = readArtifactContent(state.artifacts.spec, docsRoot);
  if ('error' in specResult) return specResult;

  const evalResult = readArtifactContent(state.artifacts.evalReport, docsRoot);
  if ('error' in evalResult) return evalResult;

  const { diffSection, externalSummary, metadata } = buildPhase7DiffAndMetadata(state, cwd);

  if (state.flow === 'light') {
    return (
      reviewerContractForGate7('light') +
      buildLifecycleContext(7, 'light') +
      `<spec>\n${specResult.content}\n</spec>\n\n` +
      `<eval_report>\n${evalResult.content}\n</eval_report>\n\n` +
      diffSection +
      externalSummary +
      '\n' +
      metadata
    );
  }

  const planResult = readArtifactContent(state.artifacts.plan, docsRoot);
  if ('error' in planResult) return planResult;

  return (
    reviewerContractForGate7('full') +
    buildLifecycleContext(7, 'full') +
    `<spec>\n${specResult.content}\n</spec>\n\n` +
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
  harnessDir: string,
  cwd: string = path.join(harnessDir, '..')
): string {
  const phaseAttemptId = state.phaseAttemptId[String(phase)] ?? '';

  // Phase 1 uses task.md file path (not raw task string) per spec
  const taskMdPath = path.join('.harness', state.runId, 'task.md');

  // Merge pendingAction.feedbackPaths with carryoverFeedback.paths when the
  // carryover targets this phase. Carryover paths are dropped with a warning
  // when missing on disk (spec R8 — the P7→P1→P5 bridge may lose the file);
  // pendingAction paths are trusted (written by the harness this same turn).
  const pendingPaths = state.pendingAction?.feedbackPaths ?? [];
  const carryoverRawPaths =
    state.carryoverFeedback && state.carryoverFeedback.deliverToPhase === phase
      ? state.carryoverFeedback.paths
      : [];
  const carryoverPaths: string[] = [];
  for (const p of carryoverRawPaths) {
    const abs = path.isAbsolute(p) ? p : path.join(harnessDir, '..', p);
    if (fs.existsSync(abs)) {
      carryoverPaths.push(p);
    } else {
      process.stderr.write(
        `⚠️  carryover feedback path not found on disk, skipping: ${p}\n`,
      );
    }
  }
  const feedbackPaths = [...pendingPaths, ...carryoverPaths];
  const feedbackPath = feedbackPaths[0];
  const feedbackPathsList = feedbackPaths
    .map((p) => `- 이전 피드백 (반드시 반영): ${p}`)
    .join('\n');

  // playbookDir: resolved at runtime from assembler module location.
  // dev: src/context/playbooks/ ; dist: dist/src/context/playbooks/
  const playbookDir = path.join(__dirname, 'playbooks');

  // Phase 3 complexity directive: parse the spec's `## Complexity` signal and
  // inject the matching stanza. Spec R4: swallow ENOENT (missing file → null
  // parse → Medium fallback + warn); any other I/O error (EACCES, EIO, …) is
  // unexpected and must surface, not silently downgrade to Medium.
  let complexityDirective = '';
  if (phase === 3) {
    const specAbs = resolveArtifact(state, state.artifacts.spec, cwd);
    let specText: string | null = null;
    try {
      specText = fs.readFileSync(specAbs, 'utf-8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        specText = null;
      } else {
        throw err;
      }
    }
    const level = specText !== null ? parseComplexitySignal(specText) : null;
    complexityDirective = buildComplexityDirective(level);
  }

  const absSpec      = resolveArtifact(state, state.artifacts.spec,        cwd);
  const absPlan      = resolveArtifact(state, state.artifacts.plan,        cwd);
  const absChecklist = resolveArtifact(state, state.artifacts.checklist,   cwd);
  const absDecisions = resolveArtifact(state, state.artifacts.decisionLog, cwd);

  const vars: Record<string, string | undefined> = {
    task_path: taskMdPath,
    spec_path: absSpec,
    decisions_path: absDecisions,
    plan_path: absPlan,
    checklist_path: absChecklist,
    runId: state.runId,
    phaseAttemptId,
    feedback_path: feedbackPath,
    feedback_paths: feedbackPathsList.length > 0 ? feedbackPathsList : undefined,
    harnessDir,
    playbookDir,
    complexity_directive: complexityDirective,
  };

  // Light flow: phase 1 and 5 use self-contained light templates (no wrapper skill).
  if (state.flow === 'light' && (phase === 1 || phase === 5)) {
    const templateFile = phase === 1 ? 'phase-1-light.md' : 'phase-5-light.md';
    return renderTemplate(readTemplateFile(templateFile), vars);
  }

  // Two-pass render: wrapper body vars resolve first, then thin phase template
  // injects the rendered wrapper at {{wrapper_skill}} and resolves its own vars.
  const wrapperSkillRendered = renderTemplate(readWrapperSkill(phase), vars);
  const phaseTemplate = readTemplateFile(`phase-${phase}.md`);
  return renderTemplate(phaseTemplate, { ...vars, wrapper_skill: wrapperSkillRendered });
}

export function assembleGatePrompt(
  phase: 2 | 4 | 7,
  state: HarnessState,
  harnessDir: string,
  cwd: string
): string | { error: string } {
  let result: string | { error: string };

  if (phase === 2) {
    result = buildGatePromptPhase2(state, cwd);
  } else if (phase === 4) {
    result = buildGatePromptPhase4(state, cwd);
  } else {
    result = buildGatePromptPhase7(state, cwd);
  }

  if (typeof result === 'string') {
    // Append Output Protocol block (R3: verdict file + sentinel write instructions)
    const runDir = path.join(harnessDir, state.runId);
    const attemptId = state.phaseAttemptId[String(phase)];
    if (!attemptId) {
      return { error: `assembleGatePrompt: phaseAttemptId not set for phase ${phase}` };
    }
    result = result + buildGateOutputProtocol(phase, runDir, attemptId);
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
  const docsRoot = state.trackedRepos?.[0]?.path || cwd;
  const specResult = readArtifactContent(state.artifacts.spec, docsRoot);
  if ('error' in specResult) return specResult;
  let body = `<spec>\n${specResult.content}\n</spec>\n`;

  const lightEvalGate = phase === 7 && state.flow === 'light';

  if ((phase === 4 || phase === 7) && !lightEvalGate) {
    const planResult = readArtifactContent(state.artifacts.plan, docsRoot);
    if ('error' in planResult) return planResult;
    body += `\n<plan>\n${planResult.content}\n</plan>\n`;
  }
  if (phase === 7) {
    const evalResult = readArtifactContent(state.artifacts.evalReport, docsRoot);
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
  runDir: string,
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

  // Append Output Protocol block (same requirement on resume path)
  const attemptId = state.phaseAttemptId[String(phase)];
  if (!attemptId) {
    return { error: `assembleGateResumePrompt: phaseAttemptId not set for phase ${phase}` };
  }
  prompt = prompt + buildGateOutputProtocol(phase, runDir, attemptId);

  if (prompt.length > MAX_PROMPT_SIZE_KB * 1024) {
    return {
      error: `Assembled resume prompt too large: ${Math.round(prompt.length / 1024)}KB > ${MAX_PROMPT_SIZE_KB}KB limit`,
    };
  }
  return prompt;
}
