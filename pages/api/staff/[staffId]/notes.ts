/**
 * Staff Notes API
 * GET: List notes for a staff member
 * POST: Create a new note
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { getAuth } from '@/lib/auth-mock';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL!);

interface StaffNote {
  id: string;
  staffId: string;
  noteType: string;
  title?: string;
  content: string;
  createdBy?: string;
  createdByName?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { staffId } = req.query;

  if (!staffId || typeof staffId !== 'string') {
    return apiResponse.badRequest(res, 'Staff ID is required');
  }

  try {
    const { userId, userName } = getAuth(req);

    if (req.method === 'GET') {
      // List notes for staff member
      const notes = await sql`
        SELECT
          id,
          staff_id as "staffId",
          note_type as "noteType",
          title,
          content,
          created_by as "createdBy",
          created_by_name as "createdByName",
          metadata,
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM staff_notes
        WHERE staff_id = ${staffId}::uuid
        ORDER BY created_at DESC
      `;

      return apiResponse.success(res, { notes });
    }

    if (req.method === 'POST') {
      // Create a new note
      const { noteType, title, content, metadata } = req.body;

      if (!content?.trim()) {
        return apiResponse.badRequest(res, 'Note content is required');
      }

      const validNoteTypes = ['general', 'contract_summary', 'hr_note', 'document_note', 'system'];
      const type = validNoteTypes.includes(noteType) ? noteType : 'general';

      const result = await sql`
        INSERT INTO staff_notes (
          staff_id,
          note_type,
          title,
          content,
          created_by,
          created_by_name,
          metadata
        ) VALUES (
          ${staffId}::uuid,
          ${type},
          ${title?.trim() || null},
          ${content.trim()},
          ${userId || null}::uuid,
          ${userName || 'System'},
          ${metadata ? JSON.stringify(metadata) : null}::jsonb
        )
        RETURNING
          id,
          staff_id as "staffId",
          note_type as "noteType",
          title,
          content,
          created_by as "createdBy",
          created_by_name as "createdByName",
          metadata,
          created_at as "createdAt",
          updated_at as "updatedAt"
      `;

      log.info('Staff note created', {
        staffId,
        noteId: result[0]?.id,
        noteType: type,
        userId,
      });

      return apiResponse.created(res, { note: result[0] });
    }

    return apiResponse.methodNotAllowed(res, ['GET', 'POST']);
  } catch (error: any) {
    // Check if it's a missing table error
    if (error.message?.includes('relation "staff_notes" does not exist')) {
      log.warn('staff_notes table does not exist - returning empty list', { staffId });
      return apiResponse.success(res, { notes: [] });
    }

    log.error('Staff notes API error', { staffId, method: req.method, error });
    return apiResponse.internalError(res, error);
  }
}
