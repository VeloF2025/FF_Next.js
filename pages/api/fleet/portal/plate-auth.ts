/**
 * Fleet Portal - Plate-Based Authentication API
 * POST: Authenticate driver by scanning vehicle license plate
 *
 * This endpoint enables "scan plate = login" for the standalone vehicle portal.
 * No password required - the act of being physically present with the vehicle
 * and scanning its plate serves as authentication.
 *
 * Flow:
 * 1. Extract license plate text using VLM
 * 2. Look up vehicle in database by registration
 * 3. Get assigned driver from vehicle
 * 4. Create a portal session token
 * 5. Return token + vehicle/driver info
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { verifyLicensePlate } from '@/modules/fleet/services/fleetVlmService';
import { serialize, parse } from 'cookie';
import crypto from 'crypto';
import sharp from 'sharp';
import { MY_SESSION_COOKIE } from '@/modules/attendance/portal/sessionUtils';
import type { PortalSession } from '@/modules/fleet/portal/types';

const sql = neon(process.env.DATABASE_URL!);

// Portal session cookie name
export const PORTAL_SESSION_COOKIE = 'ff_portal_session';

// Portal session duration (8 hours - typical shift)
const PORTAL_SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

// HMAC signing secret for portal session tokens
const PORTAL_SESSION_SECRET = process.env.PORTAL_SESSION_SECRET;

// Max image dimensions for VLM
const MAX_IMAGE_WIDTH = 1024;
const MAX_IMAGE_HEIGHT = 768;

/**
 * Resize image to fit within VLM token limits
 */
