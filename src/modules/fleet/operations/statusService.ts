import { evaluateOperationalStatus } from './evaluateStatus';
import { loadOperationalEvidence } from './evidenceQueries';
import { parseStrictIsoInstant } from './instantValidation';
import { operationalWindow } from './timeRules';
import type { OperationalEvaluation, OperationalEvidence, OperationalStatusSummary } from './types';

export class OperationalStatusRequestError extends Error { constructor(message: string) { super(message); this.name = 'OperationalStatusRequestError'; } }
export interface RosterStatusRequest { projectId: string; workDate: string; asOf: string; page: number; limit: number }
export interface EvidenceDetailRequest { projectId?: string; staffId: string; workDate: string; asOf: string }
export interface RosterStatusResult { items: OperationalStatusSummary[]; page: number; limit: number; total: number; hasMore: boolean }
export interface EvidencePointDetail { source: 'attendance_clock_in' | 'attendance_clock_out' | 'vehicle_latest'; latitude: number; longitude: number; recordedAt: string }
export interface OperationalEvidenceDetail { staffId: string; workDate: string; projectName: string | null;
  operationalSiteName: string | null; monitoringStart: string | null; scheduledStart: string | null;
  graceEnd: string | null; scheduledEnd: string | null; monitoringEnd: string | null;
  gpsStaleAfterSeconds: number | null; evaluation: OperationalEvaluation; points: EvidencePointDetail[] }
export interface AttendancePointEligibility {
  asOf: string; monitoringStart: string | null; monitoringEnd: string | null;
  status: OperationalEvaluation['status']; reasonCodes: string[];
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
function validDate(value: string): boolean { const match = DATE.exec(value); if (!match) return false; const date = new Date(0); date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3])); return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]); }
function validate(workDate: string, asOf: string): void {
  if (!validDate(workDate)) throw new OperationalStatusRequestError('workDate must be a valid ISO date');
  const timestamp = parseStrictIsoInstant(asOf); if (timestamp === null) throw new OperationalStatusRequestError('asOf must be an ISO instant');
  const ageDays = (timestamp - Date.parse(`${workDate}T00:00:00Z`)) / 86_400_000;
  if (ageDays < 0 || ageDays > 31) throw new OperationalStatusRequestError('workDate must be within the 31-day history window');
}

function fallback(evidence: OperationalEvidence): OperationalEvaluation { return { status: 'unverifiable', flags: ['evidence_source_error'], reasonCodes: ['person_evaluation_failed'], ruleId: evidence.rule.id, ruleVersion: evidence.rule.version, sourceTimestamps: [], thresholdsUsed: {} }; }
function safelyEvaluate(evidence: OperationalEvidence): OperationalEvaluation { try { return evaluateOperationalStatus(evidence); } catch { return fallback(evidence); } }
function windowFor(evidence: OperationalEvidence) { return evidence.schedule ? operationalWindow(evidence.schedule, evidence.rule) : null; }
export function isOperationalAttendancePointEligible(input: AttendancePointEligibility): boolean {
  if (!input.monitoringStart || !input.monitoringEnd) return false;
  const asOf = Date.parse(input.asOf); const start = Date.parse(input.monitoringStart); const end = Date.parse(input.monitoringEnd);
  if (![asOf, start, end].every(Number.isFinite) || asOf < start || asOf > end) return false;
  const reasons = input.reasonCodes.join(' ');
  return /attendance|sources_agree/.test(reasons)
    || ['attendance_confirmed', 'on_site_dual', 'evidence_mismatch'].includes(input.status);
}
function summary(evidence: OperationalEvidence, evaluation: OperationalEvaluation): OperationalStatusSummary { const window = windowFor(evidence); return { staffId: evidence.staffId, staffName: evidence.staffName, projectId: evidence.assignment.projectId, projectName: evidence.assignment.projectName, operationalSiteId: evidence.assignment.operationalSiteId, operationalSiteName: evidence.assignment.operationalSiteName, status: evaluation.status, flags: evaluation.flags, reasonCodes: evaluation.reasonCodes, monitoringStart: window?.monitoringStart ?? null, scheduledStart: window?.scheduledStart ?? null, graceEnd: window?.graceEnd ?? null, scheduledEnd: window?.scheduledEnd ?? null, monitoringEnd: window?.monitoringEnd ?? null, gpsStaleAfterSeconds: evidence.vehicle.staleAfterSeconds, sourceTimestamps: evaluation.sourceTimestamps, ruleId: evaluation.ruleId, ruleVersion: evaluation.ruleVersion }; }

