/**
 * SOW Drops API
 * GET/POST /api/sow/drops
 *
 * Protected by Arcjet:
 * - Bot detection
 * - Rate limiting (100 req/min)
 * - Attack protection
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withArcjetProtection, aj } from '@/lib/arcjet';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

const getSql = () => neon(process.env.DATABASE_URL!);

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
    responseLimit: false, // Disable Next.js response size limit for this endpoint
  },
};

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const userId = (req as AuthenticatedNextApiRequest).user?.id;
  if (!userId) {
    return apiResponse.unauthorized(res);
  }

  const sql = getSql();

  // Handle GET request - fetch drops
  if (req.method === 'GET') {
    try {
      const { projectId, limit = '1000', offset = '0', fields } = req.query;
      const limitNum = Math.min(parseInt(limit as string), 5000); // Cap at 5000 to prevent large responses
      const offsetNum = parseInt(offset as string);

      let query;
      let totalQuery;

      if (projectId) {
        query = await sql`
          SELECT * FROM drops
          WHERE project_id = ${projectId}
          ORDER BY created_at DESC
          LIMIT ${limitNum} OFFSET ${offsetNum}
        `;

        totalQuery = await sql`
          SELECT COUNT(*) as total FROM drops
          WHERE project_id = ${projectId}
        `;
      } else {
        query = await sql`
          SELECT * FROM drops
          ORDER BY created_at DESC
          LIMIT ${limitNum} OFFSET ${offsetNum}
        `;

        totalQuery = await sql`
          SELECT COUNT(*) as total FROM drops
        `;
      }

      const total = parseInt(totalQuery[0]?.total || '0');

      // Apply field filtering if specified (client-side filtering)
      let filteredData = query;
      if (fields) {
        const requestedFields = (fields as string).split(',').map(f => f.trim());
        filteredData = query.map(item => {
          const filtered: any = {};
          requestedFields.forEach(field => {
            if (field in item) {
              filtered[field] = item[field];
            }
          });
          return filtered;
        });
      }

      return res.status(200).json({
        success: true,
        data: filteredData,
        count: filteredData.length,
        total,
        page: Math.floor(offsetNum / limitNum) + 1,
        pageSize: limitNum,
        totalPages: Math.ceil(total / limitNum)
      });
    } catch (error) {
      log.error('Error fetching drops', { error });
      return res.status(500).json({ 
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch drops' 
      });
    }
  }

  // Handle POST request - upload drops
  if (req.method === 'POST') {
    try {
      const { projectId, drops } = req.body;

    if (!projectId || !drops || !Array.isArray(drops)) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required fields: projectId or drops array' 
      });
    }

    const sql = getSql();

    // Add missing columns to existing drops table (safe - IF NOT EXISTS)
    await sql`ALTER TABLE drops ADD COLUMN IF NOT EXISTS pole_number varchar(255)`;
    await sql`ALTER TABLE drops ADD COLUMN IF NOT EXISTS cable_spec varchar(255)`;
    await sql`ALTER TABLE drops ADD COLUMN IF NOT EXISTS cable_length varchar(50)`;
    await sql`ALTER TABLE drops ADD COLUMN IF NOT EXISTS cable_capacity varchar(50)`;
    await sql`ALTER TABLE drops ADD COLUMN IF NOT EXISTS start_point varchar(255)`;
    await sql`ALTER TABLE drops ADD COLUMN IF NOT EXISTS end_point varchar(255)`;
    await sql`ALTER TABLE drops ADD COLUMN IF NOT EXISTS latitude numeric`;
    await sql`ALTER TABLE drops ADD COLUMN IF NOT EXISTS longitude numeric`;
    await sql`ALTER TABLE drops ADD COLUMN IF NOT EXISTS address text`;
    await sql`ALTER TABLE drops ADD COLUMN IF NOT EXISTS pon_no integer`;
    await sql`ALTER TABLE drops ADD COLUMN IF NOT EXISTS zone_no integer`;
    await sql`ALTER TABLE drops ADD COLUMN IF NOT EXISTS municipality varchar(255)`;
    await sql`ALTER TABLE drops ADD COLUMN IF NOT EXISTS raw_data jsonb`;

    // Note: We don't DELETE here because frontend sends chunks.
    // ON CONFLICT handles updates. To clear first, use clearExisting param.
    const { clearExisting } = req.body;
    if (clearExisting) {
      await sql`DELETE FROM drops WHERE project_id = ${projectId}`;
    }

    // Use UNNEST for efficient bulk insert (single query per batch)
    let totalInserted = 0;
    const batchSize = 1000; // Much larger batches with UNNEST

    for (let i = 0; i < drops.length; i += batchSize) {
      const batch = drops.slice(i, i + batchSize);

      // Prepare arrays for UNNEST
      const projectIds = batch.map(() => projectId);
      const dropNumbers = batch.map(d => d.drop_number);
      const poleNumbers = batch.map(d => d.pole_number || null);
      const cableTypes = batch.map(d => d.cable_type || null);
      const cableSpecs = batch.map(d => d.cable_spec || null);
      const cableLengths = batch.map(d => d.cable_length || null);
      const cableCapacities = batch.map(d => d.cable_capacity || null);
      const startPoints = batch.map(d => d.start_point || null);
      const endPoints = batch.map(d => d.end_point || null);
      const latitudes = batch.map(d => d.latitude ? parseFloat(d.latitude) : null);
      const longitudes = batch.map(d => d.longitude ? parseFloat(d.longitude) : null);
      const addresses = batch.map(d => d.address || null);
      const ponNos = batch.map(d => d.pon_no ? parseInt(d.pon_no) : null);
      const zoneNos = batch.map(d => d.zone_no ? parseInt(d.zone_no) : null);
      const municipalities = batch.map(d => d.municipality || null);
      const rawDatas = batch.map(d => d.raw_data ? JSON.stringify(d.raw_data) : null);

      await sql`
        INSERT INTO drops (
          project_id, drop_number, pole_number, cable_type, cable_spec,
          cable_length, cable_capacity, start_point, end_point,
          latitude, longitude, address, pon_no, zone_no, municipality, raw_data
        )
        SELECT * FROM UNNEST(
          ${projectIds}::uuid[],
          ${dropNumbers}::varchar[],
          ${poleNumbers}::varchar[],
          ${cableTypes}::varchar[],
          ${cableSpecs}::varchar[],
          ${cableLengths}::varchar[],
          ${cableCapacities}::varchar[],
          ${startPoints}::varchar[],
          ${endPoints}::varchar[],
          ${latitudes}::numeric[],
          ${longitudes}::numeric[],
          ${addresses}::text[],
          ${ponNos}::integer[],
          ${zoneNos}::integer[],
          ${municipalities}::varchar[],
          ${rawDatas}::jsonb[]
        )
        ON CONFLICT (project_id, drop_number) DO UPDATE SET
          pole_number = EXCLUDED.pole_number,
          cable_type = EXCLUDED.cable_type,
          cable_spec = EXCLUDED.cable_spec,
          cable_length = EXCLUDED.cable_length,
          cable_capacity = EXCLUDED.cable_capacity,
          start_point = EXCLUDED.start_point,
          end_point = EXCLUDED.end_point,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          address = EXCLUDED.address,
          pon_no = EXCLUDED.pon_no,
          zone_no = EXCLUDED.zone_no,
          municipality = EXCLUDED.municipality,
          raw_data = EXCLUDED.raw_data,
          updated_at = CURRENT_TIMESTAMP
      `;

      totalInserted += batch.length;
    }

    return res.status(200).json({
      success: true,
      message: `Successfully uploaded ${totalInserted} drops`,
      inserted: totalInserted,
      upserted: totalInserted
    });

  } catch (error) {
    log.error('Drops upload error', { error });
    return res.status(500).json({ 
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload drops data' 
    });
    }
  }

  // Method not allowed
  return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
}

// Export with Arcjet protection
export default withAuth(withArcjetProtection(handler, aj));