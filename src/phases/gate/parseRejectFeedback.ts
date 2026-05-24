const SCAN_CAP_BYTES = 64 * 1024;
const ID_RE = /\bR\d+(?:\.[A-Za-z0-9]+)?\b/g;

export function extractRequirementIds(feedback: string): string[] {
  if (!feedback) return [];
  const scanned = feedback.length > SCAN_CAP_BYTES ? feedback.slice(0, SCAN_CAP_BYTES) : feedback;
  try {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of scanned.matchAll(ID_RE)) {
      const id = m[0];
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    return out;
  } catch {
    return [];
  }
}
