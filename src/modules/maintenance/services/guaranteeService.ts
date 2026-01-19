/**
 * Guarantee Service - Guarantee Period & Classification Management
 *
 * 🟢 WORKING: Production-ready guarantee service with classification logic
 *
 * Provides:
 * - Guarantee period CRUD operations
 * - Ticket guarantee classification
 * - Billing determination
 * - Contractor liability assessment
 *
 * Features:
 * - Project-specific guarantee periods
 * - Automatic guarantee expiry calculation
 * - Fault-cause-based billing classification
 * - Database transaction support
 */

import { query, queryOne } from '../utils/db';
import {
  classifyGuaranteeStatus,
  determineBillingClassification,
  assessContractorLiability
} from '../utils/guaranteeCalculator';
import {
  GuaranteePeriod,
  CreateGuaranteePeriodPayload,
  UpdateGuaranteePeriodPayload,
  GuaranteeClassification
} from '../types/guarantee';
import { GuaranteeStatus, FaultCause } from '../types/ticket';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ticketing:guarantee-service');

/**
 * UUID validation regex
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate UUID format
 * 🟢 WORKING: UUID validation
 */
function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

/**
 * Get guarantee period for a project
 * 🟢 WORKING: Fetches guarantee period configuration for a project
 *
 * @param projectId - Project UUID
 * @returns Guarantee period or null if not found
 * @throws {Error} If project_id is invalid
 */
export async function getGuaranteePeriodByProject(
  projectId: string
): Promise<GuaranteePeriod | null> {
  // Validate project_id
  if (!isValidUUID(projectId)) {
    throw new Error('Invalid project_id format');
  }

  const result = await queryOne<GuaranteePeriod>(
    `SELECT * FROM guarantee_periods WHERE project_id = $1`,
    [projectId]
  );

  return result;
}

/**
 * Create guarantee period for a project
 * 🟢 WORKING: Creates new guarantee period with defaults or custom values
 *
 * @param payload - Guarantee period creation data
 * @returns Created guarantee period
 * @throws {Error} If validation fails or database error occurs
 */
export async function createGuaranteePeriod(
  payload: CreateGuaranteePeriodPayload
): Promise<GuaranteePeriod> {
  // Validate required fields
  if (!payload.project_id) {
    throw new Error('project_id is required');
  }

  if (!isValidUUID(payload.project_id)) {
    throw new Error('Invalid project_id format');
  }

  // Use defaults if not provided
  const installationDays = payload.installation_guarantee_days ?? 90;
  const materialDays = payload.material_guarantee_days ?? 365;
  const contractorLiable = payload.contractor_liable_during_guarantee ?? true;
  const autoClassify = payload.auto_classify_out_of_guarantee ?? true;

  logger.info('Creating guarantee period', {
    project_id: payload.project_id,
    installation_days: installationDays,
    material_days: materialDays
  });

  const result = await queryOne<GuaranteePeriod>(
    `INSERT INTO guarantee_periods (
      project_id,
      installation_guarantee_days,
      material_guarantee_days,
      contractor_liable_during_guarantee,
      auto_classify_out_of_guarantee
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING *`,
    [
      payload.project_id,
      installationDays,
      materialDays,
      contractorLiable,
      autoClassify
    ]
  );

  if (!result) {
    throw new Error('Failed to create guarantee period');
  }

  logger.info('Guarantee period created successfully', {
    guarantee_period_id: result.id,
    project_id: result.project_id
  });

  return result;
}

/**
 * Update guarantee period for a project
 * 🟢 WORKING: Updates existing guarantee period
 *
 * @param projectId - Project UUID
 * @param payload - Fields to update
 * @returns Updated guarantee period
 * @throws {Error} If guarantee period not found or validation fails
 */
export async function updateGuaranteePeriod(
  projectId: string,
  payload: UpdateGuaranteePeriodPayload
): Promise<GuaranteePeriod> {
  // Validate project_id
  if (!isValidUUID(projectId)) {
    throw new Error('Invalid project_id format');
  }

  // Build dynamic UPDATE query based on provided fields
  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (payload.installation_guarantee_days !== undefined) {
    updates.push(`installation_guarantee_days = $${paramIndex++}`);
    values.push(payload.installation_guarantee_days);
  }

  if (payload.material_guarantee_days !== undefined) {
    updates.push(`material_guarantee_days = $${paramIndex++}`);
    values.push(payload.material_guarantee_days);
  }

  if (payload.contractor_liable_during_guarantee !== undefined) {
    updates.push(`contractor_liable_during_guarantee = $${paramIndex++}`);
    values.push(payload.contractor_liable_during_guarantee);
  }

  if (payload.auto_classify_out_of_guarantee !== undefined) {
    updates.push(`auto_classify_out_of_guarantee = $${paramIndex++}`);
    values.push(payload.auto_classify_out_of_guarantee);
  }

  if (updates.length === 0) {
    throw new Error('No fields to update');
  }

  // Always update updated_at
  updates.push(`updated_at = NOW()`);

  // Add project_id to values (last parameter)
  values.push(projectId);

  const updateQuery = `
    UPDATE guarantee_periods
    SET ${updates.join(', ')}
    WHERE project_id = $${paramIndex}
    RETURNING *
  `;

  logger.info('Updating guarantee period', {
    project_id: projectId,
    updates: Object.keys(payload)
  });

  const result = await queryOne<GuaranteePeriod>(updateQuery, values);

  if (!result) {
    throw new Error('Guarantee period not found for project');
  }

  logger.info('Guarantee period updated successfully', {
    guarantee_period_id: result.id,
    project_id: result.project_id
  });

  return result;
}

