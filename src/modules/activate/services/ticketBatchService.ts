/**
 * Normalizes ticket creation request bodies to a uniform batch array.
 * Supports both old single-batch shape and new multi-batch shape.
 */

import type { ProjectTeamAssignment } from '@/modules/noc/types/team';

export interface TicketBatchInput {
  ids: number[];
  assigned_team_id?: string;
}

export interface OltTicketBatchInput {
  ids: string[]; // UUID primary keys
  assigned_team_id?: string;
}

export function normalizePPTicketBatches(body: Record<string, unknown>): TicketBatchInput[] {
  if (Array.isArray(body.batches)) {
    return (body.batches as Record<string, unknown>[]).map((b) => ({
      ids: (b.pp_data_ids as number[]) ?? [],
      assigned_team_id: (b.assigned_team_id as string | undefined) ?? undefined,
    }));
  }
  return [{ ids: (body.pp_data_ids as number[]) ?? [], assigned_team_id: (body.assigned_team_id as string | undefined) ?? undefined }];
}

export function normalizeOltTicketBatches(body: Record<string, unknown>): OltTicketBatchInput[] {
  if (Array.isArray(body.batches)) {
    return (body.batches as Record<string, unknown>[]).map((b) => ({
      ids: (b.record_ids as string[]) ?? [],
      assigned_team_id: (b.assigned_team_id as string | undefined) ?? undefined,
    }));
  }
  return [{ ids: (body.record_ids as string[]) ?? [], assigned_team_id: (body.assigned_team_id as string | undefined) ?? undefined }];
}

/**
 * Group records by project. Generic over id type (PP uses number, OLT uses string).
 * Records with null/undefined project are grouped under 'Unknown'.
 */
export function groupRecordsByProject<T extends string | number>(
  records: Array<{ id: T; project?: string | null }>
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of records) {
    const project = r.project || 'Unknown';
    if (!map.has(project)) map.set(project, []);
    map.get(project)!.push(r.id);
  }
  return map;
}

export function resolveTeamForProject(
  projectName: string,
  assignments: ProjectTeamAssignment[]
): { team_id: string; team_name: string } | null {
  const match = assignments.find(
    (a) => a.project_name === projectName && a.role === 'activations'
  );
  if (!match) return null;
  return { team_id: match.team_id, team_name: match.team_name || match.team_id };
}
