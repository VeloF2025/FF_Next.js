import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import * as XLSX from 'xlsx';
import { processPoles, processDrops, processFibre } from '../../../src/services/sow/processor/dataProcessors';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

const getSql = () => neon(process.env.DATABASE_URL!);

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }
  if (!userId) {
    return apiResponse.unauthorized(res);
  }

  try {
    const { projectId, dataType, fileData } = req.body;

    if (!projectId || !dataType || !fileData) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required fields: projectId, dataType, or fileData' 
      });
    }

    // Parse Excel data from base64
    const buffer = Buffer.from(fileData, 'base64');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawData = XLSX.utils.sheet_to_json(worksheet);

    if (!rawData || rawData.length === 0) {
      return res.status(400).json({ 
        success: false,
        error: 'No valid data found in file' 
      });
    }

    const sql = getSql();
    let processedData: any[] = [];
    let tableName = '';

    // Process data based on type
    switch (dataType) {
      case 'poles':
        processedData = processPoles(rawData);
        tableName = 'sow_poles';
        break;
      case 'drops':
        processedData = processDrops(rawData);
        tableName = 'sow_drops';
        break;
      case 'fibre':
        processedData = processFibre(rawData);
        tableName = 'sow_fibre';
        break;
      default:
        return res.status(400).json({ 
          success: false,
          error: `Invalid data type: ${dataType}` 
        });
    }

    if (processedData.length === 0) {
      return res.status(400).json({ 
        success: false,
        error: 'No valid data found after processing. Please check the file format.' 
      });
    }

    // Insert data into database
    log.info('api/sow/import', {
      action: 'insertData',
      recordCount: processedData.length,
      dataType,
      projectId
    });

    // Create tables if they don't exist
    if (dataType === 'fibre') {
      await sql`
        CREATE TABLE IF NOT EXISTS sow_fibre (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          project_id UUID,
          segment_id VARCHAR(255),
          cable_size VARCHAR(50),
          layer VARCHAR(50),
          length FLOAT,
          pon_no INTEGER,
          zone_no INTEGER,
          string_completed FLOAT,
          date_completed TIMESTAMP,
          contractor VARCHAR(100),
          is_complete BOOLEAN,
          raw_data JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `;
    }

    // Clear existing data for this project
    if (dataType === 'poles') {
      await sql`DELETE FROM sow_poles WHERE project_id = ${projectId}`;
    } else if (dataType === 'drops') {
      await sql`DELETE FROM sow_drops WHERE project_id = ${projectId}`;
    } else if (dataType === 'fibre') {
      await sql`DELETE FROM sow_fibre WHERE project_id = ${projectId}`;
    }

    // Batch insert new data
    const values = processedData.map((item: any) => ({
      ...item,
      project_id: projectId,
      created_at: new Date(),
      updated_at: new Date()
    }));

    // Insert in batches of 100
    const batchSize = 100;
    let inserted = 0;

    for (let i = 0; i < values.length; i += batchSize) {
      const batch = values.slice(i, i + batchSize);

      // Build insert for each data type
      for (const record of batch) {
        if (dataType === 'poles') {
          await sql`
            INSERT INTO sow_poles (project_id, pole_number, latitude, longitude, status, created_at, updated_at)
            VALUES (${record.project_id}, ${record.pole_number}, ${record.latitude}, ${record.longitude}, ${record.status}, ${record.created_at}, ${record.updated_at})
          `;
        } else if (dataType === 'drops') {
          await sql`
            INSERT INTO sow_drops (project_id, drop_id, pole_number, address, status, created_at, updated_at)
            VALUES (${record.project_id}, ${record.drop_id}, ${record.pole_number}, ${record.address}, ${record.status}, ${record.created_at}, ${record.updated_at})
          `;
        } else if (dataType === 'fibre') {
          await sql`
            INSERT INTO sow_fibre (
              project_id, segment_id, cable_size, layer, length,
              pon_no, zone_no, contractor, is_complete, created_at, updated_at
            )
            VALUES (
              ${record.project_id}, ${record.segment_id}, ${record.cable_size},
              ${record.layer}, ${record.length}, ${record.pon_no}, ${record.zone_no},
              ${record.contractor}, ${record.is_complete}, ${record.created_at}, ${record.updated_at}
            )
          `;
        }
        inserted++;
      }
    }

    return res.status(200).json({
      success: true,
      message: `Successfully imported ${inserted} ${dataType} records`,
      count: inserted,
      dataType,
      projectId
    });

  } catch (error) {
    log.error('api/sow/import', {
      action: 'importError',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to import SOW data'
    });
  }
}

export default withAuth(handler);
