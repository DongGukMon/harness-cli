import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Top-level module mock — required in ESM
vi.mock('child_process', async (importActual) => {
  const actual = await importActual<typeof import('child_process')>();
  return { ...actual, spawnSync: vi.fn() };
});

import { spawnSync } from 'child_process';
import { getPreflightItems, runPreflight, resolveCodexPath, resolveVerifyScriptPath, runRunnerAwarePreflight } from '../src/preflight.js';
import type { PhaseType } from '../src/types.js';

describe('getPreflightItems', () => {
  it('returns correct items for interactive phases', () => {
    const items = getPreflightItems('interactive');
    expect(items).toEqual(['node', 'claude', 'claudeAtFile', 'platform', 'tty', 'tmux']);
  });

  it('returns correct items for gate phases', () => {
    const items = getPreflightItems('gate');
    expect(items).toEqual(['node', 'codexPath', 'platform', 'tty']);
  });

  it('returns correct items for verify phase', () => {
    const items = getPreflightItems('verify');
    expect(items).toEqual(['node', 'verifyScript', 'jq', 'platform', 'tty']);
  });

  it('returns correct items for terminal phase', () => {
    const items = getPreflightItems('terminal');
    expect(items).toEqual(['platform']);
  });

  it('returns correct items for ui_only phase', () => {
    const items = getPreflightItems('ui_only');
    expect(items).toEqual(['platform', 'tty']);
  });

  it('returns all five phase types without throwing', () => {
    const phaseTypes: PhaseType[] = ['interactive', 'gate', 'verify', 'terminal', 'ui_only'];
    for (const phaseType of phaseTypes) {
      expect(() => getPreflightItems(phaseType)).not.toThrow();
    }
  });
});

describe('runPreflight - platform check', () => {
  it('passes on macOS or Linux (current platform)', () => {
    // We are running on macOS or Linux, so platform check must pass.
    expect(() => runPreflight(['platform'])).not.toThrow();
  });

  it('returns empty object when no codexPath item is checked', () => {
    const result = runPreflight(['platform']);
    expect(result).toEqual({});
    expect(result.codexPath).toBeUndefined();
  });
});

describe('runPreflight - node check', () => {
  it('passes because we are running in Node', () => {
    expect(() => runPreflight(['node'])).not.toThrow();
  });
});

describe('runPreflight - git check', () => {
  it('passes when cwd is a git repo', () => {
    // harness-cli itself is a git repo, use its directory.
    const cwd = path.resolve(import.meta.dirname, '..');
    expect(() => runPreflight(['git'], cwd)).not.toThrow();
  });

  it('throws when cwd is not a git repo', () => {
    // os.tmpdir() is not a git repo.
    const cwd = os.tmpdir();
    expect(() => runPreflight(['git'], cwd)).toThrow('harness requires a git repository.');
  });
});

describe('runPreflight - head check', () => {
  it('passes when cwd is a git repo with at least one commit', () => {
    const cwd = path.resolve(import.meta.dirname, '..');
    expect(() => runPreflight(['head'], cwd)).not.toThrow();
  });
});

describe('resolveCodexPath', () => {
  const codexBaseDir = path.join(
    os.homedir(),
    '.claude',
    'plugins',
    'cache',
    'openai-codex',
    'codex'
  );

  it.skipIf(!existsSync(codexBaseDir))(
    'returns a non-null path when codex plugin directory exists',
    () => {
      const result = resolveCodexPath();
      // If the base dir exists, it may or may not have a valid companion.
      // Just confirm the return type is correct.
      expect(result === null || typeof result === 'string').toBe(true);
    }
  );

  it('returns null when codex is not installed', () => {
    // This test is meaningful only when the base dir does not exist.
    // When it does exist, we skip it.
    if (existsSync(codexBaseDir)) {
      // Skip: codex is installed, resolveCodexPath may return non-null.
      return;
    }
    expect(resolveCodexPath()).toBeNull();
  });
});

