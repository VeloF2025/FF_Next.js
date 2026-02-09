/**
 * Contractor Directors API
 * GET: List directors for a contractor
 * POST: Add a new director/staff member
 * PUT: Update an existing director
 * DELETE: Remove a director
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth/middleware';
import { contractorVerificationService } from '@/services/contractor/contractorVerificationService';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      const { contractorId } = req.query;
      if (!contractorId || typeof contractorId !== 'string') {
        return apiResponse.validationError(res, { contractorId: 'Required' });
      }

      const directors = await contractorVerificationService.getDirectors(contractorId);
      return apiResponse.success(res, directors);
    } catch (error) {
      log.error('Failed to fetch directors', { error }, 'contractors-directors');
      return apiResponse.internalError(res, error);
    }
  }

  if (req.method === 'POST') {
    try {
      const { contractorId, fullName, idNumber, idType, role, isPrimary } = req.body;

      if (!contractorId || typeof contractorId !== 'string') {
        return apiResponse.validationError(res, { contractorId: 'Required' });
      }
      if (!fullName || typeof fullName !== 'string') {
        return apiResponse.validationError(res, { fullName: 'Required' });
      }
      if (!idNumber || typeof idNumber !== 'string') {
        return apiResponse.validationError(res, { idNumber: 'Required' });
      }

      const director = await contractorVerificationService.saveDirector(contractorId, {
        fullName,
        idNumber,
        idType: idType || 'sa_id',
        role: role || 'director',
        isPrimary: isPrimary || false,
      });

      return apiResponse.created(res, director, 'Director added');
    } catch (error) {
      log.error('Failed to add director', { error }, 'contractors-directors');
      return apiResponse.internalError(res, error);
    }
  }

  if (req.method === 'PUT') {
    try {
      const { id, fullName, idNumber, idType, role, isPrimary } = req.body;

      if (!id || typeof id !== 'string') {
        return apiResponse.validationError(res, { id: 'Director ID required' });
      }

      const director = await contractorVerificationService.updateDirector(id, {
        fullName, idNumber, idType, role, isPrimary,
      });

      return apiResponse.success(res, director, 'Director updated');
    } catch (error) {
      log.error('Failed to update director', { error }, 'contractors-directors');
      return apiResponse.internalError(res, error);
    }
  }

  if (req.method === 'DELETE') {
    try {
      const { id } = req.query;
      if (!id || typeof id !== 'string') {
        return apiResponse.validationError(res, { id: 'Director ID required' });
      }

      await contractorVerificationService.deleteDirector(id);
      return apiResponse.success(res, null, 'Director removed');
    } catch (error) {
      log.error('Failed to delete director', { error }, 'contractors-directors');
      return apiResponse.internalError(res, error);
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST', 'PUT', 'DELETE']);
}

export default withAuth(handler);
