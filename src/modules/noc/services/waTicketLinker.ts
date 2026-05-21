/**
 * Links inbound WA messages (DR / ONT-serial mentions, plus their photos) to
 * the maintenance ticket and DR-lifecycle layer.
 *
 * Writers:
 *   * maintenance_notes      (per-ticket comment, note_type='wa_mention')
 *   * maintenance_activities (per-ticket lifecycle, activity_type='wa_mention')
 *   * dr_activity_log        (per-drop_number, event_type='WA_DR_MENTION') —
 *                             written even when no open ticket exists
 *   * maintenance_wa_photos.ticket_id + maintenance_attachments (photo link)
 *
 * Idempotency: each writer uses ON CONFLICT DO NOTHING against the partial
 * unique indexes from migration 363 so the cron's re-emits never duplicate.
 *
 * @module noc/services/waTicketLinker
 */

import { neon } from '@/lib/db-neon';
import { createLogger } from '@/lib/logger';

const logger = createLogger('waTicketLinker');

// system@fibreflow.app — the bot account used as the author of WA-mention
// notes and attachments. Override via WA_BRIDGE_SYSTEM_USER_ID env var so
// future environments can point at a different bot user.
const SYSTEM_USER_ID =
  process.env.WA_BRIDGE_SYSTEM_USER_ID ?? '81abd560-48ae-414e-ad31-9d82f1a9ed49';

export interface OpenTicket {
  id: string;
  ticket_uid: string;
  status: string;
  dr_number: string | null;
  ont_serial: string | null;
}

export interface LinkContext {
  wa_message_id: string;
  group_jid: string;
  group_name: string;
  sender_jid: string;
  sender_name: string | null;
  message_text: string | null;
  message_timestamp: Date;
  project: string | null;
}

function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return neon(databaseUrl);
}

/**
 * Open tickets for a dr_number. Returns at most a few rows in practice.
 * `verified` is treated as terminal (post-QA approval) and excluded.
 */
export async function findOpenTicketsByDR(
  dropNumber: string
): Promise<OpenTicket[]> {
  const sql = getDb();
  const rows = (await sql`
    SELECT id, ticket_uid, status, dr_number, ont_serial
    FROM maintenance_tickets
    WHERE dr_number = ${dropNumber}
      AND status NOT IN ('closed', 'resolved', 'cancelled', 'verified')
    ORDER BY created_at DESC
  `) as OpenTicket[];
  return rows;
}

/**
 * Open tickets that reference a given ONT serial directly. Used as the
 * serial-only fallback when no DR could be extracted/resolved.
 */
export async function findOpenTicketsByOntSerial(
  serial: string
): Promise<OpenTicket[]> {
  const sql = getDb();
  const rows = (await sql`
    SELECT id, ticket_uid, status, dr_number, ont_serial
    FROM maintenance_tickets
    WHERE ont_serial = ${serial}
      AND status NOT IN ('closed', 'resolved', 'cancelled', 'verified')
    ORDER BY created_at DESC
  `) as OpenTicket[];
  return rows;
}

/**
 * Look up a drop_number from an ONT serial via the drops table. Used to turn
 * serial-only messages into DR-linked ones before ticket resolution.
 */
export async function resolveDropFromSerial(serial: string): Promise<string | null> {
  const sql = getDb();
  const rows = (await sql`
    SELECT drop_number FROM drops WHERE ont_serial = ${serial} LIMIT 1
  `) as Array<{ drop_number: string | null }>;
  return rows[0]?.drop_number ?? null;
}

function buildNoteContent(ctx: LinkContext): string {
  const sender = ctx.sender_name ?? ctx.sender_jid;
  const body = (ctx.message_text ?? '').trim();
  const header = `[WA · ${ctx.group_name}] ${sender} @ ${ctx.message_timestamp.toISOString()}`;
  return body.length > 0 ? `${header}\n${body}` : header;
}

function buildActivityDescription(ctx: LinkContext, dropNumber: string | null): string {
  const sender = ctx.sender_name ?? ctx.sender_jid;
  const ref = dropNumber ? ` (${dropNumber})` : '';
  return `WA mention from ${ctx.group_name} by ${sender}${ref}`;
}

/**
 * Insert a maintenance_notes + maintenance_activities row pair for one open
 * ticket. Returns true if a new note row was created (i.e. not a re-emit).
 */
