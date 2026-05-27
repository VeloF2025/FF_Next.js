/**
 * EOD Sheets API
 * GET: List sheets (paginated, optional date filter)
 * POST: Create new sheet with entries
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import {
  createSheet,
  listSheets,
  getSheetStats,
  findSheetByHash,
} from '@/modules/data-sync/services/eodSheetService';
import { findOverlappingSheets } from '@/modules/data-sync/services/eodOverlapService';
import { recordEodCorrections } from '@/modules/data-sync/services/eodLearningService';
import { ApiResponseHelper, ErrorCode } from '@/lib/apiResponse';
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
  const {
    sheetDate, velocityRepName, velocityRepId, technicianName, technicianId,
    photoUrl, photoHash, vlmRawJson, entries, forceOverlap,
  } = req.body;

  if (!sheetDate || !entries || !Array.isArray(entries) || entries.length === 0) {
    return apiResponse.badRequest(res, 'sheetDate and entries[] are required');
  }
  if (velocityRepName !== undefined && typeof velocityRepName !== 'string') {
    return apiResponse.badRequest(res, 'velocityRepName must be a string');
  }
  if (velocityRepId !== undefined && typeof velocityRepId !== 'string') {
    return apiResponse.badRequest(res, 'velocityRepId must be a string');
  }

  try {
    // Safety-net duplicate check (primary check is in /api/eod/extract before VLM call)
    if (photoHash && typeof photoHash === 'string') {
      const existing = await findSheetByHash(photoHash);
      if (existing) {
        log.warn('[EOD-Sheets] Duplicate save blocked by hash', { photoHash, existingId: existing.id });
        return apiResponse.conflict(res, `Already uploaded on ${existing.sheet_date}`);
      }
    }

    // Content-overlap check: any prior sheet containing the same DR or ONT serial.
    // Bypassed when the client explicitly opts in via forceOverlap=true (user picked
    // "Save anyway" after reviewing the overlap details).
    if (!forceOverlap) {
      const drs = entries
        .map((e: Record<string, unknown>) => (e.dr_number as string) || '')
        .filter(Boolean);
      const onts = entries
        .map((e: Record<string, unknown>) => (e.ont_serial as string) || '')
        .filter(Boolean);

      const overlaps = await findOverlappingSheets(drs, onts);
      if (overlaps.length > 0) {
        log.warn('[EOD-Sheets] Content overlap detected', {
          overlapCount: overlaps.length,
          firstSheet: overlaps[0]?.sheet_id,
        });
        return ApiResponseHelper.error(
          res,
          ErrorCode.CONFLICT,
          'This sheet contains DR numbers or ONT serials that already exist in previous sheets.',
          { overlaps },
        );
      }
    }

    // @ts-expect-error — req.user injected by withAuth
    const uploadedBy = req.user?.email || 'unknown';
    const sheet = await createSheet({
      sheetDate,
      velocityRepName: velocityRepName || null,
      velocityRepId: velocityRepId || null,
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
        gizzuDrNumber: (e.gizzu_dr_number as string) || null,
        ponNumber: (e.pon_number as string) || null,
        address: (e.address as string) || null,
      })),
    });

    // Fire-and-forget: record VLM corrections for learning
    if (vlmRawJson?.entries) {
      recordEodCorrections(
        vlmRawJson.entries,
        entries as Array<{ row_number: number; dr_number: string | null; gizzu_dr_number: string | null; ont_serial: string | null; gizzu_serial: string | null; pon_number: string | null; address: string | null }>,
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
