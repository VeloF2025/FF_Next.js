/**
 * QContact Inbound Sync Service
 * 🟢 WORKING: Production-ready service for importing tickets from QContact to FibreFlow
 *
 * Features:
 * - Fetch new tickets from QContact API
 * - Create tickets in FibreFlow database
 * - Field mapping between QContact and FibreFlow schemas
 * - Duplicate detection and skipping
 * - Sync logging with audit trail
 * - Error handling with graceful degradation
 * - Pagination support for large result sets
 *
 * @module maintenance/services/qcontactSyncInbound
 */

import { queryOne } from '../utils/db';
import { getDefaultQContactClient } from './qcontactClient';
import {
  getDefaultFiberTimeQContactClient,
  FiberTimeQContactClient,
  type FiberTimeCase,
  type FiberTimeCaseDetail,
  MAINTENANCE_VELOCITY_ID,
} from './fibertimeQContactClient';
import { generateTicketUID } from './ticketService';
import type { QContactTicket } from '../types/qcontact';
import type { CreateTicketPayload } from '../types/ticket';
import {
  TicketSource,
  TicketType,
  TicketPriority,
} from '../types/ticket';
import { mapQContactStatusToFibreFlow } from '../constants/qcontactStatusMapping';
import {
  SyncDirection,
  SyncType,
  SyncStatus,
  type SyncOperationResult,
  type SyncStats,
  type SyncError,
} from '../types/qcontact';
import { createLogger } from '@/lib/logger';

// 🟢 WORKING: Logger instance for sync operations
const logger = createLogger('qcontactSyncInbound');

// System user ID for automated QContact imports
const QCONTACT_SYSTEM_USER_ID = 'decb8382-94ed-4e07-94f7-74ad269a5985'; // Admin User

/**
 * Status precedence for inbound sync - higher number = more advanced
 * Inbound sync will NOT regress a ticket past resolved/closed
 * but CAN regress between work-phase statuses (open ↔ assigned ↔ in_progress)
 */
const STATUS_PRECEDENCE: Record<string, number> = {
  open: 0,
  assigned: 1,
  in_progress: 2,
  pending_qa: 3,
  qa_in_progress: 3,
  qa_rejected: 2,
  qa_approved: 4,
  pending_handover: 5,
  handed_to_ops: 6,
  resolved: 7,
  closed: 8,
  cancelled: 8,
};

/**
 * Check if inbound status should override current FF status
 * Rules:
 * - Never regress from resolved/closed/cancelled (precedence >= 7)
 * - Allow progression to closed from any state
 * - Allow any changes within work phase (precedence 0-2)
 */
function shouldUpdateStatus(currentFFStatus: string, incomingStatus: string): boolean {
  const currentPrec = STATUS_PRECEDENCE[currentFFStatus] ?? 0;
  const incomingPrec = STATUS_PRECEDENCE[incomingStatus] ?? 0;

  // Never regress from resolved/closed/cancelled
  if (currentPrec >= 7 && incomingPrec < currentPrec) {
    return false;
  }

  return true;
}

// ============================================================================
// Types
// ============================================================================

/**
 * Options for bulk inbound sync
 */
export interface SyncInboundOptions {
  created_after?: Date;
  created_before?: Date;
  status?: string;
  page_size?: number;
}

/**
 * Result of bulk inbound sync operation
 */
export interface SyncInboundResult {
  started_at: Date;
  completed_at: Date;
  duration_seconds: number;
  total_processed: number;
  successful: number;
  failed: number;
  skipped: number;
  created: number;
  updated: number;
  errors: SyncError[];
}

// ============================================================================
// Field Mapping Functions
// ============================================================================

/**
 * Map QContact priority to FibreFlow priority
 * 🟢 WORKING: Priority conversion with fallback to medium
 * Note: Database constraint allows: low, medium, high, critical
 */
function mapPriority(qcontactPriority: string | null): string {
  if (!qcontactPriority) {
    return 'medium';
  }

  const priorityLower = qcontactPriority.toLowerCase();

  switch (priorityLower) {
    case 'low':
      return 'low';
    case 'normal':
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    case 'urgent':
    case 'critical':
      return 'critical';
    default:
      return 'medium';
  }
}