export async function linkMessageToTicket(
  ticket: OpenTicket,
  ctx: LinkContext,
  dropNumber: string | null
): Promise<boolean> {
  const sql = getDb();

  const noteRows = (await sql`
    INSERT INTO maintenance_notes (
      ticket_id, content, note_type, visibility, wa_message_id
    ) VALUES (
      ${ticket.id},
      ${buildNoteContent(ctx)},
      'wa_mention',
      'private',
      ${ctx.wa_message_id}
    )
    ON CONFLICT (ticket_id, wa_message_id)
      WHERE wa_message_id IS NOT NULL
      DO NOTHING
    RETURNING id
  `) as Array<{ id: string }>;

  const wasInserted = noteRows.length > 0;

  await sql`
    INSERT INTO maintenance_activities (
      ticket_id, external_id, activity_type, description, field_changes, source, created_by_name
    ) VALUES (
      ${ticket.id},
      ${ctx.wa_message_id},
      'wa_mention',
      ${buildActivityDescription(ctx, dropNumber)},
      ${JSON.stringify({
        wa_group_jid: ctx.group_jid,
        wa_group_name: ctx.group_name,
        sender_jid: ctx.sender_jid,
        sender_name: ctx.sender_name,
        drop_number: dropNumber,
      })}::jsonb,
      'wa-bridge',
      ${ctx.sender_name ?? ctx.sender_jid}
    )
    ON CONFLICT (ticket_id, external_id)
      WHERE activity_type = 'wa_mention' AND external_id IS NOT NULL
      DO NOTHING
  `;

  if (wasInserted) {
    logger.info('WA mention linked to ticket', {
      ticketUid: ticket.ticket_uid,
      dropNumber,
      waMessageId: ctx.wa_message_id,
    });
  }

  return wasInserted;
}

/**
 * Always-write DR-lifecycle entry. Fires whether or not an open ticket exists,
 * so historic discussion of completed drops is still captured.
 */
export async function logDrActivityForMention(
  dropNumber: string,
  ctx: LinkContext,
  linkedTicketIds: string[]
): Promise<void> {
  const sql = getDb();

  await sql`
    INSERT INTO dr_activity_log (drop_number, event_type, event_data, actor)
    VALUES (
      ${dropNumber},
      'WA_DR_MENTION',
      ${JSON.stringify({
        wa_message_id: ctx.wa_message_id,
        wa_group_jid: ctx.group_jid,
        wa_group_name: ctx.group_name,
        sender_jid: ctx.sender_jid,
        sender_name: ctx.sender_name,
        project: ctx.project,
        message_text: ctx.message_text,
        message_timestamp: ctx.message_timestamp.toISOString(),
        linked_ticket_ids: linkedTicketIds,
      })}::jsonb,
      ${ctx.sender_name ?? ctx.sender_jid}
    )
    ON CONFLICT (drop_number, (event_data->>'wa_message_id'))
      WHERE event_type = 'WA_DR_MENTION' AND event_data ? 'wa_message_id'
      DO NOTHING
  `;
}

/**
 * Stamp a captured WA photo with the ticket it is linked to and mirror the
 * row into maintenance_attachments so it surfaces in the ticket's attachments
 * UI. Idempotent on (ticket_id, wa_media_id).
 */
export async function linkPhotoToTicket(
  photoId: string,
  ticket: OpenTicket,
  ctx: LinkContext
): Promise<void> {
  const sql = getDb();

  const photoRows = (await sql`
    UPDATE maintenance_wa_photos
    SET ticket_id = ${ticket.id}
    WHERE id = ${photoId} AND ticket_id IS DISTINCT FROM ${ticket.id}
    RETURNING wa_media_id, original_filename, mime_type, file_size_bytes, local_path, sharepoint_url, firebase_url
  `) as Array<{
    wa_media_id: string;
    original_filename: string | null;
    mime_type: string | null;
    file_size_bytes: number | null;
    local_path: string | null;
    sharepoint_url: string | null;
    firebase_url: string | null;
  }>;

  if (photoRows.length === 0) {
    return; // already linked
  }
  const photo = photoRows[0]!;
  const fileUrl = photo.firebase_url ?? photo.sharepoint_url ?? photo.local_path ?? '';
  const filename = photo.original_filename ?? `${photo.wa_media_id}.jpg`;

  await sql`
    INSERT INTO maintenance_attachments (
      ticket_id, filename, file_url, file_type, file_size, mime_type,
      description, is_internal, is_evidence, uploaded_by
    ) VALUES (
      ${ticket.id},
      ${filename},
      ${fileUrl},
      'image',
      ${photo.file_size_bytes},
      ${photo.mime_type},
      ${`WA photo from ${ctx.group_name} via ${ctx.sender_name ?? ctx.sender_jid}`},
      false,
      true,
      ${SYSTEM_USER_ID}
    )
  `;
}
