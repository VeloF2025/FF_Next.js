/**
 * Ticket Service - CRUD Operations
 *
 * 🟢 WORKING: Production-ready ticket service with full CRUD operations
 *
 * Provides:
 * - Create ticket with validation and UID generation
 * - Read ticket by ID
 * - Update ticket (partial updates)
 * - Delete ticket (soft delete - marks as CANCELLED)
 * - List tickets with filters and pagination
 *
 * Features:
 * - Input validation
 * - SQL injection prevention (parameterized queries)
 * - Soft delete (never hard delete tickets)
 * - Pagination support
 * - Multi-criteria filtering
 * - Automatic ticket UID generation (VF-YYYYMMDD-NNN format)
 *   - VF = Velocity Fibre
 *   - YYYYMMDD = Date
 *   - NNN = Daily sequence (001, 002, etc.)
 *   - Uses atomic database sequence for collision-free generation
 */

import { query, queryOne } from '../utils/db';
import {
  Ticket,
  CreateTicketPayload,
  UpdateTicketPayload,
  TicketSource,
  TicketType,
  TicketPriority,
  TicketStatus,
  TicketFilters,
  TicketListResponse
} from '../types/ticket';
import { createLogger } from '@/lib/logger';

const logger = createLogger('maintenance:service');

// ==================== Activity Logging ====================

/** Human-readable labels for field names */
const FIELD_LABELS: Record<string, string> = {
  status: 'Status',
  priority: 'Priority',
  assigned_to: 'Assigned To',
  assigned_team_id: 'Assigned Team',
  assigned_team: 'Assigned Team',
  assigned_contractor_id: 'Assigned Contractor',
  title: 'Title',
  description: 'Description',
  fault_cause: 'Fault Cause',
  fault_cause_details: 'Fault Cause Details',
  dr_number: 'DR Number',
  project_id: 'Project',
  zone_id: 'Zone',
  pole_number: 'Pole',
  pon_number: 'PON',
  address: 'Address',
  ont_serial: 'ONT Serial',
  ont_rx_level: 'ONT RX Level',
  ont_model: 'ONT Model',
  qa_ready: 'QA Ready',
  sla_due_at: 'SLA Due',
  sla_breached: 'SLA Breached',
  guarantee_status: 'Guarantee Status',
  is_billable: 'Billable',
  billing_classification: 'Billing Classification',
};

/**
 * Log an activity event for a ticket.
 * Used for KPI tracking: who worked on what, when, and what changed.
 */