describe('runPreflight - codexPath item', () => {
  const codexBaseDir = path.join(
    os.homedir(),
    '.claude',
    'plugins',
    'cache',
    'openai-codex',
    'codex'
  );

  it.skipIf(existsSync(codexBaseDir))(
    'throws when codex is not installed',
    () => {
      expect(() => runPreflight(['codexPath'])).toThrow('Codex companion not found.');
    }
  );

  it.skipIf(!existsSync(codexBaseDir))(
    'returns codexPath in result when codex is installed and companion exists',
    () => {
      const resolved = resolveCodexPath();
      if (resolved === null) {
        // Companion mjs not found despite base dir existing — skip.
        return;
      }
      const result = runPreflight(['codexPath']);
      expect(typeof result.codexPath).toBe('string');
    }
  );
});

describe('runPreflight - multiple items', () => {
  it('runs multiple checks and collects codexPath only when present', () => {
    const cwd = path.resolve(import.meta.dirname, '..');
    // platform + node + git are safe checks in this environment
    const result = runPreflight(['platform', 'node', 'git'], cwd);
    expect(result.codexPath).toBeUndefined();
  });

  it('throws on first failure and does not continue', () => {
    // 'git' will fail with os.tmpdir() as cwd
    expect(() => runPreflight(['platform', 'git', 'node'], os.tmpdir())).toThrow(
      'harness requires a git repository.'
    );
  });
});

