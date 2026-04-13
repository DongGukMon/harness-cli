import { execSync, spawnSync } from 'child_process';
import { existsSync, accessSync, readdirSync, writeFileSync, unlinkSync, constants } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import type { PreflightItem, PhaseType } from './types.js';

/**
 * Resolve the harness-verify.sh path.
 * Priority:
 *  1. Package-local: <package>/dist/scripts/harness-verify.sh (works after npm install)
 *  2. Legacy fallback: ~/.claude/scripts/harness-verify.sh
 * Returns the path if accessible (readable + executable), null otherwise.
 */
export function resolveVerifyScriptPath(): string | null {
  // 1. Package-local path: dist/scripts/harness-verify.sh relative to this compiled file
  //    At runtime: dist/src/preflight.js → ../../scripts/ = dist/scripts/
  try {
    const __filename = fileURLToPath(import.meta.url);
    const packageLocal = path.join(path.dirname(__filename), '..', 'scripts', 'harness-verify.sh');
    if (existsSync(packageLocal)) {
      accessSync(packageLocal, constants.R_OK | constants.X_OK);
      return packageLocal;
    }
  } catch {
    // fall through to legacy
  }

  // 2. Legacy fallback: ~/.claude/scripts/harness-verify.sh
  const legacy = path.join(os.homedir(), '.claude', 'scripts', 'harness-verify.sh');
  try {
    accessSync(legacy, constants.R_OK | constants.X_OK);
    return legacy;
  } catch {
    return null;
  }
}

// Map phase type → required preflight items.
const PHASE_ITEMS: Record<PhaseType, PreflightItem[]> = {
  interactive: ['git', 'head', 'node', 'claude', 'claudeAtFile', 'platform', 'tty'],
  gate: ['git', 'head', 'node', 'codexPath', 'platform', 'tty'],
  verify: ['git', 'head', 'node', 'verifyScript', 'jq', 'platform', 'tty'],
  terminal: ['git', 'platform'],
  ui_only: ['platform', 'tty'],
};

// Get required preflight items for a phase type.
export function getPreflightItems(phaseType: PhaseType): PreflightItem[] {
  return PHASE_ITEMS[phaseType];
}

// Resolve Codex companion path via filesystem traversal (latest semver).
export function resolveCodexPath(): string | null {
  const baseDir = path.join(os.homedir(), '.claude', 'plugins', 'cache', 'openai-codex', 'codex');

  if (!existsSync(baseDir)) {
    return null;
  }

  let versions: string[];
  try {
    versions = readdirSync(baseDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return null;
  }

  if (versions.length === 0) {
    return null;
  }

  // Sort by semver descending (numeric segment comparison).
  versions.sort((a, b) => {
    return b.localeCompare(a, undefined, { numeric: true });
  });

  for (const version of versions) {
    const candidate = path.join(baseDir, version, 'scripts', 'codex-companion.mjs');
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

// Run a single preflight check. Returns codexPath if the item is 'codexPath'.
function runItem(item: PreflightItem, cwd?: string): { codexPath?: string } {
  switch (item) {
    case 'git':
      try {
        execSync('git rev-parse --show-toplevel', { cwd, stdio: 'pipe' });
      } catch {
        throw new Error('harness requires a git repository.');
      }
      return {};

    case 'head':
      try {
        execSync('git rev-parse HEAD', { cwd, stdio: 'pipe' });
      } catch {
        throw new Error('harness requires at least one commit.');
      }
      return {};

    case 'node':
      try {
        execSync('node --version', { stdio: 'pipe' });
      } catch {
        throw new Error("'node' not found in PATH.");
      }
      return {};

    case 'claude':
      try {
        execSync('which claude', { stdio: 'pipe' });
      } catch {
        throw new Error("'claude' not found in PATH.");
      }
      return {};

    case 'claudeAtFile': {
      const tmpFile = path.join(os.tmpdir(), `harness-preflight-${process.pid}.txt`);
      try {
        writeFileSync(tmpFile, '', 'utf-8');
        const result = spawnSync(
          'claude',
          ['--model', 'claude-sonnet-4-6', `@${tmpFile}`, '--print', ''],
          {
            stdio: 'pipe',
            encoding: 'utf-8',
            timeout: 5000,
            killSignal: 'SIGKILL',
          }
        );

        const timedOut =
          (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT' ||
          result.signal === 'SIGKILL';

        if (timedOut) {
          process.stderr.write(
            '⚠️  preflight: claude @file check timed out (5s); skipping — runtime failure will be surfaced at phase level if @file is unsupported.\n'
          );
          return {};
        }

        if (result.status !== 0) {
          process.stderr.write(
            `⚠️  preflight: claude @file check exited with status ${result.status}; continuing (weak signal).\n`
          );
          return {};
        }
      } finally {
        try {
          unlinkSync(tmpFile);
        } catch {
          /* best-effort */
        }
      }
      return {};
    }

    case 'verifyScript': {
      const scriptPath = resolveVerifyScriptPath();
      if (scriptPath === null) {
        throw new Error(
          'harness-verify.sh not found. Run `harness setup` or install the package globally.'
        );
      }
      return {};
    }

    case 'jq':
      try {
        execSync('jq --version', { stdio: 'pipe' });
      } catch {
        throw new Error("'jq' not found in PATH.");
      }
      return {};

    case 'codexPath': {
      const resolved = resolveCodexPath();
      if (resolved === null) {
        throw new Error('Codex companion not found.');
      }
      return { codexPath: resolved };
    }

    case 'platform':
      if (process.platform === 'win32') {
        throw new Error('harness requires macOS or Linux.');
      }
      return {};

    case 'tty':
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new Error('harness requires an interactive terminal (TTY).');
      }
      return {};

    default: {
      const _exhaustive: never = item;
      throw new Error(`Unknown preflight item: ${String(_exhaustive)}`);
    }
  }
}

// Run preflight checks for the given items. Throws on first failure.
// Returns codexPath if 'codexPath' was checked.
export function runPreflight(items: PreflightItem[], cwd?: string): { codexPath?: string } {
  const result: { codexPath?: string } = {};

  for (const item of items) {
    const itemResult = runItem(item, cwd);
    if (itemResult.codexPath !== undefined) {
      result.codexPath = itemResult.codexPath;
    }
  }

  return result;
}
