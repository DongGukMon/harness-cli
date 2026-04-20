import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import * as readline from 'readline';
import { checkLockStatus } from './lock.js';
import { killSessionOrThrow } from './tmux.js';

export interface SessionClassification {
  runId: string;
  sessionName: string;
  status: 'active' | 'orphan' | 'unknown';
  reason: string;
}

export function listHarnessSessions(): string[] {
  try {
    const output = execSync("tmux ls -F '#{session_name}'", {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => /^harness-.+$/.test(s));
  } catch (err) {
    // Treat "no tmux server" and "no sessions" as a legitimate empty state.
    // Any other failure (permission error, bad socket, etc.) propagates so callers can warn.
    const msg = String(
      (err as { stderr?: string }).stderr ??
      (err as Error).message ??
      ''
    );
    if (/no server running|no sessions/i.test(msg)) {
      return [];
    }
    throw err;
  }
}

export function classifyOrphans(
  harnessDir: string,
  sessions: string[]
): SessionClassification[] {
  return sessions.map((sessionName) => {
    const runId = sessionName.slice('harness-'.length);
    const runDirPath = join(harnessDir, runId);

    if (!existsSync(runDirPath)) {
      return { runId, sessionName, status: 'unknown' as const, reason: 'run-dir-missing' };
    }

    const runLockPath = join(runDirPath, 'run.lock');
    if (!existsSync(runLockPath)) {
      return { runId, sessionName, status: 'orphan' as const, reason: 'no-run-lock' };
    }

    const lockResult = checkLockStatus(harnessDir);

    if (lockResult.status === 'none') {
      return { runId, sessionName, status: 'orphan' as const, reason: 'no-repo-lock' };
    }

    if (lockResult.status === 'stale') {
      return { runId, sessionName, status: 'orphan' as const, reason: 'repo-lock-stale' };
    }

    // status === 'active'
    if (lockResult.lock?.runId !== runId) {
      return { runId, sessionName, status: 'orphan' as const, reason: 'repo-lock-different-run' };
    }

    return { runId, sessionName, status: 'active' as const, reason: 'lock-active' };
  });
}

export interface CleanupOptions {
  dryRun?: boolean;
  yes?: boolean;
  quiet?: boolean;
}

export async function cleanupOrphans(
  harnessDir: string,
  opts: CleanupOptions = {}
): Promise<void> {
  const sessions = listHarnessSessions();
  const classifications = classifyOrphans(harnessDir, sessions);
  const orphans = classifications.filter((c) => c.status === 'orphan');

  if (!opts.quiet) {
    if (classifications.length === 0) {
      process.stdout.write('No harness tmux sessions found.\n');
      return;
    }

    const col1 = 42;
    const col2 = 10;
    const line = '─'.repeat(col1 + col2 + 20);
    process.stdout.write('\nHarness tmux sessions:\n');
    process.stdout.write(line + '\n');
    process.stdout.write(
      `${'SESSION'.padEnd(col1)} ${'STATUS'.padEnd(col2)} REASON\n`
    );
    process.stdout.write(line + '\n');
    for (const c of classifications) {
      process.stdout.write(
        `${c.sessionName.padEnd(col1)} ${c.status.padEnd(col2)} ${c.reason}\n`
      );
    }
    process.stdout.write(line + '\n');

    if (orphans.length === 0) {
      process.stdout.write('Nothing to clean up.\n');
      return;
    }

    process.stdout.write(`\n${orphans.length} orphan session(s) to kill.\n`);
  } else {
    if (orphans.length === 0) return;
  }

  if (opts.dryRun) {
    if (!opts.quiet) {
      process.stdout.write('[dry-run] No sessions were killed.\n');
    }
    return;
  }

  if (!opts.yes) {
    const confirmed = await promptConfirm('Kill orphan sessions? [y/N] ');
    if (!confirmed) {
      process.stdout.write('Aborted.\n');
      return;
    }
  }

  for (const orphan of orphans) {
    try {
      killSessionOrThrow(orphan.sessionName);
      if (!opts.quiet) {
        process.stdout.write(`Killed: ${orphan.sessionName}\n`);
      }
    } catch (err) {
      process.stderr.write(`Failed to kill ${orphan.sessionName}: ${(err as Error).message}\n`);
    }
  }
}

function promptConfirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}
