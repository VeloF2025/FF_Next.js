/**
 * Ticket Notes API
 * 🟢 WORKING: CRUD operations for ticket notes with visibility control
 *
 * GET  - List all notes for a ticket (with optional visibility filter)
 * POST - Create a new note (private or public)
 *
 * Notes have visibility control:
 * - PRIVATE: Internal Velocity Fibre use only, never synced externally
 * - PUBLIC: May be synced to QContact or other external systems
 */

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { createTicketNote } from '@/modules/noc/services/ticketNotesService';

const logger = createLogger('ticket-notes-api');
const sql = neon(process.env.DATABASE_URL!);

/**
 * Note response type
 */
interface NoteResponse {
  id: string;
  ticket_id: string;
  content: string;
  note_type: string;
  visibility: 'private' | 'public';
  created_by: string;
  created_at: string;
  updated_at: string;
  is_resolution: boolean;
  attachments: string[] | null;
  author_name?: string;
  author_email?: string;
}

/**
 * GET /api/noc/tickets/[id]/notes
 * List all notes for a ticket
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: ticketId } = await params;

    if (!ticketId) {
      return NextResponse.json(
        { success: false, error: { message: 'Ticket ID is required' } },
        { status: 400 }
      );
    }

    logger.debug('Fetching notes for ticket', { ticketId });

    // Verify ticket exists
    const tickets = await sql`
      SELECT id FROM maintenance_tickets WHERE id = ${ticketId}
    `;

    if (tickets.length === 0) {
      return NextResponse.json(
        { success: false, error: { message: 'Ticket not found' } },
        { status: 404 }
      );
    }

    // Parse query params for filtering
    const { searchParams } = new URL(request.url);
    const visibility = searchParams.get('visibility'); // 'private', 'public', or null for all

    // Fetch notes with optional visibility filter
    let notes;
    if (visibility && (visibility === 'private' || visibility === 'public')) {
      notes = await sql`
        SELECT
          n.id,
          n.ticket_id,
          n.content,
          n.note_type,
          n.visibility,
          n.created_by,
          n.created_at,
          n.updated_at,
          n.is_resolution,
          n.attachments,
          u.first_name || ' ' || u.last_name as author_name,
          u.email as author_email
        FROM maintenance_notes n
        LEFT JOIN users u ON n.created_by = u.id
        WHERE n.ticket_id = ${ticketId}
          AND n.visibility = ${visibility}
        ORDER BY n.created_at DESC
      `;
    } else {
      notes = await sql`
        SELECT
          n.id,
          n.ticket_id,
          n.content,
          n.note_type,
          n.visibility,
          n.created_by,
          n.created_at,
          n.updated_at,
          n.is_resolution,
          n.attachments,
          u.first_name || ' ' || u.last_name as author_name,
          u.email as author_email
        FROM maintenance_notes n
        LEFT JOIN users u ON n.created_by = u.id
        WHERE n.ticket_id = ${ticketId}
        ORDER BY n.created_at DESC
      `;
    }

    // Calculate summary counts
    const allNotes = await sql`
      SELECT visibility, COUNT(*) as count
      FROM maintenance_notes
      WHERE ticket_id = ${ticketId}
      GROUP BY visibility
    `;

    const summary = {
      total: notes.length,
      private: 0,
      public: 0,
    };

    for (const row of allNotes) {
      if (row.visibility === 'private') {
        summary.private = parseInt(row.count as string, 10);
      } else if (row.visibility === 'public') {
        summary.public = parseInt(row.count as string, 10);
      }
    }
    summary.total = summary.private + summary.public;

    logger.debug('Fetched notes for ticket', {
      ticketId,
      count: notes.length,
      summary,
    });

    return NextResponse.json({
      success: true,
      data: {
        notes,
        summary,
      },
    });
  } catch (error) {
    logger.error('Error fetching ticket notes', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return NextResponse.json(
      { success: false, error: { message: 'Failed to fetch notes' } },
      { status: 500 }
    );
  }
}

/**
 * POST /api/noc/tickets/[id]/notes
 * Create a new note for a ticket
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: ticketId } = await params;

    const body = await request.json();
    const result = await createTicketNote({
      ticketId,
      content: body.content,
      visibility: body.visibility ?? 'private',
      noteType: body.note_type ?? 'internal',
      isResolution: body.is_resolution ?? false,
      attachments: body.attachments ?? null,
      createdBy: body.created_by ?? null,
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: { message: result.message } },
        { status: result.status },
      );
    }

    return NextResponse.json({ success: true, data: result.note });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error creating ticket note', { error: errorMessage });
    return NextResponse.json(
      { success: false, error: { message: 'Failed to create note', details: errorMessage } },
      { status: 500 },
    );
  }
}
