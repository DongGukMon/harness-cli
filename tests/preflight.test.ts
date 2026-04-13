import { describe, it, expect } from 'vitest';
import os from 'os';
import path from 'path';
import { existsSync } from 'fs';
import { getPreflightItems, runPreflight, resolveCodexPath } from '../src/preflight.js';
import type { PhaseType } from '../src/types.js';

describe('getPreflightItems', () => {
  it('returns correct items for interactive phases', () => {
    const items = getPreflightItems('interactive');
    expect(items).toEqual(['git', 'head', 'node', 'claude', 'claudeAtFile', 'platform', 'tty']);
  });

  it('returns correct items for gate phases', () => {
    const items = getPreflightItems('gate');
    expect(items).toEqual(['git', 'head', 'node', 'codexPath', 'platform', 'tty']);
  });

  it('returns correct items for verify phase', () => {
    const items = getPreflightItems('verify');
    expect(items).toEqual(['git', 'head', 'node', 'verifyScript', 'jq', 'platform', 'tty']);
  });

  it('returns correct items for terminal phase', () => {
    const items = getPreflightItems('terminal');
    expect(items).toEqual(['git', 'platform']);
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
