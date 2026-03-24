/**
 * API endpoint for fetching pole data for QField Sync comparison
 * Returns both QFieldCloud and FibreFlow pole data for field verification
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { neon } from '@neondatabase/serverless';
import { getQFieldPoles } from '@/modules/qfield-sync/services/qfieldcloudApiService';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL!);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  try {
    const { projectId } = req.query;

    // Fetch FibreFlow pole data from the poles table
    let fibreFlowResult;

    if (projectId) {
      fibreFlowResult = await sql`
        SELECT
          pole_number,
          type as pole_type,
          height,
          material,
          status,
          installation_date,
          latitude,
          longitude,
          address,
          notes,
          COALESCE(jsonb_array_length(images), 0) as image_count,
          inspection_data,
          created_at,
          updated_at,
          'fibreflow' as source
        FROM poles
        WHERE project_id = ${projectId}
        ORDER BY pole_number
        LIMIT 200
      `;
    } else {
      fibreFlowResult = await sql`
        SELECT
          pole_number,
          type as pole_type,
          height,
          material,
          status,
          installation_date,
          latitude,
          longitude,
          address,
          notes,
          COALESCE(jsonb_array_length(images), 0) as image_count,
          inspection_data,
          created_at,
          updated_at,
          'fibreflow' as source
        FROM poles
        ORDER BY pole_number
        LIMIT 200
      `;
    }

    // Fetch real QFieldCloud data
    let qfieldData = [];
    try {
      const qfieldPoles = await getQFieldPoles(projectId as string | undefined);
      qfieldData = qfieldPoles.map(pole => ({
        pole_number: pole.pole_number,
        pole_type: pole.pole_type,
        height: pole.height,
        material: pole.material,
        status: pole.status,
        installation_date: pole.installation_date,
        latitude: pole.latitude,
        longitude: pole.longitude,
        address: pole.address,
        notes: pole.notes,
        image_count: pole.image_count || 0,
        created_at: pole.created_at,
        updated_at: pole.updated_at,
        source: 'qfieldcloud'
      }));
    } catch (error) {
      log.error('Error fetching QFieldCloud poles', { error });
      // If QFieldCloud fails, continue with empty array
      qfieldData = [];
    }

    // Calculate sync statistics
    const synchronizedPoles = fibreFlowResult.filter(ffPole =>
      qfieldData.some(qfPole =>
        qfPole.pole_number === ffPole.pole_number &&
        qfPole.status === ffPole.status
      )
    );

    const qfieldOnlyPoles = qfieldData.filter(qfPole =>
      !fibreFlowResult.some(ffPole => ffPole.pole_number === qfPole.pole_number)
    );

    const fibreflowOnlyPoles = fibreFlowResult.filter(ffPole =>
      !qfieldData.some(qfPole => qfPole.pole_number === ffPole.pole_number)
    );

    const needsSyncPoles = fibreFlowResult.filter(ffPole =>
      qfieldData.some(qfPole =>
        qfPole.pole_number === ffPole.pole_number &&
        (qfPole.status !== ffPole.status ||
         Math.abs(parseFloat(qfPole.latitude || 0) - parseFloat(ffPole.latitude || 0)) > 0.00001)
      )
    );

    // Count status distribution
    const statusCounts = {
      installed: fibreFlowResult.filter(p => p.status === 'installed' || p.status === 'completed').length,
      pending: fibreFlowResult.filter(p => p.status === 'pending').length,
      damaged: fibreFlowResult.filter(p => p.status === 'damaged').length,
      verified: qfieldData.filter(p => p.image_count > 0).length
    };

    const response = {
      success: true,
      data: {
        summary: {
          qfieldcloud_total: qfieldData.length,
          fibreflow_total: fibreFlowResult.length,
          synchronized: synchronizedPoles.length,
          needs_sync: needsSyncPoles.length,
          qfieldcloud_only: qfieldOnlyPoles.length,
          fibreflow_only: fibreflowOnlyPoles.length,
          status_counts: statusCounts
        },
        qfieldcloud_poles: qfieldData,
        fibreflow_poles: fibreFlowResult,
        synchronized_poles: synchronizedPoles,
        qfieldcloud_only: qfieldOnlyPoles,
        fibreflow_only: fibreflowOnlyPoles,
        needs_sync: needsSyncPoles
      }
    };

    res.status(200).json(response);
  } catch (error) {
    log.error('Error fetching pole data', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch pole data',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withAuth(handler);