import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import fs from 'fs';
import { log } from '@/lib/logger';
import { vfStorage } from '@/services/vfStorageAdapter';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';

export const config = {
  api: {
    bodyParser: false,
    responseLimit: '10mb',
  },
};

function sanitizeFileName(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  const name = lastDot > 0 ? fileName.substring(0, lastDot) : fileName;
  const ext = lastDot > 0 ? fileName.substring(lastDot) : '';
  const sanitized = name
    .replace(/[^a-zA-Z0-9-_]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 100);
  return sanitized + ext;
}

function parseForm(req: NextApiRequest): Promise<{ files: formidable.Files }> {
  return new Promise((resolve, reject) => {
    const form = formidable({ maxFileSize: 10 * 1024 * 1024, keepExtensions: true });
    form.parse(req, (err, _fields, files) => {
      if (err) reject(err);
      else resolve({ files });
    });
  });
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  let tempFilePath: string | null = null;

  try {
    const { files } = await parseForm(req);

    const fileArray = Array.isArray(files.file) ? files.file : [files.file];
    const file = fileArray[0];

    if (!file) {
      return apiResponse.badRequest(res, 'No file uploaded');
    }

    tempFilePath = file.filepath;

    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];

    if (!allowedTypes.includes(file.mimetype || '')) {
      return apiResponse.badRequest(res, 'Invalid file type. Allowed: PDF, JPG, PNG, Word, Excel');
    }

    if (file.size > 10 * 1024 * 1024) {
      return apiResponse.badRequest(res, 'File too large. Maximum size: 10MB');
    }

    const fileBuffer = await fs.promises.readFile(file.filepath);
    const sanitizedName = sanitizeFileName(file.originalFilename || 'document');
    const uniqueFilename = `${Date.now()}_${sanitizedName}`;

    const uploadResult = await vfStorage.uploadFile(
      fileBuffer,
      'manco',
      'documents',
      uniqueFilename
    );

    if (tempFilePath) {
      await fs.promises.unlink(tempFilePath).catch((e: unknown) =>
        log.error('Temp file cleanup failed', { error: e instanceof Error ? e.message : 'unknown' }, 'MancoUpload')
      );
    }

    return apiResponse.success(res, { url: uploadResult.url, name: sanitizedName });
  } catch (error: unknown) {
    log.error('Error uploading manco document', { error }, 'MancoUpload');

    if (tempFilePath) {
      await fs.promises.unlink(tempFilePath).catch((e: unknown) =>
        log.error('Temp file cleanup failed', { error: e instanceof Error ? e.message : 'unknown' }, 'MancoUpload')
      );
    }

    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
