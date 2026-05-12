// P5 → P6 drift detection (single-file scorer + escalation handler).
//
// The deterministic floor described in the original D1 was advisor-trimmed
// out of v1 — see the spec's "Deferred" section. v1 is Codex-only; that's
// why this module has no extractDeterministicFloor / mergeAxes exports.
//
// Spec: docs/specs/2026-05-11-p5-spec-plan-drift-p5-p6-4a02-design.md

import fs from 'fs';
import { execSync, spawn } from 'child_process';
import path from 'path';
import type { HarnessState } from '../types.js';
import { extractCodexMetadata } from './verdict.js';

const DRIFT_CODEX_TIMEOUT_MS = 120_000;
const DRIFT_CODEX_DEFAULT_MODEL = 'gpt-5.5';
const DRIFT_CODEX_DEFAULT_EFFORT = 'high';

export const DRIFT_AXES = ['goal', 'constraint', 'ontology'] as const;
export type DriftAxis = typeof DRIFT_AXES[number];
export type DriftAxes = Record<DriftAxis, number>;

export const DRIFT_WEIGHTS: Readonly<DriftAxes> = Object.freeze({
  goal: 0.5,
  constraint: 0.3,
  ontology: 0.2,
});

// PR #102 dogfood showed every phase_drift event in a phase-harness self-run
// landed on the oversized-spec+plan boundary because the harness's own specs
// and plans run 75-90K chars. The original 30K ceiling was tuned for small
// task scopes and effectively disabled drift detection on the canonical
// internal-dogfood use case. Raised to 100K so spec+plan + a head slice of
// the diff fit; Codex GPT-5.5's context is 200K so the extra ~20K tokens per
// call (≈$0.10 incremental) costs less than one wasted P7 retry round.
export const DRIFT_PROMPT_CAP_CHARS = 100_000;
export const DRIFT_DIFF_HEAD_RESERVE_CHARS = 20_000;

export type DriftAction =
  | 'pass'
  | 'reopen'
  | 'escalate-continue'
  | 'escalate-skip'
  | 'escalate-quit'
  | 'error';

export type DriftSource = 'codex-only' | 'codex-truncated' | 'error';

export interface DriftScoresParsed {
  goal: number;
  constraint: number;
  ontology: number;
  rationale?: string;
}

export interface DriftOutcome {
  /** True when env-resolved threshold is non-null AND scoreP5Drift was actually run. */
  activated: boolean;
  /** Resolved threshold for the run (only meaningful when activated). */
  threshold: number;
  /** Final weighted score in [0, 1], or null on error. */
  score: number | null;
  axes: DriftAxes | null;
  driftSource: DriftSource;
  durationMs: number;
  codexTokensTotal?: number;
  rationale?: string;
  error?: string;
}

const warnedKeys = new Set<string>();

export function __resetDriftWarning(): void {
  warnedKeys.clear();
}

function warnOnce(key: string, message: string): void {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  process.stderr.write(message.endsWith('\n') ? message : message + '\n');
}

/**
 * Resolve HARNESS_PHASE_DRIFT_THRESHOLD per spec §Threshold & action.
 * Returns null when drift detection is disabled for this run.
 */
export function loadDriftThreshold(autoMode: boolean, noDrift: boolean = false): number | null {
  if (noDrift) return null;
  const raw = process.env['HARNESS_PHASE_DRIFT_THRESHOLD'];

  if (raw === undefined || raw === '') {
    return autoMode ? 0.3 : null;
  }

  const trimmed = raw.trim();
  if (trimmed.toLowerCase() === 'off') return null;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    warnOnce(
      'HARNESS_PHASE_DRIFT_THRESHOLD',
      `[drift] invalid HARNESS_PHASE_DRIFT_THRESHOLD="${raw}" — drift detection disabled for this run`,
    );
    return null;
  }
  return parsed;
}

/**
 * Parse the `## Drift Scores` fenced JSON block out of Codex stdout.
 * Returns null on any malformation; never throws.
 */
