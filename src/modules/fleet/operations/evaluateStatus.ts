import {
  approachTrend,
  continuousHistoricalInside,
  continuousHistoricalOutside,
  continuousInside,
  continuousOutsideAtKnownSite,
  type ContinuityResult,
} from './continuity';
import { pointsWithinMismatchTolerance } from './geometry';
import { operationalWindow, timePhase } from './timeRules';
import type {
  OperationalEvaluation, OperationalEvidence, OperationalFlag, OperationalStatus, OperationalVehiclePoint,
} from './types';

interface Decision { status: OperationalStatus; reason: string }
interface EvaluationContext {
  evidence: OperationalEvidence; flags: Set<OperationalFlag>; phase: ReturnType<typeof timePhase> | null;
  usableVehicle: OperationalVehiclePoint[]; freshVehicle: OperationalVehiclePoint[];
  vehicleArrival: ContinuityResult | null;
  vehicleOutside: ContinuityResult | null; attendanceInside: boolean;
}

function decision(status: OperationalStatus, reason: string): Decision { return { status, reason }; }
function elapsedSeconds(from: string, to: string): number { return (Date.parse(to) - Date.parse(from)) / 1_000; }

function usableVehiclePoints(evidence: OperationalEvidence): OperationalVehiclePoint[] {
  const asOf = Date.parse(evidence.asOf);
  let evaluationEnd = asOf;
  if (evidence.schedule) evaluationEnd = Math.min(asOf,
    Date.parse(operationalWindow(evidence.schedule, evidence.rule).monitoringEnd));
  return evidence.vehicle.positions.filter((point) => point.valid && Number.isFinite(Date.parse(point.recordedAt))
    && Date.parse(point.recordedAt) <= evaluationEnd)
    .sort((first, second) => Date.parse(first.recordedAt) - Date.parse(second.recordedAt));
}

function freshVehiclePoints(
  evidence: OperationalEvidence,
  usable: OperationalVehiclePoint[],
  flags: Set<OperationalFlag>,
): OperationalVehiclePoint[] {
  if (!evidence.vehicle.vehicleId) { flags.add('no_assigned_vehicle'); return []; }
  if (!usable.length) { flags.add('gps_missing'); return []; }
  const threshold = evidence.vehicle.staleAfterSeconds;
  if (threshold === null || !Number.isFinite(threshold) || threshold < 0) { flags.add('evidence_source_error'); return []; }
  const asOf = evidence.schedule ? Math.min(Date.parse(evidence.asOf),
    Date.parse(operationalWindow(evidence.schedule, evidence.rule).monitoringEnd)) : Date.parse(evidence.asOf);
  const fresh = usable.filter((point) => asOf - Date.parse(point.recordedAt) <= threshold * 1_000);
  if (!fresh.length) flags.add('gps_stale');
  return fresh;
}

function buildContext(evidence: OperationalEvidence): EvaluationContext {
  const flags = new Set<OperationalFlag>();
  if (!evidence.attendance.clockInAt) flags.add('attendance_missing');
  if (evidence.assignment.siteGeometryLowConfidence) flags.add('site_geometry_low_confidence');
  if (evidence.sourceErrors.length) flags.add('evidence_source_error');
  const usableVehicle = usableVehiclePoints(evidence);
  const freshVehicle = freshVehiclePoints(evidence, usableVehicle, flags);
  const staleAfter = evidence.vehicle.staleAfterSeconds;
  const fixes = freshVehicle.map((point) => ({ recordedAt: point.recordedAt, valid: point.valid, inside: point.inside,
    distanceM: point.distanceM, speedKmh: point.speedKmh, knownSiteId: point.knownSiteId }));
  const vehicleArrival = staleAfter === null ? null : continuousInside(fixes, evidence.rule.arrivalDwellMinutes * 60, staleAfter, evidence.asOf);
  const historicalFixes = usableVehicle.map((point) => ({ recordedAt: point.recordedAt, valid: point.valid,
    inside: point.inside, distanceM: point.distanceM, speedKmh: point.speedKmh,
    knownSiteId: point.knownSiteId }));
  const historicalAsOf = usableVehicle.at(-1)?.recordedAt ?? evidence.asOf;
  const vehicleOutside = staleAfter === null ? null : continuousHistoricalOutside(historicalFixes,
    evidence.rule.earlyDepartureConfirmationMinutes * 60, staleAfter, historicalAsOf);
  if (vehicleArrival?.pending && !vehicleArrival.confirmed) flags.add('arrival_dwell_pending');
  return { evidence, flags, phase: evidence.schedule ? timePhase(evidence.asOf, evidence.schedule, evidence.rule) : null,
    usableVehicle, freshVehicle, vehicleArrival, vehicleOutside,
    attendanceInside: Boolean(evidence.attendance.clockInAt && evidence.attendance.requiredSite?.valid && evidence.attendance.requiredSite.inside) };
}

