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
  getStepsForCategoryAndDiscipline,
} from '@/modules/noc/constants/verificationSteps';
import type {
  VerificationStep,
  VerificationProgress,
} from '@/modules/noc/types/verification';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

/**
 * Initialize type-specific verification steps for a ticket if they don't exist.
 * Uses ticket_category as the primary signal and discipline (type) as the
 * tiebreaker so that e.g. Maintenance+Civils gets fault-repair steps instead
 * of the snag checklist that civils tickets default to.
 */
async function initializeVerificationSteps(
  ticketId: string,
  ticketCategory: string | null,
  ticketDiscipline: string
): Promise<VerificationStep[]> {
  // Check if steps already exist
  const existing = await sql`
    SELECT s.id, s.ticket_id, s.step_number, s.step_name, s.step_description,
           s.is_complete, s.completed_at, s.completed_by, s.photo_required,
           s.photo_url, s.photo_verified, s.notes, s.created_at,
           COALESCE(
             json_agg(
               json_build_object(
                 'id', a.id,
                 'file_url', a.file_url,
                 'storage_url', a.storage_url,
                 'storage_path', a.storage_path,
                 'filename', a.filename,
                 'file_type', a.file_type,
                 'mime_type', a.mime_type,
                 'file_size', a.file_size,
                 'uploaded_by', a.uploaded_by,
                 'uploaded_at', a.uploaded_at
               )
               ORDER BY a.uploaded_at ASC
             ) FILTER (WHERE a.id IS NOT NULL),
             '[]'::json
           ) AS photos
    FROM maintenance_verification_steps s
    LEFT JOIN maintenance_attachments a
      ON a.verification_step_id = s.id AND a.is_evidence = true
    WHERE s.ticket_id = ${ticketId}
    GROUP BY s.id
    ORDER BY s.step_number
  `;

  if (existing.length > 0) {
    return existing as VerificationStep[];
  }

  // Resolve the correct step list using category + discipline
  const templates = getStepsForCategoryAndDiscipline(ticketCategory, ticketDiscipline);

  // Insert each step sequentially
  for (const template of templates) {
    await sql`
      INSERT INTO maintenance_verification_steps (ticket_id, step_number, step_name, step_description, photo_required)
      VALUES (${ticketId}, ${template.step_number}, ${template.step_name}, ${template.step_description}, ${template.photo_required})
    `;
  }

  // Fetch and return created steps
  const created = await sql`
    SELECT s.id, s.ticket_id, s.step_number, s.step_name, s.step_description,
           s.is_complete, s.completed_at, s.completed_by, s.photo_required,
           s.photo_url, s.photo_verified, s.notes, s.created_at,
           COALESCE(
             json_agg(
               json_build_object(
                 'id', a.id,
                 'file_url', a.file_url,
                 'storage_url', a.storage_url,
                 'storage_path', a.storage_path,
                 'filename', a.filename,
                 'file_type', a.file_type,
                 'mime_type', a.mime_type,
                 'file_size', a.file_size,
                 'uploaded_by', a.uploaded_by,
                 'uploaded_at', a.uploaded_at
               )
               ORDER BY a.uploaded_at ASC
             ) FILTER (WHERE a.id IS NOT NULL),
             '[]'::json
           ) AS photos
    FROM maintenance_verification_steps s
    LEFT JOIN maintenance_attachments a
      ON a.verification_step_id = s.id AND a.is_evidence = true
    WHERE s.ticket_id = ${ticketId}
    GROUP BY s.id
    ORDER BY s.step_number
  `;

  log.info('Initialized verification steps for ticket', {
    ticketId,
    ticketCategory,
    ticketDiscipline,
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
      const ticket = await sql`
        SELECT id, type, ticket_category FROM maintenance_tickets WHERE id = ${ticketId}
      `;

      if (ticket.length === 0) {
        return apiResponse.notFound(res, 'Ticket', ticketId);
      }

      const ticketDiscipline = String(ticket[0]?.type ?? 'new_installation');
      const ticketCategory = (ticket[0]?.ticket_category as string | null) ?? null;

      const steps = await initializeVerificationSteps(ticketId, ticketCategory, ticketDiscipline);

      return apiResponse.success(res, steps);
    } catch (error) {
      log.error('Failed to fetch verification steps', { error, ticketId });
      return apiResponse.internalError(res, error);
    }
  }

  // POST - Get verification progress
  if (req.method === 'POST') {
    try {
      const ticket = await sql`
        SELECT id, type, ticket_category FROM maintenance_tickets WHERE id = ${ticketId}
      `;

      if (ticket.length === 0) {
        return apiResponse.notFound(res, 'Ticket', ticketId);
      }

      const ticketDiscipline = String(ticket[0]?.type ?? 'new_installation');
      const ticketCategory = (ticket[0]?.ticket_category as string | null) ?? null;

      const steps = await initializeVerificationSteps(ticketId, ticketCategory, ticketDiscipline);
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
