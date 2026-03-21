/**
 * Conduit module types — project scenario modelling.
 *
 * Schema v2 — PM-centric inputs, clean COS breakdown.
 * Cost/Home = COS Total ÷ FC Activations (not PO Count).
 */

// ─── Scope ───────────────────────────────────────────────────────────────────

/** Physical quantities to be built (scope of work). */
export interface ScopeInputs {
  poles: number;        // number of poles to erect
  stringing_m: number;  // aerial cable run (meters)
  pon: number;          // PON splitters to install
}

// ─── COS Rates ───────────────────────────────────────────────────────────────

/** COS — Service Rates (labour / installation per unit) */
export interface ServiceRates {
  permissions_per_pole: number;  // Permissions / Pole
  pole_plant_each: number;       // Pole Plant / Each
  stringing_per_m: number;       // Stringing / Meter
  optical_per_pon: number;       // Optical / PON
  activation_each: number;       // Activation / Each
  wayleave_incentive: number;    // Wayleave Incentive
  wayleave_cost: number;         // Wayleave Cost
}

/** COS — Materials Rate (supply / stock per unit) */
export interface MaterialRates {
  pole: number;        // Pole (material)
  cable_per_m: number; // Cable (per meter)
  optical: number;     // Optical / PON (material)
  activation: number;  // Activations (ONT + connectors)
}

/** Monthly operational costs during the build phase (multiplied by build_duration_months). */
export interface MonthlyOpex {
  casuals: number;    // temporary labour per month
  fuel: number;       // vehicle / generator fuel per month
  overheads: number;  // site overheads per month
  sales: number;      // sales / customer acquisition per month
}

/** Lump-sum costs entered as totals (not per-month). */
export interface LumpCosts {
  ad_hoc: number;          // variable/contingency costs (project total)
  sub_contractor: number;  // sub-contractor fees (project total)
}

// ─── Project Inputs ──────────────────────────────────────────────────────────

export interface ConduitProjectInputs {
  // Revenue drivers
  rate: number;    // monthly ARPU per connected home (R)
  uptake: number;  // expected take-up rate, fraction 0–1

  // Scope of work
  scope: ScopeInputs;

  // COS — service rates (labour / installation per unit)
  service_rates: ServiceRates;

  // COS — material rates (supply / stock per unit)
  material_rates: MaterialRates;

  // COS — monthly opex × build_duration_months
  monthly_opex: MonthlyOpex;

  // COS — lump sums (project totals)
  lump_costs: LumpCosts;
}

// ─── Project record ──────────────────────────────────────────────────────────

export interface ConduitProject {
  id: string;
  name: string;
  po_count: number;              // homes passed
  start_date: string | null;
  build_duration_months: number;
  inputs_json: ConduitProjectInputs;
  is_baseline_locked: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Calc result ─────────────────────────────────────────────────────────────

/**
 * Calculated (derived) fields — never stored, always re-derived from inputs.
 *
 * COS breakdown:
 *   cos_civil      = poles × (service.pole_plant + service.permissions + service.wayleave_incentive + service.wayleave_cost + material.pole)
 *                  + stringing × (service.stringing_per_m + material.cable_per_m)
 *                  + pon × (service.optical_per_pon + material.optical)
 *   cos_activation = fc_activation × (service.activation_each + material.activation)
 *   cos_monthly    = (casuals+fuel+overheads+sales) × build_duration_months
 *   cos_lump       = ad_hoc + sub_contractor
 *   cos_total      = sum of all above
 *
 * cost_per_home = cos_total ÷ fc_activation  (cost per CONNECTED home, not passed)
 */
export interface ConduitCalcResult {
  fc_activation: number;   // PO Count × Uptake (unrounded)
  revenue: number;         // fc_activation × rate

  cos_civil: number;       // infrastructure: poles + stringing + PON + wayleaves
  cos_activation: number;  // per-home activation cost × FC activations
  cos_monthly: number;     // monthly opex × build duration
  cos_lump: number;        // ad hoc + sub-contractor (lump sums)
  cos_total: number;       // sum of all COS

  profit: number;          // revenue − cos_total
  gross_profit_pct: number; // profit ÷ revenue
  cost_per_home: number;   // cos_total ÷ fc_activation
}
