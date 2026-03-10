/**
 * Fleet Maintenance Service
 * Provides methods for service intervals, service history, and predictive maintenance
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import type {
  ServiceInterval,
  ServiceHistory,
  UpcomingService,
  ServiceUrgency,
  CreateServiceIntervalInput,
  UpdateServiceIntervalInput,
  RecordServiceInput,
  UpcomingServiceRow,
} from '../types/maintenance.types';

const sql = neon(process.env.DATABASE_URL!);

// ============================================================================
// Service Intervals CRUD
// ============================================================================

/**
 * Get all service intervals for a vehicle
 */
export async function getServiceIntervals(vehicleId: string): Promise<ServiceInterval[]> {
  try {
    const rows = await sql`
      SELECT
        si.id,
        si.vehicle_id,
        v.registration,
        si.service_type,
        si.interval_km,
        si.interval_months,
        si.last_service_km,
        si.last_service_date,
        si.next_service_km,
        si.next_service_date,
        si.estimated_cost,
        si.provider_name,
        si.notes,
        si.is_active,
        si.created_at,
        si.updated_at
      FROM fleet_service_intervals si
      JOIN fleet_vehicles v ON v.id = si.vehicle_id
      WHERE si.vehicle_id = ${vehicleId}
      ORDER BY si.service_type
    `;

    return rows.map((row) => ({
      id: row.id,
      vehicleId: row.vehicle_id,
      registration: row.registration,
      serviceType: row.service_type,
      intervalKm: row.interval_km,
      intervalMonths: row.interval_months,
      lastServiceKm: row.last_service_km,
      lastServiceDate: row.last_service_date,
      nextServiceKm: row.next_service_km,
      nextServiceDate: row.next_service_date,
      estimatedCost: row.estimated_cost ? parseFloat(String(row.estimated_cost)) : null,
      providerName: row.provider_name,
      notes: row.notes,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  } catch (error) {
    log.error('Failed to get service intervals', { error, vehicleId });
    throw error;
  }
}

/**
 * Get a single service interval by ID
 */
export async function getServiceInterval(intervalId: string): Promise<ServiceInterval | null> {
  try {
    const rows = await sql`
      SELECT
        si.id,
        si.vehicle_id,
        v.registration,
        si.service_type,
        si.interval_km,
        si.interval_months,
        si.last_service_km,
        si.last_service_date,
        si.next_service_km,
        si.next_service_date,
        si.estimated_cost,
        si.provider_name,
        si.notes,
        si.is_active,
        si.created_at,
        si.updated_at
      FROM fleet_service_intervals si
      JOIN fleet_vehicles v ON v.id = si.vehicle_id
      WHERE si.id = ${intervalId}
    `;

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      vehicleId: row.vehicle_id,
      registration: row.registration,
      serviceType: row.service_type,
      intervalKm: row.interval_km,
      intervalMonths: row.interval_months,
      lastServiceKm: row.last_service_km,
      lastServiceDate: row.last_service_date,
      nextServiceKm: row.next_service_km,
      nextServiceDate: row.next_service_date,
      estimatedCost: row.estimated_cost ? parseFloat(String(row.estimated_cost)) : null,
      providerName: row.provider_name,
      notes: row.notes,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (error) {
    log.error('Failed to get service interval', { error, intervalId });
    throw error;
  }
}

/**
 * Create a new service interval
 */
export async function createServiceInterval(
  input: CreateServiceIntervalInput
): Promise<ServiceInterval> {
  try {
    // Calculate next service date and km
    const nextServiceDate = input.lastServiceDate && input.intervalMonths
      ? calculateNextServiceDate(input.lastServiceDate, input.intervalMonths)
      : null;
    const nextServiceKm = input.lastServiceKm && input.intervalKm
      ? input.lastServiceKm + input.intervalKm
      : null;

    const rows = await sql`
      INSERT INTO fleet_service_intervals (
        vehicle_id,
        service_type,
        interval_km,
        interval_months,
        last_service_km,
        last_service_date,
        next_service_km,
        next_service_date,
        estimated_cost,
        provider_name,
        notes,
        is_active
      ) VALUES (
        ${input.vehicleId},
        ${input.serviceType},
        ${input.intervalKm || null},
        ${input.intervalMonths || null},
        ${input.lastServiceKm || null},
        ${input.lastServiceDate || null},
        ${nextServiceKm},
        ${nextServiceDate},
        ${input.estimatedCost || null},
        ${input.providerName || null},
        ${input.notes || null},
        ${input.isActive ?? true}
      )
      RETURNING id
    `;

    const intervalId = rows[0]?.id;
    if (!intervalId) {
      throw new Error('Failed to create service interval');
    }

    log.info('Created service interval', { intervalId, vehicleId: input.vehicleId, serviceType: input.serviceType });

    const created = await getServiceInterval(intervalId);
    if (!created) {
      throw new Error('Failed to retrieve created service interval');
    }
    return created;
  } catch (error) {
    log.error('Failed to create service interval', { error, input });
    throw error;
  }
}

/**
 * Update a service interval
 */
export async function updateServiceInterval(
  intervalId: string,
  input: UpdateServiceIntervalInput
): Promise<ServiceInterval> {
  try {
    // Recalculate next service if last service data changed
    let nextServiceDate = input.nextServiceDate;
    let nextServiceKm = input.nextServiceKm;

    if (input.lastServiceDate !== undefined || input.intervalMonths !== undefined) {
      const existing = await getServiceInterval(intervalId);
      if (existing) {
        const lastDate = input.lastServiceDate ?? existing.lastServiceDate;
        const months = input.intervalMonths ?? existing.intervalMonths;
        if (lastDate && months) {
          nextServiceDate = calculateNextServiceDate(lastDate, months);
        }
      }
    }

    if (input.lastServiceKm !== undefined || input.intervalKm !== undefined) {
      const existing = await getServiceInterval(intervalId);
      if (existing) {
        const lastKm = input.lastServiceKm ?? existing.lastServiceKm;
        const intervalKm = input.intervalKm ?? existing.intervalKm;
        if (lastKm && intervalKm) {
          nextServiceKm = lastKm + intervalKm;
        }
      }
    }

    await sql`
      UPDATE fleet_service_intervals
      SET
        service_type = COALESCE(${input.serviceType ?? null}, service_type),
        interval_km = COALESCE(${input.intervalKm ?? null}, interval_km),
        interval_months = COALESCE(${input.intervalMonths ?? null}, interval_months),
        last_service_km = COALESCE(${input.lastServiceKm ?? null}, last_service_km),
        last_service_date = COALESCE(${input.lastServiceDate ?? null}, last_service_date),
        next_service_km = COALESCE(${nextServiceKm ?? null}, next_service_km),
        next_service_date = COALESCE(${nextServiceDate ?? null}, next_service_date),
        estimated_cost = COALESCE(${input.estimatedCost ?? null}, estimated_cost),
        provider_name = COALESCE(${input.providerName ?? null}, provider_name),
        notes = COALESCE(${input.notes ?? null}, notes),
        is_active = COALESCE(${input.isActive ?? null}, is_active),
        updated_at = NOW()
      WHERE id = ${intervalId}
    `;

    log.info('Updated service interval', { intervalId });

    const updated = await getServiceInterval(intervalId);
    if (!updated) {
      throw new Error('Failed to retrieve updated service interval');
    }
    return updated;
  } catch (error) {
    log.error('Failed to update service interval', { error, intervalId, input });
    throw error;
  }
}

/**
 * Delete a service interval
 */
export async function deleteServiceInterval(intervalId: string): Promise<void> {
  try {
    await sql`DELETE FROM fleet_service_intervals WHERE id = ${intervalId}`;
    log.info('Deleted service interval', { intervalId });
  } catch (error) {
    log.error('Failed to delete service interval', { error, intervalId });
    throw error;
  }
}

// ============================================================================
// Service History
// ============================================================================

/**
 * Get service history for a vehicle
 */
export async function getServiceHistory(
  vehicleId?: string,
  limit: number = 50
): Promise<ServiceHistory[]> {
  try {
    let rows;
    if (vehicleId) {
      rows = await sql`
        SELECT
          sh.id,
          sh.vehicle_id,
          v.registration,
          sh.service_interval_id,
          sh.service_type,
          sh.service_date,
          sh.odometer_at_service,
          sh.total_cost,
          sh.labor_cost,
          sh.parts_cost,
          sh.provider_name,
          sh.invoice_number,
          sh.description,
          sh.parts_replaced,
          sh.next_service_km,
          sh.next_service_date,
          sh.technician_name,
          sh.warranty_claim,
          sh.created_at
        FROM fleet_service_history sh
        JOIN fleet_vehicles v ON v.id = sh.vehicle_id
        WHERE sh.vehicle_id = ${vehicleId}
        ORDER BY sh.service_date DESC
        LIMIT ${limit}
      `;
    } else {
      rows = await sql`
        SELECT
          sh.id,
          sh.vehicle_id,
          v.registration,
          sh.service_interval_id,
          sh.service_type,
          sh.service_date,
          sh.odometer_at_service,
          sh.total_cost,
          sh.labor_cost,
          sh.parts_cost,
          sh.provider_name,
          sh.invoice_number,
          sh.description,
          sh.parts_replaced,
          sh.next_service_km,
          sh.next_service_date,
          sh.technician_name,
          sh.warranty_claim,
          sh.created_at
        FROM fleet_service_history sh
        JOIN fleet_vehicles v ON v.id = sh.vehicle_id
        ORDER BY sh.service_date DESC
        LIMIT ${limit}
      `;
    }

    return rows.map((row) => ({
      id: row.id,
      vehicleId: row.vehicle_id,
      registration: row.registration,
      serviceIntervalId: row.service_interval_id,
      serviceType: row.service_type,
      serviceDate: row.service_date,
      odometerAtService: row.odometer_at_service,
      totalCost: row.total_cost ? parseFloat(String(row.total_cost)) : null,
      laborCost: row.labor_cost ? parseFloat(String(row.labor_cost)) : null,
      partsCost: row.parts_cost ? parseFloat(String(row.parts_cost)) : null,
      providerName: row.provider_name,
      invoiceNumber: row.invoice_number,
      description: row.description,
      partsReplaced: row.parts_replaced,
      nextServiceKm: row.next_service_km,
      nextServiceDate: row.next_service_date,
      technicianName: row.technician_name,
      warrantyClaim: row.warranty_claim,
      createdAt: row.created_at,
    }));
  } catch (error) {
    log.error('Failed to get service history', { error, vehicleId });
    throw error;
  }
}

/**
 * Record a completed service
 */
export async function recordService(input: RecordServiceInput): Promise<ServiceHistory> {
  try {
    // Calculate next service dates
    let nextServiceKm: number | null = null;
    let nextServiceDate: string | null = null;

    // If linked to an interval, use that to calculate next service
    if (input.serviceIntervalId) {
      const interval = await getServiceInterval(input.serviceIntervalId);
      if (interval) {
        if (interval.intervalKm && input.odometerAtService) {
          nextServiceKm = input.odometerAtService + interval.intervalKm;
        }
        if (interval.intervalMonths) {
          nextServiceDate = calculateNextServiceDate(input.serviceDate, interval.intervalMonths);
        }

        // Update the interval with last service info
        await updateServiceInterval(input.serviceIntervalId, {
          lastServiceKm: input.odometerAtService,
          lastServiceDate: input.serviceDate,
          nextServiceKm: nextServiceKm ?? undefined,
          nextServiceDate: nextServiceDate ?? undefined,
        });
      }
    }

    const rows = await sql`
      INSERT INTO fleet_service_history (
        vehicle_id,
        service_interval_id,
        service_type,
        service_date,
        odometer_at_service,
        total_cost,
        labor_cost,
        parts_cost,
        provider_name,
        invoice_number,
        description,
        parts_replaced,
        next_service_km,
        next_service_date,
        technician_name,
        warranty_claim
      ) VALUES (
        ${input.vehicleId},
        ${input.serviceIntervalId || null},
        ${input.serviceType},
        ${input.serviceDate},
        ${input.odometerAtService || null},
        ${input.totalCost || null},
        ${input.laborCost || null},
        ${input.partsCost || null},
        ${input.providerName || null},
        ${input.invoiceNumber || null},
        ${input.description || null},
        ${input.partsReplaced || null},
        ${nextServiceKm},
        ${nextServiceDate},
        ${input.technicianName || null},
        ${input.warrantyClaim ?? false}
      )
      RETURNING *
    `;

    const row = rows[0];
    if (!row) {
      throw new Error('Failed to record service');
    }

    log.info('Recorded service', {
      serviceId: row.id,
      vehicleId: input.vehicleId,
      serviceType: input.serviceType,
    });

    // Get vehicle registration for response
    const vehicleRows = await sql`
      SELECT registration FROM fleet_vehicles WHERE id = ${input.vehicleId}
    `;

    return {
      id: row.id,
      vehicleId: row.vehicle_id,
      registration: vehicleRows[0]?.registration || '',
      serviceIntervalId: row.service_interval_id,
      serviceType: row.service_type,
      serviceDate: row.service_date,
      odometerAtService: row.odometer_at_service,
      totalCost: row.total_cost ? parseFloat(String(row.total_cost)) : null,
      laborCost: row.labor_cost ? parseFloat(String(row.labor_cost)) : null,
      partsCost: row.parts_cost ? parseFloat(String(row.parts_cost)) : null,
      providerName: row.provider_name,
      invoiceNumber: row.invoice_number,
      description: row.description,
      partsReplaced: row.parts_replaced,
      nextServiceKm: row.next_service_km,
      nextServiceDate: row.next_service_date,
      technicianName: row.technician_name,
      warrantyClaim: row.warranty_claim,
      createdAt: row.created_at,
    };
  } catch (error) {
    log.error('Failed to record service', { error, input });
    throw error;
  }
}

// ============================================================================
// Upcoming Services (from view)
// ============================================================================

/**
 * Get upcoming services from the database view
 */
export async function getUpcomingServices(
  days: number = 90,
  urgency?: ServiceUrgency
): Promise<UpcomingService[]> {
  try {
    let rows;
    if (urgency) {
      rows = await sql`
        SELECT *
        FROM v_fleet_upcoming_services
        WHERE urgency = ${urgency}
          OR (days_until_due IS NOT NULL AND days_until_due <= ${days})
          OR (km_until_due IS NOT NULL AND km_until_due <= 5000)
        ORDER BY
          CASE urgency
            WHEN 'overdue' THEN 0
            WHEN 'critical' THEN 1
            WHEN 'warning' THEN 2
            ELSE 3
          END,
          days_until_due NULLS LAST
      `;
    } else {
      rows = await sql`
        SELECT *
        FROM v_fleet_upcoming_services
        WHERE urgency != 'ok'
          OR (days_until_due IS NOT NULL AND days_until_due <= ${days})
          OR (km_until_due IS NOT NULL AND km_until_due <= 5000)
        ORDER BY
          CASE urgency
            WHEN 'overdue' THEN 0
            WHEN 'critical' THEN 1
            WHEN 'warning' THEN 2
            ELSE 3
          END,
          days_until_due NULLS LAST
      `;
    }

    return (rows as UpcomingServiceRow[]).map((row) => ({
      intervalId: row.interval_id,
      vehicleId: row.vehicle_id,
      registration: row.registration,
      make: row.make,
      model: row.model,
      serviceType: row.service_type as UpcomingService['serviceType'],
      intervalKm: row.interval_km,
      intervalMonths: row.interval_months,
      lastServiceKm: row.last_service_km,
      lastServiceDate: row.last_service_date,
      nextServiceKm: row.next_service_km,
      nextServiceDate: row.next_service_date,
      estimatedCost: row.estimated_cost ? parseFloat(String(row.estimated_cost)) : null,
      providerName: row.provider_name,
      currentKm: row.current_km,
      urgency: row.urgency as ServiceUrgency,
      daysUntilDue: row.days_until_due,
      kmUntilDue: row.km_until_due,
    }));
  } catch (error) {
    log.error('Failed to get upcoming services', { error, days, urgency });
    throw error;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate next service date based on last service date and interval months
 */
function calculateNextServiceDate(lastServiceDate: string, intervalMonths: number): string {
  const date = new Date(lastServiceDate);
  date.setMonth(date.getMonth() + intervalMonths);
  return date.toISOString().split('T')[0] || '';
}

// ============================================================================
// Exports
// ============================================================================

export const maintenanceService = {
  getServiceIntervals,
  getServiceInterval,
  createServiceInterval,
  updateServiceInterval,
  deleteServiceInterval,
  getServiceHistory,
  recordService,
  getUpcomingServices,
};

export default maintenanceService;
