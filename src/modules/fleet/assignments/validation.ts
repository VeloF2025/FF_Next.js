import type { AssignmentKind, AssignmentProposalRow, ProposalConflict } from './types';

type EntityState = { isActive: boolean };
type OperationalSiteState = EntityState & { projectId: string; aoiConfidence?: string | null };
type DateRange = { startDate: string; endDate: string };

export interface ProposalValidationContext {
  staffById: Record<string, EntityState>;
  projectsById: Record<string, EntityState>;
  operationalSitesById: Record<string, OperationalSiteState>;
  // assignmentKind is load-bearing: overlap is only a conflict within a kind.
  existingAssignments: Array<DateRange & { staffId: string; assignmentKind: AssignmentKind }>;
  vehicleAssignments: Array<DateRange & { id: string; staffId: string; vehicleId: string }>;
  vehicleProjectAssignments: Array<DateRange & {
    vehicleId: string;
    projectId: string;
    operationalSiteId: string | null;
  }>;
  unscheduledDatesByStaffId: Record<string, string[]>;
}

export class ProposalNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProposalNormalizationError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_KEYS = new Set([
  'staffId', 'projectId', 'operationalSiteId', 'startDate', 'endDate', 'assignmentKind', 'vehicleAssignmentId', 'reason',
]);

function requiredUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
    throw new ProposalNormalizationError(`${field} must be a UUID`);
  }
  return value.trim().toLowerCase();
}

function optionalUuid(value: unknown, field: string): string | null {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  return requiredUuid(value, field);
}