export async function getOperationalRosterStatus(request: RosterStatusRequest): Promise<RosterStatusResult> {
  validate(request.workDate, request.asOf);
  if (!request.projectId || !Number.isInteger(request.page) || request.page < 1 || !Number.isInteger(request.limit) || request.limit < 1 || request.limit > 100) throw new OperationalStatusRequestError('Invalid project or pagination');
  const offset = (request.page - 1) * request.limit;
  const evidence = await loadOperationalEvidence({ projectId: request.projectId, workDate: request.workDate, asOf: request.asOf, limit: request.limit, offset });
  return { items: evidence.items.map((item) => summary(item, safelyEvaluate(item))), page: request.page,
    limit: request.limit, total: evidence.total, hasMore: offset + evidence.items.length < evidence.total };
}

export async function getOperationalEvidenceDetail(request: EvidenceDetailRequest): Promise<OperationalEvidenceDetail> {
  validate(request.workDate, request.asOf); if (!request.staffId) throw new OperationalStatusRequestError('staffId is required');
  if (request.projectId !== undefined && (!request.projectId || request.projectId === '00000000-0000-0000-0000-000000000000')) throw new OperationalStatusRequestError('projectId is invalid');
  const { items: [evidence] } = await loadOperationalEvidence({ projectId: request.projectId, staffId: request.staffId, workDate: request.workDate, asOf: request.asOf, limit: 1, offset: 0 });
  if (!evidence) throw new OperationalStatusRequestError('Operational evidence not found');
  const evaluation = safelyEvaluate(evidence); const window = windowFor(evidence);
  const points: EvidencePointDetail[] = [];
  const insideWindow = Boolean(window && Date.parse(evidence.asOf) >= Date.parse(window.monitoringStart)
    && Date.parse(evidence.asOf) <= Date.parse(window.monitoringEnd));
  const reasons = evaluation.reasonCodes.join(' ');
  const attendanceRelevant = isOperationalAttendancePointEligible({ asOf: evidence.asOf,
    monitoringStart: window?.monitoringStart ?? null, monitoringEnd: window?.monitoringEnd ?? null,
    status: evaluation.status, reasonCodes: evaluation.reasonCodes });
  const vehicleRelevant = /vehicle|sources_agree/.test(reasons)
    || ['approaching', 'on_site_dual', 'evidence_mismatch'].includes(evaluation.status);
  if (insideWindow && attendanceRelevant && evidence.attendance.clockInPoint) points.push({ source: 'attendance_clock_in', ...evidence.attendance.clockInPoint });
  if (insideWindow && /clock_out/.test(reasons) && evidence.attendance.clockOutPoint) points.push({ source: 'attendance_clock_out', ...evidence.attendance.clockOutPoint });
  const latest = evidence.vehicle.positions.at(-1); if (insideWindow && vehicleRelevant && latest) points.push({ source: 'vehicle_latest', latitude: latest.latitude, longitude: latest.longitude, recordedAt: latest.recordedAt });
  return { staffId: evidence.staffId, workDate: evidence.workDate, projectName: evidence.assignment.projectName,
    operationalSiteName: evidence.assignment.operationalSiteName, monitoringStart: window?.monitoringStart ?? null,
    scheduledStart: window?.scheduledStart ?? null, graceEnd: window?.graceEnd ?? null,
    scheduledEnd: window?.scheduledEnd ?? null, monitoringEnd: window?.monitoringEnd ?? null,
    gpsStaleAfterSeconds: evidence.vehicle.staleAfterSeconds, evaluation, points };
}