export function parseDriftScores(rawOutput: string): DriftScoresParsed | null {
  if (typeof rawOutput !== 'string' || rawOutput.length === 0) return null;

  const headerIdx = rawOutput.search(/^##\s+drift\s+scores\s*$/im);
  if (headerIdx < 0) return null;

  const after = rawOutput.slice(headerIdx);
  // Find the first fenced ```json ... ``` block under the header.
  const fence = after.match(/```\s*json\s*\n([\s\S]*?)\n```/i);
  if (!fence) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(fence[1]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const obj = parsed as Record<string, unknown>;
  const goal = obj['goal'];
  const constraint = obj['constraint'];
  const ontology = obj['ontology'];

  if (![goal, constraint, ontology].every((v) => typeof v === 'number' && Number.isFinite(v))) {
    return null;
  }
  const g = goal as number, c = constraint as number, o = ontology as number;
  if (g < 0 || g > 1 || c < 0 || c > 1 || o < 0 || o > 1) return null;

  const out: DriftScoresParsed = { goal: g, constraint: c, ontology: o };
  const rat = obj['rationale'];
  if (typeof rat === 'string') {
    // Single-line, length-clamped to 200 chars.
    out.rationale = rat.replace(/\s+/g, ' ').trim().slice(0, 200);
  }
  return out;
}

/**
 * weighted_score = clamp01(0.5*goal + 0.3*constraint + 0.2*ontology).
 */
export function computeWeightedDrift(axes: DriftAxes): number {
  const raw =
    DRIFT_WEIGHTS.goal * axes.goal +
    DRIFT_WEIGHTS.constraint * axes.constraint +
    DRIFT_WEIGHTS.ontology * axes.ontology;
  if (!Number.isFinite(raw)) return 0;
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}

/**
 * Build the Codex prompt. Returns either the assembled prompt or
 * { oversized: true } if spec+plan alone exceeds the cap (per §Inputs
 * "Oversized spec/plan boundary").
 */
export function buildDriftPrompt(
  specText: string,
  planText: string,
  diffText: string,
  threshold: number,
): { prompt: string; truncated: boolean } | { oversized: true } {
  const head = buildDriftPromptHeader(threshold);

  // Hard boundary: even with diff="", spec+plan body alone must fit.
  // We reserve a small margin for the header and section dividers.
  const headerFooterReserve = 800;
  const bodyBudget = DRIFT_PROMPT_CAP_CHARS - headerFooterReserve;
  if (specText.length + planText.length > bodyBudget) {
    return { oversized: true };
  }

  const fullDiff = diffText ?? '';
  const tentative = assemblePrompt(head, specText, planText, fullDiff);
  if (tentative.length <= DRIFT_PROMPT_CAP_CHARS) {
    return { prompt: tentative, truncated: false };
  }

  // Truncate diff tail. Reserve DIFF_HEAD chars for the diff head; the
  // remaining slack lets spec/plan stay intact.
  const truncatedDiff = fullDiff.length > DRIFT_DIFF_HEAD_RESERVE_CHARS
    ? fullDiff.slice(0, DRIFT_DIFF_HEAD_RESERVE_CHARS) + '\n\n[... diff truncated ...]\n'
    : fullDiff;
  const out = assemblePrompt(head, specText, planText, truncatedDiff);
  return { prompt: out, truncated: true };
}

function buildDriftPromptHeader(threshold: number): string {
  return [
    'You are scoring how far the implementation has drifted from the approved spec/plan.',
    'Output rubric (each axis is in [0.0, 1.0], where 0.0 = no drift, 1.0 = total drift):',
    '  - goal       — How much do the actual code changes diverge from the spec\'s stated goals?',
    '  - constraint — How many spec constraints / forbidden behaviors are violated by the diff?',
    '  - ontology   — How much do the diff\'s entities (types, names, modules) diverge from the spec\'s entity model?',
    '',
    `Threshold context: the harness reopens P5 when weighted score > ${threshold.toFixed(2)} (weights: goal 0.5, constraint 0.3, ontology 0.2).`,
    'Be calibrated, not generous. Score 0.0–0.1 only when the implementation faithfully reflects the spec. Score above 0.5 only with concrete divergence evidence.',
    '',
    'OUTPUT — emit exactly two sections, in this order, with NOTHING else:',
    '',
    '## Drift Scores',
    '```json',
    '{ "goal": 0.00, "constraint": 0.00, "ontology": 0.00, "rationale": "<≤200 chars, single line>" }',
    '```',
    '',
    '## End',
    '',
    'Replace the example numbers with your assessment. The ## End line MUST follow.',
    '',
    '---',
  ].join('\n');
}

function assemblePrompt(
  head: string,
  specText: string,
  planText: string,
  diffText: string,
): string {
  return [
    head,
    '## Spec',
    specText,
    '',
    '## Plan',
    planText,
    '',
    '## Diff (planCommit..implCommit)',
    diffText.length > 0 ? diffText : '(no diff against plan commit)',
  ].join('\n');
}

/**
 * Read the diff between planCommit and implCommit. Returns "" on any failure
 * (drift scoring continues — Codex sees an empty diff as "no impl changes").
 */
export function readP5Diff(planCommit: string | null, implCommit: string | null, cwd: string): string {
  if (!planCommit || !implCommit || planCommit === implCommit) return '';
  try {
    const buf = execSync(`git diff ${planCommit}..${implCommit} --`, {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024, // 64 MiB
    });
    return buf;
  } catch {
    return '';
  }
}

/**
 * Write drift-feedback.md for the reopen branches. Single file under the
 * harness run dir, overwritten each call (idempotent).
 */
export function writeDriftFeedback(runDir: string, outcome: DriftOutcome): string {
  const filePath = path.join(runDir, 'drift-feedback.md');
  const lines: string[] = [];
  lines.push('# Drift Detection — P5 reopen feedback');
  lines.push('');
  if (outcome.score !== null && outcome.axes !== null) {
    lines.push(`Weighted drift score: ${outcome.score.toFixed(2)} (threshold ${outcome.threshold.toFixed(2)}).`);
  } else {
    lines.push(`Weighted drift score: unavailable (driftSource=${outcome.driftSource}).`);
  }
  lines.push('');
  if (outcome.axes !== null) {
    lines.push('## Axes');
    lines.push('');
    lines.push('| Axis | Score | Weight |');
    lines.push('|---|---|---|');
    lines.push(`| goal | ${outcome.axes.goal.toFixed(2)} | 0.50 |`);
    lines.push(`| constraint | ${outcome.axes.constraint.toFixed(2)} | 0.30 |`);
    lines.push(`| ontology | ${outcome.axes.ontology.toFixed(2)} | 0.20 |`);
    lines.push('');
  }
  lines.push(`Source: \`${outcome.driftSource}\`.`);
  if (outcome.codexTokensTotal !== undefined) {
    lines.push(`Codex tokens (drift call): ${outcome.codexTokensTotal}.`);
  }
  if (outcome.rationale) {
    lines.push('');
    lines.push('## Codex rationale');
    lines.push('');
    lines.push('> ' + outcome.rationale.replace(/\n+/g, ' '));
  }
  lines.push('');
  lines.push('## What to do');
  lines.push('');
  lines.push(
    'Re-read the spec\'s Goals / Constraints / Invariants sections and adjust the implementation '
    + 'until those expectations are reflected by the actual code (and tests). The drift score will '
    + 'be re-computed when this P5 attempt completes again.',
  );
  lines.push('');
  fs.writeFileSync(filePath, lines.join('\n'));
  return filePath;
}

interface CodexDriftRawResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  errorMessage?: string;
}

/**
 * One-shot Codex call for drift scoring. Mirrors runCodexExecRaw's spawn
 * pattern in src/runners/codex.ts but is intentionally narrower: no
 * resume / fallback / verdict-presence categorisation. Just stdin → stdout.
 *
 * Test injection: if the env var HARNESS_DRIFT_CODEX_FIXTURE is set to a
 * file path, that file's contents are returned as stdout (no Codex spawn).
 * Used by integration tests; never set in production.
 */
export async function runCodexDriftScorer(input: {
  prompt: string;
  cwd: string;
  model?: string;
  effort?: string;
}): Promise<CodexDriftRawResult> {
  const fixturePath = process.env['HARNESS_DRIFT_CODEX_FIXTURE'];
  if (fixturePath !== undefined && fixturePath !== '') {
    try {
      const stdout = fs.readFileSync(fixturePath, 'utf-8');
      return { ok: true, stdout, stderr: '' };
    } catch (err) {
      return {
        ok: false,
        stdout: '',
        stderr: '',
        errorMessage: `Drift fixture read failed: ${(err as Error).message}`,
      };
    }
  }

  const codexBin = resolveCodexBin();
  if (codexBin === null) {
    return {
      ok: false,
      stdout: '',
      stderr: '',
      errorMessage: 'Codex CLI not found in PATH',
    };
  }

  const model = input.model ?? DRIFT_CODEX_DEFAULT_MODEL;
  const effort = input.effort ?? DRIFT_CODEX_DEFAULT_EFFORT;
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--model', model,
    '-c', `model_reasoning_effort="${effort}"`,
    '-',
  ];

  return new Promise<CodexDriftRawResult>((resolve) => {
    let settled = false;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const child = spawn(codexBin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: input.cwd,
      env: process.env,
    });

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGTERM'); } catch { /* best-effort */ }
      resolve({
        ok: false,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        errorMessage: `Codex drift call timed out after ${DRIFT_CODEX_TIMEOUT_MS}ms`,
      });
    }, DRIFT_CODEX_TIMEOUT_MS);

    child.stdout.on('data', (c: Buffer) => stdoutChunks.push(c));
    child.stderr.on('data', (c: Buffer) => stderrChunks.push(c));

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        ok: false,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        errorMessage: `Codex spawn error: ${err.message}`,
      });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');
      if (code === 0) {
        resolve({ ok: true, stdout, stderr });
      } else {
        resolve({
          ok: false,
          stdout,
          stderr,
          errorMessage: `Codex drift call exited with code ${code ?? 'null'}`,
        });
      }
    });

    try {
      child.stdin.write(input.prompt);
      child.stdin.end();
    } catch (err) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { child.kill('SIGTERM'); } catch { /* best-effort */ }
      resolve({
        ok: false,
        stdout: '',
        stderr: '',
        errorMessage: `Codex stdin write failed: ${(err as Error).message}`,
      });
    }
  });
}

