import { describe, it, expect } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { resolveSkillsRoot } from '../src/skills/install.js';

describe('resolveSkillsRoot', () => {
  it('user scope with injected homeDir returns <homeDir>/.claude/skills', () => {
    const result = resolveSkillsRoot({ scope: 'user', homeDir: '/tmp/fakehome' });
    expect(result).toBe(path.join('/tmp/fakehome', '.claude', 'skills'));
  });

  it('project scope with injected projectDir returns <projectDir>/.claude/skills', () => {
    const result = resolveSkillsRoot({ scope: 'project', projectDir: '/tmp/proj' });
    expect(result).toBe(path.join('/tmp/proj', '.claude', 'skills'));
  });

  it('user scope without homeDir falls back to os.homedir()', () => {
    const result = resolveSkillsRoot({ scope: 'user' });
    expect(result).toBe(path.join(os.homedir(), '.claude', 'skills'));
  });

  it('project scope without projectDir falls back to process.cwd()', () => {
    const result = resolveSkillsRoot({ scope: 'project' });
    expect(result).toBe(path.join(process.cwd(), '.claude', 'skills'));
  });
});
