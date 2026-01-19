/**
 * Individual Ticket Note API
 * 🟢 WORKING: Update and delete operations for ticket notes
 *
 * GET    - Get a single note
 * PATCH  - Update a note (content, visibility)
 * DELETE - Delete a note
 */

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ticket-note-api');
const sql = neon(process.env.DATABASE_URL!);

/**
 * GET /api/ticketing/tickets/[id]/notes/[noteId]
 * Get a single note
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  try {
    const { id: ticketId, noteId } = await params;

    if (!ticketId || !noteId) {
      return NextResponse.json(
        { success: false, error: { message: 'Ticket ID and Note ID are required' } },
        { status: 400 }
      );
    }

    const notes = await sql`
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
      FROM ticket_notes n
      LEFT JOIN users u ON n.created_by = u.id
      WHERE n.id = ${noteId} AND n.ticket_id = ${ticketId}
    `;

    if (notes.length === 0) {
      return NextResponse.json(
        { success: false, error: { message: 'Note not found' } },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: notes[0],
    });
  } catch (error) {
    logger.error('Error fetching note', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return NextResponse.json(
      { success: false, error: { message: 'Failed to fetch note' } },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/ticketing/tickets/[id]/notes/[noteId]
 * Update a note
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  try {
    const { id: ticketId, noteId } = await params;

    if (!ticketId || !noteId) {
      return NextResponse.json(
        { success: false, error: { message: 'Ticket ID and Note ID are required' } },
        { status: 400 }
      );
    }

    // Verify note exists
    const existingNotes = await sql`
      SELECT id, created_by FROM ticket_notes
      WHERE id = ${noteId} AND ticket_id = ${ticketId}
    `;

    if (existingNotes.length === 0) {
      return NextResponse.json(
        { success: false, error: { message: 'Note not found' } },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { content, visibility, is_resolution } = body;

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (content !== undefined) {
      if (content.trim() === '') {
        return NextResponse.json(
          { success: false, error: { message: 'Note content cannot be empty' } },
          { status: 400 }
        );
      }
      updates.push(`content = $${paramIndex++}`);
      values.push(content.trim());
    }

    if (visibility !== undefined) {
      if (visibility !== 'private' && visibility !== 'public') {
        return NextResponse.json(
          { success: false, error: { message: 'Visibility must be "private" or "public"' } },
          { status: 400 }
        );
      }
      updates.push(`visibility = $${paramIndex++}`);
      values.push(visibility);
    }

    if (is_resolution !== undefined) {
      updates.push(`is_resolution = $${paramIndex++}`);
      values.push(is_resolution);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { success: false, error: { message: 'No fields to update' } },
        { status: 400 }
      );
    }

    // Add updated_at
    updates.push(`updated_at = $${paramIndex++}`);
    values.push(new Date().toISOString());

    // Add note ID for WHERE clause
    values.push(noteId);

    // Execute update using raw query
    const updateSql = `
      UPDATE ticket_notes
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
    `;

    // Use tagged template literal with values
    await sql.query(updateSql, values);

    // Fetch updated note
    const updatedNote = await sql`
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
      FROM ticket_notes n
      LEFT JOIN users u ON n.created_by = u.id
      WHERE n.id = ${noteId}
    `;

    logger.info('Updated ticket note', { ticketId, noteId });

    return NextResponse.json({
      success: true,
      data: updatedNote[0],
    });
  } catch (error) {
    logger.error('Error updating note', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return NextResponse.json(
      { success: false, error: { message: 'Failed to update note' } },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/ticketing/tickets/[id]/notes/[noteId]
 * Delete a note
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  try {
    const { id: ticketId, noteId } = await params;

    if (!ticketId || !noteId) {
      return NextResponse.json(
        { success: false, error: { message: 'Ticket ID and Note ID are required' } },
        { status: 400 }
      );
    }

    // Verify note exists
    const existingNotes = await sql`
      SELECT id FROM ticket_notes
      WHERE id = ${noteId} AND ticket_id = ${ticketId}
    `;

    if (existingNotes.length === 0) {
      return NextResponse.json(
        { success: false, error: { message: 'Note not found' } },
        { status: 404 }
      );
    }

    // Delete the note
    await sql`
      DELETE FROM ticket_notes
      WHERE id = ${noteId} AND ticket_id = ${ticketId}
    `;

    logger.info('Deleted ticket note', { ticketId, noteId });

    return NextResponse.json({
      success: true,
      data: { id: noteId, deleted: true },
    });
  } catch (error) {
    logger.error('Error deleting note', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return NextResponse.json(
      { success: false, error: { message: 'Failed to delete note' } },
      { status: 500 }
    );
  }
}
