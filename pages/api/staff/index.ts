/**
 * Staff API Route — thin HTTP handler
 * Business logic lives in:
 *   src/services/staff/staffGetService.ts    — GET (single + list)
 *   src/services/staff/staffCreateService.ts — POST + DELETE
 *   src/services/staff/staffUpdateDeleteService.ts — PUT
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';

import { getStaffById, getStaffList } from '@/services/staff/staffGetService';
import { createStaff, deleteStaffMember } from '@/services/staff/staffCreateService';
import { updateStaff } from '@/services/staff/staffUpdateDeleteService';
import { apiResponse } from '@/lib/apiResponse';

export default withAuth(withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  const authReq = req as AuthenticatedNextApiRequest;
  const userId = authReq.user.id;

  try {
    switch (req.method) {
      // -----------------------------------------------------------------------
      case 'GET': {
        const { id, search, department, status, position } = req.query;

        if (id) {
          const staff = await getStaffById(id as string, userId);
          if (!staff) {
            return res.status(404).json({
              success: false,
              data: null,
              message: 'Staff member not found',
            });
          }
          return res.status(200).json({ success: true, data: staff });
        }

        const list = await getStaffList({ search, department, status, position }, userId);
        return res.status(200).json({
          success: true,
          data: list,
          message: list.length === 0 ? 'No staff members found' : undefined,
        });
      }

      // -----------------------------------------------------------------------
      case 'POST': {
        const result = await createStaff(req.body);
        if (!result.ok) {
          return res.status(result.error.status).json({
            success: false,
            data: null,
            message: result.error.message,
            code: result.error.code,
          });
        }
        return res.status(201).json({ success: true, data: result.data });
      }

      // -----------------------------------------------------------------------
      case 'PUT': {
        if (!req.query.id) {
          return res.status(400).json({ success: false, error: 'Staff ID required' });
        }
        const result = await updateStaff(req.query.id as string, req.body);
        if (!result.ok) {
          return res.status(404).json({ success: false, error: 'Staff member not found' });
        }
        return res.status(200).json({ success: true, data: result.data });
      }

      // -----------------------------------------------------------------------
      case 'DELETE': {
        if (!req.query.id) {
          return res.status(400).json({ success: false, error: 'Staff ID required' });
        }
        await deleteStaffMember(req.query.id as string);
        return res.status(200).json({ success: true, message: 'Staff member deleted successfully' });
      }

      // -----------------------------------------------------------------------
      default:
        return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST', 'PUT', 'DELETE']);
    }
  } catch (error: unknown) {
    log.error('Staff API Error', { error });

    const dbError = error as { code?: string; message?: string; constraint?: string };

    if (dbError.code === '23503') {
      const constraintMatch = dbError.message?.match(/constraint "([^"]+)"/);
      const constraint = constraintMatch?.[1] ?? 'unknown';
      const tableMatch = dbError.message?.match(/on table "([^"]+)"/);
      const table = tableMatch?.[1] ?? 'another table';
      return res.status(409).json({
        success: false,
        error: `Cannot delete: This staff member is still referenced in ${table}. Please reassign or remove those references first.`,
        details: `Constraint: ${constraint}`,
      });
    }

    if (dbError.code === '23505') {
      if (dbError.constraint === 'staff_employee_id_unique') {
        return res.status(409).json({
          success: false,
          error: 'Employee ID already exists. Please use a different employee ID.',
        });
      }
      if (dbError.constraint === 'staff_email_unique') {
        return res.status(409).json({
          success: false,
          error: 'Email address already exists. Please use a different email address.',
        });
      }
      return res.status(409).json({
        success: false,
        error: 'Duplicate entry. This record already exists.',
      });
    }

    return res.status(500).json({
      success: false,
      error: dbError.message ?? 'Internal server error',
    });
  }
}));
