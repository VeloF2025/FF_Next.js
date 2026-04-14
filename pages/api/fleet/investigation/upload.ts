/**
 * Fleet GPS Investigation Upload API
 * Upload GPS Excel file and create investigation job
 *
 * POST /api/fleet/investigation/upload - Upload GPS file and start processing
 *
 * Request body (multipart/form-data):
 * - file: GPS Excel file (.xls, .xlsx)
 * - vehicleId: UUID of the vehicle
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { getSql } from '@/lib/neon-sql';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { parseGPSExcel, classifyTrips } from '@/modules/fleet';
import type { AuthorizedLocation, ClassifiedTrip } from '@/modules/fleet/types';
import formidable from 'formidable';
import fs from 'fs';
import { detectPatterns, calculateTotalCosts } from '@/modules/fleet';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

// Disable body parser for file uploads
export const config = {
  api: {
    bodyParser: false,
  },
};

const getSqlInstance = () => getSql();

/** Validate file content matches Excel format by checking magic bytes */
function validateExcelMagicBytes(buffer: Buffer): { valid: boolean; detectedType: string } {
  if (buffer.length < 4) return { valid: false, detectedType: 'unknown' };
  const hex = buffer.subarray(0, 8).toString('hex').toUpperCase();
  if (hex.startsWith('D0CF11E0')) return { valid: true, detectedType: 'application/vnd.ms-excel' };
  if (hex.startsWith('504B0304')) return { valid: true, detectedType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  return { valid: false, detectedType: 'unknown' };
}

// Max file size: 50MB
const MAX_FILE_SIZE = 50 * 1024 * 1024;

interface ParsedForm {
  fields: formidable.Fields;
  files: formidable.Files;
}

async function parseForm(req: NextApiRequest): Promise<ParsedForm> {
  return new Promise((resolve, reject) => {
    const form = formidable({
      maxFileSize: MAX_FILE_SIZE,
      filter: (part) => {
        // Only accept Excel files
        return part.mimetype?.includes('spreadsheet') ||
          part.mimetype?.includes('excel') ||
          part.originalFilename?.endsWith('.xlsx') ||
          part.originalFilename?.endsWith('.xls') ||
          false;
      },
    });

    form.parse(req, (err, fields, files) => {
      if (err) {
        reject(err);
      } else {
        resolve({ fields, files });
      }
    });
  });
}

export default withAuth(withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const sql = getSqlInstance();

  try {
    // Parse multipart form
    const { fields, files } = await parseForm(req);

    // Get vehicle ID
    const vehicleIdField = fields.vehicleId;
    const vehicleId = Array.isArray(vehicleIdField) ? vehicleIdField[0] : vehicleIdField;

    if (!vehicleId) {
      return apiResponse.validationError(res, { vehicleId: 'Vehicle ID is required' });
    }

    // Verify vehicle exists
    const vehicles = await sql`
      SELECT id, registration, fuel_rate_per_km, depreciation_rate_per_km
      FROM fleet_vehicles
      WHERE id = ${vehicleId}
    ` as Record<string, unknown>[];

    if (vehicles.length === 0) {
      return apiResponse.notFound(res, 'Vehicle', vehicleId);
    }

    const vehicle = vehicles[0];

    // Get uploaded file
    const fileField = files.file;
    const uploadedFile = Array.isArray(fileField) ? fileField[0] : fileField;

    if (!uploadedFile) {
      return apiResponse.validationError(res, { file: 'GPS file is required' });
    }

    // Validate file extension
    const fileName = uploadedFile.originalFilename || 'upload.xlsx';
    if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls')) {
      return apiResponse.validationError(res, {
        file: 'Invalid file type. Upload .xls or .xlsx file',
      });
    }

    // Read file buffer
    const fileBuffer = await fs.promises.readFile(uploadedFile.filepath);

    // Validate magic bytes match Excel format
    const { valid: magicValid } = validateExcelMagicBytes(fileBuffer);
    if (!magicValid) {
      await fs.promises.unlink(uploadedFile.filepath).catch((e) => log.debug('Temp file cleanup failed', { error: e instanceof Error ? e.message : 'unknown' }, 'FLEET_INVESTIGATION'));
      return apiResponse.validationError(res, { file: 'File content does not match Excel format (.xls or .xlsx).' });
    }

    // Clean up temp file
    await fs.promises.unlink(uploadedFile.filepath).catch((e) => log.debug('Temp file cleanup failed', { error: e instanceof Error ? e.message : 'unknown' }, 'FLEET_INVESTIGATION'));

    // Create job record
    const jobs = await sql`
      INSERT INTO fleet_gps_jobs (
        vehicle_id,
        file_name,
        file_size,
        status,
        progress
      )
      VALUES (
        ${vehicleId},
        ${fileName},
        ${uploadedFile.size},
        'processing',
        10
      )
      RETURNING id
    ` as Record<string, unknown>[];

    const jobId = (jobs[0]?.id as string) || '';

    // Parse GPS file
    const parseResult = await parseGPSExcel(fileBuffer);

    if (!parseResult.success) {
      // Update job with error
      await sql`
        UPDATE fleet_gps_jobs
        SET status = 'failed', error_message = ${parseResult.errors.join('; ')}, progress = 100
        WHERE id = ${jobId}
      `;

      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Failed to parse GPS file', {
        errors: parseResult.errors,
        warnings: parseResult.warnings,
      });
    }

    // Update job progress
    await sql`
      UPDATE fleet_gps_jobs
      SET
        progress = 30,
        period_start = ${parseResult.periodStart},
        period_end = ${parseResult.periodEnd},
        total_gps_points = ${parseResult.totalPoints}
      WHERE id = ${jobId}
    `;

    // Get authorized locations for classification
    const authorizedLocations = await sql`
      SELECT
        id,
        name,
        lat,
        lon,
        radius_km as "radiusKm",
        location_type as "locationType",
        is_global as "isGlobal",
        vehicle_id as "vehicleId"
      FROM fleet_authorized_locations
      WHERE is_active = true
        AND (is_global = true OR vehicle_id = ${vehicleId})
    ` as Record<string, unknown>[];

    // Format authorized locations for classifier
    const locationsForClassifier = authorizedLocations.map((loc) => ({
      id: loc.id as string,
      name: loc.name as string,
      lat: parseFloat(loc.lat as string),
      lon: parseFloat(loc.lon as string),
      radiusKm: parseFloat(loc.radiusKm as string),
      locationType: loc.locationType as string,
      isGlobal: loc.isGlobal as boolean,
      vehicleId: loc.vehicleId as string | null,
    }));

    // Update progress
    await sql`UPDATE fleet_gps_jobs SET progress = 50 WHERE id = ${jobId}`;

    // Classify trips - pass the parsed trips directly
    const classifiedTrips = classifyTrips(
      parseResult.trips,
      locationsForClassifier,
      vehicleId
    );

    // Update progress
    await sql`UPDATE fleet_gps_jobs SET progress = 70 WHERE id = ${jobId}`;

    // Save trips to database
    for (const classified of classifiedTrips) {
      await sql`
        INSERT INTO fleet_gps_trips (
          job_id,
          trip_number,
          start_time,
          end_time,
          start_lat,
          start_lon,
          end_lat,
          end_lon,
          start_location,
          end_location,
          distance_km,
          classification,
          time_category,
          day_type,
          is_work_hours_violation,
          nearest_auth_location,
          distance_from_auth_km
        )
        VALUES (
          ${jobId},
          ${classified.tripNumber},
          ${classified.startTime},
          ${classified.endTime},
          ${classified.startLat},
          ${classified.startLon},
          ${classified.endLat},
          ${classified.endLon},
          ${classified.startLocation},
          ${classified.endLocation},
          ${classified.distanceKm},
          ${classified.classification},
          ${classified.timeCategory},
          ${classified.dayType},
          ${classified.isWorkHoursViolation},
          ${classified.nearestAuthLocation},
          ${classified.distanceFromAuthKm}
        )
      `;
    }

    // Update progress
    await sql`UPDATE fleet_gps_jobs SET progress = 85 WHERE id = ${jobId}`;

    // Detect patterns
    const tripsForPatterns = classifiedTrips.map((t) => ({
      id: `trip-${t.tripNumber}`,
      classification: t.classification,
      dayType: t.dayType,
      timeCategory: t.timeCategory,
      distanceKm: t.distanceKm,
      isWorkHoursViolation: t.isWorkHoursViolation,
      pois: [] as Array<{ category: string; name: string; isSuspicious: boolean; riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; distanceMeters: number }>,
      startTime: t.startTime,
      endTime: t.endTime,
    }));

    const fuelRate = parseFloat((vehicle?.fuel_rate_per_km as string) || '3.0');
    const depreciationRate = parseFloat((vehicle?.depreciation_rate_per_km as string) || '1.5');

    const patterns = detectPatterns(tripsForPatterns, fuelRate, depreciationRate);

    // Calculate costs
    const costs = calculateTotalCosts(
      classifiedTrips.map((t) => ({ distanceKm: t.distanceKm, classification: t.classification })),
      fuelRate,
      depreciationRate
    );

    // Calculate summary stats
    const authorizedTrips = classifiedTrips.filter((t) => t.classification === 'AUTHORIZED');
    const unauthorizedTrips = classifiedTrips.filter((t) => t.classification === 'UNAUTHORIZED');
    const weekendTrips = classifiedTrips.filter((t) => t.dayType === 'WEEKEND');
    const afterHoursTrips = classifiedTrips.filter((t) => t.timeCategory === 'AFTER_HOURS' || t.timeCategory === 'NIGHT_TRAVEL');
    const workViolations = classifiedTrips.filter((t) => t.isWorkHoursViolation);

    // Save investigation summary
    await sql`
      INSERT INTO fleet_investigation_summaries (
        job_id,
        total_trips,
        authorized_trips,
        unauthorized_trips,
        total_km,
        authorized_km,
        unauthorized_km,
        weekend_trips,
        after_hours_trips,
        work_hours_violations,
        suspicious_poi_visits,
        unauthorized_nights,
        total_cost,
        unauthorized_cost
      )
      VALUES (
        ${jobId},
        ${classifiedTrips.length},
        ${authorizedTrips.length},
        ${unauthorizedTrips.length},
        ${costs.totalKm},
        ${costs.authorizedKm},
        ${costs.unauthorizedKm},
        ${weekendTrips.length},
        ${afterHoursTrips.length},
        ${workViolations.length},
        ${0}, -- POI visits (to be implemented)
        ${patterns.find((p) => p.type === 'CONSECUTIVE_UNAUTHORIZED_NIGHTS')?.count || 0},
        ${costs.totalCost},
        ${costs.unauthorizedCost}
      )
    `;

    // Mark job as complete
    await sql`
      UPDATE fleet_gps_jobs
      SET status = 'completed', progress = 100, completed_at = NOW()
      WHERE id = ${jobId}
    `;

    // Return result
    return apiResponse.created(res, {
      jobId,
      vehicleId,
      fileName,
      status: 'completed',
      summary: {
        totalTrips: classifiedTrips.length,
        authorizedTrips: authorizedTrips.length,
        unauthorizedTrips: unauthorizedTrips.length,
        totalKm: costs.totalKm,
        unauthorizedKm: costs.unauthorizedKm,
        totalCost: costs.totalCost,
        unauthorizedCost: costs.unauthorizedCost,
        patterns: patterns.length,
      },
      periodStart: parseResult.periodStart,
      periodEnd: parseResult.periodEnd,
      vehicleInfo: parseResult.vehicleInfo,
    }, 'GPS investigation completed successfully');
  } catch (error: any) {
    log.error('Operation failed', { error: { error } }, 'UploadApi');
    // Handle formidable errors
    if (error.message?.includes('maxFileSize')) {
      return apiResponse.error(res, ErrorCode.PAYLOAD_TOO_LARGE, 'File size exceeds 50MB limit');
    }

    throw error;
  }
}));
