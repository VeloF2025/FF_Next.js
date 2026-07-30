import { query } from '@/lib/db-pool';

export interface ProjectCandidate {
  matchRank: number;
  fibreflowId: string;
  fibreflowCode: string;
  fibreflowName: string;
  qfieldRegistrationId: string | null;
  qfieldProjectId: string | null;
  qfieldName: string | null;
  qfieldActive: boolean;
  qfieldLastUpdatedAt: string | null;
}

export interface ProjectResolverRepository {
  findCandidates(identifier: string): Promise<ProjectCandidate[]>;
}

export const projectResolverRepo: ProjectResolverRepository = {
  async findCandidates(identifier) {
    return query<ProjectCandidate>(
      `
      SELECT
        CASE
          WHEN p.id::text = $1 THEN 1
          WHEN qp.qfield_project_id::text = $1 THEN 2
          WHEN lower(p.project_code) = lower($1) THEN 3
          WHEN lower(p.project_name) = lower($1)
            OR lower(qp.name) = lower($1) THEN 4
          ELSE 5
        END AS "matchRank",
        p.id::text AS "fibreflowId",
        p.project_code AS "fibreflowCode",
        p.project_name AS "fibreflowName",
        qp.id::text AS "qfieldRegistrationId",
        qp.qfield_project_id::text AS "qfieldProjectId",
        qp.name AS "qfieldName",
        COALESCE(qp.is_active, false) AS "qfieldActive",
        qp.last_synced_at::text AS "qfieldLastUpdatedAt"
      FROM projects p
      LEFT JOIN qfield_project_links qpl ON qpl.fibreflow_project_id = p.id
      LEFT JOIN qfield_projects qp ON qp.id = qpl.qfield_project_id
      WHERE p.id::text = $1
         OR qp.qfield_project_id::text = $1
         OR lower(p.project_code) = lower($1)
         OR lower(p.project_name) = lower($1)
         OR lower(qp.name) = lower($1)
         OR position(lower($1) in lower(p.project_name)) > 0
         OR position(lower($1) in lower(qp.name)) > 0
      ORDER BY "matchRank", p.project_name, qp.name
    `,
      [identifier]
    );
  },
};
