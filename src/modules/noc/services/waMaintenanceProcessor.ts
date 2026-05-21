/**
 * WhatsApp Maintenance Message Processor
 *
 * Processes incoming WhatsApp messages from every active monitored group
 * (wa_monitored_groups) and:
 * - Extracts DR numbers and ONT serials
 * - Tracks sender context for photo association
 * - Creates maintenance flags for flagged DRs
 * - Stores message + photo metadata
 * - Links the message to open maintenance tickets and the DR lifecycle log
 *
 * @module maintenance/services/waMaintenanceProcessor
 */

import { neon } from '@/lib/db-neon';
import { createLogger } from '@/lib/logger';
import { resolveMonitoredGroup } from './waGroupResolver';
import {
  extractDRNumbers as extractDRNumbersFromText,
  extractOntSerials,
} from './waReferenceExtractor';
import {
  findOpenTicketsByDR,
  findOpenTicketsByOntSerial,
  linkMessageToTicket,
  linkPhotoToTicket,
  logDrActivityForMention,
  resolveDropFromSerial,
  type LinkContext,
  type OpenTicket,
} from './waTicketLinker';

// ============================================================================
// Types
// ============================================================================

export interface IncomingWAMessage {
  message_id: string;
  group_jid: string;
  sender_jid: string;
  sender_name?: string;
  text?: string;
  timestamp: string;
  has_media: boolean;
  media?: MediaItem[];
}

export interface MediaItem {
  type: string;
  mime_type: string;
  data: string; // Base64
  filename?: string;
}

export interface ProcessedMessage {
  id: string;
  drop_number: string | null;
  dr_mentioned_directly: boolean;
  photos_count: number;
  maintenance_flag_created: boolean;
}

export interface SenderContext {
  sender_jid: string;
  last_drop_number: string | null;
  last_drop_timestamp: Date | null;
}

// ============================================================================
// Configuration
// ============================================================================

// Context window for associating photos with DRs (in minutes)
const CONTEXT_WINDOW_MINUTES = parseInt(
  process.env.MAINTENANCE_WA_CONTEXT_WINDOW_MINUTES || '5',
  10
);

// ============================================================================
// Database Connection
// ============================================================================

function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return neon(databaseUrl);
}

// ============================================================================
// DR Extraction (re-exported for back-compat with existing callers)
// ============================================================================

/** @deprecated Import extractDRNumbers from './waReferenceExtractor' instead. */
export const extractDRNumbers = extractDRNumbersFromText;

// ============================================================================
// Sender Context Management
// ============================================================================

/**
 * Get the last DR mentioned by a sender within the context window
 */
export async function getSenderContext(
  groupJid: string,
  senderJid: string
): Promise<SenderContext | null> {
  const sql = getDb();

  // Calculate the cutoff timestamp in JavaScript
  const cutoffTime = new Date(Date.now() - CONTEXT_WINDOW_MINUTES * 60 * 1000);

  const result = await sql`
    SELECT sender_jid, last_drop_number, last_drop_timestamp
    FROM maintenance_wa_sender_context
    WHERE wa_group_jid = ${groupJid}
      AND sender_jid = ${senderJid}
      AND last_drop_timestamp > ${cutoffTime}
  `;

  if (result.length === 0) return null;

  const row = result[0] as {
    sender_jid: string;
    last_drop_number: string | null;
    last_drop_timestamp: Date | null;
  };

  return {
    sender_jid: row.sender_jid,
    last_drop_number: row.last_drop_number,
    last_drop_timestamp: row.last_drop_timestamp,
  };
}

/**
 * Update the sender's context with a new DR mention
 */
export async function updateSenderContext(
  groupJid: string,
  senderJid: string,
  dropNumber: string,
  timestamp: Date
): Promise<void> {
  const sql = getDb();

  await sql`
    INSERT INTO maintenance_wa_sender_context (
      wa_group_jid, sender_jid, last_drop_number, last_drop_timestamp
    ) VALUES (
      ${groupJid}, ${senderJid}, ${dropNumber}, ${timestamp}
    )
    ON CONFLICT (wa_group_jid, sender_jid) DO UPDATE SET
      last_drop_number = ${dropNumber},
      last_drop_timestamp = ${timestamp},
      updated_at = NOW()
  `;
}