export async function logTicketActivity(params: {
  ticketId: string;
  activityType: 'update' | 'note' | 'assignment' | 'status_change' | 'created' | 'cancelled';
  description: string;
  fieldChanges?: Record<string, { from: any; to: any }>;
  userId?: string;
  userName?: string;
  userEmail?: string;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO maintenance_activities (ticket_id, activity_type, description, field_changes, created_by_name, created_by_email, source)
       VALUES ($1, $2, $3, $4, $5, $6, 'fibreflow')`,
      [
        params.ticketId,
        params.activityType,
        params.description,
        params.fieldChanges ? JSON.stringify(params.fieldChanges) : null,
        params.userName || null,
        params.userEmail || null,
      ]
    );
  } catch (error) {
    logger.error('Failed to log ticket activity', { error, params });
  }
}

/**
 * Compare old and new ticket state, log all field changes as activities.
 * This is the core audit trail for KPI tracking.
 */
export async function logTicketChanges(params: {
  ticketId: string;
  oldTicket: Record<string, any>;
  newTicket: Record<string, any>;
  payload: Record<string, any>;
  userId?: string;
  userName?: string;
  userEmail?: string;
}): Promise<void> {
  const { ticketId, oldTicket, newTicket, payload, userId, userName, userEmail } = params;
  const trackedFields = Object.keys(FIELD_LABELS);
  const fieldChanges: Record<string, { from: any; to: any }> = {};

  for (const field of trackedFields) {
    if (!(field in payload)) continue;
    const oldVal = oldTicket[field];
    const newVal = newTicket[field];
    if (String(oldVal ?? '') !== String(newVal ?? '')) {
      fieldChanges[field] = { from: oldVal ?? null, to: newVal ?? null };
    }
  }

  if (Object.keys(fieldChanges).length === 0) return;

  // Determine primary activity type and description
  const statusChanged = 'status' in fieldChanges;
  const assignmentChanged = 'assigned_to' in fieldChanges || 'assigned_team_id' in fieldChanges;

  // Log status change as its own activity
  if (statusChanged) {
    const from = fieldChanges.status!.from || 'none';
    const to = fieldChanges.status!.to;
    await logTicketActivity({
      ticketId,
      activityType: 'status_change',
      description: `Status changed from ${from} to ${to}`,
      fieldChanges: { status: fieldChanges.status },
      userId, userName, userEmail,
    });
  }

  // Log assignment change as its own activity
  if (assignmentChanged) {
    const parts: string[] = [];
    if (fieldChanges.assigned_to) parts.push('assignee');
    if (fieldChanges.assigned_team_id) parts.push('team');
    await logTicketActivity({
      ticketId,
      activityType: 'assignment',
      description: `${parts.join(' and ')} changed`,
      fieldChanges: Object.fromEntries(
        Object.entries(fieldChanges).filter(([k]) => k.startsWith('assigned'))
      ),
      userId, userName, userEmail,
    });
  }

  // Log remaining field changes as a single update activity
  const otherChanges = Object.fromEntries(
    Object.entries(fieldChanges).filter(([k]) => k !== 'status' && !k.startsWith('assigned'))
  );
  if (Object.keys(otherChanges).length > 0) {
    const changedLabels = Object.keys(otherChanges).map(k => FIELD_LABELS[k] || k);
    await logTicketActivity({
      ticketId,
      activityType: 'update',
      description: `Updated: ${changedLabels.join(', ')}`,
      fieldChanges: otherChanges,
      userId, userName, userEmail,
    });
  }
}

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
 * Generate unique ticket UID using atomic database sequence
 * Format: VF-YYYYMMDD-NNN (e.g., VF-20260122-001)
 *
 * - VF = Velocity Fibre
 * - YYYYMMDD = Date of creation
 * - NNN = Daily sequence number (resets each day)
 *
 * Uses INSERT...ON CONFLICT for atomic, collision-free generation.
 *
 * @param forDate - Optional date to generate UID for (used during migration)
 * @returns Promise<string> The generated VF ticket UID
 */
async function generateTicketUID(forDate?: Date, prefix = 'VF'): Promise<string> {
  const targetDate = forDate || new Date();
  const isoStr = targetDate.toISOString();
  const dateStr = isoStr.slice(0, 10); // YYYY-MM-DD for SQL
  const formattedDate = dateStr.replace(/-/g, ''); // YYYYMMDD for UID

  // Atomic sequence generation using INSERT...ON CONFLICT
  const result = await queryOne<{ last_sequence: number }>(
    `INSERT INTO maintenance_ticket_sequences (sequence_date, last_sequence)
     VALUES ($1::date, 1)
     ON CONFLICT (sequence_date)
     DO UPDATE SET
       last_sequence = maintenance_ticket_sequences.last_sequence + 1,
       updated_at = NOW()
     RETURNING last_sequence`,
    [dateStr]
  );

  if (!result) {
    throw new Error(`Failed to generate ${prefix} ticket UID - sequence query returned no result`);
  }

  const seqNum = result.last_sequence;
  const paddedSeq = String(seqNum).padStart(3, '0');

  return `${prefix}-${formattedDate}-${paddedSeq}`;
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use generateTicketUID() instead
 */
function generateLegacyTicketUID(): string {
  const randomDigits = Math.floor(100000 + Math.random() * 900000);
  return `FF${randomDigits}`;
}

/**
 * Validate ticket source enum
 */
function isValidSource(source: string): source is TicketSource {
  return Object.values(TicketSource).includes(source as TicketSource);
}

/**
 * Validate ticket type enum
 */
function isValidTicketType(ticketType: string): ticketType is TicketType {
  return Object.values(TicketType).includes(ticketType as TicketType);
}

/**
 * Create a new ticket
 *
 * @param payload - Ticket creation data
 * @returns Created ticket with generated ID and UID
 * @throws {Error} If validation fails or database error occurs
 */
export async function createTicket(payload: CreateTicketPayload): Promise<Ticket> {
  // 🟢 WORKING: Validate required fields
  if (!payload.source) {
    throw new Error('source is required');
  }

  if (!payload.title || !payload.title.trim()) {
    throw new Error(payload.title === '' ? 'title cannot be empty' : 'title is required');
  }

  if (!payload.ticket_type) {
    throw new Error('ticket_type is required');
  }

  // 🟢 WORKING: Validate enum values
  if (!isValidSource(payload.source)) {
    throw new Error('Invalid source value');
  }

  if (!isValidTicketType(payload.ticket_type)) {
    throw new Error('Invalid ticket_type value');
  }

  // Resolve user_id → staff_id for assigned_to (FK references staff table)
  if (payload.assigned_to) {
    const staffRow = await queryOne<{ id: string }>(
      `SELECT id FROM staff WHERE user_id = $1 LIMIT 1`,
      [payload.assigned_to]
    );
    if (staffRow) {
      payload = { ...payload, assigned_to: staffRow.id };
    }
  }

  // 🟢 WORKING: Set defaults
  const priority = payload.priority || TicketPriority.NORMAL;
  let status = payload.status || TicketStatus.OPEN;
  const ticketUID = await generateTicketUID(undefined, payload.uid_prefix || 'VF');

  logger.info('Creating ticket', {
    title: payload.title,
    type: payload.ticket_type,
    source: payload.source
  });

  try {
    // 🟢 WORKING: Insert ticket with all fields
    const sql = `
      INSERT INTO maintenance_tickets (
        ticket_uid,
        source,
        source_type,
        external_id,
        title,
        description,
        type,
        priority,
        status,
        dr_number,
        project_id,
        zone,
        pole_id,
        pon,
        address,
        assigned_to,
        contractor_id,
        assigned_team,
        assigned_team_id,
        created_by,
        ont_serial,
        client_name,
        client_contact,
        client_email
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24
      )
      RETURNING *
    `;

    // Auto-assign dev_ops tickets to the DevOps team if not already assigned
    if (payload.ticket_type === TicketType.DEV_OPS && !payload.assigned_team_id) {
      const devOpsTeam = await queryOne<{ id: string; name: string }>(
        `SELECT id, name FROM teams WHERE name = 'DevOps' AND is_active = true LIMIT 1`,
        []
      );
      if (devOpsTeam) {
        payload.assigned_team_id = devOpsTeam.id;
        payload.assigned_team = devOpsTeam.id;
        status = 'assigned';
        logger.info('Auto-assigned DevOps ticket to DevOps team', { teamId: devOpsTeam.id });
      }
    }

    const values = [
      ticketUID,
      payload.source,
      payload.source_type || null,
      payload.external_id || null,
      payload.title,
      payload.description || null,
      payload.ticket_type,
      priority,
      status,
      payload.dr_number || null,
      payload.project_id || null,
      payload.zone_id || null,
      payload.pole_number || null,
      payload.pon_number || null,
      payload.address || null,
      payload.assigned_to || null,
      payload.assigned_contractor_id || null,
      payload.assigned_team || null,
      payload.assigned_team_id || null,
      payload.created_by || null,
      payload.ont_serial || null,
      payload.client_name || null,
      payload.client_contact || null,
      payload.client_email || null,
    ];

    const ticket = await queryOne<Ticket>(sql, values);

    if (!ticket) {
      throw new Error('Failed to create ticket');
    }

    // Insert DevOps-specific details if this is a dev_ops ticket
    if (payload.ticket_type === TicketType.DEV_OPS) {
      await query(
        `INSERT INTO dev_ticket_details (
          ticket_id,
          error_url,
          stack_trace,
          affected_module,
          environment,
          steps_to_reproduce,
          browser_info
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          ticket.id,
          payload.error_url || null,
          payload.stack_trace || null,
          payload.affected_module || null,
          payload.environment || 'production',
          payload.steps_to_reproduce || null,
          payload.browser_info || null,
        ]
      );
      logger.info('DevOps ticket details saved', { ticket_id: ticket.id });
    }

    logger.info('Ticket created successfully', {
      id: ticket.id,
      ticket_uid: ticket.ticket_uid
    });

    return ticket;
  } catch (error) {
    logger.error('Failed to create ticket', { error, payload });
    throw error;
  }
}

