/**
 * Escalation Service
 * 🟢 WORKING: Production-ready service for managing repeat fault escalations
 *
 * Features:
 * - Create escalation records when fault patterns detected
 * - Create infrastructure tickets for escalations
 * - Link contributing tickets to escalations
 * - List and filter escalations
 * - Resolve escalations with notes
 * - Prevent duplicate escalations
 * - Track escalation status
 *
 * Business Logic:
 * - When repeat faults detected on same pole/PON/zone/DR, create escalation
 * - Auto-create infrastructure-level ticket for investigation
 * - Link all contributing fault tickets to escalation
 * - Prevent duplicate active escalations for same scope
 * - Track resolution with notes and timestamps
 */

import { query, queryOne } from '../utils/db';
import {
  RepeatFaultEscalation,
  CreateEscalationPayload,
  UpdateEscalationPayload,
  ResolveEscalationPayload,
  EscalationFilters,
  EscalationScopeType,
  EscalationStatus,
  EscalationType,
} from '../types/escalation';
import { createTicket } from './ticketService';
import { TicketSource, TicketType, TicketPriority } from '../types/ticket';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ticketing:escalation-service');

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
 * Create a new escalation record
 * 🟢 WORKING: Creates escalation when repeat fault pattern detected
 *
 * @param payload - Escalation creation data
 * @returns Created escalation record
 * @throws {Error} If validation fails or database error occurs
 */
