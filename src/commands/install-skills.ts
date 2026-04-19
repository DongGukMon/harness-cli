import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import * as path from 'path';
import * as os from 'os';
import { resolveSkillsRoot } from '../skills/install.js';

export interface InstallSkillsOptions {
  user?: boolean;
  project?: boolean;
  projectDir?: string;
  /** For testing: override home directory resolution (user scope only) */
  homeDir?: string;
}

function resolveSourceRoot(): string {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  // When running from dist: scriptDir = dist/src/commands, so dist root is two levels up
  const distRoot = path.resolve(scriptDir, '..', '..');
  const distStandalone = path.join(distRoot, 'src', 'context', 'skills-standalone');
  if (existsSync(distStandalone)) {
    return distStandalone;
  }
  // Fallback for running from source (ts-node / vitest)
  const srcRoot = path.resolve(scriptDir, '..', '..');
  const srcStandalone = path.join(srcRoot, 'src', 'context', 'skills-standalone');
  if (existsSync(srcStandalone)) {
    return srcStandalone;
  }
  // Last resort: walk up from scriptDir looking for src/context/skills-standalone
  let dir = scriptDir;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'src', 'context', 'skills-standalone');
    if (existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error(
    'Skills standalone directory not found. Run `pnpm build` first to generate dist assets.',
  );
}

function resolveScope(opts: InstallSkillsOptions): { scope: 'user' | 'project'; projectDir?: string; homeDir?: string } {
  if (opts.user && (opts.project || opts.projectDir)) {
    process.stderr.write('Error: --user and --project (or --project-dir) are mutually exclusive.\n');
    process.stderr.write('Usage: phase-harness install-skills [--user|--project|--project-dir <path>]\n');
    process.exit(1);
  }
  if (opts.project || opts.projectDir) {
    return { scope: 'project', projectDir: opts.projectDir ?? process.cwd() };
  }
  return { scope: 'user', homeDir: opts.homeDir ?? os.homedir() };
}

export async function installSkillsCommand(opts: InstallSkillsOptions = {}): Promise<void> {
  const scopeOpts = resolveScope(opts);
  const targetRoot = resolveSkillsRoot(scopeOpts);
  const sourceRoot = resolveSourceRoot();

  if (!existsSync(sourceRoot)) {
    process.stderr.write(`Error: skills source directory not found at ${sourceRoot}\n`);
    process.stderr.write('Run `pnpm build` first to generate dist assets.\n');
    process.exit(1);
  }

  mkdirSync(targetRoot, { recursive: true });

  const skillDirs = readdirSync(sourceRoot, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);

  if (skillDirs.length === 0) {
    process.stderr.write(`Warning: no skills found in ${sourceRoot}\n`);
    return;
  }

  const installed: string[] = [];
  for (const skillDir of skillDirs) {
    const targetName = `phase-harness-${skillDir}`;
    const targetPath = path.join(targetRoot, targetName);
    if (existsSync(targetPath)) {
      rmSync(targetPath, { recursive: true, force: true });
    }
    cpSync(path.join(sourceRoot, skillDir), targetPath, { recursive: true });
    installed.push(targetName);
  }

  // Legacy detection: warn if unprefixed skill directory exists
  const legacyPath = path.join(targetRoot, 'codex-gate-review');
  if (existsSync(legacyPath)) {
    process.stderr.write(
      `Warning: legacy skill directory found at ${legacyPath}\n` +
      `This is an outdated installation. Remove it manually:\n` +
      `  rm -rf "${legacyPath}"\n`,
    );
  }

  process.stdout.write(`Installed ${installed.length} skill(s) to ${targetRoot}:\n`);
  for (const name of installed) {
    process.stdout.write(`  ${name}\n`);
  }
}
