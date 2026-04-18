import fs from 'fs';

export function isValidChecklistSchema(absPath: string): boolean {
  try {
    const raw = fs.readFileSync(absPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.checks) || parsed.checks.length === 0) return false;
    for (const check of parsed.checks) {
      if (typeof check?.name !== 'string' || typeof check?.command !== 'string') return false;
    }
    return true;
  } catch {
    return false;
  }
}
