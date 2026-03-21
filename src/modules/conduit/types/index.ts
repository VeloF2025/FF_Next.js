/**
 * Conduit module types — project scenario modelling.
 */

export interface ScopeInputs {
  poles: number;
  stringing_m: number;
  pon: number;
}

export interface ServiceRates {
  permissions_per_pole: number;
  poles_each: number;
  stringing_per_m: number;
  optical_per_pon: number;
  activation_each: number;
}

export interface StockRates {
  pole: number;
  cable_per_m: number;
  optical: number;
  activation: number;
}

export interface ExpensesPerMonth {
  ad_hoc: number;
  casuals: number;
  fuel: number;
  overheads: number;
  sales: number;
}

export interface ConduitProjectInputs {
  rate: number;
  uptake: number;
  scope: ScopeInputs;
  service_rates: ServiceRates;
  stock_rates: StockRates;
  expenses_per_month: ExpensesPerMonth;
}

export interface ConduitProject {
  id: string;
  name: string;
  po_count: number;
  start_date: string | null;
  build_duration_months: number;
  inputs_json: ConduitProjectInputs;
  is_baseline_locked: boolean;
  created_at: string;
  updated_at: string;
}

/** Calculated (derived) fields — never stored, always re-derived from inputs */
export interface ConduitCalcResult {
  fc_activation: number;
  revenue: number;
  cos_services: number;
  cos_stock: number;
  cos_expenses: number;
  cos_total: number;
  profit: number;
  gross_profit_pct: number;
  cost_per_home: number;
}
