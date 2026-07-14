import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth';
import { log } from '@/lib/logger';
import { syncQfieldForProject } from '@/modules/works-qa/services/syncQfieldCore';

interface SyncBody {
  project_id?: string;
  pole_label?: string;
}

// Thin RBAC-protected wrapper. The mapping logic lives in syncQfieldCore so the
// ingest cron (scripts/works-qa-sync.ts) shares exactly the same behaviour.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method!, ['POST']);

  const { project_id, pole_label } = req.body as SyncBody;
  if (!project_id) return apiResponse.badRequest(res, 'project_id required');

  try {
    const result = await syncQfieldForProject(pool, project_id, pole_label ?? null);
    return apiResponse.success(res, result);
  } catch (err) {
    log.error('works-qa/sync-qfield', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('construction-qa.works-qa.sync', 'create')(handler));