// ============================================================================
// Message Storage
// ============================================================================

/**
 * Store a WhatsApp message in the database
 */
export async function storeMessage(
  message: IncomingWAMessage,
  dropNumber: string | null,
  drMentionedDirectly: boolean,
  project: string = 'Mohadin'
): Promise<string> {
  const sql = getDb();

  const result = await sql`
    INSERT INTO maintenance_wa_messages (
      wa_message_id,
      wa_group_jid,
      sender_jid,
      sender_name,
      message_text,
      message_timestamp,
      drop_number,
      dr_mentioned_directly,
      project,
      has_media,
      media_type,
      media_count
    ) VALUES (
      ${message.message_id},
      ${message.group_jid},
      ${message.sender_jid},
      ${message.sender_name || null},
      ${message.text || null},
      ${message.timestamp},
      ${dropNumber},
      ${drMentionedDirectly},
      ${project},
      ${message.has_media},
      ${message.media?.[0]?.type || null},
      ${message.media?.length || 0}
    )
    ON CONFLICT (wa_message_id) DO UPDATE SET
      updated_at = NOW()
    RETURNING id
  `;

  return (result[0] as { id: string }).id;
}

// ============================================================================
// Photo Storage
// ============================================================================

/**
 * Store photo metadata (actual upload handled separately)
 */
export async function storePhotoMetadata(
  messageId: string,
  dropNumber: string,
  photo: MediaItem,
  index: number,
  project: string = 'Mohadin'
): Promise<string> {
  const sql = getDb();

  const result = await sql`
    INSERT INTO maintenance_wa_photos (
      message_id,
      drop_number,
      project,
      wa_media_id,
      original_filename,
      mime_type,
      photo_source,
      photo_index,
      upload_status
    ) VALUES (
      ${messageId},
      ${dropNumber},
      ${project},
      ${photo.filename || `photo_${index}`},
      ${photo.filename || null},
      ${photo.mime_type},
      'whatsapp_maintenance',
      ${index + 1},
      'pending'
    )
    RETURNING id
  `;

  return (result[0] as { id: string }).id;
}

// ============================================================================
// Main Message Processor
// ============================================================================

/**
 * Process an incoming WhatsApp message from any active monitored group.
 *
 * Flow:
 *  1. Resolve group_jid against wa_monitored_groups (drops unknown groups).
 *  2. Extract DR numbers and ONT serials from message text.
 *  3. If no DR found, attempt serial-fallback: drops.ont_serial -> drop_number.
 *  4. Fall back to sender context for media-only messages.
 *  5. Persist the message and any photo metadata.
 *  6. Link the message to every open maintenance ticket for the resolved DR
 *     (or the resolved ONT serial when no DR was found).
 *  7. Always write a dr_activity_log entry when a DR is in play, even when no
 *     open ticket matches.
 *  8. Stamp each linked photo with ticket_id and mirror it into
 *     maintenance_attachments.
 */
