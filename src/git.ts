import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { normalize } from 'path';

function exec(cmd: string, cwd?: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

// Check if cwd is inside a git repository.
export function isInGitRepo(cwd?: string): boolean {
  try {
    exec('git rev-parse --show-toplevel', cwd);
    return true;
  } catch {
    return false;
  }
}

// Returns git repo root path. Throws if not in a git repo.
export function getGitRoot(cwd?: string): string {
  try {
    return exec('git rev-parse --show-toplevel', cwd);
  } catch {
    throw new Error('Not in a git repository');
  }
}

// Returns HEAD sha. Throws if no commits.
export function getHead(cwd?: string): string {
  try {
    return exec('git rev-parse HEAD', cwd);
  } catch {
    throw new Error('No commits in repository');
  }
}

// Returns true if ancestor is an ancestor of descendant.
export function isAncestor(ancestor: string, descendant: string, cwd?: string): boolean {
  try {
    execSync(`git merge-base --is-ancestor ${ancestor} ${descendant}`, { cwd, encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

// Returns true if working tree is clean (git status --porcelain is empty).
export function isWorkingTreeClean(cwd?: string): boolean {
  try {
    const output = exec('git status --porcelain', cwd);
    return output === '';
  } catch {
    return false;
  }
}

// Returns true if any files are staged.
export function hasStagedChanges(cwd?: string): boolean {
  try {
    const output = exec('git diff --cached --name-only', cwd);
    return output !== '';
  } catch {
    return false;
  }
}

// Returns list of staged file paths.
export function getStagedFiles(cwd?: string): string[] {
  try {
    const output = exec('git diff --cached --name-only', cwd);
    if (output === '') return [];
    return output.split('\n').map((f) => f.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// Returns git status for a specific file path.
export function getFileStatus(filePath: string, cwd?: string): string {
  try {
    return exec(`git status --porcelain -- ${normalize(filePath)}`, cwd);
  } catch {
    return '';
  }
}

// Generate a runId from task description.
// Rules:
// 1. Lowercase
// 2. Unicode NFD normalize, remove non-ASCII
// 3. Replace non-alphanumeric with -
// 4. Collapse consecutive -
// 5. Trim leading/trailing -
// 6. Max 50 chars (cut at word boundary = last -)
// 7. Empty → "untitled"
// Format: YYYY-MM-DD-<slug>[-N] (N if directory exists)
export function generateRunId(task: string, harnessDir: string): string {
  // Build date prefix
  const now = new Date();
  const yyyy = now.getFullYear().toString();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const datePrefix = `${yyyy}-${mm}-${dd}`;

  // Build slug
  let slug = task
    // 1. Lowercase
    .toLowerCase()
    // 2. NFD normalize, remove non-ASCII
    .normalize('NFD')
    .replace(/[^\x00-\x7F]/g, '')
    // 3. Replace non-alphanumeric with -
    .replace(/[^a-z0-9]+/g, '-')
    // 4. Collapse consecutive - (already done by step 3 with +)
    // 5. Trim leading/trailing -
    .replace(/^-+|-+$/g, '');

  // 6. Max 50 chars, cut at word boundary (last -)
  if (slug.length > 50) {
    const truncated = slug.slice(0, 50);
    const lastDash = truncated.lastIndexOf('-');
    slug = lastDash > 0 ? truncated.slice(0, lastDash) : truncated;
  }

  // 7. Empty → "untitled"
  if (slug === '') {
    slug = 'untitled';
  }

  const base = `${datePrefix}-${slug}`;

  // Dedup: if directory exists, append -2, -3, etc.
  if (!existsSync(`${harnessDir}/${base}`)) {
    return base;
  }

  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!existsSync(`${harnessDir}/${candidate}`)) {
      return candidate;
    }
  }
}

// Detect external commits using known anchors.
// Returns list of commit SHAs not in the harness-owned range.
export function detectExternalCommits(
  anchor: string,
  knownAnchors: (string | null)[],
  implCommitRange: { from: string; to: string } | null,
  cwd?: string
): string[] {
  try {
    // Get all commits from anchor to HEAD
    const revListOutput = exec(`git rev-list ${anchor}..HEAD`, cwd);
    if (revListOutput === '') return [];

    const allCommits = revListOutput.split('\n').map((s) => s.trim()).filter(Boolean);

    // Build set of known/owned SHAs to exclude
    const ownedShas = new Set<string>();

    // Add known anchors (non-null)
    for (const a of knownAnchors) {
      if (a !== null) ownedShas.add(a);
    }

    // Add commits in implCommitRange (from..to)
    if (implCommitRange !== null) {
      try {
        const rangeOutput = exec(
          `git rev-list ${implCommitRange.from}..${implCommitRange.to}`,
          cwd
        );
        if (rangeOutput !== '') {
          for (const sha of rangeOutput.split('\n').map((s) => s.trim()).filter(Boolean)) {
            ownedShas.add(sha);
          }
        }
      } catch {
        // ignore if range is invalid
      }
    }

    // Return commits not in owned set
    return allCommits.filter((sha) => !ownedShas.has(sha));
  } catch {
    return [];
  }
}
