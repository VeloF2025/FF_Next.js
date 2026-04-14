import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import fs from 'fs';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { detectColumns } from '@/services/procurement/import/columnDetector';

export const config = {
  api: {
    bodyParser: false, // Required for file uploads
  },
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  // Force connection close to prevent Cloudflare tunnel response buffering
  res.setHeader('Connection', 'close');

  try {
    // Parse the multipart form data
    const form = formidable({
      maxFileSize: 10 * 1024 * 1024, // 10MB limit
      keepExtensions: true,
    });

    const [fields, files] = await new Promise<[formidable.Fields, formidable.Files]>(
      (resolve, reject) => {
        form.parse(req, (err, fields, files) => {
          if (err) reject(err);
          else resolve([fields, files]);
        });
      }
    );

    // Extract the uploaded file
    const fileArray = files.file;
    if (!fileArray || fileArray.length === 0) {
      return apiResponse.badRequest(res, 'No file uploaded');
    }

    const uploadedFile = Array.isArray(fileArray) ? fileArray[0] : fileArray;

    if (!uploadedFile || !uploadedFile.filepath) {
      return apiResponse.badRequest(res, 'Invalid file upload');
    }

    log.info('Processing BOQ file for column detection', {
      data: {
        filename: uploadedFile.originalFilename,
        size: uploadedFile.size,
        mimetype: uploadedFile.mimetype,
      }
    }, 'boq-detect-columns');

    // Read file into buffer
    const fileBuffer = fs.readFileSync(uploadedFile.filepath);
    const arrayBuffer = fileBuffer.buffer.slice(
      fileBuffer.byteOffset,
      fileBuffer.byteOffset + fileBuffer.byteLength
    );

    // Detect columns
    const result = await detectColumns(arrayBuffer, process.env.DATABASE_URL!);

    // Clean up temporary file
    fs.unlinkSync(uploadedFile.filepath);

    log.info('Column detection completed', {
      data: {
        mappedColumns: result.mapping.filter((m: { targetField: string | null }) => m.targetField !== null).length,
        confidence: result.overallConfidence,
      }
    }, 'boq-detect-columns');

    return apiResponse.success(res, result);
  } catch (error) {
    log.error('Column detection failed', { data: error }, 'boq-detect-columns');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
