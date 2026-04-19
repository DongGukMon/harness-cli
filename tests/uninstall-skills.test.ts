import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { installSkillsCommand } from '../src/commands/install-skills.js';
import { uninstallSkillsCommand } from '../src/commands/uninstall-skills.js';

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uninstall-skills-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('uninstall-skills', () => {
  it('removes phase-harness-* skills but preserves unprefixed skills', async () => {
    const tmpDir = makeTmpDir();

    // Install skills first
    await installSkillsCommand({ projectDir: tmpDir });

    const skillsRoot = path.join(tmpDir, '.claude', 'skills');

    // Add a plain (non-phase-harness) skill that should survive
    const plainSkillDir = path.join(skillsRoot, 'plain-skill');
    fs.mkdirSync(plainSkillDir, { recursive: true });
    fs.writeFileSync(path.join(plainSkillDir, 'SKILL.md'), '---\nname: plain-skill\n---\n');

    // Uninstall
    await uninstallSkillsCommand({ projectDir: tmpDir });

    // phase-harness-* should be removed
    const harnessSkilDir = path.join(skillsRoot, 'phase-harness-codex-gate-review');
    expect(fs.existsSync(harnessSkilDir)).toBe(false);

    // plain-skill should be preserved
    expect(fs.existsSync(plainSkillDir)).toBe(true);
  });

  it('--user scope: removes phase-harness-* from homeDir via homeDir injection', async () => {
    const tmpHome = makeTmpDir();

    await installSkillsCommand({ homeDir: tmpHome });
    const skillDir = path.join(tmpHome, '.claude', 'skills', 'phase-harness-codex-gate-review');
    expect(fs.existsSync(skillDir)).toBe(true);

    await uninstallSkillsCommand({ homeDir: tmpHome });
    expect(fs.existsSync(skillDir)).toBe(false);
  });

  it('--user scope: preserves unprefixed skills after uninstall', async () => {
    const tmpHome = makeTmpDir();
    const skillsRoot = path.join(tmpHome, '.claude', 'skills');

    await installSkillsCommand({ homeDir: tmpHome });

    const plainSkillDir = path.join(skillsRoot, 'other-tool-skill');
    fs.mkdirSync(plainSkillDir, { recursive: true });
    fs.writeFileSync(path.join(plainSkillDir, 'SKILL.md'), '---\nname: other-tool-skill\n---\n');

    await uninstallSkillsCommand({ homeDir: tmpHome });

    expect(fs.existsSync(plainSkillDir)).toBe(true);
  });

  it('exits with error on --user + --project-dir combination', async () => {
    const tmpDir = makeTmpDir();
    let exitCode: number | undefined;
    const origExit = process.exit.bind(process);
    process.exit = ((code: number) => { exitCode = code; throw new Error(`exit:${code}`); }) as typeof process.exit;
    try {
      await uninstallSkillsCommand({ user: true, projectDir: tmpDir });
    } catch (e) {
      // expected
    } finally {
      process.exit = origExit;
    }
    expect(exitCode).toBe(1);
  });

  it('exits with error on --user + --project combination', async () => {
    let exitCode: number | undefined;
    const origExit = process.exit.bind(process);
    process.exit = ((code: number) => { exitCode = code; throw new Error(`exit:${code}`); }) as typeof process.exit;
    try {
      await uninstallSkillsCommand({ user: true, project: true });
    } catch (e) {
      // expected
    } finally {
      process.exit = origExit;
    }
    expect(exitCode).toBe(1);
  });

  it('does nothing when no phase-harness-* skills exist', async () => {
    const tmpDir = makeTmpDir();
    // Should not throw
    await uninstallSkillsCommand({ projectDir: tmpDir });
  });
});
