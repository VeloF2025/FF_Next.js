/**
 * useConduitCalc — Pure formula engine for Conduit project calculations.
 * No side effects, no API calls. Input → derived output.
 *
 * ─── Revenue ──────────────────────────────────────────────────────────────
 *   FC Activation  = PO Count × Uptake          (unrounded — display rounds)
 *   Revenue        = FC Activation × Rate
 *
 * ─── COS Civil (infrastructure, scope-driven) ─────────────────────────────
 *   Per Pole       = service.pole_plant_each + service.permissions_per_pole
 *                  + service.wayleave_incentive + service.wayleave_cost
 *                  + material.pole
 *   Per Meter      = service.stringing_per_m + material.cable_per_m
 *   Per PON        = service.optical_per_pon + material.optical
 *
 *   cos_civil      = poles × PerPole + stringing_m × PerMeter + pon × PerPON
 *
 * ─── COS Activation (variable with uptake) ────────────────────────────────
 *   cos_activation = FC Activation × (service.activation_each + material.activation)
 *
 * ─── COS Monthly opex × build duration ────────────────────────────────────
 *   cos_monthly    = (casuals + fuel + overheads + sales) × build_duration_months
 *
 * ─── COS Lump sums ────────────────────────────────────────────────────────
 *   cos_lump       = ad_hoc + sub_contractor
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

  const { rate, uptake, scope, service_rates: sr, material_rates: mr, monthly_opex: mo, lump_costs: lc } = inp;

  // ── Revenue ──────────────────────────────────────────────────────────────
  const fc_activation = po_count * uptake;
  const revenue = fc_activation * rate;

  // ── COS — Civil ──────────────────────────────────────────────────────────
  const total_per_pole =
    sr.pole_plant_each +
    sr.permissions_per_pole +
    sr.wayleave_incentive +
    sr.wayleave_cost +
    mr.pole;

  const total_per_m = sr.stringing_per_m + mr.cable_per_m;
  const total_per_pon = sr.optical_per_pon + mr.optical;

  const cos_civil =
    scope.poles * total_per_pole +
    scope.stringing_m * total_per_m +
    scope.pon * total_per_pon;

  // ── COS — Activation ─────────────────────────────────────────────────────
  const cos_activation = fc_activation * (sr.activation_each + mr.activation);

  // ── COS — Monthly opex × build duration ──────────────────────────────────
  const cos_monthly =
    (mo.casuals + mo.fuel + mo.overheads + mo.sales) * build_duration_months;

  // ── COS — Lump sums ───────────────────────────────────────────────────────
  const cos_lump = lc.ad_hoc + lc.sub_contractor;

  // ── Totals ────────────────────────────────────────────────────────────────
  const cos_total = cos_civil + cos_activation + cos_monthly + cos_lump;
  const profit = revenue - cos_total;
  const gross_profit_pct = revenue > 0 ? profit / revenue : 0;
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
