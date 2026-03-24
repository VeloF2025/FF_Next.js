import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL!);

type SOWListResponse = {
  success: boolean;
  data: any;
  pagination?: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
  message?: string;
  error?: string;
};

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SOWListResponse>
) {
  // Check authentication
  const userId = (req as AuthenticatedNextApiRequest).user?.id;
  if (!userId) {
    return apiResponse.unauthorized(res);
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ 
      success: false, 
      data: null, 
      message: `Method ${req.method} not allowed` 
    });
  }

  try {
    const { 
      type = 'all', // 'poles', 'drops', 'fibre', 'all'
      projectId,
      status,
      page = '1',
      pageSize = '50',
      search,
      sortBy = 'created_at',
      sortOrder = 'DESC'
    } = req.query;

    const currentPage = parseInt(page as string);
    const limit = parseInt(pageSize as string);
    const offset = (currentPage - 1) * limit;

    // Ensure tables exist
    await ensureTablesExist();

    let results = [];
    let totalCount = 0;

    if (type === 'all' || type === 'poles') {
      const polesData = await getSOWData('poles', {
        projectId: projectId as string,
        status: status as string,
        search: search as string,
        limit,
        offset,
        sortBy: sortBy as string,
        sortOrder: sortOrder as string
      });
      
      if (type === 'poles') {
        results = polesData.data;
        totalCount = polesData.count;
      } else {
        results.push(...polesData.data.map((item: any) => ({ ...item, type: 'pole' })));
        totalCount += polesData.count;
      }
    }

    if (type === 'all' || type === 'drops') {
      const dropsData = await getSOWData('drops', {
        projectId: projectId as string,
        status: status as string,
        search: search as string,
        limit: type === 'drops' ? limit : undefined,
        offset: type === 'drops' ? offset : undefined,
        sortBy: sortBy as string,
        sortOrder: sortOrder as string
      });
      
      if (type === 'drops') {
        results = dropsData.data;
        totalCount = dropsData.count;
      } else {
        results.push(...dropsData.data.map((item: any) => ({ ...item, type: 'drop' })));
        totalCount += dropsData.count;
      }
    }

    if (type === 'all' || type === 'fibre') {
      const fibreData = await getSOWData('fibre_segments', {
        projectId: projectId as string,
        status: status as string,
        search: search as string,
        limit: type === 'fibre' ? limit : undefined,
        offset: type === 'fibre' ? offset : undefined,
        sortBy: sortBy as string,
        sortOrder: sortOrder as string
      });
      
      if (type === 'fibre') {
        results = fibreData.data;
        totalCount = fibreData.count;
      } else {
        results.push(...fibreData.data.map((item: any) => ({ ...item, type: 'fibre' })));
        totalCount += fibreData.count;
      }
    }

    // If fetching all types, apply pagination to combined results
    if (type === 'all') {
      // Sort combined results
      results.sort((a, b) => {
        const aVal = a[sortBy as string];
        const bVal = b[sortBy as string];
        const order = sortOrder === 'DESC' ? -1 : 1;
        return aVal > bVal ? order : -order;
      });
      
      // Apply pagination
      const paginatedResults = results.slice(offset, offset + limit);
      
      return res.status(200).json({
        success: true,
        data: paginatedResults,
        pagination: {
          total: totalCount,
          page: currentPage,
          pageSize: limit,
          totalPages: Math.ceil(totalCount / limit)
        }
      });
    }

    return res.status(200).json({
      success: true,
      data: results,
      pagination: {
        total: totalCount,
        page: currentPage,
        pageSize: limit,
        totalPages: Math.ceil(totalCount / limit)
      }
    });

  } catch (error: any) {
    log.error('SOW List API Error', { error });
    return res.status(500).json({
      success: false,
      data: null,
      error: 'Internal server error'
    });
  }
}