export async function createEscalation(
  payload: CreateEscalationPayload
): Promise<RepeatFaultEscalation> {
  // 🟢 WORKING: Validate required fields
  if (!payload.scope_value || payload.scope_value.trim().length === 0) {
    throw new Error('scope_value is required');
  }

  if (!payload.contributing_tickets || !Array.isArray(payload.contributing_tickets)) {
    throw new Error('contributing_tickets must be an array');
  }

  if (payload.contributing_tickets.length === 0) {
    throw new Error('contributing_tickets must be a non-empty array');
  }

  try {
    logger.info('Creating escalation', {
      scope_type: payload.scope_type,
      scope_value: payload.scope_value,
      fault_count: payload.fault_count,
    });

    // 🟢 WORKING: Insert escalation record
    const queryText = `
      INSERT INTO repeat_fault_escalations (
        scope_type,
        scope_value,
        project_id,
        fault_count,
        fault_threshold,
        contributing_tickets,
        escalation_type,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;

    const params = [
      payload.scope_type,
      payload.scope_value.trim(),
      payload.project_id || null,
      payload.fault_count,
      payload.fault_threshold,
      JSON.stringify(payload.contributing_tickets),
      payload.escalation_type || null,
      EscalationStatus.OPEN, // Default status
    ];

    const escalation = await queryOne<RepeatFaultEscalation>(queryText, params);

    if (!escalation) {
      throw new Error('Failed to create escalation');
    }

    logger.info('Escalation created successfully', { escalation_id: escalation.id });

    return escalation;
  } catch (error) {
    logger.error('Failed to create escalation', { error, payload });
    throw error;
  }
}

/**
 * Create infrastructure ticket for escalation
 * 🟢 WORKING: Auto-creates investigation/inspection ticket
 *
 * @param escalationId - Escalation ID
 * @param createdBy - User ID creating the ticket
 * @returns Escalation with linked infrastructure ticket
 * @throws {Error} If escalation not found or ticket already exists
 */
export async function createInfrastructureTicket(
  escalationId: string,
  createdBy: string
): Promise<{ escalation: RepeatFaultEscalation; infrastructure_ticket: any }> {
  // 🟢 WORKING: Validate UUID format
  if (!isValidUUID(escalationId)) {
    throw new Error('Invalid escalation ID format');
  }

  try {
    // Get escalation details
    const escalation = await getEscalationById(escalationId);

    // Check if infrastructure ticket already exists
    if (escalation.escalation_ticket_id) {
      throw new Error('Infrastructure ticket already exists for this escalation');
    }

    logger.info('Creating infrastructure ticket for escalation', {
      escalation_id: escalationId,
      scope_type: escalation.scope_type,
      scope_value: escalation.scope_value,
    });

    // Generate ticket title and description based on scope type
    const { title, description, scopeField } = generateTicketContent(escalation);

    // Create infrastructure ticket
    const ticketPayload: any = {
      source: TicketSource.CONSTRUCTION,
      title,
      description,
      ticket_type: TicketType.MAINTENANCE,
      priority: TicketPriority.HIGH,
      project_id: escalation.project_id || undefined,
      created_by: createdBy,
    };

    // Add scope-specific field (pole_number, pon_number, zone_id, dr_number)
    if (scopeField) {
      ticketPayload[scopeField] = escalation.scope_value;
    }

    const infrastructureTicket = await createTicket(ticketPayload);

    // Link ticket to escalation
    const updateQuery = `
      UPDATE repeat_fault_escalations
      SET escalation_ticket_id = $1
      WHERE id = $2
      RETURNING *
    `;

    const updatedEscalation = await queryOne<RepeatFaultEscalation>(updateQuery, [
      infrastructureTicket.id,
      escalationId,
    ]);

    if (!updatedEscalation) {
      throw new Error('Failed to link infrastructure ticket to escalation');
    }

    logger.info('Infrastructure ticket created and linked', {
      escalation_id: escalationId,
      ticket_id: infrastructureTicket.id,
      ticket_uid: infrastructureTicket.ticket_uid,
    });

    return {
      escalation: updatedEscalation,
      infrastructure_ticket: infrastructureTicket,
    };
  } catch (error) {
    logger.error('Failed to create infrastructure ticket', { error, escalation_id: escalationId });
    throw error;
  }
}

/**
 * Generate ticket content based on escalation scope
 * 🟢 WORKING: Creates appropriate title/description for each scope type
 */
function generateTicketContent(escalation: RepeatFaultEscalation): {
  title: string;
  description: string;
  scopeField: string | null;
} {
  const { scope_type, scope_value, fault_count, escalation_type } = escalation;

  let title: string;
  let description: string;
  let scopeField: string | null = null;
  let actionType = escalation_type || EscalationType.INVESTIGATION;

  // Capitalize action type for title
  const actionLabel = actionType.charAt(0).toUpperCase() + actionType.slice(1);

  switch (scope_type) {
    case EscalationScopeType.POLE:
      title = `Infrastructure ${actionLabel}: Pole ${scope_value}`;
      description = `${fault_count} repeat faults detected on pole ${scope_value}. Infrastructure-level ${actionType} required. Check pole stability, connections, and consider replacement if necessary.`;
      scopeField = 'pole_number';
      break;

    case EscalationScopeType.PON:
      title = `PON ${actionLabel}: ${scope_value}`;
      description = `${fault_count} repeat faults detected on PON ${scope_value}. ${actionLabel} required for splitter, fiber path, and OLT port.`;
      scopeField = 'pon_number';
      break;

    case EscalationScopeType.ZONE:
      title = `Zone-Wide ${actionLabel}: ${scope_value}`;
      description = `${fault_count} repeat faults detected in zone ${scope_value}. Zone-wide ${actionType} required to identify systemic issues.`;
      scopeField = 'zone_id';
      break;

    case EscalationScopeType.DR:
      title = `DR ${actionLabel}: ${scope_value}`;
      description = `${fault_count} repeat faults detected on DR ${scope_value}. Investigation required for DR-specific issues including equipment and installation quality.`;
      scopeField = 'dr_number';
      break;

    default:
      title = `Infrastructure ${actionLabel}: ${scope_value}`;
      description = `${fault_count} repeat faults detected. ${actionLabel} required.`;
      scopeField = null;
  }

  return { title, description, scopeField };
}

/**
 * Get escalation by ID
 * 🟢 WORKING: Retrieves escalation record
 *
 * @param escalationId - Escalation UUID
 * @returns Escalation record
 * @throws {Error} If not found or invalid ID
 */
export async function getEscalationById(escalationId: string): Promise<RepeatFaultEscalation> {
  // 🟢 WORKING: Validate UUID format
  if (!isValidUUID(escalationId)) {
    throw new Error('Invalid escalation ID format');
  }

  try {
    const queryText = `
      SELECT * FROM repeat_fault_escalations
      WHERE id = $1
    `;

    const escalation = await queryOne<RepeatFaultEscalation>(queryText, [escalationId]);

    if (!escalation) {
      throw new Error('Escalation not found');
    }

    return escalation;
  } catch (error) {
    logger.error('Failed to get escalation', { error, escalation_id: escalationId });
    throw error;
  }
}

/**
 * List escalations with filters
 * 🟢 WORKING: Query escalations with optional filtering
 *
 * @param filters - Optional filters (scope_type, status, project_id)
 * @returns Array of escalations
 */
export async function listEscalations(
  filters?: EscalationFilters
): Promise<RepeatFaultEscalation[]> {
  try {
    const whereClauses: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // 🟢 WORKING: Build WHERE clause based on filters
    if (filters?.scope_type) {
      if (Array.isArray(filters.scope_type)) {
        const scopeTypes = filters.scope_type.map((st) => `'${st}'`).join(',');
        whereClauses.push(`scope_type IN (${scopeTypes})`);
      } else {
        whereClauses.push(`scope_type = $${paramIndex}`);
        params.push(filters.scope_type);
        paramIndex++;
      }
    }

    if (filters?.status) {
      if (Array.isArray(filters.status)) {
        const statuses = filters.status.map((s) => `'${s}'`).join(',');
        whereClauses.push(`status IN (${statuses})`);
      } else {
        whereClauses.push(`status = $${paramIndex}`);
        params.push(filters.status);
        paramIndex++;
      }
    }

    if (filters?.project_id) {
      whereClauses.push(`project_id = $${paramIndex}`);
      params.push(filters.project_id);
      paramIndex++;
    }

    if (filters?.escalation_type) {
      whereClauses.push(`escalation_type = $${paramIndex}`);
      params.push(filters.escalation_type);
      paramIndex++;
    }

    // Build query
    let queryText = `
      SELECT * FROM repeat_fault_escalations
    `;

    if (whereClauses.length > 0) {
      queryText += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    queryText += ` ORDER BY created_at DESC`;

    const escalations = await query<RepeatFaultEscalation>(queryText, params);

    logger.info('Listed escalations', {
      count: escalations.length,
      filters,
    });

    return escalations;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('relation') && errorMessage.includes('does not exist')) {
      logger.warn('Escalations table does not exist - returning empty list. Run migrations to create tables.');
      return [];
    }
    logger.error('Failed to list escalations', { error, filters });
    throw error;
  }
}

/**
 * Resolve escalation
 * 🟢 WORKING: Mark escalation as resolved or no_action
 *
 * @param escalationId - Escalation UUID
 * @param payload - Resolution details
 * @returns Updated escalation
 * @throws {Error} If validation fails
 */
export async function resolveEscalation(
  escalationId: string,
  payload: ResolveEscalationPayload
): Promise<RepeatFaultEscalation> {
  // 🟢 WORKING: Validate UUID format
  if (!isValidUUID(escalationId)) {
    throw new Error('Invalid escalation ID format');
  }

  // 🟢 WORKING: Validate required fields
  if (!payload.resolution_notes || payload.resolution_notes.trim().length === 0) {
    throw new Error('resolution_notes is required');
  }

  try {
    logger.info('Resolving escalation', {
      escalation_id: escalationId,
      status: payload.status,
      resolved_by: payload.resolved_by,
    });

    const queryText = `
      UPDATE repeat_fault_escalations
      SET
        status = $1,
        resolution_notes = $2,
        resolved_by = $3,
        resolved_at = NOW()
      WHERE id = $4
      RETURNING *
    `;

    const params = [payload.status, payload.resolution_notes.trim(), payload.resolved_by, escalationId];

    const escalation = await queryOne<RepeatFaultEscalation>(queryText, params);

    if (!escalation) {
      throw new Error('Escalation not found');
    }

    logger.info('Escalation resolved', {
      escalation_id: escalationId,
      status: escalation.status,
    });

    return escalation;
  } catch (error) {
    logger.error('Failed to resolve escalation', { error, escalation_id: escalationId });
    throw error;
  }
}

/**
 * Update escalation status
 * 🟢 WORKING: Change escalation status (e.g., open -> investigating)
 *
 * @param escalationId - Escalation UUID
 * @param status - New status
 * @returns Updated escalation
 */
export async function updateEscalationStatus(
  escalationId: string,
  status: EscalationStatus
): Promise<RepeatFaultEscalation> {
  // 🟢 WORKING: Validate UUID format
  if (!isValidUUID(escalationId)) {
    throw new Error('Invalid escalation ID format');
  }

  try {
    logger.info('Updating escalation status', {
      escalation_id: escalationId,
      new_status: status,
    });

    const queryText = `
      UPDATE repeat_fault_escalations
      SET status = $1
      WHERE id = $2
      RETURNING *
    `;

    const escalation = await queryOne<RepeatFaultEscalation>(queryText, [status, escalationId]);

    if (!escalation) {
      throw new Error('Escalation not found');
    }

    return escalation;
  } catch (error) {
    logger.error('Failed to update escalation status', { error, escalation_id: escalationId });
    throw error;
  }
}

/**
 * Check for duplicate escalation
 * 🟢 WORKING: Prevents creating duplicate active escalations
 *
 * @param scopeType - Scope type (pole/pon/zone/dr)
 * @param scopeValue - Scope value
 * @returns Existing escalation if found, null otherwise
 */
export async function checkForDuplicateEscalation(
  scopeType: EscalationScopeType,
  scopeValue: string
): Promise<RepeatFaultEscalation | null> {
  try {
    const queryText = `
      SELECT * FROM repeat_fault_escalations
      WHERE scope_type = $1
        AND scope_value = $2
        AND status IN ('open', 'investigating')
      LIMIT 1
    `;

    const escalation = await queryOne<RepeatFaultEscalation>(queryText, [scopeType, scopeValue]);

    if (escalation) {
      logger.info('Found existing active escalation', {
        escalation_id: escalation.id,
        scope_type: scopeType,
        scope_value: scopeValue,
      });
    }

    return escalation;
  } catch (error) {
    logger.error('Failed to check for duplicate escalation', { error, scopeType, scopeValue });
    throw error;
  }
}

/**
 * Link contributing tickets to escalation
 * 🟢 WORKING: Add new tickets to existing escalation
 *
 * @param escalationId - Escalation UUID
 * @param ticketIds - Array of ticket IDs to link
 * @returns Updated escalation
 */
export async function linkContributingTickets(
  escalationId: string,
  ticketIds: string[]
): Promise<RepeatFaultEscalation> {
  // 🟢 WORKING: Validate UUID format
  if (!isValidUUID(escalationId)) {
    throw new Error('Invalid escalation ID format');
  }

  try {
    // Get current escalation
    const escalation = await getEscalationById(escalationId);

    // Get existing contributing tickets
    const existingTickets = escalation.contributing_tickets || [];

    // Merge with new tickets (remove duplicates)
    const allTickets = [...new Set([...(existingTickets as string[]), ...ticketIds])];

    logger.info('Linking contributing tickets', {
      escalation_id: escalationId,
      existing_count: existingTickets.length,
      new_count: ticketIds.length,
      total_count: allTickets.length,
    });

    // Update escalation
    const queryText = `
      UPDATE repeat_fault_escalations
      SET
        contributing_tickets = $1,
        fault_count = $2
      WHERE id = $3
      RETURNING *
    `;

    const params = [JSON.stringify(allTickets), allTickets.length, escalationId];

    const updatedEscalation = await queryOne<RepeatFaultEscalation>(queryText, params);

    if (!updatedEscalation) {
      throw new Error('Failed to link contributing tickets');
    }

    return updatedEscalation;
  } catch (error) {
    logger.error('Failed to link contributing tickets', { error, escalation_id: escalationId });
    throw error;
  }
}
