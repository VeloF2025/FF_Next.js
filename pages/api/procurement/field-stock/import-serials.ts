/**
 * Bulk Serial Import API
 * POST: Import ONT + Gizzu serials from the FT master Excel into stock_serials.
 *
 * Receives serials as status='in_stock' through receiveSerials(), which emits a
 * mig-387 `received` genesis event per new serial (idempotent — existing
 * serials are skipped). Shares workbook parsing + the receive path with the
 * recurring SharePoint sync cron (pages/api/cron/ont-serials-sync.ts).
 *
 * Excel format: one sheet per project — Col A project, Col B ONT, Col C Gizzu.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { randomUUID } from 'node:crypto';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import pool from '@/lib/db-pool';
import formidable from 'formidable';
import { receiveSerials } from '@/modules/procurement/field-stock/services/serialIntake';
import {
  parseOntGizzuWorkbook,
  cleanSerial,
} from '@/modules/procurement/field-stock/services/ontSerialWorkbook';

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
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  const action = req.query.action as string;

  try {
    const form = formidable({ maxFileSize: 20 * 1024 * 1024 });
    const [, files] = await form.parse(req);
    const file = files.file?.[0];

    if (!file) {
      return apiResponse.badRequest(res, 'No file uploaded');
    }

    const XLSX = await import('xlsx');
    const workbook = XLSX.readFile(file.filepath);

    if (action === 'preview') {
      return handlePreview(res, workbook, XLSX);
    }

    return await handleImport(res, workbook, XLSX);
  } catch (err) {
    log.error('[Serial-Import] Error', { error: err });
    return apiResponse.internalError(res, err, 'Import failed');
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- xlsx untyped
function handlePreview(res: NextApiResponse, workbook: any, XLSX: any) {
  const summary: Record<string, { total: number; sampleOnt: string[]; sampleUps: string[] }> = {};

  for (const sheetName of workbook.SheetNames) {
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 }) as string[][];
    const rows = data.slice(1).filter((r: unknown[]) => r[1] && String(r[1]).trim().length > 0);
    summary[sheetName] = {
      total: rows.length,
      sampleOnt: rows.slice(0, 3).map((r: unknown[]) => cleanSerial(String(r[1]))),
      sampleUps: rows.slice(0, 3).map((r: unknown[]) => cleanSerial(String(r[2] || ''))),
    };
  }

  const totalPairs = Object.values(summary).reduce((s, v) => s + v.total, 0);
  return apiResponse.success(res, { sheets: summary, totalPairs });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- xlsx untyped
async function handleImport(res: NextApiResponse, workbook: any, XLSX: any): Promise<void> {
  // Warehouses resolved from the database, same as the recurring sync — see
  // sheetLocation.ts for why a hardcoded map was removed.
  const locRows = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM stock_locations WHERE location_type = 'warehouse'`,
  );
  const projRows = await pool.query<{ id: string; name: string }>(
    `SELECT id, project_name AS name FROM projects`,
  );
  const parsed = parseOntGizzuWorkbook(workbook, XLSX, locRows.rows, projRows.rows);
  const result: ImportResult = {
    ontImported: 0,
    upsImported: 0,
    ontSkipped: 0,
    upsSkipped: 0,
    // Reason and row cost, not just the tab name: an unresolved tab used to be
    // indistinguishable from an ignored summary tab.
    errors: parsed.unresolvedSheets
      .filter((u) => u.reason !== 'not-a-project')
      .map(
        (u) =>
          `Sheet "${u.sheetName}" not imported (${u.reason}${
            u.candidates ? `: ${u.candidates.join(', ')}` : ''
          }) — ${u.rowsLost} row(s) skipped`,
      ),
    // Per-project counts hold serials actually RECEIVED (inserted), not parsed.
    perProject: {},
  };

  const reference = `FT Master Import ${new Date().toISOString().split('T')[0]}`;
  const sourceId = randomUUID();

  // Receive per project so perProject reflects accurate insert counts.
  for (const project of parsed.projects) {
    const ont = await receiveSerials(pool, project.ontItems, {
      sourceTable: 'ont_serial_import',
      sourceId,
      receivedReference: reference,
      payload: { source: 'manual_upload', kind: 'ont', project: project.name },
    });
    const ups = await receiveSerials(pool, project.gizzuItems, {
      sourceTable: 'ont_serial_import',
      sourceId,
      receivedReference: reference,
      payload: { source: 'manual_upload', kind: 'gizzu', project: project.name },
    });
    result.ontImported += ont.received;
    result.ontSkipped += ont.skipped;
    result.upsImported += ups.received;
    result.upsSkipped += ups.skipped;
    result.perProject[project.name] = { ont: ont.received, ups: ups.received };
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

export default withAuth(handler);
