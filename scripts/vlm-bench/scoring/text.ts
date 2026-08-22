/** Uppercase and remove anything that is not A-Z or 0-9. */
export function normalizeExact(s: string): string {
  return (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Levenshtein distance / max(len) — character error rate in [0,1]. */
export function charErrorRate(expected: string, actual: string): number {
  const a = expected ?? '';
  const b = actual ?? '';
  if (a.length === 0 && b.length === 0) return 0;
  // Two rolling rows rather than a full matrix: the recurrence only ever reads
  // the previous row, and a flat Int32Array sidesteps noUncheckedIndexedAccess
  // without scattering non-null assertions through the inner loop.
  let prev = new Int32Array(b.length + 1);
  let cur = new Int32Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      // Non-null assertions: prev/cur are fixed-length buffers and j is provably
      // in [1, b.length], but noUncheckedIndexedAccess cannot see that.
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length]! / Math.max(a.length, b.length);
}
