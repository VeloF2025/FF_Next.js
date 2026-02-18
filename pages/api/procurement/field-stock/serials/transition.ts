/**
 * Serial State Transition API
 * POST /api/procurement/field-stock/serials/transition
 * Validates and executes a serial status transition with audit trail.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import {
  transitionSerial,
  isTransitionAllowed,
  getAllowedTransitions,
} from '@/services/procurement/serialStateMachine';
import type { SerialStatusValue } from '@/types/procurement/stock/enums.types';

const VALID_STATUSES: SerialStatusValue[] = [
  'available', 'reserved', 'issued', 'in_transit',
  'installed', 'faulty', 'returned', 'scrapped',
];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const user = (req as AuthenticatedNextApiRequest).user;
  const { serialId, toStatus, reason, locationId, faultReportId, pickingId } = req.body;

  // Validate required fields
  if (!serialId || typeof serialId !== 'string') {
    return apiResponse.validationError(res, { serialId: 'serialId is required (UUID)' });
  }
  if (!toStatus || !VALID_STATUSES.includes(toStatus as SerialStatusValue)) {
    return apiResponse.validationError(res, {
      toStatus: `toStatus must be one of: ${VALID_STATUSES.join(', ')}`,
    });
  }

  try {
    const result = await transitionSerial({
      serialId,
      toStatus: toStatus as SerialStatusValue,
      performedBy: user.id,
      performedByName: user.name,
      reason: reason || undefined,
      locationId: locationId || undefined,
      faultReportId: faultReportId || undefined,
      pickingId: pickingId || undefined,
    });

    if (!result.success) {
      return apiResponse.badRequest(res, result.error || 'Transition failed');
    }

    return apiResponse.success(res, result.serial);
  } catch (error) {
    log.error('Serial transition API error', { data: error }, 'serials/transition');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
