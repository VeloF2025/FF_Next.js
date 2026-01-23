/**
 * WhatsApp Maintenance Message Processor
 *
 * Processes incoming WhatsApp messages from maintenance QA groups:
 * - Extracts DR numbers from message text
 * - Tracks sender context for photo association
 * - Creates maintenance flags for flagged DRs
 * - Handles photo metadata storage
 *
 * @module maintenance/services/waMaintenanceProcessor
 */

import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';

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
  media?: {
    type: string;
    mime_type: string;
    data: string; // Base64
    filename?: string;
  }[];
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

// Target group JID for Mohadin QA
const MAINTENANCE_GROUP_JID =
  process.env.MAINTENANCE_WA_GROUP_JID || '120363424360693693@g.us';

// DR number regex pattern (DR followed by 6-8 digits)
const DR_PATTERN = /\bDR(\d{6,8})\b/gi;

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
// DR Extraction
// ============================================================================

/**
 * Extract all DR numbers from message text
 */
export function extractDRNumbers(text: string | null | undefined): string[] {
  if (!text) return [];

  const matches = text.match(DR_PATTERN);
  if (!matches) return [];

  // Normalize to uppercase and deduplicate
  const normalized = matches.map((m) => m.toUpperCase());
  return [...new Set(normalized)];
}

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

  return {
    sender_jid: result[0].sender_jid,
    last_drop_number: result[0].last_drop_number,
    last_drop_timestamp: result[0].last_drop_timestamp,
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

  return result[0].id;
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
  photo: IncomingWAMessage['media'][0],
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

  return result[0].id;
}

// ============================================================================
// Main Message Processor
// ============================================================================

/**
 * Process an incoming WhatsApp message from the maintenance group
 *
 * Flow:
 * 1. Check if message is from the monitored group
 * 2. Extract any DR numbers from the message text
 * 3. If no DR in text, check sender context for recent DR mention
 * 4. Store the message with DR association
 * 5. If photos present, store photo metadata
 * 6. Update sender context if DR was mentioned
 * 7. Auto-create maintenance flag via trigger
 */
export async function processMaintenanceMessage(
  message: IncomingWAMessage
): Promise<ProcessedMessage> {
  const logger = createLogger('waMaintenanceProcessor');

  // Validate group
  if (message.group_jid !== MAINTENANCE_GROUP_JID) {
    logger.warn(
      { groupJid: message.group_jid, expected: MAINTENANCE_GROUP_JID },
      'Message from unexpected group, ignoring'
    );
    throw new Error(`Message from unexpected group: ${message.group_jid}`);
  }

  const messageTimestamp = new Date(message.timestamp);

  // Step 1: Extract DRs from message text
  const extractedDRs = extractDRNumbers(message.text);
  const drMentionedDirectly = extractedDRs.length > 0;

  // Step 2: Determine which DR to associate with this message
  let dropNumber: string | null = null;

  if (drMentionedDirectly) {
    // Use the first DR mentioned (could be enhanced to handle multiple)
    dropNumber = extractedDRs[0];

    // Update sender context
    await updateSenderContext(
      message.group_jid,
      message.sender_jid,
      dropNumber,
      messageTimestamp
    );

    logger.info(
      { dropNumber, sender: message.sender_jid },
      'DR mentioned directly in message'
    );
  } else if (message.has_media) {
    // No DR in text but has media - check sender context
    const context = await getSenderContext(
      message.group_jid,
      message.sender_jid
    );

    if (context?.last_drop_number) {
      dropNumber = context.last_drop_number;
      logger.info(
        {
          dropNumber,
          sender: message.sender_jid,
          contextAge: Math.round(
            (Date.now() - (context.last_drop_timestamp?.getTime() || 0)) / 1000
          ),
        },
        'Photo associated with DR via sender context'
      );
    } else {
      logger.warn(
        { sender: message.sender_jid },
        'Photo received with no DR context - storing as unassociated'
      );
    }
  }

  // Step 3: Store the message
  const messageId = await storeMessage(
    message,
    dropNumber,
    drMentionedDirectly
  );

  // Step 4: Store photo metadata if present
  let photosCount = 0;
  if (message.has_media && message.media && dropNumber) {
    for (let i = 0; i < message.media.length; i++) {
      const photo = message.media[i];
      if (photo.type === 'image' || photo.mime_type?.startsWith('image/')) {
        await storePhotoMetadata(messageId, dropNumber, photo, i);
        photosCount++;
      }
    }
  }

  // The trigger auto_create_maintenance_flag handles creating/updating
  // the dr_maintenance_flags record

  logger.info(
    {
      messageId,
      dropNumber,
      drMentionedDirectly,
      photosCount,
      sender: message.sender_name || message.sender_jid,
    },
    'Maintenance message processed'
  );

  return {
    id: messageId,
    drop_number: dropNumber,
    dr_mentioned_directly: drMentionedDirectly,
    photos_count: photosCount,
    maintenance_flag_created: drMentionedDirectly && dropNumber !== null,
  };
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