/**
 * Map a QContact category + subcategory to the FibreFlow two-axis taxonomy:
 * returns both the discipline (ticket_type) and the T1 category
 * (ticket_category). Part of PR 3/4 in the April-11 taxonomy refactor.
 *
 * QContact category values seen in production (901 rows as of 2026-04-11):
 *   Connectivity    785 rows (ONT/Gizzu, PoorSignal, Link Light, Laptop)
 *   Maintenance     107 rows (Follow-Up, PropertyDamage, ONTMove)
 *   NewInstallation   3 rows
 *   SmartTV           2 rows
 *   Other             3 rows
 *   General           1 row
 *
 * Discipline mapping (per April-11 Q2 answer — "good for now, we can adjust later"):
 *   Connectivity / fault work         → optical     (fibre / signal issues)
 *   ONT swap / move                   → activations (service turn-up work)
 *   NewInstallation / install         → activations (service turn-up work)
 *   Maintenance / repair / damage     → optical     (fallback to fibre team)
 *   Bundle                            → optical
 *   Sales / lead / enquiry            → maintenance (sales_lead category +
 *                                                   generic maintenance team)
 *   Incident                          → maintenance (maps to the legacy
 *                                                   maintenance discipline)
 *   Anything else                     → optical (fallback — QContact is
 *                                                predominantly fibre-fault
 *                                                driven)
 *
 * T1 ticket_category mapping:
 *   sales/lead/enquiry → sales_lead
 *   everything else    → maintenance
 *
 * QContact tickets never become snags or DevOps tickets.
 */
function mapQContactClassification(
  category: string | null,
  subcategory?: string | null
): { ticket_type: string; ticket_category: string } {
  const combined = [category, subcategory].filter(Boolean).join(' ').toLowerCase();

  if (!combined) {
    return { ticket_type: 'optical', ticket_category: 'maintenance' };
  }

  // Sales / lead enquiries → sales_lead T1, maintenance discipline
  if (
    combined.includes('sales') ||
    combined.includes('lead') ||
    combined.includes('enquiry') ||
    combined.includes('enquiries') ||
    combined.includes('new customer') ||
    combined.includes('prospect')
  ) {
    return { ticket_type: 'maintenance', ticket_category: 'sales_lead' };
  }

  // ONT swap / move → activations
  if (combined.includes('ontmove') || combined.includes('ont move')) {
    return { ticket_type: 'activations', ticket_category: 'maintenance' };
  }

  // New installation → activations
  if (combined.includes('installation') || combined.includes('new install')) {
    return { ticket_type: 'activations', ticket_category: 'maintenance' };
  }

  // Incidents → generic maintenance discipline
  if (combined.includes('incident')) {
    return { ticket_type: 'maintenance', ticket_category: 'maintenance' };
  }

  // Everything else (Connectivity, ONT, Maintenance, Follow-Up, Damage,
  // Bundle, Signal, Link Light, SmartTV) → optical discipline as the
  // fallback, since these are overwhelmingly fibre-fault tickets.
  return { ticket_type: 'optical', ticket_category: 'maintenance' };
}

/**
 * Extended ticket payload with all QContact fields
 */
export interface ExtendedTicketPayload extends CreateTicketPayload {
  gps_coordinates?: string;
  category?: string;
  subcategory?: string;
  // Additional QContact fields stored in metadata
  qcontact_metadata?: Record<string, unknown>;
}

/**
 * Map QContact ticket to FibreFlow CreateTicketPayload
 * 🟢 WORKING: Complete field mapping with custom fields extraction
 *
 * @param qcontactTicket - Ticket data from QContact API
 * @returns Mapped ticket payload for FibreFlow
 */