async function resizeImageForVlm(base64Image: string): Promise<string> {
  const inputBuffer = Buffer.from(base64Image, 'base64');
  const metadata = await sharp(inputBuffer).metadata();
  const { width = 0, height = 0 } = metadata;

  if (width <= MAX_IMAGE_WIDTH && height <= MAX_IMAGE_HEIGHT) {
    return base64Image;
  }

  const resizedBuffer = await sharp(inputBuffer)
    .resize(MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer();

  return resizedBuffer.toString('base64');
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

interface PlateAuthRequest {
  platePhotoBase64: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'Unknown', ['POST']);
  }

  try {
    const body = req.body as PlateAuthRequest;

    if (!body.platePhotoBase64) {
      return apiResponse.error(
        res,
        ErrorCode.BAD_REQUEST,
        'Plate photo is required'
      );
    }

    // Step 1: Extract plate text using VLM
    let extractedPlate: string;
    let confidence: number;

    try {
      log.info('[portal-auth] Processing plate photo', {
        imageSizeKb: Math.round((body.platePhotoBase64?.length || 0) / 1024),
      });

      const resizedBase64 = await resizeImageForVlm(body.platePhotoBase64);
      const vlmResult = await verifyLicensePlate(resizedBase64, '');

      extractedPlate = vlmResult.plateText || '';
      confidence = vlmResult.confidence || 0;

      log.info('[portal-auth] VLM extraction result', {
        extractedPlate,
        confidence,
        hasError: !!vlmResult.error,
      });

      if (!extractedPlate || extractedPlate.length < 3) {
        return res.status(200).json({
          success: false,
          error: vlmResult.error || 'Could not read license plate from image. Please try again with a clearer photo.',
          extractedPlate: extractedPlate || '',
          confidence,
        });
      }
    } catch (vlmError) {
      const errorMessage = vlmError instanceof Error ? vlmError.message : 'Unknown error';
      log.error('[portal-auth] VLM extraction failed', { error: errorMessage });
      return res.status(200).json({
        success: false,
        error: `Failed to process plate image: ${errorMessage}`,
        extractedPlate: '',
        confidence: 0,
      });
    }

    // Step 2: Normalize and search for vehicle
    const normalizedPlate = extractedPlate.toUpperCase().replace(/[\s-]/g, '');

    let vehicleRows = await sql`
      SELECT
        id, registration, vehicle_type, make, model, year, color, status, assigned_driver_id
      FROM fleet_vehicles
      WHERE UPPER(REPLACE(REPLACE(registration, ' ', ''), '-', '')) = ${normalizedPlate}
        AND status = 'active'
      LIMIT 1
    ` as Array<{
      id: string;
      registration: string;
      vehicle_type: string;
      make: string | null;
      model: string | null;
      year: number | null;
      color: string | null;
      status: string;
      assigned_driver_id: string | null;
    }>;

    // Try partial match if no exact match
    if (vehicleRows.length === 0 && normalizedPlate.length >= 6) {
      const partialPlate = normalizedPlate.substring(0, 6);
      vehicleRows = await sql`
        SELECT
          id, registration, vehicle_type, make, model, year, color, status, assigned_driver_id
        FROM fleet_vehicles
        WHERE UPPER(REPLACE(REPLACE(registration, ' ', ''), '-', '')) LIKE ${partialPlate + '%'}
          AND status = 'active'
        LIMIT 1
      ` as typeof vehicleRows;
    }

    const vehicle = vehicleRows[0];
    if (!vehicle) {
      log.info('[portal-auth] No vehicle found', { extractedPlate, normalizedPlate });
      return res.status(200).json({
        success: false,
        error: `No active vehicle found with registration "${extractedPlate}". Please ensure the vehicle is registered in the system.`,
        extractedPlate,
        confidence,
      });
    }

    // Step 3: Get assigned driver details
    let driverName: string | null = null;
    let driverPhone: string | null = null;
    let driverIdNumber: string | null = null;

    if (vehicle.assigned_driver_id) {
      const staffRows = await sql`
        SELECT id, first_name, last_name, id_number, phone
        FROM staff
        WHERE id = ${vehicle.assigned_driver_id}
        LIMIT 1
      ` as Array<{
        id: string;
        first_name: string;
        last_name: string;
        id_number: string | null;
        phone: string | null;
      }>;

      const staff = staffRows[0];
      if (staff) {
        driverName = `${staff.first_name} ${staff.last_name}`.trim();
        driverPhone = staff.phone;
        driverIdNumber = staff.id_number;
      }
    }

    // Step 4: Create portal session
    const sessionId = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PORTAL_SESSION_DURATION_MS);

    // Store session in database for audit trail
    await sql`
      INSERT INTO fleet_portal_sessions (
        id,
        vehicle_id,
        driver_id,
        plate_scanned,
        confidence,
        created_at,
        expires_at,
        ip_address,
        user_agent
      ) VALUES (
        ${sessionId},
        ${vehicle.id},
        ${vehicle.assigned_driver_id},
        ${extractedPlate},
        ${confidence},
        ${now.toISOString()},
        ${expiresAt.toISOString()},
        ${req.headers['x-forwarded-for']?.toString().split(',')[0] || req.socket.remoteAddress || 'unknown'},
        ${req.headers['user-agent'] || 'unknown'}
      )
    `;

    // Step 5: Get last readings for the vehicle
    const odometerRows = await sql`
      SELECT reading, recorded_at, source
      FROM fleet_odometer_history
      WHERE vehicle_id = ${vehicle.id}
      ORDER BY recorded_at DESC
      LIMIT 1
    ` as Array<{ reading: number; recorded_at: string; source: string }>;

    const fuelRows = await sql`
      SELECT fuel_level, recorded_at, source
      FROM fleet_fuel_history
      WHERE vehicle_id = ${vehicle.id}
      ORDER BY recorded_at DESC
      LIMIT 1
    ` as Array<{ fuel_level: number; recorded_at: string; source: string }>;

    const lastCheckInRows = await sql`
      SELECT id, check_type, status, check_date, created_at, driver_name
      FROM fleet_check_records
      WHERE vehicle_id = ${vehicle.id}
      ORDER BY created_at DESC
      LIMIT 1
    ` as Array<{
      id: string;
      check_type: string;
      status: string;
      check_date: string;
      created_at: string;
      driver_name: string | null;
    }>;

    // Step 6: Set session cookie. If the request also carries an ff_my_session
    // cookie (PRD-040 SSO flow), tag the new portal session as source='my' so
    // logout still bounces back to /my instead of the plate-capture screen.
    // The plate scan itself is the presence + GPS proof — staff still scan
    // each visit, the SSO just spared them the second login.
    const hasMySession = Boolean(parse(req.headers.cookie || '')[MY_SESSION_COOKIE]);
    const sessionData: PortalSession = {
      sessionId,
      vehicleId: vehicle.id,
      vehicleRegistration: vehicle.registration,
      driverId: vehicle.assigned_driver_id,
      driverName,
      driverPhone,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      ...(hasMySession ? { source: 'my' as const } : {}),
    };

    // Encode session as base64 and sign with HMAC to prevent token forgery
    const payload = Buffer.from(JSON.stringify(sessionData)).toString('base64');
    if (!PORTAL_SESSION_SECRET) {
      log.error('[portal-auth] PORTAL_SESSION_SECRET env var not set - cannot sign session token');
      return apiResponse.internalError(res, new Error('Server configuration error'));
    }
    const signature = crypto.createHmac('sha256', PORTAL_SESSION_SECRET).update(payload).digest('hex');
    const sessionToken = `${payload}.${signature}`;

    res.setHeader(
      'Set-Cookie',
      serialize(PORTAL_SESSION_COOKIE, sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: PORTAL_SESSION_DURATION_MS / 1000,
      })
    );

    log.info('[portal-auth] Session created', {
      sessionId,
      vehicleId: vehicle.id,
      registration: vehicle.registration,
      driverId: vehicle.assigned_driver_id,
      driverName,
      expiresAt: expiresAt.toISOString(),
    });

    // Return success with vehicle and driver info
    return apiResponse.success(res, {
      extractedPlate,
      confidence,
      session: {
        sessionId,
        source: sessionData.source,
        expiresAt: expiresAt.toISOString(),
      },
      vehicle: {
        id: vehicle.id,
        registration: vehicle.registration,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        vehicleType: vehicle.vehicle_type,
        color: vehicle.color,
        assignedDriver: driverName ? {
          name: driverName,
          idNumber: driverIdNumber,
          phone: driverPhone,
        } : null,
        lastOdometer: odometerRows[0] ? {
          reading: odometerRows[0].reading,
          recordedAt: odometerRows[0].recorded_at,
          source: odometerRows[0].source,
        } : null,
        lastFuel: fuelRows[0] ? {
          level: fuelRows[0].fuel_level,
          recordedAt: fuelRows[0].recorded_at,
          source: fuelRows[0].source,
        } : null,
        lastCheckIn: lastCheckInRows[0] ? {
          id: lastCheckInRows[0].id,
          checkType: lastCheckInRows[0].check_type,
          status: lastCheckInRows[0].status,
          completedAt: lastCheckInRows[0].check_date || lastCheckInRows[0].created_at,
          completedBy: lastCheckInRows[0].driver_name,
        } : null,
      },
      driver: driverName ? {
        id: vehicle.assigned_driver_id,
        name: driverName,
        phone: driverPhone,
      } : null,
    });
  } catch (error) {
    log.error('[portal-auth] Authentication error', { error });
    return apiResponse.internalError(res, error);
  }
}
