import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { installSkillsCommand } from '../src/commands/install-skills.js';

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-skills-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('install-skills', () => {
  it('(a) --project-dir: installs phase-harness-codex-gate-review to target dir', async () => {
    const tmpDir = makeTmpDir();
    await installSkillsCommand({ projectDir: tmpDir });

    const skillDir = path.join(tmpDir, '.claude', 'skills', 'phase-harness-codex-gate-review');
    expect(fs.existsSync(skillDir)).toBe(true);

    const skillMd = path.join(skillDir, 'SKILL.md');
    expect(fs.existsSync(skillMd)).toBe(true);

    const content = fs.readFileSync(skillMd, 'utf-8');
    expect(content).toContain('name: phase-harness-codex-gate-review');
  });

  it('(a) --project-dir: also copies gate-prompts.md', async () => {
    const tmpDir = makeTmpDir();
    await installSkillsCommand({ projectDir: tmpDir });

    const gatePrompts = path.join(tmpDir, '.claude', 'skills', 'phase-harness-codex-gate-review', 'gate-prompts.md');
    expect(fs.existsSync(gatePrompts)).toBe(true);
  });

  it('(b) --user default path: installs to <homeDir>/.claude/skills/ via homeDir injection', async () => {
    const tmpHome = makeTmpDir();
    await installSkillsCommand({ homeDir: tmpHome });

    const skillDir = path.join(tmpHome, '.claude', 'skills', 'phase-harness-codex-gate-review');
    expect(fs.existsSync(skillDir)).toBe(true);

    const skillMd = path.join(skillDir, 'SKILL.md');
    expect(fs.existsSync(skillMd)).toBe(true);
    const content = fs.readFileSync(skillMd, 'utf-8');
    expect(content).toContain('name: phase-harness-codex-gate-review');
  });

  it('(b) --user with explicit --user flag uses homeDir injection', async () => {
    const tmpHome = makeTmpDir();
    await installSkillsCommand({ user: true, homeDir: tmpHome });

    const skillDir = path.join(tmpHome, '.claude', 'skills', 'phase-harness-codex-gate-review');
    expect(fs.existsSync(skillDir)).toBe(true);
  });

  it('overwrites existing skill on re-install', async () => {
    const tmpDir = makeTmpDir();
    await installSkillsCommand({ projectDir: tmpDir });
    await installSkillsCommand({ projectDir: tmpDir });

    const skillDir = path.join(tmpDir, '.claude', 'skills', 'phase-harness-codex-gate-review');
    expect(fs.existsSync(skillDir)).toBe(true);
  });

  it('(c) --user + --project-dir exits with error', async () => {
    const tmpDir = makeTmpDir();
    let exitCode: number | undefined;
    const origExit = process.exit.bind(process);
    process.exit = ((code: number) => { exitCode = code; throw new Error(`exit:${code}`); }) as typeof process.exit;
    try {
      await installSkillsCommand({ user: true, projectDir: tmpDir });
    } catch (e) {
      // expected
    } finally {
      process.exit = origExit;
    }
    expect(exitCode).toBe(1);
  });

  it('(c) --user + --project exits with error', async () => {
    let exitCode: number | undefined;
    const origExit = process.exit.bind(process);
    process.exit = ((code: number) => { exitCode = code; throw new Error(`exit:${code}`); }) as typeof process.exit;
    try {
      await installSkillsCommand({ user: true, project: true });
    } catch (e) {
      // expected
    } finally {
      process.exit = origExit;
    }
    expect(exitCode).toBe(1);
  });
});
