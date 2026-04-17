import type { GatePhaseResult } from '../types.js';

/**
 * Parse verdict from raw gate output.
 * Finds ## Verdict header, then first APPROVE or REJECT token after it.
 * Extracts content between ## Comments and ## Summary as comments.
 */
export function parseVerdict(
  rawOutput: string
): { verdict: 'APPROVE' | 'REJECT'; comments: string } | null {
  const lines = rawOutput.split('\n');
  const verdictHeaderIdx = lines.findIndex(
    (l) => l.trim().toLowerCase() === '## verdict'
  );
  if (verdictHeaderIdx === -1) return null;

  let verdict: 'APPROVE' | 'REJECT' | null = null;
  for (let i = verdictHeaderIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim().toUpperCase();
    if (trimmed.startsWith('##')) break;
    if (/^APPROVE\b[\s.!]*$/.test(trimmed)) { verdict = 'APPROVE'; break; }
    if (/^REJECT\b[\s.!]*$/.test(trimmed)) { verdict = 'REJECT'; break; }
  }
  if (verdict === null) return null;

  const commentsHeaderIdx = lines.findIndex(
    (l) => l.trim().toLowerCase() === '## comments'
  );
  let comments = '';
  if (commentsHeaderIdx !== -1) {
    const summaryHeaderIdx = lines.findIndex(
      (l, idx) => idx > commentsHeaderIdx && l.trim().toLowerCase() === '## summary'
    );
    const endIdx = summaryHeaderIdx === -1 ? lines.length : summaryHeaderIdx;
    comments = lines.slice(commentsHeaderIdx + 1, endIdx).join('\n').trim();
  }

  return { verdict, comments };
}

/**
 * Build GatePhaseResult from subprocess exit data.
 */
export function buildGateResult(
  exitCode: number,
  stdout: string,
  stderr: string
): GatePhaseResult {
  if (exitCode !== 0) {
    return {
      type: 'error',
      error: `Gate subprocess exited with code ${exitCode}`,
      rawOutput: stdout,
    };
  }

  const parsed = parseVerdict(stdout);
  if (!parsed) {
    return {
      type: 'error',
      error: 'Gate output missing ## Verdict header',
      rawOutput: stdout,
    };
  }

  void stderr;

  return {
    type: 'verdict',
    verdict: parsed.verdict,
    comments: parsed.comments,
    rawOutput: stdout,
  };
}
