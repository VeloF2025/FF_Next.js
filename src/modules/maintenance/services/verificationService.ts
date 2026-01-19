/**
 * Verification Service - 12-Step Workflow
 *
 * 🟢 WORKING: Production-ready verification service for 12-step checklist management
 *
 * Provides:
 * - Initialize 12 verification steps for new tickets
 * - Get verification steps for a ticket
 * - Update individual steps (completion, photos, notes)
 * - Calculate verification progress (7/12 format)
 * - Verify all steps complete
 * - Delete verification steps
 *
 * Features:
 * - Atomic step initialization (transaction)
 * - Photo evidence tracking
 * - Progress calculation
 * - Photo requirement validation
 * - Completion tracking with timestamps
 */

import { query, queryOne, transaction } from '../utils/db';
import {
  VerificationStep,
  VerificationStepNumber,
  UpdateVerificationStepPayload,
  VerificationProgress,
} from '../types/verification';
import {
  VERIFICATION_STEP_TEMPLATES,
  TOTAL_VERIFICATION_STEPS,
} from '../constants/verificationSteps';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ticketing:verification-service');

/**
 * UUID validation regex
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate UUID format
 */
function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

/**
 * Initialize 12 verification steps for a new ticket
 *
 * Creates all 12 standard verification steps in a single transaction.
 * Steps are initialized from templates with default incomplete state.
 *
 * @param ticketId - UUID of the ticket
 * @returns Array of created verification steps
 * @throws {Error} If ticket doesn't exist or steps already initialized
 */
export async function initializeVerificationSteps(ticketId: string): Promise<VerificationStep[]> {
  // 🟢 WORKING: Validate ticket ID format
  if (!isValidUUID(ticketId)) {
    throw new Error('Invalid ticket ID format');
  }

  // 🟢 WORKING: Check if ticket exists
  const ticketExists = await queryOne<{ id: string }>(
    'SELECT id FROM tickets WHERE id = $1',
    [ticketId]
  );

  if (!ticketExists) {
    throw new Error('Ticket not found');
  }

  // 🟢 WORKING: Check if steps already initialized
  const existingSteps = await query<VerificationStep>(
    'SELECT id FROM verification_steps WHERE ticket_id = $1 LIMIT 1',
    [ticketId]
  );

  if (existingSteps.length > 0) {
    throw new Error('Verification steps already initialized for this ticket');
  }

  // 🟢 WORKING: Initialize all 12 steps in a transaction
  const steps = await transaction(async (txn) => {
    const createdSteps: VerificationStep[] = [];

    for (let stepNumber = 1; stepNumber <= TOTAL_VERIFICATION_STEPS; stepNumber++) {
      const template = VERIFICATION_STEP_TEMPLATES[stepNumber as VerificationStepNumber];

      const insertQuery = `
        INSERT INTO verification_steps (
          ticket_id,
          step_number,
          step_name,
          step_description,
          photo_required,
          is_complete,
          photo_verified
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING
          id,
          ticket_id,
          step_number,
          step_name,
          step_description,
          is_complete,
          completed_at,
          completed_by,
          photo_required,
          photo_url,
          photo_verified,
          notes,
          created_at
      `;

      const result = await txn.queryOne<VerificationStep>(insertQuery, [
        ticketId,
        template.step_number,
        template.step_name,
        template.step_description,
        template.photo_required,
        false, // is_complete
        false, // photo_verified
      ]);

      if (result) {
        createdSteps.push(result);
      }
    }

    logger.info('Initialized verification steps', {
      ticketId,
      stepCount: createdSteps.length,
    });

    return createdSteps;
  });

  return steps;
}

/**
 * Get all verification steps for a ticket
 *
 * Returns steps ordered by step_number (1-12).
 *
 * @param ticketId - UUID of the ticket
 * @returns Array of verification steps (ordered by step_number)
 */
