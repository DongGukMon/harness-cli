import fs from 'fs';
import path from 'path';
import type { HarnessState, GatePhaseResult, GateResult, GateSessionInfo } from '../types.js';
import { assembleGatePrompt, assembleGateResumePrompt } from '../context/assembler.js';
import { getPresetById } from '../config.js';
import { runClaudeGate } from '../runners/claude.js';
import { runCodexGate } from '../runners/codex.js';
import { writeState } from '../state.js';
import { parseVerdict, buildGateResult } from './verdict.js';
export { parseVerdict, buildGateResult } from './verdict.js';

type GatePhaseKey = '2' | '4' | '7';

function sidecarRaw(runDir: string, phase: number): string {
  return path.join(runDir, `gate-${phase}-raw.txt`);
}

function sidecarResult(runDir: string, phase: number): string {
  return path.join(runDir, `gate-${phase}-result.json`);
}

function sidecarError(runDir: string, phase: number): string {
  return path.join(runDir, `gate-${phase}-error.md`);
}

function sidecarFeedback(runDir: string, phase: number): string {
  return path.join(runDir, `gate-${phase}-feedback.md`);
}

/**
 * Check if sidecar files exist and can be used to skip re-execution on resume.
 * Both gate-N-result.json AND gate-N-raw.txt must exist and be valid.
 * Hydrates metadata (runner, promptBytes, durationMs, tokensTotal, codexSessionId, sourcePreset).
 * Legacy sidecars (no runner field) return metadata with undefined fields.
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

  const metadata = {
    runner: gateResult.runner,
    promptBytes: gateResult.promptBytes,
    durationMs: gateResult.durationMs,
    tokensTotal: gateResult.tokensTotal,
    codexSessionId: gateResult.codexSessionId,
    sourcePreset: gateResult.sourcePreset,
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
  const phaseKey = String(phase) as GatePhaseKey;
  const rawPath = sidecarRaw(runDir, phase);
  const resultPath = sidecarResult(runDir, phase);
  const errorPath = sidecarError(runDir, phase);

  // Step 1: One-shot sidecar replay — §4.7 two-stage compatibility gate.
  // (A) replay-level compatibility: sidecar.runner == currentPreset.runner;
  //     for codex runner, sourcePreset must match current preset exactly.
  // (B) hydration gate: additionally require sessionId + empty state slot + preset match
  //     → populate state.phaseCodexSessions so the next reject-retry can resume.
  if (allowSidecarReplay && allowSidecarReplay.value) {
    allowSidecarReplay.value = false;
    const replay = checkGateSidecars(runDir, phase);
    if (replay !== null) {
      const currentPreset = getPresetById(state.phasePresets[phaseKey]);

      const replayCompatible = (
        currentPreset !== undefined &&
        replay.runner !== undefined &&
        replay.runner === currentPreset.runner &&
        (
          replay.runner === 'claude'
            ? true
            : (replay.sourcePreset !== undefined &&
               replay.sourcePreset.model === currentPreset.model &&
               replay.sourcePreset.effort === currentPreset.effort)
        )
      );

      if (replayCompatible && currentPreset !== undefined) {
        // (B) Hydration gate — codex-only, requires non-empty sessionId + empty state slot
        const canHydrate =
          replay.codexSessionId !== undefined &&
          replay.runner === 'codex' &&
          state.phaseCodexSessions[phaseKey] === null &&
          currentPreset.runner === 'codex' &&
          replay.sourcePreset !== undefined &&
          replay.sourcePreset.model === currentPreset.model &&
          replay.sourcePreset.effort === currentPreset.effort;

        if (canHydrate) {
          const lastOutcome: 'approve' | 'reject' | 'error' =
            replay.type === 'verdict'
              ? (replay.verdict === 'APPROVE' ? 'approve' : 'reject')
              : 'error';
          state.phaseCodexSessions[phaseKey] = {
            sessionId: replay.codexSessionId!,
            runner: 'codex',
            model: currentPreset.model,
            effort: currentPreset.effort,
            lastOutcome,
          };
          try { writeState(runDir, state); } catch { /* best-effort */ }
        }
        return { ...replay, recoveredFromSidecar: true };
      }
      // Incompatible replay → fall through to live execution
    }
  }

  // Step 2: Pre-run sidecar cleanup (delete stale files)
  for (const p of [rawPath, resultPath, errorPath]) {
    try { fs.unlinkSync(p); } catch { /* ignore missing */ }
  }

  // Step 3: Resolve preset
  const presetId = state.phasePresets[phaseKey];
  const preset = getPresetById(presetId);
  if (!preset) {
    return { type: 'error', error: `Unknown preset for phase ${phase}: ${presetId}` };
  }

  // Step 4: Resume-compatibility check
  const savedSession: GateSessionInfo | null = state.phaseCodexSessions[phaseKey];
  const savedCompatible = (
    savedSession !== null &&
    typeof savedSession.sessionId === 'string' &&
    savedSession.sessionId.trim().length > 0 &&
    savedSession.runner === 'codex' &&
    preset.runner === 'codex' &&
    savedSession.model === preset.model &&
    savedSession.effort === preset.effort
  );

  // Defense-in-depth: 비호환이면 저장된 세션 null 처리
  if (savedSession !== null && !savedCompatible) {
    state.phaseCodexSessions[phaseKey] = null;
    try { writeState(runDir, state); } catch { /* best-effort */ }
  }

  // Step 5: Assemble prompt (resume vs fresh)
  let prompt: string;
  let resumeSessionId: string | null = null;
  let buildFreshPromptOnFallback: (() => string | { error: string }) | undefined;

  if (savedCompatible && savedSession !== null) {
    resumeSessionId = savedSession.sessionId;
    let previousFeedback = '';
    if (savedSession.lastOutcome === 'reject') {
      try {
        previousFeedback = fs.readFileSync(sidecarFeedback(runDir, phase), 'utf-8');
      } catch { /* feedback optional */ }
    }
    const resumePromptResult = assembleGateResumePrompt(
      phase, state, cwd, savedSession.lastOutcome, previousFeedback,
    );
    if (typeof resumePromptResult !== 'string') {
      return { type: 'error', error: resumePromptResult.error };
    }
    prompt = resumePromptResult;
    // Closure used by runner on session_missing fallback
    buildFreshPromptOnFallback = () => assembleGatePrompt(phase, state, harnessDir, cwd);
  } else {
    const promptResult = assembleGatePrompt(phase, state, harnessDir, cwd);
    if (typeof promptResult === 'object' && 'error' in promptResult) {
      return { type: 'error', error: promptResult.error };
    }
    prompt = promptResult as string;
  }

  const promptBytes = Buffer.byteLength(prompt, 'utf8');

  // Step 6: Dispatch to runner
  const runner = preset.runner;
  const runStartedAt = Date.now();
  const rawResult = runner === 'claude'
    ? await runClaudeGate(phase, preset, prompt, harnessDir, cwd)
    : await runCodexGate(
        phase, preset, prompt, harnessDir, cwd, resumeSessionId, buildFreshPromptOnFallback,
      );
  const durationMs = Date.now() - runStartedAt;

  const result: GatePhaseResult = {
    ...rawResult,
    runner,
    promptBytes,
    durationMs,
    // runCodexGate already sets resumedFrom/resumeFallback/sourcePreset; preserve them.
    // For claude runner they remain undefined.
  };

  // Step 7: Persist session (codex only, stillActivePhase guard)
  if (runner === 'codex' && state.currentPhase === phase) {
    if (result.codexSessionId !== undefined) {
      const lastOutcome: 'approve' | 'reject' | 'error' =
        result.type === 'verdict'
          ? (result.verdict === 'APPROVE' ? 'approve' : 'reject')
          : 'error';
      state.phaseCodexSessions[phaseKey] = {
        sessionId: result.codexSessionId,
        runner: 'codex',
        model: preset.model,
        effort: preset.effort,
        lastOutcome,
      };
    } else if (result.resumeFallback === true) {
      // Resume → fallback → no new sessionId: stale id already invalid, clear slot
      state.phaseCodexSessions[phaseKey] = null;
    }
    try { writeState(runDir, state); } catch { /* best-effort */ }
  }

  // Step 8: Write extended sidecar (with sourcePreset for future replay compat)
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
    ...(runner === 'codex' ? { sourcePreset: { model: preset.model, effort: preset.effort } } : {}),
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
