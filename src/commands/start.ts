import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync } from 'fs';
import path, { join } from 'path';
import { getGitRoot, getHead, generateRunId, hasStagedChanges, isWorkingTreeClean, isInGitRepo } from '../git.js';
import type { TrackedRepo } from '../types.js';
import { acquireLock, releaseLock, setLockHandoff, pollForHandoffComplete } from '../lock.js';
import { runPreflight } from '../preflight.js';
import { findHarnessRoot, setCurrentRun } from '../root.js';
import { cleanupOrphans } from '../orphan-cleanup.js';
import { createInitialState, writeState } from '../state.js';
import { isInsideTmux, getCurrentSessionName, getActiveWindowId, createSession, createWindow, sendKeys, killSession, selectWindow, getDefaultPaneId } from '../tmux.js';
import { openTerminalWindow } from '../terminal.js';
import { HANDOFF_TIMEOUT_MS } from '../config.js';
import { printSuccess, printError } from '../ui.js';

export interface StartOptions {
  requireClean?: boolean;
  auto?: boolean;
  root?: string;
  enableLogging?: boolean;
  light?: boolean;
  codexNoIsolate?: boolean;
  track?: string[];    // explicit tracked repos (overrides auto-detect)
  exclude?: string[];  // paths to exclude from auto-detect
}

const SKIP_DIRS = new Set(['.harness', 'node_modules', 'dist', 'build']);

export function detectTrackedRepos(
  cwd: string,
  track?: string[],
  exclude?: string[],
): TrackedRepo[] {
  // Single-repo fast path: cwd is itself a git repo
  if (isInGitRepo(cwd)) {
    let head = '';
    try { head = getHead(cwd); } catch { /* no commits */ }
    return [{ path: cwd, baseCommit: head, implRetryBase: head, implHead: null }];
  }

  // Multi-repo path
  if (track && track.length > 0) {
    if (exclude && exclude.length > 0) {
      process.stderr.write('⚠️  --exclude has no effect when --track is specified.\n');
    }
    const repos: TrackedRepo[] = [];
    for (const raw of track) {
      const resolved = path.resolve(cwd, raw);
      const rel = path.relative(cwd, resolved);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`--track ${raw}: must be inside cwd (${cwd})`);
      }
      if (!existsSync(resolved)) {
        throw new Error(`--track ${raw}: path not found`);
      }
      if (!isInGitRepo(resolved)) {
        throw new Error(`--track ${raw}: not a git repo`);
      }
      let head = '';
      try { head = getHead(resolved); } catch { /* no commits */ }
      repos.push({ path: resolved, baseCommit: head, implRetryBase: head, implHead: null });
    }
    return repos;
  }

  // Auto-detect: depth=1 scan
  const excludeSet = new Set(
    (exclude ?? []).map(e => {
      const resolved = path.resolve(cwd, e);
      const rel = path.relative(cwd, resolved);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`--exclude ${e}: must be inside cwd (${cwd})`);
      }
      return resolved;
    })
  );

  let entries: string[] = [];
  try {
    entries = readdirSync(cwd, { withFileTypes: true })
      .filter(d => {
        if (!d.isDirectory()) return false;
        if (d.name.startsWith('.')) return false;
        if (SKIP_DIRS.has(d.name)) return false;
        return true;
      })
      .map(d => path.join(cwd, d.name))
      .filter(p => !excludeSet.has(p) && isInGitRepo(p))
      .sort();
  } catch {
    entries = [];
  }

  if (entries.length === 0) {
    throw new Error(
      'No tracked git repos found under cwd. Pass --track <path> or run from a git repo.'
    );
  }

  return entries.map(p => {
    let head = '';
    try { head = getHead(p); } catch { /* no commits */ }
    return { path: p, baseCommit: head, implRetryBase: head, implHead: null };
  });
}

