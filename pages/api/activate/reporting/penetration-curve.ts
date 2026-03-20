/**
 * API Route: /api/activate/reporting/penetration-curve
 *
 * Purpose: Multi-series penetration time-series report
 * - Uses PO contracted_drops as scope denominator (falls back to drop count if no PO)
 * - Zone/PON scope is pro-rated from project PO scope proportionally
 * - Activation percentages over time
 * - Drill-down by Project > Zone > PON
 * - Daily/Weekly granularity
 * - Each series starts from its own first activation date (no forced start date)
 *
 * Method: GET
 *
 * Query Parameters:
 * - dateFrom (required): Context start date (YYYY-MM-DD) — used for display only
 * - dateTo (required): End date cap (YYYY-MM-DD)
 * - groupBy (optional): 'project' | 'zone' | 'pon' (default: 'project')
 * - project (required when groupBy='zone' or 'pon'): project UUID or name
 * - zone (required when groupBy='pon'): zone_no integer
 * - granularity (optional): 'daily' | 'weekly' (default: 'daily')
 * - scopeMode (optional): 'full' | 'live_pons' (default: 'full')
 *     'full' = PO contracted_drops (or all drops) as denominator
 *     'live_pons' = only drops in PONs that have at least one OES activation
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
      scopeMode = 'full',
    } = req.query;

    if (!dateFrom || !dateTo) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Missing or invalid parameters');
    }

    const dateFromStr = String(Array.isArray(dateFrom) ? dateFrom[0] : dateFrom);
    const dateToStr = String(Array.isArray(dateTo) ? dateTo[0] : dateTo);
    const groupByMode = String(Array.isArray(groupBy) ? groupBy[0] : groupBy) as PenetrationGroupBy;
    const granularityMode = String(Array.isArray(granularity) ? granularity[0] : granularity) as PenetrationGranularity;
    const useLivePons = String(Array.isArray(scopeMode) ? scopeMode[0] : scopeMode) === 'live_pons';

    const projectFilter = project ? String(Array.isArray(project) ? project[0] : project) : null;
    const zoneFilter = zone ? parseInt(String(Array.isArray(zone) ? zone[0] : zone), 10) : null;

    if ((groupByMode === 'zone' || groupByMode === 'pon') && !projectFilter) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, `project parameter required when groupBy='${groupByMode}'`);
    }

    if (groupByMode === 'pon' && zoneFilter === null) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, "zone parameter required when groupBy='pon'");
    }

    const isUuid = projectFilter
      ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectFilter)
      : false;

    log.info('PenetrationCurve', 'Fetching penetration curve', { dateFrom: dateFromStr, dateTo: dateToStr, groupBy: groupByMode, granularity: granularityMode });

    const client = await pool.connect();

    try {
      let scopeQuery = '';
      let timeSeriesQuery = '';
      const scopeParams: unknown[] = [];
      const timeSeriesParams: unknown[] = [];

      const dateExpr = granularityMode === 'daily'
        ? 'oes.activation_date::text'
        : "DATE_TRUNC('week', oes.activation_date)::date::text";
      const groupDateExpr = granularityMode === 'daily'
        ? 'oes.activation_date'
        : "DATE_TRUNC('week', oes.activation_date)";

      if (groupByMode === 'project') {
        if (useLivePons) {
          // Live PONs mode: scope = drops in PONs that have at least one activation
          scopeQuery = `
            SELECT
              p.id::text AS key,
              p.project_name AS label,
              COUNT(DISTINCT d.drop_number)::text AS total_scope
            FROM drops d
            JOIN projects p ON p.id = d.project_id
            WHERE p.status = 'active'
              AND COALESCE(p.project_type, 'installation') != 'internal'
              AND EXISTS (
                SELECT 1 FROM oes_activations oes2
                JOIN drops d2 ON d2.drop_number = oes2.drop_number
                WHERE d2.project_id = d.project_id AND d2.pon_no = d.pon_no
              )
            GROUP BY p.id, p.project_name
            ORDER BY p.project_name
          `;
        } else {
          // Full mode: PO contracted_drops preferred; fall back to drop count if no PO exists
          scopeQuery = `
            WITH po_scope AS (
              SELECT cpo.project_id, SUM(cpo.contracted_drops) AS po_scope
              FROM client_purchase_orders cpo
              JOIN projects p ON p.id = cpo.project_id
              WHERE p.status = 'active'
                AND COALESCE(p.project_type, 'installation') != 'internal'
              GROUP BY cpo.project_id
            ),
            drop_scope AS (
              SELECT d.project_id, COUNT(DISTINCT d.drop_number) AS drop_scope
              FROM drops d
              JOIN projects p ON p.id = d.project_id
              WHERE p.status = 'active'
                AND COALESCE(p.project_type, 'installation') != 'internal'
              GROUP BY d.project_id
            )
            SELECT
              p.id::text AS key,
              p.project_name AS label,
              COALESCE(ps.po_scope, ds.drop_scope, 0)::text AS total_scope
            FROM projects p
            LEFT JOIN po_scope ps ON ps.project_id = p.id
            LEFT JOIN drop_scope ds ON ds.project_id = p.id
            WHERE p.status = 'active'
              AND COALESCE(p.project_type, 'installation') != 'internal'
            ORDER BY p.project_name
          `;
        }

        timeSeriesQuery = `
          SELECT
            p.id::text AS key,
            ${dateExpr} AS date,
            COUNT(DISTINCT oes.drop_number)::text AS daily_activated
          FROM oes_activations oes
          JOIN drops d ON d.drop_number = oes.drop_number
          JOIN projects p ON p.id = d.project_id
          WHERE p.status = 'active'
            AND COALESCE(p.project_type, 'installation') != 'internal'
            AND oes.activation_date <= $1::date
          GROUP BY p.id, ${groupDateExpr}
          ORDER BY p.id, ${groupDateExpr}
        `;
        timeSeriesParams.push(dateToStr);

      } else if (groupByMode === 'zone') {
        if (useLivePons) {
          // Live PONs mode: scope = drops in PONs with activations, grouped by zone
          scopeQuery = `
            SELECT
              'zone-' || d.zone_no::text AS key,
              'Zone ' || d.zone_no::text AS label,
              COUNT(DISTINCT d.drop_number)::text AS total_scope
            FROM drops d
            JOIN projects p ON p.id = d.project_id
            WHERE p.status = 'active'
              AND (
                $1::text IS NULL
                OR ($2::boolean = true AND d.project_id = $1::uuid)
                OR ($2::boolean = false AND p.project_name = $1::text)
              )
              AND EXISTS (
                SELECT 1 FROM oes_activations oes2
                JOIN drops d2 ON d2.drop_number = oes2.drop_number
                WHERE d2.project_id = d.project_id AND d2.pon_no = d.pon_no
              )
            GROUP BY d.zone_no
            ORDER BY d.zone_no
          `;
        } else {
          // Full mode: pro-rate project PO contracted_drops by zone's share of total drops.
          scopeQuery = `
            WITH project_po AS (
              SELECT SUM(cpo.contracted_drops) AS po_scope
              FROM client_purchase_orders cpo
              JOIN projects p ON p.id = cpo.project_id
              WHERE p.status = 'active'
                AND (
                  $1::text IS NULL
                  OR ($2::boolean = true AND cpo.project_id = $1::uuid)
                  OR ($2::boolean = false AND p.project_name = $1::text)
                )
            ),
            project_totals AS (
              SELECT COUNT(DISTINCT d.drop_number) AS total_drops
              FROM drops d
              JOIN projects p ON p.id = d.project_id
              WHERE p.status = 'active'
                AND (
                  $1::text IS NULL
                  OR ($2::boolean = true AND d.project_id = $1::uuid)
                  OR ($2::boolean = false AND p.project_name = $1::text)
                )
            ),
            zone_counts AS (
              SELECT
                d.zone_no,
                COUNT(DISTINCT d.drop_number) AS zone_drops
              FROM drops d
              JOIN projects p ON p.id = d.project_id
              WHERE p.status = 'active'
                AND (
                  $1::text IS NULL
                  OR ($2::boolean = true AND d.project_id = $1::uuid)
                  OR ($2::boolean = false AND p.project_name = $1::text)
                )
              GROUP BY d.zone_no
            )
            SELECT
              'zone-' || zc.zone_no::text AS key,
              'Zone ' || zc.zone_no::text AS label,
              ROUND(
                CASE
                  WHEN pp.po_scope IS NOT NULL AND pt.total_drops > 0
                    THEN pp.po_scope::numeric * zc.zone_drops::numeric / pt.total_drops
                  ELSE zc.zone_drops::numeric
                END
              )::text AS total_scope
            FROM zone_counts zc
            CROSS JOIN project_po pp
            CROSS JOIN project_totals pt
            ORDER BY zc.zone_no
          `;
        }
        scopeParams.push(projectFilter, isUuid);

        timeSeriesQuery = `
          SELECT
            'zone-' || d.zone_no::text AS key,
            ${dateExpr} AS date,
            COUNT(DISTINCT oes.drop_number)::text AS daily_activated
          FROM oes_activations oes
          JOIN drops d ON d.drop_number = oes.drop_number
          JOIN projects p ON p.id = d.project_id
          WHERE p.status = 'active'
            AND oes.activation_date <= $1::date
            AND (
              $2::text IS NULL
              OR ($3::boolean = true AND d.project_id = $2::uuid)
              OR ($3::boolean = false AND p.project_name = $2::text)
            )
          GROUP BY d.zone_no, ${groupDateExpr}
          ORDER BY d.zone_no, ${groupDateExpr}
        `;
        timeSeriesParams.push(dateToStr, projectFilter, isUuid);

      } else if (groupByMode === 'pon') {
        if (useLivePons) {
          // Live PONs mode: scope = drops in PONs with activations, for given zone
          scopeQuery = `
            SELECT
              'pon-' || d.pon_no::text AS key,
              'PON ' || d.pon_no::text AS label,
              COUNT(DISTINCT d.drop_number)::text AS total_scope
            FROM drops d
            JOIN projects p ON p.id = d.project_id
            WHERE p.status = 'active'
              AND (
                $1::text IS NULL
                OR ($2::boolean = true AND d.project_id = $1::uuid)
                OR ($2::boolean = false AND p.project_name = $1::text)
              )
              AND d.zone_no = $3::int
              AND EXISTS (
                SELECT 1 FROM oes_activations oes2
                JOIN drops d2 ON d2.drop_number = oes2.drop_number
                WHERE d2.project_id = d.project_id AND d2.pon_no = d.pon_no
              )
            GROUP BY d.pon_no
            ORDER BY d.pon_no
          `;
        } else {
          // Full mode: pro-rate project PO contracted_drops by PON's share of total drops.
          scopeQuery = `
            WITH project_po AS (
              SELECT SUM(cpo.contracted_drops) AS po_scope
              FROM client_purchase_orders cpo
              JOIN projects p ON p.id = cpo.project_id
              WHERE p.status = 'active'
                AND (
                  $1::text IS NULL
                  OR ($2::boolean = true AND cpo.project_id = $1::uuid)
                  OR ($2::boolean = false AND p.project_name = $1::text)
                )
            ),
            project_totals AS (
              SELECT COUNT(DISTINCT d.drop_number) AS total_drops
              FROM drops d
              JOIN projects p ON p.id = d.project_id
              WHERE p.status = 'active'
                AND (
                  $1::text IS NULL
                  OR ($2::boolean = true AND d.project_id = $1::uuid)
                  OR ($2::boolean = false AND p.project_name = $1::text)
                )
            ),
            pon_counts AS (
              SELECT
                d.pon_no,
                COUNT(DISTINCT d.drop_number) AS pon_drops
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
            )
            SELECT
              'pon-' || pc.pon_no::text AS key,
              'PON ' || pc.pon_no::text AS label,
              ROUND(
                CASE
                  WHEN pp.po_scope IS NOT NULL AND pt.total_drops > 0
                    THEN pp.po_scope::numeric * pc.pon_drops::numeric / pt.total_drops
                  ELSE pc.pon_drops::numeric
                END
              )::text AS total_scope
            FROM pon_counts pc
            CROSS JOIN project_po pp
            CROSS JOIN project_totals pt
            ORDER BY pc.pon_no
          `;
        }
        scopeParams.push(projectFilter, isUuid, zoneFilter);

        timeSeriesQuery = `
          SELECT
            'pon-' || d.pon_no::text AS key,
            ${dateExpr} AS date,
            COUNT(DISTINCT oes.drop_number)::text AS daily_activated
          FROM oes_activations oes
          JOIN drops d ON d.drop_number = oes.drop_number
          JOIN projects p ON p.id = d.project_id
          WHERE p.status = 'active'
            AND oes.activation_date <= $1::date
            AND (
              $2::text IS NULL
              OR ($3::boolean = true AND d.project_id = $2::uuid)
              OR ($3::boolean = false AND p.project_name = $2::text)
            )
            AND d.zone_no = $4::int
          GROUP BY d.pon_no, ${groupDateExpr}
          ORDER BY d.pon_no, ${groupDateExpr}
        `;
        timeSeriesParams.push(dateToStr, projectFilter, isUuid, zoneFilter);
      }

      const scopeResult = await client.query<RawScopeRow>(scopeQuery, scopeParams);
      const timeSeriesResult = await client.query<RawTimeSeriesRow>(timeSeriesQuery, timeSeriesParams);

      const scopeMap = new Map<string, { label: string; total_scope: number }>();
      for (const row of scopeResult.rows) {
        scopeMap.set(row.key, {
          label: row.label,
          total_scope: parseInt(row.total_scope, 10),
        });
      }

      const timeSeriesMap = new Map<string, Map<string, number>>();
      for (const row of timeSeriesResult.rows) {
        if (!timeSeriesMap.has(row.key)) {
          timeSeriesMap.set(row.key, new Map());
        }
        const dateMap = timeSeriesMap.get(row.key)!;
        const dailyActivated = parseInt(row.daily_activated, 10);
        dateMap.set(row.date, (dateMap.get(row.date) || 0) + dailyActivated);
      }

      const allDates = new Set<string>();
      for (const dateMap of timeSeriesMap.values()) {
        for (const date of dateMap.keys()) {
          allDates.add(date);
        }
      }

      const sortedDates = Array.from(allDates).sort();

      const series: PenetrationSeries[] = [];

      for (const [key, scopeInfo] of scopeMap.entries()) {
        const dateMap = timeSeriesMap.get(key) || new Map();
        let cumulative = 0;
        let hasStarted = false;
        const points: PenetrationPoint[] = [];

        for (const date of sortedDates) {
          const dailyActivated = dateMap.get(date) || 0;

          if (!hasStarted && dailyActivated === 0) continue;
          hasStarted = true;

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

      series.sort((a, b) => a.label.localeCompare(b.label));

      const response: PenetrationCurveResponse = {
        date_range: { from: dateFromStr, to: dateToStr },
        group_by: groupByMode,
        granularity: granularityMode,
        series,
        dates: sortedDates,
      };

      log.info('PenetrationCurve', 'Report generated', { seriesCount: series.length, dateCount: sortedDates.length });

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
