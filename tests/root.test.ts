import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, rmSync, realpathSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createTestRepo } from './helpers/test-repo.js';
import {
  findHarnessRoot,
  getCurrentRun,
  setCurrentRun,
  resolveRunId,
} from '../src/root.js';

describe('findHarnessRoot', () => {
  describe('with git repo', () => {
    let repo: { path: string; cleanup: () => void };

    beforeEach(() => {
      repo = createTestRepo();
    });

    afterEach(() => {
      repo.cleanup();
    });

    it('returns gitRoot/.harness', () => {
      const harnessDir = findHarnessRoot(undefined, repo.path);
      // Use realpathSync to normalize symlinks (e.g. /var → /private/var on macOS)
      expect(harnessDir).toBe(join(realpathSync(repo.path), '.harness'));
    });
  });

  describe('with explicit --root flag', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'harness-explicit-'));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('uses explicit path and creates .harness dir', () => {
      const harnessDir = findHarnessRoot(tmpDir);
      expect(harnessDir).toBe(join(tmpDir, '.harness'));
      // Directory should be created
      expect(existsSync(harnessDir)).toBe(true);
    });
  });

  describe('without git or .harness', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'harness-noop-'));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('throws with helpful message', () => {
      expect(() => findHarnessRoot(undefined, tmpDir)).toThrow(
        "No `.harness/` directory found. Run 'harness run' first."
      );
    });
  });

  describe('upward scan for .harness', () => {
    let tmpDir: string;
    let harnessDir: string;
    let deepDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'harness-scan-'));
      harnessDir = join(tmpDir, '.harness');
      mkdirSync(harnessDir);
      deepDir = join(tmpDir, 'a', 'b', 'c');
      mkdirSync(deepDir, { recursive: true });
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('finds .harness in ancestor directory', () => {
      const found = findHarnessRoot(undefined, deepDir);
      expect(found).toBe(harnessDir);
    });
  });
});

describe('getCurrentRun', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'harness-cr-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads file correctly', () => {
    writeFileSync(join(tmpDir, 'current-run'), 'my-run-id\n', 'utf-8');
    expect(getCurrentRun(tmpDir)).toBe('my-run-id');
  });

  it('returns null when file is missing', () => {
    expect(getCurrentRun(tmpDir)).toBeNull();
  });
});

describe('setCurrentRun', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'harness-scr-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes runId to current-run file', () => {
    setCurrentRun(tmpDir, 'test-run-123');
    expect(getCurrentRun(tmpDir)).toBe('test-run-123');
  });
});

describe('resolveRunId', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'harness-rri-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('explicit arg → returns it and updates pointer', () => {
    const runId = resolveRunId(tmpDir, 'explicit-run-456');
    expect(runId).toBe('explicit-run-456');
    // Should have also updated the pointer
    expect(getCurrentRun(tmpDir)).toBe('explicit-run-456');
  });

  it('no arg → reads pointer', () => {
    setCurrentRun(tmpDir, 'pointer-run-789');
    const runId = resolveRunId(tmpDir);
    expect(runId).toBe('pointer-run-789');
  });

  it('no arg + no pointer → throws with guidance', () => {
    expect(() => resolveRunId(tmpDir)).toThrow(
      "No active run. Use 'harness run' to start a new run or 'harness list' to see all runs."
    );
  });
});
