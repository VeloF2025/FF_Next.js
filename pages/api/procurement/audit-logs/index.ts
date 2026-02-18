import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { listAuditLogs } from '@/services/procurement/auditService';
import type { AuditLogFilter, AuditEntityTypeValue, AuditActionValue } from '@/types/procurement/audit.types';

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse,
) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  try {
    const {
      page = '1',
      limit = '50',
      entity_type,
      entity_id,
      action,
      performed_by,
      project_id,
    } = req.query;

    const pageNum = parseInt(page as string, 10);
    const pageSize = parseInt(limit as string, 10);

    const filter: AuditLogFilter = {};
    if (entity_type) filter.entityType = entity_type as AuditEntityTypeValue;
    if (entity_id) filter.entityId = entity_id as string;
    if (action) filter.action = action as AuditActionValue;
    if (performed_by) filter.performedBy = performed_by as string;
    if (project_id) filter.projectId = project_id as string;

    const { items, total } = await listAuditLogs(filter, pageNum, pageSize);

    return apiResponse.paginated(res, items, {
      page: pageNum,
      pageSize,
      total,
    });
  } catch (error) {
    return apiResponse.databaseError(res, error, 'Failed to fetch audit logs');
  }
}));
