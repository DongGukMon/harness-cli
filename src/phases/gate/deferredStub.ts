import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GateRejectEntry } from '../../types.js';
import type { GatePhase } from '../../types.js';

export function writeDeferredStub(
  runDir: string,
  phase: GatePhase,
  requirementId: string,
  history: GateRejectEntry[],
  threshold: number,
): string {
  const dir = path.join(runDir, 'deferred');
  fs.mkdirSync(dir, { recursive: true });
  const stubPath = path.join(dir, `phase-${phase}-${requirementId}.md`);

  const matching = history.filter(e => e.requirementIds.includes(requirementId));
  const rejectCount = matching.length;

  const lines: string[] = [];
  lines.push(`# Deferred stubborn requirement: ${requirementId}`);
  lines.push('');
  lines.push(`- Phase ${phase}`);
  lines.push(`- Requirement ID: ${requirementId}`);
  lines.push(`- Reject count: ${rejectCount}`);
  lines.push(`- Auto-deferred after threshold ${threshold}`);
  lines.push('');
  lines.push('## Reject feedback files');
  lines.push('');
  for (const e of matching) {
    lines.push(`- cycle ${e.cycle} retry ${e.retryIndex} — ${e.feedbackPath}`);
  }
  lines.push('');
  lines.push('## Action required');
  lines.push('');
  lines.push('Manual review needed before merge. This requirement could not be satisfied automatically; address in a follow-up commit/PR.');

  fs.writeFileSync(stubPath, lines.join('\n') + '\n', 'utf-8');
  return stubPath;
}
