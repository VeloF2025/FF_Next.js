/** Uppercase and remove anything that is not A-Z or 0-9. */
export function normalizeExact(s: string): string {
  return (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Levenshtein distance / max(len) — character error rate in [0,1]. */
export function charErrorRate(expected: string, actual: string): number {
  const a = expected ?? '';
  const b = actual ?? '';
  if (a.length === 0 && b.length === 0) return 0;
  const d: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i++) d[i][0] = i;
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[a.length][b.length] / Math.max(a.length, b.length);
}
