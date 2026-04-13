import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';

export function createTestRepo(): { path: string; cleanup: () => void } {
  const path = mkdtempSync(join(tmpdir(), 'harness-test-'));
  execSync('git init && git commit --allow-empty -m "init"', { cwd: path });
  return {
    path,
    cleanup: () => rmSync(path, { recursive: true, force: true }),
  };
}
