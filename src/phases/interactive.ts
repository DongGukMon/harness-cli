import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import chokidar from 'chokidar';
import type { HarnessState, InteractivePhase, Artifacts } from '../types.js';
import { PHASE_MODELS, PHASE_EFFORTS, PHASE_ARTIFACT_FILES } from '../config.js';
import { writeState } from '../state.js';
import { getHead } from '../git.js';
import { sendKeysToPane, pollForPidFile } from '../tmux.js';
import { isPidAlive } from '../process.js';
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

  // Delete stale interrupt flag (ADR-10: prevent immediate settle on retry)
  const interruptFlagPath = path.join(runDir, `interrupted-${phase}.flag`);
  try { fs.unlinkSync(interruptFlagPath); } catch { /* ignore */ }

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

  // Step 3: Spawn Claude in workspace pane via send-keys
  printAdvisorReminder(phase);
  await new Promise<void>((resolve) => setTimeout(resolve, 300));

  const sessionName = updatedState.tmuxSession;
  const workspacePane = updatedState.tmuxWorkspacePane;

  // Ctrl-C pre-send to clear any in-progress input (ADR-4)
  sendKeysToPane(sessionName, workspacePane, 'C-c');
  await new Promise<void>((resolve) => setTimeout(resolve, 300));

  // PID file (phase/attempt scoped)
  const pidFile = path.join(runDir, `claude-${phase}-${updatedState.phaseAttemptId[String(phase)]}.pid`);
  if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);

  // Launch Claude via exec wrapper (PID file = Claude's PID)
  const claudeArgs = `--dangerously-skip-permissions --model ${PHASE_MODELS[phase]} --effort ${PHASE_EFFORTS[phase]} @${path.resolve(promptFile)}`;
  const wrappedCmd = `sh -c 'echo $$ > ${pidFile}; exec claude ${claudeArgs}'`;
  sendKeysToPane(sessionName, workspacePane, wrappedCmd);

  // Capture Claude PID
  const claudePid = await pollForPidFile(pidFile, 5000);

  const sentinelPath = path.join(runDir, `phase-${phase}.done`);
  const attemptId = updatedState.phaseAttemptId[String(phase)] ?? '';

  const phaseResult = await waitForPhaseCompletion(
    sentinelPath, attemptId, claudePid, phase, updatedState, cwd, runDir
  );

  return phaseResult;
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
