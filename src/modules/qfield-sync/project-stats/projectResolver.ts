import { ErrorCode } from '@/lib/apiResponse';
import { ProjectStatsError } from './errors';
import {
  projectResolverRepo,
  type ProjectCandidate,
  type ProjectResolverRepository,
} from './projectResolverRepo';
import type { ResolvedProject } from './types';

function safeCandidate(row: ProjectCandidate) {
  return {
    fibreflowId: row.fibreflowId,
    fibreflowCode: row.fibreflowCode,
    fibreflowName: row.fibreflowName,
    qfieldProjectId: row.qfieldProjectId,
    qfieldName: row.qfieldName,
  };
}

export async function resolveProject(
  identifier: string,
  repo: ProjectResolverRepository = projectResolverRepo
): Promise<ResolvedProject> {
  const rows = await repo.findCandidates(identifier);
  if (rows.length === 0) {
    throw new ProjectStatsError(ErrorCode.NOT_FOUND, `Project '${identifier}' not found`);
  }

  const bestRank = Math.min(...rows.map((row) => Number(row.matchRank)));
  const best = rows.filter((row) => Number(row.matchRank) === bestRank);
  const linked = best.filter(
    (row) => row.qfieldActive && row.qfieldRegistrationId && row.qfieldProjectId && row.qfieldName
  );

  if (linked.length === 0) {
    throw new ProjectStatsError(
      ErrorCode.VALIDATION_ERROR,
      `Project '${identifier}' has no active linked QField project`
    );
  }
  if (linked.length > 1) {
    throw new ProjectStatsError(
      ErrorCode.CONFLICT,
      `Project '${identifier}' matches multiple active QField projects`,
      { candidates: linked.map(safeCandidate) }
    );
  }

  const row = linked[0]!;
  return {
    fibreflow: {
      id: row.fibreflowId,
      code: row.fibreflowCode,
      name: row.fibreflowName,
    },
    qfield: {
      registrationId: row.qfieldRegistrationId!,
      projectId: row.qfieldProjectId!,
      name: row.qfieldName!,
      lastUpdatedAt: row.qfieldLastUpdatedAt,
    },
  };
}
