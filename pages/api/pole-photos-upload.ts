/**
 * Pole Photos Upload API
 * POST /api/pole-photos-upload
 * Handles pole photo uploads to VF Storage
 *
 * @see docs/ARCHITECTURE_STORAGE.md for storage architecture
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm, File as FormidableFile } from 'formidable';
import fs from 'fs';
import { vfStorage } from '@/services/vfStorageAdapter';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

import { withAuth } from '@/lib/auth';
// Disable default body parser for file uploads
export const config = {
  api: {
    bodyParser: false,
  },
};

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

interface UploadResponse {
  success: boolean;
  url?: string;
  error?: string;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<UploadResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    // Parse the multipart form data
    const form = new IncomingForm({
      maxFileSize: 10 * 1024 * 1024, // 10MB
      keepExtensions: true,
    });

    const { fields, files } = await new Promise<{
      fields: Record<string, string | string[]>;
      files: Record<string, FormidableFile | FormidableFile[]>;
    }>((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve({
          fields: fields as Record<string, string | string[]>,
          files: files as Record<string, FormidableFile | FormidableFile[]>
        });
      });
    });

    // Extract parameters
    const poleId = Array.isArray(fields.poleId) ? fields.poleId[0] : fields.poleId;
    const projectId = Array.isArray(fields.projectId) ? fields.projectId[0] : fields.projectId;
    const photoType = Array.isArray(fields.photoType) ? fields.photoType[0] : fields.photoType;

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

    // Get the uploaded file
    const fileField = files.file;
    const file = Array.isArray(fileField) ? fileField[0] : fileField;

    if (!file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    // Validate file type (images only)
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (file.mimetype && !allowedTypes.includes(file.mimetype)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid file type. Only images are allowed.'
      });
    }

    // Read file buffer
    const buffer = await fs.promises.readFile(file.filepath);

    // Upload to VF Storage
    // Path convention: poles/{projectId}/{poleId}/{photoType}_{filename}
    const category = `${projectId || 'unknown'}/${poleId}`;
    const filename = `${photoType}_${Date.now()}_${file.originalFilename || 'photo.jpg'}`;
    const result = await vfStorage.uploadFile(
      buffer,
      'poles',
      category,
      filename
    );

    // Update database with photo URL
    const columnName = `photo_${photoType}`;
    await sql`
      UPDATE poles
      SET ${sql(columnName)} = ${result.url},
          updated_at = NOW()
      WHERE id = ${parseInt(poleId)}
    `;

    // Clean up temp file
    await fs.promises.unlink(file.filepath).catch(() => {});

    log.info(`Pole photo uploaded: ${poleId}/${photoType}`, { data: { url: result.url } }, 'pole-photos-upload');

    return res.status(200).json({
      success: true,
      url: result.url,
    });
  } catch (error) {
    log.error('Pole photo upload error:', { data: error }, 'pole-photos-upload');
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload photo',
    });
  }
}

export default withAuth(handler);
