/**
 * QContact Outbound Sync Service
 * 🟢 WORKING: Production-ready service for pushing ticket updates from FibreFlow to QContact
 *
 * Features:
 * - Push status updates to QContact API
 * - Push assignment changes to QContact
 * - Push notes/comments to QContact
 * - Push ticket closures to QContact
 * - Sync logging with audit trail
 * - Error handling with graceful degradation
 * - Automatic field mapping between FibreFlow and QContact schemas
 *
 * @module maintenance/services/qcontactSyncOutbound
 */

import { queryOne } from '../utils/db';
import { getDefaultFiberTimeQContactClient } from './fibertimeQContactClient';
import { TicketStatus } from '../types/ticket';
import {
  SyncDirection,
  SyncType,
  SyncStatus,
  type SyncOperationResult,
} from '../types/qcontact';
import { mapFibreFlowStatusToQContact } from '../constants/qcontactStatusMapping';
import { createLogger } from '@/lib/logger';

// 🟢 WORKING: Logger instance for sync operations
const logger = createLogger('qcontactSyncOutbound');

// ============================================================================
// Types
// ============================================================================

/**
 * Changes to be synced to QContact
 */
export interface OutboundChanges {
  status?: TicketStatus;
  assigned_to?: string | null;
  note?: string;
}

// Use centralized mapping from qcontactStatusMapping.ts
const mapStatusToQContact = mapFibreFlowStatusToQContact;

// ============================================================================
// Sync Logging Functions
// ============================================================================

/**
 * Create sync log entry in qcontact_sync_log table
 * 🟢 WORKING: Audit trail for all outbound sync operations
 */
