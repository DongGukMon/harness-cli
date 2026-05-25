const SCAN_CAP_BYTES = 64 * 1024;
const ITEM_HEADER_RE = /^- \*\*\[P[0-2]\]\*\* /m;

export interface FilterResult {
  filtered: string;
  dropped: number;
  parsedOk: boolean;
}

export function filterFeedbackByIds(feedback: string, stuckIds: string[]): FilterResult {
  if (stuckIds.length === 0) {
    return { filtered: feedback, dropped: 0, parsedOk: true };
  }
  if (!ITEM_HEADER_RE.test(feedback)) {
    return { filtered: feedback, dropped: 0, parsedOk: false };
  }

  // Split on item-header lines. Keep the preamble (text before first item) intact.
  const globalSplit = /^- \*\*\[P[0-2]\]\*\* /gm;
  let m: RegExpExecArray | null;
  const headerPositions: number[] = [];
  while ((m = globalSplit.exec(feedback)) !== null) {
    headerPositions.push(m.index);
  }

  const preamble = headerPositions.length > 0 ? feedback.slice(0, headerPositions[0]) : '';
  const body = headerPositions.length > 0 ? feedback.slice(headerPositions[0]) : feedback;

  const parts: string[] = [];
  for (let i = 0; i < headerPositions.length; i++) {
    const start = headerPositions[i] - headerPositions[0];
    const end =
      i + 1 < headerPositions.length
        ? headerPositions[i + 1] - headerPositions[0]
        : body.length;
    parts.push(body.slice(start, end));
  }

  const stuckSet = new Set(stuckIds);
  let dropped = 0;
  const kept: string[] = [];
  for (const item of parts) {
    const ids = extractRequirementIds(item);
    if (ids.length === 0) {
      kept.push(item);
      continue;
    }
    const allStuck = ids.every(id => stuckSet.has(id));
    if (allStuck) {
      dropped++;
    } else {
      kept.push(item);
    }
  }

  return { filtered: preamble + kept.join(''), dropped, parsedOk: true };
}


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