export async function processMaintenanceMessage(
  message: IncomingWAMessage
): Promise<ProcessedMessage> {
  const logger = createLogger('waMaintenanceProcessor');

  // Validate group via wa_monitored_groups (replaces the old hard-coded set).
  const group = await resolveMonitoredGroup(message.group_jid);
  if (!group) {
    logger.warn(
      'Message from unmonitored group, ignoring',
      { groupJid: message.group_jid }
    );
    throw new Error(`Message from unmonitored group: ${message.group_jid}`);
  }

  const project = group.project_name ?? 'Unassigned';
  const messageTimestamp = new Date(message.timestamp);

  // Step 1: Extract DRs and ONT serials from message text.
  const extractedDRs = extractDRNumbersFromText(message.text);
  const extractedSerials = extractOntSerials(message.text);
  const drMentionedDirectly = extractedDRs.length > 0;

  // Step 2: Resolve drop_number from the message itself.
  let dropNumber: string | null = null;
  let dropResolvedVia: 'text' | 'serial' | 'sender_context' | null = null;

  if (drMentionedDirectly && extractedDRs[0]) {
    dropNumber = extractedDRs[0];
    dropResolvedVia = 'text';
    await updateSenderContext(
      message.group_jid,
      message.sender_jid,
      dropNumber,
      messageTimestamp
    );
    logger.info('DR mentioned directly in message', {
      dropNumber,
      sender: message.sender_jid,
    });
  } else if (extractedSerials.length > 0 && extractedSerials[0]) {
    // ONT serial fallback: serial -> drops.ont_serial -> drop_number.
    const resolved = await resolveDropFromSerial(extractedSerials[0]);
    if (resolved) {
      dropNumber = resolved;
      dropResolvedVia = 'serial';
      logger.info('DR resolved via ONT serial fallback', {
        serial: extractedSerials[0],
        dropNumber,
      });
    }
  }

  // Step 3: Sender-context fallback for media-only messages.
  if (!dropNumber && message.has_media) {
    const context = await getSenderContext(message.group_jid, message.sender_jid);
    if (context?.last_drop_number) {
      dropNumber = context.last_drop_number;
      dropResolvedVia = 'sender_context';
      logger.info('Photo associated with DR via sender context', {
        dropNumber,
        sender: message.sender_jid,
        contextAge: Math.round(
          (Date.now() - (context.last_drop_timestamp?.getTime() || 0)) / 1000
        ),
      });
    } else {
      logger.warn('Photo received with no DR context - storing as unassociated', {
        sender: message.sender_jid,
      });
    }
  }

  // Step 4: Persist the message and any photos.
  const messageId = await storeMessage(message, dropNumber, drMentionedDirectly, project);

  let photosCount = 0;
  const photoIds: string[] = [];
  if (message.has_media && message.media && dropNumber) {
    for (let i = 0; i < message.media.length; i++) {
      const photo = message.media[i];
      if (!photo) continue;
      if (photo.type === 'image' || photo.mime_type?.startsWith('image/')) {
        const photoId = await storePhotoMetadata(messageId, dropNumber, photo, i, project);
        photoIds.push(photoId);
        photosCount++;
      }
    }
  }

  // Step 5: Build the shared LinkContext once for all writers.
  const linkCtx: LinkContext = {
    wa_message_id: message.message_id,
    group_jid: message.group_jid,
    group_name: group.group_name,
    sender_jid: message.sender_jid,
    sender_name: message.sender_name ?? null,
    message_text: message.text ?? null,
    message_timestamp: messageTimestamp,
    project,
  };

  // Step 6: Resolve open tickets and write per-ticket linkage rows.
  const openTickets = await collectOpenTickets(dropNumber, extractedSerials);
  for (const ticket of openTickets) {
    await linkMessageToTicket(ticket, linkCtx, dropNumber);
    for (const photoId of photoIds) {
      await linkPhotoToTicket(photoId, ticket, linkCtx);
    }
  }

  // Step 7: DR lifecycle entry (written whether or not any ticket matched).
  if (dropNumber) {
    await logDrActivityForMention(
      dropNumber,
      linkCtx,
      openTickets.map((t) => t.id)
    );
  }

  logger.info('Maintenance message processed', {
    messageId,
    dropNumber,
    dropResolvedVia,
    drMentionedDirectly,
    serialsExtracted: extractedSerials.length,
    photosCount,
    openTicketsLinked: openTickets.length,
    sender: message.sender_name || message.sender_jid,
  });

  return {
    id: messageId,
    drop_number: dropNumber,
    dr_mentioned_directly: drMentionedDirectly,
    photos_count: photosCount,
    maintenance_flag_created: drMentionedDirectly && dropNumber !== null,
  };
}

/**
 * Build the union of open tickets matched by drop_number (preferred) and by
 * ONT serial (fallback). Deduplicates by ticket id so a ticket matched on both
 * legs only produces one note + activity row pair.
 */
