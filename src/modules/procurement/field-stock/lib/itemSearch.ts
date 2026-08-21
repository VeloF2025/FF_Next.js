/**
 * Search rules for the stock-item picker.
 *
 * Pure, so the matching can be tested without a DOM. The list is fully loaded
 * by the caller (316 items in production on 2026-08-21), so filtering is local.
 */

export interface SearchableStockItem {
  id: string;
  itemCode: string;
  name: string;
  category?: string;
  trackingType?: string;
}

/**
 * Matches on item code, name or category, case-insensitively.
 *
 * Category is included deliberately: a clerk looking for a splitter thinks in
 * terms of "optics" as readily as the product name, and the categories are the
 * axis the old truncated list happened to cut along.
 */
export function itemMatchesQuery(item: SearchableStockItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    (item.itemCode ?? '').toLowerCase().includes(needle) ||
    (item.name ?? '').toLowerCase().includes(needle) ||
    (item.category ?? '').toLowerCase().includes(needle)
  );
}

/** Filter, preserving the server's `category, name` ordering. */
export function filterStockItems<T extends SearchableStockItem>(items: T[], query: string): T[] {
  return items.filter((item) => itemMatchesQuery(item, query));
}

/** Secondary line under the item name: category and serial-tracking flag. */
export function itemSubtitle(item: SearchableStockItem): string {
  const parts = [item.category].filter(Boolean) as string[];
  if (item.trackingType === 'serial') parts.push('serial-tracked');
  return parts.join(' · ');
}
