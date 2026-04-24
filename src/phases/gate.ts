import fs from 'fs';
import path from 'path';
import type { HarnessState, GatePhaseResult, GateResult, GateSessionInfo } from '../types.js';
import { assembleGatePrompt, assembleGateResumePrompt } from '../context/assembler.js';
import { getPresetById } from '../config.js';
import { runClaudeGate } from '../runners/claude.js';
import { runCodexGate } from '../runners/codex.js';
import { ensureCodexIsolation, CodexIsolationError } from '../runners/codex-isolation.js';
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
        // (B) Hydration gate — codex-only, requires non-empty trimmed sessionId + empty state slot.
        // §4.1: sessionId validation ('trimmed non-empty') applies at every use site, including
        // sidecar hydration — malformed sidecar JSON with "" / whitespace-only id must be rejected.
        const canHydrate =
          typeof replay.codexSessionId === 'string' &&
          replay.codexSessionId.trim().length > 0 &&
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
          // §5: persistence of phaseCodexSessions must NOT be silently best-effort.
          // If writeState fails here, surface a gate error so resume state cannot
          // silently diverge from the sidecar hydration.
          try {
            writeState(runDir, state);
          } catch (err) {
            return {
              type: 'error',
              error: `Failed to persist phaseCodexSessions during sidecar hydration (phase ${phase}): ${(err as Error).message}`,
              rawOutput: replay.type === 'verdict' ? replay.rawOutput : (replay.rawOutput ?? ''),
            };
          }
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

  // Defense-in-depth: 비호환이면 저장된 세션 null 처리. §5: persistence must not
  // silently fail — a dropped null here would let a stale incompatible session
  // linger for the next run.
  if (savedSession !== null && !savedCompatible) {
    state.phaseCodexSessions[phaseKey] = null;
    try {
      writeState(runDir, state);
    } catch (err) {
      return {
        type: 'error',
        error: `Failed to persist phaseCodexSessions after incompatible-session clear (phase ${phase}): ${(err as Error).message}`,
      };
    }
  }

  // Step 5: Assemble prompt (resume vs fresh)
  let prompt: string;
  let resumeSessionId: string | null = null;
  let buildFreshPromptOnFallback: (() => string | { error: string }) | undefined;

  if (savedCompatible && savedSession !== null) {
    resumeSessionId = savedSession.sessionId;
    // §4.4: when lastOutcome=reject, Variant A is mandatory; if feedback file is
    // missing we pass a placeholder so Variant A still selects (per-spec anomaly).
    // Feedback content only suppresses Variant A when lastOutcome !== 'reject'.
    let previousFeedback = '';
    if (savedSession.lastOutcome === 'reject') {
      try {
        previousFeedback = fs.readFileSync(sidecarFeedback(runDir, phase), 'utf-8');
      } catch {
        previousFeedback = '(feedback file missing despite lastOutcome=reject — spec anomaly)';
      }
    }
    const resumePromptResult = assembleGateResumePrompt(
      phase, state, cwd, savedSession.lastOutcome, previousFeedback, runDir,
    );
    if (typeof resumePromptResult !== 'string') {
      return { type: 'error', error: resumePromptResult.error };
    }
    prompt = resumePromptResult;
    // Closure used by runner on session_missing fallback.
    // §4.4 + §4.10: reject fresh fallback if the phase has been redirected (jump/skip)
    // while the gate was in flight — avoid re-arming sidecars after invalidation.
    buildFreshPromptOnFallback = () => {
      if (state.currentPhase !== phase) {
        return { error: `Phase ${phase} redirected to ${state.currentPhase} during gate; skipping fresh fallback` };
      }
      return assembleGatePrompt(phase, state, harnessDir, cwd);
    };
  } else {
    const promptResult = assembleGatePrompt(phase, state, harnessDir, cwd);
    if (typeof promptResult === 'object' && 'error' in promptResult) {
      return { type: 'error', error: promptResult.error };
    }
    prompt = promptResult as string;
  }

  const promptBytes = Buffer.byteLength(prompt, 'utf8');

  // Step 6: Dispatch to runner.
  // For codex runner, bootstrap the per-run CODEX_HOME isolation (unless
  // user opted out via --codex-no-isolate). CodexIsolationError aborts the
  // gate hard (no retry) — surfacing as a gate error is preferable to
  // silent fallback to the user's real ~/.codex (re-exposes BUG-C).
  const runner = preset.runner;
  let codexHome: string | null = null;
  if (runner === 'codex' && !state.codexNoIsolate) {
    try {
      codexHome = ensureCodexIsolation(runDir);
    } catch (err) {
      if (err instanceof CodexIsolationError) {
        return { type: 'error', error: err.message, runner: 'codex' };
      }
      throw err;
    }
  }
  const runStartedAt = Date.now();
  const rawResult = runner === 'claude'
    ? await runClaudeGate(phase, preset, prompt, harnessDir, cwd)
    : await runCodexGate(
        phase, preset, prompt, harnessDir, cwd, resumeSessionId, buildFreshPromptOnFallback,
        codexHome,
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

  // §4.4 step 6 / §4.10: redirect guard before ANY result application.
  // If SIGUSR1 jump/skip changed state.currentPhase while the gate was in-flight,
  // return the raw result without touching state or writing sidecars — the
  // invalidation hook may already have deleted replay sidecars and nulled
  // phaseCodexSessions[phase]. Writing here would re-arm stale replay.
  if (state.currentPhase !== phase) {
    return result;
  }

  // Step 7: Persist session (codex only, stillActivePhase guard).
  // §4.4 persist rules (order matters):
  //   1. If resumeFallback=true, the prior session lineage is proven stale —
  //      clear the slot first, before considering the returned id.
  //   2. Only save a new lineage when the returned id is (a) non-empty
  //      (trimmed, per §4.1) AND (b) genuinely different from the stale id
  //      (i.e. NOT a metadata carry-forward of the dead session).
  //      If resumeFallback=true and the id is empty/undefined or equal to
  //      resumedFrom, the slot stays cleared.
  if (runner === 'codex' && state.currentPhase === phase) {
    if (result.resumeFallback === true) {
      state.phaseCodexSessions[phaseKey] = null;
    }
    const newSessionId = result.codexSessionId;
    const isValidNewId = typeof newSessionId === 'string' && newSessionId.trim().length > 0;
    // Carry-forward guard: on resumeFallback=true, reject an id that matches
    // the stale resumedFrom — that would re-persist the dead lineage.
    const isStaleCarryforward =
      result.resumeFallback === true &&
      typeof result.resumedFrom === 'string' &&
      newSessionId === result.resumedFrom;
    if (isValidNewId && !isStaleCarryforward) {
      const lastOutcome: 'approve' | 'reject' | 'error' =
        result.type === 'verdict'
          ? (result.verdict === 'APPROVE' ? 'approve' : 'reject')
          : 'error';
      state.phaseCodexSessions[phaseKey] = {
        sessionId: newSessionId!,
        runner: 'codex',
        model: preset.model,
        effort: preset.effort,
        lastOutcome,
      };
    }
    // §5: post-run persistence of the new session lineage is load-bearing for
    // the next retry's resume decision. Surface write failures as gate errors
    // instead of continuing with an in-memory/disk divergence.
    try {
      writeState(runDir, state);
    } catch (err) {
      return {
        ...result,
        type: 'error',
        error: `Gate succeeded but failed to persist phaseCodexSessions (phase ${phase}): ${(err as Error).message}. Result: ${result.type === 'verdict' ? result.verdict : 'error'}`,
        rawOutput: result.type === 'verdict' ? result.rawOutput : (result.rawOutput ?? ''),
      };
    }
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
