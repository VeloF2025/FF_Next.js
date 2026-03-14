/**
 * Odoo Fleet Sync Service
 *
 * Syncs fleet vehicles, service logs, and odometer readings from Odoo to FibreFlow
 */

import { neon } from '@/lib/db-neon';
import { createLogger } from '@/lib/logger';
import {
  OdooClient,
  OdooFleetVehicle,
  OdooFleetServiceLog,
  OdooFleetOdometer,
} from '../odooClient';

const logger = createLogger('odooFleetSync');

// ============================================================================
// Types
// ============================================================================

export interface FleetSyncResult {
  vehicles: { created: number; updated: number; errors: string[] };
  serviceLogs: { created: number; updated: number; errors: string[] };
  odometer: { created: number; updated: number; errors: string[] };
  details: Array<{
    type: 'vehicle' | 'service_log' | 'odometer';
    odooId: number;
    name: string;
    action: 'created' | 'updated' | 'skipped' | 'error';
    message?: string;
  }>;
}

// ============================================================================
// Mapping Functions
// ============================================================================

function mapOdooVehicleToFF(vehicle: OdooFleetVehicle) {
  // Extract make and model from the tuples
  const make = vehicle.brand_id ? vehicle.brand_id[1] : null;
  const model = vehicle.model_id ? vehicle.model_id[1] : null;

  // Extract status
  const statusMap: Record<string, string> = {
    'new': 'active',
    'active': 'active',
    'in_progress': 'active',
    'closed': 'inactive',
    'sold': 'sold',
  };
  const status = vehicle.state_id ? statusMap[vehicle.state_id[1].toLowerCase()] || 'active' : 'active';

  return {
    odoo_vehicle_id: vehicle.id,
    registration: vehicle.license_plate || vehicle.name,
    vehicle_type: 'Vehicle', // Default type
    make,
    model,
    vin: vehicle.vin_sn || null,
    status,
    current_odometer: vehicle.odometer || null,
    odometer_unit: vehicle.odometer_unit || 'kilometers',
  };
}

function mapOdooServiceLogToFF(log: OdooFleetServiceLog, vehicleIdMap: Map<number, string>) {
  const vehicleOdooId = log.vehicle_id ? log.vehicle_id[0] : null;
  const ffVehicleId = vehicleOdooId ? vehicleIdMap.get(vehicleOdooId) : null;

  // Extract service type
  const serviceType = log.service_type_id ? log.service_type_id[1].toLowerCase() : 'service';

  // Extract project code from description (e.g., "Lawley", "Mohadin")
  let projectCode = null;
  if (log.description) {
    const projects = ['Lawley', 'Mohadin', 'Mamelodi', 'Etwatwa', 'Tembisa', 'Grabouw', 'Ivory Park'];
    for (const proj of projects) {
      if (log.description.toLowerCase().includes(proj.toLowerCase())) {
        projectCode = proj;
        break;
      }
    }
  }

  return {
    odoo_service_id: log.id,
    vehicle_id: ffVehicleId,
    service_date: log.date,
    service_type: serviceType,
    amount: log.amount || 0,
    odometer_value: log.odometer || null,
    description: log.description || null,
    vendor_name: log.vendor_id ? log.vendor_id[1] : null,
    project_code: projectCode,
  };
}

function mapOdooOdometerToFF(reading: OdooFleetOdometer, vehicleIdMap: Map<number, string>) {
  const vehicleOdooId = reading.vehicle_id ? reading.vehicle_id[0] : null;
  const ffVehicleId = vehicleOdooId ? vehicleIdMap.get(vehicleOdooId) : null;

  return {
    odoo_odometer_id: reading.id,
    vehicle_id: ffVehicleId,
    reading_date: reading.date,
    reading: Math.round(reading.value), // Required integer column
    unit: reading.unit || 'kilometers',
  };
}

// ============================================================================
// Sync Functions
// ============================================================================

/**
 * Sync all fleet data from Odoo to FibreFlow
 */
