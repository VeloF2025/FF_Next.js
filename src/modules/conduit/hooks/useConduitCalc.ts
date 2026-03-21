/**
 * useConduitCalc — Pure formula engine for Conduit project calculations.
 *
 * ─── Revenue ──────────────────────────────────────────────────────────────
 *   FC Activation = PO Count × Uptake  (unrounded)
 *   Revenue       = FC Activation × Rate
 *
 * ─── COS — Services (labour / installation) ──────────────────────────────
 *   svc_poles      = poles × (pole_plant_each + permissions_per_pole)
 *   svc_stringing  = stringing_m × stringing_per_m
 *   svc_optical    = pon × optical_per_pon
 *   svc_activation = fc_activation × activation_each
 *   svc_wayleave   = fc_activation × wayleave_incentive  ← per FC activation
 *   cos_services   = sum of above
 *
 * ─── COS — Material (supply / stock) ─────────────────────────────────────
 *   mat_poles      = poles × mr.pole
 *   mat_cable      = stringing_m × mr.cable_per_m
 *   mat_optical    = pon × mr.optical
 *   mat_activation = fc_activation × mr.activation
 *   cos_material   = sum of above
 *
 * ─── COS — OPEX × build duration ─────────────────────────────────────────
 *   cos_opex = (casuals + fuel + overheads + sales + ad_hoc) × build_duration_months
 *
 * ─── COS — Lump sums ─────────────────────────────────────────────────────
 *   cos_lump = wayleave_cost  (project total)
 *
 * ─── Totals ───────────────────────────────────────────────────────────────
 *   cos_total     = cos_services + cos_material + cos_opex + cos_lump
 *   profit        = revenue − cos_total
 *   GP%           = profit ÷ revenue
 *   cost_per_home = cos_total ÷ fc_activation
 */

import type { ConduitProject, ConduitCalcResult, ConduitCosBreakdown } from '../types';

export function calcConduit(project: ConduitProject): ConduitCalcResult {
  const { po_count, build_duration_months: dur, inputs_json: inp } = project;
  const { rate, uptake, scope, service_rates: sr, material_rates: mr, monthly_opex: mo, lump_costs: lc } = inp;

  // ── Revenue ──────────────────────────────────────────────────────────────
  const fc_activation = po_count * uptake;
  const revenue = fc_activation * rate;

  // ── COS — Services breakdown ──────────────────────────────────────────────
  const svc_poles      = scope.poles * (sr.pole_plant_each + sr.permissions_per_pole);
  const svc_stringing  = scope.stringing_m * sr.stringing_per_m;
  const svc_optical    = scope.pon * sr.optical_per_pon;
  const svc_activation = fc_activation * sr.activation_each;
  const svc_wayleave   = fc_activation * sr.wayleave_incentive;  // per FC activation
  const cos_services   = svc_poles + svc_stringing + svc_optical + svc_activation + svc_wayleave;

  // ── COS — Material breakdown ──────────────────────────────────────────────
  const mat_poles      = scope.poles * mr.pole;
  const mat_cable      = scope.stringing_m * mr.cable_per_m;
  const mat_optical    = scope.pon * mr.optical;
  const mat_activation = fc_activation * mr.activation;
  const cos_material   = mat_poles + mat_cable + mat_optical + mat_activation;

  // ── COS — OPEX × build duration ───────────────────────────────────────────
  const opex_casuals   = mo.casuals   * dur;
  const opex_fuel      = mo.fuel      * dur;
  const opex_overheads = mo.overheads * dur;
  const opex_sales     = mo.sales     * dur;
  const opex_ad_hoc    = mo.ad_hoc    * dur;
  const cos_opex       = opex_casuals + opex_fuel + opex_overheads + opex_sales + opex_ad_hoc;

  // ── COS — Lump sums ───────────────────────────────────────────────────────
  const cos_lump = lc.wayleave_cost;

  // ── Totals ────────────────────────────────────────────────────────────────
  const cos_total       = cos_services + cos_material + cos_opex + cos_lump;
  const profit          = revenue - cos_total;
  const gross_profit_pct = revenue > 0 ? profit / revenue : 0;
  const cost_per_home   = fc_activation > 0 ? cos_total / fc_activation : 0;

  const breakdown: ConduitCosBreakdown = {
    svc_poles, svc_stringing, svc_optical, svc_activation, svc_wayleave,
    mat_poles, mat_cable, mat_optical, mat_activation,
    opex_casuals, opex_fuel, opex_overheads, opex_sales, opex_ad_hoc,
  };

  return {
    fc_activation, revenue,
    cos_services, cos_material, cos_opex, cos_lump, cos_total,
    profit, gross_profit_pct, cost_per_home,
    breakdown,
  };
}

import { useMemo } from 'react';
export function useConduitCalc(project: ConduitProject): ConduitCalcResult {
  return useMemo(() => calcConduit(project), [project]);
}
