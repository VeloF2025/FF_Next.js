/**
 * GET /api/activate/non-invoiceables/overview
 *
 * Aggregated overview for the Non-Invoiceable Action Centre.
 * Runs all category queries in parallel (Promise.all) and returns counts,
 * coverage KPIs, weekly trends, and per-project breakdown matching
 * the NonInvoiceableOverview type from src/modules/non-invoiceables/types.ts
 *
 * Query params:
 *   project (optional) — case-insensitive project name filter
 *
 * // 🟢 WORKING: parallel queries, zero conditional SQL fragments
 */

import type { NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import pool from '@/lib/db';
import type { NonInvoiceableOverview, NonInvoiceableCategory } from '@/modules/non-invoiceables/types';

const logger = createLogger('api/activate/non-invoiceables/overview');

// ─── Row shapes ──────────────────────────────────────────────────────────────

interface CountsRow { total: string; open: string; ticketed: string; resolved: string }
interface OfflineRow { total: string; open: string }
interface BillRow   { note1: string; note2: string; note3: string }
interface ProjCountsRow extends CountsRow { project: string }
interface ProjOfflineRow extends OfflineRow { project: string }
interface ProjBillRow extends BillRow { project: string }
interface WeeklyRow {
  week_ending: string; project: string;
  ft_note1_count: string; ft_note2_count: string;
  ft_note3_count: string; ft_pre_provisions_count: string;
  reconciliation_status: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const n = (v: string | null | undefined): number => Number(v ?? 0);
/** Returns WHERE + params for an optional project filter. */
const pf = (project: string | undefined, col = 'project') =>
  project ? { w: `WHERE ${col} ILIKE $1`, p: [project] as string[] } : { w: '', p: [] as string[] };
/** Inline AND clause appended to an existing WHERE. */
const andProj = (project: string | undefined) => project ? `AND project ILIKE $1` : '';
/** Latest-billing-week JOIN sub-query (aliases billing week to lw). */
const latestWeekJoin = `JOIN (SELECT project, MAX(week_ending) AS latest_week FROM ft_weekly_billing GROUP BY project) lw ON lw.project = d.project AND d.week_ending = lw.latest_week`;

// ─── Handler ─────────────────────────────────────────────────────────────────

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const project =
    typeof req.query.project === 'string' && req.query.project.trim()
      ? req.query.project.trim()
      : undefined;

  try {
    const { w: ppWhere, p: ppP }       = pf(project);
    const { w: trendWhere, p: trendP } = pf(project);
    const billingWhere = project ? `WHERE d.project ILIKE $1` : '';
    const billingP: string[] = project ? [project] : [];
    // olt_mismatch_records has no project column — JOIN through olt_report_imports
    const oltJoin = 'JOIN olt_report_imports ri ON ri.id = r.import_id';
    const oltWhere = project ? `WHERE ri.project ILIKE $1` : '';
    const oltP: string[] = project ? [project] : [];
    // offline_devices has no project column — skip project filter

    const [
      ppResult,
      oltResult,
      offMismatchResult,
      offlineResult,
      billingResult,
      weeklyResult,
      projPpResult,
      projOltResult,
      projOffMisResult,
      projOffResult,
      projBillResult,
    ] = await Promise.all([

      pool.query<CountsRow>(
        `SELECT COUNT(*) FILTER (WHERE resolution_status != 'activated') AS total,
           COUNT(*) FILTER (WHERE resolution_status = 'not_found' AND maintenance_ticket_id IS NULL) AS open,
           COUNT(*) FILTER (WHERE maintenance_ticket_id IS NOT NULL AND resolution_status != 'activated') AS ticketed,
           COUNT(*) FILTER (WHERE resolution_status = 'activated') AS resolved
         FROM oes_pp_data ${ppWhere}`,
        ppP,
      ),

      pool.query<CountsRow>(
        `SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE r.fix_status IN ('pending','empty_serial','not_found','needs_reinvestigation') AND r.maintenance_ticket_id IS NULL) AS open,
           COUNT(*) FILTER (WHERE r.maintenance_ticket_id IS NOT NULL AND r.fix_status NOT IN ('fixed','resolved')) AS ticketed,
           COUNT(*) FILTER (WHERE r.fix_status IN ('fixed','resolved')) AS resolved
         FROM olt_mismatch_records r ${oltJoin} ${oltWhere}`,
        oltP,
      ),

      pool.query<CountsRow>(
        `SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE mismatch_status = 'pending_investigation') AS open,
           COUNT(*) FILTER (WHERE mismatch_status = 'ticket_created') AS ticketed,
           COUNT(*) FILTER (WHERE mismatch_status = 'resolved') AS resolved
         FROM offline_devices WHERE serial_mismatch = true`,
        [],
      ),

      pool.query<OfflineRow>(
        `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE match_status = 'unmatched') AS open
         FROM offline_devices WHERE serial_mismatch IS NOT TRUE`,
        [],
      ),

      pool.query<BillRow>(
        `SELECT COUNT(*) FILTER (WHERE d.deduction_note = 'note1') AS note1,
           COUNT(*) FILTER (WHERE d.deduction_note = 'note2') AS note2,
           COUNT(*) FILTER (WHERE d.deduction_note = 'note3') AS note3
         FROM ft_billing_deductions d ${latestWeekJoin} ${billingWhere}`,
        billingP,
      ),

      pool.query<WeeklyRow>(
        `SELECT week_ending, project, ft_note1_count, ft_note2_count,
                ft_note3_count, ft_pre_provisions_count, reconciliation_status
         FROM ft_weekly_billing ${trendWhere}
         ORDER BY week_ending DESC
         LIMIT ${project ? '4' : '20'}`,
        trendP,
      ),

      pool.query<ProjCountsRow>(
        `SELECT project,
           COUNT(*) FILTER (WHERE resolution_status != 'activated') AS total,
           COUNT(*) FILTER (WHERE resolution_status = 'not_found' AND maintenance_ticket_id IS NULL) AS open,
           COUNT(*) FILTER (WHERE maintenance_ticket_id IS NOT NULL AND resolution_status != 'activated') AS ticketed,
           COUNT(*) FILTER (WHERE resolution_status = 'activated') AS resolved
         FROM oes_pp_data ${ppWhere} GROUP BY project ORDER BY project`,
        ppP,
      ),

      pool.query<ProjCountsRow>(
        `SELECT ri.project,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE r.fix_status IN ('pending','empty_serial','not_found','needs_reinvestigation') AND r.maintenance_ticket_id IS NULL) AS open,
           COUNT(*) FILTER (WHERE r.maintenance_ticket_id IS NOT NULL AND r.fix_status NOT IN ('fixed','resolved')) AS ticketed,
           COUNT(*) FILTER (WHERE r.fix_status IN ('fixed','resolved')) AS resolved
         FROM olt_mismatch_records r ${oltJoin} ${oltWhere}
         GROUP BY ri.project ORDER BY ri.project`,
        oltP,
      ),

      /* offline_devices has no project column — return empty for per-project breakdown */
      Promise.resolve({ rows: [] as ProjCountsRow[] }),

      Promise.resolve({ rows: [] as ProjOfflineRow[] }),

      pool.query<ProjBillRow>(
        `SELECT d.project,
           COUNT(*) FILTER (WHERE d.deduction_note = 'note1') AS note1,
           COUNT(*) FILTER (WHERE d.deduction_note = 'note2') AS note2,
           COUNT(*) FILTER (WHERE d.deduction_note = 'note3') AS note3
         FROM ft_billing_deductions d ${latestWeekJoin}
         ${billingWhere} GROUP BY d.project ORDER BY d.project`,
        billingP,
      ),
    ]);

    // ── Aggregate totals ──────────────────────────────────────────────────────

    const olt0: CountsRow = oltResult.rows[0] ?? { total:'0', open:'0', ticketed:'0', resolved:'0' };
    const om0: CountsRow  = offMismatchResult.rows[0] ?? { total:'0', open:'0', ticketed:'0', resolved:'0' };
    const pp0: CountsRow  = ppResult.rows[0] ?? { total:'0', open:'0', ticketed:'0', resolved:'0' };
    const off0: OfflineRow = offlineResult.rows[0] ?? { total:'0', open:'0' };
    const bill0: BillRow  = billingResult.rows[0] ?? { note1:'0', note2:'0', note3:'0' };

    const serialMismatches = {
      total: n(olt0.total) + n(om0.total), open: n(olt0.open) + n(om0.open),
      ticketed: n(olt0.ticketed) + n(om0.ticketed), resolved: n(olt0.resolved) + n(om0.resolved),
    };
    const preProvisions = {
      total: n(pp0.total), open: n(pp0.open), ticketed: n(pp0.ticketed), resolved: n(pp0.resolved),
    };
    const offline = { total: n(off0.total), open: n(off0.open), ticketed: 0, resolved: 0 };
    const billingDeductions = {
      low_signal: n(bill0.note1), missing_dr: n(bill0.note2), degraded: n(bill0.note3),
      total: n(bill0.note1) + n(bill0.note2) + n(bill0.note3),
    };

    // ── KPIs ──────────────────────────────────────────────────────────────────

    const totalTicketed = preProvisions.ticketed + serialMismatches.ticketed;
    const totalOpen     = preProvisions.open + serialMismatches.open + offline.open + billingDeductions.total;
    const coverageRate  = totalOpen > 0 ? Math.round((totalTicketed / totalOpen) * 1000) / 10 : 100;
    const totalResolved = preProvisions.resolved + serialMismatches.resolved;
    const totalIssues   = preProvisions.total + serialMismatches.total + offline.total;
    const resolutionRate = totalIssues > 0 ? Math.round((totalResolved / totalIssues) * 1000) / 10 : 0;

    const repeatResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM (
         SELECT dr_number FROM ft_billing_deductions
         ${project ? 'WHERE project ILIKE $1' : ''}
         GROUP BY dr_number HAVING COUNT(DISTINCT week_ending) >= 2
       ) sub`,
      project ? [project] : [],
    );
    const repeatOffenders = n(repeatResult.rows[0]?.count);

    // ── Weekly trend ──────────────────────────────────────────────────────────

    const weekly_trend = weeklyResult.rows.map((r) => ({
      week_ending: String(r.week_ending),
      total_deductions: n(r.ft_note1_count) + n(r.ft_note2_count) + n(r.ft_note3_count) + n(r.ft_pre_provisions_count),
      already_actioned: 0,
      missed: 0,
    }));

    // ── by_category ───────────────────────────────────────────────────────────

    type CK = NonInvoiceableCategory;
    const by_category: Record<CK, { total: number; open: number; ticketed: number; resolved: number }> = {
      pre_provision:  preProvisions,
      serial_mismatch: serialMismatches,
      offline,
      low_signal: { total: billingDeductions.low_signal, open: billingDeductions.low_signal, ticketed: 0, resolved: 0 },
      degraded:   { total: billingDeductions.degraded,   open: billingDeductions.degraded,   ticketed: 0, resolved: 0 },
      missing_dr: { total: billingDeductions.missing_dr, open: billingDeductions.missing_dr, ticketed: 0, resolved: 0 },
    };

    // ── by_project ────────────────────────────────────────────────────────────

    const allProjects = new Set<string>([
      ...projPpResult.rows, ...projOltResult.rows, ...projOffMisResult.rows,
      ...projOffResult.rows, ...projBillResult.rows,
    ].map((r) => r.project));

    const eC: ProjCountsRow = { project:'', total:'0', open:'0', ticketed:'0', resolved:'0' };
    const eO: ProjOfflineRow = { project:'', total:'0', open:'0' };
    const eB: ProjBillRow    = { project:'', note1:'0', note2:'0', note3:'0' };

    const by_project: Record<string, { total: number; open: number; ticketed: number }> = {};
    for (const proj of allProjects) {
      const pp  = projPpResult.rows.find((r) => r.project === proj)    ?? eC;
      const olt = projOltResult.rows.find((r) => r.project === proj)   ?? eC;
      const om  = projOffMisResult.rows.find((r) => r.project === proj) ?? eC;
      const off = projOffResult.rows.find((r) => r.project === proj)   ?? eO;
      const b   = projBillResult.rows.find((r) => r.project === proj)  ?? eB;
      by_project[proj] = {
        total:    n(pp.total)  + n(olt.total)  + n(om.total)  + n(off.total),
        open:     n(pp.open)   + n(olt.open)   + n(om.open)   + n(off.open) + n(b.note1) + n(b.note2) + n(b.note3),
        ticketed: n(pp.ticketed) + n(olt.ticketed) + n(om.ticketed),
      };
    }

    // ── Compose response ──────────────────────────────────────────────────────

    const overview: NonInvoiceableOverview = {
      by_category, coverage_rate: coverageRate, resolution_rate: resolutionRate,
      repeat_offenders: repeatOffenders, by_project, weekly_trend,
    };

    logger.info('overview loaded', { project: project ?? 'all', total_open: totalOpen, coverage_rate: coverageRate });
    return apiResponse.success(res, overview);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load overview';
    logger.error('overview GET failed', { error: message });
    return res.status(500).json({ success: false, error: message });
  }
}

export default withAuth(handler as Parameters<typeof withAuth>[0]);
