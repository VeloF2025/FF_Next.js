import { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql, logCreate, logUpdate, logDelete } from '@/lib/db-logger';
import { apiLogger } from '@/lib/logger';

// Create a new connection for each request to avoid connection pooling issues
const getSql = () => createLoggedSql(process.env.DATABASE_URL!);

// API route handler for projects CRUD operations
export default withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  // CORS handled by withErrorHandler - no need for manual headers
  
  // Handle different HTTP methods
  switch (req.method) {
    case 'GET':
      return handleGet(req, res);
    case 'POST':
      return handlePost(req, res);
    case 'PUT':
      return handlePut(req, res);
    case 'DELETE':
      return handleDelete(req, res);
    default:
      res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
})

// GET /api/projects - Fetch all projects or single project by ID
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const { id, search, status, client_id, limit = 50, offset = 0 } = req.query;
  const sql = getSql();
  
  try {
    // Fetch single project by ID
    if (id) {
      const project = await sql`
        SELECT 
          p.id,
          p.project_code,
          p.project_name as name,
          p.client_id,
          p.description,
          p.project_type as type,
          p.status,
          p.priority,
          p.start_date,
          p.end_date,
          p.budget,
          p.actual_cost,
          p.project_manager,
          p.progress,
          p.created_at,
          p.updated_at,
          c.company_name as client_name,
          CONCAT(s.first_name, ' ', s.last_name) as manager_name
        FROM projects p
        LEFT JOIN clients c ON p.client_id = c.id
        LEFT JOIN staff s ON p.project_manager = s.id
        WHERE p.id = ${id as string}
      `;
      
      if (project.length === 0) {
        return res.status(404).json({ error: 'Project not found' });
      }
      
      return res.status(200).json({ success: true, data: project[0] });
    }
    
    // Build query with filters
    let query = `
      SELECT 
        p.id,
        p.project_code,
        p.project_name as name,
        p.client_id,
        p.description,
        p.project_type as type,
        p.status,
        p.priority,
        p.start_date,
        p.end_date,
        p.budget,
        p.actual_cost,
        p.project_manager,
        p.progress,
        p.created_at,
        p.updated_at,
        c.company_name as client_name,
        CONCAT(s.first_name, ' ', s.last_name) as manager_name,
        COUNT(DISTINCT t.id) as task_count
      FROM projects p
      LEFT JOIN clients c ON p.client_id = c.id
      LEFT JOIN staff s ON p.project_manager = s.id
      LEFT JOIN tasks t ON p.id = t.project_id
      WHERE 1=1
    `;
    
    const params: any[] = [];
    let paramIndex = 1;
    
    if (search) {
      query += ` AND (LOWER(p.project_name) LIKE LOWER($${paramIndex}) OR LOWER(p.description) LIKE LOWER($${paramIndex}))`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    
    if (status) {
      query += ` AND p.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    
    if (client_id) {
      query += ` AND p.client_id = $${paramIndex}`;
      params.push(client_id);
      paramIndex++;
    }
    
    query += ` GROUP BY p.id, p.project_code, p.project_name, p.client_id, p.description, p.project_type, p.status, p.priority, p.start_date, p.end_date, p.budget, p.actual_cost, p.project_manager, p.progress, p.created_at, p.updated_at, c.company_name, s.first_name, s.last_name ORDER BY p.created_at DESC`;
    
    if (limit) {
      query += ` LIMIT $${paramIndex}`;
      params.push(Number(limit));
      paramIndex++;
    }
    
    if (offset) {
      query += ` OFFSET $${paramIndex}`;
      params.push(Number(offset));
    }
    
    const projects = params.length > 0
      ? await sql.query(query, params)
      : await sql.query(query);
    
    return res.status(200).json({ success: true, data: projects || [] });
  } catch (error) {
    apiLogger.error({ error, method: 'GET', path: '/api/projects' }, 'Failed to fetch projects');
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// POST /api/projects - Create new project
async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const sql = getSql();
  try {
    const projectData = req.body;
    
    // Validate required fields
    if (!projectData.name) {
      return res.status(400).json({ error: 'Project name is required' });
    }
    
    // Helper to convert empty strings to null
    const toNullIfEmpty = (val: any) => (val === '' || val === undefined) ? null : val;

    // Generate project code if not provided (PRJ-XXXXXX format)
    const generateProjectCode = () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let code = 'PRJ-';
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return code;
    };
    const projectCode = projectData.project_code || projectData.projectCode || generateProjectCode();

    const newProject = await sql`
      INSERT INTO projects (
        project_code, project_name, description, client_id, project_manager,
        status, priority, start_date, end_date,
        budget, actual_cost,
        location, latitude, longitude
      )
      VALUES (
        ${projectCode},
        ${projectData.name},
        ${toNullIfEmpty(projectData.description)},
        ${toNullIfEmpty(projectData.client_id || projectData.clientId)},
        ${toNullIfEmpty(projectData.project_manager_id || projectData.projectManagerId || projectData.project_manager)},
        ${projectData.status || 'PLANNING'},
        ${projectData.priority || 'MEDIUM'},
        ${toNullIfEmpty(projectData.start_date || projectData.startDate) || new Date().toISOString()},
        ${toNullIfEmpty(projectData.end_date || projectData.endDate)},
        ${projectData.budget_allocated || projectData.budgetAllocated || projectData.budget || 0},
        ${projectData.budget_spent || projectData.budgetSpent || projectData.actual_cost || 0},
        ${toNullIfEmpty(projectData.municipal_district || projectData.municipalDistrict || projectData.location)},
        ${toNullIfEmpty(projectData.gps_latitude || projectData.gpsLatitude || projectData.latitude)},
        ${toNullIfEmpty(projectData.gps_longitude || projectData.gpsLongitude || projectData.longitude)}
      )
      RETURNING *
    `;
    
    // Log successful project creation
    if (newProject[0]) {
      logCreate('project', newProject[0].id, {
        project_code: newProject[0].project_code,
        project_name: newProject[0].project_name,
        client_id: newProject[0].client_id
      });
    }
    
    return res.status(201).json({ success: true, data: newProject[0] });
  } catch (error) {
    apiLogger.error({ error, method: 'POST', path: '/api/projects' }, 'Failed to create project');
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// PUT /api/projects - Update existing project
async function handlePut(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  const sql = getSql();
  
  if (!id) {
    return res.status(400).json({ error: 'Project ID is required' });
  }
  
  try {
    const updates = req.body;

    // Helper to convert empty strings to null
    const toNullIfEmpty = (val: any) => (val === '' || val === undefined) ? null : val;

    const updatedProject = await sql`
      UPDATE projects
      SET
        project_name = COALESCE(${toNullIfEmpty(updates.name || updates.project_name)}, project_name),
        description = COALESCE(${toNullIfEmpty(updates.description)}, description),
        client_id = COALESCE(${toNullIfEmpty(updates.client_id || updates.clientId)}, client_id),
        project_manager = COALESCE(${toNullIfEmpty(updates.project_manager_id || updates.projectManagerId || updates.project_manager)}, project_manager),
        status = COALESCE(${toNullIfEmpty(updates.status)}, status),
        priority = COALESCE(${toNullIfEmpty(updates.priority)}, priority),
        start_date = COALESCE(${toNullIfEmpty(updates.start_date || updates.startDate)}, start_date),
        end_date = COALESCE(${toNullIfEmpty(updates.end_date || updates.endDate)}, end_date),
        budget = COALESCE(${toNullIfEmpty(updates.budget_allocated || updates.budgetAllocated || updates.budget)}, budget),
        actual_cost = COALESCE(${toNullIfEmpty(updates.budget_spent || updates.budgetSpent || updates.actual_cost)}, actual_cost),
        location = COALESCE(${toNullIfEmpty(updates.municipal_district || updates.municipalDistrict || updates.location)}, location),
        latitude = COALESCE(${toNullIfEmpty(updates.gps_latitude || updates.gpsLatitude || updates.latitude)}, latitude),
        longitude = COALESCE(${toNullIfEmpty(updates.gps_longitude || updates.gpsLongitude || updates.longitude)}, longitude),
        updated_at = NOW()
      WHERE id = ${id as string}
      RETURNING *
    `;
    
    if (updatedProject.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    return res.status(200).json({ success: true, data: updatedProject[0] });
  } catch (error) {
    apiLogger.error({ error, method: 'PUT', path: '/api/projects', projectId: id }, 'Failed to update project');
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// DELETE /api/projects - Delete project
async function handleDelete(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  const sql = getSql();
  
  if (!id) {
    return res.status(400).json({ error: 'Project ID is required' });
  }
  
  try {
    const deleted = await sql`
      DELETE FROM projects
      WHERE id = ${id as string}
      RETURNING id
    `;
    
    if (deleted.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    return res.status(200).json({ success: true, message: 'Project deleted successfully' });
  } catch (error) {
    apiLogger.error({ error, method: 'DELETE', path: '/api/projects', projectId: id }, 'Failed to delete project');
    return res.status(500).json({ error: 'Internal server error' });
  }
}