/**
 * Row cap for the stock-item list endpoints.
 *
 * These endpoints used a hard `LIMIT 100` on every branch with no OFFSET and no
 * pagination. There are 316 active stock items, ordered by `category, name`, so
 * the cap fell mid-alphabet: everything in optics, poles, services, stringing
 * and tools was unreachable. A procurement clerk searching for a splitter, a
 * 4-way gland, an oval kit or a fibre cable got nothing back and reasonably
 * concluded the item did not exist in FibreFlow.
 *
 * The list is small and the rows are narrow, so the fix is a bound high enough
 * to stop truncating rather than pagination the callers would have to learn.
 * The cap stays as a runaway guard, not as a page size.
 */

/** Enough headroom for the catalogue to roughly triple before this bites again. */
export const DEFAULT_ITEM_LIMIT = 1000;

/** Hard ceiling, so a caller cannot ask for the whole table. */
export const MAX_ITEM_LIMIT = 5000;

/**
 * Resolve the `limit` query parameter to a safe positive integer.
 *
 * Anything absent, unparseable, zero, negative or fractional falls back to the
 * default rather than reaching SQL — a NaN or 0 would silently return nothing,
 * which is the same class of failure this module exists to fix.
 */
export function resolveItemLimit(raw: unknown): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' && typeof value !== 'number') return DEFAULT_ITEM_LIMIT;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_ITEM_LIMIT;
  }
  return Math.min(parsed, MAX_ITEM_LIMIT);
}