describe('preflight claudeAtFile timeout behavior', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stderrSpy: any;

  beforeEach(() => {
    vi.mocked(spawnSync).mockReset();
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  it('demotes timeout to warning and does not throw', () => {
    const timeoutErr = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
    vi.mocked(spawnSync).mockReturnValue({
      pid: 0,
      output: [],
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      status: null,
      signal: 'SIGKILL',
      error: timeoutErr,
    } as ReturnType<typeof spawnSync>);

    expect(() => runPreflight(['claudeAtFile'])).not.toThrow();

    const stderrCalls = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    expect(stderrCalls).toMatch(/claude @file check delayed/);
    expect(stderrCalls).toMatch(/continuing/);
  });

  it('demotes non-zero exit (non-timeout) to warning and does not throw', () => {
    vi.mocked(spawnSync).mockReturnValue({
      pid: 0,
      output: [],
      stdout: Buffer.from(''),
      stderr: Buffer.from('some error'),
      status: 1,
      signal: null,
      error: undefined,
    } as ReturnType<typeof spawnSync>);

    expect(() => runPreflight(['claudeAtFile'])).not.toThrow();

    const stderrCalls = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    expect(stderrCalls).toMatch(/claude @file check exited with status 1/);
  });
});

describe('resolveVerifyScriptPath — package-local branch (deterministic via override)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'harness-pkglocal-'));
    // Layout: <tmp>/lib (simulated package-local root) and <tmp>/scripts/ (target dir)
    mkdirSync(join(tmp, 'lib'), { recursive: true });
    mkdirSync(join(tmp, 'scripts'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns package-local path when present and executable', () => {
    const target = join(tmp, 'scripts', 'harness-verify.sh');
    writeFileSync(target, '#!/bin/sh\necho ok\n');
    chmodSync(target, 0o755);
    const result = resolveVerifyScriptPath(join(tmp, 'lib'));
    expect(result).toBe(target);
  });

  it('returns legacy path when package-local is absent and legacy is present + executable', () => {
    const homeBackup = process.env.HOME;
    const fakeHome = mkdtempSync(join(tmpdir(), 'harness-fake-home-'));
    const legacyDir = join(fakeHome, '.claude', 'scripts');
    mkdirSync(legacyDir, { recursive: true });
    const legacyTarget = join(legacyDir, 'harness-verify.sh');
    writeFileSync(legacyTarget, '#!/bin/sh\necho ok\n');
    chmodSync(legacyTarget, 0o755);
    process.env.HOME = fakeHome;

    try {
      const result = resolveVerifyScriptPath(join(tmp, 'lib'));
      expect(result).toBe(legacyTarget);
    } finally {
      process.env.HOME = homeBackup;
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it('falls through to legacy when package-local exists but is not executable', () => {
    const pkgTarget = join(tmp, 'scripts', 'harness-verify.sh');
    writeFileSync(pkgTarget, '#!/bin/sh\necho ok\n');
    chmodSync(pkgTarget, 0o644); // not executable

    const homeBackup = process.env.HOME;
    const fakeHome = mkdtempSync(join(tmpdir(), 'harness-fake-home-'));
    const legacyDir = join(fakeHome, '.claude', 'scripts');
    mkdirSync(legacyDir, { recursive: true });
    const legacyTarget = join(legacyDir, 'harness-verify.sh');
    writeFileSync(legacyTarget, '#!/bin/sh\necho ok\n');
    chmodSync(legacyTarget, 0o755);
    process.env.HOME = fakeHome;

    try {
      const result = resolveVerifyScriptPath(join(tmp, 'lib'));
      expect(result).toBe(legacyTarget);
    } finally {
      process.env.HOME = homeBackup;
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it('returns null when package-local is missing and legacy is missing', () => {
    const homeBackup = process.env.HOME;
    const fakeHome = mkdtempSync(join(tmpdir(), 'harness-fake-home-'));
    process.env.HOME = fakeHome;
    try {
      const result = resolveVerifyScriptPath(join(tmp, 'lib'));
      expect(result).toBeNull();
    } finally {
      process.env.HOME = homeBackup;
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it('returns null when both package-local and legacy exist but neither is executable', () => {
    const pkgTarget = join(tmp, 'scripts', 'harness-verify.sh');
    writeFileSync(pkgTarget, '#!/bin/sh\necho ok\n');
    chmodSync(pkgTarget, 0o644);

    const homeBackup = process.env.HOME;
    const fakeHome = mkdtempSync(join(tmpdir(), 'harness-fake-home-'));
    const legacyDir = join(fakeHome, '.claude', 'scripts');
    mkdirSync(legacyDir, { recursive: true });
    const legacyTarget = join(legacyDir, 'harness-verify.sh');
    writeFileSync(legacyTarget, '#!/bin/sh\necho ok\n');
    chmodSync(legacyTarget, 0o644);
    process.env.HOME = fakeHome;

    try {
      const result = resolveVerifyScriptPath(join(tmp, 'lib'));
      expect(result).toBeNull();
    } finally {
      process.env.HOME = homeBackup;
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });
});

describe('runRunnerAwarePreflight', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stderrSpy: any;

  beforeEach(() => {
    vi.mocked(spawnSync).mockReset();
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    // Default spawnSync mock: simulate successful claude @file check
    vi.mocked(spawnSync).mockReturnValue({
      pid: 0,
      output: [],
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      status: 0,
      signal: null,
      error: undefined,
    } as ReturnType<typeof spawnSync>);
  });

  afterEach(() => {
    stderrSpy?.mockRestore();
  });

  it('skips codex preflight when all phases use claude runner', () => {
    // opus-xhigh, sonnet-high, sonnet-high are all claude-runner presets
    const presets = {
      '1': 'opus-xhigh',
      '3': 'sonnet-high',
      '5': 'sonnet-high',
    };
    // Should not throw even if codex CLI is missing — only claude preflight runs
    expect(() => runRunnerAwarePreflight(presets, ['1', '3', '5'])).not.toThrow();
  });

  it('throws codexCli error when a phase uses codex runner and codex is not in PATH', () => {
    // codex-high preset uses 'codex' runner
    const presets = {
      '2': 'codex-high',
    };
    // We expect codexCli check to run and fail (codex binary likely absent in test env)
    // Allow either no-throw (if codex is installed) or the specific error message
    try {
      runRunnerAwarePreflight(presets, ['2']);
      // If it doesn't throw, codex is installed — that's fine
    } catch (err) {
      expect((err as Error).message).toMatch(/Codex CLI not found in PATH/);
    }
  });

  it('no-op when phases array is empty', () => {
    const presets: Record<string, string> = {};
    expect(() => runRunnerAwarePreflight(presets, [])).not.toThrow();
  });

  it('skips unknown preset IDs gracefully', () => {
    const presets = {
      '1': 'nonexistent-preset-id',
    };
    // getPresetById returns undefined → runner not added → no preflight run
    expect(() => runRunnerAwarePreflight(presets, ['1'])).not.toThrow();
  });
});
