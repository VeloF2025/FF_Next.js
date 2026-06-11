/**
 * Project API helpers for the field-stock PWA.
 *
 * Fetches active projects for the issue wizard's project picker. The chosen
 * projectId is threaded into the picking body (api/pickings.ts) so the server
 * stamps stock_pickings.project_id, feeding the Accountability per-project
 * breakdown. No server imports; no pg.Pool.
 */

import { request } from './request';

interface ProjectRow {
  id: string;
  project_name: string | null;
  project_code: string | null;
  status: string | null;
}

export interface PwaProjectSummary {
  id: string;
  name: string;
  code: string | null;
  status: string | null;
}

/**
 * Fetch active (non-terminal) projects, optionally filtered by search term.
 * The endpoint returns at most 200 rows ordered by name.
 */
export async function fetchProjects(
  opts: { search?: string } = {}
): Promise<PwaProjectSummary[]> {
  const params = new URLSearchParams();
  if (opts.search) params.set('search', opts.search);
  const qs = params.toString();
  const rows = await request<ProjectRow[]>(
    `/api/my/stores/projects${qs ? `?${qs}` : ''}`
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.project_name ?? '(unnamed project)',
    code: r.project_code ?? null,
    status: r.status ?? null,
  }));
}
