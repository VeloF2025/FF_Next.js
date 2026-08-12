import { randomUUID } from 'node:crypto';
import { assignmentFingerprint } from './fingerprint';
import {
  endAssignmentRow, expandActiveTeamStaff, insertAssignment, insertAudit, listAssignmentHistory, lockRelevantPreviewSources,
  loadAssignmentsForCopy, loadPreviewState, lockAssignment, runAssignmentTransaction,
  supersedeAssignment, type ActorScope, type AssignmentActor, type AssignmentRecord,
} from './assignmentQueries';
import type { AssignmentProposalRow, PreviewResult } from './types';
import { normalizeProposal, ProposalNormalizationError, validateProposal } from './validation';

export type AssignmentServiceCode = 'INVALID_INPUT' | 'STALE_PREVIEW' | 'BLOCKING_CONFLICTS' |
  'WARNINGS_UNCONFIRMED' | 'ASSIGNMENT_OVERLAP' | 'ASSIGNMENT_NOT_FOUND' |
  'ASSIGNMENT_NOT_ACTIVE' | 'INVALID_END_DATE';
export class AssignmentServiceError extends Error {
  constructor(public readonly code: AssignmentServiceCode, message: string, public readonly status: number) {
    super(message); this.name = 'AssignmentServiceError';
  }
}

export interface PreviewAssignmentsInput {
  rows: unknown[];
  teamIds?: string[];
  teamRow?: Omit<AssignmentProposalRow, 'staffId'> & { staffId?: undefined };
}
export interface AssignmentPreview extends PreviewResult { excludedStaffIds: string[] }
export interface CommitAssignmentsInput extends PreviewAssignmentsInput { confirmedWarnings?: boolean }
export interface EndAssignmentInput { endDate: string; reason: string }
export interface CopyPreviewInput { assignmentIds: string[]; destinationStartDate: string }

function normalize(rows: unknown[]): AssignmentProposalRow[] {
  try { return normalizeProposal(rows); }
  catch (error) {
    if (error instanceof ProposalNormalizationError) throw new AssignmentServiceError('INVALID_INPUT', error.message, 400);
    throw error;
  }
}

async function expand(input: PreviewAssignmentsInput): Promise<{ rows: AssignmentProposalRow[]; excludedStaffIds: string[] }> {
  const direct = normalize(input.rows);
  if (!input.teamIds?.length) return { rows: direct, excludedStaffIds: [] };
  if (!input.teamRow) throw new AssignmentServiceError('INVALID_INPUT', 'teamRow is required with teamIds', 400);
  const expansion = await expandActiveTeamStaff(input.teamIds);
  const teamRows = normalize(expansion.staffIds.map((staffId) => ({ ...input.teamRow, staffId })));
  return { rows: [...direct, ...teamRows], excludedStaffIds: expansion.excludedStaffIds };
}

function assertScope(rows: AssignmentProposalRow[], scope: ActorScope): void {
  if (scope.allProjects) return;
  const permitted = new Set(scope.authorizedProjectIds ?? []);
  if (rows.some((row) => !permitted.has(row.projectId))) {
    throw new AssignmentServiceError('INVALID_INPUT', 'Proposal includes an unauthorized project', 403);
  }
}

export async function previewAssignments(input: PreviewAssignmentsInput, actorScope: ActorScope): Promise<AssignmentPreview> {
  const expanded = await expand(input); assertScope(expanded.rows, actorScope);
  const state = await loadPreviewState(expanded.rows);
  const conflicts = validateProposal(expanded.rows, state.context);
  return { normalizedRows: expanded.rows, conflicts, sourceVersion: state.sourceVersion,
    fingerprint: assignmentFingerprint(expanded.rows, state.sourceVersion), excludedStaffIds: expanded.excludedStaffIds };
}

function mapWriteError(error: unknown): never {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23P01') {
    throw new AssignmentServiceError('ASSIGNMENT_OVERLAP', 'An assignment overlaps an active assignment', 409);
  }
  throw error;
}

export async function commitAssignments(input: CommitAssignmentsInput, fingerprint: string, actor: AssignmentActor): Promise<{ batchId: string; assignmentIds: string[] }> {
  const expanded = await expand(input);
  try {
    return await runAssignmentTransaction(async (tx) => {
      await lockRelevantPreviewSources(tx, expanded.rows, input.teamIds);
      const state = await loadPreviewState(expanded.rows, tx, true);
      if (assignmentFingerprint(expanded.rows, state.sourceVersion) !== fingerprint) {
        throw new AssignmentServiceError('STALE_PREVIEW', 'The preview is stale; preview again', 409);
      }
      const conflicts = validateProposal(expanded.rows, state.context);
      if (conflicts.some((item) => item.level === 'blocking')) throw new AssignmentServiceError('BLOCKING_CONFLICTS', 'Blocking conflicts must be resolved', 409);
      if (conflicts.some((item) => item.level === 'warning') && input.confirmedWarnings !== true) throw new AssignmentServiceError('WARNINGS_UNCONFIRMED', 'Warnings require confirmation', 409);
      const batchId = randomUUID(); const assignmentIds: string[] = [];
      for (const proposal of expanded.rows) {
        const snapshot = state.snapshots[proposal.projectId];
        if (!snapshot?.sites[proposal.operationalSiteId]) throw new AssignmentServiceError('BLOCKING_CONFLICTS', 'Project snapshot is unavailable', 409);
        const created = await insertAssignment(tx, proposal, actor.userId, snapshot);
        await insertAudit(tx, created.id, proposal.assignmentKind === 'daily_override' ? 'override_created' : 'bulk_created', batchId, actor.userId, proposal.reason, null, created);
        assignmentIds.push(created.id);
      }
      return { batchId, assignmentIds };
    });
  } catch (error) { return mapWriteError(error); }
}

