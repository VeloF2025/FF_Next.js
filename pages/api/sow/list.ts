import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuth } from '../../../lib/auth-mock';
import { neon } from '@neondatabase/serverless';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_jUJCNFiG38aY@ep-mute-brook-a99vppmn-pooler.gwc.azure.neon.tech/neondb?sslmode=require');

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
  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ success: false, data: null, message: 'Unauthorized' });
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
      const polesData = await getSOWData('sow_poles', {
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
      const dropsData = await getSOWData('sow_drops', {
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
      const fibreData = await getSOWData('sow_fibre', {
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
    console.error('SOW List API Error:', error);
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
  
  const whereConditions = [];
  const queryParams = [];
  
  if (projectId) {
    whereConditions.push(`s.project_id = $${queryParams.length + 1}::uuid`);
    queryParams.push(projectId);
  }
  
  if (status) {
    whereConditions.push(`s.status = $${queryParams.length + 1}`);
    queryParams.push(status);
  }
  
  if (search) {
    if (table === 'sow_poles') {
      whereConditions.push(`(s.pole_number ILIKE $${queryParams.length + 1} OR s.location ILIKE $${queryParams.length + 1})`);
    } else if (table === 'sow_drops') {
      whereConditions.push(`(s.drop_number ILIKE $${queryParams.length + 1} OR s.address ILIKE $${queryParams.length + 1})`);
    } else if (table === 'sow_fibre') {
      whereConditions.push(`(s.cable_id ILIKE $${queryParams.length + 1} OR s.start_location ILIKE $${queryParams.length + 1} OR s.end_location ILIKE $${queryParams.length + 1})`);
    }
    queryParams.push(`%${search}%`);
  }
  
  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
  
  // Get count
  const countQuery = `SELECT COUNT(*) FROM ${table} s ${whereClause}`;
  const countResults = await sql.unsafe(countQuery, queryParams);
  const countResult = Array.isArray(countResults) ? countResults[0] : countResults;
  const count = parseInt(countResult?.count || '0');
  
  // Get data with project info
  let dataQuery = `
    SELECT s.*, p.project_name, p.project_code
    FROM ${table} s
    LEFT JOIN projects p ON s.project_id = p.id
    ${whereClause}
    ORDER BY s.${sortBy} ${sortOrder}
  `;
  
  if (limit !== undefined && offset !== undefined) {
    dataQuery += ` LIMIT ${limit} OFFSET ${offset}`;
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
    CREATE TABLE IF NOT EXISTS sow_poles (
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
    CREATE TABLE IF NOT EXISTS sow_drops (
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
    CREATE TABLE IF NOT EXISTS sow_fibre (
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
