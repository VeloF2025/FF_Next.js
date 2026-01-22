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

export default async function handler(
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

    // Upload to VF Storage
    const filename = file.originalFilename || `file_${Date.now()}`;
    const result = await vfStorage.uploadFile(
      buffer,
      type,
      category,
      filename
    );

    // Clean up temp file
    await fs.promises.unlink(file.filepath).catch(() => {});

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
