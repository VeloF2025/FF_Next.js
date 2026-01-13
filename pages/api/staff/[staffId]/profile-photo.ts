/**
 * Staff Profile Photo API
 * POST /api/staff/[staffId]/profile-photo - Upload profile photo
 * DELETE /api/staff/[staffId]/profile-photo - Remove profile photo
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import formidable from 'formidable';
import fs from 'fs';
import { uploadStaffDocument, deleteStaffDocument, isVFStorageAvailable } from '@/services/vfStorageAdapter';
import { withArcjetProtection, aj } from '@/lib/arcjet';
import { createLogger } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL || '');
const logger = createLogger('StaffProfilePhotoAPI');

export const config = {
  api: {
    bodyParser: false,
    responseLimit: '10mb',
  },
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { staffId } = req.query;

  if (!staffId || typeof staffId !== 'string') {
    return res.status(400).json({ error: 'Staff ID is required' });
  }

  // Verify staff exists
  const [staff] = await sql`SELECT id, name FROM staff WHERE id = ${staffId}`;
  if (!staff) {
    return res.status(404).json({ error: 'Staff member not found' });
  }

  if (req.method === 'POST') {
    return handleUpload(req, res, staffId);
  } else if (req.method === 'DELETE') {
    return handleDelete(req, res, staffId);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

async function handleUpload(req: NextApiRequest, res: NextApiResponse, staffId: string) {
  let tempFilePath: string | null = null;

  try {
    // Check storage availability
    const storageAvailable = await isVFStorageAvailable();
    if (!storageAvailable) {
      return res.status(503).json({ error: 'Storage service unavailable' });
    }

    // Parse form data
    const { files } = await parseForm(req);
    const fileArray = Array.isArray(files.file) ? files.file : [files.file];
    const file = fileArray[0];

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    tempFilePath = file.filepath;

    // Validate file type (images only)
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.mimetype || '')) {
      return res.status(400).json({ error: 'Only JPEG, PNG, and WebP images are allowed' });
    }

    // Validate file size (max 5MB for profile photos)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      return res.status(400).json({ error: 'File too large. Maximum size: 5MB' });
    }

    // Upload to VF Storage
    logger.info('Uploading profile photo', { staffId });
    const fileBuffer = await fs.promises.readFile(file.filepath);
    const result = await uploadStaffDocument(
      staffId,
      fileBuffer,
      `profile_${Date.now()}.${getExtension(file.mimetype || 'image/jpeg')}`,
      'profile_photo'
    );

    // Update staff record
    await sql`
      UPDATE staff
      SET profile_photo_url = ${result.url}, updated_at = NOW()
      WHERE id = ${staffId}
    `;

    logger.info('Profile photo uploaded', { staffId, url: result.url });

    // Cleanup temp file
    if (tempFilePath) {
      await fs.promises.unlink(tempFilePath).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      profilePhotoUrl: result.url,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Profile photo upload failed', { staffId, error: errorMessage });

    // Cleanup temp file
    if (tempFilePath) {
      await fs.promises.unlink(tempFilePath).catch(() => {});
    }

    return res.status(500).json({ error: 'Failed to upload profile photo', message: errorMessage });
  }
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse, staffId: string) {
  try {
    // Get current photo URL
    const [staff] = await sql`SELECT profile_photo_url FROM staff WHERE id = ${staffId}`;

    if (staff?.profile_photo_url) {
      // Extract filename from URL and delete from storage
      const urlParts = staff.profile_photo_url.split('/');
      const filename = urlParts[urlParts.length - 1];
      if (filename) {
        await deleteStaffDocument(staffId, filename).catch((err: Error) => {
          logger.warn('Could not delete file from storage', { error: err.message });
        });
      }
    }

    // Clear URL in database
    await sql`
      UPDATE staff
      SET profile_photo_url = NULL, updated_at = NOW()
      WHERE id = ${staffId}
    `;

    logger.info('Profile photo deleted', { staffId });

    return res.status(200).json({ success: true });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Profile photo delete failed', { staffId, error: errorMessage });
    return res.status(500).json({ error: 'Failed to delete profile photo', message: errorMessage });
  }
}

function parseForm(req: NextApiRequest): Promise<{ fields: formidable.Fields; files: formidable.Files }> {
  return new Promise((resolve, reject) => {
    const form = formidable({
      maxFileSize: 5 * 1024 * 1024,
      keepExtensions: true,
    });

    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

function getExtension(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };
  return mimeToExt[mimeType] || 'jpg';
}

export default withArcjetProtection(handler, aj);
