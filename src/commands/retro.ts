import fs from 'fs';
import path from 'path';
import os from 'os';
import { findHarnessRoot } from '../root.js';
import { computeRepoKey } from '../logger.js';
import { generateRetrospective } from '../phases/retrospective.js';

export interface RetroOptions {
  root?: string;
  stdout?: boolean;
  sessionsRoot?: string; // override for tests; production uses ~/.harness/sessions
}

export async function retroCommand(runId: string, options: RetroOptions): Promise<void> {
  const harnessDir   = findHarnessRoot(options.root);
  const repoKey      = computeRepoKey(harnessDir);
  const sessionsRoot = options.sessionsRoot ?? path.join(os.homedir(), '.harness', 'sessions');
  const eventsPath   = path.join(sessionsRoot, repoKey, runId, 'events.jsonl');

  if (!fs.existsSync(eventsPath)) {
    process.stderr.write(`[retro] events.jsonl not found at ${eventsPath}\n`);
    process.exit(1);
  }

  let result: { markdown: string };
  try {
    result = generateRetrospective(eventsPath);
  } catch (err) {
    process.stderr.write(`[retro] ${(err as Error).message}\n`);
    process.exit(1);
  }

  if (options.stdout) {
    process.stdout.write(result.markdown + '\n');
    return;
  }

  const outDir  = path.join(harnessDir, runId);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'retrospective.md');
  const tmp     = outPath + '.tmp';
  fs.writeFileSync(tmp, result.markdown);
  fs.renameSync(tmp, outPath);
}