async function createSyncLog(
  ticketId: string,
  qcontactTicketId: string | null,
  syncType: SyncType,
  status: SyncStatus,
  requestPayload: Record<string, any> | null,
  responsePayload: Record<string, any> | null,
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
    SyncDirection.OUTBOUND,
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
      ticketId,
      qcontactTicketId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - logging failure shouldn't stop sync
    return '';
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Fetch ticket by ID with QContact external_id
 * 🟢 WORKING: Get ticket details for outbound sync
 */
async function fetchTicketForSync(ticketId: string): Promise<{
  id: string;
  external_id: string | null;
  source: string;
  status?: string;
} | null> {
  const sql = `
    SELECT id, external_id, source, status
    FROM maintenance_tickets
    WHERE id = $1
  `;

  try {
    const result = await queryOne<{
      id: string;
      external_id: string | null;
      source: string;
      status?: string;
    }>(sql, [ticketId]);
    return result;
  } catch (error) {
    logger.error('Failed to fetch ticket for sync', {
      ticketId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Fetch user full name by user ID
 * 🟢 WORKING: Get user details for assignment sync
 */
async function fetchUserName(userId: string | null): Promise<string | null> {
  if (!userId) {
    return null;
  }

  const sql = `
    SELECT full_name
    FROM users
    WHERE id = $1
  `;

  try {
    const result = await queryOne<{ full_name: string }>(sql, [userId]);
    return result?.full_name || null;
  } catch (error) {
    logger.warn('Failed to fetch user name, using ID as fallback', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Return null if user not found (unassignment scenario)
    return null;
  }
}

// ============================================================================
// Push Status Update
// ============================================================================

/**
 * Push status update to QContact
 * 🟢 WORKING: Sync status changes from FibreFlow to QContact
 *
 * @param ticketId - FibreFlow ticket ID
 * @param newStatus - New status value
 * @returns Sync operation result
 */
export async function pushStatusUpdate(
  ticketId: string,
  newStatus: TicketStatus
): Promise<SyncOperationResult> {
  logger.debug('Pushing status update to QContact', {
    ticketId,
    newStatus,
  });

  try {
    // Fetch ticket details
    const ticket = await fetchTicketForSync(ticketId);

    if (!ticket) {
      const errorMsg = 'Ticket not found';
      logger.error(errorMsg, { ticketId });

      return {
        success: false,
        sync_log_id: '',
        ticket_id: ticketId,
        qcontact_ticket_id: null,
        error_message: errorMsg,
        synced_at: new Date(),
      };
    }

    // Skip if ticket doesn't have QContact ID (not from QContact)
    if (!ticket.external_id) {
      logger.info('Ticket has no QContact ID, skipping outbound sync', {
        ticketId,
        source: ticket.source,
      });

      return {
        success: true,
        sync_log_id: '',
        ticket_id: ticketId,
        qcontact_ticket_id: null,
        error_message: 'No QContact ID - ticket not from QContact',
        synced_at: new Date(),
      };
    }

    // Map status to QContact format
    const qcontactStatus = mapStatusToQContact(newStatus);
    const requestPayload = { status: qcontactStatus };

    // Push update to QContact via FiberTime client
    const fibertimeClient = getDefaultFiberTimeQContactClient();
    const response = await fibertimeClient.updateCase(ticket.external_id, requestPayload);

    if (!response.success) {
      throw new Error(response.error || 'Failed to update QContact case');
    }

    // Log successful sync
    const syncLogId = await createSyncLog(
      ticketId,
      ticket.external_id,
      SyncType.STATUS_UPDATE,
      SyncStatus.SUCCESS,
      requestPayload,
      response.data || null,
      null
    );

    logger.info('Status update pushed successfully', {
      ticketId,
      qcontactTicketId: ticket.external_id,
      newStatus: qcontactStatus,
    });

    return {
      success: true,
      sync_log_id: syncLogId,
      ticket_id: ticketId,
      qcontact_ticket_id: ticket.external_id,
      error_message: null,
      synced_at: new Date(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to push status update', {
      ticketId,
      newStatus,
      error: errorMessage,
    });

    // Fetch ticket for logging (may be null)
    const ticket = await fetchTicketForSync(ticketId).catch(() => null);

    // Log failed sync
    await createSyncLog(
      ticketId,
      ticket?.external_id || null,
      SyncType.STATUS_UPDATE,
      SyncStatus.FAILED,
      { status: mapStatusToQContact(newStatus) },
      null,
      errorMessage
    );

    return {
      success: false,
      sync_log_id: '',
      ticket_id: ticketId,
      qcontact_ticket_id: ticket?.external_id || null,
      error_message: errorMessage,
      synced_at: new Date(),
    };
  }
}

// ============================================================================
// Push Assignment
// ============================================================================

/**
 * Push assignment change to QContact
 * 🟢 WORKING: Sync assignment updates from FibreFlow to QContact
 *
 * @param ticketId - FibreFlow ticket ID
 * @param assignedToUserId - User ID assigned to (null for unassignment)
 * @param assignedToName - User full name (optional, fetched if not provided)
 * @returns Sync operation result
 */
export async function pushAssignment(
  ticketId: string,
  assignedToUserId: string | null,
  assignedToName?: string | null
): Promise<SyncOperationResult> {
  logger.debug('Pushing assignment to QContact', {
    ticketId,
    assignedToUserId,
  });

  try {
    // Fetch ticket details
    const ticket = await fetchTicketForSync(ticketId);

    if (!ticket) {
      const errorMsg = 'Ticket not found';
      logger.error(errorMsg, { ticketId });

      return {
        success: false,
        sync_log_id: '',
        ticket_id: ticketId,
        qcontact_ticket_id: null,
        error_message: errorMsg,
        synced_at: new Date(),
      };
    }

    // Skip if ticket doesn't have QContact ID
    if (!ticket.external_id) {
      logger.info('Ticket has no QContact ID, skipping outbound sync', {
        ticketId,
      });

      return {
        success: true,
        sync_log_id: '',
        ticket_id: ticketId,
        qcontact_ticket_id: null,
        error_message: 'No QContact ID - ticket not from QContact',
        synced_at: new Date(),
      };
    }

    // Fetch user name if not provided and user is assigned
    let userName = assignedToName;
    if (assignedToUserId && !userName) {
      userName = await fetchUserName(assignedToUserId);
    }

    const requestPayload = { assigned_to: userName || null };

    // Push update to QContact via FiberTime client
    const fibertimeClient = getDefaultFiberTimeQContactClient();
    const response = await fibertimeClient.updateCase(ticket.external_id, requestPayload);

    if (!response.success) {
      throw new Error(response.error || 'Failed to update QContact assignment');
    }

    // Log successful sync
    const syncLogId = await createSyncLog(
      ticketId,
      ticket.external_id,
      SyncType.ASSIGNMENT,
      SyncStatus.SUCCESS,
      requestPayload,
      response.data || null,
      null
    );

    logger.info('Assignment pushed successfully', {
      ticketId,
      qcontactTicketId: ticket.external_id,
      assignedTo: userName,
    });

    return {
      success: true,
      sync_log_id: syncLogId,
      ticket_id: ticketId,
      qcontact_ticket_id: ticket.external_id,
      error_message: null,
      synced_at: new Date(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to push assignment', {
      ticketId,
      assignedToUserId,
      error: errorMessage,
    });

    // Fetch ticket for logging
    const ticket = await fetchTicketForSync(ticketId).catch(() => null);

    // Log failed sync
    await createSyncLog(
      ticketId,
      ticket?.external_id || null,
      SyncType.ASSIGNMENT,
      SyncStatus.FAILED,
      { assigned_to: assignedToUserId },
      null,
      errorMessage
    );

    return {
      success: false,
      sync_log_id: '',
      ticket_id: ticketId,
      qcontact_ticket_id: ticket?.external_id || null,
      error_message: errorMessage,
      synced_at: new Date(),
    };
  }
}

// ============================================================================
// Push Note
// ============================================================================

/**
 * Push note to QContact
 * 🟢 WORKING: Sync notes/comments from FibreFlow to QContact
 *
 * @param ticketId - FibreFlow ticket ID
 * @param noteContent - Note text content
 * @param isInternal - Whether note is internal only (default: false)
 * @returns Sync operation result
 */
export async function pushNote(
  ticketId: string,
  noteContent: string,
  isInternal: boolean = false
): Promise<SyncOperationResult> {
  logger.debug('Pushing note to QContact', {
    ticketId,
    noteLength: noteContent.length,
    isInternal,
  });

  // Validate note content
  if (!noteContent || noteContent.trim().length === 0) {
    const errorMsg = 'Note content cannot be empty';
    logger.error(errorMsg, { ticketId });

    return {
      success: false,
      sync_log_id: '',
      ticket_id: ticketId,
      qcontact_ticket_id: null,
      error_message: errorMsg,
      synced_at: new Date(),
    };
  }

  try {
    // Fetch ticket details
    const ticket = await fetchTicketForSync(ticketId);

    if (!ticket) {
      const errorMsg = 'Ticket not found';
      logger.error(errorMsg, { ticketId });

      return {
        success: false,
        sync_log_id: '',
        ticket_id: ticketId,
        qcontact_ticket_id: null,
        error_message: errorMsg,
        synced_at: new Date(),
      };
    }

    // Skip if ticket doesn't have QContact ID
    if (!ticket.external_id) {
      logger.info('Ticket has no QContact ID, skipping outbound sync', {
        ticketId,
      });

      return {
        success: true,
        sync_log_id: '',
        ticket_id: ticketId,
        qcontact_ticket_id: null,
        error_message: 'No QContact ID - ticket not from QContact',
        synced_at: new Date(),
      };
    }

    const requestPayload = {
      content: noteContent,
      is_internal: isInternal,
    };

    // Push note to QContact using FiberTime client (correct API format)
    const fibertimeClient = getDefaultFiberTimeQContactClient();
    const response = await fibertimeClient.addNote(ticket.external_id, noteContent, isInternal);

    // Check if the API call succeeded
    if (!response.success) {
      throw new Error(response.error || 'Failed to add note to QContact');
    }

    // Log successful sync
    const syncLogId = await createSyncLog(
      ticketId,
      ticket.external_id,
      SyncType.NOTE_ADD,
      SyncStatus.SUCCESS,
      requestPayload,
      response,
      null
    );

    logger.info('Note pushed successfully', {
      ticketId,
      qcontactTicketId: ticket.external_id,
      noteId: response.noteId,
      isInternal,
    });

    return {
      success: true,
      sync_log_id: syncLogId,
      ticket_id: ticketId,
      qcontact_ticket_id: ticket.external_id,
      error_message: null,
      synced_at: new Date(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to push note', {
      ticketId,
      error: errorMessage,
    });

    // Fetch ticket for logging
    const ticket = await fetchTicketForSync(ticketId).catch(() => null);

    // Log failed sync
    await createSyncLog(
      ticketId,
      ticket?.external_id || null,
      SyncType.NOTE_ADD,
      SyncStatus.FAILED,
      { content: noteContent, is_internal: isInternal },
      null,
      errorMessage
    );

    return {
      success: false,
      sync_log_id: '',
      ticket_id: ticketId,
      qcontact_ticket_id: ticket?.external_id || null,
      error_message: errorMessage,
      synced_at: new Date(),
    };
  }
}

// ============================================================================
// Push Ticket Closure
// ============================================================================

/**
 * Push ticket closure to QContact
 * 🟢 WORKING: Sync ticket closure from FibreFlow to QContact
 *
 * @param ticketId - FibreFlow ticket ID
 * @param closureNote - Optional closure note
 * @returns Sync operation result
 */
export async function pushTicketClosure(
  ticketId: string,
  closureNote?: string
): Promise<SyncOperationResult> {
  logger.debug('Pushing ticket closure to QContact', {
    ticketId,
    hasNote: !!closureNote,
  });

  try {
    // Fetch ticket details
    const ticket = await fetchTicketForSync(ticketId);

    if (!ticket) {
      const errorMsg = 'Ticket not found';
      logger.error(errorMsg, { ticketId });

      return {
        success: false,
        sync_log_id: '',
        ticket_id: ticketId,
        qcontact_ticket_id: null,
        error_message: errorMsg,
        synced_at: new Date(),
      };
    }

    // Skip if ticket doesn't have QContact ID
    if (!ticket.external_id) {
      logger.info('Ticket has no QContact ID, skipping outbound sync', {
        ticketId,
      });

      return {
        success: true,
        sync_log_id: '',
        ticket_id: ticketId,
        qcontact_ticket_id: null,
        error_message: 'No QContact ID - ticket not from QContact',
        synced_at: new Date(),
      };
    }

    const requestPayload = { status: 'Solved' };

    // Push closure status to QContact via FiberTime client
    const fibertimeClient = getDefaultFiberTimeQContactClient();
    const response = await fibertimeClient.updateCase(ticket.external_id, requestPayload);

    if (!response.success) {
      throw new Error(response.error || 'Failed to close QContact case');
    }

    // Add closure note if provided
    if (closureNote && closureNote.trim().length > 0) {
      await fibertimeClient.addNote(ticket.external_id, closureNote, false);
    }

    // Log successful sync
    const syncLogId = await createSyncLog(
      ticketId,
      ticket.external_id,
      SyncType.STATUS_UPDATE,
      SyncStatus.SUCCESS,
      { ...requestPayload, closure_note: closureNote || null },
      response.data || null,
      null
    );

    logger.info('Ticket closure pushed successfully', {
      ticketId,
      qcontactTicketId: ticket.external_id,
      hasNote: !!closureNote,
    });

    return {
      success: true,
      sync_log_id: syncLogId,
      ticket_id: ticketId,
      qcontact_ticket_id: ticket.external_id,
      error_message: null,
      synced_at: new Date(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to push ticket closure', {
      ticketId,
      error: errorMessage,
    });

    // Fetch ticket for logging
    const ticket = await fetchTicketForSync(ticketId).catch(() => null);

    // Log failed sync
    await createSyncLog(
      ticketId,
      ticket?.external_id || null,
      SyncType.STATUS_UPDATE,
      SyncStatus.FAILED,
      { status: 'closed', closure_note: closureNote || null },
      null,
      errorMessage
    );

    return {
      success: false,
      sync_log_id: '',
      ticket_id: ticketId,
      qcontact_ticket_id: ticket?.external_id || null,
      error_message: errorMessage,
      synced_at: new Date(),
    };
  }
}

// ============================================================================
// Automatic Sync on Update
// ============================================================================

/**
 * Automatically sync outbound updates when ticket changes
 * 🟢 WORKING: Detect changes and push to QContact
 *
 * @param ticketId - FibreFlow ticket ID
 * @param changes - Changes made to the ticket
 * @returns Sync operation result
 */
export async function syncOutboundUpdate(
  ticketId: string,
  changes: OutboundChanges
): Promise<SyncOperationResult> {
  logger.debug('Syncing outbound update', {
    ticketId,
    changes: Object.keys(changes),
  });

  try {
    // Fetch ticket details
    const ticket = await fetchTicketForSync(ticketId);

    if (!ticket || !ticket.external_id) {
      logger.info('Ticket has no QContact ID, skipping outbound sync', {
        ticketId,
      });

      return {
        success: true,
        sync_log_id: '',
        ticket_id: ticketId,
        qcontact_ticket_id: null,
        error_message: 'No QContact ID - ticket not from QContact',
        synced_at: new Date(),
      };
    }

    // Build QContact update payload
    const qcontactPayload: Record<string, any> = {};

    if (changes.status !== undefined) {
      qcontactPayload.status = mapStatusToQContact(changes.status);
    }

    if (changes.assigned_to !== undefined) {
      const userName = await fetchUserName(changes.assigned_to);
      qcontactPayload.assigned_to = userName;
    }

    // Push update to QContact if there are changes
    if (Object.keys(qcontactPayload).length > 0) {
      const fibertimeClient = getDefaultFiberTimeQContactClient();
      const response = await fibertimeClient.updateCase(ticket.external_id, qcontactPayload);

      if (!response.success) {
        throw new Error(response.error || 'Failed to update QContact case');
      }

      // Log successful sync
      const syncLogId = await createSyncLog(
        ticketId,
        ticket.external_id,
        SyncType.STATUS_UPDATE,
        SyncStatus.SUCCESS,
        qcontactPayload,
        response.data || null,
        null
      );

      logger.info('Outbound update synced successfully', {
        ticketId,
        qcontactTicketId: ticket.external_id,
        changes: Object.keys(qcontactPayload),
      });

      return {
        success: true,
        sync_log_id: syncLogId,
        ticket_id: ticketId,
        qcontact_ticket_id: ticket.external_id,
        error_message: null,
        synced_at: new Date(),
      };
    }

    // No changes to sync
    return {
      success: true,
      sync_log_id: '',
      ticket_id: ticketId,
      qcontact_ticket_id: ticket.external_id,
      error_message: 'No changes to sync',
      synced_at: new Date(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to sync outbound update', {
      ticketId,
      error: errorMessage,
    });

    // Fetch ticket for logging
    const ticket = await fetchTicketForSync(ticketId).catch(() => null);

    // Log failed sync
    await createSyncLog(
      ticketId,
      ticket?.external_id || null,
      SyncType.STATUS_UPDATE,
      SyncStatus.FAILED,
      changes,
      null,
      errorMessage
    );

    return {
      success: false,
      sync_log_id: '',
      ticket_id: ticketId,
      qcontact_ticket_id: ticket?.external_id || null,
      error_message: errorMessage,
      synced_at: new Date(),
    };
  }
}