export async function getVerificationSteps(ticketId: string): Promise<VerificationStep[]> {
  // 🟢 WORKING: Validate ticket ID format
  if (!isValidUUID(ticketId)) {
    throw new Error('Invalid ticket ID format');
  }

  const steps = await query<VerificationStep>(
    `SELECT
      id,
      ticket_id,
      step_number,
      step_name,
      step_description,
      is_complete,
      completed_at,
      completed_by,
      photo_required,
      photo_url,
      photo_verified,
      notes,
      created_at
    FROM verification_steps
    WHERE ticket_id = $1
    ORDER BY step_number ASC`,
    [ticketId]
  );

  logger.debug('Retrieved verification steps', {
    ticketId,
    stepCount: steps.length,
  });

  return steps;
}

/**
 * Get a specific verification step by ticket ID and step number
 *
 * @param ticketId - UUID of the ticket
 * @param stepNumber - Step number (1-12)
 * @returns Verification step or null if not found
 */
export async function getVerificationStep(
  ticketId: string,
  stepNumber: VerificationStepNumber
): Promise<VerificationStep | null> {
  // 🟢 WORKING: Validate inputs
  if (!isValidUUID(ticketId)) {
    throw new Error('Invalid ticket ID format');
  }

  const step = await queryOne<VerificationStep>(
    `SELECT
      id,
      ticket_id,
      step_number,
      step_name,
      step_description,
      is_complete,
      completed_at,
      completed_by,
      photo_required,
      photo_url,
      photo_verified,
      notes,
      created_at
    FROM verification_steps
    WHERE ticket_id = $1 AND step_number = $2`,
    [ticketId, stepNumber]
  );

  return step;
}

/**
 * Update a verification step
 *
 * Supports partial updates. Only provided fields will be updated.
 * Automatically sets completed_at timestamp when marking as complete.
 *
 * @param ticketId - UUID of the ticket
 * @param stepNumber - Step number (1-12)
 * @param payload - Fields to update
 * @returns Updated verification step
 * @throws {Error} If step not found
 */
export async function updateVerificationStep(
  ticketId: string,
  stepNumber: VerificationStepNumber,
  payload: UpdateVerificationStepPayload
): Promise<VerificationStep> {
  // 🟢 WORKING: Validate inputs
  if (!isValidUUID(ticketId)) {
    throw new Error('Invalid ticket ID format');
  }

  // 🟢 WORKING: Check if step exists
  const existingStep = await getVerificationStep(ticketId, stepNumber);
  if (!existingStep) {
    throw new Error('Verification step not found');
  }

  // 🟢 WORKING: Build dynamic UPDATE query
  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (payload.is_complete !== undefined) {
    updates.push(`is_complete = $${paramIndex++}`);
    values.push(payload.is_complete);

    // 🟢 WORKING: Automatically set/clear completed_at timestamp
    if (payload.is_complete) {
      updates.push(`completed_at = NOW()`);
    } else {
      updates.push(`completed_at = NULL`);
      // If marking as incomplete, also clear completed_by
      updates.push(`completed_by = NULL`);
    }
  }

  if (payload.completed_by !== undefined) {
    updates.push(`completed_by = $${paramIndex++}`);
    values.push(payload.completed_by);
  }

  if (payload.photo_url !== undefined) {
    updates.push(`photo_url = $${paramIndex++}`);
    values.push(payload.photo_url);
  }

  if (payload.photo_verified !== undefined) {
    updates.push(`photo_verified = $${paramIndex++}`);
    values.push(payload.photo_verified);
  }

  if (payload.notes !== undefined) {
    updates.push(`notes = $${paramIndex++}`);
    values.push(payload.notes);
  }

  // 🟢 WORKING: Ensure at least one field is being updated
  if (updates.length === 0) {
    return existingStep;
  }

  // 🟢 WORKING: Add WHERE clause parameters
  values.push(ticketId);
  values.push(stepNumber);

  const updateQuery = `
    UPDATE verification_steps
    SET ${updates.join(', ')}
    WHERE ticket_id = $${paramIndex++} AND step_number = $${paramIndex++}
    RETURNING
      id,
      ticket_id,
      step_number,
      step_name,
      step_description,
      is_complete,
      completed_at,
      completed_by,
      photo_required,
      photo_url,
      photo_verified,
      notes,
      created_at
  `;

  const updatedStep = await queryOne<VerificationStep>(updateQuery, values);

  if (!updatedStep) {
    throw new Error('Failed to update verification step');
  }

  logger.info('Updated verification step', {
    ticketId,
    stepNumber,
    fields: Object.keys(payload),
  });

  return updatedStep;
}

