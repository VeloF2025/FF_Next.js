/**
 * API: /api/maintenance/verification-step
 *
 * PUT - Update a verification step
 *
 * Query params:
 * - ticketId: UUID of the ticket (required)
 * - stepNumber: Step number 1-12 (required)
 *
 * Body:
 * - is_complete?: boolean
 * - completed_by?: string (UUID)
 * - photo_url?: string
 * - photo_verified?: boolean
 * - notes?: string
 *
 * 🟢 WORKING: Flat route to avoid Vercel nested dynamic route issues
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import type {
  VerificationStep,
  UpdateVerificationStepPayload,
} from '@/modules/maintenance/types/verification';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') {
    return res.status(405).json({
      success: false,
      error: { message: 'Method not allowed' },
    });
  }

  const { ticketId, stepNumber } = req.query;

  // Validate ticketId
  if (!ticketId || typeof ticketId !== 'string') {
    return apiResponse.badRequest(res, 'ticketId query parameter is required');
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(ticketId)) {
    return apiResponse.badRequest(res, 'Invalid ticketId format');
  }

  // Validate stepNumber
  if (!stepNumber || typeof stepNumber !== 'string') {
    return apiResponse.badRequest(res, 'stepNumber query parameter is required');
  }

  const stepNum = parseInt(stepNumber, 10);
  if (isNaN(stepNum) || stepNum < 1 || stepNum > 12) {
    return apiResponse.badRequest(res, 'stepNumber must be between 1 and 12');
  }

  try {
    // Verify step exists and get current values
    const existing = (await sql`
      SELECT * FROM maintenance_verification_steps
      WHERE ticket_id = ${ticketId} AND step_number = ${stepNum}
    `) as VerificationStep[];

    const currentStep = existing[0];
    if (!currentStep) {
      return apiResponse.notFound(res, 'Verification step', `${ticketId}/${stepNum}`);
    }

    // Parse and validate payload
    const payload: UpdateVerificationStepPayload = req.body;

    // Execute update - merge payload with current values
    const result = (await sql`
      UPDATE maintenance_verification_steps
      SET
        is_complete = ${payload.is_complete ?? currentStep.is_complete},
        completed_at = ${payload.is_complete === true ? new Date().toISOString() : payload.is_complete === false ? null : currentStep.completed_at},
        completed_by = ${payload.is_complete === false ? null : (payload.completed_by ?? currentStep.completed_by)},
        photo_url = ${payload.photo_url ?? currentStep.photo_url},
        photo_verified = ${payload.photo_verified ?? currentStep.photo_verified},
        notes = ${payload.notes ?? currentStep.notes}
      WHERE ticket_id = ${ticketId} AND step_number = ${stepNum}
      RETURNING *
    `) as VerificationStep[];

    log.info('Updated verification step', { ticketId, stepNumber: stepNum });

    return apiResponse.success(res, result[0]);
  } catch (error) {
    log.error('Failed to update verification step', { error, ticketId, stepNumber: stepNum });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
