/**
 * useConduitCalc — Pure formula engine for Conduit project calculations.
 * No side effects, no API calls. Input → derived output.
 *
 * COS Formula:
 *   Services = (Poles × PermPerPole) + (Poles × PolesEach) + (Stringing × StringPerM)
 *              + (PON × OptPerPON) + (FCActivations × ActEach)
 *   Stock    = (Poles × PoleStock) + (Stringing × CablePerM)
 *              + (PON × OptStock) + (FCActivations × ActStock)
 *   Expenses = (AdHoc + Casuals + Fuel + Overheads + Sales) × BuildDuration
 *   COS Total = Services + Stock + Expenses
 */

import type { ConduitProject, ConduitCalcResult } from '../types';

export function calcConduit(project: ConduitProject): ConduitCalcResult {
  const { po_count, build_duration_months, inputs_json: inp } = project;
  const { rate, uptake, scope, service_rates: sr, stock_rates: st, expenses_per_month: ex } = inp;

  // Core derivations
  const fc_activation = po_count * uptake;
  const revenue = fc_activation * rate * 12;

  // COS — Services
  const cos_services =
    scope.poles * sr.permissions_per_pole +
    scope.poles * sr.poles_each +
    scope.stringing_m * sr.stringing_per_m +
    scope.pon * sr.optical_per_pon +
    fc_activation * sr.activation_each;

  // COS — Stock
  const cos_stock =
    scope.poles * st.pole +
    scope.stringing_m * st.cable_per_m +
    scope.pon * st.optical +
    fc_activation * st.activation;

  // COS — Expenses (monthly total × build duration)
  const monthly_expenses = ex.ad_hoc + ex.casuals + ex.fuel + ex.overheads + ex.sales;
  const cos_expenses = monthly_expenses * build_duration_months;

  const cos_total = cos_services + cos_stock + cos_expenses;
  const profit = revenue - cos_total;
  const gross_profit_pct = revenue > 0 ? profit / revenue : 0;
  const cost_per_home = po_count > 0 ? cos_total / po_count : 0;

  return {
    fc_activation,
    revenue,
    cos_services,
    cos_stock,
    cos_expenses,
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
