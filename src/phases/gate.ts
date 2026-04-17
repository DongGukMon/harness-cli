import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import type { HarnessState, GatePhaseResult, GateResult } from '../types.js';
import { assembleGatePrompt } from '../context/assembler.js';
import { updateLockChild, clearLockChild } from '../lock.js';
import { GATE_TIMEOUT_MS, SIGTERM_WAIT_MS } from '../config.js';
import { getProcessStartTime, killProcessGroup } from '../process.js';
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

  // Step 4: Spawn subprocess — prompt passed as positional arg (codex companion doesn't read stdin)
  const child = spawn('node', [state.codexPath, 'task', '--effort', 'high', prompt], {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
    cwd,
  });

  const childPid = child.pid!;
  const childStartedAt = getProcessStartTime(childPid);
  updateLockChild(harnessDir, childPid, phase, childStartedAt);

  let stdoutChunks: Buffer[] = [];
  let stderrChunks: Buffer[] = [];

  child.stdout.on('data', (chunk: Buffer) => { stdoutChunks.push(chunk); });
  child.stderr.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk);
    // Stream [codex] progress lines to control panel
    const text = chunk.toString();
    for (const line of text.split('\n')) {
      if (line.includes('[codex]')) {
        process.stderr.write(`  ${line}\n`);
      }
    }
  });

  // Step 5: Wait for exit with timeout
  const result = await new Promise<GatePhaseResult>((resolve) => {
    let settled = false;

    const timeoutHandle = setTimeout(async () => {
      if (settled) return;
      settled = true;

      // Full PGID shutdown: SIGTERM → wait → SIGKILL → confirm ESRCH
      await killProcessGroup(childPid, SIGTERM_WAIT_MS);

      resolve({ type: 'error', error: `Gate phase ${phase} timed out after ${GATE_TIMEOUT_MS}ms` });
    }, GATE_TIMEOUT_MS);

    child.on('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);

      const exitCode = code ?? 1;
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');

      // Write sidecars immediately on exit
      const gateResult: GateResult = {
        exitCode,
        timestamp: Date.now(),
      };
      try {
        fs.writeFileSync(rawPath, stdout);
        fs.writeFileSync(resultPath, JSON.stringify(gateResult, null, 2));
      } catch {
        // best-effort sidecar write
      }

      const phaseResult = buildGateResult(exitCode, stdout, stderr);

      // Write error sidecar on failure
      if (phaseResult.type === 'error') {
        try {
          const errorContent =
            `# Gate ${phase} Error\n\n` +
            `Exit Code: ${exitCode}\n\n` +
            `## stdout\n\n\`\`\`\n${stdout}\n\`\`\`\n\n` +
            `## stderr\n\n\`\`\`\n${stderr}\n\`\`\`\n`;
          fs.writeFileSync(errorPath, errorContent);
        } catch {
          // best-effort
        }
      }

      resolve(phaseResult);
    });

    child.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolve({ type: 'error', error: `Gate subprocess error: ${err.message}` });
    });
  });

  // Step 6: Post-gate cleanup — wait for process group ESRCH, then clear lock
  // (killProcessGroup is idempotent: if already dead, returns immediately)
  await killProcessGroup(childPid, SIGTERM_WAIT_MS);
  try {
    clearLockChild(harnessDir);
  } catch {
    // best-effort
  }

  return result;
}
