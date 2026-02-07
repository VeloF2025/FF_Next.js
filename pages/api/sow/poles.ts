/**
 * SOW Poles API
 * GET/POST /api/sow/poles
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
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sql = getSql();

  // Handle GET request - fetch poles
  if (req.method === 'GET') {
    try {
      const { projectId, limit = '1000', offset = '0', fields } = req.query;
      const limitNum = Math.min(parseInt(limit as string), 5000); // Cap at 5000 to prevent large responses
      const offsetNum = parseInt(offset as string);

      let query;
      let totalQuery;

      if (projectId) {
        query = await sql`
          SELECT * FROM poles
          WHERE project_id = ${projectId}
          ORDER BY created_at DESC
          LIMIT ${limitNum} OFFSET ${offsetNum}
        `;

        totalQuery = await sql`
          SELECT COUNT(*) as total FROM poles
          WHERE project_id = ${projectId}
        `;
      } else {
        query = await sql`
          SELECT * FROM poles
          ORDER BY created_at DESC
          LIMIT ${limitNum} OFFSET ${offsetNum}
        `;

        totalQuery = await sql`
          SELECT COUNT(*) as total FROM poles
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
      log.error('Error fetching poles', { error });
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch poles'
      });
    }
  }

  // Handle POST request - upload poles
  if (req.method === 'POST') {
    try {
      const { projectId, poles } = req.body;

    if (!projectId || !poles || !Array.isArray(poles)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: projectId or poles array'
      });
    }

    const sql = getSql();

    // Add missing columns to existing poles table (safe - IF NOT EXISTS)
    await sql`ALTER TABLE poles ADD COLUMN IF NOT EXISTS pole_type varchar(100)`;
    await sql`ALTER TABLE poles ADD COLUMN IF NOT EXISTS pole_spec varchar(255)`;
    await sql`ALTER TABLE poles ADD COLUMN IF NOT EXISTS height varchar(50)`;
    await sql`ALTER TABLE poles ADD COLUMN IF NOT EXISTS diameter varchar(50)`;
    await sql`ALTER TABLE poles ADD COLUMN IF NOT EXISTS owner varchar(255)`;
    await sql`ALTER TABLE poles ADD COLUMN IF NOT EXISTS pon_no integer`;
    await sql`ALTER TABLE poles ADD COLUMN IF NOT EXISTS zone_no integer`;
    await sql`ALTER TABLE poles ADD COLUMN IF NOT EXISTS address text`;
    await sql`ALTER TABLE poles ADD COLUMN IF NOT EXISTS municipality varchar(255)`;
    await sql`ALTER TABLE poles ADD COLUMN IF NOT EXISTS project_ref varchar(255)`;
    await sql`ALTER TABLE poles ADD COLUMN IF NOT EXISTS raw_data jsonb`;

    // Note: We don't DELETE here because frontend sends chunks.
    // ON CONFLICT handles updates. To clear first, use clearExisting param.
    const { clearExisting } = req.body;
    if (clearExisting) {
      await sql`DELETE FROM poles WHERE project_id = ${projectId}`;
    }

    // Deduplicate poles by pole_number (keep last occurrence)
    // This handles files where same pole appears multiple times (linked to multiple DRs)
    const poleMap = new Map();
    for (const pole of poles) {
      if (pole.pole_number) {
        poleMap.set(pole.pole_number, pole);
      }
    }
    const uniquePoles = Array.from(poleMap.values());

    // Use UNNEST for efficient bulk insert (single query per batch)
    let totalInserted = 0;
    const batchSize = 1000; // Much larger batches with UNNEST

    for (let i = 0; i < uniquePoles.length; i += batchSize) {
      const batch = uniquePoles.slice(i, i + batchSize);

      // Prepare arrays for UNNEST
      const projectIds = batch.map(() => projectId);
      const poleNumbers = batch.map(p => p.pole_number);
      const latitudes = batch.map(p => p.latitude ? parseFloat(p.latitude) : null);
      const longitudes = batch.map(p => p.longitude ? parseFloat(p.longitude) : null);
      const statuses = batch.map(p => p.status || 'planned');
      const poleTypes = batch.map(p => p.pole_type || null);
      const poleSpecs = batch.map(p => p.pole_spec || null);
      // Parse height/diameter as numbers (extract numeric part from strings like "10m")
      const heights = batch.map(p => {
        if (!p.height) return null;
        const num = parseFloat(String(p.height).replace(/[^\d.]/g, ''));
        return isNaN(num) ? null : num;
      });
      const diameters = batch.map(p => {
        if (!p.diameter) return null;
        const num = parseFloat(String(p.diameter).replace(/[^\d.]/g, ''));
        return isNaN(num) ? null : num;
      });
      const owners = batch.map(p => p.owner || null);
      const ponNos = batch.map(p => p.pon_no ? parseInt(p.pon_no) : null);
      const zoneNos = batch.map(p => p.zone_no ? parseInt(p.zone_no) : null);
      const addresses = batch.map(p => p.address || null);
      const municipalities = batch.map(p => p.municipality || null);
      const projectRefs = batch.map(p => p.project_ref || null);
      const rawDatas = batch.map(p => p.raw_data ? JSON.stringify(p.raw_data) : null);

      await sql`
        INSERT INTO poles (
          project_id, pole_number, latitude, longitude, status,
          pole_type, pole_spec, height, diameter, owner,
          pon_no, zone_no, address, municipality, project_ref, raw_data
        )
        SELECT * FROM UNNEST(
          ${projectIds}::uuid[],
          ${poleNumbers}::varchar[],
          ${latitudes}::numeric[],
          ${longitudes}::numeric[],
          ${statuses}::varchar[],
          ${poleTypes}::varchar[],
          ${poleSpecs}::varchar[],
          ${heights}::numeric[],
          ${diameters}::numeric[],
          ${owners}::varchar[],
          ${ponNos}::integer[],
          ${zoneNos}::integer[],
          ${addresses}::text[],
          ${municipalities}::varchar[],
          ${projectRefs}::varchar[],
          ${rawDatas}::jsonb[]
        )
        ON CONFLICT (project_id, pole_number) DO UPDATE SET
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          status = EXCLUDED.status,
          pole_type = EXCLUDED.pole_type,
          pole_spec = EXCLUDED.pole_spec,
          height = EXCLUDED.height,
          diameter = EXCLUDED.diameter,
          owner = EXCLUDED.owner,
          pon_no = EXCLUDED.pon_no,
          zone_no = EXCLUDED.zone_no,
          address = EXCLUDED.address,
          municipality = EXCLUDED.municipality,
          project_ref = EXCLUDED.project_ref,
          raw_data = EXCLUDED.raw_data,
          updated_at = CURRENT_TIMESTAMP
      `;

      totalInserted += batch.length;
    }

    const duplicatesRemoved = poles.length - uniquePoles.length;
    return res.status(200).json({
      success: true,
      message: `Successfully uploaded ${totalInserted} unique poles${duplicatesRemoved > 0 ? ` (${duplicatesRemoved} duplicates removed)` : ''}`,
      inserted: totalInserted,
      upserted: totalInserted,
      duplicatesRemoved
    });

  } catch (error) {
    log.error('Poles upload error', { error });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload poles data'
    });
    }
  }

  // Method not allowed
  return res.status(405).json({ error: 'Method not allowed' });
}

// Export with Arcjet protection
export default withAuth(withArcjetProtection(handler, aj));
