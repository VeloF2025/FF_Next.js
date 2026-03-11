/**
 * API: /api/noc/verification
 *
 * GET - Fetch verification steps for a ticket
 * POST - Get verification progress (complete status)
 *
 * Query params:
 * - ticketId: UUID of the ticket (required)
 *
 * 🟢 WORKING: Flat route to avoid Vercel nested dynamic route issues
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import {
  VERIFICATION_STEP_TEMPLATES,
  TOTAL_VERIFICATION_STEPS,
} from '@/modules/noc/constants/verificationSteps';
import type {
  VerificationStep,
  VerificationProgress,
  VerificationStepNumber,
} from '@/modules/noc/types/verification';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

/**
 * Initialize verification steps for a ticket if they don't exist
 */
async function initializeVerificationSteps(ticketId: string): Promise<VerificationStep[]> {
  // Check if steps already exist
  const existing = await sql`
    SELECT * FROM maintenance_verification_steps
    WHERE ticket_id = ${ticketId}
    ORDER BY step_number
  `;

  if (existing.length > 0) {
    return existing as VerificationStep[];
  }

  // Create all 12 steps
  const stepNumbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as VerificationStepNumber[];
  const insertValues = stepNumbers.map((num) => {
    const template = VERIFICATION_STEP_TEMPLATES[num];
    return {
      ticket_id: ticketId,
      step_number: num,
      step_name: template.step_name,
      step_description: template.step_description,
      photo_required: template.photo_required,
    };
  });

  // Insert all steps
  for (const step of insertValues) {
    await sql`
      INSERT INTO maintenance_verification_steps (ticket_id, step_number, step_name, step_description, photo_required)
      VALUES (${step.ticket_id}, ${step.step_number}, ${step.step_name}, ${step.step_description}, ${step.photo_required})
    `;
  }

  // Fetch and return created steps
  const created = await sql`
    SELECT * FROM maintenance_verification_steps
    WHERE ticket_id = ${ticketId}
    ORDER BY step_number
  `;

  log.info('Initialized verification steps for ticket', { ticketId, count: created.length });
  return created as VerificationStep[];
}

/**
 * Calculate verification progress
 */
function calculateProgress(steps: VerificationStep[]): VerificationProgress {
  const completedSteps = steps.filter((s) => s.is_complete).length;
  const pendingSteps = TOTAL_VERIFICATION_STEPS - completedSteps;
  const progressPercentage = Math.round((completedSteps / TOTAL_VERIFICATION_STEPS) * 100);

  return {
    ticket_id: steps[0]?.ticket_id || '',
    total_steps: TOTAL_VERIFICATION_STEPS,
    completed_steps: completedSteps,
    pending_steps: pendingSteps,
    progress_percentage: progressPercentage,
    all_steps_complete: completedSteps === TOTAL_VERIFICATION_STEPS,
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
      // Verify ticket exists
      const ticket = await sql`
        SELECT id FROM maintenance_tickets WHERE id = ${ticketId}
      `;

      if (ticket.length === 0) {
        return apiResponse.notFound(res, 'Ticket', ticketId);
      }

      // Get or initialize steps
      const steps = await initializeVerificationSteps(ticketId);

      return apiResponse.success(res, steps);
    } catch (error) {
      log.error('Failed to fetch verification steps', { error, ticketId });
      return apiResponse.internalError(res, error);
    }
  }

  // POST - Get verification progress
  if (req.method === 'POST') {
    try {
      // Verify ticket exists
      const ticket = await sql`
        SELECT id FROM maintenance_tickets WHERE id = ${ticketId}
      `;

      if (ticket.length === 0) {
        return apiResponse.notFound(res, 'Ticket', ticketId);
      }

      // Get or initialize steps
      const steps = await initializeVerificationSteps(ticketId);

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
