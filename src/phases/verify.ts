import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

import type { HarnessState, VerifyOutcome, VerifyResult } from '../types.js';
import { VERIFY_TIMEOUT_MS, SIGTERM_WAIT_MS } from '../config.js';
import { writeState } from '../state.js';
import { updateLockChild, clearLockChild } from '../lock.js';
import { runPhase6Preconditions } from '../artifact.js';
import { killProcessGroup, getProcessStartTime } from '../process.js';
import { resolveVerifyScriptPath } from '../preflight.js';

const VERIFY_RESULT_FILE = 'verify-result.json';
const VERIFY_FEEDBACK_FILE = 'verify-feedback.md';
const VERIFY_ERROR_FILE = 'verify-error.md';

/**
 * Read and parse verify-result.json from runDir.
 * Returns null if missing or corrupt.
 */
export function readVerifyResult(runDir: string): VerifyResult | null {
  const resultPath = path.join(runDir, VERIFY_RESULT_FILE);
  if (!fs.existsSync(resultPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(resultPath, 'utf-8');
    return JSON.parse(raw) as VerifyResult;
  } catch {
    return null;
  }
}

/**
 * Check if eval report is valid: exists, non-empty, and contains "## Summary".
 */
export function isEvalReportValid(reportPath: string): boolean {
  if (!fs.existsSync(reportPath)) {
    return false;
  }
  let content: string;
  try {
    content = fs.readFileSync(reportPath, 'utf-8');
  } catch {
    return false;
  }
  if (content.trim().length === 0) {
    return false;
  }
  return content.includes('## Summary');
}

/**
 * Classify the verify outcome based on exit code, hasSummary, and eval report validity.
 */
function classifyVerifyResult(
  exitCode: number,
  hasSummary: boolean,
  evalReportValid: boolean
): 'pass' | 'fail' | 'error' {
  if (exitCode === 0 && evalReportValid) {
    return 'pass';
  }
  if (exitCode !== 0 && hasSummary) {
    return 'fail';
  }
  return 'error';
}

/**
 * Write verify-result.json to runDir.
 */
function writeVerifyResult(runDir: string, exitCode: number, hasSummary: boolean): void {
  const resultPath = path.join(runDir, VERIFY_RESULT_FILE);
  const data: VerifyResult = { exitCode, hasSummary, timestamp: Date.now() };
  fs.writeFileSync(resultPath, JSON.stringify(data, null, 2));
}

/**
 * Run Phase 6 verification.
 */
export async function runVerifyPhase(
  state: HarnessState,
  harnessDir: string,
  runDir: string,
  cwd: string
): Promise<VerifyOutcome> {
  // Step 1: Delete stale verify-result.json
  const resultPath = path.join(runDir, VERIFY_RESULT_FILE);
  try {
    fs.unlinkSync(resultPath);
  } catch {
    // Ignore if not present
  }

  // Step 2: Run preconditions while phase is still pending
  runPhase6Preconditions(state.artifacts.evalReport, state.runId, cwd);

  // Step 3: Resolve verify script path BEFORE advancing phase state.
  // If the script is missing, fail fast while the phase is still pending —
  // avoids leaving Phase 6 marked in_progress after an unrecoverable resolver miss.
  const scriptPath = resolveVerifyScriptPath();
  if (scriptPath === null) {
    throw new Error('harness-verify.sh not found. Cannot run verification.');
  }

  // Step 4: Advance phase to in_progress (script path confirmed)
  state.phases['6'] = 'in_progress';
  writeState(runDir, state);

  // Step 5: Spawn subprocess
  const child = spawn(
    scriptPath,
    [state.artifacts.checklist, state.artifacts.evalReport],
    { stdio: ['pipe', 'pipe', 'pipe'], detached: true, cwd }
  );

  const childPid = child.pid!;

  // Record childPid in lock
  updateLockChild(harnessDir, childPid, 6, getProcessStartTime(childPid));

  // Collect stdout/stderr
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout!.on('data', (chunk: Buffer) => {
    stdoutChunks.push(chunk);
    // Stream check results to control panel
    const text = chunk.toString();
    if (text.includes('Running:') || text.includes('PASS') || text.includes('FAIL')) {
      process.stderr.write(`  ${text}`);
    }
  });
  child.stderr!.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk);
    // Stream verify progress to control panel
    process.stderr.write(chunk.toString());
  });

  // Wait for exit or timeout
  const outcome = await new Promise<VerifyOutcome>((resolve) => {
    let timedOut = false;

    const timer = setTimeout(async () => {
      timedOut = true;
      await killProcessGroup(childPid, SIGTERM_WAIT_MS);
      writeVerifyResult(runDir, 1, false);
      resolve(buildErrorOutcome(runDir, '', ''));
    }, VERIFY_TIMEOUT_MS);

    child.on('close', (exitCode: number | null) => {
      if (timedOut) return;
      clearTimeout(timer);

      const code = exitCode ?? 1;
      const evalReportAbsPath = path.isAbsolute(state.artifacts.evalReport)
        ? state.artifacts.evalReport
        : path.join(cwd, state.artifacts.evalReport);

      const hasSummary = checkHasSummary(evalReportAbsPath);

      // Write verify-result.json immediately on exit
      writeVerifyResult(runDir, code, hasSummary);

      const evalValid = isEvalReportValid(evalReportAbsPath);
      const classification = classifyVerifyResult(code, hasSummary, evalValid);

      const stdoutStr = Buffer.concat(stdoutChunks).toString('utf-8');
      const stderrStr = Buffer.concat(stderrChunks).toString('utf-8');

      if (classification === 'pass') {
        resolve({ type: 'pass' });
      } else if (classification === 'fail') {
        const feedbackPath = path.join(runDir, VERIFY_FEEDBACK_FILE);
        try {
          fs.copyFileSync(evalReportAbsPath, feedbackPath);
        } catch {
          // If copy fails, degrade to error
          resolve(buildErrorOutcome(runDir, stdoutStr, stderrStr));
          return;
        }
        resolve({ type: 'fail', feedbackPath });
      } else {
        resolve(buildErrorOutcome(runDir, stdoutStr, stderrStr));
      }
    });
  });

  // Step 7: Wait for process group to fully drain (mirror gate/interactive cleanup),
  // then clear lock. harness-verify.sh may spawn arbitrary check subprocesses that
  // can outlive the shell — we must confirm ESRCH before releasing concurrency guard.
  await killProcessGroup(childPid, SIGTERM_WAIT_MS);
  clearLockChild(harnessDir);

  if (outcome.type === 'pass') {
    // Delete verify-error.md on PASS
    const errorPath = path.join(runDir, VERIFY_ERROR_FILE);
    try {
      fs.unlinkSync(errorPath);
    } catch {
      // Ignore if not present
    }
  }

  return outcome;
}

/**
 * Check if the eval report file contains "## Summary".
 * Returns false if the file does not exist or cannot be read.
 */
function checkHasSummary(reportAbsPath: string): boolean {
  if (!fs.existsSync(reportAbsPath)) {
    return false;
  }
  try {
    const content = fs.readFileSync(reportAbsPath, 'utf-8');
    return content.includes('## Summary');
  } catch {
    return false;
  }
}

/**
 * Build an error outcome: write verify-error.md and return the error path.
 */
function buildErrorOutcome(runDir: string, stdout: string, stderr: string): VerifyOutcome {
  const errorPath = path.join(runDir, VERIFY_ERROR_FILE);
  const content = [
    '# Verify Error',
    '',
    '## stdout',
    '```',
    stdout,
    '```',
    '',
    '## stderr',
    '```',
    stderr,
    '```',
  ].join('\n');
  try {
    fs.writeFileSync(errorPath, content);
    return { type: 'error', errorPath };
  } catch {
    return { type: 'error' };
  }
}
