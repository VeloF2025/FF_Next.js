/**
 * Fleet Portal - Verify License Plate API
 * POST: Extract plate from photo and match to vehicle
 *
 * Uses VLM to:
 * 1. Extract text from license plate image
 * 2. Look up vehicle in database by registration
 * 3. Return vehicle details or error
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { verifyLicensePlate } from '@/modules/fleet/services/fleetVlmService';
import fs from 'fs';
import path from 'path';

const sql = neon(process.env.DATABASE_URL!);

// Debug folder for saving plate photos
const DEBUG_PHOTO_DIR = '/tmp/fleet-plate-debug';

interface VerifyPlateRequest {
  platePhotoBase64: string;
}

interface VehicleRow {
  id: string;
  registration: string;
  vehicle_type: string;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  status: string;
  assigned_driver_id: string | null;
}

interface StaffRow {
  id: string;
  first_name: string;
  last_name: string;
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb', // Allow larger images
    },
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'Unknown', ['POST']);
  }

  try {
    const body = req.body as VerifyPlateRequest;

    if (!body.platePhotoBase64) {
      return apiResponse.error(
        res,
        ErrorCode.BAD_REQUEST,
        'Plate photo is required'
      );
    }

    // Step 1: Extract plate text using VLM
    // We'll call verifyLicensePlate with a dummy expected plate first to get the extracted text
    // Then search for the vehicle by that registration
    let extractedPlate: string;
    let confidence: number;

    try {
      // Log incoming request details for debugging
      const imageSize = body.platePhotoBase64?.length || 0;
      log.info('Plate verification request', {
        imageSize,
        imageSizeKb: Math.round(imageSize / 1024),
      });

      // Save debug photo to disk for troubleshooting
      try {
        if (!fs.existsSync(DEBUG_PHOTO_DIR)) {
          fs.mkdirSync(DEBUG_PHOTO_DIR, { recursive: true });
        }
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const debugFilePath = path.join(DEBUG_PHOTO_DIR, `plate-${timestamp}.jpg`);
        const imageBuffer = Buffer.from(body.platePhotoBase64, 'base64');
        fs.writeFileSync(debugFilePath, imageBuffer);
        log.info('Debug photo saved', { path: debugFilePath, size: imageBuffer.length });
      } catch (saveErr) {
        log.warn('Failed to save debug photo', { error: saveErr });
      }

      // Use the VLM service to extract plate
      const vlmResult = await verifyLicensePlate(body.platePhotoBase64, '');
      extractedPlate = vlmResult.plateText || '';
      confidence = vlmResult.confidence || 0;

      log.info('VLM plate extraction result', {
        extractedPlate,
        confidence,
        hasError: !!vlmResult.error,
        error: vlmResult.error,
      });

      if (!extractedPlate || extractedPlate.length < 3) {
        log.warn('Plate extraction failed - invalid result', {
          extractedPlate,
          confidence,
          vlmError: vlmResult.error,
          rawResponse: JSON.stringify(vlmResult).substring(0, 500),
        });

        // Rename debug file to indicate failure
        try {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const failedPath = path.join(DEBUG_PHOTO_DIR, `FAILED-plate-${timestamp}.jpg`);
          const imageBuffer = Buffer.from(body.platePhotoBase64, 'base64');
          fs.writeFileSync(failedPath, imageBuffer);
          log.info('Failed extraction photo saved', { path: failedPath });
        } catch (saveErr) {
          // Ignore save errors
        }

        return apiResponse.success(res, {
          success: false,
          extractedPlate: extractedPlate || '',
          confidence,
          vehicle: null,
          error: vlmResult.error || 'Could not extract a valid license plate from the image',
        });
      }
    } catch (vlmError) {
      const errorMessage = vlmError instanceof Error ? vlmError.message : 'Unknown error';
      log.error('VLM plate extraction failed', {
        error: errorMessage,
        stack: vlmError instanceof Error ? vlmError.stack : undefined,
      });
      return apiResponse.success(res, {
        success: false,
        extractedPlate: '',
        confidence: 0,
        vehicle: null,
        error: `Failed to process plate image: ${errorMessage}`,
      });
    }

    // Step 2: Normalize the extracted plate for database lookup
    // Remove spaces and convert to uppercase
    const normalizedPlate = extractedPlate
      .toUpperCase()
      .replace(/[\s-]/g, '');

    // Step 3: Search for vehicle in database
    // Try exact match first, then fuzzy match
    let vehicleRows = await sql`
      SELECT
        id, registration, vehicle_type, make, model, year, color, status, assigned_driver_id
      FROM fleet_vehicles
      WHERE UPPER(REPLACE(REPLACE(registration, ' ', ''), '-', '')) = ${normalizedPlate}
        AND status = 'active'
      LIMIT 1
    ` as VehicleRow[];

    // If no exact match, try partial matching (first 6 characters match)
    if (vehicleRows.length === 0 && normalizedPlate.length >= 6) {
      const partialPlate = normalizedPlate.substring(0, 6);
      vehicleRows = await sql`
        SELECT
          id, registration, vehicle_type, make, model, year, color, status, assigned_driver_id
        FROM fleet_vehicles
        WHERE UPPER(REPLACE(REPLACE(registration, ' ', ''), '-', '')) LIKE ${partialPlate + '%'}
          AND status = 'active'
        LIMIT 1
      ` as VehicleRow[];
    }

    if (vehicleRows.length === 0) {
      log.info('No vehicle found for plate', {
        extractedPlate,
        normalizedPlate,
      });
      return apiResponse.success(res, {
        success: false,
        extractedPlate,
        confidence,
        vehicle: null,
        error: `No active vehicle found with registration "${extractedPlate}"`,
      });
    }

    const vehicle = vehicleRows[0];

    // Step 4: Get assigned driver name if exists
    let assignedStaffName: string | null = null;
    if (vehicle.assigned_driver_id) {
      const staffRows = await sql`
        SELECT id, first_name, last_name
        FROM staff
        WHERE id = ${vehicle.assigned_driver_id}
        LIMIT 1
      ` as StaffRow[];

      if (staffRows.length > 0) {
        assignedStaffName = `${staffRows[0].first_name} ${staffRows[0].last_name}`.trim();
      }
    }

    log.info('Vehicle verified via plate', {
      extractedPlate,
      vehicleId: vehicle.id,
      registration: vehicle.registration,
      confidence,
    });

    return apiResponse.success(res, {
      success: true,
      extractedPlate,
      confidence,
      vehicle: {
        id: vehicle.id,
        registration: vehicle.registration,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        vehicleType: vehicle.vehicle_type,
        color: vehicle.color,
        assignedStaffName,
      },
    });
  } catch (error) {
    log.error('Plate verification error', { error });
    return apiResponse.internalError(res, error);
  }
}