async function collectOpenTickets(
  dropNumber: string | null,
  serials: string[]
): Promise<OpenTicket[]> {
  const byId = new Map<string, OpenTicket>();

  if (dropNumber) {
    for (const t of await findOpenTicketsByDR(dropNumber)) {
      byId.set(t.id, t);
    }
  }

  for (const serial of serials) {
    for (const t of await findOpenTicketsByOntSerial(serial)) {
      if (!byId.has(t.id)) byId.set(t.id, t);
    }
  }

  return [...byId.values()];
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Get all maintenance messages for a specific DR
 */
export async function getMessagesForDR(
  dropNumber: string
): Promise<Array<{
  id: string;
  message_text: string;
  sender_name: string;
  message_timestamp: Date;
  has_media: boolean;
  photo_count: number;
}>> {
  const sql = getDb();

  const results = await sql`
    SELECT
      m.id,
      m.message_text,
      m.sender_name,
      m.message_timestamp,
      m.has_media,
      (SELECT COUNT(*) FROM maintenance_wa_photos p WHERE p.message_id = m.id) as photo_count
    FROM maintenance_wa_messages m
    WHERE m.drop_number = ${dropNumber}
    ORDER BY m.message_timestamp ASC
  `;

  return results as Array<{
    id: string;
    message_text: string;
    sender_name: string;
    message_timestamp: Date;
    has_media: boolean;
    photo_count: number;
  }>;
}

/**
 * Get maintenance flag status for a DR
 */
export async function getMaintenanceFlag(dropNumber: string) {
  const sql = getDb();

  const result = await sql`
    SELECT *
    FROM dr_maintenance_flags
    WHERE drop_number = ${dropNumber}
  `;

  return result[0] || null;
}

/**
 * Get photos for a DR
 */
export async function getPhotosForDR(dropNumber: string) {
  const sql = getDb();

  return sql`
    SELECT *
    FROM maintenance_wa_photos
    WHERE drop_number = ${dropNumber}
    ORDER BY created_at ASC
  `;
}

/**
 * Get flagged DRs with pagination
 */
export async function getFlaggedDRs(options: {
  project?: string;
  status?: string;
  limit?: number;
  offset?: number;
}) {
  const sql = getDb();
  const { project, status, limit = 50, offset = 0 } = options;

  // Build dynamic query
  if (project && status) {
    return sql`
      SELECT
        f.*,
        (SELECT message_text FROM maintenance_wa_messages m
         WHERE m.drop_number = f.drop_number
         ORDER BY m.message_timestamp DESC LIMIT 1) as latest_message
      FROM dr_maintenance_flags f
      WHERE f.project = ${project}
        AND f.issue_status = ${status}
      ORDER BY f.last_activity_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else if (project) {
    return sql`
      SELECT
        f.*,
        (SELECT message_text FROM maintenance_wa_messages m
         WHERE m.drop_number = f.drop_number
         ORDER BY m.message_timestamp DESC LIMIT 1) as latest_message
      FROM dr_maintenance_flags f
      WHERE f.project = ${project}
      ORDER BY f.last_activity_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else if (status) {
    return sql`
      SELECT
        f.*,
        (SELECT message_text FROM maintenance_wa_messages m
         WHERE m.drop_number = f.drop_number
         ORDER BY m.message_timestamp DESC LIMIT 1) as latest_message
      FROM dr_maintenance_flags f
      WHERE f.issue_status = ${status}
      ORDER BY f.last_activity_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    return sql`
      SELECT
        f.*,
        (SELECT message_text FROM maintenance_wa_messages m
         WHERE m.drop_number = f.drop_number
         ORDER BY m.message_timestamp DESC LIMIT 1) as latest_message
      FROM dr_maintenance_flags f
      ORDER BY f.last_activity_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }
}

// ============================================================================
// Status Updates
// ============================================================================

/**
 * Update the status of a maintenance flag
 */
export async function updateMaintenanceFlagStatus(
  dropNumber: string,
  status: 'flagged' | 'reviewing' | 'ticket_created' | 'resolved',
  ticketId?: string
): Promise<void> {
  const sql = getDb();

  await sql`
    UPDATE dr_maintenance_flags
    SET
      issue_status = ${status},
      maintenance_ticket_id = COALESCE(${ticketId || null}, maintenance_ticket_id),
      resolved_at = CASE WHEN ${status} = 'resolved' THEN NOW() ELSE resolved_at END,
      updated_at = NOW()
    WHERE drop_number = ${dropNumber}
  `;
}