/**
 * Get ticket by ID
 *
 * @param id - Ticket UUID
 * @returns Ticket data
 * @throws {Error} If ticket not found or ID invalid
 */
export async function getTicketById(id: string): Promise<Ticket> {
  // 🟢 WORKING: Validate ID format
  if (!isValidUUID(id)) {
    throw new Error('Invalid ticket ID format');
  }

  logger.debug('Fetching ticket by ID', { id });

  try {
    // Include assigned staff and team info via LEFT JOINs
    // assigned_to references staff.id, not users.id
    const sql = `
      SELECT
        t.*,
        CASE
          WHEN s.id IS NOT NULL THEN jsonb_build_object(
            'id', s.id,
            'name', COALESCE(s.first_name || ' ' || s.last_name, s.email),
            'email', s.email
          )
          ELSE NULL
        END as assigned_user,
        CASE
          WHEN cu.id IS NOT NULL THEN jsonb_build_object(
            'id', cu.id,
            'name', COALESCE(cu.first_name || ' ' || cu.last_name, cu.email)
          )
          ELSE NULL
        END as created_user,
        tm.name as assigned_team_name
      FROM maintenance_tickets t
      LEFT JOIN staff s ON t.assigned_to = s.id
      LEFT JOIN users cu ON t.created_by = cu.id
      LEFT JOIN teams tm ON t.assigned_team_id = tm.id
      WHERE t.id = $1
    `;
    const ticket = await queryOne<Ticket & { assigned_user?: { id: string; name: string; email: string }; created_user?: { id: string; name: string }; assigned_team_name?: string }>(sql, [id]);

    if (!ticket) {
      throw new Error(`Ticket with ID ${id} not found`);
    }

    logger.debug('Ticket fetched successfully', { id, ticket_uid: ticket.ticket_uid });

    return ticket;
  } catch (error) {
    logger.error('Failed to fetch ticket', { error, id });
    throw error;
  }
}

