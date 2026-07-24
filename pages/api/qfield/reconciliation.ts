import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { getAuditDeltas, getProjects } from '@/modules/qfield-recon/services/qfcDeltaRepo';
import { getPonMap } from '@/modules/qfield-recon/services/ponMapService';
import { listDcimKeys, MinioUnavailableError } from '@/lib/qfieldcloud/minio';
import { buildReconciliation } from '@/modules/qfield-recon/services/reconciliationService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET']);
  const { projectId } = req.query;
  if (!projectId || typeof projectId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) {
    return apiResponse.badRequest(res, 'Valid projectId (uuid) required');
  }
  try {
    const projects = await getProjects();
    const project = projects.find(p => p.id === projectId);
    if (!project) return apiResponse.notFound(res, 'Project', projectId);

    const [deltas, ponMap, presentPhotoKeys] = await Promise.all([
      getAuditDeltas(projectId),
      getPonMap(projectId),
      listDcimKeys(projectId),
    ]);

    const notes: string[] = [];
    if (!ponMap.available) notes.push('No design layer (MOAPons/MOAPoles) found — civil is per-zone only; optical never-captured uses observed-sequence gaps.');

    const model = buildReconciliation({
      project: { id: project.id, name: project.name },
      deltas, ponMap, presentPhotoKeys, notes,
    });
    return apiResponse.success(res, model);
  } catch (error) {
    if (error instanceof MinioUnavailableError) {
      return apiResponse.error(res, ErrorCode.SERVICE_UNAVAILABLE,
        'Reconciliation report only runs on the velo server (MinIO unavailable).');
    }
    log.error('qfield-recon', error instanceof Error ? { message: error.message } : { error });
    return apiResponse.databaseError(res, error);
  }
}
export default withAuth(handler);