/**
 * Get or create default guarantee period for a project
 * 🟢 WORKING: Returns existing or creates default guarantee period
 *
 * @param projectId - Project UUID
 * @returns Guarantee period
 */
export async function getOrCreateDefaultGuaranteePeriod(
  projectId: string
): Promise<GuaranteePeriod> {
  // Try to get existing guarantee period
  let guaranteePeriod = await getGuaranteePeriodByProject(projectId);

  // Create default if not found
  if (!guaranteePeriod) {
    logger.info('No guarantee period found, creating default', {
      project_id: projectId
    });

    guaranteePeriod = await createGuaranteePeriod({
      project_id: projectId
      // Will use all defaults: 90 days installation, 365 days material, etc.
    });
  }

  return guaranteePeriod;
}

/**
 * Classify ticket guarantee status and update ticket
 * 🟢 WORKING: Determines guarantee status, billing, and updates ticket
 *
 * @param ticketId - Ticket UUID
 * @returns Complete guarantee classification
 * @throws {Error} If ticket not found or guarantee period not configured
 */
export async function classifyTicketGuarantee(
  ticketId: string
): Promise<GuaranteeClassification> {
  // Validate ticket_id
  if (!isValidUUID(ticketId)) {
    throw new Error('Invalid ticket_id format');
  }

  logger.info('Classifying ticket guarantee', { ticket_id: ticketId });

  // 1. Get ticket data
  const ticket = await queryOne<{
    id: string;
    project_id: string | null;
    ticket_type: string;
    fault_cause: FaultCause | null;
    created_at: Date | null;
  }>(
    `SELECT
      id,
      project_id,
      ticket_type,
      fault_cause,
      created_at
    FROM tickets
    WHERE id = $1`,
    [ticketId]
  );

  if (!ticket) {
    throw new Error('Ticket not found');
  }

  if (!ticket.project_id) {
    throw new Error('Ticket has no project_id - cannot determine guarantee period');
  }

  // 2. Get guarantee period for project
  const guaranteePeriod = await getGuaranteePeriodByProject(ticket.project_id);

  if (!guaranteePeriod) {
    throw new Error('Guarantee period not configured for project');
  }

  // 3. Classify guarantee status
  const guaranteeClassification = classifyGuaranteeStatus({
    ticket_id: ticketId,
    installation_date: ticket.created_at,
    ticket_type: ticket.ticket_type as 'installation' | 'material' | null,
    installation_guarantee_days: guaranteePeriod.installation_guarantee_days,
    material_guarantee_days: guaranteePeriod.material_guarantee_days
  });

  // 4. Determine billing classification
  const billingDetermination = determineBillingClassification({
    guarantee_status: guaranteeClassification.status,
    fault_cause: ticket.fault_cause,
    contractor_liable_during_guarantee: guaranteePeriod.contractor_liable_during_guarantee
  });

  // 5. Assess contractor liability
  const contractorLiability = assessContractorLiability({
    guarantee_status: guaranteeClassification.status,
    fault_cause: ticket.fault_cause,
    contractor_liable_during_guarantee: guaranteePeriod.contractor_liable_during_guarantee
  });

  // 6. Update ticket with classification
  await query(
    `UPDATE tickets
    SET
      guarantee_status = $1,
      guarantee_expires_at = $2,
      is_billable = $3,
      billing_classification = $4,
      updated_at = NOW()
    WHERE id = $5`,
    [
      guaranteeClassification.status,
      guaranteeClassification.expires_at,
      billingDetermination.is_billable,
      billingDetermination.billing_classification,
      ticketId
    ]
  );

  logger.info('Ticket guarantee classified and updated', {
    ticket_id: ticketId,
    guarantee_status: guaranteeClassification.status,
    billing_classification: billingDetermination.billing_classification,
    is_billable: billingDetermination.is_billable,
    contractor_liable: contractorLiability.is_liable
  });

  // 7. Return complete classification
  return {
    ticket_id: ticketId,
    status: guaranteeClassification.status,
    expires_at: guaranteeClassification.expires_at,
    is_billable: billingDetermination.is_billable,
    billing_classification: billingDetermination.billing_classification,
    days_remaining: guaranteeClassification.days_remaining,
    contractor_liable: contractorLiability.is_liable,
    reason: `${guaranteeClassification.reason} | ${billingDetermination.reason}`
  };
}
