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
import sharp from 'sharp';

const sql = neon(process.env.DATABASE_URL!);

// Debug folder for saving plate photos
const DEBUG_PHOTO_DIR = '/tmp/fleet-plate-debug';

// Max image dimensions for VLM (to stay under token limit)
const MAX_IMAGE_WIDTH = 1024;
const MAX_IMAGE_HEIGHT = 768;

/**
 * Resize image to fit within VLM token limits
 * iPhone photos can be 4000x3000 which exceeds the model's context
 */
async function resizeImageForVlm(base64Image: string): Promise<string> {
  const inputBuffer = Buffer.from(base64Image, 'base64');

  // Get image metadata
  const metadata = await sharp(inputBuffer).metadata();
  const { width = 0, height = 0 } = metadata;

  // Only resize if image is too large
  if (width <= MAX_IMAGE_WIDTH && height <= MAX_IMAGE_HEIGHT) {
    log.info('Image within limits, no resize needed', { width, height });
    return base64Image;
  }

  log.info('Resizing large image for VLM', {
    originalWidth: width,
    originalHeight: height,
    targetMax: `${MAX_IMAGE_WIDTH}x${MAX_IMAGE_HEIGHT}`
  });

  // Resize maintaining aspect ratio
  const resizedBuffer = await sharp(inputBuffer)
    .resize(MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer();

  const newMetadata = await sharp(resizedBuffer).metadata();
  log.info('Image resized', {
    newWidth: newMetadata.width,
    newHeight: newMetadata.height,
    originalSize: inputBuffer.length,
    newSize: resizedBuffer.length
  });

  return resizedBuffer.toString('base64');
}

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
  id_number: string | null;
  phone: string | null;
}

interface OdometerRow {
  reading: number;
  recorded_at: string;
  source: string;
}

interface FuelRow {
  fuel_level: number;
  recorded_at: string;
  source: string;
}

interface CheckInRow {
  id: string;
  check_type: string;
  status: string;
  completed_at: string | null;
  created_at: string;
  staff_first_name: string | null;
  staff_last_name: string | null;
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

      // Resize image to fit VLM token limits (iPhone photos can be huge)
      const resizedBase64 = await resizeImageForVlm(body.platePhotoBase64);

      // Use the VLM service to extract plate
      const vlmResult = await verifyLicensePlate(resizedBase64, '');
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

    // Step 4: Get assigned driver details if exists
    let assignedDriver: {
      name: string;
      idNumber: string | null;
      phone: string | null;
    } | null = null;

    if (vehicle.assigned_driver_id) {
      const staffRows = await sql`
        SELECT id, first_name, last_name, id_number, phone
        FROM staff
        WHERE id = ${vehicle.assigned_driver_id}
        LIMIT 1
      ` as StaffRow[];

      if (staffRows.length > 0) {
        assignedDriver = {
          name: `${staffRows[0].first_name} ${staffRows[0].last_name}`.trim(),
          idNumber: staffRows[0].id_number,
          phone: staffRows[0].phone,
        };
      }
    }

    // Step 5: Get last confirmed odometer and fuel readings
    let lastOdometer: { reading: number; recordedAt: string; source: string } | null = null;
    let lastFuel: { level: number; recordedAt: string; source: string } | null = null;

    // Fetch last odometer reading
    const odometerRows = await sql`
      SELECT reading, recorded_at, source
      FROM fleet_odometer_history
      WHERE vehicle_id = ${vehicle.id}
      ORDER BY recorded_at DESC
      LIMIT 1
    ` as OdometerRow[];

    if (odometerRows.length > 0) {
      lastOdometer = {
        reading: odometerRows[0].reading,
        recordedAt: odometerRows[0].recorded_at,
        source: odometerRows[0].source,
      };
    }

    // Fetch last fuel level from VLM results
    const fuelRows = await sql`
      SELECT fuel_level, recorded_at, source
      FROM fleet_fuel_history
      WHERE vehicle_id = ${vehicle.id}
      ORDER BY recorded_at DESC
      LIMIT 1
    ` as FuelRow[];

    if (fuelRows.length > 0) {
      lastFuel = {
        level: fuelRows[0].fuel_level,
        recordedAt: fuelRows[0].recorded_at,
        source: fuelRows[0].source,
      };
    }

    // Step 6: Get last check-in record
    let lastCheckIn: {
      id: string;
      checkType: string;
      status: string;
      completedAt: string | null;
      completedBy: string | null;
    } | null = null;

    const checkInRows = await sql`
      SELECT
        fcr.id,
        fcr.check_type,
        fcr.status,
        fcr.completed_at,
        fcr.created_at,
        s.first_name as staff_first_name,
        s.last_name as staff_last_name
      FROM fleet_check_records fcr
      LEFT JOIN staff s ON fcr.staff_id = s.id
      WHERE fcr.vehicle_id = ${vehicle.id}
      ORDER BY fcr.created_at DESC
      LIMIT 1
    ` as CheckInRow[];

    if (checkInRows.length > 0) {
      const row = checkInRows[0];
      lastCheckIn = {
        id: row.id,
        checkType: row.check_type,
        status: row.status,
        completedAt: row.completed_at || row.created_at,
        completedBy: row.staff_first_name
          ? `${row.staff_first_name} ${row.staff_last_name || ''}`.trim()
          : null,
      };
    }

    log.info('Vehicle verified via plate', {
      extractedPlate,
      vehicleId: vehicle.id,
      registration: vehicle.registration,
      confidence,
      hasDriver: !!assignedDriver,
      hasLastOdometer: !!lastOdometer,
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
        assignedStaffName: assignedDriver?.name || null,
        assignedDriver,
        lastOdometer,
        lastFuel,
        lastCheckIn,
      },
    });
  } catch (error) {
    log.error('Plate verification error', { error });
    return apiResponse.internalError(res, error);
  }
}
