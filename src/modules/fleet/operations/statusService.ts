import { evaluateOperationalStatus } from './evaluateStatus';
import { loadOperationalEvidence } from './evidenceQueries';
import type { OperationalEvaluation, OperationalEvidence, OperationalStatusSummary } from './types';

export class OperationalStatusRequestError extends Error { constructor(message: string) { super(message); this.name = 'OperationalStatusRequestError'; } }
export interface RosterStatusRequest { projectId: string; workDate: string; asOf: string; page: number; limit: number }
export interface EvidenceDetailRequest { projectId?: string; staffId: string; workDate: string; asOf: string }
export interface RosterStatusResult { items: OperationalStatusSummary[]; page: number; limit: number }
export interface EvidencePointDetail { source: 'attendance_clock_in' | 'attendance_clock_out' | 'vehicle_latest'; latitude: number; longitude: number; recordedAt: string }
export interface OperationalEvidenceDetail { staffId: string; workDate: string; evaluation: OperationalEvaluation; points: EvidencePointDetail[] }

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;
function validDate(value: string): boolean { const match = DATE.exec(value); if (!match) return false; const date = new Date(0); date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3])); return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]); }
function validInstant(value: string): boolean {
  const match = INSTANT.exec(value); if (!match) return false;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]); const hour = Number(match[4]); const minute = Number(match[5]); const second = Number(match[6]);
  const offsetHour = match[8] === 'Z' ? 0 : Number(match[10]); const offsetMinute = match[8] === 'Z' ? 0 : Number(match[11]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) return false;
  const local = new Date(0); local.setUTCFullYear(year, month - 1, day); local.setUTCHours(hour, minute, second, Number((match[7] ?? '').padEnd(3, '0')));
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day || local.getUTCHours() !== hour) return false;
  const sign = match[9] === '-' ? -1 : 1; return Date.parse(value) === local.getTime() - sign * (offsetHour * 60 + offsetMinute) * 60_000;
}
function validate(workDate: string, asOf: string): void {
  if (!validDate(workDate)) throw new OperationalStatusRequestError('workDate must be a valid ISO date');
  const timestamp = Date.parse(asOf); if (!validInstant(asOf)) throw new OperationalStatusRequestError('asOf must be an ISO instant');
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
  if (request.projectId !== undefined && (!request.projectId || request.projectId === '00000000-0000-0000-0000-000000000000')) throw new OperationalStatusRequestError('projectId is invalid');
  const [evidence] = await loadOperationalEvidence({ projectId: request.projectId, staffId: request.staffId, workDate: request.workDate, asOf: request.asOf, limit: 1, offset: 0 });
  if (!evidence) throw new OperationalStatusRequestError('Operational evidence not found');
  const points: EvidencePointDetail[] = [];
  if (evidence.attendance.clockInPoint) points.push({ source: 'attendance_clock_in', ...evidence.attendance.clockInPoint });
  if (evidence.attendance.clockOutPoint) points.push({ source: 'attendance_clock_out', ...evidence.attendance.clockOutPoint });
  const latest = evidence.vehicle.positions.at(-1); if (latest) points.push({ source: 'vehicle_latest', latitude: latest.latitude, longitude: latest.longitude, recordedAt: latest.recordedAt });
  return { staffId: evidence.staffId, workDate: evidence.workDate, evaluation: safelyEvaluate(evidence), points };
}
