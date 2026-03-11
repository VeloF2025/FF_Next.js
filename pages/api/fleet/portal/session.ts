/**
 * Fleet Portal - Session Check API
 * GET: Check if user has a valid portal session
 *
 * Returns current session data if authenticated via plate scan.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import {
import { log } from '@/lib/logger';
  verifyPortalSession,
} from '@/modules/fleet/portal/portalSessionUtils';

const sql = neon(process.env.DATABASE_URL!);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'Unknown', ['GET']);
  }

  try {
    const { valid, session, error } = await verifyPortalSession(req);

    if (!valid || !session) {
      // Return 200 with null session - NOT 401
      // The portal uses plate-based auth, not user auth, so no session is normal
      return apiResponse.success(res, {
        session: null,
        vehicle: null,
        driver: null,
        reason: error || 'No active portal session',
      });
    }

    // Fetch full vehicle and driver details
    const vehicleRows = await sql`
      SELECT
        id, registration, vehicle_type, make, model, year, color, assigned_driver_id
      FROM fleet_vehicles
      WHERE id = ${session.vehicleId}
      LIMIT 1
    ` as Array<{
      id: string;
      registration: string;
      vehicle_type: string;
      make: string | null;
      model: string | null;
      year: number | null;
      color: string | null;
      assigned_driver_id: string | null;
    }>;

    const vehicle = vehicleRows[0];
    if (!vehicle) {
      return apiResponse.error(res, ErrorCode.NOT_FOUND, 'Vehicle not found');
    }

    // Get driver details
    let driverName: string | null = null;
    let driverPhone: string | null = null;
    let driverIdNumber: string | null = null;

    if (vehicle.assigned_driver_id) {
      const staffRows = await sql`
        SELECT first_name, last_name, id_number, phone
        FROM staff
        WHERE id = ${vehicle.assigned_driver_id}
        LIMIT 1
      ` as Array<{
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

    // Get last readings
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

    return apiResponse.success(res, {
      session: {
        sessionId: session.sessionId,
        vehicleId: session.vehicleId,
        vehicleRegistration: session.vehicleRegistration,
        driverId: session.driverId,
        driverName: session.driverName,
        expiresAt: session.expiresAt,
      },
      vehicle: {
        id: vehicle.id,
        registration: vehicle.registration,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        vehicleType: vehicle.vehicle_type,
        color: vehicle.color,
        assignedDriver: driverName
          ? {
              name: driverName,
              idNumber: driverIdNumber,
              phone: driverPhone,
            }
          : null,
        lastOdometer: odometerRows[0]
          ? {
              reading: odometerRows[0].reading,
              recordedAt: odometerRows[0].recorded_at,
              source: odometerRows[0].source,
            }
          : null,
        lastFuel: fuelRows[0]
          ? {
              level: fuelRows[0].fuel_level,
              recordedAt: fuelRows[0].recorded_at,
              source: fuelRows[0].source,
            }
          : null,
        lastCheckIn: lastCheckInRows[0]
          ? {
              id: lastCheckInRows[0].id,
              checkType: lastCheckInRows[0].check_type,
              status: lastCheckInRows[0].status,
              completedAt:
                lastCheckInRows[0].check_date || lastCheckInRows[0].created_at,
              completedBy: lastCheckInRows[0].driver_name,
            }
          : null,
      },
      driver: driverName
        ? {
            id: vehicle.assigned_driver_id,
            name: driverName,
            phone: driverPhone,
          }
        : null,
    });
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}
