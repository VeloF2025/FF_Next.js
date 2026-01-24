import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { getAuth } from '../../../lib/auth-mock';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_jUJCNFiG38aY@ep-mute-brook-a99vppmn-pooler.gwc.azure.neon.tech/neondb?sslmode=require');

type PoleData = {
  success: boolean;
  data: any;
  total?: number;
  page?: number;
  pageSize?: number;
  message?: string;
  error?: string;
};

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PoleData>
) {
  // Check authentication
  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ success: false, data: null, message: 'Unauthorized' });
  }

  try {
    switch (req.method) {
      case 'GET':
        return await handleGetPoles(req, res);
      case 'POST':
        return await handleCreatePole(req, res);
      case 'PUT':
        return await handleUpdatePole(req, res);
      case 'DELETE':
        return await handleDeletePole(req, res);
      default:
        res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
        return res.status(405).json({ success: false, data: null, message: `Method ${req.method} not allowed` });
    }
  } catch (error: any) {
    console.error('Poles API Error:', error);
    return res.status(500).json({ success: false, data: null, error: 'Internal server error' });
  }
}

async function handleGetPoles(req: NextApiRequest, res: NextApiResponse<PoleData>) {
  try {
    const { projectId, id, status, page = '1', pageSize = '50', search } = req.query;
    
    // First ensure table exists
    await ensurePoleTableExists();

    // Get single pole by ID
    if (id) {
      const pole = await sql`
        SELECT p.*, pr.project_name, pr.project_code
        FROM sow_poles p
        LEFT JOIN projects pr ON p.project_id = pr.id
        WHERE p.id = ${id}::uuid
      `;
      
      if (pole.length === 0) {
        return res.status(404).json({ success: false, data: null, message: 'Pole not found' });
      }
      
      return res.status(200).json({ success: true, data: pole[0] });
    }

    // Build query for listing poles
    const whereConditions = [];
    const queryParams = [];
    
    if (projectId) {
      whereConditions.push(`p.project_id = $${queryParams.length + 1}::uuid`);
      queryParams.push(projectId);
    }
    
    if (status) {
      whereConditions.push(`p.status = $${queryParams.length + 1}`);
      queryParams.push(status);
    }
    
    if (search) {
      whereConditions.push(`(p.pole_number ILIKE $${queryParams.length + 1} OR p.location ILIKE $${queryParams.length + 1})`);
      queryParams.push(`%${search}%`);
    }
    
    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    const offset = (parseInt(page as string) - 1) * parseInt(pageSize as string);
    
    // Get total count
    const countQuery = `SELECT COUNT(*) FROM sow_poles p ${whereClause}`;
    const [countResult] = await sql.unsafe(countQuery, queryParams);
    const total = parseInt(countResult.count);
    
    // Get paginated results with project info
    const dataQuery = `
      SELECT p.*, pr.project_name, pr.project_code
      FROM sow_poles p
      LEFT JOIN projects pr ON p.project_id = pr.id
      ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT ${pageSize}
      OFFSET ${offset}
    `;
    
    const poles = await sql.unsafe(dataQuery, queryParams);
    
    return res.status(200).json({
      success: true,
      data: poles,
      total,
      page: parseInt(page as string),
      pageSize: parseInt(pageSize as string)
    });
    
  } catch (error: any) {
    console.error('Error fetching poles:', error);
    return res.status(500).json({ success: false, data: null, error: 'Failed to fetch poles' });
  }
}

