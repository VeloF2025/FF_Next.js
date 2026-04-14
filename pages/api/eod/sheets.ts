/**
 * EOD Sheets API
 * GET: List sheets (paginated, optional date filter)
 * POST: Create new sheet with entries
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { createSheet, listSheets, getSheetStats } from '@/modules/data-sync/services/eodSheetService';
import { recordEodCorrections } from '@/modules/data-sync/services/eodLearningService';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return handleGet(req, res);
  }
  if (req.method === 'POST') {
    return handlePost(req, res);
  }
  return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const page = parseInt(req.query.page as string) || 1;
  const date = req.query.date as string | undefined;
  const stats = req.query.stats === 'true';

  try {
    if (stats) {
      const data = await getSheetStats();
      return apiResponse.success(res, data);
    }
    const data = await listSheets(page, 20, date);
    return apiResponse.success(res, data);
  } catch (err) {
    log.error('[EOD-Sheets] List error', { error: err });
    return apiResponse.internalError(res, err, 'Failed to list sheets');
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const { sheetDate, technicianName, technicianId, photoUrl, photoHash, vlmRawJson, entries } =
    req.body;

  if (!sheetDate || !entries || !Array.isArray(entries) || entries.length === 0) {
    return apiResponse.badRequest(res, 'sheetDate and entries[] are required');
  }

  try {
    // @ts-expect-error — req.user injected by withAuth
    const uploadedBy = req.user?.email || 'unknown';
    const sheet = await createSheet({
      sheetDate,
      technicianName: technicianName || null,
      technicianId: technicianId || null,
      photoUrl: photoUrl || null,
      photoHash: photoHash || null,
      vlmRawJson: vlmRawJson || null,
      uploadedBy,
      entries: entries.map((e: Record<string, unknown>, i: number) => ({
        rowNumber: (e.row_number as number) || i + 1,
        ontSerial: (e.ont_serial as string) || null,
        gizzuSerial: (e.gizzu_serial as string) || null,
        drNumber: (e.dr_number as string) || null,
        ponNumber: (e.pon_number as string) || null,
        address: (e.address as string) || null,
      })),
    });

    // Fire-and-forget: record VLM corrections for learning
    if (vlmRawJson?.entries) {
      recordEodCorrections(
        vlmRawJson.entries,
        entries as Array<{ row_number: number; dr_number: string | null; ont_serial: string | null; gizzu_serial: string | null; pon_number: string | null; address: string | null }>,
        sheet.id,
        photoUrl || null
      ).catch((err) => log.warn('[EOD-Learning] Background recording failed', { error: err }));
    }

    return apiResponse.created(res, sheet);
  } catch (err) {
    log.error('[EOD-Sheets] Create error', { error: err });
    return apiResponse.internalError(res, err, 'Failed to create sheet');
  }
}

export default withAuth(handler);
