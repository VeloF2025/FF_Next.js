/**
 * POST /api/procurement/field-stock/movements/[movementId]/reverse
 * Reverse a stock movement. Role-gated to admin/manager roles.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { reverseMovement } from '@/services/procurement/movementReversalService';

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse,
) => {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const user = (req as AuthenticatedNextApiRequest).user;
  const { movementId } = req.query;

  if (!movementId || typeof movementId !== 'string') {
    return apiResponse.badRequest(res, 'Movement ID is required');
  }

  // Role gate: only admin/manager can reverse movements
  const allowedRoles = ['super_admin', 'admin', 'project_manager'];
  if (!allowedRoles.includes(user.role)) {
    return apiResponse.forbidden(res, 'Only administrators and managers can reverse movements');
  }

  const { reason } = req.body;

  if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
    return apiResponse.validationError(res, {
      reason: 'Reason is required and must be at least 10 characters',
    });
  }

  const result = await reverseMovement({
    movementId,
    reason: reason.trim(),
    performedBy: user.id,
    performedByName: user.firstName ?? user.name ?? 'System',
  });

  if (!result.success) {
    return apiResponse.badRequest(res, result.error ?? 'Failed to reverse movement');
  }

  return apiResponse.success(res, {
    message: 'Movement reversed successfully',
    reversalMovementId: result.reversalMovementId,
  });
}));
