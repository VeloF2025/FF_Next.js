/**
 * Bulk Serial Import API
 * POST: Import ONT + UPS serials from FT master Excel into stock_serials
 *
 * Excel format: 5 sheets (one per project)
 *   Column A: Project name
 *   Column B: ONT serial (ALCLB48...)
 *   Column C: UPS/Gizzu serial (GU18W12V25...)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import formidable from 'formidable';
import * as fs from 'fs';

const sql = neon(process.env.DATABASE_URL!);

// Known stock item IDs
const FT_ONT_ITEM_ID = '84cc2348-f8a9-486f-826a-6b8b20579765';
const FT_GIZZU_ITEM_ID = '22326fdc-9f65-4419-ade1-8bd7ebeb9826';

// Project name → stock_location mapping
const PROJECT_LOCATIONS: Record<string, string> = {
  'lawley': 'cea9e957-7456-4dae-985f-60776d5adffc',
  'mohadin': 'dc0766e8-cbee-4eea-832d-4224deecfb83',
  'mamelodi': '99033765-ea92-4ce3-bb40-57a216fbf417',
  'thembisa': 'f41e0c7d-35c4-4e62-873c-185b6e2f09cb',
  'tembisa': 'f41e0c7d-35c4-4e62-873c-185b6e2f09cb',
  'etwatwa': '36cd41b9-28cc-4324-9da2-5cd717104aad',
};

export const config = {
  api: { bodyParser: false },
};

interface ImportResult {
  ontImported: number;
  upsImported: number;
  ontSkipped: number;
  upsSkipped: number;
  errors: string[];
  perProject: Record<string, { ont: number; ups: number }>;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || '');
  }

  const action = req.query.action as string;

  try {
    const form = formidable({ maxFileSize: 20 * 1024 * 1024 });
    const [, files] = await form.parse(req);
    const file = files.file?.[0];

    if (!file) {
      return apiResponse.badRequest(res, 'No file uploaded');
    }

    // Dynamic import xlsx
    const XLSX = await import('xlsx');
    const workbook = XLSX.readFile(file.filepath);

    if (action === 'preview') {
      return handlePreview(res, workbook, XLSX);
    }

    return handleImport(res, workbook, XLSX);
  } catch (err) {
    log.error('[Serial-Import] Error', { error: err });
    return apiResponse.error(res, 'Import failed', 500);
  }
}

function handlePreview(res: NextApiResponse, workbook: any, XLSX: any) {
  const summary: Record<string, { total: number; sampleOnt: string[]; sampleUps: string[] }> = {};

  for (const sheetName of workbook.SheetNames) {
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 }) as string[][];
    const rows = data.slice(1).filter((r: any[]) => r[1] && String(r[1]).trim().length > 0);
    summary[sheetName] = {
      total: rows.length,
      sampleOnt: rows.slice(0, 3).map((r: any[]) => cleanSerial(String(r[1]))),
      sampleUps: rows.slice(0, 3).map((r: any[]) => cleanSerial(String(r[2] || ''))),
    };
  }

  const totalPairs = Object.values(summary).reduce((s, v) => s + v.total, 0);
  return apiResponse.success(res, { sheets: summary, totalPairs });
}

async function handleImport(res: NextApiResponse, workbook: any, XLSX: any): Promise<void> {
  const result: ImportResult = {
    ontImported: 0, upsImported: 0,
    ontSkipped: 0, upsSkipped: 0,
    errors: [],
    perProject: {},
  };

  const reference = `FT Master Import ${new Date().toISOString().split('T')[0]}`;

  for (const sheetName of workbook.SheetNames) {
    const projectKey = sheetName.toLowerCase().trim();
    const locationId = PROJECT_LOCATIONS[projectKey];

    if (!locationId) {
      result.errors.push(`Unknown project "${sheetName}" — skipped`);
      continue;
    }

    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 }) as any[][];
    const rows = data.slice(1).filter((r: any[]) => r[1] && String(r[1]).trim().length > 0);

    let ontCount = 0;
    let upsCount = 0;

    // Process in chunks of 100
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);

      for (const row of chunk) {
        const ontSerial = cleanSerial(String(row[1] || ''));
        const upsSerial = cleanSerial(String(row[2] || ''));

        // Import ONT
        if (ontSerial && ontSerial.length >= 10) {
          try {
            const [existing] = await sql`
              SELECT id FROM stock_serials
              WHERE stock_item_id = ${FT_ONT_ITEM_ID} AND serial_number = ${ontSerial}
            `;
            if (!existing) {
              await sql`
                INSERT INTO stock_serials (stock_item_id, serial_number, current_location_id, status, received_reference, received_date, condition)
                VALUES (${FT_ONT_ITEM_ID}, ${ontSerial}, ${locationId}, 'available', ${reference}, NOW(), 'new')
              `;
              result.ontImported++;
              ontCount++;
            } else {
              result.ontSkipped++;
            }
          } catch (err: any) {
            if (!err.message?.includes('duplicate')) {
              result.errors.push(`ONT ${ontSerial}: ${err.message}`);
            } else {
              result.ontSkipped++;
            }
          }
        }

        // Import UPS
        if (upsSerial && upsSerial.length >= 10) {
          try {
            const [existing] = await sql`
              SELECT id FROM stock_serials
              WHERE stock_item_id = ${FT_GIZZU_ITEM_ID} AND serial_number = ${upsSerial}
            `;
            if (!existing) {
              await sql`
                INSERT INTO stock_serials (stock_item_id, serial_number, current_location_id, status, received_reference, received_date, condition)
                VALUES (${FT_GIZZU_ITEM_ID}, ${upsSerial}, ${locationId}, 'available', ${reference}, NOW(), 'new')
              `;
              result.upsImported++;
              upsCount++;
            } else {
              result.upsSkipped++;
            }
          } catch (err: any) {
            if (!err.message?.includes('duplicate')) {
              result.errors.push(`UPS ${upsSerial}: ${err.message}`);
            } else {
              result.upsSkipped++;
            }
          }
        }
      }
    }

    result.perProject[sheetName] = { ont: ontCount, ups: upsCount };
  }

  log.info('[Serial-Import] Complete', {
    ontImported: result.ontImported,
    upsImported: result.upsImported,
    ontSkipped: result.ontSkipped,
    upsSkipped: result.upsSkipped,
    errors: result.errors.length,
  });

  return apiResponse.success(res, result) as unknown as void;
}

function cleanSerial(s: string): string {
  let cleaned = s.trim().toUpperCase();
  // Strip leading "3" from ONT serials (data artifact)
  if (cleaned.startsWith('3ALCL')) cleaned = cleaned.slice(1);
  return cleaned;
}

export default withAuth(handler);
