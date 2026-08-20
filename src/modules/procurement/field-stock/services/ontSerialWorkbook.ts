/**
 * ontSerialWorkbook.ts — parse the "ONT & Gizzu Serials" master workbook into
 * SerialIntakeItem rows.
 *
 * Shared by the manual upload (`pages/api/procurement/field-stock/import-serials.ts`)
 * and the recurring SharePoint sync cron (`pages/api/cron/ont-serials-sync.ts`).
 *
 * Workbook shape (one tab per project plus ignored summary tabs):
 *   Col A: project name   Col B: ONT serial (ALCLB48…)   Col C: Gizzu serial (GU18…)
 * Row 0 is a header and is skipped. Each remaining tab is resolved onto a
 * stock_location by NAME (see sheetLocation.ts) rather than a hardcoded UUID
 * map — the old map silently dropped the "Tembelilhle" tab and its 504 ONT +
 * 504 Gizzu serials for as long as it existed. Tabs that cannot be resolved are
 * reported in `unresolvedSheets` WITH A REASON, so the next one cannot vanish
 * the same way.
 */

import type { SerialIntakeItem } from './serialIntake';
import { resolveSheetLocation } from './sheetLocation';
import type { LocationRef } from './sheetLocation';

/** Known stock_items UUIDs for the two serialised FT consumables. */
export const FT_ONT_ITEM_ID = '84cc2348-f8a9-486f-826a-6b8b20579765';
export const FT_GIZZU_ITEM_ID = '22326fdc-9f65-4419-ade1-8bd7ebeb9826';

/** Minimum length for a value to be treated as a real serial (filters blanks). */
const MIN_SERIAL_LEN = 10;

/** Normalise a raw cell into a canonical serial, stripping the `3ALCL` artifact. */
export function cleanSerial(s: string): string {
  let cleaned = s.trim().toUpperCase();
  if (cleaned.startsWith('3ALCL')) cleaned = cleaned.slice(1);
  return cleaned;
}

/** A tab that produced no serials, and why — never a silent drop. */
export interface UnresolvedSheet {
  sheetName: string;
  reason: 'not-a-project' | 'no-match' | 'ambiguous' | 'alias-target-missing';
  /** Warehouse names considered, when the tab was ambiguous. */
  candidates?: string[];
  /** Serial-bearing rows lost because the tab could not be resolved. */
  rowsLost: number;
}

export interface ParsedProject {
  /** Sheet (project) name as it appears in the workbook. */
  name: string;
  /** The warehouse this tab resolved to, and how it was matched. */
  locationName: string;
  matchedBy: 'exact' | 'prefix' | 'fuzzy' | 'alias';
  /** ONT serials parsed from this project's sheet. */
  ontItems: SerialIntakeItem[];
  /** Gizzu/UPS serials parsed from this project's sheet. */
  gizzuItems: SerialIntakeItem[];
}

export interface ParsedWorkbook {
  /** All ONT serials, flattened across projects (stock_item = FT-ONT). */
  ontItems: SerialIntakeItem[];
  /** All Gizzu/UPS serials, flattened across projects (stock_item = FT-GIZZU). */
  gizzuItems: SerialIntakeItem[];
  /** Per-project grouping, so callers can report accurate per-project results. */
  projects: ParsedProject[];
  /** Sheet names that did not map to a known project. Kept for callers/reporting. */
  skippedSheets: string[];
  /** The same tabs with the reason each was not imported, and what it cost. */
  unresolvedSheets: UnresolvedSheet[];
}

/**
 * Parse a loaded xlsx workbook into ONT and Gizzu intake items. `XLSX` is the
 * already-imported `xlsx` module (passed in so callers control import timing).
 */
export function parseOntGizzuWorkbook(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- xlsx has no first-class types here
  workbook: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  XLSX: any,
  /** Warehouse rows to resolve tab names against (from stock_locations). */
  locations: LocationRef[],
): ParsedWorkbook {
  const out: ParsedWorkbook = {
    ontItems: [], gizzuItems: [], projects: [], skippedSheets: [], unresolvedSheets: [],
  };

  for (const sheetName of workbook.SheetNames as string[]) {
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 }) as unknown[][];
    const rows = data.slice(1); // drop header row

    const resolved = resolveSheetLocation(sheetName, locations);
    if (!resolved.ok) {
      // Count what this tab WOULD have contributed, so an unresolved sheet
      // reports its cost instead of just its name.
      const rowsLost = rows.filter((row) => {
        const ont = cleanSerial(String(row[1] ?? ''));
        const ups = cleanSerial(String(row[2] ?? ''));
        return ont.length >= MIN_SERIAL_LEN || ups.length >= MIN_SERIAL_LEN;
      }).length;
      out.skippedSheets.push(sheetName);
      out.unresolvedSheets.push({
        sheetName,
        reason: resolved.reason,
        ...(resolved.candidates ? { candidates: resolved.candidates } : {}),
        rowsLost,
      });
      continue;
    }
    const locationId = resolved.locationId;

    const project: ParsedProject = {
      name: sheetName,
      locationName: resolved.locationName,
      matchedBy: resolved.how,
      ontItems: [],
      gizzuItems: [],
    };
    for (const row of rows) {
      const ontSerial = cleanSerial(String(row[1] ?? ''));
      const upsSerial = cleanSerial(String(row[2] ?? ''));
      if (ontSerial.length >= MIN_SERIAL_LEN) {
        project.ontItems.push({ stockItemId: FT_ONT_ITEM_ID, serialNumber: ontSerial, locationId });
      }
      if (upsSerial.length >= MIN_SERIAL_LEN) {
        project.gizzuItems.push({ stockItemId: FT_GIZZU_ITEM_ID, serialNumber: upsSerial, locationId });
      }
    }
    out.projects.push(project);
    out.ontItems.push(...project.ontItems);
    out.gizzuItems.push(...project.gizzuItems);
  }

  return out;
}
