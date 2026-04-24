import fs from 'fs';
import os from 'os';
import path from 'path';
import type { HarnessState, GatePhaseResult, GateResult, GateSessionInfo, ClaudeTokens } from '../types.js';
import { assembleGatePrompt, assembleGateResumePrompt } from '../context/assembler.js';
import { getPresetById, SIGTERM_WAIT_MS } from '../config.js';
import type { ModelPreset } from '../config.js';
import { runClaudeGate } from '../runners/claude.js';
import { spawnCodexInPane } from '../runners/codex.js';
import { ensureCodexIsolation, CodexIsolationError } from '../runners/codex-isolation.js';
import { writeState } from '../state.js';
import { readCodexSessionUsage } from '../runners/codex-usage.js';
import { parseVerdict, buildGateResult, buildGateResultFromFile } from './verdict.js';
import { waitForPhaseCompletion } from './interactive.js';
import { sendKeysToPane } from '../tmux.js';
import { killProcessGroup } from '../process.js';
export { parseVerdict, buildGateResult, buildGateResultFromFile } from './verdict.js';

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

function _persistCodexSession(
  state: HarnessState,
  phase: 2 | 4 | 7,
  result: GatePhaseResult,
  resumeSessionId: string | null,
  codexSessionId: string | undefined,
  preset: ModelPreset,
  runDir: string,
): void {
  const phaseKey = String(phase) as GatePhaseKey;
  if (result.resumeFallback === true) {
    state.phaseCodexSessions[phaseKey] = null;
  }
  const isValidId = typeof codexSessionId === 'string' && codexSessionId.trim().length > 0;
  const isStaleCarryforward =
    result.resumeFallback === true &&
    typeof resumeSessionId === 'string' &&
    codexSessionId === resumeSessionId;
  if (isValidId && !isStaleCarryforward) {
    const lastOutcome: 'approve' | 'reject' | 'error' =
      result.type === 'verdict'
        ? (result.verdict === 'APPROVE' ? 'approve' : 'reject')
        : 'error';
    state.phaseCodexSessions[phaseKey] = {
      sessionId: codexSessionId!,
      runner: 'codex',
      model: preset.model,
      effort: preset.effort,
      lastOutcome,
    };
  }
  try { writeState(runDir, state); } catch { /* best-effort: callers handle null session */ }
}

async function _persistSidecars(
  result: GatePhaseResult,
  runDir: string,
  phase: number,
  runner: 'claude' | 'codex',
  promptBytes: number,
  durationMs: number,
  preset: ModelPreset,
  codexSessionIdOverride?: string,
): Promise<void> {
  const rawPath = path.join(runDir, `gate-${phase}-raw.txt`);
  const resultPath = path.join(runDir, `gate-${phase}-result.json`);
  const errorPath = path.join(runDir, `gate-${phase}-error.md`);

  const stdout = result.type === 'verdict' ? result.rawOutput : (result.rawOutput ?? '');
  const exitCode = result.type === 'verdict' ? 0 : 1;
  const effectiveSessionId = codexSessionIdOverride ?? result.codexSessionId;
  const gateResult: GateResult = {
    exitCode,
    timestamp: Date.now(),
    runner,
    promptBytes,
    durationMs,
    ...(result.tokensTotal !== undefined ? { tokensTotal: result.tokensTotal } : {}),
    ...(effectiveSessionId !== undefined ? { codexSessionId: effectiveSessionId } : {}),
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
        `# Gate ${phase} Error\n\nError: ${result.error}\n\n## Output\n\n\`\`\`\n${stdout}\n\`\`\`\n`,
      );
    } catch { /* best-effort */ }
  }
}

/**
 * Run a gate phase using tmux workspace pane + sentinel protocol (R1-R4).
 * Handles sidecar replay, resume-session logic, pane injection, and verdict file reading.
 * Replaces the subprocess path for codex-runner gates.
 */
