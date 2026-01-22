/**
 * API: Fleet Vehicle Calibration
 * GET /api/fleet/vehicles/[id]/calibration - Check calibration status
 * POST /api/fleet/vehicles/[id]/calibration - Create/update calibration
 *
 * Calibration is required before the first check-in for a vehicle.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import FormData from 'form-data';

const sql = neon(process.env.DATABASE_URL!);

// VF Storage Service configuration
const VF_STORAGE_URL = process.env.VF_STORAGE_URL || 'http://100.96.203.105:8091';
const STORAGE_PUBLIC_URL = process.env.STORAGE_PUBLIC_URL || '/storage';

interface CalibrationStatus {
  needsCalibration: boolean;
  hasCalibration: boolean;
  calibration: {
    id: string;
    vehicleId: string;
    calibratedAt: string;
    calibratedByName: string | null;
    baselineOdometer: number;
    baselineFuelLevel: number;
    dashboardPhotoUrl: string | null;
    vlmLearningStatus: string;
  } | null;
  checkCount: number;
}

interface CalibrationInput {
  baselineOdometer: number;
  baselineFuelLevel: number;
  dashboardPhotoDataUrl: string; // Base64 data URL
  calibratedByName: string;
  calibratedById?: string;
}

/**
 * Upload photo to VF Storage Service
 */
