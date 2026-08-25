/**
 * Read and version the vehicle operational rule (migration 529).
 *
 * Deliberately a copy of `operations/ruleQueries.ts`'s shape rather than a
 * generalisation of it: the two rules have disjoint columns and disjoint
 * permissions (`fleet.operations-rules` vs `fleet.vehicle-rules`), and a shared
 * abstraction would put a vehicle threshold behind a staff-rule permission.
 *
 * The safety property — exactly one open version, no overlapping effective
 * ranges — is enforced by the DATABASE (the gist exclusion constraint and the
 * one-open partial unique index), not by the checks here. The transaction below
 * exists so a concurrent creation loses cleanly rather than interleaving.
 */

import { query, queryOne, transaction } from '@/lib/db-pool';
import { parseStrictIsoInstant } from '../operations/instantValidation';
import { secondsOfDay } from './afterHours';
import type { CreateVehicleRuleVersionInput, VehicleOperationalRule } from './types';

interface RuleRow extends Record<string, unknown> {
  id: string; version: number; timezone: string;
  effective_from: string | Date; effective_to: string | Date | null;
  after_hours_start_time: string; after_hours_end_time: string;
  weekends_are_after_hours: boolean; public_holidays_are_after_hours: boolean;
  theft_displacement_meters: number; theft_min_positions: number;
  harsh_linear_g: number | string; harsh_lateral_g: number | string;
  harsh_min_speed_kph: number | string; speed_over_limit_kph: number | string;
  unauthorized_stop_minutes: number; lost_contact_minutes: number;
  idle_alert_minutes: number; known_site_radius_meters: number;
  change_reason: string | null; created_by: string | null; created_at: string | Date;
}

export class VehicleRuleValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'VehicleRuleValidationError'; }
}

/** A version may activate "now" even though the request took a moment to arrive. */
const IMMEDIATE_ACTIVATION_TOLERANCE_MS = 60_000;

const columns = `id,version,timezone,effective_from,effective_to,after_hours_start_time,
  after_hours_end_time,weekends_are_after_hours,public_holidays_are_after_hours,
  theft_displacement_meters,theft_min_positions,harsh_linear_g,harsh_lateral_g,
  harsh_min_speed_kph,speed_over_limit_kph,unauthorized_stop_minutes,lost_contact_minutes,
  idle_alert_minutes,known_site_radius_meters,change_reason,created_by,created_at`;

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function mapRule(row: RuleRow): VehicleOperationalRule {
  return {
    id: row.id, version: row.version, timezone: row.timezone,
    effectiveFrom: iso(row.effective_from),
    effectiveTo: row.effective_to ? iso(row.effective_to) : null,
    afterHoursStartTime: row.after_hours_start_time,
    afterHoursEndTime: row.after_hours_end_time,
    weekendsAreAfterHours: row.weekends_are_after_hours,
    publicHolidaysAreAfterHours: row.public_holidays_are_after_hours,
    theftDisplacementMeters: row.theft_displacement_meters,
    theftMinPositions: row.theft_min_positions,
    // NUMERIC arrives as a string from node-postgres; Number() here keeps every
    // caller from having to remember that.
    harshLinearG: Number(row.harsh_linear_g),
    harshLateralG: Number(row.harsh_lateral_g),
    harshMinSpeedKph: Number(row.harsh_min_speed_kph),
    speedOverLimitKph: Number(row.speed_over_limit_kph),
    unauthorizedStopMinutes: row.unauthorized_stop_minutes,
    lostContactMinutes: row.lost_contact_minutes,
    idleAlertMinutes: row.idle_alert_minutes,
    knownSiteRadiusMeters: row.known_site_radius_meters,
    changeReason: row.change_reason, createdBy: row.created_by, createdAt: iso(row.created_at),
  };
}

const POSITIVE_INTEGERS: Array<keyof CreateVehicleRuleVersionInput> = [
  'theftDisplacementMeters', 'unauthorizedStopMinutes', 'lostContactMinutes',
  'idleAlertMinutes', 'knownSiteRadiusMeters',
];
const NON_NEGATIVE_NUMBERS: Array<keyof CreateVehicleRuleVersionInput> = [
  'harshLinearG', 'harshLateralG', 'harshMinSpeedKph', 'speedOverLimitKph',
];

function validateClockTime(label: string, value: string): void {
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(value)) {
    throw new VehicleRuleValidationError(`${label} must be a HH:MM or HH:MM:SS clock time`);
  }
  const seconds = secondsOfDay(value);
  if (seconds < 0 || seconds >= 86_400) {
    throw new VehicleRuleValidationError(`${label} must be a clock time within one day`);
  }
}