export async function runGatePhaseInteractive(
  phase: 2 | 4 | 7,
  state: HarnessState,
  harnessDir: string,
  runDir: string,
  cwd: string,
  allowSidecarReplay?: { value: boolean },
): Promise<GatePhaseResult & { codexTokens?: ClaudeTokens | null }> {
  const phaseKey = String(phase) as GatePhaseKey;

  // Step 1: One-shot sidecar replay
  if (allowSidecarReplay?.value) {
    allowSidecarReplay.value = false;
    const replay = checkGateSidecars(runDir, phase);
    if (replay !== null) {
      const currentPreset = getPresetById(state.phasePresets[phaseKey]);
      const replayCompatible =
        currentPreset !== undefined &&
        replay.runner !== undefined &&
        replay.runner === currentPreset.runner &&
        (replay.runner === 'claude'
          ? true
          : (replay.sourcePreset?.model === currentPreset.model &&
             replay.sourcePreset?.effort === currentPreset.effort));
      if (replayCompatible) {
        if (
          typeof replay.codexSessionId === 'string' &&
          replay.codexSessionId.trim().length > 0 &&
          replay.runner === 'codex' &&
          state.phaseCodexSessions[phaseKey] === null &&
          currentPreset?.runner === 'codex'
        ) {
          const lastOutcome: 'approve' | 'reject' | 'error' =
            replay.type === 'verdict'
              ? (replay.verdict === 'APPROVE' ? 'approve' : 'reject')
              : 'error';
          state.phaseCodexSessions[phaseKey] = {
            sessionId: replay.codexSessionId!,
            runner: 'codex',
            model: currentPreset!.model,
            effort: currentPreset!.effort,
            lastOutcome,
          };
          try { writeState(runDir, state); } catch (err) {
            return {
              type: 'error',
              error: `Failed to persist phaseCodexSessions during sidecar hydration: ${(err as Error).message}`,
              rawOutput: '',
            };
          }
        }
        return { ...replay, recoveredFromSidecar: true };
      }
    }
  }

  // Step 2: Pre-run cleanup
  const rawPath = path.join(runDir, `gate-${phase}-raw.txt`);
  const resultPath = path.join(runDir, `gate-${phase}-result.json`);
  const errorPath = path.join(runDir, `gate-${phase}-error.md`);
  const verdictPath = path.join(runDir, `gate-${phase}-verdict.md`);
  const sentinelPath = path.join(runDir, `phase-${phase}.done`);
  for (const p of [rawPath, resultPath, errorPath, verdictPath]) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }

  // Step 3: Resolve preset
  const presetId = state.phasePresets[phaseKey];
  const preset = getPresetById(presetId);
  if (!preset) return { type: 'error', error: `Unknown preset for phase ${phase}: ${presetId}` };

  // Step 4: Resume-compatibility check
  const savedSession = state.phaseCodexSessions[phaseKey];
  const savedCompatible =
    savedSession !== null &&
    typeof savedSession.sessionId === 'string' &&
    savedSession.sessionId.trim().length > 0 &&
    savedSession.runner === 'codex' &&
    preset.runner === 'codex' &&
    savedSession.model === preset.model &&
    savedSession.effort === preset.effort;

  if (savedSession !== null && !savedCompatible) {
    state.phaseCodexSessions[phaseKey] = null;
    try { writeState(runDir, state); } catch (err) {
      return { type: 'error', error: `Failed to clear incompatible session: ${(err as Error).message}` };
    }
  }

  // Step 5: Assemble prompt (resume vs fresh) and write to file
  let promptText: string;
  let resumeSessionId: string | null = null;

  if (savedCompatible && savedSession !== null) {
    resumeSessionId = savedSession.sessionId;
    let previousFeedback = '';
    if (savedSession.lastOutcome === 'reject') {
      try { previousFeedback = fs.readFileSync(path.join(runDir, `gate-${phase}-feedback.md`), 'utf-8'); } catch {
        previousFeedback = '(feedback file missing despite lastOutcome=reject)';
      }
    }
    const resumeResult = assembleGateResumePrompt(
      phase, state, cwd, savedSession.lastOutcome, previousFeedback, runDir,
    );
    if (typeof resumeResult !== 'string') return { type: 'error', error: resumeResult.error };
    promptText = resumeResult;
  } else {
    const freshResult = assembleGatePrompt(phase, state, harnessDir, cwd);
    if (typeof freshResult === 'object' && 'error' in freshResult) {
      return { type: 'error', error: freshResult.error };
    }
    promptText = freshResult as string;
  }

  const promptFile = path.join(runDir, `gate-${phase}-prompt.md`);
  fs.writeFileSync(promptFile, promptText, 'utf-8');
  const promptBytes = Buffer.byteLength(promptText, 'utf8');

  // Step 6: Codex isolation setup
  let codexHome: string | null = null;
  if (preset.runner === 'codex' && !state.codexNoIsolate) {
    try { codexHome = ensureCodexIsolation(runDir); }
    catch (err) {
      if (err instanceof CodexIsolationError) return { type: 'error', error: err.message, runner: 'codex' };
      throw err;
    }
  }

  // Step 7: Dispatch to runner
  const runner = preset.runner;
  if (runner === 'claude') {
    const phaseStartTs = Date.now();
    const rawResult = await runClaudeGate(phase, preset, promptText, harnessDir, cwd);
    const durationMs = Date.now() - phaseStartTs;
    const result: GatePhaseResult = { ...rawResult, runner, promptBytes, durationMs };
    if (state.currentPhase !== phase) return result;
    await _persistSidecars(result, runDir, phase, runner, promptBytes, durationMs, preset);
    return result;
  }

  // Purge stale sentinel before spawn
  try { fs.rmSync(sentinelPath, { force: true }); } catch { /* ignore */ }
  if (fs.existsSync(sentinelPath)) {
    return { type: 'error', error: `Pre-spawn sentinel purge failed: ${sentinelPath} still present` };
  }

  const phaseStartTs = Date.now();

  // Codex runner: pane injection path
  const spawnResult = await spawnCodexInPane({
    phase,
    state,
    preset,
    harnessDir,
    runDir,
    promptFile,
    cwd,
    codexHome,
    mode: resumeSessionId ? 'resume' : 'fresh',
    sessionId: resumeSessionId ?? undefined,
  });

  // Step 8: Wait for sentinel using existing waitForPhaseCompletion
  const attemptId = state.phaseAttemptId[String(phase)] ?? '';
  const sentinelResult = await waitForPhaseCompletion(
    sentinelPath, attemptId, spawnResult.pid, phase, state, cwd, runDir,
  );

  // Interrupt TUI and wait for process group to flush JSONL before reading usage
  if (state.tmuxSession && state.tmuxWorkspacePane) {
    sendKeysToPane(state.tmuxSession, state.tmuxWorkspacePane, 'C-c');
    if (spawnResult.pid !== null) {
      // On completed: await to ensure JSONL is flushed before readCodexSessionUsage.
      // On failed: fire-and-forget since we skip JSONL read anyway.
      if (sentinelResult.status === 'completed') {
        await killProcessGroup(spawnResult.pid, SIGTERM_WAIT_MS);
      } else {
        void killProcessGroup(spawnResult.pid, SIGTERM_WAIT_MS);
      }
    }
  }

  const durationMs = Date.now() - phaseStartTs;

  // Step 9: Redirect guard
  if (state.currentPhase !== phase) {
    return { type: 'error', error: `Phase ${phase} interrupted by control signal`, runner: 'codex', promptBytes, durationMs };
  }

  // Step 10: Read verdict file
  let gateResult: GatePhaseResult;
  if (sentinelResult.status === 'failed') {
    gateResult = {
      type: 'error',
      error: `Gate ${phase} failed (timed out or interrupted)`,
      runner: 'codex',
      promptBytes,
      durationMs,
      resumedFrom: resumeSessionId,
      resumeFallback: false,
      sourcePreset: { model: preset.model, effort: preset.effort },
    };
  } else {
    const fileResult = buildGateResultFromFile(verdictPath);
    gateResult = {
      ...fileResult,
      runner: 'codex',
      promptBytes,
      durationMs,
      resumedFrom: resumeSessionId,
      resumeFallback: false,
      sourcePreset: { model: preset.model, effort: preset.effort },
    };
  }

  // Step 11: Collect codexTokens from JSONL
  const effectiveCodexHome = codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex');
  let codexTokens: ClaudeTokens | null | undefined;
  let discoveredSessionId: string | undefined = gateResult.codexSessionId;
  try {
    const usageResult = await readCodexSessionUsage({
      sessionId: resumeSessionId,
      codexHome: effectiveCodexHome,
      phaseStartTs,
    });
    if (usageResult !== null) {
      codexTokens = usageResult.tokens;
      if (!resumeSessionId && usageResult.sessionId) {
        discoveredSessionId = usageResult.sessionId;
      }
    } else {
      codexTokens = null;
    }
  } catch {
    codexTokens = null;
  }

  // Step 12: Persist session + sidecars
  if (state.currentPhase === phase) {
    _persistCodexSession(state, phase, gateResult, resumeSessionId, discoveredSessionId, preset, runDir);
    await _persistSidecars(gateResult, runDir, phase, 'codex', promptBytes, durationMs, preset, discoveredSessionId);
  }

  return { ...gateResult, codexTokens };
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
  return runGatePhaseInteractive(phase, state, harnessDir, runDir, cwd, allowSidecarReplay);
}
