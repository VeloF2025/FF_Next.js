/**
 * PPE acknowledgement sheets.
 *
 * GET  /api/health-safety/ppe/acknowledgements?staffId=… | ?teamMemberId=…
 *        Every sheet the worker has held, current one first.
 * POST /api/health-safety/ppe/acknowledgements
 *        Start a new sheet, closing the previous one.
 * PATCH /api/health-safety/ppe/acknowledgements?sheetId=…&action=close
 *        Close the current sheet without starting another.
 *
 * Flat route rather than nested under a worker id: the worker is one of two
 * columns (staff or team member), so it is a query pair rather than a path
 * segment, and inventing a synthetic path key would make the two look like one.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type { AuthenticatedNextApiRequest } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { withHsPermission } from '@/modules/health-safety/services/hsAuth';
import { logHsActivity } from '@/modules/health-safety/services/activityLog';
import {
  PpeAcknowledgementConflict,
  closeSheet,
  listSheetsFor,
  startSheet,
  type WorkerRef,
} from '@/modules/health-safety/services/ppeAcknowledgementService';

const logger = createLogger('PpeAcknowledgementsAPI');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function first(value: unknown): string | undefined {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
  return typeof value === 'string' ? value : undefined;
}

/**
 * Exactly one of staffId / teamMemberId, mirroring the table's
 * hs_ppe_acknowledgements_one_worker CHECK so a caller sees a 400 rather than a
 * constraint violation surfacing as a 500.
 */
function readWorker(source: Record<string, unknown>): WorkerRef | { error: string } {
  const staffId = first(source.staffId);
  const teamMemberId = first(source.teamMemberId);

  if (Boolean(staffId) === Boolean(teamMemberId)) {
    return { error: 'Provide exactly one of staffId or teamMemberId' };
  }
  if (staffId) {
    if (!UUID.test(staffId)) return { error: 'staffId is not a valid identifier' };
    return { staffId };
  }
  if (!UUID.test(teamMemberId!)) return { error: 'teamMemberId is not a valid identifier' };
  return { teamMemberId: teamMemberId! };
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const worker = readWorker(req.query as Record<string, unknown>);
  if ('error' in worker) return apiResponse.badRequest(res, worker.error);

  return apiResponse.success(res, await listSheetsFor(worker));
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const authReq = req as AuthenticatedNextApiRequest;
  const body = (req.body ?? {}) as Record<string, unknown>;

  const worker = readWorker(body);
  if ('error' in worker) return apiResponse.badRequest(res, worker.error);

  const workerName = typeof body.workerName === 'string' ? body.workerName.trim() : '';
  if (!workerName) return apiResponse.badRequest(res, 'workerName is required');

  const sheet = await startSheet({
    worker,
    workerName,
    contractorId: (first(body.contractorId) as string) || null,
    projectId: (first(body.projectId) as string) || null,
    sheetDate: (first(body.sheetDate) as string) || null,
    notes: typeof body.notes === 'string' ? body.notes : null,
    actorUserId: authReq.user.id,
  });

  await logHsActivity({
    activityType: 'ppe_acknowledgement_started',
    entityType: 'ppe_acknowledgement',
    entityId: sheet.id,
    description: `PPE acknowledgement sheet started for ${workerName}`,
    metadata: { sheetId: sheet.id, workerName },
    user: { id: authReq.user.id },
  });

  return apiResponse.created(res, sheet, 'Acknowledgement sheet started');
}

async function handlePatch(req: NextApiRequest, res: NextApiResponse) {
  const authReq = req as AuthenticatedNextApiRequest;
  const sheetId = first(req.query.sheetId);
  if (!sheetId || !UUID.test(sheetId)) {
    return apiResponse.badRequest(res, 'sheetId is not a valid identifier');
  }
  if (first(req.query.action) !== 'close') {
    return apiResponse.badRequest(res, 'Only action=close is supported');
  }

  // False means it was already closed or never existed. Reported as 404 rather
  // than a silent success, so a stale UI cannot show a sheet as freshly closed
  // when nothing happened.
  if (!(await closeSheet(sheetId))) {
    return apiResponse.notFound(res, 'Open acknowledgement sheet', sheetId);
  }

  await logHsActivity({
    activityType: 'ppe_acknowledgement_closed',
    entityType: 'ppe_acknowledgement',
    entityId: sheetId,
    description: 'PPE acknowledgement sheet closed',
    metadata: { sheetId },
    user: { id: authReq.user.id },
  });

  return apiResponse.success(res, { id: sheetId }, 'Acknowledgement sheet closed');
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    if (req.method === 'PATCH') return await handlePatch(req, res);
    return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST', 'PATCH']);
  } catch (error) {
    // Two requests raced to open a sheet for the same worker and the partial
    // unique index refused the loser. That is a conflict the caller can resolve
    // by reloading — not a server fault, and not a 500.
    if (error instanceof PpeAcknowledgementConflict) {
      return apiResponse.conflict(res, error.message);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('PPE acknowledgement request failed', { method: req.method, error: message });
    return apiResponse.internalError(res, error, 'Failed to process the acknowledgement sheet');
  }
}

export default withHsPermission(handler);
