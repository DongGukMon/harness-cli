import { findHarnessRoot } from '../root.js';
import { cleanupOrphans } from '../orphan-cleanup.js';

export interface CleanupCommandOptions {
  dryRun?: boolean;
  yes?: boolean;
  root?: string;
}

export async function cleanupCommand(opts: CleanupCommandOptions = {}): Promise<void> {
  let harnessDir: string;
  try {
    harnessDir = findHarnessRoot(opts.root);
  } catch {
    process.stderr.write('Error: no .harness/ directory found. Run from a directory with a .harness/ folder.\n');
    process.exit(1);
  }

  await cleanupOrphans(harnessDir, {
    dryRun: opts.dryRun,
    yes: opts.yes,
  });
}
