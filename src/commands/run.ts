import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { getGitRoot, getHead, generateRunId, hasStagedChanges, isWorkingTreeClean } from '../git.js';
import { acquireLock, readLock, releaseLock } from '../lock.js';
import { getPreflightItems, runPreflight } from '../preflight.js';
import { findHarnessRoot, setCurrentRun } from '../root.js';
import { createInitialState, writeState } from '../state.js';
import { runPhaseLoop } from '../phases/runner.js';
import { registerSignalHandlers } from '../signal.js';
import type { HarnessState } from '../types.js';

export interface RunOptions {
  allowDirty?: boolean;
  auto?: boolean;
  root?: string;
}

export async function runCommand(task: string, options: RunOptions = {}): Promise<void> {
  // 1. Validate task
  if (!task || task.trim() === '') {
    process.stderr.write('Error: task description cannot be empty.\n');
    process.exit(1);
  }

  // 2. Find harness root (creates dir if --root)
  const harnessDir = findHarnessRoot(options.root);
  const cwd = options.root ?? getGitRoot();

  // 3. Run full preflight (union of all phase types; dedup)
  const allItems = [
    ...getPreflightItems('interactive'),
    ...getPreflightItems('gate'),
    ...getPreflightItems('verify'),
  ];
  const uniqueItems = Array.from(new Set(allItems));
  const preflightResult = runPreflight(uniqueItems, cwd);
  const codexPath = preflightResult.codexPath;
  if (!codexPath) {
    process.stderr.write('Error: codex path not resolved in preflight.\n');
    process.exit(1);
  }

  // 5. Working tree checks (two-step)
  // 5a. Staged changes: always blocked, even with --allow-dirty
  if (hasStagedChanges(cwd)) {
    process.stderr.write(
      'Error: staged changes exist. Commit or unstage them first (`git restore --staged .`).\n'
    );
    process.exit(1);
  }
  // 5b. Unstaged/untracked: blocked unless --allow-dirty
  if (!isWorkingTreeClean(cwd)) {
    if (!options.allowDirty) {
      process.stderr.write(
        'Error: working tree has uncommitted changes. Use --allow-dirty to bypass this check.\n'
      );
      process.exit(1);
    } else {
      process.stderr.write(
        '⚠️  --allow-dirty: unstaged changes may appear in Phase 7 diff.\n'
      );
    }
  }

  // 6. Generate runId
  const runId = generateRunId(task, harnessDir);
  const runDir = join(harnessDir, runId);

  // 7. Ensure harness parent dir exists so we can acquire the global lock
  mkdirSync(harnessDir, { recursive: true });

  // 8. Acquire repo-global lock FIRST — prevents concurrent `harness run`
  // from racing on the same .harness/<runId>/ directory.
  let lockAcquired = false;
  try {
    acquireLock(harnessDir, runId);
    lockAcquired = true;
  } catch (err) {
    process.stderr.write(`Error: failed to acquire lock: ${(err as Error).message}\n`);
    process.exit(1);
  }

  try {
    // 9. Create directories
    mkdirSync(runDir, { recursive: true });
    mkdirSync(join(cwd, 'docs/specs'), { recursive: true });
    mkdirSync(join(cwd, 'docs/plans'), { recursive: true });
    mkdirSync(join(cwd, 'docs/process/evals'), { recursive: true });

    // 10. .gitignore handling
    await ensureGitignore(cwd);

    // 11. Capture baseCommit after .gitignore commit
    const baseCommit = getHead(cwd);

    // 12. Create initial state
    const state = createInitialState(runId, task, baseCommit, codexPath, options.auto ?? false);

    // 13. Save task.md (needed before Phase 1 spawn)
    try {
      writeFileSync(join(runDir, 'task.md'), task, 'utf-8');
    } catch (err) {
      cleanupFailedInit(runDir, harnessDir, runId, false);
      process.stderr.write(`Error: failed to write task.md: ${(err as Error).message}\n`);
      process.exit(1);
    }

    // 14. Write state.json atomically
    try {
      writeState(runDir, state);
    } catch (err) {
      cleanupFailedInit(runDir, harnessDir, runId, false);
      process.stderr.write(`Error: failed to write state.json: ${(err as Error).message}\n`);
      process.exit(1);
    }

    // 16. Update current-run pointer
    setCurrentRun(harnessDir, runId);

    // 17. Register signal handlers
    registerSignalHandlers({
      harnessDir,
      runId,
      getState: () => state,
      setState: (s) => Object.assign(state, s),
      getChildPid: () => readLock(harnessDir)?.childPid ?? null,
      getCurrentPhaseType: () => {
        const phase = state.currentPhase;
        if (phase === 1 || phase === 3 || phase === 5) return 'interactive';
        return 'automated';
      },
      cwd,
    });

    // 18. Run phase loop
    await runPhaseLoop(state, harnessDir, runDir, cwd);
  } finally {
    // 19. Release lock on exit (guaranteed even on errors)
    if (lockAcquired) {
      releaseLock(harnessDir, runId);
    }
  }
}

async function ensureGitignore(cwd: string): Promise<void> {
  const gitignorePath = join(cwd, '.gitignore');
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf-8') : '';

  // Check if .harness/ already present
  const lines = existing.split('\n').map((l) => l.trim());
  if (lines.includes('.harness/') || lines.includes('.harness')) {
    return; // Already present — no-op
  }

  // Pre-checks before modifying
  try {
    const stagedOutput = execSync('git diff --cached --name-only', { cwd, encoding: 'utf-8' }).trim();
    if (stagedOutput.length > 0) {
      process.stderr.write(
        `Error: cannot auto-commit .gitignore — other staged changes exist.\n` +
        `Unstage them first with 'git restore --staged .'\n`
      );
      process.exit(1);
    }

    const gitignoreStatus = execSync('git status --porcelain .gitignore', { cwd, encoding: 'utf-8' }).trim();
    if (gitignoreStatus.length > 0) {
      process.stderr.write(
        `Error: .gitignore has uncommitted changes. Commit or stash them first.\n`
      );
      process.exit(1);
    }
  } catch (err) {
    if ((err as { code?: number }).code !== undefined) throw err;
    // Non-exit errors fall through
  }

  // Append or create
  const newContent = existing.length > 0 && !existing.endsWith('\n')
    ? existing + '\n.harness/\n'
    : existing + '.harness/\n';
  writeFileSync(gitignorePath, newContent, 'utf-8');

  // Commit
  try {
    execSync('git add .gitignore', { cwd, stdio: 'pipe' });
    execSync('git commit -m "harness: add .harness/ to .gitignore"', { cwd, stdio: 'pipe' });
  } catch (err) {
    process.stderr.write(
      `Error: failed to commit .gitignore update: ${(err as Error).message}\n` +
      `Fix git state and retry 'harness run'.\n`
    );
    process.exit(1);
  }
}

function cleanupFailedInit(runDir: string, harnessDir: string, runId: string, stateWritten: boolean): void {
  if (stateWritten) return; // Preserve run after state.json was created
  try {
    rmSync(runDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
  try {
    rmSync(join(harnessDir, 'repo.lock'), { force: true });
  } catch {
    // best-effort
  }
  try {
    rmSync(join(harnessDir, runId, 'run.lock'), { force: true });
  } catch {
    // best-effort
  }
}
