/**
 * EOD Install Sheet Service
 * CRUD operations for eod_install_sheets and eod_install_sheet_entries
 */

import { sql, transaction } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import type { EodInstallSheet, EodInstallSheetEntry } from '../types';
import { logSerialChange } from '@/modules/activate/services/activity-log/serialHistory';

interface CreateSheetInput {
  sheetDate: string;
  velocityRepName: string | null;
  velocityRepId: string | null;
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
    gizzuDrNumber: string | null;
    ponNumber: string | null;
    address: string | null;
  }[];
}

interface WriteBackResult {
  matched_count: number;
  logged_count: number;
}

export interface UpdateEntryInput {
  id: string;
  rowNumber: number;
  ontSerial: string | null;
  gizzuSerial: string | null;
  drNumber: string | null;
  gizzuDrNumber: string | null;
  ponNumber: string | null;
  address: string | null;
}

export interface UpdateSheetResult {
  updated_count: number;
  matched_count: number;
  logged_count: number;
}

export async function writeBackDrSerials(
  entries: CreateSheetInput['entries'],
  sheetId: string,
  uploadedBy: string
): Promise<WriteBackResult> {
  let matched_count = 0;
  let logged_count = 0;

  const candidates = entries.filter((e) => e.drNumber && e.ontSerial);

  for (const entry of candidates) {
    const drNumber = entry.drNumber!;
    const eodOnt = entry.ontSerial!;

    // Look up current serial in dr_photo_unified_reviews
    const rows = await sql`
      SELECT ont_serial_scanned
      FROM dr_photo_unified_reviews
      WHERE drop_number = ${drNumber}
      LIMIT 1
    `;

    if (rows.length === 0) {
      log.warn('[EOD-WriteBack] DR not found in dr_photo_unified_reviews', { drNumber });
      continue;
    }

    const currentOnt = (rows[0] as { ont_serial_scanned: string | null }).ont_serial_scanned ?? null;

    // Atomic fill: UPDATE only if the column is still null (guards against concurrent writes)
    const updated = await sql`
      UPDATE dr_photo_unified_reviews
      SET ont_serial_scanned = ${eodOnt}
      WHERE drop_number = ${drNumber}
        AND ont_serial_scanned IS NULL
      RETURNING 1
    `;
    if (updated.length > 0) matched_count++;

    // Log to serial_change_history + dr_activity_log regardless of whether we updated
    try {
      const result = await logSerialChange(
        drNumber,
        'ont_serial',
        currentOnt,
        eodOnt,
        'eod_sheet',
        uploadedBy,
        'technician_update',
        { eod_sheet_id: sheetId, eod_entry_row: entry.rowNumber }
      );
      if (result.historyId) logged_count++;
    } catch (err) {
      log.warn('[EOD-WriteBack] logSerialChange failed', { drNumber, error: err });
    }
  }

  return { matched_count, logged_count };
}

export async function createSheet(input: CreateSheetInput): Promise<EodInstallSheet & { matched_count: number; logged_count: number }> {
  // Insert sheet header
  const rows = await sql`
    INSERT INTO eod_install_sheets (
      sheet_date, velocity_rep_name, velocity_rep_id,
      technician_name, technician_id,
      photo_url, photo_hash, entry_count, vlm_raw_json, uploaded_by
    ) VALUES (
      ${input.sheetDate}, ${input.velocityRepName}, ${input.velocityRepId},
      ${input.technicianName}, ${input.technicianId},
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
        dr_number, gizzu_dr_number, pon_number, address
      ) VALUES (
        ${sheet.id}, ${entry.rowNumber}, ${entry.ontSerial}, ${entry.gizzuSerial},
        ${entry.drNumber}, ${entry.gizzuDrNumber ?? null}, ${entry.ponNumber}, ${entry.address}
      )
    `;
  }

  const writeBack = await writeBackDrSerials(input.entries, sheet.id as string, input.uploadedBy);

  log.info('[EOD] Sheet created', {
    id: sheet.id,
    date: input.sheetDate,
    entries: input.entries.length,
    matched_count: writeBack.matched_count,
    logged_count: writeBack.logged_count,
  });

  return { ...(sheet as unknown as EodInstallSheet), ...writeBack };
}

export async function updateSheetEntries(
  sheetId: string,
  entries: UpdateEntryInput[],
  updatedBy: string
): Promise<UpdateSheetResult> {
  const updated_count = await transaction(async (txn) => {
    let n = 0;
    for (const entry of entries) {
      const rows = await txn.query<{ id: string }>(
        `UPDATE eod_install_sheet_entries
         SET ont_serial = $1, gizzu_serial = $2, dr_number = $3, gizzu_dr_number = $4, pon_number = $5, address = $6
         WHERE id = $7 AND sheet_id = $8
         RETURNING id`,
        [entry.ontSerial, entry.gizzuSerial, entry.drNumber, entry.gizzuDrNumber ?? null, entry.ponNumber, entry.address, entry.id, sheetId]
      );
      if (rows.length > 0) n++;
    }
    return n;
  });

  const writeBack = await writeBackDrSerials(
    entries.map((e) => ({
      rowNumber: e.rowNumber,
      ontSerial: e.ontSerial,
      gizzuSerial: e.gizzuSerial,
      drNumber: e.drNumber,
      gizzuDrNumber: e.gizzuDrNumber,
      ponNumber: e.ponNumber,
      address: e.address,
    })),
    sheetId,
    updatedBy
  );

  log.info('[EOD] Entries updated', {
    sheetId,
    updated_count,
    matched_count: writeBack.matched_count,
    logged_count: writeBack.logged_count,
  });

  return { updated_count, ...writeBack };
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
    return { sheets: sheets as unknown as EodInstallSheet[], total: count };
  }

  const sheets = await sql`
    SELECT * FROM eod_install_sheets
    ORDER BY sheet_date DESC, created_at DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `;
  const [{ count }] = (await sql`
    SELECT COUNT(*)::int as count FROM eod_install_sheets
  `) as unknown as [{ count: number }];
  return { sheets: sheets as unknown as EodInstallSheet[], total: count };
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
    entries: entries as unknown as EodInstallSheetEntry[],
  } as unknown as EodInstallSheet;
}

export async function findSheetByHash(photoHash: string): Promise<{ id: string; sheet_date: string } | null> {
  const rows = await sql`
    SELECT id, sheet_date::text FROM eod_install_sheets WHERE photo_hash = ${photoHash} LIMIT 1
  `;
  if (rows.length === 0) return null;
  const row = rows[0] as Record<string, unknown>;
  return { id: String(row.id), sheet_date: String(row.sheet_date) };
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
  const stats = statsRows[0] as unknown as { total_sheets: number; last_upload_date: string | null; pending_reconciliation: number };
  return {
    totalSheets: stats.total_sheets,
    lastUploadDate: stats.last_upload_date,
    pendingReconciliation: stats.pending_reconciliation,
  };
}
