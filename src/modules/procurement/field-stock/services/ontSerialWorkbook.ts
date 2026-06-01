/**
 * ontSerialWorkbook.ts — parse the "ONT & Gizzu Serials" master workbook into
 * SerialIntakeItem rows.
 *
 * Shared by the manual upload (`pages/api/procurement/field-stock/import-serials.ts`)
 * and the recurring SharePoint sync cron (`pages/api/cron/ont-serials-sync.ts`).
 *
 * Workbook shape (one tab per project plus ignored summary tabs):
 *   Col A: project name   Col B: ONT serial (ALCLB48…)   Col C: Gizzu serial (GU18…)
 * Row 0 is a header and is skipped. Sheets whose name is not a known project
 * (e.g. "info sheet", "All") are reported in `skippedSheets` and ignored.
 */

import type { SerialIntakeItem } from './serialIntake';

/** Known stock_items UUIDs for the two serialised FT consumables. */
export const FT_ONT_ITEM_ID = '84cc2348-f8a9-486f-826a-6b8b20579765';
export const FT_GIZZU_ITEM_ID = '22326fdc-9f65-4419-ade1-8bd7ebeb9826';

/** Project (sheet) name → stock_location UUID. */
export const PROJECT_LOCATIONS: Record<string, string> = {
  lawley: 'cea9e957-7456-4dae-985f-60776d5adffc',
  mohadin: 'dc0766e8-cbee-4eea-832d-4224deecfb83',
  mamelodi: '99033765-ea92-4ce3-bb40-57a216fbf417',
  thembisa: 'f41e0c7d-35c4-4e62-873c-185b6e2f09cb',
  tembisa: 'f41e0c7d-35c4-4e62-873c-185b6e2f09cb',
  etwatwa: '36cd41b9-28cc-4324-9da2-5cd717104aad',
};

/** Minimum length for a value to be treated as a real serial (filters blanks). */
const MIN_SERIAL_LEN = 10;

/** Normalise a raw cell into a canonical serial, stripping the `3ALCL` artifact. */
export function cleanSerial(s: string): string {
  let cleaned = s.trim().toUpperCase();
  if (cleaned.startsWith('3ALCL')) cleaned = cleaned.slice(1);
  return cleaned;
}

export interface ParsedWorkbook {
  /** Parsed ONT serials (stock_item = FT-ONT). */
  ontItems: SerialIntakeItem[];
  /** Parsed Gizzu/UPS serials (stock_item = FT-GIZZU). */
  gizzuItems: SerialIntakeItem[];
  /** Per-project parsed counts (not insert counts). */
  perProject: Record<string, { ont: number; ups: number }>;
  /** Sheet names that did not map to a known project. */
  skippedSheets: string[];
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
): ParsedWorkbook {
  const out: ParsedWorkbook = { ontItems: [], gizzuItems: [], perProject: {}, skippedSheets: [] };

  for (const sheetName of workbook.SheetNames as string[]) {
    const projectKey = sheetName.toLowerCase().trim();
    const locationId = PROJECT_LOCATIONS[projectKey];
    if (!locationId) {
      out.skippedSheets.push(sheetName);
      continue;
    }

    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 }) as unknown[][];
    const rows = data.slice(1); // drop header row

    let ont = 0;
    let ups = 0;
    for (const row of rows) {
      const ontSerial = cleanSerial(String(row[1] ?? ''));
      const upsSerial = cleanSerial(String(row[2] ?? ''));
      if (ontSerial.length >= MIN_SERIAL_LEN) {
        out.ontItems.push({ stockItemId: FT_ONT_ITEM_ID, serialNumber: ontSerial, locationId });
        ont++;
      }
      if (upsSerial.length >= MIN_SERIAL_LEN) {
        out.gizzuItems.push({ stockItemId: FT_GIZZU_ITEM_ID, serialNumber: upsSerial, locationId });
        ups++;
      }
    }
    out.perProject[sheetName] = { ont, ups };
  }

  return out;
}
