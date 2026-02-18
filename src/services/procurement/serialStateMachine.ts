/**
 * Serial State Machine Service
 * Enforces valid state transitions for serialized stock items (ONTs, routers, mini-UPS).
 * Each transition is validated, persisted, and audit-logged in a single SQL round-trip.
 */

import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import type { SerialStatusValue } from '@/types/procurement/stock/enums.types';

const sql = neon(process.env.DATABASE_URL!);

// ── Transition map ──────────────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: ReadonlyMap<SerialStatusValue, ReadonlySet<SerialStatusValue>> = new Map([
  ['available',  new Set<SerialStatusValue>(['reserved', 'issued', 'in_transit'])],
  ['reserved',   new Set<SerialStatusValue>(['available', 'issued', 'in_transit'])],
  ['issued',     new Set<SerialStatusValue>(['installed', 'returned', 'faulty', 'in_transit'])],
  ['in_transit', new Set<SerialStatusValue>(['available', 'issued', 'faulty'])],
  ['installed',  new Set<SerialStatusValue>(['returned', 'faulty'])],
  ['returned',   new Set<SerialStatusValue>(['available', 'faulty', 'scrapped'])],
  ['faulty',     new Set<SerialStatusValue>(['available', 'scrapped'])],
  ['scrapped',   new Set<SerialStatusValue>([])],
]);

// ── Public types ────────────────────────────────────────────────────────────

export interface SerialTransitionParams {
  serialId: string;
  toStatus: SerialStatusValue;
  performedBy: string;
  performedByName: string;
  reason?: string;
  locationId?: string;
  faultReportId?: string;
  pickingId?: string;
}

export interface SerialTransitionResult {
  success: boolean;
  error?: string;
  serial?: {
    id: string;
    serialNumber: string;
    previousStatus: SerialStatusValue;
    status: SerialStatusValue;
    currentLocationId: string | null;
  };
}

// ── Validation ──────────────────────────────────────────────────────────────

export function isTransitionAllowed(from: SerialStatusValue, to: SerialStatusValue): boolean {
  const allowed = ALLOWED_TRANSITIONS.get(from);
  return allowed ? allowed.has(to) : false;
}

export function getAllowedTransitions(from: SerialStatusValue): SerialStatusValue[] {
  const allowed = ALLOWED_TRANSITIONS.get(from);
  return allowed ? Array.from(allowed) : [];
}

// ── Core transition ─────────────────────────────────────────────────────────

export async function transitionSerial(params: SerialTransitionParams): Promise<SerialTransitionResult> {
  const { serialId, toStatus, performedBy, performedByName, reason, locationId, faultReportId } = params;

  try {
    // 1. Fetch current status
    const rows = await sql`
      SELECT id, serial_number AS "serialNumber", status, current_location_id AS "currentLocationId"
      FROM stock_serials
      WHERE id = ${serialId}
      FOR UPDATE
    `;

    if (rows.length === 0) {
      return { success: false, error: `Serial ${serialId} not found` };
    }

    const current = rows[0] as {
      id: string;
      serialNumber: string;
      status: SerialStatusValue;
      currentLocationId: string | null;
    };

    // 2. Validate transition
    if (!isTransitionAllowed(current.status, toStatus)) {
      const allowed = getAllowedTransitions(current.status);
      return {
        success: false,
        error: `Cannot transition from '${current.status}' to '${toStatus}'. Allowed: ${allowed.join(', ') || 'none (terminal state)'}`,
      };
    }

    // 3. Update serial
    const newLocationId = locationId ?? current.currentLocationId;
    const newFaultReportId = toStatus === 'faulty' ? (faultReportId ?? null) : null;

    await sql`
      UPDATE stock_serials
      SET
        previous_status     = status,
        status              = ${toStatus},
        status_changed_at   = NOW(),
        status_changed_by   = ${performedByName},
        current_location_id = ${newLocationId},
        fault_report_id     = ${newFaultReportId},
        updated_at          = NOW()
      WHERE id = ${serialId}
    `;

    // 4. Insert audit log
    await sql`
      INSERT INTO audit_logs (
        entity_type, entity_id, action,
        old_values, new_values, changed_fields,
        performed_by, performed_by_name, reason
      ) VALUES (
        'stock_serial',
        ${serialId}::uuid,
        'update',
        ${JSON.stringify({ status: current.status, currentLocationId: current.currentLocationId })}::jsonb,
        ${JSON.stringify({ status: toStatus, currentLocationId: newLocationId })}::jsonb,
        ${`{status,current_location_id}`},
        ${performedBy}::uuid,
        ${performedByName},
        ${reason ?? null}
      )
    `;

    // 5. Insert movement record
    await sql`
      INSERT INTO field_stock_movements (
        serial_id, movement_type,
        from_location_id, to_location_id,
        reference, notes,
        performed_by, performed_at
      ) VALUES (
        ${serialId}::uuid,
        ${`status_transition:${current.status}->${toStatus}`},
        ${current.currentLocationId},
        ${newLocationId},
        ${params.pickingId ?? null},
        ${reason ?? null},
        ${performedBy},
        NOW()
      )
    `;

    log.info(
      `Serial ${current.serialNumber} transitioned: ${current.status} -> ${toStatus}`,
      undefined,
      'serialStateMachine'
    );

    return {
      success: true,
      serial: {
        id: serialId,
        serialNumber: current.serialNumber,
        previousStatus: current.status,
        status: toStatus,
        currentLocationId: newLocationId,
      },
    };
  } catch (error) {
    log.error('Serial transition failed', { data: error }, 'serialStateMachine');
    return { success: false, error: 'Internal error during serial transition' };
  }
}
