import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import chokidar from 'chokidar';
import type { HarnessState, InteractivePhase, Artifacts } from '../types.js';
import { getPhaseArtifactFiles, getPresetById } from '../config.js';
import { writeState, syncLegacyMirror } from '../state.js';
import { getHead } from '../git.js';
import { isPidAlive } from '../process.js';
import { assembleInteractivePrompt } from '../context/assembler.js';
import { runClaudeInteractive } from '../runners/claude.js';
import { isValidChecklistSchema } from './checklist.js';
import { resolveArtifact } from '../artifact.js';

/**
 * Inline Complexity-section check (spec R5). Kept here instead of importing
 * from assembler.ts so interactive.test.ts's `vi.mock('../context/assembler.js')`
 * can't wipe it out. Logic mirrors `parseComplexitySignal` in assembler.ts —
 * if either drifts, the E2E tests in assembler.test.ts should catch it.
 */
function specHasValidComplexity(specBody: string): boolean {
  // Spec Goal 1: "exactly one `## Complexity` section." Count matches before
  // reading the body token.
  const allHeaders = specBody.match(/^##\s+Complexity\s*$/gm);
  if (!allHeaders || allHeaders.length !== 1) return false;
  const headerMatch = specBody.match(/^##\s+Complexity\s*$/m);
  if (!headerMatch) return false;
  const offset = (headerMatch.index ?? 0) + headerMatch[0].length;
  const remainder = specBody.slice(offset);
  for (const rawLine of remainder.split('\n')) {
    const line = rawLine.trim();
    if (line === '') continue;
    return /^(small|medium|large)\b/i.test(line);
  }
  return false;
}

export interface InteractiveResult {
  status: 'completed' | 'failed';
}

/**
 * Pre-spawn cleanup and state preparation for an interactive phase.
 * **Mutates the state object in place** so callers retain prepared fields
 * (phaseAttemptId, phaseOpenedAt, implRetryBase). Also writes state atomically.
 * Returns the same state object for convenience.
 */
export function preparePhase(
  phase: InteractivePhase,
  state: HarnessState,
  harnessDir: string,
  runDir: string,
  cwd: string,
  isReopen: boolean = false,
): HarnessState {
  void harnessDir;

  // Always delete sentinel + interrupt flag
  const sentinelPath = path.join(runDir, `phase-${phase}.done`);
  try { fs.unlinkSync(sentinelPath); } catch { /* ignore */ }
  const interruptFlagPath = path.join(runDir, `interrupted-${phase}.flag`);
  try { fs.unlinkSync(interruptFlagPath); } catch { /* ignore */ }

  // Delete artifacts only on first run (not reopen)
  if (!isReopen) {
    const artifactKeys = getPhaseArtifactFiles(state.flow, phase);
    for (const key of artifactKeys) {
      const relPath = state.artifacts[key];
      if (!relPath) continue;
      const absPath = resolveArtifact(state, relPath, cwd);
      try { fs.unlinkSync(absPath); } catch { /* ignore */ }
    }
  }

  if (!state.phaseAttemptId[String(phase)]) {
    state.phaseAttemptId = { ...state.phaseAttemptId, [String(phase)]: randomUUID() };
  }
  state.phaseOpenedAt = {
    ...state.phaseOpenedAt,
    [String(phase)]: Math.floor(Date.now() / 1000) * 1000,
  };

  // Phase 5: update implRetryBase for each tracked repo to current HEAD.
  // implHead is intentionally preserved so the symmetric-reopen path (ADR-13,
  // phase-5 prompt invariant: "reopen 시 artifact를 변경하지 않아도 phase는 valid")
  // can actually fire in validatePhaseArtifacts. Wiping it here killed that path.
  if (phase === 5) {
    for (const r of state.trackedRepos) {
      try { r.implRetryBase = getHead(r.path); } catch { /* no git */ }
    }
    syncLegacyMirror(state);
  }

  // Clear the reopen flag after using it
  state.phaseReopenFlags = { ...state.phaseReopenFlags, [String(phase)]: false };

  writeState(runDir, state);
  return state;
}

/**
 * Check sentinel freshness: reads file content and compares to expected attemptId.
 * Returns 'fresh' | 'stale' | 'missing'.
 */
export function checkSentinelFreshness(
  sentinelPath: string,
  expectedAttemptId: string
): 'fresh' | 'stale' | 'missing' {
  try {
    const content = fs.readFileSync(sentinelPath, 'utf-8').trim();
    return content === expectedAttemptId ? 'fresh' : 'stale';
  } catch {
    return 'missing';
  }
}

/**
 * Validate artifacts for the completed phase.
 * Phase 1/3: check existence + non-empty (reopen-aware per ADR-13; freshness
 * is carried by sentinel attemptId alone — no mtime staleness heuristic).
 * Phase 5: success when HEAD has advanced past `implRetryBase`, or when the
 * sentinel was written during a reopen with `implCommit` already set
 * (verify-failure case where only gitignored fixes are needed). Working-tree
 * cleanliness is no longer enforced — see 2026-04-19 spec.
 */
export function validatePhaseArtifacts(
  phase: number,
  state: HarnessState,
  cwd: string,
  runDir: string,
): boolean {
  if (phase === 2 || phase === 4 || phase === 7) {
    return true; // gate completion is sentinel-only; caller verifies verdict file separately
  }
  if (phase === 1 || phase === 3) {
    const artifactKeys = getPhaseArtifactFiles(state.flow, phase);
    if (artifactKeys.length === 0) return false;

    for (const key of artifactKeys) {
      const relPath = state.artifacts[key];
      const absPath = resolveArtifact(state, relPath, cwd);
      try {
        const stat = fs.statSync(absPath);
        // Must be non-empty. Freshness is proven by sentinel attemptId, not mtime:
        // reopens may legitimately leave artifacts untouched (rev-invariant case).
        if (stat.size === 0) return false;
      } catch {
        // File doesn't exist
        return false;
      }
    }

    // Phase 3: validate checklist.json schema
    if (phase === 3) {
      const checklistPath = resolveArtifact(state, state.artifacts.checklist, cwd);
      if (!isValidChecklistSchema(checklistPath)) return false;
    }

    // Phase 1 (both full + light flows): spec must contain a valid
    // `## Complexity` section with one of Small/Medium/Large (spec R5).
    if (phase === 1) {
      const specPath = resolveArtifact(state, state.artifacts.spec, cwd);
      try {
        const body = fs.readFileSync(specPath, 'utf-8');
        if (!specHasValidComplexity(body)) return false;
      } catch {
        return false;
      }
    }

    // Light + phase 1: checklist schema + '## Implementation Plan' header
    if (state.flow === 'light' && phase === 1) {
      const checklistPath = resolveArtifact(state, state.artifacts.checklist, cwd);
      if (!isValidChecklistSchema(checklistPath)) return false;

      const specPath = resolveArtifact(state, state.artifacts.spec, cwd);
      try {
        const body = fs.readFileSync(specPath, 'utf-8');
        if (!/^##\s+Implementation\s+Plan\s*$/m.test(body)) return false;
      } catch {
        return false;
      }
    }

    return true;
  }

  if (phase === 5) {
    void runDir;
    try {
      // Refresh implHead to current HEAD for any repo that advanced this phase.
      // Repos that did not advance keep their prior implHead value (preserved by
      // preparePhase), so a successful fresh phase 5 followed by a rev-invariant
      // reopen continues to validate.
      let anyAdvanced = false;
      for (const r of state.trackedRepos) {
        const h = getHead(r.path);
        if (h !== r.implRetryBase) {
          r.implHead = h;
          anyAdvanced = true;
        }
      }
      syncLegacyMirror(state); // sets state.implCommit = trackedRepos[0].implHead

      // Accept when:
      //   (a) at least one repo advanced past implRetryBase this phase, OR
      //   (b) a prior attempt already set implHead on some repo
      //       (symmetric reopen — reviewer feedback was rev-invariant so no
      //        new commits were required).
      return anyAdvanced || state.trackedRepos.some(r => r.implHead !== null);
    } catch {
      return false;
    }
  }

  return false;
}

export { isValidChecklistSchema } from './checklist.js';

/**
 * Run an interactive phase. Dispatches to claude or codex runner based on preset.
 */
export async function runInteractivePhase(
  phase: InteractivePhase,
  state: HarnessState,
  harnessDir: string,
  runDir: string,
  cwd: string,
  attemptId: string,
  resume: boolean = false,
): Promise<InteractiveResult & { attemptId: string }> {
  // Pre-set attemptId before preparePhase so it can respect the caller-assigned ID
  state.phaseAttemptId[String(phase)] = attemptId;
  writeState(runDir, state);

  const isReopen = state.phaseReopenFlags[String(phase)] ?? false;
  const updatedState = preparePhase(phase, state, harnessDir, runDir, cwd, isReopen);

  // Resolve preset
  const presetId = updatedState.phasePresets[String(phase)];
  const preset = getPresetById(presetId);
  if (!preset) {
    return { status: 'failed', attemptId };
  }

  // Assemble prompt and write to file
  const prompt = assembleInteractivePrompt(phase, updatedState, harnessDir, cwd);
  const promptFile = path.join(runDir, `phase-${phase}-init-prompt.md`);
  fs.writeFileSync(promptFile, prompt, 'utf-8');

  // Dispatch to runner
  if (preset.runner === 'claude') {
    const { pid: claudePid } = await runClaudeInteractive(
      phase, updatedState, preset, harnessDir, runDir, promptFile, cwd, resume,
    );
    const sentinelPath = path.join(runDir, `phase-${phase}.done`);
    const resolvedAttemptId = updatedState.phaseAttemptId[String(phase)] ?? attemptId;
    const result = await waitForPhaseCompletion(
      sentinelPath, resolvedAttemptId, claudePid, phase, updatedState, cwd, runDir
    );
    return { ...result, attemptId };
  } else {
    const { runCodexInteractive } = await import('../runners/codex.js');
    const { ensureCodexIsolation, CodexIsolationError } =
      await import('../runners/codex-isolation.js');

    // Bootstrap per-run CODEX_HOME isolation unless user opted out.
    // Failure → phase fails with a sidecar error; runner never spawns.
    let codexHome: string | null = null;
    if (!updatedState.codexNoIsolate) {
      try {
        codexHome = ensureCodexIsolation(runDir);
      } catch (err) {
        if (err instanceof CodexIsolationError) {
          const errorPath = path.join(runDir, `codex-${phase}-error.md`);
          try {
            fs.writeFileSync(
              errorPath,
              `# Codex Phase ${phase} Error\n\nCODEX_HOME isolation bootstrap failed.\n\n${err.message}\n`,
            );
          } catch { /* best-effort */ }
          return { status: 'failed', attemptId };
        }
        throw err;
      }
    }

    const result = await runCodexInteractive(
      phase, updatedState, preset, harnessDir, runDir, promptFile, cwd, codexHome,
    );
    if (result.status === 'failed') {
      return { status: 'failed', attemptId };
    }
    // Validate artifacts after Codex completes
    const valid = validatePhaseArtifacts(phase, updatedState, cwd, runDir);
    return { status: valid ? 'completed' : 'failed', attemptId };
  }
}

/**
 * Wait for sentinel file or Claude PID death.
 * Uses chokidar for filesystem watching plus polling for PID liveness.
 * Also responds to interrupt flags written by SIGUSR1 (skip/jump control).
 */
export async function waitForPhaseCompletion(
  sentinelPath: string,
  attemptId: string,
  claudePid: number | null,
  phase: number,
  state: HarnessState,
  cwd: string,
  runDir: string
): Promise<InteractiveResult> {
  return new Promise<InteractiveResult>((resolve) => {
    let settled = false;
    let watcher: ReturnType<typeof chokidar.watch> | null = null;
    let sentinelPollInterval: ReturnType<typeof setInterval> | null = null;
    let pidPollInterval: ReturnType<typeof setInterval> | null = null;
    let interruptPollInterval: ReturnType<typeof setInterval> | null = null;
    let nullPidTimeout: ReturnType<typeof setTimeout> | null = null;

    function settle(status: 'completed' | 'failed'): void {
      if (settled) return;
      settled = true;
      if (watcher) {
        void watcher.close();
        watcher = null;
      }
      if (sentinelPollInterval !== null) {
        clearInterval(sentinelPollInterval);
        sentinelPollInterval = null;
      }
      if (pidPollInterval !== null) {
        clearInterval(pidPollInterval);
        pidPollInterval = null;
      }
      if (interruptPollInterval !== null) {
        clearInterval(interruptPollInterval);
        interruptPollInterval = null;
      }
      if (nullPidTimeout !== null) {
        clearTimeout(nullPidTimeout);
        nullPidTimeout = null;
      }
      // Workspace pane persists — no kill/select needed
      resolve({ status });
    }

    // Sentinel detection → evaluate artifacts
    function onSentinelDetected(): void {
      if (settled) return;
      const freshness = checkSentinelFreshness(sentinelPath, attemptId);
      if (freshness === 'fresh') {
        const valid = validatePhaseArtifacts(phase, state, cwd, runDir);
        settle(valid ? 'completed' : 'failed');
      }
    }

    // Set up chokidar watcher on sentinel path
    watcher = chokidar.watch(sentinelPath, {
      persistent: true,
      ignoreInitial: false,
      usePolling: true,
      interval: 200,
    });

    watcher.on('add', onSentinelDetected);
    watcher.on('change', onSentinelDetected);

    // Backstop for watcher misses. In tmux-based interactive phases Claude
    // normally stays alive after writing phase-N.done, so PID death is not a
    // completion signal. Polling the sentinel path keeps the harness advancing
    // even if a chokidar event is missed or delayed for a newly-created file.
    sentinelPollInterval = setInterval(onSentinelDetected, 500);

    // PID death polling (1s): when Claude exits, check sentinel one last time
    if (claudePid !== null) {
      pidPollInterval = setInterval(() => {
        if (settled) {
          clearInterval(pidPollInterval!);
          pidPollInterval = null;
          return;
        }
        if (!isPidAlive(claudePid)) {
          clearInterval(pidPollInterval!);
          pidPollInterval = null;
          // PID died — check sentinel one last time
          const freshness = checkSentinelFreshness(sentinelPath, attemptId);
          if (freshness === 'fresh') {
            const valid = validatePhaseArtifacts(phase, state, cwd, runDir);
            settle(valid ? 'completed' : 'failed');
          } else {
            settle('failed');
          }
        }
      }, 1000);
    }

    // Interrupt flag polling (500ms): SIGUSR1-driven skip/jump
    const interruptFlagPath = path.join(runDir, `interrupted-${phase}.flag`);
    interruptPollInterval = setInterval(() => {
      if (settled) {
        clearInterval(interruptPollInterval!);
        interruptPollInterval = null;
        return;
      }
      if (fs.existsSync(interruptFlagPath)) {
        try { fs.unlinkSync(interruptFlagPath); } catch { /* ignore */ }
        if (claudePid === null) {
          // No known PID — settle immediately
          settle('failed');
        } else {
          // Grace period: wait up to 3s for PID to die naturally, then settle
          const graceStart = Date.now();
          const graceInterval = setInterval(() => {
            if (settled) {
              clearInterval(graceInterval);
              return;
            }
            if (!isPidAlive(claudePid) || Date.now() - graceStart >= 3000) {
              clearInterval(graceInterval);
              settle('failed');
            }
          }, 100);
        }
      }
    }, 500);

    // Sentinel-only timeout: 10 minutes when claudePid is null
    if (claudePid === null) {
      nullPidTimeout = setTimeout(() => {
        settle('failed');
      }, 10 * 60 * 1000);
    }

    // Immediate check
    if (fs.existsSync(sentinelPath)) {
      onSentinelDetected();
    }
  });
}
