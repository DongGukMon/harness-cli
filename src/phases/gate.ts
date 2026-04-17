import fs from 'fs';
import path from 'path';
import type { HarnessState, GatePhaseResult, GateResult } from '../types.js';
import { assembleGatePrompt } from '../context/assembler.js';
import { getPresetById } from '../config.js';
import { runClaudeGate } from '../runners/claude.js';
import { runCodexGate } from '../runners/codex.js';
import { parseVerdict, buildGateResult } from './verdict.js';
export { parseVerdict, buildGateResult } from './verdict.js';

function sidecarRaw(runDir: string, phase: number): string {
  return path.join(runDir, `gate-${phase}-raw.txt`);
}

function sidecarResult(runDir: string, phase: number): string {
  return path.join(runDir, `gate-${phase}-result.json`);
}

function sidecarError(runDir: string, phase: number): string {
  return path.join(runDir, `gate-${phase}-error.md`);
}

/**
 * Check if sidecar files exist and can be used to skip re-execution on resume.
 * Both gate-N-result.json AND gate-N-raw.txt must exist and be valid.
 */
export function checkGateSidecars(runDir: string, phase: number): GatePhaseResult | null {
  const rawPath = sidecarRaw(runDir, phase);
  const resultPath = sidecarResult(runDir, phase);

  if (!fs.existsSync(rawPath) || !fs.existsSync(resultPath)) {
    return null;
  }

  let gateResult: GateResult;
  try {
    const raw = fs.readFileSync(resultPath, 'utf-8');
    gateResult = JSON.parse(raw) as GateResult;
  } catch {
    return null;
  }

  let rawOutput: string;
  try {
    rawOutput = fs.readFileSync(rawPath, 'utf-8');
  } catch {
    return null;
  }

  if (gateResult.exitCode !== 0) {
    return {
      type: 'error',
      error: `Gate subprocess exited with code ${gateResult.exitCode} (from sidecar)`,
      rawOutput,
    };
  }

  const parsed = parseVerdict(rawOutput);
  if (!parsed) {
    return {
      type: 'error',
      error: 'Gate output missing ## Verdict header (from sidecar)',
      rawOutput,
    };
  }

  return {
    type: 'verdict',
    verdict: parsed.verdict,
    comments: parsed.comments,
    rawOutput,
  };
}

/**
 * Run a gate phase. Returns verdict or error.
 */
export async function runGatePhase(
  phase: 2 | 4 | 7,
  state: HarnessState,
  harnessDir: string,
  runDir: string,
  cwd: string
): Promise<GatePhaseResult> {
  const rawPath = sidecarRaw(runDir, phase);
  const resultPath = sidecarResult(runDir, phase);
  const errorPath = sidecarError(runDir, phase);

  // Step 1: Check existing sidecars (resume path) — before cleanup
  const resumeResult = checkGateSidecars(runDir, phase);
  if (resumeResult !== null) {
    return resumeResult;
  }

  // Step 2: Pre-run sidecar cleanup (delete stale files)
  for (const p of [rawPath, resultPath, errorPath]) {
    try { fs.unlinkSync(p); } catch { /* ignore missing */ }
  }

  // Step 3: Assemble prompt
  const promptResult = assembleGatePrompt(phase, state, harnessDir, cwd);
  if (typeof promptResult === 'object' && 'error' in promptResult) {
    return { type: 'error', error: promptResult.error };
  }
  const prompt = promptResult as string;

  // Step 4: Resolve preset and dispatch to runner
  const presetId = state.phasePresets[String(phase)];
  const preset = getPresetById(presetId);
  if (!preset) {
    return { type: 'error', error: `Unknown preset for phase ${phase}: ${presetId}` };
  }

  const result = preset.runner === 'claude'
    ? await runClaudeGate(phase, preset, prompt, harnessDir, cwd)
    : await runCodexGate(phase, preset, prompt, harnessDir, cwd);

  // Step 5: Write sidecars
  const stdout = result.type === 'verdict' ? result.rawOutput : (result.rawOutput ?? '');
  const exitCode = result.type === 'verdict' ? 0 : 1;
  const gateResult: GateResult = { exitCode, timestamp: Date.now() };
  try {
    fs.writeFileSync(rawPath, stdout);
    fs.writeFileSync(resultPath, JSON.stringify(gateResult, null, 2));
  } catch { /* best-effort */ }

  if (result.type === 'error') {
    try {
      fs.writeFileSync(
        errorPath,
        `# Gate ${phase} Error\n\nError: ${result.error}\n\n## stdout\n\n\`\`\`\n${stdout}\n\`\`\`\n`,
      );
    } catch { /* best-effort */ }
  }

  return result;
}
