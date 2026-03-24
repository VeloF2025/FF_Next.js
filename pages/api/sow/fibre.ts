import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!userId) {
    return apiResponse.unauthorized(res);
  }

  const { projectId } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.badRequest(res, 'Project ID is required');
  }

  try {
    switch (req.method) {
      case 'GET': {
        // Fetch fibre data from the database
        const fibreData = await sql`
          SELECT * FROM fibre_segments
          WHERE project_id = ${projectId}
          ORDER BY segment_id, zone_no
        `;
        
        return res.status(200).json({
          success: true,
          data: fibreData
        });
      }

      case 'POST': {
        // Handle fibre data upload
        const { data } = req.body;
        
        if (!data || !Array.isArray(data)) {
          return apiResponse.badRequest(res, 'Invalid fibre data');
        }

        // Clear existing data
        await sql`DELETE FROM fibre_segments WHERE project_id = ${projectId}`;

        // Insert new data
        for (const fibre of data) {
          await sql`
            INSERT INTO fibre_segments (
              project_id, from_pole, to_pole, cable_type,
              cable_size, length_m, route_type,
              installation_method, status, raw_data
            ) VALUES (
              ${projectId},
              ${fibre.from_pole},
              ${fibre.to_pole},
              ${fibre.cable_type || null},
              ${fibre.cable_size || null},
              ${fibre.length_m || null},
              ${fibre.route_type || null},
              ${fibre.installation_method || null},
              ${fibre.status || 'planned'},
              ${JSON.stringify(fibre)}
            )
          `;
        }

        return res.status(200).json({
          success: true,
          message: `Uploaded ${data.length} fibre segments`
        });
      }

      default:
        res.setHeader('Allow', ['GET', 'POST']);
        return res.status(405).json({ error: `Method ${req.method} not allowed` });
    }
  } catch (error) {
    log.error('Fibre API error', { error });
    return res.status(500).json({
      error: 'Failed to process fibre data',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withAuth(handler);
