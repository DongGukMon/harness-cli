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
 * Hydrates metadata fields (runner, promptBytes, durationMs, tokensTotal, codexSessionId)
 * from the extended sidecar if present; legacy sidecars (no runner field) return undefined.
 */
export function checkGateSidecars(runDir: string, phase: number): GatePhaseResult | null {
  const rawPath = sidecarRaw(runDir, phase);
  const resultPath = sidecarResult(runDir, phase);

  if (!fs.existsSync(rawPath) || !fs.existsSync(resultPath)) {
    return null;
  }

  let gateResult: GateResult;
  try {
    gateResult = JSON.parse(fs.readFileSync(resultPath, 'utf-8')) as GateResult;
  } catch {
    return null;
  }

  let rawOutput: string;
  try {
    rawOutput = fs.readFileSync(rawPath, 'utf-8');
  } catch {
    return null;
  }

  // Hydrate metadata from sidecar (legacy sidecars have undefined for these fields)
  const metadata = {
    runner: gateResult.runner,
    promptBytes: gateResult.promptBytes,
    durationMs: gateResult.durationMs,
    tokensTotal: gateResult.tokensTotal,
    codexSessionId: gateResult.codexSessionId,
  };

  if (gateResult.exitCode !== 0) {
    return {
      type: 'error',
      error: `Gate subprocess exited with code ${gateResult.exitCode} (from sidecar)`,
      rawOutput,
      exitCode: gateResult.exitCode,
      ...metadata,
    };
  }

  const parsed = parseVerdict(rawOutput);
  if (!parsed) {
    return {
      type: 'error',
      error: 'Gate output missing ## Verdict header (from sidecar)',
      rawOutput,
      ...metadata,
    };
  }

  return {
    type: 'verdict',
    verdict: parsed.verdict,
    comments: parsed.comments,
    rawOutput,
    ...metadata,
  };
}

/**
 * Run a gate phase. Returns verdict or error.
 *
 * @param allowSidecarReplay - One-shot flag: if set and value=true, attempts sidecar replay
 *   on first call (for resumed __inner) and consumes the flag (sets value=false).
 */
export async function runGatePhase(
  phase: 2 | 4 | 7,
  state: HarnessState,
  harnessDir: string,
  runDir: string,
  cwd: string,
  allowSidecarReplay?: { value: boolean },
): Promise<GatePhaseResult> {
  const rawPath = sidecarRaw(runDir, phase);
  const resultPath = sidecarResult(runDir, phase);
  const errorPath = sidecarError(runDir, phase);

  // Step 1: One-shot sidecar replay (only allowed on first gate of a resumed __inner)
  if (allowSidecarReplay && allowSidecarReplay.value) {
    allowSidecarReplay.value = false; // consume the flag
    const replay = checkGateSidecars(runDir, phase);
    if (replay !== null) {
      return { ...replay, recoveredFromSidecar: true };
    }
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
  const promptBytes = Buffer.byteLength(prompt, 'utf8');

  // Step 4: Resolve preset and dispatch to runner
  const presetId = state.phasePresets[String(phase)];
  const preset = getPresetById(presetId);
  if (!preset) {
    return { type: 'error', error: `Unknown preset for phase ${phase}: ${presetId}` };
  }

  const runner = preset.runner;
  const runStartedAt = Date.now();
  const rawResult = runner === 'claude'
    ? await runClaudeGate(phase, preset, prompt, harnessDir, cwd)
    : await runCodexGate(phase, preset, prompt, harnessDir, cwd);
  const durationMs = Date.now() - runStartedAt;

  // Attach metadata to result
  const result: GatePhaseResult = { ...rawResult, runner, promptBytes, durationMs };

  // Step 5: Write extended sidecar
  const stdout = result.type === 'verdict' ? result.rawOutput : (result.rawOutput ?? '');
  const exitCode = result.type === 'verdict' ? 0 : 1;
  const gateResult: GateResult = {
    exitCode,
    timestamp: Date.now(),
    runner,
    promptBytes,
    durationMs,
    ...(result.tokensTotal !== undefined ? { tokensTotal: result.tokensTotal } : {}),
    ...(result.codexSessionId !== undefined ? { codexSessionId: result.codexSessionId } : {}),
  };
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
