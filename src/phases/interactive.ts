import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import chokidar from 'chokidar';
import type { HarnessState, InteractivePhase, Artifacts } from '../types.js';
import { getPhaseArtifactFiles, getPresetById } from '../config.js';
import { writeState } from '../state.js';
import { getHead } from '../git.js';
import { isPidAlive } from '../process.js';
import { assembleInteractivePrompt } from '../context/assembler.js';
import { runClaudeInteractive } from '../runners/claude.js';
import { isValidChecklistSchema } from './checklist.js';

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
      const absPath = path.isAbsolute(relPath) ? relPath : path.join(cwd, relPath);
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

  // Phase 5: update implRetryBase to current HEAD
  if (phase === 5) {
    try { state.implRetryBase = getHead(cwd); } catch { /* no git */ }
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
 * Phase 1/3: check existence, non-empty, and mtime >= phaseOpenedAt.
 * Phase 5: check commits exist (HEAD advanced beyond implRetryBase) and working tree is clean.
 * Returns true if valid.
 */
export function validatePhaseArtifacts(
  phase: InteractivePhase,
  state: HarnessState,
  cwd: string
): boolean {
  if (phase === 1 || phase === 3) {
    const openedAt = state.phaseOpenedAt[String(phase)];
    const artifactKeys = getPhaseArtifactFiles(state.flow, phase);
    if (artifactKeys.length === 0) return false;

    for (const key of artifactKeys) {
      const relPath = state.artifacts[key];
      const absPath = path.isAbsolute(relPath) ? relPath : path.join(cwd, relPath);
      try {
        const stat = fs.statSync(absPath);
        // Must be non-empty
        if (stat.size === 0) return false;
        // mtime must be >= phaseOpenedAt (both in ms)
        if (openedAt !== null && stat.mtimeMs < openedAt) return false;
      } catch {
        // File doesn't exist
        return false;
      }
    }

    // Phase 3: validate checklist.json schema
    if (phase === 3) {
      const checklistPath = path.isAbsolute(state.artifacts.checklist)
        ? state.artifacts.checklist
        : path.join(cwd, state.artifacts.checklist);
      if (!isValidChecklistSchema(checklistPath)) return false;
    }

    // Light + phase 1: checklist schema + '## Implementation Plan' header
    if (state.flow === 'light' && phase === 1) {
      const checklistPath = path.isAbsolute(state.artifacts.checklist)
        ? state.artifacts.checklist
        : path.join(cwd, state.artifacts.checklist);
      if (!isValidChecklistSchema(checklistPath)) return false;

      const specPath = path.isAbsolute(state.artifacts.spec)
        ? state.artifacts.spec
        : path.join(cwd, state.artifacts.spec);
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
    try {
      const head = execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8' }).trim();
      const base = state.implRetryBase;
      const status = execSync('git status --porcelain', { cwd, encoding: 'utf-8' }).trim();
      // Working tree must always be clean
      if (status !== '') return false;
      // HEAD advanced — always valid
      if (head !== base) return true;
      // HEAD did not advance. Accept only on reopen (implCommit already set):
      // a verify-failure reopen may legitimately require only gitignored artifact
      // fixes (e.g., checklist.json) and no further impl commits. First-attempt
      // zero-commit is still rejected to prevent empty sessions passing through.
      return state.implCommit !== null;
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
  const prompt = assembleInteractivePrompt(phase, updatedState, harnessDir);
  const promptFile = path.join(runDir, `phase-${phase}-init-prompt.md`);
  fs.writeFileSync(promptFile, prompt, 'utf-8');

  // Dispatch to runner
  if (preset.runner === 'claude') {
    const { pid: claudePid } = await runClaudeInteractive(
      phase, updatedState, preset, harnessDir, runDir, promptFile,
    );
    const sentinelPath = path.join(runDir, `phase-${phase}.done`);
    const resolvedAttemptId = updatedState.phaseAttemptId[String(phase)] ?? attemptId;
    const result = await waitForPhaseCompletion(
      sentinelPath, resolvedAttemptId, claudePid, phase, updatedState, cwd, runDir
    );
    return { ...result, attemptId };
  } else {
    const { runCodexInteractive } = await import('../runners/codex.js');
    const result = await runCodexInteractive(
      phase, updatedState, preset, harnessDir, runDir, promptFile, cwd,
    );
    if (result.status === 'failed') {
      return { status: 'failed', attemptId };
    }
    // Validate artifacts after Codex completes
    const valid = validatePhaseArtifacts(phase, updatedState, cwd);
    return { status: valid ? 'completed' : 'failed', attemptId };
  }
}

/**
 * Wait for sentinel file or Claude PID death.
 * Uses chokidar for filesystem watching plus polling for PID liveness.
 * Also responds to interrupt flags written by SIGUSR1 (skip/jump control).
 */
async function waitForPhaseCompletion(
  sentinelPath: string,
  attemptId: string,
  claudePid: number | null,
  phase: InteractivePhase,
  state: HarnessState,
  cwd: string,
  runDir: string
): Promise<InteractiveResult> {
  return new Promise<InteractiveResult>((resolve) => {
    let settled = false;
    let watcher: ReturnType<typeof chokidar.watch> | null = null;
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
        const valid = validatePhaseArtifacts(phase, state, cwd);
        settle(valid ? 'completed' : 'failed');
      }
    }

    // Set up chokidar watcher on sentinel path
    watcher = chokidar.watch(sentinelPath, {
      persistent: true,
      ignoreInitial: false,
      usePolling: false,
    });

    watcher.on('add', onSentinelDetected);
    watcher.on('change', onSentinelDetected);

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
            const valid = validatePhaseArtifacts(phase, state, cwd);
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