export async function startCommand(task: string | undefined, options: StartOptions = {}): Promise<void> {
  // 1. Normalize task (empty/whitespace → '' for interactive prompt in inner)
  const normalizedTask = task?.trim() || '';

  // 2. Find or create harness root
  //    start is a create command — if no git repo and no .harness/, create in cwd
  let harnessDir: string;
  try {
    harnessDir = findHarnessRoot(options.root);
  } catch {
    harnessDir = join(process.cwd(), '.harness');
    mkdirSync(harnessDir, { recursive: true });
  }
  let cwd: string;
  try {
    cwd = options.root ?? getGitRoot();
  } catch {
    cwd = options.root ?? process.cwd();
  }

  // 3. Run common preflight (node, tmux, tty, platform, verifyScript, jq)
  // Runner-specific preflight (claude, codex) is deferred to inner.ts after model selection
  runPreflight(['node', 'tmux', 'tty', 'platform', 'verifyScript', 'jq'], cwd);

  // 4. Opportunistic orphan cleanup — best-effort, never aborts start
  try {
    await cleanupOrphans(harnessDir, { quiet: true, yes: true });
  } catch {
    process.stderr.write('Warning: orphan cleanup failed (non-fatal).\n');
  }

  // 5. Working tree checks (skip if not in a git repo)
  const inGitRepo = isInGitRepo(cwd);
  if (inGitRepo) {
    if (options.requireClean) {
      if (hasStagedChanges(cwd)) {
        process.stderr.write(
          'Error: staged changes exist. Commit or unstage them first (`git restore --staged .`).\n'
        );
        process.exit(1);
      }
      if (!isWorkingTreeClean(cwd)) {
        process.stderr.write(
          'Error: working tree has uncommitted changes (--require-clean is set).\n'
        );
        process.exit(1);
      }
    } else if (hasStagedChanges(cwd)) {
      process.stderr.write(
        '⚠️  Warning: staged changes exist. They may interfere with artifact commits.\n'
      );
    }
  }

  // 5b. Detect tracked repos (fail-fast before any side effects)
  let trackedRepos: TrackedRepo[];
  try {
    trackedRepos = detectTrackedRepos(cwd, options.track, options.exclude);
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exit(1);
  }

  // Print detection summary when multi-repo
  if (trackedRepos.length > 1) {
    const paths = trackedRepos.map(r => r.path).join(', ');
    process.stderr.write(`Detected ${trackedRepos.length} tracked repos: [${paths}]\n`);
  }

  // Per-repo preflight (git + head checks)
  for (const repo of trackedRepos) {
    try {
      runPreflight(['git', 'head'], repo.path);
    } catch (err) {
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(1);
    }
  }

  // 6. Generate runId
  const runId = generateRunId(normalizedTask, harnessDir);
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
    const docsRoot = trackedRepos[0].path;
    mkdirSync(join(docsRoot, 'docs/specs'), { recursive: true });
    mkdirSync(join(docsRoot, 'docs/plans'), { recursive: true });
    mkdirSync(join(docsRoot, 'docs/process/evals'), { recursive: true });

    // 10. .gitignore handling (skip if not in git repo)
    if (inGitRepo) {
      await ensureGitignore(cwd);
    }

    // 11. Capture baseCommit from trackedRepos[0] (already captured by detectTrackedRepos)
    // Re-read HEAD after .gitignore commit (which may have advanced HEAD)
    let baseCommit = trackedRepos[0].baseCommit;
    if (inGitRepo) {
      try {
        const updatedHead = getHead(trackedRepos[0].path);
        baseCommit = updatedHead;
        trackedRepos[0] = { ...trackedRepos[0], baseCommit: updatedHead, implRetryBase: updatedHead };
      } catch { /* no commits yet */ }
    }

    // 12. Create initial state
    const state = createInitialState(
      runId,
      normalizedTask,
      baseCommit,
      options.auto ?? false,
      options.enableLogging ?? false,
      options.light ? 'light' : 'full',
      options.codexNoIsolate ?? false,
    );

    // Inject detected tracked repos (overrides the placeholder set by createInitialState)
    state.trackedRepos = trackedRepos;

    if (options.codexNoIsolate) {
      // BUG-C risk surface: user explicitly bypassed isolation.
      process.stderr.write(
        '⚠️  CODEX_HOME isolation disabled. Codex subprocess may load personal ' +
        'conventions from ~/.codex/AGENTS.md (BUG-C risk).\n',
      );
    }

    // 13. Save task.md (needed before Phase 1 spawn)
    try {
      writeFileSync(join(runDir, 'task.md'), normalizedTask, 'utf-8');
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
      const ctrlWindowId = createWindow(sessionName, 'harness-ctrl', '', cwd);
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
      `Fix git state and retry 'phase-harness start'.\n`
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
