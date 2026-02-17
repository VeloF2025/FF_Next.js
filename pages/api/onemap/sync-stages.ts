/**
 * API Route: /api/onemap/sync-stages
 *
 * Syncs build stage data from 1Map into pon_stage_tracking table.
 * Runs as cron every 6 hours or on-demand.
 *
 * Method: POST
 * Body: { site: 'MAM' | 'LAW' | 'MOH', force?: boolean }
 *
 * Response: StageSyncResult with counts of records processed and stages updated.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { createOneMapClient, SITE_PROJECT_MAP } from '@/services/onemap/oneMapClient';
import type { ParsedStageRecord } from '@/services/onemap/oneMapClient';
import type { BuildStage, StageSyncResult } from '@/types/pon-stages.types';

interface PonAggregation {
  zone_no: number;
  pon_no: number;
  permissions: { total: number; complete: number; firstDate: string | null; lastDate: string | null };
  poles: { total: number; complete: number; firstDate: string | null; lastDate: string | null };
  cwc: { total: number; complete: number; firstDate: string | null; lastDate: string | null };
  optical: { total: number; complete: number; firstDate: string | null; lastDate: string | null };
  atp: { total: number; complete: number; firstDate: string | null; lastDate: string | null };
  activation: { total: number; complete: number; firstDate: string | null; lastDate: string | null };
}

function updateDateRange(
  current: { firstDate: string | null; lastDate: string | null },
  newDate: string | null
): void {
  if (!newDate) return;
  if (!current.firstDate || newDate < current.firstDate) current.firstDate = newDate;
  if (!current.lastDate || newDate > current.lastDate) current.lastDate = newDate;
}

function computeOverallStage(agg: PonAggregation): string {
  const stages: Array<{ key: BuildStage; total: number; complete: number }> = [
    { key: 'activation', total: agg.activation.total, complete: agg.activation.complete },
    { key: 'atp', total: agg.atp.total, complete: agg.atp.complete },
    { key: 'optical', total: agg.optical.total, complete: agg.optical.complete },
    { key: 'cwc', total: agg.cwc.total, complete: agg.cwc.complete },
    { key: 'poles', total: agg.poles.total, complete: agg.poles.complete },
    { key: 'permissions', total: agg.permissions.total, complete: agg.permissions.complete },
  ];

  // Check if all stages are 100%
  const allComplete = stages.every(s => s.total > 0 && s.complete >= s.total);
  if (allComplete) return 'complete';

  // Find the latest stage that is 100% complete
  for (const s of stages) {
    if (s.total > 0 && s.complete >= s.total) {
      return s.key;
    }
  }

  // Check if any stage has started
  const anyStarted = stages.some(s => s.complete > 0);
  if (anyStarted) {
    // Return the earliest stage that has any progress
    const ordered = [...stages].reverse();
    for (const s of ordered) {
      if (s.complete > 0 && s.complete < s.total) return s.key;
    }
  }

  return 'not_started';
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const startTime = Date.now();
  const { site } = req.body as { site?: string };

  if (!site || !SITE_PROJECT_MAP[site]) {
    return res.status(400).json({
      error: `Invalid site. Must be one of: ${Object.keys(SITE_PROJECT_MAP).join(', ')}`,
    });
  }

  const projectMapping = SITE_PROJECT_MAP[site];
  const projectId = projectMapping.uuid;

  log.info(`Starting stage sync for ${site}`, { site, projectId }, 'SyncStages');

  const errors: string[] = [];
  const stagesUpdated: Record<BuildStage, number> = {
    permissions: 0, poles: 0, cwc: 0, optical: 0, atp: 0, activation: 0,
  };

  try {
    // Step 1: Fetch all records from 1Map
    const client = createOneMapClient();
    await client.authenticate();

    const parsedRecords = await client.getAllInstallationsWithStages(site, {
      onProgress: (page, totalPages, count) => {
        log.info(`Fetching page ${page}/${totalPages}`, { count }, 'SyncStages');
      },
    });

    log.info(`Fetched ${parsedRecords.length} records from 1Map`, { site }, 'SyncStages');

    // Step 2: Look up zone_no and pon_no from drops table for each DR
    const dbClient = await pool.connect();
    try {
      // Build DR → (zone_no, pon_no) lookup from drops table
      const drLookupResult = await dbClient.query<{
        drop_number: string;
        zone_no: number | null;
        pon_no: number | null;
      }>(
        `SELECT DISTINCT drop_number, zone_no, pon_no
         FROM drops
         WHERE project_id = $1
           AND zone_no IS NOT NULL
           AND pon_no IS NOT NULL`,
        [projectId]
      );

      const drLookup = new Map<string, { zone_no: number; pon_no: number }>();
      for (const row of drLookupResult.rows) {
        if (row.zone_no !== null && row.pon_no !== null) {
          drLookup.set(row.drop_number, {
            zone_no: row.zone_no,
            pon_no: row.pon_no,
          });
        }
      }

      log.info(`DR lookup loaded: ${drLookup.size} DRs with zone/pon`, { site }, 'SyncStages');

      // Step 3: Get total drops per (zone_no, pon_no) — universal denominator for all stages
      const dropsTotalResult = await dbClient.query<{
        zone_no: number;
        pon_no: number;
        total: number;
      }>(
        `SELECT zone_no, pon_no, COUNT(DISTINCT drop_number)::int as total
         FROM drops
         WHERE project_id = $1 AND zone_no IS NOT NULL AND pon_no IS NOT NULL
         GROUP BY zone_no, pon_no`,
        [projectId]
      );

      const ponMap = new Map<string, PonAggregation>();
      for (const row of dropsTotalResult.rows) {
        const key = `${row.zone_no}-${row.pon_no}`;
        const total = Number(row.total);
        ponMap.set(key, {
          zone_no: row.zone_no,
          pon_no: row.pon_no,
          permissions: { total, complete: 0, firstDate: null, lastDate: null },
          poles: { total, complete: 0, firstDate: null, lastDate: null },
          cwc: { total, complete: 0, firstDate: null, lastDate: null },
          optical: { total, complete: 0, firstDate: null, lastDate: null },
          atp: { total, complete: 0, firstDate: null, lastDate: null },
          activation: { total, complete: 0, firstDate: null, lastDate: null },
        });
      }

      log.info(`Loaded ${ponMap.size} PONs with drops totals`, { site }, 'SyncStages');

      // Step 4: Count completions from 1Map (deduplicate by DR — 1Map can have multiple records per DR)
      let unmappedCount = 0;
      const counted = new Map<string, Record<string, Set<string>>>();

      for (const record of parsedRecords) {
        const lookup = drLookup.get(record.dr_number);
        const zoneNo = lookup?.zone_no ?? record.zone_no;
        const ponNo = lookup?.pon_no;

        if (zoneNo === null || zoneNo === undefined || ponNo === null || ponNo === undefined) {
          unmappedCount++;
          continue;
        }

        const key = `${zoneNo}-${ponNo}`;
        const agg = ponMap.get(key);
        if (!agg) continue;

        if (!counted.has(key)) {
          counted.set(key, {
            permissions: new Set(), poles: new Set(), cwc: new Set(),
            optical: new Set(), atp: new Set(), activation: new Set(),
          });
        }
        const sets = counted.get(key)!;
        const dr = record.dr_number;

        if (record.stages.permissions_complete && dr && !sets.permissions.has(dr)) {
          sets.permissions.add(dr);
          agg.permissions.complete++;
          stagesUpdated.permissions++;
          updateDateRange(agg.permissions, record.stages.permissions_date);
        }

        if (record.stages.poles_complete && dr && !sets.poles.has(dr)) {
          sets.poles.add(dr);
          agg.poles.complete++;
          stagesUpdated.poles++;
          updateDateRange(agg.poles, record.stages.poles_date);
        }

        if (record.stages.cwc_complete && dr && !sets.cwc.has(dr)) {
          sets.cwc.add(dr);
          agg.cwc.complete++;
          stagesUpdated.cwc++;
          updateDateRange(agg.cwc, record.stages.cwc_date);
        }

        if (record.stages.optical_complete && dr && !sets.optical.has(dr)) {
          sets.optical.add(dr);
          agg.optical.complete++;
          stagesUpdated.optical++;
          updateDateRange(agg.optical, record.stages.optical_date);
        }

        if (record.stages.atp_complete && dr && !sets.atp.has(dr)) {
          sets.atp.add(dr);
          agg.atp.complete++;
          stagesUpdated.atp++;
          updateDateRange(agg.atp, record.stages.atp_date);
        }

        if (record.stages.activation_complete && dr && !sets.activation.has(dr)) {
          sets.activation.add(dr);
          agg.activation.complete++;
          stagesUpdated.activation++;
          updateDateRange(agg.activation, record.stages.activation_date);
        }
      }

      if (unmappedCount > 0) {
        log.warn(`${unmappedCount} records skipped (no zone/pon mapping)`, { site }, 'SyncStages');
        errors.push(`${unmappedCount} records could not be mapped to zone/pon`);
      }

      // Step 5: Merge OES activation data (complete count + dates only — total already set)
      const oesResult = await dbClient.query<{
        zone_no: number;
        pon_no: number;
        activated: string;
        first_date: string | null;
        last_date: string | null;
      }>(
        `SELECT
           d.zone_no, d.pon_no,
           COUNT(DISTINCT CASE WHEN oes.activation_date IS NOT NULL THEN d.drop_number END)::text as activated,
           MIN(oes.activation_date)::text as first_date,
           MAX(oes.activation_date)::text as last_date
         FROM drops d
         LEFT JOIN oes_activations oes ON oes.drop_number = d.drop_number
         WHERE d.project_id = $1
           AND d.zone_no IS NOT NULL
           AND d.pon_no IS NOT NULL
         GROUP BY d.zone_no, d.pon_no`,
        [projectId]
      );

      for (const row of oesResult.rows) {
        const key = `${row.zone_no}-${row.pon_no}`;
        const agg = ponMap.get(key);
        if (!agg) continue;

        const activated = Number(row.activated);
        if (activated > 0) {
          agg.activation.complete = activated;
          agg.activation.firstDate = row.first_date;
          agg.activation.lastDate = row.last_date;
        }
      }

      // Step 5: UPSERT into pon_stage_tracking
      let upsertCount = 0;
      for (const agg of ponMap.values()) {
        const overallStage = computeOverallStage(agg);

        await dbClient.query(
          `INSERT INTO pon_stage_tracking (
            project_id, zone_no, pon_no,
            permissions_total, permissions_approved, permissions_first_date, permissions_last_date,
            poles_total, poles_planted, poles_first_date, poles_last_date,
            cwc_total, cwc_complete, cwc_first_date, cwc_last_date,
            optical_total, optical_complete, optical_first_date, optical_last_date,
            atp_total, atp_passed, atp_first_date, atp_last_date,
            activation_total, activation_complete, activation_first_date, activation_last_date,
            overall_stage, last_synced_at, sync_source
          ) VALUES (
            $1, $2, $3,
            $4, $5, $6, $7,
            $8, $9, $10, $11,
            $12, $13, $14, $15,
            $16, $17, $18, $19,
            $20, $21, $22, $23,
            $24, $25, $26, $27,
            $28, NOW(), '1map'
          )
          ON CONFLICT (project_id, zone_no, pon_no) DO UPDATE SET
            permissions_total = EXCLUDED.permissions_total,
            permissions_approved = EXCLUDED.permissions_approved,
            permissions_first_date = EXCLUDED.permissions_first_date,
            permissions_last_date = EXCLUDED.permissions_last_date,
            poles_total = EXCLUDED.poles_total,
            poles_planted = EXCLUDED.poles_planted,
            poles_first_date = EXCLUDED.poles_first_date,
            poles_last_date = EXCLUDED.poles_last_date,
            cwc_total = EXCLUDED.cwc_total,
            cwc_complete = EXCLUDED.cwc_complete,
            cwc_first_date = EXCLUDED.cwc_first_date,
            cwc_last_date = EXCLUDED.cwc_last_date,
            optical_total = EXCLUDED.optical_total,
            optical_complete = EXCLUDED.optical_complete,
            optical_first_date = EXCLUDED.optical_first_date,
            optical_last_date = EXCLUDED.optical_last_date,
            atp_total = EXCLUDED.atp_total,
            atp_passed = EXCLUDED.atp_passed,
            atp_first_date = EXCLUDED.atp_first_date,
            atp_last_date = EXCLUDED.atp_last_date,
            activation_total = EXCLUDED.activation_total,
            activation_complete = EXCLUDED.activation_complete,
            activation_first_date = EXCLUDED.activation_first_date,
            activation_last_date = EXCLUDED.activation_last_date,
            overall_stage = EXCLUDED.overall_stage,
            last_synced_at = NOW(),
            sync_source = '1map'`,
          [
            projectId, agg.zone_no, agg.pon_no,
            agg.permissions.total, agg.permissions.complete, agg.permissions.firstDate, agg.permissions.lastDate,
            agg.poles.total, agg.poles.complete, agg.poles.firstDate, agg.poles.lastDate,
            agg.cwc.total, agg.cwc.complete, agg.cwc.firstDate, agg.cwc.lastDate,
            agg.optical.total, agg.optical.complete, agg.optical.firstDate, agg.optical.lastDate,
            agg.atp.total, agg.atp.complete, agg.atp.firstDate, agg.atp.lastDate,
            agg.activation.total, agg.activation.complete, agg.activation.firstDate, agg.activation.lastDate,
            overallStage,
          ]
        );
        upsertCount++;
      }

      const durationMs = Date.now() - startTime;

      const result: StageSyncResult = {
        site,
        project_id: projectId,
        records_processed: parsedRecords.length,
        pons_synced: upsertCount,
        stages_updated: stagesUpdated,
        errors,
        duration_ms: durationMs,
      };

      log.info('Stage sync complete', result, 'SyncStages');

      return res.status(200).json({ success: true, data: result });
    } finally {
      dbClient.release();
    }
  } catch (error) {
    const durationMs = Date.now() - startTime;
    log.error('Stage sync failed', { error, site, durationMs }, 'SyncStages');
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

export default withAuth(handler);
