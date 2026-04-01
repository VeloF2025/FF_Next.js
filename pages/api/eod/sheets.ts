/**
 * EOD Sheets API
 * GET: List sheets (paginated, optional date filter)
 * POST: Create new sheet with entries
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { createSheet, listSheets, getSheetStats } from '@/modules/data-sync/services/eodSheetService';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return handleGet(req, res);
  }
  if (req.method === 'POST') {
    return handlePost(req, res);
  }
  return apiResponse.methodNotAllowed(res, req.method || '');
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
    return apiResponse.error(res, 'Failed to list sheets', 500);
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

    return apiResponse.success(res, sheet, 201);
  } catch (err) {
    log.error('[EOD-Sheets] Create error', { error: err });
    return apiResponse.error(res, 'Failed to create sheet', 500);
  }
}

export default withAuth(handler);