/**
 * Update ticket (partial update)
 *
 * @param id - Ticket UUID
 * @param payload - Fields to update
 * @returns Updated ticket
 * @throws {Error} If ticket not found or update fails
 */
export async function updateTicket(
  id: string,
  payload: UpdateTicketPayload
): Promise<Ticket> {
  // 🟢 WORKING: Validate empty payload
  if (!payload || Object.keys(payload).length === 0) {
    throw new Error('Update payload cannot be empty');
  }

  logger.info('Updating ticket', { id, fields: Object.keys(payload) });

  try {
    // Resolve user_id → staff_id for assigned_to (FK references staff table)
    if (payload.assigned_to) {
      const staffRow = await queryOne<{ id: string }>(
        `SELECT id FROM staff WHERE user_id = $1 LIMIT 1`,
        [payload.assigned_to]
      );
      if (staffRow) {
        payload = { ...payload, assigned_to: staffRow.id };
      }
    }

    // 🟢 WORKING: Build dynamic UPDATE query based on provided fields
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramCounter = 1;

    // Map of payload keys to database columns
    const fieldMap: Record<string, string> = {
      title: 'title',
      description: 'description',
      status: 'status',
      priority: 'priority',
      assigned_to: 'assigned_to',
      assigned_contractor_id: 'assigned_contractor_id',
      assigned_team: 'assigned_team',
      assigned_team_id: 'assigned_team_id',
      dr_number: 'dr_number',
      project_id: 'project_id',
      zone_id: 'zone_id',
      pole_number: 'pole_number',
      pon_number: 'pon_number',
      address: 'address',
      ont_serial: 'ont_serial',
      ont_rx_level: 'ont_rx_level',
      ont_model: 'ont_model',
      fault_cause: 'fault_cause',
      fault_cause_details: 'fault_cause_details',
      guarantee_status: 'guarantee_status',
      guarantee_expires_at: 'guarantee_expires_at',
      is_billable: 'is_billable',
      billing_classification: 'billing_classification',
      qa_ready: 'qa_ready',
      sla_due_at: 'sla_due_at',
      sla_first_response_at: 'sla_first_response_at',
      sla_breached: 'sla_breached'
    };

    // Build SET clause dynamically
    for (const [key, value] of Object.entries(payload)) {
      if (key in fieldMap) {
        const dbColumn = fieldMap[key];
        updateFields.push(`${dbColumn} = $${paramCounter}`);
        values.push(value);
        paramCounter++;
      }
    }

    // Always update updated_at
    updateFields.push('updated_at = NOW()');

    // Add ID as last parameter
    values.push(id);

    const sql = `
      UPDATE maintenance_tickets
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCounter}
      RETURNING *
    `;

    const updatedTicket = await queryOne<Ticket>(sql, values);

    if (!updatedTicket) {
      throw new Error(`Ticket with ID ${id} not found`);
    }

    logger.info('Ticket updated successfully', {
      id,
      ticket_uid: updatedTicket.ticket_uid
    });

    return updatedTicket;
  } catch (error) {
    logger.error('Failed to update ticket', { error, id, payload });
    throw error;
  }
}

