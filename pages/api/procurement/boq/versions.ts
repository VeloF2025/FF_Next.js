import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const { projectId } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.badRequest(res, 'projectId query parameter is required');
  }

  try {
    const versions = await sql`
      SELECT
        b.id,
        b.version,
        b.title,
        b.status,
        b.created_at,
        b.updated_at,
        b.uploaded_by,
        COALESCE(b.total_estimated_value, 0) as total_estimated_value,
        COUNT(bi.id)::int as item_count
      FROM boqs b
      LEFT JOIN boq_items bi ON bi.boq_id = b.id
      WHERE b.project_id = ${projectId}
      GROUP BY b.id
      ORDER BY b.version::numeric DESC
    `;

    return apiResponse.success(res, {
      versions: versions.map((v: any) => ({
        id: v.id,
        version: v.version,
        title: v.title,
        status: v.status,
        itemCount: v.item_count,
        totalValue: Number(v.total_estimated_value),
        uploadedBy: v.uploaded_by,
        createdAt: v.created_at,
        updatedAt: v.updated_at,
      })),
    });
  } catch (error) {
    log.error('Failed to fetch BOQ versions', error);
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
