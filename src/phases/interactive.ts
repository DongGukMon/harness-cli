import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import chokidar from 'chokidar';
import type { HarnessState, InteractivePhase, Artifacts } from '../types.js';
import { PHASE_MODELS, PHASE_EFFORTS, PHASE_ARTIFACT_FILES } from '../config.js';
import { writeState } from '../state.js';
import { getHead } from '../git.js';
import { createWindow, selectWindow, killWindow, windowExists } from '../tmux.js';
import { assembleInteractivePrompt } from '../context/assembler.js';
import { printAdvisorReminder } from '../ui.js';

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
  cwd: string
): HarnessState {
  void harnessDir;

  // Delete existing sentinel if present
  const sentinelPath = path.join(runDir, `phase-${phase}.done`);
  try { fs.unlinkSync(sentinelPath); } catch { /* ignore */ }

  // Phase 1/3: delete output artifact files to prevent stale mtime
  const artifactKeys = PHASE_ARTIFACT_FILES[phase] as (keyof Artifacts)[] | undefined;
  if (artifactKeys) {
    for (const key of artifactKeys) {
      const relPath = state.artifacts[key];
      const absPath = path.isAbsolute(relPath) ? relPath : path.join(cwd, relPath);
      try { fs.unlinkSync(absPath); } catch { /* ignore */ }
    }
  }

  // Mutate state in place so the caller's reference sees the updates
  state.phaseAttemptId = { ...state.phaseAttemptId, [String(phase)]: randomUUID() };
  state.phaseOpenedAt = {
    ...state.phaseOpenedAt,
    [String(phase)]: Math.floor(Date.now() / 1000) * 1000,
  };

  // Phase 5: update implRetryBase to current HEAD
  if (phase === 5) {
    state.implRetryBase = getHead(cwd);
  }

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
    const artifactKeys = PHASE_ARTIFACT_FILES[phase] as (keyof Artifacts)[] | undefined;
    if (!artifactKeys) return false;

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

    return true;
  }

  if (phase === 5) {
    try {
      const head = execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8' }).trim();
      const base = state.implRetryBase;
      // HEAD must have advanced beyond the retry base
      if (head === base) return false;

      // Working tree must be clean
      const status = execSync('git status --porcelain', { cwd, encoding: 'utf-8' }).trim();
      return status === '';
    } catch {
      return false;
    }
  }

  return false;
}

/** Validate checklist.json matches spec schema: `{ checks: [{ name, command }] }`. */
export function isValidChecklistSchema(absPath: string): boolean {
  try {
    const raw = fs.readFileSync(absPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.checks) || parsed.checks.length === 0) return false;
    for (const check of parsed.checks) {
      if (typeof check?.name !== 'string' || typeof check?.command !== 'string') return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Run an interactive phase. Spawns Claude subprocess, watches for sentinel + artifacts.
 */
export async function runInteractivePhase(
  phase: InteractivePhase,
  state: HarnessState,
  harnessDir: string,
  runDir: string,
  cwd: string
): Promise<InteractiveResult> {
  // Step 1: Pre-spawn cleanup + state update
  const updatedState = preparePhase(phase, state, harnessDir, runDir, cwd);

  // Step 2: Assemble prompt and write to file
  const prompt = assembleInteractivePrompt(phase, updatedState, harnessDir);
  const promptFile = path.join(runDir, `phase-${phase}-init-prompt.md`);
  fs.writeFileSync(promptFile, prompt, 'utf-8');

  // Step 3: Spawn Claude in a tmux window
  printAdvisorReminder(phase);
  await new Promise<void>((resolve) => setTimeout(resolve, 300));

  const sessionName = state.tmuxSession;
  const windowName = `phase-${phase}`;
  const claudeCmd = [
    'claude',
    '--dangerously-skip-permissions',
    '--model', PHASE_MODELS[phase],
    '--effort', PHASE_EFFORTS[phase],
    '@' + path.resolve(promptFile),
  ].join(' ');

  const windowId = createWindow(sessionName, windowName, claudeCmd);
  state.tmuxWindows.push(windowId);
  writeState(runDir, state);
  selectWindow(sessionName, windowId);

  const sentinelPath = path.join(runDir, `phase-${phase}.done`);
  const attemptId = updatedState.phaseAttemptId[String(phase)] ?? '';

  const phaseResult = await waitForPhaseCompletion(
    sessionName,
    windowId,
    sentinelPath,
    attemptId,
    phase,
    updatedState,
    cwd
  );

  return phaseResult;
}

/**
 * Wait for sentinel file or tmux window death.
 * Uses chokidar for filesystem watching plus polling for window existence.
 */
async function waitForPhaseCompletion(
  sessionName: string,
  windowId: string,
  sentinelPath: string,
  attemptId: string,
  phase: InteractivePhase,
  state: HarnessState,
  cwd: string
): Promise<InteractiveResult> {
  return new Promise<InteractiveResult>((resolve) => {
    let settled = false;
    let watcher: ReturnType<typeof chokidar.watch> | null = null;

    function settle(status: 'completed' | 'failed'): void {
      if (settled) return;
      settled = true;
      if (watcher) {
        void watcher.close();
        watcher = null;
      }
      // Kill the Claude window + return focus to control
      killWindow(sessionName, windowId);
      selectWindow(sessionName, state.tmuxControlWindow || '0');
      resolve({ status });
    }

    // Sentinel detection → kill window → evaluate
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

    // Also poll for tmux window death (user did /exit without sentinel)
    const pollInterval = setInterval(() => {
      if (settled) {
        clearInterval(pollInterval);
        return;
      }
      if (!windowExists(sessionName, windowId)) {
        clearInterval(pollInterval);
        // Window died — check sentinel one last time
        const freshness = checkSentinelFreshness(sentinelPath, attemptId);
        if (freshness === 'fresh') {
          const valid = validatePhaseArtifacts(phase, state, cwd);
          settle(valid ? 'completed' : 'failed');
        } else {
          settle('failed');
        }
      }
    }, 1000);

    // Immediate check
    if (fs.existsSync(sentinelPath)) {
      onSentinelDetected();
    }
  });
}
