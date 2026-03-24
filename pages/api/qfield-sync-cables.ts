/**
 * API endpoint for fetching fiber cable data for QField Sync comparison
 * Returns both QFieldCloud and FibreFlow cable data for comparison
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import { getQFieldCables } from '@/modules/qfield-sync/services/qfieldcloudApiService';
import { log } from '@/lib/logger';
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

    // Fetch FibreFlow fiber cable data from the fibre_segments table
    let fibreFlowResult;

    if (projectId) {
      // Use template literal syntax for Neon serverless client with parameter
      fibreFlowResult = await sql`
        SELECT
          segment_id as cable_id,
          cable_type,
          cable_size,
          from_point as from_chamber,
          to_point as to_chamber,
          distance as length_m,
          installation_date,
          status as installation_status,
          contractor,
          created_at,
          updated_at,
          'fibreflow' as source
        FROM fibre_segments
        WHERE project_id = ${projectId}
        ORDER BY segment_id
        LIMIT 100
      `;
    } else {
      // Query without project filter
      fibreFlowResult = await sql`
        SELECT
          segment_id as cable_id,
          cable_type,
          cable_size,
          from_point as from_chamber,
          to_point as to_chamber,
          distance as length_m,
          installation_date,
          status as installation_status,
          contractor,
          created_at,
          updated_at,
          'fibreflow' as source
        FROM fibre_segments
        ORDER BY segment_id
        LIMIT 100
      `;
    }

    // Fetch real QFieldCloud data
    let qfieldData = [];
    try {
      const qfieldCables = await getQFieldCables(projectId as string | undefined);
      qfieldData = qfieldCables.map(cable => ({
        cable_id: cable.cable_id,
        cable_type: cable.cable_type,
        cable_size: cable.cable_size,
        from_chamber: cable.from_chamber,
        to_chamber: cable.to_chamber,
        length_m: cable.length_m,
        installation_date: cable.installation_date,
        installation_status: cable.installation_status,
        contractor: cable.contractor,
        route_geometry: cable.route_geometry,
        created_at: cable.created_at,
        updated_at: cable.updated_at,
        source: 'qfieldcloud'
      }));
    } catch (error) {
      log.error('Error fetching QFieldCloud cables', { error });
      // If QFieldCloud fails, continue with empty array
      qfieldData = [];
    }

    // Identify synchronized cables (exist in both with same updated_at)
    const synchronizedCables = fibreFlowResult.filter(ffCable =>
      qfieldData.some(qfCable =>
        qfCable.cable_id === ffCable.cable_id &&
        qfCable.updated_at === ffCable.updated_at
      )
    );

    // Identify cables only in QFieldCloud
    const qfieldOnlyCables = qfieldData.filter(qfCable =>
      !fibreFlowResult.some(ffCable => ffCable.cable_id === qfCable.cable_id)
    );

    // Identify cables only in FibreFlow
    const fibreflowOnlyCables = fibreFlowResult.filter(ffCable =>
      !qfieldData.some(qfCable => qfCable.cable_id === ffCable.cable_id)
    );

    // Identify cables that need sync (exist in both but different updated_at)
    const needSyncCables = fibreFlowResult.filter(ffCable =>
      qfieldData.some(qfCable =>
        qfCable.cable_id === ffCable.cable_id &&
        qfCable.updated_at !== ffCable.updated_at
      )
    );

    const response = {
      success: true,
      data: {
        summary: {
          qfieldcloud_total: qfieldData.length,
          fibreflow_total: fibreFlowResult.length,
          synchronized: synchronizedCables.length,
          needs_sync: needSyncCables.length,
          qfieldcloud_only: qfieldOnlyCables.length,
          fibreflow_only: fibreflowOnlyCables.length
        },
        qfieldcloud_cables: qfieldData,
        fibreflow_cables: fibreFlowResult,
        synchronized_cables: synchronizedCables,
        qfieldcloud_only: qfieldOnlyCables,
        fibreflow_only: fibreflowOnlyCables,
        needs_sync: needSyncCables
      }
    };

    res.status(200).json(response);
  } catch (error) {
    log.error('Error fetching cable data', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch cable data',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withAuth(handler);