async function uploadCalibrationPhoto(
  dataUrl: string,
  vehicleId: string
): Promise<{ path: string; url: string }> {
  // Extract base64 data from data URL
  const matches = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!matches) {
    throw new Error('Invalid image data URL');
  }

  const extension = matches[1] === 'jpeg' ? 'jpg' : matches[1];
  const base64Data = matches[2];
  const buffer = Buffer.from(base64Data, 'base64');

  const filename = `calibration-${vehicleId}-${Date.now()}.${extension}`;

  const formData = new FormData();
  formData.append('file', buffer, {
    filename,
    contentType: `image/${matches[1]}`,
  });

  const uploadUrl = `${VF_STORAGE_URL}/upload/fleet/calibration`;
  log.info('Uploading calibration photo to storage', { uploadUrl, filename });

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
  log.info('Calibration photo uploaded', { result });

  return {
    path: result.path,
    url: `${STORAGE_PUBLIC_URL}/${result.path}`,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id: vehicleId } = req.query;

  if (!vehicleId || typeof vehicleId !== 'string') {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Vehicle ID is required');
  }

  try {
    switch (req.method) {
      case 'GET': {
        // Check if vehicle exists
        const [vehicle] = await sql`
          SELECT id, registration FROM fleet_vehicles WHERE id = ${vehicleId}
        `;

        if (!vehicle) {
          return apiResponse.notFound(res, 'Vehicle', vehicleId);
        }

        // Get active calibration if exists
        const [calibration] = await sql`
          SELECT
            id, vehicle_id, calibrated_at, calibrated_by_name,
            baseline_odometer, baseline_fuel_level,
            dashboard_photo_url, vlm_learning_status
          FROM fleet_vehicle_calibration
          WHERE vehicle_id = ${vehicleId} AND is_active = true
        `;

        // Count existing check records
        const [countResult] = await sql`
          SELECT COUNT(*)::int as count FROM fleet_check_records WHERE vehicle_id = ${vehicleId}
        `;
        const checkCount = countResult?.count || 0;

        // Vehicle needs calibration if:
        // 1. No active calibration exists AND
        // 2. No previous check records exist (not grandfathered)
        const needsCalibration = !calibration && checkCount === 0;

        const status: CalibrationStatus = {
          needsCalibration,
          hasCalibration: !!calibration,
          calibration: calibration ? {
            id: calibration.id,
            vehicleId: calibration.vehicle_id,
            calibratedAt: calibration.calibrated_at,
            calibratedByName: calibration.calibrated_by_name,
            baselineOdometer: calibration.baseline_odometer,
            baselineFuelLevel: calibration.baseline_fuel_level,
            dashboardPhotoUrl: calibration.dashboard_photo_url,
            vlmLearningStatus: calibration.vlm_learning_status,
          } : null,
          checkCount,
        };

        return apiResponse.success(res, status);
      }

      case 'POST': {
        const input: CalibrationInput = req.body;

        // Validate input
        if (typeof input.baselineOdometer !== 'number' || input.baselineOdometer < 0) {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Valid baseline odometer is required');
        }
        if (typeof input.baselineFuelLevel !== 'number' || input.baselineFuelLevel < 0 || input.baselineFuelLevel > 100) {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Fuel level must be 0-100');
        }
        if (!input.dashboardPhotoDataUrl) {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Dashboard photo is required');
        }
        if (!input.calibratedByName) {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Calibrator name is required');
        }

        // Check if vehicle exists
        const [vehicle] = await sql`
          SELECT id, registration FROM fleet_vehicles WHERE id = ${vehicleId}
        `;

        if (!vehicle) {
          return apiResponse.notFound(res, 'Vehicle', vehicleId);
        }

        // Upload dashboard photo to storage
        let photoUrl: string | null = null;
        let photoPath: string | null = null;

        try {
          const storage = await uploadCalibrationPhoto(input.dashboardPhotoDataUrl, vehicleId);
          photoUrl = storage.url;
          photoPath = storage.path;
        } catch (uploadError) {
          log.error('Failed to upload calibration photo', { vehicleId, error: uploadError });
          // Continue without photo if upload fails (not ideal but allows completion)
        }

        // Deactivate any existing calibration for this vehicle
        await sql`
          UPDATE fleet_vehicle_calibration
          SET is_active = false, superseded_at = NOW()
          WHERE vehicle_id = ${vehicleId} AND is_active = true
        `;

        // Create new calibration
        const [newCalibration] = await sql`
          INSERT INTO fleet_vehicle_calibration (
            vehicle_id,
            calibrated_by,
            calibrated_by_name,
            baseline_odometer,
            baseline_fuel_level,
            dashboard_photo_url,
            dashboard_photo_path,
            vlm_learning_status,
            is_active
          ) VALUES (
            ${vehicleId},
            ${input.calibratedById || null},
            ${input.calibratedByName},
            ${input.baselineOdometer},
            ${input.baselineFuelLevel},
            ${photoUrl},
            ${photoPath},
            'pending',
            true
          )
          RETURNING *
        `;

        // Log the calibration event to audit log
        await sql`
          INSERT INTO fleet_audit_log (
            vehicle_id,
            calibration_id,
            event_type,
            event_category,
            severity,
            event_data,
            performed_by_name,
            performed_by
          ) VALUES (
            ${vehicleId},
            ${newCalibration.id},
            'vehicle_calibrated',
            'calibration',
            'info',
            ${JSON.stringify({
              baselineOdometer: input.baselineOdometer,
              baselineFuelLevel: input.baselineFuelLevel,
              photoUrl,
            })},
            ${input.calibratedByName},
            ${input.calibratedById || null}
          )
        `;

        log.info('Vehicle calibration created', {
          vehicleId,
          calibrationId: newCalibration.id,
          baselineOdometer: input.baselineOdometer,
          baselineFuelLevel: input.baselineFuelLevel,
        });

        return apiResponse.created(res, {
          id: newCalibration.id,
          vehicleId: newCalibration.vehicle_id,
          calibratedAt: newCalibration.calibrated_at,
          calibratedByName: newCalibration.calibrated_by_name,
          baselineOdometer: newCalibration.baseline_odometer,
          baselineFuelLevel: newCalibration.baseline_fuel_level,
          dashboardPhotoUrl: newCalibration.dashboard_photo_url,
          vlmLearningStatus: newCalibration.vlm_learning_status,
        });
      }

      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
    }
  } catch (error) {
    log.error('Calibration API error', { vehicleId, method: req.method, error });
    return apiResponse.internalError(res, error);
  }
}
