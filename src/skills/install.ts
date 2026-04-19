import * as path from 'path';
import * as os from 'os';

export type SkillsScope = 'user' | 'project';

export function resolveSkillsRoot(opts: {
  scope: SkillsScope;
  projectDir?: string;
  homeDir?: string;
}): string {
  if (opts.scope === 'user') {
    return path.join(opts.homeDir ?? os.homedir(), '.claude', 'skills');
  }
  return path.join(opts.projectDir ?? process.cwd(), '.claude', 'skills');
}
