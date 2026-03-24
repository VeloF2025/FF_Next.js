/**
 * API Route: /api/projects/[projectId]/pon-stages
 *
 * Returns PON stage tracker data: per-PON build pipeline progress
 * grouped by zone with 6 stages per PON.
 *
 * Method: GET
 * Query: ?zone=N (optional filter)
 *
 * Response: PonStagesResponse
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import type {
  PonStagesResponse,
  PonStageRow,
  PonStageData,
  ZoneStageNode,
  BuildStage,
  OverallStage,
} from '@/types/pon-stages.types';
import { BUILD_STAGES } from '@/types/pon-stages.types';
import { apiResponse } from '@/lib/apiResponse';

interface RawRow {
  zone_no: number;
  pon_no: number;
  permissions_total: string;
  permissions_approved: string;
  permissions_first_date: string | null;
  permissions_last_date: string | null;
  poles_total: string;
  poles_planted: string;
  poles_first_date: string | null;
  poles_last_date: string | null;
  cwc_total: string;
  cwc_complete: string;
  cwc_first_date: string | null;
  cwc_last_date: string | null;
  optical_total: string;
  optical_complete: string;
  optical_first_date: string | null;
  optical_last_date: string | null;
  atp_total: string;
  atp_passed: string;
  atp_first_date: string | null;
  atp_last_date: string | null;
  activation_total: string;
  activation_complete: string;
  activation_first_date: string | null;
  activation_last_date: string | null;
  maintenance_total: string;
  maintenance_complete: string;
  maintenance_first_date: string | null;
  maintenance_last_date: string | null;
  cwc_target_date: string | null;
  optical_target_date: string | null;
  activation_target_date: string | null;
  maintenance_target_date: string | null;
  blockage: string | null;
  overall_stage: string;
  last_synced_at: string;
}

function makeStageData(total: number, complete: number, firstDate: string | null, lastDate: string | null): PonStageData {
  return {
    total,
    complete,
    pct: total > 0 ? Math.round((complete / total) * 10000) / 100 : 0,
    first_date: firstDate,
    last_date: lastDate,
  };
}

function aggregateStages(pons: PonStageRow[]): Record<BuildStage, PonStageData> {
  const result = {} as Record<BuildStage, PonStageData>;
  for (const stage of BUILD_STAGES) {
    let totalSum = 0;
    let completeSum = 0;
    let firstDate: string | null = null;
    let lastDate: string | null = null;

    for (const pon of pons) {
      const data = pon[stage];
      totalSum += data.total;
      completeSum += data.complete;
      if (data.first_date && (!firstDate || data.first_date < firstDate)) firstDate = data.first_date;
      if (data.last_date && (!lastDate || data.last_date > lastDate)) lastDate = data.last_date;
    }

    result[stage] = makeStageData(totalSum, completeSum, firstDate, lastDate);
  }
  return result;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PonStagesResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const { projectId, zone } = req.query;
  const projectIdStr = Array.isArray(projectId) ? projectId[0] : projectId;
  const zoneFilter = zone ? Number(Array.isArray(zone) ? zone[0] : zone) : null;

  if (!projectIdStr) {
    return apiResponse.badRequest(res, 'Missing projectId');
  }

  try {
    const client = await pool.connect();
    try {
      // Get project name
      const projectResult = await client.query<{ project_name: string }>(
        'SELECT project_name FROM projects WHERE id = $1',
        [projectIdStr]
      );

      if (projectResult.rows.length === 0) {
        return apiResponse.notFound(res, 'Project not found');
      }

      const projectName = projectResult.rows[0]!.project_name;

      // Fetch PON stage data
      let query = `
        SELECT zone_no, pon_no,
          permissions_total::text, permissions_approved::text,
          permissions_first_date::text, permissions_last_date::text,
          poles_total::text, poles_planted::text,
          poles_first_date::text, poles_last_date::text,
          cwc_total::text, cwc_complete::text,
          cwc_first_date::text, cwc_last_date::text,
          optical_total::text, optical_complete::text,
          optical_first_date::text, optical_last_date::text,
          atp_total::text, atp_passed::text,
          atp_first_date::text, atp_last_date::text,
          activation_total::text, activation_complete::text,
          activation_first_date::text, activation_last_date::text,
          maintenance_total::text, maintenance_complete::text,
          maintenance_first_date::text, maintenance_last_date::text,
          cwc_target_date::text, optical_target_date::text,
          activation_target_date::text, maintenance_target_date::text,
          blockage,
          overall_stage,
          last_synced_at::text
        FROM pon_stage_tracking
        WHERE project_id = $1
      `;
      const params: (string | number)[] = [projectIdStr];

      if (zoneFilter !== null) {
        query += ' AND zone_no = $2';
        params.push(zoneFilter);
      }

      query += ' ORDER BY zone_no, pon_no';

      const result = await client.query<RawRow>(query, params);

      // Build PON rows
      const flatRows: PonStageRow[] = result.rows.map(row => ({
        zone_no: row.zone_no,
        pon_no: row.pon_no,
        permissions: makeStageData(Number(row.permissions_total), Number(row.permissions_approved), row.permissions_first_date, row.permissions_last_date),
        poles: makeStageData(Number(row.poles_total), Number(row.poles_planted), row.poles_first_date, row.poles_last_date),
        cwc: makeStageData(Number(row.cwc_total), Number(row.cwc_complete), row.cwc_first_date, row.cwc_last_date),
        optical: makeStageData(Number(row.optical_total), Number(row.optical_complete), row.optical_first_date, row.optical_last_date),
        atp: makeStageData(Number(row.atp_total), Number(row.atp_passed), row.atp_first_date, row.atp_last_date),
        activation: makeStageData(Number(row.activation_total), Number(row.activation_complete), row.activation_first_date, row.activation_last_date),
        maintenance: makeStageData(Number(row.maintenance_total), Number(row.maintenance_complete), row.maintenance_first_date, row.maintenance_last_date),
        cwc_target_date: row.cwc_target_date,
        optical_target_date: row.optical_target_date,
        activation_target_date: row.activation_target_date,
        maintenance_target_date: row.maintenance_target_date,
        blockage: row.blockage,
        overall_stage: row.overall_stage as OverallStage,
        last_synced_at: row.last_synced_at,
      }));

      // Build zone hierarchy
      const zoneMap = new Map<number, PonStageRow[]>();
      for (const row of flatRows) {
        const existing = zoneMap.get(row.zone_no);
        if (existing) {
          existing.push(row);
        } else {
          zoneMap.set(row.zone_no, [row]);
        }
      }

      const hierarchy: ZoneStageNode[] = [];
      for (const [zoneNo, pons] of zoneMap) {
        hierarchy.push({
          zone_no: zoneNo,
          zone_name: `Zone ${zoneNo}`,
          pons,
          stages: aggregateStages(pons),
        });
      }
      hierarchy.sort((a, b) => a.zone_no - b.zone_no);

      // Build summary
      const allStages = aggregateStages(flatRows);
      let lastSynced: string | null = null;
      for (const row of flatRows) {
        if (row.last_synced_at && (!lastSynced || row.last_synced_at > lastSynced)) {
          lastSynced = row.last_synced_at;
        }
      }

      const response: PonStagesResponse = {
        project_id: projectIdStr,
        project_name: projectName,
        summary: {
          total_pons: flatRows.length,
          stages: allStages,
          last_synced: lastSynced,
        },
        hierarchy,
        flat: flatRows,
      };

      log.info('PON stages fetched', {
        projectId: projectIdStr,
        totalPons: flatRows.length,
        zones: hierarchy.length,
      }, 'PonStages');

      return res.status(200).json(response);
    } finally {
      client.release();
    }
  } catch (error) {
    log.error('Failed to fetch PON stages', { error, projectId: projectIdStr }, 'PonStages');
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

export default withAuth(handler);
