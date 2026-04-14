/**
 * EOD Install Sheet Service
 * CRUD operations for eod_install_sheets and eod_install_sheet_entries
 */

import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import type { EodInstallSheet, EodInstallSheetEntry } from '../types';

const sql = neon(process.env.DATABASE_URL!);

interface CreateSheetInput {
  sheetDate: string;
  technicianName: string | null;
  technicianId: string | null;
  photoUrl: string | null;
  photoHash: string | null;
  vlmRawJson: unknown;
  uploadedBy: string;
  entries: {
    rowNumber: number;
    ontSerial: string | null;
    gizzuSerial: string | null;
    drNumber: string | null;
    ponNumber: string | null;
    address: string | null;
  }[];
}

export async function createSheet(input: CreateSheetInput): Promise<EodInstallSheet> {
  // Insert sheet header
  const rows = await sql`
    INSERT INTO eod_install_sheets (
      sheet_date, technician_name, technician_id,
      photo_url, photo_hash, entry_count, vlm_raw_json, uploaded_by
    ) VALUES (
      ${input.sheetDate}, ${input.technicianName}, ${input.technicianId},
      ${input.photoUrl}, ${input.photoHash}, ${input.entries.length},
      ${JSON.stringify(input.vlmRawJson)}::jsonb, ${input.uploadedBy}
    )
    RETURNING *
  `;
  const sheet = rows[0]!;

  // Insert entries
  for (const entry of input.entries) {
    await sql`
      INSERT INTO eod_install_sheet_entries (
        sheet_id, row_number, ont_serial, gizzu_serial,
        dr_number, pon_number, address
      ) VALUES (
        ${sheet.id}, ${entry.rowNumber}, ${entry.ontSerial}, ${entry.gizzuSerial},
        ${entry.drNumber}, ${entry.ponNumber}, ${entry.address}
      )
    `;
  }

  log.info('[EOD] Sheet created', {
    id: sheet.id,
    date: input.sheetDate,
    entries: input.entries.length,
  });

  return sheet as EodInstallSheet;
}

export async function listSheets(
  page: number = 1,
  pageSize: number = 20,
  dateFilter?: string
): Promise<{ sheets: EodInstallSheet[]; total: number }> {
  const offset = (page - 1) * pageSize;

  if (dateFilter) {
    const sheets = await sql`
      SELECT * FROM eod_install_sheets
      WHERE sheet_date = ${dateFilter}
      ORDER BY created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;
    const [{ count }] = (await sql`
      SELECT COUNT(*)::int as count FROM eod_install_sheets
      WHERE sheet_date = ${dateFilter}
    `) as unknown as [{ count: number }];
    return { sheets: sheets as EodInstallSheet[], total: count };
  }

  const sheets = await sql`
    SELECT * FROM eod_install_sheets
    ORDER BY sheet_date DESC, created_at DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `;
  const [{ count }] = (await sql`
    SELECT COUNT(*)::int as count FROM eod_install_sheets
  `) as unknown as [{ count: number }];
  return { sheets: sheets as EodInstallSheet[], total: count };
}

export async function getSheet(id: string): Promise<EodInstallSheet | null> {
  const [sheet] = await sql`
    SELECT * FROM eod_install_sheets WHERE id = ${id}
  `;
  if (!sheet) return null;

  const entries = await sql`
    SELECT * FROM eod_install_sheet_entries
    WHERE sheet_id = ${id}
    ORDER BY row_number
  `;

  return {
    ...sheet,
    entries: entries as EodInstallSheetEntry[],
  } as EodInstallSheet;
}

export async function deleteSheet(id: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM eod_install_sheets WHERE id = ${id} RETURNING id
  `;
  return result.length > 0;
}

export async function getSheetStats(): Promise<{
  totalSheets: number;
  lastUploadDate: string | null;
  pendingReconciliation: number;
}> {
  const statsRows = await sql`
    SELECT
      COUNT(*)::int as total_sheets,
      MAX(sheet_date)::text as last_upload_date,
      (SELECT COUNT(*)::int FROM eod_install_sheet_entries WHERE match_status = 'pending') as pending_reconciliation
    FROM eod_install_sheets
  `;
  const stats = statsRows[0]!;
  return {
    totalSheets: stats.total_sheets,
    lastUploadDate: stats.last_upload_date,
    pendingReconciliation: stats.pending_reconciliation,
  };
}