function requiredDate(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new ProposalNormalizationError(`${field} must be an ISO date`);
  const date = value.trim();
  if (!DATE_PATTERN.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00.000Z`))) {
    throw new ProposalNormalizationError(`${field} must be an ISO date`);
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (parsed.toISOString().slice(0, 10) !== date) throw new ProposalNormalizationError(`${field} must be an ISO date`);
  return date;
}

function nullableText(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new ProposalNormalizationError(`${field} must be text or null`);
  const text = value.trim();
  return text || null;
}

export function normalizeProposal(input: unknown): AssignmentProposalRow[] {
  if (!Array.isArray(input)) throw new ProposalNormalizationError('Proposal must be an array of rows');

  return input.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || Object.getPrototypeOf(candidate) !== Object.prototype) {
      throw new ProposalNormalizationError(`Row ${index} must be a plain object`);
    }
    const row = candidate as Record<string, unknown>;
    const ownKeys = Object.getOwnPropertyNames(row);
    if (Object.getOwnPropertySymbols(row).length > 0 || ownKeys.some((key) => !ALLOWED_KEYS.has(key))) {
      throw new ProposalNormalizationError(`Row ${index} contains an unknown field`);
    }
    const assignmentKind = row.assignmentKind;
    if (assignmentKind !== 'roster' && assignmentKind !== 'daily_override') {
      throw new ProposalNormalizationError(`Row ${index} assignmentKind is invalid`);
    }
    return {
      staffId: requiredUuid(row.staffId, 'staffId'),
      projectId: requiredUuid(row.projectId, 'projectId'),
      operationalSiteId: requiredUuid(row.operationalSiteId, 'operationalSiteId'),
      startDate: requiredDate(row.startDate, 'startDate'),
      endDate: requiredDate(row.endDate, 'endDate'),
      assignmentKind,
      vehicleAssignmentId: optionalUuid(row.vehicleAssignmentId, 'vehicleAssignmentId'),
      reason: nullableText(row.reason, 'reason'),
    };
  });
}

function rangesOverlap(left: DateRange, right: DateRange): boolean {
  return left.startDate <= right.endDate && right.startDate <= left.endDate;
}

function datesInRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  for (let current = new Date(`${startDate}T00:00:00.000Z`); current <= new Date(`${endDate}T00:00:00.000Z`); current.setUTCDate(current.getUTCDate() + 1)) {
    dates.push(current.toISOString().slice(0, 10));
  }
  return dates;
}

function conflict(rowIndex: number, code: string, field: ProposalConflict['field'], level: ProposalConflict['level'] = 'blocking'): ProposalConflict {
  return { rowIndex, code, field, level, message: code.replaceAll('_', ' ') };
}

export function validateProposal(rows: AssignmentProposalRow[], context: ProposalValidationContext): ProposalConflict[] {
  const conflicts: ProposalConflict[] = [];
  rows.forEach((row, rowIndex) => {
    const staff = context.staffById[row.staffId];
    const project = context.projectsById[row.projectId];
    const site = context.operationalSitesById[row.operationalSiteId];
    if (!staff?.isActive) conflicts.push(conflict(rowIndex, 'inactive_staff', 'staffId'));
    if (!project?.isActive) conflicts.push(conflict(rowIndex, 'inactive_project', 'projectId'));
    if (!site?.isActive) conflicts.push(conflict(rowIndex, 'inactive_operational_site', 'operationalSiteId'));
    if (site && site.projectId !== row.projectId) conflicts.push(conflict(rowIndex, 'project_site_mismatch', 'operationalSiteId'));
    if (row.endDate < row.startDate) conflicts.push(conflict(rowIndex, 'invalid_date_range', 'endDate'));
    if (row.assignmentKind === 'daily_override' && row.startDate !== row.endDate) conflicts.push(conflict(rowIndex, 'daily_override_single_day', 'endDate'));
    if (row.assignmentKind === 'daily_override' && !row.reason) conflicts.push(conflict(rowIndex, 'override_reason_required', 'reason'));

    // Overlap is only a conflict WITHIN a kind. A one-day daily_override is
    // meant to sit on top of an active roster assignment and win for that day
    // (see the resolver's precedence order), so cross-kind overlap must be
    // allowed here exactly as the two kind-scoped EXCLUDE constraints allow it.
    const overlaps = context.existingAssignments.some((assignment) => assignment.staffId === row.staffId
      && assignment.assignmentKind === row.assignmentKind
      && rangesOverlap(row, assignment));
    const proposalOverlaps = rows.some((other, otherIndex) => otherIndex !== rowIndex
      && other.staffId === row.staffId
      && other.assignmentKind === row.assignmentKind
      && rangesOverlap(row, other));
    if (overlaps) conflicts.push(conflict(rowIndex, 'driver_overlap', null));
    if (proposalOverlaps) conflicts.push(conflict(rowIndex, 'driver_overlap', null));

    const effectiveVehicles = context.vehicleAssignments.filter((assignment) => assignment.staffId === row.staffId && rangesOverlap(row, assignment));
    if (!row.vehicleAssignmentId && effectiveVehicles.some((assignment) => assignment.startDate <= row.startDate && assignment.endDate >= row.endDate)) {
      conflicts.push(conflict(rowIndex, 'effective_vehicle_omitted', 'vehicleAssignmentId', 'warning'));
    }
    if (row.vehicleAssignmentId) {
      const vehicle = context.vehicleAssignments.find((assignment) => assignment.id === row.vehicleAssignmentId);
      if (!vehicle || vehicle.staffId !== row.staffId) conflicts.push(conflict(rowIndex, 'vehicle_not_assigned_to_staff', 'vehicleAssignmentId'));
      else if (vehicle.startDate > row.startDate || vehicle.endDate < row.endDate) conflicts.push(conflict(rowIndex, 'vehicle_assignment_range', 'vehicleAssignmentId'));
      else if (context.vehicleProjectAssignments.some((assignment) => assignment.vehicleId === vehicle.vehicleId && rangesOverlap(row, assignment) && (assignment.projectId !== row.projectId || assignment.operationalSiteId !== row.operationalSiteId))) {
        conflicts.push(conflict(rowIndex, 'vehicle_project_conflict', 'vehicleAssignmentId'));
      }
    }
    if (datesInRange(row.startDate, row.endDate).some((date) => context.unscheduledDatesByStaffId[row.staffId]?.includes(date))) {
      conflicts.push(conflict(rowIndex, 'unscheduled_day', null, 'warning'));
    }
    if (site?.aoiConfidence === 'low' || site?.aoiConfidence === 'needs_verification') {
      conflicts.push(conflict(rowIndex, 'low_confidence_aoi', 'operationalSiteId', 'warning'));
    }
  });
  return conflicts;
}