function evaluateGates(context: EvaluationContext): Decision | null {
  const { evidence, flags, phase } = context;
  if (!evidence.schedule) return decision('unverifiable', 'schedule_missing');
  if (evidence.sourceErrors.length) return decision('unverifiable', 'evidence_source_error');
  if (!evidence.schedule.scheduled && !evidence.schedule.explicitWork) return decision('off_duty', 'not_scheduled');
  if (phase === 'off_duty') { flags.add('outside_monitoring_window'); return decision('off_duty', 'outside_monitoring_window'); }
  if (evidence.assignment.ambiguous) { flags.add('assignment_ambiguous'); return decision('unverifiable', 'assignment_ambiguous'); }
  if (!evidence.assignment.operationalSiteId) return decision('unassigned', 'operational_site_missing');
  if (!evidence.assignment.siteGeometryValid) return decision('unverifiable', 'site_geometry_invalid');
  if (evidence.vehicle.vehicleId && !evidence.attendance.clockInAt && !context.freshVehicle.length
    && !context.vehicleOutside?.confirmed) {
    return decision('unverifiable', 'expected_evidence_unavailable');
  }
  return null;
}

function latestVehicle(context: EvaluationContext): OperationalVehiclePoint | null {
  return context.freshVehicle.at(-1) ?? null;
}

function attendanceWrongConfirmed(context: EvaluationContext): boolean {
  const { attendance } = context.evidence;
  return Boolean(attendance.clockInAt && !attendance.clockOutAt && attendance.requiredSite?.valid && !attendance.requiredSite.inside
    && attendance.requiredSite.knownSiteId && elapsedSeconds(attendance.clockInAt, context.evidence.asOf) >= context.evidence.rule.wrongSiteConfirmationMinutes * 60);
}

function vehicleWrong(context: EvaluationContext): ContinuityResult | null {
  const staleAfter = context.evidence.vehicle.staleAfterSeconds;
  if (staleAfter === null) return null;
  const fixes = context.freshVehicle.map((point) => ({ recordedAt: point.recordedAt, valid: point.valid, inside: point.inside,
    distanceM: point.distanceM, speedKmh: point.speedKmh, knownSiteId: point.knownSiteId }));
  return continuousOutsideAtKnownSite(fixes, context.evidence.rule.wrongSiteConfirmationMinutes * 60,
    staleAfter, context.evidence.asOf);
}

function evaluateSiteConflict(context: EvaluationContext): Decision | null {
  const { attendance } = context.evidence; const vehicle = latestVehicle(context);
  const attendanceSite = attendance.requiredSite?.knownSiteId ?? attendance.matchedSiteId;
  if (attendance.clockInPoint && attendanceSite && vehicle && vehicle.knownSiteId && attendanceSite !== vehicle.knownSiteId
    && !pointsWithinMismatchTolerance(attendance.clockInPoint, vehicle, context.evidence.rule.evidenceMismatchToleranceMeters)) {
    return decision('evidence_mismatch', 'attendance_vehicle_site_mismatch');
  }
  const attendanceWrong = attendanceWrongConfirmed(context); const outside = vehicleWrong(context);
  const vehicleWrongConfirmed = Boolean(outside?.confirmed && outside.knownSiteId);
  if (attendanceWrong && vehicleWrongConfirmed && attendanceSite === outside?.knownSiteId) return decision('wrong_site', 'sources_agree_wrong_site');
  if (attendanceWrong && !vehicle) return decision('wrong_site', 'attendance_confirmed_wrong_site');
  if (vehicleWrongConfirmed && !attendance.clockInAt) return decision('wrong_site', 'vehicle_confirmed_wrong_site');
  if ((attendance.requiredSite?.valid && !attendance.requiredSite.inside && !attendanceWrong)
    || (outside?.pending && !outside.confirmed && vehicle?.knownSiteId)) context.flags.add('wrong_site_confirmation_pending');
  return null;
}

