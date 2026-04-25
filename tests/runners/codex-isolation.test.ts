import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  CodexIsolationError,
  codexHomeFor,
  ensureCodexIsolation,
} from '../../src/runners/codex-isolation.js';

let tmpRoot: string;
let runDir: string;
let fakeRealHome: string;
let savedEnv: string | undefined;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-codex-iso-'));
  runDir = path.join(tmpRoot, 'run');
  fs.mkdirSync(runDir, { recursive: true });

  fakeRealHome = path.join(tmpRoot, 'fake-codex-home');
  fs.mkdirSync(fakeRealHome, { recursive: true });
  fs.writeFileSync(path.join(fakeRealHome, 'auth.json'), '{"fake":"auth"}');

  savedEnv = process.env.CODEX_HOME;
  process.env.CODEX_HOME = fakeRealHome;
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = savedEnv;
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('codexHomeFor', () => {
  it('returns <runDir>/codex-home/ without side effects', () => {
    const p = codexHomeFor(runDir);
    expect(p).toBe(path.join(runDir, 'codex-home'));
    expect(fs.existsSync(p)).toBe(false);
  });
});

describe('ensureCodexIsolation', () => {
  it('creates <runDir>/codex-home/ with auth.json symlink', () => {
    const returned = ensureCodexIsolation(runDir, tmpRoot);
    const codexHome = path.join(runDir, 'codex-home');
    expect(returned).toBe(codexHome);
    expect(fs.existsSync(codexHome)).toBe(true);

    const authDst = path.join(codexHome, 'auth.json');
    expect(fs.lstatSync(authDst).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(authDst)).toBe(path.join(fakeRealHome, 'auth.json'));

    expect(fs.readFileSync(authDst, 'utf-8')).toBe('{"fake":"auth"}');
  });

  it('is idempotent on second call', () => {
    const first = ensureCodexIsolation(runDir, tmpRoot);
    const authDst = path.join(first, 'auth.json');
    const firstStat = fs.lstatSync(authDst);
    // Re-run: must succeed and refresh the symlink without throwing.
    const second = ensureCodexIsolation(runDir, tmpRoot);
    expect(second).toBe(first);
    expect(fs.lstatSync(authDst).isSymbolicLink()).toBe(true);
    expect(firstStat.isSymbolicLink()).toBe(true);
  });

  it('refreshes symlink when real auth.json rotates (unlink+symlink pattern)', () => {
    ensureCodexIsolation(runDir, tmpRoot);
    const authDst = path.join(runDir, 'codex-home', 'auth.json');
    // Simulate rotated real auth
    fs.writeFileSync(path.join(fakeRealHome, 'auth.json'), '{"fake":"rotated"}');
    ensureCodexIsolation(runDir, tmpRoot);
    expect(fs.readFileSync(authDst, 'utf-8')).toBe('{"fake":"rotated"}');
  });

  it('falls back to ~/.codex/auth.json when CODEX_HOME env var is unset', () => {
    delete process.env.CODEX_HOME;
    // With CODEX_HOME unset, the module resolves to os.homedir()/.codex which
    // will likely not have the fake auth; assert the error message targets
    // the homedir path to prove fallback logic is wired.
    try {
      ensureCodexIsolation(runDir, tmpRoot);
      // On the off-chance the tester has a real ~/.codex/auth.json, the call
      // succeeds — that's still a valid fallback demonstration: the symlink
      // target must be under os.homedir()/.codex.
      const authDst = path.join(runDir, 'codex-home', 'auth.json');
      const linkTarget = fs.readlinkSync(authDst);
      expect(linkTarget).toBe(path.join(os.homedir(), '.codex', 'auth.json'));
    } catch (err) {
      expect(err).toBeInstanceOf(CodexIsolationError);
      expect((err as Error).message).toContain(path.join(os.homedir(), '.codex', 'auth.json'));
    }
  });

  it('throws CodexIsolationError when real auth.json is missing', () => {
    fs.unlinkSync(path.join(fakeRealHome, 'auth.json'));
    expect(() => ensureCodexIsolation(runDir, tmpRoot)).toThrow(CodexIsolationError);
    try {
      ensureCodexIsolation(runDir, tmpRoot);
    } catch (err) {
      expect((err as Error).message).toMatch(/auth.*not found/i);
      expect((err as Error).message).toMatch(/codex login/i);
    }
  });

  it('wraps mkdir EACCES/EEXIST-on-file failures as CodexIsolationError', () => {
    // Create a FILE at codex-home path so mkdir(recursive:true) errors with EEXIST-not-dir
    const codexHome = path.join(runDir, 'codex-home');
    fs.writeFileSync(codexHome, 'not a dir');
    expect(() => ensureCodexIsolation(runDir, tmpRoot)).toThrow(CodexIsolationError);
    try {
      ensureCodexIsolation(runDir, tmpRoot);
    } catch (err) {
      expect(err).toBeInstanceOf(CodexIsolationError);
      expect((err as CodexIsolationError).code).toBe('CODEX_ISOLATION_FAILED');
    }
  });

  it('writes config.toml with [projects."<canonical-cwd>"] trust_level="trusted"', () => {
    // cwd must be canonicalized so codex's path-comparison succeeds even when
    // the caller passes a symlink (e.g. /tmp → /private/tmp on macOS).
    const codexHome = ensureCodexIsolation(runDir, tmpRoot);
    const tomlPath = path.join(codexHome, 'config.toml');
    expect(fs.existsSync(tomlPath)).toBe(true);
    const canonical = fs.realpathSync(tmpRoot);
    const content = fs.readFileSync(tomlPath, 'utf-8');
    expect(content).toContain(`[projects."${canonical}"]`);
    expect(content).toContain('trust_level = "trusted"');
  });

  it('uses canonical (realpath) cwd in the trust entry, not the raw input path', () => {
    // Set up a symlink that points at the actual cwd
    const symlinkCwd = path.join(tmpRoot, 'cwd-symlink');
    fs.symlinkSync(tmpRoot, symlinkCwd);
    const codexHome = ensureCodexIsolation(runDir, symlinkCwd);
    const content = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf-8');
    const realCwd = fs.realpathSync(symlinkCwd);
    expect(content).toContain(`[projects."${realCwd}"]`);
    // Negative: must NOT use the symlink path verbatim
    expect(content).not.toContain(`[projects."${symlinkCwd}"]`);
  });

  it('bootstraps auth.json + a harness-controlled config.toml; nothing else from the real home leaks', () => {
    // Pre-populate the REAL codex home with everything a user might have
    fs.writeFileSync(path.join(fakeRealHome, 'AGENTS.md'), '# user conventions\n');
    fs.writeFileSync(path.join(fakeRealHome, 'config.toml'), '[profile]\nname="me"\n');
    fs.writeFileSync(path.join(fakeRealHome, 'hooks.json'), '{}');
    for (const d of ['agents', 'prompts', 'skills', 'rules', 'memories']) {
      fs.mkdirSync(path.join(fakeRealHome, d));
      fs.writeFileSync(path.join(fakeRealHome, d, 'leak.md'), 'do not leak');
    }

    const codexHome = ensureCodexIsolation(runDir, tmpRoot);

    // Harness manages: auth.json (symlink) + config.toml (trust entry)
    expect(fs.existsSync(path.join(codexHome, 'auth.json'))).toBe(true);
    expect(fs.existsSync(path.join(codexHome, 'config.toml'))).toBe(true);
    // The isolated config.toml must be the harness-built trust entry, NOT the
    // real-home profile config — so user's [profile] settings must not leak.
    const tomlContent = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf-8');
    expect(tomlContent).not.toContain('[profile]');
    expect(tomlContent).not.toContain('name="me"');
    // Other user-home files still must NOT leak
    expect(fs.existsSync(path.join(codexHome, 'AGENTS.md'))).toBe(false);
    expect(fs.existsSync(path.join(codexHome, 'hooks.json'))).toBe(false);
    for (const d of ['agents', 'prompts', 'skills', 'rules', 'memories']) {
      expect(fs.existsSync(path.join(codexHome, d))).toBe(false);
    }
    const entries = fs.readdirSync(codexHome).sort();
    expect(entries).toEqual(['auth.json', 'config.toml']);
  });
});
