/**
 * Pole Photos Delete API
 * DELETE /api/pole-photos-delete
 * Handles pole photo deletion from local storage
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { localFileStorage } from '@/services/localFileStorage';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

// Valid photo types
const VALID_PHOTO_TYPES = [
  'before',
  'during',
  'after',
  'label',
  'cable_routing',
  'quality_check'
] as const;

type PhotoType = typeof VALID_PHOTO_TYPES[number];

interface DeleteResponse {
  success: boolean;
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<DeleteResponse>
) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { poleId, photoType, photoUrl } = req.body;

    if (!poleId || !photoType) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: poleId, photoType'
      });
    }

    // Validate photo type
    if (!VALID_PHOTO_TYPES.includes(photoType as PhotoType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid photo type. Must be one of: ${VALID_PHOTO_TYPES.join(', ')}`
      });
    }

    // Delete file from local storage if URL provided
    if (photoUrl) {
      try {
        // Extract storage path from URL (remove /uploads/ prefix)
        const storagePath = photoUrl.replace(/^\/uploads\//, '');
        await localFileStorage.deleteFile(storagePath);
      } catch (error) {
        log.warn('Failed to delete photo file:', { data: error }, 'pole-photos-delete');
        // Continue even if file deletion fails
      }
    }

    // Update database to remove photo URL
    const columnName = `photo_${photoType}`;
    await sql`
      UPDATE poles
      SET ${sql(columnName)} = NULL,
          updated_at = NOW()
      WHERE id = ${parseInt(poleId)}
    `;

    log.info(`Pole photo deleted: ${poleId}/${photoType}`, {}, 'pole-photos-delete');

    return res.status(200).json({ success: true });
  } catch (error) {
    log.error('Pole photo delete error:', { data: error }, 'pole-photos-delete');
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete photo',
    });
  }
}
