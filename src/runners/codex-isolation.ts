import fs from 'fs';
import os from 'os';
import path from 'path';

export class CodexIsolationError extends Error {
  readonly code = 'CODEX_ISOLATION_FAILED';
  constructor(message: string) {
    super(message);
    this.name = 'CodexIsolationError';
  }
}

export function codexHomeFor(runDir: string): string {
  return path.join(runDir, 'codex-home');
}

function resolveRealCodexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

export function ensureCodexIsolation(runDir: string, cwd: string): string {
  const codexHome = codexHomeFor(runDir);

  try {
    fs.mkdirSync(codexHome, { recursive: true });
  } catch (err) {
    throw new CodexIsolationError(
      `Failed to create isolated codex home at ${codexHome}: ${(err as Error).message}`,
    );
  }

  const realHome = resolveRealCodexHome();
  const authSrc = path.join(realHome, 'auth.json');
  if (!fs.existsSync(authSrc)) {
    throw new CodexIsolationError(
      `Codex auth not found at ${authSrc}. Run 'codex login' first, ` +
        `or pass --codex-no-isolate to bypass isolation (not recommended).`,
    );
  }

  const authDst = path.join(codexHome, 'auth.json');
  try { fs.unlinkSync(authDst); } catch { /* missing ok */ }
  try {
    fs.symlinkSync(authSrc, authDst);
  } catch (err) {
    throw new CodexIsolationError(
      `Failed to symlink codex auth into ${authDst}: ${(err as Error).message}`,
    );
  }

  // Pre-trust the cwd so codex TUI doesn't refuse non-git directories or pop a
  // trust prompt. Codex matches by canonical (realpath) path — on macOS `/tmp`
  // is a symlink to `/private/tmp`, so the entry must use the resolved path or
  // it won't match codex's runtime cwd lookup.
  let trustedPath = cwd;
  try { trustedPath = fs.realpathSync(cwd); } catch { /* best-effort */ }
  const tomlPath = path.join(codexHome, 'config.toml');
  const tomlEntry = `[projects."${trustedPath}"]\ntrust_level = "trusted"\n`;
  try {
    fs.writeFileSync(tomlPath, tomlEntry, 'utf-8');
  } catch (err) {
    throw new CodexIsolationError(
      `Failed to write codex trust config at ${tomlPath}: ${(err as Error).message}`,
    );
  }

  return codexHome;
}
