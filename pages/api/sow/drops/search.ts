import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

const getSql = () => neon(process.env.DATABASE_URL!);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (!userId) {
    return apiResponse.unauthorized(res);
  }

  const sql = getSql();

  try {
    const {
      search = '',
      status = 'all',
      limit = '1000',
      offset = '0',
      projectId
    } = req.query;

    const limitNum = Math.min(parseInt(limit as string), 5000);
    const offsetNum = parseInt(offset as string);

    // Build search conditions
    let whereConditions: string[] = [];
    let params: any[] = [];

    if (search) {
      const searchTerm = `%${search}%`;
      whereConditions.push(`
        (drop_number ILIKE $${params.length + 1} OR
         pole_number ILIKE $${params.length + 1} OR
         address ILIKE $${params.length + 1} OR
         end_point ILIKE $${params.length + 1} OR
         municipality ILIKE $${params.length + 1})
      `);
      params.push(searchTerm);
    }

    if (status !== 'all') {
      whereConditions.push(`status = $${params.length + 1}`);
      params.push(status);
    }

    if (projectId) {
      whereConditions.push(`project_id = $${params.length + 1}`);
      params.push(projectId);
    }

    const whereClause = whereConditions.length > 0
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';

    // Get search results with pagination
    const query = await sql.unsafe(`
      SELECT * FROM drops
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, limitNum, offsetNum]);

    // Get total count for search results
    const countQuery = await sql.unsafe(`
      SELECT COUNT(*) as total FROM drops
      ${whereClause}
    `, params);

    const total = parseInt(countQuery[0]?.total || '0');

    return res.status(200).json({
      success: true,
      data: query,
      count: query.length,
      total,
      page: Math.floor(offsetNum / limitNum) + 1,
      pageSize: limitNum,
      totalPages: Math.ceil(total / limitNum),
      search: search,
      status: status
    });

  } catch (error) {
    log.error('Error searching drops', { error });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to search drops'
    });
  }
}

export default withAuth(handler);
