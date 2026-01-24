/**
 * Staff Note Detail API
 * GET: Get a single note
 * PUT: Update a note
 * DELETE: Delete a note
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { getAuth } from '@/lib/auth-mock';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { staffId, noteId } = req.query;

  if (!staffId || typeof staffId !== 'string') {
    return apiResponse.badRequest(res, 'Staff ID is required');
  }

  if (!noteId || typeof noteId !== 'string') {
    return apiResponse.badRequest(res, 'Note ID is required');
  }

  try {
    const { userId } = getAuth(req);

    if (req.method === 'GET') {
      // Get single note
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
        WHERE id = ${noteId}::uuid
          AND staff_id = ${staffId}::uuid
      `;

      if (notes.length === 0) {
        return apiResponse.notFound(res, 'Note', noteId);
      }

      return apiResponse.success(res, { note: notes[0] });
    }

    if (req.method === 'PUT') {
      // Update note
      const { title, content } = req.body;

      if (!content?.trim()) {
        return apiResponse.badRequest(res, 'Note content is required');
      }

      const result = await sql`
        UPDATE staff_notes
        SET
          title = ${title?.trim() || null},
          content = ${content.trim()},
          updated_at = NOW()
        WHERE id = ${noteId}::uuid
          AND staff_id = ${staffId}::uuid
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

      if (result.length === 0) {
        return apiResponse.notFound(res, 'Note', noteId);
      }

      log.info('Staff note updated', { staffId, noteId, userId });
      return apiResponse.success(res, { note: result[0] });
    }

    if (req.method === 'DELETE') {
      // Delete note
      const result = await sql`
        DELETE FROM staff_notes
        WHERE id = ${noteId}::uuid
          AND staff_id = ${staffId}::uuid
        RETURNING id
      `;

      if (result.length === 0) {
        return apiResponse.notFound(res, 'Note', noteId);
      }

      log.info('Staff note deleted', { staffId, noteId, userId });
      return apiResponse.success(res, { deleted: true });
    }

    return apiResponse.methodNotAllowed(res, ['GET', 'PUT', 'DELETE']);
  } catch (error: any) {
    log.error('Staff note detail API error', { staffId, noteId, method: req.method, error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
