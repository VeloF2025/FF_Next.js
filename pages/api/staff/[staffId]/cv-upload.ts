/**
 * Staff CV Upload API
 * POST /api/staff/[staffId]/cv-upload - Upload CV/Resume
 * DELETE /api/staff/[staffId]/cv-upload - Remove CV
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import formidable from 'formidable';
import fs from 'fs';
import { withArcjetProtection, aj } from '@/lib/arcjet';
import { createLogger } from '@/lib/logger';
import { uploadStaffDocument, deleteStaffDocument } from '@/services/vfStorageAdapter';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL || '');
const logger = createLogger('StaffCVUploadAPI');

// Disable body parser for file uploads
export const config = {
  api: {
    bodyParser: false,
  },
};

// Allowed file types for CV
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { staffId } = req.query;

  if (!staffId || typeof staffId !== 'string') {
    return res.status(400).json({ error: 'Staff ID is required' });
  }

  // POST - Upload CV
  if (req.method === 'POST') {
    try {
      // Verify staff exists
      const [staff] = await sql`
        SELECT id, cv_url FROM staff WHERE id = ${staffId}
      `;

      if (!staff) {
        return res.status(404).json({ error: 'Staff member not found' });
      }

      // Parse form data
      const form = formidable({
        maxFileSize: MAX_FILE_SIZE,
        keepExtensions: true,
      });

      const [, files] = await form.parse(req);
      const file = Array.isArray(files.file) ? files.file[0] : files.file;

      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Validate file type
      if (!file.mimetype || !ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        fs.unlinkSync(file.filepath);
        return res.status(400).json({
          error: 'Invalid file type',
          message: 'CV must be PDF, DOC, or DOCX format',
        });
      }

      // Delete existing CV if present
      if (staff.cv_url) {
        try {
          const oldFilename = staff.cv_url.split('/').pop();
          if (oldFilename) {
            await deleteStaffDocument(staffId, oldFilename);
          }
        } catch (deleteError) {
          logger.warn('Failed to delete old CV', { staffId, error: String(deleteError) });
        }
      }

      // Upload new CV
      const fileBuffer = fs.readFileSync(file.filepath);
      const extension = file.originalFilename?.split('.').pop() || 'pdf';
      const filename = `cv-${Date.now()}.${extension}`;

      const uploadResult = await uploadStaffDocument(
        staffId,
        fileBuffer,
        filename,
        'cv'
      );

      // Clean up temp file
      fs.unlinkSync(file.filepath);

      // Update staff record with CV URL
      await sql`
        UPDATE staff
        SET cv_url = ${uploadResult.url}, cv_uploaded_at = NOW(), updated_at = NOW()
        WHERE id = ${staffId}
      `;

      logger.info('CV uploaded', { staffId, cvUrl: uploadResult.url });

      return res.status(200).json({
        success: true,
        cvUrl: uploadResult.url,
        uploadedAt: new Date().toISOString(),
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to upload CV', { staffId, error: errorMessage });
      return res.status(500).json({ error: 'Failed to upload CV', message: errorMessage });
    }
  }

  // DELETE - Remove CV
  if (req.method === 'DELETE') {
    try {
      const [staff] = await sql`
        SELECT id, cv_url FROM staff WHERE id = ${staffId}
      `;

      if (!staff) {
        return res.status(404).json({ error: 'Staff member not found' });
      }

      if (!staff.cv_url) {
        return res.status(404).json({ error: 'No CV found for this staff member' });
      }

      // Delete from storage
      try {
        const filename = staff.cv_url.split('/').pop();
        if (filename) {
          await deleteStaffDocument(staffId, filename);
        }
      } catch (deleteError) {
        logger.warn('Failed to delete CV from storage', { staffId, error: String(deleteError) });
      }

      // Clear CV URL in database
      await sql`
        UPDATE staff
        SET cv_url = NULL, cv_uploaded_at = NULL, updated_at = NOW()
        WHERE id = ${staffId}
      `;

      logger.info('CV deleted', { staffId });

      return res.status(200).json({
        success: true,
        message: 'CV deleted',
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to delete CV', { staffId, error: errorMessage });
      return res.status(500).json({ error: 'Failed to delete CV', message: errorMessage });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default withAuth(withArcjetProtection(handler, aj));
