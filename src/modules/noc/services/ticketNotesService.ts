/**
 * Shared ticket-note creation. Used by the notes POST route and the
 * analyze-screenshot endpoint so QContact sync + the text[] attachments
 * write live in exactly one place.
 */
import pool from '@/lib/db';
import { createLogger } from '@/lib/logger';
import { pushNote } from '@/modules/noc/services/qcontactSyncOutbound';

const logger = createLogger('noc:ticket-notes-service');

export interface CreateTicketNoteParams {
  ticketId: string;
  content: string;
  visibility: 'private' | 'public';
  noteType?: string;
  isResolution?: boolean;
  attachments?: string[] | null;
  createdBy?: string | null;
}

export interface CreatedTicketNote {
  id: string;
  ticket_id: string;
  content: string;
  note_type: string;
  visibility: 'private' | 'public';
  created_by: string | null;
  created_at: string;
  updated_at: string;
  is_resolution: boolean;
  attachments: string[] | null;
  author_name?: string | null;
  author_email?: string | null;
}

export type CreateTicketNoteResult =
  | { ok: true; note: CreatedTicketNote }
  | { ok: false; status: number; message: string };

export async function createTicketNote(params: CreateTicketNoteParams): Promise<CreateTicketNoteResult> {
  const {
    ticketId,
    content,
    visibility,
    noteType = 'internal',
    isResolution = false,
    attachments = null,
    createdBy = null,
  } = params;

  if (!ticketId) return { ok: false, status: 400, message: 'Ticket ID is required' };
  if (!content || content.trim() === '') return { ok: false, status: 400, message: 'Note content is required' };
  if (visibility !== 'private' && visibility !== 'public') {
    return { ok: false, status: 400, message: 'Visibility must be "private" or "public"' };
  }

  const ticket = await pool.query('SELECT id FROM maintenance_tickets WHERE id = $1', [ticketId]);
  if (ticket.rows.length === 0) return { ok: false, status: 404, message: 'Ticket not found' };

  const noteId = crypto.randomUUID();
  const now = new Date().toISOString();
  const trimmed = content.trim();

  // attachments is a Postgres text[] — pass the JS array directly so pg
  // serialises it to a proper array literal. Do NOT JSON.stringify it.
  await pool.query(
    `INSERT INTO maintenance_notes
       (id, ticket_id, content, note_type, visibility, created_by, created_at, updated_at, is_resolution, attachments)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [noteId, ticketId, trimmed, noteType, visibility, createdBy, now, now, isResolution, attachments ?? null],
  );

  const created = await pool.query(
    `SELECT n.id, n.ticket_id, n.content, n.note_type, n.visibility, n.created_by,
            n.created_at, n.updated_at, n.is_resolution, n.attachments,
            u.first_name || ' ' || u.last_name AS author_name, u.email AS author_email
       FROM maintenance_notes n
       LEFT JOIN users u ON n.created_by = u.id
      WHERE n.id = $1`,
    [noteId],
  );

  logger.info('Created ticket note', { ticketId, noteId, visibility, noteType });

  if (visibility === 'public') {
    try {
      const sync = await pushNote(ticketId, trimmed, false);
      logger.info('Public note synced to QContact', { ticketId, noteId, syncSuccess: sync.success });
    } catch (syncError) {
      logger.warn('Failed to sync public note to QContact', {
        ticketId, noteId,
        error: syncError instanceof Error ? syncError.message : 'Unknown',
      });
    }
  }

  return { ok: true, note: created.rows[0] as CreatedTicketNote };
}
