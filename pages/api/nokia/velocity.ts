import { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const { projectId, weekEnding, limit = '1000', offset = '0' } = req.query;

    if (!projectId) {
      return res.status(400).json({
        success: false,
        error: 'Project ID is required'
      });
    }

    try {
      // Get Nokia velocity data with SOW/OneMap linking
      let velocityData;

      if (weekEnding) {
        velocityData = await sql`
          SELECT
            nv.*,
            -- SOW linking
            CASE WHEN sp.pole_number IS NOT NULL THEN true ELSE false END as has_sow_pole,
            CASE WHEN sd.drop_number IS NOT NULL THEN true ELSE false END as has_sow_drop,
            sp.status as sow_pole_status,
            sd.status as sow_drop_status,

            -- OneMap linking
            CASE WHEN op.property_id IS NOT NULL THEN true ELSE false END as has_onemap,
            op.location_address as onemap_address,
            op.contact_name as onemap_contact,

            -- Progress indicators
            CASE
              WHEN nv.installation_date IS NOT NULL THEN 'Completed'
              WHEN nv.ont_barcode IS NOT NULL THEN 'In Progress'
              WHEN nv.pole_permission_date IS NOT NULL THEN 'Permission Granted'
              WHEN nv.status LIKE '%Survey%' THEN 'Surveyed'
              ELSE 'Pending'
            END as progress_status,

            -- Calculate days since last update
            EXTRACT(day FROM CURRENT_DATE - nv.last_modified_date) as days_since_update

          FROM nokia_velocity nv
          LEFT JOIN sow_poles sp
            ON nv.pole_number = sp.pole_number
            AND sp.project_id = nv.project_id
          LEFT JOIN sow_drops sd
            ON nv.drop_number = sd.drop_number
            AND sd.project_id = nv.project_id
          LEFT JOIN onemap_properties op
            ON nv.property_id = op.property_id
          WHERE nv.project_id = ${projectId}
            AND nv.week_ending = ${weekEnding}
          ORDER BY nv.property_id
          LIMIT ${parseInt(limit as string)}
          OFFSET ${parseInt(offset as string)}
        `;
      } else {
        // Get latest week's data
        velocityData = await sql`
          WITH latest_week AS (
            SELECT MAX(week_ending) as max_week
            FROM nokia_velocity
            WHERE project_id = ${projectId}
          )
          SELECT
            nv.*,
            -- SOW linking
            CASE WHEN sp.pole_number IS NOT NULL THEN true ELSE false END as has_sow_pole,
            CASE WHEN sd.drop_number IS NOT NULL THEN true ELSE false END as has_sow_drop,
            sp.status as sow_pole_status,
            sd.status as sow_drop_status,

            -- OneMap linking
            CASE WHEN op.property_id IS NOT NULL THEN true ELSE false END as has_onemap,
            op.location_address as onemap_address,
            op.contact_name as onemap_contact,

            -- Progress indicators
            CASE
              WHEN nv.installation_date IS NOT NULL THEN 'Completed'
              WHEN nv.ont_barcode IS NOT NULL THEN 'In Progress'
              WHEN nv.pole_permission_date IS NOT NULL THEN 'Permission Granted'
              WHEN nv.status LIKE '%Survey%' THEN 'Surveyed'
              ELSE 'Pending'
            END as progress_status,

            -- Calculate days since last update
            EXTRACT(day FROM CURRENT_DATE - nv.last_modified_date) as days_since_update

          FROM nokia_velocity nv
          LEFT JOIN sow_poles sp
            ON nv.pole_number = sp.pole_number
            AND sp.project_id = nv.project_id
          LEFT JOIN sow_drops sd
            ON nv.drop_number = sd.drop_number
            AND sd.project_id = nv.project_id
          LEFT JOIN onemap_properties op
            ON nv.property_id = op.property_id
          WHERE nv.project_id = ${projectId}
            AND nv.week_ending = (SELECT max_week FROM latest_week)
          ORDER BY nv.property_id
          LIMIT ${parseInt(limit as string)}
          OFFSET ${parseInt(offset as string)}
        `;
      }

      // Calculate statistics
      const stats = {
        total: velocityData.length,
        completed: velocityData.filter((r: any) => r.progress_status === 'Completed').length,
        inProgress: velocityData.filter((r: any) => r.progress_status === 'In Progress').length,
        permissionGranted: velocityData.filter((r: any) => r.progress_status === 'Permission Granted').length,
        surveyed: velocityData.filter((r: any) => r.progress_status === 'Surveyed').length,
        pending: velocityData.filter((r: any) => r.progress_status === 'Pending').length,

        // Linking stats
        linkedToSowPoles: velocityData.filter((r: any) => r.has_sow_pole).length,
        linkedToSowDrops: velocityData.filter((r: any) => r.has_sow_drop).length,
        linkedToOneMap: velocityData.filter((r: any) => r.has_onemap).length,

        // Weekly velocity
        weekEnding: velocityData[0]?.week_ending || null
      };

      // Calculate completion percentage
      stats['completionRate'] = stats.total > 0
        ? Math.round((stats.completed / stats.total) * 100)
        : 0;

      return res.status(200).json({
        success: true,
        data: velocityData,
        count: velocityData.length,
        stats
      });

    } catch (error) {
      log.error('Error fetching Nokia velocity data', { error });
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch Nokia velocity data'
      });
    }
  } else if (req.method === 'POST') {
    // Handle velocity data import
    return res.status(200).json({
      success: true,
      message: 'Use import script for bulk imports'
    });
  } else {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }
}

export default withAuth(handler);