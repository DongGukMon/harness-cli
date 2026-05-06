import type { GatePhaseResult } from '../types.js';
import { parseClarityScores, computeWeightedAmbiguity, AMBIGUITY_AXES } from './verdict.js';
import type { ClarityScores } from './verdict.js';

const warnedKeys = new Set<string>();

export function __resetAmbiguityWarning(): void {
  warnedKeys.clear();
}

export function loadAmbiguityThreshold(): number | null {
  const raw = process.env['HARNESS_GATE_AMBIGUITY_THRESHOLD'];
  if (raw === undefined || raw === '') return 0.2;

  const trimmed = raw.trim();
  if (trimmed.toLowerCase() === 'off') return null;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    if (!warnedKeys.has('HARNESS_GATE_AMBIGUITY_THRESHOLD')) {
      process.stderr.write(
        `[ambiguity] invalid HARNESS_GATE_AMBIGUITY_THRESHOLD="${raw}" — veto disabled for this run\n`,
      );
      warnedKeys.add('HARNESS_GATE_AMBIGUITY_THRESHOLD');
    }
    return null;
  }
  return parsed;
}

export function applyAmbiguityGate(
  result: GatePhaseResult,
  rawOutput: string,
  threshold: number | null,
): GatePhaseResult {
  if (result.type === 'error') return result;

  const scores = parseClarityScores(rawOutput);

  if (scores === null) {
    if (!warnedKeys.has('clarity-parse')) {
      process.stderr.write(
        '[ambiguity] ## Clarity Scores section missing or malformed — fail-open, verdict unchanged\n',
      );
      warnedKeys.add('clarity-parse');
    }
    return {
      ...result,
      clarityParseError: true,
      ...(threshold !== null ? { ambiguityThreshold: threshold } : {}),
    };
  }

  const ambiguity = computeWeightedAmbiguity(scores);
  const withScores: GatePhaseResult = {
    ...result,
    clarityScores: scores,
    ambiguity,
    ...(threshold !== null ? { ambiguityThreshold: threshold } : {}),
  };

  if (threshold !== null && result.verdict === 'APPROVE' && ambiguity > threshold) {
    const sorted = ([...AMBIGUITY_AXES] as string[]).sort(
      (a, b) => (scores as ClarityScores)[a as keyof ClarityScores] - (scores as ClarityScores)[b as keyof ClarityScores],
    );
    const lowestTwo = sorted.slice(0, 2);
    const lowestDesc = lowestTwo
      .map((ax) => `${ax}=${(scores as ClarityScores)[ax as keyof ClarityScores].toFixed(2)}`)
      .join(', ');
    const scoresJson = Object.entries(scores)
      .map(([k, v]) => `${k}: ${(v as number).toFixed(2)}`)
      .join(', ');

    const syntheticComment =
      `- **[P1]** — Location: spec (overall)\n` +
      `  Issue: Spec ambiguity ${ambiguity.toFixed(2)} exceeds threshold ${threshold.toFixed(2)} (weighted across goal/constraint/success/context).\n` +
      `  Suggestion: Tighten the lowest-scoring axes — ${lowestDesc}. Restate goals as measurable outcomes and enumerate forbidden behaviors / boundary conditions.\n` +
      `  Evidence: clarityScores = { ${scoresJson} } → weighted ambiguity ${ambiguity.toFixed(2)} > ${threshold.toFixed(2)}.`;

    const existingComments = (result.comments ?? '').replace(/\n?Scope:\s*(design|impl|mixed)\b[^\n]*/i, '');
    const newComments = (existingComments.trim()
      ? syntheticComment + '\n' + existingComments.trim()
      : syntheticComment) + '\nScope: design';

    const syntheticRawOutput = [
      '## Verdict',
      'REJECT',
      'Scope: design',
      '',
      '## Comments',
      syntheticComment,
      '',
      '## Summary',
      `Ambiguity veto applied: spec ambiguity ${ambiguity.toFixed(2)} > threshold ${threshold.toFixed(2)}.`,
    ].join('\n');

    return {
      ...withScores,
      verdict: 'REJECT',
      comments: newComments,
      rawOutput: syntheticRawOutput,
      ambiguityVetoed: true,
      scope: 'design',
    };
  }

  return withScores;
}
