/**
 * Fleet File Upload API
 * POST /api/fleet/upload
 * Handles file uploads for fleet module (fuel receipts, etc.)
 * Supports portal session auth (plate-based login)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm, File as FormidableFile } from 'formidable';
import fs from 'fs';
import { vfStorage } from '@/services/vfStorageAdapter';
import { log } from '@/lib/logger';
import { withFleetAuth } from '@/lib/auth/middleware';

/** Validate file content matches expected type by checking magic bytes */
function validateMagicBytes(buffer: Buffer): { valid: boolean; detectedType: string } {
  if (buffer.length < 4) return { valid: false, detectedType: 'unknown' };
  const hex = buffer.subarray(0, 8).toString('hex').toUpperCase();
  if (hex.startsWith('FFD8FF')) return { valid: true, detectedType: 'image/jpeg' };
  if (hex.startsWith('89504E47')) return { valid: true, detectedType: 'image/png' };
  if (hex.startsWith('25504446')) return { valid: true, detectedType: 'application/pdf' };
  if (hex.startsWith('47494638')) return { valid: true, detectedType: 'image/gif' };
  if (hex.startsWith('52494646')) return { valid: true, detectedType: 'image/webp' };
  return { valid: false, detectedType: 'unknown' };
}

export const config = {
  api: {
    bodyParser: false,
  },
};

interface UploadResponse {
  success: boolean;
  data?: {
    url: string;
    path: string;
    fileName: string;
  };
  error?: {
    message: string;
    code?: string;
  };
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<UploadResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: { message: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }
    });
  }

  try {
    const form = new IncomingForm({
      maxFileSize: 20 * 1024 * 1024, // 20MB
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

    // Extract folder parameter (optional path within fleet storage)
    const folder = Array.isArray(fields.folder) ? fields.folder[0] : fields.folder;

    // Get the uploaded file
    const fileField = files.file;
    const file = Array.isArray(fileField) ? fileField[0] : fileField;

    if (!file) {
      return res.status(400).json({
        success: false,
        error: { message: 'No file uploaded', code: 'NO_FILE' }
      });
    }

    // Read file buffer
    const buffer = await fs.promises.readFile(file.filepath);

    // Validate magic bytes match an allowed file type
    const { valid, detectedType } = validateMagicBytes(buffer);
    if (!valid) {
      await fs.promises.unlink(file.filepath).catch((e) => log.debug('Temp file cleanup failed', { error: e instanceof Error ? e.message : 'unknown' }, 'FLEET_UPLOAD'));
      return res.status(400).json({
        success: false,
        error: { message: `File content does not match an allowed image type (detected: ${detectedType})`, code: 'INVALID_FILE_CONTENT' }
      });
    }

    // Build the category path
    // folder format: "fleet/vehicles/{vehicleId}/fuel-receipts"
    // or just "fuel-receipts" which becomes "fleet/fuel-receipts"
    const category = folder?.startsWith('fleet/')
      ? folder.substring(6) // Remove 'fleet/' prefix
      : folder || 'uploads';

    // Upload to VF Storage under 'fleet' type
    const filename = file.originalFilename || `file_${Date.now()}.jpg`;
    const result = await vfStorage.uploadFile(
      buffer,
      'fleet',
      category,
      filename
    );

    // Clean up temp file
    await fs.promises.unlink(file.filepath).catch((e) => log.debug('Temp file cleanup failed', { error: e instanceof Error ? e.message : 'unknown' }, 'FLEET_UPLOAD'));

    log.info('FleetUpload', {
      action: 'upload',
      path: result.path,
      url: result.url,
      folder,
    });

    return res.status(200).json({
      success: true,
      data: {
        url: result.url,
        path: result.path,
        fileName: result.filename,
      }
    });
  } catch (error) {
    log.error('FleetUpload', { action: 'error', error });
    return res.status(500).json({
      success: false,
      error: {
        message: error instanceof Error ? error.message : 'Failed to upload file',
        code: 'UPLOAD_FAILED'
      }
    });
  }
}

export default withFleetAuth(handler);