async function handleCreatePole(req: NextApiRequest, res: NextApiResponse<PoleData>) {
  try {
    const poleData = req.body;
    
    if (!poleData.project_id || !poleData.pole_number) {
      return res.status(400).json({ 
        success: false, 
        data: null, 
        error: 'Project ID and pole number are required' 
      });
    }

    await ensurePoleTableExists();

    const newPole = await sql`
      INSERT INTO sow_poles (
        project_id, pole_number, location, pole_type, height,
        latitude, longitude, status, installation_date, installed_by,
        inspection_status, inspection_date, notes, photos, metadata
      )
      VALUES (
        ${poleData.project_id}::uuid, ${poleData.pole_number}, ${poleData.location},
        ${poleData.pole_type}, ${poleData.height}, ${poleData.latitude},
        ${poleData.longitude}, ${poleData.status || 'pending'}, ${poleData.installation_date},
        ${poleData.installed_by}, ${poleData.inspection_status}, ${poleData.inspection_date},
        ${poleData.notes}, ${JSON.stringify(poleData.photos || [])}, 
        ${JSON.stringify(poleData.metadata || {})}
      )
      RETURNING *
    `;
    
    return res.status(201).json({ success: true, data: newPole[0] });
    
  } catch (error: any) {
    console.error('Error creating pole:', error);
    return res.status(500).json({ success: false, data: null, error: 'Failed to create pole' });
  }
}

async function handleUpdatePole(req: NextApiRequest, res: NextApiResponse<PoleData>) {
  try {
    const { id } = req.query;
    const updateData = req.body;
    
    if (!id) {
      return res.status(400).json({ success: false, data: null, error: 'Pole ID required' });
    }

    await ensurePoleTableExists();

    const updatedPole = await sql`
      UPDATE sow_poles SET
        pole_number = COALESCE(${updateData.pole_number}, pole_number),
        location = COALESCE(${updateData.location}, location),
        pole_type = COALESCE(${updateData.pole_type}, pole_type),
        height = COALESCE(${updateData.height}, height),
        latitude = COALESCE(${updateData.latitude}, latitude),
        longitude = COALESCE(${updateData.longitude}, longitude),
        status = COALESCE(${updateData.status}, status),
        installation_date = COALESCE(${updateData.installation_date}, installation_date),
        installed_by = COALESCE(${updateData.installed_by}, installed_by),
        inspection_status = COALESCE(${updateData.inspection_status}, inspection_status),
        inspection_date = COALESCE(${updateData.inspection_date}, inspection_date),
        notes = COALESCE(${updateData.notes}, notes),
        photos = COALESCE(${JSON.stringify(updateData.photos)}, photos),
        metadata = COALESCE(${JSON.stringify(updateData.metadata)}, metadata),
        updated_at = NOW()
      WHERE id = ${id}::uuid
      RETURNING *
    `;
    
    if (updatedPole.length === 0) {
      return res.status(404).json({ success: false, data: null, message: 'Pole not found' });
    }
    
    return res.status(200).json({ success: true, data: updatedPole[0] });
    
  } catch (error: any) {
    console.error('Error updating pole:', error);
    return res.status(500).json({ success: false, data: null, error: 'Failed to update pole' });
  }
}

async function handleDeletePole(req: NextApiRequest, res: NextApiResponse<PoleData>) {
  try {
    const { id } = req.query;
    
    if (!id) {
      return res.status(400).json({ success: false, data: null, error: 'Pole ID required' });
    }

    await sql`DELETE FROM sow_poles WHERE id = ${id}::uuid`;
    
    return res.status(200).json({ success: true, data: null, message: 'Pole deleted successfully' });
    
  } catch (error: any) {
    console.error('Error deleting pole:', error);
    return res.status(500).json({ success: false, data: null, error: 'Failed to delete pole' });
  }
}

async function ensurePoleTableExists() {
  await sql`
    CREATE TABLE IF NOT EXISTS sow_poles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID,
      pole_number VARCHAR(255) NOT NULL,
      location VARCHAR(500),
      pole_type VARCHAR(100),
      height DECIMAL(10,2),
      latitude DECIMAL(10,8),
      longitude DECIMAL(11,8),
      status VARCHAR(50) DEFAULT 'pending',
      installation_date DATE,
      installed_by VARCHAR(255),
      inspection_status VARCHAR(50),
      inspection_date DATE,
      notes TEXT,
      photos JSONB DEFAULT '[]',
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`;
    
  // Create indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_sow_poles_project ON sow_poles(project_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_sow_poles_status ON sow_poles(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_sow_poles_number ON sow_poles(pole_number)`;
}

export default withAuth(handler);