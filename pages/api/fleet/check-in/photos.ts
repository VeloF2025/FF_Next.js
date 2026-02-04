/**
 * API: Fleet Check-In Photos
 * GET /api/fleet/check-in/photos?recordId=xxx - Get photos for a record
 * POST /api/fleet/check-in/photos - Upload a photo
 *
 * Photos are stored via VF Storage Service (port 8091)
 * and served via nginx proxy at /storage/
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import {
  getPhotosForRecord,
  addCheckPhoto,
} from '@/modules/fleet/services/checkInService';
import type { CheckPhotoType } from '@/modules/fleet/types/check-in.types';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import { log } from '@/lib/logger';
import { withFleetAuth } from '@/lib/auth/middleware';

const sql = neon(process.env.DATABASE_URL!);

// VF Storage Service configuration
const VF_STORAGE_URL = process.env.VF_STORAGE_URL || 'http://100.96.203.105:8091';
const STORAGE_PUBLIC_URL = process.env.STORAGE_PUBLIC_URL || '/storage';

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

/**
 * Upload file to VF Storage Service
 * Returns the storage path and URL
 */
async function uploadToStorage(
  fileContent: Buffer,
  filename: string,
  category: string = 'check-ins'
): Promise<{ path: string; url: string; storageServiceUrl: string }> {
  const formData = new FormData();
  formData.append('file', fileContent, {
    filename,
    contentType: 'image/jpeg',
  });

  const uploadUrl = `${VF_STORAGE_URL}/upload/fleet/${category}`;
  log.info('Uploading to VF Storage', { uploadUrl, filename });

  const response = await fetch(uploadUrl, {
    method: 'POST',
    body: formData as unknown as BodyInit,
    headers: formData.getHeaders?.() || {},
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Storage upload failed: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  log.info('Storage upload successful', { result });

  // Return both the internal storage URL and public URL
  return {
    path: result.path, // e.g., 'fleet/check-ins/1705618234567-abc123.jpg'
    url: `${STORAGE_PUBLIC_URL}/${result.path}`, // e.g., '/storage/fleet/check-ins/...'
    storageServiceUrl: result.url, // Full internal URL
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
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
        const vehicleId = Array.isArray(fields.vehicleId) ? fields.vehicleId[0] : fields.vehicleId;

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

        // Generate filename with metadata
        const ext = path.extname(file.originalFilename || '.jpg');
        const timestamp = Date.now();
        const fileName = `${recordId}-${photoType}-${timestamp}${ext}`;

        // Upload to VF Storage Service
        const storage = await uploadToStorage(fileContent, fileName, 'check-ins');

        // Add to database with both URLs
        const photo = await addCheckPhoto({
          recordId,
          responseId: responseId || undefined,
          photoType: photoType as CheckPhotoType,
          isRequired: ['front', 'rear', 'dashboard'].includes(photoType),
          fileUrl: storage.url, // Public URL via nginx proxy
          filePath: storage.path, // Storage path for reference
          fileSize: file.size,
          latitude: latitude ? parseFloat(latitude) : undefined,
          longitude: longitude ? parseFloat(longitude) : undefined,
          storageServiceUrl: storage.storageServiceUrl, // Full internal URL
        });

        // Clean up temp file
        fs.unlinkSync(file.filepath);

        log.info('Fleet photo uploaded successfully', {
          recordId,
          photoType,
          vehicleId,
          storagePath: storage.path,
        });

        // If this is a verification override photo, log to audit trail
        if (photoType === 'odometer_override') {
          try {
            // Get the vehicle ID and driver info from the check record
            const [checkRecord] = await sql`
              SELECT vehicle_id, driver_name, driver_id
              FROM fleet_check_records
              WHERE id = ${recordId}
            `;

            if (checkRecord) {
              // Additional metadata from form fields
              const originalVlmValue = Array.isArray(fields.originalVlmValue)
                ? fields.originalVlmValue[0]
                : fields.originalVlmValue;
              const overrideValue = Array.isArray(fields.overrideValue)
                ? fields.overrideValue[0]
                : fields.overrideValue;
              const overrideReason = Array.isArray(fields.overrideReason)
                ? fields.overrideReason[0]
                : fields.overrideReason;

              await sql`
                INSERT INTO fleet_audit_log (
                  vehicle_id,
                  record_id,
                  photo_id,
                  event_type,
                  event_category,
                  severity,
                  event_data,
                  verification_photo_url,
                  performed_by_name,
                  performed_by
                ) VALUES (
                  ${checkRecord.vehicle_id},
                  ${recordId},
                  ${photo.id},
                  'verified_override',
                  'override',
                  'warning',
                  ${JSON.stringify({
                    originalVlmValue: originalVlmValue || null,
                    overrideValue: overrideValue || null,
                    reason: overrideReason || 'Manual verification required',
                    photoType: 'odometer_override',
                  })},
                  ${storage.url},
                  ${checkRecord.driver_name},
                  ${checkRecord.driver_id}
                )
              `;

              log.info('Audit log created for odometer override', {
                vehicleId: checkRecord.vehicle_id,
                recordId,
                photoId: photo.id,
              });
            }
          } catch (auditError) {
            // Log error but don't fail the upload
            log.error('Failed to create audit log for override', { error: auditError });
          }
        }

        return apiResponse.created(res, photo);
      }

      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
    }
  } catch (error) {
    log.error('Fleet photo upload error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withFleetAuth(handler);
