/**
 * Subsequence match: every query character must appear in order. Higher is
 * better; consecutive runs and word starts score extra. Null means no match.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return 0;
  const t = text.toLowerCase();
  let score = 0;
  let ti = 0;
  let run = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    run = found === ti ? run + 1 : 0;
    const wordStart = found === 0 || /[\s\-_./\\]/.test(t[found - 1]);
    score += 1 + run * 2 + (wordStart ? 3 : 0);
    ti = found + 1;
  }
  return score - t.length * 0.01;
}
