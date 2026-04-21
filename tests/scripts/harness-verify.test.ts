import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const SCRIPT_PATH = resolve(process.cwd(), 'scripts/harness-verify.sh');

function makeWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), 'harness-verify-test-'));
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  return { dir, cleanup };
}

describe('harness-verify.sh', () => {
  it('isolates per-check cwd so a `cd subdir` check does not break subsequent appends to a relative OUTPUT_FILE', () => {
    const { dir, cleanup } = makeWorkspace();
    try {
      // Create a subdirectory the first check will `cd` into.
      // If the script did not isolate cwd, the relative OUTPUT_FILE path
      // would resolve under `subpkg/` on the second check and fail.
      mkdirSync(join(dir, 'subpkg'));

      const checklistPath = join(dir, 'checklist.json');
      writeFileSync(
        checklistPath,
        JSON.stringify({
          checks: [
            { name: 'first-cd-subpkg', command: 'cd subpkg && true' },
            { name: 'second-append', command: 'true' },
          ],
        }),
      );

      // Relative output path — script is spawned with cwd = dir.
      const relativeOutput = 'docs/process/evals/test-eval.md';

      const result = spawnSync('bash', [SCRIPT_PATH, checklistPath, relativeOutput], {
        cwd: dir,
        encoding: 'utf-8',
      });

      expect(result.status).toBe(0);

      const outputAbs = join(dir, relativeOutput);
      expect(existsSync(outputAbs)).toBe(true);

      const report = readFileSync(outputAbs, 'utf-8');
      expect(report).toContain('first-cd-subpkg');
      expect(report).toContain('second-append');
      expect(report).toContain('| pass |');
    } finally {
      cleanup();
    }
  });

  it('isolates env mutations between checks', () => {
    const { dir, cleanup } = makeWorkspace();
    try {
      const checklistPath = join(dir, 'checklist.json');
      writeFileSync(
        checklistPath,
        JSON.stringify({
          checks: [
            { name: 'set-env', command: 'export LEAK_VAR=leaked' },
            // If the first check leaked LEAK_VAR into the script shell,
            // this check would succeed. With subshell isolation, LEAK_VAR
            // must be unset in the second check's shell → test -z passes.
            { name: 'expect-unset', command: 'test -z "${LEAK_VAR:-}"' },
          ],
        }),
      );

      const relativeOutput = 'eval.md';
      const result = spawnSync('bash', [SCRIPT_PATH, checklistPath, relativeOutput], {
        cwd: dir,
        encoding: 'utf-8',
      });

      expect(result.status).toBe(0);
      const report = readFileSync(join(dir, relativeOutput), 'utf-8');
      expect(report).toMatch(/\| expect-unset \| pass \|/);
    } finally {
      cleanup();
    }
  });
});
