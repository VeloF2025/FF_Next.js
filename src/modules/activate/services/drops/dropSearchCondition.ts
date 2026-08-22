/**
 * The free-text search predicate shared by every Activate service that filters
 * dr_photo_unified_reviews by `filters.search`.
 *
 * Lives in its own module so the list, the summary cards and the per-project
 * table all build the identical predicate — divergence there is how a serial
 * search would show rows beside zeroed cards.
 */

/**
 * Columns on dr_photo_unified_reviews that hold a device serial the free-text
 * search must match. `*_scanned` is what the field team's photo produced,
 * `oes_serial` is what the Nokia OES report carries — a DR can have one without
 * the other (491 of 28 273 rows on 2026-08-22 have no scanned ONT serial but do
 * have an OES one), so searching a serial has to cover all three.
 *
 * ONT serials are ALCL / ALCB prefixed, Gizzu UPS serials are GU18W prefixed.
 */
const SEARCHABLE_SERIAL_COLUMNS = ['ont_serial_scanned', 'ups_serial_scanned', 'oes_serial'];

/**
 * Free-text search predicate over a dr_photo_unified_reviews row: drop number,
 * project, or any device serial.
 *
 * MUST be shared by every consumer that applies `filters.search` to this table —
 * the list and the summary/per-project counts diverging here is how a serial
 * search would show rows with a zeroed summary card.
 *
 * @param placeholder bound-parameter placeholder, e.g. '$3' (never user input)
 * @param dropNumberCol qualified drop-number expression
 * @param projectCol qualified project expression
 * @param serialPrefix table alias prefix for the serial columns, e.g. 'u.'
 */
export function unifiedSearchCondition(
  placeholder: string,
  dropNumberCol = 'drop_number',
  projectCol = 'project',
  serialPrefix = ''
): string {
  const parts = [
    `${dropNumberCol} ILIKE ${placeholder}`,
    `${projectCol} ILIKE ${placeholder}`,
    ...SEARCHABLE_SERIAL_COLUMNS.map((col) => `${serialPrefix}${col} ILIKE ${placeholder}`),
  ];
  return `(${parts.join(' OR ')})`;
}
