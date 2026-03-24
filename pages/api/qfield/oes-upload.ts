/**
 * QField OES Upload API
 * POST /api/qfield/oes-upload
 * Uploads OES report file to VPS via SCP
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import formidable from 'formidable';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

const execAsync = promisify(exec);

/** Validate file content matches Excel format by checking magic bytes (skip for CSV) */
function validateExcelMagicBytes(buffer: Buffer): { valid: boolean; detectedType: string } {
  if (buffer.length < 4) return { valid: false, detectedType: 'unknown' };
  const hex = buffer.subarray(0, 8).toString('hex').toUpperCase();
  if (hex.startsWith('D0CF11E0')) return { valid: true, detectedType: 'application/vnd.ms-excel' };
  if (hex.startsWith('504B0304')) return { valid: true, detectedType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  return { valid: false, detectedType: 'unknown' };
}

// VPS Configuration
const VPS_HOST = process.env.VPS_HOST || '72.61.166.168';
const VPS_USER = process.env.VPS_USER || 'root';
const VPS_OES_PATH = process.env.VPS_OES_PATH || '/root/oes_sync';
const SSH_KEY_PATH = process.env.VPS_SSH_KEY_PATH || '/home/louisdup/.ssh/qfield_vps';

// Disable body parser for multipart form data
export const config = {
  api: {
    bodyParser: false,
  },
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  let tempFilePath: string | undefined;

  try {
    // Parse multipart form data
    const { files } = await parseForm(req);

    // Get uploaded file
    const fileArray = Array.isArray(files.file) ? files.file : [files.file];
    const file = fileArray[0];

    if (!file) {
      return apiResponse.badRequest(res, 'No file uploaded');
    }

    tempFilePath = file.filepath;

    // Validate file type
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv',
      'application/csv'
    ];

    const isValidExtension = /\.(xlsx|xls|csv)$/i.test(file.originalFilename || '');

    if (!allowedTypes.includes(file.mimetype || '') && !isValidExtension) {
      return apiResponse.badRequest(res, 'Invalid file type. Please upload Excel (.xlsx, .xls) or CSV file.');
    }

    // Validate file size (50MB max)
    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      return apiResponse.badRequest(res, 'File too large. Maximum size: 50MB');
    }

    // Validate magic bytes for binary formats (Excel). CSV has no magic bytes.
    const isCsv = /\.csv$/i.test(file.originalFilename || '');
    if (!isCsv) {
      const fileBuffer = await fs.promises.readFile(file.filepath);
      const { valid: magicValid } = validateExcelMagicBytes(fileBuffer);
      if (!magicValid) {
        await fs.promises.unlink(file.filepath).catch((e) => log.debug('Temp file cleanup failed', { error: e instanceof Error ? e.message : 'unknown' }, 'qfield'));
        return apiResponse.badRequest(res, 'File content does not match Excel format (.xls or .xlsx).');
      }
    }

    // Determine target filename based on extension
    const originalExt = file.originalFilename?.split('.').pop()?.toLowerCase() || 'xlsx';
    const targetFilename = `oes_report_latest.${originalExt}`;
    const targetPath = `${VPS_OES_PATH}/data/oes_reports/${targetFilename}`;

    log.info('api/qfield/oes-upload', {
      action: 'uploadFile',
      targetPath,
      fileSizeKB: (file.size / 1024).toFixed(2)
    });

    // Upload file to VPS via SCP
    const scpCommand = `scp -i "${SSH_KEY_PATH}" -o StrictHostKeyChecking=no "${tempFilePath}" "${VPS_USER}@${VPS_HOST}:${targetPath}"`;

    try {
      const { stdout, stderr } = await execAsync(scpCommand);

      if (stderr && !stderr.includes('Warning')) {
        log.error('api/qfield/oes-upload', { action: 'scpStderr', stderr });
      }

      log.info('api/qfield/oes-upload', { action: 'uploadSuccess', filename: targetFilename });

    } catch (scpError: any) {
      log.error('api/qfield/oes-upload', { action: 'scpError', error: scpError.message });
      throw new Error(`Failed to upload file to VPS: ${scpError.message}`);
    }

    // Clean up temp file
    await fs.promises.unlink(tempFilePath);
    tempFilePath = undefined;

    return res.status(200).json({
      success: true,
      filename: targetFilename,
      originalName: file.originalFilename,
      size: file.size,
      uploadedAt: new Date().toISOString(),
      vpsPath: targetPath
    });

  } catch (error: any) {
    log.error('api/qfield/oes-upload', { action: 'uploadError', error: error.message });

    // Clean up temp file on error
    if (tempFilePath) {
      try {
        await fs.promises.unlink(tempFilePath);
      } catch (e) {
        log.error('api/qfield/oes-upload', { action: 'cleanupError', error: e instanceof Error ? e.message : String(e) });
      }
    }

    return res.status(500).json({
      error: 'Failed to upload file',
      message: error.message
    });
  }
}

// Parse multipart form data
function parseForm(req: NextApiRequest): Promise<{ fields: formidable.Fields; files: formidable.Files }> {
  return new Promise((resolve, reject) => {
    const form = formidable({
      maxFileSize: 50 * 1024 * 1024, // 50MB
      keepExtensions: true,
    });

    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

export default withAuth(handler);
