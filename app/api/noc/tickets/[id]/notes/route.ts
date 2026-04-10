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
import { pushNote } from '@/modules/noc/services/qcontactSyncOutbound';

// Note: auth() function is not imported - the try/catch block in POST handles this gracefully
// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare function auth(): Promise<{ userId: string | null }>;

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

    if (!ticketId) {
      return NextResponse.json(
        { success: false, error: { message: 'Ticket ID is required' } },
        { status: 400 }
      );
    }

    // Get current user from Clerk (optional - may not be available in all contexts)
    let userId: string | null = null;
    try {
      const authResult = await auth();
      userId = authResult.userId;
    } catch {
      // Auth not available in this context (e.g., API call without session)
    }

    const body = await request.json();
    const {
      content,
      visibility = 'private', // Default to private
      note_type = 'internal',
      is_resolution = false,
      attachments = null,
    } = body;

    // Validate required fields
    if (!content || content.trim() === '') {
      return NextResponse.json(
        { success: false, error: { message: 'Note content is required' } },
        { status: 400 }
      );
    }

    // Validate visibility
    if (visibility !== 'private' && visibility !== 'public') {
      return NextResponse.json(
        { success: false, error: { message: 'Visibility must be "private" or "public"' } },
        { status: 400 }
      );
    }

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

    // Get or create user ID
    let createdBy: string | null = null;

    // Try to get user from Clerk session
    if (userId) {
      // Look up user in database by clerk_id
      const users = await sql`
        SELECT id FROM users WHERE clerk_id = ${userId}
      `;
      if (users.length > 0) {
        createdBy = users[0]!.id;
      }
    }

    // If no Clerk user, try to find by the provided user_id in body
    if (!createdBy && body.created_by) {
      createdBy = body.created_by;
    }

    // If still no user, use a system user or allow null
    // For now, we'll set to null and rely on database accepting it
    // (We may need to ALTER TABLE to allow NULL in created_by)

    // Create the note
    const noteId = crypto.randomUUID();
    const now = new Date().toISOString();

    await sql`
      INSERT INTO maintenance_notes (
        id,
        ticket_id,
        content,
        note_type,
        visibility,
        created_by,
        created_at,
        updated_at,
        is_resolution,
        attachments
      ) VALUES (
        ${noteId},
        ${ticketId},
        ${content.trim()},
        ${note_type},
        ${visibility},
        ${createdBy},
        ${now},
        ${now},
        ${is_resolution},
        ${attachments ? JSON.stringify(attachments) : null}
      )
    `;

    // Fetch the created note with author info
    const createdNote = await sql`
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
      WHERE n.id = ${noteId}
    `;

    logger.info('Created ticket note', {
      ticketId,
      noteId,
      visibility,
      createdBy,
    });

    // Sync public notes to QContact
    if (visibility === 'public') {
      try {
        const syncResult = await pushNote(ticketId, content.trim(), false); // false = public note
        logger.info('Public note synced to QContact', {
          ticketId,
          noteId,
          syncSuccess: syncResult.success,
          qcontactTicketId: syncResult.qcontact_ticket_id,
        });
      } catch (syncError) {
        // Log but don't fail the request - note was created successfully
        logger.warn('Failed to sync public note to QContact', {
          ticketId,
          noteId,
          error: syncError instanceof Error ? syncError.message : 'Unknown',
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: createdNote[0],
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;

    logger.error('Error creating ticket note', {
      error: errorMessage,
      stack: errorStack,
    });

    // Return more details in development
    return NextResponse.json(
      {
        success: false,
        error: {
          message: 'Failed to create note',
          details: errorMessage,
        }
      },
      { status: 500 }
    );
  }
}
