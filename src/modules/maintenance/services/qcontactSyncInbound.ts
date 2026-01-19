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
 * @module ticketing/services/qcontactSyncInbound
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
import type { QContactTicket } from '../types/qcontact';
import type { CreateTicketPayload } from '../types/ticket';
import {
  TicketSource,
  TicketType,
  TicketPriority,
} from '../types/ticket';
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
 * Map QContact category to FibreFlow ticket type
 * 🟢 WORKING: Category to ticket_type conversion
 * Note: Database constraint allows: fault, maintenance, installation, query, complaint, other
 */
function mapTicketType(category: string | null): string {
  if (!category) {
    return 'maintenance';
  }

  const categoryLower = category.toLowerCase();

  // Map FiberTime categories to valid database types
  if (categoryLower.includes('connectivity') || categoryLower.includes('fault') || categoryLower.includes('ont')) {
    return 'fault';
  }
  if (categoryLower.includes('maintenance') || categoryLower.includes('follow-up') || categoryLower.includes('move')) {
    return 'maintenance';
  }
  if (categoryLower.includes('installation') || categoryLower.includes('new')) {
    return 'installation';
  }
  if (categoryLower.includes('query') || categoryLower.includes('question')) {
    return 'query';
  }
  if (categoryLower.includes('complaint')) {
    return 'complaint';
  }

  return 'other';
}

/**
 * Extended ticket payload with all QContact fields
 */
export interface ExtendedTicketPayload extends CreateTicketPayload {
  client_name?: string;
  client_contact?: string;
  client_email?: string;
  gps_coordinates?: string;
  ont_serial?: string;
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

  const payload: ExtendedTicketPayload = {
    source: TicketSource.QCONTACT,
    external_id: qcontactTicket.id,
    title: qcontactTicket.title,
    description: qcontactTicket.description || undefined,
    ticket_type: mapTicketType(qcontactTicket.category),
    priority: mapPriority(qcontactTicket.priority),
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
  requestPayload: Record<string, any> | null,
  responsePayload: Record<string, any> | null,
  errorMessage: string | null
): Promise<string> {
  const sql = `
    INSERT INTO qcontact_sync_log (
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
    FROM tickets
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
 * 🟢 WORKING: Creates ticket or skips if duplicate exists
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
      logger.info('Ticket already exists, skipping', {
        qcontactTicketId: qcontactTicket.id,
        existingTicketId,
      });

      return {
        success: true,
        sync_log_id: '', // No log created for skipped tickets
        ticket_id: existingTicketId,
        qcontact_ticket_id: qcontactTicket.id,
        error_message: null,
        synced_at: new Date(),
      };
    }

    // Map QContact ticket to FibreFlow format
    const ticketPayload = mapQContactTicketToFibreFlow(qcontactTicket);

    // Create ticket in FibreFlow with all available fields
    // Note: Database uses 'type' not 'ticket_type', 'zone' not 'zone_id', 'pon' not 'pon_number'
    const sql = `
      INSERT INTO tickets (
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
        created_by
      ) VALUES (
        'FF' || LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0'),
        $1, $2, $3, $4, $5, $6, 'new', $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
      )
      RETURNING *
    `;

    const values = [
      ticketPayload.source,
      ticketPayload.external_id,
      ticketPayload.title,
      ticketPayload.description || null,
      ticketPayload.ticket_type,
      ticketPayload.priority,
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
      QCONTACT_SYSTEM_USER_ID,
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

          // Check if it was a new ticket (has sync_log_id) or existing (skipped)
          if (result.sync_log_id && result.sync_log_id !== '') {
            stats.created++;
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

    // Fetch cases from FiberTime QContact
    const response = await client.listCases({
      assignedTo: options.assignedTo || MAINTENANCE_VELOCITY_ID,
      page: options.page || 1,
      pageSize: options.pageSize || 50,
    });

    logger.info('Fetched cases from FiberTime QContact', {
      count: response.results.length,
      total: response.total,
    });

    // Process each case
    for (const ftCase of response.results) {
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

        if (result.sync_log_id && result.sync_log_id !== '') {
          stats.created++;
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