export function mapQContactTicketToFibreFlow(
  qcontactTicket: QContactTicket
): ExtendedTicketPayload {
  // Extract custom fields
  const customFields = qcontactTicket.custom_fields || {};
  const drNumber = (customFields.dr_number as string) || null;
  const poleNumber = customFields.pole_number as string | undefined;
  const ponNumber = customFields.pon_number as string | undefined;
  const projectId = customFields.project_id as string | undefined;
  const zoneId = customFields.zone_id as string | undefined;
  const gpsCoordinates = customFields.gps_coordinates as string | undefined;
  const ontSerial = customFields.ont_serial as string | undefined;

  const classification = mapQContactClassification(qcontactTicket.category, qcontactTicket.subcategory);

  const payload: ExtendedTicketPayload = {
    source: TicketSource.QCONTACT,
    external_id: qcontactTicket.id,
    title: qcontactTicket.title,
    description: qcontactTicket.description || undefined,
    ticket_type: classification.ticket_type as TicketType,
    ticket_category: classification.ticket_category,
    priority: mapPriority(qcontactTicket.priority) as TicketPriority,
    // Contact Info
    client_name: qcontactTicket.customer_name || undefined,
    client_contact: qcontactTicket.customer_phone || undefined,
    client_email: qcontactTicket.customer_email || undefined,
    // Location
    address: qcontactTicket.address || undefined,
    gps_coordinates: gpsCoordinates,
    dr_number: drNumber || undefined,
    // Equipment
    ont_serial: ontSerial,
    // Category
    category: qcontactTicket.category || undefined,
    subcategory: qcontactTicket.subcategory || undefined,
    // Other fields
    pole_number: poleNumber,
    pon_number: ponNumber,
    project_id: projectId,
    zone_id: zoneId,
    // Store all custom fields as metadata
    qcontact_metadata: customFields,
  };

  return payload;
}

// ============================================================================
// Sync Logging Functions
// ============================================================================

/**
 * Create sync log entry in qcontact_sync_log table
 * 🟢 WORKING: Audit trail for all sync operations
 */