export async function syncFleet(
  client: OdooClient,
  databaseUrl: string,
  options?: { dryRun?: boolean; includeServiceLogs?: boolean; includeOdometer?: boolean }
): Promise<FleetSyncResult> {
  const sql = neon(databaseUrl);
  const result: FleetSyncResult = {
    vehicles: { created: 0, updated: 0, errors: [] },
    serviceLogs: { created: 0, updated: 0, errors: [] },
    odometer: { created: 0, updated: 0, errors: [] },
    details: [],
  };

  const includeServiceLogs = options?.includeServiceLogs ?? true;
  const includeOdometer = options?.includeOdometer ?? true;

  try {
    // ========================================================================
    // 1. SYNC VEHICLES
    // ========================================================================
    logger.info('Starting fleet vehicle sync from Odoo');

    const odooVehicles = await client.getFleetVehicles({ limit: 100 });
    logger.info(`Found ${odooVehicles.length} vehicles in Odoo`);

    // Get existing FF vehicles with Odoo IDs
    const existingVehicles = await sql`
      SELECT id, odoo_vehicle_id FROM fleet_vehicles WHERE odoo_vehicle_id IS NOT NULL
    `;
    const existingByOdooId = new Map(
      existingVehicles.map((v) => [v.odoo_vehicle_id, v.id])
    );

    // Map to track Odoo vehicle ID -> FF vehicle ID (for service logs)
    const vehicleIdMap = new Map<number, string>();

    for (const odooVehicle of odooVehicles) {
      try {
        const ffData = mapOdooVehicleToFF(odooVehicle);
        const existingId = existingByOdooId.get(odooVehicle.id);

        if (options?.dryRun) {
          result.details.push({
            type: 'vehicle',
            odooId: odooVehicle.id,
            name: odooVehicle.name,
            action: existingId ? 'updated' : 'created',
            message: 'Dry run',
          });
          if (existingId) {
            result.vehicles.updated++;
            vehicleIdMap.set(odooVehicle.id, existingId);
          } else {
            result.vehicles.created++;
          }
          continue;
        }

        if (existingId) {
          // Update existing vehicle
          await sql`
            UPDATE fleet_vehicles
            SET
              registration = ${ffData.registration},
              make = ${ffData.make},
              model = ${ffData.model},
              vin = ${ffData.vin},
              status = ${ffData.status},
              current_odometer = ${ffData.current_odometer},
              odometer_unit = ${ffData.odometer_unit},
              last_odometer_update = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ${existingId}
          `;
          result.vehicles.updated++;
          vehicleIdMap.set(odooVehicle.id, existingId);
          result.details.push({
            type: 'vehicle',
            odooId: odooVehicle.id,
            name: odooVehicle.name,
            action: 'updated',
          });
        } else {
          // Create new vehicle
          const inserted = await sql`
            INSERT INTO fleet_vehicles (
              registration, vehicle_type, make, model, vin, status,
              current_odometer, odometer_unit, odoo_vehicle_id,
              created_at, updated_at
            ) VALUES (
              ${ffData.registration}, ${ffData.vehicle_type}, ${ffData.make}, ${ffData.model},
              ${ffData.vin}, ${ffData.status}, ${ffData.current_odometer}, ${ffData.odometer_unit},
              ${ffData.odoo_vehicle_id}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            RETURNING id
          `;
          result.vehicles.created++;
          vehicleIdMap.set(odooVehicle.id, inserted[0]!.id);
          result.details.push({
            type: 'vehicle',
            odooId: odooVehicle.id,
            name: odooVehicle.name,
            action: 'created',
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        result.vehicles.errors.push(`${odooVehicle.name}: ${message}`);
        result.details.push({
          type: 'vehicle',
          odooId: odooVehicle.id,
          name: odooVehicle.name,
          action: 'error',
          message,
        });
      }
    }

    // Refresh vehicle ID map for existing vehicles
    const allVehicles = await sql`
      SELECT id, odoo_vehicle_id FROM fleet_vehicles WHERE odoo_vehicle_id IS NOT NULL
    `;
    for (const v of allVehicles) {
      vehicleIdMap.set(v.odoo_vehicle_id, v.id);
    }

    // ========================================================================
    // 2. SYNC SERVICE LOGS (if enabled)
    // ========================================================================
    if (includeServiceLogs && !options?.dryRun) {
      logger.info('Starting fleet service log sync from Odoo');

      const serviceLogs = await client.getFleetServiceLogs({ limit: 500 });
      logger.info(`Found ${serviceLogs.length} service logs in Odoo`);

      // Get existing service logs
      const existingLogs = await sql`
        SELECT id, odoo_service_id FROM fleet_service_logs WHERE odoo_service_id IS NOT NULL
      `;
      const existingLogsByOdooId = new Map(
        existingLogs.map((l) => [l.odoo_service_id, l.id])
      );

      for (const log of serviceLogs) {
        try {
          const ffData = mapOdooServiceLogToFF(log, vehicleIdMap);

          if (!ffData.vehicle_id) {
            // Skip logs for vehicles we don't have
            continue;
          }

          const existingLogId = existingLogsByOdooId.get(log.id);

          if (existingLogId) {
            // Update existing log
            await sql`
              UPDATE fleet_service_logs
              SET
                service_date = ${ffData.service_date},
                service_type = ${ffData.service_type},
                amount = ${ffData.amount},
                odometer_value = ${ffData.odometer_value},
                description = ${ffData.description},
                vendor_name = ${ffData.vendor_name},
                project_code = ${ffData.project_code},
                updated_at = CURRENT_TIMESTAMP
              WHERE id = ${existingLogId}
            `;
            result.serviceLogs.updated++;
          } else {
            // Create new log
            await sql`
              INSERT INTO fleet_service_logs (
                vehicle_id, odoo_service_id, service_date, service_type,
                amount, odometer_value, description, vendor_name, project_code,
                created_at, updated_at
              ) VALUES (
                ${ffData.vehicle_id}::uuid, ${ffData.odoo_service_id}, ${ffData.service_date},
                ${ffData.service_type}, ${ffData.amount}, ${ffData.odometer_value},
                ${ffData.description}, ${ffData.vendor_name}, ${ffData.project_code},
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
              )
            `;
            result.serviceLogs.created++;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          result.serviceLogs.errors.push(`Log ${log.id}: ${message}`);
        }
      }
    }

    // ========================================================================
    // 3. SYNC ODOMETER READINGS (if enabled)
    // ========================================================================
    if (includeOdometer && !options?.dryRun) {
      logger.info('Starting odometer history sync from Odoo');

      const odometerReadings = await client.getFleetOdometer({ limit: 2000 });
      logger.info(`Found ${odometerReadings.length} odometer readings in Odoo`);

      // Get existing odometer readings
      const existingReadings = await sql`
        SELECT id, odoo_odometer_id FROM fleet_odometer_history WHERE odoo_odometer_id IS NOT NULL
      `;
      const existingReadingsByOdooId = new Map(
        existingReadings.map((r) => [r.odoo_odometer_id, r.id])
      );

      for (const reading of odometerReadings) {
        try {
          const ffData = mapOdooOdometerToFF(reading, vehicleIdMap);

          if (!ffData.vehicle_id) {
            // Skip readings for vehicles we don't have
            continue;
          }

          const existingReadingId = existingReadingsByOdooId.get(reading.id);

          if (existingReadingId) {
            // Update existing reading
            await sql`
              UPDATE fleet_odometer_history
              SET
                reading_date = ${ffData.reading_date},
                reading = ${ffData.reading},
                unit = ${ffData.unit},
                synced_at = CURRENT_TIMESTAMP
              WHERE id = ${existingReadingId}
            `;
            result.odometer.updated++;
          } else {
            // Create new reading
            await sql`
              INSERT INTO fleet_odometer_history (
                vehicle_id, odoo_odometer_id, reading_date, reading, unit,
                source, recorded_at, created_at, synced_at
              ) VALUES (
                ${ffData.vehicle_id}::uuid, ${ffData.odoo_odometer_id}, ${ffData.reading_date},
                ${ffData.reading}, ${ffData.unit}, 'odoo', ${ffData.reading_date}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
              )
            `;
            result.odometer.created++;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          result.odometer.errors.push(`Reading ${reading.id}: ${message}`);
        }
      }
    }

    logger.info('Fleet sync completed', {
      vehicles: result.vehicles,
      serviceLogs: result.serviceLogs,
      odometer: result.odometer,
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Fleet sync failed', { error: message });
    result.vehicles.errors.push(`Sync failed: ${message}`);
    return result;
  }
}
