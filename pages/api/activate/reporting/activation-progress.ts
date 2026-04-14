/**
 * API Route: /api/activate/reporting/activation-progress
 *
 * Purpose: Track DR activation progress by Project > Zone > PON
 * - Total scope from `drops` table (SOW import)
 * - Activated = has OES activation date
 * - Percentage tracking against total DRs
 *
 * Method: GET
 *
 * Query Parameters:
 * - dateFrom (required): Start date for activation window
 * - dateTo (required): End date for activation window
 * - project (optional): Filter by project ID (UUID)
 * - view (optional): 'hierarchy' | 'flat' (default: hierarchy)
 * - granularity (optional): 'daily' | 'weekly' | 'cumulative' (default: cumulative)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { withAuth, withRole } from '@/lib/auth';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import type {
  ActivationProgressResponse,
  ActivationProgressSummary,
  ActivationProgressGranularity,
  ActivationProgressView,
  ProjectProgressNode,
  ZoneProgressNode,
  PonProgressNode,
  FlatProgressRow,
  ActivationTimeSeriesPoint,
} from '@/modules/activate/types/reporting.types';

interface RawProgressRow {
  project_id: string;
  project_name: string;
  zone_no: number | null;
  pon_no: number | null;
  total_scope: string;
  activated: string;
}

interface RawTimeSeriesRow {
  date: string;
  activated: string;
}

interface RawPoScopeRow {
  project_id: string;
  po_total_scope: string;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ActivationProgressResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET','POST']);
  }

  try {
    const {
      dateFrom,
      dateTo,
      project,
      view = 'hierarchy',
      granularity = 'cumulative',
    } = req.query;

    // Validate required params
    if (!dateFrom || !dateTo) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Missing or invalid parameters');
    }

    const dateFromStr = Array.isArray(dateFrom) ? dateFrom[0] : dateFrom;
    const dateToStr = Array.isArray(dateTo) ? dateTo[0] : dateTo;
    const projectFilter = project ? (Array.isArray(project) ? (project[0] ?? null) : project) : null;
    // Check if projectFilter is a UUID or a project name
    const isUuid = projectFilter ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectFilter) : false;
    const viewMode = (Array.isArray(view) ? view[0] : view) as ActivationProgressView;
    const granularityMode = (Array.isArray(granularity) ? granularity[0] : granularity) as ActivationProgressGranularity;

    log.info('Fetching activation progress', {
      dateFrom: dateFromStr,
      dateTo: dateToStr,
      project: projectFilter,
      isUuid,
      view: viewMode,
      granularity: granularityMode,
    }, 'ActivationProgress');


    const client = await pool.connect();

    try {
      // Query 0: Get PO contracted drops per project (business target)
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

      const poScopeMap = new Map<string, number>();
      for (const row of poScopeResult.rows) {
        poScopeMap.set(row.project_id, parseInt(row.po_total_scope, 10));
      }

      // Main query: Get scope and activation counts by project/zone/pon
      // Activated = has ANY OES activation date (not filtered by date range)
      // Date range only affects time series chart, not overall progress
      // Only include active projects
      // Support both UUID and project name filtering
      const progressQuery = `
        SELECT
          p.id as project_id,
          p.project_name,
          d.zone_no,
          d.pon_no,
          COUNT(DISTINCT d.drop_number)::text as total_scope,
          COUNT(DISTINCT CASE
            WHEN oes.activation_date IS NOT NULL
            THEN d.drop_number
          END)::text as activated
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

      const progressResult = await client.query<RawProgressRow>(progressQuery, [
        projectFilter,
        isUuid,
      ]);

      // Time series query for charts (only active projects)
      // Support both UUID and project name filtering
      let timeSeriesQuery = '';
      if (granularityMode === 'daily') {
        timeSeriesQuery = `
          SELECT
            oes.activation_date::text as date,
            COUNT(DISTINCT oes.drop_number)::text as activated
          FROM oes_activations oes
          JOIN drops d ON d.drop_number = oes.drop_number
          JOIN projects p ON p.id = d.project_id
          WHERE p.status = 'active'
            AND oes.activation_date >= $1::date
            AND oes.activation_date <= $2::date
            AND (
              $3::text IS NULL
              OR ($4::boolean = true AND d.project_id = $3::uuid)
              OR ($4::boolean = false AND p.project_name = $3::text)
            )
          GROUP BY oes.activation_date
          ORDER BY oes.activation_date
        `;
      } else if (granularityMode === 'weekly') {
        timeSeriesQuery = `
          SELECT
            DATE_TRUNC('week', oes.activation_date)::date::text as date,
            COUNT(DISTINCT oes.drop_number)::text as activated
          FROM oes_activations oes
          JOIN drops d ON d.drop_number = oes.drop_number
          JOIN projects p ON p.id = d.project_id
          WHERE p.status = 'active'
            AND oes.activation_date >= $1::date
            AND oes.activation_date <= $2::date
            AND (
              $3::text IS NULL
              OR ($4::boolean = true AND d.project_id = $3::uuid)
              OR ($4::boolean = false AND p.project_name = $3::text)
            )
          GROUP BY DATE_TRUNC('week', oes.activation_date)
          ORDER BY DATE_TRUNC('week', oes.activation_date)
        `;
      } else {
        // Cumulative - get daily and we'll accumulate in code
        timeSeriesQuery = `
          SELECT
            oes.activation_date::text as date,
            COUNT(DISTINCT oes.drop_number)::text as activated
          FROM oes_activations oes
          JOIN drops d ON d.drop_number = oes.drop_number
          JOIN projects p ON p.id = d.project_id
          WHERE p.status = 'active'
            AND oes.activation_date >= $1::date
            AND oes.activation_date <= $2::date
            AND (
              $3::text IS NULL
              OR ($4::boolean = true AND d.project_id = $3::uuid)
              OR ($4::boolean = false AND p.project_name = $3::text)
            )
          GROUP BY oes.activation_date
          ORDER BY oes.activation_date
        `;
      }

      const timeSeriesResult = await client.query<RawTimeSeriesRow>(timeSeriesQuery, [
        dateFromStr,
        dateToStr,
        projectFilter,
        isUuid,
      ]);

      // Build hierarchy and flat data
      const projectMap = new Map<string, ProjectProgressNode>();
      const flatRows: FlatProgressRow[] = [];

      for (const row of progressResult.rows) {
        const totalScope = parseInt(row.total_scope, 10);
        const activated = parseInt(row.activated, 10);
        const remaining = totalScope - activated;
        const completionPercent = totalScope > 0 ? Math.round((activated / totalScope) * 10000) / 100 : 0;

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
            zones: [],
          };
          projectMap.set(row.project_id, projectNode);
        }

        // Find or create zone
        const zoneNo = row.zone_no ?? 0;
        let zoneNode = projectNode.zones.find(z => z.zone_no === zoneNo);
        if (!zoneNode) {
          zoneNode = {
            zone_no: zoneNo,
            total_scope: 0,
            activated: 0,
            remaining: 0,
            completion_percent: 0,
            pons: [],
          };
          projectNode.zones.push(zoneNode);
        }

        // Add PON
        const ponNode: PonProgressNode = {
          pon_no: row.pon_no ?? 0,
          total_scope: totalScope,
          activated,
          remaining,
          completion_percent: completionPercent,
        };
        zoneNode.pons.push(ponNode);

        // Update zone totals
        zoneNode.total_scope += totalScope;
        zoneNode.activated += activated;
        zoneNode.remaining += remaining;

        // Update project totals
        projectNode.total_scope += totalScope;
        projectNode.activated += activated;
        projectNode.remaining += remaining;
      }

      // Override project-level total_scope with PO contracted drops when available
      for (const projectNode of projectMap.values()) {
        const poScope = poScopeMap.get(projectNode.project_id);
        if (poScope && poScope > 0) {
          projectNode.total_scope = poScope;
          projectNode.remaining = poScope - projectNode.activated;
        }
      }

      // Calculate percentages for zones and projects
      const hierarchy: ProjectProgressNode[] = [];
      for (const projectNode of projectMap.values()) {
        projectNode.completion_percent = projectNode.total_scope > 0
          ? Math.round((projectNode.activated / projectNode.total_scope) * 10000) / 100
          : 0;

        for (const zoneNode of projectNode.zones) {
          zoneNode.completion_percent = zoneNode.total_scope > 0
            ? Math.round((zoneNode.activated / zoneNode.total_scope) * 10000) / 100
            : 0;
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
      const completionPercent = totalScope > 0
        ? Math.round((totalActivated / totalScope) * 10000) / 100
        : 0;

      // Calculate days in range
      const startDate = new Date(dateFromStr as string);
      const endDate = new Date(dateToStr as string);
      const daysInRange = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);
      const activationRatePerDay = Math.round((totalActivated / daysInRange) * 100) / 100;

      // Find first and last activation dates
      const activationDates = timeSeriesResult.rows.map(r => r.date).filter(d => d);
      const firstActivationDate = activationDates.length > 0 ? activationDates[0] : null;
      const lastActivationDate = activationDates.length > 0 ? activationDates[activationDates.length - 1] : null;

      const summary: ActivationProgressSummary = {
        total_scope: totalScope,
        total_activated: totalActivated,
        total_remaining: totalRemaining,
        completion_percent: completionPercent,
        activation_rate_per_day: activationRatePerDay,
        days_in_range: daysInRange,
        first_activation_date: firstActivationDate ?? null,
        last_activation_date: lastActivationDate ?? null,
      };

      // Build time series with cumulative if needed
      const timeSeries: ActivationTimeSeriesPoint[] = [];
      let cumulative = 0;

      for (const row of timeSeriesResult.rows) {
        const activated = parseInt(row.activated, 10);
        cumulative += activated;

        const point: ActivationTimeSeriesPoint = {
          date: row.date,
          label: granularityMode === 'weekly'
            ? `W${getWeekNumber(new Date(row.date))}`
            : formatDateLabel(row.date),
          activated,
          cumulative,
          total_scope: totalScope,
          completion_percent: totalScope > 0
            ? Math.round((cumulative / totalScope) * 10000) / 100
            : 0,
        };
        timeSeries.push(point);
      }

      const response: ActivationProgressResponse = {
        date_range: {
          from: dateFromStr as string,
          to: dateToStr as string,
        },
        project: projectFilter,
        granularity: granularityMode,
        view: viewMode,
        summary,
        hierarchy,
        flat: flatRows,
        time_series: timeSeries,
      };

      log.info('Report generated', {
        totalScope,
        totalActivated,
        completionPercent,
        projectCount: hierarchy.length,
      }, 'ActivationProgress');


      return res.status(200).json(response);
    } finally {
      client.release();
    }
  } catch (error) {
    log.error('Failed to generate report', { error: { error } }, 'ActivationProgress');
    return apiResponse.internalError(res, error);
  }
}

// Helper: Get ISO week number
function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

// Helper: Format date label
function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' });
}

export default withAuth(withRole('manager')(handler));
