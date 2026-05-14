/**
 * EOD Sheet Detail API
 * GET:    Fetch single sheet with entries
 * PATCH:  Update entries, re-diff VLM learning, re-run write-back
 * DELETE: Delete sheet
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import {
  getSheet,
  deleteSheet,
  updateSheetEntries,
} from '@/modules/data-sync/services/eodSheetService';
import { recordEodCorrections } from '@/modules/data-sync/services/eodLearningService';
import { log } from '@/lib/logger';
import type { EodVlmEntry } from '@/modules/data-sync/types';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { sheetId } = req.query;
  if (typeof sheetId !== 'string') return apiResponse.badRequest(res, 'sheetId required');

  if (req.method === 'GET') return handleGet(res, sheetId);
  if (req.method === 'PATCH') return handlePatch(req, res, sheetId);
  if (req.method === 'DELETE') return handleDelete(res, sheetId);
  return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'PATCH', 'DELETE']);
}

async function handleGet(res: NextApiResponse, sheetId: string) {
  try {
    const sheet = await getSheet(sheetId);
    if (!sheet) return apiResponse.notFound(res, 'Sheet', sheetId);
    return apiResponse.success(res, sheet);
  } catch (err) {
    log.error('[EOD-Sheet] Get error', { sheetId, error: err });
    return apiResponse.internalError(res, err, 'Failed to get sheet');
  }
}

async function handlePatch(req: NextApiRequest, res: NextApiResponse, sheetId: string) {
  const { entries } = req.body as { entries?: unknown[] };
  if (!entries || !Array.isArray(entries) || entries.length === 0) {
    return apiResponse.badRequest(res, 'entries[] required');
  }

  try {
    const sheet = await getSheet(sheetId);
    if (!sheet) return apiResponse.notFound(res, 'Sheet', sheetId);

    // @ts-expect-error — req.user injected by withAuth
    const updatedBy: string = req.user?.email || 'unknown';

    const mappedEntries = (entries as Record<string, unknown>[]).map((e) => ({
      id: String(e.id),
      rowNumber: Number(e.row_number) || 0,
      ontSerial: (e.ont_serial as string | null) || null,
      gizzuSerial: (e.gizzu_serial as string | null) || null,
      drNumber: (e.dr_number as string | null) || null,
      gizzuDrNumber: (e.gizzu_dr_number as string | null) || null,
      ponNumber: (e.pon_number as string | null) || null,
      address: (e.address as string | null) || null,
    }));

    const result = await updateSheetEntries(sheetId, mappedEntries, updatedBy);

    // Re-diff against original VLM extraction for learning — fire and forget
    const vlmRaw = sheet.vlm_raw_json as { entries?: EodVlmEntry[] } | null | undefined;
    if (vlmRaw?.entries) {
      recordEodCorrections(
        vlmRaw.entries,
        (entries as Record<string, unknown>[]).map((e) => ({
          row_number: Number(e.row_number) || 0,
          dr_number: (e.dr_number as string | null) || null,
          gizzu_dr_number: (e.gizzu_dr_number as string | null) || null,
          ont_serial: (e.ont_serial as string | null) || null,
          gizzu_serial: (e.gizzu_serial as string | null) || null,
          pon_number: (e.pon_number as string | null) || null,
          address: (e.address as string | null) || null,
        })),
        sheetId,
        sheet.photo_url
      ).catch((err) => log.warn('[EOD-Learning] Re-diff failed', { sheetId, error: err }));
    }

    return apiResponse.success(res, result);
  } catch (err) {
    log.error('[EOD-Sheet] Patch error', { sheetId, error: err });
    return apiResponse.internalError(res, err, 'Failed to update sheet entries');
  }
}

async function handleDelete(res: NextApiResponse, sheetId: string) {
  try {
    const deleted = await deleteSheet(sheetId);
    if (!deleted) return apiResponse.notFound(res, 'Sheet', sheetId);
    return apiResponse.success(res, { deleted: true });
  } catch (err) {
    log.error('[EOD-Sheet] Delete error', { sheetId, error: err });
    return apiResponse.internalError(res, err, 'Failed to delete sheet');
  }
}

export default withAuth(handler);