function evaluateDeparture(context: EvaluationContext): Decision | null {
  const { evidence, vehicleOutside } = context; const schedule = evidence.schedule;
  if (!schedule) return null;
  const window = operationalWindow(schedule, evidence.rule);
  if (evidence.attendance.clockOutAt) {
    return Date.parse(evidence.attendance.clockOutAt) >= Date.parse(window.scheduledEnd)
      ? decision('shift_complete', 'attendance_normal_clock_out') : decision('left_early', 'attendance_early_clock_out');
  }
  const departureStarted = vehicleOutside?.startedAt;
  const priorFixes = departureStarted ? context.usableVehicle.filter((point) =>
    Date.parse(point.recordedAt) < Date.parse(departureStarted)) : [];
  const priorInsideFixes = priorFixes.map((point) => ({ recordedAt: point.recordedAt, valid: point.valid,
    inside: point.inside, distanceM: point.distanceM, speedKmh: point.speedKmh }));
  const staleAfter = evidence.vehicle.staleAfterSeconds;
  const hadInsideBefore = Boolean(departureStarted && staleAfter !== null && continuousHistoricalInside(priorInsideFixes,
    evidence.rule.arrivalDwellMinutes * 60, staleAfter, departureStarted).confirmed);
  if (vehicleOutside?.confirmed && hadInsideBefore) {
    if (departureStarted && Date.parse(departureStarted) < Date.parse(window.scheduledEnd)) {
      return decision('left_early', 'vehicle_departure_confirmed_early');
    }
    context.flags.add('vehicle_driver_presence_unconfirmed');
    return decision('shift_complete', 'vehicle_departure_confirmed_after_shift');
  }
  if (vehicleOutside?.pending && hadInsideBefore) context.flags.add('departure_confirmation_pending');
  return null;
}

function evaluateArrival(context: EvaluationContext): Decision {
  const { evidence, phase, attendanceInside, vehicleArrival } = context;
  if (attendanceInside && vehicleArrival?.confirmed) return decision('on_site_dual', 'attendance_and_vehicle_confirmed');
  if (attendanceInside) return decision('attendance_confirmed', 'attendance_inside_required_site');
  if (vehicleArrival?.confirmed) { context.flags.add('vehicle_driver_presence_unconfirmed'); return decision('vehicle_on_site_driver_unconfirmed', 'vehicle_dwell_confirmed'); }
  const staleAfter = evidence.vehicle.staleAfterSeconds;
  if (staleAfter !== null && approachTrend(context.freshVehicle.map((point) => ({ recordedAt: point.recordedAt,
    valid: point.valid, inside: point.inside, distanceM: point.distanceM, speedKmh: point.speedKmh })),
  evidence.rule.approachingMinReadings, evidence.rule.approachingDistanceMeters, evidence.rule.minimumMovingSpeedKmh,
  staleAfter, evidence.asOf)) return decision('approaching', 'vehicle_approaching_required_site');
  if (phase === 'before_start' || phase === 'grace') return decision('scheduled_not_due', 'arrival_not_due');
  return decision('late', 'arrival_not_confirmed_after_grace');
}

function sourceTimestamps(evidence: OperationalEvidence): string[] {
  return [...new Set([evidence.attendance.clockInAt, evidence.attendance.clockOutAt,
    ...usableVehiclePoints(evidence).map((point) => point.recordedAt)]
    .filter((value): value is string => Boolean(value) && Date.parse(value) <= Date.parse(evidence.asOf)))].sort();
}

export function evaluateOperationalStatus(evidence: OperationalEvidence): OperationalEvaluation {
  const context = buildContext(evidence);
  const result = evaluateGates(context) ?? evaluateSiteConflict(context) ?? evaluateDeparture(context) ?? evaluateArrival(context);
  return { status: result.status, flags: [...context.flags], reasonCodes: [result.reason], ruleId: evidence.rule.id,
    ruleVersion: evidence.rule.version, sourceTimestamps: sourceTimestamps(evidence), thresholdsUsed: {
      graceMinutes: evidence.schedule?.graceMinutes ?? 0, monitoringBeforeMinutes: evidence.rule.monitoringBeforeMinutes,
      monitoringAfterMinutes: evidence.rule.monitoringAfterMinutes, arrivalDwellMinutes: evidence.rule.arrivalDwellMinutes,
      wrongSiteConfirmationMinutes: evidence.rule.wrongSiteConfirmationMinutes,
      earlyDepartureConfirmationMinutes: evidence.rule.earlyDepartureConfirmationMinutes,
      approachingDistanceMeters: evidence.rule.approachingDistanceMeters,
      approachingMinReadings: evidence.rule.approachingMinReadings, minimumMovingSpeedKmh: evidence.rule.minimumMovingSpeedKmh,
      evidenceMismatchToleranceMeters: evidence.rule.evidenceMismatchToleranceMeters,
      ...(evidence.vehicle.staleAfterSeconds === null ? {} : { gpsStaleAfterSeconds: evidence.vehicle.staleAfterSeconds }),
    } };
}
