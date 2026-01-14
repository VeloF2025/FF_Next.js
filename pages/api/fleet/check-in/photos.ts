/**
 * API: Fleet Check-In Photos
 * GET /api/fleet/check-in/photos?recordId=xxx - Get photos for a record
 * POST /api/fleet/check-in/photos - Upload a photo
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import {
  getPhotosForRecord,
  addCheckPhoto,
} from '@/modules/fleet/services/checkInService';
import type { CheckPhotoType } from '@/modules/fleet/types/check-in.types';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function parseForm(req: NextApiRequest): Promise<{
  fields: formidable.Fields;
  files: formidable.Files;
}> {
  return new Promise((resolve, reject) => {
    const form = formidable({
      maxFileSize: 10 * 1024 * 1024, // 10MB
    });
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    switch (req.method) {
      case 'GET': {
        const { recordId } = req.query;

        if (!recordId || typeof recordId !== 'string') {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Record ID is required');
        }

        const photos = await getPhotosForRecord(recordId);
        return apiResponse.success(res, photos);
      }

      case 'POST': {
        const { fields, files } = await parseForm(req);

        const recordId = Array.isArray(fields.recordId) ? fields.recordId[0] : fields.recordId;
        const photoType = Array.isArray(fields.photoType) ? fields.photoType[0] : fields.photoType;
        const responseId = Array.isArray(fields.responseId) ? fields.responseId[0] : fields.responseId;
        const latitude = Array.isArray(fields.latitude) ? fields.latitude[0] : fields.latitude;
        const longitude = Array.isArray(fields.longitude) ? fields.longitude[0] : fields.longitude;

        if (!recordId) {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Record ID is required');
        }
        if (!photoType) {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Photo type is required');
        }

        const file = Array.isArray(files.file) ? files.file[0] : files.file;
        if (!file) {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'File is required');
        }

        // Read file content
        const fileContent = fs.readFileSync(file.filepath);
        const base64 = fileContent.toString('base64');
        const mimeType = file.mimetype || 'image/jpeg';

        // Save to local storage directory
        const storagePath = `/uploads/fleet-check-ins/${recordId}`;
        const fileName = `${photoType}-${Date.now()}${path.extname(file.originalFilename || '.jpg')}`;

        // Ensure directory exists
        const fullDir = path.join(process.cwd(), 'public', storagePath);
        if (!fs.existsSync(fullDir)) {
          fs.mkdirSync(fullDir, { recursive: true });
        }

        // Write file
        const fullPath = path.join(fullDir, fileName);
        fs.writeFileSync(fullPath, fileContent);

        const fileUrl = `${storagePath}/${fileName}`;

        // Add to database
        const photo = await addCheckPhoto({
          recordId,
          responseId: responseId || undefined,
          photoType: photoType as CheckPhotoType,
          isRequired: ['front', 'rear', 'dashboard'].includes(photoType),
          fileUrl,
          filePath: fullPath,
          fileSize: file.size,
          latitude: latitude ? parseFloat(latitude) : undefined,
          longitude: longitude ? parseFloat(longitude) : undefined,
        });

        // Clean up temp file
        fs.unlinkSync(file.filepath);

        return apiResponse.created(res, photo);
      }

      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
    }
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}