function validate(input: CreateVehicleRuleVersionInput): { effectiveFrom: string; reason: string | null } {
  const effectiveMs = parseStrictIsoInstant(input.effectiveFrom);
  if (effectiveMs === null) throw new VehicleRuleValidationError('effectiveFrom must be a valid ISO instant');
  if (effectiveMs < Date.now() - IMMEDIATE_ACTIVATION_TOLERANCE_MS) {
    throw new VehicleRuleValidationError('effectiveFrom cannot be more than one minute in the past');
  }
  if (!input.timezone.trim()) throw new VehicleRuleValidationError('timezone is required');
  validateClockTime('afterHoursStartTime', input.afterHoursStartTime);
  validateClockTime('afterHoursEndTime', input.afterHoursEndTime);
  for (const key of POSITIVE_INTEGERS) {
    const value = input[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      throw new VehicleRuleValidationError(`${key} must be a positive whole number`);
    }
  }
  for (const key of NON_NEGATIVE_NUMBERS) {
    const value = input[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new VehicleRuleValidationError(`${key} must be a non-negative number`);
    }
  }
  // Two fixes is the floor, not a preference: with one, a single GPS blip is a
  // theft report. The same bound is a CHECK constraint in 529.
  if (!Number.isInteger(input.theftMinPositions) || input.theftMinPositions < 2) {
    throw new VehicleRuleValidationError('theftMinPositions must be a whole number of at least 2');
  }
  const reason = input.changeReason?.trim() || null;
  return { effectiveFrom: new Date(effectiveMs).toISOString(), reason };
}

/** The version whose half-open effective range covers `asOf`, or null. */
export async function loadEffectiveVehicleRule(asOf: string): Promise<VehicleOperationalRule | null> {
  const row = await queryOne<RuleRow>(
    `SELECT ${columns} FROM fleet_vehicle_operational_rules
      WHERE effective_from <= $1::timestamptz AND (effective_to IS NULL OR effective_to > $1::timestamptz)
      ORDER BY version DESC LIMIT 1`,
    [asOf],
  );
  return row ? mapRule(row) : null;
}

/** Full version history, newest first. */
export async function listVehicleRuleVersions(): Promise<VehicleOperationalRule[]> {
  const rows = await query<RuleRow>(
    `SELECT ${columns} FROM fleet_vehicle_operational_rules ORDER BY version DESC`,
  );
  return rows.map(mapRule);
}

/**
 * Close the open version and insert the next one, atomically.
 *
 * `FOR UPDATE` on the open row serialises two concurrent callers; whichever
 * arrives second then either fails the version UNIQUE, the one-open partial
 * unique index, or the gist exclusion. All three are database constraints — the
 * code cannot be the thing that makes this safe.
 */
export async function createVehicleRuleVersion(
  input: CreateVehicleRuleVersionInput,
  actorUserId: string,
): Promise<VehicleOperationalRule> {
  const normalized = validate(input);
  return transaction(async (txn) => {
    const current = await txn.queryOne<RuleRow>(
      `SELECT ${columns} FROM fleet_vehicle_operational_rules
        WHERE effective_to IS NULL ORDER BY version DESC LIMIT 1 FOR UPDATE`,
    );
    if (!current) throw new VehicleRuleValidationError('No open vehicle operational rule exists');
    if (new Date(normalized.effectiveFrom).getTime() <= new Date(iso(current.effective_from)).getTime()) {
      throw new VehicleRuleValidationError('effectiveFrom must be after the current rule activation');
    }
    await txn.query(
      `UPDATE fleet_vehicle_operational_rules SET effective_to = $1::timestamptz WHERE id = $2::uuid`,
      [normalized.effectiveFrom, current.id],
    );
    const created = await txn.queryOne<RuleRow>(
      `INSERT INTO fleet_vehicle_operational_rules
        (version,timezone,effective_from,after_hours_start_time,after_hours_end_time,
         weekends_are_after_hours,public_holidays_are_after_hours,theft_displacement_meters,
         theft_min_positions,harsh_linear_g,harsh_lateral_g,harsh_min_speed_kph,speed_over_limit_kph,
         unauthorized_stop_minutes,lost_contact_minutes,idle_alert_minutes,known_site_radius_meters,
         change_reason,created_by)
       VALUES ($1,$2,$3::timestamptz,$4::time,$5::time,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::uuid)
       RETURNING ${columns}`,
      [current.version + 1, input.timezone.trim(), normalized.effectiveFrom,
        input.afterHoursStartTime, input.afterHoursEndTime,
        input.weekendsAreAfterHours, input.publicHolidaysAreAfterHours,
        input.theftDisplacementMeters, input.theftMinPositions,
        input.harshLinearG, input.harshLateralG, input.harshMinSpeedKph, input.speedOverLimitKph,
        input.unauthorizedStopMinutes, input.lostContactMinutes, input.idleAlertMinutes,
        input.knownSiteRadiusMeters, normalized.reason, actorUserId],
    );
    if (!created) throw new Error('Vehicle operational rule insert returned no row');
    return mapRule(created);
  });
}