function resolveCodexBin(): string | null {
  try {
    return execSync('which codex', { encoding: 'utf-8' }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Orchestrator. Returns activated:false when drift detection is disabled,
 * activated:true with the outcome otherwise. Never throws — D6 strict
 * fail-open.
 */
export async function scoreP5Drift(input: {
  state: HarnessState;
  runDir: string;
  cwd: string;
}): Promise<{ activated: false } | { activated: true; outcome: DriftOutcome }> {
  const startTs = Date.now();
  const threshold = loadDriftThreshold(
    input.state.autoMode === true,
    input.state.noDrift === true,
  );
  if (threshold === null) {
    return { activated: false };
  }

  // Best-effort artifact reads. Any read failure → fail-open error outcome.
  let specText = '';
  let planText = '';
  try {
    const specRel = input.state.artifacts?.spec;
    const planRel = input.state.artifacts?.plan;
    if (specRel === undefined || planRel === undefined) {
      throw new Error('artifacts.spec or artifacts.plan missing from state');
    }
    specText = fs.readFileSync(path.resolve(input.cwd, specRel), 'utf-8');
    planText = fs.readFileSync(path.resolve(input.cwd, planRel), 'utf-8');
  } catch (err) {
    return {
      activated: true,
      outcome: errorOutcome(threshold, startTs, `artifact read failed: ${(err as Error).message}`),
    };
  }

  const trackedRoot = input.state.trackedRepos?.[0]?.path ?? input.cwd;
  const diffText = readP5Diff(input.state.planCommit ?? null, input.state.implCommit ?? null, trackedRoot);

  const promptResult = buildDriftPrompt(specText, planText, diffText, threshold);
  if ('oversized' in promptResult) {
    warnOnce(
      'drift-oversized',
      `[drift] spec+plan exceeds ${DRIFT_PROMPT_CAP_CHARS}-char cap (${specText.length + planText.length} chars) — drift detection skipped for this attempt`,
    );
    return {
      activated: true,
      outcome: errorOutcome(threshold, startTs, 'spec+plan exceeds prompt cap'),
    };
  }

  let codexResult: CodexDriftRawResult;
  try {
    codexResult = await runCodexDriftScorer({
      prompt: promptResult.prompt,
      cwd: trackedRoot,
    });
  } catch (err) {
    return {
      activated: true,
      outcome: errorOutcome(threshold, startTs, `Codex call threw: ${(err as Error).message}`),
    };
  }

  if (!codexResult.ok) {
    warnOnce(
      'drift-codex-fail',
      `[drift] Codex call failed: ${codexResult.errorMessage ?? 'unknown'} — fail-open, P6 will proceed`,
    );
    return {
      activated: true,
      outcome: errorOutcome(threshold, startTs, codexResult.errorMessage ?? 'codex error'),
    };
  }

  const scores = parseDriftScores(codexResult.stdout);
  if (scores === null) {
    warnOnce(
      'drift-parse-fail',
      `[drift] Could not parse ## Drift Scores JSON from Codex output — fail-open, P6 will proceed`,
    );
    return {
      activated: true,
      outcome: errorOutcome(threshold, startTs, 'parse error'),
    };
  }

  const axes: DriftAxes = {
    goal: scores.goal,
    constraint: scores.constraint,
    ontology: scores.ontology,
  };
  const score = computeWeightedDrift(axes);
  const codexMeta = extractCodexMetadata(codexResult.stdout, codexResult.stderr);

  const outcome: DriftOutcome = {
    activated: true,
    threshold,
    score,
    axes,
    driftSource: promptResult.truncated ? 'codex-truncated' : 'codex-only',
    durationMs: Date.now() - startTs,
    ...(codexMeta.tokensTotal !== undefined ? { codexTokensTotal: codexMeta.tokensTotal } : {}),
    ...(scores.rationale ? { rationale: scores.rationale } : {}),
  };
  return { activated: true, outcome };
}

function errorOutcome(threshold: number, startTs: number, error: string): DriftOutcome {
  return {
    activated: true,
    threshold,
    score: null,
    axes: null,
    driftSource: 'error',
    durationMs: Date.now() - startTs,
    error,
  };
}

/**
 * Resolve action from outcome + autoMode. v1 simplifies D2: both autoMode
 * and manual users (who must opt in via env) get reopen on score-exceeded.
 * The C/S/Q manual escalation prompt is documented in spec but deferred to
 * a follow-up PR.
 */
export function resolveDriftAction(outcome: DriftOutcome): DriftAction {
  if (outcome.driftSource === 'error' || outcome.score === null) {
    return 'error';
  }
  return outcome.score > outcome.threshold ? 'reopen' : 'pass';
}

