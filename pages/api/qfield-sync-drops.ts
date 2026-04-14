/**
 * API endpoint for fetching drop data for QField Sync comparison
 * Returns both QFieldCloud and FibreFlow drop data for field verification
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import { getQFieldDrops } from '@/modules/qfield-sync/services/qfieldcloudApiService';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL!);

interface QFieldDropEntry {
  drop_number: string | null;
  pole_number: string | null;
  address: string | null;
  customer_name: string | null;
  cable_length: number | null;
  installation_date: string | null;
  status: string | null;
  qc_status: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  latitude: number | null;
  longitude: number | null;
  created_at: string | null;
  updated_at: string | null;
  qc_updated_at: string | null;
  source: string;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  try {
    const { projectId } = req.query;

    // Fetch FibreFlow drop data from the drops table
    let fibreFlowResult;

    if (projectId) {
      fibreFlowResult = await sql`
        SELECT
          drop_number,
          pole_number,
          address,
          customer_name,
          cable_length,
          installation_date,
          status,
          qc_status,
          notes,
          metadata,
          created_at,
          updated_at,
          qc_updated_at,
          'fibreflow' as source
        FROM drops
        WHERE project_id = ${projectId}
        ORDER BY drop_number
        LIMIT 200
      `;
    } else {
      fibreFlowResult = await sql`
        SELECT
          drop_number,
          pole_number,
          address,
          customer_name,
          cable_length,
          installation_date,
          status,
          qc_status,
          notes,
          metadata,
          created_at,
          updated_at,
          qc_updated_at,
          'fibreflow' as source
        FROM drops
        ORDER BY drop_number
        LIMIT 200
      `;
    }

    // Fetch real QFieldCloud data
    let qfieldData: QFieldDropEntry[] = [];
    try {
      const qfieldDrops = await getQFieldDrops(projectId as string | undefined);
      qfieldData = qfieldDrops.map(drop => ({
        drop_number: drop.drop_number,
        pole_number: drop.pole_number,
        address: drop.address,
        customer_name: drop.customer_name,
        cable_length: drop.cable_length,
        installation_date: drop.installation_date,
        status: drop.status,
        qc_status: drop.qc_status,
        notes: drop.notes,
        metadata: drop.metadata || {},
        latitude: drop.latitude,
        longitude: drop.longitude,
        created_at: drop.created_at,
        updated_at: drop.updated_at,
        qc_updated_at: drop.updated_at, // Use updated_at for QC timestamp
        source: 'qfieldcloud'
      }));
    } catch (error) {
      log.error('Error fetching QFieldCloud drops', { error });
      // If QFieldCloud fails, continue with empty array
      qfieldData = [];
    }

    // Calculate sync statistics
    const synchronizedDrops = fibreFlowResult.filter(ffDrop =>
      qfieldData.some(qfDrop =>
        qfDrop.drop_number === ffDrop.drop_number &&
        qfDrop.status === ffDrop.status &&
        qfDrop.qc_status === ffDrop.qc_status
      )
    );

    const qfieldOnlyDrops = qfieldData.filter(qfDrop =>
      !fibreFlowResult.some(ffDrop => ffDrop.drop_number === qfDrop.drop_number)
    );

    const fibreflowOnlyDrops = fibreFlowResult.filter(ffDrop =>
      !qfieldData.some(qfDrop => qfDrop.drop_number === ffDrop.drop_number)
    );

    const needsSyncDrops = fibreFlowResult.filter(ffDrop =>
      qfieldData.some(qfDrop =>
        qfDrop.drop_number === ffDrop.drop_number &&
        (qfDrop.status !== ffDrop.status ||
         qfDrop.qc_status !== ffDrop.qc_status ||
         qfDrop.cable_length !== ffDrop.cable_length)
      )
    );

    // Count status distribution
    const statusCounts = {
      installed: fibreFlowResult.filter(d => d.status === 'installed' || d.status === 'completed').length,
      planned: fibreFlowResult.filter(d => d.status === 'planned').length,
      in_progress: fibreFlowResult.filter(d => d.status === 'in_progress').length,
      qc_approved: fibreFlowResult.filter(d => d.qc_status === 'approved').length,
      qc_pending: fibreFlowResult.filter(d => d.qc_status === 'pending').length,
      qc_failed: fibreFlowResult.filter(d => d.qc_status === 'failed' || d.qc_status === 'rejected').length
    };

    const response = {
      success: true,
      data: {
        summary: {
          qfieldcloud_total: qfieldData.length,
          fibreflow_total: fibreFlowResult.length,
          synchronized: synchronizedDrops.length,
          needs_sync: needsSyncDrops.length,
          qfieldcloud_only: qfieldOnlyDrops.length,
          fibreflow_only: fibreflowOnlyDrops.length,
          status_counts: statusCounts
        },
        qfieldcloud_drops: qfieldData,
        fibreflow_drops: fibreFlowResult,
        synchronized_drops: synchronizedDrops,
        qfieldcloud_only: qfieldOnlyDrops,
        fibreflow_only: fibreflowOnlyDrops,
        needs_sync: needsSyncDrops
      }
    };

    res.status(200).json(response);
  } catch (error) {
    log.error('Error fetching drop data', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch drop data',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withAuth(handler);