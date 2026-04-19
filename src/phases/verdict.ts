import type { GatePhaseResult, Scope } from '../types.js';

/**
 * Parse verdict from raw gate output.
 * Finds ## Verdict header, then first APPROVE or REJECT token after it.
 * Extracts content between ## Comments and ## Summary as comments.
 */
export function parseVerdict(
  rawOutput: string
): { verdict: 'APPROVE' | 'REJECT'; comments: string; scope?: Scope } | null {
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

  let scope: Scope | undefined;
  if (verdict === 'REJECT') {
    const verdictWindow = lines.slice(verdictHeaderIdx + 1).join('\n');
    const match = verdictWindow.match(/^\s*Scope:\s*(design|impl|mixed)\b.*$/im);
    if (match) {
      scope = match[1].toLowerCase() as Scope;
    }
  }

  return scope ? { verdict, comments, scope } : { verdict, comments };
}

/**
 * Extract `tokens used` and `session id:` metadata from a Codex `exec` run.
 *
 * Codex writes these lines to STDERR (alongside its banner and `hook:` lines), not
 * stdout — stdout contains only the model's final answer text. Earlier versions of
 * this helper scanned stdout only, which silently failed for real subprocess runs
 * (the regexes never matched) while unit tests passed because fixtures stuffed
 * metadata into the stdout argument. Scan both streams so the helper is robust to
 * either wiring.
 */
export function extractCodexMetadata(
  stdout: string,
  stderr: string = ''
): { tokensTotal?: number; codexSessionId?: string } {
  const out: { tokensTotal?: number; codexSessionId?: string } = {};
  const combined = stderr.length > 0 ? `${stdout}\n${stderr}` : stdout;
  const m = combined.match(/^tokens used\s*\n([\d,]+)/m);
  if (m) out.tokensTotal = parseInt(m[1].replace(/,/g, ''), 10);
  const s = combined.match(/session id:\s*([0-9a-f-]+)/i);
  if (s) out.codexSessionId = s[1];
  return out;
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
    scope: parsed.scope,
    rawOutput: stdout,
  };
}