async function getSOWData(
  table: string, 
  params: {
    projectId?: string;
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
    sortBy: string;
    sortOrder: string;
  }
) {
  const { projectId, status, search, limit, offset, sortBy, sortOrder } = params;

  // Validate table name against allowlist to prevent SQL injection
  const ALLOWED_TABLES: Record<string, string> = {
    poles: 'poles',
    drops: 'drops',
    fibre_segments: 'fibre_segments'
  };
  const safeTable = ALLOWED_TABLES[table];
  if (!safeTable) {
    throw new Error(`Invalid table name: ${table}`);
  }

  // Validate sortBy against allowlist to prevent SQL injection
  const validSortColumns = ['created_at', 'updated_at', 'pole_number', 'drop_number', 'cable_id', 'status', 'location', 'address', 'start_location', 'end_location'];
  const safeSortBy = validSortColumns.includes(sortBy) ? sortBy : 'created_at';
  const safeSortOrder = sortOrder?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const whereConditions: string[] = [];
  const queryParams: any[] = [];
  
  if (projectId) {
    whereConditions.push(`s.project_id = $${queryParams.length + 1}::uuid`);
    queryParams.push(projectId);
  }
  
  if (status) {
    whereConditions.push(`s.status = $${queryParams.length + 1}`);
    queryParams.push(status);
  }
  
  if (search) {
    if (safeTable === 'poles') {
      whereConditions.push(`(s.pole_number ILIKE $${queryParams.length + 1} OR s.location ILIKE $${queryParams.length + 1})`);
    } else if (safeTable === 'drops') {
      whereConditions.push(`(s.drop_number ILIKE $${queryParams.length + 1} OR s.address ILIKE $${queryParams.length + 1})`);
    } else if (safeTable === 'fibre_segments') {
      whereConditions.push(`(s.cable_id ILIKE $${queryParams.length + 1} OR s.start_location ILIKE $${queryParams.length + 1} OR s.end_location ILIKE $${queryParams.length + 1})`);
    }
    queryParams.push(`%${search}%`);
  }
  
  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
  
  // Get count - use safeTable (validated against allowlist)
  const countQuery = `SELECT COUNT(*) FROM ${safeTable} s ${whereClause}`;
  const countResults = await sql.unsafe(countQuery, queryParams);
  const countResult = Array.isArray(countResults) ? countResults[0] : countResults;
  const count = parseInt(countResult?.count || '0');

  // Get data with project info - use safeTable (validated against allowlist)
  let dataQuery = `
    SELECT s.*, p.project_name, p.project_code
    FROM ${safeTable} s
    LEFT JOIN projects p ON s.project_id = p.id
    ${whereClause}
    ORDER BY s.${safeSortBy} ${safeSortOrder}
  `;

  // Parameterize LIMIT and OFFSET to prevent SQL injection
  if (limit !== undefined && offset !== undefined) {
    dataQuery += ` LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
    queryParams.push(limit, offset);
  }

  const dataResults = await sql.unsafe(dataQuery, queryParams);
  const data = Array.isArray(dataResults) ? dataResults : [];
  
  return { data, count };
}

async function ensureTablesExist() {
  // Ensure projects table exists
  await sql`
    CREATE TABLE IF NOT EXISTS projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_code VARCHAR(50) NOT NULL UNIQUE,
      project_name VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`;
    
  // Ensure SOW tables exist
  await sql`
    CREATE TABLE IF NOT EXISTS poles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID,
      pole_number VARCHAR(255) NOT NULL,
      location VARCHAR(500),
      pole_type VARCHAR(100),
      height DECIMAL(10,2),
      status VARCHAR(50) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS drops (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID,
      drop_number VARCHAR(255) NOT NULL,
      address VARCHAR(500),
      drop_type VARCHAR(100),
      cable_length DECIMAL(10,2),
      status VARCHAR(50) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS fibre_segments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID,
      cable_id VARCHAR(255) NOT NULL,
      start_location VARCHAR(255),
      end_location VARCHAR(255),
      cable_type VARCHAR(100),
      length DECIMAL(10,2),
      status VARCHAR(50) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`;
}

export default withAuth(handler);