/**
 * Delete ticket (soft delete - marks as CANCELLED)
 *
 * We never hard delete tickets for audit trail purposes.
 * Instead, we mark them as CANCELLED.
 *
 * @param id - Ticket UUID
 * @returns Deleted (cancelled) ticket
 * @throws {Error} If ticket not found
 */
export async function deleteTicket(id: string): Promise<Ticket> {
  logger.info('Soft deleting ticket (marking as CANCELLED)', { id });

  try {
    // 🟢 WORKING: Soft delete by updating status to CANCELLED
    const sql = `
      UPDATE maintenance_tickets
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;

    const deletedTicket = await queryOne<Ticket>(sql, [TicketStatus.CANCELLED, id]);

    if (!deletedTicket) {
      throw new Error(`Ticket with ID ${id} not found`);
    }

    logger.info('Ticket soft deleted successfully', {
      id,
      ticket_uid: deletedTicket.ticket_uid
    });

    return deletedTicket;
  } catch (error) {
    logger.error('Failed to delete ticket', { error, id });
    throw error;
  }
}

/**
 * Combined filters and pagination interface
 */
export interface ListTicketsParams extends Partial<TicketFilters> {
  page?: number;
  pageSize?: number;
}

/**
 * List tickets with filters and pagination
 *
 * @param filters - Filter criteria (status, type, assignee, etc.) and pagination
 * @returns Paginated list of tickets
 */
export async function listTickets(
  filters: ListTicketsParams = {}
): Promise<TicketListResponse> {
  logger.debug('Listing tickets', { filters });

  try {
    // 🟢 WORKING: Build WHERE clause based on filters
    const whereClauses: string[] = [];
    const values: any[] = [];
    let paramCounter = 1;

    if (filters.status) {
      // Support meta-groups (active/completed) used by sub-tabs, not just individual DB statuses
      const ACTIVE_STATUSES = ['open', 'assigned', 'in_progress', 'pending_qa'];
      const COMPLETED_STATUSES = ['resolved', 'verified', 'closed'];

      if (filters.status === 'active') {
        const placeholders = ACTIVE_STATUSES.map((_, i) => `$${paramCounter + i}`).join(', ');
        whereClauses.push(`status IN (${placeholders})`);
        values.push(...ACTIVE_STATUSES);
        paramCounter += ACTIVE_STATUSES.length;
      } else if (filters.status === 'completed') {
        const placeholders = COMPLETED_STATUSES.map((_, i) => `$${paramCounter + i}`).join(', ');
        whereClauses.push(`status IN (${placeholders})`);
        values.push(...COMPLETED_STATUSES);
        paramCounter += COMPLETED_STATUSES.length;
      } else {
        whereClauses.push(`status = $${paramCounter}`);
        values.push(filters.status);
        paramCounter++;
      }
    }

    if (filters.ticket_type) {
      // Note: Using 'type' column which exists in the current schema
      whereClauses.push(`type = $${paramCounter}`);
      values.push(filters.ticket_type);
      paramCounter++;
    }

    if (filters.assigned_to) {
      // assigned_to column stores staff.id, but auth provides users.id
      // Look up staff_id first, fall back to the value as-is
      const staffLookup = await queryOne<{ id: string }>(
        `SELECT id FROM staff WHERE user_id = $1 LIMIT 1`,
        [filters.assigned_to]
      );
      if (!staffLookup) {
        logger.warn('No staff record found for user_id — "My Tickets" filter may return no results', { user_id: filters.assigned_to });
      }
      const resolvedId = staffLookup?.id || filters.assigned_to;
      whereClauses.push(`assigned_to = $${paramCounter}`);
      values.push(resolvedId);
      paramCounter++;
    }

    if (filters.assigned_contractor_id) {
      // Note: Using 'contractor_id' column which exists in the current schema
      whereClauses.push(`contractor_id = $${paramCounter}`);
      values.push(filters.assigned_contractor_id);
      paramCounter++;
    }

    if (filters.priority) {
      whereClauses.push(`priority = $${paramCounter}`);
      values.push(filters.priority);
      paramCounter++;
    }

    if (filters.source) {
      whereClauses.push(`source = $${paramCounter}`);
      values.push(filters.source);
      paramCounter++;
    }

    if (filters.assigned_team_id) {
      whereClauses.push(`assigned_team_id = $${paramCounter}`);
      values.push(filters.assigned_team_id);
      paramCounter++;
    }

    if (filters.project_id) {
      whereClauses.push(`project_id = $${paramCounter}`);
      values.push(filters.project_id);
      paramCounter++;
    }

    if (filters.dr_number) {
      whereClauses.push(`dr_number = $${paramCounter}`);
      values.push(filters.dr_number);
      paramCounter++;
    }

    if (filters.qa_ready !== undefined) {
      // Note: Using 'qa_verified' column which exists in the current schema
      whereClauses.push(`qa_verified = $${paramCounter}`);
      values.push(filters.qa_ready);
      paramCounter++;
    }

    if (filters.sla_breached !== undefined) {
      whereClauses.push(`sla_breached = $${paramCounter}`);
      values.push(filters.sla_breached);
      paramCounter++;
    }

    // Date range filter
    if (filters.created_after) {
      whereClauses.push(`created_at >= $${paramCounter}`);
      values.push(new Date(filters.created_after).toISOString());
      paramCounter++;
    }

    if (filters.created_before) {
      whereClauses.push(`created_at < $${paramCounter}`);
      values.push(new Date(filters.created_before).toISOString());
      paramCounter++;
    }

    // 🟢 WORKING: Search filter - searches ticket_uid, dr_number, title, and description
    // Each column needs its own parameter index because the neon HTTP driver
    // splits by $N placeholders to build tagged template literals.
    if (filters.search && filters.search.trim()) {
      const searchTerm = `%${filters.search.trim()}%`;
      const p1 = paramCounter++;
      const p2 = paramCounter++;
      const p3 = paramCounter++;
      const p4 = paramCounter++;
      whereClauses.push(`(
        ticket_uid ILIKE $${p1} OR
        dr_number ILIKE $${p2} OR
        title ILIKE $${p3} OR
        description ILIKE $${p4}
      )`);
      values.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // 🟢 WORKING: Build WHERE clause
    const whereClause = whereClauses.length > 0
      ? `WHERE ${whereClauses.join(' AND ')}`
      : '';

    // 🟢 WORKING: Pagination (default: page 1, pageSize 50, max 200)
    const page = filters.page || 1;
    const pageSize = Math.min(filters.pageSize || 50, 200);
    const offset = (page - 1) * pageSize;

    // Add LIMIT and OFFSET as last parameters
    values.push(pageSize);
    const limitParam = paramCounter;
    paramCounter++;

    values.push(offset);
    const offsetParam = paramCounter;

    // 🟢 WORKING: First get the total count (without pagination)
    const countSql = `
      SELECT COUNT(*) as count
      FROM maintenance_tickets t
      ${whereClause ? whereClause.replace(/\b(status|type|priority|source|assigned_to|contractor_id|project_id|dr_number|qa_verified|sla_breached|assigned_team_id|ticket_uid|title|description|created_at)\b/g, 't.$1') : ''}
    `;
    // Count query uses same filter values but without LIMIT/OFFSET
    const countValues = values.slice(0, -2); // Remove the last two values (limit and offset)
    const countResult = await queryOne<{ count: string }>(countSql, countValues);
    const totalCount = parseInt(countResult?.count || '0', 10);

    // 🟢 WORKING: Query with pagination, ordering, and assigned user/team info
    const sql = `
      SELECT
        t.*,
        t.type as ticket_type,
        CASE
          WHEN s.id IS NOT NULL THEN jsonb_build_object(
            'id', s.id,
            'name', COALESCE(s.first_name || ' ' || s.last_name, s.email),
            'email', s.email
          )
          ELSE NULL
        END as assigned_user,
        CASE
          WHEN cu.id IS NOT NULL THEN jsonb_build_object(
            'id', cu.id,
            'name', COALESCE(cu.first_name || ' ' || cu.last_name, cu.email)
          )
          ELSE NULL
        END as created_user,
        tm.name as assigned_team_name
      FROM maintenance_tickets t
      LEFT JOIN staff s ON t.assigned_to = s.id
      LEFT JOIN users cu ON t.created_by = cu.id
      LEFT JOIN teams tm ON t.assigned_team_id = tm.id
      ${whereClause ? whereClause.replace(/\b(status|type|priority|source|assigned_to|contractor_id|project_id|dr_number|qa_verified|sla_breached|assigned_team_id|ticket_uid|title|description|created_at)\b/g, 't.$1') : ''}
      ORDER BY t.created_at DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;

    const tickets = await query<Ticket & { assigned_user?: { id: string; name: string; email: string }; assigned_team_name?: string }>(sql, values);

    logger.debug('Tickets fetched successfully', {
      count: tickets.length,
      total: totalCount,
      page,
      pageSize
    });

    return {
      tickets,
      total: totalCount,
      page,
      limit: pageSize,
      total_pages: Math.ceil(totalCount / pageSize)
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('relation') && errorMessage.includes('does not exist')) {
      logger.warn('Tickets table does not exist - returning empty list. Run migrations to create tables.');
      return {
        tickets: [],
        total: 0,
        page: filters.page || 1,
        limit: filters.pageSize || 50,
        total_pages: 0
      };
    }
    logger.error('Failed to list tickets', { error, filters });
    throw error;
  }
}

/**
 * Export generateTicketUID for use in migration scripts
 */
export { generateTicketUID };
