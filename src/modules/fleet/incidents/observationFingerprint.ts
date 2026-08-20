/**
 * Deterministic, bounded fingerprint of "what's materially true about this
 * observation" — backs the unique `(incident_id, observation_fingerprint)`
 * constraint on `fleet_operational_incident_observations` (migration 506)
 * that lets `incidentProducer` insert an observation on every evaluation
 * cycle and rely on the database to silently no-op when nothing material
 * changed, instead of reimplementing that comparison here.
 *
 * Deliberately typed to accept only stable, bounded fields. Raw coordinates,
 * volatile evaluation timestamps, and raw provider payloads have no field to
 * flow through: they would change on every run without representing a real
 * change to the incident, and the fingerprint can end up in logs/metadata
 * where coordinates and provider payloads must never appear.
 */
import { createHash } from 'node:crypto';
import type { IncidentType } from './types';

export interface ObservationFingerprintInput {
  incidentType: IncidentType;
  ruleId: string | null;
  ruleVersion: number | null;
  assignmentIdentity: string | null;
  reasonCodes: readonly string[];
  freshnessBucket: string | null;
  siteId: string | null;
  projectId: string | null;
  vehicleId: string | null;
  conditionActive: boolean;
}

/** Order-independent so evaluators that emit reason codes in varying order don't manufacture false "changes". */
function normalizedReasonCodes(reasonCodes: readonly string[]): string {
  return [...reasonCodes].sort().join('|');
}

export function computeObservationFingerprint(input: ObservationFingerprintInput): string {
  const canonical = [
    input.incidentType,
    input.ruleId ?? '-',
    input.ruleVersion === null ? '-' : String(input.ruleVersion),
    input.assignmentIdentity ?? '-',
    normalizedReasonCodes(input.reasonCodes),
    input.freshnessBucket ?? '-',
    input.siteId ?? '-',
    input.projectId ?? '-',
    input.vehicleId ?? '-',
    input.conditionActive ? '1' : '0',
  ].join('::');

  // Hashed (not raw-joined) so the stored fingerprint has a fixed, bounded
  // length regardless of how many/how long the reason codes are.
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Stable identity for "who/what this observation is about", used as the
 * fingerprint's assignment component. Prefers the operational assignment id
 * when known; falls back to a staff/vehicle pair for source events, which
 * carry no assignment id. Returns null only when neither is known.
 */
export function buildAssignmentIdentity(
  staffId: string | null,
  vehicleId: string | null,
  operationalAssignmentId: string | null,
): string | null {
  if (operationalAssignmentId) return operationalAssignmentId;
  if (!staffId && !vehicleId) return null;
  return `${staffId ?? '-'}::${vehicleId ?? '-'}`;
}
