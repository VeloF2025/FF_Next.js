/**
 * API Route: /api/activate/reporting/maturity-tracking
 *
 * Purpose: Track project maturity - how long from first installation to maturity
 * - Milestone tracking: days to reach 25%, 50%, 75%, 90%
 * - Velocity metrics: activations per week with trend analysis
 * - Projection data: estimated completion dates
 *
 * Method: GET
 *
 * Query Parameters:
 * - project (optional): Filter by project ID (UUID) or project name
 * - view (optional): 'hierarchy' | 'flat' (default: hierarchy)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { withAuth, withRole } from '@/lib/auth';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import type {
  MaturityTrackingResponse,
  MaturityTrackingSummary,
  ProjectMaturityNode,
  ZoneMaturityNode,
  PonMaturityNode,
  FlatMaturityRow,
  MilestoneData,
  VelocityMetrics,
  ProjectionData,
} from '@/modules/activate/types/reporting.types';

// Milestone percentages to track
const MILESTONES = [25, 50, 75, 90];

interface RawProjectRow {
  project_id: string;
  project_name: string;
  zone_no: number | null;
  pon_no: number | null;
  total_scope: string;
  activated: string;
  first_activation_date: string | null;
  latest_activation_date: string | null;
}

interface RawMilestoneRow {
  project_id: string;
  zone_no: number | null;
  pon_no: number | null;
  activation_date: string;
  cumulative_count: string;
  total_scope: string;
}

interface RawVelocityRow {
  project_id: string;
  week_start: string;
  activated: string;
}

interface RawPoScopeRow {
  project_id: string;
  po_total_scope: string;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<MaturityTrackingResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET','POST']);
  }

  try {
    const { project, view = 'hierarchy' } = req.query;

    const projectFilter = project ? (Array.isArray(project) ? project[0] : project) : null;
    const isUuid = projectFilter
      ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectFilter)
      : false;
    const viewMode = (Array.isArray(view) ? view[0] : view) as 'hierarchy' | 'flat';

    log.info('MaturityTracking', 'Fetching maturity data', {
      project: projectFilter,
      isUuid,
      view: viewMode,
    });

    const client = await pool.connect();

    try {
      // Query 0: Get PO contracted drops per project (business target)
      // Falls back to SOW drop count if no PO exists
      const poScopeQuery = `
        SELECT
          cpo.project_id::text as project_id,
          SUM(cpo.contracted_drops)::text as po_total_scope
        FROM client_purchase_orders cpo
        JOIN projects p ON p.id = cpo.project_id
        WHERE p.status = 'active'
          AND (
            $1::text IS NULL
            OR ($2::boolean = true AND cpo.project_id = $1::uuid)
            OR ($2::boolean = false AND p.project_name = $1::text)
          )
        GROUP BY cpo.project_id
      `;

      const poScopeResult = await client.query<RawPoScopeRow>(poScopeQuery, [
        projectFilter,
        isUuid,
      ]);

      // Build PO scope lookup: project_id -> contracted drops total
      const poScopeMap = new Map<string, number>();
      for (const row of poScopeResult.rows) {
        poScopeMap.set(row.project_id, parseInt(row.po_total_scope, 10));
      }

      // Query 1: Get scope and activation counts with first/latest dates
      const projectQuery = `
        SELECT
          p.id as project_id,
          p.project_name,
          d.zone_no,
          d.pon_no,
          COUNT(DISTINCT d.drop_number)::text as total_scope,
          COUNT(DISTINCT CASE WHEN oes.activation_date IS NOT NULL THEN d.drop_number END)::text as activated,
          MIN(oes.activation_date)::text as first_activation_date,
          MAX(oes.activation_date)::text as latest_activation_date
        FROM drops d
        JOIN projects p ON p.id = d.project_id
        LEFT JOIN oes_activations oes ON oes.drop_number = d.drop_number
        WHERE p.status = 'active'
          AND (
            $1::text IS NULL
            OR ($2::boolean = true AND d.project_id = $1::uuid)
            OR ($2::boolean = false AND p.project_name = $1::text)
          )
        GROUP BY p.id, p.project_name, d.zone_no, d.pon_no
        ORDER BY p.project_name, d.zone_no NULLS LAST, d.pon_no NULLS LAST
      `;

      const projectResult = await client.query<RawProjectRow>(projectQuery, [
        projectFilter,
        isUuid,
      ]);

      // Query 2: Get cumulative activation counts per day for milestone calculation
      // We need running totals to find when each milestone was reached
      const milestoneQuery = `
        WITH daily_activations AS (
          SELECT
            d.project_id,
            d.zone_no,
            d.pon_no,
            oes.activation_date,
            COUNT(DISTINCT oes.drop_number) as daily_count
          FROM drops d
          JOIN projects p ON p.id = d.project_id
          JOIN oes_activations oes ON oes.drop_number = d.drop_number
          WHERE p.status = 'active'
            AND oes.activation_date IS NOT NULL
            AND (
              $1::text IS NULL
              OR ($2::boolean = true AND d.project_id = $1::uuid)
              OR ($2::boolean = false AND p.project_name = $1::text)
            )
          GROUP BY d.project_id, d.zone_no, d.pon_no, oes.activation_date
        ),
        scope_totals AS (
          SELECT
            d.project_id,
            d.zone_no,
            d.pon_no,
            COUNT(DISTINCT d.drop_number) as total_scope
          FROM drops d
          JOIN projects p ON p.id = d.project_id
          WHERE p.status = 'active'
            AND (
              $1::text IS NULL
              OR ($2::boolean = true AND d.project_id = $1::uuid)
              OR ($2::boolean = false AND p.project_name = $1::text)
            )
          GROUP BY d.project_id, d.zone_no, d.pon_no
        )
        SELECT
          da.project_id,
          da.zone_no,
          da.pon_no,
          da.activation_date::text,
          SUM(da.daily_count) OVER (
            PARTITION BY da.project_id, da.zone_no, da.pon_no
            ORDER BY da.activation_date
          )::text as cumulative_count,
          st.total_scope::text
        FROM daily_activations da
        JOIN scope_totals st ON st.project_id = da.project_id
          AND COALESCE(st.zone_no, -1) = COALESCE(da.zone_no, -1)
          AND COALESCE(st.pon_no, -1) = COALESCE(da.pon_no, -1)
        ORDER BY da.project_id, da.zone_no, da.pon_no, da.activation_date
      `;

      const milestoneResult = await client.query<RawMilestoneRow>(milestoneQuery, [
        projectFilter,
        isUuid,
      ]);

      // Query 3: Get weekly activation velocity for the last 12 weeks
      const velocityQuery = `
        SELECT
          d.project_id,
          DATE_TRUNC('week', oes.activation_date)::date::text as week_start,
          COUNT(DISTINCT oes.drop_number)::text as activated
        FROM drops d
        JOIN projects p ON p.id = d.project_id
        JOIN oes_activations oes ON oes.drop_number = d.drop_number
        WHERE p.status = 'active'
          AND oes.activation_date >= CURRENT_DATE - INTERVAL '12 weeks'
          AND (
            $1::text IS NULL
            OR ($2::boolean = true AND d.project_id = $1::uuid)
            OR ($2::boolean = false AND p.project_name = $1::text)
          )
        GROUP BY d.project_id, DATE_TRUNC('week', oes.activation_date)
        ORDER BY d.project_id, week_start
      `;

      const velocityResult = await client.query<RawVelocityRow>(velocityQuery, [
        projectFilter,
        isUuid,
      ]);

      // Build milestone lookup map
      const milestoneMap = new Map<string, RawMilestoneRow[]>();
      for (const row of milestoneResult.rows) {
        const key = `${row.project_id}|${row.zone_no ?? 'null'}|${row.pon_no ?? 'null'}`;
        if (!milestoneMap.has(key)) {
          milestoneMap.set(key, []);
        }
        milestoneMap.get(key)!.push(row);
      }

      // Build velocity lookup map
      const velocityMap = new Map<string, RawVelocityRow[]>();
      for (const row of velocityResult.rows) {
        if (!velocityMap.has(row.project_id)) {
          velocityMap.set(row.project_id, []);
        }
        velocityMap.get(row.project_id)!.push(row);
      }

      // Build hierarchy and flat data
      const projectMap = new Map<string, ProjectMaturityNode>();
      const flatRows: FlatMaturityRow[] = [];
      const today = new Date();

      for (const row of projectResult.rows) {
        const totalScope = parseInt(row.total_scope, 10);
        const activated = parseInt(row.activated, 10);
        const remaining = totalScope - activated;
        const completionPercent =
          totalScope > 0 ? Math.round((activated / totalScope) * 10000) / 100 : 0;

        const firstDate = row.first_activation_date ? new Date(row.first_activation_date) : null;
        const latestDate = row.latest_activation_date ? new Date(row.latest_activation_date) : null;
        const ageDays = firstDate
          ? Math.floor((today.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24))
          : 0;

        // Calculate milestones for this PON
        const milestoneKey = `${row.project_id}|${row.zone_no ?? 'null'}|${row.pon_no ?? 'null'}`;
        const milestoneRows = milestoneMap.get(milestoneKey) || [];
        const milestones = calculateMilestones(milestoneRows, totalScope, firstDate);

        // Calculate velocity (project-level only for now)
        const velocityRows = velocityMap.get(row.project_id) || [];
        const velocity = calculateVelocity(velocityRows);

        // Calculate projection
        const projection = calculateProjection(totalScope, activated, velocity, remaining);

        // Add to flat rows
        flatRows.push({
          project_id: row.project_id,
          project_name: row.project_name,
          zone_no: row.zone_no ?? 0,
          pon_no: row.pon_no ?? 0,
          total_scope: totalScope,
          activated,
          remaining,
          completion_percent: completionPercent,
          first_activation_date: row.first_activation_date,
          latest_activation_date: row.latest_activation_date,
          age_days: ageDays,
          milestones,
          velocity,
          projection,
        });

        // Build hierarchy
        let projectNode = projectMap.get(row.project_id);
        if (!projectNode) {
          projectNode = {
            project_id: row.project_id,
            project_name: row.project_name,
            total_scope: 0,
            activated: 0,
            remaining: 0,
            completion_percent: 0,
            first_activation_date: null,
            latest_activation_date: null,
            age_days: 0,
            milestones: [],
            velocity: { last_4_weeks: 0, last_12_weeks: 0, all_time: 0, wow_change_percent: 0, trend: 'steady' },
            projection: { projected_completion_date: null, days_to_completion: null, confidence: 'unknown', required_weekly_rate: null },
            zones: [],
          };
          projectMap.set(row.project_id, projectNode);
        }

        // Find or create zone
        const zoneNo = row.zone_no ?? 0;
        let zoneNode = projectNode.zones.find((z) => z.zone_no === zoneNo);
        if (!zoneNode) {
          zoneNode = {
            zone_no: zoneNo,
            total_scope: 0,
            activated: 0,
            remaining: 0,
            completion_percent: 0,
            first_activation_date: null,
            latest_activation_date: null,
            age_days: 0,
            milestones: [],
            pons: [],
          };
          projectNode.zones.push(zoneNode);
        }

        // Add PON
        const ponNode: PonMaturityNode = {
          pon_no: row.pon_no ?? 0,
          total_scope: totalScope,
          activated,
          remaining,
          completion_percent: completionPercent,
          first_activation_date: row.first_activation_date,
          latest_activation_date: row.latest_activation_date,
          age_days: ageDays,
          milestones,
        };
        zoneNode.pons.push(ponNode);

        // Update zone totals
        zoneNode.total_scope += totalScope;
        zoneNode.activated += activated;
        zoneNode.remaining += remaining;
        if (!zoneNode.first_activation_date || (row.first_activation_date && row.first_activation_date < zoneNode.first_activation_date)) {
          zoneNode.first_activation_date = row.first_activation_date;
        }
        if (!zoneNode.latest_activation_date || (row.latest_activation_date && row.latest_activation_date > zoneNode.latest_activation_date)) {
          zoneNode.latest_activation_date = row.latest_activation_date;
        }

        // Update project totals
        projectNode.total_scope += totalScope;
        projectNode.activated += activated;
        projectNode.remaining += remaining;
        if (!projectNode.first_activation_date || (row.first_activation_date && row.first_activation_date < projectNode.first_activation_date)) {
          projectNode.first_activation_date = row.first_activation_date;
        }
        if (!projectNode.latest_activation_date || (row.latest_activation_date && row.latest_activation_date > projectNode.latest_activation_date)) {
          projectNode.latest_activation_date = row.latest_activation_date;
        }
      }

      // Override project-level total_scope with PO contracted drops when available
      for (const projectNode of projectMap.values()) {
        const poScope = poScopeMap.get(projectNode.project_id);
        if (poScope && poScope > 0) {
          projectNode.total_scope = poScope;
          projectNode.remaining = poScope - projectNode.activated;
        }
      }

      // Calculate percentages, milestones, velocity, and projection for zones and projects
      const hierarchy: ProjectMaturityNode[] = [];
      for (const projectNode of projectMap.values()) {
        projectNode.completion_percent =
          projectNode.total_scope > 0
            ? Math.round((projectNode.activated / projectNode.total_scope) * 10000) / 100
            : 0;

        const projectFirstDate = projectNode.first_activation_date
          ? new Date(projectNode.first_activation_date)
          : null;
        projectNode.age_days = projectFirstDate
          ? Math.floor((today.getTime() - projectFirstDate.getTime()) / (1000 * 60 * 60 * 24))
          : 0;

        // Get project-level velocity
        const velocityRows = velocityMap.get(projectNode.project_id) || [];
        projectNode.velocity = calculateVelocity(velocityRows);
        projectNode.projection = calculateProjection(
          projectNode.total_scope,
          projectNode.activated,
          projectNode.velocity,
          projectNode.remaining
        );

        // Calculate project-level milestones using aggregated data
        const projectMilestoneKey = `${projectNode.project_id}|null|null`;
        // For project level, we need to aggregate all PON milestones
        // For simplicity, use project first date and calculate based on completion
        projectNode.milestones = calculateAggregatedMilestones(
          projectNode,
          milestoneMap,
          projectFirstDate
        );

        for (const zoneNode of projectNode.zones) {
          zoneNode.completion_percent =
            zoneNode.total_scope > 0
              ? Math.round((zoneNode.activated / zoneNode.total_scope) * 10000) / 100
              : 0;

          const zoneFirstDate = zoneNode.first_activation_date
            ? new Date(zoneNode.first_activation_date)
            : null;
          zoneNode.age_days = zoneFirstDate
            ? Math.floor((today.getTime() - zoneFirstDate.getTime()) / (1000 * 60 * 60 * 24))
            : 0;

          // Calculate zone-level milestones
          zoneNode.milestones = calculateAggregatedMilestones(
            { ...zoneNode, project_id: projectNode.project_id },
            milestoneMap,
            zoneFirstDate
          );

          // Sort PONs by pon_no
          zoneNode.pons.sort((a, b) => a.pon_no - b.pon_no);
        }
        // Sort zones by zone_no
        projectNode.zones.sort((a, b) => a.zone_no - b.zone_no);
        hierarchy.push(projectNode);
      }
      // Sort projects by name
      hierarchy.sort((a, b) => a.project_name.localeCompare(b.project_name));

      // Calculate summary
      const totalScope = hierarchy.reduce((sum, p) => sum + p.total_scope, 0);
      const totalActivated = hierarchy.reduce((sum, p) => sum + p.activated, 0);
      const totalRemaining = totalScope - totalActivated;
      const avgCompletionPercent =
        hierarchy.length > 0
          ? Math.round(
              (hierarchy.reduce((sum, p) => sum + p.completion_percent, 0) / hierarchy.length) * 100
            ) / 100
          : 0;

      // Find oldest and youngest project
      const projectsWithAge = hierarchy.filter((p) => p.age_days > 0);
      const oldestProjectAgeDays =
        projectsWithAge.length > 0 ? Math.max(...projectsWithAge.map((p) => p.age_days)) : 0;
      const youngestProjectAgeDays =
        projectsWithAge.length > 0 ? Math.min(...projectsWithAge.map((p) => p.age_days)) : 0;
      const avgAgeDays =
        projectsWithAge.length > 0
          ? Math.round(projectsWithAge.reduce((sum, p) => sum + p.age_days, 0) / projectsWithAge.length)
          : 0;

      // Calculate days to milestones across all projects
      const avgDaysTo25 = calculateAvgDaysToMilestone(hierarchy, 25);
      const avgDaysTo50 = calculateAvgDaysToMilestone(hierarchy, 50);
      const avgDaysTo75 = calculateAvgDaysToMilestone(hierarchy, 75);
      const avgDaysTo90 = calculateAvgDaysToMilestone(hierarchy, 90);

      // Count projects by maturity status
      const projectsNotStarted = hierarchy.filter((p) => p.completion_percent === 0).length;
      const projectsEarly = hierarchy.filter(
        (p) => p.completion_percent > 0 && p.completion_percent < 25
      ).length;
      const projectsMidProgress = hierarchy.filter(
        (p) => p.completion_percent >= 25 && p.completion_percent < 75
      ).length;
      const projectsNearComplete = hierarchy.filter(
        (p) => p.completion_percent >= 75 && p.completion_percent < 100
      ).length;
      const projectsComplete = hierarchy.filter((p) => p.completion_percent >= 100).length;

      const summary: MaturityTrackingSummary = {
        total_projects: hierarchy.length,
        total_scope: totalScope,
        total_activated: totalActivated,
        total_remaining: totalRemaining,
        avg_completion_percent: avgCompletionPercent,
        oldest_project_age_days: oldestProjectAgeDays,
        youngest_project_age_days: youngestProjectAgeDays,
        avg_age_days: avgAgeDays,
        avg_days_to_25_percent: avgDaysTo25,
        avg_days_to_50_percent: avgDaysTo50,
        avg_days_to_75_percent: avgDaysTo75,
        avg_days_to_90_percent: avgDaysTo90,
        projects_not_started: projectsNotStarted,
        projects_early_stage: projectsEarly,
        projects_mid_progress: projectsMidProgress,
        projects_near_complete: projectsNearComplete,
        projects_complete: projectsComplete,
      };

      const response: MaturityTrackingResponse = {
        as_of_date: today.toISOString().split('T')[0] as string,
        project: projectFilter ?? null,
        summary,
        hierarchy,
        flat: flatRows,
      };

      log.info('MaturityTracking', 'Report generated', {
        totalProjects: hierarchy.length,
        totalScope,
        totalActivated,
        avgCompletionPercent,
      });

      return res.status(200).json(response);
    } finally {
      client.release();
    }
  } catch (error) {
    log.error('MaturityTracking', 'Failed to generate report', { error });
    return apiResponse.internalError(res, error);
  }
}

// Calculate milestones based on cumulative activation data
function calculateMilestones(
  rows: RawMilestoneRow[],
  totalScope: number,
  firstDate: Date | null
): MilestoneData[] {
  const milestones: MilestoneData[] = [];

  for (const targetPercent of MILESTONES) {
    const targetCount = Math.ceil((targetPercent / 100) * totalScope);
    const reachedRow = rows.find((r) => parseInt(r.cumulative_count, 10) >= targetCount);

    if (reachedRow && firstDate) {
      const reachedDate = new Date(reachedRow.activation_date);
      const daysToReach = Math.floor(
        (reachedDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      milestones.push({
        percent: targetPercent,
        reached_date: reachedRow.activation_date,
        days_to_reach: Math.max(0, daysToReach),
      });
    } else {
      milestones.push({
        percent: targetPercent,
        reached_date: null,
        days_to_reach: null,
      });
    }
  }

  return milestones;
}

// Calculate aggregated milestones for zone/project level
function calculateAggregatedMilestones(
  node: { total_scope: number; activated: number; completion_percent: number; project_id?: string },
  _milestoneMap: Map<string, RawMilestoneRow[]>,
  firstDate: Date | null
): MilestoneData[] {
  const milestones: MilestoneData[] = [];
  const today = new Date();

  for (const targetPercent of MILESTONES) {
    if (node.completion_percent >= targetPercent && firstDate) {
      // Estimate days to reach based on linear interpolation
      const ageDays = Math.floor((today.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24));
      const estimatedDays = Math.round((targetPercent / node.completion_percent) * ageDays);
      const estimatedDate = new Date(firstDate.getTime() + estimatedDays * 24 * 60 * 60 * 1000);

      milestones.push({
        percent: targetPercent,
        reached_date: estimatedDate.toISOString().split('T')[0] as string,
        days_to_reach: estimatedDays,
      });
    } else {
      milestones.push({
        percent: targetPercent,
        reached_date: null,
        days_to_reach: null,
      });
    }
  }

  return milestones;
}

// Calculate velocity metrics from weekly data
function calculateVelocity(rows: RawVelocityRow[]): VelocityMetrics {
  if (rows.length === 0) {
    return {
      last_4_weeks: 0,
      last_12_weeks: 0,
      all_time: 0,
      wow_change_percent: 0,
      trend: 'stalled',
    };
  }

  const today = new Date();
  const fourWeeksAgo = new Date(today.getTime() - 4 * 7 * 24 * 60 * 60 * 1000);
  const twelveWeeksAgo = new Date(today.getTime() - 12 * 7 * 24 * 60 * 60 * 1000);

  const last4WeeksRows = rows.filter((r) => new Date(r.week_start) >= fourWeeksAgo);
  const last12WeeksRows = rows.filter((r) => new Date(r.week_start) >= twelveWeeksAgo);

  const last4WeeksSum = last4WeeksRows.reduce((sum, r) => sum + parseInt(r.activated, 10), 0);
  const last12WeeksSum = last12WeeksRows.reduce((sum, r) => sum + parseInt(r.activated, 10), 0);
  const allTimeSum = rows.reduce((sum, r) => sum + parseInt(r.activated, 10), 0);

  const last4WeeksAvg = last4WeeksRows.length > 0 ? Math.round(last4WeeksSum / 4) : 0;
  const last12WeeksAvg = last12WeeksRows.length > 0 ? Math.round(last12WeeksSum / 12) : 0;
  const allTimeAvg = rows.length > 0 ? Math.round(allTimeSum / rows.length) : 0;

  // Calculate week-over-week change
  const sortedRows = [...rows].sort(
    (a, b) => new Date(b.week_start).getTime() - new Date(a.week_start).getTime()
  );
  const currentWeek = sortedRows[0] ? parseInt(sortedRows[0].activated, 10) : 0;
  const previousWeek = sortedRows[1] ? parseInt(sortedRows[1].activated, 10) : 0;
  const wowChange =
    previousWeek > 0 ? Math.round(((currentWeek - previousWeek) / previousWeek) * 10000) / 100 : 0;

  // Determine trend
  let trend: 'accelerating' | 'steady' | 'slowing' | 'stalled' = 'steady';
  if (last4WeeksAvg === 0) {
    trend = 'stalled';
  } else if (last4WeeksAvg > last12WeeksAvg * 1.2) {
    trend = 'accelerating';
  } else if (last4WeeksAvg < last12WeeksAvg * 0.8) {
    trend = 'slowing';
  }

  return {
    last_4_weeks: last4WeeksAvg,
    last_12_weeks: last12WeeksAvg,
    all_time: allTimeAvg,
    wow_change_percent: wowChange,
    trend,
  };
}

// Calculate projection data
function calculateProjection(
  totalScope: number,
  activated: number,
  velocity: VelocityMetrics,
  remaining: number
): ProjectionData {
  if (remaining <= 0) {
    return {
      projected_completion_date: null,
      days_to_completion: 0,
      confidence: 'high',
      required_weekly_rate: 0,
    };
  }

  if (velocity.last_4_weeks === 0) {
    return {
      projected_completion_date: null,
      days_to_completion: null,
      confidence: 'unknown',
      required_weekly_rate: remaining,
    };
  }

  const weeksToComplete = remaining / velocity.last_4_weeks;
  const daysToComplete = Math.ceil(weeksToComplete * 7);
  const projectedDate = new Date(Date.now() + daysToComplete * 24 * 60 * 60 * 1000);

  // Determine confidence based on velocity consistency
  let confidence: 'high' | 'medium' | 'low' | 'unknown' = 'medium';
  if (velocity.trend === 'accelerating' || velocity.trend === 'steady') {
    confidence = activated / totalScope > 0.5 ? 'high' : 'medium';
  } else if (velocity.trend === 'slowing') {
    confidence = 'low';
  } else {
    confidence = 'unknown';
  }

  return {
    projected_completion_date: projectedDate.toISOString().split('T')[0] as string,
    days_to_completion: daysToComplete,
    confidence,
    required_weekly_rate: Math.ceil(remaining / 4), // What's needed to complete in 4 weeks
  };
}

// Calculate average days to reach a milestone across all projects
function calculateAvgDaysToMilestone(hierarchy: ProjectMaturityNode[], targetPercent: number): number | null {
  const daysValues = hierarchy
    .map((p) => p.milestones.find((m) => m.percent === targetPercent)?.days_to_reach)
    .filter((d): d is number => d !== null && d !== undefined);

  if (daysValues.length === 0) return null;
  return Math.round(daysValues.reduce((sum, d) => sum + d, 0) / daysValues.length);
}

export default withAuth(withRole('manager')(handler));
