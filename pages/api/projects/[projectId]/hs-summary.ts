/**
 * Project H&S Summary API
 * GET /api/projects/[projectId]/hs-summary
 *
 * Returns H&S audit summary and compliance status
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const getSql = () => neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const { projectId } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.validationError(res, { projectId: 'Project ID is required' });
  }

  try {
    const sql = getSql();

    // Check project exists
    const projectExists = await sql`
      SELECT id FROM projects WHERE id = ${projectId}
    `;

    if (!projectExists || projectExists.length === 0) {
      return apiResponse.notFound(res, 'Project', projectId);
    }

    // Get latest audit
    const latestAudit = await sql`
      SELECT
        id,
        overall_score,
        audit_type,
        status,
        conducted_by,
        created_at
      FROM hs_project_audits
      WHERE project_id = ${projectId}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    // Get audit history stats
    const auditStats = await sql`
      SELECT
        COUNT(*) as total_audits,
        AVG(overall_score) as avg_score,
        MIN(overall_score) as min_score,
        MAX(overall_score) as max_score,
        COUNT(*) FILTER (WHERE overall_score >= 80) as passing_audits
      FROM hs_project_audits
      WHERE project_id = ${projectId}
    `;

    // Get incident counts
    const incidents = await sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE severity = 'critical') as critical,
        COUNT(*) FILTER (WHERE severity = 'high') as high,
        COUNT(*) FILTER (WHERE severity = 'medium') as medium,
        COUNT(*) FILTER (WHERE severity = 'low') as low,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as last_30_days
      FROM hs_incidents
      WHERE project_id = ${projectId}
    `;

    // Determine compliance status
    const latestScore = latestAudit[0]?.overall_score;
    let complianceStatus: 'compliant' | 'non-compliant' | 'unknown' = 'unknown';

    if (latestScore !== null && latestScore !== undefined) {
      complianceStatus = Number(latestScore) >= 80 ? 'compliant' : 'non-compliant';
    }

    // Format response
    const response = {
      latestScore: latestScore ? Number(latestScore) : null,
      lastAuditDate: latestAudit[0]?.created_at?.toISOString() || null,
      lastAuditType: latestAudit[0]?.audit_type || null,
      lastAuditStatus: latestAudit[0]?.status || null,
      complianceStatus,

      totalAudits: Number(auditStats[0]?.total_audits) || 0,
      avgScore: auditStats[0]?.avg_score
        ? Math.round(Number(auditStats[0].avg_score) * 10) / 10
        : null,
      passingAudits: Number(auditStats[0]?.passing_audits) || 0,

      incidents: {
        total: Number(incidents[0]?.total) || 0,
        critical: Number(incidents[0]?.critical) || 0,
        high: Number(incidents[0]?.high) || 0,
        medium: Number(incidents[0]?.medium) || 0,
        low: Number(incidents[0]?.low) || 0,
        last30Days: Number(incidents[0]?.last_30_days) || 0,
      },
    };

    return apiResponse.success(res, response);
  } catch (error) {
    log.error('Error fetching H&S summary', { error, projectId });
    return apiResponse.internalError(res, error as Error);
  }
}

export default withAuth(handler);
