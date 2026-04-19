import { existsSync, readdirSync, rmSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { resolveSkillsRoot } from '../skills/install.js';

export interface UninstallSkillsOptions {
  user?: boolean;
  project?: boolean;
  projectDir?: string;
  /** For testing: override home directory resolution (user scope only) */
  homeDir?: string;
}

function resolveScope(opts: UninstallSkillsOptions): { scope: 'user' | 'project'; projectDir?: string; homeDir?: string } {
  if (opts.user && (opts.project || opts.projectDir)) {
    process.stderr.write('Error: --user and --project (or --project-dir) are mutually exclusive.\n');
    process.stderr.write('Usage: phase-harness uninstall-skills [--user|--project|--project-dir <path>]\n');
    process.exit(1);
  }
  if (opts.project || opts.projectDir) {
    return { scope: 'project', projectDir: opts.projectDir ?? process.cwd() };
  }
  return { scope: 'user', homeDir: opts.homeDir ?? os.homedir() };
}

export async function uninstallSkillsCommand(opts: UninstallSkillsOptions = {}): Promise<void> {
  const scopeOpts = resolveScope(opts);
  const targetRoot = resolveSkillsRoot(scopeOpts);

  if (!existsSync(targetRoot)) {
    process.stdout.write(`No skills directory found at ${targetRoot}. Nothing to uninstall.\n`);
    return;
  }

  const entries = readdirSync(targetRoot, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name.startsWith('phase-harness-'));

  if (entries.length === 0) {
    process.stdout.write(`No phase-harness-* skills found in ${targetRoot}.\n`);
    return;
  }

  const removed: string[] = [];
  for (const entry of entries) {
    const targetPath = path.join(targetRoot, entry.name);
    rmSync(targetPath, { recursive: true, force: true });
    removed.push(entry.name);
  }

  process.stdout.write(`Uninstalled ${removed.length} skill(s) from ${targetRoot}:\n`);
  for (const name of removed) {
    process.stdout.write(`  ${name}\n`);
  }
}
