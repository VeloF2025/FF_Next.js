/**
 * Unified Storage Upload API
 * POST /api/storage/upload
 * Handles file uploads to VF Storage with unified interface
 *
 * @see docs/ARCHITECTURE_STORAGE.md for storage architecture
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm, File as FormidableFile } from 'formidable';
import fs from 'fs';
import { vfStorage } from '@/services/vfStorageAdapter';
import { log } from '@/lib/logger';

import { withAuth } from '@/lib/auth';

// Allowed MIME types and their magic bytes for validation
const ALLOWED_TYPES: Record<string, number[][]> = {
  'image/jpeg': [[0xFF, 0xD8, 0xFF]],
  'image/png': [[0x89, 0x50, 0x4E, 0x47]],
  'image/gif': [[0x47, 0x49, 0x46, 0x38]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]], // RIFF header
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]], // %PDF
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [[0x50, 0x4B, 0x03, 0x04]], // ZIP (xlsx)
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [[0x50, 0x4B, 0x03, 0x04]], // ZIP (docx)
  'application/msword': [[0xD0, 0xCF, 0x11, 0xE0]], // OLE2 (doc)
  'text/csv': [], // No magic bytes for CSV
};

function validateMagicBytes(buffer: Buffer, mimeType: string): boolean {
  const signatures = ALLOWED_TYPES[mimeType];
  if (!signatures) return false; // MIME type not allowed
  if (signatures.length === 0) return true; // No magic bytes to check (e.g., CSV)
  return signatures.some(sig =>
    sig.every((byte, i) => buffer.length > i && buffer[i] === byte)
  );
}

export const config = {
  api: {
    bodyParser: false,
  },
};

interface UploadResponse {
  success: boolean;
  url?: string;
  path?: string;
  fileName?: string;
  size?: number;
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
    const form = new IncomingForm({
      maxFileSize: 50 * 1024 * 1024, // 50MB
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
    const type = Array.isArray(fields.type) ? fields.type[0] : fields.type;
    const category = Array.isArray(fields.category) ? fields.category[0] : fields.category;

    if (!type || !category) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: type, category'
      });
    }

    // Get the uploaded file
    const fileField = files.file;
    const file = Array.isArray(fileField) ? fileField[0] : fileField;

    if (!file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    // Read file buffer
    const buffer = await fs.promises.readFile(file.filepath);

    // Validate file type via magic bytes
    const mimeType = file.mimetype || '';
    if (!validateMagicBytes(buffer, mimeType)) {
      await fs.promises.unlink(file.filepath).catch((e) => log.debug('Temp file cleanup failed', { error: e instanceof Error ? e.message : 'unknown' }, 'storage'));
      return res.status(400).json({
        success: false,
        error: `File type not allowed or content does not match declared type: ${mimeType}`,
      });
    }

    // Upload to VF Storage
    const filename = file.originalFilename || `file_${Date.now()}`;
    const result = await vfStorage.uploadFile(
      buffer,
      type,
      category,
      filename
    );

    // Clean up temp file
    await fs.promises.unlink(file.filepath).catch((e) => log.debug('Temp file cleanup failed', { error: e instanceof Error ? e.message : 'unknown' }, 'storage'));

    log.info(`File uploaded: ${result.path}`, { data: { url: result.url } }, 'storage-upload');

    return res.status(200).json({
      success: true,
      url: result.url,
      path: result.path,
      fileName: result.filename,
    });
  } catch (error) {
    log.error('Storage upload error:', { data: error }, 'storage-upload');
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload file',
    });
  }
}

export default withAuth(handler);
