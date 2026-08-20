/**
 * H&S daily check-in — clearance decision.
 *
 * Deliberately a PURE function with no database access: this is the rule that
 * decides whether a person is cleared to work, so it must be readable and
 * exhaustively testable on its own, without mocking a query layer.
 *
 * The graduated model (Hein, 2026-07-27) applies to SITE declarations:
 *   BLOCK  — self-declared unfit; no current medical WHEN height/plant work is
 *            declared. Both are unambiguous and hard to argue with.
 *   WARN   — PPE gaps, hazards, an unverifiable medical, an activity with no
 *            matching permit. Recorded and alerted, never blocking.
 *
 * An OFFICE declaration answers one question — fit for duty? — so it blocks
 * only on self-declared unfitness. It never warns: PPE, hazards and permits
 * are not asked, so their default values are not findings.
 *
 * Nothing here can stop a clock-in; the caller writes the check-in only after
 * attendance has already been recorded.
 */

import {
  CHECKIN_ACTIVITIES,
  MEDICAL_REQUIRED_ACTIVITIES,
  type CheckinActivity,
  type CheckinBlockReason,
  type CheckinClearance,
  type CheckinWarning,
  type CheckinWorkLocation,
} from '../types/checkin.types';

/**
 * Medical position of the worker at check-in time.
 *
 * `unverifiable` is distinct from `missing` on purpose: an unregistered crew
 * worker has no id to look a certificate up by. Treating that as "missing"
 * would block every unregistered worker who does height work; treating it as
 * "current" would let a contractor dodge the gate by not registering anyone.
 * It is therefore its own state — never blocking, always surfaced.
 */
export type CheckinMedicalStatus = 'current' | 'expired' | 'missing' | 'unverifiable';

export interface ClearanceInput {
  work_location: CheckinWorkLocation;
  fit_for_duty: boolean;
  ppe_complete: boolean;
  declared_activities: CheckinActivity[];
  medical_status: CheckinMedicalStatus;
  hazard_reported?: string | null;
  /** permit-backed activities that have no open permit for this project today */
  activities_without_permit?: CheckinActivity[];
}

export interface ClearanceResult {
  clearance: Extract<CheckinClearance, 'cleared' | 'blocked'>;
  blocked_reasons: CheckinBlockReason[];
  warnings: CheckinWarning[];
}

/** True when any declared activity requires a current Certificate of Fitness. */
export function requiresMedical(activities: CheckinActivity[]): boolean {
  return activities.some((a) => MEDICAL_REQUIRED_ACTIVITIES.includes(a));
}

/** The declared activities that are driving a medical requirement. */
export function medicalDrivingActivities(activities: CheckinActivity[]): CheckinActivity[] {
  return activities.filter((a) => MEDICAL_REQUIRED_ACTIVITIES.includes(a));
}

export function deriveClearance(input: ClearanceInput): ClearanceResult {
  const blocked_reasons: CheckinBlockReason[] = [];
  const warnings: CheckinWarning[] = [];

  // A person saying they are not fit is the one signal we never second-guess.
  if (!input.fit_for_duty) {
    blocked_reasons.push('self_declared_unfit');
  }

  // An office declaration answers one question, so it can produce exactly one
  // outcome. Evaluating the site rules here would judge fields the office path
  // never asked — a false PPE warning on every desk worker, every day.
  if (input.work_location === 'office') {
    return {
      clearance: blocked_reasons.length > 0 ? 'blocked' : 'cleared',
      blocked_reasons,
      warnings: [],
    };
  }

  // The medical gate fires only for declared height/plant work — not for
  // everyone, and not from a static role.
  if (requiresMedical(input.declared_activities)) {
    if (input.medical_status === 'expired' || input.medical_status === 'missing') {
      blocked_reasons.push('medical_not_current');
    } else if (input.medical_status === 'unverifiable') {
      warnings.push('medical_unverifiable');
    }
  }

  if (!input.ppe_complete) {
    warnings.push('ppe_incomplete');
  }
  if (input.hazard_reported && input.hazard_reported.trim() !== '') {
    warnings.push('hazard_reported');
  }
  if ((input.activities_without_permit ?? []).length > 0) {
    warnings.push('activity_without_permit');
  }

  return {
    clearance: blocked_reasons.length > 0 ? 'blocked' : 'cleared',
    blocked_reasons,
    warnings,
  };
}

/** Human-readable summary for the supervisor alert and the today board. */
export function describeClearance(result: ClearanceResult, workerName: string): string {
  if (result.clearance === 'cleared') {
    return result.warnings.length === 0
      ? `${workerName} cleared`
      : `${workerName} cleared with ${result.warnings.length} finding(s)`;
  }
  return `${workerName} BLOCKED: ${result.blocked_reasons.join(', ')}`;
}

/** Validate a caller-supplied activity list against the known vocabulary. */
export function parseActivities(raw: unknown): CheckinActivity[] | null {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return null;
  const out: CheckinActivity[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !(item in CHECKIN_ACTIVITIES)) return null;
    const activity = item as CheckinActivity;
    if (!out.includes(activity)) out.push(activity);
  }
  return out;
}
