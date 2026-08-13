import { query, queryOne, transaction } from '@/lib/db-pool';

export interface OperationalStatusRule {
  id: string; version: number; timezone: string; effectiveFrom: string; effectiveTo: string | null;
  monitoringBeforeMinutes: number; monitoringAfterMinutes: number; arrivalDwellMinutes: number;
  wrongSiteConfirmationMinutes: number; earlyDepartureConfirmationMinutes: number;
  approachingDistanceMeters: number; approachingMinReadings: number; minimumMovingSpeedKmh: number;
  evidenceMismatchToleranceMeters: number; changeReason: string | null; createdBy: string | null; createdAt: string;
}

export interface CreateRuleVersionInput {
  timezone: string; effectiveFrom: string; monitoringBeforeMinutes: number; monitoringAfterMinutes: number;
  arrivalDwellMinutes: number; wrongSiteConfirmationMinutes: number; earlyDepartureConfirmationMinutes: number;
  approachingDistanceMeters: number; approachingMinReadings: number; minimumMovingSpeedKmh: number;
  evidenceMismatchToleranceMeters: number; changeReason?: string | null;
}

interface RuleRow extends Record<string, unknown> {
  id: string; version: number; timezone: string; effective_from: string | Date; effective_to: string | Date | null;
  monitoring_before_minutes: number; monitoring_after_minutes: number; arrival_dwell_minutes: number;
  wrong_site_confirmation_minutes: number; early_departure_confirmation_minutes: number;
  approaching_distance_meters: number; approaching_min_readings: number; minimum_moving_speed_kmh: number | string;
  evidence_mismatch_tolerance_meters: number; change_reason: string | null; created_by: string | null; created_at: string | Date;
}

export class RuleValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'RuleValidationError'; }
}

const columns = `id,version,timezone,effective_from,effective_to,monitoring_before_minutes,
  monitoring_after_minutes,arrival_dwell_minutes,wrong_site_confirmation_minutes,
  early_departure_confirmation_minutes,approaching_distance_meters,approaching_min_readings,
  minimum_moving_speed_kmh,evidence_mismatch_tolerance_meters,change_reason,created_by,created_at`;

function iso(value: string | Date): string { return value instanceof Date ? value.toISOString() : value; }
function mapRule(row: RuleRow): OperationalStatusRule {
  return { id: row.id, version: row.version, timezone: row.timezone, effectiveFrom: iso(row.effective_from),
    effectiveTo: row.effective_to ? iso(row.effective_to) : null, monitoringBeforeMinutes: row.monitoring_before_minutes,
    monitoringAfterMinutes: row.monitoring_after_minutes, arrivalDwellMinutes: row.arrival_dwell_minutes,
    wrongSiteConfirmationMinutes: row.wrong_site_confirmation_minutes,
    earlyDepartureConfirmationMinutes: row.early_departure_confirmation_minutes,
    approachingDistanceMeters: row.approaching_distance_meters, approachingMinReadings: row.approaching_min_readings,
    minimumMovingSpeedKmh: Number(row.minimum_moving_speed_kmh),
    evidenceMismatchToleranceMeters: row.evidence_mismatch_tolerance_meters, changeReason: row.change_reason,
    createdBy: row.created_by, createdAt: iso(row.created_at) };
}

function validate(input: CreateRuleVersionInput): { effectiveFrom: string; reason: string | null } {
  const effective = new Date(input.effectiveFrom);
  if (Number.isNaN(effective.getTime()) || effective.getTime() <= Date.now()) throw new RuleValidationError('effectiveFrom must be a future timestamp');
  if (!input.timezone.trim()) throw new RuleValidationError('timezone is required');
  const nonnegative = [input.monitoringBeforeMinutes, input.monitoringAfterMinutes, input.arrivalDwellMinutes,
    input.wrongSiteConfirmationMinutes, input.earlyDepartureConfirmationMinutes, input.minimumMovingSpeedKmh,
    input.evidenceMismatchToleranceMeters];
  if (nonnegative.some((value) => !Number.isFinite(value) || value < 0)) throw new RuleValidationError('Thresholds must be non-negative numbers');
  if (!Number.isInteger(input.approachingDistanceMeters) || input.approachingDistanceMeters <= 0
    || !Number.isInteger(input.approachingMinReadings) || input.approachingMinReadings <= 0) {
    throw new RuleValidationError('Approaching distance and readings must be positive integers');
  }
  const reason = input.changeReason?.trim() || null;
  return { effectiveFrom: effective.toISOString(), reason };
}

export async function loadEffectiveRule(asOf: string): Promise<OperationalStatusRule | null> {
  const row = await queryOne<RuleRow>(`SELECT ${columns} FROM fleet_operational_status_rules
    WHERE effective_from <= $1::timestamptz AND (effective_to IS NULL OR effective_to > $1::timestamptz)
    ORDER BY version DESC LIMIT 1`, [asOf]);
  return row ? mapRule(row) : null;
}

export async function listRuleVersions(): Promise<OperationalStatusRule[]> {
  return (await query<RuleRow>(`SELECT ${columns} FROM fleet_operational_status_rules ORDER BY version DESC`)).map(mapRule);
}

export async function createRuleVersion(input: CreateRuleVersionInput, actorUserId: string): Promise<OperationalStatusRule> {
  const normalized = validate(input);
  return transaction(async (txn) => {
    const current = await txn.queryOne<RuleRow>(`SELECT ${columns} FROM fleet_operational_status_rules
      WHERE effective_to IS NULL ORDER BY version DESC LIMIT 1 FOR UPDATE`);
    if (!current) throw new RuleValidationError('No open operational status rule exists');
    if (new Date(normalized.effectiveFrom).getTime() <= new Date(current.effective_from).getTime()) {
      throw new RuleValidationError('effectiveFrom must be after the current rule activation');
    }
    await txn.query(`UPDATE fleet_operational_status_rules SET effective_to = $1::timestamptz WHERE id = $2::uuid`, [normalized.effectiveFrom, current.id]);
    const values = [current.version + 1, input.timezone.trim(), normalized.effectiveFrom,
      input.monitoringBeforeMinutes, input.monitoringAfterMinutes, input.arrivalDwellMinutes,
      input.wrongSiteConfirmationMinutes, input.earlyDepartureConfirmationMinutes, input.approachingDistanceMeters,
      input.approachingMinReadings, input.minimumMovingSpeedKmh, input.evidenceMismatchToleranceMeters,
      normalized.reason, actorUserId];
    const created = await txn.queryOne<RuleRow>(`INSERT INTO fleet_operational_status_rules
      (version,timezone,effective_from,monitoring_before_minutes,monitoring_after_minutes,arrival_dwell_minutes,
       wrong_site_confirmation_minutes,early_departure_confirmation_minutes,approaching_distance_meters,
       approaching_min_readings,minimum_moving_speed_kmh,evidence_mismatch_tolerance_meters,change_reason,created_by)
      VALUES ($1,$2,$3::timestamptz,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::uuid) RETURNING ${columns}`, values);
    if (!created) throw new Error('Operational status rule insert returned no row');
    return mapRule(created);
  });
}
