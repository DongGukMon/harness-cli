import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { getGitRoot, getHead, generateRunId, hasStagedChanges, isWorkingTreeClean } from '../git.js';
import { acquireLock, releaseLock, setLockHandoff, pollForHandoffComplete } from '../lock.js';
import { getPreflightItems, runPreflight } from '../preflight.js';
import { findHarnessRoot, setCurrentRun } from '../root.js';
import { createInitialState, writeState } from '../state.js';
import { isInsideTmux, getCurrentSessionName, getActiveWindowId, createSession, createWindow, sendKeys, killSession, selectWindow, getDefaultPaneId } from '../tmux.js';
import { openTerminalWindow } from '../terminal.js';
import { HANDOFF_TIMEOUT_MS } from '../config.js';
import { printSuccess, printError } from '../ui.js';

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

    // 17. Determine tmux mode
    const insideTmux = isInsideTmux();
    const sessionName = insideTmux
      ? getCurrentSessionName()!
      : `harness-${runId}`;

    state.tmuxSession = sessionName;
    state.tmuxMode = insideTmux ? 'reused' : 'dedicated';

    if (insideTmux) {
      state.tmuxOriginalWindow = getActiveWindowId(sessionName) ?? undefined;
    }

    writeState(runDir, state);

    // 18. Set lock handoff state
    setLockHandoff(harnessDir, process.pid, sessionName);

    // 19. Create tmux session (dedicated) or window (reused)
    const harnessPath = process.argv[1]; // path to harness.js
    const innerCmd = `node ${harnessPath} __inner ${runId}${options.root ? ` --root ${options.root}` : ''}`;

    if (!insideTmux) {
      createSession(sessionName, cwd);
      const controlPaneId = getDefaultPaneId(sessionName);
      const innerCmdWithPane = `${innerCmd} --control-pane ${controlPaneId}`;
      sendKeys(sessionName, '0', innerCmdWithPane);
    } else {
      const ctrlWindowId = createWindow(sessionName, 'harness-ctrl', '');
      const controlPaneId = getDefaultPaneId(sessionName, ctrlWindowId);
      sendKeys(sessionName, ctrlWindowId, `${innerCmd} --control-pane ${controlPaneId}`);
      state.tmuxControlWindow = ctrlWindowId;
      state.tmuxWindows.push(ctrlWindowId);
      writeState(runDir, state);
      selectWindow(sessionName, ctrlWindowId);
    }

    // 20. Wait for inner to claim lock (handoff complete)
    const handoffOk = pollForHandoffComplete(harnessDir, HANDOFF_TIMEOUT_MS);
    if (!handoffOk) {
      printError('Inner process failed to start within 5 seconds.');
      if (!insideTmux) {
        killSession(sessionName);
      }
      releaseLock(harnessDir, runId);
      process.exit(1);
    }

    // 21. Open terminal window (dedicated mode only) — ADR-10: graceful fallback
    if (!insideTmux) {
      openTerminalWindow(sessionName);
      // openTerminalWindow returns false if it can't open a window, but the tmux session
      // and inner process are already running. The function prints manual attach instructions.
      // Per ADR-10, this is non-fatal — the user can manually attach.
    }

    printSuccess(`Harness session started: ${sessionName}`);
    // Do NOT release lock — inner owns it now
    lockAcquired = false; // Prevent finally block from releasing
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
