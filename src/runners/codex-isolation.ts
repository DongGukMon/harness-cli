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

export function ensureCodexIsolation(runDir: string): string {
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

  return codexHome;
}
