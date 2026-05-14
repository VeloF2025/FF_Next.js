/**
 * Content-overlap detection for EOD install sheets.
 *
 * DR number and ONT serial are physical device identifiers — if either reappears
 * in a new sheet it almost always means the same install is being recorded twice,
 * regardless of who uploaded it or when. The check is intentionally date/tech
 * agnostic so partial-then-completed sheets are caught even across days.
 */

import { sql } from '@/lib/db-pool';
import type { EodOverlapMatch } from '../types';

export async function findOverlappingSheets(
  drNumbers: string[],
  ontSerials: string[],
): Promise<EodOverlapMatch[]> {
  const drs = drNumbers.filter(Boolean);
  const onts = ontSerials.filter(Boolean);
  if (drs.length === 0 && onts.length === 0) return [];

  const rows = await sql`
    SELECT
      s.id::text AS sheet_id,
      s.sheet_date::text AS sheet_date,
      s.uploaded_by,
      s.technician_name,
      ARRAY_AGG(DISTINCT e.dr_number) FILTER (WHERE e.dr_number = ANY(${drs}::text[])) AS overlapping_drs,
      ARRAY_AGG(DISTINCT e.ont_serial) FILTER (WHERE e.ont_serial = ANY(${onts}::text[])) AS overlapping_onts
    FROM eod_install_sheets s
    JOIN eod_install_sheet_entries e ON e.sheet_id = s.id
    WHERE e.dr_number = ANY(${drs}::text[]) OR e.ont_serial = ANY(${onts}::text[])
    GROUP BY s.id, s.sheet_date, s.uploaded_by, s.technician_name
    ORDER BY s.sheet_date DESC
    LIMIT 10
  `;

  return rows.map((r): EodOverlapMatch => {
    const row = r as Record<string, unknown>;
    return {
      sheet_id: String(row.sheet_id),
      sheet_date: String(row.sheet_date),
      uploaded_by: row.uploaded_by ? String(row.uploaded_by) : null,
      technician_name: row.technician_name ? String(row.technician_name) : null,
      overlapping_drs: ((row.overlapping_drs as string[] | null) ?? []).filter(Boolean),
      overlapping_onts: ((row.overlapping_onts as string[] | null) ?? []).filter(Boolean),
    };
  });
}
