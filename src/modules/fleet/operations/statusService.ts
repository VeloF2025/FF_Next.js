import { evaluateOperationalStatus } from './evaluateStatus';
import { loadOperationalEvidence } from './evidenceQueries';
import type { OperationalEvaluation, OperationalEvidence, OperationalStatusSummary } from './types';

export class OperationalStatusRequestError extends Error { constructor(message: string) { super(message); this.name = 'OperationalStatusRequestError'; } }
export interface RosterStatusRequest { projectId: string; workDate: string; asOf: string; page: number; limit: number }
export interface EvidenceDetailRequest { staffId: string; workDate: string; asOf: string }
export interface RosterStatusResult { items: OperationalStatusSummary[]; page: number; limit: number }
export interface EvidencePointDetail { source: 'attendance_clock_in' | 'attendance_clock_out' | 'vehicle_latest'; latitude: number; longitude: number; recordedAt: string }
export interface OperationalEvidenceDetail { evidence: OperationalEvidence; evaluation: OperationalEvaluation; points: EvidencePointDetail[] }

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
function validDate(value: string): boolean { const match = DATE.exec(value); if (!match) return false; const date = new Date(`${value}T00:00:00Z`); return date.toISOString().slice(0, 10) === value; }
function validate(workDate: string, asOf: string): void {
  if (!validDate(workDate)) throw new OperationalStatusRequestError('workDate must be a valid ISO date');
  const timestamp = Date.parse(asOf); if (!Number.isFinite(timestamp) || !/^\d{4}-\d{2}-\d{2}T/.test(asOf)) throw new OperationalStatusRequestError('asOf must be an ISO instant');
  const ageDays = (timestamp - Date.parse(`${workDate}T00:00:00Z`)) / 86_400_000;
  if (ageDays < 0 || ageDays > 31) throw new OperationalStatusRequestError('workDate must be within the 31-day history window');
}

function fallback(evidence: OperationalEvidence): OperationalEvaluation { return { status: 'unverifiable', flags: ['evidence_source_error'], reasonCodes: ['person_evaluation_failed'], ruleId: evidence.rule.id, ruleVersion: evidence.rule.version, sourceTimestamps: [], thresholdsUsed: {} }; }
function safelyEvaluate(evidence: OperationalEvidence): OperationalEvaluation { try { return evaluateOperationalStatus(evidence); } catch { return fallback(evidence); } }
function summary(evidence: OperationalEvidence, evaluation: OperationalEvaluation): OperationalStatusSummary { return { staffId: evidence.staffId, staffName: evidence.staffName, projectId: evidence.assignment.projectId, projectName: null, operationalSiteId: evidence.assignment.operationalSiteId, operationalSiteName: null, status: evaluation.status, flags: evaluation.flags, reasonCodes: evaluation.reasonCodes, scheduledStart: evidence.schedule?.startTime ?? null, scheduledEnd: evidence.schedule?.endTime ?? null, sourceTimestamps: evaluation.sourceTimestamps, ruleId: evaluation.ruleId, ruleVersion: evaluation.ruleVersion }; }

export async function getOperationalRosterStatus(request: RosterStatusRequest): Promise<RosterStatusResult> {
  validate(request.workDate, request.asOf);
  if (!request.projectId || !Number.isInteger(request.page) || request.page < 1 || !Number.isInteger(request.limit) || request.limit < 1 || request.limit > 100) throw new OperationalStatusRequestError('Invalid project or pagination');
  const evidence = await loadOperationalEvidence({ projectId: request.projectId, workDate: request.workDate, asOf: request.asOf, limit: request.limit, offset: (request.page - 1) * request.limit });
  return { items: evidence.map((item) => summary(item, safelyEvaluate(item))), page: request.page, limit: request.limit };
}

export async function getOperationalEvidenceDetail(request: EvidenceDetailRequest): Promise<OperationalEvidenceDetail> {
  validate(request.workDate, request.asOf); if (!request.staffId) throw new OperationalStatusRequestError('staffId is required');
  const [evidence] = await loadOperationalEvidence({ projectId: '00000000-0000-0000-0000-000000000000', staffId: request.staffId, workDate: request.workDate, asOf: request.asOf, limit: 1, offset: 0 });
  if (!evidence) throw new OperationalStatusRequestError('Operational evidence not found');
  const points: EvidencePointDetail[] = [];
  if (evidence.attendance.clockInPoint) points.push({ source: 'attendance_clock_in', ...evidence.attendance.clockInPoint });
  if (evidence.attendance.clockOutPoint) points.push({ source: 'attendance_clock_out', ...evidence.attendance.clockOutPoint });
  const latest = evidence.vehicle.positions.at(-1); if (latest) points.push({ source: 'vehicle_latest', latitude: latest.latitude, longitude: latest.longitude, recordedAt: latest.recordedAt });
  return { evidence, evaluation: safelyEvaluate(evidence), points };
}
