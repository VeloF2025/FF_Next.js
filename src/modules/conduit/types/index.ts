/**
 * Conduit module types — project scenario modelling.
 *
 * Schema v3 — COS split into Services / Material / OPEX / Lump.
 * Cost/Home = COS Total ÷ FC Activations (not PO Count).
 * Wayleave Incentive = FC Activations × rate (not Poles × rate).
 */

// ─── Scope ───────────────────────────────────────────────────────────────────

export interface ScopeInputs {
  poles: number;        // number of poles to erect
  stringing_m: number;  // aerial cable run (meters)
  pon: number;          // PON splitters to install
}

// ─── COS Input Rates ─────────────────────────────────────────────────────────

/** Service Rates — labour / installation per unit */
export interface ServiceRates {
  permissions_per_pole: number;  // Permissions / Pole
  pole_plant_each: number;       // Pole Plant / Each
  stringing_per_m: number;       // Stringing / Meter
  optical_per_pon: number;       // Optical / PON
  activation_each: number;       // Activation / Each
  wayleave_incentive: number;    // Wayleave Incentive — per FC Activation (not per pole)
}

/** Material Rates — supply / stock per unit */
export interface MaterialRates {
  pole: number;        // Pole material (each)
  cable_per_m: number; // Cable (per meter)
  optical: number;     // Optical / PON material (each)
  activation: number;  // Activations — ONT + connectors (per home)
}

/** Monthly OPEX — multiplied × build_duration_months */
export interface MonthlyOpex {
  casuals: number;    // temporary labour per month
  fuel: number;       // vehicle / generator fuel per month
  overheads: number;  // site overheads per month
  sales: number;      // sales / customer acquisition per month
  ad_hoc: number;     // contingency / variable per month
}

/** Lump Costs — project totals (not per-unit or per-month) */
export interface LumpCosts {
  wayleave_cost: number;  // Wayleave Cost (project total)
}

// ─── Monthly Plan ────────────────────────────────────────────────────────────

/**
 * PM-entered rollout quantities per calendar month.
 * OPEX overrides: null = use default from monthly_opex inputs.
 * Stored in inputs_json.monthly_plan[].
 */
export interface MonthlyPlanEntry {
  // Rollout quantities (physical work this month)
  poles: number;
  stringing_m: number;
  pon: number;
  activations: number;

  // OPEX overrides — null means "use default from MonthlyOpex inputs"
  opex_casuals:   number | null;
  opex_fuel:      number | null;
  opex_overheads: number | null;
  opex_sales:     number | null;
  opex_ad_hoc:    number | null;
}

// ─── Project Inputs ──────────────────────────────────────────────────────────

export interface ConduitProjectInputs {
  rate: number;    // monthly ARPU per connected home (R)
  uptake: number;  // expected take-up rate, fraction 0–1
  scope: ScopeInputs;
  service_rates: ServiceRates;
  material_rates: MaterialRates;
  monthly_opex: MonthlyOpex;
  lump_costs: LumpCosts;
  monthly_plan: MonthlyPlanEntry[];  // PM-entered per-month rollout plan
}

// ─── Project Record ──────────────────────────────────────────────────────────

export interface ConduitProject {
  id: string;
  name: string;
  status: 'prospective' | 'executable' | 'wip';
  ft_project_name: string | null;
  po_count: number;
  start_date: string | null;
  build_duration_months: number;
  inputs_json: ConduitProjectInputs;
  is_baseline_locked: boolean;
  created_at: string;
  updated_at: string;
}

// ─── COS Breakdown (line-item detail) ────────────────────────────────────────

/**
 * Per-line breakdown — used by the expandable COS detail panel.
 * All derived; never stored.
 */
export interface ConduitCosBreakdown {
  // Services
  svc_poles: number;       // poles × (pole_plant_each + permissions_per_pole)
  svc_stringing: number;   // stringing_m × stringing_per_m
  svc_optical: number;     // pon × optical_per_pon
  svc_activation: number;  // fc_activation × activation_each
  svc_wayleave: number;    // fc_activation × wayleave_incentive

  // Materials
  mat_poles: number;       // poles × mr.pole
  mat_cable: number;       // stringing_m × mr.cable_per_m
  mat_optical: number;     // pon × mr.optical
  mat_activation: number;  // fc_activation × mr.activation

  // OPEX (each × build_duration_months)
  opex_casuals: number;
  opex_fuel: number;
  opex_overheads: number;
  opex_sales: number;
  opex_ad_hoc: number;
}

// ─── Calc Result ─────────────────────────────────────────────────────────────

/**
 * Calculated (derived) fields — never stored, always re-derived from inputs.
 *
 * COS formula:
 *   cos_services = poles×(pole_plant+permissions) + stringing×stringing_pm
 *                + pon×optical_per_pon + fc_activation×(activation_each + wayleave_incentive)
 *   cos_material = poles×mr.pole + stringing×mr.cable + pon×mr.optical + fc_activation×mr.activation
 *   cos_opex     = (casuals+fuel+overheads+sales+ad_hoc) × build_duration_months
 *   cos_lump     = lc.wayleave_cost
 *   cos_total    = cos_services + cos_material + cos_opex + cos_lump
 *
 *   cost_per_home = cos_total ÷ fc_activation
 */
export interface ConduitCalcResult {
  fc_activation: number;   // PO Count × Uptake (unrounded)
  revenue: number;         // fc_activation × rate

  cos_services: number;    // labour / installation costs
  cos_material: number;    // supply / stock costs
  cos_opex: number;        // monthly OPEX × build duration
  cos_lump: number;        // lump-sum costs (wayleave_cost)
  cos_total: number;       // sum of all COS

  profit: number;
  gross_profit_pct: number;
  cost_per_home: number;

  breakdown: ConduitCosBreakdown;
}

// ─── Actuals ─────────────────────────────────────────────────────────────────

export interface ConduitActual {
  month: string;           // ISO date string, first of month
  cos_actual: number;
  activations: number;
  cos_breakdown: Record<string, number>;  // { Activations: R, Backhaul: R, ... }
}

// ─── Baseline ────────────────────────────────────────────────────────────────

export interface ConduitBaseline {
  id: string;
  project_id: string;
  project_name: string;
  label: string;
  inputs_snapshot: Record<string, unknown>;
  calc_snapshot: ConduitCalcResult;
  created_at: string;
}
