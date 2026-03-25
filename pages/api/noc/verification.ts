/**
 * API: /api/noc/verification
 *
 * GET - Fetch verification steps for a ticket
 * POST - Get verification progress (complete status)
 *
 * Query params:
 * - ticketId: UUID of the ticket (required)
 *
 * // WORKING: Flat route to avoid Vercel nested dynamic route issues
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import {
  getStepsForTicketType,
} from '@/modules/noc/constants/verificationSteps';
import type {
  VerificationStep,
  VerificationProgress,
} from '@/modules/noc/types/verification';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

/**
 * Initialize type-specific verification steps for a ticket if they don't exist.
 * Reads the ticket's `type` column to select the correct step checklist.
 */
async function initializeVerificationSteps(
  ticketId: string,
  ticketType: string
): Promise<VerificationStep[]> {
  // Check if steps already exist
  const existing = await sql`
    SELECT id, ticket_id, step_number, step_name, step_description,
           is_complete, completed_at, completed_by, photo_required,
           photo_url, photo_verified, notes, created_at
    FROM maintenance_verification_steps
    WHERE ticket_id = ${ticketId}
    ORDER BY step_number
  `;

  if (existing.length > 0) {
    return existing as VerificationStep[];
  }

  // Resolve the correct step list for this ticket type
  const templates = getStepsForTicketType(ticketType);

  // Insert each step sequentially
  for (const template of templates) {
    await sql`
      INSERT INTO maintenance_verification_steps (ticket_id, step_number, step_name, step_description, photo_required)
      VALUES (${ticketId}, ${template.step_number}, ${template.step_name}, ${template.step_description}, ${template.photo_required})
    `;
  }

  // Fetch and return created steps
  const created = await sql`
    SELECT id, ticket_id, step_number, step_name, step_description,
           is_complete, completed_at, completed_by, photo_required,
           photo_url, photo_verified, notes, created_at
    FROM maintenance_verification_steps
    WHERE ticket_id = ${ticketId}
    ORDER BY step_number
  `;

  log.info('Initialized verification steps for ticket', {
    ticketId,
    ticketType,
    count: created.length,
  });

  return created as VerificationStep[];
}

/**
 * Calculate verification progress using the actual number of steps for this ticket.
 */
function calculateProgress(steps: VerificationStep[]): VerificationProgress {
  const totalSteps = steps.length;
  const completedSteps = steps.filter((s) => s.is_complete).length;
  const pendingSteps = totalSteps - completedSteps;
  const progressPercentage = totalSteps > 0
    ? Math.round((completedSteps / totalSteps) * 100)
    : 0;

  return {
    ticket_id: steps[0]?.ticket_id || '',
    total_steps: totalSteps,
    completed_steps: completedSteps,
    pending_steps: pendingSteps,
    progress_percentage: progressPercentage,
    all_steps_complete: totalSteps > 0 && completedSteps === totalSteps,
    steps,
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { ticketId } = req.query;

  if (!ticketId || typeof ticketId !== 'string') {
    return apiResponse.badRequest(res, 'ticketId query parameter is required');
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(ticketId)) {
    return apiResponse.badRequest(res, 'Invalid ticketId format');
  }

  // GET - Fetch verification steps
  if (req.method === 'GET') {
    try {
      // Verify ticket exists and fetch its type
      const ticket = await sql`
        SELECT id, type FROM maintenance_tickets WHERE id = ${ticketId}
      `;

      if (ticket.length === 0) {
        return apiResponse.notFound(res, 'Ticket', ticketId);
      }

      const ticketType = String(ticket[0]?.type ?? 'new_installation');

      // Get or initialize steps
      const steps = await initializeVerificationSteps(ticketId, ticketType);

      return apiResponse.success(res, steps);
    } catch (error) {
      log.error('Failed to fetch verification steps', { error, ticketId });
      return apiResponse.internalError(res, error);
    }
  }

  // POST - Get verification progress
  if (req.method === 'POST') {
    try {
      // Verify ticket exists and fetch its type
      const ticket = await sql`
        SELECT id, type FROM maintenance_tickets WHERE id = ${ticketId}
      `;

      if (ticket.length === 0) {
        return apiResponse.notFound(res, 'Ticket', ticketId);
      }

      const ticketType = String(ticket[0]?.type ?? 'new_installation');

      // Get or initialize steps
      const steps = await initializeVerificationSteps(ticketId, ticketType);

      // Calculate progress
      const progress = calculateProgress(steps);

      return apiResponse.success(res, progress);
    } catch (error) {
      log.error('Failed to fetch verification progress', { error, ticketId });
      return apiResponse.internalError(res, error);
    }
  }

  return res.status(405).json({
    success: false,
    error: { message: 'Method not allowed' },
  });
}

export default withAuth(handler);
