import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { IGNORABLE_ARTIFACTS, type IgnorablePattern } from '../config.js';

export interface DirtyTreeRecoveryResult {
  outcome: 'clean' | 'recovered' | 'blocked';
  blockers: string[];      // porcelain lines that prevent recovery
  addedEntries: string[];  // .gitignore globs newly appended
}

/**
 * Parse a `git status --porcelain` line into {flag, path}. Porcelain format is
 * a 2-char status code + space + path. Rename lines use `"XY old -> new"`; we
 * keep the `new` path so downstream classification sees the current filesystem
 * entry (and `git add .gitignore` does not need to chase the old name).
 */
function parseLine(line: string): { flag: string; filePath: string } | null {
  if (line.length < 3) return null;
  const flag = line.slice(0, 2);
  const rest = line.slice(3);
  const arrowIdx = rest.indexOf(' -> ');
  const filePath = arrowIdx >= 0 ? rest.slice(arrowIdx + 4) : rest;
  return { flag, filePath };
}

function matchIgnorable(filePath: string): IgnorablePattern | null {
  for (const p of IGNORABLE_ARTIFACTS) {
    if (p.pathRegex.test(filePath)) return p;
  }
  return null;
}

function readGitignore(cwd: string): string {
  const p = path.join(cwd, '.gitignore');
  try { return fs.readFileSync(p, 'utf-8'); }
  catch { return ''; }
}

function gitignoreHasEntry(body: string, glob: string): boolean {
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed === glob) return true;
  }
  return false;
}

/**
 * Best-effort auto-recovery for a dirty working tree at Phase 5 sentinel time.
 * - Porcelain empty → `outcome: 'clean'` (no-op).
 * - Every untracked line matches `IGNORABLE_ARTIFACTS` → append missing globs
 *   to `.gitignore` + commit → verify porcelain is empty → `recovered`.
 * - Any tracked-state line or unknown untracked path → `blocked` (caller
 *   renders diagnostic; no changes made).
 *
 * `git commit` failures propagate as thrown errors; the caller is expected to
 * wrap this in a try/catch that classifies the phase as failed.
 */
export function tryAutoRecoverDirtyTree(
  cwd: string,
  runId: string,
): DirtyTreeRecoveryResult {
  const porcelain = execSync('git status --porcelain', { cwd, encoding: 'utf-8' }).trim();
  if (porcelain === '') {
    return { outcome: 'clean', blockers: [], addedEntries: [] };
  }

  const lines = porcelain.split(/\r?\n/).filter(l => l.length > 0);
  const blockers: string[] = [];
  const globsToAdd: string[] = [];

  for (const raw of lines) {
    const parsed = parseLine(raw);
    if (!parsed) {
      blockers.push(raw);
      continue;
    }
    const isUntracked = parsed.flag === '??';
    if (!isUntracked) {
      blockers.push(raw);
      continue;
    }
    const match = matchIgnorable(parsed.filePath);
    if (!match) {
      blockers.push(raw);
      continue;
    }
    if (!globsToAdd.includes(match.gitignoreGlob)) {
      globsToAdd.push(match.gitignoreGlob);
    }
  }

  if (blockers.length > 0) {
    return { outcome: 'blocked', blockers, addedEntries: [] };
  }

  // All lines matched allowlist. Append globs to .gitignore that are missing.
  const existing = readGitignore(cwd);
  const missing = globsToAdd.filter(g => !gitignoreHasEntry(existing, g));

  if (missing.length > 0) {
    const gitignorePath = path.join(cwd, '.gitignore');
    const needsLeadingNewline = existing.length > 0 && !existing.endsWith('\n');
    const block = `${needsLeadingNewline ? '\n' : ''}# harness auto-ignore (P5 residual artifacts)\n${missing.join('\n')}\n`;
    fs.appendFileSync(gitignorePath, block);

    execSync('git add .gitignore', { cwd });
    execSync(
      `git commit -m "chore(harness): auto-ignore residual artifacts [${runId}]"`,
      { cwd },
    );
  }

  // Re-check: if anything remains, classify as blocked (prevents recursion /
  // surfaces unexpected state).
  const after = execSync('git status --porcelain', { cwd, encoding: 'utf-8' }).trim();
  if (after !== '') {
    return {
      outcome: 'blocked',
      blockers: after.split(/\r?\n/),
      addedEntries: missing,
    };
  }
  return { outcome: 'recovered', blockers: [], addedEntries: missing };
}

/**
 * Render a Phase 5 dirty-tree diagnostic next to the sentinel. Caller decides
 * when (on strict-tree short-circuit, or on auto-recovery `blocked`).
 */
export function writeDirtyTreeDiagnostic(
  runDir: string,
  reason: 'strict-tree' | 'blocked',
  body: string,
): void {
  const diagPath = path.join(runDir, 'phase-5-dirty-tree.md');
  const ts = new Date().toISOString();
  const header =
    reason === 'strict-tree'
      ? '# Phase 5 — Dirty Tree (strict-tree enabled)'
      : '# Phase 5 — Dirty Tree (auto-recovery blocked)';
  const content = [
    header,
    '',
    `- timestamp: ${ts}`,
    `- reason: ${reason}`,
    '',
    '## git status --porcelain',
    '',
    '```',
    body,
    '```',
    '',
    '## To recover manually',
    '',
    '- Fix git state (commit, stash, or remove the offending paths) then run `harness resume`.',
    '- Or invoke `harness jump 5` to re-execute Phase 5 from scratch.',
    '',
  ].join('\n');

  try { fs.writeFileSync(diagPath, content, 'utf-8'); }
  catch { /* best-effort */ }
}
