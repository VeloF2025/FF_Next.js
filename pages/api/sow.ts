import { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { getAuth } from '../../lib/auth-mock';
import { neon } from '@neondatabase/serverless';

// Initialize database connection
const sql = neon(process.env.DATABASE_URL!);

// Type definitions for SOW import data
interface SOWData {
  type: 'poles' | 'drops' | 'fibre';
  projectId: number;
  fileName: string;
  data: Array<Record<string, any>>;
}

interface ProcessedSOWResult {
  success: boolean;
  processedCount: number;
  totalCount: number;
  errors?: string[];
}

// Main API handler for SOW imports
async function handler(req: NextApiRequest, res: NextApiResponse) {
  // For testing: use mock user ID
  // TODO: Re-enable Clerk authentication
  const userId = 'test-user-123';
  
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  switch (req.method) {
    case 'GET':
      return handleGet(req, res, userId);
    case 'POST':
      return handlePost(req, res, userId);
    default:
      res.setHeader('Allow', ['GET', 'POST']);
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}

// GET /api/sow - Get SOW import history
async function handleGet(req: NextApiRequest, res: NextApiResponse, userId: string) {
  const { projectId, limit = 20 } = req.query;
  
  try {
    let sowImports;
    
    if (projectId) {
      sowImports = await sql`
        SELECT * FROM sow_imports 
        WHERE project_id = ${Number(projectId)}
        ORDER BY imported_at DESC
        LIMIT ${Number(limit)}
      `;
    } else {
      sowImports = await sql`
        SELECT * FROM sow_imports
        ORDER BY imported_at DESC
        LIMIT ${Number(limit)}
      `;
    }
    
    return res.status(200).json(sowImports);
  } catch (error) {
    console.error('Error in GET /api/sow:', error);
    return res.status(500).json({ error: 'Failed to fetch SOW imports' });
  }
}

// POST /api/sow - Import SOW data
async function handlePost(req: NextApiRequest, res: NextApiResponse, userId: string) {
  try {
    const { type, projectId, fileName, data }: SOWData = req.body;
    
    // Validate input
    if (!type || !['poles', 'drops', 'fibre'].includes(type)) {
      return res.status(400).json({ error: 'Invalid SOW type. Must be poles, drops, or fibre' });
    }
    
    if (!projectId || !Number.isInteger(projectId)) {
      return res.status(400).json({ error: 'Valid project ID is required' });
    }
    
    if (!data || !Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ error: 'Data array is required and cannot be empty' });
    }
    
    // Verify project exists
    const projectResult = await sql`
      SELECT * FROM projects WHERE id = ${projectId} LIMIT 1
    `;
    
    if (!projectResult[0]) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Process SOW data
    const processedResult = await processSOWData(type, data);
    
    // Create SOW import record
    const sowImportResult = await sql`
      INSERT INTO sow_imports (
        project_id, file_name, import_type, status, data, 
        processed_records, total_records, errors, imported_at, imported_by
      )
      VALUES (
        ${projectId},
        ${fileName || `${type}_import_${Date.now()}`},
        ${type},
        ${processedResult.success ? 'completed' : 'failed'},
        ${JSON.stringify(data)},
        ${processedResult.processedCount},
        ${processedResult.totalCount},
        ${processedResult.errors ? JSON.stringify({ errors: processedResult.errors }) : null},
        ${new Date().toISOString()},
        ${userId}
      )
      RETURNING *
    `;
    
    // Update project with SOW data reference
    if (processedResult.success) {
      const currentSowData = projectResult[0].sow_data || {};
      const newSowData = {
        ...currentSowData,
        [type]: {
          importId: sowImportResult[0].id,
          recordCount: processedResult.processedCount,
          lastImported: new Date().toISOString(),
        }
      };
      
      await sql`
        UPDATE projects 
        SET sow_data = ${JSON.stringify(newSowData)}, updated_at = ${new Date().toISOString()}
        WHERE id = ${projectId}
      `;
    }
    
    return res.status(201).json({
      message: `SOW ${type} data imported successfully`,
      import: sowImportResult[0],
      processed: processedResult.processedCount,
      total: processedResult.totalCount,
      errors: processedResult.errors,
    });
  } catch (error) {
    console.error('Error in POST /api/sow:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /api/sow/status - Get import status
async function handleGetStatus(req: NextApiRequest, res: NextApiResponse, userId: string) {
  const { id } = req.query;
  
  if (!id) {
    return res.status(400).json({ error: 'Import ID is required' });
  }
  
  try {
    const sowImport = await sql`
      SELECT * FROM sow_imports 
      WHERE id = ${Number(id)}
      LIMIT 1
    `;
    
    if (!sowImport[0]) {
      return res.status(404).json({ error: 'Import not found' });
    }
    
    return res.status(200).json(sowImport[0]);
  } catch (error) {
    console.error('Error in GET /api/sow/status:', error);
    return res.status(500).json({ error: 'Failed to fetch import status' });
  }
}

// Process and validate SOW data based on type
async function processSOWData(type: string, data: Array<Record<string, any>>): Promise<ProcessedSOWResult> {
  const errors: string[] = [];
  let processedCount = 0;
  const totalCount = data.length;
  
  // Define required fields for each SOW type
  const requiredFields: Record<string, string[]> = {
    poles: ['poleId', 'latitude', 'longitude', 'status'],
    drops: ['dropId', 'address', 'status', 'poleId'],
    fibre: ['fibreId', 'fromPole', 'toPole', 'length', 'status'],
  };
  
  const required = requiredFields[type] || [];
  
  // Validate and process each record
  for (let i = 0; i < data.length; i++) {
    const record = data[i];
    const recordErrors: string[] = [];
    
    // Check required fields
    for (const field of required) {
      if (!record[field]) {
        recordErrors.push(`Row ${i + 1}: Missing required field '${field}'`);
      }
    }
    
    // Type-specific validation
    if (type === 'poles') {
      if (record.latitude && (isNaN(record.latitude) || Math.abs(record.latitude) > 90)) {
        recordErrors.push(`Row ${i + 1}: Invalid latitude value`);
      }
      if (record.longitude && (isNaN(record.longitude) || Math.abs(record.longitude) > 180)) {
        recordErrors.push(`Row ${i + 1}: Invalid longitude value`);
      }
    } else if (type === 'fibre') {
      if (record.length && (isNaN(record.length) || record.length < 0)) {
        recordErrors.push(`Row ${i + 1}: Invalid fibre length`);
      }
    }
    
    if (recordErrors.length === 0) {
      processedCount++;
    } else {
      errors.push(...recordErrors);
    }
  }
  
  return {
    success: errors.length === 0,
    processedCount,
    totalCount,
    errors: errors.length > 0 ? errors.slice(0, 10) : undefined, // Limit errors to first 10
  };
}

export default withAuth(handler);