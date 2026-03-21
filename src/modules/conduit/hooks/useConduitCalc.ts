/**
 * useConduitCalc — Pure formula engine for Conduit project calculations.
 * No side effects, no API calls. Input → derived output.
 *
 * ─── Revenue ──────────────────────────────────────────────────────────────
 *   FC Activation  = PO Count × Uptake          (unrounded — display rounds)
 *   Revenue        = FC Activation × Rate        (peak monthly subscription revenue)
 *
 * ─── COS ──────────────────────────────────────────────────────────────────
 *   Civil          = Poles × (PerPole + WayleavePerPole)
 *                  + Stringing × PerStringM
 *                  + PON × PerPON
 *
 *   Activation     = FC Activation × PerActivation
 *
 *   Monthly Opex   = (Casuals + Fuel + Overheads + Sales) × BuildDuration
 *
 *   Lump           = AdHoc + SubContractor
 *
 *   COS Total      = Civil + Activation + Monthly Opex + Lump
 *
 * ─── Derived ──────────────────────────────────────────────────────────────
 *   Profit         = Revenue − COS Total
 *   GP%            = Profit ÷ Revenue
 *   Cost/Home      = COS Total ÷ FC Activation    (cost per CONNECTED home)
 */

import type { ConduitProject, ConduitCalcResult } from '../types';

export function calcConduit(project: ConduitProject): ConduitCalcResult {
  const {
    po_count,
    build_duration_months,
    inputs_json: inp,
  } = project;

  const { rate, uptake, scope, unit_costs: uc, monthly_opex: mo, lump_costs: lc } = inp;

  // ── Revenue ──────────────────────────────────────────────────────────────
  const fc_activation = po_count * uptake; // keep unrounded for downstream calcs
  const revenue = fc_activation * rate;

  // ── COS — Civil (infrastructure, scope-driven) ────────────────────────────
  const cos_civil =
    scope.poles * (uc.per_pole + uc.wayleave_per_pole) +
    scope.stringing_m * uc.per_stringing_m +
    scope.pon * uc.per_pon;

  // ── COS — Activation (variable with uptake) ───────────────────────────────
  const cos_activation = fc_activation * uc.per_activation;

  // ── COS — Monthly opex × build duration ──────────────────────────────────
  const cos_monthly =
    (mo.casuals + mo.fuel + mo.overheads + mo.sales) * build_duration_months;

  // ── COS — Lump sums ───────────────────────────────────────────────────────
  const cos_lump = lc.ad_hoc + lc.sub_contractor;

  // ── Totals ────────────────────────────────────────────────────────────────
  const cos_total = cos_civil + cos_activation + cos_monthly + cos_lump;
  const profit = revenue - cos_total;
  const gross_profit_pct = revenue > 0 ? profit / revenue : 0;

  // Cost per CONNECTED home (COS ÷ FC Activations, not ÷ PO Count)
  const cost_per_home = fc_activation > 0 ? cos_total / fc_activation : 0;

  return {
    fc_activation,
    revenue,
    cos_civil,
    cos_activation,
    cos_monthly,
    cos_lump,
    cos_total,
    profit,
    gross_profit_pct,
    cost_per_home,
  };
}

/** React hook wrapper — memoises calc result when project changes. */
import { useMemo } from 'react';

export function useConduitCalc(project: ConduitProject): ConduitCalcResult {
  return useMemo(() => calcConduit(project), [project]);
}