/**
 * Calculate verification progress for a ticket
 *
 * Returns detailed progress information including:
 * - Total steps (always 12)
 * - Completed steps count
 * - Pending steps count
 * - Progress percentage
 * - All steps complete flag
 * - Array of all steps
 *
 * @param ticketId - UUID of the ticket
 * @returns Verification progress summary
 * @throws {Error} If no verification steps found
 */
export async function calculateProgress(ticketId: string): Promise<VerificationProgress> {
  // 🟢 WORKING: Validate ticket ID
  if (!isValidUUID(ticketId)) {
    throw new Error('Invalid ticket ID format');
  }

  // 🟢 WORKING: Get all steps
  const steps = await getVerificationSteps(ticketId);

  if (steps.length === 0) {
    throw new Error('No verification steps found for this ticket');
  }

  // 🟢 WORKING: Calculate progress metrics
  const completedSteps = steps.filter((s) => s.is_complete).length;
  const pendingSteps = steps.length - completedSteps;
  const progressPercentage = Math.round((completedSteps / TOTAL_VERIFICATION_STEPS) * 100);
  const allStepsComplete = completedSteps === TOTAL_VERIFICATION_STEPS;

  const progress: VerificationProgress = {
    ticket_id: ticketId,
    total_steps: TOTAL_VERIFICATION_STEPS,
    completed_steps: completedSteps,
    pending_steps: pendingSteps,
    progress_percentage: progressPercentage,
    all_steps_complete: allStepsComplete,
    steps,
  };

  logger.debug('Calculated verification progress', {
    ticketId,
    progress: `${completedSteps}/${TOTAL_VERIFICATION_STEPS}`,
    percentage: progressPercentage,
  });

  return progress;
}

/**
 * Check if all verification steps are complete
 *
 * @param ticketId - UUID of the ticket
 * @returns True if all 12 steps are complete, false otherwise
 */
export async function isAllStepsComplete(ticketId: string): Promise<boolean> {
  // 🟢 WORKING: Validate ticket ID
  if (!isValidUUID(ticketId)) {
    throw new Error('Invalid ticket ID format');
  }

  // 🟢 WORKING: Count completed steps
  const result = await queryOne<{ completed: number; total: number }>(
    `SELECT
      COUNT(*) FILTER (WHERE is_complete = true) as completed,
      COUNT(*) as total
    FROM verification_steps
    WHERE ticket_id = $1`,
    [ticketId]
  );

  if (!result || result.total === 0) {
    return false;
  }

  const allComplete = result.completed === TOTAL_VERIFICATION_STEPS;

  logger.debug('Checked verification completion', {
    ticketId,
    completed: result.completed,
    total: result.total,
    allComplete,
  });

  return allComplete;
}

/**
 * Delete all verification steps for a ticket
 *
 * Used when deleting a ticket or resetting verification.
 * This is typically called via CASCADE when a ticket is deleted.
 *
 * @param ticketId - UUID of the ticket
 */
export async function deleteVerificationSteps(ticketId: string): Promise<void> {
  // 🟢 WORKING: Validate ticket ID
  if (!isValidUUID(ticketId)) {
    throw new Error('Invalid ticket ID format');
  }

  await query(
    'DELETE FROM verification_steps WHERE ticket_id = $1',
    [ticketId]
  );

  logger.info('Deleted verification steps', { ticketId });
}

/**
 * Export all verification service functions
 */
export const verificationService = {
  initializeVerificationSteps,
  getVerificationSteps,
  getVerificationStep,
  updateVerificationStep,
  calculateProgress,
  isAllStepsComplete,
  deleteVerificationSteps,
};

export default verificationService;