function assertActive(record: AssignmentRecord | null): asserts record is AssignmentRecord {
  if (!record) throw new AssignmentServiceError('ASSIGNMENT_NOT_FOUND', 'Assignment not found', 404);
  if (record.status !== 'active') throw new AssignmentServiceError('ASSIGNMENT_NOT_ACTIVE', 'Assignment is not active', 409);
}

export async function replaceAssignment(id: string, replacement: unknown, actor: AssignmentActor): Promise<AssignmentRecord> {
  const proposal = normalize([replacement])[0]!;
  try {
    return await runAssignmentTransaction(async (tx) => {
      const before = await lockAssignment(tx, id); assertActive(before);
      const state = await loadPreviewState([proposal], tx, true);
      const conflicts = validateProposal([proposal], { ...state.context,
        existingAssignments: state.context.existingAssignments.filter((item) => !(item.staffId === before.staffId && item.startDate === before.startDate && item.endDate === before.endDate)) });
      if (conflicts.some((item) => item.level === 'blocking')) throw new AssignmentServiceError('BLOCKING_CONFLICTS', 'Replacement has conflicts', 409);
      const snapshot = state.snapshots[proposal.projectId];
      if (!snapshot) throw new AssignmentServiceError('BLOCKING_CONFLICTS', 'Project snapshot is unavailable', 409);
      const correlationId = randomUUID();
      const created = await insertAssignment(tx, proposal, actor.userId, snapshot);
      await supersedeAssignment(tx, id, created.id);
      await insertAudit(tx, created.id, 'moved', correlationId, actor.userId, proposal.reason, null, created);
      await insertAudit(tx, id, 'superseded', correlationId, actor.userId, proposal.reason, before, { ...before, status: 'superseded', supersededBy: created.id });
      return created;
    });
  } catch (error) { return mapWriteError(error); }
}

export async function endAssignment(id: string, input: EndAssignmentInput, actor: AssignmentActor): Promise<AssignmentRecord> {
  const reason = input.reason?.trim();
  if (!reason) throw new AssignmentServiceError('INVALID_INPUT', 'A reason is required', 400);
  return runAssignmentTransaction(async (tx) => {
    const before = await lockAssignment(tx, id); assertActive(before);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.endDate) || input.endDate < before.startDate || input.endDate > before.endDate) {
      throw new AssignmentServiceError('INVALID_END_DATE', 'End date must fall within the assignment coverage', 400);
    }
    const after = { ...before, endDate: input.endDate, reason, status: 'ended' as const };
    await endAssignmentRow(tx, id, input.endDate, reason);
    await insertAudit(tx, id, 'ended', randomUUID(), actor.userId, reason, before, after);
    return after;
  });
}

export const getAssignmentHistory = (id: string): Promise<Record<string, unknown>[]> => listAssignmentHistory(id);

function addDays(date: string, days: number): string { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
function dayDifference(start: string, end: string): number { return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000); }

export async function previewAssignmentCopy(input: CopyPreviewInput, actorScope: ActorScope): Promise<AssignmentPreview> {
  const source = (await loadAssignmentsForCopy(input.assignmentIds)).filter((row) => row.assignmentKind === 'roster');
  const shifted = source.map((row) => ({ ...row, id: undefined, status: undefined, supersededBy: undefined,
    startDate: input.destinationStartDate, endDate: addDays(input.destinationStartDate, dayDifference(row.startDate, row.endDate)),
    vehicleAssignmentId: null }));
  assertScope(shifted, actorScope);
  const initial = await loadPreviewState(shifted);
  const rows = shifted.map((row) => ({ ...row, vehicleAssignmentId: initial.context.vehicleAssignments.find((vehicle) =>
    vehicle.staffId === row.staffId && vehicle.startDate <= row.startDate && vehicle.endDate >= row.endDate)?.id ?? null }));
  const state = await loadPreviewState(rows);
  return { normalizedRows: rows, conflicts: validateProposal(rows, state.context), sourceVersion: state.sourceVersion,
    fingerprint: assignmentFingerprint(rows, state.sourceVersion), excludedStaffIds: [] };
}