async function createSyncLog(
  qcontactTicketId: string,
  ticketId: string | null,
  syncType: SyncType,
  status: SyncStatus,
  requestPayload: Record<string, unknown> | object | null,
  responsePayload: Record<string, unknown> | object | null,
  errorMessage: string | null
): Promise<string> {
  const sql = `
    INSERT INTO maintenance_qcontact_sync_log (
      ticket_id,
      qcontact_ticket_id,
      sync_direction,
      sync_type,
      request_payload,
      response_payload,
      status,
      error_message
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8
    )
    RETURNING id
  `;

  const values = [
    ticketId,
    qcontactTicketId,
    SyncDirection.INBOUND,
    syncType,
    requestPayload ? JSON.stringify(requestPayload) : null,
    responsePayload ? JSON.stringify(responsePayload) : null,
    status,
    errorMessage,
  ];

  try {
    const result = await queryOne<{ id: string }>(sql, values);
    return result?.id || '';
  } catch (error) {
    logger.error('Failed to create sync log', {
      qcontactTicketId,
      ticketId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - logging failure shouldn't stop sync
    return '';
  }
}

// ============================================================================
// Duplicate Detection
// ============================================================================

/**
 * Check if ticket already exists in FibreFlow
 * 🟢 WORKING: Duplicate detection by external_id
 *
 * @param qcontactTicketId - QContact ticket ID
 * @returns Existing ticket ID if found, null otherwise
 */
async function checkDuplicate(qcontactTicketId: string): Promise<string | null> {
  const sql = `
    SELECT id
    FROM maintenance_tickets
    WHERE source = $1
      AND external_id = $2
    LIMIT 1
  `;

  const values = [TicketSource.QCONTACT, qcontactTicketId];

  try {
    const result = await queryOne<{ id: string }>(sql, values);
    return result ? result.id : null;
  } catch (error) {
    logger.error('Failed to check duplicate', {
      qcontactTicketId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// ============================================================================
// Single Ticket Sync
// ============================================================================

/**
 * Sync a single ticket from QContact to FibreFlow
 * 🟢 WORKING: Creates ticket or updates if duplicate exists
 *
 * @param qcontactTicket - Ticket data from QContact
 * @returns Sync operation result
 */
export async function syncSingleInboundTicket(
  qcontactTicket: QContactTicket
): Promise<SyncOperationResult> {
  const startTime = Date.now();

  logger.debug('Syncing inbound ticket', {
    qcontactTicketId: qcontactTicket.id,
    title: qcontactTicket.title,
  });

  try {
    // Check for duplicate
    const existingTicketId = await checkDuplicate(qcontactTicket.id);

    if (existingTicketId) {
      // UPDATE existing ticket's status, type, category, and backfill timestamps
      const mappedStatus = mapQContactStatusToFibreFlow(qcontactTicket.status);
      const classification = mapQContactClassification(qcontactTicket.category, qcontactTicket.subcategory);
      const mappedType = classification.ticket_type;
      const mappedTicketCategory = classification.ticket_category;
      const qcCreatedAt = qcontactTicket.created_at ? new Date(qcontactTicket.created_at) : null;
      const qcUpdatedAt = qcontactTicket.updated_at ? new Date(qcontactTicket.updated_at) : null;
      const qcLoggedDate = qcCreatedAt ? qcCreatedAt.toISOString().split('T')[0] : null;

      // Check current FF status to apply precedence rules
      const currentTicket = await queryOne<{ status: string }>(
        'SELECT status FROM maintenance_tickets WHERE id = $1',
        [existingTicketId]
      );
      const currentStatus = currentTicket?.status || 'open';
      const statusToSet = shouldUpdateStatus(currentStatus, mappedStatus) ? mappedStatus : currentStatus;

      if (statusToSet !== mappedStatus) {
        logger.info('Status precedence prevented regression', {
          qcontactTicketId: qcontactTicket.id,
          currentStatus,
          incomingStatus: mappedStatus,
          kept: statusToSet,
        });
      }

      const updateSql = `
        UPDATE maintenance_tickets
        SET status = $1,
            type = $2,
            category = $3,
            subcategory = $4,
            ticket_category = $9,
            updated_at = COALESCE($6, NOW()),
            created_at = COALESCE($7, created_at),
            original_logged_date = COALESCE(original_logged_date, $8)
        WHERE id = $5
        RETURNING id, status
      `;

      const updateResult = await queryOne<{ id: string; status: string }>(
        updateSql,
        [
          statusToSet, mappedType,
          qcontactTicket.category || null, qcontactTicket.subcategory || null,
          existingTicketId,
          qcUpdatedAt?.toISOString() || null,
          qcCreatedAt?.toISOString() || null,
          qcLoggedDate,
          mappedTicketCategory,
        ]
      );

      logger.info('Updated existing ticket', {
        qcontactTicketId: qcontactTicket.id,
        existingTicketId,
        qcontactStatus: qcontactTicket.status,
        ffStatus: statusToSet,
        statusProtected: statusToSet !== mappedStatus,
        category: qcontactTicket.category,
        type: mappedType,
      });

      // Create sync log for update
      const syncLogId = await createSyncLog(
        qcontactTicket.id,
        existingTicketId,
        SyncType.STATUS_UPDATE,
        SyncStatus.SUCCESS,
        { qcontact_status: qcontactTicket.status },
        { new_status: mappedStatus },
        null
      );

      return {
        success: true,
        sync_log_id: syncLogId,
        ticket_id: existingTicketId,
        qcontact_ticket_id: qcontactTicket.id,
        error_message: null,
        synced_at: new Date(),
        operation_type: 'update',
      };
    }

    // Map QContact ticket to FibreFlow format
    const ticketPayload = mapQContactTicketToFibreFlow(qcontactTicket);

    // Map QContact status to FibreFlow status
    const mappedStatus = mapQContactStatusToFibreFlow(qcontactTicket.status);

    // Create ticket in FibreFlow with all available fields
    // Note: Database uses 'type' not 'ticket_type', 'zone' not 'zone_id', 'pon' not 'pon_number'
    // Preserve QContact timestamps for SLA tracking
    const qcCreatedAt = qcontactTicket.created_at ? new Date(qcontactTicket.created_at) : new Date();
    const qcUpdatedAt = qcontactTicket.updated_at ? new Date(qcontactTicket.updated_at) : qcCreatedAt;
    const qcLoggedDate = qcCreatedAt.toISOString().split('T')[0]; // YYYY-MM-DD for original_logged_date

    // Generate proper VF-YYYYMMDD-NNN UID using QContact's creation date
    const ticketUid = await generateTicketUID(qcCreatedAt);

    const sql = `
      INSERT INTO maintenance_tickets (
        ticket_uid,
        source,
        external_id,
        title,
        description,
        type,
        priority,
        status,
        dr_number,
        project_id,
        zone,
        pon,
        address,
        client_name,
        client_contact,
        client_email,
        gps_coordinates,
        ont_serial,
        category,
        subcategory,
        ticket_category,
        created_by,
        created_at,
        updated_at,
        original_logged_date
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25
      )
      RETURNING *
    `;

    const values = [
      ticketUid,
      ticketPayload.source,
      ticketPayload.external_id,
      ticketPayload.title,
      ticketPayload.description || null,
      ticketPayload.ticket_type,
      ticketPayload.priority,
      mappedStatus, // Now using mapped status from QContact
      ticketPayload.dr_number || null,
      ticketPayload.project_id || null,
      ticketPayload.zone_id || null,
      ticketPayload.pon_number || null,
      ticketPayload.address || null,
      ticketPayload.client_name || null,
      ticketPayload.client_contact || null,
      ticketPayload.client_email || null,
      ticketPayload.gps_coordinates || null,
      ticketPayload.ont_serial || null,
      ticketPayload.category || null,          // QContact hierarchy
      ticketPayload.subcategory || null,       // QContact subcategory
      ticketPayload.ticket_category || null,   // T1 taxonomy (new April-11 axis)
      QCONTACT_SYSTEM_USER_ID,
      qcCreatedAt.toISOString(),
      qcUpdatedAt.toISOString(),
      qcLoggedDate,
    ];

    const createdTicket = await queryOne<{ id: string; ticket_uid: string }>(sql, values);

    if (!createdTicket) {
      throw new Error('Failed to create ticket - no result returned');
    }

    logger.info('Ticket created successfully', {
      qcontactTicketId: qcontactTicket.id,
      ticketId: createdTicket.id,
      ticketUid: createdTicket.ticket_uid,
      duration: Date.now() - startTime,
    });

    // Create success sync log
    const syncLogId = await createSyncLog(
      qcontactTicket.id,
      createdTicket.id,
      SyncType.CREATE,
      SyncStatus.SUCCESS,
      qcontactTicket,
      createdTicket,
      null
    );

    return {
      success: true,
      sync_log_id: syncLogId,
      ticket_id: createdTicket.id,
      qcontact_ticket_id: qcontactTicket.id,
      error_message: null,
      synced_at: new Date(),
      operation_type: 'create',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error('Failed to sync inbound ticket', {
      qcontactTicketId: qcontactTicket.id,
      error: errorMessage,
      duration: Date.now() - startTime,
    });

    // Create error sync log
    const syncLogId = await createSyncLog(
      qcontactTicket.id,
      null,
      SyncType.CREATE,
      SyncStatus.FAILED,
      qcontactTicket,
      null,
      errorMessage
    );

    return {
      success: false,
      sync_log_id: syncLogId,
      ticket_id: null,
      qcontact_ticket_id: qcontactTicket.id,
      error_message: errorMessage,
      synced_at: new Date(),
    };
  }
}

// ============================================================================
// Bulk Sync
// ============================================================================

/**
 * Sync tickets from QContact to FibreFlow in bulk
 * 🟢 WORKING: Fetches and syncs all new tickets from QContact
 *
 * Features:
 * - Pagination support for large result sets
 * - Filters for date ranges and status
 * - Error collection without stopping batch
 * - Detailed statistics reporting
 *
 * @param options - Sync filter options
 * @returns Sync result with statistics
 */
export async function syncInboundTickets(
  options: SyncInboundOptions = {}
): Promise<SyncInboundResult> {
  const startTime = Date.now();
  const started_at = new Date();

  logger.info('Starting inbound sync from QContact', options);

  const stats: SyncStats = {
    total_processed: 0,
    successful: 0,
    failed: 0,
    partial: 0,
    skipped: 0,
    created: 0,
    updated: 0,
  };

  const errors: SyncError[] = [];

  try {
    const client = getDefaultQContactClient();

    // Pagination setup
    const pageSize = options.page_size || 100;
    let currentPage = 1;
    let hasMore = true;

    while (hasMore) {
      logger.debug('Fetching tickets from QContact', {
        page: currentPage,
        pageSize,
      });

      // Fetch tickets from QContact
      const response = await client.listTickets({
        status: options.status || 'open',
        created_after: options.created_after,
        created_before: options.created_before,
        page: currentPage,
        page_size: pageSize,
      });

      logger.info('Fetched tickets from QContact', {
        page: currentPage,
        count: response.tickets.length,
        total: response.total,
      });

      // Process each ticket
      for (const qcontactTicket of response.tickets) {
        stats.total_processed++;

        const result = await syncSingleInboundTicket(qcontactTicket);

        if (result.success) {
          stats.successful++;

          // Track operation type: create, update, or skip
          if (result.operation_type === 'create') {
            stats.created++;
          } else if (result.operation_type === 'update') {
            stats.updated++;
          } else {
            stats.skipped++;
          }
        } else {
          stats.failed++;

          errors.push({
            ticket_id: null,
            qcontact_ticket_id: qcontactTicket.id,
            sync_type: SyncType.CREATE,
            error_message: result.error_message || 'Unknown error',
            error_code: null,
            timestamp: new Date(),
            recoverable: true,
          });
        }
      }

      // Check if there are more pages
      hasMore = response.has_more;
      currentPage++;

      // Safety limit to prevent infinite loops
      if (currentPage > 100) {
        logger.warn('Reached page limit, stopping sync', { currentPage });
        break;
      }
    }

    const duration_seconds = (Date.now() - startTime) / 1000;
    const completed_at = new Date();

    logger.info('Inbound sync completed', {
      duration_seconds,
      stats,
      errorCount: errors.length,
    });

    return {
      started_at,
      completed_at,
      duration_seconds,
      total_processed: stats.total_processed,
      successful: stats.successful,
      failed: stats.failed,
      skipped: stats.skipped,
      created: stats.created,
      updated: stats.updated,
      errors,
    };
  } catch (error) {
    const duration_seconds = (Date.now() - startTime) / 1000;
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error('Inbound sync failed', {
      error: errorMessage,
      duration_seconds,
      stats,
    });

    return {
      started_at,
      completed_at: new Date(),
      duration_seconds,
      total_processed: stats.total_processed,
      successful: stats.successful,
      failed: stats.failed,
      skipped: stats.skipped,
      created: stats.created,
      updated: stats.updated,
      errors: [
        ...errors,
        {
          ticket_id: null,
          qcontact_ticket_id: null,
          sync_type: SyncType.FULL_SYNC,
          error_message: errorMessage,
          error_code: null,
          timestamp: new Date(),
          recoverable: false,
        },
      ],
    };
  }
}

// ============================================================================
// FiberTime QContact Sync (Maintenance - Velocity)
// ============================================================================

/**
 * Map FiberTime Case to QContactTicket format for compatibility
 * 🟢 WORKING: Converts FiberTime API response to our QContactTicket interface
 */
function mapFiberTimeCaseToQContactTicket(ftCase: FiberTimeCase): QContactTicket {
  const mapped = FiberTimeQContactClient.mapCaseToTicket(ftCase);

  return {
    id: mapped.id,
    title: mapped.title,
    description: mapped.description,
    status: mapped.status,
    priority: mapped.priority,
    created_at: mapped.created_at,
    updated_at: mapped.updated_at,
    customer_name: mapped.customer_name,
    customer_phone: mapped.customer_phone,
    customer_email: mapped.customer_email,
    address: mapped.address,
    assigned_to: mapped.assigned_to,
    category: mapped.category,
    subcategory: mapped.subcategory,
    custom_fields: mapped.custom_fields,
  };
}

/**
 * Map FiberTime Case Detail to QContactTicket format with all fields
 * 🟢 WORKING: Full mapping including contact info, equipment, and location
 */
function mapFiberTimeCaseDetailToQContactTicket(caseDetail: FiberTimeCaseDetail): QContactTicket {
  const mapped = FiberTimeQContactClient.mapCaseDetailToTicket(caseDetail);

  return {
    id: mapped.id,
    title: mapped.title,
    description: mapped.description,
    status: mapped.status,
    priority: mapped.priority,
    created_at: mapped.created_at,
    updated_at: mapped.updated_at,
    customer_name: mapped.customer_name,
    customer_phone: mapped.customer_phone,
    customer_email: mapped.customer_email,
    address: mapped.address,
    assigned_to: mapped.assigned_to,
    category: mapped.category,
    subcategory: mapped.subcategory,
    custom_fields: {
      ...mapped.custom_fields,
      dr_number: mapped.dr_number,
      gps_coordinates: mapped.gps_coordinates,
      ont_serial: mapped.ont_serial,
      gizzu_serial: mapped.gizzu_serial,
      availability: mapped.availability,
      field_agent: mapped.field_agent,
      tv_connector: mapped.tv_connector,
    },
  };
}

/**
 * Options for FiberTime inbound sync
 */
export interface FiberTimeSyncOptions {
  assignedTo?: string;
  page?: number;
  pageSize?: number;
  /** Fetch full case details for each case (default: true) */
  fetchDetails?: boolean;
}

/**
 * Sync tickets from FiberTime QContact to FibreFlow
 * 🟢 WORKING: Fetches Maintenance - Velocity cases from FiberTime QContact API
 *
 * Enhanced to fetch full case details including:
 * - Contact info (name, phone, email)
 * - Address and location
 * - DR number
 * - Equipment serial numbers
 *
 * @param options - Sync options (defaults to Maintenance - Velocity)
 * @returns Sync result with statistics
 */
export async function syncFiberTimeInboundTickets(
  options: FiberTimeSyncOptions = {}
): Promise<SyncInboundResult> {
  const startTime = Date.now();
  const started_at = new Date();

  logger.info('Starting FiberTime inbound sync', {
    assignedTo: options.assignedTo || MAINTENANCE_VELOCITY_ID,
    fetchDetails: options.fetchDetails !== false,
  });

  const stats: SyncStats = {
    total_processed: 0,
    successful: 0,
    failed: 0,
    partial: 0,
    skipped: 0,
    created: 0,
    updated: 0,
  };

  const errors: SyncError[] = [];

  try {
    const client = getDefaultFiberTimeQContactClient();

    // Pagination setup - fetch ALL pages
    const pageSize = options.pageSize || 50;
    let currentPage = options.page || 1;
    let hasMore = true;
    let totalTickets = 0;

    while (hasMore) {
      // Fetch cases from FiberTime QContact
      const response = await client.listCases({
        assignedTo: options.assignedTo || MAINTENANCE_VELOCITY_ID,
        page: currentPage,
        pageSize,
      });

      // QContact API returns total in pagination.count, not response.total
      totalTickets = response.pagination?.count || response.total || 0;

      logger.info('Fetched cases from FiberTime QContact', {
        page: currentPage,
        count: response.results.length,
        total: totalTickets,
      });

      // Process each case on this page
      for (const ftCase of response.results) {
      // For Solved/Unsolved tickets: only process if FF has an open counterpart
      // (reconcile status, but don't create new tickets for already-closed cases)
      if (ftCase.status === 'Solved' || ftCase.status === 'Unsolved - No Response') {
        const existingId = await checkDuplicate(String(ftCase.id));
        if (!existingId) {
          stats.skipped++;
          continue;
        }
        // Existing FF ticket found — check if it still needs closing
        const existing = await queryOne<{ status: string }>(
          'SELECT status FROM maintenance_tickets WHERE id = $1',
          [existingId]
        );
        if (existing && ['resolved', 'closed', 'cancelled'].includes(existing.status)) {
          stats.skipped++;
          continue;
        }
        // FF ticket is still open but QC is closed — fall through to sync
        logger.info('Reconciling closed QC ticket with open FF ticket', {
          qcontactId: ftCase.id,
          ffTicketId: existingId,
          ffStatus: existing?.status,
          qcStatus: ftCase.status,
        });
      }
      stats.total_processed++;

      let qcontactTicket: QContactTicket;

      // Fetch full case details if enabled (default: true)
      if (options.fetchDetails !== false) {
        try {
          const caseDetail = await client.getCase(ftCase.id);
          if (caseDetail) {
            // Use detailed mapping with all fields
            qcontactTicket = mapFiberTimeCaseDetailToQContactTicket(caseDetail);
            logger.debug('Fetched case details', {
              caseId: ftCase.id,
              hasPhone: !!caseDetail.telephone,
              hasAddress: !!caseDetail.address,
              hasDRNumber: !!caseDetail.c__drop_number || !!caseDetail.dr_number,
            });
          } else {
            // Fall back to list view data
            qcontactTicket = mapFiberTimeCaseToQContactTicket(ftCase);
          }
        } catch (detailError) {
          logger.warn('Failed to fetch case details, using list data', {
            caseId: ftCase.id,
            error: detailError instanceof Error ? detailError.message : String(detailError),
          });
          qcontactTicket = mapFiberTimeCaseToQContactTicket(ftCase);
        }
      } else {
        // Use list view data only
        qcontactTicket = mapFiberTimeCaseToQContactTicket(ftCase);
      }

      const result = await syncSingleInboundTicket(qcontactTicket);

      if (result.success) {
        stats.successful++;

        // Track operation type: create, update, or skip
        if (result.operation_type === 'create') {
          stats.created++;
        } else if (result.operation_type === 'update') {
          stats.updated++;
        } else {
          stats.skipped++;
        }
      } else {
        stats.failed++;

        errors.push({
          ticket_id: null,
          qcontact_ticket_id: qcontactTicket.id,
          sync_type: SyncType.CREATE,
          error_message: result.error_message || 'Unknown error',
          error_code: null,
          timestamp: new Date(),
          recoverable: true,
        });
      }
    }

      // Check if there are more pages
      const processedSoFar = currentPage * pageSize;
      hasMore = response.results.length === pageSize && processedSoFar < totalTickets;

      if (hasMore) {
        currentPage++;
        logger.debug('Fetching next page', { nextPage: currentPage, totalTickets });
      }
    } // End of pagination while loop

    const duration_seconds = (Date.now() - startTime) / 1000;
    const completed_at = new Date();

    logger.info('FiberTime inbound sync completed', {
      duration_seconds,
      stats,
      errorCount: errors.length,
    });

    return {
      started_at,
      completed_at,
      duration_seconds,
      total_processed: stats.total_processed,
      successful: stats.successful,
      failed: stats.failed,
      skipped: stats.skipped,
      created: stats.created,
      updated: stats.updated,
      errors,
    };
  } catch (error) {
    const duration_seconds = (Date.now() - startTime) / 1000;
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error('FiberTime inbound sync failed', {
      error: errorMessage,
      duration_seconds,
      stats,
    });

    return {
      started_at,
      completed_at: new Date(),
      duration_seconds,
      total_processed: stats.total_processed,
      successful: stats.successful,
      failed: stats.failed,
      skipped: stats.skipped,
      created: stats.created,
      updated: stats.updated,
      errors: [
        ...errors,
        {
          ticket_id: null,
          qcontact_ticket_id: null,
          sync_type: SyncType.FULL_SYNC,
          error_message: errorMessage,
          error_code: null,
          timestamp: new Date(),
          recoverable: false,
        },
      ],
    };
  }
}
