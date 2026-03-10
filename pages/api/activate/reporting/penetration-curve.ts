/**
 * API Route: /api/activate/reporting/penetration-curve
 *
 * Purpose: Multi-series penetration time-series report
 * - Activation percentages over time
 * - Drill-down by Project > Zone > PON
 * - Daily/Weekly granularity
 *
 * Method: GET
 *
 * Query Parameters:
 * - dateFrom (required): Start date (YYYY-MM-DD)
 * - dateTo (required): End date (YYYY-MM-DD)
 * - groupBy (optional): 'project' | 'zone' | 'pon' (default: 'project')
 * - project (required when groupBy='zone' or 'pon'): project UUID or name
 * - zone (required when groupBy='pon'): zone_no integer
 * - granularity (optional): 'daily' | 'weekly' (default: 'daily')
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { withAuth, withRole } from '@/lib/auth';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import type {
  PenetrationCurveResponse,
  PenetrationSeries,
  PenetrationPoint,
  PenetrationGroupBy,
  PenetrationGranularity,
} from '@/modules/activate/types/reporting.types';

interface RawScopeRow {
  key: string;
  label: string;
  total_scope: string;
}

interface RawTimeSeriesRow {
  key: string;
  date: string;
  daily_activated: string;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PenetrationCurveResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const {
      dateFrom,
      dateTo,
      groupBy = 'project',
      project,
      zone,
      granularity = 'daily',
    } = req.query;

    // Validate required params
    if (!dateFrom || !dateTo) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Missing or invalid parameters');
    }

    const dateFromStr = String(Array.isArray(dateFrom) ? dateFrom[0] : dateFrom) as string;
    const dateToStr = String(Array.isArray(dateTo) ? dateTo[0] : dateTo) as string;
    const groupByMode = String(Array.isArray(groupBy) ? groupBy[0] : groupBy) as PenetrationGroupBy;
    const granularityMode = String(Array.isArray(granularity) ? granularity[0] : granularity) as PenetrationGranularity;

    // Validate drill-down requirements
    const projectFilter = project ? String(Array.isArray(project) ? project[0] : project) : null;
    const zoneFilter = zone ? parseInt(String(Array.isArray(zone) ? zone[0] : zone), 10) : null;

    if ((groupByMode === 'zone' || groupByMode === 'pon') && !projectFilter) {
      return apiResponse.error(
        res,
        ErrorCode.BAD_REQUEST,
        `project parameter required when groupBy='${groupByMode}'`
      );
    }

    if (groupByMode === 'pon' && zoneFilter === null) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'zone parameter required when groupBy=\'pon\'');
    }

    // Determine if projectFilter is UUID or name
    const isUuid = projectFilter
      ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectFilter)
      : false;

    log.info('PenetrationCurve', 'Fetching penetration curve', {
      dateFrom: dateFromStr,
      dateTo: dateToStr,
      groupBy: groupByMode,
      project: projectFilter,
      zone: zoneFilter,
      granularity: granularityMode,
    });

    const client = await pool.connect();

    try {
      let scopeQuery = '';
      let timeSeriesQuery = '';
      const scopeParams: unknown[] = [];
      const timeSeriesParams: unknown[] = [];

      // Build scope and time series queries based on groupBy
      if (groupByMode === 'project') {
        // Scope: count drops by project
        scopeQuery = `
          SELECT
            p.id::text as key,
            p.project_name as label,
            COUNT(DISTINCT d.drop_number)::text as total_scope
          FROM drops d
          JOIN projects p ON p.id = d.project_id
          WHERE p.status = 'active'
          GROUP BY p.id, p.project_name
          ORDER BY p.project_name
        `;

        // Time series: activations by project + date
        timeSeriesQuery = `
          SELECT
            p.id::text as key,
            ${granularityMode === 'daily' ? "oes.activation_date::text" : "DATE_TRUNC('week', oes.activation_date)::date::text"} as date,
            COUNT(DISTINCT oes.drop_number)::text as daily_activated
          FROM oes_activations oes
          JOIN drops d ON d.drop_number = oes.drop_number
          JOIN projects p ON p.id = d.project_id
          WHERE p.status = 'active'
            AND oes.activation_date >= $1::date
            AND oes.activation_date <= $2::date
          GROUP BY p.id, ${granularityMode === 'daily' ? 'oes.activation_date' : "DATE_TRUNC('week', oes.activation_date)"}
          ORDER BY p.id, ${granularityMode === 'daily' ? 'oes.activation_date' : "DATE_TRUNC('week', oes.activation_date)"}
        `;

        timeSeriesParams.push(dateFromStr, dateToStr);
      } else if (groupByMode === 'zone') {
        // Scope: count drops by zone within project
        scopeQuery = `
          SELECT
            'zone-' || d.zone_no::text as key,
            'Zone ' || d.zone_no::text as label,
            COUNT(DISTINCT d.drop_number)::text as total_scope
          FROM drops d
          JOIN projects p ON p.id = d.project_id
          WHERE p.status = 'active'
            AND (
              $1::text IS NULL
              OR ($2::boolean = true AND d.project_id = $1::uuid)
              OR ($2::boolean = false AND p.project_name = $1::text)
            )
          GROUP BY d.zone_no
          ORDER BY d.zone_no
        `;

        scopeParams.push(projectFilter, isUuid);

        // Time series: activations by zone + date
        timeSeriesQuery = `
          SELECT
            'zone-' || d.zone_no::text as key,
            ${granularityMode === 'daily' ? "oes.activation_date::text" : "DATE_TRUNC('week', oes.activation_date)::date::text"} as date,
            COUNT(DISTINCT oes.drop_number)::text as daily_activated
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
          GROUP BY d.zone_no, ${granularityMode === 'daily' ? 'oes.activation_date' : "DATE_TRUNC('week', oes.activation_date)"}
          ORDER BY d.zone_no, ${granularityMode === 'daily' ? 'oes.activation_date' : "DATE_TRUNC('week', oes.activation_date)"}
        `;

        timeSeriesParams.push(dateFromStr, dateToStr, projectFilter, isUuid);
      } else if (groupByMode === 'pon') {
        // Scope: count drops by PON within project + zone
        scopeQuery = `
          SELECT
            'pon-' || d.pon_no::text as key,
            'PON ' || d.pon_no::text as label,
            COUNT(DISTINCT d.drop_number)::text as total_scope
          FROM drops d
          JOIN projects p ON p.id = d.project_id
          WHERE p.status = 'active'
            AND (
              $1::text IS NULL
              OR ($2::boolean = true AND d.project_id = $1::uuid)
              OR ($2::boolean = false AND p.project_name = $1::text)
            )
            AND d.zone_no = $3::int
          GROUP BY d.pon_no
          ORDER BY d.pon_no
        `;

        scopeParams.push(projectFilter, isUuid, zoneFilter);

        // Time series: activations by PON + date
        timeSeriesQuery = `
          SELECT
            'pon-' || d.pon_no::text as key,
            ${granularityMode === 'daily' ? "oes.activation_date::text" : "DATE_TRUNC('week', oes.activation_date)::date::text"} as date,
            COUNT(DISTINCT oes.drop_number)::text as daily_activated
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
            AND d.zone_no = $5::int
          GROUP BY d.pon_no, ${granularityMode === 'daily' ? 'oes.activation_date' : "DATE_TRUNC('week', oes.activation_date)"}
          ORDER BY d.pon_no, ${granularityMode === 'daily' ? 'oes.activation_date' : "DATE_TRUNC('week', oes.activation_date)"}
        `;

        timeSeriesParams.push(dateFromStr, dateToStr, projectFilter, isUuid, zoneFilter);
      }

      // Execute queries
      const scopeResult = await client.query<RawScopeRow>(scopeQuery, scopeParams);
      const timeSeriesResult = await client.query<RawTimeSeriesRow>(timeSeriesQuery, timeSeriesParams);

      // Build scope map
      const scopeMap = new Map<string, { label: string; total_scope: number }>();
      for (const row of scopeResult.rows) {
        scopeMap.set(row.key, {
          label: row.label,
          total_scope: parseInt(row.total_scope, 10),
        });
      }

      // Build time series map
      const timeSeriesMap = new Map<string, Map<string, number>>();
      for (const row of timeSeriesResult.rows) {
        if (!timeSeriesMap.has(row.key)) {
          timeSeriesMap.set(row.key, new Map());
        }
        const dateMap = timeSeriesMap.get(row.key)!;
        const dailyActivated = parseInt(row.daily_activated, 10);
        dateMap.set(row.date, (dateMap.get(row.date) || 0) + dailyActivated);
      }

      // Generate all unique dates in range
      const allDates = new Set<string>();
      for (const dateMap of timeSeriesMap.values()) {
        for (const date of dateMap.keys()) {
          allDates.add(date);
        }
      }

      // If no data, create empty date range
      if (allDates.size === 0) {
        const start = new Date(dateFromStr!);
        const end = new Date(dateToStr!);
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          allDates.add(d.toISOString().split('T')[0]);
        }
      }

      // Sort dates
      const sortedDates = Array.from(allDates).sort();

      // Build series with cumulative calculations
      const series: PenetrationSeries[] = [];
      for (const [key, scopeInfo] of scopeMap.entries()) {
        const dateMap = timeSeriesMap.get(key) || new Map();
        let cumulative = 0;
        const points: PenetrationPoint[] = [];

        for (const date of sortedDates) {
          const dailyActivated = dateMap.get(date) || 0;
          cumulative += dailyActivated;

          const penetrationPct =
            scopeInfo.total_scope > 0
              ? Math.round((cumulative / scopeInfo.total_scope) * 10000) / 100
              : 0;

          points.push({
            date,
            daily_activated: dailyActivated,
            cumulative,
            penetration_pct: penetrationPct,
          });
        }

        series.push({
          key,
          label: scopeInfo.label,
          total_scope: scopeInfo.total_scope,
          points,
        });
      }

      // Sort series by label
      series.sort((a, b) => a.label.localeCompare(b.label));

      const response: PenetrationCurveResponse = {
        date_range: {
          from: dateFromStr,
          to: dateToStr,
        },
        group_by: groupByMode,
        granularity: granularityMode,
        series,
        dates: sortedDates,
      };

      log.info('PenetrationCurve', 'Report generated', {
        seriesCount: series.length,
        dateCount: sortedDates.length,
      });

      return res.status(200).json(response);
    } finally {
      client.release();
    }
  } catch (error) {
    log.error('PenetrationCurve', 'Failed to generate report', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole('manager')(handler));
