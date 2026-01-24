/**
 * Enhanced BOQ Import API
 * POST - Import BOQ from Excel with material matching
 *
 * Created: 2026-01-17
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm, File } from 'formidable';
import fs from 'fs';
import { apiResponse } from '@/lib/apiResponse';
import { createBOQImportEnhanced, ImportOptions } from '@/services/procurement/import';
import type { BOQImportResult } from '@/types/procurement/material-catalog.types';
import { withAuth } from '@/lib/auth';

// Disable body parser for file upload
export const config = {
  api: {
    bodyParser: false,
  },
};

const DATABASE_URL = process.env.DATABASE_URL!;

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  try {
    // Parse multipart form data
    const { fields, files } = await parseForm(req);

    // Extract options from form fields
    const projectId = Array.isArray(fields.projectId) ? fields.projectId[0] : fields.projectId;
    const boqId = Array.isArray(fields.boqId) ? fields.boqId[0] : fields.boqId;
    const userId = Array.isArray(fields.userId) ? fields.userId[0] : fields.userId;
    const createBudgetItems = fields.createBudgetItems !== 'false';
    const createMaterials = fields.createMaterials !== 'false';
    const dryRun = fields.dryRun === 'true';

    if (!projectId) {
      return apiResponse.validationError(res, {
        projectId: 'Project ID is required',
      });
    }

    // Get uploaded file
    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!file) {
      return apiResponse.validationError(res, {
        file: 'File is required',
      });
    }

    // Read file buffer
    const fileBuffer = fs.readFileSync(file.filepath);

    // Create import service and process
    const importService = createBOQImportEnhanced(DATABASE_URL);

    const options: ImportOptions = {
      projectId: projectId as string,
      boqId: boqId as string | undefined,
      userId: userId as string | undefined,
      createBudgetItems,
      createMaterials,
      dryRun,
    };

    const result = await importService.importFromBuffer(
      fileBuffer.buffer.slice(
        fileBuffer.byteOffset,
        fileBuffer.byteOffset + fileBuffer.byteLength
      ),
      options
    );

    // Clean up temp file
    fs.unlinkSync(file.filepath);

    if (result.success) {
      return apiResponse.success(res, result, 'BOQ imported successfully');
    } else {
      return apiResponse.error(res, 'BUSINESS_RULE_VIOLATION' as never, 'Import completed with errors', {
        result,
        errors: result.errors,
      });
    }
  } catch (error) {
    console.error('BOQ Import Error:', error);
    return apiResponse.internalError(res, error, 'Failed to import BOQ');
  }
}

/**
 * Parse multipart form data
 */
function parseForm(
  req: NextApiRequest
): Promise<{ fields: Record<string, string | string[]>; files: Record<string, File | File[]> }> {
  return new Promise((resolve, reject) => {
    const form = new IncomingForm({
      keepExtensions: true,
      maxFileSize: 50 * 1024 * 1024, // 50MB
    });

    form.parse(req, (err, fields, files) => {
      if (err) {
        reject(err);
      } else {
        resolve({
          fields: fields as Record<string, string | string[]>,
          files: files as Record<string, File | File[]>,
        });
      }
    });
  });
}

export default withAuth(handler);
