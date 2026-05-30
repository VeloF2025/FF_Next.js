/**
 * POST /api/procurement/field-stock/serials/force-correct
 *
 * Force-corrects stock_serials column values bypassing the state machine.
 * Requires permission procurement.field-stock.force-correct (edit).
 * Per-serial best-effort: per-row failures returned in body, not as HTTP errors.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withPermission, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { forceCorrectSerials } from '@/modules/procurement/field-stock/services/serialForceCorrectService';
import type { ForceCorrectStatus, ForceCorrectTarget } from '@/types/field-stock';

const VALID_STATUSES: readonly ForceCorrectStatus[] = [
  'available', 'in_stock', 'reserved', 'allocated_to_project', 'in_transit', 'issued',
  'installed', 'activated', 'faulty', 'in_repair', 'returned', 'scrapped',
];

const TARGET_KEYS: (keyof ForceCorrectTarget)[] = [
  'status', 'currentLocationId', 'allocatedToProjectId',
  'installedAtDropNumber', 'activatedAtOltId',
];

const MAX_BATCH = 500;
const MAX_SERIAL_LEN = 255;
const MIN_REASON_LEN = 10;
const MAX_REASON_LEN = 2000;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }
  const user = (req as AuthenticatedNextApiRequest).user;
  const body = (req.body ?? {}) as {
    serials?: unknown;
    target?: unknown;
    reason?: unknown;
    dryRun?: unknown;
  };

  // 1. serials
  if (!Array.isArray(body.serials)) {
    return apiResponse.validationError(res, { serials: 'serials must be an array' });
  }
  const serials = body.serials
    .filter((s: unknown): s is string => typeof s === 'string')
    .map(s => s.trim())
    .filter(s => s.length > 0);
  if (serials.length === 0) {
    return apiResponse.validationError(res, { serials: 'at least one non-empty serial required' });
  }
  if (serials.length > MAX_BATCH) {
    return apiResponse.validationError(res, { serials: `max ${MAX_BATCH} serials per batch` });
  }
  if (serials.some(s => s.length > MAX_SERIAL_LEN)) {
    return apiResponse.validationError(res, { serials: `each serial must be ≤ ${MAX_SERIAL_LEN} characters` });
  }

  // 2. target
  if (!body.target || typeof body.target !== 'object' || Array.isArray(body.target)) {
    return apiResponse.validationError(res, { target: 'target object required' });
  }
  const rawTarget = body.target as Record<string, unknown>;
  const target: ForceCorrectTarget = {};
  for (const key of TARGET_KEYS) {
    if (key in rawTarget) {
      const value = rawTarget[key];
      // Allow string | null only; reject other types.
      if (value !== null && typeof value !== 'string') {
        return apiResponse.validationError(res, {
          [`target.${key}`]: 'must be string or null',
        });
      }
      // For status we additionally constrain to the valid enum.
      // Cast target to the union of its value types (not `unknown`) so that
      // adding a non-string field to ForceCorrectTarget later surfaces a TS error
      // at this cast site. The intermediate step is required because
      // noUncheckedIndexedAccess + strict collapse the LHS union to the most
      // restrictive member (ForceCorrectStatus) when doing indexed assignment.
      (target as Record<keyof ForceCorrectTarget, ForceCorrectTarget[keyof ForceCorrectTarget]>)[key] = value as ForceCorrectTarget[typeof key];
    }
  }
  if (Object.keys(target).length === 0) {
    return apiResponse.validationError(res, { target: 'at least one target field required' });
  }
  if (target.status !== undefined &&
      !VALID_STATUSES.includes(target.status)) {
    return apiResponse.validationError(res, {
      'target.status': `must be one of: ${VALID_STATUSES.join(', ')}`,
    });
  }

  // 3. reason
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < MIN_REASON_LEN) {
    return apiResponse.validationError(res, { reason: `reason must be at least ${MIN_REASON_LEN} characters` });
  }
  if (reason.length > MAX_REASON_LEN) {
    return apiResponse.validationError(res, { reason: `reason must be ≤ ${MAX_REASON_LEN} characters` });
  }

  // 4. dryRun (default true if missing — defensive)
  const dryRun = typeof body.dryRun === 'boolean' ? body.dryRun : true;

  try {
    const result = await forceCorrectSerials({
      serials,
      target,
      reason,
      performedBy: user.id,
      performedByName: user.name,
      dryRun,
    });
    return apiResponse.success(res, result);
  } catch (err) {
    log.error('force-correct API error', { err }, 'force-correct');
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('procurement.field-stock.force-correct', 'edit')(handler));